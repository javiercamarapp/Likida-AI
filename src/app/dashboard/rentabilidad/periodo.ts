/** Periodos de Rentabilidad: la ventana de viajes que mide el margen (`viaje.created_at >= desde`, RPC `rentabilidad_tenant`). */
export const PERIODOS_RENTABILIDAD = ['todo', '30d', '90d', '12m'] as const;
export type PeriodoRentabilidad = (typeof PERIODOS_RENTABILIDAD)[number];

/** Un `?periodo=` desconocido cae al histórico (no inventa una ventana). */
export function periodoDe(v: string | undefined): PeriodoRentabilidad {
  return (PERIODOS_RENTABILIDAD as readonly string[]).includes(v ?? '') ? (v as PeriodoRentabilidad) : 'todo';
}

const DIAS: Record<Exclude<PeriodoRentabilidad, 'todo'>, number> = { '30d': 30, '90d': 90, '12m': 365 };

/** El `p_desde` (ISO) de la ventana; `null` = histórico completo. `ahora` se inyecta para poder probarlo. */
export function desdeDelPeriodo(p: PeriodoRentabilidad, ahora: Date = new Date()): string | null {
  if (p === 'todo') return null;
  return new Date(ahora.getTime() - DIAS[p] * 86_400_000).toISOString();
}
