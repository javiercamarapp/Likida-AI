-- 0180 — reservas atómicas del runner y outbox durable de WhatsApp.
--
-- Un SELECT de gasto seguido de llamar al modelo no es un presupuesto: dos
-- invocaciones ven el mismo saldo y ambas lo gastan. La reserva toma un lock
-- por (agente,día MX) y aparta TODO el saldo de esta vuelta; así solo una
-- vuelta puede gastar ese saldo hasta que cierre o su lease venza.

create table if not exists public.agente_presupuesto_reserva (
  id uuid primary key default gen_random_uuid(),
  agente text not null,
  dia date not null,
  monto_usd numeric not null check (monto_usd > 0),
  creada_en timestamptz not null default now(),
  vence_en timestamptz not null,
  cerrada_en timestamptz,
  costo_real_usd numeric,
  constraint agente_presupuesto_reserva_costo_sano
    check (costo_real_usd is null or costo_real_usd >= 0)
);
create index if not exists agente_presupuesto_reserva_activa_idx
  on public.agente_presupuesto_reserva(agente, dia, vence_en)
  where cerrada_en is null;
alter table public.agente_presupuesto_reserva enable row level security;

create or replace function public.reservar_presupuesto_agente(
  p_agente text, p_dia date, p_tope_usd numeric, p_lease_seconds int default 300
) returns table(id uuid, disponible_usd numeric)
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare v_gastado numeric; v_reservado numeric; v_disponible numeric; v_id uuid; v_inicio timestamptz;
begin
  if p_tope_usd <= 0 or p_lease_seconds < 30 then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_agente || ':' || p_dia::text, 0));
  v_inicio := p_dia::timestamp at time zone 'America/Mexico_City';
  select coalesce(sum(costo_usd), 0) into v_gastado
    from agente_corrida
   where agente=p_agente and inicio >= v_inicio
     and inicio < v_inicio + interval '1 day';
  select coalesce(sum(monto_usd), 0) into v_reservado
    from agente_presupuesto_reserva
   where agente=p_agente and dia=p_dia and cerrada_en is null and vence_en > now();
  v_disponible := p_tope_usd - v_gastado - v_reservado;
  if v_disponible <= 0 then return; end if;
  insert into agente_presupuesto_reserva(agente,dia,monto_usd,vence_en)
  values(p_agente,p_dia,v_disponible,now()+make_interval(secs=>p_lease_seconds)) returning agente_presupuesto_reserva.id into v_id;
  return query select v_id, v_disponible;
end $$;

create or replace function public.cerrar_reserva_presupuesto_agente(
  p_id uuid, p_costo_real_usd numeric default null
) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  update agente_presupuesto_reserva
     set cerrada_en=now(), costo_real_usd=p_costo_real_usd
   where id=p_id and cerrada_en is null;
  return found;
end $$;

revoke all on function public.reservar_presupuesto_agente(text,date,numeric,int) from public,anon,authenticated;
revoke all on function public.cerrar_reserva_presupuesto_agente(uuid,numeric) from public,anon,authenticated;
grant execute on function public.reservar_presupuesto_agente(text,date,numeric,int),
  public.cerrar_reserva_presupuesto_agente(uuid,numeric) to service_role;

-- El proveedor puede aceptar una petición y romper la conexión antes de que
-- regrese el wamid. El outbox guarda la intención antes de tocar Meta y permite
-- un worker con lease/reintentos; nunca se borra el último error.
create table if not exists public.wa_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique,
  payload jsonb not null,
  estado text not null default 'pending' check (estado in ('pending','sending','sent','dead')),
  intentos int not null default 0 check (intentos >= 0),
  proximo_intento_en timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  ultimo_error text,
  creada_en timestamptz not null default now(),
  enviada_en timestamptz
);
create index if not exists wa_outbox_drenado_idx on public.wa_outbox(proximo_intento_en, creada_en)
  where estado in ('pending','sending');
alter table public.wa_outbox enable row level security;

create or replace function public.reclamar_wa_outbox(p_limite int default 25, p_lease_seconds int default 120)
returns table(id uuid, payload jsonb, intentos int, lease_token uuid)
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  return query
  with candidatas as (
    select o.id from wa_outbox o
     where (o.estado='pending' and o.proximo_intento_en <= now())
        or (o.estado='sending' and o.lease_expires_at < now())
     order by o.proximo_intento_en, o.creada_en
     for update skip locked limit greatest(1, least(p_limite, 100))
  )
  update wa_outbox o set estado='sending', intentos=o.intentos+1,
    lease_token=gen_random_uuid(), lease_expires_at=now()+make_interval(secs=>p_lease_seconds)
   from candidatas c where o.id=c.id
  returning o.id,o.payload,o.intentos,o.lease_token;
end $$;

create or replace function public.finalizar_wa_outbox(
  p_id uuid, p_token uuid, p_message_id text default null, p_error text default null
) returns boolean
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  if p_message_id is not null then
    update wa_outbox set estado='sent', provider_message_id=p_message_id, enviada_en=now(),
      lease_expires_at=null, ultimo_error=null where id=p_id and lease_token=p_token and estado='sending';
  else
    update wa_outbox set estado=case when intentos >= 8 then 'dead' else 'pending' end,
      proximo_intento_en=now()+make_interval(secs=>least(3600, 15 * power(2, least(intentos, 8))::int)),
      lease_expires_at=null, ultimo_error=left(coalesce(p_error,'fallo de envío'),500)
      where id=p_id and lease_token=p_token and estado='sending';
  end if;
  return found;
end $$;

revoke all on table public.wa_outbox from public,anon,authenticated;
revoke all on function public.reclamar_wa_outbox(int,int), public.finalizar_wa_outbox(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reclamar_wa_outbox(int,int), public.finalizar_wa_outbox(uuid,uuid,text,text) to service_role;

alter table public.cron_latido drop constraint if exists cron_latido_id_dominio;
alter table public.cron_latido add constraint cron_latido_id_dominio
  check (id in ('wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps'));
