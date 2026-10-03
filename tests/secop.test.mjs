// Pruebas de src/js/secop.js (consulta del contrato en SECOP II). Sin red: fetch simulado, datos ficticios.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../src/js/catalogos.js');
require('../src/js/config.js');
const Secop = require('../src/js/secop.js');

const fila = (ref, extra) => ({
  referencia_del_contrato: ref, estado_contrato: 'En ejecución', fecha_de_firma: '2026-01-20T00:00:00.000',
  fecha_de_inicio_del_contrato: '2026-02-02T00:00:00.000', fecha_de_fin_del_contrato: '2026-12-31T00:00:00.000',
  valor_del_contrato: '48000000', duraci_n_del_contrato: '8 Mes(es)', nombre_supervisor: 'No definido',
  objeto_del_contrato: 'PRESTAR SERVICIOS DE APOYO A LA GESTION EN LA OFICINA DE CONTROL DISCIPLINARIO DE JUZGAMIENTO',
  urlproceso: { url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=X' },
  ...extra,
});

function fetchFalso(respuesta, registro) {
  return async (url, init) => {
    registro.push({ url, init });
    if (respuesta instanceof Error) throw respuesta;
    return { ok: respuesta.status ? respuesta.status < 400 : true, status: respuesta.status || 200, json: async () => respuesta.datos };
  };
}

describe('Secop.consulta', () => {
  test('filtra por la entidad de la SED y el documento; solo dígitos', () => {
    const q = Secop.consulta(' 52.345.678 ');
    assert.match(q, /WHERE codigo_entidad='701321135' AND documento_proveedor='52345678'/);
    assert.match(q, /^SELECT referencia_del_contrato, /);
    assert.throws(() => Secop.consulta('123'), { codigo: 'DOCUMENTO_INVALIDO' });
    assert.throws(() => Secop.consulta("1' OR '1'='1"), { codigo: 'DOCUMENTO_INVALIDO' });
  });
});

describe('Secop.buscar', () => {
  test('POST con la consulta en el cuerpo (la cédula no va en la URL)', async () => {
    const registro = [];
    const r = await Secop.buscar('52345678', { fetch: fetchFalso({ datos: [fila('CO1.PCCNTR.1')] }, registro), hoy: '2026-10-02' });
    assert.equal(registro.length, 1);
    assert.equal(registro[0].url, 'https://www.datos.gov.co/api/v3/views/jbjy-vk9h/query.json');
    assert.equal(registro[0].init.method, 'POST');
    assert.ok(!registro[0].url.includes('52345678'));
    assert.match(JSON.parse(registro[0].init.body).query, /documento_proveedor='52345678'/);
    assert.equal(r.vigentes.length, 1);
    assert.equal(r.total, 1);
  });

  test('descarta estados excluidos y vencidos; ordena por firma; sin repetidos', async () => {
    const datos = [
      fila('CO1.PCCNTR.VIEJO', { estado_contrato: 'Cerrado', fecha_de_firma: '2024-01-10T00:00:00.000', fecha_de_fin_del_contrato: '2024-12-31T00:00:00.000' }),
      fila('CO1.PCCNTR.BORRADOR', { estado_contrato: 'Borrador', fecha_de_firma: null }),
      fila('CO1.PCCNTR.VENCIDO', { estado_contrato: 'Modificado', fecha_de_firma: '2025-02-01T00:00:00.000', fecha_de_fin_del_contrato: '2025-12-31T00:00:00.000' }),
      fila('CO1.PCCNTR.A', { fecha_de_firma: '2026-01-05T00:00:00.000' }),
      fila('CO1.PCCNTR.B', { fecha_de_firma: '2026-03-05T00:00:00.000', estado_contrato: 'cedido' }),
      fila('CO1.PCCNTR.B', { fecha_de_firma: '2026-03-05T00:00:00.000', estado_contrato: 'cedido' }),
      fila('CO1.PCCNTR.CANCELADO', { estado_contrato: 'Cancelado' }),
    ];
    const r = await Secop.buscar('52345678', { fetch: fetchFalso({ datos }, []), hoy: '2026-10-02' });
    assert.deepEqual(r.vigentes.map((c) => c.referencia), ['CO1.PCCNTR.B', 'CO1.PCCNTR.A']);
    assert.deepEqual(r.otros.map((c) => c.referencia), ['CO1.PCCNTR.VENCIDO']);
  });

  test('errores con código: sin conexión, HTTP y respuesta inválida', async () => {
    await assert.rejects(Secop.buscar('52345678', { fetch: fetchFalso(new TypeError('Failed to fetch'), []) }), { codigo: 'SIN_CONEXION' });
    await assert.rejects(Secop.buscar('52345678', { fetch: fetchFalso({ status: 503 }, []) }), { codigo: 'HTTP_503' });
    await assert.rejects(Secop.buscar('52345678', { fetch: fetchFalso({ datos: { error: true } }, []) }), { codigo: 'RESPUESTA' });
  });
});

describe('Secop.aCampos', () => {
  test('mapea el contrato a los campos del paso Contrato', () => {
    const c = Secop.normalizar(fila('CO1.PCCNTR.1'));
    const { campos, notas } = Secop.aCampos(c);
    assert.deepEqual(campos, {
      anioContrato: '2026', valorTotal: '48000000', fechaInicio: '2026-02-02', fechaTerminacion: '2026-12-31', cesion: 'NO',
      valorMensual: '6000000', areaFuncional: 'Oficina de Control Disciplinario de Juzgamiento',
    });
    assert.match(notas.valorMensual, /\(8 meses\)/);
    assert.match(notas.numeroContrato, /CO1\.PCCNTR\.1/);
    assert.equal(c.url.startsWith('https://community.secop.gov.co/'), true);
  });

  test('duración en días, cesión y supervisor definido', () => {
    const c = Secop.normalizar(fila('CO1.PCCNTR.2', { duraci_n_del_contrato: '225 Dia(s)', valor_del_contrato: '17418750',
      estado_contrato: 'cedido', nombre_supervisor: 'Persona De Prueba', objeto_del_contrato: 'APOYO A LA GESTIÓN' }));
    const { campos, notas } = Secop.aCampos(c);
    assert.equal(campos.valorMensual, String(Math.round((17418750 * 30) / 225)));
    assert.equal(campos.cesion, 'SI');
    assert.equal(campos.interventorNombre, 'PERSONA DE PRUEBA');
    assert.equal(campos.areaFuncional, undefined);
    assert.match(notas.valorMensual, /\(225 días\)/);
  });

  test('duracionEnDias', () => {
    assert.equal(Secop.duracionEnDias('225 Dia(s)'), 225);
    assert.equal(Secop.duracionEnDias('8 Mes(es)'), 240);
    assert.equal(Secop.duracionEnDias('1 Año(s)'), 360);
    assert.equal(Secop.duracionEnDias('2 Semana(s)'), 14);
    assert.equal(Secop.duracionEnDias('No definido'), 0);
  });

  test('área funcional: la más larga contenida en el objeto, solo si es única', () => {
    assert.equal(Secop.areaDesdeObjeto('apoyo a la oficina de tesoreria y contabilidad de la sed'), 'Oficina de Tesorería y Contabilidad');
    assert.equal(Secop.areaDesdeObjeto('servicios generales'), '');
  });
});
