import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H16/H17/H36 — mi-perfil dejaba de "fallar cerrado y decirlo"
// en tres lecturas/escrituras de `app_user` que nunca comprobaban `error`:
//
//  · H16 — leer el correo: una base caída se pintaba como "—", el mismo
//    rótulo que una cuenta sin correo (imposible en la práctica, pero el
//    rótulo miente igual sobre la CAUSA).
//  · H17 — subirAvatar: el UPDATE final (avatar_url) podía fallar DESPUÉS de
//    que el archivo ya se subió a Storage, y la pantalla igual redirigía a
//    "ok=avatar" — "Foto de perfil actualizada" con la foto vieja todavía
//    puesta.
//  · H36 — actualizarNombre: mismo patrón, mismo UPDATE sin comprobar.
//
// `redirect()` de Next LANZA (no vuelve) — se imita con el mismo patrón que
// `onboarding_gate.test.tsx` (dígito `NEXT_REDIRECT`). Las server actions son
// closures no exportadas: se extraen del árbol de elementos que el propio
// Server Component devuelve (es una función async normal fuera del bundler
// de Next) y se invocan directo con un FormData de prueba — así se prueba el
// código real, no una copia.
// ═══════════════════════════════════════════════════════════════════════════

class ErrorDeRedirect extends Error {
  digest: string;
  constructor(destino: string) {
    super('NEXT_REDIRECT');
    this.digest = `NEXT_REDIRECT;replace;${destino};307;`;
  }
}
const redirectMock = vi.fn((destino: string) => { throw new ErrorDeRedirect(destino); });
vi.mock('next/navigation', () => ({ redirect: (d: string) => redirectMock(d) }));

let sesion = { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', avatarUrl: null as string | null };
vi.mock('@/lib/auth/guard', () => ({ requireSessionTenant: async () => sesion }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: () => true }));

// MFA (fase 7) — estado configurable por prueba: `inscrito` controla qué
// bloque de /dashboard/mi-perfil se renderiza (y por tanto qué <form> expone
// `hallarAction`).
let mfaEstado: { inscrito: boolean; factorId: string | null; sinVerificar: string[] } =
  { inscrito: false, factorId: null, sinVerificar: [] };
vi.mock('@/lib/auth/mfa', () => ({
  estadoMfa: async () => mfaEstado,
  MSG_MFA_SUPERADMIN: { inscribir: 'x', retar: 'x', no_verificable: 'x' },
}));

// HALLAZGO ALTO #1 (auditoría adversarial, 21-oct-2026): `verificarMfa` y
// `quitarMfa` ahora pasan por `dentroDelLimiteMfa` (rateLimit) ANTES de
// tocar `sb2.auth.mfa.*` — se mockea `rateLimit` para controlar el permiso
// por prueba sin depender del Map en memoria real de `ratelimit.ts`.
let limiteMfaPermite = true;
const rateLimitMock = vi.fn(async (_llave: string, _limite: number, _ventanaMs: number) => limiteMfaPermite);
vi.mock('@/lib/ratelimit', () => ({ rateLimit: (...a: [string, number, number]) => rateLimitMock(...a) }));

let signOutResultado: { error: { message: string } | null } = { error: null };
const signOut = vi.fn(async (_opts?: unknown) => signOutResultado);
type ResultadoMfa = { error: { message: string } | null; data?: Record<string, unknown> };
let challengeResultado: ResultadoMfa = { error: null, data: { id: 'reto-1' } };
let verifyResultado: ResultadoMfa = { error: null };
let unenrollResultado: ResultadoMfa = { error: null };
const mfaChallenge = vi.fn(async (_a?: unknown) => challengeResultado);
const mfaVerify = vi.fn(async (_a?: unknown) => verifyResultado);
const mfaUnenroll = vi.fn(async (_a?: unknown) => unenrollResultado);
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      mfa: {
        challenge: (a?: unknown) => mfaChallenge(a),
        verify: (a?: unknown) => mfaVerify(a),
        unenroll: (a?: unknown) => mfaUnenroll(a),
      },
      signOut: (o?: unknown) => signOut(o),
    },
  }),
}));
vi.mock('@/lib/mcp/sesiones', () => ({
  listarMisClientesMcp: async () => [],
  revocarSesionesMcp: async () => {},
}));
vi.mock('../../admin/mi-perfil/avatar-uploader', () => ({ default: () => null }));
vi.mock('../sesiones-mcp/vista', () => ({ TablaClientesMcp: () => null }));
vi.mock('../sufijo', () => ({ sufijoTenant: () => '' }));

// El punto bajo prueba: qué responde `app_user` al SELECT del correo y a los
// dos UPDATE (nombre, avatar_url). Cada test ajusta estos resultados.
let selectResultado: { data: { email: string } | null; error: { message: string } | null } = { data: { email: 'ana@flota.mx' }, error: null };
let updateResultado: { error: { message: string } | null } = { error: null };
const updateLlamadas: Array<Record<string, unknown>> = [];
const removeLlamadas: string[][] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (_tabla: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => selectResultado }) }),
      update: (valores: Record<string, unknown>) => {
        updateLlamadas.push(valores);
        return { eq: async () => updateResultado };
      },
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async (rutas: string[]) => { removeLlamadas.push(rutas); return { error: null }; },
        getPublicUrl: () => ({ data: { publicUrl: 'https://storage/avatares/u-1/avatar.png' } }),
      }),
    },
  }),
}));

const { default: MiPerfilFlota } = await import('./page');

/** Camina el árbol de elementos de React devuelto por el Server Component
 *  (una función async normal fuera del compilador de Next) y regresa la
 *  primera `action` de un `<form>` cuyo texto de botón coincide. */
function hallarAction(nodo: unknown, pista: string): ((fd: FormData) => Promise<void>) | null {
  if (nodo == null || typeof nodo !== 'object') return null;
  const el = nodo as { type?: unknown; props?: Record<string, unknown> };
  if (el.props && typeof el.props.action === 'function' && JSON.stringify(el.props).includes(pista)) {
    return el.props.action as (fd: FormData) => Promise<void>;
  }
  const hijos = el.props?.children;
  const lista = Array.isArray(hijos) ? hijos : hijos != null ? [hijos] : [];
  for (const h of lista) {
    const r = hallarAction(h, pista);
    if (r) return r;
  }
  return null;
}

beforeEach(() => {
  sesion = { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', avatarUrl: null };
  selectResultado = { data: { email: 'ana@flota.mx' }, error: null };
  updateResultado = { error: null };
  updateLlamadas.length = 0;
  removeLlamadas.length = 0;
  redirectMock.mockClear();
  signOutResultado = { error: null };
  signOut.mockClear();
  mfaEstado = { inscrito: false, factorId: null, sinVerificar: [] };
  limiteMfaPermite = true;
  rateLimitMock.mockClear();
  challengeResultado = { error: null, data: { id: 'reto-1' } };
  verifyResultado = { error: null };
  unenrollResultado = { error: null };
  mfaChallenge.mockClear();
  mfaVerify.mockClear();
  mfaUnenroll.mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════
// FASE 1 · SEG-SESIONES — «cerrar todas mis sesiones», explícito con
// scope: 'global' (no depender del default de la librería sin decirlo).
// ═══════════════════════════════════════════════════════════════════════════
describe('cerrarTodasMisSesiones', () => {
  it('pide scope: global explícito y, si Auth lo confirma, manda a /login (la sesión propia también murió)', async () => {
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Cerrar sesión en todos los dispositivos')!;
    expect(accion).toBeTypeOf('function');
    await expect(accion(new FormData())).rejects.toThrow('NEXT_REDIRECT');
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('si Auth no confirma el cierre, se DICE (error=sesiones) y NO manda a /login', async () => {
    signOutResultado = { error: { message: 'auth caído' } };
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Cerrar sesión en todos los dispositivos')!;
    await expect(accion(new FormData())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=sesiones'));
    expect(redirectMock).not.toHaveBeenCalledWith('/login');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO ALTO #1 (auditoría adversarial, 21-oct-2026) — `verificarMfa` y
// `quitarMfa` llamaban a `sb2.auth.mfa.verify` con el código de 6 dígitos y
// CERO límite de tasa. No existía NINGUNA prueba de estas dos acciones antes
// de este archivo.
// ═══════════════════════════════════════════════════════════════════════════
describe('verificarMfa — límite de tasa (HALLAZGO ALTO #1)', () => {
  it('con el límite agotado, rebota a error=mfa_limite SIN llamar a mfa.challenge ni mfa.verify', async () => {
    mfaEstado = { inscrito: true, factorId: 'f-1', sinVerificar: [] };
    limiteMfaPermite = false;
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Verificar sesión')!;
    expect(accion).toBeTypeOf('function');
    const fd = new FormData();
    fd.set('factorId', 'f-1');
    fd.set('codigo', '123456');
    await expect(accion(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=mfa_limite'));
    expect(rateLimitMock).toHaveBeenCalledWith('mfa:codigo:u-1', 10, 5 * 60_000);
    expect(mfaChallenge).not.toHaveBeenCalled();
    expect(mfaVerify).not.toHaveBeenCalled();
  });

  it('dentro del límite: challenge + verify corren con los datos del formulario y, si Auth confirma, redirige a ok=mfa', async () => {
    mfaEstado = { inscrito: true, factorId: 'f-1', sinVerificar: [] };
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Verificar sesión')!;
    const fd = new FormData();
    fd.set('factorId', 'f-1');
    fd.set('codigo', '123456');
    await expect(accion(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(mfaChallenge).toHaveBeenCalledWith({ factorId: 'f-1' });
    expect(mfaVerify).toHaveBeenCalledWith({ factorId: 'f-1', challengeId: 'reto-1', code: '123456' });
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('ok=mfa'));
  });

  it('un código con forma inválida se rechaza ANTES de llamar a Auth, aunque pase el límite', async () => {
    mfaEstado = { inscrito: true, factorId: 'f-1', sinVerificar: [] };
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Verificar sesión')!;
    const fd = new FormData();
    fd.set('factorId', 'f-1');
    fd.set('codigo', 'abc');
    await expect(accion(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=mfa_codigo'));
    expect(mfaChallenge).not.toHaveBeenCalled();
  });

  it('si Auth rechaza el código (verify.error), redirige a error=mfa_codigo', async () => {
    mfaEstado = { inscrito: true, factorId: 'f-1', sinVerificar: [] };
    verifyResultado = { error: { message: 'invalid code' } };
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Verificar sesión')!;
    const fd = new FormData();
    fd.set('factorId', 'f-1');
    fd.set('codigo', '000000');
    await expect(accion(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=mfa_codigo'));
  });
});

describe('quitarMfa — límite de tasa (HALLAZGO ALTO #1)', () => {
  it('con el límite agotado, rebota a error=mfa_limite SIN llamar a mfa.challenge/verify/unenroll', async () => {
    mfaEstado = { inscrito: true, factorId: 'f-1', sinVerificar: [] };
    limiteMfaPermite = false;
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Quitar el factor (exige el código)')!;
    expect(accion).toBeTypeOf('function');
    const fd = new FormData();
    fd.set('factorId', 'f-1');
    fd.set('codigo', '123456');
    await expect(accion(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=mfa_limite'));
    expect(mfaChallenge).not.toHaveBeenCalled();
    expect(mfaUnenroll).not.toHaveBeenCalled();
  });

  it('dentro del límite y con el código correcto: unenroll corre y redirige a ok=mfa_fuera', async () => {
    mfaEstado = { inscrito: true, factorId: 'f-1', sinVerificar: [] };
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Quitar el factor (exige el código)')!;
    const fd = new FormData();
    fd.set('factorId', 'f-1');
    fd.set('codigo', '123456');
    await expect(accion(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(mfaUnenroll).toHaveBeenCalledWith({ factorId: 'f-1' });
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('ok=mfa_fuera'));
  });

  it('sin código (o con forma inválida) se rechaza antes de llamar a Auth', async () => {
    mfaEstado = { inscrito: true, factorId: 'f-1', sinVerificar: [] };
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Quitar el factor (exige el código)')!;
    const fd = new FormData();
    fd.set('factorId', 'f-1');
    fd.set('codigo', '12');
    await expect(accion(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=mfa_codigo'));
    expect(mfaChallenge).not.toHaveBeenCalled();
  });

  it('el límite es un cupo COMPARTIDO con verificarMfa (mismo prefijo mfa:codigo:<userId>, nunca dos cupos separados)', async () => {
    mfaEstado = { inscrito: true, factorId: 'f-1', sinVerificar: [] };
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const verificar = hallarAction(arbol, 'Verificar sesión')!;
    const quitar = hallarAction(arbol, 'Quitar el factor (exige el código)')!;
    const fd1 = new FormData(); fd1.set('factorId', 'f-1'); fd1.set('codigo', '123456');
    await expect(verificar(fd1)).rejects.toThrow('NEXT_REDIRECT');
    const fd2 = new FormData(); fd2.set('factorId', 'f-1'); fd2.set('codigo', '123456');
    await expect(quitar(fd2)).rejects.toThrow('NEXT_REDIRECT');
    expect(rateLimitMock).toHaveBeenNthCalledWith(1, 'mfa:codigo:u-1', 10, 5 * 60_000);
    expect(rateLimitMock).toHaveBeenNthCalledWith(2, 'mfa:codigo:u-1', 10, 5 * 60_000);
  });
});

describe('H16 — leer el correo falla cerrado', () => {
  it('sin error: pinta el correo real', async () => {
    const html = JSON.stringify(await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as unknown);
    expect(html).toContain('ana@flota.mx');
    expect(html).not.toContain('No se pudo leer');
  });

  it('con error de lectura: dice "No se pudo leer", NUNCA "—" (que se lee como "sin correo")', async () => {
    selectResultado = { data: null, error: { message: 'timeout' } };
    const html = JSON.stringify(await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as unknown);
    expect(html).toContain('No se pudo leer');
  });
});

describe('H36 — actualizarNombre falla cerrado', () => {
  it('UPDATE exitoso: redirige a ok=nombre', async () => {
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Guardar nombre')!;
    expect(accion).toBeTypeOf('function');
    const fd = new FormData();
    fd.set('nombre', 'Ana Nueva');
    await expect(accion(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('ok=nombre'));
  });

  it('UPDATE falla: redirige a error=nombre_guardar, NO a ok=nombre — antes no comprobaba `error`', async () => {
    updateResultado = { error: { message: 'la base no contestó' } };
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'Guardar nombre')!;
    const fd = new FormData();
    fd.set('nombre', 'Ana Nueva');
    await expect(accion(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=nombre_guardar'));
    expect(redirectMock).not.toHaveBeenCalledWith(expect.stringContaining('ok=nombre'));
  });
});

describe('H17 — subirAvatar falla cerrado tras la subida a Storage', () => {
  function archivoDePrueba(): File {
    return new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' });
  }

  it('Storage sube y el UPDATE de avatar_url también: ok=avatar', async () => {
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAction(arbol, 'AvatarUploader') ?? hallarAvatarAction(arbol);
    const fd = new FormData();
    fd.set('avatar', archivoDePrueba());
    await expect(accion!(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('ok=avatar'));
  });

  it('A37-S19-06: al cambiar de formato se borran las fotos anteriores de otras extensiones (bucket público)', async () => {
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAvatarAction(arbol);
    const fd = new FormData();
    fd.set('avatar', archivoDePrueba());
    await expect(accion!(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(removeLlamadas).toEqual([['u-1/avatar.webp', 'u-1/avatar.jpg']]);
  });

  it('A37-S19-06: si el UPDATE de avatar_url falla NO se borra nada (la foto anterior sigue siendo la vigente)', async () => {
    updateResultado = { error: { message: 'la base no contestó' } };
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAvatarAction(arbol);
    const fd = new FormData();
    fd.set('avatar', archivoDePrueba());
    await expect(accion!(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(removeLlamadas).toEqual([]);
  });

  it('Storage sube pero el UPDATE de avatar_url falla: error=avatar, NO ok=avatar — la foto vieja se queda puesta sin decirlo', async () => {
    updateResultado = { error: { message: 'la base no contestó' } };
    const arbol = await MiPerfilFlota({ searchParams: Promise.resolve({}) }) as ReactElement;
    const accion = hallarAvatarAction(arbol);
    const fd = new FormData();
    fd.set('avatar', archivoDePrueba());
    await expect(accion!(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=avatar'));
    expect(redirectMock).not.toHaveBeenCalledWith(expect.stringContaining('ok=avatar'));
  });
});

/** `AvatarUploader` está mockeado a `() => null`, así que su `accion` (prop,
 *  no `action` de un <form>) no aparece bajo `hallarAction`. Se busca por
 *  props.accion en su lugar. */
function hallarAvatarAction(nodo: unknown): ((fd: FormData) => Promise<void>) | null {
  if (nodo == null || typeof nodo !== 'object') return null;
  const el = nodo as { type?: unknown; props?: Record<string, unknown> };
  if (el.props && typeof el.props.accion === 'function') return el.props.accion as (fd: FormData) => Promise<void>;
  const hijos = el.props?.children;
  const lista = Array.isArray(hijos) ? hijos : hijos != null ? [hijos] : [];
  for (const h of lista) {
    const r = hallarAvatarAction(h);
    if (r) return r;
  }
  return null;
}
