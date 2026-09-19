# Modelo de datos y esquema — auditoría 32 (continuación 17-sep)

**Nota: 5/10** (antes 7). Razón del movimiento: **deuda que cobró factura.** El
esquema *estático* no se movió — las unicidades siguen puestas, RLS sigue en
155/155, y la ronda 31 seguía siendo justa para lo que midió. Lo que se movió es
el SQL que el esquema **ejecuta**: la única migración de la ventana (`0357`,
`f0645f9`) cambió la llave de dedup de una cifra fiscal, y medida contra un
Postgres 16 real con las **334 migraciones aplicadas limpias**, esa llave nueva
produce **dos regresiones reproducibles** en la dirección contraria a la que la
propia migración declara segura, y deja a su función hermana contradiciéndola
**2 a 1 sobre las mismas dos filas**. Dos rondas seguidas dando 7 sobre lectura
de archivos no vieron que bastaba correr la base para separar lo que el SQL
*dice* de lo que el SQL *hace*: de mis tres hallazgos abiertos, uno (DAT31-M1)
resultó **falso** —el CHECK que reporté como ausente existe desde
`0144:23`— y lo descubrió un `INSERT`, no una relectura.

**El riesgo mayor del rubro hoy:** el esquema tiene DOS funciones que aplican el
mismo predicado de «mismo comprobante» sobre universos grandes, y desde ayer ya
no dicen lo mismo — sobre las mismas dos filas, una contesta $5,000 y la otra
$2,500, y las dos van a la cara del contralor.

**Cómo se midió todo lo de abajo.** Cluster PostgreSQL 16.13 efímero
(`/usr/lib/postgresql/16/bin/initdb`, `su postgres`, puerto 5433),
`andamio_ci.sql` y después las 334 migraciones una por una con la receta de
`.github/workflows/ci-postgres.yml:143-169`:

```
andamio ok
334 migraciones aplicadas limpias.
```

Cada bloque de salida pegado abajo salió de ese cluster. Todos los `probe`
corren dentro de `begin; … rollback;`.

---

## Veredicto sobre la migración 0357

**El arreglo va en la dirección correcta, su prueba es un RED→GREEN de verdad, y
aun así cierra a medias y abre dos regresiones nuevas.** Las cinco preguntas del
encargo, contestadas con medición:

### 1. ¿Es correcta y reversible? ¿Qué pasa si se aplica dos veces?

**Sí a las dos, y lo medí.** Es `create or replace` con la misma firma, el mismo
`set search_path = public, pg_catalog` y `security invoker` heredado. La apliqué
dos veces seguidas sobre la base ya migrada:

```
0357 reaplicable dos veces: OK
```

Y la ACL sobrevive al `create or replace`, que es lo que hace que la ausencia de
`revoke`/`grant` en el archivo (la 0349 y la 0355 sí los repiten) no sea un
hallazgo:

```
proname   | sumar_combustible_ejercicio
prosecdef | f
proacl    | {postgres=X/postgres,service_role=X/postgres}
proconfig | {"search_path=public, pg_catalog"}
```

`anon` y `authenticated` siguen sin `EXECUTE`. No hay migración de bajada, pero
no la hay para ninguna de las seis que definieron esta RPC (`0084`, `0112`,
`0190`, `0305`, `0345`, `0349`): revertir es reaplicar la anterior, y lo hice en
vivo sin error para producir la evidencia de abajo.

### 2. `coalesce(rfc_emisor, '')`: ¿hace lo que el comentario dice?

`supabase/migrations/0357_dedup_ejercicio_por_emisor.sql:71` y `:90`

Para los **dos** comprobantes sin emisor, sí: `nullif(rfc_emisor,'')` manda `''`
a NULL, `coalesce(…,'')` los regresa a `''`, y caen en la misma partición. (De
hecho el `coalesce` es redundante: `PARTITION BY` ya agrupa los NULL entre sí.
Lo comprobé; es inocuo.)

**El problema es el caso que el comentario no enumera.** `:41-44` declara TRES
direcciones —emisores distintos, mismo emisor, emisor nulo en AMBOS— y la prueba
fija esas tres. Falta la cuarta, que es la más frecuente de todas: **emisor en
uno y NULL en el otro.** Ahí `coalesce` produce `'ESA030303CCC'` contra `''`, dos
particiones, dos comprobantes. Eso es el hallazgo DAT32C-C1 y está medido abajo.

### 3. ¿La prueba fija la invariante o la implementación?

**Fija la invariante en el eje que toca, y es un rojo real** — lo rompí de verdad
restaurando la definición de la 0349 sobre la base ya migrada:

```
=== ¿la prueba 0357 se pone ROJA con la 0349? ===
ERROR:  ARQ-A3: dos emisores distintos con el mismo folio se colapsaron:
        total=2500.00 (esperado 5000)
ROJA (bien)
```

Eso es más de lo que varias pruebas de este repo pueden decir de sí mismas.
**Pero su cobertura es de un solo eje.** La rompí mentalmente por los otros tres
y seguiría verde: si alguien quita `monto` de la partición, verde (los tres casos
usan montos iguales entre sí); si quita `unaccent(lower(concepto))`, verde (todo
es `'diesel'`); y el caso 3 no distingue `coalesce(rfc_emisor,'')` de
`rfc_emisor` pelado, porque `PARTITION BY` ya junta los NULL. Sobre todo: **no
hay un solo caso con emisor en una fila y NULL en la otra**, que es justo la
dirección que la migración abrió.

### 4. La entrada en EXENTAS: ¿qué guardia se desactiva, y estaba justificado?

`src/lib/likida/migraciones_verificadas.test.ts:77`

El guardia obliga a que toda migración tenga **o** un bloque en
`supabase/verificaciones.sql` (la batería de Capa 1, con tenants reales) **o** una
razón escrita. Con la entrada, la 0357 no lleva bloque. **Estaba justificado**, y
por dos motivos que sí comprobé: (a) el criterio escrito del propio archivo
(`:46-51`) exige bloque cuando la migración crea unicidad, atomicidad o permisos
—la 0357 no crea ninguna de las tres, es la misma agregación con una columna más
en el `partition by`—, y (b) a diferencia de las exenciones de la 0333/0334/0336
/0337, que dicen textualmente «Esta exención no afirma integración en
ci-postgres», **ésta afirma que su prueba corre y es cierto**:
`.github/workflows/ci-postgres.yml:199`. Correr la prueba contra Postgres es
evidencia más fuerte que un bloque estático. Aquí no hay hallazgo.

### 5. ¿Queda otra función con el mismo supuesto roto?

**Sí, exactamente una, y es la hermana que la 0357 no tocó.** Barrí las 334
migraciones por `row_number() over`: hay seis sitios. Cuatro están correctamente
acotados a UN viaje o a otra cosa (`0321:286`, `0354:238`, `0274`, `0027`). Los
otros dos son los que portan el criterio de `copiasDeComprobante` a un universo
grande:

| Función | Universo | Partición del folio hoy |
|---|---|---|
| `sumar_combustible_ejercicio` | tenant + ejercicio (`0357:75-76`) | **con** `rfc_emisor` (`0357:90`) |
| `gastos_fiscales_agregados_tenant` | tenant + rango de fechas (`0355:97-98`) | **sin** `rfc_emisor` (`0355:110`) |

La segunda **ya calcula `nullif(g.rfc_emisor,'')` doce líneas arriba**
(`0355:30`) y lo publica como dimensión de celda (`0355:139`, `:188`). La columna
estaba en la mano. Es el hallazgo DAT32C-C2.

---

## Hallazgos

### [CRÍTICO] DAT32C-C1 — la 0357 metió a la llave de dedup el único campo que el OCR convierte en NULL con un carácter mal leído: dos fotos del MISMO ticket dejaron de ser copias

`supabase/migrations/0357_dedup_ejercicio_por_emisor.sql:90`,
`supabase/migrations/0357_dedup_ejercicio_por_emisor.sql:41-44`,
`src/lib/likida/intake/ocr.ts:557-560`,
`supabase/migrations/0001_init.sql:62`

**Escenario, con valores.** El chofer manda **dos fotos del mismo ticket** de
diésel de $2,500 (folio 1234) — el caso que el dedup por folio existe para
atrapar, porque `uq_gasto_img_hash` solo bloquea bytes idénticos y dos
fotografías del mismo papel nunca lo son. En la primera el OCR lee
`CCO8605231N4` y pasa el dígito verificador. En la segunda confunde un carácter
—el comentario de `ocr.ts:550-556` lo dice con el ejemplo propio: «se le vio
devolver PER/PEX/PTE donde decía PEC»— y `ocr.ts:559-560` hace
`rfc = rfcDvOk ? rfcLeido : undefined`, así que esa fila entra con
`rfc_emisor = NULL`. Medido contra la base:

```
=== con la función de la 0349 (ANTES del arreglo) ===
 CASO A  (misma foto, RFC leido en una sola) | total 2500.00 | efectivo 2500.00
=== con la función de la 0357 (HOY) ===
 CASO A  (misma foto, RFC leido en una sola) | total 5000.00 | efectivo 5000.00
```

La verdad son $2,500. **La 0349 acertaba y la 0357 falla.** Es una regresión
introducida por el arreglo, no una deuda heredada.

Y el error se amplifica en el motor. `engine.ts:812` calcula `tope = 0.15*total`
sobre el total ya inflado: tope $750 donde debe ser $375; y `efectivo` inflado
entra al contador por `desde_db.ts:192`. El PDF acaba imprimiendo, con el texto
literal de `engine.ts:828`, «el ejercicio lleva **$5,000.00** de combustible
pagado con medios que la LISR 27-III no admite» cuando la flota compró $2,500, y
niega los $375 de deducción que la facilidad sí concede.

**Intenté refutarlo por tres lados y sobrevive.** (a) *«`uq_gasto_img_hash` lo
para»* — no: son dos fotos distintas, y si parara este caso el dedup por folio de
la 0349 no tendría razón de existir. (b) *«el OCR casi siempre lee el RFC»* — el
propio código dice lo contrario: `ocr.ts:558-561` exige forma **y** dígito
verificador, y guarda aparte el `rfcDudoso` precisamente porque falla seguido.
(c) *«la dirección segura es fallar hacia copia y eso se conservó»* — es lo que
`0357:41-44` afirma, y es falso para este caso: aquí falla hacia **NO copia**, que
es la dirección que la propia cabecera llama peligrosa.

**Lo que lo vuelve estructural:** todos los demás elementos de esa partición
vienen del OCR y **todos** están normalizados contra la variación entre dos
lecturas del mismo papel — `concepto` con `unaccent(lower(...))`, el folio con
`folio_norm` (que existe por esto exacto: `engine.ts:545-552`, «el mismo folio
aparecía como `286188` y como `059286188`»), `cfdi_uuid` con `lower()`. La 0357
agregó el único que no tiene ninguna normalización y que además **puede
desaparecer entera**.

Causa raíz probable: la migración razonó el emisor como identidad fiscal estable
(lo es en un CFDI) y lo aplicó a la rama que corre **precisamente cuando no hay
CFDI**, donde el emisor es un dato de visión artificial.

### [CRÍTICO] DAT32C-C2 — el arreglo cerró una de las dos copias: `gastos_fiscales_agregados_tenant` sigue colapsando dos estaciones distintas, y las dos funciones fiscales ya se contradicen 2 a 1

`supabase/migrations/0355_gastos_fiscales_sin_copias.sql:110`,
`supabase/migrations/0355_gastos_fiscales_sin_copias.sql:30`,
`supabase/migrations/0357_dedup_ejercicio_por_emisor.sql:90`

**Escenario, con valores.** Exactamente el caso de manual de la 0357: dos tickets
de diésel de $2,500, folio `1234` los dos, de las estaciones `ESA030303CCC` y
`ESB040404DDD`, en dos viajes y dos meses del ejercicio 2026, con $344.83 de IVA
trasladado cada uno. Las mismas dos filas, contra las dos funciones, en la misma
transacción:

```
sumar_combustible_0357 | 5000.00     ← el 15% ya cuenta las dos (arreglado)
panel_fiscal_0355      | 2500.00     ← el panel del contador cuenta UNA
iva_panel_0355         |  344.83     ← se evaporó el IVA acreditable de la otra
verdad_en_la_base      | 5000.00
iva_verdad             |  689.66
```

La celda que el panel publica lo dice sola: `n: 1`, `monto: 2500.00`,
`rfcEmisor: "ESA030303CCC"`. La estación B desapareció del tablero fiscal — no
como advertencia, como ausencia.

**Consecuencia.** Le pega a dos personas distintas. Al **contralor**, que abre
`/dashboard/fiscal`, ve $2,500 de diésel en el periodo y $344.83 de IVA
acreditable, cruza contra su póliza y encuentra $5,000 y $689.66: la regla del
producto que dice que un rótulo tiene que ser verdad se rompe con la cifra que él
va a cotejar en la sala. Y al **equipo**, porque a partir de hoy la misma
pregunta tiene dos respuestas según qué pantalla la haga — que es literalmente el
criterio escrito en `CLAUDE.md` («una cifra fiscal que se lee distinto en dos
pantallas se lee como dos cálculos»). Además el IVA perdido no se recupera: el
`orden_copia = 1` de `0355:122` tira la fila entera antes de agregar, no la marca.

**Refutación intentada:** *«la 0357 declara fuera de alcance no tocar
`copiasDeComprobante`»* — cierto y correcto, ésa corre sobre UN viaje. Pero
`0355:110` **no** corre sobre un viaje: su `where` es `tenant_id = p_tenant` más
un rango de fechas (`:96-98`), que el panel llena con el año completo. Es el
mismo universo grande y el mismo supuesto roto que la 0357 fue a arreglar, en la
función de al lado, con la columna ya calculada tres CTE arriba.

Causa raíz probable: ARQ-A3 se diagnosticó sobre `engine.ts:812` (el tope del
15%) y el arreglo siguió ese hilo hasta su RPC, sin barrer quién más había
copiado el predicado — que es la enfermedad que el propio comentario de
`desde_db.ts:185` lleva ocho rondas nombrando.

### [ALTO] DAT32C-A1 — la 0357 rompió el espejo TS↔SQL que `desde_db.ts` declara exacto, y el contador del ejercicio previo queda con dinero que ese viaje todavía no gastó

`src/lib/likida/cuadre/desde_db.ts:184`,
`src/lib/likida/cuadre/desde_db.ts:187-192`,
`src/lib/likida/cuadre/engine.ts:514-561`

`desde_db.ts:192` resta: `efectivoPrevEjercicio = max(0, RPC.efectivo −
efectivoDeEsteViaje)`. El minuendo lo da la RPC; el sustraendo lo calcula TS con
`copiasDeComprobante` (`:187`). El comentario de `:184` fija el contrato en una
frase: «`copiasDeComprobante` es el criterio del propio motor y **el espejo
exacto** del de la 0349». **La 0357 movió un lado del espejo y no el otro:**
`copiasDeComprobante` (`engine.ts:540-560`) no mira `rfc_emisor` en ninguna de sus
dos ramas — lo verifiqué línea por línea.

**Escenario, con valores.** Un viaje con las dos fotos del mismo ticket de $2,500
de DAT32C-C1 (o con dos estaciones distintas de mismo folio y mismo total, el
caso que la 0357 fue a arreglar). TS dice `efectivoDeEsteViaje = $2,500` (para
él son copias); la RPC dice `efectivo = $5,000`. Entonces
`efectivoPrevEjercicio = 5000 − 2500 = $2,500` cuando el previo real de las
otras liquidaciones es **$0**. Con `tope = 0.15 × 5000 = $750` y
`cupoRestante = max(0, 750 − 2500) = $0` (`engine.ts:815-818`), el primer
comprobante sale con excedente completo y el PDF imprime «el excedente de
$2,500.00 de ESTE comprobante NO se deduce» sobre un ejercicio que no ha
consumido un peso de tope.

**Consecuencia.** El PDF acusa de exceso a una flota que está dentro del 15 %, y
la cifra «previo del ejercicio» no se puede reconstruir desde ninguna pantalla:
es una resta entre dos criterios distintos. Esta es la misma familia de ARQ-C2
—documentada en `desde_db.ts:173-186` como ya arreglada— **reabierta por el
arreglo de ARQ-A3**, con el error ahora del lado contrario (quita cupo en vez de
regalarlo), que sigue siendo una cifra falsa.

Causa raíz probable: el par RPC/TS está acoplado por un comentario, no por una
prueba: ninguna de las 25 pruebas que corrí (`repo_acumulado.test.ts`,
`fiscal_agregado_15pct.test.ts`, `migraciones_verificadas.test.ts`) mira el
criterio de dedup, y las tres pasan verdes hoy.

### [BAJO] DAT32C-B1 — `rfc_emisor` ascendió de columna de despliegue a llave de una cifra fiscal sin una sola restricción en la base

`supabase/migrations/0001_init.sql:62`,
`supabase/migrations/0357_dedup_ejercicio_por_emisor.sql:90`,
`src/lib/likida/intake/ocr.ts:557`

`gasto.rfc_emisor` es `text` pelado desde la 0001. Lo confirmé contra el catálogo:
nullable, sin CHECK de forma, sin normalización de caso, sin índice funcional
—las 10 columnas «uuid» del esquema sí la tienen, y ésta ahora hace el mismo
trabajo que ellas—. Desde ayer decide si dos filas son el mismo comprobante.

**Escenario, con valores.** Tres fotos del mismo ticket de $2,500 con el RFC
guardado como `ESA030303CCC`, `esa030303ccc` y `ESA030303CCC ` (con espacio):

```
CASO B (misma foto x3, RFC en distinta caja/espacio)
   con la 0349:  total 2500.00
   con la 0357:  total 7500.00
```

**Hoy no muerde por la aplicación, y por eso es BAJO y no ALTO** — lo intenté
refutar y me refuté: los cuatro escritores normalizan a mayúsculas
(`ocr.ts:557`, `cfdi.ts:92`, `cfdi_xml.ts:374`, `rep.ts:154`). Ése es exactamente
el patrón que este rubro existe para señalar: la invariante la sostiene el código,
no la base, y un backfill, la consola de Supabase o el quinto escritor no pasan
por ahí. La asimetría lo confirma: `cfdi_uuid` **sí** tiene su CHECK
`= lower(...)` (`0158:392-429`) por esta misma razón, cuando era llave de dedup.

Causa raíz probable: la 0357 promovió la columna a llave sin darle el trato de
llave.

### [BAJO · REINCIDENTE, 2ª aparición] DAT31-B1 — `retencion_iva` sigue siendo el único importe de `factura_emitida` sin escala, y la base la acepta en fracciones de centavo

`supabase/migrations/0352_factura_retencion_iva.sql:10`

Verificado hoy contra el catálogo, no contra el archivo:

```
 subtotal      | numeric(12,2) | not null
 iva           | numeric(12,2) | not null | 0
 total         | numeric(12,2) | not null
 retencion_iva | numeric       | not null | 0     ← la única sin escala
```

Y la fila entra:

```
 DAT31-B1 | subtotal 10000.11 | iva 1600.02 | retencion_iva 400.0044 | total 11200.13
```

$400.0044 es la retención del 4 % sobre $10,000.11 — un importe fiscal en
fracciones de centavo que no existe en ningún CFDI, aceptado por la base, y que
`factura_total_cuadra` (`0352:15`, tolerancia `0.01`) deja pasar. El único
escritor de hoy (`facturacion_escritura.ts:107-109`) rechaza más de dos
decimales; el segundo, no.

### [BAJO · REINCIDENTE, 2ª aparición] DAT31-B2 — `llm_costo_mensual.fase` sigue sin dominio, y la base parte el costo de IA en dos renglones

`supabase/migrations/0072_purga_y_consolidado_ia.sql:59`

`fase text not null`, sin CHECK — la tabla solo tiene
`llm_costo_mensual_mes_es_dia_1` y `llm_costo_mensual_no_negativo` (`:68-70`).
Medido: el backfill de un mes cerrado con la fase mal tecleada entra sin
protestar, y como la PK es `(tenant_id, mes, fase, modelo)`, son **dos filas**:

```
 DAT31-B2 | copilot  | 12.5
 DAT31-B2 | copiloto |  7.5
```

La misma escritura contra `llm_costo` habría rebotado con 23514
(`llm_costo_fase_dominio`, ampliado por `0351:17`). El panel de costo de IA de
`/admin` pinta dos renglones con el gasto partido.

### [BAJO · CORRECCIÓN DE MI PROPIA RONDA] DAT31-M1 era falso en su parte principal; queda un resto menor

`supabase/migrations/0144_rls_liquidacion_finanzas_y_check_factura_proveedor.sql:23`,
`supabase/migrations/0091_factura_proveedor.sql:30-31`

**Reporté en la 31 que `factura_proveedor` no tiene piso en ninguno de sus tres
importes. Es falso, y lo desmintió la base:**

```
ERROR:  new row for relation "factura_proveedor" violates check constraint
        "factura_proveedor_total_positivo"
```

`0144:23` pone `check (total > 0)` desde hace meses, tres líneas encima del
`factura_proveedor_conceptos_positivo` que sí enumeré en `0144:26`. El escenario
de la nota de crédito en `-4640.00` que escribí con tanto detalle **no puede
ocurrir**: `total` es el importe que los tres layouts (`proveedores.ts:365`,
`:397`, `:425`) publican siempre, y está protegido. Lo digo porque la ronda 31
usó ese hallazgo como argumento de su nota.

Queda un resto, comprobado en la misma corrida: con `total > 0`, la base **sí**
acepta `sub_total = -4000.00` e `iva = -640.00`, y `aFilaContpaqi`
(`proveedores.ts:425`) publica `subtotal`. Es un resto de BAJO, no el MEDIO que
reporté.

---

## Lo que revisé y está bien

- **Las 334 migraciones aplican limpias sobre base virgen, incluida la 0357.**
  No es lectura: `334 migraciones aplicadas limpias.` sobre `initdb` fresco con
  `andamio_ci.sql`. La 0357 no rompió el replay.
- **La 0357 es idempotente y conserva su ACL.** Aplicada dos veces sin error;
  `proacl = {postgres=X/postgres,service_role=X/postgres}` después, o sea que
  `anon` y `authenticated` siguen sin `EXECUTE` aunque el archivo no repita el
  `revoke`/`grant` que la 0349 y la 0355 sí traen. `prosecdef = f` (invoker) y
  `proconfig = search_path=public, pg_catalog` intactos.
- **La prueba de la 0357 es un rojo real, no decorativo.** Restauré la definición
  de la 0349 y la prueba **falló** con el mensaje esperado; volví a la 0357 y
  pasó. Lo mismo la de la 0349, que sigue verde después del cambio: el arreglo no
  rompió la garantía anterior.
- **Su exención en EXENTAS está justificada y su afirmación es verificable.**
  `migraciones_verificadas.test.ts:77` dice que la prueba corre en ci-postgres, y
  corre: `ci-postgres.yml:199`. Es de las pocas exenciones del archivo que no se
  escuda en «esta exención no afirma integración en ci-postgres».
- **Las otras cuatro `row_number() over (partition by …)` del esquema están en su
  universo correcto.** `0321:286` y `0354:238` deduplican con
  `where … and g.viaje_id = p_viaje` — UN viaje, que es donde el criterio de
  `copiasDeComprobante` es válido. `0274:34` (teléfono normalizado de WhatsApp) y
  `0027:84` (img_hash por tenant) no tocan identidad de comprobante.
- **`acreditables_liquidacion_tenant` no es una tercera copia del predicado.**
  `0308` suma de `liquidacion`, no de `gasto`: los snapshots ya vienen deduplicados
  por viaje, así que el supuesto roto no le aplica.
- **El guardia que ata `engine.ts` con el `.sql` vivo sí se movió solo.**
  `fiscal_agregado_15pct.test.ts:54-63` **deriva** la migración vigente (la última,
  por orden, que define la función) en vez de tenerla tecleada, y hoy apunta a la
  0357 y pasa. La lección de ARQ-A de la ronda 30 quedó bien aprendida. (Lo que no
  hace es mirar el dedup — por eso DAT32C-A1.)
- **Los tres archivos de prueba que rodean el cambio están verdes.**
  `npx vitest run migraciones_verificadas.test.ts fiscal_agregado_15pct.test.ts
  repo_acumulado.test.ts` → 3 archivos, **25 pruebas, 25 verdes**. Lo anoto como
  hallazgo invertido: pasan verdes con las tres regresiones de arriba puestas.
- **Los dos BAJO reincidentes se midieron esta vez, no se releyeron.** DAT31-B1 y
  DAT31-B2 traen la salida del `INSERT` que la base aceptó, no la línea del
  archivo.
- **`gasto` no tiene índice único por folio, y es correcto.** Confirmado contra
  `pg_indexes`: 12 índices, las tres unicidades de dedup (`uq_gasto_cfdi_uuid`,
  `uq_gasto_img_hash`, `uq_gasto_wa_message_id`) y ninguna sobre `folio` — lo
  contrario rechazaría dos tickets legítimos de estaciones distintas en el
  `INSERT`, que es el bug que la 0357 vino a arreglar un nivel más arriba.

---

## Lo que NO alcancé a revisar

- **El resto de `verificaciones.sql` y de `supabase/tests/`.** Tenía la base
  levantada y corrí exactamente cuatro archivos SQL (0349, 0357 y dos sondas
  propias). Los ~88 ataques dinámicos de la Capa 1 y los otros 51 archivos de
  `supabase/tests/` **no se ejecutaron**, teniendo con qué. Es la deuda más cara
  de esta ronda: el hallazgo DAT31-M1 falso prueba que en este rubro lo que no se
  corre no se sabe.
- **DAT30-B7 sin recontar.** Los 29 archivos de `supabase/tests/` sin invocador en
  `ci-postgres.yml` siguen abiertos desde la 30; no volví a contarlos ni miré su
  interior.
- **Reversibilidad como clase, otra vez sin publicar.** Verifiqué la reaplicación
  de UNA migración (la 0357) porque era el encargo. Los 17 `add column` sin
  `if not exists`, los 8 `create table` sin guarda y los 38 `create policy` sin su
  `drop policy if exists` que conté en la 31 siguen sin depurarse de falsos
  positivos — y ahora tenía Postgres para hacerlo aplicando cada migración dos
  veces, que es la medición definitiva. No la hice.
- **Los ~40 triggers como conjunto.** Igual que la 31. Un trigger que sustituye a
  un CHECK se puede apagar con `alter table … disable trigger`; no medí cuántas
  invariantes del esquema dependen de uno.
- **Si el alcance de DAT32C-C2 es peor de lo que muestro.**
  `gastos_fiscales_agregados_tenant` produce 26 dimensiones; solo medí `monto`,
  `iva` y `n`. No comprobé qué le pasa a `ivaSostenible` ni al veredicto de
  deducibilidad cuando la fila que se cae es la que traía el defecto (EFOS,
  complemento de hidrocarburos, `estado_sat = 'cancelado'`): si la copia
  descartada es la mala y la conservada la buena, el panel no solo pierde un
  importe — pierde una alerta.
- **Producción.** Todo lo de arriba corrió sobre un Postgres virgen con las 334
  migraciones. Que el cuerpo de estas funciones en `app.likida.ai` sea el mismo
  sigue sin poder comprobarse desde aquí.
