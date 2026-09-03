import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 · ALTO (reauditoría) — LA BAJA CERRABA WHATSAPP Y DEJABA
// ABIERTO ESTE CORREO. Misma causa raíz exacta que AGEN-C1 (commit 24ce4c2,
// contactos.ts): `desactivarUsuario` (usuarios_escritura.ts:191) escribe
// `activo=false` y NO borra `app_user.email` — el correo se queda ahí para
// que `usuariosAvisables` lo siguiera encontrando.
//
// Tres consumidores vivos de esta función, ninguno protegido:
//   1. `repartoDe` (:926) → las alarmas de los agentes de la flota.
//   2. `portal_pago_aviso.ts` → el aviso de una propuesta de PAGO. Dinero.
//   3. `/dashboard/agentes` (seccion-notificaciones.tsx) → la pantalla que le
//      enseña a la flota A QUIÉN LE LLEGA, y que contradecía a
//      `/dashboard/usuarios` sobre la misma persona.
// ═══════════════════════════════════════════════════════════════════════════

const TABLAS: Record<string, unknown[]> = {};
let errorSiguiente: { message: string } | null = null;

function builder() {
  const b: Record<string, unknown> = {};
  // `or` entra con la ALTO de la reauditoría 25: el filtro de la baja va
  // también en la base. El doble devuelve la tabla entera igual que con los
  // demás encadenados (mismo patrón que `contactos.test.ts`), así que lo que
  // las pruebas de abajo ejercen es la capa de TS — que es donde vive la regla.
  for (const m of ['select', 'eq', 'order', 'limit', 'or']) b[m] = () => b;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({
    data: errorSiguiente ? null : (TABLAS.app_user ?? []), error: errorSiguiente,
  }).then(ok);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builder() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { usuariosAvisables } = await import('./notificaciones');

const u = (p: Record<string, unknown>) => ({ id: 'u-1', nombre: 'Marisol', email: 'marisol@despacho-anterior.mx', rol: 'contador', ...p });

beforeEach(() => { TABLAS.app_user = []; errorSiguiente = null; });

describe('ALTO (reauditoría 25) · usuariosAvisables respeta la baja', () => {
  it('una cuenta DADA DE BAJA no aparece entre las avisables', async () => {
    TABLAS.app_user = [u({ activo: false })];
    expect(await usuariosAvisables('t-1')).toEqual([]);
  });

  it('deja FUERA solo a la de baja: la cuenta viva del lado sí aparece', async () => {
    TABLAS.app_user = [
      u({ id: 'u-1', email: 'marisol@despacho-anterior.mx', activo: false }),
      u({ id: 'u-2', nombre: 'Contador nuevo', email: 'nuevo@despacho.mx', rol: 'contador', activo: true }),
    ];
    const r = await usuariosAvisables('t-1');
    expect(r.map((x) => x.id)).toEqual(['u-2']);
  });

  it('un `activo` ausente en la fila NO da de baja: solo el false explícito (base sin la 0294)', async () => {
    TABLAS.app_user = [u({})];
    const r = await usuariosAvisables('t-1');
    expect(r.map((x) => x.id)).toEqual(['u-1']);
  });

  it('un error de lectura SUBE, no se lee como "nadie avisable"', async () => {
    errorSiguiente = { message: 'timeout' };
    await expect(usuariosAvisables('t-1')).rejects.toThrow(/timeout/);
  });
});
