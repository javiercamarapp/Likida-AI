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
  Aviso, BotonEnlace, CampoSelect, TabsLinea, CampoTextarea, Casilla, Disclosure, EstadoError, EstadoVacio, StatusChip, Tarjeta, type TonoEstado,
} from '../../ui-v2/componentes';
import type { PropsCifra } from '../../ui-v2/graficas';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { uniformes } from '../cifras-uniformes';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { FormaConAviso, type ResultadoAccion } from '../ui/forma';
import { HiloTicket } from './hilo';
import { CajonTicket } from './cajon-ticket';
// El rótulo del estado del ticket vivía aquí, privado, y /dashboard/soporte imprimía `t.estado` crudo (auditoría 21, MEDIO 1). Ahora
// las dos pantallas importan el MISMO mapa — el patrón de `dashboard/estatus.ts`.
import { pillTicket } from '../../dashboard/soporte/estatus';
import '../sistema.css';
import '../resumen.css';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { getT } from '@/lib/i18n/servidor';
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
function slaDe(t: TicketCruzado, ta: TrDe<'admin_flotas'>): { texto: string; vencido: boolean } {
  if (t.horasRestantes == null) return { texto: ta('soporte.sin_sla_pactado'), vencido: false };
  if (t.horasRestantes < 0) return { texto: ta('soporte.vencido_hace_h', { Math: numero(Math.abs(Math.round(t.horasRestantes))) }), vencido: true };
  return { texto: ta('soporte.faltan_h', { Math: numero(Math.round(t.horasRestantes)) }), vencido: false };
}

const capital = (t: string): string => (t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : '—');
const tonoDe = (estado: string): TonoEstado => pillTicket(estado).estado as TonoEstado;

/** La consecuencia de un SLA vencido, a la vista: o consta que se avisó al operador (y cuándo), o consta que no. `null` = no se pudo leer. */
function ConsecuenciaSla({ t, avisos, ta }: { t: TicketCruzado; avisos: Map<string, string> | null; ta: TrDe<'admin_flotas'> }) {
  if (!slaDe(t, ta).vencido || ESTADOS_TICKET_CERRADO.has(t.estado)) return null;
  if (avisos === null) return <span className="adm-sis-sub">{ta('soporte.aviso_al_operador_sin')}</span>;
  const cuando = avisos.get(t.id);
  return cuando
    ? <span className="adm-sis-sub">{ta('soporte.se_aviso_al_operador')} {fechaHoraMx(cuando)}</span>
    : <span className="adm-sis-sub">{ta('soporte.aun_sin_aviso_al')}</span>;
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
  const { t: ta } = await getT('admin_flotas');
  const t = await resolverTicketCruzado(String(fd.get('ticket') ?? ''));
  if (!t) throw new Error(ta('soporte.ese_ticket_ya_no'));
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
  searchParams: Promise<{ ticket?: string; vista?: string }>;
}) {
  const { t: ta } = await getT('admin_flotas');
  await requireSuperadmin();
  const sp = await searchParams;
  const ahora = ahoraMs();

  // ── Las tres acciones del equipo ────────────────────────────────────────
  // El chequeo se REPITE adentro de cada una (patrón del repo): un server
  // action es un endpoint POST, y que la página lo haya comprobado al
  // renderizar no dice nada de quién manda el POST.

  async function accionResponder(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t: ta } = await getT('admin_flotas');
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
        return { ok: ta('soporte.nota_interna_guardada_el') };
      }
      return {
        ok: r.movioAEnProceso
          ? ta('soporte.respuesta_enviada_el_ticket')
          : ta('soporte.respuesta_enviada_el_cliente'),
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'responder el ticket') };
    }
  }

  async function accionTomar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t: ta } = await getT('admin_flotas');
    const s = await requireSuperadmin();
    try {
      const { id, tenantId } = await flotaDelTicket(fd);
      const r = await tomarTicket(id, tenantId, { tipo: 'likida', userId: s.userId });
      revalidatePath('/admin/soporte');
      return { ok: ta('soporte.tomado_queda_a_tu', { estado: r.estado }) };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'tomar el ticket') };
    }
  }

  async function accionEstado(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t: ta } = await getT('admin_flotas');
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
          ? ta('soporte.de_a_quedo_en', { estadoPrevio: r.estadoPrevio, estado: r.estado })
          : ta('soporte.de_a_el_cambio', { estadoPrevio: r.estadoPrevio, estado: r.estado }),
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

  // Pestañas de la plantilla TM (Rovaq «Soporte»): Abiertos / Esperando / Cerrados. «Esperando» es el estado `esperando` (la pelota está con
  // el cliente); «Cerrados» junta resuelto y cerrado; «Abiertos» es todo lo demás. Los contadores salen de la lista leída y solo se
  // pintan si no está recortada (si lo está, un contador de la lista mentiría sobre la cola); el de cerrados es el exacto de la base.
  const vista: 'abiertos' | 'esperando' | 'cerrados' = sp.vista === 'esperando' || sp.vista === 'cerrados' ? sp.vista : 'abiertos';
  const cerradoE = (e: string) => ESTADOS_TICKET_CERRADO.has(e);
  const enVista = (x: TicketCruzado) => (vista === 'cerrados' ? cerradoE(x.estado) : vista === 'esperando' ? x.estado === 'esperando' : !cerradoE(x.estado) && x.estado !== 'esperando');
  const visibles = tickets === null ? [] : tickets.filter(enVista);
  const cuentaLista = (v: 'abiertos' | 'esperando') => (tickets === null || recortado ? null : tickets.filter((x) => (v === 'esperando' ? x.estado === 'esperando' : !cerradoE(x.estado) && x.estado !== 'esperando')).length);
  const hrefVista = (v: string) => `/admin/soporte${v === 'abiertos' ? '' : `?vista=${v}`}`;
  const hrefTicket = (id: string) => `/admin/soporte?${vista === 'abiertos' ? '' : `vista=${vista}&`}ticket=${encodeURIComponent(id)}`;
  const abiertoVencidos = (tickets ?? []).filter((t) => slaDe(t, ta).vencido && !ESTADOS_TICKET_CERRADO.has(t.estado)).map((t) => t.id);
  const avisos = tickets === null ? null : await avisosDeSlaPorTicket(abiertoVencidos);

  const columnas: ColumnaTabla<TicketCruzado>[] = [
    {
      id: 'asunto', titulo: ta('soporte.asunto'), principal: true,
      celda: (t) => (
        <>
          <Link href={hrefTicket(t.id)}>{t.asunto}</Link>
          <span className="adm-sis-sub">{capital(t.categoria)}</span>
        </>
      ),
    },
    { id: 'flota', titulo: ta('soporte.flota'), celda: (t) => t.tenantNombre },
    { id: 'prioridad', titulo: ta('soporte.prioridad'), celda: (t) => capital(t.prioridad) },
    {
      id: 'estado', titulo: ta('soporte.estado'),
      celda: (t) => (
        <>
          <StatusChip tono={tonoDe(t.estado)}>{pillTicket(t.estado).etiqueta}</StatusChip>
          <span className="adm-sis-sub">{t.asignadoA ? (t.asignadoNombre ?? 'Tomado') : ta('soporte.sin_tomar')}</span>
        </>
      ),
    },
    { id: 'abierto', titulo: ta('soporte.abierto'), corta: true, celda: (t) => <>{fechaMx(t.abiertoEn)}<span className="adm-sis-sub">{edadDe(t.abiertoEn, ahora)}</span></> },
    {
      id: 'sla', titulo: 'SLA', alinear: 'der',
      celda: (t) => {
        const sla = slaDe(t, ta);
        return (
          <>
            {sla.vencido && !ESTADOS_TICKET_CERRADO.has(t.estado) ? <StatusChip tono="bad">{sla.texto}</StatusChip> : sla.texto}
            <ConsecuenciaSla ta={ta} t={t} avisos={avisos} />
          </>
        );
      },
    },
    { id: 'vr', titulo: ta('soporte.abierto'), tituloOculto: true, alinear: 'der', celda: (t) => <BotonEnlace href={hrefTicket(t.id)} variante="ghost" tamano="sm">{ta('flotas.vista_rapida')}</BotonEnlace> },
  ];
  const terminal = detalle !== null && ESTADOS_TICKET_CERRADO.has(detalle.estado);

  // Con la lectura completa, cero es un dato real (cola vacía): la tira se pinta igual (Rovaq). Una lectura caída deja la tira fuera.
  const cifras: PropsCifra[] | undefined = tickets === null ? undefined : uniformes([
      { etiqueta: ta('soporte.abiertos'), valor: conteos.abiertos, formato: 'entero', nota: ta('soporte.de_todas_las_flotas'), ...(conteos.abiertos === null ? { estado: 'error' as const, mensaje: ta('soporte.no_se_pudo_contar') } : {}) },
      { etiqueta: ta('soporte.con_sla_vencido'), valor: conteos.vencidos, formato: 'entero', tono: (conteos.vencidos ?? 0) > 0 ? 'bad' : undefined, nota: ta('soporte.paso_el_plazo_y'), ...(conteos.vencidos === null ? { estado: 'error' as const, mensaje: ta('soporte.no_se_pudo_contar') } : {}) },
      { etiqueta: ta('soporte.sin_sla_pactado'), valor: conteos.sinSla, formato: 'entero', nota: ta('soporte.no_estan_vencidos_nadie'), ...(conteos.sinSla === null ? { estado: 'error' as const, mensaje: ta('soporte.no_se_pudo_contar') } : {}) },
      { etiqueta: ta('soporte.resueltos_o_cerrados'), valor: conteos.cerrados, formato: 'entero', nota: ta('soporte.historico'), ...(conteos.cerrados === null ? { estado: 'error' as const, mensaje: ta('soporte.no_se_pudo_contar') } : {}) },
    ]);

  return (
    <EsqueletoTablaMaestra
      titulo={ta('soporte.soporte')} apoyo={ta('soporte.los_tickets_de_todas')} etiquetaCifras={ta('soporte.tickets_de_soporte')} cifras={cifras}
      filtros={tickets === null ? undefined : (
        <TabsLinea
          etiqueta={ta('soporte.vistas_de_la_cola')} actual={vista}
          pestanas={[
            { clave: 'abiertos', etiqueta: ta('soporte.abiertos'), href: hrefVista('abiertos'), conteo: cuentaLista('abiertos'), atencion: (conteos.vencidos ?? 0) > 0 },
            { clave: 'esperando', etiqueta: ta('soporte.esperando'), href: hrefVista('esperando'), conteo: cuentaLista('esperando') },
            { clave: 'cerrados', etiqueta: ta('soporte.cerrados'), href: hrefVista('cerrados'), conteo: conteos.cerrados },
          ]}
        />
      )}
    >
      {tickets === null ? (
        <EstadoError reintentar>{ta('soporte.no_se_pudo_leer')}</EstadoError>
      ) : (
        <>
          {/* ── EL HILO Y LAS ACCIONES ───────────────────────────────────── */}
          {pedido !== '' && (
            hiloFallo ? (
              <EstadoError reintentar>{ta('soporte.no_se_pudo_leer_2')}</EstadoError>
            ) : detalle === null ? (
              <EstadoVacio titulo={ta('soporte.ese_ticket_ya_no_2')} accion={<BotonEnlace href="/admin/soporte" variante="secondary" tamano="sm">{ta('soporte.volver_a_la_cola')}</BotonEnlace>}>
                
                {ta('soporte.puede_que_se_haya')}
              </EstadoVacio>
            ) : (
              <CajonTicket titulo={detalle.asunto} descripcion={flotaDelDetalle ?? undefined} hrefCerrar={hrefVista(vista)}>
                <p><StatusChip tono={tonoDe(detalle.estado)}>{pillTicket(detalle.estado).etiqueta}</StatusChip></p>
                <ul className="adm-sis-lista">
                  <li><span>Flota</span><span>{flotaDelDetalle}</span></li>
                  <li><span>{ta('soporte.categoria_y_prioridad')}</span><span>{capital(detalle.categoria)} · {capital(detalle.prioridad)}</span></li>
                  <li><span>Abierto</span><span>{fechaHoraMx(detalle.abiertoEn)}</span></li>
                  <li><span>{ta('soporte.plazo_sla')}</span><span>{detalle.venceEn ? fechaHoraMx(detalle.venceEn) : ta('soporte.sin_sla_pactado')}</span></li>
                  {/* SIN TOMAR no es "en proceso": son dos cosas distintas y se dicen distinto. */}
                  <li><span>{ta('soporte.tomado_por')}</span><span>{detalle.asignadoA ? (detalle.asignadoNombre ?? ta('soporte.alguien_del_equipo')) : ta('soporte.sin_tomar')}</span></li>
                </ul>
                {detalle.descripcion ? <p className="adm-sis-descripcion">{detalle.descripcion}</p> : null}
                <HiloTicket
                  mensajes={hilo ?? []}
                  vacio="Nadie ha escrito en este hilo todavía. Mientras no haya una respuesta pública, la alarma de «sin respuesta» del agente de Éxito sigue encendida, y con razón."
                />
                {terminal ? (
                  <Aviso tono="info" titulo={ta('soporte.este_ticket_esta_cerrado')}>
                    
                    {ta('soporte.para_escribir_en_el')}
                  </Aviso>
                ) : null}
                <div className="adm-sis-rejilla adm-forma-fina">
                  {terminal ? (
                    <div className="adm-sis-bloque">
                      <h3 className="adm-sis-titulo">Reabrir</h3>
                      <FormaConAviso accion={accionEstado} boton="Reabrir el ticket" columnas="md:grid-cols-1">
                        <input type="hidden" name="ticket" value={detalle.id} />
                        <input type="hidden" name="estado" value="abierto" />
                        <p className="adm-sis-nota">{ta('soporte.vuelve_a_abierto_borra')}</p>
                      </FormaConAviso>
                    </div>
                  ) : (
                    <div className="adm-sis-bloque">
                      <h3 className="adm-sis-titulo">Responder</h3>
                      <FormaConAviso accion={accionResponder} boton="Enviar" columnas="md:grid-cols-1">
                        <input type="hidden" name="ticket" value={detalle.id} />
                        <CampoTextarea etiqueta={ta('soporte.mensaje')} name="cuerpo" obligatorio rows={4} maxLength={LARGO_MAX_MENSAJE} placeholder={ta('soporte.que_le_vas_a')}
                          ayuda={ta('soporte.un_mensaje_publico_apaga')} />
                        <Casilla name="interna" value="1" etiqueta={ta('soporte.nota_interna_el_cliente')}
                          ayuda={ta('soporte.va_en_el_mismo')} />
                      </FormaConAviso>
                    </div>
                  )}
                  <div className="adm-sis-bloque">
                    <h3 className="adm-sis-titulo">{ta('soporte.tomar_y_mover')}</h3>
                    <FormaConAviso accion={accionTomar} boton="Tomar el ticket" columnas="md:grid-cols-1">
                      <input type="hidden" name="ticket" value={detalle.id} />
                    </FormaConAviso>
                    <FormaConAviso accion={accionEstado} boton="Cambiar estado" columnas="md:grid-cols-1">
                      <input type="hidden" name="ticket" value={detalle.id} />
                      <CampoSelect etiqueta={ta('soporte.estado')} name="estado" defaultValue={detalle.estado}
                        ayuda={ta('soporte.resuelto_y_cerrado_escriben')}>
                        {ESTADOS_TICKET.map((e) => <option key={e} value={e}>{pillTicket(e).etiqueta}</option>)}
                      </CampoSelect>
                    </FormaConAviso>
                  </div>
                </div>
              </CajonTicket>
            )
          )}

          <section className="adm-sis-bloque" aria-labelledby="cola-soporte">
            <h2 className="adm-sis-titulo" id="cola-soporte">{ta('soporte.la_cola_lo_mas')}</h2>
            {visibles.length === 0 ? (
              <Tarjeta titulo={ta('soporte.cola_de_soporte')} estado="vacio" mensaje={tickets.length === 0 ? ta('soporte.la_cola_esta_vacia') : ta('soporte.nada_en_esta_vista')} detalle={ta('soporte.ninguna_flota_tiene_nada')} />
            ) : (
            <TablaLista<TicketCruzado>
              etiqueta={ta('soporte.cola_de_soporte')} columnas={columnas} filas={visibles} idFila={(t) => t.id} base="/admin/soporte" params={{ ticket: pedido || undefined, vista: vista === 'abiertos' ? undefined : vista }}
              pie={(
                <p className="adm-sis-nota">
                  {recortado
                    ? ta('soporte.se_listan_los_mas', { TOPE_TICKETS: numero(TOPE_TICKETS), total: numero(total!) })
                    : ta('soporte.de_todas_las_flotas_2', { length: numero(tickets.length), length2: tickets.length === 1 ? 'ticket' : 'tickets' })}
                  
                  {ta('soporte.el_reloj_cuenta_contra')}
                </p>
              )}
            />
            )}
          </section>

          <Disclosure titulo={ta('soporte.que_pasa_cuando_vence')} resumen="Aviso al operador, una sola vez">
            <p className="adm-sis-nota">
              
              {ta('soporte.un_ticket_abierto_cuyo')}
            </p>
          </Disclosure>
        </>
      )}
    </EsqueletoTablaMaestra>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t: ta } = await getT('admin_flotas');
  return { title: ta('soporte.soporte') };
}
