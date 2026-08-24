-- 0188 · Runtime de agentes: idempotencia durable con reloj autoritativo de PostgreSQL.
--
-- 0186 dejó la tabla durable, pero el cliente calculaba lease_until con el
-- reloj de la instancia. Estas RPCs convierten claim, renovación y fencing en
-- operaciones server-side: dos workers con relojes divergentes siguen viendo
-- el mismo tiempo autoritativo de la base.

create or replace function public.claim_agente_mutacion(
  p_tenant_id uuid,
  p_effect_key text,
  p_tool_name text,
  p_lease_seconds integer
) returns table (
  kind text,
  token uuid,
  result jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_token uuid := gen_random_uuid();
  v_row public.agente_mutacion_idempotencia%rowtype;
begin
  if p_tenant_id is null or nullif(btrim(p_effect_key), '') is null then
    raise exception 'tenant and effect key are required';
  end if;
  if nullif(btrim(p_tool_name), '') is null then
    raise exception 'tool name is required';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'tool idempotency lease seconds must be between 1 and 900';
  end if;

  -- La restricción unique serializa la primera reclamación. Si otro worker
  -- inserta al mismo tiempo, el INSERT espera la resolución y luego cae en
  -- el camino de lectura/fencing de abajo.
  insert into public.agente_mutacion_idempotencia (
    tenant_id, effect_key, tool_name, owner_token, status, lease_until, attempts
  ) values (
    p_tenant_id, p_effect_key, p_tool_name, v_token, 'running',
    v_now + make_interval(secs => p_lease_seconds), 1
  )
  on conflict (tenant_id, effect_key) do nothing
  returning * into v_row;

  if found then
    return query select 'execute'::text, v_token, null::jsonb;
    return;
  end if;

  -- SKIP LOCKED evita que una segunda instancia quede esperando detrás de un
  -- handler lento. Si la fila está en transición, el resultado seguro es busy.
  select * into v_row
    from public.agente_mutacion_idempotencia
   where tenant_id = p_tenant_id
     and effect_key = p_effect_key
   for update skip locked;
  if not found then
    return query select 'busy'::text, null::uuid, null::jsonb;
    return;
  end if;

  if v_row.tool_name <> p_tool_name then
    raise exception 'effect key already belongs to another tool';
  end if;
  if v_row.status = 'succeeded' then
    return query select 'cached'::text, null::uuid, v_row.result;
    return;
  end if;
  if v_row.status = 'running' and v_row.lease_until > clock_timestamp() then
    return query select 'busy'::text, null::uuid, null::jsonb;
    return;
  end if;

  update public.agente_mutacion_idempotencia
     set owner_token = v_token,
         status = 'running',
         lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
         attempts = v_row.attempts + 1,
         result = null,
         error = null,
         updated_at = clock_timestamp()
   where tenant_id = p_tenant_id
     and effect_key = p_effect_key
     and owner_token = v_row.owner_token
     and status = v_row.status;

  if not found then
    return query select 'busy'::text, null::uuid, null::jsonb;
    return;
  end if;
  return query select 'execute'::text, v_token, null::jsonb;
end;
$$;

create or replace function public.renew_agente_mutacion(
  p_tenant_id uuid,
  p_effect_key text,
  p_owner_token uuid,
  p_lease_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'tool idempotency lease seconds must be between 1 and 900';
  end if;
  update public.agente_mutacion_idempotencia
     set lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
         updated_at = clock_timestamp()
   where tenant_id = p_tenant_id
     and effect_key = p_effect_key
     and owner_token = p_owner_token
     and status = 'running'
     and lease_until > clock_timestamp();
  return found;
end;
$$;

create or replace function public.complete_agente_mutacion(
  p_tenant_id uuid,
  p_effect_key text,
  p_owner_token uuid,
  p_result jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.agente_mutacion_idempotencia
     set status = 'succeeded',
         result = p_result,
         error = null,
         lease_until = clock_timestamp(),
         updated_at = clock_timestamp()
   where tenant_id = p_tenant_id
     and effect_key = p_effect_key
     and owner_token = p_owner_token
     and status = 'running';
  return found;
end;
$$;

create or replace function public.fail_agente_mutacion(
  p_tenant_id uuid,
  p_effect_key text,
  p_owner_token uuid,
  p_error text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.agente_mutacion_idempotencia
     set status = 'failed',
         error = left(coalesce(p_error, ''), 1000),
         lease_until = clock_timestamp(),
         updated_at = clock_timestamp()
   where tenant_id = p_tenant_id
     and effect_key = p_effect_key
     and owner_token = p_owner_token
     and status = 'running';
  return found;
end;
$$;

revoke all on function public.claim_agente_mutacion(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.renew_agente_mutacion(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_agente_mutacion(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_agente_mutacion(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_agente_mutacion(uuid, text, text, integer) to service_role;
grant execute on function public.renew_agente_mutacion(uuid, text, uuid, integer) to service_role;
grant execute on function public.complete_agente_mutacion(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.fail_agente_mutacion(uuid, text, uuid, text) to service_role;
