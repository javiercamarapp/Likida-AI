import { describe, it, expect, vi, beforeEach } from 'vitest';

// `candidatasHuerfanaCorreo` (hallazgo MEDIO, oct-2026): la mitad de la red que detecta liquidaciones `pendiente`,
// viejas, que entraron por el endpoint GENERAL (sin fila de desglose) y por lo tanto nadie va a entregar si la flota
// resuelve a canal `correo` (esa decisión la toma `servicio.ts`, que sabe leer el perfil; aquí solo se prueba la
// consulta que cruza tenants).

const ops: Array<[string, ...unknown[]]> = [];
const colas: Record<string, Array<{ data: unknown; error: { message: string; code?: string } | null }>> = {};
let respuestas: Record<string, { data: unknown; error: { message: string; code?: string } | null }> = {};
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'lte', 'in', 'order', 'limit', 'or']) {
        b[m] = (...a: unknown[]) => { ops.push([`${t}.${m}`, ...a]); return b; };
      }
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve((colas[t]?.length ? colas[t].shift() : respuestas[t]) ?? { data: [], error: null }).then(res, rej);
      return b;
    },
  }),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));

const { candidatasHuerfanaCorreo } = await import('./trabajo');

beforeEach(() => { ops.length = 0; respuestas = {}; for (const k of Object.keys(colas)) delete colas[k]; });

describe('candidatasHuerfanaCorreo', () => {
  it('descarta las que SÍ tienen fila en liquidacion_desglose (vinieron por /desgloses: retenidas o legítimas)', async () => {
    respuestas.liquidacion_externa = {
      data: [
        { id: 'l-1', tenant_id: 't-1', clave_externa: 'GEN-1', created_at: '2026-10-01T00:00:00.000Z' },
        { id: 'l-2', tenant_id: 't-1', clave_externa: 'DESG-1', created_at: '2026-10-01T00:00:00.000Z' },
      ],
      error: null,
    };
    respuestas.liquidacion_desglose = { data: [{ liquidacion_externa_id: 'l-2' }], error: null };
    const r = await candidatasHuerfanaCorreo(50, '2026-10-01T00:30:00.000Z');
    expect(r).toEqual([{ id: 'l-1', tenantId: 't-1', claveExterna: 'GEN-1', creadaEn: '2026-10-01T00:00:00.000Z' }]);
    expect(ops).toContainEqual(['liquidacion_externa.eq', 'estado', 'pendiente']);
    expect(ops).toContainEqual(['liquidacion_externa.lte', 'created_at', '2026-10-01T00:30:00.000Z']);
  });

  it('sin candidatas no hace la segunda consulta (nada que cruzar)', async () => {
    respuestas.liquidacion_externa = { data: [], error: null };
    const r = await candidatasHuerfanaCorreo(50, 'x');
    expect(r).toEqual([]);
    expect(ops.some((o) => o[0].startsWith('liquidacion_desglose'))).toBe(false);
  });

  it('sin la migración 0786 (liquidacion_desglose ausente) ⇒ todas las `pendiente` viejas cuentan como candidatas', async () => {
    respuestas.liquidacion_externa = { data: [{ id: 'l-1', tenant_id: 't-1', clave_externa: 'GEN-1', created_at: 'c' }], error: null };
    respuestas.liquidacion_desglose = { data: null, error: { message: 'relation "liquidacion_desglose" does not exist', code: '42P01' } };
    const r = await candidatasHuerfanaCorreo(50, 'x');
    expect(r).toHaveLength(1);
  });

  it('un error real de la consulta principal LANZA: «no pude leer» no es «no hay candidatas»', async () => {
    respuestas.liquidacion_externa = { data: null, error: { message: 'conexión rota' } };
    await expect(candidatasHuerfanaCorreo(50, 'x')).rejects.toThrow(/conexión rota/);
  });

  it('un error real (no «tabla ausente») de la consulta de desgloses también LANZA', async () => {
    respuestas.liquidacion_externa = { data: [{ id: 'l-1', tenant_id: 't-1', clave_externa: 'GEN-1', created_at: 'c' }], error: null };
    respuestas.liquidacion_desglose = { data: null, error: { message: 'conexión rota' } };
    await expect(candidatasHuerfanaCorreo(50, 'x')).rejects.toThrow(/conexión rota/);
  });

  it('A37-S49-04: 50 desgloses retenidos más viejos NO tapan a la huérfana real (se pagina)', async () => {
    const retenidas = Array.from({ length: 50 }, (_, i) => ({ id: `r-${String(i).padStart(2, '0')}`, tenant_id: 't-1', clave_externa: `R-${i}`, created_at: '2026-10-01T00:00:00.000Z' }));
    colas.liquidacion_externa = [
      { data: retenidas, error: null },
      { data: [{ id: 'z-huerfana', tenant_id: 't-1', clave_externa: 'GEN-9', created_at: '2026-10-02T00:00:00.000Z' }], error: null },
    ];
    colas.liquidacion_desglose = [
      { data: retenidas.map((r) => ({ liquidacion_externa_id: r.id })), error: null },
      { data: [], error: null },
    ];
    const r = await candidatasHuerfanaCorreo(50, '2026-10-05T00:00:00.000Z');
    expect(r.map((c) => c.id)).toEqual(['z-huerfana']);
    // La segunda página arranca después de la última fila de la primera.
    expect(ops.some((o) => o[0] === 'liquidacion_externa.or' && String(o[1]).includes('id.gt.r-49'))).toBe(true);
  });
});
