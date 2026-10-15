// ═══════════════════════════════════════════════════════════════════════════
// HUELLA de una fila leída del TMS: base de la idempotencia por clave externa.
//
// La clave externa (la que declara el mapeo) dice QUÉ fila es; la huella dice CÓMO ESTABA. Con las dos
// se decide, sin escribir nada, qué hacer con una fila al volver a leerla:
//  · clave nunca vista            → `nueva`
//  · clave vista, misma huella    → `omitida`  (no se vuelve a asentar)
//  · clave vista, huella distinta → `actualizada` (p. ej. una bitácora corregida después)
//
// La huella solo cubre los campos ESTABLES (importes, fechas, folios): nunca marcas de lectura como
// «fecha_recibido» o contadores del origen, o cada corrida vería todo como cambiado.
// Sin red, sin base de datos: el almacén de huellas previas lo pone quien llama (tarea de migración aparte).
// ═══════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import { leerRuta, type FilaMapeada } from './mapeo';
import type { RecursoTms } from './tipos';

const MAX_PROFUNDIDAD_HUELLA = 8;

/** JSON canónico: llaves ordenadas, `undefined` fuera, fechas en ISO. Lo no representable lanza (nunca se hashea a ciegas). */
function canonico(v: unknown, nivel = 0): string {
  if (nivel > MAX_PROFUNDIDAD_HUELLA) throw new Error('los campos estables son demasiado profundos para una huella');
  if (v === undefined || v === null) return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('un campo estable trae un número no finito');
    return JSON.stringify(Object.is(v, -0) ? 0 : v);
  }
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error('un campo estable trae una fecha inválida');
    return JSON.stringify(v.toISOString());
  }
  if (Array.isArray(v)) return `[${v.map((x) => canonico(x, nivel + 1)).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const llaves = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${llaves.map((k) => `${JSON.stringify(k)}:${canonico(o[k], nivel + 1)}`).join(',')}}`;
  }
  throw new Error(`un campo estable es de un tipo no admitido (${typeof v})`);
}

/**
 * sha256 hexadecimal de (recurso, clave externa, campos estables). El orden de las llaves no importa;
 * el mismo valor en otro recurso o con otra clave da otra huella.
 */
export function huella(recurso: RecursoTms, claveExterna: string, camposEstables: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify([recurso, claveExterna, canonico(camposEstables)])).digest('hex');
}

export type EstadoFila = 'nueva' | 'omitida' | 'actualizada';

/** Decide qué hacer con UNA fila contra las huellas ya vistas (clave externa → huella). No modifica `previas`. */
export function estadoDeFila(previas: ReadonlyMap<string, string>, claveExterna: string, huellaNueva: string): EstadoFila {
  const antes = previas.get(claveExterna);
  if (antes === undefined) return 'nueva';
  return antes === huellaNueva ? 'omitida' : 'actualizada';
}

export interface FilaClasificada<T> extends FilaMapeada<T> { huella: string; estado: EstadoFila }

export interface ResultadoClasificacion<T> {
  /** Todas las filas, en el orden de entrada, con su huella y estado. */
  filas: FilaClasificada<T>[];
  /** `nueva` + `actualizada`: lo que hay que asentar. */
  porAsentar: FilaClasificada<T>[];
  omitidas: number;
}

/**
 * Clasifica filas ya mapeadas. `camposEstables` son rutas de destino («importe», «renglones[0].valor»);
 * si se omite se usa la fila completa. Una clave repetida dentro de la misma tanda cuenta como omitida
 * (la primera gana): leer dos veces la misma fila no la duplica.
 */
export function clasificarFilas<T extends object = Record<string, unknown>>(
  recurso: RecursoTms,
  filas: FilaMapeada<T>[],
  previas: ReadonlyMap<string, string>,
  camposEstables?: string[],
): ResultadoClasificacion<T> {
  const vistasAhora = new Set<string>();
  const salida: FilaClasificada<T>[] = [];
  for (const f of filas) {
    const campos: Record<string, unknown> = camposEstables
      ? Object.fromEntries(camposEstables.map((c) => [c, leerRuta(f.fila, c)]))
      : (f.fila as Record<string, unknown>);
    const h = huella(recurso, f.clave, campos);
    const repetida = vistasAhora.has(f.clave);
    const estado: EstadoFila = repetida ? 'omitida' : estadoDeFila(previas, f.clave, h);
    vistasAhora.add(f.clave);
    salida.push({ ...f, huella: h, estado });
  }
  return {
    filas: salida,
    porAsentar: salida.filter((f) => f.estado !== 'omitida'),
    omitidas: salida.filter((f) => f.estado === 'omitida').length,
  };
}
