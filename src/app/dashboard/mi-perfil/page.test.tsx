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
vi.mock('@/lib/auth/mfa', () => ({ estadoMfa: async () => ({ inscrito: false, factorId: null, sinVerificar: [] }) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { mfa: {} } }) }));
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
  redirectMock.mockClear();
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
