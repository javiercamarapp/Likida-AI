import { Code2, ExternalLink } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';

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
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Code2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Dev"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="card p-3">
            <TituloSeccion>Repositorio</TituloSeccion>
            <div className="mt-2">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer"
                className="hairline rounded-lg px-3 py-2.5 flex items-center gap-2.5 transition-colors hover:bg-[var(--canvas)]"
                style={{ background: 'var(--surface)' }}>
                <ExternalLink width={15} height={15} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--muted)' }} />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">Código — GitHub</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>javiercamarapp/likida.ai. Se enlaza en vez de reconstruirse.</div>
                </div>
              </a>
            </div>
          </div>

          <div className="card p-3">
            <TituloSeccion>Lo que falta</TituloSeccion>
            <div className="mt-2">
              <EstadoVacio icono={<Code2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Calendario de contribuciones, deploys recientes con estado de build, feature flags & kill switches,
                PRs abiertos/tiempo de merge/cobertura/error budget, changelog — este panel no tiene integración con la
                API de GitHub ni con la de Vercel para traer esto en vivo hoy. Vercel y Sentry ya están enlazados desde
                Inicio/Observabilidad.
              </EstadoVacio>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
