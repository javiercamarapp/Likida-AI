import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA SELECCIÓN EXPLÍCITA DE FLOTA (admin-context) — lo que se fija:
//  1. La cookie es FIRMADA y toda duda es null (fallar cerrado): valor
//     manoseado, expirado, sin llave o con formato raro = NO-selección —
//     jamás un tenant adivinado.
//  2. La bitácora de la selección es best-effort: su fallo se loguea y
//     NUNCA revienta (patrón firmarImpersonacion).
//  3. `destinoSeguro` no es un open redirect.
// ═══════════════════════════════════════════════════════════════════════════

const insert = vi.fn(async (_p: unknown): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: null, error: null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (_t: string) => ({ insert }) }),
}));
const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger: logs }));

const {
  firmarSeleccion, validarSeleccion, anotarSeleccionEnBitacora,
  destinoSeguro, TTL_SELECCION_MS,
} = await import('./admin-context');

const T0 = 1_700_000_000_000;
const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

beforeEach(() => {
  vi.stubEnv('LIKIDA_FLOTA_COOKIE_LLAVE', 'llave-de-prueba');
  insert.mockClear();
  insert.mockResolvedValue({ data: null, error: null });
  logs.warn.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('firmar y validar la selección', () => {
  it('el viaje redondo devuelve el tenant firmado', () => {
    const v = firmarSeleccion(TENANT, T0);
    expect(v).toBeTruthy();
    expect(validarSeleccion(v!, T0 + 1000)).toBe(TENANT);
  });

  it('un valor MANOSEADO (otro tenant con la firma vieja) es null', () => {
    const v = firmarSeleccion(TENANT, T0)!;
    const partes = v.split('.');
    partes[1] = 'ffffffff-0000-0000-0000-000000000000';
    expect(validarSeleccion(partes.join('.'), T0 + 1000)).toBeNull();
  });

  it('estirar la expiración a mano rompe la firma — el TTL también está firmado', () => {
    const v = firmarSeleccion(TENANT, T0)!;
    const partes = v.split('.');
    partes[2] = String(Number(partes[2]) + 999_999);
    expect(validarSeleccion(partes.join('.'), T0 + 1000)).toBeNull();
  });

  it('expirada es null; en el borde exacto todavía vale', () => {
    const v = firmarSeleccion(TENANT, T0)!;
    expect(validarSeleccion(v, T0 + TTL_SELECCION_MS)).toBe(TENANT);
    expect(validarSeleccion(v, T0 + TTL_SELECCION_MS + 1)).toBeNull();
  });

  it('sin llave en el ambiente: no se firma NI se valida — fallar cerrado', () => {
    const v = firmarSeleccion(TENANT, T0)!;
    vi.stubEnv('LIKIDA_FLOTA_COOKIE_LLAVE', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(firmarSeleccion(TENANT, T0)).toBeNull();
    expect(validarSeleccion(v, T0 + 1000)).toBeNull();
  });

  it('basura, vacío y formatos truncos son null, no una excepción', () => {
    for (const raro of [undefined, '', 'v1', 'v1.solo-tenant', `v2.${TENANT}.123.abc`, 'a.b.c.d.e']) {
      expect(validarSeleccion(raro as string | undefined, T0)).toBeNull();
    }
  });
});

describe('la bitácora de la selección (best-effort)', () => {
  it('escribe actor, flota y si fue la demo', async () => {
    await anotarSeleccionEnBitacora('u-0', TENANT, false);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: TENANT,
      actor_id: 'u-0',
      accion: 'flota.seleccionada',
      entidad: 'tenant',
      entidad_id: TENANT,
      detalle: { desde: 'elegir-flota', demo: false },
    }));
  });

  it('un error POR VALOR de supabase-js no revienta — se loguea', async () => {
    insert.mockResolvedValueOnce({ data: null, error: { message: 'fetch failed' } });
    await expect(anotarSeleccionEnBitacora('u-0', TENANT, true)).resolves.toBeUndefined();
    expect(logs.warn).toHaveBeenCalledWith('seleccion_flota.bitacora_no_escribio',
      expect.objectContaining({ err: 'fetch failed' }));
  });

  it('una excepción tampoco revienta — la selección ya ocurrió', async () => {
    insert.mockRejectedValueOnce(new Error('base caída'));
    await expect(anotarSeleccionEnBitacora('u-0', TENANT, false)).resolves.toBeUndefined();
    expect(logs.warn).toHaveBeenCalledWith('seleccion_flota.bitacora_no_escribio',
      expect.objectContaining({ err: 'base caída' }));
  });
});

describe('destinoSeguro — el next del selector no es un open redirect', () => {
  it('rutas internas pasan tal cual', () => {
    expect(destinoSeguro('/dashboard')).toBe('/dashboard');
    expect(destinoSeguro('/dashboard/viajes')).toBe('/dashboard/viajes');
    expect(destinoSeguro('/cuenta')).toBe('/cuenta');
  });

  it('todo lo demás cae al default', () => {
    for (const malo of [undefined, null, 42, '', 'https://evil.com', '//evil.com', '/\\evil.com', '/a/../b', 'dashboard']) {
      expect(destinoSeguro(malo)).toBe('/dashboard');
    }
  });
});
