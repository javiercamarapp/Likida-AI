import { shell as shellEs } from './es/shell';

// ═══════════════════════════════════════════════════════════════════════════
// NOMBRES DE NAVEGACIÓN — el catálogo de rutas (`dashboard/rutas.ts`, `admin/rutas.ts`) sigue siendo la fuente de los nombres EN
// ESPAÑOL (sirven de llave estable, de alias de búsqueda y de texto sin proveedor). Su traducción vive en el diccionario `shell`
// bajo `nav.n.<slug>`: el slug es el nombre sin acentos, en minúsculas y con guiones. Un nombre sin clave se muestra tal cual (en
// español, nunca vacío ni la clave cruda); `nav_traducida.test.ts` exige que TODO nombre del menú, de las pestañas y de las
// barras tenga clave en es y en en, así que una entrada nueva sin traducción rompe la prueba, no la pantalla.
// ═══════════════════════════════════════════════════════════════════════════

/** `Trust & Safety` → `trust-safety`; `Dinero y fiscal` → `dinero-y-fiscal`. */
export function slugNav(nombre: string): string {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function claveNav(nombre: string): string {
  return `nav.n.${slugNav(nombre)}`;
}

/** Lo mínimo que se necesita de un traductor del namespace `shell` (cualquier `Traductor` lo cumple). */
export interface TraductorNav { t: (clave: never, variables?: Record<string, string | number>) => string }

/** El nombre de una entrada del menú en el idioma activo; sin clave, el propio nombre en español. */
export function etiquetaNav(tr: TraductorNav, nombre: string): string {
  const clave = claveNav(nombre);
  return clave in shellEs ? (tr.t as (c: string) => string)(clave) : nombre;
}

/** El rótulo de un rol (`rol.<rol>`) en el idioma activo; un rol sin clave conserva el rótulo que ya traía. */
export function etiquetaRol(tr: TraductorNav, rol: string, rotulo: string): string {
  const clave = `rol.${rol}`;
  return clave in shellEs ? (tr.t as (c: string) => string)(clave) : rotulo;
}
