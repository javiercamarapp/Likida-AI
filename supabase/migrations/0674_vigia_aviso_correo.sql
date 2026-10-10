-- ═══════════════════════════════════════════════════════════════════════════
-- 0674 — Vigía: RESPALDO POR CORREO del aviso de escalamiento, con reclamo atómico y arriendo.
--
-- Cuando el aviso por WhatsApp a un director no sale (plantilla sin aprobar, ventana de 24 h cerrada, rechazo de Meta) y la flota
-- encendió `respaldo_correo` (0673), el Vigía manda el MISMO aviso por correo. Un correo mandado dos veces enseña a ignorar las
-- alertas, así que el envío usa el mismo patrón que «Mis reglas» (0660): INSERTAR LA LLAVE ES RECLAMARLA.
--
--   vigia_aviso_correo.clave          «<clave del escalamiento>:<huella del correo>»: única por flota → un correo por persona y aviso.
--   vigia_aviso_correo.estado         enviando (alguien lo lleva) | enviado | sin_configurar (falta la llave de Resend o el dominio)
--                                     | rechazado (Resend lo rechazó) | red (no se supo: red o tope de tiempo).
--   vigia_aviso_correo.reclamo_token  quién lleva el envío;  reclamo_expira_en  hasta cuándo es suyo (vencido, otra corrida lo retoma).
--
--   vigia_correo_reclamar   → (id, token) si ESTA llamada ganó la llave (nueva, o `enviando` con arriendo vencido); ninguna fila si perdió;
--   vigia_correo_cerrar     → deja el resultado (solo con el token vigente); `false` si el arriendo ya no era suyo;
--   vigia_correos_vencidos  → los `enviando` con arriendo vencido (para que el cron los retome); los de más de 6 h se abandonan como `red`.
--
-- El estado final NO se reintenta solo: `sin_configurar` / `rechazado` / `red` quedan a la vista en el tablero para que la flota lo
-- atienda (un aviso viejo mandado horas después, cuando por fin haya llave, sería ruido). Los reintentos seguros de un arriendo
-- vencido viajan con la misma llave de idempotencia ante Resend.
--
-- Security definer, search_path vacío, solo service_role. Idempotente. El código funciona sin esta migración (el aviso por WhatsApp
-- sale como siempre y el respaldo registra que no pudo reclamarse).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.vigia_aviso_correo (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  conversacion_id   uuid not null,
  clave             text not null,
  nivel             smallint not null,
  director_id       uuid,
  destino_correo    text not null,
  datos             jsonb not null default '{}'::jsonb,
  estado            text not null default 'enviando',
  reclamo_token     uuid,
  reclamo_expira_en timestamptz,
  intentos          integer not null default 1,
  detalle           text,
  enviado_en        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint vigia_aviso_correo_id_tenant_key unique (id, tenant_id),
  constraint vigia_aviso_correo_clave_uq unique (tenant_id, clave),
  constraint vigia_aviso_correo_conversacion_tenant_fkey
    foreign key (conversacion_id, tenant_id) references public.vigia_conversacion (id, tenant_id) on delete cascade,
  constraint vigia_aviso_correo_director_tenant_fkey
    foreign key (director_id, tenant_id) references public.vigia_director (id, tenant_id) on delete set null (director_id),
  constraint vigia_aviso_correo_nivel check (nivel in (1, 2)),
  constraint vigia_aviso_correo_estado check (estado in ('enviando', 'enviado', 'sin_configurar', 'rechazado', 'red')),
  constraint vigia_aviso_correo_clave_largo check (char_length(clave) between 1 and 200),
  constraint vigia_aviso_correo_reclamo_coherente check (
    (estado = 'enviando' and reclamo_token is not null and reclamo_expira_en is not null)
    or (estado <> 'enviando' and reclamo_token is null and reclamo_expira_en is null)
  )
);
create index if not exists vigia_aviso_correo_tenant_idx on public.vigia_aviso_correo (tenant_id, created_at desc);
create index if not exists vigia_aviso_correo_vencidos_idx on public.vigia_aviso_correo (reclamo_expira_en) where estado = 'enviando';
comment on table public.vigia_aviso_correo is
  '0674: un correo de respaldo por (aviso de escalamiento, persona), con reclamo atómico y arriendo. Se borra con su conversación (retención).';

alter table public.vigia_aviso_correo enable row level security;
drop policy if exists tenant_lee on public.vigia_aviso_correo;
create policy tenant_lee on public.vigia_aviso_correo for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
revoke all on table public.vigia_aviso_correo from public, anon, authenticated;
grant select on table public.vigia_aviso_correo to authenticated;
grant select, insert, update, delete on table public.vigia_aviso_correo to service_role;

-- La bitácora gana los dos eventos del respaldo (lista ENTERA desde la 0482).
alter table public.vigia_evento drop constraint if exists vigia_evento_tipo_dominio;
alter table public.vigia_evento add constraint vigia_evento_tipo_dominio check (tipo in (
  'entrante', 'borrador', 'aprobado', 'rechazado', 'enviado', 'autoenviado', 'fallo_envio',
  'tomada', 'devuelta', 'cerrada', 'molestia', 'sin_respuesta', 'escalada', 'sin_destinatario',
  'optout', 'alta', 'baja_manual', 'suprimido', 'spam', 'sin_dato', 'inyeccion', 'otro_cliente',
  'adjunto_enviado', 'adjunto_pendiente', 'adjunto_fallo',
  'correo_enviado', 'correo_fallo'
));

create or replace function public.vigia_correo_reclamar(
  p_tenant uuid, p_conversacion uuid, p_clave text, p_nivel integer, p_director uuid, p_destino text, p_datos jsonb,
  p_lease_segundos integer default 300, p_ahora timestamptz default clock_timestamp()
) returns table (o_id uuid, o_token uuid)
language plpgsql security definer set search_path = ''
as $$
declare v_token uuid := gen_random_uuid();
begin
  if p_lease_segundos < 30 or p_lease_segundos > 900 then raise exception 'lease fuera de 30..900'; end if;
  return query
  insert into public.vigia_aviso_correo as a (tenant_id, conversacion_id, clave, nivel, director_id, destino_correo, datos, estado, reclamo_token, reclamo_expira_en)
  values (p_tenant, p_conversacion, p_clave, p_nivel, p_director, p_destino, coalesce(p_datos, '{}'::jsonb), 'enviando', v_token,
          p_ahora + make_interval(secs => p_lease_segundos))
  on conflict (tenant_id, clave) do update
     set reclamo_token = v_token, reclamo_expira_en = p_ahora + make_interval(secs => p_lease_segundos),
         intentos = a.intentos + 1, updated_at = p_ahora
   where a.estado = 'enviando' and a.reclamo_expira_en <= p_ahora
  returning a.id, v_token;
end;
$$;
revoke all on function public.vigia_correo_reclamar(uuid, uuid, text, integer, uuid, text, jsonb, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.vigia_correo_reclamar(uuid, uuid, text, integer, uuid, text, jsonb, integer, timestamptz) to service_role;

create or replace function public.vigia_correo_cerrar(
  p_tenant uuid, p_id uuid, p_token uuid, p_estado text, p_detalle text default null, p_ahora timestamptz default clock_timestamp()
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if p_estado not in ('enviado', 'sin_configurar', 'rechazado', 'red') then raise exception 'estado final no válido' using errcode = '22023'; end if;
  update public.vigia_aviso_correo
     set estado = p_estado, reclamo_token = null, reclamo_expira_en = null, detalle = left(p_detalle, 200), updated_at = p_ahora,
         enviado_en = case when p_estado = 'enviado' then p_ahora else null end
   where tenant_id = p_tenant and id = p_id and estado = 'enviando' and reclamo_token = p_token;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public.vigia_correo_cerrar(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.vigia_correo_cerrar(uuid, uuid, uuid, text, text, timestamptz) to service_role;

-- El barrido del cron: cruza flotas A PROPÓSITO. Los de más de 6 h sin cerrar se abandonan (`red`); los demás se devuelven para retomarlos.
create or replace function public.vigia_correos_vencidos(p_limite integer default 20, p_ahora timestamptz default clock_timestamp())
returns table (o_tenant uuid, o_id uuid, o_conversacion uuid, o_clave text, o_nivel integer, o_director uuid, o_destino text, o_datos jsonb)
language plpgsql security definer set search_path = ''
as $$
begin
  update public.vigia_aviso_correo
     set estado = 'red', reclamo_token = null, reclamo_expira_en = null, detalle = 'abandonado: el envío no se confirmó en 6 h', updated_at = p_ahora
   where estado = 'enviando' and reclamo_expira_en <= p_ahora and created_at < p_ahora - interval '6 hours';
  return query
  select a.tenant_id, a.id, a.conversacion_id, a.clave, a.nivel::integer, a.director_id, a.destino_correo, a.datos
    from public.vigia_aviso_correo a
   where a.estado = 'enviando' and a.reclamo_expira_en <= p_ahora
   order by a.reclamo_expira_en, a.id
   limit greatest(1, least(coalesce(p_limite, 20), 200));
end;
$$;
revoke all on function public.vigia_correos_vencidos(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.vigia_correos_vencidos(integer, timestamptz) to service_role;
