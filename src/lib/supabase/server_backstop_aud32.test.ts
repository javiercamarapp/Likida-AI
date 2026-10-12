// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32 · c15 — REN-32C15-C1 (CRÍTICO): el cliente de la SESIÓN era el
// único de Supabase sin techo de fetch, y es el primer eslabón de toda ruta
// autenticada y de las ~80 páginas de /dashboard y /admin.
//
// `admin.ts` lleva `BACKSTOP_MS` en `global.fetch` desde la auditoría 1, con el
// motivo escrito: «SIN un tope, un socket que Supabase acepta y no contesta
// cuelga hasta el default de undici (300 s)… Vercel mata la función a medio
// camino SIN log». `acotada()` lo bajó a ~9.5 s donde se usa. El cliente SSR
// por cookies quedó fuera de las dos capas — y es el que corre PRIMERO.
//
// El peor caso medido por el auditor: `getSessionTenant()` hace
// `auth.getUser()` + `from('app_user')` y REINTENTA la pareja completa, así que
// son hasta 4 fetch sin señal de aborto; `sesionSuperadmin()` añade otro
// cliente y llega a 6. 6 × 300 s = 1,800 s contra `maxDuration = 60`. Mientras
// ese eslabón no tenga techo, ningún presupuesto del repo puede demostrar su
// peor caso: todas las sumas son «sin contar auth».
//
// Esta prueba falla sin el arreglo: hoy `createServerClient` se llama SIN
// bloque `global`, así que no hay `fetch` que inspeccionar.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// El techo se lee al CARGAR el módulo (igual que en `admin.ts`, que es la
// política que esto replica), así que se baja ANTES del import de abajo. Si se
// pusiera después, la prueba esperaría los 25 s reales y se caería por timeout
// del runner en vez de por el hallazgo.
process.env.LIKIDA_SUPABASE_FETCH_MS = '40';

type Opciones = { global?: { fetch?: typeof fetch } };
const capturadas: Opciones[] = [];

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, opts: Opciones) => {
    capturadas.push(opts);
    return { __cliente: true };
  },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const { supabaseServer } = await import('./server');

beforeEach(() => {
  capturadas.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proyecto.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
});
afterEach(() => { vi.restoreAllMocks(); });

describe('REN-32C15-C1 · el cliente de la sesión también lleva techo de fetch', () => {
  it('pasa un `global.fetch` propio — sin él, un socket colgado llega a los 300 s de undici', async () => {
    await supabaseServer();
    expect(capturadas).toHaveLength(1);
    expect(typeof capturadas[0].global?.fetch).toBe('function');
  });

  it('ese fetch acota de verdad: un servidor que acepta y nunca contesta aborta, no cuelga', async () => {
    // Un `fetch` que nunca resuelve por su cuenta: solo la señal lo termina.
    // Es el modo de falla exacto del hallazgo — el socket se acepta y no llega
    // respuesta —, no un error de red (que resolvería solo y no probaría nada).
    vi.stubGlobal('fetch', (_u: unknown, init?: RequestInit) => new Promise((_res, rej) => {
      const s = init?.signal;
      if (!s) return; // sin señal se queda colgado para siempre: es el bug.
      if (s.aborted) return rej(s.reason);
      s.addEventListener('abort', () => rej(s.reason), { once: true });
    }));

    await supabaseServer();
    const propio = capturadas[0].global!.fetch!;

    const t0 = Date.now();
    await expect(propio('https://proyecto.supabase.co/rest/v1/app_user'))
      .rejects.toThrowError();
    // Aborta cerca del techo configurado, no a los 300 s del default.
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('la señal del llamador sigue mandando: el backstop añade techo, no lo sustituye', async () => {
    // Determinista a propósito: el llamador llega YA abortado, así que no hay
    // carrera posible contra el temporizador del backstop y lo que se mide es
    // exactamente lo que importa — que su señal viaja y no se descarta.
    const vistas: Array<AbortSignal | undefined> = [];
    vi.stubGlobal('fetch', (_u: unknown, init?: RequestInit) => {
      vistas.push(init?.signal ?? undefined);
      const s = init?.signal;
      if (s?.aborted) return Promise.reject(s.reason);
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    await supabaseServer();
    const propio = capturadas[0].global!.fetch!;

    const ac = new AbortController();
    ac.abort(new Error('el llamador canceló'));
    await expect(propio('https://proyecto.supabase.co/rest/v1/app_user', { signal: ac.signal }))
      .rejects.toThrow(/el llamador canceló/);
    expect(vistas[0]?.aborted).toBe(true);
  });
});
