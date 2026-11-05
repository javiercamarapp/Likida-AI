\set ON_ERROR_STOP on
-- 0983 — onboarding_estado y onboarding_tenant contra Postgres REAL: forma, topes, cascada y cierre de privilegios. Termina en rollback.
begin;

insert into public.tenant (id, nombre) values
  ('98300000-0000-4000-8000-0000000000a1', 'Flota A 0983'),
  ('98300000-0000-4000-8000-0000000000b1', 'Flota B 0983');
insert into public.app_user (id, tenant_id, email, rol) values
  ('98300000-0000-4000-8000-0000000000a2', '98300000-0000-4000-8000-0000000000a1', 'a0983@example.invalid', 'flota_admin'),
  ('98300000-0000-4000-8000-0000000000b2', '98300000-0000-4000-8000-0000000000b1', 'b0983@example.invalid', 'flota_admin');

do $$
declare
  ta constant uuid := '98300000-0000-4000-8000-0000000000a1';
  tb constant uuid := '98300000-0000-4000-8000-0000000000b1';
  ua constant uuid := '98300000-0000-4000-8000-0000000000a2';
  ub constant uuid := '98300000-0000-4000-8000-0000000000b2';
  tc constant uuid := '98300000-0000-4000-8000-0000000000c1';
  n int; v int; rls boolean; priv boolean; grants_anon int;
begin
  -- 1. Fila nueva: estado vacio y version 1 por omision.
  insert into public.onboarding_estado (user_id, tenant_id) values (ua, ta);
  select version into v from public.onboarding_estado where user_id = ua and tenant_id = ta;
  if v <> 1 then raise exception '0983(1): la version inicial debia ser 1, es %', v; end if;

  -- 2. La clave es (usuario, flota): repetirla rebota; el mismo usuario en otra flota es otra fila.
  begin
    insert into public.onboarding_estado (user_id, tenant_id) values (ua, ta);
    raise exception '0983(2): la clave repetida debia rebotar';
  exception when unique_violation then null; end;
  insert into public.onboarding_estado (user_id, tenant_id, estado) values (ua, tb, '{"v":1}'::jsonb);

  -- 3. El estado debe ser un objeto y no pasar de 16 KiB.
  begin
    update public.onboarding_estado set estado = '[1,2]'::jsonb where user_id = ua and tenant_id = ta;
    raise exception '0983(3): un estado que no es objeto debia rebotar';
  exception when check_violation then null; end;
  begin
    update public.onboarding_estado set estado = jsonb_build_object('x', repeat('a', 17000)) where user_id = ua and tenant_id = ta;
    raise exception '0983(3): un estado de mas de 16 KiB debia rebotar';
  exception when check_violation then null; end;
  begin
    update public.onboarding_estado set version = 0 where user_id = ua and tenant_id = ta;
    raise exception '0983(3): version 0 debia rebotar';
  exception when check_violation then null; end;

  -- 4. onboarding_tenant: la invitacion nace apagada, los pedidos tienen el mismo tope.
  insert into public.onboarding_tenant (tenant_id) values (ta);
  if (select invitacion from public.onboarding_tenant where tenant_id = ta) is not false then
    raise exception '0983(4): la invitacion debia nacer apagada';
  end if;
  update public.onboarding_tenant set invitacion = true where tenant_id = ta;
  begin
    update public.onboarding_tenant set pedidos = jsonb_build_object('x', repeat('a', 17000)) where tenant_id = ta;
    raise exception '0983(4): pedidos de mas de 16 KiB debia rebotar';
  exception when check_violation then null; end;

  -- 5. Borrar una flota arrastra su estado y su interruptor; las filas de otras flotas (incluso del mismo usuario) no se tocan.
  --    Se usa una flota SIN usuarios para no depender de los candados de borrado de app_user.
  insert into public.tenant (id, nombre) values (tc, 'Flota C 0983');
  insert into public.onboarding_estado (user_id, tenant_id) values (ub, tc), (ub, tb);
  insert into public.onboarding_tenant (tenant_id) values (tc);
  delete from public.tenant where id = tc;
  select count(*) into n from public.onboarding_estado where tenant_id = tc;
  if n <> 0 then raise exception '0983(5): el estado de la flota borrada debia irse en cascada (quedan %)', n; end if;
  select count(*) into n from public.onboarding_tenant where tenant_id = tc;
  if n <> 0 then raise exception '0983(5): el interruptor de la flota borrada debia irse en cascada'; end if;
  select count(*) into n from public.onboarding_estado where user_id = ub and tenant_id = tb;
  if n <> 1 then raise exception '0983(5): la fila del mismo usuario en otra flota debia sobrevivir, hay %', n; end if;
  select count(*) into n from public.onboarding_tenant where tenant_id = ta;
  if n <> 1 then raise exception '0983(5): el interruptor de otra flota debia sobrevivir'; end if;

  -- 6. Seguridad: RLS prendida, sin politicas, sin privilegios para anon/authenticated y con CRUD para service_role.
  select bool_and(c.relrowsecurity) into rls from pg_class c where c.oid in ('public.onboarding_estado'::regclass, 'public.onboarding_tenant'::regclass);
  if not rls then raise exception '0983(6): RLS debia estar prendida en ambas tablas'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename in ('onboarding_estado', 'onboarding_tenant');
  if n <> 0 then raise exception '0983(6): no debe haber politicas (deny-all), hay %', n; end if;
  select count(*) into grants_anon from unnest(array['public.onboarding_estado', 'public.onboarding_tenant']) t, unnest(array['anon', 'authenticated']) r
   where has_table_privilege(r, t, 'select,insert,update,delete,truncate,references,trigger');
  if grants_anon <> 0 then raise exception '0983(6): anon/authenticated/public no deben tener privilegios (hay %)', grants_anon; end if;
  select bool_and(has_table_privilege('service_role', t, 'select,insert,update,delete')) into priv
    from unnest(array['public.onboarding_estado', 'public.onboarding_tenant']) t;
  if not priv then raise exception '0983(6): service_role debia tener CRUD'; end if;
end $$;

rollback;
