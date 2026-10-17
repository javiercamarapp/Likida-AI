import { describe, it, expect } from 'vitest';
import { revisarDobleEntreArchivos, claveCobro, type ArchivoPrevio, type LineaPrevia } from './doble_entre_archivos';
import { revisarCobros, type LineaCobro } from './reglas_cobro';

// Datos 100 % sintéticos: TAGs, casetas y montos inventados.

const linea = (i: number, o: Partial<LineaCobro> = {}): LineaCobro => ({
  indice: i, fecha: '2026-08-25', hora: '10:15:30', caseta: 'CASETA UNO', tag: 'TAG0001', unidad: 'U-01', clase: 5, monto: 250, ...o,
});
const previa = (i: number, o: Partial<LineaPrevia> = {}): LineaPrevia => ({
  indice: i, fecha: '2026-08-25', hora: '10:15:30', caseta: 'CASETA UNO', tag: 'TAG0001', monto: 250, ...o,
});
const archivoA = (lineas: LineaPrevia[], o: Partial<ArchivoPrevio> = {}): ArchivoPrevio => ({
  id: 'A', etiqueta: '21 A 31 DE AGOSTO.xlsx', periodoDesde: '2026-08-21', periodoHasta: '2026-08-31', lineas, ...o,
});
const OP = { periodoDesde: '2026-10-01', archivoActualId: 'B' };

describe('revisarDobleEntreArchivos', () => {
  it('extemporáneo ya cobrado en un archivo anterior → candidato con archivo y fila previa', () => {
    const r = revisarDobleEntreArchivos([linea(0)], [archivoA([previa(0, { tag: 'OTRO' }), previa(7)])], OP);
    expect(r.candidatos).toHaveLength(1);
    const c = r.candidatos[0];
    expect(c.categoria).toBe('posible_doble_entre_archivos');
    expect(c.archivoPrevio).toBe('21 A 31 DE AGOSTO.xlsx');
    expect(c.filaPrevia).toBe(8);
    expect(c.monto).toBe(250);
    expect(r.montoCandidatos).toBe(250);
    expect(r.tardiosLegitimos).toHaveLength(0);
  });

  it('lenguaje llano: qué pasó / qué significa / qué hacer, sin afirmar cobro indebido', () => {
    const [c] = revisarDobleEntreArchivos([linea(0)], [archivoA([previa(3)])], OP).candidatos;
    expect(c.quePaso).toMatch(/ya aparece en «21 A 31 DE AGOSTO\.xlsx», fila 4/);
    expect(c.queSignifica).toMatch(/No es un cobro indebido confirmado/);
    expect(c.queHacer).toMatch(/reclama/i);
    expect(`${c.quePaso} ${c.queSignifica} ${c.queHacer}`).not.toMatch(/fraude/i);
  });

  it('extemporáneo sin precedente → cobro tardío legítimo (informativo, no candidato)', () => {
    const r = revisarDobleEntreArchivos([linea(0)], [archivoA([previa(0, { monto: 999 })])], OP);
    expect(r.candidatos).toHaveLength(0);
    expect(r.tardiosLegitimos).toHaveLength(1);
    expect(r.tardiosLegitimos[0].nota).toMatch(/Cobro tardío legítimo/);
  });

  it('una línea que no es extemporánea (fecha dentro del periodo) no se busca', () => {
    const r = revisarDobleEntreArchivos([linea(0, { fecha: '2026-10-03' })], [archivoA([previa(0, { fecha: '2026-10-03' })])], OP);
    expect(r.candidatos).toHaveLength(0);
    expect(r.tardiosLegitimos).toHaveLength(0);
  });

  it('la misma clave repetida en el mismo archivo sigue siendo duplicado_exacto y no se duplica aquí', () => {
    const lineas = [linea(0), linea(1)];
    const dobles = revisarDobleEntreArchivos(lineas, [archivoA([previa(0)])], OP);
    expect(dobles.candidatos.map((c) => c.indice)).toEqual([0]); // solo el primero
    const reglas = revisarCobros(lineas, { periodoDesde: '2026-10-01' });
    expect(reglas.candidatos.filter((c) => c.categoria === 'duplicado_exacto').map((c) => c.indice)).toEqual([1]);
    // y sin archivo previo, la repetida tampoco genera nada entre archivos
    const sin = revisarDobleEntreArchivos(lineas, [], OP);
    expect(sin.candidatos).toHaveLength(0);
    expect(sin.tardiosLegitimos).toHaveLength(1);
  });

  it('archivo previo fuera de la ventana de 3 meses → no se consulta y se dice por qué', () => {
    const viejo = archivoA([previa(0, { fecha: '2026-05-25' })], { id: 'V', etiqueta: 'MAYO.xlsx', periodoDesde: '2026-05-21', periodoHasta: '2026-05-31' });
    const r = revisarDobleEntreArchivos([linea(0, { fecha: '2026-05-25' })], [viejo], OP);
    expect(r.candidatos).toHaveLength(0);
    expect(r.archivosConsultados).toEqual([]);
    expect(r.archivosNoConsultados).toEqual([expect.objectContaining({ id: 'V', motivo: expect.stringMatching(/fuera de la ventana de 3 meses/) })]);
  });

  it('la ventana es configurable', () => {
    const viejo = archivoA([previa(0, { fecha: '2026-05-25' })], { id: 'V', periodoDesde: '2026-05-21', periodoHasta: '2026-05-31' });
    const l = linea(0, { fecha: '2026-05-25' });
    expect(revisarDobleEntreArchivos([l], [viejo], { ...OP, ventanaMeses: 6 }).candidatos).toHaveLength(1);
    expect(revisarDobleEntreArchivos([l], [viejo], { ...OP, ventanaMeses: 6 }).ventanaMeses).toBe(6);
  });

  it('no se compara contra sí mismo, ni contra archivos que no son anteriores, ni sin periodo', () => {
    const lineasPrev = [previa(0)];
    const r = revisarDobleEntreArchivos([linea(0)], [
      archivoA(lineasPrev, { id: 'B' }),
      archivoA(lineasPrev, { id: 'POSTERIOR', periodoDesde: '2026-10-11', periodoHasta: '2026-10-20' }),
      archivoA(lineasPrev, { id: 'SINPERIODO', periodoDesde: null, periodoHasta: null }),
    ], OP);
    expect(r.candidatos).toHaveLength(0);
    expect(r.archivosNoConsultados.map((a) => a.id).sort()).toEqual(['POSTERIOR', 'SINPERIODO']);
  });

  it('sin periodo del archivo la regla no se aplica y lo dice', () => {
    const r = revisarDobleEntreArchivos([linea(0)], [archivoA([previa(0)])], { periodoDesde: null });
    expect(r.candidatos).toHaveLength(0);
    expect(r.reglaNoAplicada).toMatch(/Sin periodo/);
  });

  it('extemporáneo sin TAG o sin hora no se puede comparar: se cuenta, no se calla', () => {
    const r = revisarDobleEntreArchivos([linea(0, { tag: null }), linea(1, { hora: null })], [archivoA([previa(0)])], OP);
    expect(r.noComparables).toBe(2);
    expect(r.candidatos).toHaveLength(0);
    expect(r.tardiosLegitimos).toHaveLength(0);
  });

  it('la clave ignora mayúsculas del TAG y los milisegundos de la hora', () => {
    expect(claveCobro({ tag: 'tag-0001', fecha: '2026-08-25', hora: '10:15:30.999', caseta: 'Caseta  Uno', monto: 250 }))
      .toBe(claveCobro({ tag: 'TAG0001', fecha: '2026-08-25', hora: '10:15:30', caseta: 'CASETA UNO', monto: 250 }));
  });

  it('60 000 + 60 000 líneas sintéticas con índice en memoria: resultado correcto y tiempo documentado', () => {
    const N = 60_000;
    const prev: LineaPrevia[] = [];
    const act: LineaCobro[] = [];
    for (let i = 0; i < N; i++) {
      const dia = String(1 + (i % 28)).padStart(2, '0');
      const hora = `${String(i % 24).padStart(2, '0')}:${String(Math.floor(i / 24) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`;
      const base = { fecha: `2026-08-${dia}`, hora, caseta: `CASETA ${i % 40}`, tag: `TAG${String(i).padStart(6, '0')}`, monto: 100 + (i % 50) };
      prev.push({ indice: i, ...base });
      // la mitad de las actuales repite una previa; la otra mitad cambia el importe (no coincide)
      act.push({ indice: i, unidad: null, clase: 5, ...base, monto: i % 2 === 0 ? base.monto : base.monto + 0.5 });
    }
    const t0 = performance.now();
    const r = revisarDobleEntreArchivos(act, [archivoA(prev)], OP);
    const ms = performance.now() - t0;
    expect(r.candidatos).toHaveLength(N / 2);
    expect(r.tardiosLegitimos).toHaveLength(N / 2);
    // Documentado: ~1 s (964 ms medido) en esta Mac; el techo de 5 s solo protege contra una degradación cuadrática.
    console.info(`T-A2-38: ${N} + ${N} líneas en ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });
});
