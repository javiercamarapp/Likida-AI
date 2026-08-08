'use client';

import { useState } from 'react';
import { Dona, AreaChartSimple } from '../admin/charts';
import { GastoSemanalChart } from './gasto-semanal-chart';
import { TopRutas } from './top-rutas';
import { TituloSeccion } from './resumen-visual';
import { Actividad, type ModoPeriodo } from './actividad';
import { mxn } from '@/lib/formato';
import type {
  SeriesKpiCards, GastoSemanalSeries, LiquidadoSemanalSeries, TopRutasSeries,
} from '@/lib/likida/analytics';

const MODOS: ModoPeriodo[] = ['semanal', 'mensual', 'historico'];
const OPCIONES: Array<{ id: ModoPeriodo; etiqueta: string }> = [
  { id: 'semanal', etiqueta: 'Semanal' },
  { id: 'mensual', etiqueta: 'Mensual' },
  { id: 'historico', etiqueta: 'Histórico' },
];

/**
 * UN SOLO selector Semanal/Mensual/Histórico que mueve Viajes, Actividad,
 * Gasto por categoría, Liquidado por semana y Top rutas por gasto juntos —
 * dirección del 8-ago-2026 (antes cada gráfica tenía su propio estado, o
 * ninguno: "Gasto por categoría"/"Liquidado" vivían fijas a 5 semanas,
 * "Viajes" a todo el histórico siempre).
 *
 * Todos los datos ya llegan PRE-CALCULADOS por el servidor para las 3
 * vistas (`*Series` en `analytics.ts`) — este componente solo decide cuál
 * mostrar. `viajes`/`porMes` son la excepción: `Actividad` los bucketea en
 * el cliente porque ya se cargaban así desde antes (ver su propio
 * comentario).
 */
export function PanelPeriodo({
  viajes, porMes, seriesKpis, gastoSemanalSeries, liquidadoSemanalSeries, topRutasSeries,
}: {
  viajes: Array<{ fechaInicio: string | null }>;
  porMes: Array<{ dia: string; valor: number }>;
  seriesKpis: SeriesKpiCards | null;
  gastoSemanalSeries: GastoSemanalSeries | null;
  liquidadoSemanalSeries: LiquidadoSemanalSeries | null;
  topRutasSeries: TopRutasSeries | null;
}) {
  const [modoIdx, setModoIdx] = useState(0);
  const modo = MODOS[modoIdx];

  const kpiModo = seriesKpis?.[modo]?.[0] ?? null;
  const gastoModo = gastoSemanalSeries?.[modo] ?? null;
  const liquidadoModo = liquidadoSemanalSeries?.[modo] ?? null;
  const rutasModo = topRutasSeries?.[modo] ?? null;
  const totalLiquidado = liquidadoModo?.reduce((s, d) => s + d.valor, 0) ?? 0;

  return (
    <>
      <div className="px-5 flex items-center justify-end">
        <div className="inline-flex items-center gap-1 p-0.5 rounded-full shrink-0" style={{ background: 'var(--canvas)' }}>
          {OPCIONES.map((o) => (
            <button key={o.id} type="button" onClick={() => setModoIdx(MODOS.indexOf(o.id))}
              className="text-xs font-medium px-2.5 py-1 rounded-full transition-colors"
              style={modo === o.id ? { background: 'var(--marca)', color: 'white' } : { color: 'var(--muted)' }}>
              {o.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* ── Viajes / Actividad ── */}
      <div className="px-5 pb-4 pt-2 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <TituloSeccion>Viajes</TituloSeccion>
          <div className="mt-2.5">
            {kpiModo && kpiModo.totalViajes > 0 ? (
              <Dona segmentos={[
                { etiqueta: 'Liquidados', valor: kpiModo.viajesLiquidados },
                { etiqueta: 'Pendientes', valor: Math.max(0, kpiModo.totalViajes - kpiModo.viajesLiquidados) },
              ]} />
            ) : (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Aún no hay viajes registrados en este periodo.</p>
            )}
          </div>
        </div>
        <div className="md:col-span-2">
          <TituloSeccion>Actividad</TituloSeccion>
          <div className="mt-3">
            <Actividad viajes={viajes} porMes={porMes} modo={modo} />
          </div>
        </div>
      </div>

      {/* ── Gasto por categoría / Liquidado por semana ── */}
      <div className="px-5 pb-4 border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4" style={{ borderColor: 'var(--line)' }}>
        <div>
          <TituloSeccion>Gasto por categoría</TituloSeccion>
          <div className="mt-3">
            {gastoModo && gastoModo.series.some((s) => s.valores.some((v) => v > 0)) ? (
              <GastoSemanalChart categorias={gastoModo.categorias} series={gastoModo.series} />
            ) : (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Aún no hay gastos capturados.</p>
            )}
          </div>
        </div>
        <div>
          <TituloSeccion>Liquidado</TituloSeccion>
          {totalLiquidado > 0 && (
            <div className="text-2xl font-semibold tracking-tight tabular mt-1">{mxn(totalLiquidado)}</div>
          )}
          <div className="mt-2.5">
            {liquidadoModo === null ? (
              <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 140 }}>
                No se pudo cargar esta gráfica.
              </div>
            ) : liquidadoModo.some((d) => d.valor > 0) ? (
              <AreaChartSimple datos={liquidadoModo} etiquetaValor={mxn} />
            ) : (
              <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 140 }}>
                Sin cierres en este periodo.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Top rutas por gasto ── */}
      <div className="px-5 pb-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
        <TituloSeccion>Top rutas por gasto</TituloSeccion>
        <div className="mt-2.5 overflow-x-auto">
          {rutasModo ? (
            <TopRutas rutas={rutasModo} />
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</p>
          )}
        </div>
      </div>
    </>
  );
}
