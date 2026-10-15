import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import { casarNota } from './notas_credito';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const D = await import('./datos');
const T = 'tenant-1';
const f = (id: string, tenant: string, estado: string, rec: number, acr: number, fecha = '2026-08-01') =>
  ({ id, tenant_id: tenant, estado, monto_reclamado: rec, monto_acreditado: acr, fecha_cobro_mas_antiguo: fecha });

beforeEach(() => { db = crearDbFalsa({}); });

describe('reclamosParaCasar', () => {
  it('trae solo enviados/parciales de la flota, con el saldo por acreditar', async () => {
    db.tablas.peaje_reclamo = [
      f('a', T, 'enviado', 250, 0), f('b', T, 'acreditado_parcial', 1000, 400, '2026-07-01'),
      f('c', T, 'preparado', 90, 0), f('d', T, 'acreditado', 50, 50), f('e', 'tenant-2', 'enviado', 250, 0),
      f('g', T, 'enviado', 100, 100),
    ];
    const r = await D.reclamosParaCasar(T);
    expect(r.map((x) => [x.id, x.montoReclamable])).toEqual([['b', 600], ['a', 250]]);
    expect(casarNota({ importe: 250 }, r)).toMatchObject({ tipo: 'seguro', reclamoIds: ['a'] });
  });

  it('lanza si la base falla (no devuelve lista vacía engañosa)', async () => {
    db.fallar('peaje_reclamo.select', 'caída');
    await expect(D.reclamosParaCasar(T)).rejects.toThrow();
  });
});
