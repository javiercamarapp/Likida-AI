import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, costoIaPorDiaDesde } from '@/lib/admin/negocio';
import { getUnidadesMedidas, escenarioDe, ESCENARIOS_VIAJES_DIA, SUPUESTOS_CAPACIDAD, LIMITES_NOMINALES } from '@/lib/admin/capacidad';
import { ahoraMs } from '@/lib/saludo';
import { numero } from '@/lib/formato';
import { usd } from '@/lib/utils';
import { proyectarCosto } from './proyeccion';
import { Gauge, TrendingUp, DollarSign } from 'lucide-react';
import { AreaChartSimple } from '../charts';
import { StatCard, EstadoVacio } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';

export const dynamic = 'force-dynamic';

export default async function CapacidadForecastPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const r = await getResumenNegocio();
  // A37-S05-03: ventana REAL de 30 días (UTC, como la serie) y costo sin redondear.
  const hoyUtc = new Date(ahoraMs()).toISOString().slice(0, 10);
  let enVentana: Array<{ dia: string; costoUsd: number }> | null = null;
  try {
    enVentana = await costoIaPorDiaDesde(new Date(new Date(`${hoyUtc}T00:00:00Z`).getTime() - 29 * 86_400_000).toISOString());
  } catch { enVentana = null; }
  const proyeccion = enVentana === null ? null : proyectarCosto(r.porDia, enVentana, hoyUtc);
  // El modelo de capacidad (fase 7): unidades MEDIDAS si hay muestra; si la
  // lectura falla, la sección lo dice — jamás un escenario con base fantasma.
  let unidades: Awaited<ReturnType<typeof getUnidadesMedidas>> | null = null;
  try { unidades = await getUnidadesMedidas(ahoraMs()); } catch { unidades = null; }

  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Gauge {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo="Capacidad & Forecast"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {enVentana === null ? (
            <EstadoVacio>
              No se pudo leer el costo de la ventana de 30 días — esto NO significa que no haya gasto.
            </EstadoVacio>
          ) : proyeccion === null ? (
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

          {/* ── EL MODELO DE CAPACIDAD (fase 7): escenarios con supuestos
                A LA VISTA. Las unidades salen de lo medido cuando hay
                muestra; los límites de proveedor son nominales y se dice. ── */}
          <div className="card p-4">
            <TituloSeccion>Modelo de capacidad — escenarios de escala</TituloSeccion>
            {unidades === null ? (
              <p className="text-[12.5px] mt-2" style={{ color: 'var(--muted)' }}>
                No se pudieron leer las unidades medidas — sin base, no se pintan escenarios.
              </p>
            ) : (
              <>
                <p className="text-[12px] mt-1.5" style={{ color: 'var(--muted)' }}>
                  {unidades.costoIaPorViaje !== null
                    ? <>Costo de IA MEDIDO: {usd(unidades.costoIaPorViaje)} por viaje liquidado (muestra: {numero(unidades.muestraViajes)} liquidaciones en 30d{unidades.muestraViajes < 30 ? ' — muestra chica, apenas indicativo' : ''}).</>
                    : <>Sin liquidaciones en 30d — el costo por viaje no se puede medir y el escenario lo deja en blanco.</>}
                </p>
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-left" style={{ color: 'var(--muted)' }}>
                        <th className="py-1.5 pr-4 font-medium">Viajes/día</th>
                        <th className="py-1.5 pr-4 font-medium text-right">Mensajes WA/día</th>
                        <th className="py-1.5 pr-4 font-medium text-right">Pico msg/min</th>
                        <th className="py-1.5 pr-4 font-medium text-right">Llamadas LLM/día</th>
                        <th className="py-1.5 pr-4 font-medium text-right">Costo IA/día</th>
                        <th className="py-1.5 font-medium text-right">Storage/día</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ESCENARIOS_VIAJES_DIA.map((v) => {
                        const e = escenarioDe(v, unidades!.costoIaPorViaje);
                        return (
                          <tr key={v} className="border-t tabular" style={{ borderColor: 'var(--line2)' }}>
                            <td className="py-1.5 pr-4 font-medium">{numero(v)}</td>
                            <td className="py-1.5 pr-4 text-right">{numero(e.mensajesDia)}</td>
                            <td className="py-1.5 pr-4 text-right">{numero(e.mensajesMinPico)}</td>
                            <td className="py-1.5 pr-4 text-right">{numero(e.llamadasLlmDia)}</td>
                            <td className="py-1.5 pr-4 text-right">{e.costoIaDiaUsd === null ? <span style={{ color: 'var(--faint)' }}>sin base medida</span> : usd(e.costoIaDiaUsd)}</td>
                            <td className="py-1.5 text-right">{numero(e.storageDiaMb)} MB</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] mt-3" style={{ color: 'var(--faint)' }}>
                  Supuestos declarados: {SUPUESTOS_CAPACIDAD.mensajesPorViaje} mensajes y {SUPUESTOS_CAPACIDAD.comprobantesPorViaje} comprobantes
                  por viaje (~{Math.round(SUPUESTOS_CAPACIDAD.bytesPorComprobante / 1000)} KB c/u), {SUPUESTOS_CAPACIDAD.llamadasLlmPorViaje} llamadas
                  LLM por viaje, jornada pico de {SUPUESTOS_CAPACIDAD.horasPicoDia} h. Es una estimación con supuestos a la vista, no una medición.
                </p>
                <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
                  <p className="etiqueta-mono text-[10px] uppercase mb-1" style={{ color: 'var(--muted)' }}>Límites nominales del proveedor (documentación, no medidos)</p>
                  {LIMITES_NOMINALES.map((l) => (
                    <p key={l.recurso} className="text-[12px]" style={{ color: 'var(--muted)' }}>· {l.recurso}: {l.limite} <span style={{ color: 'var(--faint)' }}>({l.fuente})</span></p>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
