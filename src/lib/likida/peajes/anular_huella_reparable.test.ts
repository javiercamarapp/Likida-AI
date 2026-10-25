import { describe, it, expect, vi } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { anularDesgloseDb } = await import('./repo');

const T = 'flota-a37';
const D = '11111111-1111-4111-8111-111111111111';
const estado = () => ({
  desglose_peaje: [{ id: D, tenant_id: T, anulado_en: null }],
  peaje_ingesta_archivo: [{ id: 'a1', tenant_id: T, desglose_id: D, huella: 'huella-original' }],
});

// A37-S11-05
describe('A37-S11-05: anular un desglose repara la huella tras un corte', () => {
  it('si falla la liberación de la huella, NO responde «anulado» y el reintento la libera', async () => {
    db = crearDbFalsa(estado());
    db.fallar('peaje_ingesta_archivo.update', 'corte de red');
    await expect(anularDesgloseDb(T, D, 'subido por error', 'ana')).rejects.toThrow(/huella/);
    expect(db.tablas.peaje_ingesta_archivo[0].huella).toBe('huella-original');
    expect(db.tablas.desglose_peaje[0].anulado_en).not.toBeNull();

    // Reintento con la base ya sana: el desglose ya está anulado, pero la huella se libera.
    db = crearDbFalsa({ desglose_peaje: db.tablas.desglose_peaje, peaje_ingesta_archivo: db.tablas.peaje_ingesta_archivo });
    expect(await anularDesgloseDb(T, D, 'otra vez', 'beto')).toBe('ya_anulado');
    expect(db.tablas.peaje_ingesta_archivo[0].huella).not.toBe('huella-original');
  });

  it('no_encontrado no toca archivos de otro desglose', async () => {
    db = crearDbFalsa(estado());
    expect(await anularDesgloseDb(T, '22222222-2222-4222-8222-222222222222', 'x', 'ana')).toBe('no_encontrado');
    expect(db.tablas.peaje_ingesta_archivo[0].huella).toBe('huella-original');
  });
});
