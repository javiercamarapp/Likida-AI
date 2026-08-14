// ═══════════════════════════════════════════════════════════════════════════
// LA BITÁCORA DE CORRIDAS — el historial que el cliente SÍ ve (B3, aud. 4).
//
// Hasta hoy, el único rastro de que un agente corrió era `logger.info`, que
// vive en Vercel y el cliente no puede abrir. La ficha de Handle enseña
// «Periodo · Estado · Tareas 2/2 · Duración · Fecha» por corrida; esta tabla
// (0102) es esa ficha, una fila por (corrida × flota).
//
// LA REGLA QUE GOBIERNA EL ESCRITOR: registrar JAMÁS lanza. La corrida que
// está anotándose ya hizo su trabajo (escaló viajes, mandó cobranzas); tumbar
// eso porque la bitácora no pudo escribir sería el mismo error que el repo ya
// documentó con los avisos. Se pierde la anotación, se grita en el log.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';

/** El dominio del CHECK de la 0102 — el mismo catálogo de notificaciones. */
export type AgenteConCorridas = 'liquidacion' | 'facturas' | 'cobranza' | 'conductores' | 'peajes' | 'proveedores';
export type EstadoCorrida = 'ok' | 'parcial' | 'fallo';

export interface CorridaNueva {
  inicio: Date;
  fin: Date;
  estado: EstadoCorrida;
  disparo: 'cron' | 'manual';
  /** El «2/2» de la ficha. Ambos o ninguno: un numerador sin denominador no
   *  dice nada, y la ficha pinta «—» cuando la corrida no se mide en tareas. */
  tareasHechas?: number;
  tareasTotal?: number;
  /** Conteos y folios para desplegar. SIN datos personales, SIN stacks. */
  resumen?: Record<string, unknown>;
  /** El motivo del fallo YA redactado para una persona. */
  error?: string;
}

export async function registrarCorrida(
  tenantId: string,
  agente: AgenteConCorridas,
  c: CorridaNueva,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from('agente_corrida').insert({
      tenant_id: tenantId,
      agente,
      inicio: c.inicio.toISOString(),
      fin: c.fin.toISOString(),
      estado: c.estado,
      disparo: c.disparo,
      tareas_hechas: c.tareasHechas ?? null,
      tareas_total: c.tareasTotal ?? null,
      resumen: c.resumen ?? null,
      error: c.error ?? null,
    });
    if (error) logger.error('corridas.no_registrada', { tenant: tenantId, agente, err: error.message });
  } catch (e) {
    logger.error('corridas.no_registrada', { tenant: tenantId, agente, err: e instanceof Error ? e.message : String(e) });
  }
}

export interface CorridaRegistrada {
  id: string;
  inicio: string;
  fin: string | null;
  estado: EstadoCorrida;
  disparo: 'cron' | 'manual';
  tareasHechas: number | null;
  tareasTotal: number | null;
  resumen: Record<string, unknown> | null;
  error: string | null;
  /** Milisegundos entre inicio y fin. `null` sin fin — corrida sin cerrar. */
  duracionMs: number | null;
}

/**
 * Las últimas corridas de un agente para su ficha. LANZA ante un error de
 * lectura: una ficha que pinta "sin corridas" sobre una base caída afirmaría
 * exactamente lo que este historial existe para desmentir.
 */
export async function ultimasCorridas(
  tenantId: string,
  agente: AgenteConCorridas,
  limite = 8,
): Promise<CorridaRegistrada[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_corrida')
    .select('id, inicio, fin, estado, disparo, tareas_hechas, tareas_total, resumen, error')
    .eq('tenant_id', tenantId)
    .eq('agente', agente)
    .order('inicio', { ascending: false })
    .limit(limite), 'ultimasCorridas');
  if (error) throw new Error(`ultimasCorridas: ${error.message}`);
  return (data ?? []).map((f) => {
    const r = f as Record<string, unknown>;
    const inicio = String(r.inicio);
    const fin = r.fin === null || r.fin === undefined ? null : String(r.fin);
    const ms = fin === null ? null : new Date(fin).getTime() - new Date(inicio).getTime();
    return {
      id: String(r.id),
      inicio,
      fin,
      estado: String(r.estado) as EstadoCorrida,
      disparo: String(r.disparo) as 'cron' | 'manual',
      tareasHechas: r.tareas_hechas === null || r.tareas_hechas === undefined ? null : Number(r.tareas_hechas),
      tareasTotal: r.tareas_total === null || r.tareas_total === undefined ? null : Number(r.tareas_total),
      resumen: (r.resumen as Record<string, unknown> | null) ?? null,
      error: r.error === null || r.error === undefined ? null : String(r.error),
      duracionMs: ms !== null && Number.isFinite(ms) && ms >= 0 ? ms : null,
    };
  });
}

/** «3 s», «2 min 05 s» — la duración como la lee una persona. */
export function duracionLegible(ms: number | null): string | null {
  if (ms === null) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  const resto = s % 60;
  return `${min} min ${String(resto).padStart(2, '0')} s`;
}
