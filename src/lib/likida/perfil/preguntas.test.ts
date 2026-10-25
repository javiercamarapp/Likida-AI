import { describe, it, expect } from 'vitest';
import { calificaEstimuloPeaje, preguntaPendienteEstimuloPeaje, declararIngresosYParteRelacionada, declararUmbralPeaje, umbralPeajeDeclarado, PREGUNTA_ESTIMULO_PEAJE } from './preguntas';

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

  // ═════════════════════════════════════════════════════════════════════════
  // FIS-34-1 (ALTO, abierto desde la auditoría 34) — un «no» declarado a la
  // Red Nacional se preguntaba, se guardaba y NO LO LEÍA NADIE.
  //
  // `casetasRedNacional` se pregunta en la entrevista (`entrevista.ts:252`), se
  // guarda en el perfil (`preguntas.ts:297`) y se imprime en el resumen
  // (`entrevista.ts:992`), pero `calificaEstimuloPeaje` nunca lo miraba: una
  // flota que contesta «no» salía `elegible: true` y el PDF le imprimía
  // «Estímulo de peaje 50% … $250.00» sobre una caseta de $500.00, pidiéndole
  // confirmar la condición que ya había negado.
  //
  // La LIF 2026 art. 20-A fr. I concede el estímulo por el uso de la Red
  // Nacional de Autopistas de Cuota. Likida no VERIFICA que lo sean —la propia
  // pregunta lo dice— pero una declaración negativa del cliente no es falta de
  // dato: es un hecho que cierra. Falta de declaración (`undefined`) se sigue
  // tratando como antes, porque ahí sí no hay nada que leer.
  // ═════════════════════════════════════════════════════════════════════════
  it('FIS-34-1: un «no» declarado a la Red Nacional cierra el estímulo, aunque lo demás califique', () => {
    expect(calificaEstimuloPeaje({
      ...declarado(50_000_000, false),
      casetasRedNacional: { valor: false, procedencia: 'declarado' },
    })).toEqual({ elegible: false });
  });

  it('FIS-34-1: un «no» a la Red Nacional cierra incluso sin las otras dos declaraciones', () => {
    // Es lo contrario de adivinar: no se afirma elegibilidad, se niega con el
    // único hecho declarado que hay, que basta para negar.
    expect(calificaEstimuloPeaje({
      casetasRedNacional: { valor: false, procedencia: 'declarado' },
    })).toEqual({ elegible: false });
  });

  it('FIS-34-1: un «sí» a la Red Nacional no cambia nada (no es el candado que falta)', () => {
    expect(calificaEstimuloPeaje({
      ...declarado(50_000_000, false),
      casetasRedNacional: { valor: true, procedencia: 'declarado' },
    })).toEqual({ elegible: true });
  });

  it('FIS-34-1: EL CANDADO también aquí — un «no» inferido NO cierra, solo el declarado', () => {
    expect(calificaEstimuloPeaje({
      ...declarado(50_000_000, false),
      casetasRedNacional: { valor: false, procedencia: 'inferido' },
    })).toEqual({ elegible: true });
  });

  it('FIS-34-1: sin declarar la Red Nacional, la conducta es la de siempre', () => {
    expect(calificaEstimuloPeaje(declarado(50_000_000, false))).toEqual({ elegible: true });
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

  it('procedencia "default" (relleno de Likida) NUNCA decide — es el bug de getConfig()', () => {
    const perfil = {
      ingresosAnualesMxn: { valor: 1, procedencia: 'default' },
      parteRelacionada: { valor: false, procedencia: 'default' },
    };
    expect(calificaEstimuloPeaje(perfil)).toEqual({ elegible: null });
  });

  it('umbral binario declarado (la pregunta del plan, sin inventar un monto) → decide', () => {
    expect(calificaEstimuloPeaje(declararUmbralPeaje(true, false))).toEqual({ elegible: true });
    expect(calificaEstimuloPeaje(declararUmbralPeaje(false, false))).toEqual({ elegible: false });
    expect(calificaEstimuloPeaje(declararUmbralPeaje(true, true))).toEqual({ elegible: false });
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

  it('umbral binario declarado → ya no hay pregunta', () => {
    expect(preguntaPendienteEstimuloPeaje(declararUmbralPeaje(true, false))).toBeNull();
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

describe('umbralPeajeDeclarado', () => {
  it('vacío → null/null, no se afirma', () => {
    expect(umbralPeajeDeclarado({})).toEqual({ ingresosMenoresA300M: null, parteRelacionada: null });
  });

  it('un default no se enseña como respuesta del cliente', () => {
    expect(umbralPeajeDeclarado({
      ingresosMenoresA300M: { valor: true, procedencia: 'default' },
      parteRelacionada: { valor: false, procedencia: 'default' },
    })).toEqual({ ingresosMenoresA300M: null, parteRelacionada: null });
  });
});

describe('declararUmbralPeaje', () => {
  it('arma el patch binario con procedencia "declarado", sin un peso inventado', () => {
    const patch = declararUmbralPeaje(true, false);
    expect(patch).toEqual({
      ingresosMenoresA300M: { valor: true, procedencia: 'declarado' },
      parteRelacionada: { valor: false, procedencia: 'declarado' },
    });
    expect(patch).not.toHaveProperty('ingresosAnualesMxn');
  });
});

describe('onboardingPospuesto (W2): «lo confirmo con mi contador» NO es declarar', () => {
  it('lee la fecha que dejó la decisión; cualquier otra cosa no cuenta', async () => {
    const { onboardingPospuesto, onboardingFiscalListo, LLAVE_ONBOARDING_POSPUESTO } = await import('./preguntas');
    expect(onboardingPospuesto({ [LLAVE_ONBOARDING_POSPUESTO]: '2026-10-01T18:00:00.000Z' })).toBe(true);
    for (const v of [{}, null, undefined, 'x', { [LLAVE_ONBOARDING_POSPUESTO]: 'no es fecha' }, { [LLAVE_ONBOARDING_POSPUESTO]: true }, { [LLAVE_ONBOARDING_POSPUESTO]: 123 }]) {
      expect(onboardingPospuesto(v as never)).toBe(false);
    }
    // Y posponer NO vuelve «listo» el perfil: el motor sigue fail-closed (estímulo en $0).
    expect(onboardingFiscalListo({ [LLAVE_ONBOARDING_POSPUESTO]: '2026-10-01T18:00:00.000Z' })).toBe(false);
  });
});
