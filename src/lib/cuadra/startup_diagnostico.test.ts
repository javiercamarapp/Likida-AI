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

// Stub encadenable: el sondeo de la 0016 usa `.select().limit()` y el de la 0019
// `.select().not().limit()`. Un stub que solo soporta una de las dos cadenas hace
// que la otra lance, el `catch` general se lo trague como `migraciones_skip`, y
// las pruebas midan cualquier cosa menos lo que dicen medir.
const tabla = (resultado: { error: unknown } = { error: null }) => {
  const enlace: Record<string, unknown> = {};
  for (const m of ['select', 'not', 'eq', 'limit']) enlace[m] = () => enlace;
  // `await` sobre el enlace resuelve al resultado (igual que el query builder real).
  enlace.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r);
  return enlace;
};
const okTabla = tabla();

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
       .mockResolvedValueOnce({ error: { code: '', message: 'fetch failed' } })       // 0011 sin red
       .mockResolvedValue({ error: null });                                           // el resto ok
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

// CRÍTICO de la auditoría 5 (modelo de datos): la migración 0022 estaba aplicada
// en producción y NO existía en el repo — `git log --all --diff-filter=A` sobre
// `supabase/migrations/0022*` sale vacío. Cualquier `supabase db push` sobre un
// proyecto limpio nace con las dos firmas de `guardar_liquidacion_tx` y ninguna
// liquidación cierra. Y este chequeo no la sondeaba: decía `ok: true`.
describe('la sobrecarga ambigua de guardar_liquidacion_tx', () => {
  it('con DOS firmas vivas, el arranque lo grita en vez de decir ok', async () => {
    rpc.mockResolvedValueOnce({ error: null })   // 0005
       .mockResolvedValueOnce({ error: null })   // unlock
       .mockResolvedValueOnce({ error: null })   // 0011
       .mockResolvedValueOnce({ error: null })   // 0017
       .mockResolvedValueOnce({ error: { code: '42725', message: 'function guardar_liquidacion_tx(...) is not unique' } })
       .mockResolvedValue({ error: null });
    await verificarMigracionesCriticas();

    expect(info).not.toHaveBeenCalledWith('startup.migraciones', { ok: true });
    expect(error).toHaveBeenCalledWith('startup.migraciones', expect.objectContaining({ code: '42725' }));
    const [, meta] = error.mock.calls[0] as [string, { msg: string }];
    expect(meta.msg).toContain('0022');
    expect(meta.msg).toContain('NINGUNA liquidación puede cerrar');
  });

  it('un error NORMAL de esa sonda (tenant inexistente) no se confunde con la ambigüedad', async () => {
    rpc.mockResolvedValue({ error: null });
    await verificarMigracionesCriticas();
    expect(info).toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });
});

// ALTO de la auditoría 5 (operabilidad): el arranque salía al PRIMER fallo, así
// que con dos migraciones ausentes solo se veía UNA por ciclo de despliegue: se
// arreglaba, se volvía a desplegar, y aparecía la siguiente. Y la 0019 no se
// sondeaba: sin `uq_gasto_cfdi_uuid` el mismo CFDI de diésel entra dos veces, se
// cuenta doble en el comprobado y su IVA se acredita por duplicado.
describe('el arranque dice TODO lo que falta, no lo primero', () => {
  it('con dos migraciones ausentes, reporta las dos', async () => {
    rpc.mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'no try_lock_viaje' } })  // 0005
       .mockResolvedValueOnce({ error: null })                                                // unlock
       .mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'no intake_delta' } })     // 0011
       .mockResolvedValue({ error: null });
    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('0005');
    expect(mensajes).toContain('0011');
  });

  it('con algo faltando NO dice ok', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'nada existe' } });
    await verificarMigracionesCriticas();
    expect(info).not.toHaveBeenCalledWith('startup.migraciones', { ok: true });
  });

  it('la 0019 se sonda: sin ella el mismo CFDI se liquida dos veces', async () => {
    rpc.mockResolvedValue({ error: null });
    from.mockReturnValue(tabla({ error: { code: '42P01', message: 'relation gasto does not exist' } }));
    await verificarMigracionesCriticas();

    const mensajes = error.mock.calls.map((c) => (c[1] as { msg: string }).msg).join(' | ');
    expect(mensajes).toContain('0019');
  });
});
