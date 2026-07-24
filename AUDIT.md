# Audit del Sistema Agéntico — Cuadra

Revisión de calidad e ingeniería del sistema agéntico, con foco en corrección de
dinero, seguridad y madurez enterprise.

## Estado de salud
- ✅ `next build` verde (7 rutas) · `tsc --noEmit` 0 errores · **9/9 tests** pasando.
- ✅ Motor de cuadre cubierto por tests (sobre-política, faltante CFDI, duplicados, baja confianza, anticipo).
- ✅ Parser CFDI cubierto (QR, validación RFC/UUID, no-inventa).

## Arquitectura (resumen)
```
WhatsApp → webhook (HMAC + idempotencia) → processor
  ├─ foto → OCR (Gemini visión, JSON fusionado) + QR CFDI → guarda gasto
  ├─ agente liquidacion (Claude, tool-calling) ← orquesta la conversación
  │    tools: consultar_politica · cuadrar_viaje · guardar_liquidacion
  └─ MOTOR DE CUADRE determinístico ← decide el dinero (NO el LLM)
       → PDF (pdf-lib) → WhatsApp
Dashboard/Admin/Portal (Next.js, macOS) · export ERP/Excel · analítica/anomalías
```

## Fortalezas de diseño (por qué es robusto)
1. **La decisión de dinero es determinística** (`cuadre/engine.ts`), no del LLM. El modelo orquesta y explica; la matemática y la detección de diferencias son código puro y testeado. Esto elimina el riesgo #1 (un LLM equivocándose con cifras) y permite calidad-primero a costo balanceado.
2. **OCR con doble verificación**: el QR del CFDI gana sobre el OCR (0% error en UUID/RFC/total), validación regex, y umbral de confianza por campo.
3. **Anti-doble-mutación**: `generateWithTools` no re-ejecuta mutaciones en fallback; idempotencia de webhook por `message_id`.
4. **ZDR forzado** (`data_collection:'deny'`) — soberanía de datos fiscales (LFPDPPP).

## Gaps encontrados y ARREGLADOS en este audit
| # | Gap | Riesgo | Fix |
|---|-----|--------|-----|
| A | Webhook sin idempotencia | Meta reintenta → **gasto duplicado** (dinero) | `claimMessage()` atómico por `message_id` + tabla `wa_mensaje_procesado` |
| B | Sin middleware de seguridad | Sesión/headers | `middleware.ts`: refresh de sesión + headers (nosniff, frame-deny, referrer, permissions) + gate de rutas protegidas |
| C | Sin tests de CFDI/validación fiscal | Regresiones silenciosas | 5 tests de parser QR + validadores RFC/UUID |

## Gaps restantes para enterprise (priorizados)
| Prioridad | Gap | Recomendación |
|-----------|-----|---------------|
| Alta | **Lock de conversación** | Dos mensajes concurrentes del mismo operador pueden pisar el estado. Añadir lock por conversación (Redis SETNX / advisory lock). |
| Alta | **Verificación CFDI contra el SAT** | Hoy se valida formato + QR; agregar consulta al WS del SAT para autenticidad real. |
| Alta | **Setup del bucket `liquidaciones`** + política de acceso | Crear el bucket privado en Supabase Storage; hoy el PDF se sube ahí. |
| Media | **Persistir costo LLM por conversación** | `generateWithTools` ya calcula costo; guardarlo (tabla) para el panel de costos por tenant. |
| Media | **Observabilidad (Sentry)** | Cablear `@sentry/nextjs` (ya en deps) para captura de errores + trazas. |
| Media | **Validación de env al boot** | Falla temprano con mensaje claro si faltan `OPENROUTER_API_KEY`, WhatsApp o Supabase. |
| Media | **Rate-limit del webhook** | Guard por IP/tenant (atiende lo tenía; se simplificó aquí). |
| Baja | **Test e2e del flujo** (foto→cuadre→PDF) + **CI** (GitHub Actions: typecheck+test+build). |
| Baja | **DPA + aviso de privacidad** al operador (cumplimiento LFPDPPP). |

## Modelos (env-overridable)
Stack fundamentado en 3 investigaciones independientes convergentes. Slugs en
`src/lib/llm/models.ts`, cambiables por env sin tocar código (los modelos rotan
mensualmente — ej. Opus 5 salió 24-jul-2026). Default balanceado; escalar a Opus
en el cuadre solo por confianza/monto (la corrección numérica ya es determinística).
