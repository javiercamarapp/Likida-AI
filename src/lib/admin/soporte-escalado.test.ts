import { beforeEach, describe, expect, it, vi } from 'vitest';

type Resp = { data: unknown; error: { message: string } | null };
const resp: { actual: Resp } = { actual: { data: [], error: null } };
const llamadas: Array<[string, ...unknown[]]> = [];
function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) b[m] = (...a: unknown[]) => { llamadas.push([m, ...a]); return b; };
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resp.actual).then(ok, fail);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => builder() }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { avisosDeSlaPorTicket } = await import('./soporte-escalado');
beforeEach(() => { resp.actual = { data: [], error: null }; llamadas.length = 0; });

describe('avisosDeSlaPorTicket', () => {
  it('sin tickets no consulta nada', async () => {
    expect(await avisosDeSlaPorTicket([])).toEqual(new Map());
    expect(llamadas).toEqual([]);
  });
  it('lee SOLO el aviso de SLA vencido y se queda con el último por ticket', async () => {
    resp.actual = { data: [{ entidad_id: 't1', ocurrio_en: '2026-11-09T10:00:00Z' }, { entidad_id: 't1', ocurrio_en: '2026-11-08T10:00:00Z' }], error: null };
    const r = await avisosDeSlaPorTicket(['t1', 't2']);
    expect(llamadas).toContainEqual(['eq', 'accion', 'soporte.aviso_sla_vencido']);
    expect([...r!.entries()]).toEqual([['t1', '2026-11-09T10:00:00Z']]);
  });
  it('una lectura caída devuelve null (sin dato), NO un mapa vacío que diría «sin aviso»', async () => {
    resp.actual = { data: null, error: { message: 'caída' } };
    expect(await avisosDeSlaPorTicket(['t1'])).toBeNull();
  });
});
