// Registro y agregación del costo real de AI. Best-effort: registrar el costo
// NUNCA debe tumbar el flujo de la liquidación.

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export type FaseCosto = 'ocr' | 'cuadre' | 'escalacion' | 'chat' | 'router' | 'whatsapp';

// Costo por mensaje SALIENTE de WhatsApp (los entrantes son GRATIS).
// Dentro de la ventana de servicio de 24h son gratis hasta el 1-oct-2026; después
// Meta cobra utility/servicio (~USD 0.0080 base MX). Override por env.
// ⚠️ Verificar rate card vigente de Meta antes de proyectar.
export const WHATSAPP_MSG_USD = Number(process.env.CUADRA_WHATSAPP_MSG_USD ?? '0.008');

/** Registra el costo de UN mensaje saliente de WhatsApp (best-effort). */
export async function registrarCostoWhatsApp(tenantId: string, viajeId: string | null): Promise<void> {
  await registrarCosto({ tenantId, viajeId, fase: 'whatsapp', modelo: 'whatsapp-utility', tokensIn: 0, tokensOut: 0, costoUsd: WHATSAPP_MSG_USD });
}

export interface CostoLLM {
  tenantId: string;
  viajeId?: string | null;
  liquidacionId?: string | null;
  fase: FaseCosto;
  modelo: string;
  tokensIn: number;
  tokensOut: number;
  costoUsd: number;
}

/** Deriva la fase a partir del slug del modelo (opus = escalación). */
export function faseDeModelo(modelo: string, base: FaseCosto): FaseCosto {
  if (modelo.includes('opus')) return 'escalacion';
  return base;
}

/** Registra el costo de una llamada. Best-effort (no lanza). */
export async function registrarCosto(c: CostoLLM): Promise<void> {
  try {
    await supabaseAdmin().from('llm_costo').insert({
      tenant_id: c.tenantId,
      viaje_id: c.viajeId ?? null,
      liquidacion_id: c.liquidacionId ?? null,
      fase: c.fase,
      modelo: c.modelo,
      tokens_in: Math.round(c.tokensIn),
      tokens_out: Math.round(c.tokensOut),
      costo_usd: Number(c.costoUsd.toFixed(6)),
    });
  } catch (e) {
    logger.warn('costo.registrar', { err: e instanceof Error ? e.message : String(e) });
  }
}

/** Al cerrar la liquidación, vincula los costos del viaje a su liquidacion_id. */
export async function vincularCostosALiquidacion(tenantId: string, viajeId: string, liquidacionId: string): Promise<void> {
  try {
    await supabaseAdmin()
      .from('llm_costo')
      .update({ liquidacion_id: liquidacionId })
      .eq('tenant_id', tenantId)
      .eq('viaje_id', viajeId)
      .is('liquidacion_id', null);
  } catch {
    /* best-effort */
  }
}

export interface ResumenCosto {
  totalUsd: number;
  liquidaciones: number;
  costoPromedioPorLiquidacion: number;
  tokensIn: number;
  tokensOut: number;
  porFase: Record<string, number>;
}

/** Resumen de costo del tenant (para el panel: margen real). */
export async function getResumenCosto(tenantId: string): Promise<ResumenCosto> {
  const { data } = await supabaseAdmin()
    .from('llm_costo')
    .select('viaje_id, fase, tokens_in, tokens_out, costo_usd')
    .eq('tenant_id', tenantId);
  const rows = data ?? [];
  const totalUsd = rows.reduce((s, r) => s + Number(r.costo_usd), 0);
  const viajes = new Set(rows.map((r) => r.viaje_id).filter(Boolean));
  const porFase: Record<string, number> = {};
  for (const r of rows) porFase[r.fase as string] = (porFase[r.fase as string] ?? 0) + Number(r.costo_usd);
  return {
    totalUsd: round6(totalUsd),
    liquidaciones: viajes.size,
    costoPromedioPorLiquidacion: viajes.size ? round6(totalUsd / viajes.size) : 0,
    tokensIn: rows.reduce((s, r) => s + Number(r.tokens_in), 0),
    tokensOut: rows.reduce((s, r) => s + Number(r.tokens_out), 0),
    porFase,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
