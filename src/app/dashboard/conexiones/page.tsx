import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
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
import { armarPanelGps } from '@/lib/likida/gps_push/panel';
import { generarSecretoPush } from '@/lib/likida/gps_push/datos';
import { mapearGpsDesdeArchivo } from '@/lib/likida/importacion/panel';
import { plantillaGpsCsv } from '@/lib/likida/importacion/gps_dispositivos';
import type { ResultadoImportacionUI } from '@/lib/likida/importacion/resultado_ui';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { appUrl } from '@/lib/env';
import { ahoraMs } from '@/lib/saludo';
import { sufijoTenant } from '../sufijo';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/conexiones';

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
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // Primario sin catch: una pantalla de salud que no puede leer la salud
  // debe caerse, no pintar verdes de adorno.
  const conectores = await getConexiones(tenantId);

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
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota guarda credenciales.' };
    }

    const conectorId = typeof fd.get('conector') === 'string' ? (fd.get('conector') as string).trim().slice(0, 64) : '';
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
      return { ok: true, mensaje: 'Guardada y cifrada en el cofre — SIN PROBAR contra el sistema real todavía. La prueba de conexión se hace contigo en el arranque.' };
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
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota prueba las conexiones.' };
    }

    const conectorId = typeof fd.get('conector') === 'string' ? (fd.get('conector') as string).trim().slice(0, 64) : '';
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
      return { ok: false, error: mensajeParaPantalla(e, 'probar la conexión') };
    }
  }

  async function desactivar(_previo: ResultadoCredencial, fd: FormData): Promise<ResultadoCredencial> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota desactiva credenciales.' };
    }

    const conectorId = typeof fd.get('conector') === 'string' ? (fd.get('conector') as string).trim().slice(0, 64) : '';
    try {
      await desactivarCredencial(s.tenantId, conectorId, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Credencial desactivada.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'desactivar la credencial') };
    }
  }

  const panelGps = await armarPanelGps(tenantId, ahoraMs());

  /** Genera o rota el secreto del GPS propio. El valor en claro viaja UNA vez, de aquí al navegador. */
  async function generarSecreto(_previo: ResultadoSecreto, _fd: FormData): Promise<ResultadoSecreto> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) return { ok: false, error: 'Solo el dueño de la flota genera el secreto del GPS propio.' };
    if (!cofreConfigurado()) return { ok: false, error: 'El cofre de credenciales no está configurado en este entorno: no se puede guardar el secreto cifrado.' };
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
    const vacio = (error: string): ResultadoImportacionUI => ({
      error, paso: 'previsualizar', huella: '', archivo: '', leidas: 0, nuevas: 0, yaEstaban: 0, conProblema: 0,
      muestra: [], problemas: [], patiosDesconocidos: [], avisos: [], excedeTope: false,
    });
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) return vacio('Solo el dueño de la flota liga dispositivos GPS.');
    const r = await mapearGpsDesdeArchivo({ tenantId: s.tenantId, alcance: { tipo: 'flota' }, actor: { id: s.userId }, datos: fd });
    if (r.confirmado) revalidatePath(RUTA);
    return r;
  }

  /** Trae las geocercas de «mis propias tablas» al catálogo de sitios (el permiso lo vuelve a comprobar la acción). */
  async function importarGeocercas(_previo: ResultadoImportGeocercas, _fd: FormData): Promise<ResultadoImportGeocercas> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) return { ok: false, error: 'Solo el dueño de la flota importa sus geocercas.' };
    const r = await importarGeocercasDeTablaPropia({ tenantId: s.tenantId, rol: s.rol });
    if (!r.ok) return r;
    revalidatePath(RUTA);
    return { ok: true, mensaje: `Importado: ${r.creados} sitio${r.creados === 1 ? '' : 's'} nuevo${r.creados === 1 ? '' : 's'} y ${r.actualizados} actualizado${r.actualizados === 1 ? '' : 's'}.`, aproximadas: r.aproximadas.length, poligonos: r.poligonos };
  }
  const tieneTablaPropia = (guardadasCrudas ?? []).some((c) => c.conectorId === 'tabla_propia' && c.activo);

  return (
    <VistaConexiones
      conectores={conectores}
      integraciones={<SeccionIntegraciones integraciones={catalogoIntegraciones({ credencialesRastreo })} />}
      gps={panelGps.error !== null ? (
        <section className="card p-4"><h2 className="font-display text-[15px] font-semibold">GPS</h2>
          <p role="alert" className="mt-1 text-[12.5px]" style={{ color: 'var(--warn)' }}>{panelGps.error}</p></section>
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
        <SeccionCredenciales
          cofreListo={cofreConfigurado()}
          puedeAdministrarCofre={puedeAdministrar(rol)}
          guardadas={guardadas}
          grupos={catalogoParaCaptura()}
          acciones={{ guardar, desactivar, probar }}
        />
      )}
    />
  );
}
