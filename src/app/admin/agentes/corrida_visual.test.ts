/* eslint-disable security/detect-non-literal-fs-filename -- lee un archivo fuente del propio repo */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { agentes as es } from '@/lib/i18n/es/agentes';
import { crearTraductor } from '@/lib/i18n/traducir';
import { haceTiempo, resultadoCorrida } from './corrida-visual';

const { t } = crearTraductor('es', es, es);
const AHORA = Date.parse('2026-11-11T12:00:00Z');

describe('Última corrida del catálogo de agentes', () => {
  it('una corrida terminada «ok» NO lleva tono: texto llano, nunca un chip rojo por ser vieja', () => {
    expect(resultadoCorrida('ok', t)).toEqual({ texto: 'Terminó bien', tono: null });
  });
  it('rojo solo si de verdad falló, ámbar si fue parcial, y siempre con texto', () => {
    expect(resultadoCorrida('fallo', t)).toEqual({ texto: 'Terminó con fallo', tono: 'bad' });
    expect(resultadoCorrida('parcial', t)).toEqual({ texto: 'Terminó parcial', tono: 'warn' });
    expect(resultadoCorrida('otro', t).tono).toBe('neutral');
  });
  it('la antigüedad se dice en palabras desde el instante real', () => {
    expect(haceTiempo('2026-11-11T11:30:00Z', AHORA, t)).toBe('hace menos de 1 h');
    expect(haceTiempo('2026-11-11T07:00:00Z', AHORA, t)).toBe('hace 5 h');
    expect(haceTiempo('2026-09-02T10:00:00Z', AHORA, t)).toBe('hace 70 días');
  });
  it('la pantalla ya no pinta la fecha con un chip de tono por antigüedad ni «Insumos» como botón', () => {
    const src = readFileSync(new URL('./contenido.tsx', import.meta.url), 'utf8');
    expect(src).not.toContain('tonoPorAntiguedad');
    expect(src).not.toContain('BotonEnlace');
    expect(src).toContain('rv-agente-enlace');
  });
});
