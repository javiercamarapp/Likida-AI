-- ═══════════════════════════════════════════════════════════════════════════
-- 0540 — SOLICITUD DE VINCULACIÓN ASISTIDA DE PORTAL (CAPTCHA / MFA por código de un solo uso).
--
-- Agente 6 «autofacturación». El paso humano del CAPTCHA era un script local sin
-- pantalla en el producto. Ahora el dueño de la flota pulsa «Vincular» en el panel;
-- Likida crea ESTA solicitud con un código de un solo uso (se muestra una vez; aquí
-- solo vive su hash SHA-256) y una máquina CON pantalla (la del contralor) corre
-- `scripts/vincular-portal.mjs --codigo …`: reclama la solicitud, abre el portal
-- visible, el humano entra y resuelve el reto, y el script sube SOLO las cookies de
-- ese portal, que el servidor cifra en el cofre (AES-256-GCM). Ni el código ni las
-- cookies se guardan en claro; la contraseña del portal nunca pasa por Likida.
--
-- Ciclo: pendiente → reclamada → completada | fallida;  pendiente|reclamada → expirada
-- | cancelada. UNA solicitud viva por (flota, portal). Todo transita por RPC atómicas
-- (security invoker, solo service_role): la base arbitra la carrera de dos máquinas
-- que reclaman el mismo código y los intentos fallidos de adivinarlo.
--
-- RLS: deny-all para anon/authenticated (como 0443); todo entra por service_role.
-- Retención: `purgar_vinculacion_portal(dias)` borra solicitudes cerradas de más de
-- N días (sin datos personales: solo el id de quien la pidió, ON DELETE SET NULL).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.portal_vinculacion_solicitud (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  comercio       text not null
    constraint pvs_comercio_forma check (comercio ~ '^[a-z0-9_]{2,64}$'),
  estado         text not null default 'pendiente'
    constraint pvs_estado_dominio check (estado in ('pendiente', 'reclamada', 'completada', 'fallida', 'expirada', 'cancelada')),
  codigo_hash    text not null
    constraint pvs_codigo_hash_forma check (codigo_hash ~ '^[0-9a-f]{64}$'),
  creada_por     uuid references public.app_user(id) on delete set null,
  creada_en      timestamptz not null default now(),
  expira_en      timestamptz not null,
  reclamada_en   timestamptz,
  completada_en  timestamptz,
  cerrada_en     timestamptz,
  cookies        integer,
  motivo         text
    constraint pvs_motivo_largo check (motivo is null or length(motivo) <= 400),
  constraint pvs_expira_posterior check (expira_en > creada_en),
  constraint pvs_completada_con_fecha check (estado <> 'completada' or completada_en is not null)
);

-- Una solicitud VIVA por (flota, portal): pedir otra mientras hay una en curso no
-- abre una segunda puerta; la pantalla ofrece cancelar la vigente.
create unique index if not exists pvs_viva_unica_uidx
  on public.portal_vinculacion_solicitud (tenant_id, comercio)
  where estado in ('pendiente', 'reclamada');
-- El reclamo busca por hash de código entre las vivas.
create unique index if not exists pvs_codigo_hash_uidx
  on public.portal_vinculacion_solicitud (codigo_hash);
create index if not exists pvs_tenant_idx
  on public.portal_vinculacion_solicitud (tenant_id, creada_en desc);

comment on table public.portal_vinculacion_solicitud is
  '0540 (agente 6): solicitud de vinculación asistida de un portal. Código de un solo uso (solo su hash), ciclo pendiente→reclamada→completada|fallida|expirada|cancelada, una viva por (flota, portal). Escritor: lib/likida/autofactura/vinculacion_remota.ts vía RPC.';

alter table public.portal_vinculacion_solicitud enable row level security;
revoke all on table public.portal_vinculacion_solicitud from public, anon, authenticated;
grant select, insert, update, delete on table public.portal_vinculacion_solicitud to service_role;

-- ── Crear: caduca las vencidas de ESA flota y portal, y abre la nueva ──────
create or replace function public.crear_vinculacion_portal(
  p_tenant uuid, p_comercio text, p_user uuid, p_hash text, p_ttl_min integer default 15
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_rol text;
  v_activo boolean;
  v_id uuid;
begin
  if p_ttl_min is null or p_ttl_min < 1 or p_ttl_min > 60 then
    return jsonb_build_object('ok', false, 'motivo', 'la vigencia debe estar entre 1 y 60 minutos');
  end if;
  select rol, activo into v_rol, v_activo from app_user where id = p_user and tenant_id = p_tenant;
  if not found or not v_activo then
    return jsonb_build_object('ok', false, 'motivo', 'el usuario no es de esta flota o está dado de baja');
  end if;
  if v_rol not in ('flota_admin', 'contador', 'encargado') then
    return jsonb_build_object('ok', false, 'motivo', 'tu rol no puede vincular portales de la flota');
  end if;

  -- Una viva vencida deja de serlo antes de comprobar si ya hay otra.
  update portal_vinculacion_solicitud
     set estado = 'expirada', cerrada_en = now(), motivo = coalesce(motivo, 'venció sin completarse')
   where tenant_id = p_tenant and comercio = p_comercio
     and estado in ('pendiente', 'reclamada') and expira_en <= now();

  begin
    insert into portal_vinculacion_solicitud (tenant_id, comercio, creada_por, codigo_hash, expira_en)
    values (p_tenant, p_comercio, p_user, p_hash, now() + make_interval(mins => p_ttl_min))
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'motivo', 'ya hay una vinculación en curso para este portal: termínala o cancélala antes de pedir otra');
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
comment on function public.crear_vinculacion_portal(uuid, text, uuid, text, integer) is
  '0540: abre una solicitud de vinculación (solo hash del código). Falla si ya hay una viva para (flota, portal) o el rol no administra portales.';

-- ── Reclamar: la máquina con pantalla presenta el código (su hash) ─────────
create or replace function public.reclamar_vinculacion_portal(p_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  f portal_vinculacion_solicitud%rowtype;
begin
  select * into f from portal_vinculacion_solicitud where codigo_hash = p_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'código desconocido');
  end if;
  if f.estado in ('pendiente', 'reclamada') and f.expira_en <= now() then
    update portal_vinculacion_solicitud set estado = 'expirada', cerrada_en = now(), motivo = 'venció sin completarse' where id = f.id;
    return jsonb_build_object('ok', false, 'motivo', 'el código venció: pide otro en el panel');
  end if;
  if f.estado <> 'pendiente' then
    -- Un código SOLO sirve una vez: reclamada/completada/cancelada ya no se reclama.
    return jsonb_build_object('ok', false, 'motivo', 'el código ya se usó o se canceló');
  end if;
  update portal_vinculacion_solicitud set estado = 'reclamada', reclamada_en = now() where id = f.id;
  return jsonb_build_object('ok', true, 'id', f.id, 'tenant_id', f.tenant_id, 'comercio', f.comercio, 'expira_en', f.expira_en);
end;
$$;
comment on function public.reclamar_vinculacion_portal(text) is
  '0540: reclamo atómico (for update) de un código de un solo uso. pendiente→reclamada; vencido→expirada; reutilizado→rechazado.';

-- ── Cerrar: completada | fallida, solo desde reclamada y no vencida ────────
create or replace function public.cerrar_vinculacion_portal(
  p_id uuid, p_tenant uuid, p_estado text, p_cookies integer default null, p_motivo text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  f portal_vinculacion_solicitud%rowtype;
begin
  if p_estado not in ('completada', 'fallida') then
    return jsonb_build_object('ok', false, 'motivo', 'estado de cierre inválido');
  end if;
  select * into f from portal_vinculacion_solicitud where id = p_id and tenant_id = p_tenant for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'solicitud inexistente en esta flota');
  end if;
  if f.estado <> 'reclamada' then
    return jsonb_build_object('ok', false, 'motivo', 'la solicitud no está en curso (ya se cerró, venció o se canceló)');
  end if;
  if p_estado = 'completada' and f.expira_en <= now() then
    update portal_vinculacion_solicitud set estado = 'expirada', cerrada_en = now(), motivo = 'venció antes de completarse' where id = f.id;
    return jsonb_build_object('ok', false, 'motivo', 'la solicitud venció antes de completarse');
  end if;
  update portal_vinculacion_solicitud
     set estado = p_estado, cerrada_en = now(),
         completada_en = case when p_estado = 'completada' then now() else null end,
         cookies = p_cookies, motivo = left(p_motivo, 400)
   where id = f.id;
  return jsonb_build_object('ok', true);
end;
$$;
comment on function public.cerrar_vinculacion_portal(uuid, uuid, text, integer, text) is
  '0540: cierra una solicitud reclamada como completada|fallida. No cierra una vencida/cancelada.';

-- ── Cancelar (la pantalla) ─────────────────────────────────────────────────
create or replace function public.cancelar_vinculacion_portal(p_tenant uuid, p_comercio text)
returns integer
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare n integer;
begin
  update portal_vinculacion_solicitud
     set estado = 'cancelada', cerrada_en = now(), motivo = 'cancelada desde el panel'
   where tenant_id = p_tenant and comercio = p_comercio and estado in ('pendiente', 'reclamada');
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── Retención ──────────────────────────────────────────────────────────────
create or replace function public.purgar_vinculacion_portal(p_dias integer default 90)
returns integer
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare n integer;
begin
  if p_dias is null or p_dias < 7 then
    raise exception 'la retención mínima de solicitudes de vinculación es de 7 días';
  end if;
  -- Primero se cierran las vivas vencidas (un cron que no corrió no las deja vivas para siempre).
  update portal_vinculacion_solicitud set estado = 'expirada', cerrada_en = now(), motivo = coalesce(motivo, 'venció sin completarse')
   where estado in ('pendiente', 'reclamada') and expira_en <= now();
  delete from portal_vinculacion_solicitud
   where estado in ('completada', 'fallida', 'expirada', 'cancelada') and coalesce(cerrada_en, creada_en) < now() - make_interval(days => p_dias);
  get diagnostics n = row_count;
  return n;
end;
$$;
comment on function public.purgar_vinculacion_portal(integer) is
  '0540: retención (default 90 días) de solicitudes cerradas; cierra antes las vivas vencidas. Lo llama /api/cron/purgar.';

revoke all on function public.crear_vinculacion_portal(uuid, text, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.reclamar_vinculacion_portal(text) from public, anon, authenticated;
revoke all on function public.cerrar_vinculacion_portal(uuid, uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.cancelar_vinculacion_portal(uuid, text) from public, anon, authenticated;
revoke all on function public.purgar_vinculacion_portal(integer) from public, anon, authenticated;
grant execute on function public.crear_vinculacion_portal(uuid, text, uuid, text, integer) to service_role;
grant execute on function public.reclamar_vinculacion_portal(text) to service_role;
grant execute on function public.cerrar_vinculacion_portal(uuid, uuid, text, integer, text) to service_role;
grant execute on function public.cancelar_vinculacion_portal(uuid, text) to service_role;
grant execute on function public.purgar_vinculacion_portal(integer) to service_role;

commit;
