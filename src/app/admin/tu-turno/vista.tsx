import Link from 'next/link';
import {
  Hand, Play, Power, PowerOff, GitPullRequest, Inbox, ListChecks,
  Image as ImageIcon, Bot, StickyNote,
} from 'lucide-react';
// SOLO tipos: lib/admin/bus importa supabaseAdmin y no debe entrar al bundle.
import type { EstadoBus, ResultadoPrs } from '@/lib/admin/bus';
import type { BandejaEscalaciones } from '@/lib/admin/escalaciones';
import type { PiezaEnCola } from '@/lib/likida/agentes/cola';
import { fechaHoraMx } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { EstadoVacio, StatusPill } from '../ui/kit';

const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

/** "hace 3 h" — mismo formato que la bandeja de escalaciones. */
function edadDe(desdeIso: string, ahora: number): string {
  const horas = (ahora - new Date(desdeIso).getTime()) / 3_600_000;
  if (Number.isNaN(horas)) return '—';
  if (horas < 1) return 'hace menos de 1 h';
  if (horas < 48) return `hace ${Math.floor(horas)} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

const NOMBRE_ORDEN: Record<string, string> = {
  correr_ahora: 'correr ahora',
  kill_switch_on: 'apagar todas',
  kill_switch_off: 'encender todas',
  editar_encargo: 'editar encargo',
  nota: 'nota',
};

export type AccionForm = (fd: FormData) => Promise<void>;

/**
 * La VISTA de "Tu turno" — todo el cuerpo de la bandeja, sin auth ni fetch
 * (eso vive en page.tsx). Server component a propósito: los formularios usan
 * server actions que llegan por props, patrón de agentes/peajes.
 */
export function VistaTuTurno({
  bus, escalaciones, envios, prs, ahora, aviso, error, sesionNombre,
  accionPieza, accionOrden,
}: {
  bus: EstadoBus;
  escalaciones: BandejaEscalaciones;
  envios: PiezaEnCola[];
  prs: ResultadoPrs;
  ahora: number;
  aviso?: string;
  error?: string;
  sesionNombre: string;
  accionPieza: AccionForm;
  accionOrden: AccionForm;
}) {
  const totalEscalaciones = escalaciones.cola.length;

  return (
    <div className="space-y-8">
      <BarraPagina icono={<Hand {...ICONO} />} titulo="Tu turno" />

      {aviso && (
        <p className="text-sm rounded-xl px-4 py-2.5" style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }}>
          {aviso}
        </p>
      )}
      {error && (
        <p className="text-sm rounded-xl px-4 py-2.5" style={{ background: 'color-mix(in srgb, #b91c1c 10%, transparent)', color: '#b91c1c' }}>
          {error}
        </p>
      )}
      {bus.errores.length > 0 && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Fuentes que no se pudieron leer (no son ceros): {bus.errores.join(' · ')}
        </p>
      )}

      {/* ── 1 · Piezas de las rutinas — el tap de publicar ────────────────── */}
      <section>
        <TituloSeccion>Piezas para tu tap ({bus.piezasPendientes.length})</TituloSeccion>
        {bus.piezasPendientes.length === 0 ? (
          <EstadoVacio icono={<ImageIcon {...ICONO} />}>
            No hay piezas esperando. Las rutinas de la Mac las suben aquí al terminar
            (si la Mac aún no corre el bus, instala <code>bus.sh</code> — ver el esqueleto de autonomía).
          </EstadoVacio>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bus.piezasPendientes.map((p) => (
              <article key={p.id} className="rounded-2xl hairline overflow-hidden flex flex-col" style={{ background: 'var(--card, transparent)' }}>
                {p.mediaUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- URL firmada de storage, dominio propio
                  <img src={p.mediaUrl} alt={p.titulo} className="w-full aspect-video object-cover" />
                )}
                <div className="p-4 flex-1 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                    <StatusPill estado="neutral">{p.tipo}</StatusPill>
                    <span>{p.rutina}</span>
                    <span className="ml-auto">{edadDe(p.creadoEn, ahora)}</span>
                  </div>
                  <h3 className="font-medium text-sm leading-snug">{p.titulo}</h3>
                  {p.copyMd && (
                    <details className="text-xs" style={{ color: 'var(--muted)' }}>
                      <summary className="cursor-pointer">Ver el copy</summary>
                      <pre className="mt-2 whitespace-pre-wrap font-sans">{p.copyMd}</pre>
                    </details>
                  )}
                  <div className="mt-auto flex gap-2 pt-2">
                    <form action={accionPieza}>
                      <input type="hidden" name="pieza" value={p.id} />
                      <input type="hidden" name="accion" value="aprobada" />
                      <button className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                        Aprobar
                      </button>
                    </form>
                    <form action={accionPieza}>
                      <input type="hidden" name="pieza" value={p.id} />
                      <input type="hidden" name="accion" value="descartada" />
                      <button className="px-3 py-1.5 rounded-lg text-xs hairline" style={{ color: 'var(--muted)' }}>
                        Descartar
                      </button>
                    </form>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── 2 · Envíos redactados (0117) — dinero directo, se resuelven allá ─ */}
      <section>
        <TituloSeccion>Envíos por aprobar ({envios.length})</TituloSeccion>
        {envios.length === 0 ? (
          <EstadoVacio icono={<ListChecks {...ICONO} />}>Nada redactado esperando tu firma.</EstadoVacio>
        ) : (
          <ul className="space-y-1.5">
            {envios.slice(0, 5).map((p) => (
              <li key={p.id} className="text-sm flex items-center gap-2">
                <StatusPill estado={p.prioridad === 'urgente' ? 'warn' : 'neutral'}>{p.prioridad}</StatusPill>
                <span className="truncate">{p.titulo}</span>
                <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                  {p.prospectoEmpresa ?? p.agente}
                </span>
              </li>
            ))}
            <li className="pt-1">
              <Link href="/admin/aprobaciones" className="text-sm font-medium hover:opacity-70" style={{ color: 'var(--accent)' }}>
                Revisar y aprobar en la cola →
              </Link>
            </li>
          </ul>
        )}
      </section>

      {/* ── 3 · PRs — la aprobación de CÓDIGO es el merge, no un botón aquí ── */}
      <section>
        <TituloSeccion>PRs esperando tu merge</TituloSeccion>
        {prs.estado === 'sin_token' && (
          <EstadoVacio icono={<GitPullRequest {...ICONO} />}>
            Sin la llave <code>GITHUB_TOKEN</code> en Vercel esta sección no puede ver los PRs
            — es una de tus llaves pendientes, no un cero.
          </EstadoVacio>
        )}
        {prs.estado === 'error' && (
          <EstadoVacio icono={<GitPullRequest {...ICONO} />}>
            GitHub no contestó — no se sabe cuántos PRs esperan (que no es lo mismo que ninguno).
          </EstadoVacio>
        )}
        {prs.estado === 'ok' && (prs.prs.length === 0 ? (
          <EstadoVacio icono={<GitPullRequest {...ICONO} />}>No hay PRs abiertos.</EstadoVacio>
        ) : (
          <ul className="space-y-1.5">
            {prs.prs.map((pr) => (
              <li key={pr.numero} className="text-sm flex items-center gap-2">
                <GitPullRequest {...ICONO} style={{ color: 'var(--muted)' }} />
                <a href={pr.url} target="_blank" rel="noreferrer" className="truncate hover:opacity-70">
                  #{pr.numero} · {pr.titulo}
                </a>
                <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>{edadDe(pr.creadoEn, ahora)}</span>
              </li>
            ))}
          </ul>
        ))}
      </section>

      {/* ── 4 · Escalaciones — el top; la cola completa vive en su pantalla ── */}
      <section>
        <TituloSeccion>Escalaciones ({totalEscalaciones})</TituloSeccion>
        {totalEscalaciones === 0 ? (
          <EstadoVacio icono={<Inbox {...ICONO} />}>Nada escalado a un humano ahora mismo.</EstadoVacio>
        ) : (
          <ul className="space-y-1.5">
            {escalaciones.cola.slice(0, 5).map((it, i) => (
              <li key={`${it.fuente}-${i}`} className="text-sm flex items-center gap-2">
                <StatusPill estado={it.vence && new Date(it.vence).getTime() < ahora ? 'bad' : 'neutral'}>{it.fuente}</StatusPill>
                {it.href ? (
                  <Link href={it.href} className="truncate hover:opacity-70">{it.titulo}</Link>
                ) : (
                  <span className="truncate">{it.titulo}</span>
                )}
                <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>{edadDe(it.desde, ahora)}</span>
              </li>
            ))}
            <li className="pt-1">
              <Link href="/admin/escalaciones" className="text-sm font-medium hover:opacity-70" style={{ color: 'var(--accent)' }}>
                La cola completa →
              </Link>
            </li>
          </ul>
        )}
      </section>

      {/* ── 5 · Las rutinas de la Mac — estado y mando ───────────────────── */}
      <section>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TituloSeccion>Rutinas de la Mac ({bus.rutinas.length})</TituloSeccion>
          <div className="flex gap-2">
            <form action={accionOrden}>
              <input type="hidden" name="tipo" value="kill_switch_on" />
              <button className="px-3 py-1.5 rounded-lg text-xs hairline flex items-center gap-1.5" style={{ color: '#b91c1c' }}>
                <PowerOff {...ICONO} /> Apagar todas
              </button>
            </form>
            <form action={accionOrden}>
              <input type="hidden" name="tipo" value="kill_switch_off" />
              <button className="px-3 py-1.5 rounded-lg text-xs hairline flex items-center gap-1.5">
                <Power {...ICONO} /> Encender todas
              </button>
            </form>
          </div>
        </div>
        {bus.killSwitchPendiente && (
          <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
            Hay una orden de apagado/encendido esperando el latido de la Mac.
          </p>
        )}
        {bus.rutinas.length === 0 ? (
          <EstadoVacio icono={<Bot {...ICONO} />}>
            La Mac aún no siembra el catálogo — corre <code>bus.sh sembrar-catalogo</code> una vez.
          </EstadoVacio>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: 'var(--muted)' }}>
                  <th className="py-1.5 pr-3 font-medium">Rutina</th>
                  <th className="py-1.5 pr-3 font-medium">Horario</th>
                  <th className="py-1.5 pr-3 font-medium">Última corrida</th>
                  <th className="py-1.5 pr-3 font-medium">Veredicto</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {bus.rutinas.map((r) => (
                  <tr key={r.nombre} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">{r.nombre}</td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>{r.horario || '—'}</td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                      {r.ultimaCorrida ? fechaHoraMx(r.ultimaCorrida.inicio) : 'sin corridas en el bus'}
                    </td>
                    <td className="py-2 pr-3 text-xs max-w-[26rem]">
                      {r.ultimaCorrida ? (
                        <span className="flex items-center gap-1.5">
                          {r.ultimaCorrida.exitCode !== null && (
                            <StatusPill estado={r.ultimaCorrida.exitCode === 0 ? 'ok' : 'bad'}>
                              {r.ultimaCorrida.exitCode === 0 ? 'ok' : `exit ${r.ultimaCorrida.exitCode}`}
                            </StatusPill>
                          )}
                          <span className="truncate">{r.ultimaCorrida.veredicto ?? '—'}</span>
                          {r.ultimaCorrida.prUrl && (
                            <a href={r.ultimaCorrida.prUrl} target="_blank" rel="noreferrer" className="shrink-0 hover:opacity-70" style={{ color: 'var(--accent)' }}>PR</a>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <form action={accionOrden}>
                          <input type="hidden" name="tipo" value="correr_ahora" />
                          <input type="hidden" name="rutina" value={r.nombre} />
                          <button className="px-2.5 py-1 rounded-lg text-xs hairline inline-flex items-center gap-1.5 hover:opacity-70">
                            <Play {...ICONO} /> Correr ahora
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* ── EL EDITOR DE RUTINAS (Fase D, cerrado 17-ago-2026) ────────
                  El encargo se edita AQUÍ y viaja como orden editar_encargo:
                  la Mac abre un PR chico con el cambio — jamás escritura
                  directa. Solo rutinas con encargo sembrado se pueden editar
                  (sin el texto original no hay qué pre-llenar ni qué PR). */}
            <div className="mt-3 space-y-1.5">
              {bus.rutinas.filter((r) => r.encargoMd).map((r) => (
                <details key={`ed-${r.nombre}`} className="rounded-xl hairline px-3 py-2" style={{ background: 'var(--surface)' }}>
                  <summary className="text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
                    Editar encargo · <span className="font-medium" style={{ color: 'var(--ink)' }}>{r.nombre}</span>
                  </summary>
                  <form action={accionOrden} className="mt-2 space-y-2">
                    <input type="hidden" name="tipo" value="editar_encargo" />
                    <input type="hidden" name="rutina" value={r.nombre} />
                    <textarea name="contenido" defaultValue={r.encargoMd} required maxLength={20000} rows={12}
                      className="w-full text-[12px] leading-relaxed px-3 py-2 rounded-lg hairline cifra-mono"
                      style={{ background: 'var(--canvas)', resize: 'vertical' }} />
                    <div className="flex items-center gap-3">
                      <button className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                        Encolar el cambio (la Mac abre el PR)
                      </button>
                      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                        Nada se escribe directo: apruebas el PR en GitHub y el sembrado nocturno actualiza el catálogo.
                      </p>
                    </div>
                  </form>
                </details>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── 6 · Órdenes recientes — el acuse de la Mac ───────────────────── */}
      <section>
        <TituloSeccion>Órdenes recientes</TituloSeccion>
        {bus.ordenesRecientes.length === 0 ? (
          <EstadoVacio icono={<StickyNote {...ICONO} />}>Aún no has ordenado nada por el bus.</EstadoVacio>
        ) : (
          <ul className="space-y-1.5">
            {bus.ordenesRecientes.map((o) => (
              <li key={o.id} className="text-sm flex items-center gap-2">
                <StatusPill estado={o.estado === 'hecha' ? 'ok' : o.estado === 'fallida' ? 'bad' : 'neutral'}>
                  {o.estado}
                </StatusPill>
                <span>{NOMBRE_ORDEN[o.tipo] ?? o.tipo}{o.rutina ? ` · ${o.rutina}` : ''}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{edadDe(o.creadoEn, ahora)}</span>
                {o.resultado && <span className="text-xs truncate" style={{ color: 'var(--muted)' }}>— {o.resultado}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Sesión: {sesionNombre} · Las órdenes las ejecuta la Mac en su latido (≤5 min) y firma el
        resultado aquí. Esta pantalla nunca toca la Mac directo.
      </p>
    </div>
  );
}
