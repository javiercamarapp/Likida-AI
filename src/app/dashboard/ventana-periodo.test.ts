import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rotuloVentana, DIAS_POR_MODO, SEMANAS_POR_MODO_VISTA } from './ventana-periodo';

const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// AUDITORÍA 18, ALTO (A11) — el pill dice "Histórico" y "Liquidado" suma 52
// semanas; dice "Semanal" y la dona cuenta 7 días al lado de 35 días de dinero.
describe('rotuloVentana — cada tarjeta dice su ventana real (A11)', () => {
  it('en Semanal, Viajes son 7 días y el dinero son 5 semanas — y se dice', () => {
    expect(rotuloVentana('viajes', 'semanal')).toBe('últimos 7 días');
    expect(rotuloVentana('gasto', 'semanal')).toBe('últimas 5 semanas');
    expect(rotuloVentana('liquidado', 'semanal')).toBe('últimas 5 semanas');
  });

  it('en Histórico, Liquidado NO promete todo: dice 52 semanas', () => {
    expect(rotuloVentana('liquidado', 'historico')).toBe('últimas 52 semanas');
    expect(rotuloVentana('gasto', 'historico')).toBe('últimas 52 semanas');
    expect(rotuloVentana('viajes', 'historico')).toBe('todo el histórico');
    expect(rotuloVentana('rutas', 'historico')).toBe('todo el histórico');
  });

  it('ningún bloque enseña el mismo rótulo para dos modos distintos', () => {
    for (const b of ['viajes', 'actividad', 'gasto', 'liquidado', 'rutas'] as const) {
      const r = new Set(['semanal', 'mensual', 'historico'].map((m) => rotuloVentana(b, m as never)));
      expect(r.size).toBe(3);
    }
  });
});

describe('los números del rótulo son los del origen de cada serie (guardia de fuente)', () => {
  it('SEMANAS_POR_MODO en analytics.ts sigue siendo 5/13/52', () => {
    const src = leer('../../lib/likida/analytics.ts');
    const m = src.match(/SEMANAS_POR_MODO = \{ semanal: (\d+), mensual: (\d+), historico: (\d+) \}/);
    expect(m).not.toBeNull();
    expect([Number(m![1]), Number(m![2]), Number(m![3])])
      .toEqual([SEMANAS_POR_MODO_VISTA.semanal, SEMANAS_POR_MODO_VISTA.mensual, SEMANAS_POR_MODO_VISTA.historico]);
  });

  it('getSeriesKpiCards mide en 7 y 30 días; Top rutas histórico va sin cota', () => {
    const src = leer('../../lib/likida/analytics.ts');
    expect(src).toMatch(new RegExp(`getSerieComparativa\\(tenantId, ${DIAS_POR_MODO.semanal}, 2, hoy\\)`));
    expect(src).toMatch(new RegExp(`getSerieComparativa\\(tenantId, ${DIAS_POR_MODO.mensual}, 2, hoy\\)`));
    // FE-4 (22-ago-2026): las `*Series` piden sus modos con `porModo` +
    // `allSettled`, así que el histórico ya no es un renglón de un
    // `Promise.all`; sigue siendo la ÚNICA llamada SIN ventana, que es lo
    // que este guardia existe para vigilar.
    expect(src).toMatch(/getTopRutasPorGasto\(tenantId, top\)\s*$/m);
  });

  it('Actividad bucketea 7 y 30 días', () => {
    const src = leer('./actividad.tsx');
    expect(src).toMatch(/bucketsPorDia\(viajes, 7\)/);
    expect(src).toMatch(/bucketsPorDia\(viajes, 30\)/);
  });
});
