# El stack de modelos por agente — verificado el 16-ago-2026

Barrido COMPLETO del 16-ago (3ª pasada, pregunta directa de Javier — el más
barato CON tools de cada familia, precios de ese día):
mistral-nemo $0.02/$0.03 · gpt-oss-20b $0.03/$0.13 (open-weight de OpenAI) ·
qwen3.7-flash $0.03/$0.13 (1M ctx) · llama-3.1-8b $0.05/$0.08 ·
gemma-3-12b $0.05/$0.15 · glm-4.7-flash $0.06/$0.40 · deepseek-v4-flash
$0.06/$0.12 (1M) · **xiaomi/mimo-v2.5 $0.14/$0.28 (1M)** · minimax-m2.5
$0.22/$0.90 · claude-3-haiku $0.25/$1.25 · kimi-k2.6 $0.54/$2.28 ·
grok-build $1/$2. Descartados con dato: gemini-3.7-flash ($0.38/$1.88 — no
gana en ningún rol), grok-4.6 ($2/$6), grok-4.20 ($1.25/$2.50, 2M ctx —
solo para contextos gigantes). Candidatos vivos anotados: mimo-v2.5 (salida
más barata que Luna — probarlo si el copiloto se vuelve output-pesado) y
qwen3.7-flash (el piso absoluto con 1M ctx — ya es fallback del back
office).

Decisión de Javier (16-ago-2026): el back office y los agentes internos corren
sobre modelos abiertos/baratos ("chinos no pasa nada"), con escalación a un
modelo mejor **por variable de entorno, sin deploy**, cuando la calidad lo
pida. Los precios de abajo se verificaron ese día contra el catálogo público
de OpenRouter — **no** son de memoria; se re-verifican al cambiar cualquier
default (`src/lib/llm/models.ts` es la única fuente en código).

## La matriz (rol → modelo → por qué)

| Rol (`models.ts`) | Agente / uso | Default | $/M in–out | Fallback | Escalación (env) |
|---|---|---|---|---|---|
| `back_office` | Redactor C5, runner nivel 2, piezas internas | `deepseek/deepseek-v4-flash` | 0.061 – 0.123 | `z-ai/glm-4.7-flash` → `qwen/qwen3.7-flash` | `LIKIDA_MODEL_BACK_OFFICE` |
| `analisis` | Copiloto del fundador (tools de dirección, ficha 360) | `openai/gpt-5.6-luna` (1M ctx) | 0.10 – 0.60 | `z-ai/glm-5.2` → `minimax-m3` | `LIKIDA_MODEL_ANALISIS` → candidatos: `kimi-k2-thinking` (0.60–2.50), `deepseek-v4-pro` (0.66–1.98) |
| `ocr` | Lectura de comprobantes del CLIENTE | Gemini (medido 4-ago) | — | Haiku 4.5 (visión) | `LIKIDA_MODEL_OCR` |
| `cuadre` | Conciliación con dinero del CLIENTE | Claude Sonnet 5 | 2 – 10 | GPT-5.6-terra | `LIKIDA_MODEL_CUADRE` |
| `chat` | Analista del CLIENTE | Gemini flash-lite | — | GPT-5.6-luna | `LIKIDA_MODEL_CHAT` |
| `chat_ligero` | Conserje del chat | gpt-5-nano | 0.05 – 0.40 | flash-lite | `LIKIDA_MODEL_CHAT_LIGERO` |

**El orquestador (runner) no usa modelo**: es determinista a propósito — las
reglas calculan (candados de kill switch, techo, backpressure), el LLM solo
redacta dentro del agente despachado. Ese es el diseño §4 del copiloto.

## Las TRES fronteras que el precio no mueve

0. **Escritura de código (16-ago)**: auditar con chinos está bien; **modificar
   el código únicamente con modelos USA**, escalando a los mejores (Sonnet→
   Opus). La línea operativa: si el output del agente es un DIFF que se
   aplica al repo → `codigo_escritura`; si es un reporte de hallazgos →
   `codigo`. Y el diff, como todo, pasa por aprobación humana.


1. **Soberanía fiscal**: RFC/CFDI/comprobantes del CLIENTE jamás pisan los
   roles baratos — se quedan en `ocr`/`cuadre`/`chat` (proveedores US con
   ZDR). Los roles `back_office`/`analisis` solo ven prospectos del censo
   público y métricas agregadas de Likida.
2. **Techo por agente**: `agente_definicion.presupuesto_dia_usd` + medición
   real en `agente_corrida.costo_usd` (0123). Un agente sin techo declarado
   no corre solo.

## Automejora continua (el gancho ya existe)

Cada pieza aprobada-con-edición guarda el diff (`cuerpo` vs `cuerpo_final`,
0117): ese corpus es el insumo de `aprendizaje-de-respuestas.md` — cuando
haya volumen, una corrida del runner analiza qué edita más Javier y propone
el ajuste de guion, A LA COLA como todo lo demás.

## Cómo se escala (el runbook de 3 pasos)

1. Detectar: la calidad de las piezas cae (ediciones crecen) o el copiloto
   se equivoca en análisis.
2. Subir el env del rol (`LIKIDA_MODEL_*`) al candidato de la tabla — sin
   deploy. Verificar que el modelo esté en `FALLBACK` y `PRICES`
   (openrouter.ts) o el respaldo/costo se apagan EN SILENCIO (gotcha 4-ago).
3. Medir una semana con `agente_corrida.costo_usd` y las ediciones; decidir
   quedarse o volver.

## El organigrama completo: 54 agentes, cada área con su modelo (0125)

Conteo oficial del catálogo (00-Blueprint-Maestro/catalogo-de-agentes.md) +
lo que cambió HOY: **8 vivos con código** (los 7 del catálogo + el Redactor,
que pasó de diseñado a vivo el 16-ago) **+ el Copiloto y la Guardia A0 vivos
como interfaz/reglas**, **~37 diseñados** (blueprint sin código, sembrados en
`agente_definicion` por la 0125 — /admin/agentes los enseña como lo que son)
y **3 propuestos sin blueprint** (redes sociales, calificador de respuestas,
WhatsApp comercial saliente — bloqueados por decisión o trámite; NO se
siembran: una fila sin diseño afirmaría uno).

La asignación por TIPO DE ACCIÓN (columna `agente_definicion.modelo_rol`;
NULL = no usa modelo de texto):

| Área / tipo de acción | Agentes | Rol → modelo | $/M |
|---|---|---|---|
| Scrapers / extracción | cazador, enriquecedor | `extraccion` → qwen3.7-flash | 0.03–0.13 |
| Back office redacción | redactor✅, scorer, dossier, vigía, sdr, demo_prep, propuestas, soporte, onboarding×2, atención_faq, cobranza_saas, retención | `back_office` → deepseek-v4-flash | 0.061–0.123 |
| Marketing / contenido | contenido_fiscal, lead_magnet, seo_distribucion | `marketing` → kimi-k2.6 | 0.54–2.28 |
| Auditoría de código (HALLAZGOS, no diffs) | auditor_codigo, migraciones, releases, rendimiento, documentacion | `codigo` → qwen3-coder-next | 0.12–0.80 |
| **ESCRITURA de código (diffs al repo)** | pruebas + todo agente que modifique código | `codigo_escritura` → **claude-sonnet-5, SOLO USA** (escala a opus-5) | 2–10 |
| QA de agentes | vigilante_calidad + ejército QA (Fase 3) | `qa` → gpt-oss-120b | 0.03–0.17 |
| Financieros | analista_metricas, control_costos, tesoreria, cierre_mensual | `analisis` → gpt-5.6-luna | 0.10–0.60 |
| Dirección | copiloto✅, orquestadores, kpi_whatsapp, desempeño, especialistas(8), exito_cliente, producto | `analisis` → gpt-5.6-luna | 0.10–0.60 |
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
