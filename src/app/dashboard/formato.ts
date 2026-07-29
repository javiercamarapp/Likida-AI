// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE IMPRIME UNA CIFRA EN EL PANEL.
//
// Las dos pantallas del panel formateaban por su cuenta y no coincidían ni
// entre ellas ni con el PDF que el contralor le manda a su contador. Medido
// sobre `1234.56` litros (auditoría 5, frontend, MEDIO 1):
//
//   PDF     pdf.ts:294   → 1,234.56 L   (toLocaleString('es-MX'))
//   Lista   page.tsx     → 1,235 L      (maximumFractionDigits: 0)
//   Detalle [id]/page    → 1234.56 L    (interpolación cruda)
//
// Tres representaciones de una cifra fiscal se leen como tres cálculos. Aquí
// hay UNA, y está escogida para coincidir con la del PDF, que es el papel que
// se archiva.
//
// La fecha tenía el mismo problema con otra causa: `.slice(0, 10)` sobre un
// `timestamptz` se queda con la fecha UTC, y CST es UTC−6, así que TODO lo que
// se cierre después de las 18:00 hora local sale fechado al día siguiente
// (auditoría 5, frontend, MEDIO 3). Las liquidaciones se cierran al terminar
// el viaje, de noche. En el corte mensual, una liquidación del 31 de julio
// aparecía listada en agosto.
//
// La casa natural de estas dos funciones es `src/lib/utils.ts`, junto a
// `mxn()`, para que el PDF pudiera usarlas también. Ese archivo quedó fuera del
// alcance de esta ronda; mientras tanto viven aquí y `pdf.ts` sigue con su
// propia copia (misma salida en litros, distinta zona horaria en fechas).
// ═══════════════════════════════════════════════════════════════════════════

/** Zona del cliente: la flota, el contralor y el SAT están todos aquí. */
export const TZ_MX = 'America/Mexico_City';

/**
 * Litros con la MISMA forma que el PDF: separador de millares y hasta dos
 * decimales, sin rellenar con ceros.
 *
 * El motor redondea los litros a dos decimales (`engine.ts`), así que el tope
 * de dos no puede recortar información: solo evita que un `1234.5600000001` de
 * coma flotante salga con tres cifras donde el papel enseña dos.
 */
export function litros(n: number): string {
  return `${n.toLocaleString('es-MX', { maximumFractionDigits: 2 })} L`;
}

/**
 * Fecha para leer en pantalla, en hora de México: `31 jul 2026`.
 *
 * Devuelve `—` ante una fecha ausente o ilegible en vez de `Invalid Date`: el
 * panel es de solo lectura y una celda vacía es más honesta que una cadena de
 * error en la columna que el contralor usa para ordenar su corte.
 */
export function fechaMx(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ_MX,
  });
}
