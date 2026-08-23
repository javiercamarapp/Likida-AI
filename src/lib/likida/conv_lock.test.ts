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

const { acquireViajeLock, intentarLockViaje } = await import('./conv');

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

  // ── DAT-21 · EL SEGUNDO FAIL-OPEN NO ESTABA JUSTIFICADO ──────────────────
  //
  // Aquí se abría el mutex tras agotar la ventana, con el argumento de "no
  // dejar al operador colgado". Pero quien recibe ese `true` en el camino del
  // cierre se pone a cuadrar, imprimir los dos PDFs y CERRAR — irreversible por
  // los triggers 0036/0037— sin exclusividad ninguna. Con Supabase degradado,
  // los dos "listo" del operador impaciente cierran los dos: dos ciclos de
  // agente, dos PDFs, y la carrera que la 0158 tuvo que atrapar en la base.
  //
  // Un mutex que se abre JUSTO cuando la infraestructura está mal es un mutex
  // que no protege el caso para el que existe. Hoy es 'indeterminado' y lo
  // decide el llamador: el cierre falla cerrado y avisa.
  it('transitorio que no cede: es INDETERMINADO, no "es tuyo"', async () => {
    rpc.mockResolvedValue(transitorio);
    expect(await intentarLockViaje('v1', { maxWaitMs: 400 })).toBe('indeterminado');
    expect(await acquireViajeLock('v1', { maxWaitMs: 400 }), 'el booleano no se cuela')
      .toBe(false);
    expect(rpc.mock.calls.length).toBeGreaterThan(1);
    expect(errorLog).toHaveBeenCalled();
  });

  it('y OCUPADO se sigue distinguiendo de INDETERMINADO', async () => {
    // No son lo mismo y la respuesta al operador tampoco: ocupado significa
    // "otro turno va a contestar"; indeterminado, "no se supo".
    rpc.mockResolvedValue(ocupado);
    expect(await intentarLockViaje('v1', { maxWaitMs: 300 })).toBe('ocupado');
  });

  it('la RPC AUSENTE sigue abriendo: ése sí estaba justificado', () => {
    // Reintentar no hace aparecer la 0005, y el arranque ya falla ruidoso.
    rpc.mockResolvedValue(ausente);
    return expect(intentarLockViaje('v1', { maxWaitMs: 5000 })).resolves.toBe('obtenido');
  });
});
