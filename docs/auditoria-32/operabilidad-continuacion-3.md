# Operabilidad y DX — auditoría 32, continuación 3 (19-sep-2026)

**Nota: 5/10** (antes 4). Razón del movimiento: **se atacó y subió**, con el
número contable: `2c38766` cerró **entero** el CRÍTICO `OP-32C2-C1` —los tres
estados en que la salida del detector puede quedar dan ahora `false` en el paso
de cierre, y el camino legítimo sigue dando `true`—. Es la **primera vez en las
cuatro rondas de este ciclo** que el arreglo a un CRÍTICO de este rubro no
cierra a medias ni trae una regresión. Y el canal nuevo aguantó tres días de
medición real: el issue **#476** lleva abierto desde el 16-sep 10:09:12Z,
**20 corridas del pulso** (#672→#691) lo vieron y ninguna lo duplicó ni lo
cerró (`updated_at == created_at`, sin un solo comentario).

No pasa de 5 porque una **mirada más profunda** encontró dos ALTO nuevos en
terreno que tres rondas anteriores habían dado por bueno o por no revisado —
uno de ellos con **dos corridas fechadas** en producción— y porque la pregunta
que ordena el rubro sigue contestándose que no: **no hay identificador con el
que reconstruir un fallo de las 3 a.m.**, ni en el camino del cron
(`OP-C1`, 9ª ronda) ni en el de la web (`OP-32C3-A2`, nuevo).

**El riesgo mayor del rubro, hoy:** las dos superficies que el contralor ve
—el panel y los crons del dinero— fallan dejando una línea que nombra la
*plantilla* de la ruta o *una palabra*, y en ningún caso **cuál** liquidación,
**cuál** flota o **cuál** cron.

---

## Veredicto sobre `2c38766` (el arreglo a OP-32C2-C1)

**CERRÓ.** Entero, y no trajo nada nuevo. La evidencia, en cuatro piezas:

### 1. La condición real, evaluada bajo las reglas de coerción de GitHub

`.github/workflows/salud-produccion.yml:226`

```yaml
if: always() && github.event_name != 'push' && format('{0}', steps.deriva.outputs.hay) == '0'
```

Contra la de antes (`always() && steps.deriva.outputs.hay == '0'`). Los tres
estados en que puede quedar `steps.deriva.outputs.hay`:

| estado | valor | antes | ahora | por qué |
|---|---|---|---|---|
| paso saltado (`push`) | `null` | **true** ← el bug | `false` | dos veces: la guarda de evento, y `format('{0}', null)` → `''`, que contra `'0'` es comparación **cadena-cadena** (los dos lados son cadenas) → `'' ≠ '0'` |
| `exit 0` de `:178`/`:179` (producción sin versión, o sha fuera de master) | `null` | **true** | `false` | por el `format()` solo — la guarda de evento no cubre este caso, y es justo el de producción caída |
| el detector midió cero | `'0'` | true | `true` | `format('{0}','0')` → `'0'` |

La coerción que causó el fallo (`null == '0'` → `0 == 0` → verdadera) aplica
solo cuando los tipos **difieren**; `format()` fuerza que no difieran. El
arreglo es correcto por el mecanismo, no por coincidencia. Y es **cinturón y
tirantes**: para el caso medido (#671, un push) cualquiera de las dos guardas
por sí sola habría bastado.

### 2. La prueba dejó de canonizar el defecto

`scripts/ci/deriva_sin_desplegar.test.ts:206-212` afirmaba literalmente
`toContain("steps.deriva.outputs.hay == '0'")` — la condición rota. Ahora
afirma solo sobre la **salida** que lee (`toContain('steps.deriva.outputs.hay')`)
y la forma la fija `:317-357`, que **evalúa** la condición en vez de buscarla.
El evaluador (`:262-285`) es fail-closed: lanza ante cualquier token o término
que no modele (`||`, `format` con otro índice, un contexto nuevo), así que un
cambio de forma que no entienda pone la prueba roja en vez de verde.
`:369-375` verifica el propio evaluador contra los tres casos de coerción —
sin esa prueba, un evaluador que se despiste haría pasar las otras dos sin
probar nada.

### 3. El invariante estructural

`:346-356` toma las guardas del paso que **mide** (`condicionDe(pasoDe(
'deriva-sin-desplegar.mjs'))`, hoy `github.event_name != 'push'`) y exige que
el paso que **cierra** las contenga todas. Es la lección de la auditoría 27
(`OP-C2`/#339) convertida en compuerta: si mañana el detector gana una guarda
nueva y el cierre no, esto sale rojo. Corrida hoy: `npx vitest run
scripts/ci/deriva_sin_desplegar.test.ts` → **20 pruebas, 0 fallos**.

### 4. Lo que busqué para refutarlo, y no encontré

- **¿Quedó el opener desprotegido?** `:201` sigue con `always() &&
  steps.deriva.outputs.hay == '1'`, sin la guarda de evento y sin `format()`.
  Es inmune por la misma aritmética que causó el bug (`null` → `0`, y `0 ≠ 1`),
  y `:359-364` lo fija con las dos direcciones. No es un hallazgo.
- **¿Se rompió el cierre legítimo?** No: el tercer caso de `:337-341` lo cubre,
  y `publicarDeriva` (`deriva-sin-desplegar.mjs:112`) escribe `hay=0` como
  cadena, que es lo que el `format()` compara.
- **¿`success()` mal modelado?** `evaluarIf` trata `success()` como `true`
  incondicional, lo cual **no** modela a GitHub. Hoy no importa: ninguna de las
  dos condiciones que evalúa lo usa. Queda anotado abajo, no reportado.

**Caveat que hay que decir, porque cambia qué está protegido hoy:** el arreglo
vive **solo** en `claude/auditoria-32`. `origin/master` (`69becdb`) sigue
cargando la condición rota, y lo confirma la corrida **#691** de hoy
(19-sep 06:06:21Z), cuyo paso 10 salió `skipped` por la razón vieja (`hay='1'`,
no por la guarda nueva). El agujero está abierto en el CI de producción hasta
que #477 se mergee — y ese merge **no** lo dispara, porque Actions corre el
workflow desde el commit pusheado, que ya traerá el arreglo.

---

## Hallazgos

### [CRÍTICO] OP-C1 · 9ª ronda: las degradaciones rojas siguen dejando una palabra y ningún identificador (REINCIDENTE, desde la auditoría 22)

`src/app/api/health/route.ts:104-117`, `:145-154`, `:195` ·
`.github/workflows/salud-produccion.yml:79`, `:81`, `:85`, `:293` ·
`src/lib/admin/salud.ts:28` ·
`supabase/migrations/0155_purgas_y_bucket_comprobantes.sql:432-439` ·
`docs/conocimiento/DEPLOY.md:29-36`

Reverificado abriendo los archivos: **ni una línea cambió** desde la
continuación 2. `checks.crons` sigue siendo **una sola palabra** (`degraded`)
para dos ramas distintas —crons muertos (`:105`) y crons en regresión (`:145`)—
y los nombres salen únicamente por `logger.error('health.cron_vencido'…)`
(`:107-109`) y `logger.error('health.cron_estado_no_ok'…)` (`:146-149`) hacia
los runtime logs de Vercel, que `DEPLOY.md:33-36` declara **sin drain y de
retención corta**.

**Escenario, con valores.** 03:12 a.m.: `facturar` deja de latir (lote de
CFDI atorado en un portal). `detalleLatidos` lo marca `sin_latido`,
`cronCheck='degraded'`, `/api/health` contesta **503**. `salud-produccion.yml:85`
imprime `http=503 estado=degraded crons=degraded migracion={...}` y `:293` abre
el issue con **el texto fijo**: «El workflow Salud de producción falló: \<url\>
… El cuerpo de `/api/health` … está en el log de la corrida». El log dice
`degraded`. **No dice `facturar`.**

**Consecuencia.** Hoy, 19-sep, sigue sin existir en ningún artefacto —repo,
GitHub ni base— el nombre del cron que se degradó el 14-sep (`#657` → issue
#470) ni el del 15-sep (`#662` → issue #472). `cron_latido` es
`id text primary key`, una fila por cron sobrescrita, así que tampoco lo
guarda Postgres. Si alguno de los dos fue `facturar` o `wa-outbox`, eso es el
camino del dinero y la pregunta del contralor por la mañana **no tiene
respuesta reconstruible**.

Causa raíz probable: el detalle (el nombre) y el vigilante (el issue) no
comparten ningún canal durable.

---

### [ALTO] OP-32C3-A1 · El gate de la rutina muere en la primera línea de su lazo de reintentos: los dos caminos que explican por qué no se mergea son código muerto (NUEVO)

`.github/workflows/auto-merge-rutina.yml:66-84` — la línea que mata es `:67`,
la que nunca se ejecuta es `:68`

El paso no declara shell y el workflow no tiene bloque `defaults:`
(`grep -c defaults` → **0**), así que corre bajo el default de Actions,
`/usr/bin/bash -e {0}` — literal en el log de las corridas. Bajo `-e`, un
**comando simple** que devuelve distinto de cero aborta el script; solo están
exentos los que van como condición de `if`/`while`, operandos de `&&`/`||` o
negados con `!`. `:67` es un comando simple:

```bash
for i in $(seq 1 30); do
  gh pr checks "$NUM" --repo "$REPO" > /tmp/checks.txt 2>&1   # :67  ← aquí muere
  CODE=$?                                                      # :68  ← nunca corre
```

**Escenario, con valores — y ocurrió dos veces, fechadas.** `workflow_run`
dispara cuando **CI** termina; CI Postgres, CodeQL y e2e siguen corriendo, así
que `gh pr checks` devuelve **8** («alguno sigue en curso»).

- Corrida **#1678** (`34559277222`), **11-sep-2026 03:39:47Z**, rama
  `mejora/dof-diario-20260910`.
- Corrida **#1480** (`34184559310`), **08-sep-2026 03:44:44Z**, rama
  `mejora/dof-diario-20260907`.

Las dos tienen, tras el `##[endgroup]` y `shell: /usr/bin/bash -e {0}`, **cero
líneas de salida del script** y una sola línea:

```
##[error]Process completed with exit code 8.
```

No aparece «Checks todavía en curso (intento 1/30) — esperando 20s…» (`:74`).
No aparece «🔴 Hay checks en ROJO» (`:78`). No se ejecutó ningún
`gh pr comment` (`:80`). Reproducido aquí con el mismo shell:

```bash
$ cat repro.sh
falso() { return 8; }
for i in 1 2 3; do falso > /tmp/checks.txt 2>&1; CODE=$?; echo "LLEGUE A CODE=$CODE"; done
echo "FIN DEL SCRIPT"
$ bash -e repro.sh; echo "exit=$?"
exit=8          # ni "LLEGUE A CODE=", ni "FIN DEL SCRIPT"
```

El alcance es total: **cualquier** valor distinto de cero mata en `:67`, así
que la rama de rojo real (`:78-81`) es igual de inalcanzable que la de espera.
El lazo de 30 intentos × 20 s nunca da una segunda vuelta, y el guardia
post-lazo de `:86-89` —el único correcto, porque sí va bajo `if !`— es
inalcanzable.

**Consecuencia.** La rutina diaria empuja a `mejora/*` y abre PR. El gate que
debía esperar a que terminaran los checks y, si alguno salía rojo, **comentar
en el PR por qué no se mergea**, muere antes de escribir nada: el PR queda
abierto con una ✗ roja en «Gate rutina» y **ninguna explicación**. El equipo
que mantiene esto tiene que abrir el log del workflow para descubrir que el
mensaje es `exit code 8`, que significa «todavía no terminan» — es decir, el
PR probablemente estaba **bien**. Es el modo de falla que la auditoría 24 dio
por cerrado en `:389` de su propio reporte («distingue el exit 8 … del rojo
real») y que siete rondas de este rubro listaron como «no alcancé a revisar».

Causa raíz probable: el arreglo anterior sacó el comando de la condición del
`if` para poder leer `$?`, y con eso lo sacó también de la única construcción
que lo protegía de `set -e`.

---

### [ALTO] OP-32C3-A2 · `request.fail` nombra la PLANTILLA de la ruta y nunca la liquidación: el único punto que cubre las 31 páginas del panel borra el identificador antes de escribirlo (NUEVO)

`src/instrumentation.ts:81` y `:89` (`ruta: context?.routePath ?? request?.path`)
· contraste en `src/lib/logger.ts:11-47` · la prueba que no lo cubre en
`src/instrumentation.test.ts:39-55`

Verificado contra la documentación de Next que viaja en el repo
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md:100-117`
y `node_modules/next/dist/server/instrumentation/types.d.ts`):

- `request.path` → «resource path, e.g. **/blog?name=foo**» — la ruta concreta.
- `context.routePath` → «the route file path, e.g. **/app/blog/[dynamic]**» —
  la plantilla. Y en `RequestErrorContext` es **obligatorio**, no opcional.

Por tanto `context?.routePath ?? request?.path` resuelve **siempre** a la
plantilla para App Router, que es todo `src/app/`. `request.path` es un
fallback muerto; de `request` solo se usa `method`.

**Escenario, con valores.** El contralor abre
`/dashboard/liquidaciones/7c4e1f90-3b2a-4d61-9e08-5a1b2c3d4e5f` en la sala y el
Server Component revienta porque `traerTodo()` se topó con un PostgREST caído.
`onRequestError` escribe:

```json
{"level":"error","msg":"request.fail","meta":{
  "ruta":"/dashboard/liquidaciones/[id]","tipo":"render",
  "metodo":"GET","digest":"3155718393","err":"Error: supabase se cayó"}}
```

y `reportarExcepcion` (`:88-92`) manda a Sentry exactamente las mismas tres
llaves. **No hay una sola pieza que diga qué liquidación ni de qué flota.** El
`digest` agrupa el tipo de error, no la fila.

**Y es justo lo contrario de lo que el repo decidió a propósito.**
`logger.ts:11-47` documenta este mismo modo de falla como CRÍTICO de la
auditoría 5 —«un fallo de PDF de la flota A y uno de la flota B producían la
misma línea, carácter por carácter»— y por eso los UUID **se huellan y no se
borran**: `id:9f2c1a4b77de`, estable, cruzable contra Postgres con
`huellaId(fila.id)`. Si la ruta concreta llegara al logger, la huella saldría
sola. La capa de arriba tira el dato antes de que la de abajo pueda salvarlo.

**El guardarraíl que parecía cubrirlo, y no cubre.**
`instrumentation.test.ts:39-55` se llama «el identificador del fallo va
redactado como el resto de los logs», pasa `path: /dashboard/${uuid}` y afirma
`expect(linea).toContain(huellaId(uuid))`. Pasa — pero la huella que encuentra
viene del **mensaje del error** (`new Error(\`tenant ${uuid} sin config\`)`),
no de la ruta: `ruta` en esa misma línea es `/dashboard/[id]`. La prueba
seguiría verde si `request` se borrara del todo. Tres rondas
(`docs/auditoria-29/30/31/operabilidad.md`) listaron `onRequestError` bajo «lo
que está bien» leyendo que emite `ruta, tipo, metodo, digest, err`, sin mirar
qué acaba siendo `ruta`.

**Contra-argumento que sopesé y no cancela el hallazgo:** `sentry.ts:84-85`
dice que `ruta` es «path técnico … nunca su query ni su body», y `request.path`
**sí** trae query — hay una razón de privacidad real para no usarlo crudo. Pero
la consecuencia se sostiene igual: hoy ninguna línea identifica la fila, y la
maquinaria para hacerlo sin exponer nada (`huellaId`, `LLAVES_EXTRA_SEGURAS`)
ya existe y está probada.

Causa raíz probable: la precedencia del `??` elige la forma genérica sobre la
concreta en el único punto que cubre todas las superficies web.

---

### [ALTO] OP-32C2-A1 · `rollback-production.yml` certifica contra el deployment que le escribiste, nunca contra `app.likida.ai` (REINCIDENTE, 2ª ronda — y ahora con el contraste medido)

`.github/workflows/rollback-production.yml:41-49` (el `curl` en `:46`, la
aserción en `:47`, el rótulo en `:48-49`)

Sin tocar: el archivo entero son 49 líneas y las reverifiqué una por una.

**Escenario, con valores.** Producción rota de madrugada. Javier dispara con
`deployment_url=https://likida-ai-7f3c9d2-likida.vercel.app` y
`confirmation=ROLLBACK_PRODUCTION`. `:40` corre `vercel rollback "$URL"`. `:46`
hace `curl --fail … "$URL/api/health"` —**al mismo deployment que él
escribió**— y `:47` exige `.status == "ok" and .checks.db == "ok"`. Cualquier
deployment vivo del proyecto cumple las dos: producción misma las cumplió hoy
(`http=200 estado=ok`, corrida #691, 06:06:19Z). El job sale verde y `:48-49`
escribe **«### Rollback verificado — `/api/health`: status=ok, db=ok»**. Si el
alias no se movió (token sin permiso sobre el dominio, operación asíncrona, o
la URL equivocada de una lista de deployments que se parecen), el workflow
certifica un rollback que no ocurrió.

**Lo que agrego esta ronda:** el guardarraíl correcto **existe, en este mismo
repo, y no se copió**. `scripts/ci/production-candidate.mjs:150-156`
(`verify-alias`) recorre `DOMAINS = ['app.likida.ai', 'likidaai.vercel.app']`
(`:12`), pide `/v13/deployments/<domain>` y **lanza** si el id que responde no
es el candidato. El camino de promoción lo invoca en
`deploy-preview-promote.yml:450`. La palanca de emergencia, no.

**Consecuencia.** La única palanca documentada
(`docs/operacion/RESILIENCIA-DEPLOY.md:233-241`) devuelve «verificado» sin
haber mirado producción ni una vez. En un incidente eso es un falso «ya está
arreglado» que hace cerrar la laptop.

Causa raíz probable: se asierta sobre la URL de entrada en vez de sobre el
alias de producción y el sha esperado.

---

### [ALTO] OP-31C2-A1 · La anotación que llega al correo sigue siendo mayoritariamente una lista de migraciones ya aplicadas (REINCIDENTE, 3ª ronda)

`.github/workflows/salud-produccion.yml:80`, `:81`, `:85`

Sin tocar. `:80` sigue leyendo `migracion` con `JSON.stringify(j.migracion)` —
el objeto entero, `aplicados` incluido— y `:85` lo interpola dentro del
`::error::` que GitHub convierte en la anotación del job y en el correo.
Medido contra el cuerpo real capturado en la corrida `#671`: `aplicados` llega
con **333** números de migración, de `"0001"` a `"0356"` (hoy serían 336, tras
la 0359), contra ~236 caracteres de información útil (`http`, `estado`,
`crons`, `base/codigo/atras/adelante`). La información que `aplicados` aporta
ya está resumida tres campos antes en `atras:0,adelante:0`.

Consecuencia: lo que Javier ve en el teléfono cuando el pulso se pone rojo es
una pared de números de migración, ninguno relacionado con el fallo.

Causa raíz probable: se imprime el campo entero de un contrato hecho para una
máquina en el sitio donde lo lee una persona.

---

### [MEDIO] OP-32C3-M1 · El rollback puede correr encima de una promoción viva: es el único workflow que toca el alias fuera del grupo de concurrencia, y el que promueve es el único job sin reloj (NUEVO)

`.github/workflows/rollback-production.yml:18-24` (sin bloque `concurrency`;
`grep -c concurrency` → **0**) ·
`.github/workflows/deploy-preview-promote.yml:60-62` (`group:
vercel-release-likida`, `cancel-in-progress: false`) y `:426-433` (el job
`promote`, **sin `timeout-minutes`**) ·
`.github/workflows/recover-empty-staging.yml:31-33` (sí está en el grupo)

Los once jobs de `deploy-preview-promote.yml` declaran `timeout-minutes`
—5, 30, 15, 5, 20, 15, 15, 25, 15, 5, 10— **salvo `promote`**, que es
precisamente el que mueve el alias de producción. Sin él rige el default de
GitHub: **360 minutos**, reteniendo todo ese tiempo el grupo
`vercel-release-likida` con `cancel-in-progress: false`.

**Escenario, con valores.** 03:05 a.m.: una promoción se atora en
`vercel promote "$DEPLOYMENT_ID"` (`:449`) porque la API de Vercel no responde.
El job se queda vivo hasta las 09:05. A las 03:20 Javier, viendo producción
mal, dispara `rollback-production.yml`: como **no pertenece al grupo**, arranca
de inmediato y corre `vercel rollback` sobre el alias mientras la promoción
sigue intentando moverlo. Dos escritores sobre `app.likida.ai` sin
serialización. El `verify-alias` de la promoción (`:450`) detectaría el choque
y saldría rojo; el rollback **no puede detectarlo**, porque su verificación
mira la URL del deployment y no el alias (ver `OP-32C2-A1`), así que escribe
«Rollback verificado» pase lo que pase.

Consecuencia: el equipo queda con dos workflows en estados contradictorios
sobre el mismo alias y un resumen que afirma que el rollback está hecho.

Causa raíz probable: el grupo de concurrencia se definió por workflow y no por
el recurso que todos comparten, que es el alias de producción.

---

### [MEDIO] OP-31C2-M1 · El nombre del cron muerto viaja en el único campo que la huella de deduplicación no mira (REINCIDENTE)

`src/app/api/health/route.ts:114-117` y `:151-154` ·
`src/lib/observability/alerta.ts:129-133`, `:282`

Sin tocar. `huellaDeDetalle` (`alerta.ts:129`) arma la llave del piso horario
con `SALIENTES` (`:130-132`), que **incluye `'cron'` exactamente para esto**.
Los dos llamadores de crons muertos pasan `{ error, codigo }` y nada más, y
`codigo` es constante (`'cron_sin_latido'`, `'cron_estado_no_ok'`): la huella
sale siempre igual y `reservarPiso` (`:282`) deja salir **un correo por hora
pase lo que pase**. El contraste está 26 líneas más abajo: `route.ts:140-144`
llama a `alertarHuecoConfiguracion(..., { cron: c, estado })` — ese sí pasa
`cron`, y por eso los huecos de configuración **sí** se deduplican por cron.

Escenario: 22:50 muere `facturar`; 23:10 muere `wa-outbox` (cascada por base
lenta, el modo normal). Sale un correo, el de `facturar`; el de `wa-outbox` se
descarta en silencio.

Causa raíz probable: el identificador viaja en prosa dentro de `error` en vez
de en la llave `cron` que la huella sabe leer.

---

### [MEDIO] OP-31C2-M2 · `npm run setup` en máquina limpia deja `/api/health` en 503 desde el minuto cero (REINCIDENTE)

`package.json:22` (`"setup": "npm install && npm run seed"`) ·
`supabase/seed.sql` · `src/lib/admin/salud.ts:27`, `:132-133`, `:239` ·
`src/app/api/health/route.ts:104-117`

Reverificado hoy con el comando: `grep -c cron_latido supabase/seed.sql` →
**0**. `detalleLatidos` (`salud.ts:239`) itera los **11** ids de `CRONS`
(`:27`: `wa-pendientes, wa-outbox, escalar, facturar, purgar, runner, gps,
asistencia, descarga-sat, jornada, portales-vivos`), no las filas presentes;
para cada id sin fila `juzgarLatido` devuelve `sin_latido` **sin periodo de
gracia** (`:133`). Por tanto `route.ts:105`: `muertos.length === 11` →
`cronCheck='degraded'` → `status='degraded'` → **HTTP 503**, más un
`alertarOperador` con once crons en cada visita.

Consecuencia doble: (a) quien sigue la última línea del propio script ve rojo
el primer día y aprende a ignorarlo; (b) **es la respuesta a la cuarta
pregunta del rubro** —¿se puede reproducir localmente?—: los incidentes del 14
y 15-sep no se pueden reproducir, porque el estado por defecto de todo clon
limpio es indistinguible del estado degradado que se querría reproducir.

Causa raíz probable: el seed cubre el camino del dinero y no el de la
observabilidad.

---

### [MEDIO] OP-M5 · 24 días sin un solo intento de respaldo de Storage, y nada lo mide (REINCIDENTE, cifra 23 → 24)

`.github/workflows/backup-storage.yml:3-12` ·
`.github/workflows/salud-produccion.yml:71-85` · `src/lib/admin/salud.ts:27`

Recontado hoy con la API de Actions: `backup-storage.yml` tiene
**`total_count: 2`** corridas en toda su vida, **ambas `failure`**, **ambas
`schedule`** (25-ago 03:59:52Z y **26-ago 04:03:50Z**), y **cero
`workflow_dispatch`, nunca**. El `schedule` se retiró a propósito «hasta la
primera corrida MANUAL verde» (`:3-11`). Esa corrida no ha ocurrido: hoy
19-sep van **24 días**. Serie: 13 → 17 → 18 → 19 → 20 → 23 → **24**. El
archivo no se toca desde `f623daa`.

Y nada lo mide: el pulso vigila los 11 crons de Vercel (`salud.ts:27`) y el
nivel de migración; el respaldo no es un cron de Vercel, así que no existe
artefacto —health, pulso ni runbook— que diga «el respaldo lleva N días sin
correr».

Consecuencia: `comprobantes` es el bucket con las fotos de los tickets, la
evidencia que el contralor cruza contra su PDF. Sin clientes el daño es cero;
con el primero adentro, es irreversible.

Causa raíz probable: el respaldo se desactivó con una condición de
reactivación que ningún reloj vigila.

---

### [MEDIO] OP-M1 · El runbook sigue prometiendo un cuerpo de `/api/health` que la ruta no devuelve (REINCIDENTE)

`docs/conocimiento/DEPLOY.md:472-473`, `:494` ·
`src/app/api/health/route.ts:192-202` ·
`src/lib/observability/runbook.test.ts:95-108`, `:164-171`

Sin tocar. `DEPLOY.md:472-473` dice que «`/api/health` devuelve `version` …,
`db` y **`sentry`**» y `:494` da el comando con su salida de ejemplo
(`{"ok":true,"db":"ok","sentry":"configurado","version":"553bee7",...}`). El
cuerpo real (`route.ts:192-202`) es
`{ ok, status, checks:{db,crons}, version, migracion, hora }`: **no hay
`sentry`**, y `db` no está en la raíz sino dentro de `checks`. Lo confirma el
propio workflow, que para leer el estado de los crons escribe `.checks?.crons`
(`:79`). La prueba llamada «no promete palancas que el código no tiene»
(`runbook.test.ts:95`) solo mira `.env.example`; la que toca DEPLOY.md
(`:164-171`) se limita a `expect(deploy()).toContain('/api/health')`.

Consecuencia: el paso 3 del runbook a las 3 a.m. es copiar ese `curl` y buscar
`"db":"ok"`. No está. Se lee como que el health se rompió.

Causa raíz probable: el contrato del endpoint cambió dos veces (auditorías 22 y
24) y el runbook se quedó en la forma de antes.

---

### [BAJO] OP-32C2-B2 · El canal de alarma nuevo sigue sin existir en el runbook al que el propio incidente remite (REINCIDENTE)

`docs/conocimiento/DEPLOY.md` (`grep -ic deriva` → **0**) ·
`.github/workflows/salud-produccion.yml:200-234` ·
`src/lib/observability/runbook.test.ts:164-171`

El issue **#476** está abierto ahora mismo con la etiqueta
`deriva-sin-desplegar`, y el runbook —el documento que el issue hermano señala
como «qué mirar, en este orden»— no menciona ni la etiqueta, ni el workflow que
la abre, ni qué hacer con ella. Acota la severidad: el cuerpo del issue se
explica solo (nombra los commits `8b01aec` y `5ce91b2` y dice «Redeploy en
Vercel, o un commit con `[deploy]` en la PRIMERA línea» — verificado en el log
de #691 de hoy).

Causa raíz probable: se añadió un canal de alerta sin añadir su renglón al
documento de guardia.

---

### [BAJO] OP-32C2-B1 · El campo de entrada del rollback pide «URL o ID» y la validación rechaza todos los ID (REINCIDENTE)

`.github/workflows/rollback-production.yml:7` vs `:31`

`:7` describe el parámetro como «**URL o ID exacto** del deployment estable al
que volver». `:31` valida `case "$URL" in https://*) ;; *) … exit 1`. En el
panel de Vercel lo que se copia con un clic es el ID
(`dpl_8rAmyG1Xe7dbRqt6aSKQDhJLasco`); pegarlo da
`::error::deployment_url debe ser HTTPS y explícito.` y el rollback no corre.
Falla cerrado y lo dice; lo que cuesta es un ciclo de incidente descubriendo
que el rótulo del campo no es verdad.

Causa raíz probable: la descripción del input se escribió antes que la guarda.

---

### [BAJO] OP-31C2-B1 · «no hay deriva» es también lo que imprime el detector cuando su referencia va ATRÁS de producción (REINCIDENTE)

`scripts/ci/deriva-sin-desplegar.mjs:39-41`, `:69-77`

Sin tocar. Reproducido hoy invirtiendo los refs:

```
$ node scripts/ci/deriva-sin-desplegar.mjs origin/master cfa00ab
Producción corre todo el código de master: no hay deriva.    (exit 0)
```

`git log A..B` es vacío en dos casos —B no tiene nada nuevo, o B es antepasado
de A— y `resumirDeriva` (`:40-41`) los colapsa en la misma frase tranquilizadora.
Acota la severidad: en CI el paso corre tras `actions/checkout` con
`fetch-depth: 0` (`:51-53`) y no conseguí un camino reproducible dentro del
workflow.

Causa raíz probable: la rama vacía no distingue «nada pendiente» de «mi
referencia está atrás».

---

## Reincidentes reverificados (código idéntico)

| id | sev | archivo:línea | comprobado hoy |
|---|---|---|---|
| `OP-31C-M1` | MEDIO | `salud-produccion.yml:82-84`, `:172-180` | Sin tocar. Dos `::warning::` permanentes sobre un job que sale verde casi siempre — hoy, en `#691`, salieron los dos (`config_ausente` y `real=286min`). |
| `OP-31C-M3` | MEDIO | `deriva-sin-desplegar.mjs:27` | Sin tocar. `RUTAS_QUE_CORREN = ['src/','supabase/']`: `package-lock.json`, `vercel.json`, `next.config.ts` y `public/` siguen fuera y sí se despliegan. |
| `OP-31C-M4` | MEDIO | `deriva-sin-desplegar.mjs:69-77` | Sin tocar: un ref inexistente lanza sin capturar. El paso (`:180`) corre bajo `bash -e`. |
| `OP-A5` | ALTO | `api/cron/wa-outbox/route.ts`; `alerta.ts:129-133`, `:282` | Sin tocar (misma raíz que `OP-31C2-M1`). |
| `OP-A1` | ALTO | `api/cron/escalar/route.ts`; `admin/salud.ts` | Sin tocar. |
| `OP-A2` | ALTO | `DEPLOY.md:29-36` | Sin tocar — sin log drain. Es la causa proximal de que `OP-C1` no tenga respuesta ni para el 14 ni para el 15-sep. |
| `OP-A3` | ALTO | `api/health/route.ts:14-20`; `salud-produccion.yml:30-31` | 9ª ronda. Cadencia recontada hoy sobre `#684`→`#691`: **8 corridas programadas en 24 h** (se declaran 48), hueco máximo **324 min** (11:31→06:07). Serie del máximo: 256 → 310 → 345 → 408 → 335 → **324**. Sin cambio de código; la mejora es de GitHub, no del repo. |
| `OP-A4` | ALTO | `observability/arranque.ts:44-79`; `.env.example` | Sin tocar. |
| `OP-M2` | MEDIO | `salud-produccion.yml:71-85` vs `:109-129` | Sin tocar. |
| `OP-M4` | MEDIO | `scripts/ci/staging-recovery.mjs:200`, `:214`, `:225` | Sin tocar: sigue diciendo «reconstruido hasta 0347» con el repo en **0359**. |
| `OP-M6` | MEDIO | `api/client-error/route.ts:40`, `:60`, `:68` | Sin tocar. |

---

## Lo que revisé y está bien

- **El arreglo de `2c38766`, entero.** Ver el veredicto arriba: la condición de
  `salud-produccion.yml:226` es correcta por el mecanismo de coerción, no por
  suerte; la prueba dejó de fijar la comparación rota
  (`deriva_sin_desplegar.test.ts:206-212`) y ahora la evalúa
  (`:317-357`) con un evaluador que se auto-verifica (`:369-375`) y un
  invariante estructural que atrapa la próxima guarda que no se copie
  (`:346-356`). 20 pruebas verdes.
- **El canal de deriva aguantó tres días de producción, medido.** Issue
  **#476** abierto 16-sep 10:09:12Z, `updated_at == created_at` hoy: nunca se
  comentó, nunca se duplicó, nunca se cerró en falso. Entre medias, **20
  corridas** (`#672`→`#691`), todas `success`. El log de `#691` muestra el
  mensaje completo con los dos commits (`8b01aec`, `5ce91b2`) y la instrucción
  de qué hacer, y el paso de apertura imprimiendo «Ya hay un issue abierto
  (#476); no se duplica». La etiqueta propia hace su trabajo: el paso `:304`
  («Cerrar el issue al recuperarse») corrió `success` en `#691` y **no** tocó
  el issue de deriva.
- **El cotejo de intención sigue vivo y correcto.** `salud-produccion.yml:136-158`
  usa `ultimo-deploy-en-asunto.mjs` (solo la primera línea, la lección de la
  auditoría 25) y `git merge-base --is-ancestor`. Hoy imprime
  `desplegado=cfa00ab ultimo_[deploy]=cfa00ab`, que es verdad.
- **El camino de promoción sí verifica el alias de producción.**
  `scripts/ci/production-candidate.mjs:150-156` compara
  `/v13/deployments/app.likida.ai` contra el id esperado y lanza si difiere, y
  `:176-181` exige además que `/api/health` del candidato traiga
  `version === sha.slice(0,7)` y `migracion.atras === 0`. Es el estándar contra
  el que mido `OP-32C2-A1`.
- **`deploy-preview-promote.yml` es fail-closed en lo que importa.** `:83-84`
  fija un SHA inmutable de 40 hex; `:96-104` cruza las cinco banderas de
  intención; `:213` y `:344` exigen el `project-ref` **literal** del entorno
  correcto (`dmhhygwzgudwgcbixuwp` / `gngoqsvrxdguxvsizpbw`) antes de tocar
  nada; `:342` repite la confirmación `APPLY_MIGRATIONS_AND_PROMOTE` **dentro**
  del job que aplica, no solo en el preflight; `:487-497` impide que el
  `repair` marque como aplicado lo que nunca corrió. Los diagnósticos de build
  suben redactados (`:279-286`, `:371-378`).
- **La cadena de redacción del logger.** `logger.ts:78-81` hace UNA pasada con
  reglas alternadas (para que la salida de una no sea entrada de la siguiente)
  y `:115-121` desambigua correo antes que UUID antes que RFC. `huellaId`
  (`:99-107`) es pura y estable, que es lo que permite agrupar. El defecto de
  `OP-32C3-A2` no está aquí: está en quien le pasa (o no le pasa) el dato.
- **`onRequestError` nunca lanza y espera el flush.** `instrumentation.ts:96-98`
  y `:95` (`await flushObservabilidad()`), con el argumento correcto en el
  comentario: la respuesta al usuario ya se decidió. `:57-64` (tercera prueba
  del test) verifica que argumentos deformes no revienten.
- **La compuerta de mi rubro, corrida hoy:** `npx vitest run scripts/ci
  src/lib/observability src/app/api/health src/lib/admin/salud.test.ts
  src/app/api/client-error src/instrumentation.test.ts` → **40 archivos, 561
  pasan, 5 saltadas, 0 fallos, 9.90 s**. Árbol limpio: no edité ningún archivo
  del repo salvo este documento.

---

## Lo que descarté y por qué

1. **«El `format()` rompe el cierre legítimo».** Lo perseguí primero, porque es
   el modo clásico en que un arreglo de coerción se pasa de frenada.
   `publicarDeriva` (`deriva-sin-desplegar.mjs:110-113`) escribe `hay=0` como
   cadena; `format('{0}','0')` → `'0'`; `'0' == '0'` → true. El tercer caso de
   `deriva_sin_desplegar.test.ts:337-341` lo fija. **No hay hallazgo.**
2. **«El opener quedó sin la guarda de evento».** Es cierto que `:201` no la
   tiene, y el invariante de la prueba solo se aplica al cierre. Pero
   `null == '1'` es `0 == 1` → falsa, así que es inmune por el mismo cálculo
   que causó el bug, y `:359-364` lo fija en las dos direcciones. Asimetría de
   estilo, no de significado. **No lo reporto.**
3. **«El evaluador de la prueba modela mal `success()`».** Lo trata como `true`
   incondicional (`:277`), lo que **no** es GitHub. Pero ninguna de las dos
   condiciones que evalúa usa `success()`, y ante cualquier token o término que
   no modele el evaluador **lanza** (`:268`, `:283`) — es decir, se rompe en
   rojo, no en verde. Queda como nota, no como hallazgo.
4. **«El rollback usa `vercel@41.7.3` y la promoción `59.1.4`: 18 versiones
   mayores de diferencia».** Lo verifiqué (`rollback-production.yml:40` vs
   `deploy-preview-promote.yml:63`) y es real, pero no pude construir un
   escenario con valores: no tengo evidencia de que `vercel rollback` haya
   cambiado de contrato entre esas versiones, y un hallazgo sin el «entra
   esto → sale esto mal» es una sospecha. Se queda fuera.
5. **`production_migrations` aplica migraciones a producción ANTES de que el
   candidato se construya y pase el smoke** (`deploy-preview-promote.yml:320-353`
   corre antes de `:355` y `:404`). Parecía una ventana de «base adelante,
   código atrás». Lo descarté como hallazgo de este rubro: hay respaldo previo
   (`:349`, `supabase-preflight.mjs backup`), el dry-run corre dos veces, y la
   política de migraciones compatibles hacia atrás es una decisión de
   arquitectura, no de operabilidad. Se lo dejo a ese rubro.
6. **`ci-postgres.yml` aparece con fecha de hoy en `ls -la`.** Parecía código
   nuevo sin auditar. `git log` dice que su último toque es `5c1734e`
   (migraciones fiscales); la fecha es del checkout, no del contenido. Falsa
   alarma — la anoto porque es exactamente el tipo de señal que hace perseguir
   un fantasma media hora.
7. **La cadencia mejoró (408 → 324 min de hueco máximo).** No la cuento como
   mejora del repo: `salud-produccion.yml:30-31` no cambió ni una línea, y es
   GitHub quien decide. `OP-A3` sigue abierto con su cifra actualizada.

---

## Lo que NO alcancé a revisar

1. **`ALERTA_EMAIL`, `ALERTA_WA`, `SENTRY_DSN`, `LEGAL_ENFORCE_DOCS` — 9ª ronda
   sin poder responderlo.** Viven en el panel de Vercel. Si `ALERTA_EMAIL` está
   vacía, `alerta.ts:259-266` sale sin mandar nada y los correos que nombran el
   cron de los días 14 y 15 nunca existieron; si `SENTRY_DSN` está vacía,
   `sentry.ts:54-56` hace de todo un no-op y `OP-32C3-A2` es peor de lo escrito
   (no habría ni el `digest` en un sitio consultable). **En ese escenario esta
   nota debería ser 3**, y lo digo sabiendo que no puedo comprobarlo.
2. **Sin red hacia `app.likida.ai`.** Todo lo que afirmo de producción sale de
   `git` y de la API de GitHub (corridas, pasos, logs de job, issues). El dato
   más fresco del endpoint es el capturado en el log de `#691`
   (19-sep 06:06:19Z).
3. **No ejecuté el escenario de `OP-32C3-A1` en un runner.** El mecanismo está
   reproducido localmente con `bash -e` y **medido en producción** en dos
   corridas fechadas, pero no construí un workflow de prueba que lo aísle. El
   repo tampoco tiene ninguna prueba que lea `auto-merge-rutina.yml`.
4. **No corrí `npm run setup` de verdad.** `OP-31C2-M2` sale de leer
   `package.json`, `seed.sql`, `salud.ts` y `route.ts` y del
   `grep -c cron_latido`; no levanté Docker ni la pila local.
5. **`e2e-navegador.yml` (210 líneas), `codeql.yml` (93) y `ci-postgres.yml`
   (242) siguen sin abrir**, 8ª ronda. Esta vez sí abrí enteros
   `deploy-preview-promote.yml` (532), `auto-merge-rutina.yml` (110),
   `recover-empty-staging.yml` (95) y `rollback-production.yml` (49) — de los
   532 del primero salieron dos de los hallazgos de hoy, así que los tres que
   quedan no son deuda barata.
6. **No leí `.env.example` entero** (672 líneas). Solo crucé `SILENCIOSAS`
   (`arranque.ts:44-79`) y lo que `runbook.test.ts` exige.
7. **No corrí la compuerta completa** (`npx vitest run` entero, `tsc`, `lint`).
   Corrí la suite de mi rubro (40 archivos) más
   `scripts/ci/deriva_sin_desplegar.test.ts`, y me apoyo en la línea base del
   MAPA para lo demás.
8. **No medí cuántos PRs `mejora/*` perdió `OP-32C3-A1` en total.** La API
   reporta **7 corridas en `failure`** de 1,754 en `auto-merge-rutina.yml`;
   abrí los logs de las dos más recientes (11-sep y 8-sep) y las dos son
   `exit code 8` sin una línea de salida. Las otras cinco no las abrí.
9. **Todo este documento está anclado a `656bc68`** (HEAD al empezar y al
   cerrar), con `origin/master` en `69becdb`.
