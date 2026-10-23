import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from '../peajes/db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// REN-34-1 (auditoría 34): el cruce escribía UN UPDATE por línea cuando cada línea recibía una
// anotación DISTINTA (todas las que CUADRAN: cada una lleva su viaje, su diferencia y su gasto en
// `detalle`). El agrupado por «misma anotación» solo ayudaba al caso barato (sin contraparte).
// Aquí se mide el caso caro: N líneas que cuadran, cada una con su gasto → el nº de escrituras a la
// base debe ser ~N/500, no N; el resultado por línea es el mismo y no se toca otra flota.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async () => {} }));

const { conciliarDesglose, LOTE_ESCRITURA_LINEAS } = await import('./desglose_peaje');

const T = 'tenant-1';
const OTRO = 'tenant-2';
const N = 1_200;

/** N líneas del mismo desglose, una por día-monto único, y su gasto de caseta (mismo monto y día) en un viaje propio. */
function carga(n: number): Record<string, Fila[]> {
  const lineas: Fila[] = [];
  const gastos: Fila[] = [];
  for (let i = 0; i < n; i++) {
    // Un monto distinto por línea (100.00 + i) evita empates: cada línea cuadra con SU gasto.
    const fecha = new Date(Date.UTC(2026, 7, 1) + (i % 28) * 86_400_000).toISOString().slice(0, 10);
    lineas.push({ id: `l${i}`, tenant_id: T, desglose_id: 'd1', indice: i, fecha, monto: 100 + i, caseta: `Caseta ${i % 7}`, tag: `TAG${i}`, cruce_en: null });
    gastos.push({ id: `g${i}`, tenant_id: T, concepto: 'caseta', viaje_id: `v${i}`, monto: 100 + i, fecha });
  }
  return {
    desglose_peaje: [{ id: 'd1', tenant_id: T, proveedor: 'PASE' }, { id: 'dx', tenant_id: OTRO, proveedor: 'PASE' }],
    desglose_peaje_linea: [
      ...lineas,
      // Una línea de OTRA flota con id propio: jamás debe cambiar.
      { id: 'ajena', tenant_id: OTRO, desglose_id: 'dx', indice: 0, fecha: '2026-08-01', monto: 100, caseta: 'X', tag: null, cruce_en: null, estatus: 'sin_contraparte' },
    ],
    gasto: gastos,
    viaje: gastos.map((g) => ({ id: g.viaje_id, tenant_id: T, unidad_id: null })),
  };
}

const escrituras = () => db.llamadas.filter((c) => c.tabla === 'desglose_peaje_linea' && (c.op === 'update' || c.op === 'upsert'));

beforeEach(() => { db = crearDbFalsa(carga(N)); });

describe('conciliarDesglose: escritura por lotes (REN-34-1)', () => {
  it('N líneas que cuadran (anotación distinta cada una) NO hacen N escrituras: ~N/LOTE', async () => {
    const r = await conciliarDesglose(T, 'd1', 'manual');
    expect(r).toMatchObject({ total: N, cuadra: N, noCuadra: 0, sinContraparte: 0, noEscritas: 0 });

    const llamadas = escrituras();
    // Antes del arreglo: N (1,200) UPDATE. Ahora: ceil(N / LOTE) = 3.
    expect(llamadas.length).toBe(Math.ceil(N / LOTE_ESCRITURA_LINEAS));
    expect(llamadas.length).toBeLessThan(N / 50);
  });

  it('cada línea queda con SU vínculo (viaje, diferencia, gasto) y no se pierden ni se inventan filas ni columnas del archivo', async () => {
    await conciliarDesglose(T, 'd1', 'manual');
    const filas = db.tablas.desglose_peaje_linea;
    expect(filas).toHaveLength(N + 1); // ni una fila fantasma
    for (let i = 0; i < N; i++) {
      const l = filas.find((f) => f.id === `l${i}`)!;
      expect(l.estatus).toBe('cuadra');
      expect(l.viaje_id).toBe(`v${i}`);
      expect(l.diferencia).toBe(0);
      expect((l.detalle as Record<string, unknown>).gastoId).toBe(`g${i}`);
      // Lo que vino del archivo no se toca.
      expect(l).toMatchObject({ indice: i, monto: 100 + i, caseta: `Caseta ${i % 7}`, tag: `TAG${i}`, tenant_id: T, desglose_id: 'd1' });
    }
  });

  it('aislamiento por flota: toda fila escrita lleva tenant_id de la flota y la línea de otra flota no cambia', async () => {
    await conciliarDesglose(T, 'd1', 'manual');
    for (const c of escrituras()) {
      const filasPayload = (Array.isArray(c.payload) ? c.payload : [c.payload]) as Array<Record<string, unknown>>;
      const porFiltro = c.filtros.some(([col, op, v]) => col === 'tenant_id' && op === 'eq' && v === T);
      expect(porFiltro || filasPayload.every((p) => p.tenant_id === T)).toBe(true);
      expect(filasPayload.every((p) => p.desglose_id === undefined || p.desglose_id === 'd1')).toBe(true);
    }
    const ajena = db.tablas.desglose_peaje_linea.find((f) => f.id === 'ajena')!;
    expect(ajena).toMatchObject({ tenant_id: OTRO, estatus: 'sin_contraparte' });
    expect(ajena.viaje_id).toBeUndefined();
  });

  it('un lote que falla conserva el estatus previo de SUS líneas y se cuentan en noEscritas (best-effort por lote)', async () => {
    db.fallar('desglose_peaje_linea.upsert', 'boom');
    const r = await conciliarDesglose(T, 'd1', 'manual');
    expect(r.noEscritas).toBe(N);
    expect(r.cuadra).toBe(0);
    expect(db.tablas.desglose_peaje_linea.find((f) => f.id === 'l0')!.estatus).toBeUndefined();
  });
});
