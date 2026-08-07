import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// B22 — El mutex se abría ante CUALQUIER error de la RPC.
//
// El fail-open estaba razonado para un caso: la migración 0005 no aplicada. Ahí
// es correcto —reintentar no va a hacer aparecer la función, y bloquear dejaría
// al operador sin respuesta— y además el arranque ya falla ruidoso.
//
// Pero la misma rama se comía los errores TRANSITORIOS: un timeout, el pool
// agotado, un 503 de Supabase. Ahí el lock sí se puede conseguir en 150 ms, y
// abrir de inmediato deja correr dos "listo" completos sobre el mismo viaje:
// dos ciclos de agente, dos cierres, el doble de costo.
// ═══════════════════════════════════════════════════════════════════════════
const rpc = vi.fn();
const errorLog = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: (...a: unknown[]) => errorLog(...a) } }));

const { acquireViajeLock } = await import('./conv');

const ok = { data: true, error: null };
const ocupado = { data: false, error: null };
const ausente = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.try_lock_viaje' } };
const transitorio = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };

describe('acquireViajeLock', () => {
  beforeEach(() => { rpc.mockReset(); errorLog.mockReset(); });

  it('lo consigue a la primera', async () => {
    rpc.mockResolvedValue(ok);
    expect(await acquireViajeLock('v1')).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('ocupado: reintenta y lo consigue cuando se libera', async () => {
    rpc.mockResolvedValueOnce(ocupado).mockResolvedValue(ok);
    expect(await acquireViajeLock('v1', { maxWaitMs: 2000 })).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('ocupado todo el tiempo: devuelve false, NO se cuela', async () => {
    rpc.mockResolvedValue(ocupado);
    expect(await acquireViajeLock('v1', { maxWaitMs: 300 })).toBe(false);
  });

  it('RPC AUSENTE: abre de inmediato — reintentar no la hace aparecer', async () => {
    // La 0005 no está aplicada. Bloquear aquí dejaría al operador sin respuesta
    // por un problema de despliegue, y el arranque ya falla ruidoso por esto.
    rpc.mockResolvedValue(ausente);
    expect(await acquireViajeLock('v1', { maxWaitMs: 5000 })).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalled();
  });

  it('error TRANSITORIO: reintenta en vez de abrir de golpe', async () => {
    // Un timeout no significa que el lock esté libre. Significa que no se supo.
    rpc.mockResolvedValueOnce(transitorio).mockResolvedValue(ok);
    expect(await acquireViajeLock('v1', { maxWaitMs: 2000 })).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('transitorio que no cede: acaba abriendo, pero después de intentarlo', async () => {
    // Se abre para no dejar al operador colgado, pero solo tras agotar la
    // ventana — no en el primer tropiezo — y queda registrado como ERROR.
    rpc.mockResolvedValue(transitorio);
    expect(await acquireViajeLock('v1', { maxWaitMs: 400 })).toBe(true);
    expect(rpc.mock.calls.length).toBeGreaterThan(1);
    expect(errorLog).toHaveBeenCalled();
  });
});
