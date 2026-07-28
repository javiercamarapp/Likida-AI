# Competencia: Zumma, Clara Intelligence, FacturaGPT y demás

> Investigado el 27-jul-2026 para Likida.ai. Fundamentos citados. Lo no verificado va marcado.

---

## Resumen para el fundador

Convertir la foto de un ticket en CFDI **ya no es un producto, es un insumo**. Clara lo regala gratis por WhatsApp a cualquiera en México sin pedir que seas su cliente. FacturaGPT lo vende como API a **$4 MXN + IVA por CFDI exitoso** a quien lo quiera meter en su producto. Zumma cobra $300–$550 MXN al mes por 25–50 facturas y un solo usuario. Ese pedazo del problema está resuelto, tiene precio de commodity y va camino a cero. Si Likida lo vende como su producto, va a competir contra algo gratis.

El competidor de verdad no es ninguno de los tres del encargo. Es **Mendel**: compró TeFacturo en 2023, y en **mayo de 2026 lanzó con Visa la "Tarjeta Mendel Flotilla"** — una tarjeta que se conecta al TMS, se activa sola cuando hay viaje en curso y se apaga al terminar, con límite de litros por carga, reglas por unidad y por conductor, categorías de combustible / casetas / comida / hospedaje / reparaciones / viáticos, y recuperación de CFDI validada contra el SAT. Dicen 500+ flotillas en México y citan a Estafeta, Jumex, ER Logística y Delmar. Eso es exactamente el vecindario de Likida, con Visa detrás.

Y hay dos hechos fiscales que cambian la promesa comercial:

1. **El diésel pagado en efectivo no es deducible aunque lo factures** (LISR art. 27, fr. III, 2º párrafo). Es justo lo que hace el operador en carretera. Vender "te hacemos deducible el diésel del operador" es vender algo que la ley no permite.
2. **Si la flota ya usa un monedero electrónico de combustible autorizado por el SAT** (Edenred Ticket Car y similares), la gasolinera legalmente **no debe emitirle CFDI** al cliente: el emisor del monedero manda un CFDI con complemento de estado de cuenta (RMF 2026, regla 3.3.1.7). Ahí no hay ticket que facturar. El problema ya está resuelto por otra vía.

Lo que **nadie** hace: **liquidar el viaje**. Todos entregan "facturas" o "gastos conciliados". Ninguno cierra el círculo de *anticipo entregado − gastos comprobados = saldo a favor o en contra del operador*, que es lo que el contralor de una flota firma cada semana. Ese es el hueco, y es defendible porque requiere el viaje como unidad de dato, no el ticket.

El segmento también está libre: Mendel vende a Estafeta y Jumex, Clara a corporativos, Zumma tiene planes de un solo usuario. En México, **95% de las más de 200,000 empresas de autotransporte tiene menos de 30 camiones** (dato de prensa, ver Fuentes). Nadie les está vendiendo bien.

Riesgo nuevo y serio: desde la reforma publicada en el **DOF el 07-nov-2025**, el CFF art. 29-A fracción IX dice que un CFDI que no ampara una operación real **se considera falso**. "Facturamos cualquier ticket" pasó de ser un eslogan a ser una exposición.

---

## 1. Cómo está partido el mercado (mapa antes de los perfiles)

No todos los que "facturan tickets" hacen lo mismo. Hay cinco capas distintas y confundirlas es el error más caro:

| Capa | Qué hace | Quién está ahí | Precio de referencia |
|---|---|---|---|
| **A. Robot de autofacturación** | Entra al portal del comercio y saca el CFDI. Infraestructura pura. | FacturaGPT (API), el motor interno de Clara / Mendel / Fotofacturas | $4 MXN + IVA por CFDI exitoso (FacturaGPT) |
| **B. App de gastos para persona** | Foto → CFDI, cuota mensual con tope de tickets | Fotofacturas, FacturaApp, Zumma (planes bajos), Clara (plan gratis) | $0 a $999 MXN/mes |
| **C. Plataforma de gasto corporativo** | Tarjeta + política + aprobaciones + ERP + recuperación de CFDI | Mendel, Clara, Zumma (Enterprise) | Cotización |
| **D. Medio de pago con CFDI resuelto por ley** | Monedero de combustible autorizado / TAG de peaje: el emisor factura, no el comercio | Edenred Ticket Car, IAVE, PASE, TeleVía | Comisión / tarifa |
| **E. TMS de autotransporte** | Viaje, carta porte, liquidación de operador, nómina | SIGA, TransportePRO, ControLT, GMTransport, Facturei | Licencia / suscripción |

**Likida vive entre C, D y E, y no debe intentar ganar en A ni en B.** La capa A es un costo variable que se compra. La capa B es un mercado de $99/mes con producto gratuito compitiendo.

---

## 2. Zumma Financial

**Sitio:** zummafinancial.com · **Agente:** "Zummi" · **Canal:** WhatsApp + panel web

### Mecánica exacta (verificado en su sitio)

1. El empleado manda foto o PDF del ticket por WhatsApp.
2. Zummi solicita la factura al comercio (persigue al comercio por el usuario).
3. El usuario revisa el estado en el Panel de Control.
4. Descarga archivos y reportes desde la plataforma.
5. Sincronización con ERP — solo en el plan Enterprise.

En su página de empresas dicen: *"Send a picture of your receipt through WhatsApp, select the details you want to see in your invoice and wait for your invoice to be sent through email and WhatsApp in minutes!"* — pero en otra parte del sitio prometen **"en menos de 24 horas"**. **Es una contradicción de su propio marketing** y vale la pena tenerla anotada: nadie en este mercado entrega en minutos de forma consistente, porque el cuello de botella es el portal del comercio, no el OCR.

### Precios (verificado textualmente en zummafinancial.com/en/planes-y-precios)

| Plan | Precio | Facturas | Usuarios | Empresas | Entrega |
|---|---|---|---|---|---|
| **Basic** | **$300 MXN / mes** | hasta 25 facturas de gasto | 1 por razón social | 1 | WhatsApp y email |
| **Small company** | **$550 MXN / mes** | hasta 50 facturas de gasto | 1 por razón social | 1 | WhatsApp y email |
| **Enterprise** (marcado "Most popular") | Personalizado | a medida | a medida | a medida | Dashboard + **conectar ERP** |

**Lectura para Likida:** el plan de $300–$550 es **inservible para una flota**. Un solo usuario por razón social significa que no puedes darle acceso a 20 operadores. Y 25–50 facturas al mes las quema una flota de 10 camiones en una semana. Zumma está vendiendo a la persona física y a la micro empresa; el segmento de flota lo tienen que empujar a Enterprise con venta consultiva, que es lento y caro.

### Cobertura, clientes y tracción

- **Logos en su home:** Italian Coffee, Arcos Dorados (McDonald's), OPUS Inspection México, Jeeves. *(Confirmado: los logos están publicados en su sitio. No verifiqué contrato ni volumen.)*
- **Cifra declarada en su home:** *"Over USD$7 million saved in taxes and more than 33,000 work hours saved thanks to our AI agent Zummi."* Es autodeclarada.
- Otra página de su ecosistema declara *"más de 20,000 horas y más de $60 millones de pesos en impuestos"*. **Las dos cifras no cuadran entre sí** — 33,000 h vs 20,000 h. Trátalas como marketing, no como benchmark.
- Fundada en **2022, Ciudad de México**. Según Descubre.vc (base de datos de terceros, no fuente primaria): etapa **pre-seed, US$500,000 levantados, ~9 personas, 300–400 usuarios**.
- **Shark Tank México:** existe el episodio publicado por el canal oficial de Shark Tank México con el título *"¡Maneja tus finanzas por WhatsApp! | Temporada 9"*. **No pude verificar si cerraron trato ni con quién.**

### Qué hacen mejor que los demás

**El precio de entrada y la simplicidad del plan.** $300 MXN al mes es el piso psicológico del mercado mexicano de software para PyME. Nadie más da un plan de empresa (con razón social, no persona) tan barato. Y el logo de Arcos Dorados les da una credibilidad de venta que ni Fotofacturas ni FacturaApp tienen.

### Dónde son débiles frente a Likida

- Cero mención de flotas, transporte, diésel, casetas o viáticos de operador en todo su sitio.
- Un usuario por razón social: no modelan "muchos operadores, un contralor".
- No hay política de gasto, ni aprobaciones por viaje, ni cuadre.
- Compiten de frente contra un producto gratis (Clara).

---

## 3. Clara Intelligence / recuperafacturas.com

**Dueño:** Clara (tarjetas corporativas, fundada 2020, opera en México, Brasil y Colombia; declara +20,000 empresas en la región)
**Sitio dedicado:** recuperafacturas.com · **WhatsApp:** 55 9708 7791

### El hecho que hay que entender antes que nada

Clara **lanzó el 15 de mayo de 2025** su Agente de Recuperación de Facturas por WhatsApp, y lo hizo **gratis y abierto a cualquier persona o empresa en México, sin necesidad de ser cliente de Clara**. Está confirmado tanto en la nota de prensa especializada como en su propia página de precios:

| Plan | Precio | Qué incluye |
|---|---|---|
| **Básico** | **Gratis ($0)** | ticket → CFDI, envío y recepción por WhatsApp, descarga XML y PDF, almacenamiento en la nube, soporte por WhatsApp |
| **Empresarial** | Cotización | alto volumen, integraciones contables, dashboard multiusuario, reportes consolidados |

Su propio sitio declara: *"No hay costos ocultos ni suscripciones obligatorias."*

**Esto define el techo de precio de toda la capa B del mercado: es cero.** Clara no está monetizando el ticket→CFDI; lo está usando como canal de adquisición para su tarjeta corporativa. Es una jugada de distribución, no de producto.

### Mecánica exacta (verificado)

1. Foto del ticket (JPG, PNG, HEIC o PDF) por WhatsApp o portal web.
2. La IA identifica el comercio y los datos fiscales.
3. Se conecta al portal de facturación correspondiente.
4. Entrega CFDI 4.0 en XML y PDF, en el mismo chat.
5. Todo queda guardado y organizado en recuperafacturas.com.

**Datos que pide:** foto legible del ticket + RFC + código postal.
**Tiempo prometido:** *"en menos de 24 horas"* la mayoría.

### Cobertura declarada

**+200 comercios**, agrupados por categoría: supermercados (Walmart, Costco, Soriana, HEB, Oxxo), transporte (Uber, DiDi, aerolíneas), **gasolineras (Pemex, Shell)**, restaurantes (Starbucks, KFC, McDonald's), farmacias, plataformas digitales (Netflix, Spotify, Mercado Libre), paquetería y entretenimiento.

En su página específica de gasolineras declaran **25+ marcas** (Pemex, Shell, BP, Chevron, Mobil, Repsol, Total Energies, Costco Gas, Oxxo Gas) y — esto es importante — **reconocen abiertamente las limitaciones legales que Likida también tiene que reconocer**:

- Plazos por marca: Pemex y Shell ~72 horas; la mayoría de franquicias 24–72 h; algunas estaciones independientes **solo el mismo día**.
- *"El pago en efectivo no es deducible (artículo 27 LISR)"*.
- Reconocen el complemento de hidrocarburos como requisito del CFDI de combustible.
- Cada estación franquiciada es legalmente independiente, por lo que **el portal cambia según la marca**.

### Cifras declaradas

- Los usuarios recuperan entre **$15,000 y $50,000 MXN anuales** en deducciones que antes perdían.
- Objetivo comercial: **99% de deducción de gastos**; hasta **30% menos impuestos**.
- Declaración de **Diego García, CTO y cofundador**: *"es inconcebible que aún existan empresas que sigan desperdiciando horas"* en tareas ineficientes.

### Ojo con esta letra chica

El flujo de recuperación **ligado a la tarjeta Clara** (distinto del agente abierto de WhatsApp) tiene restricciones que su propio blog publica:

- Solo transacciones **físicas**, en establecimientos **dentro de México**, en **moneda local (MXN)**.
- La foto debe tomarse **el mismo día de la compra**.

Esa segunda restricción es fortísima y explica por qué el flujo de tarjeta y el flujo abierto son productos distintos. **Para una flota, "el mismo día" es imposible**: el operador está en carretera tres días y manda todo al regresar. Ahí hay un hueco real.

### Qué hacen mejor que los demás

**Distribución.** Regalar el producto por WhatsApp sin registro, sin app, sin tarjeta y sin fricción es la mejor jugada de go-to-market del mercado mexicano en esta categoría. Además tienen la marca Clara detrás, que ya conocen los CFO.

### Dónde son débiles frente a Likida

- Es un producto de **gasto individual**, no de **operación de flota**. No hay viaje, ni unidad, ni operador, ni anticipo.
- La restricción de "foto el mismo día" (en el flujo de tarjeta) choca de frente con la realidad carretera.
- Su motivación real es vender tarjeta corporativa. Una flota chica que no quiere cambiar de banco no es su cliente.

---

## 4. FacturaGPT

**Sitio:** facturagpt.com.mx · **Modelo:** API B2B para partners · **No vende al usuario final**

Este no es un competidor de Likida. **Es un proveedor potencial**, y probablemente el más interesante del documento.

### Mecánica exacta (verificado en su sitio)

1. El partner manda por API la imagen del ticket + datos fiscales básicos + un `external_id`.
   Endpoint documentado: `POST /api/v1/get_factura`
2. FacturaGPT **detecta el comercio y ejecuta su flujo oficial de facturación**, sea cual sea: portal web de autofacturación, correo electrónico **o WhatsApp**.
3. El CFDI (XML y PDF) llega por **webhook `factura.completed`**, ya asociado a la transacción por el `external_id`.

**Asíncrono por defecto.** Tienen `test_mode: true` que no genera cargo. Declaran que el paso de sandbox a producción toma días, no semanas.

### Precio

**$4 MXN + IVA por CFDI exitoso.** Pago por uso, con descuentos por volumen. **Solo se cobra el éxito.**

### Cobertura declarada

- **+1,000 comercios en México**
- **+10,000 CFDI generados en producción**

### A quién le venden

Emisores de tarjetas corporativas, plataformas de gestión de gastos, fintechs B2B, ERP y software contable, despachos contables. Su pitch textual: el empleado sube el gasto en la app del partner y la plataforma le entrega el CFDI deducible sin pasos manuales, sin que el partner cambie su arquitectura.

**No mencionan gasolineras, casetas, transporte ni flotas en ninguna parte de su sitio.**

### Qué hacen mejor que los demás

Tres cosas, y las tres son robables:

1. **Cobran por resultado, no por intento.** $4 MXN por CFDI exitoso alinea el incentivo con el cliente de forma honesta. Ningún otro lo hace así.
2. **Reconocen que el flujo del comercio varía** (portal / email / WhatsApp) y lo modelan explícitamente en vez de fingir que todo es un portal.
3. **Entregan por webhook con `external_id`**, es decir, diseñaron para que el CFDI se amarre a una transacción que ya existe del otro lado. Es la arquitectura correcta.

### Qué significa para Likida en dinero

Si Likida compra esta capa en vez de construirla:

> **Ejercicio modelado (no es un dato de mercado, es una cuenta):** una flota de 30 camiones, 4 viajes al mes por unidad, 6 comprobantes por viaje = 720 comprobantes/mes → **~$2,880 MXN/mes de costo variable** (720 × $4). Si Likida cobra por camión, ese costo consume una parte relevante del ticket. Hay que pricear encima de esto, y hay que negociar el descuento por volumen desde el día uno.

### Riesgo

Un solo proveedor para la capa crítica. Si FacturaGPT sube el precio, se cae o lo compra un competidor (Mendel ya compró TeFacturo por esta misma razón), Likida se queda sin motor. **Conviene tener el conector propio para los 10–15 comercios que de verdad importan en carretera** (gasolineras de marca, casetas, TAGs) y comprar la cola larga.

**No pude verificar** quién está detrás de FacturaGPT, su razón social, ni si tiene inversión. No aparece en ninguna fuente que haya podido leer.

---

## 5. Mendel — el competidor que el encargo no pedía y que más importa

**Sitio:** mendel.com · **Emisor de la tarjeta:** FINANCIERA CR CAPITAL, S.A.P.I. de C.V., SOFOM E.N.R.

### Historia relevante

- **26 de enero de 2023:** Mendel **adquiere TeFacturo**, startup mexicana dedicada a la recuperación automatizada de CFDI. Fundador de TeFacturo: **Roberto Cortez**. Declaraciones de **Alejandro Zecler** (co-CEO y cofundador de Mendel) y **Helena Polyblank** (cofundadora y Chief Product Officer). Mendel declaraba +300 empresas cliente en ese momento. Es decir: **llevan tres años y medio construyendo el robot de facturación**.
- **Mayo de 2026:** lanzan con Visa la **Tarjeta Mendel Flotilla powered by Visa Commercial Fleet Solutions**. **México es el primer mercado.** (DPL News, 12-may-2026.)

### Producto "Recupero" (recuperación de facturas)

Pipeline visible al usuario, en cuatro estados: **Ticket recibido → Comercio contactado → En proceso → Factura recuperada**.

- La IA gestiona la solicitud por **portales, correos, WhatsApp y otros canales**, adaptándose a lo que el comercio tenga disponible.
- Al recuperarla, **se valida ante el SAT** para verificar autenticidad y cumplimiento antes de vincularla al gasto.
- **Funciona con efectivo y con tarjetas de crédito o débito de cualquier banco** — no está amarrado a la tarjeta Mendel.
- Requisito del ticket: legible, con datos del comercio, fecha, monto e identificador/folio.

**Cifras declaradas:** +30% de deducibilidad · **96%+ de tasa histórica de recupero** · +6 horas de productividad al mes por empleado · cierres mensuales en menos de 5 días · tiempos de **24–72 h en casos automáticos y 1–7 días en casos asistidos**.

Ese último dato es el más honesto del mercado: **admiten que hay casos asistidos** (humano en el loop) que tardan hasta una semana. Nadie más lo dice.

### Tarjeta Mendel Flotilla — esto es lo que hay que leer dos veces

**Activación por viaje:**
- Se conecta con el **TMS** de la flota.
- La tarjeta **se activa automáticamente cuando hay un viaje en curso** y **se desactiva al finalizar el viaje**. Sin configuración manual.

**Controles:**
- Por categoría de gasto, por horario de operación, por ubicación geográfica.
- **Límite de litros por carga.**
- Reglas individuales **por unidad y por conductor**.
- **Rechaza automáticamente** los pagos fuera de política, en el punto de venta.

**Categorías cubiertas:** combustible, **casetas**, comida, hospedaje, reparaciones, **viáticos**.

**Facturación:** *"Una foto del ticket es suficiente. Mendel AI recupera y valida el CFDI ante el SAT automáticamente."*

**Recargas en ruta:** el administrador libera fondos adicionales al instante desde la plataforma.

**Integraciones:** ERP nativos **SAP, Oracle, NetSuite** con sincronización en tiempo real; **TMS por API** con validación automática de viajes activos.

**Aceptación:** cualquier comercio afiliado a Visa, en México y el mundo.

**Cifras y clientes declarados:**
- **500+ flotillas** operando en México
- **ER Logística** (800 unidades) · **Estafeta** (120 horas ahorradas al mes) · **Jumex** (600 unidades de distribución) · **Delmar** (95% de facturas recuperadas) · **Transmodal** (cero gastos fuera de operación)
- +40% de recuperación de comprobantes fiscales · −20% de gastos no deducibles · 150 horas mensuales de ahorro administrativo · +$20,000 USD recuperados en promedio
- Mercado citado por Mendel: **US$49 mil millones anuales** en gasto vehicular en México

**Declaraciones:** **José Luis Gonzáles**, VP de Soluciones Comerciales de Visa; **Ana María Ponce de León**, CFO y Country Manager de Mendel México: *"el problema no ha sido cuánto se gasta en flotas, sino cuándo se logra visibilidad y control reales."*

### Qué hacen mejor que todos los demás

**La activación de la tarjeta atada al viaje.** Es la mejor idea de producto que encontré en toda la investigación. Convierte el viaje en el objeto de control, que es exactamente la tesis de Likida — solo que Mendel llegó primero y con Visa.

Y en segundo lugar: **mostrar el pipeline de recuperación**. El contralor no compra magia, compra saber en qué estado va cada comprobante y a quién reclamarle.

### Dónde son atacables

1. **Exigen cambiar el medio de pago.** Adoptar Mendel Flotilla significa emitir tarjetas nuevas, mover el flujo de tesorería y meter una SOFOM en el proceso. Una flota familiar de 20 camiones que ya opera con efectivo, con su banco de siempre y con vales de Edenred **no va a hacer eso**.
2. **Exigen TMS.** La activación por viaje depende de conectarse a un TMS por API. **La mayoría de las flotas chicas no tiene TMS** — tiene Excel y WhatsApp.
3. **Venden a Estafeta y Jumex.** Su motor comercial está calibrado para enterprise. El ciclo de venta y el precio no bajan solos.
4. **No liquidan al operador.** Controlan y concilian el gasto, pero no cierran *anticipo − comprobado = saldo*. Ese documento sigue saliendo de Excel.

---

## 6. Los demás jugadores mexicanos que encontré

### Fotofacturas (Softwerk S.A.P.I.) — fotofacturas.ai

El más agresivo en SEO y el único que publica su tasa de éxito.

| Plan | Precio | Tickets/mes | RFCs | Usuarios |
|---|---|---|---|---|
| Starter | **$99 MXN/mes** | 10 | 1 | 1 |
| Pro | **$299 MXN/mes** | 60 | 2 | 1 |
| Scale | **$999 MXN/mes** | 100 | 3 | 2 |

Trial de 7 días, cancelable. Arriba de 100 tickets/mes, se atiende por WhatsApp (+52 55 2261 3142).

- **Canales:** app iOS/Android + agente de WhatsApp llamado **"Factu"**.
- **Claim de tasa de éxito: 92%**, y lo publican como *"la más alta del mercado"*. **Es el único que pone el número al frente.**
- **+10,000 usuarios registrados** declarados.
- Clientes citados: Reebok, Giorgio Armani, Kingspan, Heidelberg, Puratos.
- Ofrecen **API y SDK "Factu"** para fintechs, SOFIPOs y bancos. Precio no público.
- Entrega en **menos de 24 horas**.

**Lo relevante para Likida:** tienen una máquina de contenido SEO por comercio, y **ya cubren la carretera**. Encontré guías publicadas de *cómo facturar el ticket* de **Red Vía Corta**, **CAPUFE**, **Concesionaria Mexiquense** (casetas) y de **G500**, **Petro Seven**, **FacturaGAS** (gasolineras mexicanas de marca). Es tráfico gratuito hacia el operador y hacia el contralor, y nadie más lo está peleando en el nicho carretero.

En su guía de casetas admiten la limitación real: *"El plazo vigente lo indica tu ticket y suele correr dentro del mismo mes del cruce"*, el ticket debe estar completo y legible, y la validación manual del portal exige folio con guiones exactos y montos sin decimales.

### FactuBot — factubot.mx

100% WhatsApp, sin app. Producto de doble cara: autofacturación para el comercio **y** recuperación de gastos y **viáticos** para empresas.

| Plan | Precio | Incluye |
|---|---|---|
| Básico | **$599 MXN/mes** | 50 facturas/mes, $0.25 por adicional |
| Pro | **$999 MXN/mes** | facturas ilimitadas, 1 sucursal/RFC |

Ambos con integraciones e-commerce (WooCommerce, Shopify) y portal web. Entrega PDF y XML en 24 horas. **Mencionan viáticos explícitamente.** Contacto en Monterrey.

### FacturApp — facturapp.lat

| Plan | Precio | Facturas |
|---|---|---|
| Gratis | $0 | 3 (sin tarjeta) |
| Básico | **$99 MXN/mes** | 25 |
| Pro | **$189 MXN/mes** | 100, soporte prioritario |
| Empresarial | **$399 MXN/mes** | 300, exportación masiva |

**144+ comercios** declarados. WhatsApp + web. App móvil en lista de espera. Le vende a freelancers, dueños de negocio chico y contadores. Su gancho comercial es la recuperación de IVA.

### FactuFlash — factuflash.com

**Ojo, es otra cosa:** **emite** facturas propias desde WhatsApp, no recupera CFDI de tickets. Le mandas *"factura a Acme SA por 5000 pesos por consultoría"* y devuelve PDF y XML timbrado en ~90 segundos. Planes: Free $0 (5/mes, solo web), Lite $49, Initial $69 (ya con bot de WhatsApp), Professional $129, Enterprise $229 (ilimitado + API). Para freelancers y contadores. **No compite con Likida**, pero marca el precio del "WhatsApp → CFDI" en la dirección contraria.

### autofactura.app

**También es otra cosa, y conviene entenderla:** es para el **comercio** (gasolineras, restaurantes) para que **sus clientes** se autofacturen por WhatsApp o Telegram con un QR. **$1,550 MXN/mes** (100 folios $600 + servicio $950, IVA incluido; folios sin caducidad). Requiere RFC y certificados .cer y .key. Toluca, Estado de México.

Es el lado **emisor** del mismo problema. Si una gasolinera de carretera usa esto, el ticket de Likida se factura más fácil. **Vale la pena mapear qué gasolineras de las rutas de tus clientes tienen autofacturación por WhatsApp**, porque ahí la automatización es trivial.

### Pulpo (PulpoFleet / PulpoPay / Pulpo360) — getpulpo.com

Gestión de flotas + **tarjeta de combustible en red abierta de gasolineras en todo México** + servicio administrado. Claims: hasta **20% de ahorro en combustible**, −20% de tiempo muerto en taller, −25% de tiempo de gestión operativa. 30+ clientes enterprise en logística, energía, seguridad y reparto. Precio bajo demanda, requiere demo.

**No declaran facturación automática de CFDI en su home**, ni control de casetas. Es competencia por el presupuesto del contralor, no por el problema fiscal.

### Solvento — contexto del segmento, no competidor directo

Fintech mexicana de autotransporte: liquidez y pagos para transportistas. Levantó **US$4.5M** en su primera ronda y en **febrero de 2026 cerró US$25M con BBVA Spark**. Su tesis de mercado, que sirve como validación del segmento de Likida:

- El autotransporte mueve **82% de la carga terrestre** en México (~556 millones de toneladas/año).
- **95% de las más de 200,000 empresas del sector tiene menos de 30 camiones.**
- Las empresas pagan el servicio de transporte a **~60 días** después de la entrega.

*(Estas cifras vienen de prensa especializada, no de fuente primaria oficial.)*

### TMS mexicanos con módulo de liquidación (competencia por el hueco de Likida)

Estos **sí liquidan viajes**, pero sin el ticket ni el WhatsApp:

- **SIGA Autotransporte** — facturación con y sin carta porte, pagos y conciliación SAT, ingresos y costos operativos **por viaje**, control de combustible, casetas y viáticos, liquidaciones de operador.
- **TransportePRO** — CFDI con complemento Carta Porte 3.1 (los 4 tipos: ingreso, traslado, egreso, pago), GPS, rutas, **liquidación de operador** y nómina, con cumplimiento SAT / SICT / IMSS.
- **ControLT**, **AG Solución** (control de pagos a operadores, liquidaciones, anticipos y combustible), **GMTransport**, **Facturei MX**.
- **Smart Fleet** publica una **calculadora gratuita de liquidación de chofer** (viajes, tarifas, deducciones por combustible, anticipos y multas → total a pagar). Es un lead magnet que Likida debería copiar tal cual.

**Este es el competidor real por el concepto de "liquidación".** Su debilidad: son sistemas de escritorio pesados, el operador nunca los toca, y el comprobante entra a mano.

### Medios de pago donde el CFDI ya está resuelto por ley

- **Edenred Ticket Car** — monedero electrónico de combustible **autorizado por el SAT**: *"deduce el 100% de tus gastos con un solo CFDI"*. Asigna saldo a tarjetas de combustible **o a TAGs**; restricciones por horario, tipo de combustible y capacidad del tanque; app EdenredPro para el administrador; el operador consulta saldo y ubica gasolineras desde su celular. También están en este mercado Toka, Broxel y Efectivale *(no pude leer sus sitios; ver SIN VERIFICAR)*.
- **TAGs de peaje: IAVE, PASE, TeleVía, ViaPass, EasyTrip.** **Quien cobró es quien factura**: si usaste TAG, el CFDI lo emite el proveedor del TAG, **no la autopista** — aunque la opere CAPUFE, Aleatica o IDEAL. **TeleVía envía la factura automáticamente por correo a partir del 5º día hábil del mes siguiente.** IAVE agrupa los cruces por periodo y el CFDI se descarga de su portal.

**Consecuencia directa:** en una flota que ya trae monedero autorizado y TAG, **la mayor parte del gasto del viaje ya viene facturada de origen**. El problema del ticket se reduce a comida, hospedaje, refacciones, maniobras y casetas pagadas en efectivo. Eso cambia el tamaño del problema que Likida vende.

---

## 7. Los fundamentos fiscales que mandan sobre el producto

Todo lo de esta sección lo leí en fuente primaria, salvo donde digo lo contrario.

### 7.1 El diésel pagado en efectivo no es deducible — aunque lo factures

**LISR art. 27, fracción III, segundo párrafo** (párrafo reformado DOF 12-11-2021; texto leído en el PDF oficial de diputados.gob.mx):

> *"Tratándose de la adquisición de combustibles para vehículos marítimos, aéreos y terrestres, el pago deberá efectuarse en la forma señalada en el párrafo anterior, aun cuando la contraprestación de dichas adquisiciones no excedan de $2,000.00 y en el comprobante fiscal deberá constar la información del permiso vigente, expedido en los términos de la Ley de Hidrocarburos al proveedor del combustible y que, en su caso, dicho permiso no se encuentre suspendido, al momento de la expedición del comprobante fiscal."*

El párrafo anterior (fracción III, primer párrafo) exige transferencia electrónica, cheque nominativo, tarjeta de crédito, débito o de servicios, o monederos electrónicos autorizados por el SAT.

**Dos consecuencias que cambian el pitch de Likida:**

1. **Si el operador pagó el diésel en efectivo, ese gasto no es deducible por más perfecto que salga el CFDI.** Prometer lo contrario es venderle a un contralor algo que su despacho va a tumbar.
2. **El CFDI de combustible debe traer la información del permiso vigente del proveedor**, y el permiso no debe estar suspendido al momento de expedirlo. Eso es validable de forma automática y **nadie lo está vendiendo como control**.

### 7.2 El complemento de hidrocarburos: todo CFDI de diésel debe traerlo

**RMF 2026, regla 2.7.1.48** (publicada en el DOF el 28-dic-2025):

> *"...los contribuyentes a que hace referencia la regla 2.6.1.1., fracción II, que enajenen gasolinas y diésel, deben incorporar en el CFDI que se emita, el 'Complemento Concepto para la facturación de Hidrocarburos y Petrolíferos', que al efecto publique el SAT en su Portal."*

Y obliga a registrar en `ClaveProdServ`:
- **15101505** Combustible Diesel
- **15101514** Gasolina regular menor a 91 octanos
- **15101515** Gasolina premium mayor o igual a 91 octanos

**Producto para Likida:** validar que cada CFDI de diésel traiga el complemento y la clave correcta, y rechazarlo si no. Un CFDI de diésel sin complemento es un gasto que la flota va a perder en la revisión, y hoy nadie se lo avisa. Clara lo menciona de pasada en un blog; **ninguno lo vende como control activo**.

> **SIN VERIFICAR:** varias fuentes secundarias dicen que la exigibilidad del complemento arrancó el **24 de abril de 2026** (publicado por el SAT el 25 de marzo de 2026). El texto de la regla sí está en la RMF 2026, pero **no pude confirmar esa fecha de entrada en vigor en el Portal del SAT ni en el DOF**. Confírmalo antes de ponerlo en material comercial.

### 7.3 Con monedero autorizado, la gasolinera NO debe facturarle al cliente

**RMF 2026, regla 3.3.1.7** (DOF 28-dic-2025), texto literal:

> *"...las personas físicas y morales que adquieran combustibles para vehículos marítimos, aéreos y terrestres, a través de los monederos electrónicos que al efecto autorice el SAT, podrán comprobar la erogación de las comisiones y otros cargos que cobre el emisor del monedero electrónico por sus servicios, así como el pago por la adquisición de combustibles, con el CFDI y el 'Complemento de Estado de Cuenta de Combustibles para Monederos Electrónicos Autorizados por el SAT', respectivamente, que expidan los emisores autorizados en términos de la regla 3.3.1.10., fracción III, **por lo que las estaciones de servicio no deberán emitir el CFDI a los clientes adquirentes de combustibles**, por las operaciones que se realicen a través de monederos electrónicos autorizados por el SAT."*

Y añade:

> *"La deducción por la adquisición de combustibles, así como el acreditamiento de los impuestos trasladados podrá realizarse hasta que el contribuyente adquirente del combustible, cuente con el CFDI y el complemento a que se refiere el párrafo anterior y hasta por el monto que ampare el citado complemento."*

**Esto es el hallazgo estructural más importante del documento.** Si la flota usa monedero autorizado:

- No hay ticket que facturar. El problema que Likida vende no existe ahí.
- Pero aparece uno nuevo: **la deducción está topada al monto que ampare el complemento**. Si los litros que cargó la unidad no cuadran con los del complemento, la diferencia se pierde. **Eso es conciliación, no facturación — y es justo lo que Likida sabe hacer si tiene el viaje.**

El SAT publica el **padrón de emisores de monederos electrónicos de combustibles autorizados**, y también los padrones de **no renovados** y **revocados**. Vale la pena consultarlo: si el emisor que usa tu cliente fue revocado, sus deducciones de combustible están en riesgo.

### 7.4 Los viáticos tienen una regla que nadie valida: la faja de 50 km

**LISR art. 28, fracción V** (leído en fuente primaria):

> *"Los viáticos o gastos de viaje, en el país o en el extranjero, cuando no se destinen al hospedaje, alimentación, transporte, uso o goce temporal de automóviles y pago de kilometraje, de la persona beneficiaria del viático o **cuando se apliquen dentro de una faja de 50 kilómetros que circunde al establecimiento del contribuyente**. Las personas a favor de las cuales se realice la erogación, deben tener relación de trabajo con el contribuyente en los términos del Capítulo I del Título IV de esta Ley o deben estar prestando servicios profesionales. Los gastos a que se refiere esta fracción deberán estar amparados con un comprobante fiscal cuando éstos se realicen en territorio nacional..."*

**Tres reglas duras que ninguna plataforma valida hoy:**

1. Un viático **dentro de 50 km del establecimiento** de la empresa **no es deducible**.
2. El beneficiario debe tener **relación laboral** o estar prestando **servicios profesionales**. El operador subcontratado sin relación formal rompe la deducción.
3. Solo aplica a hospedaje, alimentación, transporte, uso de automóviles y kilometraje. Lo demás, no.

**Likida es la única que puede validar el punto 1 automáticamente**, porque es la única que tiene el viaje georreferenciado. Clara, Zumma y Fotofacturas solo ven un ticket suelto: no saben desde dónde salió el camión.

### 7.5 La ventana para conseguir el CFDI es más larga de lo que todos dicen

**LISR art. 27, fracción XVIII** (fuente primaria):

> *"Tratándose del comprobante fiscal a que se refiere el primer párrafo de la fracción III de este artículo, éste se obtenga a más tardar el día en que el contribuyente deba presentar su declaración. (...) Además, **la fecha de expedición de los comprobantes fiscales de un gasto deducible deberá corresponder al ejercicio por el que se efectúa la deducción**."*

**CFF art. 29-A**, párrafo de cancelación (reformado DOF 12-11-2021 y **07-11-2025**):

> *"Los comprobantes fiscales digitales por Internet se podrán cancelar a más tardar en el mes en el cual se deba presentar la declaración anual del impuesto sobre la renta que corresponda al ejercicio fiscal en el cual se expidió el referido comprobante y siempre que la persona a favor de quien se expidan acepte su cancelación."*

**Traducido:** la ley te da hasta la declaración anual para obtener el comprobante, y el comercio puede cancelar y sustituir su CFDI global hasta el mes de su declaración anual (marzo para personas morales). **Lo que cierra en 24–72 horas es el portal del comercio, no la ley.**

Esto abre un producto que **nadie está ofreciendo**: **rescate de tickets vencidos**, negociando con el comercio la cancelación y sustitución del CFDI global. Es lento, es manual, y por eso mismo nadie lo hace — pero para una flota son decenas de miles de pesos al año que hoy se dan por perdidos, y se puede cobrar como éxito.

Complemento útil: **RMF 2026, regla 2.7.1.21** obliga a emitir el CFDI global *"a más tardar dentro de las 24 horas siguientes al cierre de las operaciones"* y exige **separar IVA e IEPS**. Y **regla 3.13.29** permite a los del RESICO cancelar CFDI globales **hasta el último día de abril del ejercicio siguiente**.

### 7.6 El riesgo nuevo de 2026: el CFDI que no ampara una operación real es falso

**CFF art. 29-A, fracción IX** — **fracción adicionada DOF 07-11-2025**, leída en fuente primaria:

> *"IX. Amparar operaciones existentes, verdaderas o actos jurídicos reales.*
> *Los comprobantes fiscales que no cumplan con el requisito establecido en esta fracción, **se consideran falsos para efectos de este Código**."*

**CFF art. 29-A Bis** — **artículo adicionado DOF 07-11-2025**:

> *"Cuando las autoridades fiscales se encuentren ejerciendo cualquiera de las facultades establecidas en este Código, y detecten el incumplimiento al requisito establecido en el artículo 29-A, fracción IX de este Código, podrán determinar lo que corresponda conforme a la facultad que estén ejerciendo, sin que se requiera agotar previamente el procedimiento a que se refiere el artículo 49 Bis..."*

Y el **art. 49 Bis** permite una visita domiciliaria por presunción de CFDI falsos, en la que **se ordena la suspensión de la emisión de comprobantes desde la notificación de la orden**, sin que aplique el 17-H Bis, hasta que se resuelva.

**Qué significa esto para el negocio de "factura tu ticket":**

Si un operador manda el ticket de un tercero, o el mismo ticket dos veces, o un ticket de un gasto personal, el CFDI resultante **no ampara una operación real del contribuyente** y ahora es legalmente falso. Antes era un problema de deducibilidad; en 2026 es un problema de comprobantes falsos, con suspensión de sellos de por medio.

**Esto convierte un requisito técnico aburrido en el mejor argumento de venta de Likida:**

- **Deduplicación de comprobantes** (mismo folio, mismo monto, misma estación, mismo día).
- **Amarre del comprobante a una operación real**: viaje, unidad, operador, fecha, y ubicación coherente con la ruta.
- **Rechazo de lo que no cuadra**, con la razón explicada.

Ninguno de los competidores puede hacer esto, porque **ninguno tiene el viaje**. Clara, Zumma y Fotofacturas ven tickets sueltos. Mendel ve la transacción de su tarjeta. Solo Likida puede decir *"este ticket de diésel es de una gasolinera que está a 400 km de la ruta del viaje 8842"*.

> **Nota de vigencia:** el PDF de la LISR que leí en diputados.gob.mx trae **"Última Reforma DOF 01-04-2024"**. **No pude confirmar** si el paquete fiscal 2026 modificó los artículos 27-III, 27-XVIII o 28-V. El CFF que leí sí está actualizado a **"Última Reforma DOF 09-04-2026"**. Antes de usar las citas de LISR en material comercial, valida contra la versión vigente.

---

## 8. Comparativo de una hoja

| | Zumma | Clara Intelligence | FacturaGPT | Fotofacturas | Mendel Flotilla |
|---|---|---|---|---|---|
| **Qué vende** | Gestión de gastos + factura | Recuperación de facturas (gancho para su tarjeta) | Infraestructura (API) | App de facturación de tickets | Tarjeta + control + facturación de flota |
| **Canal principal** | WhatsApp + panel | **WhatsApp abierto, sin registro** | API / webhook | App + WhatsApp ("Factu") | Tarjeta + plataforma + app |
| **Precio** | $300 / $550 MXN/mes; Enterprise a cotizar | **Gratis**; Empresarial a cotizar | **$4 MXN + IVA por CFDI exitoso** | $99 / $299 / $999 MXN/mes | Cotización (SOFOM) |
| **Cobertura declarada** | "todos" (sin número) | **+200 comercios**, 25+ marcas de gasolinera | **+1,000 comercios**, +10,000 CFDI | "cualquier comercio mexicano"; guías de casetas y gasolineras de marca | Cualquier comercio Visa |
| **Tasa de éxito publicada** | no publica | no publica | no publica | **92%** | **96%+ histórico** |
| **Tiempo declarado** | "minutos" / "<24 h" (se contradicen) | <24 h | asíncrono, por webhook | <24 h | 24–72 h auto; 1–7 días asistido |
| **A quién le vende** | PyME y empresa | Cualquiera (gancho); corporativo | Fintech, tarjetas, ERP, despachos | Freelance, PyME, despachos, enterprise vía API | Flotas corporativas y sector público |
| **Concepto de viaje** | **no** | **no** | **no** | **no** | **sí** (vía TMS) |
| **Liquidación del operador** | **no** | **no** | **no** | **no** | **no** |
| **Casetas / TAG** | no declarado | tickets de caseta | no declarado | sí (Red Vía Corta, CAPUFE, Concesionaria Mexiquense) | sí, como categoría de gasto |
| **Efectivo** | sí (foto del ticket) | sí (agente abierto) | sí | sí | **sí, explícito** |
| **ERP** | solo Enterprise | Empresarial | el partner lo hace | vía API | **SAP, Oracle, NetSuite nativos** |

---

## Qué cambia esto en Likida

### Dejar de prometer (hoy, antes de la demo del 6 de agosto)

1. **"Te hacemos deducible todo lo del viaje."** Es falso y es verificable. El diésel en efectivo **no** es deducible (LISR 27-III) y los viáticos dentro de 50 km del establecimiento **tampoco** (LISR 28-V). Un contralor con despacho decente lo va a cachar en la primera reunión y pierdes la venta entera por una frase.
2. **"Facturamos cualquier ticket."** Desde el DOF 07-11-2025, un CFDI que no ampare una operación real es **falso** (CFF 29-A fr. IX). Esa frase pasó de ser marketing a ser una invitación a que te asocien con factureras.
3. **"Recuperamos el 100%."** Mendel publica 96%, Fotofacturas 92%. Prometer más que el mercado te pone un número imposible de sostener. **Publica tu tasa real y actualízala** — eso sí es diferenciador, porque solo dos competidores publican la suya.
4. **"Somos los únicos por WhatsApp."** Clara, Zumma, Fotofacturas, FactuBot y el propio Mendel ya están en WhatsApp. WhatsApp es la mesa, no la carta.
5. **"Te ahorramos el trabajo de facturar el diésel."** Si el prospecto ya trae monedero autorizado (Edenred Ticket Car o similar) o TAG, **ese trabajo ya no existe** (RMF 3.3.1.7 y el flujo de TAG). Pregunta esto en la primera llamada de calificación, antes de armar el pitch.

### Empezar a prometer (esto sí es tuyo y nadie más lo puede decir)

1. **"Cerramos la liquidación del viaje, no te entregamos facturas sueltas."**
   *Anticipo entregado − gastos comprobados y válidos = saldo a favor o en contra del operador.* Ese documento hoy sale de Excel en todas las flotas. Ninguno de los cinco competidores lo produce. Es el entregable que el contralor firma.
2. **"Validamos contra la ruta, no contra el ticket."**
   Un comprobante de una gasolinera a 400 km de la ruta del viaje se rechaza solo. Un viático dentro de los 50 km del patio se marca como no deducible **antes** de que llegue al cierre. Solo Likida puede hacerlo porque solo Likida tiene el viaje.
3. **"Te decimos qué NO es deducible y por qué, antes del cierre."**
   Efectivo en diésel · viático dentro de la faja de 50 km · CFDI de diésel sin complemento de hidrocarburos o con `ClaveProdServ` incorrecta · permiso de Ley de Hidrocarburos ausente o suspendido en el comprobante · comprobante duplicado. Todo es validable de forma automática. **Nadie lo está vendiendo como control activo.**
4. **"No cambias de banco, ni de tarjeta, ni de sistema."**
   Es la respuesta directa a Mendel. Su ventaja (la tarjeta Visa con reglas) es también su fricción de adopción: requiere emitir tarjetas, mover tesorería y meter una SOFOM. Para una flota familiar de 20 camiones eso es un proyecto, no una compra.

### Qué construir (en este orden)

1. **La liquidación por viaje como entregable de una hoja.** Es el producto. Todo lo demás es plomería. Modela el objeto `viaje` desde el día uno: unidad, operador, ruta, anticipo, comprobantes, saldo, estado.
2. **Compra la capa de ticket→CFDI, no la construyas.** FacturaGPT a $4 MXN + IVA por CFDI exitoso, con `external_id` y webhook `factura.completed`, es exactamente la arquitectura que necesitas y ya trae +1,000 comercios. Negocia volumen desde el arranque. **Construye tú solo los 10–15 conectores que importan en carretera** (gasolineras de marca, casetas, portales de TAG) para no depender de un tercero en lo crítico.
3. **Motor de validación fiscal, no de OCR.** Deduplicación por folio/monto/estación/fecha; verificación del complemento de hidrocarburos y de la `ClaveProdServ`; verificación de forma de pago contra la regla de combustible; verificación de la faja de 50 km; validación del CFDI ante el SAT. **Esto es la defensa legal y el diferenciador, en la misma pieza.**
4. **Conciliación del complemento de estado de cuenta de combustible.** Para la flota que ya trae monedero autorizado: cruzar los litros del complemento contra los litros que la unidad debió rendir en el viaje. Ahí sale el ordeño de diésel, que es un dolor mucho más caro que la factura perdida. Y hay fundamento: la deducción está topada al monto que ampare el complemento (RMF 3.3.1.7).
5. **Pipeline visible de cada comprobante.** Robado de Mendel, tal cual: *recibido → comercio contactado → en proceso → recuperado / rechazado con motivo*. El contralor compra visibilidad, no magia.
6. **Rescate de tickets vencidos, cobrado por éxito.** Nadie lo hace porque es manual. La ley da margen hasta la declaración anual (LISR 27-XVIII y CFF 29-A). Es el único servicio de esta lista por el que un contralor paga sin regatear, porque es dinero que ya daba por perdido.

### Qué robarles, concretamente

| De quién | Qué robar | Por qué |
|---|---|---|
| **Clara** | Un número de WhatsApp abierto, sin registro, sin app, gratis, que facture el ticket de cualquiera | Es la mejor máquina de adquisición del mercado. Para Likida el gancho sería carretero: *"manda tu ticket de caseta o diésel y te lo facturamos gratis"*. El operador entra; el contralor viene detrás. |
| **FacturaGPT** | **Cobrar por resultado.** Ellos cobran por CFDI exitoso; Likida debería cobrar **por viaje liquidado** | Alinea el incentivo, elimina la objeción de "y si no funciona", y es honesto. Además hace el precio escalable con la flota, no con el número de licencias. |
| **Mendel** | **Atar la capacidad de gasto al viaje abierto** | Es la mejor idea de producto que hay en el mercado. Likida puede hacer la versión sin tarjeta: la ventana de comprobación se abre al iniciar el viaje y se cierra al liquidarlo. Mismo control, cero fricción de adopción. |
| **Mendel** | Vender en **horas del contralor** y **días de cierre**, no en pesos | "Cierre mensual en menos de 5 días" y "150 horas al mes" convence más rápido que un porcentaje de deducción. |
| **Mendel** | **Admitir los casos asistidos** (24–72 h automático, 1–7 días con humano) | La honestidad sobre los tiempos es un diferenciador cuando todos los demás prometen "minutos". |
| **Fotofacturas** | **Publicar la tasa de éxito** y **SEO por comercio de carretera** | Nadie está peleando "cómo facturar tu ticket de [caseta / gasolinera de marca] 2026" para el nicho carretero. Ellos ya empezaron con Red Vía Corta, CAPUFE, G500 y Petro Seven. Es tráfico gratuito y calificado. |
| **Smart Fleet** | La **calculadora gratuita de liquidación de chofer** | Lead magnet perfecto y ya validado en este nicho exacto. Likida puede publicar la suya y capturar al contralor que hoy la usa en Excel. |
| **Zumma** | Su piso de precio ($300 MXN/mes) como referencia de lo que la PyME mexicana espera pagar | No para copiarlo, sino para saber contra qué ancla estás negociando. Si Likida cobra por camión, el número por camión tiene que sonar cerca de esa escala. |

### Los huecos que nadie cubre para una flota de carga

1. **La liquidación del viaje.** El documento que cuadra anticipo, gastos y saldo del operador. Cero competidores lo producen.
2. **La validación geográfica del gasto contra la ruta.** Nadie tiene el viaje, así que nadie puede hacerlo.
3. **La faja de 50 km de los viáticos (LISR 28-V).** Ninguna plataforma la valida. Es una regla dura y cara.
4. **La conciliación de litros** entre el complemento de estado de cuenta de combustible y el rendimiento real de la unidad en el viaje.
5. **El rescate de tickets vencidos** vía sustitución del CFDI global. Todos se rinden a las 72 horas; la ley da mucho más margen.
6. **La flota chica.** 95% de las 200,000+ empresas del sector tiene menos de 30 camiones. Mendel vende a Estafeta; Clara al corporativo; Zumma le vende a un solo usuario. **Nadie tiene un producto diseñado para 20 camiones y un contralor que también hace la nómina.**
7. **El operador como usuario real.** Todos diseñaron para el empleado de oficina con app y correo. El operador no tiene app, no tiene correo corporativo y no va a instalar nada. WhatsApp puro es la única superficie que funciona, y aunque varios ya están ahí, ninguno diseñó el flujo pensando en alguien que va manejando.

---

## SIN VERIFICAR

Todo lo de esta lista es **pista, no fundamento**. No lo uses en material comercial ni ante un contralor sin confirmarlo primero.

1. **Fecha de exigibilidad del complemento de hidrocarburos.** Fuentes secundarias (blogs de Facturama, Sovos, Alegra, Impuestum) dicen que aplica desde el **24 de abril de 2026**, publicado por el SAT el **25 de marzo de 2026**. **El texto de la regla 2.7.1.48 sí está en la RMF 2026 (DOF 28-dic-2025), pero la fecha de entrada en vigor no la pude confirmar en el Portal del SAT ni en el DOF.**
2. **Vigencia de las citas de la LISR.** El PDF oficial de diputados.gob.mx que leí dice **"Última Reforma DOF 01-04-2024"**. No pude confirmar si el paquete fiscal 2026 tocó los artículos 27 fr. III, 27 fr. XVIII o 28 fr. V. El CFF sí lo verifiqué actualizado a **DOF 09-04-2026**.
3. **Resultado de Zumma en Shark Tank México.** Existe el episodio de la temporada 9 publicado por el canal oficial (*"¡Maneja tus finanzas por WhatsApp!"*). **No verifiqué si cerraron trato, con qué tiburón, ni por cuánto.**
4. **Fundadoras de Zumma.** Los resultados de búsqueda mencionan a **Fernanda De La Colina, Marinella Piñate y Daniela Lascurain**, pero su página "About us" devolvió 404 y no pude leerlo en su sitio.
5. **Datos de inversión de Zumma.** Pre-seed de **US$500,000**, ~9 personas y 300–400 usuarios vienen de **Descubre.vc**, una base de datos de terceros. No es fuente primaria ni está confirmado por la empresa.
6. **Cifras autodeclaradas de todos.** "USD$7 millones ahorrados en impuestos y 33,000 horas" (Zumma), "92% de tasa de éxito y +10,000 usuarios" (Fotofacturas), "96%+ de recupero y 500+ flotillas" (Mendel), "+200 comercios" (Clara), "+1,000 comercios y +10,000 CFDI" (FacturaGPT) son **claims de marketing publicados por ellos mismos**. Verifiqué que están publicados; no verifiqué que sean ciertos.
7. **Contradicción interna de Zumma.** Una página de su ecosistema dice "20,000 horas y $60 millones de pesos" y su home en inglés dice "33,000 horas y USD$7 millones". No pude reconciliarlas.
8. **Tamaño del mercado citado por Visa/Mendel.** DPL News dice "**1.4 billones de dólares**" y El Cronista dice "**US$1.4 mil millones**" para el mismo dato de gasto vehicular. Son órdenes de magnitud distintos. **No uses ninguno de los dos hasta confirmar cuál es.**
9. **Fecha del artículo de El Cronista sobre Visa y Mendel.** La herramienta devolvió "publicado 28 de julio de 2026, actualizado 12 de mayo de 2026", lo cual es imposible. **La fecha que sí verifiqué es la de DPL News: 12 de mayo de 2026.**
10. **Quién está detrás de FacturaGPT.** No encontré razón social, fundadores, inversión ni antigüedad en ninguna fuente.
11. **Precio empresarial de Clara.** Un blog del propio dominio recuperafacturas.com aparentemente lista planes de "$299/mes (Pro)" y "$799/mes (Business)", pero **su página oficial de precios solo muestra "Básico gratis" y "Empresarial a cotizar"**. No pude reconciliarlo; probablemente el blog sea contenido SEO desactualizado o generado.
12. **Toka, Broxel y Efectivale.** Aparecen mencionados como competidores de Edenred en el mercado de monederos de combustible, pero **no pude leer sus sitios ni verificar su oferta, cobertura o precios.**
13. **Precio de las APIs de Fotofacturas ("Factu API/SDK") y del plan Empresarial de Clara y Zumma.** Ninguno publica precio; todos requieren demo.
14. **PulpoPay y el CFDI.** Su home declara la tarjeta de combustible y el ahorro, pero **no declara facturación automática de CFDI ni control de casetas**. No pude verificar si lo tienen y no lo comunican, o si no lo tienen.
15. **Datos del sector de Solvento** (82% de la carga terrestre, 95% de las empresas con menos de 30 camiones, 200,000+ empresas, pago a 60 días). Vienen de prensa especializada (TyT, El Financiero, LatamFintech), **no de INEGI, SICT ni CANACAR**. Confírmalos en fuente oficial antes de ponerlos en una propuesta.
16. **mascfdi.com.mx** apareció en resultados de búsqueda como "+CFDI | Factura tus tickets automáticamente por WhatsApp", pero **el dominio no resolvió**. No pude verificar si sigue operando.
17. **Volumen real de los clientes citados.** Los logos de Arcos Dorados, Italian Coffee, Estafeta, Jumex, Reebok, etc., están publicados por los propios proveedores. **No verifiqué contratos, alcance ni si siguen activos.**

---

## Fuentes

### Fuentes primarias (leídas en el texto oficial)

- **Resolución Miscelánea Fiscal para 2026**, DOF 28-dic-2025 — reglas 2.7.1.21 (CFDI global), 2.7.1.39 (PUE), 2.7.1.48 (complemento de hidrocarburos), 3.3.1.7 (monederos electrónicos de combustible), 3.13.29 (cancelación de CFDI global RESICO). https://www.dof.gob.mx/
- **Código Fiscal de la Federación**, Última Reforma DOF 09-04-2026 — arts. 29, 29-A (incl. fracción IX adicionada DOF 07-11-2025 y párrafo de cancelación reformado DOF 07-11-2025), 29-A Bis (adicionado DOF 07-11-2025), 49 Bis. https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf
- **Ley del Impuesto sobre la Renta**, Última Reforma DOF 01-04-2024 — art. 27 fr. III (2º párrafo reformado DOF 12-11-2021), art. 27 fr. XVIII, art. 28 fr. V. https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf
- **SAT — Padrón de emisores de monederos electrónicos de combustibles autorizados**. https://wwwmat.sat.gob.mx/consultas/60450/padron-de-emisores-de-monederos-electronicos-de-combustibles-autorizados
- **SAT — Padrón de emisores de monederos electrónicos de combustibles revocados**. https://www.sat.gob.mx/consultas/12869/padron-de-emisores-de-monederos-electronicos-de-combustibles-revocados
- **SAT — Guía de llenado del CFDI global versión 4.0**. http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Guia_llenado_CFDI_global.pdf

### Sitios de los competidores (leídos directamente)

- Zumma Financial — https://www.zummafinancial.com/en
- Zumma Financial, planes y precios — https://www.zummafinancial.com/en/planes-y-precios
- Zumma Financial, empresas — https://www.zummafinancial.com/en/empresas
- Clara Intelligence / Recupera Facturas — https://recuperafacturas.com/
- Clara Intelligence, precios — https://recuperafacturas.com/precios
- Clara Intelligence, gasolineras — https://recuperafacturas.com/factura/gasolineras
- Clara, cómo funciona Recuperación de Facturas — https://www.clara.com/blog/como-funciona-recuperacion-de-facturas
- FacturaGPT — https://www.facturagpt.com.mx/
- FacturaGPT, fintech y tarjetas corporativas — https://www.facturagpt.com.mx/solutions/fintech-y-tarjetas-corporativas/
- Fotofacturas — https://fotofacturas.ai/
- Fotofacturas, precios — https://fotofacturas.ai/precios
- Fotofacturas, guía de casetas Red Vía Corta — https://fotofacturas.ai/blog/como-facturar-tu-ticket-de-red-via-corta/
- Mendel, Tarjeta Flotilla — https://mendel.com/es-mx/tarjeta-mendel-flotilla/
- Mendel, Recuperación de facturas — https://mendel.com/es-mx/producto/recupero/
- Mendel, adquisición de TeFacturo (26-ene-2023) — https://mendel.com/es-mx/mendel-adquiere-la-startup-tefacturo/
- FactuBot — https://factubot.mx/
- FacturApp — https://facturapp.lat/
- FactuFlash — https://factuflash.com/
- autofactura.app — https://autofactura.app/
- Pulpo (PulpoFleet / PulpoPay) — https://www.getpulpo.com/
- Edenred México, Ticket Car — https://www.edenred.mx/vales-de-gasolina-ticket-car

### Prensa y terceros (pista, no fundamento)

- Fintech Expert MX, "Clara lanza asistente por WhatsApp para recuperar facturas" (15-may-2025) — https://www.fintechexpert.mx/p/clara-lanza-asistente-por-whatsapp
- Clara, nota de prensa "Clara lanza Recuperación de Facturas..." — https://www.clara.com/es-mx/prensa/clara-lanza-recuperación-de-facturas-y-espera-ayudar-a-las-empresas-a-alcanzar-un-99-de-deducción-de-gastos
- DPL News, "Mendel y Visa lanzan tarjeta para flotillas en México" (12-may-2026) — https://dplnews.com/mendel-y-visa-lanzan-tarjeta-para-flotillas-en-mexico/
- El Cronista, "Visa y Mendel lanzan solución para flotas..." — https://www.cronista.com/mexico/finanzas-economia/visa-y-mendel-lanzan-solucion-para-flotas-el-plan-para-recuperar-40-mas-facturas-ante-el-sat/
- Descubre.vc, ficha de Zumma Financial — https://www.descubre.vc/zumma-financial
- Shark Tank México (canal oficial), "¡Maneja tus finanzas por WhatsApp! | Temporada 9" — https://www.youtube.com/watch?v=yoGwSpa-WT0
- El Financiero, "Solvento y BBVA Spark cierran financiamiento por 25 mdd" (13-feb-2026) — https://www.elfinanciero.com.mx/transporte-y-movilidad/2026/02/13/solvento-y-bbva-spark-cierran-financiamiento-por-25mdd-para-fortalecer-transporte-y-logistica-en-mexico/
- Revista TyT, "Solvento recauda 4.5 mdd en su primera ronda" — https://www.tyt.com.mx/nota/solvento-la-fintech-para-transportistas-recauda-4-5-mdd-en-su-primera-ronda-de-inversion
- casetas.com.mx, facturación por operador y TAG 2026 — https://casetas.com.mx/facturacion
- SIGA Autotransporte — https://siga.mx/siga-autotransporte-software-erp-para-gestion-de-flotas-y-logistica/
- TransportePRO — https://transportepro.com/
- Smart Fleet, calculadora de liquidación de chofer — https://smartfleetapp.com/herramientas/calculadora-liquidacion-chofer
