import { describe, it, expect } from 'vitest';
import { MARCADOR_DECISOR, nombreDePila, notasSinPersona, lineaDecisor, reponerDecisor } from './seudonimo';

// AUDITORÍA 18 (C2): el nombre del decisor de un prospecto no viaja al modelo.
describe('nombreDePila', () => {
  it('quita el título y se queda con el primer nombre', () => {
    expect(nombreDePila('Ing. Ramón Treviño')).toBe('Ramón');
    expect(nombreDePila('C.P. María de la Luz Garza')).toBe('María');
    expect(nombreDePila('  Lic Juan Pérez ')).toBe('Juan');
    expect(nombreDePila('Ing.')).toBe('');
  });
});

describe('lineaDecisor', () => {
  it('nunca lleva el nombre; lleva el marcador', () => {
    const l = lineaDecisor('Ing. Ramón Treviño');
    expect(l).not.toContain('Ramón');
    expect(l).not.toContain('Treviño');
    expect(l).toContain(MARCADOR_DECISOR);
  });
  it('sin contacto, pide que no se invente ninguno', () => {
    expect(lineaDecisor(null)).toMatch(/no identificado/);
  });
});

describe('notasSinPersona', () => {
  it('quita correos, teléfonos y el nombre del contacto (completo y de pila)', () => {
    const n = 'Hablé con Ramón Treviño (ramon.trevino@fletes.mx, 81 1234 5678). Ramón dice que liquidan a mano.';
    const r = notasSinPersona(n, 'Ing. Ramón Treviño')!;
    expect(r).not.toContain('ramon.trevino@');
    expect(r).not.toContain('1234 5678');
    expect(r).not.toContain('Ramón');
    expect(r).not.toContain('Treviño');
    expect(r).toContain(MARCADOR_DECISOR);
    expect(r).toContain('liquidan a mano');
  });
  it('respeta palabras que contienen el nombre (Ramona no es Ramón) y cifras cortas', () => {
    const r = notasSinPersona('Flota de 45 unidades; contacto en Ramona, NL.', 'Ramón Treviño')!;
    expect(r).toContain('45 unidades');
    expect(r).toContain('Ramona');
  });
  it('null sigue siendo null', () => {
    expect(notasSinPersona(null, 'X')).toBeNull();
  });
});

describe('reponerDecisor', () => {
  it('sustituye el marcador por el nombre de pila', () => {
    expect(reponerDecisor(`Hola ${MARCADOR_DECISOR}, vi que buscan…`, 'Ing. Ramón Treviño')).toBe('Hola Ramón, vi que buscan…');
  });
  it('sin contacto, quita el marcador y el hueco', () => {
    expect(reponerDecisor(`Hola ${MARCADOR_DECISOR}, vi que buscan`, null)).toBe('Hola, vi que buscan');
    expect(reponerDecisor(`${MARCADOR_DECISOR}, buen día`, null)).toBe('buen día');
  });
});
