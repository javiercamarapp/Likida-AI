import { describe, expect, it } from 'vitest';
import { limitesRampa, pasoDeRampa, PASOS_RAMPA } from './prospectos-mapa-client';

// w15/perf (punto 15) — la rampa secuencial del mapa de color. Lo que se fija: la leyenda enseña los MISMOS cortes con los que se pinta
// (un rótulo de leyenda tiene que ser verdad) y un estado con prospectos nunca queda "sin dato".
describe('rampa secuencial del choropleth', () => {
  it('sin prospectos = paso 0; con uno solo = al menos el paso 1 (nunca "sin dato")', () => {
    expect(pasoDeRampa(0, 100)).toBe(0);
    expect(pasoDeRampa(1, 100)).toBe(1);
    expect(pasoDeRampa(1, 1)).toBe(PASOS_RAMPA);
    expect(pasoDeRampa(5, 0)).toBe(0);
  });

  it('el máximo cae siempre en el paso más oscuro', () => {
    for (const max of [1, 7, 100, 8_123, 33_148]) expect(pasoDeRampa(max, max)).toBe(PASOS_RAMPA);
  });

  it('cada cifra cae en el paso cuyo rango de la leyenda la contiene (pintura y leyenda no se desfasan en el redondeo)', () => {
    for (const max of [3, 25, 100, 1_000, 33_148]) {
      const limites = limitesRampa(max);
      for (let n = 1; n <= Math.min(max, 2_000); n++) {
        const paso = pasoDeRampa(n, max);
        const l = limites.find((x) => x.paso === paso);
        expect(l, `max ${max} n ${n}`).toBeDefined();
        expect(n >= l!.desde && n <= l!.hasta, `max ${max} n ${n} paso ${paso}`).toBe(true);
      }
    }
  });

  it('los rangos de la leyenda no se traslapan, son crecientes y cubren de 1 a max', () => {
    const l = limitesRampa(33_148);
    expect(l[0].desde).toBe(1);
    expect(l[l.length - 1].hasta).toBe(33_148);
    for (let i = 1; i < l.length; i++) expect(l[i].desde).toBe(l[i - 1].hasta + 1);
  });

  it('es una escala de raíz cuadrada: con un estado enorme los demás NO se aplastan todos en el paso 1', () => {
    // 1,500 de un máximo de 10,000: en una escala lineal (15 %) caería en el paso 1, igual que los estados con 50; en raíz cuadrada (39 %) sube al 2.
    expect(pasoDeRampa(1_500, 10_000)).toBe(2);
    expect(pasoDeRampa(50, 10_000)).toBe(1);
    expect(pasoDeRampa(1_500, 10_000)).toBeLessThan(PASOS_RAMPA);
  });
});
