import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-S56-06: `regla_disparo.evidencia` guarda el nombre del operador en texto
// plano («<nombre> lleva N viajes sin liquidar») y la cancelación ARCO no la
// alcanzaba. Sin migración: tras la RPC, el código reemplaza la evidencia que
// cite al operador (por objeto_id o por su nombre), conservando el sello.

type Op = [string, ...unknown[]];
const d = vi.hoisted(() => ({
  rpc: vi.fn(), enviar: vi.fn(),
  llamadas: [] as Array<{ tabla: string; ops: Array<[string, ...unknown[]]> }>,
  solicitud: null as Record<string, unknown> | null,
  operador: null as Record<string, unknown> | null,
  falla: false,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({
  rpc: d.rpc,
  auth: { admin: { deleteUser: vi.fn(), updateUserById: vi.fn() } },
  from: (tabla: string) => {
    const ll = { tabla, ops: [] as Op[] };
    d.llamadas.push(ll);
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'update', 'eq', 'in', 'is', 'neq', 'ilike', 'order', 'limit']) b[m] = (...a: unknown[]) => { ll.ops.push([m, ...a]); return b; };
    b.maybeSingle = async () => ({ data: tabla === 'operador' ? d.operador : d.solicitud, error: null });
    b.then = (res: (v: unknown) => unknown) => {
      if (d.falla && tabla === 'regla_disparo') return res({ data: null, error: { message: 'caído' } });
      return res({ data: [], error: null });
    };
    return b;
  },
}) }));
vi.mock('@/lib/meta/client', async (importar) => ({ ...await importar<typeof import('@/lib/meta/client')>(), enviarRespuestaArco: d.enviar }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ejecutarCancelacionArco } from './repo';

beforeEach(() => {
  vi.clearAllMocks();
  d.llamadas.length = 0;
  d.falla = false;
  d.solicitud = { titular_ref: '5299', tipo: 'cancelacion', titular_user_id: null, operador_id: 'op-1' };
  d.operador = { nombre: 'Operador Sintetico' };
  d.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  d.enviar.mockResolvedValue({ ok: true });
});

const updates = () => d.llamadas.filter((l) => l.tabla === 'regla_disparo' && l.ops.some((o) => o[0] === 'update'));

describe('ejecutarCancelacionArco — evidencia de reglas (A37-S56-06)', () => {
  it('anonimiza la evidencia de las filas del operador y las que citan su nombre, sin borrar el sello', async () => {
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r.ok).toBe(true);
    const ups = updates();
    expect(ups).toHaveLength(2);
    for (const u of ups) {
      const set = u.ops.find((o) => o[0] === 'update')![1] as Record<string, unknown>;
      expect(Object.keys(set)).toEqual(['evidencia']);
      expect(String(set.evidencia)).not.toContain('Sintetico');
      expect(u.ops).toContainEqual(['eq', 'tenant_id', 't-1']);
    }
    expect(ups[0].ops).toContainEqual(['eq', 'objeto', 'operador']);
    expect(ups[0].ops).toContainEqual(['eq', 'objeto_id', 'op-1']);
    expect(ups[1].ops).toContainEqual(['ilike', 'evidencia', '%Operador Sintetico%']);
  });

  it('escapa % y _ del nombre en el patrón', async () => {
    d.operador = { nombre: '100%_Raro' };
    await ejecutarCancelacionArco('t-1', 's-1');
    expect(updates()[1].ops).toContainEqual(['ilike', 'evidencia', '%100\\%\\_Raro%']);
  });

  it('si la RPC se niega no toca la evidencia', async () => {
    d.rpc.mockResolvedValue({ data: { ok: false, motivo: 'ya cerrada' }, error: null });
    await ejecutarCancelacionArco('t-1', 's-1');
    expect(updates()).toHaveLength(0);
  });

  it('un titular de oficina (sin operador_id) no la toca', async () => {
    d.solicitud = { titular_ref: '5299', tipo: 'cancelacion', titular_user_id: 'u-1', operador_id: null };
    await ejecutarCancelacionArco('t-1', 's-1');
    expect(updates()).toHaveLength(0);
  });

  it('si falla, la cancelación sigue ok pero lo DICE (errorEvidencia)', async () => {
    d.falla = true;
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r.ok).toBe(true);
    expect(r.errorEvidencia).toMatch(/caído/);
  });
});
