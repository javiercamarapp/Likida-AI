-- ═══════════════════════════════════════════════════════════════════════════
-- 0131 — AdminActionIntent PERSISTENTE (auditoría 5, P1 enterprise).
--
-- La Fase A vivía en un Map del proceso (copiloto-intents.ts): seguro pero
-- molesto en serverless — proponer y confirmar podían caer en instancias
-- distintas y el intent "no existía" (409). La Fase B es esta tabla: mismas
-- funciones, otro almacén. El consumo es ATÓMICO (un UPDATE con guardas en el
-- WHERE): dos POSTs simultáneos no ejecutan dos veces.
--
-- Solo la toca el service role (RLS sin policies, patrón de la casa).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.admin_action_intent (
  id         uuid primary key,
  -- El userId de la sesión que RECIBIÓ la previsualización — nadie más gasta
  -- este intent.
  actor_id   uuid not null,
  accion     text not null,
  -- sha256 de (accion, objetivo): lo que se ejecuta es EXACTAMENTE lo
  -- previsualizado.
  args_hash  text not null,
  gateo      text not null check (gateo in ('confirma', 'doble')),
  motivo     text,
  -- Solo 'doble': el primer POST válido ARMA; el segundo ejecuta.
  armado     boolean not null default false,
  -- null = vivo; con valor = gastado (la marca ES el candado del doble uso).
  usado_en   timestamptz,
  creado_en  timestamptz not null default now(),
  expira_en  timestamptz not null
);

comment on table public.admin_action_intent is
  'Intents de un solo uso del copiloto admin (Fase B, 0131). El boton del cliente es mensajero, jamas autoridad: el servidor crea el intent al proponer y lo consume atomicamente al ejecutar.';

create index if not exists idx_intent_expira on public.admin_action_intent (expira_en);

alter table public.admin_action_intent enable row level security;
