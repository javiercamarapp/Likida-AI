import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { importarRutas, marcarRutaRevisada } from './repo';
import { hoyDeLaFlota, parsearCsvRutas } from './rutas';

// ═══════════════════════════════════════════════════════════════════════════
// LA ACCIÓN DE IMPORTAR RUTAS AUTORIZADAS (T-A5-48) — la lógica de la acción de servidor, con puerto para poder probarla:
// el permiso, la validación fila por fila y los mensajes en palabras.
//
// El permiso se comprueba AQUÍ (una acción de servidor es un endpoint): dueño, encargado y superadmin. El `tenantId` sale de la
// SESIÓN, nunca del formulario. Como las equivalencias (T-A5-17), NO es todo-o-nada: cada fila se aprueba o se rechaza sola y se
// dice cuál y por qué. Solo si no se pudo guardar NI UNA fila (y hubo rechazos) es un error. Reimportar el mismo archivo = 0 cambios.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAccionRutas =
  | { ok: true; mensaje: string; detalles?: string[] }
  | { ok: false; error: string; detalles?: string[] };

export interface DepsRutas { importar: typeof importarRutas; marcar: typeof marcarRutaRevisada }
export const depsRutasReales = (): DepsRutas => ({ importar: importarRutas, marcar: marcarRutaRevisada });

export interface ContextoRutas { tenantId: string; rol: string }

const MAX_DETALLES = 30;

export async function importarRutasDelPanel(
  ctx: ContextoRutas, entrada: { texto: string }, d: DepsRutas = depsRutasReales(),
): Promise<ResultadoAccionRutas> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico importan rutas.' };
  const parseado = parsearCsvRutas(entrada.texto);
  const aTexto = (e: { linea: number; mensaje: string }) => (e.linea > 0 ? `Línea ${e.linea}: ${e.mensaje}` : e.mensaje);
  const detalles = parseado.errores.slice(0, MAX_DETALLES).map(aTexto);
  if (parseado.filas.length === 0) {
    const n = parseado.errores.length;
    return { ok: false, error: `No se importó nada: ${n} problema${n === 1 ? '' : 's'} en el archivo.`, detalles };
  }
  try {
    const r = await d.importar(ctx.tenantId, parseado.filas);
    const rechazadas = parseado.errores.length;
    const partes = [
      `${r.guardadas} guardada${r.guardadas === 1 ? '' : 's'} (${r.nuevas} nueva${r.nuevas === 1 ? '' : 's'}, ${r.actualizadas} actualizada${r.actualizadas === 1 ? '' : 's'})`,
      `${r.sinCambios} sin cambios`, `${rechazadas} rechazada${rechazadas === 1 ? '' : 's'}`,
    ];
    return { ok: true, mensaje: `Rutas: ${partes.join(', ')}.`, ...(detalles.length > 0 ? { detalles } : {}) };
  } catch (e) {
    logger.error('rutas.importar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude importar ahorita. Lo que ya estaba guardado sigue igual; intenta de nuevo en un momento.' };
  }
}

/**
 * T-A5-50: el botón «Revisada» de la lista de pendientes. Mismo permiso que importar; el tenant sale de la SESIÓN y el día es el de la
 * flota (America/Mexico_City), no el del servidor. Solo escribe `revisada_en`: no envía mensajes ni crea cron.
 */
export async function marcarRutaRevisadaDelPanel(
  ctx: ContextoRutas, entrada: { id: string }, d: DepsRutas = depsRutasReales(), ahora: Date = new Date(),
): Promise<ResultadoAccionRutas> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico marcan rutas como revisadas.' };
  const id = typeof entrada.id === 'string' ? entrada.id.trim() : '';
  if (id === '') return { ok: false, error: 'No sé cuál ruta marcar; recarga la pantalla e intenta de nuevo.' };
  try {
    const existia = await d.marcar(ctx.tenantId, id, hoyDeLaFlota(ahora));
    if (!existia) return { ok: false, error: 'Esa ruta ya no existe; recarga la pantalla.' };
    return { ok: true, mensaje: 'Ruta marcada como revisada hoy.' };
  } catch (e) {
    logger.error('rutas.revisar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude marcarla ahorita. Intenta de nuevo en un momento.' };
  }
}
