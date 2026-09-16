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
