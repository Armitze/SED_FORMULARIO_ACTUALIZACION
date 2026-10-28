// Pruebas de la exportación al Excel oficial (src/js/export-excel.js) y del empaquetado (tools/build.mjs).
//
//   node --test tests/export.test.mjs
//
// 1. Unidades: mapeo de valores (escrituras), edición de XML (editarHoja), nombre de archivo.
// 2. Integración: genera .xlsx en tests/.tmp/ a partir de la plantilla original y
//    (a) los relee con Python + openpyxl (py -X utf8) comprobando valor y tipo de cada celda mapeada,
//    (b) comprueba que el resto del paquete queda idéntico a la plantilla,
//    (c) los abre en Excel por COM (tests/verificar-export.ps1): sin reparación, recalcula y lee
//        las celdas calculadas (se omite si no hay Excel/PowerShell).
// 3. Impresión: HTML del documento oficial (print.js).
// 4. Build: construye un HTML autocontenido y lo abre en Edge/Chrome sin interfaz (file://, sin red)
//    comprobando módulos, Excel generado en el navegador, pdf.js con worker embebido e impresión.
// Todos los datos de prueba son ficticios.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(RAIZ, 'tests', '.tmp');
fs.mkdirSync(TMP, { recursive: true });

globalThis.window = globalThis;
require(path.join(RAIZ, 'src/js/catalogos.js'));
require(path.join(RAIZ, 'src/js/config.js'));
require(path.join(RAIZ, 'src/js/schema.js'));
const ExportExcel = require(path.join(RAIZ, 'src/js/export-excel.js'));
const JSZip = require('jszip');
const { CATALOGOS, CONFIG, SCHEMA } = globalThis;

// Calc (otro módulo) es opcional: si existe se usa para comparar con lo que calcula Excel.
let Calc = null;
try {
  const ruta = path.join(RAIZ, 'src/js/calc.js');
  if (fs.existsSync(ruta)) { require(ruta); Calc = globalThis.Calc || null; }
} catch (e) { Calc = null; }

const ARCHIVO_PLANTILLA = fs.readdirSync(RAIZ).find((f) => /^13-IF-016.*\.xlsx$/i.test(f));
const PLANTILLA = fs.readFileSync(path.join(RAIZ, ARCHIVO_PLANTILLA));
const HOJA = SCHEMA.nombresHojas;

// ───────────────────────── Datos de prueba (ficticios) ─────────────────────────

function dvNit(nit) {
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const d = String(nit).split('').reverse();
  let suma = 0;
  d.forEach((c, i) => { suma += Number(c) * pesos[i]; });
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

const NIT = '1023456789';
const MOTIVO = CATALOGOS.motivosDependientes[0];

const COMPLETO = Object.freeze({
  nit: NIT, dv: dvNit(NIT), tipoDocumento: 'Cédula de ciudadanía ', numeroId: NIT,
  primerApellido: 'PRUEBA', segundoApellido: 'EJEMPLO', primerNombre: 'ANA', otrosNombres: 'MARÍA',
  pensionado: 'NO',
  direccion: 'CL 10 # 20-30 AP 401', pais: 'COLOMBIA', departamento: 'Bogotá D.C', municipio: 'BOGOTÁ',
  email: 'ana.prueba@example.com', telefono1: '6015551234', telefono2: '3001234567',
  banco: 'Bancolombia SA', sucursal: 'CHAPINERO', tipoCuenta: 'Ahorros', numeroCuenta: '1234567890123456',
  actividadRut: '6201', actividadRit: '6201', regimenIva: 'NO RESPONSABLE IVA',
  numeroContrato: '1234', anioContrato: '2026', valorTotal: '48000000', valorMensual: '6000000',
  fechaInicio: '2026-02-01', fechaTerminacion: '2026-09-30', cesion: 'NO', codigoArl: '1620101',
  crp1: '5678', fechaCrp1: '2026-01-20', rpVigenciaFutura: 'NO',
  crp2: '5700', fechaCrp2: '2026-01-25', crp3: '05701', fechaCrp3: '2026-01-28',
  areaFuncional: 'Oficina Asesora de Planeación', interventorNombre: 'CARLOS PRUEBA SUPERVISOR',
  interventorCargo: 'PROFESIONAL ESPECIALIZADO', operativoNombre: 'LUISA EJEMPLO OPERATIVA', operativoId: '52123456',
  c1: 'NO', c2: 'NO', c3: 'NO', c4: 'SI',
  dedDependientes: 'SI', dedHipotecario: 'SI', dedSaludNoPos: 'SI',
  afc: 'SI', afcEntidad: 'BANCO DE PRUEBA AFC', afcNit: '8600343137', afcValor: '500000',
  pensionesVoluntarias: 'SI', pvEntidad: 'FONDO DE PRUEBA', pvNit: '8001443313', pvValor: '300000',
  depNombre: 'TOMÁS PRUEBA EJEMPLO', depId: '1012345678', depEdad: '12', depParentesco: 'HIJO', depMotivo: MOTIVO.texto,
  saludEntidad: 'MEDICINA PREPAGADA DE PRUEBA', saludNit: '8000881702', saludValorTotal: '4800000',
  saludFechaExpedicion: '2026-01-15', saludFechaCorte: '2025-12-31',
  hipEntidad: 'BANCO HIPOTECARIO DE PRUEBA', hipNit: '8600029644', hipValorIntereses: '18000000',
  hipFechaExpedicion: '2026-01-20', hipFechaCorte: '2025-12-31', hipTitulares: '2',
  foliosAnexos: '6',
});

const CUENTA_CERO = Object.freeze({ ...COMPLETO, numeroCuenta: '0012345678', telefono1: '0', operativoId: '052123456' });

// Variante: pensionado, responsable de IVA, SIMPLE, RIT de 3 dígitos, sin deducciones ni AFC.
const VARIANTE = Object.freeze({
  ...COMPLETO, pensionado: 'SI', c1: 'SI', c2: 'NO', c3: 'SI', c4: 'NO', regimenIva: 'RESPONSABLE IVA',
  actividadRit: '111', valorTotal: '250000000', valorMensual: '25000000', fechaTerminacion: '2026-11-30',
  dedDependientes: '', dedHipotecario: '', dedSaludNoPos: '', afc: 'NO', rpVigenciaFutura: 'SI', cesion: 'SI',
  crp2: '', fechaCrp2: '', crp3: '', fechaCrp3: '', otrosNombres: '', segundoApellido: 'DE LA PEÑA',
});

// Parcial: pocos datos, con deducción por dependientes marcada.
const PARCIAL = Object.freeze({ primerApellido: 'PRUEBA', primerNombre: 'ANA', pais: 'COLOMBIA', dedDependientes: 'SI', depNombre: 'HIJO DE PRUEBA', valorMensual: '3000000' });

// Valor esperado de cada celda mapeada (tipo 'n' número, 's' texto, '' vacía) según el estado.
function serial(iso) {
  return (Date.UTC(...iso.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0))) - Date.UTC(1899, 11, 30)) / 86400000;
}

function esperadas(s) {
  const r = {};
  const put = (hoja, celda, tipo, valor) => { r[`${HOJA[hoja]}!${celda}`] = { tipo, valor }; };
  for (const [id, f] of Object.entries(SCHEMA.fields)) {
    const ex = f.excel;
    const visible = typeof f.visible === 'function' ? f.visible(s) : true;
    const v = visible && s[id] != null ? String(s[id]) : '';
    switch (ex.tipo) {
      case 'texto': put(ex.hoja, ex.celda, v ? 's' : '', v); break;
      case 'numero': put(ex.hoja, ex.celda, v ? 'n' : '', v ? Number(v) : ''); break;
      case 'auto': put(ex.hoja, ex.celda, v ? (/^(0|[1-9]\d*)$/.test(v) ? 'n' : 's') : '', v ? (/^(0|[1-9]\d*)$/.test(v) ? Number(v) : v) : ''); break;
      case 'fecha': put(ex.hoja, ex.celda, v ? 'n' : '', v ? serial(v) : ''); break;
      case 'digitos': ex.celdas.forEach((c, i) => put(ex.hoja, c, v[i] ? 'n' : '', v[i] ? Number(v[i]) : '')); break;
      case 'x': put(ex.hoja, ex.si, v === 'SI' ? 's' : '', v === 'SI' ? 'X' : ''); put(ex.hoja, ex.no, v === 'NO' ? 's' : '', v === 'NO' ? 'X' : ''); break;
      case 'marca': put(ex.hoja, ex.celda, v === 'SI' ? 's' : '', v === 'SI' ? ex.valor : ''); break;
      default: throw new Error(ex.tipo);
    }
  }
  return r;
}

// ───────────────────────── Utilidades ─────────────────────────

function py(script, args = []) {
  const r = spawnSync('py', ['-X', 'utf8', '-', ...args], { input: script, encoding: 'utf8', timeout: 120000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('Python falló: ' + r.stderr);
  return r.stdout;
}

let hayPython = false;
try { hayPython = spawnSync('py', ['-X', 'utf8', '-c', 'import openpyxl'], { encoding: 'utf8', timeout: 60000 }).status === 0; } catch (e) { hayPython = false; }

const PY_LEER = String.raw`
import sys, json, warnings, datetime
warnings.filterwarnings('ignore')
import openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
pedidas = json.load(open(sys.argv[2], encoding='utf-8'))
out = {}
for clave in pedidas:
    hoja, celda = clave.rsplit('!', 1)
    c = wb[hoja][celda]
    v = c.value
    if isinstance(v, datetime.datetime):
        v = (v - datetime.datetime(1899, 12, 30)).days
        t = 'n'
    elif v is None:
        t = ''
    elif isinstance(v, (int, float)) and not isinstance(v, bool):
        t = 'n'
    else:
        t = 's'
        v = str(v)
    # Celda dentro de un rango combinado que no es su esquina superior izquierda.
    oculta = any(c.coordinate in r and c.coordinate != r.start_cell.coordinate for r in wb[hoja].merged_cells.ranges)
    out[clave] = {'tipo': t, 'valor': v if v is not None else '', 'oculta': oculta}
print(json.dumps(out, ensure_ascii=False))
`;

function leerConOpenpyxl(archivo, claves) {
  const lista = path.join(TMP, path.basename(archivo) + '.celdas.json');
  fs.writeFileSync(lista, JSON.stringify(claves));
  return JSON.parse(py(PY_LEER, [archivo, lista]));
}

function celdasDelXml(xml) {
  const mapa = new Map();
  const re = /<c\b[^>]*?\br="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
  let m;
  while ((m = re.exec(xml))) mapa.set(m[1], m[0]);
  return mapa;
}

async function generarA(nombre, s) {
  const bytes = await ExportExcel.generarBytes(s, { plantilla: PLANTILLA });
  const ruta = path.join(TMP, nombre);
  fs.writeFileSync(ruta, bytes);
  return ruta;
}

const normal = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();

// ───────────────────────── 1. Unidades ─────────────────────────

describe('escrituras (mapeo de valores)', () => {
  test('el esquema tiene 75 campos y cubre 87 + 17 celdas', () => {
    assert.equal(Object.keys(SCHEMA.fields).length, 75);
    const { celdas } = ExportExcel.escrituras({});
    const datos = new Set(celdas.filter((c) => c.hoja === 'datos').map((c) => c.celda));
    const ded = new Set(celdas.filter((c) => c.hoja === 'deducciones').map((c) => c.celda));
    assert.equal(datos.size, 87);
    assert.equal(ded.size, 17);
    assert.equal(celdas.length, 104, 'sin celdas duplicadas');
    assert.ok(celdas.every((c) => c.tipo === ''), 'estado vacío => todas las celdas vacías');
    assert.ok(datos.has('A24'), 'A24 (correo de ejemplo de la plantilla) se limpia siempre');
  });

  test('coincide con el valor esperado para el estado completo', () => {
    const { celdas, avisos } = ExportExcel.escrituras(COMPLETO);
    assert.deepEqual(avisos, []);
    const esp = esperadas(COMPLETO);
    for (const c of celdas) {
      const e = esp[`${HOJA[c.hoja]}!${c.celda}`];
      assert.equal(c.tipo, e.tipo, `${c.hoja}!${c.celda} tipo`);
      assert.equal(c.tipo === 'n' ? Number(c.valor) : c.valor, e.valor, `${c.hoja}!${c.celda} valor`);
    }
  });

  test('ceros a la izquierda, dígitos, X, marcas y fechas', () => {
    const porCelda = (s) => Object.fromEntries(ExportExcel.escrituras(s).celdas.map((c) => [c.hoja + '!' + c.celda, c]));
    const c = porCelda(CUENTA_CERO);
    assert.deepEqual([c['datos!AN31'].tipo, c['datos!AN31'].valor], ['n', '0']);
    assert.deepEqual([c['datos!AP31'].tipo, c['datos!AP31'].valor], ['n', '1']);
    assert.equal(c['datos!AX31'].tipo, '', 'después del último dígito la celda queda vacía');
    assert.deepEqual([c['datos!AG24'].tipo, c['datos!AG24'].valor], ['n', '0'], 'teléfono "0" es número');
    assert.deepEqual([c['datos!AH53'].tipo, c['datos!AH53'].valor], ['s', '052123456'], 'auto con cero inicial => texto');
    assert.deepEqual([c['datos!AN50'].tipo, c['datos!AN50'].valor], ['s', '05701']);
    assert.deepEqual([c['datos!S18'].valor, c['datos!Q18'].tipo], ['X', ''], 'pensionado NO => X en S18');
    assert.equal(c['datos!D80'].valor, 'FORMATO SED - CON ANEXOS');
    assert.deepEqual([c['datos!AC46'].tipo, c['datos!AC46'].valor], ['n', String(serial('2026-02-01'))]);
    assert.equal(ExportExcel.serialFecha('2016-01-01'), 42370);
    assert.equal(ExportExcel.serialFecha('2030-12-31'), 47848);
    assert.equal(ExportExcel.serialFecha('1900-03-01'), 61);
    assert.equal(ExportExcel.serialFecha('2026-02-30'), null);
    assert.equal(ExportExcel.serialFecha(''), null);
    // Separadores en dinero / teléfono / dígitos se ignoran.
    const sep = porCelda({ ...COMPLETO, valorTotal: '$ 48.000.000', telefono2: '300 123 4567', numeroCuenta: '1234-5678' });
    assert.deepEqual([sep['datos!K46'].tipo, sep['datos!K46'].valor], ['n', '48000000']);
    assert.deepEqual([sep['datos!AR24'].tipo, sep['datos!AR24'].valor], ['n', '3001234567']);
    assert.deepEqual(['AN31', 'AU31', 'AV31'].map((k) => sep['datos!' + k].valor), ['1', '8', '']);
    // RIT de 3 dígitos: alineado a la izquierda.
    const r = porCelda({ ...COMPLETO, actividadRit: '111' });
    assert.deepEqual(['X39', 'Y39', 'Z39', 'AA39', 'AB39'].map((k) => r['datos!' + k].valor), ['1', '1', '1', '', '']);
  });

  test('campos ocultos no se exportan y los valores de catálogo se escriben exactos', () => {
    const s = { ...COMPLETO, afc: 'NO', pais: 'VENEZUELA', dedSaludNoPos: '' };
    const c = Object.fromEntries(ExportExcel.escrituras(s).celdas.map((x) => [x.hoja + '!' + x.celda, x]));
    assert.equal(c['datos!I83'].tipo, '', 'entidad AFC oculta');
    assert.equal(c['datos!V82'].valor, 'X');
    assert.equal(c['datos!T21'].tipo, '', 'departamento oculto fuera de Colombia');
    assert.equal(c['deducciones!H35'].tipo, '', 'salud no POS no seleccionada');
    assert.equal(c['datos!AC11'].valor, 'Cédula de ciudadanía ', 'conserva el espacio final del catálogo');
  });

  test('textos: escape XML y caracteres de control', () => {
    const { celdas } = ExportExcel.escrituras({ ...COMPLETO, direccion: '  CL 1 <A> & "B"\u0007 _x0041_ ' });
    const d = celdas.find((c) => c.celda === 'AC18');
    assert.equal(d.valor, 'CL 1 <A> & "B" _x005F_x0041_');
  });
});

describe('editarHoja (XML)', () => {
  const base = '<worksheet><dimension ref="A1:C3"/><cols><col min="2" max="2" style="7"/></cols><sheetData>'
    + '<row r="1" spans="1:3"><c r="A1" s="3"/><c r="C1" s="4" t="s"><v>0</v></c></row>'
    + '<row r="3" s="9" customFormat="1"/>'
    + '<row r="5"><c r="A5"><f>1+1</f><v>2</v></c></row>'
    + '</sheetData></worksheet>';

  test('reemplaza, inserta celdas en orden y filas faltantes', () => {
    const cambios = new Map([
      ['B1', { tipo: 's', valor: 'a<b' }],
      ['C1', { tipo: '', valor: '' }],
      ['A1', { tipo: 'n', valor: '5' }],
      ['A3', { tipo: 's', valor: 'x' }],
      ['D2', { tipo: 'n', valor: '1' }],
      ['E7', { tipo: 's', valor: 'z' }],
    ]);
    const xml = ExportExcel.editarHoja(base, cambios);
    assert.match(xml, /<row r="1" spans="1:3"><c r="A1" s="3"><v>5<\/v><\/c><c r="B1" s="7" t="inlineStr"><is><t xml:space="preserve">a&lt;b<\/t><\/is><\/c><c r="C1" s="4"\/><\/row>/);
    assert.match(xml, /<row r="2"><c r="D2"><v>1<\/v><\/c><\/row><row r="3" s="9" customFormat="1"><c r="A3" s="9" t="inlineStr">/);
    assert.match(xml, /<\/row><row r="7"><c r="E7" t="inlineStr"><is><t xml:space="preserve">z<\/t><\/is><\/c><\/row><\/sheetData>/);
    assert.match(xml, /<row r="5"><c r="A5"><f>1\+1<\/f><v>2<\/v><\/c><\/row><row r="7">/);
    assert.match(xml, /<dimension ref="A1:E7"\/>/);
  });

  test('actualizarResultados: solo cambia el resultado guardado de las fórmulas', () => {
    const { actualizarResultados } = ExportExcel._interno;
    const xml = '<sheetData><row r="1"><c r="A1" s="2"/><c r="B1" s="5" t="str"><f>A1&amp;"x"</f><v>viejo</v></c>'
      + '<c r="C1" cm="1"><f t="shared" ref="C1:C2" si="0">1/0</f><v>3</v></c><c r="D1" t="s"><v>4</v></c>'
      + '<c r="E1"><f t="shared" si="0"/><v>1</v></c><c r="F1" t="b"><f>TRUE</f><v>1</v></c></row></sheetData>';
    const out = actualizarResultados(xml, new Map([
      ['A1', 'no es fórmula'], ['B1', 'a<b'], ['C1', { error: '#DIV/0!' }], ['D1', 9], ['E1', 2.5], ['F1', false],
    ]));
    assert.match(out, /<c r="A1" s="2"\/>/, 'celda sin fórmula intacta');
    assert.match(out, /<c r="B1" s="5" t="str"><f>A1&amp;"x"<\/f><v>a&lt;b<\/v><\/c>/);
    assert.match(out, /<c r="C1" cm="1" t="e"><f t="shared" ref="C1:C2" si="0">1\/0<\/f><v>#DIV\/0!<\/v><\/c>/);
    assert.match(out, /<c r="D1" t="s"><v>4<\/v><\/c>/, 'valor constante intacto');
    assert.match(out, /<c r="E1"><f t="shared" si="0"\/><v>2.5<\/v><\/c>/);
    assert.match(out, /<c r="F1" t="b"><f>TRUE<\/f><v>0<\/v><\/c>/);
    assert.equal(actualizarResultados(xml, new Map([['B1', null]])), xml, 'sin valor de Calc no se toca');
  });

  test('nunca escribe sobre una celda con fórmula', () => {
    assert.throws(() => ExportExcel.editarHoja(base, new Map([['A5', { tipo: 'n', valor: '1' }]]), 'Hoja'), /A5.*fórmula/);
  });

  test('la plantilla real no tiene fórmulas en las celdas mapeadas', async () => {
    const zip = await JSZip.loadAsync(PLANTILLA);
    for (const [hoja, archivo] of [['datos', 'xl/worksheets/sheet1.xml'], ['deducciones', 'xl/worksheets/sheet3.xml']]) {
      const xml = await zip.file(archivo).async('string');
      const celdas = celdasDelXml(xml);
      for (const c of ExportExcel.escrituras({}).celdas.filter((x) => x.hoja === hoja)) {
        assert.ok(celdas.has(c.celda), `${hoja}!${c.celda} existe en la plantilla`);
        assert.doesNotMatch(celdas.get(c.celda), /<f[\s>/]/, `${hoja}!${c.celda} sin fórmula`);
      }
    }
  });
});

describe('nombreArchivo', () => {
  test('NOMBRE_CONTRATO_AÑO', () => {
    assert.equal(ExportExcel.nombreArchivo(COMPLETO), 'PRUEBA_EJEMPLO_ANA_MARÍA_1234_2026');
    assert.equal(ExportExcel.nombreArchivo({ primerApellido: 'de la peña', primerNombre: 'josé', numeroContrato: 'CO/12:3', anioContrato: '2026' }), 'DE_LA_PEÑA_JOSÉ_CO123_2026');
    assert.equal(ExportExcel.nombreArchivo({}), 'FORMULARIO_13-IF-016');
  });
});

// ───────────────────────── 2. Integración con la plantilla ─────────────────────────

describe('xlsx generado', () => {
  const archivos = {};
  before(async () => {
    archivos.completo = await generarA('export-completo.xlsx', COMPLETO);
    archivos.vacio = await generarA('export-vacio.xlsx', {});
    archivos.cuentaCero = await generarA('export-cuenta-cero.xlsx', CUENTA_CERO);
    archivos.variante = await generarA('export-variante.xlsx', VARIANTE);
    archivos.parcial = await generarA('export-parcial.xlsx', PARCIAL);
  });

  test('generar() devuelve un Blob xlsx', async () => {
    const blob = await ExportExcel.generar(COMPLETO, { plantilla: PLANTILLA });
    assert.equal(blob.type, ExportExcel.MIME);
    assert.ok(blob.size > 100000);
  });

  test('plantilla desde window.PLANTILLA_XLSX_B64', async () => {
    globalThis.PLANTILLA_XLSX_B64 = PLANTILLA.toString('base64');
    try {
      const bytes = await ExportExcel.generarBytes(COMPLETO);
      const zip = await JSZip.loadAsync(bytes);
      assert.ok(zip.file('xl/workbook.xml'));
    } finally { delete globalThis.PLANTILLA_XLSX_B64; }
  });

  test('solo cambian las celdas mapeadas y calcPr; el resto del paquete es idéntico', async () => {
    const orig = await JSZip.loadAsync(PLANTILLA);
    const nuevo = await JSZip.loadAsync(fs.readFileSync(archivos.completo));
    assert.deepEqual(Object.keys(nuevo.files), Object.keys(orig.files), 'mismas partes y en el mismo orden');
    const mapeadas = { 'xl/worksheets/sheet1.xml': 'datos', 'xl/worksheets/sheet3.xml': 'deducciones' };
    const objetivo = ExportExcel.escrituras(COMPLETO).celdas;
    for (const nombre of Object.keys(orig.files)) {
      if (orig.files[nombre].dir) continue;
      const a = await orig.file(nombre).async('uint8array');
      const b = await nuevo.file(nombre).async('uint8array');
      if (nombre === 'xl/workbook.xml') {
        const ta = Buffer.from(a).toString('utf8');
        const tb = Buffer.from(b).toString('utf8');
        assert.equal(tb, ta.replace('<calcPr calcId="191029"/>', '<calcPr fullCalcOnLoad="1" calcId="191029"/>'));
      } else if (mapeadas[nombre]) {
        const ta = Buffer.from(a).toString('utf8');
        const tb = Buffer.from(b).toString('utf8');
        const refs = new Set(objetivo.filter((c) => c.hoja === mapeadas[nombre]).map((c) => c.celda));
        // Fuera de <sheetData> todo es idéntico.
        const fuera = (t) => t.replace(/<sheetData>[\s\S]*<\/sheetData>/, '');
        assert.equal(fuera(tb), fuera(ta), nombre + ' fuera de sheetData');
        const ca = celdasDelXml(ta), cb = celdasDelXml(tb);
        assert.deepEqual([...cb.keys()].sort(), [...ca.keys()].sort(), nombre + ' mismas celdas');
        const formula = (t) => (/<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/.exec(t) || [''])[0];
        const etiquetaSinTipo = (t) => /^<c\b[^>]*>/.exec(t)[0].replace(/\s+t="[^"]*"/, '');
        for (const [ref, x] of ca) {
          if (refs.has(ref)) {
            const s = /\bs="(\d+)"/.exec(x);
            assert.equal(/\bs="(\d+)"/.exec(cb.get(ref))?.[1], s?.[1], `${nombre} ${ref} conserva el estilo`);
          } else if (formula(x)) {
            // Fórmulas: misma fórmula y atributos; solo cambia el resultado guardado (ver la prueba siguiente).
            assert.equal(formula(cb.get(ref)), formula(x), `${nombre} ${ref} conserva la fórmula`);
            assert.equal(etiquetaSinTipo(cb.get(ref)), etiquetaSinTipo(x), `${nombre} ${ref} conserva los atributos`);
          } else {
            assert.equal(cb.get(ref), x, `${nombre} ${ref} sin cambios`);
          }
        }
        // Las filas conservan sus atributos.
        const filas = (t) => t.match(/<row\b[^>]*>/g);
        assert.deepEqual(filas(tb), filas(ta), nombre + ' filas');
      } else {
        assert.ok(Buffer.from(a).equals(Buffer.from(b)), nombre + ' idéntico');
      }
    }
  });

  test('cada fórmula de las hojas visibles guarda el resultado de Calc (lo que muestra la Vista protegida)', async (t) => {
    if (!Calc || typeof Calc.derivados !== 'function') return t.skip('calc.js no disponible');
    const { valorEnCache } = ExportExcel._interno;
    for (const [caso, estado] of Object.entries({ completo: COMPLETO, vacio: {}, parcial: PARCIAL, variante: VARIANTE })) {
      const zip = await JSZip.loadAsync(fs.readFileSync(archivos[caso]));
      const D = Calc.derivados(estado);
      let revisadas = 0;
      for (const [hoja, archivo] of [['datos', 'xl/worksheets/sheet1.xml'], ['deducciones', 'xl/worksheets/sheet3.xml']]) {
        const celdas = celdasDelXml(await zip.file(archivo).async('string'));
        for (const [ref, x] of celdas) {
          if (!/<f[\s>/]/.test(x)) continue;
          const esperado = valorEnCache(D.celdas[hoja + '!' + ref]);
          assert.ok(esperado, `${caso} ${hoja}!${ref}: Calc no tiene su valor`);
          const v = /<v>([\s\S]*?)<\/v>/.exec(x);
          assert.equal(v && v[1], esperado.v, `${caso} ${hoja}!${ref} resultado guardado`);
          assert.equal(/\bt="([^"]*)"/.exec(/^<c\b[^>]*>/.exec(x)[0])?.[1] || '', esperado.t, `${caso} ${hoja}!${ref} tipo`);
          revisadas++;
        }
      }
      assert.equal(revisadas, 41 + 19, caso + ': todas las fórmulas de las dos hojas visibles');
    }
    const datos = celdasDelXml(await (await JSZip.loadAsync(fs.readFileSync(archivos.completo))).file('xl/worksheets/sheet1.xml').async('string'));
    assert.match(datos.get('C95'), /<v>Información completa, en constancia se suscribe el presente formulario el dia /);
    assert.match(datos.get('AI16'), /<v>PRUEBA EJEMPLO ANA MARÍA<\/v>/);
    assert.match(datos.get('AW52'), /<v>48000000<\/v>/);
  });

  test('Excel en Vista protegida (sin recalcular) muestra los valores del formulario', { skip: process.platform !== 'win32' && 'solo en Windows con Excel', timeout: 300000 }, (t) => {
    if (process.env.SIN_EXCEL) return t.skip('SIN_EXCEL');
    if (!Calc || typeof Calc.derivados !== 'function') return t.skip('calc.js no disponible');
    const salida = path.join(TMP, 'vista-protegida.json');
    try { fs.unlinkSync(salida); } catch (e) { /* no existía */ }
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(RAIZ, 'tests', 'vista-protegida.ps1'),
      '-Archivo', archivos.completo, '-Salida', salida], { encoding: 'utf8', timeout: 280000 });
    if (r.error) throw r.error;
    if (r.status === 3) return t.skip('Excel no está instalado');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const x = JSON.parse(fs.readFileSync(salida, 'utf8').replace(/^﻿/, ''));
    assert.ok(x.ok, 'Excel abrió el archivo en Vista protegida: ' + x.error);
    const D = Calc.derivados(COMPLETO);
    const d = x.datos, ded = x.deducciones;
    assert.equal(d.AI16.v, 'PRUEBA EJEMPLO ANA MARÍA');
    assert.equal(d.AH31.v, `${NIT}-${COMPLETO.dv}`);
    assert.equal(d.AW52.v, 48000000);
    assert.equal(d.W46.v, 240);
    assert.equal(d.C73.v, D.codificacion);
    assert.equal(d.C95.v, D.mensajeFormulario);
    assert.equal(d.F103.v, 'CONTRATO No 1234 DE 2026');
    assert.equal(ded.J11.v, 'PRUEBA EJEMPLO ANA MARÍA');
    assert.equal(ded.S13.v, 1234);
    assert.equal(ded.M28.v, 600000);
    for (const [ref, c] of Object.entries(d)) assert.equal(c.v, D.celdas['datos!' + ref], 'datos!' + ref);
    for (const [ref, c] of Object.entries(ded)) assert.equal(c.v, D.celdas['deducciones!' + ref], 'deducciones!' + ref);
  });

  test('openpyxl lee cada celda mapeada con el valor y tipo esperados', { skip: !hayPython && 'Python/openpyxl no disponible' }, () => {
    for (const [caso, estado] of Object.entries(CASOS)) {
      const esp = esperadas(estado);
      const leido = leerConOpenpyxl(archivos[caso], Object.keys(esp));
      for (const [clave, e] of Object.entries(esp)) {
        const l = leido[clave];
        assert.equal(l.oculta, false, `${clave} no puede quedar oculta dentro de un rango combinado`);
        assert.equal(l.tipo, e.tipo, `${caso} ${clave} tipo (leído ${JSON.stringify(l)})`);
        assert.equal(l.valor, e.valor, `${caso} ${clave} valor`);
      }
    }
  });

  // ── Excel real (COM) ──
  const CASOS = { completo: COMPLETO, vacio: {}, cuentaCero: CUENTA_CERO, variante: VARIANTE, parcial: PARCIAL };
  let excel = null;
  const sinExcel = process.platform !== 'win32' && 'solo en Windows con Excel';

  function correrExcel() {
    if (excel) return excel;
    const salida = path.join(TMP, 'verificacion-excel.json');
    try { fs.unlinkSync(salida); } catch (e) { /* no existía */ }
    const lista = [path.join(RAIZ, ARCHIVO_PLANTILLA), ...Object.keys(CASOS).map((k) => archivos[k])];
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(RAIZ, 'tests', 'verificar-export.ps1'),
      '-Archivos', lista.join('|'), '-Salida', salida, '-CopiaDir', TMP], { encoding: 'utf8', timeout: 600000 });
    if (r.error) throw r.error;
    if (r.status === 3) { excel = { sinExcel: true }; return excel; }
    if (r.status !== 0) throw new Error('verificar-export.ps1 falló: ' + r.stdout + r.stderr);
    const json = JSON.parse(fs.readFileSync(salida, 'utf8').replace(/^﻿/, ''));
    excel = { plantilla: json.resultados[0] };
    Object.keys(CASOS).forEach((k, i) => { excel[k] = json.resultados[i + 1]; });
    return excel;
  }

  test('Excel abre los archivos sin repararlos y conserva la estructura', { skip: sinExcel, timeout: 600000 }, (t) => {
    const x = correrExcel();
    if (x.sinExcel) return t.skip('Excel no está instalado');
    assert.ok(x.plantilla.ok, 'la plantilla abre: ' + x.plantilla.error);
    for (const caso of Object.keys(CASOS)) {
      const r = x[caso];
      assert.ok(r.ok, `${caso}: Excel no pudo abrirlo: ${r.error}`);
      assert.equal(r.reparado, false, `${caso}: Excel reparó el archivo (${r.registrosReparacion})`);
      assert.deepEqual(r.estructura, x.plantilla.estructura, `${caso}: estructura igual a la plantilla`);
      assert.ok(r.copia && fs.existsSync(r.copia), `${caso}: Excel pudo guardar una copia`);
    }
    const m = x.plantilla.estructura.muestras;
    assert.equal(m['D!V50'].validacion, 3, 'la sonda de validaciones funciona (lista SI/NO en V50)');
    assert.equal(m['D!F46'].validacion, 1, 'año del contrato: número entero');
    assert.equal(m['D!A11'].bloqueada, false, 'las celdas de entrada siguen desbloqueadas');
    assert.equal(x.completo.estructura.hojas.length, 5);
    assert.equal(x.completo.estructura.hojas[4].visible, 0, 'Validador- Datos sigue oculta');
  });

  test('Excel calcula los campos derivados del estado completo', { skip: sinExcel, timeout: 600000 }, (t) => {
    const x = correrExcel();
    if (x.sinExcel) return t.skip('Excel no está instalado');
    const d = x.completo.datos, r = x.completo.deducciones;
    const v = (c) => c.valor;
    const ciiu = CATALOGOS.ciiu.find((c) => c.codigo === COMPLETO.actividadRut);
    const rit = CATALOGOS.rit.find((c) => String(c.codigo) === COMPLETO.actividadRit);
    const nombre = 'PRUEBA EJEMPLO ANA MARÍA';
    assert.equal(v(d.AI16), nombre);
    assert.equal(v(d.AH31), `${NIT}-${COMPLETO.dv}`);
    assert.equal(v(d.A40), '6201');
    assert.equal(v(d.F39), ciiu.descripcion);
    assert.equal(v(d.X40), 6201);
    assert.equal(v(d.AD39), rit.descripcion);
    assert.equal(v(d.AQ40), rit.tarifa);
    assert.equal(v(d.BC39), 'RS');
    assert.equal(v(d.W46), 240);
    assert.equal(v(d.AW52), 48000000);
    assert.equal(v(d.AW53), 0);
    assert.equal(v(d.AN11), 13);
    assert.equal(v(d.AN13), 'CC');
    assert.equal(String(v(d.P21)), '169');
    assert.equal(String(v(d.AI21)), '11');
    assert.equal(String(v(d.BB21)), '001');
    assert.equal(String(v(d.M31)), '7');
    assert.equal(String(v(d.AE31)), '2');
    assert.equal(v(d.AN32), COMPLETO.numeroCuenta);
    assert.equal(v(d.H53), 1100);
    assert.equal(v(d.C73), 'NTNS', 'codificación tributaria');
    assert.match(v(d.C95), /^Información completa, en constancia se suscribe el presente formulario el dia /);
    assert.equal(v(d.C91), `Yo ${nombre} ${CATALOGOS.juramento}`);
    assert.equal(v(d.E101), nombre);
    assert.equal(v(d.G102), 'Cédula de ciudadanía ' + NIT);
    assert.equal(v(d.F103), 'CONTRATO No 1234 DE 2026');
    assert.equal(v(d.A24), COMPLETO.email);
    assert.equal(v(d.AC46), serial('2026-02-01'));
    assert.equal(d.AC46.texto, '2026-02-01');
    // FORMATO DEDUCCIONES
    assert.equal(v(r.J11), nombre);
    assert.equal(v(r.G13), Number(NIT));
    assert.equal(v(r.S13), 1234);
    assert.equal(v(r.M28), 600000, '10 % del pago mensual (tope 32 UVT)');
    assert.equal(normal(v(r.B31)), normal(MOTIVO.anexo));
    assert.equal(v(r.W39), 400000, 'salud: 4.800.000 / 12 (tope 16 UVT)');
    assert.equal(v(r.W50), 750000, 'intereses: 18.000.000 / 12 / 2 titulares');
    assert.equal(v(r.B42), `CERTIFICADO EXPEDIDO POR ${COMPLETO.saludEntidad} A NOMBRE DE ${nombre} TITULAR DEL CONTRATO `);
    assert.equal(v(r.B57), `CERTIFICADO EXPEDIDO POR ${COMPLETO.hipEntidad} A NOMBRE DE ${nombre} TITULAR DEL CREDITO `);
    assert.ok([CONFIG.anioGravable, CONFIG.anioGravable - 1, CONFIG.anioGravable + 1].includes(v(r.W16)));
    assert.equal(v(d.AN76), v(r.W16));
    assert.equal(v(d.AY79), v(r.W16) + 2);
  });

  test('Excel: estado vacío borra el correo de ejemplo y queda "sin diligenciar"', { skip: sinExcel, timeout: 600000 }, (t) => {
    const x = correrExcel();
    if (x.sinExcel) return t.skip('Excel no está instalado');
    assert.equal(x.plantilla.datos.A24.valor, 'cacsa@cascsa.com', 'la plantilla trae el correo de ejemplo');
    const d = x.vacio.datos;
    assert.equal(d.A24.valor, null);
    assert.equal(d.C95.valor, 'Formulario sin diligenciar');
    assert.equal(d.F103.valor, '');
    assert.equal(normal(d.AI16.valor), '');
  });

  test('Excel: cuenta con ceros a la izquierda', { skip: sinExcel, timeout: 600000 }, (t) => {
    const x = correrExcel();
    if (x.sinExcel) return t.skip('Excel no está instalado');
    const d = x.cuentaCero.datos;
    assert.equal(d.AN32.valor, '0012345678');
    assert.equal(d.AG26.valor, '0');
  });

  test('Excel: variante (pensionado, responsable de IVA, SIMPLE, RIT de 3 dígitos)', { skip: sinExcel, timeout: 600000 }, (t) => {
    const x = correrExcel();
    if (x.sinExcel) return t.skip('Excel no está instalado');
    const d = x.variante.datos;
    const rit = CATALOGOS.rit.find((c) => c.codigo === 111);
    assert.equal(d.AI16.valor, 'PRUEBA DE LA PEÑA ANA ');
    assert.equal(d.X40.valor, 111);
    assert.equal(d.AD39.valor, rit.descripcion);
    assert.equal(d.BC39.valor, 'RC');
    assert.equal(d.W46.valor, 300);
    assert.equal(d.AW52.valor, Math.round(250000000 / 1.19));
    assert.equal(d.AW53.valor, Math.round(Math.round(250000000 / 1.19) * 0.19));
    assert.equal(d.C73.valor, 'NSYM /PENSIONADO');
    assert.equal(x.variante.deducciones.B42.valor, '');
    assert.equal(x.variante.deducciones.M28.valor, 2500000 > 32 * CONFIG.uvt ? 32 * CONFIG.uvt : 2500000, 'tope de dependientes (aunque no se use)');
    assert.match(x.parcial.datos.C95.valor, /^Por favor verifique la información de : /);
  });

  test('paridad con Calc.derivados (si calc.js existe)', { skip: sinExcel, timeout: 600000 }, (t) => {
    if (!Calc || typeof Calc.derivados !== 'function') return t.skip('calc.js aún no está disponible');
    const x = correrExcel();
    if (x.sinExcel) return t.skip('Excel no está instalado');
    const comparar = (estado, res) => {
      const D = Calc.derivados(estado);
      const d = res.datos, r = res.deducciones;
      const pares = [
        ['nombreCompleto', d.AI16, 'texto'], ['identificacionTitular', d.AH31, 'texto'],
        ['descCiiu', d.F39, 'texto'], ['descRit', d.AD39, 'texto'], ['tarifaRit', d.AQ40, 'numero'],
        ['siglaRegimen', d.BC39, 'texto'], ['duracionDias', d.W46, 'numero'],
        ['valorSinIva', d.AW52, 'numero'], ['valorIva', d.AW53, 'numero'],
        ['codificacion', d.C73, 'texto'], ['firmaNombre', d.E101, 'texto'], ['firmaDocumento', d.G102, 'texto'],
        ['firmaContrato', d.F103, 'texto'], ['textoCertificacion', d.C91, 'texto'],
        ['depValorMensual', r.M28, 'numero'], ['depAnexos', r.B31, 'texto'], ['saludValorMensual', r.W39, 'numero'],
        ['hipValorMensual', r.W50, 'numero'], ['saludTextoCertificado', r.B42, 'texto'], ['hipTextoCertificado', r.B57, 'texto'],
        ['anioCertificados', r.W16, 'numero'],
      ];
      const difs = [];
      for (const [k, celda, tipo] of pares) {
        if (!(k in D)) { difs.push(`${k}: no existe en Calc.derivados`); continue; }
        const excelV = celda.valor;
        const calcV = D[k];
        const iguales = tipo === 'numero'
          ? (excelV === null || excelV === '' || excelV === ' ' ? (calcV === '' || calcV == null || Number.isNaN(Number(calcV)) || calcV === ' ') : Math.abs(Number(calcV) - Number(excelV)) < 1e-6)
          : normal(calcV) === normal(excelV);
        if (!iguales) difs.push(`${k}: Excel=${JSON.stringify(excelV)} Calc=${JSON.stringify(calcV)}`);
      }
      // Mensaje (C95): con "Información completa…" la fecha depende del formato regional de Excel; se compara el inicio.
      if ('mensajeFormulario' in D) {
        const corte = /^Información completa/.test(normal(d.C95.valor)) ? 60 : Infinity;
        const a = normal(d.C95.valor).slice(0, corte), b = normal(D.mensajeFormulario).slice(0, corte);
        if (a !== b) difs.push(`mensajeFormulario: Excel=${JSON.stringify(d.C95.valor)} Calc=${JSON.stringify(D.mensajeFormulario)}`);
      }
      return difs;
    };
    const difs = Object.entries(CASOS).flatMap(([k, estado]) => comparar(estado, x[k]).map((d) => k + ' ' + d));
    assert.deepEqual(difs, []);
  });
});

// ───────────────────────── 3. Impresión (HTML del documento) ─────────────────────────

describe('print.js (documento imprimible)', () => {
  const Imprimir = require(path.join(RAIZ, 'src/js/print.js'));
  const D = Calc && typeof Calc.derivados === 'function' ? Calc.derivados(COMPLETO) : {};
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  test('incluye los datos, marcas y la hoja de deducciones solo si se pidió', () => {
    const h = Imprimir.html(COMPLETO, D);
    assert.equal((h.match(/class="imp-hoja /g) || []).length, 2, 'dos hojas con deducciones');
    for (const t of ['PRUEBA EJEMPLO ANA MARÍA', '1023456789', 'Bancolombia SA', 'CHAPINERO', '$ 48.000.000', '2026-02-01',
      'FORMATO SED - CON ANEXOS', 'BANCO HIPOTECARIO DE PRUEBA', 'MEDICINA PREPAGADA DE PRUEBA', 'TOMÁS PRUEBA EJEMPLO',
      'FORMULARIO DISMINUCIÓN DE LA BASE DE RETENCIÓN EN LA FUENTE PERSONAS NATURALES OPS', '13-IF-016', 'CONTRATO No 1234 DE 2026']) {
      assert.ok(h.includes(t), 'falta ' + t);
    }
    assert.ok(Imprimir.necesitaHojaDeducciones(COMPLETO));
    const sin = { ...COMPLETO, dedDependientes: '', dedHipotecario: 'NO', dedSaludNoPos: '' };
    assert.equal(Imprimir.necesitaHojaDeducciones(sin), false);
    assert.equal((Imprimir.html(sin, D).match(/class="imp-hoja /g) || []).length, 1, 'una hoja sin deducciones');
  });

  test('usa el texto literal del Excel en C1–C4 y los rótulos oficiales', () => {
    const h = Imprimir.html(COMPLETO, D);
    const P = SCHEMA.preguntasFormato(CONFIG);
    assert.equal(P.c1, `1. ¿Mis ingresos del año gravable ${CONFIG.anioGravable} fueron superiores a $ 73´323.600  equivalentes a 1.400 UVT?`);
    for (const k of ['c1', 'c2', 'c3', 'c4']) assert.ok(h.includes(esc(P[k])), 'texto oficial de ' + k);
    assert.ok(h.includes('<strong>SI LA DIAN NO ME HA CATALOGADO COMO SIMPLE COLOCO LA &quot;X&quot; EN NO</strong>'));
    assert.ok(h.includes('de acuerdo al  Decreto 2231 de 2023'));
    assert.ok(!h.includes('1. 1.'), 'sin numeración repetida');
    assert.ok(h.includes('Cantidad de titulares del crédito'));
    assert.ok(h.includes('Fecha CRP 1 aaaa/mm/dd'));
  });

  test('muestra los códigos de homologación del Excel junto a cada valor', () => {
    const h = Imprimir.html(COMPLETO, D);
    const cod = (c) => h.includes(`<span class="imp-cod">${c}</span>`);
    for (const k of ['codTipoDocDian', 'codPais', 'codDepto', 'codMunicipio', 'codBanco', 'codTipoCuenta', 'siglaRegimen', 'codigoArea']) {
      assert.ok(String(D[k]) !== '' && cod(D[k]), `código ${k} (${D[k]})`);
    }
    assert.ok(cod('2'), 'tipo de contribuyente persona natural = 2');
    // Sin valor no hay código (p. ej. banco vacío).
    const v = Imprimir.html({ ...COMPLETO, banco: '' }, Calc.derivados({ ...COMPLETO, banco: '' }));
    assert.ok(!/Banco<\/span><span class="imp-valor"><span class="imp-cod">/.test(v));
  });

  test('resalta faltantes y codificación a revisar; hoja 2 con fechas dd/mm/aaaa y el documento de la firma', () => {
    const completo = Imprimir.html(COMPLETO, D);
    assert.ok(!completo.includes('imp-alerta'), 'formulario completo sin alertas');
    const parcial = Imprimir.html(PARCIAL, Calc.derivados(PARCIAL));
    assert.match(parcial, /class="imp-mensaje imp-alerta">Por favor verifique/);
    assert.match(parcial, /class="imp-codificacion imp-alerta">/);
    const hoja2 = completo.slice(completo.indexOf('imp-hoja-deducciones'));
    assert.ok(hoja2.includes('31/12/2025'), 'fecha de corte dd/mm/aaaa');
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(hoja2), 'sin fechas ISO en la hoja 2');
    assert.ok(hoja2.includes('Cédula de ciudadanía ' + NIT) && !hoja2.includes('C.C. '));
  });

  test('escapa el HTML de los valores y funciona sin Calc', () => {
    const h = Imprimir.html({ primerApellido: '<b>X</b>', direccion: 'A & B' }, {});
    assert.ok(h.includes('&lt;b&gt;X&lt;/b&gt;'));
    assert.ok(h.includes('A &amp; B'));
    assert.ok(!h.includes('<b>X</b>'));
  });
});

// ───────────────────────── 4. Build ─────────────────────────

const NAVEGADORES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const NAVEGADOR = NAVEGADORES.find((p) => fs.existsSync(p)) || null;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Abre `url` en un navegador sin interfaz (Chrome DevTools Protocol), evalúa `expresion` (puede ser
// una promesa) y devuelve el valor, los errores de consola/excepciones y las peticiones de red.
// `extra(evaluar, enviar)` permite pasos adicionales (p. ej. imprimir a PDF); su resultado va en `extra`.
async function enNavegador(url, expresion, extra) {
  borrarPerfilesViejos();
  const perfil = fs.mkdtempSync(path.join(TMP, 'perfil-'));
  const puerto = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(NAVEGADOR, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${puerto}`, `--user-data-dir=${perfil}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let pagina = null;
    for (let i = 0; i < 150 && !pagina; i++) {
      try {
        const lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
        pagina = lista.find((t) => t.type === 'page') || null;
      } catch (e) { /* aún no arranca */ }
      if (!pagina) await esperar(100);
    }
    if (!pagina) throw new Error('El navegador no abrió el puerto de depuración.');
    ws = new WebSocket(pagina.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pendientes = new Map();
    const eventos = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pendientes.has(msg.id)) { pendientes.get(msg.id)(msg); pendientes.delete(msg.id); } else eventos.push(msg);
    };
    const enviar = (method, params = {}) => new Promise((res) => { const i = ++id; pendientes.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await enviar('Runtime.enable');
    await enviar('Log.enable');
    await enviar('Network.enable');
    await enviar('Page.enable');
    await enviar('Page.navigate', { url });
    for (let i = 0; i < 300 && !eventos.some((e) => e.method === 'Page.loadEventFired'); i++) await esperar(100);
    await esperar(300);
    const evaluar = async (expr) => {
      const x = await enviar('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 });
      if (x.result && x.result.exceptionDetails) throw new Error('Excepción en la página: ' + JSON.stringify(x.result.exceptionDetails).slice(0, 600));
      return x.result && x.result.result && x.result.result.value;
    };
    const r = await enviar('Runtime.evaluate', { expression: expresion, awaitPromise: true, returnByValue: true, timeout: 60000 });
    const resultadoExtra = extra ? await extra(evaluar, enviar) : undefined;
    const errores = eventos.filter((e) => e.method === 'Runtime.exceptionThrown'
      || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
      .map((e) => JSON.stringify(e.params).slice(0, 400));
    const red = eventos.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url)
      .filter((u) => !/^(file|data|blob|about|chrome|devtools):/i.test(u));
    return { valor: r.result && r.result.result && r.result.result.value, excepcion: r.result && r.result.exceptionDetails, errores, red, extra: resultadoExtra };
  } finally {
    try { if (ws) ws.close(); } catch (e) { /* nada */ }
    await cerrarNavegador(puerto, proc, perfil);
  }
}

// En Windows el msedge.exe lanzado solo arranca el navegador y termina: kill() no lo cierra y quedaban
// navegadores sin interfaz vivos, con su perfil bloqueado. Se cierra por DevTools (Browser.close) y, si
// aún queda alguno, se terminan los procesos que usan ese perfil. Edge copia la cuenta del sistema
// (correo, teléfono) en cada perfil nuevo: el perfil siempre se borra.
async function cerrarNavegador(puerto, proc, perfil) {
  try {
    const version = await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(rej, 3000); });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await esperar(500);
    try { ws.close(); } catch (e) { /* nada */ }
  } catch (e) { /* ya cerrado */ }
  try { proc.kill(); } catch (e) { /* nada */ }
  const borrar = () => { try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch (e) { /* bloqueado */ } };
  borrar();
  if (fs.existsSync(perfil) && process.platform === 'win32') {
    const ruta = path.basename(perfil).replace(/'/g, "''");
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${ruta}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { stdio: 'ignore', timeout: 30000 });
    await esperar(500);
    borrar();
  }
}

// Perfiles que quedaron de corridas interrumpidas (más de 30 minutos): se borran por la misma razón.
function borrarPerfilesViejos() {
  if (!fs.existsSync(TMP)) return;
  const limite = Date.now() - 30 * 60 * 1000;
  for (const n of fs.readdirSync(TMP)) {
    if (!/^perfil-/.test(n)) continue;
    const p = path.join(TMP, n);
    try { if (fs.statSync(p).mtimeMs < limite) fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch (e) { /* en uso */ }
  }
}

// Expresión que se evalúa dentro del HTML construido.
const PRUEBA_EN_PAGINA = String.raw`(async () => {
  const r = {};
  for (const k of ['ExportExcel', 'Imprimir', 'Calc', 'PdfText', 'RutParser', 'RitParser', 'JSZip', 'pdfjsLib', 'SCHEMA', 'CATALOGOS', 'CONFIG'])
    r[k] = typeof window[k];
  r.plantilla = (window.PLANTILLA_XLSX_B64 || '').length;
  r.logo = (window.LOGO_SRC || '').slice(0, 22);
  r.worker = (window.PDFJS_WORKER_SRC || '').slice(0, 5);
  r.workerScriptPresente = !!document.getElementById('pdfjs-worker-src');
  const blob = await ExportExcel.generar({ primerApellido: 'PRUEBA', primerNombre: 'ANA', nit: '123456' });
  r.xlsx = blob.size;
  r.xlsxTipo = blob.type;
  // PDF mínimo con texto, leído con pdf.js usando el worker embebido (Blob URL).
  const partes = ['%PDF-1.4\n'];
  const offs = [];
  const obj = (n, cuerpo) => { offs[n] = partes.join('').length; partes.push(n + ' 0 obj\n' + cuerpo + '\nendobj\n'); };
  const contenido = 'BT /F1 18 Tf 72 700 Td (Hola RUT 13-IF-016) Tj 0 -24 Td (Formulario de prueba con texto suficiente) Tj ET';
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  obj(4, '<< /Length ' + contenido.length + ' >>\nstream\n' + contenido + '\nendstream');
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const xref = partes.join('').length;
  let t = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) t += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  partes.push(t + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  const bytes = new TextEncoder().encode(partes.join(''));
  pdfjsLib.GlobalWorkerOptions.workerSrc = window.PDFJS_WORKER_SRC;
  const tarea = pdfjsLib.getDocument({ data: bytes.slice() });
  const pdf = await tarea.promise;
  const tc = await (await pdf.getPage(1)).getTextContent();
  r.textoPdf = tc.items.map((i) => i.str).join('');
  r.workerReal = !!(tarea._worker && (tarea._worker._webWorker || tarea._worker._port instanceof Worker));
  await pdf.destroy();
  if (window.PdfText && typeof PdfText.leer === 'function') {
    try { const d = await PdfText.leer(bytes.slice()); r.pdfText = d.texto; } catch (e) { r.pdfText = 'ERROR ' + e.message; }
  }
  const el = Imprimir.render({ primerApellido: 'PRUEBA', primerNombre: 'ANA', dedSaludNoPos: 'SI' });
  r.hojas = el.querySelectorAll('.imp-hoja').length;
  r.impresionOculta = getComputedStyle(el).display === 'none';
  r.logoCargado = await new Promise((res) => {
    const img = el.querySelector('.imp-logo img');
    if (img.complete) res(img.naturalWidth > 0); else { img.onload = () => res(true); img.onerror = () => res(false); }
  });
  return r;
})()`;

// Recorre en la app construida (datos ficticios): el RUT llena el formulario de inmediato (sin lista de
// revisión), lo escrito a mano no se reemplaza ("Tu RUT dice: X · Usar este"), los campos no llevan la
// etiqueta RUT/RIT, SECOP llena el contrato (uno) o deja elegir (varios), el guardado dentro del HTML y la
// Revisión con el diálogo de faltantes.
const PRUEBA_DOCUMENTOS = String.raw`(async () => {
  const espera = (ms) => new Promise((res) => setTimeout(res, ms));
  const r = {};
  App.reiniciar();
  App.irA('documentos');
  App.establecer({ departamento: 'Antioquia', municipio: 'MEDELLÍN' }, 'usuario');
  const nit = '52345678';
  const c = (valor) => ({ valor, confianza: 'alta', origen: 'Casilla 5' });
  App.recibirResultado('RUT', { ok: true, extra: {},
    avisos: ['Tu RUT no registra teléfono fijo; dejamos 0 en Teléfono 1 como indica el formato. Cámbialo si tienes uno.',
      'Tu RUT fue generado hace más de un año. Verifica que esté actualizado.'],
    campos: { nit: c(nit), dv: c(String(Calc.dvNit(nit))), numeroId: c(nit), primerApellido: c('PRUEBA'), segundoApellido: c('FICTICIA'),
      primerNombre: c('ANA'), otrosNombres: c('MARÍA'), departamento: c('Bogotá D.C'), municipio: c('BOGOTÁ'),
      telefono1: { valor: '0', confianza: 'media', origen: 'Casilla 44/45 (sin teléfono fijo)', etiqueta: '0 — tu RUT no registra teléfono fijo' },
      email: { valor: 'dudoso@ejemplo.co', confianza: 'baja', origen: 'Casilla 42' } } }, 'rut.pdf');
  await espera(50);
  const e1 = App.obtenerEstado();
  r.aplicado = { nit: e1.s.nit === nit, numeroId: e1.s.numeroId === nit, apellido: e1.s.primerApellido, tel1: e1.s.telefono1,
    depto: e1.s.departamento, mun: e1.s.municipio, email: e1.s.email, conflictos: Object.keys(e1.meta.conflictos).sort() };
  r.documentos = { lista: document.querySelectorAll('#hallazgos, .hallazgo, #paso input[type=checkbox]').length,
    zona: document.querySelector('.zona[data-tipo="RUT"]').dataset.estado,
    estadoZona: document.querySelector('.zona[data-tipo="RUT"] .zona-estado').textContent,
    notas: [...document.querySelectorAll('.zona-envoltura .notas-doc li')].map((li) => li.textContent),
    boton: document.getElementById('btn-siguiente').textContent,
    botonesPrimarios: document.querySelectorAll('#paso .boton--primario').length,
    deshacer: /Deshacer/.test(document.getElementById('paso').textContent),
    borrador: /\.json|borrador/i.test(document.getElementById('app').innerText) };
  App.irA('personales');
  await espera(50);
  r.pills = document.querySelectorAll('#paso .etiqueta .pill').length;
  App.irA('contacto');
  await espera(50);
  const conf = (id) => { const el = document.querySelector('[data-campo="' + id + '"] > .conflicto'); return el && !el.hidden ? el.textContent : ''; };
  r.contacto = { depto: conf('departamento'), email: conf('email'),
    tel1: (document.querySelector('[data-campo="telefono1"] > .sugerencia:not(.conflicto)') || {}).textContent || '' };
  document.querySelector('[data-campo="departamento"] > .conflicto .enlace--fuerte').click();
  await espera(50);
  document.querySelector('[data-campo="municipio"] > .conflicto .enlace--fuerte').click();
  await espera(50);
  document.querySelector('[data-campo="email"] > .conflicto .enlace--discreto').click();
  await espera(50);
  const e2 = App.obtenerEstado();
  r.trasUsar = { depto: e2.s.departamento, mun: e2.s.municipio, email: e2.s.email, conflictos: Object.keys(e2.meta.conflictos).length };

  // SECOP II: un contrato vigente llena el paso; con varios, la persona elige.
  const k = (ref, firma, valor, dur, extra) => Secop.normalizar(Object.assign({ referencia_del_contrato: ref, estado_contrato: 'En ejecución',
    fecha_de_firma: firma + 'T00:00:00.000', fecha_de_inicio_del_contrato: '2026-02-02T00:00:00.000', fecha_de_fin_del_contrato: '2026-12-31T00:00:00.000',
    valor_del_contrato: String(valor), duraci_n_del_contrato: dur, objeto_del_contrato: 'PRESTAR SERVICIOS PROFESIONALES EN LA OFICINA DE TESORERÍA Y CONTABILIDAD',
    nombre_supervisor: 'No definido' }, extra || {}));
  App.establecer({ valorMensual: '1234' }, 'usuario');
  App.usarContratosSecop([k('CO1.PCCNTR.1', '2026-01-20', 48000000, '8 Mes(es)')], true);
  App.irA('contrato');
  await espera(50);
  const e3 = App.obtenerEstado();
  r.secopUno = { anio: e3.s.anioContrato, total: e3.s.valorTotal, inicio: e3.s.fechaInicio, fin: e3.s.fechaTerminacion, cesion: e3.s.cesion,
    mensual: e3.s.valorMensual, conflictoMensual: (e3.meta.conflictos.valorMensual || {}).valor, area: e3.s.areaFuncional,
    panel: /CO1\.PCCNTR\.1/.test(document.getElementById('secop').textContent), select: !!document.getElementById('secop-contrato'),
    notaNumero: /CO1\.PCCNTR\.1/.test((document.querySelector('[data-campo="numeroContrato"] > .sugerencia:not(.conflicto)') || {}).textContent || '') };
  App.usarContratosSecop([k('CO1.PCCNTR.2', '2026-03-01', 30000000, '150 Dia(s)', { estado_contrato: 'cedido' }), k('CO1.PCCNTR.1', '2026-01-20', 48000000, '8 Mes(es)')], true);
  await espera(50);
  const sel = document.getElementById('secop-contrato');
  r.secopVarios = { opciones: sel ? sel.options.length : 0, elegido: sel ? sel.value : null };
  sel.value = 'CO1.PCCNTR.2';
  sel.dispatchEvent(new Event('change'));
  await espera(50);
  const e4 = App.obtenerEstado();
  r.secopElegido = { total: e4.s.valorTotal, mensual: e4.s.valorMensual, cesion: e4.s.cesion, elegido: e4.meta.secop.elegido };

  // Guardado dentro del propio HTML.
  const g = document.getElementById('guardado');
  r.guardado = { estado: g.dataset.estado, texto: g.textContent, soporta: Guardado.soportaArchivos() };
  const copia = Guardado.html({ formato: '13-IF-016', version: 2, id: 'prueba-1', guardado: '2026-10-02T10:00:00.000Z',
    nombre: 'PRUEBA FICTICIA ANA MARÍA', s: App.obtenerEstado().s, meta: App.obtenerEstado().meta });
  r.copia = { conWorker: copia.includes('id="pdfjs-worker-src"'), pasoVacio: /<div id="paso" class="paso"><\/div>/.test(copia),
    datos: copia.includes('"id":"prueba-1"'), doctype: /^<!DOCTYPE html>/i.test(copia) };
  r.htmlGuardado = copia;

  const validarOriginal = Calc.validar;
  Calc.validar = (s) => validarOriginal(s, '2027-05-01');
  App.irA('revision');
  await espera(50);
  const texto = document.getElementById('paso').textContent;
  r.revision = { interna: /BI13/.test(texto), codificacion: !!document.querySelector('.codificacion'), nombrePendiente: /te lo mostramos/.test(texto),
    resumenAntesDeDescargas: !!document.querySelector('.resumen-datos + .descargas'), renglonesPendientes: document.querySelectorAll('.pendiente-fila').length,
    borrador: /borrador|\.json/i.test(texto) };
  Calc.validar = validarOriginal;
  document.querySelector('.descargas .boton--primario').click();
  await espera(80);
  const dlg = document.getElementById('dialogo');
  r.dialogo = { abierto: dlg.open, principal: dlg.querySelector('.boton--primario').textContent, foco: document.activeElement.textContent };
  dlg.querySelector('.boton--primario').click();
  await espera(80);
  r.dialogo.cerrado = !dlg.open;
  r.dialogo.paso = App.obtenerEstado().meta.paso;
  App.reiniciar();
  return r;
})()`;

// Abre la copia guardada (con datos dentro): recupera los datos, muestra de quién es y sigue leyendo PDF.
const PRUEBA_COPIA = String.raw`(async () => {
  await new Promise((res) => setTimeout(res, 300));
  const e = App.obtenerEstado();
  return { nit: e.s.nit, apellido: e.s.primerApellido, contrato: e.meta.secop && e.meta.secop.elegido,
    dueno: (document.getElementById('dueno') || {}).textContent || '', guardado: document.getElementById('guardado').dataset.estado,
    worker: (window.PDFJS_WORKER_SRC || '').slice(0, 5), workerBloque: !!document.getElementById('pdfjs-worker-src') };
})()`;

// Imprime a PDF (Page.printToPDF, tamaño de @page) el documento de cada caso y cuenta sus páginas.
async function imprimirCasos(evaluar, enviar) {
  const paginas = {};
  // 'largo': textos extensos + mensaje de faltantes: obliga a reducir la hoja (zoom) para que quepa.
  const largo = { ...PARCIAL, dedDependientes: '', direccion: 'CALLE MUY LARGA '.repeat(12), interventorCargo: 'CARGO MUY LARGO '.repeat(8) };
  const casos = { completo: COMPLETO, variante: VARIANTE, parcial: PARCIAL, vacio: {}, largo };
  for (const [k, estado] of Object.entries(casos)) {
    await evaluar(`(() => { const s = ${JSON.stringify(estado)}; Imprimir.render(s, window.Calc ? Calc.derivados(s) : undefined); return true; })()`);
    const pdf = await enviar('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
    const bytes = Buffer.from(pdf.result.data, 'base64');
    fs.writeFileSync(path.join(TMP, `impresion-${k}.pdf`), bytes);
    paginas[k] = (bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  }
  return paginas;
}

function construirCon(entrada, salida) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'tools/build.mjs'), '--entrada', entrada, '--salida', salida], { encoding: 'utf8', cwd: RAIZ });
}

function verificarHtmlConstruido(html) {
  const sinComentarios = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/<script[^>]+\bsrc=/i.test(sinComentarios), 'sin scripts externos');
  assert.ok(!/<link[^>]+rel="stylesheet"/i.test(sinComentarios), 'sin hojas de estilo externas');
  assert.match(html, /window\.PLANTILLA_XLSX_B64\s*=/);
  assert.match(html, /window\.LOGO_SRC\s*=\s*"data:image\/png;base64,/);
  assert.match(html, /window\.PDFJS_WORKER_SRC/);
  // Cada <script> inline cierra donde corresponde.
  const bloques = html.split(/<script\b[^>]*>/i).slice(1);
  for (const b of bloques) assert.ok(b.indexOf('</script>') >= 0);
  // La plantilla embebida es exactamente el Excel original.
  const b64 = /window\.PLANTILLA_XLSX_B64\s*=\s*"([^"]+)"/.exec(html)[1];
  assert.ok(Buffer.from(b64, 'base64').equals(PLANTILLA), 'plantilla embebida idéntica');
}

const URL_VERSION = 'https://raw.githubusercontent.com/Armitze/SED_FORMULARIO_ACTUALIZACION/main/version.json';
// La consulta de versión puede fallar (sin internet o repositorio privado): el formulario la ignora.
const sinConsultaVersion = (errores) => errores.filter((e) => !e.includes(URL_VERSION));

function verificarEnNavegador(res) {
  assert.equal(res.excepcion, undefined, 'la prueba en la página no lanzó: ' + JSON.stringify(res.excepcion));
  // Lo único que sale al abrir es la consulta de versión (config.js → actualizaciones.versionUrl).
  assert.deepEqual(sinConsultaVersion(res.red), [], 'sin otras peticiones de red');
  const v = res.valor;
  assert.equal(v.ExportExcel, 'object');
  assert.equal(v.Imprimir, 'object');
  assert.equal(v.JSZip, 'function');
  assert.equal(v.pdfjsLib, 'object');
  assert.equal(v.plantilla, PLANTILLA.toString('base64').length);
  assert.equal(v.logo, 'data:image/png;base64,');
  assert.equal(v.worker, 'blob:');
  assert.equal(v.workerScriptPresente, true, 'el bloque del worker se queda: las copias guardadas lo necesitan');
  assert.ok(v.xlsx > 100000, 'Excel generado en el navegador');
  assert.equal(v.xlsxTipo, ExportExcel.MIME);
  assert.equal(v.textoPdf, 'Hola RUT 13-IF-016Formulario de prueba con texto suficiente');
  assert.equal(v.workerReal, true, 'pdf.js usa un Web Worker real desde la Blob URL');
  assert.equal(v.hojas, 2);
  assert.equal(v.impresionOculta, true, '#impresion oculto en pantalla');
  assert.equal(v.logoCargado, true);
}

describe('tools/build.mjs', () => {
  const SCRIPTS_APP = ['catalogos', 'config', 'schema', 'calc', 'pdftext', 'parser-rut', 'parser-rit', 'export-excel', 'print'];

  test('genera un HTML autocontenido que funciona desde file:// sin red', { timeout: 240000 }, async (t) => {
    const dir = path.join(TMP, 'build-src');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'estilo.css'), 'body{color:#123}\n.x{background:url(img/logo.png)}\n');
    fs.writeFileSync(path.join(dir, 'js', 'app.js'), 'window.APP_OK = "</script><b>" + typeof window.ExportExcel;\n');
    fs.writeFileSync(path.join(dir, 'js', 'tarde.js'), 'window.DIFERIDO = !!document.getElementById("fin");\n');
    fs.copyFileSync(path.join(RAIZ, 'src/img/logo.png'), path.join(dir, 'img', 'logo.png'));
    const relativo = (p) => path.relative(dir, p).split(path.sep).join('/');
    // Módulos propios que ya existan en src/js (otros agentes pueden no haber terminado).
    const propios = SCRIPTS_APP.map((n) => path.join(RAIZ, 'src/js', n + '.js')).filter((p) => fs.existsSync(p));
    const printCss = relativo(path.join(RAIZ, 'src/print.css'));
    fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html lang="es-CO"><head><meta charset="utf-8"><title>t</title>
<link rel="stylesheet" href="estilo.css"><link rel="stylesheet" href="${printCss}">
<link rel="stylesheet" href="${printCss}" media="print">
<!-- <script src="no-existe.js"></script> -->
</head><body><img src="img/logo.png" alt="logo"><div id="impresion"></div>
<script src="${relativo(path.join(RAIZ, 'node_modules/pdfjs-dist/build/pdf.min.js'))}"></script>
<script src="${relativo(path.join(RAIZ, 'node_modules/jszip/dist/jszip.min.js'))}"></script>
${propios.map((p) => `<script src="${relativo(p)}"></script>`).join('\n')}
<script src="js/tarde.js" defer></script>
<script src="js/app.js"></script><div id="fin"></div></body></html>`);
    const salida = path.join(TMP, 'build-prueba.html');
    const r = construirCon(path.join(dir, 'index.html'), salida);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const html = fs.readFileSync(salida, 'utf8');
    verificarHtmlConstruido(html);
    assert.ok(!/src="img\/logo\.png"/.test(html), 'logo embebido');
    assert.match(html, /<style media="print">/);
    assert.match(html, /body\{color:#123\}/);
    assert.match(html, /\.x\{background:url\("data:image\/png;base64,/, 'url() del CSS embebida');
    assert.match(html, /<!-- <script src="no-existe.js"><\/script> -->/, 'los comentarios no se procesan');
    assert.match(html, /<\\\/script><b>/, 'las secuencias </script> del código quedan escapadas');
    assert.ok(html.indexOf('window.DIFERIDO') > html.indexOf('id="fin"'), 'los scripts defer van al final del body');
    assert.ok(html.indexOf('window.PLANTILLA_XLSX_B64') < html.indexOf('window.CATALOGOS'), 'arranque antes del primer script propio');

    if (!NAVEGADOR) return t.skip('No hay Edge/Chrome para probar en navegador');
    const res = await enNavegador(pathToFileURL(salida).href,
      PRUEBA_EN_PAGINA + '.then((r) => Object.assign(r, { app: window.APP_OK, diferido: window.DIFERIDO }))', imprimirCasos);
    verificarEnNavegador(res);
    // El formato cabe en 1 hoja carta (+1 si hay deducciones), también con un mensaje de faltantes largo.
    assert.deepEqual(res.extra, { completo: 2, variante: 1, parcial: 2, vacio: 1, largo: 1 }, 'páginas del PDF por caso');
    assert.equal(res.valor.app, '</script><b>object');
    assert.equal(res.valor.diferido, true);
    if (res.valor.pdfText !== undefined) {
      assert.match(res.valor.pdfText, /Hola RUT 13-IF-016/, 'PdfText.leer funciona en el HTML construido');
    }
    assert.deepEqual(sinConsultaVersion(res.errores), [], 'sin errores en la consola');
  });

  test('construye src/index.html completo (si todos sus archivos existen)', { timeout: 240000 }, async (t) => {
    const entrada = path.join(RAIZ, 'src/index.html');
    if (!fs.existsSync(entrada)) return t.skip('src/index.html aún no existe');
    const salida = path.join(TMP, 'formulario-13-IF-016.html');
    const r = construirCon(entrada, salida);
    if (r.status !== 0 && /No existe /.test(r.stderr)) return t.skip('faltan archivos de otros módulos: ' + r.stderr.trim());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    verificarHtmlConstruido(fs.readFileSync(salida, 'utf8'));
    if (!NAVEGADOR) return t.skip('No hay Edge/Chrome para probar en navegador');
    const res = await enNavegador(pathToFileURL(salida).href, PRUEBA_EN_PAGINA, (evaluar) => evaluar(PRUEBA_DOCUMENTOS));
    verificarEnNavegador(res);
    assert.deepEqual(sinConsultaVersion(res.errores), [], 'sin errores en la consola');

    // Documentos → formulario, conflictos, SECOP, guardado y Revisión de la app construida.
    const d = res.extra;
    assert.deepEqual(d.aplicado, { nit: true, numeroId: true, apellido: 'PRUEBA', tel1: '0', depto: 'Antioquia', mun: 'MEDELLÍN', email: '',
      conflictos: ['departamento', 'email', 'municipio'] }, 'lo leído se usa de inmediato; lo escrito a mano y lo dudoso solo se ofrecen');
    assert.equal(d.documentos.lista, 0, 'sin lista de revisión ni casillas en Documentos');
    assert.equal(d.documentos.zona, 'aplicado');
    assert.equal(d.documentos.estadoZona, 'Usamos 8 datos en el formulario');
    assert.deepEqual(d.documentos.notas, ['Tu RUT fue generado hace más de un año. Verifica que esté actualizado.'],
      'en la zona solo los avisos generales (el del teléfono fijo va en su campo)');
    assert.equal(d.documentos.boton, 'Continuar: Personales');
    assert.equal(d.documentos.botonesPrimarios, 1);
    assert.equal(d.documentos.deshacer, false, 'sin Deshacer');
    assert.equal(d.documentos.borrador, false, 'sin borrador .json');
    assert.equal(d.pills, 0, 'los campos no llevan la etiqueta RUT/RIT');
    assert.ok(d.contacto.depto.includes('Tu RUT dice: Bogotá D.C · Usar este · Ignorar'), d.contacto.depto);
    assert.ok(d.contacto.email.includes('Tu RUT parece decir: dudoso@ejemplo.co'), d.contacto.email);
    assert.match(d.contacto.tel1, /no registra teléfono fijo; dejamos 0/);
    assert.deepEqual(d.trasUsar, { depto: 'Bogotá D.C', mun: 'BOGOTÁ', email: '', conflictos: 0 });
    assert.deepEqual(d.secopUno, { anio: '2026', total: '48000000', inicio: '2026-02-02', fin: '2026-12-31', cesion: 'NO', mensual: '1234',
      conflictoMensual: '6000000', area: 'Oficina de Tesorería y Contabilidad', panel: true, select: false, notaNumero: true },
      'un contrato vigente llena el paso (sin reemplazar lo escrito a mano)');
    assert.deepEqual(d.secopVarios, { opciones: 3, elegido: '' }, 'con varios contratos se elige en una lista');
    assert.deepEqual(d.secopElegido, { total: '30000000', mensual: '1234', cesion: 'SI', elegido: 'CO1.PCCNTR.2' });
    assert.equal(d.guardado.estado, 'nuevo', 'con datos y sin archivo: Sin guardar');
    assert.match(d.guardado.texto, /Sin guardar/);
    assert.deepEqual(d.copia, { conWorker: true, pasoVacio: true, datos: true, doctype: true }, 'la copia guardada es el HTML original con los datos');
    // El número de contrato llega de SECOP (CO1.PCCNTR.2 → 2): el nombre del archivo ya se muestra.
    assert.deepEqual(d.revision, { interna: false, codificacion: false, nombrePendiente: false, resumenAntesDeDescargas: true,
      renglonesPendientes: d.revision.renglonesPendientes, borrador: false });
    assert.ok(d.revision.renglonesPendientes > 0);
    // Sin RIT (y con un RUT de hace más de 60 días) lo primero pendiente está en Documentos.
    assert.deepEqual(d.dialogo, { abierto: true, principal: 'Volver y completar', foco: 'Volver y completar', cerrado: true, paso: 0 });

    const rutaCopia = path.join(TMP, 'copia-guardada.html');
    fs.writeFileSync(rutaCopia, d.htmlGuardado);
    const copia = await enNavegador(pathToFileURL(rutaCopia).href, PRUEBA_COPIA);
    fs.rmSync(rutaCopia, { force: true });
    assert.equal(copia.excepcion, undefined);
    assert.deepEqual(sinConsultaVersion(copia.errores), [], 'la copia abre sin errores');
    assert.deepEqual(sinConsultaVersion(copia.red), [], 'la copia no hace otras peticiones de red al abrir');
    const v2 = copia.valor;
    assert.equal(v2.nit, '52345678');
    assert.equal(v2.apellido, 'PRUEBA');
    assert.equal(v2.contrato, 'CO1.PCCNTR.2');
    assert.ok(v2.dueno.startsWith('Formulario de PRUEBA FICTICIA ANA MARÍA · guardado el ') && v2.dueno.endsWith('/2026. ¿No eres tú? Empezar de nuevo'), v2.dueno);
    assert.equal(v2.guardado, 'leido', 'indica que los datos están en el archivo');
    assert.equal(v2.worker, 'blob:', 'la copia sigue leyendo PDF');
    assert.equal(v2.workerBloque, true);
  });
});
