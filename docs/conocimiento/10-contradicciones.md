# Contradicciones entre los documentos de la ola 1

> Ola 2 — 27-jul-2026. Construido sobre la ola 1.
> Objetivo: cazar afirmaciones incompatibles entre los once documentos, ir a la fuente primaria y dictaminar.
> **No sustituye al `00-RESUMEN-EJECUTIVO.md`.** Ese ya resolvió seis conflictos (C1 a C6). Este documento los da por buenos y busca lo que quedó abajo.

---

## Resumen para el fundador

Encontré doce choques. Nueve los pude dictaminar leyendo la fuente; tres no.

Lo más importante es que **el pendiente número uno de todo el paquete ya estaba resuelto adentro del paquete y nadie lo vio**. El resumen ejecutivo dice que no existe un criterio del SAT que confirme que el estímulo del diésel se calcula con la cuota semanal disminuida. Sí existe: es el criterio 1/LIF/PI del Anexo 3, publicado en el DOF el 9 de enero de 2026. Lo leí completo. Dice exactamente eso, y además dice que calcularlo con la cuota entera es práctica indebida — de quien lo hace **y de quien le presta el servicio**. O sea que ese criterio no es sólo la respuesta a la duda: es una obligación que le cae encima a Likida si el motor calcula mal.

Lo segundo es un agujero de fecha. Cuatro de los once documentos se cerraron sin leer la Primera Resolución de Modificaciones a la Miscelánea, publicada el 9 de julio de 2026. Uno de ellos incluso afirma que esa resolución "sólo modificó dos reglas". Modificó veintiocho, agregó cinco y derogó una. Dos de las agregadas tocan directamente el cálculo del estímulo del diésel y la factura de las gasolineras. Hay que releer esa resolución antes de la demo, no después.

Lo tercero es del mismo tipo que el error del diésel en efectivo que ya estaba detectado: **una regla escrita como absoluta que en realidad tiene excepción, y la excepción vale dinero.** Un documento manda rechazar todo comprobante que no vaya a nombre de la flota. El reglamento del ISR dice, con esas palabras, que los viáticos de un trabajador subordinado **pueden** ir a nombre del trabajador. Si el motor rechaza esos comprobantes, le está tirando deducciones legítimas al cliente.

El resto son cifras que no cuadran entre documentos, un artículo mal citado que sigue vivo en tres lugares, y dos cosas distintas que en el paquete se llaman igual: "bitácora". Una es fiscal y sirve para el estímulo de casetas; la otra es de tránsito, lleva diez campos y dos firmas, y su falta se multa. Si el material comercial dice "bitácora" sin apellido, prometemos una y entregamos otra.

---

## 1. El criterio que cierra el pendiente bloqueante número uno

### Las dos afirmaciones

**`04-iva-ieps-estimulos.md`, SIN VERIFICAR #1** (y el resumen ejecutivo lo adoptó como Pendiente bloqueante #1):

> "Que el SAT tenga un criterio publicado que diga expresamente que se acredita la 'cuota disminuida' y no la cuota íntegra. […] **no localicé un criterio normativo ni una regla de la RMF que lo enuncie con esas palabras**. Las afirmaciones categóricas al respecto provienen de blogs de despachos. **Antes de escribirlo en material comercial, que lo confirme un fiscalista con cédula.**"

**`03-isr-facilidades.md`, §6.1:**

> "**Trampa verificada — criterio no vinculativo 1/LIF/PI** (Anexo 3 RMF 2026, DOF 09-ene-2026): es **práctica fiscal indebida** determinar el estímulo con las **cuotas actualizadas de la LIEPS** en lugar de las **cuotas disminuidas conforme a las que efectivamente se causó el IEPS**."

### Dictamen: gana `03`. El criterio existe y es más fuerte de lo que `03` dijo

Descargué el Anexo 3 de la RMF 2026 (DOF 09-ene-2026) y extraje el texto. El criterio está en el apartado **VI. Criterios de la LIF**. Título literal:

> "**1/LIF/PI** Estímulo fiscal a los contribuyentes que importen o adquieran diésel o biodiésel y sus mezclas para uso automotriz en vehículos que se destinen exclusivamente al transporte. **Su monto debe determinarse considerando el IEPS que efectivamente se haya causado.**"

Y el razonamiento, textual:

> "…si los contribuyentes que enajenaron en territorio nacional diésel o biodiesel y sus mezclas, causaron el IEPS de conformidad con el artículo Único del 'Decreto por el que se modifica el diverso por el que se establecen estímulos fiscales en materia del impuesto especial sobre producción y servicios aplicables a los combustibles que se indican, publicado el 27 de diciembre de 2016', publicado en el DOF el 28 de diciembre de 2018, **es decir, aplicando cuotas disminuidas, estas son las que conforme al citado Decreto deben considerarse para la aplicación del estímulo** establecido en el artículo 20, apartado A, fracción IV, primer párrafo de la LIF."

> "Por lo anterior, se considera que realizan una práctica fiscal indebida:
> **I.** Los contribuyentes que determinen el monto del estímulo […] considerando las cuotas actualizadas establecidas en la Ley del IEPS en lugar de aquéllas conforme a las que el IEPS se haya causado […]
> **II. Quien asesore, aconseje, preste servicios o participe en la realización o la implementación de la práctica anterior.**"

Origen del criterio: RMF 2020, primer antecedente Anexo 3 publicado el 9 de enero de 2020. **No es nuevo: lleva seis años publicado.**

Verifiqué además que la **Primera Modificación al Anexo 3 (DOF 17-jul-2026)** no lo tocó: el único criterio que reformó es el 43/ISR/PI. El 1/LIF/PI sigue vigente con ese texto.

### Qué cambia

1. **El pendiente bloqueante #1 del resumen ejecutivo está cerrado.** No hace falta la consulta al fiscalista para esto. Sí hace falta citar bien el criterio.
2. **La dirección del riesgo se invierte.** El resumen ejecutivo temía que Likida estuviera *subestimando* el estímulo hasta 3.5x. La realidad es la contraria: quien usa la cuota entera lo *sobreestima*, y eso es la práctica indebida tipificada.
3. **La fracción II es sobre Likida.** Un motor que calcule el estímulo con $7.3634 constantes no comete un bug: implementa una práctica fiscal indebida en la que Likida "presta servicios". Esto refuerza, con un fundamento concreto y publicado, la leyenda de los arts. 89 y 90 del CFF que el resumen ejecutivo ya manda redactar.
4. **El servicio de cuotas semanales del DOF deja de ser una decisión de ingeniería y pasa a ser un requisito de cumplimiento.** Ya no es "la pieza de mayor valor técnico"; es la pieza sin la cual el producto no se puede vender.

---

## 2. Cuatro documentos se cerraron sin leer la Primera Resolución de Modificaciones

### Las tres afirmaciones

**`09-liquidacion.md`, §0:**

> "**Verificado:** la Primera Resolución de Modificaciones a la RMF 2026 (DOF 09-07-2026) **sólo modificó las reglas 2.7.1.48 y 2.7.5.8**. No tocó ninguna de las reglas que este documento cita […] Se comprobó extrayendo el texto completo y buscando cada número de regla."

**`01-cfdi-cff.md`, §0:**

> "**Verificado:** la Primera Resolución de Modificaciones a la RMF 2026 (DOF 09-07-2026) **no tocó** ninguna de las reglas de CFDI que se citan aquí […] La única regla del capítulo 2.7.1 que reformó fue la 2.7.1.48."

**`02-carta-porte.md`, §2:**

> "La Primera Resolución de Modificaciones a la RMF 2026 (DOF 9-jul-2026) **NO tocó la Sección 2.7.7.** Leí el resolutivo PRIMERO completo: reforma el Glosario y las reglas 2.1.6., 2.4.1., 2.7.1.48., 2.7.3.1.–2.7.3.9., 2.7.4.1., 2.7.5.8., 2.10.10., 2.11.3., 2.14.3., 2.14.9., 2.14.11., 3.15.14., 3.16.11., 5.2.7., 5.2.8., 5.2.48., 9.4.6., 10.16., 11.7.1., 11.9.13., 12.1.2., 12.1.9., 12.1.11.; adiciona 3.5.23., 9.1.23., 9.1.24., 11.7.3. y el Capítulo 11.18.; deroga 2.12.4."

### Dictamen: gana `02`, palabra por palabra. `09` es falso

Descargué el PDF de la Primera Resolución y transcribí el resolutivo PRIMERO. Es idéntico a la lista de `02`, incluidos los párrafos específicos de cada regla. `01` también es correcto, pero su afirmación está acotada al capítulo 2.7.1 y no autoriza a concluir nada sobre el resto.

La afirmación de `09` —"sólo modificó dos reglas"— es incorrecta y peligrosa porque está marcada **"Verificado"** y porque de ella se desprende, en ese documento, que nada más cambió.

**Además, el mismo instrumento reformó siete anexos.** El encabezado del documento dice: *"PRIMERA RESOLUCIÓN DE MODIFICACIONES A LA RESOLUCIÓN MISCELÁNEA FISCAL PARA 2026 **Y ANEXOS 1, 2, 3, 9, 14, 15, 21, 22 Y 29**"*, publicados en el DOF el 17 de julio de 2026. Eso alcanza al Anexo 3 (criterios, base de `03`), al Anexo 29 (L_CNE, base de `05`) y a los Anexos 21 y 22 (controles volumétricos, base de `05`).

**Qué revisé de esos anexos y qué encontré:**

| Anexo | ¿Afecta a la ola 1? | Qué verifiqué |
|---|---|---|
| **3** (criterios) | **No** | La Primera Modificación (DOF 17-jul-2026) sólo reforma el criterio **43/ISR/PI**. 1/LIF/PI, 6/ISR/PI y los cuatro criterios del CFF quedan intactos |
| **29** (L_CNE y validaciones del PAC) | **No** | La Primera Modificación sólo toca la sección **VI.1 numeral 10 "TipoDeComprobante"** (omisión de `CondicionesDePago`, `Descuento`, `Impuestos`, `FormaPago`/`MetodoPago` según el tipo, y exigencia de complemento de Nómina y de Pagos). **La sección III.3 (L_CNE) y el numeral 9 (`ClaveProdServ` → `HidroYPetro`) no se modificaron.** Todo el §3 de `05-hidrocarburos.md` sigue en pie |
| **21 y 22** (controles volumétricos) | **Sin revisar** | Ver SIN VERIFICAR |
| **1, 2, 9, 14, 15** | **Sin revisar** | El Anexo 2 contiene la ficha 46/CFF (`01`) y la 65/ISR (`03`). `01` verificó específicamente que la ficha 46/CFF no cambió con la modificación del 17-jul-2026 |

---

## 3. La regla 11.7.3 sí existe desde el 9 de julio de 2026, y cambia el número del estímulo

### Las dos afirmaciones

**`04-iva-ieps-estimulos.md`, §1:**

> "⚠️ **Trampa documentada.** Varios blogs afirman que el estímulo de diésel 'se instrumenta en la regla 11.7.3 de la RMF 2026'. **Es falso.** Leí el índice y el cuerpo de la RMF 2026 (DOF 28-12-2025): el Capítulo 11.7 es 'Del Decreto por el que se establecen estímulos fiscales en materia del IEPS…' […] que es el estímulo **a quien enajena** combustible, no al transportista."

**`02-carta-porte.md`, §2:** "…**adiciona** 3.5.23., 9.1.23., 9.1.24., **11.7.3.** y el Capítulo 11.18."

### Dictamen: la conclusión de `04` sobrevive; su premisa caducó, y lo que la sustituye importa más

La regla 11.7.3 **no existía** cuando `04` leyó la RMF (DOF 28-12-2025). **Existe desde el 9 de julio de 2026.** La leí. Se titula **"Cálculo del precio base del diésel"** y dice:

> "**11.7.3.** Para los efectos del artículo Primero del Decreto IEPS combustibles y el artículo Único, fracción I del Acuerdo por el que se da a conocer la metodología para determinar el estímulo fiscal en materia del impuesto especial sobre producción y servicios aplicable a los combustibles que se indican, publicado en el DOF el 11 de marzo de 2019 y sus posteriores modificaciones, **el precio base del diésel que se determine conforme al citado Acuerdo, se disminuirá conforme a lo siguiente:**
> I. Del 1 al 16 de abril se le restará la cantidad de **0.28 pesos por litro**.
> II. El 17 de abril […] **0.60**. III. El 23 de abril […] **0.60**. IV. El 29 de abril […] **1.03**. V. El 7 de mayo […] **1.03**. VI. El 14 de mayo […] **1.04**. VII. El 21 de mayo […] **1.04**. VIII. El 28 de mayo […] **0.99**. IX. El 4 de junio […] **0.99**. X. El 11 de junio […] **0.98**. XI. El 18 de junio […] **0.96**. XII. El 25 de junio […] **0.95**. XIII. El 02 de julio […] **0.93 pesos por litro**."

Y el **Transitorio Sexto** de la misma resolución: *"Lo establecido en la regla 11.7.3. será aplicable **a partir del 1 de abril de 2026**."* Es decir, **retroactiva tres meses.**

**Lo que esto significa para el producto.** La regla 11.7.3 no fija la cuota acreditable del transportista —`04` tiene razón en que ésa es la fracción IV del artículo 20 de la LIF y las reglas 9.1.6 a 9.1.8—, pero **modifica el precio base con el que la SHCP calcula el porcentaje y el monto del estímulo semanal**, que es justo el insumo del acuerdo de los viernes que `04` propone ingerir. Traducido:

- El servicio de cuotas semanales no puede limitarse a leer el acuerdo del DOF. Tiene que llevar también esta capa de ajuste por fecha.
- Cualquier recálculo del estímulo entre el **1 de abril y el 2 de julio de 2026** hecho sólo con los acuerdos semanales puede estar mal, porque la regla llegó después y aplica hacia atrás.
- Las trece fechas de la regla no son semanales ni regulares (hay saltos de 6, 7 y 9 días). Programarlo como "una entrada por semana" produce huecos.

**Y las otras dos reglas adicionadas al Título 9 no aplican.** Las revisé para descartarlas: la **9.1.23** es sobre CFDI de retención de intereses de instituciones de financiamiento colectivo, y la **9.1.24** sobre no retención de ISR e IVA a líneas aéreas en plataformas tecnológicas. Ninguna toca al autotransporte. La **9.4.6** reformada es del capítulo de la Competencia (mundial de futbol). Descartadas.

---

## 4. La regla 2.7.1.48 se reformó, y el "error de remisión" que `05` dedujo era real

### La afirmación

**`05-hidrocarburos.md`, §1.3, marcado como interpretación propia (su SIN VERIFICAR #12):**

> "**Rareza de redacción que conviene conocer:** la regla remite a 'la regla 2.6.1.1., fracción II'. Pero 2.6.1.1 fracción II **no define contribuyentes, define mercancías** […] Lo que probablemente se quiso citar es 2.6.1.**2**, que sí lista sujetos."

Texto original que `05` transcribió de la RMF (DOF 28-12-2025):

> "…**los contribuyentes a que hace referencia la regla 2.6.1.1., fracción II, que enajenen gasolinas y diésel**, deben incorporar en el CFDI que se emita, el 'Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos'…"

### Dictamen: `05` leyó bien el problema. El SAT lo corrigió el 9 de julio de 2026, pero al revés de como `05` supuso

El resolutivo PRIMERO reforma el **primer párrafo** de la 2.7.1.48. Texto vigente:

> "**2.7.1.48.** Para los efectos de los artículos 29 y 29-A del CFF, **los contribuyentes que enajenen gasolinas y diésel a que hace referencia la regla 2.6.1.1., fracción II**, deben incorporar en el CFDI que se emita, el 'Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos', que al efecto publique el SAT en su Portal."

El SAT **no** cambió la remisión a 2.6.1.2 como `05` supuso. **Movió la cláusula**: ahora "a que hace referencia la regla 2.6.1.1., fracción II" califica a las **gasolinas y diésel**, no a los contribuyentes. Confirma la lectura de fondo de `05` (la 2.6.1.1 fr. II define mercancías) y resuelve el problema por la vía contraria.

**Consecuencia de producto, y es de ampliación, no de detalle:** el sujeto obligado ya no es el subconjunto de contribuyentes de una lista, sino **cualquiera que enajene gasolinas o diésel**. La expectativa correcta es que **todo** CFDI de combustible traiga `HidroYPetro`, sin filtrar por tipo de emisor. Un validador construido sobre el texto de diciembre, que primero pregunte "¿este emisor está en 2.6.1.2?", va a dejar pasar comprobantes que hoy deben traer el complemento.

El segundo párrafo de la regla (la obligación de registrar las claves `15101505` / `15101514` / `15101515`) no se reformó y sigue igual.

---

## 5. "Rechaza todo CFDI que no vaya a nombre de la flota" es falso, y cuesta dinero

Esta es la contradicción del tipo que el encargo llama la más cara: un documento la trata como regla dura y otro trae la excepción escrita en reglamento.

### Las dos afirmaciones

**`03-isr-facilidades.md`, §A.8 "Validaciones de la regla 2.7.1.12 (reembolsos)":**

> "- **RFC receptor del CFDI = RFC de la flota → si no, rechazo.**"

Y en §8.1: *"**La factura debe llevar el RFC de la flota**, no el del operador. Likida debe validar el RFC receptor de cada CFDI capturado y **rechazar los que estén a nombre del operador**."*

**`09-liquidacion.md`, resumen #5:**

> "**El comprobante del operador empleado sí puede ir a su nombre.** El RLISR 57, tercer párrafo, lo dice literal: si el beneficiario es trabajador subordinado, los CFDI *pueden* expedirse a nombre de esa persona. Esto cambia la validación de Likida: **un ticket con el RFC del operador no es automáticamente un error.**"

### Dictamen: gana `09`. Verificado en el texto del reglamento

**Reglamento de la Ley del ISR, artículo 57, tercer párrafo** (última reforma DOF 06-05-2016), texto literal descargado de la Cámara de Diputados:

> "Cuando los viáticos y gastos a que se refiere este artículo, beneficien a personas que presten al contribuyente **servicios profesionales**, los comprobantes fiscales **deberán ser expedidos a nombre del propio contribuyente**. Si benefician a personas que le prestan **servicios personales subordinados**, los comprobantes fiscales **podrán ser expedidos a nombre de dichas personas**, en cuyo caso y para efectos del artículo 18, fracción VIII de la Ley, se tendrá por cumplido el requisito de respaldar dichos gastos con el comprobante fiscal a nombre de aquél por cuenta de quién se efectuó el gasto."

El origen del error de `03` es que aplicó a todo el universo de gastos una regla que sólo gobierna un régimen: la **RMF 2.7.1.12** trata las **erogaciones por cuenta de terceros**, y ahí sí la fracción I inciso a) exige el RFC del contribuyente. Pero un operador **subordinado** que come en carretera no está bajo esa regla: está bajo el artículo 28 fracción V de la LISR y el 57 de su reglamento.

### La regla correcta, con las cuatro ramas que el motor necesita

| Caso | ¿A nombre de quién debe ir el CFDI? | Fundamento |
|---|---|---|
| **Grupo A** — combustible, casetas, talacha, refacciones, maniobras, pensión | **De la flota, siempre.** El pago tiene que salir de cuentas del contribuyente | LISR 27 fr. III, primero y segundo párrafos |
| **Grupo B** — viáticos de una persona que presta **servicios profesionales** | **De la flota** | RLISR 57, tercer párrafo, primera oración |
| **Grupo B** — viáticos de un **trabajador subordinado** | **Puede ir a nombre del operador.** No es error | RLISR 57, tercer párrafo, segunda oración |
| **Cualquiera** — erogación por cuenta de un **tercero** (hombre-camión, permisionario, despachador externo) | **De la flota** | RMF 2026, 2.7.1.12, fr. I inciso a) y fr. II inciso c) |

Nótese que **ninguna de las cuatro ramas admite el RFC genérico `XAXX010101000`** — ahí `01-cfdi-cff.md` §5.3 tiene razón sin matices: falta el requisito del 29-A fr. IV y el comprobante no deduce ni acredita.

### La capa estatal que ningún documento cruzó

`06-estatal.md` §3 documenta que **Querétaro** condiciona la exención del ISN a *"Los viáticos, **cuando la documentación comprobatoria se encuentre otorgada a favor de quien haga los pagos**"* (art. 72 fr. VII, Ley de Hacienda del Estado de Querétaro). Es decir:

> Un CFDI de comida a nombre del operador subordinado es **deducible en ISR** (RLISR 57) y **pierde la exención estatal de ISN en Querétaro** (art. 72 fr. VII LH Qro).

Eso no es una contradicción entre documentos: es una interacción que nadie escribió, y que convierte la regla en un veredicto por estado, no en un booleano. Encaja exactamente con la arquitectura de veredictos separados que el resumen ejecutivo ya definió.

---

## 6. "Bitácora" son dos documentos distintos con el mismo nombre

No hay hechos contradictorios aquí. Hay una colisión de vocabulario con consecuencia contractual, y el resumen ejecutivo la arrastra.

| | **Bitácora fiscal de casetas** | **Bitácora de horas de servicio** |
|---|---|---|
| Dónde vive | `03` §6.2, `04` §4.3 | `07` §8.2 |
| Fundamento | **RMF 2026, regla 9.1.8, fr. II** | **RTCPJF art. 83** + **NOM-087-SCT-2-2017**, num. 4.3 y 8.2.1 |
| Qué exige | Origen, destino y ruta, **que coincida con el estado de cuenta del TAG** o del sistema electrónico de pago | **Diez campos** (permisionario y domicilio, tipo de servicio, marca/modelo/placas, fecha, nombre del conductor, número y vigencia de licencia, origen/destino/ruta, cinco tipos de hora, excepciones) **más las firmas del conductor y del permisionario** |
| Para qué sirve | Sostener el estímulo del 50% del peaje | Acreditar cumplimiento de tiempos de conducción ante la Guardia Nacional |
| Qué pasa si falta | Se pierde el estímulo (indefendible en revisión) | Multa de **20 a 30 cuotas diarias** = **$2,346.20 a $3,519.30** con UMA 2026. **La omisión de un solo dato se sanciona igual que la falta total** |
| Conservación | No la fija la regla | **Dos años** (NOM-087 num. 8.5) |
| ¿La puede generar Likida sola? | **Sí.** Es un derivado de la liquidación | **No.** Puede pre-llenarla; la firma el permisionario |

El resumen ejecutivo prohíbe, con razón, prometer que *"nuestra bitácora sustituye la bitácora legal de horas de servicio"*, y en el mismo documento vende *"el exportador de bitácora conciliada"* como el gancho comercial más fuerte del paquete. Las dos frases son correctas y hablan de cosas distintas. Un vendedor que diga "bitácora" a secas promete la que no puede entregar.

**Nombres que hay que fijar antes de la demo:** `bitácora fiscal de peaje (RMF 9.1.8-II)` y `bitácora de horas de servicio (RTCPJF 83 / NOM-087)`. En producto, en contrato y en la landing.

Detalle operativo que sale del cruce y que sirve: la NOM-087 num. 3.5 dice que **cargar combustible no cuenta como pausa**. Un ticket de gasolinera con hora, que Likida ya tiene, **no** acredita descanso — pero sí acredita que el conductor estaba trabajando a esa hora. Es evidencia en contra, no a favor. Conviene saberlo antes de exportar nada.

---

## 7. El argumento de venta del ISN está sobre-extendido

### Las dos piezas

**`06-estatal.md`, §10:**

> "Un peso de viático que hoy va por el 8% ciego cuesta 16 centavos de ISR definitivo **y sigue expuesto** a 3 centavos de ISN […] El 8% 'ciego' resuelve el ISR de gastos sin comprobante, pero **no resuelve el ISN**."

**`03-isr-facilidades.md`, §4.3 "Qué SÍ cabe en el 8%":**

> "Propinas y 'apoyos' en patios y andenes. Maniobras de carga/descarga pagadas en efectivo a cuadrillas informales. Cuotas y pensiones de estacionamiento sin factura. Lavado de unidad, vulcanizadora de camino, ayudante eventual. Báscula y pesajes sin comprobante. Pequeñas reparaciones de emergencia en carretera. Casetas pagadas en efectivo sin comprobante."

**`09-liquidacion.md`, §2.3:** esos conceptos son **Grupo A — costos de la unidad**, y *"el diésel, las casetas y la talacha del camión **no son viáticos**"*.

### Dictamen: el argumento de `06` es válido, pero sólo para un subconjunto que `03` y `09` dicen que casi no existe

El ISN grava **erogaciones por remuneraciones al trabajo personal**. Los siete conceptos que `03` lista como el contenido típico del 8% son, en la taxonomía de `09`, Grupo A: gastos de la unidad, no remuneraciones a una persona. **Sobre esos, el ISN nunca entró al objeto del impuesto**, con o sin comprobante, y el argumento de `06` no aplica.

El argumento de `06` sólo muerde cuando la flota mete al 8% **viáticos de la persona** (Grupo B): comida, hospedaje, transporte del operador sin comprobante. Eso sí es potencialmente remuneración a los ojos de la autoridad estatal, y ahí la exención por referencia a la LISR se debilita.

`06` lo marca como *"una hipótesis de riesgo bien fundada, no un criterio publicado"* y lo repite en su SIN VERIFICAR #13, lo cual es honesto. Pero el resumen ejecutivo lo levantó como hallazgo (*"el viático mal comprobado además de perder ISR e IVA paga ISN"*) sin el calificador de grupo fiscal.

**Cómo queda la frase para que se sostenga frente al fiscalista de un contralor:**

> "Un **viático de la persona** que se deduce por el 8% ciego paga 16% de ISR definitivo y, además, es discutible como exento de ISN, porque las leyes estatales condicionan esa exención a que esté 'debidamente comprobado en los mismos términos que exige la LISR'. Los **gastos de la unidad** que van por el 8% —maniobras, báscula, talacha— no tienen ese problema: no son remuneración al trabajo personal y nunca entraron al objeto del ISN."

Esa versión es más chica y es defendible. La versión general se cae con una sola pregunta.

---

## 8. La equivalencia "tocar camino federal define Carta Porte y define la RFA" es falsa

### Las dos afirmaciones

**`03-isr-facilidades.md`, §8.4:**

> "*(Este tema tiene su propio documento; aquí sólo queda anotada la conexión: **el mismo hecho —tocar camino federal— define tanto la obligación de Carta Porte como el acceso al Título 2 de la RFA**.)*"

**`02-carta-porte.md`, §5.2:** la exención del radio de 30 km tiene **tres condiciones acumulativas**, y una es del vehículo:

> "1. **Vehículo:** no exceder pesos y dimensiones de un camión **C2** conforme a la **NOM-012-SCT-2-2017**. Un C2 es un camión unitario de 2 ejes / 6 llantas. Cualquier configuración mayor (C3, T3S2, T3S2R4, etc.) queda fuera."

### Dictamen: gana `02`. Son dos pruebas distintas y no se pueden usar como una

La regla **2.7.7.2.8** de la RMF 2026 crea una **ficción fiscal acotada**: *"se entenderá que los contribuyentes […] **no transitan por tramos de jurisdicción federal**"*, y esa ficción es *"para los efectos de las reglas 2.7.7.1.3., 2.7.7.1.4., 2.7.7.2.1., 2.7.7.2.2., 2.7.7.2.3. y 2.7.7.2.5."* — todas de la Sección 2.7.7, todas de Carta Porte. **No alcanza a la RFA ni a la LISR.**

El acceso al Título 2 de la RFA se mide con otra vara, la que `03` mismo documenta en su §2: 90% de los ingresos (LISR 72), servicio **a terceros** en caminos de jurisdicción federal con permiso de la SICT (LCPAF arts. 2 fr. VIII, 33 y 50), y régimen de Coordinados o PF actividad empresarial.

Un transportista con un C2 que hace reparto dentro de un radio de 30 km está **exento de Carta Porte** y sigue siendo, para todos los demás efectos, **carga federal** con derecho al 8%, al 15% y a los estímulos —si cumple las otras tres pruebas. La equivalencia de `03` invita a la conclusión contraria y, escrita como está en un documento de ISR, es exactamente el tipo de atajo que se convierte en regla de código.

**Regla de producto:** `necesita_carta_porte` y `elegible_rfa_titulo_2` son dos banderas independientes que se calculan con insumos distintos. Compartir el campo "pisa federal" entre las dos es un bug de diseño.

---

## 9. Cifras que no cuadran

### 9.1 Permisos de autoconsumo de la CNE: 346 o 363

`05-hidrocarburos.md` da tres números para lo mismo:

- **§4.3:** *"Sólo **346** permisos de 'Expendio en Autoconsumo' (+**17** con nomenclatura nueva `CNE/PL/…/DES/AUT/…`)."*
- **§4.5**, tabla de nomenclaturas: `PL/{n}/EXP/ESA/{año}` = **329** registros; `CNE/PL/{n}/DES/AUT/{año}` = **17** registros.
- **§5.3:** *"hay sólo **~363** permisos de autoconsumo en todo el país (§4.3)"*.

**Dictamen: son 346.** La suma de la tabla de §4.5 es 329 + 17 = 346, que coincide con el conteo por la columna `tipo_permiso`. El "+17" de §4.3 y el 363 de §5.3 **doble-cuentan** los mismos 17 registros de nomenclatura nueva. No cambia la conclusión de negocio (siguen siendo poquísimos), pero es la clase de número que se copia a una lámina y luego alguien lo suma.

### 9.2 El padrón de la CNE: 17,840 registros, 17,385 vigentes

- **`05` resumen #6:** *"un CSV mensual de permisos vigentes: **17,840 permisos** al corte de febrero de 2026."*
- **`05` §4.4, defecto 3:** *"Se llama 'vigentes' pero incluye no operativos. **455 de los 17,840 registros no están en estatus 'Vigente'** sino en 'Por iniciar operaciones', 'En construcción' o 'Por iniciar construcción'. **Filtrar por el nombre del archivo es un error**; hay que filtrar por la columna `estatus`."*

**Dictamen:** el resumen del propio documento comete el error que su §4.4 advierte. Permisos **vigentes**: **17,385**. Registros del archivo: 17,840. El código tiene que filtrar por `estatus == "Vigente"`; el material comercial tiene que decir 17,385.

### 9.3 Tamaño de la flota chica: 95%/<30 vs 97%/<20 — aritméticamente incompatibles

- **`08-competencia.md`** (resumen y §7): *"En México, **95% de las más de 200,000 empresas de autotransporte tiene menos de 30 camiones**"* (marcado como dato de prensa).
- **`09-liquidacion.md`** §4.1, sobre Cárgalo: *"Enfoque en flotas de menos de 20 unidades (**declara que son el 97% del mercado mexicano**)"* (marcado como declaración del proveedor).

**Dictamen: no se puede dictaminar, pero no pueden ser ambos ciertos.** Si el 97% tiene menos de 20 unidades, entonces **más** del 97% tiene menos de 30, no el 95%. El corte más chico no puede tener el porcentaje mayor. Uno de los dos está mal, y ninguno viene de INEGI, SICT ni CANACAR. Ambos documentos ya los marcan como no verificados; el resumen ejecutivo los repite en su Pendiente #28. **No usar ninguno de los dos en la landing hasta tener fuente oficial.**

### 9.4 Fecha de publicación del Anexo 2 de la RMF 2026: 28 o 29 de diciembre

- **`01`** §0 y §7.1: *"Anexo 2 de la RMF 2026 […] publicado en el DOF el **29-12-2025**"*.
- **`03`** §0: *"DOF **28/29**-dic-2025"* (no se decide).
- El PDF que ambos citan se llama `Anexo-2-RMF-2026_DOF-**28122025**.pdf`.

**Dictamen: no lo resolví.** Es de bajo impacto sustantivo pero alto impacto de credibilidad: es una cita que un fiscalista verifica en dos clics. Hay que fijar una fecha antes de que el Anexo 2 aparezca en cualquier documento con el logo de Likida.

---

## 10. El artículo mal citado que sigue vivo en tres lugares

El resumen ejecutivo ya lo corrigió como **C4**: `05-hidrocarburos.md` cita el estímulo del diésel como **"LIF 2026 art. 16-A-IV"**, y es el **artículo 20, apartado A, fracción IV**.

Lo que el resumen ejecutivo no dice es **dónde** está el error dentro de `05`, y son tres lugares distintos:

| Ubicación en `05` | Texto |
|---|---|
| **§4.7**, nota sobre subproductos | *"el estímulo de IEPS del **art. 16-A-IV de la LIF** está pensado para uso automotriz"* |
| **§6.3**, encabezado | *"**LIF 2026 (DOF 07-11-2025), art. 16, apartado A, fracción IV**: estímulo para quienes adquieran diésel…"* |
| **Fuentes**, primarias | *"Ley de Ingresos de la Federación para 2026 (DOF 07-11-2025) — **art. 16 apartado A fr. IV**"* |

**Lo que agrava el caso de §6.3:** ahí `05` transcribe el texto **correcto y vigente** (el de la LIF 2026) bajo el **número de artículo equivocado**. Un lector que vaya al artículo 16 de la LIF 2026 no va a encontrar ese texto, y va a concluir que la cita es inventada. Es peor que un error de numeración: parece una cita fabricada.

**Dictamen ya emitido y confirmado:** el criterio 1/LIF/PI que transcribí en la sección 1 de este documento cita, tres veces y textualmente, *"el artículo **20, apartado A, fracción IV**, primer párrafo de la LIF"*. Es fuente primaria del SAT confirmando la numeración. Gana `04`.

---

## 11. `01` se contradice a sí mismo sobre las prácticas indebidas

Ya está corregido como **C3** en el resumen ejecutivo, pero el archivo `01` sigue con la contradicción adentro, y quien abra sólo ese archivo se lleva el número equivocado.

- **`01` resumen, punto 11:** *"De todas las 'prácticas indebidas' que circulan, **solo una está publicada en el DOF** (criterio 1/CFF/PI, Anexo 3 de la RMF 2026) […] Las otras nueve viven en un documento informativo del SAT de octubre de 2023."*
- **`01` §6.1:** documenta **dos** criterios publicados en el DOF: **1/CFF/PI** y **3/CFF/PI**.

**Dictamen, con el conteo hecho sobre el texto del Anexo 3 (DOF 09-ene-2026):** hay **74 criterios** publicados, repartidos así:

| Apartado | Criterios |
|---|---:|
| Criterios del CFF | **4** |
| Criterios de la Ley del ISR | **44** |
| Criterios de la Ley del IVA | **12** |
| Criterios de la Ley del IEPS | **5** |
| Criterios de la LFD | **6** |
| Criterios de la LISH | **2** |
| **Criterios de la LIF** | **1** |
| **Total** | **74** |

Coincide con lo que el resumen ejecutivo estimó ("~70"). Lo único cierto del punto 11 de `01` es que, de la lista informativa de diez prácticas que el SAT difunde en su PDF de octubre de 2023, la única con criterio publicado en el DOF es la del portal de autofacturación.

**Criterio que nadie del equipo citó y que conviene revisar antes de modelar pagos a terceros:** el **43/ISR/PI** —*"Cantidades entregadas a trabajadores, socios o accionistas por concepto de incentivos laborales, bonos, comisiones o compensaciones complementarias […] **pagadas a través de terceros**. No tienen el tratamiento de ingresos exentos, ni las cantidades pagadas a los terceros son deducibles, ni es acreditable el IVA que se traslade por dichos pagos"*. Es el único criterio del Anexo 3 que la Primera Modificación del 17-jul-2026 reformó. Cae cerca de las estructuras de coordinado y de pago a hombres-camión.

---

## 12. Convergencias que valen como dictamen firme

Tres puntos donde documentos independientes llegaron a lo mismo. Los registro porque, al no ser contradicciones, nadie los va a volver a revisar, y son los que más se van a citar frente a un cliente.

**12.1 No existe plazo legal para pedir una factura.** `01` §8 (cuatro capas de análisis), `09` §14 y `09` SIN VERIFICAR #1 llegan por separado a la misma conclusión: no hay disposición fiscal que imponga al comprador un plazo; el límite real es que la **fecha de expedición corresponda al ejercicio por el que se deduce** (LISR 27 fr. XVIII); los "30 días" son política comercial de los portales de casetas; los "60 días" de gastos por cuenta de terceros **se derogaron en agosto de 2019**. Coincidencia de dos investigadores que no se vieron, sobre fuentes distintas. Es de las afirmaciones más sólidas del paquete.

**12.2 Nadie valida el permiso de la SICT.** `02` §7.2 lo verifica **por ausencia** en la sección 8 del Estándar CCP 3.1 (*"no existe ninguna validación para `PermSCT` ni para `NumPermisoSCT`"*, más allá del catálogo y del patrón). `07` §"Lo que hay que dejar de prometer" llega al mismo lugar por otra vía (*"no hay evidencia verificada de una API pública de consulta de permisos"*). Dos verificaciones negativas independientes. La conclusión conjunta —**un número de permiso inventado pasa el timbrado y sólo lo detecta una revisión en carretera**— es un hallazgo de demo, y es de los pocos que se puede enseñar en pantalla.

**12.3 El complemento HidroYPetro ya arrancó.** Además de lo que dice `05`, hay un indicio nuevo: el SAT **reformó el primer párrafo de la regla 2.7.1.48 el 9 de julio de 2026 sin acompañarla de ningún transitorio que difiera su aplicación**, mientras que en la misma resolución sí fijó fechas explícitas para las reglas 11.7.3 (Transitorio Sexto) y 9.1.24 (Transitorio Octavo). No se reforma el párrafo operativo de una regla que todavía no está viva. Es evidencia corroborante, no prueba: la fecha exacta de publicación en el Portal sigue sin confirmarse.

---

## Acciones concretas

| Acción | Por qué | Esfuerzo | Cuándo |
|---|---|---|---|
| Cerrar el Pendiente bloqueante #1 del resumen ejecutivo citando el criterio **1/LIF/PI** del Anexo 3 (DOF 09-ene-2026) | La duda que bloqueaba el motor de estímulos ya estaba contestada dentro del paquete. Y la fracción II del criterio alcanza a Likida | Bajo | Ya |
| Releer la **Primera Resolución de Modificaciones a la RMF 2026** (DOF 09-jul-2026) y sus **Anexos 21 y 22** | `09` afirma "verificado" que sólo cambiaron dos reglas; cambiaron 28, se agregaron 5 y se derogó 1. Un error de cita frente al fiscalista de un contralor destruye lo demás | Medio | Antes de la demo del 6-ago |
| Meter la **regla 11.7.3** (ajuste al precio base del diésel, 13 fechas, retroactivo al 1-abr-2026) al servicio de cuotas semanales | Sin ella, el estímulo de abril a julio de 2026 se calcula mal. Y el calendario no es semanal: tiene saltos de 6, 7 y 9 días | Medio | Antes de calcular un solo estímulo |
| Corregir la validación de RFC receptor: **cuatro ramas, no un booleano** (Grupo A / Grupo B profesional / Grupo B subordinado / tercero) | Tal como está escrita en `03`, rechaza viáticos de operador subordinado que el **RLISR 57 ¶3** permite expresamente. Le quita deducciones legítimas al cliente | Medio | Antes del primer cliente |
| Quitar el filtro "¿el emisor está en 2.6.1.2?" del validador de `HidroYPetro` | La reforma del 09-jul-2026 movió la remisión: ahora obliga a **cualquiera que enajene gasolinas o diésel** | Bajo | Antes de codificar el validador |
| Renombrar en producto, contrato y landing: `bitácora fiscal de peaje (RMF 9.1.8-II)` y `bitácora de horas de servicio (RTCPJF 83 / NOM-087)` | Son dos documentos distintos. Uno lo genera Likida sola; el otro necesita diez campos y dos firmas. Decir "bitácora" a secas promete el que no se puede entregar | Bajo | Antes de escribir copy |
| Acotar el argumento de venta del ISN a **Grupo B** | El contenido típico del 8% son gastos de la unidad, que nunca entraron al objeto del ISN. La versión general se cae con una pregunta | Bajo | Antes del primer pitch a contralor |
| Separar `necesita_carta_porte` de `elegible_rfa_titulo_2` como banderas independientes | La ficción del radio de 30 km es "para los efectos de" la Sección 2.7.7 únicamente. No convierte a nadie en transportista local para la RFA | Bajo | En el modelo de datos |
| Corregir en `05` las tres citas de **"LIF art. 16-A-IV"** → **art. 20, ap. A, fr. IV** | En §6.3 se transcribe el texto correcto bajo el artículo equivocado: parece cita fabricada | Bajo | Ya |
| Corregir en `05` el conteo de permisos: **346** de autoconsumo, **17,385** vigentes (no 363 ni 17,840) | Son cifras de lámina. El propio §4.4 advierte contra el error que el resumen del documento comete | Bajo | Ya |
| Corregir en `01` el punto 11 del resumen: **74 criterios** en el Anexo 3, no uno | El archivo se contradice a sí mismo entre su resumen y su §6.1 | Bajo | Ya |
| Recalcular con **UMA 2026 = $117.31** todas las cifras de sanción de `11-datos-personales.md` | Ya identificado como C5; el archivo sigue con ~$113 (valor 2025) y con el pendiente marcado como abierto | Bajo | Ya |
| Fijar una sola fecha para el **Anexo 2 de la RMF 2026** (28 o 29 de diciembre de 2025) | `01` dice 29, `03` dice "28/29", el archivo del SAT dice 28. Es una cita que se verifica en dos clics | Bajo | Antes de citarlo con un cliente |
| Retirar de todo material los datos **"95% con menos de 30 camiones"** y **"97% con menos de 20"** | Son aritméticamente incompatibles y ninguno viene de fuente oficial | Bajo | Ya |
| Leer el criterio **43/ISR/PI** completo antes de modelar pagos a operadores a través de terceros | Es el único criterio del Anexo 3 que la modificación de julio de 2026 reformó, y toca estructuras de pago vía terceros | Bajo | Antes de diseñar el flujo de coordinado |

---

## CONFLICTOS

Contradicciones con lo que dice el resumen ejecutivo de la ola 1. **El sintetizador resuelve; yo no sobrescribí nada.**

**CONFLICTO 1 — El Pendiente bloqueante #1 no está abierto.**
`00-RESUMEN-EJECUTIVO.md`, "Pendientes de verificar", punto 1, dice: *"Criterio del SAT que confirme que se acredita la cuota DISMINUIDA semanal y no la íntegra de $7.3634. […] **no se localizó criterio normativo ni regla que lo diga con esas palabras**. […] Que lo confirme un fiscalista con cédula antes de ponerlo en una propuesta."*
Ese criterio existe, está publicado desde 2020, sigue vigente y lo transcribí en la §1 de este documento: **1/LIF/PI, Anexo 3 de la RMF 2026, DOF 09-ene-2026**. El resumen ejecutivo adoptó la versión de `04` sin cruzarla con la de `03`, que estaba en el mismo paquete y era la correcta.

**CONFLICTO 2 — El Pendiente #16 (barrido de modificaciones a la RMF) está a medias, no abierto.**
El resumen ejecutivo dice: *"**Primera y Segunda Modificación a la RMF 2026** […] Alguna de las reglas 9.1.6–9.1.8, 2.7.1.12 o 2.7.7.2.x pudo haber cambiado entre enero y julio. **Barrer antes de la demo del 6-ago.**"*
La Primera Modificación **ya está barrida** en `02-carta-porte.md`, que transcribió el resolutivo PRIMERO íntegro. Verifiqué esa transcripción contra el PDF del SAT y es exacta. Ninguna de las reglas que preocupan (9.1.6, 9.1.7, 9.1.8, 2.7.1.12, 2.7.7.2.x) fue tocada. Lo que sí cambió y nadie leyó son las reglas **11.7.3** (nueva, afecta el estímulo del diésel) y **2.7.1.48** (reformada, amplía el sujeto obligado del complemento de hidrocarburos), más los **Anexos 21 y 22**. El pendiente hay que reescribirlo con ese alcance, no cancelarlo.

**CONFLICTO 3 — El pendiente sobre los importes del art. 90 del CFF está cerrado.**
El resumen ejecutivo, sección C3, dice: *"**SIN VERIFICAR:** los importes de $79,130 a $124,380 del art. 90 del CFF que circulan en el archivo 01. No los uses en material comercial hasta leerlos en el Anexo 5 de la RMF 2026."*
Los leí en el Anexo 5 (DOF 28-12-2025), apartado B. Texto literal: *"**Artículo 90.** Se sancionará con una multa de **$79,130.00 a $124,380.00**, a quien cometa las infracciones a las disposiciones fiscales a que se refiere el artículo 89 de este Código."* La cifra de `01` es correcta.
De paso confirmé los rangos del art. 84 fr. IV: **a) $22,300.00 a $127,530.00** (apartado A, cantidades actualizadas), **b) $1,910.00 a $3,800.00**, **c) $19,050.00 a $108,870.00**, **d) $450.00 a $670.00 por cada comprobante sin complemento** (apartado B). Coinciden con lo que reportan `01`, `02` y `05`.

**CONFLICTO 4 — El resumen ejecutivo generaliza el argumento del ISN.**
Dice, en la fila del archivo 06 del índice: *"El viático mal comprobado además de perder ISR e IVA paga ISN (2%–4.25%)."* Correcto sólo para **viáticos de la persona** (Grupo B). El contenido típico del 8% que documenta `03` §4.3 es Grupo A y no causa ISN. Ver §7 de este documento.

**CONFLICTO 5 — El resumen ejecutivo compacta dos bitácoras en una palabra.**
Prohíbe prometer que la bitácora de Likida sustituye la legal de horas de servicio (correcto) y en el mismo documento llama "bitácora conciliada" al entregable de la regla 9.1.8 (también correcto). Sin apellidos, las dos frases se leen como si hablaran del mismo documento. Ver §6.

---

## SIN VERIFICAR

Lo que no pude cerrar. El presupuesto de WebSearch de la sesión ya estaba agotado (200/200) cuando llegué; todo lo que verifiqué lo hice con WebFetch directo a PDF del SAT y de la Cámara de Diputados, más extracción local de texto. Eso me dejó sin capacidad de buscar fuentes estatales, que es donde quedó lo más grande.

1. **Anexos 21 y 22 de la RMF 2026 (Primera Modificación, DOF 17-jul-2026).** No los abrí. Son la base de todo el §5 de `05-hidrocarburos.md` (control volumétrico, umbral de 75,714 L/mes, certificados y dictámenes). Es el hueco más grande que dejo abierto.
2. **Anexos 1, 9, 14 y 15 de la misma modificación.** Sin revisar. El Anexo 1 y el 2 contienen formatos y fichas de trámite que `01` y `03` citan (46/CFF, 65/ISR, 2/LIF, 28/CFF). `01` sí verificó específicamente la ficha 46/CFF.
3. **Segunda Modificación a la RMF 2026** y sus versiones anticipadas de julio de 2026. No la localicé. El pendiente #16 del resumen ejecutivo sigue vivo por esta mitad.
4. **Fecha de publicación del Complemento Concepto de Hidrocarburos en el Portal del SAT.** Sigue sin confirmarse en fuente SAT. Lo que agrego es evidencia corroborante (§12.3), no prueba.
5. **Los conflictos estatales de ISN de `06`**: Durango (2% vs 3%), Morelos (2.5% vs 3%), Tabasco (2.5%–4%) y Sonora (portal oficial dice 3%+1%, la ley descargable dice 2%). Requieren los periódicos oficiales estatales y no tuve búsquedas para llegar a ellos. Las 19 tasas marcadas **S** en `06` siguen sin verificar.
6. **El dato del tamaño del mercado** (95%/<30 vs 97%/<20). Requiere INEGI, SICT o CANACAR. No lo pude alcanzar.
7. **Fecha del Anexo 2 de la RMF 2026** (28 vs 29 de diciembre de 2025). No resolví la discrepancia entre `01`, `03` y el nombre del archivo del SAT.
8. **Texto íntegro del criterio 43/ISR/PI** en su versión reformada del 17-jul-2026. Leí la versión de enero y confirmé que es el único criterio reformado en julio, pero no diffeé ambas versiones. La diferencia visible en el encabezado es que la versión de julio agrega *"compensación para el cumplimiento de la Norma Oficial Mexicana NOM-035-STPS-2018"* a la lista de conceptos.
9. **Si el ajuste de la regla 11.7.3 ya está incorporado en los acuerdos semanales de la SHCP** o si es un ajuste que hay que aplicar encima. La regla dice que el precio base "se disminuirá", lo que sugiere que modifica el insumo del cálculo. No verifiqué cómo se refleja en los acuerdos publicados de abril a julio de 2026.
10. **Si la reforma a la regla 2.7.1.48 amplía o sólo aclara el universo de obligados.** Mi lectura es que amplía, porque el sujeto pasa de "los contribuyentes a que hace referencia la regla 2.6.1.1 fr. II" a "los contribuyentes que enajenen gasolinas y diésel". Es interpretación gramatical mía sobre dos textos que sí leí, no criterio del SAT.

---

## Fuentes

Todas leídas directamente en esta pasada, descargando el PDF y extrayendo el texto con `pdftotext`. No usé fuentes secundarias para ningún dictamen.

**Fuente primaria — SAT / DOF**

- **Anexo 3 de la RMF 2026** (Compilación de criterios sobre prácticas fiscales indebidas), DOF 09-ene-2026 — criterio **1/LIF/PI** (apartado VI), criterio **6/ISR/PI**, criterio **43/ISR/PI**, conteo completo de los 74 criterios
  https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo_3_RMF2026-09012026.pdf
- **Primera Resolución de Modificaciones a la RMF 2026**, DOF 09-jul-2026 — resolutivo PRIMERO íntegro, reglas **2.7.1.48**, **9.1.23**, **9.1.24**, **9.4.6**, **11.7.1**, **11.7.3**, Capítulo 11.18, transitorios Sexto y Octavo
  https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/1aRM_RMF2026.pdf
- **Primera Modificación al Anexo 3 de la RMF 2026**, DOF 17-jul-2026 — confirma que sólo se reforma el criterio 43/ISR/PI
  https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Primera-Modificacion-Anexo-3-DOF-17072026.pdf
- **Primera Modificación al Anexo 29 de la RMF 2026**, DOF 17-jul-2026 — confirma que sólo se modifica la sección VI.1 numeral 10 y que **la sección III.3 (L_CNE) queda intacta**
  https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Primera-Modificacion-Anexo-29-DOF-17072026.pdf
- **Anexo 5 de la RMF 2026** (Cantidades actualizadas y compilación del CFF), DOF 28-dic-2025 — arts. **84 fr. IV incisos a) a d)**, **90** y **90-A**
  https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo-5-RMF-2026_DOF-28122025.pdf
- Índice de normatividad RMF/RGCE 2026 del SAT (para localizar las modificaciones a los anexos)
  https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2026.html

**Fuente primaria — Cámara de Diputados**

- **Reglamento de la Ley del Impuesto sobre la Renta**, última reforma DOF 06-05-2016 — **art. 57** (los tres párrafos) y **art. 152**
  https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LISR_060516.pdf

**Documentos de la ola 1 cotejados (los once, completos)**

`00-INDICE.md` · `00-RESUMEN-EJECUTIVO.md` · `01-cfdi-cff.md` · `02-carta-porte.md` · `03-isr-facilidades.md` · `04-iva-ieps-estimulos.md` · `05-hidrocarburos.md` · `06-estatal.md` · `07-no-fiscal.md` · `08-competencia.md` · `09-liquidacion.md` · `10-handle-ai.md` · `11-datos-personales.md`
