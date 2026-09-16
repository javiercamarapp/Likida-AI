# Seguridad — auditoría 31, continuación 2

**Nota: 5/10** (antes 5). Razón del movimiento: **ninguna de las tres aplica, y
se queda en 5.** El número contable: de los **9** hallazgos abiertos que me
tocaban, **9 siguen abiertos** —los verifiqué uno por uno con el `archivo:línea`
reabierto hoy— y **0 se cerraron**. Lo único que se movió en mi rubro son
**93 líneas** de `scripts/ci/deriva-sin-desplegar.mjs` (nuevo en `30e5e14`) y
las **25** que `8c0e7df` le corrigió: eso **cierra** una clase de inyección
real y **deja abierta otra**, más una red de regresión que pasa en verde sobre
el código que vino a prohibir. Un artefacto nuevo que entra con un defecto y
sale con otro más chico no mueve la nota. El barrido de fondo se remidió y no
cambió: `npm audit` **0 sobre 751** (`{info:0,low:0,moderate:0,high:0,
critical:0}`, con y sin `--omit=dev`), suite del rubro **43 archivos /
698 pruebas, verde, 11.24 s** — exactamente las mismas cifras de la ronda
anterior, porque `git diff 0f5ca48..HEAD` no toca ni un archivo de
`src/lib/auth/`, `src/proxy.ts`, `src/app/api/webhook/` ni `supabase/`.

**Riesgo mayor del rubro, hoy:** el mismo, sin una línea encima — dos corridas
de QA solapadas en la misma instancia tibia se desinstalan el interceptor de
salida a Meta la una a la otra, y la que sigue viva manda WhatsApp de verdad a
`graph.facebook.com` con el token real. **Cuarta ronda abierto** (SEG-31-A1).

---

## Veredicto sobre `8c0e7df` y la superficie nueva de `scripts/ci/`

### ¿Cierra la inyección? **Sí, la de shell. Lo medí, no lo supuse.**

`scripts/ci/deriva-sin-desplegar.mjs:22` importa `execFileSync`; `:29` es
`execFileSync('git', args, { encoding:'utf8' })` **sin `shell`**; `:69-71`
construye el arreglo `['log','--format=%H%x1f%s', '<desplegado>..<ref>', '--',
'src/','supabase/']`. Reproduje el escenario del commit fuera del repo, con un
git real:

```
execFileSync('git', ['log','--format=%H%x1f%s','a;touch /tmp/gtest/SEMI..HEAD','--','src/'])
→ fatal: bad revision 'a;touch /tmp/gtest/SEMI..HEAD'
→ ls /tmp/gtest/SEMI: No such file or directory
```

El `;` llega entero como un argumento y git lo rechaza. La clase
`js/shell-command-injection-from-environment` está cerrada de verdad, y no solo
para CodeQL. Barrí además el resto de `scripts/` buscando la misma forma: los
únicos dos `execSync` con cadena que quedan son
`scripts/ci/compuerta-deploy.mjs:153` (`'git log -1 --pretty=%s'`) y
`scripts/ci/ultimo-deploy-en-asunto.mjs:16` (`"git log --format='%H%x1f%s'"`),
**las dos constantes literales, sin una sola interpolación**; cero `shell: true`
en todo `scripts/` y `src/`; los seis `spawnSync` de `scripts/ci/*.mjs` pasan
arreglos. No queda ninguna otra superficie de esta clase.

### ¿Qué queda abierto? **Tres cosas, y las tres son del mismo arreglo.**

1. **La inyección de ARGUMENTO sigue viva** (SEG-31C2-B1, abajo): quitar el
   shell no impide que el valor externo se coma la posición del primer
   argumento y se lea como una **opción** de `git log`. Lo demostré con
   `--output=`, que escribe un archivo.
2. **La red de regresión pasa sobre el código que prohíbe** (SEG-31C2-B2): sus
   dos asserts son `src.toContain('execFileSync')` —que se satisface con el
   **comentario** de la línea 61— y `not.toMatch(/execSync\(`/)`, que solo veta
   la plantilla. Ninguna de las tres pruebas de `commitsSinDesplegar` llega a
   ejecutar el `correrGit` real: las tres le inyectan un doble.
3. **La afirmación «no bloquea» del paso del workflow es un string, no una
   propiedad** (SEG-31C2-B3): `execFileSync` **lanza** si git sale distinto de
   0, el script no atrapa nada, y un throw pone el paso en rojo igual que un
   `exit 1`.

### Lo que el workflow que lo corre hace bien, y lo verifiqué

- **`GH_TOKEN` no entra al paso del detector.** `.github/workflows/
  salud-produccion.yml:172-179` no declara `env:`. El token solo aparece en
  `:197` (cadencia, `gh run list`, lectura), `:231` (abrir issue) y `:252`
  (cerrar issue). El código que toca el valor de red corre **sin** el token en
  su entorno.
- **El sha de `/api/health` sí es un valor de red, y está acotado dos veces
  antes de llegar a `git log`:** en origen, `src/app/api/health/route.ts:197`
  lo emite como `process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7) ?? 'local'` —7
  hex o el literal `local`, jamás algo que empiece por `-`—; y en el consumidor,
  `salud-produccion.yml:177-178` descarta vacío/`local` y exige
  `git rev-parse --verify --quiet "${version}^{commit}"`. Comprobé que ese
  `rev-parse` **sí** rechaza un valor con guion inicial (`--upload-pack=…`:
  exit 1) y uno con `;` (exit 1). Por eso B1 es BAJO y no MEDIO.
- **El issue no filtra nada de un cuerpo público.** `:238` compone el body con
  un `printf` de texto fijo más `$RUN_URL` (de `github.server_url`/`repository`/
  `run_id`). El cuerpo de `/api/health` **no** entra al issue; lo que se imprime
  en el log es `http/estado/crons/migracion` (`:81`), y `migracion` son números
  de migración, no datos de negocio (`route.ts:198-200`).
- **Sin `pull_request_target` en ningún workflow**, y las doce expresiones
  `${{ github.event.* }}` del árbol viajan por `env:` —nunca interpoladas dentro
  de un `run:`—, incluidas `ASUNTO` (`salud-produccion.yml:94`, `:112`),
  `PR_TITLE`/`PR_HEAD_REF` (`aviso-deploy-en-pr.yml:41-43`) y `RAMA`
  (`auto-merge-rutina.yml:48`). La inyección de expresión en workflow, que es
  el vecino natural de este hallazgo, no existe aquí.

---

## Hallazgos

### [BAJO] SEG-31C2-B1 — `8c0e7df` cierra la inyección de shell y deja abierta la de ARGUMENTO: el valor de red se lee como una opción de `git log` — NUEVO

`scripts/ci/deriva-sin-desplegar.mjs:68-71` (el arreglo de argumentos) ·
`:79-86` (el CLI que toma `process.argv[2]` sin validarlo) ·
`scripts/ci/deriva_sin_desplegar.test.ts:78-84` (la prueba que fija la clase
cerrada y no la abierta) · `.github/workflows/salud-produccion.yml:178` (el
único guardarraíl que hoy lo tapa)

**El mecanismo.** `commitsSinDesplegar` mete el valor externo en la **posición
del primer argumento** de `git log`, antes del `--`. Sin shell ya no hay
metacaracteres que interpretar, pero un argumento que empieza por `-` sigue
siendo una **opción** para git, y `git log` acepta las opciones de diff,
`--output=<archivo>` entre ellas.

**Escenario, con valores.** Ejecuté esto contra un repo git real:

```
execFileSync('git', ['log','--format=%H%x1f%s',
                     '--output=/tmp/gtest/PWNED..HEAD','--','src/'])
→ stdout: ""   (git se tragó la salida)
→ ls -la /tmp/gtest/ → -rw-r--r-- 45 PWNED..HEAD   ← archivo creado
```

Entra `desplegado = "--output=/tmp/gtest/PWNED"` → sale un archivo escrito en
disco y **cero commits reportados**, o sea el detector dice «no hay deriva»
mientras hace otra cosa. La misma entrada por el camino que el commit declara
como contaminado sería `GET https://app.likida.ai/api/health` devolviendo
`{"version":"--output=/tmp/x", …}`.

**Y la refutación, que me obliga a bajarlo a BAJO.** (a) La primitiva está
amarrada: el sufijo `..origin/master` se pega al valor, así que solo se pueden
crear archivos cuyo nombre **termine en `..origin/master`** — no se puede
apuntar a `.git/config`, a `~/.gitconfig` ni a ningún archivo que otro paso
vuelva a leer; el `--output` no da ejecución, y `git log` no acepta después del
subcomando las opciones que sí la darían (`-c`, `--exec-path`). (b) El único
llamador de hoy lo tapa: `salud-produccion.yml:178` corre
`git rev-parse --verify --quiet "${version}^{commit}"`, que **rechaza** un valor
con guion inicial (lo medí: exit 1). (c) El origen del valor emite 7 hex o
`local` (`health/route.ts:197`).

**Consecuencia.** No hay daño hoy. Lo que está roto es la premisa escrita: el
mensaje de `8c0e7df` dice textualmente «*el `git rev-parse --verify` del
workflow acota el riesgo real, pero el script no puede apoyarse en que su único
llamador de hoy lo valide*» — y para esta clase **se apoya exactamente en eso**.
El día que alguien llame `commitsSinDesplegar` desde otro sitio (un panel de
operabilidad, un segundo workflow, un `npm run`) sin repetir el `rev-parse`, el
hallazgo deja de ser teórico, y la prueba que existe para avisarlo no mira esta
clase.

**Causa raíz probable:** se trató «sin shell» como equivalente a «sin
inyección»; falta el `--end-of-options` (o una validación `/^[0-9a-f]{7,40}$/`)
que separe las opciones de los revisions.

---

### [BAJO] SEG-31C2-B2 — la prueba que debía impedir la vuelta del shell se satisface con un COMENTARIO y solo veta la plantilla — NUEVO

`scripts/ci/deriva_sin_desplegar.test.ts:86-92` ·
`scripts/ci/deriva-sin-desplegar.mjs:61` (el comentario que la satisface) y
`:29` (la única línea que de verdad importa)

**Los dos asserts, y por qué no cierran.** La prueba lee el fuente y afirma:

```
89:  expect(src).toContain('execFileSync');
91:  expect(src).not.toMatch(/execSync\(`/);
```

`grep -n 'execFileSync' deriva-sin-desplegar.mjs` devuelve **tres** líneas: `:22`
(el import), `:29` (el código) y **`:61`, que es prosa dentro del JSDoc**
(«`execFileSync` con ARGUMENTOS, nunca una plantilla para el shell»). El primer
assert pasa con la línea 61 sola.

**Escenario, con valores.** Alguien revierte `:29` a
`const correrGit = (a) => execSync('git log --format=%H%x1f%s ' + a.join(' '),
{ encoding:'utf8' })` —concatenación con comillas simples, sin plantilla— y deja
el JSDoc intacto. Entonces: `:89` pasa (el comentario de `:61` contiene la
cadena), `:91` pasa (no hay ``execSync(` ``), y **las otras tres pruebas de
`commitsSinDesplegar` ni se enteran**, porque `:65`, `:80` y `:95` le inyectan
su propio doble `ejecutar` y **ninguna ejecuta el `correrGit` real**. La suite
sale en verde con el shell de vuelta y con `a;rm -rf /` volviendo a ser dos
comandos — que es literalmente lo que `:81-82` dice estar impidiendo.

**Consecuencia.** Para quien mantenga esto: la garantía «esto ya no pasa por el
shell» está afirmada por una prueba que no puede distinguir el código de su
propio comentario. El modo de falla no es «la prueba se pone roja tarde», es
«la prueba nunca se pone roja».

**Causa raíz probable:** el invariante se fijó por **forma del texto fuente** en
vez de por **comportamiento observable**; el doble inyectable que hace testeable
a la función es justo lo que impide que alguna prueba toque el camino real.

---

### [BAJO] SEG-31C2-B3 — el paso «avisa, no bloquea» sí puede poner el pulso en rojo, y la prueba que lo niega afirma la ausencia de un string — NUEVO

`scripts/ci/deriva-sin-desplegar.mjs:86` (sin `try`/`catch`) y `:29`
(`execFileSync` lanza ante exit ≠ 0) ·
`.github/workflows/salud-produccion.yml:172-179` (el paso) y `:228-229`
(`if: failure()`, el que abre el issue) ·
`scripts/ci/deriva_sin_desplegar.test.ts:111-117` (la prueba)

**El mecanismo.** `execFileSync` **lanza** cuando git sale distinto de 0 (lo vi:
`Command failed: git log … fatal: bad revision`). `:86` la llama sin envolverla,
el módulo no tiene manejador, y una excepción no atrapada en Node sale con
código 1 → el step falla → el job falla → `:228` abre el issue
`salud-produccion` «Salud de producción en rojo».

**Escenario, con valores.** El paso pasa su guardia (`:177-178`: `version` no
vacío, no `local`, y `rev-parse` del sha resuelve) pero
`refs/remotes/origin/master` no existe en el workspace — lo que ocurre en cuanto
alguien toque el `actions/checkout` de `:51-53` (bajar `fetch-depth: 0`, añadir
`filter:`/`sparse-checkout`, o un `ref:` explícito). Entonces
`git log <sha>..origin/master -- src/ supabase/` → `fatal: bad revision` → throw
→ exit 1. Producción está **sana** y contestando 200, y el pulso queda rojo con
un issue abierto que dice «Salud de producción en rojo».

**Y la prueba no lo ve.** `:111-117` recorta el bloque del paso y afirma
`expect(bloque).not.toContain('exit 1')`. Es cierto y es irrelevante: el rojo no
viene de un `exit 1` escrito en el YAML, viene del código de salida del `node`.
La prueba fija la **redacción** del paso, no su **propiedad**.

**Consecuencia.** El aviso que se añadió para que «no desplegué» dejara de ser
un descubrimiento puede convertirse en el ruido que enseñe a ignorar la pestaña
— exactamente la lección de las 40 corridas rojas seguidas que el propio
comentario de `:87-90` cita como razón de no usar `exit 1`. La consecuencia
operativa es del auditor de operabilidad; la anoto porque el artefacto y su red
de pruebas son la superficie que se me asignó.

**Causa raíz probable:** un script pensado como «solo mide» que hereda la
semántica de fallo de `execFileSync` sin declararla; el invariante se fijó sobre
el YAML en vez de sobre el código de salida del proceso.

---

### [ALTO] SEG-31-A1 — dos corridas de QA solapadas se desinstalan el interceptor de salida a Meta — REINCIDENTE, 4ª ronda, cero commits encima

`src/lib/admin/qa-motor.ts:190` (`const original = globalThis.fetch`) y `:227`
(`return () => { globalThis.fetch = original; }`) · instalado en `:629` y
`:1038` · restaurado en `:909` y `:1605`

Reabierto y releído hoy: `:190` y `:227` están **idénticos**, sin comprobar que
el `globalThis.fetch` actual siga siendo el suyo, y sigue sin haber candado de
corrida viva en `api/admin/qa/lanzar/route.ts` ni en
`api/admin/qa/[id]/continuar/route.ts`. El escenario con valores está escrito
entero en `docs/auditoria-31/seguridad.md` (SEG-31-A1) y lo suscribo sin cambiar
una cifra: A instala en `t=0`, B en `t=5 s` con `originalB = interceptorA`, A
repone `realFetch` en `t=110 s` y B sigue viva ~190 s mandando
`POST https://graph.facebook.com/v21.0/<WHATSAPP_PHONE_NUMBER_ID>/messages` con
el token real y `to: "5215559900001"`, sin una sola fila `QA:` en `wa_outbox`.

---

### [MEDIO] SEG-31-M1 — `0280` revoca tres funciones solo `from public` y el grant implícito a `anon`/`authenticated` sigue vivo — REINCIDENTE, 2ª ronda

`supabase/migrations/0280_mutex_viaje_con_dueno_y_orden_por_hora_del_mensaje.sql:90`,
`:91`, `:115` contra `:158` del mismo archivo

Reverificado hoy leyendo el archivo: `:90` y `:91` siguen siendo
`revoke execute … from public`, `:115` igual para
`wa_orden_evento(jsonb, timestamptz)`, y `:158` sigue siendo el contraejemplo
del mismo archivo (`from public, anon, authenticated`). Comprobé además la
mitad del mecanismo que faltaba: `grep -rln wa_orden_evento supabase/migrations`
devuelve **`0280` y `0325`**, y la única definición es `0280:102` — o sea es
función **nueva**, no un `create or replace` sobre una existente, así que los
`alter default privileges` del bootstrap de Supabase **sí** le aplican y el
`revoke … from public` no los toca. Barrí también el árbol entero buscando el
otro extremo: `grep -i "grant .* to .*anon"` sobre las 333 migraciones devuelve
**0** — no hay ni un grant explícito a `anon`, que es lo que hace de este
implícito el único camino.

---

### [MEDIO] SEG-31-M2 — dos páginas autenticadas viven fuera del matcher del proxy, y la prueba que vigila esa frontera la fija en tres — REINCIDENTE, 2ª ronda

`src/proxy.ts:123` (`RUTAS_CON_SESION = ['/dashboard','/admin','/vendedor']`),
`:132`, `:170` · `src/proxy.test.ts:84-86` · `src/app/cuenta/page.tsx:16` ·
`src/app/mcp/autorizar/page.tsx:144`

Reabierto hoy línea por línea: `:123` sigue siendo la tupla de tres; `:170` (el
`no-store`) sigue **dentro** del `if` de `:132`; `cuenta/page.tsx:16` sigue
siendo `await requireSessionTenant('/cuenta', sp)` con el `supabaseAdmin()` de
`:18-19` **debajo**; `mcp/autorizar/page.tsx:144` sigue siendo
`await getSessionTenant()`. `ls src/app/cuenta src/app/mcp/autorizar` devuelve
**solo `page.tsx`** en las dos: ningún `layout.tsx` que pudiera ser la segunda
capa. Y `proxy.test.ts:84-86` sigue siendo la igualdad exacta contra los tres
literales, o sea que **agregar `/cuenta` a la lista rompe la suite**. Es el
único punto del árbol donde el ancla «dos capas independientes» no se cumple.

---

### [MEDIO] SEG-31-M3 — 13 salidas 200 con datos de un tenant, autenticadas por cookie, siguen sin `no-store` — REINCIDENTE, 3ª ronda

`src/app/api/v1/{liquidaciones,viajes,clientes,operadores,unidades}/route.ts` y
compañía · `next.config.ts:246-275` · `src/proxy.ts:177` (el matcher que excluye
`api`)

Sin cambios: `git diff 0f5ca48..HEAD --name-only` no toca ninguno de los trece
archivos ni `next.config.ts`. El escenario con valores sigue en
`docs/auditoria-30/seguridad.md` (SEG-30-M1), incluida la mitad que esa ronda se
refutó sola (por `Authorization: Bearer lk_live_…` no aplica, RFC 9111 §3.5;
vive por el camino de la cookie).

---

### [MEDIO] SEG-31-M4 — el aislamiento de la corrida entra con `enterWith` y las ocho pruebas que lo certifican usan `run` — REINCIDENTE, 4ª ronda

`src/lib/admin/qa-motor.ts:627` y `:1036`

Releídos hoy: `:627` es `contextoQa.enterWith({ corridaId: corrida.id })` y
`:1036` es `contextoQa.enterWith({ corridaId })`. Cero `contextoQa.run` en
producción; las ocho pruebas de `qa-motor.test.ts` siguen usando `run`.

---

### [BAJO] SEG-31-B1 — `capturarBitacora` tiene el mismo defecto LIFO y le corta la evidencia a la corrida viva — REINCIDENTE, 4ª ronda

`src/lib/admin/qa-motor.ts:150-166`, instalada en `:628` y `:1037`. Intacta
(`:628` y `:1037` los leí hoy, pegados a los `enterWith` de M4 y a los
`instalarInterceptorSalidaMeta` de A1).

---

### [BAJO] SEG-31-B2 — el preflight de la póliza es la única salida 200 de `export/` sin `no-store` — REINCIDENTE, 3ª ronda

`src/app/api/export/poliza/route.ts:410-422` contra `:442` y `:466`. Archivo no
tocado en la ventana.

---

### [BAJO] SEG-31-B3 — `0353` y `0356` dejan de declarar `SECURITY INVOKER` en `ejecutar_arco_cancelacion` — REINCIDENTE, 3ª ronda

`supabase/migrations/0353_…:231-233` y `0356_…:21-24`. Ninguna migración nueva
entró en la ventana (el prefijo más alto sigue siendo el mismo).

---

### [BAJO] SEG-31-B4 — la prueba de `/dashboard/suscripcion` afirma «renderiza para cualquier rol» tras doblar el único gate de vista — REINCIDENTE, 3ª ronda

`src/app/dashboard/suscripcion/page.test.tsx:36` y `:102`. Archivo no tocado.

---

## Descartados por escrito

**No hay CRÍTICO, y no hay camino sin autenticar a datos de un tenant.** El
barrido de seis superficies de la ronda anterior (156/156 tablas con RLS, 1/1
vista con `security_invoker`, 6/7 buckets privados con `avatares` público a
propósito y anclado a `auth.uid()`, 8/8 rutas de `/v1` con área explícita, 3/3
puertas de `/api/admin/*` con veredicto MFA) se sostiene sin reexaminar, porque
**`git diff 0f5ca48..HEAD` no toca ni un archivo de `supabase/` ni de
`src/lib/auth/`**. Lo remedí donde el diff sí tocó y donde el barrido tenía un
agujero de método (ver M1 arriba, `grant … to anon` = 0 ocurrencias).

**CVEs: no hay ninguno que descartar, porque no hay ninguno.** Corrí `npm audit`
yo mismo, las dos formas, sobre el `package-lock.json` de `claude/auditoria-31`:
`{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}` en las dos,
sobre **751** dependencias (215 prod, 415 dev, 161 optional, 43 peer). Mismas
751 y mismo cero que las rondas 29, 30 y 31. **No existe en este árbol un CVE
con o sin camino de explotación en esta app.** Lo dejo medido, no supuesto.

**Inyección de comando de workflow (`::warning::`) por el asunto de un commit.**
`deriva-sin-desplegar.mjs:91` imprime `::warning::${mensaje}` donde `mensaje`
lleva asuntos de commit (`resumirDeriva:43`), y un asunto es texto que alguien
escribe. **No es explotable:** el formato de git es `%s`, que por definición es
una sola línea, y `:91` además hace `.replace(/\n/g,'%0A')`; el parser de
comandos de Actions solo reconoce un `::` al **principio de línea**, y aquí no
hay forma de crear una segunda línea. Además el único camino a `master` para un
tercero pasa por `auto-merge-rutina.yml:36`, que exige
`head_repository.full_name == github.repository`.

**Robo del `GITHUB_TOKEN` persistido por `actions/checkout` desde el paso del
detector.** `actions/checkout` deja el token en `.git/config` por defecto, y el
paso corre código del repo sobre un valor de red. Lo seguí hasta el final y **no
llega**: la primitiva de SEG-31C2-B1 es escritura de archivo con nombre forzado
a terminar en `..origin/master` (no se puede apuntar a `.git/config`), `git log`
no admite después del subcomando ninguna opción con ejecución, y **ningún paso
posterior del job vuelve a ejecutar un script del repo** — los tres que siguen
(`:194`, `:228`, `:249`) son `gh` y shell inline.

**Fuga por el issue de `salud-produccion`.** El body de `:238` es un `printf` de
texto fijo con `$RUN_URL`; no interpola el cuerpo de `/api/health` ni la salida
de ningún paso. Lo abrí esperando encontrar el cuerpo pegado y no está.

**Desalojo del límite de tasa por inundación de llaves.** `ratelimit.ts:132`
(`if (buckets.size > MAX_KEYS) podar(now)`) con `MAX_KEYS = 5000` y `podar`
(`:145-155`) borrando primero lo caducado y luego **lo que caduca antes** — o
sea, una llave `login:` de ventana 5 min se desaloja antes que una `lead:` de
10 min. Parecía un desbloqueo dirigido y **no lo es en la práctica**: el Map es
solo el respaldo (`:5-12`), el camino normal es Redis por llave con TTL propio,
y llenar 5 000 cubetas exige 5 000 peticiones que a su vez consumen los límites
de sus propias rutas. No lo reporto.

**Falta de límite por CORREO en el login.** `login/page.tsx:91` limita solo por
IP (`10 / 5 min`), no por destinatario, así que un atacante con IPs rotadas
podría bombardear el buzón de un contralor con magic links. **Descartado**
porque GoTrue impone su propia cuota por correo y el código ya la contempla y la
trata como indistinguible del éxito (`:166-168`, `over_email_send_rate_limit`).
Lo que sí anoto sin subirlo a hallazgo: `dentroDelLimite` (`:79-81`) **reimplementa**
el parseo de `x-forwarded-for` en vez de importar `clientIp` de `ratelimit.ts:310`
— son dos copias de la misma decisión de confianza, y el día que se arregle la
de `ratelimit.ts` (ver abajo) esta se queda atrás.

**`master` sin protección de rama.** `.github/workflows/NOTAS-SEGURIDAD.md` §3
dice «hoy **NO EXISTE**, y es lo más urgente: cualquiera con acceso puede
empujar directo a master sin un solo check». **Ya no es cierto:**
`list_branches` sobre `javiercamarapp/cuadra` devuelve hoy
`{"name":"master","sha":"4047a50…","protected":true}` (las otras diez ramas
salen `protected:false`). La segunda capa de `master` existe. Lo que **no** pude
medir es *qué* exige esa protección: la API de `branches/master/protection`
necesita permiso de admin y este entorno no lo tiene, así que no sé si están los
dos checks que la nota pide (`Verificar …` y `Migraciones + aislamiento …`). Lo
dejo como positivo medido a medias y como aviso de que esa nota lleva
desactualizada lo suficiente para que nadie sepa cuál de las dos versiones creer.

---

## Lo que revisé y está bien

- **`scripts/ci/` completo, por la clase de `8c0e7df`.** Cero `shell: true` en
  `scripts/` y en `src/`; los dos únicos `execSync` con cadena que quedan
  (`compuerta-deploy.mjs:153`, `ultimo-deploy-en-asunto.mjs:16`) son literales
  constantes sin interpolación; los seis `spawnSync` de `scripts/ci/*.mjs`
  (`correr-verificaciones.mjs:75`, `lint-ratchet.mjs:16`,
  `production-candidate.mjs:171`, `supabase-preflight.mjs:147`,
  `staging-recovery.mjs:136`/`:202`, `prepare-build-env.mjs:106`) pasan arreglos.
- **Ningún secreto se imprime en un log de CI.** Barrí los `console.*` de
  `scripts/ci/*.mjs` que nombran token/password/secret/key/url: los nueve que
  salen imprimen o un estado (`production-candidate.mjs:122`, `:127`) o un host
  sin credencial (`supabase-preflight.mjs:143`, `new URL(url).hostname`) o la
  **ausencia** de una variable (`verificar-migraciones-aplicadas.mjs:90`).
- **`/api/health` no publica un dato de negocio.** `route.ts:192-202`: `ok`,
  `status`, `checks:{db,crons}`, `version` (7 hex del sha, público en GitHub),
  `migracion` (números de migración) y `hora`; el detalle de qué cron murió se
  queda en `logger.error` privado (`:107-109`, `:147-150`). Con `no-store` y
  `nosniff` en `:205` y con límite propio de 30/min por IP en `:58`.
- **`puertaCron` va primero en el cron que cambió en la ventana.**
  `src/app/api/cron/asistencia/route.ts:38-39`: la puerta es la primera
  sentencia del handler, antes del interruptor y antes de tocar la base — el
  cambio de `f4fde69` (el margen de reloj, `:75-76`) entró **debajo** de ella.
- **Autorización de los workflows.** `codeql.yml:41-53` (permisos mínimos por
  job, `pull_request` y no `pull_request_target`, acciones pineadas por sha),
  `salud-produccion.yml:36-42` (`contents:read`, `issues:write`, `actions:read`
  y nada más), `auto-merge-rutina.yml:36` (el guardia de fork). Las dos acciones
  de terceros que se usan están pineadas a sha de 40 caracteres
  (`actions/checkout@3d3c42e…`, `github/codeql-action@cdf488f…`).
- **La suite del rubro.** `npx vitest run src/lib/auth src/proxy.test.ts
  src/lib/ratelimit.test.ts src/lib/mcp src/app/api/webhook src/lib/worker` →
  **43 archivos, 698 pruebas, verde**, 11.24 s. Y
  `npx vitest run scripts/ci/deriva_sin_desplegar.test.ts` → **10/10 verde**
  (lo cual es precisamente el punto de SEG-31C2-B2).

---

## Lo que NO alcancé a revisar

- **El borde de Vercel con `x-forwarded-for`.** `ratelimit.ts:310-313` sigue
  tomando el PRIMER elemento, y `login/page.tsx:80` tiene su propia copia de la
  misma lectura. Si el borde APPEND-ea en vez de sobrescribir, **todo** límite
  por IP se evade rotando la cabecera (login, `/api/lead`, `/api/demo`,
  `mcp/oauth/*`, los seis `export-*`, `/api/health`). **Abierto sin verificar
  desde la 25, séptima ronda.** Se cierra con un
  `curl -H 'x-forwarded-for: 1.2.3.4' https://app.likida.ai/api/health` mirando
  qué llave se cuenta.
- **La prueba definitiva de SEG-31-M1.** Mi veredicto sigue siendo estático. Un
  `select has_function_privilege('anon','public.wa_orden_evento(jsonb,timestamptz)','execute');`
  contra la base real lo confirma o lo descarta; no hay base aquí.
  `supabase/verificaciones.sql` bloque 16 tampoco se ejecutó.
- **Qué checks exige de verdad la protección de `master`.** Hoy sé que
  `protected: true`; no sé si exige `Migraciones + aislamiento (Postgres
  efímero)`, que es el que importa. Se cierra con
  `gh api repos/:owner/:repo/branches/master/protection` desde una cuenta admin.
- **Si el camino de render de PÁGINA de Next 16.3.4 emite `no-store` por su
  cuenta.** Es la mitad no verificada de SEG-31-M2 y afecta a `/cuenta`,
  `/mcp/autorizar`, `/login` y `/pago/[token]`. Se cierra con
  `curl -i https://app.likida.ai/cuenta` con cookie válida.
- **El comportamiento REAL del caché de Vercel sobre las 13 rutas de
  SEG-31-M3.** Igual que en la 30 y la 31.
- **Si CodeQL vuelve a verde con `8c0e7df`.** No corre en este contenedor (sin
  GHAS ni red al servicio). El propio commit lo declara. Lo confirma CI, no yo —
  y la alerta que yo sí puedo afirmar que **no** desaparece es la de argumento
  (SEG-31C2-B1), que es de otra consulta.
- **`NEXT_PUBLIC_*` marcadas Sensitive en Vercel.** Abierto desde la 28; se
  resuelve con un `vercel env ls`.
- **La concurrencia real de dos corridas de QA en la MISMA instancia de
  Vercel.** SEG-31-A1 está verificado sobre el mecanismo, no sobre Vercel.
