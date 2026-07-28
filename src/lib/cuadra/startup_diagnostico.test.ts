import { describe, it, expect, vi, beforeEach } from 'vitest';

// EL FALLO QUE ESTO FIJA — leído en los logs de producción del 28-jul-2026.
//
//   [error] startup.migraciones
//   "FALTA la migración 0005 (try_lock_viaje / unique(viaje_id)):
//    la protección de doble liquidación NO está activa."
//   err: "TypeError: fetch failed"
//
// Las cuatro migraciones estaban aplicadas. Se comprobó llamando a los RPC
// directamente contra Supabase: `try_lock_viaje` → true, `intake_delta` → 0,
// `enriquecer_gasto_codigo` → false, `codigo_pendiente` → 200.
//
// El chequeo trataba CUALQUIER error como "falta la migración", incluido un
// fallo de red. Eso convierte el aviso que protege el dinero —doble
// liquidación— en uno que se aprende a ignorar.

const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from }) }));

const error = vi.fn();
const warn = vi.fn();
const info = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { error: (...a: unknown[]) => error(...a), warn: (...a: unknown[]) => warn(...a), info: (...a: unknown[]) => info(...a) } }));

const { verificarMigracionesCriticas } = await import('./startup');

const okTabla = { select: () => ({ limit: () => Promise.resolve({ error: null }) }) };

beforeEach(() => {
  rpc.mockReset(); from.mockReset(); error.mockReset(); warn.mockReset(); info.mockReset();
  from.mockReturnValue(okTabla);
});

describe('diagnóstico de migraciones', () => {
  it('un fallo de RED no se reporta como migración faltante', async () => {
    // Así lo entrega supabase-js: sin código, con el TypeError envuelto.
    rpc.mockResolvedValue({ error: { code: '', message: 'TypeError: fetch failed' } });
    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('startup.migraciones_sin_verificar', expect.anything());
    const [, meta] = warn.mock.calls[0] as [string, { msg: string }];
    expect(meta.msg).toContain('NO se pudo verificar');
    expect(meta.msg).not.toContain('FALTA');
  });

  it('una migración que de verdad falta SÍ se reporta como error', async () => {
    // PostgREST contesta con código cuando la función no existe: hubo respuesta.
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function public.try_lock_viaje' } });
    await verificarMigracionesCriticas();

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('startup.migraciones', expect.objectContaining({ code: 'PGRST202' }));
    const [, meta] = error.mock.calls[0] as [string, { msg: string }];
    expect(meta.msg).toContain('FALTA la migración 0005');
  });

  it('con todo aplicado, dice que está bien y no grita', async () => {
    rpc.mockResolvedValue({ error: null });
    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });

  // La red se puede caer en cualquiera de los cuatro probes, no solo en el primero.
  it('el mismo criterio aplica al probe de la barrera de intake', async () => {
    rpc.mockResolvedValueOnce({ error: null })                                        // 0005 ok
       .mockResolvedValueOnce({ error: null })                                        // unlock
       .mockResolvedValueOnce({ error: { code: '', message: 'fetch failed' } });      // 0011 sin red
    await verificarMigracionesCriticas();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('startup.migraciones_sin_verificar', expect.anything());
  });

  // El límite: un error CON código, aunque el mensaje suene a red, es una
  // respuesta de la base. No se puede perder por parecerse a un fallo de red.
  it('un error con código nunca se degrada a "no se pudo verificar"', async () => {
    rpc.mockResolvedValue({ error: { code: '42883', message: 'function does not exist (socket)' } });
    await verificarMigracionesCriticas();

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});
