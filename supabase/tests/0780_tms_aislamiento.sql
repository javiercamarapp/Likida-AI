-- Prueba de 0780/0781/0782 (conector al sistema de gestión de transporte).
-- Ejecutar después de las migraciones con:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/0780_tms_aislamiento.sql
-- Todo ocurre en una transacción que se revierte. Datos sintéticos.
-- Sale con excepción si algo falla; si no, termina con NOTICE TMS_0780_OK.

begin;

do $$
declare
  t1 constant uuid := '78000000-0000-4000-8000-000000000001';
  t2 constant uuid := '78000000-0000-4000-8000-000000000002';
  v_ok boolean;
  n integer;
  r text;
begin
  insert into public.tenant(id, nombre) values (t1, 'Prueba TMS 1'), (t2, 'Prueba TMS 2');

  -- 0780: columnas nullable, sin default; null permitido y valor permitido repetido.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name in ('viaje', 'posicion')
     and column_name = 'despacho_ref' and is_nullable = 'YES' and column_default is null;
  if n <> 2 then raise exception '0780: despacho_ref debe existir nullable sin default en viaje y posicion (hay %)', n; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'viaje_despacho_ref_idx'
                  and indexdef ilike '%where (despacho_ref is not null)%' and indexdef not ilike '%unique%') then
    raise exception '0780: falta el indice parcial NO unico viaje_despacho_ref_idx';
  end if;
  -- viaje_folio_unico intacto.
  if not exists (select 1 from pg_constraint where conname = 'viaje_folio_unico') then
    raise exception '0780: viaje_folio_unico ya no existe';
  end if;

  -- 0781: duplicado (tenant, recurso, clave) falla; mismo recurso/clave en otro tenant pasa.
  insert into public.tms_ingesta(tenant_id, recurso, clave_externa, huella) values (t1, 'viajes', 'K1', 'h1');
  insert into public.tms_ingesta(tenant_id, recurso, clave_externa, huella) values (t2, 'viajes', 'K1', 'h1');
  v_ok := false;
  begin
    insert into public.tms_ingesta(tenant_id, recurso, clave_externa, huella) values (t1, 'viajes', 'K1', 'h2');
  exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception '0781: tms_ingesta acepto un duplicado (tenant, recurso, clave)'; end if;

  insert into public.tms_sincronizacion(tenant_id, recurso) values (t1, 'viajes');
  v_ok := false;
  begin
    insert into public.tms_sincronizacion(tenant_id, recurso) values (t1, 'viajes');
  exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception '0781: tms_sincronizacion acepto PK duplicada'; end if;

  -- 0782: el mapeo debe ser objeto y acotado; una sola version activa.
  insert into public.tms_mapeo(tenant_id, recurso, mapeo) values (t1, 'viajes', '{"a":"b"}');
  v_ok := false;
  begin
    insert into public.tms_mapeo(tenant_id, recurso, mapeo, version) values (t1, 'viajes', '[1]', 2);
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception '0782: acepto un mapeo que no es objeto'; end if;
  v_ok := false;
  begin
    insert into public.tms_mapeo(tenant_id, recurso, mapeo, version)
    values (t1, 'viajes', jsonb_build_object('x', repeat('a', 70000)), 3);
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception '0782: acepto un mapeo de 64 KiB o mas'; end if;
  v_ok := false;
  begin
    insert into public.tms_mapeo(tenant_id, recurso, mapeo, version) values (t1, 'viajes', '{}', 4);
  exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception '0782: acepto dos versiones activas del mismo recurso'; end if;
  insert into public.tms_mapeo(tenant_id, recurso, mapeo, version, activo) values (t1, 'viajes', '{}', 5, false);

  -- Deny-all: RLS activa, sin politicas, sin privilegios para anon/authenticated.
  foreach r in array array['tms_sincronizacion', 'tms_ingesta', 'tms_mapeo'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || r)::regclass) then
      raise exception 'RLS no habilitada en %', r;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = r) then
      raise exception '% no debe tener politicas (deny-all)', r;
    end if;
    if has_table_privilege('anon', 'public.' || r, 'select') or has_table_privilege('authenticated', 'public.' || r, 'select')
       or has_table_privilege('authenticated', 'public.' || r, 'insert') then
      raise exception '% accesible a anon/authenticated', r;
    end if;
  end loop;
end $$;

-- Lectura real con el rol authenticated: debe negarse (sin privilegios) y no ver filas de otro tenant.
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin
    perform 1 from public.tms_ingesta;
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'authenticated pudo leer tms_ingesta'; end if;
end $$;
reset role;

do $$ begin raise notice 'TMS_0780_OK'; end $$;
rollback;
