// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE IMPRIME UNA CIFRA. UNA SOLA VEZ, PARA TODO EL PRODUCTO.
//
// POR QUÉ ESTE ARCHIVO EXISTE Y NO ESTÁ EN `utils.ts`, QUE ERA LO OBVIO:
// `utils.ts` importa `clsx` y `tailwind-merge` para `cn()`, que son librerías de
// CSS del panel. El motor del cuadre (`engine.ts`) es puro y sin I/O, y el PDF
// viaja en el bundle de la función del webhook: ninguno de los dos tiene por qué
// arrastrar el sistema de clases de Tailwind para escribir "$1,234.56".
//
// Hoy el tree-shaking de Next lo salva —se midió sobre el `.nft.json` del
// webhook y `clsx` no entra—, pero eso depende de que nadie añada un
// side-effect a `utils.ts`. Un archivo sin una sola importación no depende de la
// suerte. `utils.ts` reexporta de aquí para no romper al panel.
//
// ── EL HALLAZGO QUE CIERRA, Y VA POR SU TERCERA RONDA ──────────────────────
//
// `mxn()` estaba escrita A MANO en el producto, y el número CRECÍA entre rondas:
//
//     ronda 6 →  3 sitios
//     ronda 7 →  8 sitios
//     hoy     → 11 sitios  (7 de moneda + los de litros)
//
// Siete copias idénticas de la misma línea, cada una en un archivo que imprime
// dinero que el contralor lee: el PDF, el resumen de WhatsApp, el panel, el
// aviso del tope del 15%, los acreditables y el motor. Que sean idénticas HOY no
// es una defensa: el hallazgo gemelo de `litros()` ya se divergió una vez, y ahí
// el panel decía "1,235 L" donde el PDF decía "1,234.56 L".
//
// Una cifra fiscal que se lee distinta en dos pantallas se lee como dos
// cálculos distintos.
// ═══════════════════════════════════════════════════════════════════════════

/** Zona del cliente: la flota, el contralor y el SAT están todos aquí. */
export const TZ_MX = 'America/Mexico_City';

/** Pesos mexicanos como los espera un contador: `$1,234.56`. */
export function mxn(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/** Dólares, para el costo interno de los modelos — nunca para el cliente. */
export function usd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * Litros con separador de millares y hasta dos decimales, sin rellenar ceros.
 *
 * El motor redondea a dos decimales, así que el tope no puede recortar
 * información: solo evita que un `1234.5600000001` de coma flotante salga con
 * tres cifras donde el papel enseña dos.
 */
export function litros(n: number): string {
  return `${n.toLocaleString('es-MX', { maximumFractionDigits: 2 })} L`;
}

/**
 * Fecha en hora de México: `31 jul 2026`.
 *
 * Devuelve `—` ante una fecha ausente o ilegible en vez de `Invalid Date`: una
 * celda vacía es más honesta que una cadena de error en la columna que el
 * contralor usa para ordenar su corte.
 *
 * La zona es explícita porque `.slice(0,10)` sobre un `timestamptz` se queda con
 * la fecha UTC, y CST es UTC−6: todo lo cerrado después de las 18:00 hora local
 * salía fechado al día siguiente. Las liquidaciones se cierran de noche, al
 * terminar el viaje, así que en el corte mensual una del 31 de julio aparecía en
 * agosto.
 */
export function fechaMx(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ_MX,
  });
}
