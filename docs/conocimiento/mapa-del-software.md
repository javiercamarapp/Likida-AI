# El mapa del software — todo lo que existe y cómo funciona (16-ago-2026)

Mapeo completo por 6 exploradores en paralelo sobre el código real. Cada
afirmación salió de leer archivos, no de memoria. Compañero del
`plan-de-cierre.md` (las fases) y del `stack-modelos-agentes.md` (los modelos).

## 1 · El flujo que ES el producto (WhatsApp → liquidación)

`/api/webhook/whatsapp` (HMAC + cap 256KB + 40/min por teléfono con 429 para
que Meta reentregue + persist-ANTES-del-200 o 503 + pool de 5) →
`wa_pendientes` (inbox durable, claim anclado, 5 intentos → carta muerta
visible; cron cada 5 min que también vigila el SLA de la cola urgente) →
`processor.ts` (2,490 líneas: idempotencia por `claimMessage`, presupuesto
compartido de 120s con reserva de cierre, mutex por viaje, barrera de ráfaga,
aviso de privacidad ANTES de tratar, ARCO siempre contesta, una foto jamás se
rechaza → huérfanos) → `intake/` (OCR visión+JSON en una llamada; el QR
SOBRESCRIBE al OCR; SAT con timeout 4s que jamás tumba — `pendiente` ≠
inválido; XML del CFDI con conciliación ±$1/±1 día; claves de peaje →
concepto caseta) → `cuadre/engine.ts` (1,183 líneas PURO, sin LLM ni IO — el
LLM orquesta, EL MOTOR DECIDE EL DINERO; `cubetaDe()` es la única definición
de deducible; citas solo del corpus `normas/`) → guardias deterministas
(cifras sin tool ese turno → se reemplaza por el resumen del motor;
"ya cerró" se coteja contra el servidor; citas solo de lo que una tool
devolvió) → `liquidacion/pdf.ts` (SIN LLM, DOS ejemplares — lo
`SOLO_CONTRALOR` jamás viaja al chofer) → `meta/client.ts` (521→52 o Meta
rebota en silencio; wamid = aceptado, NO entregado).

Las 3 tools del agente de liquidación no aceptan parámetros: el modelo decide
CUÁNDO, jamás CON QUÉ DATOS. `guardar_liquidacion` es mutación con kill
switch previo y backstop `unique(viaje_id)`.

## 2 · Los dos paneles

**Cliente (`/dashboard`, 33 páginas)**: inicio por rol (dueño/encargado/
contador), detalle de liquidación, despacho + viajes + import, operadores/
unidades con vigencias, mapa (ilustrativo: sin GPS), carta porte 3.1, las 6
ventanas de agentes (liquidación, facturas, cobranza, conductores, peajes,
proveedores), huérfanos, combustible-casetas con mesa de conciliación,
rentabilidad (vacía POR DATOS, no por código), clientes/tarifas, facturación
(registra el CFDI del PAC del cliente — Likida no timbra), chat con datos
(bloques tipados + guardia de cifras + tope de gasto), conocimiento (corpus),
suscripción (Stripe/transferencia), conexiones/integraciones/llaves API,
usuarios, políticas, configuración, ARCO, soporte, notificaciones, mi-perfil.
Única librería de UI: `admin/ui/kit.tsx` + `graficas.tsx`. Deuda del mapeo:
mi-perfil sin gate de ruta; usuarios/políticas/ARCO fuera del sidebar;
notificaciones invisibles al contador pese al comentario; incidencias y POD
sin pantalla destino.

**Superadmin (`/admin`, 39 rutas)**: consola, copiloto (14 tools de lectura +
10 acciones — 2 implementadas: apagar_agente y correr_runner; el resto
declara `implementada:false`), catálogo de agentes (0116: una fila = un
agente), aprobaciones (la cola con CHECK enviado-solo-aprobado), flotas +
ficha 360, vendedores (censo 829), costos-facturación (mueve dinero real),
consumo por agente, crecimiento (Meta Ads solo pausar/leer), observabilidad
(kill switch de 8 + bitácora append-only), salud del sistema medida,
actividad de código, compliance ARCO, y 8 empty-states honestos (playground,
evals, RAG, trust-safety, comunicación, dev, cobranza, forecast). Deuda:
copiloto sin tope de gasto, /admin/corridas sin índice, 3 mapeos
tool→pantalla rotos, escalaciones no resuelve in situ.

## 3 · La API (32 handlers, sin middleware — puerta por ruta)

5 webhooks firmados (WhatsApp HMAC, Stripe, correo entrante Svix fail-closed,
eventos de entrega Svix manual, cola QStash) · 5 crons Vercel con
`CRON_SECRET` (escalar cada hora, facturar :30, purgar 4:15, runner cada 4h,
wa-pendientes cada 5 min — los 5 en vercel.json, cero huérfanos) · `/v1` con
API key `lk_live_` + `Idempotency-Key` + 404-no-oráculo + `?tenant=` borrado
en el borde · dashboard con sesión + área + tope de gasto (chat) · export con
doble rate-limit + `puedeExportar` · salud y OpenAPI públicos a propósito.
Cuatro patrones de puerta distintos conviven (`abrir()`,
`resolverTenantApi`, `getSessionTenant`, `sesionSuperadmin`) — elegir mal en
una ruta nueva no se detecta solo.

## 4 · El modelo de datos (65 tablas + 1 vista)

Núcleo: `tenant` (config jsonb ES la política — `politica_gasto` está
muerta), `viaje` (la más caliente: 67 refs, un abierto por operador, folio
único, lock por RPC), `gasto` (cfdi_uuid e img_hash únicos por tenant;
triggers prohíben tocar tras liquidar; `ocr_raw` muerta), `liquidacion`
(solo por RPC transaccional), consolidados/desgloses de peaje, huérfanos,
`factura_proveedor`, WhatsApp (conversación/procesados/pendientes), chat.
Comercial: `cliente`/`tarifa`/`factura_emitida`/`factura_viaje`/
`pago_recibido` — **todas CON escritor** (vacías por falta de clientes),
vista `factura_saldo`, suscripciones SaaS con idempotencia Stripe,
`prospecto` (censo) + `prospecto_contacto` (cadencia atómica por RPC) +
`campana`. Agentes: `agente_definicion` (catálogo declarativo),
`agente_corrida` (best-effort), `cola_aprobacion` (el CHECK hace IMPOSIBLE
enviar sin aprobar), configs de cobranza/notificaciones, historial del
copiloto, `llm_costo`. Infra: `viaje_lock`, `api_idempotencia`,
`correo_procesado`, `bitacora_auditoria` (append-only real: UPDATE/DELETE
negados), `solicitud_arco` (vence_en materializado), `tenant_api_key` (solo
SHA-256), `conector_credencial` (cifrado por la app), `interruptor` (SIN
FILA = ENCENDIDO; falla cerrado al revés del resto A PROPÓSITO),
`impersonacion_dia`.

SIN escritor real: `posicion`, `geocerca`, `terminal` (huérfana desde 0001),
`mantenimiento`, `cotizacion`, `portal_credencial`, `invitacion`,
`campania`/`envio_mensaje` (muertas de facto). `ticket_mensaje` SALIÓ de esta
lista el 29-ago-2026: la 0268 y `lib/likida/soporte.ts` cerraron el ciclo del
ticket (responder, tomar, cerrar, reabrir) desde las dos pantallas. **PENDIENTES DE APLICAR EN PROD: 0115-0125** — el código
ya escribe contra todas; sin migs, esas rutas fallan en producción.

## 5 · El back office autónomo

Runner nivel 2 (4 candados fail-closed: kill switch declarado, opt-in en DB,
techo de dinero MEDIDO, backpressure de 20) con UNA rama despachable
(redactor). Redactor C5 (cadencia 48h leída antes de gastar, cifras solo
canónicas, tres prohibiciones en el system). Cola de aprobación (3 acciones
ancladas a `pendiente`, claim con RETURNING + compensación, tope 30/día,
cadencia atómica con advisory lock). Y las **21 rutinas launchd locales**
(mejora diaria de código, DOF diario que también escribe el fix de software,
auditoría semanal por rubro con ataques, marketing diario completo, video con
gate por sequence, automejora, GTM, Jarvis 2×/día + vigía de producción cada
2h) — mapa en `scripts/mejora-diaria/ESQUELETO-AUTONOMIA.md`; todo reporta al
WhatsApp personal de Javier.

## 6 · Lo que el pitch promete y el código todavía no entrega

37 portales → 1 automatizado (CAPUFE) · registro de dos lados con escritor
pero cero filas · "CFO 63%" cuenta funciones, no horas · dunning inexistente
· el único efecto de red real es el catálogo de comercios curado a mano ·
"RLS en 47 tablas" ≠ el aislamiento real (service_role salta RLS; lo que
aísla es `.eq('tenant_id')` a mano en 106 archivos) · estímulo IEPS en
litros, no pesos (y ASÍ DEBE QUEDARSE hasta el fiscalista — ver
plan-de-cierre) · normas/ es catálogo pasivo, no motor · GPS vacío · SAP =
export CSV · emisión CFDI construida pero apagada sin revisión legal del
mandato · el 602 del SAT es ambiguo (jamás decir "apócrifa") · dedup no
detecta el papel re-fotografiado · corrida real punta a punta con cliente:
CERO (el onboarding nunca se ha corrido).
