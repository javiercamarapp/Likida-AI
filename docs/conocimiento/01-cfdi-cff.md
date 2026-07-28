# CFDI 4.0 y Código Fiscal de la Federación

> Investigado el 27-jul-2026 para Likida.ai. Fundamentos citados. Lo no verificado va marcado.

---

## Resumen para el fundador

1. **El CFDI es el XML, no la foto ni el PDF.** El CFF dice literal que la representación impresa "únicamente presume la existencia" del comprobante (CFF 29, fr. V). Si Likida solo guarda la foto del ticket, no tiene el comprobante fiscal: tiene un indicio.
2. **No existe un plazo legal para que el cliente pida su factura.** Lo que existe es un plazo para que el proveedor la emita (24 horas desde la operación, RCFF 39) y un plazo técnico para timbrarla (72 horas, RMF 2.7.2.9). "Ya pasó el mes" no está en ninguna ley.
3. **Pero sí existe un plazo real, y viene del ISR, no del CFF**: la fecha de expedición del CFDI de un gasto deducible *debe corresponder al ejercicio por el que se deduce* (LISR 27, fr. XVIII). Ese es el muro: **el mismo año calendario**. El SAT lo dice con esas palabras en su propio documento de prácticas indebidas.
4. **La factura global es la regla 2.7.1.21 de la RMF 2026, no la 2.7.1.24.** La 2.7.1.24 fue el número que tuvo hasta la RMF 2021; hoy la 2.7.1.24 es sobre devolución de IVA a turistas. Si el pitch de Likida cita 2.7.1.24, está citando una regla derogada de numeración.
5. **Cerrar la ventana a fin de mes no es capricho del comercio, es mecánica.** Cuando el comercio emite la factura global del mes con el RFC genérico XAXX010101000, esa venta ya quedó adentro. Para facturarte a ti, tiene que cancelar la global (motivo "04") y reexpedirla sin tu ticket, o emitir un CFDI de egreso que la disminuya. Es trabajo, y por eso te dicen que no.
6. **Para diésel y gasolina la regla es distinta y más dura**: la guía del SAT prohíbe cancelar la factura global de hidrocarburos y petrolíferos. La única salida es el CFDI de egreso. Esto le pega directo a las gasolineras, que son el proveedor número uno de una flota.
7. **Novedad 2026 y es grande**: desde el 1-ene-2026, el CFDI debe "amparar operaciones existentes, verdaderas o actos jurídicos reales" (CFF 29-A, fr. IX, DOF 07-11-2025). El que no cumpla **se considera falso**, con procedimiento exprés de 24 días hábiles (CFF 49 Bis) y consecuencia penal.
8. **Otra novedad 2026**: el CFDI de combustible debe llevar el número de permiso vigente de la Comisión Nacional de Energía (CFF 29-A, fr. V, inciso f). Antes era solo requisito de deducibilidad (LISR); ahora es requisito del comprobante.
9. **El plazo de cancelación se alargó en 2026**: antes era "en el ejercicio en que se expidió"; ahora es hasta el mes en que se presente la declaración anual de ISR del ejercicio de expedición (marzo del año siguiente para morales, abril para físicas).
10. **Sí existe un trámite formal para pelear una factura y tiene plazos**: se llama Solicitud de conciliación de factura (RMF 2.7.1.44 + ficha 46/CFF). Es gratuito, en línea, y el SAT resuelve en 6 días. Pero es conciliación voluntaria: no obliga al proveedor a nada.
11. **De todas las "prácticas indebidas" que circulan, solo una está publicada en el DOF** (criterio 1/CFF/PI, Anexo 3 de la RMF 2026): obligar al cliente a facturarse solo en un portal. Las otras nueve viven en un documento informativo del SAT de octubre de 2023. Sirven para convencer a un cajero, no para ganar un juicio.
12. **Ojo con Likida como tercero**: los criterios del Anexo 3 sancionan expresamente a "quien asesore, aconseje, preste servicios o participe" en esas prácticas. Multa de $79,130 a $124,380 (CFF 89 y 90). Likida es prestador de servicios en ese proceso.
13. **Diésel pagado en efectivo no es deducible, sin importar el monto** (LISR 27, fr. III). Si el operador paga con billetes, la factura perfecta no salva el gasto. Esto es un hallazgo de producto, no de contabilidad.
14. **El SAT tiene un web service público y gratuito para validar cualquier CFDI**, que además te avisa si el emisor está en la lista de EFOS del 69-B. Aguanta 2 millones de consultas por hora. Likida debería pegarle a ese servicio en cada comprobante.

---

## 0. Marco vigente al 27 de julio de 2026 (qué versión de cada norma se leyó)

| Norma | Versión leída | Fuente |
|---|---|---|
| Código Fiscal de la Federación | Última reforma **DOF 09-04-2026** | Cámara de Diputados (PDF oficial) |
| Reforma que crea las reglas 2026 de CFDI | **DOF 07-11-2025**, Edición Vespertina, vigor 01-01-2026 | Decreto publicado, texto íntegro |
| Reglamento del CFF | Vigente (DOF 02-04-2014) | Cámara de Diputados |
| Resolución Miscelánea Fiscal 2026 | **DOF 28-12-2025** | SAT / DOF |
| Primera Resolución de Modificaciones a la RMF 2026 | **DOF 09-07-2026** | SAT / DOF |
| Anexo 2 RMF 2026 (fichas de trámite) | DOF 29-12-2025 + 1ª modificación DOF 17-07-2026 | SAT / DOF |
| Anexo 3 RMF 2026 (criterios no vinculativos) | **DOF 09-01-2026** | SAT / DOF |
| Anexo 20 – Guía de llenado del CFDI | Publicada 31-12-2021, última revisión **08-03-2023** | SAT |
| Guía de llenado del CFDI global 4.0 | Publicada 31-12-2021, última revisión **08-03-2023** | SAT |
| Ley del ISR | Última reforma DOF 01-04-2024 | Cámara de Diputados |

**Verificado:** la Primera Resolución de Modificaciones a la RMF 2026 (DOF 09-07-2026) **no tocó** ninguna de las reglas de CFDI que se citan aquí (2.7.1.7, 2.7.1.21, 2.7.1.23, 2.7.1.32, 2.7.1.33, 2.7.1.34, 2.7.1.35, 2.7.1.44, 2.7.1.45, 2.7.2.9). La única regla del capítulo 2.7.1 que reformó fue la 2.7.1.48. Tampoco modificó la ficha 46/CFF del Anexo 2.

Nota de terminología: la versión vigente y única del estándar es **CFDI 4.0** (Anexo 20). La convivencia con la versión 3.3 terminó y desde el 1-abr-2023 el 4.0 es la única versión timbrable — *esto último es SIN VERIFICAR en fuente primaria; el dato viene de la trazabilidad de prórrogas del SAT, ver sección SIN VERIFICAR*.

---

## 1. Qué es un CFDI y qué no lo es

**El CFDI es un documento digital (XML) que ya pasó por el SAT o por un PAC.** El circuito completo, según el CFF art. 29, segundo párrafo, fracciones I a V:

1. El emisor tiene e.firma vigente y obligaciones activas en el RFC (fr. I).
2. Tramita su **Certificado de Sello Digital (CSD)** (fr. II).
3. Cumple los requisitos del art. 29-A y los complementos (fr. III).
4. **Remite** el comprobante al SAT o a un PCCFDI *antes de su expedición*, para que se valide, se le asigne folio y se le incorpore el sello digital del SAT (fr. IV, incisos a, b, c).
5. **Entrega o pone a disposición del cliente el archivo electrónico** y, si el cliente la pide, la representación impresa (fr. V).

> **Cita textual, CFF 29, fr. V:** "…deberán entregar o poner a disposición de sus clientes … el archivo electrónico del comprobante fiscal digital por Internet de que se trate y, cuando les sea solicitada por el cliente, su representación impresa, **la cual únicamente presume la existencia de dicho comprobante fiscal**."

**Traducción para Likida:** el PDF y el ticket impreso son *presunciones*. La prueba es el XML timbrado. Un pipeline que solo procese fotos está construyendo sobre una presunción.

### Requisitos mínimos de la representación impresa (RMF 2026, regla 2.7.1.7)

Si Likida va a leer PDFs o fotos, esto es lo que legalmente debe aparecer en ellos y por tanto lo que un OCR debería exigir:

- Código de barras (QR) conforme al rubro I.D del Anexo 20, **o** el número de folio fiscal (UUID).
- Número de serie del CSD del emisor y del SAT.
- La leyenda "Este documento es una representación impresa de un CFDI".
- Fecha y hora **de emisión y de certificación** (son dos fechas distintas).
- Cadena original del complemento de certificación digital del SAT.
- Si trae complemento Carta Porte, además los datos del instructivo de llenado correspondiente (fr. IX).
- El archivo debe estar en PDF "o algún otro similar que permita su impresión".

Fundamento: RMF 2026, regla 2.7.1.7 (DOF 28-12-2025), que a su vez desarrolla el CFF 29, segundo párrafo, fr. V.

### Medios válidos para que el proveedor te entregue el XML (RMF 2026, regla 2.7.1.33)

Previo acuerdo entre las partes: (I) correo electrónico del cliente, (II) dispositivo portátil de almacenamiento, (III) URL de descarga, (IV) cuenta de almacenamiento en la nube designada por el cliente.

**Esto es una puerta abierta para Likida:** la regla permite explícitamente que el proveedor deposite el XML en una nube designada por el cliente. Es fundamento para pedirle a una gasolinera que mande los XML a un buzón de Likida.

### Tipos de CFDI (Anexo 20, Guía de llenado, Apéndice 2)

| Tipo | Para qué sirve |
|---|---|
| **I – Ingreso** | La venta. Es el que la flota necesita para deducir. |
| **E – Egreso** | Devoluciones, descuentos, bonificaciones. También sirve para *restar* un CFDI de ingresos ya emitido. Es la nota de crédito. Clave en el mecanismo de la factura global. |
| **T – Traslado** | Ampara transporte y legal tenencia de mercancía. Es el que lleva Carta Porte cuando no hay venta. |
| **P – Pago** | Complemento para recepción de pagos. Se emite cuando el pago es posterior o en parcialidades. |
| **N – Nómina** | Recibo de nómina. |

---

## 2. Requisitos del CFDI: CFF artículos 29 y 29-A

### 2.1 El checklist completo del art. 29-A (texto vigente al 09-04-2026)

| Fr. | Requisito | Detalle que importa para una flota |
|---|---|---|
| **I** | RFC, nombre o razón social **del emisor** y **régimen fiscal** en que tributa. Si tiene más de un local, el domicilio del local donde se expide. | El régimen fiscal del emisor se volvió requisito en la reforma DOF 12-11-2021. |
| **II** | Número de folio y **sello digital del SAT**, más el sello digital del emisor. | Sin sello del SAT no hay CFDI, hay borrador. |
| **III** | **Lugar y fecha de expedición.** | Ojo: fecha de *expedición*, no de la operación. Ver sección 8. |
| **IV** | RFC, nombre o razón social **y código postal del domicilio fiscal del receptor**, más la **clave de uso fiscal** del CFDI. | Los cuatro datos que el cajero puede pedirte. Nada más. Si no hay RFC, va la clave genérica (público en general). |
| **V** | Cantidad, unidad de medida y clase de bienes o descripción del servicio, usando los **catálogos** del Anexo 20. | Aquí vive la validación de "esto que compró el operador realmente es diésel". |
| **V, párr. 2** | Si hay discrepancia entre lo facturado y la actividad económica registrada en el RFC, **la autoridad actualiza de oficio el régimen y las obligaciones** del contribuyente. | Riesgo silencioso para el proveedor. |
| **V, inciso a)** | CFDI a personas físicas del coordinado que pagan individualmente (LISR 73, quinto párrafo): **deben identificar el vehículo**. | Directamente aplicable a autotransporte de carga federal bajo coordinado. |
| **V, inciso f)** | **NUEVO 2026.** Quienes distribuyan o enajenen hidrocarburos o petrolíferos deben incluir el **número de permiso vigente de la Comisión Nacional de Energía**. | Adicionado DOF 07-11-2025. Es el requisito que Likida debe validar en cada factura de diésel. |
| **VI** | Valor unitario en número. | |
| **VII, a)** | Si se paga en una sola exhibición: se dice expresamente, importe total, impuestos trasladados desglosados por tasa, e impuestos retenidos. | |
| **VII, b)** | Si no se paga en una exhibición (o se paga diferido): CFDI por el total + **un CFDI por cada pago recibido**, señalando el folio del CFDI del total. | Este es el complemento de pagos. |
| **VII, c)** | **Forma en que se realizó el pago**: efectivo, transferencia, cheque nominativo, tarjeta de débito/crédito/servicio o monedero electrónico autorizado. | Campo `FormaPago`. Registrar una forma distinta a la real es práctica indebida (ver §6.3, #7). |
| **VIII** | Mercancías de importación: número y fecha del documento aduanero. | |
| **IX** | **NUEVO 2026.** "**Amparar operaciones existentes, verdaderas o actos jurídicos reales.** Los comprobantes fiscales que no cumplan con el requisito establecido en esta fracción, **se consideran falsos** para efectos de este Código." | Adicionado DOF 07-11-2025. Ver §2.3. |
| **X** | Los demás que el SAT establezca por reglas generales (antes era la fr. IX; se recorrió). | |

### 2.2 La sanción de fondo: si falta un requisito, no se deduce

> **Cita textual, CFF 29-A, antepenúltimo bloque de párrafos:** "Las cantidades que estén amparadas en los comprobantes fiscales que no reúnan algún requisito de los establecidos en esta disposición o en el artículo 29 de este Código, según sea el caso, o cuando los datos contenidos en los mismos se plasmen en forma distinta a lo señalado por las disposiciones fiscales, **no podrán deducirse o acreditarse fiscalmente**."

Esta frase es la razón de existir de Likida. Cada campo del checklist anterior es un motivo de rechazo del gasto.

### 2.3 Lo nuevo y grande de 2026: la fracción IX y el procedimiento de comprobantes falsos

El Decreto publicado en el **DOF del 7 de noviembre de 2025** (Edición Vespertina, vigor 1-ene-2026) hizo tres cosas encadenadas:

**(a) Adicionó la fracción IX al art. 29-A.** Un CFDI que no ampare una operación real es, por definición legal, **falso**.

**(b) Adicionó el art. 29-A Bis.** Si la autoridad, ejerciendo cualquier facultad, detecta el incumplimiento de la fracción IX, **puede determinar directamente**, sin agotar antes el procedimiento del 49 Bis.

**(c) Adicionó el art. 49 Bis**, un procedimiento exprés de visita domiciliaria para declarar falsos los CFDI. Lo relevante para el receptor (la flota):

- Desde que se entrega la orden de visita, **se suspende la emisión de CFDI** del visitado, y no aplica el 17-H Bis (fr. I).
- El contribuyente tiene **5 días hábiles** para aportar pruebas (fr. V).
- La autoridad tiene **15 días hábiles** para resolver (fr. VIII).
- **Todo el procedimiento cierra en máximo 24 días hábiles** (fr. IX).
- Si no se desvirtúa: los CFDI **se consideran falsos con efectos generales** y "las operaciones contenidas en los mismos no producen ni produjeron efecto fiscal alguno" (fr. VIII, inciso b).
- El nombre y RFC del emisor se publican **en el Portal del SAT y en el DOF** dentro de los 45 días hábiles siguientes (fr. X).
- **Los terceros que recibieron esos CFDI tienen 30 días naturales desde la publicación en el DOF para revertir el efecto fiscal** vía declaración complementaria. Si no lo hacen, **el SAT les restringe temporalmente su propio CSD** (17-H Bis, fr. XIV).
- La SHCP procede penalmente conforme al 113 Bis (fr. XI).

**Lectura para Likida:** una flota puede quedar con el CSD restringido —o sea, sin poder facturar a sus clientes— por no haber revisado a tiempo una publicación del DOF sobre una gasolinera. Ese es un dolor operativo real, con reloj de 30 días naturales, y hoy nadie se lo vigila.

**Contexto:** esto convive con el 69-B (EFOS/EDOS) de siempre, que sigue vigente. El 49 Bis es más rápido y más agresivo.

### 2.4 Los proveedores de certificación (PAC): CFF 29 Bis

El SAT autoriza particulares como **PCCFDI** para validar los requisitos del 29-A, asignar folio e incorporar el sello del SAT. Deben ofrecer una garantía que ampare el cumplimiento de sus obligaciones. Fundamento: CFF 29 Bis (adicionado DOF 12-11-2021).

En la RMF 2026, regla 2.7.2.8, fr. XXV, se agregó un requisito nuevo para seguir siendo PAC: **que no se les haya notificado resolución de que emiten falsos comprobantes en términos del 49 Bis**.

---

## 3. Plazos de emisión y de timbrado

Aquí es donde casi todo el mundo se confunde. Son tres relojes distintos.

### 3.1 Reloj 1 — 24 horas para remitir al SAT o al PAC

> **Cita textual, RCFF art. 39:** "…los contribuyentes deberán remitir al Servicio de Administración Tributaria o al proveedor de certificación de comprobantes fiscales digitales por Internet autorizados …, el comprobante fiscal digital por Internet, **a más tardar dentro de las veinticuatro horas siguientes a que haya tenido lugar la operación, acto o actividad** de la que derivó la obligación de expedirlo."

Fundamento: Reglamento del CFF, art. 39, en relación con CFF 29, segundo párrafo, fr. IV.

### 3.2 Reloj 2 — 72 horas entre generación y certificación

> **Cita, RMF 2026, regla 2.7.2.9, segundo párrafo, fr. I:** el PCCFDI debe validar "Que el periodo entre la **fecha de generación del documento y la fecha en la que se pretende certificar no exceda de 72 horas**, o que dicho periodo sea menor a cero horas, esto lo validarán haciendo uso del huso horario correspondiente al Código Postal registrado en el campo `LugarExpedicion`".

Nota técnica que importa: la validación usa el **huso horario del código postal del `LugarExpedicion`**, no el del servidor. Un CFDI generado en Tijuana y timbrado con reloj del centro puede reventar por "menor a cero horas".

### 3.3 Cuándo se considera legalmente "expedido"

> **Cita, RMF 2026, regla 2.7.2.9:** "El CFDI **se considera expedido una vez generado y sellado con el CSD del contribuyente, siempre que se obtenga el Timbre Fiscal Digital del SAT** … dentro del plazo a que se refiere la fracción I del segundo párrafo de esta regla."

O sea: generado + sellado + timbrado dentro de 72 horas. Si se pasó de 72 horas, no hay CFDI; hay que regenerarlo con nueva fecha.

### 3.4 Lo que el PAC valida antes de timbrar (regla 2.7.2.9)

Además del plazo: que no se haya certificado antes por el mismo PAC; que el CSD estuviera vigente y no cancelado a la fecha de generación; que el CSD corresponda al emisor y el sello al documento; que cumpla el estándar del Anexo 20; que la versión del estándar y sus complementos estén vigentes; y que cumpla los documentos normativos adicionales y el Anexo 29.

**El PAC devuelve:** folio asignado por el SAT (UUID), fecha y hora de certificación, sello digital del CFDI, número de serie del CSD del SAT y sello digital del SAT.

### 3.5 Reloj 3 — Complemento de pagos: día 5 del mes siguiente

> **RMF 2026, regla 2.7.1.32:** "El CFDI con 'Complemento para recepción de Pagos', deberá emitirse **a más tardar al quinto día natural del mes inmediato siguiente** al que corresponda el o los pagos recibidos."

Y: puede emitirse uno por cada pago, o **uno solo por todos los pagos de un mes** siempre que sean del mismo receptor. En el CFDI de pago se pone "cero" en `Total` y no se registra nada en `MetodoPago` ni `FormaPago`.

### 3.6 Factura global: 24 horas desde el cierre del periodo

> **RMF 2026, regla 2.7.1.21, quinto párrafo:** "…los contribuyentes podrán remitir al SAT o al PCCFDI, según sea el caso, el CFDI **a más tardar dentro de las 24 horas siguientes al cierre de las operaciones** realizadas de manera diaria, semanal, mensual o bimestral."

### 3.7 Cuadro resumen de plazos

| Qué | Plazo | Fundamento |
|---|---|---|
| Remitir el CFDI al SAT/PAC | 24 h desde la operación | RCFF 39 |
| Timbrar (generación → certificación) | 72 h máximo | RMF 2.7.2.9, fr. I |
| Emitir la factura global | 24 h desde el cierre del periodo (diario/semanal/mensual/bimestral) | RMF 2.7.1.21 |
| Emitir el complemento de pagos | día 5 natural del mes siguiente | RMF 2.7.1.32 |
| Aceptar o rechazar una solicitud de cancelación | 3 días desde la recepción; el silencio es aceptación | RMF 2.7.1.34 |
| Cancelar un CFDI | hasta el mes de la declaración anual de ISR del ejercicio de expedición | CFF 29-A, cuarto párrafo (reformado DOF 07-11-2025) |
| Obtener el CFDI de un gasto deducible | a más tardar el día en que se deba presentar la declaración anual | LISR 27, fr. XVIII |
| Fecha de expedición de un gasto deducible | debe corresponder al ejercicio por el que se deduce | LISR 27, fr. XVIII |

---

## 4. Cancelación de CFDI

### 4.1 El plazo cambió en 2026

**Texto vigente (CFF 29-A, cuarto párrafo, reformado DOF 07-11-2025):**

> "Los comprobantes fiscales digitales por Internet se podrán cancelar **a más tardar en el mes en el cual se deba presentar la declaración anual del impuesto sobre la renta que corresponda al ejercicio fiscal en el cual se expidió** el referido comprobante y siempre que la persona a favor de quien se expidan acepte su cancelación."

**Qué cambió respecto a 2022–2025:** la redacción anterior (reforma DOF 12-11-2021) limitaba la cancelación **al ejercicio en que se expidió el CFDI**. Ahora corre hasta el mes de la declaración anual.

**Fechas concretas para un CFDI expedido en 2026:**

| Quién cancela | Declaración anual | Última fecha para cancelar |
|---|---|---|
| Persona moral | dentro de los 3 meses siguientes al cierre del ejercicio (LISR 76, fr. V) → marzo 2027 | **31 de marzo de 2027** |
| Persona física | en el mes de abril del año siguiente (LISR 150) | **30 de abril de 2027** |

*Precisión: el plazo se ancla a la declaración anual del **emisor**, que es quien cancela. Una gasolinera persona moral tiene hasta marzo.*

### 4.2 El procedimiento de aceptación del receptor (RMF 2026, regla 2.7.1.34)

1. El emisor solicita la cancelación en el Portal del SAT.
2. El receptor recibe un mensaje **por buzón tributario**.
3. El receptor tiene **3 días** contados desde la recepción para aceptar o negar en el Portal del SAT.
4. **Si no hace nada, el SAT considera que aceptó.** Silencio = aceptación tácita.

**Excepción crítica para flotas:** ese silencio-aceptación **NO aplica** a:
- CFDI de ingreso y egreso con "Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos";
- CFDI de ingreso con **complemento Carta Porte** donde el campo `BienesTransp` registre las claves **15101505 (Combustible Diesel)**, **15101514 (Gasolina regular menor a 91 octanos)** o **15101515 (Gasolina premium mayor o igual a 91 octanos)**.

En esos casos el receptor **debe manifestar expresamente** la aceptación. Es decir: para diésel, el silencio no cancela nada.

**Reglas adicionales de la 2.7.1.34:**
- Si el CFDI a cancelar tiene otros CFDI relacionados, **esos deben cancelarse primero**.
- Si se cancela pero **la operación subsiste**, hay que emitir un CFDI nuevo relacionado con el cancelado (tipo de relación **04 – Sustitución de los CFDI previos**).
- Se puede cancelar de forma masiva, con las especificaciones técnicas del Portal del SAT, pero igual se necesita la aceptación del receptor.
- La cancelación se hace **con el CSD del emisor**, en el Portal del SAT (regla 2.7.2.9, último párrafo).

**Consecuencia operativa para Likida:** una flota que no revisa su buzón tributario acepta cancelaciones por omisión cada 3 días. Un CFDI aceptado en silencio y no repuesto es un gasto que se cae. **Esto es monitoreable y nadie lo monitorea.** El CFF 17-K obliga a habilitar el buzón y mantener actualizados los medios de contacto, y a consultarlo dentro de los 3 días siguientes al aviso electrónico.

### 4.3 Motivos de cancelación (catálogo `c_MotivoCancelacion`)

Desde el 1-ene-2022 es obligatorio señalar el motivo, y **aplica a todas las versiones del CFDI**. Fundamento: CFF 29-A, sexto párrafo.

| Clave | Motivo | Cuándo se usa (según el SAT) | ¿Requiere CFDI sustituto? |
|---|---|---|---|
| **01** | Comprobante emitido con errores **con** relación | Error en clave de producto, valor unitario, descuento o cualquier otro dato, y hay que reexpedir. **Primero se emite el sustituto** (con tipo de relación 04) y luego se cancela citando el folio del sustituto. | Sí |
| **02** | Comprobante emitido con errores **sin** relación | Mismo tipo de error, pero no se requiere relacionarlo con otro CFDI. Ej.: se equivocaron de cliente en el RFC y aún no se entregó. | No (aunque después se emita uno nuevo) |
| **03** | No se llevó a cabo la operación | Se facturó una operación que no se concretó. | No |
| **04** | **Operación nominativa relacionada en una factura global** | Se incluyó una venta en la factura global de público en general y **después el cliente pide su factura nominativa**. | Sí: se reexpide la global sin esa operación y se emite la nominativa |

**Detalle técnico útil:** cuando la factura A se relaciona dentro de la factura B, el estatus de A pasa a "No cancelable". Al solicitar la cancelación se rompe la relación y A vuelve a ser cancelable. Si el flujo se atora con motivo 01, el SAT indica usar el motivo 02 para cancelar todos los relacionados (incluido el sustituto) y volver a emitir.

Fuente: SAT, *Preguntas frecuentes y escenarios de cancelación conforme a la Reforma Fiscal 2022* (mayo 2022), preguntas 2 a 9 y escenarios 1 a 4.

### 4.4 Cancelación sin aceptación del receptor (RMF 2026, regla 2.7.1.35)

Doce supuestos en los que el emisor cancela solo:

| # | Supuesto | Excepciones relevantes |
|---|---|---|
| I | Montos totales **hasta $1,000.00** | Salvo los del tercer párrafo de la 2.7.1.34 (hidrocarburos y Carta Porte con diésel/gasolina) y los CFDI con complemento de pagos |
| II | Nómina | |
| III | Egresos | Salvo los del tercer párrafo de la 2.7.1.34 |
| IV | Traslado | **Salvo** los que lleven Carta Porte con `ClaveProdServ` 15101505, 15101514 o 15101515 → van por la regla 2.7.7.1.6 |
| V | Ingresos expedidos a contribuyentes del RIF (régimen histórico) | |
| VI | Retenciones e información de pagos | |
| VII | **Operaciones con el público en general** (regla 2.7.1.21) | ← Este es el que permite cancelar la factura global sin pedir permiso a nadie |
| VIII | Emitidos a residentes en el extranjero (regla 2.7.1.23) | |
| IX | **Cancelación dentro del día hábil siguiente a su expedición** | |
| X | Ingresos por enajenación/uso o goce de inmuebles, terrenos, derechos ejidales o comunales, y sector primario, vía PCECFDI o PCGCFDISP | |
| XI | Emitidos por integrantes del sistema financiero | |
| XII | Emitidos por la Federación por DPA's | |

Y el candado final: **esta facilidad no aplica a CFDI de ingreso de operaciones con hidrocarburos y/o petrolíferos** (regla 2.6.1.1); esos van forzosamente por la 2.7.1.34, tercer párrafo — salvo las fracciones VII y VIII.

### 4.5 Cuando se cancela pero la operación subsiste

Tanto la 2.7.1.34 como la 2.7.1.35 lo dicen igual: se emite un CFDI nuevo **relacionado con el cancelado**, conforme a la guía de llenado del Anexo 20, con tipo de relación **04 – Sustitución de los CFDI previos**.

### 4.6 Carta Porte y diésel: regla 2.7.7.1.6

Existe una regla específica —RMF 2026, 2.7.7.1.6— para la cancelación de CFDI **de tipo traslado con complemento Carta Porte** cuando se trasladan hidrocarburos/petrolíferos. Fundamento invocado: CFF 29-A, cuarto párrafo. *No se transcribió su contenido íntegro en esta investigación; queda listado en SIN VERIFICAR.*

---

## 5. Factura global, RFC genérico y la ventana de fin de mes

### 5.1 Primero, la corrección de numeración

| Concepto | Regla en RMF 2026 | Nota |
|---|---|---|
| Expedición de comprobantes en operaciones con el público en general (**la factura global**) | **2.7.1.21** | Era la **2.7.1.24** en la RMF 2021 y anteriores. Se renumeró desde la RMF 2022. |
| Clave en el RFC genérica en CFDI y con residentes en el extranjero | **2.7.1.23** | Aquí vive XAXX010101000 |
| **2.7.1.24 en la RMF 2026** | CFDI para **devolución del IVA a turistas extranjeros** | Nada que ver con factura global |
| Definición de "público en general" para efectos de expedición de CFDI | **2.7.1.45** | Regla relativamente reciente y muy útil |

**Verificado directamente en el PDF de la RMF 2026 publicada en el DOF el 28-12-2025.** Si algún material de Likida cita "RMF 2.7.1.24" para factura global, está citando la numeración de 2021 o anterior.

### 5.2 Qué es la factura global (regla 2.7.1.21)

Fundamento invocado por la propia regla: CFF 29 y 29-A fr. IV segundo párrafo; RCFF 39; LISR 113-G fr. V segundo párrafo.

Los contribuyentes **pueden** elaborar un CFDI **diario, semanal o mensual** donde consten los importes de cada operación con el público en general del periodo y el número de folio u operación de los comprobantes emitidos, usando el RFC genérico de la regla 2.7.1.23.

Variantes por régimen:
- **RIF** (régimen histórico, LISR vigente hasta 31-dic-2021): pueden hacerlo **bimestral**, incluyendo únicamente el monto total del periodo.
- **RESICO personas físicas** (Título IV, Cap. II, Sec. IV LISR): en el CFDI mensual **solo incluyen el monto total del periodo**, sin desglosar folios.

Además:
- Por cada operación hay que **expedir el comprobante de operaciones con el público en general** (el ticket), que debe contener los requisitos del 29-A fracciones I y III, el valor total, la cantidad, la clase de bienes o descripción del servicio y, en su caso, el número de registro de la máquina y el logotipo fiscal.
- El ticket puede ser: impreso en original y copia con folio consecutivo; copia del registro de auditoría de la caja registradora; o emitido por equipos de registro con sistemas de registro contable electrónico y acceso para la autoridad.
- **En los CFDI globales se debe separar el monto del IVA e IEPS a cargo del contribuyente.**
- **Umbral de $100:** si el cliente no pide comprobante, no hay obligación de expedirlo por operaciones **inferiores a $100.00**. (Obsérvese: no expedir el *ticket*; la obligación de incluir el ingreso en la global sigue.)
- **La facilidad no aplica** a los sujetos de la regla 2.6.1.2 (hidrocarburos con controles volumétricos), y las estaciones de servicio que operen con monederos electrónicos autorizados van por la regla 3.3.1.7.
- La autoridad puede **quitarle a una estación de servicio el derecho de emitir globales** si no cumple con controles volumétricos (regla 2.6.2.1): 10 días para subsanar y, si no, resolución notificada por buzón tributario.

### 5.3 El RFC genérico (regla 2.7.1.23) y la definición de "público en general" (regla 2.7.1.45)

> **Regla 2.7.1.23:** "…cuando no se cuente con la clave en el RFC, se consignará la clave genérica en el RFC: **XAXX010101000** y cuando se trate de operaciones efectuadas con residentes en el extranjero, que no se encuentren inscritos en el RFC, se señalará la clave genérica en el RFC: **XEXX010101000**."

> **Regla 2.7.1.45:** "…se entiende por actividades realizadas con el público en general, cuando se registre la clave en el RFC genérica a que se refiere la regla 2.7.1.23., consistente en: XAXX010101000, en el campo `Rfc` del nodo `Receptor` del CFDI."

Y el fundamento legal de arriba: CFF 29-A, fr. IV, segundo párrafo, que dice que cuando no se cuente con el RFC se usa la clave genérica, "**considerándose la operación como celebrada con el público en general**".

**Consecuencia dura:** un CFDI con XAXX010101000 en el receptor **no es deducible para la flota**, porque no cumple el 29-A fr. IV (falta el RFC del receptor), y el propio 29-A dice que lo que no reúna algún requisito "no podrá deducirse o acreditarse fiscalmente". Además reventaría el LISR 27 fr. III (estar amparadas con comprobante fiscal) y el LIVA 5 fr. II (IVA trasladado expresamente y por separado al contribuyente).

### 5.4 El nodo `InformacionGlobal` del CFDI 4.0

Según la *Guía de llenado del CFDI global, versión 4.0 del CFDI* (SAT):

| Campo | Regla |
|---|---|
| `Periodicidad` | Periodo del comprobante global (catálogo `c_Periodicidad`: 01 diario, 02 semanal, 03 quincenal, 04 mensual, 05 bimestral). Si el valor es "05", el `RegimenFiscal` debe ser "621". |
| `Meses` | Clave del mes o meses (catálogo `c_Meses`). Si `Periodicidad` = "05" debe ser 13–18 (los bimestres). Si es distinta de "05", debe ser 01–12. |
| `Año` | **"El valor registrado debe ser igual al año en curso o al año inmediato anterior considerando el registrado en la Fecha de emisión del comprobante."** |

**Ese campo `Año` es un límite técnico real:** un comercio no puede emitir hoy (2026) una factura global de 2024. El sistema lo rechaza. Es la evidencia técnica de que la ventana de facturación no es infinita.

Para hidrocarburos y petrolíferos hay un apéndice específico (Apéndice 3 de la guía, obligatorio desde el 1-abr-2020) con una regla de forma de pago que muerde: **"En el caso de existir comprobantes de operaciones con el público en general con distintas formas de pago, se debe realizar un CFDI global por cada una de éstas."** O sea, la gasolinera genera globales separadas por efectivo, cheque, transferencia, etc.

### 5.5 Por qué el comercio cierra su ventana de facturación a fin de mes — la mecánica real

No es que la ley lo prohíba. Es que **una vez que la venta entró a la factura global, sacarla cuesta trabajo**. El SAT reconoce **tres caminos** en la *Guía de llenado del CFDI global* (Apéndice 2), y todos son operaciones que alguien tiene que hacer a mano:

**Camino A — Cancelar la global y reexpedirla** (el más conocido)
1. Se cancela la factura global con **motivo 04** (Operación nominativa relacionada en una factura global).
2. Se genera de nuevo la factura global **sin considerar** el ticket de la operación que se va a facturar nominativamente.
3. Se emite el CFDI nominativo al cliente.

Fundamento: Guía de llenado del CFDI global, Apéndice 2, fracción II + SAT, *Preguntas frecuentes de cancelación* (mayo 2022), pregunta 9.

**Camino B — CFDI de egreso para disminuir la operación** (agregado en la revisión del 08-03-2023)
> "…cuando se requiera disminuir una operación contenida en un CFDI global, derivado de que el cliente solicite un CFDI nominativo, el contribuyente **podrá emitir un CFDI de egreso para disminuir dicha operación**."

No hay que cancelar nada. Se emite una nota de crédito relacionada a la global y luego el CFDI nominativo. **Este es el camino que Likida debe pedirle al proveedor**, porque no le rompe la contabilidad del mes.

**Camino C — CFDI de egreso por devolución de un concepto** (para devoluciones/descuentos reales).

**Argumento de venta que se desprende de esto:** cuando un comercio dice "ya cerré el mes, no puedo", técnicamente está diciendo "no quiero cancelar mi global". El Camino B existe desde marzo de 2023 y no requiere cancelar nada. Likida puede ponerle ese texto (con la cita) en la mano al conductor o al contralor.

### 5.6 El caso de las gasolineras: aquí el Camino A está prohibido

> **Cita textual, Guía de llenado del CFDI global, Apéndice 3 (Hidrocarburos y Petrolíferos):** "…para los efectos del CFDI global aplicable a Hidrocarburos y Petrolíferos y siempre que se haya realizado la venta, **no se deberán cancelar los CFDI globales**, la única forma de poder realizar la cancelación de una operación que se llevó a cabo y que esté contenida en un CFDI global, es **la emisión de un CFDI de egreso relacionado por una devolución de un concepto**, en los términos descritos en el citado apéndice 2, para efectos de la generación del CFDI de ingresos de manera individual y nominativa, en caso de que un cliente lo haya solicitado."

**Esto es probablemente el hallazgo más accionable de toda la investigación para Likida.** Cuando la gasolinera dice "no puedo, ya cerré el mes", la respuesta correcta no es "sí puedes cancelar", es: **"no cancelas nada; emites un CFDI de egreso relacionado y luego mi CFDI nominativo. Lo dice el Apéndice 3 de la Guía de llenado del CFDI global del SAT."**

---

## 6. Prácticas indebidas

Hay dos niveles y no son lo mismo. Confundirlos es un error caro.

### 6.1 Nivel 1 — Publicado en el DOF: criterios no vinculativos (Anexo 3 de la RMF 2026)

Fundamento de publicación: **CFF 33, fr. I, inciso h)**, en relación con la regla 1.4 fr. III de la RMF. Publicados en el **DOF el 9 de enero de 2026** (Anexo 3 de la RMF 2026).

**Criterio 1/CFF/PI — "Entrega o puesta a disposición del CFDI. No se cumple con la obligación cuando el emisor únicamente remite a una página de Internet."**

Razonamiento del SAT (resumido, con sus palabras): el 29 primer párrafo obliga a expedir; la fr. IV obliga a remitirlo al SAT/PCCFDI antes de expedirlo; la fr. V obliga a entregar el archivo electrónico. "…se considera que **el cliente que solicita el comprobante fiscal solo debe proporcionar su clave en el RFC, nombre o razón social, código postal del domicilio fiscal y uso fiscal** que le dará al comprobante fiscal, **sin necesidad de exhibir la Cédula de Identificación Fiscal o Constancia de Situación Fiscal**."

Son práctica fiscal indebida:
> I. Los contribuyentes que no cumplan, **en el mismo acto y lugar**, con su obligación de expedir el CFDI y tampoco con su remisión al SAT o al PCCFDI.
> II. Los contribuyentes que **no permitan, en el mismo acto y lugar, que el cliente proporcione sus datos** para la generación del CFDI.
> III. Los contribuyentes que, en sus establecimientos, sucursales o puntos de venta, **únicamente pongan a disposición del cliente un medio por el cual le invitan para que este, por su cuenta, proporcione sus datos y, por ende, le trasladan la obligación de generar el CFDI.**
> IV. **Quien asesore, aconseje, preste servicios o participe** en la realización o la implementación de cualquiera de las prácticas anteriores.

Primer antecedente: Quinta Resolución de Modificaciones a la RMF 2014, DOF 16-10-2014; Anexo 3 DOF 17-10-2014.

**Criterio 3/CFF/PI — "Elusión de los efectos de la restricción temporal o cancelación del uso del CSD."**

Relevante para una flota como **receptora**. Es práctica indebida, entre otras:
> III. **Deducir y/o acreditar** alguna cantidad con base en comprobantes fiscales emitidos **por una persona diferente** de la que le vendió, a sabiendas de que esa persona tiene el CSD restringido o cancelado y está impedida legalmente para expedir CFDI.
> IV. Quien asesore, aconseje, preste servicios o participe.

Y establece la regla de oro: "las personas que adquieran bienes … **deberán solicitar el CFDI únicamente de la persona con la cual celebraron la operación** correspondiente". Primer antecedente: RMF 2022, DOF 27-12-2021; Anexo 3 DOF 05-01-2022.

### 6.2 Nivel 2 — Documento informativo del SAT (no publicado en DOF)

Documento oficial del SAT: **"Prácticas indebidas en la emisión de facturas", octubre 2023**. Es un PDF alojado en sat.gob.mx, no un acto publicado en el DOF. Vale para argumentar y para denunciar; no es norma. Lista textual:

| # | Práctica indebida | Aclaración textual del SAT |
|---|---|---|
| 1 | **Exigir datos adicionales** al RFC, nombre completo, denominación o razón social, régimen fiscal, código postal del receptor y uso del CFDI | "El contribuyente que solicita la factura solo debe proporcionar **verbalmente** su información" |
| 2 | **Obligar a proporcionar un correo electrónico** | "esta información es opcional… de ninguna manera es obligatorio" |
| 3 | **Condicionar la expedición del CFDI a la Cédula de Identificación Fiscal o Constancia de Situación Fiscal** | |
| 4 | **Incrementar el precio** del bien o servicio cuando se solicita la factura | "El precio debe incluir el IVA, sin importar si se solicita o no la factura" |
| 5 | **Obligar al receptor a generar la factura en un portal** | "Se debe entregar la factura **en el establecimiento en donde se lleva a cabo la operación y al momento de realizarla**, si así lo requiere el contribuyente" |
| 6 | **Negar la factura al argumentar que no se solicitó en el momento de la transacción** | **"Se puede emitir con posterioridad, mientras sea en el mismo año en que se realizó la operación."** |
| 7 | **Registrar una forma de pago distinta a la recibida** o registrarla sin que se haya realizado el pago | |
| 8 | **Negar la emisión de la factura cuando se pague en efectivo** | "sin importar el medio por el cual se realice el pago … se debe emitir la factura" |
| 9 | **No emitir la factura cuando se reciben pagos por anticipos** | "estos siempre deben facturarse" |
| 10 | **No emitir factura** | "El SAT **no tiene suscrito convenio con ningún contribuyente, cámara o asociación** para la no emisión de facturas electrónicas" |

El mismo documento remata: "no expedir, no entregar o no poner a disposición de los clientes las facturas o expedirlas sin que cumplan los requisitos señalados por el SAT, se consideran infracciones que pueden llevar hasta la **clausura del establecimiento**".

Herramientas que el propio SAT sugiere y que a Likida le sirven:
- Validar RFC en línea, uno a uno o **masivamente hasta 5 mil registros**.
- Compartir la información fiscal **mediante el QR que genera la app Factura SAT Móvil** (Android e iOS). Esto elimina el dictado verbal del RFC en la gasolinera.

Existe también un artículo más viejo en gob.mx ("10 prácticas indebidas en la emisión de facturas", publicado 02-02-2018) con la misma idea en la #5: "No te pueden negar la factura si no la solicitas en el momento de tu compra. **Te la pueden emitir en cualquier momento del año.**"

### 6.3 Qué sanción hay de verdad

**Al emisor que no factura:**
- Infracción: **CFF 83, fr. VII** — no expedir, no entregar o no poner a disposición los CFDI; expedirlos sin requisitos; no entregar la representación impresa cuando el cliente la pide; no expedir los CFDI de operaciones con el público en general.
- **Ojo con el chapeau del art. 83:** son infracciones "**siempre que sean descubiertas en el ejercicio de las facultades de comprobación** o de las facultades previstas en el artículo 22". No es una multa que salga automáticamente de una denuncia.
- Sanción: **CFF 84, fr. IV, inciso a): de $22,300.00 a $127,530.00**, y **en caso de reincidencia, clausura preventiva del establecimiento de 3 a 15 días** (montos actualizados DOF 28-12-2025).
- Inciso b) para RESICO y régimen agropecuario: de $1,910.00 a $3,800.00 (reformado DOF 07-11-2025).
- Inciso d): de $450.00 a $670.00 **por cada CFDI emitido sin los complementos** que el SAT determine por reglas generales.

**Al tercero que asesora (esto es Likida):**
- **CFF 89**: son infracciones cuya responsabilidad recae sobre terceros, entre otras, "Asesorar, aconsejar o prestar servicios para omitir total o parcialmente el pago de alguna contribución en contravención a las disposiciones fiscales" (fr. I) y "Ser cómplice en cualquier forma no prevista, en la comisión de infracciones fiscales" (fr. III).
- **CFF 90**: multa de **$79,130.00 a $124,380.00** (actualizada DOF 28-12-2025). Y agravante del 10% al 20% de la contribución omitida si la asesoría es contraria a los criterios del 33, fr. I, inciso h) — o sea, contraria al Anexo 3.
- **Salida legal**: el CFF 89 último párrafo y el 90 dicen que no se incurre en la infracción/agravante si **se manifiesta por escrito** que el criterio de la opinión es distinto a los criterios del SAT, o que la asesoría puede ser contraria a la interpretación de las autoridades fiscales. Esto es una cláusula que Likida debería tener redactada.

**Canales de denuncia** (ficha 46/CFF, Anexo 2 RMF 2026):
- Correo: **denuncias@sat.gob.mx**
- Teléfono: 55 885 22 222 (desde el país) / +52 55 885 22 222 (exterior)
- MarcaSAT 55 627 22 728, opción 8
- Portal: sat.gob.mx/portal/public/tramites/quejas-o-denuncias

---

## 7. Conciliación de factura: el trámite real, con nombre y plazos

### 7.1 Fundamento

- **RMF 2026, regla 2.7.1.44 "Solicitud de conciliación de facturación"**, que invoca los artículos **29, primer párrafo y 29-A, cuarto, quinto y sexto párrafos del CFF**.
- **Ficha de trámite 46/CFF "Solicitud de conciliación de factura", contenida en el Anexo 2 de la RMF 2026** (publicado en el DOF el 29-12-2025; no modificado por la 1ª modificación del 17-07-2026).

*Nota de numeración: en RMF de años anteriores las fichas de trámite vivían en el **Anexo 1-A**. En la RMF 2026 el anexo de trámites fiscales es el **Anexo 2**.*

### 7.2 En qué seis casos procede (regla 2.7.1.44, primer párrafo)

| Fr. | Supuesto |
|---|---|
| I | **No le expiden el CFDI** a quien adquirió bienes, disfrutó su uso o goce, recibió servicios o le retuvieron contribuciones —**aunque ya lo haya solicitado**— o bien el CFDI **carece de algún requisito fiscal o tiene errores** en su contenido |
| II | Le **cancelan el CFDI de una operación existente sin motivo** y no se expide uno nuevo |
| III | Realiza el **pago de una factura y no recibe el CFDI de pagos** correspondiente |
| IV | Le emiten un **CFDI de nómina y no existe relación laboral** con el emisor |
| V | Le emiten un **CFDI de ingreso, egreso o pago donde no existe relación comercial** con el emisor |
| VI | **Requiere cancelar una factura y el receptor no la acepta**, aun cuando la cancelación sea procedente |

Para una flota, los que muerden son el **I** (la gasolinera no factura, o factura mal) y el **II** (le cancelaron el CFDI y no lo repusieron).

### 7.3 Cómo se levanta (ficha 46/CFF)

- **Quién:** personas físicas y morales.
- **Cuándo:** "Cuando lo requieras." No hay plazo de caducidad declarado en la ficha.
- **Dónde:** Portal del SAT → `https://www.sat.gob.mx/portal/public/tramites/factura-electronica` → Servicios de factura → Servicio de conciliación → Solicitud de conciliación de factura → Captura solicitud de conciliación de factura.
- **Costo: gratuito.**
- **Pasos:** capturar el formulario, aceptar el uso de datos personales, capturar el captcha, enviar.

**Datos que hay que tener a la mano:**

| Escenario | Datos requeridos |
|---|---|
| Pedir la **emisión** de una factura | RFC y/o nombre o razón social del **proveedor**, RFC del **solicitante**, **fecha de la operación** y **monto** del CFDI |
| Pedir **reexpedición**, **complemento de pago**, **cancelación de un comprobante no reconocido**, o ante la **negativa de aceptación** de una solicitud de cancelación | **RFC del emisor** y **RFC del receptor**, **fecha de emisión** del comprobante y **folio fiscal (UUID)** del CFDI de origen o del que se desea cancelar |

**Condición:** contar con un correo personal al que se tenga acceso, **y que ese correo no haya sido proporcionado por otro contribuyente**.

### 7.4 Plazos (ficha 46/CFF)

| Plazo | Duración |
|---|---|
| Plazo máximo para que el **SAT resuelva** | **6 días** |
| Plazo máximo para que el **SAT solicite información adicional** | dentro de los **6 días** |
| Plazo para que el contribuyente **cumpla con la información solicitada** | **2 días** después de recibido el correo de la autoridad |
| Vigencia del trámite | No aplica |

**Seguimiento:** con el número de folio de la solicitud, en el servicio "Consulta Solicitante" o "Consulta Solicitado". Con folio y contraseña que llegan por correo electrónico.
**Resultado:** "Mensaje de respuesta, en el que se informa sobre la atención a tu solicitud."
**¿Hay inspección o verificación del SAT?** La ficha dice: **No.**

### 7.5 Qué pasa del otro lado, y qué NO es este trámite

> **Cita textual, regla 2.7.1.44:** "El contribuyente proveedor del bien o servicio, el emisor del CFDI o, en su caso, el receptor del mismo, recibirá un mensaje **a través del buzón tributario o bien, del correo electrónico** que la autoridad tenga registrado en donde en calidad de **conciliadora y orientadora**, le informe de la situación que se reporte …, a efecto de **invitarle** a que subsane la omisión, cancele los CFDI, acepte la cancelación, reexpida el CFDI o bien, realice las aclaraciones correspondientes…"

> "La actuación de la autoridad fiscal respecto al servicio señalado en esta regla es con carácter de **conciliadora y orientadora** … y la aceptación de esta mediación, **será totalmente voluntaria para ambas partes, sin que constituya instancia, ni genere derechos u obligaciones distintas** a las establecidas en las disposiciones fiscales vigentes."

**Traducción sin rodeos:** la conciliación es una carta del SAT invitando al proveedor a portarse bien. **No lo obliga.** No es un recurso, no interrumpe plazos, no genera derechos. Su valor es de presión y de rastro documental. Likida no puede prometer que "el SAT te consigue la factura".

Lo que sí es útil: **deja constancia fechada de que el contribuyente solicitó el CFDI**. Frente a una revisión, eso ayuda a acreditar que se hizo lo que estaba en la mano.

---

## 8. El plazo real para pedir la factura — respuesta directa y con fundamento

Esta es la pregunta que había que aclarar. La respuesta tiene cuatro capas.

### Capa 1 — En el CFF no hay plazo para el comprador. Hay obligación inmediata para el vendedor.

> **CFF 29, primer párrafo:** "…los contribuyentes deberán emitirlos mediante documentos digitales … **Las personas que adquieran bienes, disfruten de su uso o goce temporal, reciban servicios, realicen pagos parciales o diferidos … deberán solicitar el comprobante fiscal digital por Internet respectivo**."

El CFF impone una obligación de solicitar, **sin plazo**. Y al vendedor le impone un plazo de **24 horas para remitirlo al SAT/PAC** desde que tuvo lugar la operación (RCFF 39). La postura del SAT en el criterio 1/CFF/PI es aún más estricta: debe expedirse **"en el mismo acto y lugar"**.

**Conclusión de esta capa: "ya pasó el mes" no tiene fundamento legal. El SAT lo cataloga expresamente como práctica indebida (documento oct-2023, #6).**

### Capa 2 — El plazo real viene del ISR: el mismo ejercicio fiscal

> **Cita textual, LISR 27, fr. XVIII:** "Que al realizar las operaciones correspondientes o a más tardar el último día del ejercicio se reúnan los requisitos que para cada deducción en particular establece esta Ley. **Tratándose del comprobante fiscal a que se refiere el primer párrafo de la fracción III de este artículo, éste se obtenga a más tardar el día en que el contribuyente deba presentar su declaración.** … Además, **la fecha de expedición de los comprobantes fiscales de un gasto deducible deberá corresponder al ejercicio por el que se efectúa la deducción.**"

Dos límites en un solo párrafo:

- **Límite A (de obtención):** hay que tener el CFDI **a más tardar el día en que se deba presentar la declaración anual** — 31 de marzo del año siguiente para personas morales (LISR 76, fr. V: tres meses siguientes al cierre); 30 de abril para personas físicas (LISR 150).
- **Límite B (de fecha de expedición), que es el que de verdad manda:** la **fecha de expedición** del CFDI **debe corresponder al ejercicio por el que se deduce**. Como la fecha del CFDI es la de expedición y no la de la operación (CFF 29-A, fr. III), **una factura de diésel comprado el 20-dic-2026 pero emitida el 5-ene-2027 no sirve para deducir en 2026** — su fecha de expedición es de 2027, ejercicio al que ese gasto no pertenece.

**El Límite B es la razón económica real detrás del "mismo año".**

### Capa 3 — La postura publicada del SAT coincide: mismo año

> **SAT, "Prácticas indebidas en la emisión de facturas", octubre 2023, práctica #6:** "Negar la factura al argumentar que no se solicitó en el momento de la transacción. **Se puede emitir con posterioridad, mientras sea en el mismo año en que se realizó la operación.**"

> **SAT, gob.mx, "10 prácticas indebidas en la emisión de facturas" (02-02-2018), #5:** "No te pueden negar la factura si no la solicitas en el momento de tu compra. **Te la pueden emitir en cualquier momento del año.**"

Dos publicaciones del SAT, siete años de diferencia, mismo criterio. Ninguna de las dos es norma publicada en DOF, pero son la posición institucional expresa.

### Capa 4 — Los límites técnicos del proveedor

- Para sacar la operación de una factura global, el campo **`Año`** del CFDI global rehecho debe ser **el año en curso o el inmediato anterior** (Guía de llenado del CFDI global v4.0). Fuera de esa ventana, el sistema no deja.
- El **plazo de cancelación** del CFDI corre hasta el mes de la declaración anual de ISR del ejercicio de expedición (CFF 29-A, cuarto párrafo, reformado DOF 07-11-2025). Después de eso el proveedor ya no puede cancelar la global ni reexpedirla — aunque sí puede emitir un CFDI de egreso, que no está sujeto a ese plazo.

### La respuesta de una línea, para el pitch

> **No hay plazo legal para pedir la factura; el proveedor está obligado a emitirla al momento de la operación y a timbrarla dentro de 24 horas (RCFF 39). Negarla porque "ya pasó el mes" es una práctica indebida publicada por el SAT. El límite real es el ejercicio fiscal: la fecha de expedición del CFDI debe corresponder al año por el que se deduce (LISR 27, fr. XVIII), y el CFDI debe estar en manos del contribuyente antes de la declaración anual.**

Y el corolario práctico que Likida debe internalizar: **el objetivo no es pelear en enero por una factura de diciembre. El objetivo es que el comprobante entre el mismo día.**

---

## 9. Cómo validar un CFDI de verdad (lo que Likida tiene que construir)

### 9.1 El web service público del SAT

Fuente primaria: SAT, *Documentación del Servicio de Consulta de CFDI, Versión 1.3* (noviembre 2020).

- **URL:** `https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc`
- **WSDL:** el mismo + `?wsdl`
- **Operación:** `Consulta(string expresionImpresa)`
- **Capacidad declarada:** "hasta **2 millones de consultas por hr.**", con la petición expresa de no rebasarla porque pega a bases transaccionales del SAT.

**Campos de respuesta (objeto `Acuse`):**

| Campo | Qué es |
|---|---|
| `CodigoEstatus` | S = obtenido satisfactoriamente; **N-601** = expresión impresa no válida; **N-602** = comprobante no encontrado en la base del SAT |
| `Estado` | Vigente / Cancelado |
| `EsCancelable` | Cancelable con aceptación, sin aceptación, o **No cancelable** |
| `EstatusCancelacion` | En qué punto del proceso de cancelación va |
| `ValidacionEFOS` | **Código 100** = el RFC emisor está en la lista de EFOS del 69-B |

**El mensaje que el propio SAT indica desplegar cuando `ValidacionEFOS` = 100:**
> "El emisor de la factura verificada, se encuentra publicado en la lista de empresas que facturan operaciones simuladas de conformidad con los párrafos primero al quinto del Artículo 69-B del CFF. … de conformidad con lo dispuesto por el octavo párrafo del artículo 69-B del CFF, si eres el receptor del comprobante consultado y le has dado efectos fiscales, cuentas con **30 días** contados a partir de la fecha de publicación en la lista, para comprobar ante el SAT la realización de las operaciones … o bien puedes en el mismo plazo, corregir tu situación fiscal mediante la presentación de las declaraciones complementarias…"

**Listas que hay que vigilar:**
- Lista definitiva del 69-B: `http://omawww.sat.gob.mx/cifras_sat/Paginas/datos/vinculo.html?page=ListCompleta69B.html`
- Consulta de contribuyentes que realizan operaciones inexistentes: `https://www.sat.gob.mx/consultas/76675/...`
- **Nueva desde 2026:** la lista de contribuyentes que emiten falsos comprobantes del **49 Bis**, publicada en el Portal del SAT **y en el DOF**, con reloj de **30 días naturales** para revertir.

### 9.2 Verificación del emisor de combustible

Con la reforma 2026, un CFDI de diésel debe traer el **número de permiso vigente de la Comisión Nacional de Energía** (CFF 29-A, fr. V, inciso f). Complementariamente, la LISR 27 fr. III exige desde 2021 que en el comprobante "conste la información del permiso vigente, expedido en los términos de la Ley de Hidrocarburos al proveedor del combustible **y que, en su caso, dicho permiso no se encuentre suspendido**, al momento de la expedición del comprobante fiscal".

El SAT publica el **Listado de la Comisión Nacional de Energía (L_CNE)** dentro del **Anexo 29** de la RMF; los PAC están obligados a resguardarlo tres meses (regla 2.7.2.8, fr. XXIV) y a validar contra el Anexo 29 antes de timbrar (regla 2.7.2.9, fr. VII).

*Nota terminológica:* la **Comisión Nacional de Energía (CNE)** sustituyó a la **Comisión Reguladora de Energía (CRE)**. El Transitorio Tercero del Decreto del 07-11-2025 dice que "en las referencias a la Comisión Nacional de Energía previstas en el presente Decreto, se incluye a la Comisión Reguladora de Energía", conforme al Tercero Transitorio de la Ley de la CNE (DOF 18-03-2025). Permisos viejos con nomenclatura CRE siguen siendo válidos.

### 9.3 Buzón tributario: obligación y riesgo

**CFF 17-K:** toda persona física y moral inscrita en el RFC tiene buzón tributario. Deben **consultarlo dentro de los tres días siguientes** a recibir el aviso electrónico, y deben **habilitarlo y mantener actualizados los medios de contacto**. Si no lo habilitan, señalan medios erróneos o no los actualizan, **"se entenderá que se opone a la notificación"** y el SAT notifica por estrados (134, fr. III).

Cruzando esto con la regla 2.7.1.34 (3 días para aceptar/rechazar una cancelación, silencio = aceptación), el resultado es que **una flota con el buzón desatendido pierde CFDI por omisión y ni se entera.**

---

## 10. Qué cambió en 2026 respecto a años previos

| Tema | Antes (2022–2025) | Ahora (desde 01-01-2026) | Fundamento |
|---|---|---|---|
| Veracidad de la operación | No era requisito expreso del 29-A | **Requisito expreso (fr. IX)**; su incumplimiento hace al CFDI **falso** por definición legal | CFF 29-A fr. IX, DOF 07-11-2025 |
| Determinación por falsedad | Había que agotar procedimientos | La autoridad **puede determinar directamente** sin agotar el 49 Bis | CFF 29-A Bis, DOF 07-11-2025 |
| Procedimiento contra falsos comprobantes | 69-B (largo) | **49 Bis**: visita domiciliaria exprés, **24 días hábiles**, suspende la emisión desde la orden, publicación en DOF, **30 días naturales** para que los receptores reviertan o les restringen el CSD | CFF 49 Bis, DOF 07-11-2025 |
| Plazo de cancelación de CFDI | "en el ejercicio en el que se expidan" | **hasta el mes de la declaración anual del ISR** del ejercicio de expedición | CFF 29-A cuarto párrafo, DOF 07-11-2025 |
| CFDI de combustible | El permiso era requisito de **deducibilidad** (LISR 27 fr. III desde 2021) | Además es **requisito del comprobante**: número de permiso vigente de la CNE | CFF 29-A fr. V inciso f), DOF 07-11-2025 |
| Multa por no expedir CFDI (RESICO/sector primario) | Monto anterior | Reformado el inciso b) del 84 fr. IV | CFF 84 fr. IV b), DOF 07-11-2025 |
| Delito de comprobantes falsos | 113 Bis | Reforzado; se agregó el **115 Ter** y se sanciona a plataformas que publiquen anuncios de compraventa de comprobantes falsos (CFF 89 fr. IV) | DOF 07-11-2025 |
| Requisito para ser PAC | — | No haber sido declarado emisor de falsos comprobantes conforme al 49 Bis | RMF 2026, 2.7.2.8 fr. XXV |
| Numeración de trámites | Fichas en **Anexo 1-A** | Fichas en **Anexo 2** | RMF 2026 |
| Numeración de la factura global | 2.7.1.24 (hasta RMF 2021) | **2.7.1.21** (desde RMF 2022, incluida la 2026) | RMF 2026 |

Vigencia: el Decreto entró en vigor el **1 de enero de 2026**, salvo el art. 30-B (acceso en línea del SAT a plataformas de servicios digitales), que entró el **1 de abril de 2026**. Transitorio Segundo: "Los procedimientos iniciados con anterioridad … deberán substanciarse y resolverse en términos de las disposiciones vigentes en la fecha en que iniciaron."

---

## Qué cambia esto en Likida

### Lo que hay que construir

1. **Ingesta del XML, no solo de la foto.** La foto es el disparador de la conversación por WhatsApp; el XML es el entregable. Diseñar el flujo con dos estados: `comprobante_recibido` (foto/ticket) y `cfdi_validado` (XML timbrado y verificado). Fundamento: CFF 29 fr. V — la representación impresa "únicamente presume".
2. **Validador contra el web service del SAT en cada CFDI.** `consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc`. Guardar `Estado`, `EsCancelable`, `EstatusCancelacion` y `ValidacionEFOS`. Es gratis, aguanta 2 millones de consultas/hora y trae la alerta de EFOS de regalo.
3. **Motor de requisitos del 29-A por tipo de gasto.** Reglas duras, no heurísticas:
   - **Diésel:** RFC receptor ≠ XAXX010101000; **número de permiso vigente de la CNE presente** (29-A fr. V f); `ClaveProdServ` 15101505; `FormaPago` distinta de "01 Efectivo" (si es efectivo, **marcar el gasto como no deducible** por LISR 27 fr. III, aunque la factura sea perfecta); IVA e IEPS desglosados.
   - **Casetas:** `ClaveProdServ` de peaje; RFC del receptor correcto.
   - **Viáticos:** RFC receptor correcto; `UsoCFDI` congruente; verificar que no venga con genérico.
   - Para todos: `Fecha` de expedición **dentro del ejercicio en curso** (LISR 27 fr. XVIII) — si cruza de año, alerta roja.
4. **Vigilancia del buzón tributario del cliente.** Alertar cuando entra una solicitud de cancelación: quedan **3 días** y el silencio es aceptación (RMF 2.7.1.34). Esta es probablemente la funcionalidad de mayor ROI defendible del producto: un CFDI aceptado en silencio es un gasto perdido, y hoy nadie lo mira.
5. **Monitor de listas negras.** 69-B (EFOS) + la nueva lista del **49 Bis** publicada en el DOF. Cruzar contra los RFC de los proveedores recurrentes de la flota. El reloj de **30 días naturales** desde la publicación en el DOF es un evento cronometrable.
6. **Reconciliación entre el gasto y el CFDI.** El CFDI viene fechado por expedición, no por operación. Likida ya tiene la fecha real de la operación (el ticket, la geolocalización, el viaje). Es el único que puede cuadrar "compra del 20-dic" contra "CFDI del 5-ene" y gritar antes de que sea tarde.
7. **Generador de la Solicitud de conciliación de factura (ficha 46/CFF).** Prellenar el trámite con los datos que Likida ya tiene: RFC del proveedor, RFC del solicitante, fecha de la operación, monto, UUID. Es gratis, el SAT resuelve en 6 días, y deja constancia fechada de que la flota sí pidió la factura.
8. **Buzón de recepción de XML a nombre del cliente.** La regla 2.7.1.33 fr. IV permite explícitamente que el proveedor entregue el XML en "una cuenta de almacenamiento de datos en Internet o de almacenamiento de datos en una nube en Internet, **designada al efecto por el cliente**". Likida puede ser esa nube, con fundamento citado.
9. **Tarjeta de datos fiscales por QR para el operador.** El SAT sugiere compartir la información fiscal vía el QR de Factura SAT Móvil. Likida puede generar el equivalente para que el operador muestre el celular en la caja y no dicte el RFC.

### Lo que hay que dejar de prometer

- **"Likida te consigue la factura que el comercio te negó."** No. La conciliación es voluntaria para ambas partes, "sin que constituya instancia, ni genere derechos u obligaciones distintas" (RMF 2.7.1.44, último párrafo). Lo que Likida sí puede prometer es que **levanta el trámite, con evidencia y a tiempo**.
- **"Tienes X días para pedir tu factura."** No hay tal plazo. Decir un número inventado es exactamente el tipo de afirmación fiscal que le cuesta dinero a un cliente.
- **"El SAT multa al que no te factura."** Solo si la infracción se descubre **en el ejercicio de facultades de comprobación** (chapeau del art. 83). Una denuncia no dispara una multa automática.
- **"Con la factura correcta tu gasto es deducible."** Falso para el diésel pagado en efectivo (LISR 27 fr. III). Likida debe decirlo antes, no después.

### La corrección de contenido que hay que hacer ya

- Todo material que cite **"RMF 2.7.1.24"** para factura global debe decir **"RMF 2026, regla 2.7.1.21"**. La 2.7.1.24 vigente trata de devolución de IVA a turistas extranjeros.
- Todo material que diga que para facturar después hay que **cancelar la global** debe agregar el **Camino B** (CFDI de egreso, Apéndice 2 fracción III de la Guía del CFDI global, vigente desde marzo de 2023) y, para gasolineras, decir que **cancelar está prohibido** y el egreso es la única vía (Apéndice 3).

### El riesgo legal propio que hay que cubrir

Los criterios 1/CFF/PI y 3/CFF/PI del Anexo 3 sancionan a "**quien asesore, aconseje, preste servicios o participe** en la realización o implementación" de las prácticas indebidas. Likida presta servicios en ese proceso. Multa de $79,130 a $124,380 (CFF 90), con agravante si la asesoría contradice los criterios del SAT.

**Mitigación disponible en la propia ley** (CFF 89 último párrafo y CFF 90): no se incurre en la infracción ni en la agravante cuando se manifiesta **por escrito** que el criterio de la opinión es distinto a los criterios dados a conocer por el SAT, o que la asesoría puede ser contraria a la interpretación de las autoridades fiscales. Likida debería tener esa leyenda en los términos de servicio y en cualquier salida del producto que sugiera un tratamiento fiscal.

---

## SIN VERIFICAR

Lo que no se pudo comprobar en fuente primaria en esta investigación:

1. **Fecha exacta de obligatoriedad exclusiva del CFDI 4.0.** El dato de que la convivencia con la versión 3.3 terminó el 31-mar-2023 y que desde el 1-abr-2023 el 4.0 es la única versión timbrable proviene de fuentes secundarias (despachos, blogs de PAC). No se localizó el transitorio del DOF que lo establece. **SIN VERIFICAR.** Lo que sí está verificado: el Anexo 20 vigente es el 4.0 y el SAT sigue publicando el catálogo 3.3 como histórico.
2. **Contenido íntegro de la regla 2.7.7.1.6 de la RMF 2026** ("Cancelación de CFDI de tipo traslado con complemento Carta Porte, cuando se traslada..."). Se verificó su existencia, su ubicación y que invoca el CFF 29-A cuarto párrafo, pero no se transcribió su texto completo. **PENDIENTE de lectura íntegra.**
3. **Actualizaciones de catálogos del CFDI 4.0 durante 2026.** Fuentes secundarias reportan una actualización de catálogos el 1-ene-2026 (847 nuevas claves de `c_ClaveProdServ`, tres nuevos regímenes fiscales del sector primario, milígramos de nicotina, tasas de IEPS a seis decimales, validación más estricta del nodo `InformacionGlobal`) y otra el 2-mar-2026 (`c_NumPedimentoAduana`). **NO se verificó en fuente primaria del SAT.** Antes de codificar validaciones contra catálogos, hay que descargar los XLS oficiales del portal del Anexo 20 y diffearlos.
4. **Versión más reciente del documento "Prácticas indebidas en la emisión de facturas".** La única versión localizada en sat.gob.mx es la de **octubre 2023**. Notas de prensa de agosto y diciembre de 2024 sugieren republicaciones, pero no se localizó un PDF del SAT posterior a octubre 2023. **SIN VERIFICAR** si existe una versión 2025 o 2026.
5. **Si el nuevo plazo de cancelación aplica retroactivamente a CFDI expedidos en 2025.** El Transitorio Segundo del Decreto (DOF 07-11-2025) habla de "procedimientos iniciados", no de comprobantes. La lectura literal del 29-A vigente sugiere que el plazo se calcula respecto del ejercicio en que se expidió el comprobante, sea cual sea; pero **no se localizó una regla miscelánea ni un criterio del SAT que lo aclare**. Consultar con fiscalista antes de afirmar cualquier cosa a un cliente.
6. **Prórrogas o facilidades específicas para autotransporte en materia de CFDI.** Existe una Resolución de Facilidades Administrativas (RFA 2026) para sectores específicos, incluido autotransporte de carga federal. **No se revisó en esta investigación**; corresponde al bloque de Carta Porte / autotransporte. Puede contener facilidades de comprobación de gastos que cambien materialmente el producto (por ejemplo, deducción sin CFDI de un porcentaje de ingresos).
7. **Cómo se comporta en la práctica el servicio de conciliación.** La ficha 46/CFF declara 6 días de resolución. **No se verificó** con datos reales de cuánto tarda ni con qué tasa de éxito. Antes de venderlo como feature, conviene levantar 5 o 10 solicitudes reales y medir.
8. **Formato exacto de la `expresionImpresa`** que consume el web service (la cadena `?id=&re=&rr=&tt=&fe=`). La documentación v1.3 del SAT define el contrato SOAP pero el formato de la cadena está en el rubro I.D del Anexo 20, que no se leyó en esta investigación. **PENDIENTE** antes de implementar.

---

## Fuentes

### Primarias — leyes y reglamentos (Cámara de Diputados)

- Código Fiscal de la Federación, última reforma DOF 09-04-2026 — https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf
- Reglamento del Código Fiscal de la Federación, DOF 02-04-2014 — https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_CFF.pdf
- Ley del Impuesto sobre la Renta, última reforma DOF 01-04-2024 — https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf
- Ley del Impuesto al Valor Agregado, última reforma DOF 12-11-2021 — https://www.diputados.gob.mx/LeyesBiblio/pdf/LIVA.pdf
- DECRETO por el que se reforman, adicionan y derogan diversas disposiciones del Código Fiscal de la Federación, DOF 07-11-2025 (Edición Vespertina) — https://www.diputados.gob.mx/LeyesBiblio/ref/cff/CFF_ref62_07nov25.pdf
- Nota DOF del decreto — https://www.dof.gob.mx/nota_detalle.php?codigo=5772358&fecha=07/11/2025
- Historial de reformas al CFF — https://www.diputados.gob.mx/LeyesBiblio/ref/cff.htm

### Primarias — Resolución Miscelánea Fiscal 2026 y anexos (SAT / DOF)

- Resolución Miscelánea Fiscal para 2026, DOF 28-12-2025 — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/RMF_2026-DOF-28122025.pdf
- Nota DOF de la RMF 2026 — https://dof.gob.mx/nota_detalle.php?codigo=5777217&fecha=28/12/2025
- Primera Resolución de Modificaciones a la RMF 2026, DOF 09-07-2026 — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/1aRM_RMF2026.pdf
- Anexo 2 de la RMF 2026 (Trámites Fiscales — ficha 46/CFF), DOF 29-12-2025 — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo-2-RMF-2026_DOF-28122025.pdf
- Primera Modificación al Anexo 2 de la RMF 2026, DOF 17-07-2026 — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Primera-Modificacion-Anexo-2-DOF-17072026.pdf
- Anexo 3 de la RMF 2026 (Compilación de criterios sobre prácticas fiscales indebidas), DOF 09-01-2026 — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo_3_RMF2026-09012026.pdf
- Portal de normatividad RMF/RGCE 2026 del SAT — https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2026.html

### Primarias — documentación técnica del SAT

- Anexo 20 — Guía de llenado de los comprobantes fiscales digitales por Internet (rev. 08-03-2023) — http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Anexo_20_Guia_de_llenado_CFDI.pdf
- Guía de llenado del CFDI global, versión 4.0 del CFDI (pub. 31-12-2021, rev. 08-03-2023) — http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Guia_llenado_CFDI_%20global.pdf
- Página del Anexo 20 (catálogos, estándar, matriz de errores) — http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20_version3-3.htm
- Documentación del Servicio de Consulta de CFDI, versión 1.3 (nov. 2020) — https://www.sat.gob.mx/minisitio/Factura/documentos/cancelacion/consulta_cfdi.pdf
- Preguntas frecuentes y escenarios de cancelación conforme a la Reforma Fiscal 2022 (mayo 2022) — https://www.sat.gob.mx/cs/Satellite?blobcol=urldata&blobkey=id&blobtable=MungoBlobs&blobwhere=1461176211410&ssbinary=true

### Primarias — publicaciones del SAT sobre prácticas indebidas

- Prácticas indebidas en la emisión de facturas, octubre 2023 (PDF del SAT) — https://www.sat.gob.mx/cs/Satellite?blobcol=urldata&blobkey=id&blobtable=MungoBlobs&blobwhere=1461175773449&ssbinary=true
- Conoce las prácticas indebidas en la emisión de facturas (minisitio Factura) — https://www.sat.gob.mx/minisitio/Factura/solicita_consideraciones.htm
- 10 prácticas indebidas en la emisión de facturas (gob.mx, 02-02-2018) — https://www.gob.mx/sat/articulos/10-practicas-indebidas-en-la-emision-de-facturas
- Comunicado 057/2023: SAT alerta sobre prácticas fiscales indebidas al solicitar una factura (18-10-2023) — https://www.gob.mx/sat/prensa/sat-alerta-sobre-practicas-fiscales-indebidas-al-solicitar-una-factura-057-2023
- Conciliación de factura (minisitio Factura) — https://www.sat.gob.mx/minisitio/Factura/conciliacion_factura.htm
- Solicitudes de conciliación de factura (aplicación) — https://www.sat.gob.mx/aplicacion/87088/solicitudes-por-la-no-emision-de-factura

### Servicios y listas del SAT que Likida debe consumir

- Web service de consulta de CFDI — https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc
- Portal de facturas emitidas y recibidas — https://portalcfdi.facturaelectronica.sat.gob.mx/
- Lista completa 69-B (EFOS definitivos) — http://omawww.sat.gob.mx/cifras_sat/Paginas/datos/vinculo.html?page=ListCompleta69B.html
- Consulta de contribuyentes que realizan operaciones inexistentes — https://www.sat.gob.mx/consultas/76675/consulta-la-relacion-de-contribuyentes-que-realizan-operaciones-inexistentes
- Validación de RFC (uno a uno o masiva hasta 5 mil registros) — https://www.sat.gob.mx/aplicacion/operacion/79615/valida-en-linea-rfc%C2%B4s-uno-a-uno-o-de-manera-masiva-hasta-5-mil-registros
- Trámite de conciliación (punto de entrada) — https://www.sat.gob.mx/portal/public/tramites/factura-electronica

### Secundarias (solo como pista; no se usaron como fundamento)

- Holland & Knight, "Reforma Fiscal para 2026 en México" (nov. 2025) — https://www.hklaw.com/en/insights/publications/2025/11/reforma-fiscal-para-2026-en-mexico
- PwC México, "Resolución Miscelánea Fiscal (RMF) 2026" — https://www.pwc.com/mx/es/impuestos/novedades-fiscales/resolucion-miscelanea-fiscal-rmf-2026.html
- Comunicación Social, Cámara de Diputados, nota sobre la publicación del decreto del CFF — https://comunicacionsocial.diputados.gob.mx/index.php/notilegis/dof-publica-el-decreto-por-el-que-se-reforman-adicionan-y-derogan-diversas-disposiciones-del-codigo-fiscal-de-la-federacion
