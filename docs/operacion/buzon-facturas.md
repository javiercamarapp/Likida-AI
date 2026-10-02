# Agente 9 — Buzón de facturas (recepción PDF/zip y entrega al contador)

> Estado (2-oct-2026, rama `loop/w3-buzon-cobranza-reglas`): **cerrado en código, no en campo.**
> Migraciones **0530** y **0531** escritas y probadas contra Postgres 17 local (cadena 0001..0531 desde cero, re-aplicables);
> **NO aplicadas a ninguna base real**. Lo que depende de terceros vive en «Bloqueos externos».

## Qué hace

Antes (auditoría §3): solo leía el XML del CFDI de un correo, el PDF se contaba y se descartaba, el zip «todavía no» se
abría, y la entrega a contabilidad era «bandeja de aprobación humana y descarga manual de un CSV».

Ahora:

1. **Entra** cualquier combinación de XML, PDF y ZIP por la dirección de correo de la flota.
2. **Se lee** cada archivo, con rastro por archivo (`buzon_recepcion`): el XML es el dato duro; un PDF **solo** se lee
   (texto del PDF y, si no alcanza, visión) y queda **marcado para revisión humana** si la confianza es < 0.8; un PDF que
   acompaña a su XML se cuelga de su factura (por folio fiscal o por nombre); si el XML llega después de un PDF solo, lo
   completa con el dato duro y quita la marca.
3. **Una persona aprueba o rechaza** (LFPDPPP 26-II: el agente prepara, la persona decide). Esto no cambia.
4. **Sale al contador** lo aprobado, por correo, en lotes: CSV (genérico, SAP B1 o CONTPAQi) y ZIP con el XML y el PDF de cada
   factura. Manual («Enviar ahora») o automático (una vez al día a la hora configurada, con mínimo de facturas).

## El ciclo (criterio a–i)

| | Eslabón | Dónde |
|---|---|---|
| a | Entrada real | Webhook firmado de Resend `api/correo/entrante` (firma Svix antes de leer el cuerpo; flota por el **destinatario**, nunca por el remitente). Descarga **bytes** con tope por tipo (XML 4 MB, PDF/ZIP 12 MB) y por correo (30 MB). |
| b | Lógica | `buzon/ingesta.ts` (orquestación), `zip_seguro.ts` (lector de zip a prueba de bombas), `xml_seguro.ts` (sin DTD/XXE), `pdf_factura.ts` (texto→visión, confianza), `entrega_pura.ts` + `entrega.ts` (lotes, backoff). |
| c | Persistencia con RLS | `buzon_recepcion` (0530), columnas nuevas de `factura_proveedor` (revisión, fuente, PDF, `entrega_id`), `buzon_entrega_config`, `buzon_entrega`, `buzon_entrega_evento` (0531); bucket privado `buzon-facturas`. RLS deny-all + `service_role`; FK compuestas (nada cuelga de otra flota). |
| d | Salida | Correo por Resend (`enviarCorreo` con adjuntos, tope 28 MB crudos) con **llave de idempotencia por lote**; confirmación `entregada`/`rebotada` por el webhook de eventos de Resend. |
| e | Cron con claim | `/api/cron/buzon-entrega` cada 15 min (puerta `CRON_SECRET`, interruptor global fail-closed, latido). **Reserva** de facturas por UPDATE condicional (`entrega_id is null`: una factura nunca viaja en dos lotes); **claim con lease** de 5 min por lote; backoff 15 min, 1 h, 4 h, 12 h y a los 5 intentos queda `fallida`, visible. Retención de la bitácora de archivos (365 días) en el cron `purgar`. |
| f | UI sin botones muertos | `/dashboard/agentes/proveedores`: «Lo que ha llegado por correo» (motivo por archivo, Ver PDF por URL firmada de 5 min, Descartar), marcas en la bandeja (lectura de PDF, «Entregada al contador»), «Entrega al contador» (config solo para el dueño, Enviar ahora, historial con Reintentar/Cancelar). Cada botón existe solo en el estado en que se promete. |
| g | Pruebas | Ver abajo (incluye 2 E2E con dobles de proveedor). |
| h | Integración externa | Resend (correo entrante, saliente y eventos), el SAT (estatus del CFDI, ya existente) y el modelo de visión; todo detrás de interfaces con dobles. |
| i | Documentación | Este archivo. |

## Seguridad del archivo entrante (repo público: sin recetas)

- **Zip:** límites de entradas, bytes por entrada y totales, razón de compresión, profundidad 1, sin zip64/multidisco/cifrado,
  sin rutas ni solapes; lo que se pasa se **rechaza y se anota** (no se reintenta). Un nombre de entrada nunca se usa como ruta.
- **XML:** se rechaza cualquier DTD/entidad antes de parsear; el chequeo de «empieza como XML» es lineal (sin ReDoS).
- **PDF:** tope de tamaño, texto de las primeras páginas, protegido/corrupto = rechazado con motivo.
- **Aislamiento:** toda consulta ancla `tenant_id`; el PDF vive en bucket privado y solo se abre con URL firmada de 5 min por tenant.
- **Honestidad de cifras:** el IVA no se guarda de un PDF (el desglose exige el XML); el correo al contador avisa cuando una factura del lote
  no tiene XML. La aprobación humana es lo único que mueve una factura a «entregable».

## Contra una base SIN migrar

El código funciona con la producción actual (sin 0530/0531): el insert de la factura reintenta sin `fuente_datos`, el rastro y la
lectura previa degradan a vacío, un PDF/zip que no se puede guardar se **ignora con su motivo** (`BuzonSinMigrar`, sin 503 al correo),
la bandeja se lee con la lista de columnas de antes, la entrega se dice «no disponible» y el cron no tiene qué hacer.

## Pruebas

- Unitarias/E2E con dobles: `buzon/ingesta_e2e.test.ts` (zip XML+PDF, PDF de baja confianza, XML posterior, reintento idempotente, XXE y bomba, fallo transitorio),
  `buzon/entrega_e2e.test.ts` (lote con CSV+ZIP, reserva atómica, dos corridas solapadas = un correo, backoff, agotamiento, PDF que no baja, automático una vez al día),
  `buzon/entrega_pura.test.ts`, `buzon/zip_seguro.test.ts`, `buzon/xml_seguro.test.ts` (adversarial), `buzon/pdf_factura.test.ts`, `buzon/pdf_adaptador.test.ts` (PDF real),
  `buzon/sin_migrar.test.ts`, webhooks `api/correo/entrante` y `api/correo/eventos`, `correo/enviar_adjuntos.test.ts`, render `proveedores/seccion_buzon.test.tsx`.
- SQL contra Postgres real: `supabase/tests/0530_buzon_facturas.sql` (cubre 0530 y 0531), listado en `ci-postgres.yml`; corrido en local sobre la cadena completa 0001..0531.

## Bloqueos externos

- **Autorización de Javier** para aplicar 0530 y 0531 a la base real (con respaldo previo) y crear el bucket `buzon-facturas` (lo crea la 0530).
- **Resend:** `RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN` con SPF/DKIM verificados, ruta de correo entrante y los **dos** webhooks (`RESEND_WEBHOOK_SECRET` entrante y `RESEND_EVENTOS_WEBHOOK_SECRET` eventos) apuntando a producción.
- **Correo real del contador de Innovativos** y su formato de importación (el layout SAP B1/CONTPAQi es estándar, **sin compatibilidad certificada**: se valida con su consultor).
- **Archivos reales de proveedores** (PDF y zip) para medir la exactitud de la lectura de PDF: hoy solo hay fixtures; el umbral 0.8 y la confianza máxima 0.9 del texto son heurística declarada.
- Modelo de visión del PDF: el slug vigente en `llm/models.ts` sin verificar contra el proveedor en vivo.

## Pendientes reales (no se hicieron)

- Dedup por contenido entre correos distintos usa el sha256 del archivo; un PDF regenerado por el proveedor con otro hash pasa por la lectura otra vez.
- El borrado de los PDF encolados por la retención lo hace el cron `purgar` de la **corrida siguiente**.
- No hay reintento de recepción «desde la pantalla» (reprocesar un archivo en error); hoy el reintento es el del correo (Resend).
- Entrega directa a SAP B1 (Service Layer) y envío a más de 5 destinatarios no se construyeron.
