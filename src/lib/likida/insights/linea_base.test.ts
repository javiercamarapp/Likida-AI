import { describe, it, expect } from 'vitest';
import {
  ahorroSeguro,
  DIAS_MIN_MEDIDA,
  MOTIVO_PENDIENTE,
  N_MIN_MEDIDA,
  type LineaBase,
  type Medida,
} from './linea_base';

const linea: LineaBase = {
  proceso: 'desglose',
  minutosPorUnidad: 20,
  unidad: 'desglose',
  fuente: 'cronometraje sintético de 10 casos',
  capturadaEn: '2026-09-01T10:00:00Z',
};
const medida: Medida = {
  proceso: 'desglose',
  minutosPorUnidad: 5,
  unidad: 'desglose',
  n: 40,
  desde: '2026-09-15T00:00:00Z',
  hasta: '2026-10-15T00:00:00Z',
  fuente: 'bitácora del sistema',
};

describe('ahorroSeguro', () => {
  it('sin línea base: null con motivo de pendiente', () => {
    for (const l of [null, undefined]) {
      const r = ahorroSeguro(l, medida);
      expect(r.pct).toBeNull();
      expect(r.minutosAhorrados).toBeNull();
      expect(r.fuente).toBeNull();
      expect(r.motivo).toContain(MOTIVO_PENDIENTE);
    }
  });

  it('con línea base pero sin medida: pendiente, nunca porcentaje', () => {
    const r = ahorroSeguro(linea, null);
    expect(r.pct).toBeNull();
    expect(r.motivo).toBe(MOTIVO_PENDIENTE);
  });

  it('con base y medida suficientes: minutos y % con la fuente de ambos lados', () => {
    const r = ahorroSeguro(linea, medida);
    expect(r.minutosAhorrados).toBe(15);
    expect(r.pct).toBe(75);
    expect(r.fuente?.base.calculo).toBe(linea.fuente);
    expect(r.fuente?.medida.calculo).toBe(medida.fuente);
    expect(r.fuente?.medida.n).toBe(40);
    expect(r.fuente?.base.periodo).toContain('2026-09-01');
    expect(r.fuente?.medida.periodo).toContain('2026-10-15');
  });

  it('medida con n bajo: null', () => {
    const r = ahorroSeguro(linea, { ...medida, n: N_MIN_MEDIDA - 1 });
    expect(r.pct).toBeNull();
    expect(r.motivo).toContain('casos');
    expect(ahorroSeguro(linea, { ...medida, n: N_MIN_MEDIDA }).pct).toBe(75);
  });

  it('medida de menos de 30 días: null; exactamente 30 días sí', () => {
    const corta = ahorroSeguro(linea, { ...medida, desde: '2026-10-01T00:00:00Z' });
    expect(corta.pct).toBeNull();
    expect(corta.motivo).toContain(String(DIAS_MIN_MEDIDA));
    const justa = ahorroSeguro(linea, {
      ...medida,
      desde: '2026-09-15T00:00:00Z',
      hasta: '2026-10-15T00:00:00Z',
    });
    expect(justa.pct).toBe(75);
  });

  it('periodo inválido o invertido: null', () => {
    expect(ahorroSeguro(linea, { ...medida, desde: 'ayer' }).pct).toBeNull();
    expect(ahorroSeguro(linea, { ...medida, desde: '2026-10-20T00:00:00Z' }).pct).toBeNull();
  });

  it('otro proceso u otra unidad: null (no se comparan peras con manzanas)', () => {
    expect(ahorroSeguro(linea, { ...medida, proceso: 'otro' }).pct).toBeNull();
    expect(ahorroSeguro(linea, { ...medida, unidad: 'viaje' }).pct).toBeNull();
    expect(ahorroSeguro(linea, { ...medida, unidad: ' Desglose ' }).pct).toBe(75);
  });

  it('valores inválidos en la base o la medida: null', () => {
    expect(ahorroSeguro({ ...linea, minutosPorUnidad: 0 }, medida).pct).toBeNull();
    expect(ahorroSeguro({ ...linea, minutosPorUnidad: Number.NaN }, medida).pct).toBeNull();
    expect(ahorroSeguro({ ...linea, fuente: '  ' }, medida).pct).toBeNull();
    expect(ahorroSeguro(linea, { ...medida, minutosPorUnidad: -1 }).pct).toBeNull();
    expect(ahorroSeguro(linea, { ...medida, fuente: '' }).pct).toBeNull();
    expect(ahorroSeguro(linea, { ...medida, n: Number.NaN }).pct).toBeNull();
  });

  it('si hoy tarda más, lo dice con signo negativo y no lo vende como ahorro', () => {
    const r = ahorroSeguro(linea, { ...medida, minutosPorUnidad: 25 });
    expect(r.minutosAhorrados).toBe(-5);
    expect(r.pct).toBe(-25);
    expect(r.motivo).toContain('tarda más');
  });

  it('moneda no aplica: el resultado solo trae minutos y porcentaje, sin campos de dinero', () => {
    const r = ahorroSeguro(linea, medida);
    expect(Object.keys(r).sort()).toEqual(['fuente', 'minutosAhorrados', 'motivo', 'pct']);
    expect(JSON.stringify(r)).not.toMatch(/\$|mxn|peso|sueldo|precio/i);
  });

  it('redondea a un decimal', () => {
    const r = ahorroSeguro({ ...linea, minutosPorUnidad: 30 }, { ...medida, minutosPorUnidad: 20 });
    expect(r.minutosAhorrados).toBe(10);
    expect(r.pct).toBe(33.3);
  });
});
