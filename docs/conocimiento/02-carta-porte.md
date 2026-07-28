# Complemento Carta Porte

> Investigado el 27-jul-2026 para Likida.ai. Fundamentos citados. Lo no verificado va marcado.

---

## Resumen para el fundador

La Carta Porte no es un documento aparte: es un **complemento** que se cuelga de un CFDI 4.0 que ya existe. Solo hay dos tipos de CFDI que lo aceptan: el de **ingreso** (tipo `I`, lo emite el transportista que cobra el flete) y el de **traslado** (tipo `T`, valor cero, lo emite el dueño de la mercancía cuando mueve lo suyo con sus propias unidades). Si no es `I` ni `T`, el complemento no puede existir.

La versión vigente es la **3.1** desde el 17 de julio de 2024. No hay otra. No hubo cambio de versión en 2026 y a la fecha de esta investigación tampoco hay una anunciada. Lo que sí cambió el **13 de enero de 2026** fueron los catálogos (el archivo `catCartaPorte.xsd` que usan los PAC para validar).

El disparador de la obligación **no es la distancia ni el peso: es pisar un tramo de jurisdicción federal**. Si el viaje entero es local, no se necesita complemento (sí se necesita el CFDI). Y si la unidad no excede los pesos y dimensiones de un camión C2, se considera que *no* transitó por tramo federal siempre que el tramo federal usado quede dentro de **un radio de 30 km entre origen inicial y destino final, contando puntos intermedios**. Ojo: es un **radio**, no kilómetros lineales. Esa excepción **sigue vigente en 2026** (la leí en el texto de la RMF 2026 publicada en el DOF).

**No existe periodo de gracia en 2026.** Los periodos de "no sanción" fueron 2022 y 2023 y terminaron el 31 de diciembre de 2023. Revisé los 25 transitorios de la RMF 2026 y la Primera Resolución de Modificaciones (DOF 9-jul-2026): ninguno menciona Carta Porte.

Lo que puede tronar: multa de **$450 a $670 por cada CFDI emitido sin el complemento**; multa de **$22,300 a $127,530** por no expedir el CFDI o expedirlo sin requisitos, con clausura preventiva de 3 a 15 días en reincidencia; el gasto no es deducible ni acreditable; y —lo grave— trasladar bienes sin el CFDI con complemento **se presume delito de contrabando** (CFF 103-XXII) con pena de **3 a 6 años de prisión** (CFF 104-IV), aunque la mercancía sea nacional y legítima. Además, en revisión aduanera el medio de transporte puede quedar embargado precautoriamente.

Para Likida lo importante: la responsabilidad está **partida por dato**. El SAT publica una tabla de 37 campos donde 19 los aporta el cliente y 18 el transportista, y cada quien responde solo por los suyos. Ahí hay producto.

---

## 1. Dónde vive la Carta Porte respecto del CFDI

El complemento se registra como **nodo hijo del nodo `Complemento`** del CFDI. En un CFDI solo puede existir un nodo `CartaPorte`.

**Regla dura del estándar:** *"Cuando el atributo `Comprobante:TipoDeComprobante` sea distinto de `I` o `T`, este complemento no debe existir."*
— Estándar del Complemento Carta Porte 3.1, sección 8.B "Validaciones aplicables al complemento Carta Porte", SAT, última modificación 17-jun-2024. **Verificado.**

### 1.1 CFDI de ingreso (tipo `I`) + Carta Porte

Es la factura del flete. La emite quien **presta el servicio de transporte y cobra por él**.

| Qué valida el PAC | Regla |
|---|---|
| `Moneda` | Debe ser **distinta** de `XXX` |
| `Conceptos:Concepto:ClaveProdServ` | Debe ser una de 41 claves de servicio de transporte: `78101500`…`78101807`, `78101900`…`78101905` (intermodal), `78102200`…`78102205`, `78121603`, `78141500`, `78141501`, `84121806`, `92121800`, `92121801`, `92121802` |
| `Receptor:Rfc` | Si no es RFC genérico, debe estar en la lista de RFC inscritos no cancelados del SAT (`l_RFC`) |
| Claves intermodales | Si se usa `78101900`–`78101905`, deben existir **más de uno** de los nodos `Autotransporte`, `TransporteMaritimo`, `TransporteAereo`, `TransporteFerroviario` |

— Estándar CCP 3.1, sección 8.A y 8.B. **Verificado.**

Fundamento normativo: **RMF 2026, regla 2.7.7.1.1.** (DOF 28-dic-2025), que remite al **artículo 29, penúltimo párrafo del CFF**.

Texto literal de la regla 2.7.7.1.1. (RMF 2026, primer párrafo):

> "Para los efectos del artículo 29, penúltimo párrafo del CFF, los contribuyentes, intermediarios o agentes de transporte, dedicados al servicio de transporte de carga general y especializada, que circulen por vía terrestre, férrea, aérea, o naveguen por vía marítima, así como los que presten el servicio de paquetería y mensajería, de grúas de arrastre y de grúas de arrastre y salvamento y depósito de vehículos, así como de traslado de fondos y valores o materiales y residuos peligrosos, entre otros servicios que impliquen la transportación de bienes o mercancías, **deben expedir un CFDI de tipo ingreso** con los requisitos establecidos en el artículo 29-A del CFF, al que deben incorporar el 'Complemento Carta Porte'…"

**Verificado** (texto extraído del PDF oficial `RMF_2026-DOF-28122025.pdf` publicado por el SAT).

### 1.2 CFDI de traslado (tipo `T`) + Carta Porte

Lo emite el **dueño, poseedor o tenedor** de la mercancía cuando la mueve **con medios propios** y no cobra nada por moverla.

| Qué valida el PAC | Regla |
|---|---|
| `SubTotal` | Debe ser **cero** |
| `Total` | Debe ser **cero** |
| `Moneda` | Debe ser `XXX` |
| `Receptor:Rfc` | Debe ser **igual** a `Emisor:Rfc` |
| `Receptor:UsoCFDI` | Debe ser `S01` "Sin efectos fiscales" (CFDI 4.0 y posteriores) |

— Estándar CCP 3.1, sección 8.A. **Verificado.**

Fundamento: **RMF 2026, regla 2.7.7.1.2.** — *"…mediante la representación impresa, en papel o en formato digital, del CFDI de tipo traslado expedido por ellos mismos… En dicho CFDI deberán consignar como valor: cero; su clave en el RFC como emisor y receptor de este comprobante…"*. **Verificado.**

### 1.3 Convivencia con otros complementos

El CCP 3.1 puede coexistir con: **Timbre Fiscal Digital, Comercio Exterior, Persona Física Integrante de Coordinado, Impuestos Locales, Leyendas Fiscales** y los complementos de Concepto que definan su relación con él.
— Estándar CCP 3.1, sección 8.B. **Verificado.**

### 1.4 La representación impresa

La representación impresa del CFDI con CCP **debe incluir los datos del complemento**, y la estructura permite visualizar por separado el CFDI y el complemento.
— **RMF 2026, regla 2.7.1.7., fracción IX.** **Verificado.**

Formato aceptado: PDF o cualquier formato legible; puede portarse en el celular del operador o en papel.
— SAT, "Preguntas frecuentes CCP 3.1", pregunta 34 (publicado 07-ago-2024). **Verificado.**

### 1.5 El identificador propio del complemento: `IdCCP`

Novedad de la 3.1. Es un folio de **36 caracteres** con patrón `[C]{3}[a-f0-9A-F]{5}-…` (los tres primeros caracteres son siempre `C`), conforme al estándar **RFC 4122**. Es **requerido**, forma parte de la cadena original que sella el emisor y **lo debe generar automáticamente el sistema que expide el CFDI**.
— Estándar CCP 3.1, atributo `IdCCP`; FAQ CCP 3.1 pregunta 6. **Verificado.**

No se transmite en el DODA (Documento de Operación para Despacho Aduanero). — FAQ CCP 3.1, pregunta 6. **Verificado.**

---

## 2. Versión vigente en 2026 y desde cuándo

Consulté el 27-jul-2026 la página oficial del SAT `omawww.sat.gob.mx/tramitesyservicios/Paginas/complemento_carta_porte.htm`. Dice textualmente:

> "El complemento Carta Porte versión 3.1, se publicó en el Portal del SAT el 17 de junio de 2024. El complemento Carta Porte versión 3.1, se debe estar utilizando a partir del 17 de julio de 2024. En operaciones de comercio exterior, la factura con complemento Carta Porte es exigible desde el 01 de enero de 2024."

**Verificado** (contenido descargado del servidor del SAT hoy).

### Línea de tiempo de versiones (fuente: página del SAT + Antecedentes del Instructivo 3.1)

| Versión | Inicio de vigencia | Fin de vigencia |
|---|---|---|
| 1.0 | 01-jun-2021 | 31-dic-2021 |
| 2.0 | 01-ene-2022 | 31-mar-2024 |
| 3.0 | 25-nov-2023 | 16-jul-2024 |
| **3.1** | **17-jul-2024** | **vigente** |

**Verificado.**

### Estado de los archivos técnicos (verificado por HTTP `Last-Modified` el 27-jul-2026)

| Documento | Última modificación |
|---|---|
| Estándar de Carta Porte (PDF) | 17-jun-2024 |
| Esquema `CartaPorte31.xsd` | 17-jun-2024 |
| Cadena original `CartaPorte31.xslt` | 17-jun-2024 |
| Matriz de errores (XLS) | 17-jun-2024 |
| Catálogos (XLS `CatalogosCartaPorte31.xls`) | **13-dic-2024** |
| **Esquema de catálogos `catCartaPorte.xsd`** | **13-ene-2026** |

Esto último es importante y no está bien reflejado en la página del SAT: el **XLS** de catálogos sigue con fecha 13-dic-2024, pero el **XSD** de catálogos (el que realmente usan los PAC para validar) fue modificado el **13 de enero de 2026 a las 16:55 UTC**. Lo comprobé con una petición `HEAD` al servidor del SAT:

```
$ curl -sI http://www.sat.gob.mx/sitio_internet/cfd/catalogos/CartaPorte/catCartaPorte.xsd
Last-Modified: Tue, 13 Jan 2026 16:55:44 GMT
```

**Verificado.** Tamaño actual de los catálogos que descargué hoy: `c_ClaveProdServCP` 48,757 claves; `c_MaterialPeligroso` 4,686; `c_ClaveUnidadPeso` 472; `c_TipoEmbalaje` 59; `c_SubTipoRem` 32; `c_ConfigAutotransporte` 36; `c_TipoPermiso` 26; `c_RegimenAduanero` 10; `c_FiguraTransporte` 5.

### ¿Cambió algo de la versión en 2026?

**No.** El estándar 3.1 sigue igual desde 17-jun-2024. Lo que cambió en 2026:

1. **Catálogos** (13-ene-2026, ver arriba).
2. **Se adicionó la regla 2.7.7.1.6.** a la RMF 2026 — cancelación de CFDI de traslado con CCP cuando se traslada diésel o gasolina (ver §8.3).
3. **Cambio de redacción** en las reglas 2.7.7.1.1., 2.7.7.1.2., 2.7.7.1.3. y 2.7.7.1.4.: donde antes decía *"el Instructivo de llenado del CFDI al que se le incorpora el Complemento Carta Porte"* ahora dice *"los diferentes instructivos de llenado"* (plural), porque hay uno por modo de transporte. **Verificado** contra el texto de la RMF 2026.
4. **La Primera Resolución de Modificaciones a la RMF 2026 (DOF 9-jul-2026) NO tocó la Sección 2.7.7.** Leí el resolutivo PRIMERO completo: reforma el Glosario y las reglas 2.1.6., 2.4.1., 2.7.1.48., 2.7.3.1.–2.7.3.9., 2.7.4.1., 2.7.5.8., 2.10.10., 2.11.3., 2.14.3., 2.14.9., 2.14.11., 3.15.14., 3.16.11., 5.2.7., 5.2.8., 5.2.48., 9.4.6., 10.16., 11.7.1., 11.9.13., 12.1.2., 12.1.9., 12.1.11.; adiciona 3.5.23., 9.1.23., 9.1.24., 11.7.3. y el Capítulo 11.18.; deroga 2.12.4. **Ninguna es de Carta Porte.** **Verificado.**

---

## 3. Quién está obligado: transportista vs dueño de la mercancía

La estructura de la Subsección 2.7.7.1. de la RMF 2026 es la siguiente. Todas las reglas están **verificadas** contra el texto publicado en el DOF el 28-dic-2025.

### 3.1 Regla 2.7.7.1.1. — El transportista (CFDI de **ingreso**)

Obligados:

- Contribuyentes, **intermediarios o agentes de transporte** dedicados al transporte de carga general y especializada (terrestre, férreo, aéreo, marítimo).
- Servicio de **paquetería y mensajería**.
- **Grúas de arrastre**, y grúas de arrastre y salvamento y depósito de vehículos.
- **Traslado de fondos y valores**.
- **Materiales y residuos peligrosos**.
- "…entre otros servicios que impliquen la transportación de bienes o mercancías."

El CFDI + complemento **amparan la prestación del servicio y acreditan el transporte y la legal tenencia** de los bienes con su representación impresa.

**Obligación cruzada del contratante (clave para Likida):**

> "Quien contrate el servicio de transporte de bienes o mercancías en territorio nacional, **está obligado a proporcionar al transportista, con exactitud, los datos necesarios** para la identificación de los bienes o mercancías que se trasladen…"

**Responsabilidad partida:**

> "En caso de que se realice un servicio de traslado de bienes o mercancías sin contar con el CFDI de tipo ingreso con 'Complemento Carta Porte', o bien, el referido complemento no cumpla con lo establecido en el 'Estándar del Complemento Carta Porte' y los diferentes instructivos de llenado…, **tanto quien contrate el servicio de transporte de bienes o mercancías, como quien lo preste, serán responsables** ante la autoridad competente cuando esta detecte alguna irregularidad en los datos registrados en el 'Complemento Carta Porte', **dicha responsabilidad se limitará a los datos que proporcione cada una de las partes** involucradas…"

Fundamentos citados por la propia regla: **CFF 29, 29-A, 83, 84; Reglamento de Autotransporte Federal y Servicios Auxiliares 74; RMF 2.6.1.1., 2.6.1.2., 2.7.1.23.**

### 3.2 Regla 2.7.7.1.2. — El dueño de la mercancía (CFDI de **traslado**)

Aplica a **propietarios, poseedores o tenedores** de mercancías o bienes **que formen parte de sus activos**, cuando los trasladan **con sus propios medios** (incluidas grúas de arrastre y vehículos de traslado de fondos y valores), por vía terrestre, férrea, marítima o aérea.

Requisitos: valor cero, su propio RFC como emisor **y** receptor, y la clave de producto/servicio del instructivo.

Fundamento citado: **CFF 29, 29-A; RMF 2.7.7.1.1.**

### 3.3 Regla 2.7.7.1.3. — Transporte dedicado (el caso raro que confunde a las flotas)

Cuando un transportista **asigna una o más unidades específicas a un mismo cliente**:

1. El **transportista** emite un CFDI de tipo **ingreso SIN complemento** que ampara la totalidad del servicio.
2. El **cliente o contratante** emite un CFDI de tipo **traslado CON complemento**, por cada traslado de sus propias mercancías y cuando implique cambio de medio o modo de transporte, **relacionando el folio fiscal del CFDI de ingreso**.

Es decir: en dedicado, **el que emite la Carta Porte es el cliente, no el transportista**. **Verificado.**

### 3.4 Regla 2.7.7.1.4. — Traslado de fondos y valores

Mismo patrón invertido: CFDI de ingreso sin complemento por la totalidad del servicio por cliente; y **previo a realizar el traslado**, un CFDI de traslado **con** complemento que relacione al de ingreso. **Verificado.**

### 3.5 Regla 2.7.7.1.5. — Transportistas residentes en el extranjero

Personas físicas o morales que prestan servicio de transporte de carga y propietarios de vehículos de carga **residentes en el extranjero sin establecimiento permanente en México** (regla 2.4.5. de las RGCE) **pueden amparar el traslado con la documentación del artículo 146 de la Ley Aduanera** en lugar del CCP.

Cuidado: *"Lo anterior no releva a los transportistas residentes en el extranjero del cumplimiento de las demás regulaciones aplicables para el tránsito de mercancías en territorio nacional."* **Verificado.**

### 3.6 Cuándo el intermediario NO emite Carta Porte

Si el intermediario o agente de transporte **subcontrata** a un tercero, emite a su cliente un CFDI de ingreso **sin** complemento con la clave `78141501` "Servicios de expedidores de fletes", y **el transportista subcontratado** es quien emite el CFDI con CCP. Si el intermediario transporta con medios propios, sí emite CFDI de ingreso **con** complemento.
— Instructivo de llenado CCP 3.1 Autotransporte, Apéndice 5. **Verificado.**

### 3.7 Otras reglas del sector autotransporte (Subsección 2.7.7.2.)

| Regla | Tema | Qué permite |
|---|---|---|
| 2.7.7.2.1. | Traslado local | CFDI de ingreso o traslado **sin** CCP si no se pisa tramo federal |
| 2.7.7.2.2. | Paquetería y mensajería | CFDI de ingreso sin CCP por la totalidad, con nodos `Concepto` por guía; reglas específicas por milla |
| 2.7.7.2.3. | Grúas a nivel local | CFDI de ingreso sin CCP si no se pisa tramo federal |
| 2.7.7.2.4. | Hidrocarburos/petrolíferos a nivel local | **SIEMPRE** exige CCP, aun siendo local |
| 2.7.7.2.5. | Carga consolidada | Ingreso sin CCP por cliente; traslado **con** CCP en la etapa intermedia |
| 2.7.7.2.6. | Exportación vía prestador de servicios | Ingreso con CCP, destino final en el extranjero |
| 2.7.7.2.7. | Exportación definitiva por medios propios | Traslado con CCP |
| 2.7.7.2.8. | Tramos de jurisdicción federal | La regla del radio de 30 km / camión C2 |
| 2.7.7.2.9. | Logística inversa, recolección o devolución | El mismo CFDI ampara el retorno si es misma mercancía y cantidad igual o menor |

**Verificado** (todas leídas en el texto de la RMF 2026).

---

## 4. Federal vs local: la línea que define todo

### 4.1 Qué es un tramo de jurisdicción federal

Definición operativa del SAT (FAQ CCP 3.1, pregunta 7):

> "En materia de autotransporte, **a la distancia que se recorre en una carretera que está a cargo del gobierno federal**, que proporciona acceso y comunicación a las principales ciudades, fronteras y puertos marítimos del país…"

**NO se consideran tramos federales** los recorridos dentro de **aduanas, aeropuertos, puertos marítimos o terminales ferroviarias**.

Un tramo es **local** cuando el traslado se realiza dentro de una localidad, comunidad, estado **o incluso entre estados**, siempre que no implique transitar por alguna carretera federal.

Dónde consultar qué carretera es federal: el Apéndice referido en el **artículo 6º del Reglamento sobre el Peso, Dimensiones y Capacidad de los Vehículos de Autotransporte que Transitan en los Caminos y Puentes de Jurisdicción Federal**, y el **Aviso por el que se modifica la Clasificación de las Carreteras, DOF 23-nov-2023**.

**Verificado** (FAQ CCP 3.1, pregunta 7, con sus fundamentos).

Definición legal de fondo: **Ley de Caminos, Puentes y Autotransporte Federal, artículo 2º, fracción I** — son caminos federales los que entroncan con camino de país extranjero, los que comunican a dos o más estados, y los construidos en su totalidad o mayor parte por la Federación o con fondos federales o concesión federal. **Verificado** (texto vigente, última reforma DOF 14-nov-2025).

### 4.2 Traslado local: regla 2.7.7.2.1. de la RMF 2026 (texto vigente)

Dos supuestos:

1. **Transportista** que presta autotransporte terrestre de carga general y especializada **sin transitar por tramo federal** → puede acreditar el transporte con la representación impresa del **CFDI de tipo ingreso con requisitos del art. 29-A del CFF, sin complemento Carta Porte**, registrando la clave de producto/servicio del instructivo. (El Apéndice 4 del Instructivo señala la clave **`78101801`** "Servicios de transporte de carga por carretera (en camión) en área local".)
2. **Propietario/poseedor/tenedor** que mueve bienes de sus activos **sin transitar por tramo federal** → **CFDI de tipo traslado sin complemento**, con las claves de producto correspondientes del catálogo `c_ClaveProdServCP`.

**La condición fina que casi nadie lee:**

> "Lo señalado en esta regla será aplicable para los contribuyentes y transportistas que tengan la **plena certeza** de que no transitarán por algún tramo de jurisdicción federal… **En caso de que, por cualquier causa, se transite por algún tramo de jurisdicción federal**, los contribuyentes a que se refiere esta regla **deberán emitir los CFDI que corresponda** conforme a las reglas 2.7.7.1.1. y 2.7.7.1.2."

**A quién NO le aplica la facilidad local** (cuarto párrafo de la regla 2.7.7.2.1.):

- Transportistas residentes en el extranjero (regla 2.7.7.1.5.).
- Traslado de hidrocarburos o petrolíferos (regla 2.7.7.2.4.).
- Mercancías destinadas a despacho aduanero en operaciones de comercio exterior.
- **Contribuyentes que transporten medicamentos en territorio nacional.**

**Verificado** (texto íntegro de la RMF 2026).

---

## 5. La excepción de los 30 km: sigue vigente en 2026

### 5.1 Texto vigente — regla 2.7.7.2.8. de la RMF 2026

> "Para los efectos de las reglas 2.7.7.1.3., 2.7.7.1.4., 2.7.7.2.1., 2.7.7.2.2., 2.7.7.2.3. y 2.7.7.2.5., **se entenderá que los contribuyentes que realizan el transporte de bienes y/o mercancías a través de autotransporte mediante vehículos de carga con características que no excedan los pesos y dimensiones de un camión tipo C2 de conformidad con la NOM-012-SCT-2-2017**, o la que la sustituya, **no transitan por tramos de jurisdicción federal** a que se refiere la Ley de Caminos, Puentes y Autotransporte Federal y su Reglamento, **siempre que en su trayecto la longitud del tramo federal que se pretenda utilizar no exceda de un radio de distancia de 30 kilómetros, los cuales se computarán entre el origen inicial y el destino final, incluyendo los puntos intermedios del traslado.**
>
> En caso de que los vehículos de carga transporten **remolques** cuyas características no excedan los pesos y dimensiones del camión tipo C2 de conformidad con la Norma Oficial señalada en el párrafo que antecede, les resulta aplicable lo establecido en el párrafo anterior."

Fundamentos citados por la propia regla: **CFF 29; Ley de Caminos, Puentes y Autotransporte Federal 2; RMF 2.7.7.1.3., 2.7.7.1.4., 2.7.7.1.5., 2.7.7.2.1., 2.7.7.2.2., 2.7.7.2.3., 2.7.7.2.4., 2.7.7.2.5.; RGCE 2.4.3.**

**VERIFICADO. La excepción de 30 km sigue vigente en 2026 sin cambios de redacción respecto de ejercicios previos.**

### 5.2 Cómo leer esto sin equivocarse

Tres condiciones **acumulativas**:

1. **Vehículo:** no exceder pesos y dimensiones de un camión **C2** conforme a la **NOM-012-SCT-2-2017**. Un C2 es un camión unitario de 2 ejes / 6 llantas. Cualquier configuración mayor (C3, T3S2, T3S2R4, etc.) queda fuera.
2. **Geometría:** el tramo federal usado debe caber en un **radio de 30 km**. No son 30 km lineales de carretera: es un radio entre **origen inicial** y **destino final**, contando **puntos intermedios**. Un reparto con 12 paradas puede sumar 90 km de carretera federal y seguir dentro del radio de 30 km.
3. **Materia:** no debe tratarse de los casos excluidos.

**Exclusiones de la regla 2.7.7.2.8. (tercer y cuarto párrafo):**

- Transportistas residentes en el extranjero (2.7.7.1.5.).
- Hidrocarburos y petrolíferos (2.7.7.2.4.).
- Mercancías para despacho aduanero en comercio exterior.
- **Medicamentos en territorio nacional.**

**Verificado.**

### 5.3 Lo que sí se debe emitir aunque no haya complemento

> "Conviene destacar que aun y cuando no se expida el complemento Carta Porte, **se debe emitir una factura electrónica de tipo ingreso por los servicios que se presten a cambio de una remuneración**."
— FAQ CCP 3.1, preguntas 1, 9 y 27. **Verificado.**

### 5.4 Otros casos en que NO se emite complemento

- **Maniobras en zonas federales** (carga, descarga, estiba, desestiba, alijo, acarreo, almacenaje, transbordo) dentro de estaciones de ferrocarril, aduanas, recintos fiscalizados, recintos portuarios, aeródromos, aeropuertos, puertos: no hay traslado, hay maniobra. — FAQ CCP 3.1, pregunta 8. **Verificado.**
- **Entrega dentro de terminal aeroportuaria** cuando origen y destino están dentro de la zona. — FAQ CCP 3.1, pregunta 11. **Verificado.**
- **Personas físicas que reparten a nivel local vía plataformas tecnológicas.** — FAQ CCP 3.1, pregunta 10. **Verificado.**

---

## 6. Campos obligatorios del complemento (autotransporte)

Extraídos del **Estándar del Complemento Carta Porte 3.1** (SAT, 17-jun-2024). "Requerido" significa obligatorio a nivel XSD; "condicional" significa que el estándar tiene una validación adicional que lo vuelve obligatorio en ciertos casos.

### 6.1 Nodo raíz `CartaPorte`

| Campo | Uso | Nota |
|---|---|---|
| `Version` | requerido | Valor prefijado `3.1` |
| `IdCCP` | **requerido** | 36 caracteres, patrón `CCC…`, RFC 4122, generado por el sistema emisor |
| `TranspInternac` | requerido | `Sí` / `No` |
| `EntradaSalidaMerc` | condicional | Obligatorio si `TranspInternac` = `Sí`; prohibido si `No` |
| `PaisOrigenDestino` | condicional | Igual condición |
| `ViaEntradaSalida` | condicional | Igual condición |
| `TotalDistRec` | condicional | **Obligatorio si existe el nodo `Autotransporte`.** Debe ser la suma de los `DistanciaRecorrida` de las ubicaciones tipo `Destino`. Decimal, mín. 0.01, máx. 99999 |
| `RegistroISTMO`, `UbicacionPoloOrigen`, `UbicacionPoloDestino` | condicional | Polos de Desarrollo del Istmo de Tehuantepec |

### 6.2 `Ubicaciones` → `Ubicacion` (mínimo 2 con autotransporte: una `Origen` y una `Destino`)

| Campo | Uso |
|---|---|
| `TipoUbicacion` | requerido (`Origen` / `Destino`) |
| `RFCRemitenteDestinatario` | requerido — si no es genérico, **debe estar en `l_RFC`** |
| `FechaHoraSalidaLlegada` | requerido — formato `AAAA-MM-DDThh:mm:ss` (fecha y hora **estimada**) |
| `IDUbicacion` | condicional — obligatorio si existe `CantidadTransporta` (formato `OR……` / `DE……`) |
| `DistanciaRecorrida` | condicional — **obligatorio en las ubicaciones tipo `Destino` cuando existe `Autotransporte`** |
| `NumRegIdTrib` | condicional — obligatorio si el RFC es el genérico extranjero `XEXX010101000` |
| `ResidenciaFiscal` | condicional — obligatorio si hay `NumRegIdTrib`; debe ser ≠ `MEX` |

### 6.3 `Ubicaciones` → `Ubicacion` → `Domicilio`

Requeridos: **`Estado`, `Pais`, `CodigoPostal`**.
Opcionales: `Calle`, `NumeroExterior`, `NumeroInterior`, `Colonia`, `Localidad`, `Referencia`, `Municipio`.

### 6.4 `Mercancias`

| Campo | Uso | Validación |
|---|---|---|
| `PesoBrutoTotal` | requerido | **Debe ser exactamente igual a la suma de los `PesoEnKg` de cada `Mercancia`.** Decimal, mín. 0.001, 3 decimales |
| `UnidadPeso` | requerido | Catálogo `c_ClaveUnidadPeso` |
| `NumTotalMercancias` | requerido | **Debe ser igual al número de nodos `Mercancia`** |
| `PesoNetoTotal` | condicional | Marítimo/ferroviario |
| `LogisticaInversaRecoleccionDevolucion` | condicional | Solo puede existir si hay nodo `Autotransporte` |

### 6.5 `Mercancias` → `Mercancia` (uno por cada mercancía)

Requeridos: **`BienesTransp`** (catálogo `c_ClaveProdServCP`, 48,757 claves), **`Descripcion`**, **`Cantidad`**, **`ClaveUnidad`**, **`PesoEnKg`**.

Condicionales relevantes:
- `MaterialPeligroso`: obligatorio cuando la clave de `BienesTransp` tiene en el catálogo la columna "Material peligroso" con valor `0,1` o `1`.
- `CveMaterialPeligroso`, `Embalaje`, `DescripEmbalaje`: aplican al material peligroso.
- Campos COFEPRIS (`SectorCOFEPRIS`, `NombreIngredienteActivo`, `DenominacionGenericaProd`, `FechaCaducidad`, `LoteMedicamento`, `FormaFarmaceutica`, `RegistroSanitarioFolioAutorizacion`, etc.): medicamentos, precursores químicos, plaguicidas, sustancias tóxicas.
- `DocumentacionAduanera` (`TipoDocumento` requerido; `NumPedimento` + `RFCImpo` si el tipo es `01` "Pedimento"; si no, `IdentDocAduanero`).

### 6.6 `Mercancias` → `Autotransporte`

| Campo | Uso | Detalle |
|---|---|---|
| **`PermSCT`** | **requerido** | Clave del catálogo `c_TipoPermiso` |
| **`NumPermisoSCT`** | **requerido** | String 1–50 caracteres, patrón `[^\|]{1,50}` |

`IdentificacionVehicular`:

| Campo | Uso | Detalle |
|---|---|---|
| `ConfigVehicular` | requerido | Catálogo `c_ConfigAutotransporte` (36 claves: `C2`, `C3`, `T3S2R4`, `VL`, etc.) |
| `PesoBrutoVehicular` | requerido | En **toneladas**, conforme a la NOM-012-SCT-2-2017. Decimal mín. 0.01, 2 decimales |
| `PlacaVM` | requerido | 5 a 7 caracteres alfanuméricos, **sin guiones ni espacios** |
| `AnioModeloVM` | requerido | Entero, patrón `(19[0-9]{2}\|20[0-9]{2})` |

`Seguros`:

| Campo | Uso | Detalle |
|---|---|---|
| `AseguraRespCivil` | **requerido** | Nombre de la aseguradora |
| `PolizaRespCivil` | **requerido** | 3 a 30 caracteres |
| `AseguraMedAmbiente` | condicional | **Obligatorio si alguna mercancía tiene `MaterialPeligroso` = `Sí`** |
| `PolizaMedAmbiente` | condicional | Obligatorio si existe `AseguraMedAmbiente` |
| `AseguraCarga`, `PolizaCarga`, `PrimaSeguro` | opcionales | |

`Remolques` (nodo `Remolque`, hasta 2): `SubTipoRem` (catálogo `c_SubTipoRem`, 32 claves) y `Placa`, ambos requeridos.
Validación: si la `ConfigVehicular` tiene en el catálogo la columna "Remolque" con valor `1`, **el nodo `Remolques` debe existir**; con `0,1` puede existir; con `0` debe omitirse.

### 6.7 `FiguraTransporte`

**Validación dura:** *"Cuando exista el nodo `Mercancias:Autotransporte`, este elemento debe existir"* y debe haber **al menos un `TiposFigura` con `TipoFigura` = `01` (Operador)**.

| Campo | Uso | Detalle |
|---|---|---|
| `TipoFigura` | requerido | Catálogo `c_FiguraTransporte`: `01` Operador, `02` Propietario, `03` Arrendador, `04`, `05` |
| `NombreFigura` | requerido | |
| `RFCFigura` | condicional | **Debe estar en `l_RFC`**; si no está, se omite y se usa `NumRegIdTribFigura` |
| `NumLicencia` | condicional | **Obligatorio cuando `TipoFigura` = `01`**; en cualquier otro caso **debe omitirse**. 6 a 16 caracteres |
| `NumRegIdTribFigura` | condicional | Obligatorio si no hay `RFCFigura` |
| `ResidenciaFiscalFigura` | condicional | Obligatorio si hay `NumRegIdTribFigura`; ≠ `MEX` |
| `PartesTransporte` | condicional | **El nodo debe existir cuando `TipoFigura` = `02` o `03`**; en otro caso se omite |

Domicilio de la figura: mismos requeridos que en Ubicaciones (`Estado`, `Pais`, `CodigoPostal`).

**Todo el §6 verificado** contra el Estándar del Complemento Carta Porte 3.1 (PDF oficial descargado del SAT) y el `catCartaPorte.xsd` del 13-ene-2026.

### 6.8 Los 37 datos mínimos y de quién es cada uno (Apéndice 3 del Instructivo)

El SAT publica una tabla de **37 datos mínimos** para Autotransporte Nacional, dividida entre el cliente y el transportista. Esta tabla es la que delimita la responsabilidad de cada parte bajo la regla 2.7.7.1.1.

**Los 19 que aporta el CLIENTE (contratante):**

1. Transporte internacional
2. Origen (ubicación)
3. RFC remitente
4. Estado (domicilio origen)
5. País
6. CP
7. Destino (ubicación)
8. RFC destinatario
9. Estado (domicilio destino)
10. País
11. CP
12. Peso bruto total
13. Unidad de peso
14. Número total de mercancías
15. Bienes transportados (clave)
16. Descripción de la mercancía
17. Cantidad
18. Clave unidad
19. Peso en kilogramos

*(Más, cuando aplique material peligroso: clave material peligroso, embalaje y descripción del embalaje.)*

**Los 18 que aporta el TRANSPORTISTA:**

1. Versión
2. IdCCP
3. Total de distancia recorrida
4. Fecha y hora de salida
5. Fecha y hora de llegada
6. Distancia recorrida
7. Permiso SICT
8. Número de permiso
9. Tipo de vehículo (config. vehicular)
10. Peso bruto vehicular
11. Placa del vehículo
12. Año del vehículo
13. Nombre de la aseguradora
14. Número de póliza de responsabilidad civil
15. Operador (chofer)
16. RFC del operador
17. Número de licencia
18. Nombre de la figura

Nota literal del SAT en ese apéndice:

> "Quien contrate el servicio de transporte de bienes y/o mercancías, como quien lo preste, serán responsables ante la autoridad competente cuando esta detecte alguna irregularidad en los datos registrados en el complemento Carta Porte. **Dicha responsabilidad se limitará a los datos que proporcione cada una de las partes involucradas** en la expedición del comprobante fiscal conforme al listado antes señalado."

Si el transporte es internacional se suman 6 campos más del cliente: entrada/salida de mercancías, país de origen o destino, vía de entrada o salida, régimen aduanero, tipo de materia y tipo de documento aduanero (con número de pedimento y RFC del importador, o identificador del documento).

**Verificado** (Instructivo de llenado CCP 3.1 Autotransporte, Apéndice 3, pp. 77-78).

---

## 7. El papel del RFC del transportista y del permiso SICT

### 7.1 RFC

Lo que el SAT **sí** valida en el timbrado (Estándar 3.1, sección 8):

- `Comprobante:Receptor:Rfc` en el CFDI de ingreso: si no es genérico, debe estar en la **lista de RFC inscritos no cancelados (`l_RFC`)**.
- En CFDI de traslado: `Receptor:Rfc` **debe ser igual** a `Emisor:Rfc`.
- `Ubicaciones:Ubicacion:RFCRemitenteDestinatario`: si no es genérico, debe estar en `l_RFC`.
- `FiguraTransporte:TiposFigura:RFCFigura`: debe estar en `l_RFC`; si no, se omite y se usa `NumRegIdTribFigura`.

**No hay validación de que el RFC del emisor tenga registrada la actividad económica de autotransporte.** No encontré tal validación en el Estándar 3.1. **Verificado por ausencia** (leí la sección completa de validaciones adicionales del proveedor).

### 7.2 Permiso SICT

`PermSCT` es un campo **requerido** cuando existe el nodo `Autotransporte`. Debe contener una clave del catálogo `c_TipoPermiso`, que hoy tiene **26 claves**: `TPAF01` a `TPAF20` (autotransporte federal, 20 claves), `TPTM01` (marítimo), `TPTA01` a `TPTA04` (aéreo) y `TPXX00`.

Las tres relevantes para carga terrestre, según el propio Instructivo:

| Clave | Descripción |
|---|---|
| `TPAF01` | Autotransporte Federal de carga general |
| `TPAF02` | Transporte privado de carga |
| `TPAF03` | Autotransporte Federal de Carga Especializada de materiales y residuos peligrosos |

**La válvula de escape `TPXX00`:**

> "Cuando no se cuente con un permiso emitido por parte de la Secretaría de Infraestructura, Comunicaciones y Transportes (SICT), debido a que no es requerido y se cuenta con un permiso de ámbito local o estatal, se debe registrar la clave `TPXX00` en el campo Permiso SICT (`PermSCT`), registrando el número de permiso local o estatal en el campo Número de Permiso SICT (`NumPermisoSCT`). **En caso de no requerir permiso se debe registrar la descripción `Permiso no contemplado en el catálogo`.**"
— Instructivo CCP 3.1 Autotransporte, sección 2.4. **Verificado.**

**Hallazgo importante y contraintuitivo:** el SAT **no valida el número de permiso**. En la sección 8 del Estándar 3.1 (validaciones adicionales a realizar por el proveedor de certificación) **no existe ninguna validación para `PermSCT` ni para `NumPermisoSCT`**, más allá de que la clave pertenezca al catálogo y que el número cumpla el patrón `[^|]{1,50}`. Un número de permiso inventado **pasa el timbrado**. Lo que no pasa es una revisión de la Guardia Nacional o de la SICT en carretera. **Verificado por ausencia** (revisé el listado completo de validaciones).

### 7.3 De dónde sale la obligación del permiso

**Ley de Caminos, Puentes y Autotransporte Federal, artículo 8º** (texto vigente, última reforma DOF 14-nov-2025):

> "Se requiere permiso otorgado por la Secretaría para:
> I. La operación y explotación de los servicios de autotransporte federal de carga, pasaje y turismo;
> …
> III. Los servicios de arrastre, arrastre y salvamento y depósito de vehículos;
> IV. Los servicios de paquetería y mensajería;
> …
> XI. El transporte privado de personas y de carga salvo lo dispuesto en el artículo 40 de la presente Ley."

**Verificado.**

Consecuencia de no tenerlo — **LCPAF artículo 74 Ter, fracción I**: la autoridad podrá **retirar de la circulación** los vehículos "cuando se encuentren prestando el servicio de autotransporte federal, sus servicios auxiliares y transporte privado en los caminos y puentes, **sin contar con el permiso correspondiente**". **Verificado.**

También son requisitos independientes del CFDI: **verificación físico-mecánica** (LCPAF art. 35) y **licencia federal vigente del operador**, con obligación expresa del permisionario de "vigilar y constatar que los conductores de sus vehículos cuentan con la licencia federal vigente" (LCPAF art. 36). **Verificado.**

Y la **póliza de responsabilidad civil** no es solo un campo del XML: *"se debe contar con una póliza de seguro que cubra los riesgos del autotransporte… ya que los datos de la aseguradora y número de póliza para autotransporte federal son datos obligatorios"* — FAQ CCP 3.1, sección Autotransporte, pregunta 2, con fundamento en el **artículo 83 del Reglamento de Autotransporte Federal y Servicios Auxiliares**. **Verificado.**

### 7.4 El puente con la SICT

La SICT reconoce el complemento como la carta de porte oficial mediante el **"ACUERDO por el que se actualiza la Carta de Porte en Autotransporte Federal y sus servicios auxiliares", DOF 16-dic-2021**. La Ley de Caminos, en su artículo 2º fracción II, define la Carta de Porte como *"el título legal del contrato entre el remitente y la empresa"*. **Verificado** (existencia y fecha del Acuerdo confirmadas en el DOF, código 5638495; el Instructivo 3.1 lo cita en su Marco jurídico).

---

## 8. Corregir, cancelar y sustituir

### 8.1 Fallas mecánicas y cambios de unidad u operador en ruta

Procedimiento oficial (Instructivo CCP 3.1, Apéndice 12), **en este orden**:

1. Emitir un **nuevo** CFDI con CCP con los datos actualizados.
2. **Antes de cancelar el primero**, relacionar el nuevo con el inicial usando `TipoRelacion` = **`04` "Sustitución de los CFDI previos"**.
3. Cancelar el CFDI incorrecto con motivo de cancelación **`01` "Comprobantes emitidos con errores con relación"**, relacionando el corregido.
4. Hacer llegar la representación impresa al operador.
5. Reanudar el viaje.

**Verificado.** El orden importa: primero se emite el sustituto, luego se cancela el original.

Mismo procedimiento para caso fortuito o fuerza mayor: accidentes, desperfectos mecánicos, robos, embargos de mercancías. — FAQ CCP 3.1, sección Autotransporte, pregunta 11. **Verificado.**

### 8.2 Devoluciones y logística inversa

Regla **2.7.7.2.9.** de la RMF 2026: el mismo CFDI con CCP ampara el retorno **siempre que la mercancía que se retorna sea del mismo tipo y en cantidad igual o menor** a la señalada en el complemento. En el XML se marca `LogisticaInversaRecoleccionDevolucion` = `Sí`. Para paquetería y mensajería no es necesario relacionar los números de guía de lo que se recolecte o devuelva. **Verificado.**

### 8.3 Cancelación cuando se traslada diésel o gasolina — regla NUEVA en 2026

**Regla 2.7.7.1.6. (adicionada en la RMF 2026):**

> "…la cancelación de los CFDI de tipo traslado con 'Complemento Carta Porte', en donde se señale en el campo 'ClaveProdServ' como clave de producto de los bienes y/o mercancías que se trasladan, alguna de las siguientes: **`15101505` Combustible Diesel, `15101514` Gasolina regular menor a 91 octanos y `15101515` Gasolina premium mayor o igual a 91 octanos, podrán cancelarse sin aceptación, desde que se emitan y hasta antes de que se inicie el traslado. Transcurrido este plazo, los CFDI quedarán como no cancelables. Una vez iniciado el traslado, no podrá emitirse el citado CFDI con 'Complemento Carta Porte'.**"

Fundamento: **CFF 29-A, cuarto párrafo.** **Verificado.**

Concordancias en la misma RMF 2026:
- **Regla 2.7.1.34.**: para CFDI de **ingreso** con CCP donde el campo `BienesTransp` contenga `15101505`, `15101514` o `15101515`, **el receptor debe manifestar expresamente la aceptación de la cancelación** en el Portal del SAT (no aplica la aceptación tácita por silencio de 3 días).
- **Regla 2.7.1.35., fracción IV**: los CFDI de traslado pueden cancelarse sin aceptación **excepto** aquellos con CCP con esas tres claves de combustible, que se rigen por la 2.7.7.1.6.

**Verificado.**

### 8.4 Plazo general de cancelación

**CFF artículo 29-A** (texto vigente, última reforma DOF 09-abr-2026): los CFDI *"se podrán cancelar a más tardar en el mes en el cual se deba presentar la declaración anual del impuesto sobre la renta que corresponda al ejercicio fiscal en el cual se expidió el referido comprobante y siempre que la persona a favor de quien se expidan acepte su cancelación"*. **Verificado.**

### 8.5 Reglas operativas que suelen sorprender

- **No se puede facturar en lote.** *"No se puede facturar de forma masiva, se debe emitir una factura electrónica de tipo ingreso con complemento Carta Porte por cada servicio de transporte que se realice."* — FAQ CCP 3.1, Autotransporte, pregunta 9. **Verificado.**
- **Un CFDI por cliente**, aunque la mercancía de varios clientes vaya en la misma unidad y al mismo destino, salvo carga consolidada (regla 2.7.7.2.5.). — FAQ CCP 3.1, Autotransporte, pregunta 7. **Verificado.**
- **El número de unidades de la flota es irrelevante.** Un hombre-camión con una sola unidad tiene exactamente la misma obligación. — FAQ CCP 3.1, Autotransporte, pregunta 4. **Verificado.**
- **`Propietario` vs `Arrendador`:** si el vehículo es de un tercero y **no** hay contrato de arrendamiento, se registra `Propietario` (`02`); si **sí** lo hay, `Arrendador` (`03`). — FAQ CCP 3.1, Autotransporte, pregunta 12. **Verificado.**
- **Retención de IVA:** en el CFDI de ingreso por flete, además del traslado de IVA se debe registrar la **retención del 4%** del monto del servicio efectivamente pagado **cuando el cliente sea persona moral**. — FAQ CCP 3.1, Autotransporte, pregunta 6, con fundamento en **LIVA 1 y 1-A y RLIVA art. 3, fracción II**. **Verificado.**

---

## 9. Sanciones

### 9.1 Multa por emitir el CFDI sin el complemento

**CFF artículo 83, fracción VII** (infracción) + **artículo 84, fracción IV, inciso d)** (sanción):

> "**De $450.00 a $670.00 por cada comprobante fiscal** que se emita y no cuente con los complementos que se determinen mediante las reglas de carácter general, que al efecto emita el Servicio de Administración Tributaria."

**Cantidad vigente 2026**, confirmada en el **Anexo 5 de la RMF 2026, publicado en el DOF el 28-dic-2025**, apartado B "Compilación de cantidades establecidas en el CFF". El inciso d) fue adicionado por el decreto del **DOF 12-nov-2021** (la reforma que creó el régimen sancionador de Carta Porte). **Verificado por partida doble** (texto del CFF de diputados.gob.mx, última reforma DOF 09-abr-2026, y Anexo 5 de la RMF 2026).

### 9.2 Multa por no expedir el CFDI o expedirlo sin requisitos

**CFF artículo 83, fracción VII** + **artículo 84, fracción IV, inciso a)**:

> "**De $22,300.00 a $127,530.00.** En caso de reincidencia, las autoridades fiscales podrán, adicionalmente, **clausurar preventivamente el establecimiento del contribuyente por un plazo de tres a quince días**…"

**Cantidad actualizada y vigente 2026**, publicada en el **Anexo 5 de la RMF 2026, apartado A "Cantidades actualizadas establecidas en el CFF"**, DOF 28-dic-2025. **Verificado.**

Para personas físicas del Título IV, Capítulo II, Secciones II y IV de la LISR (RESICO y plataformas): **$1,910.00 a $3,800.00**. **Verificado.**

> **Nota de precisión:** las guías de despachos y proveedores que circulan en 2026 siguen citando "$19,700 a $112,650". Ese era el rango de 2024. El rango 2026 es **$22,300 a $127,530**. Las propias Preguntas frecuentes del SAT (publicadas el 07-ago-2024) citan las cantidades de 2024 y **están desactualizadas en ese punto**.

### 9.3 Multa por no acompañar la documentación en el traslado

**CFF artículo 83, fracción XII**: *"No expedir o acompañar la documentación que ampare mercancías en transporte en territorio nacional."*
**CFF artículo 84, fracción XI**: **De $1,000.00 a $19,280.00.**

**Verificado** (CFF vigente + Anexo 5 RMF 2026).

### 9.4 No deducible ni acreditable

**CFF artículo 29-A**, párrafo antepenúltimo:

> "Las cantidades que estén amparadas en los comprobantes fiscales que **no reúnan algún requisito** de los establecidos en esta disposición o en el artículo 29 de este Código, según sea el caso, o cuando los datos contenidos en los mismos se plasmen en forma distinta a lo señalado por las disposiciones fiscales, **no podrán deducirse o acreditarse fiscalmente**."

**Verificado.** Esto es el golpe económico real: no es la multa de $450, es perder la deducción del flete y el acreditamiento del IVA.

### 9.5 La parte penal: presunción de contrabando

**CFF artículo 103**: *"Se presume cometido el delito de contrabando cuando:"*

> "**XXII. Se trasladen bienes o mercancías por cualquier medio de transporte en territorio nacional, sin el comprobante fiscal digital por Internet de tipo ingreso o de tipo traslado, según corresponda, al que se le incorpore el Complemento Carta Porte.**"
>
> "**XXIII.** Se trasladen hidrocarburos, petrolíferos o petroquímicos, por cualquier medio de transporte en territorio nacional, sin el comprobante fiscal digital por Internet de tipo ingreso o de tipo traslado, según corresponda, al que se le incorpore el Complemento Carta Porte así como con los complementos del comprobante fiscal digital por Internet de esos bienes."

Ambas fracciones fueron **adicionadas por decreto publicado en el DOF el 12-nov-2021** y **siguen vigentes** en el texto del CFF con última reforma DOF 09-abr-2026. **Verificado.**

**Pena — CFF artículo 104, fracción IV:**

> "**De tres a seis años** [de prisión], cuando no sea posible determinar el monto de las contribuciones o cuotas compensatorias omitidas con motivo del contrabando o se trate de mercancías que requiriendo de permiso de autoridad competente no cuenten con él o cuando se trate de los supuestos previstos en los artículos **103, fracciones … XXII y XXIII** … de este Código."

**Verificado.**

**Esto es lo que el fundador preguntaba sobre "mercancía de procedencia ilícita".** La mecánica es: el contrabando es históricamente un delito de mercancía extranjera; la reforma de 2021 metió por la puerta de la *presunción* el traslado de **cualquier** bien o mercancía sin CCP. Es decir, mover acero mexicano de Monterrey a Querétaro sin Carta Porte **activa una presunción de contrabando** aunque la mercancía sea nacional, comprada y facturada. La presunción admite prueba en contrario, pero el procedimiento ya arrancó.

Confirmación del propio SAT (FAQ CCP 3.1, pregunta 30):

> "En caso de que no se expida o no se acompañe la representación impresa, en papel o en formato digital del complemento Carta Porte, que ampara el traslado de los bienes y/o mercancías en territorio nacional, **se iniciarán los procedimientos que correspondan para determinar si se configura el delito de contrabando** o un incumplimiento en las obligaciones fiscales de expedición del CFDI, según corresponda."

**Verificado.**

Riesgo adicional relacionado, **CFF artículo 105, fracción I**: se sanciona con las mismas penas del contrabando a quien *"enajene, comercie, adquiera o tenga en su poder por cualquier título mercancía extranjera que no sea para su uso personal, sin la documentación que compruebe su legal estancia en el país"*. **Verificado.**

### 9.6 Embargo del vehículo

**RGCE 2026, regla 3.7.15.** (DOF 27-dic-2025), tercer párrafo:

> "…los medios de transporte, incluyendo los carros de ferrocarril, que se encuentren legalmente en el país, **que hubieran sido objeto de embargo precautorio como garantía de los créditos fiscales de las mercancías por ellos transportadas, por no contar con el CFDI con complemento Carta Porte**, al momento del reconocimiento aduanero o de una verificación de mercancías en transporte según corresponda, podrá sustituirse dicho embargo conforme a la presente regla. Para estos efectos, sólo procederá la devolución de los medios de transporte, sin que sea necesario exhibir dicha garantía, **siempre que se presente el CFDI con complemento Carta Porte correspondiente**…"

**Verificado.** Es decir: en el escenario aduanero, la unidad se puede quedar embargada, y se libera presentando el CCP.

### 9.7 Quién puede revisar en carretera

Además del SAT: **la Guardia Nacional, la SICT, las autoridades sanitarias federales** y cualquier otra con competencia de inspección y verificación en el ámbito federal por las vías generales de comunicación.

Fundamentos que cita el SAT: **Ley de la Guardia Nacional art. 9, fracciones II inciso a) y XXXIII; Ley de Vías Generales de Comunicación art. 3; LCPAF arts. 5, 74 y 74 Bis; Reglamento Interior de la SCT art. 22 fracciones I y II; RISAT art. 22 fracción XXIII.**
— FAQ CCP 3.1, pregunta 33. **Verificado.**

### 9.8 Riesgo nuevo de 2026: el CFDI "falso"

La reforma al CFF publicada en el **DOF el 7 de noviembre de 2025** adicionó al **artículo 29-A la fracción IX**:

> "**IX. Amparar operaciones existentes, verdaderas o actos jurídicos reales.**
> Los comprobantes fiscales que no cumplan con el requisito establecido en esta fracción, **se consideran falsos para efectos de este Código**."

Y adicionó el **artículo 29-A Bis**: cuando la autoridad detecte el incumplimiento de esa fracción IX durante el ejercicio de facultades, **podrá determinar lo que corresponda sin agotar previamente el procedimiento del artículo 49 Bis** (en relación con el 42, fracción V, inciso g).

**Verificado** (CFF vigente, última reforma DOF 09-abr-2026).

**Traducción para una flota:** un CFDI con Carta Porte que documente un viaje que no ocurrió —o que documente un viaje distinto al real— es ahora, por texto expreso de ley, un **comprobante falso**, y la autoridad puede actuar sin el procedimiento previo de aclaración. Esto sube el costo de "timbrar de más para cuadrar" o de reutilizar comprobantes.

---

## 10. ¿Hay periodo de gracia o "no sanción" en 2026?

**No. Y esto está verificado por lectura directa, no por inferencia.**

### 10.1 Lo que sí existió (histórico)

Cronología de los periodos de adaptación, tomada de los **Antecedentes del Instructivo de llenado CCP 3.1 publicado por el SAT**:

| Instrumento | Efecto | Fecha límite |
|---|---|---|
| RMF 2022, Transitorio Cuadragésimo Séptimo (DOF 27-dic-2021) | No sanción por CCP que no cumpla el Estándar/Instructivo | 31-mar-2022 |
| 7ª Res. Modif. RMF 2022 (DOF 20-sep-2022) | Amplía | 31-dic-2022 |
| 10ª Res. Modif. RMF 2022 (DOF 12-dic-2022) | Amplía | 31-jul-2023 |
| 6ª Res. Modif. RMF 2023 (versión anticipada 16-jul-2023) | Amplía por última vez | **31-dic-2023** |
| RMF 2024, Séptimo Transitorio (DOF 29-dic-2023) | Convivencia de versiones 2.0 y 3.0 (no es "no sanción") | 31-mar-2024 |

**Verificado.**

Vestigio útil: **los CFDI con CCP emitidos entre el 1-jun-2021 y el 31-dic-2023 siguen siendo deducibles aunque no tengan la totalidad de los requisitos del instructivo**, siempre que cumplan los demás requisitos fiscales. — FAQ CCP 3.1, pregunta 60. **Verificado.** (Sirve para defender ejercicios abiertos, no para operar hoy.)

### 10.2 2026: nada

Leí **los 25 transitorios completos de la RMF 2026** (Primero a Vigésimo Quinto, DOF 28-dic-2025). **Ninguno menciona Carta Porte, ni el complemento, ni la Sección 2.7.7., ni establece periodo de adaptación o no sanción.** Los transitorios que sí dan plazos hablan de buzón tributario, RIF, "Mis cuentas", códigos de seguridad en cajetillas de cigarros, créditos en mora y Plan México.

Leí también los transitorios de las **RGCE 2026** (DOF 27-dic-2025): tampoco hay transitorio de Carta Porte.

Y la **Primera Resolución de Modificaciones a la RMF 2026 (DOF 9-jul-2026)** no toca la Sección 2.7.7.

**Conclusión verificada: en 2026 no hay periodo de gracia, ni de convivencia de versiones, ni de no sanción, para el complemento Carta Porte.**

### 10.3 Lo único que sí funciona como "colchón"

- La **regla 2.7.7.2.1.** (traslado local) y la **2.7.7.2.8.** (radio de 30 km / C2) — pero son excepciones estructurales de la obligación, no periodos de gracia.
- El **procedimiento de sustitución** del Apéndice 12 (emitir el sustituto antes de cancelar) — permite corregir sin quedar descubierto, pero exige que se haga en el momento, no después.

---

## 11. Comercio exterior (contexto, no es el core de Likida)

- La factura con CCP es **exigible en operaciones de comercio exterior desde el 1-ene-2024** (página oficial del SAT). **Verificado.**
- **RGCE 2026, regla 2.4.12., fracción I, inciso f)**: para activar el mecanismo de selección automatizado se debe transmitir al SEA *"El folio fiscal del CFDI con complemento Carta Porte, a que se refieren las reglas 2.7.7.1.1., 2.7.7.1.2., 2.7.7.2.6. o 2.7.7.2.7., de la RMF según corresponda, **excepto los sujetos a que se refiere la regla 2.7.7.1.5.**"* — de ahí sale el DODA. **Verificado.**
- El `IdCCP` **no** se transmite en el DODA; lo que se transmite es el **folio fiscal (UUID)** del CFDI. — FAQ CCP 3.1, pregunta 6. **Verificado.**
- Para acreditar legal estancia de mercancía de procedencia extranjera durante el traslado, basta registrar en el CFDI el **número de pedimento o documento aduanero** (reglas 2.7.7.1.1. y 2.7.7.1.2.). **Es una opción, no una obligación.** **Verificado.**

---

## 12. Qué cambia esto en Likida

Concreto. Qué construir, qué validar y qué dejar de prometer.

### 12.1 Qué hay que construir

**a) Un clasificador "¿este viaje necesita Carta Porte?" con tres entradas.**
No es una pregunta de kilómetros. El árbol de decisión verificado es:

1. ¿La ruta pisa carretera federal? → si **no**, y no cae en las exclusiones (extranjeros, hidrocarburos, medicamentos, despacho aduanero), no hay CCP: solo CFDI (`78101801` para ingreso). Regla 2.7.7.2.1.
2. Si **sí** pisa federal → ¿la unidad es ≤ C2 conforme a NOM-012-SCT-2-2017 (o remolque que no exceda C2)? Si **no**, hay CCP obligatoria, punto.
3. Si es ≤ C2 → ¿el tramo federal cabe en un **radio** de 30 km entre origen inicial y destino final, incluyendo puntos intermedios? Si **sí**, se considera que no transitó por federal. Regla 2.7.7.2.8.

Ese cálculo es geométrico (radio) y hay que implementarlo como tal: `max(distancia_geodésica(origen, punto_i))` contra 30 km, no la suma del odómetro. Es un diferenciador real; casi todos lo calculan mal.

**b) El validador de los 37 campos, partido por responsable.**
El Apéndice 3 del Instructivo es literalmente la especificación del producto: 19 campos del cliente, 18 del transportista. Likida puede:
- Antes del viaje, cobrarle al contralor el "¿tu cliente ya te mandó sus 19 datos?" (checklist por WhatsApp al embarcador).
- Después del viaje, en la liquidación, señalar exactamente **de quién fue el error** cuando el SAT o la GN detecten una irregularidad, porque la regla 2.7.7.1.1. limita la responsabilidad a los datos que aportó cada parte.

**c) Validaciones aritméticas duras que se pueden correr antes de timbrar.**
Estas son de rechazo seguro por el PAC, y son triviales de implementar:
- `PesoBrutoTotal` == Σ `PesoEnKg` de cada `Mercancia`.
- `NumTotalMercancias` == número de nodos `Mercancia`.
- `TotalDistRec` == Σ `DistanciaRecorrida` de las ubicaciones tipo `Destino`.
- `DistanciaRecorrida` presente en **cada** ubicación `Destino` cuando hay `Autotransporte`.
- `NumLicencia` presente **si y solo si** `TipoFigura` = `01`.
- `PartesTransporte` presente **si y solo si** `TipoFigura` = `02` o `03`.
- Nodo `Remolques` presente/ausente según la columna "Remolque" del catálogo `c_ConfigAutotransporte` para la `ConfigVehicular` usada.
- `AseguraMedAmbiente` + `PolizaMedAmbiente` presentes si alguna mercancía es material peligroso.
- Si CFDI tipo `T`: `SubTotal` = 0, `Total` = 0, `Moneda` = `XXX`, `Receptor:Rfc` = `Emisor:Rfc`, `UsoCFDI` = `S01`.
- `PlacaVM`: 5–7 alfanuméricos, sin guiones ni espacios.

**d) Un cargador de catálogos que apunte al XSD, no al XLS.**
El XLS de la página del SAT sigue fechado 13-dic-2024; el `catCartaPorte.xsd` cambió el **13-ene-2026**. Si Likida valida contra el XLS, va a rechazar claves válidas o aceptar claves muertas. Fuente correcta:
`http://www.sat.gob.mx/sitio_internet/cfd/catalogos/CartaPorte/catCartaPorte.xsd`
Vale la pena monitorear el `Last-Modified` de ese archivo semanalmente y alertar cuando cambie.

**e) El flujo de corrección en ruta (Apéndice 12).**
Es el caso de uso más "WhatsApp" que existe: el operador reporta desde la carretera "se descompuso la unidad, me cambiaron a la 47". Likida debería, en ese momento:
1. Generar el nuevo CFDI con CCP con la unidad y el operador nuevos.
2. Relacionarlo con `TipoRelacion` = `04`.
3. Cancelar el original con motivo `01`.
4. Mandarle al operador el PDF nuevo al celular.

Ese es el producto. El orden importa: sustituto primero, cancelación después.

**f) Cruce de la liquidación contra el CCP.**
El comprobante de diésel del viaje debería cuadrar contra el `TotalDistRec` del CCP y contra el rendimiento declarado de la `ConfigVehicular`. Un viaje de 180 km con carga de 600 litros es una alerta. Likida ya tiene la mitad de esos datos por WhatsApp; la otra mitad está en el XML.

### 12.2 Qué hay que validar del lado del cliente (contralor)

- **El permiso SICT es la mentira más barata del sistema.** El SAT no valida `NumPermisoSCT`. Likida debería mantener, por flota, el número de permiso y su tipo (`TPAF01`/`TPAF02`/`TPAF03`) capturado una sola vez y reutilizado, y **marcar** los CCP donde venga `TPXX00` con la leyenda "Permiso no contemplado en el catálogo" para que el contralor sepa que esa unidad está viajando sin permiso federal registrado. Eso es un hallazgo vendible en una demo.
- **Póliza de responsabilidad civil vigente.** Es campo requerido (`AseguraRespCivil` + `PolizaRespCivil`) y obligación reglamentaria (RAFSA art. 83). Likida puede detectar pólizas repetidas, vencidas o con número inventado.
- **Licencia federal del operador.** `NumLicencia` es requerido para el operador y el permisionario tiene obligación legal de constatar su vigencia (LCPAF art. 36). Es un dato que Likida ya toca cuando el operador se identifica por WhatsApp.
- **RFC del operador.** Debe estar en `l_RFC`. Un operador dado de baja del RFC revienta el timbrado.

### 12.3 Qué dejar de prometer

- **No prometer "te evitamos multas de Carta Porte" sin matizar.** La multa por CFDI sin complemento es de **$450 a $670** — es chica. Lo caro es: (i) perder la deducción del flete y el acreditamiento del IVA (CFF 29-A), (ii) la multa de **$22,300 a $127,530** con clausura preventiva en reincidencia, y (iii) la presunción de contrabando. El pitch correcto se apoya en (i) y (iii), no en la multa por complemento.
- **No prometer "cumplimiento garantizado".** Likida no timbra la realidad: timbra lo que el operador y el embarcador reportan. Y desde la reforma del **DOF 07-nov-2025** (CFF 29-A fracción IX), un CFDI que ampare una operación que no ocurrió **es falso por ley**. Likida debe posicionarse como *evidencia y trazabilidad*, no como *garantía*.
- **No prometer "aplicamos la excepción de 30 km por ti"** sin advertir que la regla exige "plena certeza" de no pisar federal, y que si por cualquier causa se pisa, la obligación revive completa (regla 2.7.7.2.1., tercer párrafo). Likida puede *recomendar*, y debe dejar rastro de quién decidió.
- **No prometer facturación masiva de viajes.** El SAT lo prohíbe expresamente: un CFDI con CCP **por cada servicio** y **por cada cliente**. Si el roadmap contemplaba "cierra tu semana con un timbrado", hay que matarlo.
- **No prometer nada sobre transporte dedicado sin explicar la inversión de roles.** En dedicado, quien emite la Carta Porte es **el cliente**, no el transportista (regla 2.7.7.1.3.). Si Likida vende a una flota que hace dedicado, el producto es distinto: le arma el CFDI de traslado **al embarcador**.

### 12.4 Dónde está el foso

La responsabilidad partida por dato (regla 2.7.7.1.1., último párrafo, más el Apéndice 3 del Instructivo) es un problema de *coordinación entre dos empresas*, y hoy se resuelve por correo y WhatsApp desorganizado. Likida ya vive en WhatsApp. El producto no es "emitimos tu Carta Porte" (eso lo hace cualquier PAC y hasta la herramienta gratuita del SAT); el producto es **"tenemos la evidencia de quién dio qué dato, cuándo, y qué viaje respalda"**. Eso es exactamente lo que le sirve al contralor cuando llega la revisión.

---

## SIN VERIFICAR

Lo que no pude comprobar en fuente primaria. **No usar como fundamento.**

1. **"El SAT emitió más de 45,000 multas relacionadas con errores del complemento en el último año."** Aparece en blogs de proveedores (OCL Cargo, Simetría Legal). **No encontré la cifra en ninguna publicación del SAT, DOF ni informe tributario.** SIN VERIFICAR.

2. **"Las multas por Carta Porte incorrecta van de $17,020 a $97,330"** y **"de $19,700 a $112,650"**. Circulan en varias guías comerciales de 2026. Los rangos verificados en el Anexo 5 de la RMF 2026 (DOF 28-dic-2025) son **$22,300–$127,530** (art. 84-IV-a) y **$450–$670** (art. 84-IV-d). Los rangos de los blogs corresponden a ejercicios anteriores. **Las cifras de blogs están mal para 2026.**

3. **Contenido exacto de la actualización de catálogos del 13-ene-2026.** Verifiqué la **fecha** (por `Last-Modified` del `catCartaPorte.xsd` en el servidor del SAT) pero **no el detalle de qué cambió**. Un proveedor (developers.sw.com.mx) afirma que se incorporaron ~3,912 relaciones de pedimentos y un ajuste de vigencia del número de autorización `NAVMX-2024` en `c_NumAutorizacionNaviero`. **SIN VERIFICAR**: no comparé el XSD del 13-ene-2026 contra el anterior, y el SAT no publicó nota de cambio.

4. **"Se elimina la obligación de adjuntar la Carta Porte al pedimento, con periodo de transición sin multas."** Lo afirma un despacho (Grupo Cabezut). **Busqué en los transitorios de las RGCE 2026 (DOF 27-dic-2025) y no encontré tal disposición.** SIN VERIFICAR y probablemente se refiera a otro instrumento o a una versión anticipada. No usar.

5. **Descripciones completas del catálogo `c_TipoPermiso`.** Verifiqué las **26 claves** en el XSD y las descripciones de `TPAF01`, `TPAF02` y `TPAF03` en el Instructivo. Las descripciones de `TPAF04` a `TPAF20` están en el XLS de catálogos (21 MB) que no pude parsear con las herramientas disponibles. **PENDIENTE**, no incorrecto.

6. **Si el SAT valida `NumPermisoSCT` contra un padrón de la SICT.** Revisé la sección completa de "Validaciones adicionales a realizar por el Proveedor" del Estándar 3.1 y **no existe tal validación**. Es un **verificado por ausencia**, no una confirmación positiva del SAT. No pude revisar la Matriz de errores (XLS) por falta de parser de Excel, así que existe la posibilidad remota de que ahí aparezca un código de error asociado. **Confianza alta, pero no absoluta.**

7. **Cómo se prueba en la práctica el "radio de 30 km" ante una revisión.** La regla dice "radio de distancia" y el SAT no publica una metodología de cálculo (¿geodésica? ¿desde el centroide?). **No encontré criterio normativo ni criterio normativo interno del SAT sobre el método de medición.** Es una zona gris real.

8. **Existencia de una versión 3.2 o 4.0 del complemento en desarrollo.** Al 27-jul-2026 no hay ningún anuncio en el Portal del SAT ni en el DOF. **No pude verificar que no exista un anteproyecto**; solo que no hay publicación.

9. **Preguntas frecuentes vigentes:** el documento del SAT está publicado con fecha **07-ago-2024** y cita "RMF para 2024" en todos sus fundamentos. Verifiqué que **la numeración de las reglas 2.7.7.x es idéntica en la RMF 2026**, por lo que las citas mapean 1:1. Pero **las cantidades de multas que menciona el FAQ están desactualizadas**. Tratar el FAQ como criterio interpretativo vigente, no como fuente de cifras.

---

## Fuentes

**Primarias — normativa**

1. Resolución Miscelánea Fiscal para 2026, DOF 28-dic-2025 (Sección 2.7.7. y transitorios) — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/RMF_2026-DOF-28122025.pdf
2. Anexo 5 de la RMF 2026 "Cantidades actualizadas del CFF", DOF 28-dic-2025 — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo-5-RMF-2026_DOF-28122025.pdf
3. Primera Resolución de Modificaciones a la RMF 2026, DOF 09-jul-2026 — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/1aRM_RMF2026.pdf
4. Código Fiscal de la Federación, texto vigente, última reforma DOF 09-abr-2026 (arts. 29, 29-A, 29-A Bis, 83, 84, 103, 104, 105) — https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf
5. Ley de Caminos, Puentes y Autotransporte Federal, texto vigente, última reforma DOF 14-nov-2025 (arts. 2, 8, 33-36, 74, 74 Bis, 74 Ter) — https://www.diputados.gob.mx/LeyesBiblio/pdf/LCPAF.pdf
6. Reglas Generales de Comercio Exterior para 2026, DOF 27-dic-2025 (reglas 2.4.12. y 3.7.15.) — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rgce/rgce/ReglasGeneralesComercioExteriorpara2026.pdf
7. RMF 2026 publicada en el DOF — https://dof.gob.mx/nota_detalle.php?codigo=5777219&fecha=28/12/2025
8. RGCE 2026 publicadas en el DOF — https://www.dof.gob.mx/nota_detalle.php?codigo=5777199&fecha=27/12/2025
9. ACUERDO por el que se actualiza la Carta de Porte en Autotransporte Federal y sus servicios auxiliares, DOF 16-dic-2021 — https://dof.gob.mx/nota_detalle.php?codigo=5638495&fecha=16/12/2021
10. Aviso por el que se modifica la Clasificación de las Carreteras, DOF 23-nov-2023 — https://www.dof.gob.mx/nota_detalle.php?codigo=5709276&fecha=23/11/2023

**Primarias — documentación técnica del SAT**

11. Página oficial del complemento Carta Porte (consultada 27-jul-2026) — http://omawww.sat.gob.mx/tramitesyservicios/Paginas/complemento_carta_porte.htm
12. Estándar del Complemento Carta Porte 3.1 (PDF, 132 pp., mod. 17-jun-2024) — http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Carta_Porte_31.pdf
13. Instructivo de llenado del CFDI con complemento Carta Porte — Autotransporte 3.1 (PDF, 107 pp., pub. 07-ago-2024) — http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Instructivo_ComplementoCartaPorte_Autotransporte_31.pdf
14. Preguntas frecuentes del complemento Carta Porte 3.1 (PDF, 55 pp., pub. 07-ago-2024) — http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Preguntas_frecuentes_CartaPorte_31.pdf
15. Catálogos del complemento Carta Porte 3.1 (XLS, mod. 13-dic-2024) — http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/CatalogosCartaPorte31.xls
16. Esquema de catálogos `catCartaPorte.xsd` (**mod. 13-ene-2026**) — http://www.sat.gob.mx/sitio_internet/cfd/catalogos/CartaPorte/catCartaPorte.xsd
17. Esquema `CartaPorte31.xsd` — http://www.sat.gob.mx/sitio_internet/cfd/CartaPorte/CartaPorte31.xsd
18. Matriz de errores CCP 3.1 (XLS) — http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Matriz_Errores_CCP_V31.xls
19. Minisitio Carta Porte del SAT — http://omawww.sat.gob.mx/cartaporte/Paginas/default.htm
20. Ficha de trámite "Complemento Carta Porte" del portal del SAT — https://www.sat.gob.mx/consultas/68823/complemento-carta-porte-

**Secundarias — usadas solo como pista, nunca como fundamento**

21. Trade Law College, "Aspectos relevantes de la RMF 2026" — https://www.tradelawcollege.edu.mx/single-post/aspectos-relevantes-de-la-resolución-miscelánea-fiscal-para-2026-1
22. AMDA, "Comentarios sobre las Reglas de la RMF 2025 referentes al transporte de mercancías y el Complemento de Carta Porte" — https://www.amda.mx/wp-content/uploads/2025/01/anexo%203%20de%20circular%2011%20de%202025.pdf
23. SW / Timbrado Masivo CFDI, "Actualización de Catálogos Complemento Carta Porte V3.1 (13-ene-2026)" — https://developers.sw.com.mx/knowledge-base/13-enero-2026-actualizacion-de-catalogos-complemento-carta-porte-v3-1/
24. PwC México, "Resolución Miscelánea Fiscal (RMF) 2026" — https://www.pwc.com/mx/es/impuestos/novedades-fiscales/resolucion-miscelanea-fiscal-rmf-2026.html
25. AMCP, "Anexo 5 Cantidades actualizadas del CFF, RMF 2026" — https://www.amcp.mx/anexo-5-cantidades-actualizadas-del-cff-rmf-2026-dof-28-12-2025/
