# Arquitectura y mantenibilidad — auditoría 32

**Nota: 4/10** (antes 4). Razón del movimiento: **ninguna de las tres razones
aplica**, y lo digo con todas sus letras.

- *Se atacó y subió* — imposible: `git log 8b01aec..HEAD -- src/ supabase/` está
  vacío. No entró una línea que atacara nada.
- *Deuda que cobró factura* — no. Reproduje tres de los hallazgos abiertos
  contra un Postgres real y salieron con cifras en pesos, pero eso es **la misma
  deuda, mejor medida**, no deuda nueva ni deuda que cobró. El propio encargo lo
  dice y estoy de acuerdo: no lo uso para bajar la nota.
- *Mirada más profunda (la nota anterior estaba inflada)* — lo consideré en
  serio por el hallazgo nuevo de esta ronda (**ARQ-A7**, un tercer decider del
  «ejercicio de este viaje» que deja el sello de cierre fallando **abierto**), y
  lo descarté por aritmética: el ancla del rubro dice «*4 o menos si la misma
  lógica de dinero vive en más de un archivo*». Vive, y por eso la 31 ya estaba
  **topada en 4**. ARQ-A7 agrega una copia más a un conteo que ya había
  saturado el tope; no descubre que el 4 fuera generoso, confirma que el tope
  está bien puesto. Bajar a 3 exigiría decir que la 31 sobrecalificó dentro de
  la banda, y no lo creo: cerró ARQ-C2 y ARQ-A1 de verdad y con el mecanismo
  correcto.

**El riesgo mayor del rubro, hoy:** «qué comprobantes son el mismo» y «a qué
ejercicio pertenece este viaje» son las dos definiciones que deciden el dinero
del 15 %, y cada una está escrita **más de una vez con reglas distintas** — el
dedup en 5 implementaciones sobre 3 universos, y el ancla del ejercicio en TS
(`gastos.find`) contra SQL (`min(fecha)`). Las dos ya divergen ejecutándose, no
en teoría: esta ronda las corrí.

> **Método.** Rama `claude/auditoria-32`, HEAD `69becdb`, árbol limpio al
> terminar (`git status --porcelain` → vacío; no edité ningún archivo del repo
> fuera de este documento, los scripts de reproducción viven en `/tmp/pgarq32/`).
> `npx tsc --noEmit -p .` → **exit 0**. `npx eslint src/` → **exit 0** (154
> warnings, 0 errores). `npx vitest run fiscal_agregado_15pct
> desde_db_efectivo_previo repo_acumulado etiquetas_sincronizadas costos_dominio
> sin_importar_app tope_consulta` → **7 archivos, 50 pruebas, verdes** (idéntico
> a la 31). **Novedad de método: esta ronda SÍ hubo base de datos.** Levanté un
> Postgres 16.13 efímero y corrí las 333 migraciones; el detalle está en la
> sección siguiente.

---

## ARQ-A3: el intento de reproducción

**Veredicto: REPRODUCIDO, con cifras en pesos, contra la función SQL viva.**

El lead de la continuación 1 era correcto en los tres puntos. Lo persigo paso a
paso porque la mitad del valor de esta sección es dejar la receta escrita.

### Paso 1 — ¿existen los binarios?

```
$ ls /usr/lib/postgresql/
16
$ which initdb pg_ctl postgres psql
/usr/bin/psql          ← solo el cliente está en PATH
(exit 1)
$ ls /usr/lib/postgresql/16/bin/
initdb  pg_ctl  postgres  psql  pg_isready  pg_dump  ...   (34 binarios)
```

Sí existen. El `which` de la pista sale en exit 1 y **eso engaña**: el servidor
está completo en `/usr/lib/postgresql/16/bin/`, que Debian/Ubuntu no pone en
PATH a propósito. Ésa es la hora que costó en la ronda anterior.

### Paso 2 — el arranque, y la trampa de root

```
$ initdb -D /tmp/pgarq32/data -U postgres --auth=trust
initdb: error: cannot be run as root
initdb: hint: Please log in (using, e.g., "su") as the (unprivileged) user ...
```

La imagen corre como `root` y el paquete trae un usuario `postgres` (uid 102).
Con `su postgres` y el socket en un directorio propio:

```
$ su postgres -s /bin/bash -c "initdb -D /tmp/pgarq32/data -U postgres --auth=trust -E UTF8 --locale=C"
Success.
$ su postgres -s /bin/bash -c "pg_ctl -D /tmp/pgarq32/data -l server.log \
    -o '-p 55432 -k /tmp/pgarq32/run -c listen_addresses=127.0.0.1' -w start"
server started
$ psql postgresql://postgres@127.0.0.1:55432/postgres -c 'select version()'
 PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu
```

### Paso 3 — la receta del job de CI, reusada tal cual

`.github/workflows/ci-postgres.yml:143-169` («Migraciones + aislamiento
(Postgres efímero)»): andamio primero, migraciones una por una, con el preflight
de índices antes de la 0332. Copiada literal, sin inventar nada:

```
$ psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/pruebas-aislamiento/andamio_ci.sql
(exit 0)
$ for f in supabase/migrations/*.sql; do
    [ "$(basename $f)" = "0332_db_retencion_producto.sql" ] && \
      psql ... -f scripts/ci/0335_preflight_retencion_indices.sql
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" || exit 1
  done
333 migraciones aplicadas limpias.
```

**Las 333 aplican limpias sobre base virgen.** (Dato colateral que vale para el
rubro de pruebas: el job de CI sigue sano.)

### Paso 4 — el escenario de ARQ-A3, ejecutado

Dos tickets de diésel de **estaciones distintas** (`rfc_emisor` distinto — la
numeración de folio es por emisor y se reinicia), los dos con folio `1234`,
concepto `diesel`, monto **$2,500.00** exacto, en efectivo, en **viajes y meses
distintos del mismo ejercicio 2026**. Más $1,189,000 de diésel por transferencia
y $206,000 de efectivo de otros viajes, para que el ejercicio sume $1,400,000.

Salida real de `psql` (`/tmp/pgarq32/repro_arq_a3.sql`):

```
=== LOS HECHOS EN LA BASE ===
 folio |  rfc_emisor  |   monto    |   fecha    | forma_pago
-------+--------------+------------+------------+-----------
 1234  | ESA030303CCC |    2500.00 | 2026-01-15 | 01
 T-1   | PEM010101AAA | 1189000.00 | 2026-02-10 | 03
 E-1   | GAS020202BBB |  206000.00 | 2026-03-10 | 01
 1234  | ESB040404DDD |    2500.00 | 2026-08-20 | 01

=== VERDAD ARITMETICA (suma directa, sin dedup) ===
 total_real | efectivo_real
------------+---------------
 1400000.00 |     211000.00

=== LO QUE DEVUELVE sumar_combustible_ejercicio (0349), LA FUNCION VIVA ===
   total    | efectivo
------------+-----------
 1397500.00 | 208500.00

=== LA PARTICION QUE LOS COLAPSA (el row_number de 0349:63) ===
                  id                  |  rfc_emisor  |  monto  | k_concepto | k_folio | orden_copia
--------------------------------------+--------------+---------+------------+---------+-------------
 a3000000-0000-4000-8000-000000000301 | ESA030303CCC | 2500.00 | diesel     | 1234    |           1
 a3000000-0000-4000-8000-000000000302 | ESB040404DDD | 2500.00 | diesel     | 1234    |           2

=== EL CUPO DEL 15% Y LO QUE SE REGALA ===
 total_real | total_rpc  | efectivo_real | efectivo_rpc | tope_15_real | tope_15_rpc | cupo_restante_segun_rpc | cupo_restante_correcto
------------+------------+---------------+--------------+--------------+-------------+-------------------------+------------------------
 1400000.00 | 1397500.00 |     211000.00 |    208500.00 |    210000.00 |   209625.00 |                 3625.00 |                1500.00
```

**Dos comprobantes que no son copias entran, y la función viva devuelve uno.**
`orden_copia = 2` para el ticket de la estación B, y `where orden_copia = 1`
(`0349:77`) lo tira. El `rfc_emisor` **está en la tabla y se ve en el mismo
`select`** — simplemente no se proyecta a `candidatos` (`0349:47-48`) ni entra a
la partición (`:63`).

**El cierre de la aritmética, con el TS leído hoy** (`engine.ts:811-819`,
abierto y verificado):

| | La RPC | Lo correcto |
|---|---|---|
| `totalCombustibleEjercicio` | $1,397,500 | $1,400,000 |
| `tope = 0.15 * total` (`engine.ts:812`) | **$209,625** | **$210,000** |
| `efectivoPrevEjercicio` (`desde_db.ts:191`, = efectivo − $2,500 de este viaje) | $206,000 | $208,500 |
| `cupoRestante` (`engine.ts:816`) | **$3,625** | **$1,500** |
| `dentro = min(2500, cupo)` | $2,500 | $1,500 |
| `excedenteDeEste` | **$0** | **$1,000** |
| diferencia emitida | `combustible_efectivo_dentro15` | `efectivo_sobre_15` |

**Entran dos tickets de $2,500 de estaciones distintas con el mismo folio → el
PDF declara deducibles los $2,500 completos cuando $1,000 no lo son**, y ni
siquiera imprime el renglón que avisaría. El error va siempre en la misma
dirección: el universo grande nunca dedupa menos que el chico, así que **siempre
regala cupo**.

**Lo que la reproducción agrega sobre la aritmética de la 31:** la 31 supuso
`tope = $210,000` fijo. La base dice que **el tope también se deforma** —
$209,625, porque el minuendo colapsado deflacta el *denominador* además del
sustraendo. Dos errores en la misma dirección. La 31 quedó corta, no larga.

### De pilón: ARQ-A2 y ARQ-A6 también quedaron reproducidos

Ya con la base arriba, corrí los otros dos abiertos que vivían en SQL.

**ARQ-A6** (`/tmp/pgarq32/repro_a6b.sql`) — los mismos dos tickets, la misma
pantalla, las tres ventanas del selector de periodo de `fiscal.ts:1745-1747`:

```
=== ARQ-A6 · misma pantalla, tres ventanas del selector de periodo ===
    etiqueta    |     d      |     h      | celdas | monto_reportado | n_comprobantes
----------------+------------+------------+--------+-----------------+----------------
 mes ene-2026   | 2026-01-01 | 2026-01-31 |      1 |         2500.00 |              1
 mes ago-2026   | 2026-08-01 | 2026-08-31 |      1 |         2500.00 |              1
 EJERCICIO 2026 | 2026-01-01 | 2026-12-31 |      1 |         2500.00 |              1

=== La verdad en la base ===
 comprobantes | suma_real
--------------+-----------
            2 |   5000.00
```

Confirmado y **peor de lo que la 31 escribió**: la ventana anual no solo reporta
$2,500 de $5,000, además declara **`n = 1` comprobante** cuando hay dos. El
contador que suma sus doce meses obtiene $5,000 y la vista de ejercicio le
contesta $2,500, con el conteo de comprobantes respaldando la cifra mala.

**ARQ-A2** (`/tmp/pgarq32/repro_a2_a6_v2.sql`) — dos fotos del **mismo** ticket
de $9,400 en un viaje **distinto** del que se cierra (así, borrar la foto no
toca `gastos_viaje` del payload: lo único que puede mover el hash es
`combustible_ejercicio`):

```
--- CON la foto repetida ---
 motor_0349_total | motor_0349_efectivo |                            sello_0354
------------------+---------------------+------------------------------------------------------------------
        214400.00 |           214400.00 | 2c686e6901ec402fe28d23f105feb85d331c01c46d2fe75f3fdaa7d75793ad12
DELETE 1
--- SIN la foto repetida (el motor no debería moverse) ---
 motor_0349_total | motor_0349_efectivo |                            sello_0354
------------------+---------------------+------------------------------------------------------------------
        214400.00 |           214400.00 | cec86b59b5d079b32a22c260ad734688470ebac7fc10c8be8dbd0a99631db28f
```

**El motor no se movió un centavo y el sello cambió.** Es exactamente el
escenario que la 30 y la 31 escribieron en papel: el cierre rebota con
`CU006 snapshot_changed` «cambiaron insumos económicos/fiscales» cuando no
cambió ninguno de los que el motor leyó.

### Lo que NO se pudo ejercitar ni con base

La rama de CFDI del dedup sigue siendo inalcanzable por construcción
(`uq_gasto_cfdi_uuid` sobre `(tenant_id, cfdi_uuid, cfdi_orden)`), tal como la
31 dedujo y la cabecera de `supabase/tests/0349_…sql:6-9` ya documentaba. Lo
confirmé contra el catálogo real (`\d gasto`). Todo escenario de dedup tiene que
ir por folio, y por ahí fueron.

---

## Estado de los abiertos

| ID | Estado | `archivo:línea` de hoy |
|---|---|---|
| **ARQ-A3** (CRÍT) | **sigue abierto — y ahora REPRODUCIDO con cifras** | `supabase/migrations/0349_combustible_15_sin_copias.sql:63` (la partición), `:77` (`where orden_copia = 1`), `:47-48` (`rfc_emisor` no se proyecta) · `engine.ts:816-819` |
| **ARQ-C1** (CRÍT) | **sigue abierto — 10ª aparición desde la ronda 24** | `src/app/api/export/poliza/route.ts:366` (`bloqueos.push` + `continue`), `:397-399` (el 409 del periodo completo), `:117-131` (`ajustesIncompatibles`) |
| **ARQ-A6** (ALTO) | **sigue abierto — REPRODUCIDO** | `supabase/migrations/0355_gastos_fiscales_sin_copias.sql:96-98` (el universo), `:104-113` (el dedup dentro de él), `:122` · `src/lib/likida/fiscal.ts:1745-1747` |
| **ARQ-A2** (ALTO) | **sigue abierto — REPRODUCIDO** | `supabase/migrations/0354_cierre_insumos_hash_v2.sql:71-108` (la CTE `combustible`, **sin** `row_number`), `:238-256` (el dedup que la misma migración sí tiene, para otro cálculo) |
| **ARQ-A4** (ALTO) | sigue abierto | `src/lib/likida/wa_pendientes.ts:26` · `conv.ts:1012` · **18 literales SQL ejecutables** en `0155:150`, `0187:14,34,43,92,102`, `0194:35,44`, `0324:640,643`, `0325:27,56,96,103` |
| **ARQ-M4** (MEDIO) | sigue abierto | `fiscal_agregado_15pct.test.ts:53-63` cubre `0349:84`; **`0354:92` sigue sin cubrir**. `grep "'02', '03', '04', '05', '28', '29'"` → 6 apariciones (0190, 0305, 0321, 0345, 0349, 0354) |
| **ARQ-A5** (MEDIO) | sigue abierto | `perfil/preguntas.ts:362,369-371` · `perfil/onboarding.ts:14,19-20` · `perfil/entrevista.ts:713` (`v === '612' \|\| v === '624'`, en línea) |
| **ARQ-M1** (MEDIO) | sigue abierto | `tope_consulta.test.ts:38-45` (los mismos 6) · **237 archivos de producción** llaman `supabaseAdmin()`, **26 de ellos `page.tsx`** |
| **ARQ-M2** (MEDIO) | sigue abierto | `privacidad.ts:712,715` · `purgar_evento_seguridad_flota(180, 365, …)` tecleado en `0288:174`, `0289:135`, `0332:299`, `0335:341` |
| **ARQ-M3** (MEDIO) | sigue abierto | `cron/gps/route.ts:63` (`consultas: 11`) · `cron/descarga-sat/route.ts:106` (`consultas: 3`) |
| **ARQ-B1** (BAJO) | sigue abierto | `admin/calcom.ts:474` · `admin/calcom_webhook.ts:233` (las únicas dos apariciones, byte por byte iguales) |
| **ARQ-B2** (BAJO) | sigue abierto | `processor.ts:1554` → `:4990` = 3,436 líneas |
| **ARQ-B3** (BAJO) | sigue abierto | 21 archivos con `vi.mock('@/lib/auth/tenant-efectivo')`, `grep "satisfies TenantEfectivo" src/` → **0** |
| ARQ-C2, ARQ-A1 | **cerrados** (cerrados en la 31, reverificados hoy) | `desde_db.ts:187-191` · `fiscal_agregado_15pct.test.ts:53-87` |

Ninguno se movió, y no podía moverse: el árbol es el mismo.

---

## Hallazgos

Solo escribo el hallazgo **nuevo**. Los trece abiertos están arriba con su
`archivo:línea` de hoy y su escenario ya publicado en `docs/auditoria-31/`; los
tres que reproduje llevan su salida real en la sección anterior, que es lo que
esta ronda aporta sobre ellos.

### [ALTO · NUEVO] ARQ-A7 — «a qué ejercicio pertenece este viaje» se decide con dos reglas distintas, y por eso el sello de cierre vigila el año equivocado

`src/lib/likida/cuadre/desde_db.ts:119-121` (el ancla en TS) ·
`supabase/migrations/0354_cierre_insumos_hash_v2.sql:50-54` (el ancla en SQL) ·
`src/lib/likida/repo.ts:999` (`.order('created_at')`, lo que decide «el primero»
en TS) · `src/lib/likida/operacion.ts:657` y `:484` (quién crea un viaje sin
fecha) · `0354:140` (`combustible_ejercicio` dentro del payload que se hashea) ·
`0354:229-230` (el `raise CU006`) · `repo.ts:1054,1217`.

Las dos reglas, una al lado de la otra:

```ts
// desde_db.ts:119-121
const anioEjercicio = String(
  (viaje.fechaInicio ?? gastos.find((g) => g.fecha)?.fecha ?? new Date().toISOString()).slice(0, 4),
);
```
```sql
-- 0354:50-54
coalesce(
  extract(year from v.fecha_inicio)::int,
  (select extract(year from min(g.fecha))::int from public.gasto g where …),
  extract(year from current_date)::int
) as anio
```

Cuando `viaje.fecha_inicio` es NULL —y lo es: `NuevoViaje.fechaInicio` es
opcional (`operacion.ts:484`), `crearViaje` escribe `v.fechaInicio || null`
(`:657`), `POST /v1/viajes` lo acepta ausente (`v1/viajes/route.ts:267,307`), la
columna no tiene default ni trigger que la rellene (verificado contra el
catálogo) y la tabla del panel pinta `—` para ese caso
(`dashboard/viajes/vista.tsx:209`)— el TS toma **el primer gasto con fecha en
orden de `created_at`** y el SQL toma **el `min(fecha)`**. No es la misma fila.

**Escenario, con valores.** Viaje de fin de año sin `fecha_inicio`. El chofer
manda primero la foto del ticket del **5-ene-2027** ($3,000 de diésel en
efectivo) y una hora después la del **28-dic-2026** ($4,000, efectivo). El
ejercicio 2026 del tenant lleva $900,000 de diésel; el 2027, $10,000.

Salida real (`/tmp/pgarq32/repro_anio.sql`):

```
=== ANCLA DEL EJERCICIO: los dos criterios sobre el MISMO viaje ===
 anio_ts_desde_db_ts_120 | anio_sql_0354_50_54
-------------------------+---------------------
                    2027 |                2026

=== Lo que el MOTOR lee (ejercicio 2027, el que eligió el TS) ===
  total   | efectivo
----------+----------
 13000.00 |  3000.00
=== Lo que el SELLO hashea (ejercicio 2026, el que eligió el SQL) ===
   total   | efectivo
-----------+----------
 904000.00 |  4000.00
```

El motor calcula el tope del 15 % contra **$13,000** y el sello de cierre
fotografía **$904,000**. Las dos mitades de la misma frontera hablan de años
distintos.

**Y eso deja el sello fallando ABIERTO, que es lo grave.** El sello existe para
una sola cosa: que ningún insumo económico cambie entre el cálculo y el guardado
(`repo.ts:1054` «*la cantidad sigue igual, pero cambió algún insumo
económico/fiscal*»; `0354:229` `raise CU006`). Con el ancla torcida, **el insumo
que el motor sí leyó no está vigilado**:

```
=== El sello NO cambia si se mueve el combustible de 2027 (el ejercicio del motor) ===
hash_antes   = ac5abdd9ec299d0f9a5c595952ceb400ee817f4ea46ae46a916278dcfa9fb9dd
UPDATE 1                       ← un gasto de 2027 pasa de $10,000 a $999,000
hash_despues = ac5abdd9ec299d0f9a5c595952ceb400ee817f4ea46ae46a916278dcfa9fb9dd
   total    | efectivo
------------+----------
 1002000.00 |  3000.00
```

**Entra un cambio de $989,000 en el denominador que el motor usó → sale el mismo
hash, byte por byte, y el cierre pasa.** El tope del 15 % que el PDF cita se
movió de $1,950 a $150,300 y `CU006` no se enteró.

La mitad espejo también está ejecutada, y es el daño de ARQ-A2 por la otra
puerta: tocar $1,000 del combustible de **2026** —que el motor jamás leyó— **sí**
mueve el hash y rebota el cierre.

```
hash_antes              = ce1aa7a02ecbf1d008236d7ef0717b63a7d6b145d3ffe94c20e13b748b19c5ea
UPDATE 1                       ← un gasto de 2026 pasa de $900,000 a $901,000
hash_despues_tocar_2026 = 731012572056db51c4824804540f6d8d30465e4bdd6c15852aa9b6ef587fa02d
```

**Consecuencia.** Para el contralor: la garantía que el producto vende sobre el
cierre —«los números que firmaste son los que se calcularon»— no se cumple en
los viajes de cambio de año sin fecha de inicio, y falla en la dirección que no
avisa. Para el equipo: el guardarraíl está *verde* mientras no protege, que es
peor que no tenerlo, porque nadie va a volver a mirar. Lo marco **ALTO** y no
CRÍTICO porque no imprime hoy una cifra mala en el PDF: anula el mecanismo que
impediría que se imprimiera.

**Intento de refutación.** (a) *¿No es ARQ-A2 otra vez?* No. ARQ-A2 es que la
0354 no dedupa **dentro** del año que eligió; esto es que elige **otro año**. Se
pueden arreglar por separado y el dedup no toca el `coalesce` del ancla.
(b) *¿No es alcanzable, porque siempre hay `fecha_inicio`?* Es alcanzable: el
campo es opcional en el tipo, en el insert y en la API pública, y la UI tiene un
renglón dedicado a pintarlo vacío. Si fuera imposible, las dos ramas de fallback
—que existen en los dos lados— serían código muerto en ambos.
(c) *¿No lo cubre alguna prueba?* No. `supabase/tests/0354_cierre_insumos_hash_v2.sql:15,21`
inserta sus dos viajes **con** `fecha_inicio`, así que la rama de fallback del
SQL nunca se ejecuta; `desde_db_efectivo_previo.test.ts:65` mockea
`fechaInicio: '2026-02-15'`, así que la del TS tampoco. Las dos ramas que
divergen son exactamente las dos que ninguna prueba toca.
(d) *¿No se salva porque `getGastos` ordena?* Al contrario: `repo.ts:999` ordena
por `created_at` **a propósito** (auditoría 25, para que el dedup elija siempre
la misma original). Ese orden es correcto para lo que fue puesto y es justamente
lo que hace que `find()` devuelva algo distinto de `min(fecha)`.

**Causa raíz probable:** el `coalesce` de tres niveles se escribió dos veces —una
en TS y otra en SQL— en vez de que uno de los dos lados le pasara el año al otro,
igual que `p_claves` ya se le pasa a `sumar_combustible_ejercicio`
(`repo.ts:1502`).

---

## Lo que revisé y está bien

- **Las 333 migraciones aplican limpias sobre una base virgen**, con la receta
  exacta de `ci-postgres.yml:143-169`. Ejecutado, no deducido.
- **El ejemplo canónico del rubro sigue cerrado y vigilado.**
  `engine.ts:1891` dice `otro: 'Otro'` con el comentario que explica por qué;
  `liquidacion/pdf.ts:14` **importa** `etiquetaConcepto` en vez de redeclararla;
  `etiquetas_sincronizadas.test.ts` barre todo `src/` buscando
  `const CONCEPTO(_LABEL)?` en vez de una lista de rutas. Verde hoy. Fui a
  buscarlo específicamente porque el encargo lo nombra y porque ya recayó una
  vez: `grep "otro: '"` sobre `engine.ts` y `pdf.ts` devuelve **una sola línea**.
- **El motor del dinero sigue siendo puro.** `grep -c "await \|async "
  src/lib/likida/cuadre/engine.ts` → **0** en 1,893 líneas. La frontera con I/O
  la sostiene `cuadre/desde_db.ts`. Que el traductor tenga los defectos de
  alcance (ARQ-A3) y de ancla (ARQ-A7) no cambia que la separación esté bien
  puesta: los dos defectos están **en el traductor**, que es donde se pueden
  arreglar sin tocar el motor.
- **El arreglo de ARQ-C2 sigue sin agregar una copia del predicado.**
  `desde_db.ts:187` importa `copiasDeComprobante` de `engine.ts`. Una sola
  definición en TS.
- **El guardia derivado de ARQ-A1 sigue derivando.** `rutaVigente()` resuelve
  hoy a `0349_combustible_15_sin_copias.sql` y las cuatro aserciones pasan sobre
  la definición viva. (Su límite conocido es ARQ-M4, abierto.)
- **Las claves de hidrocarburos NO divergen**, y fui a buscar que lo hicieran.
  `config.ts:122` (`['15101505','15101514','15101515']`) contra el fallback
  tecleado en `0321:152` y `0354:105`: idénticos, mismo orden. Además `0349` no
  las teclea — las recibe por `p_claves` desde `repo.ts:1502`, que es el patrón
  correcto y el que ARQ-A7 pide para el año. Lo reporto en limpio porque era mi
  mejor candidato a séptima copia y no lo es.
- **La rama de CFDI del dedup está cerrada a nivel de índice**, verificado
  contra el catálogo real y no contra el `.sql`: `\d gasto` muestra
  `uq_gasto_cfdi_uuid UNIQUE (tenant_id, cfdi_uuid, cfdi_orden) WHERE cfdi_uuid
  IS NOT NULL` y `cfdi_orden smallint not null default 1`.
- **No hay trigger ni default que rellene `viaje.fecha_inicio`** (siete triggers
  en `viaje`, todos de journal/inmutabilidad/coherencia; `column_default` vacío).
  Es la refutación que intenté contra mi propio ARQ-A7 y no se sostuvo.
- **`tsc`, `eslint` y los siete guardias estructurales**: exit 0, exit 0, 50
  pruebas verdes. Idéntico a la 31, como debe ser con el mismo árbol.

---

## Lo que NO alcancé a revisar

- **La 0353 (`revisar_liquidacion`) como cuarta implementación del dedup.**
  Segunda ronda consecutiva sin desmenuzarla. Con la base arriba **se podía**
  haber ejecutado y no lo hice: gasté el tiempo en A3, A2, A6 y en perseguir
  A7. Es la deuda de método más clara que dejo, y ahora es barata.
- **El peso en pesos de cada tarjeta de `/dashboard/contador` bajo ARQ-A6.**
  Reproduje que la RPC devuelve `n = 1` y $2,500 donde hay 2 y $5,000; no
  reconstruí qué KPI concreto de `resumirFiscal` / `resumirPerdidas` cambia ni
  en cuánto.
- **El detector de clones por contenido.** La 29 lo corrió (49 pares); ni la 30,
  ni la 31, ni yo. Cuatro rondas sin esa medición, y es la que mediría el ancla
  del rubro de forma independiente en vez de por hallazgos sueltos.
- **`conectores/sincronizar_eventos.ts`** (1,069 líneas, seis archivos de prueba
  colgando): sexta ronda pendiente.
- **`lib/mcp/herramientas/*` contra `/v1/*`** (`ESTATUS_VIAJE` tecleado en
  `mcp/herramientas/viajes.ts:22` y otras tres veces en
  `v1/openapi/route.ts`): cuenta pendiente desde la 26. No encontré divergencia
  viva y por eso no lo reporto, pero tampoco lo cerré.
- **La batería de aislamiento y `verificaciones.sql`.** La base estaba arriba y
  el runner existe (`scripts/ci/correr-verificaciones.mjs`); no los corrí porque
  el aislamiento es rubro de seguridad, no mío. Queda dicho que **hoy se puede
  correr en este contenedor**, que es información nueva para los otros rubros.
- **Nada de producción.** Sin red saliente; lo que digo del despliegue sería
  deducción y no lo digo.
