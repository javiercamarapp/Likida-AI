import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO MEDIO (auditoría de este repo, 21-oct-2026) — EL ROUND-TRIP
// COMPLETO DE UNA SESIÓN QUE EXPIRA A MEDIA NAVEGACIÓN CON FILTROS EN LA URL.
//
// El caso: un contralor tiene abierto `/dashboard/viajes?f=abiertos&q=xyz&
// c=abc123` (un filtro, una búsqueda y una página de cursor) y su sesión
// expira a medio scroll. La cadena tiene que ser:
//
//   1. `requireSessionTenant('/dashboard/viajes', sp, querystringCompleto(sp))`
//      (guard.ts, llamado desde `resolverTenantEfectivo` con el tercer
//      argumento que las páginas tocadas en este fix ahora pasan) →
//      `redirect('/login?next=/dashboard/viajes?f=abiertos&q=xyz&c=abc123')`.
//   2. `/login` CONSERVA ese `next` tal cual — mismo mecanismo que ya prueba
//      `mcp_sin_sesion_round_trip.test.tsx` para `/mcp/autorizar`, aquí para
//      una ruta de /dashboard con filtros reales en vez de params de MCP.
//   3. `/auth/callback` intercambia el code y aterriza EXACTAMENTE en
//      `/dashboard/viajes?f=abiertos&q=xyz&c=abc123` — no en
//      `/dashboard/viajes` pelón.
//
// ANTES DEL ARREGLO, el paso 1 armaba el redirect con el `destino` LITERAL
// que cada caller le pasaba a `requireSessionTenant` (`/dashboard/viajes`),
// nunca con el querystring real: el `next` que llegaba al paso 2 ya había
// perdido los filtros antes de que el login pudiera conservar nada.
// `dashboard/sufijo.ts` (`sufijoTenant`) no lo resolvía: solo preserva
// `?tenant=`/`?vista=`/`?rol=` de la previsualización de superadmin entre
// links INTERNOS, nunca a través de este redirect.
// ═══════════════════════════════════════════════════════════════════════════

class ErrorDeRedirect extends Error {
  digest: string;
  constructor(destino: string) {
    super('NEXT_REDIRECT');
    this.digest = `NEXT_REDIRECT;replace;${destino};307;`;
  }
}
const redirect = vi.fn((destino: string) => { throw new ErrorDeRedirect(destino); });
vi.mock('next/navigation', () => ({ redirect: (d: string) => redirect(d) }));

vi.mock('next/font/google', () => ({
  Fraunces: () => ({ variable: '--font-fraunces' }),
  Instrument_Sans: () => ({ variable: '--font-instrument' }),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Map([['x-forwarded-for', '127.0.0.1']]),
}));

vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => true) }));
// Sin perfil de tenant (0770): este archivo prueba el round-trip de siempre,
// no el gate del perfil (perfil_tenant.test.ts + perfil_integracion.test.ts).
vi.mock('@/lib/auth/perfil_tenant', () => ({ exigirRutaDePerfil: vi.fn(async () => {}) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('@/lib/auth/reenvio_enlace', () => ({
  guardarCorreoParaReenvio: vi.fn(async () => undefined),
  reenviarEnlaceCaducado: vi.fn(async () => 'reenviado'),
}));

vi.mock('./respuesta_otp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./respuesta_otp')>();
  return { ...actual, conPisoDeTiempo: (fn: () => Promise<unknown>) => fn() };
});

const signInWithOtp = vi.fn(async (_args: { email: string; options: { emailRedirectTo: string; shouldCreateUser: boolean } }) => ({ error: null as { message: string } | null }));
const exchangeCodeForSession = vi.fn(async (_code: string) => ({ error: null as { message: string } | null }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { signInWithOtp, exchangeCodeForSession, signInWithOAuth: vi.fn() },
  }),
}));

const getSessionTenant = vi.fn(async (): Promise<unknown> => null);
vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...actual, getSessionTenant: () => getSessionTenant() };
});

import Login from './page';
import { GET as callbackGET } from '../auth/callback/route';
import { requireSessionTenant } from '@/lib/auth/guard';
import { querystringCompleto } from '../dashboard/sufijo';

interface NodoReact {
  type?: unknown;
  props?: { children?: unknown; [clave: string]: unknown };
}
function esNodoReact(v: unknown): v is NodoReact {
  return v !== null && typeof v === 'object';
}
function buscarTodos(nodo: unknown, pred: (n: NodoReact) => boolean, acc: NodoReact[] = []): NodoReact[] {
  if (!esNodoReact(nodo)) return acc;
  if (pred(nodo)) acc.push(nodo);
  const hijos = nodo.props?.children;
  if (Array.isArray(hijos)) {
    for (const h of hijos) buscarTodos(h, pred, acc);
  } else if (hijos) {
    buscarTodos(hijos, pred, acc);
  }
  return acc;
}
type AccionFormulario = (formData: FormData) => Promise<void>;
function accionesDeFormularios(nodo: unknown): Map<string, AccionFormulario> {
  const mapa = new Map<string, AccionFormulario>();
  const formularios = buscarTodos(nodo, (n) => typeof n.props?.action === 'function');
  for (const f of formularios) {
    const accion = f.props?.action as AccionFormulario;
    mapa.set(accion.name, accion);
  }
  return mapa;
}
function valoresDeInputNext(nodo: unknown): string[] {
  return buscarTodos(nodo, (n) => n.type === 'input' && n.props?.name === 'next')
    .map((n) => n.props?.value as string);
}

const SESION_EXPIRADA_URL_REAL = '/dashboard/viajes?f=abiertos&q=xyz&c=abc123';

beforeEach(() => {
  vi.clearAllMocks();
  getSessionTenant.mockResolvedValue(null);
  signInWithOtp.mockResolvedValue({ error: null });
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe('sesión expirada con filtros en la URL — el round-trip completo por /login', () => {
  it('1) requireSessionTenant, SIN sesión y con el querystring real, rebota a /login con next=/dashboard/viajes?f=...&q=...&c=...', async () => {
    const sp = { f: 'abiertos', q: 'xyz', c: 'abc123' };
    await expect(
      requireSessionTenant('/dashboard/viajes', undefined, querystringCompleto(sp)),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    expect(redirect).toHaveBeenCalledTimes(1);
    const destino = redirect.mock.calls[0][0] as string;
    expect(destino.startsWith('/login?next=')).toBe(true);

    const next = new URL(destino, 'https://x.invalid').searchParams.get('next')!;
    // El destino completo — NO el `/dashboard/viajes` pelón del bug.
    expect(next).toBe(SESION_EXPIRADA_URL_REAL);
  });

  it('2) /login CONSERVA ese next (filtros incluidos) en el render y en el server action de email', async () => {
    const el = await Login({ searchParams: Promise.resolve({ next: SESION_EXPIRADA_URL_REAL }) });

    const valoresNext = valoresDeInputNext(el);
    expect(valoresNext.length).toBe(2);
    for (const valor of valoresNext) expect(valor).toBe(SESION_EXPIRADA_URL_REAL);

    const entrarConEmail = accionesDeFormularios(el).get('entrarConEmail')!;
    expect(entrarConEmail).toBeTruthy();

    const fd = new FormData();
    fd.set('next', SESION_EXPIRADA_URL_REAL);
    fd.set('email', 'contralor@flota.com');
    await expect(entrarConEmail(fd)).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    const emailRedirectTo = signInWithOtp.mock.calls[0][0].options.emailRedirectTo as string;
    // Lo que Supabase reenvía a /auth/callback trae el next completo, con
    // los tres filtros adentro — nada se recortó al pasar por /login.
    expect(decodeURIComponent(emailRedirectTo)).toContain(`next=${SESION_EXPIRADA_URL_REAL}`);
  });

  it('3) /auth/callback, con ese next, aterriza EXACTAMENTE en la URL original — filtros, búsqueda y cursor intactos', async () => {
    const req = new NextRequest(
      `https://app.likida.ai/auth/callback?code=abc123&next=${encodeURIComponent(SESION_EXPIRADA_URL_REAL)}`,
    );
    const res = await callbackGET(req);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123');

    const location = res.headers.get('location')!;
    const url = new URL(location);
    expect(url.pathname).toBe('/dashboard/viajes');
    expect(url.search).toBe('?f=abiertos&q=xyz&c=abc123');
    // El bug: antes del fix, lo que llegaba aquí ya era el destino pelón.
    expect(location).not.toBe('https://app.likida.ai/dashboard/viajes');
  });
});
