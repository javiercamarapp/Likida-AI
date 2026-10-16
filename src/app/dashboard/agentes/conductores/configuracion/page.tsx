import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar, puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { valoresDeForma } from '@/lib/likida/conductor/config_forma';
import { guardarConfigDelPanel } from '@/lib/likida/conductor/acciones_config';
import { altaVoluntarioDelPanel, bajaVoluntarioDelPanel, telefonoDePilotoValido } from '@/lib/likida/conductor/acciones_voluntarios';
import { buscarCandidatosVoluntarios, cargarContactosTrafico, leerConfigConductor, leerDatosPreflight, leerRutasAutorizadas, leerTopeVoluntarios, listarVoluntarios } from '@/lib/likida/conductor/repo';
import { importarRutasDelPanel, marcarRutaRevisadaDelPanel } from '@/lib/likida/conductor/acciones_rutas';
import { DIAS_REVISION_RUTAS_DEFAULT, hoyDeLaFlota, MAX_BYTES_CSV_RUTAS, rutasPendientesDeRevision } from '@/lib/likida/conductor/rutas';
import { evaluarPreflight } from '@/lib/likida/conductor/preflight_piloto';
import { emailDeUsuario } from '@/lib/likida/conductor/trabajo';
import { leerCatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
import { sufijoTenant } from '../../../sufijo';
import { VistaConfigConductor } from './vista';
import { esTelefonoDemo } from '@/lib/meta/telefono_demo';
import type { DatosVoluntarios, ResultadoConfig } from './forma';
import type { ResultadoSitio } from '../sitios/formas';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/conductores/configuracion';

type ParametrosPagina = { vista?: string; tenant?: string; rol?: string; q?: string };

/** A nivel de módulo (no dentro del componente): una acción `'use server'` no puede cerrar sobre funciones locales. */
async function ejecutarVoluntario(cual: 'alta' | 'baja', sp: ParametrosPagina, fd: FormData): Promise<ResultadoConfig> {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'No tienes acceso a esta configuración.' };
  const email = await emailDeUsuario(s.userId).catch(() => null);
  const ctx = { tenantId: s.tenantId, rol: s.rol, usuarioId: s.userId, email };
  const r = cual === 'alta' ? await altaVoluntarioDelPanel(ctx, fd) : await bajaVoluntarioDelPanel(ctx, fd);
  if (r.ok) revalidatePath(RUTA);
  return r;
}

/** T-A5-48: importar rutas autorizadas (CSV). A nivel de módulo por la misma razón. El permiso y el tenant salen de la SESIÓN. */
async function ejecutarImportarRutas(sp: ParametrosPagina, fd: FormData): Promise<ResultadoSitio> {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'No tienes acceso a esta configuración.' };
  const archivo = fd.get('archivo');
  let texto = '';
  if (archivo instanceof File && archivo.size > 0) {
    if (archivo.size > MAX_BYTES_CSV_RUTAS) return { ok: false, error: 'El archivo pesa más de 1 MB; divídelo en partes.' };
    texto = await archivo.text();
  } else if (typeof fd.get('csv') === 'string') texto = fd.get('csv') as string;
  const r = await importarRutasDelPanel({ tenantId: s.tenantId, rol: s.rol }, { texto });
  if (r.ok) revalidatePath(RUTA);
  return r;
}

/** T-A5-50: «Revisada». A nivel de módulo por la misma razón; el permiso y el tenant salen de la SESIÓN. */
async function ejecutarRutaRevisada(sp: ParametrosPagina, fd: FormData): Promise<ResultadoSitio> {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'No tienes acceso a esta configuración.' };
  const id = fd.get('id');
  const r = await marcarRutaRevisadaDelPanel({ tenantId: s.tenantId, rol: s.rol }, { id: typeof id === 'string' ? id : '' });
  if (r.ok) revalidatePath(RUTA);
  return r;
}

/**
 * La configuración de flota del Agente 5 «Conductor»: escalera de recordatorios, ventana horaria, tope diario, plazos,
 * validación de ubicación, avisos a la oficina y a quién se escala. Antes solo se editaba con `PUT /v1/conductor/config`.
 * El jefe de tráfico la ve; el dueño la guarda (misma validación que el PUT).
 */
export default async function PaginaConfigConductor({ searchParams }: { searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; q?: string }> }) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  const [config, contactos, catalogos] = await Promise.all([
    leerConfigConductor(tenantId).catch((e) => { logger.warn('conductor.config_no_leida', { tenantId, err: e instanceof Error ? e.message : String(e) }); return null; }),
    cargarContactosTrafico(tenantId).catch(() => null),
    leerCatalogosFiltro(tenantId).catch(() => null),
  ]);
  // T-A5-25: el preflight del piloto (solo lectura). `null` = no se pudo leer.
  const preflight = await leerDatosPreflight(tenantId).then(evaluarPreflight)
    .catch((e) => { logger.warn('conductor.preflight_no_leido', { tenantId, err: e instanceof Error ? e.message : String(e) }); return null; });
  const busqueda = typeof sp.q === 'string' ? sp.q.slice(0, 40) : '';
  const voluntarios: DatosVoluntarios | null = await Promise.all([
    leerTopeVoluntarios(tenantId), listarVoluntarios(tenantId), buscarCandidatosVoluntarios(tenantId, busqueda),
  ]).then(([tope, actuales, candidatos]) => ({
    tope, busqueda,
    voluntarios: actuales.map((o) => ({ id: o.id, nombre: o.nombre, telefono: o.telefono })),
    candidatos: candidatos.filter((o) => !esTelefonoDemo(o.telefono) && telefonoDePilotoValido(o.telefono)).slice(0, 50).map((o) => ({ id: o.id, nombre: o.nombre, telefono: o.telefono })),
  })).catch((e) => { logger.warn('conductor.voluntarios_no_leidos', { tenantId, err: e instanceof Error ? e.message : String(e) }); return null; });

  async function accionGuardar(_previo: ResultadoConfig, fd: FormData): Promise<ResultadoConfig> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'No tienes acceso a esta configuración.' };
    const email = await emailDeUsuario(s.userId).catch(() => null);
    const r = await guardarConfigDelPanel({ tenantId: s.tenantId, rol: s.rol, usuarioId: s.userId, email }, fd);
    if (r.ok) revalidatePath(RUTA);
    return r;
  }

  async function accionAlta(_previo: ResultadoConfig, fd: FormData): Promise<ResultadoConfig> {
    'use server';
    return ejecutarVoluntario('alta', sp, fd);
  }
  async function accionBaja(_previo: ResultadoConfig, fd: FormData): Promise<ResultadoConfig> {
    'use server';
    return ejecutarVoluntario('baja', sp, fd);
  }

  // T-A5-50: la lista de rutas sin revisar. Solo se lee si el usuario puede importar rutas (es quien las mantiene). `null` = no se pudo leer.
  // Ruling: el plazo es la constante de 90 días (la tabla de configuración no tiene columna y no hay migración libre; cambiarlo es un parámetro).
  let totalRutas = 0;
  const rutasPendientes = puedeAsignar(rol)
    ? await leerRutasAutorizadas(tenantId).then((rutas) => { totalRutas = rutas.length; return rutasPendientesDeRevision(rutas, hoyDeLaFlota(new Date()), DIAS_REVISION_RUTAS_DEFAULT); })
      .catch((e) => { logger.warn('conductor.rutas_pendientes_no_leidas', { tenantId, err: e instanceof Error ? e.message : String(e) }); return null; })
    : null;

  async function accionRutaRevisada(_previo: ResultadoSitio, fd: FormData): Promise<ResultadoSitio> {
    'use server';
    return ejecutarRutaRevisada(sp, fd);
  }

  async function accionImportarRutas(_previo: ResultadoSitio, fd: FormData): Promise<ResultadoSitio> {
    'use server';
    return ejecutarImportarRutas(sp, fd);
  }

  return (
    <VistaConfigConductor
      sufijo={sufijoTenant(sp)} config={config} valores={config ? valoresDeForma(config) : null} contactos={contactos}
      patios={catalogos?.terminales ?? []} puedeEditar={puedeAdministrar(rol)} accionGuardar={accionGuardar}
      voluntarios={voluntarios} accionAlta={accionAlta} accionBaja={accionBaja}
      preflight={preflight} puedeForzarPreflight={rol === 'superadmin'}
      accionImportarRutas={puedeAsignar(rol) ? accionImportarRutas : undefined}
      rutasPendientes={rutasPendientes} totalRutas={totalRutas} diasRevisionRutas={DIAS_REVISION_RUTAS_DEFAULT}
      accionRutaRevisada={puedeAsignar(rol) ? accionRutaRevisada : undefined}
    />
  );
}
