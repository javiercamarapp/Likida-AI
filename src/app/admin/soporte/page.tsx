import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { LifeBuoy, AlertTriangle, Timer, CheckCircle2, UserCheck } from 'lucide-react';
// Los estados terminales viven junto a la lectura (lib/admin/soporte.ts), y
// desde FE-11 el conteo de abiertos/cerrados también: la pantalla ya no
// reclasifica en memoria una lista que además viene acotada.
import {
  getTicketsCruzados, contarTickets, resolverTicketCruzado, TOPE_TICKETS,
  type TicketCruzado, type ConteosTickets,
} from '@/lib/admin/soporte';
import {
  getTicketDelTenant, getHilo, responderTicket, tomarTicket, cambiarEstadoTicket,
  ESTADOS_TICKET, LARGO_MAX_MENSAJE,
  type MensajeHilo, type TicketDetalle,
} from '@/lib/likida/soporte';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { ahoraMs } from '@/lib/saludo';
import { fechaMx, fechaHoraMx, numero } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard, StatusPill, EstadoVacio, EstadoError, type Estado } from '../ui/kit';
import { FormaConAviso, CampoTexto, Casilla, Selector, type ResultadoAccion } from '../ui/forma';
import { HiloSoporte } from '../ui/hilo-soporte';

export const dynamic = 'force-dynamic';

/** `ticket_soporte.estado` (dominio de la 0051) como pill. Un valor fuera del
 *  dominio se pinta crudo en neutro — visible, no roto (mismo criterio que
 *  `PILL_ESTATUS` en resumen-visual). */
const PILL_TICKET: Record<string, { estado: Estado; etiqueta: string }> = {
  abierto: { estado: 'warn', etiqueta: 'Abierto' },
  en_proceso: { estado: 'warn', etiqueta: 'En proceso' },
  esperando: { estado: 'neutral', etiqueta: 'Esperando' },
  resuelto: { estado: 'ok', etiqueta: 'Resuelto' },
  cerrado: { estado: 'ok', etiqueta: 'Cerrado' },
};

/** "hace 3 h" / "hace 2 d" — la edad del ticket contra el reloj del SERVIDOR
 *  (`ahoraMs()`), el mismo contra el que se resta el SLA: dos relojes en la
 *  misma fila terminan contándose historias distintas. */
function edadDe(abiertoEn: string, ahora: number): string {
  const horas = (ahora - new Date(abiertoEn).getTime()) / 3_600_000;
  if (horas < 1) return 'hace menos de 1 h';
  if (horas < 48) return `hace ${Math.floor(horas)} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

/** El reloj de SLA de la fila — mismas tres verdades que /dashboard/soporte:
 *  sin SLA no hay reloj, vencido se dice con cuánto, y lo demás es lo que falta. */
function slaDe(t: TicketCruzado): { texto: string; vencido: boolean } {
  if (t.horasRestantes == null) return { texto: 'sin SLA', vencido: false };
  if (t.horasRestantes < 0) return { texto: `vencido hace ${Math.abs(Math.round(t.horasRestantes))} h`, vencido: true };
  return { texto: `${Math.round(t.horasRestantes)} h`, vencido: false };
}

/**
 * Resuelve el ticket que trae el formulario a la flota a la que pertenece.
 *
 * Vive a NIVEL DE MÓDULO, no dentro del componente, y no es capricho de
 * estilo: un server action serializa las variables que captura de su closure,
 * y una función no se serializa. Definida aquí, los tres actions la LLAMAN sin
 * capturarla.
 *
 * LANZA si el id no es un ticket: nunca se sigue adelante con un tenant a
 * medias, que sería escribir en el hilo de quien tocara.
 */
async function flotaDelTicket(fd: FormData): Promise<{ id: string; tenantId: string }> {
  const t = await resolverTicketCruzado(String(fd.get('ticket') ?? ''));
  if (!t) throw new Error('Ese ticket ya no existe.');
  return { id: t.id, tenantId: t.tenantId };
}

/**
 * SOPORTE — la cola de tickets del SUPERADMIN: `ticket_soporte` (0051) de
 * TODAS las flotas, con flota, edad y reloj de SLA por fila, y —desde la
 * 0268— el hilo y las cuatro acciones que cierran el ciclo.
 *
 * ── LO QUE ESTA PANTALLA NO PODÍA HACER HASTA HOY (auditoría 29-ago-2026, H1)
 *
 * Miraba la cola y no tenía UN SOLO server action. No había responder, ni
 * tomar, ni cerrar. `ticket_mensaje` (0051) llevaba desde entonces con cero
 * escritores en todo `src/`, y `ticket_soporte.estado` con cero UPDATEs:
 * ningún ticket podía salir jamás de 'abierto'. El semáforo llegaba a rojo y
 * se quedaba ahí para siempre, y la alarma «sin respuesta» del agente de Éxito
 * era insatisfacible por construcción — nada podía marcar que sí se respondió.
 *
 * (El comentario que vivía aquí, "ninguna pantalla inserta en ticket_soporte",
 * quedó obsoleto el 16-ago: /dashboard/soporte inserta desde entonces. Se
 * corrige aquí en vez de dejarlo mintiéndole al próximo que lea el archivo.)
 *
 * ── EL HILO SE ABRE POR `?ticket=`, NO POR FILA ───────────────────────────
 *
 * Un `<details>` por fila leería el hilo de hasta 200 tickets en cada carga:
 * 200 idas a la base para pintar una tabla. Con `?ticket=<id>` se lee UNO, el
 * que alguien pidió ver.
 *
 * ── EL CRUCE DE FLOTAS PASA UNA SOLA VEZ, Y SE VE ─────────────────────────
 *
 * `resolverTicketCruzado` es la única lectura sin filtro de tenant de todo
 * este flujo (vive en lib/admin, el barrio con ese permiso). Lo que devuelve
 * es el tenant al que el ticket YA pertenece, y con ese id en la mano entra
 * todo lo demás por la puerta tenant-scoped de `lib/likida/soporte.ts`.
 */
export default async function SoportePage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string }>;
}) {
  await requireSuperadmin();
  const sp = await searchParams;
  const ahora = ahoraMs();

  // ── Las tres acciones del equipo ────────────────────────────────────────
  // El chequeo se REPITE adentro de cada una (patrón del repo): un server
  // action es un endpoint POST, y que la página lo haya comprobado al
  // renderizar no dice nada de quién manda el POST.

  async function accionResponder(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await requireSuperadmin();
    try {
      const { id, tenantId } = await flotaDelTicket(fd);
      const interna = fd.get('interna') === '1';
      const r = await responderTicket(id, tenantId, { tipo: 'likida', userId: s.userId }, {
        cuerpo: String(fd.get('cuerpo') ?? ''),
        interna,
      });
      revalidatePath('/admin/soporte');
      if (interna) {
        return { ok: 'Nota interna guardada. El cliente NO la ve, y no cuenta como respuesta: la alarma de «sin respuesta» sigue encendida.' };
      }
      return {
        ok: r.movioAEnProceso
          ? 'Respuesta enviada. El ticket pasó de «abierto» a «en proceso», y la alarma de «sin respuesta» ya se puede apagar.'
          : 'Respuesta enviada — el cliente la ve en su panel de Soporte.',
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'responder el ticket') };
    }
  }

  async function accionTomar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await requireSuperadmin();
    try {
      const { id, tenantId } = await flotaDelTicket(fd);
      const r = await tomarTicket(id, tenantId, { tipo: 'likida', userId: s.userId });
      revalidatePath('/admin/soporte');
      return { ok: `Tomado. Queda a tu nombre y en «${r.estado}» — la cola ya no lo enseña como sin dueño.` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'tomar el ticket') };
    }
  }

  async function accionEstado(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await requireSuperadmin();
    try {
      const { id, tenantId } = await flotaDelTicket(fd);
      const r = await cambiarEstadoTicket(id, tenantId, { tipo: 'likida', userId: s.userId }, String(fd.get('estado') ?? ''));
      revalidatePath('/admin/soporte');
      // «Quedó en la bitácora» solo si de verdad quedó: `anotarBitacora` es
      // best-effort a propósito (la acción ya ocurrió y no se tira por no poder
      // anotarla), así que la pantalla LEE su resultado en vez de afirmarlo.
      return {
        ok: r.anotado
          ? `De «${r.estadoPrevio}» a «${r.estado}». Quedó en la bitácora.`
          : `De «${r.estadoPrevio}» a «${r.estado}». El cambio SÍ se guardó; lo que no se pudo escribir fue la entrada de bitácora (quedó en el log del servidor).`,
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'cambiar el estado del ticket') };
    }
  }

  // Error DICHO, no tragado: getTicketsCruzados lanza si la lectura no se
  // completó (el error de supabase-js llega por valor y ya se comprobó allá).
  // Aquí se atrapa para pintar el estado de error DENTRO del marco de la
  // página — una cola vacía sobre una base caída afirmaría "nadie necesita
  // nada", que es lo contrario de lo que una cola de soporte promete.
  let tickets: TicketCruzado[] | null = null;
  try {
    tickets = await getTicketsCruzados(ahora);
  } catch {
    tickets = null;
  }
  // FE-11: los cuatro KPIs eran `.filter().length` sobre la tabla ENTERA
  // traída a memoria. Con la lista ya acotada a `TOPE_TICKETS`, ese mismo
  // cálculo diría "200 tickets abiertos" hubiera 200 o 40,000: contarlos en la
  // base es lo que permite acotar la lista sin mentir sobre la cola.
  const conteos: ConteosTickets = await contarTickets(ahora)
    .catch((): ConteosTickets => ({ abiertos: null, vencidos: null, sinSla: null, cerrados: null }));
  const total = conteos.abiertos !== null && conteos.cerrados !== null
    ? conteos.abiertos + conteos.cerrados
    : null;
  const recortado = total !== null && tickets !== null && total > tickets.length;

  // ── El ticket abierto en el panel de hilo (`?ticket=`) ───────────────────
  // Las tres lecturas caen por su lado y ninguna tumba la cola: un hilo que no
  // se pudo leer se DICE, y la tabla sigue enseñando lo que sí se pudo.
  let detalle: TicketDetalle | null = null;
  let flotaDelDetalle: string | null = null;
  let hilo: MensajeHilo[] | null = null;
  let hiloFallo = false;
  const pedido = (sp.ticket ?? '').trim();
  if (pedido) {
    try {
      const ubicado = await resolverTicketCruzado(pedido);
      if (ubicado) {
        flotaDelDetalle = ubicado.tenantNombre;
        detalle = await getTicketDelTenant(ubicado.id, ubicado.tenantId);
        // El equipo SÍ ve las notas internas: es su lado del mostrador. En
        // /dashboard/soporte la misma llamada va con `verInternas: false`.
        hilo = await getHilo(ubicado.id, ubicado.tenantId, { verInternas: true });
      }
    } catch {
      hiloFallo = true;
    }
  }

  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<LifeBuoy {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo="Soporte — todas las flotas"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {tickets === null ? (
            <EstadoError mensaje="No se pudo leer la cola de tickets. La consulta falló — no es que no haya tickets, es que no se pudo mirar." />
          ) : (
            <>
              {/* ── KPIs — conteos reales de la cola cross-tenant ─────────── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <StatCard icono={<LifeBuoy {...ICONO} />}
                  etiqueta="Tickets abiertos — todas las flotas" valor={conteos.abiertos} formato="entero"
                  sinDato="no se pudo contar"
                />
                <StatCard icono={<AlertTriangle {...ICONO} />}
                  etiqueta="Con SLA vencido" valor={conteos.vencidos} formato="entero"
                  sinDato="no se pudo contar"
                />
                <StatCard icono={<Timer {...ICONO} />}
                  etiqueta="Sin SLA pactado" valor={conteos.sinSla} formato="entero"
                  nota="No están vencidos: nadie les puso plazo"
                  sinDato="no se pudo contar"
                />
                <StatCard icono={<CheckCircle2 {...ICONO} />}
                  etiqueta="Resueltos o cerrados — histórico" valor={conteos.cerrados} formato="entero"
                  sinDato="no se pudo contar"
                />
              </div>

              {/* ── EL HILO Y LAS ACCIONES ────────────────────────────────── */}
              {pedido !== '' && (
                <section className="card p-4 space-y-3">
                  {hiloFallo ? (
                    <EstadoError mensaje="No se pudo leer ese hilo. No significa que esté vacío — la consulta falló, y contestar sin ver lo que ya se dijo es como se manda dos veces la misma respuesta." />
                  ) : detalle === null ? (
                    <EstadoVacio>
                      Ese ticket ya no existe. Puede que se haya borrado con la flota — la cola de abajo es lo que sí hay.
                    </EstadoVacio>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <TituloSeccion>{detalle.asunto}</TituloSeccion>
                          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                            {flotaDelDetalle} · {detalle.categoria}/{detalle.prioridad} · abierto {fechaHoraMx(detalle.abiertoEn)}
                            {detalle.venceEn ? ` · vence ${fechaHoraMx(detalle.venceEn)}` : ' · sin SLA pactado'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusPill estado={(PILL_TICKET[detalle.estado] ?? { estado: 'neutral' as Estado }).estado}>
                            {(PILL_TICKET[detalle.estado] ?? { etiqueta: detalle.estado }).etiqueta}
                          </StatusPill>
                          <span className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                            <UserCheck width={13} height={13} strokeWidth={1.75} />
                            {/* SIN TOMAR no es "en proceso": son dos cosas
                                distintas y se dicen distinto. */}
                            {detalle.asignadoA ? (detalle.asignadoNombre ?? 'tomado') : 'sin tomar'}
                          </span>
                        </div>
                      </div>

                      {detalle.descripcion && (
                        <p className="text-[13px] whitespace-pre-wrap rounded-lg px-3 py-2.5"
                          style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
                          {detalle.descripcion}
                        </p>
                      )}

                      <HiloSoporte
                        mensajes={hilo ?? []}
                        vacio="Nadie ha escrito en este hilo todavía. Mientras no haya una respuesta pública, la alarma de «sin respuesta» del agente de Éxito sigue encendida — y con razón."
                      />

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <TituloSeccion>Responder</TituloSeccion>
                          <FormaConAviso accion={accionResponder} boton="Enviar" columnas="md:grid-cols-1">
                            <input type="hidden" name="ticket" value={detalle.id} />
                            <CampoTexto
                              nombre="cuerpo"
                              etiqueta="Mensaje"
                              requerido
                              maxLargo={LARGO_MAX_MENSAJE}
                              placeholder="Qué le vas a decir a la flota"
                              ayuda="Un mensaje público apaga la alarma de «sin respuesta»; una nota interna, no."
                            />
                            <Casilla
                              nombre="interna"
                              etiqueta="Nota interna — el cliente NO la ve"
                              ayuda="Va en el mismo hilo (0051) para que el orden cronológico sea uno solo, pero la consulta del panel del cliente la excluye."
                            />
                          </FormaConAviso>
                        </div>

                        <div className="space-y-2">
                          <TituloSeccion>Tomar y mover</TituloSeccion>
                          <FormaConAviso accion={accionTomar} boton="Tomar el ticket" columnas="md:grid-cols-1">
                            <input type="hidden" name="ticket" value={detalle.id} />
                          </FormaConAviso>
                          <FormaConAviso accion={accionEstado} boton="Cambiar estado" columnas="md:grid-cols-1">
                            <input type="hidden" name="ticket" value={detalle.id} />
                            <Selector
                              nombre="estado"
                              etiqueta="Estado"
                              valorInicial={detalle.estado}
                              opciones={ESTADOS_TICKET.map((e) => ({ valor: e, texto: e }))}
                              ayuda="Resuelto y cerrado escriben la fecha de resolución; salir de ellos la borra — el constraint de la 0051 exige que las dos cosas digan lo mismo."
                            />
                          </FormaConAviso>
                        </div>
                      </div>
                    </>
                  )}
                  <Link href="/admin/soporte" className="text-xs inline-block" style={{ color: 'var(--marca)' }}>
                    ← Volver a la cola
                  </Link>
                </section>
              )}

              {tickets.length === 0 ? (
                <EstadoVacio icono={<LifeBuoy width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  <span className="font-semibold">La cola existe y está vacía de verdad.</span>{' '}
                  La tabla de tickets (con prioridad, categoría y reloj de SLA) está en la base desde la
                  migración 0051, el panel del cliente abre tickets desde el 16 de agosto, y desde la 0268
                  esta pantalla puede responderlos, tomarlos y cerrarlos. Este 0 no es un hueco de
                  producto: es que hoy ninguna flota tiene nada pendiente con Likida.
                </EstadoVacio>
              ) : (
                <div className="card overflow-hidden">
                  <div className="px-4 pt-3 pb-1">
                    <TituloSeccion>La cola — lo más urgente primero, sin-SLA al final</TituloSeccion>
                  </div>
                  <div className="overflow-x-auto mt-1">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ color: 'var(--muted)' }} className="text-left">
                          <th className="px-4 py-2 font-medium">Asunto</th>
                          <th className="px-4 py-2 font-medium">Flota</th>
                          <th className="px-4 py-2 font-medium">Categoría</th>
                          <th className="px-4 py-2 font-medium">Prioridad</th>
                          <th className="px-4 py-2 font-medium">Estado</th>
                          <th className="px-4 py-2 font-medium">Tomado por</th>
                          <th className="px-4 py-2 font-medium">Abierto</th>
                          <th className="px-4 py-2 font-medium text-right">SLA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickets.map((t) => {
                          const pill = PILL_TICKET[t.estado] ?? { estado: 'neutral' as Estado, etiqueta: t.estado };
                          const sla = slaDe(t);
                          return (
                            <tr key={t.id} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                              <td className="px-4 py-2.5 font-medium">
                                <Link href={`/admin/soporte?ticket=${encodeURIComponent(t.id)}`} style={{ color: 'var(--marca)' }}>
                                  {t.asunto}
                                </Link>
                              </td>
                              <td className="px-4 py-2.5">{t.tenantNombre}</td>
                              <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{t.categoria}</td>
                              <td className="px-4 py-2.5" style={{ color: 'var(--muted)' }}>{t.prioridad}</td>
                              <td className="px-4 py-2.5"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
                              <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--muted)' }}>
                                {t.asignadoA ? (t.asignadoNombre ?? 'tomado') : 'sin tomar'}
                              </td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-xs" style={{ color: 'var(--muted)' }}>
                                {fechaMx(t.abiertoEn)} · {edadDe(t.abiertoEn, ahora)}
                              </td>
                              <td className="px-4 py-2.5 text-right text-xs tabular whitespace-nowrap"
                                style={{ color: sla.vencido ? 'var(--bad)' : 'var(--muted)' }}>
                                {sla.texto}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs px-4 pt-2 pb-3" style={{ color: 'var(--muted)' }}>
                    {recortado
                      ? `Se listan los ${numero(TOPE_TICKETS)} más urgentes de ${numero(total!)} tickets de todas las flotas.`
                      : `${numero(tickets.length)} ${tickets.length === 1 ? 'ticket' : 'tickets'} en total, de todas las flotas.`}
                    {' '}El reloj se deriva de <code className="font-mono">vence_en</code> contra el
                    reloj del servidor — un ticket sin SLA pactado dice &quot;sin SLA&quot;, nunca &quot;vencido&quot;.
                    {' '}El asunto abre el hilo, con responder, tomar y cerrar.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
