# Pruebas — auditoría 32 (continuación 2, 18-sep)

**Nota: 5/10** (antes 6). Razón del movimiento: **mirada más profunda — el
código no cambió para peor, la nota anterior estaba inflada por un hueco que
nunca se había medido.**

Ocho rondas seguidas este rubro entregó con la misma frase en «lo que NO
alcancé»: *«ni un `psql`… cero mutaciones de SQL. Sigue siendo el hueco más
grande del rubro.»* Hoy sí hubo Postgres (336 migraciones limpias sobre base
virgen, receta de `ci-postgres.yml`), y detrás del hueco hay esto, contable:

- **La función de dinero que imprime `/dashboard/fiscal`
  (`gastos_fiscales_agregados_tenant`, 274 líneas reescritas a mano en la 0359)
  sobrevive a CUATRO mutaciones distintas con TODO el arnés SQL en verde**: las
  21 pruebas de `supabase/tests/` que `ci-postgres.yml` invoca **y** los **243
  bloques** de la batería de `verificaciones.sql` (239 ok · 0 fallos, idéntico
  al baseline en las cuatro corridas). El propio encabezado de la 0359 nombra
  ese riesgo — «reescribir 190 líneas a mano para cambiar cuatro es cómo se
  cuela una diferencia que nadie ve»— y no lo cubre: su prueba afirma **dos
  cifras sobre tres filas de diésel**.
- **3 de los 16 arneses `.sql` huérfanos están ROJOS hoy** contra el esquema
  vigente. Uno lleva roto desde la migración 0325 (34 migraciones), otro afirma
  una forma de función que la 0331 movió de sitio, y el tercero **sólo puede
  pasar según la hora del día**. Nadie los corre, así que nadie lo sabía.
- **Los 7 hallazgos abiertos de la 31 siguen abiertos**, los 7 remutados uno por
  uno hoy. Cerrados: **0**.

La fuerza contraria es real y por eso la caída es de un punto y no de dos: **los
cuatro commits de esta ronda traen prueba y los cuatro MUERDEN.** Seis reverts
dirigidos contra lo que cada commit dice proteger → seis rojos. Es la primera
vez en cuatro rondas que el 100 % de los arreglos de la rama tiene dientes en su
línea exacta. Pero eso era justamente el supuesto sobre el que descansaba el 6;
sostenerlo evita un desplome, no gana un punto.

El ancla de la nota: «6 si la suite es grande y verde pero hay zonas de dinero
sin arnés» / «4 o menos si la suite pasa con la función rota». Las dos son
ciertas a la vez, en capas distintas — la suite TS de 12,979 pruebas sí muerde
donde la probé (`facturacion_escritura.ts`), y el arnés SQL pasa entero con la
función fiscal rota en cuatro sitios. Entre 4 y 6: **5**.

**Riesgo mayor del rubro, hoy:** la cifra fiscal que el contralor va a cotejar
en la sala se calcula en SQL, y en SQL el arnés afirma tres filas de una
función de 274 líneas. Todo lo demás de esa función —el tope de efectivo, el
borde del periodo, el ejercicio ajeno, el subtotal— se puede cambiar sin un solo
rojo.

---

## Cómo medí

- **Postgres 16.13 real**, efímero, fuera del repo (`/var/tmp/pgaud32`),
  `initdb` + `su postgres`, andamio `andamio_ci.sql` y **336 migraciones
  aplicadas una por una** → «336 migraciones aplicadas limpias», igual que el
  job de Actions. Baseline: los 3 arneses nuevos en verde y la batería Capa 1 en
  **243 bloques · 239 ok · 0 fallos · 4 reportes**.
- **Las mutaciones SQL NO tocaron el repo.** Se aplicó a la base un
  `create or replace` de la función mutada (copia en `/var/tmp`) y se restauró
  reaplicando la migración original del repo. Verificado tras cada tanda.
- **Las mutaciones TS sí tocaron el árbol**, una por una, con
  `git checkout -- <archivo>` inmediatamente después y `git status --short`
  vacío verificado en la misma llamada.
- **Línea base de la suite, hoy:** `npx vitest run` → **988 archivos / 12,976
  pruebas / 6 saltadas / 0 fallos** al arrancar; **12,979 / 6 / 0** al cerrar
  (otro agente añadió 3 pruebas mientras yo medía; ver «Estado del árbol»).
- **NO corrí** `pruebas-manuales/*.prueba.ts` ni `npm run build`.

---

## Las mutaciones que corrí

**26 mutaciones. Mueren 9 (34.6 %). Sobreviven 17.**

### Los cuatro commits de la ronda (los seis reverts dirigidos: 6 de 6 rojos)

| # | Commit | Qué muté | Dónde | Resultado |
|---|---|---|---|---|
| S1 | `53740a1` (0358) | `coalesce(rfc_emisor, rfc_emisor_del_grupo, '')` → `coalesce(rfc_emisor, '')` (vuelve a la 0357) | `supabase/migrations/0358_dedup_emisor_conocido.sql:101` | **ROJO** — 0358 (`total=5000` esperado 2500) y 0359 (`panel=6000 motor=6300`). 0357 verde. **MUERDE** |
| S2 | `f0645f9` (0357) | la misma expresión → `''` (vuelve a la 0349) | ídem `:101` | **ROJO** — 0357 (`total=2500` esperado 5000), 0358 (`3500` esperado 4500) y 0359 (`panel=6000 motor=3500`). **MUERDE** |
| P1 | `5c1734e` (0359) | `coalesce(bc.rfc_emisor, bc.rfc_emisor_del_grupo, '')` → `''` (vuelve a la 0355) | `supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:166` | **ROJO** — `panel=3500.00` esperado 6000. **MUERDE** |
| P2 | `5c1734e` (0359) | ídem → `coalesce(bc.rfc_emisor, '')` (partición estilo 0357) | ídem `:166` | **ROJO** — `panel=6300.00` esperado 6000. **MUERDE** |
| T1 | `4b84716` | mover `const entrada = Date.now()` detrás de `puertaCron` **y** de `leerInterruptor` | `src/app/api/cron/asistencia/route.ts:42` | **ROJO** — 1 de 10 (`el reloj arranca al ENTRAR la petición`). **MUERDE** |
| T2 | `4b84716` | `margenUnidadAtomicaMs({ consultas: 8, … })` → `consultas: 7` | `src/app/api/cron/asistencia/route.ts:88` | **ROJO** — 3 de 10. **MUERDE** |

Estabilidad del intermitente que `4b84716` dice haber cerrado: **0 rojas de 25
corridas** de `route.test.ts`, más la corrida completa bajo carga (988 archivos
en paralelo, verde). El arreglo cumple lo que promete.

### Los huecos que aparecieron al mutar alrededor de esos mismos arreglos

| # | Qué muté | Dónde | Resultado |
|---|---|---|---|
| T3 | `const entrada` detrás de `puertaCron` **solamente** (el otro paso del prólogo) | `route.ts:42` | **VERDE — 10/10** ← NUEVO, `PRU32C2-A1` |
| P3 | `(g.monto > p_tope_efectivo) as sobre_tope` → `>=` | `0359_…:78` | **VERDE** — 21 arneses SQL + **243/239 ok** de la batería |
| P4 | `(p_hasta is null or g.fecha <= p_hasta)` → `<` | `0359_…:132` | **VERDE** — ídem |
| P5 | `otro_ejercicio`: `− (case when mes=1 …)` → `+ (case …)` | `0359_…:126` | **VERDE** — ídem |
| P6 | `coalesce(sum(sub_total),0) as sub_total` → `coalesce(sum(monto),0)` | `0359_…:224` | **VERDE** — ídem |
| S4 | quitar `nullif(rfc_emisor,'')` del CTE `candidatos` | `0358_…:64` | **VERDE** — 5 arneses |
| S5 | `fecha <= make_date(p_anio, 12, 31)` → `make_date(p_anio, 11, 30)` | `0358_…:69` | **VERDE** — 21 arneses + **243/239 ok** |
| S7 | `partition by lower(cfdi_uuid), …` → `partition by cfdi_uuid, …` | `0358_…:90` | **VERDE** — 5 arneses |
| S3 | `min(c.rfc_emisor) over (…)` → `max(…)` | `0358_…:80` | **VERDE** (no mueve dinero; sólo cambia de qué grupo conocido se absorbe la foto sin emisor — no lo reporto) |

### Controles que SÍ muerden (los abro para que la nota no sea una caricatura)

| # | Qué muté | Dónde | Resultado |
|---|---|---|---|
| S6 | `forma_pago_efectiva not in ('02','03','04','05','28','29')` → quitar `'02'` | `0358_…:124` | **ROJO** — `0349_combustible_15_sin_copias` (`efectivo=1300` esperado 300) |
| S8 | `coalesce(folio_norm, folio)` → `folio` en la partición | `0358_…:99` | **ROJO** — 0349, 0357 y 0359 |
| F1 | `total = Math.round((subtotal + iva − retencion)*100)/100` → `+ retencion` | `src/lib/likida/facturacion_escritura.ts:161` | **ROJO** — 1 de 63 |

### Los siete reincidentes de la 31, remutados hoy uno por uno

| # | Hallazgo | Mutación | Resultado |
|---|---|---|---|
| C1a+C1b | `PRU-C1` | `rentabilidad/vista.tsx:173-174` intercambiar `{mxn(f.pagado)}` ↔ `{mxn(f.saldo)}` **y** `combustible-casetas/vista-consolidado.tsx:43` `{mxn(l.monto)}` → `{mxn(0)}` | **VERDE — 94 archivos / 613 pruebas** |
| A1 | `PRU-31C-A1` | `peajes/page.tsx:234` quitar `{ venceEn: ahoraMs() + 25_000 }` | **VERDE — 94 / 613** |
| A2 | `PRU-31C-A2` | **novena** consulta `acotada(supabaseAdmin().from('viaje')…)` antes del claim en `escalarUna` | **VERDE — 33/33** |
| A3 | `PRU-31C-A3` | `correrGit` → `execFileSync('sh', ['-c', \`git ${args.join(' ')}\`])` | **VERDE — 17/17** |
| M1a | `PRU-31C-M1` | `salud-produccion.yml:180` argumentos invertidos (`origin/master "$version"`) | **VERDE — 17/17** |
| M1b | `PRU-31C-M1` | el paso del detector con `if: false` (`salud-produccion.yml:173`) | **VERDE — 17/17** |
| M2 | `PRU-31C-M2` | `controles.tsx:86` ↔ `:88` intercambiar `{r.revisadas}` con `{r.conciliadas}` | **VERDE — 8/8** |
| M3 | `PRU-31C-M3` | hoistear la consulta de `viaje` a una variable (sin `acotada`) | **VERDE — 33/33** |

Nota sobre A2: con la tabla `unidad` (que el mock no conoce) la mutación mata 8
pruebas **por accidente** —el mock revienta el flujo, no lo cuenta una
aserción—. Repetida con `viaje`, que el mock sí conoce: **33/33 verdes**. La
prueba no cuenta consultas; detecta tablas desconocidas.

---

## Hallazgos

### [CRÍTICO] `PRU32C2-C1` — NUEVO — la función de dinero del panel fiscal se puede romper en **cuatro** sitios distintos con los 21 arneses SQL y los 243 bloques de la batería en verde

`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:78`, `:126`, `:132`,
`:224` · `supabase/tests/0359_panel_fiscal_dedup_emisor.sql:74-94` (las dos
únicas aserciones de cifra del archivo) · `.github/workflows/ci-postgres.yml`
(la lista de arneses)

**Escenario, con valores, cuatro veces.** Cada mutación se aplicó sola a la base
con las 336 migraciones y después se corrieron **los 21 arneses de
`supabase/tests/` que `ci-postgres.yml` invoca** más la batería Capa 1 completa
(`capa1_auditoria_estatica.sql` + `verificaciones.sql`). Las cuatro veces:
**243 bloque(s) · 239 ok · 0 fallo(s)** — byte por byte el mismo veredicto que
el baseline.

1. `:78` — `(g.monto > p_tope_efectivo) as sobre_tope` → `>=`. Con el tope de
   efectivo en $2,000, un gasto de **exactamente $2,000** pasa de «dentro del
   tope» a «sobre el tope»: el panel lo marca como no deducible por LISR 27-III
   cuando sí lo es.
2. `:132` — `(p_hasta is null or g.fecha <= p_hasta)` → `<`. El panel llena el
   rango con el año completo (`2026-01-01`…`2026-12-31`): **todo el 31 de
   diciembre desaparece del panel**, con su IVA acreditable. El rótulo sigue
   diciendo «del periodo».
3. `:126` — en `otro_ejercicio`, `− (case when extract(month from p_hoy) = 1
   then 1 else 0 end)` → `+`. En enero, **todos** los gastos del ejercicio
   corriente se marcan como «de otro ejercicio».
4. `:224` — `coalesce(sum(sub_total), 0) as sub_total` →
   `coalesce(sum(monto), 0)`. La celda publica como subtotal el total con IVA:
   sobre las tres filas de diésel de la propia prueba, `subTotal` pasa de su
   valor real a **$6,000** — y la prueba no lo mira.

**Por qué la prueba nueva no ve ninguna.** `0359_…sql` afirma exactamente dos
cifras —`panel = 6000` y `panel_iva = 827.59`, sumadas sobre las celdas con
`concepto = 'diesel'`— más `panel = motor`. De los **33 campos** que la función
publica por celda (`sobreTopeEfectivo`, `banda`, `otroEjercicio`, `subTotal`,
`ivaEstado`, `host`, `emisor`, `monedaExtranjera`, `renglonesAjenos`,
`consumoBar`, `complementoHidrocarburosFalta`, …) **no afirma ninguno**, y de
los 24 criterios del `group by` tampoco.

**Por qué importa que sea esta función y no otra.** La 0359 no cambió cuatro
líneas: **copió 274 líneas** a mano desde `pg_get_functiondef` para cambiar
cuatro. Su propio encabezado escribe el riesgo con todas sus letras
(«reescribir 190 líneas a mano para cambiar cuatro es cómo se cuela una
diferencia que nadie ve») y la prueba que la acompaña no lo cubre: no hay nada
en el repo que compare el cuerpo de la 0359 con el de la 0355 fuera del CTE
declarado.

**Consecuencia.** Es la pantalla `/dashboard/fiscal`: la que el contralor abre
para cruzar contra su póliza y su contador. Cualquiera de los cuatro cambios le
imprime una cifra fiscal falsa —o le esconde un día entero de gastos— y la
compuerta de CI sale verde. Es exactamente lo que `CLAUDE.md` prohíbe: «un
rótulo tiene que ser verdad» y «una cifra fiscal que se lee distinto en dos
pantallas se lee como dos cálculos».

**Causa raíz (una línea):** el arnés de una función de 274 líneas afirma dos
sumas sobre tres filas, así que sólo cubre el renglón que el commit tocó.

---

### [ALTO] `PRU32C2-A1` — NUEVO — el arreglo del reloj del cron sólo observa **uno** de los dos pasos del prólogo: anclar `entrada` detrás de `puertaCron` pasa con **10/10 verdes** y devuelve 9.5 s del presupuesto

`src/app/api/cron/asistencia/route.ts:42` ·
`src/app/api/cron/asistencia/route.test.ts:180-211` (la prueba que `4b84716`
reescribió) · `route.test.ts:31-36` (el mock de `puertaCron`)

**Escenario, con valores.**

```
-  const entrada = Date.now();
   const puerta = await puertaCron('asistencia', req, 'El reloj de emergencias no corre sin él.');
   if (puerta) return puerta;
+  const entrada = Date.now();
```

⇒ `npx vitest run src/app/api/cron/asistencia/route.test.ts` → **1 archivo, 10
pruebas, 0 fallos.** (La mutación hermana, con `entrada` detrás **también** de
`leerInterruptor`, sí muere: 1 roja. La diferencia entre las dos es de una
línea.)

La aritmética, con las constantes del repo (`TECHO_PASO_CONSULTA_MS = 9,500`,
`TECHO_ENVIO_WHATSAPP_MS = 10,000`, `MARGEN_MS = 105,500`):

| | ms |
|---|---|
| `venceEn` = `entrada` + 120,000 − 105,500 | entrada + 14,500 |
| `puertaCron` en producción (consulta a Supabase, techo) | hasta **+9,500** |
| Peor caso de la unidad admitida en `venceEn` (8 consultas + 2 envíos + latido) | 105,500 |
| Total desde que ENTRÓ la petición | **129,500 contra `maxDuration = 120,000`** |

**9.5 s por encima del hachazo de Vercel**, que es el mismo desbordamiento que
REN-31-C1 existió para cerrar, con el mismo desenlace: la función muere después
de que `reclamarEscalacionAsistencia` escribió `nivel_escalado = objetivo`, el
barrido siguiente filtra `.lt('nivel_escalado', NIVEL_MAXIMO)` y la emergencia
**sale del barrido para siempre** — sin `sendButtons`, sin `alertarOperador` y
sin fila de bitácora.

**Por qué la prueba no lo ve.** El caso inyecta demora con
`demoraInterruptorMs = 60`, y esa demora vive **sólo** dentro del mock de
`leerInterruptor` (`route.test.ts:21-25`). El mock de `puertaCron`
(`route.test.ts:32-36`) es `async (_c, req) => req.headers.get(...) === ... ?
null : new Response(...)`: **resuelve en 0 ms, siempre**. El prólogo real tiene
dos consultas y el arnés sólo puede observar una. La ironía está en el propio
mensaje de la aserción, que dice «en producción son **dos consultas**, hasta 9.5
s cada una» — y la prueba mide una.

**Consecuencia.** Un nivel 4 (volcadura con lesionados, 20 min sin que nadie
reconozca) que se pierde del barrido no se reintenta nunca. Y el arreglo es
reversible por la mitad en cualquier refactor del prólogo sin un solo rojo.

**Causa raíz (una línea):** la demora observable se inyectó en un solo paso del
prólogo, así que el ancla sólo está protegida contra la mitad de los sitios
donde se puede caer.

---

### [ALTO] `PRU32C2-A2` — NUEVO (primera ronda con `psql`) — **3 de los 16** arneses `.sql` que nadie corre están ROJOS hoy; uno lleva roto desde la 0325 y otro **sólo puede pasar según la hora del día**

`supabase/tests/0319_capacidad_jornada_wa.sql:133` ·
`supabase/tests/0327_jornada_r2_regresiones.sql:83` ·
`supabase/tests/0336_capacidad_r5_red.sql:88` y `:7-14` ·
`.github/workflows/ci-postgres.yml` (ninguno de los tres aparece)

**Escenario, con valores.** Corrí los 16 `.sql` huérfanos (los 13 `.sh` piden
dos sesiones y quedaron fuera) contra la base con las 336 migraciones:

1. **`0319_capacidad_jornada_wa.sql:133`** —
   `finalizar_jornada_derivacion(viejo, 'muerto', true, null, 0)` revienta con
   `ERROR: jornada derivacion ACK success delay must be between 1 and 86400`.
   Esa guarda la añadió **`0325_capacidad_wa_jornada_timezone.sql:1376`**: el
   arnés se escribió contra el contrato anterior y lleva **34 migraciones**
   roto.
2. **`0327_jornada_r2_regresiones.sql:83`** — es su **propia** aserción la que
   lanza: `R2-07 RED: versión GPS no está acotada a unidades exclusivas`. El
   bloque exige que `pg_get_functiondef('sellar_invalidacion_jornada_versionada()')`
   contenga `with unidades as` y `join unidades u`; la migración **0331** dejó
   esa función como un envoltorio de cuatro líneas que delega en
   `reconciliar_input_version_jornada`. El cuerpo se mudó; la aserción se quedó
   mirando el sitio viejo.
3. **`0336_capacidad_r5_red.sql:88`** — `new row for relation "posicion"
   violates check constraint "posicion_medida_en_no_futura"`. El fixture
   (`:7-14`) construye `hora_11` = **hoy a las 11:00 America/Tijuana** y la
   inserta como `medida_en`; el constraint de la 0287 exige
   `medida_en <= recibida_en + interval '1 hour'`. Medido en la base, a las
   **04:23 Tijuana**: `hora11_es_futura = t`. O sea que este arnés **pasa o
   falla según la hora a la que se corra** — verde por la tarde, rojo por la
   mañana. Es la definición de prueba intermitente, y por eso nadie la ha visto:
   no se corre nunca.

**Consecuencia.** Un arnés rojo que nadie ejecuta es peor que ninguno: aparece
en el repo como si algo estuviera vigilado. Los tres cubren jornada, capacidad y
GPS —`posicion` y `jornada` tienen escritores vivos (`processor.ts` y
`conectores/sincronizar_gps.ts`)—, y el equipo que mantenga eso va a leer el
nombre del archivo y suponer que hay red. `PRU-31-M5` (REINCIDENTE, MEDIO)
contaba los huérfanos desde la ronda 30; esto es lo que había dentro:
**29 de 56** arneses sin invocar, y de los 16 `.sql`, 3 ya no pasan.

**Causa raíz (una línea):** los arneses se escriben en `supabase/tests/` y se
cablean a mano en `ci-postgres.yml`, y nada falla cuando el cableado se olvida.

---

### [ALTO] `PRU32C2-A3` — NUEVO — el ejercicio fiscal del motor del 15 % puede perder **un mes entero** y el dedup por CFDI puede dejar de normalizar, con los 21 arneses y los 243 bloques en verde

`supabase/migrations/0358_dedup_emisor_conocido.sql:69` (la ventana del
ejercicio), `:90` (`lower(cfdi_uuid)`), `:64` (`nullif(rfc_emisor,'')`) ·
`supabase/tests/0357_dedup_ejercicio_emisor.sql` y `0358_…sql` (ninguna fila en
diciembre, ninguna con `cfdi_uuid`, ninguna con `rfc_emisor = ''`)

**Escenario, con valores, tres mutaciones.**

1. `:69` — `and fecha <= make_date(p_anio, 12, 31)` →
   `make_date(p_anio, 11, 30)`. **Todo diciembre sale del ejercicio.** Con
   `$1,400,000` de combustible anual de los que `$120,000` son de diciembre,
   `total` baja a `$1,280,000` y el `tope = 0.15 * total` de `engine.ts:812`
   pasa de `$210,000` a `$192,000`: **$18,000 de diésel pagado en efectivo que
   sí eran deducibles se imprimen en el PDF como no deducibles.** ⇒ 21 arneses
   SQL verdes **y** batería `243 · 239 ok · 0 fallos`.
2. `:90` — `partition by lower(cfdi_uuid), coalesce(cfdi_orden, 1)` →
   `partition by cfdi_uuid, …`. El dedup por CFDI deja de ser insensible a
   mayúsculas — la normalización que la propia rama defiende para el folio
   (`folio_norm`, «el mismo folio aparecía como 286188 y como 059286188»). ⇒
   los 5 arneses verdes. **Ninguna fila de ninguna prueba de esta función
   inserta un `cfdi_uuid`**: la primera rama del `CASE`, que es el camino normal
   de un gasto con factura, no la ejercita nadie.
3. `:64` — quitar `nullif(rfc_emisor, '')`. Si el OCR escribe cadena vacía en
   vez de `NULL`, dos fotos del mismo ticket de $2,500 con el RFC leído en una
   sola vuelven a contar **$5,000** — la regresión `DAT32C-C1` exacta que la
   0358 se escribió para cerrar, entrando por la otra puerta. ⇒ los 5 arneses
   verdes. La guarda que evita la reincidencia no tiene prueba.

**Consecuencia.** Las tres caen del lado del cupo del 15 % de la LISR 27-III,
que es la cifra que el PDF de liquidación imprime y el contralor coteja. La
(1) le niega a la flota una deducción que le toca; la (3) reabre la regresión
crítica de ayer sin que nada se ponga rojo.

**Causa raíz (una línea):** las tres pruebas de esta función fijan la
**dimensión que el commit cambió** (el emisor) y ninguna de las otras tres de
la misma llave (la ventana del año, el uuid, la normalización del vacío).

---

### [CRÍTICO] `PRU-C1` — **REINCIDENTE, 5.ª ronda** — la cifra de dinero que la pantalla imprime sigue en 0; con las de hoy van **0 de 18**

`vitest.config.ts:104` (`'src/app/**/*.tsx'` sigue en `coverage.exclude`,
releído hoy) · `src/app/dashboard/rentabilidad/vista.tsx:173-174` ·
`src/app/dashboard/combustible-casetas/vista-consolidado.tsx:43`

**Escenario, con valores.** Repetí las dos mutaciones de la ronda pasada, las
dos a la vez: en `rentabilidad/vista.tsx` intercambié las columnas contiguas
`{mxn(f.pagado)}` y `{mxn(f.saldo)}` —con una factura de `total $116,000`,
`pagado $40,000`, `saldo $76,000`, la pantalla dice «Pagado **$76,000** · Saldo
**$40,000**»— y en `combustible-casetas/vista-consolidado.tsx:43` puse el monto
de cada línea en `mxn(0)`.

⇒ `npx vitest run src/app/dashboard/` → **94 archivos, 613 pruebas, 0 fallos.**

**Lo que cambia respecto a la ronda pasada: el conteo.** Eran 14 mutaciones
acumuladas sin un rojo. Esta ronda añade **cuatro más, en la capa SQL** (las de
`PRU32C2-C1`: `sobreTopeEfectivo`, el borde del periodo, `otroEjercicio` y
`subTotal`), todas sobre cifras que `/dashboard/fiscal` imprime, todas verdes.
**0 de 18.** La clase ya no es «la capa `.tsx` está fuera del denominador»: es
que la cifra impresa no tiene arnés **en ninguna de las dos capas donde se
produce**.

**Consecuencia.** La regla que define el producto es «nunca inventar una
cifra». El contralor abre Rentabilidad para saber cuánto le deben y la columna
«Saldo» le enseña lo que ya cobró. Hoy hay 988 archivos de prueba y ninguna se
pone roja por eso.

**Causa raíz (una línea):** la puerta de cobertura mide donde el dinero se
*calcula* y excluye por configuración donde se *imprime*, así que escribir
pruebas ahí no produce señal y no escribirlas no produce alarma.

---

### [ALTO] `PRU-31C-A1` — **REINCIDENTE** — el ancla de `REN-30-C1` sigue probando el motor del reloj con el cableado desnudo

`src/app/dashboard/agentes/peajes/page.tsx:234` ·
`src/lib/likida/intake/consolidado_barrido.test.ts:282-322`

**Escenario.** `await barrerPorConciliar(tenantId, { venceEn: ahoraMs() +
25_000 })` → `await barrerPorConciliar(tenantId)`. Compila y es legal
(`opts.venceEn ?? Number.POSITIVE_INFINITY`), y devuelve el barrido al estado
de antes de `54bddb2`: ~914 s nominales contra los 300 s de techo. ⇒ **94
archivos, 613 pruebas, 0 fallos** (eran 612 en la ronda pasada; el hueco no se
movió).

**Consecuencia.** Sin cambio respecto a la 31: la plataforma corta a media
línea, `ligarLineaAGasto` deja el sello escrito en `gasto`, el UPDATE que cierra
la línea no corre, y el contador ve un error genérico sobre un barrido que SÍ
amarró conciliaciones fiscales.

**Causa raíz:** se probó el parámetro y no el argumento.

---

### [ALTO] `PRU-31C-A2` — **REINCIDENTE** — el margen del cron se sigue anclando contra sí mismo: una **novena** consulta pasa con 33/33 verdes

`src/app/api/cron/asistencia/route.ts:88` ·
`src/app/api/cron/asistencia/route.test.ts:156` (`PEOR_CASO_ESCALADA_MS`
escrito a mano) · `src/lib/likida/asistencia_escalamiento.ts:310`

**Escenario, con valores.** La ronda pasada el hueco era la **octava** consulta;
`f4fde69`/la continuación la contaron y subieron el literal a `consultas: 8`.
Hoy añadí una **novena**, sobre una tabla que el mock ya conoce:

```
+ await acotada(supabaseAdmin().from('viaje').select('operador_id')
+   .eq('id', inc.viajeId ?? '').eq('tenant_id', inc.tenantId).maybeSingle(), 'asistencia.mutacion_a2');
  const gano = await reclamarEscalacionAsistencia(...);
```

⇒ `npx vitest run src/app/api/cron/asistencia/ src/lib/likida/asistencia_escalamiento.test.ts`
→ **2 archivos, 33 pruebas, 0 fallos.** Peor caso real con 9 consultas:
`9×9,500 + 2×10,000 + 9,500 (latido) = 115,000`; `venceEn` = entrada + 14,500 ⇒
**129,500 contra `maxDuration = 120,000`**, 9.5 s de más.

**Lo que confirma la mutación fallida.** Con `from('unidad')` —tabla que el mock
no conoce— mueren 8 pruebas, pero por `TypeError: Cannot read properties of
undefined`, no por una aserción de conteo. La prueba detecta **tablas
desconocidas**, no consultas de más. Nada en el repo cuenta la cadena de
`escalarUna`; el `8` vive escrito a mano en `route.ts:88` y otra vez en
`route.test.ts:156`, y las aserciones comparan el literal contra sí mismo.

**Consecuencia:** la misma de la 31 — el nivel 4 se pierde del barrido y no se
reintenta. El arreglo protege contra que alguien *teclee* mal el margen, no
contra que la cadena crezca, que es como crecen.

---

### [ALTO] `PRU-31C-A3` — **REINCIDENTE** — la propiedad de seguridad de `8c0e7df` la sigue sosteniendo un `grep` del fuente

`scripts/ci/deriva-sin-desplegar.mjs:30` ·
`scripts/ci/deriva_sin_desplegar.test.ts` (ahora **17** pruebas, la versión que
en la 31 estaba «en vuelo» ya está commiteada)

**Escenario.** `execFileSync('git', args, …)` →
`execFileSync('sh', ['-c', \`git ${args.join(' ')}\`], …)`. ⇒ **1 archivo, 17
pruebas, 0 fallos.** El fuente sigue conteniendo `execFileSync` y sigue sin
contener `execSync(\``, que son las dos cosas que la prueba mira; y el shell
está de vuelta. Con `desplegado = 'a;rm -rf /'` la línea que corre es
`sh -c "git log … a;rm -rf /..origin/master --"`.

**Nuevo dato de esta ronda:** el arreglo de `OP-31C-A1` añadió pruebas (de 10 a
17) y **ninguna** de las siete nuevas ejecuta `correrGit`; sigue siendo el valor
por defecto del tercer parámetro y ninguna prueba de la suite lo llama.

**Consecuencia.** El detector corre en `salud-produccion.yml` con `$version`
salido de un `curl` a `/api/health`: entrada externa en un runner con el
checkout del repo.

**Causa raíz:** se afirmó la FORMA del fuente en vez del EFECTO, y el único
camino que produce el efecto no se ejecuta nunca.

---

### [MEDIO] `PRU-31C-M1` — **REINCIDENTE** — el cableado del detector de deriva sigue sin quien lo muerda, ahora con 17 pruebas

`.github/workflows/salud-produccion.yml:173` y `:180` ·
`scripts/ci/deriva_sin_desplegar.test.ts`

| Mutación | Resultado hoy |
|---|---|
| `:180` argumentos invertidos → `deriva-sin-desplegar.mjs origin/master "$version"` | **VERDE — 17/17** |
| `:173` el paso entero con `if: false` | **VERDE — 17/17** |

La primera es la peor porque es silenciosa y plausible: con producción atrás de
master el rango `origin/master..$version` está **vacío**, así que el detector
imprime «no hay deriva» en cada pulso. Es el verde-mentiroso que `30e5e14` se
escribió para terminar, con el detector instalado y verde. Sigue vigente el
sexto día con producción 8 días atrás de master (21 archivos sin publicar, ver
el MAPA).

---

### [MEDIO] `PRU-31C-M2` — **REINCIDENTE** — la frontera de etiqueta no distingue **cuál** `<span>` imprimió la cifra

`src/app/dashboard/agentes/peajes/controles.tsx:86` y `:88` ·
`src/app/dashboard/agentes/peajes/acuse-corte.test.tsx:63,83-90`

**Escenario.** Intercambiar `{r.revisadas}` y `{r.conciliadas}` en las dos
etiquetas contiguas del acuse: sobre `{revisadas: 3, conciliadas: 1, …}` la
pantalla dice «Revisé **1** línea pendiente; amarré **3** contra gastos nuevos».
⇒ `npx vitest run src/app/dashboard/agentes/peajes/` → **3 archivos, 8 pruebas,
0 fallos**, porque el `3` sigue apareciendo, sólo que en el otro `<span>`. Tres
de las cinco cifras del acuse (`conciliadas`, `candidatosRefrescados`,
`siguenPendientes`) siguen sin aserción.

---

### [MEDIO] `PRU-31C-M3` — **REINCIDENTE** — la guardia de `acotada()` sigue siendo un `grep` de `await supabaseAdmin()`

`src/lib/likida/asistencia_escalamiento.ts:326-327` ·
`src/lib/likida/asistencia_escalamiento.test.ts`

**Escenario.** Hoistear la consulta de `viaje` a una variable
(`const cons = supabaseAdmin()…; const { data: v } = await cons;`) la deja sin
techo y hereda los 300 s de undici. ⇒ **2 archivos, 33 pruebas, 0 fallos**: la
prueba cuenta ocurrencias de la cadena literal `await supabaseAdmin()`, que ya
no aparece.

---

### [MEDIO] `PRU-31-M5` — **REINCIDENTE (4.ª ronda), recontado hoy** — **29 de 56** arneses de `supabase/tests/` no los invoca nadie

`.github/workflows/ci-postgres.yml` · `supabase/tests/` (56 archivos)

La ronda 32 añadió tres arneses y los tres **sí** quedaron cableados
(`0357`, `0358`, `0359` aparecen en el workflow — verificado). El denominador
sube de 53 a 56 y el numerador se queda en 29: **16 `.sql` y 13 `.sh`** que no
corren, todos de las series de capacidad/jornada/GPS/Cal.com (0319 a 0337).
Lo nuevo y grave de esta ronda está en `PRU32C2-A2`: tres de esos 16 ya no
pasan.

---

## Lo que revisé y está bien

- **Los cuatro commits de la ronda muerden en su línea exacta.** Seis reverts
  dirigidos, seis rojos: `0358_…:101` en las dos direcciones (S1, S2),
  `0359_…:166` en las dos direcciones (P1, P2), y `route.ts:42` / `route.ts:88`
  (T1, T2). Ningún arreglo de esta rama es reversible en su punto exacto con la
  suite verde — es la primera ronda en cuatro de la que se puede decir eso.
- **El intermitente de `cron/asistencia/route.test.ts` está cerrado de verdad.**
  **0 rojas de 25** corridas aisladas, más la corrida completa bajo carga (988
  archivos en paralelo). El `vi.useFakeTimers({ toFake: ['Date'] })` de
  `route.test.ts:243` no afloja la aserción: congelado `Date`, δ = 0 y la
  comparación se reduce al invariante `margen ≥ peor caso`, que T2 demuestra que
  sigue mordiendo.
- **Las 336 migraciones aplican limpias sobre base virgen** (`0332` con su
  preflight de índices), y la batería Capa 1 pasa entera: **243 bloques · 239 ok
  · 0 fallos · 4 reportes**. El job de `ci-postgres.yml` es reproducible tal
  como está escrito.
- **`ci.yml` corre en cada push de cualquier rama** (`branches: ['**']`, `:23`)
  con `typecheck`, `lint:ratchet`, cobertura con umbral, pruebas de tiempo,
  build y smoke de Playwright. `ci-postgres.yml` igual (`:60-62`). No hay rama
  que se escape de la compuerta.
- **El dedup por folio del motor del 15 % está anclado en sus dos piezas
  clásicas:** quitar `folio_norm` de la partición (`0358_…:99`) mata 0349, 0357
  y 0359; sacar `'02'` de la lista de formas de pago no-efectivo (`:124`) mata
  0349 con `efectivo=1300 esperado 300`.
- **La aritmética fiscal de la escritura de facturas muerde.**
  `facturacion_escritura.ts:161`, `subtotal + iva − retencion` → `+ retencion`:
  **1 roja de 63**. La zona de «escritura del dinero» que la 31 dejó anotada sin
  medir no está desnuda en su cálculo central.
- **Los tres arneses nuevos están cableados en el workflow** y corren en el
  bloque «DB retención — exactitud, deadlines, locks y concurrencia»
  (`ci-postgres.yml`, tres líneas añadidas por la ronda). Verificado nombre por
  nombre.
- **`migraciones_verificadas.test.ts`** tiene entrada `EXENTAS['0359']` con el
  ID del hallazgo (`DAT32C-C2`), el número medido del rojo y el nombre del
  arnés. La convención de anclar el arreglo al ID del bug se respetó en los
  cuatro commits.

---

## Lo que NO alcancé a revisar

- **Los 13 arneses `.sh` huérfanos** (concurrencia, dos sesiones): los conté y
  no los corrí. De los 16 `.sql` sí corrí los 16. Si la proporción de rojos se
  repite, hay ~2 más rotos ahí.
- **`pg_prove` / la Capa 0 (`wa_leases_fencing.sql`, pgTAP)**: la extensión
  `postgresql-16-pgtap` no está en la imagen y no hay red para instalarla.
  Décima ronda fuera.
- **Playwright / `e2e-navegador.yml`**: sin navegador, fuera otra vez.
- **No corrí `--coverage`.** Lo que afirmo del denominador sale de leer
  `vitest.config.ts:60` (`include: ['src/**/*.{ts,tsx}']`, así que `scripts/` y
  `supabase/` quedan fuera) y `:104` (`exclude: 'src/app/**/*.tsx'`).
- **No verifiqué si el cuerpo copiado de la 0359 es idéntico al de la 0355**
  fuera del CTE declarado. Es trabajo del rubro de modelo de datos; lo mío es
  que **ninguna prueba lo verifica** (`PRU32C2-C1`), y eso sí está medido.
- **26 mutaciones no son la suite.** Fueron dirigidas: los cuatro commits de la
  ronda, sus vecindades inmediatas y los siete reincidentes. Quedaron sin atacar
  `intake/ocr`, `carta_porte_xml`, el timbrado, los agentes, y casi todo
  `src/app/api/` — incluido `api/v1/_escritura.ts`, que escribe `ingreso_flete`,
  `anticipo` y `km_recorridos` y que la 31 dejó anotado como zona de escritura
  de dinero sin medir. Sigue sin medir.
- **No re-muté los reincidentes cuyo código no cambió más allá de una vez cada
  uno.** Cada cifra de arriba es una corrida, no un promedio.

---

## Estado del árbol al entregar

`git status --short` → **vacío** (`git status --porcelain | wc -l` → `0`),
verificado al cerrar.

Las 9 mutaciones TS vivieron en el árbol de trabajo y se revirtieron con
`git checkout -- <archivo>` en la **misma** llamada de bash que las aplicó, con
`git status --short` comprobado vacío antes de pasar a la siguiente. Las 17
mutaciones SQL **nunca tocaron el repo**: se aplicaron a la base efímera con
`create or replace` desde copias en `/var/tmp/pgaud32/` y se restauraron
reaplicando la migración original del repo.

Nota, por si aparece en otra medición: durante la corrida final apareció
transitoriamente ` M .github/workflows/salud-produccion.yml` y
` M scripts/ci/deriva_sin_desplegar.test.ts` con `git diff` **vacío** un segundo
después, y la suite pasó de 12,976 a 12,979 pruebas mientras yo medía. **No es
mío**: es otro agente escribiendo en el mismo árbol, igual que en la
continuación 2 de la 31. Lo dejé intacto.

Mi único archivo escrito es **`docs/auditoria-32/pruebas.md`**, que no aparece
en `git status` porque `.gitignore:36` ignora `docs/auditoria-*/` (confirmado
con `git check-ignore -v`; se commitea con `git add -f`).
