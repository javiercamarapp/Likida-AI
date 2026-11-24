import { describe, it, expect } from 'vitest';
import { esRespuestaVacia } from './respuesta_vacia';

describe('esRespuestaVacia · acuse sin dato', () => {
  it('«enterado», «reviso», «en un momento» y parecidos son vacíos', () => {
    for (const t of ['enterado', 'Enterado!', 'reviso', 'ok', 'ahorita reviso', 'en un momento', 'ya te confirmo', 'permítame un momento', 'Buen día, enterado', 'claro que sí', 'estamos revisando', 'dejame checar', 'de acuerdo gracias']) {
      expect(esRespuestaVacia(t), t).toBe(true);
    }
  });
  it('lo que trae el dato NO es vacío', () => {
    for (const t of ['sale a las 4 am', 'ya van en camino', 'la unidad es la 1234', 'https://ejemplo.test/rastreo', 'reviso y te confirmo la caja que sale hoy a patio de la planta norte', 'el sello es 12345', 'no hay personal hoy']) {
      expect(esRespuestaVacia(t), t).toBe(false);
    }
  });
  it('vacío o ilegible cuenta como vacío; nunca lanza', () => {
    expect(esRespuestaVacia('')).toBe(true);
    expect(esRespuestaVacia('   ')).toBe(true);
    expect(esRespuestaVacia(undefined as unknown as string)).toBe(true);
  });
});
