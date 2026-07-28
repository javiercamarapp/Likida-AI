-- El índice que sostiene el contador del 15%.
--
-- `getAcumuladoCombustible` barre TODOS los gastos de diésel del ejercicio de un
-- tenant, y se llama en cada `cuadrar_viaje` — que el agente puede invocar
-- varias veces por turno. Con `idx_gasto_viaje` como único índice sobre `gasto`,
-- esa consulta hace un scan filtrando por tenant, concepto y rango de fecha.
--
-- Hoy hay 2 gastos en la base y no se nota. Con una flota real —miles de cargas
-- al año— sí, y el turno tiene 60s de presupuesto compartido.
--
-- El orden de las columnas es el de la consulta: igualdad primero (tenant,
-- concepto) y rango al final (fecha), que es como Postgres puede usar el índice
-- entero en vez de solo su prefijo.
create index if not exists idx_gasto_acumulado
  on gasto (tenant_id, concepto, fecha);

comment on index idx_gasto_acumulado is
  'Sostiene getAcumuladoCombustible (contador del 15% de RFA 2026 regla 2.9), que corre en cada cuadrar_viaje.';
