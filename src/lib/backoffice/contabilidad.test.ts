import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CUENTAS_PROPUESTAS } from './cuentas';

// Prueba del IO con un Supabase de mentira: una cadena de métodos que, al esperarse, responde lo que la prueba dejó para esa tabla.
const dobles = vi.hoisted(() => ({
  por: {} as Record<string, unknown>,
  llamadas: [] as Array<{ tabla: string; ops: Array<[string, unknown[]]> }>,
  rpc: vi.fn(),
  gastos: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const ops: Array<[string, unknown[]]> = [];
      dobles.llamadas.push({ tabla, ops });
      const cadena: unknown = new Proxy({}, {
        get(_o, prop: string) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
              const r = dobles.por[tabla];
              return Promise.resolve(typeof r === 'function' ? (r as (o: typeof ops) => unknown)(ops) : r).then(ok, ko);
            };
          }
          return (...args: unknown[]) => { ops.push([prop, args]); return cadena; };
        },
      });
      return cadena;
    },
    rpc: (...args: unknown[]) => dobles.rpc(...args),
  }),
}));
vi.mock('./insumos-contables', () => ({ insumosGastos: dobles.gastos }));

import {
  ErrorLibro, leerCierreReferencia, leerEntidad, leerLibro, leerMovimientosDelMes, leerPaqueteDelMes, marcarPaqueteListo, marcarPresentada, registrarAsiento, reversarAsiento,
} from './contabilidad';
import { NO_DISPONIBLE, OK } from './lectura';
import { armarLibro, cobro } from './libro_fixtures';

const ausente = { code: '42P01', message: 'relation "bo_x" does not exist' };
const ok = (data: unknown) => ({ data, error: null });
const llamadasA = (tabla: string, op: string) => dobles.llamadas.filter((l) => l.tabla === tabla).flatMap((l) => l.ops.filter(([o]) => o === op));

beforeEach(() => {
  dobles.por = {};
  dobles.llamadas.length = 0;
  dobles.rpc.mockReset();
  dobles.gastos.mockReset();
});

describe('lecturas honestas', () => {
  it('tabla ausente es «no disponible», no un libro vacío ni un cero', async () => {
    dobles.por.bo_entidad = { data: null, error: ausente };
    dobles.por.bo_asiento = { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } };
    expect(await leerEntidad()).toEqual(NO_DISPONIBLE);
    expect(await leerLibro()).toEqual(NO_DISPONIBLE);
  });

  it('un fallo de la base es «error», distinto de «no hay nada»', async () => {
    dobles.por.bo_entidad = { data: null, error: { code: '57014', message: 'statement timeout' } };
    expect(await leerEntidad()).toEqual({ estado: 'error', mensaje: 'statement timeout' });
  });

  it('entidad sin fila es ok(null); con fila trae el RFC', async () => {
    dobles.por.bo_entidad = ok(null);
    expect(await leerEntidad()).toEqual(OK(null));
    dobles.por.bo_entidad = ok({ rfc: 'ABC010101AB1', razon_social: 'Likida SAPI', constituida_el: '2026-10-01' });
    expect(await leerEntidad()).toEqual(OK({ rfc: 'ABC010101AB1', razonSocial: 'Likida SAPI', constituidaEl: '2026-10-01' }));
  });

  it('el libro trae las líneas ordenadas y en centavos enteros; un libro vacío es ok([])', async () => {
    dobles.por.bo_asiento = ok([{
      id: 'a1', seq: 1, folio: 'A-0001', clave_idem: 'clave-1', fecha_neg: '2026-10-05', periodo: '2026-10-01', descripcion: 'Cobro', origen_tipo: 'manual', origen_id: null,
      soporte: 'cfdi', soporte_ref: 'UUID', reversa_de: null, motivo_reversa: null, es_manual: true, hash_anterior: '0'.repeat(64), hash: 'a'.repeat(64),
      bo_asiento_linea: [{ n: 2, cuenta: '4100', debe: '0.00', haber: '100.05', nota: null }, { n: 1, cuenta: '1110', debe: 100.05, haber: 0, nota: 'Banco' }],
    }]);
    const l = await leerLibro();
    if (l.estado !== 'ok') throw new Error('debía leerse');
    expect(l.dato.truncado).toBe(false);
    expect(l.dato.asientos[0].lineas).toEqual([
      { cuenta: '1110', debeCent: 10005, haberCent: 0, nota: 'Banco' },
      { cuenta: '4100', debeCent: 0, haberCent: 10005, nota: null },
    ]);
    dobles.por.bo_asiento = ok([]);
    expect(await leerLibro()).toEqual(OK({ asientos: [], truncado: false }));
  });

  it('leerMovimientosDelMes (interfaz del plan) devuelve una fila por línea del mes, con su soporte', async () => {
    const libro = armarLibro([{ fecha: '2026-10-05', lineas: cobro(5000), soporte: 'cfdi' }, { fecha: '2026-11-02', lineas: cobro(7000) }]);
    dobles.por.bo_asiento = ok(libro.map((a) => ({
      id: a.id, seq: a.seq, folio: a.folio, clave_idem: a.claveIdem, fecha_neg: a.fechaNeg, periodo: a.periodo, descripcion: a.descripcion, origen_tipo: a.origenTipo, origen_id: null,
      soporte: a.soporte, soporte_ref: null, reversa_de: null, motivo_reversa: null, es_manual: true, hash_anterior: a.hashAnterior, hash: a.hash,
      bo_asiento_linea: a.lineas.map((l, i) => ({ n: i + 1, cuenta: l.cuenta, debe: l.debeCent / 100, haber: l.haberCent / 100, nota: null })),
    })));
    const m = await leerMovimientosDelMes('2026-10-01');
    if (m.estado !== 'ok') throw new Error('debía leerse');
    expect(m.dato).toHaveLength(2);
    expect(m.dato[0]).toMatchObject({ asientoId: 'id-1', fecha: '2026-10-05', cuenta: '1110', debeCent: 5000, haberCent: 0, soporte: 'cfdi' });
    expect(await leerMovimientosDelMes('2026-12-01')).toEqual(OK([]));
  });

  it('el cierre: un componente que falta deja «costos y gastos» en null (no se suma como cero)', async () => {
    dobles.por.bo_cierre_mes = ok({ periodo: '2026-10-01', ingresos_cobrados: 1000, iva_trasladado: 160, cogs_ia: 100, gastos_operativos: null, comisiones_devengadas: 0 });
    expect(await leerCierreReferencia('2026-10-01')).toEqual(OK({ cierre: { periodo: '2026-10-01', ingresosCent: 100000, costosYGastosCent: null }, ivaTrasladadoCent: 16000 }));
    dobles.por.bo_cierre_mes = ok({ periodo: '2026-10-01', ingresos_cobrados: 1000, iva_trasladado: 160, cogs_ia: 100, gastos_operativos: 50.5, comisiones_devengadas: 0 });
    const c = await leerCierreReferencia('2026-10-01');
    if (c.estado !== 'ok') throw new Error('debía leerse');
    expect(c.dato.cierre?.costosYGastosCent).toBe(15050);
    dobles.por.bo_cierre_mes = ok(null);
    expect(await leerCierreReferencia('2026-10-01')).toEqual(OK({ cierre: null, ivaTrasladadoCent: null }));
    dobles.por.bo_cierre_mes = { data: null, error: ausente };
    expect(await leerCierreReferencia('2026-10-01')).toEqual(NO_DISPONIBLE);
  });
});

describe('escrituras del libro', () => {
  const lineas = [{ cuenta: '1110', debeCent: 10005, haberCent: 0 }, { cuenta: '4100', debeCent: 0, haberCent: 10005 }];

  it('registrarAsiento llama a bo_asentar con pesos, la clave de idempotencia y el actor', async () => {
    dobles.rpc.mockResolvedValue({ data: 'uuid-1', error: null });
    expect(await registrarAsiento({ claveIdem: 'clave-12345', fecha: '2026-10-05', descripcion: 'Cobro', lineas, actor: 'u1' })).toEqual({ id: 'uuid-1' });
    expect(dobles.rpc).toHaveBeenCalledWith('bo_asentar', expect.objectContaining({
      p_clave_idem: 'clave-12345', p_fecha: '2026-10-05', p_origen_tipo: 'manual', p_soporte: 'ninguno', p_actor: 'u1',
      p_lineas: [{ cuenta: '1110', debe: 100.05, haber: 0, nota: null }, { cuenta: '4100', debe: 0, haber: 100.05, nota: null }],
    }));
  });

  it('el error de la base conserva su código; la función ausente se reporta como «ausente»', async () => {
    dobles.rpc.mockResolvedValue({ data: null, error: { code: 'P0431', message: 'el periodo esta aprobado' } });
    await expect(registrarAsiento({ claveIdem: 'clave-12345', fecha: '2026-10-05', descripcion: 'x', lineas, actor: 'u1' })).rejects.toMatchObject({ codigo: 'P0431' });
    dobles.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.bo_asentar in the schema cache' } });
    const e = await registrarAsiento({ claveIdem: 'clave-12345', fecha: '2026-10-05', descripcion: 'x', lineas, actor: 'u1' }).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorLibro);
    expect(e.codigo).toBe('ausente');
  });

  it('reversarAsiento pasa motivo, clave, actor y fecha', async () => {
    dobles.rpc.mockResolvedValue({ data: 'uuid-rev', error: null });
    expect(await reversarAsiento({ asientoId: 'uuid-1', motivo: 'Captura duplicada', actor: 'u1', claveIdem: 'rev-12345678', fecha: '2026-10-07' })).toEqual({ id: 'uuid-rev' });
    expect(dobles.rpc).toHaveBeenCalledWith('bo_reversar_asiento', { p_asiento: 'uuid-1', p_motivo: 'Captura duplicada', p_actor: 'u1', p_clave_idem: 'rev-12345678', p_fecha: '2026-10-07' });
  });
});

describe('cumplimiento fiscal', () => {
  const datos = { clave: 'iva_mensual', periodo: '2026-10-01', presentadaPor: 'Javier', presentadaEn: '2026-11-16', acuseRef: 'ACUSE-1' };

  it('marca presentada con quién, cuándo y acuse; sin fila previa hace upsert', async () => {
    dobles.por.bo_obligacion_cumplimiento = ok(null);
    expect(await marcarPresentada(datos)).toBe('marcada');
    const [[, args]] = llamadasA('bo_obligacion_cumplimiento', 'upsert');
    expect(args[0]).toMatchObject({ clave: 'iva_mensual', periodo: '2026-10-01', estado: 'presentada', presentada_por: 'Javier', presentada_en: '2026-11-16', acuse_ref: 'ACUSE-1' });
  });

  it('es idempotente con el mismo acuse y rechaza otro acuse sobre una ya presentada', async () => {
    dobles.por.bo_obligacion_cumplimiento = ok({ clave: 'iva_mensual', periodo: '2026-10-01', estado: 'presentada', acuse_ref: 'ACUSE-1' });
    expect(await marcarPresentada(datos)).toBe('ya_estaba');
    expect(llamadasA('bo_obligacion_cumplimiento', 'upsert')).toHaveLength(0);
    await expect(marcarPresentada({ ...datos, acuseRef: 'OTRO' })).rejects.toMatchObject({ codigo: '42501' });
  });

  it('«paquete listo» no toca las obligaciones ya presentadas ni las «no aplica»', async () => {
    dobles.por.bo_obligacion_cumplimiento = ok([{ clave: 'diot', periodo: '2026-10-01', estado: 'presentada' }, { clave: 'iva_mensual', periodo: '2026-10-01', estado: 'no_aplica' }]);
    expect(await marcarPaqueteListo('2026-10-01')).toEqual(['contabilidad_electronica']);
    const [[, args]] = llamadasA('bo_obligacion_cumplimiento', 'upsert');
    expect((args[0] as Array<{ clave: string; estado: string }>).map((f) => [f.clave, f.estado])).toEqual([['contabilidad_electronica', 'paquete_listo']]);
  });
});

describe('leerPaqueteDelMes', () => {
  const libro = armarLibro([{ fecha: '2026-10-05', lineas: cobro(100000), soporte: 'cfdi' }]);
  const filasLibro = libro.map((a) => ({
    id: a.id, seq: a.seq, folio: a.folio, clave_idem: a.claveIdem, fecha_neg: a.fechaNeg, periodo: a.periodo, descripcion: a.descripcion, origen_tipo: a.origenTipo, origen_id: null,
    soporte: a.soporte, soporte_ref: null, reversa_de: null, motivo_reversa: null, es_manual: true, hash_anterior: a.hashAnterior, hash: a.hash,
    bo_asiento_linea: a.lineas.map((l, i) => ({ n: i + 1, cuenta: l.cuenta, debe: l.debeCent / 100, haber: l.haberCent / 100, nota: null })),
  }));

  it('sin RFC: candado cerrado, paquete bloqueado y NO se piden gastos ni cierre (no se consulta lo que no es evaluable)', async () => {
    dobles.por.bo_entidad = ok({ rfc: null, razon_social: null, constituida_el: null });
    dobles.por.bo_cuenta = ok(CUENTAS_PROPUESTAS);
    dobles.por.bo_asiento = ok(filasLibro);
    const d = await leerPaqueteDelMes('2026-10-01');
    expect(d.candado).toEqual({ bloqueado: true, motivo: 'sin_rfc' });
    expect(d.paquete).toEqual({ bloqueado: 'sin_rfc' });
    expect(d.gastos).toEqual(NO_DISPONIBLE);
    expect(dobles.gastos).not.toHaveBeenCalled();
    expect(d.delMes).toHaveLength(1);
    expect(d.comprobaciones?.find((c) => c.codigo === 'C3')?.ok).toBe(true);
  });

  it('con RFC arma el paquete con los insumos de los otros lotes; si no están, quedan «sin dato»', async () => {
    dobles.por.bo_entidad = ok({ rfc: 'ABC010101AB1', razon_social: 'Likida SAPI', constituida_el: '2026-10-01' });
    dobles.por.bo_cuenta = ok(CUENTAS_PROPUESTAS);
    dobles.por.bo_asiento = ok(filasLibro);
    dobles.por.bo_cierre_mes = ok({ periodo: '2026-10-01', ingresos_cobrados: 1000, iva_trasladado: 160, cogs_ia: 0, gastos_operativos: 0, comisiones_devengadas: 0 });
    dobles.por.bo_proveedor = ok([]);
    dobles.gastos.mockResolvedValue(NO_DISPONIBLE);
    const d = await leerPaqueteDelMes('2026-10-01');
    expect(dobles.gastos).toHaveBeenCalledWith('2026-10-01');
    if (!d.paquete || d.paquete.bloqueado !== false) throw new Error('debía armarse');
    expect(d.paquete.diot).toBeNull();
    expect(d.paquete.iva.aPagarCent).toBeNull();
    expect(d.paquete.cruce.cuadra).toBe(true);
    expect(d.paquete.advertencias).toEqual(expect.arrayContaining(['diot_sin_gastos', 'iva_a_pagar_sin_dato']));
  });

  it('si el libro no se puede leer, no hay paquete ni comprobaciones (no se inventan)', async () => {
    dobles.por.bo_entidad = ok({ rfc: 'ABC010101AB1', razon_social: null, constituida_el: null });
    dobles.por.bo_cuenta = ok(CUENTAS_PROPUESTAS);
    dobles.por.bo_asiento = { data: null, error: ausente };
    dobles.por.bo_cierre_mes = ok(null);
    dobles.por.bo_proveedor = ok([]);
    dobles.gastos.mockResolvedValue(OK([]));
    const d = await leerPaqueteDelMes('2026-10-01');
    expect(d.libro).toEqual(NO_DISPONIBLE);
    expect(d.paquete).toBeNull();
    expect(d.comprobaciones).toBeNull();
    expect(d.delMes).toBeNull();
  });
});
