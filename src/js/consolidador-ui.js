/*
 * Interfaz del consolidador (consolidador.html): recibe los HTML de los contratistas, los lee con
 * Consolidador.leer y descarga el Excel horizontal, solo o en un ZIP con los soportes.
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

  const estado = {
    leidos: [],      // registros válidos de todos los archivos recibidos
    problemas: [],   // { archivo, mensaje }
    progreso: '',
    ocupado: false,
  };

  function toast(texto, tono) {
    const zona = document.getElementById('toasts');
    if (!zona) return;
    const el = h('div', { class: 'toast' + (tono === 'error' ? ' toast--error' : '') }, icono(tono === 'error' ? 'alerta' : 'check'), h('span', { class: 'toast-texto' }, texto));
    while (zona.firstChild) zona.firstChild.remove();
    zona.append(el);
    setTimeout(() => el.remove(), 6000);
  }

  async function recibir(archivos) {
    const html = archivos.filter((f) => /\.html?$/i.test(f.name));
    const otros = archivos.length - html.length;
    if (!html.length) {
      if (otros) toast('Elige los archivos .html de los formularios.', 'error');
      return;
    }
    estado.ocupado = true;
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
      if (r.ok) estado.leidos.push(r.registro);
      else estado.problemas.push({ archivo: f.name, mensaje: r.mensaje });
    }
    estado.ocupado = false;
    estado.progreso = '';
    pintar();
    const n = html.length;
    toast('Leímos ' + plural(n, 'archivo', 'archivos') + (otros ? ' (omitimos ' + plural(otros, 'archivo que no es HTML', 'archivos que no son HTML') + ')' : '') + '.');
  }

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
      const base = C.nombreBase();
      descargar(await C.zip(registros, { nombre: base }), base + '.zip', 'application/zip');
      toast('Descomprime el ZIP y abre el Excel desde su carpeta: los enlaces abren los soportes.');
    } catch (e) {
      console.warn('[consolidador] zip', e);
      toast('No pudimos armar el ZIP. Intenta de nuevo.', 'error');
    } finally {
      boton.disabled = false;
    }
  }

  async function descargarExcel(boton) {
    const { registros } = C.unificar(estado.leidos);
    if (!registros.length) return;
    boton.disabled = true;
    try {
      descargar(await C.xlsx(registros, { enlaces: false }), C.nombreBase() + '.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) {
      console.warn('[consolidador] xlsx', e);
      toast('No pudimos armar el Excel. Intenta de nuevo.', 'error');
    } finally {
      boton.disabled = false;
    }
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

  function tablaRegistros(registros) {
    const filas = registros.map((r) => {
      const archivos = C.archivosDe(r).length;
      return h('tr', null,
        h('td', null, String(r.d.nombreCompleto || r.carpeta).replace(/\s+/g, ' ').trim(), h('div', { class: 'tenue' }, r.s.numeroId || r.s.nit || '')),
        h('td', null, [r.s.numeroContrato, r.s.anioContrato].filter(Boolean).join(' de ') || '—'),
        h('td', { class: r.pendientes ? 'estado-pend' : 'estado-ok' }, r.pendientes ? plural(r.pendientes, 'pendiente', 'pendientes') : 'Completo'),
        h('td', null, archivos ? plural(archivos, 'archivo', 'archivos') : '—'),
        h('td', { class: 'tenue' }, r.archivo));
    });
    return h('div', { class: 'tabla-envoltura' },
      h('table', { class: 'tabla' },
        h('thead', null, h('tr', null, ['Contratista', 'Contrato', 'Estado', 'Soportes', 'Archivo'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, filas)));
  }

  function pintar() {
    destino.textContent = '';
    destino.append(
      h('p', { class: 'consolidado-intro' },
        'Carga los formularios que recibiste y descarga un Excel con una fila por contratista. ',
        'Con el ZIP, cada soporte queda en una carpeta por contratista y enlazado desde su fila.'),
      crearZona());
    if (estado.progreso) destino.append(h('p', { class: 'progreso', role: 'status' }, estado.progreso));

    const { registros, duplicados } = C.unificar(estado.leidos);
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
      seccion.append(tablaRegistros(registros));
    }
    if (problemas.length) {
      seccion.append(h('ul', { class: 'problemas' }, problemas.map((p) =>
        h('li', null, icono('alerta'), h('span', null, h('strong', null, p.archivo), ': ' + p.mensaje)))));
    }
    if (registros.length) {
      const botonZip = h('button', { type: 'button', class: 'boton boton--primario', onclick: () => descargarZip(botonZip), disabled: estado.ocupado },
        icono('abrir'), h('span', null, 'Descargar Excel con soportes (.zip)'));
      const botonXlsx = h('button', { type: 'button', class: 'boton boton--secundario', onclick: () => descargarExcel(botonXlsx), disabled: estado.ocupado },
        icono('tabla'), h('span', null, 'Solo el Excel'));
      const limpiar = h('button', { type: 'button', class: 'enlace enlace--discreto', onclick: () => { estado.leidos = []; estado.problemas = []; pintar(); } }, 'Quitar todos');
      seccion.append(h('div', { class: 'consolidado-acciones' }, botonZip, botonXlsx, limpiar));
    }
    destino.append(seccion);
  }

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  const version = document.getElementById('pie-version');
  if (version && window.BUILD_INFO) version.textContent = 'Consolidador ' + window.BUILD_INFO.version;
  pintar();
})();
