import { describe, expect, it } from 'vitest';
import { colocarGlobo, mezclarRect, rectFoco, suavizado, trazoVelo } from './geometria';
import { validarRecorrido, anclaTour } from './validar';

const VP = { w: 1280, h: 800 };
const GLOBO = { w: 340, h: 200 };

describe('colocarGlobo', () => {
  it('prefiere abajo y centra la flecha en el objetivo', () => {
    const c = colocarGlobo({ x: 500, y: 100, w: 100, h: 32 }, GLOBO, VP);
    expect(c.lado).toBe('abajo');
    expect(c.y).toBe(100 + 32 + 14);
    expect(c.flecha).toBe(Math.round(500 + 50 - c.x));
  });
  it('sube si abajo no cabe, y respeta el lado pedido cuando cabe', () => {
    expect(colocarGlobo({ x: 500, y: 700, w: 100, h: 32 }, GLOBO, VP).lado).toBe('arriba');
    expect(colocarGlobo({ x: 400, y: 300, w: 100, h: 32 }, GLOBO, VP, 'derecha').lado).toBe('derecha');
  });
  it('nunca se sale del viewport (borde derecho) y la flecha queda dentro del globo', () => {
    const c = colocarGlobo({ x: 1240, y: 100, w: 30, h: 30 }, GLOBO, VP);
    expect(c.x + GLOBO.w).toBeLessThanOrEqual(VP.w - 12);
    expect(c.flecha!).toBeGreaterThanOrEqual(18);
    expect(c.flecha!).toBeLessThanOrEqual(GLOBO.w - 18);
  });
  it('sin objetivo: centrado; móvil: hoja inferior sin flecha', () => {
    const c = colocarGlobo(null, GLOBO, VP);
    expect(c).toMatchObject({ lado: 'centro', x: 470, y: 300, flecha: null });
    const m = colocarGlobo({ x: 10, y: 10, w: 50, h: 20 }, { w: 360, h: 220 }, { w: 390, h: 800 });
    expect(m).toMatchObject({ lado: 'hoja', x: 0, y: 580, flecha: null });
  });
});

describe('velo y foco', () => {
  it('rectFoco da respiro y se recorta al viewport', () => {
    expect(rectFoco({ x: 2, y: 2, w: 10, h: 10 }, VP, 6)).toEqual({ x: 0, y: 0, w: 18, h: 18 });
  });
  it('trazoVelo: con hueco lleva dos subtrazos (evenodd); sin hueco solo el velo', () => {
    expect((trazoVelo(VP, { x: 10, y: 10, w: 100, h: 40 }).match(/M/g) ?? []).length).toBe(2);
    expect(trazoVelo(VP, null)).toBe('M0 0H1280V800H0Z');
    expect(trazoVelo(VP, { x: 0, y: 0, w: 0, h: 0 })).toBe('M0 0H1280V800H0Z');
  });
  it('suavizado: monótono, 0→1, sin sobreimpulso', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = suavizado(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(suavizado(0)).toBe(0);
    expect(suavizado(1)).toBe(1);
    expect(mezclarRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 }, 1).x).toBe(100);
  });
});

describe('validarRecorrido / anclaTour', () => {
  const base = { id: 'r', version: 1, titulo: 't', pasos: [{ id: 'a', ancla: 'x.y-z', titulo: 'Uno', texto: 'Texto.' }] };
  it('un recorrido sano no da problemas', () => {
    expect(validarRecorrido(base)).toEqual([]);
  });
  it('detecta ids repetidos, anclas frágiles, textos largos y acción sin frase', () => {
    const malo = {
      ...base,
      pasos: [
        { id: 'a', ancla: 'div > .btn', titulo: 'x'.repeat(60), texto: 'y'.repeat(200) },
        { id: 'a', titulo: 'Dos', texto: 'ok', avance: { tipo: 'accion' as const, evento: 'click' as const } },
      ],
    };
    const p = validarRecorrido(malo).join('|');
    expect(p).toContain('no es un nombre estable');
    expect(p).toContain('título de 60');
    expect(p).toContain('texto de 200');
    expect(p).toContain('id repetido');
    expect(p).toContain('sin elemento');
    expect(p).toContain('sin la frase');
  });
  it('anclaTour produce el atributo estable', () => {
    expect(anclaTour('conexiones.subir')).toEqual({ 'data-tour': 'conexiones.subir' });
  });
});
