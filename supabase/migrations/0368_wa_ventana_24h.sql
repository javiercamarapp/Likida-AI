-- 0368 — Ventana de servicio de 24 h de WhatsApp, por contacto, y el registro
-- de por qué cada aviso salió como texto, botones o plantilla.
--
-- POR QUÉ. Likida INICIA muchas conversaciones (avisos al jefe, cobranza,
-- escalación, «Mis reglas»). WhatsApp solo entrega texto libre/botones dentro de
-- las 24 h posteriores al ÚLTIMO mensaje DEL USUARIO; fuera de esa ventana solo
-- entra una plantilla aprobada. Hasta hoy no existía registro de ese último
-- mensaje: cada llamador mandaba texto, esperaba el 131047 de Meta y recién
-- entonces probaba la plantilla (o, como «Mis reglas», no la probaba nunca).
--
-- Esta tabla guarda SOLO el instante del último mensaje entrante por teléfono
-- (el webhook la actualiza con la hora de Meta). Es una caché de una verdad que
-- es de Meta: si falta o está vieja, el selector `enviarConFallback` degrada a
-- «probar texto y caer a plantilla», nunca a «no mandar».
--
-- Un solo número de WhatsApp atiende a TODAS las flotas, y la ventana es del PAR
-- (número de Likida ↔ teléfono), no de una flota: por eso no lleva tenant_id.
-- Solo service_role la toca (RLS activada, sin políticas).

-- ── 1. Normalización del teléfono (misma regla que `destinatarioWhatsApp`) ──
-- Meta entrega el `wa_id` mexicano con el «1» (521 + 10 dígitos) y rechaza los
-- salientes que lo llevan: se guarda SIEMPRE en la forma 52 + 10 dígitos para
-- que entrante y saliente coincidan.
create or replace function public.wa_normalizar_telefono(p_telefono text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g') ~ '^521[0-9]{10}$'
      then '52' || substr(regexp_replace(p_telefono, '[^0-9]', '', 'g'), 4)
    else regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g')
  end
$$;

-- ── 2. La ventana por contacto ──────────────────────────────────────────────
create table if not exists public.wa_ventana_contacto (
  telefono          text primary key
    constraint wa_ventana_telefono_forma check (telefono ~ '^[1-9][0-9]{7,14}$'),
  ultimo_entrante_en timestamptz not null,
  ultimo_wamid      text,
  actualizado_en    timestamptz not null default now()
);
alter table public.wa_ventana_contacto enable row level security;
revoke all on table public.wa_ventana_contacto from public, anon, authenticated;
grant select, insert, update on table public.wa_ventana_contacto to service_role;
comment on table public.wa_ventana_contacto is
  '0368: instante del último mensaje ENTRANTE por teléfono (forma 52+10). Caché de la ventana de 24 h de Meta; la actualiza el webhook con la hora de Meta. Solo service_role.';

-- Registra un mensaje entrante. IDEMPOTENTE y a prueba de desorden: Meta
-- reentrega y puede entregar fuera de orden, así que la hora solo AVANZA
-- (greatest) y el mismo wamid repetido no cambia nada. Una hora futura no puede
-- alargar la ventana: se recorta al reloj de la base.
create or replace function public.registrar_entrante_wa(
  p_telefono text, p_en timestamptz, p_wamid text default null
) returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tel text := public.wa_normalizar_telefono(p_telefono);
  v_en  timestamptz := least(coalesce(p_en, clock_timestamp()), clock_timestamp());
  v_res timestamptz;
begin
  if v_tel !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'teléfono inválido para la ventana de WhatsApp';
  end if;
  insert into public.wa_ventana_contacto as w (telefono, ultimo_entrante_en, ultimo_wamid, actualizado_en)
  values (v_tel, v_en, left(nullif(btrim(p_wamid), ''), 500), clock_timestamp())
  on conflict (telefono) do update set
    ultimo_wamid = case when excluded.ultimo_entrante_en > w.ultimo_entrante_en
                        then excluded.ultimo_wamid else w.ultimo_wamid end,
    ultimo_entrante_en = greatest(w.ultimo_entrante_en, excluded.ultimo_entrante_en),
    actualizado_en = clock_timestamp()
  returning w.ultimo_entrante_en into v_res;
  return v_res;
end $$;

-- Tres estados, porque «no sé» no es «cerrada»: un contacto sin fila puede tener
-- la ventana abierta (escribió antes de que existiera esta tabla).
create or replace function public.ventana_estado_wa(
  p_telefono text, p_ahora timestamptz default now()
) returns table (estado text, ultimo_entrante_en timestamptz, expira_en timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select
    case when w.telefono is null then 'desconocida'
         when w.ultimo_entrante_en > p_ahora - interval '24 hours' then 'abierta'
         else 'cerrada' end,
    w.ultimo_entrante_en,
    w.ultimo_entrante_en + interval '24 hours'
  from (select 1) base
  left join public.wa_ventana_contacto w on w.telefono = public.wa_normalizar_telefono(p_telefono)
$$;

-- La forma booleana pedida: solo TRUE si hay evidencia de ventana abierta.
create or replace function public.ventana_abierta(
  p_telefono text, p_ahora timestamptz default now()
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select v.estado = 'abierta' from public.ventana_estado_wa(p_telefono, p_ahora) v), false)
$$;

revoke all on function public.wa_normalizar_telefono(text) from public, anon, authenticated;
revoke all on function public.registrar_entrante_wa(text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.ventana_estado_wa(text, timestamptz) from public, anon, authenticated;
revoke all on function public.ventana_abierta(text, timestamptz) from public, anon, authenticated;
grant execute on function public.wa_normalizar_telefono(text) to service_role;
grant execute on function public.registrar_entrante_wa(text, timestamptz, text) to service_role;
grant execute on function public.ventana_estado_wa(text, timestamptz) to service_role;
grant execute on function public.ventana_abierta(text, timestamptz) to service_role;

-- Retención: la ventana vive 24 h, así que una fila de más de unos días no sirve
-- para nada y es un teléfono guardado de más (también el de remitentes que no son
-- choferes). Mínimo 2 días para no tocar una ventana viva. NO hay cron que la
-- llame todavía: quien programe el mantenimiento la invoca (ver BLOQUEOS/pendientes).
create or replace function public.purgar_wa_ventana_contacto(
  p_dias integer default 7, p_limite integer default 5000
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  if p_dias < 2 or p_limite < 1 then raise exception 'parámetros de purga inválidos'; end if;
  with viejas as (
    select telefono from public.wa_ventana_contacto
     where ultimo_entrante_en < now() - make_interval(days => p_dias)
     order by ultimo_entrante_en limit p_limite
  )
  delete from public.wa_ventana_contacto w using viejas v where w.telefono = v.telefono;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.purgar_wa_ventana_contacto(integer, integer) from public, anon, authenticated;
grant execute on function public.purgar_wa_ventana_contacto(integer, integer) to service_role;
grant delete on table public.wa_ventana_contacto to service_role;

-- ── 3. El motivo de cada decisión de envío ──────────────────────────────────
-- Una fila por aviso proactivo: por qué canal salió y por qué. El teléfono NO se
-- guarda (solo los últimos 4 dígitos, igual que los logs).
create table if not exists public.wa_envio_registro (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenant(id) on delete cascade,
  contexto      text not null check (length(contexto) between 1 and 120),
  contacto_ult4 text check (contacto_ult4 ~ '^[0-9]{0,4}$'),
  ventana       text not null check (ventana in ('abierta', 'cerrada', 'desconocida')),
  canal         text not null check (canal in ('texto', 'botones', 'plantilla', 'ninguno')),
  motivo        text not null check (length(motivo) between 1 and 80),
  plantilla     text,
  ok            boolean not null,
  codigo_meta   integer,
  creado_en     timestamptz not null default now()
);
create index if not exists wa_envio_registro_tenant_idx
  on public.wa_envio_registro (tenant_id, creado_en desc);
create index if not exists wa_envio_registro_creado_idx
  on public.wa_envio_registro (creado_en);
alter table public.wa_envio_registro enable row level security;
drop policy if exists tenant_data on public.wa_envio_registro;
create policy tenant_data on public.wa_envio_registro for select
  using (is_superadmin() or tenant_id = any(get_user_tenant_ids()));
revoke all on table public.wa_envio_registro from public, anon, authenticated;
grant select on table public.wa_envio_registro to authenticated;
grant select, insert, delete on table public.wa_envio_registro to service_role;
comment on table public.wa_envio_registro is
  '0368: por qué cada aviso proactivo salió como texto, botones o plantilla (o no salió). Sin teléfono completo. Retención: purgar_wa_envio_registro.';

-- Retención acotada (la corre quien programe el mantenimiento; no hay cron nuevo).
create or replace function public.purgar_wa_envio_registro(
  p_dias integer default 90, p_limite integer default 5000
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  if p_dias < 7 or p_limite < 1 then raise exception 'parámetros de purga inválidos'; end if;
  with viejas as (
    select id from public.wa_envio_registro
     where creado_en < now() - make_interval(days => p_dias)
     order by creado_en limit p_limite
  )
  delete from public.wa_envio_registro r using viejas v where r.id = v.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.purgar_wa_envio_registro(integer, integer) from public, anon, authenticated;
grant execute on function public.purgar_wa_envio_registro(integer, integer) to service_role;
