# Auditoría prod — DATOS, DINERO E INTEGRIDAD (22-ago-2026)
## CRÍTICO
- DAT-01 processor.ts:1176 imgHash solo con LIKIDA_DEDUP_FOTOS='1'; :1455 addGasto sin img_hash; say() tras addGasto fuera del try (:1600-1614) lanza → reintentable → cron reprocesa → gasto duplicado. Huérfanos :1022/:1524 sin imgHash; guardarHuerfano sin unique; adjuntar :2202-2227 N veces. Fix: hash siempre; gasto.wa_message_id unique(tenant_id, wa_message_id); imgHash en jsonb del huérfano + unique parcial.
- DAT-02 tools.ts:256 computeCuadre → :316 PDFs → :321 saveLiquidacion; fotos no toman viaje_lock; guardar_liquidacion_tx (0021:29-51) inserta liquidacion antes de tocar viaje → gasto que entra en la ventana queda fuera del PDF. en_cuadre nunca se escribe. Fix: for update de viaje al inicio de guardar_liquidacion_tx + p_n_gastos y raise si difiere (cierra DAT-14).
- DAT-03 DELETE cascade viaje→gasto/liquidacion (0001:60,70; 0145); policies for all → encargado/contador pueden DELETE por PostgREST; sin before delete; sin deleted_at. Fix: trigger before delete (rechazar si hay liquidación) + policies sin DELETE para authenticated.
- DAT-04 saas/suscripcion.ts:303-334 decide crear/actualizar con fila local que solo existe tras webhook; idempotency key incluye priceId (stripe.ts:294) → segunda suscripción viva invisible (insert choca suscripcion_una_viva → 500). Fix: fila provisional con stripe_subscription_id; GET subscriptions?customer status=all antes; clave sin priceId.
## ALTO
- DAT-05 facturacion_escritura.ts:384-406 registrarPago no atómico → saldo negativo. Fix: RPC registrar_pago_tx con for update.
- DAT-06 administracion.ts:640-655 reabrirViaje borra liquidacion y luego update viaje (puede fallar por uq_viaje_abierto_por_operador) → liquidado sin liquidación. Fix: RPC reabrir_viaje_tx (update primero; liquidacion_historico).
- DAT-07 0042:18-30 trigger solo 6 columnas; concepto/forma_pago/clave_prod_serv/cfdi_orden y viaje.anticipo editables tras liquidar. Fix: ampliar when + before delete + trigger en viaje(anticipo, operador_id) si liquidado.
- DAT-08 fiscal.ts:1011-1012 T00:00:00Z; analytics.ts:42-47 corteVentana UTC; inicio-contenido.tsx:80-92 y inicio-contador.tsx:66-76 toISOString → ejercicio en UTC. Fix: -06:00 / hoyMx().
- DAT-09 facturar/route.ts:311, cola/route.ts:93, pendientes.ts:119, al_vuelo.ts:228,349 hoy UTC → tickets vencidos de más (= RES-13).
- DAT-10 suscripcion.ts:487-523/415-476 upsert incondicional; webhook sin evt.created (= RES-11).
- DAT-11 suscripcion.ts:261-269 cambiar stripe_price_id huérfana suscripciones viejas. Fix: plan_price histórico o conservar plan_clave por stripe_subscription_id.
- DAT-12 aplicarFactura :506-521 sin metodo_cobro ('transferencia' default 0057) → índice una_por_periodo choca con in_B de Stripe; invoice.voided ignorado. Fix: metodo_cobro 'stripe' + backfill; voided→cancelada.
- DAT-13 transferencia.ts:226-246/278-285/334-337 conciliar+timbrar sin CAS → dos CFDI. Fix: update where estado<>'pagada'; timbrando_en.
- DAT-14 guardar_liquidacion_tx (0021:37,51) no verifica tenant de p_viaje (se cierra con DAT-02).
- DAT-15 comercial.ts:56-60,136-145; clientes.ts:630-635 traerTodo viaje (→ S3).
- DAT-16 supabase/seed.sql:61-67,111 sobrescribe tenant 11111111 (G3M real); seed.sh sin guard de prod. Fix: guard por nombre; rehusar *.supabase.co sin --produccion.
- DAT-17 = ESC-1 (→ F1).
## MEDIO
- DAT-18 ocr.ts:312 z.number() sin max; acuse_ticket.ts:93-116 confianza ≥0.9 no mira monto. Fix: confirmar si monto > max(3×anticipo, 50,000); montoImplausible → revisar.
- DAT-19 OCR/XML no leen Moneda/TipoCambio → USD como MXN. Fix: leer ambos; diferencia moneda_extranjera.
- DAT-20 tenant.config 4 escritores lee-mezcla-escribe (administracion.ts:437-449,480-492; repo.ts:1015-1022; estrategia.ts:70-82). Fix: RPC tenant_config_merge (config || p_parcial).
- DAT-21 conv.ts:574-580 acquireViajeLock fail-open tras 12 s; lease 60 s < cierre peor caso. Fix: ttl 120 s en cierre; cron descarta textos de viaje liquidado; fail-closed.
- DAT-22 guardar_liquidacion disponible en todo turno; solo candado cierre en ceros (tools.ts:275-283). Fix: ctx.cierrePedidoPorTexto y tool lanza si false.
- DAT-23 factura_saldo.vencida y defaults current_date UTC (0049:124,39,97; 0048:116; 0052:57); costos-facturacion/page.tsx:104-110 mes UTC; chat-tools.ts:42-44 hoyIso UTC; pagada_en now(). Fix: at time zone MX; hoyMx().
- DAT-24 webhook/route.ts:189 payment_failed monto 0 → "transfiere $0.00". Fix: por evt.type.
- DAT-25 transferencia.ts:131-136 mensualidad manual a flota con Stripe = doble cobro. Fix: rechazar si stripe_subscription_id.
- DAT-26 cfdi_uuid text case-sensitive en 4 tablas; enriquecer_gasto_codigo (repo.ts:598) sin lower. Fix: check (cfdi_uuid = lower(cfdi_uuid)) + lower en escritores.
- DAT-27 cascade factura_emitida→pago_recibido y cliente→tarifa; crearFactura .delete() compensación (:316). Fix: restrict.
- DAT-28 sin CHECK fecha_fin>=fecha_inicio, fechas futuras, gasto.fecha; ventanaDelViaje (fecha_dudosa.ts:58-61) hoy UTC. Fix: checks + hoyMx.
- DAT-29 encargado lee/escribe cfdi_xml, llm_costo, wa_conversacion (tenant_data 0086:38-49). Fix: tenant_finanzas; wa_conversacion/viaje_lock deny-all.
- DAT-30 liquidacion.diferencias sin check jsonb_typeof='array' → revienta kpis_liquidacion_tenant. Fix: check.
- DAT-31 llm_costo consolidación O(n) sin purga (= ESC-10); purgar_wa_mensaje_procesado borra claims sin completar → and completado_en is not null.
- DAT-32 sin candado livemode Stripe (stripe.ts:33-37). Fix: rechazar livemode mismatch; lanzar en prod con sk_test.
- DAT-33 charge.refunded/invoice.voided/credit_note ignorados; sin cancelarCfdi; CFDI sin email al cliente (transferencia.ts:315-342). Fix: eventos→cancelada; cancelarCfdi; email + verification_url.
- DAT-34 webhook/route.ts:159-165,366-370 rate limit antes de dedup de wamids. Fix: consultar wa_evento_pendiente por wamids antes del rateLimit.
## BAJO
- DAT-35 storage sin limpieza al borrar gasto/liquidacion/pod/tenant.
- DAT-36 folios sin btrim/upper (0092:22, 0049:69). Fix: check btrim + índice upper.
- DAT-37 codigo_pendiente sin unique (0016); say() en catch tras guardarCodigoPendiente (processor.ts:1361-1384); XML sin Total → monto 0 xml_verificado (processor.ts:1950).
- DAT-38 timestamp de Meta no se lee (route.ts:387-421) → hitos con hora de procesamiento.
- DAT-39 NOT VALID permanentes en viaje (0099:53,76); incidencia.monto_estimado sin >=0 (0107:39); tiers jsonb sin check (0089:29); ve_finanzas/is_superadmin search_path sin pg_temp (0001:96,102).
- DAT-40 Stripe menores: tenant.plan al cancelar (:474); trial sin vencimiento (:117-123); plan $0; RFC genérico G03; current_period_end con API ≥2025-03-31 (route.ts:147,156); idempotency customer-${tenant} 24 h; MAX_BODY 256 KB.
- DAT-41 PDF con randomUUID (tools.ts:301) ≠ id de guardar_liquidacion_tx.
