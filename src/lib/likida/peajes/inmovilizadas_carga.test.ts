import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

// A2 ola 1 · la pantalla de carga de unidades inmovilizadas: importar (ya existía, sin llamador) y quitar una ventana.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const R = await import('./repo');

const T = 'tenant-1';
const OTRO = 'tenant-2';
const UUID1 = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const bytes = (t: string) => new TextEncoder().encode(t);

beforeEach(() => {
  db = crearDbFalsa({
    unidad: [{ id: 'u1', tenant_id: T, numero_economico: 'C2-08', placas: 'ABC123' }],
    peaje_unidad_inmovilizada: [
      { id: UUID1, tenant_id: T, unidad_id: 'u1', desde: '2026-09-03', hasta: null, motivo: 'taller', nota: null },
      { id: UUID2, tenant_id: OTRO, unidad_id: 'ux', desde: '2026-09-03', hasta: null, motivo: 'taller', nota: null },
    ],
  });
});

describe('importarInmovilizadasArchivo desde la pantalla', () => {
  it('carga el CSV de la plantilla (unidad;desde;hasta;motivo;nota) y repetirlo es seguro', async () => {
    const csv = 'unidad;desde;hasta;motivo;nota\nC2-08;2026-09-10;2026-09-12;siniestro;choque\nZZ-99;2026-09-10;;baja;\n';
    const r = await R.importarInmovilizadasArchivo(T, 'inmovilizadas.csv', bytes(csv));
    expect(r).toMatchObject({ ok: true, guardadas: 1 });
    expect(r.rechazadas).toEqual([{ fila: 3, motivo: expect.stringMatching(/unidad/i) }]);
    const otra = await R.importarInmovilizadasArchivo(T, 'inmovilizadas.csv', bytes(csv));
    expect(otra).toMatchObject({ ok: true, guardadas: 1, actualizadas: 0 });
    expect((await R.listarInmovilizadas(T)).filter((x) => x.motivo === 'siniestro')).toHaveLength(1);
  });
});

describe('quitarInmovilizada', () => {
  it('quita la ventana de la flota', async () => {
    expect(await R.quitarInmovilizada(T, UUID1)).toBe(true);
    expect(db.tablas.peaje_unidad_inmovilizada.map((x) => x.id)).toEqual([UUID2]);
  });
  it('no toca la ventana de otra flota (false, y sigue ahí)', async () => {
    expect(await R.quitarInmovilizada(T, UUID2)).toBe(false);
    expect(db.tablas.peaje_unidad_inmovilizada).toHaveLength(2);
  });
  it('un id que no es uuid se rechaza sin consultar', async () => {
    const antes = db.llamadas.length;
    expect(await R.quitarInmovilizada(T, "x' or '1'='1")).toBe(false);
    expect(db.llamadas.length).toBe(antes);
  });
  it('un error de base es false, no «quitada»', async () => {
    db.fallar('peaje_unidad_inmovilizada.delete', 'boom');
    expect(await R.quitarInmovilizada(T, UUID1)).toBe(false);
  });
});
