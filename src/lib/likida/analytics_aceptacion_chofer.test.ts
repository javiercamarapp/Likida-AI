import { describe, it, expect, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-06 · El tiempo de aceptación del chofer NO cuenta los viajes importados.
//
// La importación escribe `aceptado_en` (con `avisado_en` = ese mismo instante)
// para que el motor persiga el viaje; eso NO es que el chofer dijo que sí. Si
// entraran a la media, 5 importados con latencia 0 jalarían de 10 min a 3.75.
// Datos 100 % sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

let filasBase: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const nodo: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'order', 'limit']) nodo[m] = () => nodo;
      nodo.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: filasBase, error: null }).then(r);
      return nodo;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { tiempoAceptacionChofer, getEventosConductores, getTiempoAceptacionChofer } = await import('./analytics');

const T0 = Date.parse('2026-10-01T10:00:00.000Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const delChofer = (latenciaMin: number) =>
  ({ avisado_en: iso(0), aceptado_en: iso(latenciaMin), aceptado_origen: 'chofer' });
const importado = () => ({ avisado_en: iso(5), aceptado_en: iso(5), aceptado_origen: 'importacion' });

describe('tiempoAceptacionChofer — excluye importados', () => {
  it('3 aceptados por el chofer (4, 10, 16 min) + 5 importados (0 min) → media exacta de 10 min, no 3.75', () => {
    const filas = [delChofer(4), delChofer(10), delChofer(16), ...Array.from({ length: 5 }, importado)];
    const r = tiempoAceptacionChofer(filas);
    expect(r.minutos).toBe(10);
    expect(r.n).toBe(3);
    expect(r.excluidosImportados).toBe(5);
    // Contraprueba: sin el filtro saldría 30/8 = 3.75.
    const sinFiltro = filas.map((f) => ({ ...f, aceptado_origen: null }));
    expect(tiempoAceptacionChofer(sinFiltro).minutos).toBe(3.75);
  });

  it('filas viejas sin origen (null) cuentan como aceptadas por el chofer', () => {
    const r = tiempoAceptacionChofer([{ avisado_en: iso(0), aceptado_en: iso(6), aceptado_origen: null }]);
    expect(r).toEqual({ minutos: 6, n: 1, excluidosImportados: 0 });
  });

  it('solo importados → null (no un 0 que se lea como medición)', () => {
    const r = tiempoAceptacionChofer([importado(), importado()]);
    expect(r.minutos).toBeNull();
    expect(r.n).toBe(0);
  });

  it('sin avisado_en o con latencia negativa no se mide', () => {
    const r = tiempoAceptacionChofer([
      { avisado_en: null, aceptado_en: iso(3), aceptado_origen: 'oficina' },
      { avisado_en: iso(10), aceptado_en: iso(2), aceptado_origen: 'chofer' },
    ]);
    expect(r.minutos).toBeNull();
  });
});

describe('getEventosConductores — la aceptación importada se rotula aparte', () => {
  it('un aceptado_en de importación sale como «en_seguimiento_importado», no como «acepto»', async () => {
    filasBase = [
      { folio: 'F-1', id: 'v1', avisado_en: iso(0), aceptado_en: iso(4), aceptado_origen: 'chofer', operador: { nombre: 'Op A' } },
      { folio: 'F-2', id: 'v2', avisado_en: null, aceptado_en: iso(5), aceptado_origen: 'importacion', operador: { nombre: 'Op B' } },
    ];
    const ev = await getEventosConductores('t1');
    expect(ev.find((e) => e.folio === 'F-1' && e.tipo === 'acepto')).toBeDefined();
    expect(ev.find((e) => e.folio === 'F-2' && e.tipo === 'acepto')).toBeUndefined();
    expect(ev.find((e) => e.folio === 'F-2' && e.tipo === 'en_seguimiento_importado')).toBeDefined();
  });
});

describe('getTiempoAceptacionChofer — la consulta que alimenta la tarjeta', () => {
  it('lee de la base 3 del chofer (4, 10, 16) y 5 importados → 10 min, n=3, 5 excluidos', async () => {
    filasBase = [delChofer(4), delChofer(10), delChofer(16), ...Array.from({ length: 5 }, importado)];
    const r = await getTiempoAceptacionChofer('t1');
    expect(r).toEqual({ minutos: 10, n: 3, excluidosImportados: 5 });
  });
});
