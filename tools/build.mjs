#!/usr/bin/env node
// Construye UN solo archivo HTML autocontenido del formulario 13-IF-016 (funciona con file:// y sin red).
//
//   node tools/build.mjs [--entrada src/index.html] [--salida formulario-13-IF-016.html]
//
// - Incrusta cada <link rel="stylesheet" href="…"> local como <style> (con sus url() como data URI).
// - Incrusta cada <script src="…"> local (incluidas las librerías de ../node_modules/…).
//   Los scripts con `defer` se mueven al final de <body> para conservar su orden de ejecución.
// - Convierte las imágenes locales (<img src>, <link rel="icon">) en data URI.
// - Antes del primer script propio (no de node_modules) inyecta:
//     window.BUILD_INFO, window.PLANTILLA_XLSX_B64 (Excel original en base64),
//     window.LOGO_SRC (data URI) y window.PDFJS_WORKER_SRC (Blob URL creada en tiempo de ejecución
//     a partir del código del worker de pdf.js, que va en un <script type="text/plain">).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────── Argumentos ─────────────────────────

function leerArgs(argv) {
  const r = { entrada: path.join(RAIZ, 'src', 'index.html'), salida: path.join(RAIZ, 'formulario-13-IF-016.html') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--entrada' || a === '-e') r.entrada = path.resolve(argv[++i]);
    else if (a === '--salida' || a === '-o') r.salida = path.resolve(argv[++i]);
    else if (a === '--plantilla') r.plantilla = path.resolve(argv[++i]);
    else if (a === '--logo') r.logo = path.resolve(argv[++i]);
    else if (a === '--ayuda' || a === '--help' || a === '-h') r.ayuda = true;
    else throw new Error('Argumento desconocido: ' + a);
  }
  return r;
}

// ───────────────────────── Utilidades ─────────────────────────

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function esLocal(url) {
  return !!url && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);
}

function rutaLocal(base, url) {
  const limpio = decodeURI(url.split(/[?#]/)[0]);
  return path.resolve(base, limpio);
}

function leerObligatorio(ruta, desde) {
  if (!fs.existsSync(ruta)) throw new Error(`No existe ${path.relative(RAIZ, ruta)} (referenciado desde ${desde}).`);
  return fs.readFileSync(ruta);
}

function dataUri(ruta, desde) {
  const ext = path.extname(ruta).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`Tipo de archivo no soportado para incrustar: ${ruta}`);
  return `data:${mime};base64,${leerObligatorio(ruta, desde).toString('base64')}`;
}

function atributos(etiqueta) {
  const attrs = [];
  const cuerpo = etiqueta.replace(/^<\s*[\w-]+/, '').replace(/\/?>$/, '');
  const re = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(cuerpo))) attrs.push({ nombre: m[1].toLowerCase(), valor: m[2] ?? m[3] ?? m[4] ?? null });
  return attrs;
}

const attr = (attrs, n) => { const a = attrs.find((x) => x.nombre === n); return a ? a.valor : undefined; };
const tiene = (attrs, n) => attrs.some((x) => x.nombre === n);
const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const serializar = (attrs) => attrs.map((a) => (a.valor === null ? ` ${a.nombre}` : ` ${a.nombre}="${escAttr(a.valor)}"`)).join('');

// Código JS seguro dentro de <script>…</script>.
function scriptInline(codigo, attrsTexto = '') {
  if (/<!--|<script/i.test(codigo)) {
    // Caso raro: secuencias que alteran el análisis HTML del script. Se ejecuta desde una cadena JSON
    // con '<' escapado, que es inmune a cualquier contexto.
    const cadena = JSON.stringify(codigo).replace(/</g, '\\u003c');
    return `<script${attrsTexto}>(0, eval)(${cadena});</script>`;
  }
  return `<script${attrsTexto}>${codigo.replace(/<\/(script)/gi, '<\\/$1')}</script>`;
}

function estiloInline(css, attrsTexto = '') {
  return `<style${attrsTexto}>${css.replace(/<\/(style)/gi, '<\\/$1')}</style>`;
}

// url(...) locales dentro de un CSS -> data URI.
function incrustarUrlsCss(css, dirCss, desde) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (todo, comilla, url) => {
    if (!esLocal(url.trim()) || /^data:/i.test(url)) return todo;
    return `url("${dataUri(rutaLocal(dirCss, url.trim()), desde)}")`;
  });
}

function esVendor(ruta) {
  return ruta.split(path.sep).includes('node_modules');
}

function buscarPlantilla() {
  const candidatos = fs.readdirSync(RAIZ).filter((f) => /^13-IF-016.*\.xlsx$/i.test(f) && !f.startsWith('~$')).sort();
  if (!candidatos.length) throw new Error('No se encontró el Excel 13-IF-016*.xlsx en la raíz del repositorio.');
  return path.join(RAIZ, candidatos[0]);
}

function leerVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version || '0.0.0'; } catch (e) { return '0.0.0'; }
}

// ───────────────────────── Construcción ─────────────────────────

export function construir(opciones = {}) {
  const entrada = opciones.entrada || path.join(RAIZ, 'src', 'index.html');
  const salida = opciones.salida || path.join(RAIZ, 'formulario-13-IF-016.html');
  const base = path.dirname(entrada);
  const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, '/');
  let html = leerObligatorio(entrada, 'la línea de comandos').toString('utf8');

  // Proteger comentarios HTML para no procesar etiquetas comentadas.
  const comentarios = [];
  html = html.replace(/<!--[\s\S]*?-->/g, (c) => `\u0000C${comentarios.push(c) - 1}\u0000`);

  const informe = { estilos: [], scripts: [], imagenes: [] };
  let workerPdf = null;

  // 1) Hojas de estilo.
  html = html.replace(/<link\b[^>]*>/gi, (etiqueta) => {
    const attrs = atributos(etiqueta);
    const relAttr = (attr(attrs, 'rel') || '').toLowerCase().split(/\s+/);
    const href = attr(attrs, 'href');
    if (relAttr.includes('stylesheet')) {
      if (!esLocal(href)) throw new Error(`Hoja de estilo externa no permitida (el archivo debe funcionar sin red): ${href}`);
      const ruta = rutaLocal(base, href);
      const css = incrustarUrlsCss(leerObligatorio(ruta, rel(entrada)).toString('utf8'), path.dirname(ruta), rel(ruta));
      const media = attr(attrs, 'media');
      informe.estilos.push(rel(ruta));
      return estiloInline(`\n${css}\n`, media && media !== 'all' ? ` media="${escAttr(media)}"` : '');
    }
    if (relAttr.some((r) => r === 'icon' || r === 'apple-touch-icon') && esLocal(href)) {
      const ruta = rutaLocal(base, href);
      informe.imagenes.push(rel(ruta));
      return '<link' + serializar(attrs.map((a) => (a.nombre === 'href' ? { nombre: 'href', valor: dataUri(ruta, rel(entrada)) } : a))) + '>';
    }
    if (relAttr.some((r) => ['preload', 'modulepreload', 'prefetch', 'manifest'].includes(r)) && esLocal(href)) return '';
    return etiqueta;
  });

  // 2) Imágenes locales.
  html = html.replace(/<img\b[^>]*>/gi, (etiqueta) => {
    const attrs = atributos(etiqueta);
    const src = attr(attrs, 'src');
    if (!esLocal(src) || /^data:/i.test(src)) return etiqueta;
    const ruta = rutaLocal(base, src);
    informe.imagenes.push(rel(ruta));
    return '<img' + serializar(attrs.map((a) => (a.nombre === 'src' ? { nombre: 'src', valor: dataUri(ruta, rel(entrada)) } : a))) + '>';
  });

  // 3) Scripts. Se marcan con un token para luego decidir dónde inyectar el arranque.
  const scripts = [];
  html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi, (todo, contenido) => {
    const etiqueta = todo.slice(0, todo.indexOf('>') + 1);
    const attrs = atributos(etiqueta);
    const src = attr(attrs, 'src');
    if (src === undefined) {
      scripts.push({ tipo: 'inline', html: todo, vendor: false, defer: false });
      return `\u0000S${scripts.length - 1}\u0000`;
    }
    if (!esLocal(src)) throw new Error(`Script externo no permitido (el archivo debe funcionar sin red): ${src}`);
    const ruta = rutaLocal(base, src);
    const codigo = leerObligatorio(ruta, rel(entrada)).toString('utf8');
    const vendor = esVendor(ruta);
    if (vendor && /pdfjs-dist[\\/].*pdf(\.min)?\.js$/.test(ruta)) {
      const w = path.join(path.dirname(ruta), path.basename(ruta).replace(/^pdf/, 'pdf.worker'));
      if (fs.existsSync(w)) workerPdf = w;
    }
    const resto = attrs.filter((a) => !['src', 'defer', 'async', 'integrity', 'crossorigin', 'charset'].includes(a.nombre));
    informe.scripts.push(rel(ruta));
    scripts.push({
      tipo: 'archivo',
      html: scriptInline(`\n${codigo}\n//# sourceURL=${rel(ruta)}\n`, serializar(resto)),
      vendor,
      defer: tiene(attrs, 'defer') && (attr(attrs, 'type') || '') !== 'module',
    });
    return `\u0000S${scripts.length - 1}\u0000`;
  });

  // 4) Arranque inyectado (plantilla, logo, worker de pdf.js, versión).
  const rutaPlantilla = opciones.plantilla || buscarPlantilla();
  const plantillaB64 = fs.readFileSync(rutaPlantilla).toString('base64');
  const rutaLogo = opciones.logo || path.join(RAIZ, 'src', 'img', 'logo.png');
  const logo = fs.existsSync(rutaLogo) ? dataUri(rutaLogo, 'build') : '';
  if (!workerPdf) {
    const w = path.join(RAIZ, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.js');
    if (fs.existsSync(w)) workerPdf = w;
  }
  const version = leerVersion();
  const fecha = new Date().toISOString();
  const info = { version, fecha, plantilla: path.basename(rutaPlantilla) };

  let arranque = '';
  if (workerPdf) {
    const codigoWorker = fs.readFileSync(workerPdf, 'utf8');
    if (/<!--|<script/i.test(codigoWorker)) {
      // Respaldo: el worker como cadena JSON (con '<' escapado).
      const cadena = JSON.stringify(codigoWorker).replace(/</g, '\\u003c');
      arranque += `<script>window.__PDFJS_WORKER_CODE__ = ${cadena};</script>\n`;
    } else {
      arranque += `<script type="text/plain" id="pdfjs-worker-src">${codigoWorker.replace(/<\/(script)/gi, '<\\/$1')}</script>\n`;
    }
  }
  arranque += scriptInline(`
/* Formulario 13-IF-016 · versión ${version} · construido ${fecha} por tools/build.mjs */
window.BUILD_INFO = ${JSON.stringify(info)};
window.PLANTILLA_XLSX_B64 = "${plantillaB64}";
window.LOGO_SRC = ${JSON.stringify(logo)};
(function () {
  try {
    var el = document.getElementById('pdfjs-worker-src');
    var codigo = el ? el.textContent : window.__PDFJS_WORKER_CODE__;
    if (!codigo) return;
    var url = URL.createObjectURL(new Blob([codigo], { type: 'text/javascript' }));
    window.PDFJS_WORKER_SRC = url;
    // El bloque se deja en la página: el formulario se guarda copiando su propio HTML (guardado.js)
    // y la copia necesita el worker para seguir leyendo PDF.
    window.__PDFJS_WORKER_CODE__ = undefined;
    // Con file:// (origen "null") pdf.js envuelve un workerSrc en importScripts(), que falla, y termina
    // procesando en el hilo principal. Se le entrega un Worker real, creado al primer uso (workerPort).
    var instalar = function () {
      var o = window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions;
      if (!o) return false;
      var puerto = o.workerPort || null;
      Object.defineProperty(o, 'workerPort', {
        configurable: true,
        enumerable: true,
        get: function () {
          if (!puerto && typeof Worker === 'function') {
            try { puerto = new Worker(url); } catch (e) { puerto = null; }
          }
          return puerto;
        },
        set: function (v) { puerto = v; }
      });
      if (!o.workerSrc) o.workerSrc = url;
      return true;
    };
    if (!instalar()) document.addEventListener('DOMContentLoaded', instalar, { once: true });
  } catch (e) {
    if (window.console) console.warn('No se pudo preparar el worker de pdf.js', e);
  }
})();
`) + '\n';

  // Insertar antes del primer script propio (o del primero, o al final de <head>).
  let idxArranque = scripts.findIndex((s) => !s.vendor && !s.defer);
  if (idxArranque < 0) idxArranque = scripts.findIndex((s) => !s.defer);
  const diferidos = scripts.map((s, i) => (s.defer ? i : -1)).filter((i) => i >= 0);

  html = html.replace(/\u0000S(\d+)\u0000/g, (_, n) => {
    const i = Number(n);
    const s = scripts[i];
    if (s.defer) return '';
    return (i === idxArranque ? arranque : '') + s.html;
  });
  if (idxArranque < 0) {
    if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, (m) => arranque + m);
    else html = arranque + html;
  }
  if (diferidos.length) {
    const bloque = diferidos.map((i) => scripts[i].html).join('\n') + '\n';
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>(?![\s\S]*<\/body>)/i, (m) => bloque + m);
    else html += bloque;
  }

  // Restaurar comentarios y añadir la marca de construcción.
  html = html.replace(/\u0000C(\d+)\u0000/g, (_, n) => comentarios[Number(n)]);
  const marca = `<!-- Formulario 13-IF-016 · versión ${version} · construido ${fecha} con tools/build.mjs · archivo autocontenido, no editar a mano -->\n`;
  if (/^\s*<!doctype[^>]*>/i.test(html)) html = html.replace(/^\s*<!doctype[^>]*>\s*/i, (m) => m.trimEnd() + '\n' + marca);
  else html = marca + html;

  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, html, 'utf8');
  return { salida, bytes: Buffer.byteLength(html), ...informe, worker: workerPdf ? rel(workerPdf) : null, plantilla: rel(rutaPlantilla) };
}

/**
 * version.json en la raíz: lo consultan los formularios ya entregados para avisar que hay una versión
 * nueva (app.js → buscarActualizacion). La versión sale de package.json; "notas" se escribe a mano
 * (un texto corto que ve el contratista) y se conserva entre builds.
 */
function escribirVersionJson() {
  const ruta = path.join(RAIZ, 'version.json');
  let notas = '';
  try { notas = String(JSON.parse(fs.readFileSync(ruta, 'utf8')).notas || ''); } catch (e) { /* primera vez */ }
  const datos = { version: leerVersion(), notas };
  fs.writeFileSync(ruta, JSON.stringify(datos, null, 2) + '\n', 'utf8');
  return datos;
}

// ───────────────────────── CLI ─────────────────────────

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  try {
    const args = leerArgs(process.argv.slice(2));
    if (args.ayuda) {
      console.log('Uso: node tools/build.mjs [--entrada src/index.html] [--salida formulario-13-IF-016.html] [--plantilla x.xlsx] [--logo x.png]');
      process.exit(0);
    }
    const r = construir(args);
    const v = escribirVersionJson();
    console.log(`version.json: ${v.version}${v.notas ? ' · ' + v.notas : ''}`);
    console.log(`Listo: ${path.relative(process.cwd(), r.salida) || r.salida} (${(r.bytes / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  estilos: ${r.estilos.length} · scripts: ${r.scripts.length} · imágenes: ${r.imagenes.length} · worker pdf.js: ${r.worker || 'no'} · plantilla: ${r.plantilla}`);
  } catch (e) {
    console.error('Error en el build: ' + e.message);
    process.exit(1);
  }
}
