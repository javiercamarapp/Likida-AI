import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA OLA 1, #46 — ARCO DE UNA CUENTA DE OFICINA (titular sin operador).
//
// Antes: solicitud_arco con operador_id NULL; la RPC la rechazaba y /privacidad
// prometía el borrado de «datos de cuenta y de acceso». Ahora la solicitud lleva
// `titular_user_id`, la RPC (0442) cancela la cuenta y `ejecutarCancelacionArco`
// borra el LOGIN de Auth — y si no puede, lo DICE en vez de afirmarlo.
// ═══════════════════════════════════════════════════════════════════════════

const d = vi.hoisted(() => ({
  rpc: vi.fn(), enviar: vi.fn(), deleteUser: vi.fn(), updateUser: vi.fn(), insertados: [] as unknown[],
  solicitud: { titular_ref: '529999900001', tipo: 'cancelacion', titular_user_id: 'u-oficina' } as Record<string, unknown>,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => {
  const cadena: Record<string, unknown> = {
    select: () => cadena, eq: () => cadena,
    maybeSingle: async () => ({ data: d.solicitud, error: null }),
    insert: (fila: unknown) => { d.insertados.push(fila); return cadena; },
  };
  return {
    from: () => cadena, rpc: d.rpc,
    auth: { admin: { deleteUser: d.deleteUser, updateUserById: d.updateUser } },
  };
} }));
vi.mock('@/lib/meta/client', async (importar) => ({ ...await importar<typeof import('@/lib/meta/client')>(), enviarRespuestaArco: d.enviar }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ejecutarCancelacionArco, registrarSolicitudArco } from './repo';

beforeEach(() => {
  vi.clearAllMocks();
  d.insertados.length = 0;
  d.solicitud = { titular_ref: '529999900001', tipo: 'cancelacion', titular_user_id: 'u-oficina' };
  d.rpc.mockResolvedValue({ data: { ok: true, evidencia: {}, seudonimo: 'Usuario ABC123' }, error: null });
  d.enviar.mockResolvedValue({ ok: true });
  d.deleteUser.mockResolvedValue({ error: null });
  d.updateUser.mockResolvedValue({ error: null });
});

describe('ejecutarCancelacionArco — titular que es cuenta de oficina', () => {
  it('ejecuta la RPC, BORRA el login de Auth y avisa con el texto de cuenta (no el del operador)', async () => {
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r).toEqual({ ok: true, avisada: true });
    expect(d.rpc).toHaveBeenCalledWith('ejecutar_arco_cancelacion', { p_tenant: 't-1', p_solicitud: 's-1' });
    expect(d.deleteUser).toHaveBeenCalledWith('u-oficina');
    expect(d.updateUser).not.toHaveBeenCalled();
    const aviso = String(d.enviar.mock.calls[0][1]);
    expect(aviso).toMatch(/correo de cuenta/);
    expect(aviso).toMatch(/copiloto/);
    expect(aviso).toMatch(/bitácora de auditoría/);
    expect(aviso).not.toMatch(/identificador de operador|contacto de emergencia/);
  });

  it('si la RPC se niega (único dueño, ya cerrada…) NO borra el login ni manda aviso', async () => {
    d.rpc.mockResolvedValue({ data: { ok: false, motivo: 'es el único dueño activo de la flota: nombra a otro dueño antes de cancelar esta cuenta' }, error: null });
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/único dueño/);
    expect(d.deleteUser).not.toHaveBeenCalled();
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it('si Auth no puede borrar el login, lo DICE (errorAuth) y al menos lo banea', async () => {
    d.deleteUser.mockResolvedValue({ error: { message: 'auth caído' } });
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r.ok).toBe(true);
    expect(r.errorAuth).toBe('auth caído');
    expect(d.updateUser).toHaveBeenCalledWith('u-oficina', { ban_duration: '876000h' });
  });

  it('un Auth que LANZA tampoco tumba la ejecución ni se calla', async () => {
    d.deleteUser.mockRejectedValue(new Error('red'));
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r.ok).toBe(true);
    expect(r.errorAuth).toBe('red');
  });

  it('un titular operador (sin titular_user_id) NO toca Auth', async () => {
    d.solicitud = { titular_ref: '529999900001', tipo: 'cancelacion', titular_user_id: null };
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r).toEqual({ ok: true, avisada: true });
    expect(d.deleteUser).not.toHaveBeenCalled();
    expect(String(d.enviar.mock.calls[0][1])).toMatch(/identificador de operador/);
  });
});

describe('registrarSolicitudArco — quién es el titular', () => {
  it('una cuenta de oficina guarda titular_user_id (y operador_id NULL)', async () => {
    await registrarSolicitudArco({ tenantId: 't-1', operadorId: null, titularUserId: 'u-oficina', titularRef: '5299', tipo: 'cancelacion', canal: 'whatsapp' });
    expect(d.insertados[0]).toMatchObject({ tenant_id: 't-1', operador_id: null, titular_user_id: 'u-oficina' });
  });
  it('un operador NUNCA guarda titular_user_id, aunque lo manden (el titular es uno u otro)', async () => {
    await registrarSolicitudArco({ tenantId: 't-1', operadorId: 'op-1', titularUserId: 'u-x', titularRef: '5299', tipo: 'cancelacion', canal: 'whatsapp' });
    expect(d.insertados[0]).toMatchObject({ operador_id: 'op-1', titular_user_id: null });
  });
  it('sin ninguno de los dos queda NULL (ARCO de un número no identificado)', async () => {
    await registrarSolicitudArco({ tenantId: 't-1', operadorId: null, titularRef: '5299', tipo: 'acceso', canal: 'whatsapp' });
    expect(d.insertados[0]).toMatchObject({ operador_id: null, titular_user_id: null });
  });
});
