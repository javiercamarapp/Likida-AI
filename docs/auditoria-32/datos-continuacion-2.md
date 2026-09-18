# Modelo de datos y esquema — auditoría 32 (continuación 2, 18-sep)

**Nota: 6/10** (antes 5). Razón del movimiento: **se atacó y subió.** El número
contable: los **dos CRÍTICOS** que dejé abiertos ayer (`DAT32C-C1`, `DAT32C-C2`)
**cerraron**, y no lo doy por bueno porque la suite esté verde — lo medí contra
un Postgres 16 propio con las **336 migraciones aplicadas limpias**, con
`pg_get_functiondef` diffeado contra la definición anterior, con la mutación
corrida en los dos sentidos (roja con la 0357 / roja con la 0355, verde con la
0358 / 0359), con doble reaplicación y con la ACL leída del catálogo después del
`create or replace`. Hoy quedan **0 CRÍTICOS**. No sube más de un punto por una
razón que es exactamente la de este rubro: el arreglo de los dos CRÍTICOS
convirtió `rfc_emisor` y `folio` en la llave de dos cifras fiscales, y **la base
no impone ni una sola de las invariantes de las que esas dos funciones ahora
dependen** — ni forma, ni caso, ni «no vacío», ni unicidad. Todo lo sostiene la
aplicación. Y el CRÍTICO original (ARQ-A3) sigue fallando en su propio escenario
cuando el OCR pierde uno de los dos RFC (medido: $2,500 contra $5,000).

**El riesgo mayor del rubro hoy:** las dos funciones fiscales del producto
deduplican por `(concepto, folio, monto, rfc_emisor)` y esas tres columnas de
`gasto` no tienen **ninguna** restricción en la base — 0 CHECK sobre
`rfc_emisor`, 0 sobre `folio`, 0 sobre `folio_norm` (leído de `pg_constraint`).
Un `''` en `folio` basta para que el motor del 15 % y el panel del contador den
cifras distintas sobre las mismas filas, que es el CRÍTICO que se acaba de
arreglar, vivo por otra puerta.

**Cómo se midió.** Cluster PostgreSQL 16.13 efímero propio
(`/usr/lib/postgresql/16/bin/initdb`, `su postgres`, puerto 5456, fuera del
repo), `andamio_ci.sql` y después las 336 migraciones una por una con la receta
de `.github/workflows/ci-postgres.yml:143-172`:

```
andamio ok
0335_preflight_retencion_indices: PASS
336 migraciones aplicadas limpias.
```

Todos los `probe` corren dentro de `begin; … rollback;`. `VERDAD` es
`select sum(monto), sum(iva_traslado), count(*) from gasto` — lo que la base
tiene de verdad, sin pasar por ninguna función.

---

## ¿Cerraron 0358 y 0359?

### `DAT32C-C1` / migración 0358 — **SÍ, cerró.**

El escenario exacto que reporté (dos fotos del MISMO ticket de $2,500, folio
1234, con el OCR pasando el dígito verificador en una sola) hoy da la verdad, y
la da en las **dos** funciones:

```
=== C1 — dos fotos del MISMO ticket, RFC leido en una sola. Verdad 2500
MOTOR  | 2500.00 | 2500.00
PANEL  | 2500.00 |  344.83 | n=1
VERDAD | 5000.00 |  689.66 | 2 filas en la base
```

Lo verifiqué por cinco caminos, no por uno:

1. **El cuerpo es el de la 0357 con un solo cambio.** Restauré la 0357 en una
   transacción, saqué `pg_get_functiondef` de las dos y las diffeé: la única
   diferencia es el CTE `con_emisor_del_grupo` y el
   `coalesce(rfc_emisor, rfc_emisor_del_grupo, '')` del `partition by`. Nada más
   se movió: ni firma, ni `search_path`, ni el `where`, ni el `filter` del
   numerador del 15 %.
2. **Rojo real, medido en los dos sentidos.** Con la 0357 puesta, la prueba de
   la 0358 falla con la cifra exacta del hallazgo, y al restaurar la 0358 vuelve
   a verde:
   ```
   ERROR:  DAT32C-C1: el emisor perdido por el OCR partió en dos las dos fotos
           del MISMO ticket: total=5000.00 (esperado 2500)
   ```
3. **Idempotente y con la ACL intacta.** Aplicada dos veces seguidas sin error;
   después: `prosecdef = f` (invoker), `proconfig = search_path=public,
   pg_catalog`, `proacl = {postgres=X/postgres,service_role=X/postgres}` — `anon`
   y `authenticated` siguen sin `EXECUTE`.
4. **Los casos de borde que su propia prueba NO cubre, probados.** RFC nulo en
   ambas filas (caso 3, conservado: $2,500); RFC con espacios `'   '` en una y
   NULL en la otra ($2,500, correcto); grupo con dos emisores conocidos más una
   foto sin emisor y con el `id` MENOR en la fila sin emisor (el desempate
   `order by id` no cambia el total: $5,000).
5. **Los 21 archivos SQL cableados en `ci-postgres.yml` corren verdes** sobre
   esta base, incluidos el 0349 y el 0357 anteriores, y el bloque 267 de Capa 1
   (`FISCAL_SIN_COPIAS_0355 n=t monto=t iva=t distingue-distinto=t`).

**La regla que la 0358 implementa, dicha con precisión** (la deduje del cuerpo y
la confirmé con sondas): de un grupo `(concepto, folio_norm, monto)` sobreviven
**tantas filas como emisores DISTINTOS y CONOCIDOS haya**, y una sola si no hay
ninguno. Es monótona respecto de la 0349 (nunca sobrevive menos) y respecto de
la 0357 (nunca sobrevive más). Por construcción no puede reintroducir C1.

### `DAT32C-C2` / migración 0359 — **SÍ, cerró, y el trasplante está limpio.**

```
=== C2 — dos ESTACIONES distintas, mismo folio 1234, los dos RFC leidos
MOTOR  | 5000.00 | 5000.00
PANEL  | 5000.00 |  689.66 | n=2
VERDAD | 5000.00 |  689.66 | 2 filas
```

Ayer eran `motor 5000` contra `panel 2500 / iva 344.83`. Hoy las dos coinciden
con la base al centavo, y la celda de la estación B volvió al tablero.

**El riesgo que más me preocupaba era el hand-copy de 190 líneas.** La cabecera
de la 0359 afirma que el cuerpo es la definición viva de la 0355 con un único
cambio textual. **Lo verifiqué, no lo creí:** apliqué la 0355 dentro de una
transacción, saqué su `pg_get_functiondef`, y lo diffeé contra el vivo. El diff
completo son 25 líneas y **todas** son el CTE `con_emisor_del_grupo` nuevo y el
`partition by` ampliado. Las otras 26 dimensiones, los tres subselects de
`renglones_ajenos`, el `left join dias`, el `group by 1..26` y el
`jsonb_build_object` de 33 llaves salen **idénticos**. No se coló nada.

Rojo medido: con la 0355 restaurada, la prueba de la 0359 falla con
`panel=3500.00 (esperado 6000)`; con la 0359, verde. Reaplicable dos veces.
`prosecdef = f`, ACL idéntica a la de su hermana.

### El «pero» que sí hay que decir

**0358 y 0359 cerraron lo que declararon cerrar. ARQ-A3, el CRÍTICO del que
todo esto nació, sigue abierto en su mitad más frecuente** — ver `DAT32C2-A1`
abajo. Y la invariante que la propia prueba de la 0359 fija («las dos funciones
tienen que decir lo mismo sobre las mismas filas») **sigue siendo falsa** por un
eje que esa prueba no toca — ver `DAT32C2-A2`.

---

## Hallazgos

### [ALTO] DAT32C2-A1 · ARQ-A3 solo está cerrado cuando el OCR lee los DOS RFC; con uno perdido, las dos estaciones se vuelven a colapsar

`supabase/migrations/0358_dedup_emisor_conocido.sql:101`,
`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:166`,
`supabase/migrations/0358_dedup_emisor_conocido.sql:41-44`,
`src/lib/likida/intake/ocr.ts:560`

**Escenario, con valores.** Es el caso de manual de ARQ-A3 —dos estaciones
distintas emiten su folio `1234` el mismo año por $2,500 cada una, en dos viajes
y dos meses— con la única variante de que el OCR falló el dígito verificador en
uno de los dos tickets, que es lo que la cabecera de la propia 0358 dice que
«pasa seguido» (`ocr.ts:560`: `rfc = rfcDvOk ? rfcLeido : undefined`). Medido:

```
=== P10 — estacion A (RFC leido) + estacion B (RFC perdido), folio 1234, $2,500 c/u
MOTOR  | 2500.00 | 2500.00
PANEL  | 2500.00 |  344.83 | n=1
VERDAD | 5000.00 |  689.66 | 2 filas
```

La regla de la 0358 —«una fila sin emisor hereda el emisor conocido del grupo»—
mete la fila de la estación B en la partición de la estación A y la descarta con
`orden_copia = 2`. El gasto de $2,500 de la estación B y sus $344.83 de IVA
acreditable **desaparecen de las dos pantallas**, y no como advertencia: como
ausencia.

Con dos emisores conocidos entre tres filas pasa lo mismo hacia abajo:

```
=== P2 — tres tickets, folio 1234, $2,500 c/u, RFC perdido en dos de los tres
MOTOR  | 2500.00 | 2500.00
PANEL  | 2500.00 |  344.83 | n=1
VERDAD | 7500.00 | 1034.49 | 3 filas
```

**No es una regresión de la 0358/0359** —la 0349 y la 0355 daban lo mismo— y lo
digo explícitamente porque importa: es un **cierre parcial**. La cabecera de la
0358 lo declara «la dirección segura: nunca infla el cupo del 15 %», y para el
MOTOR el argumento es correcto. **Para el PANEL no transfiere**, y la 0359 lo
importó sin rehacerlo: ahí subcontar no es prudente, es borrar gasto deducible
real y el IVA acreditable que lo acompaña, sobre la cifra que el contralor cruza
contra su póliza.

**Intenté refutarlo por tres lados y sobrevive.** (a) *«dos estaciones con el
mismo folio y el mismo monto al centavo es inverosímil»* — es la premisa que la
0357 y `docs/auditoria-30/datos.md:150-165` usan para justificar el arreglo
entero; no se puede invocar como realista para abrir el CRÍTICO y como
inverosímil para cerrarlo. (b) *«el OCR casi siempre lee el RFC»* — la cabecera
de la 0358 argumenta lo contrario, con el ejemplo propio («PER/PEX/PTE donde
decía PEC»), y de ahí sale su derecho a existir. (c) *«al menos las dos pantallas
coinciden»* — coinciden, y ése era C2; pero coinciden en la cifra equivocada, y
`CLAUDE.md` pide que el rótulo sea verdad, no que sea consistente.

Causa raíz probable: sin emisor no hay forma de distinguir dos tickets, y el
arreglo eligió un desempate determinista en vez de declarar la ambigüedad; el
esquema no tiene dónde decir «aquí descarté N filas por probable copia».

### [ALTO] DAT32C2-A2 · las dos funciones fiscales SIGUEN contradiciéndose: 0358 lee `folio`/`folio_norm` crudos y 0359 los pasa por `nullif`

`supabase/migrations/0358_dedup_emisor_conocido.sql:61`,
`supabase/migrations/0358_dedup_emisor_conocido.sql:91`,
`supabase/migrations/0358_dedup_emisor_conocido.sql:99`,
`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:67-68`,
`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:156`

`0359:67-68` normaliza `nullif(g.folio,'')` y `nullif(g.folio_norm,'')` en
`base_cruda`. `0358:61` selecciona `folio, folio_norm` **crudos**. De ahí salen
dos desacuerdos, los dos medidos:

```
=== P5 — folio = '' y folio_norm = '' en las dos filas (MISMO ticket, verdad 2500)
MOTOR  | 2500.00 | 2500.00
PANEL  | 5000.00 |  689.66 | n=2
VERDAD | 5000.00 |  689.66 | 2 filas

=== P8 — folio_norm = '' con folios REALES distintos ('111' y '222'), verdad 5000
MOTOR  | 2500.00 | 2500.00
PANEL  | 5000.00 |  689.66 | n=2
VERDAD | 5000.00 |  689.66 | 2 filas
```

En P5 el motor dedupa (`'' is not null` → rama del folio) y el panel no
(`nullif` → `null` → rama `else 1`). En P8 es peor y al revés: `0358:99` hace
`coalesce(folio_norm, folio)` sobre el `''` crudo, así que **dos folios de verdad
distintos se aplanan a la misma partición** y el motor pierde $2,500 reales que
el panel sí ve. Las dos son exactamente la falla de `DAT32C-C2` —«una cifra
fiscal que se lee distinto en dos pantallas se lee como dos cálculos»— por un eje
que la prueba de la 0359 no ejercita: esa prueba afirma `panel = motor`, pero
solo sobre sus tres fixtures, todos con folio no vacío.

**Consecuencia.** Para el contralor, la misma contradicción del CRÍTICO de ayer
($5,000 en una pantalla, $2,500 en la otra) por otra puerta. Para el equipo: se
cerró la copia del predicado en la columna `rfc_emisor` y se dejó divergente la
normalización de las otras dos columnas de la misma llave, así que el par volverá
a separarse con el siguiente cambio.

**Refutación intentada, y es la que decide la severidad.** ¿Es alcanzable desde
la aplicación? **Hoy no**: `sanitizarFolio` (`src/lib/likida/intake/sanitizar.ts:9-13`)
devuelve `undefined` en vez de `''`, `ocr.ts:640` solo calcula `folioNorm` cuando
hay `folioRaw` y su regex `^0+(?=\d)` no puede consumir la cadena entera, y
`repo.ts:362,386` escribe `?? null`. **Y ésa es precisamente la razón por la que
lo reporto**: la invariante «`folio` nunca es `''`» la sostienen tres funciones
de TypeScript y **cero restricciones de la base** — lo confirmé contra
`pg_constraint`, `gasto` tiene 15 CHECK y ninguno nombra `folio` ni `folio_norm`.
Un backfill, la consola de Supabase, un `update` de soporte o el segundo escritor
no pasan por `sanitizarFolio`, y el modo de falla es silencioso: dos números
distintos, ningún error.

Causa raíz probable: la 0359 se escribió desde `pg_get_functiondef` de la 0355 y
la 0358 desde el cuerpo de la 0357; las dos heredaron la normalización de su
propia rama en vez de derivarla de un solo sitio.

### [ALTO] DAT32C2-A3 · la copia descartada se lleva sus alertas: el panel pinta como limpio un comprobante con 80 % de consumo ajeno al viaje

`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:167`,
`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:180`,
`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:86-106`

**Escenario, con valores.** Dos fotos del MISMO ticket de $2,500 de alimentación
(mismo emisor, mismo folio, mismo monto: copias de verdad, el dedup acierta al
quedarse con una). El OCR solo alcanzó a desglosar los renglones en la **segunda**
lectura, que trae `ocr_extra.renglones` con $2,000 marcados `ajenoAlViaje` — el
80 % del ticket. La primera, sin desglose, tiene el `id` menor. Medido:

```
muestra ...0001a1 | renglonesAjenos = false | n = 1 | monto = 2500.00
```

La fila que traía la evidencia salió con `orden_copia = 2` y `0359:180` la tira
**entera** antes de agregar. El panel del contador publica una celda limpia.

**Consecuencia.** `/dashboard/fiscal` afirma que no hay consumo ajeno al viaje en
un periodo donde lo hay, al 80 % de un comprobante. La alerta no se degrada ni
se marca: desaparece, y el desempate `order by id` es **determinista**, así que
no es intermitente — es siempre la misma fila la que se pierde, y `id` no tiene
ninguna relación con cuál de las dos lecturas es la buena. Lo mismo aplica a
`consumoBar`, `monedaExtranjera`, `host`, `emisor` y `rfcReceptor`, que son las
otras dimensiones que una fila sin CFDI puede traer de `ocr_extra`.

**No es regresión de la 0359** (viene de `0355:122`), y lo verifiqué: la 0359
solo cambió qué filas caen en qué partición, no que la descartada se tire con
todo adentro. Lo reporto ahora porque es lo que quedó escrito en mi «no alcancé a
revisar» de ayer, y **ya está medido**: la pregunta de ayer era si al descartar la
copia se pierde una alerta, y la respuesta es sí. La parte numérica de esta
familia (`docs/auditoria-30/datos.md:150-165`) sí la cerró la 0359; la parte de
las banderas no.

**Refutación intentada.** Probé primero con `estado_sat='cancelado'` y
`efos=true` y **me refuté solo**: `ocr.ts:612` solo consulta al SAT `if (uuid)`,
y una fila con `cfdi_uuid` se dedupa por la rama del UUID, así que por la
aplicación esas dos banderas no llegan a la rama del folio. `renglones_ajenos`
sí: sale de `ocr_extra`, no necesita CFDI, y `0359:86-106` lo calcula fila por
fila. (De paso: la base **sí** acepta `estado_sat`/`efos` en una fila sin
`cfdi_uuid` —no hay restricción que los ate— y ahí el escenario también corre;
eso es deuda del mismo rubro, no el hallazgo.)

Causa raíz probable: `orden_copia = 1` decide identidad y **calidad de dato** con
el mismo criterio, y el único criterio disponible (`min(id)`) no sabe nada de
calidad.

### [MEDIO · REINCIDENTE, 3ª aparición] DAT30-B7 · 29 de los 56 archivos de `supabase/tests/` no los invoca nadie, y 3 de los que sí corren están ROJOS

`.github/workflows/ci-postgres.yml:176-202`,
`supabase/tests/0327_jornada_r2_regresiones.sql:81`,
`supabase/tests/0336_capacidad_r5_red.sql:86`,
`supabase/tests/0319_capacidad_jornada_wa.sql`

Recontado hoy, no releído: barrí los 56 archivos de `supabase/tests/` contra
`.github/`, `scripts/` y `package.json`. **29 no aparecen en ningún invocador**
(0319 a 0337, la familia de capacidad/GPS/jornada). Es la primera vez que además
se **ejecutan**: corrí los 16 que son `.sql` sobre esta base y **tres fallan**:

```
FAIL 0319_capacidad_jornada_wa.sql : ERROR: jornada derivacion ACK success delay
                                     must be between 1 and 86400 …
FAIL 0327_jornada_r2_regresiones.sql: ERROR: R2-07 RED: versión GPS no está
                                     acotada a unidades exclusivas
FAIL 0336_capacidad_r5_red.sql     : ERROR: new row for relation "posicion"
                                     violates check constraint
                                     "posicion_medida_en_no_futura"
```

**Perseguí el peor de los tres hasta el fondo y es bueno saber cómo terminó.**
`0327:81` afirma sobre el texto de `sellar_invalidacion_jornada_versionada` que
contenga `with unidades as`. Leí la definición viva: la 0331 la reescribió a un
`perform reconciliar_input_version_jornada(...)` de cinco líneas, y el `with
unidades as` / `join unidades u` se mudó a `calcular_input_version_jornada`,
donde **sigue existiendo** (lo verifiqué en el catálogo). O sea: la propiedad de
esquema se conserva y **el guardia está rojo por texto rancio**, desde hace 28
migraciones. Los otros dos son fixtures que violan CHECK que llegaron después.

**Consecuencia.** No es una cifra mala hoy; es que el rubro tiene 29 contratos de
esquema que no distinguen «la invariante se rompió» de «el archivo envejeció»,
y el día que uno se ponga rojo por la razón buena va a parecer lo mismo. Al
equipo le va a costar el doble: primero averiguar cuáles de los 29 siguen
diciendo algo, después arreglar lo que encuentren.

### [BAJO · REINCIDENTE, 3ª aparición] DAT32C-B1 · `rfc_emisor` es la llave de DOS cifras fiscales y sigue sin una sola restricción — y desde la 0359 el error se pinta también en el panel

`supabase/migrations/0001_init.sql:62`,
`supabase/migrations/0358_dedup_emisor_conocido.sql:101`,
`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:166`

`gasto` tiene 15 CHECK en esta base y **ninguno** nombra `rfc_emisor` (leído de
`pg_constraint`): sigue siendo `text` nullable, sin forma, sin caso canónico, sin
índice funcional. `nullif(…,'')` —la única normalización que hay— no recorta
espacios. Tres fotos del mismo ticket de $2,500 con el RFC guardado como
`ESA030303CCC`, `esa030303ccc` y `ESA030303CCC ` (con espacio):

```
=== P3 — misma estacion, 3 fotos, RFC en distinta caja/espacio. Verdad 2500
MOTOR  | 7500.00 | 7500.00
PANEL  | 7500.00 | 1034.49 | n=3
VERDAD | 7500.00 | 1034.49 | 3 filas
```

**Lo nuevo respecto de ayer no es el número: es el alcance.** Ayer solo el motor
del 15 % tenía a `rfc_emisor` en su llave; desde la 0359 el panel del contador
también. La misma ausencia de restricción ahora se lee en dos pantallas.

**Sigue siendo BAJO y me volví a refutar para dejarlo ahí:** los escritores
normalizan —`ocr.ts:557` hace `toUpperCase()` y quita todo lo que no sea
`[A-ZÑ&0-9]`, `cfdi.ts:92` exige `esRfcValido` antes de guardar, `cfdi_xml.ts:374`
y `rep.ts:154` hacen `toUpperCase()` sobre atributos que `fast-xml-parser` ya
entrega recortados (`trimValues` va en su default)—. La asimetría del propio
esquema es el argumento de que falta: `cfdi_uuid`, cuando fue llave de dedup, sí
recibió su CHECK `gasto_cfdi_uuid_minuscula` (leído del catálogo). `rfc_emisor`
hace hoy el mismo trabajo y no recibió nada.

### [BAJO · REINCIDENTE, 3ª aparición] DAT31-B1 · `retencion_iva` sigue siendo el único importe de `factura_emitida` sin escala

`supabase/migrations/0352_factura_retencion_iva.sql:10`

Releído del catálogo de esta base, no del archivo:

```
 iva           | numeric | precision 12 | scale 2 | not null | default 0
 subtotal      | numeric | precision 12 | scale 2 | not null
 total         | numeric | precision 12 | scale 2 | not null
 retencion_iva | numeric | precision —  | scale — | not null | default 0   ← la única sin escala
```

La base acepta $400.0044 de retención (el 4 % de $10,000.11), un importe fiscal
en fracciones de centavo que no existe en ningún CFDI y que
`factura_total_cuadra` (tolerancia `0.01`) deja pasar. El único escritor de hoy
(`facturacion_escritura.ts:107-109`) rechaza más de dos decimales; el segundo,
no. Tercera ronda sin moverse.

### [BAJO · REINCIDENTE, 3ª aparición] DAT31-B2 · `llm_costo_mensual.fase` sigue sin dominio y la base parte el costo de IA en dos renglones

`supabase/migrations/0072_purga_y_consolidado_ia.sql:59`

La tabla tiene exactamente dos CHECK, leídos del catálogo —
`llm_costo_mensual_mes_es_dia_1` y `llm_costo_mensual_no_negativo` — y ninguno
acota `fase`. Medido: el backfill de un mes cerrado con la fase mal tecleada
entra, y como la PK es `(tenant_id, mes, fase, modelo)`, son dos filas:

```
   fase   | costo_usd
 copilot  |      12.5
 copiloto |       7.5
```

La misma escritura contra `llm_costo` habría rebotado con 23514
(`llm_costo_fase_dominio`, ampliado por `0351:17`). El panel de costo de IA de
`/admin` pinta el gasto partido en dos.

### [ALTO · REINCIDENTE, 2ª aparición] DAT32C-A1 · el espejo TS↔SQL que `desde_db.ts:184` declara exacto sigue roto; la 0358 lo estrechó, no lo cerró

`src/lib/likida/cuadre/desde_db.ts:184`,
`src/lib/likida/cuadre/desde_db.ts:187-192`,
`src/lib/likida/cuadre/engine.ts:539-560`

Lo primero que fui a ver, porque era el encargo. **Lo estrechó y no lo cerró**, y
además el comentario envejeció otro escalón. `desde_db.ts:192` resta
`efectivoPrevEjercicio = max(0, RPC.efectivo − efectivoDeEsteViaje)`: el minuendo
lo da la RPC (hoy la 0358) y el sustraendo lo calcula `copiasDeComprobante`.
Releí `engine.ts:539-560` línea por línea: **sigue sin mirar `rfcEmisor` en
ninguna de sus dos ramas.**

- **Lo que la 0358 arregló de rebote:** el eje del emisor NULO. Antes, con la
  0357, dos fotos del mismo ticket con el RFC perdido eran copias para TS y no
  para SQL; hoy lo son para los dos. Esa mitad del hallazgo está cerrada.
- **Lo que sigue abierto:** el eje de la 0357. Con dos estaciones conocidas y
  distintas (P10 con los dos RFC leídos, arriba), SQL cuenta $5,000 y TS ve dos
  copias y cuenta $2,500 — así que `efectivoPrevEjercicio = 5000 − 2500 = $2,500`
  sobre un ejercicio cuyo previo real es **$0**. Con `tope = 0.15 × 5000 = $750`
  y `cupoRestante = max(0, 750 − 2500) = $0` (`engine.ts:814-816`), el PDF acusa
  de exceso a una flota que está dentro del 15 %.
- **Y el comentario ahora miente más fuerte:** `desde_db.ts:184` dice que
  `copiasDeComprobante` es «el espejo exacto del de la 0349». Van tres
  redefiniciones desde entonces (0357, 0358) y el texto no se tocó. La exención
  de la 0358 en `migraciones_verificadas.test.ts:78` sí lo dice bien
  («`copiasDeComprobante` sigue sin tocarse: corre sobre UN viaje»), o sea que la
  decisión está tomada a conciencia; lo que falta es que el código lo diga donde
  alguien lo va a leer al cambiarlo.

Causa raíz probable, la misma de ayer: el par RPC/TS está acoplado por un
comentario, no por una prueba. `fiscal_agregado_15pct.test.ts` **deriva** la
migración vigente (hoy la 0358, verificado: 5 pruebas verdes) pero solo compara
el `not in (...)` del numerador; el `partition by` no lo mira nadie.

---

## Lo que revisé y está bien

- **Las 336 migraciones aplican limpias sobre base virgen**, incluidas la 0358 y
  la 0359, con el preflight de índices de la 0332 en su sitio. No es lectura:
  `336 migraciones aplicadas limpias.` sobre `initdb` fresco.
- **El trasplante de 190 líneas de la 0359 está limpio.** Diff de
  `pg_get_functiondef` entre la 0355 restaurada y la viva: 25 líneas, todas el
  cambio declarado. Era el riesgo mayor del arreglo y no se materializó.
- **La 0358 tampoco arrastró nada.** Mismo diff contra la 0357: solo el CTE nuevo
  y el `partition by`.
- **Las dos migraciones son idempotentes y conservan su ACL.** Aplicadas dos
  veces cada una; después, las dos funciones con
  `proacl = {postgres=X/postgres,service_role=X/postgres}`, `prosecdef = f`,
  `proconfig = search_path=public, pg_catalog`. `anon` y `authenticated` siguen
  sin `EXECUTE` aunque ninguno de los dos archivos repita el `revoke`/`grant`.
- **Las dos pruebas nuevas son rojos reales, medidos en los dos sentidos.**
  0358 con la 0357 → `total=5000.00 (esperado 2500)`. 0359 con la 0355 →
  `panel=3500.00 (esperado 6000)`. Al restaurar, las dos verdes.
- **Los 21 archivos SQL que `ci-postgres.yml` sí invoca corren verdes** sobre
  esta base, del 0330 al 0359. (`wa_leases_fencing.sql` no corrió: necesita
  `pgtap`, que no está instalado aquí; no es un rojo.)
- **El bloque 267 de Capa 1 sigue verde con la 0359 puesta:**
  `FISCAL_SIN_COPIAS_0355 n=t monto=t iva=t distingue-distinto=t`. El arreglo no
  rompió la garantía de la 0355.
- **La regla de la 0358/0359 es monótona y no puede reintroducir C1.** De un
  grupo `(concepto, folio_norm, monto)` sobreviven tantas filas como emisores
  conocidos distintos haya: nunca menos que la 0349, nunca más que la 0357. Lo
  derivé del cuerpo y lo verifiqué con seis sondas (NULL en ambas, NULL en dos de
  tres, dos conocidos + NULL con el `id` menor en la fila sin emisor, espacios,
  caja, CFDI en el mismo grupo).
- **Una fila con CFDI en el mismo grupo de folio NO rompe la herencia del
  emisor.** Lo probé porque `row_number()` se evalúa para todas las filas del CTE
  aunque el `case` no use su rama, y temía que un CFDI contaminara el `min()`:
  no lo hace, la fila del CFDI ocupa la partición y absorbe a la fila sin emisor
  (P6: motor y panel $5,000, la verdad del caso).
- **`cfdi_uuid = ''` no puede colapsar el dedup del motor.** La 0358 lo pasaría
  por la rama del UUID con partición `('', 1)` —que juntaría todas las filas así—
  pero `uq_gasto_cfdi_uuid` lo impide en el `INSERT`:
  `duplicate key value violates unique constraint "uq_gasto_cfdi_uuid"`. La
  unicidad de la base tapa la diferencia de normalización. Refutado.
- **`fiscal_agregado_15pct.test.ts` sigue derivando sola la migración vigente** y
  hoy apunta a la 0358: 5 pruebas verdes. La lección de ARQ-A de la ronda 30
  aguantó dos migraciones más.
- **`tsc --noEmit -p .` exit 0**, y `migraciones_verificadas.test.ts` (20),
  `repo_acumulado.test.ts` (16) y `fiscal_agregado_15pct.test.ts` (5) verdes con
  los tres ALTO de arriba puestos. Lo anoto como hallazgo invertido, igual que
  ayer.
- **Las exenciones de la 0358 y la 0359 en `migraciones_verificadas.test.ts:78-79`
  están justificadas y su afirmación es verificable.** Las dos declaran que su
  prueba corre en ci-postgres, y corre (`ci-postgres.yml:200-201`); ninguna crea
  unicidad, atomicidad ni permiso nuevo, que es el criterio escrito del propio
  archivo. Además describen la mutación en los dos sentidos con las cifras
  exactas que yo medí por separado — coinciden.
- **Los tres BAJO reincidentes se midieron otra vez, no se releyeron.** Las
  cifras de arriba salieron de `information_schema`, `pg_constraint` y de
  `INSERT` que la base aceptó.

## Lo que NO alcancé a revisar

- **Los ~88 ataques dinámicos de Capa 1 (`supabase/verificaciones.sql`).** Corrí
  **uno** (el bloque 267, el que toca la función que se cambió). Es la misma
  deuda que dejé ayer y la vuelvo a dejar: tenía la base levantada y el archivo
  a mano. En este rubro lo que no se corre no se sabe — el falso DAT31-M1 de la
  ronda 31 lo demostró.
- **Los 13 archivos `.sh` de `supabase/tests/` sin invocador** (concurrencia de
  GPS, capacidad y calcom). Solo corrí los 16 `.sql`. Los `.sh` abren dos
  sesiones y no los probé; el conteo de 29 huérfanos los incluye pero su estado
  rojo/verde lo desconozco.
- **Reversibilidad como clase, tercera ronda sin publicar.** Verifiqué la doble
  reaplicación de DOS migraciones (0358 y 0359) porque era el encargo. Los 17
  `add column` sin `if not exists`, los 8 `create table` sin guarda y los 38
  `create policy` sin `drop policy if exists` que conté en la 31 siguen sin
  depurarse de falsos positivos, y hoy tenía Postgres para aplicar cada
  migración dos veces, que es la medición definitiva. No la hice.
- **Los ~40 triggers como conjunto.** Igual que la 31 y la 32. Un trigger que
  sustituye a un CHECK se apaga con `alter table … disable trigger`; no medí
  cuántas invariantes del esquema dependen de uno. `gasto` tiene 5 y no los
  abrí.
- **RLS.** No la toqué esta ronda: 155/155 era el estado de la 31 y ni la 0358 ni
  la 0359 crean política. Que siga en 155/155 lo estoy heredando, no midiendo.
- **Las otras 23 dimensiones de `gastos_fiscales_agregados_tenant`.** Medí
  `monto`, `iva`, `n`, `renglonesAjenos`, `efos`, `estadoSat`, `rfcEmisor` y
  `muestraId`. El veredicto de deducibilidad completo y `ivaSostenible` siguen
  sin comprobarse contra el dedup nuevo.
- **La aditividad por periodo del panel.** `getGastosFiscalesSeries`
  (`fiscal.ts:1743-1748`) pinta en la MISMA pantalla tres ventanas solapadas (7
  días, 30 días, todo) y el dedup corre dentro de cada una. Construí el caso en
  papel y me quedé sin medirlo; no afirmo nada sobre él.
- **Producción.** Todo corrió sobre un Postgres virgen con las 336 migraciones.
  Que el cuerpo de estas dos funciones en `app.likida.ai` sea el mismo sigue sin
  poder comprobarse desde aquí — y con el último `[deploy]` del 10-sep, hay
  razones para dudarlo.
