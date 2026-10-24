// A37-S21-04: una IP que martilla el correo del dueño de una flota NO le quita
// el enlace mágico al dueño que lo pide desde otra IP.
import { beforeEach, describe, expect, it, vi } from 'vitest';

class ErrorDeRedirect extends Error {
  destino: string;
  constructor(destino: string) { super('NEXT_REDIRECT'); this.destino = destino; }
}
vi.mock('next/navigation', () => ({ redirect: (d: string) => { throw new ErrorDeRedirect(d); } }));
vi.mock('next/font/google', () => ({ Fraunces: () => ({ variable: '--f' }), Instrument_Sans: () => ({ variable: '--i' }) }));
const ctx = vi.hoisted(() => ({ ip: '10.0.0.1', contadores: new Map<string, number>() }));
vi.mock('next/headers', () => ({ headers: async () => new Map([['x-forwarded-for', ctx.ip]]) }));
// Un rateLimit que sí cuenta, como el real (por llave, ventana fija).
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (llave: string, max: number) => {
    const n = (ctx.contadores.get(llave) ?? 0) + 1;
    ctx.contadores.set(llave, n);
    return n <= max;
  },
}));
vi.mock('@/lib/auth/perfil_tenant', () => ({ exigirRutaDePerfil: vi.fn(async () => {}) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/auth/reenvio_enlace', () => ({ guardarCorreoParaReenvio: vi.fn(async () => undefined), reenviarEnlaceCaducado: vi.fn() }));
vi.mock('./respuesta_otp', async (orig) => ({ ...(await orig<typeof import('./respuesta_otp')>()), conPisoDeTiempo: (fn: () => Promise<unknown>) => fn() }));
const signInWithOtp = vi.fn(async (_a: unknown) => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { signInWithOtp, signInWithOAuth: vi.fn() } }) }));

import Login from './page';

type Nodo = { props?: { children?: unknown; action?: unknown } };
function acciones(n: unknown, salida: Array<(fd: FormData) => Promise<void>> = []) {
  if (!n || typeof n !== 'object') return salida;
  const nodo = n as Nodo;
  if (typeof nodo.props?.action === 'function') salida.push(nodo.props.action as (fd: FormData) => Promise<void>);
  const h = nodo.props?.children;
  if (Array.isArray(h)) h.forEach((x) => acciones(x, salida)); else if (h) acciones(h, salida);
  return salida;
}
async function pedirEnlace(email: string): Promise<string> {
  const el = await Login({ searchParams: Promise.resolve({}) });
  const entrar = acciones(el).find((a) => a.name === 'entrarConEmail')!;
  const fd = new FormData(); fd.set('email', email); fd.set('next', '/dashboard');
  try { await entrar(fd); } catch (e) { return (e as ErrorDeRedirect).destino; }
  return 'sin-redirect';
}

beforeEach(() => { ctx.contadores.clear(); ctx.ip = '10.0.0.1'; signInWithOtp.mockClear(); });

describe('A37-S21-04 login: bloqueo dirigido', () => {
  it('una IP que gasta su cupo con el correo del dueño no impide que el dueño pida su enlace desde otra IP', async () => {
    for (let i = 0; i < 12; i++) await pedirEnlace('dueno@flota.test'); // el atacante: 10 pasan, 2 se rechazan
    signInWithOtp.mockClear();
    ctx.ip = '10.0.0.2'; // el dueño, otra IP
    const destino = await pedirEnlace('dueno@flota.test');
    expect(destino).not.toContain('error=1');
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('el abuso desde MUCHAS IPs al mismo correo sí se corta (techo global por cuenta)', async () => {
    let enviados = 0;
    for (let i = 0; i < 40; i++) {
      ctx.ip = `10.1.0.${i}`;
      signInWithOtp.mockClear();
      await pedirEnlace('victima@flota.test');
      enviados += signInWithOtp.mock.calls.length;
    }
    expect(enviados).toBe(30);
  });
});
