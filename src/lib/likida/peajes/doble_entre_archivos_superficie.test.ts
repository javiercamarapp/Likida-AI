import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no toca la base'); } }));

const { revisarCobros } = await import('./reglas_cobro');
const { revisarDobleEntreArchivos } = await import('./doble_entre_archivos');
const { armarCandidatos, candidatosAExcel, resumirCandidatos } = await import('./candidatos_archivos');
const { revisionAExcel } = await import('./revision_archivos');
import type { LineaCobro } from './reglas_cobro';
import type { ReporteRevision } from './revision_cobros';

// OLA 10 · A2P-04: el posible doble cobro ENTRE archivos aparece en el Excel del portal y en el de la revisión, con su monto.
// Todo sintético.

const lin = (indice: number, p: Partial<LineaCobro> = {}): LineaCobro => ({
  indice, fecha: '2026-02-20', hora: '10:15:00', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', unidad: '101', clase: 5, monto: 189.5, ...p,
});
const lineas = [lin(0), lin(1, { hora: '11:00:00', tag: 'IMDM00000002', monto: 100 })];
const previo = {
  id: 'prev1', etiqueta: 'corte-febrero.csv', periodoDesde: '2026-02-11', periodoHasta: '2026-02-20',
  lineas: [{ fecha: '2026-02-20', hora: '10:15:00', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', monto: 189.5, indice: 4 }],
};
const doble = revisarDobleEntreArchivos(lineas, [previo], { periodoDesde: '2026-03-01', archivoActualId: 'actual' });
const revision = revisarCobros(lineas, { periodoDesde: '2026-03-01' });

const hojas = (b: Uint8Array) => XLSX.read(b, { type: 'array' });

describe('A2P-04: doble cobro entre archivos en el reporte del portal', () => {
  it('el candidato sale como fila reclamable con el monto del segundo cobro', () => {
    expect(doble.candidatos).toHaveLength(1);
    const rep = armarCandidatos({
      proveedor: 'P', archivoNombre: 'a.csv', periodoDesde: '2026-03-01', periodoHasta: '2026-03-10', revision, dobleEntreArchivos: doble.candidatos,
    });
    const fila = rep.filas.find((f) => f.categoria === 'posible_doble_entre_archivos');
    expect(fila).toMatchObject({ indice: 0, montoReclamar: 189.5, estado: 'candidato' });
    expect(fila?.motivo).toContain('corte-febrero.csv');
    expect(resumirCandidatos(rep).porCategoria.posible_doble_entre_archivos).toMatchObject({ n: 1, monto: 189.5 });
    const libro = hojas(candidatosAExcel(rep));
    expect(libro.SheetNames).toContain('Posible doble cobro entre archivos'.slice(0, 31));
  });

  it('lo que una persona descartó no se sube', () => {
    const rep = armarCandidatos({
      proveedor: null, archivoNombre: null, periodoDesde: null, periodoHasta: null, revision,
      dobleEntreArchivos: doble.candidatos, decididos: new Set(['0|posible_doble_entre_archivos']),
    });
    expect(rep.filas.some((f) => f.categoria === 'posible_doble_entre_archivos')).toBe(false);
    expect(rep.decididosOmitidos).toBe(1);
  });

  it('el Excel de la revisión trae su hoja con monto', () => {
    const r = {
      desgloseId: 'd', proveedor: 'P', archivoNombre: 'a.csv', periodoMedidoDesde: null, periodoMedidoHasta: null, periodoOficialDesde: '2026-03-01',
      periodoOficialHasta: '2026-03-10', periodoOrigen: 'declarado', noPeriodo: null, calidad: null, revision, atipicos: { atipicos: [], noAplicadas: [] },
      dobleEntreArchivos: doble, rotulo: 'Candidato: validar con el proveedor',
    } as unknown as ReporteRevision;
    const libro = hojas(revisionAExcel(r));
    expect(libro.SheetNames).toContain('Doble entre archivos');
    const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets['Doble entre archivos'], { header: 1 });
    expect(JSON.stringify(filas)).toContain('189.5');
  });
});
