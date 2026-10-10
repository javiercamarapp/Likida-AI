import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { leerCredencial } from '../conectores/credenciales';
import { httpReal, type Http, type ValoresCredencial } from '../conectores/tipos';
import { ErrorTablaPropia, type CursoTablaPropia, type FilaRechazada, type ResultadoLectura } from '../conectores/tabla_propia/contrato';
import { leerCursosCsv, leerCursosMatriz } from '../conectores/tabla_propia/csv';
import { crearLectorTablaPropia } from '../conectores/tabla_propia/lector';
import { llaveEconomico } from '../conectores/tabla_propia/validar';
import { matrizDeArchivoCatalogo } from './archivo';
import {
  guardarCursosLote, listarCasetas, listarConveniosPorNombre, listarUnidades,
  type CasetaVista, type CursoParaGuardar, type ResultadoGuardarCursos,
} from './datos';
import { normalizarNombre } from './formatos';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTAR CURSOS (rutas autorizadas) — de la tabla de la flota o de un CSV/Excel subido a mano.
//
// El lector (tabla_propia) entrega nombres: el número económico de la unidad, el nombre del convenio y los nombres de las
// casetas. Aquí se TRADUCEN a los ids de la flota. Reglas, las mismas del resto de los importadores:
//   · TODO-O-NADA: si una fila no se entiende o un nombre no existe, no se importa NINGUNA y se dice cuál (un catálogo de
//     cursos a medias que se ve completo autorizaría de menos y reclamaría de más).
//   · Nada se adivina: una caseta que no está en el catálogo (por nombre o alias) o un convenio con dos coincidencias son un
//     error con su fila, no un parecido «cercano».
//   · Re-importar es seguro: la llave es el código de SU sistema (la RPC 0665 actualiza, no duplica). Un curso que ya no viene
//     en el archivo NO se borra (se desactiva a mano): seguir autorizando de más solo deja de reclamar, nunca reclama de más.
//   · Re-importar RESPETA la baja manual (0678): un curso que la flota desactivó sigue desactivado aunque vuelva en el archivo (se
//     actualizan sus datos, no su `activo`). Para reactivarlo se hace a mano, el mismo gesto que lo desactivó.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_DETALLES = 30;

export type ResultadoImportCursos =
  | { ok: true; creados: number; actualizados: number; leidos: number }
  /** `motivo`: 'sin_conexion' (no hay «mis propias tablas» guardadas) o 'sin_cursos' (la conexión no trae vista/archivo de cursos): no son fallas de la flota. */
  | { ok: false; error: string; detalles?: string[]; motivo?: 'sin_conexion' | 'sin_cursos' };

export interface DepsResolverCursos {
  unidades: Array<{ id: string; numeroEconomico: string }>;
  casetas: ReadonlyArray<Pick<CasetaVista, 'id' | 'nombreNorm' | 'alias'>>;
  convenios: ReadonlyArray<{ id: string; nombre: string }>;
}

/** Traduce los nombres del lector a ids. PURA. Devuelve los cursos listos para la RPC o los problemas, fila por fila. */
export function resolverCursos(
  cursos: readonly CursoTablaPropia[], d: DepsResolverCursos, primeraFila = 2,
): { ok: CursoParaGuardar[]; problemas: FilaRechazada[] } {
  const unidad = new Map(d.unidades.map((u) => [llaveEconomico(u.numeroEconomico), u.id]));
  const caseta = new Map<string, string>();
  const ambiguas = new Set<string>();
  for (const c of d.casetas) {
    for (const n of [c.nombreNorm, ...c.alias.map(normalizarNombre)]) {
      if (n === '') continue;
      const previo = caseta.get(n);
      if (previo !== undefined && previo !== c.id) ambiguas.add(n); else caseta.set(n, c.id);
    }
  }
  const convenio = new Map<string, string[]>();
  for (const c of d.convenios) {
    const k = normalizarNombre(c.nombre);
    convenio.set(k, [...(convenio.get(k) ?? []), c.id]);
  }

  const ok: CursoParaGuardar[] = []; const problemas: FilaRechazada[] = [];
  cursos.forEach((c, i) => {
    const fila = i + primeraFila;
    const faltas: string[] = [];
    let unidadId: string | null = null; let convenioId: string | null = null;
    if (c.unidad !== null) {
      unidadId = unidad.get(llaveEconomico(c.unidad)) ?? null;
      if (!unidadId) faltas.push(`la unidad «${c.unidad}» no está en la flota`);
    }
    if (c.convenio !== null) {
      const ids = convenio.get(normalizarNombre(c.convenio)) ?? [];
      if (ids.length === 0) faltas.push(`el convenio «${c.convenio}» no existe en la flota`);
      else if (ids.length > 1) faltas.push(`el convenio «${c.convenio}» está repetido (${ids.length} coincidencias): renómbralo para distinguirlo`);
      else convenioId = ids[0];
    }
    const casetaIds: string[] = [];
    for (const nombre of c.casetas) {
      const k = normalizarNombre(nombre);
      const id = caseta.get(k);
      if (!id) faltas.push(`la caseta «${nombre}» no está en el catálogo de casetas (ni como alias): cárgala primero`);
      else if (ambiguas.has(k)) faltas.push(`la caseta «${nombre}» coincide con dos casetas del catálogo`);
      else casetaIds.push(id);
    }
    if (faltas.length > 0) return void problemas.push({ fila, motivo: `${c.codigo}: ${faltas.join('; ')}` });
    ok.push({
      codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, unidadId, convenioId, vigenteDesde: c.vigenteDesde, vigenteHasta: c.vigenteHasta,
      casetaIds, corredor: c.corredor ? c.corredor.map((p) => ({ lat: p.lat, lng: p.lon })) : null, bufferM: c.bufferM,
    });
  });
  return { ok, problemas };
}

export interface DepsImportarCursos {
  leidos: ResultadoLectura<CursoTablaPropia>;
  resolver?: () => Promise<DepsResolverCursos>;
  guardar?: (tenantId: string, cursos: readonly CursoParaGuardar[]) => Promise<ResultadoGuardarCursos>;
}

async function dependenciasPorOmision(tenantId: string): Promise<DepsResolverCursos> {
  const [unidades, casetas, convenios] = await Promise.all([listarUnidades(tenantId), listarCasetas(tenantId), listarConveniosPorNombre(tenantId)]);
  return { unidades, casetas, convenios };
}

/** El caso de uso, con puertos: lo leído → ids de la flota → guardado atómico. */
export async function importarCursosLeidos(tenantId: string, d: DepsImportarCursos): Promise<ResultadoImportCursos> {
  const rechazadasLectura = d.leidos.rechazadas.map((r) => `Fila ${r.fila}: ${r.motivo}`);
  if (d.leidos.filas.length === 0) {
    return { ok: false, error: 'No se importó nada: no hay cursos válidos en el archivo.', detalles: rechazadasLectura.slice(0, MAX_DETALLES) };
  }
  let deps: DepsResolverCursos;
  try {
    deps = await (d.resolver ?? (() => dependenciasPorOmision(tenantId)))();
  } catch (e) {
    logger.error('peajes.cursos_importar_lectura', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude leer los catálogos de la flota ahorita. No se guardó nada; intenta de nuevo en un momento.' };
  }
  const r = resolverCursos(d.leidos.filas, deps);
  // Las rechazadas de la lectura traen el número de fila del ARCHIVO; las del resolver se identifican por el código del curso.
  const problemas = [...rechazadasLectura, ...r.problemas.map((p) => `Curso ${p.motivo}`)];
  if (problemas.length > 0) {
    return { ok: false, error: `No se importó nada: ${problemas.length} curso(s) con problema.`, detalles: problemas.slice(0, MAX_DETALLES) };
  }
  let g: ResultadoGuardarCursos;
  try {
    g = await (d.guardar ?? guardarCursosLote)(tenantId, r.ok);
  } catch (e) {
    logger.error('peajes.cursos_importar_guardar', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude guardar ahorita. No se guardó nada; intenta de nuevo en un momento.' };
  }
  if (g.estado === 'ok') return { ok: true, creados: g.creados, actualizados: g.actualizados, leidos: d.leidos.filas.length };
  if (g.estado === 'referencia_invalida') return { ok: false, error: 'No se importó nada: una unidad, convenio o caseta no es de tu flota.' };
  if (g.estado === 'invalida') return { ok: false, error: 'No se importó nada: un curso no cumple la forma (revisa que cada curso lleve casetas o corredor y a quién aplica).' };
  return { ok: false, error: 'No pude guardar ahorita. No se guardó nada; intenta de nuevo en un momento.' };
}

/** Un CSV o Excel subido a mano. El permiso y el `tenantId` los pone quien llama (la acción del panel ya los comprobó). */
export async function importarCursosArchivo(tenantId: string, nombre: string, buffer: Uint8Array, deps: Partial<Omit<DepsImportarCursos, 'leidos'>> = {}): Promise<ResultadoImportCursos> {
  const m = matrizDeArchivoCatalogo(nombre, buffer);
  if (!m.ok) return { ok: false, error: m.motivo };
  let leidos: ResultadoLectura<CursoTablaPropia>;
  try {
    const esCsv = /\.(csv|tsv|txt)$/i.test(nombre.trim()) || !/\.[a-z0-9]+$/i.test(nombre.trim());
    leidos = esCsv ? leerCursosCsv(new TextDecoder('utf-8').decode(buffer)) : leerCursosMatriz(m.matriz);
  } catch (e) {
    if (e instanceof ErrorTablaPropia) return { ok: false, error: e.message };
    throw e;
  }
  return importarCursosLeidos(tenantId, { ...deps, leidos });
}

export interface DepsCursosDeFlota {
  leerCredencial?: (tenantId: string, conectorId: string) => Promise<ValoresCredencial | null>;
  http?: Http;
  resolver?: DepsImportarCursos['resolver'];
  guardar?: DepsImportarCursos['guardar'];
}

/** Los mensajes con que los lectores dicen «esta conexión no tiene cursos configurados» (no es una falla: es que no aplica). */
export const SIN_CURSOS_CONFIGURADOS = /^no hay (?:vista|archivo|endpoint) de cursos/i;

/** Lee la credencial de la flota, arma el lector y importa — SIN comprobar permisos (lo llama la acción del panel o un cron). */
export async function importarCursosDeFlota(tenantId: string, deps: DepsCursosDeFlota = {}): Promise<ResultadoImportCursos> {
  let valores: ValoresCredencial | null;
  try {
    valores = await (deps.leerCredencial ?? leerCredencial)(tenantId, 'tabla_propia');
  } catch {
    return { ok: false, error: 'No pude abrir la conexión guardada de su tabla. Vuelve a capturarla en Conexiones.' };
  }
  if (!valores) return { ok: false, error: 'Primero conecta tus tablas de GPS en Conexiones.', motivo: 'sin_conexion' };
  const c = crearLectorTablaPropia(valores, { http: deps.http ?? httpReal() });
  if (!c.ok) return { ok: false, error: `La conexión de su tabla no es válida: ${c.motivo}.` };
  if (!c.lector.leerCursos) return { ok: false, error: 'Ese modo de conexión no sabe leer cursos.' };
  let leidos: ResultadoLectura<CursoTablaPropia>;
  try {
    leidos = await c.lector.leerCursos();
  } catch (e) {
    if (e instanceof ErrorTablaPropia) return { ok: false, error: e.message, ...(SIN_CURSOS_CONFIGURADOS.test(e.message) ? { motivo: 'sin_cursos' as const } : {}) };
    logger.error('peajes.cursos_lectura_fallo', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No pude leer los cursos de su tabla ahorita.' };
  }
  return importarCursosLeidos(tenantId, { leidos, resolver: deps.resolver, guardar: deps.guardar });
}

/** La acción del panel: el permiso se comprueba AQUÍ (una acción de servidor es un endpoint) y el `tenantId` sale de la sesión. */
export async function importarCursosDeTablaPropia(
  ctx: { tenantId: string; rol: string }, deps: DepsCursosDeFlota = {},
): Promise<ResultadoImportCursos> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico importan cursos.' };
  return importarCursosDeFlota(ctx.tenantId, deps);
}
