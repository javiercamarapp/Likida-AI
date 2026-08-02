import { describe, it, expect } from 'vitest';
import { guardiaFundamento } from './fundamento';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9, ALTO agéntico — la memoria (AUDITORÍA 8, AG-2) se concedía por
// `norma_id` solo: si "RFA 2026 regla 2.9" ya apareció una vez en el viaje
// (legítimamente, sobre diésel en efectivo), el modelo podía pegarla sin tool
// en CUALQUIER frase posterior, sobre cualquier tema, y la guardia la dejaba
// pasar porque el id ya estaba "visto". El escenario exacto del auditor:
// turno 1 establece la cita sobre diésel, turno 2 la reutiliza sobre una
// caseta — mismo id, tema distinto, cita mal aplicada con el sello de la
// guardia encima.
//
// El arreglo compara la ORACIÓN que trae la cita ahora contra las oraciones
// que la trajeron antes, por palabras compartidas fuera de la cita misma.
// ═══════════════════════════════════════════════════════════════════════════

const HISTORIAL_DIESEL =
  'Diésel pagado en EFECTIVO — cuenta contra el tope del 15% del combustible del ejercicio (RFA 2026 regla 2.9). Dentro del 15% sigue siendo deducible; el excedente no.';

describe('la memoria de guardiaFundamento es por TEMA, no por id', () => {
  it('el escenario del auditor: la cita de diésel NO se puede pegar sin tool en una frase sobre caseta', () => {
    const r = guardiaFundamento(
      'Sí, la caseta es deducible al 100%; la regla 2.9 de la RFA 2026 lo permite.',
      [],
      HISTORIAL_DIESEL,
    );
    expect(r.forzado, 'la cita mal aplicada tenía que quitarse, no certificarse').toBe(true);
    expect(r.reply).not.toMatch(/regla 2\.9|RFA 2026/i);
    expect(r.quitadas).toContain('rfa-2026-2.9');
  });

  it('control: la MISMA afirmación (diésel, efectivo, tope) sí se admite por memoria sin tool', () => {
    const r = guardiaFundamento(
      'Recuerda: tu diésel pagado en efectivo cuenta contra el tope del 15% del combustible del ejercicio, según la RFA 2026 regla 2.9.',
      [],
      HISTORIAL_DIESEL,
    );
    expect(r.forzado, 'repetir la MISMA afirmación es memoria, no alucinación').toBe(false);
    expect(r.reply).toMatch(/RFA 2026 regla 2\.9/i);
  });

  it('sin historial, el id nunca se admite por memoria (no hay nada que comparar)', () => {
    const r = guardiaFundamento('La regla 2.9 de la RFA 2026 aplica aquí.', [], '');
    expect(r.forzado).toBe(true);
  });

  it('una cita pelada, sin ninguna palabra de tema alrededor, no se admite por memoria', () => {
    // "RFA 2026 regla 2.9." a secas: no hay nada que comparar contra el
    // historial más allá del id mismo, y el id solo no basta.
    const r = guardiaFundamento('RFA 2026 regla 2.9.', [], HISTORIAL_DIESEL);
    expect(r.forzado).toBe(true);
  });

  it('la memoria sigue funcionando para una tool call de ESTE turno, sin depender del historial', () => {
    const r = guardiaFundamento('El diésel en efectivo se limita al 15% (RFA 2026 regla 2.9).', ['rfa-2026-2.9'], '');
    expect(r.forzado).toBe(false);
  });
});
