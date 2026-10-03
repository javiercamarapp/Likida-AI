import { describe, it, expect, vi, beforeEach } from 'vitest';

// Las funciones de repo.ts que sirven al worker (0640-0642): contra una base CON la 0641 (las RPC) y contra una
// base SIN ella (cae a una consulta directa con la misma regla; los avisos quedan apagados). Supabase es un doble.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type Respuesta = { data: unknown; error: { message: string; code?: string } | null };
let rpcs: Record<string, Respuesta> = {};
let filasDirectas: Respuesta = { data: [], error: null };
const llamadasRpc: Array<{ nombre: string; args: Record<string, unknown> }> = [];
const AUSENTE = { message: 'Could not find the function public.cp_documentos_pendientes in the schema cache', code: 'PGRST202' };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (nombre: string, args: Record<string, unknown>) => {
      llamadasRpc.push({ nombre, args });
      return Promise.resolve(rpcs[nombre] ?? { data: null, error: { message: `rpc ${nombre} sin guion` } });
    },
    from: () => {
      const n: Record<string, unknown> = {};
      for (const m of ['select', 'is', 'not', 'lt', 'in', 'order', 'limit']) n[m] = () => n;
      n.then = (ok: (v: Respuesta) => unknown) => Promise.resolve(filasDirectas).then(ok);
      return n;
    },
  }),
}));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const repo = await import('./repo');

const AHORA = new Date('2026-10-02T12:00:00Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();

beforeEach(() => { rpcs = {}; filasDirectas = { data: [], error: null }; llamadasRpc.length = 0; });

describe('la espera de un fallido (espeja la 0641)', () => {
  it('15, 30, 60, 120 minutos según los intentos', () => {
    expect([1, 2, 3, 4].map(repo.esperaFallidoMin)).toEqual([15, 30, 60, 120]);
    expect(repo.esperaFallidoMin(0)).toBe(15);
  });
});

describe('funcionAusente', () => {
  it('reconoce que la migración no se aplicó (PostgREST o Postgres) y no confunde otros errores', () => {
    expect(repo.funcionAusente({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(repo.funcionAusente({ code: '42883', message: 'x' })).toBe(true);
    expect(repo.funcionAusente({ message: 'Could not find the function public.x in the schema cache' })).toBe(true);
    expect(repo.funcionAusente({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(repo.funcionAusente(null)).toBe(false);
  });
});

describe('documentosPendientes', () => {
  it('con la 0641: usa la RPC con el tope de intentos y la gracia', async () => {
    rpcs.cp_documentos_pendientes = { data: [{ tenant_id: 't1', id: 'd1', estado: 'recibido', intentos: 0 }], error: null };
    expect(await repo.documentosPendientes(10, AHORA)).toEqual([{ tenantId: 't1', id: 'd1', estado: 'recibido', intentos: 0 }]);
    expect(llamadasRpc[0]).toEqual({ nombre: 'cp_documentos_pendientes', args: { p_limite: 10, p_max_intentos: 5, p_gracia_segundos: 120 } });
  });

  it('un error que NO es «la función no existe» se lanza (nunca se lee como «no hay nada»)', async () => {
    rpcs.cp_documentos_pendientes = { data: null, error: { message: 'statement timeout', code: '57014' } };
    await expect(repo.documentosPendientes(10, AHORA)).rejects.toThrow(/statement timeout/);
  });

  it('SIN la 0641: la misma regla por consulta directa — gracia, lease vencido, espera creciente, orden', async () => {
    rpcs.cp_documentos_pendientes = { data: null, error: AUSENTE };
    filasDirectas = {
      error: null,
      data: [
        { tenant_id: 't1', id: 'recibido-viejo', estado: 'recibido', intentos: 0, created_at: hace(30), updated_at: hace(30), procesando_hasta: null },
        { tenant_id: 't1', id: 'recibido-reciente', estado: 'recibido', intentos: 0, created_at: hace(1), updated_at: hace(1), procesando_hasta: null },
        { tenant_id: 't1', id: 'lease-vencido', estado: 'procesando', intentos: 1, created_at: hace(90), updated_at: hace(90), procesando_hasta: hace(5) },
        { tenant_id: 't1', id: 'lease-vivo', estado: 'procesando', intentos: 1, created_at: hace(90), updated_at: hace(1), procesando_hasta: new Date(AHORA.getTime() + 60_000).toISOString() },
        { tenant_id: 't1', id: 'fallido-listo', estado: 'fallido', intentos: 3, created_at: hace(300), updated_at: hace(90), procesando_hasta: null },
        { tenant_id: 't1', id: 'fallido-esperando', estado: 'fallido', intentos: 3, created_at: hace(300), updated_at: hace(30), procesando_hasta: null },
      ],
    };
    const r = await repo.documentosPendientes(25, AHORA);
    expect(r.map((x) => x.id)).toEqual(['recibido-viejo', 'lease-vencido', 'fallido-listo']);
  });

  it('SIN la 0641 y con el límite: corta después de ordenar', async () => {
    rpcs.cp_documentos_pendientes = { data: null, error: AUSENTE };
    filasDirectas = { error: null, data: [
      { tenant_id: 't1', id: 'f', estado: 'fallido', intentos: 1, created_at: hace(300), updated_at: hace(300), procesando_hasta: null },
      { tenant_id: 't1', id: 'r', estado: 'recibido', intentos: 0, created_at: hace(30), updated_at: hace(30), procesando_hasta: null },
    ] };
    expect((await repo.documentosPendientes(1, AHORA)).map((x) => x.id)).toEqual(['r']);
  });

  it('SIN la 0641 y la consulta directa también falla: se lanza', async () => {
    rpcs.cp_documentos_pendientes = { data: null, error: AUSENTE };
    filasDirectas = { data: null, error: { message: 'permiso denegado' } };
    await expect(repo.documentosPendientes(5, AHORA)).rejects.toThrow(/permiso denegado/);
  });
});

describe('las listas de aviso', () => {
  it('con la 0641: agotados y por avisar salen de sus RPC', async () => {
    rpcs.cp_documentos_agotados = { data: [{ tenant_id: 't1', id: 'z' }], error: null };
    rpcs.cp_documentos_por_avisar = { data: [{ tenant_id: 't2', id: 'x' }], error: null };
    expect(await repo.documentosAgotados(5)).toEqual([{ tenantId: 't1', id: 'z' }]);
    expect(await repo.documentosPorAvisar(0.85, 5)).toEqual([{ tenantId: 't2', id: 'x' }]);
    expect(llamadasRpc.map((c) => c.args)).toEqual([{ p_limite: 5, p_max_intentos: 5 }, { p_limite: 5, p_umbral: 0.85 }]);
  });

  it('SIN la 0641: devuelven null (avisos apagados), no una lista vacía que parezca «nada que avisar»', async () => {
    rpcs.cp_documentos_agotados = { data: null, error: AUSENTE };
    rpcs.cp_documentos_por_avisar = { data: null, error: AUSENTE };
    expect(await repo.documentosAgotados(5)).toBeNull();
    expect(await repo.documentosPorAvisar(0.85, 5)).toBeNull();
  });

  it('otro error se lanza', async () => {
    rpcs.cp_documentos_agotados = { data: null, error: { message: 'boom', code: 'XX000' } };
    await expect(repo.documentosAgotados(5)).rejects.toThrow(/boom/);
  });
});

describe('el candado de aviso a la oficina', () => {
  it('ganado / perdido según lo que conteste la RPC', async () => {
    rpcs.cp_documento_reclamar_aviso = { data: true, error: null };
    expect(await repo.reclamarAvisoDoc('t1', 'd1', 'hallazgos')).toBe('ganado');
    rpcs.cp_documento_reclamar_aviso = { data: false, error: null };
    expect(await repo.reclamarAvisoDoc('t1', 'd1', 'hallazgos')).toBe('perdido');
    expect(llamadasRpc[0].args).toEqual({ p_tenant: 't1', p_id: 'd1', p_tipo: 'hallazgos' });
  });

  it('SIN la 0641: `sin_migracion` (no hay candado atómico y no se avisa)', async () => {
    rpcs.cp_documento_reclamar_aviso = { data: null, error: { message: 'no existe', code: '42883' } };
    expect(await repo.reclamarAvisoDoc('t1', 'd1', 'agotado')).toBe('sin_migracion');
  });

  it('un error de la base al reclamar se lanza: no se avisa a ciegas', async () => {
    rpcs.cp_documento_reclamar_aviso = { data: null, error: { message: 'timeout', code: '57014' } };
    await expect(repo.reclamarAvisoDoc('t1', 'd1', 'agotado')).rejects.toThrow(/timeout/);
  });

  it('soltar devuelve si soltó; un fallo no lanza (queda en el log)', async () => {
    rpcs.cp_documento_liberar_aviso = { data: true, error: null };
    expect(await repo.liberarAvisoDoc('t1', 'd1', 'agotado')).toBe(true);
    rpcs.cp_documento_liberar_aviso = { data: null, error: { message: 'x' } };
    expect(await repo.liberarAvisoDoc('t1', 'd1', 'agotado')).toBe(false);
  });
});
