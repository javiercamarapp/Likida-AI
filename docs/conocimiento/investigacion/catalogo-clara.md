# Catálogo de facturación de Clara Intelligence — cosechado el 29-jul-2026

> **ESTO NO ES FUENTE DE VERDAD.** Son los datos que publica un COMPETIDOR
> (`recuperafacturas.com`, de Clara Intelligence) en sus 86 landings de SEO.
> Se cosechó para saber qué saben ellos, no para copiarlo al catálogo.
>
> **Ya sabemos que su dato falla.** El mismo día que se cosechó esto habíamos
> facturado un ticket real de G500: el portal que ellos publican no es donde se
> factura (`g500network.com` contra el real `megasur.com.mx:8029`), y el plazo
> que da su índice —"3 días"— no es el que imprime el ticket ("mes de emisión").
>
> Úsalo como PISTA DE INVESTIGACIÓN. Cada ficha que entre a
> `src/lib/cuadra/facturacion/comercios.ts` tiene que verificarse facturando de
> verdad, como se hizo con G500. Ver `plazoVerificado` en ese archivo.


## Qué hay

- **86 comercios** con ficha estructurada (portal, plazo, datos, si requiere cuenta).
- **344 pasos** de proceso manual descritos.
- **257 preguntas frecuentes** y **269 menciones fiscales**.
- **65 NO requieren cuenta** (75%) · **21 sí la requieren**.

El JSON crudo, para consumo programático: `comercios-clara.json`.


## LO QUE MÁS IMPORTA: quién NO pide cuenta

Es la lista de comercios que un agente puede facturar solo, sin custodiar
credenciales de nadie. Es la cuña del producto.

| Comercio | Portal | Plazo | Datos que pide |
|---|---|---|---|
| 3b | https://www.tiendas3b.com.mx/facturacion | Mismo mes calendario de la compra | Folio de transacción, Monto total, Fecha de compra, Datos  |
| 50-friends | https://50friends.pv1.mx/factura | 30 días naturales desde el consumo | Número de folio del ticket, Fecha del consumo, RFC del rec |
| 7-eleven | https://7-eleven.com.mx/facturacion-electronica | Mismo mes calendario de la compra | Folio fiscal del ticket, ID de la tienda, Monto total, Fec |
| ado | https://www.ado.com.mx/ | Mismo mes calendario del viaje | Número de boleto o folio, Fecha del viaje, RFC del recepto |
| aeromexico | https://aeromexico.com/es-mx/facturacion | 30 días naturales desde la emisión del | Número de boleto (139-XXXXXXXXXX), Apellido del pasajero p |
| alsea | https://alsea.interfactura.com/ | Mismo mes calendario del consumo | Folio del ticket, Marca o cadena, Fecha del consumo, RFC d |
| autozone | https://www.autozone.com.mx/factura-electronica | 30 días naturales desde la fecha de co | Número de folio de transacción, Fecha de compra, Monto tot |
| ben-and-frank | https://www.benandfrank.com/invoice/c66auu90q2g16804 | 30 días naturales desde la fecha de co | Número de orden de compra, Fecha de compra, RFC del recept |
| benavides | https://e-facturate.com/benavides/ | Mismo mes calendario de la compra | Número de referencia, RFC del receptor, Razón social, Códi |
| bodega-aurrera | https://facturacion.walmartmexico.com.mx/ | 30 días naturales desde la fecha de co | TC (Terminal de Caja), TR (Transacción), TD (Terminal Disp |
| burger-king | https://alsea.interfactura.com/ | Mismo mes calendario del consumo | Número de ticket, Número de tienda, Fecha de compra, Total |
| caffenio | https://facturaciondrive.caffenio.com/ | 30 días naturales desde la fecha de co | Folio de transacción, Código de facturación, RFC del recep |
| capufe | https://capufe.gob.mx/ | 30 días naturales desde la fecha del c | Folio de transacción, Fecha del cruce, Monto del peaje, RF |
| carls-jr | https://facturacion.carlsjrmso.com/ | Mismo mes calendario del pedido | Folio del ticket, Número de tienda, Fecha de compra |
| casa-de-tono | https://lacasadetono.mx/ | Mismo mes calendario del consumo | Folio del ticket, Número de sucursal, Fecha de consumo |
| chedraui | https://michedraui.com.mx/content/bill | Hasta 30 días naturales desde la compr | Folio del ticket, Número de tienda, Número de caja, Import |
| cinepolis | https://cinepolis.com/facturacion | Mismo mes calendario de la función | Número de folio o de orden, Fecha de la función, Complejo  |
| circle-k | https://facturacion.circlekmexico.com.mx/ | Mismo mes calendario de la compra | Folio de transacción, Número de tienda, Monto total, Fecha |
| city-market | https://www.citymarket.com.mx/facturacion | Mismo mes calendario de la compra | Folio de transacción, Número de tienda, Monto total, Datos |
| comex | https://www.comex.com.mx/factura | 30 días naturales desde la compra | Folio del ticket, Fecha de compra, Monto total, Uso del CF |
| coppel | https://facturas.coppel.com/ | Mismo mes calendario de la compra | Folio del ticket, Fecha de compra, Monto total, Datos fisc |
| dairy-queen-mexico | https://facturacion.dequ.mx/ | Mismo mes calendario del consumo | Folio del ticket, Número de tienda, Fecha de compra |
| dominos | https://alsea.interfactura.com/RegistroDocumento.asp | Mismo mes calendario del pedido | Folio del ticket o número de pedido, Fecha del pedido, Mon |
| farmacia-del-ahorro | https://www.fahorro.com/facturacion | Mismo mes calendario de la compra | Folio fiscal del ticket, Número de tienda, Monto total, Da |
| farmacias-guadalajara | https://www.farmaciasguadalajara.com.mx/facturacion | Mismo mes calendario de la compra | Folio del ticket, Número de tienda, Monto total, Forma de  |
| farmacias-san-pablo | https://www.sanpablo.com.mx/facturacion | Mismo mes calendario de la compra | Folio del ticket, Número de tienda, Monto total, Forma de  |
| farmacias-similares | https://facturacion.gpupm.com/simifactura/portal/ | Mismo mes calendario de la compra | Folio del ticket, Fecha de compra, RFC del receptor, Razón |
| g500 | https://g500network.com/facturacion-en-linea/ | Varía por estación; factura el mismo d | Nombre de la estación y permiso CRE, Folio del ticket, RFC |
| gasolineras | — | 24 a 72 horas tras la carga | Número de permiso CRE, Folio del ticket, Número de estació |
| heb | https://www.heb.com.mx/facturacion | Mismo mes calendario de la compra | Folio de transacción, Monto total, Fecha de compra, Datos  |
| home-depot | https://homedepot.com.mx/facturaweb | Hasta 30 días naturales desde la compr | Folio fiscal, Número de tienda, Número de operación, Monto |
| ikea | https://v2.dito.com.mx/Dito.Web/IkeaSelfIssue/Consul | 30 días naturales desde la fecha de co | Número de ticket u orden, Fecha de compra, RFC del recepto |
| italiannis | https://alsea.interfactura.com/RegistroDocumento.asp | Mismo mes calendario del consumo | Folio del ticket, Fecha del consumo, RFC del receptor, Raz |
| kfc | https://kfc.teagradece.mx/facturacion | Mismo mes calendario del pedido | Número de folio del ticket, Fecha del pedido, RFC del rece |
| krispy-kreme | https://facturacion.krispykreme.com.mx/ | Mismo mes calendario de la compra | Número de folio del ticket, Fecha de compra, RFC del recep |
| la-comer | https://www.lacomer.com.mx/facturacion | Mismo mes calendario de la compra | Folio de transacción, Fecha de compra, RFC del receptor, R |
| laboratorio-chopo | https://www.chopo.com.mx/factura | 30 días naturales desde la fecha del s | Número de orden, Fecha del servicio, RFC del receptor, Raz |
| little-caesars | https://facturacion.littlecaesars.com.mx/ | Mismo mes calendario de la compra | Folio de orden, Número de tienda, Monto total, Forma de pa |
| liverpool | https://facturacionclientes.liverpool.com.mx/ | Hasta 30 días naturales desde la compr | Folio fiscal, Monto total, Fecha de compra, RFC del recept |
| mcdonalds | https://www.facturacionmcdonalds.com.mx/ | Mismo mes calendario del consumo | Número de restaurante, Número de ticket, Número de caja, F |
| mobil | https://www.mobil.com.mx/es-mx/gasolina/facturacion | Varía por operador; factura el mismo d | Operador de la estación, Número de ticket o folio, Estació |
| nutrisa | — | Mismo mes calendario del consumo | Folio del ticket, Número de sucursal, Fecha de compra |
| office-depot | https://facturacion.officedepot.com.mx/ | Hasta 30 días naturales desde la compr | Folio del ticket, Número de tienda, Monto total, Datos fis |
| officemax | https://facturacion.officemax.com.mx/ | 30 días naturales desde la fecha de co | Número de transacción, Fecha de compra, RFC del receptor,  |
| opticas-devlyn | https://posap.devlyn.me/facturacionWeb/ | Mismo mes calendario de la compra | Folio del ticket, Fecha de compra, Monto total, Prescripci |
| opticas-lux | https://lux.mx/pages/facturacion | Mismo mes calendario de la compra | Número de folio del comprobante, Fecha de compra, RFC del  |
| oxxo | https://www4.oxxo.com:9443/facturacionElectronica-we | 7 días naturales desde la compra | Folio web (ID Web), Monto total, Fecha de compra, RFC del  |
| oxxo-gas | https://facturacion.oxxogas.com/ | Mismo mes calendario de la carga | Folio de transacción, Fecha de carga, Monto total, Forma d |
| palacio-de-hierro | https://facturacion.elpalaciodehierro.com/ | Mismo mes calendario de la compra | Número de transacción, Número de tienda, Monto total, Form |
| pastelerias-esperanza | https://cfdi.esperanza.mx/ | Mismo mes calendario de la compra | Folio del ticket, Fecha de compra, RFC del receptor, Razón |
| pastelerias-marisa | https://facturacion.simang8.com/marisa | Mismo mes calendario de la compra | Folio del ticket, Número de sucursal, Fecha de compra, Mon |
| pemex | — | 72 horas tras la carga (varía por esta | Número de permiso CRE, Folio del ticket, Número de estació |
| pf-changs | https://alsea.interfactura.com/RegistroDocumento.asp | Mismo mes calendario del consumo | Folio del ticket, Fecha del consumo, RFC del receptor, Raz |
| primera-plus | https://www.facturaelectronicagfa.mx/ | Mismo mes calendario del viaje | Número de boleto o folio, Fecha del viaje, RFC del recepto |
| salud-digna | — | 30 días naturales desde la fecha del s | Número de orden, Fecha del servicio, RFC del receptor, Raz |
| sears | https://facturaelectronica.sears.com.mx/ | Hasta el día 5 del mes siguiente | Número de tienda, Número de operación, Número de caja, Mon |
| shell | https://facturacion.shell.com.mx/ | 72 horas tras la carga (varía por esta | Permiso CRE de la estación, Folio del ticket, Número de es |
| sodimac | https://www.sodimac.com.mx/sodimac-mx/content/factur | 30 días naturales desde la fecha de co | Número de transacción, Fecha de compra, RFC del receptor,  |
| soriana | https://www.soriana.com/facturacionelectronica/factu | Hasta 30 días naturales desde la compr | Folio fiscal del ticket, Número de tienda, Número de caja, |
| starbucks | https://facturacion.starbucks.com.mx/ | Mismo mes calendario de la compra | Folio de transacción, Número de tienda, Monto total, Forma |
| subway | https://facturacion.subway.com.mx/ | Mismo mes calendario del pedido | Folio del ticket, Número de sucursal, Fecha de compra |
| tim-hortons | https://timhortonsmx.com/es/facturar/new.html | Mismo mes calendario del consumo | Folio del ticket, Número de tienda, Fecha y hora del consu |
| vips-sanborns-toks | — | Mismo mes calendario del consumo | Folio del ticket, Número de sucursal, Monto del consumo (s |
| walmart | https://facturacion.walmartmexico.com.mx/ | Hasta 30 días naturales desde la compr | TC – Transacción, TR – Terminal, TD – Tienda, CR – Caja |
| zara | https://www.zara.com/mx/es/facturacion-c700094.html | Mismo mes calendario de la compra | Número de ticket o pedido, Tienda o canal de compra, Fecha |

## Los que SÍ piden cuenta

Aquí la automatización directa no procede sin credenciales del cliente. El
camino es el asistido: preparar todo y que el humano dé el último clic.

| Comercio | Qué cuenta pide | Portal |
|---|---|---|
| amazon | Requiere cuenta de Amazon.com.mx | https://www.amazon.com.mx/ |
| bp | Opcional; se puede facturar sin usuario con solo un correo | https://www.bp.com/es_mx/mexico/home/products-and-se |
| costco | Requiere membresía Costco vigente (número de socio en ticket | https://www.costco.com.mx/facturas |
| dhl | Requiere inicio de sesión en portal DHL | https://www.dhl.com/mx-es/home/inicio-de-sesion.html |
| didi | Requiere cuenta de DiDi activa | — |
| estafeta | Solo requiere número de guía (no cuenta) | https://www.estafeta.com/FACTURACION |
| fedex | Solo requiere número de guía (no cuenta) | https://www.fedex.com/es-mx/billing.html |
| iave | Requiere número de tag IAVE para factura consolidada | https://iave.capufe.gob.mx/ |
| izzi | Requiere número de cuenta Izzi | https://www.izzi.mx/facturacion |
| mercado-libre | Requiere cuenta de Mercado Libre activa | https://www.mercadolibre.com.mx/l/facturacion |
| netflix | Requiere cuenta de Netflix activa | https://www.netflix.com/account |
| panaderia-el-globo | Depende de la sucursal | — |
| rappi | Requiere cuenta de Rappi activa | https://www.rappi.com.mx/ |
| sams-club | Requiere membresía Sam's Club vigente | https://facturacion.walmartmexico.com.mx/ |
| spotify | Requiere cuenta de Spotify activa | https://www.spotify.com/mx/account/overview/ |
| tag-pase | Requiere número de tag TAG PASE | https://www.pase.com.mx/facturacion/facturacion-pase |
| telcel | Requiere número de línea Telcel o inicio de sesión en mitelc | https://mitelcel.com/ |
| televia | Requiere número de tag TeleVía | https://www.televia.com.mx/tag-televia/facturacion |
| uber | Requiere cuenta de Uber activa | https://riders.uber.com/ |
| viva-aerobus | Solo requiere código de reservación (PNR) | https://www.vivaaerobus.com/mx/facturacion |
| volaris | Solo requiere código de reservación (PNR); no cuenta | https://factura.volaris.com/ |

---

## Ficha por comercio, con el proceso manual


### 3b
*Factura tu ticket de Tiendas 3B en minutos*

- **Portal:** https://www.tiendas3b.com.mx/facturacion
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio de transacción, Monto total, Fecha de compra, Datos fiscales
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto clara de tu ticket de Tiendas 3B donde se vea el folio, el total y la fecha.
2. Envía la foto por WhatsApp a Clara Intelligence.
3. Nuestro sistema identifica automáticamente el ticket y extrae los datos necesarios.
4. Recibe tu factura CFDI en PDF y XML válida ante el SAT.

### 50-friends
*Factura tus consumos en 50 Friends*

- **Portal:** https://50friends.pv1.mx/factura
- **Plazo:** 30 días naturales desde el consumo
- **Datos:** Número de folio del ticket, Fecha del consumo, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días naturales
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de 50 Friends con el folio y el total visibles.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de 50 Friends.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Recuerda que el SAT limita la deducción de restaurantes al 8.5% del monto pagado con tarjeta.
> Solo el 8.5% del monto del restaurante es deducible cuando pagas con tarjeta (art.
> 28 LISR).
> Para la facturación fiscal, 50 Friends aplica las mismas reglas que todos los restaurantes en México: la deducción está limitada al 8.5% del monto pagado con medios electrónicos (art.

### 7-eleven
*Recupera la factura de tu ticket de 7-Eleven*

- **Portal:** https://7-eleven.com.mx/facturacion-electronica
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio fiscal del ticket, ID de la tienda, Monto total, Fecha de compra
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del plazo establecido
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Fotografía tu ticket de 7-Eleven mostrando el total, la fecha y el número de tienda.
2. Envía la imagen a Clara Intelligence por WhatsApp.
3. Nuestro sistema identifica 7-Eleven y procesa la facturación.
4. Descarga tu CFDI en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo los productos físicos vendidos directamente por 7-Eleven (snacks, bebidas, alimentos preparados, mercancía general) generan CFDI deducible para personas físicas con actividad empresarial y para personas morales registradas.
> | Pago en efectivo sin deducción | Tienes el CFDI pero el SAT puede limitar la deducción si pagaste en efectivo y la operación supera $2,000 (art. 27 LISR).

### ado
*Factura tu boleto de autobús ADO*

- **Portal:** https://www.ado.com.mx/
- **Plazo:** Mismo mes calendario del viaje
- **Datos:** Número de boleto o folio, Fecha del viaje, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se cierra
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu boleto físico o captura de pantalla del boleto electrónico ADO.
2. Envía la imagen por WhatsApp a Clara Intelligence con el folio del boleto visible.
3. Procesamos tu solicitud con el sistema de autofactura de ADO.
4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de traslado.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los boletos de autobús son deducibles como viáticos o gastos de traslado para personas con actividad empresarial.
> Clara Intelligence convierte tu comprobante de viaje en un CFDI deducible sin que tengas que navegar el portal de ADO.
> Para personas de negocios, consultores independientes y trabajadores que viajan regularmente entre ciudades por razones laborales, el boleto de ADO es un gasto deducible como viático de traslado que puede representar un ahorro fiscal importante al final del año.

### aeromexico
*Factura tus vuelos de Aeroméxico fácilmente*

- **Portal:** https://aeromexico.com/es-mx/facturacion
- **Plazo:** 30 días naturales desde la emisión del boleto
- **Datos:** Número de boleto (139-XXXXXXXXXX), Apellido del pasajero principal, Datos fiscales, Folios de extras (si aplica)
- **Cuenta:** No se requiere cuenta; solo número de boleto o código de reservación
- **Descarga:** XMLPDF · **Reimprimir:** No, pasados 30 días el folio se cierra definitivamente
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Localiza tu boleto electrónico de Aeroméxico (PDF o pantallazo).
2. Envía el comprobante por WhatsApp a Clara Intelligence.
3. Procesamos la facturación con los datos del boleto.
4. Recibe tu CFDI en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los gastos de viajes de negocios y comisiones son 100% deducibles si tienes tu CFDI.
> Para gastos de viaje deducibles, recuerda que el SAT exige conservar tanto el CFDI como el pase de abordar (físico o digital) para comprobar que el viaje efectivamente se realizó.
> Si fue 100% puntos, no hay CFDI.

### alsea
*Facturar en restaurantes ALSEA: guía completa*

- **Portal:** https://alsea.interfactura.com/
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Folio del ticket, Marca o cadena, Fecha del consumo, RFC del receptor
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Localiza el folio de tu ticket de la marca ALSEA (Domino's, Italianni's, P.F. Chang's, McDonald's, etc.).
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Identificamos la marca ALSEA y seleccionamos la URL correcta en el portal de interfactura.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo el 8.5% del consumo en restaurante es deducible cuando pagas con tarjeta (art.
> 28 LISR).
> El límite del 8.5% de deducibilidad aplica a todas las marcas ALSEA por igual.
> Verifica que el monto del CFDI coincida con el ticket; recuerda que solo el 8.5% es deducible al pagar con tarjeta.

### amazon
*Obtén la factura de tus compras en Amazon*

- **Portal:** https://www.amazon.com.mx/
- **Plazo:** Hasta 30 días (productos de terceros)
- **Datos:** Número de pedido, Estatus 'Entregado', RFC y razón social, Código postal fiscal
- **Cuenta:** Requiere cuenta de Amazon.com.mx
- **Descarga:** XMLPDF · **Reimprimir:** Sí, desde Mis pedidos en cualquier momento
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Localiza tu comprobante de compra en la app o sitio web de Amazon México.
2. Toma una captura de pantalla o descarga el comprobante en PDF.
3. Envía el comprobante por WhatsApp a Clara Intelligence.
4. Recibe tu factura CFDI electrónica en PDF y XML.

### autozone
*Factura tus compras de AutoZone en México*

- **Portal:** https://www.autozone.com.mx/factura-electronica
- **Plazo:** 30 días naturales desde la fecha de compra
- **Datos:** Número de folio de transacción, Fecha de compra, Monto total, RFC del receptor
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de compra de AutoZone con el número de folio visible.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación electrónica de AutoZone.
4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos automotrices.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Las compras de refacciones, aceite, lubricantes y accesorios son deducibles para personas con vehículo de trabajo.
> Las refacciones y lubricantes de vehículos de trabajo son deducibles con uso G03.

### ben-and-frank
*Factura tus compras en Ben & Frank*

- **Portal:** https://www.benandfrank.com/invoice/c66auu90q2g1680457248474
- **Plazo:** 30 días naturales desde la fecha de compra
- **Datos:** Número de orden de compra, Fecha de compra, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu comprobante de compra de Ben & Frank con el número de orden visible.
2. Toma una foto del comprobante y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Ben & Frank.
4. Recibe tu CFDI en PDF y XML deducible como gasto médico ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los lentes graduados prescritos por un optometrista son deducibles como gastos médicos personales con uso de CFDI D01.
> Recibe tu CFDI en PDF y XML deducible como gasto médico ante el SAT.
> Los lentes graduados con prescripción son deducibles con uso de CFDI D01 como gasto médico.
> Los armazones sin graduación y los accesorios no califican como gasto médico deducible.

### benavides
*Factura tus compras en Farmacias Benavides*

- **Portal:** https://e-facturate.com/benavides/
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Número de referencia, RFC del receptor, Razón social, Código postal fiscal
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, mientras el folio siga vigente dentro del mes
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Farmacias Benavides con el número de referencia bajo el código de barras visible.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud en el portal oficial de facturación de Benavides.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los medicamentos de farmacia solo son deducibles como gasto médico si forman parte de una factura hospitalaria; las compras de botiquín de empresa se deducen como gasto general (G03).
> El tratamiento fiscal de las compras de farmacia tiene un matiz que confunde a muchos contribuyentes: los medicamentos comprados en mostrador no son deducibles como gasto médico personal, porque el artículo 151 de la LISR solo acepta medicinas cuando están incluidas en facturas de hospitales.
> | Deducir medicamentos de mostrador como gasto médico | El SAT solo acepta medicamentos como deducción personal cuando forman parte de una factura hospitalaria (art. 151 LISR).
> com/blog/facturacion-gastos-medicos-deducibles) [Cuanto Tiempo Facturar Ticket Mexico](https://recuperafacturas.

### bodega-aurrera
*Recupera la factura de tus compras en Bodega Aurrerá*

- **Portal:** https://facturacion.walmartmexico.com.mx/
- **Plazo:** 30 días naturales desde la fecha de compra
- **Datos:** TC (Terminal de Caja), TR (Transacción), TD (Terminal Dispositivo), CR (Código de Referencia)
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días desde el portal de Walmart México
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de Bodega Aurrerá y toma una foto clara donde se vean el TC, TR, TD y CR en la parte inferior del comprobante.
2. Envía la foto de tu ticket por WhatsApp a Clara Intelligence.
3. Ingresamos los datos al portal de facturación de Walmart México (facturacion.walmartmexico.com.mx) seleccionando la cadena Bodega Aurrerá.
4. Recibe tu CFDI en PDF y XML válido ante el SAT para deducir tus compras de despensa y artículos del hogar.

### bp
*Factura tus cargas de gasolina en BP*

- **Portal:** https://www.bp.com/es_mx/mexico/home/products-and-services/facturacion_electronica1.html
- **Plazo:** Varía por estación; factura el mismo día de la carga
- **Datos:** Número de estación BP, Número de folio, Web ID, RFC del receptor
- **Cuenta:** Opcional; se puede facturar sin usuario con solo un correo
- **Descarga:** XMLPDF · **Reimprimir:** Sí, desde el portal mientras el folio siga vigente
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de BP con el número de estación, el folio y el Web ID visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud en el portal oficial de facturación de BP México.
4. Recibe tu CFDI en PDF y XML válido ante el SAT para deducir tu combustible.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Para deducir el combustible ante el SAT necesitas el CFDI con el complemento correcto y haber pagado con tarjeta, transferencia o monedero electrónico de combustible: la gasolina pagada en efectivo no es deducible aunque tengas factura.
> Paga siempre con tarjeta o monedero de combustible: la gasolina en efectivo no es deducible (art. 27 LISR).
> La deducción de combustible tiene reglas estrictas: el artículo 27 de la LISR exige que la gasolina se pague con tarjeta de crédito o débito, transferencia, cheque nominativo o monedero electrónico de combustible autorizado por el SAT, sin importar el monto; el efectivo está excluido por completo.
> | Pago en efectivo | La gasolina pagada en efectivo no es deducible aunque tengas CFDI (art. 27 LISR).

### burger-king
*Factura tus pedidos de Burger King México*

- **Portal:** https://alsea.interfactura.com/
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Número de ticket, Número de tienda, Fecha de compra, Total pagado
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Burger King con el número de ticket, el número de tienda y la razón social del operador visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Identificamos si tu sucursal es de Alsea o de un franquiciatario y procesamos la solicitud en el portal correcto.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> El SAT limita la deducción de restaurantes al 8.5% del monto pagado con medios electrónicos.
> Solo el 8.5% del consumo en restaurante es deducible; paga con tarjeta para que aplique (art.
> 28 LISR).
> Fiscalmente, los consumos en Burger King siguen la regla general de restaurantes del artículo 28 fracción XX de la LISR: solo el 8.5% del monto pagado con tarjeta, transferencia o monedero electrónico es deducible, y el consumo en efectivo no es deducible en absoluto.

### caffenio
*Factura tus compras en Caffenio*

- **Portal:** https://facturaciondrive.caffenio.com/
- **Plazo:** 30 días naturales desde la fecha de compra
- **Datos:** Folio de transacción, Código de facturación, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Caffenio donde se vean el folio y el código de facturación.
2. Toma una foto clara del ticket asegurándote de que ambos códigos sean legibles.
3. Envía la foto por WhatsApp a Clara Intelligence.
4. Recibe tu CFDI 4.0 en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Para consumos de trabajo o junta en Caffenio, solo el 8.5% del monto es deducible pagando con tarjeta.
> Para empresas del noroeste con equipos de campo o comerciales que consumen en Caffenio diariamente, los CFDIs acumulados mensualmente pueden representar un gasto deducible relevante.

### capufe
*Factura tus peajes de casetas CAPUFE*

- **Portal:** https://capufe.gob.mx/
- **Plazo:** 30 días naturales desde la fecha del cruce
- **Datos:** Folio de transacción, Fecha del cruce, Monto del peaje, RFC del receptor
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del plazo establecido
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva el comprobante de pago de tu cruce de caseta CAPUFE con el folio de transacción.
2. Toma una foto del comprobante y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de CAPUFE.
4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de peaje.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los peajes de caseta son deducibles como gastos de traslado para personas con actividad empresarial y para flotas de vehículos.
> Para personas físicas con actividad empresarial y personas morales que utilizan estas vías para transportar mercancías, visitar clientes o realizar traslados laborales, los peajes de CAPUFE son gastos deducibles ante el SAT bajo el artículo 27 de la LISR, siempre que el trayecto tenga relación comprobable con la actividad económica.

### carls-jr
*Factura tus pedidos de Carl's Jr. México*

- **Portal:** https://facturacion.carlsjrmso.com/
- **Plazo:** Mismo mes calendario del pedido
- **Datos:** Folio del ticket, Número de tienda, Fecha de compra
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Carl's Jr. con el folio, el número de tienda y el total visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Identificamos la franquicia MSO de Carl's Jr. y procesamos tu solicitud.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo el 8.5% del monto de restaurante es deducible cuando pagas con tarjeta (art.
> 28 LISR).
> para comidas rápidas de trabajo, el CFDI es el soporte del 8.5% deducible del monto pagado con tarjeta (art.
> dos veces por semana a lo largo del año puede acumular entre $80,000 y $120,000 pesos en consumos, de los cuales $6,800 a $10,200 pesos son deducibles directamente.

### casa-de-tono
*Factura tus consumos en Casa de Toño*

- **Portal:** https://lacasadetono.mx/
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Folio del ticket, Número de sucursal, Fecha de consumo
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Casa de Toño con el folio, el número de sucursal y el total visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud a través del portal de facturación de Casa de Toño.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo el 8.5% del monto de restaurante es deducible cuando pagas con tarjeta (art.
> 28 LISR).
> Desde el punto de vista fiscal, los consumos en Casa de Toño se tratan como gastos de restaurante bajo el artículo 28 fracción XX de la LISR, con una deducibilidad máxima del 8.5% del monto pagado con tarjeta o transferencia.
> Para las personas físicas con actividad empresarial del Régimen Simplificado de Confianza (RESICO) o del régimen de actividades empresariales y profesionales, este 8.5% acumulado en un año puede representar varios cientos de pesos de ahorro fiscal en la declaración anual.

### chedraui
*Obtén la factura de tus compras en Chedraui*

- **Portal:** https://michedraui.com.mx/content/bill
- **Plazo:** Hasta 30 días naturales desde la compra
- **Datos:** Folio del ticket, Número de tienda, Número de caja, Importe total
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto clara del ticket de Chedraui incluyendo el código de barras y el total.
2. Envía la imagen por WhatsApp a Clara Intelligence.
3. Nuestro sistema procesa el ticket y gestiona la facturación automáticamente.
4. Recibe tu CFDI válido en PDF y XML.

### cinepolis
*Factura tus tickets de Cinépolis*

- **Portal:** https://cinepolis.com/facturacion
- **Plazo:** Mismo mes calendario de la función
- **Datos:** Número de folio o de orden, Fecha de la función, Complejo Cinépolis, RFC del receptor
- **Cuenta:** No se requiere cuenta (recomendada para consultar historial)
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket o comprobante de compra de Cinépolis con el número de folio.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Cinépolis.
4. Recibe tu CFDI en PDF y XML válido ante el SAT para tus gastos de entretenimiento.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Las entradas de cine pueden ser deducibles como gastos de representación o entretenimiento para personas con actividad empresarial.
> Los gastos de entretenimiento empresarial son deducibles hasta el límite que establece el SAT.
> Desde el punto de vista fiscal, los gastos de entretenimiento empresarial (cine, teatro, eventos deportivos) son deducibles bajo el concepto de 'gastos de representación' del artículo 28 de la LISR, con los límites que establece la ley.
> Para que la entrada al cine sea deducible como gasto de representación, es necesario documentar el propósito empresarial del gasto: una nota con el nombre del cliente o colaborador con quien se asistió, el motivo del evento y la relación con la actividad económica.

### circle-k
*Factura tu ticket de Circle K México*

- **Portal:** https://facturacion.circlekmexico.com.mx/
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio de transacción, Número de tienda, Monto total, Fecha de compra
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del plazo establecido
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto del ticket de Circle K con el folio y el monto total visibles.
2. Envía la foto por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud y gestionamos la factura con el portal de Circle K.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si compras en Circle K para gastos de oficina, viáticos o consumibles, puedes obtener tu factura CFDI deducible.
> Para personas físicas con actividad empresarial y personas morales que compran en Circle K para viáticos, gastos de oficina o consumibles, el CFDI es deducible con uso G03 siempre que el ticket sea del mes en curso.

### city-market
*Factura tus compras en City Market*

- **Portal:** https://www.citymarket.com.mx/facturacion
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio de transacción, Número de tienda, Monto total, Datos fiscales
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de City Market con el folio de transacción y el monto.
2. Envía la foto por WhatsApp a Clara Intelligence dentro del mes calendario.
3. Procesamos tu solicitud y gestionamos la emisión del CFDI.
4. Recibe tu factura en PDF y XML válida ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si compras productos gourmet, importados o artículos de primera calidad para tu empresa o negocio, Clara Intelligence te ayuda a obtener tu factura CFDI deducible.

### comex
*Factura tus compras en Comex México*

- **Portal:** https://www.comex.com.mx/factura
- **Plazo:** 30 días naturales desde la compra
- **Datos:** Folio del ticket, Fecha de compra, Monto total, Uso del CFDI
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días del plazo
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Comex con el folio, el total y la fecha visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Comex.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Para remodelaciones de inmuebles de negocio, la pintura y recubrimientos son deducibles como mejoras.
> Las compras de pintura para venta posterior (pintores profesionales) son costo deducible.
> Para pintores independientes y empresas de mantenimiento, la pintura y los materiales son costo deducible del servicio prestado, clasificado como costo de ventas en la declaración del ISR.
> Para propietarios de inmuebles que usan el bien en su actividad empresarial, la pintura de remodelación puede ser gasto de mantenimiento (deducible en el ejercicio) o mejora al activo fijo (depreciable en ejercicios futuros), dependiendo de si la obra simplemente mantiene el inmueble en condiciones de uso o incrementa su valor o vida útil.

### coppel
*Factura tu ticket de Coppel rápidamente*

- **Portal:** https://facturas.coppel.com/
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio del ticket, Fecha de compra, Monto total, Datos fiscales
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto de tu ticket de Coppel con el total y la fecha visibles.
2. Envía la imagen por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud automáticamente con el portal Coppel.
4. Recibe tu CFDI en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si compraste a crédito o de contado en Coppel, Clara Intelligence te ayuda a recuperar tu factura CFDI deducible sin trámites complicados.

### costco
*Recupera la factura de tus compras en Costco*

- **Portal:** https://www.costco.com.mx/facturas
- **Plazo:** Hasta 30 días naturales desde la compra
- **Datos:** Número de membresía Costco, Folio del ticket, Fecha de compra, Monto total
- **Cuenta:** Requiere membresía Costco vigente (número de socio en ticket)
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto de tu ticket de Costco donde se vea claramente el número de membresía y el total.
2. Envía la foto por WhatsApp a Clara Intelligence.
3. El sistema detecta que es un ticket de Costco y procesa tu facturación.
4. Descarga tu factura CFDI en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si eres miembro de Costco y realizas compras para tu negocio o gastos personales deducibles, Clara Intelligence te ayuda a obtener tu factura CFDI de manera automática.

### dairy-queen-mexico
*Factura tus compras en Dairy Queen México*

- **Portal:** https://facturacion.dequ.mx/
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Folio del ticket, Número de tienda, Fecha de compra
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Dairy Queen con el folio, el número de tienda y el total visibles.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Identificamos la franquicia de Dairy Queen y procesamos tu solicitud.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo el 8.5% del monto es deducible en establecimientos de alimentos cuando pagas con tarjeta.
> Para la deducción fiscal, los consumos en Dairy Queen aplican el mismo tratamiento que cualquier establecimiento de alimentos: el artículo 28 fracción XX de la LISR limita la deducción al 8.5% del monto pagado con tarjeta o transferencia a nombre del contribuyente.
> Los pagos en efectivo, aunque generen ticket, no son deducibles.
> Las visitas a Dairy Queen para pausas de trabajo, celebraciones de cierre de proyecto o atención informal a clientes califican como gasto de representación parcialmente deducible.

### dhl
*Factura tus envíos de DHL en México*

- **Portal:** https://www.dhl.com/mx-es/home/inicio-de-sesion.html
- **Plazo:** 30 días naturales desde la fecha del servicio
- **Datos:** Número de guía (waybill), Fecha del servicio, Monto total, RFC del receptor
- **Cuenta:** Requiere inicio de sesión en portal DHL
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Localiza tu comprobante de envío DHL con el número de guía o waybill visible.
2. Envía la foto del comprobante por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de DHL México.
4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de mensajería.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los gastos de envío son deducibles como gastos de operación para personas físicas con actividad empresarial y personas morales.

### didi
*Factura tus viajes de DiDi fácilmente*

- **Portal:** —
- **Plazo:** 7 días naturales tras el viaje o pedido
- **Datos:** ID del viaje o pedido, Fecha y hora del servicio, Monto total, RFC del solicitante
- **Cuenta:** Requiere cuenta de DiDi activa
- **Descarga:** XMLPDF · **Reimprimir:** Sí, en Mis recibos dentro de la app
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una captura de pantalla del recibo de tu viaje en DiDi o pedido de DiDi Food.
2. Envía la imagen a Clara Intelligence por WhatsApp.
3. El sistema procesa tu recibo y genera la solicitud de facturación.
4. Descarga tu factura CFDI válida en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Otro detalle: las propinas dejadas en la app no son facturables porque legalmente no forman parte de la contraprestación del servicio; solo el monto de la tarifa, los peajes y los recargos generan CFDI deducible.

### dominos
*Factura tus pedidos de Domino's en México*

- **Portal:** https://alsea.interfactura.com/RegistroDocumento.aspx?opc=Dominos
- **Plazo:** Mismo mes calendario del pedido
- **Datos:** Folio del ticket o número de pedido, Fecha del pedido, Monto total, Forma de pago electrónica
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket o comprobante de pedido de Domino's con el folio visible.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Domino's (Alsea).
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Recuerda que el SAT limita la deducción de consumos en restaurante al 8.5% del monto cuando se paga con medios electrónicos.
> Solo el 8.5% del consumo en restaurante es deducible (art.
> 28 LISR); paga con tarjeta.
> Para la deducción fiscal, el consumo en restaurantes está regulado por el artículo 28 fracción XX de la LISR, que limita la deducibilidad al 8.5% del monto pagado con tarjeta o transferencia cuando el consumo sea en un restaurante.

### estafeta
*Factura tus envíos de Estafeta en México*

- **Portal:** https://www.estafeta.com/FACTURACION
- **Plazo:** 30 días naturales desde la fecha del servicio
- **Datos:** Número de guía, Fecha del servicio, Monto total, RFC del receptor
- **Cuenta:** Solo requiere número de guía (no cuenta)
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Localiza tu comprobante de envío Estafeta con el número de guía o rastreo.
2. Envía la foto del comprobante por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación electrónica de Estafeta.
4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de mensajería.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los gastos de mensajería son deducibles ante el SAT y Clara Intelligence te ayuda a obtener tu CFDI de forma automática.
> es una empresa 100% mexicana fundada en 1979 y es una de las compañías de mensajería y paquetería más consolidadas del país.

### farmacia-del-ahorro
*Factura tus compras de Farmacia del Ahorro*

- **Portal:** https://www.fahorro.com/facturacion
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio fiscal del ticket, Número de tienda, Monto total, Datos fiscales
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto de tu ticket de Farmacia del Ahorro con el total y la fecha.
2. Envía la imagen por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de Farmacia del Ahorro.
4. Recibe tu CFDI en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los medicamentos con receta son deducibles como gasto médico personal si tienes el CFDI.
> Para personas físicas, las facturas de farmacia con uso de CFDI 'D01 - Honorarios médicos, dentales y gastos hospitalarios' son deducibles en la declaración anual del ISR siempre que se paguen con tarjeta de crédito, débito o transferencia electrónica.
> El art. 151 de la LISR establece que las medicinas son deducibles solo si están respaldadas por receta médica de un profesional con cédula vigente y se adquieren con medio de pago electrónico nominativo.
> Los productos no medicinales (cosméticos, suplementos sin receta, artículos de tocador) que vienen en el mismo CFDI no son deducibles aunque la factura los incluya; tu contador debe segregarlos al integrar la declaración anual.

### farmacias-guadalajara
*Factura tus compras en Farmacias Guadalajara*

- **Portal:** https://www.farmaciasguadalajara.com.mx/facturacion
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio del ticket, Número de tienda, Monto total, Forma de pago electrónica
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de Farmacias Guadalajara con el folio, número de tienda y monto.
2. Envía la foto por WhatsApp a Clara Intelligence dentro del mismo mes calendario.
3. Procesamos tu solicitud y emitimos el CFDI automáticamente.
4. Descarga tu factura en PDF y XML válida ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si compras medicamentos, artículos de salud o visitas sus consultorios, puedes obtener tu factura CFDI deducible.
> Paga con tarjeta para que el gasto médico sea deducible (art. 151 LISR).
> Para los contribuyentes que compran medicamentos de manera frecuente en Farmacias Guadalajara, la planificación fiscal es importante: los gastos médicos (medicamentos con receta, honorarios médicos) tienen un límite de deducción personal en la declaración anual del 15% del ingreso total acumulable o cinco veces el salario mínimo anual del área geográfica del contribuyente, lo que resulte menor (art. 151 LISR).
> Forma de pago electrónicaNecesaria para deducción como gasto médico (art. 151 LISR).

### farmacias-san-pablo
*Factura tus compras en Farmacias San Pablo*

- **Portal:** https://www.sanpablo.com.mx/facturacion
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio del ticket, Número de tienda, Monto total, Forma de pago electrónica
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de Farmacias San Pablo con el folio y el monto total.
2. Envía la foto por WhatsApp a Clara Intelligence dentro del mismo mes.
3. Nuestro sistema procesa tu solicitud y emite el CFDI.
4. Recibe tu factura en PDF y XML válida ante el SAT para deducir.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si compras medicamentos, artículos de salud o visitas sus consultorios, puedes obtener tu factura CFDI deducible.
> Para gastos médicos deducibles, usa CFDI uso D01 - Honorarios médicos y gastos hospitalarios.
> Paga con tarjeta para que el gasto sea deducible (art. 151 LISR para personas físicas).
> Para contribuyentes que compran medicamentos de prescripción, anteojos o realizan estudios clínicos en San Pablo, la factura CFDI con uso D01 es fundamental para ejercer las deducciones personales en la declaración anual, sujetas al límite del 15% del ingreso o cinco veces el salario mínimo (art. 151 LISR).

### farmacias-similares
*Factura tus compras de Farmacias Similares*

- **Portal:** https://facturacion.gpupm.com/simifactura/portal/
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio del ticket, Fecha de compra, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Farmacias Similares con el monto y la fecha visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el sistema de Farmacias Similares.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los medicamentos con receta son deducibles con uso de CFDI D01; sin receta no califican.
> Clara Intelligence puede gestionar todos estos tickets si los envías por WhatsApp, consolidando el proceso para que no pierdas ni un solo CFDI deducible del año.
> Receta médicaDebe conservarse 5 años; sin ella el gasto no califica como médico deducible aunque tengas el CFDI.
> | Pago en efectivo descalifica la deducción | La LISR exige que los gastos médicos se paguen con medios electrónicos para ser deducibles.

### fedex
*Factura tus envíos de FedEx en México*

- **Portal:** https://www.fedex.com/es-mx/billing.html
- **Plazo:** 30 días naturales desde la fecha del envío
- **Datos:** Número de guía, Fecha del servicio, Monto exacto, RFC del receptor
- **Cuenta:** Solo requiere número de guía (no cuenta)
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Localiza tu comprobante de envío o guía de FedEx con el número de rastreo visible.
2. Envía la foto del comprobante por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de FedEx México.
4. Recibe tu CFDI en PDF y XML válido ante el SAT para deducir tus gastos de paquetería.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los gastos de envío son deducibles como gasto de operación para personas físicas con actividad empresarial y para personas morales.
> Para las empresas mexicanas que importan o exportan mercancías, FedEx es un socio logístico fundamental cuyo gasto de envío es completamente deducible como gasto de operación ante el SAT, incluyendo los cargos adicionales de combustible, manejo especial, seguro y área remota que pueden representar hasta el 30% del costo base del envío.

### g500
*Factura tus cargas de gasolina en G500*

- **Portal:** https://g500network.com/facturacion-en-linea/
- **Plazo:** Varía por estación; factura el mismo día de la carga
- **Datos:** Nombre de la estación y permiso CRE, Folio del ticket, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Depende de la estación; conserva el PDF y XML al emitirlos
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de G500 con el nombre de la estación, el permiso CRE y el folio visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Identificamos la estación G500 correcta y procesamos tu solicitud de facturación.
4. Recibe tu CFDI en PDF y XML válido ante el SAT para deducir tu combustible.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Para deducir el combustible necesitas pagar con tarjeta o monedero electrónico: el efectivo no es deducible.
> Paga con tarjeta o monedero de combustible: la gasolina en efectivo no es deducible (art. 27 LISR).
> Como en toda gasolinera, la deducción del combustible de G500 exige pago con medios electrónicos: el artículo 27 de la LISR excluye la gasolina pagada en efectivo de cualquier deducción, sin importar el monto ni el CFDI.
> | Pago en efectivo | La gasolina pagada en efectivo no es deducible aunque tengas CFDI (art. 27 LISR).

### gasolineras
*Recupera la factura de tus cargas de gasolina*

- **Portal:** —
- **Plazo:** 24 a 72 horas tras la carga
- **Datos:** Número de permiso CRE, Folio del ticket, Número de estación, Litros y tipo de combustible
- **Cuenta:** No se requiere cuenta; varía por franquicia
- **Descarga:** XMLPDF · **Reimprimir:** Generalmente no disponible pasadas 72 horas
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto del ticket de la gasolinera donde se vea el monto, litros y tipo de combustible.
2. Envía la foto por WhatsApp a Clara Intelligence.
3. Nuestro sistema identifica la gasolinera y procesa tu facturación automáticamente.
4. Recibe tu factura CFDI de combustible en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> La gasolina es uno de los gastos más comunes y deducibles en México, tanto para personas físicas como morales.
> La factura de gasolina es 100% deducible si está relacionada con tu actividad económica.
> 0 con el complemento 'Hidrocarburos' para combustibles, lo cual hace deducible el gasto para personas físicas con actividad empresarial y morales.
> Forma de pagoTarjeta o transferencia para que sea 100% deducible.

### heb
*Factura tu ticket de HEB México sin complicaciones*

- **Portal:** https://www.heb.com.mx/facturacion
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio de transacción, Monto total, Fecha de compra, Datos fiscales
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Fotografía tu ticket de HEB asegurándote de capturar el folio y el monto total.
2. Envía la foto por WhatsApp a Clara Intelligence.
3. Nuestro sistema procesa la solicitud y gestiona la facturación.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Las compras en HEB para tu empresa son deducibles con uso CFDI G03.

### home-depot
*Factura tus compras de Home Depot fácilmente*

- **Portal:** https://homedepot.com.mx/facturaweb
- **Plazo:** Hasta 30 días naturales desde la compra
- **Datos:** Folio fiscal, Número de tienda, Número de operación, Monto total
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Fotografía tu ticket de Home Depot asegurándote de capturar el total y el número de ticket.
2. Envía la foto por WhatsApp a Clara Intelligence o cárgala en nuestra plataforma.
3. Clara procesa el ticket automáticamente e inicia la facturación.
4. Recibe tu CFDI en PDF y XML listo para tus deducciones.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> opera más de 130 tiendas en el país y atiende mayoritariamente compras de remodelación, construcción y herramientas, donde la deducibilidad del CFDI es crítica para constructoras, contratistas y profesionales independientes.

### iave
*Factura tus cruces de caseta IAVE*

- **Portal:** https://iave.capufe.gob.mx/
- **Plazo:** 30 días naturales desde la fecha del cruce
- **Datos:** Número de tag IAVE, Periodo de facturación, RFC del receptor, Razón social
- **Cuenta:** Requiere número de tag IAVE para factura consolidada
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días del cruce
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Localiza tu estado de cuenta IAVE o los comprobantes de tus cruces de caseta.
2. Envía el documento o foto por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de CAPUFE.
4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de peaje.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los gastos de peaje son deducibles como viáticos de traslado o gastos de operación para personas con actividad empresarial y empresas con flotillas.
> Los peajes en autopistas CAPUFE son deducibles con uso CFDI G03 para gastos de operación.

### ikea
*Factura tus compras en IKEA México*

- **Portal:** https://v2.dito.com.mx/Dito.Web/IkeaSelfIssue/ConsultaTicket
- **Plazo:** 30 días naturales desde la fecha de compra
- **Datos:** Número de ticket u orden, Fecha de compra, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario (solo número de ticket)
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días desde el portal Dito
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de IKEA México con el número de orden o folio visible.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud a través del portal de autofactura Dito de IKEA.
4. Recibe tu CFDI en PDF y XML válido para deducir muebles y artículos de oficina.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Muebles y sillas de oficina comprados para tu empresa son deducibles como activos fijos (uso I04 o I05).
> Para home office, solo la proporción del área usada para trabajar es deducible; consulta con tu contador.
> Para empresas y personas con actividad empresarial, las compras en IKEA son frecuentes fuente de activos deducibles: escritorios regulables, sillas ergonómicas MARKUS o JÄRVFJÄLLET, lámparas de escritorio, estanterías KALLAX para oficina, cajoneras de archivo y organizadores de escritorio son activos que mejoran la productividad y tienen una vida útil de varios años.

### italiannis
*Factura tus consumos en Italianni's México*

- **Portal:** https://alsea.interfactura.com/RegistroDocumento.aspx?opc=Italiannis
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Folio del ticket, Fecha del consumo, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Italianni's con el folio y el número de sucursal visibles.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Identificamos Italianni's como marca ALSEA y accedemos al portal correcto.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo el 8.5% del monto de restaurante es deducible cuando pagas con tarjeta (art.
> 28 LISR).
> La deducción aplica al 8.5% del monto pagado con tarjeta o transferencia, lo que convierte a Italianni's en un establecimiento donde la disciplina de facturar el mismo día del consumo tiene un impacto directo en la contabilidad de la empresa.
> Verifica el monto del CFDI y recuerda que solo el 8.5% del monto es deducible al pagar con tarjeta.

### izzi
*Factura tu recibo de Izzi Telecom*

- **Portal:** https://www.izzi.mx/facturacion
- **Plazo:** Mismo ciclo de facturación mensual
- **Datos:** Número de cuenta Izzi, Periodo de facturación, Datos fiscales, Forma de pago electrónica
- **Cuenta:** Requiere número de cuenta Izzi
- **Descarga:** XMLPDF · **Reimprimir:** Sí, en cualquier momento desde izzi.mx
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Localiza tu recibo o comprobante de pago de Izzi (correo de factura mensual o ticket de pago en sucursal).
2. Envía el comprobante por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud y gestionamos la emisión del CFDI.
4. Recibe tu factura en PDF y XML válida ante el SAT para deducir.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si contratas Izzi para tu empresa u oficina, el pago mensual puede ser un gasto deducible.
> El servicio de internet y cable es deducible como gasto de comunicación (G03) si es para tu empresa.
> Para empresas con oficinas, sucursales o puntos de venta que contratan internet Izzi, el pago mensual puede ser un gasto deducible como servicio de comunicaciones con uso CFDI G03, siempre que esté a nombre del RFC de la empresa.
> Forma de pago electrónicaPara que el gasto sea deducible como servicio empresarial.

### kfc
*Factura tus pedidos de KFC México*

- **Portal:** https://kfc.teagradece.mx/facturacion
- **Plazo:** Mismo mes calendario del pedido
- **Datos:** Número de folio del ticket, Fecha del pedido, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de KFC donde se vea el folio, el total y el nombre de la sucursal.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Identificamos la franquicia de KFC y procesamos tu solicitud de facturación.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Recuerda que el SAT limita la deducción de restaurantes al 8.5% del monto cuando pagas con medios electrónicos.
> Solo el 8.5% del consumo en restaurante es deducible; paga con tarjeta para que aplique (art.
> 28 LISR).
> El artículo 28 fracción XX de la LISR limita la deducción de restaurantes al 8.5% del monto pagado con medios electrónicos, lo que aplica a KFC sin excepción.

### krispy-kreme
*Factura tus compras en Krispy Kreme México*

- **Portal:** https://facturacion.krispykreme.com.mx/
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Número de folio del ticket, Fecha de compra, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Krispy Kreme con el número de folio visible.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Krispy Kreme México.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo el 8.5% del monto es deducible en restaurantes y cafeterías cuando pagas con tarjeta.
> Para compras corporativas como cajas de donas para eventos, la facturación como gasto de representación aplica el mismo límite del 8.5% de artículo 28 LISR para establecimientos de alimentos.
> | Deducción del 100% del monto | Al igual que todos los restaurantes, el SAT limita la deducción al 8.5% cuando el pago es con tarjeta.
> El CFDI es soporte documental necesario pero no cambia el porcentaje deducible.

### la-comer
*Factura tus compras de La Comer*

- **Portal:** https://www.lacomer.com.mx/facturacion
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio de transacción, Fecha de compra, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de La Comer con el folio de transacción y el monto visible.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de La Comer.
4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de despensa y operación.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Las compras de alimentos e insumos para restaurantes o eventos son deducibles con uso G03.
> La Comer también emite CFDI para vinos, licores y productos gourmet importados, que pueden ser deducibles como gastos de representación corporativa (con los límites del artículo 28 de la LISR).

### laboratorio-chopo
*Factura tus estudios en Laboratorio Chopo*

- **Portal:** https://www.chopo.com.mx/factura
- **Plazo:** 30 días naturales desde la fecha del servicio
- **Datos:** Número de orden, Fecha del servicio, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu comprobante de pago de Laboratorio Chopo con el número de orden visible.
2. Toma una foto clara del comprobante y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Laboratorio Chopo.
4. Recibe tu CFDI en PDF y XML deducible como gasto médico personal.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Recibe tu CFDI en PDF y XML deducible como gasto médico personal.
> La deducibilidad de los análisis clínicos en México es uno de los beneficios fiscales más aprovechados por personas físicas, especialmente en el régimen de sueldos y salarios (régimen 605).
> El SAT permite deducir gastos de análisis clínicos, biometrías, ultrasonidos, radiografías y otros estudios diagnósticos como gastos médicos personales, hasta el límite que establece el artículo 151 de la LISR (el menor entre el 15% de los ingresos o cinco unidades de medida y actualización anuales, lo que para 2026 equivale a aproximadamente $218,000 pesos).
> Uso de CFDID01 para gasto médico personal deducible en declaración anual; G03 para gastos de empresa.

### little-caesars
*Factura tu pedido de Little Caesars México*

- **Portal:** https://facturacion.littlecaesars.com.mx/
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio de orden, Número de tienda, Monto total, Forma de pago electrónica
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de Little Caesars con el folio y el total de la compra.
2. Envía la foto por WhatsApp a Clara Intelligence dentro del mismo mes.
3. Procesamos tu solicitud y gestionamos la emisión del CFDI.
4. Recibe tu factura en PDF y XML válida ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si compras pizza para reuniones de trabajo, eventos de empresa o gastos de representación, puedes obtener tu factura CFDI deducible.
> Para gastos de representación y juntas de trabajo, usa CFDI G03 (solo 8.5% deducible).
> Paga con tarjeta para maximizar la deducibilidad del gasto (art. 28 LISR).
> El gasto en Little Caesars es deducible como gasto de restaurante al 8.5% del monto total (art.

### liverpool
*Recupera la factura de tus compras en Liverpool*

- **Portal:** https://facturacionclientes.liverpool.com.mx/
- **Plazo:** Hasta 30 días naturales desde la compra
- **Datos:** Folio fiscal, Monto total, Fecha de compra, RFC del receptor
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días desde el portal
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto de tu ticket de Liverpool donde aparezca el total y el número de transacción.
2. Envía la foto por WhatsApp a Clara Intelligence.
3. Nuestro sistema identifica Liverpool como el comercio y procesa la facturación.
4. Recibe tu CFDI en PDF y XML listo para descargar.

### mcdonalds
*Factura tus pedidos de McDonald's México*

- **Portal:** https://www.facturacionmcdonalds.com.mx/
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Número de restaurante, Número de ticket, Número de caja, Fecha de compra
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes desde el portal con los datos del ticket
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de McDonald's con el número de restaurante, el número de ticket y la fecha visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud en el portal oficial de facturación de McDonald's México.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Recuerda que el SAT limita la deducción de restaurantes al 8.5% del monto cuando pagas con medios electrónicos.
> Solo el 8.5% del consumo en restaurante es deducible; paga con tarjeta para que aplique (art.
> 28 LISR).
> El artículo 28 fracción XX de la LISR limita la deducción de consumos en restaurantes al 8.5% del monto pagado con medios electrónicos, regla que aplica a McDonald's igual que a cualquier cadena.

### mercado-libre
*Factura tus compras de Mercado Libre fácilmente*

- **Portal:** https://www.mercadolibre.com.mx/l/facturacion
- **Plazo:** Primeros días del mes siguiente
- **Datos:** RFC, razón social, régimen fiscal y código postal
- **Cuenta:** Requiere cuenta de Mercado Libre activa
- **Descarga:** XMLPDF · **Reimprimir:** Sí, desde Mis compras en cualquier momento
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Descarga o captura el comprobante de tu compra en Mercado Libre (confirmación de pago o número de pedido).
2. Envía el comprobante por WhatsApp a Clara Intelligence o súbelo desde nuestra plataforma.
3. Nuestro sistema extrae los datos del pedido e inicia la solicitud de facturación.
4. Recibe tu factura CFDI en formato PDF y XML, válida ante el SAT para tus deducciones fiscales.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Cada pedido puede convertirse en una factura CFDI deducible ante el SAT.
> Para compradores, cada pedido puede generar un CFDI deducible emitido por el vendedor o por Mercado Libre según el régimen fiscal del vendedor.
> El uso de CFDI más común para compras de insumos de negocio es 'G03 - Gastos en general'; para equipos de cómputo o mobiliario puede aplicar 'I04 - Equipo de computación' o 'I02 - Mobiliario y equipo de oficina por inversiones' si se trata de activos fijos deducibles a varios años según la LISR.

### mobil
*Factura tus cargas de gasolina en Mobil*

- **Portal:** https://www.mobil.com.mx/es-mx/gasolina/facturacion
- **Plazo:** Varía por operador; factura el mismo día de la carga
- **Datos:** Operador de la estación, Número de ticket o folio, Estación y hora de carga, RFC del receptor
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Depende del operador de la estación
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Mobil con el nombre del operador, la estación, el folio y la hora de carga visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Identificamos al operador de tu estación Mobil y procesamos la solicitud en su portal de facturación.
4. Recibe tu CFDI en PDF y XML válido ante el SAT para deducir tu combustible.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Paga con tarjeta o monedero de combustible: la gasolina en efectivo no es deducible (art. 27 LISR).
> Las reglas de deducción de combustible aplican igual que en cualquier gasolinera: el artículo 27 de la LISR exige pago con tarjeta, transferencia o monedero electrónico de combustible autorizado —el efectivo no es deducible— y el CFDI debe incluir la clave de producto y los litros correctos.
> | Pago en efectivo | La gasolina pagada en efectivo no es deducible aunque tengas CFDI (art. 27 LISR).

### netflix
*Factura tu suscripción de Netflix en México*

- **Portal:** https://www.netflix.com/account
- **Plazo:** Mismo mes del cargo
- **Datos:** RFC, razón social, régimen fiscal y código postal
- **Cuenta:** Requiere cuenta de Netflix activa
- **Descarga:** No confirmado · **Reimprimir:** Proceso no confirmado en fuente oficial
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Localiza tu recibo mensual de Netflix en el correo electrónico o en la sección 'Cuenta > Ver historial de facturación' de Netflix.
2. Envía el comprobante por WhatsApp a Clara Intelligence o súbelo desde nuestra plataforma.
3. Nuestro sistema extrae los datos del cargo y gestiona la solicitud de facturación CFDI.
4. Recibe tu factura CFDI en PDF y XML válida ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Netflix es el servicio de streaming más popular de México y su suscripción mensual puede ser un gasto deducible si está relacionado con tu actividad económica.
> El gasto de Netflix es deducible como 'G03 - Gastos en general' si está relacionado con tu actividad empresarial o profesional.
> La deducibilidad del gasto de Netflix depende del uso que le des a la plataforma en relación con tu actividad económica.
> Para productores de contenido, comunicadores digitales, agencias de publicidad o empresas de entretenimiento, el gasto puede clasificarse como 'G03 - Gastos en general' y deducirse al 100% si se puede demostrar su relación directa con el negocio.

### nutrisa
*Factura tus compras en Nutrisa*

- **Portal:** —
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Folio del ticket, Número de sucursal, Fecha de compra
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Consultar con sucursal
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Nutrisa con el folio, el número de sucursal y el total visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Verificamos el portal de facturación disponible para tu sucursal de Nutrisa.
4. Recibes tu CFDI o la orientación necesaria para obtenerlo directamente en sucursal.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los helados y alimentos preparados aplican el tratamiento estándar de restaurantes: 8.5% deducible del monto pagado con tarjeta (art.
> 28 LISR).

### office-depot
*Factura tus compras de Office Depot*

- **Portal:** https://facturacion.officedepot.com.mx/
- **Plazo:** Hasta 30 días naturales desde la compra
- **Datos:** Folio del ticket, Número de tienda, Monto total, Datos fiscales
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto del ticket de Office Depot mostrando el total y la fecha.
2. Envía la imagen por WhatsApp a Clara Intelligence.
3. Procesamos tu ticket y generamos la solicitud de facturación.
4. Recibe tu CFDI en PDF y XML válido para deducción.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Es una opción frecuente de gasto deducible para profesionistas, freelancers y empresas.
> Las compras de tecnología y mobiliario son 100% deducibles si las usas para tu actividad.

### officemax
*Factura tus compras de OfficeMax en México*

- **Portal:** https://facturacion.officemax.com.mx/
- **Plazo:** 30 días naturales desde la fecha de compra
- **Datos:** Número de transacción, Fecha de compra, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de compra de OfficeMax con el número de transacción visible.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación electrónica de OfficeMax.
4. Recibe tu CFDI en PDF y XML válido para deducir tus compras de oficina.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Las compras de material de oficina son gastos deducibles.
> Para las personas físicas que trabajan desde casa (home office), OfficeMax es una fuente frecuente de compras deducibles: silla ergonómica, escritorio, monitor adicional, auriculares, papel, tóner y webcam son artículos de trabajo comprados regularmente.
> Para las personas morales, las compras de OfficeMax son gastos de operación deducibles en su totalidad con independencia del monto, siempre que exista el CFDI con la descripción adecuada del producto.
> com/blog/gastos-deducibles-regreso-clases) [Requisitos Facturar Ticket Mexico 2025](https://recuperafacturas.

### opticas-devlyn
*Factura tus compras en Ópticas Devlyn*

- **Portal:** https://posap.devlyn.me/facturacionWeb/
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio del ticket, Fecha de compra, Monto total, Prescripción del optometrista
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Ópticas Devlyn con el folio y el monto total visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Devlyn.
4. Recibe tu CFDI en PDF y XML deducible como gasto médico ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los lentes graduados y los exámenes visuales son gastos médicos deducibles ante el SAT cuando se pagan con tarjeta o transferencia y se cuenta con la prescripción del optometrista.
> Recibe tu CFDI en PDF y XML deducible como gasto médico ante el SAT.
> Los lentes graduados con prescripción son deducibles con uso CFDI D01 como gasto médico personal.
> Los armazones sin graduación y lentes de sol no son deducibles como gasto médico.

### opticas-lux
*Factura tus compras en Ópticas Lux*

- **Portal:** https://lux.mx/pages/facturacion
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Número de folio del comprobante, Fecha de compra, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu comprobante de compra de Ópticas Lux con el folio visible.
2. Toma una foto clara del comprobante y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Ópticas Lux.
4. Recibe tu CFDI en PDF y XML deducible como gasto médico.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los lentes graduados con prescripción son deducibles como gastos médicos personales si pagas con medios electrónicos.
> Recibe tu CFDI en PDF y XML deducible como gasto médico.
> Armazones sin graduación y accesorios de moda no son deducibles como gasto médico.
> Fiscalmente, los lentes graduados prescritos por un optometrista o médico oftalmólogo son deducibles como gastos médicos personales (uso CFDI D01) para personas físicas en su declaración anual, conforme al artículo 151 fracción I de la LISR.

### oxxo
*Recupera la factura de tu ticket de OXXO*

- **Portal:** https://www4.oxxo.com:9443/facturacionElectronica-web/views/layout/inicio.do
- **Plazo:** 7 días naturales desde la compra
- **Datos:** Folio web (ID Web), Monto total, Fecha de compra, RFC del receptor
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, descárgalo de nuevo desde el portal dentro del plazo de 7 días
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto clara de tu ticket de OXXO donde se vea el total, la fecha y el número de tienda.
2. Envía la foto por WhatsApp a Clara Intelligence o súbela desde nuestro sitio web.
3. Nuestro sistema identifica automáticamente que es un ticket de OXXO y extrae los datos necesarios.
4. Recibe tu factura CFDI en formato PDF y XML, válida ante el SAT para tus deducciones fiscales.

### oxxo-gas
*Factura tu gasolina en OXXO Gas*

- **Portal:** https://facturacion.oxxogas.com/
- **Plazo:** Mismo mes calendario de la carga
- **Datos:** Folio de transacción, Fecha de carga, Monto total, Forma de pago electrónica
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de carga de gasolina de OXXO Gas con el folio visible.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de OXXO Gas.
4. Recibe tu CFDI en PDF y XML válido para deducir tu gasto de combustible.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Para personas con vehículos de trabajo, los gastos de gasolina son deducibles ante el SAT siempre que cuenten con su CFDI correspondiente.
> El artículo 27 fracción III de la LISR establece que los pagos por gasolina deben hacerse con medios electrónicos (tarjeta o transferencia) para ser deducibles, con independencia del importe.
> Forma de pago electrónicaTarjeta, SPIN u otro medio electrónico (no efectivo) para que el gasto sea deducible según art. 27 LISR.
> | Pago en efectivo descalifica la deducción | Por art. 27 fracción III LISR, los pagos de gasolina deben hacerse con medios electrónicos para ser deducibles.

### palacio-de-hierro
*Factura tus compras en El Palacio de Hierro*

- **Portal:** https://facturacion.elpalaciodehierro.com/
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Número de transacción, Número de tienda, Monto total, Forma de pago
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de El Palacio de Hierro con el folio y el monto total visibles.
2. Envía la foto por WhatsApp a Clara Intelligence dentro del mes calendario.
3. Nuestro sistema procesa la solicitud y gestiona el CFDI.
4. Recibe tu factura en PDF y XML válida ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si compraste ropa de diseñador, joyería, perfumería o artículos de hogar premium, puedes obtener tu factura CFDI deducible.
> Para estas compras de alto valor, la factura CFDI es especialmente importante tanto para deducciones empresariales como para documentar activos de la empresa (art. 31 LISR para inversiones deducibles).

### panaderia-el-globo
*Factura tus compras en Panadería El Globo*

- **Portal:** —
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Folio del ticket, Número de sucursal, Fecha de compra
- **Cuenta:** Depende de la sucursal
- **Descarga:** XMLPDF · **Reimprimir:** Consultar con sucursal
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de El Globo con el folio, el número de sucursal y el total visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Verificamos el portal de facturación disponible para Panadería El Globo.
4. Recibes tu CFDI o la orientación para obtenerlo directamente en sucursal.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo el 8.5% del monto de panadería/restaurante es deducible cuando pagas con tarjeta (art.
> 28 LISR).

### pastelerias-esperanza
*Factura tus compras en Pastelerías Esperanza*

- **Portal:** https://cfdi.esperanza.mx/
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio del ticket, Fecha de compra, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, descárgalo desde el portal cfdi.esperanza.mx
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Pastelerías Esperanza con el folio y el monto visibles.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud en el portal cfdi.esperanza.mx.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### pastelerias-marisa
*Factura tus compras en Pastelerías Marisa*

- **Portal:** https://facturacion.simang8.com/marisa
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio del ticket, Número de sucursal, Fecha de compra, Monto total
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Pastelerías Marisa con el folio y el monto visibles.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud a través del portal de facturación de Marisa.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo el 8.5% del monto de alimentos es deducible cuando pagas con tarjeta (art.
> 28 LISR).
> Aunque el SAT solo permite deducir el 8.5% del monto de restaurantes y pastelerías pagado con tarjeta (artículo 28 LISR), el CFDI de Marisa es un comprobante válido de gasto de representación que debe conservarse como soporte documental durante cinco años.

### pemex
*Factura tu gasolina Pemex automáticamente*

- **Portal:** —
- **Plazo:** 72 horas tras la carga (varía por estación)
- **Datos:** Número de permiso CRE, Folio del ticket, Número de estación Pemex, Litros y tipo de combustible
- **Cuenta:** No se requiere cuenta; el folio del ticket es suficiente
- **Descarga:** XMLPDF · **Reimprimir:** No disponible después de 72 horas en la mayoría de franquicias
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto del ticket de la estación Pemex que muestre litros, monto y número de estación.
2. Envía la imagen por WhatsApp a Clara Intelligence.
3. Identificamos la franquicia y procesamos tu facturación al instante.
4. Recibe tu CFDI con clave SAT de combustible en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si cargaste gasolina o diésel en una estación Pemex, puedes deducir 100% el gasto si lo usas para tu actividad económica.
> 0 con complemento de Hidrocarburos para combustibles, lo cual hace deducible el gasto para personas con actividad empresarial y para morales que justifiquen el uso del vehículo en su operación.
> Forma de pagoTarjeta o transferencia para que la deducción sea 100%.
> | Pago en efectivo no deducible | El art. 27 LISR exige que el combustible se pague con medios electrónicos para ser deducible, aun cuando tengas el CFDI.

### pf-changs
*Factura tus consumos en P.F. Chang's México*

- **Portal:** https://alsea.interfactura.com/RegistroDocumento.aspx?opc=PFC
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Folio del ticket, Fecha del consumo, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de P.F. Chang's con el folio y el número de sucursal visibles.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Identificamos P.F. Chang's como marca ALSEA y accedemos a la URL correcta.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo el 8.5% del monto es deducible en restaurantes cuando pagas con tarjeta (art.
> 28 LISR).
> Chang's es considerablemente mayor — lo que hace que el 8.5% de deducibilidad represente un monto más relevante en valor absoluto.
> Verifica el monto del CFDI y recuerda que solo el 8.5% del consumo es deducible al pagar con tarjeta.

### primera-plus
*Factura tu boleto de Primera Plus*

- **Portal:** https://www.facturaelectronicagfa.mx/
- **Plazo:** Mismo mes calendario del viaje
- **Datos:** Número de boleto o folio, Fecha del viaje, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se cierra
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu boleto físico o correo de confirmación de Primera Plus con el número de folio.
2. Envía la imagen del boleto por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Primera Plus.
4. Recibe tu CFDI en PDF y XML deducible ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Sus boletos son deducibles como viáticos de traslado.
> Recibe tu CFDI en PDF y XML deducible ante el SAT.
> Sus boletos tienen una alta tasa de deducibilidad para profesionales independientes, ejecutivos y empresas del sector manufacturero, industrial y agroalimentario concentrados en el Bajío mexicano.
> La clave está en facturar siempre al RFC de la empresa (no del empleado) y dentro del mes del viaje, para que el gasto sea deducible en el periodo fiscal correcto.

### rappi
*Factura tus pedidos de Rappi fácilmente*

- **Portal:** https://www.rappi.com.mx/
- **Plazo:** Hasta 72 horas después del pedido
- **Datos:** RFC, razón social, régimen fiscal y código postal
- **Cuenta:** Requiere cuenta de Rappi activa
- **Descarga:** XMLPDF · **Reimprimir:** Proceso no confirmado en fuente oficial
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Abre la app de Rappi y captura el comprobante del pedido que quieres facturar.
2. Envía la captura por WhatsApp a Clara Intelligence.
3. Nuestro sistema procesa tu pedido y gestiona la solicitud de facturación CFDI.
4. Recibe tu factura CFDI en PDF y XML válida ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si usas Rappi para gastos de negocio o trabajo, puedes obtener tu factura CFDI deducible.
> La deducibilidad de los gastos de Rappi depende del tipo de pedido y el uso dado.
> Los pedidos de alimentos de trabajo (para reuniones o trabajo remoto) son deducibles al 8.5% (valor referencial, art.
> 28 LISR) siempre que se paguen con tarjeta empresarial nominativa.

### salud-digna
*Factura tus estudios en Salud Digna*

- **Portal:** —
- **Plazo:** 30 días naturales desde la fecha del servicio
- **Datos:** Número de orden, Fecha del servicio, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu comprobante de pago de Salud Digna con el número de orden o folio.
2. Toma una foto clara del comprobante y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de Salud Digna.
4. Recibe tu CFDI en PDF y XML deducible como gasto médico personal.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Los análisis clínicos, biometrías, perfil lipídico y demás estudios son deducibles como gasto médico personal si pagas con tarjeta.
> Recibe tu CFDI en PDF y XML deducible como gasto médico personal.
> | Pago en efectivo descalifica deducción médica | Para deducir gastos médicos en declaración anual, la LISR exige pago con tarjeta, transferencia o cheque.
> com/blog/facturacion-gastos-medicos-deducibles) [Como Facturar Farmacias Ahorro Guadalajara](https://recuperafacturas.

### sams-club
*Recupera la factura de tus compras en Sam's Club*

- **Portal:** https://facturacion.walmartmexico.com.mx/
- **Plazo:** Hasta 30 días naturales desde la compra
- **Datos:** Número de socio Sam's Club, Folio del ticket, Número de tienda, Monto total
- **Cuenta:** Requiere membresía Sam's Club vigente
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto clara de tu ticket de Sam's Club donde se vean el total, la fecha y tu número de membresía.
2. Envía la foto por WhatsApp a Clara Intelligence.
3. El sistema detecta que es un ticket de Sam's Club y procesa la facturación.
4. Recibe tu CFDI en PDF y XML listo para deducir.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si eres socio Sam's Club y compras al mayoreo para tu negocio o tu hogar, Clara Intelligence te ayuda a obtener tu factura CFDI deducible sin entrar a portales complicados.

### sears
*Recupera la factura de tus compras en Sears*

- **Portal:** https://facturaelectronica.sears.com.mx/
- **Plazo:** Hasta el día 5 del mes siguiente
- **Datos:** Número de tienda, Número de operación, Número de caja, Monto total
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del plazo (hasta el día 5 del mes siguiente)
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto clara de tu ticket de Sears con el total y el número de transacción.
2. Envía la foto por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud y emitimos la factura automáticamente.
4. Recibe tu CFDI en PDF y XML para deducir.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Esto es relevante para deducibilidad contable: el gasto se reconoce en el ejercicio fiscal de la compra, no de los pagos mensuales.

### shell
*Recupera tu factura de Shell rápidamente*

- **Portal:** https://facturacion.shell.com.mx/
- **Plazo:** 72 horas tras la carga (varía por estación)
- **Datos:** Permiso CRE de la estación, Folio del ticket, Número de estación Shell, Litros y combustible
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No disponible después de 72 horas en la mayoría de franquicias
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Toma una foto del ticket Shell con el total, los litros y el número de estación.
2. Envía la imagen por WhatsApp a Clara Intelligence.
3. Identificamos la estación Shell y generamos tu solicitud de facturación.
4. Recibe tu CFDI deducible en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Recibe tu CFDI deducible en PDF y XML.
> Para deducir 100%, paga con medios electrónicos a nombre del contribuyente.
> Forma de pago electrónicaNecesaria para deducción 100%.
> | Clave SAT genérica | El CFDI debe llevar 15101514 o 15101515 con unidad LTR para que sea deducible como combustible.

### sodimac
*Factura tus compras de Sodimac en México*

- **Portal:** https://www.sodimac.com.mx/sodimac-mx/content/facturacion
- **Plazo:** 30 días naturales desde la fecha de compra
- **Datos:** Número de transacción, Fecha de compra, RFC del receptor, Razón social
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de compra de Sodimac con el folio de transacción visible.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación electrónica de Sodimac.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Para constructores, remodeladores y profesionales del diseño, las compras en Sodimac son gastos deducibles.
> Los materiales de construcción para obra son deducibles como costo de producción o gasto.

### soriana
*Factura tu ticket de Soriana rápidamente*

- **Portal:** https://www.soriana.com/facturacionelectronica/facturacionelectronica.html
- **Plazo:** Hasta 30 días naturales desde la compra
- **Datos:** Folio fiscal del ticket, Número de tienda, Número de caja, Monto total
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Fotografía tu ticket de Soriana asegurándote de que se vea el total y la fecha de compra.
2. Envía la foto a Clara Intelligence por WhatsApp o súbela a nuestra plataforma.
3. El sistema procesa el ticket y genera tu solicitud de facturación.
4. Descarga tu factura CFDI en PDF y XML.

### spotify
*Factura tu suscripción de Spotify en México*

- **Portal:** https://www.spotify.com/mx/account/overview/
- **Plazo:** Mismo mes del cargo
- **Datos:** RFC, razón social, régimen fiscal y código postal
- **Cuenta:** Requiere cuenta de Spotify activa
- **Descarga:** No confirmado · **Reimprimir:** Proceso no confirmado en fuente oficial
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Localiza tu recibo mensual de Spotify en el correo electrónico o en spotify.com/account en la sección de historial de pagos.
2. Envía el comprobante por WhatsApp a Clara Intelligence.
3. Nuestro sistema procesa el cargo y gestiona la solicitud de facturación CFDI.
4. Recibe tu factura CFDI en PDF y XML válida ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si usas Spotify para tu actividad profesional o empresarial, puedes obtener tu factura CFDI mensual deducible.
> El gasto de Spotify Premium puede ser deducible con uso CFDI 'G03 - Gastos en general' si está relacionado con tu actividad.
> El gasto de Spotify Premium puede ser deducible para profesionales creativos, músicos, productores de audio, podcasters, o agencias de entretenimiento que utilizan la plataforma como parte de su actividad económica documentada.

### starbucks
*Factura tu consumo de Starbucks México*

- **Portal:** https://facturacion.starbucks.com.mx/
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Folio de transacción, Número de tienda, Monto total, Forma de pago electrónica
- **Cuenta:** No se requiere cuenta Starbucks Rewards (solo ticket)
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de Starbucks con el folio de transacción y el monto visibles.
2. Envía la foto por WhatsApp a Clara Intelligence dentro del mismo mes calendario.
3. Procesamos tu solicitud y gestionamos la emisión del CFDI.
4. Descarga tu factura en PDF y XML válida ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Si usas Starbucks para reuniones de trabajo o gastos de representación, puedes obtener tu factura CFDI deducible.
> Los consumos en Starbucks son deducibles como gasto de representación con uso CFDI G03.
> Para profesionales que tienen reuniones de trabajo en Starbucks, el consumo es un gasto de representación deducible al 8.5% del monto total (art.
> 28 LISR) siempre que se pague con tarjeta o transferencia electrónica y se emita el CFDI correspondiente.

### subway
*Factura tus compras en Subway México*

- **Portal:** https://facturacion.subway.com.mx/
- **Plazo:** Mismo mes calendario del pedido
- **Datos:** Folio del ticket, Número de sucursal, Fecha de compra
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Subway con el folio, el número de sucursal y el total visibles.
2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
3. Identificamos el portal correcto para tu franquicia de Subway y procesamos tu solicitud.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Solo el 8.5% del monto de restaurante es deducible cuando pagas con tarjeta (art.
> 28 LISR).
> Para las empresas con equipos de campo, representantes de ventas o trabajadores remotos que consumen en Subway con frecuencia, los tickets representan gastos de restaurante deducibles al 8.5% del monto pagado con tarjeta (art.

### tag-pase
*Factura tus casetas con TAG PASE*

- **Portal:** https://www.pase.com.mx/facturacion/facturacion-pase/
- **Plazo:** 30 días naturales desde la fecha del cruce
- **Datos:** Número de tag TAG PASE, Periodo de cruces, RFC del receptor, Razón social
- **Cuenta:** Requiere número de tag TAG PASE
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días del cruce
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Localiza tu estado de cuenta TAG PASE o los comprobantes de tus cruces.
2. Envía el documento por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de TAG PASE.
4. Recibe tu CFDI en PDF y XML válido para deducir tus peajes.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Desde el punto de vista fiscal, los peajes de TAG PASE son totalmente deducibles para personas físicas con actividad empresarial y personas morales que utilizan estos tramos para sus actividades de negocios.

### telcel
*Factura tus pagos y recargas Telcel*

- **Portal:** https://mitelcel.com/
- **Plazo:** Mismo mes calendario del pago
- **Datos:** Número Telcel o folio del recibo, Folio del ticket de pago (si aplica), Monto total, Datos fiscales
- **Cuenta:** Requiere número de línea Telcel o inicio de sesión en mitelcel.com
- **Descarga:** XMLPDF · **Reimprimir:** Sí, disponible en cualquier momento desde mitelcel.com
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Localiza tu recibo de Telcel (correo, app Mi Telcel o ticket de pago).
2. Envía la imagen o PDF por WhatsApp a Clara Intelligence.
3. Procesamos la facturación con los datos del recibo.
4. Recibe tu CFDI en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Forma de pago electrónicaPara que el plan sea 100% deducible (art. 27 LISR).
> | Pago en efectivo limita deducción | Por art. 27 LISR, los pagos superiores a $2,000 deben hacerse con medios electrónicos para ser deducibles.
> Pagos en efectivo del plan tienen tope de deducibilidad.

### televia
*Factura tus casetas con TeleVía*

- **Portal:** https://www.televia.com.mx/tag-televia/facturacion
- **Plazo:** 30 días naturales desde la fecha del cruce
- **Datos:** Número de tag TeleVía, Periodo de cruces, RFC del receptor, Razón social
- **Cuenta:** Requiere número de tag TeleVía
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días del cruce
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Localiza tu estado de cuenta TeleVía o los comprobantes de tus cruces.
2. Envía el documento por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de TeleVía.
4. Recibe tu CFDI en PDF y XML válido para deducir tus peajes.

### tim-hortons
*Factura tus compras en Tim Hortons México*

- **Portal:** https://timhortonsmx.com/es/facturar/new.html
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Folio del ticket, Número de tienda, Fecha y hora del consumo, Monto total
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes el folio se consolida
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Conserva tu ticket de Tim Hortons con el folio, el total y la fecha visible.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud en el portal de facturación de Tim Hortons México.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Para consumos de trabajo o junta, solo el 8.5% del monto es deducible pagando con tarjeta.
> Para los profesionistas y equipos de trabajo que visitan Tim Hortons regularmente, cada ticket representa un pequeño gasto deducible acumulado.
> Si un equipo de cinco personas toma café en Tim Hortons tres veces a la semana a lo largo del año, el gasto anual puede superar los $30,000 pesos, de los cuales el 8.5% ($2,550 pesos) son deducibles bajo el artículo 28 de la LISR.

### uber
*Recupera la factura de tus viajes en Uber*

- **Portal:** https://riders.uber.com/
- **Plazo:** Hasta 72 horas tras el viaje o pedido
- **Datos:** ID del viaje, Fecha y hora del servicio, Monto total cobrado, RFC y razón social
- **Cuenta:** Requiere cuenta de Uber activa
- **Descarga:** XMLPDF · **Reimprimir:** Sí, en la sección Recibos de la app o riders.uber.com
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Abre la app de Uber y toma una captura de pantalla del recibo de tu viaje o pedido de Uber Eats.
2. Envía la captura por WhatsApp a Clara Intelligence.
3. Nuestro sistema detecta que es un recibo de Uber y procesa la facturación automáticamente.
4. Recibe tu CFDI en PDF y XML listo para tus deducciones fiscales.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Cada viaje y pedido de Uber Eats genera un recibo que puede convertirse en factura CFDI deducible.
> Cada empleado debe generar el CFDI con el RFC de la empresa receptora antes de presentar el reembolso; de lo contrario, el ticket queda como gasto no deducible.

### vips-sanborns-toks
*Factura tus consumos en Vips, Sanborns y Toks*

- **Portal:** —
- **Plazo:** Mismo mes calendario del consumo
- **Datos:** Folio del ticket, Número de sucursal, Monto del consumo (sin propina), Datos fiscales
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes ya no es recuperable
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Fotografía tu ticket asegurándote de que se vea el total, la fecha y el número de sucursal.
2. Envía la foto por WhatsApp a Clara Intelligence.
3. Identificamos la cadena (Vips, Sanborns o Toks) y procesamos tu solicitud.
4. Recibe tu factura CFDI en PDF y XML.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> El consumo en restaurante es deducible si pagaste con tarjeta a nombre del contribuyente.
> El consumo en restaurante es deducible al 8.5% (valor referencial) según el art.
> 28 LISR siempre que se pague con tarjeta de crédito o débito empresarial nominativa; el pago en efectivo invalida la deducción aunque tengas CFDI.
> Recuerda: el consumo en restaurante es deducible solo al 8.5% del monto pagado y solo si pagaste con medios electrónicos a nombre del contribuyente.

### viva-aerobus
*Factura tu boleto de Viva Aerobus*

- **Portal:** https://www.vivaaerobus.com/mx/facturacion
- **Plazo:** Mismo mes calendario de la compra del boleto
- **Datos:** Código PNR, Apellido del pasajero, RFC del receptor, Razón social
- **Cuenta:** Solo requiere código de reservación (PNR)
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes de compra el folio se cierra
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Localiza el correo de confirmación de tu boleto Viva Aerobus con el código de reservación (PNR).
2. Envía la captura de pantalla o el PDF del boleto por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Viva Aerobus.
4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de viaje aéreo.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Sus boletos aéreos son deducibles como viáticos para personas con actividad empresarial.

### volaris
*Factura tus vuelos de Volaris automáticamente*

- **Portal:** https://factura.volaris.com/
- **Plazo:** Mismo mes calendario de la compra del boleto
- **Datos:** Código de reserva (PNR), Apellido del pasajero principal, Datos fiscales, PNR de cargos extras
- **Cuenta:** Solo requiere código de reservación (PNR); no cuenta
- **Descarga:** XMLPDF · **Reimprimir:** No, pasado el mes de compra el folio se cierra
- **Ellos lo verificaron:** julio de 2026

**Proceso:**
1. Descarga tu boleto Volaris o toma una captura del correo de confirmación.
2. Envía el comprobante por WhatsApp a Clara Intelligence.
3. Procesamos la facturación con los datos del boleto.
4. Recibe tu CFDI en PDF y XML.

### walmart
*Factura tu ticket de Walmart en minutos*

- **Portal:** https://facturacion.walmartmexico.com.mx/
- **Plazo:** Hasta 30 días naturales desde la compra
- **Datos:** TC – Transacción, TR – Terminal, TD – Tienda, CR – Caja
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro de los 30 días desde el portal
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Fotografía tu ticket de Walmart asegurándote de capturar el código de barras y el total de la compra.
2. Envía la imagen por WhatsApp a Clara Intelligence o cárgala en nuestra plataforma web.
3. Clara identifica el comercio y procesa tu solicitud de facturación automáticamente.
4. Descarga tu factura CFDI en PDF y XML directamente desde WhatsApp o tu panel de usuario.

### zara
*Factura tus compras de Zara en México*

- **Portal:** https://www.zara.com/mx/es/facturacion-c700094.html
- **Plazo:** Mismo mes calendario de la compra
- **Datos:** Número de ticket o pedido, Tienda o canal de compra, Fecha de compra, RFC del receptor
- **Cuenta:** No se requiere cuenta de usuario
- **Descarga:** XMLPDF · **Reimprimir:** Sí, dentro del mismo mes
- **Ellos lo verificaron:** mayo de 2025

**Proceso:**
1. Conserva tu ticket de compra de Zara con el número de folio o ticket.
2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
3. Procesamos tu solicitud con el portal de facturación de Zara México.
4. Recibe tu CFDI en PDF y XML válido ante el SAT.

**Notas fiscales que publican** (sin verificar contra `normas/`):
> Las compras de ropa pueden ser deducibles como uniformes de trabajo o imagen corporativa para personas con actividad empresarial.
> La ropa solo es deducible si es uniforme de trabajo o imagen profesional documentada.
> Aunque la deducibilidad fiscal de la ropa en México es limitada (el SAT solo acepta uniformes de trabajo y prendas de imagen corporativa obligatorias), el proceso de facturación de Zara es el mismo para cualquier compra: lo relevante es que el CFDI exista y que el contador del contribuyente clasifique correctamente la deducibilidad de cada pieza.
> Para los casos en que la ropa de Zara sí es deducible —uniformes para empleados, prendas de imagen para vendedores o representantes que deben vestir un estándar corporativo documentado—, el proceso es facturar al RFC de la empresa y conservar el soporte documental que acredite el uso empresarial obligatorio.