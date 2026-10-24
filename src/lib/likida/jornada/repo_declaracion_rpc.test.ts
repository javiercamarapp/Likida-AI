import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S48-01: la declaración del chofer de un extremo de la jornada va por la RPC 0865 (sustituye la marca derivada viva, no
// pisa una humana) y cae al INSERT de siempre si la base aún no la tiene. Datos sintéticos.

type Resp = { data: unknown; error: { message: string; code?: string } | null };
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
const inserts: Array<Record<string, unknown>> = [];
let rpcResp: Resp = { data: 'asentado', error: null };
let insertResp: Resp = { data: { id: 'a-1' }, error: null };

vi.mock('../presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return Promise.resolve(rpcResp); },
    from: () => ({ insert: (fila: Record<string, unknown>) => { inserts.push(fila); return { select: () => ({ maybeSingle: () => Promise.resolve(insertResp) }) }; } }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { asentarMarca } = await import('./repo');

const marca = (extra: Record<string, unknown> = {}) => ({
  jornadaId: 'j-1', tenantId: 't-1', tipo: 'inicio_jornada' as const, momento: new Date('2026-10-14T12:10:00Z'),
  procedencia: 'declarado_operador' as const, waMessageId: 'wamid-1', ...extra,
});

beforeEach(() => { rpcs.length = 0; inserts.length = 0; rpcResp = { data: 'asentado', error: null }; insertResp = { data: { id: 'a-1' }, error: null }; });

describe('asentarMarca: la declaración del chofer de un extremo', () => {
  it('va por la RPC 0865 con la flota y el mensaje, NO por el INSERT que rebotaba contra la derivada', async () => {
    expect(await asentarMarca(marca())).toBe('asentado');
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].fn).toBe('asentar_declaracion_jornada');
    expect(rpcs[0].args).toMatchObject({ p_jornada_id: 'j-1', p_tenant_id: 't-1', p_tipo: 'inicio_jornada', p_wa_message_id: 'wamid-1' });
    expect(inserts).toHaveLength(0);
  });

  it('también el fin de jornada: «asentado» (antes «Ya lo tenía anotado» y sin resumen ni conformidad)', async () => {
    expect(await asentarMarca(marca({ tipo: 'fin_jornada' }))).toBe('asentado');
    expect(rpcs[0].args).toMatchObject({ p_tipo: 'fin_jornada' });
  });

  it('una marca humana viva o el mismo mensaje reentregado: «ya_estaba»', async () => {
    rpcResp = { data: 'ya_estaba', error: null };
    expect(await asentarMarca(marca())).toBe('ya_estaba');
  });

  it('un error de la base NO se contesta «ya estaba»: es un fallo que el chofer puede reintentar', async () => {
    rpcResp = { data: null, error: { message: 'conexión rota', code: '08006' } };
    expect(await asentarMarca(marca())).toBe('fallo');
    expect(inserts).toHaveLength(0);
  });

  it('si la base aún no tiene la 0865, cae al INSERT de siempre (y el 23505 sigue siendo «ya_estaba»)', async () => {
    rpcResp = { data: null, error: { message: 'Could not find the function public.asentar_declaracion_jornada', code: 'PGRST202' } };
    expect(await asentarMarca(marca())).toBe('asentado');
    expect(inserts).toHaveLength(1);
    insertResp = { data: null, error: { message: 'duplicate key', code: '23505' } };
    expect(await asentarMarca(marca())).toBe('ya_estaba');
  });

  it('un descanso o una marca sin mensaje no pasan por la RPC (no tienen el índice de extremos)', async () => {
    await asentarMarca(marca({ tipo: 'inicio_descanso' }));
    await asentarMarca(marca({ waMessageId: undefined }));
    expect(rpcs).toHaveLength(0);
    expect(inserts).toHaveLength(2);
  });
});
