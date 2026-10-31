-- GENERADOR DE LA REVERSA EXACTA DE LA 0947. SOLO LECTURA. Correrlo JUSTO ANTES de aplicar la 0947 (misma ventana, mismo rol `postgres`):
--   psql "$URL" -X -At -f scripts/seguridad/generar_reversa_0947.sql > reversa-exacta-0947.sql
--   (o con la CLI ligada: supabase db query --linked -f scripts/seguridad/generar_reversa_0947.sql, y guardar la columna `sentencia`)
-- Vuelca los ACL REALES de anon/authenticated/PUBLIC sobre las tablas, vistas, secuencias, columnas y funciones de `public`, y los default
-- privileges de postgres/supabase_admin en `public`, y los emite como GRANT / ALTER DEFAULT PRIVILEGES. Ejecutar el archivo generado devuelve
-- el estado previo EXACTO (la reversa genérica "grant all a anon y authenticated" es PEOR que el estado previo: hoy ~118 tablas no tienen
-- acceso para ellos, ~45 solo SELECT y ~114 CRUD). Después de revertir, reaplicar la 0946 y la sección 4 de la 0923 NO hace falta si el ACL
-- guardado ya las traía (las trae: se vuelcan también los privilegios de columna); si se duda, reaplicarlas (idempotentes) y correr capa0 bloque E.
-- Pruebas del repo: scripts/ci/grants_previos_0947_guardar.sql guarda lo mismo en una tabla para el CI efímero.
with a as (
  select 1 as orden, c.relname::text as k1, 'grant ' || x.privilege_type || ' on ' ||
         case when c.relkind = 'S' then 'sequence ' else 'table ' end || format('public.%I', c.relname) || ' to ' ||
         case when x.grantee = 0 then 'public' else quote_ident(x.grantee::regrole::text) end ||
         case when x.is_grantable then ' with grant option' else '' end || ';' as sentencia, x.privilege_type as k2, x.grantee::text as k3
    from pg_class c cross join lateral aclexplode(c.relacl) x
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f','S')
     and (x.grantee = 0 or x.grantee in ('anon'::regrole, 'authenticated'::regrole))
  union all
  select 2, c.relname::text || '.' || t.attname::text, 'grant ' || x.privilege_type || format(' (%I) on table public.%I to ', t.attname, c.relname) ||
         case when x.grantee = 0 then 'public' else quote_ident(x.grantee::regrole::text) end ||
         case when x.is_grantable then ' with grant option' else '' end || ';', x.privilege_type, x.grantee::text
    from pg_attribute t join pg_class c on c.oid = t.attrelid cross join lateral aclexplode(t.attacl) x
   where c.relnamespace = 'public'::regnamespace and not t.attisdropped and t.attacl is not null
     and (x.grantee = 0 or x.grantee in ('anon'::regrole, 'authenticated'::regrole))
  union all
  select 3, p.oid::regprocedure::text, 'grant execute on function ' || p.oid::regprocedure::text || ' to ' ||
         case when x.grantee = 0 then 'public' else quote_ident(x.grantee::regrole::text) end ||
         case when x.is_grantable then ' with grant option' else '' end || ';', x.privilege_type, x.grantee::text
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and (x.grantee = 0 or x.grantee in ('anon'::regrole, 'authenticated'::regrole))
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 4, d.defaclrole::regrole::text || d.defaclobjtype::text, format('alter default privileges for role %s in schema public grant %s on %s to %s;',
         quote_ident(d.defaclrole::regrole::text), x.privilege_type,
         case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' else 'types' end,
         quote_ident(x.grantee::regrole::text)), x.privilege_type, x.grantee::text
    from pg_default_acl d cross join lateral aclexplode(d.defaclacl) x
   where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype in ('r','S','f')
     and x.grantee in ('anon'::regrole, 'authenticated'::regrole)
)
select sentencia from (
  select 0 as orden, '-- REVERSA EXACTA de la 0947 generada el ' || now()::date || ' desde ' || current_database() || ' (solo lectura). Aplicar solo si la 0947 se revierte.' as sentencia, '' as k1, '' as k2, '' as k3
  union all select 0, 'begin;', '', '', ''
  union all select orden, sentencia, k1, k2, k3 from a
  union all select 9, 'commit;', '', '', ''
) s order by orden, k1, k2, k3;
