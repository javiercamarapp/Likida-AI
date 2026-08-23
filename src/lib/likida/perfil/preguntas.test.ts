import { describe, it, expect } from 'vitest';
import { calificaEstimuloPeaje, preguntaPendienteEstimuloPeaje, declararIngresosYParteRelacionada, PREGUNTA_ESTIMULO_PEAJE } from './preguntas';

const declarado = (ingresosAnualesMxn: number, parteRelacionada: boolean) => ({
  ingresosAnualesMxn: { valor: ingresosAnualesMxn, procedencia: 'declarado' },
  parteRelacionada: { valor: parteRelacionada, procedencia: 'declarado' },
});

describe('calificaEstimuloPeaje — FASE 3', () => {
  it('perfil vacío (nunca se preguntó) → elegible null, no se afirma nada', () => {
    expect(calificaEstimuloPeaje({})).toEqual({ elegible: null });
  });

  it('perfil ausente (undefined/null crudo) → elegible null, no lanza', () => {
    expect(calificaEstimuloPeaje(undefined)).toEqual({ elegible: null });
    expect(calificaEstimuloPeaje(null)).toEqual({ elegible: null });
  });

  it('declarado: ingresos bajos y sin parte relacionada → elegible true', () => {
    expect(calificaEstimuloPeaje(declarado(50_000_000, false))).toEqual({ elegible: true });
  });

  it('declarado: ingresos ≥ $300M → elegible false, aunque no sea parte relacionada', () => {
    expect(calificaEstimuloPeaje(declarado(300_000_000, false))).toEqual({ elegible: false });
    expect(calificaEstimuloPeaje(declarado(500_000_000, false))).toEqual({ elegible: false });
  });

  it('declarado: parte relacionada → elegible false, aunque los ingresos sean bajos', () => {
    expect(calificaEstimuloPeaje(declarado(1_000_000, true))).toEqual({ elegible: false });
  });

  it('solo un campo declarado (falta el otro) → elegible null, no se adivina el que falta', () => {
    expect(calificaEstimuloPeaje({ ingresosAnualesMxn: { valor: 1_000_000, procedencia: 'declarado' } })).toEqual({ elegible: null });
    expect(calificaEstimuloPeaje({ parteRelacionada: { valor: false, procedencia: 'declarado' } })).toEqual({ elegible: null });
  });

  it('EL CANDADO: procedencia "inferido" NUNCA decide, aunque el valor exista', () => {
    const perfilInferido = {
      ingresosAnualesMxn: { valor: 50_000_000, procedencia: 'inferido' },
      parteRelacionada: { valor: false, procedencia: 'declarado' },
    };
    expect(calificaEstimuloPeaje(perfilInferido)).toEqual({ elegible: null });
  });

  it('procedencia "ausente" se trata igual que no contestado', () => {
    const perfil = {
      ingresosAnualesMxn: { valor: 0, procedencia: 'ausente' },
      parteRelacionada: { valor: false, procedencia: 'declarado' },
    };
    expect(calificaEstimuloPeaje(perfil)).toEqual({ elegible: null });
  });
});

describe('preguntaPendienteEstimuloPeaje', () => {
  it('perfil vacío → devuelve la pregunta', () => {
    expect(preguntaPendienteEstimuloPeaje({})).toBe(PREGUNTA_ESTIMULO_PEAJE);
  });

  it('perfil completo y declarado → null, ya no hay nada que preguntar', () => {
    expect(preguntaPendienteEstimuloPeaje(declarado(50_000_000, false))).toBeNull();
  });

  it('con un valor INFERIDO, sigue devolviendo la pregunta (es sugerencia, no respuesta)', () => {
    const perfil = { ingresosAnualesMxn: { valor: 50_000_000, procedencia: 'inferido' } };
    expect(preguntaPendienteEstimuloPeaje(perfil)).toBe(PREGUNTA_ESTIMULO_PEAJE);
  });
});

describe('declararIngresosYParteRelacionada', () => {
  it('arma el patch con procedencia "declarado" en los dos campos', () => {
    const patch = declararIngresosYParteRelacionada(120_000_000, true);
    expect(patch).toEqual({
      ingresosAnualesMxn: { valor: 120_000_000, procedencia: 'declarado' },
      parteRelacionada: { valor: true, procedencia: 'declarado' },
    });
  });

  it('el patch, aplicado, hace que calificaEstimuloPeaje ya pueda decidir', () => {
    const patch = declararIngresosYParteRelacionada(120_000_000, false);
    expect(calificaEstimuloPeaje(patch)).toEqual({ elegible: true });
  });
});
