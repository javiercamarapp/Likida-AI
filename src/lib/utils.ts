import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function mxn(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export function usd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n < 1 ? 3 : 2 });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 · CRÍTICO de arquitectura — LA FECHA DEL PDF NO SE ARREGLÓ
// CUANDO SE ARREGLÓ LA DEL PANEL.
//
// La ronda 5 encontró que `.slice(0,10)` sobre un `timestamptz` se queda con la
// fecha UTC, y CST es UTC−6: todo lo que se cierre después de las 18:00 hora
// local sale fechado al día siguiente. Las liquidaciones se cierran al terminar
// el viaje, de noche. En el corte mensual, una del 31 de julio aparecía en
// agosto.
//
// Ayer se arregló el PANEL (`dashboard/formato.ts`, con su prueba anclando el
// caso exacto) y NO el PDF —el documento que el propio código llama "el papel
// que se archiva"—, que siguió con `toLocaleDateString` sin `timeZone` y por
// tanto con la zona del servidor: UTC en Vercel. El comentario del archivo
// nuevo lo admitía por escrito y nombraba la casa correcta: aquí, junto a
// `mxn()`, para que el PDF pudiera usarlas también.
//
// Que el papel y la pantalla fechen distinto el mismo hecho es exactamente lo
// que este rubro mide: dos copias de una verdad que se separan.
// ═══════════════════════════════════════════════════════════════════════════

/** Zona del cliente: la flota, el contralor y el SAT están todos aquí. */
export const TZ_MX = 'America/Mexico_City';

/**
 * Litros con separador de millares y hasta dos decimales, sin rellenar ceros.
 *
 * El motor redondea los litros a dos decimales (`engine.ts`), así que el tope de
 * dos no puede recortar información: solo evita que un `1234.5600000001` de coma
 * flotante salga con tres cifras donde el papel enseña dos.
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
 */
export function fechaMx(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ_MX,
  });
}
