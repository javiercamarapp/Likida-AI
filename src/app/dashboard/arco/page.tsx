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
export const metadata: Metadata = { title: 'Solicitudes ARCO' };

export const dynamic = 'force-dynamic';

const ETIQUETA_TIPO: Record<string, string> = {
  acceso: 'Acceso', rectificacion: 'Rectificación', cancelacion: 'Cancelación', oposicion: 'Oposición',
};

const ESTADO_ARCO: Record<string, { rotulo: string; tono: TonoEstado }> = {
  resuelta: { rotulo: 'Resuelta', tono: 'ok' },
  improcedente: { rotulo: 'Improcedente', tono: 'neutral' },
  en_proceso: { rotulo: 'En proceso', tono: 'warn' },
  recibida: { rotulo: 'Recibida', tono: 'warn' },
};

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
const ALCANCE_CANCELACION = 'Se sustituyeron el nombre y el teléfono del registro operativo, se eliminaron sus conversaciones y el contacto de emergencia registrado sobre su persona. Se conservan el identificador del operador, el correo de la cuenta, la referencia del titular en la solicitud, la documentación fiscal, y los eventos de cámara, telemetría (180 días, o 365 si fueron graves) y jornada laboral ligados a su persona. Esas categorías requieren revisión con el responsable de privacidad: la ejecución automática no las alcanza.';

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
const NO_AUTORIZADO = 'Tu rol no puede responder solicitudes ARCO: es una respuesta legal que firma el dueño de la flota.';
function puedeResponderArco(rol: string): boolean {
  return puedeVerRuta(rol, RUTA) && puedeAdministrar(rol);
}

/**
 * Solicitudes ARCO de ESTA flota — la responsable obligada a contestar en 20
 * días hábiles (LFPDPPP 2025 art. 31). AUDITORÍA 16: antes vivía solo en /admin
 * (superadmin), y la flota no tenía dónde ver sus solicitudes ni responderlas.
 */
export default async function ArcoPage({ searchParams }: { searchParams: Promise<Params> }) {
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
    // AUDITORÍA 16, MEDIO: el superadmin que previsualiza una flota real
    // (?tenant=t-otra) no podía resolver — el action usaba el tenant de sesión.
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeResponderArco(s.rol)) return { error: NO_AUTORIZADO };
    let tenantEfectivo = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      const { resolverTenantPedido } = await import('@/lib/auth/tenant-api');
      tenantEfectivo = await resolverTenantPedido(supabaseAdmin(), tenantEfectivo, sp.tenant);
    }
    const resolucion = String(fd.get('resolucion') ?? '').trim();
    const solicitudId = String(fd.get('solicitudId') ?? '');
    if (!solicitudId) return { error: 'Falta la solicitud.' };
    if (resolucion.length < 5) return { error: 'Escribe la respuesta que se entrega al titular (qué se resolvió y cómo).' };
    try {
      const r = await resolverSolicitudArco(tenantEfectivo, solicitudId, resolucion);
      revalidatePath(RUTA);
      return r.enviada
        ? { ok: 'Solicitud resuelta y la respuesta se envió al titular por WhatsApp.' }
        : { ok: `Solicitud resuelta. La respuesta NO se pudo enviar por WhatsApp${r.error ? ` (${r.error})` : ''} — entrégala al titular por otro canal.` };
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
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeResponderArco(s.rol)) return { error: NO_AUTORIZADO };
    let tenantEfectivo = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      const { resolverTenantPedido } = await import('@/lib/auth/tenant-api');
      tenantEfectivo = await resolverTenantPedido(supabaseAdmin(), tenantEfectivo, sp.tenant);
    }
    const solicitudId = String(fd.get('solicitudId') ?? '');
    if (!solicitudId) return { error: 'Falta la solicitud.' };
    try {
      const r = await ejecutarCancelacionArco(tenantEfectivo, solicitudId);
      revalidatePath(RUTA);
      if (!r.ok) return { error: `No se ejecutó la cancelación: ${r.motivo}` };
      // 0442: titular que es cuenta de oficina — si el login de Auth no se pudo
      // borrar, se DICE (quedó baneado), no se afirma un borrado que no ocurrió.
      if (r.errorAuth) {
        return { error: `La cuenta quedó anonimizada y dada de baja, pero el acceso de inicio de sesión NO se pudo borrar (${r.errorAuth}); quedó bloqueado (ban permanente). Pide a soporte que lo borre de Auth.` };
      }
      // A36-R03-03: si no se pudieron omitir las entregas de liquidación por
      // correo pendientes del operador, se DICE (podrían salir a su correo).
      const aviso = r.errorEntregas ? ` ATENCIÓN: no se pudieron cancelar las entregas de liquidación por correo pendientes de este operador (${r.errorEntregas}); revísalas en Liquidaciones.` : '';
      return r.avisada
        ? { ok: `${ALCANCE_CANCELACION} Se confirmó por WhatsApp.${aviso}` }
        : { ok: `${ALCANCE_CANCELACION} La confirmación NO salió por WhatsApp${r.errorAviso ? ` (${r.errorAviso})` : ''} — entrégasela por otro canal.${aviso}` };
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
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeResponderArco(s.rol)) return { error: NO_AUTORIZADO };
    let tenantEfectivo = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      const { resolverTenantPedido } = await import('@/lib/auth/tenant-api');
      tenantEfectivo = await resolverTenantPedido(supabaseAdmin(), tenantEfectivo, sp.tenant);
    }
    const solicitudId = String(fd.get('solicitudId') ?? '');
    if (!solicitudId) return { error: 'Falta la solicitud.' };
    try {
      const r = await ejecutarOposicionArco(tenantEfectivo, solicitudId);
      revalidatePath(RUTA);
      if (!r.ok) return { error: `No se registró la oposición: ${r.motivo}` };
      return {
        ok: 'Oposición registrada en el expediente: queda en proceso, con la constancia de que la '
          + 'oposición del titular está vigente. Falta que revises el caso y le contestes con el botón de Responder.',
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
    <MarcoPagina titulo="Solicitudes ARCO" apoyo="Solicitudes de tus operadores y cómo responderlas a tiempo (LFPDPPP art. 31: 20 días hábiles).">
      {/* H7 (auditoría 24): las tres cifras salían de `solicitudes`, que es `[]` TANTO si de verdad no hay solicitudes COMO si la lectura de arriba falló (`errorCarga`). Con la base caída, "0 vencidas sin responder" es la mentira que un responsable obligado por el art. 31 no se puede permitir. `null` es NO MEDIBLE ("—", no "0"); el aviso de abajo explica por qué. */}
      <TiraCifras sello={selloHoy('Solicitudes ARCO')}>
        <Cifra icono={<Icono icono={Inbox} />} etiqueta="Por responder" info="arco.por_responder" valor={errorCarga ? null : pendientes.length} />
        <Cifra icono={<Icono icono={Clock} />} etiqueta={`Vencen pronto (≤ ${DIAS_VENCE_PRONTO} días)`} info="arco.vencen_pronto" valor={errorCarga ? null : vencenPronto.length} />
        <Cifra icono={<Icono icono={CircleAlert} />} etiqueta="Vencidas sin responder" info="arco.vencidas" valor={errorCarga ? null : vencidas.length} />
      </TiraCifras>

      <Tarjeta titulo="Solicitudes de tus operadores" info="arco.solicitudes">
        {errorCarga ? (
          <EstadoError reintentar>
            No se pudieron leer las solicitudes ahora mismo ({errorCarga.slice(0, 120)}). Recarga en un momento: no hay
            forma de saber si hay solicitudes pendientes hasta que la base responda.
          </EstadoError>
        ) : solicitudes.length === 0 ? (
          <EstadoVacio titulo="Sin solicitudes ARCO" contenido>
            Cuando un operador escribe *PRIVACIDAD* por WhatsApp, la solicitud
            queda registrada aquí y tú, la responsable, tienes 20 días hábiles para responder.
          </EstadoVacio>
        ) : (
          <ul className="rv-arco__lista" aria-label="Solicitudes de derechos ARCO">
            {solicitudes.map((s) => {
              const e = ESTADO_ARCO[s.estado] ?? ESTADO_ARCO.recibida;
              const cerrada = s.estado === 'resuelta' || s.estado === 'improcedente';
              return (
                <li key={s.id} className="rv-arco__item">
                  <div className="rv-arco__cabeza">
                    <strong>{ETIQUETA_TIPO[s.tipo] ?? s.tipo}</strong>
                    <StatusChip tono={e.tono}>{e.rotulo}</StatusChip>
                    {!cerrada && yaVencio(s.venceEn, hoy) && <StatusChip tono="bad">vencida</StatusChip>}
                  </div>
                  <dl className="rv-arco__datos">
                    <div><dt>Recibida</dt><dd>{fechaMx(s.recibidaEn)}</dd></div>
                    <div><dt>Vence</dt><dd>{fechaMx(s.venceEn)}</dd></div>
                    <div><dt>Titular</dt><dd>{s.operadorNombre ?? '—'}<span className="rv-arco__ref">{s.titularRef}</span></dd></div>
                  </dl>
                  {cerrada ? (
                    <p className="rv-arco__nota">{s.resolucion ?? '—'}</p>
                  ) : s.tipo === 'cancelacion' ? (
                    <div className="rv-arco__acciones">
                      {/* La cancelación NO se resuelve con prosa: se EJECUTA sobre datos concretos. El botón dice lo que hace antes de que alguien lo apriete. */}
                      <FormaConAviso
                        accion={accionEjecutarCancelacion} boton="Ejecutar cancelación" columnas="auto"
                        confirmar={{
                          titulo: 'Ejecutar la cancelación',
                          descripcion: `Se sustituyen nombre y teléfono de ${s.operadorNombre ?? 'este titular'} (${s.titularRef}) y se eliminan sus conversaciones. Si es una cuenta de oficina, también se da de baja y se borra su acceso. No se puede deshacer.`,
                          etiquetaConfirmar: 'Sí, ejecutar cancelación',
                        }}
                      >
                        <input type="hidden" name="solicitudId" value={s.id} />
                      </FormaConAviso>
                      <p className="rv-arco__nota">
                        Sustituye nombre y teléfono del registro operativo y elimina conversaciones. Se conservan
                        el identificador del operador, el correo de la cuenta, la referencia del titular en la solicitud,
                        la documentación fiscal, los eventos de cámara y telemetría ligados a su persona (180 días, o 365
                        si fueron graves), su contacto de emergencia y su registro de jornada laboral; esas categorías
                        requieren revisión con el responsable de privacidad. No se puede deshacer la eliminación de conversaciones.
                        Si el titular es una cuenta de oficina (dueño, contador, encargado), se sustituyen su nombre y
                        su correo, se da de baja y se borra su acceso, sus conversaciones de WhatsApp, del analista y del
                        copiloto; se conserva la bitácora de auditoría. No se ejecuta si es el único dueño activo de la
                        flota: nombra a otro dueño primero.
                      </p>
                    </div>
                  ) : (
                    <div className="rv-arco__acciones">
                      {/* La oposición SÍ tiene un acto que dejar asentado antes de la prosa: la constancia de que está vigente. Se ofrece arriba de Responder porque ése es el orden: primero la evidencia, después la contestación. */}
                      {s.tipo === 'oposicion' && (
                        <>
                          <FormaConAviso accion={accionRegistrarOposicion} boton="Registrar la oposición" columnas="auto">
                            <input type="hidden" name="solicitudId" value={s.id} />
                          </FormaConAviso>
                          <p className="rv-arco__nota">
                            Deja constancia en el expediente de que la oposición del titular está vigente
                            (queda «en proceso»). No cancela ni borra ningún dato y no cierra la solicitud:
                            eso lo haces tú al responder.
                          </p>
                        </>
                      )}
                      <FormaConAviso accion={accionResponder} boton="Responder" columnas="md:grid-cols-1">
                        <input type="hidden" name="solicitudId" value={s.id} />
                        <CampoTexto name="resolucion" etiqueta="Respuesta al titular" etiquetaOculta placeholder="Qué se resolvió y cómo se entrega al titular" />
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
