/*
 * Interfaz del consolidador (consolidador.html).
 *
 * Con Chrome o Edge se trabaja sobre una carpeta raíz que la persona elige (y que se recuerda): ahí se lee y se
 * reescribe Consolidado_13-IF-016.xlsx, agregando o actualizando una fila por contratista, y se guardan sus
 * archivos en Contratistas/AÑO/NOMBRE/. Sin acceso a carpetas (Firefox, Safari) se descarga un ZIP o el Excel.
 */
(function () {
  'use strict';

  const C = window.Consolidador;
  const destino = document.getElementById('consolidador');
  if (!C || !destino) return;

  const ICONOS = {
    subir: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    alerta: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    tabla: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/>',
    abrir: '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    guardar: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  };

  function icono(nombre, clase) {
    const t = document.createElement('template');
    t.innerHTML = '<svg class="' + (clase || 'icono') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONOS[nombre] || '') + '</svg>';
    return t.content.firstChild;
  }

  /** Crea un elemento; los hijos de texto van como texto (nunca HTML). */
  function h(etiqueta, atributos, ...hijos) {
    const el = document.createElement(etiqueta);
    for (const [k, v] of Object.entries(atributos || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const hijo of hijos.flat()) if (hijo != null && hijo !== false) el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
    return el;
  }

  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  const soportaCarpetas = typeof window.showDirectoryPicker === 'function';

  const estado = {
    raiz: null,          // carpeta raíz elegida (FileSystemDirectoryHandle)
    recordada: null,     // la de la última vez (pide permiso al usarla)
    tabla: null,         // consolidado existente: { encabezados, extras, filas }
    hayExcel: false,
    errorCarpeta: '',
    leidos: [],          // registros de los formularios cargados (r.fuente: el File original)
    problemas: [],       // { archivo, mensaje }
    progreso: '',
    ocupado: false,
    resultado: null,     // resumen del último guardado
  };

  function toast(texto, tono) {
    const zona = document.getElementById('toasts');
    if (!zona) return;
    const el = h('div', { class: 'toast' + (tono === 'error' ? ' toast--error' : '') }, icono(tono === 'error' ? 'alerta' : 'check'), h('span', { class: 'toast-texto' }, texto));
    while (zona.firstChild) zona.firstChild.remove();
    zona.append(el);
    setTimeout(() => el.remove(), 7000);
  }

  // ─────────── Recordar la carpeta (IndexedDB) ───────────

  function base() {
    return new Promise((resolver, rechazar) => {
      if (!window.indexedDB) { rechazar(new Error('sin IndexedDB')); return; }
      const pet = indexedDB.open('sed-13-IF-016-consolidador', 1);
      pet.onupgradeneeded = () => pet.result.createObjectStore('carpetas');
      pet.onsuccess = () => resolver(pet.result);
      pet.onerror = () => rechazar(pet.error);
    });
  }

  async function operacion(modo, fn) {
    const db = await base();
    try {
      return await new Promise((resolver, rechazar) => {
        const tx = db.transaction('carpetas', modo);
        const pet = fn(tx.objectStore('carpetas'));
        tx.oncomplete = () => resolver(pet ? pet.result : undefined);
        tx.onerror = () => rechazar(tx.error);
      });
    } finally { db.close(); }
  }

  const recordar = (dir) => operacion('readwrite', (s) => s.put(dir, 'raiz')).catch(() => {});
  const recordada = () => operacion('readonly', (s) => s.get('raiz')).catch(() => null);

  // ─────────── Archivos en la carpeta raíz ───────────

  async function carpetaDe(raiz, ruta, crear) {
    let d = raiz;
    for (const parte of String(ruta).split('/').filter(Boolean)) d = await d.getDirectoryHandle(parte, { create: !!crear });
    return d;
  }

  async function escribir(dir, nombre, datos) {
    const fh = await dir.getFileHandle(nombre, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(datos);
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch (e2) { /* nada */ }
      throw e;
    }
  }

  async function nombresDe(dir) {
    const out = [];
    for await (const [nombre, entrada] of dir.entries()) if (entrada.kind === 'file') out.push(nombre);
    return out.sort();
  }

  /** Lee el consolidado de la carpeta: { tabla, hayExcel }. Si existe pero no se puede leer, lanza (para no pisarlo). */
  async function leerConsolidado(raiz) {
    let fh;
    try { fh = await raiz.getFileHandle(C.NOMBRE_EXCEL); } catch (e) {
      if (e && e.name === 'NotFoundError') return { tabla: { encabezados: [], extras: [], filas: [] }, hayExcel: false };
      throw e;
    }
    const bytes = await (await fh.getFile()).arrayBuffer();
    return { tabla: await C.leerXlsx(bytes), hayExcel: true, bytes };
  }

  async function abrirCarpeta(raiz) {
    estado.raiz = raiz;
    estado.errorCarpeta = '';
    estado.resultado = null;
    try {
      const r = await leerConsolidado(raiz);
      estado.tabla = r.tabla;
      estado.hayExcel = r.hayExcel;
    } catch (e) {
      console.warn('[consolidador] leer Excel', e);
      estado.tabla = null;
      estado.errorCarpeta = 'No pudimos leer «' + C.NOMBRE_EXCEL + '» de esta carpeta. Si lo tienes abierto en Excel, ciérralo y vuelve a elegir la carpeta. ' +
        'Para no dañarlo, no escribiremos en él hasta poder leerlo.';
    }
    pintar();
  }

  async function elegirCarpeta() {
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: 'consolidado-13-IF-016', mode: 'readwrite' });
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('No pudimos abrir esa carpeta. Intenta con otra.', 'error');
      return;
    }
    await recordar(dir);
    estado.recordada = dir;
    await abrirCarpeta(dir);
  }

  async function usarRecordada() {
    const dir = estado.recordada;
    if (!dir) return;
    let p = 'denied';
    try { p = await dir.requestPermission({ mode: 'readwrite' }); } catch (e) { p = 'denied'; }
    if (p !== 'granted') { toast('Sin permiso no podemos usar esa carpeta. Elige la carpeta de nuevo.', 'error'); return; }
    await abrirCarpeta(dir);
  }

  // ─────────── Formularios recibidos ───────────

  async function recibir(archivos) {
    const html = archivos.filter((f) => /\.html?$/i.test(f.name));
    const otros = archivos.length - html.length;
    if (!html.length) {
      if (otros) toast('Elige los archivos .html de los formularios.', 'error');
      return;
    }
    estado.ocupado = true;
    estado.resultado = null;
    let i = 0;
    for (const f of html) {
      i++;
      estado.progreso = 'Leyendo ' + i + ' de ' + html.length + '…';
      pintar();
      let texto = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        texto = await f.text();
      } catch (e) {
        estado.problemas.push({ archivo: f.name, mensaje: 'No se pudo leer el archivo.' });
        continue;
      }
      const r = C.leer(texto, f.name);
      if (r.ok) { r.registro.fuente = f; estado.leidos.push(r.registro); } else estado.problemas.push({ archivo: f.name, mensaje: r.mensaje });
    }
    estado.ocupado = false;
    estado.progreso = '';
    pintar();
    toast('Leímos ' + plural(html.length, 'archivo', 'archivos') + (otros ? ' (omitimos ' + plural(otros, 'archivo que no es HTML', 'archivos que no son HTML') + ')' : '') + '.');
  }

  /** Vista previa: qué pasará con cada formulario en el consolidado de la carpeta. */
  function previsualizar() {
    const { registros, duplicados } = C.unificar(estado.leidos);
    const comb = estado.raiz && estado.tabla ? C.combinar(estado.tabla.filas, registros) : null;
    return { registros, duplicados, comb };
  }

  // ─────────── Guardar en la carpeta ───────────

  async function agregarAlConsolidado(boton) {
    const raiz = estado.raiz;
    if (!raiz || !estado.leidos.length) return;
    boton.disabled = true;
    estado.ocupado = true;
    estado.progreso = 'Guardando en la carpeta…';
    pintar();
    try {
      // Se relee el Excel justo antes de escribir: alguien pudo cambiarlo desde que se eligió la carpeta.
      const actual = await leerConsolidado(raiz);
      const { registros } = C.unificar(estado.leidos);
      const comb = C.combinar(actual.tabla.filas, registros);
      const aEscribir = comb.nuevos.concat(comb.actualizados);
      let n = 0;
      for (const r of aEscribir) {
        n++;
        estado.progreso = 'Guardando archivos ' + n + ' de ' + aEscribir.length + '…';
        pintar();
        const dir = await carpetaDe(raiz, C.CARPETA_CONTRATISTAS + '/' + r.carpetaUnica, true);
        // Al actualizar, los soportes anteriores se reemplazan por los del formulario nuevo.
        for (const nombre of await nombresDe(dir)) if (C.claseDeArchivo(nombre)) await dir.removeEntry(nombre);
        for (const a of C.archivosDe(r)) await escribir(dir, a.nombre, window.Soportes.aBlob(a.item));
        if (r.fuente) await escribir(dir, C.NOMBRE_FORMULARIO, r.fuente);
      }
      // Enlaces de todas las filas según lo que hay en cada carpeta.
      const listados = new Map();
      for (const f of comb.filas) {
        const carpeta = f.registro ? f.registro.carpetaUnica : f.carpeta;
        if (!carpeta || listados.has(carpeta)) continue;
        try { listados.set(carpeta, await nombresDe(await carpetaDe(raiz, C.CARPETA_CONTRATISTAS + '/' + carpeta, false))); } catch (e) { listados.set(carpeta, []); }
      }
      const archivosDeFila = (f) => {
        const carpeta = f.registro ? f.registro.carpetaUnica : f.carpeta;
        return (listados.get(carpeta) || []).filter((nombre) => C.claseDeArchivo(nombre))
          .map((nombre) => ({ clave: C.claseDeArchivo(nombre), nombre, ruta: C.rutaCarpeta(carpeta) + nombre }));
      };
      const bytes = await C.xlsx(comb.filas, { enlaces: true, extras: actual.tabla.extras, archivosDeFila });
      estado.progreso = 'Guardando el Excel…';
      pintar();
      if (actual.hayExcel && actual.bytes) await escribir(raiz, C.NOMBRE_EXCEL.replace(/\.xlsx$/, ' (anterior).xlsx'), actual.bytes);
      try {
        await escribir(raiz, C.NOMBRE_EXCEL, bytes);
      } catch (e) {
        e.enExcel = true;
        throw e;
      }
      estado.tabla = await C.leerXlsx(bytes);
      estado.hayExcel = true;
      estado.resultado = { nuevos: comb.nuevos.length, actualizados: comb.actualizados.length, sinCambios: comb.sinCambios.length, total: comb.filas.length };
      estado.leidos = [];
      estado.problemas = [];
      toast('Listo: guardamos el consolidado en la carpeta «' + raiz.name + '».');
    } catch (e) {
      console.warn('[consolidador] guardar', e);
      toast(e && e.enExcel
        ? 'No pudimos guardar «' + C.NOMBRE_EXCEL + '». Si lo tienes abierto en Excel, ciérralo e intenta de nuevo (los archivos de los contratistas ya quedaron guardados).'
        : 'No pudimos guardar en la carpeta. Revisa que tengas permiso para escribir en ella e intenta de nuevo.', 'error');
    } finally {
      estado.ocupado = false;
      estado.progreso = '';
      pintar();
    }
  }

  // ─────────── Sin acceso a carpetas: descargas ───────────

  function descargar(bytes, nombre, tipo) {
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    const a = h('a', { href: url, download: nombre, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function descargarZip(boton) {
    const { registros } = C.unificar(estado.leidos);
    if (!registros.length) return;
    boton.disabled = true;
    try {
      const nombre = C.nombreBase();
      descargar(await C.zip(registros, { nombre }), nombre + '.zip', 'application/zip');
      toast('Descomprime el ZIP y abre el Excel desde su carpeta: los enlaces abren los soportes.');
    } catch (e) {
      console.warn('[consolidador] zip', e);
      toast('No pudimos armar el ZIP. Intenta de nuevo.', 'error');
    } finally { boton.disabled = false; }
  }

  async function descargarExcel(boton) {
    const { registros } = C.unificar(estado.leidos);
    if (!registros.length) return;
    boton.disabled = true;
    try {
      descargar(await C.xlsx(registros, { enlaces: false }), C.nombreBase() + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) {
      console.warn('[consolidador] xlsx', e);
      toast('No pudimos armar el Excel. Intenta de nuevo.', 'error');
    } finally { boton.disabled = false; }
  }

  // ─────────── Pintar ───────────

  function seccionCarpeta() {
    const s = h('section', { class: 'grupo carpeta-raiz', 'aria-labelledby': 'cons-carpeta' },
      h('h2', { class: 'grupo-titulo', id: 'cons-carpeta' }, '1. Carpeta del consolidado'));
    if (!soportaCarpetas) {
      s.append(h('p', { class: 'aviso' }, icono('alerta'), h('span', null,
        'Este navegador no permite trabajar sobre una carpeta. Ábrelo en Chrome o Edge para agregar los formularios a un consolidado; ',
        'aquí puedes descargar un Excel o un ZIP con los formularios que cargues.')));
      return s;
    }
    if (!estado.raiz) {
      s.append(h('p', { class: 'consolidado-intro' },
        'Elige la carpeta donde se guarda el consolidado (por ejemplo, una carpeta compartida de Tesorería). Ahí quedan ',
        h('strong', null, C.NOMBRE_EXCEL), ' y una carpeta por contratista en ', h('strong', null, C.CARPETA_CONTRATISTAS + '/AÑO/NOMBRE'), '.'));
      const acciones = h('div', { class: 'consolidado-acciones' },
        h('button', { type: 'button', class: 'boton boton--primario', onclick: elegirCarpeta }, icono('abrir'), h('span', null, 'Elegir carpeta raíz')));
      if (estado.recordada) {
        acciones.append(h('button', { type: 'button', class: 'boton boton--secundario', onclick: usarRecordada },
          h('span', null, 'Usar «' + estado.recordada.name + '» (la de la última vez)')));
      }
      s.append(acciones);
      return s;
    }
    const filas = estado.tabla ? estado.tabla.filas.length : 0;
    s.append(h('p', { class: 'carpeta-actual' }, icono('abrir'), h('strong', null, estado.raiz.name),
      h('button', { type: 'button', class: 'enlace enlace--discreto', onclick: elegirCarpeta }, 'Cambiar carpeta')));
    if (estado.errorCarpeta) s.append(h('p', { class: 'aviso', role: 'alert' }, icono('alerta'), h('span', null, estado.errorCarpeta)));
    else {
      s.append(h('p', { class: 'consolidado-intro' }, estado.hayExcel
        ? 'Tiene un consolidado con ' + plural(filas, 'contratista', 'contratistas') + '. Los formularios que agregues se suman a ese Excel.'
        : 'Aún no tiene consolidado: lo crearemos cuando agregues los primeros formularios.'));
    }
    return s;
  }

  function crearZona() {
    const input = h('input', { type: 'file', id: 'archivos', class: 'sr-only zona-input', accept: '.html,.htm,text/html', multiple: true });
    const carpeta = h('input', { type: 'file', id: 'carpeta', class: 'sr-only', webkitdirectory: true, multiple: true });
    const tomar = (el) => () => { const lista = Array.from(el.files || []); el.value = ''; if (lista.length) recibir(lista); };
    input.addEventListener('change', tomar(input));
    carpeta.addEventListener('change', tomar(carpeta));
    const zona = h('label', { class: 'zona', for: 'archivos' },
      h('span', { class: 'zona-icono' }, icono('subir')),
      h('span', { class: 'zona-titulo' }, 'Formularios recibidos'),
      h('span', { class: 'zona-sub' }, 'Los archivos .html que te enviaron los contratistas'),
      h('span', { class: 'zona-accion' }, 'Arrastra aquí los archivos o ', h('u', null, 'búscalos en tu equipo')));
    let profundidad = 0;
    zona.addEventListener('dragenter', (e) => { e.preventDefault(); profundidad++; zona.classList.add('arrastrando'); });
    zona.addEventListener('dragover', (e) => e.preventDefault());
    zona.addEventListener('dragleave', () => { profundidad = Math.max(0, profundidad - 1); if (!profundidad) zona.classList.remove('arrastrando'); });
    zona.addEventListener('drop', (e) => {
      e.preventDefault();
      profundidad = 0;
      zona.classList.remove('arrastrando');
      recibir(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
    });
    return h('div', { class: 'zona-envoltura zona-envoltura--varios' }, input, zona,
      h('div', { class: 'zona-pie' }, carpeta,
        h('label', { class: 'enlace', for: 'carpeta' }, 'O elige una carpeta con todos los formularios')));
  }

  const RESULTADO = {
    nuevo: ['Nuevo', 'estado-ok'],
    actualizado: ['Se actualiza', 'estado-ok'],
    'sin-cambios': ['Ya está (sin cambios)', 'tenue'],
  };

  function tablaRegistros(registros, conResultado) {
    const filas = registros.map((r) => {
      const archivos = C.archivosDe(r).length;
      const res = RESULTADO[r.resultado] || null;
      return h('tr', null,
        h('td', null, String(r.d.nombreCompleto || r.carpeta).replace(/\s+/g, ' ').trim(), h('div', { class: 'tenue' }, r.s.numeroId || r.s.nit || '')),
        h('td', null, [r.s.numeroContrato, r.s.anioContrato].filter(Boolean).join(' de ') || '—'),
        h('td', { class: r.pendientes ? 'estado-pend' : 'estado-ok' }, r.pendientes ? plural(r.pendientes, 'pendiente', 'pendientes') : 'Completo'),
        h('td', null, archivos ? plural(archivos, 'archivo', 'archivos') : '—'),
        conResultado ? h('td', { class: res ? res[1] : '' }, res ? res[0] : '—', h('div', { class: 'tenue' }, r.carpetaUnica || '')) : null,
        h('td', { class: 'tenue' }, r.archivo));
    });
    const titulos = ['Contratista', 'Contrato', 'Estado', 'Soportes'].concat(conResultado ? ['En el consolidado'] : [], ['Archivo']);
    return h('div', { class: 'tabla-envoltura' },
      h('table', { class: 'tabla' },
        h('thead', null, h('tr', null, titulos.map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, filas)));
  }

  function pintar() {
    destino.textContent = '';
    destino.append(seccionCarpeta());
    const puedeCargar = !soportaCarpetas || (estado.raiz && !estado.errorCarpeta);
    if (estado.resultado) {
      const r = estado.resultado;
      destino.append(h('p', { class: 'resultado-ok', role: 'status' }, icono('check'), h('span', null,
        'Consolidado guardado: ' + [r.nuevos && plural(r.nuevos, 'contratista nuevo', 'contratistas nuevos'), r.actualizados && plural(r.actualizados, 'actualizado', 'actualizados'),
          r.sinCambios && plural(r.sinCambios, 'sin cambios', 'sin cambios')].filter(Boolean).join(', ') +
        '. El Excel tiene ' + plural(r.total, 'contratista', 'contratistas') + '. Ábrelo en la carpeta «' + (estado.raiz ? estado.raiz.name : '') + '».')));
    }
    if (!puedeCargar) return;

    const cargar = h('section', { class: 'grupo', 'aria-labelledby': 'cons-cargar' },
      h('h2', { class: 'grupo-titulo', id: 'cons-cargar' }, soportaCarpetas ? '2. Formularios para agregar' : 'Formularios'),
      crearZona());
    if (estado.progreso) cargar.append(h('p', { class: 'progreso', role: 'status' }, estado.progreso));
    destino.append(cargar);

    const { registros, duplicados, comb } = previsualizar();
    const problemas = estado.problemas.concat(duplicados.map((r) => ({
      archivo: r.archivo, mensaje: 'Hay una versión más reciente del mismo contratista y contrato; se usa esa.',
    })));
    if (!registros.length && !problemas.length) return;

    const seccion = h('section', { class: 'grupo', 'aria-labelledby': 'cons-titulo' },
      h('h2', { class: 'grupo-titulo', id: 'cons-titulo' }, 'Formularios leídos'));
    if (registros.length) {
      const completos = registros.filter((r) => !r.pendientes).length;
      seccion.append(h('p', { class: 'consolidado-resumen' },
        plural(registros.length, 'contratista', 'contratistas') + ' · ' + plural(completos, 'completo', 'completos') +
        (registros.length - completos ? ' · ' + (registros.length - completos) + ' con pendientes' : '')));
      seccion.append(tablaRegistros(registros, !!comb));
    }
    if (problemas.length) {
      seccion.append(h('ul', { class: 'problemas' }, problemas.map((p) =>
        h('li', null, icono('alerta'), h('span', null, h('strong', null, p.archivo), ': ' + p.mensaje)))));
    }
    if (registros.length) {
      const acciones = h('div', { class: 'consolidado-acciones' });
      if (comb) {
        const cambios = comb.nuevos.length + comb.actualizados.length;
        const boton = h('button', { type: 'button', class: 'boton boton--primario', onclick: () => agregarAlConsolidado(boton), disabled: estado.ocupado || !cambios },
          icono('guardar'), h('span', null, cambios ? 'Agregar al consolidado' : 'Nada nuevo para agregar'));
        acciones.append(boton);
      } else {
        const botonZip = h('button', { type: 'button', class: 'boton boton--primario', onclick: () => descargarZip(botonZip), disabled: estado.ocupado },
          icono('abrir'), h('span', null, 'Descargar Excel con soportes (.zip)'));
        const botonXlsx = h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => descargarExcel(botonXlsx), disabled: estado.ocupado },
          icono('tabla'), h('span', null, 'Solo el Excel'));
        acciones.append(botonZip, botonXlsx);
      }
      acciones.append(h('button', { type: 'button', class: 'enlace enlace--discreto', onclick: () => { estado.leidos = []; estado.problemas = []; pintar(); } }, 'Quitar todos'));
      seccion.append(acciones);
    }
    destino.append(seccion);
  }

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  const version = document.getElementById('pie-version');
  if (version && window.BUILD_INFO) version.textContent = 'Consolidador ' + window.BUILD_INFO.version;
  pintar();
  if (soportaCarpetas) recordada().then((dir) => { if (dir && !estado.raiz) { estado.recordada = dir; pintar(); } });
})();
