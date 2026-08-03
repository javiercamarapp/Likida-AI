import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { LineChart } from 'lucide-react';
import { AreaChartSimple, Dona, BarChartSimple } from '../charts';
import ContadorRetro from '../contador-retro';
import { IconoProveedor } from '../proveedor-icono';
import { ChartCard, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

const FASE_LABEL: Record<string, string> = {
  ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', escalacion: 'Agente de Escalación',
  chat: 'Agente de Chat', router: 'Agente Router', whatsapp: 'Agente de WhatsApp',
};

/**
 * Analítica & Stats — el explorador de BI de /admin: mismos datos que
 * Inicio, pero a mayor tamaño y sin comprimir a los últimos días, para
 * poder verlos y compararlos con más detalle. `requireSuperadmin()` ya lo
 * hizo el layout, esta página solo trae `getResumenNegocio()` (la única
 * fuente cross-tenant real) y renderiza.
 *
 * Con 1 tenant y `llm_costo`/`gasto` cubriendo apenas una semana, esta
 * página se queda a propósito en escala honesta: nada de histogramas,
 * mapas de calor ni comparativas por cliente inventados — esos necesitan
 * más historia y más de un tenant, así que la última sección lo dice tal
 * cual en vez de simular una gráfica vacía. Por la misma razón NO se
 * combinan costo y tokens en un `MultiLine` (graficas.tsx): son dos
 * unidades de escala muy distintas (dólares vs. miles de tokens) — en un
 * solo eje compartido la serie más chica se aplastaría casi a cero, el
 * mismo motivo por el que `AreaChartSimple` ya las pide por separado (ver
 * comentario en `admin/page.tsx`). Tampoco se usa `CalendarHeatmap`/
 * `Heatmap`: la sección de abajo documenta que no hay suficiente historia
 * día a día todavía para que un mapa de calor diga algo real.
 */
export default async function AnaliticaPage() {
  const r = await getResumenNegocio();

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <LineChart width={16} height={16} strokeWidth={1.75} />
          <span className="text-sm font-medium">Analítica & Stats</span>
        </div>
        {/* Total histórico de facturas (filas de `gasto`, sin filtro de
            fecha) — no se muestra en ningún otro lado de /admin, es el
            número que de verdad resume "cuánto ha procesado Likida" y le
            queda natural a una página de analítica. Real, de
            `getResumenNegocio()`. */}
        <ContadorRetro valor={r.facturasTotal} etiqueta="Facturas procesadas — total histórico" tamaño="md" />
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          {r.porDia.length > 1 ? (
            <ChartCard titulo="Costo de IA en el tiempo" tamano="L">
              <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={usd} />
            </ChartCard>
          ) : (
            <ChartCard titulo="Costo de IA en el tiempo" tamano="L">
              <EstadoVacio icono={<LineChart width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
                Sin historial suficiente todavía.
              </EstadoVacio>
            </ChartCard>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {r.porFase.length > 0 ? (
              <ChartCard titulo="Costo por fase" tamano="S">
                <Dona segmentos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))} />
              </ChartCard>
            ) : (
              <ChartCard titulo="Costo por fase" tamano="S">
                <EstadoVacio>Todavía no hay actividad de IA registrada.</EstadoVacio>
              </ChartCard>
            )}

            {r.porModelo.length === 0 ? (
              <ChartCard titulo="Costo por modelo" tamano="S">
                <EstadoVacio>Sin llamadas registradas todavía.</EstadoVacio>
              </ChartCard>
            ) : (
              <ChartCard titulo="Costo por modelo" tamano="M">
                <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                  {r.porModelo.map((m) => (
                    <div key={m.modelo} className="py-2.5 flex items-center gap-3">
                      <IconoProveedor modelo={m.modelo} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-mono truncate">{m.modelo}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{m.n} llamadas</div>
                      </div>
                      <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                    </div>
                  ))}
                </div>
              </ChartCard>
            )}
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          {r.facturasPorDia.some((d) => d.n > 0) ? (
            <ChartCard titulo="Facturas procesadas por día" tamano="M">
              <BarChartSimple datos={r.facturasPorDia.map((d) => ({ dia: d.dia, valor: d.n }))} alto={160} />
            </ChartCard>
          ) : (
            <ChartCard titulo="Facturas procesadas por día" tamano="M">
              <EstadoVacio>Aún sin datos suficientes.</EstadoVacio>
            </ChartCard>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <ChartCard titulo="Distribuciones y comparativas" tamano="S">
            <EstadoVacio>
              Histogramas de mensajes por conversación, mapa de calor hora×día y comparativas por cliente
              necesitan más historia y más de un tenant para decir algo real — hoy Likida tiene 1 flota y
              pocos días de datos, así que estas vistas se muestran en cuanto haya suficiente para que no
              sean solo ruido.
            </EstadoVacio>
          </ChartCard>
        </section>

        <section className="px-5 py-4 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>Exportar CSV y reportes programados — Fase 2 del roadmap.</EstadoVacio>
        </section>
      </div>
    </div>
  );
}
