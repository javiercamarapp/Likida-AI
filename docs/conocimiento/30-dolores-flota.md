# Mapa completo de dolores de una flota mexicana

> Ola 2 — 27-jul-2026. Construido sobre la ola 1 (`00` a `11`, y `11-huecos.md` de esta misma ola).
> No repite lo que la ola 1 ya cerró (multas de tránsito, vencimientos documentales, peaje por
> configuración, reconstrucción de horas de servicio, contadores fiscales de combustible): los
> referencia y construye al lado. Este documento cubre **el resto de lo que sufre una flota**:
> rendimiento y robo de diésel, mantenimiento y llantas, siniestros y seguros, control y rotación de
> operadores, tiempos de espera en carga y descarga, robo de mercancía, facturación al cliente y
> cobranza, y cierre contable.
> Fuentes primarias donde hay norma (DOF, SICT/IMT, SAT). Donde el dolor es de mercado —no de ley—
> se citan cámaras y organismos oficiales (CANACAR, SESNSP, IMT, IRU) y, cuando no hubo otra opción,
> blogs de proveedores de software de flotas — marcados **PISTA** y nunca usados como fundamento.

---

## Resumen para el fundador

Liquidar el viaje es solo una de nueve cosas que le duelen a un contralor de flota, y no
necesariamente la más cara. El combustible sigue siendo el dolor mayor —entre 30% y 50% del costo
operativo según la fuente, con una franja de "ordeña" (robo de diésel del propio tanque) que puede
irse entre 80 y 300 litros por evento— pero **Likida ya está sentado en ese dato**: el ticket o el
estado de cuenta del monedero, la hora y, si se pide, el odómetro. Cruzarlo contra el rendimiento
esperado de la unidad es la extensión más barata y más cercana que existe al producto actual, y
nadie del mapa de competencia lo hace completo.

Después de eso hay tres bloques de dolor real que Likida puede tocar con lo que ya recibe por
WhatsApp sin nueva integración dura: los **tiempos de espera en carga y descarga** (que además
tienen consecuencia salarial por la LFT, ya identificada en la ola pasada), los **vencimientos y el
mantenimiento por unidad** (un correctivo cuesta de 3 a 55 veces más que el preventivo programado a
tiempo) y el **cierre contable del contralor** (pólizas, DIOT, conciliación bancaria: literalmente el
destino final de cada comprobante que Likida ya procesa).

Hay otro bloque de dolor gigantesco pero más lejano del producto actual: **el robo de mercancía y de
unidades en carretera** (más de 10 mil carpetas de investigación en 2025, pérdidas del sector
estimadas arriba de $7,000 millones de pesos), la **rotación de operadores** ($215,000 pesos por
baja, déficit de 80,000 a 99,000 operadores según el año) y el **cobro al cliente** (53 a 90 días de
plazo promedio, factoraje al 1%–30%). Estos tres duelen mucho pero viven en sistemas que Likida hoy
no toca (GPS en tiempo real, reclutamiento, facturación de ingreso al cliente); son negocio futuro,
no la próxima integración.

La respuesta a la pregunta del encargo: **Likida no debe quedarse en liquidar viajes.** El mismo
flujo de comprobantes por WhatsApp, con los timestamps, la geolocalización y el registro por unidad y
operador que ya construye para la liquidación, es la base de datos que resuelve rendimiento de
combustible, mantenimiento preventivo, tiempos de espera y el expediente de un siniestro. Eso es
expandir el radio del mismo dato, no construir un producto nuevo. El robo de mercancía, la rotación de
personal y la cobranza al cliente son dolores reales y caros, pero exigen otra fuente de datos (GPS
vivo, RH, facturación de ingreso) y se quedan fuera del roadmap inmediato.

---

## 1. Mapa de los nueve dolores (antes de entrar al detalle)

| # | Dolor | Qué tan caro | Quién lo sufre | Cómo se resuelve hoy | ¿Likida con los comprobantes que ya ve podría atacarlo? |
|---|---|---|---|---|---|
| 1 | Rendimiento de combustible y ordeña de diésel | Combustible es 30%–50% del costo operativo (rango según fuente, ver §2); "sangrías" de 80–300 L por evento | Dueño de flota, contralor | Excel manual, algunos monederos con validación de odómetro (Edenred) | **Sí, directo.** Ya tiene el ticket/estado de cuenta y puede pedir el odómetro |
| 2 | Mantenimiento (preventivo vs. correctivo) y llantas | Correctivo cuesta 3x–55x el preventivo por componente; un camión mal mantenido puede costar $440k–$920k MXN/año vs. $111k–$160k con preventivo (PISTA, ver §3) | Jefe de taller, contralor | Bitácora en papel o Excel, calendario por kilometraje a mano | **Sí, con esfuerzo medio.** Requiere sumar la unidad y el CFDI de taller al flujo, que hoy Likida no ingiere |
| 3 | Siniestros y seguros | Deducible ~20% sobre una unidad de ~$7M; reposición 3–6 meses; pago de indemnización hasta 30 días **desde documentación completa** — y esa documentación es lo que tarda | Contralor, área legal | Trámite manual con el ajustador, papeleo disperso | **Sí, indirecto.** Likida ya tiene fecha, hora, geolocalización y fotos del viaje: es el expediente que el asegurador pide |
| 4 | Control y rotación de operadores | ~$215,000 MXN por baja (PISTA); déficit de 80,000–99,000 operadores; 90,000 camiones parados por falta de choferes | RH, contralor, jefe de tráfico | Reclutamiento reactivo, sin dato de retención | **Parcial.** El registro electrónico de jornada (LFT art. 132 fr. XXXIV, obligatorio desde 1-ene-2027) sí es cercano; el reclutamiento no |
| 5 | Tiempos de espera en carga y descarga | $75–$300 USD/hora de penalización típica; un CEDIS con 30 unidades/día y 2h de espera promedio genera $30k–$96k MXN/día en costo oculto (PISTA) | Operador (pierde jornada), contralor (paga o no cobra la demora) | Nada sistemático; disputa por correo al cierre de mes | **Sí, directo.** Los timestamps de WhatsApp y el GPS del ticket ya reconstruyen el tramo |
| 6 | Multas en carretera | Ya cubierto en `07-no-fiscal.md` §10 | Operador, contralor | — | Ya diseñado; ver ese archivo |
| 7 | Robo de mercancía y de unidades | 10,367 carpetas de investigación en 2025 (SESNSP); pérdidas del sector estimadas en $7,000+ millones MXN/año | Operador (riesgo físico), contralor, aseguradora | Cámaras, doble jammer, GPS, seguridad privada | **No directo.** Es un evento de seguridad en tiempo real; Likida no monitorea GPS vivo |
| 8 | Facturación al cliente y cobranza | Plazo promedio 53–90 días; factoraje cuesta 1%–30% del valor de la factura | Contralor, tesorería | Factoraje, Excel de cartera, llamadas de cobranza | **No directo hoy.** Es el lado de ingreso (factura al cliente), no de gasto (comprobante del viaje) |
| 9 | Cierre contable mensual | Conciliación bancaria manual: 8–16 horas/mes para 500 movimientos (PISTA); pólizas, DIOT, declaraciones | Contralor, contador externo | Excel, sistemas contables genéricos (Contpaqi, Aspel) sin dato de flota | **Sí, directo.** Es literalmente el destino del export de Likida; ya identificado en `11-huecos.md` §1.1–1.2 |

La columna de la derecha es la que ordena la prioridad: los dolores 1, 5 y 9 están a una integración
de distancia. Los dolores 2 y 3 están a un esfuerzo medio. Los dolores 4, 7 y 8 son reales y caros
pero viven en otro sistema de datos.

---

## 2. Combustible: rendimiento por unidad y robo de diésel ("ordeña")

### 2.1 Cuánto pesa el combustible en el costo — y por qué la cifra varía tanto

No hay una sola cifra confiable citada en fuente oficial primaria; lo que hay es un rango amplio
según quién lo mide y con qué metodología:

- **CANACAR, citado por Expansión (14-abr-2026):** el combustible representa **hasta 30%** de los
  costos del autotransporte, y por cada peso que sube el diésel el flete se encarece 4%.
- **Total Protect (aseguradora de flotas), citado por T21 (25-may-2026):** el combustible representa
  **hasta 50%** de los costos operativos de una flota.
- **IMT, Publicación Técnica 536 (`pt536.pdf`):** en el estudio de elasticidad de costos por
  configuración vehicular, el diésel explica **67% del impacto** para un camión ligero (C2) y **82%**
  para el más pesado (T3-S2-R4) — esto mide la contribución del diésel al *incremento* de los costos
  de operación estudiados en 2017-2019, no necesariamente el % que el diésel representa del costo
  total de operación.
- **PISTA (Smart Fleet, blog de proveedor, jul-2026):** ubica al diésel en 33.7% de una "canasta
  básica CANACAR" y en otro artículo en 35% de la estructura de costo — cifras no verificadas contra
  el documento primario de CANACAR, solo referenciadas por el proveedor.

**CONFLICTO:** cuatro fuentes, cuatro cifras (30%, 33.7%–35%, 50%, 67%–82% según metodología). Ninguna
es la canasta básica oficial de CANACAR leída en fuente primaria — no se localizó el documento
vigente 2026 de CANACAR, solo su edición de 2019 (INEGI/CANACAR, `Autotrans2019...pdf`) que reporta
el gasto en combustibles y lubricantes como **el más importante del autotransporte** sin desglosar el
% exacto en el extracto disponible. **No usar ningún porcentaje puntual en material comercial** hasta
confirmar contra la canasta CANACAR 2026 vigente; usar el rango "30%–50% del costo operativo,
según fuente" con esta nota al pie.

### 2.2 La ordeña: robo del propio tanque, no solo robo en carretera

> *"El combustible representa hasta el 50% de los costos operativos de una flota, por lo que
> cualquier extracción ilegal impacta directamente en la rentabilidad... existen casos donde las
> unidades pueden perder entre 80 y hasta 300 litros de combustible en una sola descarga no
> autorizada."*
> — Ángeles Useche, directora Comercial de Total Protect, citada por T21, 25-may-2026.

Con el precio del diésel en la franja de $24–$29/L reportada en la nota de Expansión (abr-2026), una
sola "sangría" de 300 litros son entre $7,200 y $8,700 pesos — de una sola unidad, en un solo evento,
sin que exista robo de carga ni asalto: es sustracción del tanque, típicamente en patio o durante
paradas largas, y el sector reconoce la frase "carga parada, carga robada" para el patrón de riesgo
que crece con el tiempo detenido.

Independiente de la ordeña por sustracción física, existe un problema distinto y masivo: la **compra
de diésel robado** para abaratar el costo del viaje. Una fuente periodística (Transporte.mx,
2024, citando testimonios del sector, **SIN VERIFICAR en fuente oficial**) estima que cerca del 30%
de las empresas permisionarias se trasladan con diésel de procedencia ilícita, y que de los 385,000
barriles diarios de diésel consumidos en el país, cerca de 128,000 tendrían origen en tomas
clandestinas. Esta cifra **no se pudo verificar contra PEMEX, CRE ni Secretaría de Energía** en esta
ola; se cita como magnitud del problema, no como hecho confirmado.

### 2.3 Qué ya identificó la ola 1 — y qué es nuevo aquí

`09-liquidacion.md` §4.3 ya señaló el hueco central: *"nadie tiene los tres [litros del complemento
de estado de cuenta, kilómetros de la ruta vía TMS, y rendimiento esperado de la unidad] al mismo
tiempo"*. Este documento **no repite ese hallazgo**, lo cuantifica: el litro robado no solo es una
pérdida de combustible, es dinero medible por evento (80–300 L × precio del día), y con el odómetro
que Likida ya puede pedir junto a la foto del ticket, la regla de detección es aritmética simple:

`litros cargados − (km recorridos ÷ rendimiento esperado de la unidad) = desviación`

Una desviación sostenida y positiva, por unidad y por operador, es la señal de ordeña o de compra de
diésel adulterado con recibo inflado. Esto **no requiere GPS en tiempo real ni telemetría** — solo
dos números que Likida ya puede recolectar por WhatsApp: litros del ticket/complemento y odómetro en
la foto.

---

## 3. Mantenimiento y llantas

### 3.1 El costo de no mantener a tiempo

Tres fuentes de proveedores de software de flotas mexicanos (Smart Fleet, Tracksolid, Numaris) —
todas **PISTA**, sin verificación contra CANACAR o IMT — coinciden en el orden de magnitud:

| Componente | Costo preventivo (MXN) | Costo correctivo (MXN) | Factor |
|---|---|---|---|
| Aceite y filtros (programado vs. motor dañado) | $2,500–$4,500 | $80,000–$250,000 | 32x–55x |
| Sistema de enfriamiento (mantenimiento vs. sobrecalentamiento) | $2,000–$5,000 | $30,000–$100,000 | 15x–20x |
| Banda de distribución (programado vs. rotura) | $5,000–$12,000 | $40,000–$120,000 | 8x–10x |
| Transmisión (cambio de aceite vs. reconstrucción) | $3,000–$6,000 | $25,000–$80,000 | 8x–13x |
| Embrague (ajuste vs. reemplazo de emergencia) | $1,500–$3,000 | $12,000–$25,000 | 8x |
| Llantas (rotación/alineación vs. reventón en carretera) | $1,200–$2,500 | $8,000–$18,000 | 7x |
| Balatas y frenos (desgaste vs. falla total) | $3,000–$8,000 | $15,000–$40,000 | 3x–5x |

*(PISTA — Smart Fleet, blog de proveedor de software de flotas, abr-2026. Cifras de mercado no
verificadas contra fuente oficial; se citan como orden de magnitud, no como referencia de precio.)*

A eso se suma el costo indirecto: la misma fuente calcula que un camión rabón con mantenimiento
reactivo puede costar entre **$440,000 y $920,000 MXN al año** en costo total (refacción + días
parados + grúa + renta de unidad sustituta + pérdida de cliente) contra **$111,000–$160,000 MXN**
con mantenimiento preventivo estricto — una diferencia de 3x a 5.7x. Un caso independiente citado por
Revista TyT (Numaris, mar-2026) estima que en una flota de 100 camiones el mantenimiento correctivo,
los paros imprevistos y las reparaciones de emergencia pueden superar **$2.6 millones de dólares al
año**, y que analítica predictiva sobre nueve sistemas del vehículo (motor, transmisión,
diferenciales, aire, frenos, chasis, eléctrico, neumáticos, carrocería) redujo ese costo 33% en el
primer año en un caso reportado por el proveedor — **cifra autodeclarada del vendedor, no auditada**.

### 3.2 Por qué esto es distinto del gasto de viaje

`07-no-fiscal.md` §"Qué cambia esto en Likida" ya advirtió: *"el dictamen anual, la verificación
semestral, la póliza y la licencia no son gastos de viaje... deben prorratearse o vivir en otra
cuenta"*. El mantenimiento correctivo de emergencia (una falla en carretera a media liquidación) sí
puede aparecer como gasto de viaje —talacha, grúa, remolque— pero el mantenimiento **programado**
(cambio de aceite cada 10,000 km, frenos cada 30,000 km) es gasto de unidad, no de viaje, y hoy no
entra al alcance de intake de Likida (diésel, casetas, viáticos).

**La oportunidad de producto** no es sustituir un sistema de mantenimiento (Smart Fleet, Tracksolid,
Numaris ya lo hacen con telemetría), sino usar el CFDI del taller —que llega por WhatsApp igual que
un ticket de diésel, si el contralor lo manda— para: (a) llevar el kilometraje acumulado por unidad
desde los odómetros ya capturados en cada viaje, (b) alertar cuándo se acerca el intervalo de
servicio, y (c) distinguir automáticamente el correctivo de emergencia (que sí es gasto de viaje) del
preventivo programado (que no lo es). Esto reutiliza el dato de odómetro que la regla de rendimiento
de combustible (§2.3) ya necesita — es la misma pieza de datos sirviendo dos dolores.

---

## 4. Siniestros y seguros

### 4.1 El costo de un siniestro no es solo el deducible

Datos de un transportista de hidrocarburos citado por Revista TyT (jun-2024, **no verificado en
fuente aseguradora**): una unidad completa (tracto + dos tanques) puede representar una inversión de
**7 millones de pesos**, con deducibles "sobre el 20%" — y en robo total, la reposición de la unidad
por la agencia tarda **de tres a seis meses**, tiempo en el que la flota opera con una unidad menos
sin que el pago del seguro lo cubra.

### 4.2 El proceso de reclamación es lento porque depende de documentación que nadie arma a tiempo

Sobre el marco contractual de seguros de transporte (verificado contra la póliza pública de AXA,
`CG_Transportes_TR-126-0_0521.pdf`, y su guía de usuario, documentos de la aseguradora, **no ley,
práctica contractual del sector**):

- El asegurado debe dar **aviso inmediato** del siniestro (verbal o escrito) y **confirmarlo por
  escrito dentro de 24 horas**.
- Dentro de los **60 días siguientes** al aviso debe presentar la reclamación pormenorizada con
  documentación completa (factura comercial, pedimento si aplica, contrato de transporte, certificado
  de averías, etc.).
- La aseguradora paga dentro de los **30 días siguientes** a la fecha en que **recibió toda la
  información y documentación** que le permite conocer el fundamento de la reclamación — el reloj de
  30 días no arranca con el siniestro, arranca con el expediente completo.
- Para robo total de la unidad, el tiempo real reportado por transportistas (Transporte.mx, 2024,
  citando también datos de CONDUSEF) se extiende **de 4 a 5 meses**, y CONDUSEF reporta que 47% de las
  66,000 acciones de atención anuales en seguros se relacionan con incumplimiento de contrato, plazo
  de pago o monto de la indemnización — **SIN VERIFICAR el dato exacto de CONDUSEF en fuente
  primaria**, citado vía blog especializado en litigio de seguros.

**El hueco es documental, no legal.** El reloj de pago corre desde que el expediente está completo, y
armar ese expediente (fecha, hora, lugar, fotos, acta ante el Ministerio Público, número de póliza,
constancia de propiedad) es exactamente el tipo de dato disperso que hoy se junta a mano, días después
del hecho, con información que se degrada.

### 4.3 Lo que Likida ya tiene y lo que le falta

Likida, por diseño, ya captura por cada evento de WhatsApp: hora, geolocalización (si el ticket la
trae o el operador la manda), unidad y operador asignados, y fotos con metadatos. Eso es **la mitad
del expediente de un siniestro sin que Likida construya nada nuevo** — el aviso de 24 horas y el
armado de la reclamación de 60 días son flujos que hoy no existen en el producto y que exigirían: (a)
un evento de "siniestro" distinto de un evento de "comprobante" en el modelo de datos, y (b) una
checklist de documentos por tipo de siniestro (robo, daño, accidente) que Likida podría pre-llenar
con lo que ya sabe del viaje. **No hay integración con aseguradoras que verificar aquí** — es
producto sobre datos propios, del mismo tipo que el "expediente de auditoría" que `11-huecos.md`
§1.1 ya propuso para el SAT.

---

## 5. Control y rotación de operadores

### 5.1 El déficit es estructural, no cíclico

Cifras oficiales y de organismos del sector (CANACAR, IRU — International Road Transport Union,
Global Driver Shortage Report 2025):

- México tiene una tasa de vacantes de operadores del **14%** (2025), la segunda más alta de 18
  mercados evaluados por la IRU, solo detrás de Uzbekistán (15%).
- CANACAR estima **90,000 camiones fuera de operación** por falta de operadores (jul-2026), cifra
  que podría llegar a **108,000 hacia 2028** sin fortalecer la formación de nuevo talento.
- El déficit absoluto reportado varía por fecha y fuente: 50,000–60,000 vacantes en años previos,
  hasta **99,000** según un reporte de feb-2026 (TyT, citando a CANACAR/IRU) — **cifras que no
  coinciden entre sí porque miden cosas distintas** (vacantes vs. camiones parados vs. déficit
  proyectado); no promediar.
- Solo 13% de los operadores tiene menos de 25 años (IRU); 30% tiene más de 55 años. La edad
  promedio y la escasa incorporación de jóvenes agravan el reemplazo generacional.

### 5.2 El costo de la rotación, no solo del déficit

**PISTA** (Transporte.mx citando a MCT — Mejora Continua para el Transporte, 2020, cifra no
actualizada ni verificada en fuente oficial reciente): la rotación de operadores en México se estima
entre **60% y 70%** anual (7 de cada 10 operadores abandonan su empleo), y el costo de reemplazar a
uno solo —21 días de unidad parada a razón de $8,000/día, más $12,000 de reclutamiento, $20,000 de
posibles adeudos no cobrados y $15,000 de gastos legales de liquidación— asciende a **$215,000 MXN
por baja**. Con 150 bajas al año, una flota perdería del orden de $32 millones de pesos. Esta cifra
es de 2020 y **no fue reconfirmada con datos de 2025-2026**; se cita como orden de magnitud.

### 5.3 Dónde toca esto al modelo de datos de Likida

`11-huecos.md` §1.5 ya identificó la pieza normativa exacta: el registro electrónico de jornada
laboral (LFT art. 132 fr. XXXIV, obligatorio desde **1-ene-2027**, multa de 250 a 5,000 UMA por
incumplimiento) es una obligación nueva que **ningún competidor del mapa de `08-competencia.md`
tiene**, y Likida ya recibe eventos con hora del operador por WhatsApp. Ese módulo (horario de
inicio y fin, con acuse del trabajador para que tenga "prueba plena") es la pieza de control de
operadores más cercana al producto actual — **no resuelve el déficit ni la rotación**, pero es la
única parte de este dolor que Likida puede construir con lo que ya tiene, y tiene fecha de
obligatoriedad conocida.

El resto —atracción, selección, capacitación, retención— es un problema de Recursos Humanos que vive
fuera del flujo de comprobantes; **no es una integración natural de Likida** salvo como reporte
derivado (p. ej. "operadores con más eventos de excepción en su liquidación", que podría correlacionar
con riesgo de rotación, pero esto es una hipótesis de producto sin evidencia, no un hallazgo).

---

## 6. Tiempos de espera en carga y descarga (demoras/detention)

### 6.1 El tamaño del problema

- En puertos mexicanos, el tiempo promedio de un tractocamión para retirar un contenedor varió entre
  **3 horas 57 minutos (Veracruz) y 11.6 horas (Manzanillo en un mes de crisis operativa)**, según el
  Índice de Tiempos Promedio del Autotransporte en Puertos (ITPAP, elaborado por T21 Business
  Intelligence con datos de empresas de geolocalización y de autotransporte — **no es dato oficial de
  la Administración Portuaria, es un índice privado del sector**). El costo estimado de esa espera:
  **$6,000–$8,000 pesos** antes de que la mercancía empiece siquiera su ruta.
- Fuera de puertos, en CEDIS: contratos típicos otorgan **2 horas libres** de carga/descarga, con
  penalización de **$75–$300 USD/hora** después de ese margen (PISTA, Docklyx, blog especializado en
  gestión de patio, citando al ATRI — American Transportation Research Institute, dato de EE.UU. no
  mexicano). Aplicado a México: una operación con 30 unidades/día y 2 horas de espera promedio genera
  entre **$30,000 y $96,000 pesos diarios** en costo oculto, según la misma fuente.
- El **ATRI** (fuente estadounidense, citado por ambas notas de Docklyx) reporta que en EE.UU. la
  detención afectó **39.3% de todas las paradas en 2023**, con **$3,600 millones de dólares** en
  gastos directos más **$11,500 millones** en productividad perdida por esperas mayores a 2 horas —
  **esta cifra es de Estados Unidos, no de México**; se usa solo para dimensionar el fenómeno, nunca
  como cifra mexicana.

### 6.2 No es solo dinero: es salario legal

Esto conecta directo con un hallazgo ya cerrado por `11-huecos.md` §1.3: LFT art. 257 obliga a un
**aumento proporcional de salario** cuando el viaje se prolonga por causa no imputable al operador, y
el art. 263 fr. I obliga a **pagar hospedaje y alimentación** en esas mismas circunstancias. Una
espera de 5 horas en un andén no es solo un costo de oportunidad de la unidad: es, por ley, tiempo a
disposición del patrón (LFT art. 58) que puede detonar ambas obligaciones. Ningún competidor del mapa
de `08-competencia.md` liga el tiempo de espera capturado por WhatsApp con esta consecuencia salarial.

### 6.3 Cómo se mide hoy y por qué Likida ya tiene la mitad del dato

La fuente sobre negociación de estadías (Docklyx, abr-2026, **PISTA**) describe el problema central:
*"nadie sabe con precisión cuánto tiempo estuvo la unidad en caseta, cuánto esperó en patio, cuándo se
asignó el andén"* — la disputa se resuelve por correo al cierre de mes, sin evidencia con sello de
tiempo, y **Gartner** (citado por la misma fuente, sin verificar) señala que sin un sistema de gestión
de patio las empresas no pueden disputar hasta el **60%** de los cargos por falta de evidencia
objetiva.

Likida, si captura el evento del ticket de diésel o de caseta con hora y geolocalización al entrar y
al salir de una zona de carga/descarga, **ya tiene dos de las cinco marcas de tiempo** que la
metodología de Docklyx recomienda (entrada por caseta, fin real de maniobra). Reconstruir el tramo
completo exige, como mínimo, un evento explícito de "llegada" y "salida" del punto de carga —algo que
hoy no está en el alcance declarado de intake (diésel, casetas, viáticos)— pero es una extensión
natural, no una integración nueva: mismo canal (WhatsApp), mismo tipo de dato (foto + hora +
ubicación).

---

## 7. Multas en carretera — referencia, no repetición

Cubierto en profundidad por `07-no-fiscal.md` §10 y su sección "Qué cambia esto en Likida": el reloj
de 30 días hábiles del art. 76 LCPAF, el validador aritmético del tabulador en UMA, y la advertencia
de que la multa de tránsito **no es deducible** (LISR 28 fr. VI) pero sí puede descontarse al
operador dentro de los topes de LFT art. 110 (documentado en `11-huecos.md` §1.4). Nada que agregar
aquí salvo un puente con el dolor de siniestros (§4): cuando la multa deriva de un accidente, ambos
expedientes —el de la multa y el del siniestro— comparten la misma fecha, hora y ubicación que Likida
ya captura.

---

## 8. Robo de mercancía y de unidades

### 8.1 La magnitud, con cifras oficiales de SESNSP

El Secretariado Ejecutivo del Sistema Nacional de Seguridad Pública (SESNSP) es la fuente oficial de
incidencia delictiva del gobierno federal; los datos siguientes se citan tal como los reportó la
prensa que los tomó del SESNSP (**no se consultó el portal de datos abiertos del SESNSP
directamente en esta ola** — ver SIN VERIFICAR):

- **10,367 carpetas de investigación** por robo al autotransporte de carga en 2025 (6,263 del fuero
  común, 4,104 del fuero federal atendido por la FGR) — una disminución de 16.8% respecto a 2024, el
  segundo año consecutivo a la baja, pero **"cada 51 minutos se registra un ataque contra un operador
  en las carreteras del país"** (TyT, feb-2026, citando SESNSP).
- Entre enero 2018 y diciembre 2025 se acumularon **108,564 delitos** de robo al autotransporte de
  carga; 77% concentrado en Estado de México, Puebla, Guanajuato, Michoacán, Jalisco y San Luis
  Potosí.
- El Estado de México concentra la mayor incidencia con cifras que varían fuerte entre reportes
  (23,927 robos en 2025 según una nota; 49% de los 5,204 casos nacionales de ene-oct 2025 según otra)
  — **la magnitud exacta no es consistente entre notas de prensa** que citan al mismo SESNSP en
  fechas de corte distintas; usar como orden de magnitud, no como cifra puntual.
- Corredores de mayor riesgo: México–Querétaro (22% de los casos), Córdoba–Puebla (19%), tramos de San
  Luis Potosí (16%) — dato de AMESIS (Asociación Mexicana de Empresas de Seguridad Privada e
  Industria Satelital), gremio del sector de seguridad, no autoridad.
- **Pérdidas económicas del sector estimadas en más de $7,000 millones de pesos** en 2025 (AMESIS,
  citado por Indicador Automotriz, feb-2026) — **estimación de un gremio con interés comercial en el
  problema (vende seguridad privada), no cifra de gobierno**.
- 71% de los robos reportados por afiliados de AMESIS usó equipo de sabotaje tipo **jammer**
  (bloqueador de señal GPS).

### 8.2 Por qué esto NO es una integración natural de Likida

El robo de mercancía y de unidades es un evento de **seguridad física en tiempo real**: se previene
con GPS activo, detección de jammer, cámaras a bordo, doble monitoreo satelital y respuesta armada —
categorías de producto completamente distintas a la validación de comprobantes fiscales que Likida ya
hace. El propio T21 (may-2026) señala que la tendencia es que las empresas de seguridad convenzan a
las flotas de ver el monitoreo como **inversión, no gasto**, exactamente el argumento opuesto al de
Likida (que vende defensa fiscal de un gasto ya hecho).

Donde sí toca el flujo actual: el **expediente posterior al robo** —acta ante el Ministerio Público,
notificación a la aseguradora dentro de 5 días, documentos de propiedad— es del mismo tipo que el
expediente de siniestro descrito en §4.3, y Likida podría alimentarlo con lo que ya tiene del viaje
(última ubicación conocida por el último ticket, hora del último evento). Es una extensión menor de
un módulo que de todas formas hay que construir para siniestros; **no justifica, por sí sola, invertir
en monitoreo de seguridad en tiempo real**, que es un negocio distinto con competidores establecidos
(las mismas AMESIS, Total Protect, y los proveedores de GPS/telemetría del mapa de `08-competencia.md`).

---

## 9. Facturación al cliente y cobranza

### 9.1 El plazo de pago es el problema, no la factura en sí

- **PISTA con corroboración parcial:** una nota especializada en factoraje (Ubícalo, 2022, sin
  verificar en fuente estadística) sitúa el plazo de pago de clientes de transporte en México entre
  **60 y 90 días**.
- Fenadismer (federación de transportistas — **fuente española, no mexicana**, citada solo para
  contexto metodológico) reporta 53 días promedio de plazo de pago en el transporte en junio 2026, con
  44% de embarcadores pagando después de los 60 días que marca su ley local. **No se encontró un
  observatorio equivalente para México**; el dato español no debe usarse como cifra mexicana, solo
  como evidencia de que el problema y su medición existen en el sector a nivel internacional.
- Contratos de logística corporativa: términos Net-30/45/60 comunes, con **23% de las facturas de
  transporte en disputa** antes de pagarse (dato de la Freight Payment and Audit Association, **fuente
  de EE.UU., no verificada para México**), lo que extiende el ciclo real a 90–120 días.

### 9.2 La respuesta del mercado es financiera, no operativa

El factoraje (venta de la cuenta por cobrar a un descuento) es el instrumento dominante para resolver
el desfase de flujo de efectivo, con comisiones reportadas entre **1% y 30%** según plazo y perfil de
riesgo del deudor (rango amplio citado por dos fuentes distintas — TyT/ABC del factoraje, 2022, y
oneparkfinancial.com — sin verificación cruzada de una tasa "típica" para México). El propio sector
reconoce el problema: *"¿Quién aguanta 10 meses sin recibir un pago?"* (Gregorio Sánchez, director de
Finanzas de Autotransportes Pilot, citado por TyT, 2022).

### 9.3 Por qué esto está lejos del producto actual — con una excepción

Facturar al cliente y cobrarle es el **lado de ingreso** de la operación de una flota: la Carta Porte
y el CFDI de ingreso que la flota le emite a su cliente, no el comprobante de gasto que el operador
manda por WhatsApp. Es otro flujo, con otro documento, y probablemente otro sistema (el TMS o el ERP
de facturación de la flota). **No es una extensión natural del intake actual de Likida.**

La excepción, ya señalada indirectamente por `00-RESUMEN-EJECUTIVO.md` punto 6 (el estímulo de
casetas exige "bitácora de viaje... que coincida con el estado de cuenta del TAG"): la
**documentación limpia que Likida produce del lado del gasto** (ruta, fechas, casetas conciliadas,
Carta Porte coherente) es exactamente la evidencia que un despacho de cobranza pide para defender una
factura en disputa (elogis.mx, ene-2026, **PISTA**: *"Carta Porte, Bill of ladings, evidencias de
entrega y contratos deben estar disponibles, correctos y localizables desde el primer día"*). Es un
subproducto útil del expediente de viaje, no una razón para construir un módulo de facturación al
cliente.

---

## 10. Cierre contable mensual

### 10.1 Ya identificado por `11-huecos.md`, aquí se cuantifica el dolor operativo

`11-huecos.md` §1.1–1.2 ya estableció el fundamento legal: la contabilidad electrónica exige asiento
dentro de **5 días** de la operación (RCFF art. 33 B fr. I), el estado de cuenta del monedero de
combustible **es contabilidad por reglamento** (RCFF art. 33 A fr. IV), y Likida está en posición de
generar el export de DIOT con el dato más limpio del mercado. Este documento agrega la evidencia de
mercado de cuánto cuesta hoy ese proceso sin ayuda:

- **Conciliación bancaria manual:** una empresa con 500 movimientos bancarios al mes puede tardar
  **8 a 16 horas** en conciliar a mano; con software especializado, 1 a 3 horas (PISTA, CONTPAQi,
  jun-2026 — fuente es un proveedor de software contable con interés comercial directo en la cifra).
- **Pólizas automáticas:** un despacho contable típico captura decenas de pólizas por cliente cada
  mes desde CFDIs recibidos, emitidos, complementos de pago y nómina — proceso descrito como
  repetitivo y propenso a error de clasificación cuando el concepto del CFDI es genérico (PISTA,
  SatFácil, may-2026, mismo tipo de fuente con interés comercial).
- El error recurrente que documentan estas fuentes de despacho contable —depósitos bancarios sin
  CFDI o sin complemento de pago (REP) asociado, que quedan "cobrados en banco pero incompletos en
  CFDI"— es exactamente el tipo de brecha que una flota sin sistema especializado enfrenta cada cierre
  de mes, multiplicada por el volumen de comprobantes de viaje (diésel, casetas, viáticos) que hoy se
  concilian a mano contra el estado de cuenta.

### 10.2 Por qué este es el dolor más cercano de todos

A diferencia de mantenimiento, siniestros o tiempos de espera —que exigen capturar un dato nuevo—, el
cierre contable **consume exactamente el dato que Likida ya produce**: comprobante validado, UUID,
forma de pago, monto, fecha, y el veredicto de deducibilidad por gasto. `11-huecos.md` ya lo dijo:
*"Likida va a tener, por construcción, el dato más limpio del mercado para armar la DIOT... es un
export de dos días de trabajo y le ahorra al contralor un cierre entero"*. Este documento no encuentra
nada que contradiga eso; solo confirma, con la evidencia de mercado de cuánto tiempo se pierde sin él,
que es la pieza de menor esfuerzo y mayor cercanía de todo este mapa.

---

## 11. Priorización: (valor para el contralor) × (cercanía a lo que Likida ya ve)

| Prioridad | Dolor | Valor | Cercanía | Por qué |
|---|---|---|---|---|
| **1** | Cierre contable / export de pólizas y DIOT | Alto (ahorra el cierre entero del mes) | Máxima (consume el dato ya producido, sin captura nueva) | Ya diseñado en `11-huecos.md`, solo falta construirlo |
| **2** | Rendimiento de combustible y detección de ordeña | Alto (30%–50% del costo operativo, 80–300 L por evento) | Alta (mismo ticket + un odómetro ya capturable) | Aritmética simple sobre datos que ya llegan por WhatsApp |
| **3** | Tiempos de espera en carga y descarga | Alto ($30k–$96k MXN/día de costo oculto reportado, PISTA) + consecuencia salarial LFT ya identificada | Alta (dos de cinco marcas de tiempo ya existen en el evento) | Requiere un evento nuevo de "llegada/salida" pero mismo canal |
| **4** | Vencimientos y mantenimiento preventivo por unidad | Alto (correctivo cuesta 3x–55x el preventivo) | Media (exige sumar unidad + CFDI de taller al intake) | Reutiliza el odómetro de la regla de combustible (#2) |
| **5** | Expediente de siniestro | Alto (deducible ~20% + 3-6 meses de reposición) | Media (Likida ya tiene la mitad del expediente: hora, ubicación, fotos) | Requiere un tipo de evento nuevo, no una integración externa |
| **6** | Registro electrónico de jornada (parte de control de operadores) | Medio-alto (multa de 250-5,000 UMA desde 1-ene-2027) | Media (mismos timestamps, obligación con fecha conocida) | Único pedazo accionable del dolor de rotación/déficit |
| **7** | Robo de mercancía y de unidades | Muy alto (>$7,000M MXN/año estimado del sector) | Baja (requiere GPS en tiempo real, otro tipo de producto) | Solo el expediente posterior es cercano; la prevención no |
| **8** | Rotación de operadores (más allá de la jornada) | Alto (~$215k MXN por baja, PISTA desactualizada) | Baja (es un problema de RH/reclutamiento) | Fuera del flujo de comprobantes |
| **9** | Facturación al cliente y cobranza | Alto (53-90 días de plazo, factoraje 1%-30%) | Baja (es el lado de ingreso, otro documento, probablemente otro sistema) | Solo la documentación de soporte a disputas es reutilizable |

**Lectura para el fundador:** los primeros cinco lugares de esta tabla son extensiones del mismo dato
que Likida ya recolecta para liquidar el viaje (comprobante + hora + ubicación + unidad + operador).
Construirlos en ese orden no distrae de la liquidación: la profundiza. Los últimos tres (robo de
mercancía, rotación de personal, cobranza al cliente) son dolores reales y más caros en términos
absolutos, pero exigen una fuente de datos que Likida no tiene hoy — son decisión de negocio futura
("¿nos volvemos un TMS completo?"), no la siguiente función a construir.

---

## 12. Respuesta directa a la pregunta del encargo

**¿Qué más debería hacer Likida, además de liquidar viajes?**

En orden de construcción recomendado, sin salir del dato que ya procesa:

1. **Exportar el cierre contable del contralor** (pólizas sugeridas, DIOT, conciliación banco↔CFDI) —
   ya diseñado en `11-huecos.md`, es la pieza de menor esfuerzo y mayor cercanía.
2. **Detectar desviación de rendimiento de combustible** (litros vs. km÷rendimiento esperado, por
   unidad y por operador) — convierte el ticket que ya recibe en una señal de ordeña o fraude, sin
   pedir ningún dato nuevo salvo el odómetro que ya puede solicitar.
3. **Reconstruir tiempos de espera en carga y descarga** desde los timestamps de WhatsApp — cuantifica
   un costo que hoy nadie mide con evidencia, y lo conecta con la obligación salarial de LFT art. 257
   y 263 fr. I que ya identificó la ola pasada.
4. **Llevar el calendario de mantenimiento preventivo por unidad**, reutilizando el mismo odómetro
   del punto 2, para distinguir el correctivo de emergencia (gasto de viaje) del preventivo programado
   (gasto de unidad) — ya insinuado en `07-no-fiscal.md`, aquí se agrega el caso de negocio (3x–55x).
5. **Armar el expediente de siniestro** con lo que Likida ya sabe del viaje (fecha, hora, ubicación,
   fotos) para acortar el ciclo de reclamación ante el asegurador, hoy medido en meses.
6. **Registrar la jornada laboral electrónica del operador** (LFT art. 132 fr. XXXIV) antes de que sea
   obligatoria el 1-ene-2027 — único pedazo accionable del dolor de rotación de personal.

**Lo que Likida NO debería construir todavía:** monitoreo de seguridad en tiempo real contra robo de
mercancía (requiere GPS vivo y detección de jammer, negocio de otra categoría con competidores
establecidos), reclutamiento y retención de operadores (RH, no comprobantes), y facturación/cobranza
al cliente (el lado de ingreso, con su propio documento y probablemente su propio sistema). Los tres
son dolores caros y reales, pero atacarlos hoy diluiría el producto en tres direcciones que no
comparten el mismo dato de origen que hace defendible la liquidación.

---

## Acciones concretas

| Acción | Por qué | Esfuerzo | Cuándo |
|---|---|---|---|
| Diseñar el export de pólizas sugeridas + DIOT desde el veredicto ya emitido por comprobante | Consume el dato que Likida ya produce; ahorra el cierre mensual completo al contralor | Bajo | Fase 2 (ya priorizado en `11-huecos.md`) |
| Pedir el odómetro junto al ticket de diésel de forma sistemática, no solo cuando hay monedero | Habilita rendimiento por unidad, detección de ordeña, y el calendario de mantenimiento preventivo con el mismo dato | Bajo | Antes de la demo del 6-ago: mostrar el cálculo aunque sea manual |
| Definir el evento "llegada" / "salida" de zona de carga-descarga en el modelo de datos, con hora y geolocalización | Reconstruye tiempos de espera y conecta con la obligación salarial de LFT 257/263 ya identificada | Medio | Fase 1-2 |
| Sumar el CFDI de taller (mantenimiento) como tercer tipo de intake, junto a diésel/casetas/viáticos, con campo "programado" vs. "emergencia" | Separa gasto de unidad de gasto de viaje; produce la alerta de vencimiento de servicio | Medio | Fase 2 |
| Diseñar (no construir aún) un tipo de evento "siniestro" distinto de "comprobante", con checklist de documentos por tipo | Reduce el ciclo de reclamación de meses a semanas usando datos que ya existen del viaje | Medio | Fase 3 |
| Construir el registro electrónico de jornada laboral con acuse del operador (LFT art. 132 fr. XXXIV) | Obligación con fecha fija (1-ene-2027) y multa nombrada (250-5,000 UMA); nadie del mapa competitivo lo tiene | Medio | Antes de ene-2027, idealmente Fase 2-3 |
| Verificar la canasta básica CANACAR 2026 vigente en fuente primaria antes de citar cualquier % de combustible en material comercial | El rango encontrado (30%-82% según metodología) es demasiado amplio para usarse sin nota al pie | Bajo | Antes de cualquier pitch que use esa cifra |
| No construir monitoreo de seguridad, reclutamiento de operadores ni facturación al cliente en el corto plazo | Son dolores reales pero de otra fuente de datos; construirlos ahora diluye el foco del producto | — | Decisión de alcance, revisar en 12 meses |

---

## CONFLICTOS

- **CONFLICTO (interno a esta ola, entre fuentes de mercado):** el % del combustible sobre el costo
  operativo total varía de 30% (CANACAR vía Expansión) a 50% (Total Protect vía T21) a 33.7%-35%
  (Smart Fleet, PISTA) a 67%-82% (IMT, pero esa cifra mide otra cosa: contribución al *incremento* de
  costos, no participación en el costo total). Ver §2.1. **No promediar ni usar un solo número sin la
  nota metodológica.**
- **CONFLICTO (entre fuentes de prensa citando al mismo SESNSP):** el número de robos al
  autotransporte en el Estado de México varía fuerte entre notas con fechas de corte distintas
  (23,927 en un reporte anual de 2025 vs. 2,576 en 10 meses de otro corte vs. proporciones del 49% en
  un tercero). Ver §8.1. Ninguna nota citó el número de folio o el reporte exacto del portal de datos
  abiertos del SESNSP, por lo que no se pudo reconciliar en esta ola.
- **CONFLICTO potencial con `08-competencia.md`:** ese archivo no cuantifica el % de combustible en el
  costo operativo total de una flota (se enfoca en el ángulo fiscal del gasto). No hay contradicción
  directa, pero cualquier cifra de "combustible = X% del costo" que se agregue al material de venta
  debe conciliarse con lo encontrado aquí antes de usarse, para no introducir una cifra nueva sin
  fundamento sólido al lado de las que ya están verificadas en la ola 1.

---

## SIN VERIFICAR

1. **Canasta básica CANACAR 2026 vigente**, leída en fuente primaria (canacar.com.mx o publicación
   oficial). Solo se accedió a la edición 2019 (INEGI/CANACAR) y a referencias secundarias de un
   blog de proveedor de software para la versión 2026.
2. **Dato de que ~30% de las flotas usan diésel de procedencia ilícita** y que 128,000 de 385,000
   barriles diarios consumidos vienen de tomas clandestinas — cifra de un artículo periodístico de
   2024 citando testimonios del sector, sin fuente oficial (PEMEX, CRE, Secretaría de Energía).
3. **Cifras exactas de robo a transportistas del portal de datos abiertos del SESNSP**, consultado
   solo vía notas de prensa que lo citan, no directamente en `datos.gob.mx` o el portal del SESNSP.
4. **Costos de mantenimiento por componente y costo anual de mantenimiento de un camión**, tomados de
   un solo proveedor de software de flotas (Smart Fleet), sin contraste contra IMT, CANACAR ni un
   taller mecánico independiente.
5. **Plazo promedio de pago a transportistas en México** (60-90 días citado por una fuente de 2022):
   no se encontró un observatorio mexicano equivalente al de Fenadismer en España; el dato de 53 días
   citado en este documento es **español, no mexicano**, y solo se usa como referencia metodológica.
6. **Tasas de factoraje (1%-30%)**: rango demasiado amplio de dos fuentes sin cifra "típica" para
   México confirmada con una institución financiera o la CNBV.
7. **Costo de rotación de operadores ($215,000 MXN por baja)**: cifra de 2020 (pre-pandemia en su
   origen), no reconfirmada con datos de 2025-2026; los salarios de operador reportados en otra fuente
   de 2026 ($25,000-$50,000/mes) sugieren que el costo de reemplazo probablemente subió, pero esto es
   inferencia, no medición.
8. **Tiempo exacto y artículo de ley que obliga a la aseguradora a pagar en 30 días** (Ley Sobre el
   Contrato de Seguro): se documentó vía blogs jurídicos y la póliza pública de AXA, no se leyó el
   artículo de la LSCS en el DOF ni en diputados.gob.mx directamente en esta ola.
9. **Ninguna de las cifras de este documento marcadas PISTA** (proveedores de software de flotas como
   Smart Fleet, Tracksolid, Numaris, Docklyx, SatFácil, CONTPAQi) fue verificada de forma independiente
   — se citan porque no existe, hasta donde se buscó, una fuente oficial mexicana equivalente
   (CANACAR, IMT o INEGI no publican con este nivel de detalle por componente). **No usar ninguna cifra
   de esta categoría en material comercial o en un pitch a inversionistas sin decirlo explícitamente.**
10. **Entrevistas con contralores de flota reales sobre estos nueve dolores**: igual que señaló
    `00-RESUMEN-EJECUTIVO.md` punto 18, ninguna de las dos olas de investigación habló con un
    contralor. Este documento describe el dolor documentado en fuentes públicas y de mercado, no
    validado en campo con el comprador real.

---

## Fuentes

**Oficiales / primarias (normativo y estadística de gobierno):**
- SESNSP (Secretariado Ejecutivo del Sistema Nacional de Seguridad Pública) — incidencia delictiva,
  citada vía prensa (ver notas abajo); portal: https://www.gob.mx/sesnsp
- IMT (Instituto Mexicano del Transporte) — Publicación Técnica 536, "Impacto del precio del diésel y
  otros insumos en los costos de operación del autotransporte de carga". https://imt.mx/archivos/Publicaciones/PublicacionTecnica/pt536.pdf
- IMT / SICT — Anuario Estadístico de Colisiones en Carreteras Federales 2023. https://micrs.sct.gob.mx/images/DireccionesGrales/DGAF/EST_Accidentes_CF/Anuario_2023.pdf
- SICT — NOM-012-SCT-2-2017, peso y dimensiones. DOF 26-dic-2017. https://www.dof.gob.mx/nota_detalle.php?codigo=5508944&fecha=26/12/2017
- CANACAR / INEGI — "Conociendo la Industria del Autotransporte de carga" (2019). https://canacar.com.mx/app/uploads/2019/03/Autotrans2019_con-la-norma-institucional-para-internet.pdf
- AXA México — Condiciones Generales, Seguro de Transporte de Carga (marco contractual del sector, no
  ley). https://axa.mx/documents/10928/32546262/CG_Transportes+Carga_TR-126-0_0521.pdf y guía de
  usuario asociada.

**Prensa especializada del sector (citando fuentes oficiales o gremiales):**
- Milenio — "Robo a transportistas en México disminuye 21% en un año: SESNSP" (25-jun-2026).
- TyT (Revista TyT) — "Más de 10 mil operadores... fueron atacados... durante 2025" (12-feb-2026);
  "Factor humano causa 9 de cada 10 accidentes..." (23-oct-2025); "Las cinco principales causas de
  accidentes..." (22-ago-2024); "La caravana vacía..." (07-feb-2026); "No basta con formar más
  operadores..." (01-jul-2026); "Déficit de operadores: México tiene una fuerza laboral más joven..."
  (30-jun-2026); "Mantenimiento 2026: el nombre del juego es adelantarse" (26-feb-2026); "Analítica
  predictiva permite ahorrar hasta 1 mdd..." (10-mar-2026); "El seguro no me quiere indemnizar..."
  (Transporte.mx, 15-may-2024); "Extorsiones y robos acechan al transporte de hidrocarburos"
  (24-jun-2024); "ABC del factoraje para los transportistas" (30-abr-2022).
- eltransporte.mx — "Robo al transporte se concentra en el centro y Bajío" (30-mar-2026); "Déficit de
  operadores deja 90.000 camiones detenidos en México" (02-jul-2026).
- Indicador Automotriz — "En 2025 el robo al transporte de carga en México disminuyó 22%: AMESIS"
  (10-feb-2026).
- Expansión — "Del diésel a tu mesa: por qué cada peso que sube el combustible encarece 4% el
  transporte" (14-abr-2026).
- T21 — "Robo de combustible y saturación vial elevan presión sobre flotas de carga" (25-may-2026);
  "La Jornada: Pierde sector autotransporte hasta cuatro horas en puertos" (03-nov-2024, vía
  jornada.com.mx); "Puertos de México incrementan el tiempo promedio para el retiro de mercancías:
  ITPAP" (30-jun-2025); "¡Al límite! Puerto saturado y obras carreteras presionan al autotransporte de
  carga en Manzanillo" (22-jul-2026).
- transporte.mx — "Empresas de transporte pierden más de 215 mil pesos por la rotación de operadores"
  (21-oct-2020); "Algunas empresas de transporte siguen comprando diésel robado..." (03-jul-2024).
- Cronista.com — "El costo de no tener choferes: 90,000 camiones parados en México..." (02-jul-2026).
- Over-Haul — "México: Reporte Q1-2026 de robo de transporte de carga". https://www.over-haul.com/es/intelligence/mexico-cargo-theft-report
- Ruta del Transporte (España, solo referencia metodológica) — "Los plazos de pago en el transporte
  siguen en mínimos en junio: 53 días de media" (14-jul-2026).

**PISTA (blogs de proveedores de software de flotas y despachos, nunca fundamento):**
- Smart Fleet (es.smartfleetapp.com) — "Canasta básica del autotransporte: costos CANACAR 2026";
  "Costos fijos y variables del autotransporte en México"; "Mantenimiento Preventivo Flotillas: Costo
  Real vs Correctivo"; "Mantenimiento de Camión de Carga: Costo Anual Real"; "Contabilidad de Empresa
  de Transporte: Guía Básica" (todas jul-2026 y abr-2026). *(Nota: Smart Fleet aparece también como
  competidor en `09-liquidacion.md`; sus cifras se usan aquí solo como orden de magnitud de mercado,
  nunca como precio de referencia comercial.)*
- Tracksolid México — "Mantenimiento Predictivo: Cómo evitar que tu flota se detenga" (23-mar-2026).
- Docklyx — "Cómo negociar estadías con transportistas" (07-abr-2026); "Costos ocultos de la fila en
  CEDIS: 6 Riesgos Críticos" (26-mar-2026).
- SatFácil — "Cierre Mensual Contable: Checklist para Despachos 2026"; "Conciliación Bancaria 2026:
  Paso a Paso para Contadores"; "Pólizas Automáticas desde CFDIs 2026" (may-jun 2026).
- CONTPAQi — "Software de conciliación bancaria México 2026" (24-jun-2026).
- Ubícalo — "Factoraje financiero para transportistas: ¿Cuál es su importancia?" (16-ago-2022).
- oneparkfinancial.com — "¿Qué hacer cuando tus clientes de logística tardan 60 días...?" (fuente
  orientada al mercado de EE.UU., usada solo para contexto de factoraje).
- Summar — "Factoring de Transporte para Camioneros" (26-abr-2025).
- elogis.mx — "Crédito y cobranza: lineamientos estratégicos para un 2026 más sólido" (08-ene-2026).
- abogadosdeseguros.com.mx — "¿Qué hago si mi aseguradora se niega a pagar un siniestro?" (05-mar-2026).
- eprints.uanl.mx — Abel González Rodríguez, "Determinación de una estructura de costos operativos
  para el autotransporte en México", tesis de maestría UANL (2019) — fuente académica, no oficial del
  sector, usada para el desglose de factores de costo por viaje.

**Documentos internos de la ola 1 y de esta ola referenciados:**
- `00-RESUMEN-EJECUTIVO.md`, `07-no-fiscal.md`, `08-competencia.md`, `09-liquidacion.md`,
  `11-huecos.md` (misma carpeta `likida-conocimiento`).
