-- ═══════════════════════════════════════════════════════════════════════════
-- 0294 · BAJA DE USUARIOS (app_user.activo) Y CADUCIDAD DE LLAVES DE API
--
-- AUDITORÍA 24 — SEG-1 (ALTO) + H5 (frontend §SISTEMA) + SEG-8 (BAJO).
--
-- ── EL HUECO ───────────────────────────────────────────────────────────────
-- `app_user` nació sin columna de estado (0001:15-21). Dar de baja a alguien
-- era BORRAR la fila — y nadie lo hacía: el contador externo que dejó de
-- trabajar con la flota conservaba su cookie (400 días) y cada hora el proxy
-- le refrescaba el JWT en silencio. Seguía descargando CFDI y liquidaciones
-- semanas después de que la flota cambió de despacho. Los términos
-- (`terminos/page.tsx`) le cargan a la empresa «dar de baja a quien deja de
-- trabajar ahí», y el producto no le daba con qué.
--
-- ── EL CIERRE, EN DOS CAPAS ────────────────────────────────────────────────
--  1. `app_user.activo` (default true) + `desactivado_en`/`desactivado_por`.
--     NO se borra la fila: la bitácora, `creada_por` de las llaves y las
--     FKs `on delete set null` del repo necesitan que la persona siga
--     existiendo como rastro. Reactivar es volver a poner `activo = true`.
--  2. Las CUATRO funciones de RLS (`get_user_tenant_ids`, `is_superadmin`,
--     `ve_finanzas`, `administra_flota`) filtran `and activo`. Con eso la
--     BASE cierra sola: aunque la capa de app tuviera un hueco, un usuario
--     desactivado con un JWT todavía vigente obtiene cero filas de `viaje`,
--     `gasto`, `liquidacion` y todo lo que cuelga de `tenant_data`.
--     La capa de app (`session.ts`) devuelve `null` para `activo = false` y
--     el server action de baja además BANEA la cuenta en Supabase Auth
--     (`updateUserById({ ban_duration })`), que es lo que mata el refresh del
--     token: la cookie muere en la siguiente hora.
--
-- Se REDEFINEN los cuerpos (no basta `alter function … set`) porque cambia
-- la lógica. Se conserva exactamente la última forma: `security definer`,
-- `stable`, `set search_path = public, pg_temp` (0074/0158).
--
-- ── SEG-8: `tenant_api_key.expira_en` ──────────────────────────────────────
-- Una llave filtrada en el repo del TMS del cliente servía para siempre.
-- Columna opcional (null = no caduca, decisión explícita de quien la emite);
-- el camino caliente (`resolverLlave`) rechaza una llave vencida con el mismo
-- 401 que una revocada. El CHECK impide emitir una llave ya muerta al nacer.
--
-- Verificado por los bloques 241 (activo cierra RLS) y 242 (expira_en) de
-- supabase/verificaciones.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Estado de la cuenta ─────────────────────────────────────────────────
alter table public.app_user add column if not exists activo boolean not null default true;
alter table public.app_user add column if not exists desactivado_en timestamptz;
alter table public.app_user add column if not exists desactivado_por uuid references public.app_user(id) on delete set null;

comment on column public.app_user.activo is
  'false = dado de baja desde el panel (SEG-1, 0294). La fila se conserva como rastro; las funciones de RLS filtran por esta columna y session.ts devuelve null.';
comment on column public.app_user.desactivado_en is
  'Cuándo se dio de baja (null mientras activo). Reactivar la limpia.';
comment on column public.app_user.desactivado_por is
  'Quién la dio de baja (app_user.id del actor), o null si fue reactivada. on delete set null: el rastro sobrevive al actor.';

-- Coherencia: desactivado_en va con activo=false y viceversa.
alter table public.app_user drop constraint if exists app_user_activo_coherente;
alter table public.app_user add constraint app_user_activo_coherente
  check ((activo and desactivado_en is null) or (not activo and desactivado_en is not null));

-- ── 2. Las cuatro funciones de RLS filtran por activo ──────────────────────
create or replace function public.get_user_tenant_ids()
returns uuid[] language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce(array_agg(tenant_id) filter (where tenant_id is not null), array[]::uuid[])
  from public.app_user where id = auth.uid() and activo;
$$;

create or replace function public.is_superadmin()
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_user where id = auth.uid() and rol = 'superadmin' and activo);
$$;

create or replace function public.ve_finanzas()
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.app_user
    where id = auth.uid()
      and rol in ('superadmin', 'flota_admin', 'contador')
      and activo
  );
$$;

create or replace function public.administra_flota()
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.app_user
    where id = auth.uid() and rol in ('superadmin', 'flota_admin') and activo
  );
$$;

-- Los grants de 0054/0126 se conservan (create or replace no los toca), pero
-- se reafirman por si esta migración corre sobre una base donde alguien los
-- movió: sin ellos, RLS niega TODO a authenticated.
revoke execute on function public.get_user_tenant_ids() from anon, public;
revoke execute on function public.is_superadmin() from anon, public;
revoke execute on function public.ve_finanzas() from anon, public;
revoke execute on function public.administra_flota() from anon, public;
grant execute on function public.get_user_tenant_ids() to authenticated, service_role;
grant execute on function public.is_superadmin() to authenticated, service_role;
grant execute on function public.ve_finanzas() to authenticated, service_role;
grant execute on function public.administra_flota() to authenticated, service_role;

-- ── 3. Caducidad opcional de llaves de API (SEG-8) ─────────────────────────
alter table public.tenant_api_key add column if not exists expira_en timestamptz;

comment on column public.tenant_api_key.expira_en is
  'Cuándo deja de valer (SEG-8, 0294). null = no caduca (decisión explícita al emitir). resolverLlave la rechaza vencida con el mismo 401 que una revocada.';

alter table public.tenant_api_key drop constraint if exists tenant_api_key_expira_despues_de_crear;
alter table public.tenant_api_key add constraint tenant_api_key_expira_despues_de_crear
  check (expira_en is null or expira_en > creada_en);
