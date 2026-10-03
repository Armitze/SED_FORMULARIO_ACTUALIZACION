// window.RutParser — lee la copia del RUT de la DIAN (formulario 001) a partir del Doc de PdfText y la
// convierte en campos del formulario 13-IF-016 (ids de SCHEMA, valores de CATALOGOS).
//
// Contrato (SPEC → "Module contracts" → RutParser):
//   RutParser.esRut(doc) -> boolean
//     true si alguna página del Doc es del RUT (hoja principal o de continuación, incluso en blanco).
//   RutParser.parse(doc, opts?) -> Resultado            (nunca lanza excepciones)
//     opts.documentoEsperado  cédula/NIT que ya está en el formulario (escrito o de otro RUT): si el PDF trae varios RUT se usa el suyo.
//     opts.hoy                Date | 'aaaa-mm-dd' (por defecto hoy) para avisar si el RUT es viejo.
//   Resultado = { tipo: 'RUT', ok, campos: { idCampo: { valor, etiqueta?, origen, confianza } }, extra, avisos }
//     campos: nit, dv, tipoDocumento, numeroId, primerApellido, segundoApellido, primerNombre, otrosNombres,
//             direccion, pais, departamento, municipio, email, telefono1, telefono2, actividadRut,
//             regimenIva, c3 (solo los que se encontraron y validaron; un valor con formato inválido se omite).
//       telefono1 = teléfono FIJO y telefono2 = CELULAR (instructivo del Excel): los números de las casillas 44
//       y 45 se ubican según su tipo, no según la casilla (el origen dice de qué casilla salió cada uno).
//       Si se leyeron teléfonos y ninguno es fijo (ni hay números irreconocibles), telefono1 = '0' (confianza
//       'media', origen 'Casilla 44/45 (sin teléfono fijo)'), como pide el instructivo.
//     Un RUT de PERSONA JURÍDICA no llena nada: ok:false, campos {} y sus datos van en extra.datosPersonaJuridica.
//     extra:  ver armar() (responsabilidades, actividades, telefonos, fechas, paginas, sugerencias, ...).
//     avisos: textos en español para la persona usuaria.
//   RutParser.dvNit(nit) -> string        dígito de verificación DIAN (módulo 11)
//   RutParser.RESPONSABILIDADES           casilla 53: código '05' → descripción oficial
//   RutParser.TIPOS_DOCUMENTO             casilla 25: código 13 → nombre DIAN
//   RutParser.leerHojaPrincipal(pagina)   lectura geométrica cruda de una hoja principal (pruebas/depuración)
//
// Geometría (RUT-REPORT §3–§7): coordenadas del PDF (y crece hacia arriba). Las etiquetas se buscan en el texto
// plegado de cada línea (con espacios opcionales entre letras: copias re-procesadas parten o pegan palabras); los
// valores se toman por regiones relativas a las etiquetas. Si falta una etiqueta de una fila, su x se estima con
// la geometría calibrada del formulario (igual en los formatos 2013-2016 y 2019+). Solo se lee la HOJA PRINCIPAL:
// las hojas 3 y 5 traen nombres y cédulas de otras personas (representantes, contador, revisor fiscal).
// Dependencias (se leen al momento de usarlas): root.PdfText (pdftext.js) y root.CATALOGOS (catalogos.js).
(function (root) {
  'use strict';

  const HOLGURA = 4;        // pt: un valor puede empezar hasta 4 pt a la izquierda de su etiqueta (real: 0.5–0.7)
  const SALTO_FILA = 4;     // pt: más que esto entre dos items (en y) = otro renglón de la región
  const TOL_HOLGADAS = [3.5, 5]; // pt: tolerancias de renglones para reintentar con líneas base desalineadas
  const HUECO_ETIQUETA = 12; // pt: hueco máximo entre los pedazos de una etiqueta (real: < 2 pt)
  const BANDA_LINEA = 5;    // pt: ± en y para un valor escrito en la misma línea de su etiqueta (real: hasta 1.05)

  // ---------------------------------------------------------------- tablas oficiales

  /** Casilla 53 — Responsabilidades, calidades y atributos (DIAN IN-CAC-0237 v3, 2025, §31). */
  const RESPONSABILIDADES = {
    '01': 'Aporte especial para la administración de justicia',
    '02': 'Gravamen a los movimientos financieros',
    '03': 'Impuesto al patrimonio',
    '04': 'Impuesto sobre la renta y complementarios – régimen tributario especial',
    '05': 'Impuesto sobre la renta y complementarios – régimen ordinario',
    '06': 'Ingresos y patrimonio',
    '07': 'Retención en la fuente a título de renta',
    '08': 'Retención timbre nacional',
    '09': 'Retención en la fuente en el impuesto sobre las ventas',
    '10': 'Obligado aduanero',
    '11': 'Ventas régimen común',
    '12': 'Ventas régimen simplificado',
    '13': 'Gran contribuyente',
    '14': 'Informante de exógena',
    '15': 'Autorretenedor',
    '16': 'Obligación facturar por ingresos bienes y/o servicios excluidos',
    '17': 'Profesionales de compra y venta de divisas',
    '18': 'Precios de transferencia',
    '19': 'Productor de bienes y/o servicios exentos (incluye exportadores)',
    '20': 'Obtención NIT',
    '21': 'Declarar ingreso o salida del país de divisas o moneda legal colombiana',
    '22': 'Obligado a cumplir deberes formales a nombre de terceros',
    '23': 'Agente de retención en ventas',
    '24': 'Declaración consolidada precios de transferencia',
    '26': 'Declaración individual precios de transferencia',
    '32': 'Impuesto nacional a la gasolina y al ACPM',
    '33': 'Impuesto nacional al consumo',
    '34': 'Régimen simplificado impuesto nacional consumo restaurantes y bares',
    '35': 'Impuesto sobre la renta para la equidad – CREE',
    '36': 'Establecimiento permanente',
    '37': 'Obligado a facturar electrónicamente',
    '38': 'Facturación electrónica voluntaria',
    '39': 'Proveedor de servicios tecnológicos PST',
    '40': 'Impuesto a la riqueza',
    '41': 'Declaración anual de activos en el exterior',
    '42': 'Obligado a llevar contabilidad',
    '45': 'Autorretenedor de rendimientos financieros',
    '46': 'IVA prestadores de servicios desde el exterior',
    '47': 'Régimen Simple de Tributación – SIMPLE',
    '48': 'Impuesto sobre las ventas – IVA',
    '49': 'No responsable de IVA',
    '50': 'No responsable de consumo restaurantes y bares',
    '51': 'Agente de retención impoconsumo de bienes inmuebles',
    '52': 'Facturador electrónico',
    '53': 'Persona jurídica no responsable de IVA',
    '54': 'Intercambio automático de información CRS',
    '55': 'Informante de beneficiarios finales',
    '56': 'Impuesto nacional al carbono',
    '58': 'Intercambio automático de información FATCA',
    '59': 'Autorretención especial renta',
    '60': 'Autorretención por intereses y rendimientos financieros de entidades vigiladas por la Superintendencia Financiera',
    '61': 'Autorretención por comisiones de entidades vigiladas por la Superintendencia Financiera',
    '62': 'Impuesto nacional sobre productos plásticos de un solo uso',
    '63': 'Impuesto a las bebidas ultraprocesadas azucaradas',
    '64': 'Impuesto a los productos comestibles ultraprocesados industrialmente y/o con alto contenido de azúcares, sodio o grasas saturadas',
    '65': 'Renta – Presencia económica significativa en Colombia (PES)',
    '66': 'Intercambio automático de información DPI',
  };

  /** Responsabilidades que la DIAN dejó de usar el 1 de enero de 2019 (reemplazadas por 48 y 49). */
  const INACTIVAS = { '11': '48', '12': '49' };

  /** Desde esta fecha existen el Régimen SIMPLE (47) y las responsabilidades 48/49 (Ley 1943 de 2018). */
  const INICIO_SIMPLE = '2019-01-01';

  /** Casilla 25 — Tipo de documento (DIAN IN-CAC-0237 v3, §8). */
  const TIPOS_DOCUMENTO = {
    11: 'Registro civil de nacimiento (NUIP)',
    12: 'Tarjeta de identidad',
    13: 'Cédula de ciudadanía',
    14: 'Certificado de la Registraduría para sucesiones ilíquidas',
    15: 'Documento que identifica una sucesión ilíquida',
    21: 'Tarjeta de extranjería',
    22: 'Cédula de extranjería',
    31: 'NIT',
    32: 'Tipo de documento desconocido',
    33: 'Identificación de extranjeros diferente al NIT asignado DIAN',
    41: 'Pasaporte',
    42: 'Documento de identificación extranjero',
    43: 'Sin identificación del exterior o para uso definido por la DIAN',
    44: 'Documento de identificación extranjero persona jurídica',
    46: 'Carné diplomático',
    47: 'Permiso Especial de Permanencia (PEP)',
    48: 'Permiso por Protección Temporal (PPT)',
    61: 'Patrimonio autónomo',
  };

  /** Casilla 24 — Tipo de contribuyente. */
  const TIPOS_CONTRIBUYENTE = { 1: 'Persona jurídica', 2: 'Persona natural o sucesión ilíquida' };

  /** Casilla 2 — Concepto. */
  const CONCEPTOS = { '01': 'Inscripción', '02': 'Actualización', '13': 'Actualización de oficio' };

  /** Indicativo de telefonía fija (plan de numeración 2021: 60 + indicativo anterior) por código DANE de departamento. */
  const INDICATIVOS = {
    601: ['11', '25'],
    602: ['19', '52', '76'],
    604: ['05', '23', '27'],
    605: ['08', '13', '20', '44', '47', '70', '88'],
    606: ['17', '63', '66'],
    607: ['54', '68', '81'],
    608: ['15', '18', '41', '50', '73', '85', '86', '91', '94', '95', '97', '99'],
  };

  // ---------------------------------------------------------------- etiquetas

  // Se buscan en texto plegado (minúsculas, sin tildes) con espacios opcionales entre TODAS las letras: las copias
  // re-procesadas parten palabras ("Segun" "do") o las pegan ("Númerode").
  const escapar = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suelto = (t) => t.replace(/\s+/g, '').split('').map(escapar).join('\\s*');
  const casilla = (n, fuente) => new RegExp(`\\b${suelto(String(n))}\\s*\\.\\s*${fuente}`);
  const alguna = (...textos) => `(?:${textos.map(suelto).join('|')})`;

  const ET = {
    concepto: casilla(2, suelto('concepto')),
    formulario: casilla(4, suelto('numero de formulario')),
    nit: casilla(5, suelto('numero de identificacion tributaria')),
    dv: casilla(6, suelto('dv')),
    seccional: casilla(12, suelto('direccion seccional')),
    buzon: casilla(14, suelto('buzon')),
    tipoContribuyente: casilla(24, suelto('tipo de contribuyente')),
    tipoDocumento: casilla(25, suelto('tipo de documento')),
    numeroId: casilla(26, suelto('numero de identificacion')),
    fechaExpedicion: casilla(27, `${suelto('fecha')}\\s*(?:${suelto('de')})?\\s*${suelto('expedicion')}`),
    lugarExpedicion: new RegExp(suelto('lugar de expedicion')),
    expDepartamento: casilla(29, suelto('departamento')),
    expMunicipio: casilla(30, suelto('ciudad')),
    primerApellido: casilla(31, suelto('primer apellido')),
    segundoApellido: casilla(32, suelto('segundo apellido')),
    primerNombre: casilla(33, suelto('primer nombre')),
    otrosNombres: casilla(34, suelto('otros nombres')),
    razonSocial: casilla(35, suelto('razon social')),
    nombreComercial: casilla(36, suelto('nombre comercial')),
    sigla: casilla(37, suelto('sigla')),
    pais: casilla(38, suelto('pais')),
    departamento: casilla(39, suelto('departamento')),
    municipio: casilla(40, suelto('ciudad')),
    direccion: casilla(41, suelto('direccion principal')),
    correo: casilla(42, suelto('correo electronico')),
    postal: casilla(43, alguna('codigo postal', 'apartado aereo')),
    telefono1: casilla(44, suelto('telefono 1')),
    telefono2: casilla(45, suelto('telefono 2')),
    act46: casilla(46, suelto('codigo')),
    act47: casilla(47, suelto('fecha inicio')),
    act48: casilla(48, suelto('codigo')),
    act49: casilla(49, suelto('fecha inicio')),
    act50: casilla(50, suelto('codigo')),
    act50corta: casilla(50, ''),
    act51: casilla(51, suelto('codigo')),
    act52: casilla(52, suelto('numero')),
    establecimientos: new RegExp(suelto('establecimientos')),
    resp53: casilla(53, suelto('codigo')),
    aduaneros: new RegExp(`${alguna('usuarios', 'obligados')}\\s*${suelto('aduaneros')}`),
    fecha61: casilla(61, suelto('fecha')),
    generacion: new RegExp(suelto('fecha generacion documento pdf')),
  };

  // x de las etiquetas de cada fila en el formulario (iguales en los formatos 2013-2016 y 2019+). Solo se usan
  // para ESTIMAR la etiqueta que no se encuentre, ajustadas (desplazamiento y escala) a las que sí se encontraron.
  const FILAS = {
    nit: { claves: ['nit', 'dv', 'seccional', 'buzon'], x: [27.5, 185.5, 205.5, 481.5] },
    identificacion: { claves: ['tipoContribuyente', 'tipoDocumento', 'numeroId', 'fechaExpedicion'], x: [27.5, 186.5, 308.5, 490.5] },
    lugar: { claves: ['lugarExpedicion', 'expDepartamento', 'expMunicipio'], x: [27.5, 218.5, 407.5] },
    nombres: { claves: ['primerApellido', 'segundoApellido', 'primerNombre', 'otrosNombres'], x: [27.5, 155.5, 282.5, 407.5] },
    razon: { claves: ['razonSocial'], x: [27.5] },
    comercial: { claves: ['nombreComercial', 'sigla'], x: [27.5, 346.5] },
    ubicacion: { claves: ['pais', 'departamento', 'municipio'], x: [27.5, 200.5, 392.5] },
    direccion: { claves: ['direccion'], x: [27.5] },
    contacto2019: { claves: ['postal', 'telefono1', 'telefono2'], x: [27.5, 201.5, 398.5] },
    contacto2013: { claves: ['correo', 'postal', 'telefono1', 'telefono2'], x: [27.5, 164.5, 268.5, 432.5] },
    actividades: { claves: ['act46', 'act47', 'act48', 'act49', 'act50', 'act51', 'establecimientos'], x: [37.0, 82.8, 171.0, 216.8, 301.5, 452.5, 531.7] },
  };

  /** Nombre de cada fila para los avisos de datos pegados entre casillas. */
  const NOMBRE_FILA = {
    identificacion: 'tipo y número de documento',
    lugar: 'lugar de expedición',
    nombres: 'apellidos y nombres',
    comercial: 'nombre comercial',
    ubicacion: 'país, departamento y municipio',
  };

  // ---------------------------------------------------------------- dependencias

  function pdfText() {
    if (root.PdfText) return root.PdfText;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { return require('./pdftext.js'); } catch (e) { /* sin PdfText */ }
    }
    throw new Error('RutParser necesita PdfText (src/js/pdftext.js) cargado antes.');
  }

  const catalogos = () => root.CATALOGOS || {};

  // ---------------------------------------------------------------- utilidades

  // Caracteres invisibles o de control que nunca son parte de un dato (los espacios se tratan aparte):
  // C0 (salvo tabulador y saltos de línea), DEL y C1, guion suave, ancho cero, marcas de dirección, separadores y BOM.
  const RANGOS_INVISIBLES = [[0x00, 0x08], [0x0e, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x202e],
    [0x2060, 0x2064], [0xfeff, 0xfeff]];
  const CLASE_INVISIBLES = '[' + RANGOS_INVISIBLES.map((r) => r.map((c) => String.fromCharCode(c)).join('-')).join('') + ']';
  const INVISIBLES = new RegExp(CLASE_INVISIBLES, 'g');
  const HAY_INVISIBLES = new RegExp(CLASE_INVISIBLES);

  const texto = (s) => String(s == null ? '' : s).normalize('NFC');
  const colapsar = (s) => texto(s).replace(/\s+/g, ' ').trim();
  /** Texto limpio para la salida: sin caracteres invisibles y con los espacios colapsados. */
  const limpiar = (s) => colapsar(texto(s).replace(INVISIBLES, ''));
  const soloDigitos = (s) => texto(s).replace(/\D+/g, '');
  const esItemDigitos = (it) => /^[\d\s]+$/.test(it.str);
  /** Item que es la etiqueta de una casilla ("45. Teléfono 2"): nunca es parte de un valor. */
  const esEtiquetaDeCasilla = (it) => /^\d+\s*\.\s*[A-Za-zÁÉÍÓÚáéíóú]/.test(it.str);
  const plegar = (s) => pdfText().fold(colapsar(s)); // minúsculas y sin tildes
  const media = (l) => l.reduce((s, v) => s + v, 0) / l.length;

  const NIVEL = { alta: 0, media: 1, baja: 2 };
  const peor = (a, b) => (!a ? b : !b ? a : (NIVEL[a] >= NIVEL[b] ? a : b));

  /** Fin "visible" de un item (sin espacios finales: algunos PDF rellenan los valores con espacios). */
  function x2Visible(it) {
    const n = it.str.length;
    const visibles = it.str.replace(/\s+$/, '').length;
    return n ? it.x + (it.w || 0) * (visibles / n) : it.x;
  }

  /**
   * Renglones de una región: un item con más de SALTO_FILA pt de diferencia vertical con el anterior abre otro
   * renglón (agrupación encadenada: tolera líneas base desalineadas). Cada renglón queda ordenado SOLO por x.
   */
  function filas(items) {
    const lista = (items || []).filter((i) => i && typeof i.str === 'string' && i.str.trim() !== '')
      .slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const out = [];
    let actual = null;
    let yPrevio = 0;
    for (const it of lista) {
      if (!actual || yPrevio - it.y > SALTO_FILA) {
        actual = [];
        out.push(actual);
      }
      actual.push(it);
      yPrevio = it.y;
    }
    return out.map((f) => f.sort((a, b) => a.x - b.x));
  }

  /** Items en orden de lectura robusto: renglón por renglón y, dentro de cada uno, por x. */
  const ordenar = (items) => [].concat(...filas(items));

  /** Texto de una región: cada renglón se une según los huecos (PdfText.unirTexto) y los renglones con espacio. */
  function textoDe(items) {
    const PT = pdfText();
    return colapsar(filas(items).map((f) => {
      const y = f[0].y; // misma línea base para que unirTexto no meta espacios por diferencias de y
      return PT.unirTexto(f.map((i) => Object.assign({}, i, { y })));
    }).join(' '));
  }

  const digitosDe = (items) => soloDigitos(ordenar(items).map((i) => i.str).join(''));

  /** { texto, codigo } de una celda que trae descripción + código en casillas (p. ej. "Cédula de Ciudadanía" + "1" "3"). */
  function textoYCodigo(items) {
    const textos = [];
    const codigos = [];
    for (const it of items || []) {
      if (esItemDigitos(it)) {
        codigos.push(it);
        continue;
      }
      // Descripción y código pegados en un item ("COLOMBIA 1 6 9"): el código son los dígitos del final.
      const m = /^(.*[^\d\s])\s+((?:\d\s*)+)$/.exec(it.str);
      if (!m) {
        textos.push(it);
        continue;
      }
      const ancho = it.str.length ? (it.w || 0) / it.str.length : 0;
      textos.push(Object.assign({}, it, { str: m[1], w: ancho * m[1].length, x2: it.x + ancho * m[1].length }));
      codigos.push(Object.assign({}, it, { str: m[2], x: it.x + ancho * (it.str.length - m[2].length) }));
    }
    return { texto: textoDe(textos), codigo: digitosDe(codigos) };
  }

  /**
   * Caracteres (no blancos) de unos items, cada uno con su x interpolada dentro del item y su centro cx. Sirve
   * para filas de dígitos en casillas que vienen pegados en un solo item (p. ej. NIT y DV juntos).
   */
  function caracteres(items) {
    const out = [];
    for (const it of items || []) {
      const s = it.str;
      const n = s.length;
      const ancho = n ? (it.w || 0) / n : 0;
      for (let k = 0; k < n; k++) {
        if (/\s/.test(s[k])) continue;
        out.push({ str: s[k], x: it.x + ancho * k, cx: it.x + ancho * (k + 0.5), y: it.y });
      }
    }
    return out;
  }

  /** Dígitos cuyo centro cae en [lo, hi), ordenados por x. */
  const digitosEntre = (chars, lo, hi) => chars.filter((c) => c.cx >= lo && c.cx < hi && /\d/.test(c.str))
    .sort((a, b) => a.x - b.x).map((c) => c.str).join('');

  /** 'aaaammdd' → 'aaaa-mm-dd' si es una fecha válida (1900..2100), si no ''. */
  function fechaIso(d) {
    const s = soloDigitos(d);
    if (s.length !== 8) return '';
    const a = Number(s.slice(0, 4)), m = Number(s.slice(4, 6)), di = Number(s.slice(6));
    const f = new Date(Date.UTC(a, m - 1, di));
    if (a < 1900 || a > 2100 || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== di) return '';
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  }

  const fechaLegible = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

  /** Fecha local de hoy (o de opts.hoy) como 'aaaa-mm-dd'. */
  function hoyIso(hoy) {
    if (typeof hoy === 'string' && /^\d{4}-\d{2}-\d{2}/.test(hoy)) return hoy.slice(0, 10);
    const d = hoy instanceof Date && !isNaN(hoy) ? hoy : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** Dígito de verificación DIAN (módulo 11) de un NIT. '' si no hay dígitos. */
  function dvNit(nit) {
    const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    const d = soloDigitos(nit).split('').reverse();
    if (!d.length || d.length > pesos.length) return '';
    let s = 0;
    d.forEach((c, i) => { s += Number(c) * pesos[i]; });
    const r = s % 11;
    return String(r > 1 ? 11 - r : r);
  }

  // ---------------------------------------------------------------- clasificación de páginas

  function clasificarBase(pagina) {
    const PT = pdfText();
    if (PT.DocDetect && typeof PT.DocDetect.clasificarPagina === 'function') return PT.DocDetect.clasificarPagina(pagina);
    // Respaldo (mismas reglas que DocDetect, RUT-REPORT §6.12).
    const out = { tipo: 'DESCONOCIDO', principal: false, hoja: null };
    if (!pagina || pagina.sinTexto || pagina.ilegible) return out;
    const c = PT.compactar(pagina.texto || '');
    const esRutPag = c.includes('numerodeidentificaciontributaria') &&
      ['fechageneraciondocumentopdf', 'parausoexclusivodeladian', 'direccionseccional'].some((a) => c.includes(a));
    if (!esRutPag) return out;
    const principal = /(?:^|[^0-9])24\.tipodecontribuyente/.test(c);
    const h = /hoja\s*([1-9])(?![0-9])/.exec(PT.fold(pagina.texto || ''));
    return { tipo: 'RUT', principal, hoja: principal ? 1 : (h ? Number(h[1]) : null) };
  }

  /**
   * Clasificación de DocDetect y, si no ve una hoja principal del RUT, una segunda mirada con renglones más tolerantes
   * (TOL_HOLGADAS): en copias con líneas base desalineadas las etiquetas partidas ("24." "Tipo de" "contribuyente")
   * caen en renglones distintos y la hoja principal pasaría por una de continuación.
   */
  function clasificar(pagina) {
    const c = clasificarBase(pagina);
    if ((c.tipo === 'RUT' && c.principal) || (c.tipo !== 'RUT' && c.tipo !== 'DESCONOCIDO')) return c;
    if (!pagina || pagina.sinTexto || pagina.ilegible || !Array.isArray(pagina.items)) return c;
    let mejor = c;
    for (const tol of TOL_HOLGADAS) {
      const lineas = pdfText().agruparLineas(pagina.items, tol);
      const texto = lineas.map((l) => l.texto).join(String.fromCharCode(10));
      const c2 = clasificarBase(Object.assign({}, pagina, { lineas, texto }));
      if (c2.tipo === 'RUT' && c2.principal) return c2;
      if (c2.tipo === 'RUT' && mejor.tipo !== 'RUT') mejor = c2;
    }
    return mejor;
  }

  /** Asegura una Pagina completa de PdfText (acepta páginas con solo `crudos` o items crudos de pdf.js). */
  function prepararPagina(p, indice) {
    if (p && Array.isArray(p.items) && Array.isArray(p.lineas)) return p;
    const pagina = pdfText().armarDoc([p || {}], null, { tolerante: true }).paginas[0];
    if (!(p && (p.numero || p.page || p.num))) pagina.numero = (indice || 0) + 1;
    return pagina;
  }

  /** Prepara y clasifica cada página sin dejar escapar excepciones (una página rota no tumba el resto). */
  function prepararTodas(doc, errores) {
    const fuente = (doc && Array.isArray(doc.paginas)) ? doc.paginas : [];
    const out = [];
    fuente.forEach((p, i) => {
      try {
        const pagina = prepararPagina(p, i);
        out.push(Object.assign({ pagina, orden: i }, clasificar(pagina)));
      } catch (e) {
        errores.push(`página ${i + 1}: ${String((e && e.message) || e)}`);
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- búsqueda de etiquetas

  /**
   * Buscador de etiquetas de una página. Devuelve { x, x2, y, linea, items } o null:
   *   1. en las líneas de PdfText;
   *   2. si no, en líneas más tolerantes (TOL_HOLGADAS): líneas base desalineadas parten etiquetas;
   *   3. si no, item por item: etiqueta pegada a un valor vecino ("…845. Teléfono 2" no tiene \b antes del 45).
   * x y x2 son los de la coincidencia DENTRO de sus items (una fila de etiquetas puede venir en un solo item) e y es
   * el promedio de los items de la coincidencia.
   */
  function crearBuscador(pagina) {
    const PT = pdfText();
    const I = pagina.items;
    const L = pagina.lineas;
    let holgadas = null;
    const cache = {};

    function ajustar(r) {
      const items = r.linea.items;
      const inicio = (it) => {
        const k = items.indexOf(it);
        return k < 0 ? 0 : PT.unirTexto(items.slice(0, k + 1)).length - it.str.length;
      };
      const ancho = (it) => (it.str.length ? (it.w || 0) / it.str.length : 0);
      const m = r.coincidencia;
      const primero = r.items[0];
      const ultimo = r.items[r.items.length - 1];
      const desde = Math.max(0, m.index - inicio(primero));
      const hasta = m.index + m[0].length - inicio(ultimo);
      const resto = ultimo.str.slice(Math.max(0, hasta));
      return {
        x: primero.x + desde * ancho(primero),
        // Si al item solo le sigue puntuación (":"), el fin es el del item; si trae más texto, se interpola.
        x2: /^[\s:.;,]*$/.test(resto) ? ultimo.x2 : ultimo.x + Math.max(0, hasta) * ancho(ultimo),
        y: media(r.items.map((i) => i.y)),
        // La etiqueta empieza a mitad de un item (fila de etiquetas pegada en un solo item): su x es una interpolación
        // que supone caracteres de ancho uniforme y no ve los huecos entre casillas, así que es solo aproximada.
        interpolada: primero.str.slice(0, desde).trim() !== '',
        linea: r.linea,
        items: r.items,
      };
    }

    // Una etiqueta real no tiene huecos grandes entre sus pedazos: si la coincidencia salta más de HUECO_ETIQUETA pt
    // es que tomó un dígito de un valor (p. ej. el "2" de "Teléfono 2" quedó en otro renglón y se usó un dígito del
    // número) y se descarta.
    const continua = (r) => r.items.every((it, i) => i === 0 || it.x - r.items[i - 1].x2 <= HUECO_ETIQUETA);
    function buscarEn(lineas, re) {
      const r = PT.buscarTodos(lineas, re).find(continua);
      return r ? ajustar(r) : null;
    }

    function buscar(re) {
      const r = buscarEn(L, re);
      if (r) return r;
      holgadas = holgadas || TOL_HOLGADAS.map((t) => PT.agruparLineas(I, t));
      for (const lineas of holgadas) {
        const h = buscarEn(lineas, re);
        if (h) return h;
      }
      for (const it of I) {
        const m = re.exec(PT.fold(it.str));
        if (!m || !m[0].length) continue;
        const sola = { y: it.y, items: [it], texto: it.str };
        const real = L.find((l) => l.items.includes(it)) || sola;
        return Object.assign(ajustar({ linea: sola, items: [it], coincidencia: m }), { linea: real });
      }
      return null;
    }

    return {
      etiqueta(clave) {
        if (!(clave in cache)) cache[clave] = buscar(ET[clave]);
        return cache[clave];
      },
      buscarEn,
    };
  }

  /**
   * x de cada etiqueta de una fila: la encontrada o, si falta, la estimada con la geometría calibrada (ajuste lineal
   * x = a + b·x_calibrada con las encontradas). { xs, y, estimadas } o null si no se encontró ninguna.
   */
  function ajustarFila(halladas, calib) {
    const encontradas = halladas.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
    if (!encontradas.length) return null;
    // Las etiquetas con x interpolada dentro de un item solo cuentan si no hay otras: si las hay, se estiman.
    const exactas = encontradas.filter((i) => !halladas[i].interpolada);
    const idx = exactas.length ? exactas : encontradas;
    let a;
    let b = 1;
    const mc = media(idx.map((i) => calib[i]));
    const mx = media(idx.map((i) => halladas[i].x));
    if (idx.length >= 2) {
      let num = 0, den = 0;
      for (const i of idx) {
        num += (calib[i] - mc) * (halladas[i].x - mx);
        den += (calib[i] - mc) * (calib[i] - mc);
      }
      b = den ? num / den : 1;
      if (!(b > 0.8 && b < 1.25)) b = 1; // alguna etiqueta fuera de lugar: solo desplazamiento
    }
    a = mx - b * mc;
    const ys = idx.map((i) => halladas[i].y).sort((p, q) => p - q);
    return {
      xs: halladas.map((h, i) => (idx.includes(i) ? h.x : a + b * calib[i])),
      y: ys[Math.floor(ys.length / 2)],
      estimadas: halladas.map((h, i) => !idx.includes(i) || !!h.interpolada),
    };
  }

  // ---------------------------------------------------------------- lectura geométrica de la hoja principal

  /**
   * Lee la hoja principal del RUT (sin validar ni mapear a catálogos). Devuelve los valores "tal cual"
   * (texto colapsado, dígitos) con los nombres de las casillas. Port de research/rut_parser_prototype.js.
   * d.calidad = { clave: 'media'|'baja' } marca lecturas dudosas (etiqueta estimada, valor pegado entre casillas).
   */
  function leerHojaPrincipal(paginaEntrada) {
    const PT = pdfText();
    const pagina = prepararPagina(paginaEntrada);
    const I = pagina.items;
    const B = crearBuscador(pagina);
    const lab = (clave) => B.etiqueta(clave);
    const R = (xLo, xHi, yLo, yHi) => PT.region(I, xLo, xHi, yLo, yHi);
    const d = { pagina: pagina.numero, calidad: {}, cruces: [] };
    const marcar = (claves, nivel) => claves.forEach((k) => { d.calidad[k] = peor(d.calidad[k], nivel); });
    const fila = (nombre) => ajustarFila(FILAS[nombre].claves.map(lab), FILAS[nombre].x);

    // Fila de valores debajo de una fila de etiquetas: cada columna va de su etiqueta a la siguiente (con HOLGURA).
    // Un item que se mete en la columna siguiente (valores pegados entre casillas) marca la fila como dudosa.
    function filaDebajo(nombre, banda) {
      const b = banda || [3, 16];
      const f = fila(nombre);
      if (!f) return null;
      const claves = FILAS[nombre].claves;
      const yLo = f.y - b[1], yHi = f.y - b[0];
      const regiones = f.xs.map((x, i) => R(x - HOLGURA, i + 1 < f.xs.length ? f.xs[i + 1] - HOLGURA : Infinity, yLo, yHi)
        .filter((it) => !esEtiquetaDeCasilla(it)));
      regiones.forEach((reg, i) => {
        // Una etiqueta estimada es el borde entre su columna y la anterior: ambas quedan con confianza media. Excepción:
        // la última de la fila sin nada debajo es una casilla que no existe en ese formato (la 27 en el de 2025).
        if (f.estimadas[i] && (i < f.xs.length - 1 || reg.length)) marcar(claves.slice(Math.max(0, i - 1), i + 1), 'media');
        if (i + 1 >= f.xs.length) return;
        if (reg.some((it) => x2Visible(it) > f.xs[i + 1] + 1)) {
          marcar([claves[i], claves[i + 1]], 'baja');
          if (NOMBRE_FILA[nombre] && !d.cruces.includes(nombre)) d.cruces.push(nombre);
        }
      });
      return regiones;
    }

    // ---- encabezado: 2, 4
    const l4 = lab('formulario');
    if (l4) d.numeroFormulario = digitosDe(R(l4.x2 + 1, Infinity, l4.y - BANDA_LINEA, l4.y + BANDA_LINEA));
    const l2 = lab('concepto');
    if (l2) d.concepto = textoYCodigo(R(l2.x2 + 1, l2.x + 269, l2.y - BANDA_LINEA, l2.y + BANDA_LINEA));

    // ---- 5 NIT, 6 DV, 12 seccional: los dígitos se reparten por su centro (pueden venir pegados en un item)
    const f5 = fila('nit');
    if (f5) {
      const [x5, x6, x12, x14] = f5.xs;
      const banda = I.filter((it) => it.y > f5.y - 18 && it.y < f5.y - 3);
      const chars = caracteres(banda.filter((it) => /\d/.test(it.str)));
      // El último dígito del NIT está ~7 pt a la izquierda de x6 + 2 y el DV ~7 pt a la derecha.
      d.nit = digitosEntre(chars, x5 - 2, x6 + 2);
      d.dv = digitosEntre(chars, x6 + 2, x12 - 1);
      if (f5.estimadas.slice(0, 3).some(Boolean) && (d.nit || d.dv)) marcar(['nit', 'dv'], 'media');
      const s = textoYCodigo(R(x12 - 2, x14 + 20, f5.y - 18, f5.y - 3));
      d.seccional = { texto: s.texto, codigo: s.codigo ? s.codigo.padStart(2, '0') : '' };
    }

    // ---- identificación: 24, 25, 26, 27
    const id = filaDebajo('identificacion');
    if (id) {
      d.tipoContribuyente = textoYCodigo(id[0]);
      d.tipoDocumento = textoYCodigo(id[1]);
      d.numeroIdentificacion = ordenar(id[2]).map((i) => i.str).join('').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      d.fechaExpedicion = fechaIso(digitosDe(id[3]));
    }

    // ---- lugar de expedición: 28, 29, 30
    const lugar = filaDebajo('lugar');
    if (lugar) d.expedicion = { pais: textoYCodigo(lugar[0]), departamento: textoYCodigo(lugar[1]), municipio: textoYCodigo(lugar[2]) };

    // ---- nombres: 31-34 (cada columna por su x: los apellidos pueden tener espacios, "DE LA HOZ")
    const nombres = filaDebajo('nombres');
    FILAS.nombres.claves.forEach((k, i) => { d[k] = nombres ? textoDe(nombres[i]) : ''; });
    const rs = filaDebajo('razon');
    d.razonSocial = rs ? textoDe(rs[0]) : '';
    const nc = filaDebajo('comercial');
    d.nombreComercial = nc ? textoDe(nc[0]) : '';
    d.sigla = nc ? textoDe(nc[1]) : '';

    // ---- ubicación: 38, 39, 40, 41
    const ub = filaDebajo('ubicacion');
    d.pais = ub ? textoYCodigo(ub[0]) : null;
    d.departamento = ub ? textoYCodigo(ub[1]) : null;
    d.municipio = ub ? textoYCodigo(ub[2]) : null;
    const dir = filaDebajo('direccion');
    d.direccion = dir ? textoDe(dir[0]) : '';

    // ---- 42-45: en el formato 2019+ el valor va a la DERECHA de la etiqueta; en 2013-2016, DEBAJO.
    const l42 = lab('correo'), l43 = lab('postal'), l44 = lab('telefono1'), l45 = lab('telefono2');
    const otra = [l43, l44, l45].find(Boolean);
    let formatoNuevo = false;
    if (l42 && otra) formatoNuevo = Math.abs(l42.y - otra.y) > 6; // 2019+: 13 pt; 2013-2016: misma línea
    else if (l43) formatoNuevo = l43.x < 100;
    else if (l44) formatoNuevo = l44.x < 240;
    const nombreContacto = formatoNuevo ? 'contacto2019' : 'contacto2013';
    const fc = ajustarFila(FILAS[nombreContacto].claves.map(lab), FILAS[nombreContacto].x);
    const xDe = (k) => {
      const i = FILAS[nombreContacto].claves.indexOf(k);
      return fc && i >= 0 ? fc.xs[i] : null;
    };
    const SIGUIENTE = { correo: formatoNuevo ? null : 'postal', postal: 'telefono1', telefono1: 'telefono2', telefono2: null };
    const tope = (k) => (SIGUIENTE[k] && xDe(SIGUIENTE[k]) != null ? xDe(SIGUIENTE[k]) : Infinity);
    const enLinea = (l, k) => (l ? R(l.x2 + 1, tope(k) - 1, l.y - BANDA_LINEA, l.y + BANDA_LINEA).filter((i) => !esEtiquetaDeCasilla(i)) : []);
    const debajo = (l, k) => (l ? R(l.x - HOLGURA, tope(k) - HOLGURA, l.y - 16, l.y - 3) : []);
    const valor = (l, k) => {
      const r = enLinea(l, k);
      return formatoNuevo || r.length ? r : debajo(l, k);
    };
    d.correo = textoDe(valor(l42, 'correo')).replace(/\s+/g, '');
    d.codigoPostal = digitosDe(valor(l43, 'postal'));
    d.codigoPostalEsApartadoAereo = !!(l43 && /apartado/.test(PT.compactar(l43.linea.texto)));
    d.telefono1 = digitosDe(valor(l44, 'telefono1'));
    d.telefono2 = digitosDe(valor(l45, 'telefono2'));

    // ---- 46-52: todos los códigos son dígitos sueltos en una fila; se reparten por el centro de cada dígito.
    const l46 = lab('act46');
    if (l46) {
      const banda = I.filter((it) => it.y > l46.y - 20 && it.y < l46.y - 6 && /^\d[\d\s]*$/.test(it.str));
      const chars = caracteres(banda);
      const tomar = (lo, hi) => digitosEntre(chars, lo, hi);
      // "50." y "Código" pueden quedar en renglones distintos, y "establecimientos" (52) aparece también en textos
      // libres: ambos se buscan solo en la franja de las etiquetas 46-52.
      const zona = R(-Infinity, Infinity, l46.y - 6, l46.y + 9);
      const franjas = [PT.TOL_LINEA || 2].concat(TOL_HOLGADAS).map((t) => PT.agruparLineas(zona, t));
      const enFranja = (re) => {
        for (const f of franjas) {
          const r = B.buscarEn(f, re);
          if (r) return r;
        }
        return null;
      };
      const halladas = FILAS.actividades.claves.map((k) => {
        if (k === 'act46') return l46;
        if (k === 'act50') return enFranja(ET.act50) || enFranja(ET.act50corta);
        if (k === 'establecimientos') {
          const e = enFranja(ET.establecimientos);
          if (e) return e;
          const n = enFranja(ET.act52);
          return n ? Object.assign({}, n, { x: n.x - 6.6 }) : null;
        }
        return enFranja(ET[k]);
      });
      const fa = ajustarFila(halladas, FILAS.actividades.x);
      const [, x47, x48, x49, x50, x51, x52] = fa.xs;
      const b47 = x47 - 6, b48 = x48 - 6, b49 = x49 - 6, b50 = x50 + 25, b51 = x51 - 6, b52 = x52;
      const otras = tomar(b50, b51);
      d.actividades = {
        principal: { codigo: tomar(-Infinity, b47), fechaInicio: fechaIso(tomar(b47, b48)) },
        secundaria: { codigo: tomar(b48, b49), fechaInicio: fechaIso(tomar(b49, b50 - 25)) },
        otras: otras ? otras.match(/.{1,4}/g) : [],
        ocupacion: tomar(b51, b52),
        numeroEstablecimientos: tomar(b52, Infinity),
      };
    }

    // ---- 53: (a) lista de descripciones "NN - texto" (1 o 2 columnas), (b) casillas de código numeradas.
    const l53 = lab('resp53');
    if (l53) {
      const lAdu = lab('aduaneros');
      const yFondo = lAdu && lAdu.y < l53.y ? lAdu.y + 3 : l53.y - 100;
      const lista = [];
      for (const renglon of filas(R(-Infinity, Infinity, yFondo, l53.y - 4))) {
        const t = ' ' + textoDe(renglon);
        const re = /\s(\d{1,2})\s*-\s*/g;
        const inicios = [];
        let m;
        while ((m = re.exec(t))) inicios.push({ codigo: m[1], desde: m.index, textoDesde: re.lastIndex });
        inicios.forEach((s, k) => {
          const fin = k + 1 < inicios.length ? inicios[k + 1].desde : t.length;
          lista.push({ codigo: s.codigo.padStart(2, '0'), texto: t.slice(s.textoDesde, fin).trim() });
        });
      }
      // Encabezado 1..26 (o 1..18 en 2013-2016) sobre la fila de códigos: el número está en el centro de su casilla.
      // Copias re-procesadas pueden partir "10" en "1" "0" (sin hueco): se vuelven a unir.
      const encabezado = [];
      for (const it of R(l53.x2, Infinity, l53.y + 6, l53.y + 18).filter((i) => /^\d{1,2}$/.test(i.str)).sort((a, b) => a.x - b.x)) {
        const prev = encabezado[encabezado.length - 1];
        if (prev && prev.str.length === 1 && it.str.length === 1 && it.x - prev.x2 < 0.8) {
          encabezado[encabezado.length - 1] = Object.assign({}, prev, { str: prev.str + it.str, w: it.x2 - prev.x, x2: it.x2 });
        } else encabezado.push(it);
      }
      const digitos = R(l53.x2, Infinity, l53.y - 5, l53.y + 3.5).filter((i) => /^\d[\d\s]*$/.test(i.str)).sort((a, b) => a.x - b.x);
      const casillas = new Map();
      if (encabezado.length >= 5) {
        const centro = (h) => h.x + (h.w || 3.3 * h.str.length) / 2;
        const paso = (centro(encabezado[encabezado.length - 1]) - centro(encabezado[0])) / (encabezado.length - 1);
        const borde0 = centro(encabezado[0]) - paso / 2;
        for (const dg of digitos) {
          const idx = Math.floor((dg.x - borde0 + 1) / paso);
          casillas.set(idx, (casillas.get(idx) || '') + soloDigitos(dg.str));
        }
      }
      d.responsabilidades = {
        lista,
        casillas: [...casillas.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.padStart(2, '0')),
      };
    }

    // ---- 61 y fecha de generación del PDF
    const l61 = lab('fecha61');
    if (l61) {
      const t = textoDe(R(l61.x2 + 1, Infinity, l61.y - BANDA_LINEA, l61.y + BANDA_LINEA));
      d.fecha61 = fechaIso(soloDigitos(t.split('/')[0]).slice(0, 8));
    }
    const lg = lab('generacion');
    if (lg) {
      // Renglón reconstruido alrededor de la etiqueta (las copias re-procesadas parten la fecha en pedazos:
      // "07" "-" "0" "2" "-" "202" "5"): se quita todo espacio después de la etiqueta.
      const t = textoDe(R(-Infinity, Infinity, lg.y - BANDA_LINEA, lg.y + BANDA_LINEA));
      const m = ET.generacion.exec(PT.fold(t)); // fold conserva la longitud: el índice sirve en t
      const resto = m ? t.slice(m.index + m[0].length).replace(/\s+/g, '').replace(/^:/, '') : '';
      const f = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:(\d{1,2}):(\d{2}):(\d{2})([AP])?\.?M?)?/i.exec(resto);
      if (f) {
        d.fechaGeneracion = fechaIso(f[3] + f[2].padStart(2, '0') + f[1].padStart(2, '0'));
        if (f[4]) {
          let h = Number(f[4]);
          if (f[7]) h = (h % 12) + (/p/i.test(f[7]) ? 12 : 0);
          d.horaGeneracion = `${String(h).padStart(2, '0')}:${f[5]}:${f[6]}`;
        }
      }
    }
    return d;
  }

  // ---------------------------------------------------------------- catálogos

  function buscarTipoDocumento(codigo, textoImpreso) {
    const lista = catalogos().tiposDocumento || [];
    if (codigo) {
      const e = lista.find((t) => Number(t.dian) === Number(codigo));
      if (e) return { entrada: e, por: 'codigo' };
    }
    if (!codigo && textoImpreso) {
      const f = plegar(textoImpreso);
      const e = lista.find((t) => plegar(t.nombre) === f);
      if (e) return { entrada: e, por: 'texto' };
    }
    return null;
  }

  const buscarPais = (codigo) => (catalogos().paises || []).find((p) => p.codigo === codigo) || null;
  const buscarDepartamento = (codigo) => (catalogos().departamentos || []).find((p) => p.codigo === codigo) || null;
  const buscarMunicipio = (depto, codigo) =>
    (catalogos().municipios || []).find((m) => m.codDepto === depto && m.codigo === codigo) || null;
  const buscarCiiu = (codigo) => (catalogos().ciiu || []).find((c) => c.codigo === codigo) || null;

  function nombreRegimen(nombre) {
    const r = (catalogos().regimenIva || []).find((x) => x.nombre === nombre);
    return r ? r.nombre : nombre;
  }

  function indicativoFijo(depto) {
    for (const [ind, deptos] of Object.entries(INDICATIVOS)) if (deptos.includes(depto)) return ind;
    return '601';
  }

  // ---------------------------------------------------------------- armado del resultado

  function campo(valor, origen, confianza, etiqueta) {
    const c = { valor: String(valor), origen, confianza: confianza || 'alta' };
    if (etiqueta) c.etiqueta = etiqueta;
    return c;
  }

  const NOMBRE_VALIDO = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .'-]*$/;
  const CORREO_VALIDO = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;

  /** Tipo de un número de teléfono del RUT: celular (3 + 9), fijo (60 + 8), fijo7 (numeración anterior a 2021) u otro. */
  function tipoTelefono(t) {
    if (/^3\d{9}$/.test(t)) return 'celular';
    if (/^60\d{8}$/.test(t)) return 'fijo';
    if (/^\d{7}$/.test(t)) return 'fijo7';
    return 'otro';
  }

  function responsabilidadesDe(d) {
    const r = d.responsabilidades || { lista: [], casillas: [] };
    const deLista = new Set(r.lista.map((x) => x.codigo));
    const deCasillas = new Set(r.casillas);
    const confiables = deLista.size > 0 && deCasillas.size > 0 && deLista.size === deCasillas.size &&
      [...deLista].every((c) => deCasillas.has(c));
    const todos = [...new Set([...deCasillas, ...deLista])].sort((a, b) => Number(a) - Number(b));
    const impreso = {};
    r.lista.forEach((x) => { if (!impreso[x.codigo]) impreso[x.codigo] = limpiar(x.texto); });
    const lista = todos.map((codigo) => ({
      codigo,
      descripcion: RESPONSABILIDADES[codigo] || impreso[codigo] || `Código ${codigo}`,
    }));
    return { lista, codigos: new Set(todos), confiables, leidas: todos.length > 0 };
  }

  function actividad(codigo, fechaInicio) {
    if (!codigo) return null;
    const c = buscarCiiu(codigo);
    const a = { codigo, descripcion: c ? c.descripcion : '' };
    if (fechaInicio !== undefined) a.fechaInicio = fechaInicio || '';
    return a;
  }

  /** Mapea la lectura cruda a campos del esquema + extra + avisos. */
  function armar(res, d, o) {
    const C = res.campos;
    const avisos = res.avisos;
    const avisosPrevios = avisos.length;
    const e = res.extra;
    const tc = d.tipoContribuyente || { texto: '', codigo: '' };
    const esPJ = tc.codigo === '1' || (!tc.codigo && /juridica/.test(plegar(tc.texto)));
    const esPN = tc.codigo === '2' || (!tc.codigo && /persona natural/.test(plegar(tc.texto)));
    const td = d.tipoDocumento || { texto: '', codigo: '' };
    const codTd = td.codigo ? td.codigo.padStart(2, '0') : '';
    const numId = d.numeroIdentificacion || '';

    // ---- 5 NIT y 6 DV
    let nit = d.nit || '';
    let dv = d.dv || '';
    // NIT y DV leídos pegados (sin DV aparte y el NIT = cédula + su DV): se separan.
    const separados = !dv && !!numId && nit.length === numId.length + 1 && nit.startsWith(numId) && nit.slice(-1) === dvNit(numId);
    if (separados) {
      dv = nit.slice(-1);
      nit = numId;
    }
    const dvCalculado = /^\d{1,15}$/.test(nit) ? dvNit(nit) : '';
    if (nit) {
      if (!/^\d{4,10}$/.test(nit)) {
        avisos.push(`El NIT que leímos en tu RUT («${nit}») no tiene entre 4 y 10 dígitos, así que no lo usamos. Escríbelo a mano.`);
      } else {
        const rangoOk = Number(nit) <= 3000000000;
        const dvValido = /^\d$/.test(dv);
        const dvOk = dvValido ? dv === dvCalculado : null;
        C.nit = campo(nit, 'Casilla 5', !rangoOk || dvOk === false ? 'baja' : (dvOk && !separados ? 'alta' : 'media'));
        if (dvValido) C.dv = campo(dv, 'Casilla 6', dvOk ? (separados ? 'media' : 'alta') : 'baja');
        if (!rangoOk) avisos.push('El NIT que leímos en tu RUT no parece válido (es mayor que 3.000.000.000). Revísalo.');
        if (dvOk === false) {
          avisos.push(`El dígito de verificación (DV) impreso en el RUT (${dv}) no coincide con el que corresponde al ` +
            `NIT (${dvCalculado}). Revisa que el PDF sea la copia original del RUT y verifica tu NIT y DV.`);
        } else if (!dv) {
          avisos.push(`No pudimos leer el dígito de verificación (DV) de tu RUT; según tu NIT debería ser ${dvCalculado}. Revísalo.`);
        } else if (!dvValido) {
          avisos.push(`El dígito de verificación (DV) que leímos en tu RUT («${dv}») no es válido; según tu NIT debería ser ` +
            `${dvCalculado}. Revísalo.`);
        }
      }
    }

    // ---- 25 tipo de documento y 26 número
    if (codTd || td.texto) {
      const t = buscarTipoDocumento(codTd, td.texto);
      if (t) {
        C.tipoDocumento = campo(t.entrada.nombre, 'Casilla 25', t.por === 'codigo' ? 'alta' : 'media', t.entrada.nombre.trim());
      } else if (!esPJ) {
        const nombre = TIPOS_DOCUMENTO[Number(codTd)] || limpiar(td.texto) || 'desconocido';
        avisos.push(`Tu tipo de documento en el RUT es «${nombre}»${codTd ? ` (código ${codTd})` : ''} y no está en la lista ` +
          'del formulario. Elige manualmente la opción que corresponda.');
      }
    }
    let nitIgualCedula = null;
    if (numId) {
      if (/^\d{1,10}$/.test(numId)) {
        const esCedula = codTd === '13';
        nitIgualCedula = esCedula && C.nit ? numId === C.nit.valor : null;
        C.numeroId = campo(numId, 'Casilla 26', nitIgualCedula === false ? 'baja' : 'alta');
        if (nitIgualCedula === false) {
          // No se sabe cuál de los dos está mal leído: ambos quedan por verificar.
          C.nit.confianza = 'baja';
          if (C.dv) C.dv.confianza = 'baja';
          avisos.push('En tu RUT el NIT (casilla 5) y el número de identificación (casilla 26) no coinciden. ' +
            'Para personas naturales con cédula deben ser iguales: revisa ambos datos.');
        }
      } else {
        avisos.push('Tu número de identificación en el RUT tiene letras o más de 10 dígitos, y el formulario solo acepta ' +
          'números: escríbelo a mano como corresponda.');
      }
    }

    // ---- 31-34 nombres (solo de la hoja principal)
    for (const [k, n] of [['primerApellido', 31], ['segundoApellido', 32], ['primerNombre', 33], ['otrosNombres', 34]]) {
      const crudo = d[k] || '';
      const v = limpiar(crudo).toUpperCase();
      if (v) C[k] = campo(v, `Casilla ${n}`, NOMBRE_VALIDO.test(v) && !HAY_INVISIBLES.test(crudo) ? 'alta' : 'media');
    }

    // ---- 41 dirección
    const direccion = limpiar(d.direccion).toUpperCase();
    if (direccion) C.direccion = campo(direccion, 'Casilla 41', HAY_INVISIBLES.test(d.direccion) ? 'media' : 'alta');

    // ---- 38-40 país, departamento, municipio
    let codDepto = '';
    let codDane = '';
    const codPais = d.pais && d.pais.codigo ? d.pais.codigo.padStart(3, '0') : '';
    const pais = codPais ? buscarPais(codPais) : null;
    if (pais) C.pais = campo(pais.nombre, 'Casilla 38', 'alta');
    else if (codPais || (d.pais && d.pais.texto)) {
      avisos.push(`No encontramos el país de tu RUT («${limpiar(d.pais && d.pais.texto) || codPais}») en la lista del formulario; selecciónalo a mano.`);
    }
    if (d.departamento && d.departamento.codigo) {
      codDepto = d.departamento.codigo.padStart(2, '0');
      const dep = buscarDepartamento(codDepto);
      if (dep) C.departamento = campo(dep.nombre, 'Casilla 39', 'alta');
      if (d.municipio && d.municipio.codigo) {
        const codMun = d.municipio.codigo.padStart(3, '0');
        codDane = codDepto + codMun;
        const mun = buscarMunicipio(codDepto, codMun);
        if (dep && mun) C.municipio = campo(mun.nombre, 'Casilla 40', 'alta');
        else {
          avisos.push(`No encontramos el municipio de tu RUT («${limpiar(d.municipio.texto) || codDane}», código DANE ${codDane}) ` +
            'en la lista del formulario; selecciónalo a mano.');
        }
      } else if (!dep) {
        avisos.push(`No encontramos el departamento de tu RUT (código ${codDepto}) en la lista del formulario; selecciónalo a mano.`);
      }
    }

    // ---- 42 correo
    const correo = limpiar(d.correo).replace(/\s+/g, '').toLowerCase();
    if (correo) {
      if (CORREO_VALIDO.test(correo)) C.email = campo(correo, 'Casilla 42', HAY_INVISIBLES.test(d.correo) ? 'media' : 'alta');
      else avisos.push('El correo electrónico que leímos en tu RUT no parece válido; escríbelo a mano.');
    }

    // ---- 44-45 teléfonos → telefono2 = celular, telefono1 = fijo (instructivo: "Teléfono 1 … si no tiene teléfono
    // fijo diligenciar 0; Teléfono 2, número de celular"). Se ubican por tipo, no por casilla.
    // "0" (sin teléfono) no es un número.
    const telefonos = [[44, d.telefono1], [45, d.telefono2]].filter(([, t]) => t && !/^0+$/.test(t)).map(([n, t]) => {
      const sinPais = /^57(3\d{9}|60\d{8})$/.test(t) ? t.slice(2) : t; // +57 delante
      return { casilla: n, numero: sinPais, tipo: tipoTelefono(sinPais), conIndicativoPais: sinPais !== t };
    });
    const celular = telefonos.find((t) => t.tipo === 'celular');
    const fijo = telefonos.find((t) => t.tipo === 'fijo') || telefonos.find((t) => t.tipo === 'fijo7');
    if (celular) C.telefono2 = campo(celular.numero, `Casilla ${celular.casilla}`, celular.conIndicativoPais ? 'media' : 'alta');
    if (fijo) {
      C.telefono1 = campo(fijo.numero, `Casilla ${fijo.casilla}`, fijo.tipo === 'fijo7' || fijo.conIndicativoPais ? 'media' : 'alta');
      if (fijo.tipo === 'fijo7') {
        const ind = indicativoFijo(codDepto);
        avisos.push(`El teléfono fijo de tu RUT (casilla ${fijo.casilla}) tiene 7 dígitos (numeración anterior a 2021). ` +
          `El formulario pide 10 dígitos: antepón el indicativo ${ind} (quedaría ${ind}${fijo.numero}).`);
      }
    }
    const otros = telefonos.filter((x) => x.tipo === 'otro');
    for (const t of otros) {
      avisos.push(`El teléfono de la casilla ${t.casilla} de tu RUT («${t.numero}») no es un celular ni un fijo de 10 dígitos, ` +
        'así que no lo usamos. Revísalo.');
    }
    if (!telefonos.length) {
      avisos.push('No encontramos teléfonos en tu RUT: escribe tu celular en «Teléfono 2» y tu teléfono fijo en «Teléfono 1» ' +
        '(o 0 si no tienes fijo).');
    } else {
      if (!celular) avisos.push('Tu RUT no trae un número de celular: escríbelo a mano en «Teléfono 2 (celular)».');
      if (!fijo && !otros.length) {
        // Se leyeron los teléfonos y ninguno es fijo: el instructivo pide 0 en «Teléfono 1».
        C.telefono1 = campo('0', 'Casilla 44/45 (sin teléfono fijo)', 'media', '0 — tu RUT no registra teléfono fijo');
        avisos.push('Tu RUT no registra teléfono fijo; dejamos 0 en Teléfono 1 como indica el formato. Cámbialo si tienes uno.');
      } else if (!fijo) {
        avisos.push('Tu RUT no trae un teléfono fijo: en «Teléfono 1» escribe tu fijo, o 0 si no tienes.');
      }
    }

    // ---- 46 actividad principal
    const act = d.actividades || {};
    const ciiu = act.principal && act.principal.codigo;
    if (ciiu) {
      if (!/^\d{4}$/.test(ciiu)) {
        avisos.push(`No pudimos leer bien la actividad principal de tu RUT (leímos «${ciiu}» y el código CIIU tiene 4 dígitos). ` +
          'Elige manualmente la actividad que corresponda.');
      } else {
        const c = buscarCiiu(ciiu);
        if (c) C.actividadRut = campo(ciiu, 'Casilla 46', 'alta', `${c.codigo} — ${c.descripcion}`);
        else {
          C.actividadRut = campo(ciiu, 'Casilla 46', 'baja');
          avisos.push(`La actividad principal de tu RUT (código ${ciiu}) no está en la lista de actividades del formulario. ` +
            'Elige manualmente la actividad que corresponda.');
        }
      }
    }

    // ---- 53 responsabilidades → régimen de IVA y C3 (Régimen SIMPLE)
    const resp = responsabilidadesDe(d);
    if (resp.leidas) {
      if (!resp.confiables) {
        avisos.push('No pudimos leer con certeza las responsabilidades de tu RUT (casilla 53). ' +
          'Revisa el régimen de IVA y la pregunta sobre el Régimen SIMPLE.');
      }
      const r48 = resp.codigos.has('48'), r49 = resp.codigos.has('49');
      if (r48 !== r49) {
        C.regimenIva = campo(nombreRegimen(r48 ? 'RESPONSABLE IVA' : 'NO RESPONSABLE IVA'),
          `Casilla 53 (código ${r48 ? '48' : '49'})`, resp.confiables ? 'alta' : 'media');
      } else if (r48 && r49) {
        avisos.push('Tu RUT tiene a la vez las responsabilidades 48 (IVA) y 49 (No responsable de IVA). Elige tu régimen de IVA a mano y actualiza tu RUT.');
      } else {
        avisos.push('Tu RUT no tiene la responsabilidad 48 (IVA) ni la 49 (No responsable de IVA). Elige tu régimen de IVA a mano.');
      }
      if (resp.confiables) {
        const r47 = resp.codigos.has('47');
        C.c3 = campo(r47 ? 'SI' : 'NO', `Casilla 53 (${r47 ? 'código 47' : 'sin código 47'})`, 'alta',
          r47 ? 'Sí — tu RUT tiene la responsabilidad 47 (Régimen Simple de Tributación)'
            : 'No — tu RUT no tiene la responsabilidad 47 (Régimen Simple de Tributación)');
      }
      const inactivas = resp.lista.filter((x) => INACTIVAS[x.codigo]);
      if (inactivas.length) {
        avisos.push(`Tu RUT tiene responsabilidades que la DIAN dejó de usar en 2019 (${inactivas.map((x) => `${x.codigo} – ${x.descripcion}`).join('; ')}). ` +
          'Te recomendamos actualizar tu RUT y descargar una copia nueva.');
      }
    } else if (!esPJ) {
      avisos.push('No encontramos responsabilidades en la casilla 53 de tu RUT. Elige tu régimen de IVA a mano.');
    }

    // ---- antigüedad del RUT: la casilla 53 describe la situación en la fecha en que se generó la copia.
    const generado = d.fechaGeneracion || '';
    if (!generado) {
      for (const k of ['c3', 'regimenIva']) if (C[k]) C[k].confianza = peor(C[k].confianza, 'media');
    } else {
      const hoy = hoyIso(o.hoy);
      const limite = (Number(hoy.slice(0, 4)) - 1) + hoy.slice(4);
      const viejo = generado < limite;
      if (viejo) {
        avisos.push(`Tu RUT fue generado el ${fechaLegible(generado)}, hace más de un año. Verifica que tu RUT esté ` +
          'actualizado: si algo cambió, descarga una copia reciente desde la DIAN.');
      }
      if (C.c3 && generado < INICIO_SIMPLE) {
        // Antes de 2019 no existía la responsabilidad 47: "sin 47" no dice nada sobre el Régimen SIMPLE.
        delete C.c3;
        avisos.push('Tu RUT es anterior a 2019, cuando aún no existía el Régimen Simple de Tributación: responde a mano la ' +
          'pregunta sobre el Régimen SIMPLE (C3).');
      } else if (viejo) {
        for (const k of ['c3', 'regimenIva']) if (C[k]) C[k].confianza = peor(C[k].confianza, 'media');
      }
    }

    // ---- lecturas dudosas (etiqueta estimada o valores pegados entre casillas)
    const idCampo = { correo: 'email', numeroId: 'numeroId' };
    for (const [k, nivel] of Object.entries(d.calidad || {})) {
      const c = C[idCampo[k] || k];
      if (c) c.confianza = peor(c.confianza, nivel);
    }
    if ((d.cruces || []).length) {
      avisos.push(`En tu RUT algunos datos quedaron pegados entre casillas vecinas (${d.cruces.map((f) => NOMBRE_FILA[f]).join('; ')}). ` +
        'Revísalos con cuidado antes de aplicarlos.');
    }

    // ---- extra
    e.esPersonaJuridica = esPJ;
    e.esPersonaNatural = esPN;
    e.tipoContribuyente = tc.codigo || tc.texto
      ? { codigo: tc.codigo, descripcion: TIPOS_CONTRIBUYENTE[Number(tc.codigo)] || limpiar(tc.texto) } : null;
    e.nitLeido = d.nit || '';
    e.dvLeido = d.dv || '';
    e.dvCalculado = dvCalculado;
    e.nitIgualCedula = nitIgualCedula;
    e.tipoDocumento = codTd || td.texto ? { codigo: codTd, descripcion: TIPOS_DOCUMENTO[Number(codTd)] || limpiar(td.texto) } : null;
    e.numeroIdentificacion = numId;
    if (esPN) {
      e.nombreCompleto = ['primerApellido', 'segundoApellido', 'primerNombre', 'otrosNombres']
        .map((k) => (C[k] ? C[k].valor : '')).filter(Boolean).join(' ');
    }
    e.razonSocial = limpiar(d.razonSocial);
    e.nombreComercial = limpiar(d.nombreComercial);
    e.sigla = limpiar(d.sigla);
    e.fechaExpedicion = d.fechaExpedicion || '';
    if (d.expedicion) {
      const x = d.expedicion;
      const cp = x.pais.codigo ? x.pais.codigo.padStart(3, '0') : '';
      const cd = x.departamento.codigo ? x.departamento.codigo.padStart(2, '0') : '';
      const cm = x.municipio.codigo ? x.municipio.codigo.padStart(3, '0') : '';
      const p = cp ? buscarPais(cp) : null, dp = cd ? buscarDepartamento(cd) : null, mn = cd && cm ? buscarMunicipio(cd, cm) : null;
      e.lugarExpedicion = (cp || cd || cm || x.pais.texto) ? {
        pais: p ? p.nombre : limpiar(x.pais.texto), departamento: dp ? dp.nombre : limpiar(x.departamento.texto),
        municipio: mn ? mn.nombre : limpiar(x.municipio.texto), codigoPais: cp, codigoDepartamento: cd, codigoMunicipio: cm,
      } : null;
    } else e.lugarExpedicion = null;
    e.ubicacion = {
      pais: codPais ? { codigo: codPais, nombre: pais ? pais.nombre : limpiar(d.pais && d.pais.texto) } : null,
      departamento: codDepto ? { codigo: codDepto, nombre: C.departamento ? C.departamento.valor : limpiar(d.departamento.texto) } : null,
      municipio: codDane ? { codigo: codDane.slice(2), nombre: C.municipio ? C.municipio.valor : limpiar(d.municipio.texto) } : null,
      codigoDane: codDane,
      codigoPostal: d.codigoPostal || '',
      codigoPostalEsApartadoAereo: !!d.codigoPostalEsApartadoAereo,
    };
    e.telefonos = telefonos.map((t) => ({ casilla: t.casilla, numero: t.numero, tipo: t.tipo }));
    e.responsabilidades = resp.lista;
    e.responsabilidadesConfiables = resp.confiables;
    e.actividades = {
      principal: act.principal ? actividad(act.principal.codigo, act.principal.fechaInicio) : null,
      secundaria: act.secundaria ? actividad(act.secundaria.codigo, act.secundaria.fechaInicio) : null,
      otras: (act.otras || []).map((c) => actividad(c)),
      ocupacion: act.ocupacion || '',
      numeroEstablecimientos: act.numeroEstablecimientos || '',
    };
    e.fechaGeneracion = d.fechaGeneracion || '';
    e.horaGeneracion = d.horaGeneracion || '';
    e.fecha61 = d.fecha61 || '';
    e.numeroFormulario = d.numeroFormulario || '';
    const codConcepto = d.concepto && d.concepto.codigo ? d.concepto.codigo.padStart(2, '0') : '';
    e.concepto = d.concepto && (codConcepto || d.concepto.texto)
      ? { codigo: codConcepto, descripcion: CONCEPTOS[codConcepto] || limpiar(d.concepto.texto) } : null;
    e.seccional = d.seccional && (d.seccional.codigo || d.seccional.texto)
      ? { codigo: d.seccional.codigo, nombre: limpiar(d.seccional.texto) } : null;
    e.sugerencias = {};
    if (resp.leidas) {
      e.sugerencias.declaranteRenta = resp.codigos.has('05');
      e.sugerencias.regimenSimple = resp.codigos.has('47');
    }

    // Un RUT de persona jurídica es el documento equivocado: no se llena nada (este formulario es solo para personas
    // naturales). Sus datos quedan en extra como referencia y el único aviso de esta hoja es el de persona jurídica.
    if (esPJ) {
      const datos = {};
      for (const [k, c] of Object.entries(C)) {
        if (k !== 'c3') datos[k] = Object.assign({}, c, { confianza: 'baja' });
        delete C[k];
      }
      e.datosPersonaJuridica = datos;
      avisos.splice(avisosPrevios);
      avisos.unshift('Este RUT es de una persona jurídica (empresa o entidad) y este formulario es solo para personas ' +
        'naturales, así que no tomamos ningún dato de él. Sube tu RUT personal o llena el formulario a mano.');
    }
  }

  // ---------------------------------------------------------------- API

  /** ¿Alguna página del Doc es del RUT? (nunca lanza excepciones) */
  function esRut(doc) {
    try {
      return prepararTodas(doc, []).some((c) => c.tipo === 'RUT');
    } catch (e) {
      return false;
    }
  }

  const NO_ES_RUT = 'No encontramos un RUT en este PDF. Descarga tu RUT directamente del portal de la DIAN (servicios en línea ' +
    'MUISCA, opción «Copia del RUT») y súbelo tal cual. Si prefieres, puedes continuar llenando el formulario a mano.';

  function motivoSinHojaPrincipal(doc, paginas, paginasRut) {
    const PT = pdfText();
    if (paginasRut.length) {
      return 'Encontramos hojas de un RUT, pero no la hoja principal (la primera, con tus datos de identificación). ' +
        'Sube la copia completa del RUT tal como la descargas de la DIAN.';
    }
    // Sin páginas (Doc vacío o inválido) no se puede decir que sea una imagen: mensaje general.
    if (!paginas.length) return NO_ES_RUT;
    if (paginas.some((p) => p.ilegible) || (doc && doc.problema === 'TEXTO_ILEGIBLE')) return PT.mensajeError('TEXTO_ILEGIBLE', 'RUT');
    if (paginas.every((p) => p.sinTexto)) return PT.mensajeError('SIN_TEXTO', 'RUT');
    return NO_ES_RUT;
  }

  /** ¿El documento que escribió la persona (solo dígitos) es el de esta hoja? Acepta el NIT con el DV pegado. */
  function coincideDocumento(d, esperado) {
    if (!esperado) return false;
    return esperado === d.nit || esperado === d.numeroIdentificacion || (!!d.nit && !!d.dv && esperado === d.nit + d.dv);
  }

  /** Elige la hoja principal: la del documento esperado, luego persona natural, luego la generada más reciente. */
  function elegir(candidatos, esperado) {
    const puntaje = (c) => {
      let p = 0;
      if (coincideDocumento(c.d, esperado)) p += 4;
      if (c.d.tipoContribuyente && c.d.tipoContribuyente.codigo === '2') p += 2;
      if (c.d.nit) p += 1;
      return p;
    };
    return candidatos.slice().sort((a, b) => puntaje(b) - puntaje(a) ||
      String(b.d.fechaGeneracion || '').localeCompare(String(a.d.fechaGeneracion || '')) ||
      a.orden - b.orden)[0];
  }

  function parseInterno(doc, o, res) {
    const errores = [];
    const clasif = prepararTodas(doc, errores);
    const paginas = clasif.map((c) => c.pagina);
    const rut = clasif.filter((c) => c.tipo === 'RUT');
    const principales = rut.filter((c) => c.principal);
    res.extra.paginas = {
      total: (doc && doc.numPaginas) || (doc && Array.isArray(doc.paginas) ? doc.paginas.length : 0),
      principal: null,
      rut: rut.map((c) => ({ pagina: c.pagina.numero, hoja: c.hoja })),
    };
    if (errores.length) res.extra.errores = errores;
    if (!principales.length) {
      res.avisos.push(motivoSinHojaPrincipal(doc, paginas, rut));
      return res;
    }

    const candidatos = [];
    for (const c of principales) {
      try {
        candidatos.push({ orden: c.orden, numero: c.pagina.numero, d: leerHojaPrincipal(c.pagina) });
      } catch (e) {
        res.extra.errores = (res.extra.errores || []).concat(String((e && e.message) || e));
      }
    }
    if (!candidatos.length) {
      res.avisos.push('No pudimos leer la hoja principal de tu RUT. Puedes continuar llenando el formulario a mano.');
      return res;
    }
    const esperado = soloDigitos(o.documentoEsperado);
    const elegido = elegir(candidatos, esperado);
    const d = elegido.d;
    res.extra.paginas.principal = elegido.numero;

    if (esperado && d.nit && !coincideDocumento(d, esperado)) {
      res.avisos.push(`Este RUT es del documento ${d.numeroIdentificacion || d.nit} y no coincide con el ` +
        `número que ya está en el formulario (${esperado}). Verifica que sea tu RUT.`);
    }
    const nits = [...new Set(candidatos.map((c) => c.d.nit).filter(Boolean))];
    if (nits.length > 1) {
      const coincide = coincideDocumento(d, esperado);
      res.avisos.push(`Este PDF trae ${nits.length} RUT de personas distintas; usamos el de la página ${elegido.numero}` +
        `${coincide ? ', que coincide con el número que ya está en el formulario' : ''}. Verifica que sea el tuyo.`);
    }

    armar(res, d, o);
    const enBlanco = !d.nit && !d.primerApellido && !d.primerNombre && !d.razonSocial;
    res.ok = Object.keys(res.campos).length > 0 && !enBlanco;
    if (enBlanco) {
      res.campos = {};
      res.avisos.length = 0;
      res.avisos.push('Este PDF es el formulario del RUT sin diligenciar (no trae NIT ni nombres). Descarga la copia de tu ' +
        'RUT desde el portal de la DIAN (servicios en línea MUISCA, opción «Copia del RUT») y súbela.');
    }
    if (esperado && d.nit) res.extra.coincideDocumentoEsperado = coincideDocumento(d, esperado);
    return res;
  }

  /** Lee el RUT del Doc. Ver el encabezado del archivo para el contrato. Nunca lanza excepciones. */
  function parse(doc, opts) {
    const o = opts || {};
    const res = { tipo: 'RUT', ok: false, campos: {}, extra: {}, avisos: [] };
    try {
      return parseInterno(doc, o, res);
    } catch (e) {
      return {
        tipo: 'RUT',
        ok: false,
        campos: {},
        extra: Object.assign(res.extra, { errores: (res.extra.errores || []).concat(String((e && e.message) || e)) }),
        avisos: ['No pudimos leer este PDF. Puedes continuar llenando el formulario a mano.'],
      };
    }
  }

  const RutParser = {
    esRut,
    parse,
    dvNit,
    leerHojaPrincipal,
    RESPONSABILIDADES,
    TIPOS_DOCUMENTO,
    TIPOS_CONTRIBUYENTE,
  };

  root.RutParser = RutParser;
  if (typeof module !== 'undefined' && module.exports) module.exports = RutParser;
})(typeof window !== 'undefined' ? window : globalThis);
