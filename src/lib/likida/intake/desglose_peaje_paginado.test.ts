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

/** Lo que viajó de verdad: filas traídas y `range()` pedidos. Con conteos en SQL no debe viajar NINGUNA fila. */
const trafico = { filasTraidas: 0, ranges: 0, conteos: 0 };

function nodoLineas() {
  let estatus: string | null = null;
  let head = false;
  const nodo: Record<string, unknown> = {
    select: (_c: string, o?: { head?: boolean }) => { head = o?.head === true; return nodo; },
    eq: (col: string, v: string) => { if (col === 'estatus') estatus = v; return nodo; },
    order: () => nodo,
    // RONDA 16 (carga de 250 camiones): el código de la auditoría 15k traía TODAS las líneas
    // (decenas de miles con 5,000 viajes al mes) solo para contar tres estatus. Si una regresión
    // vuelve a leer filas, esto lo registra.
    range: (d: number, h: number) => {
      trafico.ranges += 1;
      const pag = lineas.slice(d, Math.min(h + 1, d + 1_000));
      trafico.filasTraidas += pag.length;
      return Promise.resolve({ data: pag, error: null, count: d === 0 ? TOTAL : undefined });
    },
    limit: () => Promise.resolve({ data: lineas.slice(0, 1_000), error: null }),
    // El conteo exacto de PostgREST: `head: true` no manda filas, solo el total (sin tope de max_rows).
    then: (res: (v: unknown) => unknown) => {
      if (!head) throw new Error('una lectura de líneas sin head: ¿volvió a traer filas?');
      trafico.conteos += 1;
      const n = estatus === null ? lineas.length : lineas.filter((l) => l.estatus === estatus).length;
      return Promise.resolve({ data: null, error: null, count: n }).then(res);
    },
  };
  return nodo;
}

function nodoDesglose() {
  const nodo: Record<string, unknown> = {
    select: () => nodo,
    eq: () => nodo,
    is: () => nodo,
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
    trafico.filasTraidas = 0; trafico.ranges = 0; trafico.conteos = 0;
    const r = await resumenConciliacion('t1', 'd1');
    expect(r).not.toBeNull();
    expect(r!.total).toBe(TOTAL);
    expect(r!.cuadra).toBe(CUADRAN);
    expect(r!.sinContraparte).toBe(TOTAL - CUADRAN);
    expect(r!.pctCuadra).toBe(Math.round((CUADRAN / TOTAL) * 100));
  });

  it('cuenta en SQL: no viaja ninguna fila ni se pide ningún offset', async () => {
    trafico.filasTraidas = 0; trafico.ranges = 0; trafico.conteos = 0;
    await resumenConciliacion('t1', 'd1');
    expect(trafico.filasTraidas).toBe(0);
    expect(trafico.ranges).toBe(0);
    expect(trafico.conteos).toBe(4); // total + cuadra + no_cuadra + sin_contraparte
  });
});
