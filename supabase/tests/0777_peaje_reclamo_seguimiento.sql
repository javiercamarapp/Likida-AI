\set ON_ERROR_STOP on
-- 0777 — reclamos de peaje y sus notas de crédito, contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) dominio de estado, montos no negativos, `estado <> preparado` exige enviado_en, textos acotados;
--   (b) la FK compuesta (desglose, flota) impide colgar un reclamo del desglose de otra flota, y borrar el
--       desglose deja el reclamo con desglose_id en null (set null SOLO de esa columna, tenant_id intacto);
--   (c) peaje_reclamo_nota: monto > 0, FK compuesta al reclamo de la MISMA flota, cascade al borrar el reclamo;
--   (d) RLS encendida SIN políticas (deny-all) y una sesión `authenticated` no lee nada;
--   (e) la unique (id, tenant_id) de desglose_peaje existe (la reaplicación no la duplica).
begin;

insert into public.tenant (id, nombre) values
  ('77700000-0000-4000-8000-0000000000a1', 'Flota A 0777'),
  ('77700000-0000-4000-8000-0000000000b1', 'Flota B 0777');
insert into public.app_user (id, tenant_id, email, rol) values
  ('77700000-0000-4000-8000-000000000401', '77700000-0000-4000-8000-0000000000a1', 'admin-0777@test.invalid', 'flota_admin');
insert into public.desglose_peaje (id, tenant_id, proveedor) values
  ('77700000-0000-4000-8000-0000000000a2', '77700000-0000-4000-8000-0000000000a1', 'PROV'),
  ('77700000-0000-4000-8000-0000000000b2', '77700000-0000-4000-8000-0000000000b1', 'PROV');

do $$
declare
  A constant uuid := '77700000-0000-4000-8000-0000000000a1';
  B constant uuid := '77700000-0000-4000-8000-0000000000b1';
  DA constant uuid := '77700000-0000-4000-8000-0000000000a2';
  DB constant uuid := '77700000-0000-4000-8000-0000000000b2';
  r1 uuid; r2 uuid; t text;
begin
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_id_tenant_key') then
    raise exception '0777: falta desglose_peaje_id_tenant_key';
  end if;

  -- (a) dominio y coherencia
  insert into public.peaje_reclamo (tenant_id, desglose_id, fecha_cobro_mas_antiguo) values (A, DA, '2026-01-10') returning id into r1;
  begin insert into public.peaje_reclamo (tenant_id, estado, fecha_cobro_mas_antiguo) values (A, 'inventado', '2026-01-10');
    raise exception '0777: estado fuera del dominio'; exception when check_violation then null; end;
  begin insert into public.peaje_reclamo (tenant_id, estado, fecha_cobro_mas_antiguo) values (A, 'enviado', '2026-01-10');
    raise exception '0777: enviado sin fecha de envío'; exception when check_violation then null; end;
  insert into public.peaje_reclamo (tenant_id, estado, enviado_en, fecha_cobro_mas_antiguo) values (A, 'enviado', '2026-01-20', '2026-01-10');
  begin insert into public.peaje_reclamo (tenant_id, monto_reclamado, fecha_cobro_mas_antiguo) values (A, -1, '2026-01-10');
    raise exception '0777: monto negativo'; exception when check_violation then null; end;
  begin insert into public.peaje_reclamo (tenant_id, n_cruces, fecha_cobro_mas_antiguo) values (A, -1, '2026-01-10');
    raise exception '0777: n_cruces negativo'; exception when check_violation then null; end;
  begin insert into public.peaje_reclamo (tenant_id, notas, fecha_cobro_mas_antiguo) values (A, repeat('n', 1001), '2026-01-10');
    raise exception '0777: notas de más de 1000'; exception when check_violation then null; end;
  begin insert into public.peaje_reclamo (tenant_id, referencia_portal, fecha_cobro_mas_antiguo) values (A, repeat('r', 121), '2026-01-10');
    raise exception '0777: referencia de más de 120'; exception when check_violation then null; end;
  begin insert into public.peaje_reclamo (tenant_id) values (A);
    raise exception '0777: reclamo sin fecha de cobro más antiguo'; exception when not_null_violation then null; end;

  -- (b) FK compuesta
  begin insert into public.peaje_reclamo (tenant_id, desglose_id, fecha_cobro_mas_antiguo) values (A, DB, '2026-01-10');
    raise exception '0777: la flota A colgó un reclamo del desglose de la flota B'; exception when foreign_key_violation then null; end;
  insert into public.peaje_reclamo (tenant_id, desglose_id, fecha_cobro_mas_antiguo) values (B, DB, '2026-01-10') returning id into r2;

  -- (c) notas
  insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, fecha, monto) values (A, r1, '2026-02-01', 50.25);
  begin insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, fecha, monto) values (A, r1, '2026-02-01', 0);
    raise exception '0777: nota de monto cero'; exception when check_violation then null; end;
  begin insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, fecha, monto, referencia) values (A, r1, '2026-02-01', 1, repeat('r', 121));
    raise exception '0777: referencia de nota de más de 120'; exception when check_violation then null; end;
  begin insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, fecha, monto) values (A, r2, '2026-02-01', 10);
    raise exception '0777: la flota A colgó una nota del reclamo de B'; exception when foreign_key_violation then null; end;

  -- (b, cont.) borrar el desglose: el reclamo queda, sin desglose, y conserva su flota
  delete from public.desglose_peaje where id = DA;
  if not exists (select 1 from public.peaje_reclamo where id = r1 and desglose_id is null and tenant_id = A) then
    raise exception '0777: borrar el desglose borró el reclamo o dejó la flota en null';
  end if;
  -- (c, cont.) borrar el reclamo borra sus notas
  delete from public.peaje_reclamo where id = r1;
  if exists (select 1 from public.peaje_reclamo_nota where reclamo_id = r1) then raise exception '0777: la nota sobrevivió al reclamo'; end if;

  -- (d) deny-all
  foreach t in array array['peaje_reclamo', 'peaje_reclamo_nota'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '0777: RLS apagada en %', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then raise exception '0777: % no debe tener políticas', t; end if;
  end loop;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '77700000-0000-4000-8000-000000000401', true);
do $$ declare t text; n int;
begin
  foreach t in array array['peaje_reclamo', 'peaje_reclamo_nota'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then raise exception '0777: authenticated leyó % filas de %', n, t; end if;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;

rollback;
