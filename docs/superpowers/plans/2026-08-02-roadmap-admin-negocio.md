# Roadmap de la consola de negocio de Likida (/admin)

Capturado la noche del 2-ago-2026, en tres tandas — cada una más grande que
la anterior. La última está explícitamente pensada para 10,000 clientes;
Likida tiene 1 tenant hoy (el demo). Este documento existe para no perder
nada de la visión sin fingir que se construye en una noche.

**Cómo leerlo:** cada punto dice si ya existe algo real en el código que se
le pueda enchufar, o si necesita infraestructura nueva desde cero (y cuál).

---

## Ya construido esta noche (2-ago-2026)

- `/admin` — consola separada del panel de cliente, gateada por `requireSuperadmin()`
- 5 roles reales con RLS probada contra la base (`superadmin`, `flota_admin`, `encargado`, `contador`, `operador`) — cierra buena parte del punto de RBAC de la Tanda 3
- Costo de IA real por fase/modelo/día (`llm_costo`), no de ejemplo
- Estado de conversaciones de WhatsApp (`wa_conversacion.estado`) — es máquina de estados, no historial de mensajes (Likida no guarda el texto)
- Chat de preguntas frecuentes contra el resumen ya calculado (sin NL-a-SQL en vivo, por seguridad)

---

## Tanda 1 — Observabilidad, agentes, logs, negocio, seguridad

| # | Pedido | Estado |
|---|---|---|
| 1.1 | Consumo de tokens en tiempo real | ✅ Real (`llm_costo`) — falta "tiempo real" (hoy es on-demand, no push) |
| 1.2 | Latencia por solicitud | ❌ No se registra duración de llamada. Necesita una columna nueva + instrumentar cada punto que llama al LLM |
| 1.3 | Tasa de éxito/error (4xx/5xx) | ⚠️ Vive en Sentry, ya conectado. No se reconstruye adentro de Likida — se enlaza |
| 1.4 | Costo por LLM | ✅ Real (`llm_costo.modelo`) |
| 2.1 | Versionado de prompts + playground | ❌ Los prompts son constantes en código (`src/lib/agents/prompts.ts`), sin historial. Necesita tabla de versiones + UI de edición + mecanismo de rollback |
| 2.2 | Asignación de herramientas por agente | ❌ No aplica al diseño actual: los "agentes" de Likida son fases fijas (OCR → cuadre), no agentes con tool-calling configurable |
| 2.3 | Memoria/contexto (vector stores) | ❌ Likida no tiene RAG ni vector store |
| 2.4 | Rate limiting configurable | ⚠️ Existe y es real (`ratelimit.ts`), pero los límites están en código, no son editables desde UI |
| 3.1 | Historial de conversaciones completo | ❌ No se guarda el texto de los mensajes de WhatsApp (decisión de privacidad ya tomada) |
| 3.2 | Trace logs (pasos del agente) | ❌ No se captura razonamiento paso a paso |
| 3.3 | Feedback 👍/👎 | ❌ No existe UI de calificación ni tabla que la reciba |
| 4.1 | Suscripciones y facturación | ❌ Sin integración de cobro (Stripe u otro) |
| 4.2 | RBAC de equipo | ✅ Construido esta noche |
| 4.3 | Gestión de API keys de cliente | ❌ Likida no expone API a clientes hoy |
| 5.1 | Filtros de moderación | ❌ Sin pipeline de moderación |
| 5.2 | Anonimización de PII | ⚠️ Existe `sanitizar.ts` (sanitiza texto de OCR), pero no hay panel que lo enseñe ni lo controle |

## Tanda 2 — La visión de "corazón del panel" (8 categorías)

| # | Pedido | Estado |
|---|---|---|
| 1 | Inbox con hilos + human handoff | ❌ **No encaja con el producto actual.** El bot de WhatsApp es una máquina de estados determinística (foto → OCR → confirmar → liquidar), no un agente conversacional abierto que se pueda "atorar". Human handoff resuelve un problema que Likida no tiene hoy — replantear si de verdad hace falta antes de construirlo |
| 2 | Prompts + versionado + rollback | Mismo que 2.1 arriba |
| 3 | Traces, latencia, alucinaciones, score de confianza, cola de feedback | Mismo que 1.2/3.2/3.3 — es AgentOps completo (Langfuse/LangSmith), semanas de trabajo |
| 4 | Costo y margen por conversación | ⚠️ Costo por viaje es calculable (`llm_costo.viaje_id`) — **margen no**, porque no hay dato de precio/plan por cliente en la base |
| 5 | Multi-tenant: alta, plan, número, uso vs. límite | ⚠️ Alta/nombre/plan ya existen (`tenant`); número de WhatsApp, límites y estado de cuenta no |
| 6 | WhatsApp: quality rating, plantillas, ventana 24h, opt-ins | ❌ Requiere integración con la Meta WhatsApp Business API — Likida no la tiene conectada para esto hoy |
| 7 | Facturación + CFDI + audit log + PII + roles | Roles ✅. El resto: ❌ (sin Stripe, sin tabla de audit log, sin motor de CFDI) |
| 8 | Uptime, error rate, alertas proactivas | Error rate → Sentry (enlazar). Uptime → Vercel ya lo mide (enlazar). Alertas proactivas → no configuradas |

## Tanda 3 — A escala de 10,000 clientes

| # | Pedido | Estado |
|---|---|---|
| 1 | Búsqueda instantánea, segmentación, **impersonation ("login as") con audit log** | ❌ Sin buscador, sin segmentación, sin impersonation. Impersonation es sensible: necesita su propio audit log desde el día 1, no se agrega después |
| 2 | Evals automáticos, drift, scoring por tenant, cola priorizada por impacto | ❌ AgentOps de nivel Braintrust/Galileo/Arize — evaluar esto es un producto en sí mismo |
| 3 | Unit economics: costo/margen por cliente, LTV, CAC, cohortes | ❌ Necesita datos de facturación real que no existen todavía |
| 4 | **Pool de números de WhatsApp** con quality rating, rotación, balanceo | ❌ Hoy Likida opera con UN número. Esto es infraestructura real de telecom/Meta, no una pantalla |
| 5 | MRR, churn, dunning, reconciliación con pasarela, CFDI | ❌ Depende 100% de tener facturación real primero |
| 6 | RBAC fino + audit log total + SSO/2FA | RBAC básico ✅. Audit log y SSO/2FA: ❌ |
| 7 | Analítica de producto: activación, retención, funnel, NPS | ❌ Sin instrumentación de producto todavía |
| 8 | Soporte: ticketing, macros, SLAs | ❌ No existe sistema de soporte |
| 9 | Fraude/abuso: spam, jailbreak, fuga de PII | ❌ Sin pipeline de detección. El prompt de `liquidacion.ts` ya tiene instrucciones anti-inyección (ver `prompts.ts`), pero eso es mitigación en el prompt, no detección ni alertas |
| 10 | Compliance LFPDPPP: ARCO, retención, borrado, trazabilidad | ❌ Sin estos flujos construidos. Dado que Likida roza datos fiscales/personales, esto sube de prioridad en cuanto haya un cliente real |
| 11 | SRE: p95/p99, status page, on-call | ❌ Sin instrumentación de latencia agregada ni status page |
| 12 | Feature flags, A/B testing, kill switches | ❌ Sin sistema de flags — hoy todo cambio es un deploy |

---

## Tanda 4 — Prompt completo de 20 páginas (3-ago-2026, madrugada)

El mensaje más detallado hasta ahora: un prompt tipo "pégalo en una carpeta
vacía" para construir el super-admin desde cero en **Vite + React Router +
Recharts + framer-motion + datos mock** (sin backend), con 20 páginas
(A–T: Overview, Model Ops, Conversaciones, Multi-tenant, Costos &
Facturación, Observabilidad, Calidad & Evals, RAG, Integraciones, WhatsApp
Infra, Crecimiento, Cobranza, Dev, SRE, RBAC/Auditoría, Analítica, Chatea
con tus Datos, Trust & Safety, Ejecutivo/Board, Playground).

**Decisión explícita del usuario, en el mismo mensaje: "RESPETA EL DISEÑO
QUE YA TENEMOS... Y SIGUE EL ESQUELETO CON NUESTRO ESTILO DE ESTO"** — el
prompt es un ÍNDICE de páginas y métricas a construir, NO una instrucción
de cambiar de stack. Se descarta explícitamente: Vite/React Router (queda
Next.js App Router), Recharts (quedan los SVG monocromos a mano de
`charts.tsx`, ya validados contra la skill de dataviz), y sobre todo los
**datos mock** — contradice directamente la regla de esta noche ("cifras
reales, no de ejemplo") que ya está probada en cada pantalla construida.

**Regla reforzada en el mismo hilo ("HAZ TODO SI NO HAY DATA AÚN QUE
SIRVA, PON AÚN SIN SUFICIENTES DATOS O UNA LEYENDA ASÍ"):** cualquier
página/métrica nueva de este roadmap que no tenga dato real detrás todavía
se construye con su fallback "Aún sin datos suficientes" (mismo patrón que
`Tendencia`, `Sin actividad de IA registrada`, y el nuevo bar chart de
facturas), NUNCA con un número inventado — esto aplica a las 20 páginas de
abajo, no solo a lo de esta noche.

El índice de navegación del prompt (INICIO · AGENTES · NEGOCIO ·
PLATAFORMA · CONTROL) es más completo que las Tandas 1–3 y las reemplaza
como referencia de qué existe en cada página — pero el estado real
("✅/⚠️/❌") de cada pieza sigue siendo el de las tablas de arriba, no
cambia solo porque el prompt lo liste de nuevo. Páginas nuevas que no
tenían tabla previa: Model Ops (2.1 de la Tanda 1, ahora con playground y
A/B de prompts), RAG (Tanda 1 punto 2.3 — Likida no tiene, ni lo necesita
hoy: no hay base de conocimiento por cliente), Trust & Safety (Tanda 1
punto 5, ahora con jailbreak/PII explícitos), Ejecutivo/Board (nuevo —
depende 100% de Fase 3, facturación real), Dev/calendario de
contribuciones (nuevo, cosmético — bajo riesgo, se puede construir en
Fase 1 con datos reales de `git log`/Vercel si algún día hace falta).

## Una lectura honesta

La mayoría de "❌" de la Tanda 3 solo tienen sentido **después** de tener
clientes reales pagando — construirlos antes es resolver problemas que
todavía no existen, a costa del tiempo que sí hace falta para conseguir el
primer cliente. Los "⚠️" (parcial) son donde más rinde invertir próximo: ya
hay un cimiento real, falta la capa de encima.

---

## Fases

Criterio de orden: primero lo que ya tiene cimiento real y bajo riesgo,
después lo que depende de tener un primer cliente pagando, al final lo que
solo importa a escala (10K). Cada fase es, más o menos, una sesión de
trabajo — no una noche.

### Fase 0 — Hecho (2-ago-2026)
- `/admin` gateada por rol, separada del panel de cliente
- 5 roles con RLS real (RBAC de la Tanda 1 punto 4.2 y Tanda 3 punto 6, parcial)
- Costo de IA real por fase/modelo/día, estado de conversaciones de WhatsApp, chat de preguntas frecuentes

### Fase 1 — Cerrar lo que ya tiene cimiento
- Latencia por llamada (instrumentar `llm_costo` con duración — schema + wiring)
- Enlazar Sentry (errores) y Vercel (uptime/deploys) directo desde `/admin`, en vez de reconstruirlos
- Panel de flotas con estado de cuenta: plan, uso vs. algún límite razonable (aunque el límite hoy sea arbitrario)
- Rate limits configurables desde UI (hoy están en código, `ratelimit.ts`)

### Fase 2 — Prompts y calidad, bajo riesgo alto valor
- Versionado de prompts + rollback (tabla de versiones + UI de edición)
- Panel de PII: enseñar lo que `sanitizar.ts` ya hace, no solo que exista
- Trace básico: qué fase corrió, con qué input/output, aunque sea sin scoring de calidad todavía

### Fase 3 — Cuando exista el primer cliente pagando
- Costo y margen real por cliente (necesita precio de plan en la base)
- Facturación: Stripe + CFDI si aplica, MRR/churn básico
- Audit log — empieza aquí porque cuanto antes exista, menos historia hay que reconstruir después

### Fase 4 — AgentOps serio
- Evals automáticos + detección de drift + scoring de calidad (Langfuse/Braintrust-equivalente)
- Cola de feedback 👍/👎 priorizada por impacto
- Detección de alucinaciones y respuestas fuera de tema

### Fase 5 — Escala (10K clientes)
- Búsqueda + segmentación + impersonation con audit log desde el día 1
- Pool de números de WhatsApp con quality rating y rotación
- SSO/2FA, soporte con SLAs, analítica de producto/NPS, feature flags y kill switches
- Compliance LFPDPPP completo (ARCO, retención, borrado) — sube de prioridad en cuanto haya un cliente real, no hace falta esperar a 10K para esa parte

**El punto 1 de la Tanda 2 (inbox con human handoff) no entra en ninguna
fase tal como está pedido** — antes de fasearlo hay que decidir si Likida
de verdad necesita ese patrón, dado que su bot no es un agente conversacional
abierto. Vale la pena una conversación aparte, no una fase.
