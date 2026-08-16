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
//   en cada llamada. REGLA (16-ago-2026): TODO el stack de este repo — defaults
//   y fallbacks — es de proveedores USA. Sin excepciones por precio.
//
// 🔌 PLAN B DEMO: OpenRouter es punto único de falla (caídas ago-2025, feb-2026).
//   Para el demo en vivo, tener keys directas de Google/Anthropic como respaldo.
// ═══════════════════════════════════════════════════════════════════════════

export type ModelRole = 'ocr' | 'cuadre' | 'cuadre_fallback' | 'chat' | 'chat_ligero' | 'router' | 'back_office' | 'analisis' | 'extraccion' | 'marketing' | 'codigo' | 'codigo_escritura' | 'qa';

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
  // flash-lite, y proveedor US como todo el stack.
  chat_ligero: 'openai/gpt-5-nano',
  // Clasificador de intención por mensaje entrante.
  router: 'google/gemini-3.5-flash-lite',
  // BACK OFFICE / agentes internos de LIKIDA (Redactor C5, runner nivel 2).
  // REGLA FINAL DE JAVIER (16-ago-2026): TODO el stack que vive en este repo
  // es de proveedores USA (OpenAI —incluidos sus open-weight—, Google,
  // Anthropic). Cero exposición legal, y la información de usuarios jamás
  // sale de esa jurisdicción. El piso de precio no se pierde: gpt-oss-120b
  // (open-weight de OpenAI) da $0.03/$0.17 por M con tools — el mismo rango
  // que cualquier alternativa barata del catálogo. Escalar sigue siendo por
  // env, sin deploy. Verificado contra OpenRouter ese día.
  back_office: 'openai/gpt-oss-120b',
  // ANÁLISIS DE DIRECCIÓN (el Copiloto del fundador y sus tools).
  // SEGUNDA verificación del 16-ago-2026 (Javier: "¿y Luna? cerciórate
  // bien"): gpt-5.6-luna a $0.10/$0.60 por M, 1M ctx, tools — le gana en
  // precio a todo lo comparado ese día en su banda de calidad.
  // Los otros candidatos del día, medidos y descartados: gemini-3.7-flash
  // $0.38/$1.88, grok-4.6 $2/$6, grok-4.20 $1.25/$2.50 (2M ctx — caro para
  // este rol). Fallback: flash-lite (cruce de proveedor). Por aquí pasan
  // métricas agregadas de LIKIDA — no comprobantes de clientes.
  analisis: 'openai/gpt-5.6-luna',
  // ── Los roles POR ÁREA del organigrama de 54 agentes (16-ago-2026,
  // pedido de Javier: "cada agente su stack según su tipo de acción, los
  // mejores en su área"). Verificados contra OpenRouter ese día; la matriz
  // agente→rol vive en agente_definicion.modelo_rol (0125) y la tabla
  // humana en docs/conocimiento/stack-modelos-agentes.md. ──────────────────
  //
  // EXTRACCIÓN (Cazador/Enriquecedor: parsear páginas y normalizar datos —
  // volumen alto, cero creatividad): el open-weight chico de OpenAI, el
  // piso absoluto del catálogo USA.
  extraccion: 'openai/gpt-oss-20b',            // $0.03/$0.13
  // MARKETING (contenido fiscal, lead magnet, SEO, guiones): Luna escribe
  // con oficio y cuesta centavos. Las CIFRAS siguen viniendo de la guía
  // canónica en el prompt, jamás del modelo.
  marketing: 'openai/gpt-5.6-luna',            // $0.10/$0.60
  // CÓDIGO — SOLO AUDITORÍA/LECTURA (auditor, migraciones, releases,
  // rendimiento, seguridad): produce HALLAZGOS y reportes; jamás un diff
  // que se aplique. La cacería es barata y en manada (mismo modelo que los
  // testers); MODIFICAR el código es de codigo_escritura, y ese escala a
  // los mejores.
  codigo: 'openai/gpt-oss-120b',               // $0.03/$0.17
  // CÓDIGO — ESCRITURA (pruebas y cualquier agente cuyo output sea un DIFF
  // que se aplica al repo): SOLO USA, escalando a los mejores — "eso escala
  // a mejores modelos, los que yo tengo que codificar" (Javier, 16-ago).
  // Sonnet 5 es élite en código (τ²-bench, el mismo del cuadre); escala a
  // opus-5 por env. El diff resultante TAMBIÉN pasa por aprobación humana.
  //
  // OJO: el camino PRIMARIO de este rol no es la API — es Claude Code por
  // SUSCRIPCIÓN en la Mac de Javier (scripts/mejora-diaria/, decisión del
  // 16-ago: costo marginal $0). Este default por API queda como respaldo y
  // para motores que algún día corran en el server.
  codigo_escritura: 'anthropic/claude-sonnet-5', // $2/$10 (intro hasta 31-ago)
  // QA / TESTERS (vigilante de calidad, ejército QA de Fase 3): juicio
  // adversarial barato — razonamiento por centavos, mismo modelo que la
  // auditoría: cazan juntos.
  qa: 'openai/gpt-oss-120b',                   // $0.03/$0.17
};

const ENV_KEY: Record<ModelRole, string> = {
  ocr: 'LIKIDA_MODEL_OCR',
  cuadre: 'LIKIDA_MODEL_CUADRE',
  cuadre_fallback: 'LIKIDA_MODEL_CUADRE_FALLBACK',
  chat: 'LIKIDA_MODEL_CHAT',
  chat_ligero: 'LIKIDA_MODEL_CHAT_LIGERO',
  router: 'LIKIDA_MODEL_ROUTER',
  back_office: 'LIKIDA_MODEL_BACK_OFFICE',
  analisis: 'LIKIDA_MODEL_ANALISIS',
  extraccion: 'LIKIDA_MODEL_EXTRACCION',
  marketing: 'LIKIDA_MODEL_MARKETING',
  codigo: 'LIKIDA_MODEL_CODIGO',
  codigo_escritura: 'LIKIDA_MODEL_CODIGO_ESCRITURA',
  qa: 'LIKIDA_MODEL_QA',
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
  back_office: { temperature: 0.4 },          // redacción interna con guion fijo
  analisis: { temperature: 0.2 },             // dirección: cifras, poca prosa
  extraccion: { temperature: 0 },             // parseo determinístico
  marketing: { temperature: 0.7 },            // prosa con voz; cifras del guion
  codigo: { temperature: 0 },                 // hallazgos, no diffs
  codigo_escritura: { temperature: 0, reasoning: 'high' }, // el diff no se improvisa
  qa: { temperature: 0.3 },                   // adversarial, no caótico
};
