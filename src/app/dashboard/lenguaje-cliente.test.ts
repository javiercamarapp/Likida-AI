import { describe, expect, it } from 'vitest';
import { contieneIdentificadorInterno, fuenteLegible } from './lenguaje-cliente';

describe('fuenteLegible', () => {
  it('traduce las fuentes técnicas conocidas', () => {
    expect(fuenteLegible('viaje_hito.fuente (sistema, botón, texto, ubicación)')).toMatch(/^registro de cada hito/);
    expect(fuenteLegible('agente_conductor_config.linea_base_llamadas_por_viaje')).toContain('línea base');
  });
  it('lo desconocido con identificador cae a una frase genérica, nunca al crudo', () => {
    expect(fuenteLegible('tabla_nueva.columna_x')).toBe('registros de la operación');
  });
  it('una frase normal pasa intacta', () => {
    expect(fuenteLegible('validación de ubicación de cada hito')).toBe('validación de ubicación de cada hito');
  });
  it('detecta identificadores snake_case', () => {
    expect(contieneIdentificadorInterno('usa viaje_hito.fuente')).toBe(true);
    expect(contieneIdentificadorInterno('Hola mundo')).toBe(false);
  });
});
