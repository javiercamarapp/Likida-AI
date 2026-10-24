// A37-S15-01 / A37-S55-01: la bandeja de proveedores solo recibe CFDI de tipo I.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserts: Array<Record<string, unknown>> = [];
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (f: Record<string, unknown>) => {
        inserts.push(f);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'f-1' }, error: null }) }) };
      },
    }),
  }),
}));

import { guardarFacturaProveedor } from './proveedores';
import type { CfdiXmlData } from './intake/cfdi_xml';

const base = (tipo: string | undefined): CfdiXmlData => ({
  uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001', total: 1160, subTotal: 1000, ivaTraslado: 160,
  rfcEmisor: 'AAA010101AB1', rfcReceptor: 'BBB020202BB2', fecha: '2026-10-01T10:00:00',
  conceptos: [{}], lineas: [], tipoComprobante: tipo,
} as unknown as CfdiXmlData);

beforeEach(() => { inserts.length = 0; });

describe('guardarFacturaProveedor — solo facturas de compra', () => {
  for (const tipo of ['E', 'P', 'T', 'N']) {
    it(`un CFDI tipo ${tipo} NO entra a la bandeja (no_es_compra) y no se inserta nada`, async () => {
      const r = await guardarFacturaProveedor('t-1', base(tipo), '<xml/>', 'BBB020202BB2', 'subida');
      expect(r).toEqual({ ok: false, motivo: 'no_es_compra' });
      expect(inserts).toHaveLength(0);
    });
  }

  it('un CFDI tipo I entra igual que siempre', async () => {
    const r = await guardarFacturaProveedor('t-1', base('I'), '<xml/>', 'BBB020202BB2', 'subida');
    expect(r.ok).toBe(true);
    expect(inserts).toHaveLength(1);
  });
});
