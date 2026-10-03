// Pruebas de la lectura de PDF (src/js/pdftext.js: PdfText + DocDetect).
//
//   node --test tests/pdftext.test.mjs
//
// 1. Utilidades puras: fold, compactar, agruparLineas, unirTexto, ratioControl, buscar, region, fechaPdf.
// 2. armarDoc + DocDetect con items sintéticos (sin pdf.js): RUT, RIT, solicitud RIT, paquetes mixtos.
// 3. leer() de punta a punta con PDFs mínimos generados aquí (texto, imagen, contraseña, texto basura,
//    no-PDF, PDF dañado) usando pdfjs-dist (legacy) de node_modules.
// 4. Muestras reales (opcional): lee cada PDF de la carpeta de investigación (o de la variable de entorno
//    SAMPLES_DIR) si existe; solo verifica invariantes y clasificaciones, NUNCA valores personales.
// Todos los datos escritos en este archivo son ficticios.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_MUESTRAS = process.env.SAMPLES_DIR ||
  'C:/Users/Usuario/AppData/Local/Temp/claude/C--Users-Usuario-Documents-GitHub-SED-FORMULARIO-ACTUALIZACION/0393eb11-c794-47b2-a31e-d8758fa9c236/scratchpad/research/samples';

// pdf.js (legacy) avisa por consola que en Node no hay 'canvas'; no afecta la extracción de texto.
const logOriginal = console.log;
console.log = () => {};
let pdfjsLib;
try { pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.log = logOriginal; }

const PdfText = require(path.join(RAIZ, 'src/js/pdftext.js'));
const { DocDetect } = PdfText;
const OPC = { pdfjsLib };

// ---------------------------------------------------------------- utilidades de prueba

/** Item crudo con la forma de pdf.js (transform, width, height, fontName). */
function crudo(str, x, y, w, h = 8) {
  return { str, dir: 'ltr', transform: [h, 0, 0, h, x, y], width: w == null ? str.length * 4 : w, height: h, fontName: 'g_d0_f1', hasEOL: false };
}

/** Parte un texto en un item por carácter, sin hueco dentro de las palabras y 2 pt entre palabras (PDF re-procesado). */
function partido(str, x, y, paso = 4) {
  const out = [];
  let cx = x;
  for (const ch of str) {
    if (ch === ' ') { cx += 2; continue; }
    out.push(crudo(ch, cx, y, paso));
    cx += paso;
  }
  return out;
}

const pagina = (numero, crudos, extra = {}) => ({ numero, ancho: 612, alto: 792, crudos, ...extra });

// Página principal de un RUT con valores ficticios (geometría del informe RUT §3.7).
function rutPrincipal() {
  return [
    crudo('', 27.5, 616.4, 0),
    crudo('5. Número de Identificación Tributaria (NIT)', 27.5, 616.4, 150),
    crudo('6. DV', 185.5, 616.4, 15),
    crudo('12. Dirección seccional', 205.5, 616.4, 70),
    crudo(' ', 74.19, 400, 324.31),
    crudo('9', 97.7, 603.5, 4), crudo('0', 109.3, 603.5, 4), crudo('0', 120.9, 603.5, 4),
    crudo('IDENTIFICACIÓN', 281.6, 592.1, 50, 7),
    crudo('24. Tipo de contribuyente', 27.5, 580.9, 70, 6),
    crudo('25. Tipo de documento', 186.5, 580.9, 65, 6),
    crudo('Persona natural o sucesión ilíquida', 27.0, 569.5, 120, 7),
    crudo('Para uso exclusivo de la DIAN', 259.8, 114.5, 90),
    crudo('Fecha generación documento PDF: 01-02-2025 10:00:00AM', 433.9, 17.0, 160),
  ];
}

function rutContinuacion(hoja) {
  return [
    crudo('Página', 428, 724.5, 20), crudo('2', 474.6, 724.5, 4), crudo('de', 491.7, 724.5, 8), crudo('3', 525.5, 724.5, 4),
    crudo(`Hoja ${hoja}`, 548.0, 724.5, 22),
    crudo('5. Número de Identificación Tributaria (NIT)', 27.5, 616.4, 150),
    crudo('12. Dirección seccional', 205.5, 616.4, 70),
    crudo('Fecha generación documento PDF: 01-02-2025 10:00:00AM', 433.9, 17.0, 160),
  ];
}

function ritPagina(i, n, principal) {
  const out = [
    crudo(`Página ${i}/ ${n}`, 759, 813.4, 40, 9),
    crudo('DIRECCIÓN DE IMPUESTOS DE BOGOTÁ', 324, 789, 236, 12),
    crudo('REGISTRO DE INFORMACIÓN TRIBUTARIA - RIT', 304, 769, 276, 12),
    crudo('INFORMACIÓN BÁSICA DEL CONTRIBUYENTE', 309, 743, 265, 12),
    crudo('Fecha:01/02/2025', 709.5, 732.6, 72, 9),
    crudo('CONTRIBUYENTE', 29, 699.5, 102, 12),
    crudo('Fuente: RIT-SHD', 431, 42.5, 80, 9),
  ];
  if (principal) {
    out.push(crudo('PERFIL TRIBUTARIO', 360, 559.5, 120, 12));
    out.push(crudo('Actividad 1:', 35, 485.6, 60, 11));
    out.push(crudo('7490 - Otras actividades profesionales, científicas y técnicas n.c.p.', 108, 486.5, 400, 11));
  } else {
    out.push(crudo('REPRESENTANTES ACTIVOS', 343, 250.9, 150, 12));
  }
  return out;
}

const solicitudRit = () => [
  crudo('SOLICITUD DE REGISTRO Y/O NOVEDADES RIT', 147, 764.3, 250, 12),
  crudo('DIRECCION DISTRITAL DE IMPUESTOS DE BOGOTÁ - DIB', 131, 755.6, 260, 10),
  crudo('Lea las instrucciones al respaldo, diligencie sin tachones, borrones ni enmendaduras', 120, 734, 380, 8),
  crudo('A. OPCIÓN DE USO', 26, 713.8, 80, 8),
];
const instruccionesRit = () => [
  crudo('RIT', 168, 774.7, 20, 10), crudo('INSTRUCCIONES', 354, 774.7, 80, 10),
  crudo('“Este formato debe ser diligenciado por los contribuyentes que presenten solicitud de inscripción y/o novedades en el RIT”', 40, 766.6, 520, 8),
  crudo('INSTRUCCIONES DE DILIGENCIAMIENTO', 40, 740, 200, 8),
];
const formularioRitViejo = () => [
  crudo('Registro de Información Tributaria', 199, 880.3, 150, 10),
  crudo('RIT', 100, 865.1, 20, 10),
  crudo('Lea las instrucciones al respaldo', 210, 862.1, 150, 8),
  crudo('A. OPCION DE USO', 65, 835.3, 80, 8),
];
const paginaHojaDeVida = () => [
  crudo('HOJA DE VIDA', 250, 750, 80, 12),
  crudo('Número de Identificación Tributaria', 50, 700, 160),
  crudo('La presente certificación se expide a solicitud del interesado.', 50, 680, 280),
  crudo('Fecha de expedición: 01/02/2025', 50, 660, 150),
];
const paginaBasura = () => [crudo('\u0017\u0000\u0018\u001a\u001b\u0016\u0019\u001c\u001d\u001e\u001f!#\u0000\u0017\u0018\u0019\u001a\u001b\u001c', 31.3, 723.5, 100)];

// ---------------------------------------------------------------- generador de PDF mínimo

function escPdf(s) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }

/**
 * PDF 1.4 mínimo con Helvetica (WinAnsi). paginas: [{ textos: [{x, y, texto, size}], dibujo }].
 * cifrado: agrega un diccionario /Encrypt cuya contraseña de usuario no es vacía → PasswordException.
 */
function construirPdf({ paginas, cifrado = false, info = null }) {
  const objs = [];
  const reservar = () => { objs.push(null); return objs.length; };
  const fijar = (id, cuerpo) => { objs[id - 1] = cuerpo; };
  const catalogo = reservar();
  const raiz = reservar();
  const fuente = reservar();
  fijar(fuente, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const hijos = [];
  for (const p of paginas) {
    let cs = '';
    for (const t of p.textos || []) cs += `BT /F1 ${t.size || 10} Tf 1 0 0 1 ${t.x} ${t.y} Tm (${escPdf(t.texto)}) Tj ET\n`;
    if (p.dibujo) cs += p.dibujo + '\n';
    const contenido = reservar();
    fijar(contenido, `<< /Length ${Buffer.byteLength(cs, 'latin1')} >>\nstream\n${cs}endstream`);
    const pg = reservar();
    fijar(pg, `<< /Type /Page /Parent ${raiz} 0 R /MediaBox [0 0 ${p.ancho || 612} ${p.alto || 792}] ` +
      `/Resources << /Font << /F1 ${fuente} 0 R >> >> /Contents ${contenido} 0 R >>`);
    hijos.push(pg);
  }
  fijar(catalogo, `<< /Type /Catalog /Pages ${raiz} 0 R >>`);
  fijar(raiz, `<< /Type /Pages /Kids [${hijos.map((k) => k + ' 0 R').join(' ')}] /Count ${hijos.length} >>`);
  let infoId = null;
  if (info) {
    infoId = reservar();
    fijar(infoId, '<< ' + Object.entries(info).map(([k, v]) => `/${k} (${escPdf(v)})`).join(' ') + ' >>');
  }
  let cifradoId = null;
  if (cifrado) {
    cifradoId = reservar();
    fijar(cifradoId, `<< /Filter /Standard /V 1 /R 2 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> /P -4 >>`);
  }
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const desplazamientos = [];
  objs.forEach((cuerpo, i) => {
    desplazamientos.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + desplazamientos.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R` +
    (infoId ? ` /Info ${infoId} 0 R` : '') +
    (cifradoId ? ` /Encrypt ${cifradoId} 0 R /ID [<${'01'.repeat(16)}> <${'01'.repeat(16)}>]` : '') +
    ` >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

const PDF_TEXTO = () => construirPdf({
  info: { Producer: 'Generador de prueba', Creator: 'pdftext.test', CreationDate: "D:20250102030405-05'00'" },
  paginas: [
    { textos: [
      { x: 27.5, y: 616.4, texto: '5. Número de Identificación Tributaria (NIT)' },
      { x: 30, y: 603.5, texto: 'PEREZ' },
      { x: 80, y: 603.5, texto: 'ÑANDÚ' },
      { x: 30, y: 700, texto: 'Encabezado de prueba' },
    ] },
    { textos: [{ x: 50, y: 500, texto: 'Segunda página de prueba con texto suficiente' }] },
  ],
});
const PDF_IMAGEN = () => construirPdf({ paginas: [{ dibujo: '0 0 m 100 100 l S' }] });
const BASURA = '\x01\x02\x03\x04\x05\x06\x07\x08\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b';
const PDF_BASURA = () => construirPdf({ paginas: [{ textos: [{ x: 20, y: 700, texto: BASURA }] }] });

async function codigoDeError(promesa) {
  try { await promesa; } catch (e) { return e.codigo; }
  return null;
}

// ================================================================ 1. utilidades

describe('utilidades de texto', () => {
  test('fold: quita tildes, pasa a minúsculas y conserva la longitud', () => {
    assert.equal(PdfText.fold('Ñandú ÁÉÍÓÚ Ü'), 'nandu aeiou u');
    assert.equal(PdfText.fold('Información\u00a0Básica'), 'informacion basica');
    assert.equal(PdfText.fold(null), '');
    assert.equal(PdfText.fold(undefined), '');
    for (const s of ['Dirección seccional', 'İstanbul', 'Bogota\u0301 D.C.', 'x\u0301y']) {
      assert.equal(PdfText.fold(s).length, s.normalize('NFC').length, s);
    }
    assert.equal(PdfText.compactar('5. Número de  Identificación\tTributaria'), '5.numerodeidentificaciontributaria');
  });

  test('ratioControl: proporción de caracteres de control sobre caracteres no blancos', () => {
    assert.equal(PdfText.ratioControl(''), 0);
    assert.equal(PdfText.ratioControl(null), 0);
    assert.equal(PdfText.ratioControl('Texto normal'), 0);
    assert.equal(PdfText.ratioControl('\u0017\u0000\u0018ab'), 3 / 5);
    assert.equal(PdfText.ratioControl('linea uno\nlinea dos\fpagina'), 0, '\\n y \\f no cuentan');
  });

  test('agruparLineas: y descendente, tolerancia 2 pt desde el primer item de la línea', () => {
    const items = [crudo('b', 50, 605.5, 4), crudo('c', 60, 603.5, 4), crudo('a', 10, 607.5, 4), crudo('z', 10, 100, 4), crudo('  ', 0, 607.5, 9)];
    const lineas = PdfText.agruparLineas(items);
    assert.deepEqual(lineas.map((l) => l.texto), ['a b', 'c', 'z']);
    assert.deepEqual(lineas.map((l) => l.y), [607.5, 603.5, 100]);
    assert.equal(lineas[0].x, 10);
    assert.equal(lineas[0].x2, 54);
    assert.equal(PdfText.agruparLineas(items, 5).length, 2, 'tolerancia configurable');
  });

  test('unirTexto: espacio solo si el hueco es > 0.8 pt', () => {
    const it = (str, x, w, y = 10) => ({ str, x, y, w, h: 8, x2: x + w, font: '' });
    assert.equal(PdfText.unirTexto([it('Iden', 0, 20), it('tificación', 20.05, 40)]), 'Identificación');
    assert.equal(PdfText.unirTexto([it('de', 0, 10), it('la', 10.7, 10)]), 'dela', 'hueco de 0.7: sin espacio');
    assert.equal(PdfText.unirTexto([it('de', 0, 10), it('la', 10.9, 10)]), 'de la', 'hueco de 0.9: espacio');
    assert.equal(PdfText.unirTexto([it('de', 0, 10), it('la', 11.6, 10)]), 'de la');
    assert.equal(PdfText.unirTexto([it('CL 90', 27, 20, 412.5), it('13 A', 27, 15, 400)]), 'CL 90 13 A', 'otra fila: espacio');
    assert.equal(PdfText.unirTexto([]), '');
  });

  test('buscar: encuentra etiquetas partidas en varios items y devuelve su geometría', () => {
    const lineas = PdfText.agruparLineas([
      crudo('24.', 27.5, 581, 7), crudo('Tipo de', 37.5, 581, 20), crudo('contribuyente', 59.1, 581, 40),
      crudo('25.', 186.5, 581, 7), crudo('Tipo de documento', 196.5, 581, 60),
      crudo('IDENTIFICACIÓN', 281.6, 592.1, 50),
    ]);
    const r = PdfText.buscar(lineas, /\b24\s*\.\s*tipo de contribuyente/);
    assert.ok(r);
    assert.equal(r.x, 27.5);
    assert.equal(r.x2, 99.1);
    assert.equal(r.y, 581);
    assert.equal(r.items.length, 3);
    assert.equal(r.indiceLinea, 1);
    const s = PdfText.buscar(lineas, 'Identificación');
    assert.equal(s.x, 281.6);
    assert.equal(PdfText.buscar(lineas, /no existe/), null);
    const todos = PdfText.buscarTodos(lineas, /tipo de/g);
    assert.deepEqual(todos.map((t) => t.x), [37.5, 196.5]);
  });

  test('buscar: funciona con etiquetas partidas carácter por carácter (PDF re-procesado)', () => {
    const lineas = PdfText.agruparLineas(partido('5. Número de Identificación Tributaria (NIT)', 27.5, 616.5));
    assert.equal(lineas[0].texto, '5. Número de Identificación Tributaria (NIT)');
    const r = PdfText.buscar(lineas, /numero de identificacion tributaria/);
    assert.ok(r.x > 27.5 && r.x2 > r.x);
  });

  test('region: x en [xLo, xHi) e y en (yLo, yHi), en orden de lectura', () => {
    const items = PdfText.armarDoc([pagina(1, rutPrincipal())]).paginas[0].items;
    const r = PdfText.region(items, 80, 185, 600, 613);
    assert.deepEqual(r.map((i) => i.str), ['9', '0', '0']);
  });

  test('fechaPdf: convierte fechas de metadatos PDF a ISO', () => {
    assert.equal(PdfText.fechaPdf("D:20200818170908-05'00'"), '2020-08-18T17:09:08-05:00');
    assert.equal(PdfText.fechaPdf('D:20240101120000Z'), '2024-01-01T12:00:00Z');
    assert.equal(PdfText.fechaPdf('D:2021'), '2021-01-01T00:00:00');
    assert.equal(PdfText.fechaPdf(''), '');
    assert.equal(PdfText.fechaPdf('basura'), '');
  });

  test('mensajes de error en español con la ayuda de descarga', () => {
    for (const c of PdfText.CODIGOS) {
      const e = PdfText.crearError(c);
      assert.equal(e.codigo, c);
      assert.equal(e.name, 'PdfTextError');
      assert.ok(e.message.length > 40, c);
    }
    assert.match(PdfText.mensajeError('SIN_TEXTO', 'RUT'), /MUISCA/);
    assert.doesNotMatch(PdfText.mensajeError('SIN_TEXTO', 'RUT'), /Hacienda/);
    assert.match(PdfText.mensajeError('SIN_TEXTO', 'RIT'), /Mi RIT → Certificado RIT/);
    assert.match(PdfText.mensajeError('TEXTO_ILEGIBLE'), /Copia del RUT.*Certificado RIT/s);
    assert.match(PdfText.mensajeError('PROTEGIDO'), /contraseña/);
  });
});

// ================================================================ 2. armarDoc + DocDetect

describe('armarDoc', () => {
  test('normaliza items: descarta blancos, NFC, coordenadas PDF (y hacia arriba), x2 = x + w', () => {
    const doc = PdfText.armarDoc([pagina(1, [
      crudo('', 10, 700, 0), crudo('   ', 10, 700, 50), crudo('\u00a0', 10, 700, 5),
      crudo('Bogota\u0301 D.C.', 30, 700, 40), crudo('Abajo en la página', 30, 50, 60),
      crudo('Arriba en la página', 30, 750, 60),
    ])], { Producer: 'iText', Creator: 'x', CreationDate: 'D:2025', ModDate: null, Title: 'ignorado' });
    const p = doc.paginas[0];
    assert.equal(p.crudos.length, 6, 'crudos sin tocar');
    assert.deepEqual(p.items.map((i) => i.str), ['Arriba en la página', 'Bogotá D.C.', 'Abajo en la página']);
    assert.deepEqual(Object.keys(p.items[0]).sort(), ['font', 'h', 'str', 'w', 'x', 'x2', 'y']);
    assert.equal(p.items[1].x2, 70);
    assert.equal(p.items[0].y, 750);
    assert.equal(doc.texto, 'Arriba en la página\nBogotá D.C.\nAbajo en la página');
    assert.deepEqual(doc.info, { Producer: 'iText', Creator: 'x', CreationDate: 'D:2025', ModDate: '' });
    assert.equal(doc.tieneTexto, true);
    assert.equal(doc.numPaginas, 1);
    assert.equal(doc.problema, null);
  });

  test('acepta el formato de los volcados ({pages:[{page,width,height,items}]}) e items {x,y,w,h}', () => {
    const doc = PdfText.armarDoc({
      info: { Producer: 'p' },
      pages: [{ page: 3, width: 859, height: 842, items: [{ str: 'REGISTRO DE INFORMACIÓN TRIBUTARIA - RIT', x: 304, y: 769, w: 276, h: 12, font: 'f1' }] }],
    });
    assert.equal(doc.paginas[0].numero, 3);
    assert.equal(doc.paginas[0].ancho, 859);
    assert.equal(doc.paginas[0].items[0].x2, 580);
    assert.equal(doc.paginas[0].items[0].font, 'f1');
    assert.equal(doc.info.Producer, 'p');
  });

  test('páginas separadas por \\f; las ilegibles no aportan texto', () => {
    const doc = PdfText.armarDoc([pagina(1, rutPrincipal()), pagina(2, paginaBasura()), pagina(3, [])]);
    const partes = doc.texto.split('\f');
    assert.equal(partes.length, 3);
    assert.equal(partes[1], '');
    assert.equal(partes[2], '');
    assert.equal(doc.paginas[1].ilegible, true);
    assert.ok(doc.paginas[1].ratioControl > PdfText.UMBRAL_CONTROL);
    assert.equal(doc.paginas[2].sinTexto, true);
    assert.equal(doc.paginas[0].ilegible, false);
    assert.equal(doc.tieneTexto, true);
  });

  test('SIN_TEXTO / TEXTO_ILEGIBLE solo si ninguna página sirve; tolerante no lanza', () => {
    assert.throws(() => PdfText.armarDoc([pagina(1, []), pagina(2, [crudo('3', 300, 20, 4)])]), { codigo: 'SIN_TEXTO' });
    assert.throws(() => PdfText.armarDoc([pagina(1, []), pagina(2, paginaBasura())]), { codigo: 'TEXTO_ILEGIBLE' });
    const doc = PdfText.armarDoc([pagina(1, paginaBasura())], null, { tolerante: true });
    assert.equal(doc.tieneTexto, false);
    assert.equal(doc.problema, 'TEXTO_ILEGIBLE');
    assert.equal(DocDetect.tipo(doc), 'DESCONOCIDO');
  });

  test('regresión: 150 000 items en una sola línea no lanzan RangeError (antes Math.max.apply)', () => {
    const N = 150000;
    const crudos = [crudo('Inicio de la línea', 10, 400, 60)];
    for (let i = 0; i < N; i++) crudos.push(crudo('x', 80 + i * 0.001, 400, 1));
    let doc;
    assert.doesNotThrow(() => { doc = PdfText.armarDoc([pagina(1, crudos)]); });
    const linea = doc.paginas[0].lineas[0];
    assert.equal(doc.paginas[0].lineas.length, 1);
    assert.equal(linea.items.length, N + 1);
    assert.equal(linea.x2, 80 + (N - 1) * 0.001 + 1);
    // buscar() devuelve la geometría de una coincidencia que abarca todos los items de la línea.
    const r = PdfText.buscar(doc.paginas[0].lineas, /inicio de la linea\s*x+$/);
    assert.ok(r, 'encuentra la coincidencia');
    assert.equal(r.items.length, N + 1);
    assert.equal(r.x2, linea.x2);
    assert.doesNotThrow(() => DocDetect.tipo(doc));
  });
});

describe('DocDetect', () => {
  const clases = (doc) => DocDetect.paginas(doc).map((p) => [p.numero, p.tipo, p.principal, p.hoja]);

  test('RUT: hoja principal y hojas de continuación', () => {
    const doc = PdfText.armarDoc([pagina(1, rutPrincipal()), pagina(2, rutContinuacion(2)), pagina(3, rutContinuacion(6))]);
    assert.equal(DocDetect.tipo(doc), 'RUT');
    assert.deepEqual(DocDetect.tipos(doc), ['RUT']);
    assert.deepEqual(clases(doc), [[1, 'RUT', true, 1], [2, 'RUT', false, 2], [3, 'RUT', false, 6]]);
  });

  test('RUT re-procesado (etiquetas partidas por carácter) se reconoce igual', () => {
    const crudos = [
      ...partido('5. Número de Identificación Tributaria (NIT)', 27.5, 616.5),
      ...partido('12. Dirección seccional', 205.4, 616.5),
      ...partido('24. Tipo de contribuyente', 27.5, 581.0),
      ...partido('Fecha generación documento PDF:', 434.0, 17.5),
    ];
    const doc = PdfText.armarDoc([pagina(1, crudos)]);
    assert.deepEqual(clases(doc), [[1, 'RUT', true, 1]]);
  });

  test('RIT: certificado con página principal y continuación', () => {
    const doc = PdfText.armarDoc([pagina(1, ritPagina(1, 2, true)), pagina(2, ritPagina(2, 2, false))]);
    assert.equal(DocDetect.tipo(doc), 'RIT');
    assert.deepEqual(clases(doc), [[1, 'RIT', true, 1], [2, 'RIT', false, 2]]);
  });

  test('formularios de solicitud del RIT → RIT_SOLICITUD (no son el certificado)', () => {
    const nuevo = PdfText.armarDoc([pagina(1, solicitudRit()), pagina(2, instruccionesRit())]);
    assert.equal(DocDetect.tipo(nuevo), 'RIT_SOLICITUD');
    assert.deepEqual(clases(nuevo), [[1, 'RIT_SOLICITUD', true, null], [2, 'RIT_SOLICITUD', false, null]]);
    const viejo = PdfText.armarDoc([pagina(1, formularioRitViejo())]);
    assert.equal(DocDetect.tipo(viejo), 'RIT_SOLICITUD');
  });

  test('documentos ajenos → DESCONOCIDO (aunque digan "hoja", "solicitud" o "NIT")', () => {
    const doc = PdfText.armarDoc([pagina(1, paginaHojaDeVida())]);
    assert.equal(DocDetect.tipo(doc), 'DESCONOCIDO');
    assert.deepEqual(DocDetect.tipos(doc), []);
    assert.deepEqual(clases(doc), [[1, 'DESCONOCIDO', false, null]]);
  });

  test('paquete mixto: imagen + basura + hoja de vida + RUT + RIT', () => {
    const doc = PdfText.armarDoc([
      pagina(1, paginaHojaDeVida()), pagina(2, []), pagina(3, paginaBasura()),
      pagina(4, rutPrincipal()), pagina(5, rutContinuacion(6)), pagina(6, ritPagina(1, 1, true)),
    ]);
    const pags = DocDetect.paginas(doc);
    assert.deepEqual(pags.map((p) => p.tipo), ['DESCONOCIDO', 'DESCONOCIDO', 'DESCONOCIDO', 'RUT', 'RUT', 'RIT']);
    assert.equal(pags[1].sinTexto, true);
    assert.equal(pags[2].ilegible, true);
    assert.deepEqual(pags.filter((p) => p.principal).map((p) => p.numero), [4, 6]);
    assert.equal(DocDetect.tipo(doc), 'RUT', 'gana la primera página principal');
    assert.deepEqual(DocDetect.tipos(doc), ['RUT', 'RIT']);
    const alReves = PdfText.armarDoc([pagina(1, rutContinuacion(6)), pagina(2, ritPagina(1, 1, true)), pagina(3, rutPrincipal())]);
    assert.equal(DocDetect.tipo(alReves), 'RIT');
  });

  test('tolera entradas vacías', () => {
    assert.equal(DocDetect.tipo(null), 'DESCONOCIDO');
    assert.deepEqual(DocDetect.paginas({}), []);
    assert.equal(DocDetect.clasificarPagina(null).tipo, 'DESCONOCIDO');
  });
});

// ================================================================ 3. leer() con pdf.js

describe('leer() con pdf.js', () => {
  test('PDF con texto: páginas, items en espacio de usuario PDF, líneas, texto e info', async () => {
    const doc = await PdfText.leer(PDF_TEXTO(), OPC);
    assert.equal(doc.numPaginas, 2);
    assert.equal(doc.paginas.length, 2);
    assert.equal(doc.truncado, false);
    const p = doc.paginas[0];
    assert.equal(p.numero, 1);
    assert.equal(p.ancho, 612);
    assert.equal(p.alto, 792);
    assert.deepEqual(p.caja, [0, 0, 612, 792]);
    assert.ok(p.crudos.length >= p.items.length && Array.isArray(p.crudos[0].transform));
    const enc = p.items.find((i) => i.str === 'Encabezado de prueba');
    assert.equal(enc.x, 30);
    assert.equal(enc.y, 700, 'y medido desde abajo (no se invierte)');
    assert.ok(enc.w > 0 && Math.abs(enc.x2 - (enc.x + enc.w)) < 1e-9);
    assert.deepEqual(p.lineas.map((l) => l.texto), ['Encabezado de prueba', '5. Número de Identificación Tributaria (NIT)', 'PEREZ ÑANDÚ']);
    assert.equal(doc.texto.split('\f').length, 2);
    assert.match(doc.texto, /\fSegunda página de prueba/);
    assert.equal(doc.tieneTexto, true);
    assert.deepEqual(doc.info, { Producer: 'Generador de prueba', Creator: 'pdftext.test', CreationDate: "D:20250102030405-05'00'", ModDate: '' });
  });

  test('acepta Uint8Array, Buffer, ArrayBuffer y Blob, y a pdf.js le entrega una copia', async () => {
    const bytes = PDF_TEXTO();
    const copia = bytes.slice();
    for (const entrada of [bytes, Buffer.from(bytes), bytes.buffer, new Blob([bytes])]) {
      const doc = await PdfText.leer(entrada, OPC);
      assert.equal(doc.paginas.length, 2);
    }
    assert.equal(bytes.buffer.byteLength, copia.length, 'el ArrayBuffer original no queda separado (detached)');
    assert.deepEqual(bytes, copia, 'los bytes originales no cambian');
  });

  test('opciones de getDocument, copia de datos y destrucción de la tarea', async () => {
    let parametros = null;
    let destruidas = 0;
    const espia = {
      getDocument(p) {
        parametros = p;
        const tarea = pdfjsLib.getDocument(p);
        const destruir = tarea.destroy.bind(tarea);
        tarea.destroy = () => { destruidas++; return destruir(); };
        return tarea;
      },
    };
    const bytes = PDF_TEXTO();
    await PdfText.leer(bytes, { pdfjsLib: espia });
    assert.equal(parametros.disableFontFace, true);
    assert.equal(parametros.isEvalSupported, false);
    assert.equal(parametros.useSystemFonts, false);
    assert.notEqual(parametros.data, bytes);
    assert.notEqual(parametros.data.buffer, bytes.buffer);
    assert.equal(destruidas, 1);
    await PdfText.leer(PDF_IMAGEN(), { pdfjsLib: espia }).catch(() => {});
    assert.equal(destruidas, 2, 'también se destruye cuando hay error');
  });

  test('maxPaginas y alProgresar', async () => {
    const llamadas = [];
    const doc = await PdfText.leer(PDF_TEXTO(), { ...OPC, maxPaginas: 1, alProgresar: (n, total) => llamadas.push([n, total]) });
    assert.equal(doc.paginas.length, 1);
    assert.equal(doc.numPaginas, 2);
    assert.equal(doc.truncado, true);
    assert.deepEqual(llamadas, [[1, 1]]);
  });

  test('NO_PDF: no es PDF, vacío, nulo o dañado', async () => {
    assert.equal(await codigoDeError(PdfText.leer(new TextEncoder().encode('hola, no soy un PDF'), OPC)), 'NO_PDF');
    assert.equal(await codigoDeError(PdfText.leer(new Uint8Array(0), OPC)), 'NO_PDF');
    assert.equal(await codigoDeError(PdfText.leer(null, OPC)), 'NO_PDF');
    assert.equal(await codigoDeError(PdfText.leer({ algo: 1 }, OPC)), 'NO_PDF');
    assert.equal(await codigoDeError(PdfText.leer(new TextEncoder().encode('%PDF-1.4\nbasura basura basura\n'), OPC)), 'NO_PDF');
  });

  test('PROTEGIDO: PDF con contraseña de apertura', async () => {
    const pdf = construirPdf({ cifrado: true, paginas: [{ textos: [{ x: 20, y: 700, texto: 'Contenido protegido de prueba' }] }] });
    await assert.rejects(PdfText.leer(pdf, OPC), (e) => e.codigo === 'PROTEGIDO' && /contraseña/.test(e.message) && e.causa.name === 'PasswordException');
  });

  test('SIN_TEXTO: PDF de solo imagen/dibujo', async () => {
    await assert.rejects(PdfText.leer(PDF_IMAGEN(), { ...OPC, documento: 'RUT' }), (e) => e.codigo === 'SIN_TEXTO' && /MUISCA/.test(e.message));
    const doc = await PdfText.leer(PDF_IMAGEN(), { ...OPC, tolerante: true });
    assert.equal(doc.tieneTexto, false);
    assert.equal(doc.problema, 'SIN_TEXTO');
    assert.equal(doc.paginas[0].sinTexto, true);
  });

  test('TEXTO_ILEGIBLE: texto hecho de códigos de control', async () => {
    await assert.rejects(PdfText.leer(PDF_BASURA(), OPC), { codigo: 'TEXTO_ILEGIBLE' });
  });

  test('paquete con páginas imagen y basura no falla si alguna página sirve', async () => {
    const pdf = construirPdf({ paginas: [
      { dibujo: '0 0 m 10 10 l S' },
      { textos: [{ x: 20, y: 700, texto: BASURA }] },
      { textos: [{ x: 20, y: 700, texto: 'Página con texto real y suficiente' }] },
    ] });
    const doc = await PdfText.leer(pdf, OPC);
    assert.deepEqual(doc.paginas.map((p) => [p.sinTexto, p.ilegible]), [[true, false], [false, true], [false, false]]);
    assert.equal(doc.texto, '\f\fPágina con texto real y suficiente');
  });

  test('LIB_NO_DISPONIBLE: sin pdf.js o con el worker caído', async () => {
    assert.equal(await codigoDeError(PdfText.leer(PDF_TEXTO(), { pdfjsLib: null })), 'LIB_NO_DISPONIBLE');
    assert.equal(await codigoDeError(PdfText.leer(PDF_TEXTO(), { pdfjsLib: {} })), 'LIB_NO_DISPONIBLE');
    const sinWorker = { getDocument: () => ({ promise: Promise.reject(new Error('Setting up fake worker failed')), destroy: async () => {} }) };
    assert.equal(await codigoDeError(PdfText.leer(PDF_TEXTO(), { pdfjsLib: sinWorker })), 'LIB_NO_DISPONIBLE');
  });

  test('sin opts usa pdf.js de node_modules (Node)', async () => {
    const log = console.log;
    console.log = () => {};
    try {
      const doc = await PdfText.leer(PDF_TEXTO());
      assert.equal(doc.paginas.length, 2);
    } finally { console.log = log; }
  });
});

// ================================================================ 4. muestras reales (opcional)

const MUESTRAS = (() => {
  try { return fs.readdirSync(DIR_MUESTRAS).filter((f) => /\.pdf$/i.test(f)).sort(); } catch (e) { return []; }
})();

// Página de la hoja principal del RUT dentro de cada paquete (RUT-REPORT §1 y §9).
const PAQUETES = {
  bundle_2022_corpocesar_proponente: 8,
  bundle_2025_pn_itp_hv_57p: 10,
  bundle_2025_pn_personeria_hv_22p: 9,
};
// Secuencias de hojas de los RUT de varias páginas (estructura, RUT-REPORT §1/§4).
const HOJAS = {
  rut_2014_amb_juridica: [1, 2, 3, 5],
  rut_2020_dian_blank_template: [1, 2, 3, 4, 5, 6, 7],
  rut_2020_pn_alquilarfincas: [1, 2, 6],
  rut_2021_pn_circasia: [1, 6],
  rut_2024_cce_edsautogas_juridica_20p: [1, 2, 3, 4, 5, ...Array(15).fill(6)],
  rut_2024_pn_cce_4620: [1, 2, 5, 6, 6],
  rut_2025_boyaca_proveedor_juridica: [1, 2, 3, 5],
  rut_2025_cce_procalculo_juridica: [1, 2, 3, 4, 5, 6],
};
const IMPRESO = /^rut_2026_banrep_juridica_printed/;

function invariantes(doc) {
  assert.equal(doc.paginas.length, doc.numPaginas);
  assert.equal(doc.texto.split('\f').length, doc.numPaginas);
  assert.deepEqual(Object.keys(doc.info).sort(), ['CreationDate', 'Creator', 'ModDate', 'Producer']);
  for (const p of doc.paginas) {
    assert.ok(p.ancho > 0 && p.alto > 0);
    assert.ok(p.crudos.length >= p.items.length);
    for (let i = 0; i < p.items.length; i++) {
      const it = p.items[i];
      assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y) && Number.isFinite(it.w));
      assert.ok(it.str.trim() !== '' && it.str === it.str.normalize('NFC'));
      assert.equal(it.x2, it.x + it.w);
      if (i) { const a = p.items[i - 1]; assert.ok(a.y > it.y || (a.y === it.y && a.x <= it.x), 'orden de lectura'); }
    }
    for (let i = 1; i < p.lineas.length; i++) assert.ok(p.lineas[i - 1].y - p.lineas[i].y > PdfText.TOL_LINEA);
    assert.equal(p.lineas.reduce((n, l) => n + l.items.length, 0), p.items.length);
  }
}

describe('muestras reales (carpeta de investigación)', { skip: MUESTRAS.length ? false : `no hay muestras en ${DIR_MUESTRAS}` }, () => {
  for (const archivo of MUESTRAS) {
    const nombre = archivo.replace(/\.pdf$/i, '');
    test(nombre, async () => {
      const bytes = fs.readFileSync(path.join(DIR_MUESTRAS, archivo));
      if (IMPRESO.test(nombre)) {
        await assert.rejects(PdfText.leer(bytes, OPC), { codigo: 'TEXTO_ILEGIBLE' });
        const doc = await PdfText.leer(bytes, { ...OPC, tolerante: true });
        assert.ok(doc.paginas.every((p) => p.ilegible));
        assert.equal(DocDetect.tipo(doc), 'DESCONOCIDO');
        return;
      }
      const doc = await PdfText.leer(bytes, OPC);
      invariantes(doc);
      assert.equal(doc.tieneTexto, true);
      const pags = DocDetect.paginas(doc);
      const tipo = DocDetect.tipo(doc);

      if (PAQUETES[nombre]) {
        assert.equal(tipo, 'RUT');
        const principales = pags.filter((p) => p.tipo === 'RUT' && p.principal);
        assert.deepEqual(principales.map((p) => p.numero), [PAQUETES[nombre]]);
        assert.ok(pags.some((p) => p.sinTexto), 'los paquetes traen páginas escaneadas');
        if (/personeria/.test(nombre)) assert.ok(pags.some((p) => p.ilegible), 'una página del paquete tiene texto basura');
      } else if (/^rut_/.test(nombre)) {
        assert.equal(tipo, 'RUT');
        assert.equal(pags[0].tipo, 'RUT');
        assert.equal(pags[0].principal, true);
        assert.equal(pags.filter((p) => p.principal).length, 1);
        const rut = pags.filter((p) => p.tipo === 'RUT');
        if (HOJAS[nombre]) assert.deepEqual(rut.map((p) => p.hoja), HOJAS[nombre]);
        assert.ok(rut.every((p) => p.hoja !== null));
      } else if (/^rit_/.test(nombre)) {
        assert.equal(tipo, 'RIT');
        assert.ok(pags.every((p) => p.tipo === 'RIT'));
        assert.deepEqual(pags.map((p) => p.principal), pags.map((p) => p.numero === 1));
        assert.deepEqual(pags.map((p) => p.hoja), pags.map((p) => p.numero));
      } else if (/^ritform_/.test(nombre)) {
        assert.equal(tipo, 'RIT_SOLICITUD');
        assert.equal(pags[0].principal, true);
      }
    });
  }
});
