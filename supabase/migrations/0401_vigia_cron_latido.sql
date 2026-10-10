-- ═══════════════════════════════════════════════════════════════════════════
-- 0401 — EL LATIDO DEL CRON DEL VIGÍA (cola de la 0400)
--
-- Va aparte de la 0400 a propósito: el dominio de `cron_latido` se enumera
-- ENTERO cada vez y es espejo de CRONS en `lib/admin/salud.ts`, así que cambia
-- junto con el cron (`/api/cron/vigia`) y no con el esquema de las tablas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El latido del cron del Vigía ───────────────────────────────────────────
-- `/api/cron/vigia` barre el SLA (sin respuesta → escalar), las aprobaciones
-- atoradas y la retención. Su latido entra al dominio de `cron_latido`, que se
-- enumera ENTERO cada vez (lección de la 0227/0241/0248). Espejo de CRONS en
-- `lib/admin/salud.ts`; `salud.test.ts` lee el último `add constraint`.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'cron_latido_id_dominio' and conrelid = 'public.cron_latido'::regclass
  ) then
    alter table public.cron_latido drop constraint cron_latido_id_dominio;
  end if;
  alter table public.cron_latido
    add constraint cron_latido_id_dominio
    check (id in (
      'wa-pendientes',
      'wa-outbox',
      'escalar',
      'facturar',
      'purgar',
      'runner',
      'gps',
      'asistencia',
      'descarga-sat',
      'jornada',
      'portales-vivos',
      'liquidaciones-externas',
      'peajes',
      'conductor-hitos',
      'vigia'
    ));
end $$;

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. Se enumera entero al tocarlo. La 0401 añade vigia (sobre la lista de la 0380, que añadió conductor-hitos).';
