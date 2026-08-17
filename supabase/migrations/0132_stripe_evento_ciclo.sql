-- ═══════════════════════════════════════════════════════════════════════════
-- 0132 — El CICLO DE VIDA del evento de Stripe (auditoría 5, P1 enterprise).
--
-- ANTES: la marca se insertaba, y si aplicar fallaba se BORRABA; si el
-- delete también fallaba quedaba una "marca huérfana" — evento marcado que
-- nunca se aplicó y que el reintento de Stripe saltaría para siempre (solo
-- un log lo delataba).
--
-- AHORA: la marca no se borra jamás. `aplicado_en` dice la verdad:
--   · null      = recibido, SIN aplicar (el reintento de Stripe lo RE-aplica
--                 — aplicarSuscripcion/aplicarFactura son idempotentes);
--   · con valor = aplicado (el reintento contesta "repetido").
-- La marca huérfana deja de existir como modo de falla.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.evento_stripe add column if not exists aplicado_en timestamptz;

comment on column public.evento_stripe.aplicado_en is
  'null = recibido sin aplicar (un reintento lo re-aplica; los apliques son idempotentes). Con valor = aplicado. La marca nunca se borra.';

-- Todo lo ya existente se aplicó: el flujo viejo borraba la marca al fallar.
update public.evento_stripe set aplicado_en = procesado_en where aplicado_en is null;
