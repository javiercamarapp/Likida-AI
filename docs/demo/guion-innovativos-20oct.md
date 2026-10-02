# Guion del demo — cliente de ~250 tractos

**Para:** dirección y operación del cliente de demo. **Duración:** ~50 min + preguntas.
**Qué se demuestra:** los 5 primeros agentes —**orquestador**, **conductor/Vigía** (ciclo del conductor y servicio al
cliente), **peajes**, **liquidación fase 1** y **Carta Porte**— sobre datos con la forma exacta de los suyos.
**Datos y kit de carga:** [`innovativos.md`](./innovativos.md). Todo lo que se ve es **sintético** (tenant
«Innovativos (demo)») salvo lo que ya hayan entregado y se haya cargado; el guion dice dónde hay que decirlo.

> **Regla del demo: nunca decir «en vivo» ni «real» de lo que no lo es.** Lo que gana la reunión es que cada cosa
> que se enseña sea verdad y que lo que falta se diga con quién lo trae y cuándo.

---

## 0. Antes de entrar (preparación)

| Cuándo | Qué | Cómo se sabe que está listo |
|---|---|---|
| T-3 días | Ensayo completo con este guion en la pila local (innovativos.md §6) | Cada pantalla de las secciones 1–6 abre y trae datos |
| T-1 día | `bash scripts/demo/innovativos/sembrar.sh --reiniciar` (ancla `2026-10-20 09:00`) | La salida termina con la tabla de conteos (140 en curso, 379 pases, 158 liquidaciones…) |
| T-1 día | `bash scripts/demo/innovativos/probar-idempotencia.sh` y `node scripts/demo/innovativos/verificar-cruces-con-motor.mjs` | «IDEMPOTENCIA OK» y «las 379 líneas coinciden con el motor real» |
| T-1 día | Si ya llegaron archivos reales: `validar-archivo.mjs` de cada uno → `vaciar-sintetico.sh <conjunto>` → cargar | Pantalla del conjunto muestra lo real; **el guion de ese conjunto cambia a «con sus datos»** |
| T-1 h | Reloj del equipo y ancla: el demo asume que «ahora» es 09:00 de la ancla; si el ensayo es otro día, sembrar con `--ancla` | El mapa muestra viajes en curso y el tablero del Conductor tiene excepciones |
| T-1 h | **Plan B** a la mano: capturas de cada pantalla del ensayo y los archivos de `archivos-muestra/` | — |

**No se manda nada por WhatsApp en el demo.** No hay número ni plantillas de Meta cargados en el entorno local: lo que
parezca un envío es el registro de lo que se enviaría.

---

## 1. Apertura — el orquestador: una sola vista de la operación (5 min)

**Pantalla:** `/dashboard/mapa` (Mapa de la operación) y, al final de todo, `/dashboard/chat`.

**Se enseña**
1. El mapa: **140 viajes en curso**, unidades con posición, «sin ubicar» y **escalados**.
2. El mensaje: *una sola pestaña con SAP, GPS y WhatsApp*; se
   regresa a ella en la sección 7.

**Qué decir**
- «Esto es su flota de 250 tractos con la **forma** de sus datos. Las posiciones son simuladas con las columnas exactas
  que pedimos a su equipo de sistemas; el día que nos habiliten la vista de solo lectura **cambia la fuente, no la
  pantalla**.»
- «El principio de todo lo que van a ver: **la IA no decide los temas delicados, escala a la persona** y, si un agente
  falla, avisa.»

**Si depende de un tercero (GPS):** el acceso de lectura a su tabla de posiciones y geocercas (su equipo de sistemas,
a confirmar con el cliente). Hasta entonces: simulado, y se dice.

---

## 2. Conductor — el ciclo del conductor (15 min)

**Pantalla:** `/dashboard/agentes/conductores` (tablero de hitos: «Hitos reportados sin insistencia», «Validados con
ubicación», «Hitos escalados», **Cola de excepciones**, «Viajes en curso») y `/dashboard/agentes/conductores/sitios`.

**Datos sembrados que se usan:** 140 viajes en curso con hitos (llegó a cargar → salió → llegó a descargar → salió);
1,466 hitos; 17 geocercas de patios y plantas; 6 contactos de escalamiento (jefe de tráfico nivel 1, jefe de flota
nivel 2, por terminal).

**Se enseña (en este orden)**
1. **Lo normal:** un viaje cualquiera de la lista: los hitos se **validan por ubicación** (el GPS dice que llegó a la
   geocerca de la planta) o por lo que dijo el chofer **conciliado contra el GPS**. Nadie capturó nada.
2. **«Ya llegué» sin GPS que lo respalde — `INN-24005`** (tracto `IN-005`, Silao → CEDIS Apodaca Norte, 735 km): el
   operador escribió «Ya llegué a descargar, estoy en la puerta», pero la posición del tractor está **a cientos de km**
   de la planta. El hito queda **recibido, no validado** y aparece en la cola de excepciones. *(Hay 6 de estos:
   `INN-24005`, `24032`, `24059`, `24086`, `24113`, `24140`.)*
3. **Sin señal de vida — `INN-24023`** (tracto `IN-023`, Silao → Planta Química SLP): el GPS dejó de reportar hace más
   de 100 minutos; el hito pendiente está **escalado** al **jefe de tráfico**. `INN-24046`, `24092` y `24138` van a
   **nivel 2 (jefe de flota)**. *(Los 6: `24023`, `24046`, `24069`, `24092`, `24115`, `24138`.)*
4. **Sitios:** el catálogo de geocercas (patios, plantas, andenes). Se muestra que **4 de 17 son polígonos** en su
   sistema y aquí se aproximan por el círculo que los contiene (declarado).
5. **Las instrucciones por convenio** *(solo si ya está integrada la rama de convenios)*: al despachar y al acercarse a
   la planta, el operador recibe «qué puerta, con quién reportarse, peculiaridades»; puede preguntar «¿por dónde
   entro?». Se muestra el convenio de un cliente con sus 6 instrucciones.

**Qué decir**
- «**El operador no puede decir “ya llegué” si el GPS dice que no.** Eso es lo que hoy captura alguien en el sistema.»
- «Los avisos escalan en dos niveles (botones: “sí, estoy”, “voy a cargar”, “estoy bien” → “si no contestas aviso al jefe
  de flota” → jefe de tráfico) y los tiempos son configurables.»
- «El objetivo: que supervisores y despachadores **dejen de capturar y pasen a ser consultivos**. Lo medimos con la
  cuenta de horas de captura que nos den.»

**Si depende de un tercero**
- **Plantillas de Meta:** los avisos con botones fuera de la ventana de 24 h necesitan **plantillas aprobadas (2 a 5
  días hábiles)**. «Las mandamos a aprobación en cuanto el número esté verificado; para hoy los avisos se ven como
  registro, no se envían.»
- **GPS real:** ver sección 1.
- **Geocercas reales:** el catálogo es suyo; las nuestras son de muestra.

**No prometer:** que el sistema valida con la **foto** del sello o con polígonos exactos sin haberlo probado con sus
geocercas reales.

---

## 3. Vigía — servicio al cliente por WhatsApp (10 min)

**Pantalla:** `/dashboard/agentes/vigia` («Cola de aprobación», «Excepciones», «Conversaciones activas», «Sin respuesta
(SLA 10 min)», «Molestos o escalados»).

**Datos sembrados:** 3 clientes críticos con su conversación; **modo copiloto** (el agente sugiere, una persona envía);
SLA de 10 min y escalamiento a los 30.

**Se enseña**
1. **Autopartes Ficticias del Bajío — 14 min sin respuesta** (SLA 10): el cliente escribió «¿Ya salió la unidad de las
   6? Nadie me contesta». La conversación está **escalada a gerencia**, y el agente dejó un **borrador** («su unidad va en
   tránsito; reviso la ubicación y le confirmo la hora…») **pendiente de aprobación**: ve el borrador, lo edita y lo
   envía una persona.
2. **Armadora Ficticia Ramos Arizpe — cliente molesto** («esto es inaceptable»): clasificado como queja, riesgo alto,
   **nivel 2**.
3. **Cervecería Ficticia del Norte — atendida a tiempo.**
4. **El histórico exportado** *(importador en la rama del Vigía)*: los 3 grupos de ~30 días de muestra → preguntas
   frecuentes por tema y tendencias. Con los chats de muestra:

| Grupo | Mensajes | Preguntas | Respuestas >10 min | Quejas | Temas más frecuentes |
|---|---|---|---|---|---|
| Autopartes (iOS) | 214 | 104 | 21 | 11 | placas 22 · ETA 22 · documentos 17 · ubicación 17 |
| Armadora (Android) | 235 | 111 | 24 | 20 | documentos 26 · ETA 20 · queja 20 · ubicación 17 |
| Cervecería (iOS, .zip) | 214 | 103 | 21 | 8 | placas 26 · citas 20 · documentos 20 · ETA 19 |

*(Son conteos del chat sintético, generado para probar el importador; no son estadística de Innovativos.)*

**Qué decir**
- «Se avisa a gerentes y directores cuando un cliente lleva **más de 10 minutos sin respuesta** o está molesto.
  Eso es esto: umbral configurable, y escala a una persona.»
- «Con su histórico exportado salen **las preguntas que más se repiten y a qué hora se
  queda sin respuesta el grupo**.»

**Si depende de un tercero — el punto más delicado del demo**
- **Sus grupos viven en WhatsApp de teléfonos comunes y la API de Business NO lee esos grupos.** Se dice de frente:
  «**Fase 1 = histórico exportado** (FAQs, tendencias, respuestas sugeridas) y **modo copiloto**: el agente sugiere y
  una persona envía. **En vivo solo si los grupos críticos pasan a un número de WhatsApp Business**; estamos
  verificando con Meta qué permite la API de grupos y con qué límites, **antes de prometerlo**.»
- **Histórico real:** lo entrega el cliente; si no llega, se usa el de muestra y se dice.

**No prometer:** lectura en vivo de sus grupos actuales; envío automático sin aprobación.

---

## 4. Peajes — pases × GPS × geocercas (8 min)

**Pantalla:** `/dashboard/agentes/peajes` y `/dashboard/agentes/peajes/configuracion`.

**Datos sembrados:** 12 casetas «Demo», 250 TAG, **379 cruces de las últimas 24 h** con sus posiciones GPS; **9 cruces
fuera de ruta** y **4 cobros duplicados** sembrados a propósito (lista exacta en `archivos-muestra/peajes/
anomalias_sembradas.csv`); 7 cruces sin dato de GPS (unidades silenciosas).

**Se enseña**
1. **Modo en vivo (recomendado si el archivo real ya llegó, o para mostrar que no hay magia):** `vaciar-sintetico.sh
   pases`, cargar en configuración `casetas_catalogo.csv` y `tags_unidades.csv`, y subir `pases_24h.csv` en «Subir
   estado de cuenta / desglose del proveedor». El sistema lee el archivo, **dice lo que se saltó** y corre el cruce (las tres cubetas y, donde hay TAG, catálogo de casetas y posiciones, la evidencia de GPS de cada línea).
2. **Modo precargado:** las 379 líneas ya están; se abre una anomalía, por ejemplo **`INN-24091` (tracto `IN-091`)**:
   le cobraron en *Caseta Demo Encarnacion* a las 02:36 y el GPS del tractor estaba **a cientos de km** de esa caseta.
   Es evidencia para pedir el descuento. El **cobro duplicado** de `IN-123` (dos cobros en la misma caseta con 2 min de
   diferencia, con el tractor presente) es otro tipo de reclamación.
3. **Honestidad del cruce:** un cruce solo se marca «no coincide» con datos suficientes (dos posiciones que envuelven el
   instante); si no hay GPS, queda **sin datos**, no «sospechoso». Un «no coincide» **no es una acusación**: puede ser un
   TAG prestado o un reloj del proveedor desfasado.

**Qué decir**
- «Hoy el reporte para el proveedor se arma a mano. Aquí sale **el cruce con evidencia** (caseta, hora, dónde estaba el
  tractor) y usted decide qué reclama.»
- «Las 379 líneas dan el mismo veredicto que nuestro motor de cruce (lo comprobamos línea por línea).»

**Si depende de un tercero**
- **El archivo real de PASE:** hoy el lector es tolerante con los formatos típicos (IAVE/PASE/TeleVía), pero «el
  formato real no lo hemos visto». «Si trae otras columnas, **es una línea de configuración**, no una versión nueva.»
- **TAG y catálogo de casetas con coordenadas:** sin ellos no hay cruce con GPS; hay que pedirlos junto con el archivo.
- **El reporte de reclamación** (PDF/Excel listo para el proveedor) lo construye `w3-agentes-1-4`: **confirmar su estado
  en el ensayo** antes de enseñarlo.

---

## 5. Liquidación fase 1 — solo entregar el pago (7 min)

**Pantalla:** `/dashboard/agentes/liquidacion` (liquidaciones externas).

**Datos sembrados:** 158 liquidaciones «de su sistema» (folios `SAP-LIQ-DEMO-…`): 116 **acusadas** (8 con **«No
coincide»**), 34 **enviadas**, 8 **fallidas**; ninguna pendiente (nada sale de verdad).

**Se enseña**
1. **Qué manda su sistema:** el cuerpo de `POST /api/v1/liquidaciones-externas` (`post_liquidacion_externa.ejemplo.json`):
   folio de SAP, operador, viajes, periodo, renglones y total. **Likida no recalcula**; solo verifica que el total sea la
   suma de **sus** renglones (si no cuadra, no se entrega).
2. **El formato de liquidación:** el Excel que hoy copian y pegan (`formato_liquidacion_muestra.xlsx` es un layout de muestra) → el
   operador lo recibe como **PDF/Excel por WhatsApp**, y el jefe de flota recibe copia.
3. **Discrepancias:** una liquidación con **«No coincide»** (por ejemplo `SAP-LIQ-DEMO-0055-261015`, 4,006.36) es lo que el
   chofer rechazó; se **escala a una persona** (liquidación / jefe de flota), no se discute por WhatsApp.

**Qué decir**
- «Fase 1 es **solo entregar**: ustedes calculan, nosotros lo ponemos en la mano del operador en su formato y le
  avisamos a la oficina si algo no coincide. **Facturas son la fase 2** y **no incluye OCR de tickets**.»

**Si depende de un tercero**
- **El formato real:** hasta ver su Excel no hay plantilla definitiva. «Cada flota configura su plantilla a
  partir de su archivo de muestra.» *(La plantilla configurable la construye `w3-agentes-1-4`: confirmar en el ensayo.)*
- **Plantillas de Meta:** fuera de la ventana de 24 h el envío necesita plantilla aprobada (2 a 5 días hábiles).
  Las 8 «fallidas» sembradas son justo ese caso (**«plantilla aún no aprobada»**): úsenlo como ejemplo, no como error.

**No prometer:** que el chofer reciba el PDF por WhatsApp el día del demo (depende de número verificado y plantilla aprobada).

---

## 6. Carta Porte — multi-formato sin copiar y pegar (8 min)

**Pantalla:** `/dashboard/carta-porte/documentos` (bandeja de revisión) y la exportación por mapeo.

**Datos sembrados:** 12 documentos de 3 clientes ficticios (PDF, Excel, CSV): **6 aprobados, 5 por revisar, 1
rechazado**; 3 perfiles (mapeos); un formato de exportación **sintético**.

**Se enseña**
1. **Un documento aprobado** (`orden_c05_1.pdf`): lo que se leyó, **de dónde** (la evidencia del documento) y con qué
   **confianza** por campo. Las **dudas** (`orden_c05_3`: código postal de destino con confianza baja) se marcan y
   van a una persona del equipo.
2. **El perfil del cliente:** la primera vez lo lee el modelo y un humano corrige; lo aprobado **enseña el mapeo** y la
   siguiente vez del mismo formato se reaplica **sin modelo** (más barato, más confiable).
3. **El documento con instrucciones escondidas** (`orden_c12_4`, «IGNORA LAS INSTRUCCIONES ANTERIORES…»): el sistema lo
   **detecta, no obedece** y lo manda a revisión humana.
4. **Salida a su sistema:** la exportación con el mapeo declarado → un CSV con las columnas de carga (sintéticas) que
   Excel abre; **cuando llegue su formato real, se carga como configuración**.

**Qué decir**
- «Cada cliente manda **su** formato. El perfil por cliente es lo que hace que
  esto escale **sin reprogramar**.»
- «**La IA no decide los temas delicados:** lo dudoso va al equipo.»

**Si depende de un tercero**
- **Documentos reales de 3 a 5 clientes grandes y su Excel/sistema de carga :** hasta entonces la exactitud que
  se muestra es la de documentos de **muestra**; la exactitud real se mide con sus documentos.
- **Costo de modelo:** una carga **en vivo** de un documento nuevo llama a un modelo (costo mínimo por documento);
  en el demo se usan los **precargados** salvo que se autorice el gasto.
- **Destino `.xlsx` nativo:** el contrato actual exporta `csv|json`; si su sistema exige otra cosa, se decide al ver el
  formato.

---

## 7. Cierre — el orquestador, de vuelta (5 min)

**Pantalla:** `/dashboard/chat`.

**Se enseña (preguntas de ejemplo; **probarlas todas en el ensayo** y quitar las que hoy no respondan bien):**
- «¿Dónde va el viaje `INN-24005` y por qué está en excepciones?»
- «¿Qué clientes llevan más de 10 minutos sin respuesta?»
- «¿Qué liquidaciones tienen discrepancia y de quién?»
- «¿Qué cruces de peaje no cuadran con el GPS?»

**Qué decir**
- «Una sola pestaña con **toda la información** (SAP, GPS, WhatsApp) para preguntar de liquidación o supervisión. **No
  decide** lo delicado: lo escala a la persona (mesa de control, liquidación). Si un agente falla, **avisa**.»

**Honestidad:** la lectura de las fuentes nuevas (GPS propio, convenios, Vigía) y el **tablero de viajes en vivo** son
trabajo de la Ola 3 (`w3-agentes-1-4`); lo que no responda el día del ensayo **no se enseña**.

---

## 8. Cuando algo depende de un tercero — frases listas

| Tercero | Qué falta | Qué decir (verdad) | Fecha / responsable |
|---|---|---|---|
| **Meta (WhatsApp)** | Número verificado y plantillas aprobadas | «Los avisos con botones fuera de 24 h necesitan plantilla aprobada por Meta (2 a 5 días hábiles). Las mandamos en cuanto haya número; hoy ven el registro de lo que se enviaría.» | Likida, al verificar el número |
| **GPS real** | Vista de solo lectura a su tabla y a sus geocercas | «Hoy es simulado con las columnas de su tabla; al conectar cambia la fuente, no la pantalla. Pedimos un usuario de solo lectura sobre una vista o réplica, nunca producción.» | Sistemas del cliente |
| **WhatsApp, grupos** | Que los grupos críticos migren a Business, o seguir en copiloto | «La API de Business no lee los grupos de un teléfono común. Fase 1: histórico exportado + copiloto. En vivo solo con grupos en Business, y lo verificamos con Meta antes de prometerlo.» | El cliente (histórico) · Likida (API de grupos) |
| **Archivo de pases** | El archivo real de PASE, TAG y casetas con coordenadas | «El lector es tolerante; si trae columnas nuevas es una línea de configuración. Sin TAG ni coordenadas de casetas no hay cruce con GPS.» | El cliente |
| **Liquidación** | Su Excel de liquidación | «La plantilla se arma de su archivo de muestra; hoy ven un layout de ejemplo.» | El cliente |
| **Carta Porte** | Documentos reales y su Excel/sistema de carga | «La exactitud real se mide con sus documentos; hoy ven documentos de muestra.» | El cliente |
| **«Calle de instrucciones»** | Saber si vive en su sistema o en la app del operador | «Podemos mandarla por WhatsApp y también exportarla para que se escriba en su sistema; hay que confirmar cuál prefieren.» | Por confirmar con el cliente |

## 9. Preguntas probables y cómo contestarlas

- **«¿Quién se hace responsable si el agente se equivoca?»** → Los temas delicados **escalan a una persona**; el
  operador no puede cerrar un hito que el GPS contradice; las liquidaciones no se recalculan.
- **«¿Leen mis grupos de WhatsApp hoy?»** → No en vivo (ver sección 3). Histórico exportado + copiloto.
- **«¿Y si cambio de proveedor de GPS?»** → La lectura es por contrato (`LectorTablaPropia`) además de los lectores de
  proveedor; cambiar la fuente no cambia las pantallas.
- **«¿Mis datos están seguros?»** → Acceso de **solo lectura** con usuario restringido; el demo corre en base local y
  sintética; nada va a producción sin su autorización.

## 10. Si algo falla durante el demo

1. Pantalla vacía: las posiciones y los viajes se calculan contra la ancla del demo; si el reloj del equipo no coincide,
   `sembrar.sh --reiniciar --ancla '<hoy 09:00 -06>'` (≈ 10 s).
2. Una pantalla no abre: usar las **capturas del ensayo** y los archivos de `archivos-muestra/` para mostrar el dato.
3. Un envío «no sale»: es lo esperado (no hay número ni plantillas); no reintentar delante de ellos.
4. Cualquier cifra que no se pueda explicar: **no se defiende**; se anota y se contesta por escrito. La regla del
   producto es **nunca inventar una cifra**.
