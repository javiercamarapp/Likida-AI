// ═══════════════════════════════════════════════════════════════════════════
// QUÉ VENTANA DE TIEMPO ENSEÑA CADA BLOQUE DEL RESUMEN, con cada opción del pill.
//
// AUDITORÍA 18, ALTO (A11): el selector único Semanal/Mensual/Histórico del
// 8-ago-2026 juntó bajo tres etiquetas DOS escalas distintas que nunca se
// reconciliaron —`getSeriesKpiCards` mide en días (7/30/~todo) y las series de
// dinero en semanas ISO (`SEMANAS_POR_MODO`: 5/13/52)—, así que con "Semanal"
// la dona contaba 7 días de viajes al lado de 35 días de dinero, y con
// "Histórico" la tarjeta "Liquidado" sumaba solo 52 semanas bajo un rótulo que
// promete todo. Dividir una tarjeta entre la de al lado daba un costo por viaje
// 5× el real.
//
// La reconciliación de las ventanas vive en `lib/likida/analytics.ts` y no se
// toca aquí. Lo que este módulo garantiza es la regla del repo —"un rótulo
// tiene que ser verdad"—: cada tarjeta imprime SU ventana real junto al título,
// y la prueba `ventana-periodo.test.ts` lee el fuente de `analytics.ts` y
// `actividad.tsx` para que estos números no se desfasen en silencio.
// ═══════════════════════════════════════════════════════════════════════════

import type { ModoPeriodo } from '@/lib/likida/analytics';

export type BloquePeriodo = 'viajes' | 'actividad' | 'gasto' | 'liquidado' | 'rutas';

/** Días por modo de `getSeriesKpiCards` (dona de Viajes) y `bucketsPorDia`
 *  (Actividad). `null` = sin cota / todo el histórico. */
export const DIAS_POR_MODO: Record<ModoPeriodo, number | null> = { semanal: 7, mensual: 30, historico: null };

/** Semanas por modo de `SEMANAS_POR_MODO` (Gasto por categoría, Liquidado y
 *  las dos primeras vistas de Top rutas). Histórico AQUÍ es 52 semanas, no
 *  todo — por eso la tarjeta lo dice. */
export const SEMANAS_POR_MODO_VISTA: Record<ModoPeriodo, number> = { semanal: 5, mensual: 13, historico: 52 };

export function rotuloVentana(bloque: BloquePeriodo, modo: ModoPeriodo): string {
  if (bloque === 'viajes' || bloque === 'actividad') {
    const d = DIAS_POR_MODO[modo];
    return d === null ? 'todo el histórico' : `últimos ${d} días`;
  }
  if (bloque === 'rutas' && modo === 'historico') return 'todo el histórico';
  return `últimas ${SEMANAS_POR_MODO_VISTA[modo]} semanas`;
}
