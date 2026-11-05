-- REVERSA (sin pérdida de datos de negocio; solo quita la marca): drop trigger if exists tenant_interno_solo_servidor on public.tenant; drop function if exists public.tenant_interno_solo_servidor(); drop index if exists public.tenant_unico_interno; alter table public.tenant drop column if exists interno;
-- Aplicación doble: segura (add column if not exists, create index if not exists, create or replace, drop trigger if exists).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0970 — MX-004: de qué tenant sale el presupuesto de IA del superadmin global.
--
-- «Mensaje IA» del Cerebro de prospectos llama al modelo con el presupuesto de UN tenant (el ledger de gasto es por flota). El
-- superadmin real tiene `app_user.tenant_id` NULL por diseño, así que la ruta respondía 503 siempre (salvo con flota elegida).
-- La decisión recomendada en el plan (fila 89 de TAREAS-JAVIER) es el TENANT INTERNO de Likida con su techo de IA propio. Esta
-- migración solo pone la MARCA que lo identifica; NO crea ni toca ninguna fila de tenant: cuál flota es la interna lo decide y
-- lo marca Javier (UPDATE tenant SET interno = true WHERE id = ...), porque el gasto de IA del equipo no puede caer en la flota de
-- un cliente por un adivino de código.
--
--  · `tenant.interno` (boolean, default false): a lo más UN tenant lo tiene (índice único parcial).
--  · Solo el servidor (service_role / postgres) la escribe: un disparador rechaza (42501) que `anon`/`authenticated` cambien la
--    marca, para que una flota no pueda declararse «interna» y desviar el presupuesto del superadmin. La columna no entra al
--    SELECT de `authenticated` (0946: grants por columna, sin recalcular aquí).
--  · Sin tenant marcado, la ruta responde 503 con el motivo exacto (falla cerrado; no hay presupuesto global implícito).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

alter table public.tenant add column if not exists interno boolean not null default false;

comment on column public.tenant.interno is
  '0970 (MX-004): TRUE en el único tenant interno de Likida; de ahí sale el presupuesto de IA del superadmin global (sin flota elegida). Lo marca Javier a mano; solo el servidor lo escribe.';

create unique index if not exists tenant_unico_interno on public.tenant ((interno)) where interno;

create or replace function public.tenant_interno_solo_servidor() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and new.interno then
      raise exception 'tenant.interno solo lo escribe el servidor' using errcode = '42501';
    elsif tg_op = 'UPDATE' and new.interno is distinct from old.interno then
      raise exception 'tenant.interno solo lo escribe el servidor' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tenant_interno_solo_servidor() from public, anon, authenticated;

drop trigger if exists tenant_interno_solo_servidor on public.tenant;
create trigger tenant_interno_solo_servidor
  before insert or update on public.tenant
  for each row execute function public.tenant_interno_solo_servidor();

commit;
