import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Respuesta = { data?: unknown; error?: { message: string; code?: string } | null };
interface Registro { tabla: string; ops: Array<[string, ...unknown[]]> }
const registros: Registro[] = [];
let respuestas: Respuesta[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const reg: Registro = { tabla, ops: [] };
      registros.push(reg);
      const proxy: unknown = new Proxy({}, {
        get: (_t, prop: string) => {
          if (prop === 'then') return (res: (r: Respuesta) => unknown) => res(respuestas.shift() ?? { data: [], error: null });
          return (...args: unknown[]) => { if (prop !== 'abortSignal') reg.ops.push([prop, ...args]); return proxy; };
        },
      });
      return proxy;
    },
  }),
}));

const repo = await import('./repo');
const OK = 'https://maps.app.goo.gl/EjemploSintetico1';
const fila = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', corredor: 'monterrey', sitio_origen: 'pl-1', sitio_destino: null, url: OK, vigente_hasta: '2027-01-31', revisada_en: null, ...extra,
});
const csv = (extra: Record<string, unknown> = {}) => ({
  linea: 2, corredor: 'monterrey', sitioOrigen: 'pl-1', sitioDestino: null, url: OK, vigenteHasta: '2027-01-31', revisadaEn: null, ...extra,
}) as Parameters<typeof repo.importarRutas>[1][number];

beforeEach(() => { registros.length = 0; respuestas = []; });

describe('leerRutasAutorizadas', () => {
  it('lee solo la flota pedida y devuelve camelCase', async () => {
    respuestas = [{ data: [fila()], error: null }];
    const r = await repo.leerRutasAutorizadas('t1');
    expect(registros[0].tabla).toBe('ruta_autorizada');
    expect(registros[0].ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(r).toEqual([{ id: 'r1', corredor: 'monterrey', sitioOrigen: 'pl-1', sitioDestino: null, url: OK, vigenteHasta: '2027-01-31', revisadaEn: null }]);
  });
  it('descarta filas sin id, corredor o url', async () => {
    respuestas = [{ data: [fila({ url: null }), fila({ corredor: '' }), fila()], error: null }];
    expect(await repo.leerRutasAutorizadas('t1')).toHaveLength(1);
  });
  it('una base sin la 0808 devuelve []; otro error se lanza', async () => {
    respuestas = [{ error: { message: 'relation "public.ruta_autorizada" does not exist', code: '42P01' } }];
    expect(await repo.leerRutasAutorizadas('t1')).toEqual([]);
    respuestas = [{ error: { message: 'timeout', code: '57014' } }];
    await expect(repo.leerRutasAutorizadas('t1')).rejects.toThrow(/rutas_leer/);
  });
});

describe('leerCodigosSitios (T-A5-49)', () => {
  it('lee solo los sitios pedidos de la flota y devuelve id → código, sin los que no tienen código', async () => {
    respuestas = [{ data: [{ id: 'g1', codigo: 'pl-01' }, { id: 'g2', codigo: null }, { id: 'g3', codigo: '' }], error: null }];
    const r = await repo.leerCodigosSitios('t1', ['g1', 'g2', 'g3', 'g1']);
    expect(registros[0].tabla).toBe('geocerca');
    expect(registros[0].ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect([...r]).toEqual([['g1', 'pl-01']]);
  });
  it('sin ids no consulta la base', async () => {
    expect((await repo.leerCodigosSitios('t1', [])).size).toBe(0);
    expect(registros).toEqual([]);
  });
});

describe('importarRutas', () => {
  it('inserta lo nuevo con el tenant de la sesión y no toca lo que no cambió', async () => {
    respuestas = [{ data: [fila()], error: null }, { data: [], error: null }];
    const r = await repo.importarRutas('t1', [csv(), csv({ corredor: 'laredo', sitioOrigen: null })]);
    expect(r).toEqual({ guardadas: 1, nuevas: 1, actualizadas: 0, sinCambios: 1 });
    const insert = registros.find((g) => g.ops.some(([op]) => op === 'insert'));
    const lote = insert?.ops.find(([op]) => op === 'insert')?.[1] as Array<Record<string, unknown>>;
    expect(lote).toEqual([{ tenant_id: 't1', corredor: 'laredo', sitio_origen: null, sitio_destino: null, url: OK, vigente_hasta: '2027-01-31', revisada_en: null }]);
    expect(registros.some((g) => g.ops.some(([op]) => op === 'update'))).toBe(false);
  });
  it('reimportar lo mismo no escribe nada', async () => {
    respuestas = [{ data: [fila()], error: null }];
    expect(await repo.importarRutas('t1', [csv()])).toEqual({ guardadas: 0, nuevas: 0, actualizadas: 0, sinCambios: 1 });
    expect(registros.filter((g) => g.ops.some(([op]) => op === 'insert' || op === 'update'))).toHaveLength(0);
  });
  it('una URL nueva actualiza por id Y tenant', async () => {
    respuestas = [{ data: [fila()], error: null }, { data: [{ id: 'r1' }], error: null }];
    const r = await repo.importarRutas('t1', [csv({ url: 'https://maps.app.goo.gl/Otra' })]);
    expect(r.actualizadas).toBe(1);
    const upd = registros.find((g) => g.ops.some(([op]) => op === 'update'));
    expect(upd?.ops).toContainEqual(['eq', 'id', 'r1']);
    expect(upd?.ops).toContainEqual(['eq', 'tenant_id', 't1']);
  });
  it('si la base falla al escribir, lanza (no finge que guardó)', async () => {
    respuestas = [{ data: [], error: null }, { error: { message: 'violates check constraint ruta_autorizada_url_mapas', code: '23514' } }];
    await expect(repo.importarRutas('t1', [csv()])).rejects.toThrow(/rutas_insertar/);
  });
});
