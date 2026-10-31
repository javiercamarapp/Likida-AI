-- 0946/0947/0948 (Ola 1 seguridad, carril A1): contra Postgres real, DESPUÉS de restituir los grants previos a la 0947 (solo base efímera).
--   (a) authenticated y anon NO leen tenant.buzon_token pero sí el resto de tenant (0946; los grants previos conservan la columna);
--   (b) un SELECT real de buzon_token con el rol authenticated da 42501, y el service_role lo lee;
--   (c) (default ACL y tabla nueva: los prueba capa0_grants_tablas.sql bloque C, que corre antes de restituir los grants previos);
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
    raise exception '0946(a3): authenticated perdió la lectura del resto de tenant (0946)';
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

-- (el cierre por tabla se prueba en capa0_grants_tablas.sql, que corre ANTES de restituir los grants previos; aquí ya están restituidos)

rollback;
