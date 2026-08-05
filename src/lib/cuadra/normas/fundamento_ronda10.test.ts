import { describe, it, expect } from 'vitest';
import { guardiaFundamento } from './fundamento';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, ALTO agéntico — REINCIDENTE de las rondas 8 y 9.
//
// La ronda 8 abrió la memoria por `norma_id`. La ronda 9 la cerró por "tema":
// se concede si la oración que trae la cita hoy comparte al menos DOS palabras
// —fuera de la cita, quitando el relleno— con la oración que la trajo antes.
// Eso cerró la FRASE del ejemplo de la ronda 9 y no la CLASE.
//
// El agujero: el vocabulario compartido lo puso el propio sistema en el turno
// anterior. El modelo que reformula la frase del sistema aplicándola a OTRO
// gasto obtiene la memoria justamente POR reformularla bien:
//
//   historial (motor):  «Diésel pagado en EFECTIVO — cuenta contra el tope del
//                        15% del combustible del ejercicio (RFA 2026 regla 2.9)»
//   modelo, sin tool:   «Tu CASETA pagada en efectivo cuenta contra el tope del
//                        15% del combustible del ejercicio (RFA 2026 regla 2.9)»
//
// Comparten «pagada/pagado», «efectivo», «cuenta», «contra», «tope»,
// «combustible», «ejercicio»: siete palabras, y el umbral son dos. Pasaba
// ENTERA, con el sello de la guardia encima. La regla 2.9 de la RFA 2026 es el
// tope del 15% del COMBUSTIBLE pagado en efectivo: ni una caseta ni una comida
// están dentro.
//
// El turno es alcanzable: `tieneCifrasDeDinero` es falso sobre esas frases (no
// llevan `$`), así que `guardiaCifras` no fuerza, `textoDeterminista` queda
// false y esta guardia sí corre con `permitidas = []` — el caso en que la
// memoria decide sola.
//
// El arreglo ata la memoria a la AFIRMACIÓN y no al vocabulario: si la oración
// de hoy nombra un gasto que la de ayer no nombraba, no es la misma afirmación.
// ═══════════════════════════════════════════════════════════════════════════

const HISTORIAL_DIESEL =
  'Diésel pagado en EFECTIVO — cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9). Dentro del 15% sigue siendo deducible; el excedente no.';

describe('la memoria por tema no certifica una cita bien nombrada y mal aplicada', () => {
  it('la CASETA reformulada con las palabras del sistema no hereda la cita del diésel', () => {
    const r = guardiaFundamento(
      'Tu caseta pagada en efectivo cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9).',
      [],
      HISTORIAL_DIESEL,
    );
    expect(r.forzado, 'reformular bien la frase del sistema no puede ser un permiso').toBe(true);
    expect(r.reply).not.toMatch(/regla 2\.9|RFA 2026/i);
    expect(r.quitadas).toContain('rfa-2026-2.9');
  });

  it('la COMIDA tampoco', () => {
    const r = guardiaFundamento(
      'La comida que pagaste en efectivo cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9).',
      [],
      HISTORIAL_DIESEL,
    );
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toMatch(/regla 2\.9|RFA 2026/i);
  });

  it('ni el hospedaje, aunque copie la frase entera', () => {
    const r = guardiaFundamento(
      'Tu hospedaje pagado en efectivo cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9).',
      [],
      HISTORIAL_DIESEL,
    );
    expect(r.forzado).toBe(true);
  });

  // ── Controles: la memoria legítima sigue viva ────────────────────────────
  it('el MISMO gasto sí conserva la cita: repetir la afirmación de ayer es memoria', () => {
    const r = guardiaFundamento(
      'Recuerda: tu diésel pagado en efectivo cuenta contra el tope del 15% del combustible del ejercicio, según la RFA 2026 regla 2.9.',
      [],
      HISTORIAL_DIESEL,
    );
    expect(r.forzado, 'repetir la MISMA afirmación no es alucinación').toBe(false);
    expect(r.reply).toMatch(/RFA 2026 regla 2\.9/i);
  });

  it('y una tool de ESTE turno manda por encima de todo esto', () => {
    const r = guardiaFundamento(
      'Tu caseta pagada en efectivo cuenta contra el tope del 15% (RFA 2026 regla 2.9).',
      ['rfa-2026-2.9'],
      HISTORIAL_DIESEL,
    );
    expect(r.forzado, 'lo que una tool devolvió este turno no lo decide la memoria').toBe(false);
  });

  it('si el historial no nombra ningún gasto, la memoria sigue decidiendo por tema', () => {
    // El sujeto solo VETA: cuando la oración de ayer no nombra gasto alguno, no
    // hay conflicto que detectar y manda la comparación de palabras de siempre.
    // Es el caso de `processor_fundamento_historial.test.ts`, donde el turno
    // previo dice «el pago en efectivo tiene tope» sin decir de qué.
    const r = guardiaFundamento(
      'Sí cuenta, pero ojo: el pago de diésel en efectivo tiene tope conforme al artículo 27, fracción III de la LISR.',
      [],
      'Ojo: el pago en efectivo tiene tope conforme al artículo 27, fracción III de la LISR.',
    );
    expect(r.forzado).toBe(false);
  });
});
