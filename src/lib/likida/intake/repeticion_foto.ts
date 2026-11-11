// ═══════════════════════════════════════════════════════════════════════════
// TOPE DE REPETICIONES DE FOTO POR OPERADOR Y DÍA (F19).
//
// Cuenta cuántas veces HOY se le pidió a este operador repetir una foto. Es la
// válvula de la prevalidación: pasado el tope, la foto sigue al OCR con marca.
//
// LÍMITE CONOCIDO, declarado: el contador vive en la memoria de la instancia
// (sin migración). En serverless otra instancia empieza en 0, así que el tope
// real puede ser mayor que el declarado, nunca menor ni infinito: el contador
// solo SUBE y lo reinicia el día. Persistirlo (tabla por operador y día) es una
// migración opcional que se propone aparte; hasta entonces el error posible es
// pedir una foto de más, jamás perder una.
// ═══════════════════════════════════════════════════════════════════════════

const UTC_OFFSET_MS = -6 * 3_600_000;
const TOPE_LLAVES = 5_000;

const contadores = new Map<string, number>();

/** Día calendario de la Ciudad de México (UTC-6) como clave `AAAA-MM-DD`. */
function diaMx(ahoraMs: number): string {
  return new Date(ahoraMs + UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function llave(operadorId: string, ahoraMs: number): string {
  return `${diaMx(ahoraMs)}|${operadorId}`;
}

/** Rechazos ya dados HOY a este operador. */
export function rechazosDeFotoHoy(operadorId: string, ahoraMs: number = Date.now()): number {
  return contadores.get(llave(operadorId, ahoraMs)) ?? 0;
}

/** Suma un rechazo y devuelve el total de hoy. */
export function registrarRechazoDeFoto(operadorId: string, ahoraMs: number = Date.now()): number {
  const hoy = diaMx(ahoraMs);
  if (contadores.size > TOPE_LLAVES) {
    for (const k of contadores.keys()) if (!k.startsWith(`${hoy}|`)) contadores.delete(k);
    if (contadores.size > TOPE_LLAVES) contadores.clear();
  }
  const k = `${hoy}|${operadorId}`;
  const n = (contadores.get(k) ?? 0) + 1;
  contadores.set(k, n);
  return n;
}

/** Solo para pruebas. */
export function reiniciarRechazosDeFoto(): void { contadores.clear(); }
