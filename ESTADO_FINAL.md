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
- Tests: **68 → 97**. Migraciones nuevas aplicadas y verificadas en la DB: **0013, 0014, 0015**.

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

## Post-feedback de Javier (hecho)
1. ✅ **3 flags encendidos** en `.env.local` (+ `CUADRA_INTAKE_ESPERA_MS=20000`). El
   camino verificado ahora corre CON los flags ON.
2. ✅ **Slugs de fallback verificados** contra el catálogo de OpenRouter: los 7 existen.
3. ✅ **R1 cerrado airtight** (mig. 0015: índice único + 23505). Ya no arrastramos la limitación.
4. ✅ **`maxDuration` revertido a 60** (no pude confirmar Pro+Fluid; Hobby ignora >60).
5. ✅ **Suites nuevas**: `barrera.test.ts` (ráfaga) + `injeccion.test.ts` (12 casos).

## ⚠️ Necesito tu OK / acción (en `DECISIONES_PENDIENTES.md`)
1. **Confirmar plan de Vercel** (2 clics: Settings → Functions → Fluid Compute). Si Pro+Fluid,
   subir `maxDuration` a 120; si Hobby, priorizar offload a QStash en FASE 3. **Riesgo abierto.**
2. Al **desplegar en Vercel**, replicar las 4 envs de flags (hoy el demo corre local).
3. Correr el **flujo completo ×3 en vivo** (LLM+WhatsApp) — no es reproducible headless.
4. `cuadre_fallback`→Opus: cablear o borrar (recomiendo dejarlo por ahora).
5. Recordatorio: revertir precio de Sonnet a `[3,15]` tras el 31-ago-2026.

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

## Limitación conocida — ✅ ya cerrada tras tu feedback
- El race de fotos idénticas en el mismo lote (R1) quedó **airtight**: índice único
  `(tenant_id, viaje_id, img_hash)` + manejo de 23505 (mig. 0015). Ya no hay
  limitación conocida que arrastrar al piloto.

## Verificación
Última corrida antes de dormir: `npx tsc --noEmit` (0) · `npx vitest run` (80/80) ·
`npm run build` (ok). Cada commit trae su porqué en el mensaje.
