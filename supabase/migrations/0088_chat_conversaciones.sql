-- ═══════════════════════════════════════════════════════════════════════════
-- 0088 — Historial de conversaciones del chat "Chatea con tus datos".
--
-- Pedido del 13-ago-2026 (con capturas de referencia de ChatGPT): botón Historial,
-- panel con búsqueda, y las conversaciones GUARDADAS. Hasta hoy el historial
-- vivía en el estado de React y moría con la pestaña.
--
-- Dos tablas y no un jsonb de mensajes en la conversación: los mensajes se
-- insertan (append-only, sin read-modify-write que pierda turnos entre dos
-- pestañas), y una conversación se lista sin cargar su contenido.
--
-- QUIÉN VE QUÉ: una conversación es de UN usuario en UN tenant — el contador
-- no lee los chats del dueño. Toda consulta del servidor ancla tenant_id Y
-- user_id (conversaciones.ts); RLS queda activo sin políticas (deny-all) como
-- el resto de las tablas: el único camino es el service role del servidor.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.chat_conversacion (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id),
  user_id uuid not null references public.app_user(id),
  -- La primera pregunta, recortada (tituloDeConversacion). Es el rótulo del
  -- panel y lo que barre la búsqueda.
  titulo text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chat_conversacion is
  'Una conversación del chat "Chatea con tus datos" (0088). Pertenece a UN usuario de UN tenant.';

create index idx_chat_conversacion_usuario
  on public.chat_conversacion (tenant_id, user_id, updated_at desc);

create table public.chat_mensaje (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.chat_conversacion(id) on delete cascade,
  rol text not null check (rol in ('usuario', 'asistente')),
  texto text not null,
  -- Los bloques CRUDOS del analista (texto/cifra/tabla/dona/serie): con ellos
  -- el cliente re-pinta las gráficas al reabrir la conversación. NULL en los
  -- mensajes del usuario.
  bloques jsonb,
  created_at timestamptz not null default now()
);

comment on table public.chat_mensaje is
  'Un turno de una conversación del chat (0088). `bloques` guarda la respuesta cruda del analista para re-pintar visuales.';

create index idx_chat_mensaje_conversacion
  on public.chat_mensaje (conversacion_id, created_at);

alter table public.chat_conversacion enable row level security;
alter table public.chat_mensaje enable row level security;
