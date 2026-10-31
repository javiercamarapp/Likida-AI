import { describe, expect, it } from 'vitest';
import { revisoresDeTexto, textoDeRevisores } from './primer_mes_texto';

describe('primer mes · texto de revisores', () => {
  it('ida y vuelta, ignorando renglones vacíos', () => {
    const r = revisoresDeTexto('Captura de Carta Porte: a@x.test\n\n  Operaciones : b@x.test ');
    expect(r).toEqual([{ departamento: 'Captura de Carta Porte', correo: 'a@x.test' }, { departamento: 'Operaciones', correo: 'b@x.test' }]);
    expect(textoDeRevisores(r)).toBe('Captura de Carta Porte: a@x.test\nOperaciones: b@x.test');
  });
  it('un renglón sin «Departamento: correo» se rechaza con una frase', () => {
    expect(() => revisoresDeTexto("sin dos puntos")).toThrow(/Departamento: correo/);
  });
});
