// Documento imprimible con el diseño oficial del formato 13-IF-016 (V.1).
//
// API (window.Imprimir):
//   render(s, d?, opts?) -> HTMLElement   arma el documento dentro de #impresion (lo crea si no existe);
//                                         si d no se pasa usa Calc.derivados(s). Si una hoja no cabe en
//                                         una página carta la reduce (CSS zoom) para que la firma no se separe.
//   imprimir(s, opts?) -> Promise<void>   calcula d = Calc.derivados(s), arma, pone el nombre de archivo
//                                         (ExportExcel.nombreArchivo) como título, abre el diálogo de
//                                         impresión y restaura el título al cerrarlo
//   pdf(s, opts?) -> Promise<Blob>        el mismo documento como PDF carta, sin diálogo de impresión: cada
//                                         hoja se dibuja como imagen (html2canvas) dentro de un PDF (jsPDF)
//   puedeGenerarPdf() -> boolean          están html2canvas y jsPDF (si no, se usa imprimir())
//   nombreArchivo(s) -> string            NOMBRE_CONTRATO_AÑO.pdf (ExportExcel.nombreArchivo)
//   html(s, d?, opts?) -> string          el mismo documento como HTML (sin DOM; útil para pruebas)
//   necesitaHojaDeducciones(s) -> boolean hoja 2 solo con dependientes / hipotecario / salud no POS
// opts: { hoy?: Date } (fecha de diligenciamiento de la hoja de deducciones)
// El logo sale de window.LOGO_SRC (data URI que inyecta el build) o de 'img/logo.png' en desarrollo.
//
// #impresion está oculto en pantalla (atributo hidden + print.css) y al imprimir se muestra solo él.
(function (root) {
  'use strict';

  const ID_RAIZ = 'impresion';

  // ───────────────────────── Utilidades ─────────────────────────

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const vacio = (v) => v == null || String(v).trim() === '';
  const txt = (v) => (vacio(v) ? '' : String(v).trim());

  function numero(v) {
    if (vacio(v)) return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\s+/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function pesos(v) {
    const n = numero(v);
    if (n === null) return '';
    const C = root.Calc;
    if (C && typeof C.formatoPesos === 'function') {
      try { const r = C.formatoPesos(n); if (r) return String(r); } catch (e) { /* formato local */ }
    }
    return '$ ' + Math.round(n).toLocaleString('es-CO');
  }

  function decimal(v, max) {
    const n = numero(v);
    if (n === null) return vacio(v) ? '' : String(v);
    return n.toLocaleString('es-CO', { maximumFractionDigits: max == null ? 2 : max });
  }

  // 'FORMATO DEDUCCIONES'!W15 (=HOY()): la de opts.hoy, la que usó Calc (ISO) o la de hoy; dd/mm/aaaa.
  function fechaDiligenciamiento(d, hoy) {
    if (!(hoy instanceof Date)) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(d && (d.fechaDiligenciamiento || d.hoy)));
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    }
    return fechaHoy(hoy);
  }

  function fechaHoy(hoy) {
    const f = hoy instanceof Date ? hoy : new Date();
    const dd = String(f.getDate()).padStart(2, '0');
    const mm = String(f.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${f.getFullYear()}`;
  }

  // Párrafos a partir de un texto con saltos de línea dobles.
  function parrafos(t, clase) {
    return String(t || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      .map((p) => `<p${clase ? ` class="${clase}"` : ''}>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  }

  // ───────────────────────── Datos derivados ─────────────────────────

  function catalogos() { return root.CATALOGOS || {}; }

  // Completa lo que falte en `d` (si Calc no está disponible) solo con búsquedas simples de catálogo.
  function completarDerivados(s, d) {
    const C = catalogos();
    const r = Object.assign({}, d || {});
    const nombre = ['primerApellido', 'segundoApellido', 'primerNombre', 'otrosNombres'].map((k) => txt(s[k])).filter(Boolean).join(' ').toUpperCase();
    if (vacio(r.nombreCompleto)) r.nombreCompleto = nombre;
    if (r.identificacionTitular == null) r.identificacionTitular = txt(s.nit) || txt(s.dv) ? `${txt(s.nit)}-${txt(s.dv)}` : '';
    if (r.descCiiu == null) {
      const a = (C.ciiu || []).find((x) => x.codigo === txt(s.actividadRut));
      r.descCiiu = a ? a.descripcion : '';
    }
    if (r.descRit == null || r.tarifaRit == null) {
      const a = (C.rit || []).find((x) => String(x.codigo) === txt(s.actividadRit));
      if (r.descRit == null) r.descRit = a ? a.descripcion : '';
      if (r.tarifaRit == null) r.tarifaRit = a ? a.tarifa : '';
    }
    if (r.firmaNombre == null) r.firmaNombre = r.nombreCompleto;
    if (r.firmaDocumento == null) r.firmaDocumento = `${txt(s.tipoDocumento)} ${txt(s.numeroId)}`.trim();
    if (r.firmaContrato == null) r.firmaContrato = txt(s.numeroContrato) || txt(s.anioContrato) ? `CONTRATO No ${txt(s.numeroContrato)} DE ${txt(s.anioContrato)}` : '';
    if (r.textoCertificacion == null) r.textoCertificacion = `Yo ${r.nombreCompleto} ${C.juramento || ''}`;
    if (r.anioCertificados == null) {
      const cfg = root.CONFIG || {};
      r.anioCertificados = cfg.anioGravable || '';
    }
    if (r.anioVigenciaCertificados == null && numero(r.anioCertificados) !== null) r.anioVigenciaCertificados = numero(r.anioCertificados) + 2;
    return r;
  }

  function derivados(s, hoy) {
    const C = root.Calc;
    if (C && typeof C.derivados === 'function') {
      try { return C.derivados(s, hoy); } catch (e) { if (root.console) console.error('Calc.derivados falló', e); }
    }
    return {};
  }

  function necesitaHojaDeducciones(s) {
    const st = s || {};
    return st.dedDependientes === 'SI' || st.dedHipotecario === 'SI' || st.dedSaludNoPos === 'SI';
  }

  // ───────────────────────── Piezas de maquetación ─────────────────────────

  // Celda con rótulo pequeño arriba y valor abajo. `span` = columnas de una rejilla de 24.
  // extra.codigo: código de homologación que el Excel muestra en una celda sombreada junto al valor
  // (tipo de documento DIAN, país, banco…); Tesorería lo usa para cargar Apoteosys.
  function campo(rotulo, valor, span, extra) {
    const clases = ['imp-campo'];
    if (extra && extra.clase) clases.push(extra.clase);
    const v = extra && extra.html != null ? extra.html : esc(valor);
    const codigo = extra && !vacio(extra.codigo) && !vacio(v) ? `<span class="imp-cod">${esc(txt(extra.codigo))}</span>` : '';
    return `<div class="${clases.join(' ')}" style="grid-column:span ${span || 6}">`
      + `<span class="imp-rotulo">${esc(rotulo)}</span>`
      + `<span class="imp-valor">${codigo}${v || '&nbsp;'}</span></div>`;
  }

  // 'aaaa-mm-dd' → 'dd/mm/aaaa' (como muestra las fechas la hoja 'FORMATO DEDUCCIONES').
  function fechaDma(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(iso));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : txt(iso);
  }

  function fila(...celdas) {
    return `<div class="imp-fila">${celdas.join('')}</div>`;
  }

  function casillas(valor, n) {
    const chars = Array.from(txt(valor).replace(/\s+/g, ''));
    let h = '<span class="imp-casillas">';
    for (let i = 0; i < n; i++) h += `<span class="imp-casilla">${chars[i] ? esc(chars[i]) : ''}</span>`;
    return h + '</span>';
  }

  function marcaSiNo(valor) {
    const v = txt(valor).toUpperCase();
    const caja = (on) => `<span class="imp-caja">${on ? 'X' : ''}</span>`;
    return `<span class="imp-sino"><span>SI</span>${caja(v === 'SI')}<span>NO</span>${caja(v === 'NO')}</span>`;
  }

  function seccion(titulo, contenido, subtitulo) {
    return `<section class="imp-seccion"><h2 class="imp-titulo-seccion">${esc(titulo)}`
      + `${subtitulo ? `<span class="imp-subtitulo-seccion">${esc(subtitulo)}</span>` : ''}</h2>${contenido}</section>`;
  }

  function encabezado(titulo) {
    const logo = root.LOGO_SRC || 'img/logo.png';
    const cfg = (root.CONFIG && root.CONFIG.formato) || { codigo: '13-IF-016', version: 'V.1' };
    return `<header class="imp-encabezado">`
      + `<div class="imp-logo"><img src="${esc(logo)}" alt="Alcaldía Mayor de Bogotá D.C. · Secretaría de Educación"></div>`
      + `<div class="imp-titulos"><div class="imp-entidad">SECRETARÍA DE EDUCACIÓN DE BOGOTÁ</div>`
      + `<div class="imp-oficina">OFICINA DE TESORERÍA Y CONTABILIDAD</div>`
      + `<div class="imp-titulo">${esc(titulo)}</div></div>`
      + `<div class="imp-codigo"><span>${esc(cfg.codigo)}</span><span>${esc(String(cfg.version).replace(/\.?$/, '.'))}</span></div>`
      + `</header>`;
  }

  // ───────────────────────── Hoja 1: actualización de datos ─────────────────────────

  function hojaDatos(s, d) {
    const SCHEMA = root.SCHEMA || {};
    const cfg = root.CONFIG || {};
    // Texto literal del Excel (C61, C64, C67, C70); si el esquema es antiguo, el de pantalla.
    const preguntas = typeof SCHEMA.preguntasFormato === 'function' ? SCHEMA.preguntasFormato(cfg)
      : typeof SCHEMA.preguntas === 'function' ? SCHEMA.preguntas(cfg) : {};
    const literal = typeof SCHEMA.preguntasFormato === 'function';
    const esColombia = txt(s.pais).toUpperCase() === 'COLOMBIA';

    const identificacion = seccion('IDENTIFICACIÓN',
      fila(
        campo('Número de Identificación Tributaria (NIT)', txt(s.nit), 5),
        campo('DV', txt(s.dv), 2, { clase: 'imp-centro' }),
        campo('Tipo de Contribuyente', 'PERSONA NATURAL', 4, { codigo: '2' }),
        campo('Tipo de Documento', txt(s.tipoDocumento), 7, { codigo: d.codTipoDocDian }),
        campo('Número de Identificación', txt(s.numeroId), 6),
      )
      + fila(
        campo('Primer Apellido', txt(s.primerApellido), 4),
        campo('Segundo Apellido', txt(s.segundoApellido), 4),
        campo('Primer Nombre', txt(s.primerNombre), 4),
        campo('Otros Nombres', txt(s.otrosNombres), 4),
        campo('Nombre Completo', txt(d.nombreCompleto).replace(/\s+/g, ' '), 8),
      )
      + fila(
        campo('Es usted pensionado o ya adquirió los derechos para serlo', '', 8, { html: marcaSiNo(s.pensionado) }),
        campo('Dirección reportada en el RUT', txt(s.direccion), 16),
      )
      + fila(
        campo('País', txt(s.pais), 6, { codigo: d.codPais }),
        campo('Departamento (solo para país Colombia)', esColombia ? txt(s.departamento) : '', 9, { codigo: d.codDepto }),
        campo('Municipio (solo para país Colombia)', esColombia ? txt(s.municipio) : '', 9, { codigo: d.codMunicipio }),
      )
      + fila(
        campo('Correo electrónico', txt(s.email), 12),
        campo('Teléfono 1', txt(s.telefono1), 6),
        campo('Teléfono 2', txt(s.telefono2), 6),
      ));

    const pagos = seccion('SISTEMA AUTOMÁTICO DE PAGOS',
      fila(
        campo('Banco', txt(s.banco), 6, { codigo: d.codBanco }),
        campo('Sucursal', txt(s.sucursal), 4),
        campo('Tipo Cuenta', txt(s.tipoCuenta), 3, { codigo: d.codTipoCuenta }),
        campo('Identificación Titular', txt(d.identificacionTitular) === '-' ? '' : txt(d.identificacionTitular), 4),
        campo('Cuenta Bancaria', '', 7, { html: casillas(s.numeroCuenta, 16), clase: 'imp-con-casillas' }),
      ));

    const descRut = txt(s.actividadRut) ? txt(d.descCiiu) : '';
    const descRit = txt(s.actividadRit) ? txt(d.descRit) : '';
    const tributario = seccion('CLASIFICACIÓN Y RESPONSABILIDADES TRIBUTARIAS',
      fila(
        campo('Actividad Económica RUT', '', 9, { html: `${casillas(s.actividadRut, 4)}<span class="imp-desc">${esc(descRut)}</span>`, clase: 'imp-con-casillas' }),
        campo('Actividad Económica RIT', '', 9, { html: `${casillas(s.actividadRit, 5)}<span class="imp-desc">${esc(descRit)}</span>`, clase: 'imp-con-casillas' }),
        campo('Tarifa x Mil', txt(s.actividadRit) ? decimal(d.tarifaRit, 3) : '', 2, { clase: 'imp-centro' }),
        campo('Régimen IVA', txt(s.regimenIva), 4, { codigo: d.siglaRegimen }),
      ));

    const duracion = numero(d.duracionDias);
    const duracionTexto = !vacio(d.duracionDiasTexto) ? txt(d.duracionDiasTexto) : duracion === null ? '' : decimal(duracion, 2);
    const contrato = seccion('DATOS DEL CONTRATO',
      fila(
        campo('No contrato', txt(s.numeroContrato), 3),
        campo('Año Contrato', txt(s.anioContrato), 2),
        campo('Valor Total Contrato', pesos(s.valorTotal), 4),
        campo('Duración (días)', duracionTexto, 3),
        campo('Fecha Acta de Inicio (aaaa/mm/dd)', txt(s.fechaInicio), 4),
        campo('Fecha terminación Contrato (aaaa/mm/dd)', txt(s.fechaTerminacion), 5),
        campo('Cesión', txt(s.cesion), 3, { clase: 'imp-centro' }),
      )
      + fila(
        campo('Valor Pago Mensual según Contrato', pesos(s.valorMensual), 4),
        campo('CRP 1', txt(s.crp1), 2),
        campo('Fecha CRP 1 aaaa/mm/dd', txt(s.fechaCrp1), 3),
        campo('RP Vigencia Futura', txt(s.rpVigenciaFutura), 2, { clase: 'imp-centro' }),
        campo('CRP 2', txt(s.crp2), 2),
        campo('Fecha CRP 2 aaaa/mm/dd', txt(s.fechaCrp2), 3),
        campo('CRP 3', txt(s.crp3), 2),
        campo('Fecha CRP 3 aaaa/mm/dd', txt(s.fechaCrp3), 3),
        campo('Código Actividad ARL', txt(s.codigoArl), 3),
      )
      + fila(
        campo('Área Funcional de la SED', txt(s.areaFuncional), 6, { codigo: d.codigoArea }),
        campo('Nombre Interventor Contrato', txt(s.interventorNombre), 5),
        campo('Cargo Interventor Contrato', txt(s.interventorCargo), 5),
        campo('Nombre Operativo', txt(s.operativoNombre), 5),
        campo('Identificación Operativo', txt(s.operativoId), 3),
      )
      + fila(
        campo('Valor del Contrato sin IVA', vacio(s.valorTotal) ? '' : pesos(d.valorSinIva), 6),
        campo('Valor del IVA del Contrato', vacio(s.valorTotal) ? '' : pesos(d.valorIva), 6),
        `<div class="imp-campo imp-sin-borde" style="grid-column:span 12"></div>`,
      ));

    const lineaPregunta = (n, clave) => {
      const texto = literal ? esc(preguntas[clave] || '') : `${n}. ${esc(preguntas[clave] || '')}`;
      const resaltado = preguntas[clave + 'Resaltado'] ? ` <strong>${esc(preguntas[clave + 'Resaltado'])}</strong>` : '';
      return `<div class="imp-pregunta"><span class="imp-pregunta-texto">${texto}${resaltado}</span>${marcaSiNo(s[clave])}</div>`;
    };
    // El Excel resalta en rojo la codificación cuando hay que revisar algo o la persona es pensionada.
    const codificacion = txt(d.codificacion);
    const codAlerta = /REVISE|PENSIONADO/i.test(codificacion) ? ' imp-alerta' : '';
    const retencion = seccion('CERTIFICACIÓN APLICACIÓN RETENCIÓN EN LA FUENTE ARTÍCULOS 383 Y 387 DEL ESTATUTO TRIBUTARIO',
      `<div class="imp-preguntas">${[1, 2, 3, 4].map((n) => lineaPregunta(n, 'c' + n)).join('')}</div>`
      + (codificacion ? `<div class="imp-codificacion${codAlerta}"><span class="imp-rotulo">Codificación tributaria</span> ${esc(codificacion)}</div>` : ''),
      'FAVOR RESPONDA LAS SIGUIENTES PREGUNTAS:');

    const marcaDed = (k) => (s[k] === 'SI' ? 'FORMATO SED - CON ANEXOS' : '');
    const ahorro = (titulo, clave, ent, nit, valor) => {
      const activo = s[clave] === 'SI';
      return `<div class="imp-ahorro"><div class="imp-ahorro-titulo"><span>${esc(titulo)}</span>${marcaSiNo(s[clave])}</div>`
        + `<div class="imp-ahorro-fila"><span class="imp-rotulo">Entidad</span><span class="imp-valor">${activo ? esc(txt(s[ent])) : ''}&nbsp;</span></div>`
        + `<div class="imp-ahorro-fila"><span class="imp-rotulo">NIT</span><span class="imp-valor">${activo ? esc(txt(s[nit])) : ''}&nbsp;</span></div>`
        + `<div class="imp-ahorro-fila"><span class="imp-rotulo">Valor mensual</span><span class="imp-valor">${activo ? esc(pesos(s[valor])) : ''}&nbsp;</span></div></div>`;
    };
    const disminucion = seccion('DISMINUCIÓN DE LA BASE DE RETENCIÓN EN LA FUENTE',
      `<div class="imp-certificados"><div>CERTIFICADOS EXPEDIDOS CON CORTE AL 31 DE DICIEMBRE DE: <strong>${esc(d.anioCertificados)}</strong></div>`
      + `<div class="imp-nota">RECUERDE QUE ESTAS CERTIFICACIONES ESTARÁN VIGENTES HASTA EL 14 DE ABRIL DE <strong>${esc(d.anioVigenciaCertificados)}</strong>. `
      + `UNA VEZ CUMPLIDA ESA FECHA NO TENDRÁN NINGÚN EFECTO EN LA RETENCIÓN EN LA FUENTE.</div></div>`
      + fila(
        campo('Por dependientes', marcaDed('dedDependientes'), 8, { clase: 'imp-centro' }),
        campo('Crédito hipotecario', marcaDed('dedHipotecario'), 8, { clase: 'imp-centro' }),
        campo('Salud no POS', marcaDed('dedSaludNoPos'), 8, { clase: 'imp-centro' }),
      )
      + `<div class="imp-ahorros">${ahorro('Cuenta de Ahorro y Fomento a la Construcción (AFC)', 'afc', 'afcEntidad', 'afcNit', 'afcValor')}`
      + `${ahorro('Aporte a Pensiones Voluntarias', 'pensionesVoluntarias', 'pvEntidad', 'pvNit', 'pvValor')}</div>`);

    // Faltantes o alerta de IVA: el Excel los resalta (rojo / rosado); aquí con borde grueso y fondo gris.
    const mensaje = txt(d.mensajeFormulario);
    const mensajeAlerta = mensaje && !/^Información completa/i.test(mensaje) ? ' imp-alerta' : '';
    const certificacion = seccion('CERTIFICACIÓN DE LOS DATOS',
      `<div class="imp-juramento">${parrafos(d.textoCertificacion)}</div>`
      + (mensaje ? `<div class="imp-mensaje${mensajeAlerta}">${esc(mensaje)}</div>` : ''));

    const firma = `<div class="imp-firma"><div class="imp-firma-linea"></div>`
      + `<div class="imp-firma-nombre">${esc(txt(d.firmaNombre) === 'ERROR' ? d.nombreCompleto : txt(d.firmaNombre).replace(/\s+/g, ' '))}</div>`
      + `<div>${esc(txt(d.firmaDocumento))}</div><div>${esc(txt(d.firmaContrato))}</div></div>`;

    return `<section class="imp-hoja imp-hoja-datos">`
      + encabezado('FORMULARIO DE ACTUALIZACIÓN DE DATOS PARA PERSONAS NATURALES HONORARIOS Y SERVICIOS PERSONALES ART.103 DEL ET')
      + identificacion + pagos + tributario + contrato + retencion + disminucion + certificacion + firma
      + `</section>`;
  }

  // ───────────────────────── Hoja 2: deducciones ─────────────────────────

  function hojaDeducciones(s, d, hoy) {
    const C = catalogos();
    const dep = s.dedDependientes === 'SI';
    const sal = s.dedSaludNoPos === 'SI';
    const hip = s.dedHipotecario === 'SI';
    const si = (cond, v) => (cond ? v : '');

    const tercero = `<div class="imp-bloque"><h3 class="imp-titulo-bloque imp-izq">DATOS DEL TERCERO</h3>`
      + fila(campo('Nombres y apellidos del tercero', txt(d.nombreCompleto).replace(/\s+/g, ' '), 24))
      + fila(
        campo('Cédula de ciudadanía No.', txt(s.numeroId), 8),
        campo('No contrato', txt(s.numeroContrato), 8),
        campo('Año contrato', txt(s.anioContrato), 8),
      )
      + fila(
        campo('Fecha en la que se diligencia el formato', fechaDiligenciamiento(d, hoy), 12),
        campo('Año fiscal para el que aplicará el beneficio', txt(d.anioCertificados), 12),
      ) + `</div>`;

    const dependientes = `<div class="imp-bloque"><h3 class="imp-titulo-bloque">POR DEPENDIENTES</h3>`
      + `<div class="imp-sub">DATOS DEL DEPENDIENTE</div>`
      + fila(
        campo('Nombres y apellidos', si(dep, txt(s.depNombre)), 11),
        campo('No de identificación', si(dep, txt(s.depId)), 6),
        campo('Edad', si(dep, txt(s.depEdad)), 2, { clase: 'imp-centro' }),
        campo('Parentesco', si(dep, txt(s.depParentesco)), 5),
      )
      + fila(campo('Seleccione el motivo de la solicitud', si(dep, txt(s.depMotivo)), 24))
      + fila(
        campo('Valor mensual', si(dep, pesos(d.depValorMensual)), 8),
        campo('Como soporte se anexa la siguiente documentación', si(dep, txt(d.depAnexos)), 16),
      ) + `</div>`;

    const salud = `<div class="imp-bloque"><h3 class="imp-titulo-bloque">POR PAGOS EFECTUADOS POR CONTRATOS DE SALUD NO POS</h3>`
      + fila(
        campo('Nombre de la entidad', si(sal, txt(s.saludEntidad)), 12),
        campo('NIT entidad', si(sal, txt(s.saludNit)), 4),
        campo('Valor total pagado', si(sal, pesos(s.saludValorTotal)), 4),
        campo('Valor mensual', si(sal, pesos(d.saludValorMensual)), 4),
      )
      + fila(
        campo('Fecha expedición certificado', si(sal, fechaDma(s.saludFechaExpedicion)), 6),
        campo('Fecha corte del certificado', si(sal, fechaDma(s.saludFechaCorte)), 6),
        campo('Como soporte se anexa la siguiente documentación', si(sal, txt(d.saludTextoCertificado)), 12),
      ) + `</div>`;

    const hipotecario = `<div class="imp-bloque"><h3 class="imp-titulo-bloque">POR PAGO DE CRÉDITOS HIPOTECARIOS</h3>`
      + fila(
        campo('Nombre de la entidad', si(hip, txt(s.hipEntidad)), 12),
        campo('NIT entidad', si(hip, txt(s.hipNit)), 4),
        campo('Valor total interés pagado', si(hip, pesos(s.hipValorIntereses)), 4),
        campo('Valor mensual', si(hip, pesos(d.hipValorMensual)), 4),
      )
      + fila(
        campo('Fecha expedición certificado', si(hip, fechaDma(s.hipFechaExpedicion)), 5),
        campo('Fecha corte del certificado', si(hip, fechaDma(s.hipFechaCorte)), 5),
        campo('Cantidad de titulares del crédito', si(hip, txt(s.hipTitulares)), 3, { clase: 'imp-centro' }),
        campo('Como soporte se anexa la siguiente documentación', si(hip, txt(d.hipTextoCertificado)), 11),
      ) + `</div>`;

    const declaracion = `<div class="imp-declaracion">${parrafos(C.declaracionDeducciones)}</div>`
      + `<div class="imp-folios"><span>No de folios anexos</span><span class="imp-caja">${esc(txt(s.foliosAnexos))}</span></div>`;

    const firma = `<div class="imp-firma"><div class="imp-firma-linea"></div>`
      + `<div class="imp-firma-nombre">${esc(txt(d.nombreCompleto).replace(/\s+/g, ' '))}</div>`
      + `<div>${esc(txt(d.firmaDocumento) || txt(s.numeroId))}</div></div>`
      + `<div class="imp-autorizacion">${parrafos(C.autorizacionDeducciones)}</div>`;

    return `<section class="imp-hoja imp-hoja-deducciones">`
      + encabezado('FORMULARIO DISMINUCIÓN DE LA BASE DE RETENCIÓN EN LA FUENTE PERSONAS NATURALES OPS')
      + tercero + dependientes + salud + hipotecario + declaracion + firma
      + `</section>`;
  }

  // ───────────────────────── API ─────────────────────────

  function html(s, d, opts) {
    const st = s || {};
    const o = opts || {};
    const der = completarDerivados(st, d || derivados(st, o.hoy));
    let h = hojaDatos(st, der);
    if (necesitaHojaDeducciones(st)) h += hojaDeducciones(st, der, o.hoy);
    return h;
  }

  function raiz() {
    let el = document.getElementById(ID_RAIZ);
    if (!el) {
      el = document.createElement('div');
      el.id = ID_RAIZ;
      document.body.appendChild(el);
    }
    el.hidden = true; // print.css lo muestra solo al imprimir
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  // Área útil de una hoja carta: print.css deja @page sin margen (así el navegador no agrega su fecha,
  // título y URL) y da a cada hoja un relleno de 9 mm × 10 mm al imprimir.
  const ANCHO_UTIL_MM = 215.9 - 20;
  const ALTO_UTIL_MM = 279.4 - 18;
  const PX_POR_MM = 96 / 25.4;
  const ZOOM_MINIMO = 0.72;

  // Si una hoja no cabe en una página (p. ej. un mensaje de faltantes muy largo), la reduce con
  // `zoom` para que la firma no quede sola en otra página. Mide fuera de pantalla con el ancho útil y
  // busca el mayor zoom que cabe (al reducir, el texto se reacomoda y ocupa menos líneas).
  function ajustarAPagina(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    const hojas = Array.from(el.querySelectorAll('.imp-hoja'));
    const estiloPrevio = el.getAttribute('style');
    const ocultoPrevio = el.hidden;
    try {
      el.hidden = false;
      el.setAttribute('style', `display:block !important;position:absolute !important;left:-10000px;top:0;width:${ANCHO_UTIL_MM}mm;visibility:hidden;`);
      const maxPx = ALTO_UTIL_MM * PX_POR_MM * 0.985;
      for (const h of hojas) {
        h.style.zoom = '';
        const alto = h.getBoundingClientRect().height;
        if (!(alto > maxPx)) continue;
        const lineal = Math.max(ZOOM_MINIMO, Math.floor((maxPx / alto) * 1000) / 1000);
        const medir = (z) => { h.style.zoom = String(z); return h.getBoundingClientRect().height; };
        // Si el navegador no refleja el zoom en la medida, se usa la regla lineal.
        if (Math.abs(medir(0.9) - alto) < 1) { h.style.zoom = String(lineal); continue; }
        let lo = ZOOM_MINIMO;
        let hi = 1;
        if (medir(lo) > maxPx) { h.style.zoom = String(ZOOM_MINIMO); continue; }
        for (let i = 0; i < 7; i++) {
          const m = (lo + hi) / 2;
          if (medir(m) <= maxPx) lo = m; else hi = m;
        }
        h.style.zoom = String(Math.floor(lo * 1000) / 1000);
      }
    } catch (e) {
      /* sin layout (p. ej. jsdom): se imprime sin ajuste */
    } finally {
      if (estiloPrevio == null) el.removeAttribute('style'); else el.setAttribute('style', estiloPrevio);
      el.hidden = ocultoPrevio;
    }
  }

  function render(s, d, opts) {
    const el = raiz();
    el.innerHTML = html(s, d, opts);
    ajustarAPagina(el);
    return el;
  }

  // true mientras imprimir() abre el diálogo (el documento ya está armado con el estado que se pasó).
  let imprimiendoPropio = false;

  function imprimir(s, opts) {
    const o = opts || {};
    const st = s || {};
    const d = derivados(st, o.hoy);
    render(st, d, o);
    const tituloAnterior = document.title;
    const E = root.ExportExcel;
    if (E && typeof E.nombreArchivo === 'function') document.title = E.nombreArchivo(st);
    let restaurado = false;
    const restaurar = () => {
      if (restaurado) return;
      restaurado = true;
      imprimiendoPropio = false;
      document.title = tituloAnterior;
      root.removeEventListener && root.removeEventListener('afterprint', restaurar);
    };
    if (root.addEventListener) root.addEventListener('afterprint', restaurar);
    // Se resuelve cuando se cierra el diálogo de impresión (window.print() bloquea hasta entonces).
    return new Promise((resolve, reject) => {
      const lanzar = () => {
        try {
          imprimiendoPropio = true;
          root.print();
        } catch (e) {
          restaurar();
          reject(e);
          return;
        }
        setTimeout(() => { restaurar(); resolve(); }, 500);
      };
      // Esperar a que cargue el logo para que salga en el PDF.
      const img = document.querySelector('#' + ID_RAIZ + ' .imp-logo img');
      if (img && !img.complete) {
        let hecho = false;
        const una = () => { if (!hecho) { hecho = true; lanzar(); } };
        img.addEventListener('load', una, { once: true });
        img.addEventListener('error', una, { once: true });
        setTimeout(una, 1500);
      } else {
        lanzar();
      }
    });
  }

  // ───────────────────────── PDF directo ─────────────────────────
  // El documento es el mismo de la impresión: se arma en #impresion, se muestra fuera de la pantalla con el
  // ancho de una hoja carta y el relleno de impresión (clase imp-captura en print.css) y cada hoja se dibuja
  // en un lienzo. El texto queda como imagen (no se puede seleccionar), pero se ve igual que impreso.

  const CARTA_MM = { ancho: 215.9, alto: 279.4 };
  const ESCALA_CAPTURA = 2; // ~192 ppp: nítido al imprimir sin que el archivo pese demasiado

  const libJsPdf = () => (root.jspdf && root.jspdf.jsPDF) || root.jsPDF || null;
  const puedeGenerarPdf = () => typeof root.html2canvas === 'function' && typeof libJsPdf() === 'function';

  function nombreArchivo(s) {
    const E = root.ExportExcel;
    const base = E && typeof E.nombreArchivo === 'function' ? E.nombreArchivo(s || {}) : 'FORMULARIO_13-IF-016';
    return base + '.pdf';
  }

  function esperarImagenes(el) {
    const pendientes = Array.from(el.querySelectorAll('img')).filter((img) => !img.complete);
    return Promise.all(pendientes.map((img) => new Promise((listo) => {
      img.addEventListener('load', listo, { once: true });
      img.addEventListener('error', listo, { once: true });
      setTimeout(listo, 1500);
    })));
  }

  async function pdf(s, opts) {
    if (!puedeGenerarPdf()) throw new Error('Falta html2canvas o jsPDF');
    const o = opts || {};
    const st = s || {};
    const el = render(st, derivados(st, o.hoy), o);
    const estiloPrevio = el.getAttribute('style');
    const ocultoPrevio = el.hidden;
    el.hidden = false;
    el.classList.add('imp-captura');
    el.setAttribute('style', `display:block !important;position:absolute !important;left:-10000px;top:0;width:${CARTA_MM.ancho}mm;`);
    try {
      await esperarImagenes(el);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const JsPdf = libJsPdf();
      const doc = new JsPdf({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true });
      const hojas = Array.from(el.querySelectorAll('.imp-hoja'));
      for (let i = 0; i < hojas.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const lienzo = await root.html2canvas(hojas[i], { scale: ESCALA_CAPTURA, backgroundColor: '#ffffff', logging: false, useCORS: false });
        let ancho = CARTA_MM.ancho;
        let alto = (lienzo.height / lienzo.width) * ancho;
        if (alto > CARTA_MM.alto) { ancho *= CARTA_MM.alto / alto; alto = CARTA_MM.alto; }
        if (i > 0) doc.addPage('letter', 'portrait');
        doc.addImage(lienzo.toDataURL('image/jpeg', 0.92), 'JPEG', (CARTA_MM.ancho - ancho) / 2, 0, ancho, alto, undefined, 'FAST');
      }
      doc.setProperties({ title: nombreArchivo(st).replace(/\.pdf$/, ''), subject: 'Formato 13-IF-016', creator: 'Formulario 13-IF-016' });
      return doc.output('blob');
    } finally {
      el.classList.remove('imp-captura');
      if (estiloPrevio == null) el.removeAttribute('style'); else el.setAttribute('style', estiloPrevio);
      el.hidden = ocultoPrevio;
    }
  }

  // Ctrl+P o el menú del navegador (sin pasar por «Descargar PDF»): se arma el documento con el estado
  // actual del formulario, para que nunca salga una hoja en blanco ni con datos viejos.
  let tituloAntesDeImprimir = null;
  function antesDeImprimir() {
    if (imprimiendoPropio) return;
    const App = root.App;
    if (!App || typeof App.estadoLimpio !== 'function') return;
    try {
      const s = App.estadoLimpio();
      render(s, derivados(s));
      const E = root.ExportExcel;
      if (E && typeof E.nombreArchivo === 'function') {
        tituloAntesDeImprimir = document.title;
        document.title = E.nombreArchivo(s);
      }
    } catch (e) {
      if (root.console) console.error('No se pudo preparar la impresión', e);
    }
  }
  function despuesDeImprimir() {
    if (tituloAntesDeImprimir != null) {
      document.title = tituloAntesDeImprimir;
      tituloAntesDeImprimir = null;
    }
  }
  if (typeof document !== 'undefined' && root.addEventListener) {
    root.addEventListener('beforeprint', antesDeImprimir);
    root.addEventListener('afterprint', despuesDeImprimir);
  }

  const Imprimir = { render, imprimir, pdf, puedeGenerarPdf, nombreArchivo, html, necesitaHojaDeducciones };
  root.Imprimir = Imprimir;
  if (typeof module !== 'undefined' && module.exports) module.exports = Imprimir;
})(typeof window !== 'undefined' ? window : globalThis);
