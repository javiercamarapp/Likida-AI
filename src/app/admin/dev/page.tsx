import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { ExternalLink } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getActividadGitHub, getMapaCommits, getAutoresCommits } from '@/lib/admin/github';
import { MapaActividad } from './mapa-actividad';
import { getEventosSeguridad, type FilaSeguridad } from '@/lib/seguridad/eventos';
import { getSLOs, type Slo } from '@/lib/admin/slo';
import { fechaHoraMx } from '@/lib/formato';
import { AvisoGitHub } from '../ui/aviso-github';
import { MarcoPagina, StatusChip, TablaBase, Tarjeta, type ColumnaBase } from '../../ui-v2/componentes';
import { SelectorVista } from '../selector-vista';

export const dynamic = 'force-dynamic';

// Confirmado con `git remote -v` en el repo — no es una URL adivinada.
const REPO_URL = 'https://github.com/javiercamarapp/likida.ai';


const COLUMNAS_SLO: ColumnaBase<Slo>[] = [
  { id: 'nombre', titulo: 'Objetivo', principal: true, celda: (s) => s.nombre },
  { id: 'objetivo', titulo: 'Objetivo declarado', celda: (s) => <span className="text-muted">obj. {s.objetivo}</span> },
  {
    // cumple=null jamás se pinta verde: sin muestra o sin lectura es «sin medir», con su propio tono.
    id: 'medido', titulo: 'Medido', alinear: 'der',
    celda: (s) => (
      <StatusChip tono={s.cumple === true ? 'ok' : s.cumple === false ? 'bad' : 'muted'}>
        <span className="tabular">{s.medido}</span>
      </StatusChip>
    ),
  },
  { id: 'ventana', titulo: 'Ventana', celda: (s) => <span className="etiqueta-mono text-[11px] uppercase text-muted">{s.ventana}</span> },
];

const COLUMNAS_SEGURIDAD: ColumnaBase<FilaSeguridad>[] = [
  {
    id: 'tipo', titulo: 'Evento', principal: true,
    celda: (e) => (
      <>
        <StatusChip tono={e.severidad === 'alta' ? 'bad' : e.severidad === 'media' ? 'warn' : 'neutral'}>{e.tipo.replace(/_/g, ' ')}</StatusChip>
        <span className="ml-2 text-muted">· {e.origen}</span>
        {e.actor && <span className="ml-2 text-muted">· {e.actor}</span>}
      </>
    ),
  },
  { id: 'cuando', titulo: 'Fecha', alinear: 'der', celda: (e) => <span className="tabular text-muted">{fechaHoraMx(e.creadoEn)}</span> },
];

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
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
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
    <MarcoPagina titulo="Desarrollo">
      {/* "Entrar a los otros paneles" — vivía en el Inicio; Javier lo mandó aquí el 17-ago: es herramienta de desarrollo, no de operación. */}
      <SelectorVista tenants={tenants} />

      {/* Falta de configuración (no corregible por código): UN aviso corto con la variable, no tres vacíos largos. */}
      {(mapa.estado === 'sin_token' || actividad.estado === 'sin_token') && <AvisoGitHub causa="sin_token" />}
      {mapa.estado !== 'sin_token' && actividad.estado !== 'sin_token' && (mapa.estado === 'error' || actividad.estado === 'error') && <AvisoGitHub causa="error" />}

      {/* ── El mapa de puntos: 26 semanas de pushes, un punto por día. La intensidad es commits/día; GitHub lo precalcula y a veces
            contesta "generando" — se dice. Refresca en cada carga (force-dynamic). ── */}
      <Tarjeta titulo="Mapa de actividad — pushes por día">
        {mapa.estado === 'sin_token' && (
          <p className="m-0 text-xs text-muted">Sin el acceso a GitHub no hay mapa — no es que no haya pushes.</p>
        )}
        {mapa.estado === 'error' && (
          <p className="m-0 text-xs text-muted">GitHub no contestó el histograma — recarga en un momento.</p>
        )}
        {mapa.estado === 'generando' && (
          <p className="m-0 text-xs text-muted">GitHub está recalculando el histograma tras el último push — recarga en unos segundos.</p>
        )}
        {mapa.estado === 'ok' && (
          <div className="flex items-start gap-5">
            <div className="min-w-0 flex-1">
              <MapaActividad semanas={mapa.semanas.slice(-26)} total={mapa.total} />
            </div>
            {/* Por integrante (orden del 17-ago): quién empujó cuánto — 52 semanas de /stats/contributors, mismos tres estados
                honestos que el histograma. */}
            <div className="w-44 shrink-0">
              <p className="etiqueta-mono m-0 mb-1.5 text-[11px] uppercase text-muted">Por integrante</p>
              {autores.estado === 'ok' && autores.autores.map((a) => (
                <div key={a.nombre} className="flex items-center justify-between py-0.5">
                  <span className="truncate text-xs text-[var(--ink2)]">{a.nombre}</span>
                  <span className="tabular text-xs font-medium">{a.pushes}</span>
                </div>
              ))}
              {autores.estado === 'generando' && (
                <p className="m-0 text-xs text-muted">GitHub lo está recalculando…</p>
              )}
              {(autores.estado === 'error' || autores.estado === 'sin_token') && (
                <p className="m-0 text-xs text-muted">No se pudo leer — no es que nadie haya empujado.</p>
              )}
            </div>
          </div>
        )}
      </Tarjeta>

      {/* ── SLOs (fase 7): objetivos DECLARADOS contra datos reales. cumple=null jamás se pinta verde — sin muestra o sin lectura se
            dice con esas palabras. ── */}
      <Tarjeta titulo="SLOs — objetivos contra lo medido">
        {slos === null && (
          <p className="m-0 text-xs text-muted">No se pudieron leer los SLOs.</p>
        )}
        {slos !== null && (
          <TablaBase
            etiqueta="SLOs — objetivos contra lo medido"
            columnas={COLUMNAS_SLO}
            filas={slos}
            idFila={(s) => s.clave}
            altoMaximo={false}
          />
        )}
      </Tarjeta>

      {/* ── Trust & Safety (0133): lo que los detectores atraparon. Firma inválida, intents rechazados, cifras sin respaldo — la
            memoria de seguridad consultable, no solo logs. ── */}
      <Tarjeta titulo="Eventos de seguridad">
        {seguridad === null && (
          <p className="m-0 text-xs text-muted">
            No se pudieron leer — que no es lo mismo que «no hay eventos».
          </p>
        )}
        {seguridad !== null && seguridad.length === 0 && (
          <p className="m-0 text-xs text-muted">
            Sin eventos registrados. Eso NO prueba que no haya pasado nada: solo cubre lo que las fuentes emiten (la cobertura exacta está en Trust &amp; Safety).
          </p>
        )}
        {seguridad !== null && seguridad.length > 0 && (
          <TablaBase
            etiqueta="Eventos de seguridad recientes"
            columnas={COLUMNAS_SEGURIDAD}
            filas={seguridad}
            idFila={(e) => String(e.id)}
            altoMaximo={false}
            densa
          />
        )}
      </Tarjeta>

      {/* ── Actividad en vivo (17-ago): commits y CI reales, cada carga. Tres estados honestos — sin llave / API caída / datos. ── */}
      <Tarjeta titulo="Actividad del código — en vivo">
        {actividad.estado === 'sin_token' && (
          <p className="m-0 text-xs text-muted">Sin el acceso a GitHub esta sección no puede ver el repo — no es que no haya actividad.</p>
        )}
        {actividad.estado === 'error' && (
          <p className="m-0 text-xs text-muted">GitHub no contestó — no se sabe qué hay (que no es lo mismo que nada).</p>
        )}
        {actividad.estado === 'ok' && (
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <p className="m-0 mb-1.5 text-xs font-medium text-muted">Últimos commits</p>
              <ul className="m-0 list-none space-y-1 p-0">
                {actividad.commits.map((c) => (
                  <li key={c.sha} className="flex items-center gap-2 text-xs">
                    <code className="shrink-0 text-[11px] text-muted">{c.sha}</code>
                    <a href={c.url} target="_blank" rel="noreferrer" className="truncate hover:opacity-70">{c.mensaje}</a>
                    <span className="shrink-0 text-[11px] text-muted">{fechaHoraMx(c.fecha)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="m-0 mb-1.5 text-xs font-medium text-muted">CI — últimas corridas</p>
              <ul className="m-0 list-none space-y-1 p-0">
                {actividad.ci.map((w, i) => (
                  <li key={`${w.url}-${i}`} className="flex items-center gap-2 text-xs">
                    <StatusChip tono={w.conclusion === 'success' ? 'ok' : w.conclusion === 'failure' ? 'bad' : 'neutral'}>
                      {w.conclusion ?? w.estado}
                    </StatusChip>
                    <a href={w.url} target="_blank" rel="noreferrer" className="truncate hover:opacity-70">{w.nombre}</a>
                    <span className="shrink-0 text-[11px] text-muted">{w.rama}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo="Repositorio">
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 transition-colors hover:bg-[var(--canvas)]">
          <ExternalLink width={15} height={15} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">Código — GitHub</span>
            <span className="block text-xs text-muted">javiercamarapp/likida.ai. Se enlaza en vez de reconstruirse.</span>
          </span>
        </a>
      </Tarjeta>

      <Tarjeta titulo="Lo que falta">
        <p className="m-0 text-xs text-muted">
          Calendario de contribuciones, deploys de Vercel con estado de build, feature flags,
          tiempo de merge/cobertura/error budget y changelog — lo de GitHub ya entra en vivo arriba (17-ago);
          lo de Vercel sigue sin integración. Vercel y Sentry ya están enlazados desde Inicio/Observabilidad.
        </p>
      </Tarjeta>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Desarrollo' };
