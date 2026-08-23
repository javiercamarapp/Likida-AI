# Auditoría prod — RESILIENCIA (22-ago-2026)

## CRÍTICO
- RES-1 Meta 429/bloqueo: cobranza.ts:266-310 y escalar_viaje.ts:261-276 reclaman el tier/escalación ANTES de enviar; meta/client.ts:122-147 no clasifica 130429/131056/131048/131049/132015/132016; sin circuit breaker; un solo número para todos los tenants. Fix: no consumir claim si código reintentable; contador de rechazos → parar + alertarOperador('wa.rechazo_masivo').
- RES-2 instrumentation.ts:10-27 await verificarMigracionesCriticas → startup.ts:48-230 11 sondeos SECUENCIALES sin acotada (25 s backstop c/u). Fix: Promise.allSettled + acotada + void (no await en register()).
- RES-3 ocr.ts:272-281 fallo_tecnico sin codigo/status → un solo issue Sentry; 402 no transient → sin fallback, sin alertarOperador. Fix: codigo+status en meta; contador consecutivo → alertarOperador('ocr.caido'); 401/402/403 alerta inmediata.
## ALTO
- RES-4 openrouter.ts:19-36 new OpenAI sin timeout ni maxRetries:0 (SDK reintenta 2× + Retry-After 60 s); escalera propia ×3 → hasta 9 peticiones; abort registrado con costoUsd 0. Fix: maxRetries:0, timeout 30 s; abort → costo.no_medido.
- RES-5 correo/enviar.ts:97-122 fetch sin signal, awaited en interruptores.ts:93-111 (webhook after() y crons). Fix: AbortSignal.timeout(5000) + void alertarOperador en caminos de 120 s.
- RES-6 cobranza.ts:344-378 orden de tenants determinista + corte a 90 s → inanición; ~3-4 s por viaje → 600-700 contactos/día global. Fix: rotar orden; lotes por tenant vía QStash; alertar si cortadosPorReloj 3 corridas seguidas.
- RES-7 crons muertos invisibles: 401 sin log en 5 rutas; sin_secreto sin alertarOperador; sin latido. Fix: ultimo_latido + /admin/salud + alerta > 20 min; codigo 'cron_401'.
- RES-8 Storage (comprobantes, liquidaciones) sin backup ni runbook. Fix: copia semanal a S3/R2 + DEPLOY.md.
- RES-9 startup.ts sonda solo hasta 0043; conv.ts usa 0149, wa_pendientes 0119, suscripcion 0132. Fix: comparar schema_migrations vs lista del repo; regla migración aditiva antes que código.
- RES-10 facturación emitir: muerte a media sesión + CLAIM 10 min + cron horario = segundo CFDI; QStash reintenta 5xx. Fix: autofactura_bloqueada_en "emisión en curso" antes de abrir sesión.
## MEDIO
- RES-11 suscripcion.ts:415-476 Stripe fuera de orden: aplicar solo si evt.created > último.
- RES-12 stripe.ts:93-97 fetch sin timeout → AbortSignal.timeout(15000).
- RES-13 cron/facturar/route.ts:311 y cola/route.ts:93 hoy UTC → hoyMx().
- RES-14 wa_evento_pendiente nunca se purga (datos personales). Fix: purgar_wa_evento_pendiente(90) en mantenimiento_de_datos.
- RES-15 processor.ts:2448-2508 LLM caído → "reenvía"; degradar a cuadrarDesdeDB+resumenCuadre si isTransientError.
- RES-16 almacen.ts:74-84 fallo de upload → warn y gasto sin imagen; contador → error con codigo + alertarOperador.
- RES-17 alerta.ts:44-77 piso 1 h en memoria por instancia → Redis.
- RES-18 meta/client.ts:122-128 sendText lanza (sin try/catch) vs sendTemplate/sendDocument {ok:false}; processor.ts:2599 say() del cierre propaga → PDF nunca se manda. Fix: mismo contrato.
- RES-19 estaApagado('global') en cada after() del webhook; kill switch no cubre Stripe ni correo/eventos. Fix: caché 5-10 s por instancia.
- RES-20 ingesta route.ts:59-61 tope 6 MB > límite Vercel 4.5 MB → bajar a 4 MB.
## BAJO
- RES-21 autofactura.no_procede en info; warn si facturados=0 && intentados>0 ×3.
- RES-22 factura_folio_unico (0049:69) ¿(tenant_id, folio) sin año/serie? verificar.
- RES-23 QstashClient.publishJSON sin timeout.
- RES-24 costo Vercel a escala: medir GB-h.
