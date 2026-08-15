// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA DE ESCALA 15k (docs/escala-15k.md §2): `agregarEstatus` llevaba un
// `.limit(MAX_LINEAS_DESGLOSE = 5000)` con un comentario que afirmaba que con
// eso "cabe completo". La premisa era falsa: PostgREST aplica
// min(limit, max_rows) y entrega 1,000 filas sin error — `total` y `pctCuadra`
// se congelaban en 1,000 en el detalle y EN EL ACUSE al cliente. Esta prueba
// reproduce el servidor que recorta (entrega a lo más 1,000 por página) y
// exige que el resumen cuente las 2,500 líneas reales.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const TOTAL = 2_500;
const CUADRAN = 1_700;
/** El servidor: 2,500 líneas, `cuadra` las primeras 1,700, y NUNCA entrega
 *  más de 1,000 por respuesta — el `max_rows` real de PostgREST. */
const lineas = Array.from({ length: TOTAL }, (_, i) => ({
  estatus: i < CUADRAN ? 'cuadra' : 'sin_contraparte',
}));

function nodoLineas() {
  const nodo: Record<string, unknown> = {
    select: () => nodo,
    eq: () => nodo,
    order: () => nodo,
    range: (d: number, h: number) => Promise.resolve({
      // El recorte del servidor: aunque pidan más, salen a lo más 1,000.
      data: lineas.slice(d, Math.min(h + 1, d + 1_000)),
      error: null,
      count: d === 0 ? TOTAL : undefined,
    }),
    // Por si una regresión vuelve al `.limit()`: el límite NO protege — se
    // entrega el recorte del servidor, como en producción.
    limit: () => Promise.resolve({ data: lineas.slice(0, 1_000), error: null }),
  };
  return nodo;
}

function nodoDesglose() {
  const nodo: Record<string, unknown> = {
    select: () => nodo,
    eq: () => nodo,
    maybeSingle: () => Promise.resolve({
      data: {
        id: 'd1', proveedor: 'IAVE', archivo_nombre: 'corte.xlsx',
        periodo_desde: '2026-08-01', periodo_hasta: '2026-08-10', creado_en: '2026-08-11T00:00:00Z',
      },
      error: null,
    }),
  };
  return nodo;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => (tabla === 'desglose_peaje' ? nodoDesglose() : nodoLineas()),
  }),
}));

const { resumenConciliacion } = await import('./desglose_peaje');

describe('resumenConciliacion — el total sobrevive al recorte de 1,000 del servidor', () => {
  it('cuenta las 2,500 líneas reales, no las 1,000 de una respuesta', async () => {
    const r = await resumenConciliacion('t1', 'd1');
    expect(r).not.toBeNull();
    expect(r!.total).toBe(TOTAL);
    expect(r!.cuadra).toBe(CUADRAN);
    expect(r!.sinContraparte).toBe(TOTAL - CUADRAN);
    expect(r!.pctCuadra).toBe(Math.round((CUADRAN / TOTAL) * 100));
  });
});
