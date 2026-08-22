import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rpcFalso0150, type Tablas } from './analytics_rpc_0150.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10 — el resumen que ve el contador en Combustible & Casetas de
// cuánto del CFDI consolidado (monedero/TAG) conció solo contra cuánto le
// toca revisar a mano.
//
// ESCALA 50k (mig. 0150): antes paginaba TODAS las líneas con `traerTodo`;
// ahora son tres conteos en `conciliacion_consolidado_tenant`. El mock es el
// Postgres falso de la 0150 sobre las mismas filas.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = { estatus: string; cfdi_xml_id: string };

const TABLAS: Tablas = {};
/** Respuesta forzada de la RPC (forma inesperada / error) — `null` = la del Postgres falso. */
let forzada: { data: unknown; error: { message: string } | null } | null = null;
const sembrar = (filas: Fila[]) => { TABLAS.cfdi_consolidado_linea = filas.map((f) => ({ tenant_id: 't1', ...f })); };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) =>
      Promise.resolve(forzada ?? rpcFalso0150(fn, args, TABLAS) ?? { data: null, error: null }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const { getConciliacionConsolidado } = await import('./analytics');

describe('getConciliacionConsolidado', () => {
  beforeEach(() => { sembrar([]); forzada = null; });

  it('null cuando el tenant nunca mandó un consolidado (no es lo mismo que "0 pendientes")', async () => {
    expect(await getConciliacionConsolidado('t1')).toBeNull();
  });

  it('cuenta conciliadas vs por_conciliar, y cuántos CFDI distintos aportaron líneas', async () => {
    sembrar([
      { estatus: 'conciliada', cfdi_xml_id: 'x1' },
      { estatus: 'conciliada', cfdi_xml_id: 'x1' },
      { estatus: 'por_conciliar', cfdi_xml_id: 'x1' },
      { estatus: 'por_conciliar', cfdi_xml_id: 'x2' },
    ]);
    expect(await getConciliacionConsolidado('t1')).toEqual({ conciliadas: 2, porConciliar: 2, sinMatch: 0, cfdis: 2 });
  });

  it('todo conciliado: porConciliar en 0, no ausente', async () => {
    sembrar([{ estatus: 'conciliada', cfdi_xml_id: 'x1' }]);
    expect(await getConciliacionConsolidado('t1')).toEqual({ conciliadas: 1, porConciliar: 0, sinMatch: 0, cfdis: 1 });
  });

  // AUDITORÍA 10, la resolución a mano (5-ago-2026): `sin_match` es lo que
  // deja `resolverLineaAMano` (`intake/consolidado.ts`) cuando un humano YA
  // revisó la línea y ningún gasto capturado le corresponde. No es lo mismo
  // que `por_conciliar` —esa SÍ sigue pendiente de que alguien la mire— y
  // contarla ahí haría que "por revisar a mano" no bajara nunca aunque el
  // contador sí estuviera vaciando la cola.
  it('sin_match se cuenta aparte — no infla porConciliar ni se pierde', async () => {
    sembrar([
      { estatus: 'conciliada', cfdi_xml_id: 'x1' },
      { estatus: 'por_conciliar', cfdi_xml_id: 'x1' },
      { estatus: 'sin_match', cfdi_xml_id: 'x1' },
      { estatus: 'sin_match', cfdi_xml_id: 'x2' },
    ]);
    expect(await getConciliacionConsolidado('t1')).toEqual({ conciliadas: 1, porConciliar: 1, sinMatch: 2, cfdis: 2 });
  });

  it('más de 1,000 líneas no se recortan: son conteos en SQL, no filas traídas', async () => {
    sembrar(Array.from({ length: 1_200 }, (_, i) => ({
      estatus: i < 1_100 ? 'conciliada' : i < 1_150 ? 'por_conciliar' : 'sin_match',
      cfdi_xml_id: `x${i % 5}`,
    })));
    const r = await getConciliacionConsolidado('t1');
    expect(r).toEqual({ conciliadas: 1_100, porConciliar: 50, sinMatch: 50, cfdis: 5 });
  });

  it('una forma inesperada de la RPC LANZA, no se lee como "nunca mandó un consolidado"', async () => {
    forzada = { data: { total: 'tres' }, error: null };
    await expect(getConciliacionConsolidado('t1')).rejects.toThrow(/otra forma/);
  });

  it('un error de la base LANZA', async () => {
    forzada = { data: null, error: { message: 'fetch failed' } };
    await expect(getConciliacionConsolidado('t1')).rejects.toThrow(/fetch failed/);
  });
});
