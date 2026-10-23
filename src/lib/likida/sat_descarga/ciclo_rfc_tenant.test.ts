// A37-S57-01 / A37-S18-01 (CRÍTICO): el barrido del cron SOLO pide el buzón
// cuyo RFC es el fiscal verificado del tenant (`tenant.rfc`).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: <T,>(q: T) => q }));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const solicitar = vi.fn(async () => ({ ok: true, requestId: 'req-1' }));
const prov = {
  nombre: 'sw', solicitar,
  verificar: vi.fn(), descargar: vi.fn(), credencial: vi.fn(),
};
vi.mock('./index', () => ({
  resolverDescargaSat: () => prov,
  estadoDescargaSat: () => ({ configurado: true, proveedor: 'sw', motivo: null }),
}));

let configs: Array<Record<string, unknown>> = [];
let tenants: Array<Record<string, unknown>> = [];
let errTenant: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from(tabla: string) {
      const b: Record<string, unknown> = {};
      let verbo = 'select';
      const cadena = () => b;
      Object.assign(b, {
        select: cadena, order: cadena, limit: cadena, eq: cadena, in: cadena, is: cadena,
        insert: () => { verbo = 'insert'; return b; },
        update: () => { verbo = 'update'; return b; },
        single: () => Promise.resolve({ data: { id: 'sol-1' }, error: null }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          let r: { data: unknown; error: unknown };
          if (tabla === 'sat_descarga_config' && verbo === 'select') r = { data: configs, error: null };
          else if (tabla === 'tenant') r = { data: errTenant ? null : tenants, error: errTenant };
          else r = { data: verbo === 'select' ? [] : null, error: null };
          return Promise.resolve(r).then(res, rej);
        },
      });
      return b;
    },
  }),
}));

import { correrDescargaSat } from './ciclo';

beforeEach(() => {
  vi.clearAllMocks();
  errTenant = null;
  configs = [
    { tenant_id: A, rfc: 'AAA010101AB1', ultima_descarga_hasta: '2026-10-22' },
    { tenant_id: B, rfc: 'AAA010101AB1', ultima_descarga_hasta: '2026-10-22' }, // declara el RFC de A
  ];
  tenants = [{ id: A, rfc: 'AAA010101AB1' }, { id: B, rfc: 'BBB020202BB2' }];
});

describe('correrDescargaSat · el RFC del buzón es el del tenant', () => {
  it('la flota que declaró el RFC de OTRA no pide nada al SAT; la dueña sí', async () => {
    const r = await correrDescargaSat(new Date('2026-10-23T12:00:00Z'));
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(solicitar.mock.calls[0]).toEqual([expect.objectContaining({ rfc: 'AAA010101AB1' })]);
    const delB = r.resumenes.find((x) => x.tenantId === B)!;
    expect(delB.errores.join(' ')).toMatch(/no coincide con el RFC fiscal verificado/);
    expect(delB.solicitadas).toBe(0);
  });

  it('un tenant SIN rfc fiscal tampoco descarga (fail-closed)', async () => {
    tenants = [{ id: A, rfc: null }, { id: B, rfc: null }];
    await correrDescargaSat(new Date('2026-10-23T12:00:00Z'));
    expect(solicitar).not.toHaveBeenCalled();
  });

  it('si no se puede leer tenant.rfc, el barrido falla cerrado', async () => {
    errTenant = { message: 'timeout' };
    await expect(correrDescargaSat(new Date('2026-10-23T12:00:00Z'))).rejects.toThrow('timeout');
    expect(solicitar).not.toHaveBeenCalled();
  });
});
