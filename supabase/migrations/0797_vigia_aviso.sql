-- ═══════════════════════════════════════════════════════════════════════════
-- 0797 — Vigía: bandeja de avisos de viaje (outbox) y su configuración (Agente 4).
--
-- Lo que pidió el cliente (levantamiento 747a3730 ~00:21 y c90787e0 ~21:33): dejar de mandar a mano, servicio por servicio,
-- caja, placas, unidad y operador. El sistema arma el aviso a partir del programa de despacho (0795) y los datos del viaje (0796).
-- Esta migración pone el lugar donde esos avisos VIVEN antes y después de salir; no manda nada por sí sola.
--
--   · `vigia_aviso_config`  una fila por flota. SIN FILA = APAGADO (falla cerrado). `habilitado` nace en false; el modo nace en
--                           'confirmar' (un humano aprueba cada aviso) y el canal en 'ejecutivo_copia' (la copia va al ejecutivo,
--                           no al cliente). `autonomo_min_confirmaciones` es cuántos avisos confirmados a mano hacen falta
--                           antes de que el modo 'autonomo' pueda activarse (lo hace valer el código, T-A4-20).
--   · `vigia_aviso`         un aviso por (flota, fila del programa, huella). La huella resume el contenido que el cliente
--                           recibiría; el MISMO contenido de la MISMA fila no se encola dos veces (idempotencia). Si la fila
--                           cambia, hay otra huella y otra versión; la versión enviada NUNCA se edita (un trigger lo impide).
--
--   vigia_aviso.estado   borrador → pendiente_confirmacion → aprobado → enviado | fallido
--                        sin_destinatario (no se pudo resolver a quién mandarlo: queda visible, no se pierde)
--                        descartado | reemplazado (por una versión posterior) — terminales, igual que enviado.
--                        Las transiciones válidas las hace cumplir el trigger `vigia_aviso_transicion`.
--   vigia_aviso.reclamo_token / reclamo_expira_en   quién lleva el envío y hasta cuándo es suyo (arriendo, patrón de 0674).
--
--   vigia_aviso_reclamar  → (id, token) si ESTA llamada ganó el aviso (aprobado, sin dueño o con arriendo vencido, y la flota
--                           lo tiene habilitado); ninguna fila si perdió. Dos reclamos simultáneos: gana uno solo.
--   vigia_aviso_cerrar    → deja el resultado (enviado | fallido) solo con el token vigente; false si el arriendo ya no era suyo.
--
-- Todo lo escribe el servidor (service_role); la lectura es para quien atiende clientes (`ve_atencion_cliente()`, 0400),
-- como 0795/0796. El código que lea estas tablas debe tolerar su ausencia (42P01 / PGRST205 = «aún no aplicada»).
--
-- DATOS PERSONALES. `datos` guarda solo QUÉ campos entraron al aviso y de dónde salió cada uno, no teléfonos ni licencias del
-- operador; `error` guarda un código o una frase corta (≤ 200), nunca el cuerpo de una respuesta ajena. No se redefine ninguna
-- función existente del Vigía: todo lo nuevo lleva el prefijo `vigia_aviso_`.
--
-- ROLLBACK (en orden inverso; ninguna otra migración depende de estos objetos):
--   drop function if exists public.vigia_aviso_cerrar(uuid, uuid, uuid, text, text, timestamptz);
--   drop function if exists public.vigia_aviso_reclamar(uuid, uuid, integer, timestamptz);
--   drop table if exists public.vigia_aviso;          -- se lleva su trigger
--   drop function if exists public.vigia_aviso_transicion();
--   drop table if exists public.vigia_aviso_config;
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.vigia_aviso_config (
  tenant_id                  uuid primary key references public.tenant(id) on delete cascade,
  habilitado                 boolean not null default false,
  modo                       text not null default 'confirmar',
  canal_default              text not null default 'ejecutivo_copia',
  ccp_listos                 text[] not null default '{}',
  exigir_transito            boolean not null default false,
  secciones                  text[] not null default '{}',
  horas_antes_cita           integer,
  ventana_envio              jsonb not null default '{}'::jsonb,
  max_reenvios               integer not null default 3,
  debounce_min               integer not null default 10,
  autonomo_min_confirmaciones integer not null default 5,
  zona                       text not null default 'America/Mexico_City',
  actualizado_por            uuid,
  actualizado_en             timestamptz not null default now(),
  constraint vigia_aviso_config_modo check (modo in ('confirmar', 'autonomo')),
  constraint vigia_aviso_config_canal check (canal_default in ('ejecutivo_copia', 'cliente_1a1')),
  constraint vigia_aviso_config_horas_antes check (horas_antes_cita is null or horas_antes_cita between 0 and 72),
  constraint vigia_aviso_config_ventana_forma check (
    jsonb_typeof(ventana_envio) in ('object', 'array') and octet_length(ventana_envio::text) <= 2048),
  constraint vigia_aviso_config_max_reenvios check (max_reenvios between 0 and 20),
  constraint vigia_aviso_config_debounce check (debounce_min between 0 and 1440),
  constraint vigia_aviso_config_autonomo_min check (autonomo_min_confirmaciones between 0 and 1000),
  constraint vigia_aviso_config_zona check (char_length(btrim(zona)) between 1 and 64),
  constraint vigia_aviso_config_listas check (
    cardinality(ccp_listos) <= 20 and cardinality(secciones) <= 50)
);
comment on table public.vigia_aviso_config is
  '0797: configuración del aviso de viaje por flota. SIN FILA = APAGADO (falla cerrado); habilitado nace en false, modo en confirmar y canal en ejecutivo_copia.';
comment on column public.vigia_aviso_config.habilitado is '0797: false (default) = no se genera ni se envía nada para la flota.';
comment on column public.vigia_aviso_config.modo is '0797: confirmar = un humano aprueba cada aviso (default); autonomo = sale solo (exige autonomo_min_confirmaciones confirmados a mano, lo hace valer el código).';
comment on column public.vigia_aviso_config.canal_default is '0797: ejecutivo_copia = la copia va al ejecutivo (default); cliente_1a1 = mensaje directo al contacto del cliente.';
comment on column public.vigia_aviso_config.ccp_listos is '0797: estatus de la carta porte que cuentan como «listo» para avisar (p. ej. LISTO, DESPACHADO).';
comment on column public.vigia_aviso_config.exigir_transito is '0797: true = además de la caja y la unidad, el estatus de tránsito debe estar asignado.';
comment on column public.vigia_aviso_config.secciones is '0797: secciones del programa (tipos de servicio) que sí generan aviso; vacío = todas.';
comment on column public.vigia_aviso_config.horas_antes_cita is '0797: cuántas horas antes de la cita se genera el aviso; null = en cuanto esté listo.';
comment on column public.vigia_aviso_config.ventana_envio is '0797: horas del día en que se permite enviar (estructura que define el código); {} = sin restricción.';
comment on column public.vigia_aviso_config.max_reenvios is '0797: tope de reenvíos por fila; el excedente queda en el tablero con alerta interna.';
comment on column public.vigia_aviso_config.debounce_min is '0797: minutos de calma que se esperan tras un cambio antes de reenviar.';
comment on column public.vigia_aviso_config.autonomo_min_confirmaciones is '0797: avisos confirmados a mano que hacen falta antes de permitir el modo autónomo.';
comment on column public.vigia_aviso_config.zona is '0797: zona horaria IANA con la que se interpretan las citas y la ventana de envío.';

create table if not exists public.vigia_aviso (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  fila_id           uuid not null,
  cliente_id        uuid,
  version           integer not null default 1,
  huella            text not null,
  estado            text not null default 'borrador',
  canal             text not null default 'ejecutivo_copia',
  texto             text not null,
  datos             jsonb not null default '{}'::jsonb,
  motivo            text,
  creado_en         timestamptz not null default now(),
  aprobado_por      uuid,
  aprobado_en       timestamptz,
  enviado_en        timestamptz,
  error             text,
  reclamo_token     uuid,
  reclamo_expira_en timestamptz,
  intentos          integer not null default 0,
  actualizado_en    timestamptz not null default now(),
  constraint vigia_aviso_id_tenant_key unique (id, tenant_id),
  constraint vigia_aviso_fila_fkey
    foreign key (fila_id, tenant_id) references public.programa_despacho_fila (id, tenant_id) on delete cascade,
  constraint vigia_aviso_cliente_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete set null (cliente_id),
  constraint vigia_aviso_idempotencia unique (tenant_id, fila_id, huella),
  constraint vigia_aviso_version check (version >= 1),
  constraint vigia_aviso_huella_forma check (huella ~ '^[0-9a-f]{16,64}$'),
  constraint vigia_aviso_estado check (estado in (
    'borrador', 'pendiente_confirmacion', 'aprobado', 'enviado', 'fallido', 'descartado', 'reemplazado', 'sin_destinatario')),
  constraint vigia_aviso_canal check (canal in ('ejecutivo_copia', 'cliente_1a1')),
  constraint vigia_aviso_texto_forma check (char_length(texto) between 1 and 4096),
  constraint vigia_aviso_datos_forma check (jsonb_typeof(datos) = 'object' and octet_length(datos::text) <= 16384),
  constraint vigia_aviso_motivo_forma check (motivo is null or char_length(motivo) <= 200),
  constraint vigia_aviso_error_forma check (error is null or char_length(error) <= 200),
  constraint vigia_aviso_intentos check (intentos >= 0),
  constraint vigia_aviso_aprobado_coherente check (estado not in ('aprobado', 'enviado') or aprobado_en is not null),
  constraint vigia_aviso_enviado_coherente check ((estado = 'enviado') = (enviado_en is not null)),
  constraint vigia_aviso_reclamo_coherente check (
    (reclamo_token is null) = (reclamo_expira_en is null) and (reclamo_token is null or estado = 'aprobado'))
);
create unique index if not exists vigia_aviso_version_uq on public.vigia_aviso (tenant_id, fila_id, version);
create index if not exists vigia_aviso_estado_idx on public.vigia_aviso (tenant_id, estado, creado_en desc);
create index if not exists vigia_aviso_fila_idx on public.vigia_aviso (tenant_id, fila_id);
comment on table public.vigia_aviso is
  '0797: bandeja de avisos de viaje. Único por (flota, fila del programa, huella): el mismo contenido de la misma fila no se encola dos veces. La versión enviada no se edita.';
comment on column public.vigia_aviso.fila_id is '0797: fila del programa de despacho (0795) de la que sale el aviso; borrar la fila borra el aviso.';
comment on column public.vigia_aviso.cliente_id is '0797: cliente destinatario; null si no se resolvió (estado sin_destinatario). Borrar al cliente deja el aviso sin cliente.';
comment on column public.vigia_aviso.version is '0797: 1 para el primer aviso de la fila; cada reenvío por cambio suma 1.';
comment on column public.vigia_aviso.huella is '0797: huella hexadecimal del contenido del aviso (la calcula el código); con fila_id y tenant_id da la idempotencia.';
comment on column public.vigia_aviso.estado is '0797: borrador, pendiente_confirmacion, aprobado, enviado, fallido, descartado, reemplazado o sin_destinatario; transiciones en vigia_aviso_transicion().';
comment on column public.vigia_aviso.canal is '0797: ejecutivo_copia (la copia va al ejecutivo) o cliente_1a1 (mensaje directo al contacto del cliente).';
comment on column public.vigia_aviso.datos is '0797: qué campos entraron al aviso y su fuente (objeto). Sin teléfonos ni licencias del operador.';
comment on column public.vigia_aviso.motivo is '0797: por qué se creó o cambió el aviso (frase corta).';
comment on column public.vigia_aviso.error is '0797: código o frase corta (≤ 200) del último fallo de envío.';
comment on column public.vigia_aviso.reclamo_token is '0797: dueño del envío en curso; solo existe mientras el aviso está aprobado.';
comment on column public.vigia_aviso.reclamo_expira_en is '0797: hasta cuándo es suyo el envío; vencido, otra corrida lo retoma.';
comment on column public.vigia_aviso.intentos is '0797: cuántas veces se reclamó para enviar.';

-- Transiciones válidas del estado + lo que NUNCA cambia. Un aviso enviado, descartado o reemplazado es historia: no se toca.
create or replace function public.vigia_aviso_transicion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.fila_id is distinct from old.fila_id
     or new.huella is distinct from old.huella or new.version is distinct from old.version then
    raise exception 'vigia_aviso: tenant, fila, huella y versión no se editan (cree otra versión)' using errcode = '23514';
  end if;
  if old.estado in ('enviado', 'descartado', 'reemplazado') then
    -- única excepción: borrar al cliente suelta el vínculo (ON DELETE SET NULL de la llave foránea) sin tocar el contenido
    if new.cliente_id is null and old.cliente_id is not null and to_jsonb(new) - 'cliente_id' = to_jsonb(old) - 'cliente_id' then
      return new;
    end if;
    raise exception 'vigia_aviso: un aviso % es historia y no se edita', old.estado using errcode = '23514';
  end if;
  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'borrador'               and new.estado in ('pendiente_confirmacion', 'aprobado', 'sin_destinatario', 'descartado', 'reemplazado'))
      or (old.estado = 'pendiente_confirmacion' and new.estado in ('aprobado', 'sin_destinatario', 'descartado', 'reemplazado'))
      or (old.estado = 'sin_destinatario'     and new.estado in ('pendiente_confirmacion', 'descartado', 'reemplazado'))
      or (old.estado = 'aprobado'             and new.estado in ('enviado', 'fallido', 'descartado', 'reemplazado'))
      or (old.estado = 'fallido'              and new.estado in ('aprobado', 'descartado', 'reemplazado'))
    ) then
      raise exception 'vigia_aviso: transición % → % no válida', old.estado, new.estado using errcode = '23514';
    end if;
  end if;
  -- el arriendo solo vive mientras el aviso está aprobado
  if new.estado <> 'aprobado' then
    new.reclamo_token := null;
    new.reclamo_expira_en := null;
  end if;
  new.actualizado_en := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.vigia_aviso_transicion() from public, anon, authenticated;

drop trigger if exists vigia_aviso_transicion_trg on public.vigia_aviso;
create trigger vigia_aviso_transicion_trg
  before update on public.vigia_aviso
  for each row execute function public.vigia_aviso_transicion();

alter table public.vigia_aviso_config enable row level security;
alter table public.vigia_aviso        enable row level security;
drop policy if exists tenant_lee on public.vigia_aviso_config;
create policy tenant_lee on public.vigia_aviso_config for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.vigia_aviso;
create policy tenant_lee on public.vigia_aviso for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
revoke all on table public.vigia_aviso_config, public.vigia_aviso from public, anon, authenticated;
grant select on table public.vigia_aviso_config, public.vigia_aviso to authenticated;
grant select, insert, update, delete on table public.vigia_aviso_config, public.vigia_aviso to service_role;

-- Reclamar = ganar el envío. Solo un aviso aprobado, de una flota con la función habilitada (sin config = apagado),
-- sin dueño o con el arriendo vencido. El UPDATE toma el candado de la fila: el segundo reclamo simultáneo reevalúa el
-- WHERE con el token ya puesto y no gana nada.
create or replace function public.vigia_aviso_reclamar(
  p_tenant uuid, p_id uuid, p_lease_segundos integer default 300, p_ahora timestamptz default clock_timestamp()
) returns table (o_id uuid, o_token uuid)
language plpgsql security definer set search_path = ''
as $$
declare v_token uuid := gen_random_uuid();
begin
  if p_lease_segundos < 30 or p_lease_segundos > 900 then raise exception 'lease fuera de 30..900' using errcode = '22023'; end if;
  return query
  update public.vigia_aviso as a
     set reclamo_token = v_token, reclamo_expira_en = p_ahora + make_interval(secs => p_lease_segundos),
         intentos = a.intentos + 1
   where a.tenant_id = p_tenant and a.id = p_id and a.estado = 'aprobado'
     and (a.reclamo_token is null or a.reclamo_expira_en <= p_ahora)
     and exists (select 1 from public.vigia_aviso_config c where c.tenant_id = a.tenant_id and c.habilitado)
  returning a.id, v_token;
end;
$$;
revoke all on function public.vigia_aviso_reclamar(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.vigia_aviso_reclamar(uuid, uuid, integer, timestamptz) to service_role;

-- Cerrar = dejar el resultado del envío, solo con el token vigente. false si el arriendo ya era de otro.
create or replace function public.vigia_aviso_cerrar(
  p_tenant uuid, p_id uuid, p_token uuid, p_estado text, p_error text default null, p_ahora timestamptz default clock_timestamp()
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if p_estado not in ('enviado', 'fallido') then raise exception 'estado final no válido' using errcode = '22023'; end if;
  update public.vigia_aviso
     set estado = p_estado,
         enviado_en = case when p_estado = 'enviado' then p_ahora else null end,
         error = case when p_estado = 'fallido' then left(coalesce(p_error, 'sin detalle'), 200) else null end
   where tenant_id = p_tenant and id = p_id and estado = 'aprobado' and reclamo_token is not null and reclamo_token = p_token;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public.vigia_aviso_cerrar(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.vigia_aviso_cerrar(uuid, uuid, uuid, text, text, timestamptz) to service_role;
