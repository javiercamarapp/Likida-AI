-- ═══════════════════════════════════════════════════════════════════════════
-- 0503 · cron_latido admite `jornada-alertas`
--
-- LOOP PUNTA A PUNTA, W3 «GPS/Jornada»: la alerta saliente de tope de jornada
-- (0502) corre en su PROPIO cron cada 15 minutos —no dentro de `jornada`, que es
-- un motor de escritura interna sin mensajes—, y el latido restringe su `id` a
-- un dominio cerrado (0155): añadir un cron es ensanchar ese dominio a
-- propósito, aquí.
--
-- SE REESCRIBE ENTERO (partiendo del CHECK vigente tras 0401, que ya incluye
-- `conductor-hitos` y `vigia`): un CHECK parcial pisaría los valores de otras
-- ramas. La lista contra `CRONS` de salud.ts la compara salud.test.ts.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.cron_latido drop constraint if exists cron_latido_id_dominio;
alter table public.cron_latido add constraint cron_latido_id_dominio
  check (id in (
    'wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps',
    'asistencia', 'descarga-sat', 'jornada', 'portales-vivos', 'liquidaciones-externas',
    'peajes', 'conductor-hitos', 'vigia', 'jornada-alertas'
  ));
