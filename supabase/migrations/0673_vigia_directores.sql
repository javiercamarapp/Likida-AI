-- ═══════════════════════════════════════════════════════════════════════════
-- 0673 — Vigía: LISTA DE DIRECTORES por nivel de escalamiento (y el interruptor del respaldo por correo).
--
-- Hasta aquí el escalamiento (0400) avisaba a UN teléfono por nivel: el gerente responsable del cliente (o el jefe de la flota) en
-- el nivel 1 y el primer `flota_admin` con teléfono en el nivel 2. Si esa persona no tenía la ventana de 24 h abierta y la
-- plantilla no estaba aprobada, el aviso no salía y nadie se enteraba. Esto reemplaza el destino único por una LISTA por nivel,
-- y cada persona puede tener teléfono (WhatsApp), correo o ambos:
--
--   nivel 1 = gerente de servicio;  nivel 2 = director o dueño.
--
--   · `vigia_director`: una fila por persona y nivel. Teléfono 52 + 10 dígitos o correo (al menos uno). Sin duplicar el mismo
--     teléfono ni el mismo correo (sin importar mayúsculas) dentro de un nivel. Tope de 10 por nivel y flota.
--   · `vigia_director_guardar` / `vigia_director_quitar`: alta, corrección y baja ATÓMICAS (el tope se cuenta bajo un candado por
--     flota, así que dos altas simultáneas no se lo saltan). Solo service_role: la pantalla valida el rol de dueño antes.
--   · `vigia_config.respaldo_correo`: APAGADO por omisión. Con él apagado el Vigía se comporta exactamente como antes.
--
-- RLS: la flota lee los suyos (quien ve el Vigía); solo el servicio escribe. Son datos de PERSONAL de la flota, no de clientes
-- finales; se borran con la flota (cascade).
--
-- Idempotente. El código funciona contra una base SIN esta migración (usa el destino único de siempre).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.vigia_config
  add column if not exists respaldo_correo boolean not null default false;
comment on column public.vigia_config.respaldo_correo is
  '0673: si el aviso de escalamiento por WhatsApp no sale (plantilla sin aprobar, ventana cerrada, rechazo) se manda por CORREO a quien tenga correo en la lista de directores. Apagado por omisión.';

create table if not exists public.vigia_director (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  nivel       smallint not null,
  nombre      text not null,
  telefono    text,
  correo      text,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint vigia_director_id_tenant_key unique (id, tenant_id),
  constraint vigia_director_nivel check (nivel in (1, 2)),
  constraint vigia_director_nombre check (char_length(btrim(nombre)) between 1 and 120),
  constraint vigia_director_telefono check (telefono is null or telefono ~ '^52[0-9]{10}$'),
  constraint vigia_director_correo check (correo is null or (char_length(correo) <= 254 and correo ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')),
  constraint vigia_director_algun_canal check (telefono is not null or correo is not null)
);
create unique index if not exists vigia_director_telefono_uq
  on public.vigia_director (tenant_id, nivel, telefono) where telefono is not null;
create unique index if not exists vigia_director_correo_uq
  on public.vigia_director (tenant_id, nivel, lower(correo)) where correo is not null;
create index if not exists vigia_director_tenant_idx
  on public.vigia_director (tenant_id, nivel, created_at);
comment on table public.vigia_director is
  '0673: a quién avisa el Vigía en cada nivel de escalamiento (1 gerente, 2 director o dueño), por WhatsApp y/o correo.';

alter table public.vigia_director enable row level security;
drop policy if exists tenant_lee on public.vigia_director;
create policy tenant_lee on public.vigia_director for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
revoke all on table public.vigia_director from public, anon, authenticated;
grant select on table public.vigia_director to authenticated;
grant select, insert, update, delete on table public.vigia_director to service_role;

-- Alta (p_id null) o corrección (p_id de una fila DE ESA flota). Devuelve el id. 54000 = tope de 10 por nivel.
create or replace function public.vigia_director_guardar(
  p_tenant uuid, p_id uuid, p_nivel integer, p_nombre text, p_telefono text, p_correo text, p_usuario uuid default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_n integer; v_nivel_previo smallint;
begin
  if p_tenant is null then raise exception 'flota requerida' using errcode = '22023'; end if;
  if not exists (select 1 from public.tenant where id = p_tenant) then raise exception 'flota inexistente' using errcode = '22023'; end if;
  -- Un candado por flota: dos altas simultáneas no se saltan el tope.
  perform pg_advisory_xact_lock(hashtextextended('vigia_director:' || p_tenant::text, 0));
  if p_id is null then
    select count(*) into v_n from public.vigia_director where tenant_id = p_tenant and nivel = p_nivel;
    if v_n >= 10 then raise exception 'tope de 10 directores por nivel y flota' using errcode = '54000'; end if;
    insert into public.vigia_director (tenant_id, nivel, nombre, telefono, correo, updated_by)
    values (p_tenant, p_nivel, btrim(p_nombre), nullif(btrim(p_telefono), ''), nullif(btrim(p_correo), ''), p_usuario)
    returning id into v_id;
  else
    select nivel into v_nivel_previo from public.vigia_director where id = p_id and tenant_id = p_tenant;
    if not found then raise exception 'director inexistente en esta flota' using errcode = 'P0002'; end if;
    if v_nivel_previo <> p_nivel then
      select count(*) into v_n from public.vigia_director where tenant_id = p_tenant and nivel = p_nivel;
      if v_n >= 10 then raise exception 'tope de 10 directores por nivel y flota' using errcode = '54000'; end if;
    end if;
    update public.vigia_director
       set nivel = p_nivel, nombre = btrim(p_nombre), telefono = nullif(btrim(p_telefono), ''), correo = nullif(btrim(p_correo), ''),
           updated_by = p_usuario, updated_at = now()
     where id = p_id and tenant_id = p_tenant
     returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.vigia_director_guardar(uuid, uuid, integer, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.vigia_director_guardar(uuid, uuid, integer, text, text, text, uuid) to service_role;

-- Baja. `false` = no existe o es de otra flota.
create or replace function public.vigia_director_quitar(p_tenant uuid, p_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  delete from public.vigia_director where id = p_id and tenant_id = p_tenant;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.vigia_director_quitar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vigia_director_quitar(uuid, uuid) to service_role;
