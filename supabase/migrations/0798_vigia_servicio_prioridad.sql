-- ═══════════════════════════════════════════════════════════════════════════
-- 0798 — Vigía: «servicio al cliente», turnos y festivos, prioridad, intención «datos_unidad» y alcance «solo avisar»
--        (Agente 4, bloque D).
--
-- Lo que pidió el cliente (levantamiento 0d824afa ~07:40 y c90787e0 ~18:14; 11-cross-check §A4): avisar a gerentes y directores
-- cuando un cliente no es contestado o está molesto, sobre todo de noche y en festivos, y priorizar. El alcance inicial es AVISAR
-- Y PRIORIZAR, NO CONTESTAR. Esta migración solo pone los lugares donde vivirán esos datos; no cambia el comportamiento por sí
-- sola (el código que los use llega en tareas posteriores y debe tolerar su ausencia, ver `sinMigrar`).
--
--   (a) `vigia_servicio_cliente`  a quién avisar como «servicio al cliente» (WhatsApp y/o correo). `cliente_id` null = para todos
--       los clientes de la flota. Único por flota y teléfono, y por flota y correo (sin importar mayúsculas). Tope de 10 por flota
--       como 0673. Altas, correcciones y bajas ATÓMICAS con `vigia_servicio_guardar` / `vigia_servicio_quitar` (solo service_role;
--       la pantalla valida el rol de dueño antes).
--   (b) `vigia_director.turno`    cuándo recibe la alerta esa persona: 'siempre' (default = como hoy), 'noche' o
--       'festivos_y_fin_de_semana'. `vigia_festivo` es el calendario de festivos por flota (uno por fecha).
--   (c) `vigia_conversacion.prioridad` y `vigia_mensaje.prioridad`   0 normal, 1 alta, 2 urgente. Default 0.
--   (d) El CHECK de intención de `vigia_mensaje` admite `datos_unidad`. Se reemplaza el CHECK de 0400 por uno con la lista
--       completa (los 9 valores de siempre + el nuevo).
--   (e) `vigia_config.solo_avisar`  true por omisión: el Vigía avisa y prioriza pero no contesta solo.
--
-- Solo se ALTERAN tablas con `add column if not exists` y se agregan objetos con prefijo nuevo. NO se redefine ninguna función de
-- 0673/0674/0677 (ni `vigia_director_guardar`): el turno de un director se escribe con UPDATE directo del servicio hasta que una
-- tarea posterior decida su RPC.
--
-- RLS y permisos como 0673: la flota lee lo suyo (quien atiende clientes: `ve_atencion_cliente()`); solo el servicio escribe.
-- Son datos de PERSONAL de la flota (no del cliente final) y se borran con la flota (cascade).
--
-- Idempotente. El código funciona contra una base SIN esta migración (degrada: sin lista de servicio al cliente se avisa al
-- gerente/director como hoy; la intención nueva cae a `otro`; sin prioridad todo es 0).
--
-- ROLLBACK (en orden inverso; ninguna otra migración depende de estos objetos). El CHECK de intención se restaura a la lista de
-- 0400; si ya hay mensajes con `datos_unidad`, primero hay que pasarlos a `otro` o el CHECK no se podrá volver a crear:
--   update public.vigia_mensaje set intencion = 'otro' where intencion = 'datos_unidad';
--   alter table public.vigia_mensaje drop constraint if exists vigia_mensaje_intencion_dominio;
--   alter table public.vigia_mensaje add constraint vigia_mensaje_intencion_dominio check (
--     intencion is null or intencion in ('ubicacion', 'eta', 'documentos', 'factura_pod', 'queja', 'pide_humano', 'baja', 'saludo', 'otro'));
--   alter table public.vigia_mensaje drop column if exists prioridad;
--   alter table public.vigia_conversacion drop column if exists prioridad;
--   alter table public.vigia_config drop column if exists solo_avisar;
--   drop table if exists public.vigia_festivo;
--   alter table public.vigia_director drop column if exists turno;      -- se lleva su CHECK
--   drop function if exists public.vigia_servicio_quitar(uuid, uuid);
--   drop function if exists public.vigia_servicio_guardar(uuid, uuid, uuid, text, text, text, boolean, uuid);
--   drop table if exists public.vigia_servicio_cliente;
-- ═══════════════════════════════════════════════════════════════════════════

-- ── (a) servicio al cliente ───────────────────────────────────────────────
create table if not exists public.vigia_servicio_cliente (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  cliente_id  uuid,
  nombre      text not null,
  telefono    text,
  correo      text,
  activo      boolean not null default true,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint vigia_servicio_cliente_id_tenant_key unique (id, tenant_id),
  constraint vigia_servicio_cliente_cliente_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint vigia_servicio_cliente_nombre check (char_length(btrim(nombre)) between 1 and 120),
  constraint vigia_servicio_cliente_telefono check (telefono is null or telefono ~ '^52[0-9]{10}$'),
  constraint vigia_servicio_cliente_correo check (correo is null or (char_length(correo) <= 254 and correo ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')),
  constraint vigia_servicio_cliente_algun_canal check (telefono is not null or correo is not null)
);
create unique index if not exists vigia_servicio_cliente_telefono_uq
  on public.vigia_servicio_cliente (tenant_id, telefono) where telefono is not null;
create unique index if not exists vigia_servicio_cliente_correo_uq
  on public.vigia_servicio_cliente (tenant_id, lower(correo)) where correo is not null;
create index if not exists vigia_servicio_cliente_tenant_idx
  on public.vigia_servicio_cliente (tenant_id, activo, cliente_id);
comment on table public.vigia_servicio_cliente is
  '0798: a quién avisa el Vigía como «servicio al cliente», por WhatsApp y/o correo. cliente_id null = para todos los clientes de la flota. Tope de 10 por flota.';

alter table public.vigia_servicio_cliente enable row level security;
drop policy if exists tenant_lee on public.vigia_servicio_cliente;
create policy tenant_lee on public.vigia_servicio_cliente for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
revoke all on table public.vigia_servicio_cliente from public, anon, authenticated;
grant select on table public.vigia_servicio_cliente to authenticated;
grant select, insert, update, delete on table public.vigia_servicio_cliente to service_role;

-- Alta (p_id null) o corrección (p_id de una fila DE ESA flota). Devuelve el id. 54000 = tope de 10 por flota.
create or replace function public.vigia_servicio_guardar(
  p_tenant uuid, p_id uuid, p_cliente uuid, p_nombre text, p_telefono text, p_correo text, p_activo boolean default true,
  p_usuario uuid default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_n integer;
begin
  if p_tenant is null then raise exception 'flota requerida' using errcode = '22023'; end if;
  if not exists (select 1 from public.tenant where id = p_tenant) then raise exception 'flota inexistente' using errcode = '22023'; end if;
  -- Un candado por flota: dos altas simultáneas no se saltan el tope.
  perform pg_advisory_xact_lock(hashtextextended('vigia_servicio:' || p_tenant::text, 0));
  if p_id is null then
    select count(*) into v_n from public.vigia_servicio_cliente where tenant_id = p_tenant;
    if v_n >= 10 then raise exception 'tope de 10 contactos de servicio al cliente por flota' using errcode = '54000'; end if;
    insert into public.vigia_servicio_cliente (tenant_id, cliente_id, nombre, telefono, correo, activo, updated_by)
    values (p_tenant, p_cliente, btrim(p_nombre), nullif(btrim(p_telefono), ''), nullif(btrim(p_correo), ''),
            coalesce(p_activo, true), p_usuario)
    returning id into v_id;
  else
    update public.vigia_servicio_cliente
       set cliente_id = p_cliente, nombre = btrim(p_nombre), telefono = nullif(btrim(p_telefono), ''),
           correo = nullif(btrim(p_correo), ''), activo = coalesce(p_activo, true), updated_by = p_usuario, updated_at = now()
     where id = p_id and tenant_id = p_tenant
     returning id into v_id;
    if v_id is null then raise exception 'contacto de servicio inexistente en esta flota' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.vigia_servicio_guardar(uuid, uuid, uuid, text, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.vigia_servicio_guardar(uuid, uuid, uuid, text, text, text, boolean, uuid) to service_role;

-- Baja. `false` = no existe o es de otra flota.
create or replace function public.vigia_servicio_quitar(p_tenant uuid, p_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  delete from public.vigia_servicio_cliente where id = p_id and tenant_id = p_tenant;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.vigia_servicio_quitar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vigia_servicio_quitar(uuid, uuid) to service_role;

-- ── (b) turnos de los directores y calendario de festivos ─────────────────
alter table public.vigia_director
  add column if not exists turno text not null default 'siempre'
  constraint vigia_director_turno check (turno in ('siempre', 'noche', 'festivos_y_fin_de_semana'));
comment on column public.vigia_director.turno is
  '0798: cuándo recibe la alerta esta persona. siempre (default, como hoy) | noche | festivos_y_fin_de_semana. El código decide el horario de «noche» con la zona de la flota.';

create table if not exists public.vigia_festivo (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  fecha       date not null,
  nombre      text not null,
  created_at  timestamptz not null default now(),
  constraint vigia_festivo_fecha_uq unique (tenant_id, fecha),
  constraint vigia_festivo_nombre check (char_length(btrim(nombre)) between 1 and 120)
);
comment on table public.vigia_festivo is
  '0798: días festivos de la flota (uno por fecha). Con ellos el Vigía decide quién recibe la alerta en turno festivos_y_fin_de_semana.';
alter table public.vigia_festivo enable row level security;
drop policy if exists tenant_lee on public.vigia_festivo;
create policy tenant_lee on public.vigia_festivo for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
revoke all on table public.vigia_festivo from public, anon, authenticated;
grant select on table public.vigia_festivo to authenticated;
grant select, insert, update, delete on table public.vigia_festivo to service_role;

-- ── (c) prioridad ─────────────────────────────────────────────────────────
alter table public.vigia_conversacion
  add column if not exists prioridad smallint not null default 0;
-- Las restricciones nuevas van `not valid` + validate (la columna recién creada vale 0 en todas las filas): no recorren la tabla bloqueando.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.vigia_conversacion'::regclass and conname = 'vigia_conversacion_prioridad_rango') then
    alter table public.vigia_conversacion add constraint vigia_conversacion_prioridad_rango check (prioridad between 0 and 2) not valid;
  end if;
end $$;
alter table public.vigia_conversacion validate constraint vigia_conversacion_prioridad_rango;
comment on column public.vigia_conversacion.prioridad is '0798: 0 normal, 1 alta, 2 urgente. La fija el código; 0 = sin priorizar.';
alter table public.vigia_mensaje
  add column if not exists prioridad smallint not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.vigia_mensaje'::regclass and conname = 'vigia_mensaje_prioridad_rango') then
    alter table public.vigia_mensaje add constraint vigia_mensaje_prioridad_rango check (prioridad between 0 and 2) not valid;
  end if;
end $$;
alter table public.vigia_mensaje validate constraint vigia_mensaje_prioridad_rango;
comment on column public.vigia_mensaje.prioridad is '0798: 0 normal, 1 alta, 2 urgente, del mensaje (p. ej. «urgente», «ASAP»).';

-- ── (d) intención «datos_unidad» ──────────────────────────────────────────
alter table public.vigia_mensaje drop constraint if exists vigia_mensaje_intencion_dominio;
alter table public.vigia_mensaje add constraint vigia_mensaje_intencion_dominio check (
  intencion is null or intencion in
    ('ubicacion', 'eta', 'documentos', 'factura_pod', 'queja', 'pide_humano', 'baja', 'saludo', 'otro', 'datos_unidad')
) not valid;
alter table public.vigia_mensaje validate constraint vigia_mensaje_intencion_dominio;

-- ── (e) alcance: solo avisar ──────────────────────────────────────────────
alter table public.vigia_config
  add column if not exists solo_avisar boolean not null default true;
comment on column public.vigia_config.solo_avisar is
  '0798: true (default) = el Vigía avisa y prioriza pero no contesta solo; el alcance inicial que pidió el cliente.';
