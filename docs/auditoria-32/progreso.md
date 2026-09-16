# Progreso — auditoría 32 (16-sep-2026)

Una línea por acción, con su sha. Se escribe **mientras** avanza, no al cerrar:
un diario que se escribe al final no existe cuando se necesita.

| Hora (UTC) | Acción | Resultado / sha |
|---|---|---|
| 10:55 | `list_pull_requests(open)` vía MCP (no hay `gh` en la imagen) | `[]` — cero PRs de auditoría abiertos; el #462 está mergeado en `8b01aec` |
| 10:56 | `git ls-remote origin master` (paso obligatorio que dejó la continuación 2) | `69becdb` — el ref **no** viene rancio esta vez; coincide con HEAD |
| 10:56 | `git log 8b01aec..HEAD -- src/ supabase/ normas/` | **vacío** → sin PR abierto y sin commits en rutas vigiladas → **RONDA LIGERA** |
| 10:57 | Único commit de la ventana: `69becdb`, `scripts/mejora-diaria/rutina.sh`, −1 línea | Ninguna ruta de los 3 rubros de hoy |
| 10:58 | `git checkout -b claude/auditoria-32` desde `69becdb` | rama creada; árbol limpio → **autofix habilitado** |
| 10:58 | `npm ci` (el clon no traía `node_modules`) | exit 0. **INFRA, no es fallo del código** |
| 11:00 | `docs/auditoria-32/MAPA.md` escrito | Rotación decidida: **fiscal (3) · legal (3) · arquitectura (4)** |
| 11:03 | Compuerta base: `npx vitest run` | **988 archivos / 12,976 pasan / 6 saltadas / 0 fallan**, exit 0 — idéntica al cierre de la continuación 2, que confirma que el árbol no se movió |
| 11:06 | Compuerta base: `npx tsc --noEmit -p .` | exit 0, sin salida |
| 11:06 | Compuerta base: `npm run lint` | **0 errores**, 154 avisos, exit 0 |
| 11:07 | Lanzados los 3 auditores en un solo mensaje (paralelo real) | fiscal · legal · arquitectura |
| 11:10 | Cotejo de deriva sin publicar (trabajo del orquestador, no de un auditor) | Último `[deploy]` en asunto sigue siendo `cfa00ab` (10-sep). **CUARTO día.** `git diff --name-only cfa00ab origin/master -- src/ supabase/` → **21 archivos**, entre ellos `cuadre/desde_db.ts` (ARQ-C2, el cubo del 15 %) y `sat_descarga/ciclo.ts` (AG-C1) |
| 11:14 | Reverificación del orquestador de **ARQ-C1** (9ª aparición en la 31) | **Abierto e intacto → 10ª aparición.** `src/app/api/export/poliza/route.ts:363-367` mete al arreglo `bloqueos` cualquier liquidación `ajustada` cuyo desglose no cuadre, y `:394-402` corta el export **del periodo completo** con 409 en cuanto `bloqueos.length > 0`. Verificado leyendo el archivo, no heredado del reporte |
| 11:28 | **legal.md entregado** (327 líneas) | Nota **3 = 3**, «ninguna de las tres razones aplica». 16/16 abiertos reconfirmados, 0 cerrados, 0 mal reportados. **1 nuevo: LEG-32-A1 [ALTO]** |
| 11:32 | Verificación adversarial del orquestador sobre **LEG-32-A1** | **CONFIRMADO.** `grep -rn oposicion_automatizada src/ supabase/migrations/` → **un solo escritor** (`processor.ts:354`); lectores solo en `repo.ts:160`, el motor de cuadre y los agregados SQL (`0150:341`, `0174:51`, `0348:193`, `0321`, `0354`). `privacidad.ts:788/:809/:817/:824` ofrecen oposición en **cuatro** finalidades distintas; ni `0325` (jornada), ni `sincronizar_eventos.ts`, ni `sincronizar_gps.ts`, ni `posiciones.ts` consultan la columna |
| 11:41 | **fiscal.md entregado** (597 líneas) | Nota **3 = 3**, «ninguna de las tres razones aplica». CRÍTICO 2 (2 reincidentes) · ALTO 5 (1 nuevo) · MEDIO 8 (1 nuevo) · BAJO 4 |
| 11:45 | Verificación adversarial de **FIS-C1** (CRÍTICO, el que clava el ancla en 3) | **CONFIRMADO.** `preguntas.ts:239` mete `regimenElegible` en el patch; `onboarding/page.tsx:67` lo persiste con `guardarPerfilPatch` **antes** de que el guardia de la clave del SAT (`repo.ts:1616-1632`) corra en `:70`. El `DatoInvalido` se atrapa en `:72-74` y sale como error de pantalla, pero el perfil —«la fuente que MANDA», dice el propio comentario de la 29— ya quedó escrito |
| 11:48 | Verificación adversarial de **FIS-A5** (ALTO, NUEVO) | **CONFIRMADO.** `carta_porte.ts:74` declara `materiaExcluida: boolean` sin estado «no declarado», y `carta_porte_datos.ts:202` lo llena con `hazmat === true`: un hazmat sin declarar colapsa a «no excluida» y `carta_porte_wa.ts:99-103` manda «sale SIN complemento» citando la RMF 2.7.7.2.1. La salvedad de materias excluidas existe solo en `vista.tsx:57-58`, no en el WhatsApp ni en la hoja imprimible |
