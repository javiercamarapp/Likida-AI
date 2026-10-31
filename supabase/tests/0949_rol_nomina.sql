\set ON_ERROR_STOP on
-- 0949 — rol `nomina` contra Postgres REAL (datos sinteticos, termina en rollback).
-- Lo que solo la base garantiza:
--   (a) el dominio de app_user.rol acepta los seis roles (superadmin, flota_admin, contador, encargado, vendedor, nomina) y
--       rechaza basura y `operador` (retirado en 0086);
--   (b) una sesion `nomina` da false en is_superadmin(), ve_finanzas(), administra_flota() y ve_operacion();
--   (c) AISLAMIENTO: un usuario nomina de la flota A no ve filas de la flota B (app_user, tenant) ni de dinero de su propia flota
--       que el encargado tampoco ve (cotizacion, gateada por ve_finanzas());
--   (d) ninguna politica RLS nombra a 'nomina' ni usa listas negativas de rol, y las politicas de dinero siguen colgando de
--       ve_finanzas()/administra_flota() (nomina no abre nada por su cuenta);
--   (e) reaplicar la migracion dos veces no falla y deja una sola constraint con la lista completa.
begin;

insert into public.tenant (id, nombre) values
  ('94900000-0000-4000-8000-0000000000a1', 'Flota A 0949'),
  ('94900000-0000-4000-8000-0000000000b1', 'Flota B 0949');

-- (e) reaplicar la migracion tal cual (ruta relativa a la raiz del repo, como el resto de los pasos de CI)
\i supabase/migrations/0949_rol_nomina.sql
\i supabase/migrations/0949_rol_nomina.sql

do $$
declare
  A constant uuid := '94900000-0000-4000-8000-0000000000a1';
  B constant uuid := '94900000-0000-4000-8000-0000000000b1';
  rol_ok text;
  n int;
begin
  -- (e) una sola constraint con la lista completa
  select count(*) into n from pg_constraint where conname = 'app_user_rol_dominio' and conrelid = 'public.app_user'::regclass;
  if n <> 1 then raise exception '0949: reaplicar dejo % constraints app_user_rol_dominio', n; end if;

  -- (a) los seis roles entran (vendedor y superadmin sin flota; el resto con flota)
  foreach rol_ok in array array['flota_admin', 'contador', 'encargado', 'nomina'] loop
    insert into public.app_user (id, tenant_id, email, rol)
    values (gen_random_uuid(), A, 'rol-' || rol_ok || '-0949@test.invalid', rol_ok);
  end loop;
  insert into public.app_user (id, tenant_id, email, rol) values (gen_random_uuid(), null, 'vendedor-0949@test.invalid', 'vendedor');
  insert into public.app_user (id, tenant_id, email, rol) values (gen_random_uuid(), null, 'super-0949@test.invalid', 'superadmin');

  -- (a) basura y operador rebotan con 23514
  begin
    insert into public.app_user (id, tenant_id, email, rol) values (gen_random_uuid(), A, 'basura-0949@test.invalid', 'basura');
    raise exception '0949: el dominio acepto un rol inventado';
  exception when check_violation then null;
  end;
  begin
    insert into public.app_user (id, tenant_id, email, rol) values (gen_random_uuid(), A, 'operador-0949@test.invalid', 'operador');
    raise exception '0949: el dominio volvio a aceptar operador';
  exception when check_violation then null;
  end;
end $$;

-- Usuarios con id conocido para impersonar.
insert into public.app_user (id, tenant_id, email, rol, activo) values
  ('94900000-0000-4000-8000-000000000a01', '94900000-0000-4000-8000-0000000000a1', 'nomina-a-0949@test.invalid', 'nomina', true),
  ('94900000-0000-4000-8000-000000000a02', '94900000-0000-4000-8000-0000000000a1', 'encargado-a-0949@test.invalid', 'encargado', true),
  ('94900000-0000-4000-8000-000000000b01', '94900000-0000-4000-8000-0000000000b1', 'nomina-b-0949@test.invalid', 'nomina', true);

-- Dinero sintetico de la flota A para que la prueba (c) no sea vacua (como superusuario: no pasa por RLS).
insert into public.cotizacion (tenant_id, origen, destino, precio) values ('94900000-0000-4000-8000-0000000000a1', 'Origen 0949', 'Destino 0949', 1234.00);

-- (b) y (c) como una sesion nomina de la flota A (lo que hace PostgREST: SET ROLE + claims).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"94900000-0000-4000-8000-000000000a01","role":"authenticated"}', true);

do $$
declare
  A constant uuid := '94900000-0000-4000-8000-0000000000a1';
  B constant uuid := '94900000-0000-4000-8000-0000000000b1';
  n int;
begin
  -- (b) los cuatro ayudantes de RLS dan false
  if public.is_superadmin() then raise exception '0949(b): nomina es superadmin'; end if;
  if public.ve_finanzas() then raise exception '0949(b): nomina ve finanzas'; end if;
  if public.administra_flota() then raise exception '0949(b): nomina administra la flota'; end if;
  if public.ve_operacion() then raise exception '0949(b): nomina ve operacion'; end if;
  -- su flota sigue siendo la suya, y solo esa
  if public.get_user_tenant_ids() <> array[A] then raise exception '0949(b): get_user_tenant_ids de nomina no es solo su flota'; end if;

  -- (c) la flota B no existe para ella: ni en app_user ni en tenant (si el grant esta cerrado por la 0947, tampoco se lee: igual de bien)
  begin
    select count(*) into n from public.app_user where tenant_id = B;
    if n <> 0 then raise exception '0949(c): nomina de A ve % filas de app_user de la flota B', n; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into n from public.tenant where id = B;
    if n <> 0 then raise exception '0949(c): nomina de A ve la fila de tenant de la flota B'; end if;
  exception when insufficient_privilege then null;
  end;
  -- (c) el dinero que el encargado no ve (cotizacion, gateada por ve_finanzas()) tampoco: 0 filas aunque exista una de SU flota
  begin
    select count(*) into n from public.cotizacion;
    if n <> 0 then raise exception '0949(c): nomina ve % cotizaciones', n; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- (d) estructura de las politicas RLS: nomina no abre nada por su cuenta.
do $$
declare
  n int;
  uso_finanzas int;
begin
  select count(*) into n from pg_policies
   where schemaname in ('public', 'storage')
     and (coalesce(qual, '') ~* 'nomina' or coalesce(with_check, '') ~* 'nomina');
  if n <> 0 then raise exception '0949(d): % politicas nombran a nomina', n; end if;

  -- ninguna politica decide por lista NEGATIVA de rol de app_user (un rol nuevo entraria por omision)
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'rol\s*(<>|!=|not in)';
  if n <> 0 then raise exception '0949(d): % politicas usan una lista negativa de rol', n; end if;

  -- las politicas de dinero siguen colgando del ayudante (no se perdio ninguna al tocar el dominio)
  select count(*) into uso_finanzas from pg_policies
   where schemaname = 'public' and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(ve_finanzas|administra_flota)\(';
  if uso_finanzas = 0 then raise exception '0949(d): no quedo ninguna politica con ve_finanzas()/administra_flota()'; end if;
end $$;

rollback;
