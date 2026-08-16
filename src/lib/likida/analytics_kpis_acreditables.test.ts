import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA DE ESCALA 15-AGO-2026 (mig. 0112): getKpis Y getAcreditables
// PASARON DE `traerTodo` + REDUCE EN JS A `kpis_liquidacion_tenant` /
// `acreditables_liquidacion_tenant` EN SQL.
//
// Las dos leían TODA `liquidacion` del tenant para reducirla a un puñado de
// números — caducaban ~mes 8.3 con 15,000 viajes/mes (docs/escala-15k.md
// §6) y se leen en CADA carga de /dashboard y /dashboard/contador.
//
// Lo que este archivo prueba:
//   1. EQUIVALENCIA — la reducción JS VIEJA (`legacyKpisJs`/
//      `legacyAcreditablesJs`, copias congeladas de la lógica que vivía en
//      analytics.ts antes de la 0112) contra las funciones NUEVAS (con la
//      RPC mockeada por reductores SQL escritos de forma independiente,
//      `sqlKpisEquivalente`/`sqlAcreditablesEquivalente`, que espejan la
//      migración) — sobre el MISMO dataset sintético: mezcla de tipos de
//      diferencia (algunos NO cuentan para el dinero observado), ventana por
//      `p_desde`, liquidaciones sin diferencias, y aislamiento entre tenants.
//   2. Fail-closed: error de la RPC o forma inesperada → LANZAN.
//   3. `viajesLiquidados`/`montoComprobado`/`diferenciaDetectada` no se
//      afirman con un `0` inventado sobre una respuesta rota.
// ═══════════════════════════════════════════════════════════════════════════

type Diferencia = { tipo: string; monto: number };
type LiqFila = {
  tenant_id: string;
  created_at: string;                 // ISO
  total_comprobado: number;
  estatus: 'cuadrada' | 'con_diferencias' | 'revisar';
  diferencias: Diferencia[] | null;
  ieps_acreditable: number;
  iva_acreditable: number;
  peaje_acreditable: number;
  litros_diesel_acreditables: number;
};

function round2(n: number): number {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

const enVentana = (f: LiqFila, tenantId: string, pDesde: string | null) =>
  f.tenant_id === tenantId && (!pDesde || f.created_at >= pDesde);

/** LA REDUCCIÓN JS VIEJA de `getKpis` — copia congelada de analytics.ts
 *  antes de la 0112. Es el oráculo contra el que se mide la RPC. */
function legacyKpisJs(filas: LiqFila[], tenantId: string, pDesde: string | null) {
  const rows = filas.filter((f) => enVentana(f, tenantId, pDesde));
  const conDif = rows.filter((r) => r.estatus === 'con_diferencias').length;
  const revisar = rows.filter((r) => r.estatus === 'revisar').length;
  const cuadradas = rows.filter((r) => r.estatus === 'cuadrada').length;
  const dineroObservado = rows.reduce((s, r) => {
    const difs = r.diferencias ?? [];
    return s + difs.filter((d) => d.tipo === 'sobre_politica' || d.tipo === 'duplicado')
      .reduce((a, d) => a + Math.abs(d.monto), 0);
  }, 0);
  return {
    viajesLiquidados: rows.length,
    montoComprobado: round2(rows.reduce((s, r) => s + Number(r.total_comprobado ?? 0), 0)),
    diferenciaDetectada: round2(dineroObservado),
    conDiferencias: conDif,
    porRevisar: revisar,
    tasaCuadre: rows.length ? Math.round((cuadradas / rows.length) * 100) : 0,
  };
}

/** LA REDUCCIÓN JS VIEJA de `getAcreditables`. */
function legacyAcreditablesJs(filas: LiqFila[], tenantId: string, pDesde: string | null) {
  const rows = filas.filter((f) => enVentana(f, tenantId, pDesde));
  return {
    ieps: round2(rows.reduce((s, r) => s + Number(r.ieps_acreditable ?? 0), 0)),
    iva: round2(rows.reduce((s, r) => s + Number(r.iva_acreditable ?? 0), 0)),
    peaje: round2(rows.reduce((s, r) => s + Number(r.peaje_acreditable ?? 0), 0)),
    litrosDiesel: round2(rows.reduce((s, r) => s + Number(r.litros_diesel_acreditables ?? 0), 0)),
  };
}

/** EL REDUCTOR SQL de `kpis_liquidacion_tenant` — escrito de forma
 *  INDEPENDIENTE, espejando el CTE `base` de la migración: por fila, la suma
 *  de |monto| de diferencias sobre_politica/duplicado; luego los agregados. */
function sqlKpisEquivalente(filas: LiqFila[], tenantId: string, pDesde: string | null) {
  const rows = filas.filter((f) => enVentana(f, tenantId, pDesde));
  const base = rows.map((r) => ({
    ...r,
    dineroFila: (r.diferencias ?? [])
      .filter((d) => d.tipo === 'sobre_politica' || d.tipo === 'duplicado')
      .reduce((s, d) => s + Math.abs(d.monto), 0),
  }));
  const n = base.length;
  const cuadradas = base.filter((r) => r.estatus === 'cuadrada').length;
  return {
    viajesLiquidados: n,
    montoComprobado: base.reduce((s, r) => s + r.total_comprobado, 0),
    diferenciaDetectada: base.reduce((s, r) => s + r.dineroFila, 0),
    conDiferencias: base.filter((r) => r.estatus === 'con_diferencias').length,
    porRevisar: base.filter((r) => r.estatus === 'revisar').length,
    tasaCuadre: n === 0 ? 0 : Math.round((cuadradas * 100) / n),
  };
}

/** EL REDUCTOR SQL de `acreditables_liquidacion_tenant`. */
function sqlAcreditablesEquivalente(filas: LiqFila[], tenantId: string, pDesde: string | null) {
  const rows = filas.filter((f) => enVentana(f, tenantId, pDesde));
  return {
    litrosDiesel: rows.reduce((s, r) => s + r.litros_diesel_acreditables, 0),
    ieps: rows.reduce((s, r) => s + r.ieps_acreditable, 0),
    iva: rows.reduce((s, r) => s + r.iva_acreditable, 0),
    peaje: rows.reduce((s, r) => s + r.peaje_acreditable, 0),
  };
}

const servidor: { filas: LiqFila[] } = { filas: [] };
const llamadasRpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
let forzarError: { message: string } | null = null;
let forzarFormaRota: unknown = undefined;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      llamadasRpc.push({ fn, args });
      if (forzarError) return Promise.resolve({ data: null, error: forzarError });
      if (forzarFormaRota !== undefined) return Promise.resolve({ data: forzarFormaRota, error: null });
      const pTenant = args.p_tenant as string;
      const pDesde = (args.p_desde as string | null) ?? null;
      if (fn === 'kpis_liquidacion_tenant') {
        return Promise.resolve({ data: sqlKpisEquivalente(servidor.filas, pTenant, pDesde), error: null });
      }
      if (fn === 'acreditables_liquidacion_tenant') {
        return Promise.resolve({ data: sqlAcreditablesEquivalente(servidor.filas, pTenant, pDesde), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn() }));
vi.mock('./costos', () => ({ traerResumenCostoIaTenant: vi.fn() }));

const { getKpis, getAcreditables } = await import('./analytics');

beforeEach(() => {
  servidor.filas = [];
  llamadasRpc.length = 0;
  forzarError = null;
  forzarFormaRota = undefined;
});

/** Dataset con la mezcla real de tipos de diferencia que produce
 *  `cuadre/engine.ts`: solo 'sobre_politica' y 'duplicado' cuentan para el
 *  dinero observado — 'fecha_sospechosa', 'folio_verificar', 'sin_cfdi' y
 *  'ocr_baja_confianza' son AVISOS, no dinero perdido, y casi siempre traen
 *  `monto: 0` (el engine los declara explícitos, nunca los omite). */
function liq(over: Partial<LiqFila>): LiqFila {
  return {
    tenant_id: 't1', created_at: '2026-08-10T12:00:00Z', total_comprobado: 0,
    estatus: 'cuadrada', diferencias: null,
    ieps_acreditable: 0, iva_acreditable: 0, peaje_acreditable: 0, litros_diesel_acreditables: 0,
    ...over,
  };
}

describe('getKpis — equivalencia JS viejo vs RPC nueva (mig. 0112)', () => {
  it('mezcla de estatus y tipos de diferencia (algunos NO cuentan como dinero observado)', async () => {
    servidor.filas = [
      liq({ total_comprobado: 1000, estatus: 'cuadrada' }),
      liq({ total_comprobado: 2000, estatus: 'cuadrada' }),
      liq({
        total_comprobado: 1500, estatus: 'con_diferencias',
        diferencias: [
          { tipo: 'sobre_politica', monto: 120.35 },
          { tipo: 'fecha_sospechosa', monto: 0 },      // NO cuenta
          { tipo: 'ocr_baja_confianza', monto: 0 },     // NO cuenta
        ],
      }),
      liq({
        total_comprobado: 800, estatus: 'revisar',
        diferencias: [{ tipo: 'duplicado', monto: 300.5 }, { tipo: 'sin_cfdi', monto: 0 }],
      }),
    ];
    const legacy = legacyKpisJs(servidor.filas, 't1', null);
    const nuevo = await getKpis('t1');
    expect(nuevo).toEqual(legacy);
    expect(nuevo).toEqual({
      viajesLiquidados: 4, montoComprobado: 5300, diferenciaDetectada: 420.85,
      conDiferencias: 1, porRevisar: 1, tasaCuadre: 50,
    });
  });

  it('diferencias null (liquidación sin novedad) no truena y no aporta dinero observado', async () => {
    servidor.filas = [liq({ total_comprobado: 500, estatus: 'cuadrada', diferencias: null })];
    const legacy = legacyKpisJs(servidor.filas, 't1', null);
    const nuevo = await getKpis('t1');
    expect(nuevo).toEqual(legacy);
    expect(nuevo.diferenciaDetectada).toBe(0);
  });

  it('la ventana `ventanaDias` (p_desde) excluye liquidaciones viejas — mismo corte que corteVentana', async () => {
    servidor.filas = [
      liq({ created_at: '2026-01-01T00:00:00Z', total_comprobado: 9999, estatus: 'cuadrada' }), // fuera de la ventana de 7 días
      liq({ created_at: '2026-08-14T00:00:00Z', total_comprobado: 100, estatus: 'cuadrada' }),
    ];
    // `corteVentana` calcula el corte con `hoy` = ahora real; para no acoplar
    // la prueba al reloj, se llama directo con un `p_desde` fijo del lado del
    // reductor SQL y se compara contra la reducción JS con el MISMO corte.
    const corte = '2026-08-01T00:00:00.000Z';
    const legacy = legacyKpisJs(servidor.filas, 't1', corte);
    const nuevo = sqlKpisEquivalente(servidor.filas, 't1', corte);
    expect(nuevo).toEqual(legacy);
    expect(nuevo.viajesLiquidados).toBe(1);
    expect(nuevo.montoComprobado).toBe(100);
  });

  it('aislamiento: otro tenant no contamina la suma', async () => {
    servidor.filas = [
      liq({ tenant_id: 't1', total_comprobado: 100, estatus: 'cuadrada' }),
      liq({ tenant_id: 't2', total_comprobado: 99999, estatus: 'cuadrada' }),
    ];
    const legacy = legacyKpisJs(servidor.filas, 't1', null);
    const nuevo = await getKpis('t1');
    expect(nuevo).toEqual(legacy);
    expect(nuevo.montoComprobado).toBe(100);
  });

  it('un tenant sin liquidaciones da ceros MEDIDOS, tasaCuadre 0 y no NaN', async () => {
    const r = await getKpis('t1');
    expect(r).toEqual({
      viajesLiquidados: 0, montoComprobado: 0, diferenciaDetectada: 0,
      conDiferencias: 0, porRevisar: 0, tasaCuadre: 0,
    });
    expect(Number.isNaN(r.tasaCuadre)).toBe(false);
  });
});

describe('getAcreditables — equivalencia JS viejo vs RPC nueva (mig. 0112)', () => {
  it('suma las cuatro columnas ya calculadas por el motor', async () => {
    servidor.filas = [
      liq({ ieps_acreditable: 50.25, iva_acreditable: 240.1, peaje_acreditable: 30, litros_diesel_acreditables: 400.5 }),
      liq({ ieps_acreditable: 10, iva_acreditable: 60, peaje_acreditable: 5.75, litros_diesel_acreditables: 90.25 }),
    ];
    const legacy = legacyAcreditablesJs(servidor.filas, 't1', null);
    const nuevo = await getAcreditables('t1');
    expect(nuevo).toEqual(legacy);
    expect(nuevo).toEqual({ ieps: 60.25, iva: 300.1, peaje: 35.75, litrosDiesel: 490.75 });
  });

  it('aislamiento: otro tenant no contamina las cuatro sumas', async () => {
    servidor.filas = [
      liq({ tenant_id: 't1', ieps_acreditable: 10, iva_acreditable: 20, peaje_acreditable: 30, litros_diesel_acreditables: 40 }),
      liq({ tenant_id: 't2', ieps_acreditable: 9999, iva_acreditable: 9999, peaje_acreditable: 9999, litros_diesel_acreditables: 9999 }),
    ];
    const nuevo = await getAcreditables('t1');
    expect(nuevo).toEqual({ ieps: 10, iva: 20, peaje: 30, litrosDiesel: 40 });
  });

  it('un tenant sin liquidaciones da ceros MEDIDOS', async () => {
    const r = await getAcreditables('t1');
    expect(r).toEqual({ ieps: 0, iva: 0, peaje: 0, litrosDiesel: 0 });
  });
});

describe('getKpis/getAcreditables — fail-closed (mig. 0112)', () => {
  it('un error de la RPC LANZA en las dos', async () => {
    forzarError = { message: 'TypeError: fetch failed (ENOTFOUND db.supabase.co)' };
    await expect(getKpis('t1')).rejects.toThrow(/fetch failed/);
    await expect(getAcreditables('t1')).rejects.toThrow(/fetch failed/);
  });

  it('una forma inesperada (¿migración 0112 sin aplicar?) LANZA, no pinta un 0 medido', async () => {
    forzarFormaRota = { viajesLiquidados: '4', montoComprobado: null };
    await expect(getKpis('t1')).rejects.toThrow(/0112/);
    forzarFormaRota = { litrosDiesel: 'no-es-un-numero' };
    await expect(getAcreditables('t1')).rejects.toThrow(/0112/);
  });

  it('data null LANZA en las dos', async () => {
    forzarFormaRota = null;
    await expect(getKpis('t1')).rejects.toThrow(/0112/);
    await expect(getAcreditables('t1')).rejects.toThrow(/0112/);
  });
});

describe('getKpis/getAcreditables — el tenant y la ventana viajan como argumentos de la RPC', () => {
  it('manda p_tenant y p_desde (null sin ventana)', async () => {
    await getKpis('t1');
    await getAcreditables('t1', 7);
    const kpisArgs = llamadasRpc.find((l) => l.fn === 'kpis_liquidacion_tenant')!.args;
    const acredArgs = llamadasRpc.find((l) => l.fn === 'acreditables_liquidacion_tenant')!.args;
    expect(kpisArgs.p_tenant).toBe('t1');
    expect(kpisArgs.p_desde).toBeNull();
    expect(acredArgs.p_tenant).toBe('t1');
    expect(typeof acredArgs.p_desde).toBe('string'); // con ventanaDias, corteVentana da un ISO, no null
  });
});
