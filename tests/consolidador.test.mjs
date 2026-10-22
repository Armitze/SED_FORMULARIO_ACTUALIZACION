// Pruebas de src/js/consolidador.js: lectura de formularios recibidos, filas únicas y el Excel/ZIP generados.
// Todos los datos son ficticios.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../src/js/catalogos.js');
require('../src/js/config.js');
require('../src/js/schema.js');
require('../src/js/calc.js');
const Guardado = require('../src/js/guardado.js');
const Soportes = require('../src/js/soportes.js');
require('../src/js/export-excel.js');
const C = require('../src/js/consolidador.js');
const JSZip = require('jszip');

const BASE = '<!DOCTYPE html>\n<html><body><script type="application/json" id="datos-formulario"></script></body></html>';
const PDF = new TextEncoder().encode('%PDF-1.4\n%ficticio\n%%EOF');

async function soporte(nombre) {
  return Soportes.leer(new File([PDF], nombre));
}

function formulario(s, extra) {
  return Guardado.html(Object.assign({ formato: '13-IF-016', version: 2, id: 'f-' + (s.nit || 'x'), guardado: '2026-10-20T10:00:00.000Z', s }, extra), BASE);
}

const PERSONA = {
  nit: '52345678', dv: '1', numeroId: '52345678', primerApellido: 'PRUEBA', segundoApellido: 'FICTICIA', primerNombre: 'ANA',
  numeroContrato: '1234', anioContrato: '2026', valorTotal: '48000000', valorMensual: '6000000',
  fechaInicio: '2026-02-02', fechaTerminacion: '2026-09-30', numeroCuenta: '00123456789', pensionado: 'NO',
  dedDependientes: '', depNombre: 'OCULTO PORQUE NO MARCÓ',
};

describe('Consolidador.leer', () => {
  test('lee los datos visibles, los cálculos y los soportes', async () => {
    const banco = await soporte('cert.pdf');
    const r = C.leer(formulario(PERSONA, { soportes: { banco: [banco] } }), 'recibido.html');
    assert.equal(r.ok, true);
    const x = r.registro;
    assert.equal(x.archivo, 'recibido.html');
    assert.equal(x.s.nit, '52345678');
    assert.equal(x.s.depNombre, '', 'los campos ocultos quedan vacíos, como en el PDF');
    assert.match(String(x.d.nombreCompleto), /PRUEBA FICTICIA ANA/);
    assert.equal(x.soportes.banco.length, 1);
    assert.equal(x.carpeta, 'PRUEBA_FICTICIA_ANA_1234_2026');
    assert.ok(x.pendientes > 0, 'faltan datos obligatorios');
  });

  test('cuenta como pendiente la certificación bancaria que falta', async () => {
    const con = C.leer(formulario(PERSONA, { soportes: { banco: [await soporte('c.pdf')] } }), 'a.html').registro;
    const sin = C.leer(formulario(PERSONA), 'b.html').registro;
    assert.equal(sin.pendientes, con.pendientes + 1);
  });

  test('rechaza lo que no es un formulario con datos', () => {
    assert.equal(C.leer('<html><body>hola</body></html>', 'x.html').error, 'NO_FORMULARIO');
    assert.equal(C.leer(BASE, 'limpio.html').error, 'NO_FORMULARIO');
    assert.equal(C.leer(formulario({}), 'vacio.html').error, 'SIN_DATOS');
    assert.equal(C.leer(formulario(PERSONA, { formato: 'OTRO' }), 'otro.html').error, 'OTRO_FORMATO');
  });
});

describe('Consolidador.unificar', () => {
  test('uno por contratista y contrato: el guardado más reciente; ordena por nombre', () => {
    const viejo = C.leer(formulario(PERSONA, { guardado: '2026-10-01T10:00:00.000Z' }), 'viejo.html').registro;
    const nuevo = C.leer(formulario(Object.assign({}, PERSONA, { email: 'ana@ejemplo.com' }), { guardado: '2026-10-05T10:00:00.000Z' }), 'nuevo.html').registro;
    const otro = C.leer(formulario(Object.assign({}, PERSONA, { nit: '79000001', numeroId: '79000001', primerApellido: 'ABAD' })), 'otro.html').registro;
    const r = C.unificar([nuevo, viejo, otro]);
    assert.deepEqual(r.registros.map((x) => x.archivo), ['otro.html', 'nuevo.html']);
    assert.deepEqual(r.duplicados.map((x) => x.archivo), ['viejo.html']);
  });

  test('dos registros con la misma carpeta reciben carpetas distintas', () => {
    const a = C.leer(formulario(PERSONA), 'a.html').registro;
    const b = C.leer(formulario(Object.assign({}, PERSONA, { nit: '11111111', numeroId: '11111111' })), 'b.html').registro;
    const r = C.unificar([a, b]);
    assert.deepEqual(r.registros.map((x) => x.carpetaUnica).sort(), ['PRUEBA_FICTICIA_ANA_1234_2026', 'PRUEBA_FICTICIA_ANA_1234_2026_2']);
  });
});

/** Celdas de la hoja: { 'A1': { t, v, s } } (texto en línea o número). */
async function leerHoja(bytes) {
  const z = await JSZip.loadAsync(bytes);
  const xml = await z.file('xl/worksheets/sheet1.xml').async('string');
  const celdas = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"( t="inlineStr")?(?: s="(\d+)")?>(?:<is><t xml:space="preserve">([\s\S]*?)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g)) {
    celdas[m[1]] = { texto: m[2] ? m[4] : undefined, numero: m[5] !== undefined ? Number(m[5]) : undefined, estilo: m[3] };
  }
  const relsArchivo = z.file('xl/worksheets/_rels/sheet1.xml.rels');
  return { celdas, xml, rels: relsArchivo ? await relsArchivo.async('string') : '', zip: z };
}

function columnaDe(titulo) {
  const i = C.columnas().findIndex((c) => c.titulo === titulo);
  assert.ok(i >= 0, 'columna ' + titulo);
  return C.letraColumna(i);
}

describe('Consolidador.xlsx', () => {
  test('una fila por contratista con encabezados, tipos y formatos', async () => {
    const banco = await soporte('cert.pdf');
    const { registros } = C.unificar([C.leer(formulario(PERSONA, { soportes: { banco: [banco] } }), 'a.html').registro]);
    const { celdas, xml, rels } = await leerHoja(await C.xlsx(registros, { enlaces: false }));
    assert.equal(celdas.A1.texto, 'Nombre completo');
    assert.match(celdas.A2.texto, /PRUEBA FICTICIA ANA/);
    assert.equal(celdas[columnaDe('NIT') + '2'].texto, '52345678', 'documentos como texto');
    assert.equal(celdas[columnaDe('Número de cuenta') + '2'].texto, '00123456789', 'conserva los ceros iniciales');
    const total = celdas[columnaDe('Valor total del contrato') + '2'];
    assert.deepEqual([total.numero, total.estilo], [48000000, '3']);
    const inicio = celdas[columnaDe('Fecha del acta de inicio') + '2'];
    assert.deepEqual([inicio.numero, inicio.estilo], [C.serialFecha('2026-02-02'), '2']);
    assert.equal(celdas[columnaDe('¿Pensionado?') + '2'].texto, 'No');
    assert.equal(celdas[columnaDe('Certificación bancaria') + '2'].texto, 'Sí (1)', 'sin enlaces: solo cuántos archivos');
    assert.equal(rels, '', 'sin enlaces no hay relaciones');
    assert.match(xml, /<autoFilter ref="A1:[A-Z]+2"\/>/);
    assert.match(xml, /state="frozen"/);
  });

  test('con enlaces: cada soporte apunta a su archivo dentro de soportes/', async () => {
    const banco = await soporte('cert.pdf');
    const dep = [await soporte('rc.pdf'), await soporte('estudio.pdf')];
    const s = Object.assign({}, PERSONA, { dedDependientes: 'SI' });
    const { registros } = C.unificar([C.leer(formulario(s, { soportes: { banco: [banco], dependientes: dep } }), 'a.html').registro]);
    const { celdas, rels } = await leerHoja(await C.xlsx(registros, { enlaces: true }));
    assert.equal(celdas[columnaDe('Certificación bancaria') + '2'].texto, 'cert.pdf');
    assert.equal(celdas[columnaDe('Soportes del dependiente') + '2'].texto, '2 archivos');
    assert.match(rels, /Target="soportes\/PRUEBA_FICTICIA_ANA_1234_2026\/Certificacion_bancaria\.pdf" TargetMode="External"/);
    assert.match(rels, /Target="soportes\/PRUEBA_FICTICIA_ANA_1234_2026\/" TargetMode="External"/, 'varios archivos: la carpeta');
  });

  test('escapa el texto y no deja caracteres inválidos en el XML', async () => {
    const s = Object.assign({}, PERSONA, { direccion: 'CALLE 1 # 2-3 <A&B> "X"\u0007' });
    const { registros } = C.unificar([C.leer(formulario(s), 'a.html').registro]);
    const { xml } = await leerHoja(await C.xlsx(registros));
    assert.ok(xml.includes('&lt;A&amp;B&gt; &quot;X&quot;'));
    assert.ok(!xml.includes('\u0007'));
  });
});

describe('Consolidador.zip', () => {
  test('carpeta con el Excel y los soportes con sus bytes originales', async () => {
    const banco = await soporte('cert.pdf');
    const { registros } = C.unificar([C.leer(formulario(PERSONA, { soportes: { banco: [banco] } }), 'a.html').registro]);
    const z = await JSZip.loadAsync(await C.zip(registros, { nombre: 'Consolidado_prueba' }));
    const nombres = Object.keys(z.files).filter((n) => !z.files[n].dir).sort();
    assert.deepEqual(nombres, ['Consolidado_prueba/Consolidado_prueba.xlsx', 'Consolidado_prueba/soportes/PRUEBA_FICTICIA_ANA_1234_2026/Certificacion_bancaria.pdf']);
    const bytes = await z.file('Consolidado_prueba/soportes/PRUEBA_FICTICIA_ANA_1234_2026/Certificacion_bancaria.pdf').async('uint8array');
    assert.deepEqual(bytes, PDF);
  });

  test('nombre con la fecha', () => {
    assert.equal(C.nombreBase(new Date(2026, 9, 21)), 'Consolidado_13-IF-016_2026-10-21');
  });
});
