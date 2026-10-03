// ═══════════════════════════════════════════════════════════════════════════
// RONDA 16 (carga de 250 camiones): `conteoBuzon` paginaba por OFFSET todas las
// recepciones de los últimos 30 días (con un correo de facturas por viaje,
// decenas de miles de filas) solo para sumar por estado. Ahora son conteos
// exactos en SQL (`head: true`): no viaja ninguna fila de recepción y el
// tablero sigue diciendo la verdad aunque el servidor recorte a 1,000.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));

const ESTADOS = ['procesada', 'duplicada', 'revision', 'descartada', 'ignorada', 'rechazada', 'error'] as const;
// 42,000 recepciones en la ventana: 6,000 de cada estado (más que cualquier `max_rows`).
const recepciones = ESTADOS.flatMap((estado, e) =>
  Array.from({ length: 6_000 }, (_, i) => ({ id: `r-${e}-${String(i).padStart(5, '0')}`, estado, recibido_en: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z` })));
let facturasPorRevisar = 7;
const trafico = { ranges: 0, filasTraidas: 0, falla: false };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let head = false;
      let estado: string | null = null;
      let tope = Number.POSITIVE_INFINITY;
      const nodo: Record<string, unknown> = {
        select: (_c: string, o?: { head?: boolean }) => { head = o?.head === true; return nodo; },
        eq: (col: string, v: string) => { if (col === 'estado') estado = v; return nodo; },
        gte: () => nodo,
        order: () => nodo,
        limit: (n: number) => { tope = n; return nodo; },
        range: (d: number, h: number) => {
          trafico.ranges += 1;
          const pag = recepciones.slice(d, Math.min(h + 1, d + 1_000));
          trafico.filasTraidas += pag.length;
          return Promise.resolve({ data: pag, error: null, count: d === 0 ? recepciones.length : undefined });
        },
        then: (res: (v: unknown) => unknown) => {
          if (trafico.falla) return Promise.resolve({ data: null, error: { message: 'timeout' }, count: null }).then(res);
          if (tabla === 'factura_proveedor') return Promise.resolve({ data: null, error: null, count: facturasPorRevisar }).then(res);
          if (head) {
            const n = estado === null ? recepciones.length : recepciones.filter((r) => r.estado === estado).length;
            return Promise.resolve({ data: null, error: null, count: n }).then(res);
          }
          // una fila para la fecha de la última recepción
          trafico.filasTraidas += Math.min(tope, 1);
          return Promise.resolve({ data: [{ recibido_en: '2026-09-28T10:00:00Z' }].slice(0, tope), error: null }).then(res);
        },
      };
      return nodo;
    },
  }),
}));

const { conteoBuzon } = await import('./repo');

beforeEach(() => { trafico.ranges = 0; trafico.filasTraidas = 0; trafico.falla = false; facturasPorRevisar = 7; });

describe('conteoBuzon — conteos exactos en SQL, no una lectura completa', () => {
  it('con 42,000 recepciones los conteos son exactos', async () => {
    const r = await conteoBuzon('t1', new Date('2026-09-30T00:00:00Z'));
    expect(r.total).toBe(42_000);
    for (const e of ESTADOS) expect(r.porEstado[e], e).toBe(6_000);
    expect(r.ultimaRecepcionEn).toBe('2026-09-28T10:00:00Z');
    expect(r.facturasPorRevisar).toBe(7);
  });

  it('no pagina por offset ni trae filas de recepción (solo la última fecha)', async () => {
    await conteoBuzon('t1', new Date('2026-09-30T00:00:00Z'));
    expect(trafico.ranges, 'ningún range(): nada de offsets').toBe(0);
    expect(trafico.filasTraidas, 'solo UNA fila viaja: la de la última recepción').toBeLessThanOrEqual(1);
  });

  it('un error de lectura LANZA: «0 recibidos» sobre una base caída sería mentira', async () => {
    trafico.falla = true;
    await expect(conteoBuzon('t1', new Date('2026-09-30T00:00:00Z'))).rejects.toThrow('timeout');
  });
});
