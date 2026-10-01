# Plantillas de WhatsApp (Meta) — catálogo versionado

> Generado desde `src/lib/meta/plantillas_catalogo.ts`. **No editar a mano**: una prueba falla si difiere. Regenerar con `npx tsx scripts/generar-doc-plantillas.ts`.

## Por qué hay plantillas

WhatsApp solo entrega texto libre y botones interactivos dentro de las **24 h posteriores al último mensaje del usuario**. Fuera de esa ventana, lo único que entra es una plantilla **aprobada por Meta**. Likida registra ese último mensaje por contacto (migración 0360, `wa_ventana_contacto`) y el selector `enviarConFallback` (`src/lib/meta/enviar_con_fallback.ts`) decide: ventana abierta → texto o botones; cerrada → plantilla; desconocida → texto y, si Meta lo rechaza por ventana (131047/131026/131042), plantilla. Cada decisión queda en `wa_envio_registro` con su motivo.

## Reglas del catálogo

- Todas **UTILITY** (operativas/transaccionales), idioma **es_MX** (excepción documentada: `respuesta_arco_v2` se aprobó en `es`).
- Una plantilla aprobada **no se edita**: un cambio de texto es un nombre nuevo (`_v2`). El nombre+idioma es único.
- Variables `{{1}}…{{n}}` consecutivas; el cuerpo no empieza ni termina con variable; los parámetros no llevan saltos de línea, tabuladores ni más de 4 espacios seguidos (el código los normaliza y rechaza los vacíos antes de llamar a Meta).
- **Una plantilla no puede pedir ubicación**: la Cloud API solo ofrece la solicitud como mensaje interactivo dentro de la ventana (`enviarSolicitudUbicacion`). Las plantillas del conductor traen un botón «Compartir ubicación»; al apretarlo el chofer abre la ventana y el sistema responde con la solicitud interactiva.
- Payload de botones de respuesta rápida: `<prefijo>:<viaje_id>` (≤ 128 caracteres); llega al webhook como cuerpo del mensaje del botón.
- Referencias de Meta: <https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview> · <https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/interactive-message-templates/> · <https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/location-request-messages>

## Cómo someterlas y verificarlas (sin ejecutar nada contra Meta desde CI)

1. **Verificar el estado** de todas (solo lectura, `GET /{WABA}/message_templates`): `npx tsx scripts/verificar-plantillas-meta.ts` — sin credenciales muestra el plan en seco; con `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_BUSINESS_ACCOUNT_ID` y la bandera `--consultar` consulta a Meta y compara estado de aprobación, categoría, idioma, cuerpo y botones contra este catálogo.
2. **Someter las nuevas**: el mismo script con `--crear --confirmo-meta-real` hace `POST /{WABA}/message_templates` SOLO de las que Meta no tiene. Sin esas dos banderas no escribe nada.
3. Aprobación: Meta tarda de minutos a 2–5 días hábiles. Hasta que una plantilla esté `APPROVED`, el envío devuelve `132001` y el selector lo reporta con ese motivo (fail-closed y dicho).
4. Si Meta reclasifica una plantilla a MARKETING, el script lo marca como desviación: sale más cara y con más límites; hay que apelar o reescribir.

## Plantillas en uso (8)

### `viaje_asignado`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Chofer — asignación de viaje. Avisar al chofer que le asignaron un viaje (inicia la conversación).
- **Llamador en código:** src/lib/likida/notificar.ts
- **Texto verificado contra Meta:** **NO** — reconstruido del código; cotejar con `scripts/verificar-plantillas-meta.ts`
- **Cuerpo exacto:**

  ```text
  Te asignaron un viaje en Likida.
  {{1}}
  {{2}}
  {{3}}
  {{4}}
  Manda por aquí la foto de cada ticket. Al cerrar el viaje te llega tu liquidación.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | folio | Viaje F-1042 |
| `{{2}}` | ruta | Ruta: Guadalajara → Monterrey |
| `{{3}}` | salida | Salida: 02/10/2026 |
| `{{4}}` | unidad y anticipo | Unidad ECO-114, anticipo $3,000.00 |

- **Botones:** ninguno

### `recordatorio_cierre`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Chofer — cobranza de comprobantes / recordatorio de aceptación. Recordar al chofer que cierre su viaje (cobranza de comprobantes y recordatorio de aceptación) cuando su ventana de 24 h está cerrada.
- **Llamador en código:** src/lib/likida/agentes/cobranza.ts, src/lib/likida/escalar_viaje.ts
- **Texto verificado contra Meta:** **NO** — reconstruido del código; cotejar con `scripts/verificar-plantillas-meta.ts`
- **Cuerpo exacto:**

  ```text
  Recordatorio de Likida: {{1}}, tienes pendiente cerrar el viaje {{2}}. Manda por aquí los tickets que falten y escribe LISTO para recibir tu liquidación.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | nombre del chofer | Juan Pérez |
| `{{2}}` | folio | F-1042 |

- **Botones:** ninguno

### `aviso_operacion_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Oficina / jefe de tráfico. Aviso genérico de operación al jefe/oficina cuando su ventana está cerrada (asistencia, cierre de liquidación).
- **Llamador en código:** src/lib/meta/aviso_oficina.ts
- **Texto verificado contra Meta:** **NO** — reconstruido del código; cotejar con `scripts/verificar-plantillas-meta.ts`
- **Cuerpo exacto:**

  ```text
  Aviso de operación de {{1}}: {{2}}. Detalle en {{3}}. Likida.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | chofer | Juan Pérez |
| `{{2}}` | resumen (≤ 60 caracteres) | sigue reportando lesionados |
| `{{3}}` | liga al panel o al mapa | https://app.likida.ai/dashboard/asistencia |

- **Botones:** ninguno

### `plazo_factura`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Facturación. Avisar que hay tickets con plazo de facturación por vencer (respaldo fuera de ventana).
- **Llamador en código:** src/lib/likida/facturacion/avisar.ts
- **Texto verificado contra Meta:** **NO** — reconstruido del código; cotejar con `scripts/verificar-plantillas-meta.ts`
- **Cuerpo exacto:**

  ```text
  Tienes {{1}} ticket(s) con plazo de facturación por vencer. Entra a tu panel de Likida para revisarlos.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | cuántos tickets | 3 |

- **Botones:** ninguno

### `respuesta_arco_v2`

- **Categoría:** UTILITY · **Idioma:** `es` · **Versión:** 2
- **Agente / uso:** Privacidad (ARCO). Entregar la respuesta a una solicitud ARCO cuando el titular está fuera de la ventana. OJO: se aprobó en idioma `es`, no `es_MX` (client.ts).
- **Llamador en código:** src/lib/meta/client.ts (enviarRespuestaArco)
- **Texto verificado contra Meta:** **NO** — reconstruido del código; cotejar con `scripts/verificar-plantillas-meta.ts`
- **Cuerpo exacto:**

  ```text
  Respuesta a tu solicitud de derechos ARCO de parte de {{1}}: {{2}} Si tienes dudas, responde a este mensaje.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | razón social de la flota | Transportes del Norte SA de CV |
| `{{2}}` | resolución | tu solicitud fue atendida |

- **Botones:** ninguno

### `gps_alerta_critica`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** GPS. Alerta GPS crítica con botón de acuse (se encola en wa_outbox con llave de idempotencia).
- **Llamador en código:** src/lib/meta/client.ts (encolarBotonesWhatsApp)
- **Texto verificado contra Meta:** **NO** — reconstruido del código; cotejar con `scripts/verificar-plantillas-meta.ts`
- **Cuerpo exacto:**

  ```text
  Alerta GPS de Likida: {{1}} Responde con el botón para acusar de recibido.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | texto de la alerta | La unidad ECO-114 salió de su geocerca a las 02:10. |

- **Botones:** «Enterado» (respuesta rápida, payload `gps_ack:<viaje_id>`)

### `siniestro_reportado_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Asistencia en carretera. Avisar de una incidencia en carretera al jefe (fase 0 de asistencia).
- **Llamador en código:** scripts/mandar-plantillas-meta-fase0.sh
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Incidencia en carretera: {{1}} reportó una incidencia. Tipo: {{2}}. Última ubicación conocida: {{3}}. Responde este mensaje para coordinar la atención.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | chofer | Juan Pérez |
| `{{2}}` | tipo de incidencia | choque |
| `{{3}}` | última ubicación | Carretera 180, km 45, cerca de Valladolid |

- **Botones:** ninguno

### `siniestro_sin_atender_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Asistencia en carretera. Escalar una incidencia que lleva tiempo sin atenderse.
- **Llamador en código:** scripts/mandar-plantillas-meta-fase0.sh
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  La incidencia de {{1}} sigue sin atenderse desde hace {{2}}. Último estado: {{3}}. Responde este mensaje ahora para tomar el caso.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | chofer | Juan Pérez |
| `{{2}}` | tiempo sin atender | 10 minutos |
| `{{3}}` | último estado | N2, sin respuesta del jefe |

- **Botones:** ninguno

## Plantillas nuevas, listas para enviar a aprobación (13)

### `regla_aviso_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Mis reglas (vigilante). Respaldo de «Mis reglas»: la regla que la flota confirmó encontró casos nuevos y su ventana de 24 h está cerrada.
- **Llamador en código:** src/lib/likida/reglas/vigilante.ts
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Tu regla de Likida encontró {{1}} caso(s) nuevo(s): {{2}} Revisa el detalle de cada caso en «Mis reglas» ({{3}}).
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | número de casos nuevos | 2 |
| `{{2}}` | frase que la persona confirmó (≤ 120 caracteres) | avisarte cuando entre un comprobante de casetas por más de $3,000.00. |
| `{{3}}` | liga a «Mis reglas» | https://app.likida.ai/dashboard/reglas |

- **Botones:** ninguno

### `conductor_solicitud_llegada_carga_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 5 — Conductor. Pedir al chofer que reporte su llegada a cargar (cita de carga próxima).
- **Llamador en código:** ninguno todavía (la usará el Agente 5)
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Hola {{1}}, tu viaje {{2}} tiene cita de carga en {{3}} a las {{4}}. Cuando llegues, toca «Ya llegué» para registrar tu llegada.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | nombre del chofer | Juan |
| `{{2}}` | folio | F-1042 |
| `{{3}}` | lugar de carga | Planta Zapopan |
| `{{4}}` | hora de la cita | 08:00 |

- **Botones:** «Ya llegué» (respuesta rápida, payload `hito_llegada_carga:<viaje_id>`); «Voy con retraso» (respuesta rápida, payload `hito_retraso_carga:<viaje_id>`); «Compartir ubicación» (respuesta rápida, payload `pedir_ubicacion:<viaje_id>`)

### `conductor_contacto_anden_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 5 — Conductor. Pedir al chofer el contacto en andén una vez que llegó a cargar.
- **Llamador en código:** ninguno todavía (la usará el Agente 5)
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Hola {{1}}, ya registramos tu llegada a {{2}} del viaje {{3}}. Responde con el nombre y teléfono de la persona que te recibe en el andén, o toca «Aún no tengo contacto».
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | nombre del chofer | Juan |
| `{{2}}` | lugar | Planta Zapopan |
| `{{3}}` | folio | F-1042 |

- **Botones:** «Aún no tengo contacto» (respuesta rápida, payload `hito_sin_contacto_anden:<viaje_id>`)

### `conductor_salida_carga_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 5 — Conductor. Confirmar la salida de la carga (y pedir la foto de la carta porte o remisión).
- **Llamador en código:** ninguno todavía (la usará el Agente 5)
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Hola {{1}}, ¿ya saliste de la carga del viaje {{2}}? Toca «Ya salí» para registrar tu salida y manda por aquí la foto de tu carta porte o remisión.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | nombre del chofer | Juan |
| `{{2}}` | folio | F-1042 |

- **Botones:** «Ya salí» (respuesta rápida, payload `hito_salida_carga:<viaje_id>`); «Sigo cargando» (respuesta rápida, payload `hito_sigue_cargando:<viaje_id>`)

### `conductor_llegada_descarga_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 5 — Conductor. Pedir que reporte su llegada al destino de descarga.
- **Llamador en código:** ninguno todavía (la usará el Agente 5)
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Hola {{1}}, tu viaje {{2}} descarga en {{3}}. Cuando llegues, toca «Ya llegué» para registrar tu llegada.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | nombre del chofer | Juan |
| `{{2}}` | folio | F-1042 |
| `{{3}}` | lugar de descarga | CEDIS Monterrey |

- **Botones:** «Ya llegué» (respuesta rápida, payload `hito_llegada_descarga:<viaje_id>`); «Compartir ubicación» (respuesta rápida, payload `pedir_ubicacion:<viaje_id>`)

### `conductor_salida_descarga_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 5 — Conductor. Confirmar el fin de la descarga y pedir la foto del comprobante de entrega (POD).
- **Llamador en código:** ninguno todavía (la usará el Agente 5)
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Hola {{1}}, ¿ya terminaste de descargar el viaje {{2}}? Toca «Ya salí» para registrar tu salida y manda por aquí la foto del comprobante de entrega.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | nombre del chofer | Juan |
| `{{2}}` | folio | F-1042 |

- **Botones:** «Ya salí» (respuesta rápida, payload `hito_salida_descarga:<viaje_id>`); «Sigo descargando» (respuesta rápida, payload `hito_sigue_descargando:<viaje_id>`)

### `conductor_recordatorio_1_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 5 — Conductor. Recordatorio escalonado 1 de 3: un hito del viaje sigue sin registrarse.
- **Llamador en código:** ninguno todavía (la usará el Agente 5)
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Hola {{1}}, todavía no tenemos registrado «{{2}}» del viaje {{3}}. Toca «Registrar ahora» o responde por aquí.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | nombre del chofer | Juan |
| `{{2}}` | hito pendiente | tu llegada a cargar |
| `{{3}}` | folio | F-1042 |

- **Botones:** «Registrar ahora» (respuesta rápida, payload `recordatorio_registrar:<viaje_id>`); «Tengo un problema» (respuesta rápida, payload `recordatorio_problema:<viaje_id>`)

### `conductor_recordatorio_2_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 5 — Conductor. Recordatorio escalonado 2 de 3.
- **Llamador en código:** ninguno todavía (la usará el Agente 5)
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Hola {{1}}, segundo aviso: sigue pendiente «{{2}}» del viaje {{3}} desde hace {{4}}. Si ya lo hiciste, toca «Registrar ahora»; si tienes un problema, dinos qué pasó.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | nombre del chofer | Juan |
| `{{2}}` | hito pendiente | tu salida de la carga |
| `{{3}}` | folio | F-1042 |
| `{{4}}` | tiempo pendiente | 30 minutos |

- **Botones:** «Registrar ahora» (respuesta rápida, payload `recordatorio_registrar:<viaje_id>`); «Tengo un problema» (respuesta rápida, payload `recordatorio_problema:<viaje_id>`)

### `conductor_recordatorio_3_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 5 — Conductor. Recordatorio escalonado 3 de 3: último aviso antes de escalar al jefe de tráfico.
- **Llamador en código:** ninguno todavía (la usará el Agente 5)
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Hola {{1}}, último aviso antes de avisar a tu jefe de tráfico: «{{2}}» del viaje {{3}} sigue pendiente desde hace {{4}}. Responde ahora para evitar la escalación.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | nombre del chofer | Juan |
| `{{2}}` | hito pendiente | tu llegada a descarga |
| `{{3}}` | folio | F-1042 |
| `{{4}}` | tiempo pendiente | 1 hora |

- **Botones:** «Registrar ahora» (respuesta rápida, payload `recordatorio_registrar:<viaje_id>`); «Tengo un problema» (respuesta rápida, payload `recordatorio_problema:<viaje_id>`)

### `aviso_jefe_trafico_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 5 — Conductor. Escalación al jefe de tráfico: un chofer no registró un hito tras los tres recordatorios.
- **Llamador en código:** ninguno todavía (la usará el Agente 5)
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Atención, jefe de tráfico: {{1}} no ha registrado «{{2}}» del viaje {{3}} ({{4}}). Última ubicación conocida: {{5}}. Revísalo en el tablero o llámale.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | chofer | Juan Pérez |
| `{{2}}` | hito pendiente | su llegada a descarga |
| `{{3}}` | folio | F-1042 |
| `{{4}}` | motivo de la escalación | sin respuesta a 3 recordatorios |
| `{{5}}` | última ubicación conocida | Carretera 15D km 120 |

- **Botones:** «Ya lo atiendo» (respuesta rápida, payload `jefe_atiendo:<viaje_id>`); «Abrir tablero» (URL fija https://app.likida.ai/dashboard/despacho)

### `vigia_respuesta_cliente_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 4 — Vigía de servicio al cliente. Respuesta de la flota a un CLIENTE (ya aprobada por el gerente) cuando su ventana de 24 h está cerrada. Solo sale a clientes con consentimiento y sin baja.
- **Llamador en código:** src/lib/likida/vigia/enviar.ts
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Respuesta de {{1}} sobre tu servicio de transporte: {{2}} Si ya no quieres recibir mensajes por este medio, responde BAJA.
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | razón social de la flota | Transportes del Norte |
| `{{2}}` | texto de la respuesta (≤ 300 caracteres, sin saltos de línea) | Tu viaje F-1042 va en curso; la última posición del GPS es de hace 12 minutos. |

- **Botones:** ninguno

### `vigia_aprobacion_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 4 — Vigía de servicio al cliente. Pedir al gerente, con un toque, que apruebe la respuesta que el Vigía redactó para un cliente (respaldo fuera de su ventana de 24 h).
- **Llamador en código:** src/lib/likida/vigia/avisos.ts
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Vigía de servicio: {{1}} escribió «{{2}}». Respuesta propuesta: «{{3}}». ¿La envío?
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | cliente | Compras Acme |
| `{{2}}` | mensaje del cliente (≤ 160 caracteres) | ¿Dónde va mi viaje F-1042? |
| `{{3}}` | respuesta propuesta (≤ 280 caracteres) | Tu viaje F-1042 va en curso; última posición hace 12 minutos. |

- **Botones:** «Enviar» (respuesta rápida, payload `vig_ok:<viaje_id>`); «No enviar» (respuesta rápida, payload `vig_no:<viaje_id>`); «Yo me encargo» (respuesta rápida, payload `vig_tomo:<viaje_id>`)

### `vigia_escalamiento_v1`

- **Categoría:** UTILITY · **Idioma:** `es_MX` · **Versión:** 1
- **Agente / uso:** Agente 4 — Vigía de servicio al cliente. Escalar al gerente responsable (nivel 1) o al dueño (nivel 2) un cliente molesto, que pide un humano o que lleva más del SLA sin respuesta.
- **Llamador en código:** src/lib/likida/vigia/avisos.ts
- **Texto verificado contra Meta:** sí (texto autoritativo del catálogo)
- **Cuerpo exacto:**

  ```text
  Vigía de servicio: el cliente {{1}} necesita atención ({{2}}). Nivel {{3}} de escalamiento. Revísalo en {{4}} o toca «Yo me encargo».
  ```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | cliente | Compras Acme |
| `{{2}}` | motivo (sin respuesta, molestia, pide un humano…) | lleva 45 minutos sin respuesta |
| `{{3}}` | nivel (1 o 2) | 1 |
| `{{4}}` | liga al tablero del Vigía | https://app.likida.ai/dashboard/agentes/vigia |

- **Botones:** «Yo me encargo» (respuesta rápida, payload `vig_tomo:<viaje_id>`)

