import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { TrendingUp, CheckCircle2, DollarSign } from 'lucide-react';
import { AreaChartSimple } from '../charts';
import { KpiTile, ChartCard } from '../ui/kit';

export const dynamic = 'force-dynamic';

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
          {/* ChartCard (design system v2, ui/kit.tsx) — mismo AreaChartSimple
              de siempre (charts.tsx sigue vigente para esta forma de dato:
              una sola serie continua en el tiempo), solo consolidado en la
              tarjeta compartida; `tamano="L"` porque es la única gráfica
              real de la página, la pieza dominante. */}
          <ChartCard
            titulo="Uso de la plataforma en el tiempo"
            subtitulo="No es una métrica de usuarios — es el gasto real de IA por día, el proxy más honesto que existe hoy de cuánto se está usando Likida."
            tamano="L"
          >
            {datosCosto.length > 1 ? (
              <AreaChartSimple datos={datosCosto} etiquetaValor={usd} />
            ) : (
              <div className="text-sm py-10 text-center" style={{ color: 'var(--muted)' }}>
                Sin historial suficiente todavía.
              </div>
            )}
          </ChartCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            <KpiTile
              icono={<CheckCircle2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Viajes procesados" valor={r.viajesProcesados} formato="entero"
            />
            <KpiTile
              icono={<DollarSign width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Tokens usados" valor={r.tokensIn + r.tokensOut} formato="numero"
              tendencia={r.tendenciaTokens} sparkline={chipsTokens}
            />
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
