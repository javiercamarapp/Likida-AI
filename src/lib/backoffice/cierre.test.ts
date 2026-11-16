import { beforeEach, describe, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  listarFacturasSaas: vi.fn(),
  costoIaVentana: vi.fn(),
  getGastosDelMes: vi.fn(),
  leerComisionesDelMes: vi.fn(),
  leerMovimientosDelMes: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: dobles.from, rpc: dobles.rpc }) }));
vi.mock('@/lib/saas/transferencia', () => ({ listarFacturasSaas: dobles.listarFacturasSaas, TECHO_FACTURAS_SAAS: 2000 }));
vi.mock('@/lib/admin/negocio', () => ({ costoIaVentana: dobles.costoIaVentana }));
vi.mock('./gastos', () => ({ getGastosDelMes: dobles.getGastosDelMes }));
vi.mock('./comisiones', () => ({ leerComisionesDelMes: dobles.leerComisionesDelMes }));
vi.mock('./contabilidad', () => ({ leerMovimientosDelMes: dobles.leerMovimientosDelMes }));

import {
  aCent, armarCierre, bloqueantesPendientes, cerrarMes, cierreDeFila, columnasDeCierre, comprobaciones, cuadraConFacturas, ErrorCierre, esCobradoDelMes,
  cobradoDelMesAnterior, facturaInsumoDe, generarBorrador, guardarTipoCambio, leerCierre, leerCierresRecientes, leerInsumosCierre, leerVistaCierre, marcarListo,
  puedeMarcarseListo, recalcularNeto, reabrirMes, tipoCambioValido,
  type FacturaInsumo, type InsumosCierre,
} from './cierre';
import { NO_DISPONIBLE, OK } from './lectura';

// ───────────── fixtures ─────────────
const P = '2024-03-01';
const PAGADA_EN = '2024-03-15T16:00:00Z';

const fac = (o: Partial<FacturaInsumo> = {}): FacturaInsumo => ({
  id: 'f1', tenantId: 't1', tenantNombre: 'Flota Uno', estado: 'pagada', periodoInicio: '2024-03-01',
  totalCent: 116000, subtotalCent: 100000, ivaCent: 16000, creadaEn: '2024-03-01T12:00:00Z',
  pagadaEn: PAGADA_EN, conciliadaEn: PAGADA_EN, referenciaBanco: 'SPEI 123', ...o,
});

const comisionesCero = { periodo: P, devengadoCent: 0, clawbackCent: 0, pagadoCent: 0 };

const insumos = (o: Partial<InsumosCierre> = {}): InsumosCierre => ({
  periodo: P,
  facturas: OK([]),
  facturasTruncadas: false,
  cobradoSql: OK(0),
  costoIa: OK({ totalUsd: 0, porTenantUsd: [] }),
  tipoCambio: 17,
  gastos: OK([]),
  comisiones: OK(comisionesCero),
  movimientos: NO_DISPONIBLE,
  ...o,
});

const gasto = (o: Record<string, unknown> = {}) => ({
  id: 'g1', proveedorId: 'p1', proveedor: 'Vercel', fecha: '2024-03-05', periodo: P, concepto: null, moneda: 'MXN' as const,
  totalCent: 20000, subtotalCent: null, ivaAcreditableCent: null, cfdiUuid: null, comprobante: 'sin_comprobante' as const, cuentaContable: null, conciliado: false, ...o,
});

// ───────────── dinero ─────────────
describe('aCent', () => {
  it('redondea a centavos sin creerle a la coma flotante y conserva el signo', () => {
    expect(aCent(1.005)).toBe(101);
    expect(aCent(-1.005)).toBe(-101);
    expect(aCent(1160)).toBe(116000);
    expect(aCent(0.1 + 0.2)).toBe(30);
    expect(Object.is(aCent(-0.001), 0)).toBe(true);
  });
});

describe('esCobradoDelMes', () => {
  it('cuenta una pagada con pago en el mes, conciliada y con referencia de banco', () => {
    expect(esCobradoDelMes(fac(), P)).toBe(true);
  });
  it('excluye una «pagada» sin referencia de banco, sin conciliar, pendiente, fallida o cancelada', () => {
    expect(esCobradoDelMes(fac({ referenciaBanco: null }), P)).toBe(false);
    expect(esCobradoDelMes(fac({ referenciaBanco: '   ' }), P)).toBe(false);
    expect(esCobradoDelMes(fac({ conciliadaEn: null }), P)).toBe(false);
    for (const estado of ['pendiente', 'fallida', 'cancelada']) expect(esCobradoDelMes(fac({ estado }), P)).toBe(false);
  });
  it('excluye una pagada en otro mes o sin fecha de pago', () => {
    expect(esCobradoDelMes(fac({ pagadaEn: '2024-04-02T16:00:00Z' }), P)).toBe(false);
    expect(esCobradoDelMes(fac({ pagadaEn: null }), P)).toBe(false);
  });
  it('mes frontera: un pago el 31-dic a las 18:01 de México (01-ene 00:01 UTC) es de diciembre, no de enero', () => {
    const f = fac({ pagadaEn: '2025-01-01T00:01:00Z', conciliadaEn: '2025-01-01T00:01:00Z' });
    expect(esCobradoDelMes(f, '2024-12-01')).toBe(true);
    expect(esCobradoDelMes(f, '2025-01-01')).toBe(false);
  });
});

describe('facturaInsumoDe', () => {
  it('pasa pesos a centavos y conserva null en el desglose ausente', () => {
    const f = facturaInsumoDe({
      id: 'a', tenantId: 't', tenantNombre: 'X', periodoInicio: '2024-03-01', periodoFin: '2024-03-31', monto: 11600.5, subtotal: null, iva: null, moneda: 'MXN',
      estado: 'pagada', referencia: null, metodoCobro: null, referenciaBanco: 'r', pagadaEn: PAGADA_EN, conciliadaEn: PAGADA_EN, cfdiUuid: null, timbradaEn: null,
      cfdiCanceladoEn: null, cfdiXmlUrl: null, cfdiVerificacionUrl: null, creadaEn: '2024-03-01T00:00:00Z',
    });
    expect(f.totalCent).toBe(1160050);
    expect(f.subtotalCent).toBeNull();
    expect(f.ivaCent).toBeNull();
  });
});

// ───────────── armarCierre ─────────────
describe('armarCierre', () => {
  it('suma el cobrado con IVA, el ingreso sin IVA y el IVA; el neto sale de los componentes', () => {
    const c = armarCierre(insumos({
      facturas: OK([fac(), fac({ id: 'f2', totalCent: 58000, subtotalCent: 50000, ivaCent: 8000 })]),
      cobradoSql: OK(174000),
      gastos: OK([gasto()]),
      comisiones: OK({ periodo: P, devengadoCent: 10000, clawbackCent: 0, pagadoCent: 0 }),
    }));
    expect(c.cobradoTotalCent).toBe(174000);
    expect(c.ingresosCobradosCent).toBe(150000);
    expect(c.ivaTrasladadoCent).toBe(24000);
    expect(c.nCobradas).toBe(2);
    // 150000 − 0 (IA) − 20000 (gastos) − (10000 − 0)
    expect(c.netoCent).toBe(120000);
    expect(c.faltantes).toEqual([]);
  });

  it('el clawback se toma como magnitud sin importar el signo con que llegue y reduce el gasto de comisiones', () => {
    const base = { facturas: OK([fac()]), comisiones: OK({ periodo: P, devengadoCent: 10000, clawbackCent: -3000, pagadoCent: 0 }) };
    const a = armarCierre(insumos(base));
    const b = armarCierre(insumos({ ...base, comisiones: OK({ periodo: P, devengadoCent: 10000, clawbackCent: 3000, pagadoCent: 0 }) }));
    expect(a.clawbackCent).toBe(3000);
    expect(a.netoCent).toBe(100000 - (10000 - 3000));
    expect(b.netoCent).toBe(a.netoCent);
  });

  it('una pagada sin referencia de banco NO entra al cobrado y se cuenta aparte', () => {
    const c = armarCierre(insumos({ facturas: OK([fac(), fac({ id: 'f2', referenciaBanco: null, totalCent: 58000, subtotalCent: 50000, ivaCent: 8000 })]) }));
    expect(c.cobradoTotalCent).toBe(116000);
    expect(c.nCobradas).toBe(1);
    expect(c.pagadasSinEvidencia).toEqual({ n: 1, totalCent: 58000 });
  });

  it('las canceladas y las de otros meses no cuentan como facturado del mes', () => {
    const c = armarCierre(insumos({
      facturas: OK([
        fac({ id: 'a', estado: 'pendiente', pagadaEn: null, conciliadaEn: null, referenciaBanco: null }),
        fac({ id: 'b', estado: 'cancelada', pagadaEn: null, conciliadaEn: null, referenciaBanco: null }),
        fac({ id: 'c', periodoInicio: '2024-02-01', estado: 'pendiente', pagadaEn: null, conciliadaEn: null, referenciaBanco: null }),
      ]),
    }));
    expect(c.ingresosFacturadosCent).toBe(100000);
    expect(c.cobradoTotalCent).toBe(0);
  });

  it('un mes sin facturas es un cero REAL (la lectura fue buena), y se distingue de no haber podido leer', () => {
    const c = armarCierre(insumos({ facturas: OK([]) }));
    expect(c.cobradoTotalCent).toBe(0);
    expect(c.nCobradas).toBe(0);
    expect(c.netoCent).toBe(0);
  });

  it('lectura de facturas no disponible o con error: el cobrado y el neto son null, jamás 0', () => {
    for (const facturas of [NO_DISPONIBLE, { estado: 'error' as const, mensaje: 'caída' }]) {
      const c = armarCierre(insumos({ facturas }));
      expect(c.cobradoTotalCent).toBeNull();
      expect(c.ingresosCobradosCent).toBeNull();
      expect(c.netoCent).toBeNull();
      expect(c.margenes).toBeNull();
      expect(c.pagadasSinEvidencia).toBeNull();
      expect(c.faltantes).toContain('facturas');
    }
  });

  it('una lista de facturas recortada por el tope no se presenta como completa', () => {
    const c = armarCierre(insumos({ facturas: OK([fac()]), facturasTruncadas: true }));
    expect(c.cobradoTotalCent).toBeNull();
    expect(c.netoCent).toBeNull();
    expect(c.faltantes).toEqual(['facturas_truncadas']);
  });

  it('una cobrada sin desglose de IVA deja el ingreso sin IVA y el neto en null (el total sí se conoce)', () => {
    const c = armarCierre(insumos({ facturas: OK([fac({ subtotalCent: null, ivaCent: null })]) }));
    expect(c.cobradoTotalCent).toBe(116000);
    expect(c.ingresosCobradosCent).toBeNull();
    expect(c.ivaTrasladadoCent).toBeNull();
    expect(c.netoCent).toBeNull();
    expect(c.faltantes).toEqual(['desglose_iva']);
  });

  it('neto null si falta cualquier componente, y faltantes[] dice cuál', () => {
    const facturas = OK([fac()]);
    expect(armarCierre(insumos({ facturas, gastos: NO_DISPONIBLE })).faltantes).toEqual(['gastos']);
    expect(armarCierre(insumos({ facturas, gastos: NO_DISPONIBLE })).netoCent).toBeNull();
    expect(armarCierre(insumos({ facturas, comisiones: { estado: 'error', mensaje: 'x' } })).faltantes).toEqual(['comisiones']);
    expect(armarCierre(insumos({ facturas, costoIa: NO_DISPONIBLE })).faltantes).toEqual(['costo_ia']);
    const varias = armarCierre(insumos({ facturas, gastos: NO_DISPONIBLE, comisiones: NO_DISPONIBLE }));
    expect(varias.faltantes).toEqual(['gastos', 'comisiones']);
    expect(varias.netoCent).toBeNull();
  });

  it('COGS de IA: dólares × tipo de cambio del mes, a centavos; sin tipo de cambio es null y el neto también', () => {
    const facturas = OK([fac()]);
    const con = armarCierre(insumos({ facturas, costoIa: OK({ totalUsd: 10, porTenantUsd: [] }), tipoCambio: 17.25 }));
    expect(con.cogsIaCent).toBe(17250);
    expect(con.netoCent).toBe(100000 - 17250);
    const sin = armarCierre(insumos({ facturas, costoIa: OK({ totalUsd: 10, porTenantUsd: [] }), tipoCambio: null }));
    expect(sin.cogsIaCent).toBeNull();
    expect(sin.netoCent).toBeNull();
    expect(sin.faltantes).toEqual(['tipo_cambio']);
  });

  it('cero dólares de IA son cero pesos aunque falte el tipo de cambio', () => {
    const c = armarCierre(insumos({ facturas: OK([fac()]), costoIa: OK({ totalUsd: 0, porTenantUsd: [] }), tipoCambio: null }));
    expect(c.cogsIaCent).toBe(0);
    expect(c.faltantes).toEqual([]);
  });

  it('mes frontera: el cobrado del 31-dic 18:01 México es de diciembre y no de enero', () => {
    const f = fac({ periodoInicio: '2024-12-01', pagadaEn: '2025-01-01T00:01:00Z', conciliadaEn: '2025-01-01T00:01:00Z' });
    expect(armarCierre(insumos({ periodo: '2024-12-01', facturas: OK([f]) }), '2024-12-01').cobradoTotalCent).toBe(116000);
    expect(armarCierre(insumos({ periodo: '2025-01-01', facturas: OK([f]) }), '2025-01-01').cobradoTotalCent).toBe(0);
  });

  it('margen por cliente: ingreso sin IVA menos IA en pesos; el que no se puede calcular va al final con null', () => {
    const c = armarCierre(insumos({
      facturas: OK([
        fac(),
        fac({ id: 'f2', tenantId: 't2', tenantNombre: 'Flota Dos', totalCent: 58000, subtotalCent: 50000, ivaCent: 8000 }),
        fac({ id: 'f3', tenantId: 't3', tenantNombre: 'Flota Tres', subtotalCent: null, ivaCent: null }),
      ]),
      costoIa: OK({ totalUsd: 12, porTenantUsd: [{ tenantId: 't1', usd: 2 }, { tenantId: 't2', usd: 10 }, { tenantId: 't4', usd: 0 }] }),
      tipoCambio: 20,
    }));
    expect(c.margenes).toEqual([
      { tenantId: 't1', nombre: 'Flota Uno', ingresosCent: 100000, costoIaCent: 4000, margenCent: 96000 },
      { tenantId: 't2', nombre: 'Flota Dos', ingresosCent: 50000, costoIaCent: 20000, margenCent: 30000 },
      { tenantId: 't4', nombre: null, ingresosCent: 0, costoIaCent: 0, margenCent: 0 },
      { tenantId: 't3', nombre: 'Flota Tres', ingresosCent: null, costoIaCent: 0, margenCent: null },
    ]);
  });

  it('sin tipo de cambio, el margen de un cliente con IA es null (no se inventa la conversión)', () => {
    const c = armarCierre(insumos({
      facturas: OK([fac()]),
      costoIa: OK({ totalUsd: 2, porTenantUsd: [{ tenantId: 't1', usd: 2 }] }),
      tipoCambio: null,
    }));
    expect(c.margenes).toEqual([{ tenantId: 't1', nombre: 'Flota Uno', ingresosCent: 100000, costoIaCent: null, margenCent: null }]);
  });
});

describe('recalcularNeto y cuadraConFacturas', () => {
  it('recalcularNeto es null con un solo componente en null', () => {
    const c = { ingresosCobradosCent: 100, cogsIaCent: 10, gastosCent: 20, comisionesDevengadasCent: 5, clawbackCent: 1 };
    expect(recalcularNeto(c)).toBe(100 - 10 - 20 - 4);
    expect(recalcularNeto({ ...c, gastosCent: null })).toBeNull();
  });
  it('cuadraConFacturas: true, false o null cuando falta una vía', () => {
    expect(cuadraConFacturas(100, 100)).toBe(true);
    expect(cuadraConFacturas(100, 101)).toBe(false);
    expect(cuadraConFacturas(null, 100)).toBeNull();
    expect(cuadraConFacturas(100, null)).toBeNull();
  });
});

// ───────────── comprobaciones ─────────────
describe('comprobaciones', () => {
  const armar = (o: Partial<InsumosCierre> = {}, guardado?: { netoCent: number | null } | null) => {
    const i = insumos({ facturas: OK([fac()]), cobradoSql: OK(116000), ...o });
    const c = armarCierre(i);
    return { i, c, cs: comprobaciones(c, i, guardado) };
  };
  const de = (cs: ReturnType<typeof comprobaciones>, clave: string) => cs.find((x) => x.clave === clave)!;

  it('con todo en orden las cinco están y las bloqueantes pasan', () => {
    const { cs } = armar();
    expect(cs.map((x) => x.clave)).toEqual(['cobrado_dos_vias', 'neto_recalculado', 'usd_con_tipo_cambio', 'libro_cuadra', 'pagadas_sin_evidencia']);
    expect(cs.filter((x) => x.bloqueante).map((x) => x.clave)).toEqual(['cobrado_dos_vias', 'neto_recalculado', 'usd_con_tipo_cambio']);
    expect(bloqueantesPendientes(cs)).toEqual([]);
    expect(puedeMarcarseListo(cs)).toBe(true);
  });

  it('C1: si las dos vías del cobrado difieren, falla con la diferencia y el cierre no puede quedar listo', () => {
    const { cs } = armar({ cobradoSql: OK(100000) });
    const c1 = de(cs, 'cobrado_dos_vias');
    expect(c1.estado).toBe('falla');
    expect(c1).toMatchObject({ aCent: 116000, bCent: 100000, diffCent: 16000 });
    expect(puedeMarcarseListo(cs)).toBe(false);
    expect(bloqueantesPendientes(cs).map((x) => x.clave)).toEqual(['cobrado_dos_vias']);
  });

  it('C1: si una vía no se pudo leer, no es evaluable (y también bloquea)', () => {
    const { cs } = armar({ cobradoSql: { estado: 'error', mensaje: 'x' } });
    expect(de(cs, 'cobrado_dos_vias').estado).toBe('no_evaluable');
    expect(puedeMarcarseListo(cs)).toBe(false);
  });

  it('C2: el neto guardado en el borrador debe ser igual al recalculado; si cambió, falla', () => {
    expect(de(armar({}, { netoCent: 100000 }).cs, 'neto_recalculado').estado).toBe('ok');
    const mal = de(armar({}, { netoCent: 90000 }).cs, 'neto_recalculado');
    expect(mal.estado).toBe('falla');
    expect(mal).toMatchObject({ aCent: 90000, bCent: 100000, diffCent: -10000 });
  });

  it('C2: neto sin dato en ambos lados es no_evaluable, no «ok»', () => {
    const { cs } = armar({ gastos: NO_DISPONIBLE }, { netoCent: null });
    expect(de(cs, 'neto_recalculado').estado).toBe('no_evaluable');
    expect(puedeMarcarseListo(cs)).toBe(false);
  });

  it('C3: gastos en USD o costo de IA sin tipo de cambio fallan; sin USD, pasa; con tipo de cambio, pasa', () => {
    const conUsd = armar({ gastos: OK([gasto({ moneda: 'USD' })]), tipoCambio: null });
    expect(de(conUsd.cs, 'usd_con_tipo_cambio').estado).toBe('falla');
    const conIa = armar({ costoIa: OK({ totalUsd: 3, porTenantUsd: [] }), tipoCambio: null });
    expect(de(conIa.cs, 'usd_con_tipo_cambio').estado).toBe('falla');
    expect(de(armar({ tipoCambio: null }).cs, 'usd_con_tipo_cambio').estado).toBe('ok');
    expect(de(armar({ gastos: OK([gasto({ moneda: 'USD' })]), tipoCambio: 17 }).cs, 'usd_con_tipo_cambio').estado).toBe('ok');
  });

  it('C3: sin poder leer los gastos y sin tipo de cambio, no es evaluable', () => {
    expect(de(armar({ gastos: NO_DISPONIBLE, tipoCambio: null }).cs, 'usd_con_tipo_cambio').estado).toBe('no_evaluable');
  });

  it('C4 (informativa): sin módulo de contabilidad es no_evaluable; con libro, compara debe y haber', () => {
    expect(de(armar().cs, 'libro_cuadra')).toMatchObject({ estado: 'no_evaluable', bloqueante: false });
    const mov = (debeCent: number, haberCent: number) => ({ asientoId: 'a', fecha: '2024-03-05', cuenta: '1000', debeCent, haberCent, concepto: null, soporte: 'cfdi' as const });
    expect(de(armar({ movimientos: OK([mov(500, 0), mov(0, 500)]) }).cs, 'libro_cuadra')).toMatchObject({ estado: 'ok', n: 2 });
    const mal = de(armar({ movimientos: OK([mov(500, 0), mov(0, 400)]) }).cs, 'libro_cuadra');
    expect(mal).toMatchObject({ estado: 'falla', diffCent: 100, bloqueante: false });
  });

  it('una comprobación informativa en falla NO impide marcar listo', () => {
    const mov = (debeCent: number, haberCent: number) => ({ asientoId: 'a', fecha: '2024-03-05', cuenta: '1000', debeCent, haberCent, concepto: null, soporte: 'cfdi' as const });
    const { cs } = armar({ movimientos: OK([mov(500, 0)]) });
    expect(de(cs, 'libro_cuadra').estado).toBe('falla');
    expect(puedeMarcarseListo(cs)).toBe(true);
  });

  it('C5 (informativa): avisa de las pagadas sin evidencia de banco', () => {
    const i = insumos({ facturas: OK([fac(), fac({ id: 'f2', conciliadaEn: null, referenciaBanco: null })]), cobradoSql: OK(116000) });
    const cs = comprobaciones(armarCierre(i), i);
    expect(de(cs, 'pagadas_sin_evidencia')).toMatchObject({ estado: 'aviso', n: 1, bloqueante: false });
    expect(puedeMarcarseListo(cs)).toBe(true);
  });

  it('sin comprobaciones corridas no se puede marcar listo', () => {
    expect(puedeMarcarseListo([])).toBe(false);
  });
});

// ───────────── persistencia pura ─────────────
describe('columnasDeCierre y cierreDeFila', () => {
  it('los centavos pasan a pesos y null sigue siendo null (no 0)', () => {
    const c = armarCierre(insumos({ facturas: OK([fac()]), gastos: NO_DISPONIBLE }));
    const cols = columnasDeCierre(c, [], '2024-04-02T00:00:00Z');
    expect(cols.ingresos_cobrados).toBe(1000);
    expect(cols.iva_trasladado).toBe(160);
    expect(cols.gastos_operativos).toBeNull();
    expect(cols.neto).toBeNull();
    expect(cols.snapshot.version).toBe(1);
    expect(cols.snapshot.cierre.faltantes).toEqual(['gastos']);
  });

  it('cierreDeFila devuelve el neto en centavos y descarta un snapshot con forma rara', () => {
    const f = { periodo: P, estado: 'listo', neto: '1000.50', tipo_cambio_usd: '17.2500', snapshot: { raro: true }, cerrado_por: null, cerrado_en: null, actualizado_en: 'x' };
    const g = cierreDeFila(f);
    expect(g).toMatchObject({ estado: 'listo', netoCent: 100050, tipoCambio: 17.25, snapshot: null });
    expect(cierreDeFila({ ...f, neto: null, estado: 'inventado' })).toMatchObject({ netoCent: null, estado: 'abierto' });
  });
});

describe('tipoCambioValido', () => {
  it('positivo, finito y a lo más 4 decimales', () => {
    expect(tipoCambioValido(17.2345)).toBe(true);
    expect(tipoCambioValido(17.23456)).toBe(false);
    expect(tipoCambioValido(0)).toBe(false);
    expect(tipoCambioValido(-1)).toBe(false);
    expect(tipoCambioValido(Number.NaN)).toBe(false);
    expect(tipoCambioValido(5000)).toBe(false);
  });
});

// ───────────── IO con dobles ─────────────
/** Un constructor de consulta de supabase-js: encadenable y esperable. `unica` es lo que devuelve maybeSingle(). */
function consulta(resultado: Record<string, unknown>) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lt', 'not', 'neq', 'limit', 'order', 'update', 'upsert']) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => resultado);
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resultado).then(res, rej);
  return q;
}

/** `from(tabla)` consume la cola de esa tabla en orden. */
function colas(porTabla: Record<string, Array<Record<string, unknown>>>) {
  const consultas: Array<{ tabla: string; q: Record<string, unknown> }> = [];
  dobles.from.mockImplementation((tabla: string) => {
    const q = consulta((porTabla[tabla] ?? []).shift() ?? { data: null, error: null });
    consultas.push({ tabla, q });
    return q;
  });
  return consultas;
}

const filaSaas = (o: Record<string, unknown> = {}) => ({
  id: 'f1', tenantId: 't1', tenantNombre: 'Flota Uno', periodoInicio: '2024-03-01', periodoFin: '2024-03-31', monto: 1160, subtotal: 1000, iva: 160, moneda: 'MXN',
  estado: 'pagada', referencia: 'LK', metodoCobro: 'transferencia', referenciaBanco: 'SPEI 123', pagadaEn: PAGADA_EN, conciliadaEn: PAGADA_EN, cfdiUuid: null,
  timbradaEn: null, cfdiCanceladoEn: null, cfdiXmlUrl: null, cfdiVerificacionUrl: null, creadaEn: '2024-03-01T12:00:00Z', ...o,
});

beforeEach(() => {
  for (const d of Object.values(dobles)) d.mockReset();
  dobles.listarFacturasSaas.mockResolvedValue({ filas: [filaSaas()], total: 1, truncado: false });
  dobles.costoIaVentana.mockResolvedValue({ totales: { n: 0, costoUsd: 0, tokensIn: 0, tokensOut: 0 }, porFase: [], porTenant: [] });
  dobles.getGastosDelMes.mockResolvedValue(OK([]));
  dobles.leerComisionesDelMes.mockResolvedValue(OK(comisionesCero));
  dobles.leerMovimientosDelMes.mockResolvedValue(NO_DISPONIBLE);
});

describe('leerInsumosCierre', () => {
  it('junta todas las fuentes; la vía B sale de la base con el filtro del mes', async () => {
    colas({ factura_saas: [{ data: [{ monto: 1160 }], count: 1, error: null }] });
    const i = await leerInsumosCierre(P, 17);
    expect(i.facturas).toEqual({ estado: 'ok', dato: [expect.objectContaining({ id: 'f1', totalCent: 116000, subtotalCent: 100000 })] });
    expect(i.cobradoSql).toEqual({ estado: 'ok', dato: 116000 });
    expect(i.tipoCambio).toBe(17);
    expect(i.gastos).toEqual(OK([]));
    expect(dobles.costoIaVentana).toHaveBeenCalledWith('2024-03-01T00:00:00-06:00', '2024-04-01T00:00:00-06:00');
    expect(dobles.getGastosDelMes).toHaveBeenCalledWith(P);
  });

  it('un módulo de otro lote que no existe es no_disponible (no cero); uno que falla de verdad es error', async () => {
    colas({ factura_saas: [{ data: [], count: 0, error: null }] });
    dobles.getGastosDelMes.mockRejectedValue(new Error('Cannot find module ./gastos'));
    dobles.leerComisionesDelMes.mockRejectedValue(new Error('la base se cayó'));
    const i = await leerInsumosCierre(P, null);
    expect(i.gastos).toEqual({ estado: 'no_disponible' });
    expect(i.comisiones).toEqual({ estado: 'error', mensaje: 'la base se cayó' });
  });

  it('facturas truncadas por el tope se marcan; una lectura de facturas que falla queda en error', async () => {
    colas({ factura_saas: [{ data: [], count: 0, error: null }, { data: [], count: 0, error: null }] });
    dobles.listarFacturasSaas.mockResolvedValueOnce({ filas: [filaSaas()], total: 2500, truncado: true });
    expect((await leerInsumosCierre(P, null)).facturasTruncadas).toBe(true);
    dobles.listarFacturasSaas.mockRejectedValueOnce(new Error('listarFacturasSaas: timeout'));
    const i = await leerInsumosCierre(P, null);
    expect(i.facturas.estado).toBe('error');
    expect(i.facturasTruncadas).toBe(false);
  });

  it('la vía B recortada por el tope de filas es error, no una suma parcial', async () => {
    colas({ factura_saas: [{ data: [{ monto: 1 }], count: 9999, error: null }] });
    expect((await leerInsumosCierre(P, null)).cobradoSql.estado).toBe('error');
  });

  it('sin tipo de cambio dado, lo lee del cierre guardado', async () => {
    colas({
      factura_saas: [{ data: [], count: 0, error: null }],
      bo_cierre_mes: [{ data: { periodo: P, estado: 'abierto', neto: null, tipo_cambio_usd: '18.5000', snapshot: {}, cerrado_por: null, cerrado_en: null, actualizado_en: null }, error: null }],
    });
    expect((await leerInsumosCierre(P)).tipoCambio).toBe(18.5);
  });
});

describe('flujo del cierre', () => {
  const filaCierre = (o: Record<string, unknown> = {}) => ({
    data: { periodo: P, estado: 'abierto', neto: 1000, tipo_cambio_usd: 17, snapshot: {}, cerrado_por: null, cerrado_en: null, actualizado_en: null, ...o },
    error: null,
  });
  const ESPERADO = (e: unknown) => expect(e).toBeInstanceOf(ErrorCierre);

  it('periodo inválido y mes en curso se rechazan antes de tocar la base', async () => {
    await expect(generarBorrador('2024-03-15')).rejects.toMatchObject({ codigo: 'periodo_invalido' });
    await expect(marcarListo('2999-01-01')).rejects.toMatchObject({ codigo: 'mes_en_curso' });
    expect(dobles.from).not.toHaveBeenCalled();
  });

  it('generarBorrador guarda un borrador abierto con las comprobaciones en el snapshot', async () => {
    const cs = colas({ bo_cierre_mes: [{ data: null, error: null }, { error: null }], factura_saas: [{ data: [{ monto: 1160 }], count: 1, error: null }] });
    const r = await generarBorrador(P);
    expect(r.cierre.netoCent).toBe(100000);
    expect(r.comprobaciones).toHaveLength(5);
    const upsert = cs.filter((c) => c.tabla === 'bo_cierre_mes')[1].q.upsert as ReturnType<typeof vi.fn>;
    const [fila, opts] = upsert.mock.calls[0];
    expect(fila).toMatchObject({ periodo: P, estado: 'abierto', neto: 1000, ingresos_cobrados: 1000 });
    expect(fila.snapshot.comprobaciones).toHaveLength(5);
    expect(opts).toEqual({ onConflict: 'periodo' });
  });

  it('un mes cerrado no admite un borrador nuevo; con la tabla ausente se dice no disponible', async () => {
    colas({ bo_cierre_mes: [filaCierre({ estado: 'cerrado', cerrado_por: 'u', cerrado_en: '2024-04-03T00:00:00Z' })] });
    await expect(generarBorrador(P)).rejects.toMatchObject({ codigo: 'ya_cerrado' });
    colas({ bo_cierre_mes: [{ data: null, error: { code: '42P01', message: 'relation does not exist' } }] });
    await expect(generarBorrador(P)).rejects.toMatchObject({ codigo: 'tabla_no_disponible' });
  });

  it('marcarListo: sin borrador, o en otro estado, se rechaza', async () => {
    colas({ bo_cierre_mes: [{ data: null, error: null }] });
    await expect(marcarListo(P)).rejects.toMatchObject({ codigo: 'sin_borrador' });
    colas({ bo_cierre_mes: [filaCierre({ estado: 'listo' })] });
    await expect(marcarListo(P)).rejects.toMatchObject({ codigo: 'estado_incorrecto' });
  });

  it('marcarListo con todo en verde pasa el mes a listo (compare-and-set sobre el estado abierto)', async () => {
    const cs = colas({
      bo_cierre_mes: [filaCierre(), { data: [{ periodo: P }], error: null }],
      factura_saas: [{ data: [{ monto: 1160 }], count: 1, error: null }],
    });
    const r = await marcarListo(P);
    expect(puedeMarcarseListo(r.comprobaciones)).toBe(true);
    const upd = cs.filter((c) => c.tabla === 'bo_cierre_mes')[1].q;
    expect((upd.update as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ estado: 'listo', neto: 1000 });
    expect((upd.eq as ReturnType<typeof vi.fn>).mock.calls).toEqual([['periodo', P], ['estado', 'abierto']]);
  });

  it('marcarListo con una bloqueante en rojo se rechaza con la lista de pendientes y NO escribe', async () => {
    const cs = colas({
      bo_cierre_mes: [filaCierre()],
      // La vía B de la base dice 900.00 y la suma en JS 1,160.00: no cuadran.
      factura_saas: [{ data: [{ monto: 900 }], count: 1, error: null }],
    });
    try {
      await marcarListo(P);
      throw new Error('debía rechazar');
    } catch (e) {
      ESPERADO(e);
      expect((e as ErrorCierre).codigo).toBe('bloqueantes');
      expect((e as ErrorCierre).pendientes.map((p) => p.clave)).toEqual(['cobrado_dos_vias']);
    }
    expect(cs.filter((c) => c.tabla === 'bo_cierre_mes')).toHaveLength(1);
  });

  it('si el neto cambió desde el borrador, no se marca listo (hay que regenerar)', async () => {
    colas({
      bo_cierre_mes: [filaCierre({ neto: 5 })],
      factura_saas: [{ data: [{ monto: 1160 }], count: 1, error: null }],
    });
    await expect(marcarListo(P)).rejects.toMatchObject({ codigo: 'bloqueantes', pendientes: [expect.objectContaining({ clave: 'neto_recalculado', estado: 'falla' })] });
  });

  it('marcarListo con dos pestañas: si otro ya movió el estado, conflicto', async () => {
    colas({
      bo_cierre_mes: [filaCierre(), { data: [], error: null }],
      factura_saas: [{ data: [{ monto: 1160 }], count: 1, error: null }],
    });
    await expect(marcarListo(P)).rejects.toMatchObject({ codigo: 'conflicto' });
  });

  it('cerrarMes exige estado listo y firma quién cierra', async () => {
    colas({ bo_cierre_mes: [filaCierre({ estado: 'abierto' })] });
    await expect(cerrarMes(P, 'u1')).rejects.toMatchObject({ codigo: 'estado_incorrecto' });
    const cs = colas({
      bo_cierre_mes: [filaCierre({ estado: 'listo' }), { data: [{ periodo: P }], error: null }],
      factura_saas: [{ data: [{ monto: 1160 }], count: 1, error: null }],
    });
    await cerrarMes(P, 'u1');
    const upd = cs.filter((c) => c.tabla === 'bo_cierre_mes')[1].q;
    const cambios = (upd.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cambios).toMatchObject({ estado: 'cerrado', cerrado_por: 'u1' });
    expect(typeof cambios.cerrado_en).toBe('string');
    expect((upd.eq as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual(['estado', 'listo']);
  });

  it('reabrirMes: el motivo es obligatorio y se llama a la función de la base con quién reabre', async () => {
    await expect(reabrirMes(P, '  ab ', 'u1')).rejects.toMatchObject({ codigo: 'motivo_corto' });
    expect(dobles.rpc).not.toHaveBeenCalled();
    dobles.rpc.mockResolvedValue({ error: null });
    await reabrirMes(P, ' corregir un gasto ', 'u1');
    expect(dobles.rpc).toHaveBeenCalledWith('bo_reabrir_cierre', { p_periodo: P, p_motivo: 'corregir un gasto', p_actor: 'u1' });
    dobles.rpc.mockResolvedValue({ error: { code: '22023', message: 'el cierre de 2024-03-01 no está cerrado (está abierto)' } });
    await expect(reabrirMes(P, 'motivo válido', 'u1')).rejects.toMatchObject({ codigo: 'estado_incorrecto' });
  });

  it('guardarTipoCambio valida, no toca un mes cerrado y devuelve el mes a abierto', async () => {
    await expect(guardarTipoCambio(P, 0)).rejects.toMatchObject({ codigo: 'tipo_cambio_invalido' });
    colas({ bo_cierre_mes: [filaCierre({ estado: 'cerrado', cerrado_por: 'u', cerrado_en: 'x' })] });
    await expect(guardarTipoCambio(P, 17.5)).rejects.toMatchObject({ codigo: 'ya_cerrado' });
    const cs = colas({ bo_cierre_mes: [filaCierre({ estado: 'listo' }), { error: null }] });
    await guardarTipoCambio(P, 17.5);
    const up = cs.filter((c) => c.tabla === 'bo_cierre_mes')[1].q.upsert as ReturnType<typeof vi.fn>;
    expect(up.mock.calls[0][0]).toEqual({ periodo: P, estado: 'abierto', tipo_cambio_usd: 17.5 });
  });
});

describe('leerCierre, leerCierresRecientes y la vista del cierre', () => {
  const fila = (o: Record<string, unknown> = {}) => ({ periodo: P, estado: 'abierto', neto: 1000, tipo_cambio_usd: 17, snapshot: {}, cerrado_por: null, cerrado_en: null, actualizado_en: 'x', ...o });
  const snapshot = {
    version: 1, generadoEn: '2024-04-02T00:00:00Z', comprobaciones: [{ clave: 'cobrado_dos_vias', bloqueante: true, estado: 'ok', aCent: 1, bCent: 1, diffCent: 0, n: 1 }],
    cierre: { periodo: P, cobradoTotalCent: 777, ingresosCobradosCent: 700, ingresosFacturadosCent: 700, ivaTrasladadoCent: 77, cogsIaCent: 0, gastosCent: 0, comisionesDevengadasCent: 0, clawbackCent: 0, netoCent: 700, tipoCambio: 17, nCobradas: 1, pagadasSinEvidencia: { n: 0, totalCent: 0 }, margenes: [], faltantes: [] },
  };

  it('leerCierre: tabla ausente es no_disponible, sin fila es ok con null y un error de la base es error', async () => {
    colas({ bo_cierre_mes: [{ data: null, error: { code: '42P01', message: 'does not exist' } }, { data: null, error: null }, { data: null, error: { code: '57014', message: 'timeout' } }] });
    expect(await leerCierre(P)).toEqual({ estado: 'no_disponible' });
    expect(await leerCierre(P)).toEqual({ estado: 'ok', dato: null });
    expect((await leerCierre(P)).estado).toBe('error');
  });

  it('leerCierresRecientes devuelve los cierres en el orden de la base', async () => {
    colas({ bo_cierre_mes: [{ data: [fila(), fila({ periodo: '2024-02-01', estado: 'cerrado', cerrado_por: 'u', cerrado_en: 'z' })], error: null }] });
    const r = await leerCierresRecientes(2);
    expect(r.estado).toBe('ok');
    if (r.estado === 'ok') expect(r.dato.map((c) => [c.periodo, c.estado])).toEqual([[P, 'abierto'], ['2024-02-01', 'cerrado']]);
  });

  it('un mes CERRADO se muestra con sus cifras congeladas y no se vuelve a leer nada de la base', async () => {
    colas({ bo_cierre_mes: [{ data: fila({ estado: 'cerrado', cerrado_por: 'u1', cerrado_en: '2024-04-03T00:00:00Z', snapshot }), error: null }] });
    const v = await leerVistaCierre(P);
    expect(v.origen).toBe('cerrado');
    expect(v.cierre.cobradoTotalCent).toBe(777);
    expect(v.comprobaciones).toHaveLength(1);
    expect(dobles.listarFacturasSaas).not.toHaveBeenCalled();
    expect(dobles.costoIaVentana).not.toHaveBeenCalled();
  });

  it('un mes abierto se calcula ahora y compara contra el neto del borrador guardado', async () => {
    colas({ bo_cierre_mes: [{ data: fila({ neto: 5 }), error: null }], factura_saas: [{ data: [{ monto: 1160 }], count: 1, error: null }] });
    const v = await leerVistaCierre(P);
    expect(v.origen).toBe('en_vivo');
    expect(v.cierre.netoCent).toBe(100000);
    expect(v.comprobaciones.find((c) => c.clave === 'neto_recalculado')?.estado).toBe('falla');
  });

  it('con la tabla ausente igual calcula en vivo y deja ver que no hay dónde guardar', async () => {
    colas({ bo_cierre_mes: [{ data: null, error: { code: '42P01', message: 'does not exist' } }], factura_saas: [{ data: [{ monto: 1160 }], count: 1, error: null }] });
    const v = await leerVistaCierre(P);
    expect(v.guardado).toEqual({ estado: 'no_disponible' });
    expect(v.cierre.cobradoTotalCent).toBe(116000);
  });

  it('cobradoDelMesAnterior: lo toma del snapshot del cierre anterior; sin cierre guardado es null (sin base no hay variación)', async () => {
    colas({ bo_cierre_mes: [{ data: fila({ periodo: '2024-02-01', snapshot }), error: null }] });
    expect(await cobradoDelMesAnterior(P)).toBe(777);
    colas({ bo_cierre_mes: [{ data: null, error: null }] });
    expect(await cobradoDelMesAnterior(P)).toBeNull();
    colas({ bo_cierre_mes: [{ data: null, error: { code: '42P01', message: 'does not exist' } }] });
    expect(await cobradoDelMesAnterior(P)).toBeNull();
  });
});
