// Esquema único del formulario: pasos, campos, reglas y su celda en el Excel 13-IF-016.
// Es el contrato compartido entre la interfaz (app.js), los cálculos (calc.js),
// la lectura de PDF (parser-*.js) y la exportación (export-excel.js / print.js).
//
// Estado (`s`): objeto plano { idCampo: valor }. Todos los valores se guardan como string:
//   - fechas en ISO 'aaaa-mm-dd'
//   - dinero y números sin separadores ('4500000')
//   - sí/no como 'SI' | 'NO' | ''
//   - casillas (type 'check') como 'SI' | ''
//
// Mapeo Excel (`excel`):
//   hoja: 'datos' = 'FORMATO ACTUALIZACIÓN DATOS'   | 'deducciones' = 'FORMATO DEDUCCIONES'
//   tipo: 'texto'   -> cadena
//         'numero'  -> número
//         'auto'    -> número si son solo dígitos sin cero inicial, si no cadena
//         'fecha'   -> número de serie de Excel
//         'digitos' -> un carácter por celda en `celdas` (alineado a la izquierda)
//         'x'       -> escribe "X" en `si` o en `no` según el valor SI/NO
//         'marca'   -> escribe `valor` en `celda` si el campo es 'SI', si no deja vacío
(function () {
  const esColombia = (s) => (s.pais || '').toUpperCase() === 'COLOMBIA';
  const si = (k) => (s) => s[k] === 'SI';

  const steps = [
    { id: 'documentos', titulo: 'Documentos', corto: 'Documentos',
      descripcion: 'Carga tu RUT y tu RIT en PDF (los dos son obligatorios) y llenamos por ti la mayor parte del formulario.' },
    { id: 'personales', titulo: 'Datos personales', corto: 'Personales',
      descripcion: 'Tal como aparecen en tu RUT.' },
    { id: 'contacto', titulo: 'Dirección y contacto', corto: 'Contacto',
      descripcion: 'La dirección debe ser la misma registrada en el RUT.' },
    { id: 'pagos', titulo: 'Cuenta para pagos', corto: 'Pagos',
      descripcion: 'Cuenta donde la SED te consignará. Debe coincidir con tu certificación bancaria.' },
    { id: 'tributario', titulo: 'Información tributaria', corto: 'Tributario',
      descripcion: 'Actividad económica y régimen de IVA según tu RUT y RIT.' },
    { id: 'contrato', titulo: 'Datos del contrato', corto: 'Contrato',
      descripcion: 'Estos datos están en tu contrato (SECOP) o te los da tu supervisor.' },
    { id: 'retencion', titulo: 'Retención en la fuente y deducciones', corto: 'Retención',
      descripcion: 'Unas preguntas para calcular cuánto te retienen en cada pago (arts. 383 y 387 del Estatuto Tributario).' },
    { id: 'revision', titulo: 'Revisión y descarga', corto: 'Revisión',
      descripcion: 'Verifica, descarga el PDF para firmar y el Excel diligenciado.' },
  ];

  const f = {
    // ───────────── Datos personales ─────────────
    nit: { step: 'personales', label: 'NIT', type: 'digits', maxLength: 10, required: true, fuente: 'RUT',
      ayuda: 'Número de Identificación Tributaria según tu RUT, sin dígito de verificación.',
      excel: { hoja: 'datos', celda: 'A11', tipo: 'numero' } },
    dv: { step: 'personales', label: 'DV', type: 'digits', maxLength: 1, required: true, fuente: 'RUT', ancho: 'xs',
      ayuda: 'Dígito de verificación indicado en el RUT.',
      excel: { hoja: 'datos', celda: 'P11', tipo: 'numero' } },
    tipoDocumento: { step: 'personales', label: 'Tipo de documento', type: 'select', opciones: 'tiposDocumento',
      required: true, fuente: 'RUT', porDefecto: 'Cédula de ciudadanía ',
      excel: { hoja: 'datos', celda: 'AC11', tipo: 'texto' } },
    numeroId: { step: 'personales', label: 'Número de identificación', type: 'digits', maxLength: 10, required: true, fuente: 'RUT',
      ayuda: 'Sin puntos ni espacios y sin dígito de verificación. Para persona natural es igual al NIT.',
      excel: { hoja: 'datos', celda: 'AP11', tipo: 'numero' } },
    primerApellido: { step: 'personales', label: 'Primer apellido', type: 'upper', required: true, fuente: 'RUT',
      excel: { hoja: 'datos', celda: 'A16', tipo: 'texto' } },
    segundoApellido: { step: 'personales', label: 'Segundo apellido', type: 'upper', fuente: 'RUT',
      excel: { hoja: 'datos', celda: 'I16', tipo: 'texto' } },
    primerNombre: { step: 'personales', label: 'Primer nombre', type: 'upper', required: true, fuente: 'RUT',
      excel: { hoja: 'datos', celda: 'Q16', tipo: 'texto' } },
    otrosNombres: { step: 'personales', label: 'Otros nombres', type: 'upper', fuente: 'RUT',
      excel: { hoja: 'datos', celda: 'Y16', tipo: 'texto' } },
    pensionado: { step: 'personales', label: '¿Eres pensionado o ya adquiriste los derechos para serlo?', type: 'yesno', required: true,
      ayuda: 'Si no estás seguro, confírmalo con la supervisión de tu contrato.',
      excel: { hoja: 'datos', tipo: 'x', si: 'Q18', no: 'S18' } },

    // ───────────── Dirección y contacto ─────────────
    direccion: { step: 'contacto', label: 'Dirección reportada en el RUT', type: 'upper', required: true, fuente: 'RUT', ancho: 'full',
      excel: { hoja: 'datos', celda: 'AC18', tipo: 'texto' } },
    pais: { step: 'contacto', label: 'País', type: 'combo', opciones: 'paises', required: true, fuente: 'RUT', porDefecto: 'COLOMBIA',
      excel: { hoja: 'datos', celda: 'A21', tipo: 'texto' } },
    departamento: { step: 'contacto', label: 'Departamento', type: 'select', opciones: 'departamentos', fuente: 'RUT',
      visible: esColombia, required: esColombia,
      excel: { hoja: 'datos', celda: 'T21', tipo: 'texto' } },
    municipio: { step: 'contacto', label: 'Municipio', type: 'combo', opciones: 'municipiosDelDepartamento', fuente: 'RUT',
      visible: esColombia, required: esColombia,
      excel: { hoja: 'datos', celda: 'AM21', tipo: 'texto' } },
    email: { step: 'contacto', label: 'Correo electrónico', type: 'email', required: true, fuente: 'RUT', ancho: 'full',
      excel: { hoja: 'datos', celda: 'A24', tipo: 'texto' } },
    telefono1: { step: 'contacto', label: 'Teléfono 1', type: 'tel', required: true, fuente: 'RUT',
      ayuda: 'Obligatorio. 10 dígitos. Si no tienes teléfono fijo escribe 0.',
      excel: { hoja: 'datos', celda: 'AG24', tipo: 'auto' } },
    telefono2: { step: 'contacto', label: 'Teléfono 2 (celular)', type: 'tel', required: true, fuente: 'RUT',
      ayuda: 'Número de celular de 10 dígitos.',
      excel: { hoja: 'datos', celda: 'AR24', tipo: 'auto' } },

    // ───────────── Cuenta para pagos ─────────────
    banco: { step: 'pagos', label: 'Banco', type: 'combo', opciones: 'bancos', required: true, ancho: 'full',
      ayuda: 'Entidad financiera autorizada por la Superintendencia Financiera.',
      excel: { hoja: 'datos', celda: 'A31', tipo: 'texto' } },
    sucursal: { step: 'pagos', label: 'Sucursal', type: 'upper', maxLength: 16, required: true,
      ayuda: 'Oficina donde se abrió la cuenta (máximo 16 caracteres).',
      excel: { hoja: 'datos', celda: 'Q31', tipo: 'texto' } },
    tipoCuenta: { step: 'pagos', label: 'Tipo de cuenta', type: 'select', opciones: 'tiposCuenta', required: true,
      excel: { hoja: 'datos', celda: 'Z31', tipo: 'texto' } },
    numeroCuenta: { step: 'pagos', label: 'Número de cuenta', type: 'digits', maxLength: 16, required: true, ancho: 'full',
      ayuda: 'Solo números, sin guiones ni espacios (máximo 16 dígitos).',
      excel: { hoja: 'datos', tipo: 'digitos',
        celdas: ['AN31', 'AO31', 'AP31', 'AQ31', 'AR31', 'AS31', 'AT31', 'AU31', 'AV31', 'AW31', 'AX31', 'AY31', 'AZ31', 'BA31', 'BB31', 'BC31'] } },

    // ───────────── Información tributaria ─────────────
    actividadRut: { step: 'tributario', label: 'Actividad económica principal (RUT)', type: 'combo', opciones: 'ciiu', required: true, fuente: 'RUT', ancho: 'full',
      ayuda: 'Código CIIU de 4 dígitos de la casilla 46 del RUT.',
      excel: { hoja: 'datos', tipo: 'digitos', celdas: ['A39', 'B39', 'C39', 'D39'] } },
    actividadRit: { step: 'tributario', label: 'Actividad económica principal (RIT)', type: 'combo', opciones: 'rit', required: true, fuente: 'RIT', ancho: 'full',
      ayuda: 'Código de actividad de Industria y Comercio registrado en el RIT de Bogotá. Debe corresponder a la actividad que realizas en el contrato (Acuerdo 065 de 2002, art. 11).',
      excel: { hoja: 'datos', tipo: 'digitos', celdas: ['X39', 'Y39', 'Z39', 'AA39', 'AB39'] } },
    regimenIva: { step: 'tributario', label: 'Régimen de IVA', type: 'select', opciones: 'regimenIva', required: true, fuente: 'RUT',
      ayuda: 'En la casilla 53 de tu RUT: 48 = Responsable de IVA, 49 = No responsable.',
      excel: { hoja: 'datos', celda: 'AU39', tipo: 'texto' } },

    // ───────────── Contrato ─────────────
    numeroContrato: { step: 'contrato', grupo: 'Contrato', label: 'Número de contrato', type: 'text', maxLength: 8, required: true,
      ayuda: 'Solo el número, según SECOP (por ejemplo 1234).',
      // 'numero': '0123' se guarda como 123, igual que si se escribiera en Excel. Así 'FORMATO DEDUCCIONES'!S13
      // (=IF(A46, A46, " ")) no da #VALUE!; con letras ('CD-123') el Excel original también da #VALUE!.
      excel: { hoja: 'datos', celda: 'A46', tipo: 'numero' } },
    anioContrato: { step: 'contrato', grupo: 'Contrato', label: 'Año del contrato', type: 'digits', maxLength: 4, required: true,
      ayuda: 'Año de suscripción en SECOP.',
      excel: { hoja: 'datos', celda: 'F46', tipo: 'numero' } },
    valorTotal: { step: 'contrato', grupo: 'Contrato', label: 'Valor total del contrato', type: 'money', required: true,
      ayuda: 'En pesos, sin centavos.',
      excel: { hoja: 'datos', celda: 'K46', tipo: 'numero' } },
    valorMensual: { step: 'contrato', grupo: 'Contrato', label: 'Valor del pago mensual', type: 'money', required: true,
      ayuda: 'Según el contrato y los estudios previos.',
      excel: { hoja: 'datos', celda: 'A50', tipo: 'numero' } },
    fechaInicio: { step: 'contrato', grupo: 'Contrato', label: 'Fecha del acta de inicio', type: 'date', required: true,
      excel: { hoja: 'datos', celda: 'AC46', tipo: 'fecha' } },
    fechaTerminacion: { step: 'contrato', grupo: 'Contrato', label: 'Fecha de terminación', type: 'date', required: true,
      excel: { hoja: 'datos', celda: 'AN46', tipo: 'fecha' } },
    cesion: { step: 'contrato', grupo: 'Contrato', label: '¿El contrato fue cedido?', type: 'yesno', required: true,
      excel: { hoja: 'datos', celda: 'AY46', tipo: 'texto' } },
    codigoArl: { step: 'contrato', grupo: 'Contrato', label: 'Código de actividad ARL', type: 'combo', opciones: 'arl', required: true, ancho: 'full',
      ayuda: 'El código que aparece en tu certificado de afiliación a la ARL.',
      excel: { hoja: 'datos', celda: 'AX50', tipo: 'numero' } },

    crp1: { step: 'contrato', grupo: 'Registro presupuestal (CRP)', label: 'Número CRP 1', type: 'text', required: true,
      ayuda: 'Número del Certificado de Registro Presupuestal. Si no lo tienes, pídeselo a tu supervisor o a tu operativo.',
      excel: { hoja: 'datos', celda: 'N50', tipo: 'auto' } },
    fechaCrp1: { step: 'contrato', grupo: 'Registro presupuestal (CRP)', label: 'Fecha CRP 1', type: 'date', required: true,
      excel: { hoja: 'datos', celda: 'Q50', tipo: 'fecha' } },
    rpVigenciaFutura: { step: 'contrato', grupo: 'Registro presupuestal (CRP)', label: '¿Tu contrato usa recursos de vigencias futuras?', type: 'yesno', required: true,
      ayuda: 'Si no sabes, pregúntale a tu supervisor.',
      excel: { hoja: 'datos', celda: 'V50', tipo: 'texto' } },
    crp2: { step: 'contrato', grupo: 'Registro presupuestal (CRP)', label: 'Número CRP 2', type: 'text', opcionalPlegable: 'crpAdicional',
      excel: { hoja: 'datos', celda: 'AC50', tipo: 'auto' } },
    fechaCrp2: { step: 'contrato', grupo: 'Registro presupuestal (CRP)', label: 'Fecha CRP 2', type: 'date', opcionalPlegable: 'crpAdicional',
      excel: { hoja: 'datos', celda: 'AF50', tipo: 'fecha' } },
    crp3: { step: 'contrato', grupo: 'Registro presupuestal (CRP)', label: 'Número CRP 3', type: 'text', opcionalPlegable: 'crpAdicional',
      excel: { hoja: 'datos', celda: 'AN50', tipo: 'auto' } },
    fechaCrp3: { step: 'contrato', grupo: 'Registro presupuestal (CRP)', label: 'Fecha CRP 3', type: 'date', opcionalPlegable: 'crpAdicional',
      excel: { hoja: 'datos', celda: 'AQ50', tipo: 'fecha' } },

    areaFuncional: { step: 'contrato', grupo: 'Supervisión y seguimiento', label: 'Área funcional de la SED', type: 'combo', opciones: 'areas', required: true, ancho: 'full',
      excel: { hoja: 'datos', celda: 'A53', tipo: 'texto' } },
    interventorNombre: { step: 'contrato', grupo: 'Supervisión y seguimiento', label: 'Nombre del interventor / supervisor', type: 'upper', required: true,
      excel: { hoja: 'datos', celda: 'J53', tipo: 'texto' } },
    interventorCargo: { step: 'contrato', grupo: 'Supervisión y seguimiento', label: 'Cargo del interventor / supervisor', type: 'upper', required: true,
      excel: { hoja: 'datos', celda: 'S53', tipo: 'texto' } },
    operativoNombre: { step: 'contrato', grupo: 'Supervisión y seguimiento', label: 'Nombre del operativo', type: 'upper', required: true,
      ayuda: 'La persona que tramita tus cuentas de cobro y a quien se asocia el CRP.',
      excel: { hoja: 'datos', celda: 'Z53', tipo: 'texto' } },
    operativoId: { step: 'contrato', grupo: 'Supervisión y seguimiento', label: 'Identificación del operativo', type: 'digits', maxLength: 12, required: true,
      excel: { hoja: 'datos', celda: 'AH53', tipo: 'auto' } },

    // ───────────── Retención (preguntas C1–C4) ─────────────
    c1: { step: 'retencion', grupo: 'Preguntas', label: 'C1', type: 'yesno', required: true, pregunta: 'c1',
      excel: { hoja: 'datos', tipo: 'x', si: 'BA61', no: 'BC61' } },
    c2: { step: 'retencion', grupo: 'Preguntas', label: 'C2', type: 'yesno', required: true, pregunta: 'c2',
      excel: { hoja: 'datos', tipo: 'x', si: 'BA64', no: 'BC64' } },
    c3: { step: 'retencion', grupo: 'Preguntas', label: 'C3', type: 'yesno', required: true, pregunta: 'c3', fuente: 'RUT',
      excel: { hoja: 'datos', tipo: 'x', si: 'BA67', no: 'BC67' } },
    c4: { step: 'retencion', grupo: 'Preguntas', label: 'C4', type: 'yesno', required: true, pregunta: 'c4',
      excel: { hoja: 'datos', tipo: 'x', si: 'BA70', no: 'BC70' } },

    // ───────────── Deducciones (hoja principal) ─────────────
    dedDependientes: { step: 'retencion', grupo: 'Deducciones', label: 'Por dependientes', type: 'check',
      excel: { hoja: 'datos', celda: 'D80', tipo: 'marca', valor: 'FORMATO SED - CON ANEXOS' } },
    dedHipotecario: { step: 'retencion', grupo: 'Deducciones', label: 'Intereses de crédito hipotecario', type: 'check',
      excel: { hoja: 'datos', celda: 'M80', tipo: 'marca', valor: 'FORMATO SED - CON ANEXOS' } },
    dedSaludNoPos: { step: 'retencion', grupo: 'Deducciones', label: 'Salud no POS (fuera del plan obligatorio de salud)', type: 'check',
      excel: { hoja: 'datos', celda: 'V80', tipo: 'marca', valor: 'FORMATO SED - CON ANEXOS' } },

    afc: { step: 'retencion', grupo: 'Ahorro', label: '¿Haces aportes a una cuenta AFC (Ahorro para el Fomento a la Construcción)?', type: 'yesno', required: true,
      excel: { hoja: 'datos', tipo: 'x', si: 'S82', no: 'V82' } },
    afcEntidad: { step: 'retencion', grupo: 'Ahorro', label: 'Entidad (AFC)', type: 'upper', visible: si('afc'), required: si('afc'),
      excel: { hoja: 'datos', celda: 'I83', tipo: 'texto' } },
    afcNit: { step: 'retencion', grupo: 'Ahorro', label: 'NIT de la entidad (AFC)', type: 'digits', maxLength: 10, visible: si('afc'), required: si('afc'),
      excel: { hoja: 'datos', celda: 'I84', tipo: 'auto' } },
    afcValor: { step: 'retencion', grupo: 'Ahorro', label: 'Valor mensual (AFC)', type: 'money', visible: si('afc'), required: si('afc'),
      excel: { hoja: 'datos', celda: 'I85', tipo: 'numero' } },
    pensionesVoluntarias: { step: 'retencion', grupo: 'Ahorro', label: '¿Haces aportes a pensiones voluntarias?', type: 'yesno', required: true,
      excel: { hoja: 'datos', tipo: 'x', si: 'AX82', no: 'BA82' } },
    pvEntidad: { step: 'retencion', grupo: 'Ahorro', label: 'Entidad (pensiones voluntarias)', type: 'upper', visible: si('pensionesVoluntarias'), required: si('pensionesVoluntarias'),
      excel: { hoja: 'datos', celda: 'AN83', tipo: 'texto' } },
    pvNit: { step: 'retencion', grupo: 'Ahorro', label: 'NIT de la entidad (pensiones voluntarias)', type: 'digits', maxLength: 10, visible: si('pensionesVoluntarias'), required: si('pensionesVoluntarias'),
      excel: { hoja: 'datos', celda: 'AN84', tipo: 'auto' } },
    pvValor: { step: 'retencion', grupo: 'Ahorro', label: 'Valor mensual (pensiones voluntarias)', type: 'money', visible: si('pensionesVoluntarias'), required: si('pensionesVoluntarias'),
      excel: { hoja: 'datos', celda: 'AN85', tipo: 'numero' } },

    // ───────────── Hoja 'FORMATO DEDUCCIONES' ─────────────
    depNombre: { step: 'retencion', grupo: 'Dependiente', label: 'Nombres y apellidos del dependiente', type: 'upper', visible: si('dedDependientes'), required: si('dedDependientes'), ancho: 'full',
      excel: { hoja: 'deducciones', celda: 'B22', tipo: 'texto' } },
    depId: { step: 'retencion', grupo: 'Dependiente', label: 'Número de identificación', type: 'digits', maxLength: 12, visible: si('dedDependientes'), required: si('dedDependientes'),
      excel: { hoja: 'deducciones', celda: 'O22', tipo: 'auto' } },
    depEdad: { step: 'retencion', grupo: 'Dependiente', label: 'Edad', type: 'digits', maxLength: 3, visible: si('dedDependientes'), required: si('dedDependientes'), ancho: 'xs',
      ayuda: 'Edad actual.',
      excel: { hoja: 'deducciones', celda: 'U22', tipo: 'numero' } },
    // En el Excel W22 es texto libre (sin lista): se sugieren los parentescos del instructivo, pero se acepta cualquiera.
    depParentesco: { step: 'retencion', grupo: 'Dependiente', label: 'Parentesco', type: 'upper', visible: si('dedDependientes'), required: si('dedDependientes'),
      sugerencias: ['HIJO', 'HIJA', 'CÓNYUGE', 'COMPAÑERO PERMANENTE', 'COMPAÑERA PERMANENTE', 'PADRE', 'MADRE', 'HERMANO', 'HERMANA', 'OTRO DEPENDIENTE'],
      ayuda: 'Por ejemplo: hijo, hija, cónyuge, padre o madre.',
      excel: { hoja: 'deducciones', celda: 'W22', tipo: 'texto' } },
    depMotivo: { step: 'retencion', grupo: 'Dependiente', label: 'Motivo de la solicitud', type: 'select', opciones: 'motivosDependientes', visible: si('dedDependientes'), required: si('dedDependientes'), ancho: 'full',
      excel: { hoja: 'deducciones', celda: 'B25', tipo: 'texto' } },

    saludEntidad: { step: 'retencion', grupo: 'Salud no POS', label: 'Nombre de la entidad', type: 'upper', visible: si('dedSaludNoPos'), required: si('dedSaludNoPos'), ancho: 'full',
      excel: { hoja: 'deducciones', celda: 'H35', tipo: 'texto' } },
    saludNit: { step: 'retencion', grupo: 'Salud no POS', label: 'NIT de la entidad', type: 'digits', maxLength: 10, visible: si('dedSaludNoPos'), required: si('dedSaludNoPos'),
      excel: { hoja: 'deducciones', celda: 'E37', tipo: 'auto' } },
    saludValorTotal: { step: 'retencion', grupo: 'Salud no POS', label: 'Valor total pagado en el año', type: 'money', visible: si('dedSaludNoPos'), required: si('dedSaludNoPos'),
      ayuda: 'Lo pagado durante el período que certifica la entidad.',
      excel: { hoja: 'deducciones', celda: 'Y37', tipo: 'numero' } },
    saludFechaExpedicion: { step: 'retencion', grupo: 'Salud no POS', label: 'Fecha de expedición del certificado', type: 'date', visible: si('dedSaludNoPos'), required: si('dedSaludNoPos'),
      ayuda: 'El día en que la entidad expidió el certificado.',
      excel: { hoja: 'deducciones', celda: 'J40', tipo: 'fecha' } },
    saludFechaCorte: { step: 'retencion', grupo: 'Salud no POS', label: 'Fecha de corte del certificado', type: 'date', visible: si('dedSaludNoPos'), required: si('dedSaludNoPos'),
      ayuda: 'La fecha hasta la cual el certificado incluye pagos.',
      excel: { hoja: 'deducciones', celda: 'Y40', tipo: 'fecha' } },

    hipEntidad: { step: 'retencion', grupo: 'Crédito hipotecario', label: 'Nombre de la entidad', type: 'upper', visible: si('dedHipotecario'), required: si('dedHipotecario'), ancho: 'full',
      excel: { hoja: 'deducciones', celda: 'H46', tipo: 'texto' } },
    hipNit: { step: 'retencion', grupo: 'Crédito hipotecario', label: 'NIT de la entidad', type: 'digits', maxLength: 10, visible: si('dedHipotecario'), required: si('dedHipotecario'),
      excel: { hoja: 'deducciones', celda: 'E48', tipo: 'auto' } },
    hipValorIntereses: { step: 'retencion', grupo: 'Crédito hipotecario', label: 'Valor total de intereses pagados', type: 'money', visible: si('dedHipotecario'), required: si('dedHipotecario'),
      ayuda: 'El valor deducible que certifica la entidad financiera.',
      excel: { hoja: 'deducciones', celda: 'Y48', tipo: 'numero' } },
    hipFechaExpedicion: { step: 'retencion', grupo: 'Crédito hipotecario', label: 'Fecha de expedición del certificado', type: 'date', visible: si('dedHipotecario'), required: si('dedHipotecario'),
      ayuda: 'El día en que la entidad expidió el certificado.',
      excel: { hoja: 'deducciones', celda: 'J52', tipo: 'fecha' } },
    hipFechaCorte: { step: 'retencion', grupo: 'Crédito hipotecario', label: 'Fecha de corte del certificado', type: 'date', visible: si('dedHipotecario'), required: si('dedHipotecario'),
      ayuda: 'La fecha hasta la cual el certificado incluye pagos.',
      excel: { hoja: 'deducciones', celda: 'Y52', tipo: 'fecha' } },
    hipTitulares: { step: 'retencion', grupo: 'Crédito hipotecario', label: 'Cantidad de titulares del crédito', type: 'digits', maxLength: 2, visible: si('dedHipotecario'), required: si('dedHipotecario'), ancho: 'xs',
      ayuda: 'Las personas que figuran en el crédito.',
      excel: { hoja: 'deducciones', celda: 'L54', tipo: 'numero' } },

    foliosAnexos: { step: 'retencion', grupo: 'Anexos', label: 'Número de folios anexos', type: 'digits', maxLength: 3, ancho: 'xs',
      visible: (s) => s.dedDependientes === 'SI' || s.dedHipotecario === 'SI' || s.dedSaludNoPos === 'SI',
      excel: { hoja: 'deducciones', celda: 'G62', tipo: 'numero' } },
  };

  // Preguntas C1–C4 tal como se muestran en pantalla (lenguaje sencillo; se arman con CONFIG cada año).
  // El documento para firmar usa el texto literal del Excel: preguntasFormato().
  function preguntas(cfg) {
    const pesos = (n) => '$ ' + Math.round(n).toLocaleString('es-CO');
    return {
      c1: `¿Mis ingresos del año gravable ${cfg.anioGravable} fueron superiores a ${pesos(cfg.ingresosC1Uvt * cfg.uvt)}, equivalentes a ${cfg.ingresosC1Uvt.toLocaleString('es-CO')} UVT?`,
      c2: `¿Estoy obligada(o) a declarar impuesto de renta para el año ${cfg.anioGravable}?`,
      c3: '¿Pertenezco al Régimen Simple de Tributación – SIMPLE? (Ley 2010 de 2019). Si la DIAN no me ha catalogado como SIMPLE, respondo NO.',
      c4: '¿Voy a restar costos y gastos de mi actividad para calcular la retención en la fuente?',
    };
  }

  // Texto literal de 'FORMATO ACTUALIZACIÓN DATOS'!C61, C64, C67 y C70 (la certificación que se firma).
  // Solo cambian el año gravable, el tope en pesos y las UVT (CONFIG). En C3 la instrucción final va
  // aparte (c3Resaltado) porque el Excel la resalta.
  function preguntasFormato(cfg) {
    // '$ 73´323.600': así escribe el Excel el separador de millones.
    const pesos = (n) => {
      const grupos = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').split(' ');
      return '$ ' + grupos.map((g, i) => (i === 0 ? g : (grupos.length - i === 2 ? '´' : '.') + g)).join('');
    };
    return {
      c1: `1. ¿Mis ingresos del año gravable ${cfg.anioGravable} fueron superiores a ${pesos(cfg.ingresosC1Uvt * cfg.uvt)}  equivalentes a ${cfg.ingresosC1Uvt.toLocaleString('es-CO')} UVT?`,
      c2: `2. ¿Estoy obligada(o) a declarar Impuesto de Renta para el año ${cfg.anioGravable}? (Ver artículo 592 del Estatuto Tributario)`,
      c3: '3.¿Pertenezco al Régimen Simple de Tributación -SIMPLE?  (LEY 2010 DE 2019)',
      c3Resaltado: 'SI LA DIAN NO ME HA CATALOGADO COMO SIMPLE COLOCO LA "X" EN NO',
      c4: '4. El trabajador empleará costos y gastos de acuerdo al  Decreto 2231 de 2023',
    };
  }

  window.SCHEMA = { steps, fields: f, preguntas, preguntasFormato, nombresHojas: {
    datos: 'FORMATO ACTUALIZACIÓN DATOS',
    deducciones: 'FORMATO DEDUCCIONES',
  } };
})();
