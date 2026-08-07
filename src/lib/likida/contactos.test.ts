// ═══════════════════════════════════════════════════════════════════════════
// COBERTURA (ronda 16): contactos.ts estaba a 28% — la resolución de la cuenta
// de oficina por teléfono (el "no te tengo registrado" vs la ambigüedad real).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const TABLAS: Record<string, unknown[]> = {};
let errorSiguiente: { message: string } | null = null;

function builder() {
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'in', 'limit', 'eq', 'not']) b[m] = self;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({
    data: errorSiguiente ? null : (TABLAS.app_user ?? []), error: errorSiguiente,
  }).then(ok);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builder() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { resolverCuentaOficina, TelefonoAmbiguo, telefonoJefeDe } = await import('./contactos');

beforeEach(() => { TABLAS.app_user = []; errorSiguiente = null; });

describe('resolverCuentaOficina — quién es el teléfono', () => {
  const u = (p: Record<string, unknown>) => ({ id: 'u-1', tenant_id: 't-1', rol: 'encargado', nombre: 'Ana', email: 'ana@x.mx', telefono: '529991234567', ...p });

  it('resuelve la cuenta cuando el teléfono coincide', async () => {
    TABLAS.app_user = [u({})];
    const r = await resolverCuentaOficina('529991234567');
    expect(r).toMatchObject({ userId: 'u-1', tenantId: 't-1', rol: 'encargado', nombre: 'Ana' });
  });

  it('null cuando no hay nadie (no es un error: es "no te conozco")', async () => {
    expect(await resolverCuentaOficina('529999999999')).toBeNull();
  });

  it('LANZA TelefonoAmbiguo con dos cuentas (el teléfono de un chofer y de un admin)', async () => {
    TABLAS.app_user = [u({ id: 'u-1' }), u({ id: 'u-2', rol: 'flota_admin' })];
    await expect(resolverCuentaOficina('529991234567')).rejects.toThrow(TelefonoAmbiguo);
  });

  it('LANZA si la base falló (no se afirma "no existe")', async () => {
    errorSiguiente = { message: 'fetch failed' };
    await expect(resolverCuentaOficina('529991234567')).rejects.toThrow(/fetch failed/);
  });

  it('telefonoJefeDe devuelve null sin jefe asignado', async () => {
    expect(await telefonoJefeDe('t-1')).toBeNull();
  });
});
