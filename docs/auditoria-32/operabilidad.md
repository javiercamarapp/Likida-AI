# Operabilidad y DX — auditoría 32 (continuación 2, 18-sep)

**Nota: 4/10** (antes 4). Razón del movimiento: **dos de las tres formas
aplican y se cancelan, con un número contable cada una.**

- **Se atacó y subió.** `OP-31C-A1` / `OP-A6` —el ALTO que llevaba seis rondas
  abierto— **está cerrado**. El aviso de deriva ya no muere en el log: el
  detector escribe `$GITHUB_STEP_SUMMARY` y `$GITHUB_OUTPUT`
  (`scripts/ci/deriva-sin-desplegar.mjs:100-117`) y el workflow abre un issue
  con etiqueta propia. **Medido en producción, no leído del YAML:** issue
  **#474** abierto el 16-sep 05:27:22Z y issue **#476** abierto el 16-sep
  10:09:12Z, ambos con la etiqueta `deriva-sin-desplegar`; #476 sigue abierto
  hoy. Es la primera vez en la historia del rubro que un problema de ESTADO de
  producción produce un correo y un artefacto persistente sin que nadie lo
  pida.
- **Deuda que cobró factura, con la factura fechada.** Ese mismo arreglo trajo
  un defecto de la clase que el repo ya declaró CRÍTICA en la auditoría 27
  (`OP-C2`): el paso que CIERRA el issue de deriva no repite la condición del
  paso que lo MIDE, y el **16-sep a las 08:21:57Z** la corrida `#671` —un push
  a master en el que el detector salió `skipped` y no midió nada— cerró #474
  con el comentario «Producción ya corre todo el código de master», que era
  falso: producción corría `cfa00ab` (10-sep) y master llevaba `8b01aec` y
  `5ce91b2` sin publicar. **1 de 1 pushes desde que el mecanismo existe.**
- Y las cifras de fondo no mejoraron: `OP-C1` va por su **8ª ronda** con **dos**
  degradaciones rojas en la ventana (`#657` 14-sep 22:50:27Z → issue #470;
  `#662` 15-sep 19:21:21Z → issue #472) y ninguna de las dos nombra un cron; el
  respaldo de Storage pasó de **20 a 23 días** sin un solo intento.

Cinco sería premiar el cierre de un ALTO en la misma ronda en que el arreglo
que lo cerró reabrió un CRÍTICO ya clasificado. Tres sería negar que por primera
vez la bandeja se enteró de algo sola.

**El riesgo mayor del rubro, hoy:** la única alarma nueva que el repo sabe
disparar se apaga sola con el primer push a `master` —o con producción caída— y
lo hace escribiendo en el issue una frase que no es verdad.

---

## Lo que cambió desde la ronda anterior, y cómo lo medí

`git diff --stat 4047a50..HEAD` sobre los archivos de mi rubro: **6 archivos**.
De ellos, tres son míos y vinieron dentro del squash `8b01aec` (PR #462),
mergeado a master el **16-sep 00:48 UTC**:

```
.github/workflows/salud-produccion.yml  |  64 +++
scripts/ci/deriva-sin-desplegar.mjs     | 135 +++
scripts/ci/deriva_sin_desplegar.test.ts | 224 +++
```

`c361379` **no existe en este clon** (`git cat-file -t c361379` → *fatal: Not a
valid object name*): era un commit de la rama del PR #462 y su contenido vive
hoy dentro de `8b01aec`. Verifiqué el resultado, no el commit.

Todo lo demás de mi rubro (`api/health/route.ts`, `observability/alerta.ts`,
`admin/salud.ts`, `logger.ts`, `instrumentation.ts`, `.env.example`,
`DEPLOY.md`, los otros diez workflows) está **byte a byte igual** que cuando se
escribió `docs/auditoria-31/operabilidad-continuacion-2.md`.

**Cadencia real del pulso, recontada hoy** (40 corridas de `salud-produccion.yml`
vía la API de Actions): en las últimas 24 h, **7 corridas programadas** (se
declaran 48) con hueco máximo **335 min** (5 h 35). Serie del hueco máximo a lo
largo de la auditoría: 256 → 310 → 345 → 408 → **335 min**. Es la primera
mejora de esa serie, y la corrida `#684` de hoy 06:07:14Z imprimió su propio
`::warning::` con `real=286min`.

**Corridas verdes con la deriva viva:** desde que #476 se abrió (16-sep 10:09)
han corrido **13 pulsos, los 13 `success`**. Eso ya no es un defecto: el issue
abierto es el canal, y no comentar en cada corrida es deliberado
(`salud-produccion.yml:192-195`).

---

## Hallazgos

### [CRÍTICO] OP-32C2-C1 · El issue de deriva se cierra solo en el primer push a master, con un mensaje falso — y también se cerraría con producción caída

`.github/workflows/salud-produccion.yml:213-222` (la condición, en `:214`) ·
contraste correcto en `:292-293` · el comentario que afirma lo contrario en
`:196-199` · la prueba que canoniza el defecto en
`scripts/ci/deriva_sin_desplegar.test.ts:206-210`

**Escenario, con valores medidos (pasó; no es hipótesis).**

1. Corrida `#670` (`schedule`, 16-sep **05:27:07Z**). El detector midió deriva
   y el paso «Abrir el issue de deriva sin publicar» creó el issue **#474**,
   `Producción está atrás de master (código sin publicar)`, a las **05:27:22Z**.
2. Corrida `#671` (`push` de `69becdb` a `master`, 16-sep **08:21:45Z**). La
   lista de pasos del job `105…`/`104719828729` lo dice sin ambigüedad:
   - paso 8, «Deriva de código sin publicar (aviso, no bloquea)» →
     `conclusion: skipped` (su guarda es `if: always() && github.event_name !=
     'push'`, `:174`). **No midió nada.**
   - paso 10, «Cerrar el issue de deriva cuando producción alcanza a master» →
     `conclusion: success`. Su log, literal:
     ```
     2026-09-16T08:21:58.3232094Z ✓ Closed issue javiercamarapp/Likida-AI#474
       (Producción está atrás de master (código sin publicar))
     ```
     y el comentario que dejó en el issue es el de `:221`: **«Producción ya
     corre todo el código de master»**.
3. En ese instante producción corría `cfa00ab` (10-sep) y master llevaba
   `8b01aec` y `5ce91b2` sin publicar — lo confirma la corrida `#684` de hoy,
   cuyo detector imprime exactamente esos dos shas. La frase era falsa.
4. Corrida `#672` (`schedule`, 16-sep **10:09:00Z**) volvió a abrirlo, ya con
   número nuevo: **#476**. La ventana ciega fue de **2 h 54 min**, y el episodio
   quedó partido en dos issues distintos.

**El mecanismo.** `steps.deriva.outputs.hay` de un paso saltado es nulo, y la
comparación floja de expresiones de GitHub lo convierte a número: `null == '0'`
es **verdadera**. El comentario del YAML en `:196-199` afirma lo contrario
palabra por palabra —«`hay` vacío = el detector no corrió … Ni abre ni cierra»—
y la corrida `#671` es la refutación. (La apertura, `hay == '1'` en `:201`, sí
es inmune por el mismo cálculo: `null` → 0 ≠ 1.)

**Segundo camino, por el mismo mecanismo y sin instancia medida todavía:**
`:178` y `:179` hacen `exit 0` **sin escribir salidas** cuando `/api/health` no
publica versión o cuando el sha desplegado no está en master. El paso queda
`success` con `hay` nulo → se ejecuta el cierre. Es decir: **producción caída
limpia la alarma de deriva.**

**Consecuencia.** El único artefacto que hoy dice que el arreglo de
`cuadre/desde_db.ts` (ARQ-C2: $90,600 impresos donde lo correcto son $95,300)
no está en producción se apaga con cualquier push a `master` —y esta rama, al
mergearse, será uno—, dejando en el historial del issue una afirmación falsa
sobre el estado de producción. Es la regla «un rótulo tiene que ser verdad»
rota en el sitio donde más caro sale: el registro al que se acude para
reconstruir qué pasó.

**Refutación intentada, y no la hay.** Busqué el guardarraíl: existe, y está en
el paso de al lado. El cierre del issue del PULSO (`:292-293`) sí lleva
`success() && github.event_name != 'push'`, puesto en la auditoría 27 por este
mismísimo defecto (`#339`, cerrado por un push con producción 224 commits
atrás). La lección se aplicó a un issue y no se copió al otro. La prueba nueva
tampoco lo cubre: `deriva_sin_desplegar.test.ts:206-210` afirma que el paso
contiene `steps.deriva.outputs.hay == '0'` —exactamente la condición rota— y no
comprueba ninguna guarda de evento.

Causa raíz probable: el paso que declara la recuperación no repite la condición
del paso que la comprueba, y una salida ausente se lee como «cero» en lugar de
«no se midió».

---

### [ALTO] OP-32C2-A1 · `rollback-production.yml` certifica el rollback contra el deployment que le escribiste, nunca contra `app.likida.ai`

`.github/workflows/rollback-production.yml:41-49` (el `curl` en `:46`, la
aserción en `:47`, el rótulo en `:48-49`)

**Escenario, con valores.** Producción rota de madrugada. Javier dispara el
workflow con `deployment_url=https://likida-ai-7f3c9d2-likida.vercel.app` y
`confirmation=ROLLBACK_PRODUCTION`. `:40` corre `vercel rollback "$URL"`. Acto
seguido `:46` hace:

```
curl --fail --silent --show-error --retry 5 --max-time 15 "$URL/api/health"
```

— al **mismo deployment que él escribió**, no a `https://app.likida.ai` — y
`:47` exige `.status == "ok" and .checks.db == "ok"`. Cualquier deployment vivo
del proyecto cumple las dos: producción misma las cumple hoy mismo
(`http=200 estado=ok crons=config_ausente`, corrida `#684`, 18-sep 06:07:11Z).
El job sale verde y `:48-49` escribe en el resumen **«### Rollback verificado —
`/api/health`: status=ok, db=ok»**.

Lo que el paso NO comprueba, y podría: que `https://app.likida.ai/api/health`
conteste; que su campo `version` sea el sha que se quería restaurar; que el
alias se haya movido. Si el rollback no mueve el alias —token sin permiso sobre
el dominio, operación asíncrona, o simplemente la URL equivocada de una lista
de deployments que se parecen— el workflow certifica un rollback que no ocurrió,
o que puso en producción un build distinto del que se pretendía.

**Consecuencia.** La única palanca de emergencia documentada
(`docs/operacion/RESILIENCIA-DEPLOY.md:233-241`) devuelve «verificado» sin haber
mirado producción ni una vez. En un incidente eso no es un aviso perdido: es un
falso «ya está arreglado» que hace cerrar la laptop.

**Refutación intentada.** El workflow sí es fail-closed en lo demás (`:31-32`
exigen HTTPS y la palabra literal; `:39` exige `VERCEL_TOKEN`; `set -euo
pipefail` en los tres pasos) y `curl --fail` haría rojo un 4xx. Nada de eso
toca el invariante que importa, que es sobre el alias, no sobre la URL.

Causa raíz probable: se asierta sobre la URL de entrada en vez de sobre el
dominio de producción y el sha esperado.

---

### [CRÍTICO] OP-C1 · 8ª ronda: las dos degradaciones rojas de la ventana dejaron una palabra y ningún identificador (REINCIDENTE)

`src/app/api/health/route.ts:195` (`checks: { db, crons: cronCheck }`),
`:104-117`, `:145-154` · `.github/workflows/salud-produccion.yml:79`, `:81`,
`:85`, `:281` · `supabase/migrations/0155_purgas_y_bucket_comprobantes.sql:432-439`
· `docs/conocimiento/DEPLOY.md:29-36`

Reverificado abriendo los archivos: **el código no cambió**. `checks.crons`
sigue siendo una sola palabra para dos ramas distintas (`muertos` en `:105`,
`regresiones` en `:145`); los nombres siguen saliendo solo por
`logger.error('health.cron_vencido'…)` (`:107-109`) y
`logger.error('health.cron_estado_no_ok'…)` (`:146-149`) hacia los runtime logs
de Vercel, que `DEPLOY.md:33-36` declara **sin drain y de retención corta**.

**Cifra nueva de esta ronda: fueron dos episodios, no uno.**

| corrida | cuándo | issue | cuerpo del issue |
|---|---|---|---|
| `#657` | 14-sep 22:50:27Z | #470 (abierto 22:50:44Z, cerrado solo 15-sep 01:03:33Z) | el texto fijo de `:281` |
| `#662` | 15-sep 19:21:21Z | #472 (abierto **19:21:42Z**, cerrado solo 15-sep 22:22:24Z) | el mismo texto fijo |

El log de `#662` que sí conservo muestra que el paso «Producción corre el último
`[deploy]`» pasó (`desplegado=cfa00ab ultimo_[deploy]=cfa00ab`) y que la
cadencia se midió (`real=206min`): el fallo estuvo en el primer paso, el de
`/api/health`. Y el issue `#472` que abrió dice, entero, lo que dice `:281`:
«El workflow **Salud de producción** falló: \<url\> … El cuerpo de `/api/health`
(status, checks.crons, migracion) está en el log de la corrida» — remite al log,
y el log dice una palabra.

**Consecuencia.** Hoy, 18-sep, no existe en ningún artefacto del repo ni de
GitHub el nombre del cron que se degradó el 14 ni el del 15. `cron_latido` sigue
siendo `id text primary key` —una fila por cron, sobrescrita— así que tampoco lo
guarda la base. Si alguno de los dos fue `facturar` o `wa-outbox`, eso es el
camino del dinero, y la pregunta del contralor por la mañana no tiene respuesta
reconstruible.

Causa raíz probable: el detalle y el vigilante no comparten ningún canal
durable.

---

### [ALTO] OP-31C2-A1 · La anotación que llega al correo sigue siendo 90.8 % lista de migraciones ya aplicadas (REINCIDENTE)

`.github/workflows/salud-produccion.yml:80`, `:81`, `:85`

Sin tocar. `:80` sigue leyendo `migracion` con `JSON.stringify(j.migracion)` —el
objeto entero, incluido `aplicados`— y `:85` lo interpola dentro del `::error::`
que GitHub convierte en la anotación del job y en el correo.

**Esta ronda lo medí contra el cuerpo REAL de producción, no reconstruido.** El
log de la corrida `#671` (16-sep 08:21:55Z) trae la línea completa: `aplicados`
llega con **333** números de migración, de `"0001"` a `"0356"`, y el resto de
la línea útil son `http=200 estado=ok crons=config_ausente` más
`base/codigo/atras/adelante`. La proporción de la ronda anterior (2,330 de 2,566
caracteres) se sostiene: la información que `aplicados` aporta ya está resumida
tres campos antes en `atras:0,adelante:0`.

Consecuencia: lo que Javier ve en el teléfono cuando el pulso se pone rojo es
una pared de números de migración, ninguno relacionado con el fallo.

Causa raíz probable: se imprime el campo entero de un contrato hecho para una
máquina en el sitio donde lo lee una persona.

---

### [MEDIO] OP-31C2-M1 · El nombre del cron muerto viaja en el único campo que la huella de deduplicación no mira (REINCIDENTE, ahora con el contraste dentro del mismo archivo)

`src/app/api/health/route.ts:114-117` y `:151-154` ·
`src/lib/observability/alerta.ts:129-133`, `:282`

Sin tocar. `huellaDeDetalle` (`alerta.ts:129`) arma la llave del piso horario a
partir de `SALIENTES` (`:130-132`), que **incluye `'cron'` exactamente para
esto**. Los dos llamadores de crons muertos pasan `{ error, codigo }` y nada
más, y `codigo` es una constante (`'cron_sin_latido'`, `'cron_estado_no_ok'`):
la huella resultante es siempre la misma, y `reservarPiso` (`:282`) deja salir
**un correo por hora pase lo que pase**.

**El contraste está 26 líneas más abajo, en el mismo archivo:**
`route.ts:140-144` llama a `alertarHuecoConfiguracion(..., { cron: c, estado })`
— ese sí pasa `cron`, y por eso los huecos de configuración **sí** se deduplican
por cron. El mecanismo funciona; los dos llamadores que importan lo desactivan
sin querer.

Escenario, con valores: 22:50 muere `facturar`, 23:10 muere `wa-outbox` (cascada
por base lenta, que es el modo normal). Sale un correo, el de `facturar`; el de
`wa-outbox` se descarta en silencio. Es literalmente el defecto que
`alerta.ts:275-281` documenta haber arreglado en la auditoría 22.

Causa raíz probable: el identificador viaja en prosa dentro de `error` en vez de
en la llave `cron` que la huella sabe leer.

---

### [MEDIO] OP-31C2-M2 · `npm run setup` en máquina limpia deja `/api/health` en 503 desde el minuto cero (REINCIDENTE)

`package.json:21-22` · `supabase/seed.sql` (202 líneas) ·
`src/lib/admin/salud.ts:28`, `:132-133`, `:239` ·
`src/app/api/health/route.ts:104-117`

Reverificado hoy, con el comando: `grep -c cron_latido supabase/seed.sql` → **0**
en sus 202 líneas. `npm run setup` = `npm install && npm run seed`
(`package.json:21-22`). `detalleLatidos` (`salud.ts:239`) itera los **11** ids
de `CRONS` (`:28`), no las filas presentes; para cada id sin fila
`juzgarLatido` devuelve `sin_latido` **sin periodo de gracia** (`:133`). Por
tanto `route.ts:105`: `muertos.length === 11` → `cronCheck='degraded'` →
`status='degraded'` → **HTTP 503**, más un `alertarOperador` con once crons en
cada visita.

Consecuencia doble: (a) el desarrollador que sigue la última línea del propio
script ve rojo el primer día y aprende a ignorarlo; (b) **es la respuesta a la
cuarta pregunta del rubro**: los incidentes del 14 y 15-sep no se pueden
reproducir localmente, porque el estado por defecto de todo clon limpio es
indistinguible del estado degradado que se querría reproducir.

Causa raíz probable: el seed cubre el camino del dinero y no el de la
observabilidad.

---

### [MEDIO] OP-M5 · 23 días sin un solo intento de respaldo de Storage, y nada lo mide (REINCIDENTE, cifra actualizada 20 → 23)

`.github/workflows/backup-storage.yml:3-12` ·
`.github/workflows/salud-produccion.yml:71-85` · `src/lib/admin/salud.ts:28`

Recontado hoy con la API de Actions: `backup-storage.yml` tiene
**`total_count: 2`** corridas en toda su vida, **ambas `failure`**, **ambas
`schedule`** (25-ago 03:59:52Z y **26-ago 04:03:50Z**), y **cero
`workflow_dispatch`, nunca**. El `schedule` se retiró a propósito «hasta la
primera corrida MANUAL verde» (`:3-11`). Esa corrida no ha ocurrido: hoy 18-sep
van **23 días**. Serie: 13 → 17 → 18 → 19 → 20 → **23**.

Y nada lo mide: el pulso vigila 11 crons de Vercel (`salud.ts:28`) y el nivel de
migración; el respaldo no es un cron de Vercel, así que no existe artefacto
—health, pulso ni runbook— que diga «el respaldo lleva N días sin correr».

Consecuencia: `comprobantes` es el bucket con las fotos de los tickets, la
evidencia que el contralor cruza contra su PDF. Sin clientes el daño es cero;
con el primero adentro, es irreversible.

Causa raíz probable: el respaldo se desactivó con una condición de reactivación
que ningún reloj vigila.

---

### [MEDIO] OP-M1 · El runbook sigue prometiendo un cuerpo de `/api/health` que la ruta no devuelve, y la prueba que existe para atrapar eso no mira ahí (REINCIDENTE, con el hueco del guardarraíl medido)

`docs/conocimiento/DEPLOY.md:472-473`, `:494` ·
`src/app/api/health/route.ts:192-202` ·
`src/lib/observability/runbook.test.ts:95-108`, `:164-171`

Sin tocar. `DEPLOY.md:472-473` dice que «`/api/health` devuelve `version` …,
`db` y **`sentry`**» y `:494` da el comando con su salida de ejemplo:

```
curl -s https://app.likida.ai/api/health   # {"ok":true,"db":"ok","sentry":"configurado","version":"553bee7",...}
```

El cuerpo real (`route.ts:192-202`) es
`{ ok, status, checks:{db,crons}, version, migracion, hora }`: **no hay
`sentry`**, y `db` no está en la raíz sino dentro de `checks`. Lo confirma el
cuerpo capturado en la corrida `#671`, y lo confirma el propio workflow, que
para leer el estado de los crons tiene que escribir `.checks?.crons` (`:79`) —
y que no lee `db` en ninguna parte, porque en la raíz ya no está.

**Lo que agrego esta ronda:** el repo tiene una prueba llamada literalmente «no
promete palancas que el código no tiene» (`runbook.test.ts:95`) — y solo mira
`.env.example` contra cuatro nombres de variable en duro. La prueba que sí toca
DEPLOY.md (`:164-171`) se limita a `expect(deploy()).toContain('/api/health')`:
comprueba que la cadena aparezca, no que lo que se dice de ella sea verdad. El
guardarraíl existe, tiene nombre, y no cubre el caso.

Consecuencia: el paso 3 del runbook a las 3 a.m. es copiar ese `curl` y buscar
`"db":"ok"` en la salida. No está. Se lee como que el health se rompió.

Causa raíz probable: el contrato del endpoint cambió dos veces (auditoría 22 y
24) y el runbook se quedó en la forma de antes.

---

### [BAJO] OP-31C2-B1 · «Producción corre todo el código de master: no hay deriva» es también lo que imprime el detector cuando su referencia va ATRÁS de producción (REINCIDENTE, reproducido hoy)

`scripts/ci/deriva-sin-desplegar.mjs:39-41`, `:69-77`

Sin tocar. Reproducido hoy en este checkout invirtiendo los dos refs, que es lo
que produce el mismo `git log A..B` vacío:

```
$ node scripts/ci/deriva-sin-desplegar.mjs origin/master cfa00ab
Producción corre todo el código de master: no hay deriva.
$ echo $?  →  0
```

`git log A..B` es vacío en dos casos —B no tiene nada nuevo, o B es antepasado
de A— y `resumirDeriva` (`:40-41`) los colapsa en la misma frase tranquilizadora.

**Acota la severidad:** hoy el clon vino con `origin/master` **fresco**
(`69becdb`, el mismo que el remoto), a diferencia de la ronda anterior, y en CI
el paso corre tras `actions/checkout` con `fetch-depth: 0` (`:51-53`). No
conseguí un camino reproducible dentro del workflow. El camino que sí demostré
es el de correr el script a mano en un clon.

Causa raíz probable: la rama vacía no distingue «nada pendiente» de «mi
referencia está atrás».

---

### [BAJO] OP-32C2-B1 · El campo de entrada del rollback pide «URL o ID» y la validación rechaza todos los ID

`.github/workflows/rollback-production.yml:6-9` vs `:31`

`:7` describe el parámetro como «**URL o ID exacto** del deployment estable al
que volver». `:31` valida `case "$URL" in https://*) ;; *) … exit 1`. Escenario:
en el panel de Vercel lo que se copia con un clic es el ID
(`dpl_8rAmyG1Xe7dbRqt6aSKQDhJLasco`); pegarlo da
`::error::deployment_url debe ser HTTPS y explícito.` y el rollback no corre.

Falla cerrado, que está bien, y lo dice, que está mejor. Lo que cuesta es un
ciclo entero de incidente descubriendo que el rótulo del campo no es verdad —
`docs/operacion/RESILIENCIA-DEPLOY.md:235` repite la misma promesa
(«`deployment_url` HTTPS exacta»), así que ahí sí coinciden; el que miente es el
formulario que se ve al apretar el botón.

Causa raíz probable: la descripción del input se escribió antes que la guarda.

---

### [BAJO] OP-32C2-B2 · El canal de alarma nuevo no existe en el runbook al que el propio incidente remite

`docs/conocimiento/DEPLOY.md` (499 líneas, **cero** ocurrencias de «deriva») ·
`.github/workflows/salud-produccion.yml:200-222` ·
`src/lib/observability/runbook.test.ts:164-171`

`grep -i deriva docs/conocimiento/DEPLOY.md` → sin resultados. El issue #476
está abierto **ahora mismo** con la etiqueta `deriva-sin-desplegar`, y el
runbook —el documento que el issue hermano señala como «qué mirar, en este
orden»— no menciona ni la etiqueta, ni el workflow que la abre, ni qué hacer
con ella. La prueba `runbook.test.ts:164-171`, que se escribió justamente
porque «la ruta nació … y dos rondas después nadie la consumía ni el runbook la
nombraba», no se extendió al canal nuevo.

Acota la severidad: el cuerpo del issue se explica solo (nombra los commits y
dice «Redeploy en Vercel, o un commit con `[deploy]` en la PRIMERA línea»).

Causa raíz probable: se añadió un canal de alerta sin añadir su renglón al
documento de guardia.

---

## Reincidentes reverificados (código idéntico; `git diff 4047a50..HEAD` no toca ninguno de estos archivos)

| id | sev | archivo:línea | comprobado hoy |
|---|---|---|---|
| `OP-31C-M1` | MEDIO | `salud-produccion.yml:82-84`, `:172-180` | Sin tocar. Dos `::warning::` permanentes sobre un job que sale verde casi siempre — el de `config_ausente` salió en `#671` y el de cadencia en `#684`. |
| `OP-31C-M3` | MEDIO | `deriva-sin-desplegar.mjs:27` | Sin tocar. `RUTAS_QUE_CORREN = ['src/','supabase/']`: `package-lock.json`, `vercel.json`, `next.config.ts` y `public/` siguen fuera y sí se despliegan. |
| `OP-31C-M4` | MEDIO | `deriva-sin-desplegar.mjs:69-77` | Sin tocar: un ref inexistente lanza sin capturar. El paso (`:180`) corre bajo `bash -e` y `:272` sigue siendo `if: failure()`. |
| `OP-A5` | ALTO | `api/cron/wa-outbox/route.ts`; `alerta.ts:129-133`, `:282` | Sin tocar (misma raíz que `OP-31C2-M1`). |
| `OP-A1` | ALTO | `api/cron/escalar/route.ts`; `admin/salud.ts` | Sin tocar. |
| `OP-A2` | ALTO | `DEPLOY.md:29-36` | Sin tocar — sin log drain. Es la causa proximal de que `OP-C1` no tenga respuesta ni para el 14 ni para el 15-sep. |
| `OP-A3` | ALTO | `api/health/route.ts:14-20`; `salud-produccion.yml:30-31` | 8ª ronda. Cadencia recontada: **7 corridas programadas en 24 h**, hueco máximo **335 min**. Mejora respecto de 408, sin cambio de código. |
| `OP-A4` | ALTO | `observability/arranque.ts:44-79`; `.env.example` | Sin tocar. |
| `OP-M2` | MEDIO | `salud-produccion.yml:71-85` vs `:109-129` | Sin tocar. |
| `OP-M4` | MEDIO | `scripts/ci/staging-recovery.mjs:200`, `:214`, `:225` | Sin tocar: sigue diciendo «reconstruido hasta 0347» con el repo en **0359**. |
| `OP-M6` | MEDIO | `api/client-error/route.ts:40`, `:60`, `:68` | Sin tocar. |
| `OP-31C-M2` | MEDIO | `deriva_sin_desplegar.test.ts` | **Parcialmente cerrado.** Las pruebas de cableado pasaron de afirmar sobre el YAML entero a afirmar sobre el PASO (`:178-181` parte los bloques por `- name:`), que es la mutación que el auditor anterior no mataba. Lo que queda abierto es peor y va como `OP-32C2-C1`: la prueba afirma la condición **equivocada**. |

---

## Lo que revisé y está bien

- **El aviso de deriva ya llega, y llega con el dato.**
  `scripts/ci/deriva-sin-desplegar.mjs:100-117` escribe los dos canales
  (`$GITHUB_STEP_SUMMARY` y `$GITHUB_OUTPUT`), con el delimitador `FIN_DERIVA`
  para que el mensaje multilínea no se corte en la primera línea — y el log de
  la corrida `#684` demuestra que el issue recibe la lista completa de commits,
  no solo el encabezado. `:201` y `:209` evitan duplicar issues («Ya hay un
  issue abierto (#476); no se duplica»). La etiqueta propia
  (`deriva-sin-desplegar`) es correcta: si compartiera `salud-produccion`, el
  paso `:292` lo cerraría en la primera corrida verde.
- **El lazo de alarma del pulso sigue siendo rápido y correcto.** Dos episodios
  medidos: `#657` falló 22:50:41Z → issue #470 a las 22:50:44Z (**3 s**);
  `#662` falló 19:21:4xZ → issue #472 a las **19:21:42Z**. Los dos se cerraron
  solos al recuperarse, y los cerró una corrida `schedule` que sí evaluó el
  invariante, no un push — la guarda de `OP-C2` (`:292-293`) hizo su trabajo.
  El defecto no es el lazo; es lo que el lazo lleva dentro, y es que esa misma
  guarda no se copió al issue de deriva.
- **El cotejo de intención sigue vivo y correcto.** `:136-158` usa
  `ultimo-deploy-en-asunto.mjs` (solo la primera línea, la lección de la
  auditoría 25) y `git merge-base --is-ancestor`, y `:152` falla explícitamente
  si el sha desplegado no está en master. Hoy imprime
  `desplegado=cfa00ab ultimo_[deploy]=cfa00ab`, que es verdad.
- **`rollback-production.yml` es fail-closed donde lo declara** (`:30-32`,
  `:38-39`): HTTPS obligatorio, confirmación literal `ROLLBACK_PRODUCTION`,
  `VERCEL_TOKEN` comprobado antes de tocar nada, `set -euo pipefail` en los tres
  pasos y la CLI fijada a `vercel@41.7.3`.
- **`ci.yml` es una compuerta de verdad, y cabe en su reloj.** `:21-23` corre en
  **todas** las ramas; `:53-60` typecheck + ratchet de lint; `:76` tests con
  umbral de cobertura; `:84` las dos pruebas de tiempo que `--coverage` se
  salta; `:88` build; `:120` smoke de navegador; `:141-161` auditoría runtime
  fail-closed con tres reintentos que distingue proveedor caído de CVE real. Las
  cuatro corridas de esta rama que miré (`#2634`, `#2635`, `#2636`, `#2639/40`)
  salieron `success` en **~9 minutos**, holgadamente bajo el `timeout-minutes:
  15` de `:38`.
- **`aviso-deploy-en-pr.yml` está bien escrito**, incluido el detalle que suele
  romperse: el heredoc `<<EOF` de `:57-69` y su terminador quedan en columna 0
  tras el desangrado del bloque YAML, así que no se traga el resto del script;
  y `:74-78` evita duplicar el comentario en cada push a la rama.
- **La compuerta de mi rubro, corrida hoy:** `npx vitest run scripts/ci
  src/lib/observability src/app/api/health src/lib/admin/salud.test.ts
  src/app/api/client-error src/instrumentation.test.ts` → **40 archivos, 558
  pasan, 5 saltadas, 0 fallos, 5.59 s**. Árbol limpio: no edité ningún archivo
  del repo salvo este documento.

---

## Lo que NO alcancé a revisar

Sin esto la nota es una mentira por omisión.

1. **`ALERTA_EMAIL`, `ALERTA_WA`, `SENTRY_DSN`, `LEGAL_ENFORCE_DOCS` — 8ª ronda
   sin poder responderlo.** Viven en el panel de Vercel. Si `ALERTA_EMAIL` está
   vacía, `alerta.ts:259-266` sale sin mandar nada y los correos que nombran el
   cron de los días 14 y 15 nunca existieron; si `SENTRY_DSN` está vacía,
   `logger.ts:204-205` tampoco replicó nada. En ese escenario `OP-C1` es peor de
   lo escrito y esta nota debería ser 3.
2. **Sin red hacia `app.likida.ai`.** Todo lo que afirmo de producción sale de
   `git` y de la API de GitHub (corridas, pasos, logs de job, issues). El dato
   más fresco que tengo del endpoint es el cuerpo capturado en el log de la
   corrida `#671` (16-sep 08:21:55Z) y la línea de `#684` (hoy 06:07:11Z).
3. **No conseguí el cuerpo de `/api/health` de la corrida `#662`** (15-sep
   19:21): el log que la API devuelve está recortado por la cola y el primer
   paso queda fuera. Sé que ese paso fue el que falló —los tres siguientes
   corrieron y el issue se abrió— pero **no sé qué palabra imprimió**. Si
   alguien la recupera, `OP-C1` gana su segunda cita literal.
4. **No ejecuté `npm run setup` de verdad.** `OP-31C2-M2` está derivado de leer
   `seed.sh`, `seed.sql`, `salud.ts` y `route.ts` y del `grep -c cron_latido`;
   no levanté Docker ni la pila local.
5. **No ejecuté el escenario de `OP-32C2-C1` en un runner.** El mecanismo está
   **medido en producción** (los pasos y el log de la corrida `#671`), pero no
   construí un workflow de prueba que aísle `null == '0'`. Quien lo arregle
   debería hacerlo, porque la prueba actual afirma la condición rota.
6. **`deploy-preview-promote.yml`: leí las primeras 140 de sus 532 líneas** (los
   inputs, el `preflight`, `prepare_preview` y el arranque de `quality`). Los
   ocho jobs restantes —migraciones en staging, `repair_migrations`, el smoke y
   el alias de producción— siguen sin auditar por 7ª ronda. Tampoco abrí
   `recover-empty-staging.yml`, `e2e-navegador.yml`, `codeql.yml`,
   `auto-merge-rutina.yml` ni `ci-postgres.yml`.
7. **No leí `.env.example` entero** (672 líneas). Solo crucé `SILENCIOSAS`
   (`arranque.ts:44-79`) y lo que `runbook.test.ts` exige.
8. **No corrí la compuerta completa** (`npm test`, `npm run lint`, `tsc`). Corrí
   la suite de mi rubro (40 archivos) y me apoyo en la línea base del MAPA para
   lo demás.
9. **Todo lo de este documento está anclado a `65dbb9a`** (HEAD al empezar y al
   cerrar), con `origin/master` en `69becdb` verificado fresco contra el remoto.
