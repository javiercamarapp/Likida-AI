import { describe, it, expect } from 'vitest';
import { evaluarContraTarifa, resumirTarifa, tarifasDesdeInferidas, type LineaParaTarifa } from './reglas_tarifa';
import type { TarifaExistente } from './tarifario_archivo';
import { inferirTarifas } from './tarifario_inferido';

const tarifa = (p: Partial<TarifaExistente> = {}): TarifaExistente => ({
  casetaNorm: 'caseta ejemplo norte', clase: 5, importe: 300, vigenteDesde: '2026-01-01', vigenteHasta: null,
  origen: 'declarada', confirmada: true, confirmadaPor: 'finanzas-demo', ...p,
});
const linea = (p: Partial<LineaParaTarifa> = {}): LineaParaTarifa => ({
  indice: 0, fecha: '2026-09-10', caseta: 'Caseta Ejemplo Norte', unidad: 'TC9001', clase: 5, monto: 300, ...p,
});

describe('evaluarContraTarifa', () => {
  it('clase 9 a $437 con tarifa clase 5 confirmada $300 → reclamable $137, confirmado', () => {
    const [r] = evaluarContraTarifa([linea({ clase: 9, monto: 437 })], [tarifa()]);
    expect(r.claseEsperada).toBe(5);
    expect(r.importeEsperado).toBe(300);
    expect(r.montoReclamable).toBe(137);
    expect(r.estadoTarifa).toBe('cobro_indebido_confirmado');
    expect(r.categoriaTarifa).toBeNull();
  });

  it('la misma línea sin tarifa confirmada (inferida) sigue siendo candidato', () => {
    const [r] = evaluarContraTarifa([linea({ clase: 9, monto: 437 })], [tarifa({ origen: 'inferida', confirmada: false, confirmadaPor: null })]);
    expect(r.estadoTarifa).toBe('candidato_con_tarifa_inferida');
    expect(r.montoReclamable).toBe(137);
    expect(r.tarifaOrigen).toBe('inferida');
  });

  it('sin tarifa → sin_tarifa y nada reclamable', () => {
    const [r] = evaluarContraTarifa([linea({ monto: 999 })], []);
    expect(r.estadoTarifa).toBe('sin_tarifa');
    expect(r.importeEsperado).toBeNull();
    expect(r.montoReclamable).toBe(0);
  });

  it('importe menor que la tarifa no reclama', () => {
    const [r] = evaluarContraTarifa([linea({ monto: 250 })], [tarifa()]);
    expect(r.montoReclamable).toBe(0);
    expect(r.estadoTarifa).toBe('dentro_de_tarifa');
  });

  it('tarifa vencida no aplica; la vigente en la fecha sí', () => {
    const vencida = tarifa({ vigenteDesde: '2026-01-01', vigenteHasta: '2026-08-31', importe: 100 });
    const [a] = evaluarContraTarifa([linea({ fecha: '2026-09-10', monto: 437 })], [vencida]);
    expect(a.estadoTarifa).toBe('sin_tarifa');
    const [b] = evaluarContraTarifa([linea({ fecha: '2026-08-31', monto: 437 })], [vencida]);
    expect(b.importeEsperado).toBe(100);
  });

  it('tarifa que aún no inicia no aplica', () => {
    const [r] = evaluarContraTarifa([linea({ fecha: '2025-12-31', monto: 437 })], [tarifa()]);
    expect(r.estadoTarifa).toBe('sin_tarifa');
  });

  it('redondea a centavos sin ruido de punto flotante', () => {
    const [r] = evaluarContraTarifa([linea({ monto: 300.3 })], [tarifa({ importe: 100.1 })], { toleranciaPesos: 0 });
    expect(r.montoReclamable).toBe(200.2);
  });

  it('tolerancia: exceso igual a la tolerancia no es cobro indebido; mayor sí', () => {
    const [a] = evaluarContraTarifa([linea({ monto: 301 })], [tarifa()], { toleranciaPesos: 1 });
    expect(a.estadoTarifa).toBe('dentro_de_tarifa');
    const [b] = evaluarContraTarifa([linea({ monto: 301.01 })], [tarifa()], { toleranciaPesos: 1 });
    expect(b.estadoTarifa).toBe('cobro_indebido_confirmado');
    const [c] = evaluarContraTarifa([linea({ monto: 305 })], [tarifa()], { toleranciaPesos: 10 });
    expect(c.estadoTarifa).toBe('dentro_de_tarifa');
  });

  it('categoría importe_sobre_tarifa: clase válida registrada y cobro más caro que su tarifa', () => {
    const [r] = evaluarContraTarifa([linea({ clase: 5, monto: 450 })], [tarifa()]);
    expect(r.categoriaTarifa).toBe('importe_sobre_tarifa');
    expect(r.montoReclamable).toBe(150);
  });

  it('unidad sin caja usa la tarifa de clase 3', () => {
    const t = [tarifa(), tarifa({ clase: 3, importe: 200 })];
    const [r] = evaluarContraTarifa([linea({ clase: 3, monto: 260, unidad: 'TC9002' })], t, { unidadesSinCaja: new Set(['tc9002']) });
    expect(r.claseEsperada).toBe(3);
    expect(r.importeEsperado).toBe(200);
    expect(r.montoReclamable).toBe(60);
    // cobrada como clase 5 siendo unidad sin caja: se compara contra la 3
    const [s] = evaluarContraTarifa([linea({ clase: 5, monto: 300, unidad: 'TC9002' })], t, { unidadesSinCaja: new Set(['tc9002']) });
    expect(s.claseEsperada).toBe(3);
    expect(s.montoReclamable).toBe(100);
  });

  it('clase registrada válida por excepción de la caseta (por pasada, clase 1)', () => {
    const t = [tarifa({ clase: 1, importe: 82 })];
    const [r] = evaluarContraTarifa([linea({ clase: 1, monto: 82 })], t, { excepcionesClase: new Map([['caseta ejemplo norte', [1]]]) });
    expect(r.claseEsperada).toBe(1);
    expect(r.estadoTarifa).toBe('dentro_de_tarifa');
    // sin la excepción, la clase 1 no es válida y se espera 5
    const [s] = evaluarContraTarifa([linea({ clase: 1, monto: 82 })], [tarifa()]);
    expect(s.claseEsperada).toBe(5);
  });

  it('prefiere la tarifa confirmada sobre la inferida y no depende del orden', () => {
    const inf = tarifa({ origen: 'inferida', confirmada: false, confirmadaPor: null, importe: 280 });
    const con = tarifa({ importe: 300 });
    const a = evaluarContraTarifa([linea({ monto: 437 })], [inf, con])[0];
    const b = evaluarContraTarifa([linea({ monto: 437 })], [con, inf])[0];
    expect(a.estadoTarifa).toBe('cobro_indebido_confirmado');
    expect(b).toEqual(a);
  });

  it('caseta con mayúsculas y acentos distintos se normaliza', () => {
    const [r] = evaluarContraTarifa([linea({ caseta: '  CASETA  Ejémplo NORTE ', monto: 437 })], [tarifa()]);
    expect(r.estadoTarifa).toBe('cobro_indebido_confirmado');
  });

  it('GUARDIA: ningún texto afirma «indebido» si la tarifa no está confirmada', () => {
    const lineas = [linea({ monto: 437 }), linea({ indice: 1, monto: 100 }), linea({ indice: 2, caseta: 'Otra' })];
    const inferida = tarifa({ origen: 'inferida', confirmada: false, confirmadaPor: null });
    for (const r of [...evaluarContraTarifa(lineas, [inferida]), ...evaluarContraTarifa(lineas, [])]) {
      expect(r.estadoTarifa).not.toBe('cobro_indebido_confirmado');
      const texto = `${r.quePasoTarifa} ${r.queSignificaTarifa} ${r.queHacerTarifa}`.toLowerCase();
      expect(texto).not.toContain('indebido');
    }
    const [conf] = evaluarContraTarifa([linea({ monto: 437 })], [tarifa()]);
    expect(conf.queSignificaTarifa.toLowerCase()).toContain('indebido');
    expect(conf.queSignificaTarifa).toContain('confirmada');
  });

  it('acepta candidatos de reglas_cobro (campos extra se conservan)', () => {
    const [r] = evaluarContraTarifa([{ ...linea({ monto: 437 }), categoria: 'clase_fuera_de_3_5' as const, quePaso: 'x' }], [tarifa()]);
    expect(r.categoria).toBe('clase_fuera_de_3_5');
    expect(r.montoReclamable).toBe(137);
  });
});

describe('resumirTarifa y tarifas inferidas', () => {
  it('separa lo confirmado de lo no confirmado', () => {
    const lineas = [linea({ monto: 437 }), linea({ indice: 1, caseta: 'Caseta B', monto: 500 }), linea({ indice: 2, caseta: 'Caseta C', monto: 10 }), linea({ indice: 3, monto: 300 })];
    const tarifas = [tarifa(), tarifa({ casetaNorm: 'caseta b', importe: 400, origen: 'inferida', confirmada: false, confirmadaPor: null })];
    const r = resumirTarifa(evaluarContraTarifa(lineas, tarifas));
    expect(r).toEqual({ montoConfirmado: 137, montoNoConfirmado: 100, nConfirmados: 1, nCandidatos: 1, nSinTarifa: 1, nDentro: 1 });
  });

  it('tarifasDesdeInferidas nunca produce tarifas confirmadas', () => {
    const cruces = [...Array(30).fill(0).map(() => ({ caseta: 'Caseta Ejemplo Norte', clase: 5, monto: 300 })), ...Array(3).fill(0).map(() => ({ caseta: 'Caseta Ejemplo Norte', clase: 5, monto: 450 }))];
    const t = tarifasDesdeInferidas(inferirTarifas(cruces).tarifas);
    expect(t).toHaveLength(1);
    expect(t.every((x) => x.confirmada === false && x.origen === 'inferida')).toBe(true);
    const [r] = evaluarContraTarifa([linea({ monto: 450 })], t);
    expect(r.estadoTarifa).toBe('candidato_con_tarifa_inferida');
    expect(r.montoReclamable).toBe(150);
  });
});
