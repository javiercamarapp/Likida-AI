-- REVERSA: alter table public.liquidacion_correo_config drop column if exists poliza_provisional;
-- ═══════════════════════════════════════════════════════════════════════════
-- 1001 — A1: PERILLA «PÓLIZA PROVISIONAL» POR FLOTA (decisión del dueño, 10-nov-2026).
-- Aditiva e idempotente. false = comportamiento de siempre (un desglose sin póliza no se guarda). true = se guarda con la póliza
-- «PROVISIONAL», siempre RETENIDO hasta que una persona lo libere. El código tolera la ausencia de esta columna (la perilla vale false).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.liquidacion_correo_config add column if not exists poliza_provisional boolean not null default false;
comment on column public.liquidacion_correo_config.poliza_provisional is
  '1001: libera los desgloses sin póliza como «póliza provisional»: se guardan retenidos, marcados, y nunca salen sin revisión humana. Apagada por omisión.';
