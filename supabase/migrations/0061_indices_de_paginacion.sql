-- 0061 — El orden que pide `traerTodo` no lo servía ningún índice.
--
-- `traerTodo()` (src/lib/cuadra/pg.ts) es el helper que existe para que PostgREST
-- no recorte a 1,000 filas en silencio. Pagina así, en 50 llamadas del repo al
-- escribir esto —y la cuenta solo sube, cada módulo nuevo trae las suyas—:
--
--     .eq('tenant_id', …).order('id').range(desde, hasta)
--
-- SIEMPRE ordena por `id`. Y no existía un solo índice `(tenant_id, id)` en toda
-- la base. Los que hay no pueden servir ese orden dentro de un tenant:
--   · `gasto_id_tenant_key` es `(id, tenant_id)` — columnas al revés,
--   · `idx_gasto_acumulado` es `(tenant_id, concepto, fecha)`,
--   · `idx_liq_tenant` / `idx_costo_tenant` son `(tenant_id, created_at DESC)`,
--   · `idx_viaje_tenant` es `(tenant_id, estatus)`.
--
-- Todos sirven para FILTRAR por tenant, ninguno para ENTREGAR ordenado por id.
-- Así que el planeador filtraba con uno de ellos y después ORDENABA todas las
-- filas del tenant para devolver una página de mil. Con 100 páginas, ese sort
-- se repite 100 veces sobre el mismo conjunto completo.
--
-- Medido contra esta base con 10 tenants y volumen de un año (EXPLAIN antes y
-- después de cada índice, todo en bloques revertidos):
--
--   gasto, order by id, página 2   ANTES  Sort → Bitmap Heap Scan  cost 825.13
--                                  DESPUÉS Index Only Scan          cost 430.69
--   llm_costo, order by id, pág. 5 ANTES  Sort → Bitmap Heap Scan  cost 1144.45
--                                  DESPUÉS Index Scan              cost  822.95
--   viaje, order by id, página 2   ANTES  Sort → Bitmap Heap Scan  cost 263.16
--                                  DESPUÉS Index Scan              cost  214.56
--
-- OJO con la trampa del tenant único: si un solo tenant tiene el 100% de las
-- filas, el filtro por tenant_id no selecciona nada y el planeador se conforma
-- con recorrer `gasto_pkey` filtrando — el plan se ve bien y no prueba nada. La
-- medición de arriba usa 10 tenants justo para no leerse ese falso verde.
--
-- ── SEGUNDO DEFECTO: la bandeja que ordena 240 mil filas para enseñar 100 ──
--
-- `getDocumentos()` y `getViajes()` (analytics.ts) NO paginan: piden
-- `.order('created_at', desc).limit(100)`. `gasto` no tenía ningún índice por
-- `created_at` que arrancara en tenant_id, y `viaje` tampoco. `getViajes` corre
-- en 5 páginas del dashboard.
--
--   gasto,  created_at desc limit 100  ANTES  Sort → Bitmap Heap  cost 777.36
--                                      DESPUÉS Index Scan         cost  18.17
--   viaje,  created_at desc limit 100  ANTES  Sort → Bitmap Heap  cost 244.90
--                                      DESPUÉS Index Scan         cost  18.05
--
-- Es la ganancia más grande de la migración —43× en gasto— porque el `limit 100`
-- por fin puede cortar temprano en vez de materializar y ordenar todo el
-- histórico del tenant.
--
-- ── POR QUÉ NO VA `CONCURRENTLY` ─────────────────────────────────────────────
--
-- `CREATE INDEX CONCURRENTLY` no corre dentro de una transacción, y el
-- `apply_migration` del MCP de Supabase envuelve la migración en una. Se
-- comprobó: devuelve `25001: CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block`. Por eso van con `CREATE INDEX` normal, que toma un lock
-- SHARE: deja leer, pero BLOQUEA INSERT/UPDATE/DELETE mientras construye.
--
-- Hoy es gratis —`gasto` tiene 40 filas—. En un año, con 240 mil, esto para las
-- escrituras varios segundos. Si alguna vez hay que reconstruir uno de estos
-- índices sobre la tabla ya crecida, NO se hace por aquí: se corre por `psql`,
-- fuera de transacción, con `CONCURRENTLY`.
--
-- ── LO QUE SE DESCARTÓ ───────────────────────────────────────────────────────
--
-- `operador`, `cliente`, `unidad`, `mantenimiento`, `ticket_soporte`,
-- `factura_emitida` y `cotizacion` también se leen con `.order('id')` —
-- `operador` en 5 sitios—, y NO llevan índice. Están acotadas por el tamaño de
-- la flota (decenas o centenas de filas) y no crecen con el tiempo: ordenar
-- unos cientos de renglones cuesta microsegundos. Un índice de más se paga en
-- cada insert para siempre; estos siete no se ganaron el suyo.
--
-- ── LO QUE CUESTA ────────────────────────────────────────────────────────────
--
-- Medido, no estimado: 20,000 inserts en `gasto` sin los dos índices nuevos
-- tardaron 1,810.1 ms (90.5 µs/fila); con ellos, 1,831.3 ms (91.6 µs/fila).
-- Sobrecosto: 1.1 µs por comprobante. A 660 comprobantes diarios son 0.7 ms
-- al día. (El insert real va uno por transacción, donde manda el fsync del
-- commit, así que en producción el porcentaje es todavía menor.)

-- ── El orden que pide `traerTodo` en sus 42 llamadas ────────────────────────
create index if not exists gasto_paginacion_idx
  on public.gasto (tenant_id, id);

create index if not exists viaje_paginacion_idx
  on public.viaje (tenant_id, id);

create index if not exists liquidacion_paginacion_idx
  on public.liquidacion (tenant_id, id);

create index if not exists llm_costo_paginacion_idx
  on public.llm_costo (tenant_id, id);

create index if not exists comprobante_huerfano_paginacion_idx
  on public.comprobante_huerfano (tenant_id, id);

create index if not exists pod_paginacion_idx
  on public.pod (tenant_id, id);

create index if not exists incidencia_paginacion_idx
  on public.incidencia (tenant_id, id);

-- ── Las dos bandejas que ordenan por fecha para enseñar 100 filas ───────────
-- `liquidacion` y `llm_costo` ya tenían el suyo (`idx_liq_tenant`,
-- `idx_costo_tenant`); estas dos no.
create index if not exists gasto_reciente_idx
  on public.gasto (tenant_id, created_at desc);

create index if not exists viaje_reciente_idx
  on public.viaje (tenant_id, created_at desc);
