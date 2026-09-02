-- 0193 · AGEN-19C2-4: el tope diario de presupuesto de IA se reiniciaba a las
-- 18:00 hora de México (medianoche UTC), no a medianoche real de la flota, y
-- una reserva de una invocación que muere (crash, deploy, OOM) sin liquidarse
-- se quedaba contando contra el tope de por vida — nunca vence.
--
-- Misma idea que 0161 (`factura_saldo`, vencimiento en fecha MX) aplicada aquí:
-- el corte del día se calcula truncando en 'America/Mexico_City' y reconvirtiendo
-- a timestamptz, en vez de confiar en el UTC de `now()`.

alter table public.llm_presupuesto_reserva
  add column if not exists expira_en timestamptz not null default (now() + interval '10 minutes');

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
  inicio_dia_mx timestamptz;
begin
  if p_reserva_usd <= 0 or p_tope_run_usd <= 0 or p_tope_tenant_usd <= 0 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  -- Medianoche de HOY en hora de México, no en UTC (ver 0161).
  inicio_dia_mx := date_trunc('day', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City';
  select coalesce(sum(reservado_usd), 0) into usado_tenant
    from public.llm_presupuesto_reserva
   where tenant_id = p_tenant_id
     and created_at >= inicio_dia_mx
     and (estado = 'liquidado' or (estado = 'reservado' and expira_en > now()));
  if usado_tenant + p_reserva_usd > p_tope_tenant_usd then return false; end if;
  select coalesce(sum(reservado_usd), 0) into usado_run
    from public.llm_presupuesto_reserva
   where tenant_id = p_tenant_id
     and run_id = p_run_id
     and (estado = 'liquidado' or (estado = 'reservado' and expira_en > now()));
  if usado_run + p_reserva_usd > p_tope_run_usd then return false; end if;
  insert into public.llm_presupuesto_reserva(id, tenant_id, run_id, reservado_usd, estado)
  values (p_reserva_id, p_tenant_id, p_run_id, p_reserva_usd, 'reservado');
  return true;
end;
$$;

revoke all on function public.reservar_presupuesto_llm(uuid, uuid, uuid, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.reservar_presupuesto_llm(uuid, uuid, uuid, numeric, numeric, numeric) to service_role;
