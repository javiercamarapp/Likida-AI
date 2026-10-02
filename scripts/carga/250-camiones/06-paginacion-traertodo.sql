-- 06-paginacion-traertodo.sql — el costo de `traerTodo` (pg.ts: range/offset, 1,000 por página, 100 páginas máx)
-- contra el cursor por fila (`traerTodoDesdeId`), sobre la flota grande. Mide en SQL porque el repo no trae
-- driver `pg` ni PostgREST local (ver README: límite declarado). `explain analyze` da el tiempo del servidor
-- por página; el total de una lectura completa es la suma de sus páginas.
\set T '\'aaaaaaaa-0000-4000-8000-000000000250\''
\timing off
\echo '== filas por tabla (cuántas páginas de 1,000 serían; traerTodo lanza LecturaIncompleta pasando de 100)'
select 'gasto' t, count(*) filas, ceil(count(*)/1000.0) paginas from gasto where tenant_id = :T::uuid
union all select 'viaje', count(*), ceil(count(*)/1000.0) from viaje where tenant_id = :T::uuid
union all select 'liquidacion', count(*), ceil(count(*)/1000.0) from liquidacion where tenant_id = :T::uuid
union all select 'viaje_hito', count(*), ceil(count(*)/1000.0) from viaje_hito where tenant_id = :T::uuid
union all select 'viaje_hito_evento', count(*), ceil(count(*)/1000.0) from viaje_hito_evento where tenant_id = :T::uuid
union all select 'desglose_peaje_linea', count(*), ceil(count(*)/1000.0) from desglose_peaje_linea where tenant_id = :T::uuid;
\echo '== tamaño en bytes de lo que viaja (pg_column_size de las columnas típicas) — memoria JS ≈ 3-5x'
select 'gasto' t, pg_size_pretty(sum(pg_column_size(x))) from (select id, viaje_id, concepto, monto, fecha, folio from gasto where tenant_id = :T::uuid) x
union all select 'viaje', pg_size_pretty(sum(pg_column_size(x))) from (select id, folio, estatus, fecha_inicio, operador_id from viaje where tenant_id = :T::uuid) x;
\echo '== OFFSET: página en la posición 0 / 20k / 50k / 99k (gasto, order by id)'
explain (analyze, costs off, summary on) select id, viaje_id, concepto, monto, fecha, folio from gasto where tenant_id = :T::uuid order by id limit 1000 offset 0;
explain (analyze, costs off, summary on) select id, viaje_id, concepto, monto, fecha, folio from gasto where tenant_id = :T::uuid order by id limit 1000 offset 20000;
explain (analyze, costs off, summary on) select id, viaje_id, concepto, monto, fecha, folio from gasto where tenant_id = :T::uuid order by id limit 1000 offset 50000;
explain (analyze, costs off, summary on) select id, viaje_id, concepto, monto, fecha, folio from gasto where tenant_id = :T::uuid order by id limit 1000 offset 99000;
\echo '== CURSOR por fila (id > último). OJO: la subconsulta solo sitúa el cursor (paga el offset UNA vez); en traerTodoDesdeId el cursor ya viene de la página anterior y cada página cuesta como la primera'
explain (analyze, costs off, summary on) select id, viaje_id, concepto, monto, fecha, folio from gasto where tenant_id = :T::uuid and id > (select id from gasto where tenant_id = :T::uuid order by id offset 99000 limit 1) order by id limit 1000;
