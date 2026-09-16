# Operabilidad y DX — auditoría 31, continuación 2

**Nota: 4/10** (antes 5). **Baja por deuda que cobró factura, con la factura
fechada.** Ayer la pregunta que ordena el rubro —«si esto revienta de
madrugada, ¿qué tengo a la mañana siguiente?»— era una hipótesis. Anoche dejó
de serlo: **el 14-sep-2026 a las 22:50:41Z producción contestó `503
degraded` con `crons=degraded`** (corrida `#657`, la primera roja del pulso en
cinco días). Lo que existe hoy, doce horas después, para saber **cuál** cron
murió: nada. La línea que sí lo nombra (`health.cron_vencido`) vive en los
runtime logs de Vercel, que el propio runbook declara de retención corta y sin
drain; `cron_latido` es `id text primary key` —una fila por cron, sobrescrita—
y a las 01:03Z ya decía `ok`; y el issue `#470` que el workflow abrió solo
**se cerró solo** a las 01:03:33Z y hoy no aparece en ninguna lista de
abiertos. El rubro dice «si la respuesta es *nada*, la nota no pasa de 5». La
respuesta medida es *nada*, **y además las tres cifras empeoraron por tercera
ronda seguida** (14 → 18, 345 → 408 min, 19 → 20 días) y en mi rubro no se
atacó ni un hallazgo: `8c0e7df` es un arreglo de seguridad con comportamiento
idéntico. Cinco sería premiar la ausencia de movimiento en la ronda en que la
deuda se cobró.

**El riesgo mayor del rubro, hoy:** la única alarma que el repo sabe disparar
—rojo → issue → correo— **se autodestruye al recuperarse**: el episodio del
14-sep produjo un issue que vivió 2 h 12 min 49 s y se cerró solo, y la
anotación que sí llegó al correo son **2,566 caracteres de los que 2,330
(90.8 %) son la lista de 333 migraciones ya aplicadas** y ninguno es el nombre
del cron.

---

## Las tres cifras, recontadas hoy

| Cifra | Ayer | Hoy | Comando / fuente |
|---|---|---|---|
| Corridas **verdes** del pulso sobre el arreglo fiscal sin publicar (`5ce91b2`, `cuadre/desde_db.ts`) | 14 | **18** (de 19; `#657` salió roja) | `actions_list(list_workflow_runs, salud-produccion.yml, perPage:25)` → `#641…#659`, todas `head_sha` que contiene `5ce91b2`; conclusiones: 18 `success`, 1 `failure` |
| Hueco máximo del pulso (24 h) | 345 min | **408 min** (6 h 48), `#654` 14-sep 07:59:07Z → `#655` 14-sep 14:46:54Z | mismo listado, `created_at` de corridas `schedule`; **6 corridas en 24 h**, no 48. Serie: 344.1 · **407.8** · 293.3 · 190.3 · 132.9 · 312.8 min |
| Días sin **intento** de respaldo de Storage | 19 | **20** | `actions_list(list_workflow_runs, backup-storage.yml)` → `total_count: 2`, ambas `failure`, ambas `schedule`, la última `2026-08-26T04:03:50Z`. **Cero `workflow_dispatch`, nunca.** Hoy 15-sep |

Serie del hueco a lo largo de la auditoría: 256 → 310 → 345 → **408 min**.
Serie del respaldo: 13 → 17 → 18 → 19 → **20 días**.

Reproducción del conteo de la primera cifra, contra la historia real del clon
(el `origin/master` del checkout vino rancio en `7bcc319`, 8-sep, cuatro días
**atrás** de producción — ver `OP-31C2-B1`; por eso se ancla a `4047a50` a mano):

```
$ node scripts/ci/deriva-sin-desplegar.mjs cfa00ab 4047a50
::warning::Producción está atrás de master: 1 commit de src/ / supabase/ sin publicar.%0A
  · 5ce91b2 Auditoría 30 — 12 rubros, 122 hallazgos, 3 arreglos con prueba · global 6.0 → 5.2 (#460)%0A…
$ echo $?
0
```

---

## Veredicto sobre `8c0e7df`

**El comportamiento no cambió, la cobertura tampoco, y el candado nuevo se
abre con una comilla distinta.** Tres preguntas, tres respuestas medidas:

**1. ¿Sigue nombrando `5ce91b2` contra la historia real?** Sí, y la salida es
byte a byte la de ayer (bloque de arriba). `execFileSync('git', [...])` con
`'--format=%H%x1f%s'` sin comillas produce exactamente lo mismo que la
plantilla que el shell des-entrecomillaba. Cero regresión.

**2. ¿Cambió lo que imprime?** No. `resumirDeriva` no se tocó; el diff entero
vive en `commitsSinDesplegar` (`deriva-sin-desplegar.mjs:29`, `:68-71`).

**3. ¿La prueba sigue cubriéndolo?** El archivo pasó de 8 a 10 pruebas y la
cobertura del **cableado** no se movió ni un milímetro. Batería de mutación
corrida hoy, cada una restaurada (`git status --porcelain` limpio al final):

| # | Mutación | Pruebas | ¿La atrapa? |
|---|---|---|---|
| M1 | `resumirDeriva(commits) { commits = []; …}` | **2 fallan** | ✔ |
| M2 | `RUTAS_QUE_CORREN = ['src/']` (se cae `supabase/`) | 10/10 pasan | ✘ (reincidente) |
| M3 | el paso del workflow con `if: false` | 10/10 pasan | ✘ (reincidente) |
| M4 | `node … "$version" "$version"` (siempre «no hay deriva») | 10/10 pasan | ✘ (reincidente) |
| M5 | `import { execSync, execFileSync }` sin usar `execSync` | 10/10 pasan | — (no es el defecto) |
| **M5′** | **la inyección vuelve por CONCATENACIÓN** (`execSync('git log … ' + desplegado + '..' + ref + ' -- ' + …)`) cuando el llamador no inyecta doble | **10/10 pasan** | **✘** |
| M6 | se borra la llamada al script del YAML | 1 falla | ✔ |

M5′ es el punto: el candado que `8c0e7df` puso es
`expect(src).not.toMatch(/execSync\(`/)` (`deriva_sin_desplegar.test.ts:90-91`)
— una aserción sobre el **texto fuente**, anclada a una sola ortografía. Con el
`+` en lugar de la plantilla, las diez pruebas pasan **y el binario sigue
funcionando**: lo comprobé corriéndolo mutado contra la historia real y volvió
a imprimir el `::warning::` con `5ce91b2`. La prueba positiva
(`:78-84`, el ref `a;rm -rf /`) tampoco lo atrapa, porque **solo se ejercita
por el doble inyectado**, es decir por el camino que ningún llamador real usa.

Es el mismo patrón que `OP-31C-M2` describió ayer para el cableado: la prueba
afirma la forma del texto, no el comportamiento del centinela. (Que el arreglo
en sí sea correcto —y lo es— es asunto del rubro de seguridad, no del mío; lo
que califico aquí es que el guardarraíl de regresión no sostiene lo que dice
sostener.)

---

## Hallazgos

### [CRÍTICO] `OP-C1` — 7ª ronda, y anoche cobró factura: la única degradación real de producción en cinco días dejó una palabra, `degraded`, y ningún identificador (REINCIDENTE)

`.github/workflows/salud-produccion.yml:79`, `:81`, `:85`, `:238` ·
`src/app/api/health/route.ts:107-117`, `:192-202` ·
`supabase/migrations/0155_purgas_y_bucket_comprobantes.sql:432-439` ·
`docs/conocimiento/DEPLOY.md:29-36`

**Escenario, con valores reales (no hipotético: pasó).** Corrida `#657` del
pulso, `schedule`, 14-sep-2026 22:50:27Z sobre `head_sha 4047a50`. El paso
`/api/health está healthy` imprimió, literal:

```
http=503 estado=degraded crons=degraded migracion={"base":"0356","codigo":"0356","atras":0,"adelante":0,"aplicados":[…333 números…]}
```

Con `db` implícitamente `ok` (si no, `status` sería `fail`) y `atras=adelante=0`,
el **único** motivo posible es un cron: o `muertos` (`route.ts:104`, vencido o
sin latido) o `regresiones` (`:145`, resultado `fallo`/`parcial`). Las dos ramas
producen la misma palabra. Dónde quedó el nombre:

1. `logger.error('health.cron_vencido', { crons, haceMin, sinLatido })`
   (`route.ts:107-109`) y `logger.error('health.cron_estado_no_ok', { crons,
   estados })` (`:146-149`) **sí lo nombran** — y salen a los runtime logs de
   Vercel. `DEPLOY.md:33-36`: «la retención de esa vista es corta y **no hay
   ningún log drain configurado** — un fallo del sábado de madrugada puede no
   existir el lunes». El paso 1 del runbook es `vercel logs --since 1h`: doce
   horas tarde.
2. `cron_latido` es `id text primary key` con una sola fila por cron,
   sobrescrita en cada latido (`0155:432-439`). **No hay historial.** La
   corrida `#658` (15-sep 01:03:20Z) salió `success`: para cuando alguien mire
   `/admin/crons`, la tabla dice `ok` y no queda rastro de que a las 22:50 no
   lo decía.
3. El issue `#470` que `:228-238` abrió a las 22:50:44Z dice, entero: «El
   workflow **Salud de producción** falló: \<url\> … El cuerpo de
   `/api/health` (status, checks.crons, migracion) está en el log de la
   corrida». Remite al log — y el log dice `crons=degraded`.
4. `alertarOperador('cron.sin_latido' | 'cron.estado_no_ok', …)` sí lleva el
   nombre en el correo, **si `ALERTA_EMAIL` está puesta**. 7ª ronda sin poder
   verificarlo desde aquí (vive en el panel de Vercel). Sin ella,
   `alerta.ts:259-267` devuelve sin mandar nada (un `logger.info` una vez por
   instancia, y a los mismos logs que no persisten).

**Consecuencia para alguien real.** Si el cron degradado fue `facturar` o
`wa-outbox`, eso es el camino del dinero: comprobantes que no se timbraron y
PDFs que no salieron por WhatsApp durante una ventana que hoy solo se puede
acotar entre 19:40:11Z (verde) y 01:03:20Z (verde) — **hasta 5 h 23 min de
incertidumbre**. Con un cliente adentro, la pregunta del contralor por la
mañana («¿por qué mi liquidación del martes no llegó?») no tiene respuesta
reconstruible en ningún artefacto del repo.

Causa raíz, en una línea: el detalle y el vigilante no comparten ningún canal
durable — el que lo tiene (Vercel logs) no persiste y el que persiste (issue,
log de Actions, `cron_latido`) no lo recibe.

*Nota sobre la razón por la que no se atacó:* ayer concluí que «el cuerpo de
`/api/health` es público» se sostiene para el endpoint y **no** para el issue
privado. El episodio de anoche lo confirma sin margen: el issue `#470` lo
escribió `github-actions[bot]` con `GH_TOKEN` en un repo privado, y las cuatro
líneas que escribió no incluyen nada que el endpoint no publique ya.

---

### [ALTO] `OP-31C2-A1` — La única anotación que llega al correo son 2,566 caracteres de los que 2,330 (90.8 %) es la lista de migraciones que YA están aplicadas (NUEVO)

`.github/workflows/salud-produccion.yml:80`, `:81`, `:85`

**Escenario, con valores medidos.** `:80` lee `migracion` con
`JSON.stringify(j.migracion)` — el objeto **completo**, incluido
`aplicados`, que `route.ts:200` publica con los 333 números de migración
aplicados. `:85` lo interpola tal cual dentro del `::error::`, que es lo que
GitHub convierte en la anotación roja del job y en el asunto/preview del correo
al dueño del repo. Reconstruido carácter a carácter con los 333 números reales
del clon (`ls supabase/migrations/*.sql | wc -l` → 333, conjunto **idéntico**
al `aplicados` de producción):

```
largo de la anotación ::error:: = 2,566 caracteres
   de los cuales la lista `aplicados` = 2,330  (90.8 %)
   texto con información                =   236
```

Y los 236 caracteres útiles dicen `crons=degraded`, sin nombre. La información
que la lista aporta ya está resumida tres campos antes en `atras:0,adelante:0`.

**Consecuencia.** Lo que Javier ve en el teléfono a las 22:50 de un lunes es
una pared de números de migración, ninguno de los cuales tiene que ver con el
fallo, y tiene que abrir el navegador, entrar a la corrida y leer un log para
descubrir que el log tampoco lo dice. Es la enfermedad que el propio repo
diagnosticó en la auditoría 24 (avisos que se aprenden a ignorar), aplicada al
único aviso que sí importa.

Causa raíz: el paso imprime el campo entero de un contrato pensado para una
máquina en el sitio donde lo lee una persona.

---

### [ALTO] `OP-31C-A1` / `OP-A6` parte restante — El aviso de deriva sigue sin salir del log de una corrida verde (REINCIDENTE)

`.github/workflows/salud-produccion.yml:172-179` ·
`scripts/ci/deriva-sin-desplegar.mjs:87-92` · contraste: `:206`, `:211`, `:218`

Reverificado línea por línea: el paso sigue siendo `::warning::` sin `exit 1`
por diseño, sigue sin escribir en `$GITHUB_STEP_SUMMARY` (las tres únicas
escrituras del archivo son del paso de cadencia — confirmado con `grep` hoy),
`:228` sigue siendo `if: failure()` y no hay correo. **Cifra actualizada: 18
corridas verdes** (era 14) sobre `5ce91b2` sin publicar, es decir 18 avisos que
habrían muerto en el log.

Dato nuevo de esta ronda, y no ayuda: la corrida `#657` **sí** fue roja y **sí**
abrió issue — pero por el cron degradado, no por la deriva, y el cuerpo del
issue (`:238`) no menciona la deriva. El único episodio en que la bandeja se
enteró de algo fue el episodio en que el aviso de deriva seguía siendo
irrelevante para el texto que llegó.

Causa raíz: un único canal de notificación (rojo → correo + issue) y esta señal
está enrutada deliberadamente fuera de él sin darle otro.

---

### [MEDIO] `OP-31C2-M1` — El nombre del cron muerto viaja en un campo que la huella de deduplicación no mira: N crons distintos en la misma hora = un correo (NUEVO)

`src/app/api/health/route.ts:114-117` y `:150-153` ·
`src/lib/observability/alerta.ts:129-145`, `:281-282`

**Escenario, con valores.** `route.ts:114-117` llama:

```ts
await alertarOperador('cron.sin_latido', {
  error: `Sin latido: ${partes.join(', ')}`,   // «facturar (hace 63 min)»
  codigo: 'cron_sin_latido',
});
```

`huellaDeDetalle` (`alerta.ts:129-135`) construye la llave del piso de una hora
a partir de `SALIENTES`, que incluye **`cron`** exactamente para esto — y el
llamador no pasa `cron`. Pasa `error`, que no está en la lista, y `codigo`, que
es una constante. La huella resultante es siempre `codigo=cron_sin_latido`, así
que `reservarPiso` (`:282`) deja salir **un solo correo por hora** pase lo que
pase: si a las 22:50 muere `facturar` y a las 23:10 muere `wa-outbox`, el
segundo se descarta en silencio. Idéntico en `:150-153` con
`codigo: 'cron_estado_no_ok'`.

**Consecuencia.** El comentario de `alerta.ts:275-281` explica que el piso pasó
a incluir la huella **justo** porque «el SEGUNDO incidente de la hora se
descartaba en silencio» (auditoría 22, OP-A3). El mecanismo existe, funciona, y
estos dos llamadores lo desactivan sin querer — con lo cual una cascada (base
lenta → tres crons vencidos en veinte minutos) se lee como un cron.

Refutación intentada: el campo `error` sí lleva los nombres al **cuerpo** del
correo que sí sale, así que no se pierde información del primer incidente. Lo
que se pierde son los siguientes.

Causa raíz: el identificador viaja en prosa dentro de `error` en vez de en la
llave `cron` que la huella sabe leer.

---

### [MEDIO] `OP-31C2-M2` — `npm run setup` en una máquina limpia deja `/api/health` en 503 desde el minuto cero (NUEVO; es la mitad DX del rubro, que llevo dos rondas sin tocar)

`scripts/seed.sh:188-195` · `supabase/seed.sql` (202 líneas) ·
`src/lib/admin/salud.ts:27`, `:132-140`, `:246-262` ·
`src/app/api/health/route.ts:100-117`

**Escenario, con valores.** `npm run setup` = `npm install && npm run seed`
(`package.json:21-22`). `seed.sh` aplica las 333 migraciones y luego
`supabase/seed.sql`, que **no menciona `cron_latido` ni una vez** (`grep`:
cero resultados en sus 202 líneas). `detalleLatidos` (`salud.ts:246`) itera los
**11** ids de `CRONS` (`:27`), no las filas presentes; para cada id sin fila
`juzgarLatido` devuelve `sin_latido` **sin periodo de gracia** (`:133`). Por
tanto `route.ts:104`: `muertos.length === 11` → `cronCheck = 'degraded'` →
`status = 'degraded'` → **HTTP 503**, y de paso un `alertarOperador` con once
crons listados en cada visita.

**Consecuencia, doble.** (a) El desarrollador que sigue la última línea del
propio script («Siguiente: … corre `npm run dev`») ve rojo el primer día y
aprende a ignorarlo — el mismo mal que el repo lleva cinco auditorías
nombrando. (b) Y es la respuesta a la cuarta pregunta del rubro: **el incidente
del 14-sep no se puede reproducir localmente**, porque el estado por defecto de
todo clon limpio es indistinguible del estado degradado que se querría
reproducir; no hay un «verde» del que partir.

Refutación intentada y descartada: no lo salva ningún dato de prueba —
`seed.sql` siembra terminales, operadores, política, un viaje y tres
liquidaciones, y nada de observabilidad.

Causa raíz: el seed cubre el camino del dinero y no el de la observabilidad,
que es parte del estado mínimo para que el sistema se vea sano.

---

### [MEDIO] `OP-M5` — 20 días sin un solo intento de respaldo de Storage, y ningún artefacto del repo mide esa ausencia (REINCIDENTE, cifra actualizada)

`.github/workflows/backup-storage.yml:3-12` · `salud-produccion.yml:71-85` ·
`src/lib/admin/salud.ts:27`

Medido hoy: `total_count: 2`, ambas `failure`, ambas `schedule` (25 y 26-ago),
**cero `workflow_dispatch` en toda la vida del workflow**. El `schedule` se
retiró a propósito (`:3-11`, buena decisión: un fallo diario sobre el único
buzón entrena a ignorarlo) «hasta la primera corrida MANUAL verde». Esa corrida
nunca ocurrió y **van 20 días**.

Lo que agrego esta ronda: nada lo mide. El pulso vigila 11 crons de Vercel
(`salud.ts:27`) y el nivel de migración; el respaldo no es un cron de Vercel,
así que no existe un solo artefacto —ni el health, ni el pulso, ni el runbook—
que diga «el respaldo lleva N días sin correr». La ausencia solo se descubre
preguntándole a la API de Actions, que es lo que acabo de hacer.

Consecuencia: `comprobantes` es el bucket con las fotos de los tickets, o sea
la evidencia que el contralor cruza contra su PDF. Hoy no tiene copia y el
sistema no lo sabe. Sin clientes el daño es cero; con el primero adentro, es
irreversible.

Causa raíz: el respaldo se desactivó con una condición de reactivación que
ningún reloj vigila.

---

### [BAJO] `OP-31C2-B1` — «Producción corre todo el código de master: no hay deriva» es también lo que el detector imprime cuando su referencia va ATRÁS de producción (NUEVO)

`scripts/ci/deriva-sin-desplegar.mjs:39-41`, `:68-71` ·
`.github/workflows/salud-produccion.yml:174-179`

**Escenario, con valores medidos hoy en este mismo checkout.** El clon de esta
sesión trae `refs/remotes/origin/master` = `7bcc319` (8-sep), cuatro días
**atrás** del sha desplegado `cfa00ab` (10-sep):

```
$ git rev-parse origin/master        →  7bcc319…
$ node scripts/ci/deriva-sin-desplegar.mjs cfa00ab origin/master
Producción corre todo el código de master: no hay deriva.
$ echo $?  →  0
```

`git log A..B` es vacío en **dos** casos —B no tiene nada nuevo, o B es
antepasado de A— y `resumirDeriva(commits)` (`:39-41`) los colapsa en la misma
frase tranquilizadora. El guarda del workflow (`:178`) verifica que **`$version`
exista**, nunca que `origin/master` esté al día.

**Consecuencia.** Es la regla «un rótulo tiene que ser verdad» aplicada al
único artefacto que alguien lee a las 3 a.m.: la frase afirma un estado que la
consulta no midió.

**Refutación intentada, y acota la severidad a BAJO:** en CI el paso corre tras
`actions/checkout` con `fetch-depth: 0` (`:51-53`), que deja `origin/master`
fresco; no conseguí un camino reproducible dentro del workflow. El camino que
**sí** demostré es el de ejecutar el script a mano en un clon —que es
exactamente lo que hace un auditor o cualquiera que intente reproducir el aviso
localmente.

Causa raíz: la rama vacía no distingue «nada pendiente» de «mi referencia está
atrás».

---

## Reincidentes reverificados (código idéntico; `git diff 54d6f14..HEAD` de mi rubro toca 2 archivos, los dos del arreglo de seguridad)

| id | sev | archivo:línea | comprobado hoy |
|---|---|---|---|
| `OP-31C-M1` | MEDIO | `salud-produccion.yml:83` y `:172-179` | Sin tocar. Dos `::warning::` permanentes sobre un job que sale verde casi siempre. El estado «master por delante» lleva 19 corridas. |
| `OP-31C-M2` | MEDIO | `deriva_sin_desplegar.test.ts:63-70`, `:104-122` | **Reverificado con la batería de hoy: M2, M3 y M4 siguen pasando 10/10.** Las dos pruebas nuevas de `8c0e7df` no tocaron el cableado. |
| `OP-31C-M3` | MEDIO | `deriva-sin-desplegar.mjs:26` | Sin tocar. `RUTAS_QUE_CORREN = ['src/','supabase/']`: `package-lock.json`, `vercel.json`, `next.config.ts` y `public/` siguen fuera y sí se despliegan. |
| `OP-31C-M4` | MEDIO | `deriva-sin-desplegar.mjs:68-71` | **Reincidente y con la misma prueba de hoy:** `node … cfa00ab origin/no-existe` → excepción sin capturar, `exit 1`. Cambió la clase (`ExecFileSyncError` en vez de `ExecSyncError`) y nada más; `bash -e` sigue siendo el shell por defecto y `:228` sigue siendo `if: failure()`. |
| `OP-A5` | ALTO | `api/cron/wa-outbox/route.ts:33-49`, `:141`, `:176`; `alerta.ts:129-144`, `:282` | Sin tocar. |
| `OP-A1` | ALTO | `api/cron/escalar/route.ts:415-424`; `admin/salud.ts:215` | Sin tocar. |
| `OP-A2` | ALTO | `DEPLOY.md:33-36`, `:347-356` | Sin tocar — y **es la causa proximal de que OP-C1 cobrara factura anoche**: sin drain, `health.cron_vencido` del 14-sep ya no es alcanzable. |
| `OP-A3` | ALTO | `api/health/route.ts:14-20`; `salud-produccion.yml:29-34` | 7ª ronda. **Cadencia recontada: 6 corridas programadas en 24 h** (no 48), hueco máximo **408 min**. |
| `OP-A4` | ALTO | `legal/config.ts:109`; `observability/arranque.ts:100`; `.env.example:61` | Sin tocar. |
| `OP-M1` | MEDIO | `DEPLOY.md:472-473`, `:494` | Sin tocar. El runbook sigue prometiendo `sentry` en el cuerpo de `/api/health`; `route.ts:192-202` sigue sin tenerlo. |
| `OP-M2` | MEDIO | `salud-produccion.yml:71-85` vs `:109-129` | Sin tocar. |
| `OP-M4` | MEDIO | `scripts/ci/staging-recovery.mjs:200`, `:214`, `:225` | Sin tocar: sigue diciendo «reconstruido hasta 0347» con el repo en **0356**. |
| `OP-M6` | MEDIO | `api/client-error/route.ts:40`, `:60`, `:68` | Sin tocar. |

---

## Lo que revisé y está bien

- **El esquema de producción es exactamente el del repo, sin un solo hueco.**
  Lo medí por primera vez, y es la mejor noticia del rubro: el campo
  `aplicados` de `/api/health` capturado en la corrida `#657` trae **333**
  números, `ls supabase/migrations/*.sql` da **333**, y la diferencia de
  conjuntos en los dos sentidos es **vacía** (los saltos —0067-0069, 0156,
  0179, 0200, 0210-0212, 0220-0222, 0224, 0249, 0252-0257, 0277, 0293, 0295,
  0343— son números que nunca existieron como archivo, no migraciones sin
  aplicar). O sea: `npm run setup` construye el mismo esquema que corre en
  producción. Esa es la mitad de «¿se puede reproducir localmente?» que sí
  funciona.
- **El lazo de alarma que existe, funcionó, y funcionó rápido.** Anoche:
  fallo a las 22:50:41Z → issue abierto a las **22:50:44Z** (tres segundos) →
  cerrado solo a las 01:03:33Z al recuperarse, con comentario y enlace a la
  corrida verde. La guarda de `OP-C2/auditoría 27` (`:250`, `if: success() &&
  github.event_name != 'push'`) hizo su trabajo: quien cerró fue una corrida
  `schedule` que sí evaluó el invariante, no un push. Y `:236` evitó duplicar.
  El defecto no es el lazo: es lo que el lazo lleva dentro.
- **`seed.sh` es el artefacto mejor defendido que leí en dos rondas.** Dos
  guardas antes de escribir nada (`:127-158`): rehúsa un host `*.supabase.co`
  sin `--produccion` escrito a mano, y rehúsa si el tenant
  `11111111-…` existe y **no** se llama «Flota Demo» — porque el seed
  sobrescribe RFC, razón social y domicilio fiscal. Además comprueba `psql`
  antes de empezar (`:23-29`), detecta la pila local por `supabase status
  -o json` y rellena `.env.local` **solo** en ese caso (`:75-95`), y no
  reaplica migraciones sobre una base ya migrada (`:163-167`). Escribe
  `.env.local` desde `.env.example` sin inventar credenciales.
- **El detector nuevo sigue siendo lógicamente correcto** tras `8c0e7df`:
  separador `%x1f`, rango acotado con `--`, exclusión fundamentada de
  `normas/`, y `if: always()` para que un `exit 1` del cotejo viejo no se lo
  lleve por delante.
- **La compuerta de mi rubro, corrida hoy:** `npx tsc --noEmit -p .` exit 0;
  `npx vitest run scripts/ src/lib/observability src/app/api/health
  src/lib/admin/salud.test.ts src/app/api/client-error src/instrumentation.test.ts`
  → **43 archivos, 617 pasan, 5 saltadas, 0 fallos, 9.96 s**. Árbol limpio tras
  las siete mutaciones (`git status --porcelain` solo muestra
  `docs/auditoria-31/progreso.md`, que escribió el orquestador durante mi
  ronda y yo no toqué).

---

## Lo que NO alcancé a revisar

Sin esto la nota es una mentira por omisión.

1. **INFRA — egress bloqueado, 7ª ronda.** No pegué ni una vez a
   `https://app.likida.ai/api/health`. Lo que sé de producción sale de la API
   de GitHub vía MCP y del **log de la corrida `#657`**, que esta vez sí trajo
   el cuerpo completo del health del 14-sep 22:50:41Z — es el dato de
   producción más fresco que he tenido en todo el rubro, y aun así no dice cuál
   cron.
2. **`ALERTA_EMAIL`, `ALERTA_WA`, `SENTRY_DSN`, `LEGAL_ENFORCE_DOCS`** — viven
   en el panel de Vercel. **7ª ronda sin poder responderlo**, y anoche importó:
   si `ALERTA_EMAIL` está vacía, `alertarOperador` salió por `:261-267` sin
   mandar nada y el correo que nombraba el cron nunca existió; si
   `SENTRY_DSN` está vacía, `logger.ts:205` tampoco replicó nada. En ese
   escenario `OP-C1` es peor de lo que está escrito y esta nota debería ser 3.
3. **No ejecuté `npm run setup` de verdad.** `OP-31C2-M2` está derivado de leer
   `seed.sh`, `seed.sql`, `salud.ts` y `route.ts` y de comprobar que `seed.sql`
   no menciona `cron_latido`; no levanté Docker ni la pila local. Tampoco corrí
   `staging-recovery.mjs`, `aplicar-migraciones-y-humos.sh` ni
   `supabase/tests/*.sql` (el `progreso.md` anota que hay binarios de
   PostgreSQL 16 y `docker` en la imagen — sigue sin confirmarse si sirven).
4. **El paso de deriva nunca ha corrido en CI.** Vive en `claude/auditoria-31`
   (PR #462, abierto). Todo lo que afirmo de su comportamiento en un runner
   sale de leer el YAML y ejecutar el script localmente.
5. **`deploy-preview-promote.yml`** (532 líneas, 11 jobs): 6ª ronda sin leer el
   cuerpo de ningún paso. Tampoco abrí `recover-empty-staging.yml`,
   `e2e-navegador.yml`, `codeql.yml`, `auto-merge-rutina.yml`,
   `aviso-deploy-en-pr.yml`, `ci-postgres.yml` ni `rollback-production.yml`.
6. **No corrí la compuerta completa** (`npm test`, `npm run lint`). Corrí la
   suite de mi rubro (43 archivos) y `tsc`; para lo demás me apoyo en la línea
   base que `8c0e7df` dejó escrita (986 archivos / 12,960 pruebas).
7. **No leí `.env.example` entero** (668 líneas). Solo crucé lo que `seed.sh`
   copia y las variables que `OP-A4` ya nombraba.
8. **Todo lo de este documento está anclado a `939c111` (HEAD al cerrar).** Al
   terminar apareció trabajo EN VUELO de otro auditor de esta misma ronda, sin
   commitear: `git diff --stat` sobre `salud-produccion.yml` (+43),
   `deriva-sin-desplegar.mjs` (+42) y `deriva_sin_desplegar.test.ts` (+103,
   de 10 a 17 pruebas). **No lo leí ni lo califico**: puede cerrar
   `OP-31C-A1`, `OP-31C-M2` o el M5′ de arriba, o no, y decirlo sin medirlo
   sería exactamente lo que este rubro reprocha. Quien recalifique debe
   reverificar la batería de mutación contra el árbol final, no contra el mío.
