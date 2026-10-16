\set ON_ERROR_STOP on
-- 0779 — configuración y hallazgos del detector de cruces atípicos, contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) peaje_atipico_config: una fila por flota, `activo` nace en FALSE (apagado de origen), umbrales = objeto;
--   (b) peaje_atipico: llave única por flota (idempotencia al guardar; otra flota puede repetirla), dominio de regla y
--       de estado, formas acotadas, monto no negativo, revisado_en/revisado_por juntos y exigidos en revisado/justificado;
--   (c) FKs compuestas: el hallazgo no se cuelga del desglose ni de la unidad de otra flota; borrar el desglose borra el hallazgo;
--   (d) RLS encendida SIN políticas (deny-all) y una sesión `authenticated` no lee nada.
begin;

insert into public.tenant (id, nombre) values
  ('77900000-0000-4000-8000-0000000000a1', 'Flota A 0779'),
  ('77900000-0000-4000-8000-0000000000b1', 'Flota B 0779');
insert into public.app_user (id, tenant_id, email, rol) values
  ('77900000-0000-4000-8000-000000000401', '77900000-0000-4000-8000-0000000000a1', 'admin-0779@test.invalid', 'flota_admin');
insert into public.desglose_peaje (id, tenant_id, proveedor) values
  ('77900000-0000-4000-8000-0000000000a2', '77900000-0000-4000-8000-0000000000a1', 'PROV'),
  ('77900000-0000-4000-8000-0000000000b2', '77900000-0000-4000-8000-0000000000b1', 'PROV');
insert into public.unidad (id, tenant_id, numero_economico) values
  ('77900000-0000-4000-8000-0000000000a3', '77900000-0000-4000-8000-0000000000a1', 'U-0779-A'),
  ('77900000-0000-4000-8000-0000000000b3', '77900000-0000-4000-8000-0000000000b1', 'U-0779-B');

do $$
declare
  A constant uuid := '77900000-0000-4000-8000-0000000000a1';
  B constant uuid := '77900000-0000-4000-8000-0000000000b1';
  DA constant uuid := '77900000-0000-4000-8000-0000000000a2';
  DB constant uuid := '77900000-0000-4000-8000-0000000000b2';
  UA constant uuid := '77900000-0000-4000-8000-0000000000a3';
  UB constant uuid := '77900000-0000-4000-8000-0000000000b3';
  t text;
begin
  -- (a) config
  insert into public.peaje_atipico_config (tenant_id) values (A);
  if (select activo from public.peaje_atipico_config where tenant_id = A) then raise exception '0779: el detector nació prendido'; end if;
  if (select umbrales from public.peaje_atipico_config where tenant_id = A) <> '{}'::jsonb then raise exception '0779: umbrales por defecto no vacíos'; end if;
  begin insert into public.peaje_atipico_config (tenant_id) values (A);
    raise exception '0779: dos configuraciones para la misma flota'; exception when unique_violation then null; end;
  begin insert into public.peaje_atipico_config (tenant_id, umbrales) values (B, '[1]'::jsonb);
    raise exception '0779: umbrales que no son objeto'; exception when check_violation then null; end;

  -- (b) hallazgos
  insert into public.peaje_atipico (tenant_id, llave, desglose_id, unidad_id, unidad_archivo, regla) values (A, 'k1', DA, UA, 'U-0779-A', 'repeticion_caseta');
  insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla) values (B, 'k1', 'U-0779-B', 'secuencia_imposible');  -- otra flota: misma llave cabe
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla) values (A, 'k1', 'U', 'repeticion_caseta');
    raise exception '0779: llave duplicada en la misma flota'; exception when unique_violation then null; end;
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla) values (A, 'k2', 'U', 'regla_inventada');
    raise exception '0779: regla fuera del dominio'; exception when check_violation then null; end;
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla, estado) values (A, 'k3', 'U', 'repeticion_caseta', 'inventado');
    raise exception '0779: estado fuera del dominio'; exception when check_violation then null; end;
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla, monto) values (A, 'k4', 'U', 'repeticion_caseta', -1);
    raise exception '0779: monto negativo'; exception when check_violation then null; end;
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla) values (A, '', 'U', 'repeticion_caseta');
    raise exception '0779: llave vacía'; exception when check_violation then null; end;
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla) values (A, 'k5', repeat('u', 41), 'repeticion_caseta');
    raise exception '0779: unidad_archivo de más de 40'; exception when check_violation then null; end;
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla, detalle) values (A, 'k6', 'U', 'repeticion_caseta', '[]'::jsonb);
    raise exception '0779: detalle que no es objeto'; exception when check_violation then null; end;
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla, nota) values (A, 'k7', 'U', 'repeticion_caseta', repeat('n', 301));
    raise exception '0779: nota de más de 300'; exception when check_violation then null; end;
  -- revisión coherente
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla, estado) values (A, 'k8', 'U', 'repeticion_caseta', 'revisado');
    raise exception '0779: revisado sin revisor ni fecha'; exception when check_violation then null; end;
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla, revisado_en) values (A, 'k9', 'U', 'repeticion_caseta', now());
    raise exception '0779: fecha de revisión sin revisor'; exception when check_violation then null; end;
  insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla, estado, revisado_en, revisado_por) values (A, 'k10', 'U', 'repeticion_caseta', 'justificado', now(), 'revisor sintético');

  -- (c) FKs compuestas
  begin insert into public.peaje_atipico (tenant_id, llave, desglose_id, unidad_archivo, regla) values (A, 'k11', DB, 'U', 'repeticion_caseta');
    raise exception '0779: colgó el hallazgo del desglose de otra flota'; exception when foreign_key_violation then null; end;
  begin insert into public.peaje_atipico (tenant_id, llave, unidad_id, unidad_archivo, regla) values (A, 'k12', UB, 'U', 'repeticion_caseta');
    raise exception '0779: colgó el hallazgo de la unidad de otra flota'; exception when foreign_key_violation then null; end;
  delete from public.desglose_peaje where id = DA;
  if exists (select 1 from public.peaje_atipico where tenant_id = A and llave = 'k1') then raise exception '0779: el hallazgo sobrevivió a su desglose'; end if;

  -- (d) deny-all
  foreach t in array array['peaje_atipico_config', 'peaje_atipico'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '0779: RLS apagada en %', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then raise exception '0779: % no debe tener políticas', t; end if;
  end loop;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '77900000-0000-4000-8000-000000000401', true);
do $$ declare t text; n int;
begin
  foreach t in array array['peaje_atipico_config', 'peaje_atipico'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then raise exception '0779: authenticated leyó % filas de %', n, t; end if;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;

rollback;
