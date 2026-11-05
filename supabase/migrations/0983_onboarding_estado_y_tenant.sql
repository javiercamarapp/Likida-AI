-- 0983 — Guía de onboarding: estado por usuario y flota, e interruptor/pedidos por flota (SPEC-ONBOARDING-GUIA 2.4, D-OB-1).
--
-- Dos tablas nuevas, aditivas e idempotentes. NACEN VACÍAS: el código que las usa cae al almacén local si no existen, así que puede
-- desplegarse antes o después de aplicar esta migración.
--
--   onboarding_estado(user_id, tenant_id)  avance de la guía de ESTA persona en ESTA flota (recorridos, tareas, preferencias).
--                                          `estado` es jsonb con tope de 16 KiB; `version` es el control optimista (el servidor
--                                          rechaza una escritura con versión distinta y el cliente relee y reintenta una vez).
--   onboarding_tenant(tenant_id)           `invitacion`: interruptor por flota que enciende la invitación SIN build ni variable de
--                                          entorno (una sentencia SQL); `pedidos`: estado de los pedidos al cliente (jsonb, 16 KiB).
--
-- SEGURIDAD (patrón posterior a 0947): RLS prendida SIN políticas (deny-all), `revoke all` a public/anon/authenticated y `grant`
-- explícito solo a service_role. El servidor filtra por la sesión; el navegador no toca estas tablas.
--
-- REVERSA: drop table if exists public.onboarding_estado, public.onboarding_tenant;
begin;

create table if not exists public.onboarding_estado (
  user_id        uuid        not null references public.app_user(id) on delete cascade,
  tenant_id      uuid        not null references public.tenant(id)   on delete cascade,
  estado         jsonb       not null default '{}'::jsonb,
  version        integer     not null default 1,
  actualizado_en timestamptz not null default now(),
  primary key (user_id, tenant_id),
  constraint onboarding_estado_es_objeto check (jsonb_typeof(estado) = 'object'),
  constraint onboarding_estado_tamano check (octet_length(estado::text) <= 16384),
  constraint onboarding_estado_version check (version >= 1)
);

create table if not exists public.onboarding_tenant (
  tenant_id       uuid        primary key references public.tenant(id) on delete cascade,
  invitacion      boolean     not null default false,
  pedidos         jsonb       not null default '{}'::jsonb,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid,
  constraint onboarding_tenant_pedidos_objeto check (jsonb_typeof(pedidos) = 'object'),
  constraint onboarding_tenant_pedidos_tamano check (octet_length(pedidos::text) <= 16384)
);

create index if not exists onboarding_estado_tenant_idx on public.onboarding_estado (tenant_id);

comment on table public.onboarding_estado is
  '0983: avance de la guía de onboarding por usuario y flota. Solo service_role; el servidor filtra por sesión. Sin datos de negocio.';
comment on table public.onboarding_tenant is
  '0983: interruptor de la invitación a la guía por flota (sin build ni env) y estado de los pedidos al cliente. Solo service_role.';

alter table public.onboarding_estado enable row level security;
alter table public.onboarding_tenant enable row level security;
revoke all on table public.onboarding_estado from public, anon, authenticated;
revoke all on table public.onboarding_tenant from public, anon, authenticated;
grant select, insert, update, delete on table public.onboarding_estado to service_role;
grant select, insert, update, delete on table public.onboarding_tenant to service_role;

commit;
