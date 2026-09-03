import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · BE-11 (MEDIO) — el mutex del viaje no tenía dueño.
//
// `unlock_viaje(p_viaje)` hacía `delete where viaje_id = p_viaje`, sin mirar
// QUIÉN lo tenía. Escenario medido: el XML toma el lock con TTL 60 s, tarda
// más bajo carga, a t0+61 el «listo» toma el lease vencido y empieza a
// cuadrar, y a t0+70 el `finally` del XML BORRA EL LOCK DEL CIERRE. Un
// segundo «listo» entra, `getOpenViaje` todavía devuelve el viaje, y corre el
// agente completo otra vez: dos cuadres, dos PDFs, dos cobros de LLM.
//
// Lo que la base impone lo prueba el bloque 227 de `verificaciones.sql`
// (`unlock_viaje` con token, verificado contra Postgres real); esto prueba el
// cable: que el token viaje en las dos llamadas y que la ventana de
// despliegue —código nuevo, migración 0280 sin aplicar— no abra el mutex.
// ═══════════════════════════════════════════════════════════════════════════

const rpc = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock('@/lib/logger', () => ({ logger }));

const { acquireViajeLock, intentarLockViaje, releaseViajeLock, nuevoTokenDeLock, TTL_LOCK_CIERRE_MS } = await import('./conv');

const ok = { data: true, error: null };
const ocupado = { data: false, error: null };
const sinFirmaNueva = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.try_lock_viaje(p_ttl_ms, p_token, p_viaje)' } };

beforeEach(() => {
  rpc.mockReset();
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
});

describe('el lease se firma', () => {
  it('nuevoTokenDeLock da tokens distintos (si no, dos turnos se soltarían el lock entre sí)', () => {
    expect(nuevoTokenDeLock()).not.toBe(nuevoTokenDeLock());
  });

  it('el token viaja a try_lock_viaje', async () => {
    rpc.mockResolvedValue(ok);
    await acquireViajeLock('v1', { token: 'tok-1' });
    expect(rpc).toHaveBeenCalledWith('try_lock_viaje',
      expect.objectContaining({ p_viaje: 'v1', p_token: 'tok-1' }));
  });

  it('y a unlock_viaje — solo con él la base borra el lease', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await releaseViajeLock('v1', 'tok-1');
    expect(rpc).toHaveBeenCalledWith('unlock_viaje', { p_viaje: 'v1', p_token: 'tok-1' });
  });

  it('sin token, el contrato viejo intacto: es lo único que suelta los leases sin firma', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await releaseViajeLock('v1');
    expect(rpc).toHaveBeenCalledWith('unlock_viaje', { p_viaje: 'v1' });
  });
});

describe('los dos usuarios del mutex comparten TTL', () => {
  it('el TTL por omisión es el del cierre: 60 s contra 120 s ERA la mitad del hallazgo', async () => {
    rpc.mockResolvedValue(ok);
    await acquireViajeLock('v1');
    expect(rpc).toHaveBeenCalledWith('try_lock_viaje',
      expect.objectContaining({ p_ttl_ms: TTL_LOCK_CIERRE_MS }));
  });
});

describe('la ventana de despliegue (0280 sin aplicar) NO abre el mutex', () => {
  it('si falta la firma de tres argumentos, se reintenta SIN token antes de concluir nada', async () => {
    rpc.mockResolvedValueOnce(sinFirmaNueva).mockResolvedValueOnce(ok);
    expect(await intentarLockViaje('v1', { token: 'tok-1', maxWaitMs: 2000 })).toBe('obtenido');
    expect(rpc).toHaveBeenNthCalledWith(2, 'try_lock_viaje',
      { p_viaje: 'v1', p_ttl_ms: TTL_LOCK_CIERRE_MS });
    expect(logger.warn).toHaveBeenCalledWith('viaje.lock_sin_token', expect.anything());
    expect(logger.error, 'esto NO es «no hay mutex»').not.toHaveBeenCalledWith('viaje.lock_rpc_ausente', expect.anything());
  });

  it('y si la de dos argumentos dice OCUPADO, se respeta — no se cuela', async () => {
    rpc.mockResolvedValueOnce(sinFirmaNueva).mockResolvedValue(ocupado);
    expect(await intentarLockViaje('v1', { token: 'tok-1', maxWaitMs: 300 })).toBe('ocupado');
  });

  it('sin token, la RPC ausente sigue abriendo como siempre (la 0005 no aplicada)', async () => {
    rpc.mockResolvedValue(sinFirmaNueva);
    expect(await intentarLockViaje('v1', { maxWaitMs: 2000 })).toBe('obtenido');
    expect(logger.error).toHaveBeenCalledWith('viaje.lock_rpc_ausente', expect.anything());
  });

  it('ALT-151 (auditoría 25, REINCIDENTE): si la SEGUNDA llamada (sin token) también falla, NO se abre el mutex', async () => {
    // Falta la firma de tres argumentos (ventana de despliegue) y el
    // reintento sin token se topa con un error TRANSITORIO (timeout, pool
    // agotado) — no con "función ausente". Antes esto caía por gravedad al
    // `return 'obtenido'`: el mutex se concedía sobre una base que no
    // contestó dos veces seguidas.
    const timeout = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    // Primera llamada: sinFirmaNueva. Todas las siguientes: timeout.
    rpc.mockResolvedValueOnce(sinFirmaNueva).mockResolvedValue(timeout);
    const r = await intentarLockViaje('v1', { token: 'tok-1', maxWaitMs: 300 });
    expect(r).toBe('indeterminado');
    expect(logger.error, 'no debe fallar abierto').not.toHaveBeenCalledWith('viaje.lock_rpc_ausente', expect.anything());
  });
});
