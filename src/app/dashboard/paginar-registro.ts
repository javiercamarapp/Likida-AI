// ═══════════════════════════════════════════════════════════════════════════
// LOS REGISTROS DEL PANEL, PAGINADOS Y BUSCABLES (FE-12, 22-ago-2026)
//
// Unidades, Operadores y Clientes pintaban el catálogo COMPLETO y, encima, un
// formulario de edición POR FILA. Con 5,000 unidades y 7,500 operadores eso
// son megabytes de HTML —cientos de <input> por pantalla— para editar UNO, y
// una lista por la que nadie puede navegar: no había búsqueda ni páginas.
//
// Aquí vive la parte de PANTALLA de ese arreglo: qué filas se pintan (`?q=` y
// `?p=`) y cuál trae su formulario abierto (`?editar=<id>`). Lo demás —que la
// consulta traiga menos filas de la base— es del lado de la lectura y no de
// este archivo.
//
// Todo se SANEA: una `p` que no es número, una `q` de 10 KB o un `editar` con
// un id inventado se leen como "primera página, sin filtro, nada abierto".
// Un link viejo o manipulado merece exactamente eso, no una excepción.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuántas filas por página. 25 es lo que se lee de un vistazo sin scroll
 *  infinito y deja el HTML de la página en el orden de los KB. */
export const POR_PAGINA = 25;

/** Tope del texto de búsqueda — el mismo criterio que `sanearBusqueda` del
 *  registro de viajes: nadie busca un folio de 80 caracteres. */
export const MAX_BUSQUEDA = 80;

export interface ParamsRegistro {
  q?: string;
  p?: string;
  editar?: string;
}

export interface PaginaRegistroUI<T> {
  /** Las filas de ESTA página, ya filtradas. */
  filas: T[];
  /** Página actual, 1-indexada. */
  pagina: number;
  /** Cuántas páginas hay con el filtro puesto. Mínimo 1. */
  paginas: number;
  /** Cuántas filas hay EN TOTAL (sin filtro). */
  total: number;
  /** Cuántas pasan el filtro. Igual a `total` cuando no hay búsqueda. */
  filtrados: number;
  /** El texto de búsqueda saneado — el que la caja debe volver a enseñar. */
  q: string;
  /** El id cuya forma de edición está abierta, si sigue en esta página. */
  editando: string | null;
}

/** Sin acentos y en minúsculas: buscar "hernandez" tiene que encontrar
 *  "Hernández". Es la misma normalización que usaba la barra del Resumen. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function sanearQ(q: string | undefined): string {
  return (q ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_BUSQUEDA);
}

/**
 * Filtra por `q` (contra el texto que `buscable` arma para cada fila), corta
 * la página `p` y resuelve qué fila trae su formulario abierto.
 *
 * `editando` sale `null` cuando el id no está en la página visible: un
 * formulario abierto que no se ve sería un `?editar=` que no hace nada, y
 * peor, el HTML de una fila que el usuario no está mirando.
 */
export function paginarRegistro<T>(
  todos: T[],
  buscable: (t: T) => string,
  sp: ParamsRegistro,
  idDe?: (t: T) => string,
  porPagina: number = POR_PAGINA,
): PaginaRegistroUI<T> {
  const q = sanearQ(sp.q);
  const nq = normalizar(q);
  const filtradas = nq === '' ? todos : todos.filter((t) => normalizar(buscable(t)).includes(nq));

  const paginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const pCruda = Number(sp.p);
  const pagina = Number.isInteger(pCruda) && pCruda >= 1 ? Math.min(pCruda, paginas) : 1;
  const filas = filtradas.slice((pagina - 1) * porPagina, pagina * porPagina);

  const editar = (sp.editar ?? '').trim().slice(0, 64);
  const editando = editar && idDe && filas.some((t) => idDe(t) === editar) ? editar : null;

  return { filas, pagina, paginas, total: todos.length, filtrados: filtradas.length, q, editando };
}

/**
 * `?tenant=…&q=…&p=…` para un link del registro, conservando el sufijo del
 * superadmin. `null` en un valor lo QUITA del query — así "cerrar la forma"
 * es el mismo helper que "abrirla".
 */
export function urlRegistro(
  ruta: string,
  sufijo: string,
  cambios: Record<string, string | number | null>,
): string {
  // El sufijo trae `?tenant=`/`?vista=`/`?rol=` ya armado por `sufijoTenant`.
  const qs = new URLSearchParams(sufijo.startsWith('?') ? sufijo.slice(1) : sufijo);
  for (const [k, v] of Object.entries(cambios)) {
    if (v === null || v === '') qs.delete(k);
    else qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${ruta}?${s}` : ruta;
}
