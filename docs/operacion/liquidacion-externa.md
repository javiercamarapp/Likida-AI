# Liquidación externa (Agente 1, modo «solo entrega»)

**Qué es.** El cliente de demo ya calcula la liquidación de su chofer en su
SAP/TMS. Lo que pidió (llamada del 31-ago) es que Likida **la entregue** al
chofer por WhatsApp, no que la recalcule. Este modo es el opuesto exacto del de
fotos: aquí la cifra **no es nuestra**.

- Likida **no recalcula** nada. Lo único que verifica al recibirla es que
  `total` sea la suma de los renglones (percepciones − deducciones, en
  centavos). Si no cuadra: 400 con la diferencia.
- Vive en tablas propias (`liquidacion_externa`, mig. 0370). **No se mezcla**
  con `liquidacion` (el cierre que cuadró el motor y firmó una persona) ni sale
  por `GET /v1/liquidaciones`.
- El modo de fotos no se toca.

## Flujo

```
SAP/TMS ──POST /v1/liquidaciones-externas──▶ Likida
                                              │ valida (estricto) · resuelve chofer · PDF (adjunto o generado) · guarda
                                              ▼
                              pendiente ──▶ en_cola ──▶ enviada ──▶ acusada
                                  │            │ (wa_outbox reintenta)   (el chofer aprieta un botón)
                                  └────────────┴──▶ fallida ──(panel: Reintentar)──▶ pendiente
```

| Estado | Significa |
|---|---|
| `pendiente` | Recibida; todavía no entra a la cola de WhatsApp (o espera un reintento con backoff). |
| `en_cola` | Vive en `wa_outbox`, la cola durable que reintenta contra Meta. |
| `enviada` | Meta aceptó el mensaje (hay `wamid`). El chofer todavía no responde. |
| `acusada` | El chofer apretó **Recibida** o **No coincide**. |
| `fallida` | Se agotaron los reintentos o Meta la rechazó sin remedio. Se dice por qué. |

El **201 del POST significa «recibida»**, no «entregada»: la entrega es
asíncrona. Un fallo de entrega **no** convierte una recepción exitosa en error.

## `POST /v1/liquidaciones-externas`

Llave de API con área `administracion`. Cuerpo máx. ~1.4 MB (el PDF adjunto,
opcional, pesa hasta 1 MB ya decodificado).

```json
{
  "claveExterna": "SAP-LIQ-000123",
  "sistemaOrigen": "SAP",
  "operador": { "telefono": "5512345678" },
  "viajes": ["VJ-100", "VJ-101"],
  "periodo": { "desde": "2026-09-01", "hasta": "2026-09-07" },
  "conceptos": [
    { "clave": "P010", "descripcion": "Sueldo base", "tipo": "percepcion", "monto": 3500 },
    { "clave": "D010", "descripcion": "Anticipo", "tipo": "deduccion", "monto": 1000.25 }
  ],
  "total": 2499.75,
  "moneda": "MXN"
}
```

- **Estricto**: cualquier campo desconocido es 400 (incluido `tenant_id`: la
  flota sale de la credencial). Más de dos decimales se rechaza, no se
  redondea. Un renglón sin `monto` no es un renglón de cero. Textos largos o con
  saltos de línea se rechazan.
- **`operador`**: al menos `id`, `telefono` o `numeroEmpleado`. Si mandas
  varios, todos tienen que apuntar al **mismo** chofer; un chofer dado de baja
  se rechaza.
- **`pdf`** (opcional) `{ base64, nombre? }`: se entrega **el tuyo**, comprobado
  por sus bytes (`%PDF-`, `%%EOF`, sin `/JavaScript`, `/Launch`, archivos
  incrustados). Es una heurística, no un sandbox. Sin `pdf`, Likida genera uno
  con tus cifras.
- **Idempotencia por `claveExterna`**: mismo folio + mismo contenido → `200`
  `idempotente: true`; mismo folio + otro contenido → `409` (no se sobrescribe:
  el chofer pudo haberla visto; una corrección va con otra clave, p. ej.
  `…-R1`). `Idempotency-Key` es opcional.

## `GET /v1/liquidaciones-externas`

Área `dinero`. Paginación **solo por cursor** (`despues`). Filtros: `estado`,
`respuestaChofer` (`recibida` | `no_coincide`), `operadorId`, `claveExterna`,
`desde`, `hasta`. La respuesta nunca trae la ruta del PDF, URLs firmadas ni el
teléfono del chofer, y el error de WhatsApp sale como `fallo: { codigo, texto }`
(nunca el cuerpo crudo de Meta).

## Tablero y exportación

`/dashboard/agentes/liquidacion` → sección **Liquidaciones externas**: fichas
(No coincide · Fallaron · Pendientes · En cola · Enviadas · Con respuesta), tabla
con estado, vía (sesión/plantilla) y respuesta del chofer, descarga del PDF,
**Reintentar** (solo en `fallida`) y **Exportar CSV** por periodo (máx. 3 meses,
`GET /api/export/liquidaciones-externas`; el CSV neutraliza fórmulas de Excel).

## Entrega por WhatsApp

1. **Sesión** (dentro de las 24 h del último mensaje del chofer): un solo
   mensaje interactivo con el PDF como encabezado, el resumen (periodo y total
   con moneda) y dos botones: **Recibida** / **No coincide**.
2. Si la **ventana ya está cerrada** (registro `wa_ventana_contacto`) se encola
   directo la plantilla `liquidacion_externa_v1`; si Meta contesta *ventana
   cerrada* (131047 / 131026 / 131042) a la sesión, **cae a la plantilla** (una
   sola vez). Lo decide el selector central (ver más abajo).
3. Todo viaja por `wa_outbox` (llave de deduplicación `liqext:<id>:g<n>:<canal>`):
   encolarlo dos veces es la misma fila. **La RPC `encolar_wa_outbox_dedupe`
   valida el payload por prefijo de llave (mig. 0560): antes solo aceptaba la
   alerta GPS y esta entrega habría fallado contra la base real.**
4. El botón llega al webhook (`interactive.button_reply` en sesión, `button.payload`
   en plantilla) y el processor lo atiende **antes** del agente y **aunque el
   chofer no tenga viaje abierto**. El operador sale de su teléfono, no del id
   del botón: un id ajeno no acusa la liquidación de otro chofer.
5. `/api/cron/liquidaciones-externas` (cada 5 min, latido propio) reencola lo que
   no se pudo encolar (backoff 2/4/8/16 min, 5 intentos) y concilia contra el
   outbox.

### El selector central de canal

`EntregaWhatsApp.enviarConFallback(msg)` (`src/lib/likida/liquidacion_externa/entrega.ts`)
es idempotente y delega en el **selector central en modo durable**
(`enviarConFallbackDurable`, `src/lib/meta/enviar_con_fallback.ts`):

- ventana de 24 h **cerrada** (registro `wa_ventana_contacto`) → se encola
  directo la plantilla `liquidacion_externa_v1` del catálogo, con el PDF en su
  encabezado de documento;
- ventana **abierta o desconocida** → se encola el mensaje de sesión (botones
  con el PDF en el encabezado, un solo mensaje);
- si Meta rechaza la sesión por ventana (131047/131026/131042) → se encola la
  plantilla, una vez (llaves `liqext:<id>:g<n>:sesion` / `:plantilla`);
- cada decisión deja una fila en `wa_envio_registro` (contexto `liquidacion_externa`).

La plantilla vive en `plantillas_catalogo.ts` y se documenta en
`docs/operacion/plantillas-meta.md` (generado). **El orden de las variables es el
del catálogo:** `{{1}}` nombre · `{{2}}` sistema de origen · `{{3}}` periodo ·
`{{4}}` total con moneda.

## Salida hacia el SAP/TMS del cliente (pull) — mig. 0561

Likida no empuja nada al sistema del cliente (no hay webhook saliente en este
repo: el de la rama del Conductor no existe todavía; cuando exista, esta salida
puede colgarse de él). El cliente **jala** con su llave de API:

| Ruta | Área | Para qué |
|---|---|---|
| `GET /v1/liquidaciones-externas/acuses` | `dinero` | Los acuses de los choferes (`recibida` / `no_coincide`) que su sistema **aún no confirmó** haber leído. Del más viejo al más nuevo, por cursor. |
| `POST /v1/liquidaciones-externas/acuses/confirmar` | `administracion` | `{ "ids": [...] }` (1–200): confirma lo que ya registró. **Idempotente**; `noAplican` agrupa lo inexistente, ajeno o sin acuse. |
| `GET /v1/liquidaciones-externas/exportacion` | `dinero` | Archivo CSV/TSV con el layout que pida: `columnas`, `granularidad` (`liquidacion`/`concepto`), `separador`, `decimal`, `fechas` (`iso`/`dmy`/`sap`), `bom`, `encabezado`, y los filtros del listado + `sinConfirmar=1`. |

**Ciclo recomendado:** `GET acuses` → registrar en su sistema → `POST confirmar`.
Lo no confirmado vuelve a salir (una caída a mitad de su proceso no pierde
ninguno). Si el chofer **cambia** su respuesta, la confirmación anterior se
reinicia y el acuse nuevo sale otra vez. La exportación es **completa o nada**:
sobre 900 liquidaciones responde `lectura_incompleta` y pide acotar el rango.
Seguridad: celdas de texto neutralizadas contra fórmulas de Excel, nunca sale el
error crudo de entrega (solo `falloCodigo`), nunca el teléfono ni la ruta del PDF.

Ejemplo de layout para un asiento contable en Excel en español:
`/v1/liquidaciones-externas/exportacion?granularidad=concepto&separador=punto_y_coma&decimal=coma&fechas=sap&bom=1&sinConfirmar=1`.

## «No coincide» avisa a la oficina — y el aviso tiene red (mig. 0643–0645)

Cuando el chofer aprieta **No coincide**, además de marcarla en el panel, se
avisa por WhatsApp a la persona responsable (ver el orden de preferencia en la
sección siguiente) con el selector central (texto en ventana, plantilla
`aviso_operacion_v1` fuera). El aviso lleva chofer y clave, **sin cifras**.
Al chofer solo se le dice «ya le avisé a tu oficina» si el aviso salió al menos
a una persona (Meta lo aceptó o ya quedó en la cola de salida); si no salió, se
le dice que quedó marcada en el panel y que avise directo.

**Con las migraciones 0643–0645 el aviso ya no es «una vez y se acabó»:**

1. **Atómico.** El acuse y su aviso nacen en **una** transacción (`registrar_acuse_no_coincide`).
   De dos entregas del mismo botón solo una lo gana, y solo esa avisa.
2. **Estado persistido** (`liquidacion_aviso_discrepancia`, una fila por liquidación y
   «ciclo»; cambiar de respuesta y volver a decir «No coincide» abre un ciclo nuevo):
   `pendiente → enviando → enviado | fallido`. Se **reclama con arriendo** antes de
   mandar (dos invocaciones no duplican el WhatsApp) y guarda **a quién ya le llegó**.
3. **Reintento en el cron `liquidaciones-externas`.** Lo que no llegó se reintenta con
   espera creciente (2, 4, 8, 16 min), **solo a los faltantes**, hasta 5 intentos; agotado
   queda `fallido`. Un rechazo transitorio que ya quedó en la cola de salida cuenta como
   entregado (reenviarlo lo duplicaría). Un aviso que sigue `pendiente` o `fallido` deja el
   latido del cron en `parcial`.
4. **Tarea durable.** Antes de mandar el WhatsApp se abre una tarea en la cola del
   orquestador (destino `liquidacion`, motivo `diferencia_liquidacion`, **una abierta por
   liquidación**; el resumen no lleva cifras ni números largos). Si el WhatsApp no sale, la
   discrepancia ya está a la vista de una persona.
5. **Panel.** Junto a «No coincide» se pinta el estado del aviso («Oficina avisada», «Aviso
   pendiente», «El aviso no llegó», «Aviso sin registrar») y el botón **Reavisar** rearma el
   aviso fallido o pendiente y lo manda ya (no repite a quien ya lo recibió; uno ya
   enviado no se rearma). Queda `aviso_oficina` en la bitácora (`destino: discrepancia`,
   `tarea_orquestador` o `reavisar`).

**Sin las migraciones** (0643/0644) todo funciona como antes: «No coincide» queda atómico por
una transición condicional en el código, se avisa una vez, el resultado queda en la bitácora
(`aviso_oficina` con `enviado`) y **no hay** estado, reintento ni rótulo en el panel (jamás se
inventa uno). «Reavisar» en esa base manda el aviso una vez más, a petición.

## El formato de la flota, la copia al jefe y la persona responsable (mig. 0564)

**Alcance de la fase 1 tal como lo pidió la flota:** la flota calcula en su sistema;
Likida toma el dato del pago y lo manda al operador **en el formato de la flota**
(el Excel que hoy se copia y se pega), con **copia al jefe de flota**, y una
discrepancia («No coincide») **avisa a la persona responsable**. No incluye OCR de
tickets ni facturas (fase 2).

**Pantalla:** `/dashboard/agentes/liquidacion/formato` (área dinero; solo el dueño
guarda).

1. **Formato.** Se sube un Excel de muestra; Likida lee la primera hoja y deriva la
   plantilla: título, datos de arriba (operador, folio, periodo, viajes…), columnas
   de la tabla con sus encabezados y la fila de total. Lo que no reconoce **no se
   inventa**: se avisa («No reconocí estas columnas y NO se imprimirán»). Después se
   pueden renombrar encabezados, elegir fechas (`DD/MM/AAAA` o `AAAA-MM-DD`), ocultar el
   total y elegir qué documento viaja por WhatsApp (PDF o Excel).
2. **Salida.** Cada liquidación nueva genera el PDF **y** el Excel con esas columnas
   (mismas cifras que mandó el cliente; el total es el del cliente, nunca una fórmula).
   En el panel cada fila trae «PDF» y «Excel». El PDF que adjunta el cliente manda:
   no se reformatea ni se genera Excel. Una liquidación que llegó **antes** de
   configurar el formato no tiene Excel (el enlace da 404 con su razón).
3. **Copia al jefe de flota.** Hasta 3 teléfonos designados. Cuando la entrega al
   chofer queda en cola o enviada, cada uno recibe **una** copia (resumen + liga del
   documento, vigente 24 h) por el selector central de avisos. Es idempotente (la
   bitácora recuerda que ya salió: evento `aviso_oficina` con `destino: copia_jefe`),
   nunca retrasa ni tumba la entrega al chofer y se puede **reenviar** desde el panel
   («Copia al jefe»). **Sin teléfonos designados no se manda copia a nadie**: la copia
   lleva cifras y no se adivina el destinatario.
4. **Discrepancia.** «No coincide» avisa, en este orden de preferencia, a (a) los
   teléfonos de «persona responsable» designados, (b) si no hay, los de la copia al
   jefe, (c) si tampoco, quien ve dinero (como antes). Al chofer solo se le promete «ya
   avisé a tu oficina» si Meta aceptó el aviso a **al menos una** persona.

**Teléfonos sin Excel de muestra (mig. 0645).** Una flota con el PDF genérico no necesita
subir un formato para designar a quién se le copia ni quién revisa discrepancias: en la
misma pantalla captura los teléfonos y la fila queda con el formato vacío (el documento sigue
saliendo con el PDF genérico). Subir la muestra o quitar el formato **no borra** los
teléfonos. Sin la 0645, guardar teléfonos sin muestra lo dice en palabras y pide aplicarla
(subir la muestra y capturarlos ahí sigue funcionando).

Sin la 0564 aplicada todo funciona como antes (la tabla ausente se trata como «sin
formato»). El fallo de lectura **distinto** de «tabla ausente» no cae en silencio al
formato genérico: la recepción falla (500) para que el sistema del cliente reintente.

**Pendiente de campo:** el formato REAL de la flota. Hasta tener su Excel, el
diccionario de encabezados (`formato_flota.ts`, sinónimos por campo) está calibrado
con muestras sintéticas; un encabezado nuevo es una línea. El Excel real también
decidirá si hace falta un campo más (p. ej. horas, kilómetros por concepto).

## Retención y purgas (mig. 0562, cron `purgar`)

| Dato | Plazo | Notas |
|---|---|---|
| `wa_ventana_contacto` (teléfono + hora del último mensaje del chofer) | 7 días | La ventana de Meta dura 24 h. |
| `wa_envio_registro` (canal y motivo de cada aviso; solo últimos 4 dígitos) | 90 días | |
| `liquidacion_externa` en estado terminal (`enviada`, `acusada`, `fallida`) | **60 meses** (piso 24) | Decisión de política: CFF art. 30 / conservación laboral. El PDF se encola en `storage_huerfano_candidato` y el cron lo borra de Storage por la API. Una `pendiente`/`en_cola` jamás se purga. La cancelación ARCO del operador **no** anonimiza estas filas: caducan aquí. |
| Contenido de `peaje_ingesta_archivo` en estado `fallida` | 30 días | La fila queda de constancia; reprocesar exige volver a subir el archivo. |

Las cuatro corren en `/api/cron/purgar` (secreto de cron, kill switch global y
latido ya existentes); una purga que falla se grita y se avisa al operador pero
no tumba a las demás. **El plazo de 60 meses es una decisión de política que
Javier/su abogado deben confirmar** (ver bloqueos).

## BLOQUEOS EXTERNOS (no cerrables por código)

1. **Plantilla Meta `liquidacion_externa_v1`** (categoría *utility*, idioma
   `es_MX`) — dar de alta y esperar aprobación (2–5 días hábiles o más). Hasta
   entonces, las liquidaciones a choferes **fuera de la ventana de 24 h** quedan
   `fallida` con `fallo.codigo = plantilla_no_aprobada`. Definición a registrar:
   - Encabezado: **documento** (PDF).
   - Cuerpo: `Hola {{1}}, esta es tu liquidación de {{2}}. Periodo: {{3}}. Total: {{4}}. El detalle va en el PDF. ¿Te cuadra? Responde con un botón.`
   - Variables: `{{1}}` primer nombre · `{{2}}` sistema de origen (o «tu empresa») · `{{3}}` periodo · `{{4}}` total con moneda.
   - Botones de respuesta rápida: `Recibida`, `No coincide`.
2. **Número real de WhatsApp (WABA verificada)**. Con el número de prueba, Meta
   solo entrega a teléfonos dados de alta a mano (131030).
3. **Contrato real de API de Meta**: el payload de plantilla con encabezado de
   documento y botones `quick_reply` y el de sesión con encabezado de documento en
   botones siguen la documentación de Cloud API, pero **no se verificaron contra
   Meta real**; las pruebas usan dobles de contrato.
4. **Aplicar las migraciones 0370 y 0560–0562 en producción** (con respaldo previo; sin 0560 la entrega por la cola falla; luego `[deploy]`): la compuerta
   de despliegue no construye si la base va atrás de la última migración.
5. **Integración del lado de la flota**: su SAP/TMS tiene que llamar al
   endpoint (acceso bajo Zero Trust, llave de API de área `administracion`).
6. **Excel de muestra de la flota** (el «formatito» que hoy copian y pegan) y los teléfonos del jefe de flota y de la persona responsable de discrepancias: sin ellos la entrega sale con el PDF genérico y sin copia.
7. **Plantilla de avisos `aviso_operacion_v1`** aprobada en Meta: la copia al jefe y el aviso de discrepancia usan texto dentro de las 24 h y esa plantilla fuera; sin ella, fuera de ventana quedan `no_enviada` (dicho en el panel, reenviable).
8. **Aplicar la migración 0564** (aditiva e idempotente; el código corre sin ella, pero el formato y la copia no se guardan hasta aplicarla).
9. **Aplicar las migraciones 0643, 0644 y 0645** (aditivas e idempotentes; el código corre sin ellas, pero sin la 0643/0644 el aviso de «No coincide» no tiene estado, reintento ni «Reavisar», y sin la 0645 los teléfonos no se guardan sin Excel de muestra). La tarea para una persona requiere además la 0650.
10. **Confirmar el plazo de retención** (60 meses para liquidaciones externas) con quien lleve lo legal.

## Límites conocidos (pendientes)

- No hay **anulación/corrección** de una liquidación ya recibida: se manda una
  nueva con otra `claveExterna`.
- La URL firmada del PDF dentro del mensaje vive 24 h (la cola reintenta con
  backoff); cada reintento manual la renueva.
- La cancelación ARCO del operador no anonimiza `liquidacion_externa`
  (retención laboral/fiscal): decisión de política pendiente.
- No hay webhook saliente hacia el sistema del cliente: la salida es por pull
  (acuses + exportación). Un empujón con política anti-SSRF queda pendiente de
  que exista el de la rama del Conductor.
- La confirmación de acuses es por id de Likida; no hay confirmación por
  `claveExterna`.
