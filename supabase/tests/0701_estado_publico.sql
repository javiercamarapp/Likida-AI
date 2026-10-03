\set ON_ERROR_STOP on
-- 0701 — LA PÁGINA DE ESTADO contra Postgres REAL (sintético, rollback).
-- Lo que solo la base garantiza:
--   (a) cron_latido admite `guardia` Y los dieciocho de antes, y rechaza uno inventado (el dominio se reescribe ENTERO);
--   (b) `registrar_estado` suma en UNA fila por (día MX, componente): ok + degradadas + caídas = muestras SIEMPRE, es atómica
--       ante muchas mediciones, el día es el de la Ciudad de México (a las 02:00 UTC todavía es el día anterior) y un estado fuera
--       de dominio o un componente inventado rebotan;
--   (c) `estado_30_dias` devuelve solo la ventana de 30 días (el día 31 queda fuera) y NO inventa filas para los días sin medición;
--   (d) `purgar_estado_dia` borra solo lo más viejo que 400 días y exige piso de 90;
--   (e) permisos y RLS: tabla deny-all, funciones solo para service_role.
begin;

-- ── (a) cron_latido ──
do $$
declare id_ text;
begin
  foreach id_ in array array['wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia',
    'descarga-sat', 'jornada', 'portales-vivos', 'liquidaciones-externas', 'peajes', 'conductor-hitos', 'vigia', 'buzon-entrega',
    'jornada-alertas', 'carta-porte-docs', 'guardia'] loop
    insert into public.cron_latido (id) values (id_) on conflict (id) do nothing;
  end loop;
  begin insert into public.cron_latido (id) values ('inventado'); raise exception '0701(a): cron_latido aceptó un id inventado'; exception when check_violation then null; end;
end $$;

-- ── (b) registrar_estado ──
set local role service_role;
do $$
declare r record; dia_mx date;
begin
  -- 10 ok, 3 degradadas y 2 caídas del MISMO componente en el mismo instante → una fila con 15 muestras
  for i in 1..10 loop perform public.registrar_estado('app', 'ok', timestamptz '2026-10-03 18:00:00+00'); end loop;
  for i in 1..3 loop perform public.registrar_estado('app', 'degradado', timestamptz '2026-10-03 18:05:00+00'); end loop;
  for i in 1..2 loop perform public.registrar_estado('app', 'caido', timestamptz '2026-10-03 18:10:00+00'); end loop;
  select * into r from public.estado_dia where componente = 'app' and dia = date '2026-10-03';
  if r.muestras <> 15 or r.ok <> 10 or r.degradadas <> 3 or r.caidas <> 2 then raise exception '0701(b): contadores = %/%/%/% (esperado 15/10/3/2)', r.muestras, r.ok, r.degradadas, r.caidas; end if;
  if (select count(*) from public.estado_dia where componente = 'app') <> 1 then raise exception '0701(b): más de una fila para el mismo (día, componente)'; end if;
  if r.actualizado_en <> timestamptz '2026-10-03 18:10:00+00' then raise exception '0701(b): actualizado_en = % (esperado la última medición)', r.actualizado_en; end if;
  -- el día es el de la Ciudad de México: 02:00 UTC del 4 de octubre = 20:00 del 3 de octubre en México
  perform public.registrar_estado('base', 'ok', timestamptz '2026-10-04 02:00:00+00');
  select dia into dia_mx from public.estado_dia where componente = 'base';
  if dia_mx <> date '2026-10-03' then raise exception '0701(b): el día de las 02:00 UTC cayó en % (esperado 2026-10-03, hora de México)', dia_mx; end if;
  -- dominio
  begin perform public.registrar_estado('app', 'bien', now()); raise exception '0701(b): aceptó un estado fuera de dominio'; exception when sqlstate 'PU001' then null; end;
  begin perform public.registrar_estado('intruso', 'ok', now()); raise exception '0701(b): aceptó un componente inventado'; exception when check_violation then null; end;
end $$;

-- el CHECK de coherencia: nadie puede dejar contadores que no cuadren, ni siquiera con escritura directa
reset role;
do $$
begin
  begin update public.estado_dia set ok = ok + 1 where componente = 'app'; raise exception '0701(b): aceptó contadores que no suman las muestras'; exception when check_violation then null; end;
  begin update public.estado_dia set caidas = -1, muestras = muestras - 3 where componente = 'app'; raise exception '0701(b): aceptó un contador negativo'; exception when check_violation then null; end;
end $$;

-- ── (c) estado_30_dias ──
delete from public.estado_dia;
insert into public.estado_dia (dia, componente, muestras, ok, degradadas, caidas) values
  (date '2026-10-03', 'app', 10, 10, 0, 0),
  (date '2026-09-04', 'app', 10, 9, 0, 1),    -- día 30 de la ventana (hoy = 3-oct): entra
  (date '2026-09-03', 'app', 10, 10, 0, 0),   -- día 31: FUERA
  (date '2026-10-03', 'base', 4, 4, 0, 0),
  (date '2026-10-04', 'base', 1, 1, 0, 0);    -- «mañana» (otro huso): no pertenece a la ventana
set local role service_role;
do $$
declare n integer;
begin
  select count(*) into n from public.estado_30_dias(timestamptz '2026-10-03 18:00:00+00');
  if n <> 3 then raise exception '0701(c): la ventana devolvió % filas (esperado 3: el día 31 y el futuro quedan fuera)', n; end if;
  if exists (select 1 from public.estado_30_dias(timestamptz '2026-10-03 18:00:00+00') where dia = date '2026-09-03') then raise exception '0701(c): entró el día 31'; end if;
  -- sin medición no se inventa fila
  if exists (select 1 from public.estado_30_dias(timestamptz '2026-10-03 18:00:00+00') where componente = 'correo') then raise exception '0701(c): inventó filas para un componente sin medición'; end if;
end $$;

-- ── (d) retención ──
reset role;
insert into public.estado_dia (dia, componente, muestras, ok, degradadas, caidas) values
  (date '2025-08-01', 'app', 1, 1, 0, 0),     -- > 400 días antes del 3-oct-2026: vencida
  (date '2025-09-01', 'app', 1, 1, 0, 0);     -- 398 días: vigente
set local role service_role;
do $$
declare n integer;
begin
  n := public.purgar_estado_dia(timestamptz '2026-10-03 18:00:00+00', 400);
  if n <> 1 then raise exception '0701(d): borró % (esperado 1)', n; end if;
  if exists (select 1 from public.estado_dia where dia = date '2025-08-01') then raise exception '0701(d): sobrevivió la vencida'; end if;
  if not exists (select 1 from public.estado_dia where dia = date '2025-09-01') then raise exception '0701(d): se borró una vigente'; end if;
  if public.purgar_estado_dia(timestamptz '2026-10-03 18:00:00+00', 400) <> 0 then raise exception '0701(d): no es idempotente'; end if;
  begin perform public.purgar_estado_dia(now(), 89); raise exception '0701(d): aceptó 89 días'; exception when sqlstate 'PU001' then null; end;
end $$;

-- ── (e) permisos y RLS ──
reset role;
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.estado_dia'::regclass) then raise exception '0701(e): RLS apagada en estado_dia'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'estado_dia') then raise exception '0701(e): estado_dia debe ser deny-all (sin políticas)'; end if;
end $$;
set local role authenticated;
do $$
begin
  begin perform 1 from public.estado_dia limit 1; raise exception '0701(e): authenticated leyó estado_dia'; exception when insufficient_privilege then null; end;
  begin perform public.registrar_estado('app', 'ok'); raise exception '0701(e): authenticated ejecutó registrar_estado'; exception when insufficient_privilege then null; end;
  begin perform * from public.estado_30_dias(); raise exception '0701(e): authenticated ejecutó estado_30_dias'; exception when insufficient_privilege then null; end;
  begin perform public.purgar_estado_dia(); raise exception '0701(e): authenticated ejecutó purgar_estado_dia'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$
begin
  begin perform 1 from public.estado_dia limit 1; raise exception '0701(e): anon leyó estado_dia'; exception when insufficient_privilege then null; end;
  begin perform public.registrar_estado('app', 'ok'); raise exception '0701(e): anon ejecutó registrar_estado'; exception when insufficient_privilege then null; end;
end $$;

rollback;
