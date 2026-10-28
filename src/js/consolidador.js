// Consolidador de formularios 13-IF-016 recibidos: lee los datos guardados dentro de cada HTML (guardado.js) y
// arma una tabla horizontal (una fila por contratista) en Excel, con los soportes adjuntos organizados en una
// carpeta por contratista y enlazados desde la fila. Todo ocurre en el navegador: nada sale del equipo.
//
// Carpeta raíz del consolidado (consolidador-ui.js la escribe):
//   Consolidado_13-IF-016.xlsx
//   Contratistas/AÑO/NOMBRE/Certificacion_bancaria.pdf, Soporte_dependiente_1.pdf, …, Formulario.html
//   (si el mismo nombre ya tiene carpeta ese año: AÑO/NOMBRE_NUMEROCONTRATO)
//
// API (window.Consolidador):
//   leer(texto, archivo, opts?) -> { ok: true, registro } | { ok: false, error, mensaje }
//   unificar(registros) -> { registros, duplicados }   uno por contratista y contrato (el guardado más reciente)
//   leerXlsx(bytes) -> Promise<{ encabezados, extras, filas: [{ titulo: valor }] }>   un consolidado existente
//   combinar(filasExistentes, registros) -> { filas, nuevos, actualizados, sinCambios }
//   xlsx(filas | registros, opts?) -> Promise<Uint8Array>
//        opts.enlaces: enlazar soportes · opts.extras: columnas agregadas a mano · opts.archivosDeFila(fila)
//   zip(registros, opts?) -> Promise<Uint8Array>   carpeta con el Excel y Contratistas/CARPETA/archivo
//   claseDeArchivo(nombre) -> clave del soporte ('banco'…) o ''
//
// registro: { archivo, id, guardado, s (valores visibles, convenciones de schema.js), d (Calc.derivados),
//             pendientes, soportes (soportes.js), clave, carpeta }
// fila: { registro } (de un formulario) | { existente: { titulo: valor }, clave, carpeta, guardado } (del Excel)
(function (root) {
  'use strict';

  const SCHEMA = () => root.SCHEMA || { fields: {} };
  const CFG = () => root.CONFIG || {};
  const CAT = () => root.CATALOGOS || {};

  const NOMBRE_EXCEL = 'Consolidado_13-IF-016.xlsx';
  const CARPETA_CONTRATISTAS = 'Contratistas';
  const NOMBRE_FORMULARIO = 'Formulario.html';

  function error(codigo, mensaje) {
    return { ok: false, error: codigo, mensaje };
  }

  const texto = (v) => (v == null ? '' : String(v));
  const soloDigitos = (v) => texto(v).replace(/\D/g, '');

  // ─────────── Lectura de un formulario ───────────

  const visibleEn = (f, s) => {
    try { return typeof f.visible === 'function' ? !!f.visible(s) : true; } catch (e) { return true; }
  };

  /** Valores normalizados como los ve el formulario, con los campos ocultos vacíos (lo que va al PDF). */
  function estadoVisible(origen) {
    const campos = SCHEMA().fields;
    const s = {};
    for (const [id, f] of Object.entries(campos)) s[id] = f.porDefecto != null ? String(f.porDefecto) : '';
    let valores = {};
    if (root.Calc && typeof root.Calc.normalizarEstado === 'function') valores = root.Calc.normalizarEstado(origen || {}).valores || {};
    else for (const id of Object.keys(campos)) if (origen && origen[id] != null && typeof origen[id] !== 'object') valores[id] = String(origen[id]);
    Object.assign(s, valores);
    const limpio = {};
    for (const [id, f] of Object.entries(campos)) limpio[id] = visibleEn(f, s) ? texto(s[id]) : '';
    return limpio;
  }

  const SOPORTE_DE_CHECK = { dedDependientes: 'dependientes', dedHipotecario: 'hipotecario', dedSaludNoPos: 'saludNoPos' };

  /** Hijos menores de 18 y de 18 a 23 que estudian: el formato dice «No se requiere» anexo (motivos 1 y 2). */
  function dependienteSinSoporte(s) {
    const m = (CAT().motivosDependientes || []).find((x) => x.texto === s.depMotivo);
    return !!m && /no se requiere/i.test(String(m.anexo || ''));
  }

  /** Soportes obligatorios que faltan (la certificación bancaria siempre; el de cada deducción marcada). */
  function soportesFaltantes(s, soportes) {
    const requeridos = ['banco'].concat(Object.keys(SOPORTE_DE_CHECK).filter((c) => s[c] === 'SI').map((c) => SOPORTE_DE_CHECK[c]))
      .filter((c) => c !== 'dependientes' || !dependienteSinSoporte(s));
    return requeridos.filter((c) => !((soportes || {})[c] || []).length);
  }

  /** Nombre del contratista para su carpeta (APELLIDOS_NOMBRES, con la misma limpieza del nombre del PDF). */
  function nombreContratista(s) {
    const partes = { primerApellido: s.primerApellido, segundoApellido: s.segundoApellido, primerNombre: s.primerNombre, otrosNombres: s.otrosNombres };
    if (root.ExportExcel && typeof root.ExportExcel.nombreArchivo === 'function') return root.ExportExcel.nombreArchivo(partes);
    const nombre = Object.values(partes).map((v) => texto(v).trim()).filter(Boolean).join(' ');
    return nombre.toUpperCase().replace(/[^\wÁÉÍÓÚÑÜ-]+/g, '_') || 'FORMULARIO_13-IF-016';
  }

  /** Carpeta del contratista dentro de Contratistas/: AÑO/NOMBRE (al abrir el año salen todos sus contratistas). */
  function nombreCarpeta(s) {
    return (soloDigitos(s.anioContrato) || 'SIN_AÑO') + '/' + nombreContratista(s);
  }

  /** Clave de contratista y contrato: documento | número de contrato | año. */
  function clave(documento, numeroContrato, anio, respaldo) {
    return [soloDigitos(documento) || texto(respaldo), soloDigitos(numeroContrato) || texto(numeroContrato).trim(), texto(anio).trim()].join('|');
  }

  /**
   * Lee un HTML recibido. Errores: NO_FORMULARIO (no trae el bloque de datos), SIN_DATOS (formulario en limpio),
   * OTRO_FORMATO (datos de otro formato).
   */
  function leer(contenido, archivo, opts) {
    const o = opts || {};
    const G = root.Guardado;
    const datos = G && typeof G.leerDeTexto === 'function' ? G.leerDeTexto(contenido) : null;
    if (!datos) return error('NO_FORMULARIO', 'No es un formulario 13-IF-016 con datos guardados.');
    const formato = (CFG().formato && CFG().formato.codigo) || '13-IF-016';
    if (datos.formato && datos.formato !== formato) return error('OTRO_FORMATO', 'Es de otro formato (' + texto(datos.formato).slice(0, 30) + ').');
    const s = estadoVisible(datos.s || datos.datos || {});
    // Como tieneDatos() del formulario: un valor por defecto (tipo de documento) no cuenta como dato.
    const campos = SCHEMA().fields;
    const usados = Object.keys(s).filter((id) => s[id] && s[id] !== texto(campos[id] && campos[id].porDefecto)).length;
    if (!usados) return error('SIN_DATOS', 'El formulario está en limpio (no tiene datos).');
    const soportes = root.Soportes ? root.Soportes.normalizar(datos.soportes) : {};
    let d = {};
    let pendientes = 0;
    try { d = root.Calc ? root.Calc.derivados(s, o.hoy) || {} : {}; } catch (e) { d = {}; }
    try {
      const v = root.Calc ? root.Calc.validar(s, o.hoy) : null;
      if (v) pendientes = (v.faltantes || []).length + Object.values(v.errores || {}).filter(Boolean).length;
    } catch (e) { pendientes = 0; }
    pendientes += soportesFaltantes(s, soportes).length;
    return {
      ok: true,
      registro: {
        archivo: texto(archivo).slice(0, 200),
        id: texto(datos.id).slice(0, 80),
        guardado: /^\d{4}-\d{2}-\d{2}T/.test(texto(datos.guardado)) ? texto(datos.guardado) : '',
        s, d, pendientes, soportes,
        clave: clave(s.numeroId || s.nit, s.numeroContrato, s.anioContrato, texto(datos.id) || texto(archivo)),
        carpeta: nombreCarpeta(s),
      },
    };
  }

  /** Un registro por contratista y contrato: el guardado más reciente. Ordena por nombre. */
  function unificar(registros) {
    const porClave = new Map();
    const duplicados = [];
    for (const r of registros || []) {
      const previo = porClave.get(r.clave);
      if (!previo) { porClave.set(r.clave, r); continue; }
      const nuevoGana = r.guardado > previo.guardado;
      duplicados.push(nuevoGana ? previo : r);
      if (nuevoGana) porClave.set(r.clave, r);
    }
    const lista = Array.from(porClave.values());
    const nombre = (r) => texto(r.d.nombreCompleto || r.carpeta).toLocaleUpperCase('es-CO');
    lista.sort((a, b) => nombre(a).localeCompare(nombre(b), 'es') || a.clave.localeCompare(b.clave));
    asignarCarpetas(lista, new Set());
    return { registros: lista, duplicados };
  }

  /**
   * Carpetas únicas: si el mismo nombre ya tiene carpeta ese año (otro contrato u otra persona homónima), se le
   * agrega el número de contrato (AÑO/NOMBRE_1234) y, si aún choca, un consecutivo.
   */
  function asignarCarpetas(registros, usadas) {
    const libre = (c) => !usadas.has(c.toLocaleUpperCase('es-CO'));
    for (const r of registros) {
      const contrato = soloDigitos(r.s && r.s.numeroContrato);
      let nombre = r.carpeta;
      if (!libre(nombre) && contrato) nombre = r.carpeta + '_' + contrato;
      for (let n = 2; !libre(nombre); n++) nombre = r.carpeta + (contrato ? '_' + contrato : '') + '_' + n;
      usadas.add(nombre.toLocaleUpperCase('es-CO'));
      r.carpetaUnica = nombre;
    }
  }

  // ─────────── Columnas ───────────

  const ENCABEZADOS = {
    pensionado: '¿Pensionado?',
    direccion: 'Dirección (RUT)',
    cesion: '¿Contrato cedido?',
    rpVigenciaFutura: '¿Vigencias futuras?',
    interventorNombre: 'Supervisor',
    interventorCargo: 'Cargo del supervisor',
    dedDependientes: 'Deducción por dependientes',
    dedHipotecario: 'Deducción por intereses hipotecarios',
    dedSaludNoPos: 'Deducción por salud no POS',
    afc: '¿Aportes a AFC?',
    pensionesVoluntarias: '¿Aportes a pensiones voluntarias?',
  };
  const CON_GRUPO = ['Dependiente', 'Salud no POS', 'Crédito hipotecario'];

  function encabezado(id, f) {
    const cfg = CFG();
    const preguntas = {
      c1: 'C1 · ¿Ingresos ' + (cfg.anioGravable || '') + ' superiores a ' + (cfg.ingresosC1Uvt || 1400).toLocaleString('es-CO') + ' UVT?',
      c2: 'C2 · ¿Obligado a declarar renta ' + (cfg.anioGravable || '') + '?',
      c3: 'C3 · ¿Régimen Simple?',
      c4: 'C4 · ¿Resta costos y gastos?',
    };
    if (preguntas[id]) return preguntas[id];
    if (ENCABEZADOS[id]) return ENCABEZADOS[id];
    return CON_GRUPO.includes(f.grupo) ? f.grupo + ' · ' + f.label : f.label;
  }

  const TIPO_DE_CAMPO = { money: 'dinero', date: 'fecha', yesno: 'sino', check: 'marca' };

  const descArl = (codigo) => {
    const a = (CAT().arl || []).find((x) => String(x.codigo) === String(codigo));
    return a ? a.descripcion : '';
  };
  const deducido = (check, campo) => (r) => (r.s[check] === 'SI' ? r.d[campo] : '');

  // Valores calculados que se agregan después de un campo.
  const DESPUES = {
    numeroCuenta: [{ titulo: 'Identificación del titular', tipo: 'texto', valor: (r) => (r.s.nit ? r.d.identificacionTitular : '') }],
    actividadRut: [{ titulo: 'Descripción actividad RUT', tipo: 'texto', valor: (r) => (r.s.actividadRut ? r.d.descCiiu : '') }],
    actividadRit: [
      { titulo: 'Descripción actividad RIT', tipo: 'texto', valor: (r) => (r.s.actividadRit ? r.d.descRit : '') },
      { titulo: 'Tarifa ICA (por mil)', tipo: 'decimal', valor: (r) => (r.s.actividadRit ? r.d.tarifaRit : '') },
    ],
    fechaTerminacion: [
      { titulo: 'Duración (días)', tipo: 'numero', valor: (r) => (r.s.valorTotal && r.s.valorMensual ? r.d.duracionDiasRedondeada : '') },
      { titulo: 'Valor sin IVA', tipo: 'dinero', valor: (r) => (r.s.valorTotal ? r.d.valorSinIva : '') },
      { titulo: 'IVA', tipo: 'dinero', valor: (r) => (r.s.valorTotal ? r.d.valorIva : '') },
    ],
    codigoArl: [{ titulo: 'Descripción ARL', tipo: 'texto', valor: (r) => descArl(r.s.codigoArl) }],
    depMotivo: [{ titulo: 'Dependiente · Valor mensual a deducir', tipo: 'dinero', valor: deducido('dedDependientes', 'depValorMensual') }],
    saludFechaCorte: [{ titulo: 'Salud no POS · Valor mensual a deducir', tipo: 'dinero', valor: deducido('dedSaludNoPos', 'saludValorMensual') }],
    hipTitulares: [{ titulo: 'Crédito hipotecario · Valor mensual a deducir', tipo: 'dinero', valor: deducido('dedHipotecario', 'hipValorMensual') }],
  };

  const SOPORTES = [
    { clave: 'banco', titulo: 'Certificación bancaria', archivo: 'Certificacion_bancaria' },
    { clave: 'dependientes', titulo: 'Soportes del dependiente', archivo: 'Soporte_dependiente' },
    { clave: 'hipotecario', titulo: 'Certificado de intereses', archivo: 'Certificado_intereses' },
    { clave: 'saludNoPos', titulo: 'Certificado de salud no POS', archivo: 'Certificado_salud' },
  ];

  const TITULO_GUARDADO = 'Guardado el';
  const TITULO_CARPETA = 'Carpeta del contratista';

  function columnas() {
    const cols = [
      { titulo: 'Nombre completo', tipo: 'texto', valor: (r) => texto(r.d.nombreCompleto).replace(/\s+/g, ' ').trim() },
      { titulo: 'Estado', tipo: 'texto', valor: (r) => (r.pendientes ? 'Incompleto: ' + r.pendientes + (r.pendientes === 1 ? ' pendiente' : ' pendientes') : 'Completo') },
      { titulo: TITULO_GUARDADO, tipo: 'fechaHora', valor: (r) => r.guardado },
      { titulo: 'Archivo recibido', tipo: 'texto', valor: (r) => r.archivo },
    ];
    for (const [id, f] of Object.entries(SCHEMA().fields)) {
      cols.push({ id, titulo: encabezado(id, f), tipo: TIPO_DE_CAMPO[f.type] || 'texto', valor: (r) => r.s[id] });
      for (const extra of DESPUES[id] || []) cols.push(extra);
    }
    cols.push({ titulo: 'Codificación tributaria', tipo: 'texto', valor: (r) => (!r.pendientes && !/^REVISE/i.test(texto(r.d.codificacion)) ? r.d.codificacion : '') });
    for (const sop of SOPORTES) cols.push({ soporte: sop.clave, titulo: sop.titulo, tipo: 'soporte' });
    cols.push({ carpeta: true, titulo: TITULO_CARPETA, tipo: 'carpeta' });
    return cols;
  }

  const tituloDe = (id) => encabezado(id, SCHEMA().fields[id] || { label: id });

  // ─────────── Archivos de cada contratista ───────────

  const EXTENSION = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
  const rutaCarpeta = (carpeta) => CARPETA_CONTRATISTAS + '/' + carpeta + '/';

  /** Archivos de soporte de un registro: [{ clave, ruta, nombre, item }] con nombres cortos (Certificacion_bancaria_2.pdf). */
  function archivosDe(r) {
    const out = [];
    for (const sop of SOPORTES) {
      const lista = (r.soportes || {})[sop.clave] || [];
      lista.forEach((item, i) => {
        const nombre = sop.archivo + (lista.length > 1 ? '_' + (i + 1) : '') + (EXTENSION[item.tipo] || '');
        out.push({ clave: sop.clave, ruta: rutaCarpeta(r.carpetaUnica || r.carpeta) + nombre, nombre, item });
      });
    }
    return out;
  }

  /** Tipo de soporte de un archivo de la carpeta del contratista, por su nombre ('' si no es un soporte). */
  function claseDeArchivo(nombre) {
    const m = /^([A-Za-z_]+?)(?:_\d+)?\.(pdf|jpe?g|png)$/i.exec(texto(nombre));
    const sop = m && SOPORTES.find((s) => s.archivo.toLowerCase() === m[1].toLowerCase());
    return sop ? sop.clave : '';
  }

  // ─────────── Lectura de un consolidado existente ───────────

  const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const desescapar = (t) => texto(t)
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : ENTIDADES[e.toLowerCase()]))
    .replace(/_x([0-9A-F]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));

  /** Texto de un <is> o <si>: une los <t> (también los de texto enriquecido). */
  const textoDeNodo = (xml) => Array.from(texto(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)).map((m) => desescapar(m[1] || '')).join('');

  function indiceColumna(ref) {
    const letras = (/^[A-Z]+/.exec(ref) || [''])[0];
    let n = 0;
    for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
    return n - 1;
  }

  /**
   * Primera hoja de un .xlsx como tabla: encabezados (fila 1), filas como { titulo: valor } (texto o número) y
   * extras (encabezados que no son columnas del consolidado: las agregadas a mano). Sirve para el archivo que
   * genera este módulo y para el mismo archivo guardado de nuevo con Excel (textos compartidos, estilos propios).
   */
  async function leerXlsx(bytes) {
    const z = await libJSZip().loadAsync(bytes);
    const leerTexto = async (ruta) => (z.file(ruta) ? z.file(ruta).async('string') : '');
    const libro = await leerTexto('xl/workbook.xml');
    const idHoja = (/<sheet\b[^>]*\br:id="([^"]+)"/.exec(libro) || [])[1];
    const relaciones = await leerTexto('xl/_rels/workbook.xml.rels');
    let destino = 'worksheets/sheet1.xml';
    for (const m of relaciones.matchAll(/<Relationship\b[^>]*>/g)) {
      if (idHoja && new RegExp('\\bId="' + idHoja + '"').test(m[0])) destino = (/\bTarget="([^"]+)"/.exec(m[0]) || [])[1] || destino;
    }
    const rutaHoja = destino.startsWith('/') ? destino.slice(1) : 'xl/' + destino;
    const hoja = await leerTexto(rutaHoja);
    if (!hoja) throw new Error('El archivo no tiene hojas.');
    const compartidos = Array.from((await leerTexto('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) => textoDeNodo(m[1]));
    const tabla = new Map();
    for (const fila of hoja.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      for (const c of texto(fila[1]).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = (/\br="([A-Z]+)(\d+)"/.exec(attrs) || []);
        if (!ref[1]) continue;
        const tipo = (/\bt="(\w+)"/.exec(attrs) || [])[1] || 'n';
        const contenido = c[2] || '';
        const v = (/<v>([\s\S]*?)<\/v>/.exec(contenido) || [])[1];
        let valor;
        if (tipo === 's') valor = compartidos[Number(v)] || '';
        else if (tipo === 'inlineStr') valor = textoDeNodo(contenido);
        else if (tipo === 'str' || tipo === 'e') valor = desescapar(v || '');
        else if (tipo === 'b') valor = v === '1' ? 'VERDADERO' : 'FALSO';
        else valor = v === undefined || v === '' ? '' : Number(v);
        if (valor === '' || (typeof valor === 'number' && !Number.isFinite(valor))) continue;
        const n = Number(ref[2]);
        if (!tabla.has(n)) tabla.set(n, []);
        tabla.get(n)[indiceColumna(ref[1])] = valor;
      }
    }
    const numeros = Array.from(tabla.keys()).sort((a, b) => a - b);
    if (!numeros.length) return { encabezados: [], extras: [], filas: [] };
    const encabezados = Array.from(tabla.get(numeros[0]) || [], (v) => texto(v).trim());
    const filas = [];
    for (const n of numeros.slice(1)) {
      const celdas = tabla.get(n);
      const f = {};
      encabezados.forEach((t, i) => { if (t && celdas[i] !== undefined && celdas[i] !== '') f[t] = celdas[i]; });
      if (Object.keys(f).length) filas.push(f);
    }
    const conocidos = new Set(columnas().map((c) => c.titulo));
    const extras = encabezados.filter((t) => t && !conocidos.has(t));
    return { encabezados, extras, filas };
  }

  // ─────────── Combinar con un consolidado existente ───────────

  /** Serial de Excel (días desde 1899-12-30, con la hora local como fracción) de una fecha ISO con hora. */
  function serialFechaHora(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return null;
    return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - Date.UTC(1899, 11, 30)) / 86400000;
  }

  function filaExistente(valores) {
    const v = (id) => valores[tituloDe(id)];
    return {
      existente: valores,
      clave: clave(v('numeroId') || v('nit'), v('numeroContrato'), v('anioContrato'), valores['Archivo recibido']),
      carpeta: texto(valores[TITULO_CARPETA]).trim(),
      guardado: typeof valores[TITULO_GUARDADO] === 'number' ? valores[TITULO_GUARDADO] : null,
    };
  }

  /**
   * Agrega los registros (ya unificados) a las filas de un consolidado: contratista y contrato nuevos van al
   * final; si ya está y el formulario es más reciente, reemplaza su fila (y conserva su carpeta); si no, no cambia.
   * Marca cada registro con r.resultado: 'nuevo' | 'actualizado' | 'sin-cambios'.
   */
  function combinar(existentes, registros) {
    const filas = (existentes || []).map(filaExistente);
    const indice = new Map();
    filas.forEach((f, i) => { if (!indice.has(f.clave)) indice.set(f.clave, i); });
    const usadas = new Set(filas.map((f) => f.carpeta.toLocaleUpperCase('es-CO')).filter(Boolean));
    const nuevos = [];
    const actualizados = [];
    const sinCambios = [];
    for (const r of registros || []) {
      const i = indice.get(r.clave);
      if (i === undefined) { nuevos.push(r); continue; }
      const previa = filas[i];
      const serial = serialFechaHora(r.guardado);
      // Un segundo de margen: el Excel guarda la hora con decimales.
      if (previa.guardado != null && (serial == null || serial <= previa.guardado + 1 / 86400)) {
        r.resultado = 'sin-cambios';
        sinCambios.push(r);
        continue;
      }
      r.resultado = 'actualizado';
      r.carpetaUnica = previa.carpeta || r.carpeta;
      usadas.add(r.carpetaUnica.toLocaleUpperCase('es-CO'));
      // Lo escrito a mano en columnas propias de Tesorería (observaciones…) se conserva al actualizar.
      filas[i] = { registro: r, previa: previa.existente };
      actualizados.push(r);
    }
    asignarCarpetas(nuevos, usadas);
    for (const r of nuevos) { r.resultado = 'nuevo'; filas.push({ registro: r }); }
    return { filas, nuevos, actualizados, sinCambios };
  }

  // ─────────── Excel (SpreadsheetML mínimo) ───────────

  // eslint-disable-next-line no-control-regex
  const xml = (t) => texto(t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function letraColumna(n) {
    let s = '';
    for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    return s;
  }

  function serialFecha(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(iso));
    if (!m) return null;
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  const numero = (v) => {
    if (v === '' || v == null || typeof v === 'object') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Estilos (cellXfs): 0 normal, 1 encabezado, 2 fecha, 3 pesos, 4 enlace, 5 decimal, 6 entero, 7 fecha y hora.
  const ESTILO_DE_TIPO = { fecha: 2, dinero: 3, decimal: 5, numero: 6, fechaHora: 7 };
  const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;$&quot; #,##0"/>' +
    '<numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm"/></numFmts>' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '<font><u/><sz val="11"/><color rgb="FF1F3C88"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3C88"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const celdaTexto = (ref, v, estilo) => '<c r="' + ref + '" t="inlineStr"' + (estilo ? ' s="' + estilo + '"' : '') + '><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
  const celdaNumero = (ref, n, estilo) => '<c r="' + ref + '"' + (estilo ? ' s="' + estilo + '"' : '') + '><v>' + n + '</v></c>';

  /** Valor tal como vino del Excel: los números conservan el formato de su columna. */
  function celdaCruda(ref, v, tipo) {
    if (v === '' || v == null) return '';
    return typeof v === 'number' ? celdaNumero(ref, v, ESTILO_DE_TIPO[tipo] || 0) : celdaTexto(ref, v);
  }

  /** Archivos de soporte de una fila: los de la carpeta (opts.archivosDeFila) o, sin ella, los del formulario. */
  function soportesDeFila(fila, opts) {
    if (typeof opts.archivosDeFila === 'function') return opts.archivosDeFila(fila) || [];
    return fila.registro ? archivosDe(fila.registro).map((a) => ({ clave: a.clave, ruta: a.ruta, nombre: a.item.nombre })) : null;
  }

  const carpetaDeFila = (fila) => (fila.registro ? fila.registro.carpetaUnica || fila.registro.carpeta : fila.carpeta);

  /** Celda de una columna para una fila; enlaces: lista donde se agregan los hipervínculos. */
  function celda(col, fila, ref, opts, enlaces) {
    if (col.tipo === 'soporte' || col.tipo === 'carpeta') {
      const todos = soportesDeFila(fila, opts);
      // Fila del Excel sin acceso a su carpeta: se deja el texto que tenía.
      if (todos === null) return celdaCruda(ref, fila.existente && fila.existente[col.titulo], 'texto');
      const carpeta = carpetaDeFila(fila);
      const archivos = todos.filter((a) => col.carpeta || a.clave === col.soporte);
      if (col.carpeta) {
        if (!carpeta) return '';
        if (opts.enlaces && (archivos.length || fila.registro || opts.archivosDeFila)) enlaces.push({ ref, destino: rutaCarpeta(carpeta) });
        return celdaTexto(ref, carpeta, opts.enlaces ? 4 : 0);
      }
      if (!archivos.length) return '';
      if (!opts.enlaces) return celdaTexto(ref, 'Sí (' + archivos.length + ')');
      enlaces.push({ ref, destino: archivos.length > 1 ? rutaCarpeta(carpeta) : archivos[0].ruta });
      return celdaTexto(ref, archivos.length === 1 ? archivos[0].nombre : archivos.length + ' archivos', 4);
    }
    if (col.extra) return celdaCruda(ref, (fila.existente || fila.previa || {})[col.titulo], col.tipo);
    if (fila.existente) return celdaCruda(ref, fila.existente[col.titulo], col.tipo);
    const v = col.valor(fila.registro);
    if (v === '' || v == null || (typeof v === 'object')) return '';
    switch (col.tipo) {
      case 'fecha': { const n = serialFecha(v); return n == null ? celdaTexto(ref, v) : celdaNumero(ref, n, 2); }
      case 'fechaHora': { const n = serialFechaHora(v); return n == null ? '' : celdaNumero(ref, Math.round(n * 86400) / 86400, 7); }
      case 'dinero': { const n = numero(v); return n == null ? celdaTexto(ref, v) : celdaNumero(ref, Math.round(n), 3); }
      case 'decimal': { const n = numero(v); return n == null ? celdaTexto(ref, v) : celdaNumero(ref, n, 5); }
      case 'numero': { const n = numero(v); return n == null ? celdaTexto(ref, v) : celdaNumero(ref, Math.round(n), 6); }
      case 'sino': return celdaTexto(ref, v === 'SI' ? 'Sí' : v === 'NO' ? 'No' : v);
      case 'marca': return v === 'SI' ? celdaTexto(ref, 'Sí') : '';
      default: return celdaTexto(ref, v);
    }
  }

  function hoja(filas, opts) {
    const cols = columnas().concat((opts.extras || []).map((t) => ({ titulo: t, tipo: 'texto', extra: true })));
    const ultima = letraColumna(cols.length - 1);
    const enlaces = [];
    const xmlFilas = [];
    xmlFilas.push('<row r="1" ht="45" customHeight="1">' + cols.map((c, i) => celdaTexto(letraColumna(i) + '1', c.titulo, 1)).join('') + '</row>');
    filas.forEach((f, k) => {
      const n = k + 2;
      xmlFilas.push('<row r="' + n + '">' + cols.map((c, i) => celda(c, f, letraColumna(i) + n, opts, enlaces)).join('') + '</row>');
    });
    const ancho = (c) => Math.min(48, Math.max(12, Math.ceil(c.titulo.length * 0.9) + 2, c.tipo === 'texto' ? 18 : c.tipo === 'fechaHora' ? 17 : 12));
    const anchos = '<cols>' + cols.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (i === 0 ? 34 : ancho(c)) + '" customWidth="1"/>').join('') + '</cols>';
    const vista = '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>' +
      '<selection pane="bottomRight" activeCell="B2" sqref="B2"/></sheetView></sheetViews>';
    const filtro = '<autoFilter ref="A1:' + ultima + Math.max(1, filas.length + 1) + '"/>';
    const vinculos = enlaces.length
      ? '<hyperlinks>' + enlaces.map((e, i) => '<hyperlink ref="' + e.ref + '" r:id="rId' + (i + 1) + '"/>').join('') + '</hyperlinks>' : '';
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<dimension ref="A1:' + ultima + (filas.length + 1) + '"/>' + vista + '<sheetFormatPr defaultRowHeight="15"/>' + anchos +
      '<sheetData>' + xmlFilas.join('') + '</sheetData>' + filtro + vinculos + '</worksheet>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      enlaces.map((e, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' +
        xml(e.destino) + '" TargetMode="External"/>').join('') + '</Relationships>';
    return { sheet, rels: enlaces.length ? rels : null, ultima };
  }

  function libJSZip() {
    const Z = root.JSZip || (typeof require === 'function' ? require('jszip') : null);
    if (!Z) throw new Error('JSZip no está disponible.');
    return Z;
  }

  /** Paquete JSZip del libro de Excel (una hoja "Contratistas"). */
  function libroXlsx(filas, opts) {
    const JSZip = libJSZip();
    const zip = new JSZip();
    const h = hoja(filas, opts);
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Contratistas" sheetId="1" r:id="rId1"/></sheets>' +
      '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Contratistas!$A$1:$' + h.ultima + '$' + Math.max(1, filas.length + 1) + '</definedName></definedNames>' +
      '</workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>');
    zip.file('xl/styles.xml', ESTILOS);
    zip.file('xl/worksheets/sheet1.xml', h.sheet);
    if (h.rels) zip.file('xl/worksheets/_rels/sheet1.xml.rels', h.rels);
    return zip;
  }

  const salida = { type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' };

  /** Excel de filas ({ registro } o { existente }) o, por comodidad, de una lista de registros. */
  function xlsx(filas, opts) {
    const lista = (filas || []).map((f) => (f && (f.registro || f.existente) ? f : { registro: f }));
    return libroXlsx(lista, opts || {}).generateAsync(salida);
  }

  const hoyIso = (hoy) => {
    const d = hoy instanceof Date ? hoy : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  function nombreBase(hoy) {
    return 'Consolidado_13-IF-016_' + hoyIso(hoy);
  }

  /** ZIP con una carpeta: el Excel (con enlaces relativos) y Contratistas/CARPETA/archivo. */
  async function zip(registros, opts) {
    const o = opts || {};
    const base = o.nombre || nombreBase(o.hoy);
    const z = new (libJSZip())();
    const carpeta = z.folder(base);
    carpeta.file(base + '.xlsx', await xlsx(registros, { enlaces: true }));
    for (const r of registros) {
      for (const a of archivosDe(r)) carpeta.file(a.ruta, a.item.datos, { base64: true });
    }
    return z.generateAsync(salida);
  }

  const Consolidador = {
    NOMBRE_EXCEL, CARPETA_CONTRATISTAS, NOMBRE_FORMULARIO,
    leer, unificar, columnas, leerXlsx, combinar, xlsx, zip, nombreBase, archivosDe, claseDeArchivo, rutaCarpeta,
    letraColumna, serialFecha, serialFechaHora,
  };
  root.Consolidador = Consolidador;
  if (typeof module !== 'undefined' && module.exports) module.exports = Consolidador;
})(typeof window !== 'undefined' ? window : globalThis);
