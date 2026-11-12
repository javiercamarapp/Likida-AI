import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../../../sufijo';
import { avisoAgentePeajesApagado } from '../apagado';
import { logger } from '@/lib/logger';
import { dejarFlash, leerFlash } from '@/lib/likida/mensaje_flash';
import { appUrl } from '@/lib/env';
import { MAX_CATALOGO_BYTES } from '@/lib/likida/peajes/archivo';
import {
  listarTags, listarUnidades, altaTag, bajaTag, importarTagsArchivo,
  listarCasetas, importarCasetasArchivo, cambiarEstadoCaseta,
  listarGeocercas, guardarGeocerca, cambiarEstadoGeocerca, TIPOS_GEOCERCA,
  listarCursos, listarConveniosPorNombre, cambiarEstadoCurso,
  listarMapeos, guardarMapeo, borrarMapeo,
  leerEstadoBuzon, activarBuzon, desactivarBuzon, rotarLlaveBuzon, listarArchivosIngesta,
  leerEstadoEntradas, activarCorreoPeajes, desactivarCorreoPeajes, rotarCorreoPeajes, guardarRemitentesPeajes,
  guardarPullPeajes, apagarPullPeajes, borrarCredencialPull,
  listarTarifas, confirmarTarifa, importarTarifasArchivo,
  leerConfigPeajes, leerCorreoAvisos, guardarUmbralesPeajes, guardarConfigAvisos,
  leerVinculosActivo, guardarVinculosActivo, resumenFuenteViajes, vincularDesglose,
  listarInmovilizadas, importarInmovilizadasArchivo, quitarInmovilizada,
  leerReglasFlota, guardarReglasFlota,
  type ResultadoImportacionCatalogo,
} from '@/lib/likida/peajes/datos';
import { ORIGENES_TARIFA, type OrigenTarifa } from '@/lib/likida/peajes/tarifario_archivo';
import { parsearDiasAviso, INTERRUPTORES } from '@/lib/likida/peajes/config_avisos';
import { guardarDestinatarioAtipicos } from '@/lib/likida/peajes/aviso_atipicos';
import { listarDesgloses } from '@/lib/likida/intake/desglose_peaje';
import {
  listarReglasCasetas, listarTagsBaja, listarExcepcionesUnidad, guardarExcepcionUnidad, quitarExcepcionUnidad, guardarReglaCaseta, parsearClases, altaBajaDeTag, quitarBajaDeTag, cargarCoordenadasDeCasetas,
  revisionDeDesglose,
} from '@/lib/likida/peajes/revision_cobros';
import { importarCursosArchivo, importarCursosDeTablaPropia, type ResultadoImportCursos } from '@/lib/likida/peajes/cursos_importar';
import { secretoMaestro, claveDeFlota, reintentarArchivoPeaje } from '@/lib/likida/peajes/ingesta';
import { cofreConfigurado } from '@/lib/likida/conectores/cofre';
import { direccionPj } from '@/lib/likida/peajes/correo_entrante';
import { dominioBuzon } from '@/lib/correo/buzon';
import { parsearImporteMx } from '@/lib/formato';
import { superficiePeajesDeTenant, MOTIVO_STAND_BY_PERFIL } from '@/lib/likida/peajes/superficie_perfil';
import { guardarCorreoAvisosDeFormulario, enviarPruebaDeFormulario } from './acciones-correo-avisos';
import { correoConfigurado } from '@/lib/correo/enviar';
import { VistaConfiguracionPeajes } from './vista';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('agentes');
  return { title: t('rest.configuracion_del_conciliador_de_peajes') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/peajes/configuracion';

function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch((e) => {
    logger.error('peajes.configuracion.lectura', { err: e instanceof Error ? e.message : String(e) });
    return null;
  });
}


/** La puerta común de TODA action de esta página (nivel de módulo: una acción no puede capturar ayudantes del componente). */
async function puertaConfig(sp: { vista?: string; tenant?: string; rol?: string } | undefined, tenantId: string, area: 'dinero' | 'administracion' = 'dinero'): Promise<string | null> {
  const { t: tx } = await getT('agentes');
  const sesion = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerArea(sesion.rol, area)) return tx('rest.tu_rol_no_puede_hacer_esto');
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return tx('rest.esta_configuracion_no_es_de_tu');
  return null;
}

/** Puerta extra de las acciones de STAND-BY (geocercas, cursos): una flota con perfil `cinco_agentes` no las ejecuta aunque llegue un POST directo. */
async function puertaStandBy(sp: { vista?: string; tenant?: string; rol?: string } | undefined, tenantId: string, parte: 'gps' | 'cursos'): Promise<string | null> {
  const no = await puertaConfig(sp, tenantId);
  if (no) return no;
  return (await superficiePeajesDeTenant(tenantId))[parte] ? null : MOTIVO_STAND_BY_PERFIL;
}

async function volverConfig(sufijo: string, msg: string): Promise<never> {
  // A37-S13-08 / A37-S14-07: el mensaje viaja en una cookie de servidor, no como texto libre en la URL.
  await dejarFlash(RUTA, msg.startsWith('error:') ? { error: msg.slice(6) } : { aviso: msg });
  redirect(`${RUTA}${sufijo}`);
}

async function archivoDeForm(fd: FormData): Promise<{ nombre: string; buffer: Uint8Array } | string> {
  const { t: tx } = await getT('agentes');
  const a = fd.get('archivo');
  if (!(a instanceof File) || a.size === 0) return tx('rest.elige_un_archivo_csv_o_excel');
  if (a.size > MAX_CATALOGO_BYTES) return tx('rest.ese_archivo_pesa_demasiado_para_ser_2');
  return { nombre: a.name, buffer: new Uint8Array(await a.arrayBuffer()) };
}

/** Resume una importación de catálogo en una frase corta (las primeras filas rechazadas, con su número). */
function resumenImportacion(r: ResultadoImportacionCatalogo, singular: string): string {
  if (r.error) return `error:${r.error}`;
  const partes = [`${r.guardadas} ${singular} guardados`];
  if (r.actualizadas > 0) partes.push(`${r.actualizadas} cambiaron algo ya existente`);
  if (r.notas && r.notas.length > 0) partes.push(r.notas.join(' '));
  if (r.rechazadas.length > 0) {
    const ej = r.rechazadas.slice(0, 5).map((x) => `fila ${x.fila}: ${x.motivo}`).join('; ');
    partes.push(`${r.rechazadas.length} filas rechazadas (${ej}${r.rechazadas.length > 5 ? '…' : ''})`);
  }
  return partes.join(' · ');
}

/** Resume la importación de cursos en una frase corta (el primer problema con su fila o código). */
function resumenCursos(r: ResultadoImportCursos, tx: TAgentes = TR_ES.t): string {
  if (!r.ok) {
    const det = (r.detalles ?? []).slice(0, 5).join('; ');
    return `error:${r.error}${det ? ` ${det}${(r.detalles?.length ?? 0) > 5 ? '…' : ''}` : ''}`;
  }
  return tx('rest.cursos_leidos_nuevos_actualizados', { leidos: r.leidos, creados: r.creados, actualizados: r.actualizados });
}

/**
 * La configuración del conciliador de peajes (Agente 2): lo que el cruce
 * necesita saber de la flota y que no se puede adivinar — qué TAG es de qué
 * unidad, dónde queda cada caseta, cómo escribe cada proveedor sus columnas —
 * y el buzón firmado por donde el proveedor puede mandar su archivo solo.
 *
 * Cada server action repite su puerta adentro (sesión, área, flota): una action
 * es un endpoint alcanzable por POST directo, no un botón.
 */
export default async function PaginaConfiguracionPeajes({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  const puedeAdministrar = puedeVerArea(rol, 'administracion');
  const flash = await leerFlash(RUTA);

  const superficie = await superficiePeajesDeTenant(tenantId);
  const secreto = secretoMaestro();
  const [vinculosActivo, fuenteViajes, inmovilizadas, reglasFlota, tarifas, configPeajes, correoAvisos, reglasCasetas, tagsBaja, excepcionesUnidad, tags, unidades, casetas, geocercas, cursos, convenios, mapeos, buzon, archivos, entradas] = await Promise.all([
    safe(() => leerVinculosActivo(tenantId)),
    safe(() => resumenFuenteViajes(tenantId)),
    safe(() => listarInmovilizadas(tenantId)),
    safe(() => leerReglasFlota(tenantId)),
    safe(() => listarTarifas(tenantId)),
    safe(() => leerConfigPeajes(tenantId)),
    safe(() => leerCorreoAvisos(tenantId)),
    safe(() => listarReglasCasetas(tenantId)),
    safe(() => listarTagsBaja(tenantId)),
    safe(() => listarExcepcionesUnidad(tenantId)),
    safe(() => listarTags(tenantId)),
    safe(() => listarUnidades(tenantId)),
    safe(() => listarCasetas(tenantId)),
    superficie.gps ? safe(() => listarGeocercas(tenantId)) : Promise.resolve(null),
    superficie.cursos ? safe(() => listarCursos(tenantId)) : Promise.resolve(null),
    superficie.cursos ? safe(() => listarConveniosPorNombre(tenantId)) : Promise.resolve(null),
    safe(() => listarMapeos(tenantId)),
    safe(() => leerEstadoBuzon(tenantId)),
    safe(() => listarArchivosIngesta(tenantId, 20)),
    safe(() => leerEstadoEntradas(tenantId)),
  ]);

  // La llave SOLO se calcula para quien administra y SOLO si el buzón está activo.
  const llave = puedeAdministrar && secreto && buzon?.activa ? claveDeFlota(secreto, tenantId, buzon.rotacion) : null;
  const baseUrl = appUrl();

  // ── Buzón ──
  async function accionActivarBuzon() {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await activarBuzon(tenantId)) ? tx('rest.buzon_activado_copia_la_llave_y') : tx('rest.error_no_se_pudo_activar_el'));
  }
  async function accionDesactivarBuzon() {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await desactivarBuzon(tenantId)) ? tx('rest.buzon_desactivado_el_endpoint_rechaza_todo') : tx('rest.error_no_se_pudo_desactivar_intentalo'));
  }
  async function accionRotarLlave() {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await rotarLlaveBuzon(tenantId)) ? tx('rest.llave_rotada_la_anterior_dejo_de') : tx('rest.error_no_se_pudo_rotar_la'));
  }
  async function accionReintentarArchivo(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const id = String(fd.get('archivo') ?? '');
    return volverConfig(sufijo, (await reintentarArchivoPeaje(tenantId, id, String(fd.get('proveedor') ?? ''))) ? tx('rest.el_archivo_volvio_a_la_cola') : tx('rest.error_ese_archivo_no_se_puede'));
  }

  // ── Recepción por correo y pull (0563) ──
  async function accionActivarCorreo() {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await activarCorreoPeajes(tenantId)) ? tx('rest.correo_activado_comparte_la_direccion_solo') : tx('rest.error_no_se_pudo_activar_el_2'));
  }
  async function accionDesactivarCorreo() {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await desactivarCorreoPeajes(tenantId)) ? tx('rest.correo_apagado_lo_que_llegue_a') : tx('rest.error_no_se_pudo_apagar_el'));
  }
  async function accionRotarCorreo() {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await rotarCorreoPeajes(tenantId)) ? tx('rest.direccion_cambiada_la_anterior_dejo_de') : tx('rest.error_no_se_pudo_cambiar_la'));
  }
  async function accionGuardarRemitentes(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const r = await guardarRemitentesPeajes(tenantId, String(fd.get('remitentes') ?? '').split(/[\n,;]+/));
    return volverConfig(sufijo, r.ok ? (r.guardados === 0 ? tx('rest.sin_lista_el_buzon_no_recibe') : `${r.guardados} remitente(s) permitidos.`) : `error:${r.motivo}`);
  }
  async function accionGuardarPull(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const r = await guardarPullPeajes(tenantId, {
      url: String(fd.get('url') ?? ''), token: String(fd.get('token') ?? ''), intervaloMin: Number(String(fd.get('intervalo') ?? '').trim()),
    });
    return volverConfig(sufijo, r.ok ? tx('rest.consulta_automatica_encendida_la_primera_corre') : `error:${r.motivo}`);
  }
  async function accionApagarPull() {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await apagarPullPeajes(tenantId)) ? tx('rest.consulta_automatica_apagada') : tx('rest.error_no_se_pudo_apagar'));
  }
  async function accionBorrarCredencialPull() {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await borrarCredencialPull(tenantId)) ? 'Token borrado.' : tx('rest.error_no_se_pudo_borrar_el'));
  }

  // ── Avisos de peajes por correo ──
  async function accionGuardarCorreoAvisos(fd: FormData) {
    'use server';
    const sesion = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    const r = await guardarCorreoAvisosDeFormulario(sesion, tenantId, fd);
    return volverConfig(sufijo, r.ok ? r.mensaje : `error:${r.error}`);
  }
  async function accionEnviarPruebaCorreoAvisos() {
    'use server';
    const sesion = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    const r = await enviarPruebaDeFormulario(sesion, tenantId);
    return volverConfig(sufijo, r.ok ? r.mensaje : `error:${r.error}`);
  }

  // ── TAGs ──
  async function accionAltaTag(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const r = await altaTag(tenantId, {
      tag: String(fd.get('tag') ?? ''), unidadId: String(fd.get('unidad') ?? ''), proveedor: String(fd.get('proveedor') ?? ''),
    });
    return volverConfig(sufijo, r.ok ? (r.reactivadoDesdeBaja ? tx('rest.tag_guardado_y_reactivado_estaba_de', { reactivadoDesdeBaja: r.reactivadoDesdeBaja }) : 'TAG guardado.') : `error:${r.motivo}`);
  }
  async function accionBajaTag(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const r = await bajaTag(tenantId, String(fd.get('tag') ?? ''), { fecha: fd.get('fecha'), motivo: fd.get('motivo') });
    return volverConfig(sufijo, r.ok ? tx('rest.tag_dado_de_baja_queda_en') : `error:${r.motivo}`);
  }
  async function accionImportarTags(fd: FormData) {
    'use server';
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') return volverConfig(sufijo, `error:${a}`);
    const r = await importarTagsArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer);
    return volverConfig(sufijo, resumenImportacion(r, 'TAGs'));
  }

  // ── Casetas ──
  async function accionImportarCasetas(fd: FormData) {
    'use server';
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') return volverConfig(sufijo, `error:${a}`);
    const fuente = String(fd.get('fuente') ?? '').trim().slice(0, 200) || 'CSV cargado desde el panel';
    const r = await importarCasetasArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer, fuente);
    return volverConfig(sufijo, resumenImportacion(r, 'casetas'));
  }
  async function accionEstadoCaseta(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const activa = String(fd.get('activa')) === 'true';
    return volverConfig(sufijo, (await cambiarEstadoCaseta(tenantId, String(fd.get('caseta') ?? ''), activa)) ? (activa ? 'Caseta activada.' : tx('rest.caseta_desactivada_ya_no_se_usa')) : tx('rest.error_no_se_pudo_cambiar_la_2'));
  }

  // ── Geocercas ──
  async function accionGuardarGeocerca(fd: FormData) {
    'use server';
    const no = await puertaStandBy(sp, tenantId, 'gps');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const num = (k: string) => parsearImporteMx(String(fd.get(k) ?? ''));
    const r = await guardarGeocerca(tenantId, {
      nombre: String(fd.get('nombre') ?? ''), tipo: String(fd.get('tipo') ?? ''),
      lat: num('lat'), lng: num('lng'), radioM: num('radio_m'),
    });
    return volverConfig(sufijo, r.ok ? 'Geocerca guardada.' : `error:${r.motivo}`);
  }
  async function accionEstadoGeocerca(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaStandBy(sp, tenantId, 'gps');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const activa = String(fd.get('activa')) === 'true';
    return volverConfig(sufijo, (await cambiarEstadoGeocerca(tenantId, String(fd.get('geocerca') ?? ''), activa)) ? (activa ? 'Geocerca activada.' : 'Geocerca desactivada.') : tx('rest.error_no_se_pudo_cambiar_la_3'));
  }

  // ── Cursos (rutas autorizadas) ──
  async function accionImportarCursos(fd: FormData) {
    'use server';
    const no = await puertaStandBy(sp, tenantId, 'cursos');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') return volverConfig(sufijo, `error:${a}`);
    return volverConfig(sufijo, resumenCursos(await importarCursosArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer)));
  }
  async function accionImportarCursosDeTabla() {
    'use server';
    const no = await puertaStandBy(sp, tenantId, 'cursos');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const sesion = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    return volverConfig(sufijo, resumenCursos(await importarCursosDeTablaPropia({ tenantId, rol: sesion.rol })));
  }
  async function accionEstadoCurso(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaStandBy(sp, tenantId, 'cursos');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const activo = String(fd.get('activo')) === 'true';
    return volverConfig(sufijo, (await cambiarEstadoCurso(tenantId, String(fd.get('curso') ?? ''), activo)) ? (activo ? 'Curso activado.' : tx('rest.curso_desactivado_ya_no_se_evalua')) : tx('rest.error_no_se_pudo_cambiar_el'));
  }

  // ── Reglas de cobro (revisión de cobros) ──
  async function accionGuardarReglaCaseta(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const clases = parsearClases(String(fd.get('clases') ?? ''));
    if (clases === null) return volverConfig(sufijo, tx('rest.error_las_clases_se_escriben_como'));
    const r = await guardarReglaCaseta(tenantId, {
      nombre: String(fd.get('nombre') ?? ''), clasesPermitidas: clases ?? [], noCruzar: String(fd.get('no_cruzar') ?? '') === '1',
    });
    return volverConfig(sufijo, r.ok ? tx('rest.regla_de_la_caseta_guardada_la') : `error:${r.motivo}`);
  }
  async function accionCargarCoordenadas(fd: FormData) {
    'use server';
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') return volverConfig(sufijo, `error:${a}`);
    const r = await cargarCoordenadasDeCasetas(tenantId, (a as { buffer: Uint8Array }).buffer);
    if (r.error) return volverConfig(sufijo, `error:${r.error}`);
    const rech = r.rechazadas.length > 0 ? ` · ${r.rechazadas.length} filas rechazadas (${r.rechazadas.slice(0, 5).map((x) => `fila ${x.fila}: ${x.motivo}`).join('; ')}${r.rechazadas.length > 5 ? '…' : ''})` : '';
    return volverConfig(sufijo, `${r.guardadas} casetas con coordenadas${rech}`);
  }
  async function accionAltaBajaTag(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const r = await altaBajaDeTag(tenantId, { tag: String(fd.get('tag') ?? ''), bajaEn: String(fd.get('baja_en') ?? ''), motivo: String(fd.get('motivo') ?? '') || null });
    return volverConfig(sufijo, r.ok ? tx('rest.tag_dado_de_baja_cualquier_cruce') : `error:${r.motivo}`);
  }
  async function accionQuitarBajaTag(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await quitarBajaDeTag(tenantId, String(fd.get('baja') ?? ''))) ? 'Baja del TAG quitada.' : tx('rest.error_no_se_pudo_quitar_la'));
  }
  async function accionGuardarExcepcionUnidad(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const r = await guardarExcepcionUnidad(tenantId, { caseta: String(fd.get('caseta') ?? ''), unidad: String(fd.get('unidad') ?? ''), nota: String(fd.get('nota') ?? '') || null });
    return volverConfig(sufijo, r.ok ? tx('rest.excepcion_guardada_esa_unidad_ya_no') : `error:${r.motivo}`);
  }
  async function accionQuitarExcepcionUnidad(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await quitarExcepcionUnidad(tenantId, String(fd.get('excepcion') ?? ''))) ? tx('rest.excepcion_quitada') : tx('rest.error_no_se_pudo_quitar_la_2'));
  }

  // ── Tarifario ──
  async function accionImportarTarifas(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') return volverConfig(sufijo, `error:${a}`);
    const pedido = String(fd.get('origen') ?? 'declarada');
    // «inferida» no se carga a mano: la produce el sistema; el formulario solo ofrece declarada o proveedor.
    const origen: OrigenTarifa = (ORIGENES_TARIFA as readonly string[]).includes(pedido) && pedido !== 'inferida' ? (pedido as OrigenTarifa) : 'declarada';
    const sesion = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    // A37-A2-26: con origen «proveedor» las tarifas nacen confirmadas; quien sube el archivo es quien las confirma.
    const quien = sesion.nombre?.trim() || tx('rest.usuario_de_la_flota');
    const r = await importarTarifasArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer, origen, quien);
    const resumen = resumenImportacion(r, 'tarifas');
    return volverConfig(sufijo, !r.error && origen !== 'proveedor' && r.guardadas > 0 ? tx('rest.quedan_por_confirmar_confirmalas_una_a', { resumen }) : resumen);
  }
  async function accionConfirmarTarifa(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const sesion = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    const quien = sesion.nombre?.trim() || tx('rest.usuario_de_la_flota');
    const r = await confirmarTarifa(tenantId, String(fd.get('tarifa') ?? ''), quien);
    return volverConfig(sufijo, r.ok ? (r.yaConfirmada ? 'Esa tarifa ya estaba confirmada.' : tx('rest.tarifa_confirmada_desde_ahora_puede_convertir')) : `error:${r.motivo}`);
  }
  async function accionSugerirPasada() {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    let ultimo: Awaited<ReturnType<typeof listarDesgloses>>;
    try { ultimo = await listarDesgloses(tenantId, 1); } catch { return volverConfig(sufijo, tx('rest.error_no_se_pudo_leer_el')); }
    const id = ultimo[0]?.desgloseId;
    if (!id) return volverConfig(sufijo, tx('rest.aun_no_hay_desgloses_sube_el'));
    let rep: Awaited<ReturnType<typeof revisionDeDesglose>>;
    try { rep = await revisionDeDesglose(tenantId, id as string); } catch { return volverConfig(sufijo, tx('rest.error_no_se_pudo_revisar_el')); }
    const s = rep?.revision.sugerenciasPasada ?? [];
    return volverConfig(sufijo, s.length === 0
      ? tx('rest.ninguna_caseta_del_ultimo_desglose_parece')
      : tx('rest.posible_tarifa_por_pasada_casi_todo', { s: s.slice(0, 8).map((x) => `${x.caseta} (${x.cruces})`).join(', '), v: s.length > 8 ? '…' : '' }));
  }

  // ── Umbrales, plazo y avisos ──
  async function accionGuardarUmbrales(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const n = (k: string) => parsearImporteMx(String(fd.get(k) ?? ''));
    const marcado = (k: string) => String(fd.get(k) ?? '') === '1';
    const r = await guardarUmbralesPeajes(tenantId, {
      activo: marcado('activo'),
      umbrales: {
        repeticion_caseta: { activa: marcado('repeticion_activa'), minCruces: n('repeticion_min'), ventanaHoras: n('repeticion_horas') },
        ida_y_vuelta_madrugada: { activa: marcado('madrugada_activa'), minCruces: n('madrugada_min') },
        secuencia_imposible: { activa: marcado('velocidad_activa'), velocidadMaxKmh: n('velocidad_max') },
      },
    });
    return volverConfig(sufijo, r.ok ? (r.valor.activo ? tx('rest.umbrales_guardados_la_busqueda_de_cruces') : tx('rest.umbrales_guardados_la_busqueda_de_cruces_2')) : `error:${r.motivo}`);
  }
  async function accionGuardarAvisos(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const dias = parsearDiasAviso(String(fd.get('aviso_dias') ?? ''));
    if (dias === null) return volverConfig(sufijo, tx('rest.error_los_dias_de_aviso_se'));
    const marcado = (k: string) => String(fd.get(k) ?? '') === '1';
    const r = await guardarConfigAvisos(tenantId, {
      plazo: { meses: Number(String(fd.get('plazo_meses') ?? '').trim()), avisoDias: dias },
      recordatorio: { diasGracia: Number(String(fd.get('dias_gracia') ?? '').trim()) },
      interruptores: Object.fromEntries(INTERRUPTORES.map((i) => [i, marcado(i)])),
    });
    return volverConfig(sufijo, r.ok ? 'Plazo y avisos guardados.' : `error:${r.motivo}`);
  }
  async function accionGuardarDestinatario(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const r = await guardarDestinatarioAtipicos(tenantId, String(fd.get('telefono') ?? ''));
    return volverConfig(sufijo, r.ok ? (r.telefono ? 'Destinatario guardado.' : tx('rest.sin_destinatario_los_avisos_solo_se')) : `error:${r.motivo}`);
  }

  // ── Cruce de cobros con viajes (T-A2-21): el interruptor por flota ──
  async function accionGuardarCruceViajes(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId, 'administracion');
    if (no) return volverConfig(sufijo, `error:${no}`);
    const activo = String(fd.get('activo') ?? '') === '1';
    if (!(await guardarVinculosActivo(tenantId, activo))) return volverConfig(sufijo, tx('rest.error_no_se_pudo_guardar_el_2'));
    if (!activo) return volverConfig(sufijo, tx('rest.cruce_con_viajes_apagado_los_archivos'));
    // Al encenderlo se recalcula el último archivo, para no esperar al siguiente corte. No lanza; si falla, el interruptor ya quedó guardado.
    let ultimo: Awaited<ReturnType<typeof listarDesgloses>> = [];
    try { ultimo = await listarDesgloses(tenantId, 1); } catch { /* sin último archivo: solo se enciende */ }
    const id = ultimo[0]?.desgloseId as string | undefined;
    if (!id) return volverConfig(sufijo, tx('rest.cruce_con_viajes_encendido_se_aplica'));
    const r = await vincularDesglose(tenantId, id);
    if (r.estado === 'ok') return volverConfig(sufijo, tx('rest.cruce_con_viajes_encendido_ultimo_archivo', { ligados: r.ligados, ambiguos: r.ambiguos, conflictos: r.conflictos, sinViaje: r.sinViaje, sinUnidad: r.sinUnidad }));
    return volverConfig(sufijo, tx('rest.cruce_con_viajes_encendido_pero_no'));
  }

  // ── Unidades inmovilizadas (T-A2-36) ──
  async function accionCargarInmovilizadas(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') return volverConfig(sufijo, `error:${a}`);
    const r = await importarInmovilizadasArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer);
    return volverConfig(sufijo, resumenImportacion(r, tx('rest.ventanas_de_inmovilizacion')));
  }
  async function accionQuitarInmovilizada(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await quitarInmovilizada(tenantId, String(fd.get('ventana') ?? ''))) ? 'Ventana quitada.' : tx('rest.error_no_se_pudo_quitar_la_3'));
  }

  // ── Clases del cobro por flota: utilitarios y clase 1 (0936) ──
  async function accionGuardarReglasFlota(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const r = await guardarReglasFlota(tenantId, { clasesUtilitario: String(fd.get('clases_utilitario') ?? ''), clase1: String(fd.get('clase_uno') ?? '') });
    return volverConfig(sufijo, r.ok ? tx('rest.clases_guardadas_la_revision_de_cobros') : `error:${r.motivo}`);
  }

  // ── Mapeo de columnas ──
  async function accionGuardarMapeo(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    const campo = (k: string) => String(fd.get(k) ?? '').trim();
    const r = await guardarMapeo(tenantId, campo('proveedor'), {
      fecha: campo('fecha'), hora: campo('hora'), caseta: campo('caseta'), monto: campo('monto'), tag: campo('tag'),
      unidad: campo('unidad'), clase: campo('clase'),
    });
    return volverConfig(sufijo, r.ok ? tx('rest.mapeo_guardado_se_usa_en_los') : `error:${r.motivo}`);
  }
  async function accionBorrarMapeo(fd: FormData) {
    'use server';
    const { t: tx } = await getT('agentes');
    const no = await puertaConfig(sp, tenantId);
    if (no) return volverConfig(sufijo, `error:${no}`);
    return volverConfig(sufijo, (await borrarMapeo(tenantId, String(fd.get('mapeo') ?? ''))) ? 'Mapeo eliminado.' : tx('rest.error_no_se_pudo_eliminar_el'));
  }

  // El kill switch solo se MUESTRA aquí (el cruce lo respeta); configurar no es operar.
  const aviso = await avisoAgentePeajesApagado().catch(() => null);

  return (
    <VistaConfiguracionPeajes
      sufijo={sufijo}
      aviso={flash.aviso ?? null}
      error={flash.error ?? null}
      agenteApagado={aviso}
      tags={tags} unidades={unidades} casetas={casetas} geocercas={geocercas} cursos={cursos} convenios={convenios} mapeos={mapeos} archivos={archivos}
      tiposGeocerca={[...TIPOS_GEOCERCA]}
      superficie={superficie}
      buzon={{
        estado: buzon === null ? 'ilegible' : (buzon?.activa ? 'activo' : 'inactivo'),
        rotacion: buzon?.rotacion ?? null,
        secretoConfigurado: secreto !== null,
        puedeAdministrar,
        llave,
        url: `${baseUrl}/api/peajes/ingesta`,
        flotaId: tenantId,
      }}
      entradas={{
        config: entradas,
        puedeAdministrar,
        direccionCorreo: entradas?.correoToken ? direccionPj(entradas.correoToken, dominioBuzon()) : null,
        cofreConfigurado: cofreConfigurado(),
      }}
      reglasCobro={{
        casetas: reglasCasetas, bajas: tagsBaja, excepciones: excepcionesUnidad,
        acciones: {
          guardarReglaCaseta: accionGuardarReglaCaseta, cargarCoordenadas: accionCargarCoordenadas, altaBajaTag: accionAltaBajaTag, quitarBajaTag: accionQuitarBajaTag,
          guardarExcepcionUnidad: accionGuardarExcepcionUnidad, quitarExcepcionUnidad: accionQuitarExcepcionUnidad,
        },
      }}
      inmovilizadas={{ ventanas: inmovilizadas, puedeEditar: puedeVerArea(rol, 'dinero'), acciones: { cargarInmovilizadas: accionCargarInmovilizadas, quitarInmovilizada: accionQuitarInmovilizada } }}
      clasesCobro={{ reglas: reglasFlota, puedeEditar: puedeVerArea(rol, 'dinero'), acciones: { guardarReglasFlota: accionGuardarReglasFlota } }}
      cruceViajes={{ activo: vinculosActivo, fuente: fuenteViajes, puedeAdministrar, acciones: { guardarCruceViajes: accionGuardarCruceViajes } }}
      tarifario={{ tarifas, acciones: { importarTarifas: accionImportarTarifas, confirmarTarifa: accionConfirmarTarifa, sugerirPasada: accionSugerirPasada } }}
      umbralesAvisos={{
        config: configPeajes, puedeAdministrar,
        acciones: { guardarUmbrales: accionGuardarUmbrales, guardarAvisos: accionGuardarAvisos, guardarDestinatario: accionGuardarDestinatario },
      }}
      correoAvisos={{
        config: correoAvisos, puedeAdministrar, servicioActivo: correoConfigurado(),
        acciones: { guardar: accionGuardarCorreoAvisos, enviarPrueba: accionEnviarPruebaCorreoAvisos },
      }}
      acciones={{
        activarCorreo: accionActivarCorreo, desactivarCorreo: accionDesactivarCorreo, rotarCorreo: accionRotarCorreo, guardarRemitentes: accionGuardarRemitentes,
        guardarPull: accionGuardarPull, apagarPull: accionApagarPull, borrarCredencialPull: accionBorrarCredencialPull,
        activarBuzon: accionActivarBuzon, desactivarBuzon: accionDesactivarBuzon, rotarLlave: accionRotarLlave, reintentarArchivo: accionReintentarArchivo,
        altaTag: accionAltaTag, bajaTag: accionBajaTag, importarTags: accionImportarTags,
        importarCasetas: accionImportarCasetas, estadoCaseta: accionEstadoCaseta,
        guardarGeocerca: accionGuardarGeocerca, estadoGeocerca: accionEstadoGeocerca,
        importarCursos: accionImportarCursos, importarCursosDeTabla: accionImportarCursosDeTabla, estadoCurso: accionEstadoCurso,
        guardarMapeo: accionGuardarMapeo, borrarMapeo: accionBorrarMapeo,
      }}
    />
  );
}
