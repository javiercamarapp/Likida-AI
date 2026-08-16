# El stack de modelos por agente — verificado el 16-ago-2026

REGLA FINAL DE JAVIER (16-ago-2026, y es la que manda sobre cualquier versión
anterior de este documento): **todo el stack que vive en este repo — defaults
Y fallbacks — es de proveedores USA** (OpenAI, incluidos sus open-weight;
Google; Anthropic). Cero exposición legal y la información de usuarios jamás
sale de esa jurisdicción. El piso de precio no se pierde: los open-weight de
OpenAI (gpt-oss-20b/120b) cuestan lo mismo que cualquier alternativa barata
del catálogo. Escalar o abaratar sigue siendo por variable de entorno, sin
deploy — y `src/lib/llm/models.ts` es la única fuente en código.

Los precios se verificaron ese día contra el catálogo público de OpenRouter —
**no** son de memoria; se re-verifican al cambiar cualquier default.
Descartados con dato ese día: gemini-3.7-flash ($0.38/$1.88 — no gana en
ningún rol), grok-4.6 ($2/$6), grok-4.20 ($1.25/$2.50, 2M ctx — solo para
contextos gigantes).

## La matriz (rol → modelo → por qué)

| Rol (`models.ts`) | Agente / uso | Default | $/M in–out | Fallback | Escalación (env) |
|---|---|---|---|---|---|
| `back_office` | Redactor C5, runner nivel 2, piezas internas, talento, alianzas | `openai/gpt-oss-120b` | 0.03 – 0.17 | flash-lite | `LIKIDA_MODEL_BACK_OFFICE` |
| `analisis` | Copiloto del fundador, financieros, dirección, legal, fundraising, automejora | `openai/gpt-5.6-luna` (1M ctx) | 0.10 – 0.60 | flash-lite | `LIKIDA_MODEL_ANALISIS` |
| `extraccion` | Cazador/enriquecedor: parsear y normalizar | `openai/gpt-oss-20b` | 0.03 – 0.13 | flash-lite | `LIKIDA_MODEL_EXTRACCION` |
| `marketing` | Contenido fiscal, lead magnet, SEO, guiones | `openai/gpt-5.6-luna` | 0.10 – 0.60 | flash-lite | `LIKIDA_MODEL_MARKETING` |
| `codigo` | Auditorías (HALLAZGOS, no diffs): auditor, migraciones, releases, rendimiento, seguridad, documentación | `openai/gpt-oss-120b` | 0.03 – 0.17 | flash-lite | `LIKIDA_MODEL_CODIGO` |
| `codigo_escritura` | TODO diff que se aplica al repo (pruebas, fixes) | `anthropic/claude-sonnet-5` | 2 – 10 | GPT-5.6-terra | `LIKIDA_MODEL_CODIGO_ESCRITURA` → opus-5 |
| `qa` | Vigilante de calidad + ejército QA (Fase 3) | `openai/gpt-oss-120b` | 0.03 – 0.17 | flash-lite | `LIKIDA_MODEL_QA` |
| `ocr` | Lectura de comprobantes del CLIENTE | Gemini (medido 4-ago) | — | Haiku 4.5 (visión) | `LIKIDA_MODEL_OCR` |
| `cuadre` | Conciliación con dinero del CLIENTE | Claude Sonnet 5 | 2 – 10 | GPT-5.6-terra | `LIKIDA_MODEL_CUADRE` |
| `chat` | Analista del CLIENTE | Gemini flash-lite | — | GPT-5.6-luna | `LIKIDA_MODEL_CHAT` |
| `chat_ligero` | Conserje del chat | gpt-5-nano | 0.05 – 0.40 | flash-lite | `LIKIDA_MODEL_CHAT_LIGERO` |

**El orquestador (runner) no usa modelo**: es determinista a propósito — las
reglas calculan (candados de kill switch, techo, backpressure), el LLM solo
redacta dentro del agente despachado. Ese es el diseño §4 del copiloto.

## Las CUATRO fronteras que el precio no mueve

0. **Proveedores (16-ago, la regla que manda)**: todo el stack del repo es de
   proveedores USA. Sin excepciones por precio.
1. **Escritura de código**: los auditores (`codigo`) y los testers (`qa`)
   **solo buscan errores, fallos, huecos y bugs** — cazan juntos, barato y en
   manada. Lo que encuentran se vuelve encargo y el FIX lo escribe
   `codigo_escritura` (Sonnet→Opus — "eso escala a mejores modelos"), con su
   diff a aprobación humana. Cazar barato en manada, arreglar caro y una vez.
2. **Soberanía fiscal**: RFC/CFDI/comprobantes del CLIENTE jamás pisan los
   roles baratos — se quedan en `ocr`/`cuadre`/`chat` con ZDR
   (`data_collection:'deny'` en cada llamada del gateway). Los roles
   `back_office`/`analisis` solo ven prospectos del censo público y métricas
   agregadas de Likida.
3. **Techo por agente**: `agente_definicion.presupuesto_dia_usd` + medición
   real en `agente_corrida.costo_usd` (0123). Un agente sin techo declarado
   no corre solo.

## La mejora diaria de código (suscripción, no API)

Pedido del 16-ago: "las auditorías de los modelos baratos que traigan
errores y bugs se les pasan a agentes de Claude Code y usan mi suscripción
para mejorar el código todos los días." El pipeline vive en
`scripts/mejora-diaria/` y corre por launchd a las 05:30:

1. `auditor.mjs` — el rol `codigo` (gpt-oss-120b, centavos) lee el ÁREA DEL
   DÍA (rotación semanal: llm→core→api→admin→dashboard→panel→migraciones) y
   produce hasta 5 hallazgos JSON. El registro `.mejora-diaria/registro.jsonl`
   evita reabrir lo ya visto.
2. `correr.sh` — cada hallazgo pasa a `claude -p` (LA SUSCRIPCIÓN de Javier,
   costo marginal $0) en el worktree AISLADO `likida-mejoras`: verifica el
   hallazgo (los baratos se equivocan — descarta con motivo), arregla mínimo
   + prueba, tsc + suites del área, commit y PR. Tope 3 fixes/día
   (`MEJORA_TOPE_DIA`) para no comerse la bolsa con la que Javier trabaja.
3. La aprobación es humana: el PR con el CI de 3 checks. NADA se mergea solo.

Kill switch: `touch .mejora-diaria/APAGADO`. El rol `codigo_escritura` por
API (Sonnet) queda de RESPALDO — el estimado de ~$45/mes del driver de costo
se va a $0 mientras el pipeline corra por suscripción.

## Automejora continua (ya es un agente)

Cada pieza aprobada-con-edición guarda el diff (`cuerpo` vs `cuerpo_final`,
0117): ese corpus es el insumo del agente `automejora` (0125, blueprint
`11-Alertas-y-Direccion/agente-automejora.md`) — analiza qué edita más
Javier, agrupa corridas fallidas por causa raíz y propone el ajuste de
prompt/proceso A LA COLA, como todo lo demás. Umbral: 5 casos por patrón.

## Cómo se escala (el runbook de 3 pasos)

1. Detectar: la calidad de las piezas cae (ediciones crecen) o el copiloto
   se equivoca en análisis.
2. Subir el env del rol (`LIKIDA_MODEL_*`) — sin deploy. Verificar que el
   modelo esté en `FALLBACK` y `PRICES` (openrouter.ts) o el respaldo/costo
   se apagan EN SILENCIO (gotcha 4-ago).
3. Medir una semana con `agente_corrida.costo_usd` y las ediciones; decidir
   quedarse o volver.

## El organigrama completo: 61 agentes, cada área con su modelo (0125)

Conteo oficial (00-Blueprint-Maestro/catalogo-de-agentes.md, actualizado
16-ago): **8 vivos con código** (los 7 del catálogo + el Redactor) **+ el
Copiloto y la Guardia A0 vivos como interfaz/reglas**, **~44 diseñados**
(blueprint sin código, sembrados en `agente_definicion` — /admin/agentes los
enseña como lo que son), y **3 propuestos sin blueprint** (redes sociales,
calificador de respuestas, WhatsApp comercial saliente — bloqueados por
decisión o trámite; NO se siembran: una fila sin diseño afirmaría uno).
Los 7 diseñados del 16-ago ("el sistema completo nivel YC") completaron los
departamentos que faltaban: **legal_compliance, talento, seguridad,
datos_instrumentacion, fundraising, automejora y alianzas**.

La asignación por TIPO DE ACCIÓN (columna `agente_definicion.modelo_rol`;
NULL = no usa modelo de texto):

| Área / tipo de acción | Agentes | Rol → modelo | $/M |
|---|---|---|---|
| Scrapers / extracción | cazador, enriquecedor | `extraccion` → gpt-oss-20b | 0.03–0.13 |
| Back office redacción | redactor✅, scorer, dossier, vigía, sdr, demo_prep, propuestas, soporte, onboarding×2, atención_faq, cobranza_saas, retención, talento, alianzas | `back_office` → gpt-oss-120b | 0.03–0.17 |
| Marketing / contenido | contenido_fiscal, lead_magnet, seo_distribucion | `marketing` → gpt-5.6-luna | 0.10–0.60 |
| Auditoría de código (HALLAZGOS, no diffs) | auditor_codigo, migraciones, releases, rendimiento, documentacion, seguridad | `codigo` → gpt-oss-120b | 0.03–0.17 |
| **ESCRITURA de código (diffs al repo)** | pruebas + todo agente que modifique código | `codigo_escritura` → **claude-sonnet-5** (escala a opus-5) | 2–10 |
| QA de agentes | vigilante_calidad + ejército QA (Fase 3) | `qa` → gpt-oss-120b | 0.03–0.17 |
| Financieros | analista_metricas, control_costos, tesoreria, cierre_mensual | `analisis` → gpt-5.6-luna | 0.10–0.60 |
| Dirección y gobierno | copiloto✅, orquestadores, kpi_whatsapp, desempeño, especialistas(8), exito_cliente, producto, legal_compliance, fundraising, automejora, datos_instrumentacion | `analisis` → gpt-5.6-luna | 0.10–0.60 |
| Dinero del CLIENTE | liquidacion✅ | `cuadre` → claude-sonnet-5 | 2–10 |
| Sin modelo de texto | facturas✅ (Playwright), cobranza✅ (plantillas), conductores✅, peajes✅ (parser), proveedores✅ (XML), ventas✅ (determinista), guardia✅ (reglas), visuales/video ×3 (Higgsfield vía likida-marketing) | NULL | $0 |

Por FASE del plan hacia el 90%: **F0** todos los diseñados corren con prompt
a mano · **F1 ✅** dirección (copiloto+guardia) · **F2 ✅** comercial
(redactor→cola, runner) · **F3** marketing + QA testers · **F4** éxito del
cliente + financieros · **F5** gobernanza + WhatsApp comercial (bloqueada
por Meta). Encender uno = fila a 'vivo' + motor despachable en el runner +
kill switch — los tres lugares de estandares-tecnicos §7-8.

## Stack de IMAGEN Y VIDEO (visuales, video_demo, video_marketing)

Estos tres agentes no usan el stack de texto: su matriz vive en **MARCA.md §5**
del repo (la fuente de verdad que leen likida-marketing y likida-post — la
ruta rota se arregló el 16-ago). Resumen: `nano_banana_2` (ilimitadas) para
piezas sin texto · `gpt_image_2` low/1k para texto quemado y para character/
sequence sheets (skill `sequence-sheet`) · Soul ID para identidad de cara ·
`seedance_2_0` std/480p→upscale para todo video (skills `producir-video` +
`prompt-video-ia`; narración ElevenLabs, jamás voz del modelo) · veo/kling
solo puntual, decidido con `costo-por-pieza`. El logo NUNCA se genera: se
compone el archivo oficial. Nada se publica sin aprobación de Javier.
