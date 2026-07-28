import { describe, it, expect } from 'vitest';
import { evaluarTope15, UMBRAL_ALERTA, TOPE_EFECTIVO } from './combustible';

// ═══════════════════════════════════════════════════════════════════════════
// EL 15% ES DEL EJERCICIO, NO DEL VIAJE.
//
// Es la propuesta de valor que ningún competidor tiene, y hasta hoy el motor no
// podía darla: `engine.ts` es puro y evalúa UN viaje, así que marcaba el diésel
// en efectivo como "por confirmar" a ciegas — sin saber si la flota va por el
// 3% del ejercicio (tranquilo) o por el 14.8% (a punto de perder la deducción).
//
// RFA 2026 regla 2.9, ficha `verificado_fuente_primaria`: los pagos en efectivo
// valen "siempre que estos no excedan el 15 por ciento del total de los pagos
// efectuados por consumo de combustible para realizar su actividad".
//
// Base: efectivo / TOTAL DE COMBUSTIBLE del ejercicio. No sobre el gasto total
// de la flota, no sobre las erogaciones, no un monto fijo por ticket.
// ═══════════════════════════════════════════════════════════════════════════
describe('evaluarTope15', () => {
  it('la razón es efectivo sobre el total de COMBUSTIBLE', () => {
    const r = evaluarTope15({ efectivo: 15_000, totalCombustible: 100_000 });
    expect(r.razon).toBeCloseTo(0.15, 6);
    expect(TOPE_EFECTIVO).toBe(0.15);
  });

  it('por debajo del umbral está tranquilo', () => {
    const r = evaluarTope15({ efectivo: 3_000, totalCombustible: 100_000 });
    expect(r.estado).toBe('holgado');
    expect(r.excedente).toBe(0);
  });

  it('cerca del tope avisa ANTES de que sea tarde', () => {
    // Avisar al 15% ya no sirve: la deducción se perdió. El semáforo es decisión
    // de producto, no regla legal, y por eso el umbral está nombrado aparte.
    const r = evaluarTope15({ efectivo: 13_000, totalCombustible: 100_000 });
    expect(r.estado).toBe('cerca');
    expect(UMBRAL_ALERTA).toBeLessThan(TOPE_EFECTIVO);
  });

  it('pasado el tope, calcula el EXCEDENTE, no tira todo', () => {
    // "Rebasar el 15% no reduce proporcionalmente la deducción: tira el
    // excedente completo." No el acumulado entero, ni el gasto que lo cruzó.
    const r = evaluarTope15({ efectivo: 20_000, totalCombustible: 100_000 });
    expect(r.estado).toBe('excedido');
    expect(r.excedente).toBe(5_000);      // 20,000 − 15% de 100,000
  });

  it('el excedente nunca es negativo', () => {
    expect(evaluarTope15({ efectivo: 1_000, totalCombustible: 100_000 }).excedente).toBe(0);
  });

  it('sin combustible en el ejercicio no hay razón que calcular', () => {
    // Dividir por cero daría NaN o Infinity y eso acabaría impreso en un PDF.
    const r = evaluarTope15({ efectivo: 0, totalCombustible: 0 });
    expect(r.razon).toBe(0);
    expect(r.estado).toBe('holgado');
    expect(Number.isFinite(r.razon)).toBe(true);
  });

  it('efectivo sin denominador no revienta ni afirma', () => {
    // Dato inconsistente (hay efectivo pero el total es 0): no se puede evaluar.
    const r = evaluarTope15({ efectivo: 5_000, totalCombustible: 0 });
    expect(r.estado).toBe('sin_criterio');
    expect(Number.isFinite(r.razon)).toBe(true);
  });

  it('cuánto efectivo más cabe antes de perder deducción', () => {
    // Es lo accionable para el contralor: no "vas al 12%", sino "te quedan
    // $3,000 de margen este año".
    const r = evaluarTope15({ efectivo: 12_000, totalCombustible: 100_000 });
    expect(r.margen).toBe(3_000);
  });

  it('sin margen, el margen es 0 y no un número negativo', () => {
    expect(evaluarTope15({ efectivo: 20_000, totalCombustible: 100_000 }).margen).toBe(0);
  });

  it('redondea a centavos: esto se imprime', () => {
    const r = evaluarTope15({ efectivo: 1_000, totalCombustible: 3_000 });
    expect(r.excedente).toBe(550);   // 1000 − 450
    expect(Number.isInteger(r.excedente * 100)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL LÍMITE EXACTO. Señalado en la auditoría 3 como el hueco de estos tests:
// se verificaba "por debajo" y "por encima", nunca el punto donde la ley cambia
// de opinión — que es justo donde un `>` mal puesto cuesta dinero.
//
// La regla dice "siempre que estos NO EXCEDAN el 15 por ciento". Exactamente el
// 15% NO excede: está permitido. Un `>=` ahí le quitaría la deducción a una
// flota que cumple.
// ═══════════════════════════════════════════════════════════════════════════
describe('evaluarTope15 — el límite exacto', () => {
  it('exactamente el 15% NO excede: la regla dice "no excedan"', () => {
    const r = evaluarTope15({ efectivo: 15_000, totalCombustible: 100_000 });
    expect(r.estado).not.toBe('excedido');
    expect(r.excedente).toBe(0);
    expect(r.margen).toBe(0);
  });

  it('un centavo por encima SÍ excede', () => {
    const r = evaluarTope15({ efectivo: 15_000.01, totalCombustible: 100_000 });
    expect(r.estado).toBe('excedido');
    expect(r.excedente).toBeCloseTo(0.01, 2);
  });

  it('un centavo por debajo no excede, y deja margen', () => {
    const r = evaluarTope15({ efectivo: 14_999.99, totalCombustible: 100_000 });
    expect(r.estado).not.toBe('excedido');
    expect(r.margen).toBeCloseTo(0.01, 2);
  });

  it('exactamente en el umbral de aviso ya avisa', () => {
    // El umbral de alerta es de producto, no legal: ahí conviene el `>=` para
    // avisar antes y no después.
    const r = evaluarTope15({ efectivo: 12_000, totalCombustible: 100_000 });
    expect(r.estado).toBe('cerca');
  });

  it('un centavo por debajo del umbral de aviso todavía está holgado', () => {
    expect(evaluarTope15({ efectivo: 11_999.99, totalCombustible: 100_000 }).estado).toBe('holgado');
  });
});
