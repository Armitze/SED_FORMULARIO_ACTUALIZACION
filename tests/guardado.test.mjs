// Pruebas de src/js/guardado.js (datos dentro del propio HTML). La escritura de archivos se prueba en el
// navegador (tests/export.test.mjs); aquí, la serialización del bloque de datos.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const Guardado = require('../src/js/guardado.js');

const BASE = '<!DOCTYPE html>\n<html><head><title>t</title></head><body><div id="paso"></div>' +
  '<script type="application/json" id="datos-formulario"></script><script>window.x = "$&";</script></body></html>';

describe('Guardado.versionMayor / esFormulario', () => {
  test('compara cada parte como número', () => {
    assert.equal(Guardado.versionMayor('1.02', '1.01'), true);
    assert.equal(Guardado.versionMayor('1.10', '1.9'), true);
    assert.equal(Guardado.versionMayor('2', '1.99'), true);
    assert.equal(Guardado.versionMayor('1.01', '1.01'), false);
    assert.equal(Guardado.versionMayor('1.0.1', '1.01'), false, '1.01 se lee como 1.1');
    assert.equal(Guardado.versionMayor('', '1.01'), false);
  });

  test('solo acepta un formulario construido con bloque de datos', () => {
    const marca = '<!doctype html>\n<!-- Formulario 13-IF-016 · versión 1.02 · construido x con tools/build.mjs -->\n';
    assert.equal(Guardado.esFormulario(marca + BASE.replace('<!DOCTYPE html>\n', '')), true);
    assert.equal(Guardado.esFormulario(BASE), false, 'sin la marca del build');
    assert.equal(Guardado.esFormulario(marca + '<html><body>404: Not Found</body></html>'), false, 'sin bloque de datos');
  });
});

describe('Guardado.html', () => {
  test('inserta los datos en el bloque y vuelve al HTML original con datos null', () => {
    const datos = { id: 'a1', nombre: 'PRUEBA $& $1', s: { nit: '52345678' } };
    const html = Guardado.html(datos, BASE);
    assert.ok(html.includes('{"id":"a1","nombre":"PRUEBA $& $1","s":{"nit":"52345678"}}'), 'los $ de los datos no se interpretan');
    assert.ok(html.endsWith('<script>window.x = "$&";</script></body></html>'), 'el resto del archivo queda igual');
    assert.equal(Guardado.html(null, html), BASE);
  });

  test('el JSON no puede cerrar el <script> ni romper el JavaScript', () => {
    const malicioso = { nombre: '</script><script>alert(1)</script>', ls: 'a' + String.fromCharCode(0x2028) + 'b' };
    const html = Guardado.html(malicioso, BASE);
    const bloque = /id="datos-formulario">([\s\S]*?)<\/script>/.exec(html)[1];
    assert.ok(!bloque.includes('<'), 'sin "<" literal dentro del bloque');
    assert.ok(!bloque.includes(String.fromCharCode(0x2028)));
    assert.deepEqual(JSON.parse(bloque), malicioso);
  });

  test('sin bloque de datos o sin plantilla: error con código', () => {
    assert.throws(() => Guardado.html({}, '<html><body></body></html>'), { codigo: 'SIN_BLOQUE' });
    Guardado._reiniciarPlantilla();
    assert.throws(() => Guardado.html({}), { codigo: 'SIN_PLANTILLA' });
  });
});

describe('Guardado.leerEmbebido', () => {
  const doc = (texto) => ({ getElementById: (id) => (id === 'datos-formulario' && texto !== null ? { textContent: texto } : null) });
  test('lee el bloque; vacío, inválido o ausente = formulario en limpio', () => {
    assert.deepEqual(Guardado.leerEmbebido(doc('{"id":"x","s":{"nit":"1"}}')), { id: 'x', s: { nit: '1' } });
    assert.equal(Guardado.leerEmbebido(doc('')), null);
    assert.equal(Guardado.leerEmbebido(doc('   ')), null);
    assert.equal(Guardado.leerEmbebido(doc('{roto')), null);
    assert.equal(Guardado.leerEmbebido(doc('[1,2]')), null);
    assert.equal(Guardado.leerEmbebido(doc(null)), null);
  });
});

describe('Guardado: respaldo en el navegador', () => {
  test('por formulario (id) y para el formulario en limpio', () => {
    const almacen = new Map();
    globalThis.localStorage = {
      setItem: (k, v) => almacen.set(k, String(v)), getItem: (k) => (almacen.has(k) ? almacen.get(k) : null), removeItem: (k) => almacen.delete(k),
    };
    assert.ok(Guardado.guardarPendiente(null, { s: { nit: '1' } }));
    assert.ok(Guardado.guardarPendiente('abc', { s: { nit: '2' } }));
    assert.deepEqual(Guardado.leerPendiente(null), { s: { nit: '1' } });
    assert.deepEqual(Guardado.leerPendiente('abc'), { s: { nit: '2' } });
    Guardado.borrarPendiente('abc');
    assert.equal(Guardado.leerPendiente('abc'), null);
    almacen.set('sed-13-IF-016:pendiente:nuevo', '{roto');
    assert.equal(Guardado.leerPendiente(null), null);
    delete globalThis.localStorage;
  });

  test('nuevoId único', () => {
    assert.notEqual(Guardado.nuevoId(), Guardado.nuevoId());
  });
});

describe('Guardado.archivoActual', () => {
  test('nombre y carpeta conocida del archivo abierto (para guardar sobre él)', () => {
    assert.deepEqual(Guardado.archivoActual('file:///C:/Users/Ana/Downloads/formulario-13-IF-016.html'),
      { nombre: 'formulario-13-IF-016.html', carpeta: 'downloads' });
    assert.deepEqual(Guardado.archivoActual('file:///C:/Users/Ana/OneDrive/Escritorio/13-IF-016_PRUEBA%20ANA.html'),
      { nombre: '13-IF-016_PRUEBA ANA.html', carpeta: 'desktop' });
    assert.deepEqual(Guardado.archivoActual('file:///C:/Users/Ana/Documentos/form.htm'), { nombre: 'form.htm', carpeta: 'documents' });
    assert.deepEqual(Guardado.archivoActual('file:///C:/Users/Ana/Documents/SED/form.html'), { nombre: 'form.html', carpeta: null });
    assert.deepEqual(Guardado.archivoActual('http://localhost:8765/src/index.html'), { nombre: '', carpeta: null });
    assert.deepEqual(Guardado.archivoActual('file:///C:/Users/Ana/Descargas/x.pdf'), { nombre: '', carpeta: 'downloads' });
  });
});
