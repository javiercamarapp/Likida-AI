import { describe, it, expect, vi, afterEach } from 'vitest';
import { respuestaOtp, conPisoDeTiempo } from './respuesta_otp';

// AUDITORÍA 18, MEDIO (M24) — dos POST a /login con el mismo correo en 60 s:
// con cuenta, el segundo caía en `over_email_send_rate_limit` → error; sin
// cuenta, `otp_disabled` → enviado. Dos peticiones y la lista de objetivos.
describe('respuestaOtp — correo con y sin cuenta se ven IGUAL (M24)', () => {
  it('sin error (correo con cuenta, enviado de verdad) → enviado', () => {
    expect(respuestaOtp(null)).toBe('enviado');
  });
  it('otp_disabled / signup_disabled (correo SIN cuenta) → enviado', () => {
    expect(respuestaOtp({ code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' })).toBe('enviado');
    expect(respuestaOtp({ code: 'signup_disabled', status: 422 })).toBe('enviado');
  });
  it('over_email_send_rate_limit (correo CON cuenta, 2.º intento) → enviado, no error', () => {
    // La rama que abría el oráculo.
    expect(respuestaOtp({ code: 'over_email_send_rate_limit', status: 429 })).toBe('enviado');
  });
  it('cualquier fallo de infraestructura o código desconocido → enviado (cerrado por default)', () => {
    expect(respuestaOtp({ code: 'unexpected_failure', status: 500 })).toBe('enviado');
    expect(respuestaOtp({ code: 'hook_timeout', status: 500 })).toBe('enviado');
    expect(respuestaOtp({ status: 502, message: 'bad gateway' })).toBe('enviado');
    expect(respuestaOtp({ code: 'codigo_que_no_existe' })).toBe('enviado');
  });
  it('solo el correo malformado (decidido antes de buscar la cuenta) sale como error', () => {
    expect(respuestaOtp({ code: 'validation_failed', status: 400 })).toBe('error');
    expect(respuestaOtp({ code: 'email_address_invalid', status: 400 })).toBe('error');
  });
  it('el texto de la respuesta no depende del correo: el mismo veredicto para todo lo que no es malformado', () => {
    const veredictos = new Set([
      respuestaOtp(null), respuestaOtp({ code: 'otp_disabled' }), respuestaOtp({ code: 'over_email_send_rate_limit' }),
      respuestaOtp({ code: 'over_request_rate_limit' }), respuestaOtp({ message: 'SMTP down' }),
    ]);
    expect(veredictos).toEqual(new Set(['enviado']));
  });
});

describe('conPisoDeTiempo — la rama rápida tarda lo mismo que la lenta', () => {
  afterEach(() => vi.useRealTimers());

  it('un rechazo inmediato (otp_disabled) no resuelve antes del piso', async () => {
    vi.useFakeTimers();
    let resuelto = false;
    const p = conPisoDeTiempo(() => Promise.resolve({ error: { code: 'otp_disabled' } }), 1500).then((r) => { resuelto = true; return r; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(resuelto).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resuelto).toBe(true);
    await expect(p).resolves.toEqual({ error: { code: 'otp_disabled' } });
  });

  it('una llamada más lenta que el piso no se recorta', async () => {
    vi.useFakeTimers();
    let resuelto = false;
    const lenta = () => new Promise<string>((r) => setTimeout(() => r('ok'), 2500));
    const p = conPisoDeTiempo(lenta, 1500).then((r) => { resuelto = true; return r; });
    await vi.advanceTimersByTimeAsync(2000);
    expect(resuelto).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBe('ok');
  });

  it('si `fn` lanza, se espera el piso igual y luego se relanza', async () => {
    vi.useFakeTimers();
    let terminado = false;
    const p = conPisoDeTiempo(() => Promise.reject(new Error('boom')), 1500).catch((e) => { terminado = true; return e; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(terminado).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBeInstanceOf(Error);
  });
});
