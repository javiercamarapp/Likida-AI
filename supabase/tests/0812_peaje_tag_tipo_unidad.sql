\set ON_ERROR_STOP on
-- 0812 — Tipo de unidad del TAG (tracto / utilitario), contra Postgres REAL.
-- Lo que solo la base puede demostrar: la columna nace NULL (sin tipo de unidad) para los TAGs que ya existían,
-- admite 'tracto' y 'utilitario' y rechaza cualquier otro valor, y la migración es idempotente (correrla otra vez
-- no falla ni borra el tipo ya capturado).
begin;

insert into public.tenant (id, nombre) values ('81200000-0000-4000-8000-0000000000a1', 'Flota A 0812');
insert into public.unidad (id, tenant_id, numero_economico) values
  ('81200000-0000-4000-8000-0000000000a2', '81200000-0000-4000-8000-0000000000a1', 'U-0812');

do $$
declare
  A constant uuid := '81200000-0000-4000-8000-0000000000a1';
  U constant uuid := '81200000-0000-4000-8000-0000000000a2';
  v text;
begin
  -- Un TAG dado de alta sin tipo nace NULL: no se inventa.
  insert into public.peaje_tag (tenant_id, tag, unidad_id) values (A, 'TAGSINTIPO1', U);
  select tipo_unidad into v from public.peaje_tag where tenant_id = A and tag = 'TAGSINTIPO1';
  if v is not null then raise exception '0812: un TAG sin tipo nació con tipo %', v; end if;

  insert into public.peaje_tag (tenant_id, tag, unidad_id, tipo_unidad) values (A, 'TAGTRACTO1', U, 'tracto');
  insert into public.peaje_tag (tenant_id, tag, unidad_id, tipo_unidad) values (A, 'TAGUTIL001', U, 'utilitario');

  begin
    insert into public.peaje_tag (tenant_id, tag, unidad_id, tipo_unidad) values (A, 'TAGMALO001', U, 'camioneta');
    raise exception '0812: la base admitió un tipo de unidad inventado';
  exception when check_violation then null; end;
  begin
    update public.peaje_tag set tipo_unidad = '' where tenant_id = A and tag = 'TAGTRACTO1';
    raise exception '0812: la base admitió un tipo de unidad vacío';
  exception when check_violation then null; end;
end $$;

-- Idempotente: volver a correr la migración no falla ni borra el tipo capturado.
\i supabase/migrations/0812_peaje_tag_tipo_unidad.sql

do $$
declare v text;
begin
  select tipo_unidad into v from public.peaje_tag where tag = 'TAGUTIL001' and tenant_id = '81200000-0000-4000-8000-0000000000a1';
  if v is distinct from 'utilitario' then raise exception '0812: la migración repetida alteró el tipo (%)', v; end if;
end $$;

rollback;
