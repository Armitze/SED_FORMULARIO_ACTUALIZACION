// Guardado dentro del propio archivo HTML, como un Excel: los datos del contratista viajan en un bloque
// <script type="application/json" id="datos-formulario"> del mismo archivo. Al abrir el archivo se leen de
// ahí; al guardar se escribe una copia completa del HTML con ese bloque actualizado.
//
// - La primera vez la persona elige dónde guardar ("Guardar como"); en Chrome/Edge el formulario recuerda
//   ese archivo (IndexedDB) y desde ahí lo autoguarda.
// - Navegadores sin acceso a archivos (Firefox, Safari): "Guardar" descarga una copia del HTML con los datos.
// - La memoria del navegador (localStorage) solo es una red de seguridad para lo que aún no llega al archivo.
(function (root) {
  const ID_BLOQUE = 'datos-formulario';
  const BASE_DATOS = 'sed-13-IF-016';
  const ALMACEN = 'archivos';
  const PREFIJO_PENDIENTE = 'sed-13-IF-016:pendiente:';
  const RE_BLOQUE = /(<script\b[^>]*\bid=["']?datos-formulario["']?[^>]*>)([\s\S]*?)(<\/script\s*>)/i;

  let plantilla = null;

  /**
   * Toma el HTML del documento tal como se abrió. Debe llamarse antes de que la aplicación pinte nada
   * (al iniciar): todo lo que se agregue después a la página no debe quedar en el archivo guardado.
   */
  function capturar(doc) {
    if (plantilla) return plantilla;
    const d = doc || root.document;
    if (!d || !d.documentElement) return null;
    const tipo = d.doctype ? '<!DOCTYPE ' + d.doctype.name + '>' : '<!DOCTYPE html>';
    plantilla = tipo + '\n' + d.documentElement.outerHTML;
    return plantilla;
  }

  /** Datos guardados en el archivo abierto (o null si es un formulario en limpio). */
  function leerEmbebido(doc) {
    const d = doc || root.document;
    const el = d && d.getElementById ? d.getElementById(ID_BLOQUE) : null;
    if (!el) return null;
    const texto = String(el.textContent || '').trim();
    if (!texto) return null;
    try {
      const datos = JSON.parse(texto);
      return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : null;
    } catch (e) {
      return null;
    }
  }

  /** Datos guardados en el texto de un archivo HTML del formulario (o null): para leer formularios recibidos. */
  function leerDeTexto(texto) {
    const m = RE_BLOQUE.exec(String(texto || ''));
    const contenido = m ? m[2].trim() : '';
    if (!contenido) return null;
    try {
      const datos = JSON.parse(contenido);
      return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : null;
    } catch (e) {
      return null;
    }
  }

  /** JSON seguro dentro de <script>: '<' y los separadores de línea de Unicode van escapados. */
  const BARRA = String.fromCharCode(92);
  const SEPARADORES = [['<', 0x3c], [String.fromCharCode(0x2028), 0x2028], [String.fromCharCode(0x2029), 0x2029]];
  function jsonSeguro(datos) {
    let t = JSON.stringify(datos);
    for (const [caracter, codigo] of SEPARADORES) t = t.split(caracter).join(BARRA + 'u' + codigo.toString(16).padStart(4, '0'));
    return t;
  }

  /** HTML completo con los datos dentro (datos null = formulario en limpio). */
  function html(datos, base) {
    const b = base || plantilla;
    if (!b) throw codigo('SIN_PLANTILLA', 'No tenemos una copia del formulario para guardar.');
    if (!RE_BLOQUE.test(b)) throw codigo('SIN_BLOQUE', 'Esta versión del formulario no permite guardar datos dentro del archivo.');
    return b.replace(RE_BLOQUE, (todo, apertura, contenido, cierre) => apertura + (datos ? jsonSeguro(datos) : '') + cierre);
  }

  function codigo(c, mensaje) {
    const e = new Error(mensaje || c);
    e.codigo = c;
    return e;
  }

  // ─────────── Versiones publicadas ───────────

  /** true si la versión a es mayor que b ('1.10' > '1.9' > '1.01'): compara cada parte como número. */
  function versionMayor(a, b) {
    const x = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
    const y = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }

  /** true si el texto es un formulario 13-IF-016 construido que puede llevar datos (para actualizar). */
  function esFormulario(texto) {
    const t = String(texto || '');
    return /<!--\s*Formulario 13-IF-016 · versión /.test(t.slice(0, 2000)) && RE_BLOQUE.test(t);
  }

  // ─────────── Archivos (Chrome / Edge) ───────────

  const soportaArchivos = () => typeof root.showSaveFilePicker === 'function';

  // Carpetas en las que el navegador puede abrir directamente el cuadro de guardar (startIn).
  const CARPETAS = [
    [/^(downloads|descargas)$/, 'downloads'], [/^(desktop|escritorio)$/, 'desktop'],
    [/^(documents|documentos|mis documentos)$/, 'documents'], [/^(pictures|imagenes|imágenes)$/, 'pictures'],
    [/^(music|musica|música)$/, 'music'], [/^(videos|vídeos)$/, 'videos'],
  ];

  /**
   * Archivo desde el que se abrió el formulario (solo file://): { nombre, carpeta } donde carpeta es la
   * carpeta conocida que lo contiene ('downloads', 'desktop'…) o null. url: para pruebas.
   */
  function archivoActual(url) {
    let u;
    try { u = new URL(url || root.location.href); } catch (e) { return { nombre: '', carpeta: null }; }
    if (u.protocol !== 'file:') return { nombre: '', carpeta: null };
    const partes = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    const nombre = partes.length ? partes[partes.length - 1] : '';
    const padre = partes.length > 1 ? partes[partes.length - 2].toLowerCase() : '';
    const hallada = CARPETAS.find(([re]) => re.test(padre));
    const esHtml = ['.html', '.htm'].some((ext) => nombre.toLowerCase().endsWith(ext));
    return { nombre: esHtml ? nombre : '', carpeta: hallada ? hallada[1] : null };
  }

  /**
   * "Guardar como": devuelve el manejador del archivo elegido. Lanza AbortError si la persona cancela.
   * carpeta: carpeta conocida donde abrir el cuadro (la del archivo abierto, para guardar sobre él).
   */
  function elegirArchivo(nombreSugerido, carpeta) {
    const opciones = {
      suggestedName: nombreSugerido || 'formulario-13-IF-016.html',
      types: [{ description: 'Formulario 13-IF-016', accept: { 'text/html': ['.html', '.htm'] } }],
    };
    if (carpeta) opciones.startIn = carpeta;
    // Se llama sin await previo: el navegador exige que venga directo de un clic.
    return root.showSaveFilePicker(opciones);
  }

  /** 'granted' | 'prompt' | 'denied'. pedir: solicita el permiso (necesita un gesto de la persona). */
  async function permiso(manejador, pedir) {
    if (!manejador) return 'denied';
    const op = { mode: 'readwrite' };
    try {
      let p = typeof manejador.queryPermission === 'function' ? await manejador.queryPermission(op) : 'granted';
      if (p !== 'granted' && pedir && typeof manejador.requestPermission === 'function') p = await manejador.requestPermission(op);
      return p;
    } catch (e) {
      return 'denied';
    }
  }

  async function escribir(manejador, texto) {
    const w = await manejador.createWritable();
    try {
      await w.write(new Blob([texto], { type: 'text/html' }));
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch (e2) { /* nada */ }
      throw e;
    }
  }

  /** Descarga una copia (navegadores sin acceso a archivos). */
  function descargar(texto, nombre) {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/html' }));
    const a = root.document.createElement('a');
    a.href = url;
    a.download = nombre || 'formulario-13-IF-016.html';
    a.hidden = true;
    root.document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ─────────── Recordar el archivo de cada formulario (IndexedDB) ───────────

  function abrirBase() {
    return new Promise((resolver, rechazar) => {
      if (!root.indexedDB) { rechazar(codigo('SIN_INDEXEDDB')); return; }
      const pet = root.indexedDB.open(BASE_DATOS, 1);
      pet.onupgradeneeded = () => { if (!pet.result.objectStoreNames.contains(ALMACEN)) pet.result.createObjectStore(ALMACEN); };
      pet.onsuccess = () => resolver(pet.result);
      pet.onerror = () => rechazar(pet.error);
    });
  }

  async function operacion(modo, fn) {
    const db = await abrirBase();
    try {
      return await new Promise((resolver, rechazar) => {
        const tx = db.transaction(ALMACEN, modo);
        const pet = fn(tx.objectStore(ALMACEN));
        tx.oncomplete = () => resolver(pet ? pet.result : undefined);
        tx.onerror = () => rechazar(tx.error);
        tx.onabort = () => rechazar(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async function recordarArchivo(id, manejador) {
    try { await operacion('readwrite', (s) => s.put(manejador, id)); return true; } catch (e) { return false; }
  }

  async function archivoRecordado(id) {
    if (!id) return null;
    try { return (await operacion('readonly', (s) => s.get(id))) || null; } catch (e) { return null; }
  }

  // ─────────── Red de seguridad (localStorage) ───────────

  const clavePendiente = (id) => PREFIJO_PENDIENTE + (id || 'nuevo');

  function guardarPendiente(id, datos) {
    try { root.localStorage.setItem(clavePendiente(id), JSON.stringify(datos)); return true; } catch (e) { return false; }
  }

  function leerPendiente(id) {
    try {
      const crudo = root.localStorage.getItem(clavePendiente(id));
      const d = crudo ? JSON.parse(crudo) : null;
      return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
    } catch (e) {
      return null;
    }
  }

  function borrarPendiente(id) {
    try { root.localStorage.removeItem(clavePendiente(id)); } catch (e) { /* nada */ }
  }

  function nuevoId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  const Guardado = {
    ID_BLOQUE, capturar, leerEmbebido, leerDeTexto, html, jsonSeguro, versionMayor, esFormulario, soportaArchivos, archivoActual, elegirArchivo, permiso, escribir, descargar,
    recordarArchivo, archivoRecordado, guardarPendiente, leerPendiente, borrarPendiente, nuevoId,
    _reiniciarPlantilla: () => { plantilla = null; },
  };
  root.Guardado = Guardado;
  if (typeof module !== 'undefined' && module.exports) module.exports = Guardado;
})(typeof window !== 'undefined' ? window : globalThis);
