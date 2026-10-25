import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S13-10: «Devolver a supervisada» decía «Portal devuelto…» aunque la fila no cambió (doble clic, dos pestañas, portal
// sin fase). La RPC (0542) ya devuelve `cambiados`: el panel tiene que decirlo.

let respuestaRpc: { data: unknown; error: { message: string } | null } = { data: { ok: true, cambiados: 1 }, error: null };
const rpc = vi.fn(async (..._a: unknown[]) => respuestaRpc);
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
const bitacora = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => bitacora(...a) }));

const { devolverASupervisada } = await import('./control_emision_repo');

beforeEach(() => { vi.clearAllMocks(); respuestaRpc = { data: { ok: true, cambiados: 1 }, error: null }; });

describe('devolverASupervisada', () => {
  it('si la fila cambió, dice que se devolvió', async () => {
    expect(await devolverASupervisada('t-1', 'u-1', 'enerser')).toEqual({ ok: true, mensaje: 'Portal devuelto a fase supervisada.' });
  });
  it('A37-S13-10: si no cambió ninguna fila NO dice que se devolvió', async () => {
    respuestaRpc = { data: { ok: true, cambiados: 0 }, error: null };
    const r = await devolverASupervisada('t-1', 'u-1', 'enerser');
    expect(r).toMatchObject({ ok: false, motivo: expect.stringMatching(/ya estaba|no cambi/i) });
    expect(bitacora).toHaveBeenCalledWith(expect.objectContaining({ detalle: expect.objectContaining({ ok: true, cambiados: 0 }) }), expect.anything());
  });
  it('una RPC anterior que no informa `cambiados` sigue contando como éxito (compatible hacia atrás)', async () => {
    respuestaRpc = { data: { ok: true }, error: null };
    expect(await devolverASupervisada('t-1', 'u-1', 'enerser')).toMatchObject({ ok: true });
  });
  it('un rechazo de la base se traduce tal cual', async () => {
    respuestaRpc = { data: { ok: false, motivo: 'solo el dueño o el contador devuelven un portal a fase supervisada' }, error: null };
    expect(await devolverASupervisada('t-1', 'u-1', 'enerser')).toMatchObject({ ok: false, motivo: expect.stringMatching(/dueño o el contador/) });
  });
});
