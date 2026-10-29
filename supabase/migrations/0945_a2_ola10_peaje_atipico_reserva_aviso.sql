-- ═══════════════════════════════════════════════════════════════════════════
-- 0945 — PEAJES (A2, ola 10, A2P-18): la RESERVA con vencimiento de los avisos de cruces atípicos.
--
-- Antes el aviso de atípicos pasaba el hallazgo a `estado = 'avisado'` ANTES de enviar: si el proceso moría entre reservar y enviar, el
-- hallazgo quedaba «avisado» sin que nadie lo hubiera recibido y no se reenviaba. Ahora la reserva lleva un vencimiento
-- (`aviso_reservado_hasta`, 10 min): se limpia al confirmar el envío y, si vence sin confirmarse, el barrido devuelve el hallazgo a
-- `nuevo` para reintentar. NULL = sin reserva pendiente (todo lo anterior a esta migración queda como ya avisado, sin reenviar nada).
--
-- ADITIVA e IDEMPOTENTE: una columna nullable y un índice parcial (solo las filas con reserva pendiente). Sin tablas nuevas: RLS y permisos
-- vienen de la 0779. Rango A2 ola 10: 0945–0949.
--
-- REVERSA (documentada, NO ejecutada):
--   drop index if exists public.peaje_atipico_reserva_pendiente_idx;
--   alter table public.peaje_atipico drop column if exists aviso_reservado_hasta;
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.peaje_atipico add column if not exists aviso_reservado_hasta timestamptz;

comment on column public.peaje_atipico.aviso_reservado_hasta is
  '0945: vencimiento de la reserva del aviso (estado avisado sin confirmar). NULL = sin reserva pendiente. Vencida, el barrido devuelve el hallazgo a nuevo.';

create index if not exists peaje_atipico_reserva_pendiente_idx
  on public.peaje_atipico (aviso_reservado_hasta) where aviso_reservado_hasta is not null;
