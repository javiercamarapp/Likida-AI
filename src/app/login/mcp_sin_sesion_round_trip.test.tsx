import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA E.28, F-1 (ALTO) — EL ROUND-TRIP COMPLETO DEL CONSENTIMIENTO MCP
// SIN SESIÓN DE PANEL VIVA.
//
// El caso de uso más común del MCP recién desplegado: alguien conecta Likida
// desde Claude.ai o ChatGPT SIN tener el panel abierto. La cadena es:
//
//   1. `/mcp/autorizar` (sin sesión) → `redirect('/login?next=/mcp/autorizar?...')`
//      (mcp/autorizar/page.tsx).
//   2. `/login` tiene que CONSERVAR ese `next` — en el render (para el hidden
//      input de los dos formularios) y en los dos server actions
//      (`entrarConGoogle`, `entrarConEmail`) que arman `emailRedirectTo` /
//      `redirectTo` hacia `/auth/callback`.
//   3. `/auth/callback` intercambia el code y, si `next` empieza con
//      `/mcp/autorizar`, VUELVE ahí — no al `/dashboard` por default.
//   4. De vuelta en `/mcp/autorizar`, ahora CON sesión, se ve la pantalla de
//      consentimiento — no un loop ni el panel.
//
// ANTES DEL ARREGLO, el paso 2 recortaba `next` a `/dashboard` en sus TRES
// gates (`sp.next.startsWith('/dashboard')`, dos veces más en los server
// actions) porque `/mcp/autorizar?...` no empieza con `/dashboard`. El
// paso 3 YA sabía volver a `/mcp/autorizar` (tiene su propio comentario que
// lo explica), pero nunca lo alcanzaba: el `next` que le tocaba había muerto
// en el paso 2. Resultado: el usuario aterrizaba en `/dashboard`, la pantalla
// de consentimiento nunca se re-mostraba, y Claude/ChatGPT se quedaban
// esperando un `code` que jamás llegó.
//
// Esta prueba corre las CUATRO etapas de verdad — llamando a las páginas y a
// la ruta como funciones reales, no leyendo el fuente por texto — para que
// una futura edición de `/login` que vuelva a angostar el gate la rompa aquí,
// no en producción durante la próxima conexión de Claude.
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
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('@/lib/auth/reenvio_enlace', () => ({
  guardarCorreoParaReenvio: vi.fn(async () => undefined),
  reenviarEnlaceCaducado: vi.fn(async () => 'reenviado'),
}));

// El piso de tiempo (M24) suma 1.5 s reales a `entrarConEmail` — correcto en
// producción, sobra en una prueba. Se conserva la lógica de `respuestaOtp`,
// que sí es lo que este archivo protege en `no_autoregistro.test.ts`.
vi.mock('./respuesta_otp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./respuesta_otp')>();
  return { ...actual, conPisoDeTiempo: (fn: () => Promise<unknown>) => fn() };
});

const signInWithOtp = vi.fn(async (_args: { email: string; options: { emailRedirectTo: string; shouldCreateUser: boolean } }) => ({ error: null as { message: string } | null }));
const signInWithOAuth = vi.fn(async (_args: { provider: string; options: { redirectTo: string } }) => ({ data: { url: 'https://accounts.google.com/o/oauth2/x' } as { url: string } | null, error: null as { message: string } | null }));
const exchangeCodeForSession = vi.fn(async (_code: string) => ({ error: null as { message: string } | null }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { signInWithOtp, signInWithOAuth, exchangeCodeForSession } }),
}));

const SESION_VALIDA = {
  userId: 'u1', tenantId: 't1', rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null,
};
const getSessionTenant = vi.fn(async (): Promise<typeof SESION_VALIDA | null> => null);
vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...actual, getSessionTenant: () => getSessionTenant() };
});

const leerCliente = vi.fn(async () => ({
  ok: true as const,
  cliente: { clientId: 'c1', nombre: 'Claude', redirectUris: ['https://claude.ai/api/mcp/callback'] },
}));
vi.mock('@/lib/mcp/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/oauth')>();
  return { ...actual, leerCliente: () => leerCliente() };
});

import Login from './page';
import Autorizar from '../mcp/autorizar/page';
import { GET as callbackGET } from '../auth/callback/route';

/** Forma mínima de un elemento de React (objeto plano, no DOM) para
 *  recorrerlo sin `any`: basta `type` y `props`, y `props` es abierto porque
 *  cada etiqueta trae los suyos (name, value, action…). */
interface NodoReact {
  type?: unknown;
  props?: { children?: unknown; [clave: string]: unknown };
}

function esNodoReact(v: unknown): v is NodoReact {
  return v !== null && typeof v === 'object';
}

/** Recorre el árbol de elementos de React buscando TODOS los nodos que
 *  cumplan `pred`. Mismo patrón que usaría cualquier prueba de estos server
 *  components: no hay DOM que montar. */
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

/** Los server actions de los `<form action={...}>` del árbol, por el nombre
 *  de la función (`entrarConGoogle`, `entrarConEmail`) — son closures reales
 *  del componente, no algo que se pueda importar suelto. */
function accionesDeFormularios(nodo: unknown): Map<string, AccionFormulario> {
  const mapa = new Map<string, AccionFormulario>();
  const formularios = buscarTodos(nodo, (n) => typeof n.props?.action === 'function');
  for (const f of formularios) {
    const accion = f.props?.action as AccionFormulario;
    mapa.set(accion.name, accion);
  }
  return mapa;
}

/** Los valores de los `<input type="hidden" name="next" value={...} />` del
 *  árbol — uno por formulario. */
function valoresDeInputNext(nodo: unknown): string[] {
  return buscarTodos(nodo, (n) => n.type === 'input' && n.props?.name === 'next')
    .map((n) => n.props?.value as string);
}

const PARAMS_MCP = {
  client_id: 'c1',
  redirect_uri: 'https://claude.ai/api/mcp/callback',
  state: 'estado-1',
  response_type: 'code',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
};

beforeEach(() => {
  vi.clearAllMocks();
  getSessionTenant.mockResolvedValue(null);
  leerCliente.mockResolvedValue({
    ok: true,
    cliente: { clientId: 'c1', nombre: 'Claude', redirectUris: ['https://claude.ai/api/mcp/callback'] },
  });
  signInWithOtp.mockResolvedValue({ error: null });
  signInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com/o/oauth2/x' }, error: null });
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe('F-1 — el round-trip completo de /mcp/autorizar sin sesión', () => {
  it('1) sin sesión, /mcp/autorizar rebota a /login con next=/mcp/autorizar?...', async () => {
    await expect(Autorizar({ searchParams: Promise.resolve(PARAMS_MCP) })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });
    expect(redirect).toHaveBeenCalledTimes(1);
    const destino = redirect.mock.calls[0][0] as string;
    expect(destino.startsWith('/login?next=')).toBe(true);

    const next = new URL(destino, 'https://x.invalid').searchParams.get('next')!;
    expect(next.startsWith('/mcp/autorizar')).toBe(true);
    // Reconstruida, la query de vuelta trae los mismos parámetros con los que
    // se llegó — nada se perdió al rebotar.
    const qs = new URL(`https://x.invalid${next}`).searchParams;
    expect(qs.get('client_id')).toBe('c1');
    expect(qs.get('redirect_uri')).toBe('https://claude.ai/api/mcp/callback');
    expect(qs.get('state')).toBe('estado-1');
  });

  it('2) /login CONSERVA ese next — en el render y en los dos server actions (el bug: se recortaba a /dashboard)', async () => {
    const mcpNext = '/mcp/autorizar?client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fcallback&state=estado-1&response_type=code&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256';

    const el = await Login({ searchParams: Promise.resolve({ next: mcpNext }) });

    // El render: los DOS hidden inputs "next" (Google y correo) llevan el
    // camino de vuelta al MCP, no "/dashboard".
    const valoresNext = valoresDeInputNext(el);
    expect(valoresNext.length).toBe(2);
    for (const valor of valoresNext) expect(valor).toBe(mcpNext);

    // Los server actions, extraídos del propio árbol (son closures reales:
    // no se pueden importar sueltos de un server component).
    const acciones = accionesDeFormularios(el);
    const entrarConGoogle = acciones.get('entrarConGoogle');
    const entrarConEmail = acciones.get('entrarConEmail');
    expect(entrarConGoogle).toBeTruthy();
    expect(entrarConEmail).toBeTruthy();

    // entrarConGoogle: el `redirectTo` que arma para Supabase debe llevar el
    // next del MCP — es lo que Supabase reenvía a /auth/callback tal cual.
    const fdGoogle = new FormData();
    fdGoogle.set('next', mcpNext);
    await expect(entrarConGoogle!(fdGoogle)).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    const redirectToGoogle = signInWithOAuth.mock.calls[0][0].options.redirectTo;
    expect(decodeURIComponent(redirectToGoogle)).toContain(`next=${mcpNext}`);

    // entrarConEmail: mismo criterio, y el redirect final de la pantalla
    // "enviado" también conserva el next del MCP (no "/dashboard").
    const fdEmail = new FormData();
    fdEmail.set('next', mcpNext);
    fdEmail.set('email', 'ana@flota.com');
    await expect(entrarConEmail!(fdEmail)).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    const emailRedirectTo = signInWithOtp.mock.calls[0][0].options.emailRedirectTo as string;
    expect(decodeURIComponent(emailRedirectTo)).toContain(`next=${mcpNext}`);
    const destinoFinal = redirect.mock.calls.at(-1)![0] as string;
    expect(decodeURIComponent(destinoFinal)).toBe(`/login?next=${mcpNext}&enviado=1`);
  });

  it('3) /auth/callback, con ese next, VUELVE a /mcp/autorizar (no a /dashboard)', async () => {
    const mcpNext = '/mcp/autorizar?client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fcallback&state=estado-1';
    const req = new NextRequest(
      `https://app.likida.ai/auth/callback?code=abc123&next=${encodeURIComponent(mcpNext)}`,
    );
    const res = await callbackGET(req);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    const location = res.headers.get('location')!;
    expect(location).toContain(mcpNext);
    expect(location).not.toContain('/dashboard');
  });

  it('4) de vuelta en /mcp/autorizar, YA con sesión, se ve el consentimiento — no un loop ni el panel', async () => {
    getSessionTenant.mockResolvedValue(SESION_VALIDA);
    const el = await Autorizar({ searchParams: Promise.resolve(PARAMS_MCP) });
    // No redirige: el server component devuelve la pantalla de consentimiento.
    expect(redirect).not.toHaveBeenCalled();
    const titulo = buscarTodos(el, (n) => typeof n.type === 'function' || n.type === 'h1');
    // La pantalla renderiza el nombre del cliente MCP en el título.
    const textoCompleto = JSON.stringify(el);
    expect(textoCompleto).toContain('Claude');
    expect(titulo.length).toBeGreaterThan(0);
  });
});
