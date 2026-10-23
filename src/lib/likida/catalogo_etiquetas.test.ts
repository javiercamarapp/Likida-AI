import { describe, it, expect } from 'vitest';
import { coincidencias, desambiguarEtiquetas, pistaTelefono } from './catalogo_etiquetas';

// R15-ux-01: el combo mandaba el id de la PRIMERA coincidencia por nombre. Aquí
// se fija la regla que lo impide: con más de una coincidencia exacta NO se
// resuelve (el combo deja el id vacío y el servidor rechaza «Elige un operador»).
describe('coincidencias (lo que el combo usa para fijar el id)', () => {
  const ops = [{ id: 'o-1', etiqueta: 'José Hernández' }, { id: 'o-2', etiqueta: 'jose hernández' }, { id: 'o-3', etiqueta: 'Ana' }];

  it('un nombre repetido devuelve DOS coincidencias: no hay id que adivinar', () => {
    expect(coincidencias(ops, ' JOSÉ HERNÁNDEZ ').map((o) => o.id)).toEqual(['o-1']);
    const homonimos = [{ id: 'a', etiqueta: 'Luis' }, { id: 'b', etiqueta: 'Luis' }];
    expect(coincidencias(homonimos, 'luis')).toHaveLength(2);
  });

  it('lo vacío no coincide con nada y lo desambiguado sí resuelve a uno solo', () => {
    expect(coincidencias(ops, '   ')).toEqual([]);
    const unicas = desambiguarEtiquetas([
      { id: 'a', etiqueta: 'Luis', pista: pistaTelefono('+52 999 111 4821') },
      { id: 'b', etiqueta: 'Luis', pista: pistaTelefono('+52 999 222 0077') },
    ]);
    expect(coincidencias(unicas, 'Luis · tel. ···0077').map((o) => o.id)).toEqual(['b']);
    expect(coincidencias(unicas, 'Luis')).toEqual([]);
  });
});

describe('pistaTelefono', () => {
  it('solo los últimos 4 dígitos; sin teléfono usable no hay pista', () => {
    expect(pistaTelefono('+52 (999) 111-4821')).toBe('tel. ···4821');
    expect(pistaTelefono('12')).toBeNull();
    expect(pistaTelefono(null)).toBeNull();
  });
});
