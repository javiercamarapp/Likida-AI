-- ═══════════════════════════════════════════════════════════════════════════
-- 1007 — `cron_latido` admite el id `vigilancia-normativa` (el cron diario que
--        sustituye a la rutina remota de vigilancia normativa).
--
-- Por qué hace falta una migración aunque el cron no cree tablas: el estado de
-- la vigilancia (cursor del último día barrido, codNota ya avisados, ETag del
-- SAT, Last-Modified de las leyes) vive en `cron_latido.detalle`, y
-- `registrarLatido('vigilancia-normativa', …)` hace upsert en `cron_latido`,
-- cuyo CHECK (`cron_latido_id_dominio`) es el catálogo COMPLETO de ids de cron,
-- espejo de `CRONS` en `lib/admin/salud.ts`. Sin esto el upsert se rechaza con
-- 23514 y el cron no podría recordar ni su cursor: re-barrería y re-avisaría
-- cada día. Es la misma maniobra de la 0242/0642/0701/0784: se suelta el CHECK
-- y se vuelve a poner con la lista vigente + el id nuevo.
--
-- ADITIVA: solo ensancha un dominio; no toca filas. Idempotente (`if exists`).
--
-- NOTA DE INTEGRACIÓN: cada migración que añade un cron reescribe esta lista
-- entera. Si otro frente añade OTRO cron antes de que esta llegue a `master`,
-- la lista de la migración MÁS ALTA debe llevar los ids de todos (la prueba
-- `salud.test.ts` lee la última y la compara con `CRONS`). El orden de
-- despliegue es migración PRIMERO, código después (la compuerta de deploy lo
-- exige: `migracion.base` de /api/health no puede ir atrás de la última).
--
-- REVERSA (documentada, NO ejecutada): volver al CHECK de la 0784 (sin
-- `vigilancia-normativa`) tras borrar la fila:
--   delete from public.cron_latido where id = 'vigilancia-normativa';
--   alter table public.cron_latido drop constraint cron_latido_id_dominio;
--   alter table public.cron_latido add constraint cron_latido_id_dominio
--     check (id in ('wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia',
--       'descarga-sat', 'jornada', 'portales-vivos', 'liquidaciones-externas', 'peajes', 'conductor-hitos',
--       'vigia', 'buzon-entrega', 'jornada-alertas', 'carta-porte-docs', 'guardia', 'tms'));
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.cron_latido drop constraint if exists cron_latido_id_dominio;
alter table public.cron_latido
  add constraint cron_latido_id_dominio
  check (id in (
    'wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia',
    'descarga-sat', 'jornada', 'portales-vivos', 'liquidaciones-externas', 'peajes', 'conductor-hitos',
    'vigia', 'buzon-entrega', 'jornada-alertas', 'carta-porte-docs', 'guardia', 'tms', 'vigilancia-normativa'
  ));

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. La 1007 añade vigilancia-normativa sobre la lista de la 0784.';
