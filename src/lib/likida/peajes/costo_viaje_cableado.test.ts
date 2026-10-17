import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

// T-A2-23 — el costo por viaje está CABLEADO: lo que lee `leerVinculosParaArchivo` llega a la hoja
// «Ligadas» del archivo de casetas ligadas, con su fuente. Fixtures sintéticos.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
let candidatos: Array<{ indice: number }> | 'falla' = [];
vi.mock('./revision_cobros', () => ({
  revisionDeDesglose: async () => {
    if (candidatos === 'falla') throw new Error('base caída');
    return { revision: { candidatos } };
  },
}));

const { leerVinculosParaArchivo } = await import('./vinculos_reporte');
const { armarVinculos, vinculosAExcel } = await import('./vinculos_archivos');

const T = '11111111-1111-4111-8111-111111111111';
const DES = '00000000-0000-4000-8000-0000000000d1';

const linea = (id: string, indice: number, monto: number, caseta: string) =>
  ({ id, tenant_id: T, desglose_id: DES, indice, fecha: '2026-09-11', hora: '10:00:00', caseta, monto, clase: 3, unidad_archivo: 'TC9001', unidad_id: null });
const vinculo = (id: string, linea_id: string, viaje_id: string | null, estado = 'ligado', candidatos: string[] = []) =>
  ({ id, tenant_id: T, desglose_id: DES, linea_id, viaje_id, estado, via: 'unidad_ventana', candidatos, icident: null, motivo: null, calculado_en: '2026-10-16T00:00:00Z' });

beforeEach(() => {
  candidatos = [{ indice: 1 }];
  db = crearDbFalsa({
    desglose_peaje: [{ id: DES, tenant_id: T, anulado_en: null }],
    unidad: [],
    viaje: [
      { id: 'v-1', tenant_id: T, folio: 'F-1', origen: 'Ciudad A', destino: 'Ciudad B' },
      { id: 'v-2', tenant_id: T, folio: 'F-2', origen: 'Ciudad A', destino: 'Ciudad B' },
    ],
    desglose_peaje_linea: [
      linea('l-0', 0, 100, 'Caseta Ejemplo Uno'), linea('l-1', 1, 40.5, 'Caseta Ejemplo Dos'), linea('l-2', 2, 70, 'Caseta Ejemplo Uno'),
    ],
    peaje_cruce_viaje: [
      vinculo('x-0', 'l-0', 'v-1'), vinculo('x-1', 'l-1', 'v-1'), vinculo('x-2', 'l-2', null, 'ambiguo', ['v-1', 'v-2']),
    ],
  });
});

describe('leerVinculosParaArchivo trae el costo por viaje', () => {
  it('suma los ligados, deja fuera el ambiguo y cuenta los candidatos por línea', async () => {
    const d = (await leerVinculosParaArchivo(T, DES))!;
    const c1 = d.costos.get('v-1')!;
    expect(c1.costo).toBe(140.5);
    expect(c1.cruces).toBe(2);
    expect(c1.casetasDistintas).toBe(2);
    expect(c1.candidatos).toBe(1);
    expect(c1.ambiguos).toBe(1);
    const c2 = d.costos.get('v-2')!;
    expect(c2.costo).toBe(0);
    expect(c2.aviso).toMatch(/sin cruces/);
  });

  it('si los candidatos no se pueden calcular, el costo sale igual y candidatos queda null (no 0)', async () => {
    candidatos = 'falla';
    const d = (await leerVinculosParaArchivo(T, DES))!;
    expect(d.costos.get('v-1')!.costo).toBe(140.5);
    expect(d.costos.get('v-1')!.candidatos).toBeNull();
  });
});

describe('el archivo lleva el costo en la hoja «Ligadas»', () => {
  it('columnas de costo, cruces y detalle con fuente; la ambigua no recibe costo', async () => {
    const d = (await leerVinculosParaArchivo(T, DES))!;
    const libro = XLSX.read(vinculosAExcel(armarVinculos(d.lineas, d.vinculos, d.folios, d.costos)), { type: 'array' });
    const lig = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets['Ligadas']);
    expect(lig).toHaveLength(2);
    for (const f of lig) {
      expect(f['Costo del viaje']).toBe(140.5);
      expect(f['Cruces ligados del viaje']).toBe(2);
      expect(String(f['Costo del viaje: detalle y fuente'])).toMatch(/2 caseta\(s\) distinta\(s\).*1 candidato\(s\) a reclamación.*1 cruce\(s\) ambiguo\(s\) que NO suman.*Fuente: suma del importe de 2 cruces ligados/);
    }
    const amb = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets['Ambiguas']);
    expect(amb[0]['Costo del viaje']).toBeUndefined();
  });

  it('la referencia histórica solo sale rotulada «no es tarifa» y con ≥ 5 viajes', async () => {
    const lineas = [0, 1, 2, 3, 4].map((i) => ({ id: `l${i}`, fecha: '2026-09-11', hora: null, unidad: 'TC9001', caseta: 'Caseta Ejemplo Uno', clase: 3, importe: i === 4 ? 150 : 100 }));
    const vinculos = lineas.map((l, i) => ({ lineaId: l.id, estado: 'ligado' as const, viajeId: `v${i}`, via: 'icident' as const, candidatos: [] }));
    const { costoPorViaje } = await import('./costo_viaje');
    const viajes = lineas.map((_, i) => ({ id: `v${i}`, folio: `VJ-${i}`, origen: 'A', destino: 'B' }));
    const costos = costoPorViaje({ lineas: lineas.map((l) => ({ id: l.id, caseta: l.caseta, importe: l.importe })), vinculos, viajes });
    const libro = XLSX.read(vinculosAExcel(armarVinculos(lineas, vinculos, new Map(viajes.map((v) => [v.id, v.folio])), costos)), { type: 'array' });
    const lig = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets['Ligadas']);
    const ultimo = String(lig[4]['Costo del viaje: detalle y fuente']);
    expect(ultimo).toContain('referencia histórica, no es tarifa: $100.00 con 5 viajes');
    expect(ultimo).toContain('+$50.00 (+50%)');
  });
});
