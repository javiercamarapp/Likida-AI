import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/utils';
import { TrendingUp, CheckCircle2, DollarSign } from 'lucide-react';
import { AreaChartSimple, Sparkline, Tendencia } from '../charts';

export const dynamic = 'force-dynamic';

/** Mismo patrón de insignia cuadrada que Inicio (`admin/page.tsx`) — no se
 *  reimporta de ahí porque no lo exporta, se repite local (5 líneas). */
function Insignia({ Icono }: { Icono: typeof TrendingUp }) {
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
    </div>
  );
}

/**
 * Crecimiento — con 1 solo tenant y sin instrumentación de producto (no hay
 * tabla de eventos, ni funnel, ni cohortes), casi todo lo que un board
 * esperaría ver aquí (DAU/WAU/MAU, NPS, embudo, retención) es honestamente
 * inexistente. Lo único real y relevante: el gasto de IA por día
 * (`resumen.porDia`) como proxy de "cuánto se está usando la plataforma" —
 * etiquetado así a propósito, nunca como "crecimiento de usuarios", porque
 * no hay una sola métrica de usuario real detrás.
 */
export default async function CrecimientoPage() {
  const r = await getResumenNegocio();
  const datosCosto = r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }));
  const chipsTokens = r.porDia.slice(-8).map((d) => d.tokens);

  const sinInstrumentacion = [
    'DAU / WAU / MAU',
    'NPS',
    'Embudo leads → activados → de pago',
    'Retención por cohortes',
    'Adopción por feature',
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel h-14 flex items-center gap-2.5 px-5">
        <TrendingUp width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Crecimiento</span>
      </header>

      <div className="glass-panel overflow-hidden">
        <div className="p-6">
          <h1 className="text-base font-semibold tracking-tight">
            Con 1 flota dada de alta, todavía no hay &quot;crecimiento&quot; que medir
          </h1>
          <p className="text-sm mt-1.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
            No hay historial de altas de flota que graficar (solo existe el tenant demo), y Likida no
            tiene instrumentación de producto — ningún conteo de usuarios activos ni embudo de registro.
            Con n=1 cualquier tendencia de crecimiento sería un número inventado, no una señal real.
          </p>
        </div>

        <section className="p-6 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Uso de la plataforma en el tiempo
          </div>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--muted)' }}>
            No es una métrica de usuarios — es el gasto real de IA por día, el proxy más honesto que existe
            hoy de cuánto se está usando Likida.
          </p>
          {datosCosto.length > 1 ? (
            <AreaChartSimple datos={datosCosto} etiquetaValor={usd} />
          ) : (
            <div className="text-sm py-10 text-center" style={{ color: 'var(--muted)' }}>
              Sin historial suficiente todavía.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            <div className="card p-3.5">
              <div className="flex items-center gap-3">
                <Insignia Icono={CheckCircle2} />
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight tabular leading-tight">{r.viajesProcesados}</div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Viajes procesados</div>
                </div>
              </div>
            </div>
            <div className="card p-3.5">
              <div className="flex items-center gap-3">
                <Insignia Icono={DollarSign} />
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight tabular leading-tight">{numero(r.tokensIn + r.tokensOut)}</div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Tokens usados</div>
                </div>
              </div>
              {chipsTokens.length > 1 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0"><Sparkline valores={chipsTokens} alto={20} /></div>
                  <Tendencia valor={r.tendenciaTokens} />
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="p-6 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
            Lo que esta página todavía no puede mostrar
          </div>
          <ul className="space-y-2 text-sm">
            {sinInstrumentacion.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="w-1 h-1 rounded-full mt-2 shrink-0" style={{ background: 'var(--muted)' }} />
                <span style={{ color: 'var(--muted)' }}>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
            Necesitan instrumentación de producto que no existe hoy, y más de 1 cliente para decir algo real.
          </p>
        </section>
      </div>
    </div>
  );
}
