import { beforeEach, describe, expect, it, vi } from 'vitest';

// MX-085: la sesión se lee UNA vez por petición. Fuera de un render de React `cache()` es un paso directo, así que aquí se sustituye por
// una memoria por «petición» (el mismo contrato: argumentos iguales → mismo resultado dentro de la misma petición).
const peticion = { memo: new Map<unknown, unknown>() };
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: <F extends (...a: never[]) => unknown>(fn: F) => ((...a: Parameters<F>) => {
    if (!peticion.memo.has(fn)) peticion.memo.set(fn, fn(...a));
    return peticion.memo.get(fn) as ReturnType<F>;
  }) as F,
}));

const getUser = vi.fn();
const maybeSingle = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { getSessionTenant } from './session';

beforeEach(() => {
  peticion.memo.clear();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } });
  maybeSingle.mockReset().mockResolvedValue({ data: { tenant_id: 't1', rol: 'flota_admin', nombre: 'Ana', operador_id: null, avatar_url: null, activo: true }, error: null });
});

describe('getSessionTenant: una lectura por petición', () => {
  it('tres llamadas en la misma petición hacen UN getUser y UNA lectura de app_user (antes: 3 y 3)', async () => {
    const [a, b, c] = await Promise.all([getSessionTenant(), getSessionTenant(), getSessionTenant()]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ userId: 'u1', tenantId: 't1', rol: 'flota_admin' });
  });

  it('otra petición vuelve a leer: no se comparte sesión entre peticiones', async () => {
    await getSessionTenant();
    peticion.memo.clear();
    await getSessionTenant();
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('sin sesión devuelve null y también se memoriza en la petición', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getSessionTenant()).toBeNull();
    expect(await getSessionTenant()).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
