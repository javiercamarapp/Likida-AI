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
const fila = (extra: Record<string, unknown> = {}) => ({
  id: 'd1', cliente_id: 'c1', nombre: 'Documento demo A', tipo: 'basico', requiere_firma: true, requiere_sello: false, ...extra,
});
const doc = { clienteId: 'c1', nombre: 'Documento demo A', tipo: 'basico', requiereFirma: true, requiereSello: false } as const;

beforeEach(() => { registros.length = 0; respuestas = []; });

describe('leerDocumentosCliente', () => {
  it('lee solo la flota pedida y devuelve camelCase', async () => {
    respuestas = [{ data: [fila()], error: null }];
    const r = await repo.leerDocumentosCliente('t1');
    expect(registros[0].tabla).toBe('cliente_documento_requerido');
    expect(registros[0].ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(r).toEqual([{ id: 'd1', clienteId: 'c1', nombre: 'Documento demo A', tipo: 'basico', requiereFirma: true, requiereSello: false }]);
  });
  it('descarta filas incompletas o con tipo fuera de dominio', async () => {
    respuestas = [{ data: [fila({ nombre: null }), fila({ tipo: 'raro' }), fila({ cliente_id: '' }), fila()], error: null }];
    expect(await repo.leerDocumentosCliente('t1')).toHaveLength(1);
  });
  it('una base sin la 0809 devuelve []; otro error se lanza', async () => {
    respuestas = [{ error: { message: 'relation "public.cliente_documento_requerido" does not exist', code: '42P01' } }];
    expect(await repo.leerDocumentosCliente('t1')).toEqual([]);
    respuestas = [{ error: { message: 'timeout', code: '57014' } }];
    await expect(repo.leerDocumentosCliente('t1')).rejects.toThrow(/documentos_cliente_leer/);
  });
});

describe('altaDocumentoCliente', () => {
  it('inserta con el tenant de la sesión y los campos del documento', async () => {
    respuestas = [{ data: [], error: null }, { data: null, error: null }];
    expect(await repo.altaDocumentoCliente('t1', doc)).toBe('ok');
    const insert = registros.find((g) => g.ops.some(([op]) => op === 'insert'));
    expect(insert?.ops.find(([op]) => op === 'insert')?.[1]).toEqual({
      tenant_id: 't1', cliente_id: 'c1', nombre: 'Documento demo A', tipo: 'basico', requiere_firma: true, requiere_sello: false,
    });
    expect(registros[0].ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(registros[0].ops).toContainEqual(['eq', 'cliente_id', 'c1']);
  });
  it('con 30 documentos ya, dice «tope» y no inserta', async () => {
    respuestas = [{ data: Array.from({ length: 30 }, (_, i) => ({ id: `x${i}` })), error: null }];
    expect(await repo.altaDocumentoCliente('t1', doc)).toBe('tope');
    expect(registros.some((g) => g.ops.some(([op]) => op === 'insert'))).toBe(false);
  });
  it('nombre repetido (23505) → duplicado; cliente de otra flota (23503) → cliente_inexistente', async () => {
    respuestas = [{ data: [], error: null }, { error: { message: 'duplicate key', code: '23505' } }];
    expect(await repo.altaDocumentoCliente('t1', doc)).toBe('duplicado');
    respuestas = [{ data: [], error: null }, { error: { message: 'violates foreign key', code: '23503' } }];
    expect(await repo.altaDocumentoCliente('t1', doc)).toBe('cliente_inexistente');
  });
  it('otro error de la base se lanza (no finge que guardó)', async () => {
    respuestas = [{ data: [], error: null }, { error: { message: 'timeout', code: '57014' } }];
    await expect(repo.altaDocumentoCliente('t1', doc)).rejects.toThrow(/documentos_cliente_alta/);
  });
});

describe('bajaDocumentoCliente', () => {
  it('borra solo ESE documento de ESA flota y dice si existía', async () => {
    respuestas = [{ data: [{ id: 'd1' }], error: null }];
    expect(await repo.bajaDocumentoCliente('t1', 'd1')).toBe(true);
    expect(registros[0].ops.some(([op]) => op === 'delete')).toBe(true);
    expect(registros[0].ops).toContainEqual(['eq', 'id', 'd1']);
    expect(registros[0].ops).toContainEqual(['eq', 'tenant_id', 't1']);
  });
  it('un id de otra flota (0 filas) da false; un error de base se lanza', async () => {
    respuestas = [{ data: [], error: null }];
    expect(await repo.bajaDocumentoCliente('t1', 'd-ajeno')).toBe(false);
    respuestas = [{ error: { message: 'timeout', code: '57014' } }];
    await expect(repo.bajaDocumentoCliente('t1', 'd1')).rejects.toThrow(/documentos_cliente_baja/);
  });
});
