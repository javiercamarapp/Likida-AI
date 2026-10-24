// A37-L-07: el barrido de flotas con `.limit(200)` debe tener ORDEN (las más
// atrasadas primero, NULL = nunca descargada primero) y desempate por llave.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('./index', () => ({
  resolverDescargaSat: () => ({ nombre: 'sw', solicitar: vi.fn(), verificar: vi.fn(), descargar: vi.fn(), credencial: vi.fn() }),
  estadoDescargaSat: () => ({ configurado: true, proveedor: 'sw', motivo: null }),
}));

const ordenes: Array<{ tabla: string; col: string; opts: unknown }> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from(tabla: string) {
      const b: Record<string, unknown> = {};
      const cadena = () => b;
      Object.assign(b, {
        select: cadena, limit: cadena, eq: cadena, in: cadena, is: cadena,
        order: (col: string, opts?: unknown) => { ordenes.push({ tabla, col, opts }); return b; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(res, rej),
      });
      return b;
    },
  }),
}));

import { correrDescargaSat } from './ciclo';

beforeEach(() => { ordenes.length = 0; });

describe('A37-L-07 · el barrido de flotas tiene orden', () => {
  it('ordena sat_descarga_config por ultima_descarga_hasta ascendente (nulos primero) y desempata por tenant_id', async () => {
    await correrDescargaSat(new Date('2026-10-23T12:00:00Z'));
    const o = ordenes.filter((x) => x.tabla === 'sat_descarga_config');
    expect(o.map((x) => x.col)).toEqual(['ultima_descarga_hasta', 'tenant_id']);
    expect(o[0].opts).toMatchObject({ ascending: true, nullsFirst: true });
  });
});
