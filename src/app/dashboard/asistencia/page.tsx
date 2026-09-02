import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { RadioTower, Camera, TriangleAlert } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import {
  listarMesaAsistencia, tomarControlMesa, resolverDesdeMesa, reescalarDesdeMesa,
  ROTULO_EVENTO, type IncidenciaMesa,
} from '@/lib/likida/mesa_control';
import { NIVEL_MAXIMO } from '@/lib/likida/asistencia_escalamiento';
import { fechaHoraMx } from '../formato';
import { logger } from '@/lib/logger';
import { FormaConAviso, Campo, type ResultadoAccion } from '../../admin/ui/forma';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/asistencia';

/**
 * MESA DE CONTROL (Capa F del agente de ayuda en ruta).
 *
 * El agente escribe el expediente y propone; aquí el humano DECIDE. La
 * pantalla enseña las incidencias de asistencia vivas — crítica arriba, la
 * más vieja primero — con el timeline completo de cada una (la bitácora
 * `incidencia_evento`: qué pasó, cuándo, por qué canal) y tres
 * intervenciones: tomar el control (detiene el escalamiento automático),
 * subir el nivel a mano, y cerrar con nota obligatoria.
 *
 * Lo que esta pantalla JAMÁS hace: marcar 911 o a la aseguradora (una llamada
 * abre un siniestro — dinero y acto jurídico del cliente), cerrar sin nota, o
 * pintar como "todo bien" lo que no se pudo leer.
 */
export default async function PaginaMesaControl({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // `leyoOk`: una mesa con datos a medias invita a decidir sobre lo que no se
  // ve. Con la lectura caída no hay botones — solo el aviso honesto.
  let incidencias: IncidenciaMesa[] = [];
  let leyoOk = true;
  try {
    incidencias = await listarMesaAsistencia(tenantId);
  } catch (e) {
    leyoOk = false;
    logger.warn('mesa.no_leida', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  // ── Server actions — re-gateo ADENTRO (el rol del render no es el de la
  //    llamada, y una action es alcanzable sin pasar por la página) ─────────

  async function gate(): Promise<{ tenantId: string; userId: string } | { error: string }> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede intervenir desde la mesa de control.' };
    return { tenantId: s.tenantId, userId: s.userId };
  }

  async function tomarControl(fd: FormData): Promise<void> {
    'use server';
    const g = await gate();
    if ('error' in g) return;
    const r = await tomarControlMesa(g.tenantId, String(fd.get('id') ?? ''), g.userId);
    if ('error' in r) logger.warn('mesa.tomar_control', { detalle: r.error });
    revalidatePath(RUTA);
  }

  async function reescalar(fd: FormData): Promise<void> {
    'use server';
    const g = await gate();
    if ('error' in g) return;
    const r = await reescalarDesdeMesa(
      g.tenantId, String(fd.get('id') ?? ''), g.userId, Number(fd.get('nivel')),
    );
    if ('error' in r) logger.warn('mesa.reescalar', { detalle: r.error });
    revalidatePath(RUTA);
  }

  async function resolver(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const g = await gate();
    if ('error' in g) return { error: g.error };
    const r = await resolverDesdeMesa(
      g.tenantId, String(fd.get('id') ?? ''), g.userId, String(fd.get('nota') ?? ''),
    );
    if ('error' in r) return { error: r.error };
    revalidatePath(RUTA);
    return { ok: r.ok };
  }

  const BTN_CHICO = 'text-xs px-2.5 py-1 rounded-lg hairline';
  const criticas = leyoOk ? incidencias.filter((i) => i.prioridad === 'critica').length : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <RadioTower width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Mesa de control</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {leyoOk
              ? `${incidencias.length} incidencia${incidencias.length === 1 ? '' : 's'} de asistencia viva${incidencias.length === 1 ? '' : 's'}${criticas ? ` · ${criticas} crítica${criticas === 1 ? '' : 's'}` : ''} — el agente propone, aquí se decide`
              : 'Sin datos — no se pudo leer la mesa'}
          </span>
        </div>
      </header>

      {!leyoOk && (
        <section className="rounded-2xl px-5 py-4 hairline" style={{ background: 'var(--surface)' }}>
          <p className="text-sm">
            No pude leer las incidencias ahorita — recarga la página. No se ofrecen botones de
            intervención para no decidir sobre lo que no se ve.
          </p>
        </section>
      )}

      {leyoOk && incidencias.length === 0 && (
        <section className="rounded-2xl px-5 py-4 hairline" style={{ background: 'var(--surface)' }}>
          <p className="text-sm">Sin incidencias de asistencia abiertas.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Cuando un chofer reporte una emergencia por WhatsApp — o la cámara de una unidad
            detecte un evento grave — el expediente aparece aquí con su timeline y sus botones.
          </p>
        </section>
      )}

      {leyoOk && incidencias.map((inc) => (
        <section
          key={inc.id}
          className="rounded-2xl px-5 py-4 flex flex-col gap-3 hairline"
          style={{
            background: 'var(--surface)',
            borderLeft: inc.prioridad === 'critica' ? '3px solid var(--bad)' : undefined,
          }}
        >
          <div className="flex items-start gap-2.5 flex-wrap">
            <TriangleAlert
              width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0"
              style={{ color: inc.prioridad === 'critica' ? 'var(--bad)' : 'var(--muted)' }}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {inc.tipo.replace(/_/g, ' ')} · prioridad {inc.prioridad} · nivel {inc.nivelEscalado}/{NIVEL_MAXIMO}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                {inc.operadorNombre ?? (inc.unidadRotulo ? 'sin chofer identificado' : 'sin chofer ni unidad')}
                {inc.unidadRotulo ? ` · unidad ${inc.unidadRotulo}` : ''}
                {inc.viajeFolio ? ` · viaje ${inc.viajeFolio}` : ''}
                {' · abierta '}{fechaHoraMx(inc.abiertaEn)}
                {inc.hayLesionados === true ? ' · ⛑️ CON LESIONADOS' : ''}
              </p>
              {inc.soloCamara && (
                <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: 'var(--warn)' }}>
                  <Camera width={12} height={12} strokeWidth={1.75} className="shrink-0" />
                  Detectada por la cámara de la unidad — el chofer NO ha reportado nada todavía.
                </p>
              )}
              {inc.descripcion && (
                <p className="text-xs mt-1 italic" style={{ color: 'var(--muted)' }}>
                  «{inc.descripcion.slice(0, 240)}»
                </p>
              )}
              <p className="text-xs mt-1" style={{ color: inc.reconocidaEn ? 'var(--ok)' : 'var(--warn)' }}>
                {inc.reconocidaEn
                  ? `Atendida por ${inc.reconocidaPorNombre ?? 'alguien del equipo'} desde ${fechaHoraMx(inc.reconocidaEn)} — el escalamiento automático está detenido`
                  : 'NADIE la ha tomado — el escalamiento automático sigue corriendo'}
              </p>
            </div>
            <span className="ml-auto flex gap-1.5 items-start shrink-0">
              {!inc.reconocidaEn && (
                <form action={tomarControl}>
                  <input type="hidden" name="id" value={inc.id} />
                  <button type="submit" className={BTN_CHICO} title="Reconocerla desde la mesa: detiene el escalamiento automático y queda a tu nombre">
                    Tomar el control
                  </button>
                </form>
              )}
              {inc.nivelEscalado < NIVEL_MAXIMO && (
                <form action={reescalar}>
                  <input type="hidden" name="id" value={inc.id} />
                  <input type="hidden" name="nivel" value={inc.nivelEscalado + 1} />
                  <button type="submit" className={BTN_CHICO} title="Sube un nivel el escalamiento (solo sube — bajar re-armaría avisos ya mandados). No manda WhatsApp: tú ya estás viendo esto.">
                    Subir a nivel {inc.nivelEscalado + 1}
                  </button>
                </form>
              )}
            </span>
          </div>

          {/* ── Timeline: la bitácora citable — quién supo qué y cuándo ── */}
          <details className="text-xs">
            <summary className="cursor-pointer" style={{ color: 'var(--muted)' }}>
              Timeline del expediente ({inc.eventos.length} evento{inc.eventos.length === 1 ? '' : 's'})
            </summary>
            {inc.eventos.length === 0 ? (
              <p className="mt-2" style={{ color: 'var(--muted)' }}>
                Sin eventos legibles — la bitácora de esta incidencia no se pudo leer o aún no tiene filas.
              </p>
            ) : (
              <ol className="mt-2 flex flex-col gap-1 border-l pl-3" style={{ borderColor: 'var(--muted)' }}>
                {inc.eventos.map((e, idx) => (
                  <li key={idx}>
                    <span style={{ color: 'var(--muted)' }}>{fechaHoraMx(e.creadoEn)}</span>
                    {' — '}{ROTULO_EVENTO[e.tipo] ?? e.tipo}
                    {typeof e.detalle?.nota === 'string' ? `: «${String(e.detalle.nota).slice(0, 200)}»` : ''}
                    {typeof e.detalle?.texto === 'string' ? `: «${String(e.detalle.texto).slice(0, 200)}»` : ''}
                    {typeof e.detalle?.nivel === 'number' ? ` (nivel ${e.detalle.nivel})` : ''}
                  </li>
                ))}
              </ol>
            )}
          </details>

          {/* ── Cierre con nota obligatoria ─────────────────────────────── */}
          <FormaConAviso accion={resolver} boton="Cerrar con nota" columnas="md:grid-cols-1">
            <input type="hidden" name="id" value={inc.id} />
            <Campo
              nombre="nota" etiqueta="Nota de cierre" requerido
              placeholder="Cómo terminó: quién atendió, con qué resultado"
              ayuda="Obligatoria — es lo que el expediente va a decir para siempre. Sin nota no hay cierre."
            />
          </FormaConAviso>
        </section>
      ))}
    </div>
  );
}
