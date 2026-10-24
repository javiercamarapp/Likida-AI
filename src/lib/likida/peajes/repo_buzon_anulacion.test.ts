import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

// A37-S64-04 (activar no revierte la rotación; rotar no informa éxito sin filas) y
// A37-S64-05 (anular no traga el fallo al liberar la huella). Datos sintéticos.
let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const T = 'tenant-a';

describe('A37-S64-04 buzón firmado: activar y rotar', () => {
  beforeEach(() => { db = crearDbFalsa({ peaje_ingesta_config: [{ tenant_id: T, rotacion: 4, activa: false }] }); });

  it('activar NO reescribe la rotación: una rotación hecha después de leer sobrevive', async () => {
    const { activarBuzon } = await import('./repo');
    // La rotación ya es 4 (otro admin rotó tras la fuga); activar no puede devolverla a 3.
    expect(await activarBuzon(T)).toBe(true);
    expect(db.tablas.peaje_ingesta_config[0]).toMatchObject({ activa: true, rotacion: 4 });
  });

  it('con la fila existente, ninguna escritura de activar lleva `rotacion` (no puede revertir una rotación ajena)', async () => {
    const { activarBuzon } = await import('./repo');
    await activarBuzon(T);
    const escrituras = db.llamadas.filter((l) => l.op !== 'select');
    expect(escrituras.length).toBeGreaterThan(0);
    for (const e of escrituras) expect(Object.keys((e.payload ?? {}) as object)).not.toContain('rotacion');
  });

  it('activar sin fila previa la crea con rotación 1', async () => {
    db = crearDbFalsa({ peaje_ingesta_config: [] });
    const { activarBuzon } = await import('./repo');
    expect(await activarBuzon(T)).toBe(true);
    expect(db.tablas.peaje_ingesta_config[0]).toMatchObject({ tenant_id: T, activa: true, rotacion: 1 });
  });

  it('rotar sube la rotación cuando la fila existe', async () => {
    const { rotarLlaveBuzon } = await import('./repo');
    expect(await rotarLlaveBuzon(T)).toBe(true);
    expect(db.tablas.peaje_ingesta_config[0].rotacion).toBe(5);
  });

  it('rotar con la fila ausente o el CAS perdido devuelve false, no éxito', async () => {
    const { rotarLlaveBuzon } = await import('./repo');
    // El CAS pierde: otra pestaña rota entre la lectura (1.ª llamada) y la escritura (2.ª).
    const original = db.cliente.from.bind(db.cliente);
    let n = 0;
    db.cliente.from = ((t: string) => {
      if (t === 'peaje_ingesta_config' && ++n === 2) db.tablas.peaje_ingesta_config[0].rotacion = 5;
      return original(t);
    }) as typeof db.cliente.from;
    expect(await rotarLlaveBuzon(T)).toBe(false);
    expect(db.tablas.peaje_ingesta_config[0].rotacion).toBe(5);
  });
});

describe('A37-S64-05 anular un desglose: la huella se libera o se avisa', () => {
  const D = 'd1';
  beforeEach(() => {
    db = crearDbFalsa({
      desglose_peaje: [{ id: D, tenant_id: T, anulado_en: null }],
      peaje_ingesta_archivo: [{ id: 'a1', tenant_id: T, desglose_id: D, huella: 'h1' }],
    });
  });

  it('si falla la liberación de la huella lanza error (no responde «anulado»)', async () => {
    db.fallar('peaje_ingesta_archivo.update', 'caída');
    const { anularDesgloseDb } = await import('./repo');
    await expect(anularDesgloseDb(T, D, 'error', 'ana')).rejects.toThrow(/huella/);
  });

  it('el reintento tras ese fallo (ya anulado) libera la huella pendiente', async () => {
    db.fallar('peaje_ingesta_archivo.update', 'caída');
    const { anularDesgloseDb } = await import('./repo');
    await expect(anularDesgloseDb(T, D, 'error', 'ana')).rejects.toThrow();
    db = crearDbFalsa({ ...db.tablas }); // la caída pasó
    expect(await anularDesgloseDb(T, D, 'otra vez', 'beto')).toBe('ya_anulado');
    expect(db.tablas.peaje_ingesta_archivo[0].huella).not.toBe('h1');
  });

  it('el camino feliz libera la huella y devuelve anulado', async () => {
    const { anularDesgloseDb } = await import('./repo');
    expect(await anularDesgloseDb(T, D, 'error', 'ana')).toBe('anulado');
    expect(db.tablas.peaje_ingesta_archivo[0].huella).not.toBe('h1');
  });
});
