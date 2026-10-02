-- 02-analyze.sql — estadísticas frescas tras la siembra (autovacuum no alcanza a correr en una base efímera).
vacuum (analyze) tenant;
vacuum (analyze) viaje; vacuum (analyze) gasto; vacuum (analyze) liquidacion; vacuum (analyze) posicion;
vacuum (analyze) viaje_hito; vacuum (analyze) viaje_hito_aviso; vacuum (analyze) viaje_hito_evento;
vacuum (analyze) desglose_peaje_linea; vacuum (analyze) cp_documento;
vacuum (analyze) vigia_mensaje; vacuum (analyze) vigia_evento; vacuum (analyze) vigia_conversacion;
vacuum (analyze) liquidacion_externa;
-- Volumen por tabla (lo que reporta ronda-16-carga.md):
select relname as tabla, to_char(n_live_tup, 'FM999,999,999') as filas, pg_size_pretty(pg_total_relation_size(relid)) as tamano
  from pg_stat_user_tables where n_live_tup > 1000 order by pg_total_relation_size(relid) desc;
select pg_size_pretty(pg_database_size(current_database())) as base_total;
