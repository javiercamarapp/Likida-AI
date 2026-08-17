// ═══════════════════════════════════════════════════════════════════════════
// PRIMERA LIQUIDACIÓN — las señales del arranque de una flota nueva.
//
// Auditoría 5 (17-ago-2026): el gap #1 de producto es que un administrador
// nuevo no entiende qué hacer primero. La respuesta no es un manual: es una
// guía de 4 pasos que se marca sola con datos REALES del tenant (regla de la
// casa: nada se rellena, nada se estima). Cuando existe la primera
// liquidación, la guía desaparece — ya aprendió el loop.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface PrimerosPasos {
  operadores: number;
  viajes: number;
  comprobantes: number;
  liquidaciones: number;
  /** true = ya cerró su primera liquidación; la guía no se pinta. */
  completado: boolean;
}

/** Un conteo exacto sin traer filas. `count` nulo NO es cero (mismo criterio
 *  que `contarFilas` de analytics): si la base no contó, se LANZA — el
 *  llamador envuelve en `safe()` y la guía simplemente no se pinta, que es
 *  mejor que pintarla con pasos "pendientes" inventados. */
async function contar(tabla: string, tenantId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from(tabla).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  if (error) throw new Error(`primerosPasos/${tabla}: ${error.message}`);
  if (typeof count !== 'number') throw new Error(`primerosPasos/${tabla}: la base no devolvió el conteo`);
  return count;
}

export async function getPrimerosPasos(tenantId: string): Promise<PrimerosPasos> {
  const [operadores, viajes, comprobantes, liquidaciones] = await Promise.all([
    contar('operador', tenantId),
    contar('viaje', tenantId),
    contar('gasto', tenantId),
    contar('liquidacion', tenantId),
  ]);
  return { operadores, viajes, comprobantes, liquidaciones, completado: liquidaciones > 0 };
}
