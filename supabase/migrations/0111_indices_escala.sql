-- ═══════════════════════════════════════════════════════════════════════════
-- 0111 — Los rangos de fecha por tenant no los servía ningún índice.
--
-- Contexto: cliente de 15,000 viajes/mes en puerta (~500/día, ~45,000
-- comprobantes/mes). La auditoría de escala (docs/escala-15k.md) barrió TODAS
-- las consultas calientes contra los 99 índices existentes. Casi todo ya está
-- servido — (tenant_id, id) por la 0061, (tenant_id, created_at) por la 0061 y
-- 0001, los claims del webhook por sus uniques (0002, 0005, 0027, 0029) — con
-- UNA familia huérfana: filtrar por RANGO DE FECHA dentro de un tenant.
--
-- ── gasto (tenant_id, fecha) ────────────────────────────────────────────────
--
-- Es la forma de consulta MÁS repetida de los dos módulos de agregados, y
-- ninguna variante existente la sirve: `gasto_paginacion_idx` es
-- (tenant_id, id), `gasto_reciente_idx` es (tenant_id, created_at) — `fecha`
-- es la del COMPROBANTE, no la de captura (fiscal.ts:785 explica por qué el
-- corte del contador va por `fecha`) — y `idx_gasto_acumulado` es
-- (tenant_id, concepto, fecha): exige igualdad en `concepto` antes de poder
-- acotar por fecha, y las consultas de abajo no la traen.
--
-- Las consultas reales que lo piden (todas `.eq('tenant_id').gte/lte('fecha')`):
--   · fiscal.ts:811-814      getGastosFiscales — el panel del contador; su
--                            periodo por defecto es el EJERCICIO completo
--   · analytics.ts:107-109   getSerieComparativa.gasto — las tarjetas KPI del
--                            Resumen, en cada carga (ventanas 7/30 días)
--   · analytics.ts:478-480   getGastoPorSemana — 5/13/52 semanas
--   · analytics.ts:1135-1137 getTopRutasPorGasto con ventana
--   · repo.ts:938-940        getAcumuladoCombustible — corre EN CADA CUADRE
--                            (camino del webhook, ~12,000 veces/mes con este
--                            cliente) sobre el ejercicio entero; su `.or()`
--                            de concepto/clave_prod_serv no puede usar
--                            idx_gasto_acumulado para la rama de claves
--   · intake/consolidado.ts:265-271 y :579-586 — candidatos del JOIN de
--                            consolidados: tenant + `cfdi_uuid is null` +
--                            rango de fecha
--
-- Sin él, cada una filtra vía (tenant_id, id) o (tenant_id, concepto, fecha)
-- parcial y termina recorriendo el tenant completo: con 540,000 gastos/año de
-- este cliente, una ventana de 7 días (≈10,500 filas) paga leer 50× de más.
--
-- ── viaje (tenant_id, fecha_inicio) ─────────────────────────────────────────
--
-- `getSerieComparativa.viaje` (analytics.ts:113-115) filtra
-- `.eq('tenant_id').gte/lte('fecha_inicio')` en cada carga del Resumen (dos
-- ventanas + histórico). Los índices de `viaje` son (tenant_id, estatus),
-- (tenant_id, id), (tenant_id, created_at) y los parciales de 0058/0087 — el
-- de la 0087 SÍ es (tenant_id, estatus, fecha_inicio) pero con WHERE
-- `recordatorio_comprobacion_en is null`, así que no puede servir la consulta
-- general. Con 180,000 viajes/año, la ventana de 7 días son ~3,500 filas.
--
-- ── POR QUÉ NO VA `CONCURRENTLY` ────────────────────────────────────────────
--
-- Igual que la 0061 (comprobado ahí): el `apply_migration` del MCP envuelve la
-- migración en una transacción y `CREATE INDEX CONCURRENTLY` devuelve 25001.
-- Van con `CREATE INDEX` normal, que bloquea escrituras mientras construye.
-- HOY la base tiene ~4 viajes: el lock es despreciable. Por eso esta migración
-- se aplica ANTES de la firma del cliente y no después — sobre la tabla ya
-- crecida habría que correrlo por psql, fuera de transacción, CONCURRENTLY.
--
-- ── LO QUE SE DESCARTÓ (mismo criterio que la 0061: nada preventivo) ────────
--
--   · liquidacion por fecha: `idx_liq_tenant` (tenant_id, created_at desc, de
--     la 0001) ya sirve getLiquidadoPorSemana, getKpis con corte y
--     getLiquidacionesFiscales.
--   · contarEscalados (analytics.ts:939): filtra sobre viajes ABIERTOS, un
--     conjunto acotado por la operación (decenas), no por el tiempo.
--   · vincularCostosALiquidacion (costos.ts:171): `idx_costo_viaje` (viaje_id)
--     ya lo sirve — un viaje tiene ~5-10 filas de llm_costo.
--   · wa_mensaje_procesado: el claim choca contra su PRIMARY KEY (0002).
--   · getHechosSolos (analytics.ts:235): camina (tenant_id, id desc) y corta a
--     60 filas con sello; un índice parcial se justificaría solo si se mide
--     que los sellos son raros — no hay medición, no hay índice.
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists gasto_tenant_fecha_idx
  on public.gasto (tenant_id, fecha);

comment on index gasto_tenant_fecha_idx is
  'Rango de fecha del COMPROBANTE dentro de un tenant: getGastosFiscales, getSerieComparativa, getGastoPorSemana, getAcumuladoCombustible (cada cuadre) y los candidatos del JOIN de consolidados. Ver 0111.';

create index if not exists viaje_tenant_fecha_inicio_idx
  on public.viaje (tenant_id, fecha_inicio);

comment on index viaje_tenant_fecha_inicio_idx is
  'Rango de fecha_inicio dentro de un tenant: getSerieComparativa.viaje (tarjetas KPI del Resumen, cada carga). Ver 0111.';
