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

export type ModelRole = 'ocr' | 'cuadre' | 'cuadre_fallback' | 'chat' | 'chat_ligero' | 'router';

const DEFAULTS: Record<ModelRole, string> = {
  // OCR de comprobantes (visión). Gemini 3.6 Flash (21-jul-2026): #1 OCR Arena
  // en recibos ruidosos ES; visión + JSON en una sola llamada.
  //
  // MEDIDO EL 4-AGO-2026 CONTRA 18 COMPROBANTES REALES, dos corridas: este
  // default PIERDE contra `google/gemini-3.1-flash-lite` en las tres métricas
  // —legibles 13-14 vs 14-15, montos 13-14 vs 14-15, folios 10-12 vs 13-14— y
  // cuesta 12.5× más ($0.0188 vs $0.0015 por comprobante).
  //
  // De dónde sale la diferencia: 3.6 emite ~1,500 tokens de salida (razonamiento
  // que se cobra) y el lite ~274. Y el sesgo del experimento FAVORECÍA al 3.6,
  // porque los valores asentados los produjo él en producción; aun así perdió.
  //
  // El override vive en la variable `LIKIDA_MODEL_OCR` de Vercel, apuntando ya
  // a 3.1-flash-lite. El default se deja aquí a propósito: 18 comprobantes son
  // pocos para reescribir la elección de arquitectura, y revertir tiene que
  // costar una variable de entorno, no un despliegue.
  ocr: 'google/gemini-3.6-flash',
  // Cerebro de conciliación. Sonnet 5 (30-jun-2026): mejor que 4.5 en todo, con
  // precio intro $2/$10 hasta 31-ago — justo la ventana del demo.
  cuadre: 'anthropic/claude-sonnet-5',
  // Escalación por baja confianza / monto alto / caso ambiguo. Opus 5 (24-jul):
  // #1 del Intelligence Index. Solo se dispara, no es el default de cada cuadre.
  cuadre_fallback: 'anthropic/claude-opus-5',
  // Chat de alto volumen con el operador (español MX, latencia baja).
  chat: 'google/gemini-3.5-flash-lite',
  // El CONSERJE del chat del panel (12-ago-2026): recibe TODO mensaje,
  // contesta charla y dudas del producto, y escala al analista (rol chat)
  // cuando hay que tocar datos. gpt-5-nano verificado ese día contra el
  // catálogo de OpenRouter: $0.05/$0.40 por M — 6× más barato que
  // flash-lite y proveedor US (soberanía: los Qwen/DeepSeek baratos van a
  // API china directa y RFC/CFDI no pueden pisar ahí).
  chat_ligero: 'openai/gpt-5-nano',
  // Clasificador de intención por mensaje entrante.
  router: 'google/gemini-3.5-flash-lite',
};

const ENV_KEY: Record<ModelRole, string> = {
  ocr: 'LIKIDA_MODEL_OCR',
  cuadre: 'LIKIDA_MODEL_CUADRE',
  cuadre_fallback: 'LIKIDA_MODEL_CUADRE_FALLBACK',
  chat: 'LIKIDA_MODEL_CHAT',
  chat_ligero: 'LIKIDA_MODEL_CHAT_LIGERO',
  router: 'LIKIDA_MODEL_ROUTER',
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
  chat_ligero: { temperature: 0.6, reasoning: 'low' }, // conversación, sin cifras — nano razona; corto
  router: { temperature: 0 },
};
