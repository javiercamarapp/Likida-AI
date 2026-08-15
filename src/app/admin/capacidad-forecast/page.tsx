import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { Gauge, TrendingUp, DollarSign } from 'lucide-react';
import { AreaChartSimple } from '../charts';
import { StatCard, EstadoVacio } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';

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

  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Gauge {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo="Capacidad & Forecast"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {proyeccion === null ? (
            <EstadoVacio>
              Sin datos de costo de IA registrados todavía — no hay base para proyectar nada.
            </EstadoVacio>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <StatCard icono={<DollarSign {...ICONO} />}
                  etiqueta={`Costo diario promedio, últimos ${proyeccion.diasVentana} día${proyeccion.diasVentana === 1 ? '' : 's'}`}
                  valor={proyeccion.promedioDiario} formato="usd"
                />
                <StatCard icono={<TrendingUp {...ICONO} />}
                  etiqueta="Proyección a 30 días"
                  valor={proyeccion.proyeccionMensual} formato="usd"
                />
              </div>

              <div className="card p-4">
                <TituloSeccion>Costo de IA por día</TituloSeccion>
                <div className="mt-3">
                  {r.porDia.length > 1 ? (
                    <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={(v) => usd(v)} />
                  ) : (
                    <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                      Sin historial suficiente todavía para una serie — solo hay un día con datos.
                    </div>
                  )}
                </div>
                <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                  Proyección simple: costo diario promedio × 30 — no es un modelo real de forecasting, solo una
                  extrapolación honesta de la tendencia actual.
                  {proyeccion.diasVentana < 7 && ' Con tan poca historia, esta cifra es apenas indicativa.'}
                </p>
              </div>
            </>
          )}

          <EstadoVacio>
            Números de WhatsApp libres, días para tope de cuota, onboarding self-service — no aplica hoy con 1
            número y sin sistema de aprovisionamiento.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
