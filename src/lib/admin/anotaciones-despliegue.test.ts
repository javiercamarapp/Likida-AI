import { beforeEach, describe, expect, it, vi } from 'vitest';

let resp: { data?: unknown[] | null; error: { message: string } | null } = { error: null, data: [] };
const llamadas: Array<[string, unknown[]]> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      llamadas.push(['from', [t]]);
      const api: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'eq', 'order', 'limit']) {
        api[m] = (...a: unknown[]) => { llamadas.push([m, a]); return api; };
      }
      (api as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error }).then(res);
      return api;
    },
  }),
}));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => Date.parse('2026-11-10T12:00:00.000Z') }));

const { anotacionDeFila, anotacionesEnRango, getAnotacionesDespliegue, NOTA_RELOJ } = await import('./anotaciones-despliegue');

beforeEach(() => { resp = { error: null, data: [] }; llamadas.length = 0; });

const fila = (sha: string, t: string, extra: Record<string, unknown> = {}) =>
  ({ sha, entorno: 'production', rama: 'master', primera_vista: t, vistas: 3, ...extra });

describe('anotacionDeFila', () => {
  it('etiqueta como «primera vista», no como hora de despliegue', () => {
    const a = anotacionDeFila(fila('ABCDEF1234567', '2026-11-09T10:00:00.000Z'))!;
    expect(a.shaCorto).toBe('abcdef1');
    expect(a.etiqueta).toBe('abcdef1 · production · master (primera vista)');
  });
  it('rama ausente no se rellena con master', () => {
    const a = anotacionDeFila(fila('abcdef1', '2026-11-09T10:00:00.000Z', { rama: null }))!;
    expect(a.rama).toBeNull();
    expect(a.etiqueta).not.toMatch(/master/);
  });
  it('filas incoherentes se omiten', () => {
    expect(anotacionDeFila(fila('zz', '2026-11-09T10:00:00.000Z'))).toBeNull();
    expect(anotacionDeFila(fila('abcdef1', 'no-es-fecha'))).toBeNull();
    expect(anotacionDeFila({})).toBeNull();
  });
});

describe('anotacionesEnRango', () => {
  it('filtra al rango y ordena de antigua a reciente', () => {
    const as = [
      anotacionDeFila(fila('aaaaaaa', '2026-11-09T00:00:00.000Z'))!,
      anotacionDeFila(fila('bbbbbbb', '2026-11-05T00:00:00.000Z'))!,
      anotacionDeFila(fila('ccccccc', '2026-10-01T00:00:00.000Z'))!,
    ];
    const r = anotacionesEnRango(as, Date.parse('2026-11-01T00:00:00.000Z'), Date.parse('2026-11-10T00:00:00.000Z'));
    expect(r.map((a) => a.shaCorto)).toEqual(['bbbbbbb', 'aaaaaaa']);
  });
});

describe('getAnotacionesDespliegue', () => {
  it('con filas: ok, con la advertencia del reloj', async () => {
    resp = { error: null, data: [fila('abcdef1', '2026-11-09T10:00:00.000Z')] };
    const r = await getAnotacionesDespliegue({ entorno: 'production' });
    expect(r).toMatchObject({ estado: 'ok', nota: NOTA_RELOJ });
    expect(r.anotaciones).toHaveLength(1);
    expect(llamadas).toContainEqual(['eq', ['entorno', 'production']]);
  });
  it('sin filas: «No medido», no cero despliegues', async () => {
    const r = await getAnotacionesDespliegue();
    expect(r.estado).toBe('no_medido');
    expect(r.nota).toMatch(/^No medido/);
  });
  it('error de la base: error declarado, distinto de no_medido', async () => {
    resp = { error: { message: 'tabla caída' }, data: null };
    const r = await getAnotacionesDespliegue();
    expect(r.estado).toBe('error');
    expect(r.nota).toMatch(/tabla caída/);
  });
  it('si todas las filas son ilegibles: no_medido', async () => {
    resp = { error: null, data: [{ sha: 'x' }] };
    expect((await getAnotacionesDespliegue()).estado).toBe('no_medido');
  });
});
