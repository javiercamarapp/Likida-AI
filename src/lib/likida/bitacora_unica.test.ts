import { describe, it, expect, vi, beforeEach } from 'vitest';

// Idempotencia de anotarBitacora({ unica: true }): el mismo emailId reenviado (Resend reintenta) no duplica filas en cp_correo.descartes.
const insert = vi.fn();
let existentes: unknown[] = [];
let falloConsulta = false;
const filtros: Array<[string, unknown]> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (fila: unknown) => insert(fila),
      select: () => {
        const q: Record<string, unknown> = {};
        q.eq = (c: string, v: unknown) => { filtros.push([c, v]); return q; };
        q.is = (c: string, v: unknown) => { filtros.push([c, v]); return q; };
        q.limit = async () => (falloConsulta ? { data: null, error: { message: 'caída' } } : { data: existentes, error: null });
        return q;
      },
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { anotarBitacora } = await import('./bitacora_escritura');
const entrada = { tenantId: 't-1', actor: 'sistema' as const, accion: 'cp_correo.descartes', entidad: 'cp_correo' as const, entidadId: 'em-1', detalle: { total: 1 } };

beforeEach(() => { insert.mockReset(); insert.mockResolvedValue({ error: null }); existentes = []; falloConsulta = false; filtros.length = 0; });

describe('anotarBitacora con unica', () => {
  it('la primera vez inserta', async () => {
    expect(await anotarBitacora(entrada, { unica: true })).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(filtros).toEqual(expect.arrayContaining([['accion', 'cp_correo.descartes'], ['entidad_id', 'em-1'], ['tenant_id', 't-1']]));
  });
  it('el mismo emailId reenviado NO inserta otra fila', async () => {
    existentes = [{ id: 1 }];
    expect(await anotarBitacora(entrada, { unica: true })).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });
  it('sin unica el comportamiento es el de siempre (inserta aunque exista)', async () => {
    existentes = [{ id: 1 }];
    await anotarBitacora(entrada);
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it('si la consulta previa falla se anota igual (mejor un duplicado que perder el rastro)', async () => {
    falloConsulta = true;
    await anotarBitacora(entrada, { unica: true });
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it('tenant null se compara con is null', async () => {
    await anotarBitacora({ ...entrada, tenantId: null }, { unica: true });
    expect(filtros).toContainEqual(['tenant_id', null]);
  });
});
