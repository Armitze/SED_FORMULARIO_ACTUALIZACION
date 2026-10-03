// Pruebas de window.Calc (src/js/calc.js).
//
//   node --test tests/calc.test.mjs
//
// 1. Unidades: dvNit, fechas, formato de pesos, mapeo estado → celdas, regla del año de certificados, validar().
// 2. Paridad con Excel: construye escenarios desde objetos de estado del formulario, los convierte en celdas
//    de entrada con el mapeo del esquema, los escribe en una COPIA de la plantilla con Excel (COM, mediante
//    tests/paridad-excel.ps1), recalcula y compara TODAS las celdas calculadas con Calc.evaluar/derivados.
//    Se omite si no hay Excel o PowerShell (o con la variable de entorno SIN_EXCEL=1).
//    Todos los datos son ficticios.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

globalThis.window = globalThis;
require(path.join(RAIZ, 'src/js/catalogos.js'));
require(path.join(RAIZ, 'src/js/config.js'));
require(path.join(RAIZ, 'src/js/schema.js'));
const Calc = require(path.join(RAIZ, 'src/js/calc.js'));
const { CATALOGOS, CONFIG, SCHEMA } = globalThis;

const HOY_FIJO = '2026-10-01';

// ───────────────────────── Estado base (completo y válido) ─────────────────────────
function base(extra) {
  const nit = '52345678';
  return {
    nit, dv: Calc.dvNit(nit), tipoDocumento: 'Cédula de ciudadanía ', numeroId: nit,
    primerApellido: 'PÉREZ', segundoApellido: 'GÓMEZ', primerNombre: 'MARÍA', otrosNombres: 'JOSÉ',
    pensionado: 'NO', direccion: 'CL 26 # 69-76 OF 201', pais: 'COLOMBIA', departamento: 'Bogotá D.C', municipio: 'BOGOTÁ',
    email: 'maria.perez@example.com', telefono1: '6013241000', telefono2: '3001234567',
    banco: 'Banco Davivienda S.A.', sucursal: 'CHAPINERO', tipoCuenta: 'Ahorros', numeroCuenta: '008800123456',
    actividadRut: '8559', actividadRit: '8559', regimenIva: 'NO RESPONSABLE IVA',
    numeroContrato: '1234', anioContrato: '2026', valorTotal: '30000000', valorMensual: '5000000',
    fechaInicio: '2026-02-01', fechaTerminacion: '2026-07-31', cesion: 'NO', codigoArl: '114001',
    crp1: '4567', fechaCrp1: '2026-01-25', rpVigenciaFutura: 'NO',
    areaFuncional: 'Despacho Del Secretario', interventorNombre: 'ANA RUIZ', interventorCargo: 'DIRECTORA',
    operativoNombre: 'LUIS GÓMEZ', operativoId: '79123456',
    c1: 'NO', c2: 'NO', c3: 'NO', c4: 'SI', afc: 'NO', pensionesVoluntarias: 'NO',
    ...extra,
  };
}
const MOTIVO_HIJO = CATALOGOS.motivosDependientes[0].texto;
const MOTIVO_PADRES = CATALOGOS.motivosDependientes[4].texto;
const deducciones = (extra) => base({
  valorMensual: '20000000', valorTotal: '120000000',
  dedDependientes: 'SI', depNombre: 'SOFÍA PÉREZ', depId: '1012345678', depEdad: '12', depParentesco: 'HIJO', depMotivo: MOTIVO_HIJO,
  dedSaludNoPos: 'SI', saludEntidad: 'COLSANITAS', saludNit: '800251440', saludValorTotal: '12000000',
  saludFechaExpedicion: '2026-02-10', saludFechaCorte: '2025-12-31',
  dedHipotecario: 'SI', hipEntidad: 'BANCO DAVIVIENDA', hipNit: '860034313', hipValorIntereses: '9000000',
  hipFechaExpedicion: '2026-02-15', hipFechaCorte: '2025-12-31', hipTitulares: '2',
  afc: 'SI', afcEntidad: 'BANCO DE BOGOTÁ', afcNit: '860002964', afcValor: '500000',
  pensionesVoluntarias: 'SI', pvEntidad: 'PORVENIR', pvNit: '800144331', pvValor: '300000',
  foliosAnexos: '5',
  ...extra,
});

// Escenarios de paridad. `celdas` sobrescribe celdas crudas (casos que el estado no puede representar).
// `desviacion`: casos documentados en que validar() difiere a propósito del validador del Excel.
const ESCENARIOS = [
  { id: 'vacio', estado: {} },
  { id: 'completo-no-responsable', estado: base() },
  { id: 'responsable-c1-si', estado: base({ regimenIva: 'RESPONSABLE IVA', c1: 'SI', valorTotal: '35700000', valorMensual: '5950000',
    actividadRut: '6201', actividadRit: '6201', banco: 'Bancolombia SA', tipoCuenta: 'Corriente', numeroCuenta: '1234567890123456' }) },
  { id: 'no-responsable-tope-4000uvt', estado: base({ valorTotal: String(CONFIG.limiteIvaUvt * CONFIG.uvt), valorMensual: '20949600' }) },
  { id: 'no-responsable-bajo-tope', estado: base({ valorTotal: String(CONFIG.limiteIvaUvt * CONFIG.uvt - 1), valorMensual: '34916000' }) },
  { id: 'simple-responsable-pensionado', estado: base({ c3: 'SI', c2: 'SI', regimenIva: 'RESPONSABLE IVA', pensionado: 'SI' }) },
  { id: 'simple-no-responsable', estado: base({ c3: 'SI', c4: 'NO' }) },
  { id: 'c4-sin-responder', estado: base({ c4: '' }) },
  { id: 'c3-sin-responder', estado: base({ c3: '' }) },
  { id: 'regimen-vacio', estado: base({ regimenIva: '' }) },
  { id: 'c1-ambas-x', estado: base({ c2: '' }), celdas: { 'datos!BA61': 'X', 'datos!BC61': 'X' }, soloCeldas: true },
  { id: 'c1-c2-todas-x', estado: base(), celdas: { 'datos!BA61': 'X', 'datos!BC61': 'X', 'datos!BA64': 'X', 'datos!BC64': 'X' }, soloCeldas: true },
  { id: 'c4-ambas-x', estado: base(), celdas: { 'datos!BA70': 'X', 'datos!BC70': 'X' }, soloCeldas: true },
  { id: 'c3-ambas-x', estado: base(), celdas: { 'datos!BA67': 'X', 'datos!BC67': 'X' }, soloCeldas: true },
  { id: 'pensionado-x-minuscula', estado: base(), celdas: { 'datos!Q18': 'x', 'datos!S18': null }, soloCeldas: true },
  { id: 'pensionado-ambas-x', estado: base(), celdas: { 'datos!Q18': 'X', 'datos!S18': 'X' }, soloCeldas: true },
  { id: 'deduccion-sin-marcar-b54-2', estado: base({ email: '' }), celdas: { 'deducciones!B25': MOTIVO_HIJO }, soloCeldas: true },
  { id: 'deducciones-todas', estado: deducciones() },
  { id: 'deducciones-titulares-cero', estado: deducciones({ hipTitulares: '0' }) },
  { id: 'deducciones-sin-titulares', estado: deducciones({ hipTitulares: '', depMotivo: MOTIVO_PADRES, depParentesco: 'PADRE', depEdad: '70', valorMensual: '1500000' }),
    desviacion: { excel: true, calc: false, motivo: 'El Excel solo verifica la entidad del crédito (H46); validar() exige todos sus datos.' } },
  { id: 'salud-solo', estado: base({ dedSaludNoPos: 'SI', saludEntidad: 'SURA', saludNit: '800088702', saludValorTotal: '6000000',
    saludFechaExpedicion: '2026-01-20', saludFechaCorte: '2025-12-31', foliosAnexos: '2' }) },
  { id: 'exterior', estado: base({ pais: 'ESTADOS UNIDOS', departamento: 'Antioquia', municipio: 'MEDELLÍN' }),
    desviacion: { excel: false, calc: true, motivo: "El Excel exige departamento ('Validador- Datos'!B13 'País' revisa AI21) aun fuera de Colombia." } },
  { id: 'pais-otro', estado: base({ pais: 'OTRO', departamento: '', municipio: '' }),
    desviacion: { excel: false, calc: true, motivo: 'Igual que exterior: B13 revisa el código del departamento.' } },
  { id: 'departamento-otro', estado: base({ departamento: 'Otro', municipio: 'BOGOTÁ' }) },
  { id: 'municipio-de-otro-depto', estado: base({ departamento: 'Antioquia', municipio: 'BOGOTÁ' }) },
  { id: 'antioquia-medellin', estado: base({ departamento: 'Antioquia', municipio: 'medellín', direccion: 'CR 50 # 10-20' }) },
  { id: 'datos-incompletos-dv-errado', estado: { nit: '1020304050', dv: '0', numeroId: '1020304051', tipoDocumento: 'Cédula de extranjería ',
    primerApellido: 'Smith', primerNombre: 'John', pensionado: 'NO', telefono1: '0' } },
  { id: 'codigos-inexistentes', estado: base({ actividadRut: '9999', actividadRit: '99999', banco: 'BANCO INVENTADO', tipoCuenta: 'Fiducia',
    areaFuncional: 'Área inventada', tipoDocumento: 'Libreta militar' }) },
  { id: 'contrato-texto-sin-mensual', estado: base({ numeroContrato: 'CD-123', valorMensual: '' }) },
  { id: 'pv-valor-cero-afc-cero', estado: base({ afc: 'SI', afcEntidad: 'BANCO X', afcNit: '900123456', afcValor: '0',
    pensionesVoluntarias: 'SI', pvEntidad: 'PROTECCIÓN', pvNit: '800138188', pvValor: '0' }) },
  { id: 'redondeo-iva', estado: base({ regimenIva: 'RESPONSABLE IVA', valorTotal: '1249', valorMensual: '1249' }) },
  { id: 'duracion-fraccion', estado: base({ valorMensual: '4300000', segundoApellido: '', otrosNombres: '' }) },
  { id: 'nit-con-cero-inicial', estado: base({ nit: '052345678', numeroId: '52345678' }) },
  { id: 'hoy-2026-03-15', hoy: '2026-03-15', estado: base() },
  { id: 'hoy-2026-04-01', hoy: '2026-04-01', estado: deducciones() },
  { id: 'hoy-2026-03-31', hoy: '2026-03-31', estado: base() },
  { id: 'hoy-2027-05-01-tabla-vencida', hoy: '2027-05-01', estado: base() },
  { id: 'hoy-2023-01-15', hoy: '2023-01-15', estado: base() },
];

// ───────────────────────── Unidades ─────────────────────────
describe('utilidades', () => {
  test('dvNit con NIT reales verificados a mano y casos sintéticos', () => {
    const conocidos = {
      '800197268': '4', // DIAN
      '899999061': '9', // Alcaldía Mayor de Bogotá
      '860034313': '7', // Banco Davivienda
      '890903938': '8', // Bancolombia
      '899999001': '7', // Ministerio de Educación Nacional
    };
    for (const [nit, dv] of Object.entries(conocidos)) assert.equal(Calc.dvNit(nit), dv, nit);
    assert.equal(Calc.dvNit('4'), '1');   // residuo 1 → DV 1
    assert.equal(Calc.dvNit('15'), '0');  // residuo 0 → DV 0
    assert.equal(Calc.dvNit('800.197.268'), '4');
    assert.equal(Calc.dvNit(''), '');
    assert.equal(Calc.dvNit('12a'), '');
  });

  test('fechaSerialExcel / isoDeSerial / hoyISO', () => {
    assert.equal(Calc.fechaSerialExcel('2016-01-01'), 42370); // CONFIG.fechaMin
    assert.equal(Calc.fechaSerialExcel('2030-12-31'), 47848); // CONFIG.fechaMax
    assert.equal(Calc.fechaSerialExcel('2026-10-01'), 46296);
    assert.equal(Calc.fechaSerialExcel('1900-03-01'), 61);
    assert.equal(Calc.fechaSerialExcel('2026-02-30'), null);
    assert.equal(Calc.fechaSerialExcel(''), null);
    assert.equal(Calc.isoDeSerial(46296), '2026-10-01');
    assert.match(Calc.hoyISO(), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('formatoPesos', () => {
    assert.equal(Calc.formatoPesos(1234567), '$ 1.234.567');
    assert.equal(Calc.formatoPesos('4500000'), '$ 4.500.000');
    assert.equal(Calc.formatoPesos(0), '$ 0');
    assert.equal(Calc.formatoPesos(1234), '$ 1.234');
    assert.equal(Calc.formatoPesos(837984.5), '$ 837.984,50');
    assert.equal(Calc.formatoPesos(''), '');
    assert.equal(Calc.formatoPesos(null), '');
    assert.equal(Calc.formatoPesos('abc'), '');
  });

  test('redondeo como Excel (mitad lejos de cero, ruido binario)', () => {
    assert.equal(Calc.redondearExcel(150 * 0.19, 0), 29);
    assert.equal(Calc.redondearExcel(1050 * 0.19, 0), 200);
    assert.equal(Calc.redondearExcel(-2.5, 0), -3);
    assert.equal(Calc.redondearExcel(2.675, 2), 2.68);
  });

  test('CONFIG coincide con la tabla del Excel (UVT y tope de IVA)', () => {
    assert.equal(CONFIG.uvt, 52374);
    assert.equal(CONFIG.limiteIvaUvt, 4000);
  });

  test('celdasEntrada cubre las 104 celdas editables con los tipos del esquema', () => {
    const refs = Calc.celdasDeEntrada();
    assert.equal(refs.length, 104);
    assert.equal(refs.filter((r) => r.startsWith('datos!')).length, 87);
    assert.equal(refs.filter((r) => r.startsWith('deducciones!')).length, 17);
    const e = Calc.celdasEntrada(base({ pensionado: 'SI', telefono1: '0', crp1: '0456', dedSaludNoPos: 'SI', saludEntidad: 'SURA' }));
    assert.equal(e['datos!A11'], 52345678);
    assert.equal(e['datos!AC11'], 'Cédula de ciudadanía ');
    assert.equal(e['datos!Q18'], 'X');
    assert.equal(e['datos!S18'], null);
    assert.equal(e['datos!AG24'], 0);
    assert.equal(e['datos!N50'], '0456');            // 'auto' con cero inicial → texto
    assert.equal(e['datos!AC46'], 46054);            // fecha → serial
    assert.deepEqual(['A39', 'B39', 'C39', 'D39'].map((c) => e['datos!' + c]), [8, 5, 5, 9]);
    assert.deepEqual(['X39', 'Y39', 'Z39', 'AA39', 'AB39'].map((c) => e['datos!' + c]), [8, 5, 5, 9, null]);
    assert.equal(e['datos!AN31'], 0);
    assert.equal(e['datos!V80'], 'FORMATO SED - CON ANEXOS');
    assert.equal(e['datos!D80'], null);
    assert.equal(e['deducciones!H35'], 'SURA');
    assert.equal(e['datos!AY46'], 'NO');
  });

  test('celdasEntrada: campos ocultos van vacíos y las opciones se normalizan al texto exacto del catálogo', () => {
    const e = Calc.celdasEntrada(base({ tipoDocumento: 'cédula de ciudadanía', afc: 'NO', afcEntidad: 'BANCO', pais: 'ESPAÑA' }));
    assert.equal(e['datos!AC11'], 'Cédula de ciudadanía '); // con el espacio final del que dependen los BUSCARV
    assert.equal(e['datos!I83'], null);
    assert.equal(e['datos!T21'], null);
    assert.equal(e['datos!AM21'], null);
  });

  test('año de certificados: la regla del 1 de abril coincide con la tabla del Excel en su vigencia', () => {
    const d0 = Date.UTC(2022, 3, 1);
    for (let t = d0; t < Date.UTC(2027, 3, 1); t += 86400000 * 3) {
      const iso = new Date(t).toISOString().slice(0, 10);
      const ev = Calc.evaluar({}, iso);
      assert.equal(ev.celdas['validador!BK12'], Calc.anioCertificados(iso), iso);
    }
    for (const [iso, anio] of [['2026-03-31', 2024], ['2026-04-01', 2025], ['2026-10-01', 2025], ['2027-03-31', 2025], ['2027-04-01', 2026]]) {
      assert.equal(Calc.anioCertificados(iso), anio, iso);
    }
    // Tras el 1 de abril de 2027 la tabla del Excel se agota y BK12 da 0 (se documenta; derivados usa la regla).
    assert.equal(Calc.evaluar({}, '2027-04-02').celdas['validador!BK12'], 0);
    const d = Calc.derivados(base(), '2027-05-01');
    assert.equal(d.anioCertificados, 2026);
    assert.equal(d.anioVigenciaCertificados, 2028);
    assert.equal(d.anioCertificadosExcel, 0);
  });

  test('BE7 = AND(BA61="",,BA64="") siempre es "NO" (argumento omitido = FALSO)', () => {
    assert.equal(Calc.evaluar({}, HOY_FIJO).celdas['validador!BE7'], 'NO');
    assert.equal(Calc.derivados(base(), HOY_FIJO).celdas['validador!BE7'], 'NO');
  });
});

describe('derivados', () => {
  test('valores principales del estado base', () => {
    const d = Calc.derivados(base(), HOY_FIJO);
    assert.equal(d.nombreCompleto, 'PÉREZ GÓMEZ MARÍA JOSÉ');
    assert.equal(d.codTipoDocDian, 13);
    assert.equal(d.codTipoDocApot, 'CC');
    assert.equal(d.identificacionTitular, '52345678-' + Calc.dvNit('52345678'));
    assert.equal(d.codPais, '169');
    assert.equal(d.codDepto, '11');
    assert.equal(d.codMunicipio, '001');
    assert.equal(d.codBanco, '51');
    assert.equal(d.codTipoCuenta, '2');
    assert.equal(d.descCiiu, 'Otros tipos de educación n.c.p.');
    assert.equal(d.tarifaRit, 9.66);
    assert.equal(d.siglaRegimen, 'RS');
    assert.equal(d.duracionDias, 180);
    assert.equal(d.valorSinIva, 30000000);
    assert.equal(d.valorIva, 0);
    assert.equal(d.codigoArea, '1000');
    assert.equal(d.codificacion, 'NTNS');
    assert.equal(d.anioCertificados, 2025);
    assert.equal(d.anioVigenciaCertificados, 2027);
    assert.equal(d.depValorMensual, 500000);
    assert.equal(d.mensajeFormulario, 'Información completa, en constancia se suscribe el presente formulario el dia 01/10/2026');
    assert.equal(d.firmaNombre, 'PÉREZ GÓMEZ MARÍA JOSÉ');
    assert.equal(d.firmaDocumento, 'Cédula de ciudadanía 52345678');
    assert.equal(d.firmaContrato, 'CONTRATO No 1234 DE 2026');
    assert.equal(d.completoExcel, true);
    assert.ok(d.textoCertificacion.startsWith('Yo PÉREZ GÓMEZ MARÍA JOSÉ en calidad de contratista'));
  });

  test('IVA: responsable divide entre 1,19; no responsable desde 4.000 UVT también y alerta', () => {
    const r = Calc.derivados(base({ regimenIva: 'RESPONSABLE IVA', valorTotal: '1249' }), HOY_FIJO);
    assert.equal(r.valorSinIva, 1050);
    assert.equal(r.valorIva, 200);
    assert.equal(r.alertaIva, false);
    const tope = String(CONFIG.limiteIvaUvt * CONFIG.uvt);
    const n = Calc.derivados(base({ valorTotal: tope }), HOY_FIJO);
    assert.equal(n.alertaIva, true);
    assert.equal(n.excedeCuantiaIva, true);
    assert.equal(n.valorSinIva, Math.round(Number(tope) / 1.19));
    assert.equal(n.mensajeFormulario, 'VERIFICAR RESPONSABILIDAD DE IVA POR CUANTIA DEL CONTRATO');
    assert.equal(n.firmaContrato, 'CONTRATO No 1234 DE 2026');
    const b = Calc.derivados(base({ valorTotal: String(Number(tope) - 1) }), HOY_FIJO);
    assert.equal(b.alertaIva, false);
    assert.equal(b.valorSinIva, Number(tope) - 1);
  });

  test('codificación tributaria (BE23)', () => {
    const cod = (extra) => Calc.derivados(base(extra), HOY_FIJO).codificacion;
    assert.equal(cod({}), 'NTNS');
    assert.equal(cod({ c1: 'SI' }), 'NTDS');
    assert.equal(cod({ c2: 'SI', regimenIva: 'RESPONSABLE IVA' }), 'NTDC');
    assert.equal(cod({ c3: 'SI', regimenIva: 'RESPONSABLE IVA' }), 'NSYM');
    assert.equal(cod({ c3: 'SI' }), 'NSYS');
    assert.equal(cod({ c4: 'NO' }), 'NTNS'); // C4 no cambia el código
    assert.equal(cod({ pensionado: 'SI' }), 'NTNS /PENSIONADO');
    assert.equal(cod({ c4: '' }), 'REVISE SU INFORMACIÓN TRIBUTARIA');
    assert.equal(cod({ c3: '' }), 'REVISE SU INFORMACIÓN TRIBUTARIA');
    assert.equal(cod({ c1: '' }), 'REVISE SU INFORMACIÓN TRIBUTARIA');
    assert.equal(cod({ regimenIva: '' }), 'REVISE SU INFORMACIÓN TRIBUTARIA');
  });

  test('deducciones: topes y textos de certificado', () => {
    const d = Calc.derivados(deducciones(), HOY_FIJO);
    assert.equal(d.depValorMensual, 32 * CONFIG.uvt);           // 10 % de 20 M supera 32 UVT
    assert.equal(d.saludValorMensual, 16 * CONFIG.uvt);         // 1 M/mes supera 16 UVT
    assert.equal(d.hipValorMensual, 750000 / 2);                // 9 M / 12 entre 2 titulares
    assert.equal(d.depAnexos, CATALOGOS.motivosDependientes[0].anexo);
    assert.equal(d.saludTextoCertificado, 'CERTIFICADO EXPEDIDO POR COLSANITAS A NOMBRE DE PÉREZ GÓMEZ MARÍA JOSÉ TITULAR DEL CONTRATO');
    assert.equal(d.hipTextoCertificado, 'CERTIFICADO EXPEDIDO POR BANCO DAVIVIENDA A NOMBRE DE PÉREZ GÓMEZ MARÍA JOSÉ TITULAR DEL CREDITO');
    const cero = Calc.derivados(deducciones({ hipTitulares: '0' }), HOY_FIJO);
    assert.deepEqual(cero.celdas['deducciones!W50'], { error: '#DIV/0!' });
    assert.equal(cero.hipValorMensual, 750000);
  });

  test('vacío: "Formulario sin diligenciar" (B57 = 4)', () => {
    const d = Calc.derivados({}, HOY_FIJO);
    assert.equal(d.puntajeValidador, 4);
    assert.equal(d.mensajeFormulario, 'Formulario sin diligenciar');
    assert.equal(d.firmaContrato, '');
    assert.equal(d.duracionDias, null);
  });
});

describe('validar', () => {
  test('estado base: completo y listo', () => {
    const v = Calc.validar(base(), HOY_FIJO);
    assert.deepEqual(v.faltantes, []);
    assert.deepEqual(v.errores, {});
    assert.equal(v.completo, true);
    assert.equal(v.listo, true);
    assert.equal(v.excel.completo, true);
  });

  test('vacío: los faltantes cubren las verificaciones del validador del Excel', () => {
    const v = Calc.validar({}, HOY_FIJO);
    assert.equal(v.completo, false);
    const campos = new Set(v.faltantes.map((f) => f.campo));
    for (const fila of Calc.filasValidador) {
      if (fila.fila === 5 || fila.fila >= 54) continue;                 // tipo de contribuyente fijo; deducciones no marcadas
      if (['departamento', 'municipio'].includes(fila.campos[0])) continue; // dependen del país
      assert.ok(fila.campos.some((c) => campos.has(c)), 'Fila ' + fila.fila + ' (' + fila.descripcion + ') sin faltante');
    }
    for (const f of v.faltantes) {
      assert.ok(SCHEMA.fields[f.campo], f.campo);
      assert.equal(f.step, SCHEMA.fields[f.campo].step);
      assert.ok(f.mensaje && f.mensaje.length > 8);
    }
    // Con Colombia sí se piden departamento y municipio.
    const col = new Set(Calc.validar({ pais: 'COLOMBIA' }, HOY_FIJO).faltantes.map((f) => f.campo));
    assert.ok(col.has('departamento') && col.has('municipio'));
  });

  test('errores de formato y consistencia', () => {
    const v = Calc.validar(base({ dv: '0', numeroId: '52345679', email: 'maria@', telefono1: '0', telefono2: '300123456',
      valorMensual: '40000000', fechaCrp1: '2026-03-01', sucursal: 'SUCURSAL MUY LARGA DE PRUEBA', numeroContrato: '123456789',
      anioContrato: '2024', actividadRut: '9999' }), HOY_FIJO);
    assert.match(v.errores.dv, /el dígito de verificación es 3/);
    assert.match(v.errores.numeroId, /igual al NIT/);
    assert.ok(v.errores.email);
    assert.equal(v.errores.telefono1, undefined); // 0 = sin teléfono fijo
    assert.ok(v.errores.telefono2);
    assert.ok(v.errores.valorMensual);
    assert.ok(v.errores.fechaCrp1);
    assert.ok(v.errores.sucursal);
    assert.ok(v.errores.numeroContrato);
    assert.ok(v.errores.anioContrato);
    assert.ok(v.errores.actividadRut);
    assert.equal(v.completo, false); // número ≠ NIT y CIIU inexistente bloquean como en el Excel
  });

  test('deducciones: titulares, edad y corte del certificado', () => {
    const v = Calc.validar(deducciones({ hipTitulares: '0', depEdad: '120', saludFechaCorte: '2025-06-30' }), HOY_FIJO);
    assert.ok(v.errores.hipTitulares);
    assert.ok(v.errores.depEdad);
    assert.ok(v.advertencias.some((a) => a.codigo === 'CERTIFICADO_CORTE' && a.campo === 'saludFechaCorte'));
    assert.equal(v.completo, true); // el Excel tampoco los exige
    assert.equal(v.listo, false);
  });

  test('advertencias: IVA por cuantía y país extranjero', () => {
    const v = Calc.validar(base({ valorTotal: String(CONFIG.limiteIvaUvt * CONFIG.uvt) }), HOY_FIJO);
    const iva = v.advertencias.find((a) => a.codigo === 'IVA_CUANTIA');
    assert.ok(iva);
    assert.equal(iva.mensaje, 'VERIFICAR RESPONSABILIDAD DE IVA POR CUANTÍA DEL CONTRATO');
    assert.equal(iva.step, 'tributario');
    const e = Calc.validar(base({ pais: 'ESTADOS UNIDOS', departamento: '', municipio: '' }), HOY_FIJO);
    assert.equal(e.completo, true);
    assert.equal(e.excel.completo, false);
    assert.ok(e.advertencias.some((a) => a.codigo === 'EXCEL_PAIS_EXTERIOR'));
  });

  test('número de contrato con letras: aviso suave (S13 de deducciones daría #VALUE!), sin bloquear', () => {
    const v = Calc.validar(base({ numeroContrato: 'CD-123' }), HOY_FIJO);
    const a = v.advertencias.find((x) => x.codigo === 'CONTRATO_NO_NUMERICO');
    assert.ok(a);
    assert.equal(a.step, 'contrato');
    assert.equal(a.campo, 'numeroContrato');
    assert.equal(v.errores.numeroContrato, undefined);
    assert.equal(v.completo, true);
    for (const n of ['1234', '0123']) {
      assert.ok(!Calc.validar(base({ numeroContrato: n }), HOY_FIJO).advertencias.some((x) => x.codigo === 'CONTRATO_NO_NUMERICO'), n);
    }
    // '0123' se escribe como el número 123 (como si se tecleara en Excel): S13 no da #VALUE!.
    assert.equal(Calc.celdasEntrada(base({ numeroContrato: '0123' }))['datos!A46'], 123);
  });

  test('pensiones voluntarias con valor 0 cuenta como faltante (Excel B51 exige > 0)', () => {
    const v = Calc.validar(base({ pensionesVoluntarias: 'SI', pvEntidad: 'PORVENIR', pvNit: '800144331', pvValor: '0' }), HOY_FIJO);
    const f = v.faltantes.find((x) => x.campo === 'pvValor');
    assert.ok(f);
    assert.equal(f.conValor, true, 'la interfaz muestra «mayor que cero» en lugar de «Falta este dato»');
    assert.match(f.mensaje, /mayor que cero/);
    assert.equal(v.completo, false);
  });

  test('las preguntas C1–C4 pendientes se explican en lenguaje sencillo', () => {
    const v = Calc.validar(base({ c1: '', c2: '', c3: '', c4: '' }), HOY_FIJO);
    const m = Object.fromEntries(v.faltantes.map((f) => [f.campo, f.mensaje]));
    assert.equal(m.c1, `Cuéntanos si tus ingresos de ${CONFIG.anioGravable} superaron 1.400 UVT (C1).`);
    assert.equal(m.c2, `Cuéntanos si debes declarar renta por ${CONFIG.anioGravable} (C2).`);
    assert.match(m.c3, /Régimen Simple.*\(C3\)/);
    assert.match(m.c4, /costos y gastos.*\(C4\)/);
    for (const t of Object.values(m)) assert.doesNotMatch(t, /^Responde la pregunta/);
  });

  test('advertencia interna del Excel (tabla de certificados) marcada como interna', () => {
    const v = Calc.validar(base(), '2027-05-01');
    const a = v.advertencias.find((x) => x.codigo === 'EXCEL_TABLA_CERTIFICADOS');
    assert.ok(a && a.interna === true, 'la interfaz la omite');
    assert.equal(a.step, undefined);
  });
});

describe('limpieza de entradas y borradores', () => {
  test('dinero: la coma decimal (y el punto al pegar) separa los centavos, que se descartan', () => {
    const d = (t, p) => Calc.limpiar.dinero(t, p ? { pegado: true } : undefined);
    assert.deepEqual(d('4.500.000,00'), { digitos: '4500000', centavos: '00' });
    assert.deepEqual(d('$ 1.500.000,50'), { digitos: '1500000', centavos: '50' });
    assert.deepEqual(d('4500000,5'), { digitos: '4500000', centavos: '5' });
    assert.deepEqual(d('4.500.000,'), { digitos: '4500000', centavos: '' });
    assert.deepEqual(d('4.500.000'), { digitos: '4500000', centavos: null }, 'puntos de miles');
    assert.deepEqual(d('4,500,000'), { digitos: '4500000', centavos: null }, 'comas de miles (3 dígitos)');
    assert.deepEqual(d('1.23'), { digitos: '123', centavos: null }, 'al escribir, el punto no es decimal');
    assert.deepEqual(d('4,500,000.00', true), { digitos: '4500000', centavos: '00' }, 'al pegar sí');
    assert.deepEqual(d(''), { digitos: '', centavos: null });
  });

  test('teléfono: quita el indicativo +57 / 0057 de un número de 10 dígitos', () => {
    assert.equal(Calc.limpiar.telefono('+57 300 123 4567'), '3001234567');
    assert.equal(Calc.limpiar.telefono('573001234567'), '3001234567');
    assert.equal(Calc.limpiar.telefono('0057 601 234 5678'), '6012345678');
    assert.equal(Calc.limpiar.telefono('300 123 4567'), '3001234567');
    assert.equal(Calc.limpiar.telefono('57300'), '57300', 'incompleto: no se toca');
    assert.equal(Calc.limpiar.telefono('0'), '0');
  });

  test('NIT pegado con su DV', () => {
    assert.deepEqual(Calc.limpiar.nitDv('52.123.456-7'), { nit: '52123456', dv: '7' });
    assert.deepEqual(Calc.limpiar.nitDv('NIT 1.023.456.789 - 0'), { nit: '1023456789', dv: '0' });
    assert.deepEqual(Calc.limpiar.nitDv('1.023.456.789'), { nit: '1023456789', dv: null });
    assert.deepEqual(Calc.limpiar.nitDv('80.123-456'), { nit: '80123456', dv: null }, 'guion seguido de más de un dígito');
  });

  test('normalizarEstado: SI/NO, catálogos, fechas y dígitos en la forma del formulario', () => {
    const MOTIVO = CATALOGOS.motivosDependientes[0].texto;
    const { valores, usados } = Calc.normalizarEstado({
      dedDependientes: 'si', c1: 'sí', afc: 'Si', pensionesVoluntarias: 'no', c2: 'quizá', dedHipotecario: 'NO',
      regimenIva: 'no responsable iva', tipoCuenta: 'ahorros', tipoDocumento: 'Cédula de ciudadanía', departamento: 'bogota d.c',
      fechaInicio: '01/02/2026', fechaTerminacion: '2026-02-30', fechaCrp1: '2026-01-20',
      valorTotal: '4.500.000,00', nit: '52.123.456', telefono2: '+57 300 123 4567', email: ' Ana@Example.COM ',
      primerApellido: '  pérez   gómez ', depMotivo: MOTIVO.toUpperCase(), direccion: 'x'.repeat(2000),
      numeroCuenta: { malo: true }, desconocido: 'nada',
    });
    assert.equal(valores.dedDependientes, 'SI');
    assert.equal(valores.c1, 'SI');
    assert.equal(valores.afc, 'SI');
    assert.equal(valores.pensionesVoluntarias, 'NO');
    assert.equal(valores.c2, '', 'respuesta inválida queda vacía');
    assert.equal(valores.dedHipotecario, '', 'casilla: solo SI o vacío');
    assert.equal(valores.regimenIva, 'NO RESPONSABLE IVA');
    assert.equal(valores.tipoCuenta, 'Ahorros');
    assert.equal(valores.tipoDocumento, 'Cédula de ciudadanía ', 'texto exacto del catálogo (con su espacio final)');
    assert.equal(valores.departamento, 'Bogotá D.C');
    assert.equal(valores.fechaInicio, '', 'fecha no ISO');
    assert.equal(valores.fechaTerminacion, '', 'fecha inexistente');
    assert.equal(valores.fechaCrp1, '2026-01-20');
    assert.equal(valores.valorTotal, '4500000');
    assert.equal(valores.nit, '52123456');
    assert.equal(valores.telefono2, '3001234567');
    assert.equal(valores.email, 'ana@example.com');
    assert.equal(valores.primerApellido, 'PÉREZ GÓMEZ');
    assert.equal(valores.depMotivo, MOTIVO);
    assert.equal(valores.direccion.length, 500, 'valores enormes se recortan');
    assert.ok(!('numeroCuenta' in valores) && !('desconocido' in valores));
    assert.equal(usados, Object.values(valores).filter((v) => v !== '').length);
    // Validación, exportación e impresión ven lo mismo: SI en mayúsculas.
    const v = Calc.validar(base({ ...valores, c2: 'NO', dedHipotecario: '' }), HOY_FIJO);
    assert.ok(v.faltantes.some((f) => f.campo === 'afcEntidad'), 'AFC = SI exige la entidad');
    assert.deepEqual(Calc.normalizarEstado({ nit: { x: 1 } }), { valores: {}, usados: 0 }, 'borrador sin nada utilizable');
    assert.deepEqual(Calc.normalizarEstado(null), { valores: {}, usados: 0 });
  });
});

// ───────────────────────── Paridad con Excel (COM) ─────────────────────────
function excelDisponible() {
  if (process.env.SIN_EXCEL) return 'Omitido con SIN_EXCEL=1';
  if (process.platform !== 'win32') return 'Solo en Windows con Excel instalado';
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$x = New-Object -ComObject Excel.Application; $x.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($x); "OK"'],
  { encoding: 'utf8', timeout: 120000 });
  if (r.error) return 'PowerShell no disponible: ' + r.error.message;
  if (r.status !== 0 || !/OK/.test(r.stdout)) return 'Excel (COM) no disponible: ' + (r.stderr || '').trim().slice(0, 200);
  return null;
}

function celdasDe(esc) {
  return { ...Calc.celdasEntrada(esc.estado), ...(esc.celdas || {}) };
}

function ejecutarExcel(salidas) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calc-paridad-'));
  const entrada = path.join(dir, 'escenarios.json');
  const salida = path.join(dir, 'resultados.json');
  const sinNulos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));
  const spec = {
    hojas: Calc.hojas,
    entradas: Calc.celdasDeEntrada(),
    salidas,
    escenarios: ESCENARIOS.map((e) => ({ id: e.id, hoy: e.hoy || null, celdas: { ...sinNulos(Calc.celdasEntrada(e.estado)), ...(e.celdas || {}) } })),
  };
  fs.writeFileSync(entrada, JSON.stringify(spec), 'utf8');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(RAIZ, 'tests', 'paridad-excel.ps1'),
    '-Entrada', entrada, '-Salida', salida, '-DirTemporal', dir], { encoding: 'utf8', timeout: 600000 });
  if (r.status !== 0) throw new Error('paridad-excel.ps1 falló (' + r.status + '): ' + (r.stderr || r.stdout));
  const res = JSON.parse(fs.readFileSync(salida, 'utf8').replace(/^﻿/, ''));
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

const cerca = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// Compara un valor de Calc con el leído de Excel ({t, v}). Devuelve null si coinciden o la diferencia.
function diferencia(ref, mio, ex, hoyExcel) {
  if (mio && typeof mio === 'object' && 'error' in mio) return ex.t === 'e' && ex.v === mio.error ? null : 'error';
  if (mio === null || mio === '') return ex.t === 'v' ? null : 'vacío';
  if (typeof mio === 'number') return ex.t === 'n' && cerca(Number(ex.v), mio) ? null : 'número';
  if (typeof mio === 'boolean') return ex.t === 'b' && ex.v === mio ? null : 'booleano';
  if (ex.t !== 's') return 'tipo';
  let v = ex.v;
  // TEXT(D64;"dd/mm/yyyy") deja "yyyy" literal en Excel con configuración regional que usa "aaaa".
  if (/el dia \d\d\/\d\d\/yyyy$/.test(v)) v = v.replace(/yyyy$/, hoyExcel.slice(0, 4));
  // El catálogo guarda las descripciones CIIU/RIT sin espacios sobrantes; el Excel algunas los tiene.
  if (ref === 'datos!F39' || ref === 'datos!AD39') return v.trim() === mio.trim() ? null : 'texto';
  return v === mio ? null : 'texto';
}

const motivoSkip = excelDisponible();
let resultados = null;
let errorEjecucion = null;
const salidas = (() => {
  const set = new Set();
  for (const e of ESCENARIOS) Object.keys(Calc.evaluar(celdasDe(e), e.hoy || HOY_FIJO).celdas).forEach((k) => set.add(k));
  return [...set];
})();
if (!motivoSkip) {
  try { resultados = ejecutarExcel(salidas); } catch (e) { errorEjecucion = e; }
}

describe('paridad con Excel', { skip: motivoSkip || false }, () => {
  test('el script de Excel se ejecutó', () => {
    if (errorEjecucion) throw errorEjecucion;
    assert.ok(resultados && resultados.resultados.length === ESCENARIOS.length);
    assert.ok(salidas.length > 150, 'celdas comparadas: ' + salidas.length);
  });

  for (const esc of ESCENARIOS) {
    test('escenario ' + esc.id, () => {
      if (errorEjecucion) throw errorEjecucion;
      const r = resultados.resultados.find((x) => x.id === esc.id);
      const hoy = esc.hoy || resultados.hoyExcel;
      const mio = Calc.evaluar(celdasDe(esc), hoy).celdas;
      const difs = [];
      for (const ref of salidas) {
        if (esc.hoy && ref === 'deducciones!W15') continue; // W15 = TODAY() real (no se puede fijar: hoja protegida)
        const d = diferencia(ref, mio[ref] === undefined ? null : mio[ref], r.valores[ref], resultados.hoyExcel);
        if (d) difs.push(`${ref}: calc=${JSON.stringify(mio[ref])} excel=${JSON.stringify(r.valores[ref])} (${d})`);
      }
      assert.deepEqual(difs, [], 'Diferencias en ' + esc.id + ':\n' + difs.join('\n'));

      // derivados() usa las mismas celdas cuando el escenario es un estado puro.
      if (!esc.celdas) {
        const D = Calc.derivados(esc.estado, hoy);
        for (const ref of salidas) {
          if (esc.hoy && ref === 'deducciones!W15') continue;
          assert.equal(diferencia(ref, D.celdas[ref] === undefined ? null : D.celdas[ref], r.valores[ref], resultados.hoyExcel), null, ref);
        }
        const exB57 = Number(r.valores['validador!B57'].v);
        assert.equal(D.completoExcel, exB57 === 54);
        // validar(): 'completo' concuerda con el validador del Excel salvo desviaciones documentadas.
        const V = Calc.validar(esc.estado, hoy);
        const excelCompleto = exB57 === 54;
        if (esc.desviacion) {
          assert.equal(excelCompleto, esc.desviacion.excel, 'Excel ' + esc.id);
          assert.equal(V.completo, esc.desviacion.calc, 'validar ' + esc.id + ': ' + esc.desviacion.motivo);
        } else {
          assert.equal(V.completo, excelCompleto,
            `validar().completo=${V.completo} pero Excel B57=${exB57}. Faltantes: ${JSON.stringify(V.faltantes.map((f) => f.campo))} ` +
            `errores: ${JSON.stringify(V.errores)} mensaje Excel: ${r.valores['validador!D68'].v}`);
        }
      }
    });
  }

  test('rarezas confirmadas en Excel', () => {
    if (errorEjecucion) throw errorEjecucion;
    const val = (id, ref) => resultados.resultados.find((x) => x.id === id).valores[ref];
    // AND(BA61="",,BA64="") con ambas vacías sigue siendo FALSO → BE7 = "NO".
    assert.deepEqual(val('vacio', 'validador!BE7'), { t: 's', v: 'NO' });
    // Tabla de certificados vencida: BK12 = 0.
    assert.deepEqual(val('hoy-2027-05-01-tabla-vencida', 'validador!BK12'), { t: 'n', v: '0' });
    // Deducción diligenciada sin marcar suma 2 y compensa un faltante: el Excel dice "completo" sin correo.
    assert.deepEqual(val('deduccion-sin-marcar-b54-2', 'validador!B54'), { t: 'n', v: '2' });
    assert.deepEqual(val('deduccion-sin-marcar-b54-2', 'validador!B57'), { t: 'n', v: '54' });
    // Exterior: 'País' (B13) revisa el código de departamento AI21.
    assert.deepEqual(val('exterior', 'validador!B13'), { t: 'n', v: '0' });
    // Titulares = 0 → #DIV/0! en W50.
    assert.deepEqual(val('deducciones-titulares-cero', 'deducciones!W50'), { t: 'e', v: '#DIV/0!' });
    // Número de contrato con letras → S13 #VALUE! (IF(A46,...)).
    assert.deepEqual(val('contrato-texto-sin-mensual', 'deducciones!S13'), { t: 'e', v: '#VALUE!' });
  });
});
