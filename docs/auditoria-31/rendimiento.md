# Rendimiento y costo — auditoría 31

**Nota: 4/10** (antes 5). Razón del movimiento: **mirada más profunda — el
código no cambió y la nota anterior estaba inflada**. La ventana no trajo una
sola línea de `src/` (MAPA §"NO ENTRÓ CÓDIGO"), así que verifiqué los 13
abiertos —los 7 de la 30 y los 6 de la 29 que ese archivo enumera— y **los 13
siguen, línea por línea**. Lo que baja la nota no es eso: es que la 30 auditó a
fondo UNA cadena (SAT → consolidado) y dio por buenas las demás. Al contar las
otras salieron **tres techos reventados más que nadie había sumado**, uno de
ellos en el cron de emergencias. El ancla del rubro dice «4 o menos si el peor
caso excede el límite y falla callado»: hoy lo excede en **cinco** rutas
distintas y las cinco fallan calladas.

**El riesgo mayor hoy:** `cron/asistencia` —el reloj muerto de choques y
volcaduras— reserva **15 s** de margen para una unidad atómica que cuesta hasta
**81.5 s**, y esa unidad **quema el claim de escalación ANTES de mandar el
WhatsApp**. Un nivel 4 que muera ahí no se reintenta nunca: la fila sale del
índice para siempre y el dueño de la flota con un chofer lesionado no se entera.

---

## La suma del peor caso: número contra número

Todas las sumas usan los techos que el propio repo escribe:
`TECHO_PASO_CONSULTA_MS = TOPE_CONSULTA_MS (8 000) + GRACIA_TOPE_MS (1 500) =
9 500 ms` (`presupuesto.ts:76-83`), `TECHO_ENVIO_WHATSAPP_MS = 10 000`
(`presupuesto.ts:47`), `COLCHON_LATIDO_CRON_MS = 5 000` (`:366`),
`TIMEOUT_LLM_MS = 30 000` (`openrouter.ts:29`), `TIMEOUT_REDIS_MS = 1 200`
(`alerta.ts:61`), `TIMEOUT_CORREO_MS = 5 000`, nominal 0.3 s/consulta
(`presupuesto.ts:36-37`).

### 1. `cron/asistencia` — 192.7 s contra `maxDuration = 120` (NUEVO)

| tramo | archivo:línea | peor caso |
|---|---|---|
| `leerInterruptor('global')` (ancla el reloj después) | `asistencia/route.ts:40` | 9.5 s |
| `venceEn = Date.now() + (120 − 15) × 1000` | `asistencia/route.ts:58` | corta a t = 114.5 s |
| `reclamarEscalacionAsistencia` (RPC) | `asistencia_escalamiento.ts:293` | 9.5 s |
| `polizaVigenteDe` | `:299` | 9.5 s |
| `viaje.select('operador_id')` — **sin `acotada`** | `:304-305` | sin techo (undici 300 s) |
| `contactoSiLesionadosDe` | `:308` | 9.5 s |
| `telefonoDeRol('flota_admin')` | `:326` | 9.5 s |
| `telefonoJefeDe` (dueño sin teléfono) | `:328` | 9.5 s |
| `sendButtons` | `:338` | 10.0 s |
| `alertarOperador` (Redis + correo) | `:346` | 6.2 s |
| `anotarEventoIncidencia` | `:354` | 9.5 s |
| **unidad atómica** | | **81.5 s + la consulta sin techo** |

`margenUnidadAtomicaMs({ consultas: 7, envios: 1 })` = 7 × 9 500 + 10 000 +
5 000 = **81 500 ms**. El margen escrito es **15 000**. Despachada en el último
instante permitido: **114.5 + 81.5 + 6.2 = 202.2 s contra 120** (192.7 s si el
reloj se ancla en t = 0). **+72.2 s.**

### 2. `cron/wa-pendientes` — 158.0 s contra `maxDuration = 120` (NUEVO)

`drenado.ts` le pasa a `processInbound` el presupuesto del WEBHOOK
(`PRESUPUESTO_WEBHOOK_MS = 120 000`, `presupuesto.ts:268`), que reserva
`MARGEN_CIERRE_MS` **solo para el cierre del MENSAJE**. La cola del CRON, que va
después del pool, no la reserva nadie:

| tramo | archivo:línea | peor caso |
|---|---|---|
| último mensaje admitido (`restante() ≥ COSTO_MINIMO_TURNO_MS = 15 000`, `processor.ts:1476`) | `processor.ts:1475` | arranca a t = 65.4 s |
| tope del agente + cola de cierre (`MARGEN_CIERRE_MS`) | `presupuesto.ts:160` | 15.0 + 39.6 = 54.6 s → t = 120.0 s |
| `pendientesPorDrenar(1)` | `drenado.ts:201` | 9.5 s |
| `iniciarCadenaWa()` | `:217` | 9.5 s |
| `encolarOtraVuelta` → QStash `publishJSON` | `:285` | sin tope propio declarado |
| `cartasMuertas()` | `:241` | 9.5 s |
| `registrarLatido` | `:254` | 9.5 s |
| **cola del cron** | | **38.0 s** (44.2 s si hay cartas muertas) |

**65.4 + 54.6 + 38.0 = 158.0 s contra 120** → **+38.0 s.** Contraste que lo
prueba: el webhook vivo comparte el mismo presupuesto y su cola después del pool
es **una sola llamada**, `flushObservabilidad()`
(`webhook/whatsapp/route.ts:469`). La constante era honesta allá y se importó
tal cual donde ya no lo es.

### 3. `/api/dashboard/chat` — 106.5 s contra `maxDuration = 60` (NUEVO)

| tramo | archivo:línea | peor caso |
|---|---|---|
| `tenantEfectivoChat` (2 `acotada`) | `chat/tenant.ts:53`, `:71` | 19.0 s |
| `gastoChatHoyUsd` (`traerTodo`, 1ª página) | `chat/tope.ts:33` | 9.5 s |
| `ejecutarAnalista` (controller propio) | `analista.ts:368` | 40.0 s |
| `registrarCosto` por modelo (hay fallback ⇒ 2) | `chat/route.ts:129` | 19.0 s |
| `guardarIntercambio` (≥ 2 `acotada`) | `conversaciones.ts:114`, `:125` | 19.0 s |
| **total** | | **106.5 s contra 60** |

(Sin contar `getSessionTenant`, `rechazoMfaSuperadminApi` ni `rateLimit`, que
también son red.) Incluso el camino modesto —1 consulta por eslabón— da
**78.0 s contra 60**.

### 4 y 5. Los dos CRÍTICOS de la 30, recontados hoy y sin mover un segundo

- `barrerPorConciliar`: **3 047 viajes de red = 914.1 s nominales** contra un
  techo de plataforma de 300 (`consolidado.ts:749-912`, ni un `Date.now()` en
  todo el cuerpo — verificado con grep).
- `descarga-sat` + `guardarYConciliarConsolidado`: `venceEn` = 300 − 43.5 =
  **256.5 s** (`descarga-sat/route.ts:106`) + 249 viajes × 0.3 = 74.7 s =
  **331.2 s contra `maxDuration = 300`**. Idéntico a la 29 y a la 30.

### Lo contable de esta ronda

- **2 de 5** crons iterativos con reloj por unidad derivan su margen del peor
  caso de esa unidad (`gps:63`, `descarga-sat:106`, vía
  `margenUnidadAtomicaMs`). `asistencia:58` (15 s), `jornada:75` (10 s) y
  `portales-vivos:69` (15 s) siguen con literales.
- **3 de 11** rutas de cron están envueltas en la carrera de reloj duro
  (`runner`, `escalar`, y `qa/[id]/continuar` fuera de cron). Las 8 restantes
  dependen de que cada motor se acuerde de preguntar la hora.
- **0** pruebas guardan el margen de `asistencia`: `asistencia/route.test.ts` no
  menciona `venceEn`, `maxDuration` ni 15 (grep vacío). `gps` y `descarga-sat`
  sí lo comparan contra `margenUnidadAtomicaMs` en sus `route.test.ts`.
- Suite del rubro corrida hoy: `npx vitest run presupuesto pg.test lotes
  openrouter asistencia_escal drenado` → **21 archivos / 176 pruebas, todas
  pasan**. Ninguna de ellas falla por lo de arriba.

---

## Hallazgos

### REN-31-C1 · [CRÍTICO] El cron de emergencias reserva 15 s para una unidad de 81.5 s, y la unidad quema el claim de escalación ANTES de mandar el WhatsApp: un nivel 4 que muere ahí no se reintenta nunca

`src/app/api/cron/asistencia/route.ts:15` (`maxDuration = 120`), `:58`
(`const venceEn = Date.now() + (maxDuration - 15) * 1000`) contra
`src/lib/likida/asistencia_escalamiento.ts:228` (el único chequeo de reloj, y
está FUERA de `escalarUna`), `:293` (`reclamarEscalacionAsistencia`, que escribe
`nivel_escalado = objetivo`), `:299`, `:304-305`, `:308`, `:326`, `:328`, `:338`
(`sendButtons`), `:346` (`alertarOperador`), `:354`
(`anotarEventoIncidencia`), y `:220` (`.lt('nivel_escalado', NIVEL_MAXIMO)` en
la consulta que alimenta el barrido), `:45` (`NIVEL_MAXIMO = 4`).

**Escenario: entra esto → sale esto mal.** Volcadura con lesionados, prioridad
`critica`, 20 minutos sin que nadie reconozca → `nivelObjetivo` (`:94-98`)
devuelve 4. La corrida de las :05 lista la incidencia y la despacha a las
114.4 s de invocación (el reloj de `:228` todavía deja pasar: `venceEn` cae en
114.5 s, y son 105 s de margen contados desde DESPUÉS de `leerInterruptor`, que
ya se comió hasta 9.5 s de los 120). Entonces:

- `reclamarEscalacionAsistencia` (`:293`) escribe `nivel_escalado = 4` y
  devuelve `true`. **El claim ya está quemado.**
- Vienen 6 lecturas más antes del envío: `polizaVigenteDe`, el `select` de
  `viaje`, `contactoSiLesionadosDe`, `telefonoDeRol`, `telefonoJefeDe` — a
  9.5 s cada una son 57 s, y la de `:304-305` **no está envuelta en `acotada`**,
  así que hereda el default de undici (300 s) y basta ella sola.
- Vercel mata la función. `sendButtons` (`:338`) nunca corre,
  `alertarOperador` (`:346`) nunca corre, `anotarEventoIncidencia` (`:354`)
  nunca corre, y `registrarLatido` de la ruta (`route.ts:62`) tampoco.

La corrida de las :10 vuelve a listar: la consulta de `:213-225` filtra
`.lt('nivel_escalado', NIVEL_MAXIMO)`, y la fila ya vale 4. **La incidencia
desaparece del barrido para siempre.** Con objetivo < 4 el daño es el mismo por
un ciclo distinto: `nivelObjetivo(inc) <= inc.nivelEscalado` → `'sin_cambio'`
(`:261`), y no se vuelve a intentar hasta que el reloj suba otro peldaño.

Números: unidad **81.5 s** (`margenUnidadAtomicaMs({consultas: 7, envios: 1})`)
+ 6.2 s de alerta contra un margen de **15.0 s**; margen efectivo tras el ancla,
**5.5 s**. Total peor caso **202.2 s contra `maxDuration = 120`**.

**Consecuencia para alguien real.** El dueño de la flota con un chofer lesionado
no recibe el WhatsApp, y no queda una sola fila que diga que no lo recibió: la
bitácora de la incidencia no tiene `escalada` ni `aviso_escalada_fallido`, y el
latido del cron sale «no late» sin causa. Es exactamente el silencio que el
comentario de `route.ts:17-33` dice que este cron existe para romper. El
comentario de `:11-14` («1-2 llamadas a Meta más 2-4 lecturas cortas») es el
supuesto que nunca se recontó: el camino real hace 7 lecturas, 1 envío y una
alerta.

**Causa raíz probable:** REN-A4/REN-A5 de la auditoría 28 derivaron el margen
del peor caso de la unidad en `gps` y `descarga-sat` y dejaron el literal en las
otras tres rutas iterativas; y el claim se escribe antes del envío, así que la
unidad no es idempotente respecto de su propio efecto visible.

---

### REN-31-A1 · [ALTO] El drenado de la bandeja le presta al mensaje el presupuesto ENTERO de la invocación y se queda sin los 38 s que necesita su propia cola: el latido y el reencolado son lo primero que se pierde

`src/app/api/cron/wa-pendientes/drenado.ts:141-145` (`processInbound` con
`inicioInvocacionMs: inicioInvocacion`), contra
`src/lib/likida/processor.ts:1475` (`crearPresupuesto(PRESUPUESTO_WEBHOOK_MS,
…)`) y `src/lib/likida/presupuesto.ts:268` (`PRESUPUESTO_WEBHOOK_MS =
120_000`), `:160` (`MARGEN_CIERRE_MS`, que reserva el cierre del MENSAJE y nada
más). La cola del cron: `drenado.ts:201`, `:217`, `:285`, `:241`, `:254`.
`src/app/api/cron/wa-pendientes/route.ts:13` (`maxDuration = 120`) y
`cola/route.ts:11` (el callback de QStash, mismo 120).

**Escenario: entra esto → sale esto mal.** 40 mensajes en la bandeja, pool de 5
(`drenado.ts:27,30`). `processInbound` admite trabajo nuevo mientras
`restante() ≥ 15 000` (`processor.ts:1476`), o sea hasta t = 120 000 − 39 600 −
15 000 = **65.4 s**. Cinco trabajadores arrancan un mensaje ahí; cada uno usa su
tope de agente (15 s) y su cola de cierre (`MARGEN_CIERRE_MS` = 39.6 s):
terminan en **t = 120.0 s**, que es *exactamente* `maxDuration` y por diseño.
Y entonces empieza la cola del cron: 4 consultas `acotada` a 9.5 s = **38.0 s**,
más el `publishJSON` de QStash (`:285`, con `timeout: 120` que es el del
CALLBACK, no el de la publicación) y, si hay cartas muertas, 6.2 s de alerta.
**158.0 s contra 120 → +38.0 s.** Con costos nominales cabe (96.2 s); es un
fallo de peor caso, no de todos los días.

**Consecuencia para alguien real.** Lo que se pierde es justo lo que prueba que
la corrida existió y lo que la mantiene viva: `registrarLatido` (`:254`) no se
escribe, así que `/admin/crons` pinta «no late» sin causa para el cron que corre
CADA MINUTO; `encolarOtraVuelta` (`:221`) no se publica, así que la cadena de
QStash se corta y el caudal cae de 800 mensajes por cadena a 40 por minuto justo
cuando hay backlog; `cartasMuertas()` (`:241`) no se consulta, así que las fotos
de chofer que agotaron sus 5 intentos no gritan. Las filas reclamadas quedan
arrendadas hasta que expire el lease.

**Causa raíz probable:** `PRESUPUESTO_WEBHOOK_MS` es a la vez «el `maxDuration`
de la ruta» y «lo que un mensaje puede gastar». En el webhook las dos cosas
coinciden porque después del pool solo hay un `flushObservabilidad`; el cron
reusó la constante sin restarle su propia cola.

---

### REN-31-A2 · [ALTO] La respuesta del analista se manda DESPUÉS de escribir el costo y la conversación: 106.5 s contra `maxDuration = 60`, y lo que se pierde es la respuesta ya pagada

`src/app/api/dashboard/chat/route.ts:34` (`maxDuration = 60`), `:67`
(`tenantEfectivoChat`), `:97` (`gastoChatHoyUsd`), `:122` (`ejecutarAnalista`),
`:129-134` (`registrarCosto` **dentro de un `for` por modelo**), `:137-146`
(`guardarIntercambio`) y `:150` (`manda({ t: 'fin', bloques: r.bloques, … })`,
el ÚNICO evento del stream que lleva la respuesta), contra
`src/lib/agents/analista.ts:368` (`opts.timeoutMs ?? 40_000`).

**Escenario: entra esto → sale esto mal.** El contralor pregunta «¿cuánto llevo
de diésel este mes?» en la sala. Suma a techos: `tenantEfectivoChat` 2 × 9.5 =
19.0 + `gastoChatHoyUsd` 9.5 + analista 40.0 + `registrarCosto` × 2 modelos
(hubo fallback cross-provider, que es el caso que `:126-128` documenta) 19.0 +
`guardarIntercambio` 2 × 9.5 = 19.0 → **106.5 s contra 60**. Aun con un solo
viaje de red por eslabón: **78.0 s contra 60**.

**Consecuencia para alguien real.** El stream ya mandó los eventos `paso`
(«consultando gastos…»), así que la pantalla del contralor está viva y
animándose; el evento `fin` nunca llega y la función muere. Él ve la rueda girar
hasta que el navegador se rinde. La llamada al modelo **ya se pagó** y su costo
tampoco quedó escrito (el `registrarCosto` que murió es el mismo que alimenta
`/admin/consumo` y el tope diario por tenant de `tope.ts`), así que el turno más
caro del día es el que no aparece en el contador. Es la superficie del demo.

**Causa raíz probable:** el timeout de 40 s del analista está dimensionado
contra el modelo, no contra la ruta; y el orden pone la escritura contable antes
de la entrega, al revés de lo que hace `processor.ts` con el PDF del chofer
(donde los pasos `critico` van primero, `presupuesto.ts:147-153`).

---

### REN-30-C1 · [CRÍTICO · REINCIDENTE] El «Ejecutar ahora» del Agente de Peajes: 3 047 viajes de red / 914 s nominales sin un solo chequeo de reloj, contra 300 s

`src/lib/likida/intake/consolidado.ts:749-912` — verificado hoy: **cero
`Date.now()`, cero `venceEn`, cero `relojAgotado` en todo el cuerpo**. `:760`
(`.limit(1000)`), `:795-805` (45 páginas por `range`), `:832-908` (el `for` que
recorre las 1 000 líneas `await` por `await`), `:848` (`ligarLineaAGasto`, 2
consultas), `:855-866` (el `update`, 1 más), `:894-900` (1 consulta por cada
línea que sigue pendiente). Contra
`src/app/dashboard/agentes/peajes/page.tsx:212-245`, que no exporta
`maxDuration` (ningún archivo de `src/app/dashboard` ni de `src/app/admin` lo
hace — grep vacío).

Nominal **3 047 × 0.3 = 914.1 s**; a techos 28 946 s. Contra los 300 s que es lo
máximo que cualquier ruta de este repo declara: **3.05× el límite.**

Lo que lo vuelve más caro de lo que la 30 dijo: el hermano exacto SÍ tiene
reloj. `src/app/dashboard/agentes/cobranza/page.tsx:115-117` pasa
`venceEn: ahoraMs() + 25_000` a `ejecutarCobranza` y la vista pinta
`cortadosPorReloj` (`cobranza/controles.tsx:86`). El patrón existe, está
escrito, y el botón de peajes es el único de los dos que no lo heredó.

---

### REN-30-C2 · [CRÍTICO · REINCIDENTE] A techos, `candidatosDeGasto` sola (427.5 s) excede el `maxDuration` del cron y va ANTES del único avance durable

`src/lib/likida/intake/consolidado.ts:342-356` (45 vueltas sin reloj), `:473`
(la llamada, sin `venceEn`), `:495` (`enLotes`, el primer punto que escribe algo
que sobreviva), `src/app/api/cron/descarga-sat/route.ts:13`
(`maxDuration = 300`) y `:106` (`margenUnidadAtomicaMs({consultas: 3, envios:
1})` = 43 500 ms → `venceEn` = 256.5 s).

Recontado hoy sin cambios: 256.5 + 74.7 = **331.2 s contra 300**. A techos, las
45 páginas solas son 427.5 s, así que ninguna invocación llega al primer
`ligarLineaAGasto` y el progreso por corrida es **cero filas**. Bastan **5 de
las 45 páginas** en el tope (5 × 9.5 + 40 × 0.3 = 59.5 s) para comerse los
43.5 s que quedan tras `venceEn`.

Agrego una observación que la 30 no hizo y que explica por qué muere mudo: el
mecanismo que lo salvaría **ya existe en el repo** — `conRelojDuro`
(`agentes/runner.ts:1180-1206`, copiado a `api/cron/_reloj_duro.ts:29`), la
carrera que hace que la ruta responda y lata pase lo que pase. Lo usan 3 rutas
(`cron/runner:66`, `cron/escalar:358`, `admin/qa/[id]/continuar:79`).
`descarga-sat` no, y por eso la invocación muere antes de `registrarLatido`
(`route.ts:157`).

---

### REN-30-A1 · [ALTO · REINCIDENTE] El cursor se aplicó a una de las dos copias: `barrido.candidatos_gasto` sigue en `range()`

`src/lib/likida/intake/consolidado.ts:795-805` (`traerTodo` con `.order('id')
.range(d, h)`) contra su gemela ya migrada `:342-356` (`traerTodoDesdeId` con
`.gt('id', …)`). Mismo `tenant_id` + `cfdi_uuid IS NULL` + rango de `fecha`,
misma tabla viva, mismo consumidor (`conciliarLineas`). Con G = 45 000 son 45
páginas y **1 012 500 filas descartadas** que el cursor ya no paga en la otra
copia; y el defecto de corrección sigue: una fila leída dos veces vuelve
**ambigua** una línea que era única (`:211-227` cuenta candidatos) y la manda de
vuelta a la mesa del contador con dos candidatos que son el mismo gasto.

---

### REN-30-M1 · [MEDIO · REINCIDENTE] El keyset nuevo no tiene índice que cubra su propio predicado

`src/lib/likida/intake/consolidado.ts:345-353` (`tenant_id` + `cfdi_uuid IS
NULL` + `fecha` entre dos valores + `id > cursor` + `ORDER BY id LIMIT 1000`)
contra los índices que existen: `gasto (tenant_id, id)`
(`0061_indices_de_paginacion.sql:84`) y `gasto (tenant_id, fecha)`
(`0111_indices_escala.sql:76`). Ninguno lleva `fecha` e `id` juntos, ni hay uno
parcial por `cfdi_uuid IS NULL`. Si el planeador prefiere `(tenant_id, fecha)`
—y tiene motivos, el rango de fecha es más selectivo que `id > cursor` en las
primeras páginas— son **45 × 45 000 = 2 025 000 filas ordenadas** por una
lectura de 45 000, y el cursor no compró un segundo. **No verificable sin
Postgres**; es el primer `EXPLAIN` que pediría.

---

### REN-30-M2 · [MEDIO · REINCIDENTE] `traerTodoDesdeId` devuelve una lectura corta en silencio; su docblock promete lo contrario

`src/lib/likida/pg.ts:245-246` — el docblock, palabra por palabra: «Mismo
contrato de `traerTodo`: se demuestra con el `count` EXACTO de la primera
página, o se LANZA `LecturaIncompleta` — nunca una cifra parcial.» Contra
`:267-273`: tras `if (esperadas !== null && filas.length >= esperadas) return
filas;` viene `if (pag.length === 0) { … return filas; }` **sin volver a mirar
`esperadas`**. El contraste está 60 líneas arriba en `traerTodo` (`:206-214`),
que en ese mismo caso hace `break` y lanza.

Escenario con valores: `count: 'exact'` se toma en la página 0; las 45 páginas
tardan ~13.5 s nominales y en esa ventana el camino de WhatsApp liga 2 gastos
(dejan de cumplir `cfdi_uuid IS NULL`); la última página llega vacía con
`filas.length = 44 998 < esperadas = 45 000` y la función **devuelve 44 998 como
si fueran todas**, sin log y sin excepción. El daño de hoy está acotado, pero el
siguiente llamador elegirá esta función leyendo ese docblock.

---

### REN-30-M3 · [MEDIO · REINCIDENTE] `FaseCosto` declara `copiloto` y `runner` y nadie las escribe

`src/lib/likida/costos.ts:41` (las 9 fases, con las dos nuevas) contra
`src/lib/agents/copiloto.ts:217` (`createLlmBudget(opts.budgetTenantId, runId,
'interactivo')` — reserva y liquida contra el techo diario del tenant) y
`src/lib/likida/agentes/runner.ts:765`. `grep -rl "registrarCosto("` sobre
`src/` da **6 archivos**: `dashboard/ingesta/route.ts`, `dashboard/chat/route.ts`,
`oficina_wa.ts`, `voz_transcrita.ts`, `costos.ts` y `processor.ts` — **ninguno es
copiloto ni runner**.

Un turno del copiloto corre `openai/gpt-5.6-luna` ($0.10/$0.60 por M,
`openrouter.ts:212`) con `maxToolRounds: 5` y `maxTokens: 900`
(`copiloto.ts:239-241`): del orden de **$0.005-0.012**. Come del mismo techo
diario de $5.00 de esa flota (`budget.ts:219`) y en `llm_costo` vale **$0.00
para siempre**. 50 turnos del fundador = $0.50 = el 10 % del día de esa flota =
2.7 liquidaciones de chofer que su panel de costos no puede explicar.

---

### REN-30-B1 · [BAJO · REINCIDENTE] El upsert de `cfdi_xml` reescribe el XML completo en cada reintento del consolidado

`src/lib/likida/intake/consolidado.ts:388-402` (el `upsert` con `xml: xmlText`),
alcanzado ahora en cada repetido por `ciclo.ts:341`, y **antes** del early-return
de idempotencia de `:440-443`. Un ECC12 de 1 000 líneas pesa 0.5-2 MB y se
reescribe íntegro en cada re-ingesta.

---

### Los 6 de la 29, verificados contra el fuente de hoy — los 6 REINCIDENTES

| ID | Veredicto | Evidencia de hoy |
|---|---|---|
| **REN-A1** (techo diario = piso $5.00 para los 3 planes) | REINCIDENTE | `src/lib/llm/budget.ts:219` sigue en `const PISO_TOPE_TENANT_USD = 5.00`; `topeDerivadoDelPlan` (`:271-275`) sigue con `Math.min(Math.max(derivado, piso), …)`. El cruce sigue en 811.7 viajes/mes, que ningún plan vende. |
| **REN-A2** (reentrega: 126 s sin reloj contra `maxDuration = 120`) | REINCIDENTE | `webhook/whatsapp/route.ts:117` = 120; `processor.ts:904` `COSTO_MINIMO_TURNO_MS = 15_000`; `:1134` `TECHO_REENTREGAS_POR_PROCESO = 2`, sigue siendo un contador de módulo. |
| **REN-M1** (`correo/entrante`: reserva de 3 s para una cola de 13.5 s) | REINCIDENTE | `correo/entrante/route.ts:88` `maxDuration = 60`; `:284` `RESERVA_PARA_LIBERAR_MS = 3_000`, `:285` la deriva. **70.5 s contra 60.** |
| **REN-M2** (`MARGEN_LOTE_MS` 150 s + cola sin reloj) | REINCIDENTE | `cron/facturar/lote.ts:80` sigue en `150_000`. A techos 150 + 130 + 16 × 9.5 = **432 s contra 300**. |
| **REN-M3** (los WhatsApp del aviso a la oficina no pagan su costo) | REINCIDENTE | `grep -c registrarCostoWhatsApp` da **0** en `src/lib/likida/avisar_cierre.ts` y **0** en `src/lib/meta/aviso_oficina.ts`. $0.016-$0.024 por liquidación fuera de `llm_costo`: 8.7-13 % bajo sobre $0.1848. |
| **REN-B1** (`PASOS_CIERRE` en 20 renglones con docblocks de 18) | REINCIDENTE | Conté los renglones de `presupuesto.ts:87-119`: **20**. Y los tres docblocks que los describen siguen desfasados: `:125-127` dice «los 18 pasos… Suma ~173 s» cuando `TECHO_CIERRE_MS` recalculado hoy da **192.5 s**; `:122` dice «14.0 s» cuando `COSTO_CIERRE_MS` da **14.6 s**; `:149` dice «39.0 s» cuando `MARGEN_CIERRE_MS` da **39.6 s**. La tabla es verdad; su prosa ya no. |

---

## Lo que revisé y está bien

- **El reloj duro del runner es el mecanismo correcto y está probado.**
  `agentes/runner.ts:1180-1206`: la ruta espera la CARRERA entre la vuelta y el
  reloj, no la vuelta (`cron/runner/route.ts:66-70`), con `avance` para que el
  corte no sea mudo (`:65`). `MARGEN_RELOJ_MS = 30_000` (`runner.ts:355`) está
  DERIVADO de `PASOS_LATIDO` (`:335-343`, suma 25.2 s) y `runner.test.ts`
  compara las dos cifras. Es el único margen del repo que cubre su propia cola
  con holgura escrita.
- **El OCR no manda la foto sin redimensionar, y no la redimensiona dos veces.**
  `intake/ocr.ts:435-446` reusa la `reducida` que `decodificarCodigosYReducir`
  ya calculó (`cfdi_imagen.ts:144-145`, `ANCHO_PRINCIPAL_PX = 1600`) y solo cae
  a `redimensionarParaVision` si no quedó ninguna. La pasada de 1 000 px sale
  del original a propósito (`cfdi_imagen.ts:138-141`) y está justificada con un
  caso medido.
- **La cota de reserva no cuenta una imagen por byte.** `openrouter.ts:568-591`:
  `cotaEntradaEnTokens` sustituye el data-URL por `''` y suma
  `TOKENS_POR_IMAGEN = 4 000`; el audio se estima por duración
  (`tokensPorAudioBase64`, `:560-564`) y no por bytes. Es el arreglo que evita
  que una foto de 3 MB pida $0.75 contra un techo de $0.50.
- **El SDK no reintenta por su cuenta.** `openrouter.ts:52-53`:
  `maxRetries: 0` + `timeout: TIMEOUT_LLM_MS`. La escalera de reintentos vive en
  una sola capa (`:787-825`) y su peor caso —4 × 30 s = 120 s— está DECLARADO y
  usado como constante donde importa (`qa/fotos/ocr/route.ts:71`,
  `PEOR_CASO_UNA_FOTO_MS = 4 * TIMEOUT_LLM_MS`, con
  `PRESUPUESTO_MS = 300 000 − 120 000 − 10 000`). Ese es el ejemplo de cómo se
  hace bien.
- **`/api/admin/qa/fotos/ocr` llama al OCR sin `signal` A PROPÓSITO y lo
  argumenta** (`:185-190`): abortar a medias deja un costo cobrado que el
  proveedor no reporta. El corte lo hace el bucle entre fotos (`:151-154`).
- **`cron/wa-outbox` no tiene reloj pero SÍ cabe.** `route.ts:125` reclama 25
  (`wa_outbox.ts:125`, `limite = 25`), `conPool(…, 4, …)` (`:128`): 7 tandas ×
  (fetch 10 s + `finalizarSalidaWhatsApp` 9.5 s) = 136.5 s, + reconciliar +
  purgar + reclamar + latido = **~174.5 s contra `maxDuration = 300`**. Y el
  lease (`WA_OUTBOX_LEASE_SECONDS = 450`, `:63`) está derivado de ese 300 con
  1.5× y hay prueba que lee el fuente para que no se desalineen.
- **`cron/jornada` acota bien.** `jornada/route.ts:75` toma
  `min(PLAZO_DERIVACION_MS, (60 − 10) × 1000)` y `derivar.ts:262` vuelve a mirar
  el reloj antes de CADA lote, con `finally` que libera los claims no
  intentados (`:288-299`). Un lote es UNA RPC, no N consultas.
- **El copiloto y el analista sí acotan su propia llamada.**
  `copiloto.ts:236-237` y `analista.ts:368-369` arman un `AbortController` de
  40 s combinado con la señal del llamador; las dos llamadas del analista
  (`:380` y `:447`) comparten ESA señal, así que el ciclo entero cabe en 40 s.
- **`margenUnidadAtomicaMs` sigue derivando y no copiando** (`presupuesto.ts:399-401`),
  y las dos sumas que usa siguen cerrando: `gps` 190.5 + 104.5 = 295.0 s y
  `descarga-sat` camino `casado` 256.5 + 38.0 = 294.5 s, las dos contra 300.
- **No existe `src/lib/queue/`** (verificado con `find`): la deuda de cola sigue
  siendo `wa_outbox` + la bandeja durable. Sin cambios que auditar.

---

## Lo que NO alcancé a revisar

- **El `EXPLAIN` real de las dos `candidatos_gasto`** (REN-30-M1). Sin Postgres
  no se mide, y decide si el cursor compró tiempo o solo corrección.
- **Si `alertarOperador` puede tardar más de los 6.2 s que le asigné.** Conté
  `TIMEOUT_REDIS_MS` (1 200) + `TIMEOUT_CORREO_MS` (5 000); no seguí el camino
  cuando Redis no está configurado y el piso cae a la base.
- **Los 6 helpers de `escalarUna` cuentan 1 viaje de red cada uno en mi suma.**
  `polizaVigenteDe`, `contactoSiLesionadosDe` y `reclamarEscalacionAsistencia`
  tienen más de un `from(`/`rpc(` en su cuerpo; si alguno hace dos en serie, la
  unidad de REN-31-C1 es MÁS cara que 81.5 s, nunca menos.
- **El default real de `maxDuration` de una server action.** `vercel.json` no
  trae bloque `functions` y ningún `page.tsx` declara `maxDuration`. Uso 300 s
  como techo porque es el máximo que cualquier ruta de este repo declara; si el
  default fuera menor, REN-30-C1 es peor, no mejor. No hay red para preguntarle
  a Vercel.
- **Cuántas líneas trae un ECC mensual real y en qué posición cae dentro del
  paquete del SAT.** Sigue siendo el supuesto declarado de 1 000
  (`consolidado.ts:453-456`) y «miles» (`ciclo.ts:243`). Toda la aritmética de
  convergencia depende de eso.
- **Cuántas llamadas de modelo gasta una liquidación real de punta a punta.**
  Abierto desde la 27. Sin saber cuántos mensajes de TEXTO manda un chofer, no
  se sabe si $0.1848 es el costo de una liquidación o el de una conversación
  corta.
- **`npm test` completo.** Corrí solo la suite de mi rubro (21 archivos / 176
  pruebas, todas pasan). No edité código: la línea base de la ronda no la pude
  haber movido.
