import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { DollarSign, Smartphone } from 'lucide-react';
import { AreaChartSimple, Dona } from '../charts';

export const dynamic = 'force-dynamic';

// Mismo diccionario de admin/page.tsx (no se exporta de ahí) — solo las
// etiquetas legibles para la dona de "Costo por fase".
const FASE_LABEL: Record<string, string> = {
  ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', escalacion: 'Agente de Escalación',
  chat: 'Agente de Chat', router: 'Agente Router', whatsapp: 'Agente de WhatsApp',
};

/** Ícono antes del nombre en "Costo por modelo" — mismo patrón de
 *  admin/page.tsx, recreado aquí porque no se exporta de ahí. */
function IconoProveedor({ modelo }: { modelo: string }) {
  if (modelo.toLowerCase().includes('whatsapp')) {
    return (
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <Smartphone width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
      </div>
    );
  }
  const proveedor = modelo.includes('/') ? modelo.split('/')[0] : modelo;
  const letra = proveedor.charAt(0).toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: 'var(--ink)', color: 'white' }}>
      {letra}
    </div>
  );
}

/**
 * Costos & Facturación — todo lo real que existe hoy sobre el gasto de IA
 * (`getResumenNegocio()`), más un costo unitario honesto (costo total de
 * IA ÷ viajes procesados, presentado como estimación, no como precisión
 * falsa). Likida no cobra a ningún cliente todavía: margen por cliente,
 * MRR/ARR, límites de gasto y cobros no tienen fuente de datos real en
 * este esquema — se enseñan como honest empty-state, Fase 3 del roadmap.
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div className="card p-4">
              <div className="text-2xl font-semibold tracking-tight tabular">{usd(r.costoIaUsd)}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Gastado en IA — todo el histórico</div>
            </div>
            <div className="card p-4">
              <div className="text-2xl font-semibold tracking-tight tabular">
                {costoPorViaje !== null ? usd(costoPorViaje) : '—'}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                {costoPorViaje !== null
                  ? 'Costo estimado de IA por viaje procesado (costo total ÷ viajes procesados)'
                  : 'Sin viajes procesados todavía para estimar un costo por viaje'}
              </div>
            </div>
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Costo de IA en el tiempo
          </h2>
          {r.porDia.length > 1 ? (
            <div className="mt-3">
              <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={usd} />
            </div>
          ) : (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>Sin historial suficiente todavía.</div>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Costo por fase
          </h2>
          {r.porFase.length > 0 ? (
            <div className="card p-4 mt-3">
              <Dona segmentos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))} />
            </div>
          ) : (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>Todavía no hay actividad de IA registrada.</div>
          )}
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Costo por modelo
          </h2>
          {r.porModelo.length === 0 ? (
            <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
          ) : (
            <div className="card divide-y mt-3" style={{ borderColor: 'var(--line)' }}>
              {r.porModelo.map((m) => (
                <div key={m.modelo} className="px-5 py-3 flex items-center gap-3">
                  <IconoProveedor modelo={m.modelo} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-mono truncate">{m.modelo}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{m.n} llamadas</div>
                  </div>
                  <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="p-5 border-t space-y-2" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Lo que todavía no es real
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Margen por cliente, ingresos MRR/ARR, waterfall de MRR, límites de gasto configurables con alertas, proyección de gasto vs. presupuesto — TODO esto depende de tener precio/plan de facturación real por cliente, que no existe (Likida no cobra a nadie hoy). Fase 3 del roadmap.
          </p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Cobros: exitosos/fallidos, dunning, conciliación Stripe, CFDI de facturación a clientes — sin integración de cobro todavía.
          </p>
        </section>
      </div>
    </div>
  );
}
