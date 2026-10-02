-- ═══════════════════════════════════════════════════════════════════════════
-- 0642 — Carta Porte: el latido del cron nuevo y los eventos del worker.
--
--   · `cron_latido.id` admite 'carta-porte-docs' (espejo de CRONS en lib/admin/salud.ts). La lista NO se
--     reescribe a mano: se LEE el CHECK vigente, se le suman los ids conocidos y el nuevo, y se vuelve a
--     crear. Así no pisa a otra migración que haya añadido su propio id (la 0503 y la 0531 tuvieron que
--     listarse una a la otra por no hacer esto).
--   · `cp_documento_evento.tipo` admite 'aviso_oficina' (se avisó a la oficina de un documento) y
--     'reintentos_agotados' (el documento agotó sus intentos y quedó terminal).
--
-- Idempotente. Sin esta migración el latido del cron falla en silencio (registrarLatido no lanza) y los dos
-- eventos nuevos no se escriben (el worker los trata como mejor esfuerzo).
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  def text;
  ids text[];
  base text[] := array[
    'wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia',
    'descarga-sat', 'jornada', 'portales-vivos', 'liquidaciones-externas', 'peajes', 'conductor-hitos',
    'vigia', 'buzon-entrega', 'jornada-alertas', 'carta-porte-docs'
  ];
begin
  select pg_get_constraintdef(oid) into def
    from pg_constraint where conname = 'cron_latido_id_dominio' and conrelid = 'public.cron_latido'::regclass;
  select coalesce(array_agg(distinct m[1]), '{}') into ids from regexp_matches(coalesce(def, ''), '''([^'']+)''', 'g') as m;
  select array_agg(distinct x order by x) into ids from unnest(ids || base) as x;
  if def is not null then
    alter table public.cron_latido drop constraint cron_latido_id_dominio;
  end if;
  execute format(
    'alter table public.cron_latido add constraint cron_latido_id_dominio check (id in (%s))',
    (select string_agg(quote_literal(x), ', ' order by x) from unnest(ids) as x)
  );
end $$;

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. La 0642 lo recompone leyendo el CHECK vigente (unión) y añade carta-porte-docs.';

do $$
declare
  def text;
  tipos text[];
  base text[] := array[
    'recibido', 'duplicado_recibido', 'extraccion_iniciada', 'extraccion_ok', 'extraccion_fallida',
    'escalada', 'revision_abierta', 'campo_corregido', 'aprobado', 'rechazado', 'reabierto',
    'salida_viaje', 'exportado', 'perfil_aprendido', 'purgado', 'aviso_oficina', 'reintentos_agotados'
  ];
begin
  select pg_get_constraintdef(oid) into def
    from pg_constraint where conname = 'cp_documento_evento_tipo_dominio' and conrelid = 'public.cp_documento_evento'::regclass;
  select coalesce(array_agg(distinct m[1]), '{}') into tipos from regexp_matches(coalesce(def, ''), '''([^'']+)''', 'g') as m;
  select array_agg(distinct x order by x) into tipos from unnest(tipos || base) as x;
  if def is not null then
    alter table public.cp_documento_evento drop constraint cp_documento_evento_tipo_dominio;
  end if;
  execute format(
    'alter table public.cp_documento_evento add constraint cp_documento_evento_tipo_dominio check (tipo in (%s))',
    (select string_agg(quote_literal(x), ', ' order by x) from unnest(tipos) as x)
  );
end $$;
