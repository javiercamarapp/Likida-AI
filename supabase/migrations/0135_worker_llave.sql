-- ═══════════════════════════════════════════════════════════════════════════
-- 0135 — IDENTIDAD DE WORKER CON ALCANCE (fase 7; auditoría 5 §28).
--
-- La Mac hablaba con PostgREST usando el SERVICE ROLE completo: comprometer
-- esa máquina era comprometer la base entera. Ahora el worker presenta una
-- llave `lkw_…` (solo su sha256 vive aquí) con CAPACIDADES enumeradas — el
-- blast radius de la Mac pasa de "toda la base" a "los cuatro verbos del bus".
--
--   bus.latido   → abrir/cerrar corridas (bus_corrida)
--   bus.pieza    → espejar piezas + su media (bus_pieza, storage bus/)
--   bus.catalogo → sembrar el catálogo (bus_rutina)
--   bus.ordenes  → leer/tomar/resolver órdenes (bus_orden)
--
-- La llave se enseña UNA vez al crearla (scripts/mejora-diaria/
-- crear-worker-llave.py); revocarla es poner revocada_en.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.worker_llave (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  -- sha256 hex de la llave — la llave misma jamás se guarda.
  hash         text not null unique,
  capacidades  text[] not null,
  creado_en    timestamptz not null default now(),
  last_used_at timestamptz,
  revocada_en  timestamptz
);

comment on table public.worker_llave is
  'Identidades de worker con alcance (0135). La Mac del bus presenta lkw_… y solo alcanza sus capacidades — nunca el service role.';

create index if not exists idx_worker_llave_hash on public.worker_llave (hash) where revocada_en is null;

alter table public.worker_llave enable row level security;
