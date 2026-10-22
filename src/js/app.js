/*
 * Interfaz del formulario 13-IF-016 (SED Bogotá).
 *
 * Asistente por pasos generado a partir de SCHEMA. Lee el RUT y el RIT en PDF
 * (PdfText + RutParser/RitParser), calcula y valida con Calc y descarga con
 * Imprimir (PDF) y ExportExcel (xlsx). Cada módulo externo se usa con guardas:
 * si falta, la interfaz sigue funcionando y muestra un mensaje amable.
 *
 * Estado: `estado.s` = { idCampo: string } (convenciones en schema.js),
 * `estado.meta` = { paso, fuentes, visitados, plegables, docs } y
 * `estado.soportes` = { banco|dependientes|hipotecario|saludNoPos: [archivo] } (soportes.js); todo se autoguarda.
 */
(function () {
  'use strict';

  const VERSION = '1.2.0';
  const MAX_OPCIONES_COMBO = 50;

  const SCHEMA = window.SCHEMA;
  const CAT = window.CATALOGOS || {};
  const CFG = window.CONFIG || {};

  // ─────────────────────────── Utilidades ───────────────────────────

  const ICONOS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    flechaDer: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    flechaIzq: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    subir: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    archivoOk: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
    alerta: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    candado: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    girando: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
    firma: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    tabla: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/>',
    guardar: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    abrir: '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
    mas: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    cerrar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    chispa: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
    deshacer: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  };

  function svgIcono(nombre, clase) {
    return '<svg class="' + (clase || 'icono') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONOS[nombre] || '') + '</svg>';
  }

  function icono(nombre, clase) {
    const t = document.createElement('template');
    t.innerHTML = svgIcono(nombre, clase);
    return t.content.firstChild;
  }

  const PROPIEDADES = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate']);

  /** Crea un elemento. Los hijos de texto se insertan como texto (nunca HTML). */
  function h(etiqueta, atributos, ...hijos) {
    const el = document.createElement(etiqueta);
    if (atributos) {
      for (const [k, v] of Object.entries(atributos)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v; // solo para iconos estáticos
        else if (PROPIEDADES.has(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    agregarHijos(el, hijos);
    return el;
  }

  function agregarHijos(el, hijos) {
    for (const hijo of hijos) {
      if (hijo == null || hijo === false) continue;
      if (Array.isArray(hijo)) agregarHijos(el, hijo);
      else el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
    }
  }

  const norm = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const soloDigitos = (t) => String(t == null ? '' : t).replace(/\D/g, '');
  const miles = (digitos) => String(digitos).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  const movimientoReducido = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fmtPesos(n) {
    if (n === '' || n == null) return '';
    const num = Number(n);
    if (!isFinite(num)) return '';
    try {
      if (window.Calc && typeof window.Calc.formatoPesos === 'function') {
        const r = window.Calc.formatoPesos(num);
        if (r) return String(r).replace(/\$\s+/, '$ ');
      }
    } catch (e) { /* formato local */ }
    return '$ ' + (num < 0 ? '-' : '') + miles(Math.round(Math.abs(num)));
  }

  function hoyLocal() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fmtFecha(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '');
  }

  function fmtDecimal(n) {
    const num = Number(n);
    if (n === '' || n == null || !isFinite(num)) return '';
    return num.toLocaleString('es-CO', { maximumFractionDigits: 3 });
  }

  const avisados = new Set();
  function avisarUnaVez(clave, error) {
    if (avisados.has(clave)) return;
    avisados.add(clave);
    console.warn('[13-IF-016] ' + clave + ':', error);
  }

  function modulo(nombre, metodo) {
    const m = window[nombre];
    return m && typeof m[metodo] === 'function' ? m : null;
  }

  // ─────────────────────────── Esquema ───────────────────────────

  if (!SCHEMA || !Array.isArray(SCHEMA.steps) || !SCHEMA.fields) {
    const destino = document.getElementById('paso');
    if (destino) {
      destino.append(h('p', { class: 'aviso-noscript' },
        'No pudimos cargar el formulario. Recarga la página; si el problema continúa, solicita una nueva copia del archivo.'));
    }
    return;
  }

  const PASOS = SCHEMA.steps;
  const CAMPOS = SCHEMA.fields;
  const IDS = Object.keys(CAMPOS);
  const ORDEN = Object.fromEntries(IDS.map((id, i) => [id, i]));
  const PREGUNTAS = (() => { try { return SCHEMA.preguntas(CFG) || {}; } catch (e) { return {}; } })();

  // Preguntas C1–C4 en pocas palabras (listas de revisión y resumen).
  const PREGUNTAS_CORTAS = {
    c1: '¿Ingresos de ' + (CFG.anioGravable || '') + ' superiores a ' + ((CFG.ingresosC1Uvt || 1400).toLocaleString('es-CO')) + ' UVT?',
    c2: '¿Debes declarar renta por ' + (CFG.anioGravable || '') + '?',
    c3: '¿Perteneces al Régimen Simple?',
    c4: '¿Vas a restar costos y gastos?',
  };

  const AYUDA_PREGUNTAS = {
    c1: 'Suma tus ingresos brutos de ' + (CFG.anioGravable || '') + ': honorarios, salarios, arriendos y otros.',
    c2: 'En general, debes declarar renta por ' + (CFG.anioGravable || '') + ' si tu patrimonio bruto superó 4.500 UVT; si tus ingresos brutos, ' +
      'consumos con tarjeta de crédito, compras o consignaciones superaron 1.400 UVT, o si eres responsable de IVA (arts. 592 y 594-3 del ET).',
    c3: 'En tu RUT, la responsabilidad 47 corresponde al Régimen Simple de Tributación. Si no la tienes, responde No.',
    c4: 'En el formato que firmas dice: «El trabajador empleará costos y gastos de acuerdo al Decreto 2231 de 2023». ' +
      'Responde Sí solo si vas a restar costos y gastos de tu actividad, con sus soportes. Si tienes dudas, consulta con un contador.',
  };

  const DESCRIPCION_CHECKS = {
    dedDependientes: 'Hijos, cónyuge, padres o hermanos que dependen económicamente de ti.',
    dedHipotecario: 'Intereses pagados por crédito de vivienda o leasing habitacional.',
    dedSaludNoPos: 'Medicina prepagada, plan complementario o seguro de salud.',
  };

  // Motivos de la deducción por dependientes: opción corta; el texto legal completo se muestra al elegirla.
  const MOTIVOS_CORTOS = {
    1: 'Hijo(a) menor de 18 años',
    2: 'Hijo(a) de 18 a 23 años que estudia',
    3: 'Hijo(a) mayor de 23 años con dependencia certificada',
    4: 'Cónyuge o compañero(a) permanente dependiente',
    5: 'Padre, madre o hermano(a) dependiente',
  };
  const ESTILO_SELECT = { depMotivo: 'filas' };

  const TEXTO_PLEGABLE = { crpAdicional: 'Agregar otro CRP' };

  // Una línea bajo el título de algunos grupos: de dónde salen esos datos.
  const INTRO_GRUPOS = { 'Supervisión y seguimiento': 'Pídele estos datos a tu supervisor.' };

  const AYUDAS = {
    documentos: [
      'RUT: entra con tu usuario a los servicios en línea de la DIAN (portal MUISCA) y descarga la «Copia del RUT» en PDF.',
      'RIT: en la Oficina Virtual de la Secretaría Distrital de Hacienda, entra a Mi RIT → Certificado RIT. Si no lo tienes a mano, puedes continuar sin él.',
      'Usa el PDF original que descargaste, no una foto ni un escaneo: así podemos leer su texto.',
      'Lo que leemos de tus documentos queda en el formulario: revísalo y corrígelo en cada paso si algo no está bien.',
      '¿Cuándo actualizar este formato? Al iniciar cada contrato, cuando cambie tu información tributaria o bancaria y cuando la SED lo solicite.',
    ],
    personales: [
      'NIT: el número de identificación tributaria según tu RUT, sin el dígito de verificación.',
      'DV: el dígito de verificación que aparece en tu RUT.',
      'El tipo de contribuyente es «Persona natural» y se llena solo.',
      'Número de identificación: sin puntos ni espacios y sin dígito de verificación.',
      'El nombre completo se arma automáticamente con tus apellidos y nombres.',
      'Responde si eres pensionado una vez la supervisión del contrato lo haya validado.',
    ],
    contacto: [
      'Escribe la dirección tal como aparece en tu RUT.',
      'Departamento y municipio solo aplican si el país es Colombia.',
      'Teléfono 1 es obligatorio: si no tienes teléfono fijo, escribe 0.',
      'Teléfono 2 es tu número de celular.',
    ],
    pagos: [
      'Elige el banco en la lista de entidades autorizadas por la Superintendencia Financiera.',
      'Sucursal: la oficina donde abriste la cuenta.',
      'Tipo de cuenta: ahorros, corriente o Daviplata.',
      'Escribe el número de cuenta sin guiones ni caracteres especiales; debe coincidir con tu certificación bancaria.',
      'La identificación del titular se calcula con tu NIT y tu DV.',
      'Verifica que la cuenta esté activa y sin restricciones para recibir pagos electrónicos.',
      'Adjunta tu certificación bancaria al final de esta sección: queda guardada en este archivo.',
    ],
    tributario: [
      'La información debe coincidir con tu RUT y tu RIT vigentes.',
      'Actividad económica RUT: tu actividad principal (código CIIU de 4 dígitos).',
      'Actividad económica RIT: la actividad principal registrada en Bogotá; debe corresponder a la que realizas en el contrato (art. 11 del Acuerdo 065 de 2002).',
      'Régimen de IVA: según las responsabilidades de tu RUT (48 responsable, 49 no responsable).',
      'Si cargaste tu RUT y tu RIT, las listas de actividades muestran solo las registradas en cada documento.',
      'La tarifa por mil se calcula automáticamente.',
    ],
    contrato: [
      'Número y año del contrato: según SECOP (año de suscripción).',
      'Fechas del acta de inicio y de terminación: según SECOP.',
      'Valor del pago mensual: el estipulado en el contrato; valídalo con los estudios previos.',
      'CRP (Certificado de Registro Presupuestal): su número y su fecha te los da tu supervisor o tu operativo. Si tienes más de uno, agrégalos.',
      'Código de actividad ARL: el que aparece en tu certificado de afiliación a la ARL.',
      'Supervisión: el nombre y el cargo de tu supervisor. El operativo es la persona que tramita tus cuentas de cobro.',
      'La duración, el valor sin IVA y el IVA se calculan automáticamente.',
    ],
    retencion: [
      'Responde Sí o No a las cuatro preguntas.',
      'Dependientes, crédito hipotecario y salud no POS: marca solo lo que aplique y llena sus datos tal como aparecen en los certificados.',
      'Los certificados deben tener corte al 31 de diciembre del año indicado. Adjúntalos legibles, del mismo año fiscal, debajo de cada deducción (PDF o foto).',
      'Salud no POS: certificado de la entidad de medicina prepagada o del plan complementario con lo que pagaste. Crédito hipotecario o leasing habitacional: certificado de la entidad financiera con los intereses pagados.',
      'Cuentas AFC y pensiones voluntarias: si respondes Sí, registra la entidad, su NIT y el valor mensual.',
      'Al firmar declaras que la información es cierta y respondes por ella.',
    ],
  };

  // Valores calculados que se muestran (solo lectura) debajo de un campo.
  const CALCULADOS = {
    otrosNombres: [
      { etiqueta: 'Nombre completo', valor: (d) => String(d.nombreCompleto || '').replace(/\s+/g, ' ').trim() },
      { etiqueta: 'Tipo de contribuyente', valor: () => 'Persona natural' },
    ],
    numeroCuenta: [
      { etiqueta: 'Identificación del titular', valor: (d, s) => (s.nit ? String(d.identificacionTitular || '') : '') },
    ],
    actividadRit: [
      { etiqueta: 'Tarifa de ICA (Industria y Comercio)', valor: (d, s) => (s.actividadRit && d.tarifaRit !== '' && d.tarifaRit != null && isFinite(Number(d.tarifaRit)) ? fmtDecimal(d.tarifaRit) + ' por mil' : '') },
    ],
    // Debajo de las fechas: todo lo del contrato ya está escrito cuando se lee el cálculo.
    fechaTerminacion: [
      { etiqueta: 'Duración', valor: (d, s) => (Number(s.valorTotal) > 0 && Number(s.valorMensual) > 0 ? textoDias(d, s) : '') },
      { etiqueta: 'Valor sin IVA', valor: (d, s) => (s.valorTotal ? fmtPesos(d.valorSinIva) : '') },
      { etiqueta: 'IVA', valor: (d, s) => (s.valorTotal ? fmtPesos(d.valorIva) : '') },
    ],
    depMotivo: [
      { etiqueta: 'Valor mensual a deducir', valor: (d, s) => (s.valorMensual ? fmtPesos(d.depValorMensual) : '') },
      { etiqueta: 'Soportes', valor: (d) => limpiarAnexos(d.depAnexos) },
    ],
    saludValorTotal: [
      { etiqueta: 'Valor mensual a deducir', valor: (d, s) => (s.saludValorTotal ? fmtPesos(d.saludValorMensual) : '') },
    ],
    hipTitulares: [
      { etiqueta: 'Valor mensual a deducir', valor: (d, s) => (s.hipValorIntereses ? fmtPesos(d.hipValorMensual) : '') },
    ],
  };

  function textoDias(d, s) {
    // Con valores incoherentes (mensual mayor que el total…) el cálculo del Excel da un número engañoso.
    // Y bajo unas fechas con error, un número de días parecería confirmarlas.
    const errores = (sesion.validacion && sesion.validacion.errores) || {};
    if (errores.valorTotal || errores.valorMensual || errores.fechaInicio || errores.fechaTerminacion) return '—';
    let dias = d.duracionDiasRedondeada != null && d.duracionDiasRedondeada !== '' ? d.duracionDiasRedondeada : d.duracionDias;
    if (dias === '' || dias == null || !isFinite(Number(dias))) {
      dias = (Number(s.valorTotal) * 30) / Number(s.valorMensual);
    }
    return plural(Math.round(Number(dias)), 'día', 'días');
  }

  function limpiarAnexos(t) {
    if (!t) return '';
    return String(t).split(/\n+/).map((l) => l.replace(/^\s*\*\s*\.?\s*-\s*/, '').trim()).filter(Boolean).join(' · ');
  }

  // ─────────────────────────── Estado ───────────────────────────

  const estado = {
    s: {},
    meta: metaInicial(),
    soportes: {},
  };

  const sesion = {
    controles: {},          // id -> { cont, set, enfocar }
    tocados: new Set(),     // campos que el usuario ya dejó (para mostrar errores de formato)
    vistos: new Set(),      // campos visibles cuando la persona salió de su paso (para mostrar "Falta este dato")
    resultados: { RUT: null, RIT: null }, // lo leído en esta sesión: { res, doc, archivo } (para cruzar RUT ↔ RIT)
    zonas: { RUT: { estado: 'idle' }, RIT: { estado: 'idle' } },
    secop: { estado: 'idle', mensaje: '' },
    bloqueo: '',            // paso que se intentó dejar con obligatorios pendientes
    validacion: null,
    derivados: {},
  };

  function estadoInicial() {
    const s = {};
    for (const id of IDS) s[id] = CAMPOS[id].porDefecto != null ? String(CAMPOS[id].porDefecto) : '';
    return s;
  }

  /**
   * fuentes: de dónde vino cada valor (RUT, RIT, SECOP, Sugerido); lo escrito a mano no tiene fuente.
   * conflictos: valores de un documento o de SECOP que NO reemplazaron lo que la persona ya había escrito
   * (se ofrecen debajo del campo: "Tu RUT dice: X · Usar este").
   * docs: resumen de cada documento leído; secop: contratos encontrados y el elegido.
   */
  function metaInicial() {
    return { paso: 0, fuentes: {}, visitados: {}, plegables: {}, docs: {}, conflictos: {}, secop: null };
  }

  const visibleEn = (id, s) => {
    const f = CAMPOS[id];
    try { return typeof f.visible === 'function' ? !!f.visible(s) : true; } catch (e) { return true; }
  };
  const requeridoEn = (id, s) => {
    const f = CAMPOS[id];
    try { return typeof f.required === 'function' ? !!f.required(s) : !!f.required; } catch (e) { return false; }
  };

  /** Copia del estado con los campos ocultos vacíos (para validar, calcular y exportar). */
  function estadoLimpio(s) {
    const base = s || estado.s;
    const r = {};
    for (const id of IDS) r[id] = visibleEn(id, base) ? (base[id] == null ? '' : String(base[id])) : '';
    return r;
  }

  function tieneDatos(s) {
    return IDS.some((id) => {
      const v = s[id] == null ? '' : String(s[id]);
      return v !== '' && v !== String(CAMPOS[id].porDefecto == null ? '' : CAMPOS[id].porDefecto);
    });
  }

  const haySoportes = () => !!(S && S.cantidad(estado.soportes));
  /** Algo que valga la pena guardar: datos o soportes adjuntos. */
  const hayAlgo = () => tieneDatos(estado.s) || haySoportes();

  // ─────────────────────────── Persistencia: dentro del propio archivo ───────────────────────────
  //
  // El formulario se guarda como un Excel: los datos van dentro del mismo archivo HTML (guardado.js).
  // La primera vez la persona elige dónde guardarlo; después se autoguarda en ese archivo. Lo que aún no
  // llega al archivo queda en la memoria del navegador solo como red de seguridad (se ofrece recuperarlo).

  const G = window.Guardado || null;
  const S = window.Soportes || null;
  const archivo = {
    id: null,           // identificador del formulario guardado (va dentro del archivo)
    manejador: null,    // archivo elegido en "Guardar como" (Chrome/Edge)
    nombre: '',
    estado: 'nuevo',    // 'nuevo' | 'leido' | 'guardando' | 'guardado' | 'pausado' | 'error'
    sucio: false,       // hay cambios que aún no están en el archivo
    preguntado: false,  // ya se abrió el "Guardar como" automático en esta sesión
    escribiendo: null,
    repetir: false,
    pidiendoPermiso: false,
  };
  let cambios = 0;
  let temporizadorRespaldo = null;
  let temporizadorArchivo = null;

  /** Llamado en cada cambio: respaldo inmediato en el navegador y escritura del archivo unos segundos después. */
  function guardarPronto() {
    cambios++;
    archivo.sucio = true;
    if (archivo.estado === 'leido') archivo.estado = 'nuevo';
    clearTimeout(temporizadorRespaldo);
    temporizadorRespaldo = setTimeout(guardarRespaldo, 350);
    if (archivo.manejador) {
      if (archivo.estado === 'pausado') reanudarConGesto();
      else { clearTimeout(temporizadorArchivo); temporizadorArchivo = setTimeout(escribirArchivo, 1200); }
    }
    pintarGuardado();
  }

  /** Respaldo en el navegador (al salir de la página o antes de una descarga). */
  function guardarAhora() {
    clearTimeout(temporizadorRespaldo);
    guardarRespaldo();
  }

  // Los soportes no caben en localStorage: su respaldo va en IndexedDB (soportes.js), con la misma clave, y se
  // escribe al adjuntar o quitar un archivo (respaldarSoportes), no en cada tecla.
  function guardarRespaldo() {
    if (!G || !archivo.sucio) return;
    if (hayAlgo()) {
      const datos = datosParaGuardar();
      delete datos.soportes;
      G.guardarPendiente(archivo.id, datos);
    } else borrarPendientes(archivo.id);
  }

  function respaldarSoportes() {
    return S ? S.guardarRespaldo(archivo.id, estado.soportes) : Promise.resolve(false);
  }

  /** Borra el respaldo del navegador (datos y soportes) de ese formulario: ya está en el archivo o se descartó. */
  function borrarPendientes(id) {
    if (G) G.borrarPendiente(id);
    return S ? S.borrarRespaldo(id) : Promise.resolve(false);
  }

  function nombrePersona(s) {
    const x = s || estado.s;
    return [x.primerApellido, x.segundoApellido, x.primerNombre, x.otrosNombres].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function datosParaGuardar() {
    return {
      formato: (CFG.formato && CFG.formato.codigo) || '13-IF-016',
      version: 2,
      id: archivo.id,
      guardado: new Date().toISOString(),
      nombre: nombrePersona(),
      s: estado.s,
      meta: estado.meta,
      soportes: estado.soportes,
    };
  }

  /** '13-IF-016_ABRIL_ALDANA_DANIEL_FELIPE.html' (o el nombre genérico si aún no hay nombre). */
  function nombreArchivoHtml() {
    const base = nombrePersona().normalize('NFC').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_');
    return (base ? '13-IF-016_' + base : 'formulario-13-IF-016') + '.html';
  }

  async function escribirArchivo() {
    clearTimeout(temporizadorArchivo);
    if (!G || !archivo.manejador) return;
    if (archivo.escribiendo) { archivo.repetir = true; return; }
    const version = cambios;
    archivo.escribiendo = (async () => {
      const p = await G.permiso(archivo.manejador, false);
      if (p !== 'granted') { archivo.estado = 'pausado'; return; }
      archivo.estado = 'guardando';
      pintarGuardado();
      try {
        await G.escribir(archivo.manejador, G.html(datosParaGuardar()));
        archivo.estado = 'guardado';
        if (version === cambios) {
          archivo.sucio = false;
          borrarPendientes(archivo.id);
        }
      } catch (e) {
        avisarUnaVez('Guardado.escribir', e);
        archivo.estado = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'pausado' : 'error';
      }
    })();
    try { await archivo.escribiendo; } finally { archivo.escribiendo = null; }
    pintarGuardado();
    if (archivo.repetir || (archivo.sucio && archivo.estado === 'guardado' && version !== cambios)) {
      archivo.repetir = false;
      escribirArchivo();
    }
  }

  const hayGesto = () => !(navigator.userActivation && navigator.userActivation.isActive === false);

  /**
   * "Guardar como" (o descargar una copia si el navegador no permite escribir archivos). Debe llamarse
   * directo desde un clic: el navegador solo abre el cuadro de guardar con un gesto de la persona.
   */
  function guardarComo() {
    if (!G) return;
    if (!G.soportaArchivos()) { descargarCopia(); return; }
    // Se propone el mismo archivo que está abierto (mismo nombre, misma carpeta): los datos quedan en él.
    const actual = G.archivoActual();
    let eleccion;
    try {
      eleccion = G.elegirArchivo(actual.nombre || nombreArchivoHtml(), actual.carpeta);
    } catch (e) {
      avisarUnaVez('Guardado.elegirArchivo', e);
      return;
    }
    archivo.preguntado = true;
    Promise.resolve(eleccion).then(async (manejador) => {
      const idPrevio = archivo.id;
      if (!archivo.id) archivo.id = G.nuevoId();
      archivo.manejador = manejador;
      archivo.nombre = (manejador && manejador.name) || '';
      await G.recordarArchivo(archivo.id, manejador);
      if (idPrevio !== archivo.id) {
        borrarPendientes(idPrevio);
        if (haySoportes()) await respaldarSoportes();
      }
      archivo.sucio = true;
      archivo.estado = 'nuevo';
      await escribirArchivo();
      if (archivo.estado === 'guardado') toast('Guardamos tu formulario en «' + archivo.nombre + '». Desde ahora se guarda solo en ese archivo.');
      else if (archivo.estado === 'error') toast('No pudimos escribir en ese archivo. Intenta guardarlo en otra carpeta.', { tono: 'error' });
    }).catch((e) => {
      if (e && e.name === 'AbortError') { pintarGuardado(); return; }
      avisarUnaVez('Guardado.elegirArchivo', e);
      toast('No pudimos guardar el formulario. Intenta de nuevo.', { tono: 'error' });
    });
  }

  /** Navegadores sin acceso a archivos: descarga una copia del formulario con los datos. */
  function descargarCopia() {
    if (!G) return;
    try {
      if (!archivo.id) archivo.id = G.nuevoId();
      G.descargar(G.html(datosParaGuardar()), nombreArchivoHtml());
      toast('Descargamos tu formulario con tus datos. Para continuar después, abre ese archivo.');
    } catch (e) {
      avisarUnaVez('Guardado.descargar', e);
      toast('No pudimos descargar el formulario. Intenta de nuevo.', { tono: 'error' });
    }
  }

  /**
   * Explica qué pulsar y luego abre el cuadro de guardar del navegador (desde el clic en "Guardar").
   * El navegador no deja que una página escriba sola en su archivo: hace falta elegirlo una vez.
   */
  async function guardarConExplicacion() {
    if (!G) return;
    if (!G.soportaArchivos()) { descargarCopia(); return; }
    archivo.preguntado = true;
    const actual = G.archivoActual();
    const enEste = actual.nombre
      ? 'En la ventana que se abre aparece este mismo archivo («' + actual.nombre + '»). Pulsa «Guardar» y luego «Sí» para reemplazarlo.'
      : 'En la ventana que se abre, elige dónde guardar tu formulario y pulsa «Guardar».';
    const r = await confirmar({
      titulo: 'Guarda tu formulario',
      mensaje: 'Así tus datos quedan dentro del archivo y no los pierdes si lo cierras. ' + enEste +
        ' Después se guardará solo.' + (actual.nombre && !actual.carpeta ? ' Si no ves el archivo, busca la carpeta donde lo tienes.' : ''),
      principal: 'Guardar', secundario: 'Ahora no', enfocar: 'principal',
      nativo: { pregunta: '¿Guardar ahora?', si: 'principal' },
    });
    if (r === 'principal') guardarComo();
  }

  /**
   * Botón «Guardar» de Revisión: escribe ya en el archivo y lo confirma. Sin archivo elegido, pide dónde guardarlo
   * (Chrome/Edge) o descarga una copia (Firefox/Safari). Debe llamarse desde el clic (permiso del navegador).
   */
  async function guardarDesdeBoton(boton) {
    guardarAhora();
    if (!G) return;
    if (!G.soportaArchivos()) { descargarCopia(); return; }
    if (!archivo.manejador) { guardarConExplicacion(); return; }
    if (archivo.estado === 'pausado' && (await G.permiso(archivo.manejador, true)) !== 'granted') {
      pintarGuardado();
      toast('Para guardar, el navegador necesita tu permiso. Pulsa de nuevo «Guardar» y elige «Permitir».', { tono: 'error' });
      return;
    }
    boton.disabled = true;
    archivo.sucio = true;
    archivo.estado = 'nuevo';
    await escribirArchivo();
    boton.disabled = false;
    if (archivo.estado !== 'guardado') {
      toast('No pudimos guardar el formulario. Intenta de nuevo o usa «Guardar como…».', { tono: 'error' });
      return;
    }
    toast('Listo, tu formulario quedó guardado' + (archivo.nombre ? ' en «' + archivo.nombre + '»' : '') + '.');
    if (!boton.isConnected) return;
    boton.textContent = '';
    boton.append(icono('check'), h('span', null, 'Guardado'));
    boton.classList.add('boton--hecho');
    setTimeout(() => {
      if (!boton.isConnected) return;
      boton.textContent = '';
      boton.append(icono('guardar'), h('span', null, 'Guardar'));
      boton.classList.remove('boton--hecho');
    }, 3000);
  }

  /** El primer guardado se pide solo, apenas la persona avanza con algún dato (una vez por sesión). */
  function pedirPrimerGuardado() {
    if (!G || archivo.manejador || archivo.preguntado || !hayAlgo() || !G.soportaArchivos() || !hayGesto()) return;
    guardarConExplicacion();
  }

  /** Al reabrir el archivo el navegador pide una vez permiso para seguir guardando en él. */
  function reanudar() {
    if (!archivo.manejador || archivo.pidiendoPermiso) return;
    archivo.pidiendoPermiso = true;
    G.permiso(archivo.manejador, true).then((p) => {
      archivo.pidiendoPermiso = false;
      if (p === 'granted') { archivo.estado = 'nuevo'; escribirArchivo(); } else pintarGuardado();
    });
  }

  function reanudarConGesto() {
    if (hayGesto()) reanudar();
  }

  let firmaGuardado = '';
  function pintarGuardado() {
    const el = document.getElementById('guardado');
    if (!el) return;
    const conDatos = hayAlgo();
    const soporta = !!(G && G.soportaArchivos());
    let est = archivo.estado;
    if (est === 'guardado' && archivo.sucio && !archivo.escribiendo) est = 'guardando';
    if (est === 'nuevo' && !conDatos) est = 'vacio';
    const firma = [est, archivo.nombre, soporta].join('|');
    if (firma === firmaGuardado) return;
    firmaGuardado = firma;
    el.textContent = '';
    el.dataset.estado = est;
    const boton = (texto, accion) => h('button', { type: 'button', class: 'enlace guardado-accion', onclick: accion }, texto);
    switch (est) {
      case 'vacio':
        el.hidden = true;
        return;
      case 'guardando':
        agregarHijos(el, [h('span', { class: 'guardado-icono', html: svgIcono('girando', 'icono girando') }), h('span', null, 'Guardando…')]);
        break;
      case 'guardado':
        agregarHijos(el, [icono('check'), h('span', { title: archivo.nombre }, 'Guardado',
          archivo.nombre ? h('span', { class: 'solo-amplio guardado-archivo' }, ' en ' + archivo.nombre) : null)]);
        break;
      case 'leido':
        agregarHijos(el, [icono('check'), h('span', null, 'Datos guardados en este archivo')]);
        break;
      case 'pausado':
        agregarHijos(el, [icono('info'), h('span', null, 'Autoguardado en pausa'), boton('Reanudar', reanudar)]);
        break;
      case 'error':
        agregarHijos(el, [icono('alerta'), h('span', null, 'No pudimos guardar'), boton('Guardar como…', guardarComo)]);
        break;
      default:
        agregarHijos(el, [h('span', { class: 'guardado-sin' }, 'Sin guardar'),
          soporta ? boton('Guardar', guardarConExplicacion) : boton('Descargar copia', descargarCopia)]);
    }
    el.hidden = false;
  }

  const FUENTES_VALIDAS = ['RUT', 'RIT', 'SECOP', 'Sugerido'];

  /** Valores utilizables del archivo o del respaldo, ya normalizados: { valores, usados }. */
  function valoresDe(datos) {
    const origen = datos && typeof datos === 'object' ? (datos.s || datos.datos || datos) : {};
    try {
      if (modulo('Calc', 'normalizarEstado')) return window.Calc.normalizarEstado(origen);
    } catch (e) { avisarUnaVez('Calc.normalizarEstado', e); }
    const valores = {};
    let usados = 0;
    for (const id of IDS) {
      const v = origen && origen[id];
      if (v == null || typeof v === 'object') continue;
      valores[id] = String(v).slice(0, 500);
      if (valores[id] !== '') usados++;
    }
    return { valores, usados };
  }

  const objeto = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  const texto500 = (v, max) => String(v == null ? '' : v).slice(0, max || 500);
  const fechaValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : '');

  function metaDocs(origen) {
    const docs = {};
    for (const [k, v] of Object.entries(objeto(origen))) {
      if ((k !== 'RUT' && k !== 'RIT') || !v || typeof v !== 'object') continue;
      docs[k] = {
        archivo: texto500(v.archivo, 200),
        aplicados: Number.isInteger(v.aplicados) && v.aplicados >= 0 ? v.aplicados : 0,
        fecha: fechaValida(v.fecha),
        avisos: (Array.isArray(v.avisos) ? v.avisos : []).slice(0, 8).map((a) => texto500(a)).filter(Boolean),
        documento: soloDigitos(v.documento).slice(0, 15),
        direccion: texto500(v.direccion, 200),
        sinFijo: v.sinFijo === true,
        actividades: (Array.isArray(v.actividades) ? v.actividades : []).slice(0, 20)
          .map(String).filter((c, i, l) => l.indexOf(c) === i && buscarOpcion(CAMPO_ACTIVIDAD[k], c)),
        alternativas: (Array.isArray(v.alternativas) ? v.alternativas : []).slice(0, 15)
          .filter((a) => a && typeof a === 'object' && buscarOpcion('actividadRit', String(a.valor)))
          .map((a) => ({ valor: String(a.valor), texto: texto500(a.texto, 300) })),
      };
    }
    return docs;
  }

  function metaSecop(v) {
    if (!v || typeof v !== 'object') return null;
    const contratos = (Array.isArray(v.contratos) ? v.contratos : []).slice(0, 20).filter((c) => c && typeof c === 'object' && c.referencia)
      .map((c) => ({
        referencia: texto500(c.referencia, 60), estado: texto500(c.estado, 60), fechaFirma: fechaValida(c.fechaFirma),
        fechaInicio: fechaValida(c.fechaInicio), fechaFin: fechaValida(c.fechaFin), valor: Math.max(0, Math.round(Number(c.valor) || 0)),
        duracion: texto500(c.duracion, 40), duracionDias: Math.max(0, Math.round(Number(c.duracionDias) || 0)),
        diasAdicionados: Math.max(0, Math.round(Number(c.diasAdicionados) || 0)), objeto: texto500(c.objeto, 400),
        tipo: texto500(c.tipo, 80), supervisor: texto500(c.supervisor, 120), url: /^https:\/\//i.test(String(c.url || '')) ? texto500(c.url, 400) : '',
      }));
    return {
      consulta: soloDigitos(v.consulta).slice(0, 15),
      fecha: texto500(v.fecha, 40),
      contratos,
      vigentes: v.vigentes !== false,
      elegido: contratos.some((c) => c.referencia === v.elegido) ? String(v.elegido) : '',
    };
  }

  /**
   * Carga datos del archivo o del respaldo sobre un estado limpio. Los valores se normalizan (SI/NO, texto
   * del catálogo, fechas ISO) y la meta se valida, para que la pantalla, la validación, el PDF y el Excel
   * vean siempre lo mismo. Devuelve cuántos campos quedaron con valor.
   */
  function cargarDatos(datos) {
    const s = estadoInicial();
    const { valores, usados } = valoresDe(datos);
    Object.assign(s, valores);
    const metaOrigen = objeto(datos && datos.meta);
    const meta = metaInicial();
    const fuentes = objeto(metaOrigen.fuentes || (datos && datos.fuentes));
    for (const [k, v] of Object.entries(fuentes)) if (CAMPOS[k] && FUENTES_VALIDAS.includes(v)) meta.fuentes[k] = v;
    for (const [k, v] of Object.entries(objeto(metaOrigen.visitados))) if (v === true && PASOS.some((p) => p.id === k)) meta.visitados[k] = true;
    for (const [k, v] of Object.entries(objeto(metaOrigen.plegables))) if (TEXTO_PLEGABLE[k] && Number.isInteger(v) && v >= 0 && v <= 10) meta.plegables[k] = v;
    meta.docs = metaDocs(metaOrigen.docs);
    for (const [k, v] of Object.entries(objeto(metaOrigen.conflictos))) {
      if (!CAMPOS[k] || !v || typeof v !== 'object' || !FUENTES_VALIDAS.includes(v.fuente) || v.valor == null || v.valor === '') continue;
      meta.conflictos[k] = { valor: texto500(v.valor), fuente: v.fuente, dudoso: v.dudoso === true };
    }
    meta.secop = metaSecop(metaOrigen.secop);
    const paso = Number(metaOrigen.paso);
    meta.paso = Number.isInteger(paso) && paso >= 0 && paso < PASOS.length ? paso : 0;
    estado.s = s;
    estado.meta = meta;
    estado.soportes = S ? S.normalizar(datos && datos.soportes) : {};
    marcarVistosDeVisitados();
    return usados;
  }

  /** Al recuperar un avance, los campos de los pasos ya recorridos cuentan como vistos. */
  function marcarVistosDeVisitados() {
    sesion.vistos.clear();
    for (const id of IDS) {
      if (estado.meta.visitados[CAMPOS[id].step] && visibleEn(id, estado.s) && plegableVisible(id)) sesion.vistos.add(id);
    }
  }

  /**
   * Usa valores de un documento o de SECOP. Lo que la persona escribió a mano no se reemplaza: queda como
   * conflicto ("Tu RUT dice: X · Usar este"). Lo que vino de otro documento, de SECOP o de una sugerencia
   * sí se reemplaza. dudosos: valores de confianza baja, que solo se ofrecen. Devuelve cuántos se usaron.
   */
  function aplicarValores(valores, fuente, dudosos) {
    let n = 0;
    const ids = Object.keys(valores || {}).filter((id) => CAMPOS[id]).sort((a, b) => ORDEN[a] - ORDEN[b]);
    for (const id of ids) {
      const v = valores[id] == null ? '' : String(valores[id]);
      if (!v) continue;
      const actual = estado.s[id] == null ? '' : String(estado.s[id]);
      const porDefecto = String(CAMPOS[id].porDefecto == null ? '' : CAMPOS[id].porDefecto);
      const escritoAMano = actual !== '' && actual !== v && actual !== porDefecto && !estado.meta.fuentes[id];
      if (escritoAMano) {
        estado.meta.conflictos[id] = { valor: v, fuente, dudoso: false };
        continue;
      }
      // El departamento va antes que el municipio (ORDEN), así la lista dependiente queda válida.
      cambiar(id, v, fuente);
      delete estado.meta.conflictos[id];
      n++;
    }
    if (valores && valores.municipio && estado.s.municipio !== valores.municipio && estado.meta.fuentes.departamento === fuente &&
        !estado.meta.conflictos.municipio) {
      estado.s.municipio = String(valores.municipio);
      estado.meta.fuentes.municipio = fuente;
    }
    for (const [id, v] of Object.entries(dudosos || {})) {
      if (CAMPOS[id] && v && String(v) !== String(estado.s[id] || '')) estado.meta.conflictos[id] = { valor: String(v), fuente, dudoso: true };
    }
    sincronizarTodo();
    programarActualizacion();
    guardarPronto();
    return n;
  }

  function usarConflicto(id) {
    const c = estado.meta.conflictos[id];
    if (!c) return;
    delete estado.meta.conflictos[id];
    cambiar(id, c.valor, c.fuente);
    sincronizar(id);
    tocar(id);
  }

  function ignorarConflicto(id) {
    delete estado.meta.conflictos[id];
    programarActualizacion();
    guardarPronto();
  }

  // ─────────────────────────── Opciones de catálogos ───────────────────────────

  const cacheOpciones = {};

  function opcion(valor, texto, codigo, extra) {
    const o = { valor: String(valor), texto: String(texto == null ? '' : texto).trim(), codigo: codigo == null ? '' : String(codigo) };
    o.busqueda = norm((o.codigo ? o.codigo + ' ' : '') + o.texto);
    return extra ? Object.assign(o, extra) : o;
  }

  const ETIQUETAS_REGIMEN = { 'RESPONSABLE IVA': 'Responsable de IVA', 'NO RESPONSABLE IVA': 'No responsable de IVA' };

  function capitalizar(t) {
    const s = String(t).toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function opcionesDe(id) {
    const clave = CAMPOS[id] && CAMPOS[id].opciones;
    if (!clave) return [];
    if (clave === 'municipiosDelDepartamento') {
      const depto = (CAT.departamentos || []).find((d) => d.nombre === estado.s.departamento);
      if (!depto) return [];
      const k = 'mun:' + depto.codigo;
      if (!cacheOpciones[k]) {
        cacheOpciones[k] = (CAT.municipios || []).filter((m) => m.codDepto === depto.codigo).map((m) => opcion(m.nombre, m.nombre));
      }
      return cacheOpciones[k];
    }
    if (cacheOpciones[clave]) return cacheOpciones[clave];
    const lista = CAT[clave] || [];
    let ops;
    switch (clave) {
      case 'ciiu': ops = lista.map((o) => opcion(o.codigo, o.descripcion, o.codigo)); break;
      case 'rit': ops = lista.map((o) => opcion(String(o.codigo), o.descripcion, String(o.codigo), { tarifa: o.tarifa })); break;
      case 'arl': ops = lista.map((o) => opcion(o.codigo, o.descripcion, o.codigo)); break;
      // Diferencia deliberada con el Excel (A31 ofrece 76): se ocultan 4 entradas internas o de prueba
      // ('BANCO GENERAL TRANSITORIAS TRM', 'DUMY1', 'BANCO DUMMY MULTAS SED', 'DUMMY SSF'); ver README.
      case 'bancos': ops = lista.filter((b) => !b.interno).map((b) => opcion(b.nombre, b.nombre)); break;
      case 'tiposDocumento': ops = lista.map((o) => opcion(o.nombre, o.nombre)); break;
      case 'regimenIva': ops = lista.map((o) => opcion(o.nombre, ETIQUETAS_REGIMEN[o.nombre] || o.nombre)); break;
      case 'parentescos':
        ops = Array.from(new Set(lista.map(String))).map((p) => opcion(p, p === 'CONYUGUE' ? 'Cónyuge' : capitalizar(p)));
        break;
      case 'motivosDependientes':
        ops = lista.map((o) => {
          const completo = String(o.texto).replace(/^\s*\d+\.\s*/, '').trim();
          return opcion(o.texto, MOTIVOS_CORTOS[o.numero] || completo, '', { detalle: completo });
        });
        break;
      default: ops = lista.map((o) => (typeof o === 'object' ? opcion(o.nombre, o.nombre) : opcion(o, o)));
    }
    cacheOpciones[clave] = ops;
    return ops;
  }

  const textoOpcion = (o) => (o.codigo ? o.codigo + ' — ' + o.texto : o.texto);

  // Actividad económica: si se leyó el RUT (o el RIT), solo se puede elegir entre las actividades registradas
  // en ese documento. Sin documento (o si no trae ninguna del catálogo) se busca en el catálogo completo.
  const CAMPO_ACTIVIDAD = { RUT: 'actividadRut', RIT: 'actividadRit' };
  const DOC_DE_ACTIVIDAD = { actividadRut: 'RUT', actividadRit: 'RIT' };

  /** Códigos de actividad registrados en el documento que alimenta ese campo, o [] si no hay. */
  function actividadesDelDocumento(id) {
    const doc = DOC_DE_ACTIVIDAD[id] && estado.meta.docs[DOC_DE_ACTIVIDAD[id]];
    return doc && Array.isArray(doc.actividades) ? doc.actividades : [];
  }

  /** Opciones que la persona puede elegir en la lista (buscarOpcion sigue usando el catálogo completo). */
  function opcionesElegibles(id) {
    const codigos = actividadesDelDocumento(id);
    if (!codigos.length) return opcionesDe(id);
    return opcionesDe(id).filter((o) => codigos.includes(o.valor));
  }

  function buscarOpcion(id, valor) {
    if (valor === '' || valor == null) return null;
    return opcionesDe(id).find((o) => o.valor === String(valor)) || null;
  }

  function estiloSelect(id) {
    if (ESTILO_SELECT[id]) return ESTILO_SELECT[id];
    const ops = opcionesDe(id);
    if (ops.length && ops.length <= 3 && ops.every((o) => o.texto.length <= 24)) return 'pastillas';
    if (ops.length && ops.length <= 6 && ops.some((o) => o.texto.length > 60)) return 'filas';
    return 'lista';
  }

  /** Texto legible de un valor del estado (para revisiones y resúmenes). */
  function mostrarValor(id, valor) {
    if (valor === '' || valor == null) return '';
    const f = CAMPOS[id];
    if (!f) return String(valor);
    switch (f.type) {
      case 'money': return fmtPesos(valor);
      case 'date': return fmtFecha(valor);
      case 'yesno': return valor === 'SI' ? 'Sí' : valor === 'NO' ? 'No' : String(valor);
      case 'check': return valor === 'SI' ? 'Sí' : 'No';
      case 'select':
      case 'combo': {
        const o = buscarOpcion(id, valor);
        return o ? textoOpcion(o) : String(valor).trim();
      }
      default: return String(valor);
    }
  }

  function etiquetaCorta(id) {
    const f = CAMPOS[id];
    if (!f) return id;
    if (f.pregunta) return PREGUNTAS_CORTAS[f.pregunta] || f.label;
    return f.label;
  }

  // ─────────────────────────── Cálculo y validación ───────────────────────────

  function dvCalculado(nit) {
    const d = soloDigitos(nit);
    if (!d) return '';
    try {
      if (modulo('Calc', 'dvNit')) return String(window.Calc.dvNit(d));
    } catch (e) { avisarUnaVez('Calc.dvNit', e); }
    const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    let suma = 0;
    for (let i = 0; i < d.length && i < pesos.length; i++) suma += Number(d[d.length - 1 - i]) * pesos[i];
    const r = suma % 11;
    return String(r > 1 ? 11 - r : r);
  }

  function anioCertificadosLocal() {
    const hoy = new Date();
    const corte = String(CFG.mesDiaCorteCertificados || '04-01').split('-').map(Number);
    const antesDeCorte = hoy.getMonth() + 1 < corte[0] || (hoy.getMonth() + 1 === corte[0] && hoy.getDate() < corte[1]);
    return hoy.getFullYear() - (antesDeCorte ? 2 : 1);
  }

  function derivadosBasicos(s) {
    const tit = s.nit ? s.nit + '-' + s.dv : '';
    const rit = buscarOpcion('actividadRit', s.actividadRit);
    const anio = anioCertificadosLocal();
    return {
      nombreCompleto: [s.primerApellido, s.segundoApellido, s.primerNombre, s.otrosNombres].join(' ').toUpperCase(),
      identificacionTitular: tit,
      tarifaRit: rit ? rit.tarifa : '',
      anioCertificados: anio,
      anioVigenciaCertificados: anio + 2,
    };
  }

  function derivar() {
    const limpio = estadoLimpio();
    try {
      if (modulo('Calc', 'derivados')) return window.Calc.derivados(limpio) || {};
    } catch (e) { avisarUnaVez('Calc.derivados', e); }
    return derivadosBasicos(limpio);
  }

  function validacionBasica(s) {
    const faltantes = [];
    const errores = {};
    for (const id of IDS) {
      const f = CAMPOS[id];
      if (!visibleEn(id, s)) continue;
      const v = s[id] || '';
      if (!v) {
        if (requeridoEn(id, s)) faltantes.push({ campo: id, step: f.step, mensaje: 'Falta: ' + etiquetaCorta(id) });
        continue;
      }
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) errores[id] = 'Revisa el formato del correo.';
      if (f.type === 'tel' && v.length !== 10 && !(id === 'telefono1' && v === '0')) errores[id] = 'Debe tener 10 dígitos.';
    }
    if (s.nit && s.dv && dvCalculado(s.nit) !== s.dv) errores.dv = 'El DV no corresponde al NIT.';
    return { completo: !faltantes.length && !Object.keys(errores).length, faltantes, errores, advertencias: [] };
  }

  /** Validación de los campos más los soportes obligatorios que falten (cuentan como un dato pendiente más). */
  function validar() {
    const v = validarCampos();
    const soportes = faltantesSoportes();
    const actividades = erroresActividades();
    if (!soportes.length && !Object.keys(actividades).length) return v;
    return Object.assign({}, v, {
      completo: false,
      faltantes: v.faltantes.concat(soportes),
      errores: Object.assign({}, v.errores, actividades),
    });
  }

  /** Actividad elegida que no está registrada en el documento leído (p. ej. escrita antes de cargarlo). */
  function erroresActividades() {
    const errores = {};
    for (const [id, doc] of Object.entries(DOC_DE_ACTIVIDAD)) {
      const v = estado.s[id];
      const codigos = actividadesDelDocumento(id);
      if (v && codigos.length && !codigos.includes(String(v))) {
        errores[id] = 'Esta actividad no está registrada en tu ' + doc + '. Elige una de las de la lista.';
      }
    }
    return errores;
  }

  function validarCampos() {
    const limpio = estadoLimpio();
    try {
      if (modulo('Calc', 'validar')) {
        const r = window.Calc.validar(limpio);
        if (r) {
          return {
            completo: !!r.completo,
            faltantes: Array.isArray(r.faltantes) ? r.faltantes : [],
            errores: r.errores && typeof r.errores === 'object' ? r.errores : {},
            advertencias: Array.isArray(r.advertencias) ? r.advertencias : [],
          };
        }
      }
    } catch (e) { avisarUnaVez('Calc.validar', e); }
    return validacionBasica(limpio);
  }

  const pasoDeCampo = (id) => (CAMPOS[id] ? CAMPOS[id].step : '');

  /** Pendientes (faltantes + errores) con su paso, en el orden del formulario. */
  function listaPendientes(v) {
    const lista = [];
    for (const f of v.faltantes) {
      lista.push({ campo: f.campo, step: f.step || pasoDeCampo(f.campo), mensaje: f.mensaje || ('Falta: ' + etiquetaCorta(f.campo)), tipo: 'falta' });
    }
    for (const [campo, mensaje] of Object.entries(v.errores)) {
      if (!mensaje) continue;
      lista.push({ campo, step: pasoDeCampo(campo), mensaje: (CAMPOS[campo] ? etiquetaCorta(campo) + ': ' : '') + mensaje, tipo: 'error' });
    }
    const ordenPaso = Object.fromEntries(PASOS.map((p, i) => [p.id, i]));
    return lista.sort((a, b) => ((ordenPaso[a.step] ?? 99) - (ordenPaso[b.step] ?? 99)) || ((ORDEN[a.campo] ?? 999) - (ORDEN[b.campo] ?? 999)));
  }

  function pendientesPorPaso(v) {
    const r = {};
    for (const p of listaPendientes(v)) r[p.step] = (r[p.step] || 0) + 1;
    return r;
  }

  /**
   * Actividades RIT que corresponden a un CIIU: el mismo número (0111 → 111) o, si el RIT
   * lo subdivide, sus códigos de 5 dígitos (7020 → 70201, 70202). Solo se sugieren, nunca se imponen.
   */
  function candidatosRit(ciiu) {
    const d = soloDigitos(ciiu);
    if (!d) return [];
    const n = String(Number(d));
    const exacta = buscarOpcion('actividadRit', n);
    if (exacta) return [exacta];
    if (n.length !== 4) return [];
    return opcionesDe('actividadRit').filter((o) => o.valor.length === 5 && o.valor.startsWith(n));
  }

  function sugerenciaRit(s) {
    if (!s.actividadRut || s.actividadRit) return [];
    return candidatosRit(s.actividadRut);
  }

  // ─────────────────────────── Cambios de valor ───────────────────────────

  let actualizacionPendiente = false;

  function programarActualizacion() {
    if (actualizacionPendiente) return;
    actualizacionPendiente = true;
    // Microtarea: agrupa los cambios del mismo evento y no depende de que la pestaña esté visible.
    queueMicrotask(() => { actualizacionPendiente = false; actualizarUI(); });
  }

  /**
   * Cambia un valor del estado.
   * origen: 'usuario' (quita la marca de documento), 'auto' (regla interna) o
   * 'RUT' | 'RIT' | 'Sugerido' (marca el campo con esa fuente).
   */
  function cambiar(id, valor, origen) {
    if (!CAMPOS[id]) return;
    const o = origen || 'usuario';
    const previo = estado.s[id] == null ? '' : estado.s[id];
    const nuevo = valor == null ? '' : String(valor);
    estado.s[id] = nuevo;
    if (o === 'usuario' || o === 'auto') {
      if (previo !== nuevo) delete estado.meta.fuentes[id];
    } else {
      estado.meta.fuentes[id] = o;
    }
    // Si la persona escribe lo mismo que decía el documento, ya no hay nada que ofrecerle.
    const conflicto = estado.meta.conflictos[id];
    if (conflicto && conflicto.valor === nuevo) delete estado.meta.conflictos[id];
    if (previo !== nuevo) reglas(id, previo, nuevo, o);
    programarActualizacion();
    guardarPronto();
  }

  /**
   * Comodidades: NIT → número de identificación, municipio dependiente del departamento.
   * Si la persona cambia el departamento, el municipio se vacía aunque exista uno con el mismo nombre en
   * el nuevo (La Unión, Granada…): sería otro municipio. Un documento trae los dos juntos y se respetan.
   */
  function reglas(id, previo, nuevo, origen) {
    const s = estado.s;
    if (id === 'nit' && (s.numeroId === '' || s.numeroId === previo)) {
      s.numeroId = nuevo;
      delete estado.meta.fuentes.numeroId;
      sincronizar('numeroId');
    }
    if (id === 'departamento' && s.municipio && (origen === 'usuario' || !buscarOpcion('municipio', s.municipio))) {
      s.municipio = '';
      delete estado.meta.fuentes.municipio;
      sincronizar('municipio');
    }
  }

  function sincronizar(id) {
    const c = sesion.controles[id];
    if (c && c.set) c.set(estado.s[id] == null ? '' : estado.s[id]);
  }

  function sincronizarTodo() {
    for (const id of Object.keys(sesion.controles)) sincronizar(id);
  }

  function tocar(id) {
    sesion.tocados.add(id);
    programarActualizacion();
  }

  // ─────────────────────────── Controles ───────────────────────────

  const idControl = (id) => 'f-' + id;

  function crearCampo(id, opciones) {
    const f = CAMPOS[id];
    const conf = opciones || {};
    if (f.type === 'check') return crearCheck(id);

    const tipoSelect = f.type === 'select' ? estiloSelect(id) : null;
    const esGrupo = f.type === 'yesno' || tipoSelect === 'pastillas' || tipoSelect === 'filas';
    const cid = idControl(id);
    const cont = h(esGrupo ? 'fieldset' : 'div', { class: 'campo campo--' + f.type, 'data-campo': id });
    const textoOpciones = tipoSelect === 'pastillas' ? opcionesDe(id).reduce((n, o) => n + o.texto.length, 0) : 0;
    const etiquetaTexto = conf.etiqueta || textoEtiqueta(id);
    const ancho = f.ancho || (esGrupo && (etiquetaTexto.length > 35 || tipoSelect === 'filas' || textoOpciones > 28) ? 'full' : '');
    if (ancho) cont.dataset.ancho = ancho;
    if (conf.clase) cont.classList.add(conf.clase);

    const cabecera = esGrupo
      ? h('legend', { class: 'etiqueta', id: cid + '-etq' })
      : h('label', { class: 'etiqueta', for: cid, id: cid + '-etq' });
    if (conf.marcador) cabecera.append(h('span', { class: 'marcador' }, conf.marcador));
    cabecera.append(
      h('span', { class: 'etiqueta-texto' }, etiquetaTexto),
      h('span', { class: 'opcional', hidden: true }, 'Opcional'),
    );

    let control;
    switch (f.type) {
      case 'yesno': control = crearRadios(id, [opcion('SI', 'Sí'), opcion('NO', 'No')], 'pastillas'); break;
      case 'select':
        control = tipoSelect === 'lista' ? crearSelect(id) : crearRadios(id, opcionesDe(id), tipoSelect);
        break;
      case 'combo': control = crearCombo(id); break;
      case 'money': control = crearDinero(id); break;
      case 'date': control = crearFecha(id); break;
      default: control = crearTexto(id);
    }

    const sugerencia = h('div', { class: 'sugerencia', hidden: true, 'aria-live': 'polite' });
    // Valor de un documento o de SECOP que no reemplazó lo que la persona escribió: "Tu RUT dice: X · Usar este".
    const conflicto = h('div', { class: 'sugerencia conflicto', hidden: true, 'aria-live': 'polite' });
    const ayudaTexto = conf.ayuda || f.ayuda;
    const ayuda = ayudaTexto ? h('p', { class: 'ayuda-campo', id: cid + '-ayuda' }, ayudaTexto) : null;
    const mensaje = h('p', { class: 'mensaje', id: cid + '-msg', hidden: true });

    agregarHijos(cont, [cabecera, control.el, mensaje, conflicto, sugerencia, ayuda]);
    if (esGrupo && ayuda) cont.setAttribute('aria-describedby', cid + '-ayuda');

    sesion.controles[id] = { cont, set: control.set, enfocar: control.enfocar, describir: control.describir || (() => {}), invalido: control.invalido || (() => {}) };
    control.set(estado.s[id] == null ? '' : estado.s[id]);
    return cont;
  }

  function textoEtiqueta(id) {
    const f = CAMPOS[id];
    const texto = f.pregunta && PREGUNTAS[f.pregunta] ? PREGUNTAS[f.pregunta] : f.label;
    return texto.replace(/\$ (?=\d)/g, '$ '); // "$ 73.323.600" no se parte entre líneas
  }

  function crearCheck(id) {
    const f = CAMPOS[id];
    const cid = idControl(id);
    const input = h('input', { type: 'checkbox', id: cid, class: 'check-input' });
    input.addEventListener('change', () => { cambiar(id, input.checked ? 'SI' : ''); tocar(id); });
    const desc = DESCRIPCION_CHECKS[id];
    const cont = h('div', { class: 'campo campo--check', 'data-campo': id, 'data-ancho': 'full' },
      h('label', { class: 'check', for: cid }, input,
        h('span', { class: 'check-texto' },
          h('span', { class: 'check-titulo' }, f.label),
          desc ? h('span', { class: 'check-desc' }, desc) : null)));
    sesion.controles[id] = {
      cont,
      set: (v) => { input.checked = v === 'SI'; },
      enfocar: () => input.focus(),
      describir: () => {},
      invalido: () => {},
    };
    input.checked = estado.s[id] === 'SI';
    return cont;
  }

  function atributosBase(id) {
    return { id: idControl(id), class: 'control', name: id, 'aria-describedby': CAMPOS[id].ayuda ? idControl(id) + '-ayuda' : null };
  }

  function apiInput(input, formatear) {
    return {
      el: input,
      set: (v) => { const t = formatear ? formatear(v) : v; if (input.value !== t) input.value = t; },
      enfocar: () => input.focus(),
      describir: (ids) => { if (ids) input.setAttribute('aria-describedby', ids); else input.removeAttribute('aria-describedby'); },
      invalido: (si) => { if (si) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); },
    };
  }

  function crearTexto(id) {
    const f = CAMPOS[id];
    const t = f.type;
    const attrs = atributosBase(id);
    attrs.type = t === 'email' ? 'email' : t === 'tel' ? 'tel' : 'text';
    // Dígitos y teléfonos sin maxlength: el navegador cortaría lo pegado ("1.023.456.789", "+57 300…")
    // antes de limpiarlo; manejarDigitos limpia primero y después recorta.
    if (f.maxLength && t !== 'digits' && t !== 'tel') attrs.maxlength = f.maxLength;
    if (t === 'digits') { attrs.inputmode = 'numeric'; attrs.autocomplete = 'off'; }
    if (t === 'tel') { attrs.inputmode = 'tel'; attrs.autocomplete = 'tel'; }
    if (t === 'email') { attrs.autocomplete = 'email'; attrs.spellcheck = 'false'; attrs.autocapitalize = 'off'; }
    if (t === 'upper') attrs.autocapitalize = 'characters';
    // Sugerencias sin imponerlas (p. ej. parentesco, que en el Excel es texto libre).
    let lista = null;
    if (Array.isArray(f.sugerencias) && f.sugerencias.length) {
      attrs.list = idControl(id) + '-sugerencias';
      attrs.autocomplete = 'off';
      lista = h('datalist', { id: attrs.list }, f.sugerencias.map((x) => h('option', { value: x })));
    }
    const input = h('input', attrs);

    if (t === 'digits' || t === 'tel') {
      manejarDigitos(input, id, t === 'tel' ? 10 : f.maxLength, t);
    } else {
      input.addEventListener('input', () => {
        let v = input.value;
        if (t === 'upper') {
          const inicio = input.selectionStart;
          const fin = input.selectionEnd;
          const mayus = v.toLocaleUpperCase('es-CO');
          if (mayus !== v && mayus.length === v.length) {
            input.value = mayus;
            try { input.setSelectionRange(inicio, fin); } catch (e) { /* nada */ }
          }
          v = input.value;
        }
        cambiar(id, v);
      });
      input.addEventListener('blur', () => {
        let v = input.value.replace(/\s+/g, ' ').trim();
        if (t === 'email') v = v.replace(/\s/g, '').toLowerCase();
        if (v !== input.value) input.value = v;
        if (v !== (estado.s[id] || '')) cambiar(id, v);
        tocar(id);
      });
    }
    const api = apiInput(input);
    if (lista) api.el = h('div', { class: 'con-sugerencias' }, input, lista);
    return api;
  }

  // Limpieza de lo que se escribe o se pega (calc.js); versiones mínimas si Calc no cargó.
  const LIMPIAR = (window.Calc && window.Calc.limpiar) || {
    dinero: (t) => ({ digitos: soloDigitos(t), centavos: null }),
    telefono: (t) => soloDigitos(t),
    nitDv: (t) => ({ nit: soloDigitos(t), dv: null }),
  };

  /**
   * Solo dígitos, conservando la posición del cursor. tipo: 'digits' | 'tel' | 'money'.
   * - Dinero: separador de miles; la coma decimal y los centavos se ven mientras se escribe y se
   *   descartan al salir ("4.500.000,00" → 4500000, nunca 450000000).
   * - Teléfono: quita el indicativo +57 / 0057.
   * - NIT pegado con su DV ("52.123.456-7"): el DV va a su casilla.
   * - Supr o Retroceso sobre un punto de miles borra el dígito vecino (si no, el punto volvería a aparecer).
   */
  function manejarDigitos(input, id, maximo, tipo) {
    const conMiles = tipo === 'money';
    input.addEventListener('input', (e) => {
      const entrada = (e && e.inputType) || '';
      const pegado = /^insertFrom/.test(entrada) || entrada === 'insertReplacementText' || !!(e && e.data && e.data.length > 1);
      let crudo = input.value;
      let dvPegado = null;
      if (id === 'nit' && pegado) {
        const p = LIMPIAR.nitDv(crudo);
        if (p.dv != null) { crudo = p.nit; dvPegado = p.dv; }
      }
      const pos = crudo !== input.value || input.selectionStart == null ? crudo.length : input.selectionStart;
      let antes = soloDigitos(crudo.slice(0, pos)).length;
      let digitos;
      let centavos = null;
      if (conMiles) {
        const r = LIMPIAR.dinero(crudo, { pegado });
        digitos = r.digitos.replace(/^0+(?=\d)/, '');
        centavos = r.centavos;
      } else {
        digitos = tipo === 'tel' ? LIMPIAR.telefono(crudo) : soloDigitos(crudo);
      }
      const previo = estado.s[id] || '';
      if (conMiles && centavos == null && digitos === previo && (entrada === 'deleteContentForward' || entrada === 'deleteContentBackward')) {
        if (entrada === 'deleteContentForward' && antes < digitos.length) digitos = digitos.slice(0, antes) + digitos.slice(antes + 1);
        else if (entrada === 'deleteContentBackward' && antes > 0) { digitos = digitos.slice(0, antes - 1) + digitos.slice(antes); antes -= 1; }
      }
      // Un celular escrito con su indicativo (57…) puede llegar a 12 dígitos antes de quitarlo.
      const max = tipo === 'tel' && digitos.length > 10 && digitos.startsWith('57') ? 12 : maximo;
      if (max) digitos = digitos.slice(0, max);
      const texto = conMiles ? miles(digitos) + (centavos != null ? ',' + centavos : '') : digitos;
      if (input.value !== texto) {
        input.value = texto;
        let p = texto.length;
        if (centavos == null) {
          p = 0;
          let cuenta = 0;
          while (p < texto.length && cuenta < antes) { if (/\d/.test(texto[p])) cuenta++; p++; }
        }
        try { input.setSelectionRange(p, p); } catch (err) { /* nada */ }
      }
      cambiar(id, digitos);
      if (dvPegado != null && CAMPOS.dv) { cambiar('dv', dvPegado); sincronizar('dv'); }
    });
    input.addEventListener('blur', () => {
      // Los centavos no van al formato: al salir se quitan de la vista.
      if (conMiles && input.value.indexOf(',') >= 0) input.value = miles(estado.s[id] || '');
      tocar(id);
    });
  }

  function crearDinero(id) {
    const attrs = atributosBase(id);
    attrs.type = 'text';
    attrs.inputmode = 'numeric';
    attrs.autocomplete = 'off';
    attrs.class = 'control control--dinero';
    const input = h('input', attrs);
    manejarDigitos(input, id, 13, 'money');
    const api = apiInput(input, (v) => miles(soloDigitos(v)));
    api.el = h('div', { class: 'con-prefijo' }, h('span', { class: 'prefijo', 'aria-hidden': 'true' }, '$'), input);
    return api;
  }

  function crearFecha(id) {
    const attrs = atributosBase(id);
    attrs.type = 'date';
    attrs.min = '1900-01-01';
    attrs.max = '2099-12-31';
    const input = h('input', attrs);
    const marcarVacio = () => input.classList.toggle('vacio', !input.value);
    const alCambiar = () => { marcarVacio(); cambiar(id, /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value : ''); };
    input.addEventListener('change', alCambiar);
    input.addEventListener('input', alCambiar);
    input.addEventListener('blur', () => tocar(id));
    const api = apiInput(input);
    const fijar = api.set;
    api.set = (v) => { fijar(v); marcarVacio(); };
    return api;
  }

  function crearSelect(id) {
    const attrs = atributosBase(id);
    attrs.class = 'control control--select';
    const select = h('select', attrs);
    const ops = opcionesDe(id);
    const pintar = (v) => {
      select.textContent = '';
      select.append(h('option', { value: '' }, 'Selecciona una opción'));
      for (const o of ops) select.append(h('option', { value: o.valor }, o.texto));
      if (v && !ops.some((o) => o.valor === v)) select.append(h('option', { value: v }, v.trim() + ' (no está en la lista)'));
      select.value = v;
    };
    pintar(estado.s[id] || '');
    select.addEventListener('change', () => { cambiar(id, select.value); tocar(id); });
    const api = apiInput(select);
    api.set = (v) => { if (v && !Array.from(select.options).some((o) => o.value === v)) pintar(v); if (select.value !== v) select.value = v; };
    return api;
  }

  function crearRadios(id, ops, estilo) {
    const nombre = idControl(id);
    const caja = h('div', { class: estilo === 'filas' ? 'opciones-filas' : 'opciones' });
    const radios = ops.map((o, i) => {
      const r = h('input', { type: 'radio', name: nombre, value: o.valor, id: i === 0 ? nombre : nombre + '-' + i });
      r.addEventListener('change', () => { if (r.checked) { cambiar(id, r.value); tocar(id); } });
      caja.append(h('label', { class: estilo === 'filas' ? 'opcion-fila' : 'opcion' }, r, h('span', null, o.texto)));
      return r;
    });
    return {
      el: caja,
      set: (v) => { for (const r of radios) r.checked = r.value === v; },
      enfocar: () => (radios.find((r) => r.checked) || radios[0]).focus(),
      describir: () => {},
      invalido: () => {},
    };
  }

  // ─────────────────────────── Combobox accesible ───────────────────────────

  function crearCombo(id) {
    const f = CAMPOS[id];
    const cid = idControl(id);
    const listaId = cid + '-lista';
    const input = h('input', {
      id: cid, class: 'control control--combo', type: 'text', role: 'combobox', name: id,
      'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listaId,
      autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
      placeholder: 'Escribe para buscar…',
      'aria-describedby': f.ayuda ? cid + '-ayuda' : null,
    });
    const lista = h('ul', { id: listaId, class: 'combo-lista', role: 'listbox', 'aria-label': f.label, hidden: true });
    const anuncio = h('span', { class: 'sr-only', 'aria-live': 'polite' });
    const boton = h('button', { type: 'button', class: 'combo-boton', tabindex: '-1', 'aria-hidden': 'true', html: svgIcono('chevron') });
    const cont = h('div', { class: 'combo' }, input, boton, lista, anuncio);

    let visibles = [];
    let activo = -1;
    let abierto = false;

    const textoActual = () => {
      const v = estado.s[id] || '';
      if (!v) return '';
      const o = buscarOpcion(id, v);
      return o ? textoOpcion(o) : v;
    };

    function filtrar(consulta) {
      const ops = opcionesElegibles(id);
      const q = norm(consulta);
      if (!q) return ops;
      const palabras = q.split(' ');
      const primero = [];
      const resto = [];
      for (const o of ops) {
        if (!palabras.every((p) => o.busqueda.includes(p))) continue;
        if (o.busqueda.startsWith(q) || norm(o.texto).startsWith(q)) primero.push(o); else resto.push(o);
      }
      return primero.concat(resto);
    }

    function pintar(total) {
      lista.textContent = '';
      const actual = estado.s[id] || '';
      if (!visibles.length) {
        const vacio = id === 'municipio' && !estado.s.departamento ? 'Primero elige el departamento.' : 'No encontramos coincidencias.';
        lista.append(h('li', { class: 'combo-vacio', role: 'presentation' }, vacio));
      }
      visibles.forEach((o, i) => {
        const li = h('li', {
          id: listaId + '-' + i, role: 'option', class: 'combo-opcion' + (i === activo ? ' activa' : ''),
          'aria-selected': o.valor === actual ? 'true' : 'false',
        });
        if (o.codigo) li.append(h('span', { class: 'combo-codigo' }, o.codigo));
        li.append(h('span', { class: 'combo-texto' }, o.texto));
        li.addEventListener('mousedown', (e) => { e.preventDefault(); elegir(o); });
        lista.append(li);
      });
      if (total > visibles.length) {
        lista.append(h('li', { class: 'combo-mas', role: 'presentation' },
          'Mostrando ' + visibles.length + ' de ' + total.toLocaleString('es-CO') + '. Escribe para acotar la búsqueda.'));
      }
      anuncio.textContent = total ? plural(total, 'resultado', 'resultados') : 'Sin resultados';
      marcarActivo();
    }

    function marcarActivo() {
      const items = lista.querySelectorAll('[role="option"]');
      items.forEach((li, i) => li.classList.toggle('activa', i === activo));
      if (activo >= 0 && items[activo]) {
        input.setAttribute('aria-activedescendant', items[activo].id);
        items[activo].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function abrir(consulta, mostrarTodo) {
      const todos = mostrarTodo ? opcionesElegibles(id) : filtrar(consulta);
      let lote = todos.slice(0, MAX_OPCIONES_COMBO);
      const actual = estado.s[id];
      if (mostrarTodo && actual) {
        const sel = todos.find((o) => o.valor === actual);
        if (sel && !lote.includes(sel)) lote = [sel].concat(lote.slice(0, MAX_OPCIONES_COMBO - 1));
        activo = Math.max(0, lote.indexOf(sel));
      } else {
        activo = consulta && lote.length ? 0 : -1;
      }
      visibles = lote;
      abierto = true;
      lista.hidden = false;
      cont.classList.add('abierto');
      input.setAttribute('aria-expanded', 'true');
      pintar(todos.length);
    }

    function cerrar() {
      abierto = false;
      activo = -1;
      lista.hidden = true;
      cont.classList.remove('abierto');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function elegir(o) {
      input.value = textoOpcion(o);
      cerrar();
      cambiar(id, o.valor);
      tocar(id);
    }

    function conciliar() {
      const texto = input.value.trim();
      if (!texto) {
        if (estado.s[id]) cambiar(id, '');
        input.value = '';
        return;
      }
      if (texto === textoActual()) return;
      const q = norm(texto);
      const ops = opcionesElegibles(id);
      // El código gana; un texto exacto solo se acepta si es de una sola opción (en ARL y RIT hay
      // descripciones repetidas con códigos distintos: nunca se elige una al azar).
      const porCodigo = ops.filter((o) => o.codigo && norm(o.codigo) === q);
      const porTexto = ops.filter((o) => norm(o.texto) === q || norm(textoOpcion(o)) === q);
      const candidatas = porCodigo.length ? porCodigo : porTexto.length ? porTexto : filtrar(texto);
      if (candidatas.length === 1) { elegir(candidatas[0]); return; }
      input.value = textoActual();
      if (porTexto.length > 1) anunciar('Hay varias opciones con ese nombre; elige una de la lista por su código.');
    }

    input.addEventListener('input', () => abrir(input.value, false));
    input.addEventListener('click', () => { if (!abierto) abrir(input.value, input.value === textoActual()); });
    input.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!abierto) { abrir(input.value, input.value === textoActual()); if (activo < 0 && visibles.length) { activo = 0; marcarActivo(); } }
          else if (visibles.length) { activo = (activo + 1) % visibles.length; marcarActivo(); }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!abierto) { abrir(input.value, input.value === textoActual()); }
          if (visibles.length) { activo = activo <= 0 ? visibles.length - 1 : activo - 1; marcarActivo(); }
          break;
        case 'Enter':
          if (abierto && activo >= 0 && visibles[activo]) { e.preventDefault(); elegir(visibles[activo]); }
          break;
        case 'Escape':
          if (abierto) { e.preventDefault(); cerrar(); input.value = textoActual(); }
          else if (input.value !== textoActual()) { e.preventDefault(); input.value = textoActual(); }
          break;
        case 'Tab':
          if (abierto) cerrar();
          break;
        default:
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (cont.contains(document.activeElement)) return;
        if (abierto) cerrar();
        conciliar();
        tocar(id);
      }, 0);
    });
    boton.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (abierto) cerrar(); else { input.focus(); abrir('', true); }
    });

    return {
      el: cont,
      set: () => {
        const texto = textoActual();
        if (document.activeElement !== input || !abierto) input.value = texto;
        input.title = texto;
      },
      enfocar: () => input.focus(),
      describir: (ids) => { if (ids) input.setAttribute('aria-describedby', ids); else input.removeAttribute('aria-describedby'); },
      invalido: (si) => { if (si) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); },
    };
  }

  // ─────────────────────────── Marco: stepper ───────────────────────────

  function construirStepper() {
    const nav = document.getElementById('stepper');
    nav.textContent = '';
    const cabeza = h('div', { class: 'stepper-cabeza' },
      h('p', { class: 'stepper-paso', id: 'stepper-paso' }),
      h('p', { class: 'guardado', id: 'guardado', hidden: true, 'aria-live': 'polite' }));
    firmaGuardado = '';
    const lista = h('ol', { class: 'stepper-lista' });
    PASOS.forEach((p, i) => {
      const boton = h('button', { type: 'button', class: 'stepper-item', 'data-indice': i, onclick: () => intentarIr(i) },
        h('span', { class: 'stepper-barra', 'aria-hidden': 'true' }),
        h('span', { class: 'stepper-etiqueta' },
          h('span', { class: 'stepper-estado', 'aria-hidden': 'true' }),
          h('span', { class: 'stepper-nombre' }, p.corto || p.titulo)),
        h('span', { class: 'sr-only stepper-sr' }));
      lista.append(h('li', null, boton));
    });
    nav.append(cabeza, lista);
  }

  function pintarStepper(v) {
    const pendientes = pendientesPorPaso(v);
    const actual = estado.meta.paso;
    const paso = PASOS[actual];
    const etq = document.getElementById('stepper-paso');
    if (etq) {
      etq.textContent = '';
      etq.append('Paso ', h('strong', null, String(actual + 1)), ' de ' + PASOS.length, h('span', { class: 'stepper-actual' }, ' · ' + paso.titulo));
    }
    document.querySelectorAll('.stepper-item').forEach((b) => {
      const i = Number(b.dataset.indice);
      const p = PASOS[i];
      const est = estadoPaso(p.id, pendientes);
      b.dataset.estado = est;
      b.classList.toggle('pasado', i < actual);
      b.classList.toggle('actual', i === actual);
      if (i === actual) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      const icono2 = b.querySelector('.stepper-estado');
      icono2.innerHTML = est === 'completo' ? svgIcono('check', 'icono-mini') : '';
      const sr = b.querySelector('.stepper-sr');
      sr.textContent = ' — paso ' + (i + 1) + (est === 'completo' ? ', completo' : est === 'pendiente' ? ', con datos pendientes' : '');
    });
  }

  function estadoPaso(idPaso, pendientes) {
    if (idPaso === 'documentos') return estado.meta.docs.RUT || estado.meta.docs.RIT ? 'completo' : '';
    if (idPaso === 'revision') return '';
    const n = pendientes[idPaso] || 0;
    if (!n) return 'completo';
    return estado.meta.visitados[idPaso] ? 'pendiente' : '';
  }

  // ─────────────────────────── Navegación ───────────────────────────

  function irA(destino, opciones) {
    const conf = opciones || {};
    let i = typeof destino === 'string' ? PASOS.findIndex((p) => p.id === destino) : Number(destino);
    if (!Number.isInteger(i) || i < 0) i = 0;
    if (i >= PASOS.length) i = PASOS.length - 1;
    const anterior = PASOS[estado.meta.paso];
    if (anterior && i !== estado.meta.paso) {
      estado.meta.visitados[anterior.id] = true;
      // Lo que estaba a la vista al salir del paso ya se puede marcar como pendiente al volver.
      for (const [id, c] of Object.entries(sesion.controles)) if (!c.cont.hidden) sesion.vistos.add(id);
      for (const clave of soportesRequeridos()) if (SOPORTES[clave].paso === anterior.id) sesion.vistos.add(campoSoporte(clave));
    }
    sesion.bloqueo = '';
    // Con el primer avance (un clic) se pide dónde guardar el formulario.
    pedirPrimerGuardado();
    estado.meta.paso = i;
    renderPaso();
    guardarPronto();
    const tarjeta = document.getElementById('tarjeta');
    if (tarjeta) {
      const arriba = tarjeta.getBoundingClientRect().top + window.scrollY - 16;
      if (window.scrollY > arriba) window.scrollTo({ top: Math.max(0, arriba), behavior: movimientoReducido() ? 'auto' : 'smooth' });
    }
    if (conf.enfocar !== false) {
      const titulo = document.getElementById('paso-titulo');
      if (titulo) titulo.focus({ preventScroll: true });
    }
  }

  // Pasos que no impiden avanzar: Documentos (el RUT y el RIT son una ayuda) y, por ahora, Contrato.
  const PASOS_SIN_BLOQUEO = new Set(['documentos', 'contrato', 'revision']);

  /**
   * Avanzar desde la barra de pasos o con "Siguiente". Hacia atrás siempre se puede; hacia adelante, cada
   * paso que se deja atrás debe tener sus obligatorios completos y bien escritos. Si no, se queda (o va) en
   * el primer paso incompleto, marca lo pendiente y lleva al primer dato que falta.
   */
  function intentarIr(destino) {
    const i = Number(destino);
    const actual = estado.meta.paso;
    if (!Number.isInteger(i) || i <= actual) { irA(i); return; }
    const pendientes = listaPendientes(validar());
    for (let k = actual; k < i; k++) {
      const paso = PASOS[k];
      if (PASOS_SIN_BLOQUEO.has(paso.id)) continue;
      const propios = pendientes.filter((p) => p.step === paso.id);
      if (!propios.length) continue;
      if (k !== actual) irA(k, { enfocar: false });
      mostrarBloqueo(paso.id, propios);
      return;
    }
    irA(i);
  }

  function mostrarBloqueo(idPaso, propios) {
    sesion.bloqueo = idPaso;
    estado.meta.visitados[idPaso] = true;
    for (const p of propios) { sesion.vistos.add(p.campo); sesion.tocados.add(p.campo); }
    actualizarUI();
    const primero = propios.find((p) => sesion.controles[p.campo]);
    if (primero) {
      const c = sesion.controles[primero.campo];
      const f = CAMPOS[primero.campo];
      if (f && f.opcionalPlegable) { abrirPlegableHasta(primero.campo); actualizarUI(); }
      c.cont.scrollIntoView({ block: 'center', behavior: movimientoReducido() ? 'auto' : 'smooth' });
      c.enfocar();
    } else {
      const soporte = propios.find((p) => claveSoporte(p.campo));
      if (soporte) enfocarSoporte(claveSoporte(soporte.campo));
    }
    anunciar(propios.length === 1 ? 'Falta 1 dato obligatorio en esta sección.' : 'Faltan ' + propios.length + ' datos obligatorios en esta sección.');
  }

  function irAlCampo(campo, paso) {
    const destino = paso || pasoDeCampo(campo);
    irA(destino, { enfocar: false });
    const c = sesion.controles[campo];
    if (!c && claveSoporte(campo)) {
      sesion.vistos.add(campo);
      actualizarUI();
      if (enfocarSoporte(claveSoporte(campo))) return;
    }
    if (!c) { const t = document.getElementById('paso-titulo'); if (t) t.focus({ preventScroll: true }); return; }
    sesion.vistos.add(campo);
    const f = CAMPOS[campo];
    if (f && f.opcionalPlegable) abrirPlegableHasta(campo);
    actualizarUI();
    c.enfocar();
    c.cont.scrollIntoView({ block: 'center', behavior: movimientoReducido() ? 'auto' : 'smooth' });
  }

  // ─────────────────────────── Render de pasos ───────────────────────────

  function renderPaso() {
    const destino = document.getElementById('paso');
    const paso = PASOS[estado.meta.paso];
    sesion.controles = {};
    destino.textContent = '';

    const contenido = h('div', { class: 'paso-contenido', 'data-paso': paso.id });
    const cabecera = h('header', { class: 'paso-cabecera' },
      h('h2', { class: 'paso-titulo', id: 'paso-titulo', tabindex: '-1' }, paso.titulo),
      paso.descripcion ? h('p', { class: 'paso-descripcion' }, paso.descripcion) : null);
    if (AYUDAS[paso.id]) {
      cabecera.append(h('details', { class: 'ayuda-paso' },
        h('summary', null, icono('info'), h('span', null, '¿Cómo diligenciar esta sección?')),
        h('ul', null, AYUDAS[paso.id].map((t) => h('li', null, t)))));
    }
    const cuerpo = h('div', { class: 'paso-cuerpo' });
    contenido.append(cabecera, cuerpo);

    switch (paso.id) {
      case 'documentos': construirDocumentos(cuerpo); break;
      case 'contrato': construirContrato(cuerpo); break;
      case 'retencion': construirRetencion(cuerpo); break;
      case 'revision': construirRevision(cuerpo); break;
      default: construirGenerico(cuerpo, paso.id);
    }
    if (paso.id === 'pagos') cuerpo.append(crearSoportes('banco'));

    if (paso.id !== 'documentos' && paso.id !== 'revision') {
      contenido.append(h('div', { class: 'avisos-paso', id: 'avisos-paso', hidden: true }));
      contenido.append(h('p', { class: 'resumen-paso', id: 'resumen-paso', hidden: true, 'aria-live': 'polite' }));
    }
    contenido.append(construirNavegacion());
    destino.append(contenido);
    actualizarUI();
  }

  function construirNavegacion() {
    const i = estado.meta.paso;
    const paso = PASOS[i];
    const nav = h('div', { class: 'navegacion' });
    const izquierda = h('div', { class: 'navegacion-izq' });
    const derecha = h('div', { class: 'navegacion-der' });
    if (i > 0) {
      izquierda.append(h('button', { type: 'button', class: 'boton boton--fantasma', onclick: () => irA(i - 1) },
        icono('flechaIzq'), h('span', null, 'Anterior')));
    }
    if (i < PASOS.length - 1) {
      derecha.append(h('button', { type: 'button', class: 'boton boton--primario', id: 'btn-siguiente', onclick: () => intentarIr(i + 1) }));
    } else {
      // Al final: guardar a la vista (el formulario ya se autoguarda; esto confirma que quedó en el archivo).
      const guardar = h('button', { type: 'button', class: 'boton boton--secundario', id: 'btn-guardar', onclick: () => guardarDesdeBoton(guardar) },
        icono('guardar'), h('span', null, 'Guardar'));
      derecha.append(guardar);
    }
    nav.append(izquierda, derecha);
    pintarNavegacion(nav);
    return nav;
  }

  /** Texto del botón principal: "Continuar: Personales" en Documentos, "Siguiente: …" en los demás pasos. */
  function pintarNavegacion(contenedor) {
    const raiz = contenedor || document;
    const i = estado.meta.paso;
    const paso = PASOS[i];
    const boton = raiz.querySelector('#btn-siguiente');
    if (boton && PASOS[i + 1]) {
      const siguiente = PASOS[i + 1];
      boton.textContent = '';
      boton.append(h('span', null, paso.id === 'documentos' ? 'Continuar' : 'Siguiente',
        h('span', { class: 'boton-detalle' }, ': ' + (siguiente.corto || siguiente.titulo))), icono('flechaDer'));
    }
  }

  function camposDelPaso(idPaso) {
    return IDS.filter((id) => CAMPOS[id].step === idPaso);
  }

  function construirGenerico(cuerpo, idPaso) {
    const grupos = [];
    const porNombre = {};
    for (const id of camposDelPaso(idPaso)) {
      const g = CAMPOS[id].grupo || '';
      if (!porNombre[g]) { porNombre[g] = { nombre: g, ids: [] }; grupos.push(porNombre[g]); }
      porNombre[g].ids.push(id);
    }
    for (const g of grupos) cuerpo.append(construirGrupo(g.nombre, g.ids));
  }

  function construirGrupo(nombre, ids, opciones) {
    const conf = opciones || {};
    const tituloId = nombre ? 'grupo-' + norm(nombre).replace(/[^a-z0-9]+/g, '-') : null;
    const seccion = h('section', { class: 'grupo' + (conf.clase ? ' ' + conf.clase : ''), 'aria-labelledby': tituloId });
    if (nombre && !conf.sinTitulo) seccion.append(h('h3', { class: 'grupo-titulo', id: tituloId }, nombre));
    if (INTRO_GRUPOS[nombre]) seccion.append(h('p', { class: 'grupo-intro' }, INTRO_GRUPOS[nombre]));
    seccion.append(construirRejilla(ids));
    return seccion;
  }

  /** opciones.sinParentesis: quita "(AFC)" y similares de la etiqueta cuando el contexto ya lo dice. */
  function construirRejilla(ids, clase, opciones) {
    const conf = opciones || {};
    const rejilla = h('div', { class: 'rejilla' + (clase ? ' ' + clase : '') });
    const plegables = {};
    const bloquesVistos = new Set();
    for (const id of ids) {
      const clave = CAMPOS[id].opcionalPlegable;
      let clase = null;
      if (clave) {
        const bloque = clave + ':' + indiceBloque(id);
        if (!bloquesVistos.has(bloque)) { bloquesVistos.add(bloque); clase = 'inicio-fila'; }
        plegables[clave] = true;
      }
      const etiqueta = conf.sinParentesis ? CAMPOS[id].label.replace(/\s*\([^)]*\)\s*$/, '') : null;
      rejilla.append(crearCampo(id, { clase, etiqueta }));
      if (CALCULADOS[id]) rejilla.append(crearCalculado(id));
    }
    if (!Object.keys(plegables).length) return rejilla;
    const envoltura = h('div', { class: 'rejilla-envoltura' }, rejilla);
    for (const clave of Object.keys(plegables)) {
      envoltura.append(h('button', {
        type: 'button', class: 'boton-agregar', 'data-plegable': clave,
        onclick: () => abrirSiguientePlegable(clave),
      }, icono('mas'), h('span', null, TEXTO_PLEGABLE[clave] || 'Agregar otro')));
    }
    return envoltura;
  }

  function crearCalculado(ancla) {
    const cont = h('div', { class: 'calculado', 'data-ancla': ancla, hidden: true });
    CALCULADOS[ancla].forEach((c, i) => {
      cont.append(h('p', { class: 'calculado-item', 'data-i': i },
        h('span', { class: 'calculado-etq' }, c.etiqueta), h('span', { class: 'calculado-valor' })));
    });
    return cont;
  }

  // Plegables ("+ Agregar otro CRP"): los campos se agrupan por el número final del id (crp2/fechaCrp2 → 2).
  function bloquesPlegable(clave) {
    const nums = [];
    for (const id of IDS) {
      if (CAMPOS[id].opcionalPlegable !== clave) continue;
      const n = Number((id.match(/(\d+)$/) || [])[1] || 0);
      if (!nums.includes(n)) nums.push(n);
    }
    return nums.sort((a, b) => a - b);
  }

  function indiceBloque(id) {
    const clave = CAMPOS[id].opcionalPlegable;
    const n = Number((id.match(/(\d+)$/) || [])[1] || 0);
    return bloquesPlegable(clave).indexOf(n);
  }

  function bloquesAbiertos(clave) {
    let abiertos = Number(estado.meta.plegables[clave] || 0);
    for (const id of IDS) {
      if (CAMPOS[id].opcionalPlegable === clave && estado.s[id]) abiertos = Math.max(abiertos, indiceBloque(id) + 1);
    }
    return abiertos;
  }

  function plegableVisible(id) {
    const clave = CAMPOS[id].opcionalPlegable;
    return !clave || indiceBloque(id) < bloquesAbiertos(clave);
  }

  function abrirSiguientePlegable(clave) {
    const abiertos = bloquesAbiertos(clave);
    estado.meta.plegables[clave] = abiertos + 1;
    guardarPronto();
    actualizarUI();
    const primero = IDS.find((id) => CAMPOS[id].opcionalPlegable === clave && indiceBloque(id) === abiertos);
    if (primero && sesion.controles[primero]) sesion.controles[primero].enfocar();
  }

  function abrirPlegableHasta(id) {
    const clave = CAMPOS[id].opcionalPlegable;
    estado.meta.plegables[clave] = Math.max(bloquesAbiertos(clave), indiceBloque(id) + 1);
  }

  // ─────────────────────────── Paso: retención ───────────────────────────

  function construirRetencion(cuerpo) {
    const preguntas = ['c1', 'c2', 'c3', 'c4'].filter((id) => CAMPOS[id]);
    const seccionPreguntas = h('section', { class: 'grupo', 'aria-labelledby': 'grupo-preguntas' },
      h('h3', { class: 'grupo-titulo', id: 'grupo-preguntas' }, 'Certificación para la retención en la fuente'),
      h('p', { class: 'grupo-intro' }, 'Responde Sí o No según tu situación.'),
      h('div', { class: 'preguntas' }, preguntas.map((id) =>
        crearCampo(id, { clase: 'pregunta', marcador: CAMPOS[id].label, ayuda: AYUDA_PREGUNTAS[CAMPOS[id].pregunta] }))));

    const checks = ['dedDependientes', 'dedHipotecario', 'dedSaludNoPos'].filter((id) => CAMPOS[id]);
    const gruposSub = { dedDependientes: 'Dependiente', dedHipotecario: 'Crédito hipotecario', dedSaludNoPos: 'Salud no POS' };
    const seccionDeducciones = h('section', { class: 'grupo', 'aria-labelledby': 'grupo-deducciones' },
      h('h3', { class: 'grupo-titulo', id: 'grupo-deducciones' }, 'Disminución de la base de retención'),
      h('p', { class: 'grupo-intro' }, '¿Quieres disminuir tu base de retención? Marca lo que aplique en tu caso; si nada aplica, sigue adelante.'));
    for (const id of checks) {
      seccionDeducciones.append(crearCampo(id));
      const sub = camposDelPaso('retencion').filter((c) => CAMPOS[c].grupo === gruposSub[id]);
      if (sub.length) seccionDeducciones.append(h('div', { class: 'subformulario', 'data-de': id }, construirRejilla(sub), crearSoportes(SOPORTE_DE_CHECK[id])));
    }
    seccionDeducciones.append(h('p', { class: 'nota-certificados', id: 'nota-certificados', hidden: true }, icono('info'), h('span', null)));
    const anexos = camposDelPaso('retencion').filter((c) => CAMPOS[c].grupo === 'Anexos');
    if (anexos.length) seccionDeducciones.append(h('div', { class: 'anexos' }, construirRejilla(anexos)));

    const ahorro = h('section', { class: 'grupo', 'aria-labelledby': 'grupo-ahorro' },
      h('h3', { class: 'grupo-titulo', id: 'grupo-ahorro' }, 'Ahorro para vivienda y pensiones voluntarias'));
    const bloquesAhorro = [['afc', ['afcEntidad', 'afcNit', 'afcValor']], ['pensionesVoluntarias', ['pvEntidad', 'pvNit', 'pvValor']]];
    for (const [pregunta, hijos] of bloquesAhorro) {
      if (!CAMPOS[pregunta]) continue;
      ahorro.append(crearCampo(pregunta, { clase: 'pregunta-simple' }));
      const sub = hijos.filter((c) => CAMPOS[c]);
      if (sub.length) ahorro.append(h('div', { class: 'subformulario', 'data-de': pregunta }, construirRejilla(sub, null, { sinParentesis: true })));
    }

    // Campos del paso que no estén en la composición anterior (por si el esquema crece).
    const usados = new Set();
    const compuestos = [seccionPreguntas, seccionDeducciones, ahorro];
    compuestos.forEach((s) => s.querySelectorAll('[data-campo]').forEach((el) => usados.add(el.dataset.campo)));
    const restantes = camposDelPaso('retencion').filter((id) => !usados.has(id));
    cuerpo.append(...compuestos);
    if (restantes.length) cuerpo.append(construirGrupo('Otros datos', restantes));
  }

  // ─────────────────────────── Soportes adjuntos ───────────────────────────
  //
  // La certificación bancaria (paso Pagos) y los certificados de cada deducción se guardan dentro del archivo
  // (soportes.js): al reabrirlo siguen ahí. Se validan por contenido (PDF, JPG o PNG) y con límites de tamaño.

  // La certificación bancaria siempre es obligatoria; el soporte de cada deducción, cuando se marca.
  const SOPORTES = {
    banco: { paso: 'pagos', titulo: 'Certificación bancaria', falta: 'certificación bancaria',
      descripcion: 'Expedida por tu banco a tu nombre, con el mismo número y tipo de cuenta que escribiste arriba.' },
    dependientes: { paso: 'retencion', titulo: 'Soportes del dependiente', falta: 'soportes del dependiente',
      descripcion: 'Registro civil, certificado de estudio o de dependencia económica, según el motivo.' },
    hipotecario: { paso: 'retencion', titulo: 'Certificado de intereses', falta: 'certificado de intereses del crédito hipotecario',
      descripcion: 'Certificado de la entidad financiera con los intereses pagados.' },
    saludNoPos: { paso: 'retencion', titulo: 'Certificado de salud no POS', falta: 'certificado de salud no POS',
      descripcion: 'Certificado de la medicina prepagada o del plan complementario con lo que pagaste.' },
  };
  const SOPORTE_DE_CHECK = { dedDependientes: 'dependientes', dedHipotecario: 'hipotecario', dedSaludNoPos: 'saludNoPos' };

  // En la validación cada soporte es un "campo" 'soporte:clave' de su paso (sin control en sesion.controles).
  const campoSoporte = (clave) => 'soporte:' + clave;
  const claveSoporte = (campo) => (/^soporte:/.test(String(campo)) ? String(campo).slice(8) : '');

  function soportesRequeridos() {
    if (!S) return [];
    return ['banco'].concat(Object.keys(SOPORTE_DE_CHECK).filter((c) => estado.s[c] === 'SI').map((c) => SOPORTE_DE_CHECK[c]));
  }

  const faltaSoporte = (clave) => soportesRequeridos().includes(clave) && !(estado.soportes[clave] || []).length;

  function faltantesSoportes() {
    return soportesRequeridos().filter(faltaSoporte)
      .map((c) => ({ campo: campoSoporte(c), step: SOPORTES[c].paso, mensaje: 'Falta adjuntar: ' + SOPORTES[c].falta }));
  }
  const ACEPTA_SOPORTES = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
  const errorSoportes = {}; // clave -> mensaje del último intento (no se guarda)

  const limitesSoportes = () => (S ? S.limites(CFG) : null);
  const extensionDe = (tipo) => ({ 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' }[tipo] || '');

  function crearSoportes(clave) {
    const info = SOPORTES[clave];
    const inputId = 'soporte-' + clave;
    const tituloId = inputId + '-titulo';
    const bloque = h('div', { class: 'soportes', 'data-soporte': clave, role: 'group', 'aria-labelledby': tituloId });
    if (!S) return bloque;
    const input = h('input', { type: 'file', id: inputId, class: 'sr-only', accept: ACEPTA_SOPORTES, multiple: true });
    input.addEventListener('change', () => {
      const archivos = Array.from(input.files || []);
      input.value = '';
      if (archivos.length) agregarSoportes(clave, archivos);
    });
    bloque.addEventListener('dragover', (e) => { e.preventDefault(); bloque.classList.add('arrastrando'); });
    bloque.addEventListener('dragleave', (e) => { if (!bloque.contains(e.relatedTarget)) bloque.classList.remove('arrastrando'); });
    bloque.addEventListener('drop', (e) => {
      e.preventDefault();
      bloque.classList.remove('arrastrando');
      const archivos = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (archivos.length) agregarSoportes(clave, archivos);
    });
    agregarHijos(bloque, [
      h('p', { class: 'soportes-titulo', id: tituloId }, info.titulo),
      h('p', { class: 'soportes-desc' }, info.descripcion),
      h('ul', { class: 'soportes-lista' }),
      h('p', { class: 'soportes-error', role: 'alert', hidden: true }),
      h('p', { class: 'soportes-falta', hidden: true }, icono('alerta'), h('span', null, 'Adjunta este documento para continuar.')),
      input,
      h('div', { class: 'soportes-pie' },
        h('label', { class: 'boton-agregar soportes-agregar', for: inputId }, icono('subir'), h('span', null)),
        h('span', { class: 'soportes-limite' })),
    ]);
    pintarSoportes(clave, bloque);
    return bloque;
  }

  function pintarSoportes(clave, bloqueEl) {
    const bloque = bloqueEl || document.querySelector('.soportes[data-soporte="' + clave + '"]');
    if (!bloque || !S) return;
    const lista = estado.soportes[clave] || [];
    const lim = limitesSoportes();
    const ul = bloque.querySelector('.soportes-lista');
    ul.textContent = '';
    for (const item of lista) {
      ul.append(h('li', { class: 'soporte' },
        icono('archivoOk', 'icono soporte-icono'),
        h('span', { class: 'soporte-datos' },
          h('span', { class: 'soporte-nombre', title: item.nombre }, item.nombre),
          h('span', { class: 'soporte-meta' }, extensionDe(item.tipo) + ' · ' + S.tamanoTexto(item.bytes))),
        h('span', { class: 'soporte-acciones' },
          h('button', { type: 'button', class: 'enlace', onclick: () => verSoporte(item), 'aria-label': 'Ver ' + item.nombre }, 'Ver'),
          h('button', { type: 'button', class: 'enlace enlace--discreto', onclick: () => quitarSoporte(clave, item.id), 'aria-label': 'Quitar ' + item.nombre }, 'Quitar'))));
    }
    ul.hidden = !lista.length;
    const error = bloque.querySelector('.soportes-error');
    error.textContent = '';
    if (errorSoportes[clave]) error.append(icono('alerta'), h('span', null, errorSoportes[clave]));
    error.hidden = !errorSoportes[clave];
    const agregar = bloque.querySelector('.soportes-agregar');
    agregar.hidden = lista.length >= lim.maxPorTipo;
    agregar.querySelector('span').textContent = lista.length ? 'Adjuntar otro archivo' : 'Adjuntar archivo';
    const usado = S.totalBytes(estado.soportes);
    bloque.querySelector('.soportes-limite').textContent = 'PDF, JPG o PNG · hasta ' + S.tamanoTexto(lim.maxArchivo) + ' por archivo' +
      (usado ? ' · usas ' + S.tamanoTexto(usado) + ' de ' + S.tamanoTexto(lim.maxTotal) : '');
    pintarFaltaSoporte(clave, bloque);
  }

  /** "Adjunta este documento para continuar": como "Falta este dato", solo después de dejar el paso o intentar avanzar. */
  function pintarFaltaSoporte(clave, bloque) {
    const mostrar = faltaSoporte(clave) && sesion.vistos.has(campoSoporte(clave));
    bloque.classList.toggle('con-falta', mostrar);
    bloque.querySelector('.soportes-falta').hidden = !mostrar;
  }

  function enfocarSoporte(clave) {
    const bloque = document.querySelector('.soportes[data-soporte="' + clave + '"]');
    if (!bloque) return false;
    bloque.scrollIntoView({ block: 'center', behavior: movimientoReducido() ? 'auto' : 'smooth' });
    const input = bloque.querySelector('input[type="file"]');
    if (input) input.focus({ preventScroll: true });
    return true;
  }

  /** Repinta todos los bloques de soportes (el total usado se muestra en cada uno) y lo que depende de ellos (pendientes del paso). */
  function pintarTodosSoportes() {
    document.querySelectorAll('.soportes[data-soporte]').forEach((b) => pintarSoportes(b.dataset.soporte, b));
    actualizarUI();
  }

  async function agregarSoportes(clave, archivos) {
    if (!S) return;
    const lim = limitesSoportes();
    const errores = [];
    const agregados = [];
    for (const f of archivos) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const item = await S.leer(f, lim);
        const error = S.comprobar(estado.soportes, clave, item, lim);
        if (error) throw error;
        estado.soportes = Object.assign({}, estado.soportes, { [clave]: (estado.soportes[clave] || []).concat(item) });
        agregados.push(item.nombre);
      } catch (e) {
        if (!e || !e.codigo) avisarUnaVez('Soportes.leer', e);
        errores.push(e && e.codigo ? e.message : 'No pudimos adjuntar «' + (f && f.name) + '». Intenta de nuevo.');
      }
    }
    errorSoportes[clave] = errores.join(' ');
    pintarTodosSoportes();
    if (!agregados.length) return;
    await respaldarSoportes();
    guardarPronto();
    anunciar(agregados.length === 1 ? 'Adjuntamos ' + agregados[0] + '.' : 'Adjuntamos ' + agregados.length + ' archivos.');
  }

  function quitarSoporte(clave, idItem) {
    const lista = estado.soportes[clave] || [];
    const i = lista.findIndex((x) => x.id === idItem);
    if (i < 0) return;
    const quitado = lista[i];
    const resto = lista.filter((x) => x.id !== idItem);
    estado.soportes = Object.assign({}, estado.soportes);
    if (resto.length) estado.soportes[clave] = resto; else delete estado.soportes[clave];
    errorSoportes[clave] = '';
    pintarTodosSoportes();
    respaldarSoportes();
    guardarPronto();
    toast('Quitamos «' + quitado.nombre + '».', {
      accion: 'Deshacer',
      alAccionar: () => {
        const actual = estado.soportes[clave] || [];
        if (actual.some((x) => x.id === quitado.id)) return;
        const copia = actual.slice();
        copia.splice(Math.min(i, copia.length), 0, quitado);
        estado.soportes = Object.assign({}, estado.soportes, { [clave]: copia });
        pintarTodosSoportes();
        respaldarSoportes();
        guardarPronto();
      },
    });
  }

  function verSoporte(item) {
    try {
      const url = URL.createObjectURL(S.aBlob(item));
      const a = h('a', { href: url, target: '_blank', rel: 'noopener', hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      avisarUnaVez('Soportes.ver', e);
      toast('No pudimos abrir este archivo.', { tono: 'error' });
    }
  }

  function descargarSoporte(item) {
    try { descargarBlob(S.aBlob(item), item.nombre); } catch (e) {
      avisarUnaVez('Soportes.descargar', e);
      toast('No pudimos descargar este archivo.', { tono: 'error' });
    }
  }

  /** Revisión: los soportes adjuntos de lo que aplica, para descargarlos (los que faltan van en Pendientes). */
  function construirSoportesRevision() {
    if (!S) return null;
    const claves = soportesRequeridos().filter((c) => (estado.soportes[c] || []).length);
    if (!claves.length) return null;
    return h('section', { class: 'grupo', 'aria-labelledby': 'rev-soportes' },
      h('h3', { class: 'grupo-titulo', id: 'rev-soportes' }, 'Soportes adjuntos'),
      h('p', { class: 'grupo-intro' }, 'Quedan guardados en este archivo. Descárgalos para enviarlos junto con el PDF firmado.'),
      h('ul', { class: 'soportes-lista soportes-lista--revision' }, claves.flatMap((c) => estado.soportes[c].map((item) =>
        h('li', { class: 'soporte' },
          icono('archivoOk', 'icono soporte-icono'),
          h('span', { class: 'soporte-datos' },
            h('span', { class: 'soporte-nombre', title: item.nombre }, item.nombre),
            h('span', { class: 'soporte-meta' }, SOPORTES[c].titulo + ' · ' + extensionDe(item.tipo) + ' · ' + S.tamanoTexto(item.bytes))),
          h('span', { class: 'soporte-acciones' },
            h('button', { type: 'button', class: 'enlace', onclick: () => verSoporte(item), 'aria-label': 'Ver ' + item.nombre }, 'Ver'),
            h('button', { type: 'button', class: 'enlace', onclick: () => descargarSoporte(item), 'aria-label': 'Descargar ' + item.nombre }, 'Descargar')))))));
  }

  // ─────────────────────────── Actualización de la interfaz ───────────────────────────

  function actualizarUI() {
    const v = validar();
    const d = derivar();
    sesion.validacion = v;
    sesion.derivados = d;
    const paso = PASOS[estado.meta.paso];
    actualizarCampos(v, paso);
    actualizarCalculados(d);
    actualizarSugerencias();
    actualizarPlegables();
    actualizarGrupos();
    document.querySelectorAll('.soportes[data-soporte]').forEach((b) => pintarFaltaSoporte(b.dataset.soporte, b));
    actualizarResumenPaso(v, paso, d);
    pintarStepper(v);
    pintarGuardado();
  }

  function actualizarCampos(v, paso) {
    const faltan = new Map(v.faltantes.map((f) => [f.campo, f]));
    const visitado = !!estado.meta.visitados[paso.id];
    for (const [id, c] of Object.entries(sesion.controles)) {
      const f = CAMPOS[id];
      const visible = visibleEn(id, estado.s) && plegableVisible(id);
      if (c.cont.hidden === visible) {
        c.cont.hidden = !visible;
        if (visible) animarEntrada(c.cont);
      }
      if (!visible) continue;

      const opcional = c.cont.querySelector(':scope > .etiqueta .opcional');
      if (opcional) opcional.hidden = requeridoEn(id, estado.s) || f.type === 'check';

      const error = v.errores[id];
      const mostrarError = !!error && (sesion.tocados.has(id) || visitado);
      // "Falta este dato" solo en campos que la persona ya vio y dejó atrás (no en un bloque recién abierto).
      const falta = faltan.get(id);
      const mostrarFalta = !error && !!falta && sesion.vistos.has(id);
      const msg = c.cont.querySelector(':scope > .mensaje');
      if (msg) {
        msg.hidden = !(mostrarError || mostrarFalta);
        msg.className = 'mensaje ' + (mostrarError ? 'mensaje--error' : 'mensaje--pendiente');
        // Con algo escrito (p. ej. valor 0 donde se pide mayor que cero) se explica qué falta.
        const conValor = mostrarFalta && (falta.conValor || !!estado.s[id]);
        msg.textContent = mostrarError ? String(error) : mostrarFalta ? (conValor ? String(falta.mensaje || 'Revisa este dato.') : 'Falta este dato.') : '';
      }
      const cid = idControl(id);
      const describe = [f.ayuda || c.cont.querySelector(':scope > .ayuda-campo') ? cid + '-ayuda' : '', (mostrarError || mostrarFalta) ? cid + '-msg' : '']
        .filter((x) => x && document.getElementById(x)).join(' ');
      c.describir(describe);
      c.invalido(mostrarError);
      if (c.cont.tagName === 'FIELDSET') {
        if (describe) c.cont.setAttribute('aria-describedby', describe); else c.cont.removeAttribute('aria-describedby');
        if (mostrarError) c.cont.setAttribute('aria-invalid', 'true'); else c.cont.removeAttribute('aria-invalid');
      }
      c.cont.classList.toggle('con-error', mostrarError);
      c.cont.classList.toggle('con-falta', mostrarFalta);
    }
  }

  function animarEntrada(el) {
    if (movimientoReducido()) return;
    el.classList.remove('revelado');
    void el.offsetWidth;
    el.classList.add('revelado');
  }

  function actualizarCalculados(d) {
    document.querySelectorAll('.calculado[data-ancla]').forEach((cont) => {
      const ancla = cont.dataset.ancla;
      const anclaVisible = visibleEn(ancla, estado.s);
      let alguno = false;
      cont.querySelectorAll('.calculado-item').forEach((p) => {
        const def = CALCULADOS[ancla][Number(p.dataset.i)];
        let valor = '';
        try { valor = def.valor(d, estado.s) || ''; } catch (e) { valor = ''; }
        p.hidden = !valor;
        p.querySelector('.calculado-valor').textContent = valor;
        if (valor) alguno = true;
      });
      const mostrar = anclaVisible && alguno;
      if (cont.hidden === mostrar) { cont.hidden = !mostrar; if (mostrar) animarEntrada(cont); }
    });
    const nota = document.getElementById('nota-certificados');
    if (nota) {
      const anio = d.anioCertificados || anioCertificadosLocal();
      const vig = d.anioVigenciaCertificados || (Number(anio) + 2);
      nota.querySelector('span').textContent = 'Adjunta los certificados con corte al 31 de diciembre de ' + anio +
        '. Estarán vigentes hasta el 14 de abril de ' + vig + '; después de esa fecha ya no tendrán efecto en la retención.';
      const alguna = ['dedDependientes', 'dedHipotecario', 'dedSaludNoPos'].some((k) => estado.s[k] === 'SI');
      if (nota.hidden === alguna) { nota.hidden = !alguna; if (alguna) animarEntrada(nota); }
    }
  }

  /** [ícono, texto…] → [ícono, <span> con el texto]: el texto fluye junto al ícono. */
  function conIcono(partes) {
    const primero = partes[0];
    const esIcono = !!primero && primero.nodeType === 1 && String(primero.getAttribute('class') || '').split(' ').some((c) => c.startsWith('icono'));
    return esIcono && partes.length > 1 ? [primero, h('span', { class: 'sugerencia-texto' }, ...partes.slice(1))] : partes;
  }

  function ponerSugerencia(id, partes, estilo) {
    const c = sesion.controles[id];
    if (!c) return;
    const caja = c.cont.querySelector(':scope > .sugerencia:not(.conflicto)');
    if (!caja) return;
    caja.classList.toggle('sugerencia--tarjeta', estilo === 'tarjeta');
    const firma = partes ? JSON.stringify(partes.map((p) => (p instanceof Node ? p.textContent : p))) : '';
    if (caja.dataset.firma === firma) return; // evita repintar y perder el foco del botón
    caja.dataset.firma = firma;
    caja.textContent = '';
    if (!partes) { caja.hidden = true; return; }
    agregarHijos(caja, conIcono(partes));
    caja.hidden = false;
  }

  let arlIndice = null;
  function arlPorCodigo(codigo) {
    if (!arlIndice) arlIndice = new Map((CAT.arl || []).map((o) => [String(o.codigo), o]));
    return arlIndice.get(String(codigo)) || null;
  }

  function botonUsar(texto, accion) {
    return h('button', { type: 'button', class: 'enlace enlace--fuerte', onclick: accion }, texto);
  }

  const NOMBRE_FUENTE = { RUT: 'Tu RUT', RIT: 'Tu RIT', SECOP: 'SECOP II', Sugerido: 'La sugerencia' };

  /** "Tu RUT dice: X · Usar este · Ignorar" debajo de los campos donde se conservó lo escrito a mano. */
  function actualizarConflictos() {
    for (const [id, c] of Object.entries(sesion.controles)) {
      const caja = c.cont.querySelector(':scope > .conflicto');
      if (!caja) continue;
      const conf = estado.meta.conflictos[id];
      const mostrar = !!conf && conf.valor !== (estado.s[id] || '');
      const firma = mostrar ? conf.fuente + '|' + conf.valor + '|' + conf.dudoso : '';
      if (caja.dataset.firma === firma) continue;
      caja.dataset.firma = firma;
      caja.textContent = '';
      caja.hidden = !mostrar;
      if (!mostrar) continue;
      const quien = NOMBRE_FUENTE[conf.fuente] || conf.fuente;
      agregarHijos(caja, conIcono([icono('info', 'icono-mini'), quien + (conf.dudoso ? ' parece decir: ' : ' dice: '),
        h('strong', null, mostrarValor(id, conf.valor)), ' · ',
        botonUsar('Usar este', () => usarConflicto(id)), ' · ',
        h('button', { type: 'button', class: 'enlace enlace--discreto', onclick: () => ignorarConflicto(id) }, 'Ignorar')]));
    }
  }

  function actualizarSugerencias() {
    const s = estado.s;
    actualizarConflictos();

    // Teléfono 1 = 0 porque el RUT no trae un fijo (así lo pide el instructivo del formato).
    if (sesion.controles.telefono1) {
      const rut = estado.meta.docs.RUT;
      ponerSugerencia('telefono1', rut && rut.sinFijo && s.telefono1 === '0' && estado.meta.fuentes.telefono1 === 'RUT'
        ? [icono('info', 'icono-mini'), ' Tu RUT no registra teléfono fijo; dejamos 0 como indica el formato. Cámbialo si tienes uno.']
        : null);
    }

    // Datos del contrato tomados de SECOP II: cómo se obtuvieron (y el número del contrato, que SECOP no trae).
    const contrato = contratoElegido();
    const notasSecop = contrato && modulo('Secop', 'aCampos') ? window.Secop.aCampos(contrato).notas : {};
    for (const id of ['valorMensual', 'areaFuncional']) {
      if (!sesion.controles[id]) continue;
      ponerSugerencia(id, notasSecop[id] && estado.meta.fuentes[id] === 'SECOP' ? [icono('info', 'icono-mini'), ' ' + notasSecop[id]] : null);
    }
    if (sesion.controles.numeroContrato) {
      ponerSugerencia('numeroContrato', notasSecop.numeroContrato ? [icono('info', 'icono-mini'), ' ' + notasSecop.numeroContrato] : null);
    }

    // DV calculado a partir del NIT.
    if (sesion.controles.dv) {
      const calc = s.nit && s.nit.length >= 3 ? dvCalculado(s.nit) : '';
      if (calc && s.dv !== calc) {
        const usar = () => { cambiar('dv', calc, 'auto'); sincronizar('dv'); tocar('dv'); };
        ponerSugerencia('dv', s.dv
          ? [botonUsar('Usar el DV calculado (' + calc + ')', usar)]
          : ['Según tu NIT, tu DV es ' + calc + '. ', botonUsar('Usar', usar)]);
      } else ponerSugerencia('dv', null);
    }

    // Actividad RIT: las del certificado RIT (si trae varias) o, sin RIT, las que corresponden al CIIU del RUT.
    if (sesion.controles.actividadRit) {
      const delRit = (estado.meta.docs.RIT && estado.meta.docs.RIT.alternativas) || [];
      const sugeridas = sugerenciaRit(s);
      const usar = (o) => () => { cambiar('actividadRit', o.valor, 'Sugerido'); sincronizar('actividadRit'); tocar('actividadRit'); };
      const usarDelRit = (o) => () => { cambiar('actividadRit', o.valor, 'RIT'); sincronizar('actividadRit'); tocar('actividadRit'); };
      const otras = delRit.filter((o) => o.valor !== s.actividadRit);
      if (delRit.length && otras.length) {
        ponerSugerencia('actividadRit', [h('span', { class: 'sugerencia-texto' }, s.actividadRit
          ? 'Tu RIT tiene más actividades. Dejamos la principal; si en el contrato realizas otra, elígela:'
          : 'Elige la actividad de tu RIT que realizas en el contrato:'),
        h('ul', { class: 'sugerencia-lista' }, otras.slice(0, 8).map((o) => h('li', null,
          h('span', null, o.texto), botonUsar('Usar', usarDelRit(o)))))], 'tarjeta');
      } else if (delRit.length) {
        ponerSugerencia('actividadRit', null);
      } else if (sugeridas.length === 1) {
        const sug = sugeridas[0];
        ponerSugerencia('actividadRit', [h('span', { class: 'pill pill--sugerido' }, 'Sugerido'),
          h('span', { class: 'sugerencia-texto' }, 'Según tu RUT podría ser ', h('strong', null, textoOpcion(sug)), '. Confírmalo con tu RIT.'),
          botonUsar('Usar esta actividad', usar(sug))], 'tarjeta');
      } else if (sugeridas.length > 1) {
        ponerSugerencia('actividadRit', [h('span', { class: 'pill pill--sugerido' }, 'Sugerido'),
          h('span', { class: 'sugerencia-texto' }, 'Según tu RUT podría ser una de estas; elige la que realizas en el contrato y confírmala con tu RIT:'),
          h('ul', { class: 'sugerencia-lista' }, sugeridas.slice(0, 6).map((o) => h('li', null,
            h('span', null, textoOpcion(o)), botonUsar('Usar', usar(o)))))], 'tarjeta');
      } else ponerSugerencia('actividadRit', null);
    }

    // Daviplata: el número de cuenta es el celular.
    if (sesion.controles.numeroCuenta) {
      if (s.tipoCuenta === 'Daviplata') {
        const cel = s.telefono2;
        const partes = ['En Daviplata, el número de cuenta es tu número de celular.'];
        if (cel && cel !== s.numeroCuenta) {
          partes.push(' ', botonUsar('Usar ' + cel, () => { cambiar('numeroCuenta', cel, 'auto'); sincronizar('numeroCuenta'); tocar('numeroCuenta'); }));
        }
        ponerSugerencia('numeroCuenta', partes);
      } else ponerSugerencia('numeroCuenta', null);
    }

    // RUT y RIT con direcciones distintas: la nota acompaña al campo donde se corrige (mientras siga la del RUT).
    if (sesion.controles.direccion) {
      const dirRit = cruceDocumentos().dirRit;
      const nota = dirRit && normDireccion(s.direccion) !== normDireccion(dirRit)
        ? ' Tu RIT registra otra dirección (' + dirRit + '). Si cambiaste de dirección, recuerda actualizar el registro que esté desactualizado.'
        : '';
      ponerSugerencia('direccion', nota ? [icono('info', 'icono-mini'), nota] : null);
    }

    // Código ARL que existe en la tabla del Excel pero no en su lista desplegable (AX50): se acepta, con una nota.
    if (sesion.controles.codigoArl) {
      const arl = s.codigoArl ? arlPorCodigo(s.codigoArl) : null;
      ponerSugerencia('codigoArl', arl && arl.enListaExcel === false
        ? [icono('info', 'icono-mini'), ' Este código no aparece en la lista desplegable del Excel original. Confírmalo con tu certificado de afiliación a la ARL.']
        : null);
    }

    // Motivo del dependiente: la opción es corta; aquí va el texto completo del formato.
    if (sesion.controles.depMotivo) {
      const o = buscarOpcion('depMotivo', s.depMotivo);
      ponerSugerencia('depMotivo', o && o.detalle ? [h('span', { class: 'sugerencia-detalle' }, 'En el formato: «' + o.detalle + '»')] : null);
    }

    // C3 leído del RUT (responsabilidad 47): la nota reemplaza la ayuda general.
    if (sesion.controles.c3) {
      const desdeRut = estado.meta.fuentes.c3 === 'RUT' && !!s.c3;
      const ayudaC3 = sesion.controles.c3.cont.querySelector(':scope > .ayuda-campo');
      if (ayudaC3) ayudaC3.hidden = desdeRut;
      if (desdeRut) {
        ponerSugerencia('c3', [icono('archivoOk', 'icono-mini'), s.c3 === 'SI'
          ? ' Según tu RUT tienes la responsabilidad 47 (Régimen Simple de Tributación).'
          : ' Según tu RUT no tienes la responsabilidad 47 (Régimen Simple de Tributación).']);
      } else ponerSugerencia('c3', null);
    }
  }

  function actualizarPlegables() {
    document.querySelectorAll('.boton-agregar[data-plegable]').forEach((b) => {
      const clave = b.dataset.plegable;
      b.hidden = bloquesAbiertos(clave) >= bloquesPlegable(clave).length;
    });
  }

  function actualizarGrupos() {
    document.querySelectorAll('.paso-cuerpo .subformulario, .paso-cuerpo .anexos, .paso-cuerpo .grupo').forEach((g) => {
      const campos = g.querySelectorAll('[data-campo]');
      if (!campos.length) return;
      const alguno = Array.from(campos).some((c) => !c.hidden);
      if (g.hidden === alguno) { g.hidden = !alguno; if (alguno) animarEntrada(g); }
    });
  }

  function actualizarResumenPaso(v, paso, d) {
    const resumen = document.getElementById('resumen-paso');
    const avisos = document.getElementById('avisos-paso');
    if (avisos) {
      const lista = advertenciasVisibles(v).filter((a) => a.step === paso.id || (a.campo && pasoDeCampo(a.campo) === paso.id));
      if (d && d.alertaIva && paso.id === 'contrato' && !lista.some((a) => a.codigo === 'IVA_CUANTIA')) {
        lista.push({ mensaje: 'Tu régimen es «No responsable de IVA», pero por la cuantía el contrato tendría IVA. Verifica tu responsabilidad de IVA.' });
      }
      avisos.textContent = '';
      avisos.hidden = !lista.length;
      for (const a of lista) avisos.append(h('p', { class: 'aviso' }, icono('alerta'), h('span', null, textoAdvertencia(a))));
    }
    if (!resumen) return;
    const visitado = !!estado.meta.visitados[paso.id];
    const propios = listaPendientes(v).filter((p) => p.step === paso.id);
    // Lo que está mal escrito se cuenta aparte de lo que falta: no es lo mismo "falta" que "hay que corregir".
    const nError = propios.filter((p) => p.tipo === 'error' && (visitado || sesion.tocados.has(p.campo))).length;
    const nFalta = propios.filter((p) => p.tipo === 'falta').length;
    resumen.textContent = '';
    if (!propios.length) {
      if (sesion.bloqueo === paso.id) sesion.bloqueo = '';
      resumen.className = 'resumen-paso resumen-paso--ok';
      resumen.append(icono('check'), h('span', null, 'Esta sección está completa.'));
      resumen.hidden = !tienePasoDatos(paso.id);
      return;
    }
    const partes = [];
    if (sesion.bloqueo === paso.id) {
      resumen.className = 'resumen-paso resumen-paso--error';
      resumen.append(icono('alerta'), h('span', null, 'Para continuar, completa los datos marcados' +
        (propios.length > 1 ? ' (' + propios.length + ' pendientes).' : '.')));
      resumen.hidden = false;
      return;
    }
    if (nError) partes.push(nError === 1 ? 'Hay 1 dato por corregir.' : 'Hay ' + nError + ' datos por corregir.');
    if (nFalta && visitado) {
      partes.push((nFalta === 1 ? 'Falta 1 dato' : 'Faltan ' + nFalta + ' datos') + ' en esta sección. Puedes completar' +
        (nFalta === 1 ? 'lo' : 'los') + ' ahora o más adelante.');
    }
    resumen.className = 'resumen-paso' + (nError ? ' resumen-paso--error' : '');
    resumen.append(h('span', null, partes.join(' ')));
    resumen.hidden = !partes.length;
  }

  /** Advertencias para la persona: sin las internas (notas de mantenimiento del Excel, van a la consola). */
  function advertenciasVisibles(v) {
    const lista = [];
    for (const a of (v && v.advertencias) || []) {
      if (!a) continue;
      if (a.interna) { avisarUnaVez('advertencia interna ' + (a.codigo || ''), a.mensaje); continue; }
      lista.push(a);
    }
    return lista;
  }

  /** Texto amable de una advertencia de Calc (el detalle explica; el mensaje es el texto del Excel). */
  function textoAdvertencia(a) {
    if (!a || typeof a !== 'object') return String(a || '');
    if (a.codigo === 'IVA_CUANTIA' && a.detalle) return 'Revisa tu responsabilidad de IVA. ' + a.detalle;
    return a.detalle || a.mensaje || '';
  }

  function tienePasoDatos(idPaso) {
    return camposDelPaso(idPaso).some((id) => estado.s[id] && estado.s[id] !== String(CAMPOS[id].porDefecto || ''));
  }

  // ─────────────────────────── Paso: documentos ───────────────────────────
  //
  // Solo se cargan el RUT y el RIT. Lo leído pasa de inmediato al formulario y se revisa en cada paso
  // (Personales, Contacto, Tributario). Los avisos generales del documento van debajo de su zona.

  const INFO_DOC = {
    RUT: { titulo: 'Tu RUT', nombre: 'Registro Único Tributario', entidad: 'DIAN', opcional: false },
    RIT: { titulo: 'Tu RIT', nombre: 'Registro de Información Tributaria', entidad: 'Secretaría Distrital de Hacienda', opcional: true },
  };

  function construirDocumentos(cuerpo) {
    const zonas = h('div', { class: 'zonas' }, crearZona('RUT'), crearZona('RIT'));
    cuerpo.append(zonas);
  }

  function crearZona(tipo) {
    const info = INFO_DOC[tipo];
    const inputId = 'archivo-' + tipo;
    const input = h('input', { type: 'file', id: inputId, class: 'sr-only zona-input', accept: 'application/pdf,.pdf', multiple: true });
    const zona = h('label', { class: 'zona', for: inputId, 'data-tipo': tipo });
    // Las notas del documento van debajo de la zona (no dentro del <label> del archivo).
    const pie = h('div', { class: 'zona-pie', hidden: true });
    const envoltura = h('div', { class: 'zona-envoltura' }, input, zona, pie);
    input.addEventListener('change', () => {
      const archivos = Array.from(input.files || []);
      input.value = '';
      if (archivos.length) procesarArchivos(archivos, tipo);
    });
    let profundidad = 0;
    zona.addEventListener('dragenter', (e) => { e.preventDefault(); profundidad++; zona.classList.add('arrastrando'); });
    zona.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    zona.addEventListener('dragleave', () => { profundidad = Math.max(0, profundidad - 1); if (!profundidad) zona.classList.remove('arrastrando'); });
    zona.addEventListener('drop', (e) => {
      e.preventDefault();
      profundidad = 0;
      zona.classList.remove('arrastrando');
      const archivos = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (archivos.length) procesarArchivos(archivos, tipo);
    });
    pintarZona(tipo, zona, info);
    return envoltura;
  }

  function pintarZona(tipo, zonaEl, infoDoc) {
    const zona = zonaEl || document.querySelector('.zona[data-tipo="' + tipo + '"]');
    if (!zona) return;
    const info = infoDoc || INFO_DOC[tipo];
    const z = sesion.zonas[tipo];
    const doc = estado.meta.docs[tipo];
    let est = z.estado;
    if (est === 'idle' && doc) est = 'aplicado';
    zona.dataset.estado = est;
    zona.textContent = '';
    pintarPieZona(tipo, zona.parentElement, est);
    const titulo = h('span', { class: 'zona-titulo' }, info.titulo, info.opcional ? h('span', { class: 'zona-opcional' }, 'Opcional') : null);
    switch (est) {
      case 'leyendo':
        zona.append(h('span', { class: 'zona-icono', html: svgIcono('girando', 'icono girando') }),
          h('span', { class: 'zona-titulo' }, 'Leyendo tu documento…'),
          h('span', { class: 'zona-sub zona-archivo' }, z.archivo || ''),
          h('span', { class: 'zona-sub zona-progreso' }));
        zona.setAttribute('aria-busy', 'true');
        return;
      case 'aplicado': {
        const n = doc.aplicados || 0;
        const estadoTexto = n ? 'Usamos ' + plural(n, 'dato', 'datos') + ' en el formulario'
          : tipo === 'RIT' && doc.alternativas.length ? 'Elige tu actividad en el paso Tributario'
            : 'Lo leímos, pero no encontramos datos para llenar';
        zona.append(h('span', { class: 'zona-icono', html: svgIcono('check') }), titulo,
          h('span', { class: 'zona-estado' }, estadoTexto),
          h('span', { class: 'zona-sub zona-archivo' }, doc.archivo || ''),
          h('span', { class: 'zona-accion' }, 'Cargar otro archivo'));
        break;
      }
      case 'error': {
        // Si había un documento leído antes, se dice que sigue en uso: un error nuevo no borra nada.
        zona.append(h('span', { class: 'zona-icono', html: svgIcono('alerta') }), titulo,
          h('span', { class: 'zona-error' }, z.mensaje || 'No pudimos leer este archivo.'),
          doc ? h('span', { class: 'zona-sub' }, 'Seguimos usando los datos de tu ' + tipo + ' anterior.') : null,
          h('span', { class: 'zona-accion' }, 'Intentar con otro archivo'));
        break;
      }
      default:
        zona.append(h('span', { class: 'zona-icono', html: svgIcono('subir') }), titulo,
          h('span', { class: 'zona-sub' }, info.nombre, h('br'), info.entidad),
          h('span', { class: 'zona-accion' },
            h('span', { class: 'solo-escritorio' }, 'Arrastra el PDF aquí o ', h('u', null, 'búscalo en tu equipo')),
            h('span', { class: 'solo-tactil' }, h('u', null, 'Elegir el PDF'))));
    }
    zona.removeAttribute('aria-busy');
  }

  /** Debajo de la zona: avisos generales del documento (antigüedad, documento de otra persona…). */
  function pintarPieZona(tipo, envoltura, est) {
    const pie = envoltura && envoltura.querySelector(':scope > .zona-pie');
    if (!pie) return;
    pie.textContent = '';
    const doc = estado.meta.docs[tipo];
    const avisos = est === 'aplicado' && doc ? avisosZona(tipo, doc) : [];
    const cruce = cruceDocumentos();
    if (tipo === 'RIT' && cruce.documentos) pie.append(h('p', { class: 'aviso', role: 'alert' }, icono('alerta'), h('span', null, cruce.documentos)));
    if (avisos.length) pie.append(listaAvisos(avisos));
    pie.hidden = !pie.childNodes.length;
  }

  /** Avisos que van en la zona: sin los que ya explica su campo (teléfono fijo) ni el cruce de documentos. */
  function avisosZona(tipo, doc) {
    let avisos = doc.avisos || [];
    if (tipo === 'RUT') avisos = avisos.filter((a) => !/no registra tel[eé]fono fijo|no trae un tel[eé]fono fijo/i.test(a));
    if (tipo === 'RIT' && cruceDocumentos().documentos) avisos = avisos.filter((a) => !/otro documento/i.test(a));
    return avisos;
  }

  function errorCodigo(codigo, mensaje) {
    const e = new Error(mensaje || codigo);
    e.codigo = codigo;
    return e;
  }

  function mensajeError(e, tipo) {
    // Avisos del parser (RUT de persona jurídica, plantilla en blanco…): ya vienen redactados para la persona.
    if (e && e.mensajeUsuario) return e.mensajeUsuario;
    // PdfText redacta sus errores con el sitio de descarga del documento esperado (opts.documento).
    if (e && e.name === 'PdfTextError' && e.message) return e.message;
    const codigo = e && e.codigo;
    if (['NO_PDF', 'PROTEGIDO', 'SIN_TEXTO', 'TEXTO_ILEGIBLE'].includes(codigo) && modulo('PdfText', 'mensajeError')) {
      try { return window.PdfText.mensajeError(codigo, tipo === 'RIT' ? 'RIT' : 'RUT'); } catch (err) { /* mensaje local */ }
    }
    const doc = tipo === 'RIT' ? 'RIT' : 'RUT';
    const original = tipo === 'RIT'
      ? 'Descarga el certificado RIT original desde la Oficina Virtual de la Secretaría Distrital de Hacienda'
      : 'Descarga el RUT original desde los servicios en línea de la DIAN (MUISCA)';
    switch (codigo) {
      case 'NO_PDF': return 'Este archivo no es un PDF o está dañado. Sube el PDF de tu ' + doc + ' tal como lo descargaste.';
      case 'PROTEGIDO': return 'El PDF tiene contraseña y no podemos abrirlo. Descárgalo de nuevo sin contraseña o continúa llenando a mano.';
      case 'SIN_TEXTO': return 'Este PDF parece escaneado o es una foto, así que no podemos leer su texto. ' + original + ', o continúa a mano.';
      case 'TEXTO_ILEGIBLE': return 'El texto de este PDF no se puede leer (suele pasar con «Imprimir como PDF»). ' + original + ', o continúa a mano.';
      case 'LIB_NO_DISPONIBLE': return 'No pudimos cargar el lector de PDF en este navegador. Puedes continuar llenando el formulario a mano.';
      case 'RIT_SOLICITUD': return 'Ese PDF es el formulario de solicitud del RIT, no el certificado. Descárgalo en Oficina Virtual → Mi RIT → Certificado RIT.';
      case 'NO_RECONOCIDO': return 'No reconocemos este archivo como un RUT ni como un RIT. Verifica que sea el documento correcto.';
      case 'SIN_DATOS': return 'Leímos el documento, pero no encontramos datos que podamos usar. Puedes continuar a mano.';
      case 'PARSER_NO_DISPONIBLE': return 'La lectura automática del ' + doc + ' no está disponible en esta versión. Puedes continuar a mano.';
      default:
        return (e && e.codigo && e.message) ? e.message : 'No pudimos leer este archivo. Intenta con otro o continúa llenando a mano.';
    }
  }

  /** Tipos reconocidos en el PDF ('RUT' y/o 'RIT'; un mismo PDF puede traer ambos), el principal primero. */
  function detectarTipos(doc) {
    const out = [];
    const agregar = (t) => { if ((t === 'RUT' || t === 'RIT') && !out.includes(t)) out.push(t); };
    const dd = window.DocDetect;
    try { if (dd && typeof dd.tipo === 'function') agregar(dd.tipo(doc)); } catch (e) { avisarUnaVez('DocDetect.tipo', e); }
    try { if (dd && typeof dd.tipos === 'function') (dd.tipos(doc) || []).forEach(agregar); } catch (e) { avisarUnaVez('DocDetect.tipos', e); }
    if (!out.length) {
      try { if (modulo('RutParser', 'esRut') && window.RutParser.esRut(doc)) agregar('RUT'); } catch (e) { avisarUnaVez('RutParser.esRut', e); }
      try { if (modulo('RitParser', 'esRit') && window.RitParser.esRit(doc)) agregar('RIT'); } catch (e) { avisarUnaVez('RitParser.esRit', e); }
    }
    return out;
  }

  function esSolicitudRit(doc) {
    try { return !!(window.DocDetect && window.DocDetect.tipo(doc) === 'RIT_SOLICITUD'); } catch (e) { return false; }
  }

  async function procesarArchivos(archivos, tipo) {
    for (const archivoPdf of archivos.slice(0, 2)) {
      // eslint-disable-next-line no-await-in-loop
      await procesarArchivo(archivoPdf, tipo);
    }
  }

  function ponerZona(tipo, datos) {
    sesion.zonas[tipo] = datos;
    pintarZona(tipo);
  }

  function mostrarProgreso(tipo, leidas, total) {
    const z = sesion.zonas[tipo];
    if (!z || z.estado !== 'leyendo' || !(total > 1)) return;
    const el = document.querySelector('.zona[data-tipo="' + tipo + '"] .zona-progreso');
    if (el) el.textContent = 'Página ' + Math.min(leidas, total) + ' de ' + total;
  }

  /** Avisos de un Resultado de parser: textos no vacíos, sin repetir, en su orden. */
  function avisosDe(res) {
    const vistos = new Set();
    const out = [];
    for (const a of (res && Array.isArray(res.avisos) ? res.avisos : [])) {
      const t = String(a == null ? '' : a).replace(/\s+/g, ' ').trim();
      if (t && !vistos.has(t)) { vistos.add(t); out.push(t); }
    }
    return out;
  }

  /** Campos del Resultado que el esquema acepta de ese documento (C1, C2 y C4 nunca se pre-responden). */
  function camposAceptados(tipo, res) {
    const campos = (res && res.campos) || {};
    return Object.keys(campos).filter((k) => CAMPOS[k] && CAMPOS[k].fuente === tipo).sort((a, b) => ORDEN[a] - ORDEN[b]);
  }

  /** Valor de un campo de un Resultado (o ''). */
  const valorDe = (res, id) => {
    const c = res && res.campos && res.campos[id];
    return c && c.valor != null ? String(c.valor) : '';
  };

  /** Resultado del RUT leído en esta sesión que sirve para cruzar (persona natural con datos). */
  function rutDeSesion() {
    const r = sesion.resultados.RUT;
    return r && r.res && r.res.ok !== false ? r.res : null;
  }

  /**
   * Opciones para los parsers. RUT: el documento que ya está en el formulario (elige el RUT correcto en un
   * paquete y avisa si es de otra persona). RIT: el documento y la actividad del RUT recién leído (o los del
   * formulario) para elegir el certificado, avisar si es de otra persona y comparar la actividad principal.
   */
  function opcionesParser(tipo, rutRes) {
    const s = estado.s;
    const hoy = hoyLocal();
    if (tipo === 'RUT') return { documentoEsperado: s.numeroId || s.nit || '', hoy };
    const rut = rutRes || rutDeSesion();
    return {
      documentoEsperado: valorDe(rut, 'nit') || valorDe(rut, 'numeroId') || s.numeroId || s.nit || '',
      actividadRut: valorDe(rut, 'actividadRut') || s.actividadRut || '',
      hoy,
    };
  }

  /**
   * Actividades del RIT que se pueden elegir: las impresas que existen en la tabla del formulario
   * (a.codigo ya es el código del formulario) y, para códigos antiguos o desconocidos, sus equivalentes
   * posibles (a.candidatos). Nunca un código que no esté en CATALOGOS.rit.
   */
  function alternativasRit(extra) {
    const out = [];
    const agregar = (codigo, prefijo) => {
      const o = buscarOpcion('actividadRit', String(codigo == null ? '' : codigo).trim());
      if (!o || out.some((a) => a.valor === o.valor)) return;
      out.push({ valor: o.valor, texto: (prefijo ? prefijo + ' · ' : '') + textoOpcion(o) });
    };
    const actividades = extra && Array.isArray(extra.actividades) ? extra.actividades : [];
    for (const a of actividades) {
      if (!a || typeof a !== 'object') continue;
      const prefijo = a.orden ? 'Actividad ' + a.orden : '';
      if (a.enCatalogo !== false || a.codigoFormulario) agregar(a.codigoFormulario || a.codigo, prefijo);
      for (const c of Array.isArray(a.candidatos) ? a.candidatos : []) agregar(c && c.codigo, prefijo ? prefijo + ', equivalente posible' : '');
    }
    return out;
  }

  function analizar(tipo, doc, rutRes) {
    const nombre = tipo === 'RUT' ? 'RutParser' : 'RitParser';
    const parser = modulo(nombre, 'parse');
    if (!parser) return { error: 'PARSER_NO_DISPONIBLE' };
    let res;
    try {
      res = parser.parse(doc, opcionesParser(tipo, rutRes));
    } catch (e) {
      avisarUnaVez(nombre + '.parse', e);
      return { error: 'SIN_DATOS' };
    }
    if (!res || typeof res !== 'object') return { error: 'SIN_DATOS' };
    const avisos = avisosDe(res);
    // ok:false = documento equivocado o sin datos (RUT de persona jurídica, plantilla en blanco…): su aviso lo explica.
    if (res.ok === false) return { error: avisos.length ? 'AVISO_PARSER' : 'SIN_DATOS', mensaje: avisos.slice(0, 2).join(' ') };
    const hayCampos = camposAceptados(tipo, res).some((k) => valorDe(res, k));
    const hayOpciones = tipo === 'RIT' && alternativasRit(res.extra).length > 0;
    if (!hayCampos && !hayOpciones && !avisos.length) return { error: 'SIN_DATOS' };
    return { res };
  }

  async function procesarArchivo(archivoPdf, tipoEsperado) {
    const nombre = (archivoPdf && archivoPdf.name) || 'documento.pdf';
    const previo = sesion.zonas[tipoEsperado] && sesion.zonas[tipoEsperado].estado !== 'leyendo' ? sesion.zonas[tipoEsperado] : { estado: 'idle' };
    ponerZona(tipoEsperado, { estado: 'leyendo', archivo: nombre });
    try {
      if (archivoPdf && archivoPdf.name && !/\.pdf$/i.test(archivoPdf.name) && archivoPdf.type && archivoPdf.type !== 'application/pdf') {
        throw errorCodigo('NO_PDF');
      }
      if (!modulo('PdfText', 'leer')) throw errorCodigo('LIB_NO_DISPONIBLE');
      const doc = await window.PdfText.leer(archivoPdf, {
        documento: tipoEsperado,
        alProgresar: (leidas, total) => mostrarProgreso(tipoEsperado, leidas, total),
      });
      if (!doc || doc.tieneTexto === false) throw errorCodigo((doc && doc.problema) || 'SIN_TEXTO');
      const tipos = detectarTipos(doc);
      if (!tipos.length) throw errorCodigo(esSolicitudRit(doc) ? 'RIT_SOLICITUD' : 'NO_RECONOCIDO');

      // El RUT primero: el RIT del mismo PDF se lee con su documento y su actividad.
      tipos.sort((a, b) => (a === 'RUT' ? 0 : 1) - (b === 'RUT' ? 0 : 1));
      const encontrados = [];
      const errores = {};
      let rutRes = null;
      for (const tipo of tipos) {
        const r = analizar(tipo, doc, rutRes);
        if (r.res) {
          encontrados.push({ tipo, res: r.res });
          if (tipo === 'RUT') rutRes = r.res;
        } else errores[tipo] = r;
      }
      if (!encontrados.length) {
        const r = errores[tipoEsperado] || errores[tipos[0]] || {};
        const e = errorCodigo(r.error || 'SIN_DATOS');
        if (r.mensaje) e.mensajeUsuario = r.mensaje;
        throw e;
      }

      if (!encontrados.some((x) => x.tipo === tipoEsperado)) {
        const r = errores[tipoEsperado];
        if (r && r.mensaje) ponerZona(tipoEsperado, { estado: 'error', mensaje: r.mensaje, archivo: nombre });
        else ponerZona(tipoEsperado, previo);
      }
      const ambos = encontrados.length > 1;
      for (const x of encontrados) recibirResultado(x.tipo, x.res, nombre, { doc, sinReanalizar: ambos, silencioso: true });
      const total = encontrados.reduce((n, x) => n + ((estado.meta.docs[x.tipo] && estado.meta.docs[x.tipo].aplicados) || 0), 0);
      const tiposTexto = encontrados.map((x) => 'tu ' + x.tipo).join(' y ');
      if (encontrados.length === 1 && encontrados[0].tipo !== tipoEsperado) {
        toast('Ese archivo es tu ' + encontrados[0].tipo + '; lo ubicamos en su lugar y llenamos ' + plural(total, 'dato', 'datos') + '.');
      } else if (total) {
        toast('Listo: llenamos ' + plural(total, 'dato', 'datos') + ' con ' + tiposTexto + '. Revísalos en cada paso.');
      }
      anunciar(total ? 'Llenamos ' + plural(total, 'dato', 'datos') + ' con ' + tiposTexto + '.' : 'Leímos ' + tiposTexto + '.');
    } catch (e) {
      if (!e || !e.codigo) avisarUnaVez('procesarArchivo', e);
      const mensaje = mensajeError(e, tipoEsperado);
      ponerZona(tipoEsperado, { estado: 'error', mensaje, archivo: nombre });
      anunciar(mensaje);
    }
  }

  /**
   * Usa en el formulario lo leído de un documento. Lo escrito a mano no se reemplaza (queda como
   * "Tu RUT dice: X · Usar este"); los datos de confianza baja solo se ofrecen.
   * op.doc: el Doc leído (para volver a leer el RIT cuando llega el RUT); op.silencioso: sin anuncio;
   * op.sinReanalizar: no relee el RIT (el mismo PDF trae los dos y el RIT ya se leyó con este RUT).
   */
  function recibirResultado(tipo, res, archivoNombre, op) {
    const o = op || {};
    const campos = res.campos || {};
    const valores = {};
    const dudosos = {};
    for (const id of camposAceptados(tipo, res)) {
      const c = campos[id] || {};
      const valor = c.valor == null ? '' : String(c.valor);
      if (!valor) continue;
      if (id === 'actividadRit' && !buscarOpcion(id, valor)) continue; // nunca un código fuera de CATALOGOS.rit
      if (c.confianza === 'baja') dudosos[id] = valor; else valores[id] = valor;
    }
    const alternativas = tipo === 'RIT' ? alternativasRit(res.extra) : [];
    const extra = res.extra || {};
    const actividades = actividadesLeidas(tipo, res, alternativas);
    sesion.resultados[tipo] = { tipo, res, archivo: archivoNombre, doc: o.doc || null };
    // Al cambiar de documento, los conflictos que dejó el anterior ya no aplican.
    for (const [k, c] of Object.entries(estado.meta.conflictos)) if (c.fuente === tipo) delete estado.meta.conflictos[k];
    const n = aplicarValores(valores, tipo, dudosos);
    estado.meta.docs[tipo] = {
      archivo: archivoNombre,
      aplicados: n,
      fecha: hoyLocal(),
      avisos: avisosDe(res).slice(0, 8),
      documento: idDocumento(tipo),
      direccion: tipo === 'RIT' ? String(extra.direccion || '').trim().slice(0, 200) : '',
      sinFijo: tipo === 'RUT' && valorDe(res, 'telefono1') === '0',
      actividades,
      alternativas: alternativas.length > 1 || (alternativas.length === 1 && !valores.actividadRit) ? alternativas.slice(0, 15) : [],
    };
    sesion.zonas[tipo] = { estado: 'idle' };
    pintarZona(tipo);
    if (tipo === 'RUT') pintarZona('RIT'); // el cruce de documentos se muestra en la zona del RIT
    if (!o.silencioso) {
      anunciar(n ? 'Llenamos ' + plural(n, 'dato', 'datos') + ' con tu ' + tipo + '.' : 'Leímos tu ' + tipo + '.');
    }
    if (tipo === 'RUT' && !o.sinReanalizar) reanalizarRit();
    pintarNavegacion();
    guardarPronto();
  }

  /**
   * Códigos de actividad registrados en el documento que existen en el catálogo del formulario. RUT: casillas
   * 46 (principal), 48 (secundaria) y 50 (otras). RIT: la principal y las demás actividades del certificado.
   */
  function actividadesLeidas(tipo, res, alternativas) {
    const campo = CAMPO_ACTIVIDAD[tipo];
    const codigos = [valorDe(res, campo)];
    if (tipo === 'RUT') {
      const act = (res.extra && res.extra.actividades) || {};
      codigos.push(act.principal && act.principal.codigo, act.secundaria && act.secundaria.codigo);
      for (const a of Array.isArray(act.otras) ? act.otras : []) codigos.push(a && a.codigo);
    } else {
      for (const a of alternativas) codigos.push(a.valor);
    }
    return codigos.map((c) => String(c == null ? '' : c).trim())
      .filter((c, i, l) => c && l.indexOf(c) === i && buscarOpcion(campo, c)).slice(0, 20);
  }

  /** Con el RUT recién leído, vuelve a leer el RIT de esta sesión con su documento y su actividad. */
  function reanalizarRit() {
    const r = sesion.resultados.RIT;
    if (!r || !r.doc) return;
    const nuevo = analizar('RIT', r.doc);
    if (nuevo.res) recibirResultado('RIT', nuevo.res, r.archivo, { doc: r.doc, silencioso: true, sinReanalizar: true });
  }

  /** Documento (solo dígitos) del RUT o del RIT leídos en esta sesión. */
  function idDocumento(tipo) {
    const r = sesion.resultados[tipo];
    if (!r || !r.res) return '';
    const e = r.res.extra || {};
    if (tipo === 'RUT') return soloDigitos(valorDe(r.res, 'nit') || valorDe(r.res, 'numeroId') || e.nitLeido || e.numeroIdentificacion || '');
    return soloDigitos((e.contribuyente && e.contribuyente.numero) || e.identificacion || '');
  }

  /** ¿Es el mismo documento? Acepta el NIT con su DV pegado en cualquiera de los dos. */
  function mismoDocumento(a, b) {
    if (a === b) return true;
    const conDv = (largo, corto) => largo.length === corto.length + 1 && largo.startsWith(corto) && dvCalculado(corto) === largo.slice(-1);
    return conDv(a, b) || conDv(b, a);
  }

  /** Dirección comparable: sin tildes ni signos, abreviaturas de nomenclatura unificadas y sin espacios. */
  const ABREVIATURAS = {
    calle: 'cl', cll: 'cl', clle: 'cl', carrera: 'kr', cra: 'kr', cr: 'kr', kra: 'kr', carrer: 'kr', avenida: 'av', avda: 'av',
    diagonal: 'dg', diag: 'dg', transversal: 'tv', tr: 'tv', trans: 'tv', trv: 'tv', apartamento: 'ap', apto: 'ap', apt: 'ap',
    no: '', nro: '', num: '', numero: '',
  };
  function normDireccion(t) {
    return norm(t).replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
      .map((p) => (Object.prototype.hasOwnProperty.call(ABREVIATURAS, p) ? ABREVIATURAS[p] : p)).join('');
  }

  /**
   * Cruce RUT ↔ RIT (con lo guardado de cada documento, así sigue al reabrir el archivo):
   * { documentos: texto | '', dirRit: dirección del RIT si difiere de la del RUT | '' }.
   */
  function cruceDocumentos() {
    const out = { documentos: '', dirRit: '' };
    const rut = estado.meta.docs.RUT;
    const rit = estado.meta.docs.RIT;
    if (!rut || !rit) return out;
    if (rut.documento && rit.documento && !mismoDocumento(rut.documento, rit.documento)) {
      out.documentos = 'Tu RUT es del documento ' + rut.documento + ' y el RIT del documento ' + rit.documento +
        '. Verifica que los dos sean tuyos.';
      return out;
    }
    if (rit.direccion) out.dirRit = rit.direccion;
    return out;
  }

  const AVISOS_VISIBLES = 3;

  /** Avisos del documento en un estilo tranquilo (texto pequeño); si son muchos, los demás quedan plegados. */
  function listaAvisos(avisos) {
    const lista = h('ul', { class: 'notas-doc' }, avisos.map((a, i) => h('li', { hidden: avisos.length > AVISOS_VISIBLES + 1 && i >= AVISOS_VISIBLES },
      icono('info', 'icono-mini'), h('span', null, a))));
    if (avisos.length <= AVISOS_VISIBLES + 1) return lista;
    const mas = h('button', { type: 'button', class: 'enlace notas-doc-mas' }, 'Ver ' + plural(avisos.length - AVISOS_VISIBLES, 'nota más', 'notas más'));
    mas.addEventListener('click', () => { lista.querySelectorAll('li[hidden]').forEach((li) => { li.hidden = false; }); mas.remove(); });
    return h('div', null, lista, mas);
  }

  function enfocarSiExiste(id) {
    const el = document.getElementById(id);
    if (el) el.focus({ preventScroll: true });
  }

  // ─────────────────────────── Paso: contrato (SECOP II) ───────────────────────────
  //
  // Con la cédula del contratista se buscan sus contratos con la SED en SECOP II. Un solo contrato vigente
  // llena el paso; si hay varios, la persona elige cuál es en una lista.

  function construirContrato(cuerpo) {
    const caja = h('section', { class: 'secop', id: 'secop', 'aria-live': 'polite' });
    cuerpo.append(caja);
    construirGenerico(cuerpo, 'contrato');
    // El paso aún no está en el documento: se pinta en el contenedor recién creado.
    pintarSecop(caja);
    buscarSecopSiCorresponde();
  }

  const documentoParaSecop = () => soloDigitos(estado.s.numeroId || estado.s.nit);

  function buscarSecopSiCorresponde() {
    const cc = documentoParaSecop();
    const guardado = estado.meta.secop;
    if (!cc || cc.length < 5 || !modulo('Secop', 'buscar') || sesion.secop.estado === 'buscando') return;
    if (guardado && guardado.consulta === cc) return; // ya se consultó con esta cédula
    buscarSecop();
  }

  async function buscarSecop() {
    const cc = documentoParaSecop();
    if (!cc || !modulo('Secop', 'buscar')) return;
    sesion.secop = { estado: 'buscando', mensaje: '' };
    pintarSecop();
    try {
      const r = await window.Secop.buscar(cc, { hoy: hoyLocal() });
      const vigentes = r.vigentes.length > 0;
      const contratos = (vigentes ? r.vigentes : r.otros).slice(0, 20);
      estado.meta.secop = { consulta: cc, fecha: new Date().toISOString(), contratos, vigentes, elegido: '' };
      sesion.secop = { estado: 'listo', mensaje: '' };
      if (vigentes && contratos.length === 1) elegirContrato(contratos[0].referencia, { silencioso: true });
      else guardarPronto();
      if (vigentes && contratos.length === 1) toast('Encontramos tu contrato en SECOP II y llenamos sus datos. Revísalos.');
    } catch (e) {
      if (!e || !e.codigo) avisarUnaVez('Secop.buscar', e);
      sesion.secop = { estado: 'error', mensaje: e && /^(SIN_CONEXION|TIEMPO)$/.test(e.codigo)
        ? 'No pudimos conectarnos con SECOP II. Revisa tu conexión a internet o llena los datos del contrato a mano.'
        : 'SECOP II no respondió como esperábamos. Puedes intentar de nuevo o llenar los datos a mano.' };
    }
    pintarSecop();
  }

  function contratoElegido() {
    const sec = estado.meta.secop;
    return sec && sec.elegido ? sec.contratos.find((c) => c.referencia === sec.elegido) || null : null;
  }

  function elegirContrato(referencia, opciones) {
    const sec = estado.meta.secop;
    if (!sec) return;
    const c = sec.contratos.find((x) => x.referencia === referencia);
    // Los datos del contrato anterior que vinieron de SECOP se quitan antes de usar los del nuevo.
    for (const [k, conf] of Object.entries(estado.meta.conflictos)) if (conf.fuente === 'SECOP') delete estado.meta.conflictos[k];
    sec.elegido = c ? c.referencia : '';
    if (c && modulo('Secop', 'aCampos')) {
      const { campos } = window.Secop.aCampos(c);
      aplicarValores(campos, 'SECOP');
    } else guardarPronto();
    pintarSecop();
    if (!(opciones && opciones.silencioso)) anunciar(c ? 'Llenamos los datos del contrato ' + c.referencia + '.' : 'Sin contrato elegido.');
  }

  const fmtFechaCorta = (iso) => (iso ? fmtFecha(iso) : '');

  function textoContrato(c) {
    const partes = [c.referencia];
    if (c.fechaFirma) partes.push('firmado el ' + fmtFechaCorta(c.fechaFirma));
    if (c.valor) partes.push(fmtPesos(c.valor));
    return partes.join(' · ');
  }

  function pintarSecop(contenedor) {
    const caja = contenedor || document.getElementById('secop');
    if (!caja) return;
    caja.textContent = '';
    const sec = estado.meta.secop;
    const cc = documentoParaSecop();
    const titulo = h('p', { class: 'secop-titulo' }, icono('tabla', 'icono-mini'), h('span', null, 'Tu contrato en SECOP II'));
    const reintentar = h('button', { type: 'button', class: 'enlace secop-accion', onclick: buscarSecop }, 'Buscar de nuevo');
    const nota = h('p', { class: 'secop-nota' }, 'Consultamos tu número de identificación en Datos Abiertos Colombia (SECOP II), solo para los contratos de la Secretaría de Educación del Distrito.');
    const cuerpo = [];
    if (!modulo('Secop', 'buscar')) {
      caja.hidden = true;
      return;
    }
    if (!cc || cc.length < 5) {
      cuerpo.push(h('p', { class: 'secop-texto' }, 'Para buscar tu contrato necesitamos tu número de identificación. ',
        h('button', { type: 'button', class: 'enlace', onclick: () => irAlCampo('numeroId') }, 'Escríbelo en Datos personales'), '.'));
    } else if (sesion.secop.estado === 'buscando') {
      cuerpo.push(h('p', { class: 'secop-texto secop-buscando' }, h('span', { html: svgIcono('girando', 'icono girando') }), 'Buscando tu contrato…'));
    } else if (sesion.secop.estado === 'error') {
      cuerpo.push(h('p', { class: 'secop-texto' }, sesion.secop.mensaje), reintentar);
    } else if (!sec || sec.consulta !== cc) {
      cuerpo.push(h('p', { class: 'secop-texto' }, 'Podemos llenar los datos del contrato con la información de SECOP II.'),
        h('button', { type: 'button', class: 'enlace secop-accion', onclick: buscarSecop }, 'Buscar mi contrato'));
    } else if (!sec.contratos.length) {
      cuerpo.push(h('p', { class: 'secop-texto' }, 'No encontramos contratos vigentes con la Secretaría de Educación para tu número de identificación. Llena los datos a mano.'), reintentar);
    } else if (sec.contratos.length === 1 && sec.vigentes) {
      const c = sec.contratos[0];
      cuerpo.push(h('p', { class: 'secop-texto' }, icono('check', 'icono-mini'), 'Usamos los datos de tu contrato ',
        h('strong', null, c.referencia), c.fechaFirma ? ' (firmado el ' + fmtFechaCorta(c.fechaFirma) + ')' : '', '. Revísalos y completa lo que falte.'));
      if (c.objeto) cuerpo.push(h('p', { class: 'secop-objeto' }, c.objeto));
      if (c.url) cuerpo.push(h('a', { class: 'enlace secop-accion', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, 'Ver el contrato en SECOP II'));
    } else {
      const sel = h('select', { class: 'control control--select', id: 'secop-contrato', 'aria-describedby': 'secop-ayuda' },
        h('option', { value: '', selected: !sec.elegido }, 'Elige tu contrato…'),
        sec.contratos.map((c) => h('option', { value: c.referencia, selected: c.referencia === sec.elegido }, textoContrato(c))));
      sel.addEventListener('change', () => elegirContrato(sel.value));
      cuerpo.push(h('label', { class: 'etiqueta', for: 'secop-contrato' }, sec.vigentes
        ? 'Encontramos ' + sec.contratos.length + ' contratos vigentes con la SED. ¿Cuál es el de este formulario?'
        : 'No encontramos un contrato vigente; estos son tus contratos más recientes con la SED. ¿Cuál es el de este formulario?'), sel);
      const c = contratoElegido();
      cuerpo.push(h('p', { class: 'secop-objeto', id: 'secop-ayuda' }, c ? c.objeto : 'Al elegirlo llenamos los datos del contrato.'));
      if (c && c.url) cuerpo.push(h('a', { class: 'enlace secop-accion', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, 'Ver el contrato en SECOP II'));
    }
    agregarHijos(caja, [titulo, ...cuerpo, nota]);
    caja.hidden = false;
  }

  // ─────────────────────────── Paso: revisión ───────────────────────────

  function construirRevision(cuerpo) {
    const v = validar();
    const d = derivar();
    const pendientes = listaPendientes(v);
    const requeridos = IDS.filter((id) => visibleEn(id, estado.s) && requeridoEn(id, estado.s)).concat(soportesRequeridos().map(campoSoporte));
    const lleno = (id) => (claveSoporte(id) ? !faltaSoporte(claveSoporte(id)) : estado.s[id] && !v.errores[id]);
    const llenos = requeridos.filter(lleno).length;
    const completo = v.completo && !pendientes.length;
    const pct = completo ? 100 : Math.min(99, Math.round((llenos / Math.max(1, requeridos.length)) * 100));

    const medidor = h('section', { class: 'medidor' + (completo ? ' medidor--ok' : ''), 'aria-labelledby': 'medidor-titulo' },
      h('div', { class: 'medidor-cabeza' },
        h('p', { class: 'medidor-numero', id: 'medidor-titulo' }, pct + ' %'),
        h('p', { class: 'medidor-texto' }, completo
          ? 'Todo listo. Tu formulario está completo.'
          : 'Llevas ' + llenos + ' de ' + requeridos.length + ' datos obligatorios. ' +
            (pendientes.length === 1 ? 'Queda 1 pendiente.' : 'Quedan ' + pendientes.length + ' pendientes.'))),
      h('div', { class: 'medidor-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'Avance del formulario' },
        h('span', { style: 'width:' + pct + '%' })));
    cuerpo.append(medidor);

    if (pendientes.length) {
      const porPaso = {};
      for (const p of pendientes) (porPaso[p.step] = porPaso[p.step] || []).push(p);
      const seccion = h('section', { class: 'grupo revision-pendientes', 'aria-labelledby': 'rev-pend' },
        h('h3', { class: 'grupo-titulo', id: 'rev-pend' }, 'Pendientes'));
      const VISIBLES = 3;
      for (const paso of PASOS) {
        const items = porPaso[paso.id];
        if (!items) continue;
        const plegar = items.length > VISIBLES + 1;
        // Cada pendiente es un renglón que se puede pulsar entero (lleva al campo).
        const lista = h('ul', { class: 'pendientes-lista' }, items.map((p, i) => h('li', { class: 'pendiente pendiente--' + p.tipo, hidden: plegar && i >= VISIBLES },
          h('button', { type: 'button', class: 'pendiente-fila', onclick: () => irAlCampo(p.campo, p.step) },
            h('span', { class: 'pendiente-texto' }, p.mensaje),
            h('span', { class: 'pendiente-ir' }, h('span', { class: 'sr-only' }, ' — '), 'Ir', icono('flechaDer', 'icono-mini'))))));
        const bloque = h('div', { class: 'pendientes-paso' },
          h('p', { class: 'pendientes-titulo' }, paso.titulo, h('span', { class: 'pendientes-n' }, String(items.length))), lista);
        if (plegar) {
          const mas = h('button', { type: 'button', class: 'enlace pendientes-mas' }, 'Ver ' + (items.length - VISIBLES) + ' más');
          mas.addEventListener('click', () => {
            lista.querySelectorAll('li[hidden]').forEach((li) => { li.hidden = false; });
            mas.remove();
            const siguiente = lista.children[VISIBLES] && lista.children[VISIBLES].querySelector('button');
            if (siguiente) siguiente.focus();
          });
          bloque.append(mas);
        }
        seccion.append(bloque);
      }
      const otros = Object.keys(porPaso).filter((k) => !PASOS.some((p) => p.id === k));
      for (const k of otros) {
        seccion.append(h('ul', { class: 'pendientes-lista' }, porPaso[k].map((p) => h('li', { class: 'pendiente' }, h('span', null, p.mensaje)))));
      }
      cuerpo.append(seccion);
    }

    // Solo avisos para la persona (los internos van a la consola), con su explicación amable.
    const advertencias = advertenciasVisibles(v);
    if (d.alertaIva && !advertencias.some((a) => a.codigo === 'IVA_CUANTIA')) {
      advertencias.push({ mensaje: 'Verifica tu responsabilidad de IVA por la cuantía del contrato.' });
    }
    if (advertencias.length) {
      cuerpo.append(h('section', { class: 'grupo', 'aria-labelledby': 'rev-adv' },
        h('h3', { class: 'grupo-titulo', id: 'rev-adv' }, 'Para revisar'),
        h('div', { class: 'avisos' }, advertencias.map((a) => h('p', { class: 'aviso' }, icono('alerta'), h('span', null, textoAdvertencia(a)))))));
    }

    // Primero se verifica (resumen), después se descarga.
    cuerpo.append(construirResumenDatos(completo));

    const botonPdf = h('button', { type: 'button', class: 'boton boton--primario boton--grande', onclick: () => descargarPdf(botonPdf) },
      icono('firma'), h('span', null, 'Descargar PDF para firmar'));
    // Botón de Excel oculto por ahora; descargarExcel() se conserva para reactivarlo.
    cuerpo.append(h('section', { class: 'grupo descargas', 'aria-labelledby': 'rev-desc' },
      h('h3', { class: 'grupo-titulo', id: 'rev-desc' }, 'Descargas'),
      h('div', { class: 'descargas-botones' }, botonPdf),
      h('p', { class: 'ayuda-campo' }, 'El PDF se genera con la ventana de impresión de tu navegador: elige «Guardar como PDF».')));
    const soportes = construirSoportesRevision();
    if (soportes) cuerpo.append(soportes);

    // El nombre solo se muestra cuando ya cumple la regla NOMBRE_CONTRATO_AÑOCONTRATO.
    const limpio = estadoLimpio();
    const nombre = (limpio.primerApellido || limpio.primerNombre) && limpio.numeroContrato && limpio.anioContrato ? nombreArchivo() : '';
    cuerpo.append(h('section', { class: 'que-sigue', 'aria-labelledby': 'rev-sigue' },
      h('h3', { class: 'que-sigue-titulo', id: 'rev-sigue' }, '¿Qué sigue?'),
      h('ol', null,
        h('li', null, 'Firma el PDF.'),
        h('li', null, 'Envíalo a tu operativo o jefe de área. Esa persona lo remite a ',
          h('a', { href: 'mailto:' + (CFG.correoRadicacion || '') }, CFG.correoRadicacion || 'el buzón de Tesorería'),
          ' en un solo PDF, junto con tu certificación bancaria y los soportes de deducciones, si aplican.'),
        h('li', null, 'El archivo debe llamarse NOMBRE_CONTRATO_AÑOCONTRATO',
          nombre ? ['; el tuyo: ', h('strong', { class: 'nombre-archivo' }, nombre + '.pdf')]
            : ' (te lo mostramos cuando llenes tu nombre, el número y el año del contrato).'))));

    // Uso interno de Tesorería: solo con el formulario completo (mientras tanto el Excel dice "REVISE…").
    if (completo && d.codificacion && !/^REVISE/i.test(String(d.codificacion))) {
      cuerpo.append(h('p', { class: 'codificacion' }, h('span', null, 'Codificación tributaria (uso interno de Tesorería): '), h('span', { class: 'codificacion-valor' }, String(d.codificacion))));
    }
  }

  /** abierto: el resumen empieza desplegado (formulario completo en pantalla ancha). */
  function construirResumenDatos(completo) {
    const abierto = !!completo && !!(window.matchMedia && window.matchMedia('(min-width: 960px)').matches);
    const detalles = h('details', { class: 'resumen-datos', open: abierto },
      h('summary', null, h('span', null, 'Ver un resumen de tus datos'), icono('chevron', 'icono resumen-chevron')));
    for (const paso of PASOS) {
      const ids = camposDelPaso(paso.id).filter((id) => visibleEn(id, estado.s) && plegableVisibleResumen(id));
      if (!ids.length) continue;
      const indice = PASOS.indexOf(paso);
      const dl = h('dl', { class: 'resumen-lista' });
      for (const id of ids) {
        const valor = mostrarValor(id, estado.s[id]);
        if (!valor && !requeridoEn(id, estado.s)) continue;
        dl.append(h('div', { class: 'resumen-fila' }, h('dt', null, etiquetaCorta(id)), h('dd', { class: valor ? '' : 'vacio' }, valor || 'Sin diligenciar')));
      }
      detalles.append(h('div', { class: 'resumen-paso-datos' },
        h('div', { class: 'resumen-cabeza' }, h('h4', null, paso.titulo),
          h('button', { type: 'button', class: 'enlace', onclick: () => irA(indice) }, 'Editar')), dl));
    }
    return detalles;
  }

  function plegableVisibleResumen(id) {
    return !CAMPOS[id].opcionalPlegable || !!estado.s[id];
  }

  // ─────────────────────────── Descargas ───────────────────────────

  function nombreArchivo() {
    const limpio = estadoLimpio();
    try {
      if (modulo('ExportExcel', 'nombreArchivo')) {
        const n = window.ExportExcel.nombreArchivo(limpio);
        if (n) return String(n).replace(/\.(xlsx|pdf)$/i, '');
      }
    } catch (e) { avisarUnaVez('ExportExcel.nombreArchivo', e); }
    const d = sesion.derivados || {};
    const nombre = String(d.nombreCompleto || '').replace(/\s+/g, ' ').trim();
    if (!nombre && !limpio.numeroContrato) return '';
    return [nombre, limpio.numeroContrato, limpio.anioContrato].filter(Boolean).join('_')
      .replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_');
  }

  async function confirmarSiIncompleto(que) {
    const pendientes = listaPendientes(validar());
    if (!pendientes.length) return true;
    const lista = pendientes.slice(0, 8).map((p) => p.mensaje);
    if (pendientes.length > 8) lista.push('… y ' + (pendientes.length - 8) + ' más.');
    // Lo recomendado (volver y completar) es la acción principal y lleva al primer pendiente.
    const r = await confirmar({
      titulo: 'Aún faltan algunos datos',
      mensaje: 'Puedes descargar ' + que + ' así, pero Tesorería necesita el formulario completo para procesarlo.',
      lista,
      principal: 'Volver y completar',
      secundario: 'Descargar de todas formas',
      enfocar: 'principal',
      nativo: { pregunta: '¿Descargar de todas formas?', si: 'secundario' },
    });
    if (r === 'principal') irAlCampo(pendientes[0].campo, pendientes[0].step);
    return r === 'secundario';
  }

  function ocupado(boton, si, texto) {
    if (!boton) return;
    if (si) {
      boton.dataset.html = boton.innerHTML;
      boton.disabled = true;
      boton.innerHTML = svgIcono('girando', 'icono girando') + '<span></span>';
      boton.lastChild.textContent = texto || 'Preparando…';
    } else if (boton.dataset.html != null) {
      boton.innerHTML = boton.dataset.html;
      delete boton.dataset.html;
      boton.disabled = false;
    }
  }

  async function descargarPdf(boton) {
    if (!modulo('Imprimir', 'imprimir')) {
      toast('La descarga del PDF no está disponible en esta versión del formulario.', { tono: 'error' });
      return;
    }
    if (!(await confirmarSiIncompleto('el PDF'))) return;
    guardarAhora();
    ocupado(boton, true, 'Preparando el PDF…');
    try {
      await window.Imprimir.imprimir(estadoLimpio());
    } catch (e) {
      avisarUnaVez('Imprimir.imprimir', e);
      toast('No pudimos preparar el PDF. Intenta de nuevo; si el problema sigue, descarga el Excel.', { tono: 'error' });
    } finally {
      ocupado(boton, false);
    }
  }

  async function descargarExcel(boton) {
    if (!modulo('ExportExcel', 'generar')) {
      toast('La descarga en Excel no está disponible en esta versión del formulario.', { tono: 'error' });
      return;
    }
    if (!(await confirmarSiIncompleto('el Excel'))) return;
    guardarAhora();
    ocupado(boton, true, 'Generando el Excel…');
    try {
      const blob = await window.ExportExcel.generar(estadoLimpio());
      if (!blob) throw new Error('Sin archivo');
      descargarBlob(blob, (nombreArchivo() || 'formulario-13-IF-016') + '.xlsx');
      toast('Descargamos tu Excel diligenciado.');
    } catch (e) {
      avisarUnaVez('ExportExcel.generar', e);
      toast('No pudimos generar el Excel. Intenta de nuevo en unos segundos.', { tono: 'error' });
    } finally {
      ocupado(boton, false);
    }
  }

  function descargarBlob(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: nombre, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ─────────────────────────── Reinicio ───────────────────────────

  async function reiniciarConConfirmacion() {
    const r = await confirmar({
      titulo: '¿Empezar de nuevo?',
      mensaje: 'El formulario quedará vacío para que lo llene otra persona. Cuando guardes, te pediremos un archivo nuevo; el archivo anterior no se modifica.',
      principal: 'Sí, empezar de nuevo', secundario: 'Cancelar', peligro: true,
    });
    if (r === 'principal') reiniciar();
  }

  /** Formulario en limpio: sin datos y sin archivo (el siguiente guardado pide un archivo nuevo). */
  function reiniciar() {
    borrarPendientes(archivo.id);
    borrarPendientes(null);
    clearTimeout(temporizadorRespaldo);
    clearTimeout(temporizadorArchivo);
    Object.assign(archivo, { id: null, manejador: null, nombre: '', estado: 'nuevo', sucio: false, preguntado: false, repetir: false });
    estado.s = estadoInicial();
    estado.meta = metaInicial();
    estado.soportes = {};
    for (const k of Object.keys(errorSoportes)) delete errorSoportes[k];
    sesion.tocados.clear();
    sesion.vistos.clear();
    sesion.resultados = { RUT: null, RIT: null };
    sesion.zonas = { RUT: { estado: 'idle' }, RIT: { estado: 'idle' } };
    sesion.secop = { estado: 'idle', mensaje: '' };
    mostrarDueno(null);
    renderPaso();
    window.scrollTo({ top: 0 });
    toast('Listo, el formulario quedó en limpio.');
  }

  // ─────────────────────────── Dueño del archivo ───────────────────────────

  /** "Formulario de NOMBRE · guardado el … ¿No eres tú? Empezar de nuevo" al abrir un archivo con datos. */
  function mostrarDueno(datos) {
    let caja = document.getElementById('dueno');
    if (!datos) { if (caja) caja.remove(); return; }
    const tarjeta = document.getElementById('tarjeta');
    if (!tarjeta) return;
    if (!caja) {
      caja = h('div', { class: 'dueno', id: 'dueno', role: 'note' });
      tarjeta.prepend(caja);
    }
    const nombre = String(datos.nombre || nombrePersona() || '').trim();
    const fecha = datos.guardado ? new Date(datos.guardado) : null;
    const cuando = fecha && !isNaN(fecha)
      ? ' · guardado el ' + fmtFecha(fecha.getFullYear() + '-' + String(fecha.getMonth() + 1).padStart(2, '0') + '-' + String(fecha.getDate()).padStart(2, '0'))
      : '';
    caja.textContent = '';
    agregarHijos(caja, [icono('archivoOk', 'icono-mini'),
      h('span', { class: 'dueno-texto' }, nombre ? ['Formulario de ', h('strong', null, nombre), cuando, '. '] : ['Este formulario ya tiene datos' + cuando + '. ']),
      h('span', { class: 'dueno-accion' }, '¿No eres tú? ', h('button', { type: 'button', class: 'enlace', onclick: reiniciarConConfirmacion }, 'Empezar de nuevo')),
      h('button', { type: 'button', class: 'dueno-cerrar', 'aria-label': 'Cerrar este aviso', html: svgIcono('cerrar'), onclick: () => mostrarDueno(null) })]);
  }

  // ─────────────────────────── Diálogo y avisos ───────────────────────────

  /**
   * Diálogo con dos acciones. Resuelve 'principal', 'secundario' o null (Esc o cierre).
   * op: { titulo, mensaje, lista?, principal, secundario, peligro?, enfocar?: 'principal' | 'secundario' (por defecto),
   *       nativo?: { pregunta, si } para window.confirm cuando no hay <dialog> (Aceptar = op.nativo.si) }.
   */
  function confirmar(op) {
    const dialogo = document.getElementById('dialogo');
    if (!dialogo || typeof dialogo.showModal !== 'function') {
      const nativo = op.nativo || { pregunta: '', si: 'principal' };
      const texto = op.titulo + '\n\n' + op.mensaje + (op.lista ? '\n\n• ' + op.lista.join('\n• ') : '') + (nativo.pregunta ? '\n\n' + nativo.pregunta : '');
      return Promise.resolve(window.confirm(texto) ? nativo.si : null);
    }
    return new Promise((resolver) => {
      dialogo.textContent = '';
      const principal = h('button', { type: 'button', class: 'boton ' + (op.peligro ? 'boton--peligro' : 'boton--primario') }, op.principal || 'Aceptar');
      const secundario = h('button', { type: 'button', class: 'boton boton--secundario' }, op.secundario || 'Cancelar');
      agregarHijos(dialogo, [
        h('h2', { class: 'dialogo-titulo', id: 'dialogo-titulo' }, op.titulo),
        h('p', { class: 'dialogo-texto' }, op.mensaje),
        op.lista && op.lista.length ? h('ul', { class: 'dialogo-lista' }, op.lista.map((t) => h('li', null, t))) : null,
        h('div', { class: 'dialogo-acciones' }, secundario, principal)]);
      // Todos los listeners se retiran al cerrar (no se acumulan entre diálogos).
      const control = new AbortController();
      const conSenal = { signal: control.signal };
      let resuelto = false;
      const terminar = (valor) => {
        if (resuelto) return;
        resuelto = true;
        control.abort();
        if (dialogo.open) dialogo.close();
        resolver(valor);
      };
      principal.addEventListener('click', () => terminar('principal'), conSenal);
      secundario.addEventListener('click', () => terminar('secundario'), conSenal);
      dialogo.addEventListener('cancel', () => terminar(null), conSenal);
      dialogo.addEventListener('close', () => terminar(null), conSenal);
      dialogo.showModal();
      (op.enfocar === 'principal' ? principal : secundario).focus();
    });
  }

  /** Mensaje solo para lectores de pantalla. */
  function anunciar(texto) {
    let region = document.getElementById('anuncio');
    if (!region) {
      region = h('div', { id: 'anuncio', class: 'sr-only', 'aria-live': 'polite', role: 'status' });
      document.body.append(region);
    }
    region.textContent = '';
    setTimeout(() => { region.textContent = texto; }, 60);
  }

  function toast(texto, opciones) {
    const op = opciones || {};
    const zona = document.getElementById('toasts');
    if (!zona) return;
    const el = h('div', { class: 'toast' + (op.tono === 'error' ? ' toast--error' : '') },
      icono(op.tono === 'error' ? 'alerta' : 'check'), h('span', { class: 'toast-texto' }, texto));
    const cerrar = () => {
      if (!el.isConnected) return;
      el.classList.add('saliendo');
      setTimeout(() => el.remove(), movimientoReducido() ? 0 : 180);
    };
    if (op.accion) {
      el.append(h('button', { type: 'button', class: 'toast-accion', onclick: () => { cerrar(); op.alAccionar && op.alAccionar(); } }, op.accion));
    }
    el.append(h('button', { type: 'button', class: 'toast-cerrar', 'aria-label': 'Cerrar aviso', onclick: cerrar, html: svgIcono('cerrar') }));
    // Un solo aviso a la vez: el nuevo reemplaza al anterior (no se apilan sobre el contenido).
    while (zona.firstChild) zona.firstChild.remove();
    zona.append(el);
    setTimeout(cerrar, op.duracion || (op.accion ? 9000 : 5000));
  }

  // ─────────────────────────── Inicio ───────────────────────────

  function iniciar() {
    // Copia del archivo tal como se abrió (antes de pintar nada): es la base de cada guardado.
    if (G) G.capturar(document);
    estado.s = estadoInicial();
    estado.meta = metaInicial();
    estado.soportes = {};
    const embebido = G ? G.leerEmbebido(document) : null;
    if (embebido) {
      cargarDatos(embebido);
      archivo.id = typeof embebido.id === 'string' && embebido.id ? embebido.id.slice(0, 80) : null;
      archivo.estado = hayAlgo() ? 'leido' : 'nuevo';
    }

    construirStepper();
    renderPaso();
    if (embebido && hayAlgo()) mostrarDueno(embebido);
    ofrecerRecuperacion(embebido);
    if (archivo.id) reconectarArchivo();

    const version = document.getElementById('pie-version');
    if (version) {
      const info = window.BUILD_INFO;
      const construido = info && info.fecha ? new Date(info.fecha) : null;
      const fecha = construido && !isNaN(construido)
        ? ' (' + String(construido.getDate()).padStart(2, '0') + '/' + String(construido.getMonth() + 1).padStart(2, '0') + '/' + construido.getFullYear() + ')'
        : '';
      version.textContent = 'Aplicación ' + ((info && info.version) || VERSION) + fecha;
    }

    const reiniciarBtn = document.getElementById('btn-reiniciar');
    if (reiniciarBtn) reiniciarBtn.addEventListener('click', reiniciarConConfirmacion);

    // Evita que el navegador abra el PDF si se suelta fuera de una zona de carga.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
    window.addEventListener('pagehide', guardarAhora);
    // Como en Excel: si hay cambios que aún no están en el archivo, el navegador pregunta antes de cerrar.
    window.addEventListener('beforeunload', (e) => {
      if (!archivo.sucio || !hayAlgo()) return;
      guardarAhora();
      e.preventDefault();
      e.returnValue = '';
    });

    buscarActualizacion();
  }

  /** Busca el archivo donde se guardó este formulario (Chrome/Edge lo recuerdan) para seguir autoguardando. */
  async function reconectarArchivo() {
    if (!G || !archivo.id || !G.soportaArchivos()) return;
    const manejador = await G.archivoRecordado(archivo.id);
    if (!manejador || archivo.manejador) return;
    archivo.manejador = manejador;
    archivo.nombre = manejador.name || '';
    const p = await G.permiso(manejador, false);
    if (p === 'granted') {
      archivo.estado = archivo.sucio ? 'nuevo' : 'guardado';
      if (archivo.sucio) escribirArchivo();
    } else {
      archivo.estado = 'pausado';
    }
    pintarGuardado();
  }

  /**
   * Cambios que no alcanzaron a llegar al archivo (se cerró antes de guardar): se ofrece recuperarlos.
   * Solo si son más recientes que lo guardado en el archivo.
   */
  async function ofrecerRecuperacion(embebido) {
    if (!G) return;
    const pendiente = G.leerPendiente(archivo.id);
    if (!pendiente || !valoresDe(pendiente).usados) return;
    if (embebido && String(pendiente.guardado || '') <= String(embebido.guardado || '')) { borrarPendientes(archivo.id); return; }
    const fecha = pendiente.guardado ? new Date(pendiente.guardado) : null;
    const cuando = fecha && !isNaN(fecha)
      ? ' del ' + String(fecha.getDate()).padStart(2, '0') + '/' + String(fecha.getMonth() + 1).padStart(2, '0') + '/' + fecha.getFullYear() +
        ' a las ' + String(fecha.getHours()).padStart(2, '0') + ':' + String(fecha.getMinutes()).padStart(2, '0')
      : '';
    const nombre = String(pendiente.nombre || '').trim();
    const r = await confirmar({
      titulo: '¿Recuperar tu avance sin guardar?',
      mensaje: 'Encontramos un avance' + (nombre ? ' de ' + nombre : '') + cuando + ' que no alcanzó a guardarse en el archivo.',
      principal: 'Recuperar', secundario: 'Descartar', enfocar: 'principal',
      nativo: { pregunta: '¿Recuperarlo?', si: 'principal' },
    });
    if (r !== 'principal') { borrarPendientes(archivo.id); return; }
    const paso = estado.meta.paso;
    // El respaldo de los datos no lleva los soportes: vienen de IndexedDB o, si no hay, se quedan los del archivo.
    const soportesRespaldo = S ? await S.leerRespaldo(archivo.id) : null;
    const soportesArchivo = estado.soportes;
    cargarDatos(pendiente);
    estado.soportes = soportesRespaldo || soportesArchivo;
    estado.meta.paso = paso;
    sesion.tocados.clear();
    renderPaso();
    guardarPronto();
    toast('Recuperamos tu avance.');
  }

  // ─────────────────────────── Actualizaciones ───────────────────────────
  //
  // Al abrir se consulta version.json en el repositorio. Si allá hay una versión mayor se ofrece
  // «Actualizar»: se descarga el formulario nuevo y se le incrustan los datos de este (guardado.js).
  // Si este formulario ya se guarda en un archivo (Chrome/Edge), se reemplaza ese archivo y se recarga;
  // si no, se descarga la versión nueva con los datos. Sin internet no pasa nada.

  const versionActual = () => (window.BUILD_INFO && window.BUILD_INFO.version) || VERSION;
  let actualizando = false;

  async function traer(url, comoTexto) {
    const cfg = CFG.actualizaciones || {};
    const control = typeof AbortController === 'function' ? new AbortController() : null;
    const espera = control ? setTimeout(() => control.abort(), cfg.tiempoMaximoMs || 8000) : null;
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store', signal: control ? control.signal : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return comoTexto ? await r.text() : await r.json();
    } finally {
      clearTimeout(espera);
    }
  }

  async function buscarActualizacion() {
    const cfg = CFG.actualizaciones;
    if (!G || !cfg || !cfg.versionUrl || !cfg.htmlUrl || typeof fetch !== 'function') return;
    try {
      const info = await traer(cfg.versionUrl);
      if (info && info.version && G.versionMayor(info.version, versionActual())) mostrarAvisoVersion(info);
    } catch (e) { /* sin conexión o repositorio no disponible: se sigue con esta versión */ }
  }

  function mostrarAvisoVersion(info) {
    if (document.getElementById('aviso-version')) return;
    const principal = document.getElementById('principal');
    if (!principal) return;
    const notas = String(info.notas || '').trim();
    const boton = h('button', { type: 'button', class: 'boton boton--primario' }, 'Actualizar');
    const aviso = h('div', { class: 'aviso-version', id: 'aviso-version', role: 'status' },
      icono('info'),
      h('span', { class: 'aviso-version-texto' },
        h('strong', null, 'Hay una nueva versión del formulario (' + info.version + ').'),
        ' Tienes la ' + versionActual() + '. Tus datos se conservan.' + (notas ? ' ' + notas : '')),
      boton,
      h('button', { type: 'button', class: 'aviso-version-cerrar', 'aria-label': 'Cerrar aviso', html: svgIcono('cerrar'), onclick: () => aviso.remove() }));
    boton.addEventListener('click', () => actualizarFormulario(info, boton));
    principal.prepend(aviso);
  }

  async function actualizarFormulario(info, boton) {
    if (actualizando) return;
    actualizando = true;
    boton.disabled = true;
    boton.textContent = 'Descargando…';
    try {
      const texto = await traer(CFG.actualizaciones.htmlUrl, true);
      if (!G.esFormulario(texto)) throw new Error('el archivo descargado no es el formulario');
      const conDatos = hayAlgo();
      if (conDatos && !archivo.id) archivo.id = G.nuevoId();
      const nuevo = G.html(conDatos ? datosParaGuardar() : null, texto);

      // Chrome/Edge con el archivo de este formulario: se escribe la versión nueva encima y se recarga.
      const actual = G.archivoActual();
      const mismoArchivo = archivo.manejador && actual.nombre && actual.nombre === archivo.nombre;
      if (mismoArchivo && (await G.permiso(archivo.manejador, true)) === 'granted') {
        clearTimeout(temporizadorArchivo);
        if (archivo.escribiendo) await archivo.escribiendo;
        await G.escribir(archivo.manejador, nuevo);
        // La página vieja ya no debe escribir en el archivo (lo devolvería a la versión anterior).
        archivo.manejador = null;
        archivo.sucio = false;
        await borrarPendientes(archivo.id);
        location.reload();
        return;
      }

      // Primero se explica qué hacer; la descarga empieza al pulsar «Entendido».
      const nombre = nombreArchivoHtml();
      const r = await confirmar({
        titulo: 'La versión ' + info.version + ' está lista',
        mensaje: 'Al pulsar «Entendido» se descargará el archivo «' + nombre + '»' + (conDatos ? ' con tus datos' : '') +
          '. Después cierra esta ventana, abre ese archivo desde tu carpeta de descargas y borra el anterior.',
        principal: 'Entendido', secundario: 'Cancelar', enfocar: 'principal',
        nativo: { pregunta: '¿Descargar ahora?', si: 'principal' },
      });
      if (r !== 'principal') {
        boton.disabled = false;
        boton.textContent = 'Actualizar';
        return;
      }
      G.descargar(nuevo, nombre);
      boton.textContent = 'Descargado';
    } catch (e) {
      avisarUnaVez('Actualizar', e);
      boton.disabled = false;
      boton.textContent = 'Actualizar';
      toast('No pudimos descargar la nueva versión. Revisa tu conexión e intenta de nuevo.', { tono: 'error' });
    } finally {
      actualizando = false;
    }
  }

  window.App = {
    version: VERSION,
    /** Copia del estado actual: { s, meta }. */
    obtenerEstado: () => ({ s: { ...estado.s }, meta: JSON.parse(JSON.stringify(estado.meta)) }),
    /** Asigna valores { idCampo: valor }; origen opcional 'RUT' | 'RIT' | 'Sugerido' | 'auto'. */
    establecer(valores, origen) {
      for (const [k, v] of Object.entries(valores || {})) if (CAMPOS[k]) cambiar(k, v, origen || 'auto');
      sincronizarTodo();
      actualizarUI();
    },
    irA: (paso) => irA(paso),
    /** Procesa archivos PDF como si se hubieran soltado en la zona del tipo indicado. */
    procesarArchivos: (archivos, tipo) => procesarArchivos(Array.from(archivos || []), tipo === 'RIT' ? 'RIT' : 'RUT'),
    /** Usa un Resultado de parser como si se hubiera leído ese documento. */
    recibirResultado: (tipo, resultado, nombre) => { recibirResultado(tipo, resultado, nombre || tipo + '.pdf'); },
    /** Usa un contrato de SECOP ya normalizado (pruebas): contratos = [Secop.normalizar(...)], vigentes. */
    usarContratosSecop(contratos, vigentes) {
      estado.meta.secop = { consulta: documentoParaSecop(), fecha: new Date().toISOString(), contratos: contratos || [], vigentes: vigentes !== false, elegido: '' };
      sesion.secop = { estado: 'listo', mensaje: '' };
      if (vigentes !== false && contratos && contratos.length === 1) elegirContrato(contratos[0].referencia, { silencioso: true });
      pintarSecop();
      actualizarUI();
    },
    elegirContrato: (referencia) => elegirContrato(referencia),
    validar,
    derivar,
    estadoLimpio: () => estadoLimpio(),
    reiniciar,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
