import { IDIOMA_POR_OMISION, LOCALE_INTL, type Idioma } from './idioma';

// ═══════════════════════════════════════════════════════════════════════════
// TRADUCIR — interpolación `{variable}` y plurales `.uno` / `.otros`. Pura.
//
// Reglas del plan (§7, riesgos 1 y 2): NUNCA se concatena texto traducido; una frase es una clave completa con sus
// `{variables}`; el plural son dos claves (`x.uno`, `x.otros`) elegidas con `Intl.PluralRules`, jamás `+ 's'`.
// Una clave que falta cae al diccionario base (es) y, si tampoco está, devuelve la propia clave (visible, no un hueco).
// ═══════════════════════════════════════════════════════════════════════════

export type Variables = Readonly<Record<string, string | number>>;
export type Diccionario = Readonly<Record<string, string>>;

const VARIABLE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Los nombres de `{variable}` de un texto, sin repetir y en orden. */
export function variablesDe(texto: string): string[] {
  return [...new Set([...texto.matchAll(VARIABLE)].map((m) => m[1]))];
}

/** Sustituye `{variable}`; una variable que no se pasó se deja visible (`{n}`), no se borra en silencio. */
export function interpolar(texto: string, variables?: Variables): string {
  if (!variables) return texto;
  return texto.replace(VARIABLE, (completo, nombre: string) => (nombre in variables ? String(variables[nombre]) : completo));
}

/** Claves de un diccionario que tienen versión singular: `x.uno` → `x`. */
export type ClavePlural<D> = { [K in keyof D & string]: K extends `${infer B}.uno` ? B : never }[keyof D & string];

export interface Traductor<D extends Diccionario> {
  idioma: Idioma;
  t: (clave: keyof D & string, variables?: Variables) => string;
  /** Plural: elige `clave.uno` / `clave.otros` según `n` y le pasa `n` como `{n}`. */
  tp: (clave: ClavePlural<D> & string, n: number, variables?: Variables) => string;
}

/**
 * Arma el traductor de UN namespace. `base` es el diccionario es del mismo namespace (respaldo de claves faltantes).
 */
export function crearTraductor<D extends Diccionario>(idioma: Idioma, diccionario: Diccionario, base: D): Traductor<D> {
  const reglas = new Intl.PluralRules(LOCALE_INTL[idioma] ?? LOCALE_INTL[IDIOMA_POR_OMISION]);
  const buscar = (clave: string): string => diccionario[clave] ?? base[clave] ?? clave;
  return {
    idioma,
    t: (clave, variables) => interpolar(buscar(clave), variables),
    tp: (clave, n, variables) => interpolar(buscar(`${clave}.${reglas.select(n) === 'one' ? 'uno' : 'otros'}`), { n, ...variables }),
  };
}
