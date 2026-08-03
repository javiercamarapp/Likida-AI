import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { DollarSign, Truck, CheckCircle2 } from 'lucide-react';
import { Sparkline, Tendencia } from '../charts';
import ContadorRetro from '../contador-retro';

export const dynamic = 'force-dynamic';

/** Mismo patrón de insignia cuadrada que Inicio (`admin/page.tsx`) — no se
 *  reimporta de ahí porque no lo exporta, se repite local (5 líneas). */
function Insignia({ Icono }: { Icono: typeof DollarSign }) {
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
    </div>
  );
}

/**
 * Ejecutivo / Board — la vista para junta directiva. El MRR es el mismo $0
 * real de Inicio (no un número distinto vestido para el board: es el mismo
 * hecho verdadero visto desde otra perspectiva). Debajo, los únicos tres
 * KPIs que SÍ existen con datos reales: gasto en IA, flotas y viajes
 * procesados. Todo lo que un board típico esperaría — ARR, burn, runway,
 * magic number, LTV/CAC — requiere datos financieros que este panel no
 * captura hoy, así que se dice en tono neutral, sin inventar ni disculparse.
 */
export default async function EjecutivoPage() {
  const r = await getResumenNegocio();
  const chipsCosto = r.porDia.slice(-8).map((d) => d.costoUsd);

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-panel overflow-hidden">
        <div className="px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl tracking-tight" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
              Ejecutivo / Board
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
              Cifras reales de Likida, sin proyección ni relleno.
            </p>
          </div>
          <ContadorRetro valor={0} digitos={7} prefijo="$" etiqueta="MRR — meta $1,000,000" tamaño="lg" />
        </div>

        <section className="p-6 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Lo que sí existe hoy
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div className="card p-3.5">
              <div className="flex items-center gap-3">
                <Insignia Icono={DollarSign} />
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight tabular leading-tight">{usd(r.costoIaUsd)}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Gasto en IA (no es burn total de la empresa)</div>
                </div>
              </div>
              {chipsCosto.length > 1 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0"><Sparkline valores={chipsCosto} alto={20} /></div>
                  <Tendencia valor={r.tendenciaCosto} />
                </div>
              )}
            </div>
            <div className="card p-3.5">
              <div className="flex items-center gap-3">
                <Insignia Icono={Truck} />
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight tabular leading-tight">{r.tenants}</div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
                    {r.tenants <= 1 ? 'Flota (solo el demo)' : 'Flotas'}
                  </div>
                </div>
              </div>
            </div>
            <div className="card p-3.5">
              <div className="flex items-center gap-3">
                <Insignia Icono={CheckCircle2} />
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight tabular leading-tight">{r.viajesProcesados}</div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Viajes procesados</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="p-6 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Lo que este panel todavía no puede mostrar
          </div>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
            ARR, burn total, runway, magic number y LTV/CAC requieren datos financieros reales — ingresos,
            gastos operativos, cash en banco — que este panel no captura hoy. Mostrarlos aquí serían números
            inventados. Una vista histórica de 12–24 meses y un reporte de board exportable son Fase 3+ del
            roadmap.
          </p>
        </section>
      </div>
    </div>
  );
}
