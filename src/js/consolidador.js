// Consolidador de formularios 13-IF-016 recibidos: lee los datos guardados dentro de cada HTML (guardado.js) y
// arma una tabla horizontal (una fila por contratista) en Excel, con los soportes adjuntos en carpetas y
// enlazados desde la fila. Todo ocurre en el navegador: los formularios no salen del equipo.
//
// API (window.Consolidador):
//   leer(texto, archivo, opts?) -> { ok: true, registro } | { ok: false, error, mensaje }
//   unificar(registros) -> { registros, duplicados }   uno por contratista y contrato (el guardado más reciente)
//   columnas() -> [{ titulo, tipo, valor(registro) }]
//   xlsx(registros, opts?) -> Promise<Uint8Array>        opts.enlaces: enlazar los soportes (dentro del ZIP)
//   zip(registros, opts?) -> Promise<Uint8Array>         Excel + soportes/CARPETA/archivo
//   nombreBase(hoy?) -> 'Consolidado_13-IF-016_aaaa-mm-dd'
//
// registro: { archivo, id, guardado, s (valores visibles, convenciones de schema.js), d (Calc.derivados),
//             pendientes, soportes (soportes.js), clave, carpeta }
(function (root) {
  'use strict';

  const SCHEMA = () => root.SCHEMA || { fields: {} };
  const CFG = () => root.CONFIG || {};
  const CAT = () => root.CATALOGOS || {};

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

  /** Soportes obligatorios que faltan (la certificación bancaria siempre; el de cada deducción marcada). */
  function soportesFaltantes(s, soportes) {
    const requeridos = ['banco'].concat(Object.keys(SOPORTE_DE_CHECK).filter((c) => s[c] === 'SI').map((c) => SOPORTE_DE_CHECK[c]));
    return requeridos.filter((c) => !((soportes || {})[c] || []).length);
  }

  /** Nombre de la carpeta de soportes: la misma regla del PDF (NOMBRE_CONTRATO_AÑO). */
  function nombreCarpeta(s) {
    if (root.ExportExcel && typeof root.ExportExcel.nombreArchivo === 'function') return root.ExportExcel.nombreArchivo(s);
    const nombre = ['primerApellido', 'segundoApellido', 'primerNombre', 'otrosNombres'].map((k) => texto(s[k]).trim()).filter(Boolean).join(' ');
    return [nombre, s.numeroContrato, s.anioContrato].filter(Boolean).join('_').toUpperCase().replace(/[^\wÁÉÍÓÚÑÜ-]+/g, '_') || 'FORMULARIO_13-IF-016';
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
    const documento = soloDigitos(s.numeroId || s.nit);
    return {
      ok: true,
      registro: {
        archivo: texto(archivo).slice(0, 200),
        id: texto(datos.id).slice(0, 80),
        guardado: /^\d{4}-\d{2}-\d{2}T/.test(texto(datos.guardado)) ? texto(datos.guardado) : '',
        s, d, pendientes, soportes,
        clave: [documento || texto(datos.id) || texto(archivo), soloDigitos(s.numeroContrato) || texto(s.numeroContrato).trim(), s.anioContrato].join('|'),
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
    // Carpetas únicas: dos contratistas con el mismo nombre y contrato no comparten carpeta.
    const usadas = new Map();
    for (const r of lista) {
      const base = r.carpeta;
      const n = (usadas.get(base) || 0) + 1;
      usadas.set(base, n);
      r.carpetaUnica = n === 1 ? base : base + '_' + n;
    }
    return { registros: lista, duplicados };
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
  const deducido = (check, clave) => (r) => (r.s[check] === 'SI' ? r.d[clave] : '');

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

  const fechaGuardado = (iso) => {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  function columnas() {
    const cols = [
      { titulo: 'Nombre completo', tipo: 'texto', valor: (r) => texto(r.d.nombreCompleto).replace(/\s+/g, ' ').trim() },
      { titulo: 'Estado', tipo: 'texto', valor: (r) => (r.pendientes ? 'Incompleto: ' + r.pendientes + (r.pendientes === 1 ? ' pendiente' : ' pendientes') : 'Completo') },
      { titulo: 'Guardado el', tipo: 'fecha', valor: (r) => fechaGuardado(r.guardado) },
      { titulo: 'Archivo recibido', tipo: 'texto', valor: (r) => r.archivo },
    ];
    for (const [id, f] of Object.entries(SCHEMA().fields)) {
      cols.push({ id, titulo: encabezado(id, f), tipo: TIPO_DE_CAMPO[f.type] || 'texto', valor: (r) => r.s[id] });
      for (const extra of DESPUES[id] || []) cols.push(extra);
    }
    cols.push({ titulo: 'Codificación tributaria', tipo: 'texto', valor: (r) => (!r.pendientes && !/^REVISE/i.test(texto(r.d.codificacion)) ? r.d.codificacion : '') });
    for (const sop of SOPORTES) cols.push({ soporte: sop.clave, titulo: sop.titulo, tipo: 'soporte' });
    cols.push({ carpeta: true, titulo: 'Carpeta de soportes', tipo: 'carpeta' });
    return cols;
  }

  // ─────────── Archivos de soportes ───────────

  const EXTENSION = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

  /** Archivos de un registro dentro del ZIP: [{ clave, ruta, item }] con nombres cortos (Certificacion_bancaria_2.pdf). */
  function archivosDe(r) {
    const out = [];
    for (const sop of SOPORTES) {
      const lista = (r.soportes || {})[sop.clave] || [];
      lista.forEach((item, i) => {
        const nombre = sop.archivo + (lista.length > 1 ? '_' + (i + 1) : '') + (EXTENSION[item.tipo] || '');
        out.push({ clave: sop.clave, ruta: 'soportes/' + (r.carpetaUnica || r.carpeta) + '/' + nombre, item });
      });
    }
    return out;
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

  // Estilos (cellXfs): 0 normal, 1 encabezado, 2 fecha, 3 pesos, 4 enlace, 5 decimal, 6 entero.
  const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;$&quot; #,##0"/></numFmts>' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '<font><u/><sz val="11"/><color rgb="FF1F3C88"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3C88"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const celdaTexto = (ref, v, estilo) => '<c r="' + ref + '" t="inlineStr"' + (estilo ? ' s="' + estilo + '"' : '') + '><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
  const celdaNumero = (ref, n, estilo) => '<c r="' + ref + '"' + (estilo ? ' s="' + estilo + '"' : '') + '><v>' + n + '</v></c>';

  /** Celda de una columna para un registro; enlaces: lista donde se agregan los hipervínculos. */
  function celda(col, r, ref, opts, enlaces) {
    if (col.tipo === 'soporte' || col.tipo === 'carpeta') {
      const archivos = archivosDe(r).filter((a) => col.carpeta || a.clave === col.soporte);
      if (!archivos.length) return '';
      const carpeta = 'soportes/' + (r.carpetaUnica || r.carpeta) + '/';
      const textoCelda = col.carpeta ? (r.carpetaUnica || r.carpeta)
        : archivos.length === 1 ? archivos[0].item.nombre : archivos.length + ' archivos';
      if (!opts.enlaces) return celdaTexto(ref, col.carpeta ? textoCelda : 'Sí (' + archivos.length + ')');
      enlaces.push({ ref, destino: col.carpeta || archivos.length > 1 ? carpeta : archivos[0].ruta });
      return celdaTexto(ref, textoCelda, 4);
    }
    const v = col.valor(r);
    if (v === '' || v == null || (typeof v === 'object')) return '';
    switch (col.tipo) {
      case 'fecha': { const n = serialFecha(v); return n == null ? celdaTexto(ref, v) : celdaNumero(ref, n, 2); }
      case 'dinero': { const n = numero(v); return n == null ? celdaTexto(ref, v) : celdaNumero(ref, Math.round(n), 3); }
      case 'decimal': { const n = numero(v); return n == null ? celdaTexto(ref, v) : celdaNumero(ref, n, 5); }
      case 'numero': { const n = numero(v); return n == null ? celdaTexto(ref, v) : celdaNumero(ref, Math.round(n), 6); }
      case 'sino': return celdaTexto(ref, v === 'SI' ? 'Sí' : v === 'NO' ? 'No' : v);
      case 'marca': return v === 'SI' ? celdaTexto(ref, 'Sí') : '';
      default: return celdaTexto(ref, v);
    }
  }

  function hoja(registros, opts) {
    const cols = columnas();
    const ultima = letraColumna(cols.length - 1);
    const enlaces = [];
    const filas = [];
    filas.push('<row r="1" ht="45" customHeight="1">' + cols.map((c, i) => celdaTexto(letraColumna(i) + '1', c.titulo, 1)).join('') + '</row>');
    registros.forEach((r, k) => {
      const n = k + 2;
      filas.push('<row r="' + n + '">' + cols.map((c, i) => celda(c, r, letraColumna(i) + n, opts, enlaces)).join('') + '</row>');
    });
    const ancho = (c) => Math.min(48, Math.max(12, Math.ceil(c.titulo.length * 0.9) + 2, c.tipo === 'texto' ? 18 : 12));
    const anchos = '<cols>' + cols.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (i === 0 ? 34 : ancho(c)) + '" customWidth="1"/>').join('') + '</cols>';
    const vista = '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>' +
      '<selection pane="bottomRight" activeCell="B2" sqref="B2"/></sheetView></sheetViews>';
    const filtro = '<autoFilter ref="A1:' + ultima + Math.max(1, registros.length + 1) + '"/>';
    const vinculos = enlaces.length
      ? '<hyperlinks>' + enlaces.map((e, i) => '<hyperlink ref="' + e.ref + '" r:id="rId' + (i + 1) + '"/>').join('') + '</hyperlinks>' : '';
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<dimension ref="A1:' + ultima + (registros.length + 1) + '"/>' + vista + '<sheetFormatPr defaultRowHeight="15"/>' + anchos +
      '<sheetData>' + filas.join('') + '</sheetData>' + filtro + vinculos + '</worksheet>';
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
  function libroXlsx(registros, opts) {
    const o = opts || {};
    const JSZip = libJSZip();
    const zip = new JSZip();
    const h = hoja(registros, o);
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
      '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Contratistas!$A$1:$' + h.ultima + '$' + Math.max(1, registros.length + 1) + '</definedName></definedNames>' +
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

  function xlsx(registros, opts) {
    return libroXlsx(registros, opts).generateAsync(salida);
  }

  const hoyIso = (hoy) => {
    const d = hoy instanceof Date ? hoy : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  function nombreBase(hoy) {
    return 'Consolidado_13-IF-016_' + hoyIso(hoy);
  }

  /** ZIP con una carpeta: el Excel (con enlaces relativos) y soportes/CARPETA/archivo. */
  async function zip(registros, opts) {
    const o = opts || {};
    const base = o.nombre || nombreBase(o.hoy);
    const JSZip = libJSZip();
    const z = new JSZip();
    const carpeta = z.folder(base);
    carpeta.file(base + '.xlsx', await xlsx(registros, { enlaces: true }));
    for (const r of registros) {
      for (const a of archivosDe(r)) carpeta.file(a.ruta, a.item.datos, { base64: true });
    }
    return z.generateAsync(salida);
  }

  const Consolidador = { leer, unificar, columnas, xlsx, zip, nombreBase, archivosDe, letraColumna, serialFecha };
  root.Consolidador = Consolidador;
  if (typeof module !== 'undefined' && module.exports) module.exports = Consolidador;
})(typeof window !== 'undefined' ? window : globalThis);
