import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// ESC-8 (escala 50k) — el export de facturas de proveedor pedía
// `.limit(5000)`. PostgREST recorta a `max_rows` (1,000) sin avisar, así que
// `recortado` (`length === 5000`) no se cumplía NUNCA y una flota con 1,001+
// aprobadas mandaba al ERP un archivo corto con cara de completo. Aquí la
// "base" aplica ese recorte igual que la real, y se fija que el export pagina
// por `range` hasta demostrar el total — o lanza, jamás devuelve de menos.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));

const MAX_ROWS = 1_000;
let facturas: Array<Record<string, unknown>> = [];
/** A partir de esta llamada la base contesta vacío aunque el count diga más. */
let seCallaDesde = Infinity;
const llamadas: Array<{ filtros: Array<[string, unknown]>; rango: [number, number] | null; conteo: boolean; limit: number | null; update: Record<string, unknown> | null; enIds: string[] | null }> = [];
/** A partir de esta tanda de UPDATE (0-based), la base contesta error. */
let updateFallaDesde = Infinity;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const llamada = { filtros: [] as Array<[string, unknown]>, rango: null as [number, number] | null, conteo: false, limit: null as number | null, update: null as Record<string, unknown> | null, enIds: null as string[] | null };
      llamadas.push(llamada);
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: (_c: string, opt?: { count?: string }) => { llamada.conteo = opt?.count === 'exact'; return b; },
        eq: (c: string, v: unknown) => { llamada.filtros.push([c, v]); return b; },
        update: (v: Record<string, unknown>) => { llamada.update = v; return b; },
        is: (c: string, v: unknown) => { llamada.filtros.push([c, v]); return b; },
        in: (_c: string, v: string[]) => { llamada.enIds = v; return b; },
        order: () => b,
        limit: (n: number) => { llamada.limit = n; return b; },
        range: (d: number, h: number) => { llamada.rango = [d, h]; return b; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => {
          if (llamada.update) {
            const nEsta = llamadas.filter((l) => l.update).indexOf(llamada);
            const error = nEsta >= updateFallaDesde ? { message: '414 URI Too Long' } : null;
            return Promise.resolve({ data: null, error }).then(res, rej);
          }
          const [d, h] = llamada.rango ?? [0, (llamada.limit ?? MAX_ROWS) - 1];
          // El recorte REAL de PostgREST: nunca más de max_rows por respuesta.
          const data = llamadas.length > seCallaDesde ? [] : facturas.slice(d, Math.min(h + 1, d + MAX_ROWS));
          return Promise.resolve({ data, error: null, count: llamada.conteo ? facturas.length : null }).then(res, rej);
        },
      });
      return b;
    },
  }),
}));

const { exportarAprobadas, listarAprobadasCompletas, marcarExportadas } = await import('./proveedores');
const { IDS_POR_TANDA } = await import('./pg');
const { LecturaIncompleta } = await import('./pg');

const factura = (i: number) => ({
  id: `f-${i}`, cfdi_uuid: `uuid-${i}`, emisor_rfc: 'AAA010101AAA', emisor_nombre: 'Diesel SA', receptor_rfc: 'BBB', receptor_es_flota: true,
  fecha: '2026-08-10', sub_total: 100, iva: 16, total: 116, descripcion: 'diesel', conceptos: 1, estado: 'aprobada',
  decidido_por: null, decidido_en: null, created_at: '2026-08-10T00:00:00Z', origen: 'xml', ocr_confianza: null, estado_sat: null, exportada_en: null,
});

beforeEach(() => { llamadas.length = 0; facturas = []; seCallaDesde = Infinity; updateFallaDesde = Infinity; });

describe('ESC-8 — el export de proveedor trae TODAS las aprobadas o lanza', () => {
  it('REPRO: 1,001 aprobadas salen las 1,001 (antes: 1,000 calladas)', async () => {
    facturas = Array.from({ length: 1_001 }, (_, i) => factura(i));
    const r = await exportarAprobadas('t-1', 'generico');
    expect(r.filas).toHaveLength(1_001);
    expect(r.ids).toHaveLength(1_001);
    expect(new Set(r.ids).size).toBe(1_001);
  });

  it('pagina por `range`, pide el count SOLO en la primera página y filtra tenant + estado en cada una', () => {
    facturas = Array.from({ length: 2_500 }, (_, i) => factura(i));
    return listarAprobadasCompletas('t-1').then((filas) => {
      expect(filas).toHaveLength(2_500);
      expect(llamadas.length).toBe(3);
      expect(llamadas.map((l) => l.rango)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
      expect(llamadas.map((l) => l.conteo)).toEqual([true, false, false]);
      for (const l of llamadas) {
        expect(l.filtros).toEqual(expect.arrayContaining([['tenant_id', 't-1'], ['estado', 'aprobada']]));
        expect(l.limit).toBeNull();
      }
    });
  });

  it('sin aprobadas: lista vacía, sin error', async () => {
    const r = await exportarAprobadas('t-1', 'sap_b1');
    expect(r).toEqual({ filas: [], ids: [] });
  });

  it('si la base deja de entregar antes del total, LANZA LecturaIncompleta — no hay archivo corto', async () => {
    facturas = Array.from({ length: 1_500 }, (_, i) => factura(i));
    seCallaDesde = 1; // la primera página trae 1,000 y count=1,500; la segunda, nada
    await expect(exportarAprobadas('t-1', 'contpaqi')).rejects.toBeInstanceOf(LecturaIncompleta);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, BE-8 — `marcarExportadas` mandaba la lista ENTERA de ids en un
// solo `.in()`, o sea en la URL. `exportarAprobadas` trae también las ya
// exportadas, así que la lista solo crece: a 400 facturas son ~15 KB de query
// string, el proxy contesta 414, NINGUNA queda marcada y el CSV sale con 200.
// El contador reimporta el mismo archivo al ERP.
// ═══════════════════════════════════════════════════════════════════════════
describe('BE-8 — el marcado sale por tandas y dice cuántas alcanzó', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `f-${i}`);

  it('REPRO: 1,000 ids salen en tandas de IDS_POR_TANDA, ninguna llamada lleva más', async () => {
    const r = await marcarExportadas('t-1', ids(1_000));

    const updates = llamadas.filter((l) => l.update);
    expect(updates).toHaveLength(1_000 / IDS_POR_TANDA);
    for (const u of updates) {
      expect(u.enIds!.length).toBeLessThanOrEqual(IDS_POR_TANDA);
      expect(u.filtros).toEqual(expect.arrayContaining([['tenant_id', 't-1'], ['estado', 'aprobada'], ['exportada_en', null]]));
    }
    // Todas comparten el MISMO sello: es un solo export, no cinco fechas.
    expect(new Set(updates.map((u) => u.update!.exportada_en as string)).size).toBe(1);
    // Y ninguna se repite ni se pierde.
    expect(updates.flatMap((u) => u.enIds!)).toEqual(ids(1_000));
    expect(r).toEqual({ marcadas: 1_000 });
  });

  it('si la tanda 3 revienta, se dice cuántas quedaron marcadas y no se sigue', async () => {
    updateFallaDesde = 2; // la tercera (0-based)
    const r = await marcarExportadas('t-1', ids(1_000));

    expect(r.error).toContain('414');
    expect(r.marcadas).toBe(2 * IDS_POR_TANDA);
    expect(llamadas.filter((l) => l.update)).toHaveLength(3);
  });

  it('sin ids no toca la base', async () => {
    expect(await marcarExportadas('t-1', [])).toEqual({ marcadas: 0 });
    expect(llamadas.filter((l) => l.update)).toHaveLength(0);
  });
});
