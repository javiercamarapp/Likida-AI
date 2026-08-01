import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO REINCIDENTE — PostgREST recorta en silencio a `max_rows`
// (1,000 por default) sin avisar: no lanza, no loguea, simplemente devuelve
// menos filas. `detectarAnomalias` (el detector de fraude entre viajes) veía
// cada vez menos datos según crecía el tenant, y el panel no tenía forma de
// saber que la lectura estaba incompleta.
//
// Este archivo simula un tenant con MÁS de 1,000 gastos (dos páginas: 1,000 +
// 1 registro que solo aparece en la segunda) y confirma que `detectarAnomalias`
// lo ve — antes, ese registro 1,001 nunca llegaba a `detectarDuplicadosEntreViajes`.
// ═══════════════════════════════════════════════════════════════════════════

/** Genera N filas de `gasto` con un patrón detectable: el mismo cfdi_uuid en
 *  dos viajes es la anomalía canónica que `detectarDuplicadosEntreViajes` ya
 *  sabe reconocer (duplicados.ts). */
function filasGasto(n: number, extra: Array<Record<string, unknown>> = []) {
  const base = Array.from({ length: n }, (_, i) => ({
    viaje_id: `v${i}`, concepto: 'diesel', monto: 100, folio: `F${i}`, cfdi_uuid: null,
  }));
  return [...base, ...extra];
}

const rangosLlamados: Array<[number, number]> = [];

function mockPaginado(totalFilas: Array<Record<string, unknown>>) {
  // Se llama una vez POR PÁGINA (cada `.from()` de traerTodo es nuevo) — NO
  // reiniciar `rangosLlamados` aquí, o se pierde el rastro de las páginas
  // anteriores. El reset vive en `beforeEach`, una vez por prueba.
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  for (const m of ['select', 'eq']) builder[m] = self;
  builder.order = self;
  builder.range = (desde: number, hasta: number) => {
    rangosLlamados.push([desde, hasta]);
    const pagina = totalFilas.slice(desde, hasta + 1);
    return Promise.resolve({ data: pagina, error: null });
  };
  return builder;
}

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn() }));

let totalFilas: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => mockPaginado(totalFilas) }),
}));

const { detectarAnomalias } = await import('./analytics');

describe('detectarAnomalias — ya no se recorta en silencio a 1,000 filas', () => {
  beforeEach(() => { rangosLlamados.length = 0; });

  it('con 1,001 gastos, sí ve el registro 1,001 (dos páginas)', async () => {
    // El registro 1,001 es la mitad de una anomalía real: mismo cfdi_uuid que
    // uno de la primera página, en un viaje distinto.
    totalFilas = filasGasto(1000, [
      { viaje_id: 'v0', concepto: 'diesel', monto: 100, folio: 'FX', cfdi_uuid: 'dup-uuid' },
      { viaje_id: 'v-otro', concepto: 'diesel', monto: 100, folio: 'FY', cfdi_uuid: 'dup-uuid' },
    ]);
    const anomalias = await detectarAnomalias('t1');
    const laEncontro = anomalias.some((a) =>
      a.tipo === 'cfdi_duplicado' && a.detalle.includes('dup-uuid') && a.viajes.includes('v-otro'));
    expect(laEncontro, 'debe ver la anomalía que solo existe cruzando dos páginas').toBe(true);
    // Confirma que SÍ paginó (más de una llamada a .range()).
    expect(rangosLlamados.length).toBeGreaterThan(1);
    expect(rangosLlamados[0]).toEqual([0, 999]);
  });

  it('con menos de 1,000 filas, una sola página basta (no pagina de más)', async () => {
    totalFilas = filasGasto(5);
    await detectarAnomalias('t1');
    expect(rangosLlamados).toHaveLength(1);
  });
});
