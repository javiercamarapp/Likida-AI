import { beforeEach, describe, expect, it, vi } from 'vitest';

// CT-SEG-14: el reenvio del enlace caducado no puede delatar si un correo tiene cuenta.
const jar = new Map<string, string>();
const set = vi.fn((k: string, v: string) => { jar.set(k, v); });
const signInWithOtp = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set }),
  headers: async () => new Headers({ 'x-vercel-forwarded-for': '203.0.113.5' }),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { signInWithOtp } }) }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.test' }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { guardarCorreoParaReenvio, reenviarEnlaceCaducado } from './reenvio_enlace';

beforeEach(() => {
  jar.clear(); set.mockClear(); signInWithOtp.mockReset();
  process.env.CRON_SECRET = 'secreto-de-prueba-largo';
  delete process.env.CORREO_ENLACE_SECRET; delete process.env.SUPABASE_AUTH_HOOK_SECRET;
});

describe('oraculo de existencia de cuenta en el reenvio (CT-SEG-14)', () => {
  it('una cookie con el correo en claro fijada a mano no dispara ningun envio', async () => {
    jar.set('likida_correo_enlace', encodeURIComponent('victima@x.com'));
    expect(await reenviarEnlaceCaducado('/dashboard')).toBe('no');
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
  it('la cookie emitida por el servidor no lleva el correo en claro', async () => {
    await guardarCorreoParaReenvio('ana@empresa.mx');
    const v = jar.get('likida_correo_enlace')!;
    expect(v).not.toContain('ana@empresa.mx');
    expect(v).not.toContain(encodeURIComponent('ana@empresa.mx'));
  });
  it('con cuenta y sin cuenta la respuesta es la misma', async () => {
    await guardarCorreoParaReenvio('ana@empresa.mx');
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const conCuenta = await reenviarEnlaceCaducado('/dashboard');
    jar.delete('likida_reenvio_espera');
    signInWithOtp.mockResolvedValueOnce({ error: { code: 'otp_disabled', status: 422 } });
    const sinCuenta = await reenviarEnlaceCaducado('/dashboard');
    expect(sinCuenta).toBe(conCuenta);
    expect(sinCuenta).toBe('reenviado');
  });
  it('F1B: el tope de 60 s por correo de GoTrue (429, solo cuentas existentes) se anuncia igual que sin cuenta', async () => {
    await guardarCorreoParaReenvio('ana@empresa.mx');
    signInWithOtp.mockResolvedValueOnce({ error: { code: 'over_email_send_rate_limit', status: 429 } });
    const conCuentaYTope = await reenviarEnlaceCaducado('/dashboard');
    jar.delete('likida_reenvio_espera');
    signInWithOtp.mockResolvedValueOnce({ error: { code: 'otp_disabled', status: 422 } });
    expect(conCuentaYTope).toBe(await reenviarEnlaceCaducado('/dashboard'));
  });
  it('una cuota por IP (no depende de la cuenta) si se anuncia como no', async () => {
    await guardarCorreoParaReenvio('ana@empresa.mx');
    signInWithOtp.mockResolvedValueOnce({ error: { code: 'over_request_rate_limit', status: 429 } });
    expect(await reenviarEnlaceCaducado('/dashboard')).toBe('no');
  });
  it('sin secreto configurado no se emite cookie y no se reenvia', async () => {
    delete process.env.CRON_SECRET;
    await guardarCorreoParaReenvio('ana@empresa.mx');
    expect(set).not.toHaveBeenCalled();
    expect(await reenviarEnlaceCaducado('/dashboard')).toBe('no');
  });
});
