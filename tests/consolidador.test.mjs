// Pruebas de src/js/consolidador.js: lectura de formularios recibidos, filas únicas, lectura de un consolidado
// existente, combinación y el Excel/ZIP generados. Todos los datos son ficticios.
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
const CARPETA = '2026/PRUEBA_FICTICIA_ANA';
const registro = (s, extra, archivo) => C.leer(formulario(s, extra), archivo || 'a.html').registro;

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
    assert.equal(x.carpeta, CARPETA, 'Contratistas/AÑO/NOMBRE');
    assert.ok(x.pendientes > 0, 'faltan datos obligatorios');
  });

  test('cuenta como pendiente la certificación bancaria que falta', async () => {
    const con = registro(PERSONA, { soportes: { banco: [await soporte('c.pdf')] } });
    const sin = registro(PERSONA);
    assert.equal(sin.pendientes, con.pendientes + 1);
  });

  test('el soporte del dependiente no se pide para hijos menores de 23 (motivos 1 y 2)', () => {
    const motivos = globalThis.CATALOGOS.motivosDependientes;
    const pendientes = (n) => registro(Object.assign({}, PERSONA, { dedDependientes: 'SI', depMotivo: motivos[n].texto })).pendientes;
    assert.equal(pendientes(0), pendientes(1));
    assert.equal(pendientes(3), pendientes(0) + 1, 'cónyuge: falta su soporte');
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
    const viejo = registro(PERSONA, { guardado: '2026-10-01T10:00:00.000Z' }, 'viejo.html');
    const nuevo = registro(Object.assign({}, PERSONA, { email: 'ana@ejemplo.com' }), { guardado: '2026-10-05T10:00:00.000Z' }, 'nuevo.html');
    const otro = registro(Object.assign({}, PERSONA, { nit: '79000001', numeroId: '79000001', primerApellido: 'ABAD' }), {}, 'otro.html');
    const r = C.unificar([nuevo, viejo, otro]);
    assert.deepEqual(r.registros.map((x) => x.archivo), ['otro.html', 'nuevo.html']);
    assert.deepEqual(r.duplicados.map((x) => x.archivo), ['viejo.html']);
  });

  test('mismo nombre el mismo año: la segunda carpeta lleva el número de contrato', () => {
    const a = registro(PERSONA, {}, 'a.html');
    const b = registro(Object.assign({}, PERSONA, { numeroContrato: '987' }), {}, 'b.html');
    const c = registro(Object.assign({}, PERSONA, { numeroContrato: '1234', anioContrato: '2025' }), {}, 'c.html');
    const r = C.unificar([a, b, c]);
    assert.deepEqual(r.registros.map((x) => x.carpetaUnica).sort(), ['2025/PRUEBA_FICTICIA_ANA', CARPETA, CARPETA + '_987']);
  });
});

/** Celdas de la hoja: { 'A1': { texto, numero, estilo } }. */
async function leerHoja(bytes) {
  const z = await JSZip.loadAsync(bytes);
  const xml = await z.file('xl/worksheets/sheet1.xml').async('string');
  const celdas = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"( t="inlineStr")?(?: s="(\d+)")?>(?:<is><t xml:space="preserve">([\s\S]*?)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g)) {
    celdas[m[1]] = { texto: m[2] ? m[4] : undefined, numero: m[5] !== undefined ? Number(m[5]) : undefined, estilo: m[3] };
  }
  const relsArchivo = z.file('xl/worksheets/_rels/sheet1.xml.rels');
  return { celdas, xml, rels: relsArchivo ? await relsArchivo.async('string') : '' };
}

function columnaDe(titulo) {
  const i = C.columnas().findIndex((c) => c.titulo === titulo);
  assert.ok(i >= 0, 'columna ' + titulo);
  return C.letraColumna(i);
}

describe('Consolidador.xlsx', () => {
  test('una fila por contratista con encabezados, tipos y formatos', async () => {
    const banco = await soporte('cert.pdf');
    const { registros } = C.unificar([registro(PERSONA, { soportes: { banco: [banco] } })]);
    const { celdas, xml, rels } = await leerHoja(await C.xlsx(registros, { enlaces: false }));
    assert.equal(celdas.A1.texto, 'Nombre completo');
    assert.match(celdas.A2.texto, /PRUEBA FICTICIA ANA/);
    assert.equal(celdas[columnaDe('NIT') + '2'].texto, '52345678', 'documentos como texto');
    assert.equal(celdas[columnaDe('Número de cuenta') + '2'].texto, '00123456789', 'conserva los ceros iniciales');
    const total = celdas[columnaDe('Valor total del contrato') + '2'];
    assert.deepEqual([total.numero, total.estilo], [48000000, '3']);
    const inicio = celdas[columnaDe('Fecha del acta de inicio') + '2'];
    assert.deepEqual([inicio.numero, inicio.estilo], [C.serialFecha('2026-02-02'), '2']);
    const guardado = celdas[columnaDe('Guardado el') + '2'];
    assert.equal(guardado.estilo, '7', 'fecha y hora');
    assert.ok(Math.abs(guardado.numero - C.serialFechaHora('2026-10-20T10:00:00.000Z')) < 1 / 86400);
    assert.equal(celdas[columnaDe('¿Pensionado?') + '2'].texto, 'No');
    assert.equal(celdas[columnaDe('Certificación bancaria') + '2'].texto, 'Sí (1)', 'sin enlaces: solo cuántos archivos');
    assert.equal(celdas[columnaDe('Carpeta del contratista') + '2'].texto, CARPETA);
    assert.equal(rels, '', 'sin enlaces no hay relaciones');
    assert.match(xml, /<autoFilter ref="A1:[A-Z]+2"\/>/);
    assert.match(xml, /state="frozen"/);
  });

  test('con enlaces: cada soporte apunta a su archivo dentro de Contratistas/AÑO/NOMBRE/', async () => {
    const banco = await soporte('cert.pdf');
    const dep = [await soporte('rc.pdf'), await soporte('estudio.pdf')];
    const s = Object.assign({}, PERSONA, { dedDependientes: 'SI' });
    const { registros } = C.unificar([registro(s, { soportes: { banco: [banco], dependientes: dep } })]);
    const { celdas, rels } = await leerHoja(await C.xlsx(registros, { enlaces: true }));
    assert.equal(celdas[columnaDe('Certificación bancaria') + '2'].texto, 'cert.pdf');
    assert.equal(celdas[columnaDe('Soportes del dependiente') + '2'].texto, '2 archivos');
    assert.match(rels, /Target="Contratistas\/2026\/PRUEBA_FICTICIA_ANA\/Certificacion_bancaria\.pdf" TargetMode="External"/);
    assert.match(rels, /Target="Contratistas\/2026\/PRUEBA_FICTICIA_ANA\/" TargetMode="External"/, 'varios archivos: la carpeta');
  });

  test('escapa el texto y no deja caracteres inválidos en el XML', async () => {
    const s = Object.assign({}, PERSONA, { direccion: 'CALLE 1 # 2-3 <A&B> "X"\u0007' });
    const { registros } = C.unificar([registro(s)]);
    const { xml } = await leerHoja(await C.xlsx(registros));
    assert.ok(xml.includes('&lt;A&amp;B&gt; &quot;X&quot;'));
    assert.ok(!xml.includes('\u0007'));
  });
});

describe('Consolidador.leerXlsx', () => {
  test('lee el consolidado que genera (ida y vuelta)', async () => {
    const { registros } = C.unificar([registro(PERSONA), registro(Object.assign({}, PERSONA, { nit: '79000001', numeroId: '79000001', primerApellido: 'ABAD' }))]);
    const t = await C.leerXlsx(await C.xlsx(registros, { enlaces: true }));
    assert.equal(t.encabezados[0], 'Nombre completo');
    assert.deepEqual(t.extras, []);
    assert.equal(t.filas.length, 2);
    assert.equal(t.filas[1].NIT, '52345678');
    assert.equal(t.filas[1]['Número de cuenta'], '00123456789');
    assert.equal(t.filas[1]['Valor total del contrato'], 48000000);
    assert.equal(t.filas[1]['Carpeta del contratista'], CARPETA);
  });

  test('lee un archivo guardado por Excel (textos compartidos, columnas agregadas a mano)', async () => {
    const z = new JSZip();
    z.file('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="Hoja" sheetId="1" r:id="rId7"/></sheets></workbook>');
    z.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/hoja9.xml"/></Relationships>');
    z.file('xl/sharedStrings.xml', '<sst><si><t>Nombre completo</t></si><si><t>NIT</t></si><si><t>Observación</t></si>' +
      '<si><r><t>PRUEBA </t></r><r><rPr><b/></rPr><t>ANA</t></r></si><si><t>52345678</t></si><si><t xml:space="preserve">Llamar &amp; revisar</t></si></sst>');
    z.file('xl/worksheets/hoja9.xml', '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>' +
      '<row r="2" spans="1:4"><c r="A2" t="s" s="3"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" s="2"/><c r="D2" t="s"><v>5</v></c></row>' +
      '<row r="3"/></sheetData></worksheet>');
    const t = await C.leerXlsx(await z.generateAsync({ type: 'uint8array' }));
    assert.deepEqual(t.filas, [{ 'Nombre completo': 'PRUEBA ANA', NIT: '52345678', 'Observación': 'Llamar & revisar' }]);
    assert.deepEqual(t.extras, ['Observación']);
  });
});

describe('Consolidador.combinar', () => {
  async function existentes(registros) {
    return (await C.leerXlsx(await C.xlsx(C.unificar(registros).registros, { enlaces: true }))).filas;
  }

  test('nuevo, actualizado y sin cambios; respeta el orden y la carpeta de la fila existente', async () => {
    const abad = Object.assign({}, PERSONA, { nit: '79000001', numeroId: '79000001', primerApellido: 'ABAD', primerNombre: 'LUIS' });
    const previas = await existentes([registro(abad, { guardado: '2026-10-01T10:00:00.000Z' }), registro(PERSONA, { guardado: '2026-10-01T10:00:00.000Z' })]);
    const mismo = registro(abad, { guardado: '2026-10-01T10:00:00.000Z' }, 'abad-igual.html');
    const masNuevo = registro(Object.assign({}, PERSONA, { email: 'ana@ejemplo.com' }), { guardado: '2026-10-09T08:00:00.000Z' }, 'ana-nuevo.html');
    const nuevo = registro(Object.assign({}, PERSONA, { nit: '11111111', numeroId: '11111111', numeroContrato: '555' }), {}, 'homonima.html');
    const r = C.combinar(previas, C.unificar([mismo, masNuevo, nuevo]).registros);
    assert.deepEqual([r.nuevos.length, r.actualizados.length, r.sinCambios.length], [1, 1, 1]);
    assert.deepEqual(r.filas.map((f) => (f.registro ? f.registro.archivo : 'existente')), ['existente', 'ana-nuevo.html', 'homonima.html']);
    assert.equal(r.filas[1].registro.carpetaUnica, CARPETA, 'la actualización usa la carpeta que ya tenía');
    assert.equal(r.filas[2].registro.carpetaUnica, CARPETA + '_555', 'homónima: otra carpeta');
    assert.equal(mismo.resultado, 'sin-cambios');
  });

  test('el Excel combinado conserva los valores y las columnas agregadas a mano', async () => {
    const previas = await existentes([registro(PERSONA)]);
    previas[0]['Observación'] = 'Revisado por Tesorería';
    const otro = registro(Object.assign({}, PERSONA, { nit: '79000001', numeroId: '79000001', primerApellido: 'ABAD' }), {}, 'b.html');
    const r = C.combinar(previas, [otro]);
    const t = await C.leerXlsx(await C.xlsx(r.filas, { enlaces: true, extras: ['Observación'] }));
    assert.equal(t.filas.length, 2);
    assert.equal(t.filas[0]['Observación'], 'Revisado por Tesorería');
    assert.equal(t.filas[0]['Valor total del contrato'], 48000000);
    assert.equal(t.filas[0]['Número de cuenta'], '00123456789');
    assert.equal(t.filas[1].NIT, '79000001');
  });

  test('al actualizar una fila se conserva lo escrito en las columnas agregadas a mano', async () => {
    const previas = await existentes([registro(PERSONA, { guardado: '2026-10-01T10:00:00.000Z' })]);
    previas[0]['Observación'] = 'Pendiente certificado';
    const r = C.combinar(previas, [registro(PERSONA, { guardado: '2026-10-09T10:00:00.000Z' })]);
    assert.equal(r.actualizados.length, 1);
    const t = await C.leerXlsx(await C.xlsx(r.filas, { enlaces: true, extras: ['Observación'] }));
    assert.equal(t.filas[0]['Observación'], 'Pendiente certificado');
  });

  test('enlaces de las filas existentes desde los archivos de su carpeta', async () => {
    const previas = await existentes([registro(PERSONA)]);
    const r = C.combinar(previas, []);
    const archivosDeFila = (f) => ['Certificacion_bancaria.pdf', 'Formulario.html', 'notas.txt']
      .filter((n) => C.claseDeArchivo(n)).map((n) => ({ clave: C.claseDeArchivo(n), nombre: n, ruta: C.rutaCarpeta(f.carpeta) + n }));
    const { rels } = await leerHoja(await C.xlsx(r.filas, { enlaces: true, archivosDeFila }));
    assert.match(rels, /Target="Contratistas\/2026\/PRUEBA_FICTICIA_ANA\/Certificacion_bancaria\.pdf"/);
  });

  test('claseDeArchivo reconoce los soportes por su nombre', () => {
    assert.equal(C.claseDeArchivo('Certificacion_bancaria.pdf'), 'banco');
    assert.equal(C.claseDeArchivo('Soporte_dependiente_2.jpg'), 'dependientes');
    assert.equal(C.claseDeArchivo('Certificado_salud.png'), 'saludNoPos');
    assert.equal(C.claseDeArchivo('Formulario.html'), '');
    assert.equal(C.claseDeArchivo('otro.pdf'), '');
  });
});

describe('Consolidador.zip', () => {
  test('carpeta con el Excel y los soportes con sus bytes originales', async () => {
    const banco = await soporte('cert.pdf');
    const { registros } = C.unificar([registro(PERSONA, { soportes: { banco: [banco] } })]);
    const z = await JSZip.loadAsync(await C.zip(registros, { nombre: 'Consolidado_prueba' }));
    const nombres = Object.keys(z.files).filter((n) => !z.files[n].dir).sort();
    assert.deepEqual(nombres, ['Consolidado_prueba/Consolidado_prueba.xlsx', 'Consolidado_prueba/Contratistas/2026/PRUEBA_FICTICIA_ANA/Certificacion_bancaria.pdf']);
    const bytes = await z.file('Consolidado_prueba/Contratistas/2026/PRUEBA_FICTICIA_ANA/Certificacion_bancaria.pdf').async('uint8array');
    assert.deepEqual(bytes, PDF);
  });

  test('nombre con la fecha', () => {
    assert.equal(C.nombreBase(new Date(2026, 9, 21)), 'Consolidado_13-IF-016_2026-10-21');
  });
});
