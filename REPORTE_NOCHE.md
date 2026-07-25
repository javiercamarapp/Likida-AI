# Reporte de la noche — trabajo autónomo

_Última actualización: en progreso. Master verde en cada push._

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

**AUDITORÍA 1:** 6 subagentes (seguridad, money-path, frontend, agéntico, orquestación, LLM/costos) en curso. Consolidación → `AUDIT_V3.md`. Los críticos se arreglan antes de FASE 2.

### ⏳ FASE 2–5 — pendientes
Ver el plan. Se abordan tras cerrar la auditoría de FASE 1.
