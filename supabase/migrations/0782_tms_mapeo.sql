-- ═══════════════════════════════════════════════════════════════════════════
-- 0782 — Mapeo declarativo por flota del sistema de gestión de transporte
--        (TMS) del cliente: cómo se traduce cada recurso externo a la forma
--        interna. Es un dato versionado, no código: cambiarlo no exige
--        despliegue y cada versión queda como fila.
--
-- Una sola versión ACTIVA por (flota, recurso) (índice único parcial); las
-- anteriores se conservan, inactivas, como historia.
--
-- `mapeo` es un objeto JSON acotado (< 64 KiB) para que ni un error ni un
-- abuso meta un documento enorme que la lectura tenga que cargar.
--
-- RLS DENY-ALL: SIN políticas, revocado a anon y authenticated. Solo el
-- servidor (service role). `creado_por` es set null: borrar la cuenta de
-- quien lo creó no debe quitar el mapeo.
--
-- ADITIVA: tabla nueva. Sin funciones.
--
-- REVERSA (documentada, NO ejecutada):
--   drop table if exists public.tms_mapeo;
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.tms_mapeo (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  recurso     text not null,
  mapeo       jsonb not null,
  version     integer not null default 1,
  activo      boolean not null default true,
  creado_por  uuid references public.app_user(id) on delete set null,
  creado_en   timestamptz not null default now(),
  constraint tms_mapeo_version_unica unique (tenant_id, recurso, version),
  constraint tms_mapeo_recurso_no_vacio check (length(trim(recurso)) > 0),
  constraint tms_mapeo_version_positiva check (version >= 1),
  constraint tms_mapeo_es_objeto_acotado
    check (jsonb_typeof(mapeo) = 'object' and octet_length(mapeo::text) < 65536)
);

create unique index if not exists tms_mapeo_un_activo
  on public.tms_mapeo (tenant_id, recurso)
  where activo;

alter table public.tms_mapeo enable row level security;
revoke all on public.tms_mapeo from public, anon, authenticated;

comment on table public.tms_mapeo is
  'Mapeo declarativo y versionado, por flota y recurso, del sistema de gestión de transporte del cliente a la forma interna (0782). Una versión activa por (flota, recurso). Deny-all: solo service-role.';
