import Link from 'next/link';
import { revalidatePath } from 'next/cache';
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
  TablaBase, Tarjeta, StatusChip, BotonEnlace, FormaConAviso, FormaEnCajon, TabsLinea, CampoTexto, CampoTextarea, CampoSelect, EstadoError,
  type ColumnaBase, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { CajonTicket } from './cajon-ticket';
import './soporte.css';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('resto');
  return { title: t('cfg.centro_de_ayuda') };
}

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
  searchParams: Promise<{ vista?: string; tenant?: string; ticket?: string; estado?: string }>;
}) {
  const { t, idioma } = await getT('resto');
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
      return { ok: t('cfg.ticket_abierto_el_equipo_de_likida') };
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
      return { ok: t('cfg.mensaje_enviado_queda_en_el_hilo') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, t('cfg.escribir_en_el_ticket')) };
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
          ? t('cfg.ticket_cerrado_si_vuelve_a_pasar')
          : t('cfg.ticket_reabierto_vuelve_a_la_cola'),
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, t('cfg.cambiar_el_estado_del_ticket')) };
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

  // Rótulos con mayúscula y acentos para los valores del dominio (nunca el enum crudo en pantalla); fuera del dominio se enseña tal cual.
  const rotCategoria = (c: string): string => ({
    facturacion: t('e27.sop_cat_facturacion'), operacion: t('e27.sop_cat_operacion'), tecnico: t('e27.sop_cat_tecnico'), cuenta: t('e27.sop_cat_cuenta'), otro: t('e27.sop_cat_otro'),
  } as Record<string, string>)[c] ?? c;
  const rotPrioridad = (p: string): string => ({
    baja: t('e27.sop_pri_baja'), media: t('e27.sop_pri_media'), alta: t('e27.sop_pri_alta'), urgente: t('e27.sop_pri_urgente'),
  } as Record<string, string>)[p] ?? p;

  const columnas: ColumnaBase<TicketRow>[] = [
    { id: 'asunto', titulo: t('cfg.asunto'), principal: true, celda: (t) => <Link href={enlaceHilo(t.id)} className="rv-sop__enlace">{t.asunto}</Link> },
    { id: 'categoria', titulo: t('cfg.categoria'), celda: (x) => <span className="rv-sop__tenue">{rotCategoria(x.categoria)}</span> },
    { id: 'prioridad', titulo: t('cfg.prioridad'), celda: (x) => rotPrioridad(x.prioridad) },
    {
      id: 'estado', titulo: t('llaves.estado'),
      celda: (t) => { const pill = pillTicket(t.estado); return <StatusChip tono={pill.estado}>{pill.etiqueta}</StatusChip>; },
    },
    { id: 'abierto', titulo: t('cfg.abierto'), celda: (t) => <span className="rv-sop__tenue">{fechaMx(t.abiertoEn, idioma)}</span> },
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


  // Pestañas Abiertos / Cerrados (Rovaq): la URL manda y cada una cuenta lo suyo; un ticket resuelto o cerrado ya no está en la cola.
  const verCerrados = sp.estado === 'cerrados';
  const cerradosLista = tickets?.filter((x) => x.estado === 'resuelto' || x.estado === 'cerrado') ?? [];
  const hrefPestana = (cerrados: boolean) => `/dashboard/soporte${cerrados ? `?estado=cerrados${sufijo ? `&${sufijo}` : ''}` : sufijo ? `?${sufijo}` : ''}`;
  const visibles = tickets ? (verCerrados ? cerradosLista : abiertos) : [];

  return (
    <EsqueletoTablaMaestra
      titulo={t('cfg.centro_de_ayuda')} apoyo={t('cfg.tickets_prioridad_reloj_de_sla_y')}
      filtros={tickets ? (
        <div className="rv-sop__barra">
          <TabsLinea etiqueta={t('cfg.solicitudes_de_soporte')} actual={verCerrados ? 'cerrados' : 'abiertos'} pestanas={[
            { clave: 'abiertos', etiqueta: t('cfg.abiertos'), href: hrefPestana(false), conteo: abiertos.length, atencion: vencidos.length > 0 },
            { clave: 'cerrados', etiqueta: t('e26.sop_cerrados'), href: hrefPestana(true), conteo: cerradosLista.length },
          ]} />
        </div>
      ) : undefined}
      // La acción principal vive en la cabecera de la página, junto al h1 (Rovaq), no en una fila propia entre la tira y la tabla.
      acciones={tickets ? (
        <span className="rv-sop__cab">
          <FormaEnCajon id="abrir-ticket" titulo={t('cfg.abrir_un_ticket')} accion={accionAbrirTicket} boton={t('cfg.abrir_ticket')} disparador={t('cfg.abrir_ticket')} abiertoInicial={false}>
            <CampoTexto etiqueta={t('cfg.asunto')} name="asunto" required placeholder={t('cfg.que_paso_en_una_linea')} />
            <CampoSelect etiqueta={t('cfg.categoria')} name="categoria" defaultValue="otro">
                {CATEGORIAS_TICKET.map((c) => <option key={c} value={c}>{rotCategoria(c)}</option>)}
            </CampoSelect>
            <CampoSelect etiqueta={t('cfg.prioridad')} name="prioridad" defaultValue="media">
                {PRIORIDADES_TICKET.map((p) => <option key={p} value={p}>{rotPrioridad(p)}</option>)}
            </CampoSelect>
            <CampoTexto etiqueta={t('cfg.detalle')} name="descripcion" placeholder={t('cfg.opcional_folios_pantalla_que_esperabas')} />
          </FormaEnCajon>
        </span>
      ) : undefined}
      cifras={tickets ? [
        { etiqueta: t('cfg.abiertos'), info: 'soporte.abiertos', valor: abiertos.length, nota: t('e27.sop_abiertos_nota') },
        { etiqueta: t('cfg.sla_vencido'), info: 'soporte.sla_vencido', valor: vencidos.length, tono: vencidos.length > 0 ? 'bad' : undefined, nota: t('e27.sop_vencido_nota') },
        { etiqueta: t('cfg.sin_sla_pactado'), info: 'soporte.sin_sla', valor: sinSla.length, nota: t('cfg.no_estan_vencidos_nadie_les_puso') },
      ] : undefined}
      etiquetaCifras={t('cfg.centro_de_ayuda')}
      pie={tickets && visibles.length > 0 ? t('cfg.el_asunto_abre_la_conversacion_con') : undefined}
      vistaRapida={pedido !== '' ? (
        <CajonTicket
          titulo={detalle ? detalle.asunto : t('cfg.conversacion')} hrefCerrar={verCerrados ? hrefPestana(true) : enlaceVolver}
          subtitulo={detalle ? `${t('cfg.abierto_2', { categoria: rotCategoria(detalle.categoria), prioridad: rotPrioridad(detalle.prioridad), fechaHoraMx: fechaHoraMx(detalle.abiertoEn, idioma) })}${detalle.venceEn ? ` · vence ${fechaHoraMx(detalle.venceEn, idioma)}` : ' · sin SLA pactado'}${detalle.resueltoEn ? ` · resuelto ${fechaHoraMx(detalle.resueltoEn, idioma)}` : ''}` : undefined}
        >
          <div className="rv-sop__hilo">
            {hiloFallo ? (
              <EstadoError reintentar>{t('cfg.no_se_pudo_leer_la_conversacion')}</EstadoError>
            ) : detalle === null ? (
              <p className="rv-sop__nota">{t('cfg.ese_ticket_no_es_de_tu')}</p>
            ) : (
              <>
                {detalle.descripcion && <p className="rv-sop__descripcion">{detalle.descripcion}</p>}

                <HiloSoporte
                  mensajes={hilo ?? []}
                  vacio={t('cfg.todavia_no_hay_respuesta_de_likida')}
                />

                {cerrado ? (
                  <FormaConAviso accion={accionEstado} boton={t('cfg.reabrir_el_ticket')} columnas="md:grid-cols-1">
                    <input type="hidden" name="ticket" value={detalle.id} />
                    <input type="hidden" name="estado" value="abierto" />
                    <p className="rv-sop__nota">{t('cfg.este_ticket_esta_cerrado_si_el')}</p>
                  </FormaConAviso>
                ) : (
                  <div className="rv-sop__acciones">
                    <FormaConAviso accion={accionResponder} boton="Enviar" columnas="md:grid-cols-1">
                      <input type="hidden" name="ticket" value={detalle.id} />
                      <CampoTextarea etiqueta={t('cfg.escribir_en_el_ticket_2')} name="cuerpo" required rows={3} maxLength={LARGO_MAX_MENSAJE}
                        placeholder={t('cfg.agrega_un_dato_un_folio_o')} />
                    </FormaConAviso>
                    <FormaConAviso accion={accionEstado} boton={t('cfg.cerrar_el_ticket')} columnas="md:grid-cols-1">
                      <input type="hidden" name="ticket" value={detalle.id} />
                      <input type="hidden" name="estado" value="cerrado" />
                      <p className="rv-sop__nota">{t('cfg.si_ya_quedo_cierralo_se_puede')}</p>
                    </FormaConAviso>
                  </div>
                )}
                <div><BotonEnlace href={enlaceVolver} variante="ghost" tamano="sm">{t('cfg.volver_a_mis_tickets')}</BotonEnlace></div>
              </>
            )}
          </div>
        </CajonTicket>
      ) : null}
    >
      {!tickets ? (
        <EstadoError reintentar>{t('cfg.no_se_pudo_leer_la_cola')}</EstadoError>
      ) : (
        visibles.length === 0 ? (
          // El vacío vive DENTRO de su tarjeta (Rovaq `.pc-card`), nunca suelto sobre el lienzo.
          <Tarjeta titulo={t('cfg.solicitudes_de_soporte')} estado="vacio" mensaje={verCerrados ? t('e26.sop_sin_cerrados') : t('cfg.no_hay_tickets_abiertos')} detalle={verCerrados ? undefined : t('cfg.la_cola_registra_prioridad_categoria_y')} contenida />
        ) : (
          <TablaBase
            etiqueta={t('cfg.solicitudes_de_soporte')} columnas={columnas} filas={visibles} idFila={(x) => x.id} densa altoMaximo={false} tarjetaMovil className="rv-sop__tabla"
          />
        )
      )}
    </EsqueletoTablaMaestra>
  );
}
