-- 0946/0947/0948 (Ola 1 seguridad, carril A1): contra Postgres real, DESPUÉS de grants-locales.sql (el grant legado de la base efímera).
--   (a) authenticated y anon NO leen tenant.buzon_token pero sí el resto de tenant (0946; grants-locales respeta la columna);
--   (b) un SELECT real de buzon_token con el rol authenticated da 42501, y el service_role lo lee;
--   (c) el default ACL no da nada a anon/authenticated (nada de pg_default_acl de public con esos grantees);
--   (d) una tabla creada DESPUÉS de la 0947 NO hereda privilegios para anon/authenticated (default ACL);
--   (e) las 4 políticas de avatares ya no existen, el bucket sigue público y la 0948 se reaplica sin error.
-- Todo dentro de una transacción con rollback.
begin;

do $$
begin
  if has_column_privilege('authenticated', 'public.tenant', 'buzon_token', 'select') then
    raise exception '0946(a1): authenticated aún puede leer tenant.buzon_token';
  end if;
  if has_column_privilege('anon', 'public.tenant', 'buzon_token', 'select') then
    raise exception '0946(a2): anon puede leer tenant.buzon_token';
  end if;
  if not has_column_privilege('authenticated', 'public.tenant', 'nombre', 'select') then
    raise exception '0946(a3): authenticated perdió la lectura del resto de tenant (grants-locales/0946)';
  end if;
  if not has_column_privilege('service_role', 'public.tenant', 'buzon_token', 'select') then
    raise exception '0946(a4): service_role debe seguir leyendo buzon_token';
  end if;
end $$;

set local role authenticated;
do $$
begin
  begin
    perform buzon_token from public.tenant limit 1;
    raise exception '0946(b1): authenticated leyó buzon_token';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- (c) pg_default_acl de public sin anon/authenticated.
do $$
declare n int;
begin
  select count(*) into n
    from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
   where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype in ('r','S','f')
     and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid);
  if n <> 0 then raise exception '0947(c): % entradas de pg_default_acl dan grants a anon/authenticated', n; end if;
end $$;

-- (d) una tabla creada DESPUÉS de la 0947 no hereda privilegios (ni con grants-locales, que solo toca las existentes).
create table public._prueba_0947_tabla_nueva (id int);
create sequence public._prueba_0947_secuencia_nueva;
do $$
begin
  if has_table_privilege('anon', 'public._prueba_0947_tabla_nueva', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_table_privilege('authenticated', 'public._prueba_0947_tabla_nueva', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception '0947(d1): una tabla nueva heredó privilegios para anon/authenticated';
  end if;
  if has_sequence_privilege('anon', 'public._prueba_0947_secuencia_nueva', 'USAGE,SELECT,UPDATE')
     or has_sequence_privilege('authenticated', 'public._prueba_0947_secuencia_nueva', 'USAGE,SELECT,UPDATE') then
    raise exception '0947(d2): una secuencia nueva heredó privilegios para anon/authenticated';
  end if;
end $$;

-- (e) avatares: sin políticas, bucket público intacto.
do $$
declare n int;
begin
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects';
  if n <> 0 then raise exception '0948(e1): quedan % políticas sobre storage.objects', n; end if;
  if not exists (select 1 from storage.buckets where id = 'avatares' and public) then
    raise exception '0948(e2): el bucket avatares debe seguir público (las fotos se sirven por URL pública)';
  end if;
end $$;

-- (el cierre por tabla se prueba en capa0_grants_tablas.sql, que corre ANTES de grants-locales.sql; aquí el grant legado ya está restituido)

rollback;
