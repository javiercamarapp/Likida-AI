import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const { operadorConUnidadDetenida } = await import('./compuerta_operador');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');

// A39-A5-03 — todo sintético. El reloj va fijo.
const AHORA = new Date('2026-10-10T18:00:00.000Z');
const haceMin = (m: number) => new Date(AHORA.getTime() - m * 60_000);
const CFG = { ...CONFIG_CONDUCTOR_DEFAULT, compuertaMovimientoActiva: true };
const viaje = (id: string, unidadId: string | null) => ({ id, tenantId: 't1', unidadId, operadorId: 'o1' }) as never;
const quieta = (n = 4) => Array.from({ length: n }, (_, i) => ({ lat: 20.7, lng: -103.4, medidaEn: haceMin(4 - i), velocidadKmh: 0 }));
const puertos = (viajes: unknown[], muestras: Record<string, unknown[]>, falla = false) => ({
  viajesAbiertos: vi.fn(async () => { if (falla) throw new Error('caída'); return viajes as never; }),
  gps: { muestrasUnidad: vi.fn(async () => new Map(Object.entries(muestras)) as never), sitiosDe: vi.fn(async () => new Map()) },
});

describe('operadorConUnidadDetenida', () => {
  it('unidad quieta con muestras suficientes: permitido', async () => {
    const p = puertos([viaje('v1', 'u1')], { 't1|u1': quieta() });
    expect(await operadorConUnidadDetenida('t1', '521', CFG, AHORA, p)).toMatchObject({ permitido: true });
  });
  it('unidad en marcha (velocidad del proveedor): NO', async () => {
    const m = quieta().map((x) => ({ ...x, velocidadKmh: 70 }));
    const r = await operadorConUnidadDetenida('t1', '521', CFG, AHORA, puertos([viaje('v1', 'u1')], { 't1|u1': m }));
    expect(r).toEqual({ permitido: false, razon: 'conduciendo' });
  });
  it('compuerta de movimiento apagada: NO (no hay forma de saber si va rodando)', async () => {
    const r = await operadorConUnidadDetenida('t1', '521', { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA, puertos([viaje('v1', 'u1')], { 't1|u1': quieta() }));
    expect(r).toEqual({ permitido: false, razon: 'compuerta_de_movimiento_apagada' });
  });
  it('sin viaje abierto, viaje sin unidad, lectura fallida o sin GPS: NO (fail-closed)', async () => {
    expect((await operadorConUnidadDetenida('t1', '521', CFG, AHORA, puertos([], {}))).permitido).toBe(false);
    expect(await operadorConUnidadDetenida('t1', '521', CFG, AHORA, puertos([viaje('v1', null)], {}))).toEqual({ permitido: false, razon: 'sin_unidad' });
    expect(await operadorConUnidadDetenida('t1', '521', CFG, AHORA, puertos([], {}, true))).toEqual({ permitido: false, razon: 'lectura_fallida' });
    expect(await operadorConUnidadDetenida('t1', '521', CFG, AHORA, puertos([viaje('v1', 'u1')], {}))).toEqual({ permitido: false, razon: 'sin_gps' });
  });
  it('con dos viajes abiertos basta UNA unidad en marcha para callar', async () => {
    const enMarcha = quieta().map((x) => ({ ...x, velocidadKmh: 60 }));
    const r = await operadorConUnidadDetenida('t1', '521', CFG, AHORA, puertos([viaje('v1', 'u1'), viaje('v2', 'u2')], { 't1|u1': quieta(), 't1|u2': enMarcha }));
    expect(r.permitido).toBe(false);
  });
});
