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
 * SQLSTATE propio de la migración 0036: el gasto llegó DESPUÉS de que la
 * liquidación del viaje ya se emitió.
 *
 * Tiene código propio y no un 23505 a propósito: lo que hay que hacer es
 * distinto. Un duplicado se ignora en silencio porque el gasto YA está
 * registrado; éste no está en ningún lado y el operador tiene que enterarse —su
 * foto llegó tarde y ese dinero no entró al papel que ya se emitió.
 */
export const GASTO_TARDE = 'CU001';

/** ¿El gasto llegó después de que el viaje ya se liquidó? (mig. 0036) */
export function llegoTarde(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === GASTO_TARDE;
}

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
