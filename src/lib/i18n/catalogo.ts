import type { Idioma } from './idioma';
import type { shell as shellEs } from './es/shell';

// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE NAMESPACES — el único lugar donde se registra un diccionario nuevo.
//
// Un namespace = una pareja de archivos `es/<ns>.ts` + `en/<ns>.ts` (por superficie, p. ej. `shell`, `inicio`, `viajes`) para
// no mandar al navegador más texto del que una pantalla usa. Se carga SOLO el idioma activo (`import()` por idioma), nunca
// los dos. `i18n_paridad.test.ts` recorre este catálogo y además exige que no haya archivos sueltos fuera de él.
//
// Para agregar uno: 1) crear es/<ns>.ts (`as const`) y en/<ns>.ts (`Record<keyof typeof es, string>`); 2) sumarlo en
// `Diccionarios`, en `NAMESPACES` y en los dos cargadores de abajo.
// ═══════════════════════════════════════════════════════════════════════════

/** El tipo de cada namespace, según el diccionario en español (la fuente de verdad). */
export interface Diccionarios {
  shell: typeof shellEs;
}
export type Namespace = keyof Diccionarios;

/** Forma común a es y en: las MISMAS claves, valores de texto. */
export type DiccionarioDe<N extends Namespace> = { readonly [K in keyof Diccionarios[N]]: string };
export type ClaveDe<N extends Namespace> = keyof Diccionarios[N] & string;

export const NAMESPACES = ['shell'] as const satisfies readonly Namespace[];

type Cargadores = { [I in Idioma]: { [N in Namespace]: () => Promise<DiccionarioDe<N>> } };

export const CARGADORES: Cargadores = {
  es: { shell: () => import('./es/shell').then((m) => m.shell) },
  en: { shell: () => import('./en/shell').then((m) => m.shell) },
};

/** Carga SOLO los namespaces pedidos, y SOLO en el idioma pedido. */
export async function cargarDiccionarios<N extends Namespace>(idioma: Idioma, namespaces: readonly N[]): Promise<Pick<{ [K in Namespace]: DiccionarioDe<K> }, N>> {
  const pares = await Promise.all(namespaces.map(async (ns) => [ns, await CARGADORES[idioma][ns]()] as const));
  return Object.fromEntries(pares) as Pick<{ [K in Namespace]: DiccionarioDe<K> }, N>;
}
