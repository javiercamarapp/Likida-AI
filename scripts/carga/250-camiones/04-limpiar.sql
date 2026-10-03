-- 04-limpiar.sql — borra TODO lo que sembró 01-sembrar.sql (tenants «ZZZ CARGA %»).
-- Recorre cada tabla de public con columna tenant_id (sin triggers ni FK: la
-- siembra tampoco los usó) y al final borra los tenants. Idempotente.
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
do $$
declare r record; ts uuid[];
begin
  select array_agg(id) into ts from tenant where nombre like 'ZZZ CARGA%';
  if ts is null then raise notice 'nada que limpiar'; return; end if;
  for r in select c.table_name from information_schema.columns c
           join information_schema.tables t using (table_schema, table_name)
           where c.table_schema = 'public' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
  loop
    execute format('delete from public.%I where tenant_id = any($1)', r.table_name) using ts;
  end loop;
  delete from tenant where id = any(ts);
end $$;
commit;
vacuum analyze;
