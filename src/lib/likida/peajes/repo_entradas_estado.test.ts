import { describe, it, expect, vi } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

// Igual que el buzón: una flota SIN fila en peaje_ingesta_config tiene todas las entradas apagadas; no es «no se pudo leer».

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { leerEstadoEntradas, ENTRADAS_SIN_CONFIGURAR } = await import('./repo');

describe('leerEstadoEntradas', () => {
  it('sin fila → todo apagado, sin error', async () => {
    db = crearDbFalsa({ peaje_ingesta_config: [] });
    const r = await leerEstadoEntradas('flota-nueva');
    expect(r).toEqual(ENTRADAS_SIN_CONFIGURAR);
    expect(r.correoActivo).toBe(false);
    expect(r.pullActivo).toBe(false);
    expect(r.sftpActivo).toBe(false);
  });

  it('con fila → sus valores reales', async () => {
    db = crearDbFalsa({ peaje_ingesta_config: [{ tenant_id: 'flota-1', correo_activo: true, correo_token: 'tok', pull_activo: true, pull_url: 'https://x.test/c', pull_intervalo_min: 30 }] });
    const r = await leerEstadoEntradas('flota-1');
    expect(r).toMatchObject({ correoActivo: true, correoToken: 'tok', pullActivo: true, pullUrl: 'https://x.test/c', pullIntervaloMin: 30 });
  });
});
