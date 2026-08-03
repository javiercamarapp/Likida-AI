-- ═══════════════════════════════════════════════════════════════════════════
-- 0045 — RLS real para el chofer, ANTES de que exista login de chofer.
--
-- `tenant_data` (0001) da lectura+escritura completa sobre viaje/gasto/
-- liquidacion a CUALQUIER app_user del tenant, sin mirar el rol. Correcto
-- para flota_admin/encargado/contador — los tres viven del mismo panel,
-- mismos datos. Repetirlo para `operador` sería un IDOR: un chofer con
-- sesión vería los viajes de TODA la flota, no solo los suyos, y la UI de
-- /mis-viajes (Task 5) sería el único candado — el que un token robado se
-- salta sin pasar por el navegador.
--
-- Se liga `app_user.operador_id` al `operador` (tabla del WhatsApp, ya
-- existía) y se excluye a `operador` de `tenant_data` en las tres tablas
-- que le importan (viaje, gasto, liquidacion), reemplazándolo por una
-- policy de SOLO LECTURA scoped a su propio operador_id. Las otras 4 tablas
-- de `tenant_data` (terminal, politica_gasto, wa_conversacion — y
-- `operador` misma) no cambian: el chofer no tiene vista de esas.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.app_user
  add column if not exists operador_id uuid references public.operador(id) on delete set null;

comment on column public.app_user.operador_id is
  'Solo se llena cuando rol = ''operador'': liga la cuenta web del chofer con su fila en operador (identidad de WhatsApp). NULL para los otros 4 roles.';

create or replace function public.is_operador()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from app_user where id = auth.uid() and rol = 'operador');
$$;

create or replace function public.get_user_operador_id()
returns uuid language sql security definer stable set search_path = public as $$
  select operador_id from app_user where id = auth.uid() and rol = 'operador';
$$;

do $$
declare t text;
begin
  foreach t in array array['viaje', 'gasto', 'liquidacion']
  loop
    execute format('drop policy if exists tenant_data on %I', t);
    execute format($p$
      create policy tenant_data on %I for all
      using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
      with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
    $p$, t);
  end loop;
end $$;

-- Views, no "for all": el chofer no escribe nada desde la web — su única
-- vía de escritura sigue siendo WhatsApp (que usa el service-role, no RLS).
create policy operador_ve_su_viaje on public.viaje for select
  using (operador_id = get_user_operador_id());

create policy operador_ve_sus_gastos on public.gasto for select
  using (viaje_id in (select id from public.viaje where operador_id = get_user_operador_id()));

create policy operador_ve_sus_liquidaciones on public.liquidacion for select
  using (viaje_id in (select id from public.viaje where operador_id = get_user_operador_id()));

comment on policy tenant_data on public.viaje is
  'Excluye rol=operador a propósito (0045): su acceso vive en operador_ve_su_viaje, de solo lectura y scoped a su propio operador_id.';
