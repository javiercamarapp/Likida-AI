# Demo sintético «Innovativos (demo)» y kit de carga

Objetivo: **demo de los 5 primeros agentes sobre datos con la forma de los de un cliente de ~250 tractos**. Este documento tiene dos mitades:

1. **El demo sintético** — un tenant «Innovativos (demo)» que se siembra con un comando, en una base **local**
   (nunca producción), con datos coherentes con su operación. Sirve para ensayar y para presentar mientras los
   archivos reales no llegan.
2. **El kit de carga** — archivo por archivo: cómo reemplazar cada dato sintético por **su** archivo real cuando llegue:
   formato esperado, importador que lo consume, validación y cómo verlo en pantalla.

El guion de lo que se enseña y se dice (y de lo que **no** se puede enseñar todavía) está en
[`guion-innovativos-20oct.md`](./guion-innovativos-20oct.md).

> **Todo lo sembrado es sintético.** Empresas con la palabra «Ficticia/o», RFC, placas, TAG y casetas «Demo» inventados.
> **Los teléfonos llevan la marca `28999…`** (código de país 289: sin asignar, no es de nadie; también el de la copia al
> jefe y los de discrepancia) y el envío real de WhatsApp rechaza cualquier destinatario con esa marca antes de llamar a
> Meta. El repo es público: nada aquí es dato real de ningún cliente. Lo que no existe todavía (formato real de su Excel,
> archivo real de PASE, su tabla de GPS) está **declarado como bloqueo**, no adivinado. **El Vigía y el Conductor del
> tenant demo vienen APAGADOS** (ningún cron les escribe a nadie), igual que el barrido de «sin señal de vida» y los
> avisos del orquestador; el Vigía y el Conductor se encienden a propósito con `--encender-agentes`.

---

## 1. Levantarlo

Necesitas Postgres local (`psql`) y las migraciones aplicadas **hasta la 0652** (el seed usa las tablas de la 0484, 0564/0645, 0630, 0635–0637, 0640, 0643, 0647 y 0650). Dos caminos:

**A. Postgres propio (el que se usó para probar todo esto).**

```bash
createdb likida_demo
psql -d likida_demo -v ON_ERROR_STOP=1 -q -f supabase/pruebas-aislamiento/andamio_ci.sql
for f in supabase/migrations/*.sql; do
  # la 0332 necesita sus índices creados antes, fuera de transacción
  [ "$(basename "$f")" = "0332_db_retencion_producto.sql" ] && psql -d likida_demo -v ON_ERROR_STOP=1 -q -f scripts/ci/0335_preflight_retencion_indices.sql
  psql -d likida_demo -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "FALLÓ $f"; break; }
done
```

**B. Pila local de Supabase (necesaria para VER las pantallas, ver §6).** `CI=true node scripts/ci/e2e/iniciar-pila.mjs`
(Docker). La base queda en `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

Sembrar (idempotente: correrlo dos veces no duplica nada):

```bash
export DEMO_DATABASE_URL='postgresql:///likida_demo'        # o la de la pila local
bash scripts/demo/innovativos/sembrar.sh                     # ancla del demo: 2026-10-20 09:00 CDMX
bash scripts/demo/innovativos/sembrar.sh --reiniciar         # borra el tenant demo y siembra de cero
bash scripts/demo/innovativos/sembrar.sh --reiniciar --ancla '2026-10-20 08:00:00-06'   # otro «ahora» (EXIGE --reiniciar)
bash scripts/demo/innovativos/sembrar.sh --solo-limpiar      # solo borra
bash scripts/demo/innovativos/sembrar.sh --encender-agentes  # enciende el Vigía y el Conductor del tenant demo
```

`sembrar.sh` corre tres pasos: `sembrar.sql` (los datos), `generar-veredictos.mjs` (el motor real del Conductor) y
`sembrar-importadores.mjs`, que pasa las muestras por los **importadores reales** y guarda lo que producen: el formato de
liquidación de la flota derivado del Excel de muestra (con los teléfonos de copia y de discrepancia `28999…`), los 3 grupos
críticos del Vigía con su histórico leído por el lector del Vigía y las respuestas rápidas aprobadas que salen de las FAQs
del análisis. Si un importador cambia, lo sembrado cambia con él.

`--ancla` sin `--reiniciar` **falla** con un mensaje claro: sembrar encima de una base con otra ancla mezclaría dos
«ahora» (viajes, posiciones y pases a medias). El SQL lo vuelve a comprobar (`innovativos_sim.meta` guarda la ancla
sembrada).

**Guardas (no se negocian):** exige `DEMO_DATABASE_URL` explícita (no usa `DATABASE_URL` ni `SUPABASE_DB_URL` a
propósito). `guarda-host.mjs` (una sola implementación, la usan todos los scripts) solo acepta socket, `localhost`,
`127.x`, `[::1]` y `host.docker.internal`, y rechaza **cualquier** `?host=`, `?hostaddr=` o `?service=`, `PGHOSTADDR` /
`PGSERVICE`, dominios (`localhost.evil.com`, `127.0.0.1.nip.io`), IPs escritas en decimal/hex/abreviadas, IPv6 mapeado,
listas de hosts, IPs públicas, link-local, CGNAT, Supabase/Neon/nubes y bases cuyo nombre contenga «prod» (un túnel a
producción se ve como localhost). **Las redes privadas (10/8, 172.16/12, 192.168/16) se rechazan salvo
`DEMO_PERMITIR_RED_PRIVADA=1`** (valor exacto): ahí viven las bases de producción detrás de una VPN o un pooler. El
propio SQL repite la comprobación sobre la dirección real del servidor. `guardas_host.test.ts` tiene una prueba por
cada bypass y comprueba, con un `psql` de mentira, que los scripts cortan **antes** de abrir una conexión.

**Todo cuelga de una ancla.** «Ahora» del demo es `2026-10-20 09:00 -06`: los viajes «en curso», las posiciones de las
últimas 24 h, los pases y los avisos pendientes se calculan contra ella, por eso dos corridas dan exactamente las mismas
filas. Para ensayar en otro día se pasa `--reiniciar --ancla '…'`.

Probar que no duplica (4 corridas: sembrar, sembrar, `--reiniciar`, vaciar-todo + sembrar): compara, de **36 tablas**,
el conteo y la huella md5 de la **fila completa** (`to_jsonb`, sin marcas de reloj), así que una columna que se pierde
(p. ej. `viaje.origen_geocerca_id` tras borrar las geocercas) cambia la huella. **Falla si alguna tabla tiene 0 filas**,
si algún viaje queda sin origen/destino, si algún teléfono del tenant demo no lleva la marca `28999`, si el Vigía o el
Conductor (o su barrido de «sin señal de vida») quedaron encendidos, si queda un aviso o una liquidación con salida pendiente,
si falta la copia o la discrepancia sembradas, o si el rol de solo lectura no es rechazado por permisos:

```bash
bash scripts/demo/innovativos/probar-idempotencia.sh      # termina con «IDEMPOTENCIA OK»
bash scripts/demo/innovativos/probar-vaciar-solo-sembrado.sh   # vaciar-sintetico.sh no toca lo «real» ya cargado
node scripts/demo/innovativos/verificar-cruces-con-motor.mjs   # falla con 0 líneas
node scripts/demo/innovativos/verificar-hechos-del-guion.mjs   # cada cifra y folio de los documentos, contra la base
```

**Los veredictos de ubicación no se escriben a mano:** `generar-veredictos.mjs` (lo corre `sembrar.sh`) ejecuta el motor
real del Conductor (`validarHitoContraSitio`) sobre los hitos de llegada de los viajes en curso y escribe
`viaje_hito_validacion`. Falla si los `sin_coincidencia` no son exactamente los viajes sembrados como «ya llegué» sin
GPS.

## 2. Qué hay sembrado

| Entidad | Filas | Nota |
|---|---|---|
| Terminales | 3 | Tlaquepaque, Silao, Apodaca |
| Tractos (`unidad`) | 250 | `IN-001`…`IN-250`; 140 en ruta, 12 en taller, 98 disponibles; TAG `PSD…` y dispositivo GPS `INN-GPS-…` |
| Operadores | 262 | 250 emparejados con tracto + 12 de relevo; teléfonos `289992…` (marca de demo); un operador por viaje abierto |
| Clientes | 14 | «… Ficticia …»; cada uno con planta y andén como geocercas |
| Geocercas | 31 | 3 patios + 14 plantas + 14 andenes (hijas de su planta); **5 con polígono nativo** (4 plantas y el patio alargado de Tlaquepaque) y el círculo que lo contiene de respaldo |
| Viajes | 140 en curso + 266 cerrados (7 días) | folios `INN-24001…` (en curso) y `INN-23001…` (cerrados) |
| Hitos del conductor | 1,465 | llegó a cargar / salió / llegó a descargar / salió; validados por GPS, por texto del chofer o **detectados por geocerca (fuente «sistema»)** |
| Cruces de geocerca | 14 | de 7 viajes: la llegada y la salida de carga que el barrido de GPS dio por hechas sin mensaje del chofer |
| Veredictos de ubicación | 157 | uno por hito de llegada ya registrado de un viaje en curso, **calculado por el motor real** (151 validados, 6 sin coincidencia) |
| Señal de vida | 6 episodios | uno por viaje de «silencio», en la escalera aviso 1 → aviso 2 → jefe de tráfico; el barrido nace apagado |
| Posiciones GPS | 41,770 (×2) | en **su tabla propia simulada** (`innovativos_sim.gps_posicion`) y ya leídas en `posicion` |
| Casetas / TAG | 12 / 250 | catálogo sintético «Demo» sobre el eje GDL–APO |
| Líneas de pase (24 h) | 381 | 9 **fuera de ruta**, 4 **cobros duplicados**, 7 sin GPS (unidad silenciosa) y 2 de tractos sin viaje **junto al patio poligonal** |
| Reporte de reclamación | 14 reclamables por $9,635 | 9 GPS lejos de la caseta, 4 doble cobro y 1 unidad en zona no autorizada (polígono); el cruce de la carretera de junto **no** se reclama |
| Liquidaciones «de su sistema» | 158 | 116 acusadas (8 con «No coincide»), 34 enviadas, 8 fallidas; ninguna pendiente |
| Formato de liquidación | 1 | derivado del Excel de muestra por el derivador real; copia al jefe de flota (1 teléfono) y aviso de discrepancia (2 teléfonos), todos `28999…` |
| Avisos de discrepancia | 8 (6 entregados, 2 fallidos) | los 2 fallidos muestran «El aviso no llegó» y **Reavisar**; cada uno con su tarea en la cola del orquestador (8: 3 atendidas, 5 abiertas) |
| Carta Porte | 14 documentos, 3 perfiles | PDF / Excel / CSV de 3 clientes; aprobados, por revisar, rechazado, uno con **inyección**, uno **recibido** y uno **fallido** (5 intentos) |
| Vigía | 3 contactos críticos, 3 conversaciones, 6 mensajes | una a >10 min sin respuesta, una molesta, una atendida; **agente apagado** (`habilitado = false`) |
| Grupos críticos e histórico | 3 grupos, 642 mensajes | los 3 chats de muestra leídos por el importador real; 2 respuestas rápidas aprobadas de las FAQs |
| Escalamiento | 6 contactos | jefe de tráfico (nivel 1) y jefe de flota (nivel 2) por terminal; Conductor **apagado** (`activo = false`) |
| Convenios | 14 con 84 instrucciones de operación | en `cliente_convenio`/`convenio_instruccion`/`convenio_comercial` (0580) y copia en `innovativos_sim.convenio*` |

**Escenarios sembrados a propósito** (los que el guion enseña; todos reproducibles porque son deterministas):

- **El GPS lo detectó, el chofer no escribió** — 7 viajes: `INN-24007`, `INN-24026`, `INN-24045`, `INN-24064`,
  `INN-24083`, `INN-24102`, `INN-24121`. La llegada y la salida de carga tienen fuente `sistema`, validadas por GPS, sin
  texto ni pin, y una fila en `viaje_cruce_geocerca` (el candado de «una detección por viaje y hito»).
- **«Ya llegué» sin GPS que lo respalde** — 6 viajes: `INN-24005`, `INN-24032`, `INN-24059`, `INN-24086`, `INN-24113`,
  `INN-24140`. El hito `llegada_descarga` entra por texto y queda **recibido** (no validado); el seed le pone la posición
  REAL del tractor (a 23–342 km de la planta) y el motor de validación del Conductor emite el veredicto
  **sin coincidencia** (`generar-veredictos.mjs`). Eso es lo que alimenta la «Cola de excepciones» del tablero.
- **Sin señal de vida** — 6 viajes: `INN-24023`, `INN-24046`, `INN-24069`, `INN-24092`, `INN-24115`, `INN-24138`. El
  GPS dejó de reportar hace >100 min y el hito pendiente está **escalado** (3 a nivel 1, 3 a nivel 2). Cada uno lleva
  además su episodio de señal de vida: aviso 1 enviado (`INN-24115`), aviso 2 enviado (`INN-24069`), escalado al jefe sin
  atender (`INN-24046`, `INN-24092`), atendido por el jefe (`INN-24138`) y respondido por el chofer (`INN-24023`). El seed
  deja el estado como lo dejaría el cron `conductor-hitos`; el aviso en sí NO se manda (agente apagado, barrido apagado,
  teléfonos de demo).
- **Peajes**: la verdad sembrada está en `archivos-muestra/peajes/anomalias_sembradas.csv` (13 líneas: fuera de ruta y
  duplicados, con TAG, caseta y hora). `verificar-cruces-con-motor.mjs` comprueba que el motor real de cruce
  (`evaluarCruceGps`) da el mismo veredicto en las **381** líneas, y `verificar-hechos-del-guion.mjs` corre la función real
  del reporte (`construirReclamacion`) sobre ellas. Las 2 líneas del patio poligonal: `IN-141` estacionado dentro (se
  reclama, confianza alta) e `IN-142` por la carretera de junto, dentro del círculo y fuera del polígono (no se reclama).
- **Liquidación**: 8 liquidaciones acusadas con «No coincide» (el chofer apretó ese botón): 6 con el aviso a la oficina
  entregado y 2 con el aviso fallido (plantilla no aprobada), que son las que ofrecen **Reavisar**.
- **Carta Porte**: `orden_c12_4` trae una instrucción dentro del documento («IGNORA LAS INSTRUCCIONES…»). El documento
  sembrado YA viene marcado con riesgo (lo escribe el seed); lo que sí se verifica de verdad es que el detector real
  (`detectarInyeccion`) marca el archivo de muestra (`verificar-hechos-del-guion.mjs`). Los valores, confianzas y la
  «evidencia» de los documentos leídos son **dato de demo**, no salida de un modelo; `sha256` y tamaño son inventados (el
  archivo vive en `archivos-muestra/`, no en Storage). Las huellas del worker: `orden_c05_3` ya avisó a la oficina por
  sus dudas, `orden_c05_5` está recibido y `orden_c05_6` agotó sus intentos (`avisos_oficina`).

## 3. El kit de carga

Cada fila es un archivo que entrega el cliente. **La columna «Importador» dice cuál es el importador del producto que lo
lee: los nueve están integrados (`existe`) y son los que usa `validar-archivo.mjs`.** La prueba
`muestras_importadores_reales.test.ts` pasa cada muestra por ese importador y la compara con lo que el generador escribió.

| Archivo (id) | Muestra (`scripts/demo/innovativos/archivos-muestra/…`) | Importador | Se ve en |
|---|---|---|---|
| `gps_posiciones` | `gps/gps_posicion_muestra.csv`, `gps/gps_actual.csv` | **existe** — conector de tabla propia | `/dashboard/mapa`, `/dashboard/agentes/conductores` |
| `geocercas` | `gps/geocercas.csv` | **existe** — catálogo de sitios (0385/0630) | `/dashboard/agentes/conductores/sitios` |
| `pases` | `peajes/pases_24h.csv` | **existe** — ingesta de desglose de peaje | `/dashboard/agentes/peajes` |
| `tags` | `peajes/tags_unidades.csv` | **existe** — alta masiva de TAG | `/dashboard/agentes/peajes/configuracion` |
| `casetas` | `peajes/casetas_catalogo.csv` | **existe** — catálogo de casetas | `/dashboard/agentes/peajes/configuracion` |
| `liquidaciones` | `liquidacion/liquidaciones_sistema.csv`, `liquidacion/formato_liquidacion_muestra.xlsx` | **existe** — `POST /api/v1/liquidaciones-externas` y formato de la flota | `/dashboard/agentes/liquidacion` |
| `convenios` | `convenios/convenios.csv` | **existe** — importador de convenios (0580) | `/dashboard/convenios` y el mensaje de despacho |
| `whatsapp` | `whatsapp/grupo_afb_silao_ios.txt`, `…_android.txt`, `….zip` | **existe** — lector del histórico del Vigía | `/dashboard/agentes/vigia/historial` |
| `carta_porte` | `carta_porte/orden_c05_1.pdf`, `…c10_1.xlsx`, `…c12_1.csv` | **existe** — bandeja multi-formato y su worker | `/dashboard/carta-porte/documentos` |

> `catalogo_kit.ts` (`src/lib/likida/demo_innovativos/`) es esta misma tabla en forma legible por máquina; una prueba
> exige que cada fila exista en el código **y** aquí, y que cada muestra exista en el repo.

### 3.0 Los tres pasos de cualquier archivo

1. **Validar** (no escribe nada, no toca red):
   `node scripts/demo/innovativos/validar-archivo.mjs <tipo> <ruta-al-archivo>` — dice cuántas filas entran, cuáles se
   rechazan y por qué. Sale 0 si se puede cargar tal cual, 1 si hay problemas. Donde el importador real existe usa
   **su** lector (pases, TAG, casetas, sitios, esquema de liquidación), no una copia.
2. **Quitar el dato sintético** de ese conjunto:
   `bash scripts/demo/innovativos/vaciar-sintetico.sh <gps|geocercas|pases|liquidaciones|cartaporte|vigia|convenios|todo>`
   (solo toca el tenant demo y solo lo sembrado por el demo; re-sembrar lo deja idéntico).
3. **Cargar el real** por el importador de la tabla y abrir la pantalla de la última columna.

Para tener a mano cómo se ven los archivos tal como los exportaría «su sistema»:
`node scripts/demo/innovativos/exportar-archivos.mjs` (determinista; regenera `archivos-muestra/` desde la misma base).

### 3.1 GPS: posiciones de **su tabla** (`gps_posiciones`)

- **Qué se necesita:** las posiciones de todos los GPS al momento, desde las tablas propias del cliente.
- **Qué pedir (especificación para el equipo de sistemas):** una **vista o réplica de solo lectura** con un usuario
  restringido —nunca la base de producción— con las columnas `unidad`, `lat`, `lon`, `fecha_hora`, `velocidad`,
  `ignición`. Entrega por **CSV en una dirección https** o por un **endpoint JSON**: los dos ya funcionan.
- **Formato esperado** (la muestra lo simula, con **dos rarezas a propósito** porque lo real las traerá):
  `id_unidad,latitud,longitud,fecha_hora,velocidad_kmh,ignicion` donde `fecha_hora` es **hora local de CDMX sin zona** y la
  unidad es su **número económico** («IN-001»).
- **Importador:** existe — `conectores/tabla_propia` (lector de CSV y de endpoint, asentador común de posiciones y el cron
  `gps`). Normaliza encabezados, convierte hora local a UTC con el desfase real de esa fecha, resuelve la unidad por
  económico, rechaza lat/lng intercambiadas sin «arreglarlas» y cuenta las unidades que Likida no tiene en vez de
  inventarlas. **Bloqueos declarados:** el modo **SQL de solo lectura** está escrito (SELECT único, `READ ONLY`, sin SSRF)
  pero necesita el controlador `pg`, que no está instalado (decisión pendiente); el **SFTP** necesita un cliente que
  tampoco está.
- **Validación:** `node scripts/demo/innovativos/validar-archivo.mjs gps_posiciones <archivo.csv>` (usa `leerPosicionesCsv`
  del conector; avisa de unidades sin lectura en los últimos 30 min del archivo y de columnas faltantes: velocidad,
  ignición).
- **Reemplazo:** `vaciar-sintetico.sh gps` borra `posicion` con proveedor `tabla_propia` del tenant demo (la tabla
  simulada `innovativos_sim` queda, es «su» tabla de prueba). Las posiciones del demo se sembraron directo en `posicion`:
  el día que su tabla se conecte cambia la fuente, no la pantalla.
- **Ver:** `/dashboard/mapa` (unidades con posición, «sin ubicar», escalados), `/dashboard/viajes-en-vivo` y el tablero
  del Conductor.

### 3.2 Geocercas (`geocercas`)

- **Formato:** `codigo,nombre,tipo (circulo|poligono),lat_centro,lon_centro,radio_m,poligono_wkt,cliente`. El WKT va
  **lon-lat**.
- **Importador:** existe — el catálogo de sitios del Conductor (tipos `cliente|planta|anden|patio|punto_interes`) por
  `geocercasASitios`. **Un polígono se guarda NATIVO** (sus vértices, 0630) y la decisión «¿está dentro?» la toma un helper
  único (`dentroDeGeocerca`) para el Conductor, los convenios y la reclamación de peajes; el catálogo conserva además el
  círculo que lo **contiene** (centro = promedio de vértices, radio = vértice más lejano, sin inflarlo). Solo un
  polígono que no se puede guardar (más de 500 vértices o sin área) entra como círculo **aproximado** y se reporta; con él
  la reclamación de peajes baja su confianza a «media». En la muestra, **5 de 17 son polígonos** y ninguno se aproxima.
- **Re-importación:** dentro del cron `gps` se re-importa una vez al día, de forma idempotente (misma huella = sin
  cambios) y **sin pisar** un sitio editado a mano (0632).
- **Validación:** `validar-archivo.mjs geocercas <archivo>` (cuántos polígonos nativos y cuántos entrarían al catálogo).
- **Ver:** `/dashboard/agentes/conductores/sitios`.

### 3.3 Pases de peaje, TAG y catálogo de casetas (`pases`, `tags`, `casetas`)

- **Qué se necesita:** cruzar el archivo de pases contra las posiciones GPS y las geocercas/«cursos» y sacar los cruces
  fuera de ruta para pedir descuento al proveedor.
- **Formato:** el **archivo real de PASE no se conoce** (bloqueo declarado). El lector es tolerante (encabezados
  `Fecha/Hora/Caseta/TAG/Importe`, fechas `dd/mm/aaaa`, serial de Excel, importes con `$` o coma decimal). La muestra:
  `Fecha,Hora,Caseta,TAG,Importe`. Aparte necesita **dos archivos más** sin los cuales no hay cruce con GPS:
  `tag;unidad;proveedor` (TAG de cada tracto) y `nombre;lat;lng;radio_m;alias;fuente` (casetas con coordenadas).
- **Importador:** existe (`peajes/ingesta.ts`, `peajes/desglose.ts`, `peajes/tags.ts`, `peajes/casetas.ts`,
  `peajes/cruce_gps.ts`). El **reporte de reclamación** (`peajes/reclamacion.ts`: los cruces con evidencia a favor de pedir
  la revisión, con el porqué y hasta 3 posiciones de GPS; Excel y PDF en `/api/export/peajes-reclamacion`) está
  integrado: motivos `gps_lejos_de_caseta`, `unidad_en_zona_no_autorizada` (con el **polígono** de patio o zona
  restringida; confianza «media» si la zona es solo un círculo aproximado) y `doble_cobro`. Los **cursos** (rutas
  autorizadas por unidad) **no existen todavía**: el reporte lo dice en sus leyendas.
- **Validación:** `validar-archivo.mjs pases|tags|casetas <archivo>`. Pruebas extra del demo:
  `verificar-cruces-con-motor.mjs` — las 381 líneas sembradas dan el mismo veredicto que el motor real — y
  `verificar-hechos-del-guion.mjs`, que corre `construirReclamacion` sobre ellas (14 reclamables por $9,635).
- **Reemplazo:** `vaciar-sintetico.sh pases` (desglose, líneas, TAG y casetas «Demo»).
- **Ver:** `/dashboard/agentes/peajes` (subir el desglose y ver las tres cubetas) y `/dashboard/agentes/peajes/configuracion`
  (TAG y casetas).

### 3.4 Liquidación fase 1 (`liquidaciones`)

- **Qué se necesita:** ellos calculan en su sistema; Likida **solo entrega** el pago al operador en su formato
  (el formato que hoy copian y pegan), con copia al jefe de flota y avisando las discrepancias. **No** incluye OCR de
  tickets. Facturas = fase 2.
- **Formato:** una fila por renglón: `clave_externa, numero_empleado, periodo_desde, periodo_hasta, folios_viaje (a|b),
  concepto_clave, concepto, tipo (percepcion|deduccion), monto, total_sistema, moneda`. El total del sistema **tiene que
  ser la suma de sus renglones** o no se entrega a ciegas.
- **Importador:** existe — `POST /api/v1/liquidaciones-externas` (validación estricta de la 0370).
  `cuerposDeLiquidacionesCsv` convierte su CSV a ese cuerpo; la muestra versiona un cuerpo de ejemplo
  (`liquidacion/post_liquidacion_externa.ejemplo.json`) y una prueba asegura que **los 40 cuerpos de la muestra pasan la
  validación real** del endpoint. Las fechas de Excel como número de serie también se leen.
- **El formato de la flota** (`liquidacion_externa/formato_flota.ts`, 0564/0645): se sube **su Excel de muestra** en
  `/dashboard/agentes/liquidacion/formato` y `derivarFormatoDeMatriz` deriva la plantilla (título, datos de encabezado,
  columnas y fila de total); lo que no reconoce **no se inventa**, queda en «sin mapear». La liquidación se entrega con ese
  aspecto en PDF o Excel. Los teléfonos de la **copia al jefe de flota** (hasta 3) y del **aviso de discrepancia** (hasta
  3) se capturan sin necesidad del Excel. **Falta (bloqueo declarado):** el formato real de su Excel y los teléfonos
  reales; hay un layout sintético en `liquidacion/formato_liquidacion_muestra.xlsx`.
- **Discrepancias** (0643–0645): cada «No coincide» abre una tarea para una persona en la cola del orquestador (0650) y un
  aviso a los designados con estado guardado (pendiente → enviando → enviado | fallido), reintento del cron
  `liquidaciones-externas` y el botón **Reavisar** en la pantalla; «No coincide» es atómico (dos entregas del mismo
  botón no duplican el aviso).
- **Validación:** `validar-archivo.mjs liquidaciones <archivo.csv>`.
- **Reemplazo:** `vaciar-sintetico.sh liquidaciones` (el formato de la flota y los teléfonos son configuración: no se
  borran).
- **Ver:** `/dashboard/agentes/liquidacion` (estados: enviada, acusada, «No coincide», fallida; rótulo del aviso y
  «Reavisar»).

### 3.5 Convenios e instrucciones de operación (`convenios`)

- **Qué se necesita:** todo nace de un convenio (de A a B, tarifa, instrucciones de cobro y de operación); al operador
  le llegan las instrucciones (qué puerta, con quién reportarse, peculiaridades).
- **Formato:** una fila por instrucción: `clave, cliente, convenio, origen, destino, categoria, momento, orden, texto,
  tarifa_modo, tarifa_precio, requisitos_cobro (a|b)`. Dominios cerrados de la 0580: categoría
  `puerta|reportarse|peculiaridad|documentos|horario|seguridad|otro`, momento `despacho|acercamiento|ambos`, texto ≤ 400.
- **Importador:** existe — `convenios/importador.ts` (0580: `cliente_convenio`, `convenio_instruccion`,
  `convenio_comercial`; la llave es (cliente, nombre del convenio) y re-subir el archivo no duplica: la lista de
  instrucciones del archivo reemplaza la del convenio; todo o nada: un solo problema y no se escribe nada). La tarifa y los
  requisitos de cobro son dinero: solo los importa quien ve finanzas, y la exportación para el sistema de la flota (la
  «calle de instrucciones») **no** los lleva. El seed carga los 14 convenios en esas tablas (y deja la copia en
  `innovativos_sim.convenio*`). Las instrucciones salen al despachar, en la primera asignación del viaje y al acercarse a
  la planta. El alta y la edición de un convenio en pantalla (sin volver a subir el archivo) **ya existen** (P7, migraciones 0656-0658; la tarifa y los requisitos de cobro siguen solo por importación).
- **Pregunta abierta:** la «calle de instrucciones» puede ser un campo de **su** sistema. El diseño
  debe poder mandar por WhatsApp y exportar para escribirse allá.
- **Validación:** `validar-archivo.mjs convenios <archivo.csv>` (avisa de convenios sin «reportarse»).
- **Reemplazo:** `vaciar-sintetico.sh convenios`.

### 3.6 Histórico de WhatsApp (`whatsapp`)

- **Riesgo declarado:** si los grupos del cliente viven en WhatsApp de teléfonos comunes, la API de Business **no lee esos grupos**.
  Fase 1 = **histórico exportado** (.txt/.zip) → FAQs, tendencias, respuestas sugeridas y modo copiloto (sugiere, humano
  envía). En vivo solo si los grupos críticos migran a un número Business (verificar la API de grupos de Meta **antes** de
  prometerlo).
- **Formato:** «Exportar chat» de WhatsApp: iOS `[20/09/2026, 14:32:10] Nombre: texto` (24 h o `a. m.`/`p. m.`) o Android
  `20/9/26 14:32 - Nombre: texto`; `.txt` o `.zip`. La muestra trae 3 grupos de ~30 días (iOS 24 h, Android, iOS 12 h en
  `.zip`), con preguntas frecuentes por tema, quejas, respuestas lentas (>10 min) y un teléfono y un correo dentro del
  texto para probar el tapado de datos personales. `whatsapp/resumen_esperado.json` trae los conteos con los que se
  generó; el lector real los lee con la taxonomía del producto («cita» es `cita_anden`, «documentos» del generador son
  `documentos` + `factura_pod` y «placas» cae en «otros»), y la prueba de muestras lo comprueba.
- **Importador:** existe — `vigia/historial` (`export_whatsapp.ts`, `zip_lector.ts`, `analisis.ts`) y la pantalla
  «Grupos e histórico». El autor **nunca se guarda en claro** (hash corto con sal de la flota), los teléfonos y correos
  del texto se tapan, subir dos veces el mismo archivo no duplica (huella sha256) y el equipo se declara por nombre. El
  análisis da preguntas frecuentes, tendencias por tema y tiempos de respuesta; las respuestas rápidas se aprueban de ahí.
- **Validación:** `validar-archivo.mjs whatsapp <archivo>` (usa el lector real; sin los nombres del equipo avisa que no
  puede medir tiempos de respuesta).
- **Reemplazo:** `vaciar-sintetico.sh vigia` (contactos, conversaciones y mensajes sembrados, más los grupos, el histórico
  y las respuestas rápidas sembrados).
- **Ver:** `/dashboard/agentes/vigia` y `/dashboard/agentes/vigia/historial`.

### 3.7 Carta Porte multi-formato (`carta_porte`)

- **Qué se necesita:** lo que manda el cliente (PDF/Excel) debe pasar **directo a su sistema/Excel de carga** sin copiar
  y pegar; dudas marcadas y enviadas al equipo; muchos clientes, cada uno con su formato.
- **Formato:** los documentos de **3 a 5 clientes grandes** (bloqueo declarado) y **su Excel o sistema destino**. La
  muestra trae un PDF con texto, un Excel y un CSV de tres clientes ficticios, y un CSV de **prueba de inyección**.
- **Importador:** existe — bandeja de Carta Porte (`carta_porte_docs/servicio.ts`): perfil por cliente-formato (mapeo
  declarativo que se aprende de lo aprobado por un humano) y exportación por mapeo (`cp_export_config`; csv, json o
  **.xlsx** nativo). El formato de exportación sembrado es **sintético** (CSV que abre Excel): se reemplaza cargando su
  mapeo real.
- **El worker** (`/api/cron/carta-porte-docs`, 0640–0642, cada 5 min): reclama con `cp_documento_reclamar` los documentos
  `recibido`, los de lease vencido y los de fallo reintentable, con espera creciente y **tope de 5 intentos** (después
  queda `fallido` terminal). Avisa a la oficina **una sola vez** por documento (el candado es `avisos_oficina`) cuando un
  documento que entró por correo trae hallazgos de bloqueo o confianza baja, y cuando agota sus intentos. Un techo de costo
  por flota no corta la pasada de las demás. **Bloqueos externos:** aplicar 0640–0642 en la base real, la plantilla Meta
  `aviso_operacion_v1` y el dominio/webhooks de Resend para el canal de correo. Un Excel con varios embarques lee el primero
  y avisa (**todavía no existe** la partición).
- **Validación:** `validar-archivo.mjs carta_porte <archivo>` (tipo real del archivo, contenido activo en PDF, escaneo sin
  texto).
- **Reemplazo:** `vaciar-sintetico.sh cartaporte`, y subir los documentos reales a la bandeja.
- **Ver:** `/dashboard/carta-porte/documentos` (bandeja de revisión, aprobados sin corrección, tiempo ahorrado).

## 4. Cuando llega un archivo real

| Qué llega | Qué se hace ese día |
|---|---|
| Especificación enviada al equipo de sistemas del cliente | §3.1 (columnas, solo lectura) y §3.3 (TAG y casetas) |
| Cualquier archivo del kit (§3) | `validar-archivo.mjs` → `vaciar-sintetico.sh` → cargar → abrir la pantalla |
| Antes del demo | Ensayo completo con el guion; `probar-idempotencia.sh`, `verificar-cruces-con-motor.mjs` y `verificar-hechos-del-guion.mjs` |

Si un archivo **no** llega a tiempo, el demo conserva el dato sintético de ese conjunto y el guion dice qué decir
(§ «Cuando algo depende de un tercero»). Nunca se mezcla un archivo real con sintético del mismo conjunto: `vaciar` primero.

## 5. Qué módulos del producto usa cada parte del demo

Todo está integrado en la misma rama: el demo no trae sustitutos de lo que el producto ya hace.

| Parte del demo | Módulo del producto que la lee o la calcula | Qué se siembra / se enseña |
|---|---|---|
| Posiciones y geocercas | `conectores/tabla_propia` (lector, asentador común, importador de geocercas con polígono nativo) | `posicion` y `geocerca` sembradas como las dejaría; la tabla simulada `innovativos_sim` es «su» tabla |
| Validación de llegada, hitos por geocerca y sin señal de vida | `conductor/validar_hito.ts`, `ciclo_gps.ts`, `senal_vida.ts` | veredictos del motor real; cruces y episodios sembrados con su estado |
| Convenios e instrucciones | `convenios/importador.ts`, envío al despachar, en la primera asignación y al acercarse | 14 convenios con 84 instrucciones en las tablas de la 0580 |
| Peajes y reclamación | `peajes/cruce_gps.ts`, `peajes/reclamacion.ts` (+ Excel y PDF) | 381 líneas, 14 reclamables, polígono de patio |
| Liquidación, formato de la flota, copia y discrepancias | `liquidacion_externa/formato_flota.ts`, `copia_jefe.ts`, `aviso_no_coincide.ts` | formato derivado de la muestra, teléfonos `28999…`, avisos entregados y fallidos |
| Vigía, grupos e histórico | `vigia/historial/*`, `vigia/respuestas_rapidas.ts` | 3 grupos críticos, 642 mensajes leídos por el importador, 2 respuestas rápidas |
| Carta Porte y su worker | `carta_porte_docs/*` y el cron `carta-porte-docs` | 14 documentos (uno recibido, uno agotado, uno con aviso por dudas) |
| Orquestador | `orquestador/*` (tablero en vivo, herramientas de solo lectura, tareas para una persona) | 8 tareas de diferencia de liquidación |

## 6. Cómo ver las pantallas (ruta prevista — **no ejecutada en esta ronda**)

El panel necesita Supabase completo (Auth + PostgREST), no solo Postgres, y el login es por enlace mágico. La ruta
prevista, sin tocar producción:

1. `CI=true node scripts/ci/e2e/iniciar-pila.mjs` (Docker) y `node scripts/ci/e2e/sembrar-e2e.mjs` (crea usuarios
   `*.e2e@likida.test`).
2. `DEMO_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' bash scripts/demo/innovativos/sembrar.sh`.
3. Levantar la app con el entorno local, pedir el enlace de `superadmin.e2e@likida.test` en `/login` y abrirlo desde
   Mailpit (`http://127.0.0.1:54324`).
4. `/admin/elegir-flota` → **«Innovativos (demo)»** → el resto de las rutas de la tabla de §3.
5. Para la pantalla del Vigía (muestra «apagado» si no) y el tablero del Conductor:
   `bash scripts/demo/innovativos/sembrar.sh --encender-agentes` (sigue sin enviar nada: los teléfonos `28999…` se rechazan).

**Lo verificado en esta ronda** fue contra Postgres directo (conteos, restricciones, idempotencia, lectores y motor de
cruce reales), **no contra las pantallas renderizadas**. El ensayo visual con la pila local está pendiente.

## 7. Pruebas de este stream

```bash
# sin base (vitest, un archivo a la vez):
npx vitest run src/lib/likida/demo_innovativos/guardas_host.test.ts       # una prueba por cada bypass de la guarda de host
npx vitest run src/lib/likida/demo_innovativos/idempotencia_huellas.test.ts  # la comparación de huellas no pasa en falso
npx vitest run src/lib/likida/demo_innovativos/verificadores.test.ts      # los verificadores fallan con 0 líneas
npx vitest run src/lib/likida/demo_innovativos/seed_estatico.test.ts      # SQL determinista, teléfonos con marca, veredictos, lo sembrado nuevo
npx vitest run src/lib/likida/demo_innovativos/vaciar_acotado.test.ts     # vaciar solo toca filas sembradas
npx vitest run src/lib/likida/demo_innovativos/archivos.test.ts           # el validador del kit, con los importadores reales
npx vitest run src/lib/likida/demo_innovativos/muestras_importadores_reales.test.ts   # cada muestra por su importador real
npx vitest run src/lib/likida/demo_innovativos/catalogo_kit.test.ts       # el kit y el guion no dicen más (ni menos) que el código
npx vitest run src/lib/meta/telefono_demo.test.ts src/app/api/cron/wa-outbox/route_demo.test.ts   # el envío rechaza teléfonos demo
# con base local migrada (DEMO_DATABASE_URL):
bash scripts/demo/innovativos/probar-idempotencia.sh
bash scripts/demo/innovativos/probar-vaciar-solo-sembrado.sh
node scripts/demo/innovativos/verificar-cruces-con-motor.mjs
node scripts/demo/innovativos/verificar-hechos-del-guion.mjs
```

## 8. Qué NO es el demo (límites declarados)

- **Meta / WhatsApp:** no se manda nada real. Los avisos con botones fuera de la ventana de 24 h necesitan **plantillas
  aprobadas por Meta (2 a 5 días hábiles)**; mandarlas a aprobación en cuanto haya número verificado.
- **GPS real:** las posiciones son simuladas hasta que llegue el acceso de lectura a su tabla. El lector de tabla propia
  está conectado al cron `gps` para CSV por https y endpoint; el modo SQL necesita el controlador `pg` y el SFTP un
  cliente (decisiones pendientes). Las posiciones del demo se siembran directo en `posicion`.
- **Los barridos:** la detección de hitos por geocerca y el aviso de «sin señal de vida» corren en el cron
  `conductor-hitos` con el reloj real; en el demo se enseña su **resultado sembrado**, no el barrido en vivo.
- **Orquestador (chat):** consulta lo que Likida ya tiene (viajes en vivo, hitos, Vigía, buzón, cobranza, liquidación
  externa, peajes, jornada…), de solo lectura y por rol; **no** lee SAP/TMS (no hay conector) y llama a un modelo.
- **Datos reales de Carta Porte, convenios y del formato de liquidación** (12-oct y 15-oct): hasta entonces todo es
  sintético; el guion dice dónde hay que decirlo.
- **Lo que no existe todavía:** los «cursos» de peajes, la partición de un
  Excel de Carta Porte con varios embarques y la lectura en vivo de los grupos de un WhatsApp común.
- **Viajes y operadores reales:** vendrán de su TMS/SAP (importador masivo de operadores/unidades y de viajes ya
  existentes); no son parte de los 5 agentes y aquí son sintéticos.
