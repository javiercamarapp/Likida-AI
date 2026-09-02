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
//   datos personales. Todo lo que lleve RFC/CFDI va SOLO a proveedores US/EU.
//   Lo que el gateway HACE (openrouter.ts): pedir en cada llamada
//   `provider: { data_collection: 'deny' }`, que es una PREFERENCIA DE RUTEO
//   —OpenRouter enruta solo a proveedores que declaran no entrenar ni retener
//   con los prompts—. NO es Zero Data Retention: ZDR se contrata por
//   organización con cada proveedor, no se activa con una bandera por llamada,
//   y nadie lo ha firmado con OpenRouter (anexo de subencargados, pendiente #3;
//   docs/conocimiento/11-datos-personales.md §ZDR). El aviso de privacidad ya
//   dice exactamente eso (auditoría 8) y este comentario dice lo mismo desde la
//   auditoría 18 (B7): la justificación interna no puede prometer más que el
//   texto que lee el titular. REGLA (16-ago-2026): TODO el stack de este repo
//   — defaults y fallbacks — es de proveedores USA. Sin excepciones por precio.
//
// 🔌 PLAN B DEMO: OpenRouter es punto único de falla (caídas ago-2025, feb-2026).
//   Para el demo en vivo, tener keys directas de Google/Anthropic como respaldo.
// ═══════════════════════════════════════════════════════════════════════════

import { envPuesta } from '../env';

export type ModelRole = 'ocr' | 'cuadre' | 'cuadre_fallback' | 'chat' | 'back_office' | 'analisis' | 'extraccion' | 'marketing' | 'codigo' | 'codigo_escritura' | 'qa' | 'piloto' | 'transcripcion' | 'contador';

const DEFAULTS: Record<ModelRole, string> = {
  // OCR de comprobantes (visión + JSON en una sola llamada).
  //
  // MEDIDO EL 4-AGO-2026 CONTRA 18 COMPROBANTES REALES, dos corridas:
  // `gemini-3.1-flash-lite` GANA a `gemini-3.6-flash` en las tres métricas
  // —legibles 14-15 vs 13-14, montos 14-15 vs 13-14, folios 13-14 vs 10-12— y
  // cuesta 12.5× MENOS ($0.0015 vs $0.0188 por comprobante).
  //
  // De dónde sale la diferencia: el 3.6 emite ~1,500 tokens de salida
  // (razonamiento que se cobra) y el lite ~274. Y el sesgo del experimento
  // FAVORECÍA al 3.6, porque los valores asentados los produjo él en
  // producción; aun así perdió. Son 18 comprobantes: pocos para cerrar el tema,
  // suficientes para no dejar al perdedor de default.
  //
  // 23-AGO-2026: EL DEFAULT SE INVIERTE. Antes era 3.6-flash y el lite vivía
  // solo en `LIKIDA_MODEL_OCR` de Vercel — es decir, el modelo que de verdad
  // corría no estaba en el código. El argumento original (que revertir cueste
  // una variable y no un despliegue) SE CONSERVA intacto: la variable sigue
  // ahí, y apuntarla a 3.6-flash devuelve el comportamiento anterior sin tocar
  // el repo. Lo único que cambia es hacia dónde se cae cuando la variable NO
  // está puesta.
  //
  // Y esa caída es el problema: `envPuesta` es falso si la variable se borra,
  // se vacía o queda con un marcador, y entonces NADA falla — el OCR sigue
  // leyendo, nadie se entera, y cada comprobante pasa a costar 12.5× más. A
  // 506,000 comprobantes/mes son $759 → $9,513: seis cifras al año que no
  // disparan ninguna alerta. Fallar hacia lo caro y silencioso es peor que
  // fallar hacia lo barato y medido.
  ocr: 'google/gemini-3.1-flash-lite',
  // Cerebro de conciliación. Sonnet 5 (30-jun-2026): mejor que 4.5 en todo.
  // Precio $2/$10. El aumento a $3/$15 que estaba anunciado para el 1-sep-2026
  // FUE CANCELADO (verificado en la documentación de Anthropic el 23-ago): ese
  // precio es ahora el estándar. No hay reloj que vigilar aquí.
  cuadre: 'anthropic/claude-sonnet-5',
  // Escalación por baja confianza / monto alto / caso ambiguo. Opus 5 (24-jul):
  // #1 del Intelligence Index. Solo se dispara, no es el default de cada cuadre.
  cuadre_fallback: 'anthropic/claude-opus-5',
  // Chat de alto volumen con el operador (español MX, latencia baja).
  chat: 'google/gemini-3.5-flash-lite',
  // Clasificador de intención por mensaje entrante.
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
  codigo_escritura: 'anthropic/claude-sonnet-5', // $2/$10
  // QA / TESTERS (vigilante de calidad, ejército QA de Fase 3): juicio
  // adversarial barato — razonamiento por centavos, mismo modelo que la
  // auditoría: cazan juntos.
  qa: 'openai/gpt-oss-120b',                   // $0.03/$0.17
  // PILOTO DE VISIÓN (portales de facturación sin adaptador escrito): mira la
  // pantalla del portal y decide la SIGUIENTE acción del navegador. Sonnet 5 y
  // no un modelo barato a propósito: cada acción toca un formulario fiscal
  // real, y el techo de daño lo pone el código (el piloto no emite nunca, ver
  // piloto_vision.ts), pero un selector mal elegido quema una corrida entera.
  // Se paga por PASO (~8-14 por portal), solo cuando FACTURACION_PILOTO=si.
  piloto: 'anthropic/claude-sonnet-5',         // $2/$10
  // TRANSCRIPCIÓN de notas de voz de WhatsApp (Capa E1 de asistencia). El
  // mismo Gemini barato del chat y no un servicio de voz aparte: acepta el
  // OGG/Opus que manda Meta, transcribe español mexicano coloquial, y viaja
  // por la MISMA cuenta OpenRouter con el mismo presupuesto por tenant que el
  // OCR — cero proveedores nuevos, cero API keys nuevas. OJO con el override:
  // el fallback de red (openrouter.ts) puede caer a un modelo SIN oído
  // (Anthropic no recibe audio); ahí la llamada falla y el chofer recibe el
  // "¿me lo escribes?" honesto — fallar hacia pedir texto, no hacia inventar.
  transcripcion: 'google/gemini-3.5-flash-lite', // $0.3/$2.5
  // EL CONTADOR (E.26, fase 2 de EVALOPS): el experto fiscal que responde a
  // un contralor con el corpus de fichas de normas/ en el prompt. Sonnet 5 y
  // no un modelo barato por la misma razón que el cuadre: calidad de frontera
  // DONDE un error cuesta dinero — aquí cada respuesta es una opinión fiscal
  // con consecuencias económicas. El corpus (~45k tokens) viaja idéntico en
  // cada pregunta, así que la caché de prompt de Anthropic (misma palanca del
  // cuadre) deja la corrida de 32 preguntas en el orden de lo presupuestado
  // en 22-evaluacion.md, no en el de una corrida sin caché.
  contador: 'anthropic/claude-sonnet-5',        // $2/$10 (lectura de caché al 10%)

  // ── QUÉ ROL CORRE HOY Y CUÁL NO (verificado el 23-ago-2026) ──────────────
  // Tienen llamador en producción: ocr, cuadre, chat, analisis, marketing,
  // back_office, piloto. `contador` tiene llamador pero NO tráfico de
  // producción: es el examinado del examen dorado (scripts/evals/
  // correr-contador.ts, E.26) — se paga solo cuando el examen se corre a mano.
  //
  // RESERVADOS — declarados a propósito, todavía sin nadie que los pida:
  //   · cuadre_fallback  la escalación por baja confianza / monto alto está
  //                      decidida pero NO cableada: nada la dispara aún.
  //   · extraccion, codigo, codigo_escritura, qa  son de los agentes del
  //                      catálogo que siguen en 'disenado' (ver
  //                      docs/conocimiento/stack-modelos-agentes.md).
  // No se borran porque la decisión de qué modelo les toca ya está tomada y
  // documentada; borrarlas obligaría a volver a tomarla.
  //
  // RETIRADOS el 23-ago-2026, no volver a añadirlos sin llamador:
  //   · chat_ligero  el conserje del chat del panel se colapsó el 12-ago.
  //   · router       la clasificación de mensajes es 100% regex; el agente
  //                  `orchestrator` que lo pedía nunca llegó a ejecutarse
  //                  (el único runAgent del repo pide `liquidacion`).
};

const ENV_KEY: Record<ModelRole, string> = {
  ocr: 'LIKIDA_MODEL_OCR',
  cuadre: 'LIKIDA_MODEL_CUADRE',
  cuadre_fallback: 'LIKIDA_MODEL_CUADRE_FALLBACK',
  chat: 'LIKIDA_MODEL_CHAT',
  back_office: 'LIKIDA_MODEL_BACK_OFFICE',
  analisis: 'LIKIDA_MODEL_ANALISIS',
  extraccion: 'LIKIDA_MODEL_EXTRACCION',
  marketing: 'LIKIDA_MODEL_MARKETING',
  codigo: 'LIKIDA_MODEL_CODIGO',
  codigo_escritura: 'LIKIDA_MODEL_CODIGO_ESCRITURA',
  qa: 'LIKIDA_MODEL_QA',
  piloto: 'LIKIDA_MODEL_PILOTO',
  transcripcion: 'LIKIDA_MODEL_TRANSCRIPCION',
  contador: 'LIKIDA_MODEL_CONTADOR',
};

/** Devuelve el slug del modelo para un rol, respetando override por env.
 *
 * AUDITORÍA 1, CRÍTICO (Operabilidad): un override MARCADOR es truthy pero NO
 * es un slug. El 20-ago `LIKIDA_MODEL_OCR` quedó en "[SENSITIVE]" (el enmascarado
 * de Vercel re-guardado) y `|| DEFAULTS` no lo atrapó: OpenRouter recibió
 * "[SENSITIVE]" como modelo → 400 → el OCR facturó cero durante horas. `envPuesta`
 * rechaza el marcador y cae al default, que sí es un slug real. */
export function modelFor(role: ModelRole): string {
  return envPuesta(ENV_KEY[role]) ? (process.env[ENV_KEY[role]] as string) : DEFAULTS[role];
}

/** Parámetros por defecto por rol (esfuerzo de razonamiento, temperatura). */
export const ROLE_PARAMS: Record<ModelRole, { temperature: number; reasoning?: 'low' | 'medium' | 'high' }> = {
  ocr: { temperature: 0 },                    // extracción determinística
  cuadre: { temperature: 0, reasoning: 'high' }, // razonamiento profundo donde importa
  cuadre_fallback: { temperature: 0, reasoning: 'high' },
  chat: { temperature: 0.4 },                 // tono natural
  back_office: { temperature: 0.4 },          // redacción interna con guion fijo
  analisis: { temperature: 0.2 },             // dirección: cifras, poca prosa
  extraccion: { temperature: 0 },             // parseo determinístico
  marketing: { temperature: 0.7 },            // prosa con voz; cifras del guion
  codigo: { temperature: 0 },                 // hallazgos, no diffs
  codigo_escritura: { temperature: 0, reasoning: 'high' }, // el diff no se improvisa
  qa: { temperature: 0.3 },                   // adversarial, no caótico
  piloto: { temperature: 0 },                 // un formulario fiscal no se improvisa
  transcripcion: { temperature: 0 },          // se escribe lo que se oye, no se redacta
  contador: { temperature: 0 },               // una opinión fiscal no se improvisa
};

// ═══════════════════════════════════════════════════════════════════════════
// COSTOS UNITARIOS PARA DIMENSIONAR TOPES (auditoría 24, TC-N1 / WA-1 / ARQ-2).
//
// Son las cifras que este mismo archivo y `docs/escala-15k.md` ya citan en
// prosa; aquí viven como números para que un tope se DERIVE de ellas en vez
// de copiarlas a mano. No son precios de proveedor (eso es `PRICES` en
// openrouter.ts): son lo que una operación completa le cuesta al tenant.
//
//   · `comprobanteOcr`  medido el 4-ago-2026 contra 18 comprobantes reales con
//                       `gemini-3.1-flash-lite` (arriba, rol `ocr`): $0.0015-0.0016.
//   · `liquidacion`     la banda alta de la arquitectura (jul-2026, cabecera):
//                       $0.03-0.05 por liquidación con Sonnet en el cuadre.
//   · `fotosPorViaje`   el supuesto central de escala-15k.md (2-4 fotos/viaje).
//   · `viajeCompleto`   cuadre + OCR de sus fotos: lo que cuesta liquidar UN
//                       viaje de punta a punta. Con 500 viajes/día son ~$27,
//                       que es justo la cifra con la que la auditoría 24 mostró
//                       que el techo global de $5/día se agotaba a media mañana.
//   · `corridaAgenteSinMedir`  lo que se le CARGA a una corrida de agente de
//                       fondo cuyo proveedor omitió `usage` (ARQ-2/AGB-9): un
//                       costo no medido no es cero, y el techo diario tiene que
//                       contarla con algo. Es la banda alta de una liquidación
//                       —la llamada más cara del repo— a propósito: sobreestimar
//                       corta antes; subestimar deja gastar sin freno.
// ═══════════════════════════════════════════════════════════════════════════
const COMPROBANTE_OCR_USD = 0.0016;
const LIQUIDACION_USD = 0.05;
const FOTOS_POR_VIAJE = 3;

export const COSTO_ESTIMADO_USD = {
  comprobanteOcr: COMPROBANTE_OCR_USD,
  liquidacion: LIQUIDACION_USD,
  fotosPorViaje: FOTOS_POR_VIAJE,
  viajeCompleto: Number((LIQUIDACION_USD + FOTOS_POR_VIAJE * COMPROBANTE_OCR_USD).toFixed(6)),
  corridaAgenteSinMedir: LIQUIDACION_USD,
} as const;
