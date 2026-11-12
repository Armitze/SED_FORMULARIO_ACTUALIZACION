// Pruebas de src/js/firma.js (firma electrónica: huella de los datos y código de verificación del PDF).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const Firma = require('../src/js/firma.js');

const S = { primerNombre: 'ANA MARÍA', primerApellido: 'PÉREZ', numeroId: '1023456789', pensionado: 'SI', otros: '' };

describe('Firma.sha256', () => {
  test('coincide con crypto de Node (ASCII, UTF-8, vacío y varios bloques)', () => {
    for (const t of ['', 'abc', 'Ñandú — señal ✓', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(1000)]) {
      assert.equal(Firma.sha256(t), crypto.createHash('sha256').update(t, 'utf8').digest('hex'), JSON.stringify(t.slice(0, 10)));
    }
  });
});

describe('Firma', () => {
  test('la huella no depende del orden de las claves y cambia con cualquier dato', () => {
    const otro = Object.fromEntries(Object.entries(S).reverse());
    assert.equal(Firma.huella(S), Firma.huella(otro));
    assert.notEqual(Firma.huella(S), Firma.huella({ ...S, pensionado: 'NO' }));
    assert.notEqual(Firma.huella(S), Firma.huella({ ...S, otros: ' ' }));
  });

  test('firmar → vigente para esos datos; deja de valer si cambian', () => {
    const f = Firma.firmar(S, new Date(2026, 10, 11, 10, 32));
    assert.equal(Firma.vigente(f, S), true);
    assert.equal(Firma.vigente(f, { ...S, numeroId: '1023456780' }), false);
    assert.equal(Firma.vigente(null, S), false);
    assert.equal(Firma.vigente({ ...f, aceptaDatos: false }, S), false);
    assert.equal(Firma.fechaTexto(f), '11/11/2026 10:32');
    assert.match(Firma.codigo(f), /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    assert.notEqual(Firma.codigo(f), Firma.codigo(Firma.firmar(S, new Date(2026, 10, 11, 10, 33))), 'el código depende de la fecha');
  });

  test('normalizar acepta solo firmas completas y bien formadas', () => {
    const f = Firma.firmar(S);
    assert.deepEqual(Firma.normalizar(JSON.parse(JSON.stringify({ ...f, extra: 1 }))), f);
    assert.equal(Firma.normalizar(null), null);
    assert.equal(Firma.normalizar({ ...f, firmado: 'true' }), null);
    assert.equal(Firma.normalizar({ ...f, huella: 'abc' }), null);
    assert.equal(Firma.normalizar({ ...f, fecha: 'ayer' }), null);
  });
});
