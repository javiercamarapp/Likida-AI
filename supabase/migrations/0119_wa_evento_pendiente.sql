-- ═══════════════════════════════════════════════════════════════════════════
-- 0119 — `wa_evento_pendiente`: apagado significa PAUSADO Y DURABLE, no
-- "acusar y tirar".
--
-- El hallazgo P1 de la auditoría externa del 16-ago-2026: el webhook de
-- WhatsApp contesta 200 (el acuse) y DESPUÉS consulta el kill switch dentro
-- del after() — con 'global' apagado, el mensaje se descartaba. Meta no
-- reintenta lo que ya acusamos: la foto del chofer se perdía para siempre,
-- y el comentario del código afirmaba lo contrario.
--
-- EL ARREGLO: con el sistema apagado, cada mensaje entrante se PERSISTE
-- aquí antes de terminar la invocación. El 200 vuelve a ser verdad
-- ("recibido y guardado"), y el cron de drenado (`/api/cron/wa-pendientes`)
-- los procesa por el motor real cuando la palanca vuelve a subir.
--
-- El id ES el wamid de Meta: una reentrega del mismo evento (Meta puede
-- duplicar) choca con la PK y no duplica — y el procesamiento aguas abajo
-- sigue protegido por `claimMessage` sobre `wa_mensaje_procesado` (0002),
-- así que at-least-once del drenado tampoco duplica gastos.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.wa_evento_pendiente (
  -- El wamid. Cuando Meta no lo manda (no debería en mensajes), el webhook
  -- genera uno propio con prefijo para no perder el evento por falta de id.
  id           text primary key,
  -- El InboundMessage completo (from, type, text/caption, mediaId, wamid) —
  -- exactamente lo que processInbound recibe en el camino vivo.
  evento       jsonb not null,
  recibido_en  timestamptz not null default now(),
  -- Cuántas veces lo intentó el drenado. Al tope (el cron lo define), la
  -- fila queda como carta muerta VISIBLE con su ultimo_error — jamás se
  -- borra sola: borrar la evidencia de un mensaje que no se pudo procesar
  -- es el mismo error que esta tabla vino a matar.
  intentos     int not null default 0,
  procesado_en timestamptz,
  ultimo_error text
);

comment on table public.wa_evento_pendiente is
  'La bandeja durable del webhook de WhatsApp (P1 de la auditoría externa, 16-ago-2026): con el kill switch global APAGADO, los mensajes entrantes se guardan aquí en vez de descartarse tras el 200 — Meta no reintenta lo acusado. El cron wa-pendientes los drena por processInbound cuando la palanca sube; claimMessage (0002) hace inofensivo el at-least-once. Deny-all: solo el servidor.';

alter table public.wa_evento_pendiente enable row level security;

-- La consulta del drenado: lo pendiente, lo más viejo primero.
create index if not exists wa_evento_pendiente_drenado_idx
  on public.wa_evento_pendiente (recibido_en)
  where procesado_en is null;
