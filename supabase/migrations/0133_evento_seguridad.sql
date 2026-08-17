-- ═══════════════════════════════════════════════════════════════════════════
-- 0133 — TELEMETRÍA DE TRUST & SAFETY (fase 7 enterprise, auditoría 5 §23).
--
-- Los detectores YA existían regados en logs (firma inválida, intent
-- rechazado, guardia de cifras, scope negado); lo que no existía era el
-- REGISTRO consultable: qué intentó quién, contra qué canal y cuándo. Un log
-- rota; esta tabla es la memoria de seguridad del producto.
--
-- Solo la escribe el service role (RLS sin policies, patrón de la casa) y
-- SIEMPRE en best-effort: registrar jamás puede tumbar el camino que vigila.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.evento_seguridad (
  id         uuid primary key default gen_random_uuid(),
  -- null = evento sin flota atribuible (p. ej. firma inválida anónima).
  tenant_id  uuid references public.tenant(id) on delete set null,
  -- El subsistema que lo detectó.
  origen     text not null check (origen in (
    'wa_webhook', 'stripe_webhook', 'correo_webhook', 'copiloto',
    'api_v1', 'chat', 'ratelimit', 'auth', 'otro'
  )),
  -- Qué clase de señal es.
  tipo       text not null check (tipo in (
    'firma_invalida', 'intent_invalido', 'step_up_rechazado', 'rate_limit',
    'inyeccion_prompt', 'acceso_denegado', 'cifra_sin_respaldo',
    'payload_excesivo', 'otro'
  )),
  severidad  text not null default 'media' check (severidad in ('info', 'media', 'alta')),
  -- Quién (userId, teléfono, llave truncada…) — texto libre, jamás secretos.
  actor      text,
  detalle    jsonb,
  creado_en  timestamptz not null default now()
);

comment on table public.evento_seguridad is
  'Telemetria de Trust & Safety (0133): cada deteccion de seguridad deja fila consultable. Best-effort: registrar jamas tumba el camino vigilado.';

create index if not exists idx_evento_seguridad_fecha on public.evento_seguridad (creado_en desc);
create index if not exists idx_evento_seguridad_tipo  on public.evento_seguridad (tipo, creado_en desc);

alter table public.evento_seguridad enable row level security;
