# Anexo de subencargados — borrador con proveedores reales

**Estado:** BORRADOR. Los proveedores, el servicio y los datos salen del código
del producto (variables de entorno, SDK y rutas que los llaman; ver
`.env.example`). Región, retención, contrato/DPA y subprocesadores propios NO
están confirmados: cada celda `[PENDIENTE]` se llena con el contrato real del
proveedor, no con una suposición. Hasta entonces NO se entrega a un cliente
enterprise como si fuera el anexo definitivo (A37-L-08). Lo pendiente del
abogado vive en `PENDIENTES-ABOGADO.md`.

| Proveedor | Servicio | Datos que le llegan | Región | Retención | Base contractual | Estado |
|---|---|---|---|---|---|---|
| Meta (WhatsApp Business Platform) | Canal de mensajes con operadores, jefes y clientes | Teléfono, texto, fotos, audios y documentos que el operador manda; plantillas salientes | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` |
| OpenRouter (enruta a modelos de Google, OpenAI y Anthropic) | Lectura de comprobantes (OCR), agente de cuadre, redacción | Imágenes de comprobantes, texto de mensajes y consultas; datos fiscales y capturas del portal de facturación si la flota factura tickets | `[PENDIENTE]` | `[PENDIENTE]` (se pide no retener lo procesado) | `[PENDIENTE]` | `[PENDIENTE]` |
| Supabase | Base de datos, autenticación y Storage | Todo el dato operativo de la flota: operadores, viajes, gastos, liquidaciones, bitácoras, archivos | `[PENDIENTE]` | Ver `RETENCION.md` | `[PENDIENTE]` | `[PENDIENTE]` |
| Vercel | Hosting de la aplicación y de los crons | Tráfico y registros de ejecución de la aplicación | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` |
| Resend (entrega vía Amazon SES) | Correo transaccional: avisos, acceso por enlace, buzón de facturas | Correo y nombre del destinatario, contenido del aviso | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` |
| Sentry | Monitoreo de errores | Trazas de error (el logger redacta teléfonos y datos personales antes de emitir) | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` |
| Upstash (Redis y QStash) | Límites de uso, pisos de alerta y colas de tareas | Identificadores técnicos y huellas, no el contenido de los mensajes | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` |
| Stripe | Cobro de la mensualidad con tarjeta | Datos fiscales de facturación de la empresa y datos de la tarjeta (Likida no los ve completos) | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` |
| SW Sapien / Facturapi (PAC) | Timbrado y cancelación de CFDI | XML del comprobante con RFC, razón social y datos del viaje | `[PENDIENTE]` | Conservación fiscal del PAC `[PENDIENTE]` | `[PENDIENTE]` | `[PENDIENTE]` |
| SAT (servicio de verificación y descarga masiva) | Verificar y descargar CFDI | RFC de la flota y UUID de comprobantes | México | Fija el SAT | Norma fiscal | Autoridad, no subencargado contractual |

Proveedores de GPS/telemetría de cada flota: se contratan por flota; el listado
vive en los conectores activos de esa flota y no aquí.

Para cada proveedor anexar: contrato/DPA, política de retención, ubicación,
subprocesadores propios, mecanismo de cambios, contacto de incidente y evidencia
de eliminación.
