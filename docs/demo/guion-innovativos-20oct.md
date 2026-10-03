# Guion del demo — cliente de ~250 tractos

**Para:** dirección y operación del cliente de demo. **Duración:** ~50 min + preguntas.
**Qué se demuestra:** los 5 primeros agentes —**orquestador**, **conductor/Vigía** (ciclo del conductor y servicio al
cliente), **peajes**, **liquidación fase 1** y **Carta Porte**— sobre datos con la forma de los de un transportista de
~250 tractos. **Datos y kit de carga:** [`innovativos.md`](./innovativos.md). Todo lo que se ve es **sintético** (tenant
«Innovativos (demo)») salvo lo que ya se haya recibido y cargado; el guion dice dónde hay que decirlo.

> **Regla del demo: nunca decir «en vivo» ni «real» de lo que no lo es, y no prometer lo que el código no hace hoy.**
> Cada cosa que se enseña lleva una de tres etiquetas. Si no tiene etiqueta **corre hoy**, no se enseña.

| Etiqueta | Significa |
|---|---|
| **[corre hoy]** | El código está integrado y se verificó contra la base sembrada: los importadores y motores reales (validación de ubicación, cruce de peajes, reclamación, importador de convenios, lector del histórico del Vigía, derivador del formato de liquidación) dan lo que el guion dice (`verificar-hechos-del-guion.mjs`). Las **pantallas** todavía no se han visto renderizadas con esta base: se confirman en el ensayo (innovativos.md §6). |
| **[depende de Meta / GPS real / cliente]** | Lo bloquea un tercero (plantillas aprobadas por Meta, acceso a su GPS, archivos reales del cliente). Hoy es simulado o es un registro de lo que se enviaría. |
| **[todavía no existe]** | No está construido. No se enseña ni se promete. |

---

## 0. Antes de entrar (preparación)

| Cuándo | Qué | Cómo se sabe que está listo |
|---|---|---|
| Con días de anticipación | Base local con las migraciones hasta la 0652 aplicadas (innovativos.md §1) y ensayo completo con este guion en la pila local (innovativos.md §6) | Cada pantalla de las secciones 1–6 abre y trae datos |
| La víspera | `bash scripts/demo/innovativos/sembrar.sh --reiniciar --encender-agentes` (ancla `2026-10-20 09:00`) | La salida termina con la tabla de conteos (140 viajes en curso, 381 pases, 158 liquidaciones…), los **157 veredictos** del motor y las líneas de lo que leyeron los importadores reales |
| La víspera | `probar-idempotencia.sh`, `verificar-cruces-con-motor.mjs` y `verificar-hechos-del-guion.mjs` | «IDEMPOTENCIA OK», «las 381 líneas coinciden con el motor real» y «los hechos del guion coinciden con la base» |
| La víspera | Si ya llegaron archivos reales: `validar-archivo.mjs` de cada uno → `vaciar-sintetico.sh <conjunto>` → cargar | La pantalla del conjunto muestra lo real; **el guion de ese conjunto cambia a «con sus datos»** |
| 1 h antes | Reloj del equipo y ancla: el demo asume que «ahora» es 09:00 de la ancla; si el ensayo es otro día, `sembrar.sh --reiniciar --ancla '<hoy 09:00 -06>'` (`--ancla` **exige** `--reiniciar`) | El mapa muestra viajes en curso y el tablero del Conductor tiene excepciones |
| 1 h antes | **Plan B** a la mano: capturas de cada pantalla del ensayo y los archivos de `archivos-muestra/` | — |

**Los agentes vienen apagados y no se manda nada por WhatsApp.** El seed deja el Vigía (`habilitado = false`), el
Conductor (`activo = false`, sin detección por GPS encendida en vivo ni «sin señal de vida») y los avisos del
orquestador apagados; `--encender-agentes` enciende solo el Vigía y el Conductor para que se vean sus pantallas (sin eso
el panel del Vigía dice «El Vigía está apagado para tu flota»). Aun encendidos, todos los teléfonos del demo llevan la
marca `28999…` (incluidos el de la copia al jefe y los de discrepancia) y el envío real los rechaza antes de llamar a
Meta. Lo que parezca un envío es el registro de lo que se enviaría.

---

## 1. Apertura — el orquestador: una sola vista de la operación (5 min)

**Pantallas:** `/dashboard/mapa` (Mapa de la operación), `/dashboard/viajes-en-vivo` (se refresca solo) y
`/dashboard/chat`.

**Se enseña**
1. **[corre hoy]** El mapa y el tablero de viajes en vivo: unidades con posición, **«Sin ubicar»** y **«Escalados»**; el
   tablero se vuelve a pedir solo cada pocos segundos, sin recargar la página. Las posiciones salen de `posicion`.
2. **[corre hoy]** La notificación de lo que escala: las tareas que el asistente le abre a una persona (aquí, las 8
   diferencias de liquidación de la sección 5: 3 ya atendidas y 5 abiertas) y las excepciones del Conductor entran a
   `/dashboard/notificaciones`. Los avisos del asistente **a una persona por correo** nacen apagados por flota.
3. **[corre hoy]** La caja de preguntas del chat consulta, de **solo lectura y por rol**, el tablero de viajes en vivo
   y el detalle de un viaje (con sus hitos y sus excepciones), el estado del Vigía, del buzón, de la cobranza y de la
   autofactura, la salud de los agentes, el convenio de un viaje, la entrega de la liquidación externa, la reclamación de
   peajes y la jornada, además de KPIs, liquidaciones, Carta Porte y normas; las gráficas (dona y serie) se pintan en la
   respuesta. Lo único que **escribe** es abrir una tarea para una persona. **Llama a un modelo (costo mínimo por
   pregunta): probar todas las preguntas del guion en el ensayo y quitar las que no respondan bien.** Si un agente falla,
   el barrido de salud abre una tarea para una persona (no solo «a demanda»).

**Qué decir**
- «Esto es una flota de 250 tractos con la **forma** de sus datos. Las posiciones son **simuladas** con las columnas que
  pedimos a su equipo de sistemas.»
- «El principio de todo lo que van a ver: **la IA no decide los temas delicados, escala a la persona** y, si un agente
  falla, avisa.»

**[depende de GPS real]** El acceso de lectura a su tabla de posiciones y geocercas. El lector de tabla propia **ya está
conectado** al cron de GPS (CSV por https o endpoint JSON); el modo SQL de solo lectura está escrito pero **necesita el
controlador `pg`** (decisión pendiente); el SFTP ya existe en el producto, pero falta servidor, credencial y huella real del cliente. Las posiciones del demo se sembraron
directo en `posicion` (proveedor `tabla_propia`): «al conectar su tabla cambia la fuente, no la pantalla».

---

## 2. Conductor — el ciclo del conductor (15 min)

**Pantalla:** `/dashboard/agentes/conductores` (tablero de hitos: «Hitos reportados sin insistencia», «Validados con
ubicación», «Hitos escalados», **Cola de excepciones**, «Viajes en curso») y `/dashboard/agentes/conductores/sitios`.

**Datos sembrados que se usan:** 140 viajes en curso con hitos (llegó a cargar → salió → llegó a descargar → salió);
31 geocercas (3 patios, 14 plantas y 14 andenes), **5 de ellas poligonales**; 6 contactos de escalamiento (jefe de
tráfico nivel 1, jefe de flota nivel 2, por terminal); **157 veredictos de ubicación calculados por el motor real** del
Conductor.

**Se enseña (en este orden)**
1. **[corre hoy] Lo normal:** un viaje cualquiera de la lista: la llegada se **valida contra la geocerca de la planta**
   con la posición GPS (o con el pin del chofer). El veredicto lo calcula `validarHitoContraSitio`, el mismo código del
   producto; nadie lo capturó. Si la planta tiene polígono, «dentro» es punto en polígono, no un círculo.
2. **[corre hoy] El tractor llegó y salió y el chofer no escribió nada — `INN-24007`** (tracto `IN-007`) **y otros 6**
   (`INN-24026`, `INN-24045`, `INN-24064`, `INN-24083`, `INN-24102`, `INN-24121`): el barrido del cron `conductor-hitos`
   comparó las posiciones del GPS contra la geocerca del sitio y registró **la llegada y la salida de carga** con fuente
   «sistema», validadas por GPS, sin texto ni pin del chofer. Se pide **más de una muestra dentro** del sitio (un tractor
   que solo pasa por la puerta no cuenta) y cada hito se detecta **una sola vez** (candado `viaje_cruce_geocerca`). Lo que
   se enseña es el **resultado sembrado**; el barrido corre con el reloj real y con el GPS al día, no a mano delante del
   cliente.
3. **[corre hoy] «Ya llegué» sin GPS que lo respalde — `INN-24005`** (tracto `IN-005`, Silao → CEDIS Apodaca Norte): el
   operador escribió «Ya llegué a descargar, estoy en la puerta», pero la posición del tractor está **lejos de la
   planta**. El hito queda **recibido, no validado**, el motor emite el veredicto **sin coincidencia** y el tablero lo
   pone en la **Cola de excepciones**. *(Hay 6 de estos: `INN-24005`, `INN-24032`, `INN-24059`, `INN-24086`,
   `INN-24113`, `INN-24140`, a 23–342 km de su planta.)* Un «sin coincidencia» **no acusa al chofer**: dice que la
   posición comparada no cae en el sitio registrado (puede ser el GPS, el pin o el catálogo). Un «ya llegué» de un
   viaje **sin sitio** que conciliar también sale como excepción («sin sitio para conciliar»).
4. **[corre hoy] Sin señal de vida — `INN-24023`** (tracto `IN-023`, Silao → Planta Química SLP): el GPS dejó de
   reportar hace más de 100 minutos y el hito pendiente está **escalado** al **jefe de tráfico** (nivel 1; también
   `INN-24069` y `INN-24115`). `INN-24046`, `INN-24092` y `INN-24138` van a **nivel 2 (jefe de flota)**. Además, el
   barrido de «sin señal de vida» dejó un episodio por viaje en la escalera aviso 1 al chofer → aviso 2 → jefe de
   tráfico: `INN-24115` espera tras el aviso 1, `INN-24069` tras el aviso 2, `INN-24046` e `INN-24092` ya están
   escalados al jefe sin atender, `INN-24138` lo atendió el jefe («Ya lo atiendo») y `INN-24023` lo cerró el chofer
   contestando «Estoy bien» (después de una respuesta no se vuelve a preguntar durante 2 horas). Un tractor apagado o
   dentro de un patio de la flota no abre episodio, y si el que se calló es el **conector** de toda la flota no se
   le pregunta a ningún chofer. **Lo que se enseña es el tablero, no el envío del aviso**: el barrido nace apagado
   (`avisar_senal_vida`), el agente está apagado y los teléfonos son de demo.
5. **[corre hoy] Sitios:** el catálogo de geocercas (patios, plantas, andenes). En el archivo de muestra **5 de 17 son
   polígonos** y el catálogo los **guarda nativos** (sus vértices) junto con el círculo que los contiene; la
   re-importación diaria dentro del cron de GPS no pisa lo editado a mano.
6. **[corre hoy] Las instrucciones por convenio:** 14 convenios con 84 instrucciones (puerta, con quién reportarse,
   peculiaridades, documentos, horario, seguridad) en `/dashboard/convenios`; salen al **despachar**, en la **primera
   asignación** del viaje y al **acercarse** a la planta (el margen es configurable por flota). Si el convenio ligado a
   un viaje está mal, se corrige a mano desde el viaje. **[corre hoy]** el **alta y la edición de un convenio en pantalla**
   («Nuevo convenio» y «Editar convenio e instrucciones»: guardado atómico con control de versión, sin volver a subir el
   Excel; al editar se puede llevar el cambio a los viajes en curso y avisar solo a quien ya tenía el despacho). La tarifa
   y los requisitos de cobro **no** se editan en pantalla (son dinero: siguen por importación). **[depende de aplicar]**
   las migraciones 0656-0658 en la base que se enseñe (en la base local del demo ya están).

**Qué decir (solo lo que corre hoy)**
- «Si el operador escribe “ya llegué” y el GPS no lo respalda, el sistema **no lo da por validado y lo muestra como
  excepción** para que una persona lo revise. Y cuando el GPS **sí** lo respalda, ni siquiera hace falta que escriba.»
- «El objetivo: que supervisores y despachadores **dejen de capturar y pasen a ser consultivos**. Lo medimos con la
  cuenta de horas de captura que nos den.»

**No decir todavía**
- Que el sistema **le impide** al operador decir «ya llegué»: hoy el hito se queda como recibido y se señala; no se
  bloquea ni se le pregunta al chofer por la llegada. Los botones de «sin señal de vida» («Sí, estoy», «Voy a cargar»,
  «Estoy bien») salen con plantillas que aún no están aprobadas.
- Que el sistema detecta **todos** los hitos: `regreso` no se detecta (no hay sitio contra el cual compararlo), y los
  umbrales de «sin señal de vida» (45 min de GPS obsoleto, 20 min entre avisos, 2 h de silencio) son **supuestos** que se
  ajustan con datos reales.

**[depende de Meta]** Los avisos con botones fuera de la ventana de 24 h necesitan **plantillas aprobadas (2 a 5 días
hábiles)**: `conductor_senal_vida_v1`, `aviso_jefe_senal_vida_v1` y las del ciclo se mandan a aprobación en cuanto el
número esté verificado; para hoy los avisos se ven como registro, no se envían. **[depende de GPS real]** Posiciones
reales y geocercas reales: el catálogo es del cliente; el nuestro es de muestra (los polígonos reales llegan con su
tabla y se ensayan otra vez).

**No prometer:** que el sistema valida con la **foto** del sello, ni la exactitud con **sus** polígonos reales, sin
haberlo probado con sus geocercas.

---

## 3. Vigía — servicio al cliente por WhatsApp (10 min)

**Pantallas:** `/dashboard/agentes/vigia` («Cola de aprobación», «Excepciones», «Conversaciones activas», «Sin respuesta
(SLA 10 min)», «Molestos o escalados») y `/dashboard/agentes/vigia/historial` («Grupos e histórico»). **Requiere** el
Vigía encendido (`--encender-agentes`), si no la pantalla dice que está apagado.

**Datos sembrados:** 3 clientes críticos con su conversación y su **grupo crítico** (plazo de 10 min); **modo copiloto**
(el agente sugiere, una persona envía); SLA de 10 min y escalamiento a los 30; el **histórico exportado** de los 3 grupos
leído por el importador real; **2 respuestas rápidas aprobadas**.

**Se enseña**
1. **[corre hoy] Autopartes Ficticias del Bajío — 14 min sin respuesta** (SLA 10): el cliente escribió «¿Ya salió la
   unidad de las 6? Nadie me contesta». La conversación está **escalada**, y el agente dejó un **borrador** («su unidad va
   en tránsito; reviso la ubicación y le confirmo la hora…») **pendiente de aprobación**: una persona lo ve, lo edita y
   lo envía. *(Es un dato sembrado: el borrador no lo escribió un modelo en vivo.)*
2. **[corre hoy] Armadora Ficticia Ramos Arizpe — cliente molesto** («esto es inaceptable»): clasificado como queja,
   riesgo alto, **nivel 2** (dato sembrado).
3. **[corre hoy] Cervecería Ficticia del Norte — atendida a tiempo.**
4. **[corre hoy] El histórico exportado y los grupos críticos** (`/dashboard/agentes/vigia/historial`): los 3 chats de
   muestra (.txt iOS, .txt Android y .zip) se leyeron con el importador del Vigía: el autor no queda en claro (solo un
   hash) y los teléfonos y correos escritos dentro del texto se tapan. El análisis saca las **preguntas frecuentes**, las
   **tendencias** por tema, los **tiempos de respuesta** del equipo y cuántas pasaron del umbral de 10 min; el reporte de
   FAQs y tendencias se baja en Excel o PDF. De las FAQs se aprueban **respuestas rápidas** (2 sembradas) que el Vigía usa
   como base del borrador cuando no entiende un mensaje que se les parece; las quejas y «quiero hablar con alguien» las
   atiende siempre una persona.

| Grupo | Mensajes leídos | De cliente | Respuestas >10 min | Mediana / p90 (min) | Quejas | Temas más frecuentes |
|---|---|---|---|---|---|---|
| Autopartes (iOS) | 210 | 106 | 17 | 6 / 30 | 11 | Otros 24 · Hora de llegada 22 · Ubicación 17 · Citas y andén 15 |
| Armadora (Android) | 225 | 114 | 23 | 5 / 34 | 20 | Hora de llegada 20 · Quejas 20 · Otros 18 · Ubicación 17 |
| Cervecería (iOS, .zip) | 207 | 104 | 19 | 5 / 23 | 8 | Otros 27 · Citas y andén 20 · Hora de llegada 19 · Documentos 11 |

*(Son números de los chats sintéticos que lee el importador real, con los nombres del equipo declarados: no son
estadística de ningún cliente.)*

**Qué decir**
- «Se avisa a gerentes y directores cuando un cliente lleva **más de 10 minutos sin respuesta** o está molesto: umbral
  configurable, y escala a una persona. La alerta llega a los 10 minutos más lo que tarde la siguiente pasada del cron
  (cada minuto).»
- «El histórico real de sus grupos críticos nos sirve para sacar **sus** preguntas frecuentes y **sus** tendencias.»

**[depende de Meta] — el punto más delicado del demo**
- **Si sus grupos viven en WhatsApp de teléfonos comunes, la API de Business NO lee esos grupos.** Se dice de frente:
  «**Fase 1 = histórico exportado** (FAQs, tendencias, respuestas sugeridas) y **modo copiloto**: el agente sugiere y
  una persona envía. **En vivo solo si los grupos críticos pasan a un número de WhatsApp Business**; estamos
  verificando con Meta qué permite la API de grupos y con qué límites, **antes de prometerlo**.»
- **Histórico real [depende del cliente]:** si no llega, se usa el de muestra y se dice.
- **Costo:** el cron del Vigía corre cada minuto; es una decisión de costo en Vercel que aún no está tomada.

**No prometer:** lectura en vivo de sus grupos actuales; envío automático sin aprobación.

---

## 4. Peajes — pases × GPS × geocercas, y el reporte de reclamación (8 min)

**Pantallas:** `/dashboard/agentes/peajes`, `/dashboard/agentes/peajes/reclamacion` (el reporte de un desglose) y
`/dashboard/agentes/peajes/configuracion`.

**Datos sembrados:** 12 casetas «Demo», 250 TAG, **381 cruces de las últimas 24 h** con sus posiciones GPS; **9 cruces
fuera de ruta** y **4 cobros duplicados** sembrados a propósito (lista exacta en
`archivos-muestra/peajes/anomalias_sembradas.csv`); 7 cruces sin dato de GPS (unidades silenciosas); y **2 cruces junto
al patio alargado de Tlaquepaque** (polígono nativo) para el reporte con polígono; y **140 cursos por casetas autorizadas**
(uno por tracto en viaje: las casetas de su ruta), a **3 cruces reales** (`IN-020`, `IN-098` e `IN-129`) se les quitó su
caseta del curso a propósito.

**Se enseña**
1. **[corre hoy] Modo en vivo:** `vaciar-sintetico.sh pases`, cargar en configuración `casetas_catalogo.csv` y
   `tags_unidades.csv`, y subir `pases_24h.csv` en «Subir estado de cuenta / desglose del proveedor». El sistema lee el
   archivo, **dice lo que se saltó** y corre el cruce: la pantalla muestra las tres cubetas y el conteo de GPS
   **confirman / no coinciden / sin datos**.
2. **[corre hoy, verificado contra el motor] Las líneas sembradas:** las 381 líneas ya están en la base y dan **el mismo
   veredicto que el motor real de cruce** (`verificar-cruces-con-motor.mjs`, línea por línea). Ejemplo: **`INN-24091`
   (tracto `IN-091`)**: le cobraron en *Caseta Demo Encarnacion* a las 02:36 y el GPS del tractor estaba **lejos** de esa
   caseta; y el **cobro duplicado** de `IN-123` (dos cobros en la misma caseta con 2 min de diferencia, con
   el tractor presente).
3. **[corre hoy, verificado contra la función real] El reporte de reclamación** (desglose «pases_demo_innovativos_24h.csv»
   → *Reporte de reclamación*; se baja en **Excel o PDF** listo para el proveedor): **17 cruces reclamables por $11,497** —
   9 por «GPS lejos de la caseta» ($6,374, confianza alta), 4 por «posible doble cobro» ($2,725, confianza media), 1 por
   **«unidad en zona no autorizada»** ($536, confianza alta) y 3 por **«cruce fuera de curso»** ($1,862, confianza media):
   `IN-141` estaba **dentro del patio de Tlaquepaque** a la hora del pase, y el patio es un **polígono exacto**. Cada línea lleva el porqué y la evidencia de GPS (hasta 3
   posiciones con su distancia a la caseta). Las líneas confirmadas por GPS o **sin datos** no se reclaman: se cuentan
   aparte.
3b. **[corre hoy, verificado contra la función real] «Cruce fuera de curso»** (los **cursos** son las rutas que la flota
   autoriza a cada tracto o convenio): `IN-020`, `IN-098` e `IN-129` pasaron por una caseta real, el GPS **confirma** que SÍ
   estaban ahí, pero esa caseta **no está en su curso autorizado** → se reclaman con confianza **media** y la frase dice el
   curso y las casetas que sí autoriza. En `/dashboard/agentes/peajes/configuracion`, sección **Cursos**, se ven los 140
   cursos sembrados, se cargan otros (CSV o Excel, o leídos de «su tabla»), se desactivan, y **sin curso declarado no se
   reclama nada** (se cuenta aparte). Las líneas con curso evaluable y dentro de él no aparecen.
4. **[corre hoy] El falso positivo que ya no ocurre — `IN-142`:** pasó por la **carretera de junto** al patio (a 330 m
   del centro: dentro del círculo de ~520 m que contiene al patio, **fuera de su polígono**). Con el círculo habría
   salido acusado; con el polígono **no se reclama**. Si una zona solo existiera como círculo aproximado, la acusación
   baja a confianza **media** y se dice que puede ser una unidad que iba por la vía de junto.
5. **Honestidad del cruce:** un cruce solo se marca «no coincide» con datos suficientes (dos posiciones que envuelven el
   instante); si no hay GPS, queda **sin datos**, no «sospechoso». «Reclamable» **no** significa «el cobro es indebido»:
   significa «hay evidencia para **pedir** la revisión»; un TAG prestado o un reloj del proveedor desfasado también
   explican un «no coincide».

**Qué decir**
- «Hoy el reporte para el proveedor se arma a mano. Aquí el sistema **cruza** (caseta, hora, dónde estaba el tractor) y
  usted decide qué reclama.»

**[depende del cliente]**
- **El archivo real de PASE:** hoy el lector es tolerante con los formatos típicos (IAVE/PASE/TeleVía), pero «el formato
  real no lo hemos visto». «Si trae otras columnas, **es una línea de configuración**, no una versión nueva.»
- **TAG y catálogo de casetas con coordenadas:** sin ellos no hay cruce con GPS; hay que pedirlos junto con el archivo.
- **El formato real de sus corredores** (la ruta como línea con buffer) **[depende del cliente]**: el corredor funciona con
  datos sintéticos, pero **[todavía no existe]** el lector de su formato real, que no conocemos (se espera el 12-oct). Los cursos por **casetas autorizadas** no
  esperan nada del cliente: salen de sus convenios y de su catálogo de casetas. «Si sus rutas vienen de otra forma, **es
  una línea de configuración**, no una versión nueva» solo se promete cuando veamos el archivo.

---

## 5. Liquidación fase 1 — solo entregar el pago (7 min)

**Pantallas:** `/dashboard/agentes/liquidacion` (liquidaciones externas) y `/dashboard/agentes/liquidacion/formato`
(el formato de la flota, la copia y los avisos de discrepancia).

**Datos sembrados:** 158 liquidaciones «de su sistema» (folios `SAP-LIQ-DEMO-…`): 116 **acusadas** (8 con **«No
coincide»**), 34 **enviadas**, 8 **fallidas**; ninguna pendiente (nada sale de verdad). El **formato de la flota** sale
del Excel de muestra, con la **copia al jefe de flota** (1 teléfono) y el **aviso de discrepancia** (2 teléfonos), todos
`28999…`.

**Se enseña**
1. **[corre hoy] Qué manda su sistema:** el cuerpo de `POST /api/v1/liquidaciones-externas`
   (`post_liquidacion_externa.ejemplo.json`): folio, operador, viajes, periodo, renglones y total. **Likida no
   recalcula**; solo verifica que el total sea la suma de **sus** renglones (si no cuadra, no se entrega). Los 40 cuerpos
   de la muestra pasan la validación real del endpoint; las fechas de Excel como número de serie también se leen.
2. **[corre hoy] El formato de la flota:** se sube su Excel de muestra y el sistema **deriva la plantilla** (título,
   datos de encabezado, columnas, fila de total); lo que no reconoce no se inventa, se dice. La liquidación se entrega
   al operador **con ese aspecto**, en PDF o en Excel, y el teléfono del **jefe de flota recibe una copia**. Los
   teléfonos de la copia y del aviso de discrepancia se capturan **sin necesidad del Excel** (la flota que usa el PDF
   genérico también los tiene).
3. **[corre hoy] La lista y sus estados:** enviada, acusada, fallida y el filtro **«No coincide»** (lo que el chofer
   rechazó con el botón del mensaje).
4. **[corre hoy] «No coincide» avisa a la oficina, con red:** cada rechazo abre **una sola tarea** para una persona en la
   cola del asistente y manda el aviso a los designados, con su estado guardado: de las 8 discrepancias, **6 muestran
   «Oficina avisada»** y **2 muestran «El aviso no llegó»** (la plantilla de avisos aún no está aprobada en Meta). Esas 2
   traen el botón **«Reavisar»**: rearma el aviso, **no repite a quien ya lo recibió** y dice si salió, salió a una parte o
   sigue pendiente. Dos entregas del mismo botón no duplican el aviso.
5. **[corre hoy, solo el registro] El mensaje al operador:** el código arma el **PDF con dos botones** («recibida» /
   «no coincide»). **No se envía en el demo**: no hay número ni plantilla.

**Qué decir**
- «Fase 1 es **solo entregar**: ustedes calculan, nosotros lo ponemos en la mano del operador **con su formato** y le
  avisamos a su gente si el operador dice que no coincide. **Facturas son la fase 2** y **no incluye OCR de tickets**.»

**[depende de Meta]** Fuera de la ventana de 24 h el envío necesita plantilla aprobada (2 a 5 días hábiles). Las 8
«fallidas» sembradas son justo ese caso («plantilla aún no aprobada»): úsenlo como ejemplo, no como error. El mismo
caso explica los 2 avisos de discrepancia que «no llegaron». **[depende del cliente]** El formato real de su Excel de
liquidación y los teléfonos reales del jefe de flota y de la persona responsable de discrepancias.

**No prometer:** que el chofer reciba el PDF por WhatsApp el día del demo (depende de número verificado y plantilla
aprobada).

---

## 6. Carta Porte — multi-formato sin copiar y pegar (8 min)

**Pantalla:** `/dashboard/carta-porte/documentos` (bandeja de revisión) y la exportación por mapeo.

**Datos sembrados:** 14 documentos de 3 clientes ficticios (PDF, Excel, CSV): **6 aprobados, 5 por revisar, 1
rechazado, 1 recibido y 1 fallido**; 3 perfiles (mapeos); un formato de exportación **sintético**. **Los valores, las
confianzas y la «evidencia» de los documentos leídos son dato de demo escrito por el seed, no salida de un modelo**; el
tamaño y el `sha256` son inventados y el archivo no está en Storage (vive en `archivos-muestra/`).

**Se enseña**
1. **[corre hoy] La bandeja:** estados, campos con su **confianza** y las **dudas** (`orden_c05_3`: código postal de
   destino con confianza baja) marcadas para una persona del equipo. Se dice: «así se ve un documento ya leído».
2. **[corre hoy] El worker de la bandeja:** un documento que entra por correo o WhatsApp **ya no se queda en «recibido»**:
   el cron `carta-porte-docs` (cada 5 min) toma los recibidos, los que quedaron a medias y los que fallaron, con espera
   creciente y **tope de 5 intentos** por documento; y cuando uno entra por correo con **dudas de bloqueo o confianza
   baja**, o **agota sus intentos**, **avisa a la oficina una sola vez** (el candado vive en el propio documento). En la
   bandeja sembrada: `orden_c05_3` ya avisó por sus dudas, `orden_c05_5` acaba de entrar y **el siguiente barrido lo
   toma**, y `orden_c05_6` **agotó sus 5 intentos** y la oficina ya recibió el aviso «agotado». **[corre hoy] el código y
   el estado; el demo no corre el cron** (los documentos sembrados no tienen archivo en Storage: ninguno llama a un modelo).
3. **[corre hoy] El perfil del cliente:** el mapeo declarativo que se aprende de lo aprobado por un humano y se reaplica
   **sin modelo** la siguiente vez del mismo formato (más barato, más confiable).
4. **[corre hoy, verificado] El documento con instrucciones escondidas** (`orden_c12_4`, «IGNORA LAS INSTRUCCIONES
   ANTERIORES…»): el **detector real** (`detectarInyeccion`) marca el archivo de muestra
   (`verificar-hechos-del-guion.mjs`). El documento sembrado **ya viene marcado** por el seed; la detección en vivo
   ocurre al **subir** un documento.
5. **[corre hoy] Salida a su sistema:** la exportación con el mapeo declarado → un CSV con las columnas de carga
   (sintéticas) que Excel abre, o un **.xlsx** nativo; cuando llegue su formato real, se carga como configuración.

**Qué decir**
- «Cada cliente manda **su** formato. El perfil por cliente es lo que hace que esto escale **sin reprogramar**.»
- «**La IA no decide los temas delicados:** lo dudoso va al equipo, y si algo no se pudo leer, la oficina se entera.»

**[depende del cliente]** Documentos reales de 3 a 5 clientes grandes y su Excel/sistema de carga: hasta entonces la
exactitud que se muestra es la de documentos de **muestra**; la exactitud real se mide con sus documentos. Un Excel con
Un Excel con **varios embarques** se parte solo en un documento por embarque (cada uno con su revisión y su viaje; el original queda como constancia). **[depende de aplicar 0670-0671]** Sin esas migraciones lee el primero y avisa.
**[depende de Meta / Resend]** El aviso a la oficina sale por WhatsApp con la plantilla `aviso_operacion_v1` (sin
aprobar) y el canal de correo necesita el dominio y los webhooks de Resend. **Costo de modelo:** una carga **en vivo**
de un documento nuevo llama a un modelo (costo mínimo por documento); en el demo se usan los **precargados** salvo que
se autorice el gasto.

---

## 7. Cierre — el orquestador, de vuelta (5 min)

**Pantalla:** `/dashboard/chat`.

**[corre hoy]** Preguntas de las fuentes que el chat sí consulta: **probarlas todas en el ensayo** y quitar las que no
respondan bien.
- «¿Dónde va el viaje `INN-24005` y por qué está en excepciones?» (detalle del viaje: hitos y excepciones)
- «¿Qué clientes llevan más de 10 minutos sin respuesta?» (estado del Vigía)
- «¿Qué cruces de peaje conviene reclamar?» (reclamación de peajes)
- «¿Cómo va la entrega de las liquidaciones y cuáles tienen una diferencia abierta?» (liquidación externa)

**[todavía no existe]** Leer **SAP/TMS en vivo**: no hay conector; el chat consulta lo que Likida ya tiene.

**Qué decir:** «Esta es la pestaña desde la que se pregunta. **No decide** lo delicado: lo escala a la persona. Si un
agente falla, **avisa**.» **No** decir «una sola pestaña con SAP, GPS y WhatsApp»: SAP no está conectado.

---

## 8. Cuando algo depende de un tercero — frases listas

| Tercero | Qué falta | Qué decir (verdad) | Quién |
|---|---|---|---|
| **Meta (WhatsApp)** | Número verificado y plantillas aprobadas (incluidas las de «sin señal de vida» y la de avisos a la oficina) | «Los avisos con botones fuera de 24 h necesitan plantilla aprobada por Meta (2 a 5 días hábiles). Las mandamos en cuanto haya número; hoy ven el registro de lo que se enviaría.» | Likida, al verificar el número |
| **GPS real** | Vista de solo lectura a su tabla y a sus geocercas | «El lector de su tabla ya está conectado para CSV y endpoint; el SFTP ya está escrito y lo probamos con su servidor y la huella de su llave; y el SQL directo ya existe (probado contra un PostgreSQL real de prueba, solo lectura, siempre cifrado). Les damos el bloque SQL para crear el usuario y la vista; pedimos un usuario de solo lectura sobre una vista o réplica, nunca producción, y que nos permitan entrar desde nuestra IP de salida.» | Sistemas del cliente |
| **WhatsApp, grupos** | Que los grupos críticos migren a Business, o seguir en copiloto | «La API de Business no lee los grupos de un teléfono común. Fase 1: histórico exportado + copiloto. En vivo solo con grupos en Business, y lo verificamos con Meta antes de prometerlo.» | El cliente (histórico) · Likida (API de grupos) |
| **Archivo de pases** | El archivo real de PASE, TAG y casetas con coordenadas | «El lector es tolerante; si trae columnas nuevas es una línea de configuración. Sin TAG ni coordenadas de casetas no hay cruce con GPS.» | El cliente |
| **Liquidación** | Su Excel de liquidación y los teléfonos del jefe de flota y de discrepancias | «La plantilla se deriva de su archivo de muestra; hoy ven un formato de ejemplo y teléfonos de demo.» | El cliente |
| **Carta Porte** | Documentos reales y su Excel/sistema de carga | «La exactitud real se mide con sus documentos; hoy ven documentos de muestra.» | El cliente |
| **«Calle de instrucciones»** | Saber si vive en su sistema o en la app del operador | «Podemos mandarla por WhatsApp y también exportarla para que se escriba en su sistema; hay que confirmar cuál prefieren.» | Por confirmar con el cliente |

## 9. Preguntas probables y cómo contestarlas

- **«¿Quién se hace responsable si el agente se equivoca?»** → Los temas delicados **escalan a una persona**; un
  «ya llegué» que el GPS contradice se **señala como excepción**; las liquidaciones no se recalculan; un «no coincide»
  de un cobro de peaje es una razón para **pedir** la revisión, no una acusación.
- **«¿Leen mis grupos de WhatsApp hoy?»** → No en vivo (ver sección 3). Histórico exportado + copiloto.
- **«¿Y si cambio de proveedor de GPS?»** → Hay lectores por proveedor (Wialon, Geotab, Navixy, genérico, push) y el de su
  tabla propia (CSV o endpoint ya conectados; SFTP escrito, pendiente de servidor y huella del cliente; SQL directo escrito y probado contra un PostgreSQL de prueba, pendiente de su usuario, su vista y la IP de salida permitida).
- **«¿Mis datos están seguros?»** → Acceso de **solo lectura** con usuario restringido; el demo corre en base local y
  sintética, con teléfonos que no son de nadie; nada va a producción sin su autorización.

## 10. Si algo falla durante el demo

1. Pantalla vacía: las posiciones y los viajes se calculan contra la ancla del demo; si el reloj del equipo no coincide,
   `sembrar.sh --reiniciar --ancla '<hoy 09:00 -06>'` (≈ 15 s).
2. El panel del Vigía dice «apagado»: `sembrar.sh --encender-agentes` (o el interruptor del propio panel).
3. Una pantalla no abre: usar las **capturas del ensayo** y los archivos de `archivos-muestra/` para mostrar el dato.
4. Un envío «no sale»: es lo esperado (no hay número ni plantillas, y los teléfonos del demo se rechazan); no reintentar
   delante del cliente. Un aviso de discrepancia que «no llegó» **es** el ejemplo de «Reavisar».
5. Cualquier cifra que no se pueda explicar: **no se defiende**; se anota y se contesta por escrito. La regla del
   producto es **nunca inventar una cifra**.
