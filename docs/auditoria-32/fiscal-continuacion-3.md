# Cumplimiento fiscal — auditoría 32, continuación 3 (19-sep-2026)

**Nota: 2/10** (antes 3). Razón del movimiento: **deuda que cobró factura**.

No es la razón cómoda, así que va con el número contable detrás. El 16-sep entregué
con dos CRÍTICOS reincidentes y escribí que «nada empeoró, el árbol es byte por byte
el de la 31». Entre esa entrega y hoy entraron tres migraciones —**0357** (16-sep),
**0358** y **0359** (17-sep)— que reescribieron el predicado con el que se cuenta el
dinero del 15 %. Las tres son mejores que la 0349 **en SQL**. Pero el arreglo se
aplicó a **un solo lado de una resta**: el minuendo (`sumar_combustible_ejercicio`,
ahora consciente del emisor) se movió y el sustraendo (`copiasDeComprobante`, en
TypeScript, ciego al emisor) no. Antes del 16-sep los dos términos coincidían
carácter por carácter —eso fue, literalmente, el arreglo de **ARQ-C2** de la
auditoría 30, y su prueba sigue verde porque solo ejercita la rama del UUID, que
nadie tocó—. Hoy no coinciden, y lo **reproduje con pesos contra un Postgres 16
real con las 336 migraciones aplicadas y contra `cuadrarViaje`**: el PDF imprime
«el excedente de **$950.00** de ESTE comprobante NO se deduce» donde la regla
concede la deducción entera. Eso es un CRÍTICO nuevo, no reincidente, creado por
código escrito **después** de mi entrega. El ancla del rubro («3 o menos si el
producto imprime una cifra fiscal equivocada») ya estaba clavada; lo que cambió es
que ahora hay **una vía más** de imprimirla y la creó el arreglo. El rubro también
**cerró** un ALTO (FIS-A3), y lo digo abajo, pero cerrar un hueco de trazabilidad
no compensa abrir uno de dinero impreso.

**El riesgo mayor del rubro, hoy:** el criterio de «mismo comprobante» vive en
**tres** lugares —`cuadre/engine.ts:514` (TypeScript), `sumar_combustible_ejercicio`
(0358) y `gastos_fiscales_agregados_tenant` (0359)—, los dos de SQL se alinearon
entre sí el 17-sep y el de TypeScript se quedó donde estaba; y el de TypeScript es
el que imprime el PDF que firma el contralor.

| Severidad | # | de los cuales |
|---|---|---|
| CRÍTICO | 3 | 2 REINCIDENTES · **1 nuevo** |
| ALTO | 6 | 4 REINCIDENTES · **2 nuevos** (1 cerrado: FIS-A3) |
| MEDIO | 9 | 8 REINCIDENTES · **1 nuevo** |
| BAJO | 5 | 4 REINCIDENTES · **1 nuevo** |

**Medido hoy, para que mañana se distinga una medición de una impresión:**

- **Postgres 16 real, levantado y usado** (`/usr/lib/postgresql/16/bin`, `su postgres`,
  receta de `ci-postgres.yml`): andamio + **336 migraciones aplicadas limpias** sobre
  base virgen. Las cuatro cifras de abajo salen de `select` reales, no de leer SQL.
- `npx vitest run src/lib/likida/{cuadre,liquidacion,intake,facturacion,marketing}`
  → **142 archivos / 1,938 pruebas verdes**, 32.9 s. La suite está verde **con** el
  CRÍTICO nuevo dentro: ninguna prueba cruza el sustraendo de TypeScript contra el
  minuendo de SQL en la rama del folio.
- `cuotaVencida('2026-09-19')` ejecutado → **`false`**. `cuotaVencida('2026-09-20')`
  → `true`. La tabla del DOF (`normas/datos/cuota-ieps-diesel.yaml`) sigue
  terminando el **11-sep**; hoy es el **octavo día** imprimiendo pesos con una cuota
  muerta, y el **último** antes de que la ventana de gracia la apague sola.
- Fichas `normas/*.yaml`: **39**, las mismas. Ninguna nueva, ninguna re-verificada.
- **Citas normativas en las migraciones 0357/0358/0359: cero.** `grep -in
  "normas/\|ficha\|RFA\|LISR\|CFF\|LIF\|RMF"` sobre las tres da un solo acierto
  fuera de comentarios de código: la cadena «LISR 27-III» dentro de un mensaje de
  PDF citado de memoria.

**Aviso sobre el árbol de trabajo, para quien cierre la ronda.** No es un hallazgo
de mi rubro y no toqué nada, pero conviene anotarlo: durante mi corrida
`git status --short` cambió varias veces y en una de esas fotos aparecía
`M src/lib/likida/intake/consolidado.ts` con `monto: r.linea.monto` → **`monto: 0`**
(`:523`) — una mutación de dinero puesta a cero en el árbol. Minutos después esa
línea ya estaba revertida y había otros cinco archivos modificados. Son agentes
concurrentes de esta misma ronda probando mutaciones; ninguno toca los caminos del
15 % que mido aquí, y todas mis mediciones se hicieron sobre `HEAD` limpio de esos
archivos. Antes de commitear, `git status` merece una mirada: una mutación olvidada
en `consolidado.ts` es dinero en cero.

---

## Las migraciones 0357/0358/0359 vistas con ojos fiscales

**La pregunta del encargo era: ¿el criterio nuevo de «mismo comprobante»
corresponde a lo que la norma llama así? La respuesta honesta es que no se puede
contestar contra una ficha, y eso ya es el hallazgo.**

La única ficha `verificado_fuente_primaria` que gobierna esta cifra es
`normas/rfa-2026-2.9.yaml` (`estado_verificacion` en `:27`, verificada el
27-jul-2026 contra el DOF vía SIDOF, `:25`). Su `texto_vigente`, `:8-21`, literal
en la parte que fija el número:

> «…siempre que estos no excedan el **15 por ciento del total de los pagos
> efectuados por consumo de combustible para realizar su actividad**.»

Ese texto fija un **porcentaje** y un **denominador**. No dice una palabra sobre
qué hace que dos tickets sean el mismo comprobante — ni serie, ni folio, ni
emisor, ni periodo. La ficha es además explícita en que ni siquiera el **periodo**
está en la norma (`periodicidad_del_15_no_esta_en_la_norma`, `:37-59`: *«El texto
dice sólo "siempre que estos no excedan el 15 por ciento…", SIN fijar periodo de
medición alguno: ni mensual, ni acumulado, ni anual»*), y que la lectura anual es
**inferencia del producto**.

La ficha que **sí** definiría la identidad de un comprobante es
`normas/cff-29-A.yaml`, y su `texto_vigente` es **`null`**, con
`estado_verificacion: evidencia_corroborante` y una `nota_verificacion` (`:10-14`)
que lo declara: *«El texto del artículo NO se transcribió de diputados.gob.mx.
PARA CERRAR: pegar el texto vigente.»* → **no verificable en esta ronda.**

De ahí salen tres lecturas, y las tres son fiscales:

1. **El predicado que decide el denominador de una deducción no tiene ancla
   normativa.** Las 0357/0358/0359 se argumentan enteras sobre el comportamiento
   del OCR (`intake/ocr.ts:560`), sobre `engine.ts:541-555` y sobre `CLAUDE.md`.
   Es razonamiento de ingeniería sobre un número que sale impreso citando la
   RFA 2026 regla 2.9. Ver **FIS-B5**.
2. **El criterio nuevo es, en su dirección principal, el correcto.** «El folio se
   reinicia por emisor» es cierto y la 0357 tiene razón: dos estaciones distintas
   pueden emitir su folio `1234` el mismo ejercicio. Lo verifiqué contra el propio
   esquema: `gasto` **no tiene columna `serie`** (consultado en
   `information_schema.columns` sobre la base con las 336 migraciones), así que el
   único discriminante disponible además del folio es el RFC del emisor. Agregarlo
   acerca la llave a la identidad fiscal real, no la aleja.
3. **Pero la semántica que 0358 y 0359 declaran compartir no es la que
   implementan, y ninguna de las dos coincide con la del motor.** Eso es
   FIS-C3, FIS-A6, FIS-A7 y FIS-M9, abajo, los cuatro medidos.

### Lo que cada una hace bien, dicho antes que lo que hace mal

- La **0357** identifica un defecto real y lo mide contra Postgres antes de tocar
  nada. El arreglo es de una línea y **solo en la rama del folio**: la rama del
  `cfdi_uuid` no se toca, y es la correcta — el UUID **es** identidad fiscal
  global y agregarle el emisor habría sido ruido.
- La **0358** encuentra la regresión simétrica en menos de 24 h y la razona bien:
  el emisor es el único campo de la llave que el OCR puede perder **entero**
  (`ocr.ts:560`, `rfc = rfcDvOk ? rfcLeido : undefined`), mientras `concepto`,
  `folio_norm` y `cfdi_uuid` están normalizados contra la variación entre dos
  lecturas del mismo papel.
- La **0359** cierra de verdad **FIS-A3** (ALTO, abierto desde la 32): la función
  del panel del contador ya no es la única RPC de dinero sin prueba SQL.
  `supabase/tests/0359_panel_fiscal_dedup_emisor.sql` existe, está cableada en
  `ci-postgres.yml` y **corrió verde en mi base** junto con las otras 336
  migraciones. Eso es progreso de trazabilidad y lo cuento como cerrado.
- Las tres conservan `SECURITY INVOKER`, firma, `search_path` y ACL, y la 0359
  reescribe la definición viva tal como la devuelve `pg_get_functiondef` en vez de
  transcribir 190 líneas a mano. Es la disciplina correcta.

---

## Hallazgos

### [CRÍTICO] FIS-C3 — el arreglo de 0357/0358 llegó a UN solo lado de la resta: el minuendo dedupa mirando el emisor y el sustraendo no, así que el previo del 15 % sale inflado y el PDF niega una deducción que la RFA 2.9 concede (NUEVO)

`src/lib/likida/cuadre/desde_db.ts:184-192`, textual:

```ts
  // `copiasDeComprobante` es el criterio del propio motor y el espejo exacto
  // del de la 0349. Se reusa en vez de reimplementarse: una tercera copia del
  // predicado es la enfermedad que ARQ-C1 lleva ocho rondas denunciando.
  const copias = copiasDeComprobante(gastos);
  const efectivoDeEsteViaje = gastos
    .filter((g) => !copias.has(g.id) && g.fecha != null && g.fecha.slice(0, 4) === anioEjercicio
      && medioNoAdmitidoCombustible(formaPagoJuzgableDe(g)) && (g.concepto === 'diesel' || clavesCombustible.includes(g.claveProdServ ?? '')))
    .reduce((s, g) => s + Number(g.monto ?? 0), 0);
  const efectivoPrevEjercicio = Math.max(0, totalesEjercicio.efectivo - efectivoDeEsteViaje);
```

El comentario dice «**el espejo exacto del de la 0349**». Era verdad hasta el
16-sep. El minuendo, `totalesEjercicio.efectivo`, sale de
`getAcumuladoCombustible` → `sumar_combustible_ejercicio`, que desde la **0358**
dedupa por `(unaccent(lower(concepto)), coalesce(folio_norm, folio), monto,
coalesce(rfc_emisor, rfc_emisor_del_grupo, ''))`
(`supabase/migrations/0358_dedup_emisor_conocido.sql:91-103`). El sustraendo usa
`copiasDeComprobante` (`src/lib/likida/cuadre/engine.ts:556-557`), cuya llave es
`` `${strip_accents(g.concepto.toLowerCase())}|${llaveFolio}|${g.monto}` `` — **sin
emisor**, sin un carácter de cambio. Los dos términos de una resta juzgan distinto
exactamente en el caso que la 0357 vino a arreglar.

**Norma** — `normas/rfa-2026-2.9.yaml`, **`verificado_fuente_primaria`**,
`texto_vigente` `:8-21`, literal:

> «…considerarán cumplida la obligación establecida en el artículo 27, fracción
> III, segundo párrafo de la Ley del ISR, cuando los pagos por consumo de
> combustible se realicen con medios distintos a cheque nominativo…, **siempre que
> estos no excedan el 15 por ciento del total de los pagos efectuados por consumo
> de combustible para realizar su actividad**.»

**Escenario, medido de punta a punta, con pesos y centavos.**

Flota elegible (`facilidad15: true`). Ejercicio 2026: $1,400,000 de diésel con
tarjeta (forma `03`) más $207,000 de diésel en efectivo (forma `01`) de
liquidaciones anteriores. El viaje de hoy trae **dos tickets de diésel en efectivo
de $2,500 cada uno**, los dos con folio `1234`, del **mismo día**, de **dos
estaciones distintas** cuyos RFC el OCR leyó bien: `ESA030303CCC` y `ESB040404DDD`.
Es el caso canónico de la 0357.

*Paso 1 — lo que devuelve la base.* Insertadas las 202 filas en Postgres 16 real:

```
 RPC sumar_combustible_ejercicio (0358)  |  total 1,407,000.00  |  efectivo 212,000.00
 panel gastos_fiscales_agregados (0359)  |  monto 1,407,000.00  |  n 202
```

Correcto: las dos estaciones cuentan.

*Paso 2 — lo que resta `desde_db.ts`.* `copiasDeComprobante` sobre los dos gastos
del viaje devuelve `[['B','A']]` (ejecutado): colapsa la estación B en la A. Así
que `efectivoDeEsteViaje = $2,500`, no $5,000, y
`efectivoPrevEjercicio = 212,000 − 2,500 = **$209,500**`. El previo verdadero es
**$207,000**. Sale **$2,500 inflado**.

*Paso 3 — lo que imprime el PDF.* `cuadrarViaje` ejecutado con los dos previos:

```
=== PRODUCTO (previo 209,500)
  * efectivo_sobre_15  950  | Combustible pagado en EFECTIVO — el ejercicio lleva
    $212,000.00 de combustible pagado con medios que la LISR 27-III no admite,
    contra un tope de $211,050.00 (15% de $1,407,000.00); el excedente de $950.00
    de ESTE comprobante NO se deduce (RFA 2026 regla 2.9). No acredita IEPS.

=== VERDAD (previo 207,000)
  * combustible_efectivo_dentro15  0  | Combustible pagado en EFECTIVO — deducible
    por la facilidad del 15% (RFA 2026 regla 2.9): el ejercicio lleva $209,500.00
    de $1,407,000.00 de combustible pagado con medios que la LISR 27-III no
    admite (15% del total, tope 15%). No acredita IEPS.
```

El mismo comprobante, el mismo ejercicio: el producto imprime **$950.00 no
deducibles** donde la regla lo concede entero, y el veredicto pasa de verde
(`combustible_efectivo_dentro15`) a rojo (`efectivo_sobre_15`).

**Consecuencia.** Al **contralor**: $950 de deducción de ISR negada por comprobante
(≈ **$285** de ISR de más al 30 %) y, por `limite_importante` de la misma ficha
(`:72-75`, *«Conserva la DEDUCCIÓN para ISR, y con ella el acreditamiento del IVA:
LIVA 5-I…»*), **$131.04** de IVA que deja de acreditarse ($344.83 × 950/2500). No
es un caso de una vez: el error escala con cada par de tickets legítimos que
compartan folio y monto en el ejercicio, y empuja siempre en la misma dirección
—previo inflado → menos cupo— porque el sustraendo **nunca** dedupa menos que el
minuendo. Al **equipo**: la dirección es la **opuesta** a la de ARQ-C2 (auditoría
30), así que quien lea el comentario de `:179-182` («el error quedó del lado que
REGALA cupo») va a buscar el defecto donde ya no está.

**Me refuté antes de escribirlo, cuatro veces.**
· *«¿No lo atrapa la prueba de ARQ-C2?»* No, y es lo que hace esto peligroso.
`src/lib/likida/cuadre/desde_db_efectivo_previo.test.ts:178-198` usa **dos fotos
con el mismo `cfdiUuid`** — la rama del UUID, que 0357/0358 **no tocaron**. Pasa
verde y no dice nada de la rama del folio, que es la única que cambió.
· *«¿No habrá otro guardarraíl?»* Corrí los 142 archivos de la suite del rubro:
1,938 verdes con el defecto dentro. No existe una sola prueba que compare
`copiasDeComprobante` contra la definición SQL vigente.
· *«¿No es solo el hallazgo de arquitectura ARQ-A3 otra vez?»* ARQ-A3 es «el
predicado vive en dos lugares». Esto es «los dos lugares ahora dicen cosas
distintas **y los dos son términos de la misma resta**». La 0357 declara en su
cabecera que `copiasDeComprobante` queda fuera de alcance «porque corre sobre un
solo viaje, donde su criterio sigue siendo el correcto» — cierto para lo que el
motor hace con él **dentro** del viaje, y falso para este uso, que es restarlo de
un agregado del ejercicio.
· *«¿No se cancela con `Math.max(0, …)`?»* No: el error es por exceso, no por
defecto; el `max(0,…)` solo protege del signo contrario.

**Causa raíz probable:** el comentario de `desde_db.ts:184` congela el contrato en
la 0349 y nada en CI verifica que siga siendo cierto cuando una migración cambia
la RPC.

(NUEVO — creado por `f0645f9`/`53740a1`, 16 y 17-sep-2026.)

---

### [ALTO] FIS-A7 — sobre las mismas dos filas, el PDF acusa «1 comprobante duplicado, excluido del total» y el panel fiscal las cuenta como dos gastos buenos: $2,500 de diferencia entre dos pantallas del mismo producto (NUEVO)

`src/lib/likida/cuadre/engine.ts:699` (`if (duplicados.has(g.id)) continue;`),
`:680` (el duplicado sale de `totalComprobado`), `:1245` (la leyenda) y
`src/lib/likida/liquidacion/pdf.ts:331`, textual:

```ts
    text(`${nDup} ${nDup === 1 ? 'comprobante duplicado, excluido' : 'comprobantes duplicados, excluidos'} del total`, cConcepto, y, 8.5, font, MUTED);
```

contra `supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:156-168`, que desde
el 17-sep mantiene las dos filas como **dos celdas** del panel.

**Norma** — `normas/rfa-2026-2.9.yaml`, **`verificado_fuente_primaria`**, el mismo
denominador transcrito arriba («el total de los pagos efectuados por consumo de
combustible»); y la regla del producto que esto rompe, `CLAUDE.md`: *«Una cifra
fiscal que se lee distinto en dos pantallas se lee como dos cálculos.»* Es, palabra
por palabra, el criterio con el que la propia 0359 se justifica en su cabecera
(`:28-33`).

**Escenario, con pesos.** El mismo par del hallazgo anterior: dos tickets de
$2,500, folio `1234`, estaciones `ESA030303CCC` y `ESB040404DDD`. Ejecutado:

- `cuadrarViaje` → `totalComprobado` **$2,500**, más la diferencia
  `duplicado 2500 | «Comprobante duplicado: Combustible folio 1234 por $2,500.00
  aparece 2 veces (una excluida del total).»`, más
  `anticipo 7500 | «Sobró $7,500.00 del anticipo — a favor de la empresa.»`
  (con anticipo de $10,000).
- `gastos_fiscales_agregados_tenant` sobre las mismas dos filas → **$5,000**, `n = 2`.

El contralor abre `/dashboard/fiscal` y ve $5,000 de diésel. Abre el PDF del mismo
viaje y ve $2,500 comprobados, $2,500 «excluidos por duplicado» y $7,500 que la
empresa le reclama al chofer. La estación B existe, el ticket es real y su IVA
—$344.83 si el CFDI lo desglosa— entra al panel y no al PDF.

**Consecuencia.** Al **chofer**: $2,500 que puso de su bolsa y que el papel llama
duplicado. Al **contralor**: dos cifras del mismo dinero, y la que firma es la mala.
Al **SAT**, si alguien cruza: el papel de la liquidación y el agregado fiscal del
mismo tenant no cuadran sobre el mismo ejercicio.

**Me refuté dos veces.** · *«¿No es pre-existente de `copiasDeComprobante`?»* El
comportamiento del motor sí; la **contradicción** no. Antes de la 0359 el panel
usaba la 0355, que colapsaba igual que el motor: las dos pantallas decían $2,500 y
las dos estaban mal por el mismo lado. La 0359 arregló una y dejó la otra: el 17-sep
convirtió un error coherente en dos cifras incompatibles. · *«¿No lo cubre el test
de 0359?»* No: `supabase/tests/0359_panel_fiscal_dedup_emisor.sql:80-94` compara
`panel` contra lo que llama `motor`, pero lo que ahí se llama «motor» es la **otra
función SQL** (`sumar_combustible_ejercicio`). El motor de verdad —`engine.ts`— no
entra a esa comparación.

**Causa raíz probable:** la prueba que declara «las dos pantallas tienen que decir
lo mismo» compara dos de las **tres** definiciones, y deja fuera justamente la que
imprime el papel.

(NUEVO — creado por `5c1734e`, 17-sep-2026.)

---

### [ALTO] FIS-A6 — el default de la 0358 para «emisor perdido por el OCR» infla el cupo del 15 % en $2,125 por par y evapora $344.83 de IVA acreditable del panel, que es el daño exacto que la 0359 califica de CRÍTICO; y la justificación escrita («nunca infla el cupo del 15 %») es aritméticamente falsa (NUEVO)

`supabase/migrations/0358_dedup_emisor_conocido.sql:72-82` (el CTE
`con_emisor_del_grupo` con `min(c.rfc_emisor) over (partition by …)`) y `:91-103`
(`coalesce(rfc_emisor, rfc_emisor_del_grupo, '')`), replicado en
`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:138-168`.

La justificación, `0358:41-44`, textual:

> «Caso mixto (A, B y una foto sin emisor, mismo folio y monto): la fila sin
> emisor se absorbe en el grupo de UNO de los dos conocidos —`min()` elige el
> menor, de forma determinista— en vez de contarse aparte. **Es la dirección
> segura: nunca infla el cupo del 15 %.**»

y la de la 0357 que la originó, `0357:41-44`: *«Fallar hacia "es copia" nunca
imprime una deducción de más, que es la dirección segura de este cubo.»*

**Norma** — `normas/rfa-2026-2.9.yaml`, **`verificado_fuente_primaria`**, `:8-21`:
«…no excedan el **15 por ciento del total de los pagos efectuados por consumo de
combustible**…». El numerador y el denominador son el **mismo universo**, así que
tirar una fila los mueve a los dos — y no en la misma proporción.

**Escenario, medido en Postgres 16 real.** Ejercicio 2026: 100 tickets de diésel de
$14,000 con tarjeta (forma `03`) = $1,400,000, cada uno con $1,931.03 de IVA. Más
**dos tickets reales y distintos** de $2,500 en efectivo (forma `01`), folio `1234`
los dos, $344.83 de IVA cada uno; el OCR leyó el RFC de la estación A
(`ESA030303CCC`) y **falló el dígito verificador en el de la B**
(`intake/ocr.ts:560`: `rfc = rfcDvOk ? rfcLeido : undefined`). Es el caso 4 que la
0358 declara resolver. `select` reales:

```
 RPC (0358)            |  total 1,402,500.00  |  efectivo  2,500.00
 panel (0359) diesel   |  monto 1,402,500.00  |  iva 193,447.83  |  n 101
 LA VERDAD EN LA BASE  |  total 1,405,000.00  |  efectivo  5,000.00  |  iva 193,792.66  |  n 102
```

Dos consecuencias, las dos en pesos:

1. **El cupo del 15 % se infla.** `engine.ts:812` saca `tope = 0.15 * total`:
   $210,375.00 contra los $210,750.00 verdaderos, y el efectivo baja de $5,000 a
   $2,500. `cupoRestante = tope − previo` sale **$207,875.00** contra los
   **$205,750.00** que de verdad quedan: **$2,125.00 de cupo regalado por cada par
   colapsado**. La frase «nunca infla el cupo del 15 %» es falsa, y lo es en los
   números de la propia 0357: ahí, colapsar el par movía `cupoRestante` de $1,500
   a $3,625.
2. **El IVA acreditable se evapora del panel.** $193,447.83 contra $193,792.66:
   faltan **$344.83**, y falta la celda entera (`n = 101` sobre 102 filas). Es la
   misma aritmética que la cabecera de la 0359 califica de **CRÍTICO** («la otra
   celda se evaporó… `orden_copia = 1` tira la fila entera antes de agregar, así
   que su IVA acreditable no se recupera por ningún lado»), con otro disparador.

**Consecuencia.** Al **contralor**: un panel que le esconde $344.83 de IVA por par
y un motor que le concede $2,125 de cupo que no tiene — las dos direcciones del
error, a la vez, sin un renglón que lo avise. Al **SAT**: deducción tomada de más.
Y le pega **más seguido** que el caso que la 0357 arregló, por el argumento de la
propia 0358 (`:9-11`): el RFC se pierde «seguido», el par de estaciones distintas
con folio idéntico es raro.

**Me refuté tres veces.** · *«El input es indecidible: hay que elegir.»* Cierto, y
por eso no pido que elija al revés. Lo que está mal tiene tres partes verificables:
(a) la razón escrita es aritméticamente falsa y va a guiar el próximo cambio;
(b) la dirección elegida es la que **sobre-deduce**, que es la que el rubro nombra
(«imprime una cifra fiscal equivocada»); (c) la fila se **borra en silencio** —
`n = 101` donde hay 102— en un producto cuya primera regla es «nunca inventar una
cifra… se dice qué falta y por qué». Hay `rfcEmisor` como dimensión de celda en el
JSON de salida (`0359:246`, `'rfcEmisor', rfc_sin_cfdi`) y nada la usa para declarar la ambigüedad.
· *«¿No es el mismo hallazgo que la 0359 ya cerró?»* La 0359 cerró el disparador
«dos emisores conocidos». Este es «un emisor perdido», que la 0358 creó tres horas
antes y la 0359 copió literalmente.
· *«¿No lo atrapa `supabase/tests/0358_dedup_emisor_ocr_nulo.sql`?»* Al contrario:
esa prueba **fija** este comportamiento (`:52-54`, `if r.total <> 2500 then raise`),
con un fixture cuyo comentario declara que las dos filas son «dos fotos del MISMO
ticket». El caso simétrico —dos tickets reales, un RFC perdido— no está en ningún
archivo.

**Causa raíz probable:** se eligió un default para un input indecidible y se
documentó con una afirmación de seguridad que nadie verificó con números.

(NUEVO — creado por `53740a1`/`5c1734e`, 17-sep-2026.)

---

### [MEDIO] FIS-M9 — la 0358 y la 0359 no entran a la rama del folio con el mismo predicado: con `folio = ''` la RPC dice $2,500 y el panel $5,000 sobre las mismas dos filas, con la prueba de la 0359 en verde (NUEVO)

`supabase/migrations/0358_dedup_emisor_conocido.sql:61` selecciona `folio,
folio_norm` **crudos** y decide con `when folio is not null` (`:91`), mientras
`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:67-68` los pasa por
`nullif(g.folio, '')` / `nullif(g.folio_norm, '')` antes de decidir lo mismo
(`:156`). Y `src/lib/likida/cuadre/engine.ts:540` usa `if (g.folio)`, o sea la
prueba de verdad de JavaScript, que descarta `''`.

**Norma** — no hay ficha que transcriba esto: `normas/cff-29-A.yaml` tiene
`texto_vigente: null` (*no verificable en esta ronda*). Lo que sí es exigible es el
contrato que la propia 0359 declara, `supabase/tests/0359_panel_fiscal_dedup_emisor.sql:91-94`,
literal:

> «-- LO QUE DE VERDAD IMPORTA: las dos pantallas tienen que decir lo mismo.
> `if panel <> motor then raise exception 'DAT32C-C2: las dos funciones fiscales
> se contradicen sobre las MISMAS filas: panel=% motor=%'`»

**Escenario, medido.** Dos tickets de diésel de $2,500 en efectivo, de días
distintos (`2026-03-01` y `2026-07-15`), mismo emisor, con `folio = ''` y
`folio_norm = ''`:

```
 RPC (0358) folio vacio    |  total 2,500.00  |  efectivo 2,500.00
 panel (0359) folio vacio  |  monto 5,000.00  |  n 2
```

En la RPC, `''` no es NULL, así que entra a la rama del folio y
`coalesce(folio_norm, folio)` devuelve `''`: los dos tickets caen en la misma
partición y uno se descarta. En el panel, `nullif` los manda a `orden_copia = 1` y
los dos sobreviven. **$2,500 de diferencia**, en la dirección que cambia el
denominador del 15 % y el IVA del panel.

**Consecuencia.** Al **equipo**: el guardarraíl que la 0359 escribió para que esto
no pase solo cubre las cuatro filas de su fixture, y las dos funciones siguen
divergiendo fuera de ellas. Al **contralor**, si el caso se materializa: otra vez
dos pantallas y dos cifras.

**Lo que NO puedo afirmar, y lo digo en vez de esconderlo.** No probé que
`gasto.folio = ''` sea alcanzable en producción hoy. La ruta del OCR no lo produce
(`intake/sanitizar.ts:9-13`, `sanitizarFolio` devuelve `undefined` para la cadena
vacía) y `repo.ts:88`/`:1009` usan `|| undefined`. Pero `repo.ts:362` escribe
`folio: g.folio ?? null` tal cual, y el **esquema lo permite**: verifiqué en
`pg_constraint` sobre la base con las 336 migraciones que `gasto` **no tiene** la
restricción `folio <> ''` — la de `0158_integridad_fiscal.sql:628-630` se aplica
solo a `viaje` y `factura_emitida` (`:594-596`). Lo levanto como MEDIO y no como
ALTO por eso.

**Causa raíz probable:** la 0359 se derivó de la 0355 (que ya normalizaba con
`nullif`) y la 0358 de la 0349 (que nunca lo hizo); nadie comparó las dos entradas
a la rama, solo las cuatro salidas.

---

### [BAJO] FIS-B5 — el predicado que decide el denominador de una deducción del ISR no cita una sola ficha de `normas/` (NUEVO)

`supabase/migrations/0357_dedup_ejercicio_por_emisor.sql`,
`0358_dedup_emisor_conocido.sql` y `0359_panel_fiscal_dedup_emisor.sql`, las tres
cabeceras completas.

**Norma** — la que gobierna la cifra es `normas/rfa-2026-2.9.yaml`,
**`verificado_fuente_primaria`**, `:8-21`, ya transcrita. La que definiría
«el mismo comprobante» sería `normas/cff-29-A.yaml`, y su `texto_vigente` es
**`null`** con `nota_verificacion` `:10-14` (*«El texto del artículo NO se
transcribió… PARA CERRAR: pegar el texto vigente»*) → **no verificable en esta
ronda**.

**Escenario.** El contador de la flota pregunta por qué dos tickets de $2,500 del
mismo folio cuentan como uno en marzo y como dos en abril. La respuesta que el
repo puede dar hoy sale de `intake/ocr.ts:560` y de `engine.ts:541-555` — o sea, de
cómo se comporta el OCR de Likida. No hay un renglón de norma que respaldar. La
elección más consecuente —que el `rfc_emisor` sea el único discriminante, porque
`gasto` **no tiene columna `serie`** (verificado en `information_schema.columns`
sobre la base con las 336 migraciones) mientras el estándar del CFDI identifica un
comprobante por Serie **y** Folio dentro de un emisor— tampoco está razonada en
ningún lado.

**Consecuencia.** Al **equipo** y al fiscalista del día que llegue: el criterio que
mueve el denominador de la RFA 2.9 y el IVA del panel es, en el expediente,
ingeniería sin ancla. Es BAJO hoy porque no hay clientes y porque la dirección
principal del criterio es defendible; cobra factura el día que alguien tenga que
sostenerlo ante una revisión.

---

## Los reincidentes, verificados hoy uno por uno

| # | Título en corto | `archivo:línea` verificado hoy | ¿sigue? |
|---|---|---|---|
| **FIS-C1** (CRÍTICO) | el cotejo del régimen corre DESPUÉS de la escritura que vigila | `src/app/dashboard/onboarding/page.tsx:67` (`await guardarPerfilPatch(...)`), `:68` (`facilidad15Declarada(patch)`), `:70` (`actualizarFacilidad15`), `catch` en `:72-74` | **SÍ. 4ª ronda. Idéntico** |
| **FIS-C2** (CRÍTICO) | cambiar la clave del SAT después no recalcula nada | `src/lib/saas/fiscal.ts:222-234` — `guardarDatosFiscales` hace `.update(fila).eq('id', tenantId)` y nada más; `regimen_fiscal` va dentro de `fila` (`:207`) | **SÍ. Función entera sin un carácter** |
| **FIS-A1** (ALTO) | la «fuente única» del 15 % es parámetro OPCIONAL y 8 llamadores no lo pasan | `src/lib/likida/fiscal.ts:577` (`opcionesDe(cfg, perfilCrudo?: unknown)`) | **SÍ** |
| **FIS-A2** (ALTO) | la retención del 4 % no la teclea ningún formulario | `src/app/dashboard/facturacion/forma.tsx:159-170` | **SÍ** |
| **FIS-A3** (ALTO) | `0355` reescribe la RPC del panel del contador y no tiene test SQL | `supabase/tests/0359_panel_fiscal_dedup_emisor.sql` **existe**, está cableado en `ci-postgres.yml` y corrió verde en mi base | **NO — CERRADO por la 0359** |
| **FIS-A4** (ALTO) | la calculadora pública imprime el estímulo de IEPS EN PESOS multiplicando un año de litros por la cuota de UNA semana | `src/lib/likida/marketing/calculadora.ts:170` (`pesos(litrosMes * CUOTA_DOF.pesosPorLitro)`), `:200` (`× 12`), `:49-53` (`pesosPorLitro: 0.6787`, `registradaEl: '2026-09-05'`) | **SÍ. 4ª ronda** |
| **FIS-A5** (ALTO) | «sale SIN complemento» cita la 2.7.7.2.1 sin la salvedad de las materias excluidas | `src/lib/likida/carta_porte_wa.ts:99-103`; salvedad solo en `src/app/dashboard/carta-porte/vista.tsx:57-58` | **SÍ** |
| **FIS-M1** (MEDIO) | el criterio de copia portado a SQL diverge del motor | **MUTÓ**: en la 0349 el SQL era **más ancho**; desde la 0358 es **más estrecho** (mira el emisor) y el motor no. El caso vivo es **FIS-C3** | **SÍ, con el signo invertido** |
| **FIS-M2** (MEDIO) | `traerTodoDesdeId` no es inmune a inserciones | `src/lib/likida/pg.ts:264,267` | **SÍ** |
| **FIS-M3** (MEDIO) | el cubo del 15 % se define por exclusión de la lista de la LISR (5 familias), no de la RFA (4) | `src/lib/likida/cuadre/engine.ts:126` (`MEDIOS_LISR_27_III = ['02','03','04','05','28','29']`) contra `normas/rfa-2026-2.9.yaml:13-16` | **SÍ** |
| **FIS-M4** (MEDIO) | el denominador suma combustible COMPRADO y la regla dice «pagos EFECTUADOS» | ahora en `supabase/migrations/0358_dedup_emisor_conocido.sql:120` — `coalesce(sum(monto), 0) as total` sobre `base`, sin filtro de pago; el `where` sigue acotando por `fecha` (`:68-69`) y no por `pagado_en` | **SÍ. Las tres migraciones lo conservan intacto** |
| **FIS-M5** (MEDIO) | dos fichas `verificado_fuente_primaria` dan instrucciones opuestas sobre la caseta estatal | `normas/rmf-2026-9.1.7.yaml:66` y `normas/red-nacional-autopistas.yaml:88` | **SÍ** |
| **FIS-M6** (MEDIO) | la ventana de gracia de la cuota se cuenta desde el INICIO de la semana | `src/lib/likida/marketing/calculadora.ts:58` (`DIAS_VIGENCIA_CUOTA = 14`) y `:135-136`. **Ejecutado hoy**: `cuotaVencida('2026-09-19') === false`, `cuotaVencida('2026-09-20') === true` | **SÍ, y hoy es su peor día: 8 días citando una cuota que venció el 11-sep** |
| **FIS-M7** (MEDIO) | la nota del NO DEDUCIBLE enumera la LISR 27-III sin la transferencia electrónica | `src/lib/likida/cuadre/engine.ts:845`, contra la lista que el mismo archivo aplica en `:126` (donde `03` **es** la transferencia) | **SÍ** |
| **FIS-M8** (MEDIO) | el CFDI timbrable exige el CP y no el Estado; el `placeholder` enseña «Nuevo León» donde el complemento espera `NL` | `src/lib/likida/carta_porte_cfdi.ts:179-180`; `src/app/dashboard/carta-porte/forma.tsx:135-136` | **SÍ** |
| **FIS-B1** (BAJO) | `exigibleHasta` sin un solo lector de producción | `src/lib/likida/normas/indice.ts:92` | **SÍ. Faltan 103 días para el 31-dic-2026** |
| **FIS-B2** (BAJO) | el `ayuda` de dedicación afirma ser válvula del estímulo de peaje | `src/app/dashboard/onboarding/forma.tsx:104` | **SÍ** |
| **FIS-B3** (BAJO) | el comentario que funda la retención cita la migración equivocada | `src/lib/likida/facturacion_escritura.ts:156` | **SÍ** |
| **FIS-B4** (BAJO) | columna «IEPS de diésel» en pesos bajo «LIF 20-A fr. IV», fundada en «CFDI con desglose» | `src/app/dashboard/[id]/detalle.tsx:278` (`<th>IEPS de diésel</th>`), `:286` (`mxn(d.ieps)`), `:298` («IVA e IEPS sólo de CFDI con desglose») | **SÍ. Sigue BAJO: `engine.ts` mantiene `const iepsAcreditable = 0`** |

---

## Lo que revisé y está bien

- **La rama del `cfdi_uuid` no se tocó, y es lo correcto.** `0358:89-90` conserva
  `row_number() over (partition by lower(cfdi_uuid), coalesce(cfdi_orden, 1))`. El
  UUID es identidad fiscal global y no necesita emisor; el `cfdi_orden` conserva la
  separación de la 0065 entre «este gasto NACIÓ de ese CFDI» y «está AMPARADO por
  él» (la factura consolidada de CAPUFE). Probado contra la base real: las 336
  migraciones aplican limpias y `supabase/tests/{0349,0357,0358,0359}` corren.
- **La 0359 no reescribió a mano las 190 líneas de la 0355.** Comparé el cuerpo
  publicado contra la definición viva: el único cambio textual es el CTE
  `con_emisor_del_grupo` y las cuatro líneas del `partition by`. Firma,
  `search_path`, `SECURITY INVOKER` y ACL intactos, como declara.
- **El estímulo de IEPS del MOTOR sigue siendo litros, no el IEPS trasladado.**
  `src/lib/likida/cuadre/engine.ts:1630`, `const iepsAcreditable = 0`, `const` a
  propósito, contra `normas/lif-2026-20-A.yaml:124`,
  **`verificado_fuente_primaria`**, literal: *«cuota IEPS vigente al momento de la
  compra × LITROS. **No es el IEPS trasladado en el CFDI.***» La regla que el
  encargo nombra por su nombre está respetada donde se calcula el dinero; lo roto
  vive fuera del motor (FIS-A4, FIS-B4).
- **`cuadre/cuota_diesel.ts` sigue siendo fail-closed de verdad.** `:131-135`
  devuelve `null` fuera de rango en vez de la última conocida. Lo ejecuté con
  `'2026-09-19'`: se niega a responder, como debe. El problema no es el lector; es
  que la superficie pública no lo llama.
- **El prorrateo del 15 % se sigue reportando POR COMPROBANTE y con su lectura
  declarada.** `engine.ts:817-839`: `cupoRestante`, `dentro`, `excedenteDeEste`, y
  `LECTURA_RFA_29_PRORRATEO` impreso en la nota. Lo vi en la salida real de
  `cuadrarViaje`: *«Lectura aplicada: el 15% se trata como tope prorrateable… la
  lectura literal del "siempre que" de la regla 2.9 negaría la facilidad a TODO el
  combustible en efectivo del ejercicio — confírmela con su contador.»* Es
  exactamente lo que `normas/rfa-2026-2.9.yaml:60-71` pide que se diga en voz alta.
- **El fail-closed del ejercicio sigue en pie.** `engine.ts:786-806`: sin
  `totalCombustibleEjercicio > 0`, o con un comprobante de otro ejercicio o sin
  fecha, el motor **no afirma** deducible ni no deducible. Verificado línea por
  línea; no lo tocaron las tres migraciones.
- **Las 336 migraciones aplican limpias sobre base virgen** y las pruebas SQL de
  dinero (`0345`, `0349`, `0352`, `0357`, `0358`, `0359`) corren. Eso lo ejecuté,
  no lo deduje.

---

## Lo que descarté y por qué

- **`cfdi_uuid = ''` en la 0358.** La rama del UUID de la 0358 mira la columna
  **cruda** (`when cfdi_uuid is not null`), mientras la 0359 la pasa por `nullif`.
  En teoría `''` colapsaría filas por el uuid vacío. **No lo levanto**: verifiqué
  en `pg_indexes` que `uq_gasto_cfdi_uuid` es único sobre
  `(tenant_id, cfdi_uuid, cfdi_orden) where cfdi_uuid is not null`, así que dos
  filas con `''` solo conviven si difieren en `cfdi_orden` — y entonces caen en
  particiones distintas y no se colapsan. El caso que quedaría (`cfdi_orden` NULL
  contra `1`) es demasiado estrecho para escribirle un escenario honesto.
- **La ventana de `rfc_emisor_del_grupo` en la 0359 es `[p_desde, p_hasta]` y en la
  0358 es el año.** Se ve como una divergencia y no lo es: la partición incluye
  `concepto`, folio y `monto`, y un mismo comprobante tiene una sola `fecha`, así
  que el grupo no se parte por la ventana en ningún caso que pude construir.
- **La 0359 no filtra `monto > 0` ni por concepto en `base_cruda` y la 0358 sí.**
  Irrelevante para el dedup: `monto` y `concepto` están **dentro** de la partición,
  así que una fila de $0 o de otro concepto abre su propio grupo. Lo verifiqué
  ejecutando las dos funciones sobre las mismas 202 filas: coinciden al centavo.
- **`min(rfc_emisor)` como desempate.** Es determinista y no depende del orden de
  inserción; con tres filas (A, B y una sin emisor) la absorbe siempre el mismo
  grupo. No es fuente de no-determinismo. El problema del caso 4 no es cuál grupo
  la absorbe, es que la absorba (FIS-A6).
- **El `ClaveProdServ` del flete** (`78101800` en `carta_porte_cfdi.ts:44` contra
  `78101801` en `carta_porte.ts:120`). Sigue como lead y no como hallazgo, por la
  misma razón del 16-sep: ninguna ficha transcribe el requisito del catálogo
  `c_ClaveProdServ` y afirmarlo de memoria es lo que este rubro no admite.

---

## Lo que NO alcancé a revisar / fichas no verificables en esta ronda

Sin esto la nota es una mentira por omisión.

- **`normas/lisr-27-III.yaml` sigue en `evidencia_corroborante`.** Es la fracción
  detrás del veredicto rojo más frecuente del motor, del importe de $2,000 y de
  media docena de leyendas. Mientras no se cierre contra fuente primaria, el ancla
  de 8+ («cada cifra fiscal impresa rastrea a una ficha
  `verificado_fuente_primaria`») es **inalcanzable con independencia del código**.
  Esta ronda tampoco lo pudo cerrar: no hay red saliente hacia diputados.gob.mx.
- **`normas/cff-29-A.yaml` sigue con `texto_vigente: null`** y
  `normas/rfa-2026-3.12` sigue sin ficha (39 archivos, ninguno es 3.12). Por eso
  FIS-B5 va en BAJO y no en MEDIO: no puedo dictaminar contra un texto que el repo
  no tiene.
- **No crucé el DOF.** La tabla de `normas/datos/cuota-ieps-diesel.yaml` sigue
  terminando el **11-sep**; faltan las semanas del 12-18 y del 19-25. Todo lo que
  digo de FIS-A4 y FIS-M6 sale de las 7 semanas capturadas, no de la cuota real de
  hoy. (Hay un PR `claude/cuota-diesel-2026-09-19` abierto; no está en esta rama.)
- **Ningún render.** No levanté preview de `/dashboard/fiscal`, del PDF, de
  `/calculadora` ni de `/dashboard/onboarding`. Las cifras del panel salen de
  ejecutar la RPC contra Postgres, no de mirar la pantalla que las pinta: si la
  capa de presentación vuelve a agregar o a filtrar, no lo vi.
- **`facturacion/`, `intake/sat.ts` y `sat_descarga/` no los reabrí**, ni
  `permiso_cre.ts`, ni la cadena de Carta Porte más allá de reconfirmar FIS-A5 y
  FIS-M8 en su `archivo:línea`. Elegí gastar la ronda entera en las tres
  migraciones, que era el encargo.
- **No medí `proporcionCombustible15` del panel contra el motor con datos reales.**
  Leí que `fiscal.ts:558-569` calcula su proporción desde el **mismo**
  `getAcumuladoCombustible` que alimenta el minuendo de `desde_db.ts`, así que
  hereda la cifra correcta del lado SQL; la divergencia que reporto está en el
  sustraendo de TypeScript. No ejecuté el panel completo para confirmarlo punta a
  punta.
