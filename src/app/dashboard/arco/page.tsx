import { getT } from '@/lib/i18n/servidor';
import { type Tr } from '@/lib/i18n/dinero_tr';
import { Clock, CircleAlert, Inbox } from 'lucide-react';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { revalidatePath } from 'next/cache';
import {
  listarSolicitudesArco, resolverSolicitudArco, ejecutarCancelacionArco, ejecutarOposicionArco,
} from '@/lib/likida/repo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { fechaMx, hoyMx } from '@/lib/formato';
import { venceDentroDe, yaVencio, DIAS_VENCE_PRONTO } from './vencimiento';
import type { Metadata } from 'next';
import {
  CampoTexto, EstadoError, EstadoVacio, FormaConAviso, Icono, MarcoPagina, StatusChip, Tarjeta,
  type ResultadoAccion, type TonoEstado,
} from '@/app/ui-v2/componentes';
import './arco.css';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.arco') };
}

export const dynamic = 'force-dynamic';

const etiquetaTipo = (tr: Tr): Record<string, string> => ({
  acceso: 'Acceso', rectificacion: tr('arco.page.rectificacion'), cancelacion: tr('arco.page.cancelacion'), oposicion: tr('arco.page.oposicion'),
});
const estadoArco = (tr: Tr): Record<string, { rotulo: string; tono: TonoEstado }> => ({
  resuelta: { rotulo: tr('arco.page.resuelta'), tono: 'ok' },
  improcedente: { rotulo: tr('arco.page.improcedente'), tono: 'neutral' },
  en_proceso: { rotulo: tr('arco.page.enProceso'), tono: 'warn' },
  recibida: { rotulo: tr('arco.page.recibida'), tono: 'warn' },
});
type Params = { tenant?: string; vista?: string; rol?: string };
const RUTA = '/dashboard/arco';
// AUDITORÍA 28, LEG-A6 [ALTO]: la lista era CERRADA y le faltaban tres
// categorías que la RPC (0286/0290) SÍ deja intactas — ver el comentario de
// `ejecutarCancelacionArco` (repo.ts) con las tablas y migraciones exactas:
// eventos de cámara/telemetría ligados al operador (180/365 días, mig. 0335)
// y su registro de jornada (0241). LEG-M5 (0356) cerró la tercera: el
// contacto de emergencia (un TERCERO, no el titular) ya NO sobrevive — la
// cancelación lo borra, no requiere revisión aparte. Se mantiene
// sincronizada con el texto de repo.ts.
const alcanceCancelacion = (tr: Tr): string => tr('arco.page.seSustituyeronElNombre');

/**
 * AUDITORÍA 24 — las tres acciones de esta pantalla se gateaban con
 * `requireSessionTenant` a secas: solo «hay sesión y tiene flota». La PÁGINA
 * sí gatea (`resolverTenantEfectivo` corre `puedeVerRuta`), pero una server
 * action es un endpoint POST que no hereda esa puerta, y un encargado —que ve
 * el área `operacion`, y por tanto esta ruta— podía resolver una solicitud
 * ARCO, sustituir datos del registro operativo y borrar conversaciones con un
 * POST a mano. Contestarle a un titular en nombre del responsable obligado
 * (LFPDPPP art. 31) es CONTROL de la cuenta: `puedeAdministrar`.
 */
const noAutorizado = (tr: Tr): string => tr('arco.page.tuRolNoPuede');
function puedeResponderArco(rol: string): boolean {
  return puedeVerRuta(rol, RUTA) && puedeAdministrar(rol);
}

/**
 * Solicitudes ARCO de ESTA flota — la responsable obligada a contestar en 20
 * días hábiles (LFPDPPP 2025 art. 31). AUDITORÍA 16: antes vivía solo en /admin
 * (superadmin), y la flota no tenía dónde ver sus solicitudes ni responderlas.
 */
export default async function ArcoPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { t: tr } = await getT('dinero');
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo(RUTA, sp);
  // AUDITORÍA 16, ALTO (arquitectura): `Date.now()` en el render rompe la
  // puerta de pureza del repo; la fecha se inyecta desde el servidor.
  //
  // DAT-08 (auditoría prod): y ese día tiene que ser el DE MÉXICO. Con el día
  // UTC, a partir de las 18:00 una solicitud ARCO que vence HOY se pintaba
  // como vencida —el plazo del art. 31 de la LFPDPPP corre en días hábiles de
  // México, no de Londres— y la de mañana entraba en "vencen pronto" un día
  // antes de tiempo.
  const hoy = hoyMx();

  async function accionResponder(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    // AUDITORÍA 16, MEDIO: el superadmin que previsualiza una flota real
    // (?tenant=t-otra) no podía resolver — el action usaba el tenant de sesión.
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeResponderArco(s.rol)) return { error: noAutorizado(tr) };
    let tenantEfectivo = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      const { resolverTenantPedido } = await import('@/lib/auth/tenant-api');
      tenantEfectivo = await resolverTenantPedido(supabaseAdmin(), tenantEfectivo, sp.tenant);
    }
    const resolucion = String(fd.get('resolucion') ?? '').trim();
    const solicitudId = String(fd.get('solicitudId') ?? '');
    if (!solicitudId) return { error: tr('arco.page.faltaLaSolicitud') };
    if (resolucion.length < 5) return { error: tr('arco.page.escribeLaRespuestaQue') };
    try {
      const r = await resolverSolicitudArco(tenantEfectivo, solicitudId, resolucion);
      revalidatePath(RUTA);
      return r.enviada
        ? { ok: tr('arco.page.solicitudResueltaYLa') }
        : { ok: tr('arco.page.solicitudResueltaLaRespuesta', { v: r.error ? ` (${r.error})` : '' }) };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'resolver la solicitud') };
    }
  }

  // AUDITORÍA 19 (legal, reincidente #5): `ejecutar_arco_cancelacion` (0178)
  // existía sin un solo llamador — una cancelación se "resolvía" escribiendo
  // prosa sin que la base cambiara. Este botón la ejecuta DE VERDAD:
  // sustituye nombre y teléfono del registro operativo, borra conversaciones y la
  // RPC misma deja la solicitud resuelta con la evidencia de qué tocó. El
  // humano firma (aprieta el botón); el sistema ejecuta — en ese orden.
  async function accionEjecutarCancelacion(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeResponderArco(s.rol)) return { error: noAutorizado(tr) };
    let tenantEfectivo = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      const { resolverTenantPedido } = await import('@/lib/auth/tenant-api');
      tenantEfectivo = await resolverTenantPedido(supabaseAdmin(), tenantEfectivo, sp.tenant);
    }
    const solicitudId = String(fd.get('solicitudId') ?? '');
    if (!solicitudId) return { error: tr('arco.page.faltaLaSolicitud') };
    try {
      const r = await ejecutarCancelacionArco(tenantEfectivo, solicitudId);
      revalidatePath(RUTA);
      if (!r.ok) return { error: tr('arco.page.noSeEjecutoLa', { motivo: r.motivo ?? '' }) };
      // 0442: titular que es cuenta de oficina — si el login de Auth no se pudo
      // borrar, se DICE (quedó baneado), no se afirma un borrado que no ocurrió.
      if (r.errorAuth) {
        return { error: tr('arco.page.laCuentaQuedoAnonimizada', { errorAuth: r.errorAuth }) };
      }
      // A36-R03-03: si no se pudieron omitir las entregas de liquidación por
      // correo pendientes del operador, se DICE (podrían salir a su correo).
      const aviso = r.errorEntregas ? ' ' + tr('arco.page.atencionNoSePudieron', { errorEntregas: r.errorEntregas }) : '';
      return r.avisada
        ? { ok: tr('arco.page.seConfirmoPorWhatsapp', { ALCANCE_CANCELACION: alcanceCancelacion(tr), aviso }) }
        : { ok: tr('arco.page.laConfirmacionNoSalio', { ALCANCE_CANCELACION: alcanceCancelacion(tr), v: r.errorAviso ? ` (${r.errorAviso})` : '', aviso }) };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'ejecutar la cancelación') };
    }
  }

  // AUDITORÍA 20 (legal, reincidente #5 OTRA VEZ): `ejecutar_arco_oposicion`
  // es la gemela de la de arriba —misma migración 0178, mismo grant— y
  // también nació sin llamador. Una oposición se cerraba escribiendo "listo"
  // y no quedaba evidencia estructurada de nada.
  //
  // NO CIERRA LA SOLICITUD, y por eso este botón convive con el de Responder
  // en vez de sustituirlo: la RPC deja la solicitud `en_proceso` con
  // `oposicion_automatizada_vigente` y declara que requiere revisión humana.
  // Primero se registra la constancia, después la persona contesta al titular.
  async function accionRegistrarOposicion(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeResponderArco(s.rol)) return { error: noAutorizado(tr) };
    let tenantEfectivo = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      const { resolverTenantPedido } = await import('@/lib/auth/tenant-api');
      tenantEfectivo = await resolverTenantPedido(supabaseAdmin(), tenantEfectivo, sp.tenant);
    }
    const solicitudId = String(fd.get('solicitudId') ?? '');
    if (!solicitudId) return { error: tr('arco.page.faltaLaSolicitud') };
    try {
      const r = await ejecutarOposicionArco(tenantEfectivo, solicitudId);
      revalidatePath(RUTA);
      if (!r.ok) return { error: tr('arco.page.noSeRegistroLa', { motivo: r.motivo ?? '' }) };
      return {
        ok: tr('arco.page.oposicionRegistrada'),
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'registrar la oposición') };
    }
  }

  // AUDITORÍA 16, ALTO (operabilidad): fail-cerrado — una base caída NO se
  // pinta como "Ninguna solicitud registrada" (la regla del repo). El error de
  // lectura se muestra; solo el vacío REAL es vacío.
  let solicitudes: Awaited<ReturnType<typeof listarSolicitudesArco>> = [];
  let errorCarga: string | null = null;
  try {
    solicitudes = await listarSolicitudesArco(tenantId);
  } catch (e) {
    errorCarga = e instanceof Error ? e.message : String(e);
  }
  const pendientes = solicitudes.filter((s) => s.estado === 'recibida' || s.estado === 'en_proceso');
  // AUDITORÍA 18, ALTO (A14): antes era `venceEn <= hoy` — "ya venció", no
  // "faltan ≤ 5 días". Lo vencido se cuenta APARTE: es incumplimiento del
  // art. 31, no algo que esté por pasar.
  const vencenPronto = pendientes.filter((s) => venceDentroDe(s.venceEn, hoy, DIAS_VENCE_PRONTO));
  const vencidas = pendientes.filter((s) => yaVencio(s.venceEn, hoy));

  return (
    <MarcoPagina titulo={tr('arco.page.solicitudesArco')} apoyo={tr('arco.page.solicitudesDeTusOperadores2')}>
      {/* H7 (auditoría 24): las tres cifras salían de `solicitudes`, que es `[]` TANTO si de verdad no hay solicitudes COMO si la lectura de arriba falló (`errorCarga`). Con la base caída, "0 vencidas sin responder" es la mentira que un responsable obligado por el art. 31 no se puede permitir. `null` es NO MEDIBLE ("—", no "0"); el aviso de abajo explica por qué. */}
      <TiraCifras sello={selloHoy(tr('arco.page.selloArco'))}>
        <Cifra icono={<Icono icono={Inbox} />} etiqueta={tr('arco.page.porResponder')} info="arco.por_responder" valor={errorCarga ? null : pendientes.length} />
        <Cifra icono={<Icono icono={Clock} />} etiqueta={tr('arco.page.vencenProntoDias', { DIAS_VENCE_PRONTO })} info="arco.vencen_pronto" valor={errorCarga ? null : vencenPronto.length} />
        <Cifra icono={<Icono icono={CircleAlert} />} etiqueta={tr('arco.page.vencidasSinResponder')} info="arco.vencidas" valor={errorCarga ? null : vencidas.length} />
      </TiraCifras>

      <Tarjeta titulo={tr('arco.page.solicitudesDeTusOperadores')} info="arco.solicitudes">
        {errorCarga ? (
          <EstadoError reintentar>
            {tr('arco.page.noSePudieronLeer', { v: errorCarga.slice(0, 120) })}
          </EstadoError>
        ) : solicitudes.length === 0 ? (
          <EstadoVacio titulo={tr('arco.page.sinSolicitudesArco')} contenido>
            {tr('arco.page.cuandoUnOperadorEscribe')}
          </EstadoVacio>
        ) : (
          <ul className="rv-arco__lista" aria-label={tr('arco.page.solicitudesDeDerechosArco')}>
            {solicitudes.map((s) => {
              const e = estadoArco(tr)[s.estado] ?? estadoArco(tr).recibida;
              const cerrada = s.estado === 'resuelta' || s.estado === 'improcedente';
              return (
                <li key={s.id} className="rv-arco__item">
                  <div className="rv-arco__cabeza">
                    <strong>{etiquetaTipo(tr)[s.tipo] ?? s.tipo}</strong>
                    <StatusChip tono={e.tono}>{e.rotulo}</StatusChip>
                    {!cerrada && yaVencio(s.venceEn, hoy) && <StatusChip tono="bad">{tr('arco.page.vencida')}</StatusChip>}
                  </div>
                  <dl className="rv-arco__datos">
                    <div><dt>{tr('arco.page.recibida')}</dt><dd>{fechaMx(s.recibidaEn)}</dd></div>
                    <div><dt>{tr('arco.page.vence')}</dt><dd>{fechaMx(s.venceEn)}</dd></div>
                    <div><dt>{tr('arco.page.titular')}</dt><dd>{s.operadorNombre ?? '—'}<span className="rv-arco__ref">{s.titularRef}</span></dd></div>
                  </dl>
                  {cerrada ? (
                    <p className="rv-arco__nota">{s.resolucion ?? '—'}</p>
                  ) : s.tipo === 'cancelacion' ? (
                    <div className="rv-arco__acciones">
                      {/* La cancelación NO se resuelve con prosa: se EJECUTA sobre datos concretos. El botón dice lo que hace antes de que alguien lo apriete. */}
                      <FormaConAviso
                        accion={accionEjecutarCancelacion} boton={tr('arco.page.ejecutarCancelacion')} columnas="auto"
                        confirmar={{
                          titulo: tr('arco.page.ejecutarLaCancelacion'),
                          descripcion: tr('arco.page.seSustituyenNombreY', { v: s.operadorNombre ?? tr('arco.page.esteTitular'), titularRef: s.titularRef }),
                          etiquetaConfirmar: tr('arco.page.siEjecutarCancelacion'),
                        }}
                      >
                        <input type="hidden" name="solicitudId" value={s.id} />
                      </FormaConAviso>
                      <p className="rv-arco__nota">
                        {tr('arco.page.sustituyeNombreYTelefono')}
                      </p>
                    </div>
                  ) : (
                    <div className="rv-arco__acciones">
                      {/* La oposición SÍ tiene un acto que dejar asentado antes de la prosa: la constancia de que está vigente. Se ofrece arriba de Responder porque ése es el orden: primero la evidencia, después la contestación. */}
                      {s.tipo === 'oposicion' && (
                        <>
                          <FormaConAviso accion={accionRegistrarOposicion} boton={tr('arco.page.registrarLaOposicion')} columnas="auto">
                            <input type="hidden" name="solicitudId" value={s.id} />
                          </FormaConAviso>
                          <p className="rv-arco__nota">
                            {tr('arco.page.dejaConstanciaEnEl')}
                          </p>
                        </>
                      )}
                      <FormaConAviso accion={accionResponder} boton="Responder" columnas="md:grid-cols-1">
                        <input type="hidden" name="solicitudId" value={s.id} />
                        <CampoTexto name="resolucion" etiqueta={tr('arco.page.respuestaAlTitular')} etiquetaOculta placeholder={tr('arco.page.queSeResolvioY')} />
                      </FormaConAviso>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>
    </MarcoPagina>
  );
}
