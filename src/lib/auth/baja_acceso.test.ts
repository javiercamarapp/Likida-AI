// Baja del personal de Likida (4b): los candados "nunca uno mismo" y "nunca el último superadmin", el interruptor apagado,
// el rechazo de cuentas de flota, la bitácora y el respaldo cuando la RPC de la migración 1000 no existe.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type R = { data?: unknown; error?: { message: string; code?: string } | null };
const h = vi.hoisted(() => ({
  lectura: { data: null, error: null } as R,
  rpc: { data: 'ok', error: null } as R,
  cuentas: [] as R[],
  updates: [] as R[],
  llamadasRpc: [] as string[],
  updatesPayload: [] as unknown[],
  bitacora: vi.fn(async () => true),
  ban: vi.fn(async () => ({ error: null })),
}));

vi.mock('@/lib/likida/presupuesto', () => ({ acotada: async (q: unknown) => q }));
vi.mock('@/lib/admin/acciones_riesgo', () => ({ anotarAccionAdmin: h.bitacora }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('./usuarios_escritura', () => ({ BAN_PERMANENTE: '876600h' }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      let op = 'select';
      let payload: unknown;
      const q: Record<string, unknown> = {};
      const cadena = () => q;
      for (const m of ['select', 'eq', 'neq', 'is', 'limit']) q[m] = cadena;
      q.update = (p: unknown) => { op = 'update'; payload = p; h.updatesPayload.push(p); return q; };
      q.maybeSingle = async () => h.lectura;
      q.then = (ok: (v: R) => unknown) => ok(op === 'update' ? (h.updates.shift() ?? { data: [{ id: 'x' }], error: null }) : (h.cuentas.shift() ?? { data: [], error: null }));
      void payload;
      return q;
    },
    rpc: async (nombre: string) => { h.llamadasRpc.push(nombre); return nombre === 'equipo_baja_personal_likida' ? h.rpc : { error: null }; },
    auth: { admin: { updateUserById: h.ban } },
  }),
}));

import { darDeBajaPersonalLikida, reactivarPersonalLikida } from './baja_acceso';

const U = '11111111-1111-4111-8111-111111111111';
const YO = '22222222-2222-4222-8222-222222222222';
const actor = { userId: YO, email: null };
const fila = (rol: string, over: Record<string, unknown> = {}) => ({ data: { id: U, rol, activo: true, tenant_id: null, ...over }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LIKIDA_BAJA_PERSONAL_LIKIDA = 'activo';
  h.lectura = fila('vendedor');
  h.rpc = { data: 'ok', error: null };
  h.cuentas = []; h.updates = []; h.llamadasRpc = []; h.updatesPayload = [];
});

describe('4b: baja del personal de Likida', () => {
  it('apagada por omisión: no toca nada', async () => {
    delete process.env.LIKIDA_BAJA_PERSONAL_LIKIDA;
    await expect(darDeBajaPersonalLikida(U, actor)).rejects.toThrow(/no está habilitado/);
    expect(h.llamadasRpc).toEqual([]);
  });
  it('nunca a uno mismo', async () => {
    await expect(darDeBajaPersonalLikida(YO, actor)).rejects.toThrow(/a ti mismo/);
    expect(h.llamadasRpc).toEqual([]);
  });
  it('rechaza cuentas de flota', async () => {
    h.lectura = fila('contador', { tenant_id: 't-1' });
    await expect(darDeBajaPersonalLikida(U, actor)).rejects.toThrow(/es de una flota/);
    h.lectura = fila('superadmin', { tenant_id: 't-1' });
    await expect(darDeBajaPersonalLikida(U, actor)).rejects.toThrow(/es de una flota/);
  });
  it('baja de vendedor por RPC: ban, sesiones y bitácora sin flota', async () => {
    const r = await darDeBajaPersonalLikida(U, actor);
    expect(r).toMatchObject({ rol: 'vendedor', sesionRevocada: true, bitacora: true, candado: 'rpc' });
    expect(h.ban).toHaveBeenCalledWith(U, { ban_duration: '876600h' });
    expect(h.llamadasRpc).toContain('revocar_sesiones_usuario');
    expect(h.bitacora).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null, accion: 'usuario.desactivado' }));
  });
  it('la base dice último superadmin: no hay ban ni bitácora', async () => {
    h.lectura = fila('superadmin');
    h.rpc = { data: 'ultimo_superadmin', error: null };
    await expect(darDeBajaPersonalLikida(U, actor)).rejects.toThrow(/único superadmin/);
    expect(h.ban).not.toHaveBeenCalled();
    expect(h.bitacora).not.toHaveBeenCalled();
  });
  it('respaldo sin migración: sin otro superadmin no escribe', async () => {
    h.lectura = fila('superadmin');
    h.rpc = { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } };
    h.cuentas = [{ data: [], error: null }];
    await expect(darDeBajaPersonalLikida(U, actor)).rejects.toThrow(/único superadmin/);
    expect(h.updatesPayload).toEqual([]);
  });
  it('respaldo sin migración: con otro superadmin da la baja', async () => {
    h.lectura = fila('superadmin');
    h.rpc = { data: null, error: { message: 'x', code: 'PGRST202' } };
    h.cuentas = [{ data: [{ id: 'otro' }], error: null }, { data: [{ id: 'otro' }], error: null }];
    const r = await darDeBajaPersonalLikida(U, actor);
    expect(r.candado).toBe('aplicacion');
  });
  it('respaldo: si el recuento posterior queda en cero, revierte su propia baja', async () => {
    h.lectura = fila('superadmin');
    h.rpc = { data: null, error: { message: 'x', code: 'PGRST202' } };
    h.cuentas = [{ data: [{ id: 'otro' }], error: null }, { data: [], error: null }];
    await expect(darDeBajaPersonalLikida(U, actor)).rejects.toThrow(/único superadmin/);
    expect(h.updatesPayload.at(-1)).toMatchObject({ activo: true, desactivado_en: null });
  });
  it('un error real de la RPC no se confunde con "no existe"', async () => {
    h.rpc = { data: null, error: { message: 'boom' } };
    await expect(darDeBajaPersonalLikida(U, actor)).rejects.toThrow(/baja_acceso.rpc/);
  });
  it('reactiva y quita el ban', async () => {
    h.lectura = fila('vendedor', { activo: false });
    const r = await reactivarPersonalLikida(U, actor);
    expect(r.accesoRestaurado).toBe(true);
    expect(h.ban).toHaveBeenCalledWith(U, { ban_duration: 'none' });
  });
});
