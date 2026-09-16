# Operabilidad y DX — auditoría 31, continuación

**Nota: 5/10** (antes 5). **La nota se queda, y las tres razones de movimiento
se anulan entre sí en la misma medición.** El arreglo de `30e5e14` es real: el
detector existe, reproduce el caso de septiembre con su sha, y sus pruebas
unitarias mueren cuando destripo el veredicto. Pero no mueve ninguna de las
dos anclas del rubro: el fallo del camino del dinero sigue sin generar una
alerta con identificador (ancla del 8), y sigue habiendo logs que nadie mira
con un CI que existe (ancla del 6). Y en la misma ventana **las tres cifras
que la 31 usó para justificar el 5 empeoraron**: las corridas verdes sobre el
arreglo fiscal sin publicar pasaron de 7 a **14**; el hueco máximo del pulso
pasó de 310 a **345 min**; el respaldo de Storage pasó de 18 a **19 días** sin
un solo intento. «Se atacó y subió» y «deuda que cobró factura» apuntan en
direcciones opuestas con el mismo peso, y el código que sostiene el resto del
rubro no cambió ni una línea (`git diff 0f5ca48..HEAD` sobre mi rubro toca
exactamente tres archivos, los tres del arreglo).

**El riesgo mayor del rubro, hoy:** el repo tiene **un solo canal de aviso** —
la conclusión roja de un workflow programado, que GitHub convierte en correo y
el paso `:228` en issue — y todo lo que no es rojo (`crons=degraded`,
`config_ausente`, y ahora la deriva de código del camino del dinero) muere en
el log de una corrida verde que nadie abre.

---

## El arreglo de esta continuación, verificado

`30e5e14` — `scripts/ci/deriva-sin-desplegar.mjs` (82 líneas),
`deriva_sin_desplegar.test.ts` (100) y un paso nuevo en
`.github/workflows/salud-produccion.yml:160-179`.

### Lo que sí hace, medido

```
$ node scripts/ci/deriva-sin-desplegar.mjs cfa00ab origin/master
::warning::Producción está atrás de master: 1 commit de src/ / supabase/ sin publicar.%0A
  · 5ce91b2 Auditoría 30 — 12 rubros, 122 hallazgos, 3 arreglos con prueba · global 6.0 → 5.2 (#460)%0A
Si eso es a propósito, ignora este aviso. Si no: Redeploy en Vercel, o un commit con [deploy] en la PRIMERA línea.
$ echo $?
0
```

Reproducido por mí contra la historia real del clon. Nombra el commit que
lleva `cuadre/desde_db.ts` (ARQ-C2, el cubo del 15 %). El invariante nuevo es
el correcto: pregunta por el ESTADO, no por la intención. Y no rompió nada —
`npx vitest run scripts/ src/lib/observability src/lib/likida/runbook.test.ts
src/app/api/health src/app/admin/crons src/lib/admin/salud.test.ts
src/app/api/cron/wa-outbox src/app/api/client-error` → **45 archivos, 638
pasan, 5 saltadas, 0 fallos, 7.71 s**; `npx tsc --noEmit -p .` exit 0.

### La batería de mutación (cada una restaurada, árbol limpio al final)

| # | Mutación | Pruebas |
|---|---|---|
| M1 | `resumirDeriva`: `commits = []` al entrar (siempre «no hay deriva») | **2 fallan** ✔ |
| M2 | `RUTAS_QUE_CORREN = ['src/']` (se cae `supabase/`) | 8/8 pasan ✘ |
| M3 | el paso del workflow con `if: false` (el detector nunca corre) | 8/8 pasan ✘ |
| M4 | `node … "$version" "$version"` en vez de `origin/master` (siempre «no hay deriva») | 8/8 pasan ✘ |

**La prueba nueva muere al mutar la función pura y sobrevive a las tres
mutaciones del cableado** — que es justamente la parte de la que trataba
OP-A6. Ver `OP-31C-M2`.

### ¿Cierra OP-A6?

**NO. Lo mueve de sitio, y lo mueve al sitio donde ya está atascado OP-C1.**

El hallazgo era: «producción se quedó atrás con dos archivos del camino del
dinero y el único artefacto que alguien mira dijo verde». Después del arreglo,
ese artefacto **sigue diciendo verde** — el paso es `::warning::` sin `exit 1`
por diseño — y el aviso no se escribe en `$GITHUB_STEP_SUMMARY` (el paso
vecino, `:206`, `:211`, `:218`, sí lo hace), no abre issue (`:228` es
`if: failure()`), y no manda correo: la cabecera del propio workflow
(`:22-26`) dice que **«GitHub manda correo al dueño del repo cuando un
workflow programado falla»** — el rojo es el único canal que el repo tiene, y
el paso nuevo tiene prohibido producirlo.

Medido hoy contra la API: las corridas programadas **#644…#654** (12-sep
21:05Z → 14-sep 07:59Z, once, todas `conclusion: success`) corrieron sobre
`head_sha 4047a50` con `cfa00ab` como último `[deploy]`. Sumadas a las
`#641…#643` que contó la 31, son **14 corridas verdes consecutivas** sobre el
mismo arreglo fiscal sin publicar (la 31 midió 7). Con el paso mergeado,
las catorce habrían impreso el `::warning::` y las catorce habrían mandado
exactamente **cero** notificaciones.

Aclaración necesaria: el paso vive en la rama `claude/auditoria-31` (PR #462,
abierto). **No ha corrido ni una vez en producción**; todo lo que afirmo de él
sale de leerlo y de ejecutarlo localmente.

---

## Hallazgos

### [ALTO] `OP-31C-A1` — El aviso de deriva no sale del log de una corrida verde: ni correo, ni resumen, ni issue (NUEVO; es lo que impide cerrar OP-A6)

`.github/workflows/salud-produccion.yml:172-179` ·
`scripts/ci/deriva-sin-desplegar.mjs:76-81` · contraste: `:206`, `:211`, `:218`

Escenario, con valores de hoy: el 12-sep 19:12Z se mergeó `5ce91b2` con
`cuadre/desde_db.ts` (acumulado $100,000 y un ticket de diésel en efectivo de
$4,700 fotografiado dos veces → el previo imprime $90,600 donde lo correcto
son $95,300). Con el paso nuevo mergeado, cada corrida programada desde
entonces imprime `::warning::Producción está atrás de master: 1 commit …
5ce91b2 …` **dentro de un job cuya `conclusion` es `success`**. Ese texto no
llega al `$GITHUB_STEP_SUMMARY` (grep sobre el archivo: las tres únicas
escrituras son del paso de cadencia), no dispara `:228` (`if: failure()`) y no
produce correo. Catorce corridas después (#641…#654, 14-sep 07:59Z), el
arreglo del cubo del 15 % sigue sin publicar y no existe un artefacto que lo
diga en la bandeja de nadie.

Consecuencia: para el contralor no cambia nada — producción firma PDFs con un
cupo mal calculado y la evidencia de la mañana siguiente es la misma que la de
`OP-C1`: una palabra dentro de un log que nadie abre porque el color es verde.
El rubro compró un detector correcto y lo conectó a un canal muerto.

Causa raíz probable: el repo tiene un único canal de notificación (rojo →
correo + issue) y esta señal se enrutó deliberadamente fuera de él sin darle
otro.

---

### [MEDIO] `OP-31C-M1` — El aviso nace permanente, y ya hay otro `::warning::` permanente al lado

`.github/workflows/salud-produccion.yml:83` y `:172-179` ·
`scripts/ci/deriva-sin-desplegar.mjs:76-79`

Escenario, con valores: el último commit con `[deploy]` en el asunto es
`cfa00ab` (corrida `#630`, `head_commit.message` = `[deploy] publicar fix de
integridad de REN-C1 (keyset en candidatosDb)`); `origin/master` es `4047a50`.
`CLAUDE.md` documenta que **los pushes a GitHub no despliegan**, así que
«master por delante de producción» es el estado NORMAL, no la excepción: lleva
así 14 corridas seguidas. El paso nuevo, por tanto, avisará en ~100 % de las
corridas — justo al lado del `::warning::` de `config_ausente` (`:83`), que
`OP-A1` ya midió disparándose en el 100 % de las corridas.

Consecuencia: dos avisos permanentes sobre un job permanentemente verde. El
comentario del propio script (`:77-79`) nombra esta enfermedad con precisión
—«un aviso que se aprende a ignorar es peor que no tenerlo (la lección de las
40 corridas rojas seguidas, auditoría 24)»— y el paso entra en ella por la
otra puerta.

Causa raíz probable: la señal no tiene umbral ni memoria; reporta la condición
vigente en vez del CAMBIO de condición.

---

### [MEDIO] `OP-31C-M2` — La prueba ancla la frase y deja suelto el centinela: 3 de 4 mutaciones del cableado sobreviven

`scripts/ci/deriva_sin_desplegar.test.ts:62-69`, `:81-99`

Escenario, con valores (los cuatro corridos y restaurados, tabla arriba):

- `RUTAS_QUE_CORREN = ['src/']` → **8/8 pasan.** Un commit que solo toca
  `supabase/migrations/` (una política RLS, que es el aislamiento por tenant)
  se vuelve invisible al detector y ninguna prueba lo nota. El bucle
  `for (const ruta of RUTAS_QUE_CORREN) expect(cmd).toContain(ruta)` (`:66`)
  es una tautología: mide la constante contra sí misma.
- `if: false` en el paso → **8/8 pasan.** El `describe` de cableado (`:84-85`)
  solo exige que la subcadena `deriva-sin-desplegar.mjs` aparezca en alguna
  parte del YAML; nunca mira la condición del paso.
- `"$version" "$version"` en vez de `origin/master` → **8/8 pasan**, y el
  detector pasa a decir «no hay deriva» siempre.

Consecuencia: quien toque `salud-produccion.yml` el mes que viene y apague el
paso se lleva un CI verde. La prueba certifica el constructor de la frase, no
el centinela — y OP-A6 era exactamente un hallazgo sobre el centinela.

Refutación intentada: la prueba `:88-93` («avisa sin tumbar el pulso») sí lee
el cuerpo del paso, pero solo para comprobar que no contiene el literal
`exit 1`; no comprueba nada de lo que el paso hace.

Causa raíz probable: el cableado se asevera por subcadena sobre el texto del
YAML y nunca por la condición ni por los argumentos del paso.

---

### [MEDIO] `OP-31C-M3` — «Producción corre todo el código de master» es falso para todo lo que se despliega fuera de `src/` y `supabase/`

`scripts/ci/deriva-sin-desplegar.mjs:26`, `:37`

Escenario, con valores: `.github/dependabot.yml:22-29` programa un PR de npm
**cada lunes**, agrupado (`produccion`, `minor`+`patch`), con prefijo
`chore(deps)`. Ese PR toca `package.json` y `package-lock.json` y nada más.
Se mergea el lunes sin `[deploy]` en el asunto — que es el flujo por defecto
del repo. En la siguiente corrida programada el detector imprime, literal:
`Producción corre todo el código de master: no hay deriva.` mientras
producción sigue corriendo el lockfile anterior. Lo mismo vale para
`next.config.ts`, `vercel.json` (las 11 cadencias de cron de `:9-54` y el
`ignoreCommand` de `:7`), `public/` y `vendor/xlsx-0.20.3.tgz` — todos se
despliegan y ninguno está en `RUTAS_QUE_CORREN`.

Consecuencia: es la regla «un rótulo tiene que ser verdad» aplicada al CI. Un
parche de CVE que nunca llegó a producción se reporta como ausencia de deriva,
y el único artefacto que alguien lee a las 3 a.m. afirma algo que no midió.

Refutación intentada, y esta sí se sostiene: excluir `normas/` es **correcto**
— `cuadre/cuota_diesel.ts:28-29` dice «Vercel no despliega `normas/`» y los
YAML llegan a producción compilados en
`src/lib/likida/normas/corpus_texto.ts`. `docs/` y los workflows, igual. El
hueco son los archivos de raíz que el comentario `:24-25` no nombra.

Causa raíz probable: la lista enumera dos directorios en vez de derivar «qué
se despliega».

---

### [MEDIO] `OP-31C-M4` — El paso «no bloquea» sí puede tumbar el pulso, y la prueba que lo garantiza mira la cadena equivocada

`scripts/ci/deriva-sin-desplegar.mjs:56-65` · `deriva_sin_desplegar.test.ts:88-93`

Escenario, con valores (medido):

```
$ node scripts/ci/deriva-sin-desplegar.mjs cfa00ab origin/no-existe
  stderr: "fatal: bad revision 'cfa00ab..origin/no-existe'"
$ echo $?
1
```

`commitsSinDesplegar` no envuelve `execSync`: cualquier error de git es una
excepción sin capturar y node sale 1. El shell por defecto de un `run:` en
Linux es `bash -e` y el workflow no declara `defaults.run.shell`, así que ese
1 **falla el paso** → job `failure` → `:228` (`if: failure()`) abre el issue
«Salud de producción en rojo» un día en que producción está perfectamente
sana. Peor: mientras ese issue esté abierto, `:236` (`Ya hay un issue abierto
(#N); no se duplica`) **suprime el issue de una caída de verdad**.

Consecuencia: un rojo falso es la enfermedad que diagnosticó la auditoría 24
(40 corridas rojas seguidas sin que nadie las atendiera), y aquí además tapa
la siguiente alarma real.

Severidad MEDIO y no ALTO a propósito: el disparador exige que el rango de git
no resuelva, y el `fetch-depth: 0` de `:51-53` normalmente crea `origin/master`
— **no conseguí reproducirlo bajo el checkout del propio workflow**, solo
aislado. Lo que sí está probado es que el contrato «solo avisa» no está
defendido por nada: la prueba `:88-93` lo asevera comprobando que el texto del
paso no lleva el literal `exit 1`, y el camino demostrado no pasa por ahí.

Causa raíz probable: el contrato «solo medir y avisar» vive en un comentario y
en una aserción de subcadena, no en el camino de salida del script.

---

## Sobre `OP-C1`: ¿se sostiene la razón por la que no se atacó?

La razón escrita fue: el endpoint es público y sin auth, publicar el nombre
del reloj es una decisión de producto/privacidad.

**Se sostiene para el cuerpo público, y NO se sostiene como explicación de por
qué el nombre tampoco aparece en los canales que sí son privados.** Lo que
verifiqué:

1. La decisión del endpoint está escrita y argumentada
   (`src/app/api/health/route.ts:45-49`, `:189-191`) y es coherente: cuerpo
   agregado, sin nombre de cron. Nada que objetar ahí.
2. **El nombre ya se emite, dos veces, por canales privados**:
   `route.ts:107-109` (`logger.error('health.cron_vencido', { crons, haceMin,
   sinLatido })`) y `:114-117` (`alertarOperador('cron.sin_latido', { error:
   'Sin latido: wa-outbox (hace 63 min)' })`). El dato existe y está nombrado.
3. **El canal autenticado del workflow existe y no lo usa**: `:228-238` escribe
   un issue con `GH_TOKEN` sobre un repositorio **privado** (la API de búsqueda
   rechaza `repo:javiercamarapp/cuadra` por permisos), y el repo ya guarda diez
   secretos (`VERCEL_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `AWS_*`…). El cuerpo
   de ese issue dice hoy «El cuerpo de `/api/health` … está en el log de la
   corrida» — y ese log tampoco trae el nombre.

Conclusión: «publicar el nombre es una decisión de producto» es verdadera
sobre `/api/health` y **falsa como razón para que el issue privado siga
teniendo cuatro líneas sin identificador**. Había un camino que no exigía esa
decisión. La causa raíz, en una línea: el detalle y el vigilante no comparten
ningún canal autenticado, aunque los dos extremos ya tienen credenciales.

---

## Reincidentes reverificados (código idéntico, `git diff 0f5ca48..HEAD`)

El diff de mi rubro desde que se escribió la 31 toca **tres archivos**, los
tres del arreglo. Todo lo demás está literalmente igual; lo abrí y lo confirmé
línea por línea:

| id | sev | archivo:línea | comprobado hoy |
|---|---|---|---|
| `OP-C1` | CRÍTICO | `api/health/route.ts:45-46`, `:189-202`; `salud-produccion.yml:81`, `:85`, `:238` | 6ª ronda. El cuerpo sigue siendo `{ok,status,checks:{db,crons},version,migracion,hora}`, sin un identificador de reloj. |
| `OP-A6` | ALTO | ver arriba | **atacado, no cerrado.** 7 → **14** corridas verdes sobre el arreglo fiscal sin publicar. |
| `OP-A5` | ALTO | `api/cron/wa-outbox/route.ts:33-49`, `:141`, `:176`; `observability/alerta.ts:129-144`, `:282` | Sin tocar. El aviso de fila `dead` sigue sin `s.id` y el piso de 1 h sigue colapsando N muertes en un correo. |
| `OP-A1` | ALTO | `api/cron/escalar/route.ts:415-424`; `admin/salud.ts:215` | Sin tocar. `configAusente:true` sigue estampándose sobre el latido de los seis motores y `salud.ts:215` sigue siendo la primera puerta. |
| `OP-A2` | ALTO | `docs/conocimiento/DEPLOY.md:32-36`, `:355-356` | Sin tocar. «no hay ningún log drain configurado» sigue ahí, y el propio runbook sigue listándolo como no cubierto. |
| `OP-A3` | ALTO | `api/health/route.ts:14-20`; `salud-produccion.yml:29-34` | 6ª ronda. Grep de monitores externos: **un solo resultado, prosa** (`route.ts:18`). **Cadencia medida hoy**: 7 corridas programadas en las 24 h anteriores a 14-sep 07:59Z, no 48. Huecos: **345**, 149, 135, 146, 154, 261, 344 min. El máximo va **256 → 310 → 345 min (5 h 45)**. |
| `OP-A4` | ALTO | `legal/config.ts:109`; `observability/arranque.ts:100`; `.env.example:61` | Sin tocar. `LEGAL_ENFORCE_DOCS !== 'false'` se activa por presencia; `SILENCIOSAS.filter((v) => !envPuesta(v.nombre))` solo sabe ver ausencias. |
| `OP-M1` | MEDIO | `DEPLOY.md:472-473`, `:494` | Sin tocar. El runbook sigue prometiendo `db` y `sentry` de primer nivel y un ejemplo de `curl` con `"sentry":"configurado"`; ninguno existe en el cuerpo real. |
| `OP-M2` | MEDIO | `salud-produccion.yml:71-85` vs `:109-129` | Sin tocar. El paso de salud sigue sin guarda de evento y sigue corriendo ANTES del que espera al despliegue. El paso nuevo de OP-A6 se insertó **después** de los dos: no altera el orden ni lo empeora. |
| `OP-M4` | MEDIO | `scripts/ci/staging-recovery.mjs:200`, `:214`, `:225` | Sin tocar. `:225` sigue imprimiendo «reconstruido hasta 0347» con el repo en **0356** (333 `.sql`), y `:214` sigue comparando contra `154` literal. |
| `OP-M5` | MEDIO | `.github/workflows/backup-storage.yml:3-12` | **Medido hoy**: `total_count` = **2**, ambas `failure`, ambas `schedule` (25 y 26-ago). **Cero `workflow_dispatch`, nunca.** Van **19 días** desde el último intento (13 → 17 → 18 → **19**). |
| `OP-M6` | MEDIO | `api/client-error/route.ts:40`, `:60`, `:68`; `observability/sentry.ts:360-371` | Sin tocar. `msg` del cuerpo público sigue entrando entero al `fingerprint`. |
| `OP-B1` | BAJO | `ci/limite-sin-orden-baseline.json` | Consistente hoy: `total` = 188, suma de `porArchivo` = **188**. Nadie bloqueado ahora mismo. |

---

## Lo que revisé y está bien

- **La lógica del detector nuevo es la correcta, y es lo mejor del arreglo.**
  `deriva-sin-desplegar.mjs:56-65` usa `%x1f` como separador (un asunto con
  `|` no lo rompe — probado en `:71-78`), acota el rango con `--` y devuelve
  `{sha, asunto}` limpios. La exclusión de `normas/` que temí que fuera un
  hueco fiscal **es correcta y está fundamentada** (`cuota_diesel.ts:28-29`:
  «Vercel no despliega `normas/`»; los YAML viajan compilados en
  `src/lib/likida/normas/corpus_texto.ts`, con
  `corpus_texto.test.ts:21-24` vigilando que el conjunto coincida).
- **Los dos guardas del paso nuevo cubren lo que dicen cubrir.**
  `salud-produccion.yml:177` (curl vacío o `version=local`) y `:178`
  (`git rev-parse --verify --quiet`) salen 0 en silencio y remiten «al paso
  anterior», y el paso anterior (`:150`, `:152`) efectivamente emite `::error::`
  y sale 1 en los dos casos, con la MISMA condición de evento
  (`github.event_name != 'push'`): no hay hueco entre los dos.
- **El paso nuevo corre con `if: always()`**, así que un `exit 1` del cotejo
  viejo (`:157`) no se lo lleva por delante — la lección de OP-A1/auditoría 22
  se aplicó correctamente al paso nuevo.
- **El cotejo viejo no se sustituyó, se sumó** (`:136-158` intacto), que es lo
  correcto: las dos preguntas —intención y estado— son distintas y hacen falta
  las dos.
- **`vercel.json` y `salud.ts` siguen alineados**: los 11 crons de
  `vercel.json:9-54` son los 11 de `salud.ts:28`, y `salud.test.ts` compara
  las dos listas.
- **La compuerta de despliegue sigue fail-closed**: `compuerta-deploy.mjs:104-106`,
  `:114-116`, `:174-194` y el cotejo por conjunto de `:125-135`. Sin cambios.
- **El logger y el saneador de Sentry siguen intactos** (`logger.ts:99-123`,
  `sentry.ts:249`, `:258`, `:164-180`) — sin diff en esta ventana.
- **Compuerta de mi rubro, corrida hoy**: 45 archivos, 638 pruebas, 5 saltadas
  (las de `proxy-local`/IPv6, quinta ronda sin fallar), 0 fallos;
  `npx tsc --noEmit -p .` exit 0. Árbol limpio tras las cuatro mutaciones
  (`git status --porcelain` solo muestra `docs/auditoria-31/progreso.md`, que
  no toqué y ya venía modificado).

---

## Lo que NO alcancé a revisar

Sin esto la nota es una mentira por omisión.

1. **INFRA — egress bloqueado, 6ª ronda.** No pegué ni una vez a
   `https://app.likida.ai/api/health`. **No sé qué valor tienen hoy
   `checks.crons` ni `migracion`**; solo que #644…#654 terminaron en `success`,
   lo que implica `status=ok` a esas horas. Todo dato de producción de este
   documento sale de la API de GitHub vía MCP.
2. **El paso nuevo nunca ha corrido en CI.** Vive en `claude/auditoria-31`
   (PR #462, abierto). Todo lo que afirmo de su comportamiento en un runner
   —incluido que `::warning::` no notifica y que `bash -e` propaga el exit 1
   de node— sale de leer el YAML y de ejecutar el script localmente, no de una
   corrida real.
3. **`ALERTA_EMAIL`, `ALERTA_WA`, `SENTRY_DSN`, `LEGAL_ENFORCE_DOCS`** — viven
   en el panel de Vercel. **6ª ronda sin poder responderlo.** Si están vacías,
   `alertarOperador(...)` es un no-op silencioso (`alerta.ts:37-39`) y
   `OP-C1`, `OP-A1` y `OP-A5` son peores de lo que están escritos, y esta nota
   debería ser 4.
4. **No ejecuté `staging-recovery.mjs`, `aplicar-migraciones-y-humos.sh` ni
   `scripts/seed.sh`** (credenciales de staging / `psql` que aquí no hay).
   Tampoco probé si los binarios de PostgreSQL 16 de la imagen permiten correr
   `supabase/tests/*.sql` — el `MAPA-continuacion.md` lo señala como no
   confirmado y sigue sin confirmar.
5. **`deploy-preview-promote.yml`** (532 líneas, 11 jobs): 5ª ronda sin leer el
   cuerpo de ningún paso.
6. **`recover-empty-staging.yml`, `e2e-navegador.yml`, `codeql.yml`,
   `auto-merge-rutina.yml`, `aviso-deploy-en-pr.yml`, `ci-postgres.yml`** — no
   los abrí, tampoco esta ronda.
7. **No corrí la compuerta completa** (`npm test`, `npm run lint`). Corrí la
   suite de mi rubro (45 archivos) y `tsc`; para lo demás me apoyo en la línea
   base de `MAPA-continuacion.md`.
8. **No verifiqué el `setup` en una máquina limpia** (`npm run setup` existe en
   `package.json`), que es la mitad DX del rubro. La 31 leyó `scripts/seed.sh`
   entero sin ejecutarlo; yo ni eso.
