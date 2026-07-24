-- Idempotencia de mensajes de WhatsApp. Meta reintenta webhooks; sin esto, un
-- reintento duplicaría un gasto (error de dinero). El insert-on-conflict actúa
-- como claim atómico: si ya existe, es un duplicado y se ignora.

create table if not exists wa_mensaje_procesado (
  wa_message_id text primary key,
  created_at timestamptz not null default now()
);

-- Limpieza: mensajes de >7 días ya no se reintentarán (Meta reintenta ~horas).
create index if not exists idx_wa_msg_created on wa_mensaje_procesado(created_at);
