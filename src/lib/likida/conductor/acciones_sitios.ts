import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { asignarSitiosViaje, cambiarEstadoSitio, guardarSitio, importarSitios } from './repo_validacion';
import { leerSitioManual, parsearCsvSitios } from './sitios';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DEL CATÁLOGO DE SITIOS (panel) — la lógica de las acciones de servidor, con puertos para poder
// probarla: el permiso, la validación, el todo-o-nada del CSV y los mensajes en palabras.
//
// El permiso se comprueba AQUÍ (una acción de servidor es un endpoint): dueño, encargado y superadmin.
// Un rol desconocido o el contador no pueden. El `tenantId` sale de la SESIÓN, nunca del formulario.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAccionSitio =
  | { ok: true; mensaje: string }
  | { ok: false; error: string; detalles?: string[] };

export interface DepsSitios {
  guardar: typeof guardarSitio;
  importar: typeof importarSitios;
  estado: typeof cambiarEstadoSitio;
  asignar: typeof asignarSitiosViaje;
}
export const depsSitiosReales: DepsSitios = { guardar: guardarSitio, importar: importarSitios, estado: cambiarEstadoSitio, asignar: asignarSitiosViaje };

export interface ContextoSitios { tenantId: string; rol: string }

const SIN_PERMISO = 'Solo el dueño de la flota o el jefe de tráfico editan el catálogo.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLO = 'No pude guardarlo ahorita. Intenta de nuevo en un momento.';

export async function guardarSitioDelPanel(ctx: ContextoSitios, fd: { get(k: string): unknown }, d: DepsSitios = depsSitiosReales): Promise<ResultadoAccionSitio> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  const leido = leerSitioManual(fd);
  if ('error' in leido) return { ok: false, error: leido.error };
  try {
    const r = await d.guardar(ctx.tenantId, leido.ok);
    switch (r) {
      case 'duplicado': return { ok: false, error: 'Ya existe un sitio con ese nombre o ese código en tu flota.' };
      case 'referencia_ajena': return { ok: false, error: 'El cliente o el sitio padre elegido no es de tu flota.' };
      case 'no_encontrado': return { ok: false, error: 'Ese sitio ya no existe.' };
      case 'datos_invalidos': return { ok: false, error: 'La base rechazó los datos: revisa coordenadas y radio.' };
      default: return { ok: true, mensaje: leido.ok.id ? 'Sitio actualizado.' : 'Sitio creado.' };
    }
  } catch (e) {
    logger.error('sitios.guardar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: FALLO };
  }
}

const MAX_DETALLES = 30;

export async function importarCsvDelPanel(
  ctx: ContextoSitios, entrada: { texto: string; radioDefecto: number | null }, d: DepsSitios = depsSitiosReales,
): Promise<ResultadoAccionSitio> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico importan sitios.' };
  const parseado = parsearCsvSitios(entrada.texto, { radioPorDefectoM: entrada.radioDefecto });
  if (parseado.errores.length > 0) {
    const n = parseado.errores.length;
    return {
      ok: false, error: `No se importó nada: ${n} problema${n === 1 ? '' : 's'} en el archivo.`,
      detalles: parseado.errores.slice(0, MAX_DETALLES).map((e) => (e.linea > 0 ? `Línea ${e.linea}: ${e.mensaje}` : e.mensaje)),
    };
  }
  try {
    const r = await d.importar(ctx.tenantId, parseado.filas);
    if (!r.ok) return { ok: false, error: 'No se importó nada: revisa estos puntos.', detalles: r.errores.slice(0, MAX_DETALLES).map((e) => `Línea ${e.linea}: ${e.mensaje}`) };
    return { ok: true, mensaje: `Importado: ${r.creados} nuevo${r.creados === 1 ? '' : 's'} y ${r.actualizados} actualizado${r.actualizados === 1 ? '' : 's'}.` };
  } catch (e) {
    logger.error('sitios.importar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude importar ahorita. No se guardó nada; intenta de nuevo en un momento.' };
  }
}

export async function archivarSitioDelPanel(ctx: ContextoSitios, id: string, activa: boolean, d: DepsSitios = depsSitiosReales): Promise<ResultadoAccionSitio> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  if (!UUID.test(id)) return { ok: false, error: 'No reconozco el sitio.' };
  try {
    const hecho = await d.estado(ctx.tenantId, id.toLowerCase(), activa);
    return hecho ? { ok: true, mensaje: activa ? 'Sitio reactivado.' : 'Sitio archivado.' } : { ok: false, error: 'Ese sitio ya no existe.' };
  } catch (e) {
    logger.error('sitios.estado_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: FALLO };
  }
}

/** El valor del `<select>` que significa «quítale el sitio». */
export const QUITAR_SITIO = '__quitar';

/**
 * Asigna el sitio de carga y/o de descarga de UN viaje desde el tablero. Cada lado: '' = no tocar, `__quitar` = desasignar,
 * o el id de un sitio de la flota (la base resuelve el id DENTRO de la flota de la sesión: uno ajeno es «no existe»).
 */
export async function asignarSitiosDelPanel(ctx: ContextoSitios, fd: { get(k: string): unknown }, d: DepsSitios = depsSitiosReales): Promise<ResultadoAccionSitio> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  const txt = (k: string): string => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
  const viajeId = txt('viajeId');
  if (!UUID.test(viajeId)) return { ok: false, error: 'No reconozco el viaje.' };
  const cambio: { origen?: string | null; destino?: string | null } = {};
  for (const lado of ['origen', 'destino'] as const) {
    const v = txt(lado);
    if (v === '') continue;
    if (v === QUITAR_SITIO) { cambio[lado] = null; continue; }
    if (!UUID.test(v)) return { ok: false, error: 'No reconozco el sitio elegido.' };
    cambio[lado] = v.toLowerCase();
  }
  if (Object.keys(cambio).length === 0) return { ok: false, error: 'Elige el sitio de carga, el de descarga o los dos.' };
  try {
    const r = await d.asignar(ctx.tenantId, viajeId.toLowerCase(), cambio);
    if (r === 'viaje_no_encontrado') return { ok: false, error: 'Ese viaje ya no existe.' };
    if (r === 'sitio_no_encontrado') return { ok: false, error: 'Alguno de los sitios no existe en tu catálogo.' };
    return { ok: true, mensaje: 'Listo: las próximas llegadas de este viaje se comparan contra esos sitios.' };
  } catch (e) {
    logger.error('sitios.asignar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: FALLO };
  }
}
