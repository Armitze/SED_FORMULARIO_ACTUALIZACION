// window.Calc — cálculos del formato 13-IF-016 con paridad exacta frente a las fórmulas del Excel.
//
// El Excel se modela como un mapa de celdas 'hoja!CELDA' (hoja: 'datos' | 'deducciones' | 'validador').
//   1. celdasEntrada(s)   convierte el estado del formulario en los valores que tendrían las celdas de
//                         entrada del Excel (mismo criterio que debe usar la exportación).
//   2. evaluar(celdas, h) transcribe una a una las fórmulas del Excel (con sus rarezas) sobre esas celdas.
//   3. derivados(s, hoy)  devuelve los valores calculados con nombres amigables + `celdas` (valores exactos).
//   4. validar(s, hoy)    revisión amigable (faltantes, errores de formato y advertencias).
//
// Convenciones de valores tipo Excel: celda vacía = null, texto = string, número = number,
// booleano = boolean, error = { error: '#N/A' }. Comparaciones de texto sin distinguir mayúsculas,
// como Excel. Las fechas son números de serie (sistema 1900).
(function (root) {
  'use strict';

  const HOJAS = { datos: 'FORMATO ACTUALIZACIÓN DATOS', deducciones: 'FORMATO DEDUCCIONES', validador: 'Validador- Datos' };
  const TXT_NO_EXISTE = 'Actividad economica NO existe - por favor verificar';
  const TXT_REVISE = 'REVISE SU INFORMACIÓN TRIBUTARIA';
  const TXT_IVA_CUANTIA = 'VERIFICAR RESPONSABILIDAD DE IVA POR CUANTIA DEL CONTRATO';
  const TXT_SIN_DILIGENCIAR = 'Formulario sin diligenciar'; // 'Validador- Datos'!D67
  const TXT_SOPORTES = 'Como soporte se anexa la siguiente documentación:'; // 'FORMATO DEDUCCIONES'!B30
  const TOTAL_VALIDADOR = 54; // filas B3:B56

  // Tabla 'Validador- Datos'!BI13:BJ17 (año de los certificados según la fecha de hoy).
  // Se transcribe literal porque la fórmula BJ12:BK12 depende de estas fechas fijas.
  const TABLA_CERTIFICADOS = [
    { fecha: '2023-04-01', antes: 2021, desde: 2022 },
    { fecha: '2024-04-01', antes: 2022, desde: 2023 },
    { fecha: '2025-04-01', antes: 2023, desde: 2024 },
    { fecha: '2026-04-01', antes: 2024, desde: 2025 },
    { fecha: '2027-04-01', antes: 2025, desde: 2026 },
  ];

  // Textos de 'Validador- Datos'!C3:C53 (se concatenan en el mensaje del formulario) y su campo.
  const FILAS_VALIDADOR = [
    [3, 'Número de Identificación Tributaria (NIT)', ['nit']],
    [4, 'DV', ['dv']],
    [5, 'Tipo de Contribuyente', []],
    [6, 'Tipo de Documento', ['tipoDocumento']],
    [7, 'Número de Identificación', ['numeroId']],
    [8, 'Verificar el Número  de Identificación', ['numeroId']],
    [9, 'Primer Apellido', ['primerApellido']],
    [10, 'Primer Nombre', ['primerNombre']],
    [11, 'Indicar SI es o NO pensionado', ['pensionado']],
    [12, 'Indique la Dirección tal y como aparece en el RUT', ['direccion']],
    [13, 'País', ['pais', 'departamento']],
    [14, 'Departamento', ['departamento']],
    [15, 'Municipio', ['municipio']],
    [16, 'Correo Electrónico Reportado en el RUT', ['email']],
    [17, 'Teléfono 1', ['telefono1']],
    [18, 'Teléfono 2', ['telefono2']],
    [19, 'Banco', ['banco']],
    [20, 'Sucursal', ['sucursal']],
    [21, 'Tipo Cuenta', ['tipoCuenta']],
    [22, 'No Cuenta Bancaria', ['numeroCuenta']],
    [23, 'Actividad Económica RUT', ['actividadRut']],
    [24, 'Actividad económica RUT NO existe - por favor verificar', ['actividadRut']],
    [25, 'Actividad Económica RIT', ['actividadRit']],
    [26, 'Actividad economica RIT NO existe - por favor verificar', ['actividadRit']],
    [27, 'Régimen', ['regimenIva']],
    [28, 'No Contrato', ['numeroContrato']],
    [29, 'Año Contrato', ['anioContrato']],
    [30, 'Valor Total del Contrato', ['valorTotal']],
    [31, 'Valor Pago Mensual según Contrato', ['valorMensual']],
    [32, 'Fecha Acta de Inicio', ['fechaInicio']],
    [33, 'Fecha terminación Contrato', ['fechaTerminacion']],
    [34, 'VIGENCIA FUTURA', ['rpVigenciaFutura']],
    [35, 'Cesión', ['cesion']],
    [36, 'Área Funcional de la SED', ['areaFuncional']],
    [37, 'Nombre Interventor Contrato', ['interventorNombre']],
    [38, 'Cargo Interventor Contrato', ['interventorCargo']],
    [39, 'Nombre Operativo', ['operativoNombre']],
    [40, 'Identificación Operativo', ['operativoId']],
    [41, 'Codigo ARL', ['codigoArl']],
    [42, 'Pregunta C1', ['c1']],
    [43, 'Pregunta C2', ['c2']],
    [44, 'Pregunta C3', ['c3']],
    [45, 'Pregunta C4', ['c4']],
    [46, 'Entidad (AFC)', ['afc', 'afcEntidad']],
    [47, 'NIT (AFC)', ['afc', 'afcNit']],
    [48, 'Valor Mensual (AFC)', ['afc', 'afcValor']],
    [49, 'Entidad (Pensiones Voluntarias)', ['pensionesVoluntarias', 'pvEntidad']],
    [50, 'NIT (Pensiones Voluntarias)', ['pensionesVoluntarias', 'pvNit']],
    [51, 'Valor Mensual (Pensiones Voluntarias)', ['pensionesVoluntarias', 'pvValor']],
    [52, 'Número CRP', ['crp1']],
    [53, 'Fecha del CRP', ['fechaCrp1']],
    [54, 'Diligencie el formato deducciones por dependientes', ['depMotivo']],
    [55, 'Diligencie el formato deducciones por credito hipotecario', ['hipEntidad']],
    [56, 'Diligencie el formato No Pos', ['saludEntidad']],
  ].map(([fila, descripcion, campos]) => ({ fila, descripcion, campos }));

  // ───────────────────────── Semántica de valores Excel ─────────────────────────
  class ErrorExcel extends Error {
    constructor(codigo) { super(codigo); this.codigo = codigo; }
  }
  const esError = (v) => v !== null && typeof v === 'object' && typeof v.error === 'string';
  const lanzar = (codigo) => { throw new ErrorExcel(codigo); };
  const chk = (v) => { if (esError(v)) lanzar(v.error); return v; };

  // IFERROR / IFNA: evalúan perezosamente para atrapar errores de la expresión.
  function siError(fn, alterno) {
    try { return chk(fn()); } catch (e) { if (e instanceof ErrorExcel) return alterno; throw e; }
  }
  function siNA(fn, alterno) {
    try { return chk(fn()); } catch (e) { if (e instanceof ErrorExcel && e.codigo === '#N/A') return alterno; throw e; }
  }

  // Número → texto como lo hace Excel al concatenar (15 cifras significativas; coma decimal es-CO).
  function numTexto(n) {
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    return String(Number(n.toPrecision(15))).replace('.', ',').replace('e', 'E');
  }
  function txt(v) {
    chk(v);
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return numTexto(v);
    if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO'; // Excel en español
    return String(v);
  }
  const RE_NUMERO = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  // Coerción aritmética (+ - * /): vacío = 0; texto numérico se convierte; otro texto → #VALUE!
  function num(v) {
    chk(v);
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const t = String(v).trim();
    if (RE_NUMERO.test(t)) return Number(t);
    return lanzar('#VALUE!');
  }
  // VALUE(): igual que num() pero el texto vacío es #VALUE!
  function valor(v) {
    chk(v);
    if (typeof v === 'number') return v;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'boolean') return lanzar('#VALUE!');
    const t = String(v).trim();
    if (RE_NUMERO.test(t)) return Number(t);
    return lanzar('#VALUE!');
  }
  // Condición de IF()
  function cond(v) {
    chk(v);
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const t = String(v).toUpperCase();
    if (t === 'TRUE' || t === 'VERDADERO') return true;
    if (t === 'FALSE' || t === 'FALSO') return false;
    return lanzar('#VALUE!');
  }
  const minus = (s) => s.toLowerCase();
  const vacioComo = (x) => (typeof x === 'string' ? '' : typeof x === 'number' ? 0 : false);
  // Operador "=" de Excel.
  function igual(a, b) {
    chk(a); chk(b);
    if (a === undefined) a = null;
    if (b === undefined) b = null;
    if (a === null && b === null) return true;
    if (a === null) a = vacioComo(b);
    if (b === null) b = vacioComo(a);
    if (typeof a !== typeof b) return false;
    if (typeof a === 'string') return minus(a) === minus(b);
    return a === b;
  }
  // Orden de Excel: números < texto < booleanos. Devuelve -1, 0 o 1.
  function comparar(a, b) {
    chk(a); chk(b);
    if (a === undefined) a = null;
    if (b === undefined) b = null;
    if (a === null && b === null) return 0;
    if (a === null) a = vacioComo(b);
    if (b === null) b = vacioComo(a);
    const rango = (x) => (typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2);
    if (rango(a) !== rango(b)) return rango(a) < rango(b) ? -1 : 1;
    if (typeof a === 'string') { a = minus(a); b = minus(b); }
    if (typeof a === 'boolean') { a = +a; b = +b; }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const div = (a, b) => { const d = num(b); if (d === 0) lanzar('#DIV/0!'); return num(a) / d; };
  // ROUND(): mitad lejos de cero, corrigiendo el ruido binario a 15 cifras como Excel.
  function redondear(x, dec) {
    const n = num(x);
    const f = Math.pow(10, dec || 0);
    const y = Number((Math.abs(n) * f).toPrecision(15));
    return (Math.sign(n) || 1) * Math.round(y) / f;
  }
  const trim = (v) => txt(v).replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ');
  const clean = (v) => txt(v).replace(/[\x00-\x1F]/g, '');
  const len = (v) => txt(v).length;
  const concat = (...xs) => xs.map(txt).join('');
  // MIN() con referencias: ignora vacíos, textos y booleanos; sin números devuelve 0.
  function minRef(...xs) {
    const ns = xs.map(chk).filter((x) => typeof x === 'number');
    return ns.length ? Math.min(...ns) : 0;
  }
  const ref0 = (v) => (v === null || v === undefined ? 0 : v); // fórmula "=A1" sobre celda vacía

  // ─────────────── Tablas (VLOOKUP exacto, insensible a mayúsculas, con comodines) ───────────────
  function crearTabla(filas) { return { filas, idx: null }; }
  function comodin(patron) {
    let re = '';
    for (let i = 0; i < patron.length; i++) {
      const ch = patron[i];
      if (ch === '~' && i + 1 < patron.length) { re += patron[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      else if (ch === '*') re += '[\\s\\S]*';
      else if (ch === '?') re += '[\\s\\S]';
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$', 'i');
  }
  function buscarFila(tabla, v) {
    chk(v);
    if (v === null || v === undefined) v = '';
    if (typeof v === 'string' && /[*?~]/.test(v)) {
      const re = comodin(v);
      return tabla.filas.find((f) => typeof f[0] === 'string' && re.test(f[0])) || null;
    }
    if (!tabla.idx) {
      tabla.idx = new Map();
      for (const f of tabla.filas) {
        const k = f[0];
        if (k === null || k === undefined) continue;
        const clave = typeof k === 'string' ? 's:' + minus(k) : typeof k === 'number' ? 'n:' + k : 'b:' + k;
        if (!tabla.idx.has(clave)) tabla.idx.set(clave, f);
      }
    }
    const clave = typeof v === 'string' ? 's:' + minus(v) : typeof v === 'number' ? 'n:' + v : 'b:' + v;
    return tabla.idx.get(clave) || null;
  }
  function buscarV(v, tabla, col) {
    const fila = buscarFila(tabla, v);
    if (!fila) lanzar('#N/A');
    const r = fila[col - 1];
    return r === null || r === undefined ? 0 : r; // VLOOKUP sobre celda vacía devuelve 0
  }

  let cache = { cat: null, t: null };
  function tablas() {
    const cat = root.CATALOGOS;
    if (!cat) throw new Error('Calc: falta window.CATALOGOS');
    if (cache.cat === cat) return cache.t;
    const aNum = (c) => (typeof c === 'string' && /^\d+$/.test(c) ? Number(c) : c);
    // 'Validador- Datos'!AD/AE: clave "codDepto-n", n reinicia cuando cambia el nombre del departamento (AB).
    const claves = new Map();
    let previo = null, n = 0;
    for (const m of cat.municipios) {
      n = previo !== null && minus(String(m.depto)) === minus(String(previo)) ? n + 1 : 1;
      previo = m.depto;
      const k = minus(String(m.codDepto) + '-' + n);
      if (!claves.has(k)) claves.set(k, m);
    }
    const t = {
      tipoContribuyente: crearTabla([['TIPO DE CONTRIBUYENTE', 'COD'], ['PERSONA JURÍDICA', 1], ['PERSONA NATURAL', 2]]),
      tiposDoc: crearTabla([['TIPO DE DOCUMENTO', 'COD_DIAN', 'COD_APOT']].concat(cat.tiposDocumento.map((d) => [d.nombre, d.dian, d.apot]))),
      tiposDocDian: crearTabla(cat.tiposDocumento.map((d) => [d.dian, d.apot])),
      paises: crearTabla([['PAIS', 'Código']].concat(cat.paises.map((p) => [p.nombre, p.codigo]))),
      deptos: crearTabla([['DPTO', 'COD_DEPTO']].concat(cat.departamentos.map((d) => [d.nombre, d.codigo]))),
      bancos: crearTabla(cat.bancos.map((b) => [b.social, b.nombre, null, aNum(b.codigo)])),
      tiposCuenta: crearTabla(cat.tiposCuenta.map((c) => [c.nombre, c.codigo])),
      ciiu: crearTabla(cat.ciiu.map((c) => [c.codigo, c.descripcion])),
      rit: crearTabla(cat.rit.map((r) => [r.codigo, r.agrupacion, r.descripcion, r.tarifa])),
      regimen: crearTabla(cat.regimenIva.map((r) => [r.nombre, r.sigla])),
      areas: crearTabla([['Área Funcional de la SED', 'CODIGO']].concat(cat.areas.map((a) => [a.nombre, a.codigo]))),
      motivos: crearTabla(cat.motivosDependientes.map((m) => [m.numero, m.anexo])),
      clavesMunicipio: claves,
      municipiosPorDepto: new Map(),
    };
    cache = { cat, t };
    return t;
  }
  // 'Validador- Datos'!AK1:AL126: municipios del departamento AA1 (=AI21), 125 filas.
  function tablaMunicipios(t, aa1) {
    const pref = txt(aa1);
    if (t.municipiosPorDepto.has(pref)) return t.municipiosPorDepto.get(pref);
    const filas = [['NOM_MPIO', 'COD_MPIO']];
    for (let i = 1; i <= 125; i++) {
      const m = t.clavesMunicipio.get(minus(pref + '-' + i));
      filas.push(m ? [m.nombre, m.codigo] : ['', '']);
    }
    const tabla = crearTabla(filas);
    t.municipiosPorDepto.set(pref, tabla);
    return tabla;
  }

  // ───────────────────────── Fechas ─────────────────────────
  const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
  function partesISO(iso) {
    const m = RE_ISO.exec(String(iso || '').trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y, m: mo, d };
  }
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  // Número de serie de Excel (sistema 1900) para 'aaaa-mm-dd'; null si la fecha no es válida.
  function fechaSerialExcel(iso) {
    const p = partesISO(iso);
    if (!p) return null;
    const serial = Date.UTC(p.y, p.m - 1, p.d) / 86400000 + 25569;
    return serial < 61 ? serial - 1 : serial; // Excel cuenta el inexistente 29/02/1900
  }
  function isoDeSerial(serial) {
    const dt = new Date((serial - 25569) * 86400000);
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }
  function isoLocal(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hoyISO() { return isoLocal(new Date()); }
  // hoy: Date | 'aaaa-mm-dd' | undefined → 'aaaa-mm-dd'
  function normalizarHoy(hoy) {
    if (hoy instanceof Date && !isNaN(hoy)) return isoLocal(hoy);
    if (typeof hoy === 'string' && partesISO(hoy)) return hoy;
    return hoyISO();
  }
  // Regla general (instructivo): desde el 1 de abril se piden certificados del año anterior;
  // antes, de dos años atrás.
  function anioCertificados(hoy) {
    const iso = normalizarHoy(hoy);
    const y = +iso.slice(0, 4);
    const mesDia = ((root.CONFIG && root.CONFIG.mesDiaCorteCertificados) || '04-01');
    return iso >= y + '-' + mesDia ? y - 1 : y - 2;
  }

  // ───────────────────── Estado → celdas de entrada del Excel ─────────────────────
  const vacio = (v) => v === undefined || v === null || String(v).trim() === '';
  const limpio = (v) => (vacio(v) ? '' : String(v).trim());
  // Más de 15 cifras significativas no caben en un número de Excel: se dejan como texto.
  const cabeEnNumero = (v) => v.replace(/[-.]/g, '').replace(/^0+/, '').length <= 15;
  function aNumero(v) {
    if (v === '') return null;
    const t = v.replace(/\s+/g, '');
    if (/^-?\d+(\.\d+)?$/.test(t) && cabeEnNumero(t)) return Number(t);
    return v;
  }
  function aAuto(v) {
    if (v === '') return null;
    if (/^(0|[1-9]\d{0,14})$/.test(v)) return Number(v);
    return v;
  }
  // Opciones de listas cuyo texto exacto usa el Excel en sus VLOOKUP (p. ej. 'Cédula de ciudadanía '
  // termina en espacio). Si llega el texto sin ese espacio o con otras mayúsculas, se usa el del catálogo.
  const OPCIONES_TEXTO = {
    tiposDocumento: (c) => c.tiposDocumento.map((x) => x.nombre),
    paises: (c) => c.paises.map((x) => x.nombre),
    departamentos: (c) => c.departamentos.map((x) => x.nombre),
    municipiosDelDepartamento: (c) => c.municipios.map((x) => x.nombre),
    bancos: (c) => c.bancos.map((x) => x.nombre),
    tiposCuenta: (c) => c.tiposCuenta.map((x) => x.nombre),
    regimenIva: (c) => c.regimenIva.map((x) => x.nombre),
    areas: (c) => c.areas.map((x) => x.nombre),
    parentescos: (c) => c.parentescos,
    motivosDependientes: (c) => c.motivosDependientes.map((x) => x.texto),
  };
  const clave = (x) => minus(String(x == null ? '' : x).trim());
  function canonico(opciones, v) {
    const cat = root.CATALOGOS;
    const lista = cat && OPCIONES_TEXTO[opciones] ? OPCIONES_TEXTO[opciones](cat) : null;
    if (!lista || v === '') return v;
    if (lista.indexOf(v) >= 0) return v;
    const k = clave(v);
    const hallado = lista.find((x) => clave(x) === k);
    if (hallado !== undefined) return hallado;
    // Variante sin tildes ('bogota d.c' -> 'Bogotá D.C'), solo si la coincidencia es única.
    const sinTildes = (x) => clave(x).normalize('NFD').replace(/[̀-ͯ]/g, '');
    const kf = sinTildes(v);
    const candidatos = lista.filter((x) => sinTildes(x) === kf);
    return candidatos.length > 0 && candidatos.every((x) => x === candidatos[0]) ? candidatos[0] : v.trim();
  }
  // Valor del campo tal como se escribe en el Excel: texto libre sin espacios sobrantes;
  // opciones de lista con su texto exacto del catálogo.
  function valorCampo(campo, v) {
    if (vacio(v)) return '';
    if (campo && campo.opciones && OPCIONES_TEXTO[campo.opciones]) return canonico(campo.opciones, String(v));
    return String(v).trim();
  }
  function esVisible(campo, s) {
    if (typeof campo.visible !== 'function') return campo.visible !== false;
    try { return !!campo.visible(s); } catch (e) { return true; }
  }
  // Devuelve { 'hoja!CELDA': valor } con TODAS las celdas mapeadas del esquema (null = vacía).
  // Igual que la exportación: los campos ocultos (p. ej. datos de AFC si la respuesta es NO) van vacíos.
  function celdasEntrada(s) {
    s = s || {};
    const campos = (root.SCHEMA && root.SCHEMA.fields) || {};
    const out = {};
    for (const id of Object.keys(campos)) {
      const x = campos[id].excel;
      if (!x) continue;
      const v = esVisible(campos[id], s) ? valorCampo(campos[id], s[id]) : '';
      const r = (c) => x.hoja + '!' + c;
      switch (x.tipo) {
        case 'texto': out[r(x.celda)] = v === '' ? null : v; break;
        case 'numero': out[r(x.celda)] = aNumero(v); break;
        case 'auto': out[r(x.celda)] = aAuto(v); break;
        case 'fecha': { const n = fechaSerialExcel(v); out[r(x.celda)] = v === '' ? null : n === null ? v : n; break; }
        case 'digitos': {
          const chars = Array.from(v.replace(/\s+/g, ''));
          x.celdas.forEach((c, i) => {
            const ch = chars[i];
            out[r(c)] = ch === undefined ? null : /^\d$/.test(ch) ? Number(ch) : ch;
          });
          break;
        }
        case 'x': {
          const u = v.toUpperCase();
          out[r(x.si)] = u === 'SI' ? 'X' : null;
          out[r(x.no)] = u === 'NO' ? 'X' : null;
          break;
        }
        case 'marca': out[r(x.celda)] = v.toUpperCase() === 'SI' ? x.valor : null; break;
        default: break;
      }
    }
    return out;
  }
  function celdasDeEntrada() { return Object.keys(celdasEntrada({})); }

  // ───────────────────────── Evaluación de las fórmulas ─────────────────────────
  // celdas: { 'hoja!CELDA': valor } de entrada; hoy: Date | 'aaaa-mm-dd'.
  function evaluar(celdas, hoy) {
    celdas = celdas || {};
    const cfg = root.CONFIG || {};
    const cat = root.CATALOGOS || {};
    const t = tablas();
    const hoyIso = normalizarHoy(hoy);
    const hoySerial = fechaSerialExcel(hoyIso);
    const constantes = { 'datos!R11': 'PERSONA NATURAL' };
    const R = {};

    const get = (ref) => {
      if (Object.prototype.hasOwnProperty.call(R, ref)) return chk(R[ref]);
      let v = celdas[ref];
      if (v === undefined) v = constantes[ref];
      if (v === undefined || v === '') return null;
      return chk(v);
    };
    const def = (ref, fn) => {
      try { R[ref] = chk(fn()); } catch (e) {
        if (!(e instanceof ErrorExcel)) throw e;
        R[ref] = { error: e.codigo };
      }
      if (R[ref] === undefined) R[ref] = null;
    };
    const d = (c) => get('datos!' + c);
    const dd = (c) => get('deducciones!' + c);
    const v = (c) => get('validador!' + c);
    const esX = (c) => igual(d(c), 'X');
    const uvt = num(cfg.uvt);

    // ── Hoja FORMATO ACTUALIZACIÓN DATOS: identificación ──
    def('datos!AA11', () => siError(() => buscarV(d('R11'), t.tipoContribuyente, 2), ''));
    def('datos!AP10', () => (igual(d('AA11'), 1) ? 'Número de Identificación del Contacto' : 'Número de Identificación'));
    def('datos!AN11', () => siError(() => buscarV(d('AC11'), t.tiposDoc, 2), ''));
    def('datos!A13', () => clean(trim(d('A11'))));
    def('datos!AP13', () => siError(() => valor(clean(trim(d('AP11')))), ''));
    def('datos!P13', () => num(d('A13')) - num(d('AP13')));
    def('datos!R13', () => siError(() => (igual(d('AA11'), 1) ? 1 : igual(d('P13'), 0) ? 1 : 0), 0));
    def('datos!AA13', () => (igual(d('AA11'), 1) ? 'J' : igual(d('AA11'), 2) ? 'N' : ''));
    def('datos!AN13', () => siError(() => buscarV(d('AN11'), t.tiposDocDian, 2), ''));
    def('datos!A14', () => concat(d('A11'), d('B11'), d('C11'), d('D11'), d('E11'), d('F11'), d('G11'), d('H11'), d('I11'), d('J11'), d('K11'), d('L11'), d('M11'), d('N11')));
    def('datos!AP14', () => concat(d('AP11'), d('AQ11'), d('AR11'), d('AS11'), d('AT11'), d('AU11'), d('AV11'), d('AW11'), d('AX11'), d('AY11'), d('AZ11'), d('BA11'), d('BB11'), d('BC11')));
    def('datos!AI16', () => concat(txt(d('A16')).toUpperCase(), ' ', txt(d('I16')).toUpperCase(), ' ', txt(d('Q16')).toUpperCase(), ' ', txt(d('Y16')).toUpperCase()));
    def('datos!AS18', () => (igual(d('AC18'), 0) ? '' : ref0(d('AC18'))));

    // ── Ubicación ──
    def('datos!P21', () => siError(() => buscarV(d('A21'), t.paises, 2), ''));
    def('datos!AI21', () => siError(() => buscarV(d('T21'), t.deptos, 2), ''));
    def('validador!AA1', () => ref0(d('AI21')));
    def('datos!BB21', () => siError(() => buscarV(d('AM21'), tablaMunicipios(t, v('AA1')), 2), ''));
    def('datos!AG26', () => clean(trim(concat(d('AG24'), d('AH24'), d('AI24'), d('AJ24'), d('AK24'), d('AL24'), d('AM24'), d('AN24'), d('AO24'), d('AP24')))));
    def('datos!AQ26', () => concat(d('AR24'), d('AS24'), d('AT24'), d('AU24'), d('AV24'), d('AW24'), d('AX24'), d('AY24'), d('AZ24'), d('BA24'), d('BB24'), d('BC24')));

    // ── Pagos ──
    def('datos!M31', () => siError(() => buscarV(d('A31'), t.bancos, 4), ''));
    def('datos!AE31', () => siError(() => buscarV(d('Z31'), t.tiposCuenta, 2), ''));
    def('datos!AH31', () => concat(d('A14'), '-', d('P11')));
    def('datos!AN32', () => trim(concat(...['AN', 'AO', 'AP', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC'].map((c) => d(c + '31')))));

    // ── Tributario ──
    def('datos!A40', () => concat(d('A39'), d('B39'), d('C39'), d('D39')));
    def('datos!X40', () => siError(() => valor(clean(trim(concat(d('X39'), d('Y39'), d('Z39'), d('AA39'), d('AB39'))))), ''));
    def('datos!F39', () => (igual(d('A40'), '') ? '' : siError(() => buscarV(d('A40'), t.ciiu, 2), TXT_NO_EXISTE)));
    def('datos!AD39', () => (igual(d('X40'), '') ? '' : siError(() => buscarV(d('X40'), t.rit, 3), TXT_NO_EXISTE)));
    def('datos!AQ40', () => (igual(d('AD39'), 'Actividad economica NO existe o no aplica para el tipo de Contribuyente - por favor verificar') ? ''
      : igual(d('X40'), '') ? '' : siError(() => buscarV(d('X40'), t.rit, 4), TXT_NO_EXISTE)));
    def('datos!BC39', () => siError(() => buscarV(d('AU39'), t.regimen, 2), ''));

    // ── Contrato (con 'Validador- Datos'!K25:L28 y BI1:BP2) ──
    def('validador!L26', () => ref0(d('K46')));
    def('validador!L27', () => ref0(d('A50')));
    def('validador!L28', () => siError(() => div(num(v('L26')) * 30, v('L27')), ' '));
    def('datos!W46', () => v('L28'));
    def('datos!F47', () => concat(d('F46'), d('G46'), d('H46'), d('I46')));
    def('validador!BL2', () => num(cfg.limiteIvaUvt) * uvt);
    def('validador!BM2', () => ref0(d('K46')));
    def('validador!BN2', () => redondear(div(v('BM2'), 1.19), 0));
    def('validador!BO2', () => redondear(num(v('BN2')) * 0.19, 0));
    def('validador!BP2', () => num(v('BN2')) + num(v('BO2')));
    def('datos!AW52', () => redondear(igual(d('AU39'), 'RESPONSABLE IVA') ? div(d('K46'), 1.19)
      : comparar(v('BM2'), v('BL2')) >= 0 ? v('BN2') : d('K46'), 0));
    def('datos!AW53', () => redondear(!igual(d('K46'), d('AW52')) ? num(d('AW52')) * 0.19 : 0, 0));
    def('datos!H53', () => siNA(() => buscarV(d('A53'), t.areas, 2), ''));

    // ── Deducciones: topes ('Validador- Datos'!BI6:BO9) ──
    def('validador!BJ7', () => ref0(d('A50')));
    def('validador!BK7', () => num(v('BJ7')) * 0.1);
    def('validador!BL7', () => uvt * 32);
    def('validador!BM7', () => minRef(v('BK7'), v('BL7')));
    def('validador!BN7', () => 384 * uvt);
    def('validador!BJ8', () => v('BJ7'));
    def('validador!BK8', () => 16 * 12 * uvt);
    def('validador!BL8', () => num(v('BK8')) / 12);
    def('validador!BM8', () => Math.min(num(v('BL8')), div(dd('Y37'), 12)));
    def('validador!BJ9', () => v('BJ8'));
    def('validador!BK9', () => div(dd('Y48'), 12));
    def('validador!BL9', () => 100 * uvt);
    def('validador!BM9', () => minRef(v('BK9'), v('BL9')));
    def('validador!BO8', () => num(v('BL9')) / 12);

    // ── Año de los certificados ('Validador- Datos'!BI12:BK12) ──
    def('deducciones!W15', () => hoySerial);
    def('validador!BI12', () => dd('W15'));
    (function () {
      const bi12 = num(v('BI12'));
      const anios = [];
      let siguiente = 0; // BJ17 está vacía
      for (let i = TABLA_CERTIFICADOS.length - 1; i >= 0; i--) {
        const fila = TABLA_CERTIFICADOS[i];
        const f = fechaSerialExcel(fila.fecha);
        siguiente = f < bi12 ? siguiente : bi12 < f ? fila.antes : fila.desde;
        anios.unshift(siguiente);
        R['validador!BJ' + (12 + i)] = siguiente;
      }
      R['validador!BK12'] = Math.min(...anios);
    })();
    def('deducciones!W16', () => v('BK12'));
    def('datos!AN76', () => num(dd('W16')));
    def('datos!AY79', () => num(dd('W16')) + 2);

    // ── Codificación tributaria ('Validador- Datos'!BE2:BG25) ──
    def('validador!BE2', () => (igual(d('AU39'), 'RESPONSABLE IVA') ? 'C' : igual(d('AU39'), 'NO RESPONSABLE IVA') ? 'S' : 'ERROR'));
    def('validador!BE3', () => (esX('BA61') || esX('BA64') ? 'VERDADERO' : 'FALSO'));
    def('validador!BE4', () => (esX('BA61') || esX('BA64') ? 'SI' : 'NO'));
    def('validador!BE5', () => (esX('BC61') || esX('BC64') ? 'SI' : 'NO'));
    def('validador!BE6', () => (esX('BA61') && esX('BC61') && esX('BA64') && igual(d('BC64'), 'x') ? 'SI' : 'NO'));
    // AND(BA61="",,BA64=""): el argumento omitido vale FALSO, así que BE7 siempre es "NO" (verificado con Excel).
    def('validador!BE7', () => (igual(d('BA61'), '') && false && igual(d('BA64'), '') ? 'SI' : 'NO'));
    def('validador!BE8', () => (igual(d('BC61'), '') && igual(d('BC64'), '') ? 'SI' : 'NO'));
    def('validador!BE9', () => concat(d('BA61'), d('BC61')));
    def('validador!BE10', () => len(v('BE9')));
    def('validador!BE11', () => concat(d('BA64'), d('BC64')));
    def('validador!BE12', () => len(v('BE11')));
    def('validador!BE13', () => num(v('BE12')) + num(v('BE10')));
    def('validador!BE14', () => (igual(v('BE13'), 2)
      ? (igual(v('BE6'), 'NO') && igual(v('BE7'), 'NO')
        ? (igual(v('BE3'), 'VERDADERO') ? 'D' : esX('BC61') || esX('BC64') ? 'N' : 'ERROR 3')
        : 'ERROR 1')
      : 'ERROR 4'));
    def('validador!BE15', () => (esX('BA67') && esX('BC67') ? 'ERROR' : esX('BA67') ? 'SY' : esX('BC67') ? '' : false));
    def('validador!BE17', () => (esX('BA70') && esX('BC70') ? 'ERROR' : igual(d('BA70'), '') && igual(d('BC70'), '') ? 'ERROR' : ''));
    def('validador!BE18', () => len(concat(d('BA70'), d('BC70'))));
    def('validador!BE19', () => (esX('BA70') && esX('BC70') ? 'ERROR' : concat('N', 'T', v('BE14'), v('BE2'))));
    def('validador!BG23', () => (igual(d('AU39'), 'RESPONSABLE IVA') ? 'M' : igual(d('AU39'), 'NO RESPONSABLE IVA') ? 'S' : 'ERROR'));
    def('validador!BE21', () => (igual(v('BE18'), 2) || igual(v('BE18'), 0) ? TXT_REVISE
      : igual(v('BE15'), 'SY') ? concat('N', v('BE15'), v('BG23')) : concat('N', v('BE15'), v('BE2'))));
    def('validador!BE22', () => (igual(v('BE15'), '') && igual(v('BE17'), '') ? v('BE19') : v('BE21')));
    def('validador!BE25', () => (esX('Q18') ? ' /PENSIONADO' : ''));
    def('validador!BE23', () => concat(len(v('BE22')) > 4 ? TXT_REVISE : v('BE22'), v('BE25')));
    def('datos!C73', () => v('BE23'));

    // ── Validador de diligenciamiento ('Validador- Datos'!B3:B57, D3:D68) ──
    const noVacio = (x) => (igual(x, '') ? 0 : 1);
    const colombiaOVacio = () => igual(d('P21'), '169') || igual(d('P21'), '');
    def('validador!E7', () => d('AA11'));
    const B = {
      3: () => noVacio(d('A13')),
      4: () => noVacio(d('P11')),
      5: () => noVacio(d('R11')),
      6: () => noVacio(d('AC11')),
      7: () => (igual(v('E7'), 1) ? 1 : noVacio(d('AP13'))),
      8: () => d('R13'),
      9: () => (igual(v('E7'), 1) ? 1 : noVacio(d('A16'))),
      10: () => (igual(v('E7'), 1) ? 1 : noVacio(d('Q16'))),
      11: () => (igual(d('Q18'), 'x') && igual(d('S18'), 'x') ? 0 : igual(d('Q18'), 'x') || igual(d('S18'), 'x') ? 1 : 0),
      12: () => noVacio(d('AC18')),
      13: () => noVacio(d('AI21')),
      14: () => (colombiaOVacio() ? noVacio(d('T21')) : 1),
      15: () => (colombiaOVacio() ? noVacio(d('AM21')) : 1),
      16: () => noVacio(d('A24')),
      17: () => noVacio(d('AG26')),
      18: () => noVacio(d('AQ26')),
      19: () => noVacio(d('M31')),
      20: () => noVacio(d('Q31')),
      21: () => noVacio(d('AE31')),
      22: () => noVacio(d('AN32')),
      23: () => noVacio(d('A40')),
      24: () => (igual(d('A40'), '') ? 0 : igual(d('F39'), 'Actividad economica no existe - por favor verificar') ? 0 : 1),
      25: () => noVacio(d('X40')),
      26: () => (igual(d('X40'), '') ? 0 : igual(d('AD39'), 'Actividad economica no existe - por favor verificar') ? 0 : 1),
      27: () => noVacio(d('AU39')),
      28: () => noVacio(d('A46')),
      29: () => noVacio(d('F47')),
      30: () => noVacio(d('K46')),
      31: () => noVacio(d('A50')),
      32: () => noVacio(d('AC46')),
      33: () => noVacio(d('AN46')),
      34: () => noVacio(d('V50')),
      35: () => noVacio(d('AY46')),
      36: () => noVacio(d('A53')),
      37: () => noVacio(d('J53')),
      38: () => noVacio(d('S53')),
      39: () => noVacio(d('Z53')),
      40: () => noVacio(d('AH53')),
      41: () => noVacio(d('AX50')),
    };
    // Preguntas C1–C4: exactamente una X (B44 compara AA13 con 1, que nunca se cumple).
    const pregunta = (fila, si, no, base) => {
      def('validador!E' + fila, () => (esX(si) ? 1 : 0));
      def('validador!F' + fila, () => (esX(no) ? 1 : 0));
      def('validador!G' + fila, () => num(v('E' + fila)) + num(v('F' + fila)));
      B[fila] = () => (igual(d(base), 1) ? 1 : igual(v('G' + fila), 1) ? 1 : 0);
    };
    pregunta(42, 'BA61', 'BC61', 'AA11');
    pregunta(43, 'BA64', 'BC64', 'AA11');
    pregunta(44, 'BA67', 'BC67', 'AA13');
    pregunta(45, 'BA70', 'BC70', 'AA11');
    // AFC (B46:B48) y pensiones voluntarias (B49:B51), con sus diferencias originales.
    def('validador!E46', () => (esX('S82') ? 1 : 0));
    def('validador!F46', () => (esX('V82') ? 1 : 0));
    def('validador!G46', () => num(v('E46')) + num(v('F46')));
    const afc = (celda) => () => (igual(v('G46'), 0) ? 0 : igual(d('AA11'), 1) ? 1 : igual(v('E46'), 0) ? 1 : noVacio(d(celda)));
    B[46] = afc('I83'); B[47] = afc('I84'); B[48] = afc('I85');
    def('validador!E49', () => (esX('AX82') ? 1 : 0));
    def('validador!F49', () => (esX('BA82') ? 1 : 0));
    def('validador!G49', () => num(v('E49')) + num(v('F49')));
    B[49] = () => (igual(v('G49'), 0) ? 0 : igual(d('AA11'), 1) ? 1 : igual(v('F49'), 1) ? 1 : noVacio(d('AN83')));
    B[50] = () => (igual(v('G49'), 0) ? 0 : igual(d('AA11'), 1) ? 1 : igual(v('E49'), 0) ? 1 : noVacio(d('AN84')));
    B[51] = () => (igual(v('G49'), 0) ? 0 : igual(d('AA11'), 1) ? 1 : igual(v('E49'), 0) ? 1 : comparar(d('AN85'), 0) > 0 ? 1 : 0);
    B[52] = () => noVacio(d('N50'));
    B[53] = () => noVacio(d('Q50'));
    // Deducciones (B54:B56): marcar sin diligenciar = 0; diligenciar sin marcar = 2 (sic).
    const deduccion = (fila, marca, celdaFormato) => {
      def('validador!C' + fila, () => ref0(d(marca)));
      def('validador!E' + fila, () => (igual(v('C' + fila), 'FORMATO SED - CON ANEXOS') ? 0 : 1));
      def('validador!F' + fila, () => (!igual(dd(celdaFormato), '') ? 1 : 0));
      B[fila] = () => num(v('E' + fila)) + num(v('F' + fila));
    };
    deduccion(54, 'D80', 'B25');
    deduccion(55, 'M80', 'H46');
    deduccion(56, 'V80', 'H35');

    const filas = [];
    for (const fv of FILAS_VALIDADOR) {
      def('validador!B' + fv.fila, B[fv.fila]);
      const b = R['validador!B' + fv.fila];
      if (fv.fila >= 54) {
        const celdaFormato = { 54: 'B25', 55: 'H46', 56: 'H35' }[fv.fila];
        def('validador!D' + fv.fila, () => (!igual(dd(celdaFormato), '') ? '' : igual(v('E' + fv.fila), 0) ? concat(' - ', fv.descripcion, '') : ''));
      } else {
        def('validador!D' + fv.fila, () => (igual(b, 0) ? concat(' - ', fv.descripcion, '') : ''));
      }
      filas.push({ fila: fv.fila, valor: b, descripcion: fv.descripcion, campos: fv.campos });
    }
    def('validador!B57', () => siError(() => {
      let suma = 0;
      for (const fv of FILAS_VALIDADOR) { const x = chk(R['validador!B' + fv.fila]); if (typeof x === 'number') suma += x; }
      return suma;
    }, 0));
    def('validador!D62', () => FILAS_VALIDADOR.map((fv) => txt(v('D' + fv.fila))).join(''));
    def('validador!D63', () => igual(d('AU39'), 'NO RESPONSABLE IVA') && comparar(d('AW53'), 0) > 0);
    def('validador!D64', () => hoySerial);
    def('validador!D65', () => concat('Por favor verifique la información de :', v('D62')));
    def('validador!D66', () => {
      // TEXT(D64,"dd/mm/yyyy"). Nota: en Excel con configuración regional que usa "aaaa" el año sale literal "yyyy".
      const iso = isoDeSerial(num(v('D64')));
      return 'Información completa, en constancia se suscribe el presente formulario el dia ' + iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
    });
    def('validador!D68', () => (igual(v('B57'), TOTAL_VALIDADOR) ? v('D66') : igual(v('B57'), 4) ? TXT_SIN_DILIGENCIAR : v('D65')));

    // ── Certificación y firma ──
    def('datos!C91', () => concat('Yo ', d('AI16'), ' ', cat.juramento || ''));
    def('datos!C95', () => (igual(v('D63'), false) ? v('D68') : TXT_IVA_CUANTIA));
    def('datos!E101', () => (igual(d('AA11'), 2) ? d('AI16') : 'ERROR'));
    def('datos!G102', () => concat(d('AC11'), d('AP13')));
    def('datos!F103', () => (igual(d('C95'), TXT_SIN_DILIGENCIAR) ? '' : concat('CONTRATO No ', d('A46'), ' DE ', d('F47'))));

    // ── Hoja FORMATO DEDUCCIONES ──
    def('deducciones!J11', () => ref0(d('AI16')));
    def('deducciones!G13', () => ref0(d('AP11')));
    def('deducciones!S13', () => (cond(d('A46')) ? ref0(d('A46')) : ' '));
    def('deducciones!Z13', () => ref0(d('F47')));
    def('deducciones!AC25', () => valor(txt(dd('B25')).slice(0, 1)));
    def('deducciones!M28', () => siError(() => v('BM7'), ''));
    def('deducciones!B31', () => siError(() => buscarV(dd('AC25'), t.motivos, 2), ''));
    def('deducciones!W39', () => ref0(v('BM8')));
    def('deducciones!B41', () => TXT_SOPORTES);
    def('deducciones!AD44', () => concat('CERTIFICADO EXPEDIDO POR ', dd('H35'), ' A NOMBRE DE ', dd('J11'), ' TITULAR DEL CONTRATO '));
    def('deducciones!B42', () => (igual(dd('H35'), '') ? '' : dd('AD44')));
    def('deducciones!W50', () => (igual(dd('L54'), '') ? ref0(v('BM9')) : div(v('BM9'), dd('L54'))));
    def('deducciones!B56', () => dd('B41'));
    def('deducciones!AD59', () => concat('CERTIFICADO EXPEDIDO POR ', dd('H46'), ' A NOMBRE DE ', '', dd('J11'), ' TITULAR DEL CREDITO '));
    def('deducciones!B57', () => (igual(dd('H46'), '') ? '' : dd('AD59')));
    def('deducciones!B68', () => dd('J11'));
    def('deducciones!B71', () => dd('G13'));

    return { celdas: R, hoy: hoyIso, filasValidador: filas, suma: R['validador!B57'] };
  }

  // ───────────────────────── Valores derivados (para la interfaz y el PDF) ─────────────────────────
  const sinError = (x, alterno) => (esError(x) ? (alterno === undefined ? '' : alterno) : x === null ? '' : x);
  const colapsar = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
  const textoOVacio = (x) => (esError(x) || x === null || x === undefined ? '' : typeof x === 'number' ? numTexto(x) : String(x));
  const numeroONulo = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

  function derivados(s, hoy) {
    s = s || {};
    const cfg = root.CONFIG || {};
    const entradas = celdasEntrada(s);
    const ev = evaluar(entradas, hoy);
    const c = ev.celdas;
    const g = (ref) => c[ref];

    const nombre = colapsar(g('datos!AI16'));
    const anioCert = anioCertificados(ev.hoy);
    const titulares = Number(limpio(s.hipTitulares));
    const bm9 = numeroONulo(g('validador!BM9'));
    const duracion = numeroONulo(g('datos!W46'));
    const valorTotal = Number(limpio(s.valorTotal));
    const limiteIva = Number(cfg.limiteIvaUvt) * Number(cfg.uvt);
    const juramento = (root.CATALOGOS && root.CATALOGOS.juramento) || '';

    return {
      hoy: ev.hoy,
      // Identificación
      tipoContribuyente: 'PERSONA NATURAL',
      etiquetaNumeroId: sinError(g('datos!AP10')),
      nombreCompleto: nombre,                         // AI16 sin espacios repetidos (para mostrar)
      nombreCompletoExcel: sinError(g('datos!AI16')),  // AI16 literal
      codTipoDocDian: sinError(g('datos!AN11')),       // AN11 (número o '')
      codTipoDocApot: sinError(g('datos!AN13')),       // AN13 ('CC', 'CE', 'TI', 'OTI' o '')
      identificacionTitular: sinError(g('datos!AH31')),// AH31 = NIT-DV
      // Ubicación
      codPais: textoOVacio(g('datos!P21')),
      codDepto: textoOVacio(g('datos!AI21')),
      codMunicipio: textoOVacio(g('datos!BB21')),
      // Pagos
      codBanco: textoOVacio(g('datos!M31')),
      codTipoCuenta: textoOVacio(g('datos!AE31')),
      // Tributario
      descCiiu: sinError(g('datos!F39')),
      descRit: sinError(g('datos!AD39')),
      tarifaRit: sinError(g('datos!AQ40')),            // número (x mil), '' o texto de "no existe"
      siglaRegimen: sinError(g('datos!BC39')),
      // Contrato
      anioContratoTexto: sinError(g('datos!F47')),
      duracionDias: duracion,                          // W46 sin redondear (null si no se puede calcular)
      duracionDiasRedondeada: duracion === null ? null : redondear(duracion, 0),
      duracionDiasTexto: duracion === null ? '' : formatoNumero(duracion, 2),
      valorSinIva: numeroONulo(g('datos!AW52')),       // AW52
      valorIva: numeroONulo(g('datos!AW53')),          // AW53
      codigoArea: textoOVacio(g('datos!H53')),
      alertaIva: g('validador!D63') === true,          // 'Validador- Datos'!D63
      excedeCuantiaIva: isFinite(valorTotal) && limpio(s.valorTotal) !== '' && valorTotal >= limiteIva,
      limiteIvaPesos: limiteIva,
      // Retención
      codificacion: sinError(g('datos!C73')),
      anioCertificados: anioCert,
      anioVigenciaCertificados: anioCert + 2,
      anioCertificadosExcel: numeroONulo(g('datos!AN76')),
      // Deducciones
      depValorMensual: numeroONulo(g('deducciones!M28')),
      depAnexos: sinError(g('deducciones!B31')),
      saludValorMensual: numeroONulo(g('deducciones!W39')),
      saludTextoCertificado: colapsar(sinError(g('deducciones!B42'))),
      hipValorMensual: bm9 === null ? null : titulares > 0 ? bm9 / titulares : bm9,
      hipTextoCertificado: colapsar(sinError(g('deducciones!B57'))),
      textoSoportes: TXT_SOPORTES,
      // Encabezado de la hoja de deducciones
      fechaDiligenciamiento: ev.hoy,
      dedNombre: colapsar(sinError(g('deducciones!J11'))),
      dedIdentificacion: limpio(s.numeroId),
      dedContrato: colapsar(textoOVacio(g('deducciones!S13'))),
      dedAnio: sinError(g('deducciones!Z13')),
      // Certificación y firma
      textoCertificacion: 'Yo ' + nombre + ' ' + juramento,
      textoCertificacionExcel: sinError(g('datos!C91')),
      mensajeFormulario: sinError(g('datos!C95')),
      puntajeValidador: numeroONulo(g('validador!B57')),
      completoExcel: g('validador!B57') === TOTAL_VALIDADOR,
      firmaNombre: colapsar(sinError(g('datos!E101'))),
      firmaDocumento: colapsar(sinError(g('datos!G102'))),
      firmaContrato: sinError(g('datos!F103')),
      // Valores exactos de cada celda calculada ('hoja!CELDA') y las entradas usadas.
      celdas: c,
      entradas,
      filasValidador: ev.filasValidador,
    };
  }

  // ───────────────────────── Utilidades públicas ─────────────────────────
  // Dígito de verificación DIAN (módulo 11).
  function dvNit(nit) {
    const n = String(nit == null ? '' : nit).replace(/[\s.]/g, '');
    if (!/^\d{1,15}$/.test(n)) return '';
    const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    let suma = 0;
    for (let i = 0; i < n.length; i++) suma += Number(n[n.length - 1 - i]) * pesos[i];
    const r = suma % 11;
    return String(r > 1 ? 11 - r : r);
  }
  function formatoNumero(x, maxDecimales) {
    const neg = x < 0;
    const r = redondear(Math.abs(x), maxDecimales || 0);
    let [ent, frac] = r.toFixed(maxDecimales || 0).split('.');
    frac = frac ? frac.replace(/0+$/, '') : '';
    return (neg ? '-' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (frac ? ',' + frac : '');
  }
  // '$ 1.234.567' (es-CO). Acepta número o texto con dígitos. Vacío o inválido → ''.
  function formatoPesos(n, decimales) {
    if (n === null || n === undefined || n === '') return '';
    let x = n;
    if (typeof n !== 'number') {
      const t = String(n).trim();
      const neg = t.startsWith('-');
      const dig = t.replace(/\D/g, '');
      if (!dig) return '';
      x = Number(dig) * (neg ? -1 : 1);
    }
    if (!isFinite(x)) return '';
    const dec = decimales === undefined ? (Number.isInteger(x) ? 0 : 2) : decimales;
    const r = redondear(Math.abs(x), dec);
    const [ent, frac] = r.toFixed(dec).split('.');
    return (x < 0 ? '-' : '') + '$ ' + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (frac ? ',' + frac : '');
  }

  // ───────────────────────── Validación amigable ─────────────────────────
  const MENSAJES_FALTA = {
    nit: 'Escribe tu NIT (sin el dígito de verificación).',
    dv: 'Escribe el dígito de verificación (DV) que aparece en tu RUT.',
    tipoDocumento: 'Selecciona tu tipo de documento.',
    numeroId: 'Escribe tu número de identificación.',
    primerApellido: 'Escribe tu primer apellido.',
    primerNombre: 'Escribe tu primer nombre.',
    pensionado: 'Cuéntanos si eres pensionado.',
    direccion: 'Escribe tu dirección tal como aparece en el RUT.',
    pais: 'Selecciona el país de tu dirección.',
    departamento: 'Selecciona el departamento.',
    municipio: 'Selecciona el municipio.',
    email: 'Escribe tu correo electrónico (el mismo del RUT).',
    telefono1: 'Escribe el teléfono 1 (si no tienes fijo, escribe 0).',
    telefono2: 'Escribe tu número de celular.',
    banco: 'Selecciona tu banco.',
    sucursal: 'Escribe la sucursal donde abriste la cuenta.',
    tipoCuenta: 'Selecciona el tipo de cuenta.',
    numeroCuenta: 'Escribe el número de tu cuenta.',
    actividadRut: 'Selecciona tu actividad económica principal del RUT (código CIIU).',
    actividadRit: 'Selecciona tu actividad económica del RIT.',
    regimenIva: 'Selecciona tu régimen de IVA.',
    numeroContrato: 'Escribe el número del contrato.',
    anioContrato: 'Escribe el año del contrato.',
    valorTotal: 'Escribe el valor total del contrato.',
    valorMensual: 'Escribe el valor del pago mensual.',
    fechaInicio: 'Indica la fecha del acta de inicio.',
    fechaTerminacion: 'Indica la fecha de terminación del contrato.',
    cesion: 'Indica si el contrato fue cedido.',
    codigoArl: 'Selecciona el código de actividad de la ARL.',
    crp1: 'Escribe el número del CRP.',
    fechaCrp1: 'Indica la fecha del CRP.',
    rpVigenciaFutura: 'Indica si el contrato tiene RP de vigencia futura.',
    areaFuncional: 'Selecciona el área funcional de la SED.',
    interventorNombre: 'Escribe el nombre del interventor o supervisor.',
    interventorCargo: 'Escribe el cargo del interventor o supervisor.',
    operativoNombre: 'Escribe el nombre del operativo.',
    operativoId: 'Escribe la identificación del operativo.',
    // Preguntas C1–C4 en lenguaje sencillo (el código entre paréntesis ubica la pregunta en el formato).
    c1: (cfg) => 'Cuéntanos si tus ingresos de ' + (cfg.anioGravable || 'el año gravable') + ' superaron ' +
      Number(cfg.ingresosC1Uvt || 1400).toLocaleString('es-CO') + ' UVT (C1).',
    c2: (cfg) => 'Cuéntanos si debes declarar renta por ' + (cfg.anioGravable || 'el año gravable') + ' (C2).',
    c3: 'Cuéntanos si perteneces al Régimen Simple de Tributación (C3).',
    c4: 'Cuéntanos si vas a restar costos y gastos de tu actividad para la retención (C4).',
    afc: 'Cuéntanos si haces aportes a una cuenta AFC.',
    afcEntidad: 'Escribe la entidad de tu cuenta AFC.',
    afcNit: 'Escribe el NIT de la entidad de tu cuenta AFC.',
    afcValor: 'Escribe el valor mensual de tus aportes AFC.',
    pensionesVoluntarias: 'Cuéntanos si haces aportes a pensiones voluntarias.',
    pvEntidad: 'Escribe la entidad de tus pensiones voluntarias.',
    pvNit: 'Escribe el NIT de la entidad de pensiones voluntarias.',
    pvValor: 'Escribe el valor mensual de tus aportes a pensiones voluntarias (mayor que cero).',
    depNombre: 'Escribe el nombre del dependiente.',
    depId: 'Escribe el número de identificación del dependiente.',
    depEdad: 'Escribe la edad del dependiente.',
    depParentesco: 'Selecciona el parentesco del dependiente.',
    depMotivo: 'Selecciona el motivo por el que solicitas la deducción por dependiente.',
    saludEntidad: 'Escribe la entidad de medicina prepagada o plan complementario.',
    saludNit: 'Escribe el NIT de la entidad de salud.',
    saludValorTotal: 'Escribe el valor total pagado en salud durante el año.',
    saludFechaExpedicion: 'Indica la fecha de expedición del certificado de salud.',
    saludFechaCorte: 'Indica la fecha de corte del certificado de salud.',
    hipEntidad: 'Escribe la entidad del crédito hipotecario.',
    hipNit: 'Escribe el NIT de la entidad del crédito hipotecario.',
    hipValorIntereses: 'Escribe el valor de los intereses pagados.',
    hipFechaExpedicion: 'Indica la fecha de expedición del certificado del crédito.',
    hipFechaCorte: 'Indica la fecha de corte del certificado del crédito.',
    hipTitulares: 'Indica cuántos titulares tiene el crédito hipotecario.',
  };
  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const fechaLarga = (iso) => {
    const p = partesISO(iso);
    if (!p) return iso;
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return p.d + ' de ' + meses[p.m - 1] + ' de ' + p.y;
  };
  const estaEn = (lista, valorBuscado, prop) =>
    (lista || []).some((x) => clave(prop ? x[prop] : x) === clave(valorBuscado));

  /** Actividades ARL que se pueden elegir: las de CONFIG.arlActivas (si la lista está vacía, toda la tabla). */
  function arlActivas(cat, cfg) {
    const activas = new Set(((cfg && cfg.arlActivas) || []).map(String));
    const lista = (cat && cat.arl) || [];
    return activas.size ? lista.filter((x) => activas.has(String(x.codigo))) : lista;
  }

  function validar(s, hoy) {
    s = s || {};
    const SCH = root.SCHEMA || { fields: {} };
    const cfg = root.CONFIG || {};
    const cat = root.CATALOGOS || {};
    const D = derivados(s, hoy);
    const faltantes = [];
    const errores = {};
    const advertencias = [];
    const bloqueantes = new Set();
    const pasoDe = (campo) => (SCH.fields[campo] ? SCH.fields[campo].step : undefined);
    const err = (campo, mensaje, bloqueante) => {
      if (errores[campo]) return;
      errores[campo] = mensaje;
      if (bloqueante) bloqueantes.add(campo);
    };
    const visible = (f) => esVisible(f, s);
    const requerido = (f) => (typeof f.required === 'function' ? !!f.required(s) : !!f.required);
    const val = (id) => limpio(s[id]);
    const tiene = (id) => val(id) !== '';
    const activo = (id) => { const f = SCH.fields[id]; return !f || visible(f); };

    const mensajeFalta = (id, f) => {
      const m = MENSAJES_FALTA[id];
      return typeof m === 'function' ? m(cfg) : m || 'Completa «' + f.label + '».';
    };
    // 1) Campos obligatorios (cubre las 54 verificaciones de 'Validador- Datos'!B3:B56).
    for (const id of Object.keys(SCH.fields)) {
      const f = SCH.fields[id];
      if (!visible(f) || !requerido(f) || tiene(id)) continue;
      faltantes.push({ campo: id, step: f.step, mensaje: mensajeFalta(id, f) });
    }
    // Excel B51: el valor de pensiones voluntarias debe ser mayor que cero.
    if (val('pensionesVoluntarias') === 'SI' && tiene('pvValor') && !(Number(val('pvValor')) > 0)) {
      faltantes.push({ campo: 'pvValor', step: pasoDe('pvValor'), mensaje: MENSAJES_FALTA.pvValor, conValor: true });
    }

    // 2) Formato y consistencia.
    const digitos = (id, etiqueta) => {
      if (tiene(id) && !/^\d+$/.test(val(id))) { err(id, (etiqueta || 'Este campo') + ' solo admite números, sin puntos, comas ni espacios.'); return false; }
      return tiene(id);
    };
    const enRango = (id, min, max, mensaje) => {
      if (!tiene(id)) return;
      const n = Number(val(id));
      if (!(n >= min && n <= max)) err(id, mensaje);
    };
    const fechaValida = (id) => {
      if (!tiene(id)) return null;
      if (!partesISO(val(id))) { err(id, 'La fecha no es válida.'); return null; }
      return val(id);
    };

    // Identificación
    if (tiene('nit') && !/^\d+$/.test(val('nit'))) bloqueantes.add('nit'); // Excel B8: A13-AP13 da #VALUE!
    if (digitos('nit', 'El NIT')) {
      enRango('nit', 1000, 3000000000, 'El NIT debe estar entre 1.000 y 3.000.000.000. Escríbelo sin el dígito de verificación.');
    }
    const nitOk = tiene('nit') && /^\d+$/.test(val('nit'));
    if (tiene('dv')) {
      if (!/^\d$/.test(val('dv'))) err('dv', 'El DV es un solo dígito (0 a 9).');
      else if (nitOk && val('dv') !== dvNit(val('nit'))) {
        err('dv', 'El DV no coincide con el NIT: para el NIT ' + val('nit') + ' el dígito de verificación es ' + dvNit(val('nit')) + '. Revisa tu RUT.');
      }
    }
    if (digitos('numeroId', 'El número de identificación')) {
      enRango('numeroId', 1000, 3000000000, 'El número de identificación debe estar entre 1.000 y 3.000.000.000.');
      if (nitOk && Number(val('numeroId')) !== Number(val('nit'))) {
        err('numeroId', 'Para persona natural, el número de identificación debe ser igual al NIT (' + val('nit') + ').', true);
      }
    } else if (tiene('numeroId')) {
      bloqueantes.add('numeroId'); // Excel B7/B8: AP13 no numérico
    }
    if (tiene('tipoDocumento') && !estaEn(cat.tiposDocumento, val('tipoDocumento'), 'nombre')) {
      err('tipoDocumento', 'Selecciona un tipo de documento de la lista.');
    }

    // Contacto
    const colombia = minus(val('pais')) === 'colombia';
    if (tiene('pais') && !estaEn(cat.paises, val('pais'), 'nombre')) err('pais', 'Selecciona un país de la lista.');
    if (colombia && activo('departamento') && tiene('departamento') && D.codDepto === '') {
      err('departamento', 'Selecciona un departamento de la lista.', true);
    }
    if (colombia && activo('municipio') && tiene('municipio') && tiene('departamento') && D.codMunicipio === '') {
      err('municipio', 'El municipio no corresponde al departamento seleccionado.');
    }
    if (tiene('email') && !RE_EMAIL.test(val('email'))) err('email', 'Revisa el correo: debe tener la forma nombre@dominio.com.');
    if (tiene('telefono1') && !(val('telefono1') === '0' || /^\d{10}$/.test(val('telefono1')))) {
      err('telefono1', 'El teléfono debe tener 10 dígitos (si no tienes fijo, escribe 0).');
    }
    if (tiene('telefono2') && !/^\d{10}$/.test(val('telefono2'))) err('telefono2', 'El celular debe tener 10 dígitos.');

    // Pagos
    if (tiene('banco') && D.codBanco === '') err('banco', 'Selecciona un banco de la lista.', true);
    if (tiene('sucursal') && val('sucursal').length > 16) err('sucursal', 'La sucursal admite máximo 16 caracteres.');
    if (tiene('tipoCuenta') && D.codTipoCuenta === '') err('tipoCuenta', 'Selecciona un tipo de cuenta de la lista.', true);
    if (digitos('numeroCuenta', 'El número de cuenta') && val('numeroCuenta').length > 16) {
      err('numeroCuenta', 'El número de cuenta admite máximo 16 dígitos.');
    }

    // Tributario
    if (tiene('actividadRut') && (!/^\d{4}$/.test(val('actividadRut')) || D.descCiiu === TXT_NO_EXISTE)) {
      err('actividadRut', 'El código CIIU ' + val('actividadRut') + ' no existe en la lista. Verifica la casilla 46 de tu RUT.', true);
    }
    if (tiene('actividadRit') && (D.descRit === TXT_NO_EXISTE || D.descRit === '')) {
      err('actividadRit', 'El código ' + val('actividadRit') + ' no existe en la lista de actividades del RIT. Verifica tu RIT.', true);
    }
    if (tiene('regimenIva') && !estaEn(cat.regimenIva, val('regimenIva'), 'nombre')) err('regimenIva', 'Selecciona un régimen de IVA de la lista.');

    // Contrato
    if (tiene('numeroContrato') && val('numeroContrato').length > 8) err('numeroContrato', 'El número de contrato admite máximo 8 caracteres.');
    if (tiene('anioContrato')) {
      const a = Number(val('anioContrato'));
      if (!/^\d{4}$/.test(val('anioContrato')) || a < cfg.anioContratoMin || a > cfg.anioContratoMax) {
        err('anioContrato', 'El año del contrato debe estar entre ' + cfg.anioContratoMin + ' y ' + cfg.anioContratoMax + '.');
      }
    }
    if (digitos('valorTotal', 'El valor total')) enRango('valorTotal', 0, 10000000000, 'El valor total debe estar entre $ 0 y $ 10.000.000.000.');
    if (digitos('valorMensual', 'El valor mensual')) {
      if (!(Number(val('valorMensual')) > 0)) err('valorMensual', 'El valor mensual debe ser mayor que cero.');
      else if (tiene('valorTotal') && /^\d+$/.test(val('valorTotal')) && Number(val('valorMensual')) > Number(val('valorTotal'))) {
        err('valorMensual', 'El valor mensual no puede ser mayor que el valor total del contrato.');
      }
    }
    const fMin = cfg.fechaMin || '2016-01-01';
    const fMax = cfg.fechaMax || '2030-12-31';
    const rangoFechas = 'entre el ' + fechaLarga(fMin) + ' y el ' + fechaLarga(fMax);
    const inicio = fechaValida('fechaInicio');
    if (inicio && (inicio < fMin || inicio > fMax)) err('fechaInicio', 'La fecha del acta de inicio debe estar ' + rangoFechas + '.');
    const fin = fechaValida('fechaTerminacion');
    if (fin) {
      if (inicio && fin < inicio) err('fechaTerminacion', 'La fecha de terminación no puede ser anterior al acta de inicio.');
      else if (fin > fMax || fin < fMin) err('fechaTerminacion', 'La fecha de terminación debe estar ' + rangoFechas + '.');
    }
    const crp1 = fechaValida('fechaCrp1');
    if (crp1) {
      if (crp1 < fMin) err('fechaCrp1', 'La fecha del CRP debe ser posterior al ' + fechaLarga(fMin) + '.');
      else if (inicio && crp1 > inicio) err('fechaCrp1', 'La fecha del CRP no puede ser posterior al acta de inicio.');
      else if (crp1 > fMax) err('fechaCrp1', 'La fecha del CRP debe estar ' + rangoFechas + '.');
    }
    ['fechaCrp2', 'fechaCrp3'].forEach((id) => {
      const f = fechaValida(id);
      if (f && (f < fMin || f > fMax)) err(id, 'La fecha del CRP debe estar ' + rangoFechas + '.');
    });
    if (tiene('codigoArl') && !estaEn(arlActivas(cat, cfg), val('codigoArl'), 'codigo')) err('codigoArl', 'Selecciona un código ARL de la lista.');
    if (tiene('areaFuncional') && !estaEn(cat.areas, val('areaFuncional'), 'nombre')) err('areaFuncional', 'Selecciona un área de la lista.');
    digitos('operativoId', 'La identificación del operativo');

    // Ahorro y deducciones
    ['afcNit', 'pvNit', 'saludNit', 'hipNit', 'depId'].forEach((id) => { if (activo(id)) digitos(id, 'El número'); });
    ['afcValor', 'saludValorTotal', 'hipValorIntereses'].forEach((id) => {
      if (activo(id) && digitos(id, 'El valor') && !(Number(val(id)) > 0)) err(id, 'El valor debe ser mayor que cero.');
    });
    if (activo('pvValor')) digitos('pvValor', 'El valor');
    if (activo('depEdad') && digitos('depEdad', 'La edad')) enRango('depEdad', 1, 100, 'La edad debe estar entre 1 y 100 años.');
    if (activo('depMotivo') && tiene('depMotivo') && !estaEn(cat.motivosDependientes, val('depMotivo'), 'texto')) {
      err('depMotivo', 'Selecciona un motivo de la lista.');
    }
    if (activo('hipTitulares') && digitos('hipTitulares', 'La cantidad de titulares')) {
      enRango('hipTitulares', 1, 99, 'El crédito debe tener al menos un titular.');
    }
    if (activo('foliosAnexos') && digitos('foliosAnexos', 'El número de folios')) {
      enRango('foliosAnexos', 1, 100, 'El número de folios debe estar entre 1 y 100.');
    }
    const hoyIso = D.hoy;
    [['saludFechaExpedicion', 'saludFechaCorte'], ['hipFechaExpedicion', 'hipFechaCorte']].forEach(([exp, corte]) => {
      if (!activo(exp)) return;
      const fe = fechaValida(exp);
      const fc = fechaValida(corte);
      if (fe && fe > hoyIso) err(exp, 'La fecha de expedición no puede ser posterior a hoy.');
      if (fe && fc && fc > fe) err(corte, 'La fecha de corte no puede ser posterior a la de expedición.');
      const esperado = D.anioCertificados + '-12-31';
      if (fc && fc !== esperado) {
        advertencias.push({ codigo: 'CERTIFICADO_CORTE', campo: corte, step: pasoDe(corte),
          mensaje: 'El certificado debe tener corte al 31 de diciembre de ' + D.anioCertificados + '.' });
      }
    });

    // 3) Advertencias.
    if (minus(val('regimenIva')) === 'no responsable iva' && D.excedeCuantiaIva) {
      advertencias.push({ codigo: 'IVA_CUANTIA', campo: 'regimenIva', step: pasoDe('regimenIva'),
        mensaje: 'VERIFICAR RESPONSABILIDAD DE IVA POR CUANTÍA DEL CONTRATO',
        detalle: 'El valor del contrato (' + formatoPesos(Number(val('valorTotal'))) + ') iguala o supera ' +
          Number(cfg.limiteIvaUvt).toLocaleString('es-CO') + ' UVT (' + formatoPesos(D.limiteIvaPesos) +
          '). Con contratos de esa cuantía normalmente debes ser responsable de IVA; revisa tu RUT. ' +
          'Mientras tanto, el formato liquida el valor como si incluyera IVA.' });
    }
    // 'FORMATO DEDUCCIONES'!S13 = IF(A46, A46, " ") da #VALUE! cuando el número de contrato no es un número
    // (rareza heredada del Excel). Solo se avisa: el Excel acepta texto en A46.
    if (tiene('numeroContrato') && !/^\d+$/.test(val('numeroContrato').replace(/\s+/g, ''))) {
      advertencias.push({ codigo: 'CONTRATO_NO_NUMERICO', campo: 'numeroContrato', step: pasoDe('numeroContrato'),
        mensaje: 'Escribe solo el número del contrato (por ejemplo 1234), sin letras ni guiones: con letras, la hoja de deducciones del Excel muestra un error en el número de contrato.' });
    }
    if (tiene('pais') && !colombia) {
      advertencias.push({ codigo: 'EXCEL_PAIS_EXTERIOR', campo: 'pais', step: pasoDe('pais'),
        mensaje: 'Tu dirección está fuera de Colombia. El Excel de Tesorería pide un departamento colombiano y mostrará «País» como pendiente; es una limitación conocida del formato, no tienes que hacer nada más.' });
    }
    if (D.anioCertificadosExcel !== null && D.anioCertificadosExcel !== D.anioCertificados) {
      advertencias.push({ codigo: 'EXCEL_TABLA_CERTIFICADOS', interna: true,
        mensaje: 'La tabla de años de certificados del Excel (\'Validador- Datos\'!BI13:BJ17) no cubre la fecha de hoy: el Excel mostrará ' +
          D.anioCertificadosExcel + '. Según la regla del 1 de abril corresponde ' + D.anioCertificados + '.' });
    }

    const completo = faltantes.length === 0 && bloqueantes.size === 0;
    return {
      completo,
      listo: completo && Object.keys(errores).length === 0,
      faltantes,
      errores,
      advertencias,
      excel: { puntaje: D.puntajeValidador, completo: D.completoExcel, mensaje: D.mensajeFormulario, codificacion: D.codificacion },
    };
  }

  // ───────────────────── Limpieza de lo que se escribe, pega o carga de un borrador ─────────────────────
  // Dinero en pesos (sin centavos): '4.500.000,00', '$ 1.500.000,50' y '4500000,5' → '4500000'.
  // La coma seguida de 0 a 2 dígitos al final es la coma decimal (es-CO). Con opciones.pegado también se
  // entiende el punto decimal ('4,500,000.00'), que al escribir no se puede distinguir del de miles.
  // Devuelve { digitos, centavos }: centavos = lo que va después de la coma decimal (o null si no hay).
  function limpiarDinero(texto, opciones) {
    const t = String(texto == null ? '' : texto).trim();
    let entero = t;
    let centavos = null;
    let m = /,(\d{0,2})\s*$/.exec(t);
    if (!m && opciones && opciones.pegado) m = /\.(\d{1,2})\s*$/.exec(t);
    if (m) { entero = t.slice(0, m.index); centavos = m[1]; }
    return { digitos: entero.replace(/\D/g, ''), centavos };
  }
  // Teléfono: solo dígitos, sin el indicativo de Colombia (+57 o 0057) cuando viene con un número de 10 dígitos.
  function limpiarTelefono(texto) {
    const d = String(texto == null ? '' : texto).replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('57')) return d.slice(2);
    if (d.length === 14 && d.startsWith('0057')) return d.slice(4);
    return d;
  }
  // NIT pegado con su DV ('52.123.456-7') → { nit: '52123456', dv: '7' }; sin DV → { nit, dv: null }.
  function separarNitDv(texto) {
    const t = String(texto == null ? '' : texto);
    const m = /^\D*(\d[\d.,\s]*?)\s*-\s*(\d)\s*$/.exec(t);
    if (m) return { nit: m[1].replace(/\D/g, ''), dv: m[2] };
    return { nit: t.replace(/\D/g, ''), dv: null };
  }

  // Valor de un borrador o del autoguardado llevado a la forma que usa el formulario: SI/NO en mayúsculas,
  // el texto exacto del catálogo, fechas ISO válidas (si no, vacío), dígitos sin separadores. Así la
  // pantalla, la validación, el PDF y el Excel ven siempre el mismo valor.
  const LARGO_MAXIMO_VALOR = 500;
  const mayusSinTildes = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  function normalizarValor(campo, v) {
    if (v === null || v === undefined || (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')) return '';
    let t = String(v);
    if (t.length > LARGO_MAXIMO_VALOR) t = t.slice(0, LARGO_MAXIMO_VALOR);
    if (!campo) return t.trim();
    switch (campo.type) {
      case 'yesno': { const u = mayusSinTildes(t); return u === 'SI' ? 'SI' : u === 'NO' ? 'NO' : ''; }
      case 'check': return ['SI', 'X', 'TRUE', 'VERDADERO', '1'].includes(mayusSinTildes(t)) ? 'SI' : '';
      case 'date': return partesISO(t.trim()) ? t.trim() : '';
      case 'money': return limpiarDinero(t, { pegado: true }).digitos.replace(/^0+(?=\d)/, '');
      case 'digits': return t.replace(/\D/g, '');
      case 'tel': return limpiarTelefono(t);
      case 'email': return t.replace(/\s/g, '').toLowerCase();
      case 'upper': return t.replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-CO');
      case 'select':
      case 'combo': return t.trim() === '' ? '' : valorCampo(campo, t);
      default: return t.replace(/\s+/g, ' ').trim();
    }
  }
  // origen: { idCampo: valor } (borrador o autoguardado). Devuelve { valores, usados }: solo los campos del
  // esquema que vienen en el origen, ya normalizados; `usados` cuenta los que quedan con algún valor.
  function normalizarEstado(origen) {
    const campos = (root.SCHEMA && root.SCHEMA.fields) || {};
    const valores = {};
    let usados = 0;
    if (!origen || typeof origen !== 'object') return { valores, usados };
    for (const id of Object.keys(campos)) {
      if (!Object.prototype.hasOwnProperty.call(origen, id)) continue;
      const v = origen[id];
      if (v !== null && v !== undefined && typeof v === 'object') continue; // valor inservible: se ignora
      valores[id] = normalizarValor(campos[id], v);
      if (valores[id] !== '') usados++;
    }
    return { valores, usados };
  }

  const Calc = {
    version: '1.0.0',
    hojas: HOJAS,
    filasValidador: FILAS_VALIDADOR,
    textos: { noExiste: TXT_NO_EXISTE, revise: TXT_REVISE, ivaCuantia: TXT_IVA_CUANTIA, sinDiligenciar: TXT_SIN_DILIGENCIAR },
    derivados,
    validar,
    evaluar,
    celdasEntrada,
    celdasDeEntrada,
    valorCampo,
    dvNit,
    formatoPesos,
    formatoNumero,
    fechaSerialExcel,
    isoDeSerial,
    hoyISO,
    anioCertificados,
    redondearExcel: (x, d) => redondear(x, d),
    limpiar: { dinero: limpiarDinero, telefono: limpiarTelefono, nitDv: separarNitDv },
    normalizarValor,
    normalizarEstado,
  };

  root.Calc = Calc;
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
