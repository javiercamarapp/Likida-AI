\set ON_ERROR_STOP on
-- 0807 — ciclo_servicio (T-A5-41), contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) dominios: servicio (3 valores), hito (vocabulario cerrado), orden >= 1;
--   (b) unicidad POR FLOTA: (flota, servicio, orden) y (flota, servicio, hito); otra flota puede repetir la misma secuencia;
--   (c) el mismo hito sí puede estar en servicios distintos (confirmar abre los tres);
--   (d) borrar la flota borra su ciclo; `activo` nace en true y se puede apagar sin borrar;
--   (e) RLS: una flota no ve el ciclo de otra; authenticated no escribe; anon no lee;
--   (f) la migración se puede reaplicar sin error, sin duplicar la política ni perder filas (idempotente).
begin;

insert into public.tenant (id, nombre) values
  ('80700000-0000-4000-8000-0000000000a1', 'Flota A 0807'),
  ('80700000-0000-4000-8000-0000000000b1', 'Flota B 0807');
insert into public.app_user (id, tenant_id, email, rol) values
  ('80700000-0000-4000-8000-000000000401', '80700000-0000-4000-8000-0000000000a1', 'admin-0807@test.invalid', 'flota_admin');

do $$
declare
  ta constant uuid := '80700000-0000-4000-8000-0000000000a1';
  tb constant uuid := '80700000-0000-4000-8000-0000000000b1';
  x text;
begin
  -- (a) dominios
  foreach x in array array['importacion', 'exportacion', 'nacional'] loop
    insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values (ta, x, 1, 'confirmar');   -- (c) mismo hito en los tres
  end loop;
  foreach x in array array['IMPORTACION', 'aereo', 'maritimo', ''] loop
    begin
      insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values (ta, x, 9, 'regreso');
      raise exception '0807: el CHECK dejó pasar el servicio «%»', x;
    exception when check_violation then null; end;
  end loop;
  foreach x in array array['CONFIRMAR', 'llegada_destino', 'inventado', ''] loop
    begin
      insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values (ta, 'importacion', 9, x);
      raise exception '0807: el CHECK dejó pasar el hito «%»', x;
    exception when check_violation then null; end;
  end loop;
  begin
    insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values (ta, 'importacion', 0, 'regreso');
    raise exception '0807: orden 0';
  exception when check_violation then null; end;
  begin
    insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values (ta, 'importacion', -1, 'regreso');
    raise exception '0807: orden negativo';
  exception when check_violation then null; end;

  -- (b) unicidad por flota
  insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values (ta, 'importacion', 2, 'inicio_viaje');
  begin
    insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values (ta, 'importacion', 2, 'llegada_cliente');
    raise exception '0807: dos pasos con el mismo orden';
  exception when unique_violation then null; end;
  begin
    insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values (ta, 'importacion', 3, 'inicio_viaje');
    raise exception '0807: el mismo hito dos veces en un servicio';
  exception when unique_violation then null; end;
  insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values (tb, 'importacion', 1, 'confirmar'); -- otra flota: cabe
  insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values (tb, 'importacion', 2, 'inicio_viaje');

  -- (d) activo nace en true y se apaga sin borrar; borrar la flota borra su ciclo
  if exists (select 1 from public.ciclo_servicio where tenant_id = ta and activo is not true) then
    raise exception '0807: activo no nace en true';
  end if;
  update public.ciclo_servicio set activo = false where tenant_id = ta and servicio = 'importacion' and orden = 2;
  if (select count(*) from public.ciclo_servicio where tenant_id = ta and servicio = 'importacion') <> 2 then
    raise exception '0807: apagar un paso lo borró';
  end if;
  delete from public.tenant where id = tb;
  if exists (select 1 from public.ciclo_servicio where tenant_id = tb) then raise exception '0807: el ciclo sobrevivió a la flota'; end if;

  -- (e) RLS activa y permisos
  if not (select relrowsecurity from pg_class where oid = 'public.ciclo_servicio'::regclass) then raise exception '0807: sin RLS'; end if;
  if has_table_privilege('anon', 'public.ciclo_servicio', 'select') then raise exception '0807: anon puede leer'; end if;
  if has_table_privilege('authenticated', 'public.ciclo_servicio', 'insert') then raise exception '0807: authenticated puede escribir'; end if;
end $$;

-- (e) RLS: la flota A ve solo lo suyo (se siembra otra flota para comprobar el cruce)
insert into public.tenant (id, nombre) values ('80700000-0000-4000-8000-0000000000c1', 'Flota C 0807');
insert into public.ciclo_servicio (tenant_id, servicio, orden, hito) values
  ('80700000-0000-4000-8000-0000000000c1', 'exportacion', 1, 'confirmar');

set local role authenticated;
select set_config('request.jwt.claim.sub', '80700000-0000-4000-8000-000000000401', true);
do $$ begin
  if exists (select 1 from public.ciclo_servicio where tenant_id = '80700000-0000-4000-8000-0000000000c1')
     or (select count(*) from public.ciclo_servicio) = 0 then
    raise exception '0807: RLS dejó cruzar flotas (ve % filas)', (select count(*) from public.ciclo_servicio);
  end if;
end $$;
reset role;

-- (f) reaplicar la migración: sin error, sin política duplicada y sin perder filas
do $$ begin
  create temp table if not exists _antes_0807 on commit drop as select count(*)::int as n from public.ciclo_servicio;
end $$;
\ir ../migrations/0807_ciclo_por_servicio.sql
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ciclo_servicio') <> 1 then
    raise exception '0807: reaplicar duplicó o perdió la política';
  end if;
  if (select count(*) from public.ciclo_servicio) <> (select n from _antes_0807) then
    raise exception '0807: reaplicar cambió las filas';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.ciclo_servicio'::regclass and conname in ('ciclo_servicio_orden_unico', 'ciclo_servicio_hito_unico')) <> 2 then
    raise exception '0807: faltan las unicidades por flota';
  end if;
end $$;

rollback;
