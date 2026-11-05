-- 0990 — Alertas de tope de IA persistidas y deduplicadas por flota/día (CT-IA-01, F5 carril L5A).
--
-- HOY (medido en código, 4-nov-2026): `avisarTopeTenant` (src/lib/llm/budget.ts) avisa al operador SOLO cuando la flota ya chocó
-- con el 100 % del techo, y la deduplicación de "ya avisé hoy" vive en un Map POR INSTANCIA de Vercel: con N instancias calientes
-- salen N avisos, y un arranque en frío lo olvida. No existe aviso al 80 %, que es el que da tiempo de reaccionar.
--
-- ESTA MIGRACIÓN deja el estado donde corresponde, en la base:
--   · `llm_alerta_tope`: una fila por (flota, día MX, nivel 80|100). La PK ES la deduplicación: el segundo intento, desde la
--     instancia que sea, no inserta y no avisa.
--   · `registrar_alerta_tope_llm(...)`: devuelve true SOLO a quien insertó la fila (el que debe avisar). Atómica por la PK.
--   · `uso_llm_dia_por_flota(p_dia)`: el gasto del día MX por flota (reservado vivo + liquidado), el mismo criterio que
--     `reservar_presupuesto_llm`, para que el barrido compare contra el techo sin tocar el camino caliente de cada llamada.
--   · `purgar_llm_alerta_tope(p_dias)`: retención (90 días por omisión, mínimo 7).
--
-- NO toca `reservar_presupuesto_llm` ni `llm_presupuesto_reserva` (camino caliente de ~11 llamadas por viaje).
-- ADITIVA E IDEMPOTENTE. Solo service_role.
--
-- REVERSA (manual):
--   drop function if exists public.purgar_llm_alerta_tope(integer);
--   drop function if exists public.uso_llm_dia_por_flota(date);
--   drop function if exists public.registrar_alerta_tope_llm(uuid, date, smallint, numeric, numeric, text);
--   drop table if exists public.llm_alerta_tope;
begin;

create table if not exists public.llm_alerta_tope (
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  dia date not null,
  nivel smallint not null check (nivel in (80, 100)),
  uso_usd numeric not null check (uso_usd >= 0),
  tope_usd numeric not null check (tope_usd > 0),
  origen_tope text not null default 'piso' check (origen_tope in ('explicito', 'tenant', 'plan', 'piso')),
  creado_en timestamptz not null default now(),
  primary key (tenant_id, dia, nivel)
);

comment on table public.llm_alerta_tope is
  '0990 (CT-IA-01): avisos de tope diario de IA ya emitidos, una fila por flota/día MX/nivel (80 o 100). La PK deduplica entre instancias.';

alter table public.llm_alerta_tope enable row level security;
revoke all on public.llm_alerta_tope from public, anon, authenticated;
grant select, insert, delete on public.llm_alerta_tope to service_role;

create index if not exists llm_alerta_tope_dia_idx on public.llm_alerta_tope (dia);

create or replace function public.registrar_alerta_tope_llm(
  p_tenant_id uuid,
  p_dia date,
  p_nivel smallint,
  p_uso_usd numeric,
  p_tope_usd numeric,
  p_origen text default 'piso'
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  filas integer;
begin
  if p_tenant_id is null or p_dia is null then
    raise exception 'registrar_alerta_tope_llm: flota y día son obligatorios';
  end if;
  if p_nivel is null or p_nivel not in (80, 100) then
    raise exception 'registrar_alerta_tope_llm: nivel inválido: %', p_nivel;
  end if;
  if p_uso_usd is null or p_uso_usd < 0 or p_tope_usd is null or p_tope_usd <= 0 then
    raise exception 'registrar_alerta_tope_llm: montos inválidos (uso=%, tope=%)', p_uso_usd, p_tope_usd;
  end if;
  insert into public.llm_alerta_tope(tenant_id, dia, nivel, uso_usd, tope_usd, origen_tope)
  values (p_tenant_id, p_dia, p_nivel, p_uso_usd, p_tope_usd,
          case when p_origen in ('explicito', 'tenant', 'plan', 'piso') then p_origen else 'piso' end)
  on conflict (tenant_id, dia, nivel) do nothing;
  get diagnostics filas = row_count;
  return filas = 1;
end;
$$;

revoke all on function public.registrar_alerta_tope_llm(uuid, date, smallint, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.registrar_alerta_tope_llm(uuid, date, smallint, numeric, numeric, text) to service_role;

create or replace function public.uso_llm_dia_por_flota(p_dia date default null)
returns table (tenant_id uuid, usado_usd numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  dia_mx date := coalesce(p_dia, (now() at time zone 'America/Mexico_City')::date);
  desde timestamptz := dia_mx::timestamp at time zone 'America/Mexico_City';
  hasta timestamptz := (dia_mx + 1)::timestamp at time zone 'America/Mexico_City';
begin
  return query
    select r.tenant_id, sum(r.reservado_usd)::numeric
      from public.llm_presupuesto_reserva r
     where r.created_at >= desde
       and r.created_at < hasta
       and (r.estado = 'liquidado' or (r.estado = 'reservado' and r.expira_en > now()))
     group by r.tenant_id;
end;
$$;

revoke all on function public.uso_llm_dia_por_flota(date) from public, anon, authenticated;
grant execute on function public.uso_llm_dia_por_flota(date) to service_role;

create or replace function public.purgar_llm_alerta_tope(p_dias integer default 90)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  borradas integer;
begin
  if p_dias is null or p_dias < 7 then
    raise exception 'purgar_llm_alerta_tope: la retención mínima es de 7 días (recibió %)', p_dias;
  end if;
  delete from public.llm_alerta_tope where dia < (now() at time zone 'America/Mexico_City')::date - p_dias;
  get diagnostics borradas = row_count;
  return borradas;
end;
$$;

revoke all on function public.purgar_llm_alerta_tope(integer) from public, anon, authenticated;
grant execute on function public.purgar_llm_alerta_tope(integer) to service_role;

commit;
