// El adaptador REAL del puerto `LlmExtractor`: llama a `generateStructured` con el
// rol del nivel (Gemini 3.5 Flash-Lite → Gemini 3.8 Flash → Sonnet 5.5, ver
// models.ts). Vive aparte de extractor.ts para que la lógica de extracción se
// pruebe sin cargar el cliente de OpenAI.

import { randomUUID } from 'node:crypto';
import { generateStructured } from '@/lib/llm/openrouter';
import { createLlmBudget, type PropositoIa } from '@/lib/llm/budget';
import type { ModelRole } from '@/lib/llm/models';
import { SalidaLlmSchema, construirSistema, construirUsuario, type LlmExtractor, type NivelModelo } from './extractor';

export const ROL_POR_NIVEL: Record<NivelModelo, ModelRole> = {
  1: 'cartaporte_extractor',
  2: 'cartaporte_extractor_escala',
  3: 'cartaporte_extractor_escala2',
};

/**
 * @param proposito  'interactivo' para lo que una persona espera (subida manual, WhatsApp);
 *                   'ocr_lote' para el correo, que se procesa de fondo.
 * Una corrida (= un documento) comparte UN presupuesto entre sus niveles.
 */
export function crearExtractorOpenRouter(tenantId: string, proposito: PropositoIa): LlmExtractor {
  const budget = createLlmBudget(tenantId, `cp-${randomUUID()}`, proposito);
  return async (entrada, signal) => {
    const r = await generateStructured({
      role: ROL_POR_NIVEL[entrada.nivel],
      system: construirSistema(),
      messages: [{ role: 'user', content: construirUsuario(entrada) }],
      schema: SalidaLlmSchema,
      schemaName: 'carta_porte_extraccion',
      images: entrada.imagenes.length > 0 ? entrada.imagenes : undefined,
      maxTokens: 8000,
      signal,
      budget,
    });
    return { ...r.data, modelo: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costoUsd: r.cost };
  };
}
