\set ON_ERROR_STOP on
-- 0770 — perfil de tenant (cinco_agentes) contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) una fila por flota (PK) y dominio cerrado de `perfil` (un nombre inventado rebota);
--   (b) borrar la flota borra su perfil (cascade) y borrar a quien lo aplicó NO lo quita (set null);
--   (c) el trigger asienta en bitacora_auditoria cada alta, cambio y baja (perfil_tenant.aplicar/cambiar/quitar);
--   (d) RLS deny-all: encendida y SIN políticas; una sesión `authenticated` no lee el perfil de ninguna flota;
--   (e) la función del trigger no es ejecutable por anon/authenticated.
begin;

insert into public.tenant (id, nombre) values
  ('77000000-0000-4000-8000-0000000000a1', 'Flota A 0770'),
  ('77000000-0000-4000-8000-0000000000b1', 'Flota B 0770');
insert into public.app_user (id, tenant_id, email, rol) values
  ('77000000-0000-4000-8000-000000000401', '77000000-0000-4000-8000-0000000000a1', 'admin-0770@test.invalid', 'flota_admin');

do $$
declare
  A constant uuid := '77000000-0000-4000-8000-0000000000a1';
  B constant uuid := '77000000-0000-4000-8000-0000000000b1';
  U constant uuid := '77000000-0000-4000-8000-000000000401';
  n int;
begin
  -- (a) PK y dominio
  insert into public.tenant_perfil (tenant_id, perfil, cambiado_por) values (A, 'cinco_agentes', U);
  begin
    insert into public.tenant_perfil (tenant_id, perfil) values (A, 'cinco_agentes');
    raise exception '0770: dos perfiles para la misma flota';
  exception when unique_violation then null; end;
  begin
    insert into public.tenant_perfil (tenant_id, perfil) values (B, 'perfil_inventado');
    raise exception '0770: aceptó un perfil fuera del dominio';
  exception when check_violation then null; end;
  begin
    insert into public.tenant_perfil (tenant_id, perfil) values (gen_random_uuid(), 'cinco_agentes');
    raise exception '0770: perfil para una flota que no existe';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.tenant_perfil (tenant_id, perfil) values (B, null);
    raise exception '0770: perfil nulo';
  exception when not_null_violation then null; end;

  -- (c) bitácora: alta
  select count(*) into n from public.bitacora_auditoria where tenant_id = A and accion = 'perfil_tenant.aplicar' and actor_id = U;
  if n <> 1 then raise exception '0770: el alta no quedó en bitácora (hay %)', n; end if;
  -- cambio (aunque el valor sea el mismo, el UPDATE se asienta)
  update public.tenant_perfil set cambiado_en = now() where tenant_id = A;
  select count(*) into n from public.bitacora_auditoria where tenant_id = A and accion = 'perfil_tenant.cambiar';
  if n <> 1 then raise exception '0770: el cambio no quedó en bitácora (hay %)', n; end if;

  -- (b) borrar a quien lo aplicó no quita el perfil
  delete from public.app_user where id = U;
  if not exists (select 1 from public.tenant_perfil where tenant_id = A and cambiado_por is null) then
    raise exception '0770: borrar al autor quitó el perfil o no puso cambiado_por en null';
  end if;

  -- (c) baja explícita asienta 'quitar'
  delete from public.tenant_perfil where tenant_id = A;
  select count(*) into n from public.bitacora_auditoria where tenant_id = A and accion = 'perfil_tenant.quitar';
  if n <> 1 then raise exception '0770: la baja no quedó en bitácora (hay %)', n; end if;

  -- (b) borrar la flota con perfil: el cascade no debe romper por la bitácora
  insert into public.tenant_perfil (tenant_id, perfil) values (B, 'cinco_agentes');
  delete from public.tenant where id = B;
  if exists (select 1 from public.tenant_perfil where tenant_id = B) then
    raise exception '0770: el perfil sobrevivió a la baja de la flota';
  end if;

  -- (d) deny-all
  if not (select relrowsecurity from pg_class where oid = 'public.tenant_perfil'::regclass) then raise exception '0770: sin RLS'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_perfil') then
    raise exception '0770: tenant_perfil no debe tener políticas (deny-all)';
  end if;
  -- (e) la función del trigger no es ejecutable por los roles de la app
  if has_function_privilege('anon', 'public.tenant_perfil_bitacora()', 'execute')
     or has_function_privilege('authenticated', 'public.tenant_perfil_bitacora()', 'execute') then
    raise exception '0770: tenant_perfil_bitacora() ejecutable por anon/authenticated';
  end if;
end $$;

-- (d) una sesión autenticada de la flota A no ve ningún perfil (ni el suyo)
insert into public.app_user (id, tenant_id, email, rol) values
  ('77000000-0000-4000-8000-000000000402', '77000000-0000-4000-8000-0000000000a1', 'admin2-0770@test.invalid', 'flota_admin');
insert into public.tenant_perfil (tenant_id, perfil) values ('77000000-0000-4000-8000-0000000000a1', 'cinco_agentes');
set local role authenticated;
select set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000402', true);
do $$ begin
  begin
    if (select count(*) from public.tenant_perfil) <> 0 then
      raise exception '0770: authenticated leyó tenant_perfil (% filas)', (select count(*) from public.tenant_perfil);
    end if;
  exception when insufficient_privilege then null; end;  -- sin privilegio también es deny-all
  begin
    insert into public.tenant_perfil (tenant_id, perfil) values ('77000000-0000-4000-8000-0000000000a1', 'cinco_agentes');
    raise exception '0770: authenticated escribió tenant_perfil';
  exception when insufficient_privilege or unique_violation then
    if sqlstate = '23505' then raise exception '0770: authenticated llegó a la restricción única (RLS no bloqueó)'; end if;
  end;
end $$;
reset role;

rollback;
