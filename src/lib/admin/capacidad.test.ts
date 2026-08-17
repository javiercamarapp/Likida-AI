import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

const { escenarioDe, SUPUESTOS_CAPACIDAD } = await import('./capacidad');

describe('escenarioDe — escala con supuestos declarados', () => {
  it('1,000 viajes/día: aritmética exacta de los supuestos', () => {
    const e = escenarioDe(1000, 0.05);
    expect(e.mensajesDia).toBe(1000 * SUPUESTOS_CAPACIDAD.mensajesPorViaje);
    expect(e.mensajesMinPico).toBe(Math.ceil(e.mensajesDia / (8 * 60)));
    expect(e.costoIaDiaUsd).toBeCloseTo(50);
    expect(e.storageDiaMb).toBe(Math.round((1000 * 10 * 350_000) / 1_048_576));
  });
  it('sin costo medido: el costo del escenario es null, jamás un cero', () => {
    expect(escenarioDe(10_000, null).costoIaDiaUsd).toBeNull();
  });
});
