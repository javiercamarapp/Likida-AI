import { describe, it, expect } from 'vitest';
import { cierreMensual, type ArchivoCierre, type LineaCierre } from './cierre_mensual';
import { generarFilasIave } from './fixtures/generar_desglose_iave';

const SERIAL0 = Date.UTC(1899, 11, 30);
function lineasDeFixture(op: Parameters<typeof generarFilasIave>[0]): LineaCierre[] {
  const { filas } = generarFilasIave(op);
  return filas.slice(1).map((f) => {
    const seg = Math.round(Number(f[8]) * 86_400);
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      fecha: new Date(SERIAL0 + Number(f[7]) * 86_400_000).toISOString().slice(0, 10),
      hora: `${p(Math.floor(seg / 3600) % 24)}:${p(Math.floor(seg / 60) % 60)}:${p(seg % 60)}`,
      caseta: String(f[10]).trim(), tag: String(f[5]), monto: Number(f[13]),
    };
  });
}
const archivo = (id: string, desde: string, hasta: string, lineas: LineaCierre[]): ArchivoCierre => ({ id, etiqueta: id, periodoDesde: desde, periodoHasta: hasta, lineas });
const lin = (p: Partial<LineaCierre>): LineaCierre => ({ fecha: '2026-03-05', hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', monto: 100, ...p });

describe('cierre mensual: 3 decenas de un mes', () => {
  const d1 = lineasDeFixture({ filas: 9000, inicio: '2026-03-01', extemporaneos: 40, semilla: 1 });
  const d2 = lineasDeFixture({ filas: 8000, inicio: '2026-03-11', extemporaneos: 30, semilla: 2 });
  const d3 = lineasDeFixture({ filas: 8500, inicio: '2026-03-21', extemporaneos: 20, semilla: 3 });
  const archivos = [archivo('d1', '2026-03-01', '2026-03-10', d1), archivo('d2', '2026-03-11', '2026-03-20', d2), archivo('d3', '2026-03-21', '2026-03-31', d3)];

  it('suma las tres decenas: cruces e importe del mes = suma de los archivos', () => {
    const c = cierreMensual('2026-03', archivos);
    if ('error' in c) throw new Error(c.error);
    expect(c.cruces).toBe(9000 + 8000 + 8500);
    expect(c.monto).toBe(Math.round([...d1, ...d2, ...d3].reduce((s, l) => s + l.monto, 0) * 100) / 100);
    expect(c.completo).toBe(true);
    expect(c.decenasFaltantes).toEqual([]);
    expect(c.decenas.map((d) => d.etiqueta)).toEqual(['1 a 10', '11 a 20', '21 a 31']);
    expect(c.decenas.every((d) => d.cubierta && d.cruces > 0)).toBe(true);
  });

  it('separa los tardíos: del mes anterior (feb) y de una decena anterior del mismo mes', () => {
    const c = cierreMensual('2026-03', archivos);
    if ('error' in c) throw new Error(c.error);
    // d1: sus extemporáneos caen 1–12 días antes del 1-mar (feb): mes anterior. d2/d3: unos en mar (decena anterior), otros en feb.
    const total = c.tardiosMesAnterior.n + c.tardiosDecenaAnterior.n;
    expect(total).toBe(40 + 30 + 20);
    expect(c.tardios.filter((t) => t.tipo === 'mes_anterior').every((t) => t.fecha < '2026-03-01')).toBe(true);
    expect(c.tardios.filter((t) => t.tipo === 'decena_anterior').every((t) => t.fecha >= '2026-03-01')).toBe(true);
    expect(c.tardiosMesAnterior.n).toBeGreaterThan(40);
    expect(c.tardiosDecenaAnterior.n).toBeGreaterThan(0);
    // sin los archivos de febrero, lo dice
    expect(c.mesAnteriorCargado).toBe(false);
    expect(c.avisos.join(' ')).toMatch(/no cargaste los archivos de 2026-02/);
  });

  it('con el archivo del mes anterior detecta el tardío YA cobrado allá (cobro repetido)', () => {
    const repetido = lin({ fecha: '2026-02-27', hora: '08:15:30', monto: 777 });
    const feb = archivo('feb3', '2026-02-21', '2026-02-28', [repetido, lin({ fecha: '2026-02-25' })]);
    const mar = archivo('mar1', '2026-03-01', '2026-03-10', [repetido, lin({ fecha: '2026-03-02', hora: '09:00:00' })]);
    const c = cierreMensual('2026-03', [feb, mar]);
    if ('error' in c) throw new Error(c.error);
    expect(c.mesAnteriorCargado).toBe(true);
    expect(c.tardios).toHaveLength(1);
    expect(c.tardios[0]).toMatchObject({ tipo: 'mes_anterior', monto: 777, yaCobradoEn: 'feb3' });
    expect(c.repetidosEntreArchivos).toHaveLength(1);
    expect(c.repetidosEntreArchivos[0].archivos.sort()).toEqual(['feb3', 'mar1']);
    // el cobro de febrero NO suma a los totales de marzo
    expect(c.cruces).toBe(2);
    expect(c.avisos.join(' ')).toMatch(/aparecen en más de un archivo/);
  });
});

describe('un mes a medias NO se presenta como completo', () => {
  it('falta una decena: lo dice', () => {
    const c = cierreMensual('2026-03', [
      archivo('d1', '2026-03-01', '2026-03-10', [lin({})]), archivo('d3', '2026-03-21', '2026-03-31', [lin({ fecha: '2026-03-22' })]),
    ]);
    if ('error' in c) throw new Error(c.error);
    expect(c.completo).toBe(false);
    expect(c.decenasFaltantes).toEqual(['11 a 20']);
    expect(c.avisos.join(' ')).toMatch(/Faltan las decenas 11 a 20/);
  });
  it('un archivo sin periodo no entra al cierre y se nombra', () => {
    const c = cierreMensual('2026-03', [
      { id: 'raro', etiqueta: 'raro.xlsx', periodoDesde: null, periodoHasta: null, lineas: [lin({})] }, archivo('d1', '2026-03-01', '2026-03-10', [lin({})]),
    ]);
    if ('error' in c) throw new Error(c.error);
    expect(c.cruces).toBe(1);
    expect(c.archivosSinPeriodo).toEqual(['raro.xlsx']);
    expect(c.completo).toBe(false);
  });
  it('mes inválido', () => {
    expect(cierreMensual('2026-13', [])).toHaveProperty('error');
  });
});
