# Huecos y verificaciones pendientes de la ola 1

> Ola 2 — 27-jul-2026. Construido sobre la ola 1 (archivos `00` a `11`).
> Este documento **no revisa** lo que la ola 1 dice: busca lo que **falta**.
> Todo lo que afirmo abajo se leyó en fuente primaria descargada hoy (DOF, diputados.gob.mx,
> servicio web del SAT). Lo que no pude leer está marcado **SIN VERIFICAR**.

---

## Resumen para el fundador

La ola 1 cubrió muy bien el lado fiscal. Lo que dejó fuera es el lado **laboral y contable**, y ahí
hay tres cosas que cambian números que el producto le va a enseñar a un contralor.

1. **La Ley Federal del Trabajo tiene un capítulo propio para el autotransporte** (arts. 256 a 264) que
   ningún documento citó. Dice que el chofer del permisionario **es trabajador por ley**, que el salario
   por viaje **no se puede reducir si el viaje se acorta**, y que el patrón **tiene que pagar** hospedaje y
   comida cuando el viaje se alarga por causa ajena al operador. La liquidación que Likida calcula toca
   esos tres puntos.
2. **Los descuentos al operador tienen tope legal.** El art. 110 fr. I de la LFT limita lo exigible al
   importe de un mes de salario y el descuento a 30% del excedente del salario mínimo. La ola 1 dice que
   la multa "sí entra como descuento si está pactado". Está incompleto: si Likida propone un descuento
   por encima del tope, le arma un problema laboral al cliente.
3. **La jornada laboral cambió el 1 de mayo de 2026** (DOF 01-05-2026): baja gradual de 48 a 40 horas
   semanales, tope duro de **12 horas al día** sumando ordinaria y extraordinaria, y una obligación
   nueva de **registrar electrónicamente la jornada de cada trabajador**, con multa de 250 a 5,000 UMA.
   Nada de esto está en los once archivos. Y choca con la NOM-087, que asume rutas de hasta 14 horas
   de conducción.
4. **Nadie habló de contabilidad electrónica.** El Reglamento del CFF exige asentar cada operación
   **dentro de los cinco días** siguientes, ligada al folio del comprobante, y nombra expresamente los
   **estados de cuenta de los monederos de combustible** como parte de la contabilidad. Eso convierte
   la integración de monederos de "buena idea" en requisito legal, y le pone reloj a la liquidación.
5. **Cerré cuatro pendientes que la ola 1 dejó bloqueando código**: el formato exacto del validador de
   CFDI del SAT (probado contra el servicio real), la fecha y el texto de la RFA 2026, que el paquete
   económico 2026 **no** tocó la LISR ni la LIVA, y qué agregó la Primera Modificación a la RMF 2026.
6. **Y abrí uno que estaba dado por cerrado**: el argumento de que se acredita la cuota semanal
   *disminuida* de IEPS se apoya en la frase "con los ajustes que en su caso correspondan" de la LIF.
   Leí el inciso al que remite: esa misma disposición usa "ajustes" para la **actualización anual por
   inflación**. Es la pieza de mayor valor del paquete y su fundamento es más débil de lo que parecía.

Lo bueno: esta ola descubrió que la máquina **sí puede leer PDF del DOF y de Diputados**
(`pdftotext` está instalado) y **sí puede hablar con el servicio del SAT** por SOAP. Casi todos los
pendientes que quedaron abiertos por "el portal devuelve 403" se cierran con eso.

---

## 1. Huecos de obligación: lo que ningún documento cubrió

### 1.1 Contabilidad electrónica y el reloj de cinco días

Ningún archivo de la ola 1 menciona "contabilidad electrónica", "póliza contable", "catálogo de
cuentas" ni "balanza de comprobación". Es un hueco de obligación completo, y es el sitio donde
**aterriza el output de Likida**.

**La obligación.** CFF art. 28 (texto vigente, última reforma DOF 09-04-2026):

- fr. **III**: *"Los registros o asientos que integran la contabilidad se llevarán en medios
  electrónicos conforme lo establezcan el Reglamento de este Código y las disposiciones de carácter
  general que emita el SAT. La documentación comprobatoria de dichos registros o asientos deberá estar
  disponible en el domicilio fiscal del contribuyente."*
- fr. **IV**: *"Ingresarán de forma mensual su información contable a través de la página de Internet
  del SAT..."*

**Lo que exige el Reglamento del CFF (DOF 02-04-2014), art. 33:**

| Requisito | Texto | Qué significa para Likida |
|---|---|---|
| **A fr. IV** | La contabilidad integra *"los estados de cuenta bancarios y las conciliaciones... incluyendo... **los monederos electrónicos utilizados para el pago de combustible** y para el otorgamiento de vales de despensa"* | El estado de cuenta del monedero **es contabilidad por reglamento**, no un extra. La integración #10 de la ruta de construcción tiene fundamento legal, no solo ventaja técnica |
| **B fr. I** | Los asientos deben *"efectuarse en el mes en que se realicen las operaciones... **a más tardar dentro de los cinco días siguientes** a la realización de la operación"* | **Reloj duro.** Una liquidación que cierra a los 15 días ya nació tarde para la contabilidad. Es el argumento de urgencia más limpio que tiene el producto, y no lo está usando nadie |
| **B fr. III** | Deben *"permitir la identificación de cada operación... relacionándolas con **los folios asignados a los comprobantes fiscales**... de tal forma que pueda identificarse **la forma de pago**"* | El export de Likida tiene que llevar UUID **y** forma de pago por renglón. Coincide exactamente con el modelo de datos de la Fase 1 |
| **B fr. IX** | Deben *"**comprobar el cumplimiento de los requisitos relativos al otorgamiento de estímulos fiscales** y de subsidios"* | La evidencia del estímulo de casetas y del de diésel es obligación contable, no papel opcional |

**El artículo que le pega directo a Likida como proveedor.** RCFF art. 34:

> *"...el contribuyente deberá conservar y almacenar como parte integrante de su contabilidad toda la
> documentación relativa al **diseño del sistema electrónico donde almacena y procesa sus datos
> contables y los diagramas del mismo**, poniendo a disposición de las Autoridades Fiscales el equipo y
> sus operadores para que las auxilien cuando éstas ejerzan sus facultades de comprobación..."*

Traducción: cuando el SAT audite a una flota que usa Likida, la flota tiene que poder entregar el
**diseño y los diagramas del sistema**. Si Likida no se lo da, el cliente incumple. Es un entregable
de onboarding —una "carpeta de auditoría" con diagrama de datos, descripción del sistema y export
íntegro— que además funciona como argumento de venta frente al contador externo.

### 1.2 DIOT: la salida que falta

LIVA art. 32 fr. VIII (última reforma de la LIVA: DOF 12-11-2021): obliga a *"proporcionar
mensualmente... la información correspondiente sobre el pago, retención, acreditamiento y traslado del
IVA en las operaciones con sus proveedores, desglosando el valor de los actos o actividades por tasa...
a más tardar el día 17 del mes inmediato posterior"*.

Likida va a tener, por construcción, el dato más limpio del mercado para armar la DIOT: proveedor,
RFC, tasa, IVA trasladado, IVA retenido y forma de pago. Es un export de dos días de trabajo y le
ahorra al contralor un cierre entero. Para coordinados, la RFA 2026 regla **2.11** permite presentarla
**en forma global** por las operaciones del coordinado y sus integrantes (verificado en el DOF, ver §2.2).

### 1.3 Derecho laboral del autotransporte: el capítulo que nadie leyó

La LFT (última reforma DOF 14-05-2026) tiene el **Capítulo VI del Título Sexto, "Trabajo de
autotransportes"**, arts. 256 a 264. Cero menciones en la ola 1. Lo que importa:

**Art. 256 — el chofer es trabajador, se pacte lo que se pacte.**
> *"Las relaciones entre los choferes, conductores, operadores, cobradores y demás trabajadores que
> prestan servicios a bordo de autotransportes de servicio público, de pasajeros, de carga o mixtos...
> y los propietarios o permisionarios de los vehículos, **son relaciones de trabajo**... La estipulación
> que en cualquier forma desvirtúe lo dispuesto en el párrafo anterior, **no produce ningún efecto legal**."*

Esto le pone un candado a la ruta B del archivo `09` ("si es un tercero: erogaciones por cuenta de
terceros, RMF 2.7.1.12"). Esa ruta **solo** es defendible cuando el tercero es un permisionario con su
propia unidad y su propio permiso —el hombre-camión real—, **no** cuando conduce una unidad de la
flota. Si el operador maneja el camión de la empresa y se le trata como prestador de servicios, el
art. 256 anula el acuerdo y detrás vienen IMSS, PTU e ISN.

**Consecuencia de producto:** el campo `régimen del operador` no puede ser una selección libre del
contralor. Tiene que preguntar **de quién es la unidad y de quién es el permiso**, y derivar el
régimen de ahí, con la advertencia del art. 256 visible.

**Art. 257 — el salario por viaje tiene reglas propias.**
> *"El salario se fijará por día, por viaje, por boletos vendidos o por circuito o kilómetros
> recorridos... sin que en ningún caso pueda ser inferior al salario mínimo. Cuando el salario se fije
> por viaje, los trabajadores tienen derecho a **un aumento proporcional en caso de prolongación o
> retardo** del término normal del viaje por causa que no les sea imputable. **Los salarios no podrán
> reducirse si se abrevia el viaje**, cualquiera que sea la causa."*

Las tres frases son cálculo. Un motor de liquidación que paga por kilómetro efectivo y descuenta
cuando el viaje se acortó **está calculando mal por ley**. Y un viaje demorado por la aduana, por el
cliente o por bloqueo carretero genera un aumento proporcional que hoy nadie liquida.

**Art. 263 fr. I — hospedaje y comida no son política, son obligación.**
> *"Los patrones tienen las obligaciones especiales siguientes: I. En los transportes foráneos **pagar
> los gastos de hospedaje y alimentación** de los trabajadores, cuando se prolongue o retarde el viaje
> por causa que no sea imputable a éstos."*

Choca de frente con la lógica de "excede la política de la empresa → rechazado". Cuando el viaje se
alargó por causa ajena al operador, el gasto **se debe**, aunque rompa la política y aunque parte no
sea deducible. Son dos veredictos distintos y el producto tiene que separarlos: *deducible* ≠ *pagadero*.

**Art. 260** — el propietario del vehículo y el permisionario son **solidariamente responsables** de las
obligaciones laborales. Relevante para flotas que operan con unidades arrendadas o de terceros.

**Art. 111** — *"Las deudas contraídas por los trabajadores con sus patrones en ningún caso devengarán
intereses."* Cierra la puerta a cualquier "cargo por anticipo no comprobado".

### 1.4 El tope legal de los descuentos al operador

`09-liquidacion.md` §3.10 dice que las multas de tránsito *"sí entran como descuento en su liquidación,
si está pactado por escrito y aceptado"*. Es correcto pero incompleto, y el faltante es un número.

**LFT art. 110** (párrafo reformado DOF 09-01-1974), encabezado y fracción I:
> *"Los descuentos en los salarios de los trabajadores, **están prohibidos** salvo en los casos y con los
> requisitos siguientes: I. Pago de deudas contraídas con el patrón por anticipo de salarios, pagos
> hechos con exceso al trabajador, errores, **pérdidas, averías**... **La cantidad exigible en ningún caso
> podrá ser mayor del importe de los salarios de un mes** y el descuento será al que convengan el
> trabajador y el patrón, **sin que pueda ser mayor del treinta por ciento del excedente del salario
> mínimo**."*

Dos topes independientes que el motor tiene que llevar como contadores, igual que los cinco
presupuestos fiscales del resumen ejecutivo:

- **Tope de deuda**: el saldo exigible acumulado ≤ un mes de salario del operador.
- **Tope de descuento por periodo**: ≤ 30% de (salario del periodo − salario mínimo del periodo).

Un anticipo no comprobado de $12,000 contra un operador que gana $9,000 al mes **no se puede
descontar completo**, se pacte lo que se pacte. Si Likida imprime "a pagar: $0" porque absorbió todo
el faltante, entregó una cifra ilegal firmada por el sistema. Es exactamente el tipo de error que
pide el encargo: un número equivocado en la pantalla del contralor.

**Nota:** este tope aplica al operador **subordinado**. Al hombre-camión permisionario se le retiene
del precio del flete por contrato mercantil, y ahí no rige el art. 110. Otra razón para que
`régimen del operador` esté bien puesto desde el día uno.

### 1.5 La jornada laboral se reformó el 1 de mayo de 2026

Ningún documento de la ola 1 menciona la palabra "jornada" en sentido laboral. La LFT se reformó por
**DECRETO publicado en el DOF el 1-may-2026, "en materia de reducción de la jornada laboral"**, en vigor
el mismo 1-may-2026. Reformó los arts. 58, 59, 61, 66, 67, 68, 69 y 71, y adicionó el art. 132 fr. XXXIV
y el art. 994 fr. IV Bis.

| Qué dice ahora | Texto vigente | Impacto en flota |
|---|---|---|
| **Art. 59** | *"La duración máxima de la jornada ordinaria de trabajo será de **cuarenta horas semanales**."* | Escalonado por el Transitorio Segundo: **2026 = 48 h, 2027 = 46, 2028 = 44, 2029 = 42, 2030 = 40** |
| **Art. 66** | *"El trabajo extraordinario no excederá de **doce horas en una semana**, las cuales podrán distribuirse en hasta cuatro horas diarias, en un máximo de cuatro días"* | Escalonado por el Transitorio Cuarto: **2026 = 9 h extra, 2027 = 9, 2028 = 10, 2029 = 11, 2030 = 12** |
| **Art. 68** | *"La suma de las jornadas ordinaria y extraordinaria, **en ningún caso podrá ser mayor a doce horas diarias**."* Lo que exceda del art. 66 se paga a **200%** | **Tope duro diario de 12 h** |
| **Art. 58** | *"Jornada de trabajo es el tiempo durante el cual el trabajador **está a disposición del patrón**"*, y podrá distribuirse de común acuerdo | Cuenta la espera en andén y la maniobra, no solo el volante |
| **Art. 132 fr. XXXIV** (nueva) | *"**Registrar de manera electrónica la jornada laboral de cada persona trabajadora**, incluyendo el horario de inicio y finalización; así como proporcionarlo a la autoridad cuando se le requiera."* La STPS expedirá las disposiciones generales; *"el contenido del registro electrónico hará prueba plena si se acredita que fue acordado entre la persona trabajadora y empleadora"* | **Vigente a partir del 1-ene-2027** (Transitorio Quinto). Es una obligación nueva que hoy **nadie** en el sector puede cumplir con un operador en carretera |
| **Art. 994 fr. IV Bis** (nueva) | Multa de **250 a 5,000 UMA** a la persona empleadora que incumpla el art. 132 fr. XXXIV | Con UMA 2026 de $117.31 (verificado en `07`): **$29,327.50 a $586,550** |

**Esto es una oportunidad de producto, no solo un riesgo.** Likida ya recibe eventos con hora del
operador por WhatsApp. Un registro electrónico de jornada, con horario de inicio y fin y **acuse del
trabajador** (que es lo que le da "prueba plena" al registro según el propio art. 132 fr. XXXIV), es un
módulo pequeño encima de lo que ya se está construyendo, con fecha de obligatoriedad conocida
(1-ene-2027) y multa nombrada. Ningún competidor del mapa de `08` lo tiene.

### 1.6 Conservación: cinco años que pelean con el derecho de supresión

CFF art. 30, tercer párrafo: la contabilidad y su documentación *"deberán conservarse durante un plazo
de **cinco años**, contado a partir de la fecha en la que se presentaron o debieron haberse presentado
las declaraciones con ellas relacionadas"*. Para un gasto de 2026 de una persona moral, el reloj
empieza a correr con la anual (marzo de 2027) y termina en **2032**.

`11-datos-personales.md` trata la conservación desde la LFPDPPP. Nadie cruzó los dos. El cruce
importa porque:

- Likida es **encargado**, no responsable: no puede borrar por su cuenta ni conservar por su cuenta.
  El contrato tiene que decir que la retención se fija en **cinco años + el plazo del art. 30 del CFF**
  por instrucción documentada del responsable, y qué pasa al terminar el servicio.
- Un operador que ejerce **supresión** sobre un comprobante de 2026 no puede lograr que se borre: hay
  una obligación legal de conservación. Eso hay que decirlo en el aviso de privacidad, o la negativa
  parecerá arbitraria.
- Y al revés: la foto original de WhatsApp, el audio y la geolocalización **no** son contabilidad. Ahí
  no aplica el art. 30 y sí aplica el principio de finalidad. Son dos políticas de retención distintas
  sobre el mismo expediente.

---

## 2. Pendientes de camino crítico que cerré en esta ola

### 2.1 El validador de CFDI del SAT: cerrado y probado (pendiente bloqueante #5)

El resumen ejecutivo dejaba bloqueada la implementación por no conocer el formato de la cadena
`expresionImpresa`. Lo resolví **contra el servicio real**, no contra documentación.

**Endpoint** (sin credenciales, sin e.firma, sin PAC):
`https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc`
WSDL vivo, consultado el 27-jul-2026. La operación es `Consulta(expresionImpresa: string)`,
`SOAPAction: http://tempuri.org/IConsultaCFDIService/Consulta`.

**Contrato de respuesta** (leído del XSD del propio servicio, `?xsd=xsd2`): el tipo `Acuse` tiene
exactamente cinco campos — `CodigoEstatus`, `EsCancelable`, `Estado`, `EstatusCancelacion`,
**`ValidacionEFOS`**.

**Formato, determinado empíricamente** (cuatro llamadas de prueba con datos ficticios):

| Prueba | Respuesta | Conclusión |
|---|---|---|
| `?re=…&rr=…&tt=1234.5678&id=…` | `602 Comprobante no encontrado` | Orden de parámetros **libre** |
| `?id=…&re=…&rr=…&tt=0000001234.567800&fe=aBcDeFgH` | `602` | `tt` acepta relleno a 18 posiciones; `fe` es **opcional** |
| `id=…&re=…&rr=…&tt=1234.56` (sin `?` inicial) | `602` | El `?` inicial es **opcional**; `tt` con 2 decimales sirve |
| `?id=…&re=…&rr=…` (**sin `tt`**) | **`601 La expresión impresa proporcionada no es válida`** | `tt` es **obligatorio** |
| `?re=…&rr=…&tt=1.00` (**sin `id`**) | **`601`** | `id` es **obligatorio** |
| `?id=NO-ES-UUID&…` y `?…&re=RFCMALO&…` | `602` | El servicio **no valida sintaxis** de UUID ni de RFC |

**Los cuatro obligatorios son `id`, `re`, `rr`, `tt`.** `fe` (últimos 8 caracteres del sello) es opcional.

**El hallazgo que cambia el producto:** un total mal leído por el OCR, un RFC mal transcrito o un UUID
inexistente devuelven **todos** `602 – No Encontrado`. El servicio **no distingue** "esta factura no
existe" de "leíste mal el total". Por lo tanto:

- Likida **no puede** mostrarle a un contralor "factura apócrifa" o "no existe" a partir de un 602.
  El texto correcto es *"no se pudo confirmar con los datos capturados"*, con la opción de corregir.
- La validación fuerte solo llega **con el XML**, donde los cuatro campos son exactos. Refuerza la
  decisión #1 del resumen ejecutivo (la foto no es el comprobante) con un argumento operativo nuevo.
- Como el servicio no cobra ni pide credenciales, el reintento con variantes del total (con y sin
  centavos, con y sin redondeo) es una estrategia legítima de recuperación. Vale la pena medir su
  tasa de acierto contra el conjunto dorado.

### 2.2 La RFA 2026 existe, tiene fecha y su texto dice lo que la ola 1 dice (respaldo independiente)

Todo el argumento comercial del 8%, del 15% de combustible en efectivo y del acreditamiento de
estímulos cuelga de un solo documento. Lo verifiqué contra el DOF, de forma independiente:

- **Índice del DOF del 17-feb-2026**, sección SHCP: *"Resolución de facilidades administrativas para
  los contribuyentes de los sectores que en la misma se señalan para 2026"*. La fecha que citaba la
  ola 1 es correcta.
- **Regla 2.2** (texto leído en el DOF): 8% de los ingresos propios *"sin exceder de $1,000,000.00...
  durante el ejercicio fiscal"*, con **tasa del 16% definitiva, no acreditable ni deducible**, y pagos
  provisionales al día 17. Confirmado.
- **Regla 2.9**: la válvula del 15% para pagos de combustible por medios distintos, con la exigencia de
  que en el comprobante *"conste la información del permiso vigente... y que, en su caso, dicho permiso
  no se encuentre suspendido en el momento de la expedición"*. Confirmado — y con esto la corrección
  **C1** del resumen ejecutivo queda respaldada en fuente primaria, no en un archivo contra otro.
- **Regla 2.12**: los estímulos de la LIF art. 20-A-IV (diésel) y 20-A-V (casetas) se pueden acreditar
  contra el ISR propio, **contra los pagos provisionales del 16% de la regla 2.2 fr. IV**, contra el ISR
  anual de la fr. III de esa misma regla, y —solo el de diésel— contra retenciones de ISR a terceros.
  Está en `03`, pero vale repetirlo aquí porque cambia el flujo de caja: **el estímulo del diésel paga
  el costo del 8% ciego**. Eso convierte una objeción de venta ("el 8% me cuesta 16%") en un cálculo
  neto que Likida puede mostrar.

**Dos detalles operativos del texto que no vi reflejados en ningún archivo:**

- **Regla 2.2 fr. II**: la erogación amparada por el 8% debe estar *"registrada en la contabilidad del
  contribuyente **por concepto y en forma acumulativa** durante el ejercicio fiscal"*. O sea, la
  facilidad "sin comprobante" **sí exige un registro**, por concepto y acumulado. Es un entregable
  natural de Likida y hoy se hace a mano o no se hace.
- **Regla 2.10 fr. III**: el CFDI de retenciones con el que el coordinado liquida a sus integrantes debe
  llevar *"nombre del integrante... **y firma del mismo o de quien reciba el documento**"*. Hay una firma
  física o su equivalente en el flujo. Si Likida algún día produce ese documento, la captura de la
  firma es parte del requisito, no un adorno.

### 2.3 El paquete económico 2026 no tocó la LISR ni la LIVA (pendiente #17, cerrado)

Consulta directa a los PDF de la Cámara de Diputados el 27-jul-2026:

| Ley | Última reforma según el propio documento |
|---|---|
| **LISR** | DOF **01-04-2024** |
| **LIVA** | DOF **12-11-2021** |
| **LIEPS** | DOF **07-11-2025** |
| **CFF** | DOF **09-04-2026** |
| **LFT** | DOF **14-05-2026** |

Es decir: el paquete 2026 movió la **LIEPS** (07-11-2025, junto con la LIF nueva) pero **no** la LISR ni
la LIVA. La duda de la ola 1 estaba bien planteada y la respuesta es **no hubo reforma**. Se puede
codificar contra los textos citados sin miedo, con revisión en diciembre.

**Además, revisé el CFF vigente:** la reforma del 09-04-2026 —posterior a todo lo que leyó la ola 1—
solo modificó el **art. 141** (orden de las garantías del interés fiscal). No tocó los arts. 29, 29-A,
49 Bis, 69-B ni 28. Todo el andamiaje de `01` sigue en pie.

### 2.4 Qué hizo la Primera Modificación a la RMF 2026 (pendiente #16, cerrado a medias)

`02-carta-porte.md` verificó que la Primera Resolución de Modificaciones (DOF **09-jul-2026**) no tocó
la sección 2.7.7, pero nadie leyó las **reglas nuevas** que enumera. Las leí:

- **9.1.23** — CFDI de retención de intereses de instituciones de financiamiento colectivo. **Irrelevante.**
- **9.1.24** — no retención de ISR/IVA a líneas aéreas en plataformas. **Irrelevante.**
- **2.7.1.48** (reformada) — *"los contribuyentes que enajenen gasolinas y diésel... deben incorporar en
  el CFDI que se emita, el 'Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos',
  que al efecto publique el SAT en su Portal"*. Confirma la obligación de `05`, **pero al 09-jul-2026 la
  regla sigue redactada en futuro** ("que al efecto publique"). Eso **no** confirma ni desmiente la fecha
  del 25-mar-2026; simplemente el texto de la regla no se actualizó. El pendiente bloqueante #2 sigue
  abierto.
- **11.7.3** (adicionada) — **"Cálculo del precio base del diésel"**. Sí es relevante y contradice el
  encuadre de la corrección **C4** del resumen ejecutivo (ver CONFLICTOS). Manda restar al precio base
  del diésel cantidades fijas en fechas precisas: $0.28/L del 1 al 16 de abril; $0.60 el 17 y el 23 de
  abril; $1.03 el 29 de abril y el 7 de mayo; $1.04 el 14 y 21 de mayo; $0.99 el 28 de mayo y el 4 de
  junio; $0.98 el 11 de junio; $0.96 el 18 de junio; $0.95 el 25 de junio; $0.93 el 2 de julio. Remite
  al Decreto IEPS combustibles (DOF 27-12-2016, modificado por Decreto DOF 31-12-2025) y al Acuerdo de
  metodología (DOF 11-03-2019, modificado por Acuerdo DOF 04-09-2025).

**Para el servicio de cuotas semanales (Fase 2, #12) esto significa** que la fuente no es solo el
acuerdo semanal: hay **tres capas** —cuota de ley (LIEPS), metodología del Acuerdo del 11-03-2019, y
ajustes por regla miscelánea como la 11.7.3— y las tres se publican en lugares distintos. Un
ingestor que solo lea el acuerdo del viernes se va a desfasar cuando cambie la metodología.

### 2.5 La cuota de IEPS del diésel, verificada en la ley, y por qué el pendiente #1 empeora

Leí el texto vigente de la **LIEPS art. 2o, fr. I, inciso D), numeral 1, subinciso c)**:
**Diésel = 7.3634 pesos por litro**, con la nota *"Cuota del inciso actualizada por acuerdo DOF...
22-12-2025"* — o sea, esa es la cuota vigente para 2026. La cifra de la ola 1 es correcta.

Y leí el texto vigente de la **LIF 2026, art. 20, apartado A, fr. IV** (Nueva Ley, DOF 07-11-2025):

> *"...el monto que se podrá acreditar será el que resulte de multiplicar la cuota del IEPS que
> corresponda según el tipo de combustible, conforme al artículo 2o., fracción I, inciso D), numeral 1,
> subinciso c)... **con los ajustes que, en su caso, correspondan, vigente en el momento en que se haya
> realizado la importación o adquisición**..."*

La ola 1 apoya toda la tesis de la "cuota disminuida" en esa frase. **El problema:** el mismo inciso D)
al que remite la LIF contiene su propio mecanismo de ajuste, y no es el semanal:

> *"Las cantidades señaladas en el presente inciso, **se actualizarán anualmente** y entrarán en vigor a
> partir del 1 de enero de cada año, con el factor de actualización... La SHCP publicará el factor de
> actualización en el DOF durante el mes de diciembre de cada año, así como la cuota actualizada."*

Y el primer párrafo de la fr. IV define el estímulo como el IEPS *"que las personas que enajenen diésel
... **hayan causado**"*. El estímulo semanal del Decreto de 2016 no reduce el IEPS **causado** por el
enajenante: es un acreditamiento que el enajenante aplica **contra** ese impuesto causado.

**Lectura A (íntegra, $7.3634):** "ajustes" = la actualización anual del propio inciso D); el impuesto
"causado" es la cuota completa.
**Lectura B (disminuida, $2.0925 en la semana del 25-31 de julio):** los acuerdos semanales se titulan
literalmente "cuotas disminuidas del IEPS", y esa es la cuota realmente vigente en el momento de la
adquisición.

Las dos se sostienen del mismo texto. **No es un pendiente menor de verificación: es una pregunta con
respuesta binaria y un factor de 3.5x sobre el estímulo.** Hasta que un fiscalista con cédula la firme,
Likida no debe poner una cifra de estímulo de diésel en ninguna propuesta, ni siquiera con asterisco.
La salida honesta mientras tanto: mostrar **litros acreditables** y **el rango**, no el peso.

---

## 3. Supuestos que descansan en un solo documento

| Supuesto | Dónde vive | Estado después de esta ola |
|---|---|---|
| Se acredita la cuota **disminuida** semanal | `04`, resumen ejecutivo #2 | **Debilitado.** Ver §2.5. Es hoy el riesgo abierto más caro del paquete |
| El tope de $1,000,000 de la regla 2.2 es por integrante | pendiente #7 | **Argumento textual nuevo, no certeza:** la regla habla de *"los contribuyentes personas físicas o morales"* y su fr. III solo encarga al coordinado *"efectuar el entero de dicho impuesto **por cuenta de los mismos**"*. En un coordinado los contribuyentes son los integrantes (LISR 72-73), así que el tope corre por integrante. Sigue sin criterio del SAT |
| El "Complemento Concepto de Hidrocarburos" fue exigible desde el 24-abr-2026 | `05`, C2 | **Sigue abierto.** La regla 2.7.1.48, reformada el 09-jul-2026, todavía dice "que al efecto publique el SAT" |
| Metodología del radio de 30 km de Carta Porte | `02`, pendiente #13 | **Sigue abierto**, sin criterio |
| Cifras del sector (82% de la carga, 95% con menos de 30 camiones) | `08`, `09`, pendiente #28 | **Sigue sin fuente primaria.** La fuente correcta es la Estadística Básica del Autotransporte Federal de la SICT. No alcancé a descargarla |
| 19 de 32 tasas de ISN | `06`, pendiente #21 | **Sin cambio.** Se cierran leyendo los periódicos oficiales estatales, que sí son PDF descargables con el método de esta ola |

---

## 4. Acciones concretas

| Acción | Por qué | Esfuerzo | Cuándo |
|---|---|---|---|
| Implementar el validador contra `consultaqr.facturaelectronica.sat.gob.mx` con los 4 parámetros obligatorios y tratar el `602` como **ambiguo**, nunca como "apócrifa" | Es la validación gratuita, sin credenciales, y el 602 mal interpretado le dice al contralor que su proveedor es falso cuando solo falló el OCR | Bajo | Antes de la demo |
| Meter dos contadores laborales junto a los cinco fiscales: **saldo exigible ≤ 1 mes de salario** y **descuento ≤ 30% del excedente del mínimo** (LFT 110 fr. I) | Sin esto, la liquidación puede imprimir un neto ilegal | Bajo | Fase 1 |
| Derivar `régimen del operador` de dos preguntas (¿de quién es la unidad? ¿de quién es el permiso?) y mostrar la advertencia del art. 256 LFT | La ruta "tercero" es nula si el operador maneja la unidad de la flota; arrastra IMSS, PTU e ISN | Bajo | Fase 1 |
| Separar **deducible** de **pagadero** en el veredicto por gasto (LFT 263 fr. I) | Hospedaje y comida por demora ajena al operador se deben aunque rompan política o topes fiscales | Medio | Fase 1 |
| No reducir el pago por viaje acortado y calcular el aumento proporcional por demora ajena (LFT 257) | Es cálculo, no criterio; hoy se hace mal en todo el sector | Medio | Fase 1 |
| Poner el reloj de **5 días** del RCFF 33-B-I en la máquina de estados y usarlo como argumento de urgencia en la venta | Convierte "cerramos más rápido" en "cumples el Reglamento del CFF" | Bajo | Fase 1 y pitch |
| Añadir UUID **y forma de pago** por renglón al export contable (RCFF 33-B-III) | Es el requisito literal de identificación de cada operación | Bajo | Fase 1 |
| Armar la **carpeta de auditoría** (diagrama del sistema, descripción del almacenamiento y procesamiento, export íntegro) como entregable de onboarding (RCFF 34) | La flota está obligada a tenerla; si Likida no se la da, el cliente incumple | Medio | Antes del primer cliente pagado |
| Export **DIOT** por proveedor, tasa e IVA retenido (LIVA 32 fr. VIII) | Dato que Likida va a tener limpio y que hoy el contralor arma a mano cada día 17 | Medio | Fase 2 |
| Prototipar el **registro electrónico de jornada** con acuse del operador (LFT 132 fr. XXXIV) | Obligación con fecha (1-ene-2027) y multa de 250 a 5,000 UMA; nadie la cubre | Medio | Fase 3, con diseño desde ya |
| Bajar a **12 horas** el umbral del detector de horas de servicio, además del de 14 de la NOM-087 | El tope diario del art. 68 LFT es menor que el que asume la NOM | Bajo | Fase 3 |
| Escribir la política de retención a dos velocidades: contabilidad **5 años** (CFF 30) por instrucción del responsable; foto, audio y geolocalización con plazo propio | Sin esto, el aviso de privacidad y el contrato se contradicen | Bajo | Antes de la demo |
| **No publicar ninguna cifra de estímulo de diésel en pesos** hasta que un fiscalista firme la lectura íntegra vs. disminuida | Factor de 3.5x sobre el número más vistoso de la propuesta | Bajo | Inmediato |
| Cerrar los pendientes que quedaron por "el portal da 403" con `curl` + `pdftotext` + el índice diario del DOF | Ya está probado que funciona; casi todo lo estatal y lo del DOF es alcanzable | Medio | Esta semana |

---

## CONFLICTOS

**CONFLICTO 1 — La regla 11.7.3 sí existe y sí es de diésel.**
La corrección **C4** del `00-RESUMEN-EJECUTIVO.md` afirma: *"También es falso que se instrumente en la
'regla 11.7.3'"*. Al 09-jul-2026 la RMF 2026 **tiene** una regla **11.7.3, "Cálculo del precio base del
diésel"**, adicionada por la Primera Resolución de Modificaciones (DOF 09-jul-2026), y trata
precisamente del mecanismo del estímulo al diésel. Lo correcto de C4 se mantiene: las reglas del
**transportista** son 9.1.6, 9.1.7 y 9.1.8, y el fundamento del estímulo es el art. **20** de la LIF, no el
16. Pero la frase "la 11.7.3 no existe / no es eso" ya no se puede decir, y quien la use frente a un
fiscalista queda mal parado. **Redacción segura:** *"El estímulo del transportista se instrumenta en las
reglas 9.1.6 a 9.1.8 de la RMF 2026. La regla 11.7.3 pertenece al Decreto IEPS combustibles y regula el
cálculo del precio base del diésel, que es insumo del estímulo semanal, no el acreditamiento del
transportista."*

**CONFLICTO 2 — NOM-087 (14 h de conducción) contra LFT art. 68 (12 h de jornada).**
No es contradicción entre archivos: es contradicción entre ordenamientos, y nació el 1-may-2026.
`07-no-fiscal.md` §8 documenta bien que la NOM-087 num. 4.6 a) contempla rutas con conducción máxima
de **14 horas** seguidas de una pausa de 8. La LFT reformada (art. 68, último párrafo) dice que la suma
de jornada ordinaria y extraordinaria *"en ningún caso podrá ser mayor a doce horas diarias"*, y el
art. 58 define jornada como el tiempo **a disposición** del patrón, no solo el de volante. Un operador
que cumple la NOM puede estar violando la LFT. Likida no puede resolver la contradicción, pero **sí
debe marcar las dos líneas** y no presentar el cumplimiento de la NOM como cumplimiento laboral.

**CONFLICTO 3 — "Ruta 2: el operador como tercero" contra el art. 256 de la LFT.**
`09-liquidacion.md` §11 presenta dos rutas legales simétricas para el anticipo: empleado (viáticos) o
tercero (erogaciones por cuenta de terceros, RMF 2.7.1.12). El art. 256 de la LFT dice que la relación
entre el chofer y el propietario o permisionario del vehículo **es relación de trabajo** y que la
estipulación en contrario *"no produce ningún efecto legal"*. Las dos rutas no son simétricas: la
segunda solo existe cuando el tercero aporta **su propia unidad y su propio permiso**. Hay que
corregirlo antes de que se convierta en un campo de base de datos con valores equivalentes.

---

## SIN VERIFICAR

1. **Si existe una Segunda Resolución de Modificaciones a la RMF 2026** publicada entre el 10-jul-2026 y
   hoy. Solo revisé el índice del DOF del 09-jul-2026. Se cierra con el índice diario del DOF.
2. **Fecha oficial de publicación del Complemento Concepto de Hidrocarburos en el Portal del SAT.**
   Sigue abierta; la regla 2.7.1.48 reformada el 09-jul-2026 no la fija.
3. **Lectura correcta de "con los ajustes que, en su caso, correspondan"** (LIF 2026 art. 20-A-IV) para
   el acreditamiento del IEPS del diésel. Ver §2.5. **Es el pendiente más caro del paquete.**
4. **Disposiciones de carácter general de la STPS** sobre el registro electrónico de jornada (art. 132
   fr. XXXIV). El Transitorio Quinto las difiere al 1-ene-2027 y todavía no se emiten. Sin ellas no se
   sabe qué flotas quedan exceptuadas ni qué formato pide la autoridad.
5. **Si el registro de jornada del art. 132 fr. XXXIV admite geolocalización o eventos de WhatsApp** como
   "horario de inicio y finalización". Es interpretación pendiente, no dato.
6. **Reglas de la RMF 2026 sobre contabilidad electrónica** (envío mensual, catálogo de cuentas, balanzas
   y pólizas, y el Anexo 24). Verifiqué la obligación en el CFF y en el Reglamento; **no** leí la
   numeración vigente 2026 de las reglas 2.8.x ni las excepciones por nivel de ingresos. Antes de
   prometer "te generamos la contabilidad electrónica" hay que leerlas.
7. **Si la flota promedio del segmento está obligada a enviar contabilidad electrónica** o cae en alguna
   facilidad. Depende del punto anterior.
8. **Cifras del sector en fuente oficial** (Estadística Básica del Autotransporte Federal, SICT). No
   alcancé a descargarla; el presupuesto de WebSearch de la sesión estaba agotado desde la ola 1.
9. **Las 19 tasas de ISN faltantes** de `06`. Sin cambio.
10. **Interacción del art. 110 fr. I de la LFT con el hombre-camión permisionario.** Sostengo que no le
    aplica por ser relación mercantil, pero es razonamiento propio: no encontré criterio ni tesis.
11. **Si los viáticos pagados por obligación del art. 263 fr. I de la LFT** (demora ajena al operador)
    tienen algún tratamiento fiscal distinto de los viáticos ordinarios. No hay criterio localizado.
12. **Reglas de contabilidad de los coordinados** cuando el integrante lleva su propia contabilidad. La
    RFA 2.10 y 2.11 permiten cumplimiento global de IVA y DIOT; no revisé si eso alcanza a la
    contabilidad electrónica.

### Nota de método (léela: cambia el costo de cerrar todo lo demás)

El presupuesto de **WebSearch quedó agotado desde la ola 1** (200/200) y firecrawl sigue sin créditos.
Esta ola se hizo con tres herramientas que estaban disponibles y que la ola 1 no usó:

- **`curl` directo** a `diputados.gob.mx` y `dof.gob.mx`. Los dos responden 200 a peticiones
  automatizadas. El índice diario del DOF (`dof.gob.mx/index.php?year=&month=&day=`) da los enlaces
  `nota_detalle.php` de cada publicación: es la forma barata de confirmar fechas y de leer resoluciones
  completas.
- **`pdftotext -layout`** (ya instalado, `/opt/homebrew/bin/pdftotext`). La ola 1 reportó que no podía
  parsear los archivos del SAT por falta de `xlrd` y `pandas`; eso es cierto para XLS, **no** para PDF.
  Todas las leyes de Diputados se leen así en segundos.
- **SOAP crudo con `curl`** contra los servicios del SAT que no viven en el portal SPA.

Lo que sigue sin abrirse es el **portal `sat.gob.mx`** (SPA con 403) y los **XLS de catálogos**. Para
esos falta instalar un lector de XLSX (`openpyxl`) o conseguir los archivos por otra vía.

---

## Fuentes

Todas consultadas el **27 de julio de 2026**.

**Leyes y reglamentos (Cámara de Diputados, texto vigente):**
- Ley Federal del Trabajo, última reforma DOF 14-05-2026 — https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf
  (arts. 58, 59, 61, 66, 67, 68, 110, 111, 132 fr. XXXIV, 256–264, 992, 994 fr. IV Bis; y los decretos
  de reforma publicados en el DOF el 01-05-2026 y el 14-05-2026, con sus transitorios)
- Código Fiscal de la Federación, última reforma DOF 09-04-2026 — https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf
  (arts. 28 y 30; y el Decreto DOF 09-04-2026 que solo reformó el art. 141)
- Reglamento del Código Fiscal de la Federación, DOF 02-04-2014 — https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_CFF.pdf
  (arts. 33, 34 y 35)
- Ley del Impuesto Especial sobre Producción y Servicios, última reforma DOF 07-11-2025 — https://www.diputados.gob.mx/LeyesBiblio/pdf/LIEPS.pdf
  (art. 2o, fr. I, inciso D), numeral 1, subinciso c) y su párrafo de actualización anual)
- Ley del Impuesto al Valor Agregado, última reforma DOF 12-11-2021 — https://www.diputados.gob.mx/LeyesBiblio/pdf/LIVA.pdf
  (art. 32 fr. VIII)
- Ley del Impuesto sobre la Renta, última reforma DOF 01-04-2024 — https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf
- Ley de Ingresos de la Federación para el ejercicio fiscal de 2026, Nueva Ley DOF 07-11-2025 — https://www.diputados.gob.mx/LeyesBiblio/pdf/LIF_2026.pdf
  (art. 20, apartado A, fr. IV)

**Diario Oficial de la Federación:**
- Índice del 17-feb-2026 (SHCP: Resolución de facilidades administrativas para 2026) — https://www.dof.gob.mx/index.php?year=2026&month=02&day=17
- Resolución de Facilidades Administrativas 2026, texto íntegro — https://www.dof.gob.mx/nota_detalle.php?codigo=5780249&fecha=17/02/2026
  (reglas 2.2, 2.9, 2.10, 2.11 y 2.12)
- Primera Resolución de Modificaciones a la RMF 2026 — https://www.dof.gob.mx/nota_detalle.php?codigo=5793101&fecha=09/07/2026
  (reglas 2.7.1.48, 9.1.23, 9.1.24 y 11.7.3)

**Servicio Web del SAT (consultado en vivo por SOAP):**
- WSDL — https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc?wsdl
- Esquema del `Acuse` — https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc?xsd=xsd2
- Endpoint de consulta — https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc
  (seis llamadas de prueba con datos ficticios para determinar parámetros obligatorios y tolerancias)
