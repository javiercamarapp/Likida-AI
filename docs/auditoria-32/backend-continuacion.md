# Backend y API — auditoría 32 (continuación 17-sep)

**Nota: 6/10** (antes 6). Ninguna de las tres formas aplica, así que **la nota se
queda igual y lo digo con esas palabras**.

- *«Se atacó y subió»* — no: el único commit de la ventana
  (`f0645f9`, migración `0357` + su prueba SQL) no toca una línea de
  `src/app/api/`, `processor.ts`, `repo.ts`, `conv.ts`, `duplicados.ts` ni
  `pg_errores.ts`. Los tres abiertos siguen byte por byte en su sitio.
- *«Deuda que cobró factura»* — no: nada de lo abierto se convirtió en daño
  nuevo, y la compuerta de mi rubro está verde (`npx vitest run src/app/api` →
  **86 archivos / 1,233 pruebas**, 16.3 s; eran 1,229 en la 31: +4).
- *«Mirada más profunda»* — sí la hubo, y **no movió la nota en ninguna
  dirección**. Abrí nueve caminos que la 31 dejó listados como no revisados
  (`cron/facturar/lote.ts`, `cron/facturar/cola`, `cron/wa-pendientes/drenado`,
  `cron/jornada`, `worker/bus/[accion]`, `v1/liquidaciones`,
  `dashboard/ingesta`, `portal_pago_escritura`, `intake/rep`) y el saldo es
  **un MEDIO nuevo contra cinco refutaciones**: en cinco sitios donde el patrón
  malo aparecía, el guardarraíl ya estaba y lo verifiqué (van abajo, nombrados).
  Un saldo así confirma el 6; no lo sube ni lo baja.

Lo que sostiene el 6 y no menos es lo mismo que en la 31 —los caminos de
escritura de dinero anclan la condición EN la base, no en memoria— y ahora con
una comprobación que la 31 no tenía: **el patrón «un cron falla y late `ok`» NO
es una clase**. Lo perseguí en los once crons y solo `purgar` lo tiene (ver
abajo). Lo que impide el 7 tampoco cambió: la mitad destructiva de los caminos
de concurrencia sigue sin prueba, y `storage_borrado.test.ts:81-91` sigue
**afirmando** el estado atascado (`expect(r.fallidos).toBe(1)` sobre el lote
mixto — releído hoy, línea por línea).

**El riesgo mayor del rubro, hoy:** sigue siendo la guardia de orden de Stripe,
que es una LECTURA que falla ABIERTA (`saas/suscripcion.ts:791` — `return null`
ante error de lectura, con el «en la duda, se aplica» escrito en el docblock de
`:785-786`) y por ella un `invoice.payment_failed` reentregado revierte a
`fallida` una mensualidad ya cobrada (`:861-868` + upsert de `:880`).

---

## Estado de los tres abiertos de la 31

Los tres verificados HOY, abiertos y leídos, sobre el árbol sin tocar.
**Ninguno se cerró; ninguno estaba mal reportado.** Las líneas son idénticas.

### [ALTO · REINCIDENTE — 2ª aparición] La cola de borrado de Storage se atasca para siempre en cuanto un lote mezcla archivos que existen con archivos que ya no, y el cron sigue latiendo `ok`

`src/lib/likida/storage_borrado.ts:93`
(`const aSellar = nombres.filter((n) => confirmados.has(n) || confirmados.size === 0);`)
· `:102-107` (el comentario que promete la recuperación que el código no hace)
· `:108-109` (`borrados`/`fallidos`)
· `src/app/api/cron/purgar/route.ts:313-320` (el único consumidor:
`logger.warn`, sin `alertarOperador`) · `:383-385` (el `estado`, que NO mira
`storage`) · `src/lib/likida/storage_borrado.test.ts:81-91` (la prueba que fija
el defecto).

Escenario: cancelación ARCO de la flota `t-1` marca `a.jpg`, `b.jpg`, `c.jpg` en
`storage_huerfano_candidato`. Noche 1 la API borra las tres y el `update` del
sello falla (bache del pooler) ⇒ `:106` solo `logger.warn`, `borrados += 3`,
`fallidos = 0` ⇒ ni el `warn` de `purgar/route.ts:316` sale. Noche 2 la cola
trae `a/b/c` (ya inexistentes) más un `d.jpg` que sí existe:
`remove(['a','b','c','d'])` devuelve `data = [{name:'d.jpg'}]`, así que
`confirmados.size === 1` ⇒ la segunda rama de `:93` no se activa ⇒
`aSellar = ['d.jpg']`, `fallidos = 3`. **A partir de ahí se repite igual todas
las noches**: `a/b/c` encabezan siempre la lectura
(`.order('motivo').order('detectado_en')`, `LOTE = 200`) y nunca se sellan.

Consecuencia: con ≥ 200 cadáveres de motivo `arco` —y se acumulan solos, uno por
cada sello fallido— **ninguna cancelación ARCO nueva vuelve a borrarse jamás**
(15 días hábiles de plazo legal, LFPDPPP 23-25), y `estado` (`:383-385`) no mira
`storage`, así que `/api/health` y `/admin/crons` siguen verdes. La segunda cara
sigue igual de viva: un `remove` que devuelva `[]` sin error por una razón que
NO sea «ninguno existía» sella **el lote entero** como borrado con los archivos
todavía en el bucket.

Causa raíz probable: «ya no existe» y «no se pudo borrar» se distinguen con una
heurística sobre el LOTE (`confirmados.size === 0`) y no sobre el ARCHIVO.

**Prueba que lo cubra: ninguna, y la que hay lo bendice.** Corrí
`storage_borrado.test.ts` hoy: 4 pruebas verdes. La de `:81-91` («sella solo los
que la API confirmó, no el lote entero») monta el lote mixto exacto
(`data: [{name:'a.jpg'}]` sobre `['a.jpg','b.jpg']`) y **afirma
`expect(r.fallidos).toBe(1)`** — o sea fija como correcto que `b.jpg` se quede
en la cola. La rama `confirmados.size === 0` con filas en la cola no se prueba
en ningún caso.

---

### [ALTO · REINCIDENTE — 2ª aparición] «Margen real medido» de `/dashboard/facturacion` suma el costo comprobado de liquidaciones que el contralor RECHAZÓ

`src/lib/likida/auditor_cobranza.ts:582-586` (la lectura:
`traerPorIds<{ viaje_id; total_comprobado }>` → `select('viaje_id, total_comprobado')`,
sin `revision` en el select ni en el filtro) · `:722`
(`liquidacion: liq ? { totalComprobado: liq.total_comprobado } : null`, lo único
que llega a `auditarViaje`) · `:463-469` y `:472-486` (`resumirAuditoria` suma
`comprobado` y calcula `margenPct`) ·
`src/app/dashboard/facturacion/vista.tsx:641` (el rótulo «Margen real medido»).

Escenario, con valores. Flota `t-1`, ventana del mes, tres viajes con
`ingreso_flete` capturado: F-1040 pactado $20,000 / comprobado $12,000 /
aprobada; F-1041 igual; F-1042 pactado $20,000 / comprobado **$18,500** /
**rechazada**. `getAuditoriaCobranza` lee los viajes **sin filtrar `estatus`**
(`:545-546`: solo `fecha_inicio` entre `desde` y `hasta`), así que F-1042 entra;
la lectura de `liquidacion` no pide `revision`, así que nada la distingue.
Sale: `pactado 60,000 · comprobado 42,500 · margen 17,500 · 29.2 % · 3 viajes
medidos · 0 sin dato`. Lo correcto es `40,000 / 24,000 / 16,000 / 40 %` sobre
**2** medidos y 1 sin dato.

Consecuencia: dos pantallas del mismo producto, la misma sesión, el mismo mes,
dos cifras. La que miente es la que el contralor abre para decidir a quién
facturarle, y miente en la dirección peligrosa (infla el costo con un
comprobante que él mismo invalidó) mientras el campo que existe para avisarlo
(`faltaMargen`, `:383-404`) afirma que no falta nada. Es la forma que la `0348`
fue a arreglar en seis RPC, en un AGREGADO que nunca estuvo en esa lista.

Causa raíz probable: no existe un predicado compartido de «liquidación
vigente»; está escrito a mano en cada lector.

**Refutación intentada hoy, y una confirmación nueva.** Verifiqué en la base que
la constraint de la `0299` (`supabase/migrations/0299_revision_liquidacion.sql:210`,
`if v_rev = 'rechazada' and v_estatus = 'liquidado' then raise exception`)
**prohíbe** que un viaje rechazado siga en `liquidado`. Ése es el guardarraíl
real — y es exactamente el que `auditor_cobranza` **no usa**, porque no filtra
`estatus` en ningún punto. El mismo guardarraíl sí salva a
`cotizador/lector.ts:164` (`.eq('estatus','liquidado')`), que era mi candidato a
hallazgo hermano: lo abrí, lo perseguí y **queda refutado**.

**Prueba que lo cubra: ninguna.** `grep -c revision auditor_cobranza.test.ts` →
**0**, igual que en la 31. Corrí el archivo hoy: verde, y ni una prueba toca una
liquidación rechazada.

---

### [BAJO · REINCIDENTE — 2ª aparición] `mantener_mcp_oauth` puede fallar todas las noches y el latido de `purgar` sale `ok`

`src/app/api/cron/purgar/route.ts:364-368` (el fallo se loguea y se alerta, pero
`mcpOauth` queda `null` y nada más) · `:383-385` (el `estado`: mira
`erroresRetencion0104` y `productoEventoError`, **no** `mcpOauth` ni `storage`)
· `:390-397` (el latido, que tampoco los lleva).

Escenario: la RPC `mantener_mcp_oauth` (0265) empieza a devolver `42883`.
Cada corrida diaria: `logger.error` + `alertarOperador`, pero `estado = 'ok'`,
`registrarLatido('purgar','ok',…)` y HTTP 200. `/admin/crons` y `/api/health`
pintan la purga en verde indefinidamente mientras los tokens MCP revocados y los
clientes DCR muertos se acumulan sin techo.

Consecuencia: el correo al operador es la ÚNICA señal y el tablero —que es donde
se mira— afirma lo contrario. De los **4** subsistemas que este cron ejecuta,
**2 mueven el veredicto y 2 no**.

Causa raíz probable: `estado` se fue ampliando subsistema por subsistema en vez
de derivarse de la lista de resultados.

**Sobre el patrón que el encargo pedía perseguir: no es una clase, es `purgar`.**
Abrí los once crons y crucé cada `alertarOperador`/`logger.error` de subsistema
contra el `registrarLatido` de su salida:

| cron | ¿un subsistema que falla mueve el veredicto? | evidencia |
|---|---|---|
| `escalar` | **sí, los cinco** | `route.ts:218,247,286,315,345` — cada rama pone `huboFallo = true`, y `:419` lo consume |
| `jornada` | **sí** | `:95-97` (`huboFallo`, `parcial` incl. `sinAvisoPrevio`) |
| `facturar` | **sí** | `lote.ts:699` (`chromium_sin_arrancar`), `:752`, `:794`; `cola/route.ts:44,70,75` |
| `gps` | **sí** | `:202-217` (DLQ → `parcial`) |
| `wa-outbox` | **sí** | `:101` (`canal_no_configurado` → `fallo`), `:181` |
| `wa-pendientes` | **sí** | `drenado.ts:93,254,262` — **me lo creí un hallazgo y me refuté solo**: `route.ts` no late en su camino feliz porque quien late es `drenado.ts` |
| `descarga-sat` / `portales-vivos` / `runner` / `asistencia` | **sí** | `:157`, `:155`, `:122`, `:93` |
| **`purgar`** | **NO, en 2 de 4** | `:383-385` |

Y la prueba que promete cerrar la clase —`src/app/api/cron/latido-en-toda-salida.test.ts`—
**no la cierra**: solo exige latido en dos caminos (`interruptor_ilegible` y
`saltado:`), nunca que un subsistema fallido mueva el veredicto. Es decir, el
`purgar` de hoy pasa esa prueba en verde.

---

## Hallazgos nuevos

### [MEDIO · NUEVO] Un Chromium que no arranca en la SEGUNDA flota se traga el aviso de los tickets que la PRIMERA ya sacó de la cola automática — y ese aviso no se vuelve a emitir nunca

`src/app/api/cron/facturar/lote.ts:697-725` (el `return` temprano con 503) ·
`:741` (`const avisos = await avisarALasPersonas(bloqueadosPorFlota, hoy);`, que
queda por debajo de ese `return`) · `:385` y `:358` (`anotarBloqueo`, que puebla
`bloqueadosPorFlota` dentro del bucle) · `:406` + `:686` (`falloDeArranque`,
declarado fuera del bucle y nunca reseteado) · `:916-937` (lo que el `finally`
SÍ alcanza a mandar) · `src/lib/likida/facturacion/al_vuelo.ts:713-735`
(`bloquear`, el `update` de `autofactura_bloqueada_en`).

**Escenario, con valores.** Lote de QStash con dos flotas, `modo = 'emitir'`:

1. **Flota `t-1`, portal CAPUFE, 3 tickets.** `conNavegador` arranca
   (`:534`, `arranco = true`), `correrLote` corre, el portal pide CAPTCHA en dos
   de ellos. `facturarLoteAlVuelo` llama `bloquear()` ⇒ los dos gastos quedan
   con `autofactura_bloqueada_en = '2026-09-17T…'` y `autofactura_bloqueo =
   'el portal pidió CAPTCHA…'`. Eso los saca de la cola automática **para
   siempre**: `enCola()` en `route.ts:344` filtra
   `.is('autofactura_bloqueada_en', null)`. `anotarBloqueo` los guarda en
   `bloqueadosPorFlota` (`:385`). `corridas.set('t-1', null)` (`:651`).
2. **Flota `t-2`, 1 ticket.** El segundo `conNavegador` no arranca —el
   lanzamiento agota `TOPE_LANZAR_MS` (`pagina_playwright.ts:1144-1159`), o
   `newContext` revienta por memoria tras el perfil que dejó la primera flota—.
   Como `arranco` sigue en `false`, `:686` hace `falloDeArranque = detalle`.
3. Sale del bucle. `:697` ve `falloDeArranque` truthy ⇒
   `registrarLatido('facturar','fallo',{codigo:'chromium_sin_arrancar'})` y
   **`return` con 503 en `:725`**. La línea `:741` —el único emisor de WhatsApp
   al encargado— **no se ejecuta**.
4. **No hay segunda oportunidad.** El emisor solo dispara con los bloqueos que
   ESTA corrida creó (el criterio está escrito en `:737-740`); los dos gastos ya
   no vuelven a la cola; y los 2 reintentos que QStash lanza sobre el 503 caen
   en `al_vuelo.ts:228` (`reclamarIntento` ya no los cede porque
   `autofactura_intentada_en` acaba de escribirse) ⇒ devuelven `ya_en_proceso`,
   **sin** campo `bloqueado`, así que `anotarBloqueo` tampoco se vuelve a
   llamar. El WhatsApp de esos dos tickets no existe en ninguna corrida futura.

**Consecuencia.** El encargado de `t-1` nunca recibe el «estos dos los tienes
que facturar tú»: dos consumos de caseta se quedan sin CFDI, sin IVA acreditable
y sin quien los mire, mientras `t-2` —que no tenía nada que ver— se lleva el
correo de fallo de plataforma. Se salva de ser ALTO porque el `finally` sí
alcanza: `avisoColaAtorada` sale por `:916-937` para `t-1` (está en `corridas`),
y los tickets siguen visibles en la pantalla «por facturar»
(`al_vuelo.ts:703-706` lo deja escrito). O sea: la notificación de la app
sobrevive, el empujón por WhatsApp no.

**Refutación intentada (tres veces, y una sí prosperó).** (a) ¿Lo tapa el
`finally`? No: `avisarALasPersonas` es el único que llama `telefonoJefeDe` +
`avisarPorFacturar`, y vive en `:741`, dentro del `try`, por debajo del
`return`. (b) ¿Lo tapa el reintento de QStash? No, por el paso 4. (c) ¿Se puede
disparar con un `storageState` corrupto de la flota `t-2`, que sería un trigger
determinista? **No** — lo perseguí hasta
`pagina_playwright.ts:1171-1175` y ahí un `storageState` ilegible es un
`logger.warn` y contexto limpio, no una excepción. Por eso describo el trigger
como agotamiento de recursos en el segundo lanzamiento y no como un dato de
flota: el mecanismo es cierto, el disparador es de recurso.

**Causa raíz probable.** `falloDeArranque` es una bandera de lote que se levanta
en una flota y decide el `return` de todas, pero el aviso a las personas es POR
FLOTA y quedó debajo de ese `return` en vez de en el `finally`, adonde ya se
movieron sus tres hermanos (`avisarCorridasPorFlota`, `registrarCorrida`,
`avisoColaAtorada`) por exactamente esta razón — está escrito en `:796-814`.

**Prueba que lo cubra: ninguna, y el fixture ya existe.**
`src/app/api/cron/facturar/route.test.ts:544-557` («lo que SÍ se pudo hacer sin
navegador se hizo, y se reporta») monta el caso —un ticket que se procesa y un
arranque fallido— y afirma `status 503`, `intentados: 1`, `sinIntentar: 1`.
**No mira `avisos` ni una sola vez**; `grep -c avisarALasPersonas` sobre los
tests de `cron/facturar` → 0 llamadas comprobadas (la única mención, `:213`, es
un comentario). Corrí el directorio hoy: verde.

---

## Lo que revisé y está bien

Todo abierto y leído hoy, no inferido del nombre. Las cinco primeras son
candidatos a hallazgo que **perseguí y refuté** — valen tanto como los hallazgos
porque cierran la pregunta.

- **`cron/wa-pendientes/route.ts`** — lo abrí creyendo que era un cron sin
  latido en su camino feliz (solo tiene `registrarLatido` en `:75` y `:88`,
  ambos de apagado). **Falso:** quien late es el worker,
  `wa-pendientes/drenado.ts:93` (`parcial` por cadena obsoleta), `:254` (el
  cierre real) y `:262` (`fallo`), y hay prueba nombrada —
  `route.test.ts:185` y `:423` afirman `registrarLatido('wa-pendientes','parcial',…)`.
- **`cotizador/lector.ts:135-203`** (`casetasMedidasPorRuta`, que fija el precio
  de una cotización): lee `liquidacion` sin `revision` (`:147-152`), que es la
  forma del ALTO de arriba — pero `:164` filtra `.eq('estatus','liquidado')` y
  la constraint diferida de la `0299` (`0299_revision_liquidacion.sql:210`)
  garantiza que un viaje con liquidación rechazada **no puede** estar en
  `liquidado`. El promedio no se contamina.
- **`portal_pago_escritura.ts:309-326`** (`conciliarPropuesta`): el `const { data: ahora }`
  suelta el `error` a propósito y **falla cerrado** —`String(f2.estado ?? 'ilegible')`
  cae en la rama de `portal_pago.conciliacion_sin_sello` con un `DatoInvalido`
  que nombra el `pagoId` y manda a revisar a mano. El abono duplicado lo impide
  el índice (`AbonoYaRegistrado` en `:268-290`), no un `if`.
- **`dashboard/ingesta/route.ts:104-135`**: sospeché que un `registrarCosto`
  que lanzara convertiría una visión ya pagada en 502 + reintento (doble gasto).
  **No puede:** `costos.ts:117-120` lo declara best-effort y lo demuestra —
  `{ error }` por valor dentro de su propio `try`, y un `costoUsd` no finito se
  descarta con `logger.error` en vez de escribir un 0 (`:126-133`).
- **`intake/rep.ts:261`** — un `const { data: existentes }` que suelta el error
  (el patrón exacto del hallazgo). Perseguí `resumen.ligados` por todo el repo:
  **no lo consume nadie** salvo el `logger.info` de `:267`, y
  `mensajeRepRecibido` (`:272-291`) no lo usa. Es un contador de log, no una
  cifra. No lo reporto.
- **`worker/bus/[accion]/route.ts`**: los tres caminos de concurrencia anclan la
  condición en el WHERE y devuelven la verdad por valor —`corrida-fin` con
  `.is('fin', null).select('id')` y `cerro` en el cuerpo (`:81-90`),
  `ordenes-claim` con `.eq('estado','pendiente')` (`:159-163`), y
  `ordenes-resolver` exigiendo seguir `tomada` **y** ser `tomada_por` (`:178-179`),
  con el fallback a `is('tomada_por', null)` acotado a las filas anteriores a la
  0285. Un cierre que no aplicó no es 200 a secas: sale `resolvio: false` y un
  `logger.warn` con el id (`:192`).
- **`v1/liquidaciones/route.ts:116-158`**: el contrato no acepta lo que no
  debería — `?revision=aprobadas` (plural) es **400 con motivo**, no un default
  silencioso (`leerFiltroRevision`), el filtro por defecto es `firmadas`
  (`aprobada|ajustada`), el cursor lleva la segunda rama `(created_at, id)` que
  evita perder empates de microsegundo, y la lectura pasa por `exigir()`.
- **`cron/facturar/cola/route.ts`**: firma de QStash antes de nada, kill switch
  con **200** (un 5xx haría que QStash insistiera en correr lo apagado, `:89-101`),
  y revalidación de `cfdi_uuid IS NULL` antes de procesar (`:106-113`). Verifiqué
  que el `.in(ids)` no puede cruzar el recorte de 1,000 de PostgREST:
  `TOPE_CANDIDATOS = LOTE_POR_FLOTA * SESIONES_POR_CORRIDA` (`route.ts:171`) y el
  lote encolado sale de ahí. El 503 mudo de `:38-46` **ya tiene latido**
  (`:44`, BE-6(b) cerrado) y el «encolé y nadie procesó» se cruza en
  `route.ts:398-417` con caída a síncrono.
- **`cron/escalar/route.ts:206-350`**: los cinco motores tienen `try/catch`
  propio y los cinco ponen `huboFallo = true`; un interruptor de agente ilegible
  cuenta como fallo (`:216-219`, `:245-248`) en vez de saltarse en verde.
- **`repo.ts`**: recorrí las 19 escrituras (`:140,355,530,541,632,735,836,909,929,1081,1203,1370,1395,1431,1551,1647,1775,1800,1921`)
  y **las 19 comprueban `error`**. Dos detalles que valen: `updateGastoCfdiXml`
  (`:836-866`) preserva `code` al relanzar, así que un 23514 sigue siendo
  distinguible de un fallo de red; y `guardarCodigoPendiente` (`:929-950`)
  traduce el choque contra `uq_codigo_pendiente_folio`/`_barras` a «ya estaba
  esperando» en vez de mandarlo al catch de ERROR del processor.
- **`pg_errores.ts`** (45 líneas, completo): `violaIndice` exige `code === '23505'`
  **antes** de buscar el nombre en `message`/`details` — sin eso, un mensaje que
  mencionara el índice de pasada se tragaría un error real.
- **`conv.ts:424-467`** (la carrera de `loadConversation`): el insert que pierde
  relee **por las seis variantes del teléfono**, no por `.eq` exacto, y si tras
  chocar con el índice la fila no aparece **lanza** en vez de devolver `id: ''`
  (`:458`) — que era el bug original que borraba el turno del asistente.
- **Compuerta de mi rubro, corrida por mí:** `npx vitest run src/app/api` →
  **86 archivos / 1,233 pruebas, verdes** (16.3 s). Y los archivos que cito como
  evidencia (`storage_borrado`, `auditor_cobranza`, `cron/purgar`,
  `cron/facturar`) → **6 archivos / 145 pruebas, verdes**.

---

## Lo que NO alcancé a revisar

- **`src/middleware.ts` sigue sin existir.** Mi rubro me lo asigna y el repo no
  lo tiene (tercera ronda seguida). La cobertura que alguien podría suponer ahí
  vive en `api/v1/_comun.ts::abrir()` y en `puertaCron`.
- **La segunda mitad de `cron/facturar/lote.ts`.** Abrí el bucle de flotas
  (`:296-726`), el `finally` (`:796-938`) y `avisarALasPersonas` (`:113-139`).
  **No** abrí `correrLote` por dentro (`facturarLoteAlVuelo`, `al_vuelo.ts:340-505`),
  ni `reconectar`/`refrescarSesiones`, ni `conPortales`. Es el único camino del
  repo que emite un CFDI irreversible desde un cron y sigue medio leído.
- **`processor.ts` completo (4,990 líneas)**: hoy solo verifiqué
  `TTL_FIRMA_PDF_SEGUNDOS` (`:1307`) y sus dos usos (`:1184`, `:1223`). El bucle
  de tools, la asistencia y las estadías siguen sin abrir, igual que en la 31.
- **Los ocho reincidentes de la 30**, que la 31 arrastra en tabla. Hoy verifiqué
  **cinco** a mano y los cinco siguen idénticos: `saas/suscripcion.ts:791`
  (BE-30-1), `avisar_cierre.ts:115` (BE-30-2), `libro_viaje.ts:590` (BE-30-4),
  `pg.ts:267` (BE-30-5), `processor.ts:1307` (BE-30-6) y
  `cron/escalar/route.ts:420-424` (BE-30-7, el ternario sigue evaluando
  `corteDuro` antes que `configAusente`). **No** reverifiqué BE-30-3
  (`intake/rep.ts:207-216`) ni BE-30-8. Su detalle vive en
  `docs/auditoria-30/backend.md` y no se repite aquí.
- **Sin abrir**, de la lista que la 29, la 30 y la 31 arrastran: `marketing/*`,
  `lead`, `admin/copiloto`, `admin/qa/*`, `auth/correo`, `client-error`,
  `export/{bitacora-peaje,carta-porte-xml,facturas-proveedor,jornada,liquidaciones,pdf}`,
  `dashboard/{chat,archivo,onboarding-chat}`, `admin/mapa-prospectos/mensaje`,
  `v1/openapi` (1,200 líneas), `mcp/route.ts`. Sí abrí en esta ronda, y salieron
  limpios o con lo dicho arriba: `worker/bus/[accion]`, `v1/liquidaciones`,
  `dashboard/ingesta`, `cron/{jornada,facturar,facturar/cola,wa-pendientes,wa-pendientes/cola,purgar,escalar}`.
- **Todo lo que exige Postgres vivo.** Lo que afirmo de la `0299` sale de leer
  su SQL, no de ejecutarlo: el MAPA dice que se puede levantar Postgres en esta
  imagen y **no lo levanté**, así que la constraint de `:210` está leída, no
  probada.
- **No corrí la suite completa** (línea base del orquestador, ~150 s) ni
  `npm run build` (prohibido en esta ronda), ni un solo
  `pruebas-manuales/*.prueba.ts`.
