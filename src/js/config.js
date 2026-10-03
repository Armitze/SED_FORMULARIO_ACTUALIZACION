// Parámetros que la SED debe revisar cada año (equivalen a las celdas fijas del Excel).
window.CONFIG = {
  formato: { codigo: '13-IF-016', version: 'V.1' },

  // 'Validador- Datos'!BI2:BK2 — UVT vigente y límite de cuantía para IVA.
  uvt: 52374,
  uvtAnio: 2026,
  limiteIvaUvt: 4000,

  // Pregunta C1: "¿Mis ingresos del año gravable 2025 fueron superiores a 1.400 UVT?"
  anioGravable: 2025,
  ingresosC1Uvt: 1400,

  // Validaciones de datos del Excel (F46, AC46, Q50, ...).
  anioContratoMin: 2025,
  anioContratoMax: 2026,
  fechaMin: '2016-01-01', // 42370
  fechaMax: '2030-12-31', // 47848

  // 'Validador- Datos'!BI6:BO9 — topes de deducciones (art. 387 ET).
  deducciones: {
    dependientesPorcentaje: 0.10,
    dependientesMaxUvtMes: 32,
    saludMaxUvtMes: 16,
    interesesMaxUvtMes: 100,
  },

  // Fechas de corte para el año de los certificados ('Validador- Datos'!BI13:BI17).
  // Antes del 1 de abril se usan certificados de dos años atrás; desde el 1 de abril, del año anterior.
  mesDiaCorteCertificados: '04-01',

  correoRadicacion: 'actualizarterceros@educacionbogota.gov.co',

  // Consulta del contrato en SECOP II (Datos Abiertos Colombia, conjunto jbjy-vk9h "Contratos Electrónicos").
  secop: {
    url: 'https://www.datos.gov.co/api/v3/views/jbjy-vk9h/query.json',
    codigoEntidad: '701321135', // Secretaría de Educación del Distrito
    estadosExcluidos: ['Borrador', 'Cancelado', 'Cerrado', 'terminado'],
    tiempoMaximoMs: 20000,
  },
  textoBancos: 'Bancos autorizados por la Superintendencia Financiera',
};
