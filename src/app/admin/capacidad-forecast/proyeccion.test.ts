import { describe, expect, it } from 'vitest';
import { proyectarCosto } from './proyeccion';

describe('A37-S05-03: proyección sobre ventana real de 30 días', () => {
  it('tras un año, solo cuenta los últimos 30 días (el gasto actual manda)', () => {
    const historico = [{ dia: '2025-10-01' }, { dia: '2026-10-20' }];
    const enVentana = [{ dia: '2026-10-20', costoUsd: 30 }];
    const r = proyectarCosto(historico, enVentana, '2026-10-23')!;
    expect(r.diasVentana).toBe(30);
    expect(r.promedioDiario).toBeCloseTo(1, 10);
    expect(r.proyeccionMensual).toBeCloseTo(30, 10);
  });
  it('si la IA se detuvo hace semanas, la proyección es 0 con la ventana de 30 días (no un promedio histórico)', () => {
    const r = proyectarCosto([{ dia: '2026-01-01' }], [], '2026-10-23')!;
    expect(r.diasVentana).toBe(30);
    expect(r.proyeccionMensual).toBe(0);
  });
  it('días de menos de medio centavo se suman SIN redondear', () => {
    const enVentana = Array.from({ length: 30 }, (_, i) => ({
      dia: new Date(Date.UTC(2026, 9, 23 - i)).toISOString().slice(0, 10), costoUsd: 0.004,
    }));
    const r = proyectarCosto([{ dia: '2026-09-01' }], enVentana, '2026-10-23')!;
    expect(r.proyeccionMensual).toBeCloseTo(0.12, 10);
  });
  it('plataforma de 3 días: promedia entre los 3 días que existen, no entre 30', () => {
    const r = proyectarCosto([{ dia: '2026-10-21' }], [{ dia: '2026-10-21', costoUsd: 30 }, { dia: '2026-10-23', costoUsd: 30 }], '2026-10-23')!;
    expect(r.diasVentana).toBe(3);
    expect(r.promedioDiario).toBe(20);
    expect(r.proyeccionMensual).toBe(600);
  });
  it('sin historial no hay base', () => {
    expect(proyectarCosto([], [], '2026-10-23')).toBeNull();
  });
});
