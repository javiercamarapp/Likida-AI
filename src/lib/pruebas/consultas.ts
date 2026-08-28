// ═══════════════════════════════════════════════════════════════════════════
// LEER LOS `.limit()` DEL REPO SIN EJECUTARLOS.
//
// Un `.limit(N)` sin `.order()` no devuelve "las N primeras": devuelve N filas
// CUALESQUIERA. Postgres no promete orden sin `ORDER BY`, y el orden real
// depende del plan, del cache y de qué se escribió último. Y un `.order()` por
// una columna con empates (una fecha, un estado) tampoco basta: dentro del
// empate el orden vuelve a ser arbitrario, y si el empate cruza el corte de
// `N`, dos corridas seguidas traen conjuntos distintos.
//
// Esto vive fuera de la prueba porque la lectura del fuente y el CRITERIO de
// qué cuenta como cumplir son dos cosas distintas, y el criterio se va a
// afinar. Mismo criterio de ubicación que `codigo.ts`: bajo `src/` para que el
// alias `@/` lo resuelva, y nada del producto lo importa, así que no entra en
// ningún bundle.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { sinComentarios, fuentesDeProduccion } from './codigo';

/** Un `.limit(` encontrado en el fuente, con lo que se sabe de su cadena. */
export interface SitioLimite {
  /** Ruta relativa a la raíz del repo. */
  archivo: string;
  /** Línea 1-indexada del `.limit(`. */
  linea: number;
  /** Las columnas de cada `.order('col')` de la cadena, en orden de aparición. */
  columnasOrden: string[];
  /** `true` si la cadena trae algún `.order(...)`, aunque su columna no sea literal. */
  tieneOrder: boolean;
  /** La razón declarada a mano, si el sitio trae la marca de exención. */
  razonDeclarada: string | null;
  /** El final de la cadena, para poder citarlo en el mensaje de error. */
  cadena: string;
}

/**
 * La marca con la que se declara, a mano, que en ESE sitio el orden no cambia
 * el resultado. Se exige una razón de verdad (≥ 25 caracteres): "no importa"
 * no es una razón, y una marca que se pone sin pensar convierte la red en un
 * trámite.
 */
export const MARCA_EXENCION = /\/\/\s*orden-no-importa:\s*(.{25,})$/;

/** Cuántas líneas hacia arriba se busca la marca de exención. */
const LINEAS_DE_GRACIA = 6;

/** Una columna que ROMPE TODOS LOS EMPATES: la llave primaria o una ajena. */
export function esDesempate(columna: string): boolean {
  return /(^|[._])id$/.test(columna.trim());
}

/** El sitio cumple: o tiene desempate por `id`, o trae su razón escrita. */
export function cumple(s: SitioLimite): boolean {
  return s.razonDeclarada !== null || s.columnasOrden.some(esDesempate);
}

/**
 * La expresión encadenada que precede a un `.limit(` — hacia atrás desde el
 * punto, saltando paréntesis/llaves/corchetes balanceados.
 *
 * No es un parser de TypeScript y no pretende serlo (misma nota que
 * `sinComentarios`). Salta bloques balanceados, así que `{ ascending: false }`
 * de un `.order()` no corta la cadena — que es exactamente el error que tuvo la
 * primera versión de esto: cortaba en la llave de cierre y dejaba INVISIBLE el
 * `.order()` que estaba a la izquierda, contando como infractores 130 sitios
 * que sí ordenaban. Se detiene ante `await`/`return`/`const`/`let` y ante
 * cualquier carácter que no pueda continuar una cadena.
 */
export function cadenaAntes(fuente: string, i: number): string {
  let j = i;
  const partes: string[] = [];
  while (j > 0) {
    while (j > 0 && /\s/.test(fuente[j - 1])) j--;
    if (j === 0) break;
    const c = fuente[j - 1];
    if (c === ')' || c === ']' || c === '}') {
      const abre = { ')': '(', ']': '[', '}': '{' }[c];
      let d = 0;
      let k = j - 1;
      for (; k >= 0; k--) {
        if (fuente[k] === c) d++;
        else if (fuente[k] === abre) { d--; if (d === 0) break; }
      }
      if (k < 0) break;
      partes.push(fuente.slice(k, j));
      j = k;
      continue;
    }
    if (/[\w$]/.test(c)) {
      let k = j - 1;
      while (k >= 0 && /[\w$]/.test(fuente[k])) k--;
      const palabra = fuente.slice(k + 1, j);
      if (['await', 'return', 'const', 'let', 'var', 'typeof'].includes(palabra)) break;
      partes.push(palabra);
      j = k + 1;
      continue;
    }
    if (c === '.') { partes.push('.'); j--; continue; }
    break;
  }
  return partes.reverse().join('');
}

/** Todos los `.limit(` de un archivo. `crudo` es el fuente CON comentarios. */
export function sitiosDe(archivo: string, crudo: string): SitioLimite[] {
  // Los comentarios se quitan para BUSCAR (media docena de comentarios del repo
  // citan `.limit(5000)` para explicar por qué ya no está)…
  const limpio = sinComentarios(crudo);
  // …pero la marca de exención se busca en el fuente CRUDO, porque es un
  // comentario. Las dos vistas tienen el mismo número de líneas: `sinComentarios`
  // reemplaza y filtra por línea, nunca reordena.
  const lineasCrudas = crudo.split('\n');
  const salida: SitioLimite[] = [];
  const re = /\.limit\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpio)) !== null) {
    const cadena = cadenaAntes(limpio, m.index);
    const linea = limpio.slice(0, m.index).split('\n').length;
    const columnasOrden = [...cadena.matchAll(/\.order\s*\(\s*['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
    let razonDeclarada: string | null = null;
    for (let k = linea - 1; k >= Math.max(0, linea - 1 - LINEAS_DE_GRACIA); k--) {
      const hit = MARCA_EXENCION.exec(lineasCrudas[k] ?? '');
      if (hit) { razonDeclarada = hit[1].trim(); break; }
    }
    salida.push({
      archivo,
      linea,
      columnasOrden,
      tieneOrder: /\.order\s*\(/.test(cadena),
      razonDeclarada,
      cadena: cadena.replace(/\s+/g, ' ').slice(-160),
    });
  }
  return salida;
}

/** Todos los `.limit(` de la producción bajo `src/`. */
export function sitiosDeLimite(): SitioLimite[] {
  return fuentesDeProduccion('src').flatMap((f) => sitiosDe(f, readFileSync(f, 'utf8')));
}

/** Cuántos sitios NO cumplen, por archivo. Los archivos limpios no aparecen. */
export function deudaPorArchivo(sitios: SitioLimite[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sitios) if (!cumple(s)) out[s.archivo] = (out[s.archivo] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
