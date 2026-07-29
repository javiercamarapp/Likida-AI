// ═══════════════════════════════════════════════════════════════════════════
// TOOLS del agente `liquidacion`. Se registran al importar este módulo.
//
// Nota de diseño: extraer_comprobante NO es tool del LLM — corre en el pipeline
// de WhatsApp al llegar una foto (el LLM no puede pasar bytes de imagen). El
// LLM ve los gastos ya extraídos como contexto y decide cuándo cuadrar/cerrar.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import { registerTool } from '@/lib/llm/tool-executor';
import { cuadrarDesdeDB } from './cuadre/desde_db';
import { getViaje, getOperador, saveLiquidacion } from './repo';
import { getConfig } from './config';
import { generarLiquidacionPDF } from './liquidacion/pdf';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { Liquidacion } from '@/types/cuadra';
import { normasDe, normasDePolitica } from './normas/por_diferencia';
import { getAcumuladoCombustible } from './repo';
import { evaluarTope15 } from './periodo/combustible';
import { avisoTope15 } from './periodo/aviso';
import { NORMAS, esVinculante } from './normas/indice';

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
    // ── EL PERMISO DE CITAR TIENE QUE VIAJAR CON LA POLÍTICA ────────────────
    //
    // AUDITORÍA 7, CRÍTICO. `permitidas` sale de `normasDeToolCalls`, que busca
    // la llave `norma_id`, y el ÚNICO sitio que la emitía era `cuadrar_viaje`.
    // Con eso, el sistema tenía una trampa cerrada sobre sí misma:
    //
    //   · turno CON `cuadrar_viaje` → `guardiaCifras` fuerza el texto SIEMPRE
    //     (guardia.ts:37-39 y :79) → `textoDeterminista = true` → la guardia de
    //     fundamento NO CORRE. Los permisos existen y no sirven.
    //   · turno SIN `cuadrar_viaje` —el operador pregunta "¿y por qué no me
    //     cuentas ese diésel?"— → la guardia SÍ corre, con `permitidas = []`, y
    //     entonces TODA cita cae en CITA_DESCONOCIDA y se borra a media frase:
    //
    //       "…porque el artículo 27, fracción III de la LISR limita a $2,000…"
    //     →  "…porque el limita a $2,000…"
    //       "Te aplica el estímulo conforme al LIF 2026 Art. 20-A."
    //     →  "Te aplica el estímulo conforme al -A."
    //
    // El turno que tiene permisos es exactamente el turno en que la guardia no
    // corre; el turno en que corre nunca tiene permisos. El producto era
    // estructuralmente incapaz de citar una norma, y al intentarlo entregaba una
    // frase rota — con el estímulo del diésel, que es lo que se vende, saliendo
    // como "conforme al -A."
    //
    // Explicar un tope ES citar la norma que lo sostiene, así que el permiso
    // pertenece a esta tool tanto como a la del cuadre. Se emiten SOLO las que
    // respaldan lo que esta tool devuelve —los límites de la política—, no un
    // salvoconducto general: el resto sigue borrándose.
    const fundamentos = normasDePolitica(config.politica);
    return {
      politica: config.politica,
      fundamentos: fundamentos.map((id) => ({
        norma_id: id,
        cita: NORMAS[id].citas[0],
        jerarquia: NORMAS[id].jerarquia,
        verificada: NORMAS[id].estado !== 'sin_verificar',
        vinculante: esVinculante(NORMAS[id].jerarquia),
      })),
    };
  },
});

// ── cuadrar_viaje ───────────────────────────────────────────────────────────
const computeCuadre = cuadrarDesdeDB; // alias local (fuente compartida)

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

    // LA CAPA DE PERIODO. El motor es puro y evalúa UN viaje, así que marca el
    // diésel en efectivo como "por confirmar" a ciegas: sin saber si la flota va
    // por el 3% del ejercicio —tranquila— o por el 14.8% —a punto de perder la
    // deducción de todo lo que pague en efectivo el resto del año—. Es la misma
    // información con dos valores completamente distintos para quien decide.
    //
    // Best-effort: si la consulta falla, el cuadre sale igual. El contador es
    // contexto valioso, no un requisito para cerrar un viaje.
    let periodo: { estado: string; razon: number; margen: number; excedente: number; aviso: string | null } | undefined;
    try {
      const ejercicio = new Date().getUTCFullYear();
      const acum = await getAcumuladoCombustible(ctx.tenantId, ejercicio);
      const t = evaluarTope15(acum);
      periodo = { estado: t.estado, razon: Number(t.razon.toFixed(4)), margen: t.margen, excedente: t.excedente, aviso: avisoTope15(t, ejercicio) };
    } catch (e) {
      logger.warn('periodo.combustible_no_disponible', { err: e instanceof Error ? e.message : String(e) });
    }
    // `fundamentos` es el permiso de citar. `guardiaFundamento` le quita al
    // mensaje cualquier norma que no salga de aquí, así que esta lista es lo
    // único que el agente puede mencionar en este turno. Sin ella no puede
    // citar NADA, que es la posición segura.
    const fundamentos = normasDe(liq.diferencias.map((d) => d.tipo));
    // Si hay algo que decir del ejercicio, el agente puede citar la regla 2.9.
    if (periodo && periodo.estado !== 'holgado' && !fundamentos.includes('rfa-2026-2.9')) fundamentos.push('rfa-2026-2.9');
    return {
      total_comprobado: liq.totalComprobado,
      total_anticipo: liq.totalAnticipo,
      diferencia: liq.diferencia,
      estatus: liq.estatus,
      diferencias: liq.diferencias.map((d) => ({ tipo: d.tipo, monto: d.monto, nota: d.nota })),
      ...(periodo ? { combustible_efectivo_ejercicio: periodo } : {}),
      fundamentos: fundamentos.map((id) => ({
        norma_id: id,
        cita: NORMAS[id].citas[0],
        jerarquia: NORMAS[id].jerarquia,
        // Que el agente sepa si puede AFIRMAR o tiene que condicionar. Una ficha
        // sin verificar no sostiene una afirmación tajante.
        verificada: NORMAS[id].estado !== 'sin_verificar',
        vinculante: esVinculante(NORMAS[id].jerarquia),
      })),
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
    // Generar PDF (determinístico, sin LLM). DOS ejemplares, y no es redundancia:
    // el completo es el registro de la liquidación —lo que el contralor archiva y
    // lo que queda en `liquidacion.pdf_path`— y el del operador lleva el mismo
    // filtro que su mensaje de WhatsApp. Sin esta separación, la defensa de
    // `SOLO_CONTRALOR` en el texto no servía de nada: al chofer le llegaban los
    // veredictos por el adjunto, en un documento que además puede reenviar.
    let pdfPath: string | undefined;
    let pdfOperadorPath: string | undefined;
    try {
      const full: Liquidacion = { ...liq, id: randomUUID(), creadaEn: new Date().toISOString() };
      const v = viaje ?? { id: ctx.viajeId, anticipo: liq.totalAnticipo };
      const o = operador ?? { id: ctx.operadorId ?? '', nombre: 'Operador', telefono: ctx.telefono ?? '' };
      const subir = async (bytes: Uint8Array, path: string) => {
        const up = await supabaseAdmin().storage.from('liquidaciones').upload(path, Buffer.from(bytes), {
          contentType: 'application/pdf',
          upsert: true,
        });
        if (up.error) { logger.warn('pdf.upload', { path, err: up.error.message }); return undefined; }
        return path;
      };
      pdfPath = await subir(await generarLiquidacionPDF(full, v, o, undefined, 'contralor'), `${ctx.tenantId}/${ctx.viajeId}.pdf`);
      pdfOperadorPath = await subir(await generarLiquidacionPDF(full, v, o, undefined, 'operador'), `${ctx.tenantId}/${ctx.viajeId}-operador.pdf`);
    } catch (e) {
      logger.error('pdf.gen', { err: e instanceof Error ? e.message : String(e) });
    }
    const liquidacionId = await saveLiquidacion(ctx.tenantId, liq, pdfPath);
    return {
      liquidacion_id: liquidacionId,
      estatus: liq.estatus,
      diferencia: liq.diferencia,
      pdf_generado: Boolean(pdfOperadorPath),
    };
  },
});
