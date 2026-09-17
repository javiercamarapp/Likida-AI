LIGERA: fiscal, legal, arquitectura — 3 rubros rotados de 12, 1 arreglo retenido con prueba (ARQ-A3, CRÍTICO), 0 revertidos, global 4.7 → 4.7 (=).

---

# Ronda del 16-sep-2026 — LIGERA

- **Tipo:** ronda **LIGERA de rotación**, decidida antes de gastar un token en
  auditores: `list_pull_requests(open)` → **`[]`** (el PR #462 de la 31 está
  mergeado en `8b01aec`) y `git log 8b01aec..HEAD -- src/ supabase/ normas/` →
  **vacío**. Sin PR abierto y sin commits en las rutas vigiladas, la regla manda
  3 rubros por rotación. Rama nueva `claude/auditoria-32` sobre `69becdb`.
  Árbol limpio → autofix habilitado.
- **Rotaron los tres de nota más baja fuera de los cinco reauditados en las
  continuaciones del 14 y 15-sep:** fiscal (3), legal (3) y arquitectura (4).
  El empate en 4 contra **sistema agéntico** se rompió a favor de arquitectura
  por el lead de ARQ-A3 que dejó escrito la continuación 1; sistema agéntico
  queda **primero en la cola de la 33**.
- **Los 3 entregaron**, ninguno relanzado, ninguno vacío. **Las tres notas se
  quedaron quietas y las tres escribieron «ninguna de las tres razones
  aplica»** con su conteo detrás.
- **Global: 4.7** (antes **4.7**) · **= 0.0**.
- **El resultado de la ronda: ARQ-A3 dejó de ser irreproducible.** Llevaba dos
  rondas sin poder ejecutarse por vivir en una función SQL. Los binarios de
  PostgreSQL 16 **sí** están en la imagen —en `/usr/lib/postgresql/16/bin/`,
  fuera del PATH, por eso `which` engaña— y con la receta del job de
  `ci-postgres.yml` **las 333 migraciones aplican limpias sobre base virgen**.
  Dos tickets de diésel en efectivo de $2,500 de estaciones distintas con folio
  1234 contaban como uno: `total $1,397,500` contra $1,400,000 y, lo que la 31
  no tenía, **el tope del 15 % también se deforma** ($209,625 contra $210,000),
  así que `cupoRestante` salía $3,625 donde debe ser $1,500 y el PDF declaraba
  deducibles $2,500 cuando $1,000 no lo eran.
- **Arreglado: 1** (`f0645f9`, ARQ-A3, CRÍTICO), migración 0357 + prueba en
  `supabase/tests/` cableada en `ci-postgres.yml`. Rojo medido → verde, con
  **mutación verificada en los dos sentidos** (sin el arreglo: total=2500 de
  5000; con el dedup apagado: total=6400 de 5700). **Revertidos: 0.**
- **Pendientes con razón escrita: 4 críticos** — ARQ-C1 (10ª aparición),
  LEG-31-C1, LEG-C1, FIS-C1/FIS-C2. Cada uno con el porqué en la síntesis.
- **Hallazgo del orquestador que ningún auditor pidió:**
  `cron/asistencia/route.test.ts` es **intermitente y preexistente** — falla
  **1 de cada 5 corridas sobre HEAD sin tocar nada** (verificado con
  `git stash`). El margen derivado tiene cero holgura y la aserción se voltea
  por 1 ms. **No se tocó**: sus rubros dueños no se rotaron hoy.
- **Lo que urge y no es código, CUARTO día:** el último `[deploy]` en asunto
  sigue siendo `cfa00ab` (10-sep) y ya son **21 archivos** de `src/` en `master`
  sin llegar a producción, entre ellos el cubo del 15 %. Redeploy en Vercel.
  Notificado al dueño.
- **Compuerta al cerrar:** `npx vitest run` **988 archivos / 12,976 pasan / 6
  saltadas / 0 fallan** en 2 de 3 corridas (la 3ª trae el intermitente
  preexistente) · `tsc --noEmit` exit 0 · `lint` 0 errores, 154 avisos.
  `npm run build` no corre en la nube.
- **Tablero:** `tablero.html` + `tablero.png`, capturado **y mirado** — mirarlo
  encontró que la tarjeta de la compuerta decía «verde · 0 fallan» copiando la
  línea base y callando el intermitente. Corregido y recapturado.
- **PR:** #477, `claude/auditoria-32`, verificado en la salida de
  `list_pull_requests(open)`.

---

# Continuación del 17-sep-2026 — CONTINUACIÓN

CONTINUACIÓN (17-sep-2026): 4 rubros rotados, 3 arreglos retenidos con prueba y mutación en los dos sentidos (2 CRÍTICOS + 1 ALTO), 0 revertidos, global 4.7 → 4.3 (▼0.4).

- **Tipo:** ronda de **CONTINUACIÓN**, decidida antes de gastar un token en
  auditores: `list_pull_requests(open)` → **PR #477 abierto** (rama
  `claude/auditoria-32`) → se continúa sobre él, **no se abre PR nuevo**.
  `git ls-remote origin master` → `69becdb`, fresco; `git log HEAD..origin/master`
  → **vacío**: master no se movió desde la 32. Árbol limpio → autofix habilitado.
  CI del PR al arrancar: **12/12 verde**, sin conflicto.
- **Auditores: 4 de 12.** Tres por rotación —**sistema agéntico (4)**, **tool
  calling (5)** y **backend (6)**, los tres más bajos sin auditar desde el
  13-sep— y **modelo de datos (7)** por la cláusula de código cambiado: la
  migración 0357 de ayer fue lo único que se movió. Con estos cuatro, los doce
  rubros quedan cubiertos dentro de la ventana 13→17 de septiembre.
- **El resultado de la ronda, y es el que importa: el arreglo de ayer traía dos
  regresiones CRÍTICAS, y las encontró el auditor cuyo código había tocado.**
  La migración 0357 (ARQ-A3) metió `rfc_emisor` a la llave de dedup, que es el
  único campo de esa llave que el OCR puede perder entero (`ocr.ts:560`):
  - **DAT32C-C1** — dos fotos del MISMO ticket de $2,500 con el RFC leído en una
    sola sumaban **$5,000**; el PDF negaba $375 de deducción legítima.
  - **DAT32C-C2** — el arreglo cerró una de las **dos** copias del predicado: el
    motor del 15 % decía $5,000 y el panel del contador **$2,500 con $344.83 de
    IVA** sobre las mismas filas, con la segunda estación desapareciendo de la
    celda. Es lo que CLAUDE.md prohíbe: una cifra fiscal que se lee distinto en
    dos pantallas.
  Los dos reproducidos por mí con sonda propia contra Postgres 16 antes de tocar
  nada. **Segunda ronda seguida en que un auditor encuentra que el arreglo del
  orquestador no cerraba** — y el argumento más fuerte a favor de rotar por
  derecho propio el rubro cuyo código tocó la auditoría anterior.
- **Arreglado: 3**, en 3 commits atómicos, cada uno con prueba que lo reproduce,
  rojo medido → verde, mutación verificada en los dos sentidos y suite completa
  entre uno y otro. **Revertidos: 0.** Tope de 3 vueltas gastado.
  - `53740a1` — **DAT32C-C1 (CRÍTICO)**, migración 0358: el emisor discrimina
    solo cuando se conoce; una fila sin emisor hereda el del grupo.
  - `5c1734e` — **DAT32C-C2 (CRÍTICO)**, migración 0359: la misma semántica
    portada al panel fiscal, escrita desde `pg_get_functiondef` con un único
    cambio textual.
  - `4b84716` — **PRU32C-A1 (ALTO)**: el intermitente que la 32 dejó anotado no
    era ruido del runner. Medido **4 de 10 rojas**, causa raíz aritmética
    (holgura **exactamente 0 ms** en dos aserciones), **0 de 25** después, con
    mutación que prueba que no perdió los dientes.
- **Propuesto y NO arreglado, con la razón escrita:** **DAT32C-A1 (ALTO)** — el
  espejo TS↔SQL de `desde_db.ts:184`. Arreglarlo exige tocar
  `copiasDeComprobante`, que corre sobre UN viaje, donde su criterio es el
  correcto: es un rediseño, no un parche de madrugada.
- **Global: 4.3** (antes **4.7**) · **▼0.4**. Bajan 3 (datos ▼2, tool calling ▼1,
  agéntico ▼1), se quedan 9. **Los tres movimientos traen número contable**, que
  era la acción que la 31 dejó escrita y la 32 volvió default.
- **Lo que urge y no es código, QUINTO día:** último `[deploy]` en asunto sigue
  siendo `cfa00ab` (10-sep, hace 7 días); **21 archivos** de `src/`/`supabase/`
  en master sin llegar a producción, entre ellos el cubo del 15 %. Redeploy en
  Vercel. Notificado al dueño.
- **Compuerta al cerrar:** `npx vitest run` **988 archivos / 12,976 pasan / 6
  saltadas / 0 fallan**, exit 0 · `tsc --noEmit` exit 0 · `lint` 0 errores, 154
  avisos · Postgres 16: **336 migraciones limpias sobre base virgen, 21/21
  pruebas SQL**. `npm run build` no corre en la nube.
- **Tablero:** `tablero-continuacion.html` + `.png`, capturado **y mirado** —
  mirarlo encontró que la tarjeta de la compuerta desbordaba su caja. Corregido
  y recapturado.
- **PR:** #477, `claude/auditoria-32`, actualizado con `push --force`.
