-- H3 (verificación independiente del PR #766): el CAMINO DE LOGIN bajo los grants REALES de la 0947. Corre en ci-postgres justo después de
-- capa0 y ANTES de restituir los grants previos (scripts/ci/grants_previos_0947_restaurar.sql), o sea con authenticated sin nada salvo
-- SELECT sobre app_user. Reproduce lo que hace el producto con el JWT de usuario (src/lib/auth/session.ts:70): lee su fila de app_user
-- (política app_user_self, que llama get_user_tenant_ids() e is_superadmin()) y NO puede leer ninguna otra tabla. Todo con rollback.
-- Sale con error (ON_ERROR_STOP) si algo no se cumple. En producción (solo lectura) se puede correr igual: usa datos sintéticos y revierte.
begin;

insert into public.tenant (id, nombre) values ('00000000-0000-4000-8000-0000000a1947', 'prueba-login-0947');
insert into public.app_user (id, tenant_id, email, nombre, rol, activo)
values ('00000000-0000-4000-8000-0000000a1948', '00000000-0000-4000-8000-0000000a1947', 'prueba-login-0947@ejemplo.test', 'Usuario de prueba', 'flota_admin', true),
       ('00000000-0000-4000-8000-0000000a1949', '00000000-0000-4000-8000-0000000a1947', 'prueba-login-0947-b@ejemplo.test', 'Compañero', 'contador', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000a1948","role":"authenticated"}', true);

-- 1. La lectura exacta del producto devuelve la fila propia (y la RLS deja ver al compañero de la misma flota).
do $$
declare n int; r record;
begin
  select tenant_id, rol, nombre, operador_id, avatar_url, activo into r
    from public.app_user where id = '00000000-0000-4000-8000-0000000a1948';
  if r.rol is distinct from 'flota_admin' or r.activo is not true then
    raise exception 'LOGIN_0947(1): no se pudo leer la fila propia de app_user bajo los grants de la 0947 (%)', r;
  end if;
  select count(*) into n from public.app_user where tenant_id = '00000000-0000-4000-8000-0000000a1947';
  if n <> 2 then raise exception 'LOGIN_0947(2): app_user_self debía mostrar 2 filas de la flota y mostró %', n; end if;
  -- Los ayudantes de RLS siguen ejecutables por authenticated.
  perform public.get_user_tenant_ids();
  perform public.is_superadmin();
end $$;

-- 2. Ninguna otra tabla se puede leer con el JWT de usuario (42501), con ejemplos de operación, finanzas y credenciales.
do $$
declare t text;
begin
  foreach t in array array['viaje', 'tenant', 'liquidacion', 'tenant_api_key', 'factura_emitida'] loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'LOGIN_0947(3): authenticated pudo leer public.% bajo los grants de la 0947', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  -- Ni escribir en app_user (el UPDATE de mi-perfil va por service_role).
  begin
    update public.app_user set nombre = 'x' where id = '00000000-0000-4000-8000-0000000a1948';
    raise exception 'LOGIN_0947(4): authenticated pudo escribir en app_user';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. anon no lee nada.
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.app_user limit 1;
    raise exception 'LOGIN_0947(5): anon pudo leer app_user';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
