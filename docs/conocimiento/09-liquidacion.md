# Liquidación de viajes: cómo se hace hoy y cómo automatizarla

> Investigado el 27-jul-2026 para Likida.ai. Fundamentos citados. Lo no verificado va marcado.

---

## Resumen para el fundador

1. **"Liquidación de viaje" son tres cosas distintas con el mismo nombre.** El cierre operativo del costo del viaje, el pago al operador (nómina), y la liquidación fiscal que un coordinado le entrega a su integrante (RFA 2026, regla 2.10). Si Likida no elige explícitamente cuál construye, va a decepcionar a los tres compradores.
2. **El error más caro del sector es meter todo en el cubo "viáticos".** El diésel, las casetas y la talacha del camión **no son viáticos**: son costo directo de operación. Los viáticos, legalmente, sólo son hospedaje, alimentación, transporte, renta de auto y kilometraje **de la persona** (LISR 28, fr. V). Meter diésel en viáticos le mete al operador ingreso que no es suyo y le mete a la empresa un tope que no aplica.
3. **Los viáticos tienen un muro geográfico que casi nadie mira: la faja de 50 km.** No son deducibles si se erogan dentro de 50 km alrededor del establecimiento donde el beneficiario presta normalmente sus servicios (LISR 28, fr. V; RLISR 57). Para flotas locales y de última milla, esto puede invalidar la deducción entera.
4. **Los viáticos sólo son deducibles si el beneficiario tiene relación laboral o presta servicios profesionales** (LISR 28, fr. V). El hombre-camión permisionario **no es ninguno de los dos**: es proveedor. Los "viáticos" que se le den no son gasto de viaje, son parte del precio del flete.
5. **El comprobante del operador empleado sí puede ir a su nombre.** El RLISR 57, tercer párrafo, lo dice literal: si el beneficiario es trabajador subordinado, los CFDI *pueden* expedirse a nombre de esa persona. Esto cambia la validación de Likida: un ticket con el RFC del operador no es automáticamente un error.
6. **Si la flota usa monedero de combustible, la gasolinera NO le factura a la flota.** La regla 3.3.1.7 de la RMF 2026 lo prohíbe expresamente. El comprobante deducible es el CFDI mensual del emisor del monedero con el Complemento de Estado de Cuenta. **La foto del ticket de la gasolinera, en ese esquema, no vale para deducir nada.** Este es el hallazgo de producto más importante del documento.
7. **Diésel pagado en efectivo no es deducible, sin importar el monto** (LISR 27, fr. III). Pero el autotransporte de carga federal tiene una válvula: hasta **15% del total de pagos de combustible** puede hacerse por medios distintos (RFA 2026, regla 2.9). Ese 15% es un contador que alguien tiene que llevar y hoy casi nadie lleva.
8. **La facilidad de "$113.90 por día de viáticos de la tripulación" ya no existe.** No está en la RFA 2026. Lo que existe es el 8% ciego de ingresos propios, tope $1,000,000, pagando 16% de ISR definitivo, y **que no aplica a combustible** (RFA 2026, regla 2.2). La página del SAT que todavía la publica está desactualizada desde 2013.
9. **El 20% de viáticos sin comprobante tiene una condición que casi nadie cumple**: el 80% restante debe erogarse **con tarjeta de crédito, débito o de servicios del patrón** (RLISR 152). Si el anticipo se dio en efectivo, la exención del 20% no procede.
10. **Depositar el anticipo a la cuenta personal del operador es la práctica más común y la más peligrosa.** El salario base de cotización se integra con "cualquiera otra cantidad o prestación que se entregue al trabajador por su trabajo" (LSS 27). Un depósito regular a cuenta personal es exactamente eso a los ojos del IMSS, que puede revisar cinco años atrás.
11. **El anticipo bien hecho tiene dos rutas legales, no una.** Si el operador es empleado: viáticos (LISR 93, fr. XVII + RLISR 152 + CFDI de nómina con claves 003/050/081). Si es un tercero: erogaciones por cuenta de terceros (RMF 2026, regla 2.7.1.12), que exige cuenta bancaria independiente y reintegro antes del cierre del ejercicio. Son regímenes incompatibles y Likida tiene que preguntar cuál antes de procesar nada.
12. **Ya hay un competidor directo, financiado y con Mastercard detrás.** Se llama **Uvicuo**: gestión de gastos de ruta para autotransporte, por WhatsApp, con tarjeta, validación por IA y alertas de combustible. Lanzó formalmente en noviembre de 2025. Rindegastos y Clara también ya reciben comprobantes por WhatsApp. El canal WhatsApp **ya no es diferenciador**.
13. **Lo que sí sigue vacío es la conciliación de tres vías con la realidad física del viaje**: anticipo vs. comprobación vs. lo que el camión efectivamente hizo (kilómetros, litros, casetas de la ruta). Ahí es donde vive la fuga y ahí es donde casi nadie cierra el círculo.
14. **El plazo real de comprobación no es de 30 días ni de 60.** Para gastos por cuenta de terceros el plazo es **el último día del ejercicio** (31 de marzo del siguiente si el dinero se dio en diciembre), RMF 2.7.1.12, fr. II, inciso e). Los "30 días" que citan los portales de casetas son política comercial del portal, no ley.
15. **El "Complemento de Liquidación" que la RFA menciona nunca se ha publicado.** El transitorio Segundo de la RFA 2026 sigue remitiendo a la Resolución de 2015 mientras eso no ocurra. Si Likida promete "generar la liquidación fiscal del coordinado", está prometiendo un documento que el SAT no ha definido.

---

## 0. Marco vigente al 27 de julio de 2026 (qué versión de cada norma se leyó)

| Norma | Versión leída | Fuente |
|---|---|---|
| Ley del ISR | Última reforma **DOF 01-04-2024** | Cámara de Diputados (PDF oficial) |
| Reglamento de la Ley del ISR | Última reforma **DOF 06-05-2016** | Cámara de Diputados (PDF oficial) |
| Ley del Seguro Social | Última reforma **DOF 15-01-2026** | Cámara de Diputados (PDF oficial) |
| Resolución Miscelánea Fiscal 2026 | **DOF 28-12-2025** | SAT (PDF íntegro, 36,435 líneas de texto) |
| Primera Resolución de Modificaciones a la RMF 2026 | **DOF 09-07-2026** | SAT (PDF íntegro) |
| Anexo 10 RMF 2026 (emisores de monederos) | **DOF 09-01-2026** | SAT (PDF íntegro) |
| Resolución de Facilidades Administrativas 2026 | **DOF 17-02-2026** | SAT / DOF (PDF íntegro) |
| Caso de uso "Reporte de viáticos en el recibo de nómina" | SAT, sin fecha en documento; el planteamiento usa 2017 | SAT (PDF) |
| Padrón de emisores de monederos de combustible | Página SAT consultada 27-jul-2026 | SAT (dos mirrors) |

**Verificado:** la Primera Resolución de Modificaciones a la RMF 2026 (DOF 09-07-2026) **sólo modificó las reglas 2.7.1.48 y 2.7.5.8**. No tocó ninguna de las reglas que este documento cita (2.7.1.12, 2.7.5.3, 3.3.1.6, 3.3.1.7, 3.3.1.10). Se comprobó extrayendo el texto completo y buscando cada número de regla.

**Verificado:** la RFA 2026 entró en vigor el **18 de febrero de 2026** (día siguiente a su publicación) y estará vigente hasta el 31 de diciembre de 2026, pero **sus facilidades aplican a todo el ejercicio 2026** (RFA 2026, Transitorio Primero). Firmada en CDMX el 12 de febrero de 2026 por el Administrador General Jurídico, Lic. Ricardo Carrasco Varona, en suplencia del Jefe del SAT.

---

## 1. "Liquidación de viaje" son tres cosas distintas

Esta es la primera trampa del dominio y hay que resolverla antes de escribir una línea de código. La palabra "liquidación" aparece en tres contextos que no se comunican entre sí.

### 1.1 Liquidación operativa del viaje (cierre de costos)

Es cerrar el costo real de un viaje concreto: qué unidad, qué operador, qué ruta, cuánto se gastó en diésel, casetas, viáticos, maniobras y pensión, contra cuánto se le anticipó al operador y cuánto ingresó el flete. Es un documento **de gestión**, no fiscal. Nadie lo timbra. Su producto es un margen por viaje y un saldo a favor o en contra del operador.

Es lo que hacen los módulos de "liquidaciones" de los TMS mexicanos y es, casi con seguridad, lo que Likida quiere resolver.

### 1.2 Liquidación del operador (el pago)

Es el cálculo de lo que se le paga al operador por el viaje o por el periodo: sueldo por kilómetro, por comisión sobre el flete, o por viaje fijo, menos las deducciones (anticipos no comprobados, multas, daños, cuotas de caja chica, préstamos). Esta sí termina en un documento fiscal: **el CFDI de nómina**.

Aquí es donde el autotransporte de carga federal tiene su facilidad estrella: en lugar de aplicar las disposiciones de sueldos, puede **enterar el 7.5% por concepto de retenciones de ISR** sobre lo efectivamente pagado a operadores, macheteros y maniobristas, tomando como referencia el salario base de cotización del IMSS (RFA 2026, regla 2.1). No exime de emitir el CFDI de nómina con su complemento — la regla lo dice expresamente — y exige entregar a más tardar el **15 de febrero de 2027** una relación individualizada del personal conforme a la ficha de trámite **65/ISR** del Anexo 2 de la RMF.

Condición fácil de pasar por alto: la facilidad **no aplica** si el contribuyente presta preponderantemente sus servicios a otra persona moral que sea parte relacionada (RFA 2026, regla 2.1, último párrafo).

### 1.3 Liquidación del coordinado a su integrante (documento fiscal)

Cuando varios permisionarios operan bajo un coordinado (LISR 72 y 73), el coordinado cumple obligaciones fiscales por cuenta de sus integrantes y les emite una **liquidación** que consigna ingresos, deducciones, impuestos y retenciones de cada uno.

La RFA 2026, regla 2.10, exige que esa liquidación se emita mediante un **CFDI de retenciones e información de pagos** con el **"Complemento de Liquidación"**, y enumera sus requisitos: razón social, domicilio y RFC del coordinado, folio consecutivo, lugar y fecha, nombre y RFC/CURP del integrante, y descripción global de conceptos de ingresos, deducciones, impuestos y retenciones. Debe además consignar valor de actividades, IVA trasladado, IVA acreditable e IVA pagado en importación.

**El detalle que importa:** ese complemento **no se ha publicado**. El Transitorio Segundo de la RFA 2026 dice que las liquidaciones deberán emitirse con él "a partir de los treinta días siguientes a aquel en que se publique el 'Complemento de Liquidación' en el Portal del SAT", y que **mientras no se publique**, deben emitirse "en los términos establecidos en la Resolución de Facilidades Administrativas… para 2015, publicada en el DOF el 30 de diciembre de 2014". Es decir: once años después, el SAT sigue sin publicar el complemento y el sector opera con un formato de 2015.

Efecto colateral relevante: la responsabilidad solidaria del coordinado frente al fisco se limita "únicamente por los ingresos, deducciones, impuestos y retenciones que hayan consignado en la liquidación emitida al integrante" (RFA 2026, regla 2.3). **La liquidación es el instrumento que delimita la responsabilidad.** No es papeleo: es un escudo.

---

## 2. El proceso real hoy, paso a paso

### 2.1 Antes del viaje: presupuesto y anticipo

El despachador o el jefe de tráfico arma un presupuesto del viaje: litros estimados según el rendimiento esperado de la unidad y los kilómetros de la ruta, casetas del corredor, días de viaje por alimentación y hospedaje, y un colchón para imprevistos (talacha, lavado, pensión, maniobras).

Contra ese presupuesto se entrega el **anticipo**. Y aquí empieza el problema, porque el anticipo puede salir por cuatro caminos distintos y **cada camino tiene un régimen fiscal diferente**.

### 2.2 Los cuatro caminos del dinero (y por qué no son equivalentes)

| Camino | ¿El gasto es deducible? | ¿Quién emite el CFDI? | Riesgo IMSS / laboral | Fundamento |
|---|---|---|---|---|
| **Efectivo de caja chica** | Sí para alimentos/hospedaje/maniobras. **No para combustible.** | El proveedor, a nombre de la empresa o del operador si es empleado | Bajo si está documentado como fondo fijo; alto si se entrega recurrente sin control | LISR 27, fr. III; RLISR 41 y 57 |
| **Depósito a cuenta personal del operador** | Depende de la comprobación | El proveedor | **Alto.** Integra salario base de cotización | LSS 27, primer párrafo |
| **Monedero electrónico de combustible autorizado** | Sí, 100% | **El emisor del monedero**, no la gasolinera | Nulo: el dinero no sale del patrimonio de la empresa | RMF 3.3.1.7 y 3.3.1.10 |
| **Tarjeta corporativa (crédito/débito/servicios de la empresa)** | Sí | El proveedor, a nombre de la empresa | Bajo | LISR 27, fr. III; RLISR 152 |
| **TAG de peaje a nombre de la empresa** | Sí | El proveedor del TAG, no la autopista | Nulo | Ver §3.8 |

**Sobre el efectivo y el RLISR 41.** Existe una excepción específica que casi nadie cita y que es útil: el artículo 41 del RLISR obliga a entregar dinero a un tercero mediante cheque nominativo o traspaso **"excepto tratándose de contribuciones, viáticos o gastos de viaje"**. Es decir, a nivel Reglamento, entregar efectivo para viáticos está expresamente exceptuado de esa formalidad.

Pero esa excepción **no salva el combustible** (que tiene su propia regla en LISR 27, fr. III, segundo párrafo) **ni salva la exención del 20%** (que exige tarjeta del patrón, RLISR 152) **ni desactiva el riesgo del IMSS**. Es una excepción angosta.

**Sobre el depósito a cuenta personal.** El artículo 27 de la LSS, primer párrafo, dice literal:

> "El salario base de cotización se integra con los pagos hechos en efectivo por cuota diaria, gratificaciones, percepciones, alimentación, habitación, primas, comisiones, prestaciones en especie y **cualquiera otra cantidad o prestación que se entregue al trabajador por su trabajo**."

Y el penúltimo párrafo agrega la condición que resuelve todo: *"Para que los conceptos mencionados en este precepto se excluyan como integrantes del salario base de cotización, deberán estar debidamente registrados en la contabilidad del patrón."*

Traducción operativa: **lo que salva a la flota no es cómo se llame el depósito, es que exista el registro contable que lo separa.** Ahí es exactamente donde una liquidación bien hecha vale dinero.

### 2.3 Durante el viaje: qué gasta el operador y quién factura qué

Este es el inventario real de lo que aparece en un sobre de comprobantes al regreso, clasificado por régimen fiscal — que es la clasificación que importa, no la que usa el contralor:

**Grupo A — Costos de la unidad (NO son viáticos)**

| Concepto | Quién factura | Nota |
|---|---|---|
| Diésel | Emisor del monedero (si hay monedero) o la estación (si se pagó con tarjeta/transferencia) | Nunca deducible si se paga en efectivo, salvo la válvula del 15% |
| Casetas / peaje | Proveedor del TAG si se pasó con TAG; operador de la autopista si se pagó en caseta | Ver §3.8 |
| Talacha, llantas, refacciones menores | El taller | Requiere CFDI normal |
| Lavado de unidad | El lavadero | |
| Pensión / estacionamiento de la unidad | El corralón o pensión | |
| Maniobras, lumper, patio | El maniobrista o el patio | Con frecuencia informal |
| Multas de tránsito | Autoridad | **No deducible** (LISR 28, fr. VI) |

**Grupo B — Viáticos del operador (SÍ son viáticos)**

| Concepto | Tope diario | Condición extra |
|---|---|---|
| Alimentación en territorio nacional | **$750.00** por beneficiario | Debe acompañarse el CFDI de hospedaje o transporte. Si sólo se acompaña el de transporte, el pago debe hacerse **con tarjeta de crédito de la persona que viaja** |
| Alimentación en el extranjero | **$1,500.00** | Igual condición |
| Hospedaje en el extranjero | **$3,850.00** | Debe acompañarse la documentación de transporte |
| Hospedaje en territorio nacional | **Sin tope específico en LISR 28, fr. V** | Sigue sujeto al requisito general de ser estrictamente indispensable |
| Uso o goce temporal de automóviles y gastos relacionados | **$850.00** (nacional o extranjero) | Debe acompañarse CFDI de hospedaje o transporte |

Todos estos montos son texto literal del artículo 28, fracción V, de la LISR (versión DOF 01-04-2024).

> **Corrección de un error que circula mucho:** varias fuentes secundarias afirman que el hospedaje nacional tiene tope de $850 diarios. **Es falso.** Los $850 son el tope de **renta de automóviles**. El único tope de hospedaje que fija la fracción V es el de **$3,850 diarios y sólo para el extranjero**. Si Likida programa un tope de $850 a hospedaje nacional, va a rechazar gastos legítimos.

### 2.4 Al regreso: la comprobación

El operador entrega el sobre. Alguien —normalmente una persona de administración, no el contralor— captura ticket por ticket en un Excel o en el módulo de liquidaciones del sistema, si lo hay. Se separa lo que trae factura de lo que no. Se pide factura de lo que se puede (gasolineras, casetas, hoteles) en los portales de cada proveedor.

Luego se compara: **comprobación vs. anticipo**.

- Si comprobación = anticipo → se cierra.
- Si comprobación > anticipo → se autoriza el excedente (o no) y se genera reembolso al operador.
- Si comprobación < anticipo → el operador devuelve, o se le descuenta de la liquidación siguiente.

Esta mecánica de tres desenlaces es la misma que describen tanto los procedimientos de viáticos corporativos mexicanos como los TMS del sector, y es lo que hay que codificar.

### 2.5 Cierre y contabilización

Se genera la póliza. Los conceptos del Grupo A van a costo de operación por unidad y por viaje. Los del Grupo B van a viáticos, y además —si el operador es empleado— tienen que **reflejarse en el CFDI de nómina** (ver §3.3). El saldo a favor o en contra del operador entra a la liquidación del periodo.

### 2.6 Caja chica: qué papel juega realmente

La caja chica en una flota no es la caja chica de una oficina. Es el mecanismo por el cual el operador obtiene efectivo en carretera para lo que no acepta plástico: maniobras, propinas de patio, talacha de banqueta, comida en fondas sin terminal.

Su rol funcional es **absorber la informalidad de la carretera**. Y por eso es simultáneamente indispensable y la mayor fuga: es el único punto del proceso donde el dinero sale sin dejar huella electrónica y donde el comprobante depende enteramente de la voluntad del operador.

Tres patologías reconocibles:

1. **La caja chica que nunca se repone contra comprobantes** sino contra un monto fijo mensual: se convierte de facto en una prestación en efectivo, con el riesgo del LSS 27.
2. **La caja chica que absorbe combustible**: pagar diésel en efectivo desde caja chica destruye la deducción (LISR 27, fr. III), salvo dentro del 15% de la RFA.
3. **La caja chica como amortiguador de la lentitud del reembolso**: si el operador tarda semanas en recuperar lo que puso de su bolsa, la empresa infla la caja chica para compensar, y pierde control.

El dato de mercado que más se acerca a cuantificar esto: Uvicuo declara haber detectado que **30% de la rotación de operadores obedece a problemas y desajuste de cuentas** — operadores que terminan pagando de su bolsillo o esperando devoluciones. *(SIN VERIFICAR: dato del fundador citado en prensa, no auditado.)*

---

## 3. El marco fiscal que gobierna cada peso del anticipo

### 3.1 Viáticos deducibles para la empresa: LISR 28, fracción V

Texto literal (versión DOF 01-04-2024):

> "V. Los viáticos o gastos de viaje, en el país o en el extranjero, cuando no se destinen al hospedaje, alimentación, transporte, uso o goce temporal de automóviles y pago de kilometraje, de la persona beneficiaria del viático **o cuando se apliquen dentro de una faja de 50 kilómetros que circunde al establecimiento del contribuyente**. Las personas a favor de las cuales se realice la erogación, **deben tener relación de trabajo con el contribuyente** en los términos del Capítulo I del Título IV de esta Ley **o deben estar prestando servicios profesionales**. Los gastos a que se refiere esta fracción deberán estar amparados con un comprobante fiscal cuando éstos se realicen en territorio nacional…"

Tres candados, y los tres muerden:

**Candado 1 — Catálogo cerrado.** Sólo hospedaje, alimentación, transporte, renta de auto y kilometraje. **El diésel del tractocamión de la empresa no cabe aquí.** Tampoco las casetas del camión de la empresa, ni la talacha, ni las maniobras. Esos son costos de operación ordinarios, deducibles por la vía general del artículo 27, no por la fracción V del 28.

**Candado 2 — Faja de 50 km.** El RLISR 57 precisa qué es "establecimiento":

> "Artículo 57. Para efectos del artículo 28, fracción V de la Ley, se entenderá por establecimiento del contribuyente aquél en el que **presta normalmente sus servicios la persona a favor de la cual se realice la erogación**."

Para un operador de carga federal esto es genuinamente ambiguo: ¿su establecimiento es el patio de donde sale, o la carretera? La lectura conservadora es el patio o la base de asignación, y bajo esa lectura los viáticos de un viaje corto o de reparto local **no son deducibles**. Es un riesgo real para flotas urbanas y de última milla, y es un campo que Likida debería exigir: **base de asignación del operador**.

**Candado 3 — Relación laboral o servicios profesionales.** El beneficiario debe ser trabajador subordinado o prestador de servicios profesionales. **Un hombre-camión permisionario integrante no es ninguno de los dos.** Lo que se le entrega no es viático: es parte del precio del servicio que él presta, y debe ir amparado con su propio CFDI de flete.

**A nombre de quién va el comprobante** (RLISR 57, párrafos segundo y tercero):

- Si el beneficiario presta **servicios profesionales**: los CFDI deben expedirse **a nombre del contribuyente** (la empresa).
- Si el beneficiario presta **servicios personales subordinados**: los CFDI **pueden expedirse a nombre de dichas personas**, y en ese caso se tiene por cumplido el requisito de respaldar el gasto con CFDI a nombre de aquél por cuenta de quién se efectuó (LISR 18, fr. VIII).

Además, el segundo párrafo del 57 impone una obligación concreta que se parece mucho a lo que Likida quiere automatizar: *"quien presta el servicio deberá proporcionar al contribuyente **una relación de los gastos anexando los comprobantes fiscales respectivos**"*. Eso es, literalmente, el reporte de gastos. Está mandatado por reglamento.

### 3.2 Viáticos exentos para el operador: LISR 93, fracción XVII y RLISR 152

Texto literal, LISR 93, fr. XVII:

> "Los viáticos, cuando sean **efectivamente erogados en servicio del patrón** y se compruebe esta circunstancia con los comprobantes fiscales correspondientes."

Y la excepción del 20%, RLISR 152, texto literal:

> "Artículo 152. Para efectos del artículo 93, fracción XVII de la Ley, las personas físicas que reciban viáticos y efectivamente los eroguen en servicio del patrón, **podrán no presentar comprobantes fiscales hasta por un 20% del total de viáticos erogados en cada ocasión, cuando no existan servicios para emitir los mismos**, sin que en ningún caso el monto que no se compruebe exceda de **$15,000.00 en el ejercicio fiscal** de que se trate, **siempre que el monto restante de los viáticos se eroguen mediante tarjeta de crédito, de débito o de servicio del patrón**. La parte que en su caso no se erogue deberá ser reintegrada por la persona física que reciba los viáticos o en caso contrario no le será aplicable lo dispuesto en este artículo."

> "Las cantidades no comprobadas se considerarán ingresos exentos para efectos del Impuesto, siempre que además se cumplan con los requisitos del artículo 28, fracción V de la Ley."

Cinco condiciones acumulativas, y las cinco tienen que ser reglas de código:

1. Tope del **20% en cada ocasión** (no 20% del año: 20% de cada evento de viáticos).
2. Tope absoluto de **$15,000 por ejercicio** por persona.
3. Justificación de que **no existían servicios para emitir el comprobante**.
4. El **80% restante debe erogarse con tarjeta del patrón**. Este es el candado duro: si el anticipo se dio en efectivo, no procede.
5. El remanente no erogado **debe reintegrarse**, o se pierde el beneficio completo.

Y el segundo párrafo remata: el beneficio de exención está condicionado además a que **se cumplan los requisitos del 28, fr. V** — o sea, faja de 50 km, topes diarios, catálogo cerrado. Los dos artículos están amarrados.

**Un dato adicional útil** (RLISR 263): el operador no está obligado a informar los viáticos en su declaración anual si no exceden **$500,000** en el ejercicio y no representan más del **10%** del total de los ingresos que le pagó el patrón por servicio personal subordinado. Para calcular ese límite se incluye el monto de los boletos de transporte, aun si los pagó el patrón.

### 3.3 Cómo se timbra: LISR 99, fr. VI + RMF 2026, regla 2.7.5.3

La obligación patronal, LISR 99, fr. VI, texto literal:

> "VI. Proporcionar a más tardar el 15 de febrero de cada año, a las personas a quienes les hubieran prestado servicios personales subordinados, **constancia y el comprobante fiscal del monto total de los viáticos pagados en el año de calendario** de que se trate, por los que se aplicó lo dispuesto en el artículo 93, fracción XVII de esta Ley."

La RMF 2026, regla **2.7.5.3**, sustituye esa constancia por el CFDI de nómina. Texto literal:

> "2.7.5.3. Para los efectos de los artículos 28, fracción V, 93, fracción XVII y 99, fracción VI de la Ley del ISR y 152 del Reglamento de la Ley del ISR, los contribuyentes que hagan pagos por concepto de sueldos y salarios podrán dar por cumplidas las obligaciones de expedir la constancia y el comprobante fiscal del monto total de los viáticos pagados en el año de calendario a los que se les aplicó lo establecido en el artículo 93, fracción XVII de la Ley del ISR, mediante la expedición y entrega en tiempo y forma a sus trabajadores del CFDI de nómina a que se refiere el artículo 99, fracción III de la Ley del ISR, **siempre que en dicho CFDI hayan reflejado la información de viáticos que corresponda** en términos de las disposiciones fiscales aplicables."

**Las tres claves.** El SAT publicó un caso de uso específico ("Reporte de viáticos en el recibo de nómina") que fija la mecánica exacta:

| Momento | Nodo | Clave | Catálogo | Qué representa |
|---|---|---|---|---|
| **Se entrega el anticipo** | `OtrosPagos` | **003** | `c_TipoOtroPago` | Viáticos entregados al trabajador |
| **Se comprueba** | `Percepciones` | **050** | `c_TipoPercepcion` | Viáticos (se separa importe gravado del exento) |
| **Se ajusta** | `Deducciones` | **081** | `c_TipoDeduccion` | Ajuste en viáticos entregados al trabajador |

El ejemplo del SAT, textual: se entregan $3,000 de viáticos junto con la quincena; se registran en `OtrosPagos` con clave 003, y el documento aclara: *"Cuando se registra algún importe en la sección [OtrosPagos], éste no se considera un ingreso acumulable o exento para el trabajador (no es sueldo o salario)."*

Al comprobar, el trabajador entrega factura de hospedaje por $2,500 y ticket sin factura por $500. Se emite un CFDI de nómina donde en la percepción **050** se registran **$2,500 como exento** (comprobado) y **$500 como gravado**, más la deducción **081** por los $3,000 completos, dejando el importe total de nómina en cero.

> **Ojo con el ejemplo:** en el caso del SAT los $500 no comprobados aparecen en la columna **gravada**, aunque el texto explicativo dice que se consideran exentos conforme al 152 del RLISR. Es una inconsistencia del propio documento del SAT entre el texto y la tabla. La lectura correcta es la del RLISR 152: los no comprobados son exentos **sólo si** se cumplen las cinco condiciones del §3.2; si no se cumplen, son gravados. **Likida debe calcular ambos escenarios y no copiar la tabla del SAT a ciegas.**

**Fundamento citado por el propio documento del SAT:** artículos 29 y 29-A del CFF; 93, fr. XVII; 99, fr. III y VI de la LISR; 152 del RLISR; y la regla 2.7.5.3 (el documento cita la versión RMF 2017; **verificado que la numeración sigue siendo 2.7.5.3 en la RMF 2026**).

**Dato técnico verificado en la Guía de llenado del complemento de nómina:** el campo `TotalOtrosPagos` incluye expresamente "Viáticos (entregados al trabajador)" entre los conceptos que *"se registran como datos informativos y no se suman a las percepciones obtenidas por el trabajador, ya que se trata de pagos que no son ingresos acumulables para éste"*.

### 3.4 Kilometraje: RLISR 58

Si el operador usa su propio vehículo para una comisión de la empresa:

> "Artículo 58. … La deducción a que se refiere este artículo **no podrá exceder de 93 centavos M.N., por kilómetro recorrido** por el automóvil, sin que dicho kilometraje pueda ser superior a **veinticinco mil kilómetros recorridos en el ejercicio**…"

Condiciones adicionales del mismo artículo: los gastos deben haberse realizado en territorio nacional, estar amparados con CFDI **expedido a nombre del contribuyente** (la empresa), la empresa debe distinguir esos comprobantes de los de sus propios vehículos, y **se debe acompañar el CFDI que ampare el hospedaje de la persona que conduce el vehículo**.

Los 93 centavos son de la versión del Reglamento reformada en 2016 y no se han actualizado. En 2026 es una cifra irrelevante en la práctica, pero sigue siendo el tope legal.

### 3.5 El anticipo como "erogación por cuenta de terceros": RMF 2026, regla 2.7.1.12

Esta es la regla que aplica cuando **el que gasta no es empleado** — un hombre-camión, un despachador externo, un tercero contratado. Es también el modelo mental que muchos contadores aplican mal a los anticipos de operadores.

La regla ofrece **dos opciones**, y sólo dos:

**Opción I — El tercero paga primero y se le reintegra después.**
- El tercero debe solicitar el CFDI **con el RFC del contribuyente** por cuenta de quien hace la erogación.
- El contribuyente tiene derecho al acreditamiento del IVA.
- **El tercero NO puede acreditar el IVA** que le trasladaron.
- El reintegro debe hacerse con **cheque nominativo o traspaso**, por el valor total incluyendo IVA, **sin cambiar los importes consignados en el CFDI**.

**Opción II — El contribuyente entrega el dinero por adelantado** (el caso del anticipo de viaje):
- a) El dinero se entrega mediante **cheque nominativo o traspaso** a las cuentas del tercero.
- b) El tercero debe **identificar en cuenta independiente y solamente dedicada a este fin** los importes recibidos.
- c) El tercero solicita el CFDI **con el RFC del contribuyente**.
- d) El remanente debe reintegrarse **de la misma forma en que fue proporcionado el dinero**.
- e) **El dinero debe usarse o reintegrarse a más tardar el último día del ejercicio en que fue proporcionado**, salvo lo entregado en diciembre, que puede reintegrarse hasta el **31 de marzo del ejercicio siguiente**.

Y la sanción, textual: *"En caso de que transcurra el plazo mencionado… sin que el dinero se haya usado para realizar las erogaciones o reintegrado al contribuyente, **el tercero deberá emitir por dichas cantidades un CFDI de ingreso y reconocer dicho ingreso en su contabilidad** en el mismo ejercicio fiscal en el que fue percibido."*

Es decir: un anticipo no comprobado ni devuelto se convierte, por ministerio de la regla, **en ingreso acumulable del tercero**.

**El complemento que todavía no existe.** La regla obliga al tercero a emitir CFDI por sus servicios incorporando el complemento **"Identificación del recurso y minuta de gasto por cuenta de terceros"**. Pero el **Transitorio Décimo Segundo de la RMF 2026** dice, textual:

> "Para los efectos de las obligaciones establecidas en las reglas 2.7.1.12., 3.3.1.10., fracción III y 3.3.1.19., fracción III, referentes al complemento 'identificación de recurso y minuta de gastos por cuenta de terceros', **serán aplicables una vez que el SAT publique en su Portal el citado complemento** y haya transcurrido el plazo a que se refiere la regla 2.7.1.8., segundo párrafo."

Y hay una precisión de la regla hermana 2.7.1.19 (fedatarios, agentes aduanales y navieros) que conviene tener a mano porque revela la intención del SAT sobre ese complemento:

> "…el complemento 'Identificación del recurso y minuta de gastos por cuenta de terceros', **únicamente es de carácter informativo para la autoridad fiscal por lo que no puede ser usado por los contribuyentes para soportar deducciones o acreditamientos**."

**Traducción para Likida:** ese complemento nunca va a ser el comprobante de nada. La deducción siempre se sostiene en el CFDI del proveedor a nombre del contribuyente. El complemento es trazabilidad para el SAT.

**Nota de numeración:** esta regla era la **2.7.1.13** en la RMF 2019. Hoy es la **2.7.1.12**. Si algún material de Likida cita la 2.7.1.13 para gastos por cuenta de terceros, está citando la numeración de hace siete años; hoy la 2.7.1.13 es sobre el plazo para entregar CFDI a clientes del sector financiero.

**Nota de plazo:** hasta agosto de 2019 la regla daba **60 días** para el reintegro. Ese plazo ya no existe; hoy es el cierre del ejercicio. Cualquier política interna de "60 días para comprobar" es política de la empresa, no obligación fiscal.

### 3.6 Combustible: la regla que rompe el flujo de efectivo

LISR 27, fracción III, texto literal:

> "III. Estar amparadas con un comprobante fiscal y que **los pagos cuyo monto exceda de $2,000.00** se efectúen mediante transferencia electrónica de fondos…; cheque nominativo de la cuenta del contribuyente, tarjeta de crédito, de débito, de servicios, o los denominados **monederos electrónicos autorizados por el Servicio de Administración Tributaria**.
>
> Tratándose de la adquisición de **combustibles para vehículos marítimos, aéreos y terrestres, el pago deberá efectuarse en la forma señalada en el párrafo anterior, aun cuando la contraprestación de dichas adquisiciones no excedan de $2,000.00** y en el comprobante fiscal deberá constar la información del **permiso vigente**, expedido en los términos de la Ley de Hidrocarburos al proveedor del combustible y que, en su caso, dicho permiso no se encuentre suspendido, al momento de la expedición del comprobante fiscal."
>
> *(Párrafo reformado DOF 12-11-2021)*

El tercer párrafo abre una puerta: las autoridades fiscales *"podrán liberar de la obligación de pagar las erogaciones a través de los medios establecidos… cuando las mismas se efectúen en poblaciones o en zonas rurales, sin servicios financieros"*. Es una autorización individual que hay que tramitar, no una excepción automática.

**La válvula del sector: RFA 2026, regla 2.9.** Texto literal:

> "2.9. Los contribuyentes personas físicas o morales, dedicados exclusivamente al autotransporte terrestre de carga federal, que tributen conforme al Título II, Capítulo VII o Título IV, Capítulo II, Sección I de la Ley del ISR, considerarán cumplida la obligación establecida en el artículo 27, fracción III, segundo párrafo de la Ley del ISR, cuando los pagos por consumo de combustible se realicen con medios distintos a cheque nominativo…; tarjeta de crédito, de débito o de servicios; o monederos electrónicos autorizados por el SAT, **siempre que estos no excedan el 15 por ciento del total de los pagos efectuados por consumo de combustible para realizar su actividad**. Además, en el comprobante fiscal deberá constar la información del permiso vigente, expedido de acuerdo con la Ley de Hidrocarburos al proveedor del combustible…"

Esto es enormemente relevante para el producto: **existe un presupuesto anual de 15% de combustible pagable en efectivo**, y ese presupuesto es un contador acumulativo que hay que llevar viaje por viaje. Nadie lo lleva bien. Es una función que Likida puede construir en una tarde y que ninguna hoja de Excel calcula.

Ojo con el orden de las cosas: la facilidad **no exime del CFDI**. Exime del medio de pago. El comprobante fiscal sigue siendo obligatorio, con el permiso de la Ley de Hidrocarburos consignado.

### 3.7 Monederos de combustible: el hallazgo que cambia el producto

**Qué es un monedero, legalmente** (RMF 2026, regla 3.3.1.6):

> "…se entenderá como monedero electrónico cualquier dispositivo tecnológico que se encuentre asociado a un sistema de pagos utilizado por los contribuyentes en la adquisición de combustibles…, dicho sistema deberá proporcionar los servicios de liquidación y compensación de los pagos que se realicen entre los contribuyentes obligados…, los emisores de los monederos electrónicos y los enajenantes de combustibles.
>
> Los monederos electrónicos deberán incorporar **mecanismos tecnológicos de validación de la identificación del portador** del mismo, los cuales deberán incluir, por lo menos, la autenticación del portador…, los protocolos de seguridad del emisor… y deberán contemplar que los métodos tecnológicos de autenticación **se verifiquen directamente en las terminales** que… se habiliten en los puntos de venta de las estaciones de servicio.
>
> Los monederos electrónicos a que se refiere esta regla, **solo deberán utilizarse para la adquisición de combustibles**…, por lo que **no podrán utilizarse para disponer de efectivo, intercambiarse por títulos de crédito, ni para obtener bienes distintos a combustibles**."

**La regla que rompe la foto del ticket** (RMF 2026, regla 3.3.1.7), texto literal:

> "…las personas físicas y morales que adquieran combustibles… a través de los monederos electrónicos que al efecto autorice el SAT, podrán comprobar la erogación de las comisiones y otros cargos que cobre el emisor del monedero electrónico por sus servicios, así como el pago por la adquisición de combustibles, con el CFDI y el 'Complemento de Estado de Cuenta de Combustibles para Monederos Electrónicos Autorizados por el SAT', respectivamente, que expidan los emisores autorizados en términos de la regla 3.3.1.10., fracción III, **por lo que las estaciones de servicio no deberán emitir el CFDI a los clientes adquirentes de combustibles, por las operaciones que se realicen a través de monederos electrónicos autorizados por el SAT**.
>
> **La deducción por la adquisición de combustibles, así como el acreditamiento de los impuestos trasladados podrá realizarse hasta que el contribuyente adquirente del combustible, cuente con el CFDI y el complemento** a que se refiere el párrafo anterior **y hasta por el monto que ampare el citado complemento**."

Léase otra vez. Si la flota carga con monedero:

- La gasolinera **tiene prohibido** facturarle a la flota.
- El comprobante deducible es **el CFDI mensual (o diario o semanal) del emisor del monedero** con el Complemento de Estado de Cuenta de Combustibles.
- La deducción **sólo procede cuando ese CFDI existe** y **sólo hasta el monto que ampare el complemento**.

**El ticket que el operador fotografía en la gasolinera, en ese esquema, no sirve para deducir.** Sirve para control operativo (litros, hora, estación, odómetro), pero fiscalmente es aire.

**Qué trae el Complemento de Estado de Cuenta** (RMF 2026, regla 3.3.1.10, fr. III), textual — y esto es el esquema de datos que Likida debería consumir:

> "…un CFDI **diario, semanal o mensual**, por la adquisición de combustible, así como por el pago de las comisiones y otros cargos que el emisor cobre por sus servicios que contenga el 'Complemento de Estado de Cuenta de Combustibles para Monederos Electrónicos Autorizados por el SAT', en el que se incluya al menos **para cada consumo** lo siguiente: **número de monedero, fecha y hora, cantidad de litros, tipo de combustible, precio unitario y clave en el RFC de la estación de servicios** en la que se adquirió el combustible…"

Esto es un feed transaccional completo, timbrado, con granularidad por carga. **Es mejor dato que cualquier OCR de ticket**, y ya existe.

**Las demás obligaciones del emisor** (misma regla 3.3.1.10):
- Fr. I: mantener un banco de datos inviolable con **la información de los vehículos y personas autorizadas** por el contribuyente.
- Fr. IV: emitir a la estación de servicio un CFDI **de egresos** con el "Complemento de Consumo de Combustibles".
- Fr. VII: afiliar sólo estaciones con **permiso vigente** conforme a la Ley de Hidrocarburos, y **publicar en su página de Internet la lista de estaciones afiliadas**.
- Excepción: si el emisor y la estación son la misma persona, el emisor expide directamente el CFDI de la venta al adquirente.

**Lo que el Anexo 10 exige a los emisores** (DOF 09-01-2026). El Anexo 10 desarrolla los requisitos de verificación tecnológica. Entre los puntos que revelan qué controles existen realmente:

- Numeral 62: *"Reglas de negocio respecto a la relación entre beneficiarios y vehículos autorizados."*
- Numeral 64: las pruebas al ejemplar deben contemplar *"Verificación de protocolo de autenticación del beneficiario e identificación del vehículo"*, intentos de adquisición con el monedero bloqueado y desbloqueado, e *"Intento de transacción con el monedero electrónico con combustible distinto al definido en el monedero"*.
- Numeral 65: protocolos de comunicación de autenticación de beneficiarios e identificación de vehículos a beneficiarios **y a estaciones de servicio**, inhabilitación de monederos o beneficiarios, y cambios en datos de clientes y beneficiarios.

Es decir: el marco regulatorio **ya obliga** a que exista amarre monedero ↔ vehículo ↔ operador, con autenticación en terminal. Likida no necesita inventar ese control; necesita leerlo.

**Padrón de emisores autorizados (SAT, consultado 27-jul-2026).** Extracto de los relevantes para flotas de carga:

| Emisor | RFC | Producto | Autorizado desde |
|---|---|---|---|
| Edenred México, S.A. de C.V. | ASE930924SS7 | Ticket Car (Tarjeta Gasolina, Edenred, GAS CGI, Red Máxima) | 2005 / 2011 / 2012 / 2018 |
| Efectivale, S. de R.L. de C.V. | EFE8908015L3 | Efecticard; Efecticard Corporativo Vale Combustible | 2005 / 2015 |
| Sí Vale México, S.A. de C.V. | PUN9810229R0 | Magna Fleet, Premium Fleet, **Diesel Fleet**, Gas L.P. Fleet, Turbosina Fleet | 28-nov-2014 |
| Toka Internacional, S.A.P.I. de C.V. | TIN090211JC9 | easygas | 02-jun-2015 |
| Servicios Broxel, S.A.P.I. de C.V. | SBR130327HU9 | Broxel Gasoline Card | 15-ene-2015 |
| Sodexo Motivation Solutions México | PME811211B20 | Gaso Pass Card Control, Gaso Pass Movilidad, Wizeo | 2005 / 2015 / 2016 |
| Shell Solutions México, S.A. de C.V. | BGM141113GEA | Shell Fleet Navigator | 2020 |
| Total Fleet México, S.A. de C.V. | TFM191231NA7 | TOTAL CARD | 2022 |
| Petromax, S.A. de C.V. | PET040903DH1 | Petro-7 | 08-ene-2009 |
| Gasngo México, S.A. de C.V. | GME080312617 | GOSMO, TAG (anillo) GOSMO | 2010 |
| Vale Total, S.A. de C.V. | VTO1508246S6 | MINU Combustible (antes COMBUSTIBLE TOTAL) | 29-jun-2018 |
| Sistema Inteligente de Administración del Sureste | SIA030228F63 | Go Tanque Lleno | 2025 |
| Border Fuels and Energy, S.A. de C.V. | BFE150903SR1 | Nexogaz | 2025 |

El padrón completo tiene alrededor de 30 emisores autorizados desde 2005. **El SAT publica dos listas distintas en dos URLs distintas y no coinciden**: la de `omawww.sat.gob.mx` llega hasta 2018 y la de `sat.gob.mx/consultas/60450` incluye altas de 2019 a 2025 pero omite algunas de las viejas. Para integrar, hay que leer las dos. Existe además un padrón separado de **emisores no renovados**.

> **Nota de riesgo:** la autorización se renueva presentando un aviso entre **agosto y octubre de cada año** (ficha 7/ISR). Un emisor que no renueve deja de poder emitir el complemento, y sus clientes se quedan sin comprobante deducible. Likida debería verificar el estatus del emisor, no sólo su presencia histórica en la lista.

### 3.8 Casetas: quién factura depende de cómo se pagó

La lógica es simple y casi nadie la tiene codificada:

| Forma de pago | Quién emite el CFDI | Qué necesita |
|---|---|---|
| Efectivo o tarjeta en la caseta | **El operador de la autopista** (CAPUFE, Aleatica, IDEAL, gobiernos estatales…) | El folio de 18 dígitos o QR del ticket físico |
| Dispositivo TAG | **El proveedor del TAG** (IAVE, TeleVía, PASE, ViaPass, EasyTrip, SITAG) | Nada: el cruce queda registrado en la cuenta |

Consecuencias operativas:

- **Con TAG, perder el ticket no importa.** El cruce está en la cuenta del proveedor y se factura mensualmente consolidado. Para una flota, esto convierte decenas de tickets térmicos en un CFDI mensual por proveedor.
- **Sin TAG, perder el ticket es perder la deducción.** El papel térmico se borra.
- **No existe consolidación entre proveedores de TAG.** Una flota con IAVE y TeleVía recibe dos CFDI mensuales, uno por portal.
- **El RFC debe estar vinculado a la cuenta ANTES del cruce.** Si no lo estaba, ese peaje queda como no facturable y no hay forma de agregarlo retroactivamente.
- Si el TAG no es aceptado en una concesión, el cruce se cobra como efectivo (a veces con recargo) y **no aparece en la cuenta del TAG**: ese sí necesita ticket físico.

*(Toda esta sección es SIN VERIFICAR en fuente primaria: proviene de los portales de facturación de los proveedores y de guías especializadas. La lógica "quien cobró es quien factura" es consistente con el CFF 29, pero no encontré una regla de la RMF que la enuncie para peaje.)*

> **Advertencia sobre el "plazo de 30 días naturales" para facturar casetas.** Los portales y las guías lo presentan como "plazo estándar SAT". **No lo es.** No hay disposición fiscal que le imponga al cliente un plazo de 30 días para pedir una factura. Es política comercial de cada portal, y el límite legal real viene del ISR: la fecha de expedición del CFDI debe corresponder al ejercicio en que se deduce (LISR 27, fr. XVIII). Dicho eso, **para Likida el plazo operativo sí es el de los portales**, porque es el que cierra la ventana en la práctica.

### 3.9 Las facilidades del autotransporte de carga federal: qué hay y qué ya no hay

**Lo que SÍ está en la RFA 2026 (Título 2):**

| Regla | Qué permite | Condición crítica |
|---|---|---|
| **2.1** | Enterar **7.5%** de retención de ISR sobre pagos a operadores, macheteros y maniobristas, en lugar de las reglas de salarios | Referencia: el SBC del IMSS. Relación individualizada al 15-feb-2027 (ficha 65/ISR). **Sigue obligado el CFDI de nómina.** No aplica si presta servicios preponderantemente a una parte relacionada |
| **2.2** | Deducir hasta **8% de ingresos propios**, tope **$1,000,000** al año, **sin documentación con requisitos fiscales** | Pagar **16% de ISR** sobre lo deducido, definitivo, no acreditable ni deducible. Pagos provisionales al día 17. Informarlo en la anual en el campo "Facilidades administrativas y estímulos deducibles". **NO aplica a combustible** |
| **2.3** | Responsabilidad solidaria del coordinado **limitada a lo consignado en la liquidación** | Entregar anualmente al SAT el detalle por integrante |
| **2.4** | **Cuentas maestras**: permisionarios personas físicas pueden abrir cuentas maestras dinámicas o empresariales a nombre de cualquiera de ellos para las erogaciones de la empresa | Los movimientos deben concordar con los registros contables **y con la liquidación** que se emita a las permisionarias |
| **2.5** | Definición de coordinado | Requiere **"un manual de políticas para la aplicación de los gastos comunes y su prorrateo"** a disposición del SAT |
| **2.6** | Deducir donativos a organismos públicos descentralizados federales | Sólo proyectos de inversión productiva e infraestructura del autotransporte de carga |
| **2.9** | Pagar hasta **15% del combustible** por medios distintos a los del 27, fr. III | El CFDI debe consignar el permiso vigente de Ley de Hidrocarburos |
| **2.10** | Coordinados cumplen IVA por cuenta de integrantes; emiten liquidación vía CFDI de retenciones con **Complemento de Liquidación** | El complemento no se ha publicado (Transitorio Segundo) |
| **2.12** | Acreditamiento de estímulos fiscales (diésel/IEPS) | Ver el documento 04 de esta serie |

**Lo que YA NO está.** La facilidad histórica de deducir sin requisitos fiscales **maniobras, viáticos de la tripulación, refacciones y reparaciones menores** por montos fijos:

- Maniobras: $45.53 por tonelada en carga o por m³; $75.92 en paquetería; $182.24 en objetos voluminosos.
- **Viáticos de la tripulación: $113.90 por día.**
- Refacciones y reparaciones menores: $0.61 por kilómetro.

**Esta facilidad no aparece en ninguna parte de la RFA 2026.** Se comprobó buscando las palabras "maniobras", "tripulación", "refacciones", "reparaciones menores" y "113.90" en el texto íntegro de la Resolución: **cero coincidencias**. El Título 2 sólo contiene la deducción del 8%.

**Pero el SAT la sigue publicando en su portal.** La página `omawww.sat.gob.mx/…/facilidades_autocgafed.aspx` la muestra íntegra, con esos montos, al 27 de julio de 2026. Que esa página está congelada se comprueba con su propio contenido: el ejemplo de cálculo dice *"Ejemplo de la determinación del pago provisional de marzo de 2013"* y usa "ingresos propios del periodo (enero a marzo de **2012**)".

> **Esto es un riesgo real y concreto.** Un contralor que lea la página oficial del SAT en 2026 va a creer que puede deducir $113.90 por día de viáticos de tripulación sin comprobante. No puede. Si Likida construye una función basada en esa página, le va a costar dinero a un cliente. Si Likida **detecta** que el cliente lo está aplicando, tiene un hallazgo de valor inmediato que justifica la venta.

*(La misma advertencia aplica a la página gemela del Título 4 —carga de materiales y pasaje urbano/suburbano— que publica una facilidad del "10%" cuando la RFA 2026, regla 4.2, dice **8% con tope de $1,000,000**. Verificado en el PDF del DOF.)*

### 3.10 Multas: no deducibles

LISR 28, fracción VI: *"Las sanciones, las indemnizaciones por daños y perjuicios o las penas convencionales"* no son deducibles. Las multas de tránsito del operador nunca entran al costo del viaje como deducción. Sí entran como descuento en su liquidación, si está pactado por escrito y aceptado.

---

## 4. El software que ya existe

### 4.1 TMS y ERP de transporte en México

| Producto | Qué cubre de liquidación | Observación |
|---|---|---|
| **LISTMS** (LIS Software Solutions) | Módulo de Liquidaciones: sueldo por km, por comisión y por viaje; anticipos a operadores; "gastos de empresa comprobables a través de anticipos"; rendimiento de combustible por liquidación; cálculo automático de sueldo | El más explícito del mercado mexicano en el módulo de liquidación. ~30 años en el sector |
| **GetCastores** | "Desde planear el viaje hasta liquidar al operador". Liquidación quincenal o semanal con bonos, deducciones y recibo PDF. Presupuestos por viaje, casetas, depósitos al operador, tickets con foto ligados al viaje. Portal del conductor **offline** en navegador (sin app de tienda). Agente de WhatsApp con IA para dueños y administradores | Nacido de la operación de Castores. El offline sin app es una decisión de producto notable |
| **SM Road** | Flujo de viaje por etapas (Planeación → En tránsito → Entregado → Cerrado), gastos de viaje con flujos de aprobación, liquidaciones de operadores, **OCR de tickets de diésel desde foto de celular**, CFDI con Carta Porte validado contra catálogos SAT antes de timbrar | El competidor más cercano en el eje "OCR de ticket + liquidación + Carta Porte" |
| **ATD** | Liquidaciones como módulo del menú principal, junto a Bitácora, Proveedores, Facturación, Contabilidad y Taller. Genera póliza contable lista para importar | Vista kanban de viajes por etapa |
| **Mis Flotillas** | Módulo de liquidaciones de viaje/ruta con folio, unidad, conductor, ruta, origen/destino, centro de costo, detalle de conceptos y soportes, notas e incidencias, y **estado abierto/cerrado** | Su documentación de qué debe contener una liquidación es la mejor descripción pública del proceso que encontré |
| **Cárgalo** | Liquidaciones, telemetría GPS + dashcam, digitalización de cartas porte y facturas, agentes por WhatsApp y Telegram, validación cruzada app-móvil ↔ hardware del vehículo | Enfoque en flotas de menos de 20 unidades (declara que son el 97% del mercado mexicano) |
| **ClickBalance** | ERP: control de gastos operativos por unidad o ruta (combustible, casetas, viáticos), CFDI 4.0 con Carta Porte, pólizas automáticas | ERP generalista con vertical de transporte |
| **Chofex** | Seguimiento de viajes con IA, status a clientes y seguimiento a operadores en grupos de WhatsApp | No cubre liquidación |
| **TMSfirst, Cerca Technology, Novatrans, GMTransport, AG Solución, Solución ERP** | Distintos grados de "liquidación y pago de conductores" | No verifiqué el detalle funcional de cada uno |

*(Todo el contenido de esta tabla proviene de los sitios de los proveedores. SIN VERIFICAR de forma independiente.)*

### 4.2 Gestión de gastos y viáticos (no específicos de transporte)

| Producto | Qué resuelve | Lo que importa para Likida |
|---|---|---|
| **Control de Gastos / Gastos de Viaje (Focaltec)** | Anticipos con reglas y límites; buzón único de XML; **validación automática del CFDI ante el SAT y detección de EFOS**; relación gasto ↔ anticipo; **cálculo de deducibilidad conforme a la LISR** incluyendo faja mínima, categorías y montos máximos; conciliación de tarjetas corporativas; pólizas automáticas; obtención del CFDI a partir de la foto del ticket con OCR + IA gestionando la solicitud en el portal del comercio | **Es el que más cerca está del núcleo fiscal de Likida.** Un cliente suyo declara que hace validaciones fiscales *"un beneficio que no cubría CONCUR"* |
| **Rindegastos** (Chile, opera en MX) | Políticas 100% personalizables; anticipos, viáticos y **cajas chicas**; **"liquidación automática: el sistema cruza el gasto rendido contra el anticipo entregado"**; algoritmo de detección de gastos duplicados o fraudulentos comparando contra el histórico; kilometraje con GPS; **rendición de gastos por WhatsApp**; app con captura offline; Rindepay para el pago | El "cruce contra el anticipo" es literalmente el corazón de la liquidación. Y ya tiene WhatsApp |
| **Clara** | Tarjetas corporativas, políticas auto-aplicables, **recuperación y vinculación automática de facturas SAT (CFDI)**, conciliación, integración con ERP. Vinculación de comprobantes enviando foto o PDF a `factura+rfc@mx.clara.com`. Su producto `recuperafacturas.com` acepta **estados de cuenta de IAVE/PASE/TeleVía y tickets de gasolina por WhatsApp** y devuelve el CFDI | Plan gratuito con 50 comprobantes/mes; Pro a $5,000 MXN/mes con hasta 100 recuperaciones SAT |
| **Jeeves** | Tarjetas, políticas, **vinculación de facturas SAT, conexión con el SAT**, integración con NetSuite/Xero/QuickBooks | Planes desde $800 hasta $4,000 MXN/mes |

### 4.3 Monederos de combustible: qué controles ofrecen realmente

Tomando **Ticket Car de Edenred** como el más documentado (es el emisor más antiguo del padrón, autorizado desde 2005), los controles configurables publicados son:

- Restricción de días y horarios
- **Validación de conductor** (NIP asignado a tarjeta y vehículo)
- **Capacidad de tanque** (impide cargar más litros de los que caben)
- Caducidad de saldos
- **Validación de placas**
- Tipo de combustible
- **Intervalo de tiempo mínimo entre consumos**
- **Validación del rendimiento (odómetro)**
- **Validación de presencia vehicular**
- Restricción de gasolineras específicas
- Máximo de consumo por periodos
- Autorización remota de cargas por viaje: definiendo litros, operadores, estaciones y vigencia

En septiembre de 2025 lanzaron **Ticket Car+**, que añade certificación de cargas con GPS, validación automática de odómetro, **integración con los controles volumétricos de las estaciones** para que cada litro registrado corresponda al despachado, fondeo inmediato vía STP, operación offline con sincronización posterior, tarjeta virtual con pago por QR y **DriveTAG** (peaje integrado con TeleVía). Declaran 4,500 clientes y más de 6 millones de litros en la nueva plataforma a septiembre de 2025, con plan de migración total antes de cerrar 2026.

*(SIN VERIFICAR: cifras y funciones declaradas por el proveedor y por prensa especializada.)*

**Lo que esto significa para Likida:** el problema de "el operador cargó 600 litros en un tanque de 400" **ya está resuelto en la capa de pago**, no en la capa de comprobación. Likida no debería competir con eso. Debería consumirlo.

### 4.4 El competidor directo: Uvicuo

Hay que decirlo sin rodeos: **existe una empresa mexicana haciendo exactamente lo que Likida describe.**

**Uvicuo** (Uvicuo, S.A.P.I. de C.V.), CDMX. Fundada por Iker Haro Escandón y Diego Galindo. Se presentó formalmente en noviembre de 2025 con alianza con **Mastercard** (vía el programa Start Path). Reporta ~16 empleados y ~$4M USD de financiamiento total.

Su propuesta, en sus palabras: *"Centraliza en una solución la gestión de todos tus gastos en ruta, desde combustible, peajes y viáticos hasta el efectivo. Automatizamos todo el proceso de vida del gasto, desde la presupuestación, dispersión y método de pago hasta la comprobación, facturación y contabilización del mismo."*

Lo que ofrece:
- **Tarjeta Uvicuo Mastercard** única para combustible, casetas, hospedaje, alimentos y servicios, con montos, fechas y lugares de uso configurables. Incluye retiro de efectivo controlado.
- **Facturación de gastos en tiempo real a través de WhatsApp.** El operador manda la foto del ticket; **si es combustible, se le pide también la foto del odómetro** para calcular kilómetros recorridos. La IA extrae los datos y tramita las facturas.
- **Integración directa de TAGs** para casetas.
- Políticas inteligentes que aprenden de los patrones de gasto y **sistema de alertas de combustible para detectar y prevenir fraudes en tiempo real**.
- **Asistente de voz** que llama al operador para preguntarle por qué no ha subido las imágenes, y puede escalar a humano. Bloqueo de tarjeta ante anomalías.
- Líneas de crédito operativas para eliminar fondos fijos.

Declaran ahorro promedio de 10% (y hasta 7% en combustible).

**Otros que ya tocan el mismo canal:** Rindegastos (rendición por WhatsApp), Clara vía recuperafacturas.com (tickets y estados de cuenta de TAG por WhatsApp), GetCastores (agente de WhatsApp para dueños), Cárgalo (agentes por WhatsApp y Telegram), KODS y Chofex (WhatsApp para tráfico y seguimiento).

**Conclusión incómoda pero necesaria: "WhatsApp + foto del ticket + IA" en autotransporte mexicano ya está ocupado, financiado y con Mastercard detrás.** No es un espacio en blanco.

### 4.5 Benchmark: cómo se resolvió esto en Estados Unidos

El sector estadounidense lleva veinte años con esto resuelto bajo el nombre de **driver settlement**. Vale la pena porque el patrón arquitectónico es transferible:

- La liquidación **se calcula desde los viajes despachados**, no desde una captura aparte. El TMS jala las cargas completadas, aplica el plan de pago almacenado de cada operador (por milla, por porcentaje, por viaje o mixto) y calcula el bruto sin captura manual.
- **Las transacciones de la tarjeta de combustible se importan automáticamente y se emparejan con el operador correcto.** El error clásico que previenen: cargos de una tarjeta descontados al operador equivocado.
- **Se concilia el combustible a diario, no el día de la liquidación.** Textual de una guía del sector: *"No espere al día de la liquidación para descubrir un problema con las transacciones de la tarjeta."*
- Los peajes se integran por proveedor (Bestpass, PrePass, IPass) y entran a la liquidación sin captura.
- **Anticipos y fondos en garantía llevan saldo corriente por operador**, y se aplican automáticamente en cada corrida.
- El estado de cuenta que recibe el operador es **línea por línea, con fecha, lugar, galones e importe de cada transacción**. La transparencia es, según los proveedores, *"el factor individual más importante para reducir disputas"*.
- Auditoría interna mensual de 3 a 5 liquidaciones completas, punta a punta.
- Anomalías investigadas antes de aparecer como deducción: *"una compra de $600 de combustible cuando el tanque sólo tiene capacidad de 300 galones amerita investigación"*.

*(SIN VERIFICAR: material comercial de proveedores estadounidenses. Sirve como patrón, no como norma.)*

### 4.6 El mapa de brechas

| Pieza del proceso | ¿Quién ya lo hace bien? | ¿Queda hueco? |
|---|---|---|
| Control del gasto **antes** de que ocurra (límites, litros, estaciones, horarios, tanque) | Monederos de combustible (Edenred, Toka, Broxel, Sí Vale…) | **No.** Está resuelto y regulado |
| Comprobante fiscal de combustible | Emisor del monedero, por regla 3.3.1.7 | **No.** Y además el ticket es irrelevante ahí |
| Comprobante fiscal de casetas | Proveedores de TAG | **No**, si hay TAG |
| Captura por foto y OCR | Focaltec, Rindegastos, Clara, SM Road, Uvicuo | **Casi no.** Es commodity |
| Canal WhatsApp | Rindegastos, Clara, Uvicuo, GetCastores, Cárgalo | **No.** Ya ocupado |
| Validación del CFDI y detección de EFOS | Focaltec | Parcial |
| Cálculo de deducibilidad conforme LISR | Focaltec (declarado) | Parcial |
| Cruce comprobación ↔ anticipo | Rindegastos, LISTMS, GetCastores, SM Road | Parcial |
| **Cruce del gasto contra la realidad física del viaje** (km recorridos, litros contra rendimiento esperado, casetas contra el corredor de la ruta, tiempos contra días de viático) | Nadie lo cierra completo. Edenred valida odómetro; los TMS conocen la ruta; los de gastos conocen el ticket. **Nadie tiene los tres** | **SÍ. Éste es el hueco** |
| **Contador del 15% de combustible en efectivo** (RFA 2.9) | Nadie que yo haya encontrado | **SÍ** |
| **Contador del 8% / $1,000,000 de deducción ciega** (RFA 2.2) con su ISR del 16% | Nadie que yo haya encontrado | **SÍ** |
| **Contador del 20% / $15,000 anual por operador** (RLISR 152) con verificación de que el 80% fue con tarjeta del patrón | Nadie que yo haya encontrado | **SÍ** |
| **Faja de 50 km por operador** | Focaltec lo menciona como "faja mínima" | Parcial |
| Timbrado correcto de viáticos en nómina (003/050/081) | Los sistemas de nómina | Parcial: el problema no es timbrar, es **saber qué monto va en cada clave** |

---

## 5. Mejores prácticas para automatizar de punta a punta

### 5.1 Anticipo

1. **Presupuestar contra la ruta, no contra la costumbre.** Litros = km de la ruta ÷ rendimiento histórico de esa unidad en ese tipo de carga. Casetas = suma de las plazas del corredor. Viáticos = días × tope por concepto según política (nunca por encima de los topes de LISR 28, fr. V).
2. **Separar el presupuesto en dos bolsas desde el origen**: Bolsa A (unidad: diésel, casetas, talacha) y Bolsa B (persona: alimentación, hospedaje). Van por caminos fiscales distintos y no deben mezclarse jamás.
3. **Dispersar por el medio que corresponde a cada bolsa.** Combustible → monedero autorizado. Casetas → TAG de la empresa. Viáticos → tarjeta del patrón (para preservar el 20% del RLISR 152). Efectivo → sólo el residuo mínimo, y contra fondo fijo.
4. **Nunca a cuenta personal.** Si es inevitable, documentar el registro contable que lo separa del salario (LSS 27, penúltimo párrafo).
5. **Fijar el régimen desde el alta del operador**: empleado (ruta viáticos) vs. tercero/hombre-camión (ruta 2.7.1.12). No se puede decidir al final.

### 5.2 Captura de gastos

6. **Capturar en el momento del gasto, no al regreso.** El comprobante térmico se degrada y la ventana de los portales se cierra.
7. **Capturar el contexto, no sólo el importe.** Odómetro con cada carga de combustible. Geolocalización con cada gasto. Viaje al que pertenece. Sin eso, el gasto no se puede auditar contra la ruta.
8. **Funcionar sin señal.** La carretera mexicana tiene tramos sin datos. Captura local, sincronización diferida. GetCastores lo resolvió con portal web offline sin app de tienda; es el patrón correcto.
9. **No pedir lo que ya se tiene.** Si la flota usa monedero, **no pedir foto del ticket de diésel para efectos fiscales** — el CFDI ya viene en el estado de cuenta. Pedirla sólo si aporta el odómetro o si sirve para detectar desviación.
10. **Validar el CFDI contra el SAT, no contra el PDF.** El servicio público de validación del SAT confirma vigencia y avisa si el emisor está en la lista del 69-B.

### 5.3 Conciliación contra el anticipo

11. **Tres desenlaces, no dos**: igual (cierra), mayor (autoriza y reembolsa), menor (descuenta o exige reintegro).
12. **Conciliar a diario, no al cierre.** Es la lección más repetida del benchmark estadounidense.
13. **Saldo corriente por operador**, visible para él. Los anticipos vivos, los reintegros pendientes y los descuentos programados deben ser consultables por el operador en cualquier momento.
14. **Cerrar la liquidación explícitamente.** Estado abierto/cerrado. Una liquidación que sigue aceptando tickets tres semanas después contamina el periodo.

### 5.4 Detección de desviaciones y política de gasto

Las reglas que valen la pena, ordenadas de más a menos determinista:

| Regla | Qué detecta | Dato que requiere |
|---|---|---|
| Litros cargados > capacidad del tanque | Carga a un tercero, ordeña | Ficha de la unidad |
| Rendimiento real vs. esperado, por unidad y por ruta | Ordeña, carga incompleta, odómetro falso | Odómetro + litros + ruta |
| Carga fuera de geocerca de la ruta | Desvío o carga ajena | GPS + ruta planeada |
| Dos cargas en intervalo menor al mínimo | Doble carga o carga a tercero | Timestamps |
| Casetas cobradas que no pertenecen al corredor | Uso personal de la unidad o del TAG | Catálogo de plazas por ruta |
| Días de viático > días de viaje | Inflado de viáticos | Fechas de inicio y fin del viaje |
| Gasto de alimentación > $750/día nacional | Exceso sobre el tope de LISR 28, fr. V | Tope de ley |
| Gasto dentro de 50 km de la base | Viático no deducible | Base de asignación del operador |
| Comprobante duplicado (mismo folio, mismo importe, misma fecha) | Doble cobro | Histórico de comprobantes |
| Comprobante ya usado en otra liquidación | Reciclado | Índice global de UUID |
| Emisor en lista 69-B | Factura de EFOS | Consulta al SAT |
| Combustible en efectivo acumulado > 15% del total | Pérdida de la facilidad de RFA 2.9 | Contador anual |
| Deducción ciega acumulada > 8% de ingresos o > $1,000,000 | Exceso sobre RFA 2.2 | Contador anual + ingresos |
| No comprobado del operador > 20% de la ocasión o > $15,000 al año | Pérdida de exención del RLISR 152 | Contador por persona |
| 80% del viático no se erogó con tarjeta del patrón | Pérdida de exención del RLISR 152 | Medio de pago por gasto |

Las últimas cuatro son las que nadie tiene y las que un contralor no puede calcular a mano.

### 5.5 Cierre y contabilización

15. **La póliza debe separar por régimen**, no por proveedor: costo de operación (Grupo A), viáticos deducibles dentro de tope (Grupo B), viáticos excedidos (no deducible), gasto sin comprobante fiscal aplicable a la facilidad del 8%, y multas (no deducible).
16. **Alimentar el CFDI de nómina con los importes correctos** de las claves 003, 050 (gravado y exento por separado) y 081.
17. **Cerrar el ejercicio con los reintegros al corriente.** Si el operador es un tercero bajo la regla 2.7.1.12, el dinero no usado ni reintegrado al 31 de diciembre se convierte en su ingreso acumulable.
18. **Guardar el expediente completo del viaje**, no sólo el XML: presupuesto, anticipo con su comprobante de dispersión, cada gasto con su CFDI y su evidencia, las validaciones que corrieron, quién autorizó qué y cuándo, y la liquidación firmada.

---

## 6. El proceso automático que yo recomendaría para Likida

### 6.1 La decisión de encuadre: no ser el que captura, ser el que cuadra

El mercado ya tiene quien capture tickets por WhatsApp. Lo que no tiene es quien responda con autoridad: **"este viaje costó $X, de los cuales $Y son deducibles, $Z te va a costar en ISR porque los metiste a la facilidad, y al operador le tienes que timbrar $W como gravado."**

La primera decisión de diseño es esa: **Likida es un motor de cuadre y de deducibilidad, no un OCR.** El OCR es un insumo, y en el caso del combustible con monedero, ni siquiera es necesario.

### 6.2 El modelo de datos mínimo

Cinco entidades y las relaciones que las amarran:

- **Operador**: régimen (empleado subordinado / tercero-permisionario), base de asignación (para la faja de 50 km), tarjeta o monedero asignado, saldo corriente, contador anual de no comprobados.
- **Unidad**: capacidad de tanque, rendimiento esperado por tipo de carga, TAG asignado, monedero asignado.
- **Viaje**: folio, origen, destino, ruta (con sus plazas de cobro y su distancia), fechas de inicio y fin, operador, unidad, centro de costo, cliente, estado (abierto/cerrado).
- **Anticipo**: monto, bolsa (unidad / persona), medio de dispersión, fecha, comprobante de dispersión.
- **Gasto**: concepto, grupo fiscal (A o B), importe, IVA, fecha, geolocalización, odómetro (si aplica), medio de pago, evidencia (foto), CFDI vinculado (UUID), estado de validación, viaje al que pertenece, anticipo contra el que se aplica.

Sin `base de asignación del operador`, `capacidad de tanque` y `ruta con plazas`, la mitad de las reglas de §5.4 no se pueden correr. Son los campos que hay que arrancar del cliente en el onboarding aunque duela.

### 6.3 La máquina de estados de la liquidación

```
PRESUPUESTADA
   │  (se aprueba el presupuesto contra la ruta)
   ▼
ANTICIPADA ──────────► dispersión por bolsa y por medio
   │
   ▼
EN RUTA ─────────────► captura continua de gastos con contexto
   │                   validación en línea de cada gasto
   ▼
EN COMPROBACIÓN ─────► ingesta del estado de cuenta del monedero
   │                   ingesta del CFDI mensual del TAG
   │                   validación de CFDI ante el SAT + 69-B
   │                   corrida de las reglas de desviación
   ▼
EN EXCEPCIÓN ────────► sólo lo que las reglas marcaron
   │  (autoriza o rechaza el contralor; todo lo demás pasó solo)
   ▼
CUADRADA ────────────► saldo a favor / en contra del operador
   │                   clasificación fiscal por concepto
   ▼
CERRADA ─────────────► póliza + insumos para CFDI de nómina
                       (no admite más cargos)
```

El punto crítico del diseño es **EN EXCEPCIÓN**: el contralor no debe revisar la liquidación, debe revisar **sólo lo que falló una regla**. Si Likida le pone al contralor una pantalla con 40 gastos para aprobar uno por uno, no le ahorró nada.

### 6.4 Las siete reglas duras que Likida debe correr y nadie más corre

1. **Contador de combustible en efectivo vs. 15%** (RFA 2026, 2.9). Alerta a 12%, bloqueo a 15%.
2. **Contador de deducción ciega vs. 8% de ingresos propios y $1,000,000** (RFA 2026, 2.2), con el cálculo del ISR del 16% que hay que enterar al día 17 del mes siguiente.
3. **Contador de viáticos no comprobados por operador vs. 20% por ocasión y $15,000 anuales** (RLISR 152), **más** la verificación de que el 80% restante se erogó con tarjeta del patrón. Si no, el no comprobado es gravado, no exento.
4. **Faja de 50 km**: cualquier viático erogado dentro de 50 km de la base de asignación se marca como no deducible (LISR 28, fr. V; RLISR 57).
5. **Topes diarios por concepto y por persona**: $750 alimentación nacional, $1,500 extranjero, $850 renta de auto, $3,850 hospedaje extranjero. **Sin tope de hospedaje nacional.**
6. **Clasificación Grupo A vs. Grupo B**: diésel, casetas, talacha, maniobras y pensión NUNCA son viáticos. Si el cliente los está metiendo ahí, es un hallazgo que se le reporta.
7. **Régimen del beneficiario**: si es hombre-camión o permisionario, los "viáticos" que se le dan no son deducibles como gasto de viaje (LISR 28, fr. V exige relación laboral o servicios profesionales). Se le tiene que exigir CFDI de flete.

### 6.5 Las integraciones que valen más que cien features

En orden de retorno:

1. **Estados de cuenta de monederos de combustible.** Es un feed timbrado con litros, fecha, hora, RFC de estación y número de monedero, por consumo (RMF 3.3.1.10, fr. III). Es mejor dato que cualquier foto. Empezar por Edenred, Efectivale, Sí Vale, Toka y Broxel, que cubren la mayoría de las flotas medianas.
2. **CFDI mensuales de los proveedores de TAG.** IAVE, PASE, TeleVía cubren casi todo el peaje de carga.
3. **Descarga masiva del SAT.** Los CFDI emitidos a nombre de la empresa ya están en el SAT. Bajarlos y **emparejarlos contra los gastos capturados** cierra el círculo sin pedirle nada al operador.
4. **GPS/telemetría** para km recorridos y geocercas. Es lo que permite las reglas de rendimiento y de desvío.
5. **Salida contable** (póliza) y **salida de nómina** (importes por clave 003/050/081).

### 6.6 Lo que Likida NO debería prometer

- **No prometer que la foto del ticket de diésel es el comprobante.** Si el cliente usa monedero, es falso por regla expresa (3.3.1.7). Si no usa monedero y pagó en efectivo, tampoco sirve (27, fr. III).
- **No prometer "recuperación de facturas" como diferenciador.** Clara, Focaltec y Uvicuo ya lo hacen, y algunos gratis hasta cierto volumen.
- **No prometer generar la "liquidación fiscal" del coordinado.** El Complemento de Liquidación no está publicado (RFA 2026, Transitorio Segundo).
- **No prometer "60 días para comprobar" ni "30 días".** No existen esos plazos. El plazo fiscal real es el cierre del ejercicio (RMF 2.7.1.12, fr. II, inciso e) y el operativo lo fija cada portal de facturación.
- **No prometer la facilidad de "$113.90 por día de viáticos de tripulación".** No existe en 2026, por más que el portal del SAT la publique.
- **No prometer que WhatsApp es el diferenciador.** Ya no lo es.

---

## Qué cambia esto en Likida

**Qué hay que construir**

1. **Un motor de reglas fiscales con contadores acumulativos**, no un clasificador de tickets. Los cinco contadores (15% combustible en efectivo, 8%/$1M de deducción ciega, 20%/$15,000 por operador, topes diarios por concepto, faja de 50 km) son la propuesta de valor defendible. Nadie los lleva.
2. **Taxonomía de dos grupos desde el primer día**: gastos de la unidad vs. viáticos de la persona. Es la decisión de modelo de datos que más se va a pagar y la más difícil de meter después.
3. **Ingesta del estado de cuenta de monederos de combustible** antes que cualquier mejora de OCR. Es dato timbrado, granular y gratuito.
4. **Campo `régimen del operador`** (empleado subordinado vs. tercero) en el alta, con dos flujos completamente distintos aguas abajo. No es un flag cosmético: cambia el comprobante, el plazo, el medio de pago obligatorio y el destino contable.
5. **Campo `base de asignación`** por operador. Sin él, no se puede evaluar la faja de 50 km, que es lo que puede invalidar la deducción entera de una flota urbana.
6. **Campo `capacidad de tanque`** por unidad y `rendimiento esperado` por unidad y tipo de carga. Son la base de las reglas de desviación de combustible.
7. **Pantalla de excepciones, no pantalla de aprobación.** El contralor sólo ve lo que falló una regla.
8. **Salida de nómina con los tres importes**: OtrosPagos 003, Percepción 050 desglosada en gravado y exento, Deducción 081. Con la advertencia de que el exento depende de las cinco condiciones del RLISR 152, no de copiar la tabla del SAT.

**Qué hay que validar con clientes reales**

9. **¿Cuántas de las flotas objetivo ya usan monedero de combustible?** Si la respuesta es "la mayoría", el pitch de "manda la foto del ticket de diésel" se cae y hay que reescribirlo como "conectamos tu monedero". Si la respuesta es "casi ninguna", entonces el 15% de la regla 2.9 es el gancho, porque están perdiendo deducciones sin saberlo.
10. **¿Cuántas están aplicando la facilidad del 8%?** ¿Y saben que tienen que pagar 16% de ISR definitivo sobre eso, en pagos provisionales al día 17? Este es un diagnóstico de dos preguntas que abre una conversación de venta.
11. **¿Cuántas siguen depositando anticipos a cuentas personales de operadores?** Es la exposición al IMSS más grande y la más fácil de demostrar.
12. **¿Cuántas están tratando viáticos de hombres-camión como gasto de viaje?** No es deducible por esa vía.
13. **Verificar si la faja de 50 km realmente muerde** en el segmento objetivo, o si todos los viajes son de largo recorrido. Cambia la prioridad de esa regla.

**Qué hay que dejar de prometer**

14. "Mandas la foto y ya está deducido" — falso cuando hay monedero y falso cuando hubo efectivo en combustible.
15. "Recuperamos tus facturas por WhatsApp" como diferenciador — commodity.
16. "Te generamos la liquidación fiscal" — el complemento no existe.
17. "Tienes 60 días para comprobar" — ese plazo se derogó en 2019.
18. Cualquier cifra tomada de la página de facilidades del autotransporte del portal del SAT, que está congelada desde 2013.

**Cómo cambia el posicionamiento frente a Uvicuo**

19. Uvicuo compite en la capa de **medio de pago + captura** (tarjeta Mastercard + WhatsApp + IA). Likida no debería pelear ahí: es una pelea de balance y de emisión de plástico, y Uvicuo ya la tiene con Mastercard y $4M.
20. El terreno donde Uvicuo (y todos) está débil es la **capa de deducibilidad y de facilidades del sector**: los contadores del 15%, del 8%, del 20%, la faja de 50 km y la separación Grupo A / Grupo B. Es un terreno de conocimiento fiscal específico del autotransporte mexicano, no de fintech.
21. Corolario: **el comprador natural cambia.** No es el dueño de la flota que quiere control del gasto (ése ya tiene monedero y ahora tiene Uvicuo). Es **el contralor que tiene que defender la deducción ante una revisión** y hoy no tiene con qué. Eso es consistente con el segmento que Likida ya definió.

---

## SIN VERIFICAR

Todo lo siguiente NO pude comprobarlo en fuente primaria. Va marcado para que nadie lo cite como fundamento.

1. **El plazo de "30 días naturales" para facturar casetas.** Lo publican los portales de TAG y las guías especializadas como "plazo estándar SAT". No encontré ninguna disposición fiscal que lo establezca. Mi lectura es que es política comercial de cada portal, no norma. **No lo cites como obligación legal.**
2. **La lógica "quien cobró el cruce es quien factura" en peaje.** Es coherente con el CFF 29 y con cómo operan los portales, pero no encontré regla de la RMF que la enuncie para peaje. Proviene de los portales de IAVE, PASE y TeleVía y de guías de terceros.
3. **Si el "Complemento de Liquidación" fue publicado entre febrero y julio de 2026.** Verifiqué que la RFA 2026 (17-feb-2026) todavía lo trata como no publicado en su Transitorio Segundo. No revisé el portal de complementos del SAT en julio de 2026 para confirmar que sigue sin publicarse.
4. **Todas las funcionalidades de software de la sección 4.** Provienen de los sitios web de los proveedores. No probé ningún producto, no vi demos, no hablé con clientes. Trátalo como "lo que dicen que hacen", no como "lo que hacen".
5. **Las cifras de Edenred** (7,000 gasolineras, 6,500 en material anterior, 4,500 clientes en Ticket Car+, 6 millones de litros, plan de migración). Declaradas por el proveedor y por prensa especializada (T21).
6. **Todo lo relativo a Uvicuo**: financiamiento ($4M), plantilla (~16), alianza con Mastercard, funcionalidades, ahorro declarado del 10% y del 7% en combustible. Proviene de su sitio, de notas de prensa (El Economista, TheMarketHink, Revista Magazzine) y de un perfil de empresa. No verificado de forma independiente.
7. **El dato de que "30% de la rotación de operadores es por desajuste de cuentas".** Declaración del fundador de Uvicuo en El Economista (23-dic-2025). No hay estudio detrás que yo haya visto.
8. **El dato de "aproximadamente 60,000 operadores según CANACAR"** citado en una nota sobre Uvicuo. La cifra parece referirse al **déficit** de operadores, no al total del país, pero la nota es ambigua. No lo uses.
9. **El benchmark de driver settlement estadounidense** (§4.5). Material comercial de FleetLegend, PCS, Transport Pro, Truckin y ZuzHQ. Sirve como patrón de diseño, no como norma ni como benchmark cuantitativo.
10. **El porcentaje de flotas mexicanas con menos de 20 unidades ("97%").** Lo declara Cárgalo en su sitio. No lo contrasté con estadística de la SICT ni de CANACAR.
11. **El artículo 84 de la Ley Federal del Trabajo** (integración del salario). Lo citan varias fuentes secundarias en el argumento sobre depósitos a cuentas personales. **No leí el texto directamente**, así que el documento se apoya sólo en el artículo 27 de la LSS, que sí leí en el PDF de la Cámara de Diputados.
12. **Si la LISR fue reformada después del 01-04-2024.** El PDF oficial de la Cámara de Diputados consultado el 27-jul-2026 declara esa como última reforma. Si el paquete económico 2026 (DOF 07-11-2025) tocó la LISR, ese PDF no lo refleja y habría que revisarlo.
13. **La interpretación de la faja de 50 km para operadores de carga federal.** El RLISR 57 define "establecimiento" como donde la persona presta normalmente sus servicios. Para un operador de largo recorrido eso es genuinamente discutible. No encontré criterio del SAT ni tesis que lo resuelva. **Es un riesgo interpretativo abierto, no una certeza.**
14. **El estatus de vigencia de cada emisor del padrón de monederos.** El padrón publica autorizaciones históricas desde 2005; la autorización se renueva anualmente vía ficha 7/ISR. No verifiqué cuáles siguen vigentes en 2026 ni consulté el padrón de "no renovados".
15. **Las descripciones del proceso operativo de las secciones 2.1 a 2.6.** Están construidas a partir de material de proveedores (Mis Flotillas, LISTMS, Smart Fleet, Ubícalo), de un procedimiento de viáticos corporativo publicado y de las obligaciones legales. **No entrevisté a ningún contralor de flota.** Es una reconstrucción razonada, no etnografía.

---

## Fuentes

### Fuentes primarias (leídas íntegras o en la sección citada)

- **Ley del Impuesto sobre la Renta**, última reforma DOF 01-04-2024 — arts. 27 fr. III, 28 fr. V y VI, 72, 73, 93 fr. XVII, 99 fr. III y VI. https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf
- **Reglamento de la Ley del Impuesto sobre la Renta**, última reforma DOF 06-05-2016 — arts. 41, 57, 58, 152, 263. https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LISR_060516.pdf
- **Ley del Seguro Social**, última reforma DOF 15-01-2026 — art. 27. https://www.diputados.gob.mx/LeyesBiblio/pdf/LSS.pdf
- **Resolución Miscelánea Fiscal para 2026**, DOF 28-12-2025 — reglas 2.7.1.12, 2.7.1.19, 2.7.5.3, 3.3.1.6, 3.3.1.7, 3.3.1.10, Transitorio Décimo Segundo. https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/RMF_2026-DOF-28122025.pdf
- **Primera Resolución de Modificaciones a la RMF 2026**, DOF 09-07-2026. https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/1aRM_RMF2026.pdf
- **Anexo 10 de la RMF 2026** — Obligaciones y requisitos de los emisores de monederos electrónicos, DOF 09-01-2026. https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo_10_RMF2026-09012026.pdf
- **Resolución de Facilidades Administrativas para 2026**, DOF 17-02-2026 — Título 2 completo (reglas 2.1 a 2.13), Título 4 (reglas 4.1 a 4.9), Transitorios. https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rfa/rfa/RFA2026_17022026.pdf
- Misma resolución en el DOF: https://www.dof.gob.mx/nota_detalle.php?codigo=5780249&fecha=17/02/2026
- **SAT — Caso de Uso: Reporte de viáticos en el recibo de nómina** (claves 003, 050, 081). http://omawww.sat.gob.mx/informacion_fiscal/factura_electronica/Documents/Complementoscfdi/Caso_uso_Rep_vi%C3%A1tic_nomina.pdf
- **SAT — Guía de llenado del comprobante del recibo de pago de nómina y su complemento** (campo TotalOtrosPagos). http://omawww.sat.gob.mx/informacion_fiscal/factura_electronica/Documents/Complementoscfdi/guianomina.pdf
- **SAT — Emisores de monederos electrónicos de combustibles autorizados** (padrón histórico). http://omawww.sat.gob.mx/terceros_autorizados/monederos_electronicos/Paginas/emisores_monelectro_combustibles_autorizados.aspx
- **SAT — Padrón de emisores de monederos electrónicos de combustibles autorizados** (altas 2019-2025). https://wwwmat.sat.gob.mx/consultas/60450/padron-de-emisores-de-monederos-electronicos-de-combustibles-autorizados
- **SAT — Sector de autotransporte terrestre de carga federal** (página desactualizada, ejemplo de 2013). http://omawww.sat.gob.mx/informacion_fiscal/obligaciones_fiscales/personas_morales/regimen_simplificado/Paginas/facilidades_autocgafed.aspx
- **SAT — Sector de autotransporte de carga de materiales y pasajeros urbano y suburbano** (también desactualizada, cita 10%). http://omawww.sat.gob.mx/informacion_fiscal/obligaciones_fiscales/personas_morales/regimen_simplificado/Paginas/facilidades_autourbano.aspx
- **SAT — Preguntas sobre deducción de combustibles**. http://m.sat.gob.mx/terceros_autorizados/monederos_electronicos/Paginas/preguntasf_deduccion_combustibles.aspx
- **SAT — Preguntas frecuentes monederos electrónicos de combustibles**. https://www.gob.mx/sat/acciones-y-programas/preguntas-frecuentes-monederos-electronicos-de-combustibles
- **SAT — Solicitud de autorización para emitir monederos electrónicos de combustibles** (ficha 6/ISR). http://omawww.sat.gob.mx/informacion_fiscal/tramites/mon_elec/Paginas/ficha_6_isr.aspx

### Fuentes secundarias (pistas, no fundamento)

- Uvicuo (sitio y producto). https://www.uvicuo.com/es
- Uvicuo — riesgos fiscales de depositar a tarjetas personales. https://www.uvicuo.com/en/uviblog/riesgos-fiscales-de-depositar-a-tarjetas-personales
- El Economista — "Buscan bajar rotación de transportistas con tecnología" (23-dic-2025). https://www.eleconomista.com.mx/empresas/buscan-bajar-rotacion-transportistas-tecnologia-20251223-792631.html
- TheMarketHink — "Uvicuo moderniza gestión de gastos en transporte y logística con IA". https://www.themarkethink.com/negocios/uvicuo-gastos-transporte-y-logistica-ia/
- Revista Magazzine — "Uvicuo presenta solución para optimizar gastos operativos en flotas". https://revistamagazzine.com/proveedores/uvicuo-presenta-solucion-para-optimizar-gastos-operativos-en-flotas/
- T21 — "Edenred lanza Ticket Car+ para fortalecer control del combustible en flotillas". https://t21.com.mx/edenred-lanza-ticket-car-para-fortalecer-control-del-combustible-en-flotillas/
- Edenred México — Vales de gasolina Ticket Car (controles configurables). https://www.edenred.mx/vales-de-gasolina-ticket-car
- Edenred México — Control fiscal: herramientas inteligentes para gastos de tu flota. https://www.edenred.mx/blog/control-fiscal-herramientas-inteligentes-para-gastos-de-tu-flota
- LIS Software Solutions — LISTMS, módulo de liquidaciones. https://lis.com.mx/sistema-administracion-flotillas-transporte/
- GetCastores — software de gestión de flotillas. https://getcastores.mx/
- SM Road — gestión de transporte y cumplimiento SAT. https://sm-road.com/
- Mis Flotillas — "Qué debe incluir una liquidación de viaje o ruta para que sí sirva en operación". https://misflotillas.com/blog/que-debe-incluir-una-liquidacion-de-viaje-o-ruta
- Cárgalo — infraestructura IA para el transporte de carga. https://cargalo.mx/
- ATD — plataforma de flota. https://atdmx.com/clients.html
- ClickBalance — ERP para empresas de transporte. https://clickbalance.com/para/transporte
- Chofex — monitoreo de flota con IA. https://chofex.com/
- Focaltec — Control de Gastos / Gastos de Viaje. https://www.gastosdeviaje.mx/ y https://www.focaltec.com/gastos-de-viaje/
- Rindegastos — producto, viáticos y RindePay. https://rindegastos.com/es-mx/producto y https://rindegastos.com/es-mx/producto/viaticos
- Clara — gestión de gastos y precios. https://www.clara.com/es-mx/products/gestion-gastos y https://www.clara.com/es-mx/pricing
- Clara / RecuperaFacturas — facturar viajes y casetas. https://recuperafacturas.com/blog/como-facturar-viajes-casetas-transporte-cfdi
- Jeeves — planes México. https://www.tryjeeves.com/mx/desc
- Casetas.com.mx — facturación por operador y por TAG. https://casetas.com.mx/facturacion y https://casetas.com.mx/tag/facturacion
- PASE — facturación. https://www.pase.com.mx/facturacion/facturacion-pase/
- Ubícalo — control de diésel, guía completa. https://www.ubicalo.com.mx/blog/control-de-diesel-guia-completa/
- DIT — Procesos base de gastos de viaje (procedimiento corporativo). https://dit.mx/wp-content/uploads/2020/03/Viaticos-Procesos-base.pdf
- Smart Fleet — calculadora de liquidación de chofer. https://smartfleetapp.com/herramientas/calculadora-liquidacion-chofer
- VITEL — "Pagos a través de terceros: reglas y riesgos en 2026". https://www.vitelmx.com/blog/pagos-traves-terceros-reglas-riesgos-2026
- Grupo Consultor EFE — "Cambios a los pagos por cuenta de terceros" (el cambio del plazo de 60 días en 2019). https://www.grupoconsultorefe.com/insights/articulos/cambios-a-los-pagos-por-cuenta-de-terceros
- SOLTUM — "La comprobación fiscal de combustibles mediante monederos electrónicos". https://soltum.com.mx/la-comprobacion-fiscal-de-combustibles-mediante-monederos-electronicos/
- IDC — "¿Deduces vales de gasolina? Requisitos del SAT para empresas" (03-jun-2026). https://idconline.mx/fiscal-contable/2026/06/03/deduces-vales-de-gasolina-requisitos-del-sat-para-empresas
- FleetLegend — Complete Guide to Driver Settlements. https://fleetlegend.com/blog/complete-guide-driver-settlements
- Transport Pro — Fuel card integrations. https://www.transportpro.net/tms-features/fuel-card-integrations/
- PCS — Driver settlement software. https://pcssoft.com/products/tms/driver-settlement-software/
