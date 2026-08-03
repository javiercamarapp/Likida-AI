import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { DollarSign, Calculator } from 'lucide-react';
import { AreaChartSimple, Dona } from '../charts';
import { IconoProveedor } from '../proveedor-icono';
import { ChartCard, EstadoVacio, KpiTile } from '../ui/kit';

export const dynamic = 'force-dynamic';

// Mismo diccionario de admin/page.tsx (no se exporta de ahí) — solo las
// etiquetas legibles para la dona de "Costo por fase".
const FASE_LABEL: Record<string, string> = {
  ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', escalacion: 'Agente de Escalación',
  chat: 'Agente de Chat', router: 'Agente Router', whatsapp: 'Agente de WhatsApp',
};

/**
 * Costos & Facturación — todo lo real que existe hoy sobre el gasto de IA
 * (`getResumenNegocio()`), más un costo unitario honesto (costo total de
 * IA ÷ viajes procesados, presentado como estimación, no como precisión
 * falsa). Likida no cobra a ningún cliente todavía: margen por cliente,
 * MRR/ARR, límites de gasto y cobros no tienen fuente de datos real en
 * este esquema — se enseñan como honest empty-state, Fase 3 del roadmap.
 *
 * Ni `Waterfall` ni `MarginDivergingBars` (graficas.tsx) aplican aquí a
 * propósito: ambos piden una forma de dato que Likida no tiene — un saldo
 * que se reconcilia paso a paso (Waterfall, tipo MRR bridge) o un valor
 * con signo ± (margen de rentabilidad por cliente) — y hoy solo existen
 * magnitudes no-negativas por fase/modelo. `Dona` y la lista con
 * `IconoProveedor` ya son el mejor ajuste real para esa forma de dato.
 */
export default async function CostosFacturacionPage() {
  const r = await getResumenNegocio();
  const costoPorViaje = r.viajesProcesados > 0 ? r.costoIaUsd / r.viajesProcesados : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <DollarSign width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Costos & Facturación</span>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Costo total de IA
          </h2>
          {/* KpiTile necesita un `valor` numérico real siempre — cuando
              `costoPorViaje` es `null` (sin viajes procesados) no hay
              número honesto que mostrarle (ni siquiera 0: 0 viajes ÷ 0
              costo no es "costo por viaje = $0", es indefinido), así que
              ese caso se queda con el card original en vez de forzar un
              0 engañoso dentro de KpiTile. */}
          {costoPorViaje !== null ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <KpiTile
                icono={<DollarSign width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                etiqueta="Gastado en IA — todo el histórico" valor={r.costoIaUsd} formato="usd"
              />
              <KpiTile
                icono={<Calculator width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                etiqueta="Costo estimado de IA por viaje procesado (costo total ÷ viajes procesados)"
                valor={costoPorViaje} formato="usd"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div className="card p-4">
                <div className="text-2xl font-semibold tracking-tight tabular">{usd(r.costoIaUsd)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Gastado en IA — todo el histórico</div>
              </div>
              <div className="card p-4">
                <div className="text-2xl font-semibold tracking-tight tabular">—</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Sin viajes procesados todavía para estimar un costo por viaje
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          {r.porDia.length > 1 ? (
            <ChartCard titulo="Costo de IA en el tiempo" tamano="L">
              <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={usd} />
            </ChartCard>
          ) : (
            <ChartCard titulo="Costo de IA en el tiempo" tamano="L">
              <EstadoVacio icono={<DollarSign width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
                Sin historial suficiente todavía.
              </EstadoVacio>
            </ChartCard>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          {r.porFase.length > 0 ? (
            <ChartCard titulo="Costo por fase" tamano="S">
              <Dona segmentos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))} />
            </ChartCard>
          ) : (
            <ChartCard titulo="Costo por fase" tamano="S">
              <EstadoVacio>Todavía no hay actividad de IA registrada.</EstadoVacio>
            </ChartCard>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          {r.porModelo.length === 0 ? (
            <ChartCard titulo="Costo por modelo" tamano="S">
              <EstadoVacio>Sin llamadas registradas todavía.</EstadoVacio>
            </ChartCard>
          ) : (
            <ChartCard titulo="Costo por modelo" tamano="M">
              <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {r.porModelo.map((m) => (
                  <div key={m.modelo} className="py-3 flex items-center gap-3">
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
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <ChartCard titulo="Lo que todavía no es real" tamano="S">
            <EstadoVacio>
              Margen por cliente, ingresos MRR/ARR, waterfall de MRR, límites de gasto configurables con alertas, proyección de gasto vs. presupuesto — TODO esto depende de tener precio/plan de facturación real por cliente, que no existe (Likida no cobra a nadie hoy). Fase 3 del roadmap.
              <br /><br />
              Cobros: exitosos/fallidos, dunning, conciliación Stripe, CFDI de facturación a clientes — sin integración de cobro todavía.
            </EstadoVacio>
          </ChartCard>
        </section>
      </div>
    </div>
  );
}
