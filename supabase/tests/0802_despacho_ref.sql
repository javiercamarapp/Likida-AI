\set ON_ERROR_STOP on
-- 0802 — despacho_ref en viaje y posición, contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) las columnas existen, son text, nullable y SIN default (posicion: cambio de metadatos, sin reescritura);
--   (b) posicion acepta filas con y sin despacho_ref, y el índice único uq_posicion_lectura (0288, que reemplazó a posicion_sin_duplicado de 0050) sigue deduplicando igual;
--   (c) el índice de viaje NO es único (misma referencia en dos viajes de la misma flota) y es parcial;
--   (d) RLS: una flota ajena no ve las posiciones ni los viajes con esa referencia;
--   (e) la consulta «última posición de la unidad con referencia» usa un índice existente (no hace falta uno nuevo en posicion).
begin;

insert into public.tenant (id, nombre) values
  ('82000000-0000-4000-8000-0000000000a1', 'Flota A 0802'),
  ('82000000-0000-4000-8000-0000000000b1', 'Flota B 0802');
insert into public.unidad (id, tenant_id, numero_economico) values
  ('82000000-0000-4000-8000-000000000301', '82000000-0000-4000-8000-0000000000a1', 'U-A'),
  ('82000000-0000-4000-8000-000000000302', '82000000-0000-4000-8000-0000000000b1', 'U-B');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('82000000-0000-4000-8000-000000000101', '82000000-0000-4000-8000-0000000000a1', 'Chofer A', '525500802001'), -- grep-limpio:ok
  ('82000000-0000-4000-8000-000000000102', '82000000-0000-4000-8000-0000000000b1', 'Chofer B', '525500802002'); -- grep-limpio:ok
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, despacho_ref) values
  ('82000000-0000-4000-8000-000000000201', '82000000-0000-4000-8000-0000000000a1', '82000000-0000-4000-8000-000000000101', 'V-1', 'abierto', 'D-100'),
  ('82000000-0000-4000-8000-000000000202', '82000000-0000-4000-8000-0000000000a1', '82000000-0000-4000-8000-000000000101', 'V-2', 'liquidado', 'D-100'),
  ('82000000-0000-4000-8000-000000000203', '82000000-0000-4000-8000-0000000000a1', '82000000-0000-4000-8000-000000000101', 'V-3', 'liquidado', null),
  ('82000000-0000-4000-8000-000000000204', '82000000-0000-4000-8000-0000000000b1', '82000000-0000-4000-8000-000000000102', 'V-4', 'abierto', 'D-100');
insert into public.app_user (id, tenant_id, email, rol) values
  ('82000000-0000-4000-8000-000000000401', '82000000-0000-4000-8000-0000000000a1', 'admin-0802@test.invalid', 'flota_admin');

do $$
declare c record;
begin
  -- (a) columnas
  for c in select table_name, data_type, is_nullable, column_default from information_schema.columns
           where table_schema = 'public' and column_name = 'despacho_ref' and table_name in ('viaje', 'posicion') loop
    if c.data_type <> 'text' or c.is_nullable <> 'YES' or c.column_default is not null then
      raise exception '0802: % despacho_ref mal definida (% % %)', c.table_name, c.data_type, c.is_nullable, c.column_default;
    end if;
  end loop;
  if (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'despacho_ref'
        and table_name in ('viaje', 'posicion')) <> 2 then
    raise exception '0802: faltan columnas despacho_ref';
  end if;

  -- (b) con y sin despacho_ref; el duplicado exacto (tenant, unidad, medida_en) sigue deduplicando
  insert into public.posicion (tenant_id, unidad_id, lat, lng, medida_en, proveedor, despacho_ref) values
    ('82000000-0000-4000-8000-0000000000a1', '82000000-0000-4000-8000-000000000301', 20, -89, '2026-10-01 12:00:00+00', 'sintetico', 'D-100'),
    ('82000000-0000-4000-8000-0000000000a1', '82000000-0000-4000-8000-000000000301', 20, -89, '2026-10-01 12:05:00+00', 'sintetico', null),
    ('82000000-0000-4000-8000-0000000000b1', '82000000-0000-4000-8000-000000000302', 21, -88, '2026-10-01 12:00:00+00', 'sintetico', 'D-100');
  insert into public.posicion (tenant_id, unidad_id, lat, lng, medida_en, proveedor, despacho_ref) values
    ('82000000-0000-4000-8000-0000000000a1', '82000000-0000-4000-8000-000000000301', 20, -89, '2026-10-01 12:00:00+00', 'sintetico', 'D-100')
    on conflict (tenant_id, unidad_id, medida_en) do nothing;
  if (select count(*) from public.posicion where unidad_id = '82000000-0000-4000-8000-000000000301') <> 2 then
    raise exception '0802: uq_posicion_lectura dejó de deduplicar';
  end if;
  begin
    insert into public.posicion (tenant_id, unidad_id, lat, lng, medida_en, proveedor, despacho_ref)
      values ('82000000-0000-4000-8000-0000000000a1', '82000000-0000-4000-8000-000000000301', 20, -89, '2026-10-01 12:05:00+00', 'sintetico', 'OTRO');
    raise exception '0802: el duplicado con otro despacho_ref entró (uq_posicion_lectura)';
  exception when unique_violation then null; end;

  -- (c) índice de viaje: no único y parcial
  if (select count(*) from public.viaje where tenant_id = '82000000-0000-4000-8000-0000000000a1' and despacho_ref = 'D-100') <> 2 then
    raise exception '0802: la misma referencia no pudo repetirse en dos viajes';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'viaje' and indexname = 'viaje_tenant_despacho_ref_idx'
                 and indexdef not ilike '%unique%' and indexdef ilike '%where%despacho_ref is not null%') then
    raise exception '0802: el índice de viaje no es parcial/no único';
  end if;
  if exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'posicion' and indexdef ilike '%despacho_ref%') then
    raise exception '0802: se creó un índice en posicion sin justificarlo';
  end if;
end $$;

-- (d) RLS: flota A ve solo lo suyo
set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000401', true);
do $$ begin
  if (select count(*) from public.posicion where despacho_ref = 'D-100') <> 1
     or (select tenant_id from public.posicion where despacho_ref = 'D-100') <> '82000000-0000-4000-8000-0000000000a1' then
    raise exception '0802: RLS de posicion dejó cruzar flotas por despacho_ref';
  end if;
  if (select count(*) from public.viaje where despacho_ref = 'D-100') <> 2 then
    raise exception '0802: RLS de viaje dejó cruzar flotas por despacho_ref';
  end if;
end $$;
reset role;

-- (e) el plan de «última posición con referencia de la unidad» usa un índice existente (con pocas filas, se fuerza el índice)
set local enable_seqscan = off;
do $$
declare plan text; l text;
begin
  plan := '';
  for l in execute $q$explain select * from public.posicion
    where tenant_id = '82000000-0000-4000-8000-0000000000a1' and unidad_id = '82000000-0000-4000-8000-000000000301'
      and despacho_ref is not null order by medida_en desc limit 1$q$ loop
    plan := plan || l || E'\n';
  end loop;
  if plan not ilike '%posicion_unidad_medida_idx%' and plan not ilike '%uq_posicion_lectura%' then
    raise exception '0802: el plan no usa un índice existente de posicion: %', plan;
  end if;
end $$;

rollback;
