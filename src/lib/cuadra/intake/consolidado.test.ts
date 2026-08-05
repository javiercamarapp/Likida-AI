import { describe, it, expect } from 'vitest';
import {
  conciliarLineas, rangoFechasLineas, mensajeConsolidadoRecibido,
  TOLERANCIA_MONTO_MXN, VENTANA_DIAS_FECHA,
} from './consolidado';
import type { CfdiLineaXml } from './cfdi_xml';
import type { Gasto } from '@/types/cuadra';

const linea = (indice: number, monto: number, fecha?: string, extra?: Partial<CfdiLineaXml>): CfdiLineaXml => ({
  indice, monto, fecha, fuente: fecha ? 'ecc12' : 'concepto_base', ...extra,
});

const gasto = (id: string, monto: number, fecha?: string): Gasto => ({
  id, concepto: 'diesel', monto, fecha,
});

describe('conciliarLineas — el JOIN contra gasto', () => {
  it('candidato único → concilia y liga el gastoId', () => {
    const lineas = [linea(1, 2904.05, '2026-04-03T09:12:00')];
    const gastos = [gasto('g1', 2904.05, '2026-04-03')];
    const r = conciliarLineas(lineas, gastos);
    expect(r).toHaveLength(1);
    expect(r[0].estatus).toBe('conciliada');
    expect(r[0].gastoId).toBe('g1');
    expect(r[0].candidatos).toEqual([]);
  });

  it('sin fecha en la línea → NUNCA intenta match automático, aunque el monto sea único', () => {
    const lineas = [linea(1, 310, undefined)]; // TAG sin ECC12
    const gastos = [gasto('g1', 310, '2026-04-10')];
    const r = conciliarLineas(lineas, gastos);
    expect(r[0].estatus).toBe('por_conciliar');
    expect(r[0].gastoId).toBeNull();
    expect(r[0].candidatos).toEqual([]); // ni siquiera se reporta como candidato: no se evaluó
  });

  it('cero candidatos (ni monto ni fecha cuadran con nada) → por_conciliar, sin inventar', () => {
    const lineas = [linea(1, 5000, '2026-04-03T09:12:00')];
    const gastos = [gasto('g1', 300, '2026-04-03')];
    const r = conciliarLineas(lineas, gastos);
    expect(r[0].estatus).toBe('por_conciliar');
    expect(r[0].gastoId).toBeNull();
    expect(r[0].candidatos).toEqual([]);
  });

  it('dos candidatos igual de razonables (ambiguo) → por_conciliar, con los DOS listados', () => {
    const lineas = [linea(1, 300, '2026-04-03T09:12:00')];
    const gastos = [gasto('g1', 300, '2026-04-03'), gasto('g2', 300.5, '2026-04-04')];
    const r = conciliarLineas(lineas, gastos);
    expect(r[0].estatus).toBe('por_conciliar');
    expect(r[0].gastoId).toBeNull();
    expect(r[0].candidatos.map((c) => c.gastoId).sort()).toEqual(['g1', 'g2']);
  });

  it(`respeta la tolerancia de monto (±$${TOLERANCIA_MONTO_MXN}) pero no más`, () => {
    const dentro = conciliarLineas([linea(1, 100, '2026-04-03T00:00:00')], [gasto('g1', 100 + TOLERANCIA_MONTO_MXN, '2026-04-03')]);
    expect(dentro[0].estatus).toBe('conciliada');

    const fuera = conciliarLineas([linea(1, 100, '2026-04-03T00:00:00')], [gasto('g1', 100 + TOLERANCIA_MONTO_MXN + 0.5, '2026-04-03')]);
    expect(fuera[0].estatus).toBe('por_conciliar');
  });

  it(`respeta la ventana de fecha (±${VENTANA_DIAS_FECHA} día) pero no más`, () => {
    const dentro = conciliarLineas([linea(1, 100, '2026-04-03T00:00:00')], [gasto('g1', 100, '2026-04-04')]);
    expect(dentro[0].estatus).toBe('conciliada');

    const fuera = conciliarLineas([linea(1, 100, '2026-04-03T00:00:00')], [gasto('g1', 100, '2026-04-06')]);
    expect(fuera[0].estatus).toBe('por_conciliar');
  });

  it('un gasto sin fecha NUNCA es candidato, aunque el monto cuadre exacto', () => {
    const lineas = [linea(1, 100, '2026-04-03T00:00:00')];
    const gastos = [gasto('g1', 100, undefined)];
    const r = conciliarLineas(lineas, gastos);
    expect(r[0].estatus).toBe('por_conciliar');
  });

  it('dos líneas del mismo consolidado NO pueden reclamar el mismo gasto', () => {
    // Dos cargas de $500 el mismo día contra UN solo ticket capturado: la
    // primera se lo lleva, a la segunda no le queda candidato.
    const lineas = [linea(1, 500, '2026-04-03T08:00:00'), linea(2, 500, '2026-04-03T20:00:00')];
    const gastos = [gasto('g1', 500, '2026-04-03')];
    const r = conciliarLineas(lineas, gastos);
    expect(r[0].estatus).toBe('conciliada');
    expect(r[0].gastoId).toBe('g1');
    expect(r[1].estatus).toBe('por_conciliar');
    expect(r[1].gastoId).toBeNull();
  });

  it('procesa las líneas EN EL ORDEN del XML y liga cada una a su propio gasto', () => {
    const lineas = [
      linea(1, 2904.05, '2026-04-03T09:12:00'),
      linea(2, 2308.50, '2026-04-11T18:47:00'),
      linea(3, 2656.50, '2026-04-22T07:03:00'),
    ];
    const gastos = [
      gasto('g3', 2656.50, '2026-04-22'),
      gasto('g1', 2904.05, '2026-04-03'),
      gasto('g2', 2308.50, '2026-04-11'),
    ];
    const r = conciliarLineas(lineas, gastos);
    expect(r.map((x) => x.estatus)).toEqual(['conciliada', 'conciliada', 'conciliada']);
    expect(r.map((x) => x.gastoId)).toEqual(['g1', 'g2', 'g3']);
    // El índice de la línea es el que se va a escribir como cfdi_orden.
    expect(r.map((x) => x.linea.indice)).toEqual([1, 2, 3]);
  });

  it('procesa una lista vacía sin lanzar', () => {
    expect(conciliarLineas([], [])).toEqual([]);
  });
});

describe('rangoFechasLineas', () => {
  it('null cuando NINGUNA línea trae fecha (consolidado tipo TAG sin ECC12)', () => {
    expect(rangoFechasLineas([linea(1, 100, undefined), linea(2, 200, undefined)])).toBeNull();
  });

  it('cubre el mínimo y máximo con la ventana aplicada', () => {
    const r = rangoFechasLineas([
      linea(1, 100, '2026-04-03T09:00:00'),
      linea(2, 200, '2026-04-22T07:00:00'),
    ]);
    expect(r).toEqual({ desde: '2026-04-02', hasta: '2026-04-23' });
  });

  it('ignora las líneas sin fecha al calcular el rango, no las cuenta como extremo', () => {
    const r = rangoFechasLineas([
      linea(1, 100, '2026-04-10T09:00:00'),
      linea(2, 200, undefined),
    ]);
    expect(r).toEqual({ desde: '2026-04-09', hasta: '2026-04-11' });
  });
});

describe('mensajeConsolidadoRecibido — el acuse dice la verdad', () => {
  it('todo conciliado: no pide revisión que ya no hace falta', () => {
    const msg = mensajeConsolidadoRecibido({ cfdiXmlId: 'x', totalLineas: 3, conciliadas: 3, porConciliar: 0 });
    expect(msg).toMatch(/quedó ligado/);
    expect(msg).not.toMatch(/revisión|revise/);
  });

  it('nada conciliado: no promete un "listo" que no pasó', () => {
    const msg = mensajeConsolidadoRecibido({ cfdiXmlId: 'x', totalLineas: 3, conciliadas: 0, porConciliar: 3 });
    expect(msg).not.toMatch(/ligado ✅/);
    expect(msg).toMatch(/revise/);
  });

  it('mixto: dice cuántos de cada uno', () => {
    const msg = mensajeConsolidadoRecibido({ cfdiXmlId: 'x', totalLineas: 5, conciliadas: 3, porConciliar: 2 });
    expect(msg).toContain('3');
    expect(msg).toContain('2');
  });
});
