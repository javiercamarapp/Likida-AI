-- ═══════════════════════════════════════════════════════════════════════════
-- 0642 — Carta Porte: el latido del cron nuevo y los eventos del worker.
--
--   · `cron_latido.id` admite 'carta-porte-docs' (espejo de CRONS en lib/admin/salud.ts). La lista se
--     enumera entera, como las anteriores.
--   · `cp_documento_evento.tipo` admite 'aviso_oficina' (se avisó a la oficina de un documento) y
--     'reintentos_agotados' (el documento agotó sus intentos y quedó terminal).
--
-- Idempotente. Sin esta migración el latido del cron falla en silencio (registrarLatido no lanza) y los dos
-- eventos nuevos no se escriben (el worker los trata como mejor esfuerzo).
-- ═══════════════════════════════════════════════════════════════════════════
-- La lista se enumera ENTERA (lo exige la prueba `salud.test.ts`, que la lee de la última migración que declara
-- el CHECK): la de la 0531 (que ya trae jornada-alertas de la 0503) + carta-porte-docs. Quien integre otra
-- migración que también añada un id de cron debe sumar ese id aquí o en la suya, sobre la lista COMPLETA.
alter table public.cron_latido drop constraint if exists cron_latido_id_dominio;
alter table public.cron_latido
  add constraint cron_latido_id_dominio
  check (id in (
    'wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia',
    'descarga-sat', 'jornada', 'portales-vivos', 'liquidaciones-externas', 'peajes', 'conductor-hitos',
    'vigia', 'buzon-entrega', 'jornada-alertas', 'carta-porte-docs'
  ));

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. La 0642 añade carta-porte-docs sobre la lista de la 0531 (que ya traía jornada-alertas).';

alter table public.cp_documento_evento drop constraint if exists cp_documento_evento_tipo_dominio;
alter table public.cp_documento_evento
  add constraint cp_documento_evento_tipo_dominio
  check (tipo in (
    'recibido', 'duplicado_recibido', 'extraccion_iniciada', 'extraccion_ok', 'extraccion_fallida',
    'escalada', 'revision_abierta', 'campo_corregido', 'aprobado', 'rechazado', 'reabierto',
    'salida_viaje', 'exportado', 'perfil_aprendido', 'purgado', 'aviso_oficina', 'reintentos_agotados'
  ));
