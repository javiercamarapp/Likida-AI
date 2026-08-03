import { Activity, ExternalLink } from 'lucide-react';
import { Semaphore, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Salud del sistema / SRE — versión dedicada y más completa de la sección
 * "Salud del sistema" de Inicio (admin/page.tsx). Mismos dos link-cards
 * reales (Sentry, Vercel) más un tercero igual de real: el dashboard de
 * Supabase, la herramienta que hoy se usa de verdad para ver el estado de
 * la base. Nada de esto llama APIs en vivo desde aquí — son enlaces a
 * dashboards que YA miden esto, no una reconstrucción a medias de esas
 * herramientas dentro de /admin. El "Ya conectado" ahora lo carga el
 * `<Semaphore estado="ok">` (design system v2) en vez de repetirse a mano
 * en cada `detalle` — el resto de cada frase sigue intacto.
 */
const INTEGRACIONES = [
  {
    href: 'https://sentry.io',
    titulo: 'Errores — Sentry',
    detalle: 'Excepciones, stack traces y frecuencia por release.',
  },
  {
    href: 'https://vercel.com/dashboard',
    titulo: 'Uptime y deploys — Vercel',
    detalle: 'Historial de deploys, logs de build y runtime, analítica de tráfico.',
  },
  {
    href: 'https://supabase.com/dashboard',
    titulo: 'Base de datos — Supabase',
    detalle: 'Herramienta real que ya se usa para operar la base: salud de la instancia, uso de recursos, logs de queries.',
  },
];

export default function SaludSistemaPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Activity width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Salud del sistema</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>SRE — errores, uptime, deploys y base de datos</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {INTEGRACIONES.map((i) => (
              <a key={i.href} href={i.href} target="_blank" rel="noopener noreferrer"
                className="card p-4 hover:shadow-md transition-shadow flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{i.titulo}</span>
                  <ExternalLink width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} className="shrink-0" />
                </div>
                <Semaphore estado="ok" etiqueta="Conectado" />
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{i.detalle}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            Estado de integraciones en semáforo dentro de este panel (sin llamar sus APIs en vivo), timeline de
            incidentes, on-call, consumo vs. rate limits agregado — no está instrumentado aquí hoy; Sentry y
            Vercel ya miden esto en sus propios dashboards, enlazados arriba.
          </EstadoVacio>
        </section>
      </div>
    </div>
  );
}
