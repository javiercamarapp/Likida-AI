# Progreso — auditoría 32, continuación del 17-sep-2026

Una línea por acción, con su sha. Se escribe **mientras** avanza, no al cerrar:
un diario que se escribe al final no existe cuando se necesita.

| Hora (UTC) | Acción | Resultado / sha |
|---|---|---|
| 10:47 | `list_pull_requests(javiercamarapp/cuadra, open)` vía MCP (no hay `gh` en la imagen) | **#477 abierto**, rama `claude/auditoria-32` → **RONDA DE CONTINUACIÓN**, no se abre PR nuevo. (#478 es de normativa, no de auditoría) |
| 10:48 | `git ls-remote origin master` (paso obligatorio que dejó la continuación 2 de la 31) | `69becdb` — ref fresco, coincide con el HEAD del clon |
| 10:48 | `git fetch origin master claude/auditoria-32` + `checkout -B claude/auditoria-32` | rama en `09915aa`; árbol limpio → **autofix habilitado** |
| 10:49 | `git merge-base HEAD origin/master` / `git log HEAD..origin/master` | `69becdb` / **vacío** → la rama está al día con master, **sin conflicto**. `origin/master` no se movió desde ayer |
| 10:50 | `git diff --stat origin/master..HEAD -- src/ supabase/ .github/` | **4 archivos**, todos de `f0645f9` (migración 0357 + su prueba SQL + cableado en `ci-postgres.yml` + entrada EXENTAS) → el único rubro con código cambiado es **modelo de datos** |
| 10:52 | `pull_request_read(get_check_runs, #477)` | **12/12 verde**, incluido «Migraciones + aislamiento (Postgres efímero)» que corre la prueba nueva. Sin CI roja que atender |
| 10:55 | `npm ci` (el clon no traía `node_modules`) | exit 0. **INFRA, no es fallo del código** |
| 11:00 | `docs/auditoria-32/MAPA-continuacion.md` escrito | Rotación decidida: **agéntico (4) · tool calling (5) · backend (6)** por rotación + **modelo de datos (7)** por código cambiado |
| 11:02 | Compuerta base: `npx tsc --noEmit -p .` | **exit 0**, sin salida |
| 11:03 | Compuerta base: `npm run lint` | **0 errores**, 154 avisos, exit 0 — idéntico al cierre de ayer |
| 11:06 | Lanzados los 4 auditores en un solo mensaje (paralelo real) | agéntico · tool calling · backend · datos |
| 11:06 | Compuerta base: `npx vitest run` | **988 archivos / 12,975 pasan / 6 saltadas / 1 FALLA** en 152.75 s. La que falla es `src/app/api/cron/asistencia/route.test.ts:210` — **el intermitente preexistente que documentó la 32**, no una regresión |
| 11:12 | Medición del intermitente documentado por la 32: 10 corridas de `cron/asistencia/route.test.ts` | **4 de 10 en ROJO** (la 32 lo estimó en 1 de 5). Causa raíz probada: `margen = 9·TPC + 2·TEW = 105,500 ms` y el peor caso de la aserción es **exactamente** 105,500 ms → holgura **0 ms**; la prueba falla si el reloj avanza 1 ms entre su `Date.now()` y el `entrada` de `route.ts:42` |
| 11:14 | Reverificación del orquestador de **ARQ-C1** (10ª aparición en la 32) | **Abierto e intacto → 11ª aparición.** `export/poliza/route.ts:363-367` + `:392-402`: una sola liquidación bloqueada corta el export del periodo completo con 409 |
| 11:15 | Cotejo de deriva sin publicar | Último `[deploy]` en asunto sigue siendo `cfa00ab` (**10-sep, 7 días**). **QUINTO día.** `git diff --name-only cfa00ab origin/master -- src/ supabase/` → **21 archivos**, con `cuadre/desde_db.ts` (ARQ-C2) y `sat_descarga/ciclo.ts` (AG-C1) dentro |
| 11:16 | **backend-continuacion.md entregado** | Nota **6 = 6**, «ninguna de las tres razones aplica». 2 ALTO reincidentes · 1 MEDIO nuevo · 1 BAJO. **0 CRÍTICOS.** Refutó que «cron que falla y late ok» fuera una clase: lo persiguió en los once crons y solo `purgar` lo tiene |
| 11:17 | **agentico-continuacion.md entregado** | Nota **4 → 3**, *mirada más profunda*. 7 ALTO · 2 MEDIO · 3 BAJO, **0 CRÍTICOS**. 9 reincidentes + 3 nuevos |
| 11:18 | Verificación adversarial del nuevo ALTO de agéntico (`processor.ts:1689`/`:1941`) | **CONFIRMADO en el código:** las dos ramas hacen `soltarClaim()` sin `sinConsumirIntento`, y ese parámetro (`:1526`) **no se pasa `true` en ningún sitio del repo**. El mensaje que promete la respuesta existe: `oficina_wa.ts:302` |
| 11:19 | **datos-continuacion.md entregado** | Nota **7 → 5**, *deuda que cobró factura*. **2 CRÍTICOS**, 1 ALTO, 4 BAJOS. Los dos críticos son **regresiones de la 0357 de ayer**, medidas contra Postgres |
| 11:20 | Verificación adversarial de **DAT32C-C1** y **DAT32C-C2** | **LOS DOS CONFIRMADOS línea por línea:** `ocr.ts:560` (`rfc = rfcDvOk ? rfcLeido : undefined`), `0357:90` (partición con emisor), `0355:110` (partición sin él) y `0355:30` (el `nullif` ya calculado) |
| 11:22 | Postgres 16.13 efímero propio + andamio + migraciones | **334 aplicadas limpias**. `/usr/lib/postgresql/16/bin`, `su postgres`, datadir en `/var/tmp` (en el scratchpad `initdb` falla mudo: postgres no puede atravesar el directorio) |
| 11:24 | Sonda propia de **DAT32C-C1** | **REPRODUCIDO:** dos fotos del mismo ticket de $2,500, RFC leído en una sola → `total 5000.00` (la verdad es 2500) |
| 11:26 | Sonda propia de **DAT32C-C2** | **REPRODUCIDO:** mismas dos filas → motor `5000.00` contra panel `2500.00` / IVA `344.83`, celda única con `rfcEmisor ESA030303CCC`. La estación B desaparece |
| 11:30 | TDD C1: `supabase/tests/0358_dedup_emisor_ocr_nulo.sql` | **ROJO medido:** `total=5000.00 (esperado 2500)` |
| 11:34 | Arreglo C1: migración **0358** — el emisor hereda el del grupo vía `min() over` cuando es NULL | **VERDE.** Las pruebas de la 0357 y la 0349 siguen verdes |
| 11:36 | Mutación de C1 en los DOS sentidos | con la 0357 → ROJO (`5000` vs 2500) · con la 0349 → ROJO (caso mixto `3500` vs 4500). **La prueba no es vacua** |
| 11:40 | Suite completa · arreglo 1 | **988 archivos / 12,976 pasan / 6 saltadas / 0 fallan**, exit 0 |
| 11:41 | Commit atómico del arreglo 1 | **`53740a1`** — DAT32C-C1, citando el ID del hallazgo |
| 11:44 | TDD C2: `supabase/tests/0359_panel_fiscal_dedup_emisor.sql` | **ROJO medido:** `panel=3500.00 (esperado 6000)` |
| 11:48 | Arreglo C2: migración **0359**, escrita desde `pg_get_functiondef` con UN cambio textual (no se reescriben 190 líneas a mano) | **VERDE.** Idempotente (aplicada dos veces) y ACL intacta: `service_role` conserva EXECUTE, `anon`/`authenticated` siguen sin él |
| 11:50 | Mutación de C2 en los DOS sentidos | con la 0355 → ROJO (`panel=3500`) · con la partición estilo 0357 → ROJO (`panel=6300`) |
| 11:53 | Cadena completa sobre **base virgen** nueva | **336 migraciones aplicadas limpias** |
| 11:55 | **Toda** la batería SQL de `ci-postgres.yml` sobre la base virgen | **21 de 21 verdes.** La única roja es `wa_leases_fencing.sql`, que pide pgTAP y aquí no está instalado — **INFRA, no código** |
| 11:57 | `tsc --noEmit` y `lint` tras los dos arreglos | exit 0 · 0 errores, 154 avisos |
