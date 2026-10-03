// Pruebas de window.RutParser (src/js/parser-rut.js).
//
//   node --test tests/parser-rut.test.mjs
//   ACTUALIZAR_DORADOS=1 node --test tests/parser-rut.test.mjs   (reescribe tests/fixtures/rut-*.esperado.json)
//
// 1. dvNit, esRut y contrato del Resultado (ids de SCHEMA, valores de CATALOGOS).
// 2. Fixtures (tests/fixtures/rut-*.json, items crudos de pdf.js por página): copias reales de RUT de personas
//    naturales ANONIMIZADAS (todo dato personal es ficticio y el NIT ficticio tiene DV válido), una persona
//    jurídica pública (UNAL 2016), la plantilla en blanco de la DIAN y un paquete SINTÉTICO (hoja de vida,
//    página escaneada, RUT de empresa, RUT de persona, Hoja 5 con un contador ficticio y texto basura).
//    Se comparan con salidas doradas (rut-*.esperado.json) y con aserciones explícitas.
// 3. Variantes en memoria: flujo desordenado, DV errado, NIT ≠ cédula, tipos de documento fuera del
//    catálogo, CIIU especial, responsabilidades (47, 48+49, ninguna, inactivas, casillas ≠ lista), fechas.
//    3b. Regresiones de la verificación adversarial: teléfonos por tipo (fijo/celular), C3 según la antigüedad,
//    formatos inválidos omitidos, desplazamiento/escala, líneas base desalineadas, columnas con etiquetas ausentes,
//    partidas o pegadas, NIT+DV pegados, caracteres invisibles, Doc vacío y entradas enormes.
// 4. Muestras reales (opcional): lee cada PDF de la carpeta de investigación (o de SAMPLES_DIR) si existe y
//    solo verifica invariantes; NUNCA valores personales.
// Todos los datos escritos en este archivo son ficticios o de documentos públicos.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(RAIZ, 'tests', 'fixtures');
const DIR_MUESTRAS = process.env.SAMPLES_DIR ||
  'C:/Users/Usuario/AppData/Local/Temp/claude/C--Users-Usuario-Documents-GitHub-SED-FORMULARIO-ACTUALIZACION/0393eb11-c794-47b2-a31e-d8758fa9c236/scratchpad/research/samples';
const ACTUALIZAR = process.env.ACTUALIZAR_DORADOS === '1';

globalThis.window = globalThis;
require(path.join(RAIZ, 'src/js/catalogos.js'));
require(path.join(RAIZ, 'src/js/schema.js'));
const PdfText = require(path.join(RAIZ, 'src/js/pdftext.js'));
const RutParser = require(path.join(RAIZ, 'src/js/parser-rut.js'));
const RitParser = require(path.join(RAIZ, 'src/js/parser-rit.js'));
const { CATALOGOS, SCHEMA } = globalThis;

const HOY = '2026-10-01';
const CONFIANZAS = ['alta', 'media', 'baja'];
const NOMBRE_VALIDO = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .'-]*$/;
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CAMPOS_NOMBRE = ['primerApellido', 'segundoApellido', 'primerNombre', 'otrosNombres'];
/** Teléfono 1 cuando el RUT solo trae celulares: 0, como pide el instructivo del formato. */
const TELEFONO1_CERO = { valor: '0', origen: 'Casilla 44/45 (sin teléfono fijo)', confianza: 'media', etiqueta: '0 — tu RUT no registra teléfono fijo' };
const AVISO_SIN_FIJO = 'Tu RUT no registra teléfono fijo; dejamos 0 en Teléfono 1 como indica el formato. Cámbialo si tienes uno.';

// ---------------------------------------------------------------- utilidades

const leerFixture = (nombre) => JSON.parse(fs.readFileSync(path.join(FIXTURES, nombre + '.json'), 'utf8'));
const clonar = (o) => JSON.parse(JSON.stringify(o));
const plano = (o) => JSON.parse(JSON.stringify(o)); // como queda en el JSON dorado

/** Cargador mínimo: fixture { info, paginas: [{ numero, ancho, alto, crudos }] } → Doc de PdfText, sin pdf.js. */
const docDe = (fx) => PdfText.armarDoc(fx.paginas, fx.info, { tolerante: true });
const parsear = (fx, opts) => RutParser.parse(docDe(fx), Object.assign({ hoy: HOY }, opts));

const valor = (r, k) => (r.campos[k] ? r.campos[k].valor : undefined);
const tieneAviso = (r, re) => r.avisos.some((a) => re.test(a));

/** Items crudos (de una página) en la posición (x, y) ± 0.6 pt, opcionalmente con ese str. */
function buscarCrudos(fx, x, y, str, numero) {
  const out = [];
  for (const p of fx.paginas) {
    if (numero != null && p.numero !== numero) continue;
    for (const c of p.crudos) {
      if (Math.abs(c.transform[4] - x) < 0.6 && Math.abs(c.transform[5] - y) < 0.6 && c.str.trim() !== '' &&
        (str == null || c.str === str)) out.push(c);
    }
  }
  return out;
}

/** Cambia el str del ÚNICO item crudo con texto en (x, y) (y ajusta el ancho si cambia la longitud). */
function editar(fx, x, y, nuevo, str) {
  const l = buscarCrudos(fx, x, y, str);
  assert.equal(l.length, 1, `se esperaba un item en (${x}, ${y})`);
  const c = l[0];
  const n = typeof nuevo === 'function' ? nuevo(c.str) : nuevo;
  c.width = (c.width / Math.max(1, c.str.length)) * n.length;
  c.str = n;
  return fx;
}

function quitar(fx, x, y, str) {
  const l = buscarCrudos(fx, x, y, str);
  assert.ok(l.length >= 1, `no hay item en (${x}, ${y})`);
  for (const p of fx.paginas) p.crudos = p.crudos.filter((c) => !l.includes(c));
  return fx;
}

/** Item crudo con la forma de pdf.js. */
function crudo(str, x, y, w, h = 8) {
  return { str, width: w == null ? str.length * 4.4 : w, height: h, transform: [h, 0, 0, h, x, y], fontName: 'g_d0_f1', hasEOL: false };
}

function agregar(fx, ...items) {
  fx.paginas[0].crudos.push(...items);
  return fx;
}

/** Números pseudoaleatorios deterministas en [0, 1) (mulberry32). */
function aleatorio(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Barajado determinista. */
function barajar(lista, semilla) {
  const rnd = aleatorio(semilla);
  const l = lista.slice();
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [l[i], l[j]] = [l[j], l[i]];
  }
  return l;
}

/** DV DIAN implementado aparte (referencia independiente para comparar con RutParser.dvNit). */
function dvReferencia(nit) {
  const pesos = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3];
  const d = String(nit).padStart(15, '0');
  let s = 0;
  for (let i = 0; i < 15; i++) s += Number(d[i]) * pesos[i];
  const r = s % 11;
  return String(r >= 2 ? 11 - r : r);
}

/** Contrato del Resultado: ids del esquema con fuente RUT, valores de catálogo, confianza y origen. */
function verificarContrato(r) {
  assert.equal(r.tipo, 'RUT');
  assert.equal(typeof r.ok, 'boolean');
  assert.ok(r.extra && typeof r.extra === 'object');
  assert.ok(Array.isArray(r.avisos) && r.avisos.every((a) => typeof a === 'string' && a.length > 10));
  for (const [id, c] of Object.entries(r.campos)) {
    const def = SCHEMA.fields[id];
    assert.ok(def, `campo ${id} no existe en SCHEMA`);
    assert.equal(def.fuente, 'RUT', `campo ${id} no es de fuente RUT`);
    assert.equal(typeof c.valor, 'string');
    assert.ok(c.valor.length > 0, `campo ${id} vacío`);
    assert.ok(CONFIANZAS.includes(c.confianza), `confianza de ${id}`);
    assert.ok(typeof c.origen === 'string' && /^Casilla \d+/.test(c.origen), `origen de ${id}`);
    if (c.etiqueta !== undefined) assert.equal(typeof c.etiqueta, 'string');
  }
  const C = r.campos;
  if (C.nit) assert.match(C.nit.valor, /^\d{4,10}$/);
  if (C.dv) assert.match(C.dv.valor, /^\d$/);
  if (C.numeroId) assert.match(C.numeroId.valor, /^\d{1,10}$/);
  if (C.tipoDocumento) assert.ok(CATALOGOS.tiposDocumento.some((t) => t.nombre === C.tipoDocumento.valor));
  if (C.pais) assert.ok(CATALOGOS.paises.some((p) => p.nombre === C.pais.valor));
  if (C.departamento) assert.ok(CATALOGOS.departamentos.some((d) => d.nombre === C.departamento.valor));
  if (C.municipio) {
    const dep = CATALOGOS.departamentos.find((d) => d.nombre === (C.departamento && C.departamento.valor));
    assert.ok(dep && CATALOGOS.municipios.some((m) => m.codDepto === dep.codigo && m.nombre === C.municipio.valor));
  }
  if (C.email) {
    assert.match(C.email.valor, CORREO_VALIDO);
    assert.equal(C.email.valor, C.email.valor.toLowerCase());
  }
  // telefono1 = fijo (10 dígitos 60X o 7 de la numeración anterior) o '0' si el RUT solo trae celulares;
  // telefono2 = celular (instructivo del Excel).
  if (C.telefono1 && C.telefono1.valor === '0') {
    assert.deepEqual(C.telefono1, TELEFONO1_CERO);
    assert.ok(r.extra.telefonos.length > 0 && r.extra.telefonos.every((t) => t.tipo === 'celular'), 'solo celulares leídos');
  } else if (C.telefono1) {
    assert.match(C.telefono1.valor, /^(60\d{8}|\d{7})$/);
    assert.match(C.telefono1.origen, /^Casilla 4[45]$/);
  }
  if (C.telefono2) assert.match(C.telefono2.valor, /^3\d{9}$/);
  if (C.telefono2) assert.match(C.telefono2.origen, /^Casilla 4[45]$/);
  if (C.actividadRut) {
    assert.match(C.actividadRut.valor, /^\d{4}$/);
    if (C.actividadRut.confianza === 'alta') assert.ok(CATALOGOS.ciiu.some((x) => x.codigo === C.actividadRut.valor));
  }
  if (C.regimenIva) assert.ok(CATALOGOS.regimenIva.some((x) => x.nombre === C.regimenIva.valor));
  if (C.c3) assert.ok(['SI', 'NO'].includes(C.c3.valor));
  for (const k of CAMPOS_NOMBRE) if (C[k]) assert.match(C[k].valor, /^\S+( \S+)*$/);
  // Un RUT de persona jurídica no llena nada.
  if (r.extra.esPersonaJuridica) {
    assert.equal(r.ok, false);
    assert.deepEqual(r.campos, {});
  }
  // Nada de caracteres de control ni invisibles en ningún texto de la salida (JSON.stringify los escaparía).
  for (const s of textos(r)) assert.ok(!INVISIBLES.test(s), `carácter invisible en ${JSON.stringify(s)}`);
}

/** Caracteres de control (salvo \n) e invisibles (ancho cero, guion suave, BOM). */
const INVISIBLES = new RegExp('[' + [[0x00, 0x09], [0x0b, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2060, 0x2064], [0xfeff, 0xfeff]]
  .map((r) => r.map((c) => String.fromCharCode(c)).join('-')).join('') + ']');

/** Todos los strings de un objeto (recursivo). */
function textos(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => textos(x, out));
  else if (o && typeof o === 'object') Object.values(o).forEach((x) => textos(x, out));
  return out;
}

// ---------------------------------------------------------------- 1. utilidades y detección

describe('dvNit', () => {
  test('coincide con el DV impreso en RUT públicos y con una implementación independiente', () => {
    assert.equal(RutParser.dvNit('899999063'), '3'); // Universidad Nacional (fixture público)
    assert.equal(RutParser.dvNit('890210581'), '8'); // Área Metropolitana de Bucaramanga (RUT público)
    for (const n of ['12345678', '87654321', '11223344', '1234567890', '98765432', '9', '900000001', '1000000000']) {
      assert.equal(RutParser.dvNit(n), dvReferencia(n), n);
    }
  });
  test('ignora separadores y devuelve vacío sin dígitos', () => {
    assert.equal(RutParser.dvNit('899.999.063'), '3');
    assert.equal(RutParser.dvNit(''), '');
    assert.equal(RutParser.dvNit(null), '');
  });
});

describe('esRut', () => {
  test('reconoce los fixtures del RUT (incluida la plantilla en blanco y el paquete)', () => {
    for (const n of ['rut-pn-2021-formato2019', 'rut-pn-2024-nit10', 'rut-pn-2025-reprocesado', 'rut-pn-2025-original',
      'rut-pj-2016-unal', 'rut-plantilla-en-blanco', 'rut-paquete-sintetico', 'rut-pn-2026-anon']) {
      assert.equal(RutParser.esRut(docDe(leerFixture(n))), true, n);
    }
  });
  test('no confunde otros documentos', () => {
    const paquete = leerFixture('rut-paquete-sintetico');
    const soloHv = { info: {}, paginas: [paquete.paginas[0], paquete.paginas[1], paquete.paginas[5]] };
    assert.equal(RutParser.esRut(docDe(soloHv)), false);
    assert.equal(RutParser.esRut({ paginas: [] }), false);
    assert.equal(RutParser.esRut(null), false);
  });
  test('acepta páginas con solo items crudos (sin items/lineas normalizados)', () => {
    const fx = leerFixture('rut-pn-2025-original');
    assert.equal(RutParser.esRut({ paginas: [{ numero: 1, crudos: fx.paginas[0].crudos }] }), true);
  });
});

// ---------------------------------------------------------------- 2. fixtures: doradas

const DORADOS = [
  { nombre: 'rut-pn-2021-formato2019' },
  { nombre: 'rut-pn-2024-nit10' },
  { nombre: 'rut-pn-2025-reprocesado' },
  { nombre: 'rut-pn-2025-original' },
  { nombre: 'rut-pj-2016-unal' },
  { nombre: 'rut-plantilla-en-blanco' },
  { nombre: 'rut-paquete-sintetico' },
  { nombre: 'rut-pn-2026-anon' },
];

describe('fixtures: salida dorada', () => {
  for (const { nombre, opts } of DORADOS) {
    test(nombre, () => {
      const r = parsear(leerFixture(nombre), opts);
      verificarContrato(r);
      const archivo = path.join(FIXTURES, nombre + '.esperado.json');
      if (ACTUALIZAR) {
        fs.writeFileSync(archivo, JSON.stringify(r, null, 2) + '\n');
        return;
      }
      assert.ok(fs.existsSync(archivo), 'falta ' + archivo + ' (corre con ACTUALIZAR_DORADOS=1)');
      assert.deepEqual(plano(r), JSON.parse(fs.readFileSync(archivo, 'utf8')));
    });
  }
});

// ---------------------------------------------------------------- 2b. fixtures: aserciones explícitas

describe('fixtures: valores esperados', () => {
  test('persona natural, formato 2019-2023 (anonimizado)', () => {
    const r = parsear(leerFixture('rut-pn-2021-formato2019'));
    assert.equal(r.ok, true);
    assert.deepEqual(Object.fromEntries(Object.entries(r.campos).map(([k, c]) => [k, c.valor])), {
      nit: '87654321', dv: RutParser.dvNit('87654321'), tipoDocumento: 'Cédula de ciudadanía ', numeroId: '87654321',
      primerApellido: 'FICTICIO', segundoApellido: 'DE LA PRUEBA', primerNombre: 'JUAN', otrosNombres: 'CARLOS',
      direccion: 'KR 15 20 35 AP 101 BRR EL EJEMPLO', pais: 'COLOMBIA', departamento: 'Antioquia', municipio: 'MEDELLÍN',
      email: 'juan.ficticio@example.org', telefono1: '2345678', telefono2: '3109876543', actividadRut: '8513',
      regimenIva: 'NO RESPONSABLE IVA', c3: 'NO',
    });
    assert.equal(r.campos.tipoDocumento.etiqueta, 'Cédula de ciudadanía');
    assert.match(r.campos.actividadRut.etiqueta, /^8513 — /);
    assert.equal(r.campos.telefono1.confianza, 'media');
    assert.equal(r.campos.telefono1.origen, 'Casilla 44');
    assert.equal(r.campos.telefono2.origen, 'Casilla 45');
    assert.ok(tieneAviso(r, /teléfono fijo de tu RUT \(casilla 44\) tiene 7 dígitos.*604/), 'indicativo de Antioquia');
    assert.ok(tieneAviso(r, /verifica que tu RUT esté actualizado/i));
    // Generado hace más de un año: la casilla 53 puede haber cambiado.
    assert.equal(r.campos.c3.confianza, 'media');
    assert.equal(r.campos.regimenIva.confianza, 'media');
    const e = r.extra;
    assert.deepEqual(e.responsabilidades.map((x) => x.codigo), ['05', '49']);
    assert.equal(e.responsabilidades[1].descripcion, 'No responsable de IVA');
    assert.equal(e.responsabilidadesConfiables, true);
    assert.deepEqual(e.sugerencias, { declaranteRenta: true, regimenSimple: false });
    assert.equal(e.esPersonaNatural, true);
    assert.equal(e.esPersonaJuridica, false);
    assert.equal(e.nombreCompleto, 'FICTICIO DE LA PRUEBA JUAN CARLOS');
    assert.equal(e.fechaGeneracion, '2021-03-15');
    assert.equal(e.horaGeneracion, '22:20:30');
    assert.equal(e.fecha61, '2020-06-15');
    assert.equal(e.fechaExpedicion, '1995-06-20');
    assert.deepEqual(e.lugarExpedicion, { pais: 'COLOMBIA', departamento: 'Antioquia', municipio: 'MEDELLÍN', codigoPais: '169', codigoDepartamento: '05', codigoMunicipio: '001' });
    assert.equal(e.ubicacion.codigoDane, '05001');
    assert.equal(e.actividades.principal.codigo, '8513');
    assert.equal(e.actividades.principal.fechaInicio, '2015-04-01');
    assert.equal(e.tipoContribuyente.codigo, '2');
    assert.equal(e.paginas.principal, 1);
  });

  test('persona natural, formato 2024 con NIT de 10 dígitos y una sola responsabilidad', () => {
    const r = parsear(leerFixture('rut-pn-2024-nit10'));
    assert.equal(valor(r, 'nit'), '1234567890');
    assert.equal(valor(r, 'dv'), RutParser.dvNit('1234567890'));
    assert.equal(valor(r, 'numeroId'), '1234567890');
    assert.deepEqual(CAMPOS_NOMBRE.map((k) => valor(r, k)), ['DEMO', 'ANONIMO', 'PEDRO', 'PABLO']);
    assert.equal(valor(r, 'departamento'), 'Santander');
    assert.equal(valor(r, 'municipio'), 'BUCARAMANGA');
    // El único teléfono es un celular en la casilla 44: va a «Teléfono 2 (celular)» y «Teléfono 1» queda en 0.
    assert.deepEqual(r.campos.telefono1, TELEFONO1_CERO);
    assert.equal(valor(r, 'telefono2'), '3201112233');
    assert.equal(r.campos.telefono2.origen, 'Casilla 44');
    assert.ok(r.avisos.includes(AVISO_SIN_FIJO));
    assert.ok(!tieneAviso(r, /no trae un teléfono fijo/));
    assert.deepEqual(r.extra.telefonos, [{ casilla: 44, numero: '3201112233', tipo: 'celular' }]);
    assert.deepEqual(r.extra.responsabilidades.map((x) => x.codigo), ['49']);
    assert.equal(valor(r, 'regimenIva'), 'NO RESPONSABLE IVA');
    assert.equal(r.campos.regimenIva.confianza, 'media', 'generado en 2024: más de un año');
    assert.equal(valor(r, 'c3'), 'NO');
  });

  test('persona natural, copia re-procesada (etiquetas y valores partidos)', () => {
    const r = parsear(leerFixture('rut-pn-2025-reprocesado'));
    assert.equal(r.ok, true);
    assert.equal(valor(r, 'nit'), '11223344');
    assert.equal(valor(r, 'numeroId'), '11223344');
    assert.equal(r.campos.dv.confianza, 'alta');
    assert.deepEqual(CAMPOS_NOMBRE.map((k) => valor(r, k)), ['MUESTRA', 'SINTETICA', 'LAURA', 'VALENTINA']);
    assert.equal(valor(r, 'direccion'), 'CL 100 15 20');
    assert.equal(valor(r, 'departamento'), 'Valle del Cauca');
    assert.equal(valor(r, 'municipio'), 'CALI');
    // Dos celulares: el de la casilla 44 va a «Teléfono 2 (celular)»; ninguno es fijo → «Teléfono 1» = 0.
    assert.deepEqual(r.campos.telefono1, TELEFONO1_CERO);
    assert.equal(valor(r, 'telefono2'), '3012223344');
    assert.deepEqual(r.extra.telefonos.map((t) => [t.casilla, t.numero, t.tipo]),
      [[44, '3012223344', 'celular'], [45, '3023334455', 'celular']]);
    assert.deepEqual(r.extra.responsabilidades.map((x) => x.codigo), ['22', '49']);
    assert.equal(r.extra.responsabilidadesConfiables, true);
    assert.equal(r.extra.fechaGeneracion, '2025-06-21');
    assert.equal(r.extra.fecha61, '2024-07-07');
    assert.deepEqual(r.extra.concepto, { codigo: '13', descripcion: 'Actualización de oficio' });
  });

  test('persona natural, formato 2025 original y reciente: solo el aviso del teléfono fijo (Teléfono 1 = 0)', () => {
    const r = parsear(leerFixture('rut-pn-2025-original'));
    assert.equal(r.ok, true);
    assert.deepEqual(r.avisos, [AVISO_SIN_FIJO]);
    assert.equal(valor(r, 'telefono2'), '3004445566');
    assert.deepEqual(r.campos.telefono1, TELEFONO1_CERO);
    assert.deepEqual(r.extra.responsabilidades.map((x) => x.codigo), ['05', '22', '49', '52']);
    assert.equal(valor(r, 'actividadRut'), '6920');
    assert.equal(r.extra.fechaGeneracion, '2026-08-10');
    assert.equal(r.extra.fechaExpedicion, '');
    assert.ok(Object.entries(r.campos).every(([k, c]) => c.confianza === (k === 'telefono1' ? 'media' : 'alta')));
  });

  test('persona jurídica (formato 2013-2016): ok:false, ningún campo y sus datos solo en extra', () => {
    const r = parsear(leerFixture('rut-pj-2016-unal'));
    assert.equal(r.ok, false);
    assert.deepEqual(r.campos, {});
    assert.equal(r.avisos.length, 1, 'solo el aviso de persona jurídica');
    assert.match(r.avisos[0], /persona jurídica.*no tomamos ningún dato/);
    assert.equal(r.extra.esPersonaJuridica, true);
    assert.equal(r.extra.razonSocial, 'UNIVERSIDAD NACIONAL DE COLOMBIA');
    assert.equal(r.extra.sigla, 'U.N.');
    const pj = Object.fromEntries(Object.entries(r.extra.datosPersonaJuridica).map(([k, c]) => [k, c.valor]));
    assert.equal(pj.nit, '899999063');
    assert.equal(pj.dv, '3');
    assert.equal(pj.direccion, 'CR 45 26 85 OF 481 ED URIEL GUTIERREZ');
    assert.equal(pj.email, 'divnacc_nal@unal.edu.co');
    assert.equal(pj.municipio, 'BOGOTÁ');
    assert.equal(pj.actividadRut, '8544');
    assert.equal(pj.c3, undefined, 'el Régimen SIMPLE de una empresa no aplica');
    for (const k of [...CAMPOS_NOMBRE, 'tipoDocumento', 'numeroId']) assert.equal(pj[k], undefined, k);
    assert.ok(Object.values(r.extra.datosPersonaJuridica).every((c) => c.confianza === 'baja'));
    assert.deepEqual(r.extra.responsabilidades.map((x) => x.codigo), ['06', '07', '08', '09', '10', '13', '14', '42']);
    assert.equal(r.extra.responsabilidadesConfiables, true);
    assert.equal(r.extra.ubicacion.codigoPostalEsApartadoAereo, true);
    assert.equal(r.extra.fecha61, '2016-06-24');
    assert.equal(r.extra.concepto.descripcion, 'Actualización de oficio');
    assert.deepEqual(r.extra.seccional, { codigo: '31', nombre: 'Impuestos de Grandes Contribuyentes' });
    assert.equal(r.extra.actividades.numeroEstablecimientos, '13');
  });

  test('plantilla en blanco de la DIAN → ok:false sin campos', () => {
    const r = parsear(leerFixture('rut-plantilla-en-blanco'));
    assert.equal(r.ok, false);
    assert.deepEqual(r.campos, {});
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0], /sin diligenciar/);
  });
});

describe('persona natural real 2026 (rut-pn-2026-anon, anonimizado)', () => {
  const fx = leerFixture('rut-pn-2026-anon');
  const r = parsear(fx);
  const NIT = '1019283754'; // ficticio, el mismo del fixture rit-pn-2026-anon

  test('todos los campos de persona natural, con la cédula ficticia y su DV válido', () => {
    assert.equal(RutParser.esRut(docDe(fx)), true);
    assert.equal(r.ok, true);
    verificarContrato(r);
    assert.deepEqual(Object.fromEntries(Object.entries(r.campos).map(([k, c]) => [k, c.valor])), {
      nit: NIT, dv: '9', tipoDocumento: 'Cédula de ciudadanía ', numeroId: NIT,
      primerApellido: 'FALSO', segundoApellido: 'MODELO', primerNombre: 'ANDRES', otrosNombres: 'JULIAN',
      direccion: 'CL 98 SUR 45 67', pais: 'COLOMBIA', departamento: 'Bogotá D.C', municipio: 'BOGOTÁ',
      email: 'ajfalso@example.com', telefono2: '3216549870', telefono1: '0', actividadRut: '6920',
      regimenIva: 'NO RESPONSABLE IVA', c3: 'NO',
    });
    assert.equal(RutParser.dvNit(NIT), '9');
    assert.equal(r.extra.nitIgualCedula, true);
    assert.equal(r.extra.nombreCompleto, 'FALSO MODELO ANDRES JULIAN');
  });

  test('teléfonos: el único celular (casilla 44) va a Teléfono 2 y Teléfono 1 queda en 0, con un solo aviso', () => {
    assert.deepEqual(r.campos.telefono2, { valor: '3216549870', origen: 'Casilla 44', confianza: 'alta' });
    assert.deepEqual(r.campos.telefono1, TELEFONO1_CERO);
    assert.deepEqual(r.extra.telefonos, [{ casilla: 44, numero: '3216549870', tipo: 'celular' }]);
    assert.deepEqual(r.avisos, [AVISO_SIN_FIJO]);
  });

  test('responsabilidades 05/22/49/52 → No responsable de IVA y C3 = NO (sin 47), confianza alta', () => {
    assert.deepEqual(r.extra.responsabilidades.map((x) => x.codigo), ['05', '22', '49', '52']);
    assert.equal(r.extra.responsabilidadesConfiables, true);
    assert.deepEqual([r.campos.regimenIva.valor, r.campos.regimenIva.origen, r.campos.regimenIva.confianza],
      ['NO RESPONSABLE IVA', 'Casilla 53 (código 49)', 'alta']);
    assert.deepEqual([r.campos.c3.valor, r.campos.c3.confianza], ['NO', 'alta']);
    assert.deepEqual(r.extra.sugerencias, { declaranteRenta: true, regimenSimple: false });
  });

  test('CIIU 6920 → actividades ICA candidatas 69201 y 69202 (la del RIT es 69201)', () => {
    assert.deepEqual([r.campos.actividadRut.valor, r.campos.actividadRut.confianza], ['6920', 'alta']);
    assert.match(r.campos.actividadRut.etiqueta, /^6920 — Actividades de contabilidad, teneduría de libros/);
    assert.deepEqual(RitParser.candidatosDesdeCiiu('6920').map((c) => c.codigo), ['69201', '69202']);
  });

  test('fechas, concepto y número de formulario (ficticio) en extra', () => {
    assert.equal(r.extra.fechaGeneracion, '2026-03-16');
    assert.equal(r.extra.fecha61, '2026-03-16');
    assert.deepEqual(r.extra.concepto, { codigo: '02', descripcion: 'Actualización' });
    assert.equal(r.extra.numeroFormulario, '141299990001');
    assert.equal(r.extra.ubicacion.codigoDane, '11001');
    assert.equal(r.extra.esPersonaNatural, true);
  });

  test('la cédula ficticia es la misma del certificado RIT anonimizado', () => {
    const rit = leerFixture('rit-pn-2026-anon');
    assert.ok(rit.pages[0].items.some((it) => it.str === NIT));
  });
});

// ---------------------------------------------------------------- 2c. paquete sintético

describe('paquete sintético (varias páginas, terceros)', () => {
  const PROHIBIDOS = ['CONTADORA', 'FICTICIA', 'LUISA', 'FERNANDA', '98765432', 'OTRA', 'DISTINTA', '1098765432', 'otra.persona'];
  const sinTerceros = (r) => {
    const t = JSON.stringify(r);
    for (const p of PROHIBIDOS) assert.ok(!t.includes(p), `se filtró un dato de un tercero (${p})`);
  };

  test('sin documento esperado: usa la hoja principal de la persona natural (no la de la empresa)', () => {
    const r = parsear(leerFixture('rut-paquete-sintetico'));
    assert.equal(r.ok, true);
    sinTerceros(r);
    assert.equal(r.extra.paginas.principal, 4);
    assert.equal(r.extra.paginas.total, 6);
    assert.deepEqual(r.extra.paginas.rut, [{ pagina: 3, hoja: 1 }, { pagina: 4, hoja: 1 }, { pagina: 5, hoja: 5 }]);
    assert.deepEqual(CAMPOS_NOMBRE.map((k) => valor(r, k)), ['PRUEBA', 'EJEMPLO', 'ANA', 'ISABEL']);
    assert.equal(valor(r, 'nit'), '12345678');
    assert.ok(tieneAviso(r, /trae 2 RUT de personas distintas; usamos el de la página 4\./));
    assert.ok(!tieneAviso(r, /persona jurídica/));
  });

  test('documento esperado = NIT de la empresa → usa esa hoja y avisa que es persona jurídica', () => {
    const r = parsear(leerFixture('rut-paquete-sintetico'), { documentoEsperado: '899.999.063' });
    sinTerceros(r);
    assert.equal(r.extra.paginas.principal, 3);
    assert.equal(r.extra.coincideDocumentoEsperado, true);
    assert.equal(r.ok, false);
    assert.deepEqual(r.campos, {});
    assert.match(r.avisos[0], /persona jurídica/);
    assert.ok(tieneAviso(r, /que coincide con el número que ya está en el formulario/));
  });

  test('documento esperado = cédula de la persona (también con el DV pegado) → sin aviso de documento', () => {
    for (const doc of ['12345678', '12345678-' + RutParser.dvNit('12345678')]) {
      const r = parsear(leerFixture('rut-paquete-sintetico'), { documentoEsperado: doc });
      assert.equal(r.extra.paginas.principal, 4, doc);
      assert.equal(r.extra.coincideDocumentoEsperado, true);
      assert.ok(!tieneAviso(r, /no coincide con el número que ya está en el formulario/));
    }
  });

  test('documento esperado = cédula del contador (Hoja 5) → nunca toma sus datos', () => {
    const r = parsear(leerFixture('rut-paquete-sintetico'), { documentoEsperado: '98765432' });
    assert.equal(r.extra.paginas.principal, 4);
    assert.equal(r.extra.coincideDocumentoEsperado, false);
    assert.match(r.avisos[0], /no coincide con el número que ya está en el formulario \(98765432\)/);
    const t = JSON.stringify(r.campos) + JSON.stringify(r.extra);
    for (const p of ['CONTADORA', 'FICTICIA', 'LUISA', 'FERNANDA', 'OTRA', 'DISTINTA']) assert.ok(!t.includes(p), p);
  });

  test('páginas sueltas: Hoja 5 sola, hoja de vida, escaneada y texto basura → ok:false con el motivo', () => {
    const fx = leerFixture('rut-paquete-sintetico');
    const solo = (i) => ({ info: {}, paginas: [fx.paginas[i]] });
    let r = parsear(solo(4));
    assert.equal(r.ok, false);
    assert.match(r.avisos[0], /no la hoja principal/);
    sinTerceros(r);
    r = parsear(solo(0));
    assert.equal(r.ok, false);
    assert.match(r.avisos[0], /No encontramos un RUT/);
    r = parsear(solo(1));
    assert.equal(r.ok, false);
    assert.match(r.avisos[0], /imagen/);
    r = parsear(solo(5));
    assert.equal(r.ok, false);
    assert.match(r.avisos[0], /imprime como PDF/);
    for (const x of [null, undefined, {}, { paginas: null }]) {
      r = RutParser.parse(x);
      assert.equal(r.ok, false);
      assert.equal(r.avisos.length, 1);
    }
  });

  test('dos RUT de personas naturales: el más reciente, o el del documento esperado', () => {
    const a = leerFixture('rut-pn-2021-formato2019');
    const b = leerFixture('rut-pn-2024-nit10');
    const fx = { info: {}, paginas: [Object.assign(a.paginas[0], { numero: 1 }), Object.assign(b.paginas[0], { numero: 2 })] };
    let r = parsear(fx);
    assert.equal(r.extra.paginas.principal, 2, 'generado en 2024 (más reciente)');
    assert.ok(tieneAviso(r, /trae 2 RUT/));
    r = parsear(fx, { documentoEsperado: '87654321' });
    assert.equal(r.extra.paginas.principal, 1);
    assert.equal(valor(r, 'primerApellido'), 'FICTICIO');
    // La misma hoja dos veces no es "otra persona".
    r = parsear({ info: {}, paginas: [clonar(a.paginas[0]), Object.assign(clonar(a.paginas[0]), { numero: 2 })] });
    assert.ok(!tieneAviso(r, /trae 2 RUT/));
    assert.equal(r.extra.paginas.principal, 1);
  });
});

// ---------------------------------------------------------------- 3. variantes en memoria

describe('robustez del flujo de texto', () => {
  for (const nombre of ['rut-pn-2021-formato2019', 'rut-pn-2025-reprocesado', 'rut-pj-2016-unal', 'rut-paquete-sintetico']) {
    test(`${nombre}: el orden de los items no cambia el resultado`, () => {
      const fx = leerFixture(nombre);
      const base = parsear(fx);
      for (const semilla of [1, 7, 2026]) {
        const b = clonar(fx);
        for (const p of b.paginas) p.crudos = barajar(p.crudos, semilla);
        assert.deepEqual(parsear(b), base, `semilla ${semilla}`);
      }
      const sinVacios = clonar(fx);
      for (const p of sinVacios.paginas) p.crudos = p.crudos.filter((c) => c.str.trim() !== '');
      assert.deepEqual(parsear(sinVacios), base, 'sin items vacíos');
    });
  }
  test('páginas con solo crudos (sin pasar por armarDoc) dan lo mismo', () => {
    const fx = leerFixture('rut-pn-2025-original');
    const r = RutParser.parse({ paginas: fx.paginas.map((p) => ({ numero: p.numero, crudos: p.crudos })) }, { hoy: HOY });
    assert.deepEqual(r, parsear(fx));
  });
});

describe('validaciones (variantes en memoria del fixture 2019-2023)', () => {
  const base = () => leerFixture('rut-pn-2021-formato2019');

  test('DV impreso distinto al calculado → confianza baja y aviso', () => {
    const malo = String((Number(RutParser.dvNit('87654321')) + 1) % 10);
    const r = parsear(editar(base(), 192.5, 603.5, malo));
    assert.equal(valor(r, 'dv'), malo);
    assert.equal(r.campos.dv.confianza, 'baja');
    assert.equal(r.campos.nit.confianza, 'baja');
    assert.equal(r.extra.dvCalculado, RutParser.dvNit('87654321'));
    assert.ok(tieneAviso(r, /dígito de verificación \(DV\) impreso en el RUT \(\d\) no coincide/));
  });

  test('DV ausente → sin campo dv y aviso con el DV calculado', () => {
    const r = parsear(quitar(base(), 192.5, 603.5));
    assert.equal(r.campos.dv, undefined);
    assert.equal(r.campos.nit.confianza, 'media');
    assert.ok(tieneAviso(r, new RegExp(`debería ser ${RutParser.dvNit('87654321')}`)));
  });

  test('cédula distinta del NIT → confianza baja y aviso', () => {
    const r = parsear(editar(base(), 337.3, 569.5, '8 7 6 5 4 3 2 9'));
    assert.equal(valor(r, 'numeroId'), '87654329');
    assert.equal(r.campos.numeroId.confianza, 'baja');
    // No se sabe cuál de los dos está mal leído: el NIT (y su DV) también quedan por verificar.
    assert.equal(r.campos.nit.confianza, 'baja');
    assert.equal(r.campos.dv.confianza, 'baja');
    assert.equal(r.extra.nitIgualCedula, false);
    assert.ok(tieneAviso(r, /NIT \(casilla 5\) y el número de identificación \(casilla 26\) no coinciden/));
  });

  test('tipo de documento 48 (PPT) no está en el catálogo → se omite y se avisa', () => {
    const fx = base();
    editar(fx, 286.8, 569.5, '4');
    editar(fx, 297.3, 569.5, '8');
    editar(fx, 186.0, 569.5, 'Permiso por Protección Temporal');
    const r = parsear(fx);
    assert.equal(r.campos.tipoDocumento, undefined);
    assert.ok(tieneAviso(r, /«Permiso por Protección Temporal \(PPT\)» \(código 48\).*Elige manualmente/));
    assert.equal(r.extra.nitIgualCedula, null, 'la igualdad NIT = cédula solo se exige con cédula de ciudadanía');
    assert.deepEqual(r.extra.tipoDocumento, { codigo: '48', descripcion: 'Permiso por Protección Temporal (PPT)' });
  });

  test('tipo de documento 22 → nombre exacto del catálogo (con su espacio final)', () => {
    const fx = base();
    editar(fx, 286.8, 569.5, '2');
    editar(fx, 297.3, 569.5, '2');
    const r = parsear(fx);
    assert.equal(valor(r, 'tipoDocumento'), 'Cédula de extranjería ');
    assert.equal(r.campos.tipoDocumento.etiqueta, 'Cédula de extranjería');
  });

  test('CIIU especial: 0081 está en el catálogo; 0020 (pensionados) no → confianza baja y aviso', () => {
    const conCiiu = (cod) => {
      const fx = base();
      [32.9, 43.6, 54.4, 65.1].forEach((x, i) => editar(fx, x, 329.5, cod[i]));
      return parsear(fx);
    };
    let r = conCiiu('0081');
    assert.equal(valor(r, 'actividadRut'), '0081');
    assert.equal(r.campos.actividadRut.confianza, 'alta');
    assert.match(r.campos.actividadRut.etiqueta, /^0081 — Personas Naturales sin Actividad/);
    r = conCiiu('0020');
    assert.equal(valor(r, 'actividadRut'), '0020');
    assert.equal(r.campos.actividadRut.confianza, 'baja');
    assert.ok(tieneAviso(r, /actividad principal de tu RUT \(código 0020\) no está en la lista/));
  });

  test('responsabilidad 47 (Régimen SIMPLE) → C3 = SI', () => {
    const fx = agregar(base(), crudo('4', 104.8, 291.9), crudo('7', 115.3, 291.9),
      crudo('47 - Régimen simple de tributación - SIM', 30.0, 257.5, 132));
    const r = parsear(fx);
    assert.equal(valor(r, 'c3'), 'SI');
    assert.match(r.campos.c3.origen, /código 47/);
    assert.equal(r.extra.sugerencias.regimenSimple, true);
    assert.equal(r.extra.responsabilidades.find((x) => x.codigo === '47').descripcion, 'Régimen Simple de Tributación – SIMPLE');
  });

  test('casillas y lista de la casilla 53 no coinciden → sin C3, IVA con confianza media y aviso', () => {
    const r = parsear(quitar(base(), 30.0, 269.5)); // se pierde "49 - No responsable de IVA" de la lista
    assert.equal(r.extra.responsabilidadesConfiables, false);
    assert.equal(r.campos.c3, undefined);
    assert.equal(valor(r, 'regimenIva'), 'NO RESPONSABLE IVA');
    assert.equal(r.campos.regimenIva.confianza, 'media');
    assert.ok(tieneAviso(r, /No pudimos leer con certeza las responsabilidades/));
  });

  test('48 y 49 a la vez → sin régimen de IVA y aviso', () => {
    const fx = agregar(base(), crudo('4', 104.8, 291.9), crudo('8', 115.3, 291.9),
      crudo('48 - Impuesto sobre las ventas - IVA', 30.0, 257.5, 120));
    const r = parsear(fx);
    assert.equal(r.campos.regimenIva, undefined);
    assert.ok(tieneAviso(r, /a la vez las responsabilidades 48 \(IVA\) y 49/));
  });

  test('responsable de IVA (48 sin 49)', () => {
    const fx = base();
    editar(fx, 95.3, 291.9, '8');
    editar(fx, 30.0, 269.5, '48 - Impuesto sobre las ventas - IVA');
    const r = parsear(fx);
    assert.equal(valor(r, 'regimenIva'), 'RESPONSABLE IVA');
    assert.equal(r.campos.regimenIva.origen, 'Casilla 53 (código 48)');
  });

  test('responsabilidad inactiva 12 (régimen simplificado) → sin régimen de IVA y aviso de actualizar', () => {
    const fx = base();
    editar(fx, 84.8, 291.9, '1');
    editar(fx, 95.3, 291.9, '2');
    editar(fx, 30.0, 269.5, '12- Ventas régimen simplificado');
    const r = parsear(fx);
    assert.equal(r.campos.regimenIva, undefined);
    assert.ok(tieneAviso(r, /dejó de usar en 2019 \(12 – Ventas régimen simplificado\)/));
    assert.ok(tieneAviso(r, /ni la 49/));
  });

  test('antigüedad: aviso solo si se generó hace más de un año', () => {
    const fx = base(); // generado el 2021-03-15
    assert.ok(!tieneAviso(parsear(fx, { hoy: '2021-04-01' }), /actualizado/));
    assert.ok(!tieneAviso(parsear(fx, { hoy: '2022-03-15' }), /actualizado/));
    assert.ok(tieneAviso(parsear(fx, { hoy: '2022-03-16' }), /hace más de un año/));
    assert.ok(tieneAviso(parsear(fx, { hoy: new Date(2026, 0, 1) }), /15\/03\/2021/));
  });

  test('correo inválido → sin campo email y aviso', () => {
    const r = parsear(editar(base(), 106.0, 401.5, 'correo-sin-arroba.example.org'));
    assert.equal(r.campos.email, undefined);
    assert.ok(tieneAviso(r, /correo electrónico .* no parece válido/));
  });

  test('municipio que no existe en el catálogo → sin campo municipio y aviso', () => {
    const fx = base();
    [563.8, 574.5, 585.2].forEach((x) => editar(fx, x, 437.5, '9'));
    const r = parsear(fx);
    assert.equal(valor(r, 'departamento'), 'Antioquia');
    assert.equal(r.campos.municipio, undefined);
    assert.ok(tieneAviso(r, /código DANE 05999/));
  });

  test('teléfono de 7 dígitos: el indicativo sugerido depende del departamento', () => {
    const fx = base();
    editar(fx, 370.8, 437.5, '1');
    editar(fx, 381.3, 437.5, '1');
    editar(fx, 563.8, 437.5, '0');
    editar(fx, 574.5, 437.5, '0');
    editar(fx, 585.2, 437.5, '1');
    const r = parsear(fx);
    assert.equal(valor(r, 'departamento'), 'Bogotá D.C');
    assert.equal(valor(r, 'municipio'), 'BOGOTÁ');
    assert.ok(tieneAviso(r, /indicativo 601 \(quedaría 6012345678\)/));
  });
});

// ---------------------------------------------------------------- 3b. regresiones de la verificación adversarial

/** Mueve el ÚNICO item crudo con texto en (x, y) ± 0.6 pt. */
function mover(fx, x, y, dx, dy, str) {
  const l = buscarCrudos(fx, x, y, str);
  assert.equal(l.length, 1, `se esperaba un item en (${x}, ${y})`);
  l[0].transform[4] += dx;
  l[0].transform[5] += dy;
  return fx;
}

/** Une en un solo item crudo varios items de una fila (como un re-procesador que pega los "text runs"). */
function fusionar(fx, y, strs, sep = '    ') {
  const p = fx.paginas[0];
  const its = strs.map((s) => p.crudos.find((c) => c.str === s && Math.abs(c.transform[5] - y) < 1.5));
  assert.ok(its.every(Boolean), 'items a fusionar');
  const a = its[0], z = its[its.length - 1];
  const n = Object.assign(clonar(a), { str: strs.join(sep), width: z.transform[4] + z.width - a.transform[4] });
  p.crudos = p.crudos.filter((c) => !its.includes(c)).concat([n]);
  return fx;
}

/** Desalinea al azar la línea base (y) de cada item en ±amp pt, de forma determinista. */
function desalinear(fx, semilla, amp) {
  const rnd = aleatorio(semilla);
  const b = clonar(fx);
  for (const p of b.paginas) for (const c of p.crudos) c.transform[5] += (rnd() * 2 - 1) * amp;
  return b;
}

const valores = (r) => Object.fromEntries(Object.entries(r.campos).map(([k, c]) => [k, c.valor]));
const confianzas = (r) => Object.fromEntries(Object.entries(r.campos).map(([k, c]) => [k, c.confianza]));

describe('regresiones: teléfonos por tipo (telefono1 = fijo, telefono2 = celular)', () => {
  const base = () => leerFixture('rut-pn-2021-formato2019'); // 44 = fijo de 7 dígitos, 45 = celular
  const conTelefonos = (t44, t45) => {
    const fx = base();
    if (t44 != null) editar(fx, 336.6, 387.53, t44);
    if (t45 != null) editar(fx, 507.0, 387.53, t45);
    const r = parsear(fx);
    verificarContrato(r);
    return r;
  };

  test('celular en la casilla 44 y fijo de 10 dígitos en la 45 → cada uno en su campo', () => {
    const r = conTelefonos('3 1 0 9 8 7 6 5 4 3', '6 0 4 2 3 4 5 6 7 8');
    assert.deepEqual([valor(r, 'telefono1'), r.campos.telefono1.origen, r.campos.telefono1.confianza], ['6042345678', 'Casilla 45', 'alta']);
    assert.deepEqual([valor(r, 'telefono2'), r.campos.telefono2.origen, r.campos.telefono2.confianza], ['3109876543', 'Casilla 44', 'alta']);
    assert.ok(!tieneAviso(r, /teléfono|celular/i));
  });

  test('dos fijos → el primero en telefono1, ningún fijo en telefono2 y aviso de celular', () => {
    const r = conTelefonos(null, '2 3 4 5 6 7 9');
    assert.equal(valor(r, 'telefono1'), '2345678');
    assert.equal(r.campos.telefono2, undefined);
    assert.ok(tieneAviso(r, /no trae un número de celular/));
  });

  test('+57 delante del celular → se quita, confianza media', () => {
    const r = conTelefonos(null, '5 7 3 1 0 9 8 7 6 5 4 3');
    assert.equal(valor(r, 'telefono2'), '3109876543');
    assert.equal(r.campos.telefono2.confianza, 'media');
  });

  test('número que no es celular ni fijo → no se usa (aviso); "0" se ignora', () => {
    let r = conTelefonos(null, '1 2 3 4 5 6 7 8 9');
    assert.equal(r.campos.telefono2, undefined);
    assert.ok(tieneAviso(r, /casilla 45 de tu RUT \(«123456789»\) no es un celular ni un fijo/));
    // El fijo de la casilla 44 sigue en Teléfono 1.
    assert.equal(r.campos.telefono1.valor, '2345678');
    // Un número irreconocible podría ser un fijo mal escrito: no se pone 0 por la persona.
    r = conTelefonos('1 2 3 4 5 6 7 8 9', null);
    assert.equal(r.campos.telefono1, undefined);
    assert.ok(tieneAviso(r, /no trae un teléfono fijo: en «Teléfono 1» escribe tu fijo, o 0/));
    assert.ok(!r.avisos.includes(AVISO_SIN_FIJO));
    r = conTelefonos('0', null);
    assert.deepEqual(r.campos.telefono1, TELEFONO1_CERO, '"0" en la casilla 44 + celular en la 45 → Teléfono 1 = 0');
    assert.equal(valor(r, 'telefono2'), '3109876543');
    assert.ok(!tieneAviso(r, /casilla 44/));
    assert.ok(r.avisos.includes(AVISO_SIN_FIJO));
  });

  test('solo celulares → Teléfono 1 = 0 (confianza media) con un solo aviso suave', () => {
    const r = conTelefonos('3 1 0 9 8 7 6 5 4 3', '3 2 0 1 1 1 2 2 3 3');
    assert.deepEqual(r.campos.telefono1, TELEFONO1_CERO);
    assert.deepEqual([valor(r, 'telefono2'), r.campos.telefono2.origen], ['3109876543', 'Casilla 44']);
    assert.deepEqual(r.avisos.filter((a) => /teléfono|celular/i.test(a)), [AVISO_SIN_FIJO]);
  });

  test('sin teléfonos → un solo aviso que explica los dos campos', () => {
    const fx = quitar(quitar(base(), 336.6, 387.53), 507.0, 387.53);
    const r = parsear(fx);
    assert.equal(r.campos.telefono1, undefined);
    assert.equal(r.campos.telefono2, undefined);
    assert.equal(r.avisos.filter((a) => /teléfono|celular/i.test(a)).length, 1);
    assert.ok(tieneAviso(r, /No encontramos teléfonos/));
  });
});

describe('regresiones: C3 y régimen de IVA según la antigüedad de la copia', () => {
  const conFecha = (fecha) => editar(leerFixture('rut-pn-2021-formato2019'), 433.92, 17,
    `Fecha generación documento PDF: ${fecha} 10:20:30PM`);

  test('copia reciente → alta; de hace más de un año → media', () => {
    let r = parsear(leerFixture('rut-pn-2021-formato2019'), { hoy: '2021-04-01' });
    assert.deepEqual([r.campos.c3.confianza, r.campos.regimenIva.confianza], ['alta', 'alta']);
    r = parsear(leerFixture('rut-pn-2021-formato2019'));
    assert.deepEqual([r.campos.c3.confianza, r.campos.regimenIva.confianza], ['media', 'media']);
  });

  test('copia anterior a 2019 (no existía la responsabilidad 47) → sin C3 y aviso', () => {
    const r = parsear(conFecha('15-03-2018'));
    assert.equal(r.extra.fechaGeneracion, '2018-03-15');
    assert.equal(r.campos.c3, undefined);
    assert.ok(tieneAviso(r, /anterior a 2019.*Régimen SIMPLE \(C3\)/));
    assert.equal(r.extra.sugerencias.regimenSimple, false);
  });

  test('sin fecha de generación → C3 y régimen con confianza media', () => {
    const r = parsear(quitar(leerFixture('rut-pn-2021-formato2019'), 433.92, 17), { hoy: '2021-04-01' });
    assert.equal(r.extra.fechaGeneracion, '');
    assert.deepEqual([r.campos.c3.confianza, r.campos.regimenIva.confianza], ['media', 'media']);
  });
});

describe('regresiones: valores con formato inválido se omiten (con aviso)', () => {
  const base = () => leerFixture('rut-pn-2021-formato2019');

  test('CIIU de 3 dígitos → sin actividadRut, aviso y código leído en extra', () => {
    const r = parsear(quitar(base(), 65.1, 329.5));
    verificarContrato(r);
    assert.equal(r.campos.actividadRut, undefined);
    assert.ok(tieneAviso(r, /leímos «851» y el código CIIU tiene 4 dígitos/));
    assert.equal(r.extra.actividades.principal.codigo, '851');
  });

  test('primer dígito de la fecha de inicio corrido hacia el CIIU → el CIIU sigue siendo 8513', () => {
    const r = parsear(mover(base(), 79.4, 329.5, -2.7, 0, '2'));
    assert.equal(valor(r, 'actividadRut'), '8513');
    assert.equal(r.extra.actividades.principal.fechaInicio, '2015-04-01');
  });

  test('NIT de 11 dígitos (dígitos sueltos en la franja) → sin NIT ni DV y aviso', () => {
    const r = parsear(agregar(base(), crudo('7', 50, 603.5, 4.4), crudo('7', 60, 603.5, 4.4), crudo('7', 70, 603.5, 4.4)));
    verificarContrato(r);
    assert.equal(r.campos.nit, undefined);
    assert.equal(r.campos.dv, undefined);
    assert.ok(tieneAviso(r, /NIT que leímos en tu RUT \(«77787654321»\) no tiene entre 4 y 10 dígitos/));
    assert.equal(r.extra.nitLeido, '77787654321');
  });

  test('DV de dos dígitos → sin DV, NIT con confianza media y aviso', () => {
    const r = parsear(agregar(base(), crudo('5', 197.5, 603.5, 4.4)));
    verificarContrato(r);
    assert.equal(r.campos.dv, undefined);
    assert.equal(r.campos.nit.confianza, 'media');
    assert.ok(tieneAviso(r, new RegExp(`DV\\) que leímos en tu RUT \\(«25»\\) no es válido; según tu NIT debería ser ${RutParser.dvNit('87654321')}`)));
  });
});

describe('regresiones: geometría (desplazamiento, escala, líneas base, columnas)', () => {
  const nombre2019 = 'rut-pn-2021-formato2019';
  const base = () => leerFixture(nombre2019);
  const r0 = () => parsear(base());

  test('«establecimientos» en otro texto no corre los límites de las casillas 51 y 52', () => {
    const unal = leerFixture('rut-pj-2016-unal');
    const antes = parsear(unal).extra.actividades;
    const r = parsear(agregar(leerFixture('rut-pj-2016-unal'), crudo('ESTABLECIMIENTOS DEMO', 200, 473.5)));
    assert.deepEqual(r.extra.actividades, antes);
    const pn = parsear(agregar(base(), crudo('ESTABLECIMIENTOS', 27.0, 497.5)));
    assert.deepEqual(pn.extra.actividades, r0().extra.actividades);
  });

  test('copias desplazadas a la derecha o escaladas conservan todos los campos (sin borde fijo en 600 pt)', () => {
    const esperado = valores(r0());
    for (const [s, dx, dy] of [[1, 20, 0], [1.03, 0, 0], [0.92, 24, 30], [1, -8, 50]]) {
      const fx = base();
      for (const c of fx.paginas[0].crudos) {
        c.transform = [c.transform[0] * s, 0, 0, c.transform[3] * s, c.transform[4] * s + dx, c.transform[5] * s + dy];
        c.width *= s;
        c.height *= s;
      }
      assert.deepEqual(valores(parsear(fx)), esperado, `s=${s} dx=${dx} dy=${dy}`);
    }
  });

  test('dígitos de una casilla en líneas base distintas (≤ 1.5 pt) se leen en orden de x', () => {
    const esperado = valores(r0());
    // país 169 → no 196 (COSTA RICA); depto 05 → no 50 (Meta); NIT 87654321 → no 68754321; CIIU 8513 → no 5813.
    let fx = base();
    mover(fx, 167.8, 437.5, 0, 1.5, '1');
    mover(fx, 189.2, 437.5, 0, 0.5, '9');
    mover(fx, 178.5, 437.5, 0, -1.0, '6');
    mover(fx, 381.3, 437.5, 0, 1.5, '5');
    mover(fx, 370.8, 437.5, 0, -0.6, '0');
    mover(fx, 120.9, 603.5, 0, 1.5, '6');
    for (const x of [97.7, 109.3, 132.4, 144.0, 155.6, 167.1, 178.7]) mover(fx, x, 603.5, 0, -0.6);
    mover(fx, 43.6, 329.5, 0, 1.5, '5');
    for (const x of [32.9, 54.4, 65.1]) mover(fx, x, 329.5, 0, -0.6);
    let r = parsear(fx);
    assert.deepEqual(valores(r), esperado);
    assert.deepEqual(confianzas(r), confianzas(r0()));
    // Al azar (±1.5 pt en y) en el formato 2019 y en la copia re-procesada (etiquetas y valores partidos).
    for (const nombre of [nombre2019, 'rut-pn-2025-reprocesado']) {
      const fx0 = leerFixture(nombre);
      const b = valores(parsear(fx0));
      for (let s = 1; s <= 40; s++) {
        r = parsear(desalinear(fx0, s, 1.5));
        assert.deepEqual(valores(r), b, `${nombre} semilla ${s}`);
      }
    }
  });

  test('persona natural FICTICIA en el formato 2013-2016 (sobre la hoja pública de la UNAL)', () => {
    const fx = leerFixture('rut-pj-2016-unal');
    editar(fx, 27, 569.47, 'Persona natural o sucesión ilíquida');
    editar(fx, 173, 569.53, '2');
    for (const x of [80.64, 91.21, 101.79, 112.36, 122.93, 133.5, 144.07, 154.64, 165.21]) quitar(fx, x, 603.53);
    for (const x of [529.53, 539.22, 548.91, 558.59, 568.28, 577.97, 587.66]) quitar(fx, x, 387.53);
    for (const xy of [[27, 497.47], [27, 473.47], [346, 473.47]]) quitar(fx, ...xy);
    editar(fx, 192.5, 603.53, RutParser.dvNit('12345678'));
    agregar(fx, ...'12345678'.split('').map((d, i) => crudo(d, 91.21 + 10.57 * i, 603.53, 4.448)),
      crudo('Cédula de Ciudadanía', 186.0, 569.5, 66, 7), crudo('1', 286.8, 569.5, 4.4), crudo('3', 297.3, 569.5, 4.4),
      crudo('1 2 3 4 5 6 7 8', 337.3, 569.5, 57), crudo('PRUEBA', 27.0, 521.5), crudo('DE LA HOZ', 155.0, 521.5),
      crudo('ANA', 282.0, 521.5), crudo('MARIA JOSE', 407.0, 521.5), crudo('3 0 0 1 2 3 4 5 6 7', 529.5, 387.53, 60));
    const r = parsear(fx);
    verificarContrato(r);
    assert.equal(r.ok, true);
    assert.equal(r.extra.esPersonaNatural, true);
    assert.deepEqual(valores(r), {
      nit: '12345678', dv: RutParser.dvNit('12345678'), tipoDocumento: 'Cédula de ciudadanía ', numeroId: '12345678',
      primerApellido: 'PRUEBA', segundoApellido: 'DE LA HOZ', primerNombre: 'ANA', otrosNombres: 'MARIA JOSE',
      direccion: 'CR 45 26 85 OF 481 ED URIEL GUTIERREZ', pais: 'COLOMBIA', departamento: 'Bogotá D.C', municipio: 'BOGOTÁ',
      email: 'divnacc_nal@unal.edu.co', telefono1: '3165598', telefono2: '3001234567', actividadRut: '8544',
    });
    // 2016: sin 48/49 (régimen a mano) y sin C3 (la responsabilidad 47 no existía).
    assert.ok(tieneAviso(r, /anterior a 2019/));
    assert.ok(tieneAviso(r, /ni la 49/));
    for (let s = 1; s <= 25; s++) assert.deepEqual(valores(parsear(desalinear(fx, s, 1.5))), valores(r), `semilla ${s}`);
  });

  test('columnas: valor corrido, etiqueta ausente o partida con hueco', () => {
    const nombres = (r) => CAMPOS_NOMBRE.map((k) => valor(r, k));
    const esperado = ['FICTICIO', 'DE LA PRUEBA', 'JUAN', 'CARLOS'];
    let r = parsear(mover(base(), 155.0, 521.5, -1.6, 0));
    assert.deepEqual(nombres(r), esperado);
    assert.equal(r.campos.segundoApellido.confianza, 'alta');
    r = parsear(quitar(base(), 155.5, 532.4, '32. Segundo apellido'));
    assert.deepEqual(nombres(r), esperado, 'etiqueta 32 estimada con la geometría del formulario');
    assert.deepEqual([r.campos.primerApellido.confianza, r.campos.segundoApellido.confianza], ['media', 'media']);
    const fx = base();
    const c = buscarCrudos(fx, 155.5, 532.4, '32. Segundo apellido')[0];
    const ancho = c.width / c.str.length;
    const resto = Object.assign(clonar(c), { str: 'do apellido', width: 11 * ancho });
    resto.transform[4] = c.transform[4] + 9 * ancho + 1.0; // hueco de 1 pt dentro de "Segundo"
    Object.assign(c, { str: '32. Segun', width: 9 * ancho });
    r = parsear(agregar(fx, resto));
    assert.deepEqual(nombres(r), esperado);
    r = parsear(mover(base(), 27.0, 412.5, -1.6, 0, 'KR 15 20'));
    assert.equal(valor(r, 'direccion'), 'KR 15 20 35 AP 101 BRR EL EJEMPLO');
  });

  test('un valor que se mete en la columna vecina → confianza baja y aviso (nunca alta)', () => {
    const fx = base();
    const a = buscarCrudos(fx, 27.0, 521.5, 'FICTICIO')[0];
    const b = buscarCrudos(fx, 155.0, 521.5, 'DE LA PRUEBA')[0];
    Object.assign(a, { str: 'FICTICIO DE LA PRUEBA', width: b.transform[4] + b.width - a.transform[4] });
    fx.paginas[0].crudos = fx.paginas[0].crudos.filter((x) => x !== b);
    const r = parsear(fx);
    verificarContrato(r);
    assert.equal(r.campos.primerApellido.confianza, 'baja');
    assert.ok(tieneAviso(r, /pegados entre casillas vecinas \(apellidos y nombres\)/));
  });

  test('filas de etiquetas pegadas en un solo item → valores correctos con confianza media', () => {
    let r = parsear(fusionar(base(), 532.4, ['31. Primer apellido', '32. Segundo apellido', '33. Primer nombre', '34. Otros nombres']));
    assert.deepEqual(CAMPOS_NOMBRE.map((k) => valor(r, k)), ['FICTICIO', 'DE LA PRUEBA', 'JUAN', 'CARLOS']);
    assert.ok(CAMPOS_NOMBRE.every((k) => r.campos[k].confianza === 'media'));
    r = parsear(fusionar(base(), 448.4, ['38. País', '39. Departamento', '40. Ciudad/Municipio']));
    assert.deepEqual(['pais', 'departamento', 'municipio'].map((k) => valor(r, k)), ['COLOMBIA', 'Antioquia', 'MEDELLÍN']);
    r = parsear(fusionar(base(), 580.9, ['24. Tipo de contribuyente', '25. Tipo de documento', '26. Número de Identificación', '27. Fecha expedición']));
    assert.deepEqual([valor(r, 'tipoDocumento'), valor(r, 'numeroId')], ['Cédula de ciudadanía ', '87654321']);
    assert.equal(r.campos.numeroId.confianza, 'media');
    r = parsear(fusionar(base(), 616.4, ['5. Número de Identificación Tributaria (NIT)', '6. DV', '12. Dirección seccional', '14. Buzón electrónico']));
    assert.deepEqual([valor(r, 'nit'), valor(r, 'dv')], ['87654321', '2']);
  });

  test('descripción y código pegados en un item ("COLOMBIA 1 6 9")', () => {
    const r = parsear(fusionar(base(), 437.5, ['COLOMBIA', '1', '6', '9'], ' '));
    assert.equal(valor(r, 'pais'), 'COLOMBIA');
  });

  test('«45. Teléfono 2» pegado al teléfono 1 o ausente: el teléfono 1 nunca se traga al 2', () => {
    let fx = base();
    const v = buscarCrudos(fx, 336.6, 387.53, '2 3 4 5 6 7 8')[0];
    buscarCrudos(fx, 398.5, 388.4, '45. Teléfono 2')[0].transform[4] = v.transform[4] + v.width + 0.5; // texto "…845."
    let r = parsear(fx);
    assert.deepEqual([valor(r, 'telefono1'), valor(r, 'telefono2')], ['2345678', '3109876543']);
    r = parsear(quitar(base(), 398.5, 388.4, '45. Teléfono 2'));
    assert.equal(valor(r, 'telefono1'), '2345678');
    assert.ok(r.extra.telefonos.every((t) => t.numero.length <= 10));
  });

  test('NIT y DV pegados en un item, o el DV corrido dentro de la franja del NIT', () => {
    let fx = base();
    const xs = [97.7, 109.3, 120.9, 132.4, 144.0, 155.6, 167.1, 178.7, 192.5];
    const its = xs.map((x) => buscarCrudos(fx, x, 603.5)[0]);
    const n = Object.assign(clonar(its[0]), { str: its.map((i) => i.str).join(' '), width: 192.5 + 5 - 97.7 });
    fx.paginas[0].crudos = fx.paginas[0].crudos.filter((c) => !its.includes(c)).concat([n]);
    let r = parsear(fx);
    assert.deepEqual([valor(r, 'nit'), valor(r, 'dv'), r.campos.nit.confianza], ['87654321', '2', 'alta']);
    r = parsear(mover(base(), 192.5, 603.5, -9.5, 0)); // el DV cae a la izquierda del borde NIT|DV
    assert.equal(r.extra.nitLeido, '876543212');
    assert.deepEqual([valor(r, 'nit'), valor(r, 'dv')], ['87654321', '2']);
    assert.deepEqual([r.campos.nit.confianza, r.campos.dv.confianza], ['media', 'media']);
    assert.ok(!tieneAviso(r, /no coinciden|No pudimos leer el dígito/));
  });
});

describe('regresiones: texto basura, entradas degeneradas y enormes', () => {
  test('caracteres invisibles o de control dentro de los valores: se quitan y la confianza baja', () => {
    const fx = leerFixture('rut-pn-2021-formato2019');
    editar(fx, 106.0, 401.5, 'juan.fict' + String.fromCharCode(3) + 'icio@example.org');
    editar(fx, 86.9, 412.5, 'AP 101' + String.fromCharCode(1) + ' BRR EL EJEMPLO');
    editar(fx, 282.0, 521.5, 'JU' + String.fromCharCode(0x200b) + 'AN');
    const r = parsear(fx);
    verificarContrato(r);
    assert.deepEqual([valor(r, 'email'), r.campos.email.confianza], ['juan.ficticio@example.org', 'media']);
    assert.deepEqual([valor(r, 'direccion'), r.campos.direccion.confianza], ['KR 15 20 35 AP 101 BRR EL EJEMPLO', 'media']);
    assert.deepEqual([valor(r, 'primerNombre'), r.campos.primerNombre.confianza], ['JUAN', 'media']);
  });

  test('correo con caracteres raros → no se usa', () => {
    const r = parsear(editar(leerFixture('rut-pn-2021-formato2019'), 106.0, 401.5, 'juan"ficticio@example.org'));
    assert.equal(r.campos.email, undefined);
    assert.ok(tieneAviso(r, /correo electrónico .* no parece válido/));
  });

  test('Doc vacío o inválido → mensaje general (no «es una imagen»)', () => {
    for (const d of [{ paginas: [] }, null, {}, { paginas: 'abc' }, 5]) {
      const r = RutParser.parse(d);
      assert.equal(r.ok, false);
      assert.match(r.avisos[0], /No encontramos un RUT/);
      assert.ok(!tieneAviso(r, /imagen/));
    }
  });

  test('150 000 items en un renglón (página con solo crudos) → sin excepciones y la hoja se lee igual', () => {
    const fx = leerFixture('rut-pn-2021-formato2019');
    const crudos = fx.paginas[0].crudos.slice();
    for (let i = 0; i < 150000; i++) crudos.push(crudo('x', 30 + (i % 500), 15, 1));
    const doc = { paginas: [{ numero: 1, crudos }] };
    let r;
    assert.doesNotThrow(() => { r = RutParser.parse(doc, { hoy: HOY }); });
    // Antes PdfText usaba Math.max.apply sobre la línea y lanzaba RangeError (ok:false); ahora el renglón basura
    // del pie no impide leer la hoja principal.
    assert.equal(r.ok, true);
    assert.equal(r.extra.errores, undefined);
    assert.deepEqual([valor(r, 'nit'), valor(r, 'numeroId'), valor(r, 'primerApellido')], ['87654321', '87654321', 'FICTICIO']);
    assert.doesNotThrow(() => RutParser.esRut(doc));
  });
});

// ---------------------------------------------------------------- 4. muestras reales (opcional)

const MUESTRAS = (() => {
  try { return fs.readdirSync(DIR_MUESTRAS).filter((f) => /\.pdf$/i.test(f)).sort(); } catch (e) { return []; }
})();

// Página de la hoja principal del RUT dentro de cada paquete (RUT-REPORT §1 y §9).
const PAQUETES = {
  bundle_2022_corpocesar_proponente: 8,
  bundle_2025_pn_itp_hv_57p: 10,
  bundle_2025_pn_personeria_hv_22p: 9,
};

/** Nombres "PA|SA|PN" de terceros en hojas 3/5 (representantes, revisor fiscal, contador) del Doc. */
function nombresDeTerceros(doc, principal) {
  const out = new Set();
  for (const p of doc.paginas) {
    if (p.numero === principal) continue;
    for (const m of PdfText.buscarTodos(p.lineas, /\b1\d\d\s*\.\s*primer\s*apellido/)) {
      const etq = ['primer\\s*apellido', 'segundo\\s*apellido', 'primer\\s*nombre']
        .map((t) => PdfText.buscar([m.linea], new RegExp(`\\b1\\d\\d\\s*\\.\\s*${t}`)));
      if (etq.some((x) => !x)) continue;
      const col = etq.map((x, i) => PdfText.unirTexto(PdfText.region(p.items, x.x - 2, etq[i + 1] ? etq[i + 1].x - 2 : 600, m.y - 16, m.y - 3)));
      if (col[0]) out.add(col.join('|').toUpperCase());
    }
  }
  return out;
}

describe('muestras reales (carpeta de investigación)', { skip: MUESTRAS.length ? false : `no hay muestras en ${DIR_MUESTRAS}` }, () => {
  // pdf.js (legacy) avisa por consola que en Node no hay 'canvas'; no afecta la extracción de texto.
  const logOriginal = console.log;
  console.log = () => {};
  let pdfjsLib;
  try { pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.log = logOriginal; }

  for (const archivo of MUESTRAS) {
    const nombre = archivo.replace(/\.pdf$/i, '');
    test(nombre, async () => {
      const doc = await PdfText.leer(fs.readFileSync(path.join(DIR_MUESTRAS, archivo)), { pdfjsLib, tolerante: true });
      const r = RutParser.parse(doc, { hoy: HOY });
      verificarContrato(r);
      if (!/^(rut_|bundle_)/.test(nombre)) {
        assert.equal(RutParser.esRut(doc), false, 'no es un RUT');
        assert.equal(r.ok, false);
        return;
      }
      assert.equal(RutParser.esRut(doc), !/printed/.test(nombre));
      if (/printed/.test(nombre)) {
        assert.equal(r.ok, false);
        assert.match(r.avisos[0], /imprime como PDF/);
        return;
      }
      if (/blank_template/.test(nombre)) {
        assert.equal(r.ok, false);
        assert.deepEqual(r.campos, {});
        return;
      }
      if (PAQUETES[nombre]) assert.equal(r.extra.paginas.principal, PAQUETES[nombre]);
      else assert.equal(r.extra.paginas.principal, 1);
      assert.equal(r.extra.responsabilidadesConfiables, true, 'casillas = lista en la casilla 53');
      assert.ok(/^\d{5}$/.test(r.extra.ubicacion.codigoDane));
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.extra.fechaGeneracion), 'fecha de generación');
      // Persona jurídica: no se llena nada; sus datos (con el DV válido) quedan solo en extra.
      if (r.extra.esPersonaJuridica) {
        assert.equal(r.ok, false);
        assert.deepEqual(r.campos, {});
        assert.deepEqual(r.avisos.length, 1);
        assert.match(r.avisos[0], /persona jurídica/);
        const pj = r.extra.datosPersonaJuridica;
        assert.ok(pj.nit && pj.dv && pj.actividadRut && pj.direccion && pj.pais && pj.departamento && pj.municipio);
        assert.equal(pj.dv.valor, RutParser.dvNit(pj.nit.valor));
        for (const k of [...CAMPOS_NOMBRE, 'tipoDocumento', 'numeroId', 'c3']) assert.equal(pj[k], undefined, k);
        assert.ok(r.extra.razonSocial.length > 3);
        return;
      }
      assert.equal(r.ok, true);
      const C = r.campos;
      // NIT y DV: el DV impreso coincide con el calculado.
      assert.ok(C.nit && C.dv);
      assert.equal(C.dv.valor, RutParser.dvNit(C.nit.valor));
      assert.ok(C.actividadRut, 'actividad principal');
      assert.ok(C.pais && C.departamento && C.municipio, 'ubicación');
      assert.ok(C.direccion, 'dirección');
      // Teléfonos por tipo: todo celular del RUT termina en telefono2 y todo fijo en telefono1.
      const tels = r.extra.telefonos;
      assert.ok(tels.length >= 1);
      const cel = tels.find((t) => t.tipo === 'celular');
      const fijo = tels.find((t) => t.tipo === 'fijo') || tels.find((t) => t.tipo === 'fijo7');
      assert.equal(C.telefono2 ? C.telefono2.valor : undefined, cel ? cel.numero : undefined);
      assert.equal(C.telefono1 ? C.telefono1.valor : undefined, fijo ? fijo.numero : (cel ? '0' : undefined));
      assert.ok(tels.every((t) => t.tipo !== 'otro'), 'todos los teléfonos reales son celulares o fijos');
      // Persona natural: cédula = NIT, nombres de la hoja principal (nunca de las hojas 3/5).
      assert.equal(r.extra.esPersonaNatural, true);
      assert.equal(C.nit.confianza, 'alta');
      assert.equal(C.tipoDocumento.valor, 'Cédula de ciudadanía ');
      assert.equal(C.numeroId.valor, C.nit.valor);
      assert.equal(r.extra.nitIgualCedula, true);
      assert.ok(C.primerApellido && C.primerNombre);
      for (const k of CAMPOS_NOMBRE) if (C[k]) assert.match(C[k].valor, NOMBRE_VALIDO, k);
      assert.ok(C.regimenIva && C.c3, 'régimen de IVA y C3');
      assert.ok(!tieneAviso(r, /no coinciden|no coincide con el que corresponde/));
      if (C.email) assert.match(C.email.valor, CORREO_VALIDO);
      const terceros = nombresDeTerceros(doc, r.extra.paginas.principal);
      const propio = [C.primerApellido.valor, C.segundoApellido ? C.segundoApellido.valor : '', C.primerNombre.valor].join('|');
      assert.ok(!terceros.has(propio), 'el nombre no puede venir de las hojas 3/5');
      // Los nombres salen de la fila 31-34 de la hoja principal.
      const pag = doc.paginas.find((p) => p.numero === r.extra.paginas.principal);
      const l31 = PdfText.buscar(pag.lineas, /\b31\s*\.\s*primer\s*apellido/);
      const fila = PdfText.unirTexto(PdfText.region(pag.items, 0, 600, l31.y - 16, l31.y - 3)).toUpperCase();
      for (const k of CAMPOS_NOMBRE) if (C[k]) assert.ok(fila.includes(C[k].valor), k);
      // Documento esperado: elegir el propio no genera aviso; otro número sí.
      const conEsperado = RutParser.parse(doc, { hoy: HOY, documentoEsperado: C.numeroId.valor });
      assert.ok(!tieneAviso(conEsperado, /no coincide con el número que ya está en el formulario/));
      const otro = RutParser.parse(doc, { hoy: HOY, documentoEsperado: '1' });
      assert.ok(tieneAviso(otro, /no coincide con el número que ya está en el formulario/));
    });
  }
});
