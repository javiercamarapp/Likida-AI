# Auditoría prod — ESCALA fuera del dashboard (22-ago-2026)
## CRÍTICO
- ESC-1 cron/wa-pendientes/route.ts:37 LOTE=10 en serie, cada 5 min, 120 s → ~60 msg/h vs 490-1,100/h de entrada; sin_tiempo consume intento (wa_pendientes.ts:96-107, MAX 5). Fix: cada minuto, lote 25-50 con conPool(5), auto-reencolar vía QStash mientras el lote salga lleno; no contar sin_tiempo como intento.
## ALTO
- ESC-2 wa_evento_pendiente recibe fila por CADA mensaje (webhook route.ts:194) y no se purga (4-10 GB/año). Fix: purgar_wa_evento_pendiente(30) procesado_en not null (cartas muertas 180 d) en mantenimiento_de_datos + índice parcial.
- ESC-3 escalar_viaje.ts:114 limit 100, :261-366 serie sin reloj, :267 reclama antes de enviar, hasta 4 llamadas Meta/viaje (10 s timeout c/u) → >120 s; muere tras sellar escalado_en y antes de cobranza. Fix: venceEn 30 s antes del claim; cortadosPorReloj; o dos crons.
- ESC-4 cobranza.ts:347-379 orden determinista + 90 s global → inanición de flotas. Fix: rotar inicio por hora; presupuesto por flota.
- ESC-5 cron/facturar/route.ts:134 TOPE_POR_CORRIDA=8/hora (192/día) vs ~170-340 sueltos/día; :333 limit+1 no mide backlog. Fix: QStash un mensaje por flota con lote 8-20; cron cada 15 min; count head del backlog.
- ESC-6 admin/negocio.ts:215-223 traerTodo viaje+gasto de todos los tenants (→ S4 lo arregla).
- ESC-7 admin/capacidad.ts:42-43 columnas inexistentes (creado_en/creada_en) + .limit(10000) → 1,000 silencioso. Fix: RPC sum/count.
- ESC-8 api/export/liquidaciones/route.ts:72-91 CSV entero en memoria sin periodo (>4.5 MB al mes 1); proveedores.ts:434 limite 5000 → 1,000 silencioso. Fix: desde/hasta obligatorio ≤3 meses + stream; proveedores con traerTodo/count.
- ESC-9 admin/flotas/page.tsx:160 + pmf.ts:105-130: 7 count exact × N flotas sin pool. Fix: RPC senales_pmf_todas() group by tenant_id o conPool(4).
## MEDIO
- ESC-10 llm_costo 200k/mes sin purga; consolidar_llm_costo_mensual (0072:95-115) reagrupa toda la historia; resumen_costo_ia(null,null) en cada carga de /admin. Fix: p_desde 90 d; consolidar solo últimos 2 meses; purgar >13 meses; unstable_cache 5 min.
- ESC-11 comercial.ts:347-356 getEstadoRastreo traerTodo posicion; sin purga ni índice (tenant, medida_en). Fix: RPC count distinct/max; purga 90 d.
- ESC-12 facturacion/pendientes.ts:126-135 getPorFacturar traerTodo gasto sin cfdi sin fecha (llamado por cron facturar :216). Fix: fecha >= hoy-45 d y concepto facturable.
- ESC-13 bucket comprobantes sin file_size_limit/mime ni retención (61 GB/mes). Fix: 8 MB image/*; política de purga/frío.
- ESC-14 api/dashboard/archivo/route.ts:22 MAX_BASE64 16 MB > 4.5 MB Vercel; xlsx en memoria. Fix: 4 MB o subir a Storage.
- ESC-15 api/v1/viajes/route.ts:55-66 count exact por petición + getViajes(desp+lim) rebanado; VENTANA_MAXIMA 1,000 (< 1 día a 50k). Fix: cursor (created_at,id), count opcional, range real.
- ESC-16 purga nocturna delete sin tandas, 120 s. Fix: tandas de 50k con tope de tiempo / parcial + reencolar.
## BAJO
- ESC-17 bitacora_auditoria y cobranza_contacto sin retención (365/180 d).
- ESC-18 sin ANALYZE tras importar_viajes >1,000 filas.
- ESC-19 inventario admin traerTodo acotado por población (sin rotura).
