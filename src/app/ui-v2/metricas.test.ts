import { describe, expect, it } from 'vitest';
import { METRICAS, claseEfectiva, claseMasDebil, metrica, tokensDeMatiz, tokensDeMetrica, type Matiz } from './metricas';

describe('metricas de logística', () => {
  it('ids únicos y matiz 1..8', () => {
    const ids = METRICAS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of METRICAS) expect([1, 2, 3, 4, 5, 6, 7, 8]).toContain(m.matiz);
  });
  it('los 8 matices tienen al menos una métrica (la paleta se usa entera)', () => {
    const usados = new Set<Matiz>(METRICAS.map((m) => m.matiz));
    expect([...usados].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('el color es identidad de métrica: dinero = azul, gasto de ruta = naranja, requiere acción = burdeos', () => {
    expect(metrica('dinero_comprobado').matiz).toBe(1);
    expect(metrica('gasto_peajes').matiz).toBe(2);
    expect(metrica('cumplimiento_carta_porte').matiz).toBe(3);
    expect(metrica('diferencias_por_cuadrar').matiz).toBe(6);
    expect(metrica('volumen_viajes').matiz).toBe(8);
  });
  it('apunta a tokens (no a hexadecimales): el tema lo resuelve el CSS', () => {
    expect(tokensDeMatiz(2)).toEqual({ solido: 'var(--chart-2)', tinte: 'var(--soft-2)', tinta: 'var(--ink-2)' });
    expect(tokensDeMetrica('gasto_diesel').solido).toBe('var(--chart-2)');
  });
  it('sin dato nunca hereda la clase del registro', () => {
    expect(claseEfectiva('dinero_comprobado', null)).toBe('sin_dato');
    expect(claseEfectiva('dinero_comprobado', '')).toBe('sin_dato');
    expect(claseEfectiva('dinero_comprobado', 0)).toBe('observado'); // 0 con fuente es un dato
  });
  it('una cifra compuesta toma la clase más débil y nunca se promueve', () => {
    expect(claseMasDebil(['observado', 'estimado'])).toBe('estimado');
    expect(claseMasDebil(['observado', 'inferido', 'estimado'])).toBe('inferido');
    expect(claseMasDebil([])).toBe('sin_dato');
    expect(claseEfectiva('candidatos_reclamo', 10, 'observado')).toBe('inferido');
  });
  it('una métrica desconocida falla fuerte (sin color por omisión)', () => {
    expect(() => metrica('no_existe' as never)).toThrow(/desconocida/);
  });
});
