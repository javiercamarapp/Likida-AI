-- 0949 · el rol `nomina` bajo los grants REALES de la 0947 (los de producción: 0946-0948 ya están aplicadas allá).
-- Datos sintéticos, termina en rollback; sale con error (ON_ERROR_STOP) si algo no se cumple. Corre en ci-postgres JUSTO antes de
-- restituir los grants previos a la 0947, igual que login_bajo_grants_0947.sql.
begin;

insert into public.tenant (id, nombre) values
  ('94900000-0000-4000-8000-0000000b1947', 'prueba-nomina-0947 A'),
  ('94900000-0000-4000-8000-0000000b2947', 'prueba-nomina-0947 B');
insert into public.app_user (id, tenant_id, email, nombre, rol, activo) values
  ('94900000-0000-4000-8000-0000000b1948', '94900000-0000-4000-8000-0000000b1947', 'nomina-a-0947@ejemplo.test', 'Nomina A', 'nomina', true),
  ('94900000-0000-4000-8000-0000000b1949', '94900000-0000-4000-8000-0000000b1947', 'dueno-a-0947@ejemplo.test', 'Dueño A', 'flota_admin', true),
  ('94900000-0000-4000-8000-0000000b2949', '94900000-0000-4000-8000-0000000b2947', 'dueno-b-0947@ejemplo.test', 'Dueño B', 'flota_admin', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"94900000-0000-4000-8000-0000000b1948","role":"authenticated"}', true);

do $$
declare n int; t text; r record;
begin
  -- 1. Puede leer SU fila (el login del producto) y ve a su flota, pero no a la otra.
  select rol, activo into r from public.app_user where id = '94900000-0000-4000-8000-0000000b1948';
  if r.rol is distinct from 'nomina' or r.activo is not true then raise exception 'NOMINA_0947(1): no pudo leer su propia fila (%)', r; end if;
  select count(*) into n from public.app_user where tenant_id = '94900000-0000-4000-8000-0000000b2947';
  if n <> 0 then raise exception 'NOMINA_0947(2): nomina de A ve % filas de app_user de la flota B', n; end if;

  -- 2. Ninguna tabla de dinero ni de operación se lee con su JWT (42501), de su flota o de otra.
  foreach t in array array['liquidacion', 'gasto', 'viaje', 'factura_emitida', 'cotizacion', 'liquidacion_desglose', 'liquidacion_entrega_correo', 'tenant', 'tenant_api_key'] loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'NOMINA_0947(3): nomina pudo leer public.% bajo los grants de la 0947', t;
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- 3. Ni escribir.
  begin
    update public.app_user set rol = 'flota_admin' where id = '94900000-0000-4000-8000-0000000b1948';
    raise exception 'NOMINA_0947(4): nomina pudo escribir en app_user (escalada de rol)';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.viaje (tenant_id) values ('94900000-0000-4000-8000-0000000b1947');
    raise exception 'NOMINA_0947(5): nomina pudo insertar en viaje';
  exception when insufficient_privilege then null;
  end;

  -- 4. Los ayudantes de RLS siguen ejecutables y dan false para ella.
  if public.is_superadmin() or public.ve_finanzas() or public.administra_flota() or public.ve_operacion() then
    raise exception 'NOMINA_0947(6): un ayudante de RLS dio true para nomina';
  end if;
end $$;

reset role;
rollback;
