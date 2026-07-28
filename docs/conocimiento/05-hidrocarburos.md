# Complemento de hidrocarburos, permisos y control volumétrico

> Investigado el 27-jul-2026 para Likida.ai. Fundamentos citados. Lo no verificado va marcado.

---

## Resumen para el fundador

1. **Desde el 24 de abril de 2026 toda factura de gasolina o diésel trae un bloque nuevo de datos.** Se llama *Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos* (el elemento XML se llama `HidroYPetro`). No va al final del CFDI como los complementos que ya conoces: va **dentro de cada concepto**, en `cfdi:ComplementoConcepto`. Si el XML no lo trae, el PAC no lo timbra.
2. **Trae el número de permiso de la gasolinera o del comercializador, y el tipo exacto de combustible.** Cinco campos, todos obligatorios: `Version`, `TipoPermiso`, `NumeroPermiso`, `ClaveHYP`, `SubProductoHYP`. Eso convierte en dato estructurado y parseable algo que antes venía escondido en texto libre.
3. **El permiso ya no es un requisito de reglamento: subió a la ley.** El CFF art. 29-A, fracción V, inciso f) —añadido el 7-nov-2025— obliga a que el CFDI de quien distribuya o enajene hidrocarburos o petrolíferos contenga el número de permiso vigente de la CNE.
4. **Para la flota que compra, la regla que muerde es otra y es vieja: LISR art. 27, fr. III.** El combustible sólo es deducible si (a) se pagó con medio electrónico *aunque sea de $50*, y (b) el CFDI trae el permiso vigente y no suspendido del proveedor al momento de expedirse. Esa segunda condición es responsabilidad del que deduce, no del que vende.
5. **Hay un candado en el PAC que Likida no puede replicar.** El SAT publica diario una lista llamada **L_CNE** (permiso · RFC · clave de producto) y obliga al PAC a rechazar el timbrado si el trío no cuadra. Esa lista es privada: sólo la bajan los PAC autenticados con e.firma.
6. **Pero sí hay un padrón público y programático.** La CNE publica en datos.gob.mx un CSV mensual de permisos vigentes: **17,840 permisos** al corte de febrero de 2026, de los cuales **14,300 son estaciones de servicio**. Se baja con una URL directa, sin llave. Su gran defecto: **no trae RFC**, sólo razón social.
7. **La nomenclatura del permiso te dice qué es el proveedor.** `PL/…/EXP/ES/…` es gasolinera. `H/…/COM/…` es comercializador. `PL/…/DIS/OM/…` es distribuidor por autotanque. Los emitidos después de marzo-2025 llevan prefijo `CNE/`. Eso se valida con regex, gratis, sin pedirle nada a nadie.
8. **El control volumétrico casi nunca toca al comprador — pero cuando toca, es caro.** Una flota que carga en gasolinera no tiene ninguna obligación. Una flota **con tanque propio** que mueve **75,714 litros o más al mes** sí queda obligada a equipos, certificados, dictámenes y reportes mensuales al SAT. Las multas por incumplir arrancan en $39,360 y llegan a $5.6 millones, con clausura.
9. **Si el CFDI de diésel no trae el permiso, el gasto no se deduce, el IVA no se acredita y el estímulo de IEPS se cae.** Eso es dinero real: la cuota de IEPS al diésel que la flota acredita contra ISR desaparece si el comprobante está mal.
10. **Cuidado con una cifra falsa que circula en los blogs.** Varios repiten "multa de $17,000 a $97,000 por cada factura sin complemento". Los importes vigentes 2026 del CFF son otros: $450–$670 por CFDI sin complemento, y $22,300–$127,530 por expedir CFDI sin requisitos. No repitas la cifra de los blogs en material comercial.
11. **Likida no puede prometer "validamos el permiso contra el SAT".** Sí puede prometer: valido que el complemento exista y esté bien formado, valido el permiso contra el padrón público de la CNE, y te aviso cuando algo no cuadra. Es una promesa más chica y verdadera.

---

## 1. Qué complemento aplica en 2026 y a quién obliga

### 1.1 Identidad exacta del complemento

| Dato | Valor |
|---|---|
| Nombre oficial | Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos |
| Elemento XML | `HidroYPetro` |
| Versión | `1.0` (valor prefijado en el XSD) |
| Namespace | `http://www.sat.gob.mx/hidrocarburospetroliferos` |
| Ubicación en el CFDI | `Comprobante/Conceptos/Concepto/ComplementoConcepto` |
| XSD | `https://www.sat.gob.mx/sitio_internet/cfd/hidrocarburospetroliferos.xsd` |
| XSD de catálogos | `http://www.sat.gob.mx/sitio_internet/cfd/catalogos/HidrocarburosPetro/catHidroYPetro.xsd` |

**VERIFICADO.** Descargué los dos XSD directamente de `sat.gob.mx` el 27-jul-2026. La descripción textual dentro del propio XSD dice:

> "Complemento concepto para incorporar al Comprobante Fiscal Digital por Internet (CFDI) la información sobre los permisos otorgados por la autoridad competente referentes a operaciones de hidrocarburos y petrolíferos."

Las cabeceras HTTP de esos archivos:

- `hidrocarburospetroliferos.xsd` → `Last-Modified: Thu, 19 Mar 2026 18:41:32 GMT`
- `catHidroYPetro.xsd` → `Last-Modified: Fri, 17 Apr 2026 00:25:47 GMT`

La segunda fecha corresponde a la llamada "Revisión A", que añadió `PER09`, `PER10` y `PER11` al catálogo de tipos de permiso.

> **Ojo, punto crítico de diseño:** este complemento **no** vive en `cfdi:Complemento` como Carta Porte o Nómina. Vive en `cfdi:ComplementoConcepto`, **uno por cada concepto** que registre combustible. Un CFDI con tres conceptos (diésel, gasolina regular, aceite) lleva dos nodos `HidroYPetro` y ninguno en el concepto de aceite. Cualquier parser que sólo mire `cfdi:Complemento` no lo va a encontrar nunca.

### 1.2 Estructura: cinco atributos, todos requeridos

Del XSD (`hidrocarburospetroliferos.xsd`), textual:

| Atributo | Tipo | Regla |
|---|---|---|
| `Version` | fijo | Siempre `1.0` |
| `TipoPermiso` | `catHidroYPetro:c_TipoPermiso` | Enumeración `PER01`…`PER11` |
| `NumeroPermiso` | `xs:string` | `minLength=15`, `maxLength=35`, `whiteSpace=collapse`. Debe seguir la nomenclatura de la columna "Nomenclatura del número de permiso" del catálogo `c_TipoPermiso` |
| `ClaveHYP` | `catHidroYPetro:c_ClaveHYP` | Sólo `15101505`, `15101514`, `15101515` |
| `SubProductoHYP` | `catHidroYPetro:c_SubProductoHYP` | Sólo `SP16`, `SP17`, `SP18`, `SP19`, `SP22`, `SP23`, `SP24`, `SP25`, `SP48` |

**VERIFICADO** contra el XSD descargado. Las enumeraciones de arriba son literalmente los `xs:enumeration` del archivo `catHidroYPetro.xsd`. No hay más valores permitidos: cualquier otro rompe la validación de esquema antes de siquiera llegar a la validación de negocio.

Ejemplo de cómo se ve dentro del XML:

```xml
<cfdi:Concepto ClaveProdServ="15101505" ClaveUnidad="LTR" Cantidad="450"
               Descripcion="Diesel" ValorUnitario="24.50" Importe="11025.00"
               ObjetoImp="02">
  <cfdi:ComplementoConcepto>
    <hidrocarburospetroliferos:HidroYPetro
        Version="1.0"
        TipoPermiso="PER01"
        NumeroPermiso="PL/00320/EXP/ES/2019"
        ClaveHYP="15101505"
        SubProductoHYP="SP18"/>
  </cfdi:ComplementoConcepto>
</cfdi:Concepto>
```

### 1.3 Fundamento y fechas

**La regla que lo obliga — RMF 2026, regla 2.7.1.48** (DOF 28-dic-2025), titulada *"Comprobantes fiscales por venta o servicios relacionados con hidrocarburos y petrolíferos"*. Texto íntegro:

> "Para los efectos de los artículos 29 y 29-A del CFF, los contribuyentes a que hace referencia la regla 2.6.1.1., fracción II, que enajenen gasolinas y diésel, deben incorporar en el CFDI que se emita, el 'Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos', que al efecto publique el SAT en su Portal.
>
> Para los efectos de la presente regla, por las operaciones a que se refiere el párrafo anterior, los contribuyentes estarán obligados a registrar en el campo 'ClaveProdServ' la o las claves '15101505 Combustible Diesel', '15101514 Gasolina regular menor a 91 octanos' y '15101515 Gasolina premium mayor o igual a 91 octanos', según corresponda."

**VERIFICADO** (leído en el texto DOF de la RMF 2026).

> **Rareza de redacción que conviene conocer:** la regla remite a "la regla 2.6.1.1., fracción II". Pero 2.6.1.1 fracción II **no define contribuyentes, define mercancías**: "Petrolíferos: gasolinas, diésel, turbosina, combustóleo, mezclados o no con otros componentes, así como gas licuado de petróleo y propano". Lo que probablemente se quiso citar es 2.6.1.**2**, que sí lista sujetos. En la práctica el disparador operativo no es esa remisión sino la validación del Anexo 29 (ver §3.3): **clave de producto de combustible + tipo de comprobante I o E ⇒ complemento obligatorio**. Eso es lo que ejecuta el PAC.

**La fecha de arranque — Transitorio Décimo Tercero de la RMF 2026:**

> "Para los efectos de las reglas 2.7.1.34., tercer párrafo, 2.7.1.35., fracciones I y III, referentes al 'Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos', 2.7.1.48, así como lo señalado en la sección III.3 Listado de la Comisión Nacional de Energía (L_CNE) […] serán aplicables una vez que el SAT publique en su Portal el 'Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos' y haya transcurrido el plazo a que se refiere la regla 2.7.1.8., segundo párrafo."

Y la **regla 2.7.1.8, segundo párrafo**:

> "Los complementos que el SAT publique en su Portal, serán de uso obligatorio para los contribuyentes que les aplique, **pasados treinta días naturales**, contados a partir de su publicación en el citado Portal, salvo cuando exista alguna facilidad o disposición que establezca un periodo diferente o los libere de su uso."

**VERIFICADO.** El mecanismo es: publicación en Portal + 30 días naturales = obligatoriedad.

**La fecha concreta: 24 de abril de 2026.** La publicación en el Portal del SAT fue el **25 de marzo de 2026** (25-mar + 30 días naturales = 24-abr). La fecha de publicación en el Portal la reportan de forma consistente múltiples PAC y despachos, y es aritméticamente compatible con el 24-abr que también reportan de forma unánime; además el XSD apareció en el servidor del SAT el 19-mar-2026, coherente con una liberación en esa ventana. **La fecha exacta de publicación (25-mar-2026) queda marcada como SIN VERIFICAR en fuente SAT directa** — ver §9.

### 1.4 A quién obliga (y a quién no)

**Obliga al que vende.** El sujeto obligado es el enajenante de gasolina o diésel: la estación de servicio, el comercializador, el distribuidor. Nunca el comprador. La flota nunca emite este complemento; lo **recibe**.

Ahora bien, la relevancia para el comprador es total, porque el permiso que ese complemento acarrea es exactamente el que la LISR le exige al comprador para poder deducir (§2.2).

**No obliga cuando:**

- El tipo de comprobante es **T (traslado)**. La validación del Anexo 29 se dispara sólo con `TipoDeComprobante` = `I` (ingreso) o `E` (egreso). Un CFDI de traslado de combustible se rige por Carta Porte, no por este complemento. **VERIFICADO** (Anexo 29, VI.1, numeral 9).
- El concepto no usa una de las tres claves de producto de combustible. Un CFDI de una gasolinera por venta de aceite (`15121500`) o por servicios de lavado no lo lleva.
- Se trata del CFDI que emite un **emisor autorizado de monedero electrónico** a la flota, en el esquema normal (ver §7.2).

### 1.5 Qué complemento NO es (los tres que se confunden)

Esto importa porque el equipo va a googlear "complemento hidrocarburos" y va a encontrar cuatro cosas distintas.

| Complemento | Para qué sirve | ¿Aplica a la liquidación de una flota? |
|---|---|---|
| **`HidroYPetro` v1.0** (el nuevo) | Registrar el permiso CNE y el subproducto en cada concepto de venta de gasolina/diésel | **Sí.** Es el que va a venir en cada factura de diésel desde el 24-abr-2026 |
| **Estado de Cuenta de Combustibles para Monederos Electrónicos** (`ecc12`) | El estado de cuenta que el emisor del monedero entrega al cliente | **Sí,** si la flota usa tarjeta/monedero de combustible. Fundamento: RMF 3.3.1.7 y 3.3.1.10 fr. III |
| **Consumo de Combustibles** (`consumodecombustibles`) | CFDI de egresos que el emisor del monedero le expide a la **gasolinera** | No. Es tráfico entre el monedero y la estación. Fundamento: RMF 3.3.1.10 fr. IV |
| **Gastos / Ingresos Hidrocarburos** (`GastosHidrocarburos10`, `IngresosHidrocarburos10`) | Consorcios con contrato de exploración y extracción | No. Es *upstream*, otra industria |

**VERIFICADO parcialmente:** los XSD de `consumodecombustibles` y `GastosHidrocarburos10` siguen respondiendo 200 en el sitio del SAT (probado el 27-jul-2026); `ecc12` respondió 403 al probe directo pero está citado vivo en la RMF 2026, reglas 3.3.1.7 y 3.3.1.10.

---

## 2. El permiso en el CFDI: dónde está escrito y qué exige

### 2.1 En el CFF: nuevo desde 2026

**CFF art. 29-A, fracción V, inciso f)** — *inciso adicionado DOF 07-11-2025*, o sea, es parte del paquete fiscal 2026:

> "Los que expidan los contribuyentes que distribuyan o enajenen hidrocarburos o petrolíferos, deberán contener el número de permiso vigente concedido por la Comisión Nacional de Energía."

**VERIFICADO** en el texto vigente del CFF (última reforma DOF 09-04-2026) publicado por la Cámara de Diputados.

**Esto es el cambio de fondo respecto de años previos.** Antes de 2026, el requisito del permiso en el comprobante vivía en la LISR (para efectos de deducción) y en las guías de llenado del SAT (para efectos de forma). Ahora es un **requisito legal del CFDI**, y eso arrastra la consecuencia dura del penúltimo párrafo del mismo artículo:

> "Las cantidades que estén amparadas en los comprobantes fiscales que no reúnan algún requisito de los establecidos en esta disposición o en el artículo 29 de este Código, según sea el caso, o cuando los datos contenidos en los mismos se plasmen en forma distinta a lo señalado por las disposiciones fiscales, **no podrán deducirse o acreditarse fiscalmente**."

**VERIFICADO.**

Nota sobre nombres de autoridad: el CFF ya dice "Comisión Nacional de Energía". Su artículo transitorio Tercero aclara que *"en las referencias a la Comisión Nacional de Energía previstas en el presente Decreto, se incluye a la Comisión Reguladora de Energía, conforme a lo dispuesto en el Tercero Transitorio de la Ley de la Comisión Nacional de Energía, publicada en el Diario Oficial de la Federación el 18 de marzo de 2025"*. **VERIFICADO.** Traducción práctica: un permiso viejo con nomenclatura `PL/…` (emitido por la CRE) sigue siendo válido; no hay que exigir prefijo `CNE/`.

### 2.2 En la LISR: la regla que le importa al contralor

**LISR art. 27, fracción III, segundo párrafo** — *párrafo reformado DOF 12-11-2021*:

> "Tratándose de la adquisición de combustibles para vehículos marítimos, aéreos y terrestres, el pago deberá efectuarse en la forma señalada en el párrafo anterior, **aun cuando la contraprestación de dichas adquisiciones no excedan de $2,000.00** y en el comprobante fiscal deberá constar la información del **permiso vigente**, expedido en los términos de la Ley de Hidrocarburos al proveedor del combustible y que, en su caso, **dicho permiso no se encuentre suspendido**, al momento de la expedición del comprobante fiscal."

**VERIFICADO** en el texto vigente de la LISR.

Los medios de pago admitidos, del primer párrafo de la misma fracción: transferencia electrónica desde cuenta a nombre del contribuyente, cheque nominativo de su cuenta, tarjeta de crédito / débito / servicios, o monedero electrónico autorizado por el SAT.

**Las tres consecuencias operativas, en orden de importancia para Likida:**

1. **El diésel pagado en efectivo nunca es deducible.** No hay umbral, no hay excepción por monto pequeño. Un operador que pagó $300 de diésel en efectivo generó un gasto no deducible, aunque tenga factura perfecta. Esto ya es así desde 2014 y es probablemente la fuga silenciosa más común en flotas chicas.
2. **La carga de verificar el permiso es del que deduce.** La redacción dice "en el comprobante fiscal deberá constar". Si no consta, el problema es del comprador.
3. **La ley pide dos cosas distintas: que esté vigente y que no esté suspendido**, y las pide **al momento de la expedición del comprobante**. Un permiso puede existir, estar en el padrón, y estar suspendido. Ese matiz es justamente el que el padrón público de la CNE no permite ver bien (§4.4).

> Detalle de técnica legislativa que conviene tener presente: la LISR sigue diciendo *"en los términos de la Ley de Hidrocarburos"*. Esa ley fue **abrogada** el 18-mar-2025. El transitorio Segundo de la Ley del Sector Hidrocarburos resuelve el desfase: *"Se abroga la Ley de Hidrocarburos, publicada en el Diario Oficial de la Federación el 11 de agosto de 2014. Todas las referencias a la Ley de Hidrocarburos que se encuentren en otras leyes se entienden referenciadas a la Ley del Sector Hidrocarburos."* **VERIFICADO.** O sea: la referencia de la LISR se lee hoy como "en los términos de la Ley del Sector Hidrocarburos".

### 2.3 Quién otorga los permisos hoy

**Ley del Sector Hidrocarburos (DOF 18-03-2025), art. 76:**

- **Fracción I — Secretaría de Energía:** tratamiento, refinación, importación, exportación, transporte, almacenamiento y comercialización de Petróleo; importación y exportación de gas natural, petrolíferos y petroquímicos.
- **Fracción II — Comisión Nacional de Energía:** procesamiento, licuefacción, regasificación, compresión, descompresión, transporte, almacenamiento, distribución, comercialización y **expendio al público** de gas natural; **formulación, transporte, almacenamiento, distribución, comercialización, expendio al público y despacho para autoconsumo de Petrolíferos**; transporte, almacenamiento y comercialización de petroquímicos; gestión de sistemas integrados.

**VERIFICADO.** Lo que le compra una flota (diésel en gasolinera, o diésel a granel de un distribuidor) cae siempre en la fracción II: **la autoridad es la CNE**.

El mismo artículo, penúltimo párrafo, mete una obligación nueva y fuerte a los permisionarios:

> "En el Reglamento de esta Ley se debe establecer la forma y mecanismos mediante los cuales las personas Permisionarias deben reportar **semanalmente** transacciones comerciales, inventarios y **datos fiscales y regulatorios de sus proveedores, prestadores de servicios y clientes**."

**VERIFICADO.** Es decir: el proveedor de diésel de tu cliente ya está reportando a SENER/CNE quién le compra. La trazabilidad no es sólo del SAT.

---

## 3. La L_CNE: el candado que corre dentro del PAC

Esta es la parte que más se malinterpreta en el mercado, y la que define qué puede y qué no puede prometer Likida.

### 3.1 Qué es

**Anexo 29 de la RMF 2026** (DOF 09-ene-2026), sección **III.3 "Listado de la Comisión Nacional de Energía (L_CNE)"**. Cita textual del arranque:

> "El artículo 29-A, fracción V, inciso f) del CFF establece que los CFDI deberán contener el número de permiso vigente concedido por la Comisión Nacional de Energía. Por su parte, el 29 Bis del CFF señala que los CFDI deben cumplir con las especificaciones que en materia de informática determine el SAT; en ese sentido, con la finalidad de que los proveedores de certificación autorizados por el SAT realicen la validación consistente en que la información asociada a los números de permisos otorgados por la autoridad competente al contribuyente, así como las claves de productos que se registran en el Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos corresponda con la información que se encuentra en el listado L_CNE asociado al RFC emisor; en este apartado se da a conocer el procedimiento para la consulta y descarga de la L_CNE, a efecto de que se realice la validación mencionada."

**VERIFICADO.**

### 3.2 Cómo funciona (premisas del Anexo 29, apartados A y B)

- Es un archivo **TXT firmado en estándar PKCS#7** por el SAT.
- **Contiene únicamente números de permisos vigentes.**
- **Se actualiza y publica todos los días.**
- **Debe ser consultada todos los días** por los proveedores de certificación. Si no está la del día, se usa la inmediata anterior.
- El SAT publica un **archivo de control** con el número de archivos y el hash de cada uno.
- La lista debe estar operando en el PAC **dentro de las dos horas** posteriores a su publicación.
- Los PAC acceden **autenticándose con su e.firma vigente**, mediante un servicio web que el SAT pone a su disposición, y **desencriptan el archivo con el CSD que el SAT les otorgó**.

**VERIFICADO.** Consecuencia directa: **la L_CNE no es consultable por terceros.** No hay endpoint público, no hay llave que se pueda pedir. Sólo la ven los PAC autorizados. Cualquier proveedor que le diga a una flota "validamos tu factura contra la lista del SAT en tiempo real" o es un PAC, o está mintiendo.

### 3.3 Qué valida exactamente

La L_CNE tiene **tres campos**, formato `NumeroPermiso|RFC|Clave`. Las tres validaciones, textuales del Anexo 29 apartado C:

1. **Número de permiso.** Cadena alfanumérica de entre 15 y 35 posiciones, conforme a la nomenclatura del catálogo `catHidroYPetro:c_TipoPermiso`. *"En caso de que contenga un número de permiso diferente, no se deberá certificar el CFDI."*
2. **RFC.** El RFC asociado al permiso *"debe ser igual al RFC del emisor, en caso de que contenga un RFC diferente, no se deberá certificar el CFDI."*
3. **Clave.** *"se utiliza para validar que la clave registrada en el atributo `Conceptos:Concepto:ClaveProdServ` sea igual a la registrada en la L_CNE, la cual debe estar asociada con el número de permiso otorgado por la autoridad competente y el RFC emisor debe ser igual al registrado en la L_CNE, en caso de que contenga un RFC o una clave diferente, no se deberá certificar el CFDI."*

**VERIFICADO.** Y por separado, la validación estructural, **Anexo 29, sección VI.1, numeral 9 "Atributo ClaveProdServ"**:

> "Cuando se registre cualquiera de las siguientes claves 15101505, 15101514 o 15101515 y el TipoDeComprobante sea 'I' o 'E', debe existir el 'Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos' por cada nodo Concepto registrado."

**VERIFICADO.**

### 3.4 Lo que esto significa para el CFDI que la flota recibe

Un CFDI de diésel **timbrado después del 24-abr-2026** ya pasó por el candado. Eso es información valiosísima y gratuita: si el CFDI existe, tiene timbre, y trae `HidroYPetro`, entonces al momento del timbrado el permiso estaba vigente en la L_CNE y correspondía al RFC del emisor.

**Pero eso no cierra el riesgo.** Sigue habiendo cuatro huecos que Likida sí puede cubrir:

1. **CFDI timbrados antes del 24-abr-2026** que la flota siga deduciendo o que estén en revisión: ahí no hubo candado, y la exigencia de la LISR 27 III sí aplicaba desde 2021.
2. **Permisos suspendidos.** La LISR pide que el permiso *no esté suspendido*. La L_CNE contiene "únicamente números de permisos vigentes" — no sabemos si el SAT trata "suspendido" como "no vigente" a efectos de esa lista. Hueco declarado (§9).
3. **CFDI cancelados después.** El candado corre al timbrar, no después. Una factura de diésel puede timbrarse bien y cancelarse en enero del año siguiente.
4. **Facturas falsas o apócrifas presentadas al contralor como imagen.** El operador manda una foto. Si Likida no exige el XML, cualquier PDF bonito pasa. El candado del PAC no existe en el canal de WhatsApp.

---

## 4. El padrón de permisos de la CNE: qué sí es consultable programáticamente

Aquí está la buena noticia técnica.

### 4.1 Lo que ya no sirve

El minisitio del SAT de controles volumétricos todavía manda al *"Registro Público de permisos"* en `https://www.cre.gob.mx/Permisos/index.html`. **Ese host ya no resuelve** (probado el 27-jul-2026: conexión fallida). Lo mismo `https://www.gob.mx/cne` devuelve 404. Es un link muerto en documentación oficial vigente. No lo uses como fuente.

### 4.2 Lo que sí sirve, y es programático

La CNE publica sus datos abiertos en la Plataforma Nacional de Datos Abiertos, que corre **CKAN** y por lo tanto expone una API JSON estándar.

**Paso 1 — listar los datasets de la CNE:**

```
GET https://www.datos.gob.mx/api/3/action/package_search?fq=organization:cne&rows=100
```

Devuelve 5 datasets: `electricidad`, `petroliferos`, `gas_licuado_de_petroleo`, `gas_natural`, `plan_apertura_datos_cne`.

**Paso 2 — inspeccionar el dataset de petrolíferos:**

```
GET https://www.datos.gob.mx/api/3/action/package_show?id=petroliferos
```

Entre sus recursos aparecen los dos que importan:

- **"Permisos y autorizaciones de petrolíferos vigentes"** → `https://repodatos.atdt.gob.mx/api_update/cne/petroliferos/pl_per_vig_feb26.csv`
- **"Permisos otorgados de petrolíferos"** → `https://repodatos.atdt.gob.mx/api_update/cne/petroliferos/pl_per_otr_feb26.csv`

El sufijo del archivo codifica el corte mensual (`feb26`, `012026`, …), así que no hay una URL "latest" estable: **hay que releer el `package_show` para descubrir el corte más reciente.** Ese es el patrón correcto de implementación.

**VERIFICADO.** Bajé y parseé ambos archivos el 27-jul-2026, sin autenticación, sin llave, sin rate limit aparente.

### 4.3 Cómo viene el padrón por dentro

Archivo `pl_per_vig_feb26.csv`, 2.37 MB, **17,840 registros**. Encabezados exactos:

```
razon_social,num_per,tipo_permiso,fecha_otorgamiento,estatus,entidad,zona_geo
```

Fila real de ejemplo:

```
Servicios del Valle del Fuerte, S.A. de C.V.,PL/360/EXP/ES/2015,Expendio en estación de servicio,2015-08-13,Vigente,Sinaloa,sin dato
```

**Distribución por estatus** (los 17,840 registros):

| estatus | registros |
|---|---|
| Vigente | 17,385 |
| Por iniciar operaciones | 420 |
| Por iniciar construcción | 27 |
| En construcción | 8 |

**Distribución por tipo de permiso** (los 10 principales):

| tipo_permiso | registros |
|---|---|
| Expendio en estación de servicio | 14,300 |
| Transporte por otros medios distintos a ducto (Autotanque-Semirremolque) | 2,075 |
| Comercialización de petrolíferos | 515 |
| Expendio en Autoconsumo | 346 |
| Distribución por medios distintos a ducto | 260 |
| Almacenamiento | 125 |
| Expendio en aeródromos | 74 |
| Almacenamiento en aeródromos | 66 |
| Transporte por otros medios distintos a ducto (Buque-tanque) | 46 |
| Transporte por medio de ducto de petrolíferos | 10 |

**VERIFICADO** (conteos calculados por mí sobre el CSV descargado).

Dos lecturas de negocio que salen gratis de esta tabla:

- **Hay ~14,300 gasolineras con permiso vigente en México.** Es el universo de proveedores contra el que Likida va a cotejar el 95% de los tickets de diésel.
- **Sólo 346 permisos de "Expendio en Autoconsumo"** (+17 con nomenclatura nueva `CNE/PL/…/DES/AUT/…`). Es decir: son poquísimas las flotas con tanque propio *permisionado* en todo el país. La mayoría de las flotas con tanque propio o están por debajo del umbral, o están operando sin permiso.

El archivo `pl_per_otr_feb26.csv` ("otorgados") es distinto: son sólo los permisos **nuevos del mes** (47 registros al corte de febrero). Sirve para hacer *delta*, no para tener el padrón.

### 4.4 Los cuatro defectos del padrón público (léelos antes de diseñar nada)

1. **No trae RFC.** Sólo `razon_social`, y sin normalizar (`"Multiservicios la Pilarica Sa de Cv"`, `"Gasolinas Diversas, S.A. de C.V."`). Cotejar "el RFC emisor del CFDI corresponde al titular del permiso" —que es exactamente lo que valida la L_CNE— **es imposible con este archivo**. Hay que hacer *fuzzy match* por razón social, con todo lo que eso implica en falsos positivos.
2. **Es mensual, no diario.** La L_CNE se publica todos los días; este padrón trae corte mensual y se publicó con ~6 semanas de rezago (el corte de febrero-2026 apareció el 17-abr-2026). Un permiso revocado el día 3 puede seguir apareciendo "Vigente" durante dos meses.
3. **Se llama "vigentes" pero incluye no operativos.** 455 de los 17,840 registros no están en estatus "Vigente" sino en "Por iniciar operaciones", "En construcción" o "Por iniciar construcción". Filtrar por el nombre del archivo es un error; hay que filtrar por la columna `estatus`.
4. **No expone "suspendido".** Ningún registro trae ese estatus. Los suspendidos simplemente desaparecen del archivo — o no, no lo sé. Y la LISR exige justamente saber si estaba suspendido. Hueco declarado (§9).

### 4.5 Regalo: la nomenclatura del permiso es un clasificador gratis

Verifiqué cruzando `num_per` contra `tipo_permiso` en los 17,840 registros del padrón. El mapeo es **exacto y sin ambigüedad**:

| Patrón del número de permiso | Actividad | Registros |
|---|---|---|
| `PL/{n}/EXP/ES/{año}` | Expendio en estación de servicio | 13,910 |
| `CNE/PL/{n}/EXP/ES/{año}` | Expendio en estación de servicio (nomenclatura post-CNE) | 377 |
| `PL/{n}/TRA/OM/{año}` | Transporte por autotanque / carro-tanque | 2,034 |
| `H/{n}/COM/{año}` | Comercialización de petrolíferos | 529 |
| `PL/{n}/EXP/ESA/{año}` | Expendio en Autoconsumo | 329 |
| `PL/{n}/DIS/OM/{año}` | Distribución por medios distintos a ducto | 251 |
| `PL/{n}/ALM/{año}` | Almacenamiento | 121 |
| `PL/{n}/EXP/AE/{año}` | Expendio en aeródromos | 73 |
| `PL/{n}/ALM/AE/{año}` | Almacenamiento en aeródromos | 66 |
| `CNE/PL/{n}/TRA/OM/{año}` | Transporte por autotanque | 47 |
| `PL/{n}/TRA/TM/{año}` | Transporte por buque-tanque | 37 |
| `CNE/PL/{n}/DES/AUT/{año}` | Expendio en Autoconsumo (post-CNE) | 17 |
| `CNE/PL/{n}/DIS/OM/{año}` | Distribución por medios distintos a ducto | 9 |
| `PL/{n}/TRA/DUC/{año}` | Transporte por ducto | 9 |
| `CNE/PL/{n}/TRA/TM/{año}` | Transporte por buque-tanque | 9 |
| `PL/{n}/EXP/ES/MM/{año}` | Estación de servicio multimodal | 5 |
| `CNE/PL/{n}/ALM/{año}` | Almacenamiento | 4 |
| `CNE/PL/{n}/COM/{año}` | Comercialización de petrolíferos | 3 |

**VERIFICADO** (agregación propia sobre el CSV de la CNE). En todos los patrones con más de 3 registros, la actividad es única salvo dos casos triviales (autotanque vs. carro-tanque, y variantes de "comercialización").

Esto te da una validación de forma que **no requiere red**: una regex sobre `NumeroPermiso` te dice si el proveedor es gasolinera, comercializador o distribuidor, y si el número está bien construido. Es la primera línea de defensa y cuesta cero.

### 4.6 El catálogo `c_TipoPermiso` del SAT

Las once claves y sus nomenclaturas. **Las claves están VERIFICADAS** contra el XSD del SAT (`catHidroYPetro.xsd`). **Las descripciones y nomenclaturas provienen de documentación de PAC y proveedores de software** (fuente secundaria) — pero las contrasté una por una contra el padrón real de la CNE de §4.5, y coinciden:

| Clave | Actividad | Nomenclatura | ¿Coincide con el padrón CNE? |
|---|---|---|---|
| `PER01` | Expendio en estación de servicio de petrolíferos | `PL/(n)/EXP/ES/(año)` | Sí — 13,910 registros |
| `PER02` | Comercialización | `H/(n)/COM/(año)` | Sí — 529 registros |
| `PER03` | Distribución por otros medios distintos a ducto | `PL/(n)/DIS/OM/(año)` | Sí — 251 registros |
| `PER04` | Expendio en estación de servicio multimodal | `PL/(n)/EXP/ES/MM/(año)` | Sí — 5 registros |
| `PER05` | Expendio en estación de servicio de petrolíferos | `CNE/PL/(n)/EXP/ES/(año)` | Sí — 377 registros |
| `PER06` | Comercialización | `CNE/H/(n)/COM/(año)` | No aparece aún en el padrón |
| `PER07` | Distribución por otros medios distintos a ducto | `CNE/PL/(n)/DIS/OM/(año)` | Sí — 9 registros |
| `PER08` | Expendio en estación de servicio multimodal | `CNE/PL/(n)/EXP/ES/MM/(año)` | No aparece aún en el padrón |
| `PER09` | Comercialización | `CNE/PL/(n)/COM/(año)` | Sí — 3 registros |
| `PER10` | Comercialización | `#[a-zA-Z0-9]{14}` | No verificable por patrón |
| `PER11` | Comercialización | `F00.07.UH/(n)/(año)` | No aparece en el padrón (formato SENER histórico) |

`PER09`, `PER10` y `PER11` son los **tres valores añadidos por la "Revisión A"**, con fecha de vigencia 24-04-2026 — consistente con que el XSD de catálogos que descargué tiene `Last-Modified: 17-abr-2026` y ya los incluye.

**Lectura clave para Likida:** en el catálogo **no existe** ningún tipo de permiso de *transporte*, *almacenamiento*, *autoconsumo* ni *aeródromos*. Los once valores cubren únicamente expendio, comercialización y distribución. O sea: **el `TipoPermiso` del complemento te dice, de forma cerrada, en cuál de tres categorías cae quien te vendió el combustible.** Si viene algo distinto, el CFDI está mal.

### 4.7 Los catálogos de producto

`c_ClaveHYP` — tres valores, **VERIFICADOS** en el XSD, y con las descripciones textuales de la propia regla 2.7.1.48 de la RMF (fuente primaria):

| Clave | Descripción (texto de la regla 2.7.1.48) |
|---|---|
| `15101505` | Combustible Diesel |
| `15101514` | Gasolina regular menor a 91 octanos |
| `15101515` | Gasolina premium mayor o igual a 91 octanos |

`c_SubProductoHYP` — nueve valores. **Las claves están VERIFICADAS** en el XSD; **las descripciones son de fuente secundaria**:

| Clave | Descripción | ClaveHYP asociada |
|---|---|---|
| `SP16` | Gasolina regular menor a 91 octanos | `15101514` |
| `SP17` | Gasolina premium mayor o igual a 91 octanos | `15101515` |
| `SP18` | Diésel automotriz | `15101505` |
| `SP19` | Diésel marino | `15101505` |
| `SP22` | IFO380 | `15101505` |
| `SP23` | Diésel industrial | `15101505` |
| `SP24` | Diésel de Ultra Bajo Azufre (DUBA) | `15101505` |
| `SP25` | Diésel agrícola | `15101505` |
| `SP48` | Gasóleo doméstico | `15101505` |

**Para autotransporte de carga federal, el valor esperado es `SP18` (diésel automotriz), y ocasionalmente `SP24` (DUBA).** Si en la liquidación de un tractocamión aparece `SP25` (agrícola) o `SP23` (industrial), es una anomalía de negocio digna de alerta: son subproductos con precio y tratamiento distintos, y el estímulo de IEPS del art. 16-A-IV de la LIF está pensado para uso automotriz.

---

## 5. Control volumétrico: qué es y a quién toca de verdad

### 5.1 La obligación de fondo

**CFF art. 28, fracción I, apartado B** (*apartado reformado DOF 12-11-2021*), textual:

> "Tratándose de personas que fabriquen, produzcan, procesen, transporten, almacenen, incluyendo almacenamiento para usos propios, distribuyan o enajenen cualquier tipo de hidrocarburo o petrolífero, además de lo señalado en el apartado anterior, deberán contar con los equipos y programas informáticos para llevar controles volumétricos y los certificados que acrediten su correcta operación y funcionamiento, así como con dictámenes emitidos por un laboratorio de prueba o ensayo, que determinen el tipo de hidrocarburo o petrolífero de que se trate, el poder calorífico del gas natural y el octanaje en el caso de gasolina. Se entiende por controles volumétricos de los productos a que se refiere este párrafo, los registros de volumen, objeto de sus operaciones, incluyendo sus existencias, mismos que **formarán parte de la contabilidad del contribuyente**."

Y los reportes:

> "Los contribuyentes a que se refiere este apartado deberán generar de forma **diaria y mensual** los reportes de información de controles volumétricos que deberán contener: los registros de volumen provenientes de las operaciones de recepción, entrega y de control de existencias […]; **los datos de los comprobantes fiscales o pedimentos asociados a la adquisición y enajenación** de los hidrocarburos o petrolíferos […]"

**VERIFICADO.**

En castellano: es un sistema que mide con instrumentos cada litro que entra y sale de cada tanque, lo amarra al CFDI que lo respalda, y genera reportes que se mandan al SAT. Es la contabilidad de litros, no de pesos, y el SAT la cruza contra la contabilidad de pesos.

### 5.2 Quiénes son los obligados (RMF 2026, regla 2.6.1.2)

Ocho fracciones. Las traduzco:

| Fr. | Sujeto |
|---|---|
| I | Extracción de hidrocarburos con asignación o contrato de E&E |
| II | Tratan o refinan petróleo, procesan gas natural, formulan petrolíferos |
| III | Compresión, descompresión, licuefacción o regasificación de gas natural |
| IV | **Transportan** hidrocarburos o petrolíferos, **incluyendo el transporte para usos propios** |
| V | **Almacenan** hidrocarburos o petrolíferos |
| VI | **Almacenan o utilizan para usos propios o autoconsumo** (ver detalle abajo) |
| VII | **Distribuyen** gas natural o petrolíferos |
| VIII | **Enajenan** hidrocarburos o petrolíferos |

**VERIFICADO.**

La **fracción VI** es la que puede tocar a un cliente de Likida. Texto literal:

> "VI. Personas físicas o morales que almacenen o utilicen para usos propios o autoconsumo, petrolíferos o gas natural derivado de su actividad, bajo los siguientes supuestos:
> a) Al amparo de un permiso de la CNE para el despacho para autoconsumo o para el almacenamiento para usos propios […];
> b) **Que no cuenten con un permiso de la SENER o de la CNE y que manejen un volumen mayor o igual a 75,714 litros mensuales al año de petrolíferos**; o
> c) Que cuenten con instalaciones fijas para la recepción de gas natural para autoconsumo y no cuenten con un permiso para ello, siempre que su consumo anual sea superior a 5,000 Gigajoules (GJ).
> Lo señalado en esta fracción no incluye a usuarios residenciales de gas natural y gas licuado de petróleo."

**VERIFICADO.**

### 5.3 Entonces: ¿el comprador de combustible tiene obligación?

**Tres escenarios, tres respuestas distintas. Esta es la sección que hay que tener clara antes de hablar con un contralor.**

**Escenario A — La flota carga en gasolineras ajenas. Ninguna obligación de control volumétrico.**
Comprar combustible no es ninguno de los verbos del art. 28-I-B (fabricar, producir, procesar, transportar, almacenar, distribuir, enajenar). El diésel en el tanque del tractocamión es consumo, no almacenamiento para efectos de esta regla. Este es el caso de la gran mayoría de las flotas medianas.

**Escenario B — La flota tiene tanque propio y mueve menos de 75,714 litros al mes.** Sin permiso de la CNE, no cae en 2.6.1.2 fr. VI b). Sin obligación de control volumétrico fiscal. (Sigue habiendo regulación ambiental y de protección civil, fuera del alcance de este documento.)

**Escenario C — La flota tiene tanque propio y mueve 75,714 litros o más al mes, o tiene permiso de autoconsumo. Obligación completa.** Y "completa" significa, según la regla 2.6.1.4:

1. Instalar equipos y programas que cumplan el **Anexo 21**.
2. Obtener **certificados** de correcta operación conforme a los Anexos 21 y 22.
3. Obtener **dictámenes de laboratorio** del tipo de producto, conforme al Anexo 23.
4. Dar **aviso al SAT** (ficha de trámite 107/CFF).
5. Asegurar operación correcta en todo momento; atender cualquier falla **en menos de 72 horas** y registrarla en la bitácora de eventos.
6. **Enviar reportes mensuales al SAT**, a más tardar en los primeros **tres días naturales del segundo mes posterior** al mes reportado (regla 2.8.1.6, fr. III).
7. **Generar reportes diarios** y conservarlos como parte de la contabilidad.

**VERIFICADO** (reglas 2.6.1.3, 2.6.1.4 y 2.8.1.6 fr. III de la RMF 2026).

> **Aritmética del umbral, para calibrar el riesgo comercial:** 75,714 litros al mes son ~2,524 litros diarios. Un tractocamión de carga federal en operación intensa consume del orden de 300–500 L/día. **Entre 5 y 8 unidades cargando de tanque propio bastan para cruzar el umbral.** Eso significa que el escenario C no es exótico: es perfectamente alcanzable por una flota mediana que instaló un tanque para ahorrarse el margen de la gasolinera. Y hay sólo ~363 permisos de autoconsumo en todo el país (§4.3), lo que sugiere que **muchísimas flotas están en el escenario C sin saberlo.**

> **Nota de vigencia importante:** en la RMF 2026 los anexos de control volumétrico son el **21** (especificaciones técnicas), **22** (certificados) y **23** (dictámenes). En años anteriores eran los Anexos **30, 31 y 32**. Todo el material de referencia previo a 2026 usa la numeración vieja. En la RMF 2026 el Anexo 30 es "domicilios de las Unidades Administrativas del SAT". **VERIFICADO** contra el listado de anexos de la RMF 2026 y contra el Anexo 21 publicado en el DOF el 13-ene-2026.

### 5.4 Qué pasa si el obligado no cumple

**Multas — CFF art. 81 fr. XXV en relación con art. 82 fr. XXV** (importes actualizados DOF 28-12-2025):

| Supuesto | Multa |
|---|---|
| Incumplir el art. 28 fr. I (general) | $39,360 a $69,160 |
| No contar con dictamen o certificado | $1,124,500 a $1,686,750 |
| Registrar tipo de producto u octanaje distinto al real | $2,249,000 a $3,373,500 **+ clausura de 1 a 3 meses** |
| No contar con equipos/programas, o no mantenerlos operando, o alterarlos / no contar con controles volumétricos o alterarlos | $3,373,500 a $5,622,500 **+ clausura de 3 a 6 meses** |
| No enviar los reportes de información | $39,360 a $69,160 **por cada reporte no enviado** |

**VERIFICADO.**

**Delitos — CFF art. 111 Bis: prisión de 3 a 8 años** por no contar con los controles volumétricos, no contar con los equipos, no contar con los certificados, proporcionar registros falsos, o comercializar sistemas para alterarlos. Y **prisión de 6 a 12 años** a quien enajene hidrocarburos o petrolíferos de procedencia ilícita — que se presume cuando hay diferencias mayores al 1.5% (líquidos) entre los controles volumétricos y lo facturado.

Además, la fracción VI del 111 Bis merece lectura aparte porque **golpea al comprador**:

> "VI. Haya dado cualquier efecto fiscal a los comprobantes fiscales expedidos por un contribuyente incluido en el listado a que se refiere el artículo 69-B, cuarto párrafo de este Código, que amparen la adquisición de cualquier tipo de hidrocarburo o petrolífero, sin que haya demostrado la materialización de dichas operaciones o corregido su situación fiscal dentro del plazo legal establecido en el octavo párrafo del citado artículo."

**VERIFICADO.** Traducción: **deducir diésel comprado a un EFOS definitivo es delito con pena de 3 a 8 años**, no una simple no-deducción. Es la única fracción del 111 Bis que alcanza a una flota que sólo compra.

**Determinación presuntiva — CFF art. 55 fr. VII:** el SAT puede determinar presuntivamente ingresos cuando detecta diferencias mayores al 0.5% (líquidos) entre controles volumétricos y comprobantes fiscales de compra o venta. **VERIFICADO.**

### 5.5 Lo único que el control volumétrico le exige al comprador, indirectamente

La regla 2.6.1.4, fracción IX y último párrafo, obliga al permisionario a **compartir con sus clientes** la información del dictamen (tipo de producto, octanaje, poder calorífico). Y la fracción VIII obliga a transportistas, almacenistas, distribuidores y compresores a dar a los comercializadores que son sus clientes los registros de volumen del Anexo 21. **VERIFICADO.**

O sea: si tu cliente es un comercializador, **tiene derecho** a recibir información volumétrica de su proveedor. Si es una flota que sólo consume, no.

---

## 6. Qué pasa fiscalmente cuando el CFDI de diésel NO trae el permiso

Cinco consecuencias, de la más probable a la más grave.

### 6.1 Lo más probable: el CFDI simplemente no existe

Desde el 24-abr-2026, si el emisor intenta timbrar un CFDI tipo I o E con `ClaveProdServ` = `15101505` / `15101514` / `15101515` **sin** el nodo `HidroYPetro`, el PAC **no debe certificarlo** (Anexo 29, VI.1 numeral 9). Y si lo trae pero el trío permiso·RFC·clave no está en la L_CNE, tampoco (Anexo 29, III.3 apartado C). **VERIFICADO.**

El resultado práctico es que el operador se queda parado en la gasolinera sin factura. **Ese es el escenario operativo que Likida va a ver en campo**, mucho más que el de una factura mal hecha.

### 6.2 Si sí se timbró pero le falta el permiso: no se deduce ni se acredita

Dos fundamentos independientes que llegan al mismo lugar:

- **CFF art. 29-A, penúltimo párrafo:** un CFDI que no reúna algún requisito del propio 29-A (y el permiso es ahora el requisito de la fr. V inciso f) *"no podrá deducirse o acreditarse fiscalmente"*.
- **LISR art. 27 fr. III, segundo párrafo:** el requisito de deducibilidad del combustible incluye que en el comprobante *conste* el permiso vigente y no suspendido.

**VERIFICADO.** Efecto en pesos, sobre una factura de $10,000 de diésel: se pierde la deducción del gasto en ISR **y** el acreditamiento del IVA trasladado.

### 6.3 Se cae también el estímulo de IEPS al diésel

**LIF 2026 (DOF 07-11-2025), art. 16, apartado A, fracción IV:** estímulo para quienes adquieran diésel o biodiésel para consumo final en vehículos destinados exclusivamente al **transporte público y privado de personas o de carga**, consistente en acreditar el IEPS causado, contra el **ISR causado del mismo ejercicio**.

Requisito de forma de pago, textual:

> "Para que proceda el acreditamiento a que se refiere esta fracción, el pago por la importación o adquisición de diésel o de biodiésel y sus mezclas a distribuidores o estaciones de servicio, deberá efectuarse con: monedero electrónico autorizado por el Servicio de Administración Tributaria; tarjeta de crédito, débito o de servicios, expedida a favor de la persona contribuyente que pretenda hacer el acreditamiento; con cheque nominativo expedido por la persona importadora o adquirente para abono en cuenta del enajenante, o bien, transferencia electrónica de fondos […]"

Y la caducidad, también textual:

> "El acreditamiento […] únicamente podrá efectuarse contra el impuesto sobre la renta causado en el ejercicio que tenga la persona contribuyente, correspondiente al mismo ejercicio en que se importe o adquiera el diésel […]; **en caso de no hacerlo, perderá el derecho a realizarlo con posterioridad**."

**VERIFICADO.** Dos consecuencias directas para Likida:

- **El estímulo es de uso o pérdida, por ejercicio.** No es un saldo a favor que se arrastra. Una liquidación mal cuadrada en 2026 es dinero que ya no se recupera en 2027.
- **El pago en efectivo lo mata,** igual que a la deducción. Un solo requisito de forma de pago tira dos beneficios distintos.
- La fracción también excluye a contribuyentes que presten preponderantemente sus servicios a una parte relacionada — relevante para flotas cautivas de un grupo.

### 6.4 Multas al emisor (y la cifra falsa que hay que dejar de repetir)

El sujeto multado es **el que expide**, no la flota. Fundamento: **CFF art. 83 fr. VII** (expedir CFDI sin los requisitos del Código, su Reglamento o las reglas generales), sancionada por el **art. 84 fr. IV**:

| Inciso | Importe (vigente 2026, actualizado DOF 28-12-2025) |
|---|---|
| a) Caso general | **$22,300 a $127,530**. En reincidencia, clausura preventiva de 3 a 15 días |
| b) Personas físicas del Título IV Cap. II Secciones II y IV | $1,910 a $3,800 |
| c) Donatarias autorizadas | $19,050 a $108,870 |
| d) **Por cada comprobante que se emita sin los complementos** que determine el SAT mediante reglas generales | **$450 a $670** |

**VERIFICADO** en el texto vigente del CFF.

> **⚠️ Corrección a la desinformación que circula.** Al menos cuatro blogs de proveedores de facturación afirman que la multa es de **"$17,000 a $97,000 pesos por cada factura emitida sin el complemento"**. Esa cifra **no corresponde a ningún importe vigente en 2026**: parece un importe histórico del art. 84 fr. IV inciso a) sin actualizar, y además está mal atribuida (el inciso a) sanciona el caso general, no el de complementos, para el que existe el inciso d) con $450–$670). **No uses esa cifra en material comercial de Likida.** Si un competidor la usa, es un punto de diferenciación.

### 6.5 Lo más grave: el CFDI puede ser "falso" por ley

**CFF art. 29-A, fracción IX** — *fracción adicionada DOF 07-11-2025*, o sea, nueva para 2026:

> "IX. Amparar operaciones existentes, verdaderas o actos jurídicos reales.
>
> Los comprobantes fiscales que no cumplan con el requisito establecido en esta fracción, **se consideran falsos para efectos de este Código**."

**VERIFICADO.** Es un cambio conceptual importante: la falsedad ya no requiere pasar por todo el procedimiento del 69-B; el CFF la declara directamente cuando el comprobante no ampara una operación real.

Encadenado con el **CFF art. 111 Bis fr. VI** (§5.4), el riesgo de comprar diésel a un proveedor problemático dejó de ser "me lo rechazan en una auditoría" y pasó a ser penal.

---

## 7. Los cuatro casos de borde que Likida va a ver en producción

### 7.1 CFDI global de la gasolinera (el ticket sin RFC)

Cuando el operador no pide factura, la gasolinera emite un **CFDI global** al público en general. La RMF 2026 les da una facilidad, **Transitorio Décimo Primero**: los contribuyentes de 2.6.1.2 fr. VII y VIII pueden seguir emitiendo CFDI global diario, semanal o mensual **hasta el 31 de diciembre de 2026**, siempre que cumplan tres condiciones, entre ellas emitirlo conforme al *"Apéndice 3 'Instrucciones específicas de llenado en el CFDI global aplicable a Hidrocarburos y Petrolíferos'"* de la guía de llenado del CFDI global 4.0, **incluso por operaciones menores a $100 en que el cliente no pidió comprobante**. **VERIFICADO.**

En ese CFDI global, el permiso **no va en el complemento**: va en el campo `NoIdentificacion` del concepto, con este formato (textual del Apéndice 3):

> "En este campo se debe registrar el número de permiso otorgado por la Comisión Reguladora de Energía, seguido de un guion medio para registrar un número único y consecutivo por manguera, mismo que puede tener un máximo de 40 caracteres."
>
> Ejemplo: `NoIdentificacion = PL/00320/EXP/ES/2019-1`

**VERIFICADO.** Es decir: **el mismo dato vive en dos lugares distintos según el tipo de CFDI.** Un extractor que sólo busque `HidroYPetro` va a fallar con globales; uno que sólo busque `NoIdentificacion` va a fallar con nominativos.

El Apéndice 3 también establece que en el global la `Cantidad` va **en litros** (`ClaveUnidad = LTR`) para diésel, gasolina y gas LP, con conversión obligatoria si la medición fue en otra unidad. **VERIFICADO.**

### 7.2 Monederos electrónicos de combustible (tarjetas de flotilla)

Este es el caso más importante en la práctica, porque muchas flotas medianas ya operan con tarjeta.

**RMF 2026 regla 3.3.1.7**, textual:

> "[…] las personas físicas y morales que adquieran combustibles […] a través de los monederos electrónicos que al efecto autorice el SAT, podrán comprobar la erogación de las comisiones y otros cargos que cobre el emisor del monedero electrónico por sus servicios, así como el pago por la adquisición de combustibles, con el CFDI y el 'Complemento de Estado de Cuenta de Combustibles para Monederos Electrónicos Autorizados por el SAT', respectivamente, que expidan los emisores autorizados […], **por lo que las estaciones de servicio no deberán emitir el CFDI a los clientes adquirentes de combustibles**, por las operaciones que se realicen a través de monederos electrónicos autorizados por el SAT."

Y el momento de la deducción:

> "La deducción por la adquisición de combustibles, así como el acreditamiento de los impuestos trasladados **podrá realizarse hasta que el contribuyente adquirente del combustible, cuente con el CFDI y el complemento a que se refiere el párrafo anterior y hasta por el monto que ampare el citado complemento**."

**VERIFICADO.** Tres implicaciones para el diseño del producto:

1. **En este esquema el operador NO debe traer factura de la gasolinera.** Si la trae, hay duplicidad. Likida tiene que saber, por cliente y por unidad, si la carga fue con monedero o con pago directo, porque el documento válido es distinto.
2. **La deducción no ocurre en la fecha de la carga sino cuando llega el estado de cuenta.** Eso desfasa el corte de liquidación respecto del corte fiscal. Un tablero que cuadre "gasto del viaje" contra "deducción del mes" va a mostrar diferencias legítimas.
3. **El monto deducible está topado por lo que ampare el complemento ECC**, no por lo que diga el ticket.

**¿Ese CFDI del monedero lleva también `HidroYPetro`?** Lo verificado es que la validación del Anexo 29 se dispara por `ClaveProdServ` de combustible en el **nodo Concepto**, y en el esquema normal el CFDI del emisor de monedero registra en concepto **la comisión**, informando el consumo dentro del complemento ECC. Bajo esa lectura, un CFDI con ECC **no** queda obligado a traer `HidroYPetro`. Esta interpretación la sostienen despachos y PAC citando preguntas frecuentes del SAT, pero **no la pude confirmar en documento del SAT** — ver §9.

Nota adicional: la regla **3.3.1.10 fr. III** exige que el CFDI del emisor de monedero incluya, además del ECC, *"el complemento de identificación de recurso y minuta de gastos por cuenta de terceros"*. El **Transitorio Décimo Segundo** de la RMF 2026 aclara que esa obligación **sólo aplicará cuando el SAT publique dicho complemento** y transcurra el plazo de la 2.7.1.8. Al 27-jul-2026 no encontré evidencia de que se haya publicado. **VERIFICADO** el transitorio; **SIN VERIFICAR** el estado actual de publicación.

### 7.3 Carta Porte cuando lo que se mueve es el combustible

Sólo aplica si el cliente de Likida **transporta** diésel, no si lo consume. Pero conviene tenerlo mapeado:

- **Regla 2.7.7.1.1, tercer párrafo:** *"en ningún caso se puede amparar el transporte o distribución de los hidrocarburos y petrolíferos señalados en la regla 2.6.1.1., sin que se acompañe la representación impresa, en papel o en formato digital de los CFDI de tipo ingreso a los que se incorporen el 'Complemento Carta Porte'."* Misma prohibición para CFDI de traslado en la regla 2.7.7.1.2. **VERIFICADO.**
- **Regla 2.7.7.2.4:** el traslado **local** de hidrocarburos o petrolíferos por medios propios distintos a ducto —aunque no toque tramo federal— **sí requiere CFDI de traslado con Carta Porte**. Esto rompe la facilidad general de traslado local de la 2.7.7.2.1. **VERIFICADO.** Es una excepción que se pasa por alto seguido.
- **Regla 2.7.7.1.6:** un CFDI de traslado con Carta Porte que mueva diésel o gasolina **sólo puede cancelarse antes de que inicie el traslado**. Después queda como no cancelable, y una vez iniciado el traslado ya no puede emitirse. **VERIFICADO.**

### 7.4 Cancelación: el diésel no se cancela solo

**Regla 2.7.1.34, tercer párrafo:** la regla general es que si el receptor no contesta en 3 días, el SAT da la cancelación por aceptada. **Eso no aplica** a CFDI de ingreso y egreso con `HidroYPetro`, ni a CFDI de ingreso con Carta Porte que muevan las claves de combustible. En esos casos *"debiendo el receptor del comprobante manifestar a través del Portal del SAT la aceptación de la cancelación"*. **VERIFICADO.**

**Regla 2.7.1.35, último párrafo:** la facilidad de cancelar sin aceptación **no aplica** a CFDI de ingreso por operaciones relacionadas con hidrocarburos o petrolíferos. **VERIFICADO.**

**Esto es una oportunidad de producto, no sólo un requisito.** Significa que **nadie puede cancelar unilateralmente la factura de diésel de tu cliente**: se necesita su aceptación expresa en el Portal del SAT, y el silencio ya no equivale a "sí". Una flota que no vigila su buzón puede: (a) perder deducciones porque aceptó por descuido, o (b) quedarse con facturas que el proveedor quiere cancelar y no puede. Likida puede vender exactamente eso: vigilancia de solicitudes de cancelación sobre CFDI de combustible.

**Regla 2.6.2.1:** cuando la autoridad detecte que un obligado a controles volumétricos no cumplió, aplica lo previsto en 2.7.1.21 último párrafo — es decir, hay consecuencias sobre su capacidad de emitir CFDI globales. **VERIFICADO** (leí el encabezado y los fundamentos de la regla; no profundicé en el desarrollo).

---

## 8. Qué cambia esto en Likida

### 8.1 Lo que hay que construir

**A. Extractor de `HidroYPetro`, obligatorio, no opcional.**
Parsear `cfdi:Comprobante/cfdi:Conceptos/cfdi:Concepto/cfdi:ComplementoConcepto/hidrocarburospetroliferos:HidroYPetro`. **Un nodo por concepto**, no uno por comprobante. Guardar los cinco atributos como columnas de primera clase, no como blob. El namespace es `http://www.sat.gob.mx/hidrocarburospetroliferos`.

**B. Validador offline de tres niveles, en este orden de costo:**

1. **Estructural (gratis, sin red).** ¿`ClaveProdServ` ∈ {15101505, 15101514, 15101515} y `TipoDeComprobante` ∈ {I, E}? Entonces debe existir `HidroYPetro`. ¿`Version` = 1.0? ¿`TipoPermiso` ∈ PER01…PER11? ¿`ClaveHYP` coherente con `ClaveProdServ`? ¿`SubProductoHYP` coherente con `ClaveHYP` (tabla §4.7)? ¿`NumeroPermiso` entre 15 y 35 caracteres?
2. **De forma del permiso (gratis, regex).** ¿El patrón de `NumeroPermiso` corresponde al `TipoPermiso` declarado, según la tabla de §4.6? Un `PER01` cuyo número no empiece con `PL/` y termine en `/EXP/ES/{año}` es un error detectable sin consultar nada.
3. **Contra el padrón CNE (con red, cacheable).** ¿El `NumeroPermiso` existe en el CSV mensual de permisos vigentes, con `estatus = "Vigente"`? Y como señal secundaria, ¿la `razon_social` del padrón se parece al `Nombre` del emisor del CFDI?

**C. Ingesta programada del padrón CNE.**
Job mensual: `package_show?id=petroliferos` → localizar el recurso *"Permisos y autorizaciones de petrolíferos vigentes"* del corte más reciente → descargar el CSV → cargar a tabla indexada por `num_per`. **No hardcodear la URL con el sufijo del mes**: cambia cada corte. Guardar la fecha de corte y exponerla en la UI (§8.3).

**D. Regla de forma de pago, que probablemente sea la que más dinero salva.**
Marcar como **no deducible** cualquier carga de combustible pagada en efectivo, sin importar el monto. Fundamento a mostrarle al contralor: LISR art. 27 fr. III segundo párrafo. Esta regla no depende del complemento, aplica desde antes, y es la fuga más común en flotas que reembolsan viáticos en efectivo al operador.

**E. Detector de escenario de compra por cliente.**
Tres modos mutuamente excluyentes por unidad/tarjeta: (1) pago directo con factura nominativa de la gasolinera, (2) monedero electrónico con estado de cuenta del emisor, (3) tanque propio. Cada modo tiene documento válido distinto, momento de deducción distinto y riesgo distinto. Sin este switch, el motor de validación va a generar falsos positivos constantes.

**F. Cuestionario de alta: la pregunta de los 75,714 litros.**
Al onboarding de cada flota: *"¿Tienen tanque propio de diésel? ¿Cuántos litros al mes pasan por él?"*. Si la respuesta es ≥ 75,714 L/mes y no tienen permiso de la CNE, están obligados a control volumétrico y probablemente no lo saben. **No es un módulo que Likida deba construir** —es infraestructura de medición certificada, otra industria— pero sí es un hallazgo que posiciona a Likida como el que vio el problema. Y es una referencia natural a un socio.

**G. Vigilancia de solicitudes de cancelación.**
Los CFDI de combustible no se cancelan por silencio. Avisar al contralor cuando entre una solicitud sobre un CFDI de diésel ya liquidado.

### 8.2 Lo que hay que dejar de prometer

- ❌ **"Validamos tu factura contra el SAT en tiempo real."** No. La L_CNE es exclusiva de los PAC, con e.firma y CSD del propio PAC. Decir esto es falso y verificable por cualquier contador.
- ❌ **"Confirmamos que el permiso del proveedor está vigente hoy."** No: el padrón público es mensual y llegó con ~6 semanas de rezago. Lo honesto es: *"al corte de {fecha} de la CNE, este permiso aparece como vigente"*.
- ❌ **"Detectamos si el permiso está suspendido."** El padrón público no expone ese estatus, y la LISR sí lo exige. Es un hueco real; declararlo genera más confianza que taparlo.
- ❌ **Repetir la multa de "$17,000 a $97,000".** Es falsa (§6.4).
- ❌ **"Validamos con foto del ticket."** Sin XML no hay complemento, no hay permiso estructurado y no hay validación posible. La foto sirve para capturar y conciliar; **el XML es el que hace deducible el gasto**. Si el producto vive sólo de fotos, está vendiendo orden operativo, no seguridad fiscal — y hay que decirlo con esas palabras.

### 8.3 Lo que sí se puede prometer (y suena mejor de lo que parece)

> "Cada CFDI de combustible que entra a Likida se valida en tres capas: que traiga el complemento de hidrocarburos que el SAT exige desde el 24 de abril de 2026, que el número de permiso esté bien construido para el tipo de permiso que declara, y que ese permiso aparezca como vigente en el padrón público de la Comisión Nacional de Energía —te decimos con qué fecha de corte—. Además marcamos toda carga pagada en efectivo, que por ley no es deducible sin importar el monto. Lo que no hacemos es fingir que consultamos la lista privada del SAT: esa sólo la ven los PAC."

Esa promesa es defendible frente a un contador y es más de lo que hoy hace nadie en el segmento.

### 8.4 El ángulo comercial que sale de esta investigación

El complemento convirtió el permiso —dato antes semiestructurado, escondido en `NoIdentificacion` o directamente ausente— en **cinco campos tipados y validados**. Eso significa que a partir del 24-abr-2026 se puede construir, por primera vez, un perfil de proveedores de combustible por flota: qué gasolineras, de qué tipo de permiso, con qué subproducto, en qué corredores. Nadie tenía esos datos limpios antes. Para un contralor que sospecha que le están cargando diésel agrícola y facturándole automotriz, o que sus operadores cargan en estaciones fuera de ruta, ese reporte es nuevo y es vendible.

---

## SIN VERIFICAR

Lo que **no** pude comprobar en fuente primaria. Cada punto está aquí porque afirmarlo sin la marca sería inventar.

1. **La fecha exacta de publicación en el Portal del SAT: 25 de marzo de 2026.** **SIN VERIFICAR** en fuente SAT. El portal `sat.gob.mx` es una SPA (SvelteKit) que devuelve 403 a peticiones automatizadas y no expone endpoint de datos; no logré leer la página del complemento. Lo que **sí** verifiqué: (a) el XSD del complemento tiene `Last-Modified: 19-mar-2026`; (b) la regla 2.7.1.8 fija 30 días naturales desde la publicación; (c) numerosos PAC y despachos reportan 25-mar-2026 → 24-abr-2026 de forma consistente, y la aritmética cierra. Trátalo como muy probable, no como confirmado.

2. **Descripciones textuales de los catálogos `c_TipoPermiso` y `c_SubProductoHYP`.** Las **claves** están verificadas en el XSD del SAT. Las **descripciones** ("Expendio en estación de servicio de petrolíferos", "Diésel automotriz", etc.) vienen de documentación de PAC. No pude descargar el archivo Excel oficial de catálogos del SAT (todas las rutas probadas dieron 403 o 404). Mitigación: crucé las nomenclaturas contra el padrón real de la CNE (§4.5) y el mapeo es consistente; también encontré **una fuente secundaria con las descripciones evidentemente equivocadas** (asignaba "Permiso de almacenamiento" a `PER01`, cuya nomenclatura es de expendio), lo que confirma que hay ruido en el mercado y refuerza el cruce que hice.

3. **La "Revisión A" del complemento y su contenido exacto.** Que existe está **respaldado indirectamente**: el XSD de catálogos tiene `Last-Modified: 17-abr-2026` y ya contiene `PER09`–`PER11`, que no estaban en la versión inicial. El detalle de qué más cambió (matriz de errores, ajuste al código de error `CCHYP106` para coexistencia con Carta Porte, corrección del namespace en el ejemplo XML del PDF) proviene de comunicados de PAC. **SIN VERIFICAR** en documento del SAT.

4. **La matriz de errores del complemento** (códigos `CCHYP1xx`) y su **guía de llenado**. No pude localizar los PDF/XLSX en el sitio del SAT. Existen y son de aplicación obligatoria (regla 2.7.1.8, tercer párrafo, remite a las guías de llenado). **Pendiente de conseguir.** Es el documento que le va a decir al equipo de ingeniería exactamente qué rechaza el PAC y con qué código.

5. **Si un CFDI con complemento ECC (monedero) debe llevar también `HidroYPetro`.** La interpretación de §7.2 —que no, porque a nivel concepto va la comisión y no el combustible— es la que sostienen varios PAC citando preguntas frecuentes del SAT. **No leí esas preguntas frecuentes en fuente SAT.** Es relevante: si estuviera equivocada, los CFDI que reciben las flotas con tarjeta de flotilla tendrían un requisito adicional. **Consultar con el PAC del cliente antes de codificar reglas duras sobre este caso.**

6. **Si la L_CNE trata "permiso suspendido" como "no vigente".** El Anexo 29 dice que la lista *"contiene únicamente números de permisos vigentes"*, pero no define si un permiso suspendido se excluye. La LISR art. 27 fr. III distingue explícitamente entre "vigente" y "no suspendido", lo que sugiere que son estados distintos. **Hueco material:** si un permiso suspendido siguiera en la L_CNE, el CFDI se timbraría y aun así **no sería deducible**. Es exactamente el escenario en el que Likida aportaría más valor y el que menos puedo caracterizar hoy.

7. **Frecuencia real de actualización del padrón público de la CNE.** Los recursos observados son mensuales (`012026`, `feb26`) con rezago de ~6 semanas. No hay compromiso publicado de periodicidad. **SIN VERIFICAR** si el rezago es estructural o coyuntural.

8. **Si el `estatus` del padrón alguna vez toma valores "Suspendido", "Revocado" o "Cancelado".** En el corte de febrero-2026 sólo aparecen cuatro valores (§4.3). No sé si es porque el archivo filtra o porque no hubo casos. **Recomendación:** guardar históricos de cada corte y detectar desapariciones — un permiso que estaba y ya no está es una señal, aunque el archivo no la nombre.

9. **Estado de publicación del complemento "identificación de recurso y minuta de gastos por cuenta de terceros"** (Transitorio Décimo Segundo, RMF 2026). No encontré evidencia de que se haya publicado al 27-jul-2026. **SIN VERIFICAR.**

10. **Los importes de multa citados** son los del texto compilado del CFF publicado por la Cámara de Diputados con última reforma DOF 09-04-2026, actualizados por RMF DOF 28-12-2025. Están **VERIFICADOS** en esa fuente, pero se actualizan periódicamente por miscelánea: **revalidar en enero de cada año.**

11. **La aritmética del umbral de 75,714 L/mes** (§5.3) usa un consumo supuesto de 300–500 L/día por tractocamión. Ese rango es **mi estimación**, no un dato de fuente. El umbral legal sí está verificado; la cantidad de camiones que lo cruza, no. Calíbralo con datos reales de un cliente antes de usarlo en material comercial.

12. **La redacción de la regla 2.7.1.48** remite a "2.6.1.1., fracción II", que define mercancías y no sujetos (§1.3). Mi lectura es que se trata de un error de remisión y que el disparador operativo es la validación del Anexo 29. **Es interpretación mía, no doctrina confirmada.**

---

## Fuentes

### Primarias — leídas directamente

**Legislación (Cámara de Diputados, texto vigente)**
- Código Fiscal de la Federación, última reforma DOF 09-04-2026 — arts. 28 fr. I apartado B; 29-A fr. V inciso f) y fr. IX; 29-A penúltimo párrafo; 29 Bis; 55 fr. VII; 81 fr. XXV; 82 fr. XXV; 83 fr. VII; 84 fr. IV; 111 Bis — https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf
- Ley del Impuesto sobre la Renta — art. 27 fr. III (párrafo reformado DOF 12-11-2021) — https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf
- Ley de Ingresos de la Federación para 2026 (DOF 07-11-2025) — art. 16 apartado A fr. IV — https://www.diputados.gob.mx/LeyesBiblio/pdf/LIF_2026.pdf
- Ley del Sector Hidrocarburos (Nueva Ley DOF 18-03-2025) — arts. 5, 76; transitorios Segundo y Quinto — https://www.diputados.gob.mx/LeyesBiblio/pdf/LSH.pdf
- Decreto de expedición, DOF 18-03-2025 (edición vespertina) — https://www.diputados.gob.mx/LeyesBiblio/ref/lsh/LSH_orig_18mar25.pdf
- Reglamento de la Ley del Sector Hidrocarburos — https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LSH.pdf

**Resolución Miscelánea Fiscal 2026 (DOF 28-12-2025) y anexos**
- RMF 2026, texto íntegro — reglas 2.6.1.1, 2.6.1.2, 2.6.1.3, 2.6.1.4, 2.6.1.5, 2.6.2.1, 2.7.1.8, 2.7.1.21, 2.7.1.34, 2.7.1.35, 2.7.1.48, 2.7.7.1.1, 2.7.7.1.2, 2.7.7.1.6, 2.7.7.2.1, 2.7.7.2.4, 2.8.1.6, 3.3.1.7, 3.3.1.10; transitorios Décimo Primero, Décimo Segundo, Décimo Tercero — https://dof.gob.mx/nota_detalle.php?codigo=5777217&fecha=28%2F12%2F2025
- Anexo 29 de la RMF 2026 (DOF 09-01-2026) — sección III.3 "Listado de la Comisión Nacional de Energía (L_CNE)"; sección VI.1 numeral 9 "Atributo ClaveProdServ" — https://www.e-casa.com.mx/dof/2026/ene/09012026_anexo29_rmf2026.pdf *(mirror del texto DOF; el original está en dof.gob.mx tras muro de consulta)*
- Anexo 21 de la RMF 2026 (DOF 13-01-2026) — especificaciones técnicas de funcionalidad y seguridad de equipos y programas de controles volumétricos — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo_21_RMF2026-13012026.pdf

**Esquemas y guías del SAT (descargados y parseados)**
- XSD del complemento — https://www.sat.gob.mx/sitio_internet/cfd/hidrocarburospetroliferos.xsd *(Last-Modified: 19-mar-2026)*
- XSD de catálogos del complemento — http://www.sat.gob.mx/sitio_internet/cfd/catalogos/HidrocarburosPetro/catHidroYPetro.xsd *(Last-Modified: 17-abr-2026)*
- Guía de llenado del CFDI global versión 4.0 — Apéndice 3 "Instrucciones específicas de llenado en el CFDI global aplicable a Hidrocarburos y Petrolíferos"
- Minisitio de Controles Volumétricos del SAT — https://www.sat.gob.mx/minisitio/ControlesVolumetricos/consulta_permisos.html *(⚠️ enlaza a cre.gob.mx, host ya inexistente)*

**Datos abiertos de gobierno (descargados y analizados)**
- API CKAN, Plataforma Nacional de Datos Abiertos, organización CNE — https://www.datos.gob.mx/api/3/action/package_search?fq=organization:cne&rows=100
- Dataset "Petrolíferos" de la CNE — https://www.datos.gob.mx/api/3/action/package_show?id=petroliferos
- **Permisos y autorizaciones de petrolíferos vigentes (corte feb-2026), 17,840 registros** — https://repodatos.atdt.gob.mx/api_update/cne/petroliferos/pl_per_vig_feb26.csv
- Permisos otorgados de petrolíferos (corte feb-2026), 47 registros — https://repodatos.atdt.gob.mx/api_update/cne/petroliferos/pl_per_otr_feb26.csv
- Permisos definitivos otorgados en materia de petrolíferos (XLSX/PDF por actividad) — https://www.gob.mx/cne/documentos/permisos-definitivos-otorgados-en-materia-de-petroliferos
- Consulta de datos abiertos de la CNE — https://www.gob.mx/cne/articulos/consulta-de-datos-abiertos
- Sitio institucional de la CNE — https://www.cne.gob.mx/
- Ventanilla Energía (trámites CNE) — https://ventanilla.energia.gob.mx/tramites/institucion/2/0

### Secundarias — usadas como pista, no como fundamento

- SW Timbrado Masivo — Nuevo Complemento Concepto: Hidrocarburos y petrolíferos v1.0 — https://developers.sw.com.mx/knowledge-base/nuevo-complemento-concepto-hidrocarburos-y-petroliferos-v1-0/
- SW Timbrado Masivo — Actualización de catálogos (28-abr-2026) — https://developers.sw.com.mx/knowledge-base/28-abril-2026-actualizacion-de-catalogos-complemento-concepto-hidrocarburos-y-petroliferos/
- Gosocket — SAT publica la "Revisión A" del Complemento de Petrolíferos e Hidrocarburos V1.0 — https://gosocket.net/centro-de-recursos/sat-publica-la-revision-a-del-complemento-de-petroliferos-e-hidrocarburos-v1-0/
- SAIT — Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos *(fuente del catálogo `c_TipoPermiso`, contrastada contra el padrón CNE)* — https://ayuda.sait.mx/modulos-especiales/complemento-facturacion-de-hidrocarburos-y-petroliferos/
- Facturando — CFDI con ECC e HyP: aclaración para monederos electrónicos — https://www.facturando.mx/blog/index.php/2026/06/02/cfdi-ecc-hyp-monederos-electronicos/
- sFácil — Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos — https://www.sfacil.com/post/complemento-concepto-para-la-facturación-de-hidrocarburos-y-petrolíferos
- Formas Digitales — Complemento Concepto Hidrocarburos y Petrolíferos 1.0 *(⚠️ descripciones del catálogo `c_TipoPermiso` inconsistentes con las nomenclaturas; descartada)* — https://forsedi.facturacfdi.mx/developers/complemento-hidrotypetro10
- Volumetrics by AIVARA — Permisos de la CNE (antes CRE): guía completa para 2026 — https://www.volumetrics.com.mx/blog/permisos-de-la-cne-antes-cre-guia-completa-para-2026/
- IDC Online — Anexo 29 RMISC 2026: Nuevas Reglas para PACs — https://idconline.mx/fiscal-contable/2026/01/28/anexo-29-rmisc-2026-nuevas-reglas-para-pacs
- BDO México — Complemento de Hidrocarburos CFDI — https://www.bdomexico.com/es-mx/publicaciones/flash-fiscal/2026/complemento-de-hidrocarburos-cfdi
- Holland & Knight — Reglamento de la Ley del Sector Hidrocarburos en México — https://www.hklaw.com/en/insights/publications/2025/10/reglamento-de-la-ley-del-sector-hidrocarburos-en-mexico
- Greenberg Traurig — Publicación de Reglamentos del Sector Hidrocarburos — https://www.gtlaw.com/en/insights/2025/10/publicacion-de-reglamentos-del-sector-hidrocarburos
