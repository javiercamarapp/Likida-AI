/**
 * Texto legible para un valor DESCONOCIDO (jsonb, fuentes de una pieza, parámetros).
 * Regla del producto: jamás «[object Object]» ni «null» crudos en pantalla.
 *  - null / undefined / '' → `null` (el llamador omite la fila o pinta «—»).
 *  - objeto → resumen corto de sus campos con valor («clave: valor · …»), recortado.
 *  - arreglo → sus elementos legibles separados por coma.
 * Módulo puro (sin 'use client'): lo importan componentes de cliente y de servidor.
 */
const MAX_TEXTO = 140;

function recortar(s: string, max = MAX_TEXTO): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function valorLegible(v: unknown, profundidad = 0): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : recortar(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (Array.isArray(v)) {
    const partes = v.map((x) => valorLegible(x, profundidad + 1)).filter((x): x is string => x !== null);
    return partes.length === 0 ? null : recortar(partes.join(', '));
  }
  if (typeof v === 'object') {
    // Más de dos niveles no se despliega: se dice cuántos campos trae en lugar de volcar el JSON.
    const entradas = Object.entries(v as Record<string, unknown>);
    if (profundidad >= 2) return entradas.length === 0 ? null : `${entradas.length} campos`;
    const partes = entradas
      .map(([k, x]) => [k, valorLegible(x, profundidad + 1)] as const)
      .filter((p): p is readonly [string, string] => p[1] !== null)
      .map(([k, x]) => `${k}: ${x}`);
    return partes.length === 0 ? null : recortar(partes.join(' · '));
  }
  return null;
}

/** Pares clave → texto de un registro, SIN las claves vacías (para listas de «fuentes»). */
export function paresLegibles(r: Record<string, unknown> | null | undefined): Array<[string, string]> {
  if (!r) return [];
  return Object.entries(r)
    .map(([k, v]) => [k, valorLegible(v)] as const)
    .filter((p): p is readonly [string, string] => p[1] !== null)
    .map(([k, v]) => [k, v]);
}
