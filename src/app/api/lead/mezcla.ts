// ═══════════════════════════════════════════════════════════════════════════
// MEZCLAR UN LEAD NUEVO CON UN PROSPECTO QUE YA EXISTE
//
// Vive fuera del `route.ts` porque Next.js solo admite sus propios exports en
// un route handler: cualquier otro rompe el TYPECHECK del build (no el lint).
// Aquí, además, queda importable por las pruebas y por quien arme la UI.
// ═══════════════════════════════════════════════════════════════════════════

/** Vacío = no hay dato: nulo, ausente o cadena en blanco. */
function sinDato(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Cuánto puede crecer `notas` por esta vía. Un endpoint público no puede
 *  hacer crecer una fila sin techo: se conserva lo más NUEVO. */
const TOPE_NOTAS = 4_000;

/**
 * El parche que SÍ se puede aplicar, y la lista de lo que llegó distinto.
 *
 * Exportada para que la prueba mida esta decisión sola, sin base de por medio.
 */
export function mezclaQueSoloRellena(
  previo: Record<string, unknown>,
  campos: Record<string, unknown>,
): { parche: Record<string, unknown>; pisados: string[] } {
  const parche: Record<string, unknown> = {};
  const pisados: string[] = [];
  for (const [k, v] of Object.entries(campos)) {
    // `updated_at` es del sistema, no del visitante.
    if (k === 'updated_at') { parche[k] = v; continue; }
    // El formulario no lo trae: nunca se manda `null` (borraría el teléfono
    // que el censo del DENUE sí traía).
    if (v === null || v === undefined) continue;
    // La columna no existe en esta base todavía (0137): que decida `escribir`.
    if (!(k in previo)) { parche[k] = v; continue; }
    if (sinDato(previo[k])) { parche[k] = v; continue; }      // hueco → se rellena
    if (String(previo[k]) === String(v)) continue;            // igual → nada que hacer
    pisados.push(`${k}=${String(v)}`);                        // distinto → a notas
  }
  return { parche, pisados };
}

/**
 * La nota con lo que el formulario dijo y no se aplicó. Va ARRIBA (es lo
 * último que pasó) y la nota del vendedor se conserva completa debajo, que es
 * la razón por la que este archivo nunca escribía `notas` en un update.
 */
export function notaConLoNoAplicado(notasPrevias: unknown, pisados: string[]): string {
  const hoy = new Date().toISOString().slice(0, 10);
  const linea = `[${hoy}] /getdemo mandó datos DISTINTOS a los que ya había (sin verificar, no se aplicaron): ${pisados.join('; ')}`;
  const antes = typeof notasPrevias === 'string' && notasPrevias.trim() ? `\n${notasPrevias}` : '';
  return `${linea}${antes}`.slice(0, TOPE_NOTAS);
}
