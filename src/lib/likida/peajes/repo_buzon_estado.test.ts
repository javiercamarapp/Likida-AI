import { describe, it, expect, vi } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

// Una flota SIN fila en peaje_ingesta_config no tiene el buzón activado: es «desactivado», no «no se pudo leer».
// Antes la pantalla confundía «sin fila» (null) con «lectura fallida» (null) y mostraba un error falso en toda flota nueva.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { leerEstadoBuzon, BUZON_SIN_ACTIVAR } = await import('./repo');

describe('leerEstadoBuzon', () => {
  it('sin fila → desactivado (rotación 1), no un error', async () => {
    db = crearDbFalsa({ peaje_ingesta_config: [] });
    expect(await leerEstadoBuzon('flota-nueva')).toEqual(BUZON_SIN_ACTIVAR);
    expect(BUZON_SIN_ACTIVAR).toEqual({ activa: false, rotacion: 1 });
  });

  it('con fila activa → su estado y su rotación reales', async () => {
    db = crearDbFalsa({ peaje_ingesta_config: [{ tenant_id: 'flota-1', activa: true, rotacion: 3 }] });
    expect(await leerEstadoBuzon('flota-1')).toEqual({ activa: true, rotacion: 3 });
  });
});
