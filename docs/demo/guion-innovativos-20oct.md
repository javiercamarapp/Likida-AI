# Guion del demo — cliente de ~250 tractos

**Para:** dirección y operación del cliente de demo. **Duración:** ~50 min + preguntas.
**Qué se demuestra:** los 5 primeros agentes —**orquestador**, **conductor/Vigía** (ciclo del conductor y servicio al
cliente), **peajes**, **liquidación fase 1** y **Carta Porte**— sobre datos con la forma de los de un transportista de
~250 tractos. **Datos y kit de carga:** [`innovativos.md`](./innovativos.md). Todo lo que se ve es **sintético** (tenant
«Innovativos (demo)») salvo lo que ya se haya recibido y cargado; el guion dice dónde hay que decirlo.

> **Regla del demo: nunca decir «en vivo» ni «real» de lo que no lo es, y no prometer lo que esta rama no hace hoy.**
> Cada cosa que se enseña lleva una de tres etiquetas. Si no tiene etiqueta **corre hoy**, no se enseña.

| Etiqueta | Significa |
|---|---|
| **[corre hoy]** | El código está en esta rama y se verificó contra la base sembrada (motor, veredictos, cruces, conteos). Las **pantallas** todavía no se han visto renderizadas: se confirman en el ensayo (innovativos.md §6). |
| **[se enseña cuando se integre X]** | Depende de código de otra rama de la Ola 3 (`w3-agentes-1-4`, `w3-conductor-vigia`, `w3-convenios`, `w3-gps-jornada`). Hoy NO existe aquí: no se enseña ni se promete. |
| **[depende de Meta / GPS real / cliente]** | Lo bloquea un tercero (plantillas aprobadas por Meta, acceso a su GPS, archivos reales del cliente). Hoy es simulado o es un registro de lo que se enviaría. |

---

## 0. Antes de entrar (preparación)

| Cuándo | Qué | Cómo se sabe que está listo |
|---|---|---|
| Con días de anticipación | Ensayo completo con este guion en la pila local (innovativos.md §6) | Cada pantalla de las secciones 1–6 abre y trae datos |
| La víspera | `bash scripts/demo/innovativos/sembrar.sh --reiniciar --encender-agentes` (ancla `2026-10-20 09:00`) | La salida termina con la tabla de conteos (140 en curso, 379 pases, 158 liquidaciones…) y los **158 veredictos** del motor |
| La víspera | `probar-idempotencia.sh`, `verificar-cruces-con-motor.mjs` y `verificar-hechos-del-guion.mjs` | «IDEMPOTENCIA OK», «las 379 líneas coinciden con el motor real» y «los hechos del guion coinciden con la base» |
| La víspera | Si ya llegaron archivos reales: `validar-archivo.mjs` de cada uno → `vaciar-sintetico.sh <conjunto>` → cargar | La pantalla del conjunto muestra lo real; **el guion de ese conjunto cambia a «con sus datos»** |
| 1 h antes | Reloj del equipo y ancla: el demo asume que «ahora» es 09:00 de la ancla; si el ensayo es otro día, `sembrar.sh --reiniciar --ancla '<hoy 09:00 -06>'` (`--ancla` **exige** `--reiniciar`) | El mapa muestra viajes en curso y el tablero del Conductor tiene excepciones |
| 1 h antes | **Plan B** a la mano: capturas de cada pantalla del ensayo y los archivos de `archivos-muestra/` | — |

**Los agentes vienen apagados y no se manda nada por WhatsApp.** El seed deja el Vigía (`habilitado = false`) y el
Conductor (`activo = false`) apagados; `--encender-agentes` los enciende solo para que se vean sus pantallas (sin eso el
panel del Vigía dice «El Vigía está apagado para tu flota»). Aun encendidos, todos los teléfonos del demo llevan la
marca `28999…` y el envío real los rechaza antes de llamar a Meta. Lo que parezca un envío es el registro de lo que se
enviaría.

---

## 1. Apertura — el orquestador: una sola vista de la operación (5 min)

**Pantalla:** `/dashboard/mapa` (Mapa de la operación).

**Se enseña**
1. **[corre hoy]** El mapa: unidades con posición, **«Sin ubicar»** y **«Escalados»** (los KPI existen en la pantalla;
   las posiciones salen de `posicion`, ver abajo).
2. **[se enseña cuando se integre `w3-agentes-1-4`]** *Una sola pestaña con SAP, GPS y WhatsApp.* Hoy el chat
   (`/dashboard/chat`) consulta KPIs, viajes, liquidaciones, Carta Porte y normas; **no** lee hitos, peajes ni Vigía.
   No se promete como «una sola pestaña» hasta integrar esas fuentes.

**Qué decir**
- «Esto es una flota de 250 tractos con la **forma** de sus datos. Las posiciones son **simuladas** con las columnas que
  pedimos a su equipo de sistemas.»
- «El principio de todo lo que van a ver: **la IA no decide los temas delicados, escala a la persona** y, si un agente
  falla, avisa.»

**[depende de GPS real]** El acceso de lectura a su tabla de posiciones y geocercas. **Hoy el lector de su tabla
(`LectorTablaPropia`) es solo un contrato con una referencia CSV: no está conectado a ninguna ruta ni cron**, y las
posiciones del demo se sembraron directo en `posicion`. «Al conectar su tabla cambia la fuente, no la pantalla» **solo
será cierto cuando se integre `w3-gps-jornada`** y el lector alimente esa misma tabla; hasta entonces, no se dice.

---

## 2. Conductor — el ciclo del conductor (15 min)

**Pantalla:** `/dashboard/agentes/conductores` (tablero de hitos: «Hitos reportados sin insistencia», «Validados con
ubicación», «Hitos escalados», **Cola de excepciones**, «Viajes en curso») y `/dashboard/agentes/conductores/sitios`.

**Datos sembrados que se usan:** 140 viajes en curso con hitos (llegó a cargar → salió → llegó a descargar → salió);
17 geocercas de patios y plantas; 6 contactos de escalamiento (jefe de tráfico nivel 1, jefe de flota nivel 2, por
terminal); **158 veredictos de ubicación calculados por el motor real** del Conductor.

**Se enseña (en este orden)**
1. **[corre hoy] Lo normal:** un viaje cualquiera de la lista: la llegada se **valida contra la geocerca de la planta**
   con la posición GPS (o con el pin del chofer). El veredicto lo calcula `validarHitoContraSitio`, el mismo código del
   producto; nadie lo capturó.
2. **[corre hoy] «Ya llegué» sin GPS que lo respalde — `INN-24005`** (tracto `IN-005`, Silao → CEDIS Apodaca Norte): el
   operador escribió «Ya llegué a descargar, estoy en la puerta», pero la posición del tractor está **lejos de la
   planta**. El hito queda **recibido, no validado**, el motor emite el veredicto **sin coincidencia** y el tablero lo
   pone en la **Cola de excepciones**. *(Hay 6 de estos: `INN-24005`, `INN-24032`, `INN-24059`, `INN-24086`,
   `INN-24113`, `INN-24140`, a 23–342 km de su planta.)* Un «sin coincidencia» **no acusa al chofer**: dice que la
   posición comparada no cae en el sitio registrado (puede ser el GPS, el pin o el catálogo).
3. **[corre hoy] Sin señal de vida — `INN-24023`** (tracto `IN-023`, Silao → Planta Química SLP): el GPS dejó de
   reportar hace más de 100 minutos y el hito pendiente está **escalado** al **jefe de tráfico** (nivel 1; también
   `INN-24069` y `INN-24115`). `INN-24046`, `INN-24092` y `INN-24138` van a **nivel 2 (jefe de flota)**. El seed deja el
   estado como lo dejaría el cron `conductor-hitos`: **lo que se enseña es el tablero, no el envío del aviso** (agente
   apagado, teléfonos de demo).
4. **[corre hoy] Sitios:** el catálogo de geocercas (patios, plantas, andenes). En el archivo de muestra **4 de 17 son
   polígonos** en su sistema y el catálogo guarda centro + radio, así que se **aproximan por el círculo que los contiene**
   (declarado).
5. **[se enseña cuando se integre `w3-convenios`] Las instrucciones por convenio:** al despachar y al acercarse a la
   planta, el operador recibe «qué puerta, con quién reportarse, peculiaridades». El seed ya trae 14 convenios con 84
   instrucciones, pero hoy solo viven en `innovativos_sim.convenio*`; la pantalla y el mensaje no existen aquí.

**Qué decir (solo lo que corre hoy)**
- «Si el operador escribe “ya llegué” y el GPS no lo respalda, el sistema **no lo da por validado y lo muestra como
  excepción** para que una persona lo revise.»
- «El objetivo: que supervisores y despachadores **dejen de capturar y pasen a ser consultivos**. Lo medimos con la
  cuenta de horas de captura que nos den.»

**No decir todavía**
- **[se enseña cuando se integre `w3-conductor-vigia`]** La **conciliación obligatoria** («el operador *no puede* decir
  “ya llegué” si el GPS dice que no») y los **botones de escalamiento** («sí, estoy» / «voy a cargar» / «estoy bien»):
  no existen en esta rama. Hoy el hito se queda como recibido y se señala; no se bloquea ni se le pregunta al chofer.

**[depende de Meta]** Los avisos con botones fuera de la ventana de 24 h necesitan **plantillas aprobadas (2 a 5 días
hábiles)**: se mandan a aprobación en cuanto el número esté verificado; para hoy los avisos se ven como registro, no se
envían. **[depende de GPS real]** Posiciones reales y geocercas reales: el catálogo es del cliente; el nuestro es de muestra.

**No prometer:** que el sistema valida con la **foto** del sello o con polígonos exactos sin haberlo probado con sus
geocercas reales.

---

## 3. Vigía — servicio al cliente por WhatsApp (10 min)

**Pantalla:** `/dashboard/agentes/vigia` («Cola de aprobación», «Excepciones», «Conversaciones activas», «Sin respuesta
(SLA 10 min)», «Molestos o escalados»). **Requiere** el Vigía encendido (`--encender-agentes`), si no la pantalla dice
que está apagado.

**Datos sembrados:** 3 clientes críticos con su conversación; **modo copiloto** (el agente sugiere, una persona envía);
SLA de 10 min y escalamiento a los 30.

**Se enseña**
1. **[corre hoy] Autopartes Ficticias del Bajío — 14 min sin respuesta** (SLA 10): el cliente escribió «¿Ya salió la
   unidad de las 6? Nadie me contesta». La conversación está **escalada**, y el agente dejó un **borrador** («su unidad va
   en tránsito; reviso la ubicación y le confirmo la hora…») **pendiente de aprobación**: una persona lo ve, lo edita y
   lo envía. *(Es un dato sembrado: el borrador no lo escribió un modelo en vivo.)*
2. **[corre hoy] Armadora Ficticia Ramos Arizpe — cliente molesto** («esto es inaceptable»): clasificado como queja,
   riesgo alto, **nivel 2** (dato sembrado).
3. **[corre hoy] Cervecería Ficticia del Norte — atendida a tiempo.**
4. **[se enseña cuando se integre `w3-conductor-vigia`] El histórico exportado:** el importador y la pantalla «Grupos e
   histórico» no existen aquí. Los 3 chats de muestra solo sirven hoy para probar el validador de forma:

| Grupo | Mensajes | Preguntas | Respuestas >10 min | Quejas | Temas más frecuentes |
|---|---|---|---|---|---|
| Autopartes (iOS) | 214 | 104 | 21 | 11 | placas 22 · ETA 22 · documentos 17 · ubicación 17 |
| Armadora (Android) | 235 | 111 | 24 | 20 | documentos 26 · ETA 20 · queja 20 · ubicación 17 |
| Cervecería (iOS, .zip) | 214 | 103 | 21 | 8 | placas 26 · citas 20 · documentos 20 · ETA 19 |

*(Son conteos del chat sintético, generado para probar el importador: no son estadística de ningún cliente.)*

**Qué decir**
- «Se avisa a gerentes y directores cuando un cliente lleva **más de 10 minutos sin respuesta** o está molesto: umbral
  configurable, y escala a una persona.»

**[depende de Meta] — el punto más delicado del demo**
- **Si sus grupos viven en WhatsApp de teléfonos comunes, la API de Business NO lee esos grupos.** Se dice de frente:
  «**Fase 1 = histórico exportado** (FAQs, tendencias, respuestas sugeridas) y **modo copiloto**: el agente sugiere y
  una persona envía. **En vivo solo si los grupos críticos pasan a un número de WhatsApp Business**; estamos
  verificando con Meta qué permite la API de grupos y con qué límites, **antes de prometerlo**.»
- **Histórico real [depende del cliente]:** si no llega, se usa el de muestra y se dice.

**No prometer:** lectura en vivo de sus grupos actuales; envío automático sin aprobación; FAQs y tendencias hasta que
exista el importador.

---

## 4. Peajes — pases × GPS × geocercas (8 min)

**Pantalla:** `/dashboard/agentes/peajes` y `/dashboard/agentes/peajes/configuracion`.

**Datos sembrados:** 12 casetas «Demo», 250 TAG, **379 cruces de las últimas 24 h** con sus posiciones GPS; **9 cruces
fuera de ruta** y **4 cobros duplicados** sembrados a propósito (lista exacta en
`archivos-muestra/peajes/anomalias_sembradas.csv`); 7 cruces sin dato de GPS (unidades silenciosas).

**Se enseña**
1. **[corre hoy] Modo en vivo:** `vaciar-sintetico.sh pases`, cargar en configuración `casetas_catalogo.csv` y
   `tags_unidades.csv`, y subir `pases_24h.csv` en «Subir estado de cuenta / desglose del proveedor». El sistema lee el
   archivo, **dice lo que se saltó** y corre el cruce: la pantalla muestra las tres cubetas y el conteo de GPS
   **confirman / no coinciden / sin datos**.
2. **[corre hoy, verificado contra el motor] Las líneas sembradas:** las 379 líneas ya están en la base y dan **el mismo
   veredicto que el motor real de cruce** (`verificar-cruces-con-motor.mjs`, línea por línea). Ejemplo: **`INN-24091`
   (tracto `IN-091`)**: le cobraron en *Caseta Demo Encarnacion* a las 02:36 y el GPS del tractor estaba **lejos** de esa
   caseta; y el **cobro duplicado** de `IN-123` (dos cobros en la misma caseta con 2 min de diferencia, con
   el tractor presente).
3. **[se enseña cuando se integre `w3-agentes-1-4`] El reporte de reclamación** (el detalle por línea con la evidencia,
   en PDF/Excel listo para el proveedor): no existe en esta rama. Hoy la evidencia por línea se ve en
   `anomalias_sembradas.csv`, no en una pantalla de reclamación.
4. **Honestidad del cruce:** un cruce solo se marca «no coincide» con datos suficientes (dos posiciones que envuelven el
   instante); si no hay GPS, queda **sin datos**, no «sospechoso». Un «no coincide» **no es una acusación**: puede ser un
   TAG prestado o un reloj del proveedor desfasado.

**Qué decir**
- «Hoy el reporte para el proveedor se arma a mano. Aquí el sistema **cruza** (caseta, hora, dónde estaba el tractor) y
  usted decide qué reclama.»

**[depende del cliente]**
- **El archivo real de PASE:** hoy el lector es tolerante con los formatos típicos (IAVE/PASE/TeleVía), pero «el formato
  real no lo hemos visto». «Si trae otras columnas, **es una línea de configuración**, no una versión nueva.»
- **TAG y catálogo de casetas con coordenadas:** sin ellos no hay cruce con GPS; hay que pedirlos junto con el archivo.

---

## 5. Liquidación fase 1 — solo entregar el pago (7 min)

**Pantalla:** `/dashboard/agentes/liquidacion` (liquidaciones externas).

**Datos sembrados:** 158 liquidaciones «de su sistema» (folios `SAP-LIQ-DEMO-…`): 116 **acusadas** (8 con **«No
coincide»**), 34 **enviadas**, 8 **fallidas**; ninguna pendiente (nada sale de verdad).

**Se enseña**
1. **[corre hoy] Qué manda su sistema:** el cuerpo de `POST /api/v1/liquidaciones-externas`
   (`post_liquidacion_externa.ejemplo.json`): folio, operador, viajes, periodo, renglones y total. **Likida no
   recalcula**; solo verifica que el total sea la suma de **sus** renglones (si no cuadra, no se entrega). Los 40 cuerpos
   de la muestra pasan la validación real del endpoint.
2. **[corre hoy] La lista y sus estados:** enviada, acusada, fallida y el filtro **«No coincide»** (lo que el chofer
   rechazó con el botón del mensaje).
3. **[corre hoy, solo el registro] El mensaje al operador:** el código arma el **PDF con dos botones** («recibida» /
   «no coincide»). **No se envía en el demo**: no hay número ni plantilla. Hoy el envío es **solo el PDF**.

**Qué decir**
- «Fase 1 es **solo entregar**: ustedes calculan, nosotros lo ponemos en la mano del operador. **Facturas son la fase 2**
  y **no incluye OCR de tickets**.»

**No decir todavía**
- **[no está construido]** «No coincide se escala a una persona» / «le avisamos a la oficina»: hoy el «No coincide» queda
  **registrado y filtrable**; no hay aviso a nadie. Tampoco hay **copia al jefe de flota** ni **Excel por WhatsApp**.
- **[se enseña cuando se integre `w3-agentes-1-4`]** La plantilla de liquidación **por flota a partir de su Excel**: hoy
  solo hay un layout sintético (`formato_liquidacion_muestra.xlsx`).

**[depende de Meta]** Fuera de la ventana de 24 h el envío necesita plantilla aprobada (2 a 5 días hábiles). Las 8
«fallidas» sembradas son justo ese caso («plantilla aún no aprobada»): úsenlo como ejemplo, no como error.
**[depende del cliente]** El formato real de su Excel de liquidación.

**No prometer:** que el chofer reciba el PDF por WhatsApp el día del demo (depende de número verificado y plantilla
aprobada).

---

## 6. Carta Porte — multi-formato sin copiar y pegar (8 min)

**Pantalla:** `/dashboard/carta-porte/documentos` (bandeja de revisión) y la exportación por mapeo.

**Datos sembrados:** 12 documentos de 3 clientes ficticios (PDF, Excel, CSV): **6 aprobados, 5 por revisar, 1
rechazado**; 3 perfiles (mapeos); un formato de exportación **sintético**. **Los valores, las confianzas y la
«evidencia» de esos 12 documentos son dato de demo escrito por el seed, no salida de un modelo**; el tamaño y el
`sha256` son inventados y el archivo no está en Storage (vive en `archivos-muestra/`).

**Se enseña**
1. **[corre hoy] La bandeja:** estados, campos con su **confianza** y las **dudas** (`orden_c05_3`: código postal de
   destino con confianza baja) marcadas para una persona del equipo. Se dice: «así se ve un documento ya leído».
2. **[corre hoy] El perfil del cliente:** el mapeo declarativo que se aprende de lo aprobado por un humano y se reaplica
   **sin modelo** la siguiente vez del mismo formato (más barato, más confiable).
3. **[corre hoy, verificado] El documento con instrucciones escondidas** (`orden_c12_4`, «IGNORA LAS INSTRUCCIONES
   ANTERIORES…»): el **detector real** (`detectarInyeccion`) marca el archivo de muestra
   (`verificar-hechos-del-guion.mjs`). El documento sembrado **ya viene marcado** por el seed; la detección en vivo
   ocurre al **subir** un documento.
4. **[corre hoy] Salida a su sistema:** la exportación con el mapeo declarado → un CSV con las columnas de carga
   (sintéticas) que Excel abre; cuando llegue su formato real, se carga como configuración.

**Qué decir**
- «Cada cliente manda **su** formato. El perfil por cliente es lo que hace que esto escale **sin reprogramar**.»
- «**La IA no decide los temas delicados:** lo dudoso va al equipo.»

**[depende del cliente]** Documentos reales de 3 a 5 clientes grandes y su Excel/sistema de carga: hasta entonces la
exactitud que se muestra es la de documentos de **muestra**; la exactitud real se mide con sus documentos.
**Costo de modelo:** una carga **en vivo** de un documento nuevo llama a un modelo (costo mínimo por documento); en el
demo se usan los **precargados** salvo que se autorice el gasto. **Destino `.xlsx` nativo:** el contrato actual exporta
`csv|json`; si su sistema exige otra cosa, se decide al ver el formato.

---

## 7. Cierre — el orquestador, de vuelta (5 min)

**Pantalla:** `/dashboard/chat`.

**[corre hoy]** Preguntas de las fuentes que el chat sí consulta (KPIs de la flota, viajes, liquidaciones, Carta Porte):
**probarlas todas en el ensayo** y quitar las que no respondan bien.

**[se enseña cuando se integre `w3-agentes-1-4`]** Las preguntas que cruzan fuentes nuevas **no se enseñan hoy**:
- «¿Dónde va el viaje `INN-24005` y por qué está en excepciones?» (hitos y veredictos)
- «¿Qué clientes llevan más de 10 minutos sin respuesta?» (Vigía)
- «¿Qué cruces de peaje no cuadran con el GPS?» (peajes)

**Qué decir:** «Esta es la pestaña desde la que se pregunta. **No decide** lo delicado: lo escala a la persona. Si un
agente falla, **avisa**.» **No** decir «una sola pestaña con SAP, GPS y WhatsApp» hasta que esas fuentes estén
integradas.

---

## 8. Cuando algo depende de un tercero — frases listas

| Tercero | Qué falta | Qué decir (verdad) | Quién |
|---|---|---|---|
| **Meta (WhatsApp)** | Número verificado y plantillas aprobadas | «Los avisos con botones fuera de 24 h necesitan plantilla aprobada por Meta (2 a 5 días hábiles). Las mandamos en cuanto haya número; hoy ven el registro de lo que se enviaría.» | Likida, al verificar el número |
| **GPS real** | Vista de solo lectura a su tabla y a sus geocercas | «Hoy es simulado con las columnas de su tabla; el lector de su tabla todavía no está conectado. Pedimos un usuario de solo lectura sobre una vista o réplica, nunca producción.» | Sistemas del cliente |
| **WhatsApp, grupos** | Que los grupos críticos migren a Business, o seguir en copiloto | «La API de Business no lee los grupos de un teléfono común. Fase 1: histórico exportado + copiloto. En vivo solo con grupos en Business, y lo verificamos con Meta antes de prometerlo.» | El cliente (histórico) · Likida (API de grupos) |
| **Archivo de pases** | El archivo real de PASE, TAG y casetas con coordenadas | «El lector es tolerante; si trae columnas nuevas es una línea de configuración. Sin TAG ni coordenadas de casetas no hay cruce con GPS.» | El cliente |
| **Liquidación** | Su Excel de liquidación | «La plantilla por flota se construye de su archivo de muestra; hoy ven un layout de ejemplo.» | El cliente |
| **Carta Porte** | Documentos reales y su Excel/sistema de carga | «La exactitud real se mide con sus documentos; hoy ven documentos de muestra.» | El cliente |
| **«Calle de instrucciones»** | Saber si vive en su sistema o en la app del operador | «Podemos mandarla por WhatsApp y también exportarla para que se escriba en su sistema; hay que confirmar cuál prefieren.» | Por confirmar con el cliente |

## 9. Preguntas probables y cómo contestarlas

- **«¿Quién se hace responsable si el agente se equivoca?»** → Los temas delicados **escalan a una persona**; un
  «ya llegué» que el GPS contradice se **señala como excepción**; las liquidaciones no se recalculan.
- **«¿Leen mis grupos de WhatsApp hoy?»** → No en vivo (ver sección 3). Histórico exportado + copiloto.
- **«¿Y si cambio de proveedor de GPS?»** → Hay lectores por proveedor (Wialon, Geotab, Navixy, genérico, push) y un
  contrato para su tabla propia (`LectorTablaPropia`) **que aún no está conectado**: se dice así.
- **«¿Mis datos están seguros?»** → Acceso de **solo lectura** con usuario restringido; el demo corre en base local y
  sintética, con teléfonos que no son de nadie; nada va a producción sin su autorización.

## 10. Si algo falla durante el demo

1. Pantalla vacía: las posiciones y los viajes se calculan contra la ancla del demo; si el reloj del equipo no coincide,
   `sembrar.sh --reiniciar --ancla '<hoy 09:00 -06>'` (≈ 15 s).
2. El panel del Vigía dice «apagado»: `sembrar.sh --encender-agentes` (o el interruptor del propio panel).
3. Una pantalla no abre: usar las **capturas del ensayo** y los archivos de `archivos-muestra/` para mostrar el dato.
4. Un envío «no sale»: es lo esperado (no hay número ni plantillas, y los teléfonos del demo se rechazan); no reintentar
   delante del cliente.
5. Cualquier cifra que no se pueda explicar: **no se defiende**; se anota y se contesta por escrito. La regla del
   producto es **nunca inventar una cifra**.
