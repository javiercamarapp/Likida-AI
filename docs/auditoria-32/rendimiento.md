# Rendimiento y costo — auditoría 32 (continuación 2, 18-sep)

**Nota: 4/10** (antes 4). **La nota SE QUEDA IGUAL**, y esta vez no es porque
las tres formas se cancelen a ojo: es porque el ancla del rubro es explícita
—«4 o menos si el peor caso excede el límite y falla callado»— y hoy lo excede
en **nueve** cadenas contra **ocho** de ayer. El número contable del movimiento
que SÍ hubo: **4 de los 6 hallazgos abiertos cerraron de verdad** (el único
CRÍTICO del rubro y tres ALTOs, verificados línea por línea abajo), y el peor
caso de `cron/asistencia` bajó de **158.7 s → 135.2 s** recontado con el mismo
método. Contra eso: la mirada más profunda encontró **dos crons que ninguna
ronda había sumado** y que también se pasan (`jornada` **83.0/60**,
`portales-vivos` **154.2/120**), el conteo del arreglo de asistencia declara
**8 consultas** sobre una cadena que tiene **10**, y la migración **0359 de esta
misma ronda** le metió al panel del contralor un **tercer Sort de la tabla
entera**: +16 % de pared y **+47 % de temp** por llamada, medido contra
Postgres 16 con 200,000 gastos (números abajo, reproducibles).

**El riesgo mayor del rubro, hoy:** los seis crons con reloj derivan un margen
que no cubre su propia cola, y lo primero que muere es siempre `registrarLatido`
— o sea que el modo de falla de este rubro es *invisible por construcción*:
`/admin/crons` pinta «no late» sin causa justo en las corridas más cargadas, y
nadie puede distinguir «el cron murió» de «el cron nunca arrancó».

---

## Las sumas que hice

Todas a los **techos escritos del repo**: `TECHO_PASO_CONSULTA_MS = 9.5 s`
(`presupuesto.ts:83`), `TECHO_ENVIO_WHATSAPP_MS = 10.0 s` (`:47`),
`alertarOperador` = Redis 1.2 s (`alerta.ts:61`) + Resend 5.0 s
(`correo/enviar.ts:42`) = 6.2 s, `registrarLatido` = 1 consulta acotada
(`admin/salud.ts:102`), `revisarPortal` = 12.0 s (`portales_vivos.ts:97`).

| cadena | peor caso sumado | límite escrito | margen | eslabones |
|---|---|---|---|---|
| `cron/asistencia` — escalada ámbar con lesionados y dueño sin teléfono | 14.5 + (10×9.5) + 10.0 + 6.2 + 9.5 = **135.2 s** | `maxDuration = 120` (`route.ts:16`) | **−15.2 s** | `route.ts:42` `:88-89` · `asistencia_escalamiento.ts:295,310,316,327,330,348,350,360,368,376` · `cobranza.ts:46,72` · `contactos.ts:211,215` |
| `cron/gps` — evento grave de cámara + purga DLQ | 9.5 + 190.5 + 104.5 + 6.2 + 9.5 = **320.2 s** (sin DLQ, 314.0) | `maxDuration = 300` (`:22`) | **−20.2 s** | `gps/route.ts:63,86,89,110,202,206` |
| `cron/descarga-sat` — `avisarCierrePeaje` | 19.0 + 256.5 + 38.5 + 9.5 = **323.5 s** | `maxDuration = 300` (`:13`) | **−23.5 s** | `descarga-sat/route.ts:45,51,106-107,125,157` · `peaje_cierre.ts:321,353,365,376,389` |
| `cron/descarga-sat` — `ingerir` → `guardarYConciliarConsolidado` | 19.0 + 256.5 + 74.7 nominal = **350.2 s**; a techos, 100 páginas × 9.5 = **+950 s** | `maxDuration = 300` | **−50.2 s nominal** | `ciclo.ts:277,341` · `consolidado.ts:342-356,473` · `pg.ts:45,48` |
| `cron/jornada` — un lote de 50 admitido en el último instante | 9.5 + 45.0 + 9.5 + 9.5 + 9.5 = **83.0 s** (con `T=0`: 73.5) | `maxDuration = 60` (`:13`) | **−23.0 s** | `jornada/route.ts:55,58,75,97` · `derivar.ts:59,263,268,298` |
| `cron/portales-vivos` — un portal roto que se refuta | 9.5 + 105.0 + 24.0 + 6.2 + 9.5 = **154.2 s** (con `T=0`: 144.7) | `maxDuration = 120` (`:14`) | **−34.2 s** | `portales-vivos/route.ts:69,72,78,104,144,155` · `portales_vivos.ts:97,299,304,309` |
| `cron/wa-pendientes` — cola del cron tras el pool | 65.4 + 54.6 + 38.0 = **158.0 s**, y `encolarOtraVuelta` puede sumar **+1,804.3 s** | `maxDuration = 120` (`:13`) | **−38.0 s como mínimo** | `drenado.ts:142,201,217,281-296,241,254` · `presupuesto.ts:268` |
| `/api/dashboard/chat` | **106.5 s** | `maxDuration = 60` (`:34`) | **−46.5 s** | `chat/route.ts:34,129,159` (recontado igual que la 31) |
| Server Action «Ejecutar ahora» de Peajes — el prólogo | 100 páginas × 0.3 = 30.0 s nominales (**950 s** a techos) **antes** del primer `Date.now()` | reloj propio de **25.0 s** (`peajes/page.tsx:234`) | **−5.0 s nominal** | `consolidado.ts:768,774-779,797-801,817-827,860` |

Y una suma de **dinero/E-S**, no de tiempo, medida contra Postgres 16 real
(200,000 gastos de un tenant, `work_mem = 4MB`, las 336 migraciones aplicadas):

| función | pared | temp leído | temp escrito | Sorts sobre el juego completo |
|---|---|---|---|---|
| `gastos_fiscales_agregados_tenant` **antes** (0355) | 4.98 s | 94,301 bloques (≈ 736 MB) | 94,385 | 2 (164,944 kB + paralelo) |
| `gastos_fiscales_agregados_tenant` **hoy** (0359) | **5.77 s** (+16 %) | **138,714** (≈ 1,084 MB, **+47 %**) | **138,844** | **3** (172,408 kB + **170,104 kB nuevo** + paralelo) |
| `sumar_combustible_ejercicio` **antes** (0349) | 0.218 s | 796 bloques | 798 | 2 |
| `sumar_combustible_ejercicio` **hoy** (0358) | **0.375 s** (+72 %) | **1,701** (+114 %) | **1,705** | **3** |

---

## Hallazgos

### [CRÍTICO] REN-30-C2 · `guardarYConciliarConsolidado` corre hasta 100 páginas de `gasto` dentro de una unidad atómica que el reloj de `descarga-sat` ya dio por despachada (REINCIDENTE desde la 29)

`src/lib/likida/sat_descarga/ciclo.ts:277` (el único `Date.now() >= venceEn`,
por XML) contra `:341` (`await guardarYConciliarConsolidado(...)`, que a partir
de ahí corre sin volver a mirar la hora) ·
`src/lib/likida/intake/consolidado.ts:473`
(`const candidatosDb = rango ? await candidatosDeGasto(tenantId, rango) : []`,
sin `venceEn`) · `:342-356` (`traerTodoDesdeId`, sin corte) ·
`src/lib/likida/pg.ts:45` (`PAGINA = 1_000`), `:48` (`MAX_PAGINAS = 100`) ·
`src/app/api/cron/descarga-sat/route.ts:106`
(`margenUnidadAtomicaMs({ consultas: 3, envios: 1 })` = **43.5 s**).

**Escenario: entra esto → sale esto mal.** Un paquete del SAT con 250 XML de
consolidado de peaje para una flota con 99,000 gastos sin `cfdi_uuid` en el
rango de fechas de esas líneas. `venceEn = T_d + 256.5 s`. El XML número 190
pasa el chequeo de `:277` con 0.5 s de margen y entra a
`guardarYConciliarConsolidado`, que antes del primer avance durable (`enLotes`,
`consolidado.ts:495`) hace `candidatosDeGasto`: **100 páginas** de `gasto`.
Nominal (0.3 s/página) son **30.0 s** y la suma queda en **350.2 s contra 300**;
a techos (9.5 s/página) son **950 s** y Vercel corta tres veces antes de que la
página 100 vuelva. El margen que la ruta reservó para ESA unidad son 38.5 s.

**Consecuencia para alguien real.** La invocación muere con los sellos del XML
a medio escribir y **sin `registrarLatido`** (`route.ts:157`): el tablero de
Javier dice «no late» para el cron que recoge los CFDI del SAT, cada seis horas,
sin decir por qué. Lo que se pierde no es la conciliación (es re-entrante) sino
la prueba de que la corrida existió y el aviso de cierre de peaje que iba detrás
en la misma vuelta — y ese aviso tiene fecha de caducidad legal (el derecho a
facturar casetas se extingue el último día del mes).

**Causa raíz probable:** el reloj se consulta en el bucle del llamador y la
unidad que despacha contiene una lectura paginada cuyo techo estructural
(`MAX_PAGINAS × TECHO_PASO_CONSULTA_MS`) es tres veces el `maxDuration` de
cualquier ruta del repo. (REINCIDENTE: 29, 30, 31.)

---

### [ALTO] REN-32C2-A1 · `cron/jornada` suma 83.0 s contra `maxDuration = 60`: su margen de 15 s no alcanza ni para el lote que admite ni para su propia cola — NUEVO

`src/app/api/cron/jornada/route.ts:75`
(`const venceEn = Date.now() + Math.min(PLAZO_DERIVACION_MS, (maxDuration - 10) * 1000)`,
con `PLAZO_DERIVACION_MS = 45_000` en `derivar.ts:59` → el mínimo gana y el
margen efectivo sobre los 60 s son **15.0 s**) · `:55` (`puertaCron`) y `:58`
(`leerInterruptor`, acotada, hasta 9.5 s) **antes** de anclar el reloj · `:97`
(`registrarLatido`, 1 consulta acotada) · `src/lib/likida/jornada/derivar.ts:263`
(el corte, antes de cada lote) · `:268` (`procesarLote` → 1 rpc acotada, 9.5 s) ·
`:298` (`liberarNoIntentados` en el `finally` → 1 rpc acotada, 9.5 s).

**Escenario: entra esto → sale esto mal.** 400 viajes en la ventana
(`TOPE_VIAJES_POR_CORRIDA = 400`, `derivar.ts:52`), lotes de 50
(`TAMANO_LOTE_PROCESO = 50`, `:63`) → 8 lotes. `T_j = 9.5` (el interruptor
tarda su techo) ⇒ `venceEn = 9.5 + 45.0 = 54.5 s`. El lote 6 pasa el chequeo de
`:263` en el milisegundo 54.4 y `procesarLote` se lleva su techo: termina en
**64.0 s**. Después, y sin que nadie mire la hora: `liberarNoIntentados`
(**73.5 s**) y `registrarLatido` (**83.0 s**). **83.0 contra 60 → +23.0 s.**
Con `T_j = 0` la suma sigue siendo **73.5 contra 60**: el exceso **no depende**
del prólogo, está en la aritmética del margen — la cola son 19.0 s y el margen
reserva 15.0 s para la cola *más* el lote.

**Consecuencia para alguien real.** El registro de jornada es una obligación
laboral con expediente (los `sinAvisoPrevio` de la LFPDPPP viajan en ese mismo
latido, `route.ts:97`). Al morir en la cola: los claims de los lotes no
intentados quedan arrendados hasta que expire el lease (180 s,
`derivar.ts:60` — se recupera, pero la corrida es horaria) y **el latido no se
escribe**, así que `/admin/crons` no puede distinguir «la jornada se derivó
parcial» de «el cron de jornada lleva horas muerto». El motor SÍ cuenta el corte
(`cortadosPorReloj`) y SÍ sabe decir `parcial` — y esa es exactamente la fila
que se pierde.

**Causa raíz probable:** `maxDuration - 10` es un literal tecleado, el único de
los seis crons con reloj que no pasa por `margenUnidadAtomicaMs`; nadie sumó la
unidad (9.5) con la cola (19.0) contra los 15.0 que reserva.

---

### [ALTO] REN-32C2-A2 · `cron/portales-vivos` suma 154.2 s contra `maxDuration = 120`, y lo que se pierde es el correo semanal de portales rotos — NUEVO

`src/app/api/cron/portales-vivos/route.ts:69`
(`const MARGEN_MS = 15_000`, literal) · `:104`
(`const venceEn = Date.now() + (maxDuration * 1000 - MARGEN_MS)`, anclado
**después** de `puertaCron` en `:72` y de `leerInterruptor` en `:78`) · `:144`
(`alertarOperador`, 6.2 s) · `:155` (`registrarLatido`, 9.5 s) ·
`src/lib/likida/facturacion/portales_vivos.ts:299` (el único chequeo de reloj,
antes de cada portal) · `:304` y `:309` (**dos** `revisarPortal` por portal: la
refutación obligatoria de un portal roto) · `:97` (`TOPE_MS = 12_000`).

**Escenario: entra esto → sale esto mal.** Lunes 06:40. `T_p = 9.5`
(interruptor en su techo) ⇒ `venceEn = 114.5 s`. El portal de PASE pasa el
chequeo de `:299` en el milisegundo 114.4. Su primera lectura agota los 12.0 s
del `AbortController` (`portales_vivos.ts:168`), sale `no_responde`, es «roto y no es DNS» ⇒
`:309` lo vuelve a medir: otros **12.0 s**. La unidad atómica de este cron son
**24.0 s** y el margen reserva **15.0**. Fin del portal: **138.5 s**. Después
`alertarOperador` (**144.7 s**) y `registrarLatido` (**154.2 s**).
**154.2 contra 120 → +34.2 s.** Con `T_p = 0`: **144.7 contra 120**.

**Consecuencia para alguien real.** Vercel corta durante la segunda medición o
durante el correo. El único efecto útil de este cron —el correo que dice
«N portales de facturación rotos», con la evidencia para que alguien escriba la
URL nueva a mano— **no sale**, y el modo de falla que lo dispara (un portal
caído) es precisamente el que hace la corrida más lenta. Y como corre **una vez
por semana** (`vercel.json`, `40 6 * * 1`), el latido perdido hace que
`/api/health` lo declare MUERTO a los 7 días sin poder distinguirlo de
«apagado» — que es el escenario que el comentario de `:96-98` dice estar
evitando.

**Causa raíz probable:** el margen es un literal de 15 s copiado del molde y
nadie contó que la unidad atómica de este cron son **dos** mediciones de 12 s,
no una: la refutación se añadió después del margen.

---

### [ALTO] REN-32C2-A3 · `encolarOtraVuelta` publica a QStash sin tope y con los 5 reintentos por defecto del SDK: hasta 1,804 s dentro de una ruta de 120 — NUEVO

`src/app/api/cron/wa-pendientes/drenado.ts:281`
(`new QstashClient({ token, baseUrl })` — sin `retry`) · `:285`
(`await q.publishJSON({...})` — sin `AbortSignal`, sin `conTope`), contra el
hermano que sí lo acota: `src/app/api/cron/facturar/route.ts:451`
(`await conTope(q.publishJSON({...}), TOPE_PUBLICACION_MS, 'qstash.publish')`)
y `:199` (`TOPE_PUBLICACION_MS = 10_000`). El default del SDK está en
`node_modules/@upstash/qstash/chunk-JYPXGFWX.mjs:1401`
(`attempts: config.retry?.retries ?? 5`), el bucle en `:1446-1460`, y el
`requestOptions` de `:1475-1480` **no lleva `signal`** — el `fetch` hereda el
default de undici que este repo contabiliza en **300 s**
(`presupuesto.ts:55-60`).

**Escenario: entra esto → sale esto mal.** Backlog en la bandeja, la vuelta
reclama trabajo, `backlogDespues = true` y hay token de QStash. Upstash acepta
el socket y no contesta (el modo de falla que `presupuesto.ts:55` documenta
palabra por palabra). El `fetch` bloquea 300 s; el SDK espera
`Math.exp(0)*50 = 50 ms` y reintenta; luego 136, 369, 1,004 y 2,730 ms. Seis
intentos: **6 × 300 + 4.3 = 1,804.3 s** dentro de una ruta cuyo `maxDuration` es
**120** (`route.ts:13`). Ya el **primer** intento (300 s) se pasa solo. El
`timeout: 120` que viaja en el cuerpo (`:291`) es el plazo que QStash le dará al
CALLBACK, no a esta publicación — el comentario de la 31 ya lo decía, el conteo
de los reintentos no lo tenía nadie.

**Consecuencia para alguien real.** La invocación muere ahí: no se escribe
`registrarLatido` (`:254`) del cron que corre **cada minuto**, no se consulta
`cartasMuertas()` (`:241`) —las fotos de chofer que agotaron sus 5 intentos
dejan de gritar—, y la cadena de QStash no se publica, así que el caudal cae de
800 mensajes por cadena a 40 por minuto **justo cuando hay backlog**. El mismo
proveedor, en la misma invocación, ya tiene su tope: `alertarOperador` le pone
1.2 s a Redis de Upstash (`alerta.ts:61`). Aquí no hay ninguno.

**Causa raíz probable:** `conTope` es una función **local** de
`cron/facturar/route.ts` (`:205`) en vez de vivir en `presupuesto.ts` junto a
`acotada`; el segundo llamador de QStash se escribió sin ella y ningún guardia
lo mira, porque las pruebas de techo escanean `acotada(supabaseAdmin()` y este
no es un viaje a Supabase.

---

### [ALTO] REN-31C-A1 · REINCIDENTE en dos tercios: `asistencia` cerró el ancla pero declara 8 consultas sobre una cadena de 10 (135.2/120); `gps` y `descarga-sat` no recibieron el arreglo (314.0/300 y 323.5/300)

**Lo que SÍ cerró, y es real:** `src/app/api/cron/asistencia/route.ts:42`
(`const entrada = Date.now()` como primera sentencia de `GET`) y `:89`
(`const venceEn = entrada + maxDuration * 1000 - MARGEN_MS`) — el reloj ya no se
regala el prólogo. Y `route.ts:88` lo cubre con
`EXTRA_LATIDO_MS = TECHO_PASO_CONSULTA_MS − COLCHON_LATIDO_CRON_MS`
(`asistencia_escalamiento.ts:68`), o sea que el latido ya se cuenta a 9.5 s y no
a 5.0. Con eso el peor caso bajó de **158.7 → 135.2 s**.

**Lo que NO cerró.** `route.ts:88` declara
`margenUnidadAtomicaMs({ consultas: 8, envios: 2, ... })` y el comentario de
`route.test.ts:138-151` enumera los ocho eslabones a mano. **Dos de esos ocho
eslabones son dos consultas cada uno:**

- `leerConfigCobranza` (`asistencia_escalamiento.ts:295`) hace
  `acotada(... 'cobranza.config')` en `agentes/cobranza.ts:46` **y**
  `getPerfilCrudo(tenantId)` en `:72`, que es otra `acotada`
  (`repo.ts:111-115`).
- `telefonoJefeDe` (`asistencia_escalamiento.ts:350`) llama `telefonosJefe`
  (`contactos.ts:202-213`, 1 página) **y** `ordenesAvisoDe` (`:215` →
  `:263-266`, `'telefonosJefe.perfil'`).

**Escenario: entra esto → sale esto mal.** Incidencia ámbar con lesionados,
dentro de ventana, `objetivo = 4`, dueño sin teléfono.
`MARGEN_MS = 8×9.5 + 2×10 + 4.5 + 5 = 105.5 s` ⇒ `venceEn = entrada + 14.5 s`.
Una escalada admitida en `14.5`: 10 consultas × 9.5 = **95.0**, `sendButtons`
**10.0** (`:360`), `alertarOperador` **6.2** (`:368`; no sale por WhatsApp —
`alerta.ts` no deja pasar `asistencia.escalamiento`), `registrarLatido`
**9.5**. **14.5 + 111.2 + 9.5 = 135.2 s contra 120 → +15.2 s.** El propio
comentario de `route.ts:85` afirma «el peor caso queda en 120.0 s exactos»:
incluso con su conteo la holgura declarada es **cero**, así que las dos
consultas no contadas caen enteras del otro lado.

**`gps` y `descarga-sat` no fueron tocados.** `gps/route.ts:110` sigue anclando
`Date.now()` después de `puertaCron` (`:86`) y `leerInterruptor` (`:89`):
`9.5 + 190.5 + 104.5 + 9.5 = 314.0 s` contra 300, y **320.2** si la corrida
tiene DLQ que alertar (`:202`). `descarga-sat/route.ts:107` lo ancla después de
**dos** interruptores (`:49-51`, hasta 19.0 s):
`19.0 + 256.5 + 38.5 + 9.5 = 323.5 s` contra 300.

**Consecuencia para alguien real.** Lo que muere es la cola: en asistencia, la
fila `escalada` de `incidencia_evento` (`:376`) —el documento que en un
siniestro prueba que el aviso salió— y el latido. En gps y descarga-sat, el
latido de dos crons que corren cada 5 minutos y cada 6 horas. El WhatsApp de la
emergencia sí sale; el expediente no.

**Causa raíz probable:** la cuenta de eslabones se hace leyendo los `await` del
archivo del motor, no los viajes de red que cada uno provoca; y el guardia que
existe (`asistencia_escalamiento.test.ts:370-379`) solo lee **un** archivo con
`readFileSync`, así que una función de otro módulo que hace dos consultas pasa
como una.

---

### [ALTO] REN-31C-A3 · REINCIDENTE · el reloj de 25 s del barrido de peajes sigue sin cubrir su prólogo: hasta 100 páginas de `gasto` antes del primer `Date.now()`

`src/lib/likida/intake/consolidado.ts:768` (`venceEn`), `:774-779`
(`barrido.lineas_pendientes`), `:797-801` (`barrido.cfdi_xml`), `:817-827`
(`traerTodo` de `barrido.candidatos_gasto`, todavía por `range()` posicional)
contra `:860`, que sigue siendo el **primer y único** `Date.now() > venceEn` de
la función. `src/app/dashboard/agentes/peajes/page.tsx:234`
(`venceEn: ahoraMs() + 25_000`).

**Escenario: entra esto → sale esto mal.** Idéntico al de la 31 y sin un
carácter de diferencia en el código: una flota con ≥ 99,000 gastos sin
`cfdi_uuid` en el rango paga **100 × 0.3 = 30.0 s** de prólogo contra un reloj
de **25.0 s**, así que el corte de `:860` dispara en la primera vuelta
**siempre**: `revisadas = 0`, `cortadosPorReloj = 1000`. Cada re-ejecución
vuelve a pagar el prólogo entero; el botón no avanza una sola línea por muchos
clics que reciba. A techos el prólogo son **950 s**, y ahí no hay reloj que
corte.

**Consecuencia para alguien real.** El contralor aprieta «Ejecutar ahora» y —
gracias al arreglo que sí entró, ver abajo — ahora lee la verdad («no alcancé a
revisar ninguna: quedaron 1,000 fuera por tiempo»), pero el consejo que esa
misma frase le da —«vuelve a ejecutar para seguir donde se quedó»— **es falso**
en este caso: no hay número de clics que lo resuelva, y cada intento cuesta
otras 100 lecturas de página de `gasto`.

**Causa raíz probable:** el corte se puso donde está el efecto irreversible (el
sello de `ligarLineaAGasto`) y el tramo que consume el presupuesto —la lectura
paginada previa— quedó fuera del reloj. Misma forma que REN-30-C2, en el otro
llamador del mismo patrón.

---

### [MEDIO] REN-32C2-M1 · La 0359 (y la 0358) le meten un **tercer** Sort de todo el juego de filas a las dos funciones fiscales: +47 % de temp por llamada en el panel del contralor, ×4 llamadas por carga de página — NUEVO, medido

`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:138-150` (el CTE
`con_emisor_del_grupo`, `select bc.*` + `min(...) over (partition by
unaccent(lower(concepto)), coalesce(folio_norm, folio), monto)`) y `:161-168`
(el `row_number()` que consume `rfc_emisor_del_grupo` **dentro de su propio
`partition by`**). Mismo patrón en
`supabase/migrations/0358_dedup_emisor_conocido.sql:72-84` y `:96-103`.
Llamadores: `src/lib/likida/fiscal.ts:1652` (la RPC, envuelta en `acotada` ⇒
techo duro de **8.0 s**, `presupuesto.ts:76`) · `:1745-1747`
(`getGastosFiscalesSeries` dispara **tres** más en paralelo, una de ellas con
`desde`/`hasta` en `null`, o sea la tabla entera del tenant) ·
`src/app/dashboard/inicio-contenido.tsx:134,138` y
`src/app/dashboard/contador/inicio-contador.tsx:103,107` (las dos pantallas que
disparan las cuatro juntas).

**Escenario: entra esto → sale esto mal.** Medido, no estimado: Postgres 16.13,
las **336** migraciones aplicadas sobre base virgen con el andamio de
`ci-postgres.yml`, un tenant con **200,000** gastos de 2026 (`ocr_extra` con
6 renglones, como los que escribe el OCR), `work_mem = 4MB`.

```
gastos_fiscales_agregados_tenant, ejercicio completo
  0355 (ayer):  4.98 s · temp read 94,301 blk (736 MB) · 2 external merges (164,944 kB + paralelo)
  0359 (hoy):   5.77 s · temp read 138,714 blk (1,084 MB) · 3 external merges
                         (172,408 kB + 170,104 kB NUEVO + paralelo)
  → +16 % de pared, +47 % de temp, +347 MB por llamada

sumar_combustible_ejercicio, mismo tenant
  0349: 0.218 s · temp read 796 blk
  0358: 0.375 s · temp read 1,701 blk      → +72 % de pared, +114 % de temp
```

El plan lo dice literalmente: el Sort nuevo de **170,104 kB** es **serial** —el
de la 0355 corría bajo `Gather Merge` con 2 workers— y arrastra la fila ancha
completa (`bc.*`, `ocr_extra` incluido) porque `select bc.*` la propaga.
`/dashboard` dispara **cuatro** de estas llamadas a la vez: en paralelo, medido,
**5.37 s → 6.05 s** de pared y ~4 GB de temp donde había ~2.9 GB.

**Sobre la pregunta del índice, explícitamente:** el predicado nuevo **no**
impide ningún índice. El `WHERE` no se tocó en ninguna de las tres migraciones y
el plan es `Parallel Seq Scan on gasto` antes y después — que es lo correcto
para un tenant que es toda la tabla. Lo que el emisor rompe es **la
compartición de sorts entre ventanas**: `rfc_emisor_del_grupo` es la salida de
una función de ventana usada en el `partition by` de otra, así que Postgres no
puede resolverlas en el mismo `WindowAgg` ni reusar el orden, y se ve obligado a
materializar un nivel de subconsulta extra con su propio `external merge`.

**Consecuencia para alguien real.** Hoy no falla: 5.77 s de un techo de 8.0 s.
Pero el acantilado se movió **14 % más cerca** — por interpolación lineal sobre
las dos medidas, de ~321,000 a ~277,000 gastos por ejercicio — y cuando
`acotada` dispare, `getGastosFiscales` lanza (`fiscal.ts:1674`) y
`getGastosFiscalesSeries` falla **en bloque** a propósito (`:1749-1755`): el
panel fiscal del contralor se apaga entero, no se degrada. Y el gasto de E/S
temporal es dinero real en Supabase: ~4 GB de escritura a disco por cada carga
de `/dashboard` de una flota grande.

**Causa raíz probable:** la 0359 declara en su cabecera que se portó el cuerpo
«tal como lo devuelve `pg_get_functiondef`, con un solo cambio textual» — y ese
cambio textual es, en el plan, un nivel de ventana más. La corrección semántica
es la correcta (las cuatro direcciones quedan iguales en las dos pantallas); lo
que nadie miró es que un `min() over` alimentando el `partition by` de un
`row_number() over` cuesta un Sort completo del juego ancho de filas.

---

### Los abiertos que cerraron de verdad — verificados uno por uno

| ID | Veredicto | Evidencia de hoy |
|---|---|---|
| **REN-31C-C1** (CRÍTICO) — «No había nada pendiente que barrer» sobre una cola de 1,000 | **CERRADO** | `peajes/controles.tsx:75` es hoy `r.revisadas === 0 && r.cortadosPorReloj === 0`, y `:78-84` es la rama nueva que imprime «No alcancé a revisar ninguna en esta pasada: quedaron N líneas pendientes fuera por tiempo». La tupla `{revisadas: 0, cortadosPorReloj: 1000}` ya no puede producir el rótulo falso. |
| **REN-31C-A4** (ALTO) — la bitácora escribe `ok` y `0/0` | **CERRADO** | `peajes/page.tsx:243` (`estado: resumen.cortadosPorReloj > 0 ? 'parcial' : 'ok'`) y `:248` (`tareasTotal: resumen.revisadas + resumen.cortadosPorReloj`). La ficha de corridas ya no puede pintar verde «0/0» sobre un barrido cortado. |
| **REN-31C-A2** (ALTO) — `leerConfigCobranza` sin `acotada()` | **CERRADO en su modo de falla** | `agentes/cobranza.ts:46` ahora es `await acotada(...'cobranza.config')`, y `:72` (`getPerfilCrudo`) ya venía acotada desde `repo.ts:111`. Ninguna consulta de la cadena hereda los 300 s de undici. **Lo que NO cerró es el conteo**, y vive arriba en REN-31C-A1: son 2 consultas, no 1. |
| **REN-30-C1** (CRÍTICO) — el bucle de peajes, 914 s sin reloj | **CERRADO en el bucle** | `consolidado.ts:860-864` corta antes de tocar la línea y `:768` conserva el infinito para quien no pasa reloj. El **prólogo** sigue fuera y es REN-31C-A3. |

### Los demás reincidentes, reverificados contra el fuente de hoy

| ID | Veredicto | Evidencia |
|---|---|---|
| **REN-31-A1** (ALTO) — el drenado presta el presupuesto entero al mensaje | **REINCIDENTE** | `drenado.ts:142` sigue pasando `inicioInvocacionMs`; `presupuesto.ts:268` sigue en `PRESUPUESTO_WEBHOOK_MS = 120_000`; la cola sigue en `:201, 217, 241, 254`. **158.0 contra 120**, más lo de REN-32C2-A3. |
| **REN-31-A2** (ALTO) — el chat escribe el costo antes de entregar la respuesta | **REINCIDENTE** | `dashboard/chat/route.ts:34` sigue en `maxDuration = 60`, `:129` y `:159` siguen siendo dos `registrarCosto` antes de la entrega. **106.5 contra 60**. |
| **REN-30-A1** (ALTO) — la copia de `candidatos_gasto` en `range()` | **REINCIDENTE** | `consolidado.ts:817-827` sigue con `traerTodo` + `.order('id').range(d, h)` mientras `:342-356` ya es keyset. |
| **REN-30-M2** (MEDIO) — `traerTodoDesdeId` devuelve lectura corta en silencio | **REINCIDENTE** | `pg.ts:259-273` verbatim. |
| **REN-30-M3** (MEDIO) — `copiloto` y `runner` reservan techo y no escriben costo | **REINCIDENTE** | `grep -rl "registrarCosto("` sobre `src/` sigue sin `copiloto.ts` ni `agentes/runner.ts`. |
| **REN-30-M1** (MEDIO) — el keyset sin índice que cubra su predicado | **REFUTADO como problema de índice** | Con Postgres real y 200,000 filas, el plan de `candidatos_gasto` es `Parallel Seq Scan` y **debe serlo**: el filtro es el tenant entero. `gasto_tenant_fecha_idx` e `idx_gasto_acumulado` existen y no los elegiría ningún planificador sano con esta selectividad. Lo caro no es el acceso, son los sorts (REN-32C2-M1). |
| **REN-A1 · A2 · M1 · M2 · M3 · B1** (los 6 de la 29) | **REINCIDENTES, los 6** | `budget.ts:219` en `PISO_TOPE_TENANT_USD = 5.00`; `presupuesto.ts:268` en 120 000; `correo/entrante/route.ts` en `RESERVA_PARA_LIBERAR_MS = 3_000`; `cron/facturar/lote.ts` en `150_000`; `PASOS_CIERRE` con más renglones que docblocks. |

---

## Lo que revisé y está bien

- **Postgres real, las 336 migraciones sobre base virgen.** `initdb` como
  `postgres` + el andamio de `supabase/pruebas-aislamiento/andamio_ci.sql` +
  `supabase/migrations/*.sql` una por una: **336 aplicadas limpias**, cero
  errores. Lo de arriba sobre la 0357/0358/0359 no es deducción: es
  `EXPLAIN (ANALYZE, BUFFERS)` contra ese cluster.
- **El `WHERE` de las dos funciones fiscales no cambió y el índice tampoco.**
  `0349 → 0357 → 0358` y `0355 → 0359`: el bloque `where tenant_id = … and
  fecha between …` es idéntico carácter por carácter, y el plan es el mismo
  `Parallel Seq Scan on gasto` antes y después. La 0358 y la 0359 **no**
  invalidan ningún índice.
- **`margenUnidadAtomicaMs` sigue derivando y no copiando**
  (`presupuesto.ts:399-401`), y `EXTRA_LATIDO_MS`
  (`asistencia_escalamiento.ts:68`) es la primera vez que el colchón del latido
  se deriva de `TECHO_PASO_CONSULTA_MS` en vez de confiar en el literal de 5 s.
  El defecto de REN-31C-A1 está en el conteo de los llamadores, no en el helper.
- **`cron/facturar` sí acota su publicación a QStash** —
  `facturar/route.ts:451` con `conTope(..., 10_000)` — y es la prueba de que el
  patrón existe en el repo y de que `wa-pendientes` es la excepción, no la regla.
- **El corte del barrido de peajes va donde debe.** `consolidado.ts:857-865`:
  el chequeo está arriba de `resumen.revisadas++`, así que `ligarLineaAGasto`
  (`:881`) y el `update` de `:888` corren juntos o ninguno.
- **`cotaEntradaEnTokens` no cuenta una imagen por byte** y el audio se estima
  por duración, no por carácter (`openrouter.ts:540-594`,
  `TOKENS_POR_IMAGEN = 4_000`, `TOKENS_POR_SEGUNDO_AUDIO = 100`). El SDK sigue
  en `maxRetries: 0` con `timeout` explícito (`:52-53`), o sea una sola escalera
  de reintentos.
- **El OCR reusa la imagen ya reducida en vez de redimensionar dos veces**
  (`intake/ocr.ts:435-446`) y manda **una sola** foto al modelo de visión
  (`:452-458`, `images: [principal]`), no el fajo entero.
- **`cron/wa-outbox` y `cron/runner` siguen cabiendo** con las mismas sumas de
  la 31 (~174.5 contra 300 y `MARGEN_RELOJ_MS` derivado en `runner/route.ts:52`).
- **Las cinco pruebas de reloj del rubro están verdes** sobre el árbol tal como
  lo encontré: `npx vitest run src/app/api/cron/asistencia
  src/lib/likida/asistencia_escalamiento.test.ts
  src/lib/likida/intake/consolidado_barrido.test.ts src/lib/likida/presupuesto`
  → **5 archivos / 80 pruebas, todas pasan**. `git status --short` vacío al
  empezar y al terminar: no edité una línea de `src/` ni de `supabase/`.

---

## Lo que NO alcancé a revisar

- **El render de `controles.tsx` con la tupla nueva.** Verifiqué REN-31C-C1
  leyendo el JSX (`:75-84`), que ahora tiene tres ramas y no una. No levanté el
  preview: la condición no tiene ambigüedad, pero mirarlo sigue siendo el
  estándar de CLAUDE.md y no lo hice.
- **Hardware.** Todas las cifras de Postgres salen de este contenedor
  (PG 16.13, `work_mem = 4MB`, `shared_buffers = 256MB`, 2 workers paralelos).
  Los **cocientes** (+16 %, +47 %, +72 %, +114 %, un Sort más) son estructurales
  y se leen del plan; los **absolutos** (5.77 s, el acantilado en ~277,000
  gastos) dependen de la instancia de Supabase y no los medí ahí.
- **`ocr_extra` real.** Generé filas con 6 renglones (~400 B). Si el OCR de
  producción escribe más, el Sort nuevo —que arrastra `bc.*` completo— cuesta
  proporcionalmente más, no menos.
- **`cron/escalar` y `cron/purgar`.** Los dos tienen reloj
  (`escalar/route.ts:224-337` reparte tres ventanas, `purgar/route.ts:263` usa
  `MARGEN_FINAL_MS = 15_000`) y no los sumé eslabón por eslabón. Dado lo que
  encontré en `jornada` y `portales-vivos`, **asumir que caben sería exactamente
  el error que esta ronda está corrigiendo**: quedan como deuda explícita de la
  siguiente.
- **Cuántas llamadas de modelo gasta una liquidación de punta a punta.** Abierto
  desde la 27, sin moverse. El costo por operación del rubro sigue sin estar
  medido de punta a punta, y por eso solo, la nota no podría pasar de 6.
- **El default real de `maxDuration` de una Server Action.** Sigue sin bloque
  `functions` en `vercel.json` y sin `maxDuration` en ningún `page.tsx`. Uso
  300 s como techo del «Ejecutar ahora» de Peajes; si fuera menor, REN-31C-A3
  es peor.
- **La suite completa.** Corrí 5 archivos / 80 pruebas del rubro y ningún
  `npm run build` (prohibido por el MAPA). No corrí `tsc` ni `lint`: no toqué
  código.
