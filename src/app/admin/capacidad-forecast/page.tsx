import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { TrendingUp, DollarSign } from 'lucide-react';
import { AreaChartSimple } from '../charts';
import { ChartCard, KpiTile, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

interface Proyeccion {
  promedioDiario: number;
  proyeccionMensual: number;
  diasVentana: number;
}

/**
 * Extrapolación lineal HONESTA, no un modelo de forecasting: costo total de
 * IA en la ventana observada / número de días de calendario que abarca esa
 * ventana (de la primera a la última fecha con actividad, inclusive — no
 * solo los días con actividad, que inflaría el promedio si hubo huecos) ×
 * 30. Con `porDia.length === 0` no hay ninguna base, se regresa `null` en
 * vez de inventar un cero disfrazado de dato.
 */
function proyectar(porDia: Array<{ dia: string; costoUsd: number }>): Proyeccion | null {
  if (porDia.length === 0) return null;
  const fechas = porDia.map((d) => new Date(`${d.dia}T00:00:00Z`).getTime());
  const diasVentana = Math.round((Math.max(...fechas) - Math.min(...fechas)) / 86_400_000) + 1;
  const total = porDia.reduce((s, d) => s + d.costoUsd, 0);
  const promedioDiario = total / diasVentana;
  return { promedioDiario, proyeccionMensual: promedioDiario * 30, diasVentana };
}

export default async function CapacidadForecastPage() {
  const r = await getResumenNegocio();
  const proyeccion = proyectar(r.porDia);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <TrendingUp width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Capacidad & Forecast</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Proyección de gasto de IA y capacidad de WhatsApp</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Proyección de costo de IA
          </h2>

          {proyeccion === null ? (
            <div className="mt-3">
              <EstadoVacio>
                Sin datos de costo de IA registrados todavía — no hay base para proyectar nada.
              </EstadoVacio>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                {r.porDia.length > 1 ? (
                  <ChartCard titulo="Costo de IA por día" tamano="L">
                    <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={(v) => usd(v)} />
                  </ChartCard>
                ) : (
                  <EstadoVacio>
                    Sin historial suficiente todavía para una serie — solo hay un día con datos.
                  </EstadoVacio>
                )}
                <div className="flex flex-col gap-3 justify-center">
                  <KpiTile
                    icono={<DollarSign width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                    etiqueta={`Costo diario promedio, últimos ${proyeccion.diasVentana} día${proyeccion.diasVentana === 1 ? '' : 's'}`}
                    valor={proyeccion.promedioDiario} formato="usd"
                  />
                  <KpiTile
                    icono={<TrendingUp width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                    etiqueta="Proyección a 30 días"
                    valor={proyeccion.proyeccionMensual} formato="usd"
                  />
                </div>
              </div>
              <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                Proyección simple: costo diario promedio × 30 — no es un modelo real de forecasting, solo una
                extrapolación honesta de la tendencia actual.
                {proyeccion.diasVentana < 7 && ' Con tan poca historia, esta cifra es apenas indicativa.'}
              </p>
            </>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            Números de WhatsApp libres, días para tope de cuota, onboarding self-service — no aplica hoy con 1
            número y sin sistema de aprovisionamiento.
          </EstadoVacio>
        </section>
      </div>
    </div>
  );
}
