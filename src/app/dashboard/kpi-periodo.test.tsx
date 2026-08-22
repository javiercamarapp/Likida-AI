import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Calculator } from 'lucide-react';
import { KpiPeriodo } from './kpi-periodo';
import type { SeriesKpiCards, ComparativoPeriodo } from '@/lib/likida/analytics';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 (M9 / A12) — la tarjeta "Costo por viaje" del Resumen, vista
// desde su LLAMADOR real. `StatCard` ya sabía pintar `null` como "—"
// (auditoría 1); lo que faltaba era fijar que `KpiPeriodo` no lo colapse a 0
// por el camino (`valor={valorActual ?? 0}` era el bug), y que sin periodo
// comparable no se invente un "0% · sin movimiento".
// ═══════════════════════════════════════════════════════════════════════════

const bucket = (p: Partial<ComparativoPeriodo>): ComparativoPeriodo => ({
  gastoTotal: 0, totalViajes: 0, costoPorViaje: null, liquidado: 0, viajesLiquidados: 0, ...p,
} as ComparativoPeriodo);

const ICONO = <Calculator width={15} height={15} />;

describe('KpiPeriodo — semana sin viajes pero con gasto', () => {
  // Puente: $41,200 de taller y casetas, cero viajes → costoPorViaje es
  // división indefinida, no "$0.00".
  const series: SeriesKpiCards = {
    semanal: [bucket({ gastoTotal: 41200, totalViajes: 0, costoPorViaje: null }), bucket({ gastoTotal: 0 })],
    mensual: [bucket({ gastoTotal: 41200 }), bucket({})],
    historico: [bucket({ gastoTotal: 41200 })],
  };

  it('costo por viaje null se sirve como "—" y dice por qué, nunca "$0.00"', () => {
    const html = renderToStaticMarkup(
      <KpiPeriodo icono={ICONO} nombre="Costo por viaje" campo="costoPorViaje" formato="mxn" subeEsBueno={false} series={series} />,
    );
    expect(html).toContain('—');
    expect(html).toContain('sin viajes en el periodo');
    expect(html).not.toContain('$0.00');
  });

  it('gasto total $41,200 contra una semana anterior en $0: sin "0% · sin movimiento"', () => {
    const html = renderToStaticMarkup(
      <KpiPeriodo icono={ICONO} nombre="Gasto total" campo="gastoTotal" formato="mxn" subeEsBueno={false} series={series} />,
    );
    expect(html).toContain('$41,200.00');
    expect(html).not.toContain('sin movimiento');
    expect(html).not.toMatch(/>0%/);
    expect(html).toContain('sin periodo comparable');
  });
});
