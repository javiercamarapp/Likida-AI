# MAPA — auditoría 32, continuación 2 del 18-sep-2026

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
  → #477  claude/auditoria-32  «Auditoría 32 (+ continuación 17-sep)…»  (abierto)
  → #478  claude/normativa-2026-09-16   (no es de auditoría)
  → #479  claude/normativa-2026-09-17   (no es de auditoría)
```

**Hay PR de auditoría abierto → CONTINUACIÓN.**

```
git ls-remote origin master                     → 69becdbd569a165b4547aef9771d1e4935d98b62
git rev-parse HEAD (al clonar)                  → 69becdbd569a165b4547aef9771d1e4935d98b62
git ls-remote origin refs/heads/claude/auditoria-32 → 65dbb9a06d3b6766eb1a0608acf4265e1480d4eb
git log --oneline claude/auditoria-32..origin/master → (vacío)
git status --short                              → (vacío)
```

(El `ls-remote` primero es el paso obligatorio que dejó escrito la continuación
2 de la 31, cuando un ref rancio produjo 7,298 borrados falsos. Hoy viene
fresco.) **`origin/master` no se ha movido desde el 16-sep.** Sigue en
`69becdb`. La rama de auditoría está **10 commits adelante** de master, todos de
la ronda 32, y **no hay conflicto de merge**. Árbol limpio → **autofix
habilitado**.

---

## Qué código cambió desde que los auditores anteriores entregaron

```
git diff --stat origin/master..HEAD -- src/ supabase/ .github/

 .github/workflows/ci-postgres.yml                       |   3 +
 src/app/api/cron/asistencia/route.test.ts               |  62 ++++-
 src/lib/likida/migraciones_verificadas.test.ts          |   5 +-
 supabase/migrations/0357_dedup_ejercicio_por_emisor.sql | 121 +++++++++
 supabase/migrations/0358_dedup_emisor_conocido.sql      | 132 ++++++++++
 supabase/migrations/0359_panel_fiscal_dedup_emisor.sql  | 274 +++++++++++++++++
 supabase/tests/0357_dedup_ejercicio_emisor.sql          |  96 ++++++++
 supabase/tests/0358_dedup_emisor_ocr_nulo.sql           |  83 +++++++
 supabase/tests/0359_panel_fiscal_dedup_emisor.sql       |  98 ++++++++
 9 files changed, 865 insertions(+), 9 deletions(-)
```

Todo es de la propia ronda 32. En orden:

- `f0645f9` — ARQ-A3, migración **0357**: el dedup del ejercicio mira quién
  emitió el ticket.
- `53740a1` — DAT32C-C1, migración **0358**: el emisor solo discrimina cuando se
  conoce. **Cierra una regresión que creó `f0645f9`.**
- `5c1734e` — DAT32C-C2, migración **0359**: la misma semántica portada al panel
  fiscal. **Cierra la segunda copia del predicado.**
- `4b84716` — PRU32C-A1: las dos aserciones de reloj de
  `cron/asistencia/route.test.ts` tenían holgura **exactamente 0 ms**.

Son **336 migraciones** en total tras la 0359.

---

## Los rubros de hoy y por qué estos seis

Notas vigentes al cierre de la continuación del 17-sep (suma 52, global 4.3):

| Rubro | Nota | Última vez auditado | ¿Archivo en `auditoria-32/`? |
|---|---|---|---|
| Modelo de datos y esquema | 5 | continuación 17-sep | sí (`datos-continuacion.md`) |
| Backend y API | 6 | continuación 17-sep | sí |
| Pruebas | 6 | continuación 2 de la 31 (15-sep) | **NO** |
| Frontend | 5 | continuación 2 de la 31 (15-sep) | **NO** |
| Seguridad | 5 | continuación 2 de la 31 (15-sep) | **NO** |
| Tool calling | 4 | continuación 17-sep | sí |
| Operabilidad y DX | 4 | continuación 2 de la 31 (15-sep) | **NO** |
| Sistema agéntico | 3 | continuación 17-sep | sí |
| Rendimiento y costo | 4 | continuación 1 de la 31 (14-sep) | **NO** |
| Arquitectura y mantenibilidad | 4 | ronda 32 (16-sep) | sí |
| Cumplimiento fiscal | 3 | ronda 32 (16-sep) | sí |
| Cumplimiento legal | 3 | ronda 32 (16-sep) | sí |

La regla de continuación —«relanza SOLO los rubros cuyo archivo falte o cuyo
código haya cambiado desde que se escribió»— da exactamente seis:

1. **Frontend (5)** — archivo falta en la 32.
2. **Seguridad (5)** — archivo falta en la 32.
3. **Pruebas (6)** — archivo falta en la 32, **y** su código cambió
   (`4b84716` reescribió 62 líneas de `cron/asistencia/route.test.ts`).
4. **Operabilidad y DX (4)** — archivo falta en la 32.
5. **Rendimiento y costo (4)** — archivo falta en la 32, y es el que lleva más
   tiempo sin tocarse (14-sep).
6. **Modelo de datos y esquema (5)** — su archivo **sí** existe, pero entra por
   la cláusula de código cambiado: las migraciones **0358 y 0359** se
   escribieron **después** de que ese auditor entregara, y son el arreglo a sus
   propios hallazgos. Es quien revisa de forma independiente si cerraron.

Con estos seis, los doce rubros quedan cubiertos dentro de la ventana del 13 al
18 de septiembre. Los otros seis conservan su nota y van marcados **`no
auditado esta ronda`**.

**El precedente que justifica el punto 6, y vale leerlo:** dos rondas seguidas,
el auditor cuyo código tocó el orquestador encontró que el arreglo **no
cerraba**. La 31: tres de cuatro arreglos cerraban a medias. La 32: la migración
0357 traía **dos regresiones CRÍTICAS**. Nadie debe dar por bueno un arreglo de
esta rutina porque la suite esté verde.

---

## Dónde está todo

- `src/app/` — Next.js (App Router). `(dashboard)` es el panel del cliente,
  `(admin)` la consola de Javier, `(portal)` el portal del operador.
- `src/lib/likida/` — el motor: `processor.ts` (WhatsApp), `repo.ts` (todo el
  acceso a datos), `cuadre/` (el motor de dinero: `engine.ts`, `desde_db.ts`,
  `guardia.ts`, `resumen.ts`), `liquidacion/` (PDF, deducibilidad),
  `intake/` (OCR, CFDI, SAT), `facturacion/`, `privacidad.ts`, `analytics.ts`.
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

El clon llegó **sin `node_modules`**; `npm ci` → exit 0, 614 paquetes, 0
vulnerabilidades. La salida real de la compuerta de hoy se pega en
`progreso-continuacion-2.md`.

Referencia del cierre de ayer: **988 archivos / 12,976 pruebas pasan / 6
saltadas / 0 fallan**, `tsc` exit 0, `lint` 0 errores / 154 avisos.

El intermitente de `cron/asistencia/route.test.ts` (fallaba 1 de cada 5
corridas por 1 ms de margen) **fue arreglado ayer** por `4b84716`, medido 0 de
25 rojas. Si hoy reaparece, **es una regresión y no el intermitente conocido**.

---

## Lo que urge y no es código, SEXTO día consecutivo

```
git log --format='%h %s' origin/master | grep '^\S* \[deploy'  →  cfa00ab (10-sep)
git diff --name-only cfa00ab..origin/master -- src/ supabase/ | wc -l  →  21
```

El último commit con bandera `[deploy]` en el asunto es `cfa00ab`, del
**10-sep — hace 8 días**. Hay **21 archivos** de `src/`/`supabase/` en `master`
que nunca llegaron a producción, entre ellos el cubo del 15 % (ARQ-C2: $90,600
impresos contra $95,300 correctos). El pulso de salud sale verde igual porque
mide «¿aterrizó lo último que se pidió publicar?», no «¿producción está al
día?». Se arregla con **Redeploy en Vercel**. No es un hallazgo de ningún rubro:
es una acción del dueño.
