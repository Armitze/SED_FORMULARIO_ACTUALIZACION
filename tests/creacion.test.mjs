// Pruebas de la creación de tercero: src/js/creacion.js y la unión de archivos de Imprimir.unir (print.js).
// La pantalla se prueba en el navegador (tests/app.smoke.md).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.PDFLib = require('pdf-lib');
require('../src/js/catalogos.js');
require('../src/js/pdftext.js');
const RutParser = require('../src/js/parser-rut.js');
const Creacion = require('../src/js/creacion.js');
const Imprimir = require('../src/js/print.js');

const { PDFDocument } = globalThis.PDFLib;

/** Item como los de Soportes con un PDF de n hojas; el ancho de la hoja identifica el documento. */
async function itemPdf(nombre, ancho, n = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([ancho, 700]);
  const datos = Buffer.from(await doc.save()).toString('base64');
  return { id: nombre, nombre, tipo: 'application/pdf', bytes: datos.length, datos };
}

describe('CreacionTercero', () => {
  test('el PDF lleva RIT, RUT y certificación bancaria, en ese orden', () => {
    assert.deepEqual(Creacion.DOCUMENTOS.map((d) => d.id), ['rit', 'rut', 'banco']);
    const docs = { banco: { id: 'b' }, rit: { id: 'r' }, rut: { id: 'u' } };
    assert.deepEqual(Creacion.enOrden(docs).map((x) => x.id), ['r', 'u', 'b']);
  });

  test('faltantes dice qué documentos no se han adjuntado', () => {
    assert.deepEqual(Creacion.faltantes({}).map((d) => d.id), ['rit', 'rut', 'banco']);
    assert.deepEqual(Creacion.faltantes({ rit: {}, banco: {} }).map((d) => d.id), ['rut']);
    assert.deepEqual(Creacion.faltantes({ rit: {}, rut: {}, banco: {} }), []);
  });

  test('límites por archivo desde la configuración, un archivo por documento', () => {
    const MB = 1024 * 1024;
    assert.deepEqual(Creacion.limites({ creacionTercero: { maxArchivoMb: 2 } }), { maxArchivo: 2 * MB, maxTotal: 6 * MB, maxPorTipo: 1 });
    assert.equal(Creacion.limites({}).maxArchivo, 15 * MB);
  });

  test('objeta solo cuando reconoce otro documento', () => {
    assert.match(Creacion.documentoEquivocado('rut', ['RIT']), /parece ser el RIT, no el RUT/);
    assert.match(Creacion.documentoEquivocado('rit', ['RUT']), /parece ser el RUT, no el RIT/);
    assert.match(Creacion.documentoEquivocado('banco', ['RUT']), /no la certificación bancaria/);
    assert.equal(Creacion.documentoEquivocado('rut', ['RUT', 'RIT']), '', 'un paquete que trae ambos sirve');
    assert.equal(Creacion.documentoEquivocado('rut', []), '', 'un escaneo no se puede reconocer');
    assert.equal(Creacion.documentoEquivocado('banco', []), '');
  });

  test('datosDelRut toma NIT y nombre de persona natural y de persona jurídica', () => {
    const campo = (valor) => ({ valor });
    assert.deepEqual(Creacion.datosDelRut({ campos: { nit: campo('80123456'), primerNombre: campo('ANA'), otrosNombres: campo('MARÍA'), primerApellido: campo('PRUEBA') } }),
      { nit: '80123456', nombre: 'ANA MARÍA PRUEBA' });
    assert.deepEqual(Creacion.datosDelRut({ ok: false, campos: {}, extra: { razonSocial: 'EMPRESA DE PRUEBA S.A.S.', datosPersonaJuridica: { nit: campo('899999063') } } }),
      { nit: '899999063', nombre: 'EMPRESA DE PRUEBA S.A.S.' });
    assert.deepEqual(Creacion.datosDelRut(null), { nit: '', nombre: '' });
  });

  test('nombra el PDF con lo que RutParser lee de un RUT real', () => {
    const leer = (n) => RutParser.parse(JSON.parse(fs.readFileSync(new URL('./fixtures/' + n + '.json', import.meta.url), 'utf8')), { hoy: '2026-11-04' });
    const pj = Creacion.datosDelRut(leer('rut-pj-2016-unal'));
    assert.match(Creacion.nombrePdf(pj), /^CREACION_TERCERO_\d+_UNIVERSIDAD_NACIONAL_DE_COLOMBIA\.pdf$/);
    const pn = Creacion.datosDelRut(leer('rut-pn-2026-anon'));
    assert.match(pn.nit, /^\d+$/);
    assert.ok(pn.nombre, 'la persona natural trae nombre');
  });

  test('nombrePdf sirve en cualquier carpeta y no se repite aunque no haya NIT', () => {
    assert.equal(Creacion.nombrePdf({ nit: '80123456', nombre: 'ANA MARÍA PEÑA' }), 'CREACION_TERCERO_80123456_ANA_MARIA_PENA.pdf');
    assert.equal(Creacion.nombrePdf({ nit: '899999063', nombre: 'EMPRESA / DE: PRUEBA S.A.S.' }), 'CREACION_TERCERO_899999063_EMPRESA_DE_PRUEBA_S_A_S.pdf');
    assert.equal(Creacion.nombrePdf({ nit: '80123456' }), 'CREACION_TERCERO_80123456.pdf');
    const fecha = new Date(2026, 10, 4, 8, 5, 9);
    assert.equal(Creacion.nombrePdf(null, fecha), 'CREACION_TERCERO_20261104_080509.pdf');
    assert.equal(Creacion.nombrePdf({ nit: '', nombre: 'SIN NIT' }, fecha), 'CREACION_TERCERO_20261104_080509.pdf');
  });
});

describe('Imprimir.unir', () => {
  test('junta todas las hojas de cada archivo, en el orden dado', async () => {
    const items = [await itemPdf('rit.pdf', 300, 2), await itemPdf('rut.pdf', 400, 3), await itemPdf('banco.pdf', 500)];
    const blob = await Imprimir.unir(items, { titulo: 'CREACION_TERCERO_1' });
    assert.equal(blob.type, 'application/pdf');
    const salida = await PDFDocument.load(await blob.arrayBuffer());
    assert.deepEqual(salida.getPages().map((p) => p.getWidth()), [300, 300, 400, 400, 400, 500]);
    assert.equal(salida.getTitle(), 'CREACION_TERCERO_1');
  });

  test('si un archivo no se puede agregar no entrega un PDF incompleto', async () => {
    const bueno = await itemPdf('rit.pdf', 300);
    const malo = { id: 'x', nombre: 'dañado.pdf', tipo: 'application/pdf', bytes: 8, datos: Buffer.from('no es pdf').toString('base64') };
    await assert.rejects(Imprimir.unir([bueno, malo]), (e) => e.item === malo);
  });
});
