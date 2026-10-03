// ═══════════════════════════════════════════════════════════════════════════
// RONDA 16 (carga de 250 camiones): `getPorFacturar` leía los tickets sin CFDI
// de 45 días con `traerTodo` por OFFSET. A 5,000 viajes al mes son 10-23k filas
// (hasta 23 páginas): cada página con offset mayor cuesta más en el servidor
// (O(n²)) y un ticket que entra por WhatsApp a media lectura corre las posiciones
// (una fila repetida o una saltada). Ahora pagina por CURSOR de `id`.
//
// El servidor falso: filtra, ordena, aplica `max_rows = 1000` pida lo que pida,
// y puede INSERTAR un gasto entre dos páginas — lo que hace WhatsApp en vivo.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Fila = Record<string, unknown> & { id: string; fecha: string | null; cfdi_uuid: string | null; tenant_id: string; concepto: string };
const MAX_ROWS = 1_000;
let tabla: Fila[] = [];
const offsets: number[] = [];
let alTerminarPagina: ((n: number) => void) | null = null;
let paginasServidas = 0;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const filtros: Array<(f: Fila) => boolean> = [];
      const ordenes: Array<[string, boolean]> = [];
      let rango: [number, number] | null = null;
      let tope = Number.POSITIVE_INFINITY;
      let conteo = false;
      const nodo: Record<string, unknown> = {
        select: (_c: string, o?: { count?: string }) => { conteo = o?.count === 'exact'; return nodo; },
        eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return nodo; },
        is: (c: string, v: unknown) => { filtros.push((f) => (f[c] ?? null) === v); return nodo; },
        neq: (c: string, v: unknown) => { filtros.push((f) => f[c] !== v); return nodo; },
        gte: (c: string, v: string) => { filtros.push((f) => f[c] !== null && (f[c] as string) >= v); return nodo; },
        gt: (c: string, v: string) => { filtros.push((f) => (f[c] as string) > v); return nodo; },
        order: (c: string, o?: { ascending?: boolean }) => { ordenes.push([c, o?.ascending !== false]); return nodo; },
        limit: (n: number) => { tope = n; return nodo; },
        range: (d: number, h: number) => { if (d > 0) offsets.push(d); rango = [d, h]; return nodo; },
        then: (res: (v: unknown) => unknown) => {
          let filas = tabla.filter((f) => filtros.every((p) => p(f)));
          const total = filas.length;
          filas = [...filas].sort((a, b) => {
            for (const [c, asc] of ordenes) {
              const x = a[c] as string | null; const y = b[c] as string | null;
              if (x === y) continue;
              if (x === null) return 1; if (y === null) return -1;     // nulls last
              return (x < y ? -1 : 1) * (asc ? 1 : -1);
            }
            return 0;
          });
          const ventana = rango
            ? filas.slice(rango[0], Math.min(rango[1], rango[0] + MAX_ROWS - 1) + 1)
            : filas.slice(0, Math.min(tope, MAX_ROWS));
          paginasServidas += 1;
          const salida = { data: ventana, error: null, count: conteo ? total : undefined };
          // el gasto «de WhatsApp» entra DESPUÉS de servir esta página
          if (alTerminarPagina) alTerminarPagina(paginasServidas);
          return Promise.resolve(salida).then(res);
        },
      };
      return nodo;
    },
  }),
}));

const { getPorFacturar } = await import('./pendientes');

const hex = (n: number) => n.toString(16).padStart(8, '0');
const gasto = (n: number, extra: Partial<Fila> = {}): Fila => ({
  id: `${hex(n)}-0000-4000-8000-000000000000`, tenant_id: 't1', concepto: 'diesel', monto: 100, fecha: '2026-08-10',
  folio: null, rfc_emisor: null, cfdi_uuid: null, ocr_extra: null, autofactura_bloqueada_en: null, autofactura_bloqueo: null, ...extra,
});

beforeEach(() => { tabla = []; offsets.length = 0; alTerminarPagina = null; paginasServidas = 0; });

describe('getPorFacturar — cursor por id, no offset (ronda 16)', () => {
  it('con 2,600 tickets sin CFDI trae los 2,600, una sola vez cada uno, y sin offsets', async () => {
    // mezcla de fechas (y la fecha cae en el orden de la pantalla), ids no correlacionados con la fecha
    for (let i = 1; i <= 2_600; i++) tabla.push(gasto((i * 7919) % 100_003, { fecha: `2026-08-${String(1 + (i % 25)).padStart(2, '0')}` }));
    // ruido que NO debe entrar: otra flota, con CFDI, factura, fuera de la ventana
    tabla.push(gasto(900_001, { tenant_id: 't2' }), gasto(900_002, { cfdi_uuid: 'a'.repeat(36) }),
      gasto(900_003, { concepto: 'factura' }), gasto(900_004, { fecha: '2026-01-01' }));
    const r = await getPorFacturar('t1', '2026-08-22');
    expect(r).toHaveLength(2_600);
    expect(new Set(r.map((t) => t.gastoId)).size).toBe(2_600);
    expect(offsets, 'ningún range(desde>0)').toEqual([]);
    expect(paginasServidas).toBe(3);
  });

  it('conserva el orden de la pantalla: fecha ascendente y, a igual fecha, por id', async () => {
    tabla.push(gasto(5, { fecha: '2026-08-12' }), gasto(2, { fecha: '2026-08-12' }), gasto(9, { fecha: '2026-08-03' }), gasto(1, { fecha: '2026-08-20' }));
    const r = await getPorFacturar('t1', '2026-08-22');
    expect(r.map((t) => t.gastoId)).toEqual([9, 2, 5, 1].map((n) => `${hex(n)}-0000-4000-8000-000000000000`));
  });

  it('un ticket que entra A MEDIA lectura (id menor al cursor) no repite ni salta ninguno', async () => {
    for (let i = 1; i <= 2_100; i++) tabla.push(gasto(1_000 + i));
    // tras servir la 1ª página entra un ticket con id MENOR a todo lo ya leído: por offset corría todo una posición
    alTerminarPagina = (n) => { if (n === 1) tabla.push(gasto(1)); };
    const r = await getPorFacturar('t1', '2026-08-22');
    const ids = r.map((t) => t.gastoId);
    expect(new Set(ids).size, 'ninguno repetido').toBe(ids.length);
    // los 2,100 originales están TODOS; el recién entrado (anterior al cursor) llega en la siguiente lectura
    for (let i = 1; i <= 2_100; i++) expect(ids).toContain(`${hex(1_000 + i)}-0000-4000-8000-000000000000`);
  });
});
