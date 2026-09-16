# Operabilidad y DX — auditoría 31

**Nota: 5/10** (antes 7). Razón del movimiento: **deuda que cobró factura**.
La nota 7 de la ronda 30 se sostuvo sobre UNA medición escrita con esas
palabras — «la cobertura efectiva de publicación se midió en 100 % (7 commits
con `[deploy]`)». **Esa medición se invirtió a 0 % dentro de una sola ventana,
y lo que quedó sin publicar no es prosa: son dos archivos de producción del
camino del dinero** (`cuadre/desde_db.ts`, `sat_descarga/ciclo.ts`), los
arreglos que la propia ronda 30 commiteó como ARQ-C2 y AG-C1. El pulso ha
salido **verde en las siete corridas posteriores** al merge. Se suma un ALTO
nuevo sobre el único canal de alerta del outbox de WhatsApp. El código no
cambió (la ventana son dos dotfiles de latido); lo que cambió es que el
mecanismo que la 30 degradó a MEDIO por falta de consecuencias ya se tragó un
arreglo fiscal.

**El riesgo mayor del rubro, hoy:** el único detector externo de producción
mide «¿aterrizó lo último que alguien pidió publicar?», no «¿producción está al
día?» — así que hoy, 13-sep, reporta verde con el arreglo del cubo del 15 %
($4,700 de cupo regalado por ticket duplicado) parado en `master` desde el
12-sep, y nada en ningún artefacto lo dice.

---

## Estado de publicación (medido hoy, 13-sep-2026)

Fuente: API de GitHub vía MCP y `git log` local. **No hay red saliente en este
contenedor: no pegué ni una vez a `app.likida.ai/api/health`.**

`node scripts/ci/ultimo-deploy-en-asunto.mjs` → **`cfa00ab`** (10-sep). Los
cuatro commits posteriores, ninguno con la bandera en el asunto:

```
4047a50  chore(normas): latido cuota-diesel — INFRA, egress bloqueado (#459)
ecfdf42  chore(normas): latido de vigilancia — INFRA (egreso bloqueado) (#461)
5ce91b2  Auditoría 30 — 12 rubros, 122 hallazgos, 3 arreglos con prueba (#460)   ← toca src/
4e36c82  chore(normas): latido de vigilancia — 10-sep-2026 (#458)
```

`git diff --stat 4e36c82..5ce91b2 -- src/` — **5 archivos, 2 de producción**:

```
src/lib/likida/cuadre/desde_db.ts          | 19 ++++++++-     ← ARQ-C2 (cubo del 15 %)
src/lib/likida/sat_descarga/ciclo.ts       | 22 +++++++---     ← AG-C1 (consolidado ECC)
```

**Cobertura efectiva de publicación de esta ventana: 0 %** (la 30 midió 100 %).

Corridas de `salud-produccion.yml` posteriores al merge (`#641`…`#647`,
12-sep 19:12Z → 13-sep 06:23Z): **siete, todas `conclusion: success`.**

Cadencia real del pulso, contada de la API sobre las corridas `schedule` de las
últimas 24 h (13-sep 06:23Z hacia atrás): **8 corridas, no 48.** Huecos
consecutivos, en minutos: 310, 127, 121, 134, 134, 177, 204, 256. El máximo de
hoy, **310 min (5 h 10 min)**, es peor que el de la ronda 30 (256 min).

---

## Hallazgos

### [CRÍTICO] `OP-C1` — `crons=degraded` sigue sin decir cuál (REINCIDENTE, 5ª ronda; cero líneas cambiadas)

`src/app/api/health/route.ts:45-46`, `:107-117`, `:189-191`, `:192-202` ·
`.github/workflows/salud-produccion.yml:81`, `:85`, `:217`

Verificado línea por línea hoy. `route.ts:45-46` sigue declarando que no se
publica nombre de cron; `:189-191` lo repite («el detalle de qué cron fue
vencido queda en el log privado»); `:192-202` arma
`{ ok, status, checks:{db,crons}, version, migracion, hora }` — sin un solo
identificador de reloj. `salud-produccion.yml:81` sigue imprimiendo
`echo "http=$status estado=$estado crons=$crons …"`, `:85` sigue siendo el
único `::error::`, y `:217` sigue abriendo el mismo issue de cuatro líneas que
remite a «el cuerpo de `/api/health` … está en el log de la corrida».

Escenario (el de la 30, sin cambios y con los crons del dinero): `wa-outbox`
(cadencia 60 s, `salud.ts:35`) reporta `fallo` a las 03:12. El endpoint contesta
`crons=degraded`, 503; el workflow imprime esa palabra y abre el issue. El
nombre `wa-outbox` existe en `route.ts:107-109` y `:151-154` pero vive en
Sentry y en `ALERTA_EMAIL`, dos canales no verificables desde aquí (5ª ronda).
La ventana de detección medida hoy es de hasta 5 h 10 min (ver `OP-A3`).

Consecuencia: una liquidación se cierra, el PDF se genera, el WhatsApp no sale,
y lo que hay por la mañana es un issue de cuatro líneas y una palabra en un log.
El contralor descubre el fallo antes que el operador.

Causa raíz probable: el endpoint fija su cardinalidad por privacidad (público,
sin auth) y el workflow hereda esa decisión sin tener un canal autenticado
propio que sí pueda nombrar el reloj.

---

### [ALTO] `OP-A6` — El invariante del cotejo se tragó dos archivos de producción del camino del dinero, y el pulso salió verde siete veces (ESCALADO desde `OP-M3` MEDIO de la 30 / `OP-A1` de la 29)

`.github/workflows/salud-produccion.yml:136-158` ·
`scripts/ci/ultimo-deploy-en-asunto.mjs` · `scripts/ci/compuerta-deploy.mjs:79-84`

La 30 dejó esto en MEDIO con una razón explícita y honesta: «esta ventana el
hueco son 32 líneas de un archivo de latido». Esa razón ya no aplica.

**Escenario, ya ocurrido, con valores.** El 12-sep 19:12Z se mergea `5ce91b2`,
cuyo asunto es `Auditoría 30 — 12 rubros, 122 hallazgos, 3 arreglos con prueba ·
global 6.0 → 5.2 (#460)` — sin `[deploy]`. Ese commit trae
`src/lib/likida/cuadre/desde_db.ts` (ARQ-C2: la resta del cubo del 15 % dedupa
copias; sin el arreglo, con acumulado $100,000 y un ticket de diésel en efectivo
de $4,700 fotografiado dos veces, el previo sale $90,600 en vez de $95,300) y
`src/lib/likida/sat_descarga/ciclo.ts` (AG-C1). El paso `:136-158` corre
`ultimo-deploy-en-asunto.mjs`, obtiene `cfa00ab`, comprueba
`git merge-base --is-ancestor cfa00ab <desplegado>` → **verdadero** → imprime
«Producción corre el último [deploy] (cfa00ab) o uno posterior» y sale **0**.
Las corridas `#641` a `#647` están todas en `success`.

El propio `salud-produccion.yml:1-8` dice que este paso existe contra «la deriva
silenciosa del `ignoreCommand`». Hoy la deriva son dos archivos del camino
fiscal y el detector no la ve, porque no puede: pregunta por la intención
declarada, no por el estado.

Consecuencia: producción firma PDFs con un cupo del 15 % que el repo ya sabe
mal calculado, y el único artefacto que un operador mira a las 3 a.m. dice que
todo está al día. «No quise publicar» y «olvidé publicar» siguen siendo
indistinguibles por construcción — pero ahora con la prueba de que la disciplina
humana que la 30 elogió duró exactamente una ventana.

Causa raíz probable: el invariante está mal elegido; la intención de publicar
vive como una subcadena en prosa libre en vez de como estado comprobable.

---

### [ALTO] `OP-A5` — El aviso de que un mensaje del outbox MURIÓ no dice cuál, y el piso de una hora colapsa N muertes en un solo correo (NUEVO)

`src/app/api/cron/wa-outbox/route.ts:33-49`, `:141`, `:176` ·
`src/lib/observability/alerta.ts:129-144`, `:282`

`finalizarYAvisarSiMurio` es el único aviso que existe cuando una fila del
outbox agota sus 8 reintentos (0180) y queda `dead` — nadie la va a volver a
intentar. Lo que manda es:

```ts
:43  await alertarOperador('cron.wa_outbox', {
:44    error: motivo,
:45    codigo: 'salida_muerta',
:46  });
```

`s` está en el ámbito y trae `s.id` (uuid, `0180_…sql:68`), pero **no entra al
detalle en ninguno de los dos caminos que importan**: `:141` pasa
`` `${codigo}HTTP ${r.status}: ${body.slice(0,300)}` `` y `:176` pasa
`e.message`. Solo el camino sin wamid (`:165`, `` `sin_wamid:${s.id}` ``)
lleva identidad, por accidente de su literal.

**Escenario, con valores.** 03:12. Doce liquidaciones cerradas esa hora; el
token de plantilla de Meta expira y los doce POST devuelven `400` con
`{"error":{"code":131047,…,"fbtrace_id":"A1b2C3"}}`. Cada fila muere y llama
`alertarOperador`. En `alerta.ts:281` se computa
`huellaDeDetalle({error, codigo:'salida_muerta'})`: `SALIENTES` recoge
`codigo=salida_muerta`; el barrido de UUID sobre los valores no encuentra
ninguno (`fbtrace_id` no tiene forma de UUID). Huella idéntica para las doce →
`:282` reserva `cron.wa_outbox|codigo=salida_muerta` con `PISO_ALERTA_MS`
(1 h) → **sale UN correo y se descartan once en silencio**. El que sale dice
«Un mensaje de WhatsApp agotó sus reintentos y no se va a volver a enviar:
terminal:HTTP 400: …» y no nombra la fila, el viaje, el destinatario ni el
tenant. Y `cron.wa_outbox` no casa `EVENTOS_DE_DINERO` (`alerta.ts:191`), así
que tampoco suena por WhatsApp.

En el código no queda otra huella: el camino `!r.ok` de `:135-142` **no emite
ninguna línea de `logger`** con `s.id` (a diferencia de `:152` y `:160`, que sí
la emiten en sus casos). El dato existe en `wa_outbox.ultimo_error`, pero eso
exige saber ya que hay que ir a mirar.

Consecuencia: es exactamente el ancla del rubro puesta del revés — el fallo del
camino del dinero genera alerta, pero **sin identificador suficiente para
reconstruirlo**, y solo la primera de la hora. El contralor pregunta por qué su
chofer no recibió la liquidación y la respuesta disponible es «murió un mensaje,
en algún momento de esa hora».

Refutación intentada: la ronda 24 ya arregló este patrón exacto para `timbre.*`
(«doce viajes que fallan al timbrar en la misma hora = un correo») añadiendo los
UUID del texto a la huella. La defensa existe; este llamador simplemente no le
da un UUID que morder. Las pruebas lo confirman: `muerta_avisa.test.ts` asserta
nueve veces `objectContaining({ codigo: 'salida_muerta' })` y **ninguna** exige
un identificador de fila.

Causa raíz probable: la identidad de la fila se pasa a `finalizarSalidaWhatsApp`
(que la necesita) pero no al `alertarOperador` que va al lado, y la huella de
deduplicación se alimenta solo de lo que el llamador decidió escribir.

---

### [ALTO] `OP-A1` — `configAusente: true` se estampa sobre el latido ENTERO de `escalar`, y `esHuecoDeConfiguracion` lo lee antes que nada (REINCIDENTE; código idéntico)

`src/app/api/cron/escalar/route.ts:415-424` · `src/lib/admin/salud.ts:211-219` ·
`src/app/api/health/route.ts:127-132`, `:185-188`

Verificado hoy: `:415-416` siguen siendo
`const calcomSinConfigurar = …?.configured === false;` /
`const configAusente = !huboFallo && calcomSinConfigurar;`, y `:419` sigue
colapsando `cortados > 0 || corteDuro || configAusente` en `'parcial'` con el
detalle de `:423` marcando `configAusente: true` sobre el latido de los SEIS
motores. `salud.ts:215` sigue siendo la puerta que se cierra primero:

```ts
if (typeof detalle.configAusente === 'boolean') return detalle.configAusente;
```

Escenario, con valores: ningún motor lanza (`huboFallo=false`), el reloj blando
corta 5 comprobaciones y vencimientos (`cortados=5`, `corteDuro=false`), Cal.com
sigue sin llave. `detalle = {cortesSeguidos:1, cortados:5, configAusente:true,
motivo:'Cal.com no configurado: …'}` → `health/route.ts:127` clasifica `escalar`
como hueco, `regresiones` queda vacío, `:132` fija `cronCheck='config_ausente'`,
`:185-188` deja `status='ok'` → **HTTP 200** → `salud-produccion.yml:82-84`
imprime un `::warning::` y el job pasa verde. Con `CALCOM_API_KEY` puesta, el
MISMO hecho operativo da `degraded` → 503 → issue.

Consecuencia: cinco flotas sin su corte de reloj salen verdes o rojas según esté
puesta la variable de una integración de calendario que no tiene nada que ver.
Y un `::warning::` que dispara el 100 % de las corridas dejó de ser un aviso.

Causa raíz probable: la señal «hueco declarado» se modeló como un booleano del
CRON cuando el hecho que describe es de un MOTOR; con un bit para seis motores
gana el más benigno.

---

### [ALTO] `OP-A2` — No hay log drain, y el runbook lo dice él mismo (REINCIDENTE)

`docs/conocimiento/DEPLOY.md:32-36` · `:355-356`

Textual, verificado hoy:

> «Ojo: **la retención de esa vista es corta y no hay ningún log drain
> configurado** — un fallo del sábado de madrugada puede no existir el lunes.»

Y en § «Lo que este runbook NO cubre» (`:355-356`): «**La retención exacta de
los runtime logs** en este plan, ni si hace falta un log drain antes del demo».
Repetí el barrido (`log.?drain|logtail|axiom|datadog|betterstack|papertrail`
sobre `src/ .github/ docs/conocimiento/ vercel.json`): **dos resultados, las dos
son esas frases de prosa.** Ni una variable, ni un secreto, ni un paso.

Escenario: sábado 03:12, `wa-outbox` falla con la liquidación `a3f21c9e4b70`.
`logger.ts:99-107` construye la huella perfectamente y `DEPLOY.md:38-49` explica
cómo cruzarla contra Postgres. El lunes 09:00 `vercel logs --since 1h` ya no la
alcanza y `--since 48h` no está garantizado por el plan. El único destino
durable es Sentry, cuyo DSN no es verificable desde aquí.

Consecuencia: el identificador existe y es bueno; el sitio donde vivía puede
haberse vaciado. Es el techo duro de esta nota.

Causa raíz probable: la persistencia del log se delegó al plan del proveedor, y
el plan del proveedor no es un requisito escrito en ningún sitio.

---

### [ALTO] `OP-A3` — Sigue sin monitor externo, y hoy el hueco medido subió de 256 a 310 min (REINCIDENTE, 5ª ronda)

`src/app/api/health/route.ts:14-20` · `.github/workflows/salud-produccion.yml:29-34`,
`:173-201`

Repetí el grep de la 27/28/29/30
(`uptimerobot|betterstack|cronitor|healthchecks\.io|pingdom|cron-job\.org|dead.?man`):
**el único resultado sigue siendo prosa**, la cabecera de `route.ts`.

Medido hoy contando las corridas `schedule` de la API en las últimas 24 h
(13-sep 06:23Z hacia atrás): **8 corridas, no 48.** Huecos consecutivos en
minutos: **310**, 127, 121, 134, 134, 177, 204, 256. El máximo de la 30 fue 256;
hoy es **310 min = 5 h 10 min**.

Escenario: `wa-outbox` muere a las 01:20Z. La siguiente corrida programada del
pulso es a las 06:23Z. **Cinco horas y tres minutos** en que el único detector
externo no existe, con la bandeja de WhatsApp parada. Y la propia medición sale
de `gh run list` — el mismo plano de control que moriría con Actions.

Consecuencia: un pulso *degradado* es visible desde dentro; un pulso *muerto*
sigue viéndose idéntico a «todo verde».

Causa raíz probable: el vigilante y lo vigilado comparten plano de control.

---

### [ALTO] `OP-A4` — `LEGAL_ENFORCE_DOCS` se activa por PRESENCIA y el vigilante solo sabe mirar AUSENCIAS (REINCIDENTE; código idéntico)

`src/lib/legal/config.ts:104-110` · `src/lib/observability/arranque.ts:44-78`,
`:100` · `.env.example:61`

`git diff 7bcc319..HEAD -- src/lib/legal/config.ts src/lib/observability/` está
vacío. La línea sigue siendo:

```ts
:109  const exigirDocs = process.env.LEGAL_ENFORCE_DOCS !== 'false';
```

y el modelo de vigilancia sigue siendo `arranque.ts:100`,
`SILENCIOSAS.filter((v) => !envPuesta(v.nombre))` — una lista de variables que
**faltan**. Una variable cuya **presencia con el valor `'false'`** retira cuatro
documentos legales de la lista bloqueante no cabe ahí por construcción.
`estadoLegalProduccion()` (`config.ts:98-113`) calcula exactamente el dato que
haría falta y **ninguna ruta de salud lo llama**: el cuerpo de `route.ts:192-202`
no tiene un solo campo legal.

Consecuencia: «el DPA existe y está firmado» y «alguien apagó la exigencia una
noche para desatascar un build» no se distinguen desde ningún artefacto
observable. No afirmo que la válvula esté puesta: afirmo que **nadie puede
saberlo**, y en esta ronda tampoco (sin red, sin panel de Vercel).

Causa raíz probable: `SILENCIOSAS` modela «variable que falta» y ésta es
«variable que sobra»; una válvula documentada como temporal no tiene caducidad
ni superficie de observación.

---

### [MEDIO] `OP-M1` — `DEPLOY.md` documenta un `/api/health` que no existe (REINCIDENTE)

`docs/conocimiento/DEPLOY.md:472-473`, `:494` · `src/app/api/health/route.ts:192-202`

Textual, verificado hoy:

```
:473  … `/api/health` devuelve `version` …, `db` y `sentry`, …
:494  curl -s https://app.likida.ai/api/health   # {"ok":true,"db":"ok","sentry":"configurado","version":"553bee7",...}
```

El cuerpo que arma `route.ts:192-202` es
`{ ok, status, checks:{db,crons}, version, migracion, hora }`. **No hay campo
`sentry`** en ninguna parte del archivo, y `db` no es de primer nivel: vive
dentro de `checks`.

Escenario: el punto 3 del mismo runbook (`:51-54`) instruye «`startup.observabilidad`
— `{"sentry":false}` … significa que **nadie va a recibir el siguiente fallo**.
Es lo primero que hay que arreglar si aparece». A las 3 a.m., sin panel de
Vercel, el operador hace lo que el runbook le enseñó: `curl … | jq .sentry` →
`null`; `jq .db` → `null`. Lee «no hay dato» donde debería leer «ese campo se
quitó hace rondas».

Consecuencia: el único documento que el issue de `salud-produccion` cita por
nombre miente sobre el único endpoint que ese issue manda mirar. Corrí
`runbook.test.ts` hoy: verde con el documento así — verifica `.env.example` y
`SILENCIOSAS`, pero nadie coteja el ejemplo de `curl` contra la forma de `cuerpo`.

Causa raíz probable: el cuerpo del health se rediseñó y su documentación quedó
como una cadena literal que ninguna red estructural toca.

---

### [MEDIO] `OP-M2` — En el push que publica la reparación, el paso que mide la salud corre ANTES del que espera al despliegue (REINCIDENTE)

`.github/workflows/salud-produccion.yml:71-85` (paso 4) vs `:109-129` (paso 6)

Verificado hoy: el paso 4 (`/api/health está healthy`) no tiene guarda de evento
y corre primero; el paso 6 (`El sha desplegado es el que se pusheó`) lleva
`if: always() && github.event_name == 'push'` y reintenta hasta 20 veces con
`sleep 30`.

Escenario, ya ocurrido, con valores (corrida `34437455166`, push de `7ed8920`,
10-sep 04:30:34Z): `04:30:48 compuerta: CONSTRUIR` · `04:30:49 intento 1:
esperado=7ed8920 desplegado=a6f924f` · `04:33:23 intento 6: esperado=7ed8920
desplegado=7ed8920` ← paso 6 VERDE · `04:33:27 Ya hay un issue abierto (#365)`
← paso 9, `if: failure()`. El job terminó en `failure` porque el paso 4 pegó al
health **14 segundos después del push**, cuando producción todavía corría el
defecto que ese mismo commit venía a arreglar.

Consecuencia: el único evento en que se sabe con certeza que el estado va a
cambiar es justo aquel en que se mide antes de que cambie. Quien publica un
hotfix a las 3 a.m. ve un workflow rojo sobre el commit que acaba de reparar la
cosa, y el paso «Cerrar el issue al recuperarse» (`:228-229`) no puede intervenir.

Causa raíz probable: el orden de los pasos es el histórico (salud, compuerta,
cotejo) y no el causal (compuerta, cotejo, salud) en el único evento donde el
orden importa.

---

### [MEDIO] `OP-M4` — El candado de conteo literal de `staging-recovery` sigue afirmando «hasta 0347» con el repo en 0356 (REINCIDENTE)

`scripts/ci/staging-recovery.mjs:87`, `:200`, `:214`, `:225`

Verificado hoy, con `ls supabase/migrations/*.sql | wc -l` = **333** y la última
`0356_arco_borra_contacto_emergencia.sql`:

```js
:200  cli('RESET', ['db','reset','--linked','--no-seed','--version','0331','--yes']);
:214  … || Number(physical[0].tables) !== 154 || … ) fail('RECOVERY_FINAL_SCHEMA');
:225  console.log('RECOVERY_MIGRATIONS_COMPLETE: historial reconstruido hasta 0347; …');
```

(más `:87`, `tables.length !== 59`).

Escenario: `:225` ya imprime una frase falsa hoy — el historial que reconstruye
llega a **0356**, no a 0347: un rótulo que no puede ser verdad, en el peor día
del proyecto. Y la próxima migración que cree una tabla hará que `:214` compare
`155` contra `154` y lance `RECOVERY_FINAL_SCHEMA`: nueve caracteres, después de
haber vaciado y repoblado staging, sin decir que la diferencia es una tabla que
alguien añadió a propósito.

Consecuencia: el script existe para la recuperación de desastre y su enclavaje
final se rompe por un motivo que no es un riesgo, en el punto de menor
reversibilidad. Sigue en MEDIO porque el camino solo se recorre con credenciales
de staging que aquí no existen.

Causa raíz probable: un valor derivado del repo guardado como literal.

---

### [MEDIO] `OP-M5` — El backup de Storage nunca ha corrido en verde, y van 18 días desde el último intento (REINCIDENTE, 5ª ronda)

`.github/workflows/backup-storage.yml:3-12`

**Medido hoy** (`actions_list` sobre `backup-storage.yml`): `total_count` = **2**.
Las dos corridas de toda su existencia son `2026-08-25T03:59:52Z` y
`2026-08-26T04:03:50Z`, ambas `conclusion: failure`, ambas `event: schedule`.
**Cero corridas de `workflow_dispatch`, nunca.** El comentario del propio
workflow (`:10-11`) pone la condición para reactivar el `schedule`: «hasta la
primera corrida MANUAL verde». Van **18 días** desde el último intento (la 30
midió 17; la 29 y la 28, 13).

Escenario: se pierde el bucket de Supabase Storage. Ahí viven las fotos de
ticket y los PDF de liquidación: la evidencia que el contralor cruza y la que
sostiene una deducción ante el SAT. No existe copia verificada fuera de Supabase
y ningún workflow programado lo va a decir.

Consecuencia: `docs/operacion/RESILIENCIA-DEPLOY.md` publica objetivos RPO/RTO;
el RPO real de Storage es *indefinido*, no un número. Se vuelve ALTO el día que
exista el primer cliente.

Causa raíz probable: el environment `production-backup` nunca se configuró y
nada calendariza esa tarea.

---

### [MEDIO] `OP-M6` — Un desconocido elige el nombre del evento de Sentry, que es su fingerprint (NUEVO)

`src/app/api/client-error/route.ts:36-70` (`:40`, `:60`, `:68`) ·
`src/lib/observability/sentry.ts:360-371`

`/api/client-error` es público y sin auth **a propósito y con buen argumento**
(el layout raíz que truena puede ser el que iba a resolver la sesión), y su
`meta` sí está defendido: `extraSeguro` (`sentry.ts:135-144`) filtra por lista
blanca. Lo que no está acotado es `msg`:

```ts
:60  const evento = `client.${sanear(msg, 80) || 'sin_evento'}`;
:68  logger[nivel](evento, { ...detalle, origen: 'cliente', ip: clientIp(req) });
```

`sanear` solo quita `\r\n\t` y recorta a 80. Ese string acaba en
`reportar(nivel, mensaje, …)`, y `sentry.ts:366` lo usa como
`fingerprint: [msg, nivel, ...discriminadores(meta)]` — o sea, **cada valor
distinto de `msg` abre un issue NUEVO en Sentry**.

Escenario, con valores: el techo es `rateLimit('client-error:'+ip, 20, 60_000)`
(`:40`). Un emisor con 20 IP manda `{"level":"error","msg":"a1"}` … `"a400"` →
**400 issues nuevos por minuto**. En un plan de 5,000 eventos/mes la cuota se
agota en ~13 minutos, y a partir de ahí Sentry descarta lo que llegue. El
`pdf.no_entregado` de esa madrugada cae en la ventana descartada — y `OP-A2` ya
dice que el runtime log de Vercel puede no existir el lunes.

Consecuencia: el único destino durable de los errores puede quedar ciego por un
camino que no requiere credenciales, y el rubro entero se apoya en que ese
destino exista. El diseño ya conocía el problema de cardinalidad: `sentry.ts:328`
explica que `viaje/viajeId` se deja FUERA del fingerprint «porque un issue por
fila sería ruido que mata la alarma igual que el silencio» — y este endpoint
concede exactamente esa cardinalidad a quien llame.

Refutación intentada: `extraSeguro` no ayuda (filtra `extra`, no el mensaje);
`redactarTexto` tampoco (redacta PII, no acota cardinalidad); el rate limit es
por IP, no global.

Causa raíz probable: la disciplina de fingerprint que el repo razonó con cuidado
para los emisores internos no se aplicó al único emisor externo.

---

### [BAJO] `OP-B1` — El trinquete de `.limit()` sigue guardando el derivado junto a sus partes (REINCIDENTE; hoy consistente, 188 = 188)

`ci/limite-sin-orden-baseline.json` · `src/lib/likida/limite_con_orden.test.ts:93-95`

Medido hoy: `total` declarado = **188**, suma de las **82** entradas de
`porArchivo` = **188**. Consistente, así que nadie está bloqueado ahora mismo.
El patrón no cambió: `:93` calcula `suma` y `:95` usa `BASELINE.total` para el
aserto final, teniendo el derivado a mano.

Escenario, ya ocurrido una vez: un lote arregla un `.limit()` real y baja el
contador de ese archivo sin tocar `total`. A partir de ese merge, **cualquier PR
de cualquier rubro** falla. Hizo falta un commit dedicado (`70821b2`, un archivo,
`-189/+188`) para desbloquear el repo.

Consecuencia: un peaje sobre todo el equipo cobrado en el momento de menos
contexto. BAJO y no más porque el mensaje de fallo es excelente.

Causa raíz probable: un artefacto de trinquete guarda un valor derivado junto a
sus partes en vez de derivarlo al leer.

---

## Lo que revisé y está bien

- **La suite del rubro, verde y medida hoy por mí:** `npx vitest run scripts/
  src/lib/observability src/lib/likida/runbook.test.ts src/app/api/health
  src/app/admin/crons src/lib/admin/salud.test.ts src/app/api/cron/wa-outbox
  src/app/api/client-error` → **44 archivos, 630 pasan, 5 saltadas, 0 fallos,
  14.76 s**. Las 5 saltadas siguen siendo las de `proxy-local` (IPv6): cuarta
  ronda sin fallar.
- **La compuerta sigue fail-closed donde importa, y lo verifiqué leyéndola
  entera.** `compuerta-deploy.mjs:104-106` (health ilegible → no se construye),
  `:114-116` (base sin forma `\d{4}` → bloquea), `:174-194` (`leerHealth`: solo
  200 y 503 cuentan como health leído; el 429 reintenta con backoff y si no,
  `null` → bloquea), y `:125-135` es el cotejo por **CONJUNTO** de prefijos, no
  máximo contra máximo. `FLAG_DEPLOY_RE` (`:51`) es la única definición y
  `:79-84` la aplica solo a la primera línea, igual que `salud-produccion.yml:97`
  y `:116` con su `head -n1`.
- **`vercel.json` y `CADENCIA_MS` están alineados, cron por cron.** Los 11 de
  `vercel.json:9-54` son exactamente los 11 de `salud.ts:28`, con las cadencias
  espejadas en `:33-71`; `salud.test.ts` compara las dos listas.
- **`puertaCron` falla cerrado y con código estable.** `salud.ts:80-96`: sin
  `CRON_SECRET` → 500 + `alertarOperador` + `codigo:'cron_sin_secreto'`; con
  secreto desfasado → 401 sin cuerpo pero CON `logger.error('cron.<id>.no_autorizado')`,
  y como el nombre del cron está en el `msg`, Sentry abre un issue por reloj.
  `auth/cron.ts` compara en tiempo constante sobre SHA-256 de los dos lados,
  para que el largo del secreto tampoco sea observable.
- **`registrarLatido` nunca lanza y sí deja constancia cuando no pudo escribir**
  (`salud.ts:100-110`), y `wa-outbox/route.ts:69` y `:81` lo llaman ANTES de
  devolver el 500 y el «saltado»: un apagado deliberado ya no se pinta como cron
  muerto, y un interruptor ilegible ya no es mudo.
- **El logger sigue siendo el mejor archivo del rubro.** `logger.ts:99-107`
  (`huellaId`, FNV-1a a 12 hex), `:110-123` (`redactarTexto` con el orden
  EMAIL→UUID→CLABE→TARJETA→RFC→TEL explicado), `:79-82` (una sola pasada con
  reglas alternadas, para que la salida de una regla no sea entrada de la
  siguiente) y `:146` (`CLAVES_NO_PII` protege `digest`, que tiene forma de
  celular). Sin tocar esta ventana.
- **`onRequestError` y el fallo solo-de-cliente.** `src/instrumentation.ts:69-99`
  emite `request.fail` con `ruta`, `tipo`, `metodo`, `digest` y `err`, y hace
  `await flushObservabilidad()` antes de que la invocación se congele —
  `sentry.ts:297-303` espera además los envíos en vuelo. `logger.ts:177-189` +
  `:211-213` mandan el error de cliente a `/api/client-error` con `keepalive`.
- **El saneador de Sentry cubre las transacciones, no solo los errores.**
  `sentry.ts:249` y `:258` registran `beforeSend` **y** `beforeSendTransaction`
  con el mismo `sanitizarEventoSentry`, que además borra `spans[].data` y
  `contexts.trace.data` (`:164-180`) — que es donde el SDK mete la URL completa
  con query de cada fetch a Supabase.
- **`ci.yml` corre en TODAS las ramas** (`:21-23`, `branches: ['**']` + PR) con
  `concurrency` que cancela lo que quedó atrás, y el orden no tiene escapes:
  typecheck → `lint:ratchet` → resiliencia offline → `test:coverage` → las
  pruebas de tiempo SIN instrumentar (`:84-85`, que es lo que `--coverage` salta)
  → build → arrancar el build real y smoke de Playwright (`:110-124`) → puertas
  de supply chain al final (`:145-166`), con la runtime bloqueante y fail-closed
  tras tres intentos inconclusos y la de desarrollo `continue-on-error`.
- **`rollback-production.yml` es fail-closed de verdad** (`:26-31`): exige URL
  HTTPS explícita y la palabra `ROLLBACK_PRODUCTION` tecleada, verifica
  `VERCEL_TOKEN` antes de llamar a Vercel, y **comprueba la salud DESPUÉS**
  (`:40-48`, `jq -e '.status=="ok" and .checks.db=="ok"'`). Lo abrí por primera
  vez esta ronda.
- **`scripts/seed.sh` lo leí entero (no lo ejecuté, no hay `psql` aquí) y sus
  dos guardias están bien puestos:** por HOST (`:130-142`, un `*.supabase.co`
  exige `--produccion` escrito a mano) y por NOMBRE (`:144-153`, si el tenant
  `1111…` no se llama «Flota Demo» se rehúsa) — y el guardia por nombre corre
  ANTES de aplicar migraciones, no solo antes de sembrar. Detecta la pila local
  con `supabase status -o json` (`:38-53`), crea `.env.local` desde
  `.env.example` con las tres llaves reales **solo** si la pila local se detectó
  (`:74-92`), y aborta con instrucciones si falta `psql` (`:24-29`). El preflight
  de índices concurrentes antes de la `0332` (`:186-192`) apunta a
  `scripts/ci/0335_preflight_retencion_indices.sql`, que existe.
- **`envPuesta` rechaza por CONTENIDO, no por presencia** (`env.ts:44-57`): el
  incidente del 20-ago (seis variables con el literal `[SENSITIVE]` que
  `!!process.env[k]` daba por completas, con el OCR facturando cero) está
  cerrado con `MARCADOR`, y `arranque.ts:100` usa ese mismo predicado.
- **La pantalla de crons falla cerrado.** `crons/page.tsx` captura el error,
  loguea `admin.crons.sin_latidos` y devuelve `null`; `vista.tsx:209` pinta «No
  se pudo leer el pulso … Esto NO significa que estén corriendo».

---

## Lo que NO alcancé a revisar / no verificable sin red

Sin esto la nota es una mentira por omisión.

1. **INFRA — egress bloqueado, quinta ronda.** **No pegué ni una vez a
   `https://app.likida.ai/api/health`.** Cada cifra de producción de este
   documento sale de la API de GitHub vía MCP (`actions_list`), que sí respondió.
   No tengo el cuerpo vivo del health de hoy: **no sé qué valor tiene
   `checks.crons` ni `migracion` en este momento**, solo que las corridas
   `#641`…`#647` terminaron en `success`, lo que implica `status=ok` a las horas
   en que corrieron. Si producción cambió de estado después de las 06:23:58Z de
   hoy, no lo sé.
2. **`ALERTA_EMAIL`, `ALERTA_WA`, `SENTRY_DSN`, `LEGAL_ENFORCE_DOCS`** — viven en
   el panel de Vercel. **Quinta ronda consecutiva sin poder responderlo.**
   `alertaConfigurada()` (`alerta.ts:37-39`) exige `ALERTA_EMAIL` **y**
   `correoConfigurado()`; sin ellas cada `alertarOperador(...)` es un no-op
   silencioso por diseño. Si están vacías, `OP-C1`, `OP-A1` y `OP-A5` son peores
   de lo que los escribí y esta nota debería bajar a 4.
3. **Si Sentry tiene DSN real y reglas de alerta.** El cableado del repo
   (`logger.ts:204-206`, `observability/sentry.ts`) es correcto; el efecto vive
   fuera, y `OP-M1` impide preguntárselo al endpoint.
4. **No ejecuté `staging-recovery.mjs`, `aplicar-migraciones-y-humos.sh` ni
   `scripts/seed.sh`.** Requieren credenciales de staging o un `psql` que aquí no
   existen. `OP-M4` sale de leer el código y contar los `.sql` del repo.
5. **`deploy-preview-promote.yml`** (532 líneas, 11 jobs, cuatro de ellos con
   `environment: production`): solo lo **inventarié** (disparador
   `workflow_dispatch` únicamente, `concurrency: vercel-release-likida`,
   `cancel-in-progress: false`, y la secuencia preflight → quality →
   supabase-dry-run → preview → smoke → production_migrations →
   production_candidate → production_smoke → promote). **No leí el cuerpo de
   ningún paso.** Cuarta ronda pendiente.
6. **`recover-empty-staging.yml`, `e2e-navegador.yml`, `codeql.yml`,
   `auto-merge-rutina.yml`, `aviso-deploy-en-pr.yml`** — no los abrí.
   `ci-postgres.yml` no lo abrí esta ronda (es el único archivo del rubro con
   diff desde la 30, seis líneas según la 30).
7. **No corrí la compuerta completa** (`npm test`, `npm run typecheck`,
   `npm run lint`). Corrí solo la suite de mi rubro (44 archivos, 635 pruebas) y
   me apoyo en la línea base de `docs/auditoria-31/00-SINTESIS.md` para lo demás.
8. **Clon superficial.** Cualquier afirmación mía sobre historia anterior al
   7-sep sale de la API, no de git local. Las cifras de publicación de esta
   ventana sí salen de git local, porque la ventana entera cabe en el clon.
