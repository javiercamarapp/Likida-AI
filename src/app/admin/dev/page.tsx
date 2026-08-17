import { Code2, ExternalLink } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getActividadGitHub, getMapaCommits } from '@/lib/admin/github';
import { fechaHoraMx } from '@/lib/formato';
import { EstadoVacio, StatusPill } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { SelectorVista } from '../selector-vista';

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
export default async function DevPage() {
  // El selector de vistas necesita saber si HAY flotas (con cero, sus ligas
  // rebotarían a paneles vacíos y lo dice). Conteo directo y barato — la
  // tabla `tenant` no tiene tenant_id: es la lista de tenants misma.
  const [{ count }, actividad, mapa] = await Promise.all([
    supabaseAdmin().from('tenant').select('id', { count: 'exact', head: true }),
    getActividadGitHub(),
    getMapaCommits(),
  ]);
  const tenants = count ?? 0;
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Code2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Dev"
        />

        {/* "Entrar a los otros paneles" — vivía en el Inicio; Javier lo mandó
            aquí el 17-ago: es herramienta de desarrollo, no de operación. */}
        <SelectorVista tenants={tenants} />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {/* ── El mapa de puntos: 26 semanas de pushes, un punto por día.
                La intensidad es commits/día; GitHub lo precalcula y a veces
                contesta "generando" — se dice. Refresca en cada carga
                (force-dynamic). ── */}
          <div className="card p-3">
            <TituloSeccion>Mapa de actividad — pushes por día</TituloSeccion>
            <div className="mt-2">
              {mapa.estado === 'sin_token' && (
                <EstadoVacio icono={<Code2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Sin <code>GITHUB_TOKEN</code> no hay mapa — no es que no haya pushes.
                </EstadoVacio>
              )}
              {mapa.estado === 'error' && (
                <EstadoVacio icono={<Code2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  GitHub no contestó el histograma — recarga en un momento.
                </EstadoVacio>
              )}
              {mapa.estado === 'generando' && (
                <EstadoVacio icono={<Code2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  GitHub está recalculando el histograma tras el último push — recarga en unos segundos.
                </EstadoVacio>
              )}
              {mapa.estado === 'ok' && (() => {
                const semanas = mapa.semanas.slice(-26);
                const tope = Math.max(1, ...semanas.flatMap((s) => s.dias));
                return (
                  <div>
                    <div className="flex gap-[3px] overflow-x-auto pb-1">
                      {semanas.map((sem) => (
                        <div key={sem.inicio} className="flex flex-col gap-[3px]">
                          {sem.dias.map((n, di) => (
                            <span key={di} title={`${n} commit${n === 1 ? '' : 's'} · ${fechaHoraMx(new Date(sem.inicio + di * 86_400_000).toISOString()).split(',')[0]}`}
                              className="w-[11px] h-[11px] rounded-[3px]"
                              style={{
                                background: n === 0
                                  ? 'color-mix(in srgb, var(--muted) 14%, transparent)'
                                  : `color-mix(in srgb, var(--marca) ${Math.round(25 + (n / tope) * 75)}%, transparent)`,
                              }} />
                          ))}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
                      {mapa.total} commits en 52 semanas (se enseñan 26) · un punto = un día · más tinta, más pushes.
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Actividad en vivo (17-ago): commits y CI reales, cada carga.
                Tres estados honestos — sin llave / API caída / datos. ── */}
          <div className="card p-3">
            <TituloSeccion>Actividad del código — en vivo</TituloSeccion>
            <div className="mt-2">
              {actividad.estado === 'sin_token' && (
                <EstadoVacio icono={<Code2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Sin la llave <code>GITHUB_TOKEN</code> esta sección no puede ver el repo — no es que no haya actividad.
                </EstadoVacio>
              )}
              {actividad.estado === 'error' && (
                <EstadoVacio icono={<Code2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  GitHub no contestó — no se sabe qué hay (que no es lo mismo que nada).
                </EstadoVacio>
              )}
              {actividad.estado === 'ok' && (
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>Últimos commits</p>
                    <ul className="space-y-1">
                      {actividad.commits.map((c) => (
                        <li key={c.sha} className="text-[12px] flex items-center gap-2">
                          <code className="shrink-0 text-[11px]" style={{ color: 'var(--muted)' }}>{c.sha}</code>
                          <a href={c.url} target="_blank" rel="noreferrer" className="truncate hover:opacity-70">{c.mensaje}</a>
                          <span className="shrink-0 text-[11px]" style={{ color: 'var(--muted)' }}>{fechaHoraMx(c.fecha)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>CI — últimas corridas</p>
                    <ul className="space-y-1">
                      {actividad.ci.map((w, i) => (
                        <li key={`${w.url}-${i}`} className="text-[12px] flex items-center gap-2">
                          <StatusPill estado={w.conclusion === 'success' ? 'ok' : w.conclusion === 'failure' ? 'bad' : 'neutral'}>
                            {w.conclusion ?? w.estado}
                          </StatusPill>
                          <a href={w.url} target="_blank" rel="noreferrer" className="truncate hover:opacity-70">{w.nombre}</a>
                          <span className="shrink-0 text-[11px]" style={{ color: 'var(--muted)' }}>{w.rama}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>

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
                Calendario de contribuciones, deploys de Vercel con estado de build, feature flags,
                tiempo de merge/cobertura/error budget y changelog — lo de GitHub ya entra en vivo arriba (17-ago);
                lo de Vercel sigue sin integración. Vercel y Sentry ya están enlazados desde
                Inicio/Observabilidad.
              </EstadoVacio>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
