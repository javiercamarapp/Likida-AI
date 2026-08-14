import { describe, it, expect } from 'vitest';
import { validarDeclaracion } from './carta_porte_datos';
import { DatoInvalido } from './errores';

// Solo lo puro: la validación de la declaración. El lector y el escritor
// tocan Supabase y no se prueban contra un mock (probaría el mock).

describe('validarDeclaracion', () => {
  it('vacío es "sin declarar", jamás un "no"', () => {
    const d = validarDeclaracion({ pisaFederal: '', radioKm: '' });
    expect(d.pisaFederal).toBeNull();
    expect(d.radioKm).toBeNull();
  });

  it('sí y no se leen como booleanos; otra cosa se rechaza', () => {
    expect(validarDeclaracion({ pisaFederal: 'si', radioKm: '' }).pisaFederal).toBe(true);
    expect(validarDeclaracion({ pisaFederal: 'no', radioKm: '' }).pisaFederal).toBe(false);
    expect(() => validarDeclaracion({ pisaFederal: 'quizas', radioKm: '' })).toThrow(DatoInvalido);
  });

  it('el radio vacío es "no medido", no 0 km', () => {
    expect(validarDeclaracion({ pisaFederal: 'si', radioKm: '' }).radioKm).toBeNull();
  });

  it('el radio acepta coma decimal y se redondea a décimas', () => {
    expect(validarDeclaracion({ pisaFederal: 'si', radioKm: '28,75' }).radioKm).toBe(28.8);
  });

  it('un radio negativo o gigante se rechaza recordando que es RADIO, no odómetro', () => {
    expect(() => validarDeclaracion({ pisaFederal: 'si', radioKm: '-3' })).toThrow(DatoInvalido);
    expect(() => validarDeclaracion({ pisaFederal: 'si', radioKm: '9000' })).toThrow(/RADIO/);
  });

  it('la contradicción "no pisa federal" + radio medido se rechaza, no se guarda ambigua', () => {
    expect(() => validarDeclaracion({ pisaFederal: 'no', radioKm: '20' })).toThrow(DatoInvalido);
  });
});
