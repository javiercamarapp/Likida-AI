import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-S56-07: `saveCfdiXmlRaw` hacía upsert que SOBRESCRIBÍA la fila ya
// conservada: un reenvío con `gasto_id=null` desligaba el CFDI de su gasto y un
// XML con el mismo UUID pero contenido distinto reemplazaba al original (el que
// exige el CFF art. 30). Ahora el primero que llega se conserva.

type R = { data?: unknown; error: { message: string } | null };
const estado = vi.hoisted(() => ({
  insertado: [{ id: 'x1' }] as unknown[],
  errorInsert: null as { message: string } | null,
  existente: null as { xml: string; gasto_id: string | null } | null,
  upserts: [] as Array<[unknown, unknown]>,
  updates: [] as Array<{ set: unknown; filtros: unknown[][] }>,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      upsert: (fila: unknown, opts: unknown) => {
        estado.upserts.push([fila, opts]);
        return { select: async (): Promise<R> => ({ data: estado.errorInsert ? null : estado.insertado, error: estado.errorInsert }) };
      },
      select: () => {
        const b: Record<string, unknown> = {};
        b.eq = () => b;
        b.maybeSingle = async () => ({ data: estado.existente, error: null });
        return b;
      },
      update: (set: unknown) => {
        const rec = { set, filtros: [] as unknown[][] };
        estado.updates.push(rec);
        const b: Record<string, unknown> = {};
        b.eq = (...a: unknown[]) => { rec.filtros.push(['eq', ...a]); return b; };
        b.is = (...a: unknown[]) => { rec.filtros.push(['is', ...a]); return b; };
        b.then = (res: (v: unknown) => unknown) => res({ error: null });
        return b;
      },
    }),
  }),
}));
const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));
import { saveCfdiXmlRaw } from './repo';

beforeEach(() => {
  vi.clearAllMocks();
  estado.insertado = [{ id: 'x1' }];
  estado.errorInsert = null;
  estado.existente = null;
  estado.upserts.length = 0;
  estado.updates.length = 0;
});

describe('saveCfdiXmlRaw', () => {
  it('confirma el XML conservado, aislado por flota, UUID normalizado y SIN sobrescribir (ignoreDuplicates)', async () => {
    expect(await saveCfdiXmlRaw('tenant-A', ' ABCD-1234 ', null, '<credito/>')).toBe(true);
    expect(estado.upserts).toEqual([[
      { tenant_id: 'tenant-A', cfdi_uuid: 'abcd-1234', gasto_id: null, xml: '<credito/>' },
      { onConflict: 'tenant_id,cfdi_uuid', ignoreDuplicates: true },
    ]]);
  });

  it('un error de escritura devuelve false para no acusar persistencia inexistente', async () => {
    estado.errorInsert = { message: 'base no disponible' };
    expect(await saveCfdiXmlRaw('tenant-A', 'ABC', null, '<credito/>')).toBe(false);
  });

  it('A37-S56-07: el reenvío del MISMO XML con gasto_id null no desliga el gasto ya ligado', async () => {
    estado.insertado = [];
    estado.existente = { xml: '<cfdi a="1"/>', gasto_id: 'g-1' };
    expect(await saveCfdiXmlRaw('tenant-A', 'U-1', null, '<cfdi a="1"/>')).toBe(true);
    expect(estado.updates).toHaveLength(0);
  });

  it('A37-S56-07: el mismo XML con gasto_id nuevo liga el gasto SOLO si la fila no tenía uno', async () => {
    estado.insertado = [];
    estado.existente = { xml: '<cfdi a="1"/>', gasto_id: null };
    expect(await saveCfdiXmlRaw('tenant-A', 'U-1', 'g-9', ' <cfdi a="1"/>\n')).toBe(true);
    expect(estado.updates).toHaveLength(1);
    expect(estado.updates[0].set).toEqual({ gasto_id: 'g-9' });
    expect(estado.updates[0].filtros).toContainEqual(['is', 'gasto_id', null]);
  });

  it('A37-S56-07: un XML con el mismo UUID y contenido DISTINTO no reemplaza al original, conserva el original (true: no es un fallo reintentable) y lo registra', async () => {
    estado.insertado = [];
    estado.existente = { xml: '<cfdi total="100"/>', gasto_id: 'g-1' };
    expect(await saveCfdiXmlRaw('tenant-A', 'U-1', 'g-1', '<cfdi total="999"/>')).toBe(true);
    expect(estado.updates).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith('cfdi_xml.contenido_distinto', expect.not.objectContaining({ xml: expect.anything() }));
  });
});
