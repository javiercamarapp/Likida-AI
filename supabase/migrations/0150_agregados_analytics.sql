-- ═══════════════════════════════════════════════════════════════════════════
-- 0150 — Escala 50k viajes/mes: los agregados de analytics.ts que quedaban
--        en JS, a RPC (docs/escala-50k/MAPA.md #1,2,5,6,7,8,9,10,11,20,21).
--
-- `traerTodo` (pg.ts) lanza `LecturaIncompleta` a las 100,000 filas y pagina
-- por offset O(n²). Con 50,000 viajes/mes (300k gastos/mes, 3.6M/año) cada
-- función de analytics.ts que lee una tabla del tenant a JS tiene fecha de
-- caducidad: `gasto` sin fecha revienta ~día 10; `viaje`/`liquidacion` ~mes 2.
--
-- Once caminos se mueven al molde de la 0112 (sum()/count() en SQL, UN viaje
-- de red, jsonb de vuelta, fail-closed de FORMA en JS):
--
--   1. anomalias_gasto_tenant           ← detectarAnomalias        (gasto sin fecha)
--   2. gasto_semanal_tenant             ← getGastoPorSemana        (gasto 35/91/364 d)
--   3. top_rutas_gasto_tenant           ← getTopRutasPorGasto      (gasto sin ventana + viaje ×3)
--   4. gasto_por_concepto_tenant        ← getGastoPorConcepto      (gasto sin fecha)
--   5. stats_operador_tenant            ← getStatsPorOperador      (operador+gasto+viaje+liquidacion)
--   6. liquidado_semanal_tenant         ← getLiquidadoPorSemana    (liquidacion 364 d)
--   7. viajes_por_mes_tenant            ← getViajesPorMes          (viaje completo)
--   8. operadores_detalle_tenant        ← getOperadoresDetalle     (operador+viaje+liquidacion)
--   9. dinero_observado_por_tipo_tenant ← getDineroObservadoPorTipo (liquidacion completo)
--  10. liquidaciones_por_dia_tenant     ← getLiquidacionesPorDia   (liquidacion 7/30/84 d)
--  11. conciliacion_consolidado_tenant  ← getConciliacionConsolidado (cfdi_consolidado_linea completo)
--
-- ── EL MOLDE (0112) ─────────────────────────────────────────────────────────
-- SECURITY INVOKER (la app llama con service_role, que ya salta RLS; un
-- DEFINER no daría un permiso más y un `revoke` olvidado filtraría dinero
-- entre flotas). `p_tenant uuid` SIN default y primero: olvidarlo es un 404
-- de PostgREST, no la base entera. `stable parallel safe`, `set search_path
-- = public, pg_catalog`, `coalesce` sobre cada sum (sum() de 0 filas es
-- NULL, no 0), bucket por día LOCAL de México (`at time zone
-- 'America/Mexico_City'`) donde la columna es timestamptz. `revoke ... from
-- public, anon, authenticated` + `grant execute ... to service_role`.
--
-- Cada función conserva la FIRMA y el TIPO DE RETORNO de la función JS que
-- reemplaza (las páginas no cambian); lo que se mueve es solo la reducción.
-- El redondeo a centavos (`round2`) se sigue haciendo en JS sobre la suma
-- exacta de `numeric` — el MISMO lugar que antes, así que ningún centavo
-- visible cambia. La prueba de equivalencia JS-viejo vs forma-nueva por
-- función vive en `analytics_agregados_0150.test.ts`.
--
-- ── ÍNDICES: NINGUNO NUEVO, Y POR QUÉ ───────────────────────────────────────
-- La regla (REGLAS-ESCALA.md §4) es "solo si un EXPLAIN lo justifica", y la
-- base tiene 0 viajes (22-ago-2026): un EXPLAIN hoy mide una tabla vacía.
-- Lo que SÍ se puede afirmar leyendo el catálogo:
--   · gasto por concepto (#4) y el diésel por operador (#5) los sirve
--     `idx_gasto_acumulado` (tenant_id, concepto, fecha — 0023) por prefijo:
--     el índice que el MAPA pedía "(tenant_id, concepto)" ya existe.
--   · el grupo por CFDI de las anomalías (#1) lo sirve `uq_gasto_cfdi_uuid`
--     (tenant_id, cfdi_uuid, cfdi_orden — 0065), índice único, index-only.
--   · el grupo por folio de las anomalías (#1) es, por definición, un barrido
--     de TODO el gasto del tenant (concepto, folio, monto): ningún índice
--     evita el hash aggregate; solo un índice de cobertura (tenant_id,
--     folio, concepto, monto) lo volvería index-only, y eso es exactamente lo
--     que hay que MEDIR antes de pagar 3.6M entradas de índice al año.
--   · las ventanas de fecha (#2, #3) usan `gasto_tenant_fecha_idx` (0111);
--     `liquidacion` (#6, #9, #10) usa `idx_liq_tenant` (tenant_id,
--     created_at desc — 0001); `viaje` (#7) `viaje_tenant_fecha_inicio_idx`
--     (0111); `cfdi_consolidado_linea` (#11) sus índices de la 0076.
-- Si al medir con datos reales alguno sale como seq scan caro, el índice va
-- en su propia migración con el EXPLAIN pegado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Anomalías entre viajes, UNA flota  →  detectarAnomalias (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Es la lectura MÁS cara del panel: `gasto` ENTERO del tenant, sin fecha, en
-- CADA carga del Resumen, del panel del contador, de Combustible & Casetas y
-- de Notificaciones (4 pantallas). Con 300k gastos/mes caduca ~día 10.
--
-- Replica `detectarDuplicadosEntreViajes` (duplicados.ts) regla por regla:
--   a) CFDI: grupo por (lower(uuid), orden) — orden = cfdi_orden si > 0, si
--      no 1 (mismo default que el motor; A5: N casetas de un consolidado con
--      el mismo UUID y orden 1..N NO son duplicado). Anomalía si el grupo
--      toca 2+ viajes DISTINTOS.
--   b) Folio: solo filas SIN uuid y CON folio, grupo por (lower(concepto),
--      folio, monto) — el folio solo no basta, dos gasolineras repiten
--      "A-991". Se descarta el grupo si ALGÚN uuid conocido del tenant
--      aparece como subcadena de su llave (el ticket cuyo folio impreso ES
--      el UUID ya se reportó arriba).
--   `monto` de la anomalía = el de la PRIMERA fila del grupo por `id` (la
--   función JS tomaba la primera que llegaba, y `traerTodo` ordenaba por
--   id). `viajes` en orden de primera aparición. Las de CFDI primero, luego
--   las de folio, cada bloque por primera aparición — el mismo orden que el
--   Map de JS.
--   `concepto` nulo cae en 'otro' (JS: `?? 'otro'`); folio/uuid vacíos se
--   tratan como ausentes (JS: `|| undefined`).
create or replace function public.anomalias_gasto_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with filas as (
    select
      id, viaje_id, monto,
      lower(coalesce(concepto, 'otro')) as concepto,
      nullif(folio, '') as folio,
      nullif(lower(cfdi_uuid), '') as uuid,
      case when cfdi_orden is not null and cfdi_orden > 0 then cfdi_orden::int else 1 end as orden
    from gasto
    where tenant_id = p_tenant
  ),
  -- a) mismo (uuid, orden) en 2+ viajes
  cfdi_grupos as (
    select uuid, orden,
      count(distinct viaje_id) as n_viajes,
      (array_agg(monto order by id))[1] as monto,
      (array_agg(id order by id))[1] as primer_id
    from filas
    where uuid is not null
    group by uuid, orden
    having count(distinct viaje_id) > 1
  ),
  cfdi_anomalias as (
    select
      g.primer_id,
      jsonb_build_object(
        'tipo', 'cfdi_duplicado',
        'detalle', 'CFDI ' || left(g.uuid, 8) || '…'
          || case when g.orden = 1 then '' else ' (partida ' || g.orden || ')' end
          || ' liquidado en ' || g.n_viajes || ' viajes',
        'monto', g.monto,
        'viajes', (
          select jsonb_agg(v.viaje_id order by v.primer)
          from (
            select f.viaje_id, min(f.id::text) as primer
            from filas f
            where f.uuid = g.uuid and f.orden = g.orden
            group by f.viaje_id
          ) v
        )
      ) as anomalia
    from cfdi_grupos g
  ),
  uuids as (select distinct uuid from filas where uuid is not null),
  -- b) mismo (concepto, folio, monto) sin uuid en 2+ viajes
  folio_grupos as (
    select concepto, folio, monto as monto_llave,
      count(distinct viaje_id) as n_viajes,
      (array_agg(monto order by id))[1] as monto,
      (array_agg(id order by id))[1] as primer_id
    from filas
    where folio is not null and uuid is null
    group by concepto, folio, monto
    having count(distinct viaje_id) > 1
  ),
  folio_anomalias as (
    select
      g.primer_id,
      jsonb_build_object(
        'tipo', 'folio_duplicado',
        'detalle', 'Folio ' || g.folio || ' (' || g.concepto || ') liquidado en ' || g.n_viajes || ' viajes',
        'monto', g.monto,
        'viajes', (
          select jsonb_agg(v.viaje_id order by v.primer)
          from (
            select f.viaje_id, min(f.id::text) as primer
            from filas f
            where f.uuid is null and f.folio = g.folio and f.concepto = g.concepto and f.monto = g.monto_llave
            group by f.viaje_id
          ) v
        )
      ) as anomalia
    from folio_grupos g
    where not exists (
      select 1 from uuids u
      where position(u.uuid in g.concepto || '|' || g.folio) > 0
    )
  )
  select coalesce(jsonb_agg(anomalia order by bloque, primer_id), '[]'::jsonb)
  from (
    select 1 as bloque, primer_id, anomalia from cfdi_anomalias
    union all
    select 2 as bloque, primer_id, anomalia from folio_anomalias
  ) todas;
$$;

comment on function public.anomalias_gasto_tenant(uuid) is
  'Comprobantes repetidos ENTRE viajes de UNA flota (cfdi_duplicado por (uuid, orden); folio_duplicado por (concepto, folio, monto) sin uuid), jsonb array [{tipo, detalle, monto, viajes}] — misma regla que detectarDuplicadosEntreViajes (duplicados.ts). Reemplaza el traerTodo de gasto ENTERO de detectarAnomalias (analytics.ts), que caduca ~día 10 a 50k viajes/mes (docs/escala-50k/MAPA.md #1). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.anomalias_gasto_tenant(uuid) from public, anon, authenticated;
grant execute on function public.anomalias_gasto_tenant(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Gasto por semana ISO y concepto  →  getGastoPorSemana (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `to_char(fecha, 'IYYY-"S"IW')` es la semana ISO (lunes-domingo, el jueves
-- decide el año) — la MISMA etiqueta que `semanaIso`/`ultimasSemanas` arman
-- en JS, que siguen generando el eje X. El top-3 de conceptos y el relleno
-- de semanas en cero se quedan en JS: son (semanas × conceptos) filas, no
-- 300k. `gasto.fecha` es `date`: rango directo sobre `gasto_tenant_fecha_idx`.
create or replace function public.gasto_semanal_tenant(p_tenant uuid, p_desde date, p_hasta date)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'semana', semana, 'concepto', concepto, 'total', total
  ) order by semana, concepto), '[]'::jsonb)
  from (
    select to_char(fecha, 'IYYY-"S"IW') as semana,
           coalesce(concepto, 'otro') as concepto,
           coalesce(sum(monto), 0) as total
    from gasto
    where tenant_id = p_tenant and fecha >= p_desde and fecha <= p_hasta
    group by 1, 2
  ) s;
$$;

comment on function public.gasto_semanal_tenant(uuid, date, date) is
  'Gasto de UNA flota por semana ISO (YYYY-SNN) y concepto en [p_desde, p_hasta], jsonb array [{semana, concepto, total}]. Reemplaza el traerTodo de getGastoPorSemana (analytics.ts; vista histórico = 52 semanas ≈ 3.6M filas a 50k viajes/mes, MAPA #2). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.gasto_semanal_tenant(uuid, date, date) from public, anon, authenticated;
grant execute on function public.gasto_semanal_tenant(uuid, date, date) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Top rutas por gasto  →  getTopRutasPorGasto (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Antes: `gasto` (sin ventana en "histórico") + `viaje` ENTERO, tres veces
-- por carga del Resumen, y el join en memoria. Aquí el join es SQL y solo
-- viajan `p_top` filas. `origen`/`destino` nulos o vacíos caen en '—' (JS:
-- `|| '—'`). El % y la región se calculan en JS sobre estas p_top filas.
-- Desempate de totales iguales por (origen, destino) — determinista.
create or replace function public.top_rutas_gasto_tenant(
  p_tenant uuid,
  p_top int,
  p_desde date default null,
  p_hasta date default null
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
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
$$;

comment on function public.top_rutas_gasto_tenant(uuid, int, date, date) is
  'Las p_top rutas (origen → destino) con más gasto de UNA flota, opcionalmente acotadas por fecha del comprobante, jsonb array [{origen, destino, total}]. Reemplaza el traerTodo doble (gasto sin ventana + viaje entero ×3) de getTopRutasPorGasto (analytics.ts, MAPA #5). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.top_rutas_gasto_tenant(uuid, int, date, date) from public, anon, authenticated;
grant execute on function public.top_rutas_gasto_tenant(uuid, int, date, date) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Gasto por concepto  →  getGastoPorConcepto (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Base de Combustible & Casetas. `idx_gasto_acumulado` (tenant_id, concepto,
-- fecha) sirve el group by por prefijo. Desempate por concepto.
create or replace function public.gasto_por_concepto_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'concepto', concepto, 'n', n, 'total', total
  ) order by total desc, concepto), '[]'::jsonb)
  from (
    select coalesce(concepto, 'otro') as concepto, count(*) as n, coalesce(sum(monto), 0) as total
    from gasto
    where tenant_id = p_tenant
    group by 1
  ) s;
$$;

comment on function public.gasto_por_concepto_tenant(uuid) is
  'Gasto de UNA flota agrupado por concepto (n filas y total), jsonb array [{concepto, n, total}] por total desc. Reemplaza el traerTodo de gasto ENTERO de getGastoPorConcepto (analytics.ts, MAPA #6). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.gasto_por_concepto_tenant(uuid) from public, anon, authenticated;
grant execute on function public.gasto_por_concepto_tenant(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Stats por operador  →  getStatsPorOperador (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Antes: CUATRO tablas completas (operador, gasto diésel, viaje, liquidacion)
-- a memoria para un join por viaje_id. Aquí: dos joins en SQL.
--   · viajes = viajes DISTINTOS con gasto diésel (no todos los del operador
--     — es lo que medía la función JS: `viajesPorOp` se alimenta del gasto).
--   · diferencias = liquidaciones con |diferencia| >= 0.01 (centavos de
--     redondeo no son una conversación), cruzadas a su operador vía viaje.
--   · quien ejerció la oposición del art. 26 fr. II (0100) NO entra.
-- `nombre` viaja porque es el mismo rol service_role que ya lo leía; el
-- seudónimo por defecto (A9) lo decide JS, igual que antes.
create or replace function public.stats_operador_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with d as (
    select v.operador_id, count(distinct g.viaje_id) as viajes, sum(g.monto) as diesel
    from gasto g
    join viaje v on v.id = g.viaje_id and v.tenant_id = p_tenant
    where g.tenant_id = p_tenant and g.concepto = 'diesel'
    group by v.operador_id
  ),
  l as (
    select v.operador_id, count(*) as n
    from liquidacion l
    join viaje v on v.id = l.viaje_id and v.tenant_id = p_tenant
    where l.tenant_id = p_tenant and abs(coalesce(l.diferencia, 0)) >= 0.01
    group by v.operador_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'operadorId', o.id,
    'nombre', o.nombre,
    'viajes', coalesce(d.viajes, 0),
    'dieselTotal', coalesce(d.diesel, 0),
    'diferencias', coalesce(l.n, 0)
  ) order by o.id), '[]'::jsonb)
  from operador o
  left join d on d.operador_id = o.id
  left join l on l.operador_id = o.id
  where o.tenant_id = p_tenant and o.oposicion_automatizada is null;
$$;

comment on function public.stats_operador_tenant(uuid) is
  'Por operador de UNA flota (sin los que ejercieron la oposición del art. 26 fr. II): viajes con diésel, diésel total y liquidaciones con diferencia real, jsonb array [{operadorId, nombre, viajes, dieselTotal, diferencias}]. Reemplaza los 4 traerTodo de getStatsPorOperador (analytics.ts, MAPA #7). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.stats_operador_tenant(uuid) from public, anon, authenticated;
grant execute on function public.stats_operador_tenant(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Liquidado por semana ISO  →  getLiquidadoPorSemana (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `created_at` es timestamptz: la semana ISO se toma del DÍA LOCAL de México
-- (mismo criterio que `diaLocalMx` en JS; un cierre de las 20:00 CDMX del
-- domingo NO cae en la semana siguiente). Solo cota inferior, como la JS.
create or replace function public.liquidado_semanal_tenant(p_tenant uuid, p_desde timestamptz)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object('semana', semana, 'total', total) order by semana), '[]'::jsonb)
  from (
    select to_char((created_at at time zone 'America/Mexico_City')::date, 'IYYY-"S"IW') as semana,
           coalesce(sum(total_comprobado), 0) as total
    from liquidacion
    where tenant_id = p_tenant and created_at >= p_desde
    group by 1
  ) s;
$$;

comment on function public.liquidado_semanal_tenant(uuid, timestamptz) is
  'Pesos liquidados (total_comprobado) de UNA flota por semana ISO del día LOCAL de México desde p_desde, jsonb array [{semana, total}]. Reemplaza el traerTodo de getLiquidadoPorSemana (analytics.ts, MAPA #8). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.liquidado_semanal_tenant(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.liquidado_semanal_tenant(uuid, timestamptz) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Viajes por mes  →  getViajesPorMes (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `fecha_inicio` es `date` (sin zona que resolver). Viajes sin fecha no
-- entran (JS: `.not('fecha_inicio', 'is', null)`). Histórico completo, como
-- antes: son ≤ 12 filas por año, lo caro era traer 600k fechas para contarlas.
create or replace function public.viajes_por_mes_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'n', n) order by mes), '[]'::jsonb)
  from (
    select to_char(fecha_inicio, 'YYYY-MM') as mes, count(*) as n
    from viaje
    where tenant_id = p_tenant and fecha_inicio is not null
    group by 1
  ) s;
$$;

comment on function public.viajes_por_mes_tenant(uuid) is
  'Viajes iniciados de UNA flota por mes (YYYY-MM), histórico completo, jsonb array [{mes, n}]. Reemplaza el traerTodo de viaje ENTERO de getViajesPorMes (analytics.ts, MAPA #9). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.viajes_por_mes_tenant(uuid) from public, anon, authenticated;
grant execute on function public.viajes_por_mes_tenant(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Operadores con anticipo y comprobado  →  getOperadoresDetalle (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Antes: operador + viaje ENTERO + liquidacion ENTERA a memoria. Aquí los
-- dos sums van por operador vía viaje. `pctComprobado` (Math.round sobre el
-- cociente) y `round2` se quedan en JS sobre las sumas exactas, como antes.
-- Orden: viajes desc, desempate por id (JS: sort estable sobre el orden por
-- id de traerTodo).
create or replace function public.operadores_detalle_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with v as (
    select operador_id, count(*) as viajes, coalesce(sum(anticipo), 0) as anticipo
    from viaje
    where tenant_id = p_tenant
    group by operador_id
  ),
  c as (
    select vi.operador_id, coalesce(sum(l.total_comprobado), 0) as comprobado
    from liquidacion l
    join viaje vi on vi.id = l.viaje_id and vi.tenant_id = p_tenant
    where l.tenant_id = p_tenant
    group by vi.operador_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'operadorId', o.id,
    'nombre', o.nombre,
    'telefono', o.telefono,
    'numeroEmpleado', o.numero_empleado,
    'rfc', o.rfc,
    'activo', o.activo,
    'viajes', coalesce(v.viajes, 0),
    'anticipoTotal', coalesce(v.anticipo, 0),
    'comprobadoTotal', coalesce(c.comprobado, 0),
    'licencia', o.licencia,
    'licenciaTipo', o.licencia_tipo,
    'licenciaVence', to_char(o.licencia_vence, 'YYYY-MM-DD')
  ) order by coalesce(v.viajes, 0) desc, o.id), '[]'::jsonb)
  from operador o
  left join v on v.operador_id = o.id
  left join c on c.operador_id = o.id
  where o.tenant_id = p_tenant;
$$;

comment on function public.operadores_detalle_tenant(uuid) is
  'Operadores de UNA flota con viajes, anticipo total y comprobado total (vía liquidacion), más licencia/RFC, jsonb array ordenado por viajes desc. Reemplaza los 3 traerTodo de getOperadoresDetalle (analytics.ts, MAPA #10). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.operadores_detalle_tenant(uuid) from public, anon, authenticated;
grant execute on function public.operadores_detalle_tenant(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Dinero observado por tipo  →  getDineroObservadoPorTipo (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `jsonb_array_elements` en CTE aparte, como `kpis_liquidacion_tenant`
-- (0112). Un elemento sin `tipo` string cae en 'otro' (JS igual). Un `monto`
-- que no sea número JSON aporta 0 — en JS `Number(undefined)` es NaN y
-- contaminaba la suma entera del tipo; el motor SIEMPRE escribe `monto`
-- numérico, así que solo diverge ante datos corruptos, y ahí el que no
-- miente es SQL. Solo se desanidan `diferencias` que sean array (otra forma
-- haría fallar `jsonb_array_elements`; JS la ignoraba con `?? []`).
create or replace function public.dinero_observado_por_tipo_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with d as (
    select
      case when jsonb_typeof(e->'tipo') = 'string' then e->>'tipo' else 'otro' end as tipo,
      case when jsonb_typeof(e->'monto') = 'number' then abs((e->>'monto')::numeric) else 0 end as monto
    from liquidacion l
    cross join lateral jsonb_array_elements(l.diferencias) as e
    where l.tenant_id = p_tenant and jsonb_typeof(l.diferencias) = 'array'
  )
  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'monto', monto, 'n', n) order by monto desc, tipo), '[]'::jsonb)
  from (
    select tipo, coalesce(sum(monto), 0) as monto, count(*) as n
    from d
    group by tipo
  ) s;
$$;

comment on function public.dinero_observado_por_tipo_tenant(uuid) is
  'Dinero observado de UNA flota desglosado por tipo de diferencia (|monto| sumado y conteo), jsonb array [{tipo, monto, n}] por monto desc. Reemplaza el traerTodo de liquidacion ENTERA de getDineroObservadoPorTipo (analytics.ts, MAPA #11). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.dinero_observado_por_tipo_tenant(uuid) from public, anon, authenticated;
grant execute on function public.dinero_observado_por_tipo_tenant(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Cierres por día local  →  getLiquidacionesPorDia (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El día es el LOCAL de México (AUDITORÍA 12: un cierre de las 20:00 CDMX
-- caía en la barra del día siguiente al fechar en UTC). La cota `p_desde`
-- la sigue calculando JS (medianoche UTC del día MX más viejo, que solo
-- puede sobrar hacia el pasado); el relleno de la ventana con ceros también.
create or replace function public.liquidaciones_por_dia_tenant(p_tenant uuid, p_desde timestamptz)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'n', n) order by dia), '[]'::jsonb)
  from (
    select to_char((created_at at time zone 'America/Mexico_City')::date, 'YYYY-MM-DD') as dia, count(*) as n
    from liquidacion
    where tenant_id = p_tenant and created_at >= p_desde
    group by 1
  ) s;
$$;

comment on function public.liquidaciones_por_dia_tenant(uuid, timestamptz) is
  'Liquidaciones cerradas de UNA flota por día LOCAL de México desde p_desde, jsonb array [{dia, n}]. Reemplaza el traerTodo de getLiquidacionesPorDia (analytics.ts, MAPA #20). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.liquidaciones_por_dia_tenant(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.liquidaciones_por_dia_tenant(uuid, timestamptz) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Conciliación del consolidado  →  getConciliacionConsolidado (analytics.ts)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tres conteos y un count(distinct). `total = 0` es lo que JS traduce a
-- `null` ("este tenant nunca mandó un consolidado", que no es "0 pendientes").
create or replace function public.conciliacion_consolidado_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'total', count(*),
    'conciliadas', count(*) filter (where estatus = 'conciliada'),
    'sinMatch', count(*) filter (where estatus = 'sin_match'),
    'cfdis', count(distinct cfdi_xml_id)
  )
  from cfdi_consolidado_linea
  where tenant_id = p_tenant;
$$;

comment on function public.conciliacion_consolidado_tenant(uuid) is
  'Resumen de cfdi_consolidado_linea de UNA flota: total, conciliadas, sin_match y CFDI distintos, jsonb. Reemplaza el traerTodo de getConciliacionConsolidado (analytics.ts, MAPA #21). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.conciliacion_consolidado_tenant(uuid) from public, anon, authenticated;
grant execute on function public.conciliacion_consolidado_tenant(uuid) to service_role;
