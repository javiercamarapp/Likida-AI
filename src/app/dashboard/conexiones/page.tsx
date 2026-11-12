import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta, conectorPermitidoEnPerfil, integracionPermitidaEnPerfil } from '@/lib/auth/visibilidad';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { getConexiones, contarCredencialesGps } from '@/lib/likida/conexiones';
import { catalogoIntegraciones } from '@/lib/likida/integraciones';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { conectorPorId } from '@/lib/likida/conectores/registro';
import { cofreConfigurado } from '@/lib/likida/conectores/cofre';
import {
  guardarCredencial, listarCredenciales, desactivarCredencial, probarCredencial,
} from '@/lib/likida/conectores/credenciales';
import type { ResultadoCredencial } from './credenciales-controles';
import {
  SeccionCredenciales, catalogoParaCaptura, pistasConRotulo, type CredencialPantalla,
} from './seccion-credenciales';
import { SeccionIntegraciones } from './seccion-integraciones';
import { SeccionGps, type ResultadoSecreto, type ResultadoImportGeocercas } from './seccion-gps';
import { importarGeocercasDeTablaPropia } from '@/lib/likida/conectores/tabla_propia/importar_geocercas';
import { VistaConexiones } from './vista';
import { SeccionEstado } from './seccion-estado';
import { leerFuentesDeFlota, leerSilencioWebhook } from '@/lib/likida/fuentes/leer';
import { EstadoError } from '@/app/ui-v2/componentes';
import { armarPanelGps } from '@/lib/likida/gps_push/panel';
import { generarSecretoPush } from '@/lib/likida/gps_push/datos';
import { mapearGpsDesdeArchivo } from '@/lib/likida/importacion/panel';
import { plantillaGpsCsv } from '@/lib/likida/importacion/gps_dispositivos';
import type { ResultadoImportacionUI } from '@/lib/likida/importacion/resultado_ui';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { appUrl } from '@/lib/env';
import { ahoraMs } from '@/lib/saludo';
import { sufijoTenant } from '../sufijo';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('resto');
  return { title: t('cfg.conexiones') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/conexiones';

const motivoConectorFueraDelPerfil = (t: TResto = T_RESTO_ES) => (t('cfg.este_sistema_no_esta_incluido_en'));

/** Una action es un endpoint alcanzable por POST directo: ocultar el conector en la pantalla no basta, se vuelve a negar aquí. */
async function conectorFueraDelPerfil(tenantId: string, conectorId: string): Promise<boolean> {
  const p = await perfilDeTenant(tenantId);
  return p !== null && !conectorPermitidoEnPerfil(p, conectorId);
}

/**
 * Conexiones (F7 del plan — el chasis de agentes): qué tiene conectado la
 * flota y qué le falta, con estado MEDIDO. Área `administracion`: es
 * configuración de la cuenta, del dueño.
 *
 * Desde C2 (auditoría 4) también CAPTURA: la sección de credenciales es quien
 * llena `conector_credencial` (0094). VER la página es área `administracion`
 * y ESCRIBIR es `puedeAdministrar` — se comprueban las dos DENTRO de cada
 * server action, porque una action es un endpoint alcanzable por POST
 * directo, no un botón (patrón llaves-api).
 */
export default async function PaginaConexiones({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const { t } = await getT('resto');
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // Primario sin catch: una pantalla de salud que no puede leer la salud
  // debe caerse, no pintar verdes de adorno.
  const conectores = await getConexiones(tenantId);
  // Perfil de la flota (null = sin perfil: la pantalla de siempre). Con perfil solo se ofrece la lista cerrada de conectores.
  const perfil = await perfilDeTenant(tenantId);

  // El catálogo de sistemas, que hasta agosto-2026 vivía en la pantalla gemela
  // `/dashboard/integraciones`. Su único estado medido por flota es el rastreo,
  // y ahora se mide contra la MISMA tabla que el renglón de arriba — antes cada
  // pantalla hacía su propia consulta y podían contradecirse.
  const credencialesRastreo = await contarCredencialesGps(tenantId);

  // Las credenciales son SECUNDARIAS de esta página: si su lectura falla, los
  // renglones de arriba siguen sirviendo y la sección dice "no se pudo leer"
  // — nunca una lista vacía, que invitaría a recapturar lo que sí existe.
  const guardadasCrudas = await listarCredenciales(tenantId).catch(() => null);
  const guardadas: CredencialPantalla[] | null = guardadasCrudas === null ? null
    : guardadasCrudas.map((c) => ({
      conectorId: c.conectorId,
      nombre: conectorPorId(c.conectorId)?.nombre ?? c.conectorId,
      pistas: pistasConRotulo(c.conectorId, c.pistas),
      activo: c.activo,
      probadaEn: c.probadaEn,
      ultimoError: c.ultimoError,
      creadaEn: c.creadaEn,
    }));

  async function guardar(_previo: ResultadoCredencial, fd: FormData): Promise<ResultadoCredencial> {
    'use server';
    const { t } = await getT('resto');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: t('cfg.solo_el_dueno_de_la_flota') };
    }

    const conectorId = typeof fd.get('conector') === 'string' ? (fd.get('conector') as string).trim().slice(0, 64) : '';
    if (await conectorFueraDelPerfil(s.tenantId, conectorId)) return { ok: false, error: motivoConectorFueraDelPerfil(t) };
    // Los valores se reconstruyen contra los campos DECLARADOS del conector:
    // lo que el formulario mande de más ni siquiera se lee (y el motor
    // vuelve a filtrar de todos modos).
    const valores: Record<string, string> = {};
    for (const campo of conectorPorId(conectorId)?.credenciales ?? []) {
      const v = fd.get(`campo_${campo.clave}`);
      if (typeof v === 'string') valores[campo.clave] = v;
    }

    try {
      await guardarCredencial(s.tenantId, conectorId, valores, { id: s.userId });
      revalidatePath(RUTA);
      // "Guardada" y no "conectada": nadie la ha probado contra el sistema
      // real — decir otra cosa sería fingir una conexión viva.
      return { ok: true, mensaje: t('cfg.guardada_y_cifrada_en_el_cofre') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar la credencial') };
    }
  }

  /**
   * PROBAR: la action que hacía falta para que `probar()` dejara de ser código
   * muerto. Llama al sistema del cliente DE VERDAD con la credencial guardada
   * y sella el veredicto en la fila.
   *
   * Es `puedeAdministrar` y no solo `puedeVerRuta` por dos razones: la prueba
   * DESCIFRA un secreto de la flota, y ESCRIBE (`probada_en`/`ultimo_error`).
   * Mismo criterio que guardar y desactivar, y la RLS `administra_flota` de la
   * 0094 dice lo mismo.
   *
   * El detalle del adaptador se devuelve TAL CUAL: es lo que distingue «te
   * rechazaron el token» de «su servidor está caído», que mandan a hacer cosas
   * distintas. `mensajeParaPantalla` solo cubre lo que se ROMPE antes de llegar
   * al proveedor (cofre sin llave, base caída).
   */
  async function probar(_previo: ResultadoCredencial, fd: FormData): Promise<ResultadoCredencial> {
    'use server';
    const { t } = await getT('resto');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: t('cfg.solo_el_dueno_de_la_flota_2') };
    }

    const conectorId = typeof fd.get('conector') === 'string' ? (fd.get('conector') as string).trim().slice(0, 64) : '';
    if (await conectorFueraDelPerfil(s.tenantId, conectorId)) return { ok: false, error: motivoConectorFueraDelPerfil(t) };
    try {
      const r = await probarCredencial(s.tenantId, conectorId, { id: s.userId });
      // El sello ya quedó en la fila: se revalida para que el renglón de arriba
      // enseñe «probada el …» (o el error) sin que nadie recargue a mano.
      revalidatePath(RUTA);
      if (!r.ok) return { ok: false, error: r.detalle };
      return {
        ok: true,
        // Se dice CONTRA QUÉ se habló: sin el endpoint, «conectado» es una
        // palabra sin evidencia. `verificadoContra` en null con `ok: true` no
        // puede pasar — hay una prueba del registro que lo impide.
        mensaje: r.verificadoContra
          ? `${r.detalle} (verificado contra ${r.verificadoContra})`
          : r.detalle,
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, t('cfg.probar_la_conexion')) };
    }
  }

  async function desactivar(_previo: ResultadoCredencial, fd: FormData): Promise<ResultadoCredencial> {
    'use server';
    const { t } = await getT('resto');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: t('cfg.solo_el_dueno_de_la_flota_3') };
    }

    const conectorId = typeof fd.get('conector') === 'string' ? (fd.get('conector') as string).trim().slice(0, 64) : '';
    // A37-S17-09: SIEMPRE se puede desactivar (revocar y destruir el secreto propio),
    // aunque el conector haya quedado fuera del perfil/plan; el perfil solo restringe
    // guardar y probar.
    try {
      await desactivarCredencial(s.tenantId, conectorId, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: t('cfg.credencial_desactivada') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'desactivar la credencial') };
    }
  }

  const panelGps = await armarPanelGps(tenantId, ahoraMs());

  /** Genera o rota el secreto del GPS propio. El valor en claro viaja UNA vez, de aquí al navegador. */
  async function generarSecreto(_previo: ResultadoSecreto, _fd: FormData): Promise<ResultadoSecreto> {
    'use server';
    const { t } = await getT('resto');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) return { ok: false, error: t('cfg.solo_el_dueno_de_la_flota_4') };
    if (!cofreConfigurado()) return { ok: false, error: t('cfg.el_cofre_de_credenciales_no_esta') };
    try {
      const { secreto, version } = await generarSecretoPush(s.tenantId);
      await anotarBitacora({ tenantId: s.tenantId, actor: { id: s.userId }, accion: 'gps.push_secreto_generado', entidad: 'tenant', entidadId: s.tenantId, detalle: { version } });
      revalidatePath(RUTA);
      return { ok: true, secreto, endpoint: `${appUrl()}/api/gps/push/${s.tenantId}` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'generar el secreto') };
    }
  }

  /** Liga dispositivos GPS a unidades existentes: revisar (no escribe) y confirmar. */
  async function mapearGps(_previo: ResultadoImportacionUI | null, fd: FormData): Promise<ResultadoImportacionUI | null> {
    'use server';
    const { t } = await getT('resto');
    const vacio = (error: string): ResultadoImportacionUI => ({
      error, paso: 'previsualizar', huella: '', archivo: '', leidas: 0, nuevas: 0, yaEstaban: 0, conProblema: 0,
      muestra: [], problemas: [], patiosDesconocidos: [], avisos: [], excedeTope: false,
    });
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return vacio(MENSAJE_FLOTA_CAMBIO);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) return vacio(t('cfg.solo_el_dueno_de_la_flota_5'));
    const r = await mapearGpsDesdeArchivo({ tenantId: s.tenantId, alcance: { tipo: 'flota' }, actor: { id: s.userId }, datos: fd });
    if (r.confirmado) revalidatePath(RUTA);
    return r;
  }

  /** Trae las geocercas de «mis propias tablas» al catálogo de sitios (el permiso lo vuelve a comprobar la acción). */
  async function importarGeocercas(_previo: ResultadoImportGeocercas, _fd: FormData): Promise<ResultadoImportGeocercas> {
    'use server';
    const { t } = await getT('resto');
    const s = await resolverTenantAtadoAccion(RUTA, sp, tenantId);
    if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) return { ok: false, error: t('cfg.solo_el_dueno_de_la_flota_6') };
    const r = await importarGeocercasDeTablaPropia({ tenantId: s.tenantId, rol: s.rol });
    if (!r.ok) return r;
    revalidatePath(RUTA);
    return { ok: true, mensaje: `Importado: ${r.creados} sitio${r.creados === 1 ? '' : 's'} nuevo${r.creados === 1 ? '' : 's'} y ${r.actualizados} actualizado${r.actualizados === 1 ? '' : 's'}.`, aproximadas: r.aproximadas.length, poligonos: r.poligonos };
  }
  const tieneTablaPropia = (guardadasCrudas ?? []).some((c) => c.conectorId === 'tabla_propia' && c.activo);

  // F19: estado por fuente. Cada fuente se lee por su lado y nunca lanza: lo que no se pudo leer sale como «sin dato».
  const ahora = ahoraMs();
  const [fuentes, silencio] = await Promise.all([leerFuentesDeFlota(tenantId, ahora), leerSilencioWebhook(ahora, tenantId)]);

  return (
    <VistaConexiones t={t}
      conectores={conectores}
      estado={<SeccionEstado entradas={fuentes} silencio={silencio} ahoraMs={ahora} />}
      integraciones={<SeccionIntegraciones t={t} integraciones={catalogoIntegraciones({ credencialesRastreo }).filter((i) => perfil === null || integracionPermitidaEnPerfil(perfil, i.id))} />}
      gps={panelGps.error !== null ? (
        <EstadoError titulo={t('cfg.gps_no_disponible_ahora')} reintentar>{panelGps.error}</EstadoError>
      ) : (
        <SeccionGps
          salud={panelGps.salud} push={panelGps.push} endpoint={panelGps.endpoint}
          huerfanos={panelGps.huerfanos} hayMasHuerfanos={panelGps.hayMasHuerfanos} conteos={panelGps.conteos}
          puedeAdministrarGps={puedeAdministrar(rol)} generarSecreto={generarSecreto} mapear={mapearGps}
          plantillaCsv={plantillaGpsCsv()} hrefPatios={`/dashboard/patios${sufijoTenant(sp)}`}
          importarGeocercas={tieneTablaPropia ? importarGeocercas : undefined}
        />
      )}
      credenciales={(
        <SeccionCredenciales t={t}
          cofreListo={cofreConfigurado()}
          puedeAdministrarCofre={puedeAdministrar(rol)}
          guardadas={guardadas}
          grupos={catalogoParaCaptura(perfil)}
          acciones={{ guardar, desactivar, probar }}
        />
      )}
    />
  );
}
