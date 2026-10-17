\set ON_ERROR_STOP on
-- 0776 — catálogo de casetas por nombre y TAGs dados de baja, contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) peaje_caseta_nombre: único por (flota, nombre_norm), repetible entre flotas; largo del nombre;
--       coordenadas ambas-o-ninguna y en rango; clases_permitidas en 0..99 y máximo 20;
--   (b) peaje_tag_baja: único por (flota, tag); el TAG normalizado es [A-Z0-9]{4,40}; motivo ≤ 300;
--   (c) borrar la flota borra ambas tablas (cascade);
--   (d) RLS encendida SIN políticas (deny-all) y una sesión `authenticated` no lee filas de ninguna flota.
begin;

insert into public.tenant (id, nombre) values
  ('77600000-0000-4000-8000-0000000000a1', 'Flota A 0776'),
  ('77600000-0000-4000-8000-0000000000b1', 'Flota B 0776');
insert into public.app_user (id, tenant_id, email, rol) values
  ('77600000-0000-4000-8000-000000000401', '77600000-0000-4000-8000-0000000000a1', 'admin-0776@test.invalid', 'flota_admin');

do $$
declare
  A constant uuid := '77600000-0000-4000-8000-0000000000a1';
  B constant uuid := '77600000-0000-4000-8000-0000000000b1';
  t text;
begin
  -- (a) peaje_caseta_nombre
  insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm) values (A, 'CASETA UNO', 'caseta uno');
  insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm) values (B, 'CASETA UNO', 'caseta uno');  -- otra flota cabe
  begin insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm) values (A, 'Caseta Uno', 'caseta uno');
    raise exception '0776: duplicó la caseta en la misma flota'; exception when unique_violation then null; end;
  begin insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm) values (A, '', 'x');
    raise exception '0776: nombre vacío'; exception when check_violation then null; end;
  begin insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm) values (A, repeat('n', 121), 'largo');
    raise exception '0776: nombre de más de 120'; exception when check_violation then null; end;
  begin insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, lat) values (A, 'S1', 's1', 20.5);
    raise exception '0776: lat sin lng'; exception when check_violation then null; end;
  begin insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, lat, lng) values (A, 'S2', 's2', 91, -103);
    raise exception '0776: lat fuera de rango'; exception when check_violation then null; end;
  begin insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, lat, lng) values (A, 'S3', 's3', 20, -181);
    raise exception '0776: lng fuera de rango'; exception when check_violation then null; end;
  insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, lat, lng, clases_permitidas, no_cruzar) values (A, 'S4', 's4', 20.5, -103.3, '{1,2}', true);
  begin insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, clases_permitidas) values (A, 'S5', 's5', '{100}');
    raise exception '0776: clase 100'; exception when check_violation then null; end;
  begin insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, clases_permitidas) values (A, 'S6', 's6', '{-1}');
    raise exception '0776: clase negativa'; exception when check_violation then null; end;
  begin insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, clases_permitidas)
    values (A, 'S7', 's7', (select array_agg(g::smallint) from generate_series(1, 21) g));
    raise exception '0776: más de 20 clases'; exception when check_violation then null; end;

  -- (b) peaje_tag_baja
  insert into public.peaje_tag_baja (tenant_id, tag, baja_en) values (A, 'TAG0001', '2026-01-31');
  insert into public.peaje_tag_baja (tenant_id, tag, baja_en) values (B, 'TAG0001', '2026-01-31');
  begin insert into public.peaje_tag_baja (tenant_id, tag, baja_en) values (A, 'TAG0001', '2026-02-28');
    raise exception '0776: duplicó el TAG en la misma flota'; exception when unique_violation then null; end;
  begin insert into public.peaje_tag_baja (tenant_id, tag, baja_en) values (A, 'tag0002', '2026-01-31');
    raise exception '0776: TAG en minúsculas'; exception when check_violation then null; end;
  begin insert into public.peaje_tag_baja (tenant_id, tag, baja_en) values (A, 'AB1', '2026-01-31');
    raise exception '0776: TAG de menos de 4'; exception when check_violation then null; end;
  begin insert into public.peaje_tag_baja (tenant_id, tag, baja_en) values (A, repeat('A', 41), '2026-01-31');
    raise exception '0776: TAG de más de 40'; exception when check_violation then null; end;
  begin insert into public.peaje_tag_baja (tenant_id, tag, baja_en, motivo) values (A, 'TAG0003', '2026-01-31', repeat('m', 301));
    raise exception '0776: motivo de más de 300'; exception when check_violation then null; end;
  begin insert into public.peaje_tag_baja (tenant_id, tag) values (A, 'TAG0004');
    raise exception '0776: baja sin fecha'; exception when not_null_violation then null; end;

  -- (d) deny-all
  foreach t in array array['peaje_caseta_nombre', 'peaje_tag_baja'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '0776: RLS apagada en %', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then raise exception '0776: % no debe tener políticas', t; end if;
  end loop;
end $$;

-- (d) sesión authenticated: no lee nada
set local role authenticated;
select set_config('request.jwt.claim.sub', '77600000-0000-4000-8000-000000000401', true);
do $$ declare t text; n int;
begin
  foreach t in array array['peaje_caseta_nombre', 'peaje_tag_baja'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then raise exception '0776: authenticated leyó % filas de %', n, t; end if;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;

-- (c) cascade al borrar la flota
do $$ begin
  delete from public.tenant where id = '77600000-0000-4000-8000-0000000000a1';
  if exists (select 1 from public.peaje_caseta_nombre where tenant_id = '77600000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.peaje_tag_baja where tenant_id = '77600000-0000-4000-8000-0000000000a1') then
    raise exception '0776: quedaron filas de una flota borrada';
  end if;
  if (select count(*) from public.peaje_caseta_nombre where tenant_id = '77600000-0000-4000-8000-0000000000b1') <> 1 then
    raise exception '0776: el borrado de A tocó filas de B';
  end if;
end $$;

rollback;
