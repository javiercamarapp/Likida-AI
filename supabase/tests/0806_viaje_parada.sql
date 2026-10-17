\set ON_ERROR_STOP on
-- 0806 — viaje_parada (T-A5-38), contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) UNA parada abierta por viaje (índice único parcial): la segunda abierta se rechaza; con la primera cerrada cabe otra;
--       otro viaje u otra flota pueden tener la suya;
--   (b) dominios: motivo (6 valores, incluida «pernocta»), origen, y fin >= inicio;
--   (c) la FK compuesta impide colgar una parada del viaje de otra flota; borrar el viaje borra sus paradas;
--   (d) al liquidar el viaje la parada abierta se cierra con origen `sistema` y fin >= inicio; las ya cerradas no se tocan;
--       otros cambios de estatus no cierran nada;
--   (e) RLS: una flota no ve las paradas de otra; authenticated no escribe; anon no lee;
--   (f) la migración se puede reaplicar sin error y no duplica el trigger ni la política.
begin;

insert into public.tenant (id, nombre) values
  ('80600000-0000-4000-8000-0000000000a1', 'Flota A 0806'),
  ('80600000-0000-4000-8000-0000000000b1', 'Flota B 0806');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('80600000-0000-4000-8000-000000000101', '80600000-0000-4000-8000-0000000000a1', 'Chofer A', '525500806001'), -- grep-limpio:ok
  ('80600000-0000-4000-8000-000000000102', '80600000-0000-4000-8000-0000000000a1', 'Chofer A2', '525500806002'), -- grep-limpio:ok
  ('80600000-0000-4000-8000-000000000103', '80600000-0000-4000-8000-0000000000b1', 'Chofer B', '525500806003'); -- grep-limpio:ok
insert into public.viaje (id, tenant_id, operador_id, folio, estatus) values
  ('80600000-0000-4000-8000-000000000201', '80600000-0000-4000-8000-0000000000a1', '80600000-0000-4000-8000-000000000101', 'V-0806-1', 'abierto'),
  ('80600000-0000-4000-8000-000000000202', '80600000-0000-4000-8000-0000000000a1', '80600000-0000-4000-8000-000000000102', 'V-0806-2', 'abierto'),
  ('80600000-0000-4000-8000-000000000203', '80600000-0000-4000-8000-0000000000b1', '80600000-0000-4000-8000-000000000103', 'V-0806-3', 'abierto');
insert into public.app_user (id, tenant_id, email, rol) values
  ('80600000-0000-4000-8000-000000000401', '80600000-0000-4000-8000-0000000000a1', 'admin-0806@test.invalid', 'flota_admin');

do $$
declare
  ta constant uuid := '80600000-0000-4000-8000-0000000000a1';
  tb constant uuid := '80600000-0000-4000-8000-0000000000b1';
  v1 constant uuid := '80600000-0000-4000-8000-000000000201';
  v2 constant uuid := '80600000-0000-4000-8000-000000000202';
  v3 constant uuid := '80600000-0000-4000-8000-000000000203';
  m text;
  r record;
begin
  -- (a) una sola abierta por viaje
  insert into public.viaje_parada (tenant_id, viaje_id, inicio, motivo) values (ta, v1, '2026-01-05 10:00:00+00', 'trafico');
  begin
    insert into public.viaje_parada (tenant_id, viaje_id, motivo) values (ta, v1, 'descanso');
    raise exception '0806: abrió dos paradas en el mismo viaje';
  exception when unique_violation then null; end;
  insert into public.viaje_parada (tenant_id, viaje_id, motivo) values (ta, v2, 'descanso');   -- otro viaje: cabe
  insert into public.viaje_parada (tenant_id, viaje_id, motivo) values (tb, v3, 'trafico');    -- otra flota: cabe
  update public.viaje_parada set fin = '2026-01-05 10:40:00+00' where viaje_id = v1;           -- cerrada la primera…
  insert into public.viaje_parada (tenant_id, viaje_id, inicio, motivo) values (ta, v1, '2026-01-05 12:00:00+00', 'reten'); -- …cabe otra

  -- (b) dominios
  foreach m in array array['trafico', 'descanso', 'pernocta', 'reten', 'averia', 'otro'] loop
    insert into public.viaje_parada (tenant_id, viaje_id, inicio, fin, motivo)
      values (ta, v1, '2026-01-04 00:00:00+00', '2026-01-04 00:10:00+00', m);
  end loop;
  foreach m in array array['TRAFICO', 'pausa', 'comida', ''] loop
    begin
      insert into public.viaje_parada (tenant_id, viaje_id, inicio, fin, motivo)
        values (ta, v1, '2026-01-03 00:00:00+00', '2026-01-03 00:10:00+00', m);
      raise exception '0806: el CHECK dejó pasar el motivo «%»', m;
    exception when check_violation then null; end;
  end loop;
  begin
    insert into public.viaje_parada (tenant_id, viaje_id, inicio, fin, motivo, origen)
      values (ta, v1, '2026-01-03 00:00:00+00', '2026-01-03 00:10:00+00', 'otro', 'gps');
    raise exception '0806: origen inventado';
  exception when check_violation then null; end;
  begin
    insert into public.viaje_parada (tenant_id, viaje_id, inicio, fin, motivo)
      values (ta, v1, '2026-01-03 01:00:00+00', '2026-01-03 00:00:00+00', 'otro');
    raise exception '0806: fin anterior al inicio';
  exception when check_violation then null; end;

  -- (c) FK compuesta: el viaje debe ser de la misma flota
  begin
    insert into public.viaje_parada (tenant_id, viaje_id, inicio, fin, motivo) values (tb, v2, now(), now(), 'otro');
    raise exception '0806: colgó una parada del viaje de otra flota';
  exception when foreign_key_violation then null; end;

  -- (d) al liquidar: v1 tiene una abierta (12:00 reten); v2 tiene una abierta (descanso)
  update public.viaje set estatus = 'en_cuadre' where id = v1;       -- otro cambio de estatus: no cierra
  if not exists (select 1 from public.viaje_parada where viaje_id = v1 and fin is null) then
    raise exception '0806: en_cuadre cerró la parada';
  end if;
  update public.viaje set estatus = 'liquidado' where id = v1;
  select fin, origen, inicio into r from public.viaje_parada where viaje_id = v1 and inicio = '2026-01-05 12:00:00+00';
  if r.fin is null or r.origen <> 'sistema' or r.fin < r.inicio then
    raise exception '0806: liquidar no cerró la parada con origen sistema (fin %, origen %)', r.fin, r.origen;
  end if;
  select fin, origen into r from public.viaje_parada where viaje_id = v1 and inicio = '2026-01-05 10:00:00+00';
  if r.fin <> '2026-01-05 10:40:00+00' or r.origen <> 'chofer' then
    raise exception '0806: liquidar reescribió una parada ya cerrada';
  end if;
  if not exists (select 1 from public.viaje_parada where viaje_id = v2 and fin is null)
     or not exists (select 1 from public.viaje_parada where viaje_id = v3 and fin is null) then
    raise exception '0806: liquidar un viaje cerró paradas de otros viajes';
  end if;
  -- una parada con inicio en el futuro: el cierre no queda antes del inicio
  update public.viaje_parada set fin = now() where viaje_id = v2 and fin is null and motivo = 'descanso';
  insert into public.viaje_parada (tenant_id, viaje_id, inicio, motivo) values (ta, v2, now() + interval '1 hour', 'otro');
  update public.viaje set estatus = 'liquidado' where id = v2;
  if exists (select 1 from public.viaje_parada where viaje_id = v2 and fin is null)
     or exists (select 1 from public.viaje_parada where viaje_id = v2 and fin < inicio) then
    raise exception '0806: el cierre automático dejó abierta o invirtió una parada';
  end if;

  -- (c, cont.) borrar el viaje borra sus paradas
  delete from public.viaje where id = v3;
  if exists (select 1 from public.viaje_parada where viaje_id = v3) then raise exception '0806: la parada sobrevivió al viaje'; end if;

  -- (e) RLS activa y permisos
  if not (select relrowsecurity from pg_class where oid = 'public.viaje_parada'::regclass) then raise exception '0806: sin RLS'; end if;
  if has_table_privilege('anon', 'public.viaje_parada', 'select') then raise exception '0806: anon puede leer'; end if;
  if has_table_privilege('authenticated', 'public.viaje_parada', 'insert') then raise exception '0806: authenticated puede escribir'; end if;
end $$;

-- (e) RLS: la flota A ve solo lo suyo (la flota B tiene su viaje borrado: se siembra otra para comprobar el cruce)
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('80600000-0000-4000-8000-000000000104', '80600000-0000-4000-8000-0000000000b1', 'Chofer B2', '525500806004'); -- grep-limpio:ok
insert into public.viaje (id, tenant_id, operador_id, folio, estatus) values
  ('80600000-0000-4000-8000-000000000204', '80600000-0000-4000-8000-0000000000b1', '80600000-0000-4000-8000-000000000104', 'V-0806-4', 'abierto');
insert into public.viaje_parada (tenant_id, viaje_id, motivo) values
  ('80600000-0000-4000-8000-0000000000b1', '80600000-0000-4000-8000-000000000204', 'trafico');

set local role authenticated;
select set_config('request.jwt.claim.sub', '80600000-0000-4000-8000-000000000401', true);
do $$ begin
  if exists (select 1 from public.viaje_parada where tenant_id = '80600000-0000-4000-8000-0000000000b1')
     or (select count(*) from public.viaje_parada) = 0 then
    raise exception '0806: RLS dejó cruzar flotas (ve % filas)', (select count(*) from public.viaje_parada);
  end if;
end $$;
reset role;

-- (f) reaplicar la migración: sin error, sin trigger ni política duplicados, y el índice único sigue siendo parcial
\ir ../migrations/0806_viaje_parada.sql
do $$
begin
  if (select count(*) from pg_trigger where tgrelid = 'public.viaje'::regclass and tgname = 'viaje_parada_cerrar_al_liquidar' and not tgisinternal) <> 1 then
    raise exception '0806: reaplicar duplicó o perdió el trigger';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'viaje_parada') <> 1 then
    raise exception '0806: reaplicar duplicó o perdió la política';
  end if;
  if (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'viaje_parada_abierta_unica' and indexdef ilike '%where%fin is null%') <> 1 then
    raise exception '0806: el índice único de parada abierta no es parcial o falta';
  end if;
end $$;

rollback;
