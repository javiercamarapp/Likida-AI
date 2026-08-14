// ═══════════════════════════════════════════════════════════════════════════
// EN LOTES (auditoría 3, REND-C1): el cruce del consolidado hacía un UPDATE
// serial por línea — 1,000 líneas ≈ 300s contra maxDuration=120s, y morir a
// la mitad corrompía la conciliación. Correr TODO en paralelo tampoco: mil
// conexiones simultáneas contra PostgREST es su propia forma de morir. Esto
// es el punto medio: lotes de N con Promise.all, en orden de lote.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Corre `fn` sobre cada elemento, `tamano` a la vez. Devuelve los resultados
 * EN EL ORDEN de entrada. Un elemento que lanza NO tumba el lote: su
 * resultado es `{ error }` y quien llama decide — el criterio best-effort
 * por línea que el consolidado ya tenía, conservado.
 */
export async function enLotes<T, R>(
  items: readonly T[],
  tamano: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ ok: R } | { error: unknown }>> {
  if (tamano < 1) throw new Error('enLotes: el tamaño del lote debe ser ≥ 1');
  const salida: Array<{ ok: R } | { error: unknown }> = [];
  for (let i = 0; i < items.length; i += tamano) {
    const lote = items.slice(i, i + tamano);
    const resultados = await Promise.all(
      lote.map((item) => fn(item).then(
        (ok) => ({ ok }) as { ok: R },
        (error) => ({ error }) as { error: unknown },
      )),
    );
    salida.push(...resultados);
  }
  return salida;
}
