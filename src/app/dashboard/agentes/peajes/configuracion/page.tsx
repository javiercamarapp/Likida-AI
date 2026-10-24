import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../../../sufijo';
import { avisoAgentePeajesApagado } from '../apagado';
import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { MAX_CATALOGO_BYTES } from '@/lib/likida/peajes/archivo';
import {
  listarTags, listarUnidades, altaTag, bajaTag, importarTagsArchivo,
  listarCasetas, importarCasetasArchivo, cambiarEstadoCaseta,
  listarGeocercas, guardarGeocerca, cambiarEstadoGeocerca, TIPOS_GEOCERCA,
  listarCursos, listarConveniosPorNombre, cambiarEstadoCurso,
  listarMapeos, guardarMapeo, borrarMapeo,
  leerConfigBuzon, activarBuzon, desactivarBuzon, rotarLlaveBuzon, listarArchivosIngesta,
  leerConfigEntradas, activarCorreoPeajes, desactivarCorreoPeajes, rotarCorreoPeajes, guardarRemitentesPeajes,
  guardarPullPeajes, apagarPullPeajes, borrarCredencialPull,
  listarTarifas, confirmarTarifa, importarTarifasArchivo,
  leerConfigPeajes, guardarUmbralesPeajes, guardarConfigAvisos,
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
import { VistaConfiguracionPeajes } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/peajes/configuracion';

function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch((e) => {
    logger.error('peajes.configuracion.lectura', { err: e instanceof Error ? e.message : String(e) });
    return null;
  });
}


/** La puerta común de TODA action de esta página (nivel de módulo: una acción no puede capturar ayudantes del componente). */
async function puertaConfig(tenantId: string, area: 'dinero' | 'administracion' = 'dinero'): Promise<string | null> {
  const sesion = await requireSessionTenant(RUTA);
  if (!puedeVerArea(sesion.rol, area)) return 'Tu rol no puede hacer esto.';
  if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return 'Esta configuración no es de tu flota.';
  return null;
}

/** Puerta extra de las acciones de STAND-BY (geocercas, cursos): una flota con perfil `cinco_agentes` no las ejecuta aunque llegue un POST directo. */
async function puertaStandBy(tenantId: string, parte: 'gps' | 'cursos'): Promise<string | null> {
  const no = await puertaConfig(tenantId);
  if (no) return no;
  return (await superficiePeajesDeTenant(tenantId))[parte] ? null : MOTIVO_STAND_BY_PERFIL;
}

function volverConfig(sufijo: string, msg: string): never {
  const param = msg.startsWith('error:') ? `error=${encodeURIComponent(msg.slice(6))}` : `aviso=${encodeURIComponent(msg)}`;
  redirect(`${RUTA}${sufijo}${sufijo ? '&' : '?'}${param}`);
}

async function archivoDeForm(fd: FormData): Promise<{ nombre: string; buffer: Uint8Array } | string> {
  const a = fd.get('archivo');
  if (!(a instanceof File) || a.size === 0) return 'Elige un archivo CSV o Excel.';
  if (a.size > MAX_CATALOGO_BYTES) return 'Ese archivo pesa demasiado para ser un catálogo (máximo 4 MB).';
  return { nombre: a.name, buffer: new Uint8Array(await a.arrayBuffer()) };
}

/** Resume una importación de catálogo en una frase corta (las primeras filas rechazadas, con su número). */
function resumenImportacion(r: ResultadoImportacionCatalogo, singular: string): string {
  if (r.error) return `error:${r.error}`;
  const partes = [`${r.guardadas} ${singular} guardados`];
  if (r.actualizadas > 0) partes.push(`${r.actualizadas} cambiaron algo ya existente`);
  if (r.rechazadas.length > 0) {
    const ej = r.rechazadas.slice(0, 5).map((x) => `fila ${x.fila}: ${x.motivo}`).join('; ');
    partes.push(`${r.rechazadas.length} filas rechazadas (${ej}${r.rechazadas.length > 5 ? '…' : ''})`);
  }
  return partes.join(' · ');
}

/** Resume la importación de cursos en una frase corta (el primer problema con su fila o código). */
function resumenCursos(r: ResultadoImportCursos): string {
  if (!r.ok) {
    const det = (r.detalles ?? []).slice(0, 5).join('; ');
    return `error:${r.error}${det ? ` ${det}${(r.detalles?.length ?? 0) > 5 ? '…' : ''}` : ''}`;
  }
  return `${r.leidos} cursos leídos · ${r.creados} nuevos · ${r.actualizados} actualizados.`;
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
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; aviso?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  const puedeAdministrar = puedeVerArea(rol, 'administracion');

  const superficie = await superficiePeajesDeTenant(tenantId);
  const secreto = secretoMaestro();
  const [tarifas, configPeajes, reglasCasetas, tagsBaja, excepcionesUnidad, tags, unidades, casetas, geocercas, cursos, convenios, mapeos, buzon, archivos, entradas] = await Promise.all([
    safe(() => listarTarifas(tenantId)),
    safe(() => leerConfigPeajes(tenantId)),
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
    safe(() => leerConfigBuzon(tenantId)),
    safe(() => listarArchivosIngesta(tenantId, 20)),
    safe(() => leerConfigEntradas(tenantId)),
  ]);

  // La llave SOLO se calcula para quien administra y SOLO si el buzón está activo.
  const llave = puedeAdministrar && secreto && buzon?.activa ? claveDeFlota(secreto, tenantId, buzon.rotacion) : null;
  const baseUrl = appUrl();

  // ── Buzón ──
  async function accionActivarBuzon() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await activarBuzon(tenantId)) ? 'Buzón activado. Copia la llave y configúrala en el sistema que manda el archivo.' : 'error:No se pudo activar el buzón. Inténtalo de nuevo.');
  }
  async function accionDesactivarBuzon() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await desactivarBuzon(tenantId)) ? 'Buzón desactivado: el endpoint rechaza todo envío de esta flota.' : 'error:No se pudo desactivar. Inténtalo de nuevo.');
  }
  async function accionRotarLlave() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await rotarLlaveBuzon(tenantId)) ? 'Llave rotada: la anterior dejó de servir. Configura la nueva donde se firma el envío.' : 'error:No se pudo rotar la llave (¿el buzón está activado?).');
  }
  async function accionReintentarArchivo(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const id = String(fd.get('archivo') ?? '');
    volverConfig(sufijo, (await reintentarArchivoPeaje(tenantId, id, String(fd.get('proveedor') ?? ''))) ? 'El archivo volvió a la cola: el siguiente ciclo (≤ 15 min) lo procesa.' : 'error:Ese archivo no se puede reintentar (solo los fallidos que conservan su contenido).');
  }

  // ── Recepción por correo y pull (0563) ──
  async function accionActivarCorreo() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await activarCorreoPeajes(tenantId)) ? 'Correo activado. Comparte la dirección solo con quien manda los cortes.' : 'error:No se pudo activar el correo. Inténtalo de nuevo.');
  }
  async function accionDesactivarCorreo() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await desactivarCorreoPeajes(tenantId)) ? 'Correo apagado: lo que llegue a la dirección se ignora.' : 'error:No se pudo apagar el correo.');
  }
  async function accionRotarCorreo() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await rotarCorreoPeajes(tenantId)) ? 'Dirección cambiada: la anterior dejó de servir. Avísale a quien manda los cortes.' : 'error:No se pudo cambiar la dirección (¿el correo está activado?).');
  }
  async function accionGuardarRemitentes(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    const r = await guardarRemitentesPeajes(tenantId, String(fd.get('remitentes') ?? '').split(/[\n,;]+/));
    volverConfig(sufijo, r.ok ? (r.guardados === 0 ? 'Sin lista: entra el correo de cualquiera que tenga la dirección.' : `${r.guardados} remitente(s) permitidos.`) : `error:${r.motivo}`);
  }
  async function accionGuardarPull(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    const r = await guardarPullPeajes(tenantId, {
      url: String(fd.get('url') ?? ''), token: String(fd.get('token') ?? ''), intervaloMin: Number(String(fd.get('intervalo') ?? '').trim()),
    });
    volverConfig(sufijo, r.ok ? 'Consulta automática encendida: la primera corre en el siguiente ciclo (≤ 15 min).' : `error:${r.motivo}`);
  }
  async function accionApagarPull() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await apagarPullPeajes(tenantId)) ? 'Consulta automática apagada.' : 'error:No se pudo apagar.');
  }
  async function accionBorrarCredencialPull() {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await borrarCredencialPull(tenantId)) ? 'Token borrado.' : 'error:No se pudo borrar el token.');
  }

  // ── TAGs ──
  async function accionAltaTag(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const r = await altaTag(tenantId, {
      tag: String(fd.get('tag') ?? ''), unidadId: String(fd.get('unidad') ?? ''), proveedor: String(fd.get('proveedor') ?? ''),
    });
    volverConfig(sufijo, r.ok ? (r.reactivadoDesdeBaja ? `TAG guardado y reactivado (estaba de baja desde el ${r.reactivadoDesdeBaja}).` : 'TAG guardado.') : `error:${r.motivo}`);
  }
  async function accionBajaTag(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const r = await bajaTag(tenantId, String(fd.get('tag') ?? ''), { fecha: fd.get('fecha'), motivo: fd.get('motivo') });
    volverConfig(sufijo, r.ok ? 'TAG dado de baja: queda en el historial con su fecha y motivo.' : `error:${r.motivo}`);
  }
  async function accionImportarTags(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') volverConfig(sufijo, `error:${a}`);
    const r = await importarTagsArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer);
    volverConfig(sufijo, resumenImportacion(r, 'TAGs'));
  }

  // ── Casetas ──
  async function accionImportarCasetas(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') volverConfig(sufijo, `error:${a}`);
    const fuente = String(fd.get('fuente') ?? '').trim().slice(0, 200) || 'CSV cargado desde el panel';
    const r = await importarCasetasArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer, fuente);
    volverConfig(sufijo, resumenImportacion(r, 'casetas'));
  }
  async function accionEstadoCaseta(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const activa = String(fd.get('activa')) === 'true';
    volverConfig(sufijo, (await cambiarEstadoCaseta(tenantId, String(fd.get('caseta') ?? ''), activa)) ? (activa ? 'Caseta activada.' : 'Caseta desactivada: ya no se usa en el cruce.') : 'error:No se pudo cambiar la caseta.');
  }

  // ── Geocercas ──
  async function accionGuardarGeocerca(fd: FormData) {
    'use server';
    const no = await puertaStandBy(tenantId, 'gps');
    if (no) volverConfig(sufijo, `error:${no}`);
    const num = (k: string) => parsearImporteMx(String(fd.get(k) ?? ''));
    const r = await guardarGeocerca(tenantId, {
      nombre: String(fd.get('nombre') ?? ''), tipo: String(fd.get('tipo') ?? ''),
      lat: num('lat'), lng: num('lng'), radioM: num('radio_m'),
    });
    volverConfig(sufijo, r.ok ? 'Geocerca guardada.' : `error:${r.motivo}`);
  }
  async function accionEstadoGeocerca(fd: FormData) {
    'use server';
    const no = await puertaStandBy(tenantId, 'gps');
    if (no) volverConfig(sufijo, `error:${no}`);
    const activa = String(fd.get('activa')) === 'true';
    volverConfig(sufijo, (await cambiarEstadoGeocerca(tenantId, String(fd.get('geocerca') ?? ''), activa)) ? (activa ? 'Geocerca activada.' : 'Geocerca desactivada.') : 'error:No se pudo cambiar la geocerca.');
  }

  // ── Cursos (rutas autorizadas) ──
  async function accionImportarCursos(fd: FormData) {
    'use server';
    const no = await puertaStandBy(tenantId, 'cursos');
    if (no) volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') volverConfig(sufijo, `error:${a}`);
    volverConfig(sufijo, resumenCursos(await importarCursosArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer)));
  }
  async function accionImportarCursosDeTabla() {
    'use server';
    const no = await puertaStandBy(tenantId, 'cursos');
    if (no) volverConfig(sufijo, `error:${no}`);
    const sesion = await requireSessionTenant(RUTA);
    volverConfig(sufijo, resumenCursos(await importarCursosDeTablaPropia({ tenantId, rol: sesion.rol })));
  }
  async function accionEstadoCurso(fd: FormData) {
    'use server';
    const no = await puertaStandBy(tenantId, 'cursos');
    if (no) volverConfig(sufijo, `error:${no}`);
    const activo = String(fd.get('activo')) === 'true';
    volverConfig(sufijo, (await cambiarEstadoCurso(tenantId, String(fd.get('curso') ?? ''), activo)) ? (activo ? 'Curso activado.' : 'Curso desactivado: ya no se evalúa en el reporte de reclamación.') : 'error:No se pudo cambiar el curso.');
  }

  // ── Reglas de cobro (revisión de cobros) ──
  async function accionGuardarReglaCaseta(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const clases = parsearClases(String(fd.get('clases') ?? ''));
    if (clases === null) volverConfig(sufijo, 'error:Las clases se escriben como números separados por comas (por ejemplo 1, 6).');
    const r = await guardarReglaCaseta(tenantId, {
      nombre: String(fd.get('nombre') ?? ''), clasesPermitidas: clases ?? [], noCruzar: String(fd.get('no_cruzar') ?? '') === '1',
    });
    volverConfig(sufijo, r.ok ? 'Regla de la caseta guardada. La revisión de cobros la usa en cuanto abras un desglose.' : `error:${r.motivo}`);
  }
  async function accionCargarCoordenadas(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') volverConfig(sufijo, `error:${a}`);
    const r = await cargarCoordenadasDeCasetas(tenantId, (a as { buffer: Uint8Array }).buffer);
    if (r.error) volverConfig(sufijo, `error:${r.error}`);
    const rech = r.rechazadas.length > 0 ? ` · ${r.rechazadas.length} filas rechazadas (${r.rechazadas.slice(0, 5).map((x) => `fila ${x.fila}: ${x.motivo}`).join('; ')}${r.rechazadas.length > 5 ? '…' : ''})` : '';
    volverConfig(sufijo, `${r.guardadas} casetas con coordenadas${rech}`);
  }
  async function accionAltaBajaTag(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const r = await altaBajaDeTag(tenantId, { tag: String(fd.get('tag') ?? ''), bajaEn: String(fd.get('baja_en') ?? ''), motivo: String(fd.get('motivo') ?? '') || null });
    volverConfig(sufijo, r.ok ? 'TAG dado de baja. Cualquier cruce posterior a esa fecha se marcará como candidato.' : `error:${r.motivo}`);
  }
  async function accionQuitarBajaTag(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await quitarBajaDeTag(tenantId, String(fd.get('baja') ?? ''))) ? 'Baja del TAG quitada.' : 'error:No se pudo quitar la baja.');
  }
  async function accionGuardarExcepcionUnidad(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const r = await guardarExcepcionUnidad(tenantId, { caseta: String(fd.get('caseta') ?? ''), unidad: String(fd.get('unidad') ?? ''), nota: String(fd.get('nota') ?? '') || null });
    volverConfig(sufijo, r.ok ? 'Excepción guardada. Esa unidad ya no se marca al cruzar esa caseta.' : `error:${r.motivo}`);
  }
  async function accionQuitarExcepcionUnidad(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await quitarExcepcionUnidad(tenantId, String(fd.get('excepcion') ?? ''))) ? 'Excepción quitada.' : 'error:No se pudo quitar la excepción.');
  }

  // ── Tarifario ──
  async function accionImportarTarifas(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const a = await archivoDeForm(fd);
    if (typeof a === 'string') volverConfig(sufijo, `error:${a}`);
    const pedido = String(fd.get('origen') ?? 'declarada');
    // «inferida» no se carga a mano: la produce el sistema; el formulario solo ofrece declarada o proveedor.
    const origen: OrigenTarifa = (ORIGENES_TARIFA as readonly string[]).includes(pedido) && pedido !== 'inferida' ? (pedido as OrigenTarifa) : 'declarada';
    const r = await importarTarifasArchivo(tenantId, (a as { nombre: string }).nombre, (a as { buffer: Uint8Array }).buffer, origen);
    const resumen = resumenImportacion(r, 'tarifas');
    volverConfig(sufijo, !r.error && origen !== 'proveedor' && r.guardadas > 0 ? `${resumen} · Quedan por confirmar: confírmalas una a una abajo.` : resumen);
  }
  async function accionConfirmarTarifa(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const sesion = await requireSessionTenant(RUTA);
    const quien = sesion.nombre?.trim() || 'usuario de la flota';
    const r = await confirmarTarifa(tenantId, String(fd.get('tarifa') ?? ''), quien);
    volverConfig(sufijo, r.ok ? (r.yaConfirmada ? 'Esa tarifa ya estaba confirmada.' : 'Tarifa confirmada: desde ahora puede convertir un candidato en cobro con monto reclamable.') : `error:${r.motivo}`);
  }
  async function accionSugerirPasada() {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    let ultimo: Awaited<ReturnType<typeof listarDesgloses>>;
    try { ultimo = await listarDesgloses(tenantId, 1); } catch { volverConfig(sufijo, 'error:No se pudo leer el último desglose. Inténtalo de nuevo.'); }
    const id = ultimo[0]?.desgloseId;
    if (!id) volverConfig(sufijo, 'Aún no hay desgloses: sube el primer archivo del proveedor para poder sugerir casetas.');
    let rep: Awaited<ReturnType<typeof revisionDeDesglose>>;
    try { rep = await revisionDeDesglose(tenantId, id as string); } catch { volverConfig(sufijo, 'error:No se pudo revisar el último desglose. Inténtalo de nuevo.'); }
    const s = rep?.revision.sugerenciasPasada ?? [];
    volverConfig(sufijo, s.length === 0
      ? 'Ninguna caseta del último desglose parece de tarifa por pasada.'
      : `Posible tarifa por pasada (casi todo clase 1): ${s.slice(0, 8).map((x) => `${x.caseta} (${x.cruces})`).join(', ')}${s.length > 8 ? '…' : ''}. Es solo una sugerencia: decláralas en «Reglas de cobro» con clase válida extra 1.`);
  }

  // ── Umbrales, plazo y avisos ──
  async function accionGuardarUmbrales(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
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
    volverConfig(sufijo, r.ok ? (r.valor.activo ? 'Umbrales guardados. La búsqueda de cruces atípicos está ENCENDIDA.' : 'Umbrales guardados. La búsqueda de cruces atípicos sigue apagada.') : `error:${r.motivo}`);
  }
  async function accionGuardarAvisos(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    const dias = parsearDiasAviso(String(fd.get('aviso_dias') ?? ''));
    if (dias === null) volverConfig(sufijo, 'error:Los días de aviso se escriben como números enteros separados por comas (por ejemplo 30, 7).');
    const marcado = (k: string) => String(fd.get(k) ?? '') === '1';
    const r = await guardarConfigAvisos(tenantId, {
      plazo: { meses: Number(String(fd.get('plazo_meses') ?? '').trim()), avisoDias: dias },
      recordatorio: { diasGracia: Number(String(fd.get('dias_gracia') ?? '').trim()) },
      interruptores: Object.fromEntries(INTERRUPTORES.map((i) => [i, marcado(i)])),
    });
    volverConfig(sufijo, r.ok ? 'Plazo y avisos guardados.' : `error:${r.motivo}`);
  }
  async function accionGuardarDestinatario(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId, 'administracion');
    if (no) volverConfig(sufijo, `error:${no}`);
    const r = await guardarDestinatarioAtipicos(tenantId, String(fd.get('telefono') ?? ''));
    volverConfig(sufijo, r.ok ? (r.telefono ? 'Destinatario guardado.' : 'Sin destinatario: los avisos solo se verán en pantalla.') : `error:${r.motivo}`);
  }

  // ── Mapeo de columnas ──
  async function accionGuardarMapeo(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    const campo = (k: string) => String(fd.get(k) ?? '').trim();
    const r = await guardarMapeo(tenantId, campo('proveedor'), {
      fecha: campo('fecha'), hora: campo('hora'), caseta: campo('caseta'), monto: campo('monto'), tag: campo('tag'),
      unidad: campo('unidad'), clase: campo('clase'),
    });
    volverConfig(sufijo, r.ok ? 'Mapeo guardado. Se usa en los próximos archivos de ese proveedor; los fallidos se reintentan desde «Archivos recibidos».' : `error:${r.motivo}`);
  }
  async function accionBorrarMapeo(fd: FormData) {
    'use server';
    const no = await puertaConfig(tenantId);
    if (no) volverConfig(sufijo, `error:${no}`);
    volverConfig(sufijo, (await borrarMapeo(tenantId, String(fd.get('mapeo') ?? ''))) ? 'Mapeo eliminado.' : 'error:No se pudo eliminar el mapeo.');
  }

  // El kill switch solo se MUESTRA aquí (el cruce lo respeta); configurar no es operar.
  const aviso = await avisoAgentePeajesApagado().catch(() => null);

  return (
    <VistaConfiguracionPeajes
      sufijo={sufijo}
      aviso={sp.aviso ?? null}
      error={sp.error ?? null}
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
      tarifario={{ tarifas, acciones: { importarTarifas: accionImportarTarifas, confirmarTarifa: accionConfirmarTarifa, sugerirPasada: accionSugerirPasada } }}
      umbralesAvisos={{
        config: configPeajes, puedeAdministrar,
        acciones: { guardarUmbrales: accionGuardarUmbrales, guardarAvisos: accionGuardarAvisos, guardarDestinatario: accionGuardarDestinatario },
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
