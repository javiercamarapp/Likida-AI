# MAPA — auditoría 32, continuación del 17-sep-2026

Ronda de **CONTINUACIÓN** sobre la rama viva `claude/auditoria-32` y el PR
**#477**, que sigue abierto. No se abre PR nuevo.

Este documento describe **qué cambió** desde que los auditores de ayer
entregaron y **qué no**. No sugiere ninguna dirección para las notas: que suba,
que baje o que se quede son los tres resultados igual de válidos, y ninguno de
los tres es el que este documento quiere. Todo movimiento necesita un número
contable detrás.

---

## Decisión de tipo de ronda, con los comandos

No hay `gh` en esta imagen: todo lo de GitHub sale del MCP.

```
list_pull_requests(javiercamarapp/cuadra, state=open)
  → #477  claude/auditoria-32   «Auditoría 32 — ronda ligera de rotación…»  (abierto)
  → #478  claude/normativa-2026-09-16  (no es de auditoría)
```

**Hay PR de auditoría abierto → CONTINUACIÓN.** La regla es explícita y se
aplica antes de gastar un token en auditores: checkout de esa rama, se continúa
sobre ella, y al cerrar `push --force` a la misma rama con el cuerpo del PR
actualizado. Un PR vivo vale más que catorce ignorados.

```
git ls-remote origin master   →  69becdbd569a165b4547aef9771d1e4935d98b62
git rev-parse HEAD (al clonar) →  69becdbd569a165b4547aef9771d1e4935d98b62
git merge-base claude/auditoria-32 origin/master → 69becdb   (= punta de master)
git log --oneline HEAD..origin/master           → (vacío)
```

(El `ls-remote` primero es el paso obligatorio que dejó escrito la continuación 2
de la 31, cuando un ref rancio produjo 7,298 borrados falsos. Hoy el ref viene
fresco.)

**`origin/master` no se ha movido desde ayer.** Sigue en `69becdb`. Cero commits
del equipo en la ventana, en ninguna ruta. La rama de auditoría está adelante de
master por 6 commits, todos de la ronda 32, y no hay conflicto de merge.

---

## Qué código cambió desde que los auditores de ayer entregaron

Uno solo, y es el arreglo de la propia ronda:

```
git diff --stat origin/master..HEAD -- src/ supabase/ .github/

 .github/workflows/ci-postgres.yml                     |   1 +
 src/lib/likida/migraciones_verificadas.test.ts        |   3 +-
 supabase/migrations/0357_dedup_ejercicio_por_emisor.sql | 121 +++++++++++++
 supabase/tests/0357_dedup_ejercicio_emisor.sql          |  96 ++++++++++
 4 files changed, 220 insertions(+), 1 deletion(-)
```

`f0645f9` — ARQ-A3, el dedup del ejercicio que regalaba cupo del 15 %. Migración
**0357**, prueba SQL propia, cableada en el job de Postgres efímero.

**Consecuencia para la rotación de hoy:** el único rubro cuyo código cambió es
**modelo de datos y esquema** — se agregó una migración al esquema. Por la regla
de continuación («relanza los rubros cuyo archivo falte o cuyo código haya
cambiado desde que se escribió»), ese auditor entra por derecho propio, y de
paso es quien revisa de forma independiente el arreglo del orquestador. La
ronda 31 dejó escrito que ésa fue su parte más útil: los auditores diciendo que
tres de los cuatro arreglos del orquestador cerraban a medias o no cerraban.

---

## Los rubros de hoy y por qué estos cuatro

Notas vigentes al cierre de la 32 (suma 56, global 4.7):

| Rubro | Nota | Última vez auditado |
|---|---|---|
| Modelo de datos y esquema | 7 | ronda 31 (13-sep) |
| Backend y API | 6 | ronda 31 (13-sep) |
| Pruebas | 6 | continuación 2 (15-sep) |
| Frontend | 5 | continuación 2 (15-sep) |
| Seguridad | 5 | continuación 2 (15-sep) |
| Tool calling | 5 | ronda 31 (13-sep) |
| Operabilidad y DX | 4 | continuación 2 (15-sep) |
| Sistema agéntico | 4 | ronda 31 (13-sep) |
| Rendimiento y costo | 4 | continuación 1 (14-sep) |
| Arquitectura y mantenibilidad | 4 | ronda 32 (16-sep) |
| Cumplimiento fiscal | 3 | ronda 32 (16-sep) |
| Cumplimiento legal | 3 | ronda 32 (16-sep) |

Fuera de la rotación quedan los ocho auditados en las últimas tres rondas
(continuación 1, continuación 2 y la 32): rendimiento, operabilidad, frontend,
seguridad, pruebas, fiscal, legal y arquitectura. **Quedan cuatro sin tocar
desde el 13-sep**, y son exactamente los cuatro de hoy:

1. **Sistema agéntico (4)** — el más bajo de los cuatro. La 32 lo dejó escrito
   con esas palabras: «Sistema agéntico queda primero en la cola de la 33»,
   después de perder el desempate con arquitectura por el lead de ARQ-A3.
2. **Tool calling (5)**.
3. **Backend y API (6)**.
4. **Modelo de datos y esquema (7)** — no por nota, sino porque **su código
   cambió**: la migración 0357.

Son cuatro y no tres porque el cuarto entra por la cláusula de código cambiado,
no por rotación. Con estos cuatro, los doce rubros quedan cubiertos dentro de la
ventana del 13 al 17 de septiembre.

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
- `supabase/migrations/` — 334 migraciones tras la 0357. `supabase/tests/` corre
  en el job «Migraciones + aislamiento (Postgres efímero)».
- `normas/*.yaml` — fichas normativas, fuente de verdad de lo fiscal.
- `docs/auditoria-31/` y `docs/auditoria-32/` — las dos rondas anteriores.

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
- **Sí se puede correr Postgres.** La 32 lo dejó resuelto: los binarios de
  PostgreSQL 16 están en `/usr/lib/postgresql/16/bin/` (fuera del PATH, por eso
  `which` engaña), `initdb` se niega a correr como root y hay que `su postgres`,
  y con la receta de `ci-postgres.yml:143-169` las 334 migraciones aplican
  limpias sobre base virgen. Lo que vive en SQL ya no hay que deducirlo.
- `docs/auditoria-*/` está en `.gitignore:36`: se commitea con `git add -f` o el
  PR sale vacío sin avisar.

---

## Línea base de la compuerta, al arrancar

Se pega la salida real en `progreso.md`. La referencia del cierre de ayer era
988 archivos / 12,976 pruebas, `tsc` exit 0, `lint` 0 errores / 154 avisos, y un
intermitente **preexistente** documentado en `cron/asistencia/route.test.ts`
(falla 1 de cada 5 corridas sobre HEAD pristino, por 1 ms de margen). Si hoy
vuelve a aparecer, es ése y no una regresión.
