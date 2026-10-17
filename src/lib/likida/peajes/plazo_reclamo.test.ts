import { describe, expect, it } from 'vitest';
import { clasificarPlazos, estadoPlazo, fechaLocalMX, type CandidatoPlazo } from './plazo_reclamo';

describe('estadoPlazo: meses de calendario', () => {
  it('31-jul + 3 meses = 31-oct', () => {
    expect(estadoPlazo('2026-07-31', '2026-08-01')).toMatchObject({ fechaLimite: '2026-10-31' });
  });
  it('30-nov + 3 meses = 28-feb en año común y 29-feb en bisiesto', () => {
    expect(estadoPlazo('2026-11-30', '2026-12-01')).toMatchObject({ fechaLimite: '2027-02-28' });
    expect(estadoPlazo('2027-11-30', '2027-12-01')).toMatchObject({ fechaLimite: '2028-02-29' });
  });
  it('29-feb bisiesto + 3 = 29-may; 30-nov cruza de año', () => {
    expect(estadoPlazo('2028-02-29', '2028-03-01')).toMatchObject({ fechaLimite: '2028-05-29' });
    expect(estadoPlazo('2026-12-31', '2027-01-01')).toMatchObject({ fechaLimite: '2027-03-31' });
  });
  it('meses configurables', () => {
    expect(estadoPlazo('2026-01-31', '2026-02-01', { meses: 1 })).toMatchObject({ fechaLimite: '2026-02-28' });
  });
});

describe('estadoPlazo: estados y bordes', () => {
  const base = '2026-07-15'; // límite 2026-10-15
  it('hoy exactamente en el día límite = por_vencer(0), el último día aún se reclama', () => {
    expect(estadoPlazo(base, '2026-10-15')).toEqual({ estado: 'por_vencer', fechaLimite: '2026-10-15', diasRestantes: 0, umbral: 7 });
  });
  it('un día después del límite = vencido(1)', () => {
    expect(estadoPlazo(base, '2026-10-16')).toEqual({ estado: 'vencido', fechaLimite: '2026-10-15', diasVencido: 1 });
  });
  it('a 30 días justos entra el umbral 30; a 31 sigue vigente', () => {
    expect(estadoPlazo(base, '2026-09-15')).toMatchObject({ estado: 'por_vencer', diasRestantes: 30, umbral: 30 });
    expect(estadoPlazo(base, '2026-09-14')).toMatchObject({ estado: 'vigente', diasRestantes: 31 });
  });
  it('a 7 días el umbral vigente es 7; a 8 es 30', () => {
    expect(estadoPlazo(base, '2026-10-08')).toMatchObject({ estado: 'por_vencer', diasRestantes: 7, umbral: 7 });
    expect(estadoPlazo(base, '2026-10-07')).toMatchObject({ estado: 'por_vencer', diasRestantes: 8, umbral: 30 });
  });
  it('umbrales fuera de orden o inválidos no rompen: se ordenan y se ignoran los negativos', () => {
    expect(estadoPlazo(base, '2026-10-08', { avisoDias: [30, -1, 7] })).toMatchObject({ umbral: 7 });
  });
  it('cruce reciente es vigente con sus días restantes', () => {
    expect(estadoPlazo('2026-10-14', '2026-10-14')).toEqual({ estado: 'vigente', fechaLimite: '2027-01-14', diasRestantes: 92 });
  });
});

describe('fecha local de México', () => {
  it('cruce a las 23:30 de México (05:30Z del día siguiente) cuenta como ESE día', () => {
    expect(fechaLocalMX('2026-07-31T05:30:00Z')).toBe('2026-07-30');
    expect(estadoPlazo('2026-07-31T05:30:00Z', '2026-08-01').fechaLimite).toBe('2026-10-30');
  });
  it('con offset explícito de México', () => {
    expect(fechaLocalMX('2026-07-30T23:30:00-06:00')).toBe('2026-07-30');
  });
  it('hora sin zona se toma como local; fecha pura se respeta; Date se convierte', () => {
    expect(fechaLocalMX('2026-07-30 23:30:00')).toBe('2026-07-30');
    expect(fechaLocalMX('2026-07-30')).toBe('2026-07-30');
    expect(fechaLocalMX(new Date('2026-07-31T05:30:00Z'))).toBe('2026-07-30');
  });
  it('"hoy" también se lleva a fecha local: a las 22:00 de México del día límite sigue siendo el día límite', () => {
    // 2026-10-16T04:00Z = 2026-10-15 22:00 en México
    expect(estadoPlazo('2026-07-15', '2026-10-16T04:00:00Z')).toMatchObject({ estado: 'por_vencer', diasRestantes: 0 });
  });
  it('una fecha inventada lanza', () => {
    expect(() => fechaLocalMX('2026-02-30')).toThrow('fecha_invalida');
    expect(() => fechaLocalMX('mañana')).toThrow('fecha_invalida');
    expect(() => estadoPlazo('', '2026-01-01')).toThrow('fecha_invalida');
  });
});

describe('clasificarPlazos', () => {
  const hoy = '2026-10-10';
  const c = (lineaId: string, desgloseId: string, fechaCruce: string, monto: number, reclamado = false): CandidatoPlazo => ({ lineaId, desgloseId, fechaCruce, monto, reclamado });

  it('separa vigentes, por vencer (con monto agrupado) y vencidos', () => {
    const r = clasificarPlazos([
      c('l1', 'dA', '2026-07-12', 300.1), // límite 10-12: faltan 2 -> umbral 7
      c('l2', 'dA', '2026-07-15', 0.2), // límite 10-15: faltan 5 -> umbral 7
      c('l3', 'dA', '2026-09-20', 50), // vigente
      c('l4', 'dB', '2026-07-01', 1000), // límite 10-01: vencido
      c('l5', 'dB', '2026-08-01', 70), // límite 11-01: faltan 22 -> umbral 30
    ], hoy);
    expect(r.reclamables.sort()).toEqual(['l1', 'l2', 'l3', 'l5']);
    expect(r.vencidos).toEqual({ cruces: 1, monto: 1000, lineaIds: ['l4'] });
    expect(r.porVencer).toEqual([
      { desgloseId: 'dA', umbral: 7, cruces: 2, monto: 300.3, diasMinimos: 2, fechaLimiteMasProxima: '2026-10-12', lineaIds: ['l1', 'l2'] },
      { desgloseId: 'dB', umbral: 30, cruces: 1, monto: 70, diasMinimos: 22, fechaLimiteMasProxima: '2026-11-01', lineaIds: ['l5'] },
    ]);
  });
  it('un desglose con cruces en dos umbrales produce dos grupos', () => {
    const r = clasificarPlazos([c('a', 'dA', '2026-07-12', 10), c('b', 'dA', '2026-08-05', 20)], hoy);
    expect(r.porVencer.map((g) => [g.umbral, g.cruces])).toEqual([[7, 1], [30, 1]]);
  });
  it('un candidato ya reclamado no avisa ni se descarta', () => {
    const r = clasificarPlazos([c('l1', 'dA', '2026-07-12', 300, true), c('l2', 'dA', '2026-06-01', 99, true)], hoy);
    expect(r).toEqual({ reclamables: [], porVencer: [], vencidos: { cruces: 0, monto: 0, lineaIds: [] }, yaReclamados: 2 });
  });
  it('sin candidatos', () => {
    expect(clasificarPlazos([], hoy).porVencer).toEqual([]);
  });
  it('suma en centavos sin deriva de coma flotante', () => {
    const r = clasificarPlazos([c('a', 'd', '2026-07-12', 0.1), c('b', 'd', '2026-07-12', 0.2)], hoy);
    expect(r.porVencer[0].monto).toBe(0.3);
  });
});
