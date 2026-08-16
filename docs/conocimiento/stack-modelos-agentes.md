# El stack de modelos por agente — verificado el 16-ago-2026

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
| `analisis` | Copiloto del fundador (tools de dirección, ficha 360) | `z-ai/glm-5.2` (1M ctx) | 0.31 – 0.97 | `minimax/minimax-m3` | `LIKIDA_MODEL_ANALISIS` → candidatos: `kimi-k2-thinking` (0.60–2.50), `deepseek-v4-pro` (0.66–1.98) |
| `ocr` | Lectura de comprobantes del CLIENTE | Gemini (medido 4-ago) | — | Haiku 4.5 (visión) | `LIKIDA_MODEL_OCR` |
| `cuadre` | Conciliación con dinero del CLIENTE | Claude Sonnet 5 | 2 – 10 | GPT-5.6-terra | `LIKIDA_MODEL_CUADRE` |
| `chat` | Analista del CLIENTE | Gemini flash-lite | — | GPT-5.6-luna | `LIKIDA_MODEL_CHAT` |
| `chat_ligero` | Conserje del chat | gpt-5-nano | 0.05 – 0.40 | flash-lite | `LIKIDA_MODEL_CHAT_LIGERO` |

**El orquestador (runner) no usa modelo**: es determinista a propósito — las
reglas calculan (candados de kill switch, techo, backpressure), el LLM solo
redacta dentro del agente despachado. Ese es el diseño §4 del copiloto.

## Las dos fronteras que el precio no mueve

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
