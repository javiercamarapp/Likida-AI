# Conciliación de peajes (Agente 2) — flujo, contrato y bloqueos

Estado al 1-oct-2026 (loop punta a punta, rama `loop/s3-agentes12`, migraciones 0375 y 0376; ola 3, rama `loop/w3-agentes-1-4`, migración 0563 y retención 0562).
Todo lo de abajo está construido y probado **con datos sintéticos**; lo que depende del archivo
real de PASE, del GPS de la flota o de credenciales externas está en «Bloqueos».

## Qué hace

1. **Recibe** el desglose del proveedor (Excel/CSV/PDF con texto) por dos vías: subida manual en
   `/dashboard/agentes/peajes` o **buzón firmado** `POST /api/peajes/ingesta` (el cron
   `/api/cron/peajes`, cada 15 min, lo importa y lo cruza solo).
2. **Lee de forma tolerante**: fechas dd/mm/aaaa, ISO y meses en español con hora (12 y 24 h), serial de
   Excel con fracción de día, importes con coma decimal («189,50»), paréntesis negativos y CSV con `;`.
   Un CSV nunca pasa por la librería de hojas (que leía `189,50` como 18950). Formato que no entiende =
   mensaje con los encabezados leídos (con su letra de columna), sugerencias («¿«Improte»?») y, si se
   quiere, **mapeo de columnas por proveedor** (por encabezado o por letra) en la pantalla de
   configuración. Nada se adivina.
3. **Cruza** cada línea contra los gastos de caseta (fecha ±1 día, monto exacto y luego tolerancia de $1):
   - **Hora del cobro** guardada (`hora`, `cruce_en` en UTC con el huso real de México).
   - **TAG ↔ unidad** (`peaje_tag`): desempata entre dos gastos igual de buenos y marca `unidad_distinta`
     si el TAG es de otra unidad que la del viaje del gasto.
   - **Cruce por caseta con GPS**: catálogo `peaje_caseta` con coordenadas (carga por CSV), distancia
     Haversine entre la trayectoria de la unidad y la caseta en ±20 min del cobro. Tres veredictos:
     `confirma`, `no_coincide` (solo con dos posiciones que envuelven el cobro a ≤ 6 min una de otra y
     lejos de radio + margen) y `sin_datos` con su motivo exacto.
4. **Entrega la bitácora conciliada** (`GET /api/export/bitacora-conciliada?desglose=…`, CSV con la
   leyenda adentro): cada línea **cuadra / sin respaldo / por verificar** con el motivo.

## La doctrina de «no acusar de más»

| Estado | Cuándo |
|---|---|
| cuadra | un gasto de caseta respalda el cobro y ninguna señal lo contradice |
| sin respaldo | hay tickets de caseta cargados en el periodo, ninguno respalda este cobro y el GPS (si existe) tampoco lo confirma. Es un hecho sobre los datos de Likida: **no** afirma que el cobro sea indebido |
| por verificar | todo lo demás: monto distinto, dos gastos igual de posibles, TAG de otra unidad, GPS que no ubica la unidad (aun con gasto), falta de fecha, **ningún ticket cargado en el periodo**, el GPS confirma pero falta el comprobante |

Lo que el dato no alcanza (sin hora, TAG sin alta, caseta sin coordenadas, sin posiciones cerca) es
`sin_datos` y nunca cuenta en contra de nadie. El catálogo de casetas **nace vacío**: no se siembran
coordenadas inventadas (el shapefile del IMT está identificado en `normas/red-nacional-autopistas.yaml`
y no se ha cargado).

## Contrato del buzón firmado

`POST {APP_URL}/api/peajes/ingesta` — JSON:

```json
{ "nombre": "corte-pase.xlsx", "proveedor": "PASE", "contenido_base64": "<archivo en base64, ≤ 4 MB>" }
```

Cabeceras: `x-likida-flota` (UUID de la flota), `x-likida-timestamp` (segundos Unix, ±5 min) y
`x-likida-firma: v1=<hex>` donde `hex = HMAC-SHA256(llave, "<timestamp>.<flota>.<cuerpo crudo>")` y
`llave` es el texto de 64 caracteres que se ve (solo quien administra la flota) en
`/dashboard/agentes/peajes/configuracion` tras **activar el buzón**.

- La llave se **deriva** de `PEAJES_INGESTA_SECRETO` (≥ 32 caracteres, variable del servidor) con la
  flota y su rotación: no se guarda en la base; **rotar** es subir un entero y la anterior deja de servir.
- Sin la variable, con la flota sin activar o con la flota desconocida: `401` con el mismo cuerpo que una
  firma mala (no se revela qué existe).
- Respuestas: `202` aceptado · `200 duplicado` (misma huella sha256: el mismo archivo es la misma fila,
  se llame como se llame) · `400` cuerpo mal formado · `401` · `413` · `429` (límite o cola con 50
  pendientes) · `503` (agente apagado o falla temporal: **reintentar**).
- La flota sale **solo** de la cabecera firmada; un `tenant_id` en el cuerpo se ignora.

Ejemplo de firma en Node (también en la pantalla de configuración):

```js
const firma = 'v1=' + createHmac('sha256', LLAVE).update(`${ts}.${FLOTA_ID}.${cuerpo}`).digest('hex');
```

## Más formas de entrada (ola 3, mig. 0563)

Los tres canales son **independientes** (activar uno no enciende ni enseña la llave de otro) y comparten
la misma cola, la misma huella sha256 por flota y el mismo cron.

### Correo `pj-<token>@<dominio>`

El proveedor (o la flota) manda el archivo del corte como adjunto a la dirección de la flota (se activa en
`/dashboard/agentes/peajes/configuracion`, sección «Recepción por correo»). Es el MISMO dominio y el MISMO webhook de
Resend que los buzones de facturas y de carta porte (`POST /api/correo/entrante`, firma Svix verificada **antes** de leer
el correo). Reglas:

- La **flota sale del token del destinatario** (24 caracteres al azar), jamás del remitente (el `from` se falsifica).
  «Cambiar dirección» genera otro token: la anterior deja de servir al instante.
- **Remitentes permitidos** (opcional, correo o dominio): con lista, un correo de otro remitente se **ignora** (200
  `remitente_no_permitido`); sin lista, quien tenga la dirección puede mandar (la dirección es la credencial).
- Adjuntos Excel/CSV/TSV/ODS/PDF de hasta 4 MB (máx. 5 por correo); lo demás se ignora. Se encolan con origen `correo`.
- Respuestas: `200` terminado o nada que hacer (buzón desconocido/apagado, sin adjuntos, ya procesado) y `503` si es
  reintentable (descarga caída, claim ocupado, cola llena, base caída, agente apagado, `RESEND_API_KEY` ausente): Resend
  reintenta y la huella evita duplicar.

### Pull configurable (HTTPS)

No hay API pública de PASE/IAVE/TeleVía. Lo que sí puede hacer una flota —o su TMS, o un script— es **publicar sus
cortes** en una dirección HTTPS; Likida la consulta cada 15 min–24 h (configurable) y lo que traiga entra a la cola.
**Contrato que la flota implementa (definido por Likida, no por un proveedor):**

```
GET <url>[?desde=<instante ISO del último pull exitoso>]
Authorization: Bearer <token>        (si la flota configuró uno)
Accept: application/json
→ 200 { "archivos": [ { "nombre": "corte-pase.xlsx", "proveedor": "PASE", "contenido_base64": "<≤ 4 MB>" } ] }
```

Cada elemento tiene la misma forma que el cuerpo del buzón firmado. Se toman hasta 20 por consulta; la huella vuelve
inocuo que el endpoint devuelva el mismo archivo en cada consulta.

- **SSRF**: la consulta va por `httpsPublico` (solo HTTPS, sin credenciales en la URL, DNS validado contra la IP que abre
  el socket, sin redirects); al guardar se rechaza http, IP privadas, `localhost` y nombres sin dominio.
- **Token**: se guarda **cifrado** con el cofre de la app (AES-256-GCM, `LIKIDA_COFRE_LLAVE`); sin la llave no se guarda
  nada (el pull sin token sí funciona). El valor nunca vuelve a la pantalla ni a un log; el cuerpo de la respuesta
  del endpoint nunca se copia a un error.
- **Claim con lease** (`peaje_pull_reclamar`, `FOR UPDATE SKIP LOCKED`): dos cron no consultan la misma flota a la vez.
  Un fallo (token rechazado, HTTP ≠ 200, JSON roto, cola llena) **no avanza el cursor** y reintenta en ≤ 30 min; el
  último error se muestra en la configuración.
- **SFTP: no se construyó.** Requiere una librería (`ssh2`) que no está en el repo y credenciales/host de la flota; ver Bloqueos.

## Aviso a la oficina

Cuando el cron concilia un desglose y hay cobros donde el **GPS no ubica la unidad en la caseta** (`no_coincide`) o
**sin respaldo** en los tickets, se avisa **una vez** por WhatsApp a quien ve dinero (dueño o contador; nunca al
encargado) por el selector central (texto en ventana, plantilla `aviso_operacion_v1` fuera). El texto dice cuántos cobros
hay por categoría y que es **una señal, no una acusación**; no lleva montos por cobro. El intento se reclama con
compare-and-set (`aviso_intentos`), así que dos procesos no mandan dos avisos; si no sale (sin destinatario, plantilla sin
aprobar) el barrido del cron lo reintenta hasta 5 veces. Un desglose anulado jamás avisa.

## Anulación de un desglose

`POST /v1/peajes/desgloses/{id}/anular` (área `administracion`; también el botón «Anular» del desglose abierto) con
`{ "motivo": "…" }` (1–500 caracteres, **obligatorio**). No borra: deja quién y por qué (`anulado_por`, `anulado_motivo`).
El desglose deja de aparecer en el tablero, de contar en la bitácora RMF 9.1.8, de exportarse, de re-conciliarse y de
avisar, y **libera la huella** de su archivo de la cola para que el archivo correcto (o el mismo ya arreglado) pueda
volver a mandarse. Idempotente (`yaAnulado: true`); «no existe» y «no es de tu flota» contestan 404.

## Reporte de reclamación (ola 3b)

Para pedirle al proveedor de peaje que revise un cobro. Cruza el archivo de pases (el desglose) con el catálogo de TAGs
(TAG↔unidad), la **hora del pase** (hora local de México tal como la trae el archivo), las **posiciones GPS** de la unidad y las
**geocercas** de la flota. Se abre desde el agente de Peajes (botón «Reporte de reclamación» del desglose seleccionado), en
`/dashboard/agentes/peajes/reclamacion?desglose=<id>`, y se descarga en **Excel** (hojas Reclamación, Evidencia GPS y Resumen) y **PDF**
(`GET /api/export/peajes-reclamacion?desglose=<id>&formato=xlsx|pdf`; mismas puertas que la bitácora conciliada: área dinero +
`puedeExportar`, y el desglose se busca con el tenant de la sesión).

Por cada cruce reclamable lleva: fecha, hora, caseta (del proveedor y del catálogo), TAG, unidad, monto, el **porqué** en una frase,
la distancia unidad↔caseta y el radio de la caseta, hasta 3 posiciones GPS como evidencia (con su hora, coordenadas y distancia a la
caseta) y la geocerca si la hay. Tres motivos, cada uno con su evidencia:

| Motivo | Confianza | Cuándo |
|---|---|---|
| GPS lejos de la caseta | alta | Dos posiciones consecutivas, una antes y otra después de la hora del pase y a ≤ 6 min entre sí, ubican a la unidad a más de radio + margen de la caseta (el veredicto `no_coincide` del cruce por caseta). |
| Unidad en zona no autorizada | alta | La posición más cercana en el tiempo al pase (≤ 10 min) cae dentro de una geocerca de **patio** o **restringida** de la flota y no dentro del radio de la caseta. |
| Posible doble cobro | media | El mismo TAG cobrado dos veces en la misma caseta con ≤ 10 min de diferencia (se reclama el segundo y se señala el primero). Puede ser un retorno real. |

La doctrina es la de siempre: **solo entra una línea con evidencia positiva en contra del cobro**. «Sin datos» (sin hora, TAG sin dar
de alta, caseta sin coordenadas, sin posiciones) no se reclama: se cuenta aparte en el resumen para saber qué dato falta. «Reclamable»
significa «hay evidencia suficiente para pedir la revisión», no «el cobro es indebido»; la decisión de reclamar es de la flota y la
leyenda del reporte lo dice. Las posiciones solo se piden para las líneas candidatas (el GPS dijo «no coincide» o «no alcanzan las
muestras»), no para todo el desglose.

**Pendiente de datos de la flota (no se inventa):** los **cursos** (rutas autorizadas por unidad dentro de geocercas) no se evalúan
hasta contar con su tabla; un cruce fuera de curso pero cerca de su caseta no aparece en el reporte. Tampoco hay posiciones reales
mientras no esté conectada la tabla/vista de GPS de la flota (bloqueo 4) ni el archivo real de pases (bloqueo 1): el E2E usa un CSV
sintético y un doble de GPS.

## Salida a SAP/ERP (por pull, configurable)

| Ruta | Área | Para qué |
|---|---|---|
| `GET /v1/peajes/desgloses` | `dinero` | Los desgloses vigentes con su resumen de conciliación medido (`limite` 1–50). |
| `GET /v1/peajes/exportacion?desglose=<uuid>` | `dinero` | La bitácora conciliada de UN desglose en el layout que pida: `columnas` (catálogo cerrado), `separador` (`coma`/`punto_y_coma`/`tab`), `decimal` (`punto`/`coma`), `fechas` (`iso`/`dmy`/`sap`), `bom`, `encabezado`. |

Cada fila trae `estado` (cuadra / sin respaldo / por verificar), `motivo` y `explicacion`; la doctrina viaja en el
encabezado `X-Likida-Leyenda`. Texto neutralizado contra fórmulas de Excel. No hay escritura a SAP: es pull.

## Retención (mig. 0562, cron `purgar`)

El **contenido** de los archivos en estado `fallida` se vacía a los 30 días (la fila queda de constancia; reprocesar exige
volver a subir el archivo). La ventana de WhatsApp (7 días) y el registro de envíos (90 días) también se purgan ahora.

## La cola y el cron

`peaje_ingesta_archivo` (unique flota+huella) → `/api/cron/peajes` reclama con `peaje_archivo_reclamar`
(`FOR UPDATE SKIP LOCKED` + lease de 5 min + token): dos cron simultáneos no toman el mismo archivo, un
worker muerto suelta el suyo al vencer el lease y solo quien conserva el token cierra el archivo.
Formato ilegible → `fallida` con el motivo (y corrida de fallo en la bitácora del agente); se reintenta desde
la pantalla tras declarar el mapeo. Fallo de infraestructura → reintento con backoff (1, 5, 15, 30 min) y
`fallida` al 5.º. El reproceso tras un crash no duplica el desglose (`desglose_peaje.ingesta_archivo_id`
único).

## Pruebas que existen

- Postgres real: `supabase/tests/0375_peajes_conciliacion.sql` (constraints, FK compuestas, RLS deny-all,
  claim, ventana GPS, grants, cron_latido; el claim verificado por mutación) y
  `0375_peajes_claim_concurrencia.sh` (6 sesiones, 60 archivos, cero duplicados; la mutación sin
  `SKIP LOCKED` la rompe). Ambas en `ci-postgres.yml`.
- Vitest: lector tolerante con fixtures sintéticos (`src/lib/likida/peajes/fixtures/`), Haversine y
  cruce GPS, catálogos, clasificador, cola, ruta firmada, cron, export, UI y dos recorridos completos:
  `flujo_completo.test.ts` (buzón firmado) y `ciclo_completo.e2e.test.ts` (ola 3: correo, pull, aviso, `/v1`, anulación;
  feliz, fallo, duplicado, fuera de orden y otro tenant).
- Postgres real: `supabase/tests/0563_peajes_correo_pull_anulacion.sql` (origen de la cola, CHECK de la config —token con
  forma y único entre flotas, URL https, credencial solo cifrada—, claim del pull con lease, barrido de avisos,
  anulación completa) y `0562_retencion_liquidacion_externa_y_peajes.sql`.

## BLOQUEOS (no cerrables por código)

1. **El archivo REAL de PASE** (columnas, fecha y hora, formato Excel/PDF) para calibrar el lector; hoy
   se lee por detección y por mapeo declarado, con fixtures sintéticos. Sin él no se puede afirmar que el
   formato real entre sin mapeo.
2. **De dónde sale el lado «gasto de caseta» con telepeaje** (CFDI consolidado de la plaza, monedero,
   captura del chofer): si nadie carga tickets, el estado es `por verificar / sin_gastos_cargados`, nunca
   «sin respaldo» (lo dice a propósito el clasificador).
3. **Catálogo oficial de casetas con coordenadas** (shapefile IMT u otro): hay importador por CSV y
   fixtures, pero ninguna coordenada real cargada.
4. **GPS de la flota conectado a Likida** (proveedor desconocido, detrás de Zero Trust) o su export:
   sin posiciones, el GPS dice `sin_datos`.
5. `PEAJES_INGESTA_SECRETO` en Vercel y que el sistema/proveedor firme y mande el archivo (hoy no hay
   API pública de PASE/IAVE/TeleVía; el envío lo haría un script o el TMS de la flota). Para el **correo**:
   `RESEND_EMAIL_DOMAIN` + `RESEND_API_KEY` + el webhook de Resend (`/api/correo/entrante`) configurados. Para el **pull**:
   un endpoint de la flota que cumpla el contrato de arriba y `LIKIDA_COFRE_LLAVE` si lleva token.
6. **SFTP**: no construido. Necesita instalar una librería SFTP (hoy no hay ninguna en el repo), el host/usuario/llave
   de la flota y su alta en el cofre; cuando exista, se implementa como otra fuente del mismo claim.
7. Salida a SAP: pull (lista + exportación configurable); no hay escritura a SAP ni webhook saliente.
8. Migraciones 0375/0376/0562/0563 sin aplicar a ninguna base remota (a propósito); aplicar antes de desplegar.
9. **Tabla de cursos / geocercas de la flota** y la lectura de sus posiciones de GPS: el reporte de reclamación ya usa las geocercas del
   catálogo de peajes y la tabla `posicion`; los cursos y el lector de sus tablas propias quedan para cuando entreguen el acceso.
10. El aviso a la oficina usa la plantilla `aviso_operacion_v1` fuera de la ventana de 24 h: hasta que Meta la apruebe,
   el aviso sale solo dentro de la ventana (y se reintenta).
