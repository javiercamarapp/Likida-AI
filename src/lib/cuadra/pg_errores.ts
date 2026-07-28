// ═══════════════════════════════════════════════════════════════════════════
// Leer un error de Postgres sin adivinar.
//
// El 23505 (unique_violation) NO es una categoría: significa "chocó CON ALGO", y
// qué hacer depende de con qué. Un choque contra el índice de hash de imagen es
// una foto repetida en la ráfaga —benigno, se ignora—. Uno contra el de CFDI es
// el mismo comprobante llegando dos veces —también benigno—. Cualquier otro es
// un bug, y tragárselo esconde el bug.
//
// Por eso los índices llevan nombre explícito y aquí se compara contra él.
// ═══════════════════════════════════════════════════════════════════════════

/** Código de `unique_violation` en Postgres. */
export const UNIQUE_VIOLATION = '23505';

/**
 * ¿Este error es una violación del índice único `indice`?
 *
 * Supabase no expone el nombre de la constraint en un campo propio: viene dentro
 * de `message` o de `details`. Se buscan los dos, y se exige que el código sea
 * 23505 — sin eso, un mensaje que casualmente mencione el índice daría un falso
 * positivo y se tragaría un error real.
 */
export function violaIndice(e: unknown, indice: string): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; message?: string; details?: string };
  if (err.code !== UNIQUE_VIOLATION) return false;
  return `${err.message ?? ''} ${err.details ?? ''}`.includes(indice);
}
