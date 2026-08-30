import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { LifeBuoy, AlertTriangle, Timer, Plus, MessagesSquare } from 'lucide-react';
import { exigirVerRuta } from '@/lib/auth/guard';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { getTickets, abrirTicket, CATEGORIAS_TICKET, PRIORIDADES_TICKET, type TicketRow } from '@/lib/likida/comercial';
import {
  getTicketDelTenant, getHilo, responderTicket, cambiarEstadoTicket, LARGO_MAX_MENSAJE,
  type MensajeHilo, type TicketDetalle,
} from '@/lib/likida/soporte';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { FormaConAviso, Campo, CampoTexto, type ResultadoAccion } from '../../admin/ui/forma';
import { HiloSoporte } from '../../admin/ui/hilo-soporte';
import { ahoraMs } from '@/lib/saludo';
import { EstadoVacio, KpiTile, StatusPill } from '../../admin/ui/kit';
// El rótulo del estado del ticket es COMPARTIDO con /admin/soporte (auditoría
// 21, MEDIO 1): imprimir `t.estado` crudo aquí enseñaba "en_proceso" con guion
// bajo al flota_admin mientras el admin sí lo traducía con su mapa privado.
import { pillTicket } from './estatus';
import { fechaMx, fechaHoraMx } from '@/lib/formato';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * SOPORTE — cola de tickets con reloj de SLA, sobre `ticket_soporte` (0051), y
 * —desde la 0268— EL HILO: lo que Likida contestó, y la forma de seguirlo.
 *
 * ── LO QUE FALTABA (auditoría de dashboards, 29-ago-2026, H1) ─────────────
 *
 * Esta pantalla abría tickets desde el 16 de agosto y nunca pudo enseñar una
 * respuesta: `ticket_mensaje` (0051) no tenía un solo escritor en todo `src/`,
 * ni esta pantalla tenía dónde leerlo. El cliente pedía ayuda a un buzón que
 * solo recibía. Ahora ve el hilo y puede seguir la conversación, cerrar el
 * ticket cuando ya quedó, o reabrirlo cuando no.
 *
 * ── LO QUE ESTE PANEL NO VE, Y NO ES UN OLVIDO ────────────────────────────
 *
 * `getHilo(..., { verInternas: false })`. Las notas internas del equipo de
 * Likida (`ticket_mensaje.interna`, 0051) se excluyen EN LA CONSULTA — no se
 * traen y se esconden al pintar. La 0268 lo repite como policy de RLS para la
 * sesión de navegador. Y el server action de responder entra como
 * `{ tipo: 'flota' }`, que tiene prohibido escribir una nota interna: nadie
 * desde aquí puede fabricar un mensaje "del equipo".
 *
 * EL RELOJ SE DERIVA, no se guarda. `vence_en` se escribe una vez al abrir el
 * ticket; lo que falta se resta contra el reloj del SERVIDOR, que llega como
 * prop (`ahoraMs()`): un `Date.now()` en el render lo bloquea
 * `react-hooks/purity`, y además haría que dos usuarios vieran relojes
 * distintos según su máquina.
 *
 * UN TICKET SIN SLA NO ESTÁ VENCIDO. `horasRestantes` es `null` y la fila dice
 * "sin SLA" — un 0 se leería como incumplido, y acusaría de incumplimiento a
 * quien nunca pactó un plazo.
 */
export default async function SoportePage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; ticket?: string }>;
}) {
  await exigirVerRuta('/dashboard/soporte');
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/soporte', sp);

  // El link al hilo conserva la previsualización del superadmin ("ver como"):
  // sin esto, abrir un hilo desde un demo tiraría al usuario de vuelta a su
  // propia flota a media revisión.
  const sufijo = [
    sp.tenant ? `tenant=${encodeURIComponent(sp.tenant)}` : null,
    sp.vista ? `vista=${encodeURIComponent(sp.vista)}` : null,
  ].filter(Boolean).join('&');
  const enlaceHilo = (id: string) =>
    `/dashboard/soporte?ticket=${encodeURIComponent(id)}${sufijo ? `&${sufijo}` : ''}`;

  // ── Abrir un ticket — la puerta de la señal de PMF #3 (auditoría externa
  // 16-ago-2026: la señal estaba instrumentada y nada podía producirla).
  // El chequeo se repite ADENTRO (patrón del repo): POST directo posible.
  // La convención 0051 protege la señal: superadmin abre con abierto_por
  // NULL ("lo abrió Likida"), un usuario real de la flota con su id —
  // un demo de Javier jamás cuenta como queja del cliente.
  async function accionAbrirTicket(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const sesion = await resolverTenantEfectivo('/dashboard/soporte', sp);
    try {
      await abrirTicket(
        sesion.tenantId,
        sesion.rol === 'superadmin' ? null : sesion.userId,
        {
          asunto: String(fd.get('asunto') ?? ''),
          descripcion: String(fd.get('descripcion') ?? ''),
          categoria: String(fd.get('categoria') ?? 'otro'),
          prioridad: String(fd.get('prioridad') ?? 'media'),
        },
      );
      revalidatePath('/dashboard/soporte');
      return { ok: 'Ticket abierto — el equipo de Likida lo ve en su bandeja de escalaciones.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'abrir el ticket') };
    }
  }

  // ── Seguir el hilo ───────────────────────────────────────────────────────
  // Siempre `{ tipo: 'flota' }`, incluso cuando quien mira es el superadmin en
  // previsualización: desde ESTA pantalla se habla como el cliente. Si el
  // equipo quiere contestar, su lugar es /admin/soporte — y ahí su mensaje
  // cuenta como respuesta para el agente de Éxito, que es justo la diferencia
  // que se perdería si este action pudiera hablar como Likida.
  async function accionResponder(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const sesion = await resolverTenantEfectivo('/dashboard/soporte', sp);
    try {
      await responderTicket(
        String(fd.get('ticket') ?? ''),
        sesion.tenantId,
        { tipo: 'flota', userId: sesion.userId },
        { cuerpo: String(fd.get('cuerpo') ?? ''), interna: false },
      );
      revalidatePath('/dashboard/soporte');
      return { ok: 'Mensaje enviado. Queda en el hilo del ticket y el equipo de Likida lo ve en su cola.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'escribir en el ticket') };
    }
  }

  async function accionEstado(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const sesion = await resolverTenantEfectivo('/dashboard/soporte', sp);
    try {
      const r = await cambiarEstadoTicket(
        String(fd.get('ticket') ?? ''),
        sesion.tenantId,
        { tipo: 'flota', userId: sesion.userId },
        String(fd.get('estado') ?? ''),
      );
      revalidatePath('/dashboard/soporte');
      return {
        ok: r.estado === 'cerrado'
          ? 'Ticket cerrado. Si vuelve a pasar, ábrelo de nuevo o reabre éste.'
          : 'Ticket reabierto — vuelve a la cola de Likida y su reloj de SLA sigue siendo el pactado al abrirlo.',
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'cambiar el estado del ticket') };
    }
  }

  const ahora = ahoraMs();
  const tickets = await safe<TicketRow[]>(() => getTickets(tenantId, ahora));

  const abiertos = tickets?.filter((t) => t.estado !== 'resuelto' && t.estado !== 'cerrado') ?? [];
  const vencidos = abiertos.filter((t) => t.horasRestantes != null && t.horasRestantes < 0);
  const sinSla = abiertos.filter((t) => t.horasRestantes == null);

  // ── El ticket abierto en el panel de hilo (`?ticket=`) ───────────────────
  // Un `<details>` por fila leería el hilo de cada ticket en cada carga. Se
  // lee UNO: el que alguien pidió ver.
  let detalle: TicketDetalle | null = null;
  let hilo: MensajeHilo[] | null = null;
  let hiloFallo = false;
  const pedido = (sp.ticket ?? '').trim();
  if (pedido) {
    try {
      detalle = await getTicketDelTenant(pedido, tenantId);
      // `verInternas: false` — y no por omisión: la llamada lo declara para
      // que la diferencia con la de /admin se vea al leer el código.
      hilo = detalle ? await getHilo(pedido, tenantId, { verInternas: false }) : null;
    } catch {
      hiloFallo = true;
    }
  }
  const cerrado = detalle !== null && (detalle.estado === 'resuelto' || detalle.estado === 'cerrado');

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <LifeBuoy width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Soporte &amp; Quejas</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Tickets, prioridad, reloj de SLA y la conversación con Likida
          </span>
        </div>
      </header>

      {!tickets ? (
        <div className="glass-panel p-5">
          <EstadoVacio>
            No se pudo leer la cola. La consulta falló — no es que no haya tickets.
          </EstadoVacio>
        </div>
      ) : tickets.length === 0 ? (
        <div className="glass-panel p-5">
          <EstadoVacio icono={<LifeBuoy width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            <span className="font-semibold">No hay tickets abiertos.</span> La cola ya existe y
            registra prioridad, categoría y reloj de SLA. Si necesitas algo de Likida ahora, sigue
            siendo por WhatsApp — que es donde ya está tu operación.
          </EstadoVacio>
        </div>
      ) : (
        <>
          <div className="glass-panel p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <KpiTile
                icono={<LifeBuoy width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Abiertos"
                valor={abiertos.length}
              />
              <KpiTile
                icono={<AlertTriangle width={15} height={15} strokeWidth={1.75} />}
                etiqueta="SLA vencido"
                valor={vencidos.length}
                destacar={vencidos.length > 0}
              />
              <KpiTile
                icono={<Timer width={15} height={15} strokeWidth={1.75} />}
                etiqueta="Sin SLA pactado"
                valor={sinSla.length}
                nota="No están vencidos: nadie les puso plazo"
              />
            </div>
          </div>

          <div className="glass-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                    <th className="text-left font-medium px-5 py-3">Asunto</th>
                    <th className="text-left font-medium px-5 py-3">Categoría</th>
                    <th className="text-left font-medium px-5 py-3">Prioridad</th>
                    <th className="text-left font-medium px-5 py-3">Estado</th>
                    <th className="text-left font-medium px-5 py-3">Abierto</th>
                    <th className="text-right font-medium px-5 py-3">SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => {
                    const pill = pillTicket(t.estado);
                    return (
                    <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="px-5 py-3 font-medium">
                        <Link href={enlaceHilo(t.id)} style={{ color: 'var(--marca)' }}>{t.asunto}</Link>
                      </td>
                      <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{t.categoria}</td>
                      <td className="px-5 py-3">{t.prioridad}</td>
                      <td className="px-5 py-3">
                        <StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill>
                      </td>
                      <td className="px-5 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fechaMx(t.abiertoEn)}</td>
                      <td className="px-5 py-3 text-right text-xs tabular"
                        style={{ color: t.horasRestantes != null && t.horasRestantes < 0 ? 'var(--bad)' : 'var(--muted)' }}>
                        {t.horasRestantes == null
                          ? 'sin SLA'
                          : t.horasRestantes < 0
                            ? `vencido hace ${Math.abs(Math.round(t.horasRestantes))} h`
                            : `${Math.round(t.horasRestantes)} h`}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs px-5 py-3" style={{ color: 'var(--muted)' }}>
              El asunto abre la conversación con Likida.
            </p>
          </div>
        </>
      )}

      {/* ── EL HILO ───────────────────────────────────────────────────────── */}
      {pedido !== '' && (
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <MessagesSquare width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
            <span className="text-sm font-medium">
              {detalle ? detalle.asunto : 'Conversación'}
            </span>
          </div>

          {hiloFallo ? (
            <EstadoVacio>
              No se pudo leer la conversación. La consulta falló — no es que no haya respuestas.
            </EstadoVacio>
          ) : detalle === null ? (
            <EstadoVacio>
              Ese ticket no es de tu flota, o ya no existe. La lista de arriba es la de tus tickets.
            </EstadoVacio>
          ) : (
            <>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {detalle.categoria}/{detalle.prioridad} · abierto {fechaHoraMx(detalle.abiertoEn)}
                {detalle.venceEn ? ` · vence ${fechaHoraMx(detalle.venceEn)}` : ' · sin SLA pactado'}
                {detalle.resueltoEn ? ` · resuelto ${fechaHoraMx(detalle.resueltoEn)}` : ''}
              </p>

              {detalle.descripcion && (
                <p className="text-[13px] whitespace-pre-wrap rounded-lg px-3 py-2.5"
                  style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
                  {detalle.descripcion}
                </p>
              )}

              <HiloSoporte
                mensajes={hilo ?? []}
                vacio="Todavía no hay respuesta de Likida en este ticket. Cuando la haya, aparece aquí — no en otro lado."
              />

              {cerrado ? (
                <FormaConAviso accion={accionEstado} boton="Reabrir el ticket" columnas="md:grid-cols-1">
                  <input type="hidden" name="ticket" value={detalle.id} />
                  <input type="hidden" name="estado" value="abierto" />
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    Este ticket está cerrado. Si el problema sigue, reábrelo y vuelve a la cola de Likida.
                  </p>
                </FormaConAviso>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <FormaConAviso accion={accionResponder} boton="Enviar" columnas="md:grid-cols-1">
                    <input type="hidden" name="ticket" value={detalle.id} />
                    <CampoTexto
                      nombre="cuerpo"
                      etiqueta="Escribir en el ticket"
                      requerido
                      maxLargo={LARGO_MAX_MENSAJE}
                      placeholder="Agrega un dato, un folio, o contesta lo que te preguntaron"
                    />
                  </FormaConAviso>
                  <FormaConAviso accion={accionEstado} boton="Cerrar el ticket" columnas="md:grid-cols-1">
                    <input type="hidden" name="ticket" value={detalle.id} />
                    <input type="hidden" name="estado" value="cerrado" />
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      Si ya quedó, ciérralo. Se puede reabrir después: cerrarlo no borra nada de la
                      conversación.
                    </p>
                  </FormaConAviso>
                </div>
              )}
            </>
          )}

          <Link href="/dashboard/soporte" className="text-xs inline-block" style={{ color: 'var(--marca)' }}>
            ← Volver a mis tickets
          </Link>
        </div>
      )}

      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-3">
          <Plus width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          <span className="text-sm font-medium">Abrir un ticket</span>
        </div>
        <FormaConAviso accion={accionAbrirTicket} boton="Abrir ticket">
          <Campo nombre="asunto" etiqueta="Asunto" requerido placeholder="Qué pasó, en una línea" />
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            Categoría
            <select name="categoria" className="text-sm" defaultValue="otro">
              {CATEGORIAS_TICKET.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            Prioridad
            <select name="prioridad" className="text-sm" defaultValue="media">
              {PRIORIDADES_TICKET.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <Campo nombre="descripcion" etiqueta="Detalle" placeholder="Opcional — folios, pantalla, qué esperabas" />
        </FormaConAviso>
      </div>
    </div>
  );
}
