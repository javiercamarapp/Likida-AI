-- ═══════════════════════════════════════════════════════════════════════════
-- 0087 — El sello del recordatorio automático de comprobación pendiente.
--
-- Mismo patrón que `escalado_en` (0058): un viaje abierto/en_cuadre con
-- `fecha_inicio` vieja y sin comprobantes recientes recibe UN recordatorio
-- por WhatsApp, nunca dos. `recordatorio_comprobacion_en` se pone ANTES de
-- mandar el mensaje (claim condicional en recordatorio_comprobacion.ts), no
-- después — la misma razón que ya documenta escalar_viaje.ts: con Vercel
-- Cron entregando *at-least-once*, dos corridas solapadas no pueden ganar
-- la misma fila.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.viaje
  add column if not exists recordatorio_comprobacion_en timestamptz;

comment on column public.viaje.recordatorio_comprobacion_en is
  'Cuándo se le mandó al operador el recordatorio automático de "llevas N días sin comprobar". NULL = no se ha mandado. Se pone UNA sola vez (0087).';

create index if not exists idx_viaje_recordatorio_pendiente
  on public.viaje (tenant_id, estatus, fecha_inicio)
  where recordatorio_comprobacion_en is null;
