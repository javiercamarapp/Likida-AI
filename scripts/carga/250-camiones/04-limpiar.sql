-- 04-limpiar.sql — borra TODO lo que sembró 01-sembrar.sql (tenants «ZZZ CARGA %»).
-- Recorre cada tabla de public con columna tenant_id (sin triggers ni FK: la
-- siembra tampoco los usó) y al final borra los tenants. Idempotente.
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
do $$
declare r record; ts uuid[];
begin
  -- A37-S01-04: guarda de entorno. Esta limpieza corre con triggers y FK
  -- desactivados: solo es segura en la base EFÍMERA de la prueba, que no tiene
  -- más tenants que los sintéticos. Si hay uno que no sea «ZZZ CARGA…», es una
  -- base con datos reales y NO se borra nada.
  if exists (select 1 from tenant where nombre not like 'ZZZ CARGA%') then
    raise exception 'A37-S01-04: hay tenants que no son ZZZ CARGA: esta base no es efímera; no se limpia';
  end if;
  -- Ids EXACTOS que sembró 01-sembrar.sql (no «por nombre»): la flota de 250 y
  -- las 20 chicas (md5 determinista), con su nombre sintético como segunda llave.
  select array_agg(id) into ts from tenant
   where (id = 'aaaaaaaa-0000-4000-8000-000000000250'::uuid and nombre = 'ZZZ CARGA 250')
      or (nombre like 'ZZZ CARGA CHICA %'
          and id = md5('zzz-chica-' || ltrim(substring(nombre from '[0-9]+$'), '0'))::uuid);
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
