import { describe, expect, it, vi, beforeEach } from 'vitest';

// `getUnidadesMedidas` (22-ago-2026): filtraba columnas que NO existen
// (`creado_en`/`creada_en`; las dos tablas tienen `created_at`) — PostgREST
// respondía 400 y /admin/capacidad-forecast decía "sin muestra" con muestra
// real — y sumaba `llm_costo` en JS con `.limit(10000)`. Ahora: la agregación
// de la 0062 con `p_desde`, y el conteo de liquidaciones por `head`.
const consultas: Array<{ tabla: string; col: string; head: boolean }> = [];
const rpcs: Array<{ fn: string; args: unknown }> = [];
let conteoLiq: number | null = 0;
let costoRpc: { data: unknown; error: { message: string } | null } = { data: null, error: null };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const q = { tabla, col: '', head: false };
      const b: Record<string, unknown> = {};
      b.select = (_c: string, o?: { head?: boolean }) => { q.head = !!o?.head; return b; };
      b.gte = (col: string) => { q.col = col; return b; };
      b.then = (ok: (v: unknown) => unknown) => { consultas.push(q); return Promise.resolve({ data: null, error: null, count: conteoLiq }).then(ok); };
      return b;
    },
    rpc: (fn: string, args: unknown) => { rpcs.push({ fn, args }); return Promise.resolve(costoRpc); },
  }),
}));

const { escenarioDe, SUPUESTOS_CAPACIDAD, getUnidadesMedidas } = await import('./capacidad');

describe('escenarioDe — escala con supuestos declarados', () => {
  it('1,000 viajes/día: aritmética exacta de los supuestos', () => {
    const e = escenarioDe(1000, 0.05);
    expect(e.mensajesDia).toBe(1000 * SUPUESTOS_CAPACIDAD.mensajesPorViaje);
    expect(e.mensajesMinPico).toBe(Math.ceil(e.mensajesDia / (8 * 60)));
    expect(e.costoIaDiaUsd).toBeCloseTo(50);
    expect(e.storageDiaMb).toBe(Math.round((1000 * 10 * 350_000) / 1_048_576));
  });
  it('sin costo medido: el costo del escenario es null, jamás un cero', () => {
    expect(escenarioDe(10_000, null).costoIaDiaUsd).toBeNull();
  });
});

describe('getUnidadesMedidas — lo medido, sin leer llm_costo por filas', () => {
  const AHORA = Date.parse('2026-08-22T12:00:00Z');
  const RESUMEN = { totales: { n: 4_000, costoUsd: 123.456, tokensIn: 1, tokensOut: 1 }, porFase: [], porModelo: [], porFaseModelo: [], porDia: [], porTenant: [] };
  beforeEach(() => { consultas.length = 0; rpcs.length = 0; conteoLiq = 0; costoRpc = { data: RESUMEN, error: null }; });

  it('filtra por `created_at` (la columna que existe), cuenta por head y suma por RPC con p_desde = 30 días', async () => {
    conteoLiq = 250;
    const u = await getUnidadesMedidas(AHORA);
    expect(u).toEqual({ costoIa30d: 123.456, muestraViajes: 250, costoIaPorViaje: 123.456 / 250 });
    expect(consultas).toEqual([{ tabla: 'liquidacion', col: 'created_at', head: true }]);
    expect(rpcs).toEqual([{ fn: 'resumen_costo_ia', args: { p_desde: '2026-07-23T12:00:00.000Z', p_hasta: null } }]);
  });

  it('sin liquidaciones en 30 días: costo por viaje null (no se divide entre cero)', async () => {
    expect((await getUnidadesMedidas(AHORA)).costoIaPorViaje).toBeNull();
  });

  it('un conteo que no llega como número LANZA — no es una muestra de 0', async () => {
    conteoLiq = null;
    await expect(getUnidadesMedidas(AHORA)).rejects.toThrow(/no devolvió el conteo/);
  });

  it('la RPC caída LANZA (la página lo atrapa y dice "sin muestra", no pinta $0)', async () => {
    costoRpc = { data: null, error: { message: 'db down' } };
    await expect(getUnidadesMedidas(AHORA)).rejects.toThrow('db down');
  });
});
