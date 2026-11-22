import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// A58-LEG-01 [CRÍTICO] — LA CANCELACIÓN AFIRMABA QUE "SE QUITÓ TU FOTO" Y LA
// FOTO SEGUÍA SIENDO PÚBLICA.
//
// El bucket `avatares` se creó PÚBLICO (0046:18) y la ruta se deriva del uuid
// del usuario, no de la columna: `<userId>/avatar.<ext>`. La RPC
// `ejecutar_arco_cancelacion` pone `app_user.avatar_url = null` (0902:327) y
// nada más — Storage no tiene columnas. Pero el aviso que sale por WhatsApp
// (repo.ts) y la `resolucion` que queda como constancia (0902:335) dicen
// literal «se quitó tu teléfono y tu foto», así que un `GET` a
// `…/object/public/avatares/<userId>/avatar.jpg` seguía devolviendo la cara
// del titular después de una cancelación consumada.
//
// Mismo molde de fallar-cerrado-y-decirlo que ya usan `errorEntregas`
// (A36-R03-03) y `errorAuth` (0442): el borrado va ANTES del aviso y, si no se
// puede, se DICE en `errorAvatar` en vez de afirmar un borrado que no ocurrió.
// ═══════════════════════════════════════════════════════════════════════════

const d = vi.hoisted(() => ({
  rpc: vi.fn(), enviar: vi.fn(), deleteUser: vi.fn(), updateUser: vi.fn(),
  remove: vi.fn(), bucketsUsados: [] as string[],
  solicitud: { titular_ref: '529999900001', tipo: 'cancelacion', titular_user_id: 'u-oficina' } as Record<string, unknown>,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => {
  const cadena: Record<string, unknown> = {
    select: () => cadena, eq: () => cadena, in: () => cadena,
    order: () => cadena, limit: () => cadena,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res, rej),
    maybeSingle: async () => ({ data: d.solicitud, error: null }),
    insert: () => cadena,
  };
  return {
    from: () => cadena, rpc: d.rpc,
    auth: { admin: { deleteUser: d.deleteUser, updateUserById: d.updateUser } },
    storage: { from: (b: string) => { d.bucketsUsados.push(b); return { remove: d.remove }; } },
  };
} }));
vi.mock('@/lib/meta/client', async (importar) => ({ ...await importar<typeof import('@/lib/meta/client')>(), enviarRespuestaArco: d.enviar }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ejecutarCancelacionArco } from './repo';

beforeEach(() => {
  vi.clearAllMocks();
  d.bucketsUsados.length = 0;
  d.solicitud = { titular_ref: '529999900001', tipo: 'cancelacion', titular_user_id: 'u-oficina' };
  d.rpc.mockResolvedValue({ data: { ok: true, evidencia: {}, seudonimo: 'Usuario ABC123' }, error: null });
  d.enviar.mockResolvedValue({ ok: true });
  d.deleteUser.mockResolvedValue({ error: null });
  d.updateUser.mockResolvedValue({ error: null });
  d.remove.mockResolvedValue({ error: null });
});

describe('A58-LEG-01 — la foto se BORRA de Storage, no solo la columna', () => {
  it('borra el objeto del bucket público en TODAS las extensiones del titular', async () => {
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r).toEqual({ ok: true, avisada: true });
    // El aviso afirma que se quitó la foto…
    expect(String(d.enviar.mock.calls[0][1])).toMatch(/se quitó tu teléfono y tu foto/);
    // …así que el objeto tuvo que salir del bucket PÚBLICO, por uuid y no por columna.
    expect(d.bucketsUsados).toContain('avatares');
    expect(d.remove).toHaveBeenCalledWith(
      expect.arrayContaining(['u-oficina/avatar.jpg', 'u-oficina/avatar.png', 'u-oficina/avatar.webp']),
    );
  });

  it('el borrado va ANTES del aviso: no se afirma una foto quitada que no se quitó', async () => {
    const orden: string[] = [];
    d.remove.mockImplementation(async () => { orden.push('remove'); return { error: null }; });
    d.enviar.mockImplementation(async () => { orden.push('aviso'); return { ok: true }; });
    await ejecutarCancelacionArco('t-1', 's-1');
    expect(orden).toEqual(['remove', 'aviso']);
  });

  it('si Storage no puede borrar, lo DICE en errorAvatar (no se calla)', async () => {
    d.remove.mockResolvedValue({ error: { message: 'storage caído' } });
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r.ok).toBe(true);
    expect(r.errorAvatar).toBe('storage caído');
  });

  it('un Storage que LANZA tampoco tumba la cancelación ya ejecutada', async () => {
    d.remove.mockRejectedValue(new Error('red'));
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r.ok).toBe(true);
    expect(r.errorAvatar).toBe('red');
  });

  it('un titular OPERADOR (sin titular_user_id) no tiene avatar de cuenta que borrar', async () => {
    d.solicitud = { titular_ref: '529999900001', tipo: 'cancelacion', titular_user_id: null };
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r).toEqual({ ok: true, avisada: true });
    expect(d.remove).not.toHaveBeenCalled();
  });
});
