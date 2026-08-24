-- 0186 · Runtime de agentes: idempotencia durable y presupuesto monetario reservado.
-- 0177 queda deliberadamente fuera de esta entrega.

create table if not exists public.agente_mutacion_idempotencia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  effect_key text not null,
  tool_name text not null,
  owner_token uuid not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  result jsonb,
  error text,
  lease_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, effect_key)
);

create index if not exists agente_mutacion_idem_lease_idx
  on public.agente_mutacion_idempotencia (status, lease_until);

alter table public.agente_mutacion_idempotencia enable row level security;
revoke all on public.agente_mutacion_idempotencia from public, anon, authenticated;
grant select, insert, update on public.agente_mutacion_idempotencia to service_role;

create table if not exists public.llm_presupuesto_reserva (
  id uuid primary key,
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  run_id uuid not null,
  reservado_usd numeric(18, 6) not null check (reservado_usd >= 0),
  costo_real_usd numeric(18, 6) not null default 0 check (costo_real_usd >= 0),
  estado text not null check (estado in ('reservado', 'liquidado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists llm_presupuesto_tenant_dia_idx
  on public.llm_presupuesto_reserva (tenant_id, created_at, estado);

alter table public.llm_presupuesto_reserva enable row level security;
revoke all on public.llm_presupuesto_reserva from public, anon, authenticated;
grant select, insert, update on public.llm_presupuesto_reserva to service_role;

create or replace function public.reservar_presupuesto_llm(
  p_reserva_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_reserva_usd numeric,
  p_tope_run_usd numeric,
  p_tope_tenant_usd numeric
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  usado_tenant numeric;
  usado_run numeric;
begin
  if p_reserva_usd <= 0 or p_tope_run_usd <= 0 or p_tope_tenant_usd <= 0 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  select coalesce(sum(reservado_usd), 0) into usado_tenant
    from public.llm_presupuesto_reserva
   where tenant_id = p_tenant_id
     and created_at >= date_trunc('day', now())
     and estado in ('reservado', 'liquidado');
  if usado_tenant + p_reserva_usd > p_tope_tenant_usd then return false; end if;
  select coalesce(sum(reservado_usd), 0) into usado_run
    from public.llm_presupuesto_reserva
   where tenant_id = p_tenant_id
     and run_id = p_run_id
     and estado in ('reservado', 'liquidado');
  if usado_run + p_reserva_usd > p_tope_run_usd then return false; end if;
  insert into public.llm_presupuesto_reserva(id, tenant_id, run_id, reservado_usd, estado)
  values (p_reserva_id, p_tenant_id, p_run_id, p_reserva_usd, 'reservado');
  return true;
end;
$$;

create or replace function public.liquidar_presupuesto_llm(
  p_reserva_id uuid,
  p_costo_real_usd numeric
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.llm_presupuesto_reserva
     set reservado_usd = greatest(0, p_costo_real_usd),
         costo_real_usd = greatest(0, p_costo_real_usd),
         estado = 'liquidado',
         updated_at = now()
   where id = p_reserva_id and estado = 'reservado';
  return found;
end;
$$;

revoke all on function public.reservar_presupuesto_llm(uuid, uuid, uuid, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.liquidar_presupuesto_llm(uuid, numeric) from public, anon, authenticated;
grant execute on function public.reservar_presupuesto_llm(uuid, uuid, uuid, numeric, numeric, numeric) to service_role;
grant execute on function public.liquidar_presupuesto_llm(uuid, numeric) to service_role;
