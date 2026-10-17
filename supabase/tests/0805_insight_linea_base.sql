\set ON_ERROR_STOP on
-- 0805 — línea base de la flota, contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) UNIQUE (flota, proceso): recapturar no duplica; otro proceso u otra flota sí caben;
--   (b) dominios: minutos > 0, y proceso, unidad y fuente no vacíos (sin fuente no hay número);
--   (c) borrar la flota borra su línea base;
--   (d) RLS por administra_flota(): el administrador de la flota A ve y escribe lo suyo, no lo de B;
--       un usuario sin rol de control (contador) no ve nada; anon no tiene permisos.
begin;

insert into public.tenant (id, nombre) values
  ('80500000-0000-4000-8000-0000000000a1', 'Flota A 0805'),
  ('80500000-0000-4000-8000-0000000000b1', 'Flota B 0805');
insert into public.app_user (id, tenant_id, email, rol) values
  ('80500000-0000-4000-8000-000000000401', '80500000-0000-4000-8000-0000000000a1', 'admin-0805@test.invalid', 'flota_admin'),
  ('80500000-0000-4000-8000-000000000402', '80500000-0000-4000-8000-0000000000a1', 'contador-0805@test.invalid', 'contador');

do $$
declare
  ta constant uuid := '80500000-0000-4000-8000-0000000000a1';
  tb constant uuid := '80500000-0000-4000-8000-0000000000b1';
begin
  -- (a) unicidad
  insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (ta, 'desglose', 20, 'desglose', 'cronometraje sintetico');
  begin
    insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (ta, 'desglose', 25, 'desglose', 'otra captura');
    raise exception '0805: duplicó el mismo proceso en la misma flota';
  exception when unique_violation then null; end;
  insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (ta, 'revision de casetas', 12.5, 'cruce', 'cronometraje sintetico');
  insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (tb, 'desglose', 30, 'desglose', 'cronometraje sintetico');

  -- (b) dominios
  begin insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (ta, 'x1', 0, 'u', 'f'); raise exception '0805: minutos en cero'; exception when check_violation then null; end;
  begin insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (ta, 'x2', -3, 'u', 'f'); raise exception '0805: minutos negativos'; exception when check_violation then null; end;
  begin insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (ta, '  ', 5, 'u', 'f'); raise exception '0805: proceso vacío'; exception when check_violation then null; end;
  begin insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (ta, 'x3', 5, '', 'f'); raise exception '0805: unidad vacía'; exception when check_violation then null; end;
  begin insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (ta, 'x4', 5, 'u', ' '); raise exception '0805: sin fuente'; exception when check_violation then null; end;
  begin insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (ta, 'x5', null, 'u', 'f'); raise exception '0805: minutos nulos'; exception when not_null_violation then null; end;

  -- RLS activa y sin permisos para anon
  if not (select relrowsecurity from pg_class where oid = 'public.insight_linea_base'::regclass) then raise exception '0805: sin RLS'; end if;
  if has_table_privilege('anon', 'public.insight_linea_base', 'select') then raise exception '0805: anon puede leer'; end if;
  if has_table_privilege('anon', 'public.insight_linea_base', 'insert') then raise exception '0805: anon puede escribir'; end if;
end $$;

-- (d) RLS: el administrador de la flota A ve solo lo suyo y puede escribir en su flota, no en la B
set local role authenticated;
select set_config('request.jwt.claim.sub', '80500000-0000-4000-8000-000000000401', true);
do $$ begin
  if (select count(*) from public.insight_linea_base) <> 2
     or exists (select 1 from public.insight_linea_base where tenant_id = '80500000-0000-4000-8000-0000000000b1') then
    raise exception '0805: RLS dejó cruzar flotas (ve % filas)', (select count(*) from public.insight_linea_base);
  end if;
  update public.insight_linea_base set minutos_por_unidad = 18 where proceso = 'desglose';
  if (select minutos_por_unidad from public.insight_linea_base where proceso = 'desglose') <> 18 then raise exception '0805: el administrador no pudo recapturar'; end if;
  begin
    insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente)
      values ('80500000-0000-4000-8000-0000000000b1', 'intruso', 5, 'u', 'f');
    raise exception '0805: escribió en otra flota';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- un usuario sin rol de control (contador) no ve la línea base
set local role authenticated;
select set_config('request.jwt.claim.sub', '80500000-0000-4000-8000-000000000402', true);
do $$ begin
  if (select count(*) from public.insight_linea_base) <> 0 then raise exception '0805: el contador vio la línea base'; end if;
end $$;
reset role;

-- (c) borrar la flota borra su línea base
do $$ begin
  delete from public.tenant where id = '80500000-0000-4000-8000-0000000000b1';
  if exists (select 1 from public.insight_linea_base where tenant_id = '80500000-0000-4000-8000-0000000000b1') then raise exception '0805: la línea base sobrevivió a la flota'; end if;
end $$;

rollback;
