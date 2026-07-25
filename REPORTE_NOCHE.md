# Reporte de la noche — trabajo autónomo

_Última actualización: AUDITORÍA 1 + FASE 2 cerradas. Ver **`ESTADO_FINAL.md`** para el resumen al despertar. Master verde en cada push._

## Fases

### ✅ FASE 1 — Cerrar la auditoría del repo (COMPLETA, master verde)
Los 6 fixes que salieron de la auditoría del código real:

| # | Item | Qué se hizo |
|---|------|-------------|
| 1.1 | Export CSV muerto (401 siempre) | Gate por el passcode del dashboard + filtro explícito por `tenant_id` (service-role, sin sesión RLS no scopea). Verificado: 401 sin/mala cookie, 200 + CSV real con cookie buena. |
| 1.2 | Passcode reversible (btoa/base64) | HMAC-SHA256 con `DASHBOARD_SECRET`, comparación en tiempo constante, cookie httpOnly+secure+sameSite+exp. Web Crypto (edge/node). +test. |
| 1.3 | Lote de mensajes en un POST | Un solo `after()` con `Promise.all` → concurrencia garantizada; con la barrera las fotos ya son paralelas (8 ≈ 3.5s vs 24s serie). Cabe en 60s. |
| 1.4 | Falso positivo de la guardia | Ya estaba: 4 tests de no-regresión (mensajes legítimos sin monto no fuerzan cuadre). |
| 1.5 | `isMutation` código muerto | Cableado: `makeExecutor` dedupea mutaciones por run (evita doble guardar_liquidacion/PDF). +3 tests. Backstop DB unique+upsert. |
| 1.6 | Middleware en todas las rutas | Matcher acotado a excluir `/api` (webhook/demo/export no pasan por el gate). |

Extra: `vitest.config.ts` con alias `@`→src (desbloquea testear módulos con imports `@/` en runtime). **68 tests, typecheck 0, build verde.**

### ✅ AUDITORÍA 1 — CERRADA (master verde)
6 categorías de subagente consolidadas en `AUDIT_V3.md`. **8 críticos + 7 altos resueltos**, 2 diferidos (a `DECISIONES_PENDIENTES.md`, no los adiviné). Lo más grave que encontré y arreglé:

| Área | Lo que estaba mal | Fix | Commit |
|------|-------------------|-----|--------|
| Money-path | Cierre **no atómico**: se guardaba la liquidacion pero el error al marcar el viaje 'liquidado' se **ignoraba** → viaje abierto, re-cuadre posible. | RPC transaccional `guardar_liquidacion_tx` (mig. 0013), verificada en la DB. | `6583d00` |
| Seguridad | Los RPC quedaban ejecutables por `anon`/`authenticated` (Supabase los concede **explícitamente**; `revoke from public` no basta). | Revoke explícito + verificación `{postgres,service_role}`. | `6583d00` |
| Orquestación | Presupuesto de tiempo real ~112s > `maxDuration=60` → moría a media liquidación. | `maxDuration→120`. | `49c8d03` |
| Orquestación | Carrera de barrera y huérfano de cierre parcial. | Fixes **detrás de flag** (default off = camino actual). **Recomiendo encenderlos para el demo** — ver DECISIONES §1. | `49c8d03` |
| Guardia f/g | Números mal transcritos por el LLM tras `cuadrar_viaje` pasaban; enteros redondos sin `$` pasaban; fail-open. | Reemplazo siempre por el motor + regex ampliada + fail-**closed**. +6 tests. | `2ed5bdc` |
| Seguridad | Login del passcode sin límite → fuerza bruta. | 10 intentos/5 min por IP. | `5ab6d65` |
| LLM/costo | Costo atribuido al modelo primario aunque cayera al fallback; precio intro de Sonnet desactualizado. | `activeModel` + `[2,10]`. | `171c10d` |
| Frontend | Fallo de backend se veía como "no hay liquidaciones"; contraste del CTA en dark; marca Cuadra/Likida mezclada. | error≠vacío + `--accent-fg` + marca unificada. | `edcdf6e` |

**`engine.ts` intacto. 75 tests, typecheck 0, build verde.** Migraciones nuevas: **0013** (aplicada y verificada en la DB de Likida).

> ⚠️ **Antes del demo, dos cosas mías que requieren tu OK:** (1) encender los 2 flags de orquestación; (2) verificar los slugs de fallback de OpenRouter. Ambas en `DECISIONES_PENDIENTES.md`.

### ✅ FASE 2 — CERRADA (una feature, bien hecha)
Acoté FASE 2 a **una** feature sólida en vez de barrer los 8 ítems a medias (tu regla: "2 fases bien cerradas > 5 a medias"):

- **Dedup de fotos por contenido (SHA-256)** — cierra un hueco de dinero real: la idempotencia por `waMessageId` cubre reintentos de Meta, pero no el reenvío MANUAL de la misma foto. Flag `CUADRA_DEDUP_FOTOS`, migración 0014, +5 tests. `AUDITORÍA 2` en `AUDIT_V3.md` (con 1 limitación conocida documentada, no regresión). Commit `a4bc50c`.

### ⏳ FASE 3–5 — NO alcanzadas (siguiente sesión)
Preferí dejar 2 fases sólidas y auditadas. FASE 4 son **reglas del motor** → cada una entra a `engine.ts` como regla nueva **con test** (HARD RULE 2), no de madrugada. Detalle y hand-off en `ESTADO_FINAL.md`.
