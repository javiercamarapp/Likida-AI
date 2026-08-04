import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { Activity } from 'lucide-react';
import { AreaChartSimple } from '../charts';
import { ChartCard, StatusPill, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/** Título de sección — mismo patrón que admin/page.tsx: SIEMPRE dentro de
 *  un `.glass-panel`, nunca suelto sobre el fondo difuminado. */
function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

/**
 * Observabilidad & Rendimiento — `requireSuperadmin()` ya lo hizo el layout,
 * esta página solo trae datos.
 *
 * Lo real hoy son dos cosas: (1) Sentry y Vercel, ya conectados como
 * herramientas externas — se enlazan, igual que en "Salud del sistema" de
 * Inicio, en vez de reconstruir sus dashboards adentro; (2) el costo/tokens
 * de IA en el tiempo (`getResumenNegocio().porDia`), un proxy honesto de
 * actividad — no es latencia ni rendimiento, pero es el único dato real que
 * existe hoy sobre "cuánto está trabajando la IA".
 *
 * Lo que un panel de Observabilidad & Rendimiento "de verdad" necesita —
 * latencia p50/p95/p99, éxito de tool-calls, escalamiento a humano, trace
 * viewer — NO se instrumenta hoy: `llm_costo` no tiene columna de duración
 * y no existe un sistema de trazas. Eso se dice tal cual, no se simula.
 */
export default async function ObservabilidadPage() {
  const r = await getResumenNegocio();

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Activity width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Observabilidad & Rendimiento</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Salud del sistema y actividad de IA en el tiempo</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <TituloSeccion>Salud del sistema</TituloSeccion>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <a href="https://sentry.io" target="_blank" rel="noopener noreferrer" className="card p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Errores — Sentry</div>
                <StatusPill estado="ok">Conectado</StatusPill>
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Se enlaza en vez de reconstruirse.</div>
            </a>
            <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer" className="card p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Uptime, deploys y latencia de edge — Vercel</div>
                <StatusPill estado="ok">Conectado</StatusPill>
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Vercel ya lo mide. Se enlaza en vez de reconstruirse.</div>
            </a>
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <ChartCard titulo="Actividad de IA en el tiempo" tamano="M">
            {r.porDia.length > 1 ? (
              <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={usd} />
            ) : (
              <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                Sin historial suficiente todavía.
              </div>
            )}
          </ChartCard>
          <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
            Proxy honesto de actividad, no de rendimiento: enseña cuánto gasta la IA día a día, no qué tan rápido responde.
          </p>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Rendimiento por llamada</TituloSeccion>
          <div className="mt-3">
            <EstadoVacio icono={<Activity width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Latencia p50/p95/p99 por llamada, tasa de éxito de tool-calls, tasa de escalamiento a humano, tiempo de
              resolución end-to-end, trace viewer paso a paso — ninguno de estos se instrumenta hoy (no hay columna de
              duración en <code className="font-mono text-xs">llm_costo</code> ni un sistema de trazas). Fase 1-4 del roadmap.
            </EstadoVacio>
          </div>
        </section>
      </div>
    </div>
  );
}
