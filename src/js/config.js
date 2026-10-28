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

  // El RUT y el RIT deben estar impresos hace máximo estos días (fecha de generación del PDF del RUT y
  // «Fecha:» del certificado RIT); si no, el formulario no deja avanzar hasta cargar uno reciente.
  diasVigenciaDocumentos: 60,

  // Códigos de actividad ARL que se pueden elegir (la tabla completa del Excel tiene 1.670). Vacío = todos.
  arlActivas: [
    '1464901', '1511201', '1582001', '1620101', '1620202', '1620901', '1661901', '1691001', '1692001', '1701001',
    '1702001', '1711001', '1722001', '1724001', '1729001', '1741101', '1749001', '1749101', '1751301', '1804201',
    '1829902', '1841101', '1841201', '1841202', '1841204', '1841205', '1841301', '1851201', '1852201', '1854201',
    '1856001', '1900101', '1900401', '1949902', '3581301', '3612001', '3642201', '5711001',
  ],

  correoRadicacion:'actualizarterceros@educacionbogota.gov.co',

  // Soportes que se guardan dentro del archivo (certificación bancaria y certificados de deducciones).
  // Van codificados en el HTML (ocupan un 33 % más), así que el total se limita para que guardar siga siendo rápido.
  soportes: { maxArchivoMb: 4, maxTotalMb: 12, maxPorTipo: 5 },

  // Consulta del contrato en SECOP II (Datos Abiertos Colombia, conjunto jbjy-vk9h "Contratos Electrónicos").
  // La API v3 (url) exige un token de aplicación gratuito de datos.gov.co (Perfil → Configuración del desarrollador →
  // Crear nuevo token de aplicación). Con appToken la cédula va en el cuerpo de la petición; sin él se usa urlAbierta,
  // donde va en la URL. El token queda visible dentro del HTML: solo sirve para la cuota de consultas.
  secop: {
    url: 'https://www.datos.gov.co/api/v3/views/jbjy-vk9h/query.json',
    urlAbierta: 'https://www.datos.gov.co/resource/jbjy-vk9h.json',
    appToken: '',
    codigoEntidad: '701321135', // Secretaría de Educación del Distrito
    estadosExcluidos: ['Borrador', 'Cancelado', 'Cerrado', 'terminado'],
    tiempoMaximoMs: 20000,
  },
  // Aviso de nueva versión: al abrir, el formulario consulta version.json (lo escribe tools/build.mjs).
  // Las dos direcciones deben poder leerse sin iniciar sesión (repositorio público).
  actualizaciones: {
    versionUrl: 'https://raw.githubusercontent.com/Armitze/SED_FORMULARIO_ACTUALIZACION/main/version.json',
    htmlUrl: 'https://raw.githubusercontent.com/Armitze/SED_FORMULARIO_ACTUALIZACION/main/formulario-13-IF-016.html',
    tiempoMaximoMs: 8000,
  },
  textoBancos: 'Bancos autorizados por la Superintendencia Financiera',
};
