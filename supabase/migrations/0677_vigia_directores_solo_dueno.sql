-- ═══════════════════════════════════════════════════════════════════════════
-- 0677 — Vigía: correctiva de la ronda 17 sobre 0673/0674 (privacidad de la lista de directores y de los correos de respaldo).
--
-- NO se editan 0673 ni 0674 (ya aplicadas): esta migración las corrige hacia adelante.
--
-- LA FUGA. La política `tenant_lee` de `vigia_director` (0673) y de `vigia_aviso_correo` (0674) usaba `ve_atencion_cliente()`,
-- que incluye al rol `encargado`. La pantalla del Vigía ya enmascara esos datos para quien no es dueño (últimos 4 dígitos del
-- WhatsApp y un chip «Correo»; solo el dueño ve y edita los valores completos), pero con su JWT el `encargado` podía pedirle a
-- PostgREST las filas COMPLETAS: teléfonos y correos de los directores y el `destino` de cada correo de respaldo.
--
-- LA CORRECCIÓN, en la base y a la medida de la pantalla: esas dos tablas solo las lee el DUEÑO de la flota (`flota_admin`) y el
-- superadmin. La app las lee con service_role (acotadas por tenant), así que no cambia nada para ella; el `encargado` y el
-- contador ya no ven nada por PostgREST, y nadie escribe (solo las RPC de service_role, como hasta ahora).
--
-- `es_dueno_flota()`: mismo molde que `ve_atencion_cliente()` (security definer, search_path fijo, sin execute para anon).
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.es_dueno_flota()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_user
    where id = auth.uid()
      and rol in ('superadmin', 'flota_admin')
  );
$$;
revoke execute on function public.es_dueno_flota() from anon, public;
grant execute on function public.es_dueno_flota() to authenticated, service_role;
comment on function public.es_dueno_flota is
  '0677: TRUE si el usuario es dueño de flota (flota_admin) o superadmin. El encargado y el contador, no: no leen los datos de contacto de los directores.';

drop policy if exists tenant_lee on public.vigia_director;
create policy tenant_lee on public.vigia_director for select
  using ((tenant_id = any(get_user_tenant_ids()) and es_dueno_flota()) or is_superadmin());

drop policy if exists tenant_lee on public.vigia_aviso_correo;
create policy tenant_lee on public.vigia_aviso_correo for select
  using ((tenant_id = any(get_user_tenant_ids()) and es_dueno_flota()) or is_superadmin());
