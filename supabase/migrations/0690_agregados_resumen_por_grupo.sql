-- ═══════════════════════════════════════════════════════════════════════════
-- 0690 · tres agregados del Resumen y de /admin, más baratos por fila (ronda 16,
--        vuelta 2: prueba de carga de 250 camiones / 5,000 viajes al mes).
--        (Numeración: la vuelta usó 0688 y 0689; esta es la tercera migración de la
--        vuelta, por eso 0690 y no dentro del rango reservado.)
--
-- Medido con CPU del backend (sin paralelismo, 240,000 gastos, 12 meses de historia):
--
--   top_rutas_gasto_tenant (histórico, sin ventana)   0.51 s -> 0.28 s
--   resumen_negocio (12 meses, toda la plataforma)    0.17 s -> 0.11 s
--   resumen_documentos_tenant                         0.22 s -> 0.14 s
--
--   · top_rutas: unía los 240k gastos con los viajes y después agrupaba por ruta.
--     Ahora suma primero por viaje (60k filas) y une ESO con `viaje`.
--   · resumen_negocio y resumen_documentos: convertían la zona horaria / formateaban
--     texto POR FILA (260k veces) para agrupar por día o por mes. Ahora agrupan por la
--     hora UTC (entero) o por `date_trunc('month')` y convierten/formatean solo las
--     decenas de grupos. La hora UTC es exacta para el día de México: su desfase es de
--     horas enteras desde 1922 (incluidos los cambios de horario hasta 2022), así que
--     cada hora UTC cae completa dentro de UN día local. La prueba lo comprueba contra
--     las funciones anteriores sobre horas de borde (medianoche local, cambios de horario).
--
-- MISMA salida, mismas firmas, mismos permisos (CREATE OR REPLACE conserva los GRANT).
-- Lo que NO cambia y se declara: son lecturas de historial sin ventana POR DISEÑO
-- (`histórico` en el Resumen, el total de la plataforma en /admin), así que su costo sigue
-- siendo lineal con las filas — ~1.1 µs por gasto, 12 meses de una flota de 250 camiones =
-- 0.28 s; la regla para el siguiente: si una flota pasa de ~24 meses de historia, la serie
-- histórica debe pasar a un resumen mensual mantenido, no a más índices.
-- `posiciones_por_unidad_dia` NO se tocó: su ventana la acota el periodo del desglose y la
-- retención de 90 días de `purgar_posicion`, no el historial (medido: 0.5 s de CPU en el peor
-- caso, 100 unidades × 30 días ≈ 370k posiciones; un índice cubriente no la mejoró).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.top_rutas_gasto_tenant(p_tenant uuid, p_top integer, p_desde date default null, p_hasta date default null)
 returns jsonb
 language sql
 stable parallel safe
 set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'origen', origen, 'destino', destino, 'total', total
  ) order by total desc, origen, destino), '[]'::jsonb)
  from (
    select coalesce(nullif(v.origen, ''), '—') as origen,
           coalesce(nullif(v.destino, ''), '—') as destino,
           coalesce(sum(s.total_viaje), 0) as total
    from (
      -- Primero por VIAJE (la tabla grande se reduce 4×), después la unión con `viaje`.
      select g.viaje_id, sum(g.monto) as total_viaje
        from gasto g
       where g.tenant_id = p_tenant
         and (p_desde is null or g.fecha >= p_desde)
         and (p_hasta is null or g.fecha <= p_hasta)
       group by g.viaje_id
    ) s
    join viaje v on v.id = s.viaje_id and v.tenant_id = p_tenant
    group by 1, 2
    order by total desc, origen, destino
    limit greatest(p_top, 0)
  ) r;
$function$;

create or replace function public.resumen_negocio(p_desde timestamp with time zone default null)
 returns jsonb
 language sql
 stable parallel safe
 set search_path to 'public', 'pg_catalog'
as $function$
  with por_tenant as (
    select tenant_id, count(*) as n
    from viaje
    group by tenant_id
  ),
  -- Por HORA UTC (un entero por fila), no por día local con conversión de zona POR FILA.
  por_hora as (
    select floor(date_part('epoch', created_at) / 3600) as hora, count(*) as n
    from gasto
    where (p_desde is null or created_at >= p_desde)
    group by 1
  ),
  por_dia as (
    select (to_timestamp(hora * 3600) at time zone 'America/Mexico_City')::date as dia, sum(n)::bigint as n
    from por_hora
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

create or replace function public.resumen_documentos_tenant(p_tenant uuid)
 returns jsonb
 language sql
 stable parallel safe
 set search_path to 'public', 'pg_catalog'
as $function$
  with g as (
    select
      grouping(date_trunc('month', created_at at time zone 'UTC')) as g_mes,
      -- El texto 'YYYY-MM' se arma DESPUÉS de agrupar (≤ unas decenas de meses), no por fila.
      to_char(date_trunc('month', created_at at time zone 'UTC'), 'YYYY-MM') as mes,
      count(*)                                                     as n
    from gasto
    where tenant_id = p_tenant
      and ocr_confianza is not null
    group by grouping sets ((), (date_trunc('month', created_at at time zone 'UTC')))
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
