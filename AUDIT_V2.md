# AUDIT_V2 — Auditoría de 5 expertos (síntesis consolidada)

> Cinco subagentes especializados auditaron el repo de punta a punta leyendo el código
> real (no los docs): **frontend/UX**, **agentificación/LLM**, **seguridad**, **backend/
> corrección del money-path** y **arquitectura/escalabilidad**. Este documento deduplica
> los hallazgos, marca los **confirmados por ≥2 auditores** (los más confiables) y los
> parte en **ANTES del 6-ago (bloqueantes del demo)** vs **DESPUÉS (enterprise)**.
>
> Fecha: 2026-07-24 · Demo objetivo: Cliente demo, 6-ago-2026

---

## Veredicto de los cinco

Consenso unánime: **el núcleo de valor es sólido.** La decisión de dinero es
determinística, pura y testeada (`cuadre/engine.ts`); el cruce OCR↔QR con el QR como
autoridad es correcto; la validación SAT degrada a `pendiente` sin tumbar el flujo; el
RLS está bien diseñado en las migraciones; el HMAC del webhook es timing-safe; no hay
SQLi, no hay secretos commiteados, no se toca la e.firma, ZDR forzado en OpenRouter.

Consenso igual de unánime sobre el **riesgo**: hay una **brecha entre lo que los docs
prometen y lo que el código hace**, y esa brecha está toda en la **orquestación
alrededor del motor**, no en el motor. Tres capacidades que los docs venden como hechas
**no existen en la ruta real**: el fallback cross-provider, los parámetros de razonamiento
por rol, y la anti-doble-mutación. Y hay tres riesgos de **pérdida/corrupción silenciosa
de dinero** que `AUDIT.md` subestimó como "enterprise para después".

Cita del auditor de arquitectura: *"El motor de cuadre merece la confianza que los docs
le dan; la orquestación alrededor del motor es donde está la deuda y el riesgo."*

---

## 🔴 CRÍTICOS

### CR-1 · Cierre concurrente duplica la liquidación (sin lock, sin `unique(viaje_id)`)
**Confirmado por 4/5** (backend C1, arquitectura A2, agentificación C2, seguridad implícito).
El webhook dispara un `after(processInbound)` por mensaje, en paralelo, sin serialización.
Dos "listo" concurrentes (o "listo" + reintento de Meta con otro `waMessageId`) → dos
`runAgent` → dos `guardar_liquidacion`. `saveLiquidacion` (`repo.ts:110`) hace `INSERT`
pelón; `liquidacion` **no tiene `unique(viaje_id)`** → **dos liquidaciones, dos PDFs,
doble cobro de WhatsApp, viaje marcado `liquidado` dos veces.** El motor es idempotente;
la persistencia no.
**Fix:** advisory lock por conversación (`pg_advisory_xact_lock(hashtext(telefono))`) +
`unique(viaje_id)` en `liquidacion` + guard `update viaje set estatus='liquidado' where
id=? and estatus<>'liquidado'` (abortar si 0 filas).

### CR-2 · `claimMessage()` antes de procesar = pérdida silenciosa (at-most-once)
**Confirmado por 3/5** (arquitectura C1, backend A3, seguridad M2).
`processInbound` marca el mensaje como procesado **al inicio** (`processor.ts:31`) y luego
hace el trabajo dentro de `after()` (best-effort en serverless). Si crashea/se recicla/
excede presupuesto, el trabajo se pierde **pero el mensaje ya quedó marcado** → el retry
de Meta lo descarta como duplicado (23505). **El gasto se pierde para siempre, sin traza.**
Es *at-most-once*; con dinero necesitas *at-least-once*. Agravante: `downloadMediaAsDataUrl`
está **fuera** del try (`processor.ts:56`).
**Fix (mínimo demo):** no marcar hasta terminar con éxito, o estado `claimed`→`done` y
liberar en el `catch`. **Fix completo (después):** cola QStash (ya en deps) para el
procesamiento, `after()` sólo encola.

### CR-3 · `estadoSat: 'no_encontrado'` NUNCA se maneja → CFDI fabricado pasa como deducible
**Confirmado por 1/5** (backend C2) — **bug de código verificado.**
El motor ramifica sobre `cancelado`/`efos`/`pendiente` (`engine.ts:92-98`) pero **no sobre
`no_encontrado`**, que `sat.ts` sí produce. Un UUID que el SAT reporta como inexistente cae
al `else` → la liquidación queda `cuadrada`. **Es exactamente el fraude que el producto
promete atrapar.**
**Fix:** rama `g.estadoSat === 'no_encontrado'` → diferencia `cfdi_no_encontrado` en `REVISAR`.

### CR-4 · El prompt del agente ordena tools que no existen
**Confirmado por 2/5** (agentificación A1, arquitectura C2) — **regresión introducida en FASE 1.**
`prompts.ts:20-22` instruye usar `extraer_comprobante` y `validar_cfdi`; **ninguna está
registrada** (solo `consultar_politica`/`cuadrar_viaje`/`guardar_liquidacion`), y las fotos
se procesan en silencio fuera del agente. El modelo no puede emitir esas tools, pero el
prompt incoherente degrada su conducta: puede pedir fotos ya recibidas o **afirmarle al
operador que "validó el CFDI" cuando nunca lo hizo.** Rompe el happy path del demo.
**Fix:** reescribir el prompt al flujo real (fotos automáticas; el agente solo consulta
política, cuadra y cierra al confirmar el operador).

### CR-5 · El "fallback cross-provider" NO existe en la ruta del dinero (código muerto)
**Confirmado por 4/5** (agentificación C1, backend A4, arquitectura A1, AUDIT.md previo).
El `FALLBACK` map + `isTransientError` **solo se consultan en `generateResponse`, que nadie
llama.** La ruta real — `generateWithTools` (cuadre) y `generateStructured` (OCR) — **no
tiene fallback**: un 429/503/timeout de Sonnet → `PartialExecutionError` → el operador
recibe "se me trabó el sistema". En una caída de Anthropic en vivo, **no hay plan B**, pese
a que los docs venden "un provider caído nunca es error visible".
**Fix:** cablear `FALLBACK[model]` dentro de `generateWithTools`/`generateStructured` en
error transient, **cuidando no re-ejecutar mutaciones** (ver AL-2).

---

## 🟠 ALTOS

### AL-1 · Race foto↔texto: liquidación cerrada sin el último gasto
**Arquitectura A3.** Cada mensaje corre en su propio `after()` concurrente sin orden. El
operador manda fotos y escribe "listo" enseguida; el turno de texto puede `guardar_liquidacion`
**antes** de que el `after()` del OCR de la última foto haya hecho `addGasto` → **PDF con
número equivocado.** Es corrección de dinero. Lo resuelve el mismo lock de CR-1/CR-2.

### AL-2 · `isMutation` nunca se lee → sin idempotencia de mutaciones
**Confirmado por 3/5** (backend A5, agentificación C2, arquitectura B3). `tools.ts:78` marca
`guardar_liquidacion` como `isMutation:true`, pero el loop de `generateWithTools` decide
read-only por **prefijo de nombre**, ignorando el flag. Si el LLM llama `guardar_liquidacion`
en dos rondas, se ejecuta dos veces. Fuente doble de verdad.
**Fix:** cachear/rechazar segunda invocación de una tool `isMutation` dentro de un run.

### AL-3 · `claimMessage` fail-open ante error de DB ≠ 23505
**Confirmado por 2/5** (backend A6, seguridad M2). `conv.ts:89` devuelve `true` (procesa) ante
cualquier error que no sea unique-violation (timeout, conexión) → bypassa idempotencia →
posible **doble gasto**. Solo un 23505 significa "ya procesado".

### AL-4 · Auth incompleta: redirección a `/login` inexistente + middleware fail-open
**Confirmado por 2/5** (frontend C1, arquitectura A4). El middleware redirige rutas
protegidas a `/login`, que **no existe** (ni `/register`); los route groups `(portal)`,
`(dashboard)`, `(demo)`, `(admin)` están **vacíos**. El landing enlaza a 404. Y el middleware
**falla-abierto** si falta `NEXT_PUBLIC_SUPABASE_ANON_KEY` → en un deploy con env mal puesta,
rutas protegidas abiertas. (Bomba: funciona en dev sin Supabase, truena con env real.)
**Fix:** `/login` mínimo (o redirigir landing a `/demo` y desproteger lo del demo); borrar
grupos vacíos; middleware **fail-closed** en producción.

### AL-5 · Aislamiento multi-tenant depende de `.eq('tenant_id')` a mano, no de RLS
**Confirmado por 2/5** (arquitectura A5, frontend M6). RLS bien diseñado, pero **casi todo el
runtime usa `supabaseAdmin()` (service-role, salta RLS)** — webhook, dashboard, analytics,
costos. El aislamiento real vive en recordar el filtro en cada query. **Un query sin filtro
= fuga cross-tenant.** Solo el export CSV usa la ruta RLS. Seguridad lo verificó como
*actualmente correcto* (el `tenantId` viene de sesión validada), pero es un footgun de alto
riesgo a escala.
**Fix (después):** dashboard/analytics vía cliente con sesión (RLS); service-role solo en el
pipeline sin sesión.

### AL-6 · RFC de empresa por defecto genérico rompe la validación RFC-receptor
**Confirmado por 2/5** (backend B13, arquitectura M5). Con `empresa.rfc = 'XAXX010101000'`
(demo), **toda factura real** se marca "RFC receptor no es de la empresa → no deducible"
(`engine.ts:89`). En vivo, cuadre lleno de falsos positivos.
**Fix:** capturar `tenant.rfc` real antes del demo **y desactivar el check si `empresaRfc`
es el genérico.**

### AL-7 · Cero rate-limiting + sin límite de tamaño de body → DoS
**Seguridad A2.** Upstash/QStash están en `.env` pero **sin usar** (0 referencias). El webhook
lee `req.text()` **sin límite** antes del HMAC; `/api/demo` (público) hace `req.json()` sin
límite. Sin throttle por IP/teléfono en ninguna ruta.
**Fix:** rate-limit (Upstash ya aprovisionado) + body cap antes de leer.

### AL-8 · Identidad del operador = solo teléfono, único por-tenant (no global)
**Seguridad A1.** Si el mismo número está en dos flotas, sus comprobantes se atribuyen a un
tenant **arbitrario** (`resolveOperador` usa `limit(1)` sin `order by`). El teléfono es el
único factor de auth del operador, sin verificación de propiedad.
**Fix (después):** teléfono único global + flujo de verificación del número.

---

## 🟡 MEDIOS

| # | Hallazgo | Auditor(es) | Fix |
|---|----------|-------------|-----|
| ME-1 | `ROLE_PARAMS` decorativo: el cuadre corre a **temp 0.3 sin reasoning**, no `temp 0/high` como dicen los docs | agentif. A2, arq. M1, backend | Aplicar `ROLE_PARAMS[role]` en `runAgent`, o borrar la constante |
| ME-2 | **EFOS con falso positivo**: cualquier código ≠ 200/201 marca lista negra sobre CFDI legítimo | backend M12 | Whitelist explícita de códigos limpios; valor inesperado → `null`, no `true` |
| ME-3 | `cuadre_fallback` (Opus) definido pero **jamás invocado** | backend M10, agentif. B1 | Implementar disparo por baja confianza/monto alto, o quitar la afirmación |
| ME-4 | `diesel_desviacion` referenciado en `hayDif` pero **nunca calculado** (rama muerta) | backend M11 | Implementar cálculo con tabulador, o eliminar la referencia |
| ME-5 | Sin guard de `monto ≤ 0`: un monto negativo **reduce** el total y sesga a "sobró anticipo" | backend M7 | `monto <= 0` → diferencia `revisar` (o rechazar en `addGasto`) |
| ME-6 | `saveConversation` last-writer-wins: turnos concurrentes se pisan el historial | backend M9, arq. A2 | Append atómico (RPC jsonb) o serializar por conversación |
| ME-7 | `getConfig` hace **merge shallow** + castea `tenant.config` **sin validar** | arq. M4 | Deep-merge + `CuadraConfigSchema.safeParse` con fallback a DEMO_CONFIG |
| ME-8 | Flag "primer comprobante" racy bajo concurrencia (doble saludo) | backend M8 | Contador atómico en `wa_conversacion` o `insert…returning` |
| ME-9 | Sentry en deps + `SENTRY_DSN` en `.env` pero **cero wiring**; errores solo a `console` en `after()` = invisibles; sin CI | arq. M2 | `instrumentation.ts` + `captureException`; GitHub Actions (typecheck+test+build) |
| ME-10 | `logger.redact()` hace `JSON.parse(redact(JSON.stringify(v)))` → **lanza con objetos circulares**, redacción por regex frágil | seguridad B3, arq. M2 | try/catch + allowlist de campos |
| ME-11 | Agregaciones en JS sobre tablas completas (`analytics`, `costos`); `llm_costo` crece sin retención | arq. M3 | Agregar en SQL, paginar, rollup/poda de `llm_costo` y `wa_mensaje_procesado` |
| ME-12 | Prompt injection indirecto: `folio` crudo del OCR fluye al contexto del agente (blast radius acotado por determinismo) | seguridad M1, agentif. M2 | Sanitizar/acotar `folio`; delimitar datos no confiables en las `nota` |
| ME-13 | `maxDuration` sin fijar; el `after()` (agente 40s + OCR + SAT + PDF) puede exceder presupuesto y ser matado | arq. M7 | Fijar `maxDuration`; bajar timeout del agente; medir p95 |
| ME-14 | Fraude vía foto: diésel/casetas sin CFDI confían 100% en `monto`/`confianza` auto-reportados por el modelo | agentif. M1 | Regla de negocio (tope duro por concepto sin CFDI) — roadmap |
| ME-15 | Cumplimiento LFPDPPP: ZDR cubre solo el LLM; falta aviso de privacidad al operador + DPAs | arq. M6 | Primer mensaje con aviso+consentimiento; DPAs Meta/Supabase/OpenRouter |
| ME-16 | UX demo: emojis violan DESIGN.md, contraste dark-mode `--accent-fg` falla WCAG, sin auto-scroll en chat, `cerrar()` sin catch | frontend A1/A2/M2/M3 | Polish de UI |
| ME-17 | `wa_conversacion` sin `unique(tenant_id, telefono)`: `maybeSingle()` **lanza si hay >1 fila** | seguridad B4, arq. A2 | `unique(tenant_id, telefono)` + upsert |

---

## ⚪ BAJOS (hardening)

- **BA-1** Código muerto: `generateResponse`, `ROLE_PARAMS`, `requireEnv` (env nunca validado en boot), `getStatsPorOperador`, roles `chat`/`router`, agente `orchestrator`, route groups vacíos.
- **BA-2** Tests solo en engine + parser CFDI. Sin cobertura: `processor`, loop de `generateWithTools`, `ocr`, `sat`, `claimMessage`, `config`. ~11 casos del motor sin test (monto negativo/cero, `no_encontrado`, `efos=true`, política vacía, `rfcsAdicionales`, 3+ duplicados, bordes de redondeo).
- **BA-3** Middleware trata todo `/api/*` como público (footgun); falta CSP/HSTS.
- **BA-4** `Promise.all` sobre tool calls de una ronda: si el modelo emite `cuadrar_viaje`+`guardar_liquidacion` juntas, corren concurrentes.
- **BA-5** `calcCost` usa el slug pedido, no `res.model` servido (mal atribuido si OpenRouter re-rutea).
- **BA-6** Dedup por folio frágil (`concepto|folio|monto` puede fusionar distintos).
- **BA-7** Umbral de diferencia 0.5 MXN sin documentar/testear en el borde.
- **BA-8** Setup del bucket `liquidaciones` no versionado en migraciones.
- **BA-9** `costos.ts` cuenta `distinct viaje_id` como "liquidaciones" (mal etiquetado).

---

## Plan de remediación

### 🚦 ANTES del 6-ago (bloqueantes de un demo creíble y sin sustos)

| Orden | Item | Costo | Por qué bloquea el demo |
|-------|------|-------|--------------------------|
| 1 | **CR-4** prompt (tools fantasma) | Barato | Rompe el happy path hoy; el agente puede mentir "validé el CFDI" |
| 2 | **CR-3** `no_encontrado` | Barato | Deja pasar el fraude que el producto promete atrapar |
| 3 | **AL-6** RFC genérico → desactivar check | Barato | Cuadre lleno de falsos "no deducible" en vivo |
| 4 | **CR-1 + CR-2 + AL-1** lock por conversación + `unique(viaje_id)` + claim-on-success | Medio | *El* riesgo de "cerró mal el cuadre / lo perdió en vivo" |
| 5 | **CR-5** fallback en `generateWithTools`/`generateStructured` | Medio | Tu "Plan B demo" hoy no existe |
| 6 | **AL-3** `claimMessage` fail-closed | Barato | Evita doble gasto por retry |
| 7 | **ME-2** EFOS whitelist · **ME-5** guard `monto≤0` · **ME-10** logger circular | Barato | Correcciones de dinero/robustez baratas |
| 8 | **ME-13** `maxDuration` · **AL-4** landing→`/demo` + middleware fail-closed | Barato | Deploy no rompe; env mal puesta no abre rutas |
| 9 | **ME-1** aplicar `ROLE_PARAMS` (temp 0 en cuadre) · **ME-16** polish UI | Barato | Menos variabilidad; se ve profesional |

### 🏢 DESPUÉS (clientes reales / enterprise)

- **CR-2 completo** — cola QStash, at-least-once con estado.
- **AL-2** — anti-doble-mutación real (leer `isMutation` en el loop).
- **AL-5** — dashboard/analytics vía RLS; service-role solo en pipeline.
- **AL-7 / AL-8** — rate-limiting + body cap; teléfono único global + verificación.
- **ME-3/ME-4** — Opus por confianza; desviación de diésel con tabulador.
- **ME-6/ME-7/ME-17** — locks de conversación finos; config deep-merge + zod; unique en `wa_conversacion`.
- **ME-9** — Sentry cableado + CI + alertas. **BA-2** — tests de processor/loop/idempotencia.
- **ME-11** — agregaciones SQL, retención de `llm_costo`, poda de `wa_mensaje_procesado`, paginación.
- **ME-14/ME-15** — regla anti-fraude de fotos sin CFDI; aviso de privacidad + DPAs LFPDPPP.
- **BA-1** — borrar o cablear el código muerto.

---

## Nota honesta (del auditor de arquitectura, compartida por los cinco)

`AUDIT.md` es transparente, pero **clasificó como "para después" cosas que son críticas para
no perder dinero en producción** (CR-1, CR-2, AL-1) y **presenta como implementadas
capacidades que no lo están en la ruta real** (fallback CR-5, reasoning ME-1, anti-doble-
mutación AL-2). El motor de cuadre merece la confianza que los docs le dan; la deuda está
en la orquestación. Este `AUDIT_V2.md` corrige esa clasificación.
