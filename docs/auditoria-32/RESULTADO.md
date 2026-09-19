LIGERA: fiscal, legal, arquitectura — 3 rubros rotados de 12, 1 arreglo retenido con prueba (ARQ-A3, CRÍTICO), 0 revertidos, global 4.7 → 4.7 (=).
CONTINUACIÓN (17-sep-2026): 4 rubros rotados, 3 arreglos retenidos con prueba (2 CRÍTICOS + 1 ALTO), 0 revertidos, global 4.7 → 4.3 (▼0.4).
CONTINUACIÓN 2 (18-sep-2026): 6 rubros rotados, 3 arreglos retenidos con prueba (2 CRÍTICOS + 1 ALTO), 0 revertidos, global 4.33 → 4.25 (▼0.08; suma 52 → 51, con un decimal 4.3 → 4.3).
CONTINUACIÓN 3 (19-sep-2026): 6 rubros reauditados, 3 arreglos retenidos con prueba y mutación en los dos sentidos (2 CRÍTICOS + 1 ALTO), 0 revertidos, global 4.25 → 4.0 (▼0.25; suma 51 → 48).

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


---

# Continuación 2 del 18-sep-2026 — CONTINUACIÓN

- **Tipo:** ronda de **CONTINUACIÓN**, decidida antes de gastar un token en
  auditores: `list_pull_requests(open)` → **PR #477 abierto** (rama
  `claude/auditoria-32`) → se continúa sobre él, **no se abre PR nuevo**.
  `git ls-remote origin master` → `69becdb`, fresco; `git log
  claude/auditoria-32..origin/master` → **vacío**: master no se ha movido desde
  el 16-sep. `mergeable_state: clean`. Árbol limpio → **autofix habilitado**.
- **Auditores: 6 de 12, y por la regla.** Cinco porque su archivo **faltaba** en
  `docs/auditoria-32/` —frontend, seguridad, pruebas, operabilidad y
  rendimiento— y **modelo de datos** por la cláusula de código cambiado: las
  migraciones 0358 y 0359 se escribieron DESPUÉS de que ese auditor entregara, y
  son el arreglo a sus propios dos CRÍTICOS. Con estos seis, los doce rubros
  quedan cubiertos en la ventana del 13 al 18 de septiembre.
- **El resultado de la ronda: por primera vez en tres, el arreglo del
  orquestador sobrevivió entero a la revisión del auditor cuyo código tocó.**
  0358 y 0359 **cerraron de verdad** — 336 migraciones limpias sobre base
  virgen, `pg_get_functiondef` diffeado, rojo en los dos sentidos, idempotentes,
  ACL intacta. La 31 había encontrado que 3 de 4 arreglos cerraban a medias; la
  32, que uno traía dos CRÍTICOS nuevos. **La regla se está pagando sola.**
- **El hallazgo metodológico:** pruebas baja 6 → 5 por *mirada más profunda* con
  número — llevaba **ocho rondas** calificándose sin haber mutado nunca una
  línea de SQL. Hoy se pudo: la función de dinero del panel fiscal se rompe en
  **cuatro** sitios con los 21 arneses SQL y los 243 bloques en verde. 26
  mutaciones, 9 mueren (34.6 %). No es que las pruebas empeoraran: es que por
  primera vez se vieron enteras.
- **Global: 4.25** (antes **4.33**) · **▼0.08**. Suma **52 → 51**. Con un
  decimal la cifra no se mueve (4.3 → 4.3), y se reporta con dos para no
  esconder el movimiento detrás del redondeo. Sube 1, bajan 2, se quedan 9.
- **Arreglado: 3**, en 3 commits atómicos, cada uno con prueba que lo reproduce,
  rojo medido → verde y **mutación verificada en los dos sentidos**.
  **Revertidos: 0.** Tope de 3 vueltas gastado.
  - `2c38766` — **OP-32C2-C1 (CRÍTICO)**: el cierre del issue de deriva se
    disparaba con el detector saltado (`null == '0'` es verdadera en GitHub) y
    dejó escrita una afirmación falsa sobre producción. Caso medido contra la
    fuente primaria: corrida #671, issue #474 cerrado a las 08:21:57Z y episodio
    reabierto como #476 a las 10:09:12Z → **ventana ciega de 1 h 47 min**
    (el auditor dijo 2 h 54; eso es lo que estuvo correctamente abierto).
  - `fc811a0` — **REN-30-C2 (CRÍTICO, reincidente desde la 29)**: el reloj de la
    invocación ahora llega hasta la lectura de candidatos del consolidado, que
    podía correr 100 páginas de `gasto` (hasta 950 s) dentro de un margen de
    43.5 s.
  - `e47f974` — **PRU-31C-A1 (ALTO, reincidente)**: el `venceEn` del «Ejecutar
    ahora» de Peajes deja de ser un argumento que ninguna prueba vigila.
- **Pendientes con razón escrita: 4 CRÍTICOS.** FE-C1 (8ª ronda) y OP-C1 (8ª)
  **no se arreglaron a propósito**: las dos salidas de cada uno son una decisión
  de producto, no un parche de madrugada. PRU32C2-C1 merece una ronda dedicada
  (son arneses SQL nuevos). PRU-C1 (5ª) tiene su causa raíz escrita: la puerta
  de cobertura excluye por configuración la capa donde el dinero se imprime.
- **Lo que urge y no es código, SEXTO día:** último `[deploy]` en asunto sigue
  siendo `cfa00ab` (10-sep, hace 8 días); **21 archivos** de `src/`/`supabase/`
  en master sin llegar a producción, entre ellos el cubo del 15 %. Redeploy en
  Vercel. **Novedad que lo empeora:** el único artefacto que lo gritaba (issue
  #476) se apagaba solo con el primer push a master — el merge de esta rama
  habría sido ese push. Con `2c38766` ya no.
- **Compuerta al cerrar:** `npx vitest run` **989 archivos / 12,990 pasan / 6
  saltadas / 0 fallan**, exit 0 · `tsc --noEmit` exit 0 · `lint` 0 errores, 154
  avisos · `lint:ratchet` **0 nuevos**. Línea base al arrancar 988 / 12,976,
  idéntica al cierre de ayer. `npm run build` no corre en la nube.
- **Tablero:** `tablero-continuacion-2.html` + `.png`, capturado **y mirado** —
  mirarlo encontró dos etiquetas `c·1` en el mismo eje, que hacían la serie
  ilegible. Corregido y recapturado.
- **PR:** #477, `claude/auditoria-32`, actualizado con `push --force`.


---

# Continuación 3 del 19-sep-2026 — CONTINUACIÓN

- **Tipo:** ronda de **CONTINUACIÓN**, decidida antes de gastar un token en
  auditores: `list_pull_requests(open)` → **PR #477 abierto** (rama
  `claude/auditoria-32`, draft, `mergeable_state: clean`, CI verde en los 5
  workflows) → se continúa sobre él, **no se abre PR nuevo**. `git ls-remote
  origin master` → `69becdb`, fresco y sin moverse desde el 16-sep. Árbol limpio
  → **autofix habilitado**.
- **Auditores: 6 de 12, y los seis por la MISMA cláusula** —código cambiado—
  porque los doce archivos de rubro existen: operabilidad, rendimiento y pruebas
  (el orquestador arregló su propio código el 18-sep), backend (`pg.ts` y
  `consolidado.ts` cambiaron de contrato), y fiscal y arquitectura (las
  migraciones 0358/0359 reescribieron el predicado de dinero después de que
  entregaran el 16-sep).
- **El resultado de la ronda: dos auditores independientes encontraron el mismo
  CRÍTICO por dos caminos distintos, y lo había metido esta rama.** Al alinear
  entre sí las dos funciones SQL, las migraciones 0358/0359 dejaron fuera la
  **tercera** definición del predicado —`copiasDeComprobante` en `engine.ts`, la
  que imprime el PDF—. Fiscal lo vio desde la norma (FIS-C3: el PDF niega una
  deducción que la RFA 2026 2.9 concede) y arquitectura desde la estructura
  (ARQ32C3-C2: sobre las mismas dos filas, el panel dice 2/$5,000/$689.66 y el
  PDF dice 1/$2,500 con un renglón «duplicado»). Los dos midieron contra
  Postgres 16 por su lado. **Cuarta ronda seguida en que el arreglo del
  orquestador no cierra o cierra de menos** — y la regla de rotar por derecho
  propio el rubro cuyo código tocó es lo único que lo ha atrapado.
- **Global: 4.0** (antes **4.25**) · **▼0.25**. Suma **51 → 48**. De los 6
  reauditados bajan 4 (fiscal 3→2, arquitectura 4→3, backend 6→5, pruebas 5→4),
  sube 1 (operabilidad 4→5, por un arreglo de la ronda ANTERIOR juzgado por un
  auditor independiente) y se queda 1 (rendimiento).
- **Arreglado: 3**, en 3 commits atómicos, cada uno con prueba que lo reproduce,
  rojo medido → verde y **mutación verificada en los dos sentidos**.
  **Revertidos: 0.** Tope de 3 vueltas gastado.
  - `95f497c` — **REN-32C3-C1 (CRÍTICO)**: la misma lectura de 100 páginas de
    `gasto` que `fc811a0` acotó vivía 72 líneas más arriba, sin reloj y en TODOS
    los paquetes. 315.0 s nominales contra `maxDuration = 300`.
  - `790900d` — **FIS-C3 / ARQ32C3-C2 (CRÍTICO)**: el motor dedupa por emisor
    con la semántica de la **0358**, no la de la 0357. La prueba distingue las
    dos, que es la regresión que costó dos CRÍTICOS la ronda pasada.
  - `8863b04` — **OP-32C3-A1 (ALTO)**: bajo `bash -e` el paso que mergea los PR
    de las rutinas moría en la primera vuelta con exit 8 y cero salida. **Explica
    por qué estos PR se apilaban abiertos.**
- **Pendientes con razón escrita: 10 CRÍTICOS**, cuatro de ellos (ARQ-C1 en su
  12ª ronda, FE-C1 y OP-C1 en su 9ª, y el otro lado del espejo ARQ32C3-C1) por
  ser decisión de producto o rediseño, no parche de madrugada.
- **Lo que urge y no es código, SÉPTIMO día:** último `[deploy]` en asunto sigue
  siendo `cfa00ab` (10-sep, hace 9 días); 21 archivos de `src/`/`supabase/` en
  master sin llegar a producción. Redeploy en Vercel. Notificado al dueño.
- **Higiene:** un auditor dejó viva una mutación de pruebas (`monto: 0`) en el
  árbol; era deliberada, la restauró al pedírselo, y otros tres auditores la
  detectaron sin tocarla. Ningún commit usó `git add -A`. Una suite intermedia
  no contó como compuerta por haber corrido con esa mutación puesta, y se
  repitió con el árbol quieto.
- **Compuerta al cerrar:** `npx vitest run` **991 archivos / 13,007 pasan / 6
  saltadas / 0 fallan**, exit 0 · `tsc --noEmit` exit 0 · `lint` 0 errores, 154
  avisos · `lint:ratchet` 0 nuevos. `npm run build` no corre en la nube.
- **Tablero:** `tablero-continuacion-3.html` + `.png`, capturado **y mirado** —
  mirarlo encontró que la serie histórica tenía 4.8 donde va 4.7 (el tablero
  mentía sobre una nota) y que el pie decía «nueve puntos» habiendo ocho.
  Corregidos y recapturado.
- **PR:** #477, `claude/auditoria-32`.
