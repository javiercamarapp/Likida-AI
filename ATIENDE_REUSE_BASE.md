# ATIENDE → CUADRA — Mapa maestro de reuso

Análisis del código real de `atiende.ai` (Next.js 16 · Supabase · OpenRouter · 1,095 archivos).
Conclusión: **atiende ya resolvió ~70% de la plomería de Cuadra con calidad de producción.**
Tomamos el motor y el chasis; dejamos el cerebro médico.

---

## 🏆 Las 3 joyas a copiar casi verbatim

### 1. `src/lib/llm/openrouter.ts` — el MOTOR LLM (copiar, solo cambiar el mapa de modelos)
Gateway model-agnostic sobre la API OpenAI-compatible de OpenRouter. Trae, ya probado:
- **`generateWithTools()`** — el ciclo agéntico COMPLETO: llama al modelo con tools → ejecuta → re-inyecta resultados → repite hasta texto final. Incluye:
  - **loop-guard** (`maxToolRounds`, default 5) contra bucles infinitos,
  - **dedup** de tool-calls (cache cross-round para read-only `get_/check_/list_`; in-round para todas),
  - **`PartialExecutionError`** — si el primario ya ejecutó una mutación y luego truena, el fallback NO la re-ejecuta (crítico para no duplicar liquidaciones),
  - **`AbortSignal`** para cancelar requests HTTP al dispararse el timeout.
- **`generateStructured<T>()`** — salida JSON **garantizada por schema** (Zod → JSON-schema `strict:true`) con escalera de reintentos: primario → primario+corrección → fallback → fallback+corrección. **Esto es el corazón del OCR (extraer comprobante tipado) y del cuadre (veredicto estructurado).**
- **`generateResponse()`** — chat simple con **fallback cross-provider automático** en errores transient (5xx/timeout/rate-limit) → el operador nunca ve un error de proveedor.
- **`calculateCost()`** + cache de precios hidratado por cron desde OpenRouter → tracking de costo por request.
- **`provider: { data_collection: 'deny' }`** en cada llamada → OpenRouter rutea solo a providers que no retienen input (compliance de datos fiscales sensibles — nos sirve igual).

**Cambio para Cuadra:** reemplazar el mapa `MODELS` y la función `selectModel()` (hoy con reglas médicas) por el stack híbrido de Cuadra (abajo). Todo lo demás se reusa TAL CUAL.

### 2. `src/lib/llm/tool-executor.ts` — el REGISTRO DE TOOLS (copiar la infraestructura)
- Patrón: cada tool hace `registerTool(name, { schema, handler, isMutation? })` al importarse. Registry = Map en memoria, se rehidrata en cold-start al importar los módulos de tools.
- **`ToolContext`** inyecta `{ tenantId, contactId, conversationId, customerPhone, tenant, signal }` a cada handler → las tools hacen queries scoped SIN que el LLM pase IDs (más seguro, menos tokens).
- **`executeTool`** mide tiempo, captura excepciones (nunca tumba el loop), y aplica **idempotencia de mutaciones vía Redis** (TTL 60s) — otra capa anti-duplicado.
- Chequeo `TENANT_MISMATCH` en cada tool → aislamiento multi-tenant a nivel herramienta.

**Cambio para Cuadra:** se reusa el archivo completo; solo cambian los `registerTool(...)` concretos (nuestras tools de liquidación).

### 3. El patrón AGENTE = CARPETA (`src/lib/agents/`)
- `types.ts`: `AgentConfig = { name, model, description, tools: string[], systemPromptKey }` + `TenantContext`.
- `registry.ts`: `AGENT_REGISTRY: Record<AgentName, AgentConfig>` — fuente única de qué agentes existen, con qué modelo y qué tools.
- Cada agente = carpeta con `index.ts` + `tools.ts` (patrón visto en `cobranza/`, `agenda/`).
- El `orchestrator` rutea al sub-agente; cada agente corre `generateWithTools` con SUS tools y su prompt (`getSystemPrompt(agentName, ctx)`).

**Cambio para Cuadra:** un solo agente nuevo, **`liquidacion`** (abajo la receta), en vez de los ~18 agentes médicos.

---

## 🧩 Mapa de reuso por subsistema

| Subsistema | Rutas atiende | Acción |
|---|---|---|
| **Motor LLM** | `src/lib/llm/openrouter.ts`, `tool-executor.ts`, `circuit-breaker.ts`, `rate-limiter.ts`, `safe-fetch.ts` | ✅ **Copiar** (swap MODELS) |
| **Framework agentes** | `src/lib/agents/{types,registry,index,orchestrator-prompt}.ts` | 🔧 Adaptar (1 agente) |
| **WhatsApp Cloud API** | `src/app/api/webhook/whatsapp/route.ts`, `src/lib/meta/{whatsapp-cloud,webhook-verify}.ts`, `src/lib/whatsapp/send.ts` | ✅ Copiar (HMAC, verify, replay-guard, envío) |
| **Ingesta de imágenes** | `src/lib/whatsapp/media-processor.ts` | 🔧 **Adaptar** — ya descarga binarios de Meta y hace visión; cambiar prompt/modelo a "extraer comprobante" |
| **Pipeline entrante** | `src/lib/whatsapp/{processor,inbound-upsert,conversation-lock,normalize-phone}.ts` | 🔧 Adaptar |
| **Colas / async** | `src/lib/queue/qstash.ts`, `src/inngest/` | ✅ Copiar |
| **Observabilidad** | `src/lib/observability/*` (Sentry, tracing, **redacción PII**) | ✅ Copiar (PII redact sirve para datos fiscales) |
| **Guardrails** | `src/lib/guardrails/{input-guard,validate}.ts` | ✅ Copiar (genéricos); `llm-judge` opcional |
| **Export** | `src/lib/export/csv.ts` | ✅ Copiar (export a ERP) |
| **DB** | `src/lib/supabase/*`, patrón `repositories/` | ✅ Copiar |
| **RAG** | `src/lib/rag/search.ts` | 🔧 Adaptar (RAG de política de gastos) |
| **Cerebro médico** | agentes clínicos, `telemedicine/`, `calendar/`, `verticals/`, `knowledge/`, rutas `telemed/book/portal` médicas | 🗑️ **Descartar** |

---

## 🤖 Receta: construir el agente `liquidacion` de Cuadra

**1. Entrada en el registry** (`src/lib/agents/registry.ts`):
```ts
liquidacion: {
  name: 'liquidacion',
  model: MODELS.CUADRE,              // Claude Sonnet (razonamiento con dinero)
  description: 'Recibe comprobantes del operador, cuadra vs anticipo+política, detecta diferencias',
  tools: ['extraer_comprobante','consultar_politica','validar_cfdi','cuadrar_viaje','guardar_liquidacion'],
  systemPromptKey: 'liquidacion',
}
```

**2. Tools** (`src/lib/cuadra/**/tools.ts`, patrón `registerTool` de `cobranza/tools.ts`):
| Tool | Qué hace | Modelo/impl |
|---|---|---|
| `extraer_comprobante` | OCR de la foto → JSON tipado (`generateStructured`) | **Gemini 3 Flash** (visión) + decode QR CFDI |
| `consultar_politica` | Lee la política de gastos del tenant (topes por concepto/ruta) | RAG / query directa |
| `validar_cfdi` | Valida CFDI: **decodifica el QR** (UUID/RFC/total) + regex RFC + facturapi | determinístico + facturapi |
| `cuadrar_viaje` | Compara gastos vs anticipo vs política → diferencias/faltantes | reglas + razonamiento |
| `guardar_liquidacion` | Persiste liquidación, dispara PDF (Módulo 3 ✅ ya hecho) | Supabase + `pdf.ts` |

Todas reciben `ToolContext` (tenantId scoping) y las mutaciones (`guardar_liquidacion`) van con `isMutation:true` → idempotencia Redis.

**3. Prompt** (`orchestrator-prompt.ts`, key `liquidacion`): guía al operador en español MX a mandar sus comprobantes y explica el resultado del cuadre.

---

## 🎯 Stack de modelos de Cuadra (reemplaza el mapa `MODELS` de atiende)

Fundamentado en los 4 benchmarks (τ²-bench, OCR Arena, español, precio). Ver `src/lib/llm/models.ts`.

| Rol (en MODELS) | Modelo | Fundamento |
|---|---|---|
| `OCR` | **Gemini 3 Flash** ($0.50/$3) | #1 OCR Arena en recibos ruidosos ES + el más barato. **+ decode del QR CFDI** (no OCR del UUID) |
| `CUADRE` | **Claude Sonnet 5** ($3/$15) | élite en tool-use multi-turno bajo política (τ²-bench); donde un error cuesta dinero |
| `CUADRE_FALLBACK` | **Claude Opus 4.x** ($5/$25) | escalación por baja confianza / monto alto / demo cliente_demo |
| `CHAT` | **Gemini 3 Flash-Lite** | mejor español barato + baja latencia |
| `ROUTER` | **Gemini 3 Flash-Lite** | clasificación de una línea, centavos |
| Valor/escala | **GLM-4.6 (Exacto)** open-weight | caballo negro: casi-frontera en agentic a fracción del precio |

**Costo estimado:** ~$0.05 / liquidación (con prompt-caching de la política). Nota clave del benchmark de soporte: para el JSON **garantizado por schema**, OpenAI/Gemini dan la garantía dura; si OpenRouter degrada el `response_format`, llamar directo al proveedor en `cuadrar_viaje`.

---

## 🗑️ Peso muerto a NO traer
Agentes clínicos (agenda, no-show, medicamento, triaje, pharmacovigilance, post-consulta, encuesta, doctor-profile, treatment-coach, retencion, reputacion, intake médico), `src/lib/telemedicine/`, `calendar/`, `verticals/`, `knowledge/` médico, y las rutas de app médicas. Traer el chasis, dejar el cerebro médico.

---

## 🖥️ Frontend, datos y auth (multi-tenant)

> ⚠️ **`schema.sql` está desactualizado.** El schema vivo son ~80 migraciones en
> `supabase/migrations/*.sql`. Leer esas como verdad, no el `schema.sql` raíz.

### Multi-tenant + RLS (copiar el patrón 1:1)
El aislamiento vive en **Postgres, no en el código**:
- `get_user_tenant_ids()` `SECURITY DEFINER` → `UUID[]` (soporta 1 dueño con varias flotas; devuelve `ARRAY[]`, **nunca NULL** → no rompe el aislamiento).
- Toda tabla de dominio: `tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE` + índice + policy uniforme:
  ```sql
  CREATE POLICY "tenant_data" ON <tabla> FOR ALL
    USING (tenant_id = ANY(get_user_tenant_ids()))
    WITH CHECK (tenant_id = ANY(get_user_tenant_ids()));
  ```
- Bypass controlado con `supabaseAdmin` (service-role) SOLO en webhooks/portal, re-imponiendo `.eq('tenant_id', …)` a mano.
- **RLS per-operador** dentro del tenant (patrón `fase6_per_doctor_rls.sql`) → un operador solo ve SUS liquidaciones.

### Auth — copiar casi íntegro (editar enums)
Supabase Auth SSR por cookies. Reusar tal cual: `src/lib/supabase/{server,client,admin}.ts`, `src/middleware.ts` (refresh de sesión + CSP nonce + CSRF en `/api/*`), `src/lib/auth/current-staff.ts` (RBAC roles/planes + feature-flags), `is-admin.ts` (gate del super-admin), **`aal-check.ts` (MFA step-up)** → exigir `requireAal2()` para **autorizar una liquidación/pago** (muy relevante). Solo cambiar el enum de roles a `owner · admin_flota · contador · operador` y el mapa de planes.

### Route groups (copiar la organización)
- **`(auth)/`** — login, register, reset, mfa, accept-invite → tal cual.
- **`(dashboard)/`** — el producto del cliente (flota): viajes, liquidaciones, conciliaciones, operadores, reportes. Layout con `Sidebar` + `Header` + `BottomTabBar` colapsables.
- **`(admin)/admin/`** — panel interno "Javier-only" (doble gate RBAC + rate-limit + audit): tenants, analytics, costos LLM, prompts, agents.
- **`portal/[token]`** — 🏆 **el mejor hallazgo:** portal **sin login**, autenticado por **token HMAC firmado** (`src/lib/portal/token.ts`, TTL 7d, sin PII, revocable). = el operador recibe por WhatsApp un link firmado para ver/confirmar su liquidación **sin crear cuenta.** Reusable tal cual.

### Design system — 🍎 YA es Apple-style (solo reescribir tokens)
`globals.css` se autodescribe como *"Premium Design System (Apple-style monochrome + glass)"*: Tailwind **v4 CSS-based** (no hay `tailwind.config.ts`; theming en `globals.css`), shadcn **new-york**, base **zinc**, `.glass`/`.glass-subtle` (backdrop-blur), `animate-element` (fade+blur sutil), `--radius: .75rem`, hairlines de 1px.
- **Reusar los 30 componentes `ui/`** (button, card, table, dialog, sheet, tabs, badge, skeleton, sonner…) y los `dashboard/` genéricos (stat-card, kpi-cards, charts, filter-bar, date-range-picker, export-button, sidebar, header).
- **Para macOS/Apple premium de Cuadra: NO se rediseñan componentes** — solo se reescribe `globals.css` (variable de acento → grafito/verde-conciliación, hairlines a `0 0% 92%`, sombra difusa `0 1px 2px / 0 8px 24px -12px`, radius `.875–1rem`, `.glass` en header/sidebar). Ver `DESIGN.md`.

### Infraestructura de agente (oro, no es peso médico)
Reusar: patrón **outbox** (`fase14_outbox_pattern.sql`), **webhook idempotency** (`f125_wa_message_idempotency.sql`), **audit log** genérico, tablas `conversations`/`messages` (ya traen `wa_message_id`, idempotencia, y **costo LLM por mensaje**: `tokens_in/out`, `cost_usd`, `model_used`), y **RAG con `knowledge_chunks` + pgvector** (para la política de gastos).

### Descartar (médico/otros verticales)
`treatment_plans`, PHI/`doctor_notes`, insurance/telemed/cfdi-config schemas y rutas, `appointment_*` clínicas, `marketplace_agents`, el enum `business_type` (Cuadra es mono-vertical), `audit-phi.ts`, y ~70% de `api/cron/*`.
