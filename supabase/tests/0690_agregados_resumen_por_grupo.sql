\set ON_ERROR_STOP on
-- 0690 — top_rutas_gasto_tenant / resumen_negocio / resumen_documentos_tenant (ronda 16, vuelta 2).
--   Misma salida que las funciones ANTERIORES (copias literales en pg_temp, el oráculo), sobre datos sintéticos con
--   rutas empatadas, origen/destino vacíos, fechas nulas, otra flota, horas de borde del día local de México
--   (medianoche local, cambios de horario de 2022) y meses UTC distintos; y el costo de top_rutas baja.
begin;

-- Oráculo: las definiciones ANTERIORES (0153 / 0150 / 0064) tal cual, en pg_temp.
create function pg_temp.old_top_rutas_gasto_tenant(p_tenant uuid, p_top integer, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'origen', origen, 'destino', destino, 'total', total
  ) order by total desc, origen, destino), '[]'::jsonb)
  from (
    select coalesce(nullif(v.origen, ''), '—') as origen,
           coalesce(nullif(v.destino, ''), '—') as destino,
           coalesce(sum(g.monto), 0) as total
    from gasto g
    join viaje v on v.id = g.viaje_id and v.tenant_id = p_tenant
    where g.tenant_id = p_tenant
      and (p_desde is null or g.fecha >= p_desde)
      and (p_hasta is null or g.fecha <= p_hasta)
    group by 1, 2
    order by total desc, origen, destino
    limit greatest(p_top, 0)
  ) r;
$function$;

create function pg_temp.old_resumen_negocio(p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with por_tenant as (
    select tenant_id, count(*) as n
    from viaje
    group by tenant_id
  ),
  por_dia as (
    select (created_at at time zone 'America/Mexico_City')::date as dia, count(*) as n
    from gasto
    where (p_desde is null or created_at >= p_desde)
    group by 1
  )
  select jsonb_build_object(
    'viajesTotal', (select count(*) from viaje),
    'viajesPorTenant', coalesce((
      select jsonb_agg(jsonb_build_object('tenantId', tenant_id, 'n', n) order by tenant_id)
      from por_tenant
    ), '[]'::jsonb),
    'facturasTotal', (select count(*) from gasto),
    'facturasPorDia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', to_char(dia, 'YYYY-MM-DD'), 'n', n) order by dia)
      from por_dia
    ), '[]'::jsonb)
  );
$function$;

create function pg_temp.old_resumen_documentos_tenant(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with g as (
    select
      grouping(to_char(created_at at time zone 'UTC', 'YYYY-MM')) as g_mes,
      to_char(created_at at time zone 'UTC', 'YYYY-MM')           as mes,
      count(*)                                                     as n
    from gasto
    where tenant_id = p_tenant
      and ocr_confianza is not null
    group by grouping sets ((), (to_char(created_at at time zone 'UTC', 'YYYY-MM')))
  )
  select jsonb_build_object(
    -- El corte `()` da una fila aunque no haya ni un comprobante: `n = 0`.
    'procesados', (select n from g where g_mes = 1),
    'porMes', coalesce((
      select jsonb_agg(jsonb_build_object('mes', mes, 'n', n) order by mes)
      from g where g_mes = 0
    ), '[]'::jsonb)
  );
$function$;


insert into public.tenant (id, nombre, plan) values
  ('69000000-0000-4000-8000-0000000000a1', 'Flota A 0690', 'demo'),
  ('69000000-0000-4000-8000-0000000000b1', 'Flota B 0690', 'demo'),
  ('69000000-0000-4000-8000-0000000000c1', 'Flota vacía 0690', 'demo');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('69000000-0000-4000-8000-0000000000a2', '69000000-0000-4000-8000-0000000000a1', 'Chofer A', '5215569000001'),
  ('69000000-0000-4000-8000-0000000000b2', '69000000-0000-4000-8000-0000000000b1', 'Chofer B', '5215569000002');
-- 40 viajes por flota en 6 rutas, dos con origen/destino vacío y dos rutas con el MISMO total (empate).
insert into public.viaje (id, tenant_id, operador_id, folio, origen, destino, estatus)
select md5('0690-viaje-' || t || '-' || v)::uuid,
       ('69000000-0000-4000-8000-0000000000' || t || '1')::uuid,
       ('69000000-0000-4000-8000-0000000000' || t || '2')::uuid,
       'V0690-' || t || '-' || v,
       (array['León', 'CDMX', '', 'Monterrey', 'León', 'Puebla'])[1 + v % 6],
       (array['CDMX', '', 'Guadalajara', 'León', 'CDMX', 'Puebla'])[1 + v % 6],
       'liquidado'
  from (values ('a'), ('b')) tt(t), generate_series(1, 40) v;

select setseed(0.690);
create temp table gen690 as
select t, i, random() as r1, random() as r2, random() as r3, random() as r4 from (values ('a'), ('b')) tt(t), generate_series(1, 700) i;
insert into public.gasto (id, tenant_id, viaje_id, concepto, monto, fecha, folio, ocr_confianza, created_at)
select md5('0690-gasto-' || t || '-' || i)::uuid,
       ('69000000-0000-4000-8000-0000000000' || t || '1')::uuid,
       md5('0690-viaje-' || t || '-' || (1 + floor(r1 * 40)::int))::uuid,
       (array['diesel', 'caseta', 'alimentacion'])[1 + floor(r2 * 3)::int],
       (array[100, 250.5, 500, 1000])[1 + floor(r3 * 4)::int],
       case when r4 < 0.1 then null else date '2024-01-01' + floor(r4 * 900)::int end,
       'G' || i,
       case when r3 < 0.6 then round(r3::numeric, 3) else null end,
       -- created_at repartido de 2021 a 2026, con las horas de BORDE al final
       timestamptz '2021-06-01 00:00:00+00' + make_interval(secs => floor(r4 * 5.0 * 365 * 86400)::int)
  from gen690;
-- horas de borde: medianoche local de México (06:00Z/05:00Z), el cambio de horario de 2022 (abr 3 y oct 30) y fin de mes UTC
insert into public.gasto (id, tenant_id, viaje_id, concepto, monto, fecha, folio, ocr_confianza, created_at)
select md5('0690-borde-' || i)::uuid, '69000000-0000-4000-8000-0000000000a1', md5('0690-viaje-a-1')::uuid, 'diesel', 100 + i, date '2026-03-10', 'B' || i, 0.9, ts
  from unnest(array[
    timestamptz '2026-03-10 05:59:59+00', timestamptz '2026-03-10 06:00:00+00', timestamptz '2026-03-10 06:00:01+00',
    timestamptz '2022-04-03 05:59:59+00', timestamptz '2022-04-03 06:00:00+00', timestamptz '2022-04-03 07:59:59+00', timestamptz '2022-04-03 08:00:00+00',
    timestamptz '2022-10-30 04:59:59+00', timestamptz '2022-10-30 05:00:00+00', timestamptz '2022-10-30 06:59:59+00', timestamptz '2022-10-30 07:00:00+00',
    timestamptz '2022-10-31 05:59:59+00', timestamptz '2022-10-31 06:00:00+00',
    timestamptz '2025-12-31 23:59:59+00', timestamptz '2026-01-01 00:00:00+00', timestamptz '2025-12-31 17:59:59-06', timestamptz '2026-02-28 23:59:59.999999+00',
    timestamptz '2026-03-01 00:00:00+00']) with ordinality u(ts, i);
analyze public.gasto; analyze public.viaje;

do $$
declare
  a uuid := '69000000-0000-4000-8000-0000000000a1'; b uuid := '69000000-0000-4000-8000-0000000000b1'; c uuid := '69000000-0000-4000-8000-0000000000c1';
  t uuid; top int; w record; n int := 0;
begin
  -- top_rutas: ventanas, tops (0, 1, 3, 5, 50), flotas (con datos, otra, vacía)
  foreach t in array array[a, b, c] loop
    foreach top in array array[0, 1, 3, 5, 50] loop
      for w in select * from (values (null::date, null::date), (date '2025-01-01', null::date), (null::date, date '2025-06-30'), (date '2024-06-01', date '2025-12-31'), (date '2030-01-01', date '2031-01-01')) v(d, h) loop
        if public.top_rutas_gasto_tenant(t, top, w.d, w.h)::text is distinct from pg_temp.old_top_rutas_gasto_tenant(t, top, w.d, w.h)::text then
          raise exception '0690(top_rutas): divergencia flota % top % ventana % a %: nuevo % viejo %', t, top, w.d, w.h,
            public.top_rutas_gasto_tenant(t, top, w.d, w.h), pg_temp.old_top_rutas_gasto_tenant(t, top, w.d, w.h);
        end if;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  if n <> 75 then raise exception '0690: se esperaban 75 comparaciones de top_rutas y hubo %', n; end if;
  -- el escenario de verdad tiene empates y rutas con origen/destino vacío ('—')
  if (public.top_rutas_gasto_tenant(a, 50)::text) !~ '"—"' then raise exception '0690: el fuzz no tiene una ruta con origen/destino vacío'; end if;

  -- resumen_documentos
  foreach t in array array[a, b, c] loop
    if public.resumen_documentos_tenant(t)::text is distinct from pg_temp.old_resumen_documentos_tenant(t)::text then
      raise exception '0690(documentos): divergencia flota %: nuevo % viejo %', t, public.resumen_documentos_tenant(t), pg_temp.old_resumen_documentos_tenant(t);
    end if;
  end loop;
  if (public.resumen_documentos_tenant(c) ->> 'procesados')::int <> 0 then raise exception '0690(documentos): una flota vacía debe dar procesados = 0'; end if;
  if jsonb_array_length(public.resumen_documentos_tenant(a) -> 'porMes') < 12 then raise exception '0690(documentos): el fuzz no cubre meses suficientes'; end if;
end $$;

-- resumen_negocio (cross-tenant): sin ventana, con ventanas que cortan en horas de borde y una futura
do $$
declare d timestamptz; n int := 0;
begin
  foreach d in array array[null::timestamptz, timestamptz '2021-01-01', timestamptz '2022-04-03 06:00:00+00', timestamptz '2022-10-30 05:00:00+00',
                            timestamptz '2026-03-10 06:00:00+00', timestamptz '2026-03-10 05:59:59+00', now() - interval '365 days', now() + interval '1 day'] loop
    if public.resumen_negocio(d)::text is distinct from pg_temp.old_resumen_negocio(d)::text then
      raise exception '0690(negocio): divergencia con p_desde %: nuevo % viejo %', d, public.resumen_negocio(d), pg_temp.old_resumen_negocio(d);
    end if;
    n := n + 1;
  end loop;
  -- las horas de borde SÍ cayeron en días distintos (si no, la prueba no vería un desfase de zona)
  if (select count(*) from jsonb_array_elements(public.resumen_negocio(timestamptz '2022-10-30 04:00:00+00') -> 'facturasPorDia') e where e ->> 'dia' like '2022-10-%') < 2 then
    raise exception '0690(negocio): el fuzz no cubre el cambio de horario de octubre de 2022';
  end if;
end $$;

-- El costo de top_rutas: la unión con `viaje` ya no se hace sobre todos los gastos.
insert into public.viaje (id, tenant_id, operador_id, folio, origen, destino, estatus)
select md5('0690-viaje-g-' || v)::uuid, '69000000-0000-4000-8000-0000000000b1', '69000000-0000-4000-8000-0000000000b2', 'VG0690-' || v,
       'Ciudad ' || (v % 20), 'Ciudad ' || ((v * 7) % 20), 'liquidado'
  from generate_series(1, 6000) v;
insert into public.gasto (id, tenant_id, viaje_id, concepto, monto, fecha, folio, created_at)
select md5('0690-gasto-g-' || i)::uuid, '69000000-0000-4000-8000-0000000000b1', md5('0690-viaje-g-' || (1 + i % 6000))::uuid, 'diesel', 100 + (i % 900), date '2026-01-01' + (i % 270), 'GG' || i,
       timestamptz '2026-01-01' + make_interval(secs => i)
  from generate_series(1, 60000) i;
analyze public.gasto; analyze public.viaje;
do $$
declare t uuid := '69000000-0000-4000-8000-0000000000b1'; t0 timestamptz; v_ms numeric := 1e12; n_ms numeric := 1e12; i int; r1 jsonb; r2 jsonb;
begin
  for i in 1..3 loop
    t0 := clock_timestamp(); r1 := pg_temp.old_top_rutas_gasto_tenant(t, 5); v_ms := least(v_ms, extract(epoch from clock_timestamp() - t0) * 1000);
    t0 := clock_timestamp(); r2 := public.top_rutas_gasto_tenant(t, 5);      n_ms := least(n_ms, extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  if r1::text is distinct from r2::text then raise exception '0690(costo): la salida con 60,000 gastos no coincide'; end if;
  raise notice '0690(costo): top_rutas anterior % ms, nuevo % ms (razon %)', round(v_ms), round(n_ms), round(v_ms / n_ms, 2);
  if n_ms > v_ms * 0.85 then raise exception '0690(costo): top_rutas no bajó de costo (anterior % ms, nuevo % ms)', round(v_ms), round(n_ms); end if;
end $$;

rollback;
