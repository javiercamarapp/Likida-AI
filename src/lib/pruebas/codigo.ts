// ═══════════════════════════════════════════════════════════════════════════
// MIRAR EL CÓDIGO SIN MIRAR LOS COMENTARIOS.
//
// Varias pruebas estructurales de este repo prohíben que algo REAPAREZCA:
// una segunda copia de `mxn()`, una clave del SAT escrita a mano, un lector de
// una tabla muerta. Todas hacen lo mismo — buscar un texto en `src/` — y todas
// se rompieron igual: con su propio comentario.
//
// El comentario que explica un bug CITA el bug. `dashboard/formato.ts` cita
// `toLocaleString('es-MX')` para contar por qué existe; `repo.ts` cita
// `politica_gasto` para contar por qué se borró su lector. Una prueba que busca
// esas cadenas en el archivo entero obliga a borrar justamente la explicación
// que evita repetir el error, a cambio de nada.
//
// Se extrajo aquí después de escribirlo dos veces en el mismo día, que es la
// tercera vez que este repo aprende la misma lección sobre copiar una función.
//
// Vive bajo `src/` y no en una carpeta de pruebas porque el alias `@/` apunta
// ahí; nada del producto lo importa, así que no entra en ningún bundle.
// ═══════════════════════════════════════════════════════════════════════════

import { readdirSync } from 'node:fs';

/**
 * El fuente con los comentarios fuera: bloques `/* … *\/` y líneas `//`.
 *
 * No es un parser y no pretende serlo. Un `//` dentro de una cadena —una URL,
 * por ejemplo— se lleva por delante el resto de esa línea. Para lo que sirve
 * —preguntar "¿este símbolo aparece en el CÓDIGO?"— eso solo puede producir un
 * falso NEGATIVO en la línea de una URL, y ninguna de las cosas que se vigilan
 * aquí vive dentro de una.
 */
export function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

/**
 * Todos los `.ts`/`.tsx` de producción bajo un directorio: sin pruebas, sin
 * `node_modules`. Las pruebas se excluyen porque su trabajo ES nombrar lo que
 * vigilan.
 */
export function fuentesDeProduccion(dir: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = `${dir}/${e.name}`;
    if (e.isDirectory()) salida.push(...fuentesDeProduccion(ruta));
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.') && !e.name.endsWith('.d.ts')) salida.push(ruta);
  }
  return salida;
}
