import { describe, it, expect } from 'vitest';
import { prepararMensajes } from './mensajes';
import { barajar, cli, eq, msg, prng, CLIENTE_B, OPERADOR_1 } from './fixtures';

describe('prepararMensajes', () => {
  it('descarta fechas ilegibles y las cuenta', () => {
    const r = prepararMensajes([cli(0, 'hola'), { ...cli(1, 'x'), enviadoEn: 'no-es-fecha' }, { ...cli(2, 'y'), enviadoEn: '' }], []);
    expect(r.mensajes).toHaveLength(1);
    expect(r.descartados).toBe(2);
  });

  it('deduplica exportaciones solapadas por (fecha, autor, texto)', () => {
    const a = [cli(0, 'hola'), eq(5, 'buenas'), cli(10, 'dónde está?')];
    const b = [eq(5, 'buenas'), cli(10, 'dónde está?'), cli(20, 'sigo esperando')];
    const r = prepararMensajes([...a, ...b], []);
    expect(r.mensajes.map((m) => m.texto)).toEqual(['hola', 'buenas', 'dónde está?', 'sigo esperando']);
    expect(r.descartados).toBe(2);
  });

  it('misma entrada en cualquier orden da la misma salida', () => {
    const base = [cli(0, 'a'), cli(0, 'b'), eq(0, 'c'), cli(3, 'd'), eq(3, 'e'), msg(3, 'cliente', 'd', CLIENTE_B)];
    const esperado = prepararMensajes(base, []);
    for (let s = 1; s <= 20; s += 1) expect(prepararMensajes(barajar(base, prng(s)), [])).toEqual(esperado);
  });

  it('equipoHashes reclasifica sin resubir', () => {
    const r = prepararMensajes([msg(0, 'cliente', 'te contesto', OPERADOR_1.toUpperCase())], [OPERADOR_1]);
    expect(r.mensajes[0].rol).toBe('equipo');
  });

  it('el mismo mensaje como cliente y como equipo queda como equipo en cualquier orden', () => {
    const c = msg(0, 'cliente', 'listo', OPERADOR_1);
    const e = msg(0, 'equipo', 'listo', OPERADOR_1);
    expect(prepararMensajes([c, e], []).mensajes[0].rol).toBe('equipo');
    expect(prepararMensajes([e, c], []).mensajes[0].rol).toBe('equipo');
  });

  it('limpia caracteres de control y acota cadenas enormes', () => {
    const r = prepararMensajes([cli(0, `hola\u0000​${'x'.repeat(50_000)}`)], []);
    expect(r.mensajes[0].texto).not.toMatch(/[\u0000​]/);
    expect(r.mensajes[0].texto.length).toBeLessThanOrEqual(1000);
  });

  it('lista vacía y entrada sin autorHash no lanzan', () => {
    expect(prepararMensajes([], [])).toEqual({ mensajes: [], descartados: 0 });
    expect(prepararMensajes([{ ...cli(0, 'x'), autorHash: undefined as unknown as string }], []).descartados).toBe(1);
  });
});
