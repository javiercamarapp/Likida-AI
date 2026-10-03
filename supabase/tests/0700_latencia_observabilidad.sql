\set ON_ERROR_STOP on
-- 0700 — LATENCIAS contra Postgres REAL (sintético, rollback).
-- Lo que solo la base garantiza:
--   (a) los CHECK de dominio de `latencia_muestra` (tipo, nombre, ms) rebotan lo que no cabe;
--   (b) `latencia_percentiles` calcula p50/p95 EN SQL con el estadístico de rango más cercano (percentile_disc): sobre 1..100 ms
--       da p50 = 50 y p95 = 95 EXACTOS (un valor que ocurrió, no una interpolación), cuenta fallos, separa ruta de cron y
--       respeta la ventana [desde, hasta);
--   (c) `llm_costo.duracion_ms`: NULL es «no medido» y NO cuenta como cero — `llm_costo_percentiles` separa `muestras` de
--       `sin_duracion` y no mete los NULL en el percentil; el CHECK de rango rebota negativos y > 1 h;
--   (d) la retención `purgar_latencia`: borra solo lo vencido, por tandas (parcial = true si queda), es idempotente y sus pisos
--       (3 días, lote 1,000) se hacen cumplir;
--   (e) permisos y RLS: nadie salvo service_role ejecuta las funciones ni lee la tabla; la tabla es deny-all.
begin;

-- ── (a) CHECK de dominio ──
do $$
begin
  begin insert into public.latencia_muestra (tipo, nombre, ms) values ('otro', 'x', 1); raise exception '0700(a): aceptó tipo fuera de dominio'; exception when check_violation then null; end;
  begin insert into public.latencia_muestra (tipo, nombre, ms) values ('ruta', '', 1); raise exception '0700(a): aceptó nombre vacío'; exception when check_violation then null; end;
  begin insert into public.latencia_muestra (tipo, nombre, ms) values ('ruta', repeat('x', 121), 1); raise exception '0700(a): aceptó nombre de 121'; exception when check_violation then null; end;
  begin insert into public.latencia_muestra (tipo, nombre, ms) values ('ruta', 'x', -1); raise exception '0700(a): aceptó ms negativo'; exception when check_violation then null; end;
  begin insert into public.latencia_muestra (tipo, nombre, ms) values ('ruta', 'x', 3600001); raise exception '0700(a): aceptó ms > 1 h'; exception when check_violation then null; end;
end $$;

-- ── (b) percentiles ──
-- 100 muestras 1..100 ms de la ruta 'a.b' (la 100 es un fallo), 3 de 'c' y 2 de un cron; una de 'a.b' FUERA de la ventana.
insert into public.latencia_muestra (tipo, nombre, ms, ok, creado_en)
select 'ruta', 'a.b', g, g <> 100, timestamptz '2026-10-03 12:00:00+00' from generate_series(1, 100) g;
insert into public.latencia_muestra (tipo, nombre, ms, creado_en) values
  ('ruta', 'c', 10, timestamptz '2026-10-03 12:00:00+00'), ('ruta', 'c', 20, timestamptz '2026-10-03 12:00:00+00'), ('ruta', 'c', 30, timestamptz '2026-10-03 12:00:00+00'),
  ('cron', 'gps', 700, timestamptz '2026-10-03 12:00:00+00'), ('cron', 'gps', 900, timestamptz '2026-10-03 12:00:00+00'),
  ('ruta', 'a.b', 99999, timestamptz '2026-09-01 12:00:00+00');   -- anterior a la ventana

set local role service_role;
do $$
declare r record; n integer;
begin
  select * into r from public.latencia_percentiles('ruta', timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-10-04 00:00:00+00') where nombre = 'a.b';
  if r.muestras <> 100 then raise exception '0700(b): muestras de a.b = % (esperado 100: la de septiembre queda fuera de la ventana)', r.muestras; end if;
  if r.p50_ms <> 50 or r.p95_ms <> 95 then raise exception '0700(b): p50/p95 = %/% (esperado 50/95)', r.p50_ms, r.p95_ms; end if;
  if r.max_ms <> 100 or r.fallos <> 1 then raise exception '0700(b): max/fallos = %/% (esperado 100/1)', r.max_ms, r.fallos; end if;
  select * into r from public.latencia_percentiles('ruta', timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-10-04 00:00:00+00') where nombre = 'c';
  if r.p50_ms <> 20 or r.p95_ms <> 30 then raise exception '0700(b): c p50/p95 = %/% (esperado 20/30)', r.p50_ms, r.p95_ms; end if;
  -- ruta y cron no se mezclan
  select count(*) into n from public.latencia_percentiles('cron', timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-10-04 00:00:00+00');
  if n <> 1 then raise exception '0700(b): el tipo cron devolvió % nombres (esperado 1)', n; end if;
  -- ventana vacía: cero filas (no un error ni una fila de ceros)
  select count(*) into n from public.latencia_percentiles('ruta', timestamptz '2027-01-01 00:00:00+00', timestamptz '2027-02-01 00:00:00+00');
  if n <> 0 then raise exception '0700(b): una ventana sin muestras devolvió % filas', n; end if;
  -- el más cargado va primero
  if (select nombre from public.latencia_percentiles('ruta', timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-10-04 00:00:00+00') limit 1) <> 'a.b' then raise exception '0700(b): el orden no es por carga'; end if;
end $$;
reset role;

-- ── (c) duracion_ms en llm_costo ──
insert into public.tenant (id, nombre) values ('70000000-0000-4000-8000-0000000000a1', 'Flota A 0700');
insert into public.llm_costo (tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd, duracion_ms, created_at)
select '70000000-0000-4000-8000-0000000000a1', 'ocr', 'm', 1, 1, 0.001, g * 10, timestamptz '2026-10-03 12:00:00+00' from generate_series(1, 10) g;     -- 10,20,…,100
insert into public.llm_costo (tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd, created_at) values
  ('70000000-0000-4000-8000-0000000000a1', 'ocr', 'm', 1, 1, 0.001, timestamptz '2026-10-03 12:00:00+00'),     -- sin duración (fila anterior a la 0700)
  ('70000000-0000-4000-8000-0000000000a1', 'ocr', 'm', 1, 1, 0.001, timestamptz '2026-10-03 12:00:00+00'),
  ('70000000-0000-4000-8000-0000000000a1', 'chat', 'm', 1, 1, 0.001, timestamptz '2026-10-03 12:00:00+00');   -- fase sin NINGUNA duración

set local role service_role;
do $$
declare r record;
begin
  select * into r from public.llm_costo_percentiles(timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-10-04 00:00:00+00') where fase = 'ocr';
  if r.muestras <> 10 or r.sin_duracion <> 2 then raise exception '0700(c): ocr muestras/sin_duracion = %/% (esperado 10/2: el NULL no cuenta como medido)', r.muestras, r.sin_duracion; end if;
  if r.p50_ms <> 50 or r.p95_ms <> 100 or r.max_ms <> 100 then raise exception '0700(c): ocr p50/p95/max = %/%/% (esperado 50/100/100 — los NULL NO entran como ceros)', r.p50_ms, r.p95_ms, r.max_ms; end if;
  select * into r from public.llm_costo_percentiles(timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-10-04 00:00:00+00') where fase = 'chat';
  if r.muestras <> 0 or r.sin_duracion <> 1 or r.p50_ms is not null or r.p95_ms is not null then raise exception '0700(c): una fase sin duraciones debe dar percentiles NULL, no 0 (llegó %)', r; end if;
end $$;
reset role;

do $$
begin
  begin update public.llm_costo set duracion_ms = -1 where tenant_id = '70000000-0000-4000-8000-0000000000a1' and fase = 'chat'; raise exception '0700(c): aceptó duracion_ms negativa'; exception when check_violation then null; end;
  begin update public.llm_costo set duracion_ms = 3600001 where tenant_id = '70000000-0000-4000-8000-0000000000a1' and fase = 'chat'; raise exception '0700(c): aceptó duracion_ms > 1 h'; exception when check_violation then null; end;
end $$;

-- ── (d) retención ──
delete from public.latencia_muestra;
insert into public.latencia_muestra (tipo, nombre, ms, creado_en)
select 'ruta', 'ret', 5, timestamptz '2026-10-03 12:00:00+00' - interval '20 days' from generate_series(1, 2500);   -- vencidas (> 14 d)
insert into public.latencia_muestra (tipo, nombre, ms, creado_en)
select 'ruta', 'ret', 5, timestamptz '2026-10-03 12:00:00+00' - interval '2 days' from generate_series(1, 7);        -- vigentes

set local role service_role;
do $$
declare r jsonb;
begin
  -- lote mínimo (1,000): 2,500 vencidas → tanda 1 borra 1,000 y queda parcial
  r := public.purgar_latencia(timestamptz '2026-10-03 12:00:00+00', 14, 1000);
  if (r->>'borradas')::int <> 1000 or (r->>'parcial')::boolean is not true then raise exception '0700(d): tanda 1 = % (esperado 1000 borradas y parcial)', r; end if;
  r := public.purgar_latencia(timestamptz '2026-10-03 12:00:00+00', 14, 1000);
  r := public.purgar_latencia(timestamptz '2026-10-03 12:00:00+00', 14, 1000);
  if (r->>'borradas')::int <> 500 or (r->>'parcial')::boolean then raise exception '0700(d): tanda 3 = % (esperado 500 y no parcial)', r; end if;
  if (select count(*) from public.latencia_muestra) <> 7 then raise exception '0700(d): se tocó una muestra vigente'; end if;
  -- idempotente
  r := public.purgar_latencia(timestamptz '2026-10-03 12:00:00+00', 14, 1000);
  if (r->>'borradas')::int <> 0 or (r->>'parcial')::boolean then raise exception '0700(d): segunda pasada = %', r; end if;
  -- pisos
  begin perform public.purgar_latencia(now(), 2, 1000); raise exception '0700(d): aceptó 2 días'; exception when sqlstate 'PU001' then null; end;
  begin perform public.purgar_latencia(now(), 14, 999); raise exception '0700(d): aceptó lote de 999'; exception when sqlstate 'PU001' then null; end;
end $$;

-- ── (e) permisos y RLS ──
reset role;
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.latencia_muestra'::regclass) then raise exception '0700(e): RLS apagada en latencia_muestra'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'latencia_muestra') then raise exception '0700(e): latencia_muestra debe ser deny-all (sin políticas)'; end if;
end $$;
set local role authenticated;
do $$
begin
  begin perform 1 from public.latencia_muestra limit 1; raise exception '0700(e): authenticated leyó la tabla'; exception when insufficient_privilege then null; end;
  begin perform * from public.latencia_percentiles('ruta', now() - interval '1 day'); raise exception '0700(e): authenticated ejecutó latencia_percentiles'; exception when insufficient_privilege then null; end;
  begin perform * from public.llm_costo_percentiles(now() - interval '1 day'); raise exception '0700(e): authenticated ejecutó llm_costo_percentiles'; exception when insufficient_privilege then null; end;
  begin perform public.purgar_latencia(); raise exception '0700(e): authenticated ejecutó purgar_latencia'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$
begin
  begin perform 1 from public.latencia_muestra limit 1; raise exception '0700(e): anon leyó la tabla'; exception when insufficient_privilege then null; end;
  begin perform public.purgar_latencia(); raise exception '0700(e): anon ejecutó purgar_latencia'; exception when insufficient_privilege then null; end;
end $$;

rollback;
