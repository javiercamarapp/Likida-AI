import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S29-06: confirmar un lote exige la huella de lo que la persona vio; sin ella no se llama a la base.

const llamadas: Array<{ nombre: string; args: Record<string, unknown> }> = [];
let respuesta: { data: unknown; error: { message: string } | null } = { data: { ok: true }, error: null };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc: (nombre: string, args: Record<string, unknown>) => { llamadas.push({ nombre, args }); return Promise.resolve(respuesta); } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => undefined) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (p: Promise<unknown>) => p }));

const { decidirLote } = await import('./control_emision_repo');

describe('decidirLote — la confirmación va ligada a lo que la persona vio', () => {
  beforeEach(() => { llamadas.length = 0; respuesta = { data: { ok: true }, error: null }; });

  it('confirmar SIN huella no llega a la base (fail-closed)', async () => {
    const r = await decidirLote('t1', 'u1', 'l1', true, undefined, null);
    expect(r.ok).toBe(false);
    expect(llamadas).toHaveLength(0);
    expect((await decidirLote('t1', 'u1', 'l1', true, undefined, { tickets: 0, monto: 10 })).ok).toBe(false);
    expect((await decidirLote('t1', 'u1', 'l1', true, undefined, { tickets: 3, monto: Number.NaN })).ok).toBe(false);
    expect(llamadas).toHaveLength(0);
  });

  it('confirmar CON huella la manda a la RPC', async () => {
    const r = await decidirLote('t1', 'u1', 'l1', true, undefined, { tickets: 3, monto: 900 });
    expect(r.ok).toBe(true);
    expect(llamadas[0].args).toMatchObject({ p_confirmar: true, p_vistos_n: 3, p_vistos_monto: 900 });
  });

  it('si el lote cambió, la base lo rechaza y el motivo llega a la persona', async () => {
    respuesta = { data: { ok: false, motivo: 'el lote cambió desde que lo revisaste' }, error: null };
    const r = await decidirLote('t1', 'u1', 'l1', true, undefined, { tickets: 3, monto: 900 });
    expect(r).toEqual({ ok: false, motivo: 'el lote cambió desde que lo revisaste' });
  });

  it('rechazar no necesita huella', async () => {
    const r = await decidirLote('t1', 'u1', 'l1', false, 'no va');
    expect(r.ok).toBe(true);
    expect(llamadas[0].args).not.toHaveProperty('p_vistos_n');
  });
});
