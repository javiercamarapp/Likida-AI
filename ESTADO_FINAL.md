# Estado final — trabajo autónomo de la noche

_Para leer al despertar. Honesto sobre lo que alcancé y lo que no._

## TL;DR
- **Master siempre verde.** Typecheck 0, tests pasando y build ok en **cada** push
  (11 commits). `engine.ts` **nunca se tocó** (HARD RULE 2).
- Cerré por completo la **AUDITORÍA 1** (la ronda grande de 6 categorías sobre el
  código real): **8 críticos + 7 altos resueltos**, 2 diferidos con recomendación.
- Cerré **FASE 2** con **una** feature bien hecha y auditada (dedup de fotos), en
  vez de barrer los 8 ítems a medias — tu indicación explícita.
- **No** llegué a FASE 3, 4 ni 5. Preferí dejar 2 fases sólidas y auditadas.
- Tests: **68 → 80**. Migraciones nuevas aplicadas y verificadas en la DB: **0013, 0014**.

## Lo que sí quedó (todo en master)
Ver `AUDIT_V3.md` (tabla acumulada) y `REPORTE_NOCHE.md` (resumen por área). En corto:

**Correctness del dinero**
- Cierre de liquidación ahora **atómico** (RPC transaccional `guardar_liquidacion_tx`,
  mig. 0013): antes el error al marcar el viaje 'liquidado' se **ignoraba**.
- Guardia f/g reforzada: reemplaza SIEMPRE cifras por el motor, detecta enteros
  redondos, y falla **cerrado** (nunca inventa un número si el motor no responde).
- Dedup de fotos por SHA-256 (flag) para no duplicar gastos en reenvíos manuales.

**Seguridad**
- Hueco de grants: los RPC quedaban ejecutables por `anon`/`authenticated`
  (Supabase los concede explícitamente). Revocado y **verificado en la DB**.
- Rate limit en el login del passcode (fuerza bruta).

**Orquestación / resiliencia**
- Presupuesto de timeout (`maxDuration` 60→120): moría a media liquidación.
- Carrera de barrera y huérfano de cierre parcial: arreglados **detrás de flag**.
- Startup verifica la migración 0011.

**LLM / costo, Frontend**
- Costo atribuido al modelo realmente usado (fallback); precio intro de Sonnet.
- Error de backend ya no se disfraza de "sin datos"; contraste del CTA; marca Likida.

## ⚠️ Necesito tu OK antes del demo (en `DECISIONES_PENDIENTES.md`)
1. **Encender 3 flags** (`CUADRA_INTAKE_GRACE_MS=2000`, `CUADRA_RECUPERAR_CIERRE_PARCIAL=1`,
   `CUADRA_DEDUP_FOTOS=1`). Con OFF, el sistema queda idéntico al camino verificado;
   ON activa los fixes de casos borde. Recomiendo ON.
2. **Verificar los slugs de fallback de OpenRouter** (no gasté tu clave de noche).
3. `cuadre_fallback`→Opus: decidir si se cablea o se borra (recomiendo dejarlo por ahora).
4. Recordatorio: revertir precio de Sonnet a `[3,15]` tras el 31-ago-2026.

## Lo que NO alcancé (siguiente sesión)
- **FASE 3** (flujo detrás de flag: cierre robusto, resolución de `viaje_id`).
- **FASE 4** (NIVEL 3 sin credenciales: precios CNE, casetas esperadas, validación
  L_CNE, RMF 2.7.1.34/35, viáticos 50km, descuento de nómina). **Son reglas del
  motor** → cada una entra a `engine.ts` como regla NUEVA **con su test** (HARD
  RULE 2). No las improvisé de madrugada: un error fiscal ahí es peor que no tenerlo.
- **FASE 5** (prep de demo: guion, checklist, contingencia, seed). `GUION_DEMO.md`
  tiene un borrador con plan de contingencia (WhatsApp falla → simulador).
- Resto de FASE 2 (clasificador de intent, correlation-id, prompt registry,
  cancelación agéntica, folio warning): no eran críticos; los dejé para no barrer
  a medias.

## Limitación conocida que quiero que sepas
- El dedup de fotos atrapa el reenvío **después** del acuse (caso común), pero NO
  dos fotos idénticas en el **mismo** envío-lote (race; índice no-único). No es
  regresión (hoy no hay dedup). Cierre airtight = follow-up. Detalle en `AUDIT_V3.md` R1.

## Verificación
Última corrida antes de dormir: `npx tsc --noEmit` (0) · `npx vitest run` (80/80) ·
`npm run build` (ok). Cada commit trae su porqué en el mensaje.
