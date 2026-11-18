\set ON_ERROR_STOP on
-- 1012 — contratistas: registro ligero, checks, anti-duplicado, referencia suelta al contrato y grants.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

do $$
declare
  k uuid; c uuid; n int; err text; ok boolean;
begin
  -- 1. Alta mínima: activo, CFDI sin dato (null, no «vencido»).
  insert into public.bo_contratista (nombre, esquema) values ('Persona 1012', 'comision');
  select (activo and cfdi_honorarios_vigente is null) into ok from public.bo_contratista where nombre = 'Persona 1012';
  if ok is not true then raise exception '1012(1): defaults incorrectos'; end if;

  -- 2. Checks: esquema, nombre vacío, RFC con largo o minúsculas incorrectos.
  begin insert into public.bo_contratista (nombre, esquema) values ('x', 'nomina_propia'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1012(2): esquema inventado debia lanzar'; end if; end;
  begin insert into public.bo_contratista (nombre, esquema) values ('  ', 'honorarios'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1012(2): nombre vacio debia lanzar'; end if; end;
  begin insert into public.bo_contratista (nombre, esquema, rfc) values ('y', 'honorarios', 'ABC123'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1012(2): RFC corto debia lanzar'; end if; end;
  begin insert into public.bo_contratista (nombre, esquema, rfc) values ('z', 'honorarios', 'xaxx010101000'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1012(2): RFC en minusculas debia lanzar'; end if; end;
  insert into public.bo_contratista (nombre, esquema, rfc) values ('Persona RFC 1012', 'honorarios', 'XAXX010101000');

  -- 3. Anti-duplicado entre activos; desactivar libera el nombre.
  begin insert into public.bo_contratista (nombre, esquema) values (' persona 1012 ', 'comision'); raise exception 'no lanzo';
  exception when unique_violation then null; end;
  update public.bo_contratista set activo = false where nombre = 'Persona 1012';
  insert into public.bo_contratista (nombre, esquema) values ('Persona 1012', 'comision');

  -- 4. El contrato ligado es una referencia suelta: borrar el contrato (como dueño de la tabla) deja al contratista con contrato null.
  insert into public.bo_contrato (tipo, contraparte) values ('vendedor', 'Contrato 1012') returning id into c;
  insert into public.bo_contratista (nombre, esquema, contrato_id) values ('Persona con contrato 1012', 'honorarios', c) returning id into k;
  delete from public.bo_contrato where id = c;
  select (contrato_id is null) into ok from public.bo_contratista where id = k;
  if ok is not true then raise exception '1012(4): el contrato borrado debia dejar contrato_id en null'; end if;

  -- 5. RLS activa, sin privilegios de aplicación y sin borrado para service_role.
  select count(*) into n from pg_class where oid = 'public.bo_contratista'::regclass and relrowsecurity;
  if n <> 1 then raise exception '1012(5): bo_contratista debe tener RLS'; end if;
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'bo_contratista' and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n <> 0 then raise exception '1012(5): anon/authenticated/public no deben tener privilegios (hay %)', n; end if;
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'bo_contratista' and grantee = 'service_role' and privilege_type in ('DELETE', 'TRUNCATE');
  if n <> 0 then raise exception '1012(5): service_role no debe poder borrar contratistas'; end if;
  begin
    set local role authenticated;
    perform count(*) from public.bo_contratista;
    reset role;
    raise exception 'authenticated pudo leer';
  exception when insufficient_privilege then reset role;
  end;
end $$;

rollback;
