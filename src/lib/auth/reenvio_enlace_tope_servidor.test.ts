import { beforeEach, describe, expect, it, vi } from 'vitest';

// F1B (adversarial): descartar la cookie de espera y reusar la cookie firmada no debe multiplicar los envios.
let jar = new Map<string, string>();
const signInWithOtp = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => { jar.set(k, v); },
  }),
  headers: async () => new Headers({ 'x-vercel-forwarded-for': '203.0.113.5' }),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { signInWithOtp } }) }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.test' }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { guardarCorreoParaReenvio, reenviarEnlaceCaducado } from './reenvio_enlace';
import { reiniciarLimites } from '@/lib/ratelimit';

beforeEach(() => {
  jar = new Map(); signInWithOtp.mockReset(); reiniciarLimites();
  process.env.CRON_SECRET = 'secreto-de-prueba-largo';
  signInWithOtp.mockResolvedValue({ error: null });
});

describe('el uno-cada-5-min vive en el servidor', () => {
  it('tirar la cookie de espera 10 veces con la misma cookie firmada manda un solo correo', async () => {
    await guardarCorreoParaReenvio('ana@empresa.mx');
    const firmada = jar.get('likida_correo_enlace')!;
    const resultados: string[] = [];
    for (let i = 0; i < 10; i++) {
      jar = new Map([['likida_correo_enlace', firmada]]);
      resultados.push(await reenviarEnlaceCaducado('/dashboard'));
    }
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(resultados[0]).toBe('reenviado');
    expect(resultados.slice(1).every((r) => r === 'reciente')).toBe(true);
  });
});
