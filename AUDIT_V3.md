# AUDIT_V3 — Auditoría acumulada del trabajo autónomo

Consolidación de las auditorías por fase. 6 categorías de subagente por ronda
(seguridad, money-path, frontend/UX, agéntico, orquestación, LLM/costos). Los
hallazgos **cross-validados** (misma raíz vista por ≥2 categorías) van marcados
`⚑`. Los CRÍTICOS se arreglan **antes** de pasar a la siguiente fase.

Estado: `✅ resuelto` · `📋 → DECISIONES_PENDIENTES` · `⏳ pendiente`

---

## AUDITORÍA 1 (post-FASE 1)

### CRÍTICOS

| # | Cat. | Hallazgo | Estado | Commit |
|---|------|----------|--------|--------|
| C1 ⚑ | orquest. + money | **Presupuesto de timeout**: peor caso lock(≤12s)+intake(≤60s)+agente(~40s) ≈112s > `maxDuration=60` → la función moría a media liquidación. | ✅ `maxDuration→120` | `49c8d03` |
| C2 ⚑ | orquest. | **Carrera de barrera**: fotos + "listo" en el mismo lote (Promise.all) → el "listo" lee el contador antes del `+1` de una foto → cuadra parcial. | ✅ gracia inicial `CUADRA_INTAKE_GRACE_MS` (flag, default off) | `49c8d03` |
| C3 ⚑ | orquest. + agéntico | **Huérfano de cierre parcial**: `guardar_liquidacion` persiste pero el ciclo muere después → operador recibe "se trabó", nunca su PDF; liquidacion en DB sin cerrar UX. | ✅ recuperación vía `PartialExecutionError.partialToolCalls` (flag `CUADRA_RECUPERAR_CIERRE_PARCIAL`, default off) | `49c8d03` |
| C4 | orquest. | **Startup no verifica migración 0011**: sin ella `intake_delta` devuelve 0 en silencio → la barrera nunca frena. | ✅ probe explícito en `startup.ts` | `49c8d03` |
| C5 ⚑ | money | **Cierre NO atómico**: `saveLiquidacion` hacía upsert + update viaje en 2 statements e **ignoraba el error del 2º** → liquidacion persistida con viaje 'abierto'. | ✅ RPC `guardar_liquidacion_tx` (0013), 1 transacción; verificado en DB | `6583d00` |
| C6 | seguridad | **Grants de RPC**: Supabase concede EXECUTE a anon/authenticated **explícitamente**; `revoke from public` no basta. | ✅ revoke explícito de anon/authenticated; verificado `{postgres,service_role}` | `6583d00` |
| C7 ⚑ | agéntico + money | **Guardia — hueco de transcripción**: si el agente llamaba `cuadrar_viaje` pero narraba mal el número, la guardia no lo tocaba. | ✅ ante cualquier cifra se reemplaza por el resumen determinístico del motor | `2ed5bdc` |
| C8 | LLM | **Atribución de costo**: `calcCost(model,…)` usaba siempre el primario; con fallback se cobraba al precio equivocado. | ✅ usa `activeModel` | `171c10d` |

### ALTOS

| # | Cat. | Hallazgo | Estado | Commit |
|---|------|----------|--------|--------|
| A1 | seguridad | **Login del passcode sin rate limit** → fuerza bruta trivial. | ✅ 10 intentos/5 min por IP | `5ab6d65` |
| A2 ⚑ | agéntico | **Guardia — detección incompleta**: enteros redondos sin `$`/coma ("sobraron 500 pesos") pasaban. | ✅ regex ampliada (palabra-moneda + verbos de cuadre) con no-regresión | `2ed5bdc` |
| A3 | agéntico | **Guardia fail-open**: si `cuadrarDesdeDB` fallaba, tiraba excepción / filtraba texto del modelo. | ✅ fail-CLOSED: respuesta neutral sin cifras + log | `2ed5bdc` |
| A4 ⚑ | frontend | **Error disfrazado de vacío**: 3 consultas null → "aún no hay liquidaciones" en vez de error de carga. | ✅ distingue `errorCarga` de cero real | `edcdf6e` |
| A5 | frontend | **Contraste del CTA**: `var(--color-accent-fg)` (siempre blanco) fallaba en dark. | ✅ `var(--accent-fg)` | `edcdf6e` |
| A6 | frontend | **Marca inconsistente** Cuadra/Likida en el flujo del demo. | ✅ unificado a Likida (title, landing, footer, simulador) | `edcdf6e` |
| A7 | LLM | **Precio intro de Sonnet** desactualizado (`[3,15]` vs intro `[2,10]` vigente). | ✅ `[2,10]` + recordatorio de reversión | `171c10d` |

### Diferidos (no adivinar — HARD RULE 4/5)

| # | Cat. | Hallazgo | Estado |
|---|------|----------|--------|
| D1 | LLM | Slugs de modelos de **fallback sin verificar** (requiere API autenticada). | 📋 DECISIONES_PENDIENTES §2 |
| D2 | LLM | `cuadre_fallback`→Opus definido pero **no cableado**. | 📋 DECISIONES_PENDIENTES §3 |

### Resumen AUDITORÍA 1
**8 críticos + 7 altos resueltos**, 2 diferidos con recomendación documentada.
Los flags de C2/C3 dejan el camino de `processInbound` byte-idéntico al verificado
cuando están OFF. `engine.ts` **intacto** (HARD RULE 2). 75 tests verdes, typecheck
0, build ok en cada push.

---

## AUDITORÍA 2 (post-FASE 2)

FASE 2 la acoté a **una** feature bien cerrada (dedup de fotos), priorizando
profundidad sobre barrer los 8 ítems del plan a medias (indicación explícita de
Javier). Revisión adversarial de esa feature:

| # | Cat. | Hallazgo | Estado |
|---|------|----------|--------|
| R1 | money/agéntico | **Race same-burst**: dos fotos IDÉNTICAS en el mismo lote (Promise.all) hacen pre-check antes de que cualquiera inserte → ambas pasan → duplicado. | ✅ **CERRADO** (feedback de Javier): mig. 0015 hace ÚNICO `(tenant_id, viaje_id, img_hash)`; la 2ª inserción choca con 23505 y el processor la trata como duplicado benigno. NULLs distintos → camino sin flag intacto. `f19a270` |
| R2 | orquest. | ¿El `return` de dedup desbalancea el contador de intake? | ✅ no: el `return` está dentro del `try`, el `finally { intakeDelta(-1) }` corre igual. Contador balanceado. |
| R3 | resiliencia | `gastoExistePorHash` ante error de lectura. | ✅ devuelve `false` → procede (preferimos un raro duplicado a **perder** un gasto). |
| R4 | seguridad | ¿Lecturas nuevas scopeadas por tenant? | ✅ `gastoExistePorHash` filtra `tenant_id` + `viaje_id` explícitos (service-role). |

**Resumen AUDITORÍA 2:** feature sólida; R1 (race same-burst) **cerrado airtight**
tras el feedback (mig. 0015, índice único + 23505). 97 tests verdes. Migraciones
**0014 + 0015** aplicadas. `engine.ts` intacto.

### Post-feedback de Javier (verificaciones y correcciones)

| Tema | Resultado |
|------|-----------|
| **Plan de Vercel / `maxDuration`** | No se pudo confirmar Pro+Fluid por API (cuenta = team personal, default Hobby, tope duro 60s). **Revertido 120→60** para no asumir margen inexistente. ⚠️ **RIESGO ABIERTO**: el peor caso teórico (>60s) no cabe en Hobby; camino fiable = común (~30s); fix real = offload a QStash (FASE 3). Confirmar plan en Vercel → Settings → Functions → Fluid Compute. |
| **Flags del demo** | Encendidos **desde ya** en el entorno local (`.env.local`): `CUADRA_INTAKE_GRACE_MS=2000`, `CUADRA_RECUPERAR_CIERRE_PARCIAL=1`, `CUADRA_DEDUP_FOTOS=1` (+ `CUADRA_INTAKE_ESPERA_MS=20000`). El camino "verificado" ahora es CON los flags ON. Al desplegar en Vercel, replicar en su env. |
| **Slugs de fallback OpenRouter** | ✅ **VERIFICADOS** contra el catálogo (`/api/v1/models`): los 7 (primarios + fallbacks) existen. |
| **Suites nuevas** | `barrera.test.ts` (ráfaga, 5) + `injeccion.test.ts` (12 casos). |
| **`flujo completo 3 veces`** | ⏳ requiere corrida **en vivo** (LLM + WhatsApp/Meta) → checklist manual pre-demo; no es reproducible headless. |
## AUDITORÍA 3 (post-FASE 3) — pendiente
## AUDITORÍA 4 (post-FASE 4) — pendiente
## SÚPER-AUDITORÍA final — pendiente
