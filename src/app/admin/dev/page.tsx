import { Code2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

// Confirmado con `git remote -v` en el repo — no es una URL adivinada.
const REPO_URL = 'https://github.com/javiercamarapp/likida.ai';

/**
 * Dev — `requireSuperadmin()` ya lo hizo el layout, esta página no trae
 * datos porque no hay ninguno real que traer: no existe integración con la
 * API de GitHub ni con la de Vercel para jalar en vivo el calendario de
 * contribuciones, deploys, feature flags o PRs. Lo único real y barato que
 * SÍ se puede ofrecer es el link directo al repositorio (mismo patrón que
 * "Salud del sistema" en Inicio: se enlaza, no se reconstruye).
 */
export default function DevPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Code2 width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Dev</span>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Repositorio
          </h2>
          <div className="mt-3">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="card p-4 block hover:shadow-md transition-shadow">
              <div className="text-sm font-medium">Código — GitHub</div>
              <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>javiercamarapp/likida.ai. Se enlaza en vez de reconstruirse.</div>
            </a>
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Lo que falta
          </h2>
          <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>
            Calendario de contribuciones, deploys recientes con estado de build, feature flags & kill switches,
            PRs abiertos/tiempo de merge/cobertura/error budget, changelog — este panel no tiene integración con la
            API de GitHub ni con la de Vercel para traer esto en vivo hoy. Vercel y Sentry ya están enlazados desde
            Inicio/Observabilidad.
          </p>
        </section>
      </div>
    </div>
  );
}
