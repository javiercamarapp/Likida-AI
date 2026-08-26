import { describe, it, expect, vi, beforeEach } from 'vitest';

// AUDITORÍA 19 (OP-19c2-3): `finalizar_wa_outbox` (mig. 0189) pasó de devolver
// `boolean` a `table(ok boolean, muerta boolean)` para que la app sepa cuándo
// una salida agotó sus reintentos y ya no se va a volver a intentar. Esto fija
// el contrato de lectura: PostgREST devuelve una tabla como ARREGLO de filas.

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const { finalizarSalidaWhatsApp } = await import('./wa_outbox');

const salida = { id: 'x', payload: {}, intentos: 8, leaseToken: 't' };

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
