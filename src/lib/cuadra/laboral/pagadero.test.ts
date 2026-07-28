import { describe, it, expect } from 'vitest';
import { veredictoLaboral, topeDescuento } from './pagadero';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// DEDUCIBLE ≠ PAGADERO. Son dos veredictos distintos y el producto los mezclaba.
//
// El motor solo emitía `deducible`. De ahí a un descuento de nómina hay un paso
// que la ley NO permite dar: que un gasto no sea deducible para ISR no autoriza
// descontárselo al operador. Sin esta separación, una liquidación puede imprimir
// un neto ilegal — y el papel lo firma la flota.
//
// LFT art. 263 fr. I, verificado contra fuente primaria:
//   "En los transportes foráneos pagar los gastos de hospedaje y alimentación de
//    los trabajadores, cuando se prolongue o retarde el viaje por causa que no
//    sea imputable a éstos"
//
// Choca de frente con "excede la política de la empresa → rechazado": cuando el
// viaje se alargó por causa ajena, el gasto SE DEBE aunque rompa la política y
// aunque parte no sea deducible.
// ═══════════════════════════════════════════════════════════════════════════
const g = (p: Partial<Gasto>): Gasto => ({ id: 'g1', concepto: 'alimentacion', monto: 500, ...p });

describe('veredictoLaboral', () => {
  it('un gasto NO deducible sigue siendo pagadero: el operador ya puso el dinero', () => {
    // El caso más común: un ticket sin timbrar. No es deducible todavía, pero el
    // operador pagó de su bolsa y eso no se le puede descontar por un problema
    // de papeleo.
    const r = veredictoLaboral(g({ concepto: 'diesel', monto: 800 }), { deducible: false, demoraNoImputable: false });
    expect(r.pagadero).toBe(true);
  });

  it('hospedaje por demora ajena SE DEBE aunque rompa la política', () => {
    // Art. 263 fr. I. Es la obligación que choca con la lógica de topes.
    const r = veredictoLaboral(
      g({ concepto: 'hospedaje', monto: 1_800 }),
      { deducible: false, sobrePolitica: true, demoraNoImputable: true },
    );
    expect(r.pagadero).toBe(true);
    expect(r.fundamento).toContain('lft-110-111-263');
    expect(r.nota).toMatch(/no imputable|ajena/i);
  });

  it('alimentación por demora ajena, igual', () => {
    const r = veredictoLaboral(
      g({ concepto: 'alimentacion', monto: 900 }),
      { deducible: false, sobrePolitica: true, demoraNoImputable: true },
    );
    expect(r.pagadero).toBe(true);
  });

  it('el art. 263 fr. I cubre hospedaje y alimentación, NO cualquier gasto', () => {
    // Una multa de tránsito con el viaje demorado no entra en esa obligación:
    // no se vuelve pagadero de oficio, va a revisión. (La ficha se sigue citando
    // porque cubre también el 110 fr. I, que es lo que aplica aquí.)
    const r = veredictoLaboral(
      g({ concepto: 'otro', monto: 1_200 }),
      { deducible: false, sobrePolitica: true, demoraNoImputable: true },
    );
    expect(r.pagadero).toBe('sin_criterio');
    expect(r.nota).not.toMatch(/obligaci[oó]n del patr[oó]n/i);
  });

  it('sobre política SIN demora ajena queda a criterio, no se descuenta solo', () => {
    // Aquí la ley no obliga a pagarlo, pero tampoco autoriza el descuento
    // automático: hace falta acuerdo (art. 110 fr. I). Va a la bandeja.
    const r = veredictoLaboral(
      g({ concepto: 'alimentacion', monto: 900 }),
      { deducible: true, sobrePolitica: true, demoraNoImputable: false },
    );
    expect(r.pagadero).toBe('sin_criterio');
    expect(r.nota).toMatch(/acuerdo|contralor|revisar/i);
  });
});

describe('topeDescuento — art. 110 fr. I', () => {
  it('el saldo exigible nunca pasa del salario de un mes', () => {
    const r = topeDescuento({ saldoPropuesto: 9_000, salarioMensual: 8_000, salarioMinimoMensual: 8_364 });
    expect(r.exigible).toBe(8_000);
    expect(r.recortado).toBe(true);
  });

  it('el descuento periódico nunca pasa del 30% del EXCEDENTE del mínimo', () => {
    // Ojo: del excedente, no del salario. Confundirlo multiplica el descuento.
    const r = topeDescuento({ saldoPropuesto: 5_000, salarioMensual: 12_000, salarioMinimoMensual: 8_364 });
    expect(r.descuentoPeriodo).toBeCloseTo((12_000 - 8_364) * 0.30, 2);
  });

  it('quien gana el mínimo o menos no puede recibir descuento', () => {
    // El excedente es 0 (o negativo): el 30% de eso es 0. Es el resultado
    // correcto, no un borde raro.
    const r = topeDescuento({ saldoPropuesto: 5_000, salarioMensual: 8_000, salarioMinimoMensual: 8_364 });
    expect(r.descuentoPeriodo).toBe(0);
  });

  it('sin salario del operador NO se inventa un tope', () => {
    // Un operador que cobra por viaje o por kilómetro es un esquema válido
    // (art. 257) y ninguna fuente dice cómo convertirlo a "un mes de salario".
    // Va a la bandeja del contralor, no se adivina.
    const r = topeDescuento({ saldoPropuesto: 5_000 });
    expect(r.sinCriterio).toBe(true);
    expect(r.exigible).toBe(0);
    expect(r.descuentoPeriodo).toBe(0);
  });

  it('nunca devuelve intereses ni recargos (art. 111)', () => {
    const r = topeDescuento({ saldoPropuesto: 5_000, salarioMensual: 12_000, salarioMinimoMensual: 8_364 });
    expect(r.exigible).toBeLessThanOrEqual(5_000);   // nunca MÁS que lo propuesto
  });
});
