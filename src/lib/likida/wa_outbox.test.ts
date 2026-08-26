import { describe, it, expect, vi, beforeEach } from 'vitest';

// AUDITORÍA 19 (OP-19c2-3): `finalizar_wa_outbox` (mig. 0189) pasó de devolver
// `boolean` a `table(ok boolean, muerta boolean)` para que la app sepa cuándo
// una salida agotó sus reintentos y ya no se va a volver a intentar. Esto fija
// el contrato de lectura: PostgREST devuelve una tabla como ARREGLO de filas.

const rpc = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from: () => ({ insert }) }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
const loggerError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { error: loggerError } }));

const { finalizarSalidaWhatsApp, encolarSalidaWhatsApp, reclamarSalidasWhatsApp } = await import('./wa_outbox');

const salida = { id: 'x', payload: {}, intentos: 8, leaseToken: 't' };

// PRUEBAS (barrido MEDIO/BAJO): `encolarSalidaWhatsApp` y `reclamarSalidasWhatsApp`
// no tenían ni una prueba — solo `finalizarSalidaWhatsApp` estaba cubierta, y es
// justo la tercera de tres funciones que este archivo exporta. `reclamarSalidasWhatsApp`
// es la que usa el cron recién recuperado (PR #80, kill switch de wa-outbox).
describe('encolarSalidaWhatsApp nunca lanza (BEST-EFFORT a propósito)', () => {
  beforeEach(() => { insert.mockReset(); loggerError.mockReset(); });

  it('inserta el payload y el motivo recortado a 500 caracteres, sin loggear si sale bien', async () => {
    insert.mockResolvedValue({ error: null });
    await encolarSalidaWhatsApp({ a: 1 }, 'x'.repeat(600));
    expect(insert).toHaveBeenCalledWith({ payload: { a: 1 }, ultimo_error: 'x'.repeat(500) });
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('si el insert devuelve error, lo loggea y no lanza', async () => {
    insert.mockResolvedValue({ error: { message: 'boom' } });
    await expect(encolarSalidaWhatsApp({}, 'motivo')).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalledWith('wa.outbox_no_encolado', { err: 'boom' });
  });

  it('si el insert LANZA (no solo devuelve error), tampoco propaga — es el respaldo del respaldo', async () => {
    insert.mockRejectedValue(new Error('red caída'));
    await expect(encolarSalidaWhatsApp({}, 'motivo')).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalledWith('wa.outbox_no_encolado', { err: 'red caída' });
  });
});

describe('reclamarSalidasWhatsApp mapea el contrato snake_case → camelCase de la RPC', () => {
  beforeEach(() => rpc.mockReset());

  it('convierte lease_token → leaseToken y castea intentos a número', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 'a1', payload: { x: 1 }, intentos: '3', lease_token: 'tok-1' }],
      error: null,
    });
    const salidas = await reclamarSalidasWhatsApp();
    expect(salidas).toEqual([{ id: 'a1', payload: { x: 1 }, intentos: 3, leaseToken: 'tok-1' }]);
    expect(rpc).toHaveBeenCalledWith('reclamar_wa_outbox', { p_limite: 25, p_lease_seconds: 120 });
  });

  it('respeta el límite pasado y no el default cuando se especifica', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await reclamarSalidasWhatsApp(5);
    expect(rpc).toHaveBeenCalledWith('reclamar_wa_outbox', { p_limite: 5, p_lease_seconds: 120 });
  });

  it('sin filas reclamadas, devuelve arreglo vacío (no null/undefined)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await reclamarSalidasWhatsApp()).toEqual([]);
  });

  it('si la RPC falla, lanza — a diferencia de encolar, aquí SÍ debe fallar ruidoso: el kill switch decide si reclama, no este archivo', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(reclamarSalidasWhatsApp()).rejects.toThrow('reclamarSalidasWhatsApp: timeout');
  });
});

describe('finalizarSalidaWhatsApp lee el contrato de tabla de la 0189', () => {
  beforeEach(() => rpc.mockReset());

  it('muerta: true cuando la fila agotó reintentos', async () => {
    rpc.mockResolvedValue({ data: [{ ok: true, muerta: true }], error: null });
    expect(await finalizarSalidaWhatsApp(salida, undefined, 'fallo')).toEqual({ muerta: true });
  });

  it('muerta: false en un envío exitoso', async () => {
    rpc.mockResolvedValue({ data: [{ ok: true, muerta: false }], error: null });
    expect(await finalizarSalidaWhatsApp(salida, 'wamid.1')).toEqual({ muerta: false });
  });

  it('muerta: false (no true por accidente) si la RPC falla o el claim se perdió', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await finalizarSalidaWhatsApp(salida, undefined, 'fallo')).toEqual({ muerta: false });

    rpc.mockResolvedValue({ data: [], error: null });
    expect(await finalizarSalidaWhatsApp(salida, undefined, 'fallo')).toEqual({ muerta: false });
  });
});
