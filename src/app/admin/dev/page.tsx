import { Code2, ExternalLink } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getActividadGitHub, getMapaCommits, getAutoresCommits } from '@/lib/admin/github';
import { MapaActividad } from './mapa-actividad';
import { getEventosSeguridad, type FilaSeguridad } from '@/lib/seguridad/eventos';
import { getSLOs, type Slo } from '@/lib/admin/slo';
import { fechaHoraMx } from '@/lib/formato';
import { EstadoVacio, StatusPill } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { SelectorVista } from '../selector-vista';

export const dynamic = 'force-dynamic';

// Confirmado con `git remote -v` en el repo — no es una URL adivinada.
const REPO_URL = 'https://github.com/javiercamarapp/likida.ai';

/**
 * Dev — `requireSuperadmin()` ya lo hizo el layout.
 *
 * ADM-12 (auditoría 24, menor): este comentario decía "no existe
 * integración con la API de GitHub" — falso desde que `lib/admin/github.ts`
 * llegó: el mapa de actividad (pushes por día), los autores y los SLOs de
 * abajo SÍ jalan en vivo con `GITHUB_TOKEN`. Lo que de verdad NO existe es
 * Vercel (deploys, feature flags) — no hay integración con esa API, y por
 * eso el link directo al repositorio sigue siendo el único atajo para eso.
 */
export default async function DevPage() {
  // El selector de vistas necesita saber si HAY flotas (con cero, sus ligas
  // rebotarían a paneles vacíos y lo dice). Conteo directo y barato — la
  // tabla `tenant` no tiene tenant_id: es la lista de tenants misma.
  // T&S (0133): errors-by-value hecho a mano — null = no se pudo leer, y la
  // tarjeta lo dice (cero eventos ≠ ciego).
  const seguridadP: Promise<FilaSeguridad[] | null> = getEventosSeguridad(12).catch(() => null);
  const slosP: Promise<Slo[] | null> = getSLOs().catch(() => null);
  const [conteoTenants, actividad, mapa, autores, seguridad, slos] = await Promise.all([
    supabaseAdmin().from('tenant').select('id', { count: 'exact', head: true }),
    getActividadGitHub(),
    getMapaCommits(),
    getAutoresCommits(),
    seguridadP,
    slosP,
  ]);
  // FE-24: esto era `count ?? 0`, y `count` llega `null` cuando la CONSULTA
  // FALLA — supabase-js reporta por valor. Con la base caída, la pantalla
  // afirmaba "No hay ninguna flota dada de alta" e invitaba a crear una que
  // quizá ya existe. `null` viaja como `null` y el selector lo dice.
  const tenants = conteoTenants.error ? null : conteoTenants.count ?? 0;
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
              {mapa.estado === 'ok' && (
                <div className="flex gap-5 items-start">
                  <div className="min-w-0 flex-1">
                    <MapaActividad semanas={mapa.semanas.slice(-26)} total={mapa.total} />
                  </div>
                  {/* Por integrante (orden del 17-ago): quién empujó cuánto —
                      52 semanas de /stats/contributors, mismos tres estados
                      honestos que el histograma. */}
                  <div className="w-44 shrink-0">
                    <p className="etiqueta-mono text-[10px] uppercase mb-1.5" style={{ color: 'var(--muted)' }}>Por integrante</p>
                    {autores.estado === 'ok' && autores.autores.map((a) => (
                      <div key={a.nombre} className="flex items-center justify-between py-0.5">
                        <span className="text-[12px] truncate" style={{ color: 'var(--ink2)' }}>{a.nombre}</span>
                        <span className="text-[12px] tabular font-medium" style={{ color: 'var(--ink)' }}>{a.pushes}</span>
                      </div>
                    ))}
                    {autores.estado === 'generando' && (
                      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>GitHub lo está recalculando…</p>
                    )}
                    {(autores.estado === 'error' || autores.estado === 'sin_token') && (
                      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>No se pudo leer — no es que nadie haya empujado.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── SLOs (fase 7): objetivos DECLARADOS contra datos reales.
                cumple=null jamás se pinta verde — sin muestra o sin lectura
                se dice con esas palabras. ── */}
          <div className="card p-3">
            <TituloSeccion>SLOs — objetivos contra lo medido</TituloSeccion>
            <div className="mt-2">
              {slos === null && (
                <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No se pudieron leer los SLOs.</p>
              )}
              {slos !== null && slos.map((s) => (
                <div key={s.clave} className="flex items-center gap-2.5 py-1.5 text-[12.5px]" style={{ borderBottom: '1px solid var(--line)' }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{
                    background: s.cumple === true ? 'var(--ok)' : s.cumple === false ? 'var(--bad)' : 'var(--muted)',
                  }} />
                  <span className="min-w-0 flex-1" style={{ color: 'var(--ink)' }}>{s.nombre}</span>
                  <span className="shrink-0" style={{ color: 'var(--muted)' }}>obj. {s.objetivo}</span>
                  <span className="shrink-0 tabular font-medium" style={{ color: s.cumple === false ? 'var(--bad)' : 'var(--ink)' }}>{s.medido}</span>
                  <span className="etiqueta-mono text-[10px] uppercase shrink-0" style={{ color: 'var(--faint)' }}>{s.ventana}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Trust & Safety (0133): lo que los detectores atraparon.
                Firma inválida, intents rechazados, cifras sin respaldo —
                la memoria de seguridad consultable, no solo logs. ── */}
          <div className="card p-3">
            <TituloSeccion>Eventos de seguridad</TituloSeccion>
            <div className="mt-2">
              {seguridad === null && (
                <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  No se pudieron leer — que no es lo mismo que «no hay eventos».
                </p>
              )}
              {seguridad !== null && seguridad.length === 0 && (
                <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  Sin eventos registrados. Los detectores están cableados (firmas, intents, guardia de cifras) — el silencio aquí es bueno de verdad.
                </p>
              )}
              {seguridad !== null && seguridad.map((e) => (
                <div key={e.id} className="flex items-center gap-2 py-1 text-[12px]" style={{ borderBottom: '1px solid var(--line)' }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: e.severidad === 'alta' ? 'var(--bad)' : e.severidad === 'media' ? 'var(--warn, #d97706)' : 'var(--muted)' }} />
                  <span className="font-medium" style={{ color: 'var(--ink)' }}>{e.tipo.replace(/_/g, ' ')}</span>
                  <span style={{ color: 'var(--muted)' }}>· {e.origen}</span>
                  {e.actor && <span className="truncate" style={{ color: 'var(--faint)' }}>· {e.actor}</span>}
                  <span className="ml-auto tabular shrink-0" style={{ color: 'var(--muted)' }}>{fechaHoraMx(e.creadoEn)}</span>
                </div>
              ))}
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
