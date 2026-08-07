# Líneas de ingreso adyacentes para Likida

> Ola 2 — 27-jul-2026. Construido sobre la ola 1 (`00` a `11`), en particular `08-competencia.md`
> (mapa de mercado y monederos electrónicos) y `03-isr-facilidades.md`/`05-hidrocarburos.md`
> (régimen del combustible). No repite esa investigación: la usa como piso.

---

## Resumen para el fundador

Likida ve pasar el dato más caro de una flota — cada comprobante, cada viaje, cada saldo con
cada operador — antes que cualquier banco. Eso vale dinero por sí mismo, pero **no todas las
formas de cobrarlo están igual de disponibles**. Investigué siete líneas y encontré tres grupos
muy distintos:

1. **Lo que se puede vender mañana sin pedirle permiso a nadie: referir, no prestar.** Factoraje,
   seguros y financiamiento de unidades **no requieren que Likida se vuelva una entidad
   financiera regulada** si Likida se queda en el rol de intermediario que cobra comisión y no
   pone su balance en riesgo. El dinero (y el riesgo de crédito) lo pone Solvento, un SOFOM o una
   aseguradora; Likida cobra por el dato y por la referencia calificada.
2. **Lo que exige capital serio y meses de trámite, y no es para ahora.** Ser el emisor del
   monedero de combustible (como Edenred o Sí Vale) o ser Proveedor Autorizado de Certificación
   (PAC) del SAT piden **$10,000,000 MXN de capital social pagado más una fianza de otros
   $10,000,000 MXN a favor de la Tesorería**, verificación técnica del SAT y meses de proceso.
   Prestar dinero de verdad (factoraje con balance propio) no pide licencia — la ley
   explícitamente lo permite sin autorización — pero sí pide el capital para fondear la cartera:
   Solvento tardó tres años en armar $75 millones de dólares en líneas de deuda para poder
   hacerlo a escala. Nada de esto es un "sí, pero después"; es un "no, salvo que alguien más
   ponga el capital".
3. **Lo que suena a producto de datos y es, en realidad, un mercado ya resuelto por el gobierno o
   por un competidor.** El precio del diésel por zona **ya es un dato público obligatorio**
   (la CRE obliga a cada gasolinera a reportarlo) y ya hay una empresa — PETROIntelligence — que
   lo revende por API y por CSV. Vender lo mismo sin un ángulo propio es competir contra un
   commodity gratuito. La contabilidad como servicio tiene el mismo problema desde otro ángulo:
   media docena de ERP de autotransporte (SIGA, ClickBalance, Advanpro, Logista, LISTMS+) ya
   traen módulo contable integrado.

La línea que sí es 100% Likida y nadie más la puede vender: **la capa de facturación/validación
que Likida ya construye para sí misma, revendida como API a otros** (despachos contables, otras
verticales de gasto en efectivo). No requiere ser PAC — se puede seguir comprando esa capa a un
PAC existente, como ya recomienda `08-competencia.md` — solo requiere empaquetar lo que Likida
ya construye.

**La orden de prioridad honesta:** primero los referidos (factoraje, seguros, financiamiento) que no
piden capital ni licencia y capitalizan la confianza que Likida ya tiene con el contralor; después,
si el volumen lo justifica, la API de validación como producto propio; el resto —monedero propio,
PAC propio, datos de diésel, contabilidad— **no construir**, porque cada uno choca contra una
barrera de capital regulatorio, un competidor con más presupuesto, o un dato que el gobierno ya
regala.

---

## 1. Factoraje / adelanto sobre facturas por cobrar

### Cómo funciona el negocio

Un transportista factura un flete y su cliente (el embarcador) le paga a 30, 60 o hasta 90 días.
El factorante le adelanta ese dinero **hoy, con descuento**, y cobra directamente al embarcador
cuando vence. El margen es la diferencia entre lo que adelantó y lo que cobró, menos el costo de
fondeo. Es exactamente lo que vende **Solvento**, hoy el jugador de referencia del sector en
México: su producto **QuickPay** da "7 días de financiamiento sin costo y la flexibilidad de
extender el pago hasta 60 días más", y su línea de crédito revolvente "adelanta el cobro de las
facturas... en minutos" (Solvento, sitio oficial). Solvento se financia a su vez con deuda: cerró
una línea de **US$50 millones con Lendable** y otra de **US$25 millones con BBVA Spark** en
febrero de 2026 (El Financiero, BBVA, 12/13-feb-2026) — es decir, el negocio de factoraje **no se
capitaliza con capital de riesgo de startup, se capitaliza con deuda institucional**.

### Qué se necesita para entrar

**Aquí está el hallazgo más importante de esta línea, y contradice la intuición de que "prestar
dinero" siempre exige ser un banco:**

> **LGOAAC, artículo 87-B:** *"El otorgamiento de crédito, así como la celebración de
> arrendamiento financiero o factoraje financiero podrán realizarse en forma habitual y
> profesional por cualquier persona sin necesidad de requerir autorización del Gobierno Federal
> para ello."*

Prestar dinero contra facturas, en México, **no requiere licencia de ninguna autoridad
financiera**. Lo que sí exige el mismo artículo es que, si la sociedad **quiere llamarse
"SOFOM"** (y con eso acceder a burós de crédito y a ciertas protecciones legales), debe
registrarse ante **CONDUSEF** en el **SIPRES** con un plan general de funcionamiento, un contrato
con al menos una sociedad de información crediticia, y —si es SOFOM No Regulada (ENR, el caso de
casi cualquier startup)— un **dictamen técnico en materia de prevención de lavado de dinero**
emitido por la CNBV (CONDUSEF, Portal Único de Registros; LGOAAC art. 87-K). Ese registro es
trámite, no autorización discrecional: es correr un checklist, no pedir permiso.

**El verdadero requisito no es el papeleo, es el dinero para prestar.** Adelantar facturas a
escala exige millones de pesos de capital de trabajo o líneas de deuda — exactamente lo que
Solvento tardó años en construir. Sin eso, "hacer factoraje" es una promesa vacía.

**Obligación que sí aplica sin excepción, tenga o no registro de SOFOM:** el otorgamiento
habitual y profesional de crédito o factoraje es una **"actividad vulnerable"** bajo la
**LFPIORPI (Ley Antilavado), artículo 17, fracción IV** — obliga a darse de alta en el sistema
del SAT (SPPLD), identificar a cada cliente, y presentar **aviso** cuando la operación alcance o
supere **1,605 UMA** (diputados.gob.mx, PDF oficial LFPIORPI, párrafo reformado DOF 16-jul-2025).
Esto es ley, no facilidad: se cumple exista o no registro de SOFOM.

### Quién ya lo hace en México

- **Solvento** — el competidor directo, ya perfilado en `08-competencia.md` como "contexto del
  segmento, no competidor directo" pero que en 2026 ya es explícitamente un competidor de
  producto: además de conciliar CFDI y Carta Porte, hoy vende **QuickPay** (pronto pago) y línea
  de crédito revolvente para transportistas, con Val-IA (su motor de validación de tarifas,
  PODs y facturas) como la pieza que valida el riesgo antes de adelantar el dinero — la misma
  posición de "yo ya vi el dato real" que Likida quiere ocupar.
- **Konfío** y **Klar** — crédito PyME genérico (no específico de flete), regulados por CNBV/
  CONDUSEF; Klar es banco múltiple. Compiten por el mismo bolsillo del contralor pero sin el dato
  de viaje.
- **Serfimex Capital, Credijal, Grupo IBC** — SOFOM enfocadas en financiar la operación de
  transporte (ver también §5, financiamiento de unidades: varias de estas ofrecen tanto crédito
  simple para capital de trabajo como arrendamiento de unidades).

### Qué tan natural es desde Likida — brutalmente honesto

**Natural como referido, no natural como fondeador.** Likida ya captura, viaje por viaje, la
evidencia que un factorante necesita para poner precio al riesgo: CFDI validado, Carta Porte,
comprobación de gastos, historial de cuadre. Eso es exactamente lo que hace Val-IA de Solvento
"por fuera". Likida puede:

- **Referir** al contralor a un factorante (Solvento, un SOFOM regional) y cobrar comisión de
  originación — cero capital, cero licencia, solo el dato y la confianza ya ganada.
- **A mediano plazo**, si el volumen de viajes cuadrados lo justifica, constituir una SOFOM ENR
  propia (barrera de trámite baja, ver arriba) pero **fondeada por un tercero** (línea de deuda de
  un banco o fondo, como hizo Solvento), nunca con caja propia de Likida.
- **Lo que NO debe hacer:** prestar con caja propia sin una línea de fondeo institucional detrás.
  Es la diferencia entre ser Solvento y ser un prestamista informal con mejor UX.

---

## 2. Monederos y tarjetas de combustible (Edenred, Efectivale, Sí Vale, Toka, Broxel)

### Cómo funciona el negocio

El emisor le vende a la empresa transportista un "monedero electrónico" (tarjeta o TAG) que se
usa exclusivamente para comprar combustible en estaciones afiliadas. La empresa precarga saldo;
el operador lo consume; el emisor **es quien factura** — no la gasolinera — con el "Complemento
de Estado de Cuenta de Combustibles para Monederos Electrónicos" (ver `05-hidrocarburos.md` §7.2
y `08-competencia.md` §7.3, ya verificado en ola 1: RMF 2026 regla 3.3.1.7). Los cinco jugadores
que ofrecen esto hoy en México —confirmado directamente en sus sitios, cerrando el pendiente
#12 que `08-competencia.md` había dejado en SIN VERIFICAR—:

| Emisor | Producto | Cobertura declarada |
|---|---|---|
| **Sí Vale (Up)** | Sí Vale Combustible | +14,000 gasolineras; "0% de comisión en tu primera dispersión" (implica comisión después) |
| **Toka** | Toka Combustible | Tarjeta o TAG; facturación automática, control por horario/zona/monto |
| **Broxel (Tengo!)** | Tengo! Combustible | +13,000 estaciones; "saldo disponible no vence" |
| **Efectivale** | Efecticard Combustible | Efectitag (NFC) para validar presencia del vehículo; hasta 30% de ahorro declarado |
| **Edenred** | Ticket Car | Ya perfilado en `08-competencia.md` §7 |

Cómo monetizan (inferido de lo público, no confirmado con cifras): **comisión por transacción o
por dispersión** (Sí Vale ofrece 0% "en tu primera dispersión", lo que implica que las siguientes
sí cobran), **cuota de administración/plataforma**, y probablemente **float** — el saldo
precargado que la empresa transfiere antes de consumirlo genera un balance que el emisor puede
invertir mientras no se gasta. Ninguno publica su tarifa; todos piden cotización.

### Qué se necesita para entrar

**Esta es la barrera más alta de las siete líneas, y está en fuente primaria del SAT, no en un
blog.** Para que el SAT autorice a una persona moral a **emitir** monederos electrónicos de
combustible (RMF 2026, reglas 3.3.1.8 y 3.3.1.10; ficha de trámite 6/ISR, sat.gob.mx):

- Ser persona moral del Título II de la LISR, con la emisión de monederos en su objeto social.
- **Capital social suscrito y pagado de al menos $10,000,000.00 MXN**, sostenido todo el tiempo
  que dure la autorización.
- Una **garantía (fianza o carta de crédito) de $10,000,000.00 MXN a favor de la TESOFE**, que se
  debe entregar dentro de los 30 días naturales siguientes a la autorización.
- Verificación **tecnológica** por la Administración General de Comunicaciones y Tecnologías de
  la Información (AGCTI) del SAT: gestión de riesgos, política de seguridad de la información,
  banco de datos con "elementos de seguridad e inviolabilidad" de vehículos y personas
  autorizadas.
- Contratos prototipo con clientes y con estaciones de servicio afiliadas, revisados por el SAT.
- **Renovación anual** (agosto-octubre, ya lo tenía `00-RESUMEN-EJECUTIVO.md`) con declaración
  bajo protesta de decir verdad.
- Si el propio emisor también vende combustible (es a la vez gasolinera), obligaciones contables
  adicionales para no mezclar los dos roles.

### Quién ya lo hace en México

Edenred, Sí Vale/Up, Toka, Broxel y Efectivale (confirmado arriba). También Mendel, indirectamente,
a través de su alianza con Visa (no es emisor de monedero de combustible en el sentido de la RMF,
sino tarjeta de crédito corporativa con recuperación de CFDI — modelo distinto, ya cubierto en
`08-competencia.md` §5).

### Qué tan natural es desde Likida — brutalmente honesto

**Nada natural como emisor. Muy natural como integrador y como canal de venta de un tercero.**
$10M de capital pagado más $10M de fianza son, para el tamaño actual de Likida, una barrera de
entrada total — es la misma orden de magnitud que ser PAC (§7) y confirma la lectura de
`08-competencia.md`: *"Likida no puede competir en la capa de medio de pago... pelea de balance y
plástico, ya perdida"*. Lo que sí es terreno propio:

- **Ingerir el estado de cuenta (ECC) del emisor que el cliente ya use** — es exactamente la
  integración #1 que `00-RESUMEN-EJECUTIVO.md` ya identificó como prioridad, y sigue siendo
  cierta.
- **Ser el canal de venta de un emisor existente** (afiliar clientes de Likida a Edenred/Sí
  Vale/Toka a cambio de comisión de referido) — igual que el modelo de factoraje del §1.
- **Conciliar los litros del ECC contra lo que el viaje debió rendir** — el ordeño de diésel, ya
  señalado en `08-competencia.md` §"Qué construir" punto 4, y que sigue siendo el hueco de
  producto real, no la emisión del monedero en sí.

---

## 3. Datos agregados de precio de diésel por zona

### Cómo funciona el negocio (el que ya existe)

**El dato ya es público y obligatorio antes de que cualquiera lo revenda.** Por el **Acuerdo
A/041/2018 de la Comisión Reguladora de Energía**, todo permisionario de expendio al público de
gasolinas y diésel está obligado a **reportar en línea su precio de venta al público**, y la CRE
lo publica en `cre.gob.mx/ConsultaPrecios/GasolinasyDiesel` — permiso, nombre de la gasolinera,
dirección, producto y precio registrado, actualizable en tiempo real (gob.mx/cre, manual oficial
de captura; cre.gob.mx, portal de consulta). Es LEY administrativa (un Acuerdo de un órgano
regulador), no facilidad ni política de un comercio.

Con ese dato público ya existe una empresa que lo empaqueta y lo vende: **PETROIntelligence**.
Su sitio muestra precios promedio por estado/municipio en tiempo real (13,000+ gasolineras) y
vende el acceso en tres formatos, **todos explícitamente sobre el mismo dato de la CRE**: API en
XML, API en JSON, y una plataforma de descarga en CSV/Excel — su propio sitio lo dice: *"todas
las opciones son SaaS... en caso de requerir un servidor propio o un desarrollo personalizado,
tiene costo extra"* (petrointelligence.com/api_descarga_precios_vigentes.php).

### Qué se necesita para entrar

**Nada, legalmente** — el dato es público y su reventa no está restringida. La barrera no es
regulatoria, es **competitiva y de producto**: hay que construir el scraper/ETL sobre el sistema
de la CRE (o replicar el trabajo que PETROIntelligence ya hizo), mantenerlo actualizado, y
ofrecer algo que el dato crudo de la CRE por sí solo no da (limpieza de precios atípicos/viejos,
mapas, alertas, comparación histórica).

### Quién ya lo hace en México

**PETROIntelligence** es el jugador establecido y, según su propia app, la fuente que consultan
apps de conductores como referencia de precio por ubicación. No encontré otro competidor directo
en esta ronda de búsqueda (ver SIN VERIFICAR).

### Qué tan natural es desde Likida — brutalmente honesto

**Poco natural como producto independiente, porque el mercado del "precio público por zona" ya
está resuelto y regalado por el gobierno.** Vender lo mismo que la CRE publica gratis, contra un
competidor que ya construyó la API, el mapa y la app, es pelear por el margen de un commodity.
**Lo que sí tiene un ángulo propio y nadie más puede replicar:** Likida no ve el precio
*publicado*, ve el precio *efectivamente pagado* por cada unidad en cada carga real, cruzado con
la ruta y el rendimiento del camión. Eso no es un dato público — es telemetría propia de compra,
y ahí sí hay una historia de "precio real pagado por tu flota vs. precio de mercado en tu
corredor" que PETROIntelligence no puede contar porque no ve transacciones, solo precios
listados. Vale la pena como *feature dentro del producto* (benchmarking del gasto real del
cliente), no como *producto de datos aparte* a vender a terceros.

---

## 4. Seguros

### Cómo funciona el negocio

En México, la intermediación de seguros para el sector transporte —responsabilidad civil
obligatoria (Ley de Caminos, Puentes y Autotransporte Federal), daños a la carga, robo, equipo
pesado— se vende casi siempre a través de **agentes o brokers especializados** (Sumari Seguros,
MAS Seguros, Sobera, Transcargo Seguro son ejemplos que encontré operando en el nicho exacto de
Likida: transporte de carga federal). El agente no es la aseguradora: cobra comisión de la
aseguradora por colocar la póliza y dar seguimiento al siniestro.

### Qué se necesita para entrar

Dos caminos, con pesos muy distintos:

1. **Ser aseguradora (Institución de Seguros).** Descartado sin discusión: el capital mínimo
   pagado que fija la CNSF para el ramo de Daños (el que cubriría carga/flotillas) es de
   **5,112,730 a 8,521,217 UDI** según cuántos ramos opere (Anexo 6.1.2 de la Circular Única de
   Seguros y Fianzas, LISF art. 49) — con la UDI rondando los $9 pesos, son **decenas a cientos de
   millones de pesos** de capital pagado. Ni de lejos viable para un startup.
2. **Ser agente de seguros persona moral (intermediario).** Requiere autorización de la **CNSF**
   bajo la **LISF (arts. 91-105)** y el **Reglamento de Agentes de Seguros y de Fianzas**: la
   sociedad debe constituirse como sociedad anónima, incluir "Agente de Seguros" en su razón
   social, tener capital social pagado (el Reglamento remite el monto mínimo a "disposiciones de
   carácter general" de la CNSF — **no encontré la cifra vigente en fuente primaria**, ver SIN
   VERIFICAR), contar con al menos 3 administradores y apoderados certificados por la propia
   CNSF. El trámite completo —opinión de nombre, dictamen de autorización, constitución ante
   notario, autorización definitiva— toma **mínimo 8 meses** según despachos que tramitan esto
   (ELAAA, Ormuz México; ambas fuentes secundarias, no primaria).

**Existe un tercer camino que la LISF sí prevé en fuente primaria** y que ninguna guía de
"cómo ser agente" menciona: el **artículo 102 LISF** permite que, para seguros de **contrato de
adhesión** (pólizas estandarizadas, no negociadas caso por caso — el tipo de seguro que encajaría
con un producto embebido en Likida), la contratación se haga a través de **una persona moral sin
necesidad de agente de seguros**, siempre que la aseguradora registre ante la CNSF el contrato de
prestación de servicios con esa persona moral. Esa persona moral queda sujeta a inspección de la
CNSF pero **no necesita la autorización completa de agente**. Es la figura que usan, por ejemplo,
las aerolíneas que venden seguro de viaje en el checkout.

### Quién ya lo hace en México

Brokers especializados en transporte de carga: **Sumari Seguros**, **MAS Seguros** (71,000+
unidades aseguradas, 5,000+ clientes declarados), **Sobera Seguros**, **Transcargo Seguro**
(1,500+ clientes declarados, especializados en carga federal). Todos son intermediarios, no
aseguradoras — colocan pólizas de AXA, GNP, Qualitas y similares.

### Qué tan natural es desde Likida — brutalmente honesto

**Natural como referido a un broker existente; posible a mediano plazo como agente persona
moral propio; descartado por completo ser aseguradora.** El camino más rápido y de menor riesgo
es un convenio de referidos con un broker ya especializado en el nicho (Sumari, MAS, Sobera,
Transcargo): Likida entrega el lead calificado (contralor que ya usa el sistema, con flota
documentada) y cobra comisión de originación. El camino del artículo 102 LISF (persona moral sin
ser agente, para pólizas de adhesión) es el que más vale la pena investigar a fondo en una
siguiente ola si Likida quiere ofrecer un seguro embebido y estandarizado (ej. "seguro de carga
por viaje" cotizado automáticamente) sin pasar por los 8 meses de trámite de agente completo.

---

## 5. Financiamiento de unidades (crédito y arrendamiento de tractocamiones)

### Cómo funciona el negocio

Renovar una flota es intensivo en capital: un tractocamión nuevo cuesta varios millones de pesos.
La industria lo resuelve con **arrendamiento puro** (renta, sin obligación de comprar), **arren-
damiento financiero** (renta con opción de compra a valor residual) o **crédito simple** contra
el vehículo como garantía. Quien financia gana el diferencial de tasa entre su costo de fondeo y
lo que cobra al transportista, más comisiones.

### Qué se necesita para entrar

**Exactamente el mismo régimen legal que el factoraje (§1), porque es la misma ley.** El art. 4°
de la LGOAAC agrupa crédito, arrendamiento financiero y factoraje financiero como una sola
"actividad auxiliar del crédito", y el art. 87-B ya citado dice que **cualquier persona puede
realizarlas habitual y profesionalmente sin autorización del Gobierno Federal**. El registro
como SOFOM (ENR si no tiene vínculo patrimonial con un banco) es el mismo trámite de CONDUSEF
descrito en §1. La LFPIORPI también aplica igual (actividad vulnerable, art. 17 fr. IV).

**El requisito real, otra vez, es el capital para fondear.** Un director de negocios de Serfimex
Capital (SOFOM especializada en autotransporte) declaró en prensa los requisitos que ellos piden
al transportista **para otorgar** el crédito — que ilustran el tamaño del cliente que este
negocio necesita para ser viable: persona moral con **más de 2 años de operación**, **mínimo
$25,000,000 MXN en ventas anuales**, y buen historial en buró de crédito (NotiPress, 11-jun-2024,
prensa especializada — no fuente primaria, tratar como referencia de mercado).

### Quién ya lo hace en México

- **Serfimex Capital**, **Credijal** (SOFOM que debutó en la BMV en julio 2026 con emisión de
  deuda por $250 millones de pesos, enfocada en "equipo de transporte de carga pesada" — Reforma,
  23-jul-2026), **Grupo IBC** (arma SOFOM a la medida para empresas de logística).
- **TIP México** — arrendamiento puro y financiero de tractocamiones y cajas secas específicamente.
- **SOFOM Inbursa** — crédito automotriz para flotillas, dentro de un grupo financiero regulado.
- **Finactiv** — arrendamiento de equipo de transporte para PyME.

### Qué tan natural es desde Likida — brutalmente honesto

**Idéntico diagnóstico que el factoraje: no natural como fondeador, natural como referido y como
generador del dato de underwriting.** Likida tiene algo que ninguna SOFOM de las listadas
declara tener: el historial de cuadre viaje por viaje, que es exactamente el tipo de dato
alternativo (no solo buró de crédito) que reduciría el riesgo de financiar a una flota chica sin
historial bancario largo. La jugada de bajo riesgo es la misma: **convenio de referidos con una
SOFOM existente**, no construir la propia mientras Likida no tenga ni el capital ni el balance
para sostenerla.

---

## 6. Contabilidad

### Cómo funciona el negocio (y por qué ya está saturado)

"Vender contabilidad" a una flota puede significar dos cosas muy distintas, y confundirlas cuesta
caro (regla dura del encargo: no promediar):

1. **Software contable/ERP** que genera pólizas automáticas a partir de los CFDI — esto **ya lo
   hacen, integrado, media docena de competidores directos del segmento exacto de Likida**:
   ClickBalance ("genera pólizas contables automáticas sin captura manual"), SIGA Autotransporte
   ("integración contable automática y cumplimiento regulatorio"), Advanpro ERP Trucks
   ("automatización de... conciliaciones y contabilidad"), Logista C2K ("Contafiscal C2K:
   ventas, cobranza y gastos reflejados automáticamente") y LISTMS+ (módulo de facturación y
   administración). Todos ya declaran carta porte + control de gastos + contabilidad integrada
   para transporte específicamente.
2. **Servicio de contaduría/despacho** (preparar y presentar declaraciones, dictaminar estados
   financieros) — esto **sí tiene una barrera legal real pero acotada**: firmar un **dictamen
   fiscal formal** exige ser Contador Público Registrado ante el SAT (CFF art. 52), ya
   investigado a fondo en `21-guardarrailes.md` de esta misma ola. La preparación de pólizas y la
   contabilidad del día a día, en cambio, **no exige ningún título ni registro** — cualquiera
   puede llevarla, y de hecho la mayoría de las flotas chicas la llevan con un contador
   independiente sin despacho formal.

### Quién ya lo hace en México

Los cinco ERP de transporte listados arriba, más el ecosistema genérico de software contable
mexicano (CONTPAQi, Aspel, Alegra) que cualquier despacho contable ya usa y que ya tiene salida a
"archivo Contpaqi TXT" en el propio roadmap de Likida (`GUIA_BUILD.md` línea 120: *"ERP nativo
(empezar por archivo Contpaqi TXT)"*).

### Qué tan natural es desde Likida — brutalmente honesto

**Poco natural como producto de contabilidad completo — el mercado de ERP de transporte ya lo
resuelve, y construirlo de cero es reconstruir cinco competidores establecidos.** Lo natural es
lo que Likida ya tiene en su hoja de ruta: **exportar limpio hacia el software contable que el
cliente ya usa** (o hacia el despacho contable del cliente) en vez de intentar sustituirlo. Un
canal de socios con despachos contables — "te entregamos la póliza lista, tú la validas y la
presentas" — es más defendible que competir de frente contra ERP ya maduros, y encaja con la
misma lógica de referido que domina las otras líneas de esta investigación.

---

## 7. Venta de la capa de facturación/validación como API

### Cómo funciona el negocio

Es el modelo que ya perfiló `08-competencia.md` con **FacturaGPT**: una capa de infraestructura
(foto/ticket → CFDI validado) que se vende por resultado a otros productos (fintechs, tarjetas
corporativas, despachos contables), no al usuario final. FacturaGPT cobra **$4 MXN + IVA por CFDI
exitoso**, con webhook `factura.completed` y `external_id` para amarrar el CFDI a la transacción
del cliente.

### Qué se necesita para entrar

Dos caminos, con una diferencia de capital enorme entre ellos:

1. **Ser Proveedor Autorizado de Certificación (PAC) del SAT** — certificar CFDI directamente
   contra el SAT. Requiere (fuente primaria, sat.gob.mx, Anexo 1-A/ficha 112/CFF): **capital
   social suscrito y pagado de al menos $10,000,000.00 MXN** sostenido durante toda la vigencia
   de la autorización, **garantía (fianza o carta de crédito) de $10,000,000.00 MXN a favor de la
   TESOFE**, dictamen de estados financieros (CFF art. 32-A) cada ejercicio, verificación
   tecnológica de infraestructura y seguridad por la AGCTI, y la obligación de **certificar
   gratis** a cualquier contribuyente que use la aplicación gratuita del SAT (es decir: el
   negocio de PAC no es "cobrar por certificar", es cobrar por todo lo que rodea a la
   certificación con valor agregado). **Es exactamente la misma orden de magnitud que ser emisor
   de monedero de combustible (§2)** — no es casualidad, el SAT usa el mismo molde de $10M+$10M
   para todo lo que involucra timbrar en su nombre.
2. **Revender la capa comprándola a un PAC o agregador existente** (FacturaGPT, o directamente a
   un PAC certificado) y empaquetarla con la lógica propia de validación que Likida ya construye
   (deduplicación, faja de 50 km, complemento de hidrocarburos, forma de pago) — cero capital
   regulatorio, la barrera es puramente técnica y comercial.

### Quién ya lo hace en México

FacturaGPT (infraestructura pura, B2B). Fotofacturas y Clara también ofrecen "Factu API/SDK" y
capacidades empresariales sin precio público (`08-competencia.md` §"SIN VERIFICAR" #13). Los PAC
certificados por el SAT son decenas (lista pública en el portal del SAT) — son la capa que todos
estos productos, incluido FacturaGPT, terminan usando por debajo.

### Qué tan natural es desde Likida — brutalmente honesto

**Muy natural como reventa de lo que Likida ya construye para sí, nada natural como PAC propio.**
`08-competencia.md` ya lo recomendó en su plan de "qué construir": *"Compra la capa de
ticket→CFDI, no la construyas... construye tú solo los 10-15 conectores que importan en
carretera"*. Ese motor de validación fiscal específico de transporte (faja de 50 km, complemento
de hidrocarburos, deduplicación, régimen del operador) **es lo único de las siete líneas de este
documento que ningún competidor general —ni FacturaGPT, ni un PAC genérico— puede replicar sin
tener el viaje como Likida lo tiene.** Es, con diferencia, la línea de ingreso adyacente más
defendible: vender ese motor como API a despachos contables o a otras verticales de gasto en
carretera (renta de autos, mensajería) que enfrentan el mismo problema de comprobantes en efectivo
sin el contexto del viaje.

---

## Tabla comparativa

| Línea | ¿Entidad financiera regulada? | Capital de entrada | Quién ya lo hace | Qué tan natural para Likida |
|---|---|---|---|---|
| Factoraje / adelanto de facturas | No para operar (LGOAAC 87-B); registro CONDUSEF si se llama SOFOM | Bajo en trámite, **alto en fondeo** (Solvento: $75M USD en deuda) | Solvento, Konfío, Klar, SOFOM regionales | **Alto** como referido; bajo como fondeador propio |
| Monederos/tarjetas de combustible | Sí — autorización SAT (RMF 3.3.1.8) | **$10M MXN capital + $10M MXN fianza** | Edenred, Sí Vale, Toka, Broxel, Efectivale | **Nulo** como emisor; **alto** como integrador/canal |
| Datos de precio de diésel por zona | No | Bajo (dato público, CRE) | PETROIntelligence (ya lo revende) | **Bajo** como producto aparte; útil como feature interno |
| Seguros | Sí para aseguradora (descartado); sí, más ligero, para agente | Aseguradora: cientos de millones MXN. Agente persona moral: capital menor, sin cifra confirmada en fuente primaria | Sumari, MAS Seguros, Sobera, Transcargo | **Alto** como referido a broker; **medio** como agente propio a mediano plazo |
| Financiamiento de unidades | No para operar (mismo art. 87-B); registro CONDUSEF si SOFOM | Igual que factoraje: bajo en trámite, alto en fondeo | Serfimex, Credijal, Grupo IBC, TIP México, SOFOM Inbursa | **Alto** como referido; bajo como fondeador propio |
| Contabilidad | No | Bajo (no requiere licencia para llevar contabilidad; sí para dictaminar) | SIGA, ClickBalance, Advanpro, Logista, LISTMS+ (todos con módulo integrado) | **Bajo** como producto propio; medio como canal hacia despachos |
| API de facturación/validación | No, si se revende una capa ya certificada por un PAC | Bajo (comprar la capa); **$10M + $10M** si se quiere ser PAC | FacturaGPT (infraestructura), Fotofacturas/Clara (API empresarial) | **Muy alto** — es la única línea 100% defendible con lo que Likida ya construye |

---

## Acciones concretas

| Acción | Por qué | Esfuerzo | Cuándo |
|---|---|---|---|
| Cerrar convenio de referidos con Solvento (o una SOFOM comparable) para factoraje | Cero capital, cero licencia; monetiza la confianza que Likida ya tiene con el contralor sin tocar el balance | Bajo | Antes de la demo del 6-ago, como línea de "roadmap de ingresos" en el pitch |
| Cerrar convenio de referidos con un broker de seguros de carga (Sumari, MAS Seguros, Sobera o Transcargo) | Mismo modelo que el de factoraje; el contralor ya necesita renovar pólizas cada año | Bajo | Q3 2026 |
| Cerrar convenio de referidos con una SOFOM de financiamiento de unidades (Serfimex, Credijal, Grupo IBC) | Mismo modelo; capitaliza el momento en que el cliente pregunta "¿cómo renuevo la flota?" | Bajo | Q3-Q4 2026 |
| Empaquetar el motor de validación fiscal (faja 50 km, hidrocarburos, deduplicación) como API vendible a despachos contables | Es la única línea que ningún competidor puede replicar sin el viaje; convierte un costo interno en producto | Medio | Q4 2026, después de validar el producto principal con los primeros clientes |
| Investigar a fondo el artículo 102 LISF (persona moral que vende seguros de adhesión sin ser agente completo) | Podría abrir un seguro de carga embebido y cotizado automáticamente por viaje, sin los 8 meses de trámite de agente | Medio (investigación legal dedicada, próxima ola) | Cuando el volumen de viajes lo justifique |
| Ingerir el ECC (estado de cuenta) del emisor de monedero que cada cliente ya use, y conciliar litros contra rendimiento del viaje | Ya identificado como integración prioritaria en `00-RESUMEN-EJECUTIVO.md`; no requiere ser emisor | Alto (técnico) | Ya en roadmap — reforzar prioridad con este hallazgo |
| **No construir:** monedero de combustible propio, ser PAC propio, ser aseguradora, producto de datos de precio de diésel, ERP contable propio | Cada uno choca con una barrera de capital regulatorio ($10-100M+ MXN), un competidor ya establecido, o un dato que el gobierno regala gratis | — | Nunca, salvo cambio radical de escala/capital de la empresa |

---

## CONFLICTOS

Ninguno identificado contra otros documentos de la ola 1 o de esta ola 2. Esta investigación
**resuelve** un pendiente que `08-competencia.md` había dejado abierto en su sección SIN
VERIFICAR (#12: *"Toka, Broxel y Efectivale... no pude leer sus sitios ni verificar su oferta,
cobertura o precios"*) — en esta ola sí se leyeron directamente y se confirma que ofrecen el
mismo tipo de producto que Edenred (monedero de combustible con CFDI resuelto por ley). No es una
contradicción, es un cierre de hueco.

---

## SIN VERIFICAR

1. **Capital social mínimo específico para un agente de seguros persona moral.** El Reglamento de
   Agentes de Seguros y de Fianzas remite el monto a "disposiciones de carácter general" de la
   CNSF; encontré la cifra de capital mínimo para **aseguradoras** (millones de UDI, fuente
   primaria: Anexo 6.1.2 de la Circular Única) pero no la cifra equivalente para **agentes**. Dos
   fuentes secundarias (blogs de despachos) mencionan cifras muy bajas ("desde $1 peso") que no
   pude confirmar en la disposición de carácter general original.
2. **Texto literal completo del artículo 87-B de la LGOAAC en el PDF primario de
   diputados.gob.mx.** El documento es demasiado extenso para paginar hasta ese artículo en esta
   ronda. Se confirmó su existencia y contenido por triangulación: el mismo PDF de
   diputados.gob.mx cita "artículo 87-B" en su artículo 7° con el mismo efecto legal descrito;
   condusef.gob.mx (fuente de gobierno) cita el mismo artículo con el mismo contenido; y tres
   mirrors legales independientes (mley.mx, lena.mx, sdv.com.mx) reproducen el texto idéntico.
   Alta confianza, pero no es lectura directa del PDF oficial artículo por artículo.
3. **Comisiones, tarifas y modelo de monetización exacto de Edenred/Sí Vale/Toka/Broxel/
   Efectivale.** Ninguno publica su tarifa; todos piden cotización. La inferencia de que cobran
   por transacción/dispersión más una posible cuota de plataforma se basa en indicios de
   marketing ("0% en tu primera dispersión" de Sí Vale implica que las siguientes sí cobran), no
   en una tarifa publicada.
4. **Valor en pesos del umbral de 1,605 UMA de la LFPIORPI para el aviso de factoraje/crédito.**
   No se hizo la conversión con el valor de UMA vigente en 2026; usar el valor que ya cita
   `07-no-fiscal.md` de esta misma base de conocimiento ($117.31 en 2026) para el cálculo antes de
   usarlo en material comercial o de cumplimiento.
5. **Si existe ya en México un competidor directo que agregue precios de diésel más allá de
   PETROIntelligence.** Solo se identificó ese jugador en esta ronda de búsqueda; no se descarta
   que existan otros (apps de conductores tipo Waze-fuel, o agregadores B2B) que no aparecieron.
6. **Si Solvento, Konfío, alguna SOFOM de transporte o algún broker de seguros de carga tiene ya
   un programa formal de referidos/afiliados para partners de tecnología como Likida.** Se
   investigó su producto, no su política de canal. Confirmar directamente antes de construir el
   pitch de referidos sobre un supuesto no verificado.
7. **Alcance exacto del artículo 102 LISF** (persona moral que vende seguros de adhesión sin ser
   agente) aplicado a un producto de seguro de carga por viaje. Se leyó el texto de la ley; no se
   investigó si alguna aseguradora ya tiene un contrato de este tipo registrado ante la CNSF con
   un actor no-agente en el sector transporte, ni el proceso práctico para conseguirlo.

---

## Fuentes

### Fuentes primarias (gobierno, leídas directamente)

- LGOAAC, Ley General de Organizaciones y Actividades Auxiliares del Crédito, Última Reforma DOF
  14-11-2025 (arts. 1-7, 87-K citados en lectura directa; 87-B confirmado por triangulación —
  ver SIN VERIFICAR #2). https://www.diputados.gob.mx/LeyesBiblio/pdf/LGOAAC.pdf
- CONDUSEF, Sistema de Registro de Prestadores de Servicios Financieros (SIPRES), requisitos de
  alta para SOFOM. https://webapps.condusef.gob.mx/SIPRES/jsp/index.jsp
- CONDUSEF, Portal Único de Registros, alta de Instituciones Financieras.
  https://pur.condusef.gob.mx/SolicitudAltaIF/
- CONDUSEF, contenido sobre el objeto social conforme al art. 87-B LGOAAC.
  https://www.condusef.gob.mx/?idc=696&idcat=1&p=contenido
- CNBV, Sociedades Financieras de Objeto Múltiple (Sofomes).
  https://www.gob.mx/cnbv/acciones-y-programas/sociedades-financieras-de-objeto-multiple-sofomes
- LFPIORPI, Ley Federal para la Prevención e Identificación de Operaciones con Recursos de
  Procedencia Ilícita, art. 17 fr. IV (párrafo reformado DOF 16-jul-2025).
  http://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf
- SAT, Actividades Vulnerables (LFPIORPI), umbrales de identificación y aviso.
  https://www.sat.gob.mx/minisitio/ActividadesVulnerables/index.html
- SAT, preguntas frecuentes sobre Actividades Vulnerables (SPPLD).
  https://sppld.sat.gob.mx/pld/interiores/preguntas.html
- RMF 2026, regla 3.3.1.8 (requisitos para emitir monederos electrónicos de combustible, incl.
  capital $10M y fianza $10M) y ficha de trámite 6/ISR, SAT.
  http://www.sat.gob.mx/gobmx/Paginas/ficha_6_isr.html ·
  https://www.sat.gob.mx/informacion_fiscal/tramites/mon_elec/Paginas/ficha_6_isr.aspx
- Anexo 10 de la RMF 2026 (obligaciones y requisitos de emisores de monederos electrónicos), SAT,
  09-ene-2026. https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo_10_RMF2026-09012026.pdf
- CRE, Precios de expendio de gasolinas y diésel, obligación conforme al Acuerdo A/041/2018.
  https://www.cre.gob.mx/ConsultaPrecios/GasolinasyDiesel/GasolinasyDiesel.html
- CRE, Manual para la captura del Reporte estadístico de información de expendio de gasolinas y
  diésel. https://www.gob.mx/cms/uploads/attachment/file/453034/Reporte_estad_stico_de_informaci_n_de_expendio_de_gasolinas_y_di_sel.pdf
- LISF, Ley de Instituciones de Seguros y de Fianzas, arts. 91-105 (agentes de seguros, y art. 102
  sobre personas morales para contratos de adhesión), CNSF Interactiva.
  https://lisfcusf.cnsf.gob.mx/LISF/LISF_4_2_S1
- Reglamento de Agentes de Seguros y de Fianzas, SHCP.
  https://www.shcp.gob.mx/lashcp/MarcoJuridico/documentosDOF/archivos_shcp_dof/reglamentos/ri_asf.html
- CNSF, Capítulo 6.1 del capital mínimo pagado (aseguradoras) y Anexo 6.1.2.
  https://lisfcusf.cnsf.gob.mx/CUSF/CUSF6_1 ·
  https://www.gob.mx/cms/uploads/attachment/file/560817/ANEXO_6.1.2_.pdf
- SAT, Requisitos y obligaciones para ser Proveedor Autorizado de Certificación (PAC), capital
  $10M + fianza $10M.
  https://www.sat.gob.mx/minisitio/Factura/proveedores_requisitos.htm ·
  https://www.sat.gob.mx/minisitio/Factura/proveedores_obligaciones.htm

### Sitios de empresas (leídos directamente)

- Solvento — https://solvento.ai/ · https://solvento.ai/soluciones · https://www.solvento.mx/
- El Financiero, "Solvento y BBVA Spark cierran financiamiento por 25mdd" (13-feb-2026).
  https://www.elfinanciero.com.mx/transporte-y-movilidad/2026/02/13/solvento-y-bbva-spark-cierran-financiamiento-por-25mdd-para-fortalecer-transporte-y-logistica-en-mexico/
- BBVA, nota sobre el financiamiento a Solvento (12-feb-2026).
  https://www.bbva.com/es/mx/economia-y-finanzas/solvento-y-bbva-spark-cierran-financiamiento-por-25-millones-de-dolares/
- Descubre.vc, ficha de Solvento. https://www.descubre.vc/solvento
- Sí Vale Combustible — https://info.sivale.mx/tarjeta-de-gasolina-para-empresas ·
  https://www.sivale.mx/vales-de-gasolina
- Toka Combustible — https://www.toka.com.mx/productos/combustible/
- TENGO! (Broxel) Combustible — https://tengovales.com/combustible/
- Efectivale, Efecticard Combustible — https://www.efectivale.com.mx/index.php/productos/efecticard-combustible
- PETROIntelligence — https://petrointelligence.com/ ·
  https://petrointelligence.com/precios-de-la-gasolina-y-diesel-hoy.php ·
  https://petrointelligence.com/api_descarga_precios_vigentes.php
- Sumari Seguros — https://sumariseguros.com/
- MAS Seguros — https://www.masseguros.mx/
- Sobera Seguros y Fianzas — https://soberaseguros.mx/2024/11/02/coberturas-especializadas-para-el-autotransporte-de-carga-y-mercancias/
- Transcargo Seguro — https://transcargoseguro.com/
- Finactiv — https://finactiv.com.mx/
- Grupo IBC, SOFOM para Logística y Transporte — https://www.grupoibc.mx/sofom-logistica
- SOFOM Inbursa, Crédito Automotriz Flotillas — https://sofom.inbursa.com/CreditoAutomotrizFlotillas.aspx
- TIP México, arrendamiento de tractocamiones — https://www.tipmexico.com/arrendamiento-de-trailers/
- Reforma, "Busca Credijal duplicar su cartera" (23-jul-2026).
  https://www.reforma.com/busca-credijal-duplicar-su-cartera-en-el-corto-plazo/ar3245689
- NotiPress, "Sofomes, la clave para impulsar las flotillas del autotransporte en México"
  (11-jun-2024, prensa especializada). https://notipress.mx/negocios/sofomes-clave-impulsar-flotillas-autotransporte-mexico-22256
- ClickBalance ERP para transporte — https://clickbalance.com/para/transporte
- Advanpro ERP Trucks — https://advanpro.com.mx/soluciones/advanpro-erp
- SIGA Autotransporte — https://siga.mx/siga-autotransporte-software-erp-para-gestion-de-flotas-y-logistica/
- Logista C2K — https://www.control2000.com.mx/productos/logista.php
- LISTMS+ — https://lis.com.mx/software-transporte-tms-plus/
- Konfío — https://konfio.mx/ · https://konfio.mx/credito/
- Klar Empresarial — https://klar.mx/empresarial/credito-pyme · https://www.klar.mx/empresarial

### Fuentes legales secundarias (mirrors de texto, usadas solo para el art. 87-B LGOAAC)

- mLey.mx, Artículo 87-B LGOAAC — https://mley.mx/LGOAAC/articulo/87-b/
- lena.mx, Artículo 87-B LGOAAC — https://lena.mx/v/lgoaac/a:87-B
- SDV Asesores de Negocios, Artículo 87-B LGOAAC — https://sdv.com.mx/compendio/ley-general-de-organizaciones-y-actividades-auxiliares-del-credito/articulo-87-b/
- APTA CE, reglas 3.3.1.8 y 3.3.1.10 de la RMF (reproducción del texto oficial, usada para
  contrastar contra la fuente primaria del SAT). http://www.apta.com.mx/aptace/reglasfis/regla.php?regla=3.3.1.8 ·
  http://www.apta.com.mx/aptace/reglasfis/regla.php?regla=3.3.1.10

### Documentos internos de Likida citados

- `/Users/javiercamaraportepetit/javiercamarapp/likida/GUIA_BUILD.md` (línea 120, sobre
  autofacturación de gasolineras y roadmap de agregadores).
- `/Users/javiercamaraportepetit/javiercamarapp/likida/DOCUMENTO_MAESTRO.md` (§2.6, §4.2, sobre
  vía PAC para descarga masiva y tarjetas de flotilla).
