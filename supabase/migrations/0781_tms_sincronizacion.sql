-- ═══════════════════════════════════════════════════════════════════════════
-- 0781 — Estado de sincronización e idempotencia del conector al sistema de
--        gestión de transporte (TMS) del cliente.
--
--   · `tms_sincronizacion`: dónde se quedó la lectura de cada recurso por
--     flota (cursor, desde cuándo, última lectura buena, último error). Una
--     fila por (flota, recurso): permite reanudar sin releer todo.
--   · `tms_ingesta`: huella de cada registro externo ya visto, para que una
--     relectura (paginación que repite, reintento tras un corte) no duplique.
--     La llave es (flota, recurso, clave externa); `huella` detecta si el
--     registro cambió en el origen.
--
-- RLS DENY-ALL: se habilita SIN políticas y se revoca todo a anon y
-- authenticated. Solo el servidor (service role) las toca. Mismo estilo que
-- `tenant_perfil` (0770) y `estado_dia` (0701).
--
-- `ultimo_error` es una frase NUESTRA, nunca la respuesta cruda del sistema
-- ajeno (podría traer un token): mismo criterio que `conector_credencial`.
--
-- ADITIVA: tablas nuevas. Sin funciones.
--
-- REVERSA (documentada, NO ejecutada):
--   drop table if exists public.tms_ingesta;
--   drop table if exists public.tms_sincronizacion;
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.tms_sincronizacion (
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  recurso       text not null,
  cursor        jsonb,
  desde         timestamptz,
  ultima_ok_en  timestamptz,
  ultimo_error  text,
  filas_leidas  integer not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (tenant_id, recurso),
  constraint tms_sincronizacion_recurso_no_vacio check (length(trim(recurso)) > 0),
  constraint tms_sincronizacion_filas_no_negativas check (filas_leidas >= 0)
);

create table if not exists public.tms_ingesta (
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  recurso       text not null,
  clave_externa text not null,
  huella        text not null,
  visto_en      timestamptz not null default now(),
  primary key (tenant_id, recurso, clave_externa),
  constraint tms_ingesta_recurso_no_vacio check (length(trim(recurso)) > 0),
  constraint tms_ingesta_clave_no_vacia check (length(trim(clave_externa)) > 0)
);

alter table public.tms_sincronizacion enable row level security;
alter table public.tms_ingesta        enable row level security;
revoke all on public.tms_sincronizacion from public, anon, authenticated;
revoke all on public.tms_ingesta        from public, anon, authenticated;

comment on table public.tms_sincronizacion is
  'Avance de lectura del conector al sistema de gestión de transporte del cliente, por flota y recurso (0781). Deny-all: solo service-role.';
comment on column public.tms_sincronizacion.ultimo_error is
  'Frase escrita por nosotros. NUNCA la respuesta cruda del sistema ajeno: puede traer un token.';
comment on table public.tms_ingesta is
  'Registros externos ya vistos (flota, recurso, clave externa) con su huella, para idempotencia de relecturas (0781). Deny-all: solo service-role.';
