-- ═══════════════════════════════════════════════════════════════════════════
-- 0784 — `cron_latido` admite el id `tms` (el sincronizador del sistema de
--        gestión de transporte del cliente, T-TMS-12).
--
-- `registrarLatido('tms', …)` hace upsert en `cron_latido`, cuyo CHECK
-- (`cron_latido_id_dominio`) es el catálogo COMPLETO de ids de cron, espejo de
-- `CRONS` en `lib/admin/salud.ts`. Sin esta migración el latido del cron nuevo
-- se rechazaría con 23514 (el código ya degrada a un log claro, pero el panel
-- de relojes lo daría por mudo). Es la misma maniobra de la 0242/0642/0701: se
-- suelta el CHECK y se vuelve a poner con la lista vigente + el id nuevo.
--
-- ADITIVA: solo ensancha un dominio; no toca filas. Idempotente (`if exists`).
--
-- NOTA DE INTEGRACIÓN: cada migración que añade un cron reescribe esta lista
-- entera. Si otro frente añade OTRO cron antes de que esta llegue a `master`,
-- la lista de la migración MÁS ALTA debe llevar los ids de todos (la prueba
-- `salud.test.ts` lee la última y la compara con `CRONS`).
--
-- REVERSA (documentada, NO ejecutada): volver a poner el CHECK de la 0701
-- (sin `tms`) tras borrar la fila `cron_latido` con id 'tms':
--   delete from public.cron_latido where id = 'tms';
--   alter table public.cron_latido drop constraint cron_latido_id_dominio;
--   alter table public.cron_latido add constraint cron_latido_id_dominio
--     check (id in ('wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia',
--       'descarga-sat', 'jornada', 'portales-vivos', 'liquidaciones-externas', 'peajes', 'conductor-hitos',
--       'vigia', 'buzon-entrega', 'jornada-alertas', 'carta-porte-docs', 'guardia'));
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.cron_latido drop constraint if exists cron_latido_id_dominio;
alter table public.cron_latido
  add constraint cron_latido_id_dominio
  check (id in (
    'wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia',
    'descarga-sat', 'jornada', 'portales-vivos', 'liquidaciones-externas', 'peajes', 'conductor-hitos',
    'vigia', 'buzon-entrega', 'jornada-alertas', 'carta-porte-docs', 'guardia', 'tms'
  ));

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. La 0784 añade tms sobre la lista de la 0701.';
