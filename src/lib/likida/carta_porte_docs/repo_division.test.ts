import { describe, it, expect, vi, beforeEach } from 'vitest';

// Las funciones de repo.ts de la división de archivos con varios embarques (0670-0671): contra una base CON las migraciones
// (la RPC atómica y la tabla de linaje) y contra una base SIN ellas (sin_migracion / vacío: nada se rompe). Supabase es un doble.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type Respuesta = { data: unknown; error: { message: string; code?: string } | null };
let rpcs: Record<string, Respuesta> = {};
/** Una respuesta por consulta `from(...)`, en el orden en que se hacen. */
let consultas: Array<{ tabla: string; respuesta: Respuesta }> = [];
const llamadasRpc: Array<{ nombre: string; args: Record<string, unknown> }> = [];
const tablasPedidas: string[] = [];
const AUSENTE = { message: 'Could not find the function public.cp_documento_dividir in the schema cache', code: 'PGRST202' };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (nombre: string, args: Record<string, unknown>) => {
      llamadasRpc.push({ nombre, args });
      return Promise.resolve(rpcs[nombre] ?? { data: null, error: { message: `rpc ${nombre} sin guion` } });
    },
    from: (tabla: string) => {
      tablasPedidas.push(tabla);
      const sig = consultas.shift();
      const n: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) n[m] = () => n;
      n.then = (ok: (v: Respuesta) => unknown) => Promise.resolve(sig?.respuesta ?? { data: null, error: { message: `from(${tabla}) sin guion` } }).then(ok);
      return n;
    },
  }),
}));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const repo = await import('./repo');

const T = '11111111-1111-4111-8111-111111111111';
const PADRE = '22222222-2222-4222-8222-222222222222';
const HIJO1 = '33333333-3333-4333-8333-333333333331';
const HIJO2 = '33333333-3333-4333-8333-333333333332';
const SHA = (c: string) => c.repeat(64);

const hijosNuevos = (): import('./repo').HijoNuevo[] => [
  { indice: 1, clave: 'ATL-1', nombre: 'plan · embarque ATL-1.csv', sha256: SHA('a'), bytes: 100, storageRuta: `${T}/${SHA('a')}` },
  { indice: 2, clave: 'ATL-2', nombre: 'plan · embarque ATL-2.csv', sha256: SHA('b'), bytes: 90, storageRuta: `${T}/${SHA('b')}` },
];

beforeEach(() => { rpcs = {}; consultas = []; llamadasRpc.length = 0; tablasPedidas.length = 0; });

describe('dividirDocumento', () => {
  it('con la 0671: manda a la RPC el tenant, el padre, la versión reclamada, los hijos y las dos retenciones, y devuelve los ids', async () => {
    rpcs.cp_documento_dividir = { data: [{ indice: 1, documento_id: HIJO1, creado: true }, { indice: 2, documento_id: HIJO2, creado: false }], error: null };
    const r = await repo.dividirDocumento(T, PADRE, 7, hijosNuevos(), '2027-04-01T00:00:00Z', '2027-01-01T00:00:00Z');
    expect(r).toEqual({ estado: 'ok', hijos: [{ indice: 1, documentoId: HIJO1, creado: true }, { indice: 2, documentoId: HIJO2, creado: false }] });
    expect(llamadasRpc).toHaveLength(1);
    expect(llamadasRpc[0].nombre).toBe('cp_documento_dividir');
    expect(llamadasRpc[0].args).toMatchObject({ p_tenant: T, p_padre: PADRE, p_version: 7, p_retener_hijos: '2027-04-01T00:00:00Z', p_retener_padre: '2027-01-01T00:00:00Z' });
    expect(llamadasRpc[0].args.p_hijos).toEqual([
      { indice: 1, clave: 'ATL-1', nombre: 'plan · embarque ATL-1.csv', sha256: SHA('a'), bytes: 100, storage_ruta: `${T}/${SHA('a')}` },
      { indice: 2, clave: 'ATL-2', nombre: 'plan · embarque ATL-2.csv', sha256: SHA('b'), bytes: 90, storage_ruta: `${T}/${SHA('b')}` },
    ]);
  });

  it('cero filas = «perdí el lease»: otra invocación lo terminó o venció la versión (no es un error)', async () => {
    rpcs.cp_documento_dividir = { data: [], error: null };
    expect(await repo.dividirDocumento(T, PADRE, 7, hijosNuevos(), 'x', 'y')).toEqual({ estado: 'perdido' });
  });

  it('SIN la 0671 (la función no existe): sin_migracion, para que el documento se lea como siempre', async () => {
    rpcs.cp_documento_dividir = { data: null, error: AUSENTE };
    expect(await repo.dividirDocumento(T, PADRE, 7, hijosNuevos(), 'x', 'y')).toEqual({ estado: 'sin_migracion' });
  });

  it('cualquier OTRO error se lanza: un fallo de la base no se lee como «no había nada que dividir»', async () => {
    rpcs.cp_documento_dividir = { data: null, error: { message: 'statement timeout', code: '57014' } };
    await expect(repo.dividirDocumento(T, PADRE, 7, hijosNuevos(), 'x', 'y')).rejects.toThrow(/statement timeout/);
  });
});

describe('linajeDeDocumentos (mejor esfuerzo: la bandeja nunca se cae por esto)', () => {
  it('sin ids no consulta nada', async () => {
    expect((await repo.linajeDeDocumentos(T, [])).size).toBe(0);
    expect(tablasPedidas).toEqual([]);
  });

  it('une los hijos (por su documento) y los padres (por su primer hijo) en un mapa por id', async () => {
    consultas = [
      { tabla: 'cp_documento_embarque', respuesta: { error: null, data: [{ documento_id: HIJO1, padre_id: PADRE, huella_base: SHA('f'), indice: 1, total: 2, clave: 'ATL-1' }] } },
      { tabla: 'cp_documento_embarque', respuesta: { error: null, data: [{ padre_id: PADRE, huella_base: SHA('f'), total: 2 }] } },
    ];
    const m = await repo.linajeDeDocumentos(T, [PADRE, HIJO1]);
    expect(m.get(HIJO1)).toEqual({ rol: 'hijo', padreId: PADRE, indice: 1, total: 2, clave: 'ATL-1', huellaBase: SHA('f') });
    expect(m.get(PADRE)).toEqual({ rol: 'padre', padreId: PADRE, indice: null, total: 2, clave: null, huellaBase: SHA('f') });
  });

  it('SIN la 0670 (la tabla no existe) o con la base caída: devuelve vacío y la bandeja se ve como antes', async () => {
    consultas = [{ tabla: 'cp_documento_embarque', respuesta: { data: null, error: { message: 'Could not find the table public.cp_documento_embarque in the schema cache', code: 'PGRST205' } } }];
    expect((await repo.linajeDeDocumentos(T, [HIJO1])).size).toBe(0);
    consultas = [{ tabla: 'cp_documento_embarque', respuesta: { data: null, error: { message: 'connection reset' } } }];
    expect((await repo.linajeDeDocumentos(T, [HIJO1])).size).toBe(0);
  });
});

describe('hijosDeDocumento', () => {
  it('lee las fichas y luego los documentos, y los devuelve en el orden del archivo', async () => {
    consultas = [
      { tabla: 'cp_documento_embarque', respuesta: { error: null, data: [{ documento_id: HIJO1, indice: 1, total: 2, clave: 'ATL-1' }, { documento_id: HIJO2, indice: 2, total: 2, clave: 'ATL-2' }] } },
      {
        tabla: 'cp_documento', respuesta: {
          error: null, data: [HIJO2, HIJO1].map((id) => ({
            id, tenant_id: T, canal: 'manual', formato: 'csv', nombre_archivo: `${id}.csv`, bytes: 1, sha256: SHA('a'), estado: 'recibido', version: 1,
            riesgo_inyeccion: false, retener_hasta: '2027-01-01', created_at: '2026-10-01', updated_at: '2026-10-01',
          })),
        },
      },
    ];
    const h = await repo.hijosDeDocumento(T, PADRE);
    expect(h.map((x) => [x.indice, x.clave, x.documento.id])).toEqual([[1, 'ATL-1', HIJO1], [2, 'ATL-2', HIJO2]]);
    expect(tablasPedidas).toEqual(['cp_documento_embarque', 'cp_documento']);
  });

  it('un archivo sin hijos (o una base sin la 0670) devuelve vacío sin consultar los documentos', async () => {
    consultas = [{ tabla: 'cp_documento_embarque', respuesta: { error: null, data: [] } }];
    expect(await repo.hijosDeDocumento(T, PADRE)).toEqual([]);
    expect(tablasPedidas).toEqual(['cp_documento_embarque']);
    consultas = [{ tabla: 'cp_documento_embarque', respuesta: { data: null, error: { message: 'relation "cp_documento_embarque" does not exist', code: '42P01' } } }];
    // Un error que NO es «no existe la función» se lanza: borrar un archivo dividido sin ver sus hijos dejaría huérfanos.
    await expect(repo.hijosDeDocumento(T, PADRE)).rejects.toThrow(/cp_documento_embarque/);
  });
});
