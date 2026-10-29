-- REVERSA (solo si algo no previsto lee con el JWT de usuario; reabre lo que esta migración cierra):
--   grant select, insert, update, delete on all tables in schema public to anon, authenticated;
--   grant usage, select on all sequences in schema public to anon, authenticated;
--   -- y, para NO reabrir las credenciales: reaplicar la 0946 y la sección 4 de la 0923 (idempotentes).
--   alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to anon, authenticated;
--   alter default privileges for role postgres in schema public grant usage, select on sequences to anon, authenticated;
--   alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
-- Aplicación doble: segura (todo es revoke/grant repetible; los default privileges también).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0947 — SEGURIDAD OLA 1 · A1 (B-08, SEG-6-01..04, 6-06, 6-07 parcial): ninguna tabla pública por defecto.
--
-- El producto lee con el JWT de usuario (anon key + cookie) UNA sola tabla: `public.app_user` (`src/lib/auth/session.ts:70`). Todo lo demás
-- usa `supabaseAdmin()` (service_role, que NO se toca). El resto de los clientes con la anon key solo llaman `auth.*` (signOut,
-- signInWithOtp, exchangeCodeForSession, mfa.*) o `storage.uploadToSignedUrl` con una URL que firmó el servidor. Cero `.rpc()` con el
-- cliente de usuario. Sin embargo ~164 tablas conservaban SELECT/INSERT/UPDATE/DELETE (y TRUNCATE/REFERENCES/TRIGGER) para
-- anon/authenticated: RLS era la única barrera, y toda tabla nueva nacía abierta (el bootstrap de Supabase da arwdDxtm por default ACL).
--
-- Esta migración añade la capa de privilegios que faltaba. RLS y políticas se conservan (defensa en profundidad). No cambia filas.
-- NO usa literales `revoke all on public.X` a propósito: así `restringidas-desde-migraciones.mjs` y `grants-locales.sql` no cambian.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 1. Tablas (r), particionadas (p), vistas (v), vistas materializadas (m) y foráneas (f) de `public` que no son de una extensión.
--    REVOKE ALL en la tabla retira también los privilegios de columna (p. ej. los de la 0923 §4 y la 0946: nadie los usa con JWT).
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as rel
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('revoke all on table %s from anon, authenticated', r.rel);
  end loop;
end $$;

-- 2. Secuencias: sin INSERT por REST no hace falta USAGE/SELECT.
revoke all on all sequences in schema public from anon, authenticated;

-- 3. Funciones SECURITY DEFINER: fuera PUBLIC/anon/authenticated, salvo (a) las que usa alguna política RLS (el motor de RLS las llama con
--    el rol de quien pregunta: revocarlas rompería el aislamiento) y (b) los ayudantes de RLS que el repo concedió A PROPÓSITO a authenticated (por nombre: get_user_tenant_ids, is_superadmin, administra_flota, ve_finanzas, ve_operacion, ve_atencion_cliente, es_dueno_flota).
--    Las funciones de extensiones no se tocan. En producción casi todas ya estaban revocadas (204 de 206): esto cierra el resto y
--    deja el estado verificable por capa0.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosecdef
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass and d.refobjid = p.oid)
       and p.proname <> all (array['get_user_tenant_ids','is_superadmin','administra_flota','ve_finanzas','ve_operacion','ve_atencion_cliente','es_dueno_flota'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;
end $$;

-- 4. La única lectura directa del producto con el JWT de usuario. La política app_user_self limita las filas; el UPDATE de mi-perfil
--    va por service_role.
grant select on table public.app_user to authenticated;

-- 5. Objetos FUTUROS creados por `postgres` (rol de migraciones y del editor de tablas del panel) ya no heredan nada para
--    anon/authenticated. service_role conserva su default. (El EXECUTE implícito a PUBLIC de una función nueva no lo cubre un default de
--    esquema: la regla del repo sigue siendo `revoke ... from public, anon, authenticated` en cada función; capa1 vigila las DEFINER.)
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- 6. Lo mismo para `supabase_admin` si el rol de migración puede alterarlo; en CI el rol no existe y en Supabase puede faltar permiso.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated';
exception when insufficient_privilege or undefined_object then
  raise notice '0947: no se pudo alterar default privileges de supabase_admin (%); capa0/producción lo verifican con pg_default_acl', sqlerrm;
end $$;

commit;
