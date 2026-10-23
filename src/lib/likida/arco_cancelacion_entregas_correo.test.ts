import { beforeEach, describe, expect, it, vi } from 'vitest';

// A36-R03-03: la cancelación ARCO de un operador no tocaba
// `liquidacion_entrega_correo`; las entregas `pendiente`/`enviando` seguían
// saliendo a su correo ya «cancelado». Sin migración: el código existente las
// pasa a `omitida` con el motivo, acotado a rol operador, a SUS liquidaciones.

type Op = [string, ...unknown[]];
const d = vi.hoisted(() => ({
  rpc: vi.fn(), enviar: vi.fn(),
  llamadas: [] as Array<{ tabla: string; ops: Array<[string, ...unknown[]]> }>,
  solicitud: null as Record<string, unknown> | null,
  liquidaciones: [{ id: 'liq-1' }, { id: 'liq-2' }] as unknown[],
  omitidas: [{ id: 'e-1' }] as unknown[],
  falla: false,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({
  rpc: d.rpc,
  auth: { admin: { deleteUser: vi.fn(), updateUserById: vi.fn() } },
  from: (tabla: string) => {
    const ll = { tabla, ops: [] as Op[] };
    d.llamadas.push(ll);
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'update', 'eq', 'in', 'is', 'limit']) b[m] = (...a: unknown[]) => { ll.ops.push([m, ...a]); return b; };
    b.maybeSingle = async () => ({ data: d.solicitud, error: null });
    b.then = (res: (v: unknown) => unknown) => {
      if (d.falla && tabla === 'liquidacion_entrega_correo') return res({ data: null, error: { message: 'caído' } });
      const esUpdate = ll.ops.some((o) => o[0] === 'update');
      return res({ data: tabla === 'liquidacion_externa' ? d.liquidaciones : esUpdate ? d.omitidas : [], error: null });
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
  d.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  d.enviar.mockResolvedValue({ ok: true });
});

const actualizacion = () => d.llamadas.find((l) => l.tabla === 'liquidacion_entrega_correo' && l.ops.some((o) => o[0] === 'update'));

describe('ejecutarCancelacionArco — entregas de liquidación por correo (A36-R03-03)', () => {
  it('omite las entregas pendientes/enviando del operador cancelado, solo rol operador y solo de sus liquidaciones', async () => {
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r.ok).toBe(true);
    const up = actualizacion();
    expect(up).toBeDefined();
    const ops = up!.ops;
    expect(ops.find((o) => o[0] === 'update')![1]).toMatchObject({ estado: 'omitida', claim_token: null, claim_expira_en: null });
    expect(ops).toContainEqual(['eq', 'tenant_id', 't-1']);
    expect(ops).toContainEqual(['eq', 'rol', 'operador']);
    expect(ops).toContainEqual(['in', 'estado', ['pendiente', 'enviando']]);
    expect(ops).toContainEqual(['in', 'liquidacion_externa_id', ['liq-1', 'liq-2']]);
    const lect = d.llamadas.find((l) => l.tabla === 'liquidacion_externa');
    expect(lect!.ops).toContainEqual(['eq', 'operador_id', 'op-1']);
    expect(lect!.ops).toContainEqual(['eq', 'tenant_id', 't-1']);
  });

  it('si la RPC se niega NO toca las entregas', async () => {
    d.rpc.mockResolvedValue({ data: { ok: false, motivo: 'ya cerrada' }, error: null });
    await ejecutarCancelacionArco('t-1', 's-1');
    expect(actualizacion()).toBeUndefined();
  });

  it('un titular de oficina (sin operador_id) no toca entregas', async () => {
    d.solicitud = { titular_ref: '5299', tipo: 'cancelacion', titular_user_id: 'u-1', operador_id: null };
    await ejecutarCancelacionArco('t-1', 's-1');
    expect(actualizacion()).toBeUndefined();
  });

  it('si omitirlas falla, la cancelación sigue ok pero lo DICE (errorEntregas)', async () => {
    d.falla = true;
    const r = await ejecutarCancelacionArco('t-1', 's-1');
    expect(r.ok).toBe(true);
    expect(r.errorEntregas).toMatch(/caído/);
  });
});
