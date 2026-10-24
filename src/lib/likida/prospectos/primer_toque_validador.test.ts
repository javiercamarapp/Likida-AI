import { describe, expect, it } from 'vitest';
import { violacionesPrimerToque } from './primer_toque_validador';

const OK = {
  mensaje_wa: 'Hola, vi que buscan auxiliar de liquidación. Son $35 por viaje, tabulador $38 / $35 / $31.25. ¿15 minutos?',
  correo_asunto: 'Su vacante de liquidación',
  correo_cuerpo: 'Hoy el ciclo manual cuesta ~$105 por viaje. Estamos eligiendo a las primeras flotas. El diésel elegible se cuenta en litros.',
};

describe('A37-S08-02: validador determinista del primer toque', () => {
  it('un texto con solo cifras canónicas y diésel en litros pasa', () => {
    expect(violacionesPrimerToque(OK)).toEqual([]);
  });
  it('rechaza una cifra no canónica', () => {
    expect(violacionesPrimerToque({ ...OK, mensaje_wa: 'Solo $12 por viaje, ahorra $4,500 al mes.' }).join()).toMatch(/cifra no canónica/);
  });
  it('rechaza pesos junto a diésel o estímulo, aunque el monto sea canónico', () => {
    expect(violacionesPrimerToque({ ...OK, correo_cuerpo: 'El estímulo del diésel te devuelve $35 por viaje.' }).join()).toMatch(/diésel\/estímulo en pesos/);
    expect(violacionesPrimerToque({ ...OK, correo_cuerpo: 'Recupera el estimulo de diesel: 200 pesos.' }).join()).toMatch(/diésel/);
  });
  it('rechaza «nuestros clientes»', () => {
    expect(violacionesPrimerToque({ ...OK, correo_cuerpo: 'Nuestros clientes ya liquidan en minutos.' }).join()).toMatch(/clientes/);
  });
  it('pesos en una frase y diésel en otra NO es violación', () => {
    expect(violacionesPrimerToque({ ...OK, correo_cuerpo: 'Son $35 por viaje. El diésel se habla en litros.' })).toEqual([]);
  });
});
