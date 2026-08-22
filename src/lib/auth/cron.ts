// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA DE LOS CRONS — comparar el secreto sin decir cuánto se acertó.
//
// AUDITORÍA PROD (22-ago-2026) · SEG-5. Las cinco rutas de cron comparaban con
// `!==`, que en V8 sale en el primer byte distinto: el tiempo de respuesta
// filtra cuántos caracteres del prefijo son correctos, y ese canal permite
// reconstruir el secreto byte por byte en vez de adivinarlo entero.
//
// Es un hallazgo BAJO y su clasificación es honesta: sobre HTTP, con el ruido
// de red y el arranque en frío de una lambda, medir esa diferencia es
// difícil. Pero el arreglo no cuesta nada y quita el argumento — y `CRON_SECRET`
// es la única cosa que separa a cualquiera que conozca la URL de disparar la
// escalación, la facturación o la purga.
//
// DOS DETALLES QUE HACEN QUE ESTO SIRVA DE VERDAD:
//
//   1. `timingSafeEqual` LANZA si los buffers miden distinto —y esa excepción
//      volvería a filtrar el largo, además de tumbar la ruta—. Por eso los dos
//      lados se pasan por SHA-256 antes: dos digests siempre miden 32 bytes,
//      así que la comparación es constante para cualquier entrada y el largo
//      del secreto deja de ser observable.
//   2. Se compara el header COMPLETO (`Bearer <secreto>`), no el secreto
//      recortado: recortar exige mirar el prefijo, y esa mirada vuelve a ser
//      una comparación con salida temprana.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash, timingSafeEqual } from 'node:crypto';

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/**
 * ¿La cabecera `Authorization` trae el `CRON_SECRET`?
 *
 * `false` ante cualquier duda: sin cabecera, con otro esquema, o con un
 * secreto vacío. Nunca lanza — un error aquí sería un 500 en una ruta cuya
 * respuesta correcta a un desconocido es 401 sin cuerpo.
 */
export function autorizaCron(cabecera: string | null, secreto: string): boolean {
  if (!secreto || !cabecera) return false;
  try {
    return timingSafeEqual(digest(cabecera), digest(`Bearer ${secreto}`));
  } catch {
    return false;
  }
}
