// Pruebas de src/js/soportes.js (soportes adjuntos guardados dentro del HTML). El respaldo en IndexedDB y la
// interfaz se prueban en el navegador; aquí, la lectura, los límites y la validación de lo que viene del archivo.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const Soportes = require('../src/js/soportes.js');
const Guardado = require('../src/js/guardado.js');

const LIM = Soportes.limites({ soportes: { maxArchivoMb: 1, maxTotalMb: 2, maxPorTipo: 2 } });
const MB = 1024 * 1024;

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);

/** File de Node con n bytes que empiezan por la cabecera dada. */
function archivo(nombre, cabecera, n) {
  const b = new Uint8Array(n || cabecera.length);
  b.set(cabecera);
  return new File([b], nombre);
}

describe('Soportes.limites', () => {
  test('toma CONFIG.soportes y usa valores por defecto si faltan', () => {
    assert.deepEqual(LIM, { maxArchivo: MB, maxTotal: 2 * MB, maxPorTipo: 2 });
    assert.deepEqual(Soportes.limites({}), { maxArchivo: 4 * MB, maxTotal: 12 * MB, maxPorTipo: 5 });
  });
});

describe('Soportes.leer', () => {
  test('reconoce PDF, JPG y PNG por su contenido y conserva los bytes', async () => {
    const pdf = await Soportes.leer(archivo('certificación.pdf', PDF), LIM);
    assert.equal(pdf.tipo, 'application/pdf');
    assert.equal(pdf.nombre, 'certificación.pdf');
    assert.equal(pdf.bytes, PDF.length);
    assert.deepEqual(new Uint8Array(await Soportes.aBlob(pdf).arrayBuffer()), PDF);
    assert.equal((await Soportes.leer(archivo('foto.jpeg', JPG), LIM)).tipo, 'image/jpeg');
    assert.equal((await Soportes.leer(archivo('foto.PNG', PNG), LIM)).tipo, 'image/png');
  });

  test('acepta un PDF con bytes antes de %PDF- y lo grande dentro del límite', async () => {
    const conBasura = new Uint8Array([0xef, 0xbb, 0xbf, ...PDF]);
    assert.equal((await Soportes.leer(archivo('x.pdf', conBasura), LIM)).tipo, 'application/pdf');
    const grande = await Soportes.leer(archivo('grande.pdf', PDF, MB), LIM);
    assert.equal(grande.bytes, MB);
  });

  test('rechaza vacíos, otros formatos y archivos que pasan el límite', async () => {
    await assert.rejects(Soportes.leer(archivo('vacio.pdf', new Uint8Array(0)), LIM), { codigo: 'VACIO' });
    await assert.rejects(Soportes.leer(archivo('carta.docx', new TextEncoder().encode('PK\u0003\u0004')), LIM), { codigo: 'TIPO' });
    await assert.rejects(Soportes.leer(archivo('falso.pdf', new TextEncoder().encode('<html>')), LIM), { codigo: 'TIPO' }, 'la extensión no basta');
    await assert.rejects(Soportes.leer(archivo('enorme.pdf', PDF, MB + 1), LIM), (e) => e.codigo === 'GRANDE' && /1 MB/.test(e.message));
  });

  test('limpia rutas y caracteres de control del nombre', async () => {
    const item = await Soportes.leer(archivo('C:\\fakepath\\mi\u0007 cert.pdf', PDF), LIM);
    assert.equal(item.nombre, 'mi cert.pdf');
  });
});

describe('Soportes.comprobar', () => {
  test('controla la cantidad por tipo y el total', async () => {
    const a = await Soportes.leer(archivo('a.pdf', PDF, 0.9 * MB), LIM);
    const b = await Soportes.leer(archivo('b.pdf', PDF, 0.9 * MB), LIM);
    const c = await Soportes.leer(archivo('c.pdf', PDF, 0.3 * MB), LIM);
    assert.equal(Soportes.comprobar({}, 'banco', a, LIM), null);
    assert.equal(Soportes.comprobar({ banco: [a, b] }, 'banco', c, LIM).codigo, 'CANTIDAD');
    assert.equal(Soportes.comprobar({ banco: [a], dependientes: [b] }, 'hipotecario', c, LIM).codigo, 'TOTAL');
    assert.equal(Soportes.comprobar({}, 'otro', c, LIM).codigo, 'CLAVE');
    assert.equal(Soportes.totalBytes({ banco: [a], dependientes: [b] }), a.bytes + b.bytes);
    assert.equal(Soportes.cantidad({ banco: [a], dependientes: [b, c] }), 3);
  });
});

describe('Soportes.normalizar', () => {
  test('conserva lo válido y descarta claves, tipos y base64 inválidos', async () => {
    const pdf = await Soportes.leer(archivo('a.pdf', PDF), LIM);
    const png = await Soportes.leer(archivo('b.png', PNG), LIM);
    const r = Soportes.normalizar({
      banco: [pdf, { nombre: 'mal', datos: 'no es base64!' }, { nombre: 'html', tipo: 'application/pdf', datos: btoa('<script>') }],
      saludNoPos: [Object.assign({}, png, { tipo: 'text/html', bytes: 1, nombre: '../../x.png' })],
      otraCosa: [pdf],
    }, LIM);
    assert.deepEqual(Object.keys(r), ['banco', 'saludNoPos']);
    assert.equal(r.banco.length, 1);
    assert.equal(r.banco[0].datos, pdf.datos);
    assert.equal(r.saludNoPos[0].tipo, 'image/png', 'el tipo sale del contenido, no de lo guardado');
    assert.equal(r.saludNoPos[0].bytes, PNG.length, 'el tamaño se recalcula');
    assert.equal(r.saludNoPos[0].nombre, 'x.png');
    assert.deepEqual(Soportes.normalizar(null), {});
    assert.deepEqual(Soportes.normalizar([pdf]), {});
  });

  test('respeta los límites aunque el archivo traiga más', async () => {
    const grande = await Soportes.leer(archivo('g.pdf', PDF, 0.8 * MB), LIM);
    const r = Soportes.normalizar({ banco: [grande, grande, grande], dependientes: [grande] }, LIM);
    assert.equal(r.banco.length, 2, 'máximo por tipo');
    assert.equal(r.dependientes, undefined, 'el total pasaría de 2 MB');
  });
});

describe('Soportes dentro del HTML', () => {
  test('van y vuelven por el bloque de datos de guardado.js', async () => {
    const base = '<!DOCTYPE html>\n<html><body><script type="application/json" id="datos-formulario"></script></body></html>';
    const pdf = await Soportes.leer(archivo('cert.pdf', PDF, 5000), LIM);
    const html = Guardado.html({ id: 'f1', s: { nit: '1' }, soportes: { banco: [pdf] } }, base);
    const json = /id="datos-formulario">([\s\S]*?)<\/script>/.exec(html)[1];
    const r = Soportes.normalizar(JSON.parse(json).soportes, LIM);
    assert.deepEqual(new Uint8Array(await Soportes.aBlob(r.banco[0]).arrayBuffer()), new Uint8Array(await Soportes.aBlob(pdf).arrayBuffer()));
  });
});

describe('Soportes.tamanoTexto', () => {
  test('B, KB y MB en español', () => {
    assert.equal(Soportes.tamanoTexto(500), '500 B');
    assert.equal(Soportes.tamanoTexto(230 * 1024), '230 KB');
    assert.equal(Soportes.tamanoTexto(1.5 * MB), '1,5 MB');
  });
});
