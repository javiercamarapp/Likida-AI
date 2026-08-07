# Roadmap de integraciones y procesos por comercio

**29-jul-2026** · 118 fichas puestas en común de tres directorios + dos verificaciones propias.

## Cómo leer esto, antes que nada

Las fichas están **puestas en común, no verificadas**. Se tomó el mejor dato de
cada fuente con esta prioridad:

| Nivel | Fuente | Cuánto confiar |
|---|---|---|
| 🥇 | **facturado por nosotros** | es verdad; se probó timbrando |
| 🥈 | `facturaelectronicamexico.mx` | prosa detallada con portal real y campos exactos |
| 🥉 | `recuperafacturas.com` (Clara) | ficha estructurada, **con errores comprobados** |

**Solo 2 de 118 están verificadas.** Y en las dos, los directorios estaban mal:
Clara manda G500 a `g500network.com` y el portal real es `megasur.com.mx:8029`.
Trata cada fila como hipótesis hasta facturar un ticket en ella.

### Por qué este documento no tiene 250 fichas

`facturasfacil.com.mx` bloquea el crawler y su extracción página por página
resultó **poco fiable**: en Enerser devolvió como "comercios que usan este
sistema" los enlaces del sidebar de posts relacionados —BP, G500, Hidrosina—,
que no lo usan; y el portal externo salió mal en 2 de 4 pruebas. A 5 créditos
por página, seguir habría producido un catálogo que parece completo y está mal,
que es exactamente lo que le criticamos a Clara. Se cortó a propósito.


---

# El roadmap

## Fase 1 — los verdes de flota (sin cuenta, automatizables hoy)

**13 portales.** Mismo patrón que ya probamos con Megasur: del ticket al UUID
sin que nadie teclee una contraseña. Empezar por los que más aparecen en un viaje de carga.

| Portal | Comercio | Plazo | Datos que pide |
|---|---|---|---|
| `tarjetapetro-7.com.mx` | petro-7, petro-seven | — | — |
| `autozone.com.mx` | autozone | 30 días naturales desde la fecha d | Número de folio de transacción, Fecha de compra, Monto total |
| `gasolineriabp.com.mx` | bp-gasolineras | — | — |
| `facturacion.circlekmexico.com.mx` | circle-k | Mismo mes calendario de la compra | Folio de transacción, Número de tienda, Monto total, Fecha d |
| `megasur.com.mx:8029` | g500 | mes de emisión (impreso en el tick | WebID (uno solo; trae estación, litros, producto, precio, im |
| `servicioaclientes.g500network.com` | g500-network | — | Folio, Web Id, Llenar el captcha |
| `facturacionelectronica.hidrosina.com.mx` | hidrosina | — | — |
| `migasolina.mx` | migasolina | — | Folio, Web Id, Llenar el captcha |
| `mobil.com.mx` | mobil | Varía por operador; factura el mis | Operador de la estación, Número de ticket o folio, Estación  |
| `www4.oxxo.com:9443` | oxxo | 7 días naturales desde la compra | Folio web (ID Web), Monto total, Fecha de compra, RFC del re |
| `facturacion.oxxogas.com` | oxxo-gas | Mismo mes calendario de la carga | Folio de transacción, Fecha de carga, Monto total, Forma de  |
| `facturaelectronicagfa.mx` | primera-plus | Mismo mes calendario del viaje | Número de boleto o folio, Fecha del viaje, RFC del receptor, |
| `facturacion.shell.com.mx` | shell | 72 horas tras la carga (varía por  | Permiso CRE de la estación, Folio del ticket, Número de esta |

## Fase 2 — PINFRA: un alta, 17 autopistas

El mejor cambio de esfuerzo por cobertura de todo el catálogo: **17 autopistas**
con los MISMOS campos de ticket. Exige registro previo, pero es **una cuenta de la
flota**, no una por operador — encaja con el modelo de sesión delegada.

**Campos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora

**Autopistas cubiertas:** autopista-apizaco-huachinango, autopista-armeria-manzanillo, autopista-atlixco-jantetelco, autopista-ecatepec-piramides, autopista-libramiento-aguascalientes, autopista-mexico-la-marquesa, autopista-penon-texcoco, autopista-san-antonio-virreyes-teziutlan, autopista-san-martin-texmelucan-huejotzingo, autopista-san-martin-texmelucan-tlaxcala, autopista-santa-ana-altar, autopista-tenango-ixtapan-de-la-sal, autopista-tlaxcala-puebla, autopista-zitacuaro-lengua-de-vaca, caseta-tezoyuca, pinfra, puente-jose-lopez-portillo


## Fase 3 — los tres sistemas de Pemex

Cubren la mayoría de las 8,000+ estaciones Pemex, que no tienen portal central.
**Ningún directorio publica su estructura**: hay que verificarlos facturando.

| Sistema | Patrón de URL | ¿Cuenta? | Notas |
|---|---|---|---|
| GORM (Brentec) | `gorm.gasolinamexico.net/facturacion_[nombre]` | sí, RFC como usuario | el más usado en grupos medianos y grandes |
| FacturacionEstacion | `[nombre].facturacionestacion.com` | varía | El Roble, Los Pinos, La Morena |
| FacturaGAS | `app.facturagas.net` | varía | independientes, con selector de estación |

**Brentec, verificado en su ficha:** entra con RFC → razón social y correo →
número de facturación del ticket → datos fiscales → descarga XML y PDF.


## Fase 4 — plataformas multi-comercio que salieron de la nada

| Sistema | Portal | ¿Cuenta? | Quién lo usa |
|---|---|---|---|
| **ControlNet** | `controlnet.com.mx` | **no** | Walmart, Alsea, OXXO, gasolineras |
| Polcfdi | `polcfdi.com` | sí | gasolineras Euromexpol · pide estación, WebID, folio y código de verificación |

**ControlNet es el hallazgo suelto más valioso**: multi-comercio y sin cuenta.
Una integración toca varias cadenas grandes. Hay que confirmarlo facturando.


## Con cuenta, de flota

| Portal | Comercio | Qué exige |
|---|---|---|
| `operadoradelasultana.com.mx` | autopista-monterrey-nuevo-laredo | registro previo |
| `bp.com` | bp | registro previo |
| `facturacioncapufe.com.mx` | capufe | registro previo |
| `dhl.com` | dhl | registro previo |
| `estafeta.com` | estafeta | registro previo |
| `fedex.com` | fedex | registro previo |
| `iave.capufe.gob.mx` | iave | registro previo |
| `facturacion.lagas.com.mx` | la-gas | ticket 1670001331723 · $714.75 · folio BOW-2025008 · exige correo+telé |
| `pase.com.mx` | tag-pase | registro previo |
| `televia.com.mx` | televia | registro previo |

## Lo que NO se integra: cuenta personal por usuario

Amazon, Uber, Mercado Libre, Netflix, Spotify, Rappi. **Ninguno es de flota**, y
Zumma los declara fuera de alcance en su propio demo teniendo clientes y equipo.
Aquí el producto es el aviso, no la automatización.


---

# Procesos por comercio

Fichas con su nivel de confianza. 🥇 = facturado por nosotros · 🥈 = prosa detallada · 🥉 = ficha de Clara


### 🥈 autopista-apizaco-huachinango  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista Apizaco Huachinango
  > Selecciona “Facturar Ticket”

### 🥈 autopista-armeria-manzanillo  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista Armeria Manzanillo
  > Selecciona “Facturar Ticket”

### 🥈 autopista-atlixco-jantetelco  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista Atlixco Jantetelco
  > Selecciona “Facturar Ticket”

### 🥈 autopista-ecatepec-piramides  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista Ecatepec Piramides
  > Selecciona “Facturar Ticket”

### 🥈 autopista-libramiento-aguascalientes  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista Libramiento Aguascalientes
  > Selecciona “Facturar Ticket”

### 🥈 autopista-marquesa-lerma-de-villada  🚚
- **Portal:** —
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** —

### 🥈 autopista-mexico-la-marquesa  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación México La Marquesa
  > Selecciona “Facturar Ticket”

### 🥈 autopista-monterrey-nuevo-laredo  🚚
- **Portal:** operadoradelasultana.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > Para realizar la facturación en línea el usuario podrá ingresar a través de la página **http://operadoradelasultana.com.mx/ en el apartado de facturac
  > Selecciona “Facturar Ticket”

### 🥈 autopista-penon-texcoco  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista Peñón Texcoco
  > Selecciona “Facturar Ticket”

### 🥈 autopista-san-antonio-virreyes-teziutlan  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista San Antonio Virreyes Teziutlan
  > Selecciona “Facturar Ticket”

### 🥈 autopista-san-martin-texmelucan-huejotzingo  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista San Martín Texmelucan Huejotzingo
  > Selecciona “Facturar Ticket”

### 🥈 autopista-san-martin-texmelucan-tlaxcala  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista San Martin Texmelucan Tlaxcala
  > Selecciona “Facturar Ticket”

### 🥈 autopista-santa-ana-altar  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista Santa Ana Altar
  > Selecciona “Facturar Ticket”

### 🥈 autopista-tenango-ixtapan-de-la-sal  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista Tenango Ixtapan de la Sal
  > Selecciona “Facturar Ticket”

### 🥈 autopista-tlaxcala-puebla  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Caseta Autopista Tlaxcala Puebla
  > Selecciona “Facturar Ticket”

### 🥈 autopista-zitacuaro-lengua-de-vaca  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Autopista Zitacuaro Lengua de Vaca
  > Selecciona “Facturar Ticket”

### 🥉 autozone  🚚
- **Portal:** autozone.com.mx
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la fecha de compra
- **Datos del ticket:** Número de folio de transacción, Fecha de compra, Monto total, RFC del receptor
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Conserva tu ticket de compra de AutoZone con el número de folio visible.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación electrónica de AutoZone.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos automotrices.

### 🥉 bp  🚚
- **Portal:** bp.com
- **¿Cuenta?** SÍ  ·  **Plazo:** Varía por estación; factura el mismo día de la carga
- **Datos del ticket:** Número de estación BP, Número de folio, Web ID, RFC del receptor
- **Reimprimir:** Sí, desde el portal mientras el folio siga vigente

  **Proceso:**
  1. Conserva tu ticket de BP con el número de estación, el folio y el Web ID visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud en el portal oficial de facturación de BP México.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT para deducir tu combustible.

### 🥈 bp-gasolineras  🚚
- **Portal:** gasolineriabp.com.mx
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** —
- **Contacto:** 800 6680209 contactanos@bp.com

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación BP Gasolineras
  > No se puede ingresar a su pagina para poder facturar

### 🥈 capufe  🚚
- **Portal:** facturacioncapufe.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** 30 días naturales desde la fecha del cruce
- **Datos del ticket:** Código del ticket de 18 caracteres
- **Reimprimir:** Sí, dentro del plazo establecido
- **Contacto:** 442 161 2565, 551 209 1825 contacto@quadrum.com.mx

  **Proceso:**
  1. Conserva el comprobante de pago de tu cruce de caseta CAPUFE con el folio de transacción.
  2. Toma una foto del comprobante y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de CAPUFE.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de peaje.

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de Facturación Capufe
  > Haz click en validar código

### 🥈 caseta-tezoyuca  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > Selecciona “Facturar Ticket”
  > Haz click en “Agregar Ticket”. Si tiene más tickets puede agregarlos.

### 🥉 circle-k  🚚
- **Portal:** facturacion.circlekmexico.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio de transacción, Número de tienda, Monto total, Fecha de compra
- **Reimprimir:** Sí, dentro del plazo establecido

  **Proceso:**
  1. Toma una foto del ticket de Circle K con el folio y el monto total visibles.
  2. Envía la foto por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud y gestionamos la factura con el portal de Circle K.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 dhl  🚚
- **Portal:** dhl.com
- **¿Cuenta?** SÍ  ·  **Plazo:** 30 días naturales desde la fecha del servicio
- **Datos del ticket:** Número de guía (waybill), Fecha del servicio, Monto total, RFC del receptor
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Localiza tu comprobante de envío DHL con el número de guía o waybill visible.
  2. Envía la foto del comprobante por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de DHL México.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de mensajería.

### 🥉 estafeta  🚚
- **Portal:** estafeta.com
- **¿Cuenta?** SÍ  ·  **Plazo:** 30 días naturales desde la fecha del servicio
- **Datos del ticket:** Número de guía, Fecha del servicio, Monto total, RFC del receptor
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Localiza tu comprobante de envío Estafeta con el número de guía o rastreo.
  2. Envía la foto del comprobante por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación electrónica de Estafeta.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de mensajería.

### 🥉 fedex  🚚
- **Portal:** fedex.com
- **¿Cuenta?** SÍ  ·  **Plazo:** 30 días naturales desde la fecha del envío
- **Datos del ticket:** Número de guía, Fecha del servicio, Monto exacto, RFC del receptor
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Localiza tu comprobante de envío o guía de FedEx con el número de rastreo visible.
  2. Envía la foto del comprobante por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de FedEx México.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT para deducir tus gastos de paquetería.

### 🥇 g500  🚚
- **Portal:** megasur.com.mx:8029
- **¿Cuenta?** no  ·  **Plazo:** mes de emisión (impreso en el ticket y en el portal)
- **Datos del ticket:** WebID (uno solo; trae estación, litros, producto, precio, importe y forma de pago)
- **✅ VERIFICADO:** ticket 1000724 · $839.70 · UUID B0800A68-8565-47D9-90E0-CDA7803C50E4
- **Reimprimir:** Depende de la estación; conserva el PDF y XML al emitirlos

  **Proceso:**
  1. Conserva tu ticket de G500 con el nombre de la estación, el permiso CRE y el folio visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Identificamos la estación G500 correcta y procesamos tu solicitud de facturación.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT para deducir tu combustible.

### 🥈 g500-network  🚚
- **Portal:** servicioaclientes.g500network.com
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** Folio, Web Id, Llenar el captcha
- **Contacto:** 55 8842 8000

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación G500 Network
  > Haz click en “Agregar” ticket.

### 🥉 gasolineras  🚚
- **Portal:** —
- **¿Cuenta?** no  ·  **Plazo:** 24 a 72 horas tras la carga
- **Datos del ticket:** Número de permiso CRE, Folio del ticket, Número de estación, Litros y tipo de combustible
- **Reimprimir:** Generalmente no disponible pasadas 72 horas

  **Proceso:**
  1. Toma una foto del ticket de la gasolinera donde se vea el monto, litros y tipo de combustible.
  2. Envía la foto por WhatsApp a Clara Intelligence.
  3. Nuestro sistema identifica la gasolinera y procesa tu facturación automáticamente.
  4. Recibe tu factura CFDI de combustible en PDF y XML.

### 🥈 hidrosina  🚚
- **Portal:** facturacionelectronica.hidrosina.com.mx
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** —
- **Contacto:** (55) 5262-3860 atencionaclientes@hidrosina.com.mx

### 🥉 iave  🚚
- **Portal:** iave.capufe.gob.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** 30 días naturales desde la fecha del cruce
- **Datos del ticket:** Número de tag IAVE, Periodo de facturación, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro de los 30 días del cruce

  **Proceso:**
  1. Localiza tu estado de cuenta IAVE o los comprobantes de tus cruces de caseta.
  2. Envía el documento o foto por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de CAPUFE.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de peaje.

### 🥇 la-gas  🚚
- **Portal:** facturacion.lagas.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** mes de consumo
- **Datos del ticket:** folio + importe
- **✅ VERIFICADO:** ticket 1670001331723 · $714.75 · folio BOW-2025008 · exige correo+teléfono+contraseña

### 🥈 migasolina  🚚
- **Portal:** migasolina.mx
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** Folio, Web Id, Llenar el captcha
- **Contacto:** 01 800 148 55 55 migasolinatrc@gmail.com

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación MiGasolina
  > Haz click en “Agregar” ticket.

### 🥉 mobil  🚚
- **Portal:** mobil.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Varía por operador; factura el mismo día de la carga
- **Datos del ticket:** Operador de la estación, Número de ticket o folio, Estación y hora de carga, RFC del receptor
- **Reimprimir:** Depende del operador de la estación

  **Proceso:**
  1. Conserva tu ticket de Mobil con el nombre del operador, la estación, el folio y la hora de carga visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Identificamos al operador de tu estación Mobil y procesamos la solicitud en su portal de facturación.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT para deducir tu combustible.

### 🥉 oxxo  🚚
- **Portal:** www4.oxxo.com:9443
- **¿Cuenta?** no  ·  **Plazo:** 7 días naturales desde la compra
- **Datos del ticket:** Folio web (ID Web), Monto total, Fecha de compra, RFC del receptor
- **Reimprimir:** Sí, descárgalo de nuevo desde el portal dentro del plazo de 7 días

  **Proceso:**
  1. Toma una foto clara de tu ticket de OXXO donde se vea el total, la fecha y el número de tienda.
  2. Envía la foto por WhatsApp a Clara Intelligence o súbela desde nuestro sitio web.
  3. Nuestro sistema identifica automáticamente que es un ticket de OXXO y extrae los datos necesarios.
  4. Recibe tu factura CFDI en formato PDF y XML, válida ante el SAT para tus deducciones fiscales.

### 🥉 oxxo-gas  🚚
- **Portal:** facturacion.oxxogas.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la carga
- **Datos del ticket:** Folio de transacción, Fecha de carga, Monto total, Forma de pago electrónica
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket de carga de gasolina de OXXO Gas con el folio visible.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de OXXO Gas.
  4. Recibe tu CFDI en PDF y XML válido para deducir tu gasto de combustible.

### 🥉 pemex  🚚
- **Portal:** —
- **¿Cuenta?** no  ·  **Plazo:** 72 horas tras la carga (varía por estación)
- **Datos del ticket:** Número de permiso CRE, Folio del ticket, Número de estación Pemex, Litros y tipo de combustible
- **Reimprimir:** No disponible después de 72 horas en la mayoría de franquicias

  **Proceso:**
  1. Toma una foto del ticket de la estación Pemex que muestre litros, monto y número de estación.
  2. Envía la imagen por WhatsApp a Clara Intelligence.
  3. Identificamos la franquicia y procesamos tu facturación al instante.
  4. Recibe tu CFDI con clave SAT de combustible en PDF y XML.

### 🥈 petro-7  🚚
- **Portal:** tarjetapetro-7.com.mx
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** —
- **Contacto:** 800 01 73876 servicioaclientes@petro-7.com.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Petro 7
  > Haz click en “Agregar Ticket”.

### 🥈 petro-seven  🚚
- **Portal:** tarjetapetro-7.com.mx
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** —
- **Contacto:** 800 01 73876 servicioaclientes@petro-7.com.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Petro seven
  > Haz click en “Agregar Ticket”.

### 🥈 pinfra  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Requisitos de Facturación Pinfra
  > ## Instrucciones de facturación Pinfra

### 🥉 primera-plus  🚚
- **Portal:** facturaelectronicagfa.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del viaje
- **Datos del ticket:** Número de boleto o folio, Fecha del viaje, RFC del receptor, Razón social
- **Reimprimir:** No, pasado el mes el folio se cierra

  **Proceso:**
  1. Conserva tu boleto físico o correo de confirmación de Primera Plus con el número de folio.
  2. Envía la imagen del boleto por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Primera Plus.
  4. Recibe tu CFDI en PDF y XML deducible ante el SAT.

### 🥈 puente-el-prieto  🚚
- **Portal:** —
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** —

### 🥈 puente-jose-lopez-portillo  🚚
- **Portal:** pinfrafacturacion.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Caseta, Fecha, Numero Id, Maquina, Consecutivo, Total, Hora
- **Contacto:** 01800 4440173 o al (0155) 46243535 facturacion@autopistasmichoacan.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Puente Jose Lopez Portillo
  > Selecciona “Facturar Ticket”

### 🥉 shell  🚚
- **Portal:** facturacion.shell.com.mx
- **¿Cuenta?** no  ·  **Plazo:** 72 horas tras la carga (varía por estación)
- **Datos del ticket:** Permiso CRE de la estación, Folio del ticket, Número de estación Shell, Litros y combustible
- **Reimprimir:** No disponible después de 72 horas en la mayoría de franquicias

  **Proceso:**
  1. Toma una foto del ticket Shell con el total, los litros y el número de estación.
  2. Envía la imagen por WhatsApp a Clara Intelligence.
  3. Identificamos la estación Shell y generamos tu solicitud de facturación.
  4. Recibe tu CFDI deducible en PDF y XML.

### 🥉 tag-pase  🚚
- **Portal:** pase.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** 30 días naturales desde la fecha del cruce
- **Datos del ticket:** Número de tag TAG PASE, Periodo de cruces, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro de los 30 días del cruce

  **Proceso:**
  1. Localiza tu estado de cuenta TAG PASE o los comprobantes de tus cruces.
  2. Envía el documento por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de TAG PASE.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus peajes.

### 🥉 televia  🚚
- **Portal:** televia.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** 30 días naturales desde la fecha del cruce
- **Datos del ticket:** Número de tag TeleVía, Periodo de cruces, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro de los 30 días del cruce

  **Proceso:**
  1. Localiza tu estado de cuenta TeleVía o los comprobantes de tus cruces.
  2. Envía el documento por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de TeleVía.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus peajes.

### 🥉 3b
- **Portal:** tiendas3b.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio de transacción, Monto total, Fecha de compra, Datos fiscales
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Toma una foto clara de tu ticket de Tiendas 3B donde se vea el folio, el total y la fecha.
  2. Envía la foto por WhatsApp a Clara Intelligence.
  3. Nuestro sistema identifica automáticamente el ticket y extrae los datos necesarios.
  4. Recibe tu factura CFDI en PDF y XML válida ante el SAT.

### 🥉 50-friends
- **Portal:** 50friends.pv1.mx
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde el consumo
- **Datos del ticket:** Número de folio del ticket, Fecha del consumo, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro de los 30 días naturales

  **Proceso:**
  1. Conserva tu ticket de 50 Friends con el folio y el total visibles.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de 50 Friends.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 7-eleven
- **Portal:** 7-eleven.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio fiscal del ticket, ID de la tienda, Monto total, Fecha de compra
- **Reimprimir:** Sí, dentro del plazo establecido

  **Proceso:**
  1. Fotografía tu ticket de 7-Eleven mostrando el total, la fecha y el número de tienda.
  2. Envía la imagen a Clara Intelligence por WhatsApp.
  3. Nuestro sistema identifica 7-Eleven y procesa la facturación.
  4. Descarga tu CFDI en PDF y XML.

### 🥉 ado
- **Portal:** ado.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del viaje
- **Datos del ticket:** Número de boleto o folio, Fecha del viaje, RFC del receptor, Razón social
- **Reimprimir:** No, pasado el mes el folio se cierra

  **Proceso:**
  1. Conserva tu boleto físico o captura de pantalla del boleto electrónico ADO.
  2. Envía la imagen por WhatsApp a Clara Intelligence con el folio del boleto visible.
  3. Procesamos tu solicitud con el sistema de autofactura de ADO.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de traslado.

### 🥉 aeromexico
- **Portal:** aeromexico.com
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la emisión del boleto
- **Datos del ticket:** Número de boleto (139-XXXXXXXXXX), Apellido del pasajero principal, Datos fiscales, Folios de extras (si aplica)
- **Reimprimir:** No, pasados 30 días el folio se cierra definitivamente

  **Proceso:**
  1. Localiza tu boleto electrónico de Aeroméxico (PDF o pantallazo).
  2. Envía el comprobante por WhatsApp a Clara Intelligence.
  3. Procesamos la facturación con los datos del boleto.
  4. Recibe tu CFDI en PDF y XML.

### 🥉 alsea
- **Portal:** alsea.interfactura.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Folio del ticket, Marca o cadena, Fecha del consumo, RFC del receptor
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Localiza el folio de tu ticket de la marca ALSEA (Domino's, Italianni's, P.F. Chang's, McDonald's, etc.).
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Identificamos la marca ALSEA y seleccionamos la URL correcta en el portal de interfactura.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 amazon
- **Portal:** amazon.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** Hasta 30 días (productos de terceros)
- **Datos del ticket:** Número de pedido, Estatus 'Entregado', RFC y razón social, Código postal fiscal
- **Reimprimir:** Sí, desde Mis pedidos en cualquier momento

  **Proceso:**
  1. Localiza tu comprobante de compra en la app o sitio web de Amazon México.
  2. Toma una captura de pantalla o descarga el comprobante en PDF.
  3. Envía el comprobante por WhatsApp a Clara Intelligence.
  4. Recibe tu factura CFDI electrónica en PDF y XML.

### 🥉 ben-and-frank
- **Portal:** benandfrank.com
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la fecha de compra
- **Datos del ticket:** Número de orden de compra, Fecha de compra, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Conserva tu comprobante de compra de Ben & Frank con el número de orden visible.
  2. Toma una foto del comprobante y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Ben & Frank.
  4. Recibe tu CFDI en PDF y XML deducible como gasto médico ante el SAT.

### 🥉 benavides
- **Portal:** e-facturate.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Número de referencia, RFC del receptor, Razón social, Código postal fiscal
- **Reimprimir:** Sí, mientras el folio siga vigente dentro del mes

  **Proceso:**
  1. Conserva tu ticket de Farmacias Benavides con el número de referencia bajo el código de barras visible.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud en el portal oficial de facturación de Benavides.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 bodega-aurrera
- **Portal:** facturacion.walmartmexico.com.mx
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la fecha de compra
- **Datos del ticket:** TC (Terminal de Caja), TR (Transacción), TD (Terminal Dispositivo), CR (Código de Referencia)
- **Reimprimir:** Sí, dentro de los 30 días desde el portal de Walmart México

  **Proceso:**
  1. Conserva tu ticket de Bodega Aurrerá y toma una foto clara donde se vean el TC, TR, TD y CR en la parte inferior del comprobante.
  2. Envía la foto de tu ticket por WhatsApp a Clara Intelligence.
  3. Ingresamos los datos al portal de facturación de Walmart México (facturacion.walmartmexico.com.mx) seleccionando la cadena Bodega Aurrerá.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT para deducir tus compras de despensa y artículos del hogar.

### 🥉 burger-king
- **Portal:** alsea.interfactura.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Número de ticket, Número de tienda, Fecha de compra, Total pagado
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket de Burger King con el número de ticket, el número de tienda y la razón social del operador visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Identificamos si tu sucursal es de Alsea o de un franquiciatario y procesamos la solicitud en el portal correcto.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 caffenio
- **Portal:** facturaciondrive.caffenio.com
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la fecha de compra
- **Datos del ticket:** Folio de transacción, Código de facturación, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Conserva tu ticket de Caffenio donde se vean el folio y el código de facturación.
  2. Toma una foto clara del ticket asegurándote de que ambos códigos sean legibles.
  3. Envía la foto por WhatsApp a Clara Intelligence.
  4. Recibe tu CFDI 4.0 en PDF y XML válido ante el SAT.

### 🥉 carls-jr
- **Portal:** facturacion.carlsjrmso.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del pedido
- **Datos del ticket:** Folio del ticket, Número de tienda, Fecha de compra
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket de Carl's Jr. con el folio, el número de tienda y el total visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Identificamos la franquicia MSO de Carl's Jr. y procesamos tu solicitud.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 casa-de-tono
- **Portal:** lacasadetono.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Folio del ticket, Número de sucursal, Fecha de consumo
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket de Casa de Toño con el folio, el número de sucursal y el total visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud a través del portal de facturación de Casa de Toño.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 chedraui
- **Portal:** michedraui.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Hasta 30 días naturales desde la compra
- **Datos del ticket:** Folio del ticket, Número de tienda, Número de caja, Importe total
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Toma una foto clara del ticket de Chedraui incluyendo el código de barras y el total.
  2. Envía la imagen por WhatsApp a Clara Intelligence.
  3. Nuestro sistema procesa el ticket y gestiona la facturación automáticamente.
  4. Recibe tu CFDI válido en PDF y XML.

### 🥉 cinepolis
- **Portal:** cinepolis.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la función
- **Datos del ticket:** Número de folio o de orden, Fecha de la función, Complejo Cinépolis, RFC del receptor
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket o comprobante de compra de Cinépolis con el número de folio.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Cinépolis.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT para tus gastos de entretenimiento.

### 🥉 city-market
- **Portal:** citymarket.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio de transacción, Número de tienda, Monto total, Datos fiscales
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de City Market con el folio de transacción y el monto.
  2. Envía la foto por WhatsApp a Clara Intelligence dentro del mes calendario.
  3. Procesamos tu solicitud y gestionamos la emisión del CFDI.
  4. Recibe tu factura en PDF y XML válida ante el SAT.

### 🥉 comex
- **Portal:** comex.com.mx
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la compra
- **Datos del ticket:** Folio del ticket, Fecha de compra, Monto total, Uso del CFDI
- **Reimprimir:** Sí, dentro de los 30 días del plazo

  **Proceso:**
  1. Conserva tu ticket de Comex con el folio, el total y la fecha visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Comex.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥈 concesionaria-mexiquense
- **Portal:** circuitoexterior.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** —
- **Datos del ticket:** Folio, Fecha, Horas, Minutos, Segundos, Plaza de Cobro, Carril, Categoría
- **Contacto:** 13-28-12-36 (Facturación, Opción 3) tuopinion@circuitoexterior.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Concesionaria Mexiquense
  > Selecciona “Agregar tickets para facturar”

### 🥉 coppel
- **Portal:** facturas.coppel.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio del ticket, Fecha de compra, Monto total, Datos fiscales
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Toma una foto de tu ticket de Coppel con el total y la fecha visibles.
  2. Envía la imagen por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud automáticamente con el portal Coppel.
  4. Recibe tu CFDI en PDF y XML.

### 🥈 corpogas
- **Portal:** facturasgas.com
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** —
- **Contacto:** 55 5511 2186 Contacto@gruposynergo.com

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Corpogas
  > Quiero facturar y me dice que no coincide mi correo

### 🥉 costco
- **Portal:** costco.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** Hasta 30 días naturales desde la compra
- **Datos del ticket:** Número de membresía Costco, Folio del ticket, Fecha de compra, Monto total
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Toma una foto de tu ticket de Costco donde se vea claramente el número de membresía y el total.
  2. Envía la foto por WhatsApp a Clara Intelligence.
  3. El sistema detecta que es un ticket de Costco y procesa tu facturación.
  4. Descarga tu factura CFDI en PDF y XML.

### 🥉 dairy-queen-mexico
- **Portal:** facturacion.dequ.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Folio del ticket, Número de tienda, Fecha de compra
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket de Dairy Queen con el folio, el número de tienda y el total visibles.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Identificamos la franquicia de Dairy Queen y procesamos tu solicitud.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 didi
- **Portal:** —
- **¿Cuenta?** SÍ  ·  **Plazo:** 7 días naturales tras el viaje o pedido
- **Datos del ticket:** ID del viaje o pedido, Fecha y hora del servicio, Monto total, RFC del solicitante
- **Reimprimir:** Sí, en Mis recibos dentro de la app

  **Proceso:**
  1. Toma una captura de pantalla del recibo de tu viaje en DiDi o pedido de DiDi Food.
  2. Envía la imagen a Clara Intelligence por WhatsApp.
  3. El sistema procesa tu recibo y genera la solicitud de facturación.
  4. Descarga tu factura CFDI válida en PDF y XML.

### 🥉 dominos
- **Portal:** alsea.interfactura.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del pedido
- **Datos del ticket:** Folio del ticket o número de pedido, Fecha del pedido, Monto total, Forma de pago electrónica
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket o comprobante de pedido de Domino's con el folio visible.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Domino's (Alsea).
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 farmacia-del-ahorro
- **Portal:** fahorro.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio fiscal del ticket, Número de tienda, Monto total, Datos fiscales
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Toma una foto de tu ticket de Farmacia del Ahorro con el total y la fecha.
  2. Envía la imagen por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de Farmacia del Ahorro.
  4. Recibe tu CFDI en PDF y XML.

### 🥉 farmacias-guadalajara
- **Portal:** farmaciasguadalajara.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio del ticket, Número de tienda, Monto total, Forma de pago electrónica
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de Farmacias Guadalajara con el folio, número de tienda y monto.
  2. Envía la foto por WhatsApp a Clara Intelligence dentro del mismo mes calendario.
  3. Procesamos tu solicitud y emitimos el CFDI automáticamente.
  4. Descarga tu factura en PDF y XML válida ante el SAT.

### 🥉 farmacias-san-pablo
- **Portal:** sanpablo.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio del ticket, Número de tienda, Monto total, Forma de pago electrónica
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de Farmacias San Pablo con el folio y el monto total.
  2. Envía la foto por WhatsApp a Clara Intelligence dentro del mismo mes.
  3. Nuestro sistema procesa tu solicitud y emite el CFDI.
  4. Recibe tu factura en PDF y XML válida ante el SAT para deducir.

### 🥉 farmacias-similares
- **Portal:** facturacion.gpupm.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio del ticket, Fecha de compra, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de Farmacias Similares con el monto y la fecha visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el sistema de Farmacias Similares.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥈 gasofac
- **Portal:** gasofac.com.mx
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** Numero de ticket, Fecha de Ticket, Importe del Ticket
- **Contacto:** **Correo electrónico**: ventas@gasofac.com.mx ventas@gasofac.com.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Gasofac

### 🥈 goodprice
- **Portal:** goodpriceg.com
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** Folio, Web Id, Llenar el captcha
- **Contacto:** 81 8326 4956 81 8141 0553 81 2670 7969

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Goodprice
  > Haz click en “Agregar” ticket.

### 🥉 heb
- **Portal:** heb.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio de transacción, Monto total, Fecha de compra, Datos fiscales
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Fotografía tu ticket de HEB asegurándote de capturar el folio y el monto total.
  2. Envía la foto por WhatsApp a Clara Intelligence.
  3. Nuestro sistema procesa la solicitud y gestiona la facturación.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 home-depot
- **Portal:** homedepot.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Hasta 30 días naturales desde la compra
- **Datos del ticket:** Folio fiscal, Número de tienda, Número de operación, Monto total
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Fotografía tu ticket de Home Depot asegurándote de capturar el total y el número de ticket.
  2. Envía la foto por WhatsApp a Clara Intelligence o cárgala en nuestra plataforma.
  3. Clara procesa el ticket automáticamente e inicia la facturación.
  4. Recibe tu CFDI en PDF y XML listo para tus deducciones.

### 🥉 ikea
- **Portal:** v2.dito.com.mx
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la fecha de compra
- **Datos del ticket:** Número de ticket u orden, Fecha de compra, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro de los 30 días desde el portal Dito

  **Proceso:**
  1. Conserva tu ticket de IKEA México con el número de orden o folio visible.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud a través del portal de autofactura Dito de IKEA.
  4. Recibe tu CFDI en PDF y XML válido para deducir muebles y artículos de oficina.

### 🥉 italiannis
- **Portal:** alsea.interfactura.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Folio del ticket, Fecha del consumo, RFC del receptor, Razón social
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket de Italianni's con el folio y el número de sucursal visibles.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Identificamos Italianni's como marca ALSEA y accedemos al portal correcto.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 izzi
- **Portal:** izzi.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** Mismo ciclo de facturación mensual
- **Datos del ticket:** Número de cuenta Izzi, Periodo de facturación, Datos fiscales, Forma de pago electrónica
- **Reimprimir:** Sí, en cualquier momento desde izzi.mx

  **Proceso:**
  1. Localiza tu recibo o comprobante de pago de Izzi (correo de factura mensual o ticket de pago en sucursal).
  2. Envía el comprobante por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud y gestionamos la emisión del CFDI.
  4. Recibe tu factura en PDF y XML válida ante el SAT para deducir.

### 🥉 kfc
- **Portal:** kfc.teagradece.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del pedido
- **Datos del ticket:** Número de folio del ticket, Fecha del pedido, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de KFC donde se vea el folio, el total y el nombre de la sucursal.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Identificamos la franquicia de KFC y procesamos tu solicitud de facturación.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 krispy-kreme
- **Portal:** facturacion.krispykreme.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Número de folio del ticket, Fecha de compra, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de Krispy Kreme con el número de folio visible.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Krispy Kreme México.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 la-comer
- **Portal:** lacomer.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio de transacción, Fecha de compra, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de La Comer con el folio de transacción y el monto visible.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de La Comer.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de despensa y operación.

### 🥉 laboratorio-chopo
- **Portal:** chopo.com.mx
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la fecha del servicio
- **Datos del ticket:** Número de orden, Fecha del servicio, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Conserva tu comprobante de pago de Laboratorio Chopo con el número de orden visible.
  2. Toma una foto clara del comprobante y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Laboratorio Chopo.
  4. Recibe tu CFDI en PDF y XML deducible como gasto médico personal.

### 🥉 little-caesars
- **Portal:** facturacion.littlecaesars.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio de orden, Número de tienda, Monto total, Forma de pago electrónica
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de Little Caesars con el folio y el total de la compra.
  2. Envía la foto por WhatsApp a Clara Intelligence dentro del mismo mes.
  3. Procesamos tu solicitud y gestionamos la emisión del CFDI.
  4. Recibe tu factura en PDF y XML válida ante el SAT.

### 🥉 liverpool
- **Portal:** facturacionclientes.liverpool.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Hasta 30 días naturales desde la compra
- **Datos del ticket:** Folio fiscal, Monto total, Fecha de compra, RFC del receptor
- **Reimprimir:** Sí, dentro de los 30 días desde el portal

  **Proceso:**
  1. Toma una foto de tu ticket de Liverpool donde aparezca el total y el número de transacción.
  2. Envía la foto por WhatsApp a Clara Intelligence.
  3. Nuestro sistema identifica Liverpool como el comercio y procesa la facturación.
  4. Recibe tu CFDI en PDF y XML listo para descargar.

### 🥉 mcdonalds
- **Portal:** facturacionmcdonalds.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Número de restaurante, Número de ticket, Número de caja, Fecha de compra
- **Reimprimir:** Sí, dentro del mismo mes desde el portal con los datos del ticket

  **Proceso:**
  1. Conserva tu ticket de McDonald's con el número de restaurante, el número de ticket y la fecha visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud en el portal oficial de facturación de McDonald's México.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 mercado-libre
- **Portal:** mercadolibre.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** Primeros días del mes siguiente
- **Datos del ticket:** RFC, razón social, régimen fiscal y código postal
- **Reimprimir:** Sí, desde Mis compras en cualquier momento

  **Proceso:**
  1. Descarga o captura el comprobante de tu compra en Mercado Libre (confirmación de pago o número de pedido).
  2. Envía el comprobante por WhatsApp a Clara Intelligence o súbelo desde nuestra plataforma.
  3. Nuestro sistema extrae los datos del pedido e inicia la solicitud de facturación.
  4. Recibe tu factura CFDI en formato PDF y XML, válida ante el SAT para tus deducciones fiscales.

### 🥉 netflix
- **Portal:** netflix.com
- **¿Cuenta?** SÍ  ·  **Plazo:** Mismo mes del cargo
- **Datos del ticket:** RFC, razón social, régimen fiscal y código postal
- **Reimprimir:** Proceso no confirmado en fuente oficial

  **Proceso:**
  1. Localiza tu recibo mensual de Netflix en el correo electrónico o en la sección 'Cuenta > Ver historial de facturación' de Netflix.
  2. Envía el comprobante por WhatsApp a Clara Intelligence o súbelo desde nuestra plataforma.
  3. Nuestro sistema extrae los datos del cargo y gestiona la solicitud de facturación CFDI.
  4. Recibe tu factura CFDI en PDF y XML válida ante el SAT.

### 🥉 nutrisa
- **Portal:** —
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Folio del ticket, Número de sucursal, Fecha de compra
- **Reimprimir:** Consultar con sucursal

  **Proceso:**
  1. Conserva tu ticket de Nutrisa con el folio, el número de sucursal y el total visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Verificamos el portal de facturación disponible para tu sucursal de Nutrisa.
  4. Recibes tu CFDI o la orientación necesaria para obtenerlo directamente en sucursal.

### 🥉 office-depot
- **Portal:** facturacion.officedepot.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Hasta 30 días naturales desde la compra
- **Datos del ticket:** Folio del ticket, Número de tienda, Monto total, Datos fiscales
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Toma una foto del ticket de Office Depot mostrando el total y la fecha.
  2. Envía la imagen por WhatsApp a Clara Intelligence.
  3. Procesamos tu ticket y generamos la solicitud de facturación.
  4. Recibe tu CFDI en PDF y XML válido para deducción.

### 🥉 officemax
- **Portal:** facturacion.officemax.com.mx
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la fecha de compra
- **Datos del ticket:** Número de transacción, Fecha de compra, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Conserva tu ticket de compra de OfficeMax con el número de transacción visible.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación electrónica de OfficeMax.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus compras de oficina.

### 🥉 opticas-devlyn
- **Portal:** posap.devlyn.me
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio del ticket, Fecha de compra, Monto total, Prescripción del optometrista
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de Ópticas Devlyn con el folio y el monto total visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Devlyn.
  4. Recibe tu CFDI en PDF y XML deducible como gasto médico ante el SAT.

### 🥉 opticas-lux
- **Portal:** lux.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Número de folio del comprobante, Fecha de compra, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu comprobante de compra de Ópticas Lux con el folio visible.
  2. Toma una foto clara del comprobante y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Ópticas Lux.
  4. Recibe tu CFDI en PDF y XML deducible como gasto médico.

### 🥈 orsan-en-linea
- **Portal:** facturacion.orsan.com.mx
- **¿Cuenta?** no  ·  **Plazo:** —
- **Datos del ticket:** Tipo de pago, Método de pago, Uso de CFDI, Transacción, Digito Verificador
- **Contacto:** 81 1878 0465 sd@orsan.com.mx

  **Fallas reportadas por usuarios** (evidencia de que el portal se cae):
  > ## Instrucciones de facturación Orsan
  > Haz click en “buscar”, para que se carguen los datos del ticket.

### 🥉 palacio-de-hierro
- **Portal:** facturacion.elpalaciodehierro.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Número de transacción, Número de tienda, Monto total, Forma de pago
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de El Palacio de Hierro con el folio y el monto total visibles.
  2. Envía la foto por WhatsApp a Clara Intelligence dentro del mes calendario.
  3. Nuestro sistema procesa la solicitud y gestiona el CFDI.
  4. Recibe tu factura en PDF y XML válida ante el SAT.

### 🥉 panaderia-el-globo
- **Portal:** —
- **¿Cuenta?** SÍ  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Folio del ticket, Número de sucursal, Fecha de compra
- **Reimprimir:** Consultar con sucursal

  **Proceso:**
  1. Conserva tu ticket de El Globo con el folio, el número de sucursal y el total visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Verificamos el portal de facturación disponible para Panadería El Globo.
  4. Recibes tu CFDI o la orientación para obtenerlo directamente en sucursal.

### 🥉 pastelerias-esperanza
- **Portal:** cfdi.esperanza.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio del ticket, Fecha de compra, RFC del receptor, Razón social
- **Reimprimir:** Sí, descárgalo desde el portal cfdi.esperanza.mx

  **Proceso:**
  1. Conserva tu ticket de Pastelerías Esperanza con el folio y el monto visibles.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud en el portal cfdi.esperanza.mx.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 pastelerias-marisa
- **Portal:** facturacion.simang8.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio del ticket, Número de sucursal, Fecha de compra, Monto total
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket de Pastelerías Marisa con el folio y el monto visibles.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud a través del portal de facturación de Marisa.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 pf-changs
- **Portal:** alsea.interfactura.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Folio del ticket, Fecha del consumo, RFC del receptor, Razón social
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket de P.F. Chang's con el folio y el número de sucursal visibles.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Identificamos P.F. Chang's como marca ALSEA y accedemos a la URL correcta.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 rappi
- **Portal:** rappi.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** Hasta 72 horas después del pedido
- **Datos del ticket:** RFC, razón social, régimen fiscal y código postal
- **Reimprimir:** Proceso no confirmado en fuente oficial

  **Proceso:**
  1. Abre la app de Rappi y captura el comprobante del pedido que quieres facturar.
  2. Envía la captura por WhatsApp a Clara Intelligence.
  3. Nuestro sistema procesa tu pedido y gestiona la solicitud de facturación CFDI.
  4. Recibe tu factura CFDI en PDF y XML válida ante el SAT.

### 🥉 salud-digna
- **Portal:** —
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la fecha del servicio
- **Datos del ticket:** Número de orden, Fecha del servicio, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Conserva tu comprobante de pago de Salud Digna con el número de orden o folio.
  2. Toma una foto clara del comprobante y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de Salud Digna.
  4. Recibe tu CFDI en PDF y XML deducible como gasto médico personal.

### 🥉 sams-club
- **Portal:** facturacion.walmartmexico.com.mx
- **¿Cuenta?** SÍ  ·  **Plazo:** Hasta 30 días naturales desde la compra
- **Datos del ticket:** Número de socio Sam's Club, Folio del ticket, Número de tienda, Monto total
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Toma una foto clara de tu ticket de Sam's Club donde se vean el total, la fecha y tu número de membresía.
  2. Envía la foto por WhatsApp a Clara Intelligence.
  3. El sistema detecta que es un ticket de Sam's Club y procesa la facturación.
  4. Recibe tu CFDI en PDF y XML listo para deducir.

### 🥉 sears
- **Portal:** facturaelectronica.sears.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Hasta el día 5 del mes siguiente
- **Datos del ticket:** Número de tienda, Número de operación, Número de caja, Monto total
- **Reimprimir:** Sí, dentro del plazo (hasta el día 5 del mes siguiente)

  **Proceso:**
  1. Toma una foto clara de tu ticket de Sears con el total y el número de transacción.
  2. Envía la foto por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud y emitimos la factura automáticamente.
  4. Recibe tu CFDI en PDF y XML para deducir.

### 🥉 sodimac
- **Portal:** sodimac.com.mx
- **¿Cuenta?** no  ·  **Plazo:** 30 días naturales desde la fecha de compra
- **Datos del ticket:** Número de transacción, Fecha de compra, RFC del receptor, Razón social
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de compra de Sodimac con el folio de transacción visible.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación electrónica de Sodimac.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 soriana
- **Portal:** soriana.com
- **¿Cuenta?** no  ·  **Plazo:** Hasta 30 días naturales desde la compra
- **Datos del ticket:** Folio fiscal del ticket, Número de tienda, Número de caja, Monto total
- **Reimprimir:** Sí, dentro de los 30 días

  **Proceso:**
  1. Fotografía tu ticket de Soriana asegurándote de que se vea el total y la fecha de compra.
  2. Envía la foto a Clara Intelligence por WhatsApp o súbela a nuestra plataforma.
  3. El sistema procesa el ticket y genera tu solicitud de facturación.
  4. Descarga tu factura CFDI en PDF y XML.

### 🥉 spotify
- **Portal:** spotify.com
- **¿Cuenta?** SÍ  ·  **Plazo:** Mismo mes del cargo
- **Datos del ticket:** RFC, razón social, régimen fiscal y código postal
- **Reimprimir:** Proceso no confirmado en fuente oficial

  **Proceso:**
  1. Localiza tu recibo mensual de Spotify en el correo electrónico o en spotify.com/account en la sección de historial de pagos.
  2. Envía el comprobante por WhatsApp a Clara Intelligence.
  3. Nuestro sistema procesa el cargo y gestiona la solicitud de facturación CFDI.
  4. Recibe tu factura CFDI en PDF y XML válida ante el SAT.

### 🥉 starbucks
- **Portal:** facturacion.starbucks.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Folio de transacción, Número de tienda, Monto total, Forma de pago electrónica
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de Starbucks con el folio de transacción y el monto visibles.
  2. Envía la foto por WhatsApp a Clara Intelligence dentro del mismo mes calendario.
  3. Procesamos tu solicitud y gestionamos la emisión del CFDI.
  4. Descarga tu factura en PDF y XML válida ante el SAT.

### 🥉 subway
- **Portal:** facturacion.subway.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del pedido
- **Datos del ticket:** Folio del ticket, Número de sucursal, Fecha de compra
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket de Subway con el folio, el número de sucursal y el total visibles.
  2. Toma una foto del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Identificamos el portal correcto para tu franquicia de Subway y procesamos tu solicitud.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 telcel
- **Portal:** mitelcel.com
- **¿Cuenta?** SÍ  ·  **Plazo:** Mismo mes calendario del pago
- **Datos del ticket:** Número Telcel o folio del recibo, Folio del ticket de pago (si aplica), Monto total, Datos fiscales
- **Reimprimir:** Sí, disponible en cualquier momento desde mitelcel.com

  **Proceso:**
  1. Localiza tu recibo de Telcel (correo, app Mi Telcel o ticket de pago).
  2. Envía la imagen o PDF por WhatsApp a Clara Intelligence.
  3. Procesamos la facturación con los datos del recibo.
  4. Recibe tu CFDI en PDF y XML.

### 🥉 tim-hortons
- **Portal:** timhortonsmx.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Folio del ticket, Número de tienda, Fecha y hora del consumo, Monto total
- **Reimprimir:** No, pasado el mes el folio se consolida

  **Proceso:**
  1. Conserva tu ticket de Tim Hortons con el folio, el total y la fecha visible.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud en el portal de facturación de Tim Hortons México.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.

### 🥉 uber
- **Portal:** riders.uber.com
- **¿Cuenta?** SÍ  ·  **Plazo:** Hasta 72 horas tras el viaje o pedido
- **Datos del ticket:** ID del viaje, Fecha y hora del servicio, Monto total cobrado, RFC y razón social
- **Reimprimir:** Sí, en la sección Recibos de la app o riders.uber.com

  **Proceso:**
  1. Abre la app de Uber y toma una captura de pantalla del recibo de tu viaje o pedido de Uber Eats.
  2. Envía la captura por WhatsApp a Clara Intelligence.
  3. Nuestro sistema detecta que es un recibo de Uber y procesa la facturación automáticamente.
  4. Recibe tu CFDI en PDF y XML listo para tus deducciones fiscales.

### 🥉 vips-sanborns-toks
- **Portal:** —
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario del consumo
- **Datos del ticket:** Folio del ticket, Número de sucursal, Monto del consumo (sin propina), Datos fiscales
- **Reimprimir:** No, pasado el mes ya no es recuperable

  **Proceso:**
  1. Fotografía tu ticket asegurándote de que se vea el total, la fecha y el número de sucursal.
  2. Envía la foto por WhatsApp a Clara Intelligence.
  3. Identificamos la cadena (Vips, Sanborns o Toks) y procesamos tu solicitud.
  4. Recibe tu factura CFDI en PDF y XML.

### 🥉 viva-aerobus
- **Portal:** vivaaerobus.com
- **¿Cuenta?** SÍ  ·  **Plazo:** Mismo mes calendario de la compra del boleto
- **Datos del ticket:** Código PNR, Apellido del pasajero, RFC del receptor, Razón social
- **Reimprimir:** No, pasado el mes de compra el folio se cierra

  **Proceso:**
  1. Localiza el correo de confirmación de tu boleto Viva Aerobus con el código de reservación (PNR).
  2. Envía la captura de pantalla o el PDF del boleto por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Viva Aerobus.
  4. Recibe tu CFDI en PDF y XML válido para deducir tus gastos de viaje aéreo.

### 🥉 volaris
- **Portal:** factura.volaris.com
- **¿Cuenta?** SÍ  ·  **Plazo:** Mismo mes calendario de la compra del boleto
- **Datos del ticket:** Código de reserva (PNR), Apellido del pasajero principal, Datos fiscales, PNR de cargos extras
- **Reimprimir:** No, pasado el mes de compra el folio se cierra

  **Proceso:**
  1. Descarga tu boleto Volaris o toma una captura del correo de confirmación.
  2. Envía el comprobante por WhatsApp a Clara Intelligence.
  3. Procesamos la facturación con los datos del boleto.
  4. Recibe tu CFDI en PDF y XML.

### 🥉 walmart
- **Portal:** facturacion.walmartmexico.com.mx
- **¿Cuenta?** no  ·  **Plazo:** Hasta 30 días naturales desde la compra
- **Datos del ticket:** TC – Transacción, TR – Terminal, TD – Tienda, CR – Caja
- **Reimprimir:** Sí, dentro de los 30 días desde el portal

  **Proceso:**
  1. Fotografía tu ticket de Walmart asegurándote de capturar el código de barras y el total de la compra.
  2. Envía la imagen por WhatsApp a Clara Intelligence o cárgala en nuestra plataforma web.
  3. Clara identifica el comercio y procesa tu solicitud de facturación automáticamente.
  4. Descarga tu factura CFDI en PDF y XML directamente desde WhatsApp o tu panel de usuario.

### 🥉 zara
- **Portal:** zara.com
- **¿Cuenta?** no  ·  **Plazo:** Mismo mes calendario de la compra
- **Datos del ticket:** Número de ticket o pedido, Tienda o canal de compra, Fecha de compra, RFC del receptor
- **Reimprimir:** Sí, dentro del mismo mes

  **Proceso:**
  1. Conserva tu ticket de compra de Zara con el número de folio o ticket.
  2. Toma una foto clara del ticket y envíala por WhatsApp a Clara Intelligence.
  3. Procesamos tu solicitud con el portal de facturación de Zara México.
  4. Recibe tu CFDI en PDF y XML válido ante el SAT.