import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { asignarSitiosViaje, cambiarEstadoSitio, guardarEquivalencia, guardarSitio, importarEquivalencias, importarSitios } from './repo_validacion';
import { leerSitioManual, normalizarTextoEquivalencia, parsearCsvEquivalencias, parsearCsvSitios, MAX_LARGO_TEXTO_EQUIVALENCIA, LADOS_EQUIVALENCIA, MARCAR_IGNORAR, MARCAR_INSTRUCCION, type LadoEquivalencia } from './sitios';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DEL CATÁLOGO DE SITIOS (panel) — la lógica de las acciones de servidor, con puertos para poder
// probarla: el permiso, la validación, el todo-o-nada del CSV y los mensajes en palabras.
//
// El permiso se comprueba AQUÍ (una acción de servidor es un endpoint): dueño, encargado y superadmin.
// Un rol desconocido o el contador no pueden. El `tenantId` sale de la SESIÓN, nunca del formulario.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAccionSitio =
  | { ok: true; mensaje: string; detalles?: string[] }
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

// ── T-A5-17: equivalencias texto→sitio ──────────────────────────────────────

/**
 * Puertos de las equivalencias, APARTE de `DepsSitios` y construidos al LLAMAR (no al cargar el módulo): así el resto de las
 * acciones no depende de ellos ni de cómo se simule `repo_validacion` en sus pruebas.
 */
export interface DepsEquivalencias {
  importar: typeof importarEquivalencias;
  guardar: typeof guardarEquivalencia;
}
export const depsEquivalenciasReales = (): DepsEquivalencias => ({ importar: importarEquivalencias, guardar: guardarEquivalencia });

export { MARCAR_IGNORAR, MARCAR_INSTRUCCION };

/**
 * Importa el CSV de equivalencias. A diferencia del catálogo NO es todo-o-nada: cada fila se aprueba o se rechaza sola y se dice
 * cuál y por qué. Solo si no se pudo guardar NI UNA fila (y hubo rechazos) es un error.
 */
export async function importarEquivalenciasDelPanel(
  ctx: ContextoSitios, entrada: { texto: string }, d: DepsEquivalencias = depsEquivalenciasReales(),
): Promise<ResultadoAccionSitio> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico importan equivalencias.' };
  const parseado = parsearCsvEquivalencias(entrada.texto);
  const aTexto = (e: { linea: number; mensaje: string }) => (e.linea > 0 ? `Línea ${e.linea}: ${e.mensaje}` : e.mensaje);
  if (parseado.filas.length === 0 && parseado.errores.length > 0) {
    const n = parseado.errores.length;
    return { ok: false, error: `No se importó nada: ${n} problema${n === 1 ? '' : 's'} en el archivo.`, detalles: parseado.errores.slice(0, MAX_DETALLES).map(aTexto) };
  }
  if (parseado.filas.length === 0) {
    return { ok: false, error: 'No se importó nada: todas las filas están sin completar. Llena «geocerca_codigo» (o marca «tipo») y vuelve a subir el archivo.' };
  }
  try {
    const r = await d.importar(ctx.tenantId, parseado.filas);
    const rechazos = [...parseado.errores, ...r.rechazadas].sort((a, b) => a.linea - b.linea);
    const detalles = rechazos.slice(0, MAX_DETALLES).map(aTexto);
    if (r.guardadas + r.sinCambios === 0) {
      const n = rechazos.length;
      return { ok: false, error: `No se guardó ninguna fila: ${n} rechazada${n === 1 ? '' : 's'}.`, detalles };
    }
    const partes = [`${r.guardadas} guardada${r.guardadas === 1 ? '' : 's'} (${r.nuevas} nueva${r.nuevas === 1 ? '' : 's'}, ${r.actualizadas} actualizada${r.actualizadas === 1 ? '' : 's'})`,
      `${r.sinCambios} sin cambios`, `${rechazos.length} rechazada${rechazos.length === 1 ? '' : 's'}`];
    if (parseado.sinCompletar > 0) partes.push(`${parseado.sinCompletar} sin completar`);
    return { ok: true, mensaje: `Equivalencias: ${partes.join(', ')}.`, ...(detalles.length > 0 ? { detalles } : {}) };
  } catch (e) {
    logger.error('equivalencias.importar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude importar ahorita. Lo que ya estaba guardado sigue igual; intenta de nuevo en un momento.' };
  }
}

/** Asigna una equivalencia desde la lista de «textos sin sitio»: un sitio de la flota, «instrucción» o «ignorar». */
export async function asignarEquivalenciaDelPanel(ctx: ContextoSitios, fd: { get(k: string): unknown }, d: DepsEquivalencias = depsEquivalenciasReales()): Promise<ResultadoAccionSitio> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico editan las equivalencias.' };
  const txt = (k: string): string => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
  const textoNormalizado = normalizarTextoEquivalencia(txt('texto').slice(0, MAX_LARGO_TEXTO_EQUIVALENCIA));
  if (!textoNormalizado) return { ok: false, error: 'No reconozco el texto.' };
  const lado = txt('lado') as LadoEquivalencia;
  if (!LADOS_EQUIVALENCIA.includes(lado)) return { ok: false, error: 'No reconozco el lado del texto.' };
  const eleccion = txt('asignar');
  let tipo: 'sitio' | 'sin_sitio' | 'ignorar';
  let geocercaId: string | null = null;
  if (eleccion === MARCAR_INSTRUCCION) tipo = 'sin_sitio';
  else if (eleccion === MARCAR_IGNORAR) tipo = 'ignorar';
  else if (UUID.test(eleccion)) { tipo = 'sitio'; geocercaId = eleccion.toLowerCase(); }
  else return { ok: false, error: 'Elige un sitio, o marca el texto como instrucción o como ignorar.' };
  try {
    const r = await d.guardar(ctx.tenantId, { textoNormalizado, lado, tipo, geocercaId });
    if (r === 'sitio_no_encontrado') return { ok: false, error: 'Ese sitio no existe en tu catálogo. Impórtalo primero en Sitios.' };
    if (r === 'datos_invalidos') return { ok: false, error: 'La base rechazó los datos: revisa el texto y el sitio.' };
    return { ok: true, mensaje: tipo === 'sitio' ? 'Listo: los viajes con ese texto se ligan a ese sitio.' : 'Listo: ese texto ya no se cuenta como lugar.' };
  } catch (e) {
    logger.error('equivalencias.asignar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: FALLO };
  }
}
