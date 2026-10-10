import { describe, it, expect } from 'vitest';
import { evaluarFrecuencia, validarLimite, LIMITE_POR_OMISION } from './frecuencia';

const AHORA = new Date('2026-10-02T15:00:00Z');
const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000);

describe('evaluarFrecuencia — el tope diario y la separación mínima', () => {
  it('sin avisos previos siempre permite', () => {
    expect(evaluarFrecuencia([], AHORA, { maxAvisosDia: 1, minHorasEntreAvisos: 24 })).toEqual({ permitido: true });
  });

  it('el tope diario bloquea al llegar a N avisos en 24 h y dice cuándo se libera', () => {
    const v = evaluarFrecuencia([hace(20), hace(10), hace(5)], AHORA, { maxAvisosDia: 3, minHorasEntreAvisos: 0 });
    expect(v.permitido).toBe(false);
    if (!v.permitido) {
      expect(v.motivo).toBe('tope_diario');
      // Se libera cuando el más viejo de la ventana cumple 24 h: hace(20) + 24 h = en 4 h.
      expect(v.proximoEn.getTime()).toBe(hace(20).getTime() + 24 * 3_600_000);
    }
  });

  it('un aviso de hace más de 24 h ya no cuenta para el tope', () => {
    expect(evaluarFrecuencia([hace(30), hace(25), hace(2)], AHORA, { maxAvisosDia: 2, minHorasEntreAvisos: 0 }))
      .toEqual({ permitido: true });
  });

  it('la separación mínima bloquea hasta cumplir las horas desde el último aviso', () => {
    const v = evaluarFrecuencia([hace(1)], AHORA, { maxAvisosDia: 10, minHorasEntreAvisos: 3 });
    expect(v.permitido).toBe(false);
    if (!v.permitido) {
      expect(v.motivo).toBe('separacion_minima');
      expect(v.proximoEn.getTime()).toBe(hace(1).getTime() + 3 * 3_600_000);
    }
    expect(evaluarFrecuencia([hace(3)], AHORA, { maxAvisosDia: 10, minHorasEntreAvisos: 3 })).toEqual({ permitido: true });
  });

  it('separación 0 = solo manda el tope diario', () => {
    expect(evaluarFrecuencia([hace(0.01)], AHORA, { maxAvisosDia: 5, minHorasEntreAvisos: 0 })).toEqual({ permitido: true });
  });

  it('un aviso con fecha en el futuro (reloj desfasado) se ignora y no bloquea para siempre', () => {
    const futuro = new Date(AHORA.getTime() + 5 * 86_400_000);
    expect(evaluarFrecuencia([futuro], AHORA, { maxAvisosDia: 1, minHorasEntreAvisos: 48 })).toEqual({ permitido: true });
  });

  it('el límite por omisión permite un aviso por hora y a lo más cuatro al día', () => {
    expect(LIMITE_POR_OMISION).toEqual({ maxAvisosDia: 4, minHorasEntreAvisos: 1 });
    expect(evaluarFrecuencia([hace(2)], AHORA, LIMITE_POR_OMISION)).toEqual({ permitido: true });
    expect(evaluarFrecuencia([hace(0.5)], AHORA, LIMITE_POR_OMISION).permitido).toBe(false);
  });
});

describe('validarLimite', () => {
  it('acepta enteros dentro de rango', () => {
    expect(validarLimite({ maxAvisosDia: '3', minHorasEntreAvisos: '6' })).toEqual({
      ok: true, limite: { maxAvisosDia: 3, minHorasEntreAvisos: 6 },
    });
  });
  it.each([
    [{ maxAvisosDia: 0, minHorasEntreAvisos: 1 }],
    [{ maxAvisosDia: 25, minHorasEntreAvisos: 1 }],
    [{ maxAvisosDia: 1.5, minHorasEntreAvisos: 1 }],
    [{ maxAvisosDia: 'x', minHorasEntreAvisos: 1 }],
    [{ maxAvisosDia: 2, minHorasEntreAvisos: -1 }],
    [{ maxAvisosDia: 2, minHorasEntreAvisos: 169 }],
  ])('rechaza %j con un mensaje de pantalla', (c) => {
    const r = validarLimite(c);
    expect(r.ok).toBe(false);
  });
});
