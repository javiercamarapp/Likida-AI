# Arquitectura y mantenibilidad — auditoría 32, continuación 3 (19-sep-2026)

**Nota: 3/10** (antes 4). Razón del movimiento: **deuda que cobró factura**.

No es «mirada más profunda» ni «se atacó y subió»: es la tercera razón, y por
primera vez tiene factura con fecha y monto. Entre el 16 y el 17-sep, tres
migraciones (`0357`, `0358`, `0359`) fueron a cerrar **una** de las copias del
predicado «mismo comprobante». El resultado, medido hoy contra un Postgres 16 con
las **336** migraciones aplicadas:

- el predicado pasó de **una semántica** repartida en 6 sitios a **tres
  semánticas** en los mismos 6 sitios;
- se abrieron **dos divergencias de dinero nuevas** que antes del 16-sep no
  existían — una entre TypeScript y SQL (`desde_db.ts:184-192`), otra entre el
  panel del contador y el PDF —, las dos con cifras reproducidas;
- el arreglo de **ARQ-C2** (cerrado en la 31) quedó aritméticamente **reabierto**
  sin que nadie tocara `desde_db.ts`: lo reabrió una migración.

Eso es exactamente lo que el rubro lleva once rondas diciendo que iba a pasar, y
la regla del rubro es explícita: *una advertencia de la ronda anterior que volvió
a ocurrir no es una advertencia, es un hallazgo*. El ancla dice «4 o menos si la
misma lógica de dinero vive en más de un archivo»; el 4 describía el **riesgo**,
y hoy el riesgo se cobró. Por eso 3 y no 4.

**El riesgo mayor del rubro, hoy:** el predicado «estos dos papeles son el mismo
comprobante» no tiene dueño — vive en 6 sitios, en 2 lenguajes, con 3 reglas
distintas, y ya no se puede mover uno sin romper otro. Se intentó tres veces en
cuatro días y las tres dejaron una cifra mala en algún lado.

> **Método.** Rama `claude/auditoria-32`, HEAD `656bc68`. `npx tsc --noEmit -p .`
> → **exit 0**. `npx vitest run` de los siete guardias del predicado
> (`fiscal_agregado_15pct`, `repo_acumulado`, `desde_db_efectivo_previo`,
> `etiquetas_sincronizadas`, `migraciones_verificadas`, `duplicados`,
> `copias_un_origen`) → **7 archivos / 52 pruebas verdes**. Postgres 16.13
> efímero con las **336 migraciones limpias** sobre base virgen (receta de
> `ci-postgres.yml:143-169`); los scripts viven en `/tmp/pgarq32c3/`. No edité
> ningún archivo del repo fuera de este documento.
>
> **Observación del árbol, no es hallazgo:** el árbol NO estuvo limpio durante mi
> corrida. A las 11:14 UTC `src/lib/likida/intake/consolidado.ts` estaba
> modificado y sin commitear (`:523` `monto: r.linea.monto` → `monto: 0`); dos
> minutos después ese archivo había vuelto a su sitio y los modificados eran
> `pg.ts`, `pg.test.ts`, `sat_descarga/ciclo.ts` y `ciclo_flota.test.ts`. Son
> pruebas de mutación de otro agente de esta misma ronda corriendo en paralelo
> (el rubro de rendimiento revisa `fc811a0`, que tocó exactamente esos
> archivos). No toqué ni revertí ninguno. Queda dicho por dos razones: un
> `git add -A` distraído publicaría `monto: 0` sobre
> `cfdi_consolidado_linea.monto`, y mi `tsc` corrió sobre un árbol mutado —
> salió exit 0 igual.

---

## Cuántas copias de «el mismo comprobante» hay después de 0357/0358/0359

**Seis implementaciones, tres semánticas.** Antes del 16-sep eran seis
implementaciones y **dos** semánticas. El censo, leído archivo por archivo:

| # | Dónde | Universo | ¿Mira `rfc_emisor`? | Normalización del concepto |
|---|---|---|---|---|
| 1 | `src/lib/likida/cuadre/engine.ts:514-563` (`copiasDeComprobante`, TS) | UN viaje | **no** | `strip_accents(lower())` |
| 2 | `supabase/migrations/0358_dedup_emisor_conocido.sql:85-106` (`sumar_combustible_ejercicio`; la partición del folio en `:96-103`) | EJERCICIO del tenant | **sí, cuando se conoce** (0357+0358) | `unaccent(lower())` |
| 3 | `supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:151-171` (`gastos_fiscales_agregados_tenant`; la partición del folio en `:161-168`) | la VENTANA del selector de periodo | **sí, cuando se conoce** (0359) | `unaccent(lower())` |
| 4 | `supabase/migrations/0354_cierre_insumos_hash_v2.sql:238-252` (`registrar_liquidacion_atomica`, heredado de `0321:287-301`) | UN viaje | **no** | `translate(lower(), 'áéíóúüñ','aeiouun')` |
| 5 | `supabase/migrations/0353_revisar_liquidacion_arco_cuerpos_completos.sql:126-137` **y** `:142-155` (dos escrituras a mano dentro de la misma función) | UN viaje | **no** | **ninguna** — `v_gasto.concepto = original.concepto`, crudo |
| 6 | `supabase/migrations/0354_cierre_insumos_hash_v2.sql:71-108` (la CTE `combustible` de `cierre_insumos_hash`) | EJERCICIO del tenant | **no dedupa en absoluto** (ARQ-A2, abierto) | — |

Las tres semánticas vivas: **(A)** emisor-ciego (1, 4, 5), **(B)** emisor cuando
se conoce (2, 3), **(C)** sin dedup (6).

Dos lecturas que importan para el rubro:

1. **TypeScript tiene UNA sola definición y trece consumidores de producción**
   (`repo.ts`, `analytics.ts`, `tools.ts`, `processor.ts`, `acuse_ticket.ts`,
   `consulta_chofer.ts`, `liquidacion/pdf.ts`, `liquidacion/omitidos.ts`,
   `intake/emparejar.ts`, `cuadre/fecha_dudosa.ts`, `cuadre/desde_db.ts`,
   `app/api/export/poliza/route.ts`, `laboral/…`). Esa mitad está sana: nadie
   reimplementa el predicado en TS. **El problema no es TS contra TS, es TS
   contra SQL**, y esa frontera no tiene guardia.
2. **`rfc_emisor` sí está disponible en TypeScript**: `repo.ts:992` lo
   selecciona y `repo.ts:1012` lo mapea a `Gasto.rfcEmisor`. La refutación
   cómoda —«el TS no podía mirar el emisor»— no se sostiene: podía, y la
   cabecera de la 0357 (`:47`) decidió expresamente no tocarlo.

---

## Hallazgos

### [CRÍTICO · REINCIDENTE, 2ª aparición] ARQ32C3-C1 — la 0357/0358 movió un lado del espejo TS↔SQL y el contador del ejercicio previo se quedó con dinero que ese viaje sí gastó

`src/lib/likida/cuadre/desde_db.ts:184-185` (el contrato escrito: «el espejo
**exacto** del de la 0349») · `:187-192` (la resta) ·
`src/lib/likida/cuadre/engine.ts:555-561` (la llave TS: `:557` es el `const key`, sin emisor) ·
`supabase/migrations/0358_dedup_emisor_conocido.sql:96-103` (la llave SQL, con
emisor) · `engine.ts:812-819` (dónde se amplifica).

`desde_db.ts:192` calcula
`efectivoPrevEjercicio = max(0, RPC.efectivo − efectivoDeEsteViaje)`. El
minuendo lo produce SQL (semántica **B**); el sustraendo lo produce TS
(semántica **A**). Una resta entre dos universos que ya no cuentan igual.

**Escenario, con valores, medido contra la base viva.** Ejercicio 2026 de una
flota. En el viaje que se liquida hay **dos tickets de diésel en efectivo de
$2,500**, los dos con **folio `1234`**, de **dos gasolineras distintas**
(`ESA030303CCC` y `ESB040404DDD`) — que es literalmente el caso de manual que la
0357 fue a arreglar. Otras liquidaciones del año llevan $13,000 de diésel en
efectivo y $82,000 por transferencia.

```
=== sumar_combustible_ejercicio (0358) — lo que lee desde_db.ts:132
   total   | efectivo
-----------+----------
 100000.00 | 18000.00          ← cuenta los dos tickets: 13,000 + 5,000

=== el dedup POR VIAJE (0354:238-252, el espejo SQL de copiasDeComprobante)
 total_comprobado_del_viaje | marcados_copia
----------------------------+----------------
                    2500.00 |              1  ← cuenta UNO
```

Con eso, la aritmética del motor (`engine.ts:812-819`):

| | Lo que sale hoy | Lo correcto según la propia 0358 |
|---|---|---|
| `totalCombustibleEjercicio` | $100,000 | $100,000 |
| `tope = 0.15 × total` | $15,000 | $15,000 |
| `efectivoDeEsteViaje` (TS, `:188`) | **$2,500** | $5,000 |
| `efectivoPrevEjercicio` (`:192`) | **$15,500** | $13,000 |
| `cupoRestante = max(0, tope − previo)` | **$0** | **$2,000** |
| `dentro` / `excedenteDeEste` | $0 / $2,500 | $2,000 / $500 |
| Lo que imprime el PDF | `efectivo_sobre_15`: «el excedente de $2,500.00 NO se deduce» | «deducible por la facilidad del 15%» hasta $2,000 |

**Entran dos tickets reales de $2,500 de dos gasolineras → sale un PDF que le
niega a la flota $2,000 de deducción que la RFA 2026 2.9 sí le concede** (ISR
30 % ≈ **$600** de impuesto de más), y encima marca uno de los dos tickets como
«Comprobante duplicado … aparece 2 veces (una excluida del total)»
(`engine.ts:1245`), así que el operador tampoco cobra su reembolso de $2,500.

**Antes del 16-sep esto no pasaba:** con la 0349 los dos lados colapsaban igual,
la resta cuadraba y el previo salía $13,000. Lo rompió el arreglo.

**Consecuencia.** El contralor recibe un PDF que acusa de exceso fiscal a una
flota que está dentro del tope, y la cifra «previo del ejercicio» no se puede
reconstruir desde ninguna pantalla porque es una resta entre dos criterios
distintos. Para el equipo: la frase que sostiene el cálculo
(`desde_db.ts:184-185`, «el espejo exacto del de la 0349») es hoy falsa, y es el
único sitio donde el acoplamiento está declarado.

**Intento de refutación — busqué el guardarraíl y no existe.**
(a) `fiscal_agregado_15pct.test.ts` es el guardia TS↔SQL de este cubo y **deriva
bien la migración viva** (`rutaVigente()` → 0358), pero solo compara la **lista
de formas de pago**: no mira el `partition by`. Verde hoy.
(b) `duplicados.test.ts`, `copias_un_origen.test.ts` y
`desde_db_efectivo_previo.test.ts` → `grep -c rfcEmisor` = **0, 0, 0**. Nada en
TS fija el comportamiento emisor-ciego ni lo contrasta con SQL.
(c) Las 52 pruebas de los siete guardias pasan verdes con el espejo roto:
lo corrí hoy.
(d) *¿Es inverosímil el caso?* Es la premisa con la que la 0357 se justificó a
sí misma (`0357:8-20`): no se puede invocar como realista para abrir el CRÍTICO
y como inverosímil para cerrarlo.

**Causa raíz probable:** el par RPC↔TS está acoplado por un comentario en vez de
por un parámetro (el patrón correcto ya existe a tres líneas: `p_claves` se le
**pasa** a la RPC desde `repo.ts:1502` en vez de teclearse dos veces).

*(REINCIDENTE: propuesto el 17-sep por el rubro de modelo de datos como
**DAT32C-A1**, «propuesto y no arreglado», con el argumento de que arreglarlo
exigía tocar `copiasDeComprobante`. Sigue idéntico. 2ª aparición.)*

---

### [CRÍTICO · NUEVO] ARQ32C3-C2 — la 0359 puso de acuerdo al panel con el motor y lo puso en desacuerdo con el PDF: los mismos dos tickets valen $5,000 en pantalla y $2,500 en el papel

`supabase/migrations/0359_panel_fiscal_dedup_emisor.sql:161-168` (la partición
con emisor) · `src/lib/likida/cuadre/engine.ts:555-561` (la del PDF, sin emisor)
· `engine.ts:674-681` (`totalComprobado` excluye las copias) · `engine.ts:1245`
(el renglón «Comprobante duplicado») · `src/lib/likida/liquidacion/pdf.ts` (el
consumidor).

**Escenario, con valores, medido contra la base viva.** Los mismos dos tickets:
folio `1234`, $2,500 cada uno, IVA $344.83 cada uno, dos gasolineras distintas,
**en el mismo viaje**.

```
=== gastos_fiscales_agregados_tenant (0359) — la celda de /dashboard/fiscal
 concepto |     rfc      | n |  monto  |  iva
----------+--------------+---+---------+--------
 diesel   | ESA030303CCC | 1 | 2500.00 | 344.83
 diesel   | ESB040404DDD | 1 | 2500.00 | 344.83
                            → 2 comprobantes · $5,000.00 · $689.66 de IVA
```

El PDF del **mismo viaje**, con el mismo par de filas, imprime
`totalComprobado = $2,500.00` y el renglón «Comprobante duplicado: Combustible
folio 1234 por $2,500.00 aparece 2 veces (una excluida del total)».

**Entra el mismo par de tickets → el panel del contador dice 2 comprobantes y
$5,000, el PDF archivado dice 1 y $2,500.** Diferencia: **$2,500 de gasto y
$344.83 de IVA acreditable**.

**Y esto es nuevo de anteayer.** Antes de la 0359 el panel usaba la partición de
la 0355 (emisor-ciega) y decía **$2,500 / n=1**, igual que el PDF: las dos
pantallas coincidían. La 0359 se escribió para que el panel coincidiera con
`sumar_combustible_ejercicio` (DAT32C-C2) y lo logró — al precio de romper la
coincidencia con el PDF, que nadie midió porque el PDF no es SQL.

**Consecuencia.** Es textualmente lo que `CLAUDE.md` prohíbe: «una cifra fiscal
que se lee distinto en dos pantallas se lee como dos cálculos». El contralor
cruza `/dashboard/fiscal` contra el fajo de PDF que le mandó a su contador —es
el gesto que define al comprador— y le faltan $2,500. En un demo, es la pregunta
que no tiene respuesta.

**Intento de refutación.** (a) *¿No es ARQ-A6?* No. ARQ-A6 es que la **misma**
pantalla cambia de cifra según la ventana del selector. Esto es panel contra
PDF con la ventana fija, y su causa es la columna `rfc_emisor` en la partición,
que ARQ-A6 no menciona. (b) *¿No lo cubre `verificaciones.sql` bloque 267?* No
— ver el hallazgo siguiente: lo corrí y sale verde. (c) *¿No es DAT32C2-A1?*
No: aquel es el caso con el **RFC perdido por el OCR**, donde panel y motor
coinciden en una cifra baja; éste es el caso con los **dos RFC leídos**, donde
panel y PDF divergen.

**Causa raíz probable:** la 0359 se validó contra la otra función SQL
(`supabase/tests/0359_…:panel == motor`) y no contra el único consumidor que el
cliente ve impreso, porque el consumidor impreso vive en TypeScript y no hay
ningún guardia que cruce esa frontera.

---

### [MEDIO · NUEVO] ARQ32C3-M1 — tres rótulos declaran un espejo que ya no existe, y el guardia de base que lo «comprueba» pasa verde porque nunca siembra un emisor

`supabase/verificaciones.sql:18088-18096` (el encabezado del bloque 267; la afirmación en `:18092-18093`:
«Mismo criterio que copiasDeComprobante (engine.ts) y
sumar_combustible_ejercicio (0349)») · `:18111-18114` (las filas que siembra,
**sin `rfc_emisor`**) · `supabase/migrations/0359_…:134-137` (el mismo texto,
justo encima de la partición que sí mira el emisor) ·
`src/lib/likida/cuadre/desde_db.ts:184-185` («el espejo exacto»).

**Escenario, con valores, ejecutado hoy.** Corrí el bloque 267 completo contra
la base con las 336 migraciones:

```
ERROR:  FISCAL_SIN_COPIAS_0355 n=t monto=t iva=t distingue-distinto=t   (esperado t / t / t / t)
```

**Verde en las cuatro direcciones**, mientras las dos funciones que dice
comparar difieren en $2,500 sobre el caso de arriba. El bloque siembra dos
`caseta` de $348 **sin `rfc_emisor`** (`:18111-18114`), que es el único caso
—«emisor nulo en ambos», la dirección 3 de la 0358— en el que las tres
semánticas siguen de acuerdo. El guardia no puede fallar por construcción.

**Consecuencia.** Para el equipo que mantiene esto: hay tres sitios donde un
mantenedor lee, en prosa, que las implementaciones coinciden, y uno de ellos es
un `do $$` en la base que imprime `t` para respaldarlo. Es la peor combinación
—guardia verde + rótulo falso— porque garantiza que la próxima persona que toque
el predicado repita el ciclo de los últimos cuatro días. `CLAUDE.md` pide que un
rótulo sea verdad; estos tres dejaron de serlo el 16-sep y nadie los movió.

**Causa raíz probable:** el bloque 267 fija el **resultado** (n=1, monto, iva)
en vez de la **llave**, así que agregar una columna a la partición no lo despeina.

---

### [CRÍTICO · REINCIDENTE, 12ª aparición desde la ronda 24] ARQ-C1 — un ajuste firmado sigue tirando el export contable del PERIODO COMPLETO

`src/app/api/export/poliza/route.ts:363` (el `for (const f of filas)`) · `:365-367`
(`bloqueos.push` + `continue`) · `:395-404` (el 409 `polizas_incompletas`) ·
`:116-131` (`ajustesIncompatibles`).

**Verificado hoy, abierto y leído.** La estructura es idéntica a la que la 28,
la 29, la 30, la 31 y la 32 describieron: la decisión se toma **por comprobante**
(`bloqueos.push`, `:366`) y el efecto se aplica **al periodo** (`:395`, un 409
que no devuelve ninguna póliza). El único cambio desde la 29 sigue siendo que
`ajustesIncompatibles` exime las copias (`:118`), que no toca la granularidad.

**Escenario, con valores** (sin cambios): marzo 2026, 40 liquidaciones firmadas;
el contralor ajusta un hospedaje de $1,480 a $5,480 con el botón que el demo
enseña. La 0306 mueve `gasto.monto` y conserva `sub_total = 1,275.86` /
`iva_traslado = 204.14`; `ajustesIncompatibles` calcula `totalFiscal = 1,480.00`,
ve `|5,480 − 1,480| = 4,000 > 0.01` y contesta **409**: «1 de 40 liquidaciones
no se pueden asentar». **Las 39 sanas tampoco salen.**

**Consecuencia.** El contralor no cierra el mes en su ERP por haber usado la
función insignia del producto. Doce rondas.

**Causa raíz probable:** no hay decisión de producto escrita sobre qué póliza le
corresponde a un comprobante cuyo `monto` firmado y cuyo desglose fiscal no
cuadran; a falta de ella, la decisión se toma por comprobante y se aplica al
periodo.

---

### [ALTO · REINCIDENTE, 2ª aparición] ARQ-A7 — «a qué ejercicio pertenece este viaje» sigue decidiéndose con dos reglas distintas, y el sello de cierre sigue vigilando el año equivocado

`src/lib/likida/cuadre/desde_db.ts:119-121` (`viaje.fechaInicio ?? gastos.find((g) => g.fecha)?.fecha`)
· `supabase/migrations/0354_cierre_insumos_hash_v2.sql:49-54`
(`coalesce(extract(year from v.fecha_inicio), (select … min(g.fecha)), …)`) ·
`src/lib/likida/repo.ts:999` (`.order('created_at')`, lo que decide «el primero»
en TS) · `0354:229-230` (el `raise CU006`).

**Verificado hoy:** las dos expresiones siguen byte por byte como las dejé el
16-sep; ninguno de los tres commits de la ronda tocó el ancla. El escenario con
cifras y la salida de `psql` están en `docs/auditoria-32/arquitectura.md`
(viaje de cambio de año sin `fecha_inicio`: el motor calcula contra el ejercicio
2027 y el sello fotografía el 2026; un cambio de $989,000 en el ejercicio que el
motor sí leyó deja el hash **idéntico** y el cierre pasa).

**Lo que esta ronda agrega:** el ancla del SQL (`min(fecha)`) y la del TS
(primer gasto por `created_at`) son ahora la **cuarta** y la **quinta** regla
que este archivo tiene que mantener sincronizadas a mano, encima de las tres del
dedup. La misma enfermedad, otro campo.

---

### Abiertos que reconfirmé sin escenario nuevo

| ID | Estado hoy | Evidencia de la reverificación |
|---|---|---|
| **ARQ-A3** (CRÍT) | **medio cerrado** — la mitad SQL la cerraron 0357+0358; **la mitad TS sigue abierta** y ahora es ARQ32C3-C1 | `engine.ts:557` sin `rfc_emisor`; `0358:101` con él |
| **ARQ-C2** (CRÍT) | **cerrado en la 31 y aritméticamente reabierto por la 0357/0358** — el `.filter` de `desde_db.ts:188-191` sigue ahí, pero ya no espeja a la RPC. Además **sigue sin publicar**: el último `[deploy]` es `cfa00ab` del 10-sep | `desde_db.ts:173-192` |
| **ARQ-A2** (ALTO) | abierto — la CTE `combustible` de `cierre_insumos_hash` **sigue sin `row_number`** | `0354:71-108` contra `0354:238-252` |
| **ARQ-A6** (ALTO) | abierto — el universo de dedup sigue siendo la ventana del selector | `0359:130-132` (`p_desde`/`p_hasta`) · `fiscal.ts:1745-1747` |
| **ARQ-A4** (ALTO) | abierto | `wa_pendientes.ts:26` · `conv.ts:1012` · los literales SQL de 0155/0187/0194/0324/0325 |
| **ARQ-M4** (MEDIO) | abierto — `0354:92` sigue sin guardia | la lista `'02','03','04','05','28','29'` sigue tecleada en 0190/0305/0321/0345/0349/0354, y ahora también en **`0358:124`** (la 0359 no la teclea: usa otro mecanismo) |
| **ARQ-M1** (MEDIO) | abierto, **sin empeorar**: **237** archivos de producción llaman `supabaseAdmin()`, **26** de ellos `page.tsx` — exactamente las mismas cifras que el 16-sep | medido hoy |
| **ARQ-M2** (MEDIO) | abierto — `purgar_evento_seguridad_flota(180, 365, …)` tecleado en **4** migraciones | `privacidad.ts:712,715` |
| **ARQ-M3** (MEDIO) | abierto | `cron/gps/route.ts:63` (`consultas: 11`) · `cron/descarga-sat/route.ts:106` (`consultas: 3`) |
| **ARQ-A5** (MEDIO) | abierto | `perfil/preguntas.ts:362,369-371` · `perfil/onboarding.ts:14,19-20` · `perfil/entrevista.ts:713` |
| **ARQ-B1** (BAJO) | abierto, y **ya divergió un poco**: los dos bloques de «busca el prospecto por correo normalizado y rechaza la ambigüedad» ya **no** son byte por byte iguales (`calcom.ts:474-477` selecciona 4 columnas y dice «Cal.com no-show reconciliation lookup»; `calcom_webhook.ts:232-236` selecciona `id` y dice «prospecto lookup») | diff ejecutado hoy |
| **ARQ-B2** (BAJO) | abierto — `processor.ts` = **4,990** líneas | `wc -l` |
| **ARQ-B3** (BAJO) | abierto — **21** `vi.mock('@/lib/auth/tenant-efectivo')`, **0** `satisfies TenantEfectivo` | medido hoy |

---

## Lo que revisé y está bien

- **El motor del dinero sigue siendo puro.** `grep -c "await \|async "` sobre
  `cuadre/engine.ts` → **0** en 1,893 líneas. Las dos fugas de esta ronda están
  en el traductor (`desde_db.ts`) y en SQL, no dentro del motor: la frontera
  aguanta, lo que no aguanta es el contrato entre los dos lados.
- **El ejemplo canónico del rubro sigue cerrado.** `engine.ts:1891` dice
  `otro: 'Otro'` con el comentario que explica por qué; `liquidacion/pdf.ts`
  **importa** `etiquetaConcepto`; `etiquetas_sincronizadas.test.ts` barre todo
  `src/` en vez de una lista de rutas. Fui a buscarlo específicamente y no
  recayó.
- **La mitad TypeScript del predicado es de verdad única.** Trece archivos de
  producción importan `copiasDeComprobante` y **ninguno** reimplementa la llave.
  El problema no es TS contra TS.
- **Las 336 migraciones aplican limpias sobre base virgen** con la receta de
  `ci-postgres.yml:143-169`, incluidas 0357/0358/0359. Ejecutado, no deducido.
- **`rfc_emisor` llega a TypeScript.** `repo.ts:992` lo selecciona y `:1012` lo
  mapea. Lo verifiqué porque era la mejor refutación posible de ARQ32C3-C1 y no
  se sostiene.
- **El detector de clones por contenido, corrido por primera vez desde la ronda
  29.** Ventanas de 14 líneas normalizadas sobre los 820 archivos de
  producción de `src/` (sin `.test.`): **14 pares de bloques idénticos en más de
  un archivo**. Ninguno es lógica de dinero. El reparto: 11 son andamio de UI
  (`dashboard/{facturacion,carta-porte,operadores,clientes,unidades}/forma.tsx`
  comparten 14 líneas de cabecera; `admin/sidebar-nav.tsx:27` ≡
  `dashboard/sidebar-nav.tsx:18`; los tres chats) y 3 son de backend
  (`agents/analista.ts:205` ≡ `agents/copiloto.ts:131`;
  `conectores/eventos_seguridad.ts:148` ≡ `conectores/posiciones.ts:116`). Los
  dos de backend los abrí uno por uno y **no han divergido** (ver la sección
  siguiente). Es la medición independiente que el rubro llevaba cuatro rondas
  debiendo, y su veredicto es que la duplicación de este repo está **concentrada
  en un solo concepto** —el comprobante— y no repartida.
- **`tsc --noEmit -p .` → exit 0**, con la mutación ajena en el árbol incluida.

---

## Lo que descarté y por qué

- **El esquema de `entregar_respuesta` duplicado entre
  `agents/analista.ts:200-242` y `agents/copiloto.ts:126-168`.** Son 42 líneas
  idénticas salvo el nombre de la tool (`entregar_respuesta` vs
  `entregar_respuesta_admin`) y el texto de error. **No lo reporto** porque no
  ha divergido y porque el tipo sí está compartido
  (`copiloto.ts:47`: `BloqueCopiloto = Bloque | BloqueAccion`, importado de
  `analista.ts:35-40`): el enum `['texto','cifra','tabla','dona','serie']` está
  escrito dos veces pero describe **un solo** tipo. No puedo escribir «entra X →
  sale Y mal» con valores, así que queda como medición, no como hallazgo.
- **La política de reintentos de Samsara duplicada** entre
  `conectores/eventos_seguridad.ts:148-200` y
  `conectores/posiciones.ts:116-168` (5xx, 429, backoff exponencial, techo de
  páginas, corte por presupuesto). Comparé las tres constantes de los dos
  archivos: `MAX_PAGINAS_DEFENSIVO = 1_000`, `MAX_REINTENTOS_429 = 3`,
  `MAX_REINTENTOS_5XX = 3` en ambos. **Idénticas hoy**, así que es deuda, no
  divergencia.
- **Las listas de roles.** `PREVISUALIZABLES = ['flota_admin','encargado','contador']`
  está tecleada dos veces (`app/dashboard/aviso-rol.tsx:13` y
  `lib/auth/visibilidad.ts:317`) y los conjuntos de `lib/auth/permisos.ts:17-35`
  no derivan de `RolAppUser` (`auth/provisionar.ts:21`). Las comparé una por una
  contra el dominio de `app_user.rol`: **ninguna diverge**, y todas excluyen
  `vendedor` donde deben. Deuda, no hallazgo.
- **Las claves de hidrocarburos.** `config.ts:122` contra el fallback tecleado
  en `0321:152` y `0354:105`: idénticas, mismo orden. La 0358 y la 0359 siguen
  recibiéndolas por parámetro (`p_claves`, `p_claves_combustible`) en vez de
  teclearlas, que es el patrón correcto. Volví a mirarlo porque era mi mejor
  candidato a copia nueva y no lo es.
- **Todo lo que ya cubre el rubro de modelo de datos sobre estas tres
  migraciones** (DAT32C2-A1 el emisor perdido por el OCR, DAT32C2-A2 el `nullif`
  del folio entre 0358 y 0359, DAT32C2-A3 las alertas que se van con la copia
  descartada, DAT32C-B1 `rfc_emisor` sin restricción). Son SQL↔SQL; lo mío es la
  frontera con TypeScript y con el PDF, que nadie había cruzado.

---

## Lo que NO alcancé a revisar

- **La 0353 como quinta implementación del dedup, a fondo.** La encontré y la
  puse en el censo (`:126-137` y `:146-153`, dos escrituras a mano dentro de la
  misma función, con `concepto` **crudo** — sin `lower()` ni acentos, el único
  de los seis sitios sin normalizar). No construí el escenario que la haga
  morder: exige un `concepto` con caja o acento distinto entre dos filas, y no
  verifiqué si el dominio de la columna lo permite. **Tercera ronda consecutiva
  pendiente**, y ahora con la base arriba era barato.
- **El peso en pesos de ARQ32C3-C2 sobre cada tarjeta de `/dashboard/contador`.**
  Medí la celda que devuelve la RPC ($5,000 / $689.66 contra $2,500 / $344.83
  del PDF); no reconstruí qué KPI concreto de `resumirFiscal` cambia ni en
  cuánto.
- **`conectores/sincronizar_eventos.ts`** (1,069 líneas, seis archivos de prueba
  colgando): séptima ronda pendiente.
- **`lib/mcp/herramientas/*` contra `/v1/*`** (`ESTATUS_VIAJE` tecleado en
  `mcp/herramientas/viajes.ts:22` y tres veces más en `v1/openapi/route.ts`):
  cuenta pendiente desde la 26. No encontré divergencia viva y por eso no lo
  reporto, pero tampoco lo cerré.
- **Nada de producción.** Sin red saliente; lo que digo del despliegue sale de
  `git`, no de una consulta al sitio.
