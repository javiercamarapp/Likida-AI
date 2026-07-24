// ═══════════════════════════════════════════════════════════════════════════
// Ruteo de modelos por rol (arquitectura híbrida, fundamentada en benchmarks).
//
// Regla: calidad de frontera DONDE un error cuesta dinero (el cuadre), y
// modelos baratos/rápidos donde no (chat, router, OCR de lectura). Todo es
// override-able por env porque los modelos rotan rápido (2026). Los defaults
// son slugs de OpenRouter; se pueden apuntar a proveedor directo.
//
// Fundamento (síntesis de benchmarks jul-2026):
//   OCR      → Gemini Flash: #1 calidad en recibos ruidosos ES + el más barato.
//   Cuadre   → Claude Sonnet: élite en tool-use multi-turno bajo política
//              (τ²-bench), a 1/3 del precio de Opus. Fallback Opus por confianza.
//   Chat     → Gemini Flash-Lite: mejor español barato + baja latencia.
//   Router   → Gemini Flash-Lite / clasificación de una línea, centavos.
// ═══════════════════════════════════════════════════════════════════════════

export type ModelRole = 'ocr' | 'cuadre' | 'cuadre_fallback' | 'chat' | 'router';

const DEFAULTS: Record<ModelRole, string> = {
  // OCR de comprobantes (visión). Provisional: pendiente cerrar el benchmark
  // full-roster de OCR; la evidencia actual favorece Gemini Flash sobre Claude.
  ocr: 'google/gemini-3-flash',
  // Cerebro de conciliación — donde pagamos calidad.
  cuadre: 'anthropic/claude-sonnet-4.5',
  // Escalación por baja confianza / monto alto / caso ambiguo.
  cuadre_fallback: 'anthropic/claude-opus-4.5',
  // Chat de alto volumen con el operador (español MX, latencia baja).
  chat: 'google/gemini-3-flash-lite',
  // Clasificador de intención por mensaje entrante.
  router: 'google/gemini-3-flash-lite',
};

const ENV_KEY: Record<ModelRole, string> = {
  ocr: 'CUADRA_MODEL_OCR',
  cuadre: 'CUADRA_MODEL_CUADRE',
  cuadre_fallback: 'CUADRA_MODEL_CUADRE_FALLBACK',
  chat: 'CUADRA_MODEL_CHAT',
  router: 'CUADRA_MODEL_ROUTER',
};

/** Devuelve el slug del modelo para un rol, respetando override por env. */
export function modelFor(role: ModelRole): string {
  return process.env[ENV_KEY[role]] || DEFAULTS[role];
}

/** Parámetros por defecto por rol (esfuerzo de razonamiento, temperatura). */
export const ROLE_PARAMS: Record<ModelRole, { temperature: number; reasoning?: 'low' | 'medium' | 'high' }> = {
  ocr: { temperature: 0 },                    // extracción determinística
  cuadre: { temperature: 0, reasoning: 'high' }, // razonamiento profundo donde importa
  cuadre_fallback: { temperature: 0, reasoning: 'high' },
  chat: { temperature: 0.4 },                 // tono natural
  router: { temperature: 0 },
};
