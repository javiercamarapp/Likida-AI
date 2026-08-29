import { describe, test, expect } from 'vitest';
import { fechaImposiblePorFutura } from './ocr';

// ═══════════════════════════════════════════════════════════════════════════
// LA FECHA IMPOSIBLE SE RECHAZA, NO SE ADIVINA.
//
// El patrón medido en el banco de QA (corrida 46ad99ca): el extractor volteó
// día y mes en 6 tickets ("2/8/2026" leído como 8 de febrero). Cuando el
// volteo cae ADELANTE del reloj, la fecha es imposible —un gasto es dinero ya
// gastado— y el intake la descarta a "no leída" para que `pedir_fecha` se la
// pregunte al operador. Lo que se fija aquí:
//
//  1. futura por más de un día = imposible;
//  2. hoy, ayer y el pasado NUNCA se rechazan (rechazar de más inventaría
//     huecos en tickets buenos);
//  3. un día de gracia por el huso — el ticket de las 23:50 en Tijuana contra
//     un reloj que ya amaneció no es mala lectura;
//  4. sin fecha o con basura, NO se afirma nada (false: no hay qué rechazar).
// ═══════════════════════════════════════════════════════════════════════════

describe('fechaImposiblePorFutura', () => {
  const HOY = '2026-08-28';

  test('el caso medido: día/mes volteados que caen adelante del reloj', () => {
    // Un ticket del 2 de agosto leído "2026-02-08" queda en el PASADO y esta
    // red no lo caza (lo caza el prompt); pero el del 28-ago leído como
    // 28 de un mes futuro sí es imposible.
    expect(fechaImposiblePorFutura('2026-12-08', HOY)).toBe(true);
    expect(fechaImposiblePorFutura('2027-01-15', HOY)).toBe(true);
  });

  test('hoy, mañana (gracia de huso) y el pasado pasan', () => {
    expect(fechaImposiblePorFutura('2026-08-28', HOY)).toBe(false);
    expect(fechaImposiblePorFutura('2026-08-29', HOY)).toBe(false);   // 1 día de gracia
    expect(fechaImposiblePorFutura('2026-08-30', HOY)).toBe(true);    // 2 días ya no
    expect(fechaImposiblePorFutura('2026-02-08', HOY)).toBe(false);   // pasado: no se toca
    expect(fechaImposiblePorFutura('2020-01-01', HOY)).toBe(false);
  });

  test('sin fecha o con basura no se afirma nada', () => {
    expect(fechaImposiblePorFutura(undefined, HOY)).toBe(false);
    expect(fechaImposiblePorFutura('no-es-fecha', HOY)).toBe(false);
    expect(fechaImposiblePorFutura('2026-08-29', 'basura')).toBe(false);
  });
});
