import { beforeEach, describe, expect, it, vi } from 'vitest';
import { leerConTope, type RespuestaPagina } from './lectura_paginada';

const MAX_ROWS = 1000; // supabase/config.toml: PostgREST corta cada respuesta aquí

/** Un servidor que se comporta como PostgREST con max_rows = 1000: nunca entrega más, aunque el rango pida más. */
function servidor(total: number, conConteo = true) {
  const llamadas: Array<[number, number]> = [];
  const pedir = async (d: number, h: number, primera: boolean): Promise<RespuestaPagina<number>> => {
    llamadas.push([d, h]);
    const hasta = Math.min(h, d + MAX_ROWS - 1, total - 1);
    const data = d > hasta ? [] : Array.from({ length: hasta - d + 1 }, (_, i) => d + i);
    return { data, error: null, count: primera && conConteo ? total : null };
  };
  return { pedir, llamadas };
}

describe('leerConTope (A37-S31-01)', () => {
  it('2,500 filas con max_rows=1000: las lee TODAS (antes .limit(5000) se quedaba en 1,000) y no marca truncado', async () => {
    const s = servidor(2500);
    const r = await leerConTope(s.pedir, 5000);
    expect(r.data).toHaveLength(2500);
    expect(r.truncado).toBe(false);
  });

  it('más filas que el tope: lee exactamente el tope y SÍ marca truncado', async () => {
    const s = servidor(6200);
    const r = await leerConTope(s.pedir, 5000);
    expect(r.data).toHaveLength(5000);
    expect(r.truncado).toBe(true);
  });

  it('exactamente 1,000 filas (el caso del recorte silencioso): pide el conteo y no inventa truncado', async () => {
    const r = await leerConTope(servidor(1000).pedir, 5000);
    expect(r.data).toHaveLength(1000);
    expect(r.truncado).toBe(false);
  });

  it('sin conteo de la base sigue hasta una página vacía y no da por completa una página de 1,000', async () => {
    const r = await leerConTope(servidor(2300, false).pedir, 5000);
    expect(r.data).toHaveLength(2300);
    expect(r.truncado).toBe(false);
  });

  it('un error de la base se devuelve (no se lee como «no hay nada»)', async () => {
    const r = await leerConTope(async () => ({ data: null, error: { message: 'boom', code: 'XX000' } }), 5000);
    expect(r).toMatchObject({ data: null, error: { message: 'boom' } });
  });

  it('ordena por rangos contiguos sin huecos ni repeticiones', async () => {
    const s = servidor(2500);
    await leerConTope(s.pedir, 5000);
    expect(s.llamadas.slice(0, 3)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});

// ── cargarCatalogoCliente contra un cliente grabador con max_rows = 1000 ──
const filasProducto = (n: number) => Array.from({ length: n }, (_, i) => ({
  sku: `SKU-${String(i).padStart(5, '0')}`, descripcion_patron: null, bienes_transp: '10000001', clave_unidad: 'H87', embalaje: null, fraccion: null,
  tipo_materia: null, material_peligroso: false, clave_material_peligroso: null,
}));
let totalProductos = 0;

function constructor(tabla: string) {
  let rango: [number, number] = [0, 999];
  let contar = false;
  const b: Record<string, unknown> = {};
  for (const m of ['eq', 'order', 'in', 'limit']) b[m] = () => b;
  b.select = (_c: string, o?: { count?: string }) => { contar = o?.count === 'exact'; return b; };
  b.range = (d: number, h: number) => { rango = [d, h]; return b; };
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    const total = tabla === 'cp_catalogo_producto' ? totalProductos : 0;
    const filas = tabla === 'cp_catalogo_producto' ? filasProducto(total) : [];
    const [d, h] = rango;
    const data = filas.slice(d, Math.min(h + 1, d + MAX_ROWS));
    return Promise.resolve({ data, error: null, count: contar ? total : null }).then(ok, ko);
  };
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('cargarCatalogoCliente · PostgREST corta a 1,000', () => {
  beforeEach(() => { totalProductos = 0; });

  it('un cliente con 2,300 SKU los trae todos; el SKU 2,100 ya no sale «sin coincidencia»', async () => {
    totalProductos = 2300;
    const { cargarCatalogoCliente } = await import('./repo');
    const c = await cargarCatalogoCliente('t1', 'c1');
    expect(c.productos).toHaveLength(2300);
    expect(c.productos.some((p) => p.sku === 'SKU-02100')).toBe(true);
    expect(c.truncado).toBe(false);
  });

  it('con más del tope (5,000) lee el tope y marca truncado de verdad', async () => {
    totalProductos = 5600;
    const { cargarCatalogoCliente } = await import('./repo');
    const c = await cargarCatalogoCliente('t1', 'c1');
    expect(c.productos).toHaveLength(5000);
    expect(c.truncado).toBe(true);
  });
});
