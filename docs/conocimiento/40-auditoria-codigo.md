# Auditoría del código contra el marco fiscal y legal

> Ola 2 — 27-jul-2026. Construido sobre la ola 1.
>
> Alcance: `javiercamarapp/cuadra/src/lib/cuadra/**` (3,428 líneas sin pruebas, 23 archivos de
> prueba) leído línea por línea el 27-jul-2026, contrastado contra `00-RESUMEN-EJECUTIVO.md`,
> `04-iva-ieps-estimulos.md`, `09-liquidacion.md`, `34-proceso-liquidacion.md` y `FISCAL_LEGAL.md`.
> No se tocó código: esta ola es de investigación y diseño.
>
> `34-proceso-liquidacion.md` §11 ya levantó la tabla de **qué falta** contra el diseño del proceso.
> Este documento no la repite: audita **lo que sí está escrito** y encuentra dónde está mal, dónde
> engaña y dónde cuesta dinero. Los hallazgos 1 a 5 son nuevos respecto de esa tabla.

---

## Resumen para el fundador

Lo que está construido es bueno donde nadie lo mira: leer el código de barras del ticket, atrapar un
RFC mal leído, no gritar "fraude" cuando el SAT contesta raro, y no dejar que el modelo invente
números. Eso vale y no hay que tocarlo.

El problema está en la capa de arriba, la que el contralor sí va a mirar. Hay tres cifras que el
sistema imprime en verde en el PDF y le manda al chofer por WhatsApp, y las tres están mal
construidas. El **IEPS de diésel** se está leyendo del comprobante, y la ley prohíbe que la
gasolinera lo desglose: esa cifra va a ser siempre cero y, peor, cada factura de diésel va a
disparar una alarma falsa. El **50% de casetas** se calcula sin verificar nada de lo que la regla
exige (TAG, tope de ingresos, aviso de marzo), así que el número está inflado. Y el **diésel pagado
en efectivo** se declara no deducible sin excepción, cuando la propia ola 1 ya verificó que el
autotransporte de carga federal tiene una válvula del 15%: le estamos quitando al cliente una
deducción que sí tiene.

Hay además cuatro fugas silenciosas de dinero: dos fotos del mismo ticket se cuentan dos veces (el
candado está apagado por bandera), una factura de caseta que llega por XML nunca cuenta como
caseta, un tropiezo de la base de datos apaga sin avisar la validación del RFC de la empresa, y el
PDF corta renglones cuando hay muchos comprobantes, así que los conceptos no suman el total.

Y hay un riesgo legal que no es fiscal: el sistema le dice al operador, por WhatsApp y sin que
intervenga una persona, que su comprobante "no es deducible". Eso es exactamente la decisión
automatizada que el art. 26 fr. II de la LFPDPPP permite objetar. No hay aviso de privacidad en el
repositorio, ni la leyenda de los arts. 89 y 90 del CFF en ninguna salida.

Y hay 501 líneas de un módulo completo (`facturacion/`) que nadie llama, más la mitad de la
configuración muerta. Eso no cuesta dinero, pero sí cuesta demo: es superficie que hay que explicar.

---

## 1. Qué está bien resuelto y NO hay que tocar

Esto está resuelto con medición encima, no con opinión. Tocarlo es regresión garantizada.

| Pieza | Evidencia | Por qué no se toca |
|---|---|---|
| Lectura de códigos con zxing y protocolo de dos fotos | `intake/cfdi.ts:227-267`, `intake/ocr.ts:129-142` | La decisión está fundada en medición de campo (jsQR falla a 1600/1200/900 px; 10 variantes de preprocesado fallaron; el acercamiento entra en ~100 ms). Es la razón por la que el UUID no pasa por visión. |
| Distinción folio impreso vs. folio del QR | `intake/cfdi.ts:127-155`, `repo.ts:169-172` | Comprobado contra el papel: 31 chars impresos vs. 30 en el QR. Son dos cadenas distintas, no dos lecturas. Pisar una con otra rompe el timbrado en el portal. |
| Dígito verificador del RFC | `intake/cfdi.ts:53-74` | Atrapa el caso real (PER/PEX/PTE donde decía PEC) antes de salir a consultar al SAT contra un contribuyente inexistente. Con la excepción correcta para `XAXX010101000`/`XEXX010101000`. |
| Mapeo conservador de EFOS | `intake/sat.ts:61-78` | Nunca declara fraude por descarte: código desconocido → `null` + bandeja, no `true`. Es el criterio correcto — un falso positivo de EFOS sobre un proveedor legítimo es un incidente con el cliente. |
| Guardia determinística de cifras | `cuadre/guardia.ts:23-48` | Fail-closed: si no puede recalcular el cuadre, no manda números. Es código, no prompt. Es la defensa que hace creíble el producto frente a un contralor. |
| Emparejamiento que se niega a adivinar | `intake/emparejar.ts:24-33, 56-59` | Sin candidato único no pega nada. Correcto: colgarle a un ticket el folio de otro no deja hueco visible, deja un folio equivocado que la oficina teclea. |
| Duplicados excluidos del total, no solo reportados | `cuadre/engine.ts:69-90` | El duplicado no infla `totalComprobado`. Es la diferencia entre reportar y cuadrar. |
| Montos ≤ 0 fuera del total y a revisión | `cuadre/engine.ts:87-99` | Una nota de crédito mal leída no reduce el comprobado ni sesga la diferencia contra el operador. |
| Cierre atómico e idempotente | `repo.ts:285-299` + migración `0013_guardar_liquidacion_tx.sql` | Una sola función plpgsql: si falla el update del viaje, la liquidación hace rollback. Cierra el huérfano de cierre parcial. |
| RLS deny-all y revocación de RPC a `public` | `0012_seguridad_rls.sql`, `0016_codigo_pendiente.sql` | Los dos huecos correctos: `wa_mensaje_procesado` sin RLS permitía envenenar la idempotencia; las funciones de mutex eran ejecutables por anónimo. |
| Distinción de motivo de fallo del OCR | `intake/ocr.ts:87`, `processor.ts:144-151` | No le echa la culpa al chofer de un bug propio. Es producto, no cosmética. |

---

## 2. Qué CONTRADICE el marco fiscal o legal documentado

### 2.1 El IEPS del diésel se está leyendo del comprobante, y la ley prohíbe que venga ahí

**Fundamento (fuente primaria, verificado hoy).** LIEPS art. 19, fr. II (última reforma DOF
07-11-2025), texto literal:

> "**Expedir comprobantes fiscales, sin el traslado en forma expresa y por separado del impuesto**
> establecido en esta Ley, **salvo** tratándose de la enajenación de los bienes a que se refieren los
> incisos A), D), F), G), I) y J) de la fracción I del artículo 2o. de esta Ley, **siempre que el
> adquirente sea a su vez contribuyente de este impuesto por dichos bienes y así lo solicite**."

El diésel es el inciso D), pero la excepción exige que **el adquirente sea contribuyente del IEPS
por esos bienes**. Una flota no enajena combustible: no lo es. Segundo párrafo de la misma fracción,
que remata: los comerciantes con 90% de enajenaciones al público en general "**no trasladarán
expresamente y por separado el impuesto**… En todos los casos, se deberán ofrecer los bienes
gravados por esta Ley, **incluyendo el impuesto en el precio**". Una gasolinera cae ahí.

**Qué hace el código.** `cuadre/engine.ts:236-241` acumula `g.iepsTraslado` —el nodo `Traslado`
código 003 leído del XML— como `iepsAcreditable`, y cuando no lo encuentra emite la diferencia
`ieps_no_desglosado` con esta nota:

> "El CFDI de Diésel no desglosa el IEPS — es deducible, pero **sin ese desglose se pierde el
> acreditamiento del estímulo** (LIF 2026 Art. 20)."

Esa frase es falsa. El estímulo del art. 20, ap. A, fr. IV de la LIF 2026 se calcula **litros ×
cuota**, no se lee del comprobante (`04-iva-ieps-estimulos.md` §3.3 y §3.4, que transcribe el texto
de la LIF: "el monto que se podrá acreditar será el que resulte de multiplicar la cuota… **por el
número de litros importados o adquiridos**").

**Tres consecuencias, todas malas:**

1. `iepsAcreditable` va a ser **siempre 0** en producción. La cifra que más vende el producto no
   existe.
2. **Cada** CFDI de diésel con XML dispara `ieps_no_desglosado`, que está en la lista `REVISAR`
   (`engine.ts:244`). O sea: toda liquidación con una factura de diésel sale en estatus `revisar`.
   Eso destruye la pantalla de excepciones que es el diseño correcto
   (`00-RESUMEN-EJECUTIVO.md`, Fase 1 punto 8).
3. Los **litros** —el dato que sí importa— se extraen (`intake/ocr.ts:29, 60, 284`) y se tiran
   dentro del jsonb `ocrExtra`. No hay columna, no hay índice, no hay regla que los use. El
   `04-iva-ieps-estimulos.md` §7 lo llama por su nombre: "intentar leerlo es un bug conceptual".

**Además falta el candado de medio de pago.** LIF 2026 art. 20, ap. A, fr. IV, 4º párrafo: el
estímulo del diésel **solo** procede con monedero electrónico, tarjeta a favor del contribuyente,
cheque nominativo o transferencia — **sin** la válvula del 15% que sí existe para ISR
(`00-RESUMEN-EJECUTIVO.md` §3 y C1). El motor no distingue: si algún día `iepsTraslado` llegara con
valor, lo acreditaría sin mirar `formaPago`.

### 2.2 El 50% de casetas se calcula sin ninguno de los requisitos que lo condicionan

**Qué hace el código.** `cuadre/engine.ts:231`:

```ts
if (g.concepto === 'caseta' && (g.subTotal ?? 0) > 0) peajeAcreditable += (g.subTotal as number) * peajeFactor;
```

Un factor 0.5 sobre el SubTotal de cualquier caseta con XML. Nada más.

**Qué exige la RMF 2026 regla 9.1.8** (`04-iva-ieps-estimulos.md` §5, verificado ahí contra el DOF):

| Requisito | ¿Lo verifica el código? |
|---|---|
| I. Aviso en **marzo** por buzón tributario con inventario vehicular | No existe |
| II. **Bitácora de viaje** con origen, destino y ruta que **coincida con el estado de cuenta del TAG** | No existe (`grep -i "tag\|bitacora"` en `src/lib/cuadra/` → 0 resultados) |
| III. Pago con **TAG o sistema electrónico** — caseta en efectivo en ventanilla no genera estímulo aunque haya CFDI | No verifica `formaPago` en absoluto |
| IV. Factor 0.5 sobre el importe **sin IVA** | **Sí** — usa `subTotal`, correcto |
| Tope: ingresos anuales **< 300 MDP** | No existe el dato del tenant |

Es decir: cumple 1 de 5, y el número resultante se imprime **en verde, en negritas**, en el PDF
(`liquidacion/pdf.ts:149`: "Estímulo de peaje 50% (LIF 2026 Art. 20-A)") y se acumula en el
dashboard del contralor (`analytics.ts:112-123`, `getAcreditables`). Además el estímulo es **ingreso
acumulable** al acreditarse (LIF 2026 art. 20, ap. A, párrafos finales): presentarlo bruto infla la
propuesta ~30% — está en la lista de promesas prohibidas del `00-RESUMEN-EJECUTIVO.md`.

### 2.3 El diésel en efectivo se declara no deducible sin la excepción del 15%

Ya está levantado como CONFLICTO 1 en `34-proceso-liquidacion.md`. Lo confirmo y agrego el
fundamento textual y un agravante que ese documento no vio.

**Fundamento (fuente primaria, verificado hoy).** LISR art. 27, fr. III, 2º párrafo (última reforma
DOF 01-04-2024):

> "Tratándose de la adquisición de **combustibles** para vehículos marítimos, aéreos y terrestres, el
> pago deberá efectuarse en la forma señalada en el párrafo anterior, **aun cuando** la
> contraprestación de dichas adquisiciones **no excedan de $2,000.00**…"

Y el 3er párrafo de la misma fracción, que nadie cita:

> "Las autoridades fiscales **podrán liberar de la obligación** de pagar las erogaciones a través de
> los medios establecidos en el primer párrafo de esta fracción, cuando las mismas se efectúen **en
> poblaciones o en zonas rurales, sin servicios financieros**."

Contra eso, RFA 2026 regla 2.9 (DOF 17-feb-2026): el autotransporte terrestre de carga federal
"considerará cumplida la obligación" pagando por medios distintos **hasta el 15% del total pagado
por combustible**, si el CFDI consigna el permiso vigente.

**Qué hace el código.** `cuadre/engine.ts:106-107` marca `combustible_efectivo` para **cualquier**
`formaPago === '01'`, y lo mete en `NO_DEDUCIBLE` (`engine.ts:218`), con la nota "no deducible" que
le llega al operador por WhatsApp y al contralor en el PDF. No hay contador del 15%, no hay
excepción de zona rural, no hay régimen del contribuyente.

**El agravante que no estaba señalado:** ese veredicto no se toma sobre el `c_FormaPago` del XML.
Se toma sobre lo que el modelo de visión leyó en un ticket térmico. `intake/ocr.ts:247`:

```ts
const formaPago = data.forma_pago === 'efectivo' ? '01' : data.forma_pago === 'tarjeta' ? '04' : undefined;
```

El campo `formaPago` de `Gasto` recibe indistintamente ese valor inferido y el `c_FormaPago` real del
XML (`processor.ts:260`, `repo.ts:143`). El motor no puede distinguirlos. Estamos emitiendo un
veredicto fiscal duro sobre una lectura de "TIPO OPER" en papel térmico. Y `'04'` es *tarjeta de
crédito*: un monedero de combustible es `'28'`, un débito `'28'`/`'04'` según el caso — el mapeo
tampoco es fiel.

### 2.4 El tope de viáticos está aplicado a los conceptos equivocados y a la unidad equivocada

**Fundamento (fuente primaria, verificado hoy).** LISR art. 28, fr. V, párrafos 2 a 4:

> "Tratándose de gastos de viaje destinados a la **alimentación**, éstos sólo serán deducibles hasta
> por un monto que no exceda de **$750.00 diarios por cada beneficiario**, cuando los mismos se
> eroguen en territorio nacional, o **$1,500.00** cuando se eroguen en el extranjero, **y el
> contribuyente acompañe el comprobante fiscal… que ampare el hospedaje o transporte**."
>
> "Los gastos de viaje destinados al **uso o goce temporal de automóviles**… hasta por un monto que
> no exceda de **$850.00 diarios**…"
>
> "Los gastos de viaje destinados al **hospedaje**, sólo serán deducibles hasta por un monto que no
> exceda de **$3,850.00 diarios, cuando se eroguen en el extranjero**…"

O sea: **no existe tope de hospedaje nacional**, el de alimentación es **por día y por beneficiario**
(no por comprobante), y la alimentación exige además que se acompañe el comprobante de hospedaje o
transporte.

**Qué hace el código.** `cuadre/engine.ts:115-118` aplica un único `viaticosTopeFiscalDiarioMxn`
(750, `config.ts:91`) a **cada comprobante** cuyo `concepto === 'viaticos'`. El enum de conceptos
(`types/cuadra.ts:5`) no separa alimentación de hospedaje de transporte: todo cae en `viaticos`.

Falla en las dos direcciones, y las dos cuestan:

- **Falso positivo (le quita deducción al cliente):** un hotel de $900 en Querétaro se marca como
  "excede el tope fiscal de alimentación… el excedente de $150.00 no es deducible". Es legalmente
  falso — no hay tope nacional de hospedaje.
- **Falso negativo (le construye un pasivo):** tres comidas de $300 el mismo día suman $900 y
  ninguna dispara la regla, porque el tope es diario y el código lo mide por comprobante.

Y no corre ninguna de las otras tres condiciones del mismo artículo, que el propio texto exige:
relación de trabajo o servicios profesionales del beneficiario, faja de 50 km alrededor del
establecimiento, y comprobante de hospedaje/transporte acompañando el de alimentación.

### 2.5 El producto le comunica una decisión automatizada adversa al operador, sin humano

**Fundamento.** LFPDPPP vigente (DOF 20-mar-2025), art. 26 fr. II: derecho de oposición al
tratamiento automatizado que, **sin intervención humana**, evalúe "rendimiento profesional,
situación económica, fiabilidad o comportamiento" con efecto significativo
(`00-RESUMEN-EJECUTIVO.md` §10, `11-datos-personales.md`).

**Qué hace el código.** El motor genera notas del tipo "pagado en EFECTIVO… **no deducible**",
"timbrada al RFC X (**no es de la empresa**) — no deducible", "el emisor está en **lista negra del
SAT (EFOS)**" (`engine.ts:107, 152, 159`). Esas notas se le envían **al operador**, por WhatsApp,
sin paso por una persona: `cuadre/resumen.ts:22-26` las mete bajo "Ojo con esto:" y
`processor.ts:365` las manda. El PDF que recibe el operador (`processor.ts:383`) las repite.

No hay en el repositorio ni aviso de privacidad ni consentimiento ni mecanismo de oposición
(`grep -rni "privacidad\|consentimiento\|LFPDPPP" src/` → 2 resultados, ambos comentarios en
`src/lib/llm/models.ts`). Tampoco existe la leyenda de los arts. 89 y 90 del CFF en ninguna salida
del producto, que es la mitigación que la propia ley ofrece a "quien asesore, aconseje, **preste
servicios** o participe".

El arreglo es barato y además mejora el producto: el veredicto adverso va al **contralor**; al
operador se le dice qué falta ("mándame el XML", "verifica el folio"), no cómo se resolvió su caso.

---

## 3. Qué falta para que la liquidación esté completa

`34-proceso-liquidacion.md` §11 tiene la tabla de brecha completa contra el diseño del proceso. No la
repito. Lo que agrego desde el código son **cuatro huecos de terminación** que hacen que la
liquidación no cierre bien aunque las reglas estuvieran correctas:

1. **La liquidación se cierra sin veredicto agregado.** `Liquidacion` (`types/cuadra.ts:80-93`)
   tiene `totalComprobado`, `diferencia` y tres acreditables, pero **no** tiene "total deducible" ni
   "total no deducible". El motor sabe cuáles gastos cayeron en `NO_DEDUCIBLE` (`engine.ts:218`) y
   tira ese dato: nunca lo suma ni lo persiste. El contralor recibe un PDF donde el "no deducible"
   está disperso en renglones de texto. **Es una suma de una línea y es literalmente el producto.**

2. **El estatus no distingue "en excepción" de "no pude validar".** La lista `REVISAR`
   (`engine.ts:244`) tiene 17 tipos y mezcla cosas incomparables: `cfdi_efos` (fraude) con
   `folio_verificar` (el OCR dudó) y `cfdi_pendiente`. Y `intake/sat.ts:50, 82` devuelve
   `'pendiente'` ante **cualquier** timeout o caída del SAT — correcto como diseño demo-safe, pero
   significa que una tarde con el SAT lento manda **todas** las liquidaciones a `revisar`. La
   pantalla de excepciones se vuelve la pantalla de todo.

3. **No hay reproceso de lo que quedó pendiente.** Un `estadoSat === 'pendiente'` no se vuelve a
   consultar nunca: la consulta al SAT ocurre una sola vez, dentro del OCR (`intake/ocr.ts:239-244`).
   No hay job, no hay cola, no hay columna de "reintentar después". El comprobante se queda
   marcado como no validado para siempre.

4. **El acreditamiento corre sobre CFDI no confirmados por el SAT.** `NO_DEDUCIBLE`
   (`engine.ts:218`) **no incluye** `cfdi_pendiente` ni `cfdi_efos_indeterminado`. Un CFDI con XML
   parseado pero cuyo estatus el SAT nunca confirmó suma su IVA a `ivaAcreditable`
   (`engine.ts:228-229`). Es acreditar sobre un comprobante que no se pudo verificar.

---

## 4. Qué está sobre-construido o no se paga solo

| Pieza | Tamaño | Estado | Qué hacer |
|---|---|---|---|
| Módulo `facturacion/` completo — `comercios.ts` (230 líneas, catálogo de 10 comercios), `caducidad.ts` (74), `identificar.ts` (51) + 3 archivos de prueba | **501 líneas** | **Cero consumidores.** `grep -rn "calcularCaducidad\|facturacion/" src --include="*.ts"` fuera del propio directorio → 0 resultados | Es trabajo bueno resolviendo un problema real (el reloj del plazo). No está conectado a nada. O se conecta al cuadre en esta semana, o sale del árbol de build hasta que se conecte. No se enseña en la demo. |
| `config.tabulador` (rendimiento, factorCarga, precioDiesel, umbralDesviacion), `config.unidades`, `config.catalogoCuentas`, `config.salida`, `config.portales` + `portalParaTicket()` | ~45 líneas de `config.ts` | **Ninguno se lee en ningún lado** (verificado con grep sobre `src/`) | Es la configuración de reglas que no existen (desviación de diésel, salida contable, aviso de portal). Borrar o marcar `// PENDIENTE` con la regla que la va a consumir. |
| `TipoDiferencia` `'diesel_desviacion'` | `types/cuadra.ts:64` | Se consulta en `engine.ts:246` pero **nunca se emite** | La rama del `if` es código muerto que sugiere una regla que no corre. |
| `analytics.getStatsPorOperador()` | `analytics.ts:50-74` | Sin consumidores, y devuelve `diferencias: 0` **hardcodeado** (`analytics.ts:72`) | Un KPI que siempre vale cero es peor que ausente: si llega al dashboard, miente. |
| `analytics.detectarAnomalias()` | `analytics.ts:84-107` | Sin consumidores. Declara el tipo `'folio_duplicado'` y nunca lo emite | La detección de "mismo CFDI en dos viajes" **sí vale** y es el fraude #1 de la ola 1 (`32-fraude.md`). Conectarla al dashboard cuesta una línea. |
| `repo.getPolitica()` | `repo.ts:21-33` | Sin consumidores — la política viaja por `config.politica` | Dos fuentes de verdad para la misma política, una viva y una muerta. Borrar la muerta. |

**Lectura:** ~600 líneas del módulo, un 18% del código de dominio, no se ejecuta nunca. Nada de eso
es dañino, pero antes de la demo del 6-ago es superficie que hay que explicar y que puede llevar la
conversación a un lugar que no controlas.

---

## 5. Riesgos de DINERO en el camino crítico

Ordenados por lo que cuestan. Los cinco están en la ruta que corre en cada liquidación.

### R1 — Doble conteo de comprobantes sin folio y sin UUID (el más caro)

`cuadre/engine.ts:69-83` deduplica en dos niveles: por `cfdiUuid`, y si no hay, por
`concepto|folio|monto`. **Un gasto sin UUID y sin folio no se deduplica nunca.** Es exactamente el
caso corriente: la foto de un ticket de caseta cuyo folio el OCR no alcanzó a leer.

El tercer candado —hash de la imagen— existe (`intake/hash.ts`, migración `0015`) pero está **detrás
de una bandera apagada por defecto**: `processor.ts:123`, `if (process.env.CUADRA_DEDUP_FOTOS === '1')`.
Sin esa variable, `imgHash` nunca se calcula ni se escribe, y el índice único de la 0015 no puede
dispararse porque la columna va en `null`.

**Efecto:** el operador manda la misma foto dos veces (pasa todo el tiempo en WhatsApp: se reenvía
"por si no llegó") y `totalComprobado` sube el doble. La `diferencia` contra el anticipo sale mal, y
sale mal **a favor del operador**. Es la cifra que el contralor usa para decidir a quién le debe
cuánto.

**Arreglo:** encender `CUADRA_DEDUP_FOTOS=1`. Es una variable de entorno.

### R2 — Toda factura de caseta que llega por XML deja de contar como caseta

`processor.ts:245-249`, camino de ingesta de XML:

```ts
const esFuel = (xml.claveProdServ ?? '').startsWith('15101');
gastoId = randomUUID();
await addGasto(op.tenantId, viajeId, {
  concepto: esFuel ? 'diesel' : 'factura',
  ...
```

Solo hay dos destinos: `diesel` o `factura`. Un CFDI de peaje (IAVE, PASE, CAPUFE) entra como
`'factura'`. Y `engine.ts:231` condiciona el estímulo a `g.concepto === 'caseta'`.

**Efecto:** el peaje que llega por el camino **más confiable** (el XML timbrado, el único que trae
`subTotal` verificado) es justo el que **nunca** genera el estímulo del 50%. El que llega por foto
—clasificado por el modelo de visión— sí. Está al revés.

Lo mismo vale para viáticos: un CFDI de hotel por XML entra como `'factura'` y nunca pasa por la
regla de viáticos. Y `politicaPara()` (`engine.ts:44-49`) tampoco le encuentra tope.

### R3 — Un tropiezo de la base de datos apaga la validación del RFC de la empresa, en silencio

`config.ts:116-127`:

```ts
try { ...supabaseAdmin().from('tenant').select('rfc, config')... }
catch { return DEMO_CONFIG; }  // demo-safe: si la DB no está, usa defaults
```

`DEMO_CONFIG.empresa.rfc` es `'XAXX010101000'` (`config.ts:65`). Y `engine.ts:58-63` **filtra
explícitamente** el RFC genérico del conjunto de RFC válidos:

```ts
const RFC_GENERICO = 'XAXX010101000';
const rfcsOk = new Set([...].filter((r) => r !== RFC_GENERICO));
```

Con `rfcsOk` vacío, la regla del receptor (`engine.ts:151`) **no corre**.

**Efecto:** ante cualquier error de lectura del tenant, un CFDI timbrado al RFC del chofer —o de
cualquiera— pasa como válido, sin una sola señal en la liquidación. Al mismo tiempo el tenant hereda
los topes de política de demo ($4,000 diésel, $1,500 caseta, `config.ts:66-71`) en vez de los suyos.
Es fail-open sobre dos reglas de dinero a la vez. La intención ("demo-safe") es correcta para la
sala; el comportamiento en producción no.

**Arreglo:** que el `catch` marque la liquidación como no confiable en vez de devolver defaults
callado. Log de error + una diferencia `config_no_disponible` que mande a `revisar`.

### R4 — Un override parcial del tenant apaga reglas fiscales, en silencio

`config.ts:120`: `const cfg = override ? { ...DEMO_CONFIG, ...override } : { ...DEMO_CONFIG }`.

Es un merge **superficial**. Si el tenant guarda en `tenant.config` un objeto `estimulos` con solo
`{ peajeFactor: 0.5 }`, el resultado tiene `viaticosTopeFiscalDiarioMxn: undefined` y
`efectivoTopeMxn: undefined`. El motor las trata con guardas `!= null` (`engine.ts:116`) y
`?? 2000` (`engine.ts:105`): la regla de viáticos **deja de correr** sin decir nada. Lo mismo con
`hidrocarburos`: un override parcial deja `h.claves` en `undefined` y revienta o apaga todo el
bloque de complemento (`engine.ts:100-101, 170-189`).

**Arreglo:** merge profundo por sección, o validar la config con un esquema Zod al leerla y fallar
ruidosamente. Media hora.

### R5 — El PDF corta renglones y sus conceptos no suman el total

`liquidacion/pdf.ts:114`: `if (y < 200) break;` dentro del bucle de gastos, con el comentario
"demo: una página". Y `pdf.ts:164`: `if (y < 70) break;` en el bucle de diferencias.

**Efecto:** a partir de ~15 comprobantes, el PDF imprime una tabla truncada **sin ninguna marca de
que faltan renglones**, y debajo un "Total comprobado" que sí incluye los que no se ven. Ese PDF es
el documento que el contralor archiva y que, en su caso, enseña en una revisión. Un papel donde los
conceptos no suman el total es peor que no tener papel. Una liquidación de quincena de un
tractocamión pasa de 15 comprobantes con facilidad.

Lo mismo con las diferencias: se corta la lista de hallazgos, que es justo lo que hay que atender.

**Arreglo mínimo si no da tiempo a paginar:** un renglón "… y N comprobantes más (ver el detalle en
el sistema)". Diez líneas.

### Riesgo menor pero real

`resumen.ts:25` corta las observaciones a **6** (`obs.slice(0, 6)`) en el mensaje de WhatsApp, sin
avisar cuántas quedaron fuera. Con las alarmas falsas de §2.1 y §2.4 llenando la lista, las
observaciones que sí importan se pueden quedar afuera del corte.

---

## 6. Qué se mejora con poco esfuerzo y mucho beneficio

Ordenado por retorno sobre esfuerzo. Los cinco primeros caben en un día y todos son anteriores a la
demo del 6-ago.

1. **Encender `CUADRA_DEDUP_FOTOS=1`** (R1). Una variable de entorno. Cierra el doble conteo, que es
   la única fuga que hace que la cifra final salga mal en la demo si el operador reenvía una foto.
2. **Apagar la regla `ieps_no_desglosado`** (§2.1). Borrar el `else if` de `engine.ts:238-240`.
   Elimina una alarma falsa que hoy dispara en el 100% de las facturas de diésel y que manda toda
   liquidación a `revisar`. Sin eso la pantalla de excepciones no funciona el día de la demo.
3. **Suavizar la nota de `combustible_efectivo`** (§2.3). Cambiar "no deducible" por "verificar
   contra el 15% del ejercicio (RFA 2026 regla 2.9)" y sacarla de `NO_DEDUCIBLE`. Es cambiar un
   string y un elemento de un arreglo. Deja de decirle al cliente que perdió una deducción que sí
   tiene, y de paso deja de ser una decisión automatizada adversa firme (§2.5).
4. **Separar `viaticos` en `alimentacion` / `hospedaje` / `transporte`** y aplicar el tope solo a
   alimentación (§2.4). Un valor más en el enum de `ConceptoGasto` y una condición en el `if`.
   Deja de rechazar hospedaje nacional legítimo.
5. **Mapear el concepto correcto al ingerir XML** (R2). Extender `esFuel ? 'diesel' : 'factura'` a
   una tabla de `claveProdServ → concepto` con las claves de peaje. Recupera el estímulo de casetas
   por el camino bueno.
6. **Marcar la procedencia de `formaPago`** (§2.3). Un booleano `formaPagoDeXml` en `Gasto`. Sin
   eso no se puede saber si un veredicto de dinero se tomó sobre un dato timbrado o sobre una
   lectura de papel térmico — y en cuanto haya un cliente, esa es la primera pregunta de su
   contador.
7. **Sumar y persistir `totalNoDeducible`** (§3.1). El motor ya tiene la lista `NO_DEDUCIBLE` y ya
   sabe qué gasto cayó en cada diferencia; falta un `reduce` y una columna. Es la cifra que el
   contralor compra.
8. **Poner la leyenda del CFF 89/90 en el pie del PDF** (§2.5). Una línea de `drawText` en
   `pdf.ts:169`. Es la mitigación que la propia ley ofrece a quien presta el servicio.
9. **Conectar `detectarAnomalias()` al dashboard** (§4). Ya está escrita y detecta el mismo CFDI en
   dos viajes, que es el fraude más común del sector. Un import.
10. **Aviso "y N comprobantes más" en el PDF** (R5). Diez líneas, y el documento deja de mentir.

---

## Acciones concretas

| Acción | Por qué | Esfuerzo | Cuándo |
|---|---|---|---|
| `CUADRA_DEDUP_FOTOS=1` en el entorno del demo y de producción | Sin eso, dos fotos del mismo ticket duplican el gasto y la diferencia contra el anticipo sale mal a favor del operador | Bajo (una env var) | Hoy |
| Borrar la regla `ieps_no_desglosado` (`engine.ts:238-240`) y su tipo | LIEPS 19-II prohíbe el desglose a una flota: la alarma dispara en el 100% de las facturas de diésel y manda toda liquidación a `revisar` | Bajo | Hoy |
| Reescribir la nota de `combustible_efectivo` y sacarla de `NO_DEDUCIBLE` (`engine.ts:106-107, 218`) | Contradice la corrección C1 ya verificada por la ola 1 (RFA 2026 regla 2.9, válvula del 15%); hoy le quita al cliente una deducción real | Bajo | Antes del 6-ago |
| Mapear `claveProdServ → concepto` al ingerir XML (`processor.ts:245`) | Toda factura de caseta que llega por XML entra como `'factura'` y pierde el estímulo del 50% | Bajo | Antes del 6-ago |
| Separar `viaticos` en alimentación / hospedaje / transporte y aplicar $750 solo a alimentación, por día y por beneficiario | LISR 28-V no tiene tope de hospedaje nacional; hoy rechazamos gasto legítimo y dejamos pasar el exceso diario real | Bajo-Medio | Antes del 6-ago |
| Aviso "y N comprobantes más" en el PDF, o paginarlo (`pdf.ts:114, 164`) | Hoy los conceptos impresos no suman el total impreso a partir de ~15 comprobantes; es el papel que el contralor archiva | Bajo | Antes del 6-ago |
| Leyenda de los arts. 89 y 90 del CFF en el pie del PDF y en el mensaje de cierre | Es la mitigación que la ley ofrece a "quien preste servicios"; sin ella, el art. 90 con agravante | Bajo | Antes del 6-ago |
| Que el veredicto adverso ("no deducible", "EFOS") deje de enviarse al operador y vaya solo al contralor | LFPDPPP art. 26 fr. II: decisión automatizada sin intervención humana con efecto significativo sobre la persona | Bajo | Antes del 6-ago |
| Gatear el 50% de casetas detrás de `formaPago` electrónico + bandera `elegibleEstimuloPeaje` por tenant | RMF 2026 regla 9.1.8 frs. I-III y tope de 300 MDP: hoy cumplimos 1 de 5 requisitos y publicamos la cifra en verde | Medio | Antes del primer cliente pagado |
| Persistir `litros` como columna y calcular el estímulo de IEPS como litros × cuota semanal del DOF | LIF 2026 art. 20-A-IV: el estímulo es litros × cuota, nunca un importe leído del comprobante | Medio-Alto | Fase 1 (bloquea la promesa de ahorro) |
| Sumar y persistir `totalDeducible` / `totalNoDeducible` en `Liquidacion` | El motor ya tiene el dato y lo tira; es la cifra que compra el contralor | Bajo | Fase 1 |
| Booleano `formaPagoDeXml` en `Gasto` | Hoy un veredicto fiscal duro se puede estar tomando sobre una lectura de papel térmico, y no hay forma de saberlo | Bajo | Fase 1 |
| Reemplazar el `catch → DEMO_CONFIG` de `config.ts:124` por error ruidoso + diferencia `config_no_disponible` | Fail-open: un tropiezo de la DB apaga en silencio la validación del RFC receptor y aplica topes de demo | Bajo | Fase 1 |
| Merge profundo (o validación Zod) de `tenant.config` sobre `DEMO_CONFIG` (`config.ts:120`) | Un override parcial apaga reglas fiscales sin avisar | Bajo | Fase 1 |
| Partir `REVISAR` en dos estatus: `en_excepcion` (fiscal) y `sin_validar` (técnico) | Un timeout del SAT hoy manda todas las liquidaciones a `revisar` y anula la pantalla de excepciones | Medio | Fase 1 |
| Cola de reconsulta para `estadoSat === 'pendiente'` | Hoy se consulta una sola vez dentro del OCR y nunca más | Medio | Fase 1 |
| Incluir `cfdi_pendiente` y `cfdi_efos_indeterminado` en el filtro de acreditamiento (`engine.ts:218-228`) | Hoy se acredita IVA de CFDI cuyo estatus el SAT nunca confirmó | Bajo | Fase 1 |
| Conectar `detectarAnomalias()` al dashboard | Ya está escrita y detecta el fraude más común (mismo CFDI en dos viajes) | Bajo | Fase 1 |
| Decidir sobre `facturacion/` (501 líneas sin consumidores): conectarlo al cuadre o sacarlo del árbol | Superficie que hay que explicar en la demo y que hoy no hace nada | Bajo | Antes del 6-ago |
| Borrar `config.tabulador`, `config.unidades`, `config.catalogoCuentas`, `config.salida`, `config.portales`, `repo.getPolitica()`, `analytics.getStatsPorOperador()`, tipo `diesel_desviacion` | Configuración y código de reglas que no existen; `getStatsPorOperador` además devuelve un KPI siempre en cero | Bajo | Fase 1 |
| Aviso de privacidad en modalidad simplificada para el flujo de WhatsApp, con prueba de entrega | LFPDPPP art. 16 fr. II; la carga de la prueba es del responsable (Reglamento art. 31). Hoy no existe en el repositorio | Medio | Antes del primer cliente pagado |

---

## CONFLICTOS

**CONFLICTO A — el código contradice la corrección C1 de la propia ola 1.** Ya levantado como
CONFLICTO 1 en `34-proceso-liquidacion.md`; lo **confirmo con el texto de la LISR leído hoy** y
agrego dos elementos que ese documento no tenía: (a) el 3er párrafo del art. 27 fr. III permite a la
autoridad liberar de la obligación en poblaciones o zonas rurales sin servicios financieros —una
segunda válvula que el motor tampoco contempla—; y (b) el veredicto no se toma sobre el
`c_FormaPago` del XML sino, en el camino de la foto, sobre lo que el modelo de visión leyó del papel
(`intake/ocr.ts:247`), y el motor no puede distinguir una fuente de la otra. No resuelvo: el
sintetizador decide.

**CONFLICTO B — `FISCAL_LEGAL.md` §1.1 sostiene la versión dura, sin la excepción.** El documento del
repositorio dice, con negritas propias, "El diésel pagado en efectivo NO es deducible" y lo llama
"lo más importante de todo el documento", y solo después, en §1.2, introduce la facilidad del 15%.
El `00-RESUMEN-EJECUTIVO.md` (C1) fija la redacción segura al revés: regla general + excepción
expresa para carga federal. Como `FISCAL_LEGAL.md` es el archivo que vive **dentro del repo** y es
el que un ingeniero abre primero, es el que está alimentando la regla equivocada del motor. Hay que
alinear ese archivo, no solo el código.

**CONFLICTO C — `FISCAL_LEGAL.md` §1.6 cita la regla de factura global como "RMF 2.7.1.24".** El
`00-RESUMEN-EJECUTIVO.md`, Fase 0 punto 1, marca esa cita como muerta: en 2026 la factura global es
la **2.7.1.21**, y la 2.7.1.24 trata devolución de IVA a turistas. La cita equivocada sigue viva en
el repositorio y en la lista de fuentes de ese mismo archivo. No es código, pero es lo que se copia
al material comercial.

**CONFLICTO D — el motor cita "regla 2.7.1.48 RMF 2026" como fundamento del complemento de
hidrocarburos** (`cuadre/engine.ts:181`, `config.ts:87` la fecha 24-abr-2026). El
`00-RESUMEN-EJECUTIVO.md` (C2) documenta la vigencia del complemento apoyándose en las reglas
**2.7.1.8** y en los `Last-Modified` de los XSD, y deja la fecha exacta de publicación en el Portal
del SAT como pendiente **no cerrado**. No pude verificar en fuente primaria que la regla 2.7.1.48
sea la que impone esa obligación con ese número. Como esa cita **se imprime en la nota que ve el
cliente**, una cita muerta ahí destruye la credibilidad de todo lo demás (es el argumento de la
Fase 0 punto 1 del resumen ejecutivo). Verificar antes del 6-ago.

---

## SIN VERIFICAR

1. **La regla RMF 2026 2.7.1.48 como fundamento del complemento de hidrocarburos** (CONFLICTO D). No
   se pudo leer el texto de la RMF 2026 en fuente primaria en esta sesión: el presupuesto de
   WebSearch de la sesión (200 llamadas) ya estaba agotado por la ola 1, y firecrawl sigue sin
   créditos. Es una cita que el producto imprime al cliente.
2. **El texto literal de la RMF 2026 regla 9.1.8** (requisitos del estímulo de casetas). Se usó lo
   verificado en `04-iva-ieps-estimulos.md` §5, no una lectura propia de la fuente. La conclusión
   —que el código cumple 1 de 5 requisitos— no depende del texto exacto, pero el número de
   requisitos sí.
3. **El texto literal de la RFA 2026 regla 2.9** (válvula del 15%). Igual: se apoya en
   `03-isr-facilidades.md` y en la corrección C1, no en lectura propia del DOF del 17-feb-2026.
4. **Si `iepsTraslado` puede venir con valor en algún caso real de una flota.** El razonamiento sobre
   LIEPS 19-II (leído hoy en fuente) dice que no, porque la excepción exige que el adquirente sea
   contribuyente del IEPS por esos bienes. No descarto un caso de borde (una flota que además
   enajene combustible a terceros, p. ej. con estación propia). Si existe, la regla no debe borrarse
   sino condicionarse.
5. **No se corrieron las pruebas ni el typecheck** (`npm test`, `npx tsc --noEmit`). Todo lo afirmado
   sale de lectura de código, no de ejecución. Hay 23 archivos de prueba; no se auditó su cobertura
   sobre las reglas que este documento señala como incorrectas — es probable que existan pruebas que
   **fijan** el comportamiento equivocado (p. ej. `engine.test.ts` sobre `combustible_efectivo`), y
   habrá que cambiarlas junto con la regla.
6. **El umbral exacto a partir del cual el PDF trunca** (R5). Se estimó en ~15 comprobantes con la
   aritmética de `pdf.ts` (`y` arranca en 800, la tabla empieza cerca de 640, 18 px por renglón,
   corte en `y < 200`). No se generó un PDF real para medirlo.
7. **Comportamiento del merge superficial de `config.ts:120` con overrides reales.** No hay ningún
   tenant con `tenant.config` poblado que se haya podido inspeccionar; el riesgo se deduce del código.
8. **El estado del código corresponde a la lectura del 27-jul-2026.** Si cambió después, las
   referencias de archivo y línea se desfasan.

---

## Fuentes

**Primarias, leídas en esta sesión:**

- Ley del Impuesto Especial sobre Producción y Servicios, **art. 19 fr. II** (Última Reforma DOF
  07-11-2025) — prohibición de trasladar el IEPS en forma expresa y por separado.
  https://www.diputados.gob.mx/LeyesBiblio/pdf/LIEPS.pdf
- Ley del Impuesto sobre la Renta, **art. 27 fr. III** (párrafos 1 a 3) y **art. 28 fr. V**
  (párrafos 1 a 5) (Última Reforma DOF 01-04-2024) — medio de pago en combustible, liberación en
  zonas rurales, topes de viáticos y faja de 50 km.
  https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf

**Del paquete de conocimiento (ola 1 y ola 2), sobre las que se construye:**

- `00-RESUMEN-EJECUTIVO.md` — correcciones C1 y C2, las 10 cosas que cambian el producto, promesas
  prohibidas, ruta de construcción.
- `04-iva-ieps-estimulos.md` §3.3, §3.4, §5, §7 — LIF 2026 art. 20 ap. A frs. IV y V, cuota semanal,
  requisitos de la RMF 9.1.8, "extraer litros, no importe de impuesto".
- `09-liquidacion.md` §6.4 — las siete reglas duras y los cinco contadores.
- `11-datos-personales.md` — LFPDPPP art. 26 fr. II, aviso simplificado, semáforo de portales.
- `34-proceso-liquidacion.md` §11 y CONFLICTO 1 — tabla de brecha del proceso (no se repite aquí).
- `FISCAL_LEGAL.md` (en el repo) — §1.1 a §1.6, §3; ver CONFLICTOS B y C.

**Código auditado:** `javiercamarapp/cuadra/src/lib/cuadra/{cuadre,intake,facturacion,liquidacion}/`,
`processor.ts`, `repo.ts`, `config.ts`, `analytics.ts`, `tools.ts`, `src/types/cuadra.ts`,
`supabase/migrations/0012`, `0013`, `0015`, `0016`.

---

## Tabla priorizada de mejoras

| Mejora | Por qué | Esfuerzo | Riesgo si no se hace |
|---|---|---|---|
| Encender `CUADRA_DEDUP_FOTOS=1` | El candado de doble conteo existe y está apagado; sin `imgHash` el índice único de la 0015 nunca dispara | Bajo | La misma foto reenviada duplica el gasto: el total comprobado y la diferencia contra el anticipo salen mal, a favor del operador. Puede pasar **en la demo** |
| Borrar la regla `ieps_no_desglosado` | LIEPS 19-II prohíbe el desglose a quien no es contribuyente del IEPS por el diésel | Bajo | Toda liquidación con una factura de diésel sale en `revisar`. La pantalla de excepciones —el argumento de producto entero— no funciona |
| Corregir la nota y el efecto de `combustible_efectivo` | Contradice C1 y la RFA 2026 regla 2.9 (válvula del 15%) | Bajo | Le decimos al contralor que perdió una deducción que sí tiene. Si lo detecta su fiscalista, se cae la credibilidad de todo el motor |
| Mapear `claveProdServ → concepto` al ingerir XML | Hoy solo hay `diesel` o `factura`; la caseta por XML nunca es caseta | Bajo | El peaje que llega por el camino más confiable pierde el estímulo del 50%. Dinero real, invisible |
| Separar alimentación / hospedaje / transporte en viáticos | LISR 28-V: no hay tope de hospedaje nacional; el de alimentación es diario y por beneficiario | Bajo-Medio | Rechazamos hospedaje legítimo (le cuesta al cliente) y dejamos pasar el exceso diario real (le construye un pasivo) |
| Aviso "y N comprobantes más" o paginado del PDF | `pdf.ts:114` corta la tabla en silencio | Bajo | El documento que el contralor archiva tiene conceptos que no suman el total impreso. En una revisión, eso es peor que no tenerlo |
| Leyenda CFF 89/90 en las salidas + veredicto adverso solo al contralor | CFF 89 último párrafo y 90 (mitigación expresa); LFPDPPP art. 26 fr. II | Bajo | Multa del art. 90 con agravante, y una objeción de tratamiento automatizado que hoy no tiene respuesta ni mecanismo |
| Gatear el 50% de casetas (TAG + elegibilidad + 300 MDP) | RMF 2026 regla 9.1.8 frs. I-III; hoy se cumple 1 de 5 | Medio | Publicamos en verde un estímulo indefendible en revisión. Si el cliente lo acredita con nuestro número, el pasivo es suyo y la culpa nuestra |
| `totalDeducible` / `totalNoDeducible` en la liquidación | El motor ya tiene el dato y lo descarta | Bajo | La liquidación no entrega la única cifra que el comprador (el contralor) realmente compra |
| Procedencia de `formaPago` (XML vs. OCR) | Hoy un veredicto fiscal duro puede venir de una lectura de papel térmico | Bajo | Primera pregunta del contador del primer cliente, sin respuesta posible |
| Config: quitar el `catch → DEMO_CONFIG` y hacer merge profundo | Fail-open sobre dos reglas de dinero | Bajo | Un tropiezo de la DB apaga en silencio la validación del RFC receptor y aplica topes de demo a un cliente real |
| Estímulo de IEPS por litros × cuota semanal del DOF | LIF 2026 art. 20-A-IV; los litros ya se extraen y se tiran | Medio-Alto | La cifra que más vende el producto vale cero hoy, y cualquier promesa de ahorro por litro es falsable en semanas |
| Partir `REVISAR` en `en_excepcion` / `sin_validar` + cola de reconsulta al SAT | `sat.ts` devuelve `pendiente` ante cualquier caída y nunca se reintenta | Medio | Una tarde con el SAT lento manda todo a revisión manual: el producto deja de ahorrar trabajo justo cuando más se nota |
| Incluir `cfdi_pendiente` en el filtro de acreditamiento | `engine.ts:218` no lo lista | Bajo | Se acredita IVA de comprobantes que el SAT nunca confirmó |
| Decidir sobre `facturacion/` y borrar la config muerta | ~600 líneas sin consumidores (18% del dominio) | Bajo | Superficie que explicar en la demo, y dos fuentes de verdad para la política de gastos |
| Aviso de privacidad simplificado para WhatsApp con prueba de entrega | LFPDPPP art. 16 fr. II; Reglamento art. 31 (carga de la prueba en el responsable) | Medio | No se puede firmar el primer cliente pagado sin esto |
