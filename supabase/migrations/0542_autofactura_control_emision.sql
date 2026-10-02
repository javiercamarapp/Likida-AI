-- ═══════════════════════════════════════════════════════════════════════════
-- 0542 — CONTROL DE LA EMISIÓN REAL DE AUTOFACTURA (agente 6): bandera por flota,
-- límites de monto y volumen, fase supervisada por portal y confirmación humana por lote.
--
-- Emitir un CFDI por un portal es IRREVERSIBLE ante el SAT. Hasta hoy el único control era
-- una variable de entorno GLOBAL (FACTURACION_MODO) más el mandato por flota. Esta migración
-- agrega, por FLOTA y con garantías que solo la base puede dar:
--   · `autofactura_control`: la bandera ensayo→real POR FLOTA (apagada por omisión) y los
--     límites de arranque (monto por ticket, tickets por lote y por día, monto por día).
--     Encenderla exige un flota_admin activo de ESA flota Y el mandato vigente (RPC);
--     apagarla la puede hacer también el contador (apagar es el lado seguro).
--   · `autofactura_portal_fase`: por (flota, portal) arranca `supervisada`; solo pasa a
--     `autonoma` tras N emisiones reales confirmadas con UUID y la decisión de un dueño.
--   · `autofactura_lote`: en fase supervisada el agente PROPONE un lote (snapshot de gastos
--     de la flota) y una persona lo CONFIRMA; el cron lo consume UNA vez (atómico).
--   · `autofactura_cupo_dia`: reserva atómica del cupo diario (no hay carrera entre corridas).
-- Deny-all para anon/authenticated (como 0443): todo entra por service_role vía RPC.
-- Retención: `purgar_autofactura(dias)` borra lotes cerrados y cupos viejos (sin datos personales).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Bandera y límites por flota ──────────────────────────────────────────
create table if not exists public.autofactura_control (
  tenant_id        uuid primary key references public.tenant(id) on delete cascade,
  emision_real     boolean not null default false,
  max_monto_ticket numeric(12,2) not null default 1500
    constraint afc_monto_ticket_rango check (max_monto_ticket > 0 and max_monto_ticket <= 100000),
  max_tickets_lote integer not null default 3
    constraint afc_lote_rango check (max_tickets_lote between 1 and 50),
  max_tickets_dia  integer not null default 10
    constraint afc_dia_rango check (max_tickets_dia between 1 and 500),
  max_monto_dia    numeric(12,2) not null default 10000
    constraint afc_monto_dia_rango check (max_monto_dia > 0 and max_monto_dia <= 1000000),
  emision_real_desde timestamptz,
  emision_real_por   uuid references public.app_user(id) on delete set null,
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid references public.app_user(id) on delete set null,
  constraint afc_real_con_fecha check (not emision_real or emision_real_desde is not null),
  constraint afc_dia_cubre_lote check (max_tickets_dia >= max_tickets_lote)
);
comment on table public.autofactura_control is
  '0542 (agente 6): bandera ensayo→real POR FLOTA (apagada por omisión) y límites de arranque. Sin fila = ensayo. Encender exige flota_admin activo de la flota y mandato vigente (RPC activar_emision_real).';

-- ── 2. Fase por (flota, portal) ─────────────────────────────────────────────
create table if not exists public.autofactura_portal_fase (
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  comercio    text not null constraint afpf_comercio_forma check (comercio ~ '^[a-z0-9_]{2,64}$'),
  fase        text not null default 'supervisada' constraint afpf_fase_dominio check (fase in ('supervisada', 'autonoma')),
  emisiones_confirmadas integer not null default 0 constraint afpf_emisiones_no_neg check (emisiones_confirmadas >= 0),
  primera_emision_en timestamptz,
  ultima_emision_en  timestamptz,
  promovida_en  timestamptz,
  promovida_por uuid references public.app_user(id) on delete set null,
  primary key (tenant_id, comercio),
  constraint afpf_autonoma_con_emisiones check (fase = 'supervisada' or (emisiones_confirmadas >= 1 and promovida_en is not null))
);
comment on table public.autofactura_portal_fase is
  '0542: supervisada (default) exige confirmación humana por lote; autonoma solo tras emisiones reales confirmadas y la decisión de un dueño (RPC promover_portal_autonomo).';

-- ── 3. Lotes a confirmar ────────────────────────────────────────────────────
create table if not exists public.autofactura_lote (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  comercio     text not null constraint afl_comercio_forma check (comercio ~ '^[a-z0-9_]{2,64}$'),
  gasto_ids    uuid[] not null constraint afl_gastos_tamano check (cardinality(gasto_ids) between 1 and 50),
  monto_total  numeric(14,2) not null constraint afl_monto_no_neg check (monto_total >= 0),
  estado       text not null default 'propuesto'
    constraint afl_estado_dominio check (estado in ('propuesto', 'confirmado', 'rechazado', 'ejecutado', 'expirado')),
  propuesto_en timestamptz not null default now(),
  expira_en    timestamptz not null,
  decidido_por uuid references public.app_user(id) on delete set null,
  decidido_en  timestamptz,
  motivo       text constraint afl_motivo_largo check (motivo is null or length(motivo) <= 400),
  ejecutado_en timestamptz,
  constraint afl_expira_posterior check (expira_en > propuesto_en),
  constraint afl_confirmado_con_fecha check (estado not in ('confirmado', 'ejecutado') or decidido_en is not null)
);
-- UN lote vivo (propuesto o confirmado) por (flota, portal).
create unique index if not exists afl_vivo_unico_uidx on public.autofactura_lote (tenant_id, comercio) where estado in ('propuesto', 'confirmado');
create index if not exists afl_tenant_idx on public.autofactura_lote (tenant_id, propuesto_en desc);
comment on table public.autofactura_lote is
  '0542: confirmación humana por lote en fase supervisada. propuesto→confirmado|rechazado|expirado; confirmado→ejecutado (el cron lo consume UNA vez).';

-- ── 4. Cupo diario ──────────────────────────────────────────────────────────
create table if not exists public.autofactura_cupo_dia (
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  dia       date not null,
  tickets   integer not null default 0 constraint afcd_tickets_no_neg check (tickets >= 0),
  monto     numeric(14,2) not null default 0 constraint afcd_monto_no_neg check (monto >= 0),
  primary key (tenant_id, dia)
);

alter table public.autofactura_control enable row level security;
alter table public.autofactura_portal_fase enable row level security;
alter table public.autofactura_lote enable row level security;
alter table public.autofactura_cupo_dia enable row level security;
revoke all on table public.autofactura_control, public.autofactura_portal_fase, public.autofactura_lote, public.autofactura_cupo_dia from public, anon, authenticated;
grant select, insert, update, delete on table public.autofactura_control, public.autofactura_portal_fase, public.autofactura_lote, public.autofactura_cupo_dia to service_role;

-- ── RPC: encender / apagar la emisión real ──────────────────────────────────
create or replace function public.activar_emision_real(p_tenant uuid, p_user uuid, p_version_mandato text)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare v_rol text; v_activo boolean;
begin
  select rol, activo into v_rol, v_activo from app_user where id = p_user and tenant_id = p_tenant;
  if not found or not v_activo then return jsonb_build_object('ok', false, 'motivo', 'el usuario no es de esta flota o está dado de baja'); end if;
  if v_rol <> 'flota_admin' then return jsonb_build_object('ok', false, 'motivo', 'solo el dueño de la flota enciende la emisión real'); end if;
  if not public.mandato_autofacturacion_vigente(p_tenant, p_version_mandato) then
    return jsonb_build_object('ok', false, 'motivo', 'falta el mandato de autofacturación vigente de la flota: otórgalo en Términos y mandato antes de encender la emisión real');
  end if;
  insert into autofactura_control (tenant_id, emision_real, emision_real_desde, emision_real_por, actualizado_por)
  values (p_tenant, true, now(), p_user, p_user)
  on conflict (tenant_id) do update set emision_real = true, emision_real_desde = now(), emision_real_por = p_user, actualizado_en = now(), actualizado_por = p_user;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.apagar_emision_real(p_tenant uuid, p_user uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare v_rol text; v_activo boolean; n integer;
begin
  select rol, activo into v_rol, v_activo from app_user where id = p_user and tenant_id = p_tenant;
  if not found or not v_activo or v_rol not in ('flota_admin', 'contador') then
    return jsonb_build_object('ok', false, 'motivo', 'solo el dueño o el contador de la flota pueden apagar la emisión real');
  end if;
  update autofactura_control set emision_real = false, actualizado_en = now(), actualizado_por = p_user where tenant_id = p_tenant;
  get diagnostics n = row_count;
  -- Apagar también cancela los lotes confirmados que aún no se ejecutaron: confirmar fue para encender.
  update autofactura_lote set estado = 'rechazado', decidido_en = now(), decidido_por = p_user, motivo = 'se apagó la emisión real'
   where tenant_id = p_tenant and estado in ('propuesto', 'confirmado');
  return jsonb_build_object('ok', true, 'estaba_encendida', n > 0);
end $$;

create or replace function public.cambiar_limites_emision(
  p_tenant uuid, p_user uuid, p_max_monto_ticket numeric, p_max_tickets_lote integer, p_max_tickets_dia integer, p_max_monto_dia numeric
) returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare v_rol text; v_activo boolean;
begin
  select rol, activo into v_rol, v_activo from app_user where id = p_user and tenant_id = p_tenant;
  if not found or not v_activo or v_rol <> 'flota_admin' then
    return jsonb_build_object('ok', false, 'motivo', 'solo el dueño de la flota cambia los límites de emisión');
  end if;
  begin
    insert into autofactura_control (tenant_id, max_monto_ticket, max_tickets_lote, max_tickets_dia, max_monto_dia, actualizado_por)
    values (p_tenant, p_max_monto_ticket, p_max_tickets_lote, p_max_tickets_dia, p_max_monto_dia, p_user)
    on conflict (tenant_id) do update set max_monto_ticket = p_max_monto_ticket, max_tickets_lote = p_max_tickets_lote,
      max_tickets_dia = p_max_tickets_dia, max_monto_dia = p_max_monto_dia, actualizado_en = now(), actualizado_por = p_user;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'motivo', 'los límites están fuera de rango (monto por ticket ≤ 100,000; lote 1–50; día 1–500 y ≥ lote; monto por día ≤ 1,000,000)');
  end;
  return jsonb_build_object('ok', true);
end $$;

-- ── RPC: la fase por portal ─────────────────────────────────────────────────
create or replace function public.registrar_emision_portal(p_tenant uuid, p_comercio text, p_n integer)
returns void language sql security invoker set search_path = public, pg_catalog as $$
  insert into autofactura_portal_fase (tenant_id, comercio, emisiones_confirmadas, primera_emision_en, ultima_emision_en)
  values (p_tenant, p_comercio, greatest(p_n, 0), now(), now())
  on conflict (tenant_id, comercio) do update set
    emisiones_confirmadas = autofactura_portal_fase.emisiones_confirmadas + greatest(p_n, 0),
    primera_emision_en = coalesce(autofactura_portal_fase.primera_emision_en, now()),
    ultima_emision_en = now();
$$;

create or replace function public.promover_portal_autonomo(p_tenant uuid, p_comercio text, p_user uuid, p_min integer default 3)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare v_rol text; v_activo boolean; v_n integer; v_fase text;
begin
  select rol, activo into v_rol, v_activo from app_user where id = p_user and tenant_id = p_tenant;
  if not found or not v_activo or v_rol <> 'flota_admin' then
    return jsonb_build_object('ok', false, 'motivo', 'solo el dueño de la flota promueve un portal a emisión autónoma');
  end if;
  if p_min is null or p_min < 1 then return jsonb_build_object('ok', false, 'motivo', 'el mínimo de emisiones confirmadas debe ser al menos 1'); end if;
  select emisiones_confirmadas, fase into v_n, v_fase from autofactura_portal_fase where tenant_id = p_tenant and comercio = p_comercio for update;
  if not found or v_n < p_min then
    return jsonb_build_object('ok', false, 'motivo', format('hacen falta al menos %s emisiones reales confirmadas con UUID en este portal (hay %s)', p_min, coalesce(v_n, 0)));
  end if;
  update autofactura_portal_fase set fase = 'autonoma', promovida_en = now(), promovida_por = p_user where tenant_id = p_tenant and comercio = p_comercio;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.devolver_portal_a_supervisada(p_tenant uuid, p_comercio text, p_user uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare v_rol text; v_activo boolean; n integer;
begin
  select rol, activo into v_rol, v_activo from app_user where id = p_user and tenant_id = p_tenant;
  if not found or not v_activo or v_rol not in ('flota_admin', 'contador') then
    return jsonb_build_object('ok', false, 'motivo', 'solo el dueño o el contador devuelven un portal a fase supervisada');
  end if;
  update autofactura_portal_fase set fase = 'supervisada', promovida_en = null, promovida_por = null where tenant_id = p_tenant and comercio = p_comercio;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'cambiados', n);
end $$;

-- ── RPC: lotes ──────────────────────────────────────────────────────────────
create or replace function public.proponer_lote_emision(p_tenant uuid, p_comercio text, p_gastos uuid[], p_monto numeric, p_ttl_horas integer default 48)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare v_ok integer; v_id uuid; v_estado text; v_ids uuid[]; v_total numeric;
begin
  if p_gastos is null or cardinality(p_gastos) = 0 then return jsonb_build_object('ok', false, 'motivo', 'el lote no trae gastos'); end if;
  if p_ttl_horas is null or p_ttl_horas < 1 or p_ttl_horas > 168 then return jsonb_build_object('ok', false, 'motivo', 'la vigencia del lote debe estar entre 1 y 168 horas'); end if;
  -- Aislamiento: TODOS los gastos son de esta flota, o no hay lote.
  select count(*) into v_ok from gasto where tenant_id = p_tenant and id = any(p_gastos);
  if v_ok <> cardinality(p_gastos) then return jsonb_build_object('ok', false, 'motivo', 'algún gasto no es de esta flota'); end if;

  -- Un lote propuesto vencido deja de serlo antes de mirar si hay uno vivo.
  update autofactura_lote set estado = 'expirado' where tenant_id = p_tenant and comercio = p_comercio and estado = 'propuesto' and expira_en <= now();
  select id, estado, gasto_ids into v_id, v_estado, v_ids from autofactura_lote where tenant_id = p_tenant and comercio = p_comercio and estado in ('propuesto', 'confirmado') for update;
  if found then
    if v_estado = 'confirmado' then
      -- Ya hay un lote confirmado esperando al cron: no se toca (cambiarlo invalidaría lo que la persona vio).
      return jsonb_build_object('ok', true, 'id', v_id, 'estado', 'confirmado', 'agregados', 0);
    end if;
    -- propuesto: se agregan los que faltan (tope 50) y se recalcula el monto desde la base, no desde el cliente.
    select array(select distinct x from unnest(v_ids || p_gastos) x limit 50) into v_ids;
    select coalesce(sum(monto), 0) into v_total from gasto where tenant_id = p_tenant and id = any(v_ids);
    update autofactura_lote set gasto_ids = v_ids, monto_total = v_total where id = v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'estado', 'propuesto', 'agregados', cardinality(v_ids));
  end if;
  select coalesce(sum(monto), 0) into v_total from gasto where tenant_id = p_tenant and id = any(p_gastos);
  insert into autofactura_lote (tenant_id, comercio, gasto_ids, monto_total, expira_en)
  values (p_tenant, p_comercio, p_gastos, v_total, now() + make_interval(hours => p_ttl_horas)) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'estado', 'propuesto', 'agregados', cardinality(p_gastos));
end $$;

create or replace function public.decidir_lote_emision(p_id uuid, p_tenant uuid, p_user uuid, p_confirmar boolean, p_version_mandato text, p_motivo text default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare v_rol text; v_activo boolean; f autofactura_lote%rowtype; v_real boolean;
begin
  select rol, activo into v_rol, v_activo from app_user where id = p_user and tenant_id = p_tenant;
  if not found or not v_activo or v_rol not in ('flota_admin', 'contador') then
    return jsonb_build_object('ok', false, 'motivo', 'solo el dueño o el contador de la flota deciden un lote de emisión');
  end if;
  select * into f from autofactura_lote where id = p_id and tenant_id = p_tenant for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'lote inexistente en esta flota'); end if;
  if f.estado <> 'propuesto' then return jsonb_build_object('ok', false, 'motivo', 'el lote ya no está pendiente de decisión'); end if;
  if f.expira_en <= now() then
    update autofactura_lote set estado = 'expirado' where id = f.id;
    return jsonb_build_object('ok', false, 'motivo', 'el lote venció: el agente propondrá uno nuevo');
  end if;
  if p_confirmar then
    select emision_real into v_real from autofactura_control where tenant_id = p_tenant;
    if coalesce(v_real, false) is not true then return jsonb_build_object('ok', false, 'motivo', 'la emisión real está apagada para esta flota: enciéndela antes de confirmar un lote'); end if;
    if not public.mandato_autofacturacion_vigente(p_tenant, p_version_mandato) then
      return jsonb_build_object('ok', false, 'motivo', 'falta el mandato de autofacturación vigente de la flota');
    end if;
    update autofactura_lote set estado = 'confirmado', decidido_por = p_user, decidido_en = now(), motivo = left(p_motivo, 400) where id = f.id;
  else
    update autofactura_lote set estado = 'rechazado', decidido_por = p_user, decidido_en = now(), motivo = left(p_motivo, 400) where id = f.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- El cron consume el lote confirmado UNA vez: devuelve los gastos que de verdad pueden emitir.
create or replace function public.consumir_lote_confirmado(p_tenant uuid, p_comercio text, p_gastos uuid[])
returns uuid[] language plpgsql security invoker set search_path = public, pg_catalog as $$
declare f autofactura_lote%rowtype; v uuid[];
begin
  select * into f from autofactura_lote where tenant_id = p_tenant and comercio = p_comercio and estado = 'confirmado' for update;
  if not found then return '{}'::uuid[]; end if;
  if f.expira_en <= now() then
    update autofactura_lote set estado = 'expirado' where id = f.id;
    return '{}'::uuid[];
  end if;
  select coalesce(array_agg(x), '{}') into v from unnest(f.gasto_ids) x where x = any(p_gastos);
  if cardinality(v) = 0 then return v; end if;
  update autofactura_lote set estado = 'ejecutado', ejecutado_en = now() where id = f.id;
  return v;
end $$;

-- ── RPC: cupo diario ────────────────────────────────────────────────────────
create or replace function public.reservar_cupo_dia(p_tenant uuid, p_dia date, p_tickets integer, p_monto numeric, p_max_tickets integer, p_max_monto numeric)
returns boolean language plpgsql security invoker set search_path = public, pg_catalog as $$
declare n integer;
begin
  if p_tickets < 1 or p_monto < 0 then return false; end if;
  insert into autofactura_cupo_dia (tenant_id, dia) values (p_tenant, p_dia) on conflict do nothing;
  update autofactura_cupo_dia set tickets = tickets + p_tickets, monto = monto + p_monto
   where tenant_id = p_tenant and dia = p_dia and tickets + p_tickets <= p_max_tickets and monto + p_monto <= p_max_monto;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.liberar_cupo_dia(p_tenant uuid, p_dia date, p_tickets integer, p_monto numeric)
returns void language sql security invoker set search_path = public, pg_catalog as $$
  update autofactura_cupo_dia set tickets = greatest(tickets - p_tickets, 0), monto = greatest(monto - p_monto, 0) where tenant_id = p_tenant and dia = p_dia;
$$;

-- ── Retención ───────────────────────────────────────────────────────────────
create or replace function public.purgar_autofactura(p_dias integer default 180)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare a integer; b integer;
begin
  if p_dias is null or p_dias < 30 then raise exception 'la retención mínima de lotes y cupos de autofactura es de 30 días'; end if;
  update autofactura_lote set estado = 'expirado' where estado in ('propuesto', 'confirmado') and expira_en <= now();
  delete from autofactura_lote where estado in ('rechazado', 'ejecutado', 'expirado') and coalesce(ejecutado_en, decidido_en, expira_en) < now() - make_interval(days => p_dias);
  get diagnostics a = row_count;
  delete from autofactura_cupo_dia where dia < (now() - make_interval(days => p_dias))::date;
  get diagnostics b = row_count;
  return jsonb_build_object('lotes', a, 'cupos', b);
end $$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('activar_emision_real','apagar_emision_real','cambiar_limites_emision','registrar_emision_portal','promover_portal_autonomo','devolver_portal_a_supervisada','proponer_lote_emision','decidir_lote_emision','consumir_lote_confirmado','reservar_cupo_dia','liberar_cupo_dia','purgar_autofactura')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
