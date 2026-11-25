// Creación de tercero: lo que no depende de la pantalla (la interfaz está en app.js).
// La persona adjunta cédula, RUT y certificación bancaria; se unen en un solo PDF (Imprimir.unir) que se descarga y
// se envía por el enlace de CONFIG.creacionTercero. Estos archivos no se guardan dentro del HTML.
// La creación no pide RIT ni aplica la vigencia de 60 días (CONFIG.diasVigenciaDocumentos), que es de la actualización.
//
// API (window.CreacionTercero):
//   DOCUMENTOS                     los tres documentos, en el orden en que van en el PDF
//   limites(cfg?)                  límites para Soportes.leer (de CONFIG.creacionTercero)
//   faltantes(docs) -> [doc]       documentos sin adjuntar; docs: { cedula: item, rut: item, banco: item }
//   enOrden(docs) -> [item]        los archivos adjuntos en el orden del PDF
//   documentoEquivocado(id, tipos) mensaje si el archivo es claramente otro documento, o ''
//   datosDelRut(res) -> { nit, nombre }   del Resultado de RutParser (persona natural o jurídica)
//   nombrePdf(datos, fecha?)       CREACION_TERCERO_NIT_NOMBRE.pdf, o con fecha y hora si no se pudo leer el RUT
(function (root) {
  'use strict';

  // tipo: lo que DocDetect reconoce en el PDF (solo 'RUT' y 'RIT'); vacío = no se reconoce por su texto.
  // nombre: cómo se nombra el documento dentro de una frase ("no la cédula").
  const DOCUMENTOS = [
    { id: 'cedula', tipo: '', titulo: 'Cédula', nombre: 'la cédula', descripcion: 'Copia de tu cédula de ciudadanía por ambas caras.' },
    { id: 'rut', tipo: 'RUT', titulo: 'RUT', nombre: 'el RUT', descripcion: 'Copia del RUT descargada de la DIAN.' },
    { id: 'banco', tipo: '', titulo: 'Certificación bancaria', nombre: 'la certificación bancaria', descripcion: 'Certificación de la cuenta a la que se harán los pagos.' },
  ];

  function limites(cfg) {
    const c = (cfg || root.CONFIG || {}).creacionTercero || {};
    const mb = Number(c.maxArchivoMb) > 0 ? Number(c.maxArchivoMb) : 15;
    const bytes = Math.round(mb * 1024 * 1024);
    return { maxArchivo: bytes, maxTotal: bytes * DOCUMENTOS.length, maxPorTipo: 1 };
  }

  const faltantes = (docs) => DOCUMENTOS.filter((d) => !(docs || {})[d.id]);
  const enOrden = (docs) => DOCUMENTOS.map((d) => (docs || {})[d.id]).filter(Boolean);

  /** tipos: lo que se reconoció en el PDF ('RUT', 'RIT'). Sin reconocer nada no se objeta: puede ser un escaneo. */
  function documentoEquivocado(id, tipos) {
    const doc = DOCUMENTOS.find((d) => d.id === id);
    const leidos = tipos || [];
    if (!doc || !leidos.length || leidos.includes(doc.tipo)) return '';
    // Un RIT no tiene espacio en la creación: se pide quitarlo en lugar de moverlo.
    const donde = DOCUMENTOS.some((d) => d.tipo === leidos[0]) ? ' Adjúntalo en el espacio que le corresponde.' : ' La creación de tercero no lo pide.';
    return 'Este archivo parece ser el ' + leidos[0] + ', no ' + doc.nombre + '.' + donde;
  }

  const valor = (c) => (c && c.valor != null ? String(c.valor).trim() : '');

  function datosDelRut(res) {
    const campos = (res && res.campos) || {};
    const extra = (res && res.extra) || {};
    // Persona jurídica: el parser no llena campos del formulario; sus datos quedan en extra.
    if (extra.datosPersonaJuridica) return { nit: valor(extra.datosPersonaJuridica.nit), nombre: String(extra.razonSocial || '').trim() };
    const nombre = ['primerNombre', 'otrosNombres', 'primerApellido', 'segundoApellido'].map((k) => valor(campos[k])).filter(Boolean).join(' ');
    return { nit: valor(campos.nit) || valor(campos.numeroId), nombre };
  }

  /** Mayúsculas, sin tildes y solo letras, números y guion bajo: el nombre tiene que servir en cualquier carpeta. */
  function parteNombre(t) {
    return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80).replace(/_+$/, '');
  }

  function nombrePdf(datos, fecha) {
    const d = datos || {};
    const nit = parteNombre(d.nit);
    if (nit) return ['CREACION_TERCERO', nit, parteNombre(d.nombre)].filter(Boolean).join('_') + '.pdf';
    // Sin NIT, la hora evita que dos terceros se pisen en la misma carpeta de envío.
    const f = fecha instanceof Date && !isNaN(fecha) ? fecha : new Date();
    const dos = (n) => String(n).padStart(2, '0');
    return 'CREACION_TERCERO_' + f.getFullYear() + dos(f.getMonth() + 1) + dos(f.getDate()) + '_' + dos(f.getHours()) + dos(f.getMinutes()) + dos(f.getSeconds()) + '.pdf';
  }

  const CreacionTercero = { DOCUMENTOS, limites, faltantes, enOrden, documentoEquivocado, datosDelRut, nombrePdf };
  root.CreacionTercero = CreacionTercero;
  if (typeof module !== 'undefined' && module.exports) module.exports = CreacionTercero;
})(typeof window !== 'undefined' ? window : globalThis);
