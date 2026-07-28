# Mejoras concretas sobre lo que ya está construido

> Ola 2 — 27-jul-2026. Consolida `40-auditoria-codigo.md` (auditoría línea por línea de
> `cuadra/src/lib/cuadra/**`, 3,428 líneas de dominio), `34-proceso-liquidacion.md` §11 (tabla de
> brecha), `32-fraude.md` §1 (inventario real de campos) y `20-arquitectura-conocimiento.md` §1.3.
>
> **Las referencias `archivo:línea` corresponden a la lectura del 27-jul-2026.** Si el código cambió
> después, se desfasan: verifica el contexto antes de aplicar el cambio, no la línea.
>
> Orden y decisiones: `00-ROADMAP.md`. Qué construir nuevo: `00-OPORTUNIDAD.md`.

**El diagnóstico en una frase:** lo construido es bueno donde nadie lo mira (leer el código de barras,
atrapar un RFC mal leído, no gritar "fraude" cuando el SAT contesta raro, no dejar que el modelo
invente números). El problema está en la capa de arriba, la que el contralor sí va a mirar: **tres
cifras que se imprimen en verde están mal construidas, y cuatro fugas de dinero corren en el camino
crítico de cada liquidación.**

---

## M0 — hoy mismo (una tarde, tres cambios)

| # | Cambio | Dónde | Por qué |
|---|---|---|---|
| **M0.1** | `CUADRA_DEDUP_FOTOS=1` en el entorno del demo **y** de producción | `processor.ts:123` | El tercer candado de deduplicación (hash de imagen, `intake/hash.ts` + migración `0015`) **existe y está apagado por bandera**. Sin la variable, `imgHash` nunca se calcula, la columna va en `null` y el índice único de la `0015` no puede dispararse |
| **M0.2** | Borrar el `else if` de la regla `ieps_no_desglosado` y su tipo | `engine.ts:238-240`, `engine.ts:244` | La LIEPS art. 19 fr. II **prohíbe** trasladar el IEPS en forma expresa y por separado salvo que el adquirente sea a su vez contribuyente del IEPS por esos bienes. Una flota no enajena combustible: no lo es |
| **M0.3** | Reescribir la nota de `combustible_efectivo` a "verificar contra el 15% del ejercicio (RFA 2026 regla 2.9)" y **sacarla de `NO_DEDUCIBLE`** | `engine.ts:106-107`, `engine.ts:218` | Contradice la corrección C1 ya verificada por la propia ola 1 |

### M0.1 — el doble conteo es la fuga más cara y puede pasar en la demo

`engine.ts:69-83` deduplica en dos niveles: por `cfdiUuid`, y si no hay, por `concepto|folio|monto`.
**Un gasto sin UUID y sin folio no se deduplica nunca** — que es exactamente el caso corriente: la
foto de un ticket de caseta cuyo folio el OCR no alcanzó a leer.

El operador manda la misma foto dos veces (pasa todo el tiempo en WhatsApp: se reenvía "por si no
llegó") y `totalComprobado` sube el doble. La `diferencia` contra el anticipo sale mal, y sale mal
**a favor del operador**. Es la cifra que el contralor usa para decidir a quién le debe cuánto.

**Verificación:** subir la misma foto dos veces produce un solo gasto y un `totalComprobado` correcto.

### M0.2 — la alarma que anula la pantalla de excepciones

`engine.ts:236-241` acumula `g.iepsTraslado` (el nodo `Traslado` código 003 leído del XML) como
`iepsAcreditable`, y cuando no lo encuentra emite `ieps_no_desglosado` con esta nota:

> "El CFDI de Diésel no desglosa el IEPS — es deducible, pero **sin ese desglose se pierde el
> acreditamiento del estímulo** (LIF 2026 Art. 20)."

**Esa frase es falsa.** El estímulo del art. 20 ap. A fr. IV de la LIF 2026 se calcula **litros ×
cuota**, no se lee del comprobante: *"el monto que se podrá acreditar será el que resulte de
multiplicar la cuota… por el número de litros importados o adquiridos"*.

Tres consecuencias, todas malas:

1. `iepsAcreditable` va a ser **siempre 0** en producción. La cifra que más vende el producto no existe.
2. **Cada** CFDI de diésel con XML dispara la alarma, que está en la lista `REVISAR`, así que **toda
   liquidación con una factura de diésel sale en estatus `revisar`**. Eso destruye la pantalla de
   excepciones, que es el diseño correcto y el argumento de producto entero.
3. Los **litros** —el dato que sí importa— se extraen (`ocr.ts:29, 60, 284`) y se **tiran** dentro del
   jsonb `ocrExtra`. No hay columna, no hay índice, no hay regla que los use.

*SIN VERIFICAR:* no descarto un caso de borde donde `iepsTraslado` sí venga con valor (una flota que
además enajene combustible a terceros con estación propia). Si aparece, la regla no debe borrarse sino
**condicionarse** a que el tenant sea contribuyente del IEPS por esos bienes.

**Verificación:** una liquidación con dos facturas de diésel con XML sale en `cuadrada`, no en `revisar`.

### M0.3 — le estamos quitando al cliente una deducción que sí tiene

`engine.ts:106-107` marca `combustible_efectivo` para **cualquier** `formaPago === '01'` y lo mete en
`NO_DEDUCIBLE` (`engine.ts:218`), con una nota que le llega al operador por WhatsApp y al contralor en
el PDF.

**Fundamento verificado en fuente primaria.** LISR art. 27 fr. III, 2º párrafo (DOF 01-04-2024) exige
medio bancarizado para combustible *"aun cuando la contraprestación… no exceda de $2,000.00"*. **Pero**
la RFA 2026 regla 2.9 (DOF 17-feb-2026) dice que los dedicados exclusivamente al autotransporte
terrestre de carga federal en Coordinados o PF actividad empresarial *"considerarán cumplida la
obligación"* pagando por medios distintos **hasta el 15% del total pagado por combustible**, si el CFDI
consigna el permiso vigente. Y el **3er párrafo** de la misma fracción, que nadie cita, permite a la
autoridad liberar de la obligación *"en poblaciones o en zonas rurales, sin servicios financieros"* —
una segunda válvula que el motor tampoco contempla.

**El agravante que hay que entender antes de tocar nada:** ese veredicto **no se toma sobre el
`c_FormaPago` del XML**. En el camino de la foto se toma sobre lo que el modelo de visión leyó en un
ticket térmico (`ocr.ts:247`):

```ts
const formaPago = data.forma_pago === 'efectivo' ? '01' : data.forma_pago === 'tarjeta' ? '04' : undefined;
```

El campo `formaPago` de `Gasto` recibe indistintamente ese valor inferido y el `c_FormaPago` real del
XML (`processor.ts:260`, `repo.ts:143`), **y el motor no puede distinguirlos**. Estamos emitiendo un
veredicto fiscal duro sobre una lectura de "TIPO OPER" en papel térmico. Encima, `'04'` es *tarjeta de
crédito*: un monedero de combustible es `'28'` — el mapeo tampoco es fiel.

**Verificación:** un gasto de diésel en efectivo produce una nota que dice "verificar", no "no
deducible", y no aparece en el total no deducible.

---

## M1 — antes del demo del 6-ago (esfuerzo bajo, todos diagnosticados)

### M1.1 — Mapear `claveProdServ → concepto` al ingerir XML

**Dónde:** `processor.ts:245-249`.

```ts
const esFuel = (xml.claveProdServ ?? '').startsWith('15101');
gastoId = randomUUID();
await addGasto(op.tenantId, viajeId, {
  concepto: esFuel ? 'diesel' : 'factura',
```

Solo hay dos destinos. Un CFDI de peaje (IAVE, PASE, CAPUFE) entra como `'factura'`, y `engine.ts:231`
condiciona el estímulo a `g.concepto === 'caseta'`.

**Efecto:** el peaje que llega por el camino **más confiable** —el XML timbrado, el único que trae
`subTotal` verificado— es justo el que **nunca** genera el estímulo del 50%. El que llega por foto,
clasificado por el modelo de visión, sí. Está al revés. Lo mismo con un CFDI de hotel: entra como
`'factura'` y nunca pasa por la regla de viáticos ni `politicaPara()` (`engine.ts:44-49`) le encuentra
tope.

**Verificación:** un CFDI de IAVE ingerido por XML produce `concepto: 'caseta'` y entra al cálculo del
estímulo.

### M1.2 — Separar `viaticos` en `alimentacion` / `hospedaje` / `transporte`

**Dónde:** enum `ConceptoGasto` en `types/cuadra.ts:5`; regla en `engine.ts:115-118`; tope en
`config.ts:91`.

**Fundamento verificado en fuente primaria.** LISR art. 28 fr. V, párrafos 2 a 4: alimentación hasta
**$750 diarios por cada beneficiario** en territorio nacional ($1,500 en el extranjero) **y** con el
comprobante de hospedaje o transporte acompañando; uso o goce de automóviles hasta **$850 diarios**;
hospedaje hasta **$3,850 diarios cuando se eroguen en el extranjero**. Es decir: **no existe tope de
hospedaje nacional**, y el de alimentación es **por día y por beneficiario**, no por comprobante.

Hoy el código aplica un único `viaticosTopeFiscalDiarioMxn` (750) a **cada comprobante** con
`concepto === 'viaticos'`. Falla en las dos direcciones y las dos cuestan:

- **Falso positivo:** un hotel de $900 en Querétaro se marca como excedente no deducible. Es
  legalmente falso, y le quita deducción al cliente.
- **Falso negativo:** tres comidas de $300 el mismo día suman $900 y ninguna dispara la regla, porque
  el tope es diario y el código lo mide por comprobante. Le construye un pasivo.

Y no corre ninguna de las otras tres condiciones del mismo artículo: relación de trabajo o servicios
profesionales del beneficiario, faja de 50 km, y comprobante de hospedaje/transporte acompañando el de
alimentación.

**Verificación:** un hotel nacional de $900 pasa limpio; tres comidas de $300 del mismo día y el mismo
beneficiario disparan el excedente de $150.

### M1.3 — Sumar y persistir `totalDeducible` / `totalNoDeducible`

**Dónde:** `types/cuadra.ts:80-93` (tipo `Liquidacion`), motor en `engine.ts:218`.

El motor ya sabe qué gasto cayó en `NO_DEDUCIBLE` y **tira el dato**. Falta un `reduce` y una columna.
El contralor recibe hoy un PDF donde el "no deducible" está disperso en renglones de texto.

**Es la única cifra que el comprador realmente compra.** Es la mejora de mayor retorno por hora
invertida de toda esta lista.

### M1.4 — Aviso "… y N comprobantes más" en el PDF

**Dónde:** `liquidacion/pdf.ts:114` (`if (y < 200) break;`, con el comentario "demo: una página") y
`pdf.ts:164` (`if (y < 70) break;` en el bucle de diferencias).

A partir de **~15 comprobantes** el PDF imprime una tabla truncada **sin ninguna marca de que faltan
renglones**, y debajo un "Total comprobado" que sí incluye los que no se ven. Una liquidación de
quincena de un tractocamión pasa de 15 comprobantes con facilidad.

**Ese PDF es el documento que el contralor archiva y que, en su caso, enseña en una revisión. Un papel
donde los conceptos no suman el total es peor que no tener papel.** Lo mismo con las diferencias: se
corta la lista de hallazgos, que es justo lo que hay que atender.

Diez líneas si no da tiempo a paginar de verdad.

*SIN VERIFICAR:* el umbral de ~15 se estimó con la aritmética de `pdf.ts` (`y` arranca en 800, la tabla
empieza cerca de 640, 18 px por renglón, corte en `y < 200`). No se generó un PDF real para medirlo.

### M1.5 — El veredicto adverso deja de ir al operador

**Dónde:** `engine.ts:107, 152, 159` (notas) → `resumen.ts:22-26` ("Ojo con esto:") →
`processor.ts:365` (envío) y `processor.ts:383` (PDF).

El motor genera notas del tipo "pagado en EFECTIVO… **no deducible**", "timbrada al RFC X (**no es de
la empresa**) — no deducible", "el emisor está en **lista negra del SAT (EFOS)**", y esas notas se le
envían **al operador**, por WhatsApp, sin paso por una persona.

**Fundamento.** LFPDPPP vigente (DOF 20-mar-2025) art. 26 fr. II: derecho de oposición al tratamiento
automatizado que, **sin intervención humana**, evalúe "rendimiento profesional, situación económica,
fiabilidad o comportamiento" con efecto significativo. No hay en el repositorio aviso de privacidad,
consentimiento ni mecanismo de oposición (`grep -rni "privacidad\|consentimiento\|LFPDPPP" src/` → 2
resultados, ambos comentarios en `src/lib/llm/models.ts`).

**El arreglo es barato y además mejora el producto:** el veredicto adverso va al **contralor**; al
operador se le dice **qué falta** ("mándame el XML", "verifica el folio"), no cómo se resolvió su caso.

**Verificación:** `grep` sobre el texto enviado al operador no encuentra "no deducible" ni "EFOS".

### M1.6 — Leyenda de los arts. 89 y 90 del CFF en el pie del PDF y en el cierre

**Dónde:** una línea de `drawText` en `pdf.ts:169`, más el mensaje de cierre de WhatsApp.

**Fundamento, texto literal verificado.** *"No se incurrirá en la agravante… cuando se manifieste en la
opinión que se otorgue **por escrito** que el criterio contenido en ella es diverso a los criterios
dados a conocer por las autoridades fiscales."* Quita el **agravante del 10%-20%**, no la infracción
base (**$79,130 a $124,380**, leídos literal en el Anexo 5 de la RMF 2026, DOF 28-12-2025, apartado B),
y **tiene que ir en la opinión misma**, no solo en el ToS.

Esto le aplica a Likida directamente: el CFF arts. 89 y 90 sancionan a *"quien asesore, aconseje,
**preste servicios** o participe"* en las prácticas indebidas del Anexo 3 — que son **74 criterios**,
no uno. Las tres redacciones (contrato, salida corta, pie de reporte) están en `21-guardarrailes.md` §5.

**Además, guardarraíl de vocabulario:** prohibir por validación de UI las palabras "dictamen",
"garantizo" y "seguro" sin condicional. "Dictamen" está reservado al Contador Público Registrado
(CFF art. 52); "garantizo" dispara publicidad engañosa (LFPC art. 32).

### M1.7 — Conectar `detectarAnomalias()` al dashboard

**Dónde:** `analytics.ts:84-107`. Sin consumidores hoy. Detecta el **mismo CFDI en dos viajes**, que es
el fraude #1 del sector. **Cuesta un import.**

### M1.8 — Alinear `FISCAL_LEGAL.md` dentro del repo

Dos citas del documento que un ingeniero abre primero, y que es el que está alimentando la regla
equivocada del motor:

- **§1.1** sostiene la versión dura del diésel en efectivo, con negritas propias, y la llama "lo más
  importante de todo el documento"; solo después, en §1.2, introduce el 15%. La redacción correcta es
  al revés: **regla general + excepción expresa para carga federal** (`00-RESUMEN-EJECUTIVO.md` C1).
- **§1.6** y su lista de fuentes citan la factura global como **"RMF 2.7.1.24"**. Cita muerta: en 2026
  la factura global es la **2.7.1.21**, y la 2.7.1.24 trata devolución de IVA a turistas.

Añadir además un encabezado de errata en `03-isr-facilidades.md` §8.4: "el mismo hecho —tocar camino
federal— define tanto la obligación de Carta Porte como el acceso al Título 2 de la RFA" **es falso**
y ya está dictaminado, pero sigue vivo en el texto (ver `00-ROADMAP.md`, CN-8).

### M1.9 — Decidir sobre `facturacion/` y borrar la config muerta

**~600 líneas, un 18% del código de dominio, que nunca se ejecutan.** No es dañino, pero antes del
6-ago es superficie que hay que explicar y que puede llevar la conversación a un lugar que no controlas.

| Pieza | Tamaño | Estado | Qué hacer |
|---|---|---|---|
| Módulo `facturacion/` — `comercios.ts` (230 líneas, catálogo de 10 comercios), `caducidad.ts` (74), `identificar.ts` (51) + 3 archivos de prueba | **501 líneas** | Cero consumidores fuera del propio directorio | **Sacarlo del árbol de build** hasta que se conecte al cuadre. Es trabajo bueno sobre un problema real (el reloj del plazo), pero conectarlo bien exige la máquina de estados de la Fase 1. No se enseña en la demo |
| `config.tabulador` (rendimiento, factorCarga, precioDiesel, umbralDesviacion), `config.unidades`, `config.catalogoCuentas`, `config.salida`, `config.portales` + `portalParaTicket()` | ~45 líneas de `config.ts` | Ninguno se lee en ningún lado | Borrar, o marcar `// PENDIENTE` con el nombre de la regla que la va a consumir. Hoy son **dos fuentes de verdad** para la política de gastos |
| `TipoDiferencia` `'diesel_desviacion'` | `types/cuadra.ts:64` | Se consulta en `engine.ts:246`, nunca se emite | Código muerto que sugiere una regla que no corre |
| `analytics.getStatsPorOperador()` | `analytics.ts:50-74` | Sin consumidores, y devuelve `diferencias: 0` **hardcodeado** (`analytics.ts:72`) | Borrar. Un KPI que siempre vale cero es peor que ausente: si llega al dashboard, miente |
| `repo.getPolitica()` | `repo.ts:21-33` | Sin consumidores — la política viaja por `config.politica` | Borrar la muerta |

### M1.10 — Riesgo menor pero real: el corte de observaciones

`resumen.ts:25` corta las observaciones a **6** (`obs.slice(0, 6)`) en el mensaje de WhatsApp, **sin
avisar cuántas quedaron fuera**. Con las alarmas falsas de M0.2 y M1.2 llenando la lista, las
observaciones que sí importan se pueden quedar afuera del corte. Con M0.2 y M1.2 aplicados el problema
se reduce mucho, pero conviene el "… y N más".

---

## M2 — antes del primer cliente pagado

### M2.1 — Gatear el estímulo del 50% de casetas

**Dónde:** `engine.ts:231`.

```ts
if (g.concepto === 'caseta' && (g.subTotal ?? 0) > 0) peajeAcreditable += (g.subTotal as number) * peajeFactor;
```

Un factor 0.5 sobre el SubTotal de cualquier caseta con XML. Nada más. La RMF 2026 regla 9.1.8 exige
cinco cosas y **cumple una** (el factor sobre el importe sin IVA, que sí es correcto): faltan el aviso
de marzo con inventario vehicular, la bitácora conciliada con el TAG, el pago con TAG o sistema
electrónico, y el tope de ingresos anuales menores a 300 MDP.

Y el número se imprime **en verde y en negritas** en el PDF (`pdf.ts:149`, "Estímulo de peaje 50%
(LIF 2026 Art. 20-A)") y se acumula en el dashboard (`analytics.ts:112-123`).

**Mínimo aceptable antes de un cliente que pague:** gatear detrás de `formaPago` electrónico y de una
bandera `elegibleEstimuloPeaje` por tenant, y **dejar de presentarlo en bruto** — el estímulo es
ingreso acumulable, así que el beneficio real es estímulo × (1 − tasa ISR); presentarlo bruto infla la
propuesta ~30%.

### M2.2 — El `catch → DEMO_CONFIG` es fail-open sobre dos reglas de dinero

**Dónde:** `config.ts:116-127`.

```ts
try { ...supabaseAdmin().from('tenant').select('rfc, config')... }
catch { return DEMO_CONFIG; }  // demo-safe: si la DB no está, usa defaults
```

`DEMO_CONFIG.empresa.rfc` es `'XAXX010101000'` (`config.ts:65`), y `engine.ts:58-63` **filtra
explícitamente** el RFC genérico del conjunto de RFC válidos:

```ts
const RFC_GENERICO = 'XAXX010101000';
const rfcsOk = new Set([...].filter((r) => r !== RFC_GENERICO));
```

Con `rfcsOk` vacío, la regla del receptor (`engine.ts:151`) **no corre**. Ante cualquier error de
lectura del tenant, un CFDI timbrado al RFC del chofer —o de cualquiera— pasa como válido, **sin una
sola señal en la liquidación**. Al mismo tiempo el tenant hereda los topes de demo ($4,000 diésel,
$1,500 caseta, `config.ts:66-71`) en vez de los suyos.

La intención ("demo-safe") es correcta para la sala; el comportamiento en producción no lo es.

**Arreglo:** log de error ruidoso + una diferencia `config_no_disponible` que mande la liquidación a
`revisar`. Nunca devolver defaults en silencio.

### M2.3 — Un override parcial del tenant apaga reglas fiscales en silencio

**Dónde:** `config.ts:120`: `const cfg = override ? { ...DEMO_CONFIG, ...override } : { ...DEMO_CONFIG }`.

Merge **superficial**. Si el tenant guarda en `tenant.config` un objeto `estimulos` con solo
`{ peajeFactor: 0.5 }`, el resultado tiene `viaticosTopeFiscalDiarioMxn: undefined` y
`efectivoTopeMxn: undefined`. El motor los trata con guardas `!= null` (`engine.ts:116`) y `?? 2000`
(`engine.ts:105`): la regla de viáticos **deja de correr sin decir nada**. Lo mismo con
`hidrocarburos`: un override parcial deja `h.claves` en `undefined` y revienta o apaga todo el bloque
de complemento (`engine.ts:100-101, 170-189`).

**Arreglo:** merge profundo por sección, o validación con Zod al leerla y fallo ruidoso. Media hora.

*SIN VERIFICAR:* no hay ningún tenant con `tenant.config` poblado que se haya podido inspeccionar; el
riesgo se deduce del código, no de un caso observado.

### M2.4 — Booleano `formaPagoDeXml` en `Gasto`

Sin esto no se puede saber si un veredicto de dinero se tomó sobre un dato timbrado o sobre una lectura
de papel térmico. **En cuanto haya un cliente, esa es la primera pregunta de su contador**, y hoy no
tiene respuesta posible.

### M2.5 — Aviso de privacidad simplificado para WhatsApp, con prueba de entrega

LFPDPPP art. 16 fr. II. **La carga de la prueba recae siempre en el responsable** (Reglamento art. 31).
Hoy no existe nada en el repositorio. No se puede firmar el primer cliente pagado sin esto.

Añadir también un **filtro de detección y exclusión de datos sensibles**: un ticket de farmacia revela
salud, el art. 8 párr. 2 prohíbe crear bases con datos sensibles sin justificación, y el art. 64
permite duplicar las penas de prisión.

### M2.6 — Carpeta de auditoría del sistema (RCFF art. 34)

El contribuyente debe conservar el **diseño y los diagramas del sistema** que procesa sus datos
contables y dar acceso al SAT. Si Likida no se la entrega al cliente en el onboarding, el cliente
incumple sin saberlo. Es documentación, no código, y es un argumento de cierre.

---

## M3 — Fase 1 (mejoras que necesitan modelo de datos o motor nuevo)

### M3.1 — Estímulo de IEPS por litros × cuota semanal

Persistir `litros` como **columna**, no en jsonb, y calcular el estímulo contra la tabla de cuotas
semanales del DOF, con el candado de medio de pago del 4º párrafo de la LIF 20-A-IV (monedero, tarjeta
a favor del contribuyente, cheque nominativo o transferencia — **sin** la válvula del 15% que sí existe
para ISR). Hoy el motor no distingue: si `iepsTraslado` llegara con valor, lo acreditaría sin mirar
`formaPago`.

**No es opcional.** El criterio 1/LIF/PI del Anexo 3 declara práctica fiscal indebida usar la cuota
íntegra, y su fracción II alcanza a "quien presta servicios". Ver `00-ROADMAP.md` CN-1.

### M3.2 — Partir `REVISAR` en `en_excepcion` y `sin_validar`, y agregar cola de reconsulta

La lista `REVISAR` (`engine.ts:244`) tiene **17 tipos** y mezcla cosas incomparables: `cfdi_efos`
(fraude) con `folio_verificar` (el OCR dudó) y `cfdi_pendiente`. Y `intake/sat.ts:50, 82` devuelve
`'pendiente'` ante **cualquier** timeout o caída del SAT — correcto como diseño demo-safe, pero
significa que **una tarde con el SAT lento manda todas las liquidaciones a `revisar`**. La pantalla de
excepciones se vuelve la pantalla de todo.

Y **no hay reproceso**: un `estadoSat === 'pendiente'` no se vuelve a consultar nunca; la consulta
ocurre una sola vez, dentro del OCR (`intake/ocr.ts:239-244`). No hay job, ni cola, ni columna de
reintento. El comprobante queda marcado como no validado para siempre.

**Añadir además:** tratar el código **602** del SAT como *"no se pudo confirmar"*, con reintento de
variantes del total. Se probó el servicio real y un total mal leído, un RFC mal transcrito y un UUID
inexistente devuelven **los tres el mismo 602**. Mostrarlo como "factura apócrifa" acusa en falso al
proveedor del cliente.

### M3.3 — Incluir `cfdi_pendiente` en el filtro de acreditamiento

`NO_DEDUCIBLE` (`engine.ts:218`) **no incluye** `cfdi_pendiente` ni `cfdi_efos_indeterminado`. Un CFDI
con XML parseado pero cuyo estatus el SAT nunca confirmó suma su IVA a `ivaAcreditable`
(`engine.ts:228-229`). Es acreditar sobre un comprobante que no se pudo verificar.

### M3.4 — Ampliar la deduplicación a alcance de tenant

`repo.ts:gastoExistePorHash` recibe `viajeId`: la deduplicación opera **dentro de un viaje**, no a
nivel flota. Un ticket reciclado en otro viaje, o el mismo folio con monto alterado, pasa hoy sin
marcarse — y es la huella exacta del ticket alterado o del comprobante de otra unidad.

Cambiar además la clave de `concepto|folio|monto` a `concepto|estación|folio`, y **marcar** (no
descartar) cuando el monto difiera.

### M3.5 — Los campos que no se pueden agregar después

| Campo | Dónde falta hoy | Para qué |
|---|---|---|
| `grupo_fiscal` A/B | `concepto` es un enum plano (`types/cuadra.ts:5`) | Candado estructural que impide que diésel llegue a Percepción 050 de nómina |
| `régimen` del operador, **derivado** | La tabla `operador` solo tiene `nombre, telefono, numero_empleado, activo` (migración `0001_init.sql`) | Se deriva de propiedad de la unidad + propiedad del permiso. **Nunca** se captura como selección: LFT art. 256 hace la relación de trabajo por ley y el pacto en contrario "no produce ningún efecto legal". Si el pacto dice "prestador de servicios" y conduce unidad de la flota, el sistema **advierte** |
| `base_asignacion` | No existe | Faja de 50 km (LISR 28-V / RLISR 57) |
| `salario` del operador | No existe | Los dos topes del art. 110 fr. I de la LFT |
| Tabla `unidad` real | Vive en `tenant.config` jsonb por placa (`UnidadConfig`), no como entidad ligada a propietario ni permiso | Capacidad de tanque, rendimiento esperado, TAG y monedero asignados. Sin ella, toda la detección de ordeña queda en versión burda indefinidamente |
| `hora` estructurada | Se descarta al normalizar la fecha (`fecha.ts` solo guarda `YYYY-MM-DD`) | Habilita "dos cargas en intervalo corto", la señal más citada en la literatura de fraude de tarjetas de combustible |

### M3.6 — `estado_verificacion` en las citas del código

`config.ts:87` ya tiene una cita frágil **en producción**: `vigenteDesde: '2026-04-24'` con el
comentario "RMF 2.7.1.8", dato que dos investigaciones independientes marcan como **SIN CONFIRMAR** en
fuente del SAT. El código no tiene ningún campo de estado de verificación.

*Nota:* la cita de `engine.ts:181` a la **regla 2.7.1.48** sí se sostiene — su texto reformado el
09-jul-2026 gobierna a "los contribuyentes que enajenen gasolinas y diésel a que hace referencia la
regla 2.6.1.1 fr. II". Lo que no se sostiene es la **fecha**. Ver `00-ROADMAP.md` CN-4.

**Además, quitar del validador el filtro "¿el emisor está en 2.6.1.2?"**: la reforma movió la cláusula
relativa y el sujeto obligado se amplía a cualquiera que enajene esos combustibles. Un validador
construido sobre el texto de diciembre deja pasar comprobantes que hoy deben traer HidroYPetro.

### M3.7 — Campo `jerarquia` en `CuadraConfig`

Separar `estimulos` / `hidrocarburos` (ley y RMF) de `portales` (**política de un tercero, cero fuerza
legal**). Hoy los tres viven en el mismo tipo sin ninguna señal de jerarquía, y esa es la causa raíz de
que una promesa de producto pueda tratar un plazo de portal como si fuera plazo fiscal.

Fundamento: CFF art. 33 fr. I inciso g) + tesis SCJN P.LV/2004 — la RMF no puede exceder ni crear
obligaciones más allá de la ley. La regla **LEY ≠ FACILIDAD ≠ POLÍTICA INTERNA** deja de ser estilo y
se vuelve un campo obligatorio del esquema.

### M3.8 — `guardiaFundamento()`, gemela de `guardiaCifras()`

`cuadre/guardia.ts:23-48` ya implementa el patrón correcto para cifras: **fail-closed**, si no puede
recalcular el cuadre no manda números; reemplaza lo que el modelo narra por el cálculo determinístico
del motor. Es código, no prompt.

Extenderlo a fundamento: el modelo solo puede referenciar un `norma_id` devuelto por una tool **en ese
turno**, y el servidor sustituye el texto real. **Nunca teclea un artículo de memoria.** No hay que
inventar el mecanismo desde cero: ya existe en el repo para un problema gemelo.

---

## Lo que NO hay que tocar

Cada una de estas decisiones tiene medición encima, no opinión. Cualquier refactor ahí es regresión
garantizada.

| Pieza | Evidencia | Por qué no se toca |
|---|---|---|
| Lectura de códigos con zxing y protocolo de dos fotos | `intake/cfdi.ts:227-267`, `intake/ocr.ts:129-142` | Medición de campo: jsQR falla a 1600/1200/900 px; 10 variantes de preprocesado fallaron; el acercamiento entra en ~100 ms. Es la razón por la que el UUID no pasa por visión |
| Folio impreso vs. folio del QR | `intake/cfdi.ts:127-155`, `repo.ts:169-172` | Comprobado contra el papel: 31 chars impresos vs. 30 en el QR. Son dos cadenas distintas. Pisar una con otra rompe el timbrado en el portal |
| Dígito verificador del RFC | `intake/cfdi.ts:53-74` | Atrapa el caso real (PER/PEX/PTE donde decía PEC) antes de consultar al SAT por un contribuyente inexistente, con la excepción correcta para los RFC genéricos |
| Mapeo conservador de EFOS | `intake/sat.ts:61-78` | Nunca declara fraude por descarte: código desconocido → `null` + bandeja, no `true`. Un falso positivo de EFOS sobre un proveedor legítimo es un incidente con el cliente |
| Guardia determinística de cifras | `cuadre/guardia.ts:23-48` | Fail-closed. Es la defensa que hace creíble el producto frente a un contralor |
| Emparejamiento que se niega a adivinar | `intake/emparejar.ts:24-33, 56-59` | Sin candidato único no pega nada. Colgarle a un ticket el folio de otro no deja hueco visible: deja un folio equivocado que la oficina teclea |
| Duplicados excluidos del total, no solo reportados | `cuadre/engine.ts:69-90` | Es la diferencia entre reportar y cuadrar |
| Montos ≤ 0 fuera del total y a revisión | `cuadre/engine.ts:87-99` | Una nota de crédito mal leída no reduce el comprobado ni sesga la diferencia contra el operador |
| Cierre atómico e idempotente | `repo.ts:285-299` + migración `0013` | Una sola función plpgsql: si falla el update del viaje, la liquidación hace rollback |
| RLS deny-all y revocación de RPC a `public` | migraciones `0012`, `0016` | Los dos huecos correctos: `wa_mensaje_procesado` sin RLS permitía envenenar la idempotencia; las funciones de mutex eran ejecutables por anónimo |
| Distinción de motivo de fallo del OCR | `intake/ocr.ts:87`, `processor.ts:144-151` | No le echa la culpa al chofer de un bug propio. Es producto, no cosmética |

---

## Deuda de pruebas

**No se corrieron `npm test` ni `npx tsc --noEmit`** en la auditoría; todo salió de lectura de código.
Hay **23 archivos de prueba** y no se auditó su cobertura sobre las reglas que este documento declara
incorrectas.

**Es probable que `engine.test.ts` fije el comportamiento equivocado de `combustible_efectivo`**, y
habrá que cambiar la prueba junto con la regla. Presupuestar medio día para eso en la Fase 0.

Pruebas que **faltan** y que valen más que las que hay:

1. Que un veredicto no se pueda serializar sin al menos un `norma_id` válido.
2. Que `guardiaFundamento()` bloquee una respuesta con "artículo 27" sin norma_id emitido en ese turno.
3. Inyección de prompt vía **texto oculto en la foto del ticket** contra el pipeline real de `intake/`.
   Es un vector sobre código que ya existe, no una hipótesis.
4. Que un gasto sin UUID y sin folio, subido dos veces, produzca un solo registro.
5. Que un operador con unidad de la flota y bandera "prestador de servicios" produzca una advertencia,
   no un régimen `tercero`.

---

## Módulos que no se auditaron

Fuera del alcance de `40-auditoria-codigo.md`, y con al menos un riesgo conocido:

- **`agentes/prompts.ts`.** La línea 19 afirma que los CFDI *"ya se validan solas… se consulta el
  estatus ante el SAT automáticamente"*. Hay que revisarla contra la tabla de promesas prohibidas del
  resumen ejecutivo: es exactamente el tipo de frase que un contador desarma en una pregunta.
- **Webhook de WhatsApp, dashboard y páginas.** Sin auditar.
- **Cobertura de las 23 pruebas existentes.** Sin auditar.
