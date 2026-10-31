// A39-A4-02: el programa real de despacho pesa ~27 MB porque cada línea trae miles de `;` de relleno (hasta 16,383 columnas casi
// vacías). La plataforma (Vercel Functions) rechaza cuerpos de más de 4.5 MB, así que NO llega al servidor. El lector ya descarta las
// celdas vacías del final de cada línea (`lector.ts`: `while (celdas.length > 0 && celdas[celdas.length - 1].trim() === '') celdas.pop()`),
// de modo que quitar esos `;` finales en el navegador no cambia lo que se entiende, y el archivo cabe.

/** Tope real de una subida por formulario a la plataforma, con margen para el resto del cuerpo (la plataforma corta en 4.5 MB). */
export const TOPE_SUBIDA_BYTES = 4 * 1024 * 1024;

/**
 * Quita los `;` (y los espacios entre ellos) que sobran al final de cada línea, FUERA de comillas. Una línea cuyos únicos caracteres
 * son `;` queda vacía. No toca nada dentro de una celda entre comillas (un salto de línea ahí no termina la línea).
 */
export function recortarRellenoCsv(texto: string): string {
  const salida: string[] = [];
  let inicio = 0;
  let entreComillas = false;
  let finUtil = 0; // hasta dónde llega lo que NO es relleno en la línea en curso (índice exclusivo)
  const n = texto.length;
  for (let i = 0; i < n; i++) {
    const c = texto.charCodeAt(i);
    if (c === 34) { entreComillas = !entreComillas; finUtil = i + 1; continue; }
    if (entreComillas) { finUtil = i + 1; continue; }
    if (c === 10 || c === 13) {
      salida.push(texto.slice(inicio, finUtil), texto[i]);
      inicio = i + 1; finUtil = i + 1;
      continue;
    }
    if (c === 59 || c === 32 || c === 9) continue; // `;`, espacio o tabulador: candidato a relleno si nada útil sigue
    finUtil = i + 1;
  }
  salida.push(texto.slice(inicio, entreComillas ? n : Math.max(finUtil, inicio)));
  return salida.join('');
}
