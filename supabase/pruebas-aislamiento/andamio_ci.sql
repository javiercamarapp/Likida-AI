-- ═══════════════════════════════════════════════════════════════════════════
-- ANDAMIO DE CI — lo mínimo para que un Postgres 16 vacío (el contenedor
-- efímero de GitHub Actions) acepte las 108+ migraciones de Likida SIN tocar
-- el proyecto real de Supabase.
--
-- POR QUÉ EXISTE: `supabase/migrations/*.sql` da por hecho un proyecto de
-- Supabase — roles `anon`/`authenticated`/`service_role`, el esquema `auth`
-- con `auth.uid()`, el esquema `storage` con sus buckets — y un Postgres
-- limpio no trae nada de eso. Este archivo lo construye, y SOLO eso: no
-- reemplaza a Supabase, imita la parte de su arnés que las migraciones tocan
-- de verdad. Se aplica ANTES de la primera migración.
--
-- QUÉ SE VERIFICÓ ANTES DE ESCRIBIRLO (grep sobre las 108 migraciones):
--   · `gen_random_uuid()` — 23 migraciones. Requiere la extensión `pgcrypto`,
--     y la 0001 ya trae `create extension if not exists "pgcrypto"`: este
--     archivo no la duplica, solo confirma que el rol que aplica las
--     migraciones puede crearla (aquí `postgres`, superusuario del
--     contenedor — más permisivo que el `postgres` real de Supabase, que
--     solo puede crear las extensiones de su lista blanca; pgcrypto está en
--     esa lista, así que el comportamiento es fiel).
--   · `auth.uid()` — 9 migraciones (0001, 0045, 0046, 0048, 0050, 0052, 0079,
--     0086). Ninguna usa `auth.users` como FK real (`app_user.id` es un uuid
--     suelto, el comentario "= auth.users.id" es solo documentación) — así
--     que NO hace falta reproducir la tabla `auth.users`, solo la función.
--   · Roles `anon` / `authenticated` / `service_role` — 33 migraciones traen
--     GRANT/REVOKE contra ellos. Sin que el rol exista, esas migraciones
--     fallan con "role does not exist" antes de llegar a nada interesante.
--   · `storage.buckets` / `storage.objects` / `storage.foldername()` — 3
--     migraciones (0008, 0039, 0046).
--
-- LO QUE NO SE REPRODUCE, A PROPÓSITO (ver el reporte de la tanda para el
-- detalle completo — aquí solo el porqué):
--   · El resto del esquema `auth` de Supabase (tabla `auth.users`, triggers,
--     `auth.jwt()` completo, MFA, sesiones) — no hace falta ninguna pieza más
--     para que las migraciones apliquen ni para la batería de aislamiento.
--   · El esquema `storage` real (extensión `storage-api`, triggers de
--     tamaño/mimetype, `storage.get_size_by_bucket()`, subida real de
--     archivos) — solo las DOS tablas y la UNA función que las migraciones
--     tocan. La política de `avatares` (0046) se aplica sin error, pero la
--     batería de aislamiento NO la ataca: es una regla por-USUARIO
--     (`auth.uid()` contra la carpeta), no por-TENANT, y el encargo de esta
--     ronda es aislamiento entre flotas.
--   · PostgREST en sí (el servidor que traduce HTTP a SQL con el rol y el
--     JWT del que pide). No se necesita: la batería simula lo que PostgREST
--     hace en cada request —`SET LOCAL ROLE` + `SET LOCAL request.jwt.claims`
--     dentro de una transacción— que es la pieza que de verdad protege datos.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Los tres roles que las migraciones esperan encontrar ────────────────
-- NOLOGIN: nadie se conecta directamente como ellos, ni aquí ni en Supabase
-- real — PostgREST hace `SET ROLE` desde `authenticator`. Aquí nos ahorramos
-- ese cuarto rol: nos conectamos como `postgres` (superusuario) y saltamos
-- directo a `SET LOCAL ROLE` en la batería, que es el único tramo que importa
-- probar.
--
-- `service_role` con BYPASSRLS: así lo documenta Supabase — el rol de
-- servicio salta RLS por diseño, y varias migraciones (0062, 0064) lo dan por
-- hecho en sus propios comentarios ("la app llama con service_role, que ya
-- salta RLS"). No se pudo confirmar contra un proyecto real en esta ronda
-- (sin acceso de superusuario a Supabase Cloud); se tomó de la documentación
-- pública. Si alguna vez resulta ser inexacto, el efecto es quedarse CORTO en
-- fidelidad para `service_role` — no afecta a la batería, que ataca con
-- `authenticated`, no con `service_role`.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- ── 2. Los permisos de tabla que Supabase concede por defecto ──────────────
-- CRÍTICO PARA QUE LA BATERÍA SIGNIFIQUE ALGO: en un proyecto Supabase real,
-- toda tabla nueva en `public` nace con SELECT/INSERT/UPDATE/DELETE ya
-- concedidos a `anon`/`authenticated`/`service_role` — la barrera de verdad
-- es RLS, no el GRANT de tabla. Es el arreglo que hace Supabase con
-- `ALTER DEFAULT PRIVILEGES` al aprovisionar el proyecto (documentado en su
-- imagen de Postgres). Sin este bloque, TODA tabla le devolvería "permission
-- denied for relation X" a `authenticated` desde el primer intento —y la
-- batería completa pasaría en verde sin que RLS hiciera ni un solo filtro—.
-- Eso sería el falso positivo más caro posible: "está aislado" cuando lo
-- único que se probó fue que faltaba un GRANT.
--
-- Se aplica ANTES de las migraciones porque `alter default privileges` solo
-- afecta a objetos que el MISMO rol (`postgres`) cree DESPUÉS de este punto
-- — y las 108 migraciones corren, todas, como `postgres`.
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- Las funciones NO necesitan una regla aquí: Postgres concede EXECUTE a
-- PUBLIC en toda función nueva por default (comportamiento nativo, no de
-- Supabase) — y es justo el mecanismo del que dependen los propios
-- comentarios de las migraciones (0012, 0031, 0054, 0062) para explicar por
-- qué hace falta un REVOKE explícito. Agregar una regla redundante aquí
-- escondería ese mecanismo real en vez de dejarlo actuar.

-- ── 3. `auth.uid()` — la pieza que evalúan las políticas RLS ────────────────
-- Implementación tomada tal cual de la real de Supabase (es pública en su
-- repo `supabase/auth-schema`): lee el GUC `request.jwt.claims` (el JSON
-- completo que arma PostgREST) o, si está, el GUC aplanado
-- `request.jwt.claim.sub`. La batería usa `SET LOCAL request.jwt.claims`,
-- que es la forma real en que PostgREST pasa el JWT en cada request.
create schema if not exists auth;

-- ESCALA 50k (22-ago-2026): un proyecto de Supabase trae el esquema
-- `extensions`, donde vive todo lo que no debe ensuciar `public` (el propio
-- linter de Supabase lo marca: «Extension in Public»). La 0154 instala ahí
-- `pg_trgm` para la búsqueda del Registro de Viajes, así que sin este esquema
-- la migración falla en un Postgres vacío — el CI se cae en una diferencia
-- del ANDAMIO, no del código, que es justo el ruido que este archivo existe
-- para evitar.
create schema if not exists extensions;

-- USAGE en el esquema, no solo EXECUTE en la función: sin esto Postgres
-- rechaza `select auth.uid()` con "permission denied for schema auth" ANTES
-- de llegar a evaluar la función — se comprobó en vivo contra el contenedor
-- (la función ya tenía EXECUTE por el default de PUBLIC, y aun así fallaba
-- por el esquema). Supabase real concede esto mismo: las políticas RLS
-- necesitan poder resolver `auth.uid()` desde `anon`/`authenticated`.
grant usage on schema auth to anon, authenticated, service_role;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

-- `auth.role()` no lo usa ninguna migración (solo `auth.uid()`, ver la
-- cabecera), pero la batería sí lo usa para confirmar que quedó DENTRO del
-- rol esperado antes de lanzar un ataque — un `SET LOCAL ROLE` que fallara en
-- silencio dejaría correr toda la batería como `postgres` (superusuario, que
-- SIEMPRE bypassea RLS) y cada prueba "pasaría" sin haber probado nada.
create or replace function auth.role() returns text
language sql stable
as $$
  select
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text
$$;

-- ── 4. `storage` — solo las dos tablas y la función que tocan migraciones ──
-- Ver la cabecera: esto NO es el esquema de storage real, es el compatible
-- mínimo para que 0008/0039/0046 apliquen. `storage.foldername` reproduce la
-- función real de Supabase (recorta el último segmento del path: todo antes
-- del último '/').
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  -- Los dos campos que Supabase Storage hace cumplir en cada subida y que la
  -- 0147 fija para `avatares` (tipo y peso). Sin ellos la migración no aplica.
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

grant select, insert, update, delete on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;

create or replace function storage.foldername(name text) returns text[]
language sql immutable
as $$
  select case
    when array_length(string_to_array(name, '/'), 1) <= 1 then array[]::text[]
    else (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
  end
$$;
