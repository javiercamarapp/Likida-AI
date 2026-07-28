# Marco fiscal, legal y competitivo de Likida

> Síntesis de 11 investigaciones y 2 pasadas de verificación, cerradas el **27 de julio de 2026**.
> Fuentes primarias: DOF, diputados.gob.mx, sat.gob.mx, periódicos oficiales estatales.
> Detalle y citas completas en los archivos `01` a `11`. Índice en `00-INDICE.md`.

**La conclusión de una línea:** el producto que estabas describiendo (foto por WhatsApp → factura → deducción) es un commodity que ya se regala gratis y que además, en la mitad de los casos, es fiscalmente falso. El producto defendible es otro: **el motor que cuadra el viaje y dicta el veredicto de deducibilidad, con contadores fiscales que nadie más lleva.** Todo lo de abajo sale de ahí.

---

## Las 10 cosas que cambian el producto

Ordenadas por impacto sobre la arquitectura y sobre lo que se puede cobrar.

### 1. La foto no es el comprobante. El XML sí. Y a veces ni siquiera hay ticket que facturar.

El CFF art. 29, segundo párrafo, fr. V dice que la representación impresa **"únicamente presume la existencia"** del comprobante. Peor: si la flota usa monedero electrónico de combustible autorizado, la gasolinera **tiene prohibido** facturarle; el comprobante deducible es el CFDI del emisor del monedero con el Complemento de Estado de Cuenta de Combustibles, y la deducción está topada a lo que ampare ese complemento (RMF 2026 reglas 3.3.1.7 y 3.3.1.10 fr. III).

**Decisión:** dos estados separados en el modelo de datos — `comprobante_recibido` (la foto, sirve para control operativo: odómetro, hora, geolocalización, desviación) y `cfdi_validado` (el XML verificado contra el SAT). La integración #1 en prioridad no es mejorar el OCR: es **ingerir el estado de cuenta del emisor del monedero**, que es dato timbrado y granular. Y la primera pregunta de calificación de un prospecto es "¿ya traen monedero?", porque cambia el pitch entero.

### 2. La cuota de IEPS acreditable del diésel es semanal y varió 3.5x este año.

La SHCP publica cada viernes en el DOF las cuotas disminuidas. En 2026 el diésel fue de **$7.3634/L** (7–13 marzo, estímulo 0%) a **$2.0925/L** (25–31 julio, estímulo 71.58%). La cuota base 2026 del art. 2o-I-D)-1-c) LIEPS es $7.3634. La LIF 2026 art. 20, ap. A, fr. IV manda usar la cuota "con los ajustes que, en su caso, correspondan, vigente en el momento en que se haya realizado la adquisición".

**Decisión:** construir un servicio que ingiera el acuerdo semanal del DOF y mantenga una tabla `{fecha_inicio, fecha_fin, combustible, cuota_disminuida}`. Sin esto el cálculo del estímulo está mal por construcción. Para una flota de 200 mil litros/mes, la diferencia entre la cuota correcta y una constante es del orden de **un millón de pesos al mes**. Es la pieza de mayor valor técnico del paquete. *(Ver el riesgo abierto: no hay criterio del SAT que confirme por escrito que se acredita la disminuida y no la íntegra.)*

### 3. Un comprobante no tiene un veredicto: tiene cuatro.

El mismo ticket de diésel puede ser deducible para ISR y **no** generar estímulo de IEPS. Son umbrales distintos sobre el mismo papel:

| Veredicto | Regla que manda | Detector |
|---|---|---|
| Deducible ISR | LISR 27 fr. III + RFA 2026 regla 2.9 (válvula del 15% en efectivo) | `FormaPago` + contador acumulado |
| IVA acreditable | LIVA art. 5 fr. I (sigue a la deducibilidad) | derivado del anterior |
| Genera estímulo IEPS | LIF 2026 art. 20-A-IV, 4º párrafo: **solo** monedero, tarjeta a favor del contribuyente, cheque nominativo o transferencia | `FormaPago`, sin válvula |
| Exento de ISN estatal | Leyes de hacienda estatales ("debidamente comprobados en los términos de la LISR") | grupo fiscal + estado |

**Decisión:** el motor emite veredictos separados, con su fundamento citado, por comprobante. Ningún ERP de flota ni ninguna app de gastos entrega esto hoy. Es la cuña competitiva.

### 4. Cinco presupuestos fiscales vivos que hoy se administran a ciegas.

Ninguno de los competidores los lleva. Son contadores acumulativos, con alerta y bloqueo:

1. **15% de combustible pagado por medios no bancarizados** (RFA 2026 regla 2.9). Rebasarlo tira el excedente **completo**, no proporcionalmente, y con él su IVA.
2. **8% de ingresos propios / $1,000,000 / diferencia ingresos-deducciones** de deducción ciega (RFA 2026 regla 2.2), con el **16% de ISR definitivo** que se entera al día 17.
3. **20% de viáticos no comprobados "en cada ocasión" y $15,000 anuales por persona** (RLISR 152), *más* la verificación de que el 80% restante se erogó con tarjeta del patrón.
4. **Topes diarios por concepto**: $750 alimentación nacional, $1,500 extranjero, $850 renta de auto, $3,850 hospedaje extranjero. **No existe tope de hospedaje nacional** — si lo topas en $850 estás rechazando gastos legítimos.
5. **Faja de 50 km** alrededor de la base de asignación del operador (LISR 28 fr. V, RLISR 57): el viático erogado dentro de esa faja no es deducible.

### 5. La taxonomía de dos grupos hay que meterla el día uno o no se mete nunca.

Diésel, casetas, talacha, maniobras y pensión **no son viáticos**. Los viáticos, legalmente, son hospedaje, alimentación, transporte, uso de automóviles y kilometraje **de la persona**, y exigen relación laboral o servicios profesionales del beneficiario (LISR 28 fr. V). El hombre-camión permisionario no es ninguno de los dos: lo que se le da es precio de flete, y se le exige CFDI.

**Decisión:** `Grupo A` (gastos de la unidad) vs. `Grupo B` (viáticos de la persona), más tres campos que no se pueden agregar después sin migrar todo: **`régimen del operador`** (subordinado vs. tercero), **`base de asignación`** (para la faja de 50 km) y **`capacidad de tanque` + `rendimiento esperado`** (para las reglas de desviación de combustible).

### 6. El estímulo del 50% de casetas exige exactamente el output de una liquidación de viajes.

La RMF 2026 regla 9.1.8 pide: (I) aviso en **marzo** por buzón tributario con inventario vehicular detallado; (II) **bitácora de viaje con origen, destino y ruta que COINCIDA con el estado de cuenta del TAG**; (III) pago con TAG o sistema electrónico; (IV) factor 0.5 sobre el importe **sin IVA**. Caseta pagada en efectivo en ventanilla no genera estímulo aunque exista factura. Tope: ingresos anuales menores a 300 MDP.

**Decisión:** el exportador de bitácora conciliada y el generador del inventario vehicular de marzo son un entregable vendible por sí solo. Hoy se hacen a mano o no se hacen, y sin ellos el estímulo es indefendible en revisión. **Es el gancho comercial más fuerte de todo el paquete.**

### 7. El reembolso al operador tiene tres validaciones bloqueantes, y el sector las incumple casi siempre.

RMF 2026 regla 2.7.1.12: el CFDI debe salir a nombre del **RFC de la flota** (no del operador), el reembolso debe hacerse por **transferencia o cheque nominativo**, y por el **valor total incluyendo IVA**. El reembolso en efectivo rompe la regla. Los anticipos no comprobados caducan al cierre del ejercicio (31-mar del siguiente si se entregaron en diciembre) y se vuelven ingreso acumulable del operador.

Encima: depositar anticipos a cuentas personales del operador — práctica dominante del sector — integra salario base de cotización ante el IMSS (LSS art. 27), que puede revisar cinco años atrás. La única defensa que la ley reconoce es el registro contable que lo separa.

### 8. El clasificador de Carta Porte se implementa con geometría, no con odómetro.

La excepción de la RMF 2026 regla 2.7.7.2.8 sigue vigente en 2026 y habla de un **radio de 30 km** entre origen inicial y destino final incluyendo puntos intermedios, no de kilómetros lineales recorridos. Un reparto de 90 km de carretera federal puede quedar exento. Casi todos lo calculan mal.

Y en 2026 **no hay periodo de gracia**: se leyeron los 25 transitorios de la RMF 2026 y los de las RGCE 2026, y ninguno menciona Carta Porte. El argumento de venta correcto no es la multa de $450 a $670 por CFDI sin complemento: es la **pérdida de la deducción del flete y del acreditamiento del IVA** (CFF 29-A antepenúltimo párrafo) más la presunción de contrabando del CFF 103 fr. XXII con pena de 3 a 6 años (CFF 104 fr. IV), que aplica aunque la mercancía sea nacional y legítima.

### 9. Hay dos relojes corriendo que hoy nadie vigila. Son features vendibles.

- **Buzón tributario, 3 días:** cuando un emisor pide cancelar un CFDI, el receptor tiene 3 días para negarse y **el silencio se considera aceptación** (RMF 2026 regla 2.7.1.34). Una flota desatendida pierde deducciones por omisión y ni se entera.
- **Art. 49 Bis, 30 días naturales:** nuevo desde el 01-ene-2026. Si un proveedor recurrente sale publicado en el DOF por el procedimiento exprés de comprobantes falsos, el receptor tiene 30 días naturales para revertir el efecto fiscal o el SAT le restringe **su propio CSD** — o sea, la flota no puede facturarle a sus clientes. Es riesgo de continuidad de negocio, no solo fiscal.

**Decisión:** monitor de listas 69-B + publicaciones del 49 Bis cruzado contra los RFC recurrentes de cada flota, y vigilancia del buzón tributario. Probablemente el ROI más fácil de defender frente a un contralor.

### 10. La ley te obliga a poner un humano en el loop. Cámbialo antes de escribir el copy.

El art. 26 fr. II de la LFPDPPP vigente (DOF 20-mar-2025) crea un derecho **nuevo** de oposición al tratamiento automatizado que, sin intervención humana, evalúe "rendimiento profesional, situación económica, fiabilidad o comportamiento" con efecto significativo. Un sistema que rechaza solo el comprobante de un chofer está haciendo exactamente eso.

**Decisión:** el copy deja de ser "el sistema aprueba o rechaza" y pasa a ser **"el sistema prepara y marca; el contralor decide"**. Toda decisión adversa la confirma un humano, con trazabilidad de por qué se marcó cada comprobante y un mecanismo de oposición en el aviso de privacidad. Además, esto encaja perfecto con el diseño de producto correcto: la pantalla del contralor es de **excepciones**, no de aprobación gasto por gasto.

---

## Lo que NO podemos prometerle a un cliente

Cada línea es una promesa que hoy circula en el mercado (o en el pitch actual) y que es falsa, incumplible o legalmente peligrosa.

| Promesa prohibida | Por qué | Fundamento |
|---|---|---|
| "Manda la foto del ticket de diésel y ya está deducido" | Falso si hay monedero (la gasolinera no debe facturar) y falso si se pagó en efectivo fuera del 15% | RMF 3.3.1.7; LISR 27 fr. III |
| "Validamos tu factura contra el SAT en tiempo real" | El listado L_CNE lo descarga **solo el PAC**, autenticado con su e.firma y descifrado con su CSD. No hay endpoint público. Cualquier contador lo verifica | Anexo 29 RMF 2026, sección III.3 |
| "Te conseguimos la factura que te negaron" | La conciliación de factura es voluntaria para ambas partes y "no constituye instancia, ni genera derechos u obligaciones distintas" | RMF 2026 regla 2.7.1.44, último párrafo |
| "Tienes 30 (o 60) días para pedir tu factura" | **No existe ese plazo.** El plazo real es el ejercicio fiscal: la fecha de expedición debe corresponder al ejercicio y el CFDI obtenerse antes de la declaración anual. El plazo de 60 días de gastos por cuenta de terceros se derogó en agosto de 2019 | CFF 29; LISR 27 fr. XVIII; RMF 2.7.1.12 fr. II inciso e) |
| "Te generamos la liquidación fiscal del coordinado" | El **Complemento de Liquidación nunca se ha publicado**. El Transitorio Segundo de la RFA 2026 sigue remitiendo a la Resolución de Facilidades de **2015** | RFA 2026, Transitorio Segundo |
| "Deducimos $113.90 por día de viáticos de tripulación" | Esa facilidad **ya no existe** en 2026, aunque el portal del SAT la siga publicando con un ejemplo fechado en "marzo de 2013" | RFA 2026, Título 2 completo (cero coincidencias) |
| "Facturamos cualquier ticket" | Desde el 07-nov-2025 un CFDI que no ampare una operación real es **falso por ley**. Esa frase pasó de eslogan a exposición | CFF 29-A fr. IX y 29-A Bis |
| "Recuperamos el 100% de tus facturas" | Mendel publica 96%, Fotofacturas 92%. Prometer más es un número imposible de sostener | 08-competencia |
| "Ahorra $X por litro de diésel" | La cuota acreditable pasó de $7.3634 a $2.0925 en cinco meses. Cualquier cifra fija es falsable en semanas | Acuerdos semanales SHCP en el DOF |
| Presentar el estímulo bruto como ahorro | Es **ingreso acumulable** en el momento en que se acredita. El beneficio real es estímulo × (1 − tasa ISR). Un ROI sobre el bruto infla la propuesta ~30% | LIF 2026 art. 20, ap. A, párrafos finales |
| "Nuestra bitácora sustituye la bitácora legal de horas de servicio" | El RTCPJF art. 83 exige 10 campos **más las firmas** del conductor y del permisionario. Lo correcto es pre-llenar y que el permisionario firme | NOM-087-SCT-2-2017; RTCPJF art. 83 |
| "Validamos tu permiso ante la SICT" | No hay evidencia de API pública. El SAT tampoco valida `NumPermisoSCT` en el timbrado: un número inventado pasa el PAC | Estándar CCP 3.1, sección 8 (verificado por ausencia) |
| "Somos los únicos por WhatsApp" | Clara, Zumma, Fotofacturas, Mendel y Uvicuo ya están ahí. WhatsApp es la mesa, no la carta | 08, 09 |
| "Aprendemos de tus comprobantes" | Entrenar o afinar con datos de clientes sin disociación documentada requiere consentimiento **expreso** de cada operador (son datos patrimoniales) | LFPDPPP arts. 7 párr. 5, 9 fr. III y 11 |
| "Todo se procesa en México" | En `mx-central-1` los modelos Claude aparecen solo bajo inferencia Global. Se puede **almacenar** en México; no inferir con residencia garantizada | Tabla de disponibilidad de Bedrock, consultada 27-jul-2026 |
| Mencionar SOC 2, ISO 27001 o "cumplimiento SAT certificado" | No existen. Handle lo hace en su landing de anuncios y se contradice con su sitio principal. Para un producto que toca datos fiscales, es la mentira chica que cuesta el cliente grande | 10-handle-ai |
| Fila de logos de clientes | **Likida no tiene clientes.** Las empresas del censo son prospectos de vacantes. La única prueba visual honesta hoy es una captura del producto con datos de demo marcados | memoria del proyecto + 10 |

**Regla transversal:** el CFF arts. 89 y 90 sancionan a "quien asesore, aconseje, **preste servicios** o participe" en las prácticas indebidas de los criterios del Anexo 3. Esa es literalmente la posición de Likida. La propia ley da la mitigación (CFF 89 último párrafo y 90): **manifestar por escrito que el criterio puede ser contrario a la interpretación de las autoridades**. Esa leyenda tiene que ir en los términos de servicio y en las salidas del producto, y hay que redactarla antes de la primera demo.

---

## Correcciones de los verificadores

Tres afirmaciones no sobrevivieron el ataque, y hay tres contradicciones internas entre archivos que hay que resolver a mano. **No promedies ninguna: usa la versión de abajo.**

### C1. "El diésel en efectivo no es deducible sin importar el monto" — FALSO para nuestro segmento

Lo verificado: LISR 27 fr. III, segundo párrafo exige medio bancarizado para combustible aun por montos menores a $2,000. **Pero** la RFA 2026 regla 2.9 (DOF 17-feb-2026) dice textualmente que los dedicados exclusivamente al autotransporte terrestre de carga federal en Coordinados o PF actividad empresarial "considerarán cumplida la obligación" cuando paguen por medios distintos, hasta el **15% del total pagado por combustible**, si el CFDI trae el permiso vigente.

**Redacción segura:** *"El diésel pagado en efectivo no es deducible por regla general (LISR 27 fr. III, 2º párrafo, sin importar el monto). EXCEPCIÓN para autotransporte de carga federal en Coordinados o PF actividad empresarial: la RFA 2026 regla 2.9 lo tiene por deducible hasta el 15% del total pagado por combustible en el ejercicio, siempre que el CFDI consigne el permiso vigente y no suspendido. Ese 15% conserva la deducción para ISR pero NO habilita el acreditamiento del estímulo de IEPS."*

**Consecuencia de código:** si el motor marca todo efectivo como no deducible, le está quitando dinero real a la flota. El archivo `01-cfdi-cff.md` y el `05-hidrocarburos.md` afirman la versión dura; `03-isr-facilidades.md` y `09-liquidacion.md` traen la correcta. Gana la correcta.

### C2. La excepción de aceptación expresa en cancelaciones tiene una condición suspensiva — y ahí hay un conflicto abierto entre dos investigadores

El texto de la RMF 2026 reglas 2.7.1.34 y 2.7.1.35 es correcto: 3 días, silencio = aceptación, salvo CFDI con Complemento Concepto de Hidrocarburos y CFDI con Carta Porte que registren las claves 15101505 / 15101514 / 15101515. El alargamiento del plazo de cancelación al mes de la declaración anual también es correcto (CFF 29-A cuarto párrafo, reformado DOF 07-nov-2025).

**El verificador señala** que esas modificaciones están sujetas a que el SAT publique el Complemento Concepto en su Portal y transcurran 30 días naturales (Transitorio + regla 2.7.1.8, segundo párrafo), y que "al menos hasta bien entrado 2026 el complemento no estaba publicado".

**Pero** `05-hidrocarburos.md` documenta que el XSD `hidrocarburospetroliferos.xsd` está en el servidor del SAT con `Last-Modified` 19-mar-2026 y `catHidroYPetro.xsd` con 17-abr-2026, y que múltiples PAC reportan de forma consistente publicación el 25-mar-2026 → exigibilidad el 24-abr-2026. La aritmética cierra.

**Resolución:** la condición suspensiva probablemente **ya se cumplió**, pero la fecha exacta de publicación en el Portal del SAT **no está confirmada en fuente SAT** por ninguno de los dos. Es el mismo pendiente en ambos archivos. **Acción:** conseguir la fecha oficial (lo más rápido: pedírsela al PAC del primer cliente junto con la matriz de errores) antes de que el producto bloquee o permita una cancelación por esta causa.

### C3. "Solo una práctica indebida está publicada en el DOF" — encuadre falso

Lo correcto: el Anexo 3 de la RMF 2026 (DOF 09-ene-2026) contiene **~70 criterios** — 4 del CFF (1, 2, 3 y 4/CFF/PI), ~44 de ISR, 12 de IVA, 5 de IEPS, 2 de LISH, 1 de LIF y 6 de LFD. Todos son derecho publicado. Lo único cierto de la afirmación original es que, de la lista informativa de "prácticas indebidas en la emisión de facturas" que difunde el SAT, la única con criterio publicado en el DOF es la del portal de autofacturación (1/CFF/PI).

Y la cláusula "quien asesore, aconseje, preste servicios o participe" **no es privativa de dos criterios**: aparece en prácticamente todos, incluido el 1/LIF/PI del diésel. O sea: el riesgo para Likida es **más amplio**, no menor.

Dato adicional verificado: en 2026 se eliminó del 1/CFF/PI la fracción que castigaba condicionar el CFDI a la exhibición de la CSF/CIF, porque esa conducta pasó a ser infracción tipificada.

**SIN VERIFICAR:** los importes de $79,130 a $124,380 del art. 90 del CFF que circulan en el archivo 01. No los uses en material comercial hasta leerlos en el Anexo 5 de la RMF 2026.

### C4. Contradicción entre archivos: fundamento del estímulo de diésel

`05-hidrocarburos.md` cita "LIF 2026 art. 16-A-IV". **Es incorrecto.** `04-iva-ieps-estimulos.md` lo verificó leyendo el PDF de la Cámara de Diputados: en la LIF 2026 (Nueva Ley, DOF 07-nov-2025) los estímulos de diésel y peaje están en el **artículo 20, apartado A, fracciones IV y V**. Todo material que cite el artículo 16 está usando la numeración de 2025 o anterior. También es falso que se instrumente en la "regla 11.7.3": las reglas del transportista son **9.1.6, 9.1.7 y 9.1.8**.

### C5. Contradicción entre archivos: valor de la UMA 2026

`11-datos-personales.md` dejó la UMA 2026 como pendiente y calculó sanciones sobre ~$113 (valor 2025). `07-no-fiscal.md` la verificó: **UMA 2026 = $117.31 diarios** (INEGI, DOF 09-ene-2026, vigente desde el 1-feb-2026). Ese pendiente está cerrado; recalcula las cifras de sanciones de datos personales con $117.31.

### C6. Conflicto de encuadre: ¿quién es el competidor?

Tres investigadores nombraron tres "competidores reales" distintos. No es contradicción, son tres capas, y las tres son ciertas simultáneamente:

- **Mendel** (`08`): compró TeFacturo, y en mayo-2026 lanzó con **Visa** la "Tarjeta Mendel Flotilla" — se activa con el viaje en curso, límite de litros por carga, categorías de combustible/casetas/viáticos, recuperación de CFDI validada contra el SAT. Declara 500+ flotillas. Es el vecindario exacto de Likida, con Visa detrás.
- **Uvicuo** (`09`): CDMX, ~$4M USD, lanzamiento nov-2025, gastos de ruta para autotransporte por WhatsApp con tarjeta **Mastercard**, IA que extrae del ticket y pide foto del odómetro, integración de TAGs, alertas antifraude. Es el clon más cercano del pitch actual.
- **Handle AI** (`10`): 6 MDD de a16z, fundador ex-Nowports, declaró en prensa (El Español, 17-mar-2026) que **su siguiente vertical es logística**.

**Lectura conjunta:** Likida no puede competir en la capa de medio de pago (Mendel/Visa, Uvicuo/Mastercard: pelea de balance y plástico, ya perdida) ni en la capa de "agentes de IA" (Handle, con capital de a16z). El terreno libre es la **capa de deducibilidad y facilidades del sector**, y el comprador correspondiente es **el contralor que tiene que defender la deducción en una revisión**, no el dueño que quiere control del gasto. Eso también reordena el argumento de "no cambias de banco, ni de tarjeta, ni de sistema", que es la respuesta directa a Mendel: su ventaja es también su fricción de adopción.

---

## Qué construir, en orden

La justificación de cada bloque es la misma: primero lo que hace defendible una deducción, después lo que la produce, al final lo que la presenta.

### Fase 0 — Antes de escribir código (esta semana, antes de la demo del 6-ago)

1. **Barrer el material comercial existente** por citas muertas: "RMF 2.7.1.24" para factura global (hoy es la **2.7.1.21**; la 2.7.1.24 en 2026 trata devolución de IVA a turistas), "LIF artículo 16" (hoy es el **artículo 20**), "$113.90 de viáticos de tripulación", "10% de deducción ciega" (es 8% con tope de $1M), cifras de multa de blogs ($17,000–$97,000 por factura sin complemento es falso). Un error de cita frente al fiscalista de un contralor destruye la credibilidad de todo lo demás.
2. **Redactar la leyenda de los arts. 89 y 90 del CFF** para términos de servicio y salidas del producto.
3. **Redactar el aviso de privacidad en modalidad simplificada para el flujo de WhatsApp** (LFPDPPP art. 16 fr. II) con prueba de entrega — la carga de la prueba recae siempre en el responsable (Reglamento art. 31).
4. **Negociar ZDR por escrito con el proveedor de IA** antes del primer cliente pagado, y prohibirse por lint los endpoints no elegibles (la API de archivos es la trampa obvia para subir fotos de tickets).

### Fase 1 — El núcleo (lo que hace al producto defendible)

5. **Modelo de datos con los campos que no se pueden agregar después:** `viaje` como unidad, `grupo fiscal` A/B, `régimen del operador`, `base de asignación`, `capacidad de tanque` y `rendimiento esperado`, `medio de pago` por gasto, `estado de validación`.
6. **Motor de reglas con veredictos separados** (deducible ISR / IVA acreditable / estímulo IEPS / exención ISN), cada uno con su fundamento citado en la salida. Empieza por las validaciones que no necesitan ninguna integración y ya salvan dinero: forma de pago en combustible, RFC receptor = RFC de la flota, permiso CNE presente, faja de 50 km, Grupo A vs. Grupo B.
7. **Los cinco contadores acumulativos** con semáforo y bloqueo (§4 arriba). Es la propuesta de valor que ningún competidor tiene.
8. **Máquina de estados de la liquidación** hasta `EN EXCEPCIÓN`: el contralor solo ve lo que falló una regla. Si le pones 40 gastos para aprobar uno por uno, no le ahorraste nada y el producto no se sostiene.
9. **Validador de CFDI contra el servicio público del SAT** (UUID + RFC emisor + RFC receptor + total), que además devuelve `ValidacionEFOS`. **No requiere ninguna credencial del cliente.** Arrancar **sin bóveda de e.firma** es una decisión de producto, no una limitación: elimina el tipo penal del art. 62 de la LFPDPPP y el pasivo del CFF 17-J.

### Fase 2 — Las integraciones que valen más que cien features

10. **Estados de cuenta de monederos de combustible** (Edenred, Efectivale, Sí Vale, Toka, Broxel). Dato timbrado, granular, mejor que cualquier OCR.
11. **CFDI mensuales de proveedores de TAG** (IAVE, PASE, TeleVía) + **exportador de bitácora conciliada** y **generador del inventario vehicular de marzo** (RMF 9.1.8). Esto último se vende solo.
12. **Servicio de cuotas semanales de IEPS** ingiriendo el acuerdo del DOF.
13. **Comprar la capa ticket→CFDI, no construirla.** FacturaGPT cobra $4 MXN + IVA por CFDI exitoso, con `external_id` y webhook, y trae +1,000 comercios. Construye tú solo los 10–15 conectores de carretera que importan.
14. **Cargador de catálogos que apunte al XSD y monitoree su `Last-Modified`**, no a la fecha del XLS de la página del SAT — el `catCartaPorte.xsd` cambió el 13-ene-2026 mientras la página seguía diciendo 13-dic-2024.

### Fase 3 — Los relojes y el monitoreo (el ROI más fácil de defender)

15. **Vigilancia del buzón tributario** y alerta de solicitudes de cancelación (3 días, silencio = aceptación).
16. **Monitor 69-B + publicaciones del 49 Bis** cruzado contra los RFC recurrentes de la flota (reloj de 30 días naturales).
17. **Ingesta mensual del padrón de permisos de la CNE** vía la API CKAN de datos.gob.mx (leyendo `package_show` cada vez, porque el sufijo del mes cambia), con la fecha de corte visible en toda respuesta.

### Fase 4 — Comercial

18. **Cinco entrevistas grabadas con contralores de flota.** Es la validación más urgente que falta: ninguna de las once investigaciones habló con uno. Sin sus números (comprobantes por viaje, días de retraso, días de conciliación, % con problema fiscal) la sección "Realidad Actual" de la landing no funciona; con ellos es la parte más persuasiva de la página.
19. **Landing según el plano de `10-handle-ai.md`**: sello de inversionista arriba del titular, sección de realidad actual con números de insider, comparativo a dos columnas, un solo CTA repetido, sistema visual sin color de marca (el único color entra por la captura del producto). Los números clave en el HTML servido, no solo en JavaScript.
20. **Precio por resultado (viaje liquidado), no por asiento** — pero con la definición de "liquidado" escrita en el contrato desde el día uno. Sin esa definición se convierte en disputa de facturación. **No publicar precios todavía**: ningún competidor serio lo hace.

---

## Riesgos abiertos

### Legales, propios de Likida

- **Los criterios del Anexo 3 alcanzan a "quien preste servicios".** Es la posición exacta de Likida. Mitigación en la propia ley (CFF 89 último párrafo y 90): leyenda escrita. Sin ella, multa del art. 90 con agravante del 10% al 20% de la contribución omitida.
- **Criterio 6/ISR/PI:** deducir viáticos a personas sin relación laboral ni servicios profesionales es práctica indebida, y la fracción II alcanza al proveedor de software. Likida **no puede** posicionarse como la herramienta que sistematiza viáticos al hombre-camión.
- **Automatizar portales.** Semáforo de `11-datos-personales.md`: **verde** (servicios públicos del SAT) sin reservas; **ámbar** (PASE, TeleVía, OXXO GAS: leídos, no prohíben) con mandato escrito, User-Agent identificado, rate limit conservador y **cero bypass de CAPTCHA**; **rojo** (PACs y plataformas de facturación: EdiFactMx prohíbe "spiders, robots, avatars o agentes inteligentes"; ioFacturo prohíbe "burlar mecanismos de autenticación") no automatizar. Ojo: la cláusula de cuenta intransferible es más peligrosa que la de scraping, porque el incumplimiento lo comete **el cliente** y le pueden cancelar el TAG a media semana. Marco penal de fondo: CPF arts. 211 bis 1 y 211 bis 7.
- **Datos sensibles por la puerta trasera:** un ticket de farmacia revela salud. El art. 8 párr. 2 de la LFPDPPP prohíbe crear bases con sensibles sin justificación, y el art. 64 permite duplicar las penas de prisión. Hace falta un filtro de detección y exclusión.
- **Notificación de brechas:** el titular a notificar es **cada operador**, no el contralor. 50 flotas × 40 choferes = 2,000 notificaciones individuales. Si el contrato no define quién notifica, con qué texto y quién paga, el incidente se vuelve crisis contractual además de regulatoria.

### Fiscales, que le pueden costar dinero al cliente

- **Rebasar el 15% de combustible en efectivo tira el excedente completo**, no proporcionalmente, y con él su IVA acreditable. Un contador mal calibrado puede costarle a una flota la deducción íntegra del diésel del ejercicio.
- **El 16% de la regla 2.2 es definitivo.** Si la flota pierde la exclusividad del 90%, el 8% deducido se vuelve no deducible **y** el 16% ya pagado no se recupera: se paga dos veces. Cuatro banderas bloqueantes en el alta (90% de ingresos, jurisdicción federal, servicio a terceros, régimen elegible — RESICO PF, RESICO PM y régimen general de PM quedan **fuera**).
- **El umbral de 300 MDP del estímulo de casetas opera retroactivamente al inicio del ejercicio.** Una flota en crecimiento que lo cruce en noviembre debe presentar complementarias de todo el año con actualización y recargos. Si Likida no alerta, facilitó el pasivo.
- **Recomendar "este viaje no necesita Carta Porte"** y que el operador se desvíe: la excepción exige plena certeza de no pisar tramo federal y la obligación revive completa. La recomendación debe quedar registrada como recomendación, con la decisión del cliente encima.
- **Automatizar el timbrado a partir de lo que el operador reporta por WhatsApp** es automatizar comprobantes cuya veracidad Likida no controla, en un régimen donde el CFDI que no ampara operación real es falso por ley. Hay que dejar rastro de quién afirmó qué y cuándo, y no posicionar el producto como garantía.
- **El SAT prohíbe facturar en lote:** un CFDI con CCP por cada servicio y por cada cliente. Cualquier feature de "cierra tu semana con un timbrado" es incumplimiento.
- **En transporte dedicado los roles se invierten** (RMF 2.7.7.1.3): el transportista emite CFDI de ingreso **sin** complemento y es el cliente quien emite el de traslado **con** complemento. Vender el flujo estándar a una flota dedicada le construye el documento equivocado.

### De dependencia

- **El PAC es el único que puede validar la L_CNE.** Likida depende de que el CFDI ya haya pasado ese candado, y solo puede cubrir cuatro huecos: CFDI anteriores al 24-abr-2026, permisos suspendidos, cancelaciones posteriores al timbrado, y fotos de facturas apócrifas que nunca pasaron por un PAC.
- **El padrón público de la CNE no trae RFC** y tiene ~6 semanas de rezago. Cualquier "este permiso pertenece al RFC que me facturó" descansa en fuzzy match de razón social. La promesa honesta es "al corte de {fecha} de la CNE aparece como vigente".
- **Emisores de monedero:** su autorización se renueva anualmente (ficha 7/ISR, agosto–octubre) y el SAT publica un padrón de no renovados. Si el emisor cae, el cliente se queda sin comprobante deducible de combustible.
- **Proveedor de IA:** el inciso II.e del art. 52 del Reglamento (informar al responsable cuando una autoridad pida los datos) se cumple solo parcialmente — hay órdenes con mordaza en EE.UU. Ese residual hay que **declararlo** en la evaluación de riesgo. Un hueco declarado se defiende; escondido es negligencia.
- **Competencia con ventana corta:** Handle declaró logística como siguiente vertical en marzo de 2026. La ventana para ocupar públicamente el término "liquidación de viajes" se mide en meses.

---

## Pendientes de verificar

Ordenados por lo que cuesta si están mal. Los primeros cinco valen 3–4 llamadas o búsquedas cada uno.

### Bloqueantes antes de codificar o de vender

1. **Criterio del SAT que confirme que se acredita la cuota DISMINUIDA semanal y no la íntegra de $7.3634.** La conclusión se sostiene en el texto de la LIF ("con los ajustes que, en su caso, correspondan") y en que el acuerdo semanal se titula "cuotas disminuidas", pero **no se localizó criterio normativo ni regla que lo diga con esas palabras**. Si el criterio fuera el contrario, Likida estaría subestimando el estímulo hasta 3.5x. Que lo confirme un fiscalista con cédula antes de ponerlo en una propuesta.
2. **Fecha exacta de publicación del Complemento Concepto de Hidrocarburos en el Portal del SAT** (se reporta 25-mar-2026 → exigible 24-abr-2026). El portal es una SPA que devuelve 403 a peticiones automatizadas. De esta fecha depende la lógica de cancelaciones (ver C2). Pídesela al PAC del primer cliente.
3. **Matriz de errores del complemento HidroYPetro (códigos CCHYP1xx) y matriz de errores de Carta Porte 3.1.** Son los documentos que le dicen a ingeniería qué rechaza el PAC y con qué código. No se localizaron en el sitio del SAT (403/404) y los XLS no se pudieron parsear (la máquina no tiene `xlrd` ni `pandas`). **Instalar el parser y conseguir los archivos.**
4. **Catálogos oficiales del Anexo 20 y del CCP 3.1 en XLS, diffeados contra la versión anterior.** Hay reportes de actualizaciones el 01-ene-2026, 13-ene-2026 y 02-mar-2026 (847 nuevas claves de `c_ClaveProdServ`, ~3,912 relaciones de pedimentos, IEPS a seis decimales) que **solo constan en fuentes secundarias**. Validar contra un catálogo viejo genera falsos rechazos en producción.
5. **Formato exacto de la cadena `expresionImpresa`** que consume el web service de consulta del SAT (parámetros `id`, `re`, `rr`, `tt`, `fe`). Está en el rubro I.D del Anexo 20, que no se leyó. Bloquea la implementación del validador.
6. **Si un CFDI con complemento ECC (monedero) debe llevar TAMBIÉN `HidroYPetro`.** La interpretación de que no la sostienen varios PAC citando FAQ del SAT que no se leyeron en fuente. Si está equivocada, cambia el requisito de todas las flotas con tarjeta.

### Preguntas caras que requieren fiscalista

7. **Si el tope de $1,000,000 de la regla 2.2 es por INTEGRANTE o por COORDINADO.** Ningún texto lo dice expresamente. Programarlo mal cambia el ahorro mostrado al cliente en un orden de magnitud.
8. **Si el 8% de gasto ciego reduce o no la base de PTU.** No hay criterio ni regla. Decenas de miles de pesos de PTU por flota.
9. **Periodicidad del 15% de la regla 2.9** (mensual, acumulado o anual). La regla no lo dice. Lo consistente con el Transitorio Primero es acumulado del ejercicio, pero un auditor podría exigirlo mensual.
10. **Cómo se mide en el tiempo el 90% de exclusividad** del art. 72 de la LISR. La ley no lo precisa.
11. **Qué entra en "ingresos propios de su actividad"** para el cálculo del 8%. Ni la RFA ni la LISR lo definen para esa regla.
12. **Si el nuevo plazo de cancelación (hasta el mes de la declaración anual) aplica a CFDI expedidos en 2025.** El Transitorio Segundo habla de "procedimientos iniciados", no de comprobantes.
13. **Metodología oficial para medir el radio de 30 km** de la regla 2.7.7.2.8: no define si es geodésica, desde qué punto, ni cómo se prueba en una revisión. Es zona gris real que se va a topar al implementar.
14. **Si el 8% de la RFA satisface el requisito estatal de "viáticos debidamente comprobados".** No hay criterio publicado en ningún sentido. Presentarlo como hipótesis de riesgo razonada, nunca como fundamento.
15. **La faja de 50 km aplicada a un operador de largo recorrido:** el RLISR 57 define "establecimiento" como donde la persona presta normalmente sus servicios, y para un operador eso es discutible. Sin criterio del SAT ni tesis.

### Barridos normativos que faltan

16. **Primera y Segunda Modificación a la RMF 2026** (versiones anticipadas hasta junio y julio de 2026). Alguna de las reglas 9.1.6–9.1.8, 2.7.1.12 o 2.7.7.2.x pudo haber cambiado entre enero y julio. **Barrer antes de la demo del 6-ago.**
17. **Si el paquete económico 2026 tocó la LISR y la LIVA.** Los PDF de Diputados declaran LISR con última reforma 01-04-2024 y LIVA con 12-11-2021. Una fuente secundaria anuncia reformas próximas.
18. **Calendario 2026 de verificación físico-mecánica por dígito de placa.** Se localizó el aviso 2026 de emisiones (DOF 03-abr-2026) pero no el de físico-mecánicas. En 2025 se prorrogó tres veces; asumir continuidad sería inventar.
19. **Criterios o lineamientos de la Secretaría Anticorrupción y Buen Gobierno para el sector privado.** Su sitio falló con error de certificado SSL. **Es la laguna más importante de datos personales**: conviene cerrarla antes de redactar el aviso definitivo.
20. **Vigencia formal del Reglamento de la LFPDPPP de 2011 bajo la ley de 2025.** La conclusión de que subsiste "en lo que no contradiga" es razonamiento propio, no certeza. Complica su aplicación que remita a artículos con numeración vieja.
21. **19 de las 32 tasas de ISN** siguen sin verificar en fuente primaria (solo 13 confirmadas leyendo ley o decreto). Hay conflictos abiertos en Durango (2% vs 3%), Morelos (2.5% vs 3%), Tabasco (2.5%–4%) y Sonora (portal dice 3%+1%, la ley descargable dice 2%). **No publicar la tabla de 32 estados como verificada.** Varias listas que circulan traen Jalisco, Coahuila y Nuevo León mal.
22. **Si los "19,000 UMA" del seguro de carga especializada** son UMA diaria, mensual o anual. Se usó la diaria (~$2.23 MDP); la mensual multiplicaría por ~30. Confirmar con un Centro SICT antes de usar la cifra.

### Del mercado y de la operación

23. **Nadie entrevistó a un contralor ni a un administrador de flota.** Toda la reconstrucción del proceso operativo sale de material de proveedores y de obligaciones legales, no de campo. Es la validación más urgente del paquete.
24. **Qué porcentaje de las flotas objetivo ya usa monedero electrónico de combustible.** De esa respuesta depende si el pitch es "conectamos tu monedero" o "te salvamos el 15% de la regla 2.9". Es la pregunta que más cambia el producto.
25. **Comportamiento real de la conciliación de factura (ficha 46/CFF).** Declara 6 días de resolución; no se verificó cuánto tarda ni con qué tasa de éxito. Levantar 5 o 10 solicitudes reales y medir antes de venderlo como feature.
26. **Todas las cifras autodeclaradas de competidores** (96% de recupero y 500+ flotillas de Mendel, 92% de Fotofacturas, 99% de precisión y 6-8x ROI de Handle, "$7 millones ahorrados" de Zumma). Están **publicadas**; no están **auditadas**. Se citaron como evidencia de cómo comunican, no como hechos.
27. **Tamaño de mercado citado por Visa/Mendel:** una fuente dice "1.4 billones de dólares" y otra "US$1.4 mil millones" para el mismo dato. Son órdenes de magnitud distintos. **No usar ninguno hasta confirmar.**
28. **Datos del sector** (82% de la carga terrestre, 95% de las empresas con menos de 30 camiones, 200,000+ empresas). Vienen de prensa especializada, no de INEGI, SICT ni CANACAR. Confirmar en fuente oficial antes de ponerlos en una propuesta.
29. **Si Handle ya empezó a construir para logística** más allá de la declaración del fundador. No se encontró producto, landing ni cliente.
30. **Disponibilidad In-Region de modelos Claude en `mx-central-1`.** La tabla consultada muestra solo "Global". Reconfirmar en la consola de AWS antes de comprometer arquitectura de residencia.

---

### Nota de método

El presupuesto de WebSearch (200 llamadas) se agotó a mitad de dos de las once investigaciones (`10-handle-ai` y `11-datos-personales`); la segunda mitad de esas se hizo con exa y WebFetch. Firecrawl estuvo sin créditos toda la sesión. Varias verificaciones pendientes de la lista de arriba se cerrarían con muy pocas búsquedas más.
