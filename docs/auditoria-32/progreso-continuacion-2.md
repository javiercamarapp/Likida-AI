# Progreso — auditoría 32, continuación 2 (18-sep-2026)

Se escribe **mientras** avanza, no al cerrar. Una línea por acción, con su sha.

---

## Arranque

| Hora (UTC) | Acción | Resultado |
|---|---|---|
| — | `git ls-remote origin master` | `69becdb` — **fresco**, igual al HEAD del clon |
| — | `list_pull_requests(open)` | #477 (`claude/auditoria-32`, auditoría, **abierto**), #478 y #479 (normativa, no auditoría) |
| — | **Decisión de ronda** | **CONTINUACIÓN** sobre #477. No se abre PR nuevo. |
| — | `git checkout -B claude/auditoria-32 origin/claude/auditoria-32` | HEAD = `65dbb9a` |
| — | `git log claude/auditoria-32..origin/master` | **vacío** — sin conflicto, master no se movió |
| — | `git status --short` | **vacío** → árbol limpio → **autofix habilitado** |
| — | `npm ci` | exit 0 · 614 paquetes · **0 vulnerabilidades** (el clon llegó sin `node_modules`) |

## Línea base de la compuerta

```
$ npx vitest run
 Test Files  988 passed (988)
      Tests  12976 passed | 6 skipped (12982)
   Duration  136.26s
VITEST_EXIT=0

$ npx tsc --noEmit -p .
TSC_EXIT=0        (sin salida)

$ npm run lint
✖ 154 problems (0 errors, 154 warnings)
LINT_EXIT=0
```

**Idéntica, cifra por cifra, al cierre de ayer** (988 / 12,976 / 6 / 0 · tsc 0 ·
lint 0 errores, 154 avisos). Eso confirma que el árbol no se movió entre rondas.

**El intermitente de `cron/asistencia/route.test.ts` NO reapareció** en esta
corrida — consistente con que `4b84716` lo cerró ayer (0 de 25 rojas medidas).

`npm run build` **no se corre** en la nube: pide Supabase, OpenRouter, Facturapi
y Upstash.

## Auditores

Seis, lanzados en un solo mensaje para que corran de verdad en paralelo, cada
uno con contexto fresco, su sección de `references/rubros.md`, su nota previa y
sus hallazgos abiertos. Ninguno toca código.

| Rubro | Por qué entra | Archivo |
|---|---|---|
| Frontend | archivo falta en la 32 | `frontend.md` |
| Seguridad | archivo falta en la 32 | `seguridad.md` |
| Pruebas | archivo falta **y** su código cambió (`4b84716`) | `pruebas.md` |
| Operabilidad y DX | archivo falta en la 32 | `operabilidad.md` |
| Rendimiento y costo | archivo falta; el que lleva más sin tocarse (14-sep) | `rendimiento.md` |
| Modelo de datos | **cláusula de código cambiado**: 0358 y 0359 son el arreglo a sus propios CRÍTICOS | `datos-continuacion-2.md` |

Los otros seis (backend, agéntico, tool calling, arquitectura, fiscal, legal)
conservan su nota y van marcados **`no auditado esta ronda`**.

---

## Verificación y arreglos

### Entregas de auditores

| Rubro | Nota | Δ | CRÍTICOS | Resumen |
|---|---|---|---|---|
| Operabilidad y DX | 4 | = | 2 (1 nuevo) | cierra `OP-A6` tras 6 rondas; el mismo arreglo trajo `OP-32C2-C1` |
| Frontend | 5 | = | 0 nuevos | 13 abiertos verificados → 1 cerrado, 12 reincidentes, 3 nuevos |
| Seguridad | 4 | ▼1 | 0 | deuda que cobró factura: `andamio_ci.sql:99-104` |
| Rendimiento y costo | 4 | = | 1 (reincidente) | 4 de 6 abiertos cerraron; el ancla se cumple en 9 cadenas |
| Pruebas | 5 | ▼1 | 2 (1 nuevo) | mirada más profunda: 8 rondas sin mutar SQL |
| Modelo de datos | 6 | ▲1 | 0 | se atacó y subió: 0358 y 0359 cerraron de verdad |

### Arreglo 1 — `2c38766` · OP-32C2-C1 (CRÍTICO)

`.github/workflows/salud-produccion.yml:226` + `scripts/ci/deriva_sin_desplegar.test.ts`

| Paso | Resultado |
|---|---|
| Verificación del hallazgo | **CONFIRMADO** abriendo el archivo: el cierre en `:213` no llevaba la guarda de evento; el paso hermano de `:292` sí la lleva desde la auditoría 27 |
| Rojo medido ANTES | `× el cierre de la deriva NO se dispara cuando el detector no midió` — reproduce el caso real de la corrida #671 |
| Verde DESPUÉS | 20/20 en el archivo |
| Mutación A (quitar la guarda de evento) | **roja** — `el cierre no repite la guarda del detector` |
| Mutación B (quitar el `format()`) | **roja** — `una salida que nadie escribió no es una medición` |
| Suite completa | **988 archivos · 12,979 pasan · 6 saltadas · 0 fallan** · exit 0 (+3 pruebas nuevas) |
| `tsc` / `lint` | exit 0 · 0 errores, 154 avisos (sin cambio) |

**Lo que la prueba prueba y lo que no.** Evalúa la condición real del paso bajo
las reglas de coerción documentadas de GitHub (`null == '0'` → verdadera), no
hace `grep` del fuente. Lo que **no** puede hacer aquí es ejecutar GitHub
Actions: la evidencia de comportamiento es la corrida #671 medida por el
auditor y el precedente de la auditoría 27 sobre el paso hermano.

De paso se relajó la aserción de `:206-210`, que fijaba la comparación rota
literalmente — era la que canonizaba el defecto.


### Arreglo 2 — `fc811a0` · REN-30-C2 (CRÍTICO, reincidente desde la 29)

`pg.ts` · `intake/consolidado.ts` · `sat_descarga/ciclo.ts` (+3 archivos de prueba)

| Paso | Resultado |
|---|---|
| Verificación del hallazgo | **CONFIRMADO** abriendo los archivos: `consolidado.ts:473` llamaba `candidatosDeGasto` sin reloj; `ciclo.ts:341` despachaba tras el único chequeo de `:277`; `pg.ts` PAGINA=1,000 × MAX_PAGINAS=100 |
| Rojo medido ANTES | pidió **100 páginas** donde deben ser 0 |
| Verde DESPUÉS | 23/23 en `pg.test.ts`, 8/8 en el orquestador, 22/22 en `ciclo_flota` |
| Mutación A (`consolidado` no pasa `venceEn`) | **roja** |
| Mutación B (`ciclo` no pasa `venceEn`) | **sobrevivió** en el primer intento → se escribió la prueba de cableado → **roja** |
| Suite completa | 988 archivos · 12,987 pasan · 0 fallan · exit 0 |

La mutación B sobreviviendo es el dato de la ronda: las dos primeras pruebas
pasaban en verde con el cableado desconectado. Es `PRU-31C-A1` aplicado a mi
propio arreglo antes de commitearlo.

### Arreglo 3 — `e47f974` · PRU-31C-A1 (ALTO, reincidente)

`src/app/dashboard/agentes/peajes/reloj-cableado.test.ts` (nuevo)

| Paso | Resultado |
|---|---|
| Verificación | **CONFIRMADO**: `grep barrerPorConciliar src/app --include=*.test.*` → **cero** resultados |
| Mutación 1 (la del auditor, `barrerPorConciliar(tenantId)`) | **2 pruebas rojas** |
| Mutación 2 (`venceEn: 0`, que desarma el corte igual) | **1 prueba roja** |
| `lint:ratchet` | 1 aviso nuevo en el primer intento → ruta literal en `readFileSync` → **0 nuevos** |
| Suite completa | 989 archivos · 12,990 pasan · 0 fallan · exit 0 |

## Cierre

| Artefacto | Estado |
|---|---|
| 6 archivos de rubro | escritos |
| `00-SINTESIS-continuacion-2.md` | escrito, con las 12 notas y la razón de cada movimiento |
| `tablero-continuacion-2.html` + `.png` | capturado **y mirado**; mirarlo encontró el eje con dos `c·1` |
| Compuerta final | 989 / 12,990 / 6 / 0 · tsc 0 · lint 0 errores · ratchet 0 nuevos |
| Arreglos | 3 retenidos, 0 revertidos, tope de 3 vueltas gastado |
