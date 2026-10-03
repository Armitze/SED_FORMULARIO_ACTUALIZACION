// Consulta del contrato del contratista en SECOP II (Datos Abiertos Colombia, conjunto jbjy-vk9h).
// Filtra por la entidad (Secretaría de Educación del Distrito, código 701321135) y por el documento del
// proveedor, descarta los contratos que ya no están vigentes y traduce el contrato elegido a campos del
// formulario. La cédula viaja en el cuerpo de una petición POST (no en la URL).
(function (root) {
  const POR_DEFECTO = {
    url: 'https://www.datos.gov.co/api/v3/views/jbjy-vk9h/query.json',
    codigoEntidad: '701321135',
    estadosExcluidos: ['Borrador', 'Cancelado', 'Cerrado', 'terminado'],
    tiempoMaximoMs: 20000,
  };

  const COLUMNAS = [
    'referencia_del_contrato', 'id_contrato', 'estado_contrato', 'fecha_de_firma', 'fecha_de_inicio_del_contrato',
    'fecha_de_fin_del_contrato', 'valor_del_contrato', 'duraci_n_del_contrato', 'objeto_del_contrato',
    'descripcion_del_proceso', 'tipo_de_contrato', 'nombre_supervisor', 'dias_adicionados', 'urlproceso',
  ];

  function config() {
    const c = (root.CONFIG && root.CONFIG.secop) || {};
    return { ...POR_DEFECTO, ...c };
  }

  function error(codigo, mensaje) {
    const e = new Error(mensaje || codigo);
    e.codigo = codigo;
    e.name = 'SecopError';
    return e;
  }

  const plegar = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  const soloDigitos = (t) => String(t == null ? '' : t).replace(/\D/g, '');

  /** SoQL de la consulta. Solo dígitos llegan a la consulta: no hay inyección posible. */
  function consulta(documento) {
    const doc = soloDigitos(documento);
    if (doc.length < 5 || doc.length > 12) throw error('DOCUMENTO_INVALIDO', 'Número de identificación no válido para consultar SECOP.');
    const entidad = soloDigitos(config().codigoEntidad);
    return 'SELECT ' + COLUMNAS.join(', ') + " WHERE codigo_entidad='" + entidad + "' AND documento_proveedor='" + doc + "' LIMIT 100";
  }

  const fechaIso = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? '' : v));
    return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
  };

  /** '225 Dia(s)' → 225; '8 Mes(es)' → 240; '1 Año(s)' → 360; '2 Semana(s)' → 14. */
  function duracionEnDias(texto) {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*([a-zñáéíóú]+)/i.exec(String(texto == null ? '' : texto));
    if (!m) return 0;
    const n = Number(m[1].replace(',', '.'));
    const u = plegar(m[2]);
    const factor = u.startsWith('dia') ? 1 : u.startsWith('semana') ? 7 : u.startsWith('mes') ? 30 : u.startsWith('ano') ? 360 : 0;
    return n > 0 && factor ? Math.round(n * factor) : 0;
  }

  /** '8 Mes(es)' → '8 meses'; '1 Dia(s)' → '1 día'. */
  function textoDuracion(texto) {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*([a-zñáéíóú]+)/i.exec(String(texto == null ? '' : texto));
    if (!m) return String(texto || '').trim();
    const u = plegar(m[2]);
    const nombres = u.startsWith('dia') ? ['día', 'días'] : u.startsWith('semana') ? ['semana', 'semanas']
      : u.startsWith('mes') ? ['mes', 'meses'] : u.startsWith('ano') ? ['año', 'años'] : [m[2], m[2]];
    return m[1] + ' ' + (Number(m[1].replace(',', '.')) === 1 ? nombres[0] : nombres[1]);
  }

  const definido = (v) => {
    const t = String(v == null ? '' : v).trim();
    return t && !/^no\s+definid[oa]$/i.test(t) ? t : '';
  };

  /** Registro crudo de la API → contrato normalizado (solo lo que usa el formulario). */
  function normalizar(r) {
    const o = r && typeof r === 'object' ? r : {};
    const url = o.urlproceso && typeof o.urlproceso === 'object' ? o.urlproceso.url : o.urlproceso;
    const valor = Number(String(o.valor_del_contrato == null ? '' : o.valor_del_contrato).replace(/[^\d.]/g, ''));
    return {
      referencia: String(o.referencia_del_contrato || o.id_contrato || '').trim(),
      estado: String(o.estado_contrato || '').trim(),
      fechaFirma: fechaIso(o.fecha_de_firma),
      fechaInicio: fechaIso(o.fecha_de_inicio_del_contrato),
      fechaFin: fechaIso(o.fecha_de_fin_del_contrato),
      valor: Number.isFinite(valor) ? Math.round(valor) : 0,
      duracion: String(o.duraci_n_del_contrato || '').trim(),
      duracionDias: duracionEnDias(o.duraci_n_del_contrato),
      diasAdicionados: Math.max(0, Math.round(Number(o.dias_adicionados) || 0)),
      objeto: String(o.objeto_del_contrato || o.descripcion_del_proceso || '').replace(/\s+/g, ' ').trim(),
      tipo: String(o.tipo_de_contrato || '').trim(),
      supervisor: definido(o.nombre_supervisor),
      url: /^https:\/\//i.test(String(url || '')) ? String(url) : '',
    };
  }

  const hoyIso = (hoy) => {
    if (typeof hoy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(hoy)) return hoy;
    const d = hoy instanceof Date ? hoy : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  /**
   * Separa los contratos: { vigentes, otros }. Se descartan los estados de config().estadosExcluidos;
   * vigente = sin fecha de fin o con fecha de fin desde hoy. Ambas listas van de la firma más reciente a la
   * más antigua, sin referencias repetidas.
   */
  function clasificar(contratos, hoy) {
    const excluidos = new Set(config().estadosExcluidos.map(plegar));
    const h = hoyIso(hoy);
    const vistos = new Set();
    const utiles = [];
    for (const c of contratos || []) {
      if (!c || !c.referencia || vistos.has(c.referencia) || excluidos.has(plegar(c.estado))) continue;
      vistos.add(c.referencia);
      utiles.push(c);
    }
    utiles.sort((a, b) => (b.fechaFirma || '').localeCompare(a.fechaFirma || '') || b.referencia.localeCompare(a.referencia));
    const vigentes = utiles.filter((c) => !c.fechaFin || c.fechaFin >= h);
    const otros = utiles.filter((c) => !vigentes.includes(c));
    return { vigentes, otros };
  }

  /**
   * Busca los contratos del documento con la entidad. opts: { fetch, hoy, senal }.
   * Devuelve { vigentes, otros, total }. Errores con .codigo: DOCUMENTO_INVALIDO, SIN_CONEXION, TIEMPO, HTTP_nnn, RESPUESTA.
   */
  async function buscar(documento, opts) {
    const o = opts || {};
    const f = o.fetch || root.fetch;
    if (typeof f !== 'function') throw error('SIN_CONEXION', 'Este navegador no puede consultar SECOP.');
    const cuerpo = JSON.stringify({ query: consulta(documento) });
    const cfg = config();
    const control = typeof AbortController === 'function' ? new AbortController() : null;
    const reloj = control ? setTimeout(() => control.abort(), cfg.tiempoMaximoMs) : null;
    let respuesta;
    try {
      respuesta = await f(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: cuerpo,
        signal: control ? control.signal : undefined,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (e) {
      throw error(e && e.name === 'AbortError' ? 'TIEMPO' : 'SIN_CONEXION', 'No pudimos conectarnos con SECOP II.');
    } finally {
      if (reloj) clearTimeout(reloj);
    }
    if (!respuesta || !respuesta.ok) throw error('HTTP_' + (respuesta ? respuesta.status : 0), 'SECOP II no respondió como esperábamos.');
    let datos;
    try { datos = await respuesta.json(); } catch (e) { throw error('RESPUESTA', 'La respuesta de SECOP II no se pudo leer.'); }
    if (!Array.isArray(datos)) throw error('RESPUESTA', 'La respuesta de SECOP II no se pudo leer.');
    const r = clasificar(datos.map(normalizar), o.hoy);
    return { ...r, total: datos.length };
  }

  /** Área funcional de la SED nombrada en el objeto del contrato (la más larga; solo si es única). */
  function areaDesdeObjeto(objeto) {
    const areas = (root.CATALOGOS && root.CATALOGOS.areas) || [];
    const texto = ' ' + plegar(objeto).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    let mejor = null;
    let empate = false;
    for (const a of areas) {
      const nombre = plegar(a.nombre).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (nombre.length < 12 || !texto.includes(' ' + nombre + ' ')) continue;
      if (!mejor || nombre.length > mejor.largo) { mejor = { nombre: a.nombre, largo: nombre.length }; empate = false; } else if (nombre.length === mejor.largo) empate = true;
    }
    return mejor && !empate ? mejor.nombre : '';
  }

  /**
   * Contrato normalizado → { campos: {idCampo: valor}, notas: {idCampo: texto} } para el paso Contrato.
   * El valor mensual se calcula con la duración (el Excel calcula la duración al revés: total × 30 / mensual).
   */
  function aCampos(c) {
    const campos = {};
    const notas = {};
    if (!c) return { campos, notas };
    if (/^\d{4}/.test(c.fechaFirma)) campos.anioContrato = c.fechaFirma.slice(0, 4);
    if (c.valor > 0) campos.valorTotal = String(c.valor);
    if (c.fechaInicio) campos.fechaInicio = c.fechaInicio;
    if (c.fechaFin) campos.fechaTerminacion = c.fechaFin;
    campos.cesion = plegar(c.estado) === 'cedido' ? 'SI' : 'NO';
    if (c.valor > 0 && c.duracionDias > 0) {
      campos.valorMensual = String(Math.round((c.valor * 30) / c.duracionDias));
      notas.valorMensual = 'Lo calculamos con la duración registrada en SECOP II (' + textoDuracion(c.duracion) +
        '). Verifícalo con el valor mensual de tu contrato.';
    }
    if (c.supervisor) campos.interventorNombre = c.supervisor.toLocaleUpperCase('es-CO');
    const area = areaDesdeObjeto(c.objeto);
    if (area) {
      campos.areaFuncional = area;
      notas.areaFuncional = 'La tomamos del objeto de tu contrato en SECOP II. Verifícala.';
    }
    if (c.referencia) notas.numeroContrato = 'En SECOP II tu contrato aparece como ' + c.referencia + '. Aquí va el número de contrato de la SED.';
    return { campos, notas };
  }

  const Secop = { buscar, clasificar, normalizar, aCampos, areaDesdeObjeto, duracionEnDias, consulta, config };
  root.Secop = Secop;
  if (typeof module !== 'undefined' && module.exports) module.exports = Secop;
})(typeof window !== 'undefined' ? window : globalThis);
