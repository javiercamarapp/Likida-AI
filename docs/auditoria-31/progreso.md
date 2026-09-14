# Progreso — auditoría 31 (13-sep-2026)

Una línea por acción, escrita mientras avanza.

| Hora (UTC) | Acción | Resultado |
|---|---|---|
| 10:52 | `list_pull_requests(open)` | `[]` — cero PRs abiertos → no aplica continuación |
| 10:52 | `git log 5ce91b2..HEAD -- src/ supabase/ normas/` | 2 commits, **solo** `normas/.latido-*` → ronda COMPLETA por regla, ventana sin código |
| 10:53 | `git checkout -b claude/auditoria-31` | sobre `master` = `4047a50`; árbol limpio → **autofix habilitado** |
| 10:54 | `npm ci` | exit 0 (el clon de la nube no traía `node_modules`) — INFRA de la corrida, no fallo |
| 11:01 | `docs/auditoria-31/MAPA.md` | escrito **sin ninguna frase que sugiera dirección para las notas** (acción de cierre de la 30) |
| 11:06 | `npm test` (línea base) | **984 archivos / 12,934 pasan / 6 saltadas**, exit 0, 187.20 s |
| 11:02 | `npm run typecheck` (línea base) | exit 0 |
| 11:06 | `npm run lint` (línea base) | exit 0 — **0 errores, 154 avisos** |
| 11:07 | 12 auditores lanzados en un solo mensaje | contexto fresco, uno por rubro, ninguno toca código |
| 11:08 | `npm run lint:ratchet` | `154/194 heredados; 0 nuevos; 0 errores`, exit 0 |
| 11:16 | Entrega **operabilidad** (7 → 5) | 1 CRÍTICO · 6 ALTO · 5 MEDIO · 1 BAJO |
| 11:18 | **Verificado por el orquestador con comando:** los arreglos de la 30 están en `master` y **no en producción** | último `[deploy]` en asunto = `cfa00ab` (10-sep); `git diff 4e36c82..5ce91b2 -- src/` = `cuadre/desde_db.ts` + `sat_descarga/ciclo.ts`, sin bandera → **notificado al dueño de inmediato** |
| 11:32 | Entrega **agéntico** (4 → 4), **arquitectura** (3 → 4), **fiscal** (3 → 3), **legal** (4 → 3) | AG-C1, ARQ-C2 y ARQ-A1 verificados **cerrados de verdad** por dos auditores por separado |
| 11:34 | **Defecto del propio método, verificado:** `git cat-file -t b740fe0 / 7a9b087 / 7d5bcdc` → `Not a valid object name` en los tres | el PR de la 30 entró **aplastado** en `5ce91b2`; su `RESULTADO.md` cita 3 shas que no existen, y mi `MAPA.md` los propagó. Lo levantó el auditor de arquitectura |
| 11:20 | **Trampa detectada:** `git check-ignore docs/auditoria-31/MAPA.md` → `.gitignore:36 docs/auditoria-*/` | la ronda entera cae en ruta **ignorada**; los 18 archivos de la 30 están rastreados solo porque se forzaron. **Commitear con `git add -f`** o el PR sale vacío sin avisar |
| 12:10 | Entregan los 12 | 148 hallazgos · 13 críticos · 89 reincidentes · árbol limpio (el auditor de pruebas revirtió sus 45 mutaciones) |
| 12:16 | **PRU-31-C2 verificado** abriendo `config.ts:129`, `engine.ts:754`, `desde_db.ts:215` y el test de la 24 | reproducido: `2000→20000` deja **593 pruebas verdes** — el hallazgo es real |
| 12:18 | Ancla nueva en `tope_efectivo_default.test.ts` | 9 verdes en limpio; con la mutación mueren 4 de las 5 nuevas → **rojo medido → verde** |
| 12:21 | `npm test` completo | 984 archivos / **12,939** pasan / 6 saltadas, exit 0 |
| 12:22 | **`fd66be6`** — arreglo de PRU-31-C2 retenido | commit atómico, un solo hallazgo |
| 12:24 | **AG-31-A1 verificado** en `processor.ts:4804`, el hermano `:1187`, `pdfEstadoDe` y `client.ts:550-571` | prueba que lo reproduce: 2 rojas + control verde |
| 12:27 | Arreglo de AG-31-A1 → verde en su archivo (37/37)… | …pero `npm test` completo **2 rojas**: `presupuesto.test.ts` y `processor_cadena.test.ts` |
| 12:29 | Causa raíz del rechazo: un 400 de Meta sin `code` da `codigo: undefined` → `pdfEstadoDe` dice «encolado», y ese caso **no** se encola | el arreglo habría sellado como entregado un PDF perdido |
| 12:30 | **Revertido** `processor.ts` + su test (`git checkout --`) | AG-31-A1 vuelve a **pendiente** con la razón escrita; árbol limpio en `fd66be6` |
| 12:31 | **Hallazgo nuevo** salido del intento: `pdfEstadoDe` es insegura y `processor.ts:1192` ya la usa **en producción** | propuesto, no tocado: arreglarlo cambia el contrato de `sendDocument` (4 emisores) |
| 12:34 | `tablero.html` + captura | primera captura **truncada** a 2,560 px → recapturada a 3,600 px; mirada: 12 rubros, suma 57, global 4.8 |
| 12:40 | `00-SINTESIS.md` y `RESULTADO.md` | cierre |

---

# Continuación — 14-sep-2026 (misma rama, mismo PR #462)

| Hora (UTC) | Acción | Resultado |
|---|---|---|
| 10:56 | `list_pull_requests(open)` vía MCP (no hay `gh` en esta imagen) | **PR #462 abierto**, rama `claude/auditoria-31` → **RONDA DE CONTINUACIÓN** por regla, no ronda nueva |
| 10:56 | `git log 4e36c82..HEAD -- src/ supabase/ normas/` | 3 commits, todos ya dentro de la 31 → `origin/master` sigue en `4047a50`: **el código de master no se movió desde que los 12 escribieron** |
| 10:57 | Inventario de rubros | los **12 archivos existen** → 0 auditores a relanzar por archivo faltante; 0 por código cambiado. La ronda vale por el **presupuesto de arreglo**, no por auditar de nuevo |
| 10:58 | `npm ci` | exit 0 (el clon de la nube no traía `node_modules`) — INFRA de la corrida, no fallo |
| 11:07 | Compuerta base | `npm test` **984 / 12,939 pasan / 6 saltadas**, exit 0 · `tsc` exit 0 · `lint` 0 errores / 154 avisos. Idéntica a la del cierre de la 31 → confirma árbol sin cambios |
| 11:05 | **Verificado con comando, sigue vivo hoy:** los arreglos de la 30 están en `master` y **no en producción** | último `[deploy]` en asunto = `cfa00ab` (10-sep); `git diff --stat cfa00ab..origin/master -- src/ supabase/` = `cuadre/desde_db.ts` + `sat_descarga/ciclo.ts` (+3 tests). Segundo día consecutivo |
| 11:10 | **REN-31-C1 verificado** abriendo `route.ts:58`, `asistencia_escalamiento.ts:200-360`, `presupuesto.ts:399` | reproducido: `venceEn + 91.5 s = 186.5 s` contra `maxDuration = 120`. Las 2 pruebas nuevas **rojas** (`expected 1789384420984 to be less than or equal to 1789384349484`) |
| 11:12 | Arreglo REN-31-C1 → 31/31 verdes en sus dos archivos | margen derivado + `acotada()` en el `select` de `viaje` |
| 11:14 | **Mutación en los dos sentidos** | literal `15` de vuelta → 2 rojas; sin `acotada()` → 1 roja. Restaurado, 31/31 |
| 11:20 | `npm test` completo + `tsc` + `lint` + `ratchet` | 984 / **12,943** pasan, exit 0 · tsc 0 · 0 errores · 0 nuevos |
| 11:21 | **`f4fde69`** — arreglo de REN-31-C1 retenido | commit atómico, un solo hallazgo. **Vuelta 1 de 3** |
| 11:23 | **REN-30-C1 verificado** en `consolidado.ts:749-912` y `peajes/page.tsx:225` | cero `Date.now()` en el bucle; el hermano `cobranza/page.tsx:117` sí presta reloj. 3 pruebas nuevas **rojas** |
| 11:26 | Arreglo REN-30-C1 → 13/13 verdes | `venceEn` + `cortadosPorReloj`; `revisadas` pasa a contarse. 7 aserciones viejas actualizadas al contrato nuevo |
| 11:28 | **Mutación** (`if (false)` en el chequeo de reloj) | 2 de 3 rojas → la prueba muerde. Restaurado |
| 11:30 | `npm test` completo | 984 / **12,946** pasan, exit 0 |
| 11:31 | **`54bddb2`** — arreglo de REN-30-C1 retenido | **Vuelta 2 de 3** |
| 11:34 | **OP-A6 reproducido con la historia real** | `git log cfa00ab..origin/master -- src/ supabase/` → `5ce91b2`, el merge de la 30 con los dos archivos fiscales. El cotejo viejo sale 0 sobre exactamente eso |
| 11:36 | Prueba de cableado **roja** antes del paso nuevo | `expected '# El consumidor de /api/health…' to contain 'deriva-sin-desplegar.mjs'` |
| 11:40 | Arreglo OP-A6 → 8/8 verdes; YAML validado con `yaml.safe_load` | el detector corrido contra la historia real nombra `5ce91b2` |
| 11:44 | `npm test` completo + `tsc` + `lint` + `ratchet` | **985** archivos / **12,954** pasan / 6 saltadas, exit 0 · tsc 0 · 0 errores / 154 avisos · 0 nuevos |
| 11:45 | **`30e5e14`** — arreglo de OP-A6 retenido | **Vuelta 3 de 3 — tope de presupuesto gastado** |
| 11:47 | `MAPA-continuacion.md`, **neutral por diseño** | cumple la acción de cierre de la 31: ninguna frase sugiere dirección para las notas; se pide un número contable detrás de cada movimiento |
| 11:48 | 2 auditores relanzados en un solo mensaje | **rendimiento** y **operabilidad** — los únicos dos rubros cuyo código cambió. Escriben `<rubro>-continuacion.md`; el archivo de la 31 se conserva para leer el delta |
| 11:05 | **Dato de entorno nuevo, sin confirmar:** hay binarios de PostgreSQL 16 (`/usr/lib/postgresql/16`) y `docker` en la imagen, sin servidor corriendo | las rondas anteriores asumieron que `supabase/tests/*.sql` no se podía correr en la nube. Queda como lead para la 32, no como hecho |
