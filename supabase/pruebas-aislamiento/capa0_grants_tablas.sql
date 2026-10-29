-- ═══════════════════════════════════════════════════════════════════════════
-- CAPA 0 · PRIVILEGIOS DE TABLA PARA anon / authenticated — AUTO-DESCUBRIENTE.
--
-- RLS (capa 1) es la segunda barrera; esta es la primera: ni anon ni authenticated deben tener privilegio alguno sobre las tablas de
-- `public` salvo una lista blanca explícita (hoy: SELECT de authenticated sobre app_user, la única lectura del producto con JWT de usuario).
-- Corre en ci-postgres JUSTO DESPUÉS de las migraciones y ANTES de `scripts/ci/e2e/grants-locales.sql` (que restituye el grant legado SOLO
-- en la base efímera para que la batería siga probando RLS como capa independiente).
-- Mismo formato que capa1: cada bloque termina con un `raise exception` cuyo mensaje trae `(esperado …)`; lo califica
-- `scripts/ci/correr-verificaciones.mjs`.
--
-- En producción (solo lectura): `supabase db query --linked -f supabase/pruebas-aislamiento/capa0_grants_tablas.sql` — cada bloque debe
-- terminar en el mensaje con valores 0 / false (el `raise exception` es a propósito).
-- ═══════════════════════════════════════════════════════════════════════════

-- A. Ni anon ni authenticated tienen privilegio alguno (ni de columna) sobre tablas/vistas de public, salvo la lista blanca.
do $$
declare lista text; n int;
begin
  select coalesce(string_agg(format('%s.%s:%s', c.relname, r.rol, p.priv), ', ' order by c.relname, r.rol, p.priv), '—'), count(*)
    into lista, n
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated')) r(rol)
   cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
   where ns.nspname = 'public'
     and c.relkind in ('r','p','v','m','f')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
     and (has_table_privilege(r.rol, c.oid, p.priv)
          or (p.priv in ('SELECT','INSERT','UPDATE','REFERENCES') and has_any_column_privilege(r.rol, c.oid, p.priv)))
     and not (c.relname = 'app_user' and r.rol = 'authenticated' and p.priv = 'SELECT');  -- LISTA BLANCA: añadir aquí con comentario y prueba
  if n > 0 then raise notice 'privilegios de tabla abiertos: %', lista; end if;
  raise exception E'GRANTS_TABLA  abiertos=%   (esperado 0)', n;
end $$;

-- B. Secuencias sin acceso para anon/authenticated.
do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'S'
     and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('authenticated', c.oid, 'USAGE')
          or has_sequence_privilege('anon', c.oid, 'SELECT') or has_sequence_privilege('authenticated', c.oid, 'SELECT')
          or has_sequence_privilege('anon', c.oid, 'UPDATE') or has_sequence_privilege('authenticated', c.oid, 'UPDATE'));
  raise exception E'GRANTS_SECUENCIA  abiertas=%   (esperado 0)', n;
end $$;

-- C. Las FUTURAS no heredan nada: ni default ACL (tablas, secuencias, funciones) ni, en vivo, una tabla recién creada
--    (la excepción final deshace el create). `hereda` mira cualquier privilegio, no solo SELECT.
do $$
declare acl int; hereda boolean;
begin
  select count(*) into acl
    from pg_default_acl d join pg_namespace ns on ns.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
   where ns.nspname = 'public' and d.defaclobjtype in ('r','S','f')
     and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid);
  create table public._guarda_grants_nueva (id int);
  hereda := has_table_privilege('anon', 'public._guarda_grants_nueva', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('authenticated', 'public._guarda_grants_nueva', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege('anon', 'public._guarda_grants_nueva', 'SELECT')
         or has_any_column_privilege('authenticated', 'public._guarda_grants_nueva', 'SELECT');
  raise exception E'GRANTS_DEFAULT  default-acl-abiertas=%  tabla-nueva-hereda=%   (esperado 0 / false)', acl, hereda;
end $$;

-- D. Storage: ningún bucket público salvo `avatares` y ninguna política sobre storage.objects (cero consumidores con JWT de usuario).
do $$
declare publicos int; politicas int;
begin
  select count(*) into publicos from storage.buckets where public and id <> 'avatares';
  select count(*) into politicas from pg_policies where schemaname = 'storage' and tablename = 'objects';
  raise exception E'STORAGE  buckets-publicos-distintos-de-avatares=%  politicas-storage-objects=%   (esperado 0 / 0)', publicos, politicas;
end $$;

-- E. Credenciales en columnas: authenticated no lee tenant.buzon_token (SEG-3-01) ni las columnas cifradas de 0923 §4.
do $$
declare t boolean; c boolean; r boolean;
begin
  t := has_column_privilege('authenticated', 'public.tenant', 'buzon_token', 'select') or has_column_privilege('anon', 'public.tenant', 'buzon_token', 'select');
  c := has_column_privilege('authenticated', 'public.conector_credencial', 'valores_cifrados', 'select');
  r := has_column_privilege('authenticated', 'public.rastreo_credencial', 'token_cifrado', 'select');
  raise exception E'COLUMNAS_SECRETAS  buzon_token=%  valores_cifrados=%  token_cifrado=%   (esperado false / false / false)', t, c, r;
end $$;

-- F. Funciones SECURITY DEFINER de public: ni PUBLIC ni anon ni authenticated pueden ejecutarlas, salvo las que usa una política RLS o los
--    ayudantes de RLS concedidos a propósito (misma regla que 0947 §3).
do $$
declare n int; lista text;
begin
  select count(*), coalesce(string_agg(p.oid::regprocedure::text, ', '), '—') into n, lista
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosecdef
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and not exists (select 1 from pg_depend d where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass and d.refobjid = p.oid)
     and p.proname <> all (array['get_user_tenant_ids','is_superadmin','administra_flota','ve_finanzas','ve_operacion','ve_atencion_cliente','es_dueno_flota'])
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if n > 0 then raise notice 'DEFINER ejecutables: %', lista; end if;
  raise exception E'DEFINER_EJECUTABLES  abiertas=%   (esperado 0)', n;
end $$;
