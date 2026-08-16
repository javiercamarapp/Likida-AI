-- ═══════════════════════════════════════════════════════════════════════════
-- 0121 — Historial de conversaciones del Copiloto del fundador.
--
-- El pendiente declarado de la Fase 2 pieza 1 (16-ago-2026): el copiloto
-- nació "sin historial persistente en esta fase (el intercambio 0088 es por
-- tenant) — dicho en el reporte, no escondido". Este es el cierre.
--
-- TABLAS PROPIAS y no una columna sobre 0088, por la MISMA razón que el
-- costo del copiloto no va a `llm_costo`: `chat_conversacion.tenant_id` es
-- NOT NULL y el copiloto es de LIKIDA (cross-tenant) — colgarlo de un tenant
-- mentiría en las consultas de ese tenant. El ancla aquí es el USUARIO
-- (superadmin); la puerta de rol vive en /api/admin/copiloto, que es la
-- única que escribe y lee.
--
-- La forma espejea a 0088 a propósito (dos tablas, append-only, lista sin
-- cargar contenido, `bloques` crudos para re-pintar visuales): mismo motivo,
-- misma solución, y quien ya leyó una entiende la otra.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.copiloto_conversacion (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user(id),
  -- La primera pregunta, recortada (tituloDeConversacion). Es el rótulo del
  -- panel y lo que barre la búsqueda.
  titulo text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.copiloto_conversacion is
  'Una conversación del Copiloto del fundador (0121). Sin tenant a propósito: el copiloto es de Likida, no de una flota — el ancla es el usuario superadmin.';

create index idx_copiloto_conversacion_usuario
  on public.copiloto_conversacion (user_id, updated_at desc);

create table public.copiloto_mensaje (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.copiloto_conversacion(id) on delete cascade,
  rol text not null check (rol in ('usuario', 'asistente')),
  texto text not null,
  -- Los bloques CRUDOS del copiloto (texto/cifra/tabla/dona/serie/accion):
  -- con ellos el cliente re-pinta visuales al reabrir. NULL en los mensajes
  -- del usuario.
  bloques jsonb,
  created_at timestamptz not null default now()
);

comment on table public.copiloto_mensaje is
  'Un turno de una conversación del copiloto (0121). `bloques` guarda la respuesta cruda para re-pintar visuales.';

create index idx_copiloto_mensaje_conversacion
  on public.copiloto_mensaje (conversacion_id, created_at);

-- RLS activo sin políticas (deny-all), como el resto: el único camino es el
-- service role del servidor, y ese servidor re-verifica superadmin.
alter table public.copiloto_conversacion enable row level security;
alter table public.copiloto_mensaje enable row level security;
