import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from '../peajes/db_falsa.test.util';

// A37-A2-02: la bitácora fiscal RMF 9.1.8 lista SOLO lo que la pantalla también llama «cuadra». Una línea que el cruce marcó
// `cuadra` pero que `clasificarVerificacion` degrada a «por verificar» (GPS que no coincide, TAG de otra unidad, ticket de baja
// confianza sin verificación independiente) NO se declara conciliada en el documento fiscal. Todo sintético.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const T = 'tenant-1';
const D = 'desglose-1';
const linea = (indice: number, monto: number, extra: Record<string, unknown> = {}) => ({
  id: `l${indice}`, tenant_id: T, desglose_id: D, indice, fecha: '2026-03-05', caseta: 'Caseta Ejemplo Norte', monto, tag: `TAG${indice}`,
  viaje_id: `v${indice}`, estatus: 'cuadra', detalle: null, gps_veredicto: null, gps_detalle: null, ...extra,
});

beforeEach(() => {
  db = crearDbFalsa({
    desglose_peaje: [{ id: D, tenant_id: T, proveedor: 'Proveedor Ejemplo', periodo_desde: '2026-03-01', periodo_hasta: '2026-03-10', anulado_en: null }],
    viaje: [0, 1, 2, 3, 4, 5].map((n) => ({ id: `v${n}`, tenant_id: T, folio: `F-${n}`, origen: 'Patio Ejemplo', destino: 'Destino Ejemplo', unidad_id: null })),
    desglose_peaje_linea: [
      linea(0, 100, { gps_veredicto: 'confirma' }),                                   // cuadra de verdad
      linea(1, 200, { gps_veredicto: 'no_coincide' }),                                // GPS lejos → por verificar
      linea(2, 300, { detalle: { alerta: 'unidad_distinta' } }),                      // TAG de otra unidad → por verificar
      linea(3, 400, { detalle: { bajaConfianzaSinVerificacion: true } }),             // ticket dudoso → por verificar
      linea(4, 50),                                                                   // cuadra por gasto (GPS sin datos)
      linea(5, 999, { estatus: 'no_cuadra' }),                                        // nunca entra
    ],
  });
});

describe('A37-A2-02: la bitácora RMF 9.1.8 no declara conciliado lo que está «por verificar»', () => {
  it('solo salen las líneas que la pantalla llama «cuadra»', async () => {
    const { bitacoraRmf918 } = await import('./desglose_peaje');
    const b = await bitacoraRmf918(T, D);
    expect(b).not.toBeNull();
    const total = (b?.filas ?? []).reduce((s, f) => s + f.montoConciliado, 0);
    expect(b?.filas).toHaveLength(2);
    expect(total).toBe(150);
  });

  it('el CSV fiscal no suma como conciliado el monto de las líneas por verificar', async () => {
    const { bitacoraRmf918, bitacoraACsv } = await import('./desglose_peaje');
    const csv = bitacoraACsv((await bitacoraRmf918(T, D))!);
    expect(csv).toContain('F-0');
    expect(csv).toContain('F-4');
    expect(csv).not.toMatch(/F-[123]\b/);
  });
});
