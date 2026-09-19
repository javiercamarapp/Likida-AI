# Pruebas — auditoría 32, continuación 3 (19-sep-2026)

**Nota: 4/10** (antes 5). Razón del movimiento: **mirada más profunda — el
código no cambió para peor, la nota anterior estaba inflada.**

La 5 de ayer se sostuvo sobre una frase mía que hoy no resiste: *«la suite TS de
12,979 pruebas sí muerde donde la probé (`facturacion_escritura.ts`), y es el
arnés SQL el que pasa con la función fiscal rota»*. Hoy probé **tres sitios más
de ESCRITURA de dinero en TS** —los tres que ocho rondas seguidas dejé anotados
en «lo que NO alcancé a revisar»— y los tres están desnudos:

- `cfdi_consolidado_linea`, la cola del contador y la única fuente de los
  litros del ECC: escribirla con **`monto: 0` en todas sus filas** pasa con
  **989 archivos / 12,990 pruebas / 0 fallos**. Con `litros: null`, igual.
- `viajeCoincide`/`unidadCoincide` (`api/v1/_escritura.ts`), la guarda del
  hallazgo A8 —«el TMS manda montos corregidos y se descartan en silencio»—:
  **13 de sus 14 comparaciones se pueden BORRAR una por una** con 207/207
  verdes, incluidas las cuatro de dinero. Borrar la del anticipo pasa con
  **989 / 12,997 / 0 fallos**.
- `montoIgual`: subir la tolerancia de medio centavo a **cinco pesos** pasa
  207/207.

El ancla del rubro dice «4 o menos si la suite pasa con la función rota». Ayer
eso era cierto sólo en la capa SQL y lo compensé con la TS; hoy es cierto en las
dos. **4.**

La fuerza contraria existe y es real, por eso no bajo a 3: **`e47f974`, el
arreglo a mi propio ALTO, MUERDE en su línea exacta** (las dos mutaciones que
reporté en la 31 y la 32 mueren hoy: 2 rojas y 1 roja), y **los tres archivos de
prueba de `fc811a0` muerden en el cableado**, que es justo lo que las dos rondas
anteriores no lograron. `PRU-31C-A1` se cierra. Pero un arreglo que cierra no
compensa que la escritura del dinero no tenga arnés.

**Riesgo mayor del rubro, hoy:** el producto sabe probar cómo se CALCULA el
dinero y no sabe probar cómo se ESCRIBE. `cfdi_consolidado_linea` se puede
escribir entera en ceros y `viajeCoincide` puede dejar de comparar el anticipo,
las dos con la suite completa en verde — y las dos son el camino por el que el
dinero entra a la base.

---

## Veredicto sobre las pruebas nuevas de la continuación 2

| Archivo | Qué muté | Qué pasó | ¿Muerde? |
|---|---|---|---|
| `src/app/dashboard/agentes/peajes/reloj-cableado.test.ts` (`e47f974`) | (a) borrar `{ venceEn: ahoraMs() + 25_000 }` de `page.tsx:234`; (b) `{ venceEn: 0 }`; (c) `25_000` → `25_000_000` | (a) **ROJO 2/11** · (b) **ROJO 1/11** · (c) **VERDE 3/3 y 11/11** | **Muerde en la forma, NO en la magnitud** → `PRU32C3-A1` |
| `src/lib/likida/intake/consolidado_orquestador.test.ts` (`fc811a0`) | quitar `venceEn` de `candidatosDeGasto(tenantId, rango, venceEn)` (`consolidado.ts:485`) | **ROJO 1/56** | **Muerde** (con un hueco de rótulo: `PRU32C3-B1`) |
| `src/lib/likida/pg.test.ts` (`fc811a0`) | el corte de `traerTodoDesdeId` deja de LANZAR y devuelve lo leído (`pg.ts:304`) | **ROJO 3/35** (mata también al orquestador) | **Muerde** |
| `src/lib/likida/sat_descarga/ciclo_flota.test.ts` (`fc811a0`) | quitar `venceEn` del despacho `guardarYConciliarConsolidado(cfg.tenantId, cfdi, xml, venceEn)` (`ciclo.ts:341`) | **ROJO 1/56** | **Muerde** — es el único de los tres que prueba el CABLEADO, y cumple |
| `scripts/ci/deriva_sin_desplegar.test.ts` (`2c38766`) | (a) revertir `format('{0}', …) == '0'` → `steps.deriva.outputs.hay == '0'` (`salud-produccion.yml:226`); (b) `--label` del bucle de cierre (`:232`); (c) `--label` del `gh issue create` (`:211`); (d) el paso del detector con `if: false` (`:174`) | (a) **ROJO 1/20** · (b) **VERDE 20/20** · (c) **VERDE 20/20** · (d) **ROJO 1/20** | **Muerde en la CONDICIÓN, no en el CUERPO** → `PRU32C3-M1` |

Dos cosas que se cierran y hay que decirlas:

- **`PRU-31C-A1` (ALTO, 2 rondas) está CERRADO.** `e47f974` mata las dos
  mutaciones exactas que reporté, y el corte por expresión equilibrada
  (`llamada()`) no se satisface con un comentario ni con la línea movida.
- **`PRU-31C-M1` (MEDIO, reincidente) está CERRADO A MEDIAS.** La mutación
  `if: false` sobre el paso del detector, que ayer pasaba 17/17, **hoy muere**
  —efecto lateral del invariante «el cierre repite las guardas del medidor» que
  añadió `2c38766`—. La otra mitad, los argumentos invertidos en `:180`, sigue
  **VERDE 20/20**.

**Estabilidad del intermitente de `cron/asistencia/route.test.ts`:** **0 rojas
de 20 corridas aisladas** hoy, más dos corridas completas de la suite en
paralelo. Sigue cerrado; no hay regresión.

---

## Hallazgos

### [CRÍTICO] `PRU32C3-C1` — NUEVO — el upsert de `cfdi_consolidado_linea` —la cola del contador y la única fuente de los litros del ECC— se puede escribir en ceros con la suite completa en verde

`src/lib/likida/intake/consolidado.ts:523` (`monto`) y `:536` (`litros`) ·
`src/lib/likida/intake/consolidado_orquestador.test.ts:120`
(`expect(lineasUpsertPayload).toHaveLength(2)` — la única aserción del camino
feliz sobre ese payload) · `src/lib/likida/startup.ts:222`

**Escenario, con valores, dos mutaciones, las dos contra la SUITE COMPLETA.**

1. `:523` — `monto: r.linea.monto` → `monto: 0`.
   ⇒ `npx vitest run` → **989 archivos · 12,990 pruebas · 6 saltadas · 0 fallos**
   (byte por byte el baseline que medí al arrancar).
   Cada línea de un consolidado ECC se guarda con importe **$0.00**. El panel
   de Combustible & Casetas lista la cola con `$0.00` por línea, y
   `cuadre/desde_db.ts:279-292` —que lee `fecha, monto, estacion_rfc` de esta
   misma tabla para el cruce de peaje/diésel por estación— cruza contra ceros.
2. `:536` — `litros: litrosDeLinea(r.linea)` → `litros: null`.
   ⇒ **989 · 12,990 · 0 fallos**, otra vez idéntico.
   El camino automático no se entera (liga con `datosDieselDeLinea(r.linea)`,
   tomado del XML). Los que sí se rompen son los **dos caminos que releen la
   columna, nunca el XML**: `resolverLineaAMano` (`consolidado.ts:613` →
   `:650`) y `barrerPorConciliar` (`:788`). Ahí
   `diesel = litros != null && litros > 0 && clave ? {…} : undefined` se vuelve
   `undefined`, `ligarLineaAGasto` no escribe `ocr_extra.litros` ni
   `clave_prod_serv`, y el gasto llega al motor sin litros.
   La consecuencia está escrita en el repo, palabra por palabra, en
   `startup.ts:222`: *«los litros del ECC se leen y se tiran: flota con monedero
   queda en cero IEPS»*.

**Por qué ninguna prueba lo ve.** El payload tiene **14 columnas**
(`tenant_id, cfdi_xml_id, indice, fuente, fecha, monto, descripcion,
estacion_rfc, estacion_clave, folio_operacion, estatus, gasto_id, candidatos,
litros, clave_prod_serv`). El único arnés del orquestador afirma sobre él
`toHaveLength(2)` en el camino feliz, y en el caso de REANUDACIÓN (`:150-152`)
dos campos de una fila (`estatus`, `gasto_id`). **De los 14, se afirman 2, y
ninguno es una cifra.**

**Consecuencia.** Es exactamente la clase que `PRU-C1` lleva cinco rondas
describiendo en la capa de pantalla, pero un piso más abajo: aquí la cifra no se
imprime mal, se **guarda** mal, y todo lo que la lea después —panel, PDF, IEPS
acreditable— la hereda. La línea del contador dice `$0.00` sobre un ticket de
$4,700, o la flota de monedero pierde el acreditamiento de IEPS de cada litro
que un humano resolvió a mano.

**Causa raíz probable (una línea):** el arnés del orquestador se escribió para
probar la ORQUESTACIÓN (qué se llama, en qué orden, qué lanza) y nunca el
CONTENIDO de lo que escribe.

---

### [CRÍTICO] `PRU32C3-C2` — NUEVO — la guarda que impide que la API descarte los montos del integrador en silencio: **13 de sus 14 comparaciones se pueden borrar** con la suite en verde

`src/app/api/v1/_escritura.ts:837-846` (`viajeCoincide`), `:908-911`
(`unidadCoincide`), `:832` (`montoIgual`) ·
`src/app/api/v1/_escritura.test.ts:434-454` (la prueba «EL HALLAZGO A8», la
única de contenido distinto) y `:471-489` (la de la carrera)

**Escenario, con valores.** Borré **una por una** las 14 comparaciones de campo
de las dos funciones `…Coincide` (cada una sustituida por `true`), corriendo
`npx vitest run src/app/api/v1/` tras cada borrado:

| Comparación borrada | Resultado |
|---|---|
| `uuidIgual(fila.operadorId, …)` `:838` | **VERDE 207/207** |
| `textoIgual(fila.origen, …)` `:839` | ROJO 1/207 ← la única |
| `textoIgual(fila.destino, …)` `:840` | **VERDE 207/207** |
| `textoIgual(fila.fechaInicio, …)` `:841` | **VERDE 207/207** |
| `uuidIgual(fila.unidadId, …)` `:842` | **VERDE 207/207** |
| `uuidIgual(fila.clienteId, …)` `:843` | **VERDE 207/207** |
| `montoIgual(fila.ingresoFlete, …)` `:844` | **VERDE 207/207** |
| `montoIgual(fila.kmRecorridos, …)` `:845` | **VERDE 207/207** |
| `montoIgual(fila.anticipo, …)` `:846` | **VERDE 207/207** |
| `textoIgual(fila.placas/marca/modelo, …)` `:908-910` | **VERDE 207/207** ×3 |
| `montoIgual(fila.anio, …)` `:911` | **VERDE 207/207** |
| el `toLowerCase()` de `uuidIgual` `:827` | **VERDE 207/207** |

Y el del anticipo, repetido contra la **suite completa**:
⇒ `npx vitest run` → **989 archivos · 12,997 pruebas · 6 saltadas · 0 fallos.**

Aparte: `montoIgual` `:832`, tolerancia `< 0.005` → `< 5`. ⇒ **VERDE 207/207**:
un anticipo de $2,500.00 y uno de $2,504.99 pasan a ser «el mismo contenido».

**Por qué.** `viajeCoincide` es un `&&` de nueve términos, y la única prueba que
manda contenido DISTINTO (`_escritura.test.ts:441`) cambia **dos campos a la
vez**: `viajeMinimo({ ingresoFlete: 18500, anticipo: 2500 })`. Con un solo
término vivo, el `&&` ya devuelve `false` y el 409 sale igual. La otra
(`:471`, la carrera) cambia sólo `origen` — por eso `origen` es el único que
muere. **Ocho de los nueve términos están cubiertos por un `&&` ajeno, no por
una aserción propia.**

**Consecuencia.** La prueba se titula «EL HALLAZGO A8» y su comentario dice el
caso real: *«el TMS mandaba el folio existente con montos corregidos y una llave
nueva, recibía `200 {idempotente:true}` con la fila VIEJA, y sus montos se
descartaban sin log»*. Con `montoIgual(fila.anticipo, …)` borrada, un TMS que
corrige el anticipo de $2,500 a $18,000 sobre el folio `F-001` recibe
**`200 idempotente: true`** y se va convencido de que se guardó. El contralor
liquida ese viaje contra un anticipo de $2,500 que ya no existe: la diferencia
del cuadre sale $15,500 mal, en el sentido de cobrarle al chofer lo que no debe.
Lo mismo con `ingresoFlete` (el margen del viaje) y con `kmRecorridos` (el
costo por kilómetro de todo el panel).

**Causa raíz probable (una línea):** una prueba que cambia dos campos a la vez
sólo demuestra que **alguno** de los dos se compara, y el resto de la llave
hereda ese verde gratis.

---

### [ALTO] `PRU32C3-A1` — NUEVO — el arreglo `e47f974` afirma la FORMA del reloj y no su MAGNITUD: `ahoraMs() + 25_000_000` pasa 3/3

`src/app/dashboard/agentes/peajes/reloj-cableado.test.ts:63`
(`toMatch(/venceEn:\s*ahoraMs\(\)\s*\+/)`) ·
`src/app/dashboard/agentes/peajes/page.tsx:234`

**Escenario, con valores.**

```
-  const resumen = await barrerPorConciliar(tenantId, { venceEn: ahoraMs() + 25_000 });
+  const resumen = await barrerPorConciliar(tenantId, { venceEn: ahoraMs() + 25_000_000 });
```

⇒ `npx vitest run src/app/dashboard/agentes/peajes/reloj-cableado.test.ts` →
**1 archivo · 3 pruebas · 0 fallos**; la carpeta entera, **4 archivos · 11
pruebas · 0 fallos**.

El corte de `consolidado.ts:872` es `if (Date.now() > venceEn) …`. Con
`venceEn = ahora + 25,000,000 ms` (~6 h 57 min) el `if` **nunca es verdadero**,
así que el barrido vuelve a correr hasta agotar su cola: los mismos ~914 s
nominales contra los 300 s de techo que `54bddb2` cerró y que yo reporté como
`PRU-31C-A1` en la 31 y en la 32. La Server Action no declara `maxDuration`, la
plataforma corta a media cola, `ligarLineaAGasto` deja el sello escrito en
`gasto` y el UPDATE que cierra la línea no corre.

**Lo que el arreglo SÍ cerró, y hay que decirlo:** las dos mutaciones que
reporté mueren (`barrerPorConciliar(tenantId)` → 2 rojas;
`{ venceEn: 0 }` → 1 roja). La segunda aserción existe precisamente para matar
un literal pegado. Lo que queda abierto es el rango: **cualquier número** detrás
de `ahoraMs() +` satisface la expresión regular, incluidos los que desarman el
corte. La prueba hermana del acuse sí muerde (fijar `estado: 'ok'` en
`page.tsx:243` → 1 roja de 11), así que el hueco es sólo éste.

**Consecuencia.** El arreglo a un ALTO reincidente es reversible cambiando un
número, que es como cambian los presupuestos de tiempo cuando alguien «le da un
poco más de aire» a un barrido que se quedaba corto.

**Causa raíz probable (una línea):** se afirmó que el argumento EXISTE y que es
un instante calculado, no que el instante caiga dentro del techo de la
plataforma.

---

### [MEDIO] `PRU32C3-M1` — NUEVO — la prueba de `2c38766` evalúa la CONDICIÓN del paso y nunca su CUERPO: el issue se puede abrir y cerrar con la etiqueta equivocada, 20/20 verdes

`.github/workflows/salud-produccion.yml:211` (`gh issue create --label …`) y
`:232` (`gh issue list --label …` del bucle de cierre) ·
`scripts/ci/deriva_sin_desplegar.test.ts:196-213`

**Escenario, con valores, dos mutaciones.**

1. `:211` — `gh issue create … --label deriva-sin-desplegar` → `--label
   salud-produccion`. ⇒ **20/20 verdes.** La prueba de `:196` exige que el paso
   contenga la cadena `deriva-sin-desplegar`, y la sigue conteniendo: está en el
   `gh issue list --label deriva-sin-desplegar` de la línea anterior, la del
   dedup. Efecto real: el dedup **nunca encuentra** el issue que acaba de crear
   —porque lleva otra etiqueta—, así que **cada pulso abre uno nuevo**; con el
   `cron: '*/30 * * * *'` declarado son hasta 48 issues al día, y el paso de
   cierre (que lista `deriva-sin-desplegar`) no cierra ninguno.
2. `:232` — el bucle de cierre lista `--label salud-produccion` en vez de
   `deriva-sin-desplegar`. ⇒ **20/20 verdes.** El cierre pasa a cerrar los
   issues del **pulso rojo** cada vez que no hay deriva: el episodio de
   producción caída se cierra solo con el comentario «Producción ya corre todo
   el código de master», que es la clase exacta de OP-32C2-C1 —declarar una
   recuperación que nadie midió— entrando por la otra puerta.

**Lo que el arreglo SÍ cerró:** revertir `format('{0}', …) == '0'` a
`steps.deriva.outputs.hay == '0'` en `:226` **muere** (1 roja de 20), y el
`evaluarIf` modela la coerción de GitHub con su propia prueba de control
(`:328`). Es un arnés bueno. Su límite es que sólo mira el `if:`.

**Consecuencia.** Quien mantenga el workflow puede mover una etiqueta con la
prueba en verde y convertir el aviso en ruido (48 issues/día) o en el
verde-mentiroso que `30e5e14` se escribió para terminar. Cuenta hoy: producción
lleva **9 días** sin `[deploy]` y 21 archivos de `src/`/`supabase/` sin
publicar; este detector es lo único que lo grita.

**Causa raíz probable (una línea):** el cableado se afirma buscando SUBCADENAS
dentro del bloque del paso, y la etiqueta aparece tres veces, así que basta con
que una sobreviva.

---

### [BAJO] `PRU32C3-B1` — NUEVO — el rótulo de la prueba del corte dice «ni un avance durable escrito» y su propio contador demuestra que hay uno

`src/lib/likida/intake/consolidado_orquestador.test.ts:199-211` ·
`src/lib/likida/intake/consolidado.ts:401` (el upsert a `cfdi_xml`) frente a
`:485` (el corte)

**Escenario, medido.** Añadí temporalmente `expect(xmlUpserts).toBe(0)` dentro
del caso «con el reloj agotado LANZA y no deja ni un avance durable escrito»:

```
AssertionError: MEDICION-AUDITOR: upserts a cfdi_xml antes del corte:
  expected 1 to be +0
```

El upsert a `cfdi_xml` (`:401`, con el texto completo del XML) corre **84 líneas
antes** del corte del reloj. El arnés ya lleva el contador `xmlUpserts` —lo usa
la prueba de la nota de crédito, `:181`— y este caso no lo afirma.

**Consecuencia.** Menor en efecto (el upsert es idempotente y la vuelta
siguiente lo repite), grave como precedente: el rótulo afirma una propiedad
—«cero escrituras durables»— más fuerte que la que la prueba comprueba —«cero
`update` a `gasto` y cero upsert de líneas»—, y es el rótulo el que la próxima
persona va a leer antes de mover el corte de sitio. Es la regla de `CLAUDE.md`
«un rótulo tiene que ser verdad» aplicada al nombre de una prueba.

**Causa raíz probable (una línea):** el nombre se escribió sobre la intención
del arreglo (`enLotes` es el primer avance durable) y no sobre lo que el caso
mide.

---

### [CRÍTICO] `PRU32C2-C1` — **REINCIDENTE (2.ª ronda)** — la función de dinero del panel fiscal se rompe en cuatro sitios con los 21 arneses SQL y los 243 bloques en verde

`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:78`, `:126`, `:132`,
`:224` · `supabase/tests/0359_panel_fiscal_dedup_emisor.sql:74-94`

**No lo re-muté hoy** (Postgres efímero, y el presupuesto de la ronda se fue en
las 36 mutaciones TS/YAML de arriba). Lo verifiqué **estáticamente y es
idéntico**: `git log -1 --` sobre `0358`/`0359` y sus arneses devuelve
`5c1734e`, el mismo commit del 18-sep sobre el que corrí las cuatro mutaciones.
Ni la función ni su prueba cambiaron una línea, así que las cuatro mutaciones
(`>` → `>=` en el tope de efectivo; `<=` → `<` en el borde del periodo; el signo
del ajuste de enero en `otro_ejercicio`; `sum(sub_total)` → `sum(monto)`)
siguen pasando con `243 bloques · 239 ok · 0 fallos`. **Abierto.**

### [ALTO] `PRU32C2-A1` — **REINCIDENTE (2.ª ronda)** — el arreglo del reloj del cron sólo observa uno de los dos pasos del prólogo

`src/app/api/cron/asistencia/route.ts:42` · `route.test.ts:31-36` (el mock de
`puertaCron`, que resuelve en 0 ms siempre)

**Remutado hoy.** Mover `const entrada = Date.now()` detrás de `puertaCron`
**solamente** ⇒ `npx vitest run src/app/api/cron/asistencia/route.test.ts` →
**1 archivo · 10 pruebas · 0 fallos.** (La hermana, detrás también de
`leerInterruptor`, sigue muriendo.) Sin cambio respecto a ayer: 9.5 s por encima
del `maxDuration = 120,000`, y el nivel 4 sale del barrido para siempre.

### [ALTO] `PRU32C2-A2` — **REINCIDENTE (2.ª ronda)** — 3 de los 16 arneses `.sql` huérfanos están ROJOS; uno sólo pasa según la hora del día

`supabase/tests/0319_capacidad_jornada_wa.sql:133` ·
`0327_jornada_r2_regresiones.sql:83` · `0336_capacidad_r5_red.sql:88` y `:7-14`

Verificado estáticamente hoy: los tres **siguen sin aparecer** en
`.github/workflows/ci-postgres.yml` (comprobado nombre por nombre). Nada los
corre, así que nada los pudo arreglar. **Abierto.**

### [ALTO] `PRU32C2-A3` — **REINCIDENTE (2.ª ronda)** — el ejercicio fiscal del motor del 15 % puede perder un mes entero con todo en verde

`supabase/migrations/0358_dedup_emisor_conocido.sql:69`, `:90`, `:64`

Mismo argumento estático que `PRU32C2-C1`: `0358` y sus dos arneses no se han
tocado desde `5c1734e`. **Abierto.**

### [CRÍTICO] `PRU-C1` — **REINCIDENTE, 6.ª ronda** — la cifra de dinero que la pantalla imprime sigue en 0; con las de hoy van **0 de 24**

`vitest.config.ts:104` (`'src/app/**/*.tsx'` en `coverage.exclude`, releído hoy)
· `src/app/dashboard/rentabilidad/vista.tsx:173-174` ·
`src/app/dashboard/combustible-casetas/vista-consolidado.tsx:43`

**Remutado hoy, las dos a la vez.** Intercambiar `{mxn(f.pagado)}` con
`{mxn(f.saldo)}` —sobre una factura de total $116,000 / pagado $40,000 / saldo
$76,000 la pantalla dice «Pagado **$76,000** · Saldo **$40,000**»— y poner
`{mxn(0)}` en el monto de cada línea del consolidado ⇒ `npx vitest run
src/app/dashboard/` → **95 archivos · 616 pruebas · 0 fallos** (eran 94/613 ayer;
el hueco no se movió, sólo creció el denominador).

**Lo que cambia hoy: el conteo y la clase.** Eran 18 mutaciones acumuladas sin
un rojo. Suman las **seis de esta ronda que caen sobre una cifra**
(`monto: 0` y `litros: null` en la escritura de la línea; las cuatro de dinero
de `viajeCoincide`). **0 de 24.** Y la clase se ensancha por tercera vez: ya no
es «la capa `.tsx` está fuera del denominador» ni «tampoco la capa SQL» — es que
la cifra no tiene arnés **en ninguna de las tres capas donde vive**: donde se
escribe, donde se calcula en SQL y donde se imprime.

### [ALTO] `PRU-31C-A2` — **REINCIDENTE (3.ª ronda)** — el margen del cron se sigue anclando contra sí mismo

`src/app/api/cron/asistencia/route.ts:88` · `route.test.ts:156` ·
`src/lib/likida/asistencia_escalamiento.ts:310`

**Remutado hoy.** Novena consulta `acotada(supabaseAdmin().from('viaje')…)`
insertada justo antes de `reclamarEscalacionAsistencia` ⇒ `npx vitest run
src/app/api/cron/asistencia/ src/lib/likida/asistencia_escalamiento.test.ts` →
**2 archivos · 33 pruebas · 0 fallos.**

### [ALTO] `PRU-31C-A3` — **REINCIDENTE (3.ª ronda)** — la propiedad de seguridad de `8c0e7df` la sigue sosteniendo un `grep` del fuente

`scripts/ci/deriva-sin-desplegar.mjs:29` · `scripts/ci/deriva_sin_desplegar.test.ts:88-94`

**Remutado hoy.** `execFileSync('git', args, …)` →
`execFileSync('sh', ['-c', \`git ${args.join(' ')}\`], …)` ⇒ **1 archivo · 20
pruebas · 0 fallos.** El fuente sigue conteniendo `execFileSync` y sigue sin
contener `` execSync(` ``, que son las dos cosas que la prueba mira. `2c38766`
subió el archivo de 17 a 20 pruebas y **ninguna de las tres nuevas ejecuta
`correrGit`**: sigue siendo el valor por defecto del tercer parámetro y ninguna
prueba de la suite lo llama.

### [MEDIO] `PRU-31C-M1` — **REINCIDENTE, medio cerrado** — el cableado del detector: la mitad que faltaba sigue faltando

`.github/workflows/salud-produccion.yml:180`

| Mutación | Ayer | Hoy |
|---|---|---|
| `:180` argumentos invertidos → `deriva-sin-desplegar.mjs origin/master "$version"` | VERDE 17/17 | **VERDE 20/20** |
| `:174` el paso del detector con `if: false` | VERDE 17/17 | **ROJO 1/20** ✔ cerrado |

La que sigue viva es la peor de las dos: con producción atrás de master, el
rango `origin/master..$version` está **vacío**, así que el detector imprime «no
hay deriva» en cada pulso y el paso de cierre —que ahora sí exige una medición—
cierra el issue con toda propiedad sobre una medición invertida.

### [MEDIO] `PRU-31C-M2` — **REINCIDENTE (3.ª ronda)** — la frontera de etiqueta no distingue cuál `<span>` imprimió la cifra

`src/app/dashboard/agentes/peajes/controles.tsx:86` y `:88`

**Remutado hoy.** Intercambiar `{r.revisadas}` y `{r.conciliadas}`: sobre
`{revisadas: 3, conciliadas: 1}` la pantalla dice «Revisé **1** línea pendiente;
amarré **3** contra gastos nuevos». ⇒ `npx vitest run
src/app/dashboard/agentes/peajes/` → **4 archivos · 11 pruebas · 0 fallos**
(eran 3/8; el archivo nuevo de `e47f974` subió el denominador y no tocó esto).

### [MEDIO] `PRU-31C-M3` — **REINCIDENTE (3.ª ronda)** — la guardia de `acotada()` sigue siendo un `grep` de `await supabaseAdmin()`

`src/lib/likida/asistencia_escalamiento.ts:326-327`

**Remutado hoy.** Hoistear la consulta de `viaje` a una variable
(`const cons = supabaseAdmin()…; const { data: v } = await cons;`) la deja sin
techo. ⇒ **2 archivos · 33 pruebas · 0 fallos.**

### [MEDIO] `PRU-31-M5` — **REINCIDENTE (5.ª ronda), recontado hoy** — **29 de 56** arneses de `supabase/tests/` no los invoca nadie

`.github/workflows/ci-postgres.yml` · `supabase/tests/`

Recuento de hoy, comando a comando: **56 archivos** (38 `.sql` + 18 `.sh`),
**27 nombres distintos** aparecen en `ci-postgres.yml`. Huérfanos: **29**. El
numerador y el denominador no se movieron desde ayer.

---

## Lo que revisé y está bien

- **`e47f974` cumple lo que su encabezado promete.** Las dos mutaciones que el
  propio commit declara medidas (quitar el objeto → 2 rojas; `{ venceEn: 0 }` →
  1 roja) mueren hoy tal cual. El corte por expresión equilibrada
  (`llamada()`, `reloj-cableado.test.ts:35-47`) no se satisface con un
  comentario que diga `venceEn` ni con la línea movida a otra llamada, que es
  la trampa clásica del `toContain` sobre el archivo entero.
- **`fc811a0` es el primer arreglo de esta rutina cuyo CABLEADO tiene arnés
  propio, y funciona.** `ciclo_flota.test.ts:625-640` afirma
  `guardarYConciliarConsolidado.mock.calls[0][3] === VENCE_EN`; quitar el
  `venceEn` del despacho en `ciclo.ts:341` mata esa prueba, y quitarlo un piso
  más abajo (`consolidado.ts:485`) mata la del orquestador. Verifiqué además
  que la cadena llega **hasta la ruta real**: `descarga-sat/route.ts:106-118`
  calcula `venceEn` y lo pasa a `correrDescargaSat`, que lo pasa a
  `correrFlota` (`ciclo.ts:879`). No hay un tramo desnudo.
- **El corte de `traerTodoDesdeId` LANZA y está probado que lanza.** Cambiar el
  `throw` por `return filas` (devolver la lectura parcial) mata 3 pruebas entre
  `pg.test.ts` y el orquestador. Es la propiedad que más importa —media lista de
  candidatos concilia de menos en silencio— y sí está anclada.
- **La prueba de coerción de GitHub de `2c38766` es de las buenas.** No es un
  `grep`: reimplementa las reglas de `==`/`!=` de Actions y las verifica contra
  sí misma (`deriva_sin_desplegar.test.ts:328-334`, que es el control que evita
  que el evaluador se vuelva decorativo). Revertir el `format('{0}', …)` mata
  una prueba. Y el invariante «el cierre repite las guardas del medidor»
  (`:311-318`) cerró de rebote media `PRU-31C-M1`.
- **El intermitente de `cron/asistencia/route.test.ts` sigue cerrado.**
  **0 rojas de 20** corridas aisladas hoy, más dos corridas completas de la
  suite (989 archivos en paralelo). No hay regresión.
- **La suite completa está verde y crece.** Baseline al arrancar: **989
  archivos · 12,990 pruebas · 6 saltadas · 0 fallos** (167 s). Al cerrar la
  medición larga: **12,997** (otros agentes escribiendo en el mismo árbol).
- **`monto()` de la API sí muerde donde vale.** Cambiar «rechazar más de dos
  decimales» por «redondear en silencio» (`_escritura.ts:299`) mata 1 de 207.
  El descuadre de centavos que el comentario describe está anclado.
- **`ci.yml` y `ci-postgres.yml` corren en cada push de cualquier rama**
  (`branches: ['**']`), releído hoy. Ninguna rama se escapa de la compuerta.

---

## Lo que descarté y por qué

- **`reloj-cableado.test.ts:67` (`toMatch(/cortadosPorReloj/)` sobre el archivo
  entero) parecía decoración y no lo es.** Es cierto que un comentario la
  satisface, pero la propiedad que vigila está anclada en otro sitio: fijar
  `estado: 'ok'` en `page.tsx:243` mata 1 de 11. No lo reporto.
- **`montoIgual(fila.anio, pedido.anio)` de `unidadCoincide`** sobrevive igual
  que las otras 12, pero el año de una unidad no es dinero: va dentro de
  `PRU32C3-C2` como conteo, no como consecuencia propia.
- **La mutación `min(...) over (…)` → `max(…)` en `0358_…:80`** la descarté ya
  en la ronda pasada (no mueve dinero); no la repito.
- **Los hallazgos del espejo TS↔SQL de `copiasDeComprobante`** que otro agente
  está escribiendo en `src/lib/likida/cuadre/dedup_emisor_espejo.test.ts`
  mientras yo medía: es rubro fiscal/arquitectura, no mío, y su arnés todavía
  no estaba commiteado. No lo audité ni lo toqué.

---

## Lo que NO alcancé a revisar

- **Postgres, esta ronda no.** `PRU32C2-C1`, `A2` y `A3` van verificados
  **estáticamente** (los archivos no cambiaron desde el commit sobre el que los
  medí ayer), no remutados. Es más débil que ayer y lo digo: si alguien tocara
  esas migraciones sin que el `git log` lo refleje, mi afirmación no lo vería.
- **Los 13 arneses `.sh` huérfanos** (concurrencia, dos sesiones): contados, no
  corridos. Tercera ronda.
- **`pg_prove` / Capa 0 (pgTAP)**: la extensión `postgresql-16-pgtap` no está en
  la imagen y no hay red. Undécima ronda fuera.
- **Playwright / `e2e-navegador.yml`**: sin navegador, fuera otra vez.
- **No corrí `--coverage`.** Lo que afirmo del denominador sale de leer
  `vitest.config.ts:60` y `:104`.
- **Las 36 mutaciones no son la suite.** Fueron dirigidas: los cinco archivos de
  prueba nuevos, sus vecindades, los nueve reincidentes y la zona de escritura
  de dinero que llevaba ocho rondas anotada sin medir. Quedan sin atacar
  `intake/ocr`, `carta_porte_xml`, el timbrado, los agentes, `processor.ts` y
  casi todo `src/app/api/` fuera de `v1/` y `cron/asistencia/`.
- **`api/v1/liquidaciones` y `api/v1/clientes`** entraron sólo por el barrido de
  `src/app/api/v1/` (207 pruebas); no les hice mutaciones propias.

---

## Cómo medí

- **36 mutaciones**, una por corrida, **10 mueren (27.8 %)**, 26 sobreviven.
  (Ayer: 26 mutaciones, 9 mueren, 34.6 % — pero ayer 17 de las 26 eran SQL y
  hoy ninguna lo es, así que los dos porcentajes no son comparables; lo que sí
  se compara son los 9 reincidentes, remutados uno por uno, de los que **8
  siguen verdes** y 1 (media `PRU-31C-M1`) se puso roja.)
- **Línea base:** `npx vitest run` → **989 archivos · 12,990 pruebas · 6
  saltadas · 0 fallos** al arrancar (167 s); **12,997** al cerrar, porque otros
  agentes estaban escribiendo pruebas en el mismo árbol.
- **Tres corridas de suite COMPLETA con mutación puesta** (las dos de
  `cfdi_consolidado_linea` y la del anticipo), para que la afirmación
  «sobrevive» no dependa de haber corrido sólo la carpeta.
- **20 corridas aisladas** de `cron/asistencia/route.test.ts` para el
  intermitente.
- **Cada mutación se revirtió en la MISMA llamada de bash que la aplicó.** Para
  los archivos que otros agentes estaban tocando en paralelo (`pg.ts`,
  `salud-produccion.yml`, `_escritura.ts`, `asistencia_escalamiento.ts`,
  `page.tsx`, `controles.tsx`, `deriva-sin-desplegar.mjs`,
  `consolidado_orquestador.test.ts`) **no usé `git checkout --`**: copié el
  archivo vivo al scratchpad antes de mutar y lo restauré desde esa copia, para
  no borrarles trabajo en vuelo. Verificado con `git diff --stat` por archivo
  tras cada tanda.
- **NO corrí** `pruebas-manuales/*.prueba.ts` ni `npm run build`.

---

## Estado del árbol al entregar

`git status --short` al cerrar:

```
 M .github/workflows/auto-merge-rutina.yml
?? scripts/ci/auto_merge_rutina.test.ts
```

**Nada de eso es mío.** Es otro agente de esta misma ronda. Durante la medición
pasaron por el árbol, también ajenos, `src/lib/likida/pg.ts` + `pg.test.ts`
(un bloque `REN-32C3-C1` sobre `traerTodo`), `src/lib/likida/sat_descarga/ciclo.ts`
+ `ciclo_flota.test.ts`, y `src/lib/likida/cuadre/engine.ts` +
`dedup_emisor_espejo.test.ts`; ya están commiteados. Lo dejé todo intacto.

**Mis archivos están los ocho restaurados**, verificado uno por uno con
`git diff --stat <archivo>` vacío tras cada tanda:
`src/lib/likida/intake/consolidado.ts`, `.../consolidado_orquestador.test.ts`,
`src/app/api/v1/_escritura.ts`, `src/app/dashboard/agentes/peajes/page.tsx`,
`.../controles.tsx`, `src/app/dashboard/rentabilidad/vista.tsx`,
`src/app/dashboard/combustible-casetas/vista-consolidado.tsx`,
`src/app/api/cron/asistencia/route.ts`,
`src/lib/likida/asistencia_escalamiento.ts`,
`.github/workflows/salud-produccion.yml`,
`scripts/ci/deriva-sin-desplegar.mjs` y `src/lib/likida/pg.ts`.

Una mutación mía (`consolidado.ts:523`, `monto: r.linea.monto` → `monto: 0`)
vivió ~2.5 min dentro de una corrida de suite completa y el orquestador de la
ronda la vio en ese intervalo. Era deliberada, el `git checkout --` iba en la
misma llamada de bash que la aplicó, y su resultado es el hallazgo
`PRU32C3-C1`. Está restaurada.

Ninguna de mis mediciones corrió con **dos** mutaciones mías puestas a la vez.
La única excepción declarada es `PRU-C1`, que por definición es una sola
mutación en dos archivos de pantalla (el hallazgo así está escrito desde la
ronda 28).

Mi único archivo escrito es **`docs/auditoria-32/pruebas-continuacion-3.md`**,
que no aparece en `git status` porque `.gitignore:36` ignora `docs/auditoria-*/`
(se commitea con `git add -f`).
