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
  // `or` entra con AGEN-1: el filtro de la baja va también en la base. El doble
  // devuelve la tabla entera igual que con los demás encadenados, así que lo que
  // las pruebas de abajo ejercen es la capa de TS — que es donde vive la regla.
  for (const m of ['select', 'in', 'limit', 'eq', 'not', 'or']) b[m] = self;
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

  // ═════════════════════════════════════════════════════════════════════════
  // AUDITORÍA 24 · AGEN-1 — LA BAJA CERRABA EL PANEL Y DEJABA ABIERTO WHATSAPP.
  //
  // La 0294 (SEG-1) le enseñó a la base a dar de baja: `app_user.activo`.
  // `desactivarUsuario` escribe `activo=false`, pone sello, deja bitácora y
  // BANEA la cuenta en Auth. `session.ts:99` la respeta y devuelve `null`.
  //
  // Pero WhatsApp no entra por Auth ni por `session.ts`: entra por
  // `resolverCuentaOficina`, y su `select` no pedía `activo`. O sea que al
  // contador al que la flota le quitó el acceso el viernes le seguía
  // contestando el bot el lunes — y por ese mismo camino pasan los comandos de
  // administración por WhatsApp (`admin_comandos_wa.ts:45`, que declara
  // explícitamente que delega la autenticación en esta función).
  //
  // Escenario medido: `activo=false` y teléfono 529991234567 → antes devolvía
  // la cuenta con rol `flota_admin`; ahora devuelve `null`, que es como esta
  // capa nombra «no te conozco».
  //
  // Solo el `false` EXPLÍCITO da de baja, igual que en `session.ts:99`: una
  // fila sin la columna (base sin la 0294) sigue entrando. La columna nueva no
  // puede dejar fuera a toda la base.
  // ═════════════════════════════════════════════════════════════════════════
  it('una cuenta dada de baja (activo=false) es "no te conozco" también por WhatsApp', async () => {
    TABLAS.app_user = [u({ rol: 'flota_admin', activo: false })];
    expect(await resolverCuentaOficina('529991234567')).toBeNull();
  });

  it('activo=true entra igual que antes', async () => {
    TABLAS.app_user = [u({ activo: true })];
    expect(await resolverCuentaOficina('529991234567')).toMatchObject({ userId: 'u-1' });
  });

  it('la columna ausente (base sin la 0294) NO da de baja a nadie', async () => {
    TABLAS.app_user = [u({})];
    expect(await resolverCuentaOficina('529991234567')).toMatchObject({ userId: 'u-1' });
  });

  it('la ambigüedad se juzga sobre las cuentas VIVAS: una de baja no la provoca', async () => {
    // Si la de baja siguiera contando, dar de baja a alguien rompería el
    // teléfono de quien se quedó: `TelefonoAmbiguo` en vez de su cuenta.
    TABLAS.app_user = [u({ id: 'u-1' }), u({ id: 'u-2', rol: 'flota_admin', activo: false })];
    expect(await resolverCuentaOficina('529991234567')).toMatchObject({ userId: 'u-1' });
  });

  it('telefonoJefeDe devuelve null sin jefe asignado', async () => {
    expect(await telefonoJefeDe('t-1')).toBeNull();
  });
});
