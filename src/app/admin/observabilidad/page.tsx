import { getResumenNegocio } from '@/lib/admin/negocio';
import { sentryActivo } from '@/lib/observability/sentry';
import { usd } from '@/lib/utils';
import { Activity, ExternalLink } from 'lucide-react';
import { AreaChartSimple } from '../charts';
import { StatusPill, EstadoVacio } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';

export const dynamic = 'force-dynamic';

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
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Activity width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Observabilidad & Rendimiento"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="card p-3">
            <TituloSeccion>Salud del sistema</TituloSeccion>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mt-2">
              {/* MEDIDO, no fijo (auditoría 4, D3): el pill decía "Conectado"
                  por decreto. Lo único que se puede afirmar desde aquí es si hay
                  DSN — "configurado", nunca "conectado". */}
              <a href="https://sentry.io" target="_blank" rel="noopener noreferrer"
                className="hairline rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--canvas)]"
                style={{ background: 'var(--surface)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[13px] font-medium inline-flex items-center gap-1.5">
                    <ExternalLink width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                    Errores — Sentry
                  </div>
                  {sentryActivo()
                    ? <StatusPill estado="ok">DSN configurado</StatusPill>
                    : <StatusPill estado="bad">Sin DSN — ciego</StatusPill>}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Se enlaza en vez de reconstruirse.</div>
              </a>
              <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer"
                className="hairline rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--canvas)]"
                style={{ background: 'var(--surface)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[13px] font-medium inline-flex items-center gap-1.5">
                    <ExternalLink width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                    Uptime, deploys y latencia de edge — Vercel
                  </div>
                  {/* No hay medición de Vercel desde adentro (si esto renderiza,
                      Vercel contestó): neutral honesto, no verde de adorno. */}
                  <StatusPill estado="neutral">No medido</StatusPill>
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Vercel ya lo mide. Se enlaza en vez de reconstruirse.</div>
              </a>
            </div>
          </div>

          <div className="card p-4">
            <TituloSeccion>Actividad de IA en el tiempo</TituloSeccion>
            <div className="mt-3">
              {r.porDia.length > 1 ? (
                <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={usd} />
              ) : (
                <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                  Sin historial suficiente todavía.
                </div>
              )}
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              Proxy honesto de actividad, no de rendimiento: enseña cuánto gasta la IA día a día, no qué tan rápido responde.
            </p>
          </div>

          <div className="card p-3">
            <TituloSeccion>Rendimiento por llamada</TituloSeccion>
            <div className="mt-2">
              <EstadoVacio icono={<Activity width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Latencia p50/p95/p99 por llamada, tasa de éxito de tool-calls, tasa de escalamiento a humano, tiempo de
                resolución end-to-end, trace viewer paso a paso — ninguno de estos se instrumenta hoy (no hay columna de
                duración en <code className="font-mono text-xs">llm_costo</code> ni un sistema de trazas). Fase 1-4 del roadmap.
              </EstadoVacio>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
