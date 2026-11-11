import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { haceTiempo, resultadoCorrida } from './corrida-visual';

const AHORA = Date.parse('2026-11-11T12:00:00Z');

describe('Última corrida del catálogo de agentes', () => {
  it('una corrida terminada «ok» NO lleva tono: texto llano, nunca un chip rojo por ser vieja', () => {
    expect(resultadoCorrida('ok')).toEqual({ texto: 'Terminó bien', tono: null });
  });
  it('rojo solo si de verdad falló, ámbar si fue parcial, y siempre con texto', () => {
    expect(resultadoCorrida('fallo')).toEqual({ texto: 'Terminó con fallo', tono: 'bad' });
    expect(resultadoCorrida('parcial')).toEqual({ texto: 'Terminó parcial', tono: 'warn' });
    expect(resultadoCorrida('otro').tono).toBe('neutral');
  });
  it('la antigüedad se dice en palabras desde el instante real', () => {
    expect(haceTiempo('2026-11-11T11:30:00Z', AHORA)).toBe('hace menos de 1 h');
    expect(haceTiempo('2026-11-11T07:00:00Z', AHORA)).toBe('hace 5 h');
    expect(haceTiempo('2026-09-02T10:00:00Z', AHORA)).toBe('hace 70 días');
  });
  it('la pantalla ya no pinta la fecha con un chip de tono por antigüedad ni «Insumos» como botón', () => {
    const src = readFileSync(new URL('./contenido.tsx', import.meta.url), 'utf8');
    expect(src).not.toContain('tonoPorAntiguedad');
    expect(src).not.toContain('BotonEnlace');
    expect(src).toContain('rv-agente-enlace');
  });
});
