-- ═══════════════════════════════════════════════════════════════════════════
-- 0484 — Vigía de servicio al cliente: grupos de WhatsApp CRÍTICOS, histórico exportado y alertas configurables.
--
-- Lo que pidió el cliente (Zoom 1-oct-2026): atender los grupos de WhatsApp de sus clientes (solo los críticos al inicio),
-- entrenar con el histórico exportado del chat (.txt/.zip de «Exportar chat»), un reporte de FAQs y tendencias por tema
-- (del levantamiento) y una alerta al gerente/director cuando un cliente lleva más de 10 minutos sin respuesta o se enoja.
--
--   · `vigia_grupo`            los grupos de cada cliente y cuáles son CRÍTICOS. Un cliente con algún grupo crítico se atiende
--                              con el plazo corto `sla_critico_min` (10 min por omisión) en vez del `sla_respuesta_min` general.
--   · `vigia_historial_import` una exportación subida (huella sha256: la misma exportación no entra dos veces al mismo grupo).
--   · `vigia_historial_mensaje` los mensajes del histórico, SIN nombre ni teléfono del autor (solo un hash corto con sal de la
--                              flota; los teléfonos y correos escritos dentro del texto se taparon antes de guardar). Se purgan
--                              con la misma retención del Vigía (`vigia_historial_purgar`).
--   · `vigia_config`           `sla_critico_min` (2–1440, 10) y `molestia_aviso_nivel` (2 o 3, 2): desde qué nivel de molestia se
--                              avisa al gerente (el nivel 3 siempre sube al dueño).
--
-- Lo que esta migración NO hace: recibir mensajes de un grupo en vivo. Eso depende de la API de grupos de Meta (elegibilidad
-- y alta del WABA) y NO está simulado aquí; sin ella el grupo se alimenta del histórico exportado.
-- Todo lo escribe el servidor (service_role); RLS de lectura como el resto del Vigía (`ve_atencion_cliente()`).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.vigia_config add column if not exists sla_critico_min integer not null default 10;
alter table public.vigia_config add column if not exists molestia_aviso_nivel smallint not null default 2;
alter table public.vigia_config drop constraint if exists vigia_config_sla_critico;
alter table public.vigia_config add constraint vigia_config_sla_critico check (sla_critico_min between 2 and 1440);
alter table public.vigia_config drop constraint if exists vigia_config_molestia_nivel;
alter table public.vigia_config add constraint vigia_config_molestia_nivel check (molestia_aviso_nivel in (2, 3));
comment on column public.vigia_config.sla_critico_min is
  '0484: minutos sin respuesta antes de avisar al gerente cuando el cliente tiene un grupo CRÍTICO (vigia_grupo.critico). Rige el menor entre este y sla_respuesta_min.';
comment on column public.vigia_config.molestia_aviso_nivel is
  '0484: nivel de molestia (2 o 3) desde el que se avisa al gerente responsable. El nivel 3 sube además al dueño.';

create table if not exists public.vigia_grupo (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  cliente_id  uuid not null,
  nombre      text not null,
  critico     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint vigia_grupo_id_tenant_key unique (id, tenant_id),
  constraint vigia_grupo_cliente_tenant_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint vigia_grupo_nombre_forma check (char_length(btrim(nombre)) between 1 and 120)
);
create unique index if not exists vigia_grupo_nombre_uq on public.vigia_grupo (tenant_id, cliente_id, lower(btrim(nombre)));
create index if not exists vigia_grupo_critico_idx on public.vigia_grupo (tenant_id, cliente_id) where critico;
comment on table public.vigia_grupo is
  '0484: grupos de WhatsApp de un cliente de la flota; `critico` = se atienden con el plazo corto del Vigía.';

create table if not exists public.vigia_historial_import (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  grupo_id    uuid not null,
  sha256      text not null,
  mensajes    integer not null default 0,
  desde       timestamptz,
  hasta       timestamptz,
  creado_por  uuid,
  created_at  timestamptz not null default now(),
  constraint vigia_historial_import_id_tenant_key unique (id, tenant_id),
  constraint vigia_historial_import_grupo_fkey
    foreign key (grupo_id, tenant_id) references public.vigia_grupo (id, tenant_id) on delete cascade,
  constraint vigia_historial_import_sha_forma check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint vigia_historial_import_mensajes check (mensajes >= 0),
  constraint vigia_historial_import_unico unique (tenant_id, grupo_id, sha256)
);

create table if not exists public.vigia_historial_mensaje (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  import_id   uuid not null,
  grupo_id    uuid not null,
  enviado_en  timestamptz not null,
  rol         text not null,
  autor_hash  text not null,
  texto       text not null,
  created_at  timestamptz not null default now(),
  constraint vigia_historial_mensaje_import_fkey
    foreign key (import_id, tenant_id) references public.vigia_historial_import (id, tenant_id) on delete cascade,
  constraint vigia_historial_mensaje_rol check (rol in ('cliente', 'equipo')),
  constraint vigia_historial_mensaje_texto check (char_length(texto) between 1 and 1500),
  constraint vigia_historial_mensaje_autor check (autor_hash ~ '^[0-9a-f]{12}$')
);
create index if not exists vigia_historial_mensaje_grupo_idx on public.vigia_historial_mensaje (tenant_id, grupo_id, enviado_en);
create index if not exists vigia_historial_mensaje_import_idx on public.vigia_historial_mensaje (import_id);

alter table public.vigia_grupo enable row level security;
alter table public.vigia_historial_import enable row level security;
alter table public.vigia_historial_mensaje enable row level security;
drop policy if exists tenant_lee on public.vigia_grupo;
create policy tenant_lee on public.vigia_grupo for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.vigia_historial_import;
create policy tenant_lee on public.vigia_historial_import for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());
drop policy if exists tenant_lee on public.vigia_historial_mensaje;
create policy tenant_lee on public.vigia_historial_mensaje for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_atencion_cliente()) or is_superadmin());

revoke all on table public.vigia_grupo, public.vigia_historial_import, public.vigia_historial_mensaje from public, anon, authenticated;
grant select on table public.vigia_grupo, public.vigia_historial_import, public.vigia_historial_mensaje to authenticated;
grant select, insert, update, delete on table public.vigia_grupo, public.vigia_historial_import, public.vigia_historial_mensaje to service_role;
grant usage, select on sequence public.vigia_historial_mensaje_id_seq to service_role;

-- Retención: el histórico importado caduca por la fecha en que SE SUBIÓ (los mensajes ya son viejos por definición).
create or replace function public.vigia_historial_purgar(p_limite integer default 500)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  if p_limite < 1 or p_limite > 10000 then raise exception 'límite de purga inválido'; end if;
  with viejas as (
    select i.id, i.tenant_id from public.vigia_historial_import i
      left join public.vigia_config c on c.tenant_id = i.tenant_id
     where i.created_at < now() - make_interval(days => coalesce(c.retencion_dias, 180))
     order by i.created_at limit p_limite
  )
  delete from public.vigia_historial_import i using viejas v where i.id = v.id and i.tenant_id = v.tenant_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.vigia_historial_purgar(integer) from public, anon, authenticated;
grant execute on function public.vigia_historial_purgar(integer) to service_role;
