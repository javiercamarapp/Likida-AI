# Cumplimiento fiscal — auditoría 31

**Nota: 3/10** (antes 3). **No hubo movimiento**, y el MAPA obliga a decir por
qué: ninguna de las tres razones aplica. No se atacó nada (los dos commits de la
ventana son `normas/.latido-*`, cero líneas de `src/`), así que «se atacó y
subió» está descartado por construcción; la deuda no cobró factura nueva (no hay
clientes, la base sigue en cero); y la mirada más profunda de esta ronda
**confirma** el 3 en vez de corregirlo: encontré una superficie más donde el
producto imprime pesos del estímulo de IEPS, pero el ancla que fija el 3 —«3 o
menos si el producto imprime una cifra fiscal equivocada»— ya estaba fijada por
FIS-C1, que sigue línea por línea donde estaba. Bajar a 2 exigiría que algo
empeorara, y nada empeoró: el árbol es idéntico.

Verifiqué los **13** hallazgos abiertos de la 30 uno por uno con `archivo:línea`.
**Los 13 siguen ahí**, ninguno estaba mal reportado. Encontré **4 nuevos**, que
por la regla del MAPA son cosas que la 30 no vio, no cosas que la ventana rompió.

**El riesgo mayor del rubro, hoy:** sigue siendo FIS-C1 — el cotejo contra la
clave del SAT corre *después* de la escritura que vigila, así que en
`/dashboard/onboarding` la declaración contradictoria se guarda, se rechaza en
pantalla, y el motor imprime la deducción igual. Lo nuevo de esta ronda es que ya
no es el único lugar donde una cifra fiscal sale sin que la norma la sostenga:
la calculadora pública imprime el estímulo de IEPS **en pesos**, que es
exactamente lo que la propia regla operativa del repo y el propio blog de Likida
prohíben con todas sus letras.

| Severidad | # | de los cuales |
|---|---|---|
| CRÍTICO | 2 | 2 REINCIDENTES |
| ALTO | 4 | 3 REINCIDENTES · 1 nuevo |
| MEDIO | 7 | 5 REINCIDENTES · 2 nuevos |
| BAJO | 4 | 3 REINCIDENTES · 1 nuevo |

**Medido hoy, para que mañana se distinga una medición de una impresión:**

- `npx vitest run src/lib/likida/{cuadre,liquidacion,intake} marketing/calculadora.test.ts facturacion_escritura.test.ts` →
  **101 archivos / 1,175 pruebas, todas verdes**, 27.4 s. Es la suite de mi rubro
  sobre el árbol sin tocar.
- Fichas `normas/*.yaml`: **39**. Las que crucé y que ganan cualquier discusión
  por ser `verificado_fuente_primaria`: `rfa-2026-2.9`, `lif-2026-20-A`,
  `lisr-28-V`, `rliva-3-fr-II`, `rmf-2026-9.1.8`, `rmf-2026-9.1.7`,
  `rmf-2026-2.7.1.29`, `lisr-72-73`, `red-nacional-autopistas`, `cff-89-90`.
- Semanas de cuota del DOF capturadas en `normas/datos/cuota-ieps-diesel.yaml`:
  **7**, de `2026-07-25` a **`2026-09-11`**. Hoy es **13-sep-2026**: la semana
  vigente (12–18 sep, acuerdo del DOF del viernes 11) **no está**. Rango de las 7
  capturadas: **$0.6787 – $2.5801 por litro**, factor **3.80×**.
- Llamadores de `opcionesDe` sin perfil: **8** (`grep`, sin `*.test.ts`) — los
  mismos 8 de la 29 y de la 30, carácter por carácter.
- Migraciones fiscales con test SQL: `0349` **sí**, `0352` **sí**, `0355`
  **no** (`ls supabase/tests/` llega a `0354_cierre_insumos_hash_v2.sql`).

---

## Lo nuevo de esta ronda

### [ALTO] FIS-A4 — la calculadora pública imprime el estímulo de IEPS **EN PESOS**, multiplicando un año de litros por la cuota de UNA semana: es la práctica que el propio blog de Likida llama «la trampa aritmética» y que la regla operativa del repo prohíbe con todas sus letras (NUEVO)

`src/lib/likida/marketing/calculadora.ts:170`, textual:

```ts
estimacionMesMxn: vencida ? null : pesos(litrosMes * CUOTA_DOF.pesosPorLitro),
```

· la anualización: `:200` — `partes.push(diesel.estimacionMesMxn * 12)` y `:201`
(`totalAnualMxn`).
· la constante: `:49-53` — `CUOTA_DOF = { pesosPorLitro: 0.6787, registradaEl:
'2026-09-05' }`, una copia **a mano** de una sola fila del YAML.
· dónde sale a pantalla: `src/app/calculadora/calc.tsx:144` («Estimación con ESA
cuota: **$X** al mes») y `:175-178`, el titular «**Estimación de recuperación
anual**» en 2xl y negritas, que suma ese IEPS anual al 50 % de peaje.
· la página es pública y sin sesión: `src/app/calculadora/page.tsx:19-33`.

**Norma** — `normas/lif-2026-20-A.yaml`, **`verificado_fuente_primaria`**,
`estimulo_diesel_transporte.texto_vigente`, líneas 101-105, literal:

> «el monto que se podrá acreditar será el que resulte de multiplicar la cuota
> del impuesto especial sobre producción y servicios que corresponda según el
> tipo de combustible… con los ajustes que, en su caso, correspondan, **vigente
> en el momento en que se haya realizado la importación o adquisición del
> diésel…, por el número de litros importados o adquiridos**.»

y, en la misma ficha `verificado_fuente_primaria`, líneas 140-143:

> «"con los ajustes que, en su caso, correspondan" es la cuota DISMINUIDA, y la
> cuota **cambia SEMANALMENTE**. Ver criterio-1-LIF-PI: usar la cuota entera es
> práctica indebida que alcanza a **quien presta el servicio**.»

La ley cuelga la cuota del **momento de cada adquisición**. Doce meses de litros
por una sola cuota semanal no es «la cuota vigente en el momento de la
adquisición»: es una cuota constante, que es la forma del error que
`criterio-1-LIF-PI` nombra. (Esa ficha está en `evidencia_corroborante` con
`texto_vigente: null` — *no verificable en esta ronda*; la cito solo como
contexto, el peso lo lleva la LIF, que sí está verificada en fuente primaria.)

Y la regla operativa que el propio repo se escribió,
`normas/datos/cuota-ieps-diesel.yaml:1-6`, textual:

> «⚠️ TENSIÓN VIVA (16-ago-2026): dos lecturas del estímulo LIF 20-A-IV se
> sostienen del mismo texto — (A) cuota ÍNTEGRA de ley vs (B) cuota DISMINUIDA
> semanal (factor 3.5× entre ellas)… **HASTA QUE UN FISCALISTA CON CÉDULA FIRME
> UNA: el producto y el marketing muestran LITROS acreditables y rango, jamás el
> estímulo en pesos.**»

**Escenario, con pesos y litros.** Un contralor abre `likida.ai/calculadora` hoy,
13-sep-2026, y teclea **40,000 litros de diésel al mes** (una flota de ~35
unidades, el placeholder de la propia página).

1. `cuotaVencida('2026-09-13')` → `diasEntre('2026-09-05','2026-09-13') = 8`, y
   el umbral es `> 14` (`:58`, `:135-137`) → **false**. Se imprimen pesos.
2. `:170` → `round(40,000 × 0.6787)` = **$27,148** al mes.
3. `:200` → `27,148 × 12` = **$325,776** al año, que entra al titular.

Ahora las mismas 480,000 litros/año contra las cuotas que el DOF publicó **de
verdad** en las 7 semanas que el repo tiene capturadas:

| Semana capturada | cuota disminuida | lo que la página habría impreso al año |
|---|---|---|
| 15–21 ago (codNota 5796377) | $2.2760 | **$1,092,480** |
| 8–14 ago (codNota 5795798) | $2.5801 | **$1,238,448** |
| 22–28 ago (codNota 5796917) | $1.2821 | $615,408 |
| 5–11 sep (codNota 5798037) — **la que está hoy en el código** | $0.6787 | **$325,776** |

El mismo dato de entrada produce un titular que va de **$325,776 a $1,238,448**
según la semana en que el visitante entre: **3.80× de dispersión**, sobre litros
idénticos. El 15-ago la página habría prometido **$766,704 de más** que hoy, con
la misma aritmética y el mismo rótulo.

**Consecuencia.** El comprador es el contralor, y ésta es la primera cifra que ve
de Likida. Si entra en una semana alta, el número se desinfla enfrente de él en
la primera junta con su contador — que es, palabra por palabra, lo que el blog
del propio producto describe como el error que hay que no cometer
(`src/lib/likida/marketing/articulos.ts:170`: «Una calculadora que te enseña
pesos con la cuota de hace tres meses te está enseñando un número que tu contador
va a desinflar enfrente de ti», y `:183`: «Es menos espectacular que un numerote
en la primera pantalla, y es la diferencia entre una herramienta fiscal y un
folleto»). Likida publica el artículo y la calculadora en el mismo dominio. Y el
criterio del Anexo 3 alcanza a «quien preste servicios»: la práctica sería de
Likida, no del cliente.

**Me refuté antes de escribirlo, tres veces.**
· *«Es una estimación declarada, y la regla de la casa las permite.»* La regla de
la casa sí, pero la regla **de este dato** no: `cuota-ieps-diesel.yaml:1-6` dice
«jamás el estímulo en pesos» sin excepción, y el motor la cumple al pie
(`engine.ts:1630`, `const iepsAcreditable = 0`; `acreditable.ts:99-101`,
`NOTA_LITROS_DIESEL`). La calculadora es la **única** superficie que la rompe.
· *«La página avisa que la cuota cambia.»* Avisa (`:219`), y aun así imprime el
número anual en 2xl y lo suma al total. El aviso no cambia que el cálculo es
`litros_del_año × cuota_de_una_semana`, que es lo que la LIF no autoriza.
· *«¿No lo atrapa CI?»* No. `calculadora.test.ts:152-168` cruza `CUOTA_DOF`
contra la tabla y exige `CUOTA_DOF.registradaEl >= ultima.desde` — es decir,
verifica que la constante **no vaya detrás de la tabla**, nunca que la tabla no
vaya detrás del DOF. Con la tabla congelada en 5-sep (egress bloqueado, que es
justo lo que registran los dos commits de esta ventana), la prueba pasa verde
mientras la página imprime una cuota de una semana ya terminada.

**Causa raíz probable:** la decisión D2 («litros, no pesos») se implementó en el
motor y se olvidó en marketing, y la cuota se copió a mano a una constante en vez
de leerse con el lector fail-closed que existe (`cuadre/cuota_diesel.ts`).

---

### [MEDIO] FIS-M6 — hay dos lectores de la misma cuota del DOF con modos de falla OPUESTOS, y el que está en la superficie pública es el permisivo: su ventana de gracia se cuenta desde el INICIO de la semana, así que hoy imprime una cuota cuya vigencia venció el 11-sep (NUEVO)

`src/lib/likida/marketing/calculadora.ts:58` (`const DIAS_VIGENCIA_CUOTA = 14;`)
y `:135-137`:

```ts
export function cuotaVencida(hoy: string): boolean {
  return diasEntre(CUOTA_DOF.registradaEl, hoy) > DIAS_VIGENCIA_CUOTA;
}
```

`registradaEl` es el **sábado en que empieza** la semana (`:51`, `'2026-09-05'`,
y la fila del YAML es `vigencia: 2026-09-05 a 2026-09-11`). Contar 14 días desde
el inicio de una vigencia de 7 significa **8 días de impresión después de que la
vigencia terminó**: del 12 al 19 de septiembre la página sigue dando pesos con la
cuota del 5–11.

Contra el otro lector, `src/lib/likida/cuadre/cuota_diesel.ts:131-135`:

```ts
export function cuotaDieselVigente(t: TablaCuotaDiesel, fechaIso: string): SemanaCuotaDiesel | null {
  const f = fechaIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  return t.semanas.find((s) => s.desde <= f && f <= s.hasta) ?? null;
}
```

cuyo encabezado (`:14-18`) dice literal: «**FAIL-CLOSED**: fuera de rango no se
devuelve la última conocida, ni la más cercana, ni la completa. **Sin cuota no
hay cifra**. Un número viejo se ve idéntico a uno correcto y sale impreso citando
un artículo.» Para `'2026-09-13'` ese lector devuelve **`null`**. La calculadora
no lo llama: `grep` de `cuotaDieselVigente` en `src/` fuera de `*.test.ts` da
**un solo archivo**, su propia definición.

**Norma** — la misma `normas/lif-2026-20-A.yaml`, **`verificado_fuente_primaria`**:
la cuota es la «vigente en el momento en que se haya realizado la… adquisición».
Una cuota cuya vigencia terminó el 11-sep no es la vigente el 13-sep, y la ficha
`normas/rfa-2026-2.9.yaml`-style de vigencia no la rescata: el propio YAML
declara la vigencia fila por fila.

**Escenario, con pesos.** Hoy, 13-sep-2026. La cuota realmente vigente es la del
acuerdo del DOF del viernes 11-sep (semana 12–18), que **no existe en el repo**:
la rutina de vigilancia no salió a la red — `normas/.latido-cuota-diesel`,
commit `4047a50`, registra el intento fallido. Un visitante con 40,000 L/mes ve
**$27,148 al mes / $325,776 al año** calculados con la cuota de la semana pasada,
y el texto de la página le dice «Cuota disminuida registrada: **$0.6787/litro**
(al **2026-09-05**)» con liga al DOF — o sea, se lo dice con fecha, lo cual es
honesto, y aun así imprime el peso. Si la cuota de la semana 12–18 volviera al
nivel del 8-14 de agosto ($2.5801), el visitante se lleva una cifra **$912,672
anuales por debajo** de la que le correspondía. En sentido contrario (una semana
alta congelada) se la lleva por encima, que es el lado caro.

**Consecuencia.** El equipo que mantiene esto tiene dos definiciones de «cuota
vigente» y la que gobierna la única pantalla pública es la que no se niega a
correr. Y el radio del error crece solo: mientras el egreso siga bloqueado, la
tabla no gana semanas y la constante tampoco, pero la página sigue en verde 8
días por semana de más.

**Me refuté antes de escribirlo.** Busqué si `calculadora.test.ts` cerrara la
ventana: no — `HOY_VIVA = CUOTA_DOF.registradaEl` (`:15`), así que la prueba
evalúa el día 0 de la semana, nunca el día 8 ni el 13. Y busqué si la página
tuviera otro guardia por fecha: los únicos usos de `hoy` son `cuotaVencida` y el
`hoyMx()` que lo alimenta (`calc.tsx:49`).

**Causa raíz probable:** la ventana se escribió en días contra el sello de
captura en vez de contra el `hasta` de la fila, y el lector fail-closed se
construyó para el motor sin cablearse a la superficie que sí imprime pesos.

---

### [MEDIO] FIS-M7 — la nota que el motor imprime al declarar NO DEDUCIBLE el combustible en efectivo enumera la lista de la LISR 27-III **sin la transferencia electrónica**, que es el primer medio que la fracción nombra y el que la propia lista del motor admite (NUEVO)

`src/lib/likida/cuadre/engine.ts:845`, textual:

```
`${etiqueta} ${medio} — la flota declaró que NO califica a la facilidad del 15%
(dedicación exclusiva o régimen), así que el combustible exige uno de los medios
de la LISR 27-III (cheque nominativo, tarjeta de crédito/débito/servicios o
monedero autorizado) — no deducible.`
```

Cuatro familias. La lista que el mismo archivo aplica para decidir son **seis
claves**: `engine.ts:126` — `MEDIOS_LISR_27_III = ['02','03','04','05','28','29']`,
donde **`03` es la transferencia electrónica de fondos**. Y dos notas hermanas
del mismo motor sí la nombran: `engine.ts:911` («…que no está en la lista de la
LISR 27-III (**transferencia**, cheque nominativo, tarjeta de
crédito/débito/servicios o monedero autorizado)…») y `fiscal.ts:691` («la
fracción admite una lista cerrada: **transferencia**, cheque nominativo…»). O sea:
tres redacciones del mismo precepto en el mismo producto, y la única que omite
un medio es la que acompaña el veredicto más duro.

**Norma** — `normas/lisr-27-III.yaml`, líneas 9-14, literal:

> «Estar amparadas con un comprobante fiscal y que los pagos cuyo monto exceda de
> $2,000.00 se efectúen mediante **transferencia electrónica de fondos desde
> cuentas abiertas a nombre del contribuyente en instituciones que componen el
> sistema financiero**…; cheque nominativo de la cuenta del contribuyente,
> tarjeta de crédito, de débito, de servicios, o los denominados monederos
> electrónicos autorizados por el Servicio de Administración Tributaria.»

Esa ficha está en **`evidencia_corroborante`** — *no verificable en esta ronda*,
y lo digo en vez de esconderlo. Pero el mismo medio aparece transcrito en una
ficha que **sí** es `verificado_fuente_primaria`,
`normas/lif-2026-20-A.yaml:114-123`, para la lista gemela del estímulo de diésel:

> «…deberá efectuarse con: monedero electrónico autorizado por el Servicio de
> Administración Tributaria; tarjeta de crédito, débito o de servicios…; con
> cheque nominativo…, o bien, **transferencia electrónica de fondos desde cuentas
> abiertas a nombre de la persona contribuyente en instituciones que componen el
> sistema financiero** y las entidades que para tal efecto autorice el Banco de
> México.»

y el comentario de la propia ficha (`:136-137`) declara que ese conjunto es
«el mismo conjunto de `MEDIOS_LISR_27_III` (c_FormaPago 02/03/04/05/28/29)».
La omisión es del rótulo, no de la lógica.

**Escenario, con pesos.** Flota Título II a secas (clave 601), no elegible a la
2.9 → `elegible === false`. En el ejercicio carga **$1,000,000** de diésel:
**$700,000 por transferencia SPEI** (`FormaPago '03'`), **$160,000 en efectivo**
(`'01'`) y $140,000 con tarjeta. El motor juzga bien: los $700,000 por SPEI **no
producen diferencia** (`medioNoAdmitidoCombustible('03')` → `false`, `:221-225`) y
solo los $160,000 en efectivo salen `efectivo_no_elegible` y no deducibles. Pero
el PDF que el contralor archiva trae, al pie de esos $160,000, la frase de `:845`
diciéndole que «el combustible **exige** uno de los medios de la LISR 27-III
(cheque nominativo, tarjeta…, o monedero)». El contralor cruza esa lista contra
su auxiliar de diésel, ve que **$700,000 de sus $1,000,000** se pagaron con un
medio que la frase no menciona, y tiene dos salidas: reservar $700,000 de
deducción que la ley sí le concede (**~$210,000 de ISR** a la tasa del art. 9, y
**$112,000 de IVA acreditable**) o llamar a Likida a preguntar por qué el papel
dice una cosa y el desglose otra. Las dos son caras y las dos ocurren en la
primera revisión.

**Consecuencia.** Es exactamente el modo de falla que este rubro no perdona: una
leyenda que atribuye a un artículo una lista cerrada que el artículo no tiene, en
el único documento que se archiva. Y es una falla que se lee como del lado
conservador —niega de más— pero que el contralor interpreta como que el motor no
conoce su propia regla.

**Me refuté antes de escribirlo.** Comprobé que la frase no sea un resumen
deliberado de la **RFA 2.9** (que sí enumera cuatro familias sin transferencia,
`rfa-2026-2.9.yaml:14-16`): no puede serlo, porque la frase se emite justo cuando
la flota **NO** califica a la 2.9 y cita expresamente la LISR 27-III, que es la
que aplica en ese supuesto. Y comprobé que la lógica no esté igual de mal:
`MEDIOS_LISR_27_III` incluye `'03'`, así que el veredicto es correcto y lo único
equivocado es el texto.

**Causa raíz probable:** la frase se redactó copiando la enumeración de la RFA
2.9 (cuatro familias) y pegándole la cita de la LISR 27-III (cinco), en un
archivo donde la misma lista ya estaba bien escrita dos veces.

---

### [BAJO] FIS-B4 — el panel de la liquidación tiene una columna «IEPS de diésel» en pesos bajo el rótulo «LIF 20-A fr. IV», y su pie de página la funda en «CFDI con desglose», que es el IEPS **trasladado** — la cifra que la ficha dice literalmente que NO es el estímulo (NUEVO)

`src/app/dashboard/[id]/detalle.tsx:278` (la cabecera `<th>IEPS de diésel</th>`),
`:286` (`<Celda vacio={d.ieps <= 0}>{d.ieps > 0 ? mxn(d.ieps) : '—'}</Celda>`) y
`:298`, textual:

> «Diésel en litros (LIF 20-A fr. IV, estímulo por cuota semanal del DOF). El
> peaje al 50 % está sujeto a elegibilidad… **IVA e IEPS sólo de CFDI con
> desglose**.»

**Norma** — `normas/lif-2026-20-A.yaml`, **`verificado_fuente_primaria`**, línea
124, literal:

> «cuota IEPS vigente al momento de la compra × LITROS. **No es el IEPS
> trasladado en el CFDI.**»

El pie funda una columna de pesos titulada «IEPS de diésel», dentro de una
sección titulada «Acreditable / recuperable» que cita la LIF 20-A fr. IV, en «el
CFDI con desglose» — que es el traslado. Es la confusión exacta que la ficha
desmiente en una línea.

**Escenario, con pesos.** Una liquidación con litros de diésel y peaje pero sin
IEPS acreditable escrito: `hayAcred` es `true` (`:87`, basta `litrosDiesel > 0`),
la celda de IEPS pinta `—` y **el pie se imprime igual**, afirmando que el IEPS
de esta pantalla sale del desglose del CFDI. Y si una fila vieja trae
`ieps_acreditable = $1,856.00` (el 16 %… perdón, el IEPS trasladado de un CFDI de
diésel de $11,600 — el número que el motor sumaba antes de que `engine.ts:1630`
lo fijara en `0`), la pantalla lo pinta en pesos bajo «LIF 20-A fr. IV»: el
estímulo real de ese ticket, con 430 L a la cuota del 5-sep, son **$291.84**.
Seis veces menos.

**Por qué es BAJO y no más.** Hoy no hay daño vivo y lo digo: `engine.ts:1630` es
`const iepsAcreditable = 0`, así que toda liquidación nueva escribe 0
(`repo.ts:1211`), y la base está en cero porque no hay clientes. El comentario de
`:268-270` reconoce que la columna «solo puede venir de filas viejas». Lo que sí
está vivo hoy es el **pie**, que se imprime siempre que haya algo acreditable y
afirma una fundamentación que la ficha niega.

**Consecuencia.** Deuda que va a cobrar factura el día que alguien mire esa
columna y la cruce con `acreditable.ts`, que en el PDF de la MISMA liquidación
entrega litros y dice «el estímulo se calcula con la cuota SEMANAL vigente al
momento de cada compra». Dos pantallas, dos fundamentos, un solo concepto.

**Causa raíz probable:** cuando `iepsAcreditable` se fijó en 0 se corrigió el
motor y se dejó la columna y su pie por compatibilidad con filas viejas, sin
corregir el texto que la funda.

---

## Los 13 reincidentes, verificados uno por uno

Todos con `archivo:línea` abierto y leído hoy. El detalle, el escenario con pesos
y la refutación de cada uno están en `docs/auditoria-30/fiscal.md`; aquí va la
prueba de que siguen y lo que cambió (nada).

| # | Título en corto | `archivo:línea` verificado hoy | ¿sigue? |
|---|---|---|---|
| **FIS-C1** (CRÍTICO) | el cotejo del régimen corre DESPUÉS de la escritura que vigila | `src/app/dashboard/onboarding/page.tsx:67` (`guardarPerfilPatch`) vs `:70` (`actualizarFacilidad15`), `:72-74` (el `catch` que solo pinta texto); espejo en `src/lib/likida/perfil/entrevista-aplicar.ts:78` vs `:82`; el cotejo saltado en `src/lib/likida/repo.ts:1616-1632` | **SÍ, idéntico** |
| **FIS-C2** (CRÍTICO) | cambiar la clave del SAT después no recalcula nada, y el cliente puede cambiarla | `src/lib/saas/fiscal.ts:222-233` (`guardarDatosFiscales`, `update(fila)` sin tocar `perfil` ni `config`), `:207` (`regimen_fiscal` va en `fila`) | **SÍ, la función entera sin un carácter de cambio** |
| **FIS-A1** (ALTO) | la «fuente única» del 15 % sigue siendo parámetro OPCIONAL y 8 llamadores no lo pasan | `src/lib/likida/fiscal.ts:577` (`perfilCrudo?: unknown`); sin perfil: `inicio-contenido.tsx:161,166,167,168` y `contador/inicio-contador.tsx:121,126,127,128` — **8**; con perfil: `chat-tools.ts:152`, `dinero.ts:165`, `fiscal.ts:519,1650,1716` | **SÍ, los mismos 8** |
| **FIS-A2** (ALTO) | la retención del 4 % no la teclea ningún formulario y la ayuda afirma lo contrario | `src/app/dashboard/facturacion/forma.tsx:159-170` (hay `subtotal` e `iva`, no hay `retencion`), `:168-169` («El total lo calculamos nosotros: subtotal + IVA, **sin oportunidad de descuadre**»); `page.tsx:115-123` lee solo esos dos campos de la `FormData` | **SÍ** |
| **FIS-A3** (ALTO) | `0355` reescribe la RPC de todo el panel del contador y no tiene test SQL | `supabase/migrations/0355_gastos_fiscales_sin_copias.sql` existe; `ls supabase/tests/` termina en `0354_cierre_insumos_hash_v2.sql` | **SÍ** |
| **FIS-M1** (MEDIO) | el criterio de copia portado a SQL es más ancho que el del motor | `0349:57-63` particiona sobre todo el `gasto` del tenant del año, sin `viaje_id`; el original `engine.ts:514` recibe los gastos de UN viaje | **SÍ** — y ver la nota de abajo |
| **FIS-M2** (MEDIO) | `traerTodoDesdeId` no es inmune a inserciones | `src/lib/likida/pg.ts:264` (`esperadas` se congela en la página 0) y `:267` (`if (filas.length >= esperadas) return filas`) | **SÍ, textual** |
| **FIS-M3** (MEDIO) | el cubo del 15 % se define por exclusión de la lista de la LISR (5 familias), no de la RFA (4), sin declararlo | `engine.ts:126` (`MEDIOS_LISR_27_III`), `:221-225` (`medioNoAdmitidoCombustible`); `rfa-2026-2.9.yaml:60-71` sigue enumerando dos lecturas y ninguna es ésta | **SÍ** |
| **FIS-M4** (MEDIO) | el denominador suma combustible COMPRADO y la regla dice «pagos EFECTUADOS» | `0349:80` (`coalesce(sum(monto),0) as total`, sin mirar forma de pago) contra `:81-85`, que sí la exige para el numerador | **SÍ, y `0349:18-24` lo sigue declarando fuera de alcance por escrito** |
| **FIS-M5** (MEDIO) | dos fichas `verificado_fuente_primaria` dan instrucciones opuestas sobre la caseta estatal | `rmf-2026-9.1.7.yaml:66` y `red-nacional-autopistas.yaml:88`, las dos `usado_en_codigo: []`, las dos vivas en `normas/consulta.ts` tema `peajes_y_casetas` | **SÍ** |
| **FIS-B1** (BAJO) | `exigibleHasta` sin un solo lector de producción | `normas/indice.ts:92` (definición) y `:286,320,352,364,376,388,400` (poblado); `grep` sin `*.test.ts` → **esas 8 líneas y nada más** | **SÍ. Faltan 109 días para el 31-dic-2026** |
| **FIS-B2** (BAJO) | el `ayuda` de dedicación afirma ser válvula del estímulo de peaje, y el peaje no la lee | `src/app/dashboard/onboarding/forma.tsx:104` («Válvula del 15% de combustible en efectivo **y del estímulo de peaje**») contra `perfil/preguntas.ts:126-133` (`calificaEstimuloPeaje` solo mira `menoresA300M` y `parteRelacionada`) | **SÍ, textual** |
| **FIS-B3** (BAJO) | el comentario que funda la retención cita la migración equivocada | `src/lib/likida/facturacion_escritura.ts:156` — «`// FIS-M3 (mig. 0351): retención del 4% de IVA, opcional`». La migración es `0352_factura_retencion_iva.sql`; `0351` es `costo_fase_copiloto_runner` | **SÍ, textual** |

**Una medición que refuerza FIS-M1 y que no estaba en la 30.** El desajuste de
universos tiene un segundo brazo, en TypeScript y no en SQL:
`src/lib/likida/cuadre/desde_db.ts:187-191` dedupe el efectivo de ESTE viaje con
`copiasDeComprobante(gastos)` —cuyo universo es **un viaje**— y se lo resta a
`totalesEjercicio.efectivo`, que viene de la RPC **deduplicada a nivel
tenant-año**. Dos tickets de $1,000 con folios `0042` y `42` en **viajes
distintos**: la RPC cuenta uno solo, el `.filter` de `:188-190` no marca ninguno
como copia y resta los dos → `efectivoPrevEjercicio` sale **$1,000 corto**, y
este viaje cree tener $1,000 más de cupo del 15 % del que le queda. El comentario
de `:174-185` declara explícitamente que el `.filter` «tiene que espejar el
`where` de la RPC en TODOS sus términos»; espeja el predicado y no el universo,
que es exactamente lo que FIS-M1 dice de la otra mitad. No lo levanto como
hallazgo aparte: es el mismo defecto visto desde el otro extremo.

---

## Lo que revisé y está bien

- **El estímulo de IEPS del MOTOR sigue siendo litros, no el IEPS trasladado.**
  `engine.ts:1630` (`const iepsAcreditable = 0`, y es `const` a propósito),
  `:1731-1758` (litros del OCR, solo con `MEDIOS_LISR_27_III`),
  `acreditable.ts:115-122` + `:99-101`. Contra `lif-2026-20-A.yaml:124`,
  **`verificado_fuente_primaria`**: «cuota IEPS vigente al momento de la compra ×
  LITROS. No es el IEPS trasladado en el CFDI.» La regla que el encargo nombra
  explícitamente **está respetada en el motor y en el PDF** — el problema nuevo
  (FIS-A4) está fuera de los dos.
- **El guardia de litros contra el monto muerde.** `engine.ts:1750-1765`: razón
  `litros / (monto / precioRef)` fuera de 0.5×–2× → `diesel_desviacion` y **no**
  se acredita. Atrapa el decimal corrido (200 L leídos como 20,000 L).
- **`cuota_diesel.ts` es fail-closed de verdad y su contrato está probado.**
  `:131-135` (`cuotaDieselVigente` devuelve `null` fuera de rango, nunca la
  última conocida), `:107-124` (`validarCuotasDiesel`: sábado a viernes, empalme
  sin hueco, `reducción + disminuida = cuota_completa` al diezmilésimo), `:83-85`
  (rechaza el nombre viejo `estimulo_por_litro` con un `throw` explicando que
  multiplicarlo por litros da 2.2× de más). Es el lector correcto; el problema es
  que la superficie pública no lo usa (FIS-M6).
- **La base del estímulo de peaje es la que la regla ordena, y el papel lo dice.**
  `engine.ts:1719-1721` (0.5 × `subTotal`, sin IVA) contra
  `rmf-2026-9.1.8.yaml:31-34`, **`verificado_fuente_primaria`**, fr. IV literal:
  «se aplicará al importe pagado por concepto del uso de la infraestructura
  carretera de cuota, **sin incluir el IVA**, el factor de 0.5 para toda la Red
  Nacional de Autopistas de Cuota.» Y `acreditable.ts:54-57` declara la base
  elegida y por qué no toma la otra.
- **La fr. III del peaje está cerrada como lista cerrada, con su fundamento.**
  `engine.ts:256` — `MEDIOS_ELECTRONICOS_PEAJE = ['03','04','05','06','28','29']`,
  contra `rmf-2026-9.1.8.yaml:26-29` («Efectuar los pagos de autopistas mediante
  la tarjeta de identificación automática vehicular o de cualquier otro sistema
  electrónico de pago con que cuente la autopista»). Dación en pago (12),
  compensación (17) y novación (23) quedan fuera, y el cheque también.
- **Las cuatro condiciones de fondo del peaje se imprimen, y el renglón no va en
  verde.** `acreditable.ts:82-88` (`CONDICIONES_ESTIMULO_PEAJE` nombra las cuatro
  de la LIF y las tres de la RMF 9.1.8), `:136` (la condición va en el LABEL, no
  solo en el pie), y `pdf.ts:415-417` pinta `condicionado` en tinta neutra. Contra
  `lif-2026-20-A.yaml:160-164`, **`verificado_fuente_primaria`**.
- **El tope de alimentación está bien fundado en su «por beneficiario» y su
  proporción de IVA.** `tope_alimentacion.ts:94-120` (agrupa por día, proporción
  `min(1, tope/totalTimbrado)` calculada **solo** sobre lo timbrado) contra
  `lisr-28-V.yaml:21-25`, **`verificado_fuente_primaria`**: «…no exceda de $750.00
  diarios **por cada beneficiario**…». Los tres huecos de la ficha (H1 hospedaje
  o transporte que acompañe, H2 tarjeta de crédito, H3 faja de 50 km) están
  declarados en la ficha con su estado, y H1/H2 implementados **como aviso** y no
  como negativa — la postura correcta cuando no se ve toda la contabilidad.
- **El IVA se acredita «en la proporción en que las erogaciones sean
  deducibles».** `engine.ts:1663` (`proporcionDeducible`) y el comentario
  `:1656-1662` citando LIVA 5 fr. I. El criterio vive una vez
  (`tope_alimentacion.ts`) y lo importan el motor y `resumirFiscal`.
- **La retención del 4 % está impecable donde Likida timbra.**
  `carta_porte_cfdi.ts:200` (`esMoral = re.rfc.length === 12`; RFC de 13 = persona
  física → `null`), `:202` (`total = sub + iva − ret`), `:234`
  (`TasaOCuota="0.040000"`), `:239-244` (`TotalImpuestosRetenidos` y el nodo
  global, con Retenciones antes que Traslados, que es el orden del XSD). Contra
  `rliva-3-fr-II.yaml:14-17`, **`verificado_fuente_primaria`**: «La retención se
  hará por el **4%** del valor de la contraprestación pagada efectivamente, cuando
  reciban los servicios de autotransporte terrestre de bienes…», que solo obliga
  a personas morales.
- **La validación PPD/PUE × FormaPago del CFDI que Likida emite es correcta y
  explica el rechazo del PAC antes de gastarlo.** `carta_porte_cfdi.ts:150-161`:
  PPD exige `99`, PUE exige dos dígitos reales y rechaza `99` con su razón
  (`CFDI40158`). Coherente con `rmf-2026-2.7.1.29.yaml`,
  **`verificado_fuente_primaria`**: «indicar la clave 99 "Por definir" en el caso
  de no haberse recibido el pago de la contraprestación.»
- **El dígito verificador del RFC está bien implementado.** `intake/cfdi.ts:39-77`:
  alfabeto con `&`=24 y `Ñ`=38, suma ponderada `v × (13−i)`, `resto 0 → '0'`,
  `resto 1 → 'A'`, y la excepción explícita de los genéricos `XAXX010101000` /
  `XEXX010101000`, que no cumplen el algoritmo y son legítimos.
- **El veredicto de EFOS no declara fraude por descarte.** `intake/sat.ts:80-85`:
  `EFOS_LIMPIO = {'200','201'}`; cualquier otro código cae en `efosDesconocido`
  (bandeja), nunca en `efos: true`. Contra `cff-69-B.yaml`,
  **`verificado_fuente_primaria`**: el efecto de «no producen ni produjeron efecto
  fiscal alguno» es solo del listado **definitivo**, y el presunto solo «se
  presumirá». El comentario `:66-79` lo argumenta explícitamente.
- **Las leyendas de `cuadre/leyendas.ts` no cuelgan ningún artículo de una cifra**
  y la eximente del CFF 89 último párrafo («manifestar POR ESCRITO que la asesoría
  puede ser contraria a la interpretación de las autoridades») está literal en las
  dos constantes (`:36-39`, `:50-58`). Ficha `normas/cff-89-90.yaml`,
  **`verificado_fuente_primaria`**.
- **La única cita normativa de `deducibilidad.ts` está bien.** `:78` («LISR 27-III
  y RFA 2026 regla 2.9 exigen que el CFDI de combustible consigne el permiso CRE
  vigente del proveedor. El sistema no lo valida») contra
  `rfa-2026-2.9.yaml:17-21`, **`verificado_fuente_primaria`**: «Además, en el
  comprobante fiscal deberá constar la información del permiso vigente, expedido
  de acuerdo con la Ley de Hidrocarburos al proveedor del combustible…». Y el
  tono es `condicionado`, no `bueno`: no afirma lo que no verifica.
- **El desglose no puede contradecir a su propio total.** `deducibilidad.ts:62-63`:
  si las tres cubetas no suman `totalComprobado` (±1.5 centavos) la función
  devuelve `null` y no se imprime nada, en vez de imprimir un «Por confirmar
  $4,812» debajo de un «Total comprobado $4,600».
- **El parser del XML del CFDI lee retenciones y traslados sin romperse con un
  nodo único.** `cfdi_xml.ts:340-364`: `toArr` (`:203-205`) normaliza el caso en
  que `fast-xml-parser` devuelve objeto en vez de arreglo, que es justo el caso
  del CFDI con una sola `<cfdi:Retencion>` — `isArray` (`:197`) no incluye
  `Retencion` y aun así el camino es correcto. Lo intenté romper y no pude.

---

## Lo que NO alcancé a revisar

Sin esto la nota sería una mentira por omisión.

- **Nada que requiera base viva.** Sin Postgres no ejecuté `0349`, `0352`, `0355`
  ni `gastos_fiscales_agregados_tenant`: los leí contra sus tests SQL y contra el
  TS que los llama. FIS-A3 y FIS-M1 salen de esa lectura, no de una corrida.
- **Ningún render.** No levanté preview de `/calculadora`, de
  `/dashboard/onboarding` ni de `/dashboard/[id]`. Los tres hallazgos de pantalla
  se sostienen en el `archivo:línea` del componente y de la función pura que lo
  alimenta, no en una captura. Para FIS-A4 y FIS-M6 corrí la aritmética a mano
  contra `calculadora.ts` y la tabla del YAML, no contra la página.
- **`intake/cfdi.ts` e `intake/cfdi_xml.ts` los abrí por primera vez en seis
  rondas, pero solo en el eje de mi rubro** (RFC, QR, impuestos trasladados y
  retenidos). La ficha de referencia de los requisitos del comprobante,
  `normas/cff-29-A.yaml`, sigue en `evidencia_corroborante` con `texto_vigente:
  null`: **no verificable en esta ronda por construcción**, así que no puedo
  dictaminar si falta un requisito del 29-A.
- **`sat_descarga/` quedó otra vez a medias**: no reabrí `bandeja.ts`,
  `resolucion.ts`, `peaje_cierre.ts` ni `zip.ts`. FIS-M2 se verificó solo en
  `pg.ts`.
- **`facturacion/` lo crucé solo en `caducidad.ts`** (que está bien construido:
  `:97-140` distingue `mes_natural`, `mes_siguiente` y `mesDeCompraMas`, trunca
  las colas en horas hacia abajo y tiene un oráculo externo publicado por Primera
  Plus). No abrí `permiso_cre.ts`, `flota_fiscal.ts`, `enrutar.ts` ni
  `vinculacion_asistida.ts`. Y su ficha de plazos,
  `normas/politica-portales-plazos.yaml`, está en `sin_verificar`.
- **El techo estructural de la nota sigue en pie, y es el mismo desde la 28.**
  `normas/lisr-27-III.yaml` —la fracción detrás del veredicto rojo más frecuente
  del motor, del importe de $2,000 y de la mitad de las leyendas de este rubro—
  sigue en **`evidencia_corroborante`**, con su propia `nota_verificacion`
  diciendo «NO se leyó en diputados.gob.mx. PARA CERRAR: leer el PDF vigente de la
  LISR en diputados.gob.mx». Mientras eso no se cierre contra fuente primaria,
  **el ancla de 8+ («cada cifra fiscal impresa rastrea a una ficha
  `verificado_fuente_primaria`») es inalcanzable con independencia del código**.
  Esta ronda no lo pudo cerrar: no hay red saliente.
- **`rfa-2026-3.12` sigue sin ficha** (39 archivos, ninguno es 3.12), así que el
  cierre fail-closed de una flota de pasaje/turismo deja abierto qué regla sí la
  alcanza — es lo que mantiene latente a FIS-B2.
- **`rmf-2026-2.7.7` (Carta Porte: obligados y radio de 30 km)** no la crucé
  contra `carta_porte_cfdi.ts` ni contra `nodoComplementoCcp`. Es el hueco más
  grande que dejo, porque ahí sí hay un CFDI que Likida timbra con su propio CSD.
