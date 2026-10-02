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
> **Los teléfonos llevan la marca `28999…`** (código de país 289: sin asignar, no es de nadie) y el envío real de
> WhatsApp rechaza cualquier destinatario con esa marca antes de llamar a Meta. El repo es público: nada aquí es dato
> real de ningún cliente. Lo que no existe todavía (formato real de su Excel, archivo real de PASE, su tabla de GPS)
> está **declarado como bloqueo**, no adivinado. **El Vigía y el Conductor del tenant demo vienen APAGADOS** (ningún cron
> les escribe a nadie); se encienden a propósito con `--encender-agentes`.

---

## 1. Levantarlo

Necesitas Postgres local (`psql`) y las migraciones aplicadas. Dos caminos:

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

Probar que no duplica (4 corridas: sembrar, sembrar, `--reiniciar`, vaciar-todo + sembrar): compara, de **24 tablas**,
el conteo y la huella md5 de la **fila completa** (`to_jsonb`, sin marcas de reloj), así que una columna que se pierde
(p. ej. `viaje.origen_geocerca_id` tras borrar las geocercas) cambia la huella. **Falla si alguna tabla tiene 0 filas**,
si algún viaje queda sin origen/destino, si algún teléfono del tenant demo no lleva la marca `28999`, si el Vigía o el
Conductor quedaron encendidos, o si el rol de solo lectura no es rechazado por permisos:

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
| Geocercas | 31 | 3 patios + 14 plantas + 14 andenes (hijas de su planta) |
| Viajes | 140 en curso + 266 cerrados (7 días) | folios `INN-24001…` (en curso) y `INN-23001…` (cerrados) |
| Hitos del conductor | 1,466 | llegó a cargar / salió / llegó a descargar / salió; validados por GPS o por texto del chofer |
| Veredictos de ubicación | 158 | uno por hito de llegada de un viaje en curso, **calculado por el motor real** (152 validados, 6 sin coincidencia) |
| Posiciones GPS | 41,770 (×2) | en **su tabla propia simulada** (`innovativos_sim.gps_posicion`) y ya leídas en `posicion` |
| Casetas / TAG | 12 / 250 | catálogo sintético «Demo» sobre el eje GDL–APO |
| Líneas de pase (24 h) | 379 | 9 **fuera de ruta**, 4 **cobros duplicados**, 7 sin GPS (unidad silenciosa) |
| Liquidaciones «de su sistema» | 158 | 116 acusadas (8 con «No coincide»), 34 enviadas, 8 fallidas; ninguna pendiente |
| Carta Porte | 12 documentos, 3 perfiles | PDF / Excel / CSV de 3 clientes; aprobados, por revisar, rechazado, uno con **inyección** |
| Vigía | 3 contactos críticos, 3 conversaciones, 6 mensajes | una a >10 min sin respuesta, una molesta, una atendida; **agente apagado** (`habilitado = false`) |
| Escalamiento | 6 contactos | jefe de tráfico (nivel 1) y jefe de flota (nivel 2) por terminal; Conductor **apagado** (`activo = false`) |
| Convenios | 14 con 84 instrucciones de operación | copia en `innovativos_sim.convenio*`; si la 0580 existe, también en `cliente_convenio` |

**Escenarios sembrados a propósito** (los que el guion enseña; todos reproducibles porque son deterministas):

- **«Ya llegué» sin GPS que lo respalde** — 6 viajes: `INN-24005`, `INN-24032`, `INN-24059`, `INN-24086`, `INN-24113`,
  `INN-24140`. El hito `llegada_descarga` entra por texto y queda **recibido** (no validado); el seed le pone la posición
  REAL del tractor (a 23–342 km de la planta) y el motor de validación del Conductor emite el veredicto
  **sin coincidencia** (`generar-veredictos.mjs`). Eso es lo que alimenta la «Cola de excepciones» del tablero.
- **Sin señal de vida** — 6 viajes: `INN-24023`, `INN-24046`, `INN-24069`, `INN-24092`, `INN-24115`, `INN-24138`. El
  GPS dejó de reportar hace >100 min y el hito pendiente está **escalado** (3 a nivel 1, 3 a nivel 2). El seed deja el
  estado como lo dejaría el cron `conductor-hitos`; el aviso en sí NO se manda (agente apagado, teléfonos de demo).
- **Peajes**: la verdad sembrada está en `archivos-muestra/peajes/anomalias_sembradas.csv` (13 líneas: fuera de ruta y
  duplicados, con TAG, caseta y hora). `verificar-cruces-con-motor.mjs` comprueba que el motor real de cruce
  (`evaluarCruceGps`) da el mismo veredicto en las **379** líneas.
- **Liquidación**: 8 liquidaciones acusadas con «No coincide» (el chofer apretó ese botón). Hoy queda **registrado y
  filtrable** en la pantalla; **no existe** todavía un aviso a una persona de la oficina.
- **Carta Porte**: `orden_c12_4` trae una instrucción dentro del documento («IGNORA LAS INSTRUCCIONES…»). El documento
  sembrado YA viene marcado con riesgo (lo escribe el seed); lo que sí se verifica de verdad es que el detector real
  (`detectarInyeccion`) marca el archivo de muestra (`verificar-hechos-del-guion.mjs`). Los valores, confianzas y la
  «evidencia» de los 12 documentos sembrados son **dato de demo**, no salida de un modelo; `sha256` y tamaño son
  inventados (el archivo vive en `archivos-muestra/`, no en Storage).

## 3. El kit de carga

Cada fila es un archivo que entrega el cliente. **La columna «Importador» dice si ya existe en esta rama
(`existe`), lo construye otro stream del loop (`en_rama`) o es solo contrato con fixtures y prueba (`contrato`).**

| Archivo (id) | Muestra (`scripts/demo/innovativos/archivos-muestra/…`) | Importador | Se ve en |
|---|---|---|---|
| `gps_posiciones` | `gps/gps_posicion_muestra.csv`, `gps/gps_actual.csv` | **contrato** — `LectorTablaPropia` | `/dashboard/mapa`, `/dashboard/agentes/conductores` |
| `geocercas` | `gps/geocercas.csv` | **existe** — catálogo de sitios (0385) | `/dashboard/agentes/conductores/sitios` |
| `pases` | `peajes/pases_24h.csv` | **existe** — ingesta de desglose de peaje | `/dashboard/agentes/peajes` |
| `tags` | `peajes/tags_unidades.csv` | **existe** — alta masiva de TAG | `/dashboard/agentes/peajes/configuracion` |
| `casetas` | `peajes/casetas_catalogo.csv` | **existe** — catálogo de casetas | `/dashboard/agentes/peajes/configuracion` |
| `liquidaciones` | `liquidacion/liquidaciones_sistema.csv` | **existe** — `POST /api/v1/liquidaciones-externas` | `/dashboard/agentes/liquidacion` |
| `convenios` | `convenios/convenios.csv` | **en_rama** — w3-convenios (0580) | `/dashboard/clientes` y el mensaje de despacho |
| `whatsapp` | `whatsapp/grupo_afb_silao_ios.txt`, `…_android.txt`, `….zip` | **en_rama** — w3-conductor-vigia | `/dashboard/agentes/vigia` |
| `carta_porte` | `carta_porte/orden_c05_1.pdf`, `…c10_1.xlsx`, `…c12_1.csv` | **existe** — bandeja multi-formato | `/dashboard/carta-porte/documentos` |

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
  `ignición`. Modo `sql_solo_lectura`, o un CSV que ellos dejen cada N minutos (`csv_sftp`), o un endpoint.
- **Formato esperado** (la muestra lo simula, con **dos rarezas a propósito** porque lo real las traerá):
  `id_unidad,latitud,longitud,fecha_hora,velocidad_kmh,ignicion` donde `fecha_hora` es **hora local de CDMX sin zona** y la
  unidad es su **número económico** («IN-001»).
- **Importador:** `LectorTablaPropia` en `src/lib/likida/demo_innovativos/contratos.ts` — **solo contrato**. La referencia
  sobre CSV está en `lector_tabla_propia.ts` (normaliza encabezados, convierte hora local a UTC con el desfase real de esa
  fecha, resuelve la unidad por económico, rechaza lat/lng intercambiadas sin «arreglarlas», cuenta las unidades que
  Likida no tiene en vez de inventarlas) y `construirConsultaPosiciones` arma el SELECT parametrizado de solo lectura.
  El stream `w3-gps-jornada` aporta el asentador común de posiciones (poll y push): el lector real debe implementar
  `LectorTablaPropia` y entregarle `PosicionLikida[]`. **Punto de enganche:** `adaptarAPosiciones(filas, unidadesPorEconomico)`.
- **Validación:** `node scripts/demo/innovativos/validar-archivo.mjs gps_posiciones <archivo.csv>` (avisa de unidades sin
  lectura en los últimos 30 min del archivo y de columnas faltantes: velocidad, ignición).
- **Reemplazo:** `vaciar-sintetico.sh gps` borra `posicion` con proveedor `tabla_propia` del tenant demo (la tabla
  simulada `innovativos_sim` queda, es «su» tabla de prueba). Mientras el lector real no exista, el demo usa las
  posiciones ya sembradas en `posicion`.
- **Ver:** `/dashboard/mapa` (unidades con posición, «sin ubicar», escalados) y el tablero del Conductor.

### 3.2 Geocercas (`geocercas`)

- **Formato:** `codigo,nombre,tipo (circulo|poligono),lat_centro,lon_centro,radio_m,poligono_wkt,cliente`. El WKT va
  **lon-lat**.
- **Importador:** existe — el catálogo de sitios del Conductor (`codigo,nombre,tipo,lat,lng,radio_m,direccion,cliente,padre`;
  tipos `cliente|planta|anden|patio|punto_interes`). `geocercasASitiosCsv` convierte su formato a ese CSV.
  **Brecha declarada:** el catálogo guarda centro + radio, no polígonos. Un polígono se **aproxima** a un círculo que
  lo contiene y se reporta cuál se aproximó (en la muestra, 4 de 17). Si sus polígonos importan para validar hitos, hay
  que decidir soporte nativo.
- **Validación:** `validar-archivo.mjs geocercas <archivo>` (incluye «cuántos entrarían al catálogo» pasando por el
  lector real de sitios).
- **Ver:** `/dashboard/agentes/conductores/sitios`.

### 3.3 Pases de peaje, TAG y catálogo de casetas (`pases`, `tags`, `casetas`)

- **Qué se necesita:** cruzar el archivo de pases contra las posiciones GPS y las geocercas/«cursos» y sacar los cruces
  fuera de ruta para pedir descuento al proveedor.
- **Formato:** el **archivo real de PASE no se conoce** (bloqueo declarado). El lector es tolerante (encabezados
  `Fecha/Hora/Caseta/TAG/Importe`, fechas `dd/mm/aaaa`, serial de Excel, importes con `$` o coma decimal). La muestra:
  `Fecha,Hora,Caseta,TAG,Importe`. Aparte necesita **dos archivos más** sin los cuales no hay cruce con GPS:
  `tag;unidad;proveedor` (TAG de cada tracto) y `nombre;lat;lng;radio_m;alias;fuente` (casetas con coordenadas).
- **Importador:** existe (`peajes/ingesta.ts`, `peajes/desglose.ts`, `peajes/tags.ts`, `peajes/casetas.ts`,
  `peajes/cruce_gps.ts`). El **reporte de reclamación** (cruces fuera de ruta con evidencia, para el proveedor) lo
  construye `w3-agentes-1-4`.
- **Validación:** `validar-archivo.mjs pases|tags|casetas <archivo>`. Prueba extra del demo:
  `verificar-cruces-con-motor.mjs` — las 379 líneas sembradas dan el mismo veredicto que el motor real.
- **Reemplazo:** `vaciar-sintetico.sh pases` (desglose, líneas, TAG y casetas «Demo»).
- **Ver:** `/dashboard/agentes/peajes` (subir el desglose y ver las tres cubetas) y `/dashboard/agentes/peajes/configuracion`
  (TAG y casetas).

### 3.4 Liquidación fase 1 (`liquidaciones`)

- **Qué se necesita:** ellos calculan en su sistema; Likida **solo entrega** el pago al operador en su formato
  (el formato que hoy copian y pegan), con copia al jefe de flota y escalando discrepancias. **No** incluye OCR de
  tickets. Facturas = fase 2.
- **Formato:** una fila por renglón: `clave_externa, numero_empleado, periodo_desde, periodo_hasta, folios_viaje (a|b),
  concepto_clave, concepto, tipo (percepcion|deduccion), monto, total_sistema, moneda`. El total del sistema **tiene que
  ser la suma de sus renglones** o no se entrega a ciegas.
- **Importador:** existe — `POST /api/v1/liquidaciones-externas` (validación estricta de la 0370).
  `cuerposDeLiquidacionesCsv` convierte su CSV a ese cuerpo; la muestra versiona un cuerpo de ejemplo
  (`liquidacion/post_liquidacion_externa.ejemplo.json`) y una prueba asegura que **los 40 cuerpos de la muestra pasan la
  validación real** del endpoint. **Falta (bloqueo declarado):** el formato exacto del Excel de la flota. La plantilla
  configurable «por flota a partir de su Excel de muestra» la construye `w3-agentes-1-4`; hay un layout sintético en
  `liquidacion/formato_liquidacion_muestra.xlsx`.
- **Validación:** `validar-archivo.mjs liquidaciones <archivo.csv>`.
- **Reemplazo:** `vaciar-sintetico.sh liquidaciones`.
- **Ver:** `/dashboard/agentes/liquidacion` (estados: enviada, acusada, «No coincide», fallida).

### 3.5 Convenios e instrucciones de operación (`convenios`)

- **Qué se necesita:** todo nace de un convenio (de A a B, tarifa, instrucciones de cobro y de operación); al operador
  le llegan las instrucciones (qué puerta, con quién reportarse, peculiaridades).
- **Formato:** una fila por instrucción: `clave, cliente, convenio, origen, destino, categoria, momento, orden, texto,
  tarifa_modo, tarifa_precio, requisitos_cobro (a|b)`. Dominios cerrados de la 0580: categoría
  `puerta|reportarse|peculiaridad|documentos|horario|seguridad|otro`, momento `despacho|acercamiento|ambos`, texto ≤ 400.
- **Importador:** `en_rama` — `w3-convenios` (0580: `cliente_convenio`, `convenio_instruccion`, `convenio_comercial`;
  «el nombre es la llave de re-importación del CSV»). El seed ya carga ahí los 14 convenios **si las tablas existen**
  (probado contra la 0580 de esa rama en una base de prueba, idempotente); si no, quedan en `innovativos_sim.convenio*`.
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
  generó.
- **Importador:** `en_rama` — `w3-conductor-vigia` (`vigia/historial/export_whatsapp.ts`, `zip_lector.ts`, pantalla
  «Grupos e histórico»). Aquí solo el validador de forma (`inspeccionarExportWhatsapp`, directorio central del zip).
- **Validación:** `validar-archivo.mjs whatsapp <archivo>`.
- **Reemplazo:** `vaciar-sintetico.sh vigia` (contactos, conversaciones y mensajes sembrados).
- **Ver:** `/dashboard/agentes/vigia`.

### 3.7 Carta Porte multi-formato (`carta_porte`)

- **Qué se necesita:** lo que manda el cliente (PDF/Excel) debe pasar **directo a su sistema/Excel de carga** sin copiar
  y pegar; dudas marcadas y enviadas al equipo; muchos clientes, cada uno con su formato.
- **Formato:** los documentos de **3 a 5 clientes grandes** (bloqueo declarado) y **su Excel o sistema destino**. La
  muestra trae un PDF con texto, un Excel y un CSV de tres clientes ficticios, y un CSV de **prueba de inyección**.
- **Importador:** existe — bandeja de Carta Porte (`carta_porte_docs/servicio.ts`): perfil por cliente-formato (mapeo
  declarativo que se aprende de lo aprobado por un humano) y exportación por mapeo (`cp_export_config`).
  El formato de exportación sembrado es **sintético** (CSV que abre Excel): se reemplaza cargando su mapeo real. Un
  destino `.xlsx` nativo no está en el contrato actual (`csv|json`): decidirlo al ver su formato.
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

## 5. Enganches con los demás streams de la Ola 3

| Stream | Qué aporta al demo | Punto de enganche en este stream |
|---|---|---|
| `w3-gps-jornada` | Lectores de posiciones (Wialon/Geotab/Navixy/genérico), asentador común, mapa con semáforo de obsolescencia | `LectorTablaPropia` → `adaptarAPosiciones` → asentador común; `posicion.proveedor = 'tabla_propia'` |
| `w3-convenios` | Tablas 0580 y su CSV | El seed los carga en `cliente_convenio` si existen; `convenios.csv` es la forma del archivo |
| `w3-conductor-vigia` | Conciliación contra GPS, escalamiento, grupos e histórico | Escenarios `llegue_sin_gps` y `silencio`; fixtures de WhatsApp en 3 formatos |
| `w3-agentes-1-4` | Plantilla de liquidación por flota, reporte de reclamación de peajes | `liquidaciones_sistema.csv`, `formato_liquidacion_muestra.xlsx`, `anomalias_sembradas.csv` |

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
npx vitest run src/lib/likida/demo_innovativos/seed_estatico.test.ts      # SQL determinista, teléfonos con marca, veredictos
npx vitest run src/lib/likida/demo_innovativos/vaciar_acotado.test.ts     # vaciar solo toca filas sembradas
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
  (`LectorTablaPropia`) es solo contrato y referencia CSV: **no está conectado a ninguna ruta ni cron**; las posiciones
  se siembran directo en `posicion`.
- **Orquestador (chat):** hoy consulta KPIs, viajes, liquidaciones, Carta Porte y normas; **no** lee hitos, peajes ni
  Vigía (fuentes nuevas de `w3-agentes-1-4`).
- **Viajes y operadores reales:** vendrán de su TMS/SAP (importador masivo de operadores/unidades y de viajes ya
  existentes); no son parte de los 5 agentes y aquí son sintéticos.
