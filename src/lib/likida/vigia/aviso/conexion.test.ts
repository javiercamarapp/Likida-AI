import { describe, it, expect } from 'vitest';
import { AVISO_AUTOMATICO_CONECTADO } from './conexion';
import { crearDepsVigia } from '../deps';

// CT-A345-03: la bandera de las pantallas debe decir lo mismo que el cableado real.
describe('el aviso automático de viaje: la bandera dice lo que el cableado hace', () => {
  it('crearDepsVigia() sin puerto real deja avisos en null: la pasada de avisos no corre y la bandera es false', () => {
    const sinPuerto = crearDepsVigia().avisos == null;
    expect(AVISO_AUTOMATICO_CONECTADO).toBe(!sinPuerto);
  });
});
