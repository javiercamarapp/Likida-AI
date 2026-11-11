import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { LifeBuoy, AlertTriangle, Timer } from 'lucide-react';
import { exigirVerRuta } from '@/lib/auth/guard';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { getTickets, abrirTicket, CATEGORIAS_TICKET, PRIORIDADES_TICKET, type TicketRow } from '@/lib/likida/comercial';
import {
  getTicketDelTenant, getHilo, responderTicket, cambiarEstadoTicket, LARGO_MAX_MENSAJE,
  type MensajeHilo, type TicketDetalle,
} from '@/lib/likida/soporte';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { HiloSoporte } from '../../admin/ui/hilo-soporte';
import { ahoraMs } from '@/lib/saludo';
// El rótulo del estado del ticket es COMPARTIDO con /admin/soporte (auditoría
// 21, MEDIO 1): imprimir `t.estado` crudo aquí enseñaba "en_proceso" con guion
// bajo al flota_admin mientras el admin sí lo traducía con su mapa privado.
import { pillTicket } from './estatus';
import { fechaMx, fechaHoraMx } from '@/lib/formato';
import type { Metadata } from 'next';
import {
  MarcoPagina, Tarjeta, TablaBase, StatusChip, BotonEnlace, FormaConAviso, CampoTexto, CampoTextarea, CampoSelect, EstadoError,
  type ColumnaBase, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import './soporte.css';
export const metadata: Metadata = { title: 'Centro de ayuda' };

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
  const sp = await searchParams;
  // `sp` viaja a la puerta: sin él, `?vista=demo` de un superadmin rebotaba al selector de flota.
  await exigirVerRuta('/dashboard/soporte', sp);
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
  // H25 (auditoría 24): "← Volver a mis tickets" volvía a `/dashboard/soporte`
  // A SECAS — la misma trampa que `sufijo.ts` documenta: un superadmin
  // previsualizando una flota (`?tenant=X&vista=demo`) que abriera un hilo y
  // volviera perdía la previsualización a media revisión, igual que el link
  // al hilo de arriba ya cuida.
  const enlaceVolver = `/dashboard/soporte${sufijo ? `?${sufijo}` : ''}`;

  // ── Abrir un ticket — la puerta de la señal de PMF #3 (auditoría externa
  // 16-ago-2026: la señal estaba instrumentada y nada podía producirla).
  // El chequeo se repite ADENTRO (patrón del repo): POST directo posible.
  // La convención 0051 protege la señal: superadmin abre con abierto_por
  // NULL ("lo abrió Likida"), un usuario real de la flota con su id —
  // un demo de Javier jamás cuenta como queja del cliente.
  async function accionAbrirTicket(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const sesion = await resolverTenantAtadoOLanza('/dashboard/soporte', sp, tenantId);
    // A37-S20-06: la convención de la señal (abierto_por NULL = lo abrió Likida) se decide con
    // el rol REAL de la sesión: con `?rol=flota_admin` el rol efectivo es el previsualizado y un
    // ticket del superadmin contaría como queja del cliente.
    const real = sesion;
    try {
      await abrirTicket(
        sesion.tenantId,
        (real.rolReal ?? real.rol) === 'superadmin' ? null : sesion.userId,
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
    const sesion = await resolverTenantAtadoOLanza('/dashboard/soporte', sp, tenantId);
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
    const sesion = await resolverTenantAtadoOLanza('/dashboard/soporte', sp, tenantId);
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

  const columnas: ColumnaBase<TicketRow>[] = [
    { id: 'asunto', titulo: 'Asunto', principal: true, celda: (t) => <Link href={enlaceHilo(t.id)} className="rv-sop__enlace">{t.asunto}</Link> },
    { id: 'categoria', titulo: 'Categoría', celda: (t) => <span className="rv-sop__tenue">{t.categoria}</span> },
    { id: 'prioridad', titulo: 'Prioridad', celda: (t) => t.prioridad },
    {
      id: 'estado', titulo: 'Estado',
      celda: (t) => { const pill = pillTicket(t.estado); return <StatusChip tono={pill.estado}>{pill.etiqueta}</StatusChip>; },
    },
    { id: 'abierto', titulo: 'Abierto', celda: (t) => <span className="rv-sop__tenue">{fechaMx(t.abiertoEn)}</span> },
    {
      id: 'sla', titulo: 'SLA', alinear: 'der',
      celda: (t) => (
        <span className={t.horasRestantes != null && t.horasRestantes < 0 ? 'rv-sop__vencido tabular' : 'rv-sop__tenue tabular'}>
          {t.horasRestantes == null
            ? 'sin SLA'
            : t.horasRestantes < 0
              ? `vencido hace ${Math.abs(Math.round(t.horasRestantes))} h`
              : `${Math.round(t.horasRestantes)} h`}
        </span>
      ),
    },
  ];

  return (
    <MarcoPagina titulo="Centro de ayuda" apoyo="Tickets, prioridad, reloj de SLA y la conversación con Likida.">
      {!tickets ? (
        <EstadoError reintentar>No se pudo leer la cola. La consulta falló — no es que no haya tickets.</EstadoError>
      ) : tickets.length === 0 ? (
        <Tarjeta titulo="Tus solicitudes" estado="vacio" mensaje="No hay tickets abiertos"
          detalle="La cola registra prioridad, categoría y reloj de SLA. Si necesitas algo de Likida ahora, sigue siendo por WhatsApp, que es donde ya está tu operación." />
      ) : (
        <>
          <TiraCifras sello={selloHoy('Tickets de soporte')}>
            <Cifra icono={<LifeBuoy width={16} height={16} strokeWidth={1.75} />} etiqueta="Abiertos" info="soporte.abiertos" valor={abiertos.length} />
            <Cifra icono={<AlertTriangle width={16} height={16} strokeWidth={1.75} />} etiqueta="SLA vencido" info="soporte.sla_vencido"
              valor={vencidos.length} tono={vencidos.length > 0 ? 'bad' : undefined} />
            <Cifra icono={<Timer width={16} height={16} strokeWidth={1.75} />} etiqueta="Sin SLA pactado" info="soporte.sin_sla"
              valor={sinSla.length} nota="No están vencidos: nadie les puso plazo" />
          </TiraCifras>

          <Tarjeta titulo="Tus solicitudes">
            <TablaBase etiqueta="Solicitudes de soporte" columnas={columnas} filas={tickets} idFila={(t) => t.id} altoMaximo={false} tarjetaMovil />
            <p className="rv-sop__pie">El asunto abre la conversación con Likida.</p>
          </Tarjeta>
        </>
      )}

      {/* ── EL HILO ───────────────────────────────────────────────────────── */}
      {pedido !== '' && (
        <Tarjeta titulo={detalle ? detalle.asunto : 'Conversación'}
          acciones={<BotonEnlace href={enlaceVolver} variante="ghost" tamano="sm">Volver a mis tickets</BotonEnlace>}>
          <div className="rv-sop__hilo">
            {hiloFallo ? (
              <EstadoError reintentar>No se pudo leer la conversación. La consulta falló — no es que no haya respuestas.</EstadoError>
            ) : detalle === null ? (
              <p className="rv-sop__nota">Ese ticket no es de tu flota, o ya no existe. La lista de arriba es la de tus tickets.</p>
            ) : (
              <>
                <p className="rv-sop__nota">
                  {detalle.categoria}/{detalle.prioridad} · abierto {fechaHoraMx(detalle.abiertoEn)}
                  {detalle.venceEn ? ` · vence ${fechaHoraMx(detalle.venceEn)}` : ' · sin SLA pactado'}
                  {detalle.resueltoEn ? ` · resuelto ${fechaHoraMx(detalle.resueltoEn)}` : ''}
                </p>

                {detalle.descripcion && <p className="rv-sop__descripcion">{detalle.descripcion}</p>}

                <HiloSoporte
                  mensajes={hilo ?? []}
                  vacio="Todavía no hay respuesta de Likida en este ticket. Cuando la haya, aparece aquí — no en otro lado."
                />

                {cerrado ? (
                  <FormaConAviso accion={accionEstado} boton="Reabrir el ticket" columnas="md:grid-cols-1">
                    <input type="hidden" name="ticket" value={detalle.id} />
                    <input type="hidden" name="estado" value="abierto" />
                    <p className="rv-sop__nota">Este ticket está cerrado. Si el problema sigue, reábrelo y vuelve a la cola de Likida.</p>
                  </FormaConAviso>
                ) : (
                  <div className="rv-sop__acciones">
                    <FormaConAviso accion={accionResponder} boton="Enviar" columnas="md:grid-cols-1">
                      <input type="hidden" name="ticket" value={detalle.id} />
                      <CampoTextarea etiqueta="Escribir en el ticket" name="cuerpo" required rows={3} maxLength={LARGO_MAX_MENSAJE}
                        placeholder="Agrega un dato, un folio, o contesta lo que te preguntaron" />
                    </FormaConAviso>
                    <FormaConAviso accion={accionEstado} boton="Cerrar el ticket" columnas="md:grid-cols-1">
                      <input type="hidden" name="ticket" value={detalle.id} />
                      <input type="hidden" name="estado" value="cerrado" />
                      <p className="rv-sop__nota">Si ya quedó, ciérralo. Se puede reabrir después: cerrarlo no borra nada de la conversación.</p>
                    </FormaConAviso>
                  </div>
                )}
              </>
            )}
          </div>
        </Tarjeta>
      )}

      <Tarjeta titulo="Abrir un ticket">
        <FormaConAviso accion={accionAbrirTicket} boton="Abrir ticket">
          <CampoTexto etiqueta="Asunto" name="asunto" required placeholder="Qué pasó, en una línea" />
          <CampoSelect etiqueta="Categoría" name="categoria" defaultValue="otro">
            {CATEGORIAS_TICKET.map((c) => <option key={c} value={c}>{c}</option>)}
          </CampoSelect>
          <CampoSelect etiqueta="Prioridad" name="prioridad" defaultValue="media">
            {PRIORIDADES_TICKET.map((p) => <option key={p} value={p}>{p}</option>)}
          </CampoSelect>
          <CampoTexto etiqueta="Detalle" name="descripcion" placeholder="Opcional — folios, pantalla, qué esperabas" />
        </FormaConAviso>
      </Tarjeta>
    </MarcoPagina>
  );
}
