# GPS: de dónde entran las posiciones, qué está construido y qué falta de terceros

Todas las fuentes de posición terminan en **un solo asentador** (`asentarLecturas`,
`src/lib/likida/conectores/sincronizar_gps.ts`): valida la frontera, liga el dispositivo a una
unidad **de esa flota**, aplica la compuerta del aviso de privacidad, guarda idempotente en
`posicion` (clave `tenant_id, unidad_id, medida_en`) y sella `unidad.gps_visto_en`. El Conductor
(validación de hitos), los Peajes, el mapa y la jornada leen de `posicion`; no saben de dónde vino.

| Fuente | Cómo entra | Estado |
| --- | --- | --- |
| Samsara, Wialon, Geotab, Navixy, proveedor genérico | poll del cron `gps` (cada 5 min) con el lector del proveedor | construido; contra fixtures de contrato, sin cuenta viva (bloqueo externo) |
| GPS propio que hace POST | `/api/gps/push/[flota]`, firma HMAC por flota | construido |
| **Tabla propia** (la flota ya tiene las posiciones en sus tablas) | poll del cron `gps`, lector de solo lectura | construido; ver abajo |
| Pin de WhatsApp del chofer | procesador de mensajes (`proveedor = 'whatsapp'`) | construido (respaldo) |

**El pin de WhatsApp no es GPS (0603).** Es un respaldo que el chofer elige a mano: el mapa en vivo (`ultimas_posiciones_tenant`) y la evidencia de la
reclamación de peajes (`peaje_posiciones_ventana`) lo excluyen en la base, y la validación de llegadas del Conductor lo guarda como evidencia pero con GPS activo un pin
solo nunca valida. Código seguro contra la base sin la 0603 (la aplicación ya lo descarta en TS).

**Qué falta para que sea de punta a punta:** el acceso real de la flota (vista/CSV/endpoint de posiciones y geocercas), aplicar las migraciones en la base real y,
para el modo SQL, la decisión de dependencia que está más abajo (el cliente SFTP ya está instalado: `ssh2`). El E2E del ciclo (poll → asentador → `posicion` → barrido de validación del Conductor, con
falla de credencial, lote duplicado, muestra atrasada y otra flota) vive en `src/lib/likida/e2e/agente-10-gps.e2e.test.ts`.

## Tabla propia (`tabla_propia`)

Conector del catálogo (`Conexiones → Credenciales`, id `tabla_propia`, «Mis propias tablas de GPS»). La
configuración vive en la credencial cifrada con el cofre (usuario/clave SQL y token **nunca** en claro).
Tres modos, mismo contrato (`LectorTablaPropia`, `src/lib/likida/conectores/tabla_propia/contrato.ts`):

1. **`sql_solo_lectura`**: la flota habilita un usuario de solo lectura sobre una **vista**. La flota no escribe SQL:
   declara la vista y el mapeo `unidad, lat, lon, fecha_hora, velocidad_kmh?, ignicion?` y Likida arma un único
   `SELECT` con identificadores validados y entrecomillados y los valores como parámetros. Defensas: lista
   cerrada de forma de identificadores, esquemas de sistema vetados, `afirmarSelectSeguro` (una sentencia, sin
   `;`, comentarios, literales, `into`, `for update` ni palabras de escritura), transacción `READ ONLY`,
   `statement_timeout`, `LIMIT`, TLS verificado (nunca en claro) y servidor **público** (se resuelve y se rechaza
   si cualquier dirección es privada/loopback/enlace local/metadatos; el socket se abre contra la IP ya validada).
2. **`csv_sftp`**: un CSV en una dirección **https** pública (`base_url`; opcional `geocercas_url`) **o en un servidor SFTP**
   (`sftp://servidor[:puerto]/ruta/archivo.csv`, ver «SFTP» abajo).
3. **`endpoint`**: una dirección https que devuelve JSON, con mapeo de campos (`mapeo_posiciones`), paginación por
   cursor o página y velocidad en km/h, mph, m/s o nudos.

Reglas comunes: la fecha de su sistema suele ser **hora local sin zona** → se interpreta en la zona configurada
(`zona`, por omisión la de la Ciudad de México) con el desfase real de ESA fecha; si el dato trae zona explícita
se respeta. La unidad se llama por su **número económico** («IN-001» = «in 001»): el asentador la liga primero por
`gps_device_id` (si la flota la mapeó) y si no por `numero_economico` normalizado, de esa flota y solo activas; un
económico ambiguo o inexistente queda como **dispositivo huérfano** (id y hora, jamás coordenadas), nunca se
inventa una unidad. Lo que no se entiende se **rechaza con su motivo** (lat/lon intercambiadas, fuera de México,
fecha ilegible, velocidad ≥ 250): no se «arregla». Cada vuelta lee una ventana (30 min por omisión) y repetirla
es seguro (idempotente).

**El búfer tardío (decisión M2, Ola 4a).** La ventana filtra por `fecha_hora` (cuándo se MIDIÓ el punto), no por cuándo
llegó a su tabla: un tractor que reaparece tras un tramo sin señal sube su búfer de golpe y esos puntos quedan atrás de
la ventana corta de cada vuelta, así que no se leen nunca. Se decidió **no** filtrar por «llegada» y, en su lugar, ofrecer
un **barrido largo configurable**: (1) una columna de llegada exige que su tabla la tenga y no la hemos visto (lo que se
pidió son unidad, lat, lon, fecha_hora, velocidad e ignición, y su tabla puede ser de «posición al momento», sin historia,
donde ninguna ventana recupera nada); (2) el barrido funciona con cualquier modo (SQL, CSV, endpoint) y no depende de su
esquema; (3) repetir lectura es seguro, así que el único costo es volumen, y por eso **nace apagado**.
`barrido_largo_minutos` (0 = apagado; 60 a 1,440 y mayor que la ventana): la vuelta de los primeros 5 minutos de cada hora
UTC (una por hora con el cron de 5 min) lee tanto hacia atrás. Sin estado: una vuelta perdida solo lo atrasa una hora.
Además, **si la lectura SQL llega a `limite_filas` lo dice** (la consulta ordena de la más reciente a la más vieja, así que
lo que el tope pierde son justo los puntos tardíos) y la vuelta sale parcial. Con los datos reales del 12-oct se mide el
retraso típico (diferencia entre `fecha_hora` y la llegada) y se fija el valor; si su tabla trae una columna de llegada, se
reabre la decisión.

**Backoff, latido y cron:** no hay un cron nuevo; `tabla_propia` está en `LECTORES_POSICION`, así que lo recorre el
cron `gps` con el backoff por clase de falla de la 0500 (credencial/formato → espera larga y se dice;
proveedor → espera corta) y el mismo latido. Filas sucias hacen el poll **parcial**, no «sano».

**Geocercas (P1, migraciones 0630-0632):** `Conexiones → GPS → «Importar mis geocercas»` lee la vista/CSV/endpoint de geocercas
(`codigo, nombre, lat_centro, lon_centro, radio_m` o `poligono_wkt`, `cliente`) y las importa al catálogo de sitios
con el importador todo-o-nada del Conductor (re-importar actualiza por código, no duplica).
- **Círculo:** tal cual.
- **Polígono:** se guarda **nativo** (`geocerca.poligono`, 3 a 500 vértices con área) y la pregunta «¿el tractor está dentro?» la contesta un solo
  helper, `dentroDeGeocerca()` (`conductor/geo.ts`), que usan la validación de hitos, el acercamiento de convenios, la detección por geocerca del Conductor y la
  reclamación de peajes. El catálogo conserva además el círculo que CONTIENE al polígono (centro = promedio de vértices, radio = vértice más lejano, **sin
  inflarlo**: el +5 % anterior abarcaba la carretera de junto y la reclamación acusaba con confianza «alta» a unidades que solo pasaban). Un polígono que no
  se puede guardar (más de 500 vértices o sin área) entra solo como ese círculo y queda marcado `aproximada`: la pantalla dice cuántos y quien acusa con él
  baja su confianza a «media» (nunca «alta»). Las filas que ya venían de un CSV antes de la 0630 se marcan `aproximada` una vez (lado seguro) hasta que la
  re-importación las aclara.
- **Re-importación diaria dentro del cron `gps` (0631):** una vez cada 23 h por flota con «mis propias tablas» activas (a la hora si el intento falló), con claim
  atómico y **huella sha256** del contenido: con la misma huella no se escribe nada (no revive un sitio que la flota archivó). Tope de 20 flotas por corrida y
  reloj duro; el fallo de una flota se anota en su estado y no frena a las demás. Un sitio editado a mano (`fuente = 'manual'`) NO se pisa (0632). Sin las migraciones
  el cron de posiciones sigue como siempre y la re-importación se apaga con un aviso.

### Cursos (rutas autorizadas) por el mismo lector — P8

Además de posiciones y geocercas, el lector puede leer los **cursos** que consume el reporte de reclamación de peajes
(motivo «cruce fuera de curso», ver `docs/operacion/conciliacion-peajes.md`). Misma interfaz (`leerCursos?` de
`LectorTablaPropia`, opcional para no romper la alineación con el demo), mismo juez para los tres modos y mismo rechazo
con motivo de lo que no se entiende:

- **CSV por https:** `cursos_url`. Una fila por curso: `codigo, nombre, unidad | convenio, casetas | corredor_wkt + buffer_m,
  vigente_desde, vigente_hasta`. Las casetas, en una celda separadas por `|` y en orden de recorrido; el corredor, `LINESTRING(lon lat, …)`.
- **Endpoint JSON:** `cursos_url` + `mapeo_cursos` (`lista`, `campos`, paginación); las casetas pueden venir como arreglo.
- **SQL de solo lectura:** `vista_cursos` + `columnas_cursos` (JSON), con el mismo `SELECT` armado y validado.

Un curso es de **casetas o de corredor**, nunca de los dos; sin unidad ni convenio no aplica a nadie y se rechaza; el corredor exige un
buffer de 25 a 20,000 m (no se supone uno). **El formato real de los corredores del cliente es bloqueo externo (12-oct):** hoy hay
contrato y fixtures sintéticos (`tabla_propia/fixtures/cursos*.csv`, `endpoint_cursos.json`). La importación (nombres → ids de la flota,
guardado atómico) está en `peajes/cursos_importar.ts`.

### Alineación con el demo

`demo_flota-demo/contratos.ts` (rama `loop/w3-demo`) define `LectorTablaPropia`. Los tipos de
`tabla_propia/contrato.ts` son estructuralmente idénticos (mismos nombres y campos), así que un lector de aquí
satisface el del demo y al revés. La referencia CSV del demo y este lector usan los mismos alias de columna
(`id_unidad, latitud, longitud, fecha_hora, velocidad_kmh, ignicion`; geocercas: `codigo, nombre, tipo,
lat_centro, lon_centro, radio_m, poligono_wkt, cliente`). Lo extra de aquí: zona configurable por flota y los
tres modos con su seguridad.

### SFTP (`csv_sftp` con `sftp://`)

Cliente: `ssh2` 1.17.0 (JS puro; sus binarios nativos son opcionales y por eso va en `serverExternalPackages`). Se eligió `ssh2`
directo y no `ssh2-sftp-client`: necesitamos el `hostVerifier`, el tope de bytes en streaming y el corte por plazo, que la
envoltura esconde. Código: `src/lib/likida/conectores/tabla_propia/sftp.ts`; el cliente se inyecta (`deps.sftp`) y las pruebas
lo sustituyen por un doble.

**Qué se guarda** (en la credencial cifrada del conector, igual que los demás modos):

| Campo | Qué es |
|---|---|
| `base_url` | `sftp://servidor[:puerto]/ruta/posiciones.csv` (puerto 22 por omisión). Sin usuario ni clave dentro de la dirección. |
| `geocercas_url` | Opcional; mismo servidor y puerto, otra ruta. Si `base_url` es sftp, esta también (la credencial no viaja a un sitio https). |
| `nombre_campo` | El usuario SFTP (el mismo campo que el usuario de «basic»). |
| `token` | La contraseña (secreto). Puede ir vacía si se entra con llave. |
| `llave_privada` | Alternativa a la contraseña: la llave privada PEM/OpenSSH completa (secreto; se acepta pegada en una línea). |
| `frase_llave` | Frase de la llave, si la tiene (secreto). |
| `huella_host` | **Obligatoria.** `SHA256:…` de la llave del servidor (la de `ssh-keygen -lf` o WinSCP). Admite hasta 5 separadas por coma para rotar la llave sin cortar la lectura. |

**Decisión: la huella del host es obligatoria, sin «confiar en el primer contacto».** Sin `huella_host` la configuración no se
guarda ni se prueba («falla cerrada»); con una huella distinta la conexión se corta ANTES de mandar usuario o clave, con falla de
`credencial` (hay que actualizar la huella si la llave del servidor cambió a propósito; si no, hay alguien interpuesto) y el
mensaje dice qué huella presentó el servidor, que es pública, para copiarla al configurar. El cliente no confía en
`known_hosts` ni en DNS: la identidad es la llave.

**Límites:** el servidor debe tener dirección **pública** (se resuelve y se rechaza si cualquier dirección es interna; el socket se
abre contra la IP ya validada); plazo total de 25 s (10 s para conectar); archivo de hasta 25 MB, verificado con `stat` antes y
otra vez mientras se lee. Solo lee un archivo: no lista, no escribe, no borra, no renombra.

**Fallas** (mismas clases que los demás lectores, para el backoff del cron `gps`):

| Qué pasó | Clase | Nota |
|---|---|---|
| Usuario, contraseña o llave rechazados; llave ilegible o frase equivocada; sin permiso sobre el archivo; huella distinta | `credencial` | Alguien debe corregir algo; no es transitorio. |
| DNS, conexión rehusada o cortada, plazo vencido, no negoció SSH | `proveedor` | Transitorio: reintenta con backoff. |
| Archivo ausente, la ruta es un directorio, archivo de más de 25 MB, CSV vacío o sin las columnas obligatorias | `formato` | Corregir la ruta, acotar el archivo o el mapeo de columnas. |

**Secretos:** los mensajes son frases fijas; jamás se copia el texto de `ssh2` (puede traer rutas o usuario) ni se repite una
clave, llave o frase. La prueba del panel muestra `sftp://servidor/ruta`, sin usuario. Las pruebas lo verifican con secretos
centinela. El CSV (columnas, zona, ventana, separador `;` con decimal coma) es el mismo que por https.

**Pruebas:** `sftp.test.ts` (configuración y lectura con un doble del cliente), `sftp_asentar.test.ts` (camino completo hasta el
asentador, incluida una unidad de otra flota) y `sftp.integracion.test.ts` (servidor SFTP real en proceso —el `Server` de
ssh2— en 127.0.0.1, con llaves generadas en la prueba: contraseña, llave con y sin frase, huella distinta, archivo ausente,
sin permiso, enorme, stat mentiroso, timeout, puerto cerrado). No se ha probado contra el servidor de ninguna flota real.

### BLOQUEOS EXTERNOS (nada se simula como hecho)

- **Controlador de PostgreSQL (`pg`):** no está entre las dependencias del repositorio y agregarlo cambia
  `package-lock.json`; lo decide el integrador. Hasta entonces el modo SQL contesta «El lector SQL no está
  habilitado en este despliegue» (falla de formato, backoff largo, visible en el panel). El constructor de la
  consulta, la validación, el SSRF y el ejecutor están probados con un `pg` de contrato; al instalar `pg` funciona
  sin tocar más código.
- **SFTP, credenciales reales del cliente:** el lector está construido y probado (contra un servidor SFTP de prueba en
  localhost), pero ninguna flota nos ha dado todavía un servidor, usuario (contraseña o llave) y la huella de su llave de
  host. Hasta tenerlos el modo se queda en `requiere_piloto`.
- **Una base/archivo/endpoint real de una flota:** todo está probado con fixtures de contrato
  (`tabla_propia/fixtures/`); el conector está marcado `requiere_piloto` y sin fuente hasta verlo contra datos
  reales. Para subirlo: una vista (o réplica) real con usuario de solo lectura, o un CSV/endpoint de muestra.
- **Proveedores (Wialon, Geotab, Navixy, genérico):** sus lectores se escribieron contra la documentación y se
  probaron con fixtures; ninguno se ha ejecutado contra una cuenta viva.
