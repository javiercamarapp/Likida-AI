import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 — el resumen que ve el contador en Combustible & Casetas de
// cuánto del CFDI consolidado (monedero/TAG) conció solo contra cuánto le
// toca revisar a mano. Paginado con `traerTodo` (CLAUDE.md: PostgREST recorta
// en silencio a 1,000 filas), así que el mock respeta `range()` de verdad —
// el builder plano de `analytics.test.ts` NO sirve aquí: con `range` como
// no-op, `traerTodo` vería SIEMPRE la misma página completa y nunca cerraría.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = { estatus: string; cfdi_xml_id: string };

let filas: Fila[] = [];

function mockPaginado() {
  let pideConteo = false;
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = (_cols: string, opts?: { count?: string }) => { pideConteo = !!opts?.count; return b; };
  b.eq = self;
  b.order = self;
  b.range = (desde: number, hasta: number) => {
    const pagina = filas.slice(desde, hasta + 1);
    return Promise.resolve({ data: pagina, error: null, count: pideConteo ? filas.length : undefined });
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => mockPaginado() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const { getConciliacionConsolidado } = await import('./analytics');

describe('getConciliacionConsolidado', () => {
  beforeEach(() => { filas = []; });

  it('null cuando el tenant nunca mandó un consolidado (no es lo mismo que "0 pendientes")', async () => {
    expect(await getConciliacionConsolidado('t1')).toBeNull();
  });

  it('cuenta conciliadas vs por_conciliar, y cuántos CFDI distintos aportaron líneas', async () => {
    filas = [
      { estatus: 'conciliada', cfdi_xml_id: 'x1' },
      { estatus: 'conciliada', cfdi_xml_id: 'x1' },
      { estatus: 'por_conciliar', cfdi_xml_id: 'x1' },
      { estatus: 'por_conciliar', cfdi_xml_id: 'x2' },
    ];
    expect(await getConciliacionConsolidado('t1')).toEqual({ conciliadas: 2, porConciliar: 2, sinMatch: 0, cfdis: 2 });
  });

  it('todo conciliado: porConciliar en 0, no ausente', async () => {
    filas = [{ estatus: 'conciliada', cfdi_xml_id: 'x1' }];
    expect(await getConciliacionConsolidado('t1')).toEqual({ conciliadas: 1, porConciliar: 0, sinMatch: 0, cfdis: 1 });
  });

  // AUDITORÍA 10, la resolución a mano (5-ago-2026): `sin_match` es lo que
  // deja `resolverLineaAMano` (`intake/consolidado.ts`) cuando un humano YA
  // revisó la línea y ningún gasto capturado le corresponde. No es lo mismo
  // que `por_conciliar` —esa SÍ sigue pendiente de que alguien la mire— y
  // contarla ahí haría que "por revisar a mano" no bajara nunca aunque el
  // contador sí estuviera vaciando la cola.
  it('sin_match se cuenta aparte — no infla porConciliar ni se pierde', async () => {
    filas = [
      { estatus: 'conciliada', cfdi_xml_id: 'x1' },
      { estatus: 'por_conciliar', cfdi_xml_id: 'x1' },
      { estatus: 'sin_match', cfdi_xml_id: 'x1' },
      { estatus: 'sin_match', cfdi_xml_id: 'x2' },
    ];
    expect(await getConciliacionConsolidado('t1')).toEqual({ conciliadas: 1, porConciliar: 1, sinMatch: 2, cfdis: 2 });
  });

  it('pagina de verdad: más de 1,000 líneas no se recortan en silencio', async () => {
    filas = Array.from({ length: 1_200 }, (_, i) => ({
      estatus: i < 1_100 ? 'conciliada' : i < 1_150 ? 'por_conciliar' : 'sin_match',
      cfdi_xml_id: `x${i % 5}`,
    }));
    const r = await getConciliacionConsolidado('t1');
    expect(r).toEqual({ conciliadas: 1_100, porConciliar: 50, sinMatch: 50, cfdis: 5 });
  });
});
