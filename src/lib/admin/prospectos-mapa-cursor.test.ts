// ═══════════════════════════════════════════════════════════════════════════
// La carga COMPLETA del mapa pagina por CURSOR (created_at desc, id asc), no por
// OFFSET: a 33k filas el offset recorría el índice desde el inicio en cada página
// (3.6 s en offset 32,000) y 34 páginas en paralelo saturaban la base.
//
// El fake de abajo implementa lo que importa del servidor: el orden, la cota
// `lte`, el `or` del keyset, el tope `max_rows = 1000` de PostgREST y el count
// exacto solo cuando se pide. Con created_at REPETIDOS (lotes de siembra) y más de
// 1,000 filas, si el cursor duplicara o saltara filas, estas pruebas lo ven.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Fila { id: string; created_at: string; updated_at: string; empresa: string; [k: string]: unknown }

const N = 2_500;
const FILAS: Fila[] = Array.from({ length: N }, (_, i) => ({
  id: `id-${String(i).padStart(5, '0')}`,
  empresa: `Empresa ${i}`, ciudad: null, lat: null, lng: null, telefono: null, correo: null,
  contacto_nombre: null, vacante: null, estado: 'nuevo', fuente: 'denue', notas: null, scian: null,
  urgencia: null, unidades: null, duplicado_de: null, mensajes_generados_en: null,
  // Bloques de 7 filas con el MISMO created_at: el cursor cae a media tanda en casi cada página.
  created_at: new Date(Date.UTC(2026, 7, 1) + Math.floor(i / 7) * 60_000).toISOString(),
  updated_at: '2026-08-22T09:00:00.000Z',
  prospecto_toque: null, prospecto_persona: null,
  sitio_verificado: false, num_unidades: null, similitud_icp_pct: 0, necesidad_pct: 0,
}));

const espia: { lte: string[]; ors: string[]; limites: number[]; conteos: boolean[]; ranges: number } =
  { lte: [], ors: [], limites: [], conteos: [], ranges: 0 };
/** Ids que el "servidor" deja fuera de la respuesta (simula una página que no llega entera). */
let omitirIds: Set<string> = new Set();
let falla: string | null = null;

function consulta() {
  let lte: string | null = null;
  let or: string | null = null;
  let pedirConteo = false;
  const b = {
    select(_c: string, opts?: { count?: string }) { pedirConteo = opts?.count === 'exact'; espia.conteos.push(pedirConteo); return b; },
    is() { return b; },
    lte(_col: string, v: string) { lte = v; espia.lte.push(v); return b; },
    or(f: string) { or = f; espia.ors.push(f); return b; },
    gt() { return b; },
    order() { return b; },
    range() { espia.ranges++; return Promise.resolve({ data: [], error: null }); },
    limit(n: number) {
      espia.limites.push(n);
      if (falla) return Promise.resolve({ data: null, error: { message: falla } });
      let f = FILAS.filter((x) => !omitirIds.has(x.id) || false);
      const total = FILAS.length;
      if (lte !== null) f = f.filter((x) => x.created_at <= lte!);
      if (or !== null) {
        const m = /created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.gt\.([^)]+)\)/.exec(or);
        if (!m) throw new Error(`or inesperado: ${or}`);
        f = f.filter((x) => x.created_at < m[1] || (x.created_at === m[2] && x.id > m[3]));
      }
      f = [...f].sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : x.id < y.id ? -1 : 1));
      // max_rows de PostgREST: aunque se pida más, nunca más de 1,000.
      return Promise.resolve({ data: f.slice(0, Math.min(n, 1_000)), error: null, count: pedirConteo ? total : undefined });
    },
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => consulta() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));

const { getDatosMapa } = await import('./prospectos-mapa');

beforeEach(() => {
  espia.lte = []; espia.ors = []; espia.limites = []; espia.conteos = []; espia.ranges = 0;
  omitirIds = new Set(); falla = null;
});

describe('carga completa por cursor (created_at desc, id asc)', () => {
  it('con más de 1,000 filas y created_at repetidos trae TODO una sola vez: ni duplica ni salta', async () => {
    const datos = await getDatosMapa();
    expect(datos.fallo).toBe(false);
    const ids = datos.filas.map((f) => f[0] as string);
    expect(ids).toHaveLength(N);
    expect(new Set(ids).size).toBe(N);
    expect(new Set(ids)).toEqual(new Set(FILAS.map((f) => f.id)));
    expect(datos.total).toBe(N);
    // Y en el orden del cursor: created_at desc, id asc.
    const esperado = [...FILAS].sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : x.id < y.id ? -1 : 1)).map((f) => f.id);
    expect(ids).toEqual(esperado);
  });

  it('nunca usa OFFSET: pide con limit(1000), cota lte + or del keyset, y el count solo en la primera vuelta', async () => {
    await getDatosMapa();
    expect(espia.ranges).toBe(0);
    expect(espia.limites.length).toBe(3);
    expect(espia.limites.every((n) => n === 1_000)).toBe(true);
    expect(espia.conteos).toEqual([true, false, false]);
    expect(espia.lte).toHaveLength(2);
    expect(espia.ors).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const m = /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.gt\.(.+)\)$/.exec(espia.ors[i])!;
      expect(m[1]).toBe(espia.lte[i]);
      expect(m[2]).toBe(espia.lte[i]);
    }
  });

  it('si el servidor deja de entregar una fila (la lectura no llega entera), LANZA: fallo cerrado, sin cartera parcial', async () => {
    // Quita una fila a media base: el count exacto (2,500) ya no se alcanza y la última página viene vacía.
    omitirIds = new Set([FILAS[1_700].id]);
    const datos = await getDatosMapa();
    expect(datos.fallo).toBe(true);
    expect(datos.filas).toEqual([]);
    expect(datos.marca).toBeNull();
    expect(datos.total).toBeNull();
  });

  it('un error de la base en cualquier página también cierra en fallo', async () => {
    falla = 'canceling statement due to statement timeout';
    const datos = await getDatosMapa();
    expect(datos.fallo).toBe(true);
    expect(datos.filas).toEqual([]);
  });
});
