// Estado de una tabla de datos EN LA URL (sin estado oculto): orden, dirección y página viven en la query, así que una vista se
// comparte por chat, sobrevive a recargar y el botón de atrás funciona. Todo aquí es puro y se prueba sin React.

export type Dir = 'asc' | 'desc';
/** Lo que una celda aporta para ordenar. `null`/`undefined`/'' = sin dato: SIEMPRE al final, ascendente o descendente. */
export type ValorOrden = string | number | boolean | Date | null | undefined;
export type ParamsURL = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface EstadoTabla { orden: string | null; dir: Dir; pagina: number }

export interface ClavesTabla { orden: string; dir: string; pagina: string }
/** Nombres de los parámetros. Con `prefijo` («cola_») dos tablas de la misma pantalla no se pisan. */
export function clavesTabla(prefijo = ''): ClavesTabla {
  return { orden: `${prefijo}orden`, dir: `${prefijo}dir`, pagina: `${prefijo}pag` };
}

const primero = (v: string | readonly string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : (v as string | undefined));

/** Lee orden/dirección/página de la query. Una columna que no es ordenable o una página corrupta caen a lo de siempre (nunca lanza). */
export function leerEstadoTabla(
  params: ParamsURL,
  opciones: { ordenables: readonly string[]; inicial?: { orden: string; dir: Dir }; prefijo?: string },
): EstadoTabla {
  const k = clavesTabla(opciones.prefijo);
  const col = primero(params[k.orden]);
  const hayOrden = col !== undefined && opciones.ordenables.includes(col);
  const dirCruda = primero(params[k.dir]);
  const pag = Number(primero(params[k.pagina]));
  const pagina = Number.isInteger(pag) && pag >= 1 && pag <= 100_000 ? pag : 1;
  if (hayOrden) return { orden: col, dir: dirCruda === 'desc' ? 'desc' : 'asc', pagina };
  const ini = opciones.inicial;
  return { orden: ini && opciones.ordenables.includes(ini.orden) ? ini.orden : null, dir: ini?.dir ?? 'asc', pagina };
}

const colador = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

function aComparable(v: ValorOrden): number | string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** Ordena sin mutar. Estable (empate = orden original). Los sin dato van al final en las dos direcciones. Números como números,
 *  texto con el criterio de Excel en español (acentos y mayúsculas no cuentan; «V-2» antes que «V-10»). */
export function ordenarFilas<T>(filas: readonly T[], valor: (f: T) => ValorOrden, dir: Dir): T[] {
  const signo = dir === 'desc' ? -1 : 1;
  return filas
    .map((f, i) => ({ f, i, v: aComparable(valor(f)) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : colador.compare(String(a.v), String(b.v));
      return c !== 0 ? c * signo : a.i - b.i;
    })
    .map((x) => x.f);
}

export interface PaginaTabla<T> { filas: T[]; pagina: number; paginas: number; total: number; desde: number; hasta: number }

/** Recorta una página. Una página fuera de rango cae a la última (un enlace viejo no deja la tabla vacía). */
export function paginarFilas<T>(filas: readonly T[], pagina: number, tamano: number): PaginaTabla<T> {
  const t = Math.max(1, Math.floor(tamano));
  const total = filas.length;
  const paginas = Math.max(1, Math.ceil(total / t));
  const p = Math.min(Math.max(1, Math.floor(pagina) || 1), paginas);
  const inicio = (p - 1) * t;
  const corte = filas.slice(inicio, inicio + t);
  return { filas: corte, pagina: p, paginas, total, desde: total === 0 ? 0 : inicio + 1, hasta: inicio + corte.length };
}

/** Arma un href conservando TODOS los demás parámetros (tenant, vista, rol, filtros). `null` quita el parámetro. */
export function hrefConParams(base: string, params: ParamsURL, cambios: Readonly<Record<string, string | null>>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k in cambios || v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v as string]) q.append(k, x);
  }
  for (const [k, v] of Object.entries(cambios)) if (v !== null) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** Lo que pasa al pulsar la cabecera de `col`: otra columna → ascendente; la misma → descendente; ya descendente → quitar el orden. */
export function siguienteOrden(estado: Pick<EstadoTabla, 'orden' | 'dir'>, col: string, inicial?: { orden: string; dir: Dir }): { orden: string; dir: Dir } | null {
  if (estado.orden !== col) return { orden: col, dir: 'asc' };
  if (estado.dir === 'asc') return { orden: col, dir: 'desc' };
  return inicial && inicial.orden === col ? { orden: col, dir: 'asc' } : null;
}

export function ariaSort(estado: Pick<EstadoTabla, 'orden' | 'dir'>, col: string): 'ascending' | 'descending' | 'none' {
  return estado.orden === col ? (estado.dir === 'asc' ? 'ascending' : 'descending') : 'none';
}

/** Páginas a mostrar: la primera, la última y una ventana alrededor de la actual; `null` = hueco («…»). */
export function ventanaPaginas(actual: number, total: number, ancho = 1): Array<number | null> {
  const set = new Set<number>([1, total]);
  for (let i = actual - ancho; i <= actual + ancho; i++) if (i >= 1 && i <= total) set.add(i);
  const orden = [...set].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  orden.forEach((p, i) => { if (i > 0 && p - orden[i - 1] > 1) out.push(null); out.push(p); });
  return out;
}

/** A dónde va el foco con una tecla dentro de la tabla (filas = renglones con algo enfocable). `indice` = ordinal del control
 *  dentro de su fila. Devuelve null si la tecla no se atiende o no hay a dónde ir. */
export function destinoFoco(tecla: string, ctrl: boolean, fila: number, indice: number, nFilas: number): { fila: number; indice: number } | null {
  if (nFilas <= 0) return null;
  if (tecla === 'ArrowDown') return fila + 1 < nFilas ? { fila: fila + 1, indice } : null;
  if (tecla === 'ArrowUp') return fila - 1 >= 0 ? { fila: fila - 1, indice } : null;
  if (tecla === 'Home' && ctrl) return { fila: 0, indice };
  if (tecla === 'End' && ctrl) return { fila: nFilas - 1, indice };
  return null;
}
