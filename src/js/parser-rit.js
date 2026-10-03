// window.RitParser — lee el certificado RIT (Registro de Información Tributaria) de la Secretaría
// Distrital de Hacienda de Bogotá: reporte JasperReports "ReporteCertificadoRIT", pie "Fuente: RIT-SHD" /
// "Version 2.02" (formato único observado de 2020 a diciembre de 2025).
//
// Contrato (SPEC → "Module contracts" → RitParser):
//   RitParser.esRit(doc) -> boolean            ¿hay al menos una página de certificado RIT?
//   RitParser.parse(doc, opts?) -> Resultado   { tipo: 'RIT', ok, campos, extra, avisos }  (nunca lanza)
//     doc: Doc de PdfText.leer (también acepta un volcado { pages|paginas, info } con items crudos de pdf.js).
//     opts.documentoEsperado  cédula/NIT del RUT o escrito por la persona: elige el RIT correcto en un
//                             paquete con varios certificados y avisa si el RIT es de otro documento (o si
//                             no se pudo leer el documento del RIT para compararlo).
//     opts.actividadRut       CIIU del RUT (casilla 46), opcional: si coincide con otra actividad del RIT
//                             y no con la actividad 1, la principal queda con confianza 'media'.
//     opts.hoy                Date | 'aaaa-mm-dd' (pruebas); por defecto la fecha local de hoy.
//     opts.diasVigencia       antigüedad (días) a partir de la cual se avisa; 90 por defecto.
//   RitParser.candidatosDesdeCiiu(ciiu) -> [{ codigo, descripcion, tarifa, agrupacion }]
//     el código exacto String(Number(ciiu)) si existe en CATALOGOS.rit, seguido de sus hijos de 5 dígitos
//     (8559 → 8559, 85591, 85592; 7490 → 74901, 74902); [] si no hay ninguno o si ciiu no es un código
//     (solo dígitos, 1 a 6).
//   RitParser.buscarActividad(codigo) -> entrada de CATALOGOS.rit ({ codigo: number, agrupacion, descripcion,
//     tarifa }) | null. Acepta un entero o un texto de 1 a 6 dígitos ('0111', '111', 111); cualquier otra
//     cosa ('1.11', '6201abc') → null.
//
// campos: solo `actividadRit` (String(Number(código)) que existe en CATALOGOS.rit) de la actividad PRINCIPAL
//   (la "Actividad 1", por convención de Hacienda). La identificación NO va a campos: la fuente de verdad
//   es el RUT; queda en extra.contribuyente para cruzarla. Confianza: 'alta' salvo
//     'media' → código antiguo actualizado (85511 → 85591), actividad 1 vacía, el CIIU del RUT coincide con
//               otra actividad, RIT con fecha de cese, documento del RIT ilegible con documentoEsperado;
//     'baja'  → RIT de otro documento, PDF con indicios de edición, actividad 1 con texto pero sin código
//               legible (se toma la siguiente).
// extra: contribuyente, actividades (todas las impresas), dirección, teléfono, correo (solo si es válido y
//   no está recortado), ciudad, departamento (la etiqueta «Municipio:» del certificado trae el
//   departamento), naturaleza jurídica, régimen (poco confiable), fechas, indicios de edición, páginas.
//   extra.actividades[].codigo es el código PARA EL FORMULARIO: el del catálogo, o el sugerido cuando el
//   impreso es un código antiguo (codigoImpreso conserva el impreso); si no se pudo resolver queda el
//   impreso normalizado con enCatalogo=false y codigoFormulario=null (no es un valor válido del campo).
//
// Dependencias (leídas al momento de usarlas desde root): CATALOGOS (rit, departamentos, municipios,
// tiposDocumento), PdfText (armarDoc, fold) y DocDetect (clasificarPagina). Funciona sin ellas, con
// menos verificaciones.
//
// Geometría (informe RIT-BOGOTA §2): espacio de usuario del PDF, y crece hacia arriba. El orden de los
// items en el PDF no es el de lectura: todo se ordena por geometría. Etiqueta y valor pueden venir en el
// mismo item ("Fecha:18/08/2020", "Matrícula Mercantil:NO"); un PDF editado o re-procesado parte textos en
// varios items (se unen si el hueco es menor que ~1/3 de la altura de letra, con espacio si el hueco es
// > 0,8 pt). Las etiquetas se buscan en el texto de la fila (aunque vengan partidas en varios bloques) y el
// valor se asigna por geometría (misma fila ± 0,35·h, a la derecha, antes de la siguiente etiqueta), así
// que un certificado escalado (impreso como PDF en carta) o con pequeños desplazamientos se lee igual.
// Las tablas ESTABLECIMIENTOS / REPRESENTANTES ACTIVOS (datos de terceros) nunca se leen.
(function (root) {
  'use strict';

  // Medidas en pt. Las relativas (_REL) se multiplican por la altura de letra h del item.
  const TOL_Y = 2.5;                 // tolerancia vertical de una línea de texto de la página
  const HUECO_UNION = 1.5;           // hueco máximo para unir items en un bloque si no se conoce h
  const UNION_REL = 0.36;            // hueco máximo para unir items: un espacio ≈ 0,28·h; la columna más
                                     //   cercana de la plantilla («Ciudad:» → valor) está a 0,47·h
  const HUECO_ESPACIO = 0.8;         // al unir items se pone un espacio si el hueco es mayor (como PdfText)
  const FILA_REL = 0.35;             // misma fila: el valor queda ~1 pt por encima de su etiqueta
  const PASO_REL = 1.9;              // distancia máxima del valor a su línea de continuación (≈ 1,15·h)
  const X_CONT_REL = 0.3;            // la continuación empieza en la x del valor (± esto, mínimo 3 pt)
  const MARGEN_CORREO_REL = 0.33;    // correo que termina a menos de esto de «Ciudad:» = posiblemente recortado
  const MARGEN_DIRECCION_REL = 0.83; // dirección que termina a menos de esto de «Teléfonos:»
  const X_FIN_CORREO = 331;          // respaldo absoluto si la fila no tiene «Ciudad:» (x=335 a 12 pt)
  const X_FIN_DIRECCION = 437;       // respaldo absoluto si la fila no tiene «Teléfonos:» (x=447)
  const DIAS_VIGENCIA = 90;
  const FECHA_MIGRACION = '2018-02-28'; // fecha de inscripción ficticia puesta por la migración de 2018

  // ---------------------------------------------------------------- texto

  const MARCAS = /[\u0300-\u036f]/g;
  const ESPACIOS_RAROS = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
  const GUIONES = '\\-\u2010\u2011\u2012\u2013\u2014\u2212';

  /** Texto plegado: minúsculas sin tildes, misma longitud que el original NFC (como PdfText.fold). */
  function fold(s) {
    const pt = root.PdfText;
    if (pt && typeof pt.fold === 'function') return pt.fold(s);
    const t = String(s == null ? '' : s).normalize('NFC');
    let out = '';
    for (const c of t) {
      const f = c.normalize('NFD').replace(MARCAS, '').toLowerCase().replace(ESPACIOS_RAROS, ' ');
      out += f.length === c.length ? f : c;
    }
    return out;
  }

  /** NFC, espacios raros → ' ', espacios colapsados, sin bordes. */
  function limpiar(s) {
    return String(s == null ? '' : s).normalize('NFC').replace(ESPACIOS_RAROS, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Clave de comparación: plegado, solo letras y dígitos separados por un espacio. */
  function clave(s) {
    return fold(limpiar(s)).replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /** clave() sin espacios: tolera palabras partidas o pegadas. */
  const claveCompacta = (s) => clave(s).replace(/\s+/g, '');

  const soloDigitos = (s) => String(s == null ? '' : s).replace(/\D/g, '');

  /**
   * Código de actividad normalizado como en el formulario: String(Number(código)); '' si no es un código
   * (solo se acepta un entero positivo o un texto de 1 a 6 dígitos con espacios alrededor).
   */
  function normCodigo(c) {
    if (typeof c === 'number') return Number.isInteger(c) && c > 0 && c < 1e6 ? String(c) : '';
    const m = /^\s*(\d{1,6})\s*$/.exec(String(c == null ? '' : c));
    return m && Number(m[1]) > 0 ? String(Number(m[1])) : '';
  }

  /** Número de documento comparable: mayúsculas y dígitos; si es numérico, sin ceros a la izquierda. */
  function normDoc(v) {
    const s = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^\d+$/.test(s) ? s.replace(/^0+/, '') : s;
  }

  // ---------------------------------------------------------------- fechas

  const RE_FECHA = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/;

  /** 'dd/mm/aaaa' (en cualquier parte del texto) → 'aaaa-mm-dd' si es una fecha real; si no, null. */
  function fechaISO(s) {
    const m = RE_FECHA.exec(String(s || ''));
    if (!m) return null;
    const d = Number(m[1]);
    const mes = Number(m[2]);
    const a = Number(m[3]);
    const f = new Date(Date.UTC(a, mes - 1, d));
    if (a < 1900 || f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
    return `${m[3]}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /** 'aaaa-mm-dd' → 'dd/mm/aaaa' (para los avisos). */
  const fechaTexto = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
  const esISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

  function hoyISO(hoy) {
    if (typeof hoy === 'string' && /^\d{4}-\d{2}-\d{2}/.test(hoy)) return hoy.slice(0, 10);
    const d = hoy instanceof Date && !isNaN(hoy) ? hoy : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const diaUTC = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const diasEntre = (desde, hasta) => Math.round((diaUTC(hasta) - diaUTC(desde)) / 86400000);

  /** Fecha (aaaa-mm-dd) de una fecha PDF "D:20240401084752-05'00'", en la hora local del archivo. */
  function fechaDeMetadato(s) {
    const m = /^(?:D:)?(\d{4})(\d{2})(\d{2})/.exec(String(s || '').trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  // Valores que significan "no hay" en una casilla de fecha o de matrícula.
  const RE_VACIO = /^(no|n\s*\/?\s*a|-+|ningun[ao]?|0+\s*\/\s*0+\s*\/\s*0+)$/;

  // ---------------------------------------------------------------- DV (DIAN, módulo 11)

  function dvNit(nit) {
    const n = soloDigitos(nit);
    if (!n || n.length > 15) return '';
    const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    let suma = 0;
    for (let i = 0; i < n.length; i++) suma += Number(n[n.length - 1 - i]) * pesos[i];
    const r = suma % 11;
    return String(r > 1 ? 11 - r : r);
  }

  // ---------------------------------------------------------------- documento y páginas

  function normalizarItemCrudo(it) {
    const t = Array.isArray(it.transform) ? it.transform : null;
    const x = Number(t ? t[4] : it.x) || 0;
    const y = Number(t ? t[5] : it.y) || 0;
    const w = Number(it.width != null ? it.width : it.w) || 0;
    return { str: String(it.str).normalize('NFC'), x, y, w, h: Number(it.height != null ? it.height : it.h) || 0, x2: x + w, font: it.fontName || it.font || '' };
  }

  const conTexto = (it) => it && typeof it.str === 'string' && it.str.trim() !== '';
  const aItem = (it) => (typeof it.x2 === 'number' ? it : normalizarItemCrudo(it));
  const ordenLectura = (a, b) => b.y - a.y || a.x - b.x;
  const porX = (a, b) => a.x - b.x;

  /**
   * Devuelve un Doc con páginas { numero, items, lineas, texto }. Acepta un Doc de PdfText, un arreglo de
   * páginas o un volcado { pages|paginas, info } (items crudos de pdf.js). Usa PdfText.armarDoc si existe.
   */
  function normalizarDoc(doc) {
    if (!doc || typeof doc !== 'object') return { paginas: [], info: {} };
    const listo = Array.isArray(doc.paginas) && doc.paginas.every((p) => p && Array.isArray(p.items) && Array.isArray(p.lineas));
    if (listo) return doc;
    const paginas = Array.isArray(doc) ? doc : (doc.paginas || doc.pages || []);
    const info = Array.isArray(doc) ? {} : (doc.info || {});
    const pt = root.PdfText;
    if (pt && typeof pt.armarDoc === 'function') return pt.armarDoc(paginas, info, { tolerante: true });
    return {
      info,
      paginas: (Array.isArray(paginas) ? paginas : []).map((p, i) => {
        const crudos = (p && (p.crudos || p.items)) || [];
        const items = (Array.isArray(crudos) ? crudos : []).filter(conTexto).map(aItem);
        const lineas = construirLineas(items).map((l) => ({ y: l.y, texto: l.texto }));
        return { numero: Number((p && (p.numero || p.page)) || i + 1), items, lineas, texto: lineas.map((l) => l.texto).join('\n') };
      }),
    };
  }

  /** Hueco máximo entre dos items para que formen un solo bloque. */
  function umbralUnion(h1, h2) {
    const hs = [h1, h2].filter((h) => h > 0);
    return hs.length ? Math.max(1, UNION_REL * Math.min.apply(null, hs)) : HUECO_UNION;
  }

  // Caracteres que no llevan espacio entre sí aunque haya un hueco pequeño (fechas, códigos, números, correos).
  const PEGABLE = /[\d/.@_-]/;

  /** Separador al unir dos textos contiguos: '' si se tocan (≤ 0,8 pt) o si son cifras/puntuación; si no, ' '. */
  function separador(previo, siguiente, hueco, h) {
    if (!(hueco > HUECO_ESPACIO)) return '';
    const a = String(previo).slice(-1);
    const b = String(siguiente).charAt(0);
    return PEGABLE.test(a) && PEGABLE.test(b) && hueco < umbralUnion(h, h) ? '' : ' ';
  }

  /** Une segmentos de una fila (ordenados por x) con el separador que corresponde a cada hueco. */
  function unirSegmentos(lista) {
    let s = '';
    lista.forEach((v, i) => {
      s += (i ? separador(s, v.s, v.x - lista[i - 1].x2, v.h) : '') + v.s;
    });
    return limpiar(s);
  }

  /**
   * Líneas del certificado: agrupa por y (tolerancia 2,5 pt respecto al primer item de la línea), ordena por
   * x y une en "bloques" los items cercanos (hueco < ~0,36·h; espacio si el hueco es > 0,8 pt, salvo entre cifras
   * o signos de fechas/códigos/correos, ver separador()).
   * texto = bloques separados por dos espacios.
   * Bloque = { s, x, x2, y, h, fuentes: [nombres de fuente], items }.
   */
  function construirLineas(items) {
    const lista = (Array.isArray(items) ? items : []).filter(conTexto).map(aItem);
    lista.sort(ordenLectura);
    const lineas = [];
    for (const it of lista) {
      let l = lineas.find((ln) => Math.abs(ln.y - it.y) <= TOL_Y);
      if (!l) {
        l = { y: it.y, items: [] };
        lineas.push(l);
      }
      l.items.push(it);
    }
    lineas.sort((a, b) => b.y - a.y);
    for (const l of lineas) {
      l.items.sort(porX);
      const bloques = [];
      for (const it of l.items) {
        const ult = bloques[bloques.length - 1];
        const hueco = ult ? it.x - ult.x2 : 0;
        if (ult && hueco < umbralUnion(ult.hUltimo, it.h)) {
          ult.s += separador(ult.s, it.str, hueco, Math.min(ult.hUltimo || it.h, it.h || ult.hUltimo)) + it.str;
          ult.x2 = Math.max(ult.x2, it.x2);
          ult.h = Math.max(ult.h, it.h || 0);
          ult.hUltimo = it.h;
          ult.items.push(it);
          if (ult.fuentes.indexOf(it.font) < 0) ult.fuentes.push(it.font);
        } else {
          bloques.push({ s: it.str, x: it.x, x2: it.x2, y: it.y, h: it.h || 0, hUltimo: it.h, fuentes: [it.font], items: [it] });
        }
      }
      l.bloques = bloques.map((b) => Object.assign(b, { s: limpiar(b.s) })).filter((b) => b.s);
      l.texto = l.bloques.map((b) => b.s).join('  ');
    }
    return lineas.filter((l) => l.bloques.length);
  }

  const compactar = (s) => fold(s).replace(/\s+/g, '');

  // Anclas propias (si no está DocDetect). Ver informe RIT §6.
  const ANCLA = {
    rit: compactar('registro de informacion tributaria'),
    ritOtras: [compactar('rit-shd'), compactar('informacion basica del contribuyente')],
    solicitud: /novedadesrit|novedadesenelrit|(?:^|[^0-9])(?:39-f\.0?9|105-f\.203)/,
    rut: compactar('numero de identificacion tributaria'),
    rutOtras: ['fecha generacion documento pdf', 'para uso exclusivo de la dian', 'direccion seccional'].map(compactar),
  };

  function textoPagina(p) {
    if (p && typeof p.texto === 'string') return p.texto;
    const lineas = p && Array.isArray(p.lineas) ? p.lineas : [];
    return lineas.map((l) => (l && typeof l.texto === 'string' ? l.texto : '')).join('\n');
  }

  /** 'RIT' | 'RIT_SOLICITUD' | 'RUT' | 'DESCONOCIDO' para una página. */
  function tipoPagina(p) {
    if (!p || p.sinTexto || p.ilegible) return 'DESCONOCIDO';
    const dd = root.DocDetect || (root.PdfText && root.PdfText.DocDetect);
    if (dd && typeof dd.clasificarPagina === 'function') {
      try { return dd.clasificarPagina(p).tipo; } catch (e) { /* usar las anclas propias */ }
    }
    const c = compactar(textoPagina(p));
    if (c.indexOf(ANCLA.rit) >= 0 && ANCLA.ritOtras.some((a) => c.indexOf(a) >= 0)) return 'RIT';
    if (ANCLA.solicitud.test(c)) return 'RIT_SOLICITUD';
    if (c.indexOf(ANCLA.rut) >= 0 && ANCLA.rutOtras.some((a) => c.indexOf(a) >= 0)) return 'RUT';
    return 'DESCONOCIDO';
  }

  function tipoPaginaSeguro(p) {
    try { return tipoPagina(p); } catch (e) { return 'DESCONOCIDO'; }
  }

  /** ¿El PDF contiene un certificado RIT? */
  function esRit(doc) {
    try {
      return normalizarDoc(doc).paginas.some((p) => tipoPaginaSeguro(p) === 'RIT');
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------- segmentos: etiquetas y valores

  // Etiquetas, buscadas en el texto plegado de la fila SIN espacios (así se reconocen aunque vengan partidas
  // en varios items, incluso a mitad de palabra: «Fec» «ha:»). El valor es lo que sigue a la etiqueta en su
  // fila hasta la siguiente etiqueta.
  const ETIQUETAS = [
    ['contribuyente', /contribuyente(?!:)/],              // solo al comienzo de la fila (ver segmentar)
    ['fechaCertificado', /fecha\s*:/],                    // «Fecha:dd/mm/aaaa» del encabezado
    ['actividad', /actividad\s*(\d+)\s*:/],
    ['direccionElectronica', /direccion\s*electronica\s*:/],
    ['direccion', /direccion\s*:/],
    ['telefonos', /telefonos?\s*:/],
    ['ciudad', /ciudad\s*:/],
    ['municipio', /municipio\s*:/],
    ['fechaInscripcion', /fecha\s*de\s*inscripcion\s*:/],
    ['soporteInscripcion', /soporte\s*(?:de\s*)?inscripcion\s*:/],
    ['naturalezaJuridica', /naturaleza\s*juridica\s*:/],
    ['regimen', /regimen\s*tributario\s*:/],
    ['regimenFechaDesde', /fecha\s*desde\s*:/],
    ['matriculaMercantil', /matricula\s*mercantil\s*:/],
    ['fechaInicioActividades', /fecha\s*(?:de\s*)?inicio\s*de\s*actividades\s*:/],
    ['fechaCeseActividades', /fecha\s*de\s*cese\s*de\s*actividades\s*:/],
    ['numEstablecimientos', /no\.?\s*(?:de\s*)?establecimientos\s*:/],
  ].map(([k, re]) => [k, new RegExp(re.source, 'g')]);

  const tolFila = (h) => (h > 0 ? Math.max(1.5, FILA_REL * h) : TOL_Y);

  /**
   * Divide las líneas en segmentos: etiquetas conocidas (aunque vengan partidas en varios bloques o pegadas a
   * su valor) y trozos de valor (cada uno dentro de un solo bloque). La x de un carácter dentro de un bloque
   * se estima en proporción a su posición. → { etiquetas: [{ k, orden, x, x2, y, h }], valores: [{ s, x, x2, y, h }] }
   */
  function segmentar(lineas) {
    const etiquetas = [];
    const valores = [];
    for (const l of lineas) {
      const bl = l.bloques;
      let texto = '';
      const mapa = []; // carácter → [bloque, posición en el bloque] | null (separador entre bloques)
      bl.forEach((b, i) => {
        if (i) {
          texto += ' ';
          mapa.push(null);
        }
        texto += b.s;
        for (let j = 0; j < b.s.length; j++) mapa.push([b, j]);
      });
      const f = fold(texto);
      let compacto = '';
      const enTexto = []; // posición en `compacto` → posición en `texto`
      for (let i = 0; i < f.length; i++) {
        if (/\s/.test(f[i])) continue;
        compacto += f[i];
        enTexto.push(i);
      }
      const marcas = [];
      for (const [k, re] of ETIQUETAS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(compacto))) {
          if (!m[0].length) {
            re.lastIndex++;
            continue;
          }
          const ini = enTexto[m.index];
          const fin = enTexto[m.index + m[0].length - 1] + 1;
          if (k !== 'contribuyente' || m.index === 0) marcas.push({ k, ini, fin, orden: m[1] ? Number(m[1]) : null });
        }
      }
      marcas.sort((a, b) => a.ini - b.ini || b.fin - a.fin);
      const sel = [];
      for (const mk of marcas) if (!sel.length || mk.ini >= sel[sel.length - 1].fin) sel.push(mk);

      const celda = (i) => mapa[i] || mapa[i + 1] || mapa[i - 1] || [bl[0], 0];
      const xEn = (i) => { // borde izquierdo del carácter i
        const [b, j] = mapa[i] || mapa[i + 1] || [bl[bl.length - 1], bl[bl.length - 1].s.length];
        return b.x + ((b.x2 - b.x) * j) / (b.s.length || 1);
      };
      const x2En = (fin) => { // borde derecho del carácter fin-1
        const c = mapa[fin - 1] || mapa[fin - 2];
        if (!c) return bl[0].x;
        const [b, j] = c;
        return b.x + ((b.x2 - b.x) * (j + 1)) / (b.s.length || 1);
      };
      const agregarValores = (desde, hasta) => {
        let i = desde;
        while (i < hasta) {
          if (!mapa[i]) {
            i++;
            continue;
          }
          const b = mapa[i][0];
          let j = i;
          while (j < hasta && mapa[j] && mapa[j][0] === b) j++;
          const s = limpiar(texto.slice(i, j));
          if (s) valores.push({ s, x: xEn(i), x2: x2En(j), y: b.y, h: b.h });
          i = j;
        }
      };
      let pos = 0;
      for (const mk of sel) {
        agregarValores(pos, mk.ini);
        const b = celda(mk.ini)[0];
        etiquetas.push({ k: mk.k, orden: mk.orden, x: xEn(mk.ini), x2: x2En(mk.fin), y: b.y, h: b.h });
        pos = mk.fin;
      }
      agregarValores(pos, texto.length);
    }
    etiquetas.sort(ordenLectura);
    return { etiquetas, valores };
  }

  /** Valores a la derecha de una etiqueta, en su fila y antes de la siguiente etiqueta de la misma fila. */
  function valoresDe(e, seg, usados) {
    const tol = tolFila(e.h);
    const enFila = (s) => Math.abs(s.y - e.y) <= tol;
    let sig = Infinity;
    for (const o of seg.etiquetas) if (o !== e && enFila(o) && o.x > e.x + 0.5 && o.x < sig) sig = o.x;
    const partes = seg.valores.filter((v) => !(usados && usados.has(v)) && enFila(v) && v.x >= e.x2 - 0.5 && v.x < sig - 0.5).sort(porX);
    return { partes, sig: sig === Infinity ? null : sig };
  }

  // ---------------------------------------------------------------- lectura de una página RIT

  const TIPOS_DOC = {
    nit: 'NIT', cc: 'CC', ce: 'CE', ti: 'TI', pasaporte: 'PA', pa: 'PA', pp: 'PA', te: 'TE', rc: 'RC',
    ppt: 'PPT', pep: 'PEP', nuip: 'NUIP', ceduladeciudadania: 'CC', ceduladeextranjeria: 'CE',
    tarjetadeidentidad: 'TI', tarjetadeextranjeria: 'TE', registrocivil: 'RC',
  };
  // Código DIAN del tipo de documento (para ubicarlo en CATALOGOS.tiposDocumento).
  const DIAN_TIPO = { CC: 13, CE: 22, TI: 12, PA: 41, RC: 11, TE: 21 };

  function tipoDocNormalizado(impreso) {
    const k = fold(impreso).replace(/[^a-z]/g, '');
    return k ? (TIPOS_DOC[k] || 'OTRO') : null;
  }

  /** 'Página i/ n' → { hoja, total }. */
  function leerPaginacion(lineas) {
    for (const l of lineas) {
      const m = /pagina\s*(\d+)\s*\/\s*(\d+)/.exec(fold(l.texto));
      if (m) return { hoja: Number(m[1]), total: Number(m[2]) };
    }
    return { hoja: null, total: null };
  }

  // Tipo de documento al comienzo del texto que sigue a CONTRIBUYENTE (puede venir pegado al número).
  // Se aplica al texto plegado SIN espacios («C.C .», «N.I .T.», «PASA PORTE» de un texto partido).
  const RE_TIPO_DOC = /^(n\.?i\.?t\.?|c\.?c\.?|c\.?e\.?|t\.?i\.?|t\.?e\.?|pasaporte|p\.?p\.?t\.?|p\.?e\.?p\.?|nuip|r\.?c\.?|p\.?a\.?|p\.?p\.?)(?![a-z])/;
  const RE_NUMERO = /^\d[\d.\s]*(?:-\s*\d)?$/;      // 52.345.678 · 830035246-7
  const RE_NUMERO_SIGUE = /^-?\s*\d[\d.\s]*$/;        // trozo siguiente de un número partido (o el DV)

  /** Tokens (un bloque cada uno) tras «CONTRIBUYENTE» → { tipoImpreso, numero, dvImpreso, nombre } | null. */
  function separarIdentificacion(tokens) {
    let t = tokens.map(limpiar).filter(Boolean);
    if (!t.length) return null;
    let tipoImpreso = null;
    const f0 = fold(t[0]);
    const mt = RE_TIPO_DOC.exec(f0.replace(/\s+/g, ''));
    if (mt) {
      let fin = 0; // posición en t[0] donde termina el tipo (contando solo caracteres que no son espacio)
      for (let n = 0; n < mt[0].length; fin++) if (!/\s/.test(f0[fin])) n++;
      tipoImpreso = limpiar(t[0].slice(0, fin));
      const resto = limpiar(t[0].slice(fin));
      t = resto ? [resto].concat(t.slice(1)) : t.slice(1);
    } else {
      // tipo no reconocido («CÉDULA DE CIUDADANÍA»): lo que va antes de la primera cifra
      const k = t.findIndex((x) => /\d/.test(x));
      if (k < 0) return null;
      const i = t[k].search(/\d/);
      tipoImpreso = limpiar(t.slice(0, k).concat(t[k].slice(0, i)).join(' ')) || null;
      t = [t[k].slice(i)].concat(t.slice(k + 1));
    }
    const tipo = tipoDocNormalizado(tipoImpreso);
    let numero = null;
    let dvImpreso = null;
    let n = 0;
    if (t.length && tipo === 'PA' && /\d/.test(t[0]) && /^[A-Za-z0-9.-]{4,20}$/.test(t[0])) {
      numero = t[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase(); // pasaporte: puede ser alfanumérico
      n = 1;
    } else {
      let crudo = '';
      while (n < t.length && (n === 0 ? RE_NUMERO : RE_NUMERO_SIGUE).test(t[n])) {
        crudo += (n ? ' ' : '') + t[n]; // número partido en varios bloques («5234» «5678») o DV aparte
        n++;
      }
      if (!crudo && t.length) {
        const m = /^(\d[\d.]{3,})\s+(\D.*)$/.exec(t[0]); // número y nombre en un mismo bloque
        if (m) {
          crudo = m[1];
          t = [m[1], m[2]].concat(t.slice(1));
          n = 1;
        }
      }
      if (crudo) {
        const md = /^(\d[\d.\s]*?)\s*-\s*(\d)$/.exec(crudo);
        if (md && (tipo === 'NIT' || dvNit(md[1]) === md[2])) {
          numero = soloDigitos(md[1]);
          dvImpreso = md[2];
        } else {
          numero = soloDigitos(crudo);
        }
      }
    }
    if (numero && (numero.length < 3 || numero.length > 20)) numero = null;
    return { tipoImpreso, numero, dvImpreso, nombre: limpiar(t.slice(n).join(' ')) || null };
  }

  /** Fila CONTRIBUYENTE | tipo | número | nombre. */
  function leerContribuyente(seg, lineas) {
    const e = seg.etiquetas.find((x) => x.k === 'contribuyente');
    const r = e ? separarIdentificacion(valoresDe(e, seg).partes.map((p) => p.s)) : null;
    if (r && r.numero) return r;
    // Respaldo (formato desconocido): expresión regular sobre el texto de la página.
    const t = lineas.map((ln) => ln.texto).join('\n');
    const m = /CONTRIBUYENTE\s+(N\.?I\.?T\.?|C\.?C\.?|C\.?E\.?|T\.?I\.?|PASAPORTE)\s*(\d[\d.]{2,18}|[A-Z0-9]{4,20})\s+([^\n]+)/i.exec(t);
    if (m && /\d/.test(m[2])) {
      const pa = tipoDocNormalizado(m[1]) === 'PA';
      return { tipoImpreso: m[1], numero: pa ? m[2].toUpperCase() : soloDigitos(m[2]), dvImpreso: null, nombre: limpiar(m[3]) || null, respaldo: true };
    }
    return r;
  }

  /** { clave: { valor, x2, sig, h } } con la primera aparición de cada etiqueta (en orden de lectura). */
  function leerEtiquetas(seg) {
    const res = {};
    const vistas = new Set();
    for (const e of seg.etiquetas) {
      if (e.k === 'contribuyente' || e.k === 'actividad' || e.k === 'fechaCertificado' || vistas.has(e.k)) continue;
      vistas.add(e.k);
      const { partes, sig } = valoresDe(e, seg);
      const valor = unirSegmentos(partes);
      if (valor) res[e.k] = { valor, x2: Math.max.apply(null, partes.map((p) => p.x2)), sig, h: e.h };
    }
    return res;
  }

  /** "Fecha:dd/mm/aaaa" del encabezado (etiqueta y valor en el mismo bloque, o el valor a su derecha). */
  function leerFechaCertificado(seg, lineas) {
    const e = seg.etiquetas.find((x) => x.k === 'fechaCertificado');
    if (e) {
      const iso = fechaISO(unirSegmentos(valoresDe(e, seg).partes));
      if (iso) return { iso };
    }
    for (const l of lineas) {
      for (const b of l.bloques) {
        const f = fold(b.s);
        if (/^fecha\s*:/.test(f)) {
          const iso = fechaISO(f);
          if (iso) return { iso, bloque: b };
        }
      }
    }
    return null;
  }

  const FIN_ACTIVIDADES = /^(establecimientos\s+activos|representantes\s+activos|senor\s+contribuyente)/;
  const RE_VALOR_ACTIVIDAD = new RegExp('^(\\d{3,6})(?:\\s*[' + GUIONES + ']\\s*(.*)|\\s+([^\\d\\s].*))?$');
  const RE_INICIO_ACTIVIDAD = new RegExp('^\\d{3,6}\\s*[' + GUIONES + ']');

  /**
   * Actividades «Actividad n:» + «CÓDIGO - Descripción», con la continuación de la descripción en las líneas
   * siguientes que empiezan en la x del valor. Todo por geometría relativa a la altura de letra.
   * → { actividades: [{ orden, codigoImpreso, descripcionImpresa }], sinCodigo: [{ orden, texto }], hayEtiquetas }
   */
  function leerActividades(seg, lineas) {
    const vistas = new Set();
    const etiquetas = seg.etiquetas.filter((e) => e.k === 'actividad' && !vistas.has(e.orden) && vistas.add(e.orden));
    const actividades = [];
    const sinCodigo = [];
    if (!etiquetas.length) return { actividades, sinCodigo, hayEtiquetas: false };
    let yFin = -Infinity;
    for (const l of lineas) if (l.y < etiquetas[0].y && FIN_ACTIVIDADES.test(fold(l.texto))) yFin = Math.max(yFin, l.y);
    const usados = new Set();
    etiquetas.forEach((e, k) => {
      const sig = etiquetas[k + 1];
      const fila = valoresDe(e, seg, usados).partes;
      fila.forEach((v) => usados.add(v));
      const partes = fila.length ? [unirSegmentos(fila)] : [];
      if (fila.length) {
        const vx = fila[0].x;
        const hv = fila[0].h || e.h;
        const tolX = Math.max(3, X_CONT_REL * hv);
        const tolV = tolFila(hv);
        const limite = Math.max(sig ? sig.y + tolFila(sig.h) : -Infinity, yFin + TOL_Y);
        let yPrev = fila[0].y;
        for (let n = 0; n < 4; n++) {
          const cands = seg.valores.filter((v) => !usados.has(v) && v.y < yPrev - 0.4 * hv && v.y >= yPrev - PASO_REL * hv && Math.abs(v.x - vx) <= tolX);
          if (!cands.length) break;
          const yr = Math.max.apply(null, cands.map((v) => v.y));
          if (yr <= limite) break;
          const filaC = seg.valores.filter((v) => !usados.has(v) && Math.abs(v.y - yr) <= tolV).sort(porX);
          if (seg.etiquetas.some((o) => Math.abs(o.y - yr) <= tolV) || filaC.some((v) => v.x < vx - tolX)) break;
          const t = unirSegmentos(filaC);
          if (!t || RE_INICIO_ACTIVIDAD.test(t) || FIN_ACTIVIDADES.test(fold(t))) break;
          partes.push(t);
          filaC.forEach((v) => usados.add(v));
          yPrev = yr;
        }
      }
      const txt = limpiar(partes.join(' '));
      if (!txt) return; // casilla vacía: la etiqueta se imprime sin valor
      const m = RE_VALOR_ACTIVIDAD.exec(txt);
      if (!m) {
        sinCodigo.push({ orden: e.orden, texto: txt });
        return;
      }
      actividades.push({ orden: e.orden, codigoImpreso: m[1], descripcionImpresa: limpiar(m[2] || m[3] || '') });
    });
    actividades.sort((a, b) => a.orden - b.orden);
    sinCodigo.sort((a, b) => a.orden - b.orden);
    return { actividades, sinCodigo, hayEtiquetas: true };
  }

  /** Respaldo: "CÓDIGO - Descripción" en cualquier línea (formato desconocido sin etiquetas "Actividad n:"). */
  function actividadesPorRespaldo(lineas) {
    const out = [];
    const re = new RegExp('^(\\d{3,6})\\s*[' + GUIONES + ']\\s*([A-ZÁÉÍÓÚÑ].+)$');
    for (const l of lineas) {
      const t = limpiar(l.bloques.map((b) => b.s).join(' ')).replace(/^actividad\s*\d+\s*:\s*/i, '');
      const m = re.exec(t);
      if (m && buscarActividad(m[1])) out.push({ orden: out.length + 1, codigoImpreso: m[1], descripcionImpresa: limpiar(m[2]) });
    }
    return out;
  }

  /**
   * Lee los datos de una página RIT. Solo se mira lo que está por encima de la primera tabla
   * (ESTABLECIMIENTOS / REPRESENTANTES ACTIVOS): encabezado, contribuyente y perfil tributario.
   */
  function leerPagina(lineas) {
    let corte = null;
    for (const l of lineas) if (/^(establecimientos|representantes)\s+activos/.test(fold(l.texto)) && (corte == null || l.y > corte)) corte = l.y;
    const arriba = corte == null ? lineas : lineas.filter((l) => l.y > corte + TOL_Y);
    const seg = segmentar(arriba);
    const actividades = leerActividades(seg, arriba);
    return {
      paginacion: leerPaginacion(lineas),
      fecha: leerFechaCertificado(seg, arriba),
      contribuyente: leerContribuyente(seg, arriba),
      etiquetas: leerEtiquetas(seg),
      actividades,
      version: /version\s*2\.02/.test(fold(lineas.map((l) => l.texto).join(' '))) ? '2.02' : null,
      tienePerfil: seg.etiquetas.some((e) => e.k === 'actividad' || e.k === 'naturalezaJuridica' || e.k === 'regimen') ||
        arriba.some((l) => /perfil\s*tributario/.test(fold(l.texto))),
      corte,
    };
  }

  // ---------------------------------------------------------------- catálogo ICA (CATALOGOS.rit)

  let cacheRef = null;
  let cacheIndice = null;

  function catalogoRit() {
    const c = root.CATALOGOS;
    return c && Array.isArray(c.rit) ? c.rit : null;
  }

  /** Map código normalizado → [entradas] (8551 aparece dos veces en el Excel). */
  function indice() {
    const cat = catalogoRit();
    if (!cat) return null;
    if (cacheRef !== cat) {
      const m = new Map();
      for (const e of cat) {
        const k = normCodigo(e && e.codigo);
        if (!k) continue;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(e);
      }
      cacheRef = cat;
      cacheIndice = m;
      cacheFichas = null;
    }
    return cacheIndice;
  }

  /** Entrada de CATALOGOS.rit para un código (entero o texto de dígitos, con o sin ceros a la izquierda) o null. */
  function buscarActividad(codigo) {
    const m = indice();
    const k = normCodigo(codigo);
    if (!m || !k) return null;
    const l = m.get(k);
    return l ? l[0] : null;
  }

  const aCandidato = (e) => ({ codigo: String(e.codigo), descripcion: e.descripcion, tarifa: e.tarifa, agrupacion: e.agrupacion });

  /** Hijos de 5 dígitos (sub-códigos de Bogotá) de un código de 4 dígitos sin cero inicial. */
  function hijos(c4) {
    const cat = catalogoRit();
    if (!cat || !/^[1-9]\d{3}$/.test(c4)) return [];
    const vistos = new Set();
    return cat.filter((e) => {
      const k = String(e.codigo);
      if (k.length !== 5 || k.slice(0, 4) !== c4 || vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  }

  /**
   * Actividades ICA posibles para un CIIU del RUT: el mismo código si existe, seguido de sus hijos de 5
   * dígitos (8523 → 8523 media técnica / 85232 formación laboral; 7490 → 74901 / 74902); [] si no hay.
   */
  function candidatosDesdeCiiu(ciiu) {
    const d = normCodigo(ciiu);
    if (!d) return [];
    const exacto = buscarActividad(d);
    const lista = exacto ? [exacto] : [];
    if (d.length <= 4) hijos(d.padStart(4, '0')).forEach((e) => lista.push(e));
    return lista.map(aCandidato);
  }

  // Códigos de la clasificación anterior (Res. SDH-079/2013) que aún se imprimen (informe RIT §4.3).
  const LEGADO = {
    85511: { sugerido: '85591' },                                // misma descripción en la Res. SDH-265/2021
    71101: { candidatos: ['71111', '71112', '71121', '71122'] }, // arquitectura / ingeniería: hay que preguntar
  };

  const PALABRAS_VACIAS = new Set(['para', 'como', 'otros', 'otras', 'demas', 'excepto', 'actividades', 'actividad', 'incluye', 'servicios']);
  let cacheFichas = null;

  function fichas(s) {
    return new Set(clave(s).split(' ').filter((w) => w.length >= 4 && !PALABRAS_VACIAS.has(w)));
  }

  function similitud(a, b) {
    if (!a.size || !b.size) return 0;
    let comun = 0;
    for (const w of a) if (b.has(w)) comun++;
    return (2 * comun) / (a.size + b.size);
  }

  /** Para un código impreso que no está en el catálogo: { sugerido?: entrada, candidatos: [entradas] }. */
  function resolverFueraDeCatalogo(codigo, descripcion) {
    const cat = catalogoRit();
    if (!cat) return { candidatos: [] };
    const regla = LEGADO[codigo];
    if (regla && regla.sugerido && buscarActividad(regla.sugerido)) {
      const s = buscarActividad(regla.sugerido);
      return { sugerido: s, candidatos: [s] };
    }
    if (regla && regla.candidatos) return { candidatos: regla.candidatos.map(buscarActividad).filter(Boolean) };

    const lista = [];
    const agregar = (e) => { if (e && !lista.some((x) => String(x.codigo) === String(e.codigo))) lista.push(e); };
    // 1) misma descripción (folded) que una entrada del catálogo → equivalente directo
    const k = claveCompacta(descripcion);
    const iguales = k ? cat.filter((e) => claveCompacta(e.descripcion) === k) : [];
    const unicos = [...new Set(iguales.map((e) => String(e.codigo)))];
    if (unicos.length === 1) return { sugerido: iguales[0], candidatos: [iguales[0]] };
    // 2) familia: el código de 4 dígitos y sus hijos de 5
    if (codigo.length >= 4) {
      const c4 = codigo.slice(0, 4);
      agregar(buscarActividad(c4));
      hijos(c4).forEach(agregar);
    }
    // 3) descripciones parecidas
    if (descripcion) {
      cacheFichas = cacheFichas || cat.map((e) => ({ e, f: fichas(e.descripcion) }));
      const f = fichas(descripcion);
      cacheFichas
        .map((x) => ({ e: x.e, s: similitud(f, x.f) }))
        .filter((x) => x.s >= 0.6)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3)
        .forEach((x) => agregar(x.e));
    }
    return { candidatos: lista.slice(0, 6) };
  }

  /**
   * Completa una actividad impresa con los datos del catálogo. `codigo` es el código para el formulario (el
   * del catálogo o el sugerido para un código antiguo); si no se pudo resolver, el impreso normalizado.
   */
  function enriquecer(a) {
    const codigo = normCodigo(a.codigoImpreso);
    const out = {
      orden: a.orden,
      codigo,
      codigoImpreso: a.codigoImpreso,
      descripcionImpresa: a.descripcionImpresa,
      descripcion: a.descripcionImpresa,
      principal: false,
      enCatalogo: null,
      descripcionCatalogo: null,
      tarifa: null,
      agrupacion: null,
      codigoFormulario: null,
    };
    const m = indice();
    if (!m) return out; // sin catálogo no se puede validar
    const entradas = m.get(codigo) || [];
    if (entradas.length) {
      // 8551 está dos veces: preferir la descripción que coincide con la impresa
      const ki = claveCompacta(a.descripcionImpresa).slice(0, 22);
      const e = entradas.find((x) => claveCompacta(x.descripcion).slice(0, 22) === ki) || entradas[0];
      Object.assign(out, {
        enCatalogo: true,
        descripcionCatalogo: e.descripcion,
        descripcion: e.descripcion,
        tarifa: e.tarifa,
        agrupacion: e.agrupacion,
        codigoFormulario: codigo,
        descripcionCoincide: !ki || claveCompacta(e.descripcion).slice(0, 22) === ki,
      });
      if (!e.agrupacion && !e.tarifa) out.noGravada = true;
      return out;
    }
    const r = resolverFueraDeCatalogo(codigo, a.descripcionImpresa);
    out.enCatalogo = false;
    out.candidatos = r.candidatos.map(aCandidato);
    if (r.sugerido) {
      Object.assign(out, {
        sugerido: String(r.sugerido.codigo),
        codigoFormulario: String(r.sugerido.codigo),
        codigo: String(r.sugerido.codigo),
        descripcion: r.sugerido.descripcion,
        tarifa: r.sugerido.tarifa,
        agrupacion: r.sugerido.agrupacion,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- otros datos

  const RE_CORREO = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

  function normRegimen(v) {
    const f = fold(v);
    const c = f.replace(/\s+/g, ''); // sin espacios: tolera textos partidos («SIMPLIF ICADO»)
    if (!c) return null;
    if (/\bsimple\b|\brst\b/.test(f) || /regimensimple|simplede/.test(c)) return 'SIMPLE';
    if (/simplificado|preferencial/.test(c)) return 'PREFERENCIAL';
    if (/comun/.test(c)) return 'COMUN';
    return 'OTRO';
  }

  /** Nombre del departamento en CATALOGOS.departamentos (el certificado lo imprime en «Municipio:»). */
  function departamentoCatalogo(v) {
    const c = root.CATALOGOS;
    if (!v || !c || !Array.isArray(c.departamentos)) return null;
    const k = clave(v).replace(/\s+/g, '');
    const d = c.departamentos.find((x) => x && x.codigo && clave(x.nombre).replace(/\s+/g, '') === k);
    return d ? d.nombre : null;
  }

  /** Nombre del municipio en CATALOGOS.municipios («Ciudad:»; BOGOTÁ DC → BOGOTÁ). */
  function municipioCatalogo(ciudad, depto) {
    const c = root.CATALOGOS;
    if (!ciudad || !c || !Array.isArray(c.municipios)) return null;
    let k = claveCompacta(ciudad);
    if (/^bogota(dc)?$/.test(k)) k = 'bogota';
    const lista = c.municipios.filter((m) => m && claveCompacta(m.nombre) === k && (!depto || m.depto === depto));
    return lista.length === 1 ? lista[0].nombre : null;
  }

  function tipoDocumentoCatalogo(tipo) {
    const c = root.CATALOGOS;
    const dian = DIAN_TIPO[tipo];
    if (!dian || !c || !Array.isArray(c.tiposDocumento)) return null;
    const t = c.tiposDocumento.find((x) => x && Number(x.dian) === dian);
    return t ? t.nombre : null;
  }

  /**
   * ¿El número del RIT es el documento esperado? Admite el DV pegado al final de cualquiera de los dos
   * (NIT escrito con su DV) y números alfanuméricos (pasaporte). null si falta alguno.
   */
  function mismoDocumento(numero, esperado) {
    const a = normDoc(numero);
    const b = normDoc(esperado);
    if (!a || !b) return null;
    if (a === b) return true;
    const conDv = (largo, corto) => /^\d+$/.test(largo) && /^\d+$/.test(corto) && largo.length === corto.length + 1 &&
      largo.slice(0, -1) === corto && dvNit(corto) === largo.slice(-1);
    return conDv(b, a) || conDv(a, b);
  }

  // ---------------------------------------------------------------- avisos

  const OFICINA = 'la Oficina Virtual de la Secretaría Distrital de Hacienda (Mi RIT → Certificado RIT)';

  const AVISO = {
    RUT: 'Este PDF es un RUT de la DIAN, no el certificado RIT. Súbelo en la casilla del RUT; el RIT lo descargas en ' + OFICINA + '.',
    RIT_SOLICITUD: 'Este PDF es el formulario de solicitud o novedades del RIT, no el certificado. Descarga tu certificado RIT en ' + OFICINA + '.',
    DESCONOCIDO: 'No reconocemos este PDF como un certificado RIT de la Secretaría Distrital de Hacienda de Bogotá. Descárgalo en ' + OFICINA + ' o continúa a mano.',
    SIN_ACTIVIDADES: 'No encontramos actividades económicas en tu RIT. Elige tu actividad en el paso «Información tributaria».',
    SIN_PERFIL: 'Este PDF no trae la página 1 del certificado RIT (la del perfil tributario y las actividades económicas). Sube el certificado completo, descargado de ' + OFICINA + '.',
    FORMATO: 'Tu certificado RIT tiene un formato que no conocemos; revisa con cuidado los datos que leímos.',
  };

  const docTexto = (c) => [c.tipoDocImpreso, c.numero].filter(Boolean).join(' ');
  const listaCodigos = (cands) => cands.map((c) => c.codigo).join(', ');
  const recortar = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const NIVEL = { alta: 2, media: 1, baja: 0 };
  const bajar = (c, n) => (NIVEL[n] < NIVEL[c] ? n : c);

  // ---------------------------------------------------------------- parse

  function resultadoVacio() {
    return { tipo: 'RIT', ok: false, campos: {}, extra: {}, avisos: [] };
  }

  /**
   * Agrupa las páginas RIT en certificados (un paquete puede traer varios, en cualquier orden, repetidos o con
   * otras páginas que mencionan el RIT). Grupo = mismo documento y misma fecha; una página sin documento con
   * hoja > 1 sigue a la anterior; una hoja repetida es una copia y se ignora.
   */
  function agruparCertificados(paginasRit) {
    const grupos = [];
    let previo = null;
    for (const pr of paginasRit) {
      const d = pr.datos;
      const numero = (d.contribuyente && d.contribuyente.numero) || null;
      const fecha = d.fecha ? d.fecha.iso : null;
      const hoja = d.paginacion.hoja;
      let g = null;
      if (numero) g = grupos.find((x) => x.numero === numero && (!x.fecha || !fecha || x.fecha === fecha)) || null;
      else if (previo && hoja != null && hoja > 1) g = previo;
      const copia = g && g.paginas.some((p) => (hoja != null ? p.datos.paginacion.hoja === hoja : p.datos.tienePerfil && d.tienePerfil));
      if (copia) {
        previo = g;
        continue;
      }
      if (!g) {
        g = { numero, fecha, paginas: [] };
        grupos.push(g);
      }
      if (!g.numero && numero) g.numero = numero;
      if (!g.fecha && fecha) g.fecha = fecha;
      g.paginas.push(pr);
      previo = g;
    }
    for (const g of grupos) {
      g.paginas.sort((a, b) => (a.datos.paginacion.hoja || 1e9) - (b.datos.paginacion.hoja || 1e9) || a.numero - b.numero);
      g.principal = g.paginas.find((p) => p.datos.tienePerfil) || g.paginas[0];
      g.esCertificado = !!(g.numero || g.principal.datos.tienePerfil);
    }
    return grupos;
  }

  /** Elige el certificado: el del documento esperado, con perfil, del primer documento y el más reciente. */
  function elegirGrupo(candidatos, esperado) {
    let lista = candidatos;
    if (esperado) {
      const iguales = lista.filter((g) => mismoDocumento(g.numero, esperado) === true);
      if (iguales.length) lista = iguales;
    }
    const conPerfil = lista.filter((g) => g.principal.datos.tienePerfil);
    if (conPerfil.length) lista = conPerfil;
    const mismos = lista.filter((g) => g.numero === lista[0].numero);
    const grupo = mismos.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))[0];
    return { grupo, mismos };
  }

  /**
   * Lee el certificado RIT. Nunca lanza: ante contenido inesperado devuelve ok=false y avisos.
   * Ver el encabezado del archivo para opts y la forma de Resultado.
   */
  function parse(doc, opts) {
    try {
      return leerRit(doc, opts && typeof opts === 'object' ? opts : {});
    } catch (e) {
      const res = resultadoVacio();
      res.extra.tipoDetectado = 'DESCONOCIDO';
      res.extra.errorInterno = String((e && e.message) || e).slice(0, 200);
      res.avisos.push(AVISO.DESCONOCIDO);
      return res;
    }
  }

  function leerRit(doc, o) {
    const res = resultadoVacio();
    const d = normalizarDoc(doc);
    const paginas = Array.isArray(d.paginas) ? d.paginas : [];
    const tipos = paginas.map(tipoPaginaSeguro);
    const paginasRit = [];
    paginas.forEach((p, i) => {
      if (tipos[i] !== 'RIT') return;
      const lineas = construirLineas(p.items || p.crudos || []);
      paginasRit.push({ numero: Number(p.numero) || i + 1, lineas, datos: leerPagina(lineas) });
    });

    if (!paginasRit.length) {
      const tipo = tipos.indexOf('RUT') >= 0 ? 'RUT' : (tipos.indexOf('RIT_SOLICITUD') >= 0 ? 'RIT_SOLICITUD' : 'DESCONOCIDO');
      res.extra.tipoDetectado = tipo;
      res.avisos.push(AVISO[tipo]);
      return res;
    }
    res.extra.tipoDetectado = 'RIT';

    // ---- certificado a usar
    const grupos = agruparCertificados(paginasRit);
    const certificados = grupos.filter((g) => g.esCertificado);
    const candidatos = certificados.length ? certificados : grupos;
    const esperadoNorm = normDoc(o.documentoEsperado);
    const esperado = /\d/.test(esperadoNorm) && esperadoNorm.length >= 4 ? esperadoNorm : '';
    const { grupo, mismos } = elegirGrupo(candidatos, esperado);
    const distintos = [...new Set(candidatos.map((g) => g.numero).filter(Boolean))];
    if (distintos.length > 1) {
      res.extra.certificados = candidatos.map((g) => {
        const c = g.principal.datos.contribuyente || {};
        return { tipoDoc: tipoDocNormalizado(c.tipoImpreso), numero: g.numero, nombre: c.nombre || null, paginas: g.paginas.map((p) => p.numero).sort((a, b) => a - b) };
      });
    }
    const fechasMismos = [...new Set(mismos.map((g) => g.fecha).filter(Boolean))];

    const datos = grupo.principal.datos;
    const et = datos.etiquetas;
    const val = (k) => (et[k] ? et[k].valor : null);
    const extra = res.extra;
    extra.formato = datos.version ? 'RIT-SHD v2.02' : 'RIT-SHD (versión desconocida)';
    extra.paginasRit = grupo.paginas.map((p) => p.numero).sort((a, b) => a - b);

    // ---- contribuyente (solo para cruzar con el RUT)
    const c = datos.contribuyente;
    if (c && c.numero) {
      const tipoDoc = tipoDocNormalizado(c.tipoImpreso);
      extra.contribuyente = {
        tipoDoc,
        tipoDocImpreso: c.tipoImpreso,
        tipoDocumentoCatalogo: tipoDocumentoCatalogo(tipoDoc),
        numero: c.numero,
        nombre: c.nombre,
      };
      if (tipoDoc === 'NIT') extra.contribuyente.dvCalculado = dvNit(c.numero);
      if (c.dvImpreso) extra.contribuyente.dvImpreso = c.dvImpreso;
      extra.identificacion = c.numero; // alias plano para el cruce RUT/RIT de la interfaz
    }

    // ---- datos de contacto y perfil
    if (val('direccion')) {
      extra.direccion = val('direccion');
      const e = et.direccion;
      const limite = e.sig != null ? e.sig - MARGEN_DIRECCION_REL * (e.h || 12) : X_FIN_DIRECCION;
      if (e.x2 >= limite) extra.direccionPosiblementeRecortada = true;
    }
    const tel = val('telefonos');
    if (tel) {
      const dig = soloDigitos(tel);
      extra.telefono = /^\d{7,10}$/.test(dig) ? dig : null;
      if (!extra.telefono) extra.telefonoImpreso = tel;
    }
    const correoImpreso = val('direccionElectronica');
    if (correoImpreso) {
      extra.emailImpreso = correoImpreso;
      const correo = correoImpreso.replace(/\s+/g, ''); // un correo no lleva espacios (texto partido)
      const e = et.direccionElectronica;
      const valido = RE_CORREO.test(correo);
      const limite = e.sig != null ? e.sig - MARGEN_CORREO_REL * (e.h || 12) : X_FIN_CORREO;
      const alBorde = e.x2 >= limite;
      extra.emailRecortado = !valido || alBorde;
      extra.emailSiValido = valido && !alBorde ? correo.toLowerCase() : null;
    }
    if (val('ciudad')) extra.ciudad = val('ciudad');
    if (val('municipio')) extra.departamento = val('municipio'); // «Municipio:» trae el departamento
    const dCat = departamentoCatalogo(extra.departamento);
    if (dCat) extra.departamentoCatalogo = dCat;
    const mCat = municipioCatalogo(extra.ciudad, dCat);
    if (mCat) extra.municipioCatalogo = mCat;

    const naturaleza = val('naturalezaJuridica');
    if (naturaleza) extra.naturalezaJuridica = naturaleza;
    const fn = compactar(naturaleza || ''); // sin espacios: tolera textos partidos («NATU RAL»)
    const tipoDoc = extra.contribuyente && extra.contribuyente.tipoDoc;
    if (/natural/.test(fn)) extra.esPersonaNatural = true;
    else if (/juridica|sociedad|consorcio|uniontemporal|entidad/.test(fn)) extra.esPersonaNatural = false;
    else if (['CC', 'CE', 'TI', 'PA', 'PPT', 'PEP'].indexOf(tipoDoc) >= 0) extra.esPersonaNatural = true;
    else if (tipoDoc === 'NIT' && /^[89]\d{8}$/.test(extra.contribuyente.numero)) extra.esPersonaNatural = false;
    else extra.esPersonaNatural = null;

    const regimen = val('regimen');
    if (regimen) {
      extra.regimen = regimen;
      extra.regimenNormalizado = normRegimen(regimen);
      extra.regimenConfianza = 'baja';
    }
    const desde = fechaISO(val('regimenFechaDesde'));
    extra.regimenFechaDesde = desde && desde !== '1969-12-31' ? desde : null;
    const matricula = val('matriculaMercantil');
    extra.matriculaMercantil = matricula && !RE_VACIO.test(compactar(matricula)) ? matricula : null;
    const ne = val('numEstablecimientos');
    extra.numEstablecimientos = ne && /^\d+$/.test(ne) ? Number(ne) : null;

    // ---- fechas
    extra.fechaCertificado = datos.fecha ? datos.fecha.iso : null;
    const inscripcion = fechaISO(val('fechaInscripcion'));
    if (inscripcion) {
      extra.fechaInscripcion = inscripcion;
      if (inscripcion === FECHA_MIGRACION) extra.fechaInscripcionEsMigracion = true;
    }
    extra.fechaInicioActividades = fechaISO(val('fechaInicioActividades'));
    const cese = val('fechaCeseActividades');
    extra.fechaCese = null;
    if (cese) {
      if (RE_VACIO.test(compactar(cese))) extra.fechaCese = 'NO';
      else if (fechaISO(cese)) extra.fechaCese = fechaISO(cese);
      else extra.fechaCeseImpresa = cese; // no es una fecha: no se da por cancelado
    }

    // ---- indicios de edición (P12): bloques con varias fuentes, texto en una fuente distinta de la del resto
    // de la página (la plantilla genuina usa una sola), fecha impresa ≠ fecha de creación.
    // Solo se cita el texto del encabezado y el perfil: debajo de la primera tabla están los datos de
    // terceros (establecimientos, representantes), que nunca deben salir del parser.
    const indicios = [];
    const lineasP = grupo.principal.lineas;
    const corte = datos.corte;
    const citable = (b) => corte != null && b.y > corte + TOL_Y;
    let mezclaEnTablas = false;
    const revisados = new Set();
    for (const l of lineasP) {
      for (const b of l.bloques) {
        if (b.fuentes.length < 2) continue;
        revisados.add(b);
        if (citable(b)) indicios.push('Texto con varios tipos de letra: «' + b.s + '»');
        else mezclaEnTablas = true;
      }
    }
    const conteo = {};
    for (const l of lineasP) for (const it of l.items) conteo[it.font] = (conteo[it.font] || 0) + 1;
    const fuentes = Object.keys(conteo);
    if (fuentes.length > 1) {
      const dominante = fuentes.sort((a, b) => conteo[b] - conteo[a])[0];
      for (const l of lineasP) {
        for (const b of l.bloques) {
          if (revisados.has(b) || b.fuentes[0] === dominante) continue;
          if (citable(b)) indicios.push('Texto con un tipo de letra distinto al del resto del certificado: «' + b.s + '»');
          else mezclaEnTablas = true;
        }
      }
    }
    if (mezclaEnTablas) indicios.push('Texto con varios tipos de letra en las tablas del certificado');
    const info = d.info || {};
    const creador = String(info.Creator || '');
    const original = /reportecertificadorit/i.test(creador) || (/jasper/i.test(creador) && /itext 2\.1\.2|lowagie/i.test(String(info.Producer || '')));
    const creado = fechaDeMetadato(info.CreationDate);
    if (original && creado && extra.fechaCertificado && creado !== extra.fechaCertificado) {
      indicios.push('La fecha impresa (' + fechaTexto(extra.fechaCertificado) + ') no coincide con la fecha de creación del PDF (' + fechaTexto(creado) + ')');
    }
    extra.posibleEdicion = indicios.length > 0;
    if (indicios.length) extra.indiciosEdicion = indicios;

    // ---- actividades
    let lect = datos.actividades;
    let porRespaldo = false;
    if (!lect.hayEtiquetas) {
      const r = actividadesPorRespaldo(lineasP.filter((l) => corte == null || l.y > corte + TOL_Y));
      if (r.length) {
        lect = { actividades: r, sinCodigo: [], hayEtiquetas: false };
        porRespaldo = true;
      }
    }
    const actividades = lect.actividades.map(enriquecer);
    if (actividades.length) actividades[0].principal = true; // convención: la primera es la principal
    extra.actividades = actividades;
    if (lect.sinCodigo.length) extra.actividadesSinCodigo = lect.sinCodigo.map((s) => s.orden);

    // ---- avisos (orden: identidad, vigencia, edición, actividad, otros)
    const avisos = res.avisos;
    if (distintos.length > 1) {
      avisos.push('Este PDF trae ' + distintos.length + ' certificados RIT de documentos distintos; usamos el del documento ' +
        grupo.numero + (esperado && mismoDocumento(grupo.numero, esperado) ? ', que coincide con el tuyo.' : '. Si no es el tuyo, sube solo tu certificado.'));
    }
    if (fechasMismos.length > 1) {
      avisos.push('Este PDF trae ' + fechasMismos.length + ' certificados RIT del mismo documento con fechas distintas; usamos el más reciente (' +
        fechaTexto(grupo.fecha) + ').');
    }
    const coincide = extra.contribuyente ? mismoDocumento(extra.contribuyente.numero, esperado) : null;
    if (esperado && coincide === false) {
      extra.documentoNoCoincide = true;
      avisos.push('El RIT corresponde a otro documento (' + docTexto(extra.contribuyente) + '), distinto al tuyo (' + esperado +
        '). Verifica que subiste tu propio certificado RIT.');
    } else if (esperado && !extra.contribuyente) {
      extra.documentoNoVerificado = true;
      avisos.push('No pudimos leer el número de documento de tu RIT para compararlo con el tuyo (' + esperado +
        '). Verifica que subiste tu propio certificado RIT.');
    }
    if (extra.esPersonaNatural === false) {
      const nombre = extra.contribuyente && extra.contribuyente.nombre ? ' (' + extra.contribuyente.nombre + ')' : '';
      const juridica = !naturaleza || /juridica/.test(fn);
      avisos.push((juridica ? 'Este RIT es de una persona jurídica' + nombre
        : 'Este RIT no es de una persona natural: su naturaleza jurídica es ' + naturaleza + nombre) +
        '. El formulario 13-IF-016 es para personas naturales: verifica que subiste tu propio RIT.');
    }
    if (esISO(extra.fechaCese)) {
      avisos.push('El RIT aparece cancelado: tiene fecha de cese de actividades (' + fechaTexto(extra.fechaCese) +
        '). Verifica tu inscripción en ' + OFICINA + '.');
    }
    if (extra.fechaCertificado) {
      const hoy = hoyISO(o.hoy);
      const dias = diasEntre(extra.fechaCertificado, hoy);
      extra.diasDesdeExpedicion = dias;
      const limite = Number(o.diasVigencia) > 0 ? Number(o.diasVigencia) : DIAS_VIGENCIA;
      if (dias < 0) {
        avisos.push('La fecha del certificado RIT (' + fechaTexto(extra.fechaCertificado) + ') es posterior a hoy; revisa que el documento sea correcto.');
      } else if (dias > limite) {
        avisos.push('Tu certificado RIT es del ' + fechaTexto(extra.fechaCertificado) + ' (hace ' + dias + ' días). Si cambiaste algo en tu RIT desde entonces, descarga uno reciente en ' + OFICINA + '.');
      }
    }
    if (extra.posibleEdicion) {
      avisos.push('Este PDF parece modificado después de generado (' + indicios[0].charAt(0).toLowerCase() + indicios[0].slice(1) +
        '). Te recomendamos descargar el certificado de nuevo en ' + OFICINA + '.');
    }

    // ---- campo actividadRit (actividad principal)
    const principal = actividades.find((a) => a.principal);
    const ilegible = lect.sinCodigo.find((s) => !principal || s.orden < principal.orden);
    const textoIlegible = ilegible ? 'No pudimos leer el código de la actividad ' + ilegible.orden + ' de tu RIT («' + recortar(ilegible.texto, 60) + '»)' : '';
    if (!principal) {
      if (ilegible) avisos.push(textoIlegible + '. Elige tu actividad en el paso «Información tributaria».');
      else avisos.push(datos.tienePerfil ? AVISO.SIN_ACTIVIDADES : AVISO.SIN_PERFIL);
    } else {
      let confianza = 'alta';
      const notas = [];
      if (ilegible) {
        confianza = 'baja';
        notas.push(textoIlegible + '. Tomamos la actividad ' + principal.orden + ' (' + principal.codigoImpreso + ') como principal; verifica cuál es tu actividad principal.');
      } else if (principal.orden !== 1) {
        confianza = 'media';
        notas.push('Tu RIT no tiene actividad 1; tomamos la actividad ' + principal.orden + ' (' + principal.codigoImpreso + ') como principal. Confírmala.');
      }
      const ciiu = soloDigitos(o.actividadRut);
      if (ciiu && actividades.length > 1) {
        const c4 = ciiu.padStart(4, '0');
        const familia = (a) => a.codigoImpreso.padStart(4, '0').slice(0, 4) === c4;
        const otra = actividades.find((a) => !a.principal && familia(a));
        if (!familia(principal) && otra) {
          confianza = bajar(confianza, 'media');
          notas.push('Tu RUT indica la actividad ' + c4 + ', que en tu RIT aparece como actividad ' + otra.orden + ' (' + otra.codigoImpreso +
            '). Tomamos la actividad ' + principal.orden + ' del RIT (' + principal.codigoImpreso + ') como principal; cámbiala si no corresponde.');
        }
      }
      if (porRespaldo) confianza = bajar(confianza, 'media');
      if (esISO(extra.fechaCese) || extra.documentoNoVerificado) confianza = bajar(confianza, 'media');
      if (extra.posibleEdicion || extra.documentoNoCoincide) confianza = 'baja';

      if (principal.enCatalogo) {
        res.campos.actividadRit = {
          valor: principal.codigo,
          etiqueta: principal.codigo + ' — ' + principal.descripcionCatalogo,
          origen: 'RIT · Actividad ' + principal.orden,
          confianza,
        };
        if (principal.noGravada) {
          avisos.push('La actividad ' + principal.codigo + ' de tu RIT figura como no sujeta o no gravada con ICA en Bogotá (tarifa 0).');
        }
      } else if (principal.enCatalogo === false && principal.sugerido) {
        const s = buscarActividad(principal.sugerido);
        res.campos.actividadRit = {
          valor: principal.sugerido,
          etiqueta: principal.sugerido + ' — ' + s.descripcion,
          origen: 'RIT · Actividad ' + principal.orden + ' (código ' + principal.codigoImpreso + ' actualizado)',
          confianza: bajar(confianza, 'media'),
        };
        avisos.push('La actividad ' + principal.codigoImpreso + ' de tu RIT es un código anterior a la Resolución SDH-000265 de 2021. ' +
          'Su equivalente actual es ' + principal.sugerido + ' — ' + s.descripcion + '; te la sugerimos, confírmala.');
      } else if (principal.enCatalogo === false) {
        const cands = principal.candidatos || [];
        avisos.push('La actividad principal de tu RIT (' + principal.codigoImpreso + ') no está en la tabla de actividades ICA del formulario. ' +
          'Elige la que corresponda en el paso «Información tributaria»' + (cands.length ? '; opciones posibles: ' + listaCodigos(cands) + '.' : '.'));
      }
      avisos.push(...notas);
      const elegida = res.campos.actividadRit ? buscarActividad(res.campos.actividadRit.valor) : null;
      if (elegida) {
        extra.tarifa = elegida.tarifa;
        extra.agrupacion = elegida.agrupacion;
      }
    }

    // ---- régimen (poco confiable: solo se comenta si puede confundir)
    if (extra.regimenNormalizado === 'PREFERENCIAL') {
      avisos.push('Tu RIT muestra el régimen ' + extra.regimen + ' del ICA. Ese dato puede estar desactualizado y no es el régimen de IVA del formulario: ese lo tomamos de tu RUT.');
    } else if (extra.regimenNormalizado === 'SIMPLE') {
      avisos.push('Tu RIT muestra el Régimen Simple de Tributación; confírmalo con tu RUT (responsabilidad 47).');
    }
    if (!datos.version && (porRespaldo || (c && c.respaldo))) avisos.push(AVISO.FORMATO);

    res.ok = !!(res.campos.actividadRit || (extra.contribuyente && extra.contribuyente.numero) || actividades.length);
    return res;
  }

  const RitParser = {
    esRit,
    parse,
    candidatosDesdeCiiu,
    buscarActividad,
    // Utilidades internas expuestas para pruebas (no son parte del contrato).
    _interno: { construirLineas, normalizarDoc, tipoPagina, fechaISO, dvNit, normCodigo, mismoDocumento, resolverFueraDeCatalogo, separarIdentificacion },
  };

  root.RitParser = RitParser;
  if (typeof module !== 'undefined' && module.exports) module.exports = RitParser;
})(typeof window !== 'undefined' ? window : globalThis);
