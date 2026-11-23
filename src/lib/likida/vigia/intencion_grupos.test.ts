import { describe, it, expect } from 'vitest';
import { clasificarPorReglas } from './intencion';
import { CONFIANZA_MINIMA_AUTOENVIO } from './politica';

// Textos sintéticos con el habla de los grupos (medido: 84-92 % de las peticiones no las reconocía ninguna regla).
describe('intención por reglas — habla telegráfica de los grupos', () => {
  it('«datos de las unidades / cajitas» (plural y diminutivo) son datos de la unidad', () => {
    for (const t of ['nos apoyan con los datos de las unidades de hoy', 'datos de las cajitas de mañana por favor', 'me pasan datos de los remolques', 'información de las cajas que salen']) {
      expect(clasificarPorReglas(t)?.intencion, t).toBe('datos_unidad');
      expect(clasificarPorReglas(t)?.confianza, t).toBeGreaterThanOrEqual(CONFIANZA_MINIMA_AUTOENVIO);
    }
  });

  it('«¿tenemos datos?» sin sustantivo se reconoce, pero con confianza BAJO el mínimo de autoenvío', () => {
    for (const t of ['tenemos datos?', 'nos ayudan con los datos', 'faltan datos', 'me comparten los datos por favor']) {
      const c = clasificarPorReglas(t);
      expect(c?.intencion, t).toBe('datos_unidad');
      expect(c?.confianza, t).toBeLessThan(CONFIANZA_MINIMA_AUTOENVIO);
    }
  });

  it('«¿cómo vamos?» es ubicación, siempre con confianza baja (nunca sale solo)', () => {
    for (const t of ['como vamos con las cargas?', 'Team, cómo van?', 'como andamos con la caja']) {
      const c = clasificarPorReglas(t);
      expect(c?.intencion, t).toBe('ubicacion');
      expect(c?.confianza, t).toBeLessThan(CONFIANZA_MINIMA_AUTOENVIO);
    }
  });

  it('no le quita el lugar a lo que ya se reconocía (queja, ETA, dato explícito)', () => {
    expect(clasificarPorReglas('pésimo servicio, como vamos?')?.intencion).toBe('queja');
    expect(clasificarPorReglas('a que hora llega, como vamos?')?.intencion).toBe('eta');
    expect(clasificarPorReglas('que caja trae la unidad? y como vamos')?.intencion).toBe('datos_unidad');
    expect(clasificarPorReglas('datos de la unidad')?.confianza).toBeGreaterThanOrEqual(CONFIANZA_MINIMA_AUTOENVIO);
  });

  it('lo que no pide nada sigue sin regla', () => {
    for (const t of ['programa de mañana', 'la caja quedó en el patio', 'hora de salida de la caja']) expect(clasificarPorReglas(t), t).toBeNull();
  });
});
