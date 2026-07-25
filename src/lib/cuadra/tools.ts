// ═══════════════════════════════════════════════════════════════════════════
// TOOLS del agente `liquidacion`. Se registran al importar este módulo.
//
// Nota de diseño: extraer_comprobante NO es tool del LLM — corre en el pipeline
// de WhatsApp al llegar una foto (el LLM no puede pasar bytes de imagen). El
// LLM ve los gastos ya extraídos como contexto y decide cuándo cuadrar/cerrar.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import { registerTool } from '@/lib/llm/tool-executor';
import { cuadrarViaje } from './cuadre/engine';
import { getViaje, getGastos, getOperador, saveLiquidacion } from './repo';
import { getConfig } from './config';
import { generarLiquidacionPDF } from './liquidacion/pdf';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { Liquidacion } from '@/types/cuadra';

// ── consultar_politica ──────────────────────────────────────────────────────
registerTool('consultar_politica', {
  schema: {
    type: 'function',
    function: {
      name: 'consultar_politica',
      description: 'Trae la política de gastos de la flota (topes por concepto/ruta). Úsala antes de cuadrar.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  handler: async (_args, ctx) => {
    const config = await getConfig(ctx.tenantId);
    return { politica: config.politica };
  },
});

// ── cuadrar_viaje ───────────────────────────────────────────────────────────
async function computeCuadre(tenantId: string, viajeId: string): Promise<Omit<Liquidacion, 'id' | 'creadaEn'>> {
  const [viaje, gastos, config] = await Promise.all([
    getViaje(viajeId, tenantId),
    getGastos(viajeId, tenantId),
    getConfig(tenantId),
  ]);
  if (!viaje) throw new Error('viaje no encontrado');
  return cuadrarViaje({
    viajeId,
    anticipo: viaje.anticipo,
    gastos,
    politica: config.politica,
    ruta: viaje.destino,
    empresaRfc: config.empresa.rfc,
    rfcsAdicionales: config.empresa.rfcsAdicionales,
  });
}

registerTool('cuadrar_viaje', {
  schema: {
    type: 'function',
    function: {
      name: 'cuadrar_viaje',
      description: 'Cuadra el viaje: compara los comprobantes contra el anticipo y la política, y devuelve total comprobado, diferencia y las diferencias detectadas. NO cierra la liquidación (eso es guardar_liquidacion).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  handler: async (_args, ctx) => {
    if (!ctx.viajeId) throw new Error('sin viaje activo');
    const liq = await computeCuadre(ctx.tenantId, ctx.viajeId);
    return {
      total_comprobado: liq.totalComprobado,
      total_anticipo: liq.totalAnticipo,
      diferencia: liq.diferencia,
      estatus: liq.estatus,
      diferencias: liq.diferencias.map((d) => ({ tipo: d.tipo, monto: d.monto, nota: d.nota })),
    };
  },
});

// ── guardar_liquidacion (MUTACIÓN) ──────────────────────────────────────────
registerTool('guardar_liquidacion', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'guardar_liquidacion',
      description: 'Cierra la liquidación del viaje: la persiste, genera el PDF y la marca como liquidada. Úsala solo cuando el operador confirme que ya no tiene más comprobantes.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  handler: async (_args, ctx) => {
    if (!ctx.viajeId) throw new Error('sin viaje activo');
    const [liq, viaje, operador] = await Promise.all([
      computeCuadre(ctx.tenantId, ctx.viajeId),
      getViaje(ctx.viajeId, ctx.tenantId),
      ctx.operadorId ? getOperador(ctx.operadorId, ctx.tenantId) : Promise.resolve(null),
    ]);
    // Generar PDF (determinístico, sin LLM).
    let pdfPath: string | undefined;
    try {
      const full: Liquidacion = { ...liq, id: randomUUID(), creadaEn: new Date().toISOString() };
      const bytes = await generarLiquidacionPDF(
        full,
        viaje ?? { id: ctx.viajeId, anticipo: liq.totalAnticipo },
        operador ?? { id: ctx.operadorId ?? '', nombre: 'Operador', telefono: ctx.telefono ?? '' },
      );
      pdfPath = `${ctx.tenantId}/${ctx.viajeId}.pdf`;
      const up = await supabaseAdmin().storage.from('liquidaciones').upload(pdfPath, Buffer.from(bytes), {
        contentType: 'application/pdf',
        upsert: true,
      });
      if (up.error) { logger.warn('pdf.upload', { err: up.error.message }); pdfPath = undefined; }
    } catch (e) {
      logger.error('pdf.gen', { err: e instanceof Error ? e.message : String(e) });
    }
    const liquidacionId = await saveLiquidacion(ctx.tenantId, liq, pdfPath);
    return {
      liquidacion_id: liquidacionId,
      estatus: liq.estatus,
      diferencia: liq.diferencia,
      pdf_generado: Boolean(pdfPath),
    };
  },
});
