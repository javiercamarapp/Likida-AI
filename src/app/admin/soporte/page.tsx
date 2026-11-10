import type { Metadata } from 'next';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
// Los estados terminales viven junto a la lectura (lib/admin/soporte.ts), y desde FE-11 el conteo de abiertos/cerrados también: la
// pantalla ya no reclasifica en memoria una lista que además viene acotada.
import {
  getTicketsCruzados, contarTickets, resolverTicketCruzado, TOPE_TICKETS, ESTADOS_TICKET_CERRADO,
  type TicketCruzado, type ConteosTickets,
} from '@/lib/admin/soporte';
import { avisosDeSlaPorTicket } from '@/lib/admin/soporte-escalado';
import {
  getTicketDelTenant, getHilo, responderTicket, tomarTicket, cambiarEstadoTicket,
  ESTADOS_TICKET, LARGO_MAX_MENSAJE,
  type MensajeHilo, type TicketDetalle,
} from '@/lib/likida/soporte';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { ahoraMs } from '@/lib/saludo';
import { fechaMx, fechaHoraMx, numero } from '@/lib/formato';
import {
  Aviso, BotonEnlace, CampoSelect, CampoTextarea, Casilla, Disclosure, EstadoError, EstadoVacio, MarcoPagina, StatusChip, Tarjeta, type TonoEstado,
} from '../../ui-v2/componentes';
import { TiraCifras } from '../../ui-v2/graficas';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { HiloTicket } from './hilo';
// El rótulo del estado del ticket vivía aquí, privado, y /dashboard/soporte imprimía `t.estado` crudo (auditoría 21, MEDIO 1). Ahora
// las dos pantallas importan el MISMO mapa — el patrón de `dashboard/estatus.ts`.
import { pillTicket } from '../../dashboard/soporte/estatus';
import '../sistema.css';

export const dynamic = 'force-dynamic';

/** "hace 3 h" / "hace 2 d" — la edad del ticket contra el reloj del SERVIDOR (`ahoraMs()`), el mismo contra el que se resta el SLA: dos
 *  relojes en la misma fila terminan contándose historias distintas. */
function edadDe(abiertoEn: string, ahora: number): string {
  const horas = (ahora - new Date(abiertoEn).getTime()) / 3_600_000;
  if (horas < 1) return 'hace menos de 1 h';
  if (horas < 48) return `hace ${Math.floor(horas)} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

/** El reloj de SLA de la fila — mismas tres verdades que /dashboard/soporte: sin SLA no hay reloj, vencido se dice con cuánto, y lo
 *  demás es lo que falta. */
function slaDe(t: TicketCruzado): { texto: string; vencido: boolean } {
  if (t.horasRestantes == null) return { texto: 'Sin SLA pactado', vencido: false };
  if (t.horasRestantes < 0) return { texto: `Vencido hace ${numero(Math.abs(Math.round(t.horasRestantes)))} h`, vencido: true };
  return { texto: `Faltan ${numero(Math.round(t.horasRestantes))} h`, vencido: false };
}

const capital = (t: string): string => (t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : '—');
const tonoDe = (estado: string): TonoEstado => pillTicket(estado).estado as TonoEstado;

/** La consecuencia de un SLA vencido, a la vista: o consta que se avisó al operador (y cuándo), o consta que no. `null` = no se pudo leer. */
function ConsecuenciaSla({ t, avisos }: { t: TicketCruzado; avisos: Map<string, string> | null }) {
  if (!slaDe(t).vencido || ESTADOS_TICKET_CERRADO.has(t.estado)) return null;
  if (avisos === null) return <span className="adm-sis-sub">Aviso al operador: sin dato</span>;
  const cuando = avisos.get(t.id);
  return cuando
    ? <span className="adm-sis-sub">Se avisó al operador · {fechaHoraMx(cuando)}</span>
    : <span className="adm-sis-sub">Aún sin aviso al operador</span>;
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

  const abiertoVencidos = (tickets ?? []).filter((t) => slaDe(t).vencido && !ESTADOS_TICKET_CERRADO.has(t.estado)).map((t) => t.id);
  const avisos = tickets === null ? null : await avisosDeSlaPorTicket(abiertoVencidos);

  const columnas: ColumnaTabla<TicketCruzado>[] = [
    {
      id: 'asunto', titulo: 'Asunto', principal: true,
      celda: (t) => (
        <>
          <Link href={`/admin/soporte?ticket=${encodeURIComponent(t.id)}`}>{t.asunto}</Link>
          <span className="adm-sis-sub">{capital(t.categoria)}</span>
        </>
      ),
    },
    { id: 'flota', titulo: 'Flota', celda: (t) => t.tenantNombre },
    { id: 'prioridad', titulo: 'Prioridad', celda: (t) => capital(t.prioridad) },
    {
      id: 'estado', titulo: 'Estado',
      celda: (t) => (
        <>
          <StatusChip tono={tonoDe(t.estado)}>{pillTicket(t.estado).etiqueta}</StatusChip>
          <span className="adm-sis-sub">{t.asignadoA ? (t.asignadoNombre ?? 'Tomado') : 'Sin tomar'}</span>
        </>
      ),
    },
    { id: 'abierto', titulo: 'Abierto', corta: true, celda: (t) => <>{fechaMx(t.abiertoEn)}<span className="adm-sis-sub">{edadDe(t.abiertoEn, ahora)}</span></> },
    {
      id: 'sla', titulo: 'SLA', alinear: 'der',
      celda: (t) => {
        const sla = slaDe(t);
        return (
          <>
            {sla.vencido && !ESTADOS_TICKET_CERRADO.has(t.estado) ? <StatusChip tono="bad">{sla.texto}</StatusChip> : sla.texto}
            <ConsecuenciaSla t={t} avisos={avisos} />
          </>
        );
      },
    },
  ];
  const terminal = detalle !== null && ESTADOS_TICKET_CERRADO.has(detalle.estado);

  return (
    <MarcoPagina titulo="Soporte" apoyo="Los tickets de todas las flotas: lo más urgente primero, sin plazo al final.">
      {tickets === null ? (
        <EstadoError reintentar>No se pudo leer la cola de tickets. La consulta falló: no es que no haya tickets, es que no se pudo mirar.</EstadoError>
      ) : (
        <>
          <TiraCifras etiqueta="Tickets de soporte" items={[
            { etiqueta: 'Abiertos', valor: conteos.abiertos, formato: 'entero', nota: 'De todas las flotas.', ...(conteos.abiertos === null ? { estado: 'error' as const, mensaje: 'No se pudo contar.' } : {}) },
            { etiqueta: 'Con SLA vencido', valor: conteos.vencidos, formato: 'entero', tono: (conteos.vencidos ?? 0) > 0 ? 'bad' : undefined, nota: 'Pasó el plazo y siguen sin cerrarse.', ...(conteos.vencidos === null ? { estado: 'error' as const, mensaje: 'No se pudo contar.' } : {}) },
            { etiqueta: 'Sin SLA pactado', valor: conteos.sinSla, formato: 'entero', nota: 'No están vencidos: nadie les puso plazo.', ...(conteos.sinSla === null ? { estado: 'error' as const, mensaje: 'No se pudo contar.' } : {}) },
            { etiqueta: 'Resueltos o cerrados', valor: conteos.cerrados, formato: 'entero', nota: 'Histórico.', ...(conteos.cerrados === null ? { estado: 'error' as const, mensaje: 'No se pudo contar.' } : {}) },
          ]} />

          {/* ── EL HILO Y LAS ACCIONES ───────────────────────────────────── */}
          {pedido !== '' && (
            hiloFallo ? (
              <EstadoError reintentar>No se pudo leer ese hilo. No significa que esté vacío: contestar sin ver lo que ya se dijo es como se manda dos veces la misma respuesta.</EstadoError>
            ) : detalle === null ? (
              <EstadoVacio titulo="Ese ticket ya no existe" accion={<BotonEnlace href="/admin/soporte" variante="secondary" tamano="sm">Volver a la cola</BotonEnlace>}>
                Puede que se haya borrado con la flota. La cola de abajo es lo que sí hay.
              </EstadoVacio>
            ) : (
              <Tarjeta titulo={detalle.asunto} acciones={<><StatusChip tono={tonoDe(detalle.estado)}>{pillTicket(detalle.estado).etiqueta}</StatusChip><BotonEnlace href="/admin/soporte" variante="ghost" tamano="sm">Volver a la cola</BotonEnlace></>}>
                <ul className="adm-sis-lista">
                  <li><span>Flota</span><span>{flotaDelDetalle}</span></li>
                  <li><span>Categoría y prioridad</span><span>{capital(detalle.categoria)} · {capital(detalle.prioridad)}</span></li>
                  <li><span>Abierto</span><span>{fechaHoraMx(detalle.abiertoEn)}</span></li>
                  <li><span>Plazo (SLA)</span><span>{detalle.venceEn ? fechaHoraMx(detalle.venceEn) : 'Sin SLA pactado'}</span></li>
                  {/* SIN TOMAR no es "en proceso": son dos cosas distintas y se dicen distinto. */}
                  <li><span>Tomado por</span><span>{detalle.asignadoA ? (detalle.asignadoNombre ?? 'Alguien del equipo') : 'Sin tomar'}</span></li>
                </ul>
                {detalle.descripcion ? <p className="adm-sis-descripcion">{detalle.descripcion}</p> : null}
                <HiloTicket
                  mensajes={hilo ?? []}
                  vacio="Nadie ha escrito en este hilo todavía. Mientras no haya una respuesta pública, la alarma de «sin respuesta» del agente de Éxito sigue encendida, y con razón."
                />
                {terminal ? (
                  <Aviso tono="info" titulo="Este ticket está cerrado">
                    Para escribir en el hilo, una respuesta o una nota, primero hay que reabrirlo.
                  </Aviso>
                ) : null}
                <div className="adm-sis-rejilla">
                  {terminal ? (
                    <div className="adm-sis-bloque">
                      <h3 className="adm-sis-titulo">Reabrir</h3>
                      <FormaConAviso accion={accionEstado} boton="Reabrir el ticket" columnas="md:grid-cols-1">
                        <input type="hidden" name="ticket" value={detalle.id} />
                        <input type="hidden" name="estado" value="abierto" />
                        <p className="adm-sis-nota">Vuelve a «abierto», borra la fecha de resolución y deja el cambio en la bitácora. La flota ve que se reabrió.</p>
                      </FormaConAviso>
                    </div>
                  ) : (
                    <div className="adm-sis-bloque">
                      <h3 className="adm-sis-titulo">Responder</h3>
                      <FormaConAviso accion={accionResponder} boton="Enviar" columnas="md:grid-cols-1">
                        <input type="hidden" name="ticket" value={detalle.id} />
                        <CampoTextarea etiqueta="Mensaje" name="cuerpo" obligatorio rows={4} maxLength={LARGO_MAX_MENSAJE} placeholder="Qué le vas a decir a la flota"
                          ayuda="Un mensaje público apaga la alarma de «sin respuesta»; una nota interna, no." />
                        <Casilla name="interna" value="1" etiqueta="Nota interna: el cliente NO la ve"
                          ayuda="Va en el mismo hilo para que el orden sea uno solo, pero el panel del cliente la excluye." />
                      </FormaConAviso>
                    </div>
                  )}
                  <div className="adm-sis-bloque">
                    <h3 className="adm-sis-titulo">Tomar y mover</h3>
                    <FormaConAviso accion={accionTomar} boton="Tomar el ticket" columnas="md:grid-cols-1">
                      <input type="hidden" name="ticket" value={detalle.id} />
                    </FormaConAviso>
                    <FormaConAviso accion={accionEstado} boton="Cambiar estado" columnas="md:grid-cols-1">
                      <input type="hidden" name="ticket" value={detalle.id} />
                      <CampoSelect etiqueta="Estado" name="estado" defaultValue={detalle.estado}
                        ayuda="Resuelto y cerrado escriben la fecha de resolución; salir de ellos la borra.">
                        {ESTADOS_TICKET.map((e) => <option key={e} value={e}>{pillTicket(e).etiqueta}</option>)}
                      </CampoSelect>
                    </FormaConAviso>
                  </div>
                </div>
              </Tarjeta>
            )
          )}

          <section className="adm-sis-bloque" aria-labelledby="cola-soporte">
            <h2 className="adm-sis-titulo" id="cola-soporte">La cola, lo más urgente primero</h2>
            <TablaLista<TicketCruzado>
              etiqueta="Cola de soporte" columnas={columnas} filas={tickets} idFila={(t) => t.id} base="/admin/soporte" params={{ ticket: pedido || undefined }}
              vacio={{ titulo: 'La cola está vacía', texto: 'Ninguna flota tiene nada pendiente con Likida. Los tickets entran desde el panel de cada cliente.' }}
              pie={(
                <p className="adm-sis-nota">
                  {recortado
                    ? `Se listan los ${numero(TOPE_TICKETS)} más urgentes de ${numero(total!)} tickets de todas las flotas. `
                    : `${numero(tickets.length)} ${tickets.length === 1 ? 'ticket' : 'tickets'} de todas las flotas. `}
                  El reloj cuenta contra el plazo pactado al abrir el ticket; uno sin plazo dice «sin SLA», nunca «vencido». El asunto abre el hilo.
                </p>
              )}
            />
          </section>

          <Disclosure titulo="Qué pasa cuando vence un plazo" resumen="Aviso al operador, una sola vez">
            <p className="adm-sis-nota">
              Un ticket abierto cuyo plazo ya pasó se avisa una vez al operador, por correo y por WhatsApp, siempre que esos canales estén configurados. La columna SLA dice
              si consta ese aviso (y cuándo) o si todavía no hay; no se infiere un aviso que no quedó registrado. Un mensaje nuevo de la flota también avisa.
            </p>
          </Disclosure>
        </>
      )}
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Soporte' };
