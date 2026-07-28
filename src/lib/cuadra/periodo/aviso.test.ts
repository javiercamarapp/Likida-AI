import { describe, it, expect } from 'vitest';
import { avisoTope15 } from './aviso';
import { evaluarTope15 } from './combustible';

// El aviso es lo único de este contador que el contralor va a leer. Si dice el
// porcentaje pero no qué hacer, no sirve; si sale siempre, deja de leerse.
const ev = (efectivo: number, total: number) => evaluarTope15({ efectivo, totalCombustible: total });

describe('avisoTope15', () => {
  it('en holgado NO dice nada', () => {
    // Un aviso que sale siempre deja de leerse, y con él los que importan.
    expect(avisoTope15(ev(3_000, 100_000), 2026)).toBeNull();
  });

  it('cerca del tope, lo PRIMERO es cuánto margen queda', () => {
    const a = avisoTope15(ev(13_000, 100_000), 2026)!;
    expect(a).toMatch(/te quedan \$2,000\.00/);
    expect(a).toMatch(/tarjeta o transferencia/);   // qué hacer
  });

  it('excedido, dice el excedente y de quién es la decisión', () => {
    const a = avisoTope15(ev(20_000, 100_000), 2026)!;
    expect(a).toMatch(/\$5,000\.00/);
    // No se señala un ticket concreto: cuál pago "es" el excedente no lo
    // resuelve ninguna fuente, y adivinarlo sería culpar a alguien sin base.
    expect(a).toMatch(/lo decide tu contador/i);
  });

  it('siempre cita la norma con su regla, no "la ley" a secas', () => {
    for (const r of [ev(13_000, 100_000), ev(20_000, 100_000)]) {
      expect(avisoTope15(r, 2026)).toMatch(/RFA 2026 regla 2\.9/);
    }
  });

  it('sin criterio lo dice, no inventa un veredicto', () => {
    const a = avisoTope15(ev(5_000, 0), 2026)!;
    expect(a).toMatch(/no se evaluó|no se pudo/i);
  });

  it('lleva el año: un acumulado sin ejercicio no significa nada', () => {
    expect(avisoTope15(ev(13_000, 100_000), 2026)).toContain('2026');
  });
});
