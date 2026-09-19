# MAPA — auditoría 32, continuación 3 del 19-sep-2026

Ronda de **CONTINUACIÓN** sobre la rama viva `claude/auditoria-32` y el PR
**#477**, que sigue abierto. **No se abre PR nuevo.**

Este documento describe **qué cambió** desde que los auditores anteriores
entregaron y **qué no**. No sugiere ninguna dirección para las notas: que suba,
que baje o que se quede son los tres resultados igual de válidos, y ninguno de
los tres es el que este documento quiere. Todo movimiento necesita un número
contable detrás.

---

## Decisión de tipo de ronda, con los comandos

No hay `gh` en esta imagen: todo lo de GitHub sale del MCP.

```
list_pull_requests(javiercamarapp/cuadra, state=open)
  → #481  claude/cuota-diesel-2026-09-19   (no es de auditoría)
  → #480  claude/normativa-2026-09-18      (no es de auditoría)
  → #479  claude/normativa-2026-09-17      (no es de auditoría)
  → #478  claude/normativa-2026-09-16      (no es de auditoría)
  → #477  claude/auditoria-32  «Auditoría 32 (+ continuaciones 17 y 18-sep)…»  ABIERTO
     mergeable_state: clean · draft · 15 commits · 47 archivos
```

**Hay PR de auditoría abierto → CONTINUACIÓN.**

```
git ls-remote origin master                          → 69becdbd569a165b4547aef9771d1e4935d98b62
git rev-parse HEAD (al clonar)                       → 69becdbd569a165b4547aef9771d1e4935d98b62
git ls-remote origin refs/heads/claude/auditoria-32  → 656bc68230b89a3295392db9da627445e5f8c191
git log --oneline claude/auditoria-32..origin/master → (vacío)
git rev-list --count origin/master..claude/auditoria-32 → 15
git status --short                                   → (vacío)
```

(El `ls-remote` primero es el paso obligatorio que dejó escrito la continuación
2 de la 31, cuando un ref rancio produjo 7,298 borrados falsos. Hoy viene
fresco.) **`origin/master` no se ha movido desde el 16-sep.** Sigue en
`69becdb`, que es el mismo sha que la continuación 2 encontró ayer. La rama de
auditoría está **15 commits adelante** de master y **no hay conflicto de
merge**. Árbol limpio → **autofix habilitado**.

---

## Qué código cambió desde que los auditores anteriores entregaron

Los tres arreglos de la continuación 2 (18-sep), que se escribieron **después**
de que los seis auditores de ayer entregaran:

```
git show --stat 2c38766 fc811a0 e47f974

2c38766  fix(operabilidad) OP-32C2-C1
  .github/workflows/salud-produccion.yml       |  14 +-
  scripts/ci/deriva_sin_desplegar.test.ts      | 126 ++-

fc811a0  fix(rendimiento) REN-30-C2
  src/lib/likida/intake/consolidado.ts              | 16 +-
  src/lib/likida/intake/consolidado_orquestador.test.ts | 40 +
  src/lib/likida/pg.test.ts                         | 82 +-
  src/lib/likida/pg.ts                              | 33 +
  src/lib/likida/sat_descarga/ciclo.ts              |  2 +-
  src/lib/likida/sat_descarga/ciclo_flota.test.ts   | 57 +-

e47f974  test(peajes) PRU-31C-A1
  src/lib/likida/agentes/peajes/reloj-cableado.test.ts | 69 +
```

Y, más atrás en la rama pero **posteriores** a la entrega de fiscal y
arquitectura del 16-sep:

```
f0645f9  migración 0357 — dedup del ejercicio por emisor (ARQ-A3)
53740a1  migración 0358 — el emisor solo dedupa cuando se conoce (DAT32C-C1)
5c1734e  migración 0359 — la misma semántica en el panel fiscal (DAT32C-C2)
```

Son **336 migraciones** en total tras la 0359. **Cero líneas nuevas de
`master`**: todo lo que se movió lo movió esta misma ronda.

---

## Los rubros de hoy y por qué estos seis

Notas vigentes al cierre de la continuación 2 del 18-sep (suma **51**, global
**4.25**):

| Rubro | Nota | Última vez auditado | ¿Su código cambió después? |
|---|---|---|---|
| Modelo de datos y esquema | 6 | c2 18-sep | no |
| Backend y API | 6 | c1 17-sep | **sí** — `pg.ts`, `consolidado.ts`, `ciclo.ts` (`fc811a0`) |
| Frontend | 5 | c2 18-sep | no |
| Pruebas | 5 | c2 18-sep | **sí** — 4 archivos `.test.ts` nuevos o reescritos |
| Seguridad | 4 | c2 18-sep | no |
| Operabilidad y DX | 4 | c2 18-sep | **sí** — `salud-produccion.yml`, `deriva_sin_desplegar.test.ts` |
| Tool calling | 4 | c1 17-sep | no |
| Rendimiento y costo | 4 | c2 18-sep | **sí** — `consolidado.ts`, `pg.ts`, `ciclo.ts` |
| Arquitectura y mantenibilidad | 4 | 32 (16-sep) | **sí** — migraciones 0358 y 0359 |
| Sistema agéntico | 3 | c1 17-sep | no |
| Cumplimiento fiscal | 3 | 32 (16-sep) | **sí** — 0358 y 0359 tocan el predicado de dinero del panel fiscal |
| Cumplimiento legal | 3 | 32 (16-sep) | no |

La regla de continuación —«relanza SOLO los rubros cuyo archivo falte o cuyo
código haya cambiado desde que se escribió»— da exactamente seis. Los doce
archivos de rubro **existen** en `docs/auditoria-32/`, así que ninguno entra por
archivo faltante: los seis entran por la cláusula de código cambiado.

1. **Operabilidad y DX (4)** — `2c38766` es el arreglo a **su propio CRÍTICO**
   (OP-32C2-C1) y reescribió 126 líneas de su detector.
2. **Rendimiento y costo (4)** — `fc811a0` es el arreglo a **su propio CRÍTICO**
   (REN-30-C2, reincidente desde la 29) y tocó tres archivos del motor.
3. **Pruebas (5)** — `e47f974` es el arreglo a **su propio ALTO** (PRU-31C-A1) y,
   además, los otros dos commits traen cinco archivos de prueba nuevos o
   reescritos que nadie ha auditado.
4. **Backend y API (6)** — `pg.ts` estrenó una función y `consolidado.ts` cambió
   su contrato de despacho **después** de que backend entregara el 17-sep.
5. **Cumplimiento fiscal (3)** — las migraciones 0358 y 0359 reescriben el
   predicado con el que se cuenta el dinero del panel fiscal, y fiscal entregó
   el 16-sep, **antes** de las dos. Es el rubro cuyo dinero cambió sin que su
   auditor lo haya visto.
6. **Arquitectura y mantenibilidad (4)** — mismo hilo por el otro eje: 0357 fue
   **su** arreglo (ARQ-A3) y 0358/0359 lo corrigieron dos veces. ARQ-C1 va por
   su 12ª aparición.

Los otros seis conservan su nota y van marcados **`no auditado esta ronda`**.

**El precedente que ordena esta lista, y vale leerlo:** en las tres rondas
anteriores, el auditor cuyo código había tocado el orquestador entró por esta
misma cláusula y encontró, dos de tres veces, que el arreglo **no cerraba** —
la 31, tres de cuatro cerraban a medias; la 32, la migración 0357 traía **dos
regresiones CRÍTICAS**; la c2 del 18, por fin, 0358 y 0359 aguantaron enteras.
Nadie debe dar por bueno un arreglo de esta rutina porque la suite esté verde.
Hoy los tres arreglos del 18-sep van a ser revisados por sus tres dueños.

---

## Dónde está todo

- `src/app/` — Next.js (App Router). `(dashboard)` es el panel del cliente,
  `(admin)` la consola de Javier, `(portal)` el portal del operador.
- `src/lib/likida/` — el motor: `processor.ts` (WhatsApp), `repo.ts` (todo el
  acceso a datos), `cuadre/` (el motor de dinero: `engine.ts`, `desde_db.ts`,
  `guardia.ts`, `resumen.ts`), `liquidacion/` (PDF, deducibilidad),
  `intake/` (OCR, CFDI, SAT), `facturacion/`, `privacidad.ts`, `analytics.ts`,
  `pg.ts` (acceso crudo y, desde ayer, el techo de reloj).
- `src/lib/agents/` — `run.ts`, `registry.ts`, `prompts.ts`.
- `src/lib/llm/` — `openrouter.ts`, `models.ts`, `tool-executor.ts`.
- `supabase/migrations/` — **336** migraciones tras la 0359. `supabase/tests/`
  corre en el job «Migraciones + aislamiento (Postgres efímero)».
- `normas/*.yaml` — fichas normativas, fuente de verdad de lo fiscal.
- `docs/auditoria-31/` y `docs/auditoria-32/` — las rondas anteriores. **No
  repitas lo que ya está resuelto ahí.**

**Reglas del producto que no se rompen** (de `CLAUDE.md`, y valen como criterio
de auditoría): nunca inventar una cifra; un rótulo tiene que ser verdad; el
formato de cifras vive solo en `lib/formato.ts`; fallar cerrado y decirlo
(supabase-js reporta errores **por valor**, y PostgREST recorta a 1,000 filas en
silencio — ver `exigir()` y `traerTodo()`).

**Trampas ya pisadas, no volver a reportarlas como hallazgo nuevo:**
`gasto.ocr_raw` está muerta (la prueba de OCR es `ocr_confianza`);
`politica_gasto` está muerta (la política viva es `tenant.config.politica` vía
`getConfig()`); `wa_mensaje_procesado` no tiene `tenant_id`; `viaje.estatus`
solo admite `abierto | en_cuadre | liquidado`. Las tablas `cliente`, `unidad`,
`tarifa`, `factura_emitida`, `pago_recibido`, `posicion`, `cotizacion`,
`mantenimiento` y `ticket_mensaje` **ya tienen escritor**; siguen sin escritor
`geocerca`, `terminal`, `portal_credencial` e `invitacion`. La base está en cero
porque no hay clientes, no porque falte código.

---

## Lo que esta corrida NO puede hacer (nube, sin credenciales)

- **La compuerta es `npx vitest run` + `npx tsc --noEmit` + `npm run lint`.**
  `npm run build` **no se corre**: pide Supabase, OpenRouter, Facturapi y
  Upstash, que aquí no existen, y su fallo no diría nada del código.
- **`pruebas-manuales/*.prueba.ts` no se corren**: hacen llamadas reales de pago.
- Sin red hacia `app.likida.ai`. Lo que se afirme de producción sale de `git` y
  de la API de GitHub, nunca de una consulta al sitio.
- **Sí se puede correr Postgres.** Los binarios de PostgreSQL 16 están en
  `/usr/lib/postgresql/16/bin/` (fuera del PATH, por eso `which` engaña),
  `initdb` se niega a correr como root y hay que `su postgres`, y con la receta
  de `ci-postgres.yml` las 336 migraciones aplican limpias sobre base virgen.
  Lo que vive en SQL ya no hay que deducirlo.
- `docs/auditoria-*/` está en `.gitignore:36`: se commitea con `git add -f` o el
  PR sale vacío sin avisar.

---

## Línea base de la compuerta, al arrancar

El clon llegó **sin `node_modules`**; `npm ci` → exit 0. La salida real de la
compuerta de hoy se pega en `progreso-continuacion-3.md`.

Referencia del cierre de ayer: **989 archivos / 12,990 pruebas pasan / 6
saltadas / 0 fallan**, `tsc` exit 0, `lint` 0 errores / 154 avisos.

El intermitente de `cron/asistencia/route.test.ts` fue arreglado el 17-sep por
`4b84716` y no reapareció en cuatro pasadas completas del 18. **Si hoy
reaparece, es una regresión y no el intermitente conocido.**

---

## Lo que urge y no es código, SÉPTIMO día consecutivo

```
git log --format='%h %ad %s' --date=short origin/master | grep '^\S* \S* \[deploy'
  → cfa00ab 2026-09-10 [deploy] publicar fix de integridad de REN-C1 (keyset en candidatosDb)
git diff --name-only cfa00ab..origin/master -- src/ supabase/ | wc -l  →  21
```

El último commit con bandera `[deploy]` en el **asunto** sigue siendo `cfa00ab`,
del **10-sep — hace 9 días**. Hay **21 archivos** de `src/`/`supabase/` en
`master` que nunca llegaron a producción, entre ellos el cubo del 15 % (ARQ-C2:
$90,600 impresos contra $95,300 correctos). El pulso de salud sale verde igual
porque mide «¿aterrizó lo último que se pidió publicar?», no «¿producción está
al día?». Se arregla con **Redeploy en Vercel**. No es un hallazgo de ningún
rubro: es una acción del dueño.
