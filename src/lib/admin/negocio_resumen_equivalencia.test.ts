import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// ESCALA 50k (mig. 0153): `getResumenNegocio` PASÓ DE DOS `traerTodo`
// (viaje y gasto ENTEROS, de todas las flotas) + conteo en JS A
// `resumen_negocio()` EN SQL.
//
// Lo que este archivo prueba (el molde de analytics_serie_comparativa.test.ts):
//   1. EQUIVALENCIA — la reducción JS VIEJA (`legacyResumenJs`, copia
//      congelada de negocio.ts antes de la 0153) contra la función NUEVA
//      (con la RPC mockeada por un reductor SQL escrito de forma
//      independiente, `sqlResumenEquivalente`) — sobre el MISMO dataset
//      sintético de `viaje` (tres flotas) y `gasto` (con el caso que motivó
//      el día LOCAL de México: un comprobante de las 19:00 de CDMX cae al día
//      siguiente en UTC), en ventanas de 7 y 30 días y con `hoy` inyectado.
//   2. Que el reductor SQL de aquí NO es el de negocio.test.ts copiado: se
//      escribe con otra estrategia (ordena y reduce, no Map) para que un bug
//      compartido no se valide a sí mismo.
// ═══════════════════════════════════════════════════════════════════════════

type Viaje = { id: string; tenant_id: string };
type Gasto = { created_at: string };
type Tenant = { id: string; nombre: string; plan: string; config?: unknown };

const TZ_MX = 'America/Mexico_City';
const diaMx = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ_MX });

/** LA REDUCCIÓN JS VIEJA — copia congelada de `getResumenNegocio` tal como
 *  contaba viaje/gasto ANTES de la 0153. Es el oráculo. */
function legacyResumenJs(tenants: Tenant[], viajes: Viaje[], gastos: Gasto[], hoy: string, ventanaDias: number) {
  const cortes = (diasAtras: number) => {
    const d = new Date(`${hoy}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - diasAtras);
    return d.toISOString().slice(0, 10);
  };
  const viajesPorTenant = new Map<string, number>();
  for (const v of viajes) viajesPorTenant.set(v.tenant_id, (viajesPorTenant.get(v.tenant_id) ?? 0) + 1);
  const facturasPorDiaMap = new Map<string, number>();
  for (const g of gastos) {
    const dia = diaMx(g.created_at);
    facturasPorDiaMap.set(dia, (facturasPorDiaMap.get(dia) ?? 0) + 1);
  }
  const facturasPorDia = Array.from({ length: ventanaDias }, (_, i) => {
    const dia = cortes(ventanaDias - 1 - i);
    return { dia, n: facturasPorDiaMap.get(dia) ?? 0 };
  });
  return {
    flotas: tenants.map((t) => ({ id: t.id, viajes: viajesPorTenant.get(t.id) ?? 0 })),
    viajesProcesados: viajes.length,
    facturasPorDia,
    facturasTotal: gastos.length,
  };
}

/** LA RPC, escrita de forma independiente: lo que `resumen_negocio(p_desde)`
 *  devuelve — por flota; por día local MX de `created_at >= p_desde`; totales
 *  sin fecha; series ORDENADAS como el `order by` de la función. */
function sqlResumenEquivalente(viajes: Viaje[], gastos: Gasto[], pDesde: string | null) {
  const ordenados = [...viajes].sort((a, b) => a.tenant_id.localeCompare(b.tenant_id));
  const viajesPorTenant: Array<{ tenantId: string; n: number }> = [];
  for (const v of ordenados) {
    const ultimo = viajesPorTenant.at(-1);
    if (ultimo && ultimo.tenantId === v.tenant_id) ultimo.n += 1;
    else viajesPorTenant.push({ tenantId: v.tenant_id, n: 1 });
  }
  const dias = gastos
    .filter((g) => pDesde === null || new Date(g.created_at).getTime() >= new Date(pDesde).getTime())
    .map((g) => diaMx(g.created_at))
    .sort();
  const facturasPorDia: Array<{ dia: string; n: number }> = [];
  for (const dia of dias) {
    const ultimo = facturasPorDia.at(-1);
    if (ultimo && ultimo.dia === dia) ultimo.n += 1;
    else facturasPorDia.push({ dia, n: 1 });
  }
  return { viajesTotal: viajes.length, viajesPorTenant, facturasTotal: gastos.length, facturasPorDia };
}

// ── El dataset sintético ───────────────────────────────────────────────────
const TENANTS: Tenant[] = [
  { id: 't-a', nombre: 'A', plan: 'pro' },
  { id: 't-b', nombre: 'B', plan: 'demo' },
  { id: 't-c', nombre: 'C (sin viajes)', plan: 'demo' },
];
const VIAJES: Viaje[] = [
  ...Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, tenant_id: 't-a' })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, tenant_id: 't-b' })),
  // Una flota que NO está en `tenant` (borrada, o sembrada fuera): cuenta en
  // el total histórico y no aparece en `flotas` — igual que antes.
  { id: 'z0', tenant_id: 't-zombie' },
];
const GASTOS: Gasto[] = [
  { created_at: '2026-08-03T01:00:00Z' }, // 2-ago 19:00 CDMX → barra del 2, no del 3
  { created_at: '2026-08-02T12:00:00Z' }, // 2-ago en las dos zonas
  { created_at: '2026-08-02T05:59:59Z' }, // 1-ago 23:59:59 CDMX → barra del 1
  { created_at: '2026-08-02T06:00:00Z' }, // 2-ago 00:00:00 CDMX → barra del 2 (el borde exacto)
  { created_at: '2026-07-30T15:00:00Z' },
  { created_at: '2026-07-27T06:00:00Z' }, // primer día de la ventana de 7 (hoy=2-ago), medianoche MX exacta
  { created_at: '2026-07-27T05:59:59Z' }, // un segundo antes: fuera de la ventana de 7, dentro de la de 30
  { created_at: '2026-07-10T12:00:00Z' }, // dentro de la ventana de 30
  { created_at: '2026-06-01T12:00:00Z' }, // fuera de las dos: solo cuenta en el histórico
];

// ── El lado de la función real ─────────────────────────────────────────────
const llamadas: Array<{ fn: string; args: { p_desde: string | null } }> = [];
let tablaTenant: Tenant[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      if (t !== 'tenant') throw new Error(`la función nueva no debe leer ${t}: la 0153 lo cuenta en SQL`);
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      // ADM-3 (auditoría 24): getResumenNegocio ahora excluye tenants
      // 'ZZZ %' con `.not('nombre', 'ilike', 'ZZZ %')`. El fixture de esta
      // prueba no siembra ninguno, así que basta con no tronar la cadena.
      b.not = () => b;
      b.range = (d: number, h: number) => Promise.resolve({ data: tablaTenant.slice(d, h + 1), error: null, count: tablaTenant.length });
      return b;
    },
    rpc: (fn: string, args: { p_desde: string | null }) => {
      llamadas.push({ fn, args });
      if (fn === 'resumen_negocio') return Promise.resolve({ data: sqlResumenEquivalente(VIAJES, GASTOS, args.p_desde), error: null });
      return Promise.resolve({
        data: { totales: { n: 0, costoUsd: 0, tokensIn: 0, tokensOut: 0 }, porFase: [], porModelo: [], porFaseModelo: [], porDia: [], porTenant: [] },
        error: null,
      });
    },
  }),
}));

const { getResumenNegocio } = await import('./negocio');

describe('getResumenNegocio: la RPC de la 0153 cuenta igual que el JS viejo', () => {
  beforeEach(() => { llamadas.length = 0; tablaTenant = TENANTS; });

  it.each([[7], [30]])('ventana de %i días, hoy = 2-ago-2026', async (ventana) => {
    const viejo = legacyResumenJs(TENANTS, VIAJES, GASTOS, '2026-08-02', ventana);
    const nuevo = await getResumenNegocio('2026-08-02', ventana);
    expect(nuevo.viajesProcesados).toBe(viejo.viajesProcesados);
    expect(nuevo.facturasTotal).toBe(viejo.facturasTotal);
    expect(nuevo.facturasPorDia).toEqual(viejo.facturasPorDia);
    expect(nuevo.flotas.map((f) => ({ id: f.id, viajes: f.viajes }))).toEqual(viejo.flotas);
    // Y con las cifras a mano, para que la equivalencia no sea "los dos dan
    // lo mismo" sobre un dataset que nadie leyó:
    expect(nuevo.viajesProcesados).toBe(11);
    expect(nuevo.facturasTotal).toBe(9);
    expect(nuevo.flotas.map((f) => f.viajes)).toEqual([7, 3, 0]);
    expect(nuevo.facturasPorDia.at(-1)).toEqual({ dia: '2026-08-02', n: 3 });
    expect(nuevo.facturasPorDia.at(-2)).toEqual({ dia: '2026-08-01', n: 1 });
    expect(nuevo.facturasPorDia[0]).toEqual(ventana === 7
      ? { dia: '2026-07-27', n: 1 }   // la de la medianoche exacta entra; la de un segundo antes, no
      : { dia: '2026-07-04', n: 0 });
    expect(nuevo.facturasPorDia.reduce((s, d) => s + d.n, 0)).toBe(ventana === 7 ? 6 : 8);
  });

  it('la ventana NO recorta los históricos: totales iguales con 7 y con 30 días', async () => {
    const [r7, r30] = await Promise.all([getResumenNegocio('2026-08-02', 7), getResumenNegocio('2026-08-02', 30)]);
    expect(r7.viajesProcesados).toBe(r30.viajesProcesados);
    expect(r7.facturasTotal).toBe(r30.facturasTotal);
    expect(r7.flotas).toEqual(r30.flotas);
  });

  it('el corte `p_desde` que se manda es la medianoche de México del primer día', async () => {
    await getResumenNegocio('2026-08-02', 7);
    expect(llamadas.find((l) => l.fn === 'resumen_negocio')?.args.p_desde).toBe('2026-07-27T06:00:00.000Z');
  });

  it('el oráculo JS y el reductor SQL coinciden también SIN corte (p_desde null = la forma vieja)', () => {
    const sql = sqlResumenEquivalente(VIAJES, GASTOS, null);
    const viejo = legacyResumenJs(TENANTS, VIAJES, GASTOS, '2026-08-02', 70);
    const diasViejo = viejo.facturasPorDia.filter((d) => d.n > 0);
    expect(sql.facturasPorDia).toEqual(diasViejo);
    expect(sql.viajesPorTenant.reduce((s, t) => s + t.n, 0)).toBe(sql.viajesTotal);
  });
});
