// Pruebas de window.RitParser (src/js/parser-rit.js).
//
//   node --test tests/parser-rit.test.mjs
//   ACTUALIZAR_DORADOS=1 node --test tests/parser-rit.test.mjs   (reescribe tests/fixtures/rit-*.esperado.json)
//
// 1. Catálogo ICA: buscarActividad y candidatosDesdeCiiu.
// 2. Fixtures (tests/fixtures/rit-*.json): certificados públicos de personas jurídicas con las filas de
//    representantes (personas naturales) y los contactos personales anonimizados, una persona natural
//    SINTÉTICA y un certificado real de persona natural de 2026 ANONIMIZADO (rit-pn-2026-anon: cédula, nombre,
//    dirección, teléfono y correo ficticios; el resto intacto). Se comparan con salidas doradas
//    (rit-*.esperado.json) y con aserciones explícitas.
// 3. Variantes en memoria de los fixtures: código antiguo como principal, actividad 1 vacía, RIT
//    cancelado, documento esperado distinto, paquete con varios RIT, RUT o solicitud en lugar del RIT, etc.
// 4. Muestras reales (opcional): lee cada PDF de la carpeta de investigación (o de SAMPLES_DIR) si existe y
//    solo verifica invariantes; NUNCA valores personales.
// Todos los datos escritos en este archivo son ficticios o de documentos públicos de empresas.
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
const PdfText = require(path.join(RAIZ, 'src/js/pdftext.js'));
const RitParser = require(path.join(RAIZ, 'src/js/parser-rit.js'));
const { CATALOGOS } = globalThis;

const HOY = '2026-10-01';
const CAMPOS_IDENTIFICACION = ['nit', 'dv', 'tipoDocumento', 'numeroId', 'primerApellido', 'segundoApellido', 'primerNombre',
  'otrosNombres', 'direccion', 'pais', 'departamento', 'municipio', 'email', 'telefono1', 'telefono2'];
const RE_CORREO = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

// ---------------------------------------------------------------- utilidades

const leerFixture = (nombre) => JSON.parse(fs.readFileSync(path.join(FIXTURES, nombre + '.json'), 'utf8'));
const clonar = (o) => JSON.parse(JSON.stringify(o));
const docDe = (fx) => PdfText.armarDoc(fx, null, { tolerante: true });
const plano = (o) => JSON.parse(JSON.stringify(o)); // quita undefined, como el JSON dorado

/** Cambia el texto de los items crudos cuyo str es exactamente `de` (mantiene la geometría). */
function sustituir(fx, de, a) {
  let n = 0;
  for (const p of fx.pages) {
    for (const it of p.items) {
      if (it.str === de) {
        it.str = a;
        n++;
      }
    }
  }
  assert.ok(n > 0, 'el fixture no contiene el texto a sustituir');
  return fx;
}

/** Quita los items crudos cuyo str es exactamente `str`. */
function quitar(fx, str) {
  for (const p of fx.pages) p.items = p.items.filter((it) => it.str !== str);
  return fx;
}

const tieneAviso = (r, re) => r.avisos.some((a) => re.test(a));

/** Item crudo con la forma de pdf.js. */
function crudo(str, x, y, w, h = 8) {
  return { str, dir: 'ltr', transform: [h, 0, 0, h, x, y], width: w == null ? str.length * 4 : w, height: h, fontName: 'g_d0_f1', hasEOL: false };
}

/** Items crudos cuyo str es exactamente `str` (falla si no hay ninguno). */
function itemsCon(fx, str) {
  const out = [];
  for (const p of fx.pages) for (const it of p.items) if (it.str === str) out.push(it);
  assert.ok(out.length, 'el fixture no contiene: ' + str);
  return out;
}

/** Parte el item `str` en los cortes dados (posiciones de carácter), con `hueco` pt entre trozos. */
function partirItem(fx, str, cortes, hueco) {
  for (const p of fx.pages) {
    const i = p.items.findIndex((it) => it.str === str);
    if (i < 0) continue;
    const it = p.items[i];
    const ancho = it.width / str.length;
    const pos = [0, ...cortes, str.length];
    let x = it.transform[4];
    const nuevos = [];
    for (let k = 0; k < pos.length - 1; k++) {
      const s = str.slice(pos[k], pos[k + 1]);
      nuevos.push({ ...it, str: s, width: ancho * s.length, transform: [...it.transform.slice(0, 4), x, it.transform[5]] });
      x += ancho * s.length + hueco;
    }
    p.items.splice(i, 1, ...nuevos);
    return fx;
  }
  return assert.fail('el fixture no contiene: ' + str);
}

/**
 * Re-impresión "una palabra = un item": parte cada item con espacios en palabras y deja cada espacio como
 * item aparte (ancho proporcional al número de caracteres), como el RUT re-procesado de la investigación.
 */
function partirEnPalabras(fx) {
  for (const p of fx.pages) {
    const nuevos = [];
    for (const it of p.items) {
      if (!/ /.test(it.str.trim())) {
        nuevos.push(it);
        continue;
      }
      const ancho = it.width / it.str.length;
      let x = it.transform[4];
      for (const trozo of it.str.split(/( )/)) {
        if (!trozo) continue;
        nuevos.push({ ...it, str: trozo, width: ancho * trozo.length, height: trozo === ' ' ? 0 : it.height, transform: [...it.transform.slice(0, 4), x, it.transform[5]] });
        x += ancho * trozo.length;
      }
    }
    p.items = nuevos;
  }
  return fx;
}

/** El certificado "impreso como PDF" en otro tamaño de papel: coordenadas y tamaños escalados por k. */
function escalar(fx, k, dy = 0) {
  for (const p of fx.pages) {
    p.width *= k;
    p.height *= k;
    for (const it of p.items) {
      it.transform = it.transform.map((v, i) => (i < 4 ? v * k : i === 5 ? v * k + dy : v * k));
      it.width *= k;
      it.height *= k;
    }
  }
  fx.info = { Producer: 'Skia/PDF', Creator: 'Navegador' };
  return fx;
}

/** Hoja principal mínima de un RUT con valores ficticios (anclas del informe RUT). */
function paginaRut() {
  return {
    page: 1, width: 612, height: 792, items: [
      crudo('5. Número de Identificación Tributaria (NIT)', 27.5, 616.4, 150),
      crudo('6. DV', 185.5, 616.4, 15),
      crudo('12. Dirección seccional', 205.5, 616.4, 70),
      crudo('24. Tipo de contribuyente', 27.5, 580.9, 70, 6),
      crudo('Persona natural o sucesión ilíquida', 27.0, 569.5, 120, 7),
      crudo('Para uso exclusivo de la DIAN', 259.8, 114.5, 90),
      crudo('Fecha generación documento PDF: 01-02-2025 10:00:00AM', 433.9, 17.0, 160),
    ],
  };
}

/** Anverso mínimo del formulario de solicitud del RIT (no es el certificado). */
function paginaSolicitud() {
  return {
    page: 1, width: 612, height: 792, items: [
      crudo('SOLICITUD DE REGISTRO Y/O NOVEDADES RIT', 150, 740, 300, 12),
      crudo('105-F.203', 40, 760, 40),
      crudo('Lea las instrucciones al respaldo', 380, 760, 120),
      crudo('Número de identificación', 40, 700, 100),
    ],
  };
}

// Casos dorados: fixture + opciones fijas (hoy fijo para que la salida no dependa de la fecha real).
const DORADOS = [
  { nombre: 'rit-pn-sintetico', opts: { hoy: '2020-09-01', documentoEsperado: '52345678' } },
  { nombre: 'rit-pj-2paginas', opts: { hoy: HOY } },
  { nombre: 'rit-pj-5digitos-envueltas', opts: { hoy: '2024-03-01' } },
  { nombre: 'rit-pj-codigos-legado', opts: { hoy: HOY } },
  { nombre: 'rit-ut-fecha-editada', opts: { hoy: '2024-12-10' } },
  { nombre: 'rit-pn-2026-anon', opts: { hoy: HOY, documentoEsperado: '1019283754', actividadRut: '6920' } },
];

/** Comprueba que el resultado no contiene textos de las filas de representantes (anonimizadas). */
function sinRepresentantes(r) {
  const s = JSON.stringify(r);
  assert.ok(!/FICTICIO/.test(s), 'se filtró un nombre de la tabla de representantes');
  assert.ok(!/11111111/.test(s), 'se filtró un documento de la tabla de representantes');
}

// ---------------------------------------------------------------- 1. catálogo

describe('catálogo ICA (CATALOGOS.rit)', () => {
  test('buscarActividad normaliza el código con String(Number())', () => {
    assert.equal(RitParser.buscarActividad('6201').tarifa, 9.66);
    assert.equal(RitParser.buscarActividad(6201).agrupacion, 304);
    assert.equal(RitParser.buscarActividad('0111').codigo, 111);
    assert.equal(RitParser.buscarActividad('0111').tarifa, 0);
    assert.equal(RitParser.buscarActividad(' 74902 ').tarifa, 7.66);
    assert.equal(RitParser.buscarActividad('74902'), CATALOGOS.rit.find((e) => e.codigo === 74902), 'devuelve la entrada del catálogo');
  });

  test('buscarActividad devuelve null para códigos inexistentes o vacíos', () => {
    for (const c of ['62011', '85511', '7490', '', null, undefined, 'abc', '1234567']) {
      assert.equal(RitParser.buscarActividad(c), null, String(c));
    }
  });

  test('RIT-V10: buscarActividad y candidatosDesdeCiiu solo aceptan códigos (dígitos), no texto con cifras', () => {
    for (const c of ['1.11', '6201abc', '-6201', '8,559', '62 01', '7490-1', 6201.5, -6201, NaN, {}, []]) {
      assert.equal(RitParser.buscarActividad(c), null, String(c));
      assert.deepEqual(RitParser.candidatosDesdeCiiu(c), [], String(c));
    }
  });

  test('candidatosDesdeCiiu: código exacto', () => {
    assert.deepEqual(RitParser.candidatosDesdeCiiu('6201'), [
      { codigo: '6201', descripcion: RitParser.buscarActividad(6201).descripcion, tarifa: 9.66, agrupacion: 304 },
    ]);
    assert.deepEqual(RitParser.candidatosDesdeCiiu('0111').map((c) => c.codigo), ['111']);
    // 8551 está dos veces en el Excel: un solo candidato
    assert.deepEqual(RitParser.candidatosDesdeCiiu('8551').map((c) => c.codigo), ['8551']);
  });

  test('RIT-V02: candidatosDesdeCiiu: el exacto primero y luego sus hijos de 5 dígitos (otra tarifa posible)', () => {
    assert.deepEqual(RitParser.candidatosDesdeCiiu('8523').map((c) => [c.codigo, c.tarifa, c.agrupacion]), [['8523', 7, 305], ['85232', 9.66, 304]]);
    assert.deepEqual(RitParser.candidatosDesdeCiiu('8559').map((c) => c.codigo), ['8559', '85591', '85592']);
    assert.deepEqual(RitParser.candidatosDesdeCiiu(8559).map((c) => c.codigo), ['8559', '85591', '85592']);
  });

  test('candidatosDesdeCiiu: hijos de 5 dígitos cuando el código de 4 no existe', () => {
    const c = RitParser.candidatosDesdeCiiu('7490');
    assert.deepEqual(c.map((x) => [x.codigo, x.tarifa, x.agrupacion]), [['74901', 8.66, 302], ['74902', 7.66, 304]]);
    assert.deepEqual(RitParser.candidatosDesdeCiiu('6910').map((x) => x.codigo), ['69101', '69102']);
    assert.deepEqual(RitParser.candidatosDesdeCiiu('8691').map((x) => x.codigo), ['86911']);
    assert.deepEqual(RitParser.candidatosDesdeCiiu('4799').map((x) => x.codigo), ['47991', '47992', '47993', '47994']);
  });

  test('candidatosDesdeCiiu: sin coincidencias → []', () => {
    for (const c of ['9999', '0010', '', null, 'x', '62011']) assert.deepEqual(RitParser.candidatosDesdeCiiu(c), [], String(c));
  });

  test('todos los candidatos existen en el catálogo y su código es texto', () => {
    for (const ciiu of CATALOGOS.ciiu.slice(0, 600)) {
      for (const c of RitParser.candidatosDesdeCiiu(ciiu.codigo)) {
        assert.equal(typeof c.codigo, 'string');
        assert.ok(RitParser.buscarActividad(c.codigo), c.codigo);
      }
    }
  });
});

// ---------------------------------------------------------------- 2. fixtures + dorados

describe('fixtures anonimizados contra salidas doradas', () => {
  for (const { nombre, opts } of DORADOS) {
    test(nombre, () => {
      const r = plano(RitParser.parse(docDe(leerFixture(nombre)), opts));
      const archivo = path.join(FIXTURES, nombre + '.esperado.json');
      if (ACTUALIZAR) {
        fs.writeFileSync(archivo, JSON.stringify(r, null, 2) + '\n');
        return;
      }
      assert.ok(fs.existsSync(archivo), 'falta ' + archivo + ' (corre con ACTUALIZAR_DORADOS=1)');
      assert.deepEqual(r, JSON.parse(fs.readFileSync(archivo, 'utf8')));
    });
  }

  test('el resultado es el mismo con el Doc de PdfText o con el volcado crudo', () => {
    for (const { nombre, opts } of DORADOS) {
      const fx = leerFixture(nombre);
      assert.deepEqual(plano(RitParser.parse(fx, opts)), plano(RitParser.parse(docDe(fx), opts)), nombre);
    }
  });

  test('ningún fixture filtra datos de representantes ni llena campos de identificación', () => {
    for (const { nombre, opts } of DORADOS) {
      const r = RitParser.parse(docDe(leerFixture(nombre)), opts);
      sinRepresentantes(r);
      assert.deepEqual(Object.keys(r.campos).filter((k) => k !== 'actividadRit'), [], nombre);
      for (const k of CAMPOS_IDENTIFICACION) assert.equal(r.campos[k], undefined, nombre + ' · ' + k);
    }
  });
});

describe('persona natural (sintético)', () => {
  const fx = leerFixture('rit-pn-sintetico');
  const r = RitParser.parse(docDe(fx), { hoy: '2020-09-01', documentoEsperado: '52345678' });

  test('esRit y resultado útil', () => {
    assert.equal(RitParser.esRit(docDe(fx)), true);
    assert.equal(r.tipo, 'RIT');
    assert.equal(r.ok, true);
  });

  test('actividad principal = actividad 1 (74902), en el catálogo, confianza alta', () => {
    assert.deepEqual(r.campos.actividadRit, {
      valor: '74902',
      etiqueta: '74902 — ' + RitParser.buscarActividad(74902).descripcion,
      origen: 'RIT · Actividad 1',
      confianza: 'alta',
    });
    assert.equal(r.extra.tarifa, 7.66);
    assert.equal(r.extra.agrupacion, 304);
  });

  test('todas las actividades impresas con su tarifa del catálogo', () => {
    assert.deepEqual(r.extra.actividades.map((a) => [a.orden, a.codigo, a.enCatalogo, a.tarifa, a.agrupacion, a.principal]), [
      [1, '74902', true, 7.66, 304, true],
      [2, '8559', true, 9.66, 304, false],
    ]);
    assert.equal(r.extra.actividades[1].descripcionImpresa, 'Otros tipos de educación n.c.p.');
    assert.equal(r.extra.actividades[1].descripcionCatalogo, RitParser.buscarActividad(8559).descripcion);
  });

  test('contribuyente y contacto solo en extra', () => {
    assert.deepEqual(r.extra.contribuyente, {
      tipoDoc: 'CC', tipoDocImpreso: 'C.C.', tipoDocumentoCatalogo: 'Cédula de ciudadanía ', numero: '52345678', nombre: 'PEREZ GOMEZ MARIA JOSE',
    });
    assert.equal(r.extra.esPersonaNatural, true);
    assert.equal(r.extra.ciudad, 'BOGOTÁ DC');
    assert.equal(r.extra.departamento, 'BOGOTÁ, D.C.');
    assert.equal(r.extra.departamentoCatalogo, 'Bogotá D.C');
    assert.equal(r.extra.municipioCatalogo, 'BOGOTÁ');
    assert.equal(r.extra.telefono, '3000000000');
    assert.equal(r.extra.direccion, 'CL 1 2 3 AP 401');
  });

  test('correo recortado: se marca y no se entrega', () => {
    assert.equal(r.extra.emailImpreso, 'usuario.ejemplo@correo');
    assert.equal(r.extra.emailRecortado, true);
    assert.equal(r.extra.emailSiValido, null);
  });

  test('régimen poco confiable y aviso de que no es el régimen de IVA', () => {
    assert.equal(r.extra.regimen, 'SIMPLIFICADO');
    assert.equal(r.extra.regimenNormalizado, 'PREFERENCIAL');
    assert.equal(r.extra.regimenConfianza, 'baja');
    assert.ok(tieneAviso(r, /régimen SIMPLIFICADO del ICA/));
  });

  test('sin avisos de persona jurídica, documento distinto, vigencia ni edición', () => {
    assert.ok(!tieneAviso(r, /persona jurídica|otro documento|hace \d+ días|modificado/));
    assert.equal(r.extra.posibleEdicion, false);
    assert.equal(r.extra.fechaCertificado, '2020-08-18');
    assert.equal(r.extra.fechaCese, 'NO');
    assert.equal(r.extra.fechaInicioActividades, '1997-09-01');
    assert.equal(r.extra.fechaInscripcionEsMigracion, true);
    assert.deepEqual(r.extra.paginasRit, [1]);
  });
});

describe('persona natural real 2026 (rit-pn-2026-anon, anonimizado)', () => {
  const fx = leerFixture('rit-pn-2026-anon');
  const CC = '1019283754'; // ficticia, la misma del fixture rut-pn-2026-anon
  const opts = { hoy: HOY, documentoEsperado: CC, actividadRut: '6920' };
  const r = RitParser.parse(docDe(fx), opts);

  test('certificado de persona natural: esRit, ok y solo actividadRit en campos', () => {
    assert.equal(RitParser.esRit(docDe(fx)), true);
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.campos), ['actividadRit']);
    assert.equal(r.extra.naturalezaJuridica, 'PERSONA NATURAL');
    assert.equal(r.extra.esPersonaNatural, true);
    assert.deepEqual(r.extra.contribuyente, {
      tipoDoc: 'CC', tipoDocImpreso: 'C.C.', tipoDocumentoCatalogo: 'Cédula de ciudadanía ', numero: CC, nombre: 'ANDRES JULIAN FALSO MODELO',
    });
    assert.equal(RitParser._interno.dvNit(CC), '9', 'la cédula ficticia tiene un DV válido (el mismo del RUT anonimizado)');
    assert.ok(!tieneAviso(r, /persona jurídica|otro documento|No pudimos leer el número/));
  });

  test('principal = actividad 1 (69201), tarifa 8,66 por mil, confianza alta (coincide con el CIIU 6920 del RUT)', () => {
    assert.deepEqual(r.campos.actividadRit, {
      valor: '69201',
      etiqueta: '69201 — ' + RitParser.buscarActividad(69201).descripcion,
      origen: 'RIT · Actividad 1',
      confianza: 'alta',
    });
    assert.equal(r.extra.tarifa, 8.66);
    assert.equal(r.extra.agrupacion, 302);
    assert.deepEqual(RitParser.candidatosDesdeCiiu('6920').map((c) => c.codigo), ['69201', '69202']);
  });

  test('descripciones con mojibake («tenedurÃ-a») se reconocen contra el catálogo', () => {
    assert.deepEqual(r.extra.actividades.map((a) => [a.orden, a.codigo, a.enCatalogo, a.tarifa, a.agrupacion, a.principal, a.descripcionCoincide]), [
      [1, '69201', true, 8.66, 302, true, true],
      [2, '74901', true, 8.66, 302, false, true],
    ]);
    const [a1, a2] = r.extra.actividades;
    assert.match(a1.descripcionImpresa, /tenedurÃ-a de libros, auditorÃ-a financiera/);
    assert.match(a2.descripcionImpresa, /cientÃ-ficas y tÃ©cnicas/);
    assert.equal(a1.descripcionCatalogo, RitParser.buscarActividad(69201).descripcion);
    assert.match(a1.descripcion, /teneduría de libros/, 'la descripción para mostrar es la del catálogo');
  });

  test('régimen «NO REGISTRA»: poco confiable, sin aviso y sin fecha desde', () => {
    assert.equal(r.extra.regimen, 'NO REGISTRA');
    assert.equal(r.extra.regimenNormalizado, 'OTRO');
    assert.equal(r.extra.regimenConfianza, 'baja');
    assert.equal(r.extra.regimenFechaDesde, null);
    assert.ok(!tieneAviso(r, /régimen|Régimen/));
  });

  test('contacto y fechas solo en extra; único aviso: antigüedad del certificado', () => {
    assert.equal(r.extra.direccion, 'CL 76 SUR 34 21 AP 502');
    assert.equal(r.extra.telefono, '3216549870');
    assert.equal(r.extra.emailSiValido, 'ajfalso@example.com');
    assert.equal(r.extra.municipioCatalogo, 'BOGOTÁ');
    assert.equal(r.extra.departamentoCatalogo, 'Bogotá D.C');
    assert.equal(r.extra.fechaCertificado, '2026-03-16');
    assert.equal(r.extra.fechaInscripcion, '2026-03-16');
    assert.equal(r.extra.fechaInicioActividades, '2021-01-01');
    assert.equal(r.extra.fechaCese, 'NO');
    assert.equal(r.extra.posibleEdicion, false, 'la fecha impresa coincide con CreationDate');
    assert.equal(r.extra.numEstablecimientos, 0);
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0], /certificado RIT es del 16\/03\/2026 \(hace 199 días\)/);
  });

  test('variantes: otro documento esperado → confianza baja; CIIU del RUT = actividad 2 → confianza media', () => {
    const otro = RitParser.parse(docDe(fx), { ...opts, documentoEsperado: '52345678' });
    assert.equal(otro.extra.documentoNoCoincide, true);
    assert.equal(otro.campos.actividadRit.confianza, 'baja');
    assert.ok(tieneAviso(otro, /otro documento/));
    const conDv = RitParser.parse(docDe(fx), { ...opts, documentoEsperado: CC + '9' });
    assert.ok(!tieneAviso(conDv, /otro documento/), 'NIT con DV pegado = mismo documento');
    const ciiu7490 = RitParser.parse(docDe(fx), { ...opts, actividadRut: '7490' });
    assert.equal(ciiu7490.campos.actividadRit.valor, '69201');
    assert.equal(ciiu7490.campos.actividadRit.confianza, 'media');
    assert.ok(tieneAviso(ciiu7490, /actividad 7490, que en tu RIT aparece como actividad 2 \(74901\)/));
  });
});

describe('certificados de personas jurídicas (fixtures)', () => {
  test('2 páginas: perfil en la 1, descripción envuelta, correo recortado, aviso de persona jurídica', () => {
    const r = RitParser.parse(docDe(leerFixture('rit-pj-2paginas')), { hoy: HOY });
    assert.deepEqual(r.extra.paginasRit, [1, 2]);
    assert.equal(r.extra.contribuyente.numero, '830035246');
    assert.equal(r.extra.contribuyente.tipoDoc, 'NIT');
    assert.equal(r.extra.contribuyente.dvCalculado, RitParser._interno.dvNit('830035246'));
    assert.deepEqual(r.extra.actividades.map((a) => a.codigo), ['6202', '4651', '4741', '6209']);
    assert.match(r.extra.actividades[2].descripcionImpresa, / en establecimientos especializados$/);
    assert.equal(r.campos.actividadRit.valor, '6202');
    assert.equal(r.extra.emailRecortado, true);
    assert.equal(r.extra.emailSiValido, null);
    assert.equal(r.extra.esPersonaNatural, false);
    assert.equal(r.extra.numEstablecimientos, 1);
    assert.ok(tieneAviso(r, /^Este RIT es de una persona jurídica/));
    assert.ok(tieneAviso(r, /^Tu certificado RIT es del 18\/08\/2020 \(hace \d+ días\)/));
    assert.ok(!tieneAviso(r, /régimen/i), 'régimen COMUN: sin comentario');
  });

  test('5 actividades con códigos de 5 dígitos y dos descripciones envueltas', () => {
    const r = RitParser.parse(docDe(leerFixture('rit-pj-5digitos-envueltas')), { hoy: '2024-03-01' });
    assert.deepEqual(r.extra.actividades.map((a) => [a.codigo, a.enCatalogo, a.tarifa]), [
      ['4644', true, 11.04], ['46491', true, 11.04], ['47111', true, 4.14], ['47191', true, 11.04], ['4722', true, 4.14],
    ]);
    assert.match(r.extra.actividades[2].descripcionImpresa, /bebidas no alcohólicas o tabaco \(excepto cigarrillos\)$/);
    assert.match(r.extra.actividades[3].descripcionImpresa, /productos de bebidas alcohólicas y cigarrillos$/);
    assert.equal(r.extra.ciudad, 'DOSQUEBRADAS');
    assert.equal(r.extra.departamento, 'RISARALDA');
    assert.equal(r.extra.departamentoCatalogo, 'Risaralda');
    assert.equal(r.extra.municipioCatalogo, 'DOSQUEBRADAS');
    assert.deepEqual(r.extra.paginasRit, [1, 2]);
    assert.ok(!tieneAviso(r, /hace \d+ días/), 'certificado de 11 días: sin aviso de vigencia');
  });

  test('códigos antiguos: 71101 (principal) → candidatos sin llenar el campo; 85511 → 85591 sugerido', () => {
    const r = RitParser.parse(docDe(leerFixture('rit-pj-codigos-legado')), { hoy: HOY });
    assert.equal(r.campos.actividadRit, undefined);
    assert.equal(r.ok, true);
    const [a1, a2, a3] = r.extra.actividades;
    assert.equal(a1.codigo, '71101');
    assert.equal(a1.enCatalogo, false);
    assert.equal(a1.codigoFormulario, null);
    assert.deepEqual(a1.candidatos.map((c) => c.codigo), ['71111', '71112', '71121', '71122']);
    assert.equal(a2.enCatalogo, true);
    // RIT-V04: `codigo` es el código para el formulario (el sugerido); el impreso queda en codigoImpreso
    assert.equal(a3.codigoImpreso, '85511');
    assert.equal(a3.enCatalogo, false);
    assert.equal(a3.codigo, '85591');
    assert.equal(a3.sugerido, '85591');
    assert.equal(a3.codigoFormulario, '85591');
    assert.equal(a3.tarifa, RitParser.buscarActividad(85591).tarifa);
    for (const a of r.extra.actividades) if (a.codigoFormulario) assert.ok(RitParser.buscarActividad(a.codigo), a.codigo);
    assert.match(a3.descripcionImpresa, /con fines de validación\)$/);
    assert.ok(tieneAviso(r, /La actividad principal de tu RIT \(71101\) no está en la tabla.*71111, 71112, 71121, 71122\./));
    assert.equal(r.extra.regimenFechaDesde, null, '"Fecha desde: NO"');
  });

  test('PDF editado: fecha partida en items de 3 fuentes y distinta de CreationDate', () => {
    const r = RitParser.parse(docDe(leerFixture('rit-ut-fecha-editada')), { hoy: '2024-12-10' });
    assert.equal(r.extra.fechaCertificado, '2024-12-02');
    assert.equal(r.extra.posibleEdicion, true);
    assert.equal(r.extra.indiciosEdicion.length, 2);
    assert.match(r.extra.indiciosEdicion[0], /varios tipos de letra: «Fecha:02\/12\/2024»/);
    assert.match(r.extra.indiciosEdicion[1], /no coincide con la fecha de creación del PDF \(01\/04\/2024\)/);
    assert.ok(tieneAviso(r, /^Este PDF parece modificado después de generado/));
    assert.equal(r.campos.actividadRit.valor, '46631');
    assert.equal(r.campos.actividadRit.confianza, 'baja', 'RIT-V09: un PDF con indicios de edición no da confianza alta');
    assert.equal(r.extra.emailSiValido, 'contabilidadut000@correo.co');
    assert.equal(r.extra.emailRecortado, false);
    assert.equal(r.extra.fechaInscripcionEsMigracion, undefined);
  });
});

// ---------------------------------------------------------------- 3. variantes

describe('variantes en memoria', () => {
  const PN = () => clonar(leerFixture('rit-pn-sintetico'));
  const ACT1 = '74902 - Otras actividades profesionales, científicas y técnicas n.c.p. en el ejercicio de una profesión liberal';
  const ACT2 = '8559 - Otros tipos de educación n.c.p.';
  const FRESCO = { hoy: '2020-09-01' };

  test('85511 como actividad principal → 85591 con confianza media y aviso', () => {
    const fx = sustituir(PN(), ACT1, '85511 - Educación académica no formal (excepto programas de educación básica primaria, básica secundaria y media no gradual con fines de validación)');
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r.campos.actividadRit.valor, '85591');
    assert.equal(r.campos.actividadRit.confianza, 'media');
    assert.match(r.campos.actividadRit.origen, /código 85511 actualizado/);
    assert.ok(tieneAviso(r, /La actividad 85511 de tu RIT es un código anterior a la Resolución SDH-000265 de 2021\. Su equivalente actual es 85591/));
    assert.equal(r.extra.tarifa, 9.66);
  });

  test('código desconocido sin familia ni descripción parecida → sin campo y sin opciones', () => {
    const fx = sustituir(PN(), ACT1, '99999 - Actividad inexistente de prueba');
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r.campos.actividadRit, undefined);
    assert.deepEqual(r.extra.actividades[0].candidatos, []);
    assert.ok(tieneAviso(r, /La actividad principal de tu RIT \(99999\) no está en la tabla de actividades ICA del formulario\. Elige la que corresponda en el paso «Información tributaria»\.$/));
  });

  test('código antiguo cuya descripción coincide con una del catálogo → sugerido', () => {
    const fx = sustituir(PN(), ACT1, '62019 - Actividades de desarrollo de sistemas informáticos (planificación, análisis, diseño, programación, pruebas)');
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r.campos.actividadRit.valor, '6201');
    assert.equal(r.campos.actividadRit.confianza, 'media');
  });

  test('actividad de 4 dígitos cuyo código solo existe con sub-códigos → candidatos hijos', () => {
    const fx = sustituir(PN(), ACT1, '7490 - Otras actividades profesionales, científicas y técnicas n.c.p.');
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r.campos.actividadRit, undefined);
    assert.deepEqual(r.extra.actividades[0].candidatos.map((c) => c.codigo).slice(0, 2), ['74901', '74902']);
  });

  test('actividadRut del RUT coincide con otra actividad → principal con confianza media', () => {
    const r = RitParser.parse(docDe(PN()), { ...FRESCO, actividadRut: '8559' });
    assert.equal(r.campos.actividadRit.valor, '74902');
    assert.equal(r.campos.actividadRit.confianza, 'media');
    assert.ok(tieneAviso(r, /Tu RUT indica la actividad 8559, que en tu RIT aparece como actividad 2 \(8559\)/));
    const r2 = RitParser.parse(docDe(PN()), { ...FRESCO, actividadRut: '7490' });
    assert.equal(r2.campos.actividadRit.confianza, 'alta', '7490 es la familia de 74902');
    assert.ok(!tieneAviso(r2, /Tu RUT indica/));
  });

  test('actividad 1 vacía → la siguiente es la principal con confianza media', () => {
    const r = RitParser.parse(docDe(quitar(PN(), ACT1)), FRESCO);
    assert.equal(r.campos.actividadRit.valor, '8559');
    assert.equal(r.campos.actividadRit.confianza, 'media');
    assert.equal(r.campos.actividadRit.origen, 'RIT · Actividad 2');
    assert.ok(tieneAviso(r, /Tu RIT no tiene actividad 1/));
  });

  test('sin actividades → aviso, sin campo, pero el resultado sigue siendo útil', () => {
    const r = RitParser.parse(docDe(quitar(quitar(PN(), ACT1), ACT2)), FRESCO);
    assert.equal(r.campos.actividadRit, undefined);
    assert.deepEqual(r.extra.actividades, []);
    assert.ok(tieneAviso(r, /No encontramos actividades económicas/));
    assert.equal(r.ok, true);
  });

  test('documento esperado distinto → aviso, confianza baja y nada de identificación en campos', () => {
    const r = RitParser.parse(docDe(PN()), { ...FRESCO, documentoEsperado: '1.012.345.678' });
    assert.equal(r.extra.documentoNoCoincide, true);
    assert.ok(tieneAviso(r, /^El RIT corresponde a otro documento \(C\.C\. 52345678\), distinto al tuyo \(1012345678\)/));
    assert.equal(r.campos.actividadRit.confianza, 'baja');
    assert.deepEqual(Object.keys(r.campos), ['actividadRit']);
  });

  test('documento esperado igual (también NIT con DV pegado) → sin aviso', () => {
    const r = RitParser.parse(docDe(PN()), { ...FRESCO, documentoEsperado: '52.345.678' });
    assert.ok(!tieneAviso(r, /otro documento/));
    assert.equal(r.extra.documentoNoCoincide, undefined);
    const dv = RitParser._interno.dvNit('830035246');
    const r2 = RitParser.parse(docDe(leerFixture('rit-pj-2paginas')), { hoy: HOY, documentoEsperado: '830035246' + dv });
    assert.ok(!tieneAviso(r2, /otro documento/));
    assert.equal(RitParser._interno.mismoDocumento('830035246', '830035246' + ((Number(dv) + 1) % 10)), false);
  });

  test('paquete con dos certificados RIT: elige el del documento esperado', () => {
    const pj = leerFixture('rit-pj-2paginas');
    const pn = PN();
    const paquete = { info: {}, pages: pj.pages.concat(pn.pages).map((p, i) => ({ ...p, page: i + 1 })) };
    const r1 = RitParser.parse(docDe(paquete), { hoy: HOY });
    assert.deepEqual(r1.extra.paginasRit, [1, 2]);
    assert.equal(r1.extra.contribuyente.numero, '830035246');
    assert.equal(r1.extra.certificados.length, 2);
    assert.ok(tieneAviso(r1, /^Este PDF trae 2 certificados RIT de documentos distintos; usamos el del documento 830035246\. Si no es el tuyo/));

    const r2 = RitParser.parse(docDe(paquete), { hoy: '2020-09-01', documentoEsperado: '52345678' });
    assert.deepEqual(r2.extra.paginasRit, [3]);
    assert.equal(r2.extra.contribuyente.numero, '52345678');
    assert.equal(r2.campos.actividadRit.valor, '74902');
    assert.ok(tieneAviso(r2, /usamos el del documento 52345678, que coincide con el tuyo\./));
    assert.ok(!tieneAviso(r2, /otro documento|persona jurídica/));
    assert.deepEqual(r2.extra.certificados.map((c) => c.paginas), [[1, 2], [3]]);
  });

  test('RIT dentro de un PDF más grande (no en la página 1)', () => {
    const pn = PN();
    const paquete = { info: {}, pages: [paginaRut(), { ...pn.pages[0], page: 2 }] };
    const r = RitParser.parse(docDe(paquete), FRESCO);
    assert.equal(RitParser.esRit(docDe(paquete)), true);
    assert.deepEqual(r.extra.paginasRit, [2]);
    assert.equal(r.campos.actividadRit.valor, '74902');
  });

  test('RIT cancelado (fecha de cese) → aviso', () => {
    const fx = PN();
    const cese = fx.pages[0].items.find((it) => it.str === 'NO' && Math.abs(it.transform[4] - 596) < 1);
    cese.str = '15/03/2024';
    const r = RitParser.parse(docDe(fx), { hoy: '2024-04-01' });
    assert.equal(r.extra.fechaCese, '2024-03-15');
    assert.ok(tieneAviso(r, /^El RIT aparece cancelado: tiene fecha de cese de actividades \(15\/03\/2024\)/));
    assert.equal(r.campos.actividadRit.confianza, 'media', 'RIT-V09: un RIT cancelado no da confianza alta');
  });

  test('vigencia: aviso solo después de 90 días; fecha futura también avisa', () => {
    const doc = docDe(PN()); // Fecha:18/08/2020
    const avisoViejo = /^Tu certificado RIT es del 18\/08\/2020/;
    assert.ok(!tieneAviso(RitParser.parse(doc, { hoy: '2020-11-16' }), avisoViejo), '90 días');
    const r = RitParser.parse(doc, { hoy: '2020-11-17' });
    assert.ok(tieneAviso(r, /^Tu certificado RIT es del 18\/08\/2020 \(hace 91 días\)/));
    assert.equal(r.extra.diasDesdeExpedicion, 91);
    assert.ok(!tieneAviso(RitParser.parse(doc, { hoy: '2020-11-17', diasVigencia: 120 }), avisoViejo));
    assert.ok(tieneAviso(RitParser.parse(doc, { hoy: new Date(2020, 7, 1) }), /es posterior a hoy/));
  });

  test('correo completo se entrega en minúsculas; pegado al borde de la columna se marca recortado', () => {
    const fx = sustituir(PN(), 'usuario.ejemplo@correo', 'Usuario.Ejemplo@Correo.co');
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r.extra.emailSiValido, 'usuario.ejemplo@correo.co');
    assert.equal(r.extra.emailRecortado, false);
    const it = fx.pages[0].items.find((x) => x.str === 'Usuario.Ejemplo@Correo.co');
    it.width = 334 - it.transform[4];
    const r2 = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r2.extra.emailSiValido, null);
    assert.equal(r2.extra.emailRecortado, true);
  });

  test('régimen: COMUN sin aviso, SIMPLE con aviso de la responsabilidad 47', () => {
    const comun = RitParser.parse(docDe(sustituir(PN(), 'SIMPLIFICADO', 'COMUN')), FRESCO);
    assert.ok(!comun.avisos.some((a) => /régimen/i.test(a)));
    const simple = RitParser.parse(docDe(sustituir(PN(), 'SIMPLIFICADO', 'REGIMEN SIMPLE')), FRESCO);
    assert.equal(simple.extra.regimenNormalizado, 'SIMPLE');
    assert.ok(tieneAviso(simple, /Régimen Simple de Tributación; confírmalo con tu RUT \(responsabilidad 47\)/));
  });

  test('actividad no gravada (tarifa 0) → aviso informativo', () => {
    const fx = sustituir(PN(), ACT1, '111 - Cultivo de cereales (excepto arroz), legumbres y semillas oleaginosas');
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r.campos.actividadRit.valor, '111');
    assert.ok(tieneAviso(r, /no sujeta o no gravada/));
  });

  test('"Fecha desde" con fecha real y 31/12/1969 (nulo)', () => {
    const fx = PN();
    assert.equal(RitParser.parse(docDe(fx), FRESCO).extra.regimenFechaDesde, '2020-01-01');
    sustituir(fx, 'Fecha desde: 01/01/2020', 'Fecha desde: 31/12/1969');
    assert.equal(RitParser.parse(docDe(fx), FRESCO).extra.regimenFechaDesde, null);
  });

  test('edición dentro de la tabla de representantes: se marca sin citar el texto', () => {
    const fx = clonar(leerFixture('rit-pj-2paginas'));
    const items = fx.pages[0].items;
    const i = items.findIndex((it) => it.str === 'REPRESENTANTE FICTICIO UNO');
    const it = items[i];
    const mitad = it.width / 2;
    items.splice(i, 1,
      { ...it, str: 'REPRESENTANTE', width: mitad },
      { ...it, str: ' FICTICIO UNO', width: mitad, fontName: 'g_d9_f2', transform: [...it.transform.slice(0, 4), it.transform[4] + mitad, it.transform[5]] });
    const r = RitParser.parse(docDe(fx), { hoy: HOY });
    assert.equal(r.extra.posibleEdicion, true);
    assert.deepEqual(r.extra.indiciosEdicion, ['Texto con varios tipos de letra en las tablas del certificado']);
    sinRepresentantes(r);
  });

  test('valores partidos en varios items pegados se unen antes de leerlos', () => {
    const fx = PN();
    const items = fx.pages[0].items;
    const i = items.findIndex((it) => it.str === '52345678');
    const it = items[i];
    const x = it.transform[4];
    const paso = it.width / 8;
    items.splice(i, 1,
      { ...it, str: '5234', width: paso * 4 },
      { ...it, str: '5678', width: paso * 4, transform: [...it.transform.slice(0, 4), x + paso * 4, it.transform[5]] });
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r.extra.contribuyente.numero, '52345678');
    assert.equal(r.extra.posibleEdicion, false, 'misma fuente: no es indicio de edición');
  });
});

// ---------------------------------------------------------------- 3b. regresiones (verificación adversarial)
// Variantes en memoria de los fixtures anonimizados (persona natural sintética y una persona jurídica
// pública). Los identificadores (RIT-Vnn) son los de los informes de verificación.

describe('regresiones: geometría y texto partido', () => {
  const PN = () => clonar(leerFixture('rit-pn-sintetico'));
  const PJ = () => clonar(leerFixture('rit-pj-2paginas'));
  const ACT1 = '74902 - Otras actividades profesionales, científicas y técnicas n.c.p. en el ejercicio de una profesión liberal';
  const FRESCO = { hoy: '2020-09-01' };
  const base = RitParser.parse(docDe(PN()), FRESCO);
  const PERFIL = ['contribuyente', 'naturalezaJuridica', 'regimen', 'regimenFechaDesde', 'fechaCese', 'fechaInicioActividades', 'fechaInscripcion',
    'fechaCertificado', 'ciudad', 'departamento', 'telefono', 'direccion', 'emailImpreso', 'numEstablecimientos', 'matriculaMercantil'];

  test('RIT-V01/V3a: todo el texto partido en palabras (espacios como items aparte) se lee igual', () => {
    const r = RitParser.parse(docDe(partirEnPalabras(PN())), FRESCO);
    assert.deepEqual(r.campos, base.campos);
    assert.deepEqual(plano(r.extra.actividades), plano(base.extra.actividades));
    for (const k of PERFIL) assert.deepEqual(r.extra[k], base.extra[k], k);
    assert.ok(!tieneAviso(r, /No encontramos actividades/));
    const pj = RitParser.parse(docDe(partirEnPalabras(PJ())), { hoy: HOY });
    assert.equal(pj.campos.actividadRit.valor, '6202');
    assert.match(pj.extra.actividades[2].descripcionImpresa, / en establecimientos especializados$/);
  });

  test('RIT-V3a: «Actividad» y «1:» separados por un espacio de 2,5 pt', () => {
    const fx = PN();
    for (let n = 1; n <= 5; n++) {
      const it = itemsCon(fx, 'Actividad ' + n + ':')[0];
      fx.pages[0].items.push({ ...it, str: n + ':', width: 9, transform: [...it.transform.slice(0, 4), it.transform[4] + 48.5, it.transform[5]] });
      Object.assign(it, { str: 'Actividad', width: 46 });
    }
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.deepEqual(r.campos, base.campos);
    assert.deepEqual(r.extra.actividades.map((a) => a.codigo), ['74902', '8559']);
  });

  test('RIT-V3b: palabras separadas 1,2 pt llevan espacio; cifras y etiquetas partidas a mitad no', () => {
    const fx = PN();
    const nombre = itemsCon(fx, 'PEREZ GOMEZ MARIA JOSE')[0];
    let x = nombre.transform[4];
    const palabras = 'PEREZ GOMEZ MARIA JOSE'.split(' ').map((w) => {
      const it = { ...nombre, str: w, width: w.length * 4, transform: [...nombre.transform.slice(0, 4), x, nombre.transform[5]] };
      x += w.length * 4 + 1.2;
      return it;
    });
    fx.pages[0].items.splice(fx.pages[0].items.indexOf(nombre), 1, ...palabras);
    partirItem(fx, 'Fecha:18/08/2020', [3, 10], 1);        // «Fec» «ha:18/0» «8/2020»
    partirItem(fx, ACT1, [3], 1);                            // «749» «02 - Otras…»
    partirItem(fx, 'Fecha de Inscripción:', [12], 1);        // «Fecha de Ins» «cripción:»
    partirItem(fx, 'SIMPLIFICADO', [7], 1);
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r.extra.contribuyente.nombre, 'PEREZ GOMEZ MARIA JOSE');
    assert.equal(r.extra.fechaCertificado, '2020-08-18');
    assert.equal(r.extra.fechaInscripcion, '2018-02-28');
    assert.equal(r.extra.regimenNormalizado, 'PREFERENCIAL');
    assert.deepEqual(r.campos, base.campos);
  });

  test('RIT-V2: el valor de una actividad a ~2,5-3 pt de su etiqueta sigue siendo de esa actividad', () => {
    const fx = PN();
    itemsCon(fx, 'Actividad 1:')[0].transform[5] -= 1.6;
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.deepEqual(r.campos, base.campos);
    assert.ok(!tieneAviso(r, /no tiene actividad 1/));

    const fx2 = PN();
    itemsCon(fx2, '8559 - Otros tipos de educación n.c.p.')[0].transform[5] += 2;
    const r2 = RitParser.parse(docDe(fx2), FRESCO);
    assert.deepEqual(r2.extra.actividades.map((a) => [a.orden, a.codigo]), [[1, '74902'], [2, '8559']]);
    assert.match(r2.extra.actividades[0].descripcionImpresa, /profesión liberal$/);
  });

  test('RIT-V06: certificado escalado (impreso como PDF en carta) une las continuaciones y detecta el correo recortado', () => {
    const r = RitParser.parse(docDe(escalar(PJ(), 612 / 859, 100)), { hoy: HOY });
    assert.deepEqual(r.extra.actividades.map((a) => a.codigo), ['6202', '4651', '4741', '6209']);
    assert.match(r.extra.actividades[2].descripcionImpresa, /equipos de telecomunicaciones en establecimientos especializados$/);
    assert.equal(r.campos.actividadRit.valor, '6202');
    assert.equal(r.campos.actividadRit.confianza, 'alta');
    assert.equal(r.extra.contribuyente.numero, '830035246');
    assert.equal(r.extra.emailRecortado, true);

    const fx = escalar(sustituir(PN(), 'usuario.ejemplo@correo', 'Usuario.Ejemplo@Correo.co'), 612 / 859);
    assert.equal(RitParser.parse(docDe(fx), FRESCO).extra.emailSiValido, 'usuario.ejemplo@correo.co');
    const correo = itemsCon(fx, 'Usuario.Ejemplo@Correo.co')[0];
    correo.width = itemsCon(fx, 'Ciudad:')[0].transform[4] - 1 - correo.transform[4];
    const r2 = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r2.extra.emailRecortado, true, 'pegado a «Ciudad:» (borde relativo a la etiqueta, no a x=331)');
    assert.equal(r2.extra.emailSiValido, null);
  });

  test('RIT-V07 (dash): código separado con raya (–) en lugar de guion', () => {
    const r = RitParser.parse(docDe(sustituir(PN(), ACT1, ACT1.replace(' - ', ' – '))), FRESCO);
    assert.deepEqual(r.campos, base.campos);
  });
});

describe('regresiones: paquetes y páginas', () => {
  const PN = () => clonar(leerFixture('rit-pn-sintetico'));
  const PJ = () => clonar(leerFixture('rit-pj-2paginas'));
  const renumerar = (pages) => pages.map((p, i) => ({ ...p, page: i + 1 }));

  test('RIT-V05/V1a: páginas del certificado en orden inverso', () => {
    const fx = PJ();
    fx.pages = renumerar(fx.pages.reverse());
    const r = RitParser.parse(docDe(fx), { hoy: HOY });
    assert.equal(r.campos.actividadRit.valor, '6202');
    assert.equal(r.campos.actividadRit.confianza, 'alta');
    assert.deepEqual(r.extra.paginasRit, [1, 2]);
    assert.equal(r.extra.actividades.length, 4);
    assert.ok(!tieneAviso(r, /No encontramos actividades|página 1/));
  });

  test('RIT-V1b: otra página que menciona el RIT (índice/carta) antes del certificado', () => {
    const indice = { page: 1, width: 612, height: 792, items: [crudo('Página 1/ 1', 500, 760, 40, 9),
      crudo('Anexo: REGISTRO DE INFORMACIÓN TRIBUTARIA (RIT-SHD) del contratista', 60, 700, 380, 11)] };
    for (let i = 0; i < 10; i++) indice.items.push(crudo('Lista de chequeo de documentos soporte número ' + (i + 1), 60, 650 - i * 20, 300, 10));
    const fx = { info: {}, pages: [indice, { ...PN().pages[0], page: 2 }] };
    const r = RitParser.parse(docDe(fx), { hoy: '2020-09-01' });
    assert.equal(r.ok, true);
    assert.equal(r.campos.actividadRit.valor, '74902');
    assert.deepEqual(r.extra.paginasRit, [2]);
    assert.equal(r.extra.certificados, undefined);
  });

  test('RIT-V05: solo la página de continuación → aviso de que falta la página 1, sin campo', () => {
    const fx = PJ();
    fx.pages = renumerar([fx.pages[1]]);
    const r = RitParser.parse(docDe(fx), { hoy: HOY });
    assert.equal(r.campos.actividadRit, undefined);
    assert.ok(tieneAviso(r, /no trae la página 1 del certificado RIT/));
    assert.ok(!tieneAviso(r, /No encontramos actividades/));
    sinRepresentantes(r);
  });

  test('paquete con el mismo certificado repetido: una sola copia', () => {
    const fx = PJ();
    fx.pages = renumerar(fx.pages.concat(clonar(fx.pages)));
    const r = RitParser.parse(docDe(fx), { hoy: HOY });
    assert.deepEqual(r.extra.paginasRit, [1, 2]);
    assert.equal(r.extra.certificados, undefined);
    assert.ok(!tieneAviso(r, /certificados RIT/));
  });

  test('RIT-V9: dos certificados del mismo documento con fechas distintas → el más reciente, con aviso', () => {
    const viejo = PN();
    const nuevo = sustituir(sustituir(PN(), 'Fecha:18/08/2020', 'Fecha:15/09/2026'),
      '74902 - Otras actividades profesionales, científicas y técnicas n.c.p. en el ejercicio de una profesión liberal',
      '6201 - Actividades de desarrollo de sistemas informáticos');
    const fx = { info: {}, pages: renumerar(viejo.pages.concat(nuevo.pages)) };
    const r = RitParser.parse(docDe(fx), { hoy: '2026-10-01' });
    assert.equal(r.extra.fechaCertificado, '2026-09-15');
    assert.equal(r.campos.actividadRit.valor, '6201');
    assert.deepEqual(r.extra.paginasRit, [2]);
    assert.ok(tieneAviso(r, /^Este PDF trae 2 certificados RIT del mismo documento con fechas distintas; usamos el más reciente \(15\/09\/2026\)\.$/));
    const r2 = RitParser.parse(docDe({ info: {}, pages: renumerar(nuevo.pages.concat(viejo.pages)) }), { hoy: '2026-10-01' });
    assert.equal(r2.campos.actividadRit.valor, '6201');
  });

  test('RIT-V8: un Doc «listo» con líneas o items nulos no lanza', () => {
    for (const d of [{ paginas: [{ items: [], lineas: [null] }] }, { paginas: [{ items: [null], lineas: [] }] },
      { paginas: [{ items: [], lineas: [{ texto: 5 }], texto: null }] }]) {
      let r;
      assert.doesNotThrow(() => { r = RitParser.parse(d); });
      assert.equal(r.ok, false);
      assert.equal(r.extra.tipoDetectado, 'DESCONOCIDO');
      assert.equal(RitParser.esRit(d), false);
    }
  });
});

describe('regresiones: identidad del contribuyente', () => {
  const PN = () => clonar(leerFixture('rit-pn-sintetico'));
  const FRESCO = { hoy: '2020-09-01' };
  const ponerTipo = (fx, tipo, ancho) => { const it = itemsCon(fx, 'C.C.')[0]; it.str = tipo; it.width = ancho; return fx; };

  test('RIT-V4a: pasaporte alfanumérico', () => {
    const fx = ponerTipo(PN(), 'PASAPORTE', 29.3);
    Object.assign(itemsCon(fx, '52345678')[0], { str: 'AB123456', width: 60 });
    const otro = RitParser.parse(docDe(fx), { ...FRESCO, documentoEsperado: '99999999' });
    assert.equal(otro.extra.contribuyente.tipoDoc, 'PA');
    assert.equal(otro.extra.contribuyente.numero, 'AB123456');
    assert.equal(otro.extra.documentoNoCoincide, true);
    assert.equal(otro.campos.actividadRit.confianza, 'baja');
    const mismo = RitParser.parse(docDe(fx), { ...FRESCO, documentoEsperado: 'ab-123456' });
    assert.equal(mismo.extra.documentoNoCoincide, undefined);
    assert.equal(mismo.campos.actividadRit.confianza, 'alta');
  });

  test('RIT-V4b: tipo de documento ancho pegado al número', () => {
    const r = RitParser.parse(docDe(ponerTipo(PN(), 'PASAPORTE', 58)), { ...FRESCO, documentoEsperado: '52345678' });
    assert.deepEqual([r.extra.contribuyente.tipoDoc, r.extra.contribuyente.numero, r.extra.contribuyente.nombre], ['PA', '52345678', 'PEREZ GOMEZ MARIA JOSE']);
    const cc = RitParser.parse(docDe(ponerTipo(PN(), 'CÉDULA DE CIUDADANÍA', 38)), FRESCO);
    assert.deepEqual([cc.extra.contribuyente.tipoDoc, cc.extra.contribuyente.numero], ['CC', '52345678']);
  });

  test('RIT-V4: documento ilegible con documentoEsperado → aviso y confianza media', () => {
    const fx = quitar(PN(), '52345678');
    const r = RitParser.parse(docDe(fx), { ...FRESCO, documentoEsperado: '52345678' });
    assert.equal(r.extra.contribuyente, undefined);
    assert.equal(r.extra.documentoNoVerificado, true);
    assert.ok(tieneAviso(r, /^No pudimos leer el número de documento de tu RIT para compararlo con el tuyo \(52345678\)/));
    assert.equal(r.campos.actividadRit.confianza, 'media');
    const sinEsperado = RitParser.parse(docDe(fx), FRESCO);
    assert.ok(!tieneAviso(sinEsperado, /No pudimos leer el número/));
    assert.equal(sinEsperado.campos.actividadRit.confianza, 'alta');
  });

  test('RIT-V5a: NIT impreso con su DV pegado no es «otro documento»', () => {
    const dv = RitParser._interno.dvNit('830035246');
    const fx = clonar(leerFixture('rit-pj-2paginas'));
    for (const it of itemsCon(fx, '830035246')) Object.assign(it, { str: '830035246-' + dv, width: 70 });
    const r = RitParser.parse(docDe(fx), { hoy: HOY, documentoEsperado: '830035246' });
    assert.equal(r.extra.documentoNoCoincide, undefined);
    assert.equal(r.extra.contribuyente.numero, '830035246');
    assert.equal(r.extra.contribuyente.dvImpreso, dv);
    assert.equal(RitParser._interno.mismoDocumento('830035246' + dv, '830035246'), true, 'DV del lado del RIT');
    assert.equal(RitParser._interno.mismoDocumento('830035246', '830035246' + dv), true, 'DV del lado esperado');
  });

  test('RIT-V5b: número partido en dos bloques', () => {
    const fx = PN();
    Object.assign(itemsCon(fx, '52345678')[0], { str: '5234', width: 30 });
    fx.pages[0].items.push(crudo('5678', 196 + 32, 699.45, 30));
    const r = RitParser.parse(docDe(fx), { ...FRESCO, documentoEsperado: '52345678' });
    assert.equal(r.extra.contribuyente.numero, '52345678');
    assert.equal(r.extra.contribuyente.nombre, 'PEREZ GOMEZ MARIA JOSE');
    assert.equal(r.extra.documentoNoCoincide, undefined);
  });

  test('RIT-V10: naturaleza distinta de persona jurídica → aviso redactado según la naturaleza', () => {
    const r = RitParser.parse(docDe(sustituir(PN(), 'PERSONA NATURAL', 'SOCIEDAD DE HECHO')), FRESCO);
    assert.equal(r.extra.esPersonaNatural, false);
    assert.ok(!tieneAviso(r, /persona jurídica/));
    assert.ok(tieneAviso(r, /^Este RIT no es de una persona natural: su naturaleza jurídica es SOCIEDAD DE HECHO/));
  });
});

describe('regresiones: actividades, cese y edición', () => {
  const PN = () => clonar(leerFixture('rit-pn-sintetico'));
  const PJ = () => clonar(leerFixture('rit-pj-2paginas'));
  const ACT1 = '74902 - Otras actividades profesionales, científicas y técnicas n.c.p. en el ejercicio de una profesión liberal';
  const FRESCO = { hoy: '2020-09-01' };
  const ponerCese = (fx, v) => { fx.pages[0].items.find((it) => it.str === 'NO' && Math.abs(it.transform[4] - 596) < 1).str = v; return fx; };

  test('RIT-V7: actividad 1 con texto pero sin código legible → no se promueve en silencio', () => {
    const r = RitParser.parse(docDe(sustituir(PN(), ACT1, 'Otras actividades profesionales sin código')), FRESCO);
    assert.equal(r.campos.actividadRit.valor, '8559');
    assert.equal(r.campos.actividadRit.confianza, 'baja');
    assert.deepEqual(r.extra.actividadesSinCodigo, [1]);
    assert.ok(tieneAviso(r, /^No pudimos leer el código de la actividad 1 de tu RIT \(«Otras actividades profesionales sin código»\)\. Tomamos la actividad 2 \(8559\)/));
    assert.ok(!tieneAviso(r, /no tiene actividad 1/));

    const solo = RitParser.parse(docDe(quitar(sustituir(PN(), ACT1, 'Texto ilegible'), '8559 - Otros tipos de educación n.c.p.')), FRESCO);
    assert.equal(solo.campos.actividadRit, undefined);
    assert.ok(tieneAviso(solo, /^No pudimos leer el código de la actividad 1 de tu RIT \(«Texto ilegible»\)\. Elige tu actividad/));
    assert.ok(!tieneAviso(solo, /No encontramos actividades/));
  });

  test('RIT-V04: las alternativas (extra.actividades[].codigo) son códigos válidos del formulario', () => {
    const fx = sustituir(PN(), '8559 - Otros tipos de educación n.c.p.',
      '85511 - Educación académica no formal (excepto programas de educación básica primaria, básica secundaria y media no gradual con fines de validación)');
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.deepEqual(r.extra.actividades.map((a) => [a.codigo, a.codigoImpreso, a.codigoFormulario]), [['74902', '74902', '74902'], ['85591', '85511', '85591']]);
    for (const a of r.extra.actividades) assert.ok(RitParser.buscarActividad(a.codigo), a.codigo);
  });

  test('RIT-V6: «Fecha de cese» que no es una fecha no da el RIT por cancelado', () => {
    for (const v of ['-', 'N/A', 'NINGUNA', '00/00/0000']) {
      const r = RitParser.parse(docDe(ponerCese(PN(), v)), FRESCO);
      assert.equal(r.extra.fechaCese, 'NO', v);
      assert.ok(!tieneAviso(r, /cancelado/), v);
      assert.equal(r.campos.actividadRit.confianza, 'alta', v);
    }
    const otro = RitParser.parse(docDe(ponerCese(PN(), 'PENDIENTE')), FRESCO);
    assert.equal(otro.extra.fechaCese, null);
    assert.equal(otro.extra.fechaCeseImpresa, 'PENDIENTE');
    assert.ok(!tieneAviso(otro, /cancelado/));
  });

  test('RIT-V07: un item completo reescrito en otra fuente es indicio de edición (y baja la confianza)', () => {
    const fx = PN();
    itemsCon(fx, ACT1)[0].fontName = 'g_d0_f9';
    const r = RitParser.parse(docDe(fx), FRESCO);
    assert.equal(r.extra.posibleEdicion, true);
    assert.deepEqual(r.extra.indiciosEdicion, ['Texto con un tipo de letra distinto al del resto del certificado: «' + ACT1 + '»']);
    assert.equal(r.campos.actividadRit.confianza, 'baja');
    assert.ok(tieneAviso(r, /^Este PDF parece modificado después de generado/));

    const tabla = PJ();
    itemsCon(tabla, 'REPRESENTANTE FICTICIO DOS')[0].fontName = 'g_d9_f2';
    const rt = RitParser.parse(docDe(tabla), { hoy: HOY });
    assert.deepEqual(rt.extra.indiciosEdicion, ['Texto con varios tipos de letra en las tablas del certificado']);
    sinRepresentantes(rt);
  });

  test('RIT-V08: la fecha de creación solo se compara con el metadato original del reporte', () => {
    const otraHerramienta = PJ();
    otraHerramienta.info = { Producer: 'iText® 7.2.5 ©2000-2023 iText Group NV (AGPL-version)', Creator: '', CreationDate: "D:20200901093000-05'00'" };
    const r = RitParser.parse(docDe(otraHerramienta), { hoy: HOY });
    assert.equal(r.extra.posibleEdicion, false);
    assert.equal(r.campos.actividadRit.confianza, 'alta');

    const original = PJ();
    original.info = { ...original.info, CreationDate: "D:20200901093000-05'00'" };
    const r2 = RitParser.parse(docDe(original), { hoy: HOY });
    assert.equal(r2.extra.posibleEdicion, true);
    assert.match(r2.extra.indiciosEdicion[0], /no coincide con la fecha de creación del PDF \(01\/09\/2020\)/);
  });
});

describe('documentos que no son el certificado RIT', () => {
  test('RUT en la casilla del RIT', () => {
    const doc = docDe({ info: {}, pages: [paginaRut()] });
    assert.equal(RitParser.esRit(doc), false);
    const r = RitParser.parse(doc);
    assert.equal(r.ok, false);
    assert.equal(r.extra.tipoDetectado, 'RUT');
    assert.deepEqual(r.campos, {});
    assert.ok(tieneAviso(r, /^Este PDF es un RUT de la DIAN, no el certificado RIT/));
  });

  test('formulario de solicitud del RIT', () => {
    const doc = docDe({ info: {}, pages: [paginaSolicitud()] });
    assert.equal(RitParser.esRit(doc), false);
    const r = RitParser.parse(doc);
    assert.equal(r.ok, false);
    assert.equal(r.extra.tipoDetectado, 'RIT_SOLICITUD');
    assert.ok(tieneAviso(r, /formulario de solicitud o novedades del RIT, no el certificado/));
  });

  test('documento vacío, nulo o desconocido: no lanza', () => {
    for (const d of [null, undefined, {}, { paginas: [] }, docDe({ info: {}, pages: [{ page: 1, items: [crudo('Hola, esto es otro documento cualquiera', 10, 10, 200)] }] })]) {
      assert.equal(RitParser.esRit(d), false);
      const r = RitParser.parse(d);
      assert.equal(r.tipo, 'RIT');
      assert.equal(r.ok, false);
      assert.equal(r.extra.tipoDetectado, 'DESCONOCIDO');
      assert.equal(r.avisos.length, 1);
    }
  });

  test('sin DocDetect (anclas propias) se obtiene el mismo resultado', () => {
    const fx = leerFixture('rit-pn-sintetico');
    const doc = docDe(fx);
    const esperado = plano(RitParser.parse(doc, { hoy: '2020-09-01' }));
    const dd = globalThis.DocDetect;
    const ddPt = PdfText.DocDetect;
    try {
      delete globalThis.DocDetect;
      delete PdfText.DocDetect;
      assert.equal(RitParser.esRit(doc), true);
      assert.deepEqual(plano(RitParser.parse(doc, { hoy: '2020-09-01' })), esperado);
      assert.equal(RitParser.parse(docDe({ info: {}, pages: [paginaRut()] })).extra.tipoDetectado, 'RUT');
      assert.equal(RitParser.parse(docDe({ info: {}, pages: [paginaSolicitud()] })).extra.tipoDetectado, 'RIT_SOLICITUD');
    } finally {
      globalThis.DocDetect = dd;
      PdfText.DocDetect = ddPt;
    }
  });

  test('sin PdfText ni DocDetect (volcado crudo): normalización y plegado propios, mismo resultado', () => {
    const fx = leerFixture('rit-pj-5digitos-envueltas');
    const opts = { hoy: '2024-03-01' };
    const esperado = plano(RitParser.parse(docDe(fx), opts));
    const pt = globalThis.PdfText;
    const dd = globalThis.DocDetect;
    try {
      delete globalThis.PdfText;
      delete globalThis.DocDetect;
      assert.equal(RitParser.esRit(fx), true);
      assert.deepEqual(plano(RitParser.parse(fx, opts)), esperado);
      assert.equal(RitParser.parse({ pages: [paginaRut()] }).extra.tipoDetectado, 'RUT');
    } finally {
      globalThis.PdfText = pt;
      globalThis.DocDetect = dd;
    }
  });

  test('sin catálogo cargado: lee el certificado pero no llena el campo', () => {
    const cat = globalThis.CATALOGOS;
    try {
      delete globalThis.CATALOGOS;
      const r = RitParser.parse(docDe(leerFixture('rit-pn-sintetico')), { hoy: '2020-09-01' });
      assert.equal(r.campos.actividadRit, undefined);
      assert.equal(r.extra.actividades[0].enCatalogo, null);
      assert.equal(r.extra.contribuyente.numero, '52345678');
      assert.deepEqual(RitParser.candidatosDesdeCiiu('7490'), []);
      assert.equal(RitParser.buscarActividad('6201'), null);
    } finally {
      globalThis.CATALOGOS = cat;
    }
    assert.ok(RitParser.buscarActividad('6201'));
  });
});

describe('utilidades internas', () => {
  const I = RitParser._interno;
  test('dvNit (DIAN módulo 11) con DV conocidos de empresas públicas', () => {
    assert.equal(I.dvNit('900105979'), '1');
    assert.equal(I.dvNit('899999230'), '7');
    assert.equal(I.dvNit('830037946'), '3');
    assert.equal(I.dvNit(''), '');
  });
  test('fechaISO valida fechas reales', () => {
    assert.equal(I.fechaISO('Fecha:18/08/2020'), '2020-08-18');
    assert.equal(I.fechaISO('02 / 12 / 2024'), '2024-12-02');
    assert.equal(I.fechaISO('31/02/2024'), null);
    assert.equal(I.fechaISO('NO'), null);
  });
  test('normCodigo', () => {
    assert.equal(I.normCodigo('0111'), '111');
    assert.equal(I.normCodigo(' 74902 '), '74902');
    assert.equal(I.normCodigo(''), '');
  });
});

// ---------------------------------------------------------------- 4. muestras reales (opcional)

const hayMuestras = fs.existsSync(DIR_MUESTRAS) && fs.readdirSync(DIR_MUESTRAS).some((f) => /\.pdf$/i.test(f));

describe('muestras reales (invariantes)', { skip: hayMuestras ? false : 'no hay carpeta de muestras (SAMPLES_DIR)' }, () => {
  let pdfjsLib;
  const logOriginal = console.log;
  console.log = () => {};
  try { pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.log = logOriginal; }

  const archivos = hayMuestras ? fs.readdirSync(DIR_MUESTRAS).filter((f) => /\.pdf$/i.test(f)).sort() : [];
  const leer = (f) => PdfText.leer(fs.readFileSync(path.join(DIR_MUESTRAS, f)), { pdfjsLib, tolerante: true });

  /** Textos de las filas de representantes (columnas documento y nombre) para comprobar que no se filtran. */
  function textosRepresentantes(doc) {
    const out = [];
    for (const p of doc.paginas) {
      for (const l of p.lineas) {
        const fecha = l.items.find((i) => i.x >= 50 && i.x <= 62 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.str));
        const tipo = l.items.find((i) => i.x >= 165 && i.x <= 200);
        if (fecha && tipo) for (const i of l.items) if (i.x >= 240 && i.x < 640 && i.str.trim().length >= 5) out.push(i.str.trim());
      }
    }
    return out;
  }

  for (const f of archivos.filter((x) => /^rit_/i.test(x))) {
    test('certificado: ' + f.replace(/\.pdf$/i, '').replace(/\d{6,}/g, '#'), async () => {
      const doc = await leer(f);
      assert.equal(RitParser.esRit(doc), true);
      const r = RitParser.parse(doc, { hoy: HOY });
      assert.equal(r.tipo, 'RIT');
      assert.equal(r.ok, true);
      const e = r.extra;
      assert.match(e.contribuyente.numero, /^\d{6,15}$/);
      if (e.contribuyente.tipoDoc === 'NIT') assert.match(e.contribuyente.dvCalculado, /^\d$/);
      assert.ok(e.paginasRit.length >= 1 && e.paginasRit.every((n) => n >= 1 && n <= doc.numPaginas));
      assert.match(e.fechaCertificado, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(e.actividades.length >= 1 && e.actividades.length <= 5);
      for (const a of e.actividades) {
        assert.match(a.codigo, /^\d{3,6}$/);
        assert.ok(a.descripcionImpresa.length > 5);
        if (a.enCatalogo) assert.ok(RitParser.buscarActividad(a.codigo));
        else assert.ok(Array.isArray(a.candidatos));
      }
      assert.deepEqual(Object.keys(r.campos).filter((k) => k !== 'actividadRit'), []);
      if (r.campos.actividadRit) assert.ok(RitParser.buscarActividad(r.campos.actividadRit.valor));
      if (e.emailSiValido) assert.match(e.emailSiValido, RE_CORREO);
      if (e.emailImpreso && !RE_CORREO.test(e.emailImpreso)) assert.equal(e.emailRecortado, true);
      if (e.esPersonaNatural === false) assert.ok(tieneAviso(r, /persona jurídica|no es de una persona natural/));
      if (e.posibleEdicion && r.campos.actividadRit) assert.equal(r.campos.actividadRit.confianza, 'baja');
      assert.ok(r.avisos.every((a) => typeof a === 'string' && a.length > 10));
      const json = JSON.stringify(r);
      for (const s of textosRepresentantes(doc)) assert.ok(!json.includes(s), 'se filtró un dato de la tabla de representantes');
    });
  }

  for (const f of archivos.filter((x) => /^ritform_/i.test(x))) {
    test('solicitud (no certificado): ' + f.replace(/\.pdf$/i, ''), async () => {
      const doc = await leer(f);
      assert.equal(RitParser.esRit(doc), false);
      const r = RitParser.parse(doc);
      assert.equal(r.ok, false);
      assert.equal(r.extra.tipoDetectado, 'RIT_SOLICITUD');
    });
  }

  for (const f of archivos.filter((x) => /^(rut_|bundle_)/i.test(x))) {
    test('no es RIT: ' + f.replace(/\.pdf$/i, '').replace(/\d{6,}/g, '#'), async () => {
      const doc = await leer(f);
      assert.equal(RitParser.esRit(doc), false);
      const r = RitParser.parse(doc);
      assert.equal(r.ok, false);
      assert.deepEqual(r.campos, {});
      assert.ok(['RUT', 'DESCONOCIDO'].includes(r.extra.tipoDetectado));
    });
  }
});
