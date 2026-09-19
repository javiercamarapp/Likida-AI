# Rendimiento y costo — auditoría 32, continuación 3 (19-sep-2026)

**Nota: 4/10** (antes 4). **La nota se queda.** Dos de las tres formas aplican y
se cancelan contra un ancla que es categórica («4 o menos si el peor caso excede
el límite y falla callado»):

- *Se atacó*: `fc811a0` es trabajo real y no cosmético. `LecturaCortadaPorReloj`
  (`pg.ts:84-96`) está bien construida —lanza y no devuelve el recorte—, el
  reloj es opcional para no romper a nadie, y `ciclo_flota.test.ts` es la
  primera prueba de **cableado** que este rubro ve: verifica el 4.º argumento en
  `mock.calls[0][3]`, no el motor. Una de las cuatro lecturas paginadas de la
  cadena quedó acotada.
- *Mirada más profunda*: sumé dos cadenas que **nadie había sumado nunca**
  (`cron/purgar` y `cron/escalar`, la deuda explícita que dejé anotada el 18) y
  las dos se pasan. El ancla se cumple hoy en **once** cadenas contra nueve
  ayer y ocho anteayer. Y la lectura sin reloj que REN-30-C2 describe existe
  **72 líneas más arriba** de la línea que el arreglo tocó, en el mismo archivo,
  y se alcanza en **todos** los paquetes, no solo en los consolidados.

**El riesgo mayor del rubro, hoy:** el arreglo al CRÍTICO del rubro plumbeó el
reloj a **1 de los 4 llamadores** de `guardarYConciliarConsolidado` y a **1 de
las 4 lecturas paginadas** de su cadena — y la historia de recuperación en la
que ese arreglo se apoya («la vuelta siguiente lo retoma entero») cuesta, medida,
**más que una invocación completa**.

---

## Veredicto sobre `fc811a0` (el arreglo a REN-30-C2)

### **CERRÓ A MEDIAS, y trajo algo nuevo.**

Lo que **sí** cerró, verificado línea por línea sobre el árbol de hoy:

- `pg.ts:283-292` — el chequeo va **antes** de pedir cada página, así que con el
  reloj ya vencido ni la primera consulta sale. Correcto.
- `pg.ts:84-96` — `LecturaCortadaPorReloj` **lanza** y no devuelve lo leído. El
  intercambio está bien elegido: media lista de candidatos concilia de menos y
  sella el CFDI como revisado entero. Esto es lo contrario de lo que hicieron
  dos de los tres arreglos de orquestador anteriores.
- `consolidado.ts:485` → `:342-361` → `pg.ts:271` — el cableado existe de verdad
  y `ciclo.ts:341` pasa `venceEn`. `ciclo_flota.test.ts` lo prueba en el
  argumento, no en el efecto.
- El corte cae **antes** de `enLotes` (`consolidado.ts:513`), lo atrapa
  `ciclo.ts:360` y `marcar(...'ignorado')` (`:351`) **no** se ejecuta, así que el
  comprobante queda sin sellar. La afirmación del commit se sostiene.

Lo que **no** cerró (las cuatro sumas, rehechas):

**1. La suma de la ruta sigue sin caber.** Techos del repo:
`TECHO_PASO_CONSULTA_MS = 9.5 s` (`presupuesto.ts:83`),
`margenUnidadAtomicaMs({consultas:3,envios:1}) = 3×9.5 + 1×10 + 5 = **43.5 s**`
(`presupuesto.ts:399-401`, `descarga-sat/route.ts:106`), prólogo = 2 ×
`leerInterruptor` acotado (`route.ts:49-51`) = 19.0 s — `puertaCron`
(`admin/salud.ts:80-97`) **no** hace viaje de red en el camino feliz, así que el
prólogo son 19.0 y no 28.5.

`venceEn = anclaje + 300 − 43.5 = anclaje + 256.5`. Un CFDI consolidado NUEVO
admitido en `ciclo.ts:277` a `venceEn − ε`:

| eslabón | archivo:línea | techo |
|---|---|---|
| upsert `sat_cfdi_descargado` | `ciclo.ts:305` | 9.5 |
| upsert `cfdi_xml` | `consolidado.ts:401-415` | 9.5 |
| `consolidado.lineas_existentes` (1 página, vacía) | `consolidado.ts:435-444` | 9.5 |
| `consolidado.gastos_ya_sellados` (1 página, vacía) | `consolidado.ts:469-476` | 9.5 |
| `candidatosDeGasto` | `consolidado.ts:485` | **0 — corta ✔** |
| `registrarLatido` | `route.ts:157` | 9.5 |

**19.0 + 256.5 + 38.0 + 9.5 = 323.0 s contra `maxDuration = 300` → −23.0 s.**
Antes del arreglo esta misma cadena daba 323.5 s nominales (y 950 s a techos por
las 100 páginas). El arreglo quitó la cola catastrófica y dejó el exceso
estructural **intacto**: la ruta sigue muriendo sin latido, que es el modo de
falla que REN-30-C2 describía.

**2. La misma lectura de 100 páginas está 72 líneas más arriba, sin reloj, y se
alcanza SIEMPRE.** Ver el CRÍTICO de abajo.

**3. Tres de los cuatro llamadores de producción no recibieron el reloj.** Ver
REN-32C3-A1.

**4. Dos de las tres lecturas paginadas de la propia función siguen sin reloj.**
Ver REN-32C3-A2.

Y **trajo algo nuevo**: la reanudación en la que el arreglo se apoya
explícitamente («como el corte ocurre ANTES del primer avance durable, la vuelta
siguiente lo retoma entero») cuesta, a nominales medidos, **300 s para
re-saltarse un paquete ya ingerido** contra los 256.5 s de reloj que la ruta
reparte. Ver REN-32C3-A3.

`npx vitest run src/lib/likida/pg.test.ts src/lib/likida/intake/consolidado_orquestador.test.ts src/lib/likida/sat_descarga/ciclo_flota.test.ts` → **3 archivos / 53 pruebas, verdes**. No prueba nada de lo de arriba, y por eso está aquí abajo y no arriba.

---

## Hallazgos

### [CRÍTICO] REN-32C3-C1 · `gastosSinCfdi` es la MISMA lectura de 100 páginas de `gasto`, sin reloj, 72 líneas por encima de la línea que `fc811a0` arregló — y corre en TODOS los paquetes, no solo en los consolidados

`src/lib/likida/sat_descarga/ciclo.ts:269`
(`const gastos = await gastosSinCfdi(cfg.tenantId, rango.desde, rango.hasta);` —
primera sentencia de `ingerir`, **antes** del bucle y por tanto antes del único
`Date.now() >= venceEn` de `:277`) ·
`src/lib/likida/sat_descarga/ciclo.ts:177-195` (la implementación:
`traerTodo<...>` sobre `gasto`, `.is('cfdi_uuid', null)`, `.gte/.lte('fecha',…)`,
`.order('id').range(d,h)`) · `src/lib/likida/pg.ts:45,48`
(`PAGINA = 1_000`, `MAX_PAGINAS = 100`) · `src/lib/likida/sat_descarga/ciclo.ts:648`
(`await ingerir(...)`, despachada justo después del chequeo de reloj de `:632`).

**Escenario: entra esto → sale esto mal.** El mismo del hallazgo original, sin
cambiarle un valor: una flota de 500 unidades con **99,000 gastos sin
`cfdi_uuid`** en el rango de la solicitud. El paquete pasa el chequeo de
`ciclo.ts:632` con 0.5 s de margen, se descarga, y `ingerir` **arranca por
`gastosSinCfdi`**, que pide **100 páginas** de `gasto` sin mirar la hora ni una
vez. Nominal (0.3 s/página, la medida que este rubro usa desde la 30) son
**30.0 s**; a los techos escritos del repo (9.5 s/página) son **950 s**.

**19.0 + 256.5 + 30.0 + 9.5 = 315.0 s contra `maxDuration = 300` → −15.0 s
nominales; 19.0 + 256.5 + 950 = 1,225.5 s a techos.** El margen que la ruta
reservó para esa unidad son **43.5 s** (`route.ts:106`).

Y es **peor** que el que se arregló en tres dimensiones: (a) `candidatosDeGasto`
solo corre cuando el CFDI resulta consolidado; `gastosSinCfdi` corre en **cada
paquete**, sea cual sea su contenido, hasta `MAX_PAQUETES = 3` por flota
(`ciclo.ts:58`); (b) trae la fila **ancha** —`ocr_extra` incluido
(`ciclo.ts:180`)— contra las 4 columnas de `candidatosDeGasto`; (c) usa
`traerTodo` con `range()` posicional, que es el patrón que `traerTodoDesdeId`
existe para sustituir (`pg.ts:240-266`), así que además puede duplicar o saltarse
filas mientras pagina.

**Intento de refutación, hecho:** `traerTodo` (`pg.ts:207-241`) **no acepta**
`venceEn` — el parámetro solo se le añadió a `traerTodoDesdeId`, lo dice el
propio diff. No hay caché, no hay `limit` que lo acote, y el chequeo de `:277`
está dentro del bucle que empieza *después*. No hay guardarraíl.

**Consecuencia para alguien real.** Idéntica a la del CRÍTICO que se declaró
cerrado: la invocación muere sin `registrarLatido` (`route.ts:157`) y el tablero
de Javier dice «no late» para el cron que recoge los CFDI del SAT, cada seis
horas, sin causa. Detrás en la misma vuelta va `avisarCierrePeaje`, cuyo aviso
tiene caducidad legal —el derecho a facturar casetas se extingue el último día
del mes—. Y como `bajados.push` no corre, el paquete se re-baja la vuelta
siguiente y vuelve a pagar la misma lectura de 100 páginas: el cron entra en una
noria que nunca avanza y que no se ve desde ningún tablero.

**Causa raíz probable:** el arreglo siguió la cadena
`correrFlota → guardarYConciliarConsolidado → candidatosDeGasto` y no inventarió
las **otras** lecturas paginadas del mismo trayecto; la de `ingerir:269` está
antes de la bifurcación, así que ni siquiera aparece en esa cadena.

(REINCIDENTE en sustancia: es REN-30-C2 —auditorías 29, 30, 31, 32— en el otro
llamador del mismo patrón, dentro del mismo archivo.)

---

### [ALTO] REN-32C3-A1 · `fc811a0` le pasó el reloj a 1 de los 4 llamadores de producción de `guardarYConciliarConsolidado`; los otros 3 son los que ve un humano en tiempo real, y en uno de ellos el reloj está en alcance 12 líneas más arriba

`src/lib/likida/processor.ts:1669`
(`const resumen = await guardarYConciliarConsolidado(cuenta.tenantId, xml, xmlText!);`
— tres argumentos) contra `src/lib/likida/processor.ts:1657`
(`const resumen = await ingerirRep(cuenta.tenantId, rep, xmlText, Date.now() + reloj.restante());`
— **el mismo `try`, doce líneas más arriba, el mismo reloj**, con el comentario
de `:1653-1656` explicando por qué: «un consolidado con muchos doctos ya no se
corta a la mitad sin avisar», AUDITORÍA 28 AG-C1/REN-C1) ·
`processor.ts:2027` y `:3422` (los otros dos caminos de WhatsApp, también sin
reloj) · `src/app/dashboard/agentes/peajes/page.tsx:120`
(`await guardarYConciliarConsolidado(tenantId, xml, texto)` — la subida a mano) ·
`src/lib/likida/processor.ts:1475`
(`const reloj = crearPresupuesto(PRESUPUESTO_WEBHOOK_MS, ...)`) ·
`src/app/api/webhook/whatsapp/route.ts:117` (`maxDuration = 120`).

**Escenario: entra esto → sale esto mal.** El contralor reenvía al WhatsApp de
oficina el XML del consolidado mensual de PASE. La flota tiene 99,000 gastos sin
`cfdi_uuid` en el rango de las líneas. `guardarYConciliarConsolidado` recibe
`venceEn = undefined` ⇒ `pg.ts:277` lo convierte en
`Number.POSITIVE_INFINITY` ⇒ `candidatosDeGasto` corre sus **100 páginas**
completas: **30.0 s nominales, 950 s a techos**, dentro de una ruta de **120 s**
cuyo presupuesto (`PRESUPUESTO_WEBHOOK_MS = 120_000`) el procesador ya lleva
gastado en parte. El reloj **existe, está construido y está en alcance**: es la
variable `reloj` que la línea 1657 ya usa.

**Intento de refutación, hecho:** el `try/catch` de `processor.ts:1672-1676` no
es un guardarraíl de tiempo — atrapa la excepción, no el reloj, y aquí no hay
excepción: la lectura simplemente tarda. `esConsolidado(xml)` no acota nada. Y
`peajes/page.tsx:120` es una Server Action: `vercel.json` no declara bloque
`functions` y ningún `page.tsx` declara `maxDuration`, así que su techo es el
default de la plataforma, no algo que este repo controle.

**Consecuencia para alguien real.** Vercel corta la invocación del webhook:
Meta **no recibe 200**, así que reintenta el mensaje, y el ciclo entero se repite
pagando otra vez las 100 páginas. El contralor no recibe acuse
(`mensajeConsolidadoRecibido`, `:1670`) y no sabe si su archivo entró. Es
exactamente el modo de falla que `fc811a0` dice haber cerrado, por el camino que
sí tiene una persona mirando la pantalla.

**Causa raíz probable:** el commit afirma «`candidatosDeGasto` es su único
llamador en producción» — verdad para `traerTodoDesdeId`, falsa para
`guardarYConciliarConsolidado`, que tiene cuatro. El inventario se hizo sobre la
función interna y no sobre la exportada.

---

### [ALTO] REN-32C3-A2 · Dentro de la función que `fc811a0` arregló quedan DOS lecturas paginadas más, con el mismo techo de 100 páginas y sin reloj

`src/lib/likida/intake/consolidado.ts:435-444`
(`traerTodo<{estatus}>(... 'consolidado.lineas_existentes')`) y `:469-476`
(`traerTodo<{id, cfdi_orden}>(... 'consolidado.gastos_ya_sellados')`), las dos
**por encima** de `:485` (la única que recibió `venceEn`), las dos con
`traerTodo` (`pg.ts:207`), que no admite reloj, y las dos con el mismo techo
estructural `MAX_PAGINAS × PAGINA` = 100,000 filas.

**Escenario: entra esto → sale esto mal.** Un consolidado mensual de PASE
**reenviado** —el caso que el bloque de `:421-431` existe para tratar— de una
flota de 500 unidades con 24,000 cruces en el mes, ya conciliado en una corrida
anterior. `lineas_existentes` cuenta 24,000 filas ⇒ **24 páginas**: 7.2 s
nominales, **228 s a techos**, dentro de la unidad atómica a la que la ruta le
dio **43.5 s** — y todo ello **para terminar devolviendo el resumen sin hacer
nada** (`:454-457`). El corte de `fc811a0` está 50 líneas más abajo y nunca se
alcanza en este camino.

**Intento de refutación, hecho:** el `try/catch` de `:434-452` atrapa el error de
lectura, no el tiempo. Y `traerTodo` corta por `count` exacto de la primera
página, no por reloj: con 24,000 esperadas hace las 24 páginas enteras.

**Consecuencia para alguien real.** El camino del reenvío —el que un contralor
usa cuando no está seguro de si su archivo entró— es el más caro de los tres, y
es el único que no tiene reloj. Muere igual que antes: sin latido, con Meta
reintentando.

**Causa raíz probable:** el reloj se le añadió a `traerTodoDesdeId` (el helper
nuevo) y no a `traerTodo` (el viejo), así que solo la lectura ya migrada al
keyset quedó protegida. Las dos que siguen en `range()` quedaron fuera por
accidente de qué helper usan.

---

### [ALTO] REN-32C3-A3 · La reanudación en la que `fc811a0` se apoya cuesta más que una invocación entera: 300 s nominales para re-saltarse un paquete ya ingerido

`src/lib/likida/sat_descarga/ciclo.ts:655-658` (el comentario que sostiene el
diseño: «la corrida siguiente lo re-descarga e `ingerir` retoma **barato** gracias
al sello de dedup (cada CFDI ya sellado responde "repetido" **en un solo viaje de
red**, no se re-procesa)») contra `ciclo.ts:329-343`, que para el destino
`consolidado` **no aplica esa regla**: el bloque corre «siempre, no solo cuando
es nuevo» (`:338`), así que un consolidado repetido paga, cada vuelta:
upsert del sello (`:305`) + upsert de `cfdi_xml` (`consolidado.ts:401`) +
`lineas_existentes` paginado (`consolidado.ts:435`) + `marcar` (`ciclo.ts:351`).

**Escenario: entra esto → sale esto mal.** Un paquete de PASE con **250 XML de
consolidado**, ya ingerido en la vuelta anterior y re-descargado porque
`bajados.push` no corrió (el mecanismo exacto que `fc811a0` invoca como
recuperación). Cada XML repetido: **4 viajes de red** (el mínimo, con una sola
página de líneas), a 0.3 s nominales = **1.2 s**. 250 × 1.2 = **300.0 s** contra
los **256.5 s** de reloj que la ruta reparte, y contra `maxDuration = 300`
**antes** de tocar un solo comprobante nuevo. A techos: 250 × 38.0 = **9,500 s**.

**Intento de refutación, hecho:** el chequeo de `:277` sí corre por XML y cortará
— pero eso es precisamente el problema: la vuelta siguiente vuelve a re-bajar el
paquete y vuelve a pagar los mismos 300 s de re-saltado, avanzando menos de lo
que retrocede. No hay cursor que recuerde en qué XML se quedó: el único estado es
el sello, y el sello no evita el re-trabajo para consolidados.

**Consecuencia para alguien real.** Un paquete de consolidados suficientemente
grande **nunca termina de ingerirse**: cada corrida de seis horas gasta su
invocación completa re-saltando lo ya hecho, `sinTurno` sube, el latido sale
`parcial` para siempre y `ultima_descarga_hasta` no avanza. Los CFDI de peaje de
esa flota se quedan sin entrar y el contralor cuadra a mano sin saber por qué.

**Causa raíz probable:** el sello de dedup se diseñó como checkpoint barato y
luego (REN-C1, auditoría 29) se le sacó al consolidado de esa regla para poder
reintentar la conciliación, sin volver a medir cuánto cuesta el re-salto.

---

### [ALTO] REN-32C3-A4 · `cron/purgar` suma 162.5 s contra `maxDuration = 120`, y su «reserva de 15 s» son 5.5 s reales porque se mide desde `inicio`, no desde la invocación — CADENA NUNCA SUMADA

`src/app/api/cron/purgar/route.ts:16` (`maxDuration = 120`) · `:67`
(`const MARGEN_FINAL_MS = 15_000;` — «Reserva 15 s del maxDuration para
Storage/producto/MCP y la respuesta») · `:175` (`const inicio = Date.now();`,
**después** de `puertaCron` en `:140` y de `leerInterruptor` en `:153`) · `:263`
(`const venceRetencionMs = inicio + maxDuration * 1000 - MARGEN_FINAL_MS;`) ·
`:256` (`} while (parcial && vueltas < MAX_VUELTAS && Date.now() - inicio + PLAZO_VUELTA_MS < (maxDuration - 5) * 1000);`
con `PLAZO_VUELTA_MS = 60_000` en `:60` y `MAX_VUELTAS = 3` en `:62`).

**Escenario: entra esto → sale esto mal.** Con `leerInterruptor` en su techo
acotado (9.5 s, `interruptores.ts:209-213`), `inicio` queda en el **segundo 9.5
de pared**. A partir de ahí:

| tramo | archivo:línea | cuándo termina (pared) |
|---|---|---|
| prólogo (`leerInterruptor`) | `:153` | 9.5 |
| última vuelta admitida a `elapsed = 54.999` (la guarda pide `elapsed + 60.0 < 115.0`), a su propio costo declarado de 60.0 | `:192`, `:256` | **124.5** |
| `venceRetencionMs`, el «deadline duro de la ruta» | `:263` | **114.5** |
| `borrarStorageMarcado`: cola (9.5) + 2 buckets × sello (9.5) | `storage_borrado.ts:44`, `:95` | +28.5 |
| `registrarLatido` | `:390` | +9.5 |

**9.5 + 115.0 + 38.0 = 162.5 s contra 120 → −42.5 s.** Y esa cuenta es
**conservadora**: deja fuera cinco viajes de red que **no tienen tope escrito**
—`supabaseAdmin().rpc('mantenimiento_de_datos')` (`:192`),
`supabaseAdmin().rpc(nombre)` (`:103`),
`supabaseAdmin().rpc('mantener_producto_evento')` (`:335`),
`supabaseAdmin().rpc('mantener_mcp_oauth')` (`:363`, además **sin `p_vence`**) y
`db.storage.from(bucket).remove(nombres)` (`storage_borrado.ts:81`, hasta 200
archivos por llamada)—: ninguno pasa por `acotada`, así que heredan el default de
undici que este repo contabiliza en **300 s** (`presupuesto.ts:55-60`).

Lo contable en una línea: **`venceRetencionMs` cae en el segundo 114.5 de pared,
así que la reserva que el literal declara en 15 s vale 5.5 s** — y solo
`registrarLatido` ya cuesta 9.5.

**Intento de refutación, hecho:** `PLAZO_VUELTA_MS` no acota nada, **describe**
una suposición: `mantenimiento_de_datos` recibe únicamente `p_dias_wa` (`:193`),
sin `p_vence` y sin `acotada`, así que nada impide que una vuelta dure más de los
60 s que la guarda le supone. La suma de arriba ya se pasa **concediéndole** esa
suposición.

**Consecuencia para alguien real.** Lo que se pierde es la cola: el latido
(`:390`) del cron que ejecuta las **cancelaciones ARCO** (`borrarStorageMarcado`,
`:314`) y la retención de la 0104. Un borrado de datos personales prometido en
una constancia queda sin ejecutar y sin que `/admin/crons` pueda distinguir «la
purga corrió a medias» de «la purga lleva días muerta». Es el rubro donde un
hueco no es lentitud: es un incumplimiento con evidencia escrita de haberse
prometido.

**Causa raíz probable:** el reloj se ancla en `inicio`, después del prólogo, y el
margen es un literal que nunca se derivó de la cola que dice cubrir —el repo ya
tiene el helper que lo haría (`margenUnidadAtomicaMs`), y esta ruta es de las que
no lo usan.

---

### [ALTO] REN-32C3-A5 · `cron/escalar` suma 155.7 s contra `maxDuration = 120`, y se pasa incluso con prólogo cero: su margen de 10 s cubre menos de la mitad de las tres cosas que él mismo nombra — CADENA NUNCA SUMADA

`src/app/api/cron/escalar/route.ts:18` (`maxDuration = 120`) · `:159`
(`const inicioCorrida = Date.now();`, **después** de
`leerInterruptorConReintento('global')` en `:138`) · `:183-185`
(`/** El corte duro: 10 s antes del maxDuration, que es lo que cuestan la racha
(leerLatido), el latido y la respuesta con margen. */
const venceDuro = inicioCorrida + (maxDuration - 10) * 1000;`) · `:358`
(`await conRelojDuro(correrMotores().then(...), venceDuro, ...)`) · `:387`
(`leerLatido`, `acotada` — `admin/salud.ts:115`) · `:394` (`alertarOperador`) ·
`:432` (`registrarLatido`, en el `finally`) ·
`:96-104` (`leerInterruptorConReintento`: lectura + `setTimeout 1_500` + lectura).

**Escenario: entra esto → sale esto mal.** La cola de escalación va cargada y
`correrMotores` se lleva la vuelta entera, así que el reloj duro gana
(`corteDuro = true`) — que es exactamente la rama que dispara la racha:

| eslabón | archivo:línea | techo | acumulado (pared) |
|---|---|---|---|
| `leerInterruptorConReintento('global')`: ilegible (9.5) + espera (1.5) + legible (9.5) | `:138`, `:96-104` | 20.5 | 20.5 = `inicioCorrida` |
| `conRelojDuro` hasta `venceDuro` = `inicioCorrida + 110.0` | `:185`, `:358` | 110.0 | **130.5** |
| `leerLatido('escalar')` | `:387` | 9.5 | 140.0 |
| `alertarOperador` (Redis 1.2 + Resend 5.0), en `cortesSeguidos >= 3` | `:394` | 6.2 | 146.2 |
| `registrarLatido` (`finally`) | `:432` | 9.5 | **155.7** |

**155.7 s contra 120 → −35.7 s.** Y el exceso **no depende del prólogo**: con el
interruptor legible a la primera (9.5 s) da **144.7**; con el interruptor
servido desde la caché de `interruptores.ts:201-202` (0 ms) da **135.2**. El
comentario de `:183-184` dice que los 10 s cubren «la racha (`leerLatido`), el
latido y la respuesta con margen»; a los techos del propio repo esas tres cosas
cuestan **25.2 s**. El margen es el 40 % de lo que declara cubrir.

**Intento de refutación, hecho:** `conRelojDuro` (`runner.ts:1180-1200`) **sí**
libera la ruta en `venceDuro` — es una carrera real, bien hecha, y por eso esta
cadena no es peor. El problema no es el corte: es que el instante del corte se
calcula desde un ancla tardía y con un margen menor que su propia cola. Y
`registrarLatido` en el `finally` (`:432`) es correcto, pero un `finally` no
sobrevive al hachazo de `maxDuration`.

**Consecuencia para alguien real.** Lo que se pierde es, otra vez, la prueba de
que la corrida existió — y aquí además la **alarma de segundo orden**: el aviso
«tres corridas seguidas dejaron trabajo sin hacer» (`:394-397`) es justamente lo
que avisaría a Javier de que la cadencia ya no alcanza, y muere en la misma
invocación que lo habría disparado. El contador `cortesSeguidos` vive en el
latido (`:432`), así que si el latido no se escribe, la racha **se reinicia**: la
alarma de los tres cortes seguidos es insatisfacible por construcción justo en
el escenario para el que fue escrita.

**Causa raíz probable:** `(maxDuration - 10) * 1000` es un literal tecleado; la
ruta no usa `margenUnidadAtomicaMs`, y nadie contó que la rama del corte añade
un `leerLatido` y un `alertarOperador` a la cola que el margen pretendía cubrir.

---

### Reincidentes, reverificados contra el fuente de hoy

| ID | Veredicto | Evidencia de hoy |
|---|---|---|
| **REN-32C2-A1** — `cron/jornada` **83.0 / 60** | **REINCIDENTE (2ª ronda)** | `jornada/route.ts:75` verbatim: `Math.min(PLAZO_DERIVACION_MS, (maxDuration - 10) * 1000)`. Ni una línea cambió. |
| **REN-32C2-A2** — `cron/portales-vivos` **154.2 / 120** | **REINCIDENTE (2ª ronda)** | `portales-vivos/route.ts:69` (`MARGEN_MS = 15_000`) y `:104` verbatim. |
| **REN-32C2-A3** — `encolarOtraVuelta` sin tope, **1,804 s** en una ruta de 120 | **REINCIDENTE (2ª ronda)** | `drenado.ts:281` sigue siendo `new QstashClient({token, baseUrl})` sin `retry`; `:285` sigue sin `AbortSignal` ni `conTope`. El `retries: 0` de `:288` es el reintento **del callback**, no el del SDK: el default sigue en `node_modules/@upstash/qstash/chunk-JYPXGFWX.mjs:1401` (`attempts: config.retry?.retries ?? 5`). |
| **REN-31C-A1** — `gps` **314.0 / 300**, `descarga-sat` **323.0 / 300**, `asistencia` **135.2 / 120** | **REINCIDENTE (3ª ronda)** | `gps/route.ts:110` sigue anclando después de `:86` y `:89`; `descarga-sat/route.ts:107` después de dos interruptores; `asistencia/route.ts:88` sigue declarando `consultas: 8` sobre una cadena de 10 (`cobranza.ts:46` + `:72`; `contactos.ts:211` + `:215`). |
| **REN-31C-A3** — el reloj de 25 s del barrido de peajes sin cubrir su prólogo | **REINCIDENTE (3ª ronda)** | `consolidado.ts:780` (`venceEn`) contra `:872`, que sigue siendo el **único** chequeo; el prólogo (`:790-861`, incluido el `traerTodo` de `barrido.candidatos_gasto` en `:829`) sigue fuera. Las líneas se corrieron 12 por el propio `fc811a0`; el defecto no. `peajes/page.tsx:234` sigue en `ahoraMs() + 25_000`. |
| **REN-32C2-M1** (MEDIO) — tercer Sort en las dos funciones fiscales, +47 % de temp | **REINCIDENTE (2ª ronda)** | `0358` y `0359` son las últimas migraciones; no hay 0360. Las mediciones de ayer siguen vigentes. |
| **REN-30-A1** — la copia de `candidatos_gasto` todavía en `range()` | **REINCIDENTE (4ª ronda)** | `consolidado.ts:829-839` sigue con `traerTodo` + `.order('id').range(d,h)` mientras `:347-361` ya es keyset **y ya tiene reloj** — la asimetría se ensanchó. |
| **REN-30-M2** — `traerTodoDesdeId` devuelve lectura corta en silencio | **CERRADO POR VÍA LATERAL** | `pg.ts:305-310`: la página vacía con cursor por fila es prueba válida de fin, y el camino de `LecturaIncompleta` de `:316` sigue lanzando. No aplica a `traerTodo`, que conserva su `break` de `:230`. |
| **REN-30-M3 · REN-31-A1 · REN-31-A2 · los 6 de la 29** | **REINCIDENTES** | `presupuesto.ts:268` sigue en `PRESUPUESTO_WEBHOOK_MS = 120_000`; `dashboard/chat/route.ts:34` sigue en `maxDuration = 60`; `budget.ts` sigue en `PISO_TOPE_TENANT_USD = 5.00`; `copiloto.ts` y `agentes/runner.ts` siguen sin `registrarCosto(`. |

**Cuenta del ancla, hoy: once cadenas cuyo peor caso excede su límite escrito** —
`descarga-sat` (por dos caminos distintos), `gps`, `asistencia`, `jornada`,
`portales-vivos`, `wa-pendientes`, `purgar`, `escalar`, `/api/dashboard/chat`,
el «Ejecutar ahora» de Peajes y el webhook de WhatsApp con un consolidado.

---

## Lo que revisé y está bien

- **`pg.ts:283-292` está bien puesto.** El chequeo va antes de `construir(cursor)`
  y no después, así que con el reloj ya vencido la primera consulta tampoco sale.
  Es el detalle que la mitad de los arreglos de reloj de este repo se comen.
- **El corte LANZA, y la elección es la correcta.** `pg.ts:84-96`. Verifiqué la
  cadena completa de consecuencias: el throw sube por `candidatosDeGasto`
  (`consolidado.ts:347`), salta `enLotes` (`:513`) y el `upsert` de
  `cfdi_consolidado_linea` (`:544`), lo atrapa `ciclo.ts:360` y **`marcar`
  (`:351`) no corre**. El comprobante queda sin sellar. La afirmación del commit
  se sostiene al pie de la letra.
- **`ciclo_flota.test.ts` prueba el cableado de verdad.** Declara la firma
  completa del doble para poder leer `mock.calls[0][3]`. Es la primera vez que
  este rubro ve una prueba que fallaría si el argumento se dejara de pasar.
- **`conRelojDuro` (`runner.ts:1180-1204`) es correcto.** Carrera real, con
  `Math.max(0, …)` para un `venceEn` ya pasado, y el trabajo en vuelo deja de
  quitarle a la ruta el latido. El defecto de `escalar` está en el instante que
  se le pasa, no en el helper.
- **`registrarLatido` en `finally` (`escalar/route.ts:432`)** es el patrón
  correcto y el único cron que lo tiene.
- **`margenUnidadAtomicaMs` deriva y no copia** (`presupuesto.ts:399-401`), y
  `COLCHON_LATIDO_CRON_MS = 5_000` (`:366`) está documentado como lo que es. El
  problema, en las cinco rutas que se pasan, es el **ancla** del reloj y los
  **literales** que no pasan por el helper — no el helper.
- **`cron/facturar` sí acota su publicación a QStash** (`facturar/route.ts:451`,
  `conTope(..., 10_000)`): el patrón existe y `wa-pendientes` es la excepción.
- **`storage_borrado.ts:68-75` agrupa por bucket** para no hacer una llamada por
  archivo, y `LOTE = 200` (`:26`) es un tope explícito con su razón escrita. El
  problema es el reloj de su llamador, no su forma.
- **`ocr.ts:435-446` sigue reusando la imagen ya reducida** y manda **una sola**
  foto al modelo de visión (`:452-458`). `openrouter.ts` no se toca desde
  `f623daa`: `maxRetries: 0` con `timeout` explícito (`:52-53`),
  `TOKENS_POR_IMAGEN = 4_000` y `TOKENS_POR_SEGUNDO_AUDIO = 100`
  (`:540-594`). Nada nuevo por el lado de tokens ni de imágenes.
- **`git status --short` vacío al empezar y al terminar.** No edité una línea de
  `src/` ni de `supabase/`.

---

## Lo que descarté y por qué

- **«El corte de `fc811a0` deja el `cfdi_xml` a medias.»** Falso: el upsert de
  `consolidado.ts:401-415` es `onConflict: 'tenant_id,cfdi_uuid'` e idempotente,
  y el throw ocurre después de él pero antes de cualquier escritura que dependa
  del JOIN. Re-ejecutar no corrompe nada. No es hallazgo.
- **«El `catch` de `ciclo.ts:360` convierte el corte por reloj en un bucle.»**
  Falso: tras el `continue` de `:363`, la siguiente vuelta pega con el chequeo de
  `:277` y sale con `completo: false`. No hay noria **dentro** de la invocación.
  (La noria **entre** invocaciones sí existe y es REN-32C3-A3.)
- **«El keyset de `candidatos_gasto` necesita un índice.»** Refutado ya en la c2
  con Postgres real y 200,000 filas: `Parallel Seq Scan` es el plan correcto para
  un filtro que es el tenant entero. No lo vuelvo a levantar.
- **`cron/wa-outbox`, `cron/runner` y `cron/facturar`.** Resumados con el mismo
  método; los tres caben (`runner/route.ts:52` deriva su `MARGEN_RELOJ_MS`).
- **`gasto.ocr_raw`, `politica_gasto`, `wa_mensaje_procesado`.** Trampas ya
  pisadas del `CLAUDE.md`. No se tocan.

---

## Lo que NO alcancé a revisar

- **El costo por operación, de punta a punta.** Sigue sin medirse desde la
  auditoría 27: cuántas llamadas de modelo, y de cuáles, gasta **una**
  liquidación completa. Por esto solo, la nota de este rubro no podría pasar de
  6 aunque cada cadena cupiera. Es la deuda más vieja que tengo.
- **El `maxDuration` real de una Server Action.** `vercel.json` sigue sin bloque
  `functions` y ningún `page.tsx` declara `maxDuration`. Uso 300 s como techo
  para el «Ejecutar ahora» de Peajes y para `peajes/page.tsx:120`; si el default
  de la cuenta fuera menor, REN-31C-A3 y REN-32C3-A1 son peores de lo que digo.
- **El costo real de `mantenimiento_de_datos` y `mantener_mcp_oauth`.** Son dos
  RPC sin tope de cliente y sin `p_vence`; no medí sus planes contra Postgres
  real esta ronda. Lo que afirmo de `purgar` ya se pasa **concediéndoles** el
  costo que la propia guarda les supone.
- **`prov.descargar(p)` (`ciclo.ts:641`) y `prov.verificar`.** Llamadas de red al
  PAC que no aparecen en ninguna suma de este rubro, en ninguna ronda. No tienen
  tope visible desde aquí. Deuda explícita para la siguiente.
- **El render.** No levanté ningún preview: este rubro no tocó pantalla esta
  ronda. `npm run build` está prohibido por el MAPA.
- **La suite completa.** Corrí 3 archivos / 53 pruebas (las del arreglo). No
  corrí `tsc` ni `lint`: no toqué código.
