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
2. **`csv_sftp`**: un CSV en una dirección **https** pública (`base_url`; opcional `geocercas_url`).
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

**Backoff, latido y cron:** no hay un cron nuevo; `tabla_propia` está en `LECTORES_POSICION`, así que lo recorre el
cron `gps` con el backoff por clase de falla de la 0500 (credencial/formato → espera larga y se dice;
proveedor → espera corta) y el mismo latido. Filas sucias hacen el poll **parcial**, no «sano».

**Geocercas:** `Conexiones → GPS → «Importar mis geocercas»` lee la vista/CSV/endpoint de geocercas
(`codigo, nombre, lat_centro, lon_centro, radio_m` o `poligono_wkt`, `cliente`) y las importa al catálogo de sitios
con el importador todo-o-nada del Conductor (re-importar actualiza por código). **Círculo:** tal cual. **Polígono:**
el catálogo guarda centro + radio, así que se aproxima por el círculo más chico (con 5 % de margen) que **lo
contiene** y la pantalla dice cuántos se aproximaron; no se simplifica en silencio. Soporte nativo de polígonos
sería un cambio de modelo (columna de geometría + prueba de punto-en-polígono en la validación de llegada).

### Alineación con el demo

`demo_flota-demo/contratos.ts` (rama `loop/w3-demo`) define `LectorTablaPropia`. Los tipos de
`tabla_propia/contrato.ts` son estructuralmente idénticos (mismos nombres y campos), así que un lector de aquí
satisface el del demo y al revés. La referencia CSV del demo y este lector usan los mismos alias de columna
(`id_unidad, latitud, longitud, fecha_hora, velocidad_kmh, ignicion`; geocercas: `codigo, nombre, tipo,
lat_centro, lon_centro, radio_m, poligono_wkt, cliente`). Lo extra de aquí: zona configurable por flota y los
tres modos con su seguridad.

### BLOQUEOS EXTERNOS (nada se simula como hecho)

- **Controlador de PostgreSQL (`pg`):** no está entre las dependencias del repositorio y agregarlo cambia
  `package-lock.json`; lo decide el integrador. Hasta entonces el modo SQL contesta «El lector SQL no está
  habilitado en este despliegue» (falla de formato, backoff largo, visible en el panel). El constructor de la
  consulta, la validación, el SSRF y el ejecutor están probados con un `pg` de contrato; al instalar `pg` funciona
  sin tocar más código.
- **SFTP:** no hay cliente SFTP; `sftp://` se declara y contesta «todavía no está habilitada». El archivo debe
  estar en una dirección https.
- **Una base/archivo/endpoint real de una flota:** todo está probado con fixtures de contrato
  (`tabla_propia/fixtures/`); el conector está marcado `requiere_piloto` y sin fuente hasta verlo contra datos
  reales. Para subirlo: una vista (o réplica) real con usuario de solo lectura, o un CSV/endpoint de muestra.
- **Proveedores (Wialon, Geotab, Navixy, genérico):** sus lectores se escribieron contra la documentación y se
  probaron con fixtures; ninguno se ha ejecutado contra una cuenta viva.
