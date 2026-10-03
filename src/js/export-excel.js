// Exportación al Excel oficial 13-IF-016.
//
// Toma la plantilla ORIGINAL (.xlsx) y escribe los valores del formulario editando
// directamente el XML de las hojas con JSZip. No se usa ninguna librería que reescriba
// el libro: formatos, protección, validaciones, imágenes, tablas, fórmulas y la hoja
// oculta 'Validador- Datos' quedan intactos; solo cambian las celdas mapeadas en
// SCHEMA.fields[*].excel, el resultado guardado de las fórmulas de las dos hojas visibles (el de
// Calc, para que la Vista protegida y las vistas previas no muestren el ejemplo de la plantilla) y
// el atributo fullCalcOnLoad de workbook.xml (para que Excel recalcule todo al abrir).
//
// API (window.ExportExcel):
//   generar(s, opts?)        -> Promise<Blob>        archivo .xlsx diligenciado
//   generarBytes(s, opts?)   -> Promise<Uint8Array>  igual, en bytes (útil en Node)
//   descargar(s, opts?)      -> Promise<string>      genera y descarga; devuelve el nombre
//   nombreArchivo(s)         -> string               NOMBRE_CONTRATO_AÑOCONTRATO (sin extensión)
//   escrituras(s)            -> { celdas: [{hoja, celda, tipo:'n'|'s'|'', valor, campo}], avisos: [string] }
//   serialFecha(iso)         -> number | null        'aaaa-mm-dd' -> número de serie de Excel
//   editarHoja(xml, cambios, nombreHoja?) -> string  (bajo nivel; cambios: Map ref -> {tipo, valor})
// opts: { plantilla?: ArrayBuffer|Uint8Array|Blob, JSZip?: constructor, hoy?: Date|'aaaa-mm-dd' (para Calc),
//         sinResultados?: true (no reescribe los resultados guardados de las fórmulas) }
(function (root) {
  'use strict';

  const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const NOMBRE_PLANTILLA = '13-IF-016_Actualiz datos personas naturales honorarios y servicios personales art103ET_v1.xlsx';
  // Solo en desarrollo (servidor http); el archivo construido trae la plantilla en base64.
  const PLANTILLAS_DEV = ['../' + NOMBRE_PLANTILLA, NOMBRE_PLANTILLA, 'plantilla.xlsx', '../plantilla.xlsx'];
  const MAX_TEXTO_CELDA = 32767;

  function errorCodigo(codigo, mensaje) {
    const e = new Error(mensaje);
    e.codigo = codigo;
    return e;
  }

  // ───────────────────────── Referencias de celda ─────────────────────────

  function letrasANumero(letras) {
    let n = 0;
    for (let i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
    return n;
  }

  function numeroALetras(n) {
    let s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function partirRef(ref) {
    const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(String(ref).toUpperCase());
    if (!m) throw new Error('Referencia de celda inválida: ' + ref);
    return { col: letrasANumero(m[1]), fila: Number(m[2]) };
  }

  // ───────────────────────── Texto y XML ─────────────────────────

  function escaparXml(t) {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escaparAtributo(t) {
    return escaparXml(t).replace(/"/g, '&quot;');
  }

  function desescaparXml(t) {
    return String(t)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  // Deja solo caracteres válidos en XML 1.0 y protege secuencias que Excel interpretaría
  // como escapes propios (_x0041_ -> 'A').
  function limpiarTexto(t) {
    let r = String(t)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
      .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
      .replace(/_(x[0-9A-Fa-f]{4}_)/g, '_x005F_$1');
    if (r.length > MAX_TEXTO_CELDA) r = r.slice(0, MAX_TEXTO_CELDA);
    return r;
  }

  function leerAtributos(etiqueta) {
    const attrs = [];
    const re = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(etiqueta))) attrs.push({ nombre: m[1], valor: m[3] !== undefined ? m[3] : m[4] });
    return attrs;
  }

  function atributo(etiqueta, nombre) {
    const a = leerAtributos(etiqueta).find((x) => x.nombre === nombre);
    return a ? a.valor : null;
  }

  // ───────────────────────── Conversión de valores ─────────────────────────

  // 'aaaa-mm-dd' -> número de serie de Excel (sistema 1900). null si no es una fecha válida.
  function serialFecha(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso).trim());
    if (!m) return null;
    const a = Number(m[1]), mes = Number(m[2]), d = Number(m[3]);
    const t = Date.UTC(a, mes - 1, d);
    const f = new Date(t);
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
    let serial = Math.round((t - Date.UTC(1899, 11, 30)) / 86400000);
    if (serial < 61) serial -= 1; // antes del 1900-03-01 (error histórico del 29/02/1900)
    return serial >= 1 ? serial : null;
  }

  const VACIA = Object.freeze({ tipo: '', valor: '' });
  const texto = (v) => ({ tipo: 's', valor: limpiarTexto(v) });
  const numeroCanonico = (v) => {
    const neg = v[0] === '-';
    let [ent, dec] = (neg ? v.slice(1) : v).split('.');
    ent = ent.replace(/^0+(?=\d)/, '');
    if (dec !== undefined) dec = dec.replace(/0+$/, '');
    const r = dec ? ent + '.' + dec : ent;
    return neg && r !== '0' ? '-' + r : r;
  };
  const numero = (v) => ({ tipo: 'n', valor: numeroCanonico(v) });

  // Más de 15 cifras significativas no caben en un double de Excel: se guardan como texto.
  function cabeEnNumero(v) {
    return v.replace(/[-.]/g, '').replace(/^0+/, '').length <= 15;
  }

  function aNumeroOTexto(v) {
    if (/^-?\d+(\.\d+)?$/.test(v) && cabeEnNumero(v)) return numero(v);
    return texto(v);
  }

  // 'auto': número solo si son dígitos sin cero inicial (los ceros a la izquierda se conservan como texto).
  function aAuto(v) {
    if (/^(0|[1-9]\d{0,14})$/.test(v)) return numero(v);
    return texto(v);
  }

  function esVisible(campo, s) {
    if (typeof campo.visible !== 'function') return true;
    try { return !!campo.visible(s); } catch (e) { return true; }
  }

  // Lista de celdas a escribir para el estado `s`. Se escriben TODAS las celdas mapeadas
  // (las vacías se limpian) para que la plantilla nunca conserve datos de ejemplo.
  function escrituras(s) {
    const SCHEMA = root.SCHEMA;
    if (!SCHEMA || !SCHEMA.fields) throw errorCodigo('SIN_SCHEMA', 'No se cargó la definición del formulario (SCHEMA).');
    const st = s || {};
    const celdas = [];
    const avisos = [];

    for (const id of Object.keys(SCHEMA.fields)) {
      const campo = SCHEMA.fields[id];
      const ex = campo.excel;
      if (!ex) continue;
      const poner = (celda, val) => celdas.push({ hoja: ex.hoja, celda, tipo: val.tipo, valor: val.valor, campo: id });

      let bruto = st[id] == null ? '' : String(st[id]);
      // Los campos ocultos (p. ej. datos de AFC cuando la respuesta es NO) no van al formato oficial.
      if (!esVisible(campo, st)) bruto = '';
      // Los valores de catálogo se escriben EXACTOS (algunos nombres terminan en espacio y las BUSCARV dependen de ello).
      // Calc.valorCampo corrige variantes de mayúsculas, tildes o espacios al texto literal del catálogo.
      const exacto = campo.type === 'select' || campo.type === 'combo';
      if (exacto && bruto.trim() !== '' && root.Calc && typeof root.Calc.valorCampo === 'function') {
        bruto = root.Calc.valorCampo(campo, bruto);
      }
      let v = bruto.trim() === '' ? '' : (exacto ? bruto : bruto.trim());
      // Defensa: dinero, dígitos y teléfonos se guardan sin separadores (p. ej. '4.500.000' -> '4500000').
      if (['money', 'digits', 'tel'].includes(campo.type)) v = v.replace(/\D/g, '');

      switch (ex.tipo) {
        case 'texto':
          poner(ex.celda, v ? texto(v) : VACIA);
          break;
        case 'numero':
          poner(ex.celda, v ? aNumeroOTexto(v.replace(/\s+/g, '')) : VACIA);
          break;
        case 'auto':
          poner(ex.celda, v ? aAuto(v) : VACIA);
          break;
        case 'fecha': {
          if (!v) { poner(ex.celda, VACIA); break; }
          const serial = serialFecha(v);
          if (serial == null) {
            avisos.push(`El campo "${campo.label}" no tiene una fecha válida (${v}); se exportó como texto.`);
            poner(ex.celda, texto(v));
          } else {
            poner(ex.celda, { tipo: 'n', valor: String(serial) });
          }
          break;
        }
        case 'digitos': {
          const chars = Array.from(v.replace(/\s+/g, ''));
          if (chars.length > ex.celdas.length) {
            avisos.push(`El campo "${campo.label}" tiene ${chars.length} caracteres pero el formato solo admite ${ex.celdas.length}; se exportaron los primeros ${ex.celdas.length}.`);
          }
          ex.celdas.forEach((ref, i) => {
            const ch = chars[i];
            if (ch === undefined) poner(ref, VACIA);
            else poner(ref, /^\d$/.test(ch) ? numero(ch) : texto(ch));
          });
          break;
        }
        case 'x': {
          const r = v.toUpperCase();
          poner(ex.si, r === 'SI' ? texto('X') : VACIA);
          poner(ex.no, r === 'NO' ? texto('X') : VACIA);
          break;
        }
        case 'marca':
          poner(ex.celda, v.toUpperCase() === 'SI' ? texto(ex.valor) : VACIA);
          break;
        default:
          throw new Error(`Tipo de mapeo Excel desconocido "${ex.tipo}" en el campo ${id}`);
      }
    }
    return { celdas, avisos };
  }

  // ───────────────────────── Edición del XML de una hoja ─────────────────────────

  function xmlCelda(ref, atributosBase, val) {
    if (!val || !val.tipo || val.valor === '') return `<c r="${ref}"${atributosBase}/>`;
    if (val.tipo === 'n') return `<c r="${ref}"${atributosBase}><v>${val.valor}</v></c>`;
    return `<c r="${ref}"${atributosBase} t="inlineStr"><is><t xml:space="preserve">${escaparXml(val.valor)}</t></is></c>`;
  }

  // Atributos de la celda existente que se conservan (estilo, fonética…). Se quitan el tipo
  // y los metadatos de celda (cm/vm), que solo aplican al valor anterior.
  function atributosConservados(etiqueta) {
    return leerAtributos(etiqueta)
      .filter((a) => !['r', 't', 'cm', 'vm'].includes(a.nombre))
      .map((a) => ` ${a.nombre}="${a.valor}"`)
      .join('');
  }

  // Estilo por defecto de una celda que no existe: el de la fila (si customFormat) o el de la columna.
  function estiloHeredado(etiquetaFila, col, columnas) {
    if (etiquetaFila && atributo(etiquetaFila, 'customFormat') === '1') {
      const s = atributo(etiquetaFila, 's');
      if (s && s !== '0') return s;
    }
    for (const c of columnas) if (col >= c.min && col <= c.max) return c.estilo && c.estilo !== '0' ? c.estilo : null;
    return null;
  }

  function leerColumnas(xml) {
    const cols = [];
    const m = /<cols>([\s\S]*?)<\/cols>/.exec(xml);
    if (!m) return cols;
    const re = /<col\b[^>]*>/g;
    let t;
    while ((t = re.exec(m[1]))) {
      cols.push({ min: Number(atributo(t[0], 'min')), max: Number(atributo(t[0], 'max')), estilo: atributo(t[0], 'style') });
    }
    return cols;
  }

  // Separa el contenido de una fila en celdas, conservando el texto original de cada una.
  function leerCeldas(contenido, fila) {
    const celdas = [];
    const re = /<c\b[^>]*?(\/?)>/g;
    let m;
    let colAnterior = 0;
    while ((m = re.exec(contenido))) {
      const ini = m.index;
      let fin;
      if (m[1] === '/') fin = re.lastIndex;
      else {
        const cierre = contenido.indexOf('</c>', re.lastIndex);
        if (cierre < 0) throw new Error(`XML de la fila ${fila} mal formado (falta </c>).`);
        fin = cierre + 4;
        re.lastIndex = fin;
      }
      const r = atributo(m[0], 'r');
      const col = r ? partirRef(r).col : colAnterior + 1;
      colAnterior = col;
      celdas.push({ col, etiqueta: m[0], raw: contenido.slice(ini, fin) });
    }
    return celdas;
  }

  function actualizarSpans(etiquetaFila, cols) {
    const spans = atributo(etiquetaFila, 'spans');
    if (!spans || !/^\d+:\d+$/.test(spans)) return etiquetaFila;
    let [a, b] = spans.split(':').map(Number);
    for (const c of cols) { a = Math.min(a, c); b = Math.max(b, c); }
    const nuevo = `${a}:${b}`;
    return nuevo === spans ? etiquetaFila : etiquetaFila.replace(/spans="[^"]*"/, `spans="${nuevo}"`);
  }

  function actualizarDimension(xml, refs) {
    const m = /<dimension\b[^>]*\bref="([^"]*)"[^>]*\/>/.exec(xml);
    if (!m || !refs.length) return xml;
    const partes = m[1].split(':');
    let ini, fin;
    try {
      ini = partirRef(partes[0]);
      fin = partirRef(partes[1] || partes[0]);
    } catch (e) { return xml; }
    let [c1, f1, c2, f2] = [ini.col, ini.fila, fin.col, fin.fila];
    for (const r of refs) {
      const p = partirRef(r);
      c1 = Math.min(c1, p.col); f1 = Math.min(f1, p.fila);
      c2 = Math.max(c2, p.col); f2 = Math.max(f2, p.fila);
    }
    const nuevo = `${numeroALetras(c1)}${f1}:${numeroALetras(c2)}${f2}`;
    if (nuevo === m[1]) return xml;
    return xml.slice(0, m.index) + m[0].replace(`ref="${m[1]}"`, `ref="${nuevo}"`) + xml.slice(m.index + m[0].length);
  }

  // cambios: Map<ref, {tipo:'n'|'s'|'', valor}>. Devuelve el XML con solo esas celdas modificadas.
  function editarHoja(xml, cambios, nombreHoja) {
    const etiquetaHoja = nombreHoja ? `'${nombreHoja}'!` : '';
    if (!cambios || cambios.size === 0) return xml;

    let doc = xml.replace(/<sheetData\s*\/>/, '<sheetData></sheetData>');
    const abre = /<sheetData\b[^>]*>/.exec(doc);
    if (!abre) throw new Error('La hoja no tiene <sheetData>.');
    const iniDatos = abre.index + abre[0].length;
    const finDatos = doc.indexOf('</sheetData>', iniDatos);
    if (finDatos < 0) throw new Error('La hoja no tiene </sheetData>.');
    const datos = doc.slice(iniDatos, finDatos);
    const columnas = leerColumnas(doc);

    // Agrupar cambios por fila.
    const porFila = new Map();
    for (const [ref, val] of cambios) {
      const p = partirRef(ref);
      if (!porFila.has(p.fila)) porFila.set(p.fila, []);
      porFila.get(p.fila).push({ ref: ref.toUpperCase().replace(/\$/g, ''), col: p.col, val });
    }

    // Leer filas existentes (posiciones dentro de `datos`).
    const filas = [];
    const reFila = /<row\b[^>]*?(\/?)>/g;
    let m;
    while ((m = reFila.exec(datos))) {
      const ini = m.index;
      const r = Number(atributo(m[0], 'r'));
      let fin, contenido;
      if (m[1] === '/') { fin = reFila.lastIndex; contenido = ''; }
      else {
        const cierre = datos.indexOf('</row>', reFila.lastIndex);
        if (cierre < 0) throw new Error('XML de la hoja mal formado (falta </row>).');
        contenido = datos.slice(reFila.lastIndex, cierre);
        fin = cierre + 6;
        reFila.lastIndex = fin;
      }
      filas.push({ r, ini, fin, etiqueta: m[0], contenido, autocerrada: m[1] === '/' });
    }

    const reemplazos = []; // { ini, fin, texto }
    const nuevasRefs = [];

    for (const [numFila, lista] of porFila) {
      lista.sort((a, b) => a.col - b.col);
      const fila = filas.find((f) => f.r === numFila);
      const celdas = fila ? leerCeldas(fila.contenido, numFila) : [];
      const colsNuevas = [];

      for (const cambio of lista) {
        const i = celdas.findIndex((c) => c.col === cambio.col);
        if (i >= 0) {
          const actual = celdas[i];
          if (/<f[\s>/]/.test(actual.raw)) {
            throw new Error(`La celda ${etiquetaHoja}${cambio.ref} de la plantilla contiene una fórmula; no se puede escribir en ella.`);
          }
          celdas[i] = { col: cambio.col, raw: xmlCelda(cambio.ref, atributosConservados(actual.etiqueta), cambio.val) };
        } else {
          const estilo = estiloHeredado(fila && fila.etiqueta, cambio.col, columnas);
          const nueva = { col: cambio.col, raw: xmlCelda(cambio.ref, estilo ? ` s="${estilo}"` : '', cambio.val) };
          const pos = celdas.findIndex((c) => c.col > cambio.col);
          if (pos < 0) celdas.push(nueva); else celdas.splice(pos, 0, nueva);
          colsNuevas.push(cambio.col);
          nuevasRefs.push(cambio.ref);
        }
      }

      const cuerpo = celdas.map((c) => c.raw).join('');
      if (fila) {
        let etiqueta = actualizarSpans(fila.etiqueta, colsNuevas);
        if (fila.autocerrada) etiqueta = etiqueta.replace(/\s*\/>$/, '>');
        reemplazos.push({ ini: fila.ini, fin: fila.fin, texto: etiqueta + cuerpo + '</row>' });
      } else {
        // Fila inexistente: se inserta antes de la primera fila con número mayor.
        const siguiente = filas.find((f) => f.r > numFila);
        const pos = siguiente ? siguiente.ini : datos.length;
        reemplazos.push({ ini: pos, fin: pos, texto: `<row r="${numFila}">${cuerpo}</row>` });
      }
    }

    // Aplicar de atrás hacia adelante (con inserciones en la misma posición en orden de fila).
    reemplazos.sort((a, b) => b.ini - a.ini || b.fin - a.fin);
    let nuevosDatos = datos;
    for (const r of reemplazos) nuevosDatos = nuevosDatos.slice(0, r.ini) + r.texto + nuevosDatos.slice(r.fin);

    doc = doc.slice(0, iniDatos) + nuevosDatos + doc.slice(finDatos);
    return actualizarDimension(doc, nuevasRefs);
  }

  // ───────────────────────── Resultados guardados de las fórmulas ─────────────────────────
  // Excel en Vista protegida (archivo descargado o adjunto a un correo), las vistas previas y los visores
  // no recalculan: muestran el último resultado guardado de cada fórmula, que en la plantilla es el de su
  // ejemplo. Por eso se guardan los resultados de Calc (paridad exacta con las fórmulas del Excel).
  // fullCalcOnLoad sigue activo: al habilitar la edición Excel recalcula todo igual.

  // Valor de Calc -> { t: atributo t ('' = número), v: texto de <v> } o null si no hay nada que guardar.
  function valorEnCache(x) {
    if (typeof x === 'number') return Number.isFinite(x) ? { t: '', v: String(x) } : null;
    if (typeof x === 'boolean') return { t: 'b', v: x ? '1' : '0' };
    if (typeof x === 'string') return { t: 'str', v: escaparXml(limpiarTexto(x)) };
    if (x && typeof x === 'object' && typeof x.error === 'string') return { t: 'e', v: escaparXml(x.error) };
    return null;
  }

  // valores: Map<ref, valor de Calc>. Solo toca celdas que YA tienen fórmula en la plantilla: conserva la
  // fórmula (<f>) y los atributos (estilo, metadatos) y reemplaza el resultado guardado (<v> y t).
  function actualizarResultados(xml, valores) {
    if (!valores || valores.size === 0) return xml;
    const re = /<c\b[^>]*?(\/?)>/g;
    let salida = '';
    let desde = 0;
    let m;
    while ((m = re.exec(xml))) {
      if (m[1] === '/') continue;
      const cierre = xml.indexOf('</c>', re.lastIndex);
      if (cierre < 0) break;
      const fin = cierre + 4;
      const ref = atributo(m[0], 'r');
      const interior = xml.slice(re.lastIndex, cierre);
      re.lastIndex = fin;
      if (!ref || !valores.has(ref)) continue;
      const formula = /<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/.exec(interior);
      if (!formula) continue;
      const val = valorEnCache(valores.get(ref));
      if (!val) continue;
      const attrs = leerAtributos(m[0]).filter((a) => a.nombre !== 't').map((a) => ` ${a.nombre}="${a.valor}"`).join('');
      salida += xml.slice(desde, m.index) + `<c${attrs}${val.t ? ` t="${val.t}"` : ''}>${formula[0]}<v>${val.v}</v></c>`;
      desde = fin;
    }
    return desde === 0 ? xml : salida + xml.slice(desde);
  }

  // Resultados de Calc por hoja del esquema ('datos' / 'deducciones'): Map<hoja, Map<ref, valor>>.
  function resultadosCalc(s, opts) {
    const C = root.Calc;
    if (!C || typeof C.derivados !== 'function') return new Map();
    let celdas;
    try { celdas = C.derivados(s || {}, opts && opts.hoy).celdas || {}; } catch (e) { return new Map(); }
    const porHoja = new Map();
    for (const [clave, valor] of Object.entries(celdas)) {
      const i = clave.indexOf('!');
      const hoja = clave.slice(0, i);
      if (hoja !== 'datos' && hoja !== 'deducciones') continue; // la hoja oculta no se ve en ningún visor
      if (!porHoja.has(hoja)) porHoja.set(hoja, new Map());
      porHoja.get(hoja).set(clave.slice(i + 1), valor);
    }
    return porHoja;
  }

  // ───────────────────────── Libro (workbook.xml) ─────────────────────────

  function resolverRuta(base, destino) {
    if (destino.startsWith('/')) return destino.slice(1);
    const partes = base.split('/').filter(Boolean);
    for (const p of destino.split('/')) {
      if (p === '..') partes.pop();
      else if (p !== '.' && p !== '') partes.push(p);
    }
    return partes.join('/');
  }

  // nombre de hoja -> ruta del XML dentro del zip (vía workbook.xml + workbook.xml.rels).
  async function rutasHojas(zip) {
    const rutaLibro = await rutaWorkbook(zip);
    const dir = rutaLibro.includes('/') ? rutaLibro.slice(0, rutaLibro.lastIndexOf('/')) : '';
    const rutaRels = (dir ? dir + '/' : '') + '_rels/' + rutaLibro.split('/').pop() + '.rels';
    const libro = await leerTexto(zip, rutaLibro);
    const rels = await leerTexto(zip, rutaRels);

    const destinos = {};
    const reRel = /<Relationship\b[^>]*>/g;
    let m;
    while ((m = reRel.exec(rels))) {
      const id = atributo(m[0], 'Id');
      const target = atributo(m[0], 'Target');
      if (id && target) destinos[id] = resolverRuta(dir, desescaparXml(target));
    }

    const hojas = {};
    const reHoja = /<sheet\b[^>]*>/g;
    while ((m = reHoja.exec(libro))) {
      const nombre = atributo(m[0], 'name');
      const rid = leerAtributos(m[0]).find((a) => /(^|:)id$/.test(a.nombre) && a.nombre !== 'sheetId');
      if (nombre && rid && destinos[rid.valor]) hojas[desescaparXml(nombre)] = destinos[rid.valor];
    }
    return { libro: rutaLibro, hojas };
  }

  async function rutaWorkbook(zip) {
    const rels = zip.file('_rels/.rels');
    if (rels) {
      const xml = await rels.async('string');
      const reRel = /<Relationship\b[^>]*>/g;
      let m;
      while ((m = reRel.exec(xml))) {
        if (/officeDocument"?$/.test(atributo(m[0], 'Type') || '')) return resolverRuta('', desescaparXml(atributo(m[0], 'Target')));
      }
    }
    return 'xl/workbook.xml';
  }

  async function leerTexto(zip, ruta) {
    const f = zip.file(ruta);
    if (!f) throw errorCodigo('PLANTILLA_INVALIDA', `La plantilla de Excel no contiene ${ruta}.`);
    return f.async('string');
  }

  // Pide a Excel recalcular todas las fórmulas al abrir (los valores en caché de la plantilla están vacíos).
  function activarRecalculo(xml) {
    const m = /<calcPr\b[^>]*?\/?>/.exec(xml);
    if (m) {
      let etiqueta = m[0];
      if (/\bfullCalcOnLoad="[^"]*"/.test(etiqueta)) etiqueta = etiqueta.replace(/\bfullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"');
      else etiqueta = etiqueta.replace(/^<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
      return xml.slice(0, m.index) + etiqueta + xml.slice(m.index + m[0].length);
    }
    // Sin calcPr: se inserta en su lugar según el esquema (después de definedNames / sheets…).
    const despues = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing',
      'fileRecoveryPr', 'webPublishObjects', 'extLst'];
    for (const t of despues) {
      const i = xml.search(new RegExp('<' + t + '\\b'));
      if (i >= 0) return xml.slice(0, i) + '<calcPr fullCalcOnLoad="1"/>' + xml.slice(i);
    }
    const i = xml.lastIndexOf('</workbook>');
    return xml.slice(0, i) + '<calcPr fullCalcOnLoad="1"/>' + xml.slice(i);
  }

  // ───────────────────────── Plantilla ─────────────────────────

  function base64ABytes(b64) {
    const limpio = String(b64).replace(/\s+/g, '');
    if (typeof atob === 'function') {
      const bin = atob(limpio);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(limpio, 'base64'));
  }

  async function aBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    if (x && typeof x.arrayBuffer === 'function') return new Uint8Array(await x.arrayBuffer());
    throw errorCodigo('PLANTILLA_INVALIDA', 'La plantilla de Excel no tiene un formato válido.');
  }

  let plantillaEnCache = null;

  function cargarPlantilla(opts) {
    if (opts && opts.plantilla) return aBytes(opts.plantilla);
    if (!plantillaEnCache) {
      plantillaEnCache = (async () => {
        if (root.PLANTILLA_XLSX_B64) return base64ABytes(root.PLANTILLA_XLSX_B64);
        if (typeof fetch === 'function') {
          for (const url of PLANTILLAS_DEV) {
            try {
              const r = await fetch(encodeURI(url));
              if (r.ok) return new Uint8Array(await r.arrayBuffer());
            } catch (e) { /* siguiente candidato */ }
          }
        }
        throw errorCodigo('SIN_PLANTILLA', 'No se encontró la plantilla de Excel del formato 13-IF-016.');
      })();
      plantillaEnCache.catch(() => { plantillaEnCache = null; });
    }
    return plantillaEnCache;
  }

  function obtenerJSZip(opts) {
    if (opts && opts.JSZip) return opts.JSZip;
    if (root.JSZip) return root.JSZip;
    if (typeof require === 'function') {
      try { return require('jszip'); } catch (e) { /* no disponible */ }
    }
    throw errorCodigo('LIB_NO_DISPONIBLE', 'No se pudo cargar la librería para generar el Excel (JSZip).');
  }

  // ───────────────────────── API ─────────────────────────

  async function generarBytes(s, opts) {
    const o = opts || {};
    const JSZip = obtenerJSZip(o);
    const SCHEMA = root.SCHEMA;
    const plantilla = await cargarPlantilla(o);
    const zip = await JSZip.loadAsync(plantilla);
    const { libro, hojas } = await rutasHojas(zip);
    const { celdas } = escrituras(s);

    const porHoja = new Map();
    for (const c of celdas) {
      const nombre = SCHEMA.nombresHojas[c.hoja];
      if (!nombre) throw new Error('Hoja desconocida en el esquema: ' + c.hoja);
      if (!porHoja.has(nombre)) porHoja.set(nombre, new Map());
      porHoja.get(nombre).set(c.celda, { tipo: c.tipo, valor: c.valor });
    }

    const resultados = o.sinResultados ? new Map() : resultadosCalc(s, o);
    const claveHoja = Object.fromEntries(Object.entries(SCHEMA.nombresHojas).map(([k, v]) => [v, k]));
    for (const [nombre, cambios] of porHoja) {
      const ruta = hojas[nombre];
      if (!ruta) throw errorCodigo('PLANTILLA_INVALIDA', `La plantilla de Excel no tiene la hoja "${nombre}".`);
      const xml = await leerTexto(zip, ruta);
      const editado = editarHoja(xml, cambios, nombre);
      zip.file(ruta, actualizarResultados(editado, resultados.get(claveHoja[nombre])), { createFolders: false });
    }

    zip.file(libro, activarRecalculo(await leerTexto(zip, libro)), { createFolders: false });

    return zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: MIME_XLSX,
    });
  }

  async function generar(s, opts) {
    const bytes = await generarBytes(s, opts);
    return new Blob([bytes], { type: MIME_XLSX });
  }

  // NOMBRE_CONTRATO_AÑOCONTRATO (instructivo), apto para cualquier sistema de archivos.
  function nombreArchivo(s) {
    const st = s || {};
    const val = (k) => (st[k] == null ? '' : String(st[k]).trim());
    const nombre = ['primerApellido', 'segundoApellido', 'primerNombre', 'otrosNombres'].map(val).filter(Boolean).join(' ');
    let base = [nombre, val('numeroContrato'), val('anioContrato')].filter(Boolean).join('_');
    base = base.toLocaleUpperCase('es-CO')
      .replace(/[\u0000-\u001F<>:"/\\|?*]+/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_.\s]+|[_.\s]+$/g, '');
    if (!base) base = 'FORMULARIO_13-IF-016';
    if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(base)) base = '_' + base;
    return base.slice(0, 150).replace(/[_.\s]+$/, '');
  }

  async function descargar(s, opts) {
    const blob = await generar(s, opts);
    const nombre = nombreArchivo(s) + '.xlsx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
    return nombre;
  }

  const ExportExcel = {
    generar,
    generarBytes,
    descargar,
    nombreArchivo,
    escrituras,
    serialFecha,
    editarHoja,
    MIME: MIME_XLSX,
    // Solo para pruebas.
    _interno: { activarRecalculo, rutasHojas, partirRef, numeroALetras, limpiarTexto, base64ABytes, actualizarResultados, valorEnCache },
  };

  root.ExportExcel = ExportExcel;
  if (typeof module !== 'undefined' && module.exports) module.exports = ExportExcel;
})(typeof window !== 'undefined' ? window : globalThis);
