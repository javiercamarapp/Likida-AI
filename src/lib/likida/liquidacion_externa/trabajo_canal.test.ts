import { describe, it, expect, vi, beforeEach } from 'vitest';

// Gate por canal en la lista de trabajo del cron (T-A1-17): las flotas con canal `correo` no entran al lote de WhatsApp;
// `ambos` y las que no tienen config, sí (comportamiento idéntico al de siempre).

const T_CORREO = '11111111-1111-4111-8111-111111111111';
const T_CORREO_2 = '22222222-2222-4222-8222-222222222222';

let ops: Array<[string, ...unknown[]]> = [];
let config: { data: unknown; error: { message: string; code?: string } | null } = { data: [], error: null };
let trabajo: { data: unknown; error: { message: string } | null } = { data: [], error: null };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      const mia: Array<[string, ...unknown[]]> = [['from', t]];
      ops.push(...mia);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'or', 'not', 'order', 'limit']) b[m] = (...a: unknown[]) => { ops.push([`${t}.${m}`, ...a]); return b; };
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(t === 'liquidacion_correo_config' ? config : trabajo).then(res, rej);
      return b;
    },
  }),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));

const { trabajoPendiente } = await import('./trabajo');

beforeEach(() => { ops = []; config = { data: [], error: null }; trabajo = { data: [], error: null }; });

describe('trabajoPendiente: gate por canal', () => {
  it('sin ninguna flota en canal correo, la consulta no excluye a nadie (otras flotas: cero cambio)', async () => {
    await trabajoPendiente(50, '2026-09-08T12:00:00.000Z');
    expect(ops.some((o) => o[0] === 'liquidacion_externa.not')).toBe(false);
  });

  it('flotas con canal correo se excluyen del lote de WhatsApp', async () => {
    config = { data: [{ tenant_id: T_CORREO, canal: 'correo' }, { tenant_id: T_CORREO_2, canal: 'correo' }], error: null };
    await trabajoPendiente(50, '2026-09-08T12:00:00.000Z');
    expect(ops).toContainEqual(['liquidacion_externa.not', 'tenant_id', 'in', `(${T_CORREO},${T_CORREO_2})`]);
  });

  it('`ambos` y `whatsapp` NO se excluyen (aunque el filtro de base trajera la fila)', async () => {
    config = { data: [{ tenant_id: T_CORREO, canal: 'ambos' }, { tenant_id: T_CORREO_2, canal: 'whatsapp' }], error: null };
    await trabajoPendiente(50, '2026-09-08T12:00:00.000Z');
    expect(ops.some((o) => o[0] === 'liquidacion_externa.not')).toBe(false);
  });

  it('un tenant_id con forma rara no llega al filtro (no se arma un `in` con texto libre)', async () => {
    config = { data: [{ tenant_id: 'x),tenant_id.neq.(y', canal: 'correo' }], error: null };
    await trabajoPendiente(50, '2026-09-08T12:00:00.000Z');
    expect(ops.some((o) => o[0] === 'liquidacion_externa.not')).toBe(false);
  });

  it('base sin la tabla de config (sin migración 0785): todo sigue por WhatsApp', async () => {
    config = { data: null, error: { message: 'relation "liquidacion_correo_config" does not exist', code: '42P01' } };
    await expect(trabajoPendiente(50, 'ahora')).resolves.toEqual([]);
    expect(ops.some((o) => o[0] === 'liquidacion_externa.not')).toBe(false);
  });

  it('un error de base al leer la config LANZA: no se manda por WhatsApp lo que la flota pidió por correo', async () => {
    config = { data: null, error: { message: 'conexión rota' } };
    await expect(trabajoPendiente(50, 'ahora')).rejects.toThrow(/conexión rota/);
    expect(ops.some((o) => o[0] === 'from' && o[1] === 'liquidacion_externa')).toBe(false);
  });
});
