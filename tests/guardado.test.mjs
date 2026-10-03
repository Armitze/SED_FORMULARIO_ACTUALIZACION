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
