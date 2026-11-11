import { getT } from '@/lib/i18n/servidor';
import { type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { fechaHoraMx, fechaMx } from '@/lib/formato';
import {
  aceptacionesDeFlota, registrarAceptacion, revocarMandato, pendientesDeUsuario, mandatoDe,
  type AceptacionFila,
} from '@/lib/legal/aceptacion';
import { guardarDatosResponsable, leerDatosResponsable, type CamposResponsable } from '@/lib/legal/datos_responsable';
import {
  ETIQUETA_DOCUMENTO, MANDATO_AUTOFACTURACION, VIGENTE_DESDE_TERMINOS, VIGENTE_DESDE_AVISO_PRIVACIDAD,
} from '@/lib/legal/documentos';
import type { Metadata } from 'next';
import {
  CampoTexto, Disclosure, EstadoError, FormaConAviso, StatusChip, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import { EsqueletoConfiguracion } from '@/app/ui-v2/esqueletos';
import './legal.css';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.legal') };
}


export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/legal';
const soloDueno = (tr: Tr): string => tr('legal.page.soloElDuenoDe');
// El mandato da poder de operar portales de facturación (Facturas), que un perfil restringido deja en stand-by.
// Otorgarlo se niega bajo perfil; RETIRARLO sigue disponible: quitarle a la flota la forma de retirar un mandato ya
// otorgado sería peor que el hueco original.
const mandatoNoDisponible = (tr: Tr): string => tr('legal.page.elMandatoDeAutofacturacion');

/**
 * TÉRMINOS, AVISO Y MANDATO DE LA FLOTA (auditoría ola 1, #48).
 *
 * Aquí el dueño acepta la versión VIGENTE de los Términos y del Aviso de
 * privacidad —con quién y cuándo— y, aparte, otorga (o retira) el MANDATO para
 * que Likida opere portales de facturación en nombre de la empresa. Sin el
 * mandato vigente de ESTA flota la emisión de CFDI se queda en ensayo, aunque el
 * interruptor global esté puesto (`modoDeFlota`, al_vuelo.ts).
 *
 * Las server actions repiten el chequeo (un action es un POST directo) y el
 * `tenantId` sale de la sesión, no del formulario. La base vuelve a validar
 * pertenencia y rol (0443).
 */
async function sesionDeDueno(sp: { vista?: string; tenant?: string; rol?: string }, tenantId: string) {
  const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol) || s.rol === 'superadmin') return null;
  return s;
}

export default async function PaginaLegal({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const { t: tr, idioma } = await getT('dinero');
  const sp = await searchParams;
  const { tenantId, rol, userId } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  async function accionAceptarVigentes(_previo: ResultadoAccion, _fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeDueno(sp, tenantId);
    if (!s) return { error: soloDueno(tr) };
    const r1 = await registrarAceptacion(s.tenantId, s.userId, 'terminos');
    if (!r1.ok) return { error: r1.motivo ?? tr('legal.page.noSePudoRegistrar') };
    const r2 = await registrarAceptacion(s.tenantId, s.userId, 'aviso_privacidad');
    if (!r2.ok) return { error: r2.motivo ?? tr('legal.page.noSePudoRegistrar') };
    revalidatePath(RUTA);
    return { ok: tr('legal.page.quedoRegistradaTuAceptacion') };
  }

  async function accionOtorgarMandato(_previo: ResultadoAccion, _fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeDueno(sp, tenantId);
    if (!s) return { error: soloDueno(tr) };
    if (await perfilDeTenant(s.tenantId)) return { error: mandatoNoDisponible(tr) };
    const r = await registrarAceptacion(s.tenantId, s.userId, 'mandato_autofacturacion');
    if (!r.ok) return { error: r.motivo ?? tr('legal.page.noSePudoRegistrar2') };
    revalidatePath(RUTA);
    return { ok: r.registrada ? tr('legal.page.mandatoOtorgadoQuedoRegistra') : tr('legal.page.elMandatoYaEstaba') };
  }

  async function accionRetirarMandato(_previo: ResultadoAccion, _fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeDueno(sp, tenantId);
    if (!s) return { error: soloDueno(tr) };
    const r = await revocarMandato(s.tenantId, s.userId);
    if (!r.ok) return { error: r.motivo ?? tr('legal.page.noSePudoRetirar') };
    revalidatePath(RUTA);
    return { ok: tr('legal.page.mandatoRetiradoLikidaVuelve') };
  }

  async function accionGuardarDatos(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await sesionDeDueno(sp, tenantId);
    if (!s) return { error: soloDueno(tr) };
    // El tenant sale de la SESIÓN; del formulario solo vienen los tres textos.
    const r = await guardarDatosResponsable(s.tenantId, {
      razonSocial: fd.get('razonSocial'),
      domicilio: fd.get('domicilio'),
      contactoPrivacidad: fd.get('contactoPrivacidad'),
    }, { id: s.userId });
    if (!r.ok) return { error: r.error };
    revalidatePath(RUTA);
    // A37-S19-07: no se promete un reenvío que no ocurrió (sin cambios) ni se calla que el aviso saldrá incompleto.
    const ROTULO = { razonSocial: tr('legal.page.laRazonSocial'), domicilio: tr('legal.page.elDomicilio'), contactoPrivacidad: tr('legal.page.elContactoDePrivacidad') } as const;
    const falta = (r.vacios ?? []).length > 0
      ? ' ' + tr('legal.page.ojoFalta', { datos: (r.vacios ?? []).map((c) => ROTULO[c]).join(', ') })
      : '';
    if (r.sinCambios) return { ok: tr('legal.page.noHuboCambiosLos', { falta }) };
    return { ok: tr('legal.page.datosGuardadosElAviso', { falta }) };
  }

  // Error DICHO: una base caída no se pinta como «no has aceptado nada».
  let filas: AceptacionFila[] | null = null;
  try {
    filas = await aceptacionesDeFlota(tenantId);
  } catch {
    filas = null;
  }
  let responsable: CamposResponsable | null = null;
  try {
    responsable = await leerDatosResponsable(tenantId);
  } catch {
    responsable = null;
  }
  const pendientes = filas ? pendientesDeUsuario(filas, userId) : null;
  const mandato = filas ? mandatoDe(filas) : null;
  const esDueno = puedeAdministrar(rol) && rol !== 'superadmin';
  const conPerfil = (await perfilDeTenant(tenantId)) !== null;

  return (
    <EsqueletoConfiguracion
      titulo={tr('legal.page.legalYPrivacidad')} apoyo={tr('legal.page.aceptacionDeTerminosY')}
      avisos={filas === null ? <EstadoError>{tr('legal.page.noPudeLeerEl')}</EstadoError> : undefined}
      secciones={filas === null ? [] : [
        {
          id: 'responsable', titulo: tr('legal.page.responsableDePrivacidadDe'),
          contenido: (
            <>
            <p className="rv-legal__nota">
              {rico(tr('legal.page.elAvisoDePrivacidad'), { strong: (c) => <strong>{c}</strong> })}
            </p>
            {responsable === null ? (
              <EstadoError>{tr('legal.page.noPudeLeerLos')}</EstadoError>
            ) : esDueno ? (
              <FormaConAviso accion={accionGuardarDatos} boton="Guardar datos del responsable" columnas="md:grid-cols-1">
                <div className="rv-forma__rejilla">
                  <CampoTexto id="razonSocial" name="razonSocial" etiqueta={tr('legal.page.razonSocialComoEn')} defaultValue={responsable.razonSocial ?? ''} />
                  <CampoTexto id="contactoPrivacidad" name="contactoPrivacidad" etiqueta={tr('legal.page.contactoDePrivacidadCorreo')} defaultValue={responsable.contactoPrivacidad ?? ''} />
                </div>
                <CampoTexto id="domicilio" name="domicilio" etiqueta={tr('legal.page.domicilioFiscal')} defaultValue={responsable.domicilio ?? ''} />
              </FormaConAviso>
            ) : (
              <p className="rv-legal__nota">{soloDueno(tr)}</p>
            )}
            </>
          ),
        },
        {
          id: 'documentos', titulo: tr('legal.page.documentosVigentes'),
          contenido: (
            <>
            <p className="rv-legal__nota">
              {rico(tr('legal.page.linkLinkVersionY', { terminos: ETIQUETA_DOCUMENTO.terminos, desdeTerminos: fechaMx(VIGENTE_DESDE_TERMINOS, idioma), aviso_privacidad: ETIQUETA_DOCUMENTO.aviso_privacidad, desdeAviso: fechaMx(VIGENTE_DESDE_AVISO_PRIVACIDAD, idioma) }), { link: (c) => <Link href="/terminos" className="rv-legal__enlace">{c}</Link>, link2: (c) => <Link href="/privacidad" className="rv-legal__enlace">{c}</Link> })}
            </p>
            {pendientes && pendientes.length === 0 ? (
              <p className="rv-legal__estado">{rico(tr('legal.page.statuschipAlDiaStatuschip'), { statuschip: (c) => <StatusChip tono="ok">{c}</StatusChip> })}</p>
            ) : esDueno ? (
              <FormaConAviso accion={accionAceptarVigentes} boton={tr('legal.page.aceptoLosTerminosY')} columnas="md:grid-cols-1">
                <span />
              </FormaConAviso>
            ) : (
              <p className="rv-legal__nota">{soloDueno(tr)}</p>
            )}
            </>
          ),
        },
        {
          id: 'mandato', titulo: tr('legal.page.mandatoDeAutofacturacion'),
          contenido: (
            <>
            <Disclosure variante="linea" abierto={!mandato} titulo={tr('legal.page.textoDelMandato')} resumen={tr('legal.page.version', { version: MANDATO_AUTOFACTURACION.version })}>
              <blockquote className="rv-legal__cita">
                {MANDATO_AUTOFACTURACION.texto}
              </blockquote>
              <p className="rv-legal__pie">
                {tr('legal.page.versionSinEsteMandato', { version: MANDATO_AUTOFACTURACION.version })}
              </p>
            </Disclosure>
            {mandato ? (
              <>
                <p className="rv-legal__estado">
                  <StatusChip tono="ok">{tr('legal.page.vigente')}</StatusChip>
                  {tr('legal.page.mandatoVigenteOtorgadoEl')} {fechaHoraMx(mandato.aceptadoEn)}
                  {mandato.userId === null ? ' ' + tr('legal.page.laCuentaQueLo') : ''}.
                </p>
                {esDueno && (
                  <FormaConAviso accion={accionRetirarMandato} boton="Retirar el mandato" columnas="md:grid-cols-1">
                    <span />
                  </FormaConAviso>
                )}
              </>
            ) : conPerfil ? (
              <p className="rv-legal__nota">{mandatoNoDisponible(tr)}</p>
            ) : esDueno ? (
              <FormaConAviso accion={accionOtorgarMandato} boton={tr('legal.page.otorgoElMandatoEn')} columnas="md:grid-cols-1">
                <span />
              </FormaConAviso>
            ) : (
              <p className="rv-legal__nota">{tr('legal.page.aunNoEstaOtorgado', { SOLO_DUENO: soloDueno(tr) })}</p>
            )}
            </>
          ),
        },
      ]}
    />
  );
}
