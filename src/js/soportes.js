// Soportes adjuntos (certificación bancaria y certificados de deducciones) guardados dentro del propio
// archivo HTML, junto con los datos del formulario (guardado.js). Cada archivo va en base64.
//
// API (window.Soportes):
//   CLAVES                         tipos de soporte: banco, dependientes, hipotecario, saludNoPos
//   limites(cfg?)                  { maxArchivo, maxTotal, maxPorTipo } en bytes (de CONFIG.soportes)
//   leer(file, lim?) -> Promise<item>         valida tamaño y contenido (PDF, JPG o PNG) y lo codifica
//   comprobar(soportes, clave, item, lim?)    error (con .codigo) si no cabe, o null
//   normalizar(obj, lim?) -> soportes         lo que viene del archivo o del respaldo, validado
//   totalBytes(soportes), cantidad(soportes), aBlob(item), tamanoTexto(bytes)
//   guardarRespaldo(id, soportes) / leerRespaldo(id) / borrarRespaldo(id)   copia en IndexedDB
//
// item: { id, nombre, tipo: 'application/pdf' | 'image/jpeg' | 'image/png', bytes, fecha, datos (base64) }
// soportes: { clave: [item, …] } (solo las claves con archivos)
(function (root) {
  'use strict';

  const CLAVES = ['banco', 'dependientes', 'hipotecario', 'saludNoPos'];
  const MB = 1024 * 1024;
  const BASE_DATOS = 'sed-13-IF-016-soportes';
  const ALMACEN = 'soportes';

  function limites(cfg) {
    const c = (cfg || root.CONFIG || {}).soportes || {};
    const num = (v, def) => (Number(v) > 0 ? Number(v) : def);
    return {
      maxArchivo: Math.round(num(c.maxArchivoMb, 4) * MB),
      maxTotal: Math.round(num(c.maxTotalMb, 12) * MB),
      maxPorTipo: Math.round(num(c.maxPorTipo, 5)),
    };
  }

  function codigo(c, mensaje) {
    const e = new Error(mensaje || c);
    e.codigo = c;
    return e;
  }

  function tamanoTexto(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < MB) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / MB).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' MB';
  }

  /** Tipo según los primeros bytes (no según la extensión): PDF, JPG o PNG; '' si no es ninguno. */
  function tipoDe(bytes) {
    const b = bytes || [];
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return 'image/png';
    // La especificación permite algunos bytes antes de %PDF-.
    const n = Math.min(b.length, 1024);
    for (let i = 0; i + 4 < n; i++) {
      if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return 'application/pdf';
    }
    return '';
  }

  function aBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return root.btoa(s);
  }

  function deBase64(t) {
    const s = root.atob(t);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }

  const bytesDeBase64 = (t) => Math.floor((t.length * 3) / 4) - (t.endsWith('==') ? 2 : t.endsWith('=') ? 1 : 0);

  function nuevoId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /** Nombre visible del archivo: sin rutas ni caracteres de control. */
  function limpiarNombre(n) {
    // eslint-disable-next-line no-control-regex
    const t = String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop().trim();
    return t.slice(0, 150) || 'soporte';
  }

  async function leer(file, lim) {
    const l = lim || limites();
    if (!file || typeof file.arrayBuffer !== 'function') throw codigo('LECTURA', 'No pudimos leer este archivo.');
    const nombre = limpiarNombre(file.name);
    if (!file.size) throw codigo('VACIO', '«' + nombre + '» está vacío.');
    if (file.size > l.maxArchivo) {
      throw codigo('GRANDE', '«' + nombre + '» pesa ' + tamanoTexto(file.size) + '; el máximo por archivo es ' + tamanoTexto(l.maxArchivo) +
        '. Si es una foto, tómala con menor resolución; si es un PDF escaneado, escanéalo en blanco y negro.');
    }
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); } catch (e) { throw codigo('LECTURA', 'No pudimos leer «' + nombre + '». Intenta de nuevo.'); }
    const tipo = tipoDe(bytes);
    if (!tipo) throw codigo('TIPO', '«' + nombre + '» no es un PDF, JPG ni PNG. Adjunta el certificado en uno de esos formatos.');
    return { id: nuevoId(), nombre, tipo, bytes: bytes.length, fecha: new Date().toISOString(), datos: aBase64(bytes) };
  }

  const totalBytes = (soportes) => Object.values(soportes || {}).reduce((t, lista) => t + (lista || []).reduce((u, x) => u + (x.bytes || 0), 0), 0);
  const cantidad = (soportes) => Object.values(soportes || {}).reduce((t, lista) => t + (lista || []).length, 0);

  /** null si el archivo cabe; si no, un error con mensaje para la persona. */
  function comprobar(soportes, clave, item, lim) {
    const l = lim || limites();
    if (!CLAVES.includes(clave)) return codigo('CLAVE', 'Tipo de soporte desconocido.');
    if (((soportes || {})[clave] || []).length >= l.maxPorTipo) {
      return codigo('CANTIDAD', 'Puedes adjuntar hasta ' + l.maxPorTipo + ' archivos en este soporte. Quita uno para agregar otro.');
    }
    const total = totalBytes(soportes) + (item ? item.bytes : 0);
    if (total > l.maxTotal) {
      return codigo('TOTAL', 'Con «' + (item ? item.nombre : '') + '» tus soportes sumarían ' + tamanoTexto(total) + '; el máximo es ' +
        tamanoTexto(l.maxTotal) + '. Quita algún archivo o adjunta versiones más livianas.');
    }
    return null;
  }

  const RE_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

  /** Soportes que vienen del archivo o del respaldo: solo claves y tipos conocidos, base64 válido y dentro de los límites. */
  function normalizar(obj, lim) {
    const l = lim || limites();
    const out = {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    let total = 0;
    for (const clave of CLAVES) {
      const lista = Array.isArray(obj[clave]) ? obj[clave] : [];
      const buenos = [];
      for (const x of lista) {
        if (buenos.length >= l.maxPorTipo) break;
        if (!x || typeof x !== 'object' || typeof x.datos !== 'string') continue;
        const datos = x.datos;
        if (!datos || datos.length % 4 !== 0 || !RE_BASE64.test(datos)) continue;
        const bytes = bytesDeBase64(datos);
        if (bytes > l.maxArchivo || total + bytes > l.maxTotal) continue;
        let tipo = '';
        try { tipo = tipoDe(deBase64(datos.slice(0, 1368))); } catch (e) { tipo = ''; }
        if (!tipo) continue;
        total += bytes;
        buenos.push({
          id: typeof x.id === 'string' && x.id ? x.id.slice(0, 40) : nuevoId(),
          nombre: limpiarNombre(x.nombre),
          tipo,
          bytes,
          fecha: typeof x.fecha === 'string' && !isNaN(new Date(x.fecha)) ? x.fecha.slice(0, 40) : '',
          datos,
        });
      }
      if (buenos.length) out[clave] = buenos;
    }
    return out;
  }

  function aBlob(item) {
    return new Blob([deBase64(item.datos)], { type: item.tipo });
  }

  // ─────────── Respaldo en IndexedDB ───────────
  // localStorage (el respaldo de los datos) no alcanza para archivos; aquí quedan los soportes que aún no llegan
  // al archivo, con la misma clave que ese respaldo (el id del formulario o 'nuevo').

  const claveRespaldo = (id) => id || 'nuevo';

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

  async function guardarRespaldo(id, soportes) {
    try {
      if (cantidad(soportes)) await operacion('readwrite', (s) => s.put(soportes, claveRespaldo(id)));
      else await operacion('readwrite', (s) => s.delete(claveRespaldo(id)));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Soportes respaldados para ese formulario, o null si no hay. */
  async function leerRespaldo(id) {
    try {
      const d = await operacion('readonly', (s) => s.get(claveRespaldo(id)));
      return d && cantidad(normalizar(d)) ? normalizar(d) : null;
    } catch (e) {
      return null;
    }
  }

  async function borrarRespaldo(id) {
    try { await operacion('readwrite', (s) => s.delete(claveRespaldo(id))); return true; } catch (e) { return false; }
  }

  const Soportes = {
    CLAVES, limites, leer, comprobar, normalizar, totalBytes, cantidad, aBlob, tamanoTexto, tipoDe,
    guardarRespaldo, leerRespaldo, borrarRespaldo,
  };
  root.Soportes = Soportes;
  if (typeof module !== 'undefined' && module.exports) module.exports = Soportes;
})(typeof window !== 'undefined' ? window : globalThis);
