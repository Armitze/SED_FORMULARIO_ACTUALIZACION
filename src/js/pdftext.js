// window.PdfText — lee el texto de un PDF con pdf.js, en el navegador (nada se envía a ningún servidor).
// window.DocDetect — reconoce qué es cada página: RUT (DIAN), certificado RIT (Hacienda Bogotá),
//                    formulario de solicitud del RIT o desconocida.
//
// Contrato (SPEC → "Module contracts" → PdfText):
//   await PdfText.leer(entrada, opts?) -> Doc
//     entrada: File | Blob | ArrayBuffer | Uint8Array (a pdf.js se le entrega SIEMPRE una copia).
//     opts.pdfjsLib   librería pdf.js a usar (Node/pruebas). Por defecto window.pdfjsLib y, en Node,
//                     require('pdfjs-dist/legacy/build/pdf.js'). Pasar { pdfjsLib: null } fuerza LIB_NO_DISPONIBLE.
//     opts.documento  'RUT' | 'RIT' (opcional): ajusta la ayuda de los mensajes de error.
//     opts.maxPaginas máximo de páginas a leer (500 por defecto; si hay más, doc.truncado = true).
//     opts.alProgresar(paginaLeida, totalALeer) callback opcional.
//     opts.tolerante  true: no lanza SIN_TEXTO / TEXTO_ILEGIBLE (doc.tieneTexto=false y doc.problema=código).
//     opts.verbosity  nivel de mensajes de pdf.js (0 = solo errores, por defecto).
//   Página sin texto (sinTexto) = menos de 20 caracteres visibles; ilegible = más del 5 % de caracteres
//   de control (ratioControl). En el navegador fija GlobalWorkerOptions.workerSrc =
//   window.PDFJS_WORKER_SRC || '../node_modules/pdfjs-dist/build/pdf.worker.min.js' solo si no estaba fijado.
//
//   DocDetect.tipo(doc)    -> 'RUT' | 'RIT' | 'RIT_SOLICITUD' | 'DESCONOCIDO'
//   DocDetect.tipos(doc)   -> tipos presentes en orden de aparición (un paquete puede traer RUT y RIT)
//   DocDetect.paginas(doc) -> [{ numero, tipo, principal, hoja, sinTexto, ilegible }]
//     RUT: principal = hoja principal ("24. Tipo de contribuyente"); hoja = 1 o el número de "Hoja k".
//     RIT: principal = página con el perfil tributario / actividades; hoja = i de "Página i/ n".
//     RIT_SOLICITUD: formulario de inscripción/novedades (no es el certificado); principal = el anverso.
//
//   Doc = { paginas: [Pagina], texto, tieneTexto, numPaginas, info: {Producer, Creator, CreationDate, ModDate},
//           problema: null | 'SIN_TEXTO' | 'TEXTO_ILEGIBLE', truncado: boolean }
//   Pagina = { numero, ancho, alto, caja: [x0,y0,x1,y1], rotacion,
//              crudos: [items de pdf.js sin tocar], items: [Item], lineas: [Linea], texto,
//              caracteres, ratioControl, sinTexto, ilegible, error? }
//   Item  = { str (NFC), x, y, w, h, x2, font }   (solo items con texto; en orden de lectura: y desc, x asc)
//   Linea = { y, x, x2, items: [Item], texto }
//
// COORDENADAS: espacio de usuario del PDF, igual que los informes de investigación y los prototipos:
//   x = transform[4], y = transform[5] (origen abajo a la izquierda, y CRECE HACIA ARRIBA), w = width,
//   h = height, x2 = x + w. No se redondea nada.
//
// Texto: las líneas agrupan items con |Δy| <= 2 respecto al primer item (el más alto) de la línea; dentro
// de la línea se unen en orden de x y se inserta un espacio solo si el hueco (x - x2 anterior) es > 0.8 pt
// (los PDF re-procesados parten palabras en pedazos casi sin hueco). doc.texto = líneas unidas con '\n'
// y páginas separadas con '\f'; las páginas ilegibles aportan '' a doc.texto.
//
// Errores: Error con .codigo y mensaje en español para la persona usuaria:
//   NO_PDF            el archivo no es un PDF o está dañado
//   PROTEGIDO         PDF con contraseña de apertura
//   SIN_TEXTO         ninguna página tiene texto (escaneo o foto)
//   TEXTO_ILEGIBLE    el texto existe pero son códigos de glifo (p. ej. "imprimir como PDF")
//   LIB_NO_DISPONIBLE no hay pdf.js (o su worker no cargó)
// SIN_TEXTO / TEXTO_ILEGIBLE se deciden a nivel de documento: en paquetes con algunas páginas escaneadas
// o dañadas solo se marcan esas páginas (sinTexto / ilegible); se lanza el error si NINGUNA sirve.
//
// Utilidades compartidas con los parsers: fold, compactar, agruparLineas, unirTexto, ratioControl,
// buscar, buscarTodos, region, fechaPdf, armarDoc.
(function (root) {
  'use strict';

  const TOL_LINEA = 2;          // pt: tolerancia vertical para agrupar items en una línea
  const HUECO_ESPACIO = 0.8;    // pt: hueco mínimo para insertar un espacio entre items
  const UMBRAL_CONTROL = 0.05;  // proporción de caracteres de control a partir de la cual el texto es basura
  const MIN_CARACTERES = 20;    // menos caracteres visibles que esto = página sin texto (imagen)
  const MAX_PAGINAS = 500;
  const WORKER_POR_DEFECTO = '../node_modules/pdfjs-dist/build/pdf.worker.min.js';

  // ---------------------------------------------------------------- errores

  const DESCARGA = {
    RUT: 'Descarga tu RUT directamente del portal de la DIAN (servicios en línea MUISCA, opción «Copia del RUT»)',
    RIT: 'Descarga tu RIT directamente de la Oficina Virtual de la Secretaría Distrital de Hacienda de Bogotá (Mi RIT → Certificado RIT)',
    ambos: 'Descarga el documento original: el RUT desde el portal de la DIAN (servicios en línea MUISCA, opción «Copia del RUT») y el RIT desde la Oficina Virtual de la Secretaría Distrital de Hacienda de Bogotá (Mi RIT → Certificado RIT)',
  };
  const MANUAL = 'Si prefieres, puedes continuar llenando el formulario a mano.';

  const MENSAJES = {
    NO_PDF: (d) => 'Este archivo no es un PDF o está dañado, así que no lo pudimos abrir. ' + d +
      ' y súbelo tal cual, sin convertirlo ni editarlo. ' + MANUAL,
    PROTEGIDO: (d) => 'Este PDF tiene contraseña y por eso no lo podemos leer. ' + d +
      ' (esos archivos no traen contraseña) y súbelo de nuevo. ' + MANUAL,
    SIN_TEXTO: (d) => 'Este PDF es una imagen (por ejemplo, un documento escaneado o una foto), así que no podemos leer sus datos. ' +
      d + ' y súbelo sin modificarlo. ' + MANUAL,
    TEXTO_ILEGIBLE: (d) => 'Este PDF se ve bien, pero su texto interno está dañado y no se puede leer ' +
      '(suele pasar cuando el documento se «imprime como PDF» o se guarda con otro programa). ' + d +
      ' y súbelo sin modificarlo. ' + MANUAL,
    LIB_NO_DISPONIBLE: () => 'No pudimos cargar el lector de PDF en esta página. Recarga la página e inténtalo de nuevo. ' + MANUAL,
  };

  /** Mensaje en español para un código de error. documento: 'RUT' | 'RIT' | undefined (ambos). */
  function mensajeError(codigo, documento) {
    const f = MENSAJES[codigo];
    if (!f) return 'No pudimos leer este archivo. ' + MANUAL;
    return f(DESCARGA[documento] || DESCARGA.ambos);
  }

  function crearError(codigo, documento, causa) {
    const e = new Error(mensajeError(codigo, documento));
    e.name = 'PdfTextError';
    e.codigo = codigo;
    if (causa) e.causa = causa;
    return e;
  }

  // ---------------------------------------------------------------- texto

  const MARCAS = /[\u0300-\u036f]/g;
  const ESPACIOS_RAROS = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;

  function plegarCaracter(c) {
    const f = c.normalize('NFD').replace(MARCAS, '').toLowerCase().replace(ESPACIOS_RAROS, ' ');
    if (f.length === 1) return f;
    const l = c.toLowerCase();
    return l.length === 1 ? l : c;
  }

  /**
   * Texto "plegado" para comparar: NFC → NFD sin tildes ni diéresis, en MINÚSCULAS, y los espacios raros
   * (NBSP, etc.) como ' '. No colapsa espacios: el resultado tiene la MISMA longitud que s.normalize('NFC'),
   * así una posición encontrada en el texto plegado sirve en el texto original (ver buscar()).
   * 'Ñ' → 'n', 'Á' → 'a'.
   */
  function fold(s) {
    return plegar(String(s == null ? '' : s).normalize('NFC'));
  }

  // fold() sin la normalización NFC previa (conserva la longitud exacta de t).
  function plegar(t) {
    const r = t.normalize('NFD').replace(MARCAS, '').toLowerCase().replace(ESPACIOS_RAROS, ' ');
    if (r.length === t.length) return r;
    let out = '';
    for (let i = 0; i < t.length; i++) out += plegarCaracter(t[i]);
    return out;
  }

  /** fold() sin ningún espacio en blanco: robusto a palabras partidas o pegadas ("Número de" + "Identificación"). */
  function compactar(s) {
    return fold(s).replace(/\s+/g, '');
  }

  /**
   * Proporción de caracteres de control [\u0000-\u001F] (sin contar \t \n \f \r, que son formato) sobre los
   * caracteres no blancos. Un PDF "impreso como PDF" sin ToUnicode da códigos de glifo como "\u0017\u0000\u0018".
   */
  function ratioControl(texto) {
    const t = String(texto == null ? '' : texto);
    const total = t.replace(/[\t\n\f\r ]/g, '').length;
    if (!total) return 0;
    const ctrl = (t.match(/[\u0000-\u0008\u000b\u000e-\u001f]/g) || []).length;
    return ctrl / total;
  }

  // ---------------------------------------------------------------- items y líneas

  /** Convierte un item de pdf.js (o uno ya normalizado / de los volcados {x,y,w,h,font}) a Item. */
  function normalizarItem(it) {
    const t = it.transform;
    const x = Number(t ? t[4] : it.x) || 0;
    const y = Number(t ? t[5] : it.y) || 0;
    const w = Number(it.width != null ? it.width : it.w) || 0;
    const h = Number(it.height != null ? it.height : it.h) || 0;
    return { str: String(it.str).normalize('NFC'), x, y, w, h, x2: x + w, font: it.fontName || it.font || '' };
  }

  const tieneTextoItem = (it) => it && typeof it.str === 'string' && it.str.trim() !== '';
  const ordenLectura = (a, b) => b.y - a.y || a.x - b.x;

  /**
   * Mayor x2 de una lista de items, con un bucle: Math.max.apply(null, lista) y Math.max(...lista) pasan cada
   * elemento como argumento y lanzan RangeError con listas grandes (~125 000 items en V8).
   */
  function maxX2(items) {
    let m = -Infinity;
    for (let i = 0; i < items.length; i++) if (items[i].x2 > m) m = items[i].x2;
    return m;
  }

  /** Une items (en el orden dado) con un mapa carácter → índice de item. */
  function unirConMapa(items) {
    let texto = '';
    const mapa = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (i > 0) {
        const prev = items[i - 1];
        // Espacio si hay hueco real, si se "devuelve" a la izquierda del anterior (otra fila de una
        // región) o si cambia de renglón.
        if (it.x - prev.x2 > HUECO_ESPACIO || it.x < prev.x - HUECO_ESPACIO || Math.abs(it.y - prev.y) > TOL_LINEA) {
          texto += ' ';
          mapa.push(i);
        }
      }
      const s = it.str;
      texto += s;
      for (let k = 0; k < s.length; k++) mapa.push(i);
    }
    return { texto, mapa };
  }

  /**
   * Une los items de una línea (ordenados por x): espacio solo si el hueco next.x - prev.x2 > 0.8 pt.
   * También pone espacio cuando el siguiente item está en otro renglón (|Δy| > 2) o claramente a la
   * izquierda del anterior, para que unir una región de varias filas no pegue palabras.
   */
  function unirTexto(items) {
    return unirConMapa(items || []).texto;
  }

  /** Agrupa Items en líneas (y desc, x asc). Acepta también items crudos de pdf.js. */
  function agruparLineas(items, tol) {
    const tolerancia = tol == null ? TOL_LINEA : tol;
    const lista = (items || []).filter(tieneTextoItem).map((it) => (typeof it.x2 === 'number' ? it : normalizarItem(it)));
    lista.sort(ordenLectura);
    const lineas = [];
    let actual = null;
    for (const it of lista) {
      if (!actual || Math.abs(actual.y - it.y) > tolerancia) {
        actual = { y: it.y, x: 0, x2: 0, items: [], texto: '' };
        lineas.push(actual);
      }
      actual.items.push(it);
    }
    for (const l of lineas) {
      l.items.sort((a, b) => a.x - b.x);
      l.x = l.items[0].x;
      l.x2 = maxX2(l.items);
      l.texto = unirTexto(l.items);
    }
    return lineas;
  }

  function aRegExp(patron, global) {
    if (patron instanceof RegExp) {
      const flags = patron.flags.replace(/[gy]/g, '') + (global ? 'g' : '');
      return new RegExp(patron.source, flags);
    }
    const lit = fold(patron).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(lit, global ? 'g' : '');
  }

  function resultadoBusqueda(linea, indice, m, mapa) {
    const desde = mapa[m.index];
    const hasta = mapa[Math.max(m.index, m.index + m[0].length - 1)];
    const items = linea.items.slice(desde, hasta + 1);
    return {
      linea, indiceLinea: indice, coincidencia: m, items,
      x: items[0].x, x2: maxX2(items), y: linea.y,
    };
  }

  /**
   * Busca un patrón en el texto PLEGADO (fold) de cada línea y devuelve la primera coincidencia con su
   * geometría: { linea, indiceLinea, coincidencia, items, x, x2, y } o null. Sirve para etiquetas partidas
   * en varios items ("24." "Tipo de" "contribuyente"). El patrón debe escribirse en minúsculas y sin tildes;
   * si es string se pliega y se busca literal.
   */
  function buscar(lineas, patron) {
    const re = aRegExp(patron, false);
    for (let i = 0; i < (lineas || []).length; i++) {
      const l = lineas[i];
      const m = re.exec(plegar(l.texto));
      if (m && m[0].length) return resultadoBusqueda(l, i, m, unirConMapa(l.items).mapa);
    }
    return null;
  }

  /** Como buscar() pero devuelve todas las coincidencias (en orden de lectura). */
  function buscarTodos(lineas, patron) {
    const re = aRegExp(patron, true);
    const out = [];
    (lineas || []).forEach((l, i) => {
      const f = plegar(l.texto);
      let mapa = null;
      for (const m of f.matchAll(re)) {
        if (!m[0].length) continue;
        mapa = mapa || unirConMapa(l.items).mapa;
        out.push(resultadoBusqueda(l, i, m, mapa));
      }
    });
    return out;
  }

  /** Items con x en [xLo, xHi) e y en (yLo, yHi), en orden de lectura (misma semántica que el prototipo RUT). */
  function region(items, xLo, xHi, yLo, yHi) {
    return (items || []).filter((it) => it.x >= xLo && it.x < xHi && it.y > yLo && it.y < yHi).sort(ordenLectura);
  }

  /** Fecha PDF "D:20200818170908-05'00'" → "2020-08-18T17:09:08-05:00" ('' si no se puede leer). */
  function fechaPdf(s) {
    const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(Z|[+-]\d{2}'?\d{2}'?)?/.exec(String(s || '').trim());
    if (!m) return '';
    const [, a, mes = '01', d = '01', h = '00', mi = '00', se = '00', zona] = m;
    let z = '';
    if (zona === 'Z') z = 'Z';
    else if (zona) { const zz = zona.replace(/'/g, ''); z = zz.slice(0, 3) + ':' + (zz.slice(3, 5) || '00'); }
    return `${a}-${mes}-${d}T${h}:${mi}:${se}${z}`;
  }

  // ---------------------------------------------------------------- armado del Doc

  function normalizarInfo(info) {
    const i = info || {};
    const s = (v) => (v == null ? '' : String(v));
    return { Producer: s(i.Producer), Creator: s(i.Creator), CreationDate: s(i.CreationDate), ModDate: s(i.ModDate) };
  }

  function armarPagina(p, indice) {
    const crudos = Array.isArray(p.crudos) ? p.crudos : (Array.isArray(p.items) ? p.items : []);
    const items = crudos.filter(tieneTextoItem).map(normalizarItem).sort(ordenLectura);
    const lineas = agruparLineas(items);
    const texto = lineas.map((l) => l.texto).join('\n');
    const visibles = items.map((i) => i.str).join('');
    const caracteres = visibles.replace(/\s+/g, '').length;
    const ratio = ratioControl(visibles);
    const sinTexto = caracteres < MIN_CARACTERES;
    const pagina = {
      numero: Number(p.numero || p.page || p.num || indice + 1),
      ancho: Number(p.ancho != null ? p.ancho : p.width) || 0,
      alto: Number(p.alto != null ? p.alto : p.height) || 0,
      caja: Array.isArray(p.caja) ? p.caja.slice() : null,
      rotacion: Number(p.rotacion) || 0,
      crudos,
      items,
      lineas,
      texto,
      caracteres,
      ratioControl: ratio,
      sinTexto,
      ilegible: !sinTexto && ratio > UMBRAL_CONTROL,
    };
    if (p.error) pagina.error = String(p.error);
    return pagina;
  }

  /**
   * Arma un Doc a partir de páginas ya extraídas (sin pdf.js). Acepta
   *   [{ numero, ancho, alto, crudos }]  (lo que produce leer()), o
   *   el formato de los volcados de investigación [{ page, width, height, items }]
   *   (items crudos con transform, o {str, x, y, w, h, font}).
   * También acepta un objeto { pages|paginas, info }. Lanza SIN_TEXTO / TEXTO_ILEGIBLE salvo opts.tolerante.
   */
  function armarDoc(paginas, info, opts) {
    let lista = paginas;
    let inf = info;
    if (lista && !Array.isArray(lista)) {
      inf = inf || lista.info;
      lista = lista.paginas || lista.pages || [];
    }
    const o = opts || {};
    const pags = (lista || []).map(armarPagina);
    const utiles = pags.filter((p) => !p.sinTexto && !p.ilegible);
    const tieneTexto = utiles.length > 0;
    const problema = tieneTexto ? null : (pags.some((p) => p.ilegible) ? 'TEXTO_ILEGIBLE' : 'SIN_TEXTO');
    const doc = {
      paginas: pags,
      texto: pags.map((p) => (p.ilegible ? '' : p.texto)).join('\f'),
      tieneTexto,
      numPaginas: Number(o.numPaginas) || pags.length,
      info: normalizarInfo(inf),
      problema,
      truncado: !!o.truncado,
    };
    if (problema && !o.tolerante) throw crearError(problema, o.documento);
    return doc;
  }

  // ---------------------------------------------------------------- lectura con pdf.js

  function obtenerLib(opts) {
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'pdfjsLib')) return opts.pdfjsLib;
    if (root.pdfjsLib) return root.pdfjsLib;
    if (root['pdfjs-dist/build/pdf']) return root['pdfjs-dist/build/pdf'];
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { return require('pdfjs-dist/legacy/build/pdf.js'); } catch (e) { return null; }
    }
    return null;
  }

  function configurarWorker(lib) {
    // En Node pdf.js usa su "worker falso"; tocar workerSrc ahí lo rompería.
    if (typeof document === 'undefined') return;
    const g = lib.GlobalWorkerOptions;
    if (g && !g.workerSrc) g.workerSrc = root.PDFJS_WORKER_SRC || WORKER_POR_DEFECTO;
  }

  function leerBlobConFileReader(blob) {
    return new Promise((resolve, reject) => {
      const fr = new root.FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(blob);
    });
  }

  /** Copia los bytes de la entrada a un Uint8Array nuevo (pdf.js transfiere/separa el buffer que recibe). */
  async function aBytes(entrada) {
    if (entrada == null) return null;
    if (entrada instanceof ArrayBuffer || Object.prototype.toString.call(entrada) === '[object ArrayBuffer]') {
      return new Uint8Array(entrada).slice();
    }
    if (ArrayBuffer.isView(entrada)) {
      return new Uint8Array(entrada.buffer, entrada.byteOffset, entrada.byteLength).slice();
    }
    if (typeof entrada.arrayBuffer === 'function') {
      return new Uint8Array(await entrada.arrayBuffer()); // buffer nuevo: ya es una copia
    }
    if (root.FileReader && root.Blob && entrada instanceof root.Blob) {
      return new Uint8Array(await leerBlobConFileReader(entrada));
    }
    return null;
  }

  /** ¿Tiene la cabecera "%PDF-" en el primer KB? (la especificación permite basura antes). */
  function pareceUnPdf(bytes) {
    const n = Math.min(bytes.length - 4, 1024);
    for (let i = 0; i < n; i++) {
      if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
    }
    return false;
  }

  const esErrorContrasena = (e) => !!e && (e.name === 'PasswordException' || /password/i.test(e.name || ''));

  function traducirError(e, documento) {
    if (e && e.codigo) return e;
    if (esErrorContrasena(e)) return crearError('PROTEGIDO', documento, e);
    if (e && /worker/i.test(String(e.message || ''))) return crearError('LIB_NO_DISPONIBLE', documento, e);
    return crearError('NO_PDF', documento, e);
  }

  async function leerInfo(pdf) {
    try {
      const m = await pdf.getMetadata();
      return (m && m.info) || {};
    } catch (e) {
      return {};
    }
  }

  /** Lee un PDF y devuelve el Doc (ver encabezado). */
  async function leer(entrada, opts) {
    const o = opts || {};
    const documento = o.documento;
    const lib = obtenerLib(o);
    if (!lib || typeof lib.getDocument !== 'function') throw crearError('LIB_NO_DISPONIBLE', documento);
    configurarWorker(lib);

    let datos;
    try {
      datos = await aBytes(entrada);
    } catch (e) {
      throw crearError('NO_PDF', documento, e);
    }
    if (!datos || datos.length < 5 || !pareceUnPdf(datos)) throw crearError('NO_PDF', documento);

    let tarea = null;
    try {
      let pdf;
      try {
        tarea = lib.getDocument({
          data: datos,
          disableFontFace: true,
          isEvalSupported: false,
          useSystemFonts: false,
          verbosity: o.verbosity == null ? 0 : o.verbosity,
        });
        pdf = await tarea.promise;
      } catch (e) {
        throw traducirError(e, documento);
      }

      const info = await leerInfo(pdf);
      const maximo = Math.max(1, Number(o.maxPaginas) || MAX_PAGINAS);
      const total = Math.min(pdf.numPages, maximo);
      const paginas = [];
      for (let n = 1; n <= total; n++) {
        try {
          const page = await pdf.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          const tc = await page.getTextContent();
          paginas.push({
            numero: n, ancho: vp.width, alto: vp.height,
            caja: Array.isArray(page.view) ? page.view.slice() : null, rotacion: page.rotate || 0,
            crudos: tc.items,
          });
          try { page.cleanup(); } catch (e) { /* no importa */ }
        } catch (e) {
          if (esErrorContrasena(e)) throw crearError('PROTEGIDO', documento, e);
          // Una página dañada no tumba el documento: queda vacía y marcada.
          paginas.push({ numero: n, ancho: 0, alto: 0, crudos: [], error: (e && e.message) || String(e) });
        }
        if (typeof o.alProgresar === 'function') {
          try { o.alProgresar(n, total); } catch (e) { /* el callback no debe romper la lectura */ }
        }
      }
      return armarDoc(paginas, info, {
        numPaginas: pdf.numPages, truncado: pdf.numPages > total, tolerante: o.tolerante, documento,
      });
    } finally {
      if (tarea) {
        try { await tarea.destroy(); } catch (e) { /* ya destruido */ }
      }
    }
  }

  const PdfText = {
    leer,
    armarDoc,
    fold,
    compactar,
    agruparLineas,
    unirTexto,
    ratioControl,
    buscar,
    buscarTodos,
    region,
    fechaPdf,
    mensajeError,
    crearError,
    CODIGOS: ['NO_PDF', 'PROTEGIDO', 'SIN_TEXTO', 'TEXTO_ILEGIBLE', 'LIB_NO_DISPONIBLE'],
    TOL_LINEA,
    HUECO_ESPACIO,
    UMBRAL_CONTROL,
    MIN_CARACTERES,
  };

  // ================================================================ DocDetect

  // Anclas en texto compactado (fold sin espacios). Ver RUT-REPORT §6.12 y RIT-BOGOTA-REPORT §6.
  const A = {
    nit: compactar('numero de identificacion tributaria'),
    rutOtras: ['fecha generacion documento pdf', 'para uso exclusivo de la dian', 'direccion seccional'].map(compactar),
    rutPrincipal: /(?:^|[^0-9])24\.tipodecontribuyente/,
    rit: compactar('registro de informacion tributaria'),
    ritOtras: ['rit-shd', 'informacion basica del contribuyente'].map(compactar),
    ritPrincipal: ['perfil tributario', 'naturaleza juridica:'].map(compactar),
    ritActividad: /actividad1:/,
    solicitudFuerte: ['novedades rit', 'novedades en el rit'].map(compactar),
    solicitudCodigo: /(?:^|[^0-9])(?:39-f\.0?9|105-f\.203)/,
    solicitudDebil: ['lea las instrucciones al respaldo', 'instrucciones de diligenciamiento', 'opcion de uso'].map(compactar),
    instrucciones: compactar('instrucciones de diligenciamiento'),
  };

  /** Clasifica una Pagina: { tipo: 'RUT'|'RIT'|'RIT_SOLICITUD'|'DESCONOCIDO', principal, hoja }. */
  function clasificarPagina(pagina) {
    const out = { tipo: 'DESCONOCIDO', principal: false, hoja: null };
    if (!pagina || pagina.sinTexto || pagina.ilegible) return out;
    const texto = pagina.texto != null ? pagina.texto : (pagina.lineas || []).map((l) => l.texto).join('\n');
    const f = fold(texto);
    const c = f.replace(/\s+/g, '');
    const tiene = (a) => c.indexOf(a) >= 0;

    // 1) Certificado RIT (Hacienda Bogotá, "Version 2.02").
    if (tiene(A.rit) && A.ritOtras.some(tiene)) {
      const pag = /pagina(\d+)\/(\d+)/.exec(c);
      return {
        tipo: 'RIT',
        principal: A.ritPrincipal.some(tiene) || A.ritActividad.test(c),
        hoja: pag ? Number(pag[1]) : null,
      };
    }
    // 2) Formulario de solicitud/novedades del RIT (no es el certificado).
    const solicitud = A.solicitudFuerte.some(tiene) || A.solicitudCodigo.test(c);
    if (solicitud) return { tipo: 'RIT_SOLICITUD', principal: !tiene(A.instrucciones), hoja: null };
    // 3) RUT (DIAN formulario 001). Hoja principal = la que tiene "24. Tipo de contribuyente".
    if (tiene(A.nit) && A.rutOtras.some(tiene)) {
      const principal = A.rutPrincipal.test(c);
      const h = /(?:^|[^a-z])hoja\s*([1-9])(?![0-9])/.exec(f);
      return { tipo: 'RUT', principal, hoja: principal ? 1 : (h ? Number(h[1]) : null) };
    }
    // 4) Solicitud RIT sin título reconocible (formularios viejos): menciona el RIT + instrucciones del formulario.
    if ((tiene(A.rit) || /(?:^|[^a-z0-9])rit(?![a-z0-9])/.test(f)) && A.solicitudDebil.some(tiene)) {
      return { tipo: 'RIT_SOLICITUD', principal: !tiene(A.instrucciones), hoja: null };
    }
    return out;
  }

  /** [{ numero, tipo, principal, hoja, sinTexto, ilegible }] para cada página del Doc. */
  function paginasDoc(doc) {
    return ((doc && doc.paginas) || []).map((p) => {
      const c = clasificarPagina(p);
      return { numero: p.numero, tipo: c.tipo, principal: c.principal, hoja: c.hoja, sinTexto: !!p.sinTexto, ilegible: !!p.ilegible };
    });
  }

  /** Tipos presentes, en orden de aparición (sin 'DESCONOCIDO'). */
  function tiposDoc(doc) {
    const out = [];
    for (const p of paginasDoc(doc)) if (p.tipo !== 'DESCONOCIDO' && out.indexOf(p.tipo) < 0) out.push(p.tipo);
    return out;
  }

  /**
   * Tipo del documento: 'RUT' | 'RIT' | 'RIT_SOLICITUD' | 'DESCONOCIDO'.
   * Si hay RUT y RIT en el mismo PDF gana el de la primera página principal (hoja principal del RUT o
   * página 1 del certificado RIT); usa DocDetect.tipos(doc) para saber todo lo que contiene.
   */
  function tipoDoc(doc) {
    const pags = paginasDoc(doc);
    const reales = pags.filter((p) => p.tipo === 'RUT' || p.tipo === 'RIT');
    const principal = reales.find((p) => p.principal);
    if (principal) return principal.tipo;
    if (reales.length) return reales[0].tipo;
    if (pags.some((p) => p.tipo === 'RIT_SOLICITUD')) return 'RIT_SOLICITUD';
    return 'DESCONOCIDO';
  }

  const DocDetect = {
    tipo: tipoDoc,
    tipos: tiposDoc,
    paginas: paginasDoc,
    clasificarPagina,
  };
  PdfText.DocDetect = DocDetect;

  root.PdfText = PdfText;
  root.DocDetect = DocDetect;
  if (typeof module !== 'undefined' && module.exports) module.exports = PdfText;
})(typeof window !== 'undefined' ? window : globalThis);
