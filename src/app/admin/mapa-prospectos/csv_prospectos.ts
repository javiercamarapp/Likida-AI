// Piezas puras del export CSV del Cerebro (testeables sin React).

/** Celda CSV entre comillas. A37-S06-03: un TEXTO que empieza con = + - @ tab
 *  o CR se ejecutaría como fórmula al abrir el CSV en Excel; se le antepone
 *  una comilla simple. Los NÚMEROS (lat/lng negativos) no son texto del
 *  prospecto y no se tocan. */
export function celdaCsv(v: unknown): string {
  let s = String(v ?? '');
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** A37-S06-06: ids cuyos textos (notas) NO están en el cache tras pedirlos. */
export function idsSinTextos(ids: readonly string[], textos: ReadonlyMap<string, unknown>): string[] {
  return ids.filter((id) => !textos.has(id));
}
