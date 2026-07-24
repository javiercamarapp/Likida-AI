// ═══════════════════════════════════════════════════════════════════════════
// Ruteo de modelos por rol (arquitectura híbrida, fundamentada en benchmarks).
//
// Regla: calidad de frontera DONDE un error cuesta dinero (el cuadre), y
// modelos baratos/rápidos donde no (chat, router, OCR de lectura). Todo es
// override-able por env porque los modelos rotan rápido (2026). Los defaults
// son slugs de OpenRouter; se pueden apuntar a proveedor directo.
//
// Fundamento (2 investigaciones independientes convergen — jul-2026):
//   OCR      → Gemini Flash: #1 calidad en recibos ruidosos ES + el más barato.
//              El OCR y el JSON se FUSIONAN en una llamada (generateStructured
//              con images + response_format) → elimina un paso y su costo.
//   Cuadre   → Claude Sonnet: élite en tool-use multi-turno bajo política
//              (τ²-bench), a 1/3 del precio de Opus. Fallback Opus por confianza.
//   Chat     → Gemini Flash-Lite: mejor español barato + baja latencia.
//   Router   → Gemini Flash-Lite / clasificación de una línea, centavos.
//   Costo ≈ $0.03–0.05 / liquidación.
//
// ⚖️ SOBERANÍA DE DATOS FISCALES (LFPDPPP, DOF 20-mar-2025): RFC y CFDI son
//   datos personales. Todo lo que lleve RFC/CFDI va SOLO a proveedores US/EU
//   con Zero Data Retention. El gateway fuerza ZDR con `data_collection:'deny'`
//   en cada llamada. NUNCA usar APIs chinas directas (DeepSeek/Qwen/Kimi); si
//   se usan sus pesos, solo vía host occidental. Fallbacks aquí son US.
//
// 🔌 PLAN B DEMO: OpenRouter es punto único de falla (caídas ago-2025, feb-2026).
//   Para el demo en vivo, tener keys directas de Google/Anthropic como respaldo.
// ═══════════════════════════════════════════════════════════════════════════

export type ModelRole = 'ocr' | 'cuadre' | 'cuadre_fallback' | 'chat' | 'router';

const DEFAULTS: Record<ModelRole, string> = {
  // OCR de comprobantes (visión). Gemini 3.6 Flash (21-jul-2026): #1 OCR Arena
  // en recibos ruidosos ES; visión + JSON en una sola llamada.
  ocr: 'google/gemini-3.6-flash',
  // Cerebro de conciliación. Sonnet 5 (30-jun-2026): mejor que 4.5 en todo, con
  // precio intro $2/$10 hasta 31-ago — justo la ventana del demo.
  cuadre: 'anthropic/claude-sonnet-5',
  // Escalación por baja confianza / monto alto / caso ambiguo. Opus 5 (24-jul):
  // #1 del Intelligence Index. Solo se dispara, no es el default de cada cuadre.
  cuadre_fallback: 'anthropic/claude-opus-5',
  // Chat de alto volumen con el operador (español MX, latencia baja).
  chat: 'google/gemini-3.5-flash-lite',
  // Clasificador de intención por mensaje entrante.
  router: 'google/gemini-3.5-flash-lite',
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
