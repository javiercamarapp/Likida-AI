-- ═══════════════════════════════════════════════════════════════════════════
-- 0805 — Línea base de la flota: «cuánto tardaba cada proceso ANTES» (insights de los 5 agentes).
--
-- Sin la medida de hoy no hay porcentaje de ahorro defendible: la tarjeta de ahorro dice «pendiente: falta la medida de hoy»
-- y nunca inventa un número (`ahorroSeguro` en src/lib/likida/insights/linea_base.ts). Esta tabla guarda SOLO lo que la flota
-- capturó a mano: el proceso, los minutos por unidad (p. ej. por desglose, por viaje), la unidad, de dónde sale el dato y quién
-- lo capturó. No guarda sueldos, precios ni dinero: el ahorro se expresa en minutos.
--
--   · una fila por (flota, proceso): recapturar actualiza la medida (el servidor hace upsert);
--   · `minutos_por_unidad` > 0 y `unidad`, `proceso` y `fuente` no vacíos: sin fuente no hay número;
--   · RLS por `administra_flota()` (como 0094): es dato de control de la flota, no de operación;
--   · lo escribe el servidor (service_role) o el administrador de la flota por su política.
--
-- REVERSA (manual, solo si nadie capturó nada que haya que conservar):
--   drop table if exists public.insight_linea_base;
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.insight_linea_base (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  proceso text not null,
  minutos_por_unidad numeric not null,
  unidad text not null,
  fuente text not null,
  capturada_en timestamptz not null default now(),
  capturada_por uuid references public.app_user(id) on delete set null,
  constraint insight_linea_base_minutos_positivos check (minutos_por_unidad > 0),
  constraint insight_linea_base_proceso_no_vacio check (length(btrim(proceso)) > 0),
  constraint insight_linea_base_unidad_no_vacia check (length(btrim(unidad)) > 0),
  constraint insight_linea_base_fuente_no_vacia check (length(btrim(fuente)) > 0)
);
comment on table public.insight_linea_base is
  '0805: línea base capturada por la flota (minutos por unidad de cada proceso, antes de los agentes). Sin ella no se muestra % de ahorro. Sin dinero, sueldos ni datos de personas.';
create unique index if not exists insight_linea_base_unica
  on public.insight_linea_base (tenant_id, proceso);

alter table public.insight_linea_base enable row level security;
drop policy if exists administra_flota on public.insight_linea_base;
create policy administra_flota on public.insight_linea_base for all
  using ((tenant_id = any(public.get_user_tenant_ids()) and public.administra_flota()) or public.is_superadmin())
  with check ((tenant_id = any(public.get_user_tenant_ids()) and public.administra_flota()) or public.is_superadmin());
revoke all on table public.insight_linea_base from public, anon, authenticated;
grant select, insert, update, delete on table public.insight_linea_base to authenticated;
grant select, insert, update, delete on table public.insight_linea_base to service_role;
