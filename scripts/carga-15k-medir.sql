-- ═══════════════════════════════════════════════════════════════════════════
-- carga-15k-medir.sql — las consultas CALIENTES reales, con EXPLAIN ANALYZE
--
-- Correr DESPUÉS de scripts/carga-15k.sql y DESPUÉS de aplicar la 0111.
-- Cada bloque es la traducción SQL literal de una consulta del código (el
-- `.range(d,h)` de PostgREST es LIMIT/OFFSET; el `.order(desc)` es DESC).
-- Pegar la salida en docs/escala-15k.md § "Resultados de la corrida".
--
-- UMBRAL (justificado en el doc): consulta de PANTALLA < 100 ms; página de
-- 1,000 de un agregado < 100 ms; consulta del camino del WEBHOOK < 50 ms.
-- ═══════════════════════════════════════════════════════════════════════════

-- El tenant sembrado por carga-15k.sql:
--   aaaaaaaa-0000-4000-8000-000000015000

-- ── PANTALLAS ───────────────────────────────────────────────────────────────

-- [P1] getViajes (analytics.ts:954) — /dashboard/viajes, inicio, mapa, etc.
--      Índice esperado: viaje_reciente_idx (tenant_id, created_at desc).
explain (analyze, buffers)
select id, folio, origen, destino, estatus, anticipo, fecha_inicio, avisado_en
from viaje where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
order by created_at desc limit 100;

-- [P2] getDocumentos (analytics.ts:990) — bandeja del Agente OCR.
--      Índice esperado: gasto_reciente_idx.
explain (analyze, buffers)
select id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, estado_sat, ocr_confianza
from gasto where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
order by created_at desc limit 100;

-- [P3] getLiquidaciones (analytics.ts:1752) — tabla de Cuadre.
--      Índice esperado: idx_liq_tenant (tenant_id, created_at desc).
explain (analyze, buffers)
select id, estatus, total_comprobado, diferencia, created_at
from liquidacion where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
order by created_at desc limit 50;

-- [P4] contarViajes (analytics.ts:846) — el conteo real de los KPI.
explain (analyze, buffers)
select count(*) from viaje
where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000';

-- [P5] contarEscalados (analytics.ts:939) — abiertos escalados sin aceptar.
explain (analyze, buffers)
select count(*) from viaje
where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
  and estatus in ('abierto', 'en_cuadre')
  and escalado_en is not null and aceptado_en is null;

-- ── AGREGADOS (forma de página de traerTodo: LIMIT 1000 OFFSET d) ──────────

-- [A1] getKpis (analytics.ts:184) — página 1 y página PROFUNDA (la 12 de 12):
--      el OFFSET re-lee todo lo anterior; la última página paga el histórico.
explain (analyze, buffers)
select total_comprobado, diferencia, estatus, diferencias
from liquidacion where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
order by id limit 1000 offset 0;

explain (analyze, buffers)
select total_comprobado, diferencia, estatus, diferencias
from liquidacion where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
order by id limit 1000 offset 11000;

-- [A2] getSerieComparativa.gasto (analytics.ts:107) — ventana de 60 días
--      (mensual: 2 pasos de 30). SIN la 0111 esto filtraba recorriendo el
--      tenant entero; CON ella debe salir de gasto_tenant_fecha_idx.
explain (analyze, buffers)
select fecha, monto
from gasto where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
  and fecha >= (current_date - 59) and fecha <= current_date
order by id limit 1000 offset 0;

-- [A3] getSerieComparativa.viaje (analytics.ts:113) — misma ventana.
--      Índice esperado: viaje_tenant_fecha_inicio_idx (0111).
explain (analyze, buffers)
select fecha_inicio, estatus
from viaje where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
  and fecha_inicio >= (current_date - 59) and fecha_inicio <= current_date
order by id limit 1000 offset 0;

-- [A4] getGastosFiscales (fiscal.ts:811) — el panel del contador, periodo
--      'ejercicio', 21 columnas. Página 1 y página profunda (45 de 45).
explain (analyze, buffers)
select id, viaje_id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, cfdi_valido,
       estado_sat, efos, efos_revisar, forma_pago, sub_total, iva_traslado, ieps_traslado,
       clave_prod_serv, tipo_comprobante, xml_verificado, ocr_confianza, ocr_extra
from gasto where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
  and fecha >= date_trunc('year', current_date)::date and fecha <= current_date
order by id limit 1000 offset 0;

explain (analyze, buffers)
select id, viaje_id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, cfdi_valido,
       estado_sat, efos, efos_revisar, forma_pago, sub_total, iva_traslado, ieps_traslado,
       clave_prod_serv, tipo_comprobante, xml_verificado, ocr_confianza, ocr_extra
from gasto where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
  and fecha >= date_trunc('year', current_date)::date and fecha <= current_date
order by id limit 1000 offset 44000;

-- [A5] getAcumuladoCombustible (repo.ts:927) — corre EN CADA CUADRE.
--      El `.or()` de PostgREST es este OR; el orden fecha,id viene del código.
explain (analyze, buffers)
select monto, forma_pago
from gasto where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
  and (concepto = 'diesel' or clave_prod_serv in ('15101505','15101514','15101515'))
  and fecha >= (date_trunc('year', current_date))::date
  and fecha <= (date_trunc('year', current_date) + interval '1 year - 1 day')::date
order by fecha, id limit 1000 offset 0;

-- [A6] candidatos del JOIN de consolidados (intake/consolidado.ts:267) —
--      tenant + cfdi_uuid IS NULL + rango de un mes. Con la 0111 debe usar
--      gasto_tenant_fecha_idx (la mitad sembrada trae cfdi_uuid NULL).
explain (analyze, buffers)
select id, concepto, monto, fecha
from gasto where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
  and cfdi_uuid is null
  and fecha >= (current_date - 30) and fecha <= current_date
order by id limit 1000 offset 0;

-- [A7] Los RPC agregados de la 0064 (getValorAhorro / getResumenCosto):
--      el patrón al que el doc propone migrar los agregados de JS.
explain (analyze, buffers)
select resumen_documentos_tenant('aaaaaaaa-0000-4000-8000-000000015000');

explain (analyze, buffers)
select resumen_costo_ia_tenant('aaaaaaaa-0000-4000-8000-000000015000', null, null);

-- ── CAMINO DEL WEBHOOK (cada mensaje de WhatsApp) ──────────────────────────

-- [W1] getOpenViaje (conv.ts:165) — índice esperado:
--      uq_viaje_abierto_por_operador (tenant_id, operador_id) parcial.
explain (analyze, buffers)
select v.id from viaje v
where v.tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
  and v.operador_id = (select id from operador
                       where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
                       and telefono = '5215559000007')
  and v.estatus in ('abierto', 'en_cuadre')
order by v.created_at desc limit 1;

-- [W2] resolver operador por teléfono (conv.ts:101) — idx_operador_tel.
explain (analyze, buffers)
select id, tenant_id, nombre, telefono from operador
where telefono in ('5215559000007', '525559000007') and activo = true limit 2;

-- [W3] dedup de foto por hash (repo.ts:213) — uq_gasto_img_hash parcial.
explain (analyze, buffers)
select viaje_id, monto from gasto
where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
  and img_hash = 'hash-que-no-existe' limit 1;

-- [W4] gastos de UN viaje (repo.ts:664 → el motor de cuadre) — idx_gasto_viaje.
explain (analyze, buffers)
select id, concepto, monto, fecha, folio, cfdi_uuid, forma_pago
from gasto
where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
  and viaje_id = (select id from viaje
                  where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000'
                  and folio = 'ZZZ-000500');

-- [W5] el claim de idempotencia (conv.ts:345) — INSERT contra la PK.
--      En transacción revertida: no deja rastro.
begin;
explain (analyze, buffers)
insert into wa_mensaje_procesado (wa_message_id) values ('ZZZ-MEDIR-CLAIM-1');
rollback;
