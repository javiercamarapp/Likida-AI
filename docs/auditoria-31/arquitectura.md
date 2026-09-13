# Arquitectura y mantenibilidad — auditoría 31

**Nota: 4/10** (antes 3). Razón del movimiento: **se atacó y subió**, y solo
hasta el tope que el ancla permite.

Dos de los once hallazgos abiertos de la 30 —ARQ-C2 y ARQ-A1— **están cerrados
de verdad**, verificados línea por línea, y uno de los dos se cerró con el
mecanismo correcto y no con un parche: el guardia TS↔SQL ya no teclea la ruta
del `.sql`, la **deriva** (`fiscal_agregado_15pct.test.ts:53-63`, `rutaVigente()`)
y además falla si aparece una migración posterior que redefina la función
(`:78-87`). Eso es exactamente lo que este rubro le venía pidiendo al repo desde
la ronda 24, y es contable: guardias que derivan su objetivo en vez de fijarlo,
**0 → 1**.

No sube más porque el ancla del rubro es aritmética: «*4 o menos si la misma
lógica de dinero vive en más de un archivo*». Vive.

| Cosa contada | Ronda 30 | Hoy (31) |
|---|---|---|
| Copias del predicado «esto es combustible del 15 %» | 6 | **6** |
| Implementaciones de «esto es copia del mismo comprobante» | 5 (1 TS + 4 SQL) | **5** (1 TS + 4 SQL) |
| Universos distintos sobre los que se aplica ese dedup | 2 (viaje, ejercicio) | **3** (viaje, ejercicio, ventana del panel) |
| Deciders de «qué régimen SAT abre el 15 %» | 3 + 1 canónica | **3 + 1 canónica** |
| Veces que se teclea el factor `0.15` del tope | 3 | **3** |
| Copias del techo de reintentos del inbox (`5`) | 11 | **11** |
| Funciones SQL **vivas** que teclean `MEDIOS_LISR_27_III` | 2 | **2** (el guardia nuevo cubre 1) |
| `vi.mock` de `TenantEfectivo` sin atar al tipo real | 14 (los de la ventana) | **21 / 21** en todo `src/` |
| Hallazgos abiertos de la ronda previa que siguen intactos | 8 de 8 | **9 de 11** |

**El riesgo mayor del rubro, hoy:** el dedup de comprobantes se escribe cinco
veces y ahora se aplica sobre **tres universos distintos** —un viaje, un
ejercicio, la ventana que el usuario eligió en el panel—; el criterio se
calibró para un universo de ~20 gastos de un viaje y hoy se corre sobre
decenas de miles de filas de un tenant-año, donde colapsa comprobantes que no
son copias. Dos de esos tres universos ya imprimen cifras distintas del mismo
hecho, una de ellas en el PDF que el contralor firma.

> **Método.** Todo medido en `claude/auditoria-31`, HEAD `4047a50`, árbol
> limpio. `npx tsc --noEmit -p .` → **exit 0**. `npx vitest run
> fiscal_agregado_15pct desde_db_efectivo_previo repo_acumulado tope_consulta
> sin_importar_app etiquetas_sincronizadas costos_dominio` → **7 archivos, 50
> pruebas, verdes**. Los conteos de la tabla son `grep` sobre fuente de
> producción (sin `*.test.*`), pegados en cada hallazgo. No hay base ni red: la
> aritmética de los escenarios es aritmética sobre el SQL y el TS leídos.
> **Nota de método sobre los commits:** el MAPA cita `b740fe0`, `7a9b087` y
> `7d5bcdc`; esos SHA **no existen en este repo** (`git cat-file -t` → missing)
> porque el PR de la 30 entró aplastado en `5ce91b2`. Los arreglos **sí** están
> en el árbol; lo verifiqué contra el código, no contra el SHA. No edité ningún
> archivo del repo fuera de este documento.

---

## Lo que se cerró (y por qué justifica el punto)

**ARQ-C2 — CERRADO.** `src/lib/likida/cuadre/desde_db.ts:187-192`. El
sustraendo ya dedupa: `const copias = copiasDeComprobante(gastos)` y el
`.filter` arranca con `!copias.has(g.id)`. Se **reusó** la función del motor en
vez de escribir una tercera copia del predicado, que era la mitad importante.
La prueba que lo fija existe y reproduce el caso
(`desde_db_efectivo_previo.test.ts:178`, «dos fotos del MISMO ticket se restan
UNA vez»; $100,000 de acumulado y un ticket de $4,700 duplicado → previo
$95,300, no $90,600). Verde hoy.

**ARQ-A1 — CERRADO, y bien.** `src/lib/likida/fiscal_agregado_15pct.test.ts:53-63`
(`rutaVigente()` lee `supabase/migrations`, filtra las que definen
`sumar_combustible_ejercicio` y toma la última en orden léxico) y `:78-87` (un
`it` que exige que **no exista** una migración posterior que la redefina, con el
mensaje «el guardia está validando SQL muerto»). Hoy resuelve a
`0349_combustible_15_sin_copias.sql` y las cuatro aserciones pasan sobre la
definición viva.

Los dos arreglos son reales. Es la única vez en ocho rondas que este rubro
puede escribir esa frase.

---

## Hallazgos

### [CRÍTICO · REINCIDENTE de la 30, y ahora con cifra] ARQ-A3 — el dedup del ejercicio colapsa comprobantes que NO son copias, y el PDF regala cupo del 15 %

`supabase/migrations/0349_combustible_15_sin_copias.sql:58-65` (el `row_number()`
particionado por `(unaccent(lower(concepto)), coalesce(folio_norm, folio), monto)`
sobre un universo de **tenant × ejercicio completo**, `:39-56`) ·
`src/lib/likida/cuadre/engine.ts:514-563` (`copiasDeComprobante`, el mismo
criterio sobre **un viaje**) · `src/lib/likida/repo.ts:989-999` (`getGastos` es
`.eq('viaje_id', viajeId)`: el universo del TS es un viaje y no puede ser otro) ·
`src/lib/likida/cuadre/desde_db.ts:187-192` · `engine.ts:788` (`total` sale de la
RPC deduplicada) y `:811-819` (dónde se gasta el cupo).

**Escenario, con valores.** Flota con la facilidad de la RFA 2026 2.9 vigente.
Ejercicio 2026: total de combustible $1,400,000 → **tope = $210,000**. De
efectivo, otros viajes llevan $206,000. Dos tickets de diésel **de estaciones
distintas** —la numeración de folio es por emisor y se reinicia—, los dos con
folio `1234`, concepto `diesel`, monto **$2,500.00** exacto (importes redondos:
«ponme $2,500 de diésel»), en efectivo y sin CFDI: el ticket A en el viaje
V-0101 (15-ene) y el ticket B en el V-0820 (20-ago).

- `sumar_combustible_ejercicio` (0349) particiona por `('diesel','1234',2500)`
  sobre todo el año → los dos caen en la **misma partición**, `orden_copia` 1 y
  2, y `where orden_copia = 1` tira uno → `efectivo = $208,500`. Lo correcto es
  **$211,000**.
- Al cuadrar V-0820: `copiasDeComprobante` solo ve los gastos de ESE viaje →
  ninguna copia → `efectivoDeEsteViaje = $2,500` → `efectivoPrevEjercicio =
  208,500 − 2,500 = $206,000`. Lo correcto es **$208,500**.
- `engine.ts:811-819`: `cupoRestante = 210,000 − 206,000 = $4,000`;
  `dentro = min(2,500, 4,000) = $2,500`; `excedenteDeEste = $0` → emite
  `combustible_efectivo_dentro15`.
- Lo correcto: `cupoRestante = 210,000 − 208,500 = $1,500`; `dentro = $1,500`;
  **`excedenteDeEste = $1,000`** → `efectivo_sobre_15`, no deducible.

**Entran dos tickets de $2,500 de estaciones distintas con el mismo número de
folio → sale un PDF que declara deducibles $2,500 cuando $1,000 no lo son.**
El error va siempre en la misma dirección (el universo grande nunca dedupa
menos que el chico), o sea: siempre regala cupo.

**Consecuencia.** El contralor firma una deducción que la RFA 2.9 no concede, y
la diferencia sale de su declaración, no de la de Likida. Es el mismo daño que
ARQ-C2, por la otra mitad del problema: la 30 arregló el término del
sustraendo y dejó intacto el **universo**, que es el parámetro que decide si
dos filas colisionan.

**Intento de refutación.** (a) *¿No es el mismo hallazgo que ARQ-C2?* No: ARQ-C2
era la resta contando doble; aquí la resta ya está bien y lo que está mal es el
minuendo, que colapsa filas que no son copias. La prueba del arreglo
(`desde_db_efectivo_previo.test.ts:178`) pone **las dos fotos en el mismo
viaje**, así que es ciega a este caso por construcción. (b) *¿El comentario de
`copiasDeComprobante` no dice que dos tickets con mismo concepto, folio y total
al centavo SON un duplicado?* Lo dice (`engine.ts:552-556`) y es razonable
**dentro de un viaje** —una veintena de comprobantes de tres días—; sobre un
tenant-año de miles de filas de diésel a importes redondos, ese mismo criterio
deja de discriminar. El defecto es que al portarlo a SQL nadie revisó que la
calibración sobreviviera al cambio de universo. (c) *¿`rfc_emisor` no lo
salva?* No está en la partición de la 0349 (`:62-63`), y la columna existe en
`candidatos`… no: ni siquiera se proyecta (`:41-42`). (d) *¿La rama de CFDI?*
Inalcanzable, `uq_gasto_cfdi_uuid` sobre `(tenant_id, cfdi_uuid, cfdi_orden)`
con `cfdi_orden smallint not null default 1` (`0065:58,69`) — por eso el
escenario va por folio.

**Causa raíz probable:** portar una función pura a SQL fijó un universo nuevo
(tenant × año) sin volver a preguntar si el criterio discrimina en ese universo;
el encabezado de la 0349 (`:7`) afirma «Mismo criterio EXACTO que
`copiasDeComprobante`» y es verdad del *cuerpo* y falso del *alcance*.

**Las dos divergencias latentes del mismo hallazgo, reverificadas hoy y
declaradas como latentes:**

- **`nullif`.** La 0349 es la única de las cinco que lee las columnas **crudas**
  (`:61` `cfdi_uuid is not null`, `:63` `coalesce(folio_norm, folio)`). La 0355
  nulifica todo en `base_cruda` (`:31,35,36`), la 0354 usa
  `coalesce(nullif(g.folio_norm,''), g.folio)` (`:246`) y `nullif(g.cfdi_uuid,'')`
  (`:241`), y el TS usa `if (g.cfdiUuid)` / `g.folioNorm || g.folio`
  (`engine.ts:520,556`), que en JS tratan `''` como ausente. **El radio de la
  divergencia es desproporcionado:** con un `cfdi_uuid = ''`, la 0349 lo toma
  como «sí tiene CFDI» y particiona por `lower('')` → **todas** las filas con
  `''` del tenant-año colapsan en una. **No es alcanzable hoy** y lo digo
  explícito: los cuatro escritores de `gasto.cfdi_uuid` validan antes
  (`repo.ts:41-44` `uuidCfdi` devuelve `null` para `''`;
  `dashboard/agentes/facturas/page.tsx:118` `validarUuidCfdi`;
  `sat_descarga/ciclo.ts:216`; `facturacion/al_vuelo.ts:605` — los tres últimos
  además con `.is('cfdi_uuid', null)`). Lo que no hay es un CHECK que lo impida:
  el de la 0158 (`:429`) solo exige minúsculas, y `''` lo cumple.
- **Desempate.** 0349 y 0355 conservan el `id` más chico (uuid, o sea azar); la
  0354 (`:248`) y el TS conservan el más antiguo por `created_at`. Inocuo
  mientras `monto` esté en la llave; deja de serlo en cuanto la sobreviviente
  aporte otra columna, y la 0355 toma 26 dimensiones de la fila que sobrevive
  (`:116-119`).

---

### [CRÍTICO · REINCIDENTE, 9ª aparición desde la 24] ARQ-C1 — un ajuste firmado sigue tirando el export contable del PERIODO COMPLETO

`src/app/api/export/poliza/route.ts:117-131` (`ajustesIncompatibles`) · `:363-367`
(`bloqueos.push` + `continue`) · `:394-406` (el 409 `polizas_incompletas`) ·
`src/lib/likida/revision_recalculo.ts` · `supabase/migrations/0306_…:32`.

**Verificación de hoy.** `git diff 5ce91b2..HEAD -- src/` → **vacío** (la ventana
no trajo una línea de `src/`). Abrí el archivo: la estructura es idéntica a la
que la 28, la 29 y la 30 describieron. Lo único que cambió desde la 29 es que
`ajustesIncompatibles` ahora exime las copias (`:119`
`const copias = copiasDeComprobante(...)`) — un arreglo de otro hallazgo, que no
toca la granularidad.

**Escenario, con valores** (reverificado): marzo 2026, 40 liquidaciones
firmadas; el contralor ajusta un hospedaje de $1,480 a $5,480 con el botón que
el demo enseña. La 0306 mueve `gasto.monto` y **conserva** `sub_total = 1,275.86`
/ `iva_traslado = 204.14`. `ajustesIncompatibles` calcula `totalFiscal =
1,480.00`, ve `|5,480 − 1,480| = 4,000 > 0.01`, mete el folio en `bloqueos` y
`:394` contesta **409**: «1 de 40 liquidaciones no se pueden asentar. No se
exporta el archivo a medias». **Las 39 sanas tampoco salen**, y el mensaje le
pide corregir un comprobante que está bien.

**Consecuencia.** El contralor no cierra el mes en su ERP por haber usado la
función insignia. Nueve rondas.

**Causa raíz probable:** no hay decisión de producto escrita sobre qué es la
póliza de un comprobante cuyo `monto` firmado y cuyo desglose fiscal no cuadran;
la decisión se toma por comprobante y se aplica al periodo.

---

### [ALTO · NUEVO] ARQ-A6 — la 0355 dedupa sobre la VENTANA que el usuario eligió: el mismo ejercicio vale distinto según el filtro de pantalla

`supabase/migrations/0355_gastos_fiscales_sin_copias.sql:96-97` (el universo:
`p_desde`/`p_hasta`, los parámetros del selector de periodo) · `:104-114` (el
`row_number()` de dedup, **dentro** de ese universo) · `:122`
(`where orden_copia = 1`) · `src/lib/likida/fiscal.ts:1652-1657` (quién le pasa
`periodo.desde`/`periodo.hasta`) · `:1745-1747` (`getGastosFiscalesSeries`:
**tres** llamadas con tres ventanas distintas sobre los mismos datos) ·
`src/app/dashboard/contador/inicio-contador.tsx:103,107` y
`src/app/dashboard/inicio-contenido.tsx:134,138` (las dos pantallas que lo
pintan).

**Escenario, con valores.** Los mismos dos tickets del hallazgo anterior: folio
`1234`, concepto `diesel`, **$2,500.00** exacto, sin CFDI, uno el 15-ene-2026 y
otro el 20-ago-2026, de estaciones distintas.

- `/dashboard/contador` con el periodo **«mes» (ago-2026)**: `p_desde =
  2026-08-01`, `p_hasta = 2026-08-31`. Solo el ticket B cae en `base_cruda` → no
  hay con quién colapsar → la celda reporta **$2,500**.
- La misma pantalla con el periodo **«ejercicio»**: `p_desde = 2026-01-01`,
  `p_hasta = 2026-12-31`. Los dos caen en `base_cruda`, misma partición
  `('diesel','1234',2500)` → `base` conserva uno → la celda reporta **$2,500**
  otra vez, cuando la suma de los doce meses da **$5,000**.
- Los dos PDF (V-0101 y V-0820) cuentan cada uno su ticket: **$2,500 + $2,500**.

**El mismo dinero vale $5,000 en los PDF y en la vista mensual, y $2,500 en la
vista anual de la misma pantalla.** Y ocurre dentro de un solo render: las
flechas ‹ › de la tarjeta ciclan semanal / mensual / histórico
(`fiscal.ts:1745-1747`), tres ventanas y por tanto **tres universos de dedup**
sobre los mismos comprobantes.

**Consecuencia.** Es literalmente la regla que el producto pone primero: «*un
rótulo tiene que ser verdad — si hay un filtro en pantalla, mueve TODO lo que
hay debajo*». Aquí el filtro no mueve lo que hay debajo: **cambia la definición
de lo que se cuenta**. El contralor cruza la pantalla contra sus PDF —que es
exactamente lo que el comprador hace— y encuentra $2,500 que no están en ningún
lado, sin ningún renglón que los explique. Lo marco ALTO y no CRÍTICO porque no
mueve una cifra del PDF; mueve la cifra contra la que el PDF se verifica.

**Intento de refutación.** (a) *¿El dedup de la 0355 no es exactamente el
arreglo que la FIS-A3 pidió?* Sí, y para su caso —dos fotos del mismo ticket, misma
`fecha`— funciona y es consistente en toda ventana que contenga esa fecha. El
defecto no es dedupar, es que el universo sea el del filtro. (b) *¿No se
consolida después en TS?* `consolidarCeldasPorEmisor` (`fiscal.ts:1682`) funde
celdas del mismo emisor con ortografía distinta; opera sobre lo que la RPC ya
devolvió, y la fila descartada no llega. (c) *¿Es la extensión de ARQ-A3?* Es la
tercera pata del mismo tejido —la 30 la dejó escrita en «lo que no alcancé» y
la marcó como probable séptimo hallazgo—, pero es otro archivo, otro universo y
otra pantalla, con escenario y consecuencia propios.

**Causa raíz probable:** el dedup se colocó dentro de la CTE que ya estaba
filtrada por el periodo, porque ahí era barato; nadie escribió que la identidad
de un comprobante no puede depender del rango que el usuario tenga abierto.

---

### [ALTO · REINCIDENTE de la 30] ARQ-A2 — `cierre_insumos_hash` sigue siendo la sexta copia del predicado, sin dedup, y sigue citando una migración muerta

`supabase/migrations/0354_cierre_insumos_hash_v2.sql:71-108` (la CTE
`combustible`: `total` y `efectivo` del ejercicio **sin** exclusión de copias) ·
`:74-76` y `:6` y `:147` (las tres citas a «`sumar_combustible_ejercicio` (0345)»,
que llevaba cuatro commits muerta cuando se escribió) ·
`supabase/migrations/0349_…sql:56-78` (la exclusión que su hermana sí tiene).

**Verificación de hoy.** Abrí las líneas 60-115 de la 0354: la CTE `combustible`
filtra por `tenant_id`, `monto > 0`, el rango del ejercicio y el predicado de
combustible, y suma directo — **no hay `row_number`, no hay `orden_copia`**. La
ironía sigue intacta: el `row_number` de dedup de esa misma migración existe
(`:238-256`), veinte líneas después, para OTRO cálculo (`v_total` de
`guardar_liquidacion_tx`). El archivo sabe dedupar y no lo hace aquí.

**Escenario, con valores** (reverificado): el par de fotos del mismo ticket de
$9,400 en V-0912, ejercicio con $205,000 de efectivo previo.
`sumar_combustible_ejercicio` (0349) → `efectivo = $214,400`.
`cierre_insumos_hash` (0354) → `efectivo = $223,800`. **$9,400 de diferencia
entre dos funciones que el comentario de la segunda afirma que calculan lo
mismo.** Borrar la foto repetida entre `leerSnapshotInsumosCierre`
(`repo.ts:1081`) y el guardado cambia el hash (la 0354 la contaba) sin cambiar
un centavo de lo que el motor leyó (la 0349 no la contaba) → el cierre rebota
con `CU006 snapshot_changed` «cambiaron insumos económicos/fiscales» cuando no
cambió ninguno.

Falla cerrado, así que no imprime una cifra mala: por eso ALTO y no CRÍTICO.

---

### [ALTO · REINCIDENTE de la 29 y la 30] ARQ-A4 — el techo de reintentos del inbox sigue en TypeScript y en SQL, once veces

`src/lib/likida/wa_pendientes.ts:26` (`MAX_INTENTOS_PENDIENTE = 5`) ·
`conv.ts:1012` · `supabase/migrations/0325_…:27,56,96,103` ·
`0187:14,34,43,92,102` · `0194:35,44` · `0280:136,146,187,198` · `0155:150`
(`intentos >= 5`) · `0324:640,643`.

Conteo de hoy con `grep -rn "intentos [<>]=\? 5" supabase/migrations/`: **once
literales `5` en siete migraciones**, y una sola constante en TypeScript que no
los gobierna. Idéntico a la 29 y a la 30.

**Escenario, con valores** (vigente): se sube el techo a 8 en
`MAX_INTENTOS_PENDIENTE`. Una foto de un ticket de $9,400 con `intentos = 6`
queda **viva para TypeScript** (`conv.ts:1012` la cuenta como pendiente y el
panel dice «la estamos procesando») e **invisible para el cron** (`0325:27`
`intentos < 5` no la selecciona nunca). No entra a la bandeja, no sale como
carta muerta (`wa_pendientes.ts:351` `.gte('intentos', 8)`) y no hay una sola
prueba roja. Aplazamiento perpetuo, silencioso.

---

### [MEDIO · NUEVO] ARQ-M4 — el guardia derivado que arregló ARQ-A1 cubre 1 de las 2 funciones VIVAS que teclean `MEDIOS_LISR_27_III`

`src/lib/likida/fiscal_agregado_15pct.test.ts:53-63` (`rutaVigente()` filtra
`function … sumar_combustible_ejercicio` y **nada más**) ·
`src/lib/likida/cuadre/engine.ts:126` (la constante) ·
`supabase/migrations/0349_…sql:84` (cubierta) ·
`supabase/migrations/0354_cierre_insumos_hash_v2.sql:92` (**no cubierta**).

**Conteo.** `grep -n "'02', '03', '04', '05', '28', '29'" supabase/migrations/*.sql`
→ seis apariciones (0190, 0305, 0321, 0345, 0349, 0354). De esas, **dos están en
la definición VIVA de su función**: la 0349 (`sumar_combustible_ejercicio`) y la
0354 (`cierre_insumos_hash`). El guardia mira la primera.

**Escenario, con valores.** Un mantenedor decide que el monedero electrónico
(`'17'`) es un medio admitido. Toca `MEDIOS_LISR_27_III` (`engine.ts:126`) y
toca la 0349 — el guardia lo obliga, y esa parte funciona. **No toca la 0354.**
Con un diésel de $9,400 pagado con forma `'17'` en el viaje que se cierra:

- el motor y `sumar_combustible_ejercicio` coinciden: no es efectivo, no consume
  cupo del 15 %;
- `cierre_insumos_hash` (`0354:92`) **sí** lo cuenta como efectivo y lo sella en
  `combustible_ejercicio.efectivo` del payload de cierre (`:140`) — el sello
  declara un insumo económico que no es el que entró al cálculo;
- `npx vitest run fiscal_agregado_15pct` queda **verde**: `rutaVigente()` nunca
  abre la 0354.

**Consecuencia.** El equipo ahora cree tener cubierta la frontera TS↔SQL de su
regla fiscal más cara —y la mitad que se arregló está bien hecha—, lo que hace
la mitad descubierta más peligrosa que antes: el próximo mantenedor confía en el
guardia. Es la misma enfermedad de ARQ-A1 (un guardia que fija su objetivo en
vez de derivarlo), sobrevivida en la lista de funciones a vigilar.

**Causa raíz probable:** el arreglo derivó la *ruta del archivo* pero dejó
tecleado el *nombre de la función*; la pregunta correcta no es «cuál `.sql`
define `sumar_combustible_ejercicio`» sino «qué funciones vivas contienen esta
lista».

---

### [MEDIO · REINCIDENTE de la 29 y la 30] ARQ-A5 — «qué régimen SAT abre el 15 %» sigue con tres deciders a mano, y dos de ellos ya devuelven cosas distintas

`src/lib/likida/perfil/preguntas.ts:362` (`REGIMENES_ELEGIBLES_15`) y `:369-372`
(`regimenElegiblePorClave`, la canónica) · `src/lib/likida/perfil/onboarding.ts:16`
(`CLAVES_REGIMEN_SAT`) y `:19-22` (`regimenElegibleDeClave`, **sin migrar**) ·
`src/lib/likida/perfil/entrevista.ts:713` (`const elegible = v === '612' || v === '624'`,
en línea, **sin migrar**) · `administracion.ts:205-213` (el único migrado).

**Divergencia viva, reverificada hoy.** Con una clave fuera del catálogo de seis
—p. ej. `'605'`, Sueldos y Salarios:

- `regimenElegiblePorClave('605')` → **`false`** (`preguntas.ts:371`, un
  `.includes` sobre la lista de dos);
- `regimenElegibleDeClave('605')` → **`undefined`** (`onboarding.ts:20`, porque
  `'605'` no está en `CLAVES_REGIMEN_SAT`).

La diferencia la define el propio repo veinte líneas más arriba
(`preguntas.ts:365-367`): `undefined` es «no se puede saber — no se inventa un
veredicto que la base no sostiene»; `false` es «no califica», y se escribe firme
en `config.facilidadCombustibleEfectivo.regimenElegible`, lo que hace que
`engine.ts:841` emita `efectivo_no_elegible` —no deducible y sin IVA
acreditable— sin haberle preguntado nunca a la flota. **Dos puertas de alta,
mismo RFC, dos estados.** Dentro del catálogo de seis los tres coinciden
(`601/603/612/621/624/626`).

Detalle de mantenibilidad que confirma el diagnóstico: `onboarding.ts:18` dice
«Mismo cálculo que `entrevista.ts:704`»; hoy está en `entrevista.ts:713`. El
comentario que ata las copias también se desincronizó.

---

### [MEDIO · REINCIDENTE de la 28, la 29 y la 30] ARQ-M1 — «ninguna consulta del cierre se queda sin techo» sigue siendo una lista literal de 6, y quien sube el PDF sigue fuera

`src/lib/likida/tope_consulta.test.ts:38-45` (`CAMINO_DEL_CIERRE`, los mismos
seis) · `src/lib/likida/tools.ts:412`
(`await supabaseAdmin().storage.from('liquidaciones').upload(...)`, **sin
`acotada`**) · `src/lib/supabase/admin.ts` (el backstop de 25 s).

**Medición de hoy:** `grep -rln "supabaseAdmin()" src/ --include=*.ts
--include=*.tsx | grep -v test` → **237 archivos de producción**, 1,065
llamadas. El guardia mira **6**. De esos 237, **26 son `page.tsx`**: el acceso a
datos no tiene frontera, ni la pretende. El escenario de la 29 (dos `upload` en
serie, hasta 25 s cada uno contra los 8 s del tope fino, dentro de una
invocación de 120 s con `saveLiquidacion` + `sendDocument` detrás) sigue en pie.

---

### [MEDIO · REINCIDENTE de la 29 y la 30] ARQ-M2 — el plazo de conservación de la telemetría se promete en prosa y se ejecuta con literales SQL

`src/lib/likida/privacidad.ts:712,715` («*se conservan **180 días**… si el evento
fue grave… **365 días***») · `:401-415` (`versionAvisoVigente` firma **solo el
texto**) · `supabase/migrations/0288_…:174`, `0289_…:135`, `0332_…:299`,
`0335_…:341` — **cuatro** `purgar_evento_seguridad_flota(180, 365, …)` tecleados
a mano, dos más que en la 29.

El escenario sigue en pie: una `create or replace mantenimiento_de_datos` con
`(365, 365, …)` deja el aviso declarando un plazo menor que el real, con la
firma diciendo que nada cambió y `privacidad_leg3_aud24.test.ts` verde.

---

### [MEDIO · REINCIDENTE de la 29 y la 30] ARQ-M3 — el margen de reloj de los crons se deriva de un conteo de consultas hecho a mano

`src/lib/likida/presupuesto.ts:399` (`margenUnidadAtomicaMs`) ·
`src/app/api/cron/gps/route.ts:63` (`{ consultas: 11, envios: 0 }`) ·
`src/app/api/cron/descarga-sat/route.ts:106` (`{ consultas: 3, envios: 1 }`).

Siguen siendo 11 y 3, contados en un comentario, y las dos pruebas que existen
(`gps/route.test.ts:106`, `descarga-sat/route.test.ts:193`) **repiten el mismo
literal**, así que verifican la aritmética del margen y no el conteo. Agregar
una consulta a la cadena de `crearIncidencia` deja el margen ~9.5 s corto y
Vercel mata la función entre `crearIncidencia` y `finalizarGrave`, sin que nada
se ponga rojo.

---

### [BAJO · REINCIDENTE, 3ª ronda] ARQ-B1 — «¿qué prospecto es este correo?» sigue con dos implementaciones

`src/lib/admin/calcom.ts:474` · `src/lib/admin/calcom_webhook.ts:233`. Las
**únicas dos** apariciones de `correo_normalizado` en producción, con el mismo
`.eq(...).is('duplicado_de', null).limit(2)` escrito dos veces. Byte por byte
igual que en la 29 y la 30.

---

### [BAJO · REINCIDENTE, 9ª ronda] ARQ-B2 — `procesarTurno`

`src/lib/likida/processor.ts:1554` (la firma) → `:4990` (el cierre) = **3,436
líneas**. Exactamente las mismas que en la 29 y la 30. Sin escenario nuevo.

---

### [BAJO · REINCIDENTE de la 30, y el conteo creció] ARQ-B3 — 21 mocks de `TenantEfectivo`, ninguno atado al tipo real

`src/lib/auth/tenant-efectivo.ts:32-52` (la interfaz) · los **21** archivos con
`vi.mock('@/lib/auth/tenant-efectivo', …)`, de los cuales **cero** dicen
`satisfies TenantEfectivo` (`grep -rn "satisfies TenantEfectivo" src/` → 0).

La 30 contó 14 —los que trajo su ventana—; el total del repo es 21. Hoy cada
mock cubre lo que su página lee y no hay divergencia viva; lo reporto porque la
factoría de `vi.mock` no se typechequea contra el módulo. El día que
`dashboard/clientes/page.tsx` empiece a leer `tenantExiste` —el campo que existe
para no afirmar «aún no hay liquidaciones» sobre una flota borrada
(`tenant-efectivo.ts:38-46`)— su prueba seguirá devolviendo `{tenantId, rol,
userId}`, `tenantExiste` llegará `undefined`, la página pintará el aviso de
flota inexistente **en el camino feliz**, y las aserciones no lo notarán.

---

## Lo que revisé y está bien

- **ARQ-C2 y ARQ-A1 están cerrados de verdad**, con el código abierto y las
  pruebas corridas: `desde_db.ts:187-192`, `fiscal_agregado_15pct.test.ts:53-87`.
  Ver la sección de arriba. Es el único movimiento real del rubro en la serie.
- **El motor del dinero sigue siendo puro.** `grep -c "await \|async "
  src/lib/likida/cuadre/engine.ts` → **0** en 1,893 líneas. La frontera con I/O
  la sostiene `cuadre/desde_db.ts`, que lee y materializa. Que el traductor
  tenga el defecto de alcance de ARQ-A3 no cambia que la separación esté bien
  puesta.
- **El arreglo de ARQ-C2 no agregó una séptima copia del predicado.**
  `desde_db.ts:187` **importa** `copiasDeComprobante` de `engine.ts` (`:5`) en
  vez de reimplementarla. Fui a buscar la tercera copia y no está; hay **nueve**
  llamadores del canónico en producción (`poliza/route.ts`, `consulta_chofer.ts`,
  `liquidacion/omitidos.ts`, `liquidacion/pdf.ts`, `analytics.ts`, `tools.ts`,
  `processor.ts` ×2, `desde_db.ts`) y **una sola** definición en TS.
- **El ejemplo canónico del rubro sigue cerrado y vigilado.** `engine.ts:1891`
  dice `otro: 'Otro'`, `pdf.ts:14` importa `etiquetaConcepto`, y
  `etiquetas_sincronizadas.test.ts:43` barre **todo** `src/` buscando
  `const CONCEPTO(_LABEL)?` en vez de una lista de rutas. Verde hoy.
- **`FaseCosto` sigue siendo el patrón correcto y sigue verde.**
  `0351:17` amplía el CHECK, `costos.ts:41` la unión de TS, y
  `costos_dominio.test.ts` cruza las dos listas y falla si divergen.
- **Las dependencias invertidas siguen en dos y hay quien las cuente.**
  `sin_importar_app.test.ts` verde, incluido el `it` que exige que el barrido
  encuentre **exactamente** esas dos (se cae si se queda ciego).
- **La rama de CFDI del dedup está cerrada a nivel de índice.** `0065:58,69`
  (`cfdi_orden smallint not null default 1` + `unique (tenant_id, cfdi_uuid,
  cfdi_orden) where cfdi_uuid is not null`). Es la refutación que obliga a que
  todo escenario de dedup vaya por la rama de folio, y la usé.
- **`cfdi_uuid = ''` no es alcanzable hoy.** Verifiqué los cuatro escritores de
  esa columna (`repo.ts:41-44`, `agentes/facturas/page.tsx:118`,
  `sat_descarga/ciclo.ts:216`, `facturacion/al_vuelo.ts:605`): los cuatro
  validan o normalizan antes. Por eso no lo reporté como hallazgo propio.
- **`npx tsc --noEmit -p .` → exit 0.** Siete guardias estructurales, 50
  pruebas, verdes.

---

## Lo que NO alcancé a revisar

- **`resumirFiscal` / `resumirPerdidas` por dentro.** El hallazgo ARQ-A6 lo
  escribí sobre el universo de dedup de la RPC y las tres llamadas de
  `getGastosFiscalesSeries`; no reconstruí qué KPI exacto de
  `/dashboard/contador` cambia de valor ni en cuánto. La divergencia de
  universos está verificada en el SQL; el peso en pesos de cada tarjeta, no.
- **La 0353 (`revisar_liquidacion`) como cuarta implementación del dedup.**
  Leí sus dos bloques (`:129-137`, `:148-155`) lo suficiente para contarla y
  para ver que usa `coalesce(nullif(folio_norm,''), folio)`; no reconstruí su
  universo ni escribí un escenario propio. Es la única de las cinco que no
  desmenucé.
- **El detector de clones por contenido.** La 29 lo corrió (49 pares); ni la 30
  ni yo lo repetimos. Tres rondas sin esa medición.
- **`conectores/sincronizar_eventos.ts`** (1,069 líneas, con **seis** archivos
  de prueba distintos colgando de él): quinta ronda pendiente.
- **`lib/mcp/herramientas/*` contra `/v1/*`.** Abrí `mcp/herramientas/viajes.ts`
  lo justo para ver que declara su propio `ESTATUS_VIAJE` (`:22`) — el mismo
  dominio que `/v1/openapi/route.ts:668,686,701` teclea otras tres veces y que
  otros ~25 archivos escriben como `['abierto','en_cuadre']`. No encontré
  divergencia y no escribí escenario, así que **no lo reporto**; queda como la
  cuenta pendiente desde la 26.
- **Nada que requiera base viva.** Ninguna de las funciones citadas se puede
  ejecutar aquí; todos los escenarios son aritmética sobre el SQL y el TS
  leídos.
- **Si `gasto.id` es aleatorio en producción** (lo asumo uuid por
  `gen_random_uuid()` en el resto del esquema). Si fuera monótono, la mitad
  «desempate» de ARQ-A3 sería más benigna. La mitad de ALCANCE no depende de eso.
