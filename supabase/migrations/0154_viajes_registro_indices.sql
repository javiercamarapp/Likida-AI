-- ═══════════════════════════════════════════════════════════════════════════
-- 0154 — /dashboard/viajes a escala de 50k viajes/mes: keyset, trigramas y UN
-- conteo (docs/escala-50k/MAPA.md, sección "/dashboard/viajes").
--
-- Lo que había (analytics.ts:getViajesRegistro + viajes/page.tsx):
--   · `?p=N` hasta 1000 → `.range()` = OFFSET de hasta 100,000 filas. Postgres
--     LEE y DESCARTA las 100,000 anteriores en cada carga: O(posición).
--   · `.or(folio.ilike.%q%, origen.ilike…, destino.ilike…)` sin índice que
--     sirva un `%…%`: seq scan (o index scan por tenant + filtro) sobre los
--     600k viajes del año.
--   · `order by fecha_inicio desc nulls last, created_at desc` sin índice en
--     ese orden: el único (tenant_id, fecha_inicio) de la 0111 es ASC sin
--     desempate, así que toda página ordenaba en memoria.
--   · 4 `count exact` (total, abiertos, en cuadre, liquidados) + 1 más de
--     escalados = CINCO barridos de los 600k por carga de la página.
--
-- ── LO QUE PROBÓ EL EXPLAIN (22-ago-2026, tabla temporal de 400,000 viajes,
--    2 tenants × 200,000, 5 % con fecha_inicio nula, misma forma de índice) ──
--
--   OFFSET 100000 LIMIT 101 (lo viejo):
--     Index Only Scan … rows=100101  Buffers: hit=92134 read=8790  2,159 ms
--
--   Keyset con OR "a mano" (fecha < F or (fecha = F and created < C) or …):
--     Index Only Scan … Filter … Rows Removed by Filter: 90000
--     Buffers: hit=85812 read=5030  1,822 ms
--     → el OR NO se vuelve Index Cond: sigue leyendo todo lo anterior al
--       cursor. Por eso NO se implementó con `.or()` de PostgREST.
--
--   Keyset con comparación de fila (ROW(fecha, created, id) < ROW(F, C, ID))
--   + rama aparte para fecha_inicio IS NULL, unidas con MERGE APPEND:
--     Merge Append
--       -> Index Only Scan … Index Cond: (tenant_id = … AND ROW(fecha_inicio,
--          created_at, id) < ROW(…))   rows=101
--       -> Index Only Scan … Index Cond: (tenant_id = … AND fecha_inicio IS NULL)
--     Buffers: hit=1 read=108   (vs 100,924 del OFFSET: ~930× menos páginas)
--     → esto SOLO ocurre si (a) el ORDER BY de cada rama dice `desc nulls
--       last` IGUAL que el índice (un `desc` a secas es `nulls first` en
--       Postgres y el planificador mete un Sort top-N sobre 90,000 filas —
--       se midió: 326 ms y 95,757 buffers), y (b) el índice lleva `id desc`
--       como tercer desempate, porque la comparación de fila exige que TODAS
--       sus columnas estén en el índice en la misma dirección.
--
--   Conteos: `count(*) filter (where …)` ×5 sobre (tenant_id, estatus):
--     Aggregate -> Index Scan using (tenant_id, estatus)  rows=200000  798 ms
--     → UN barrido en vez de cinco. Sigue siendo O(n) —contar es contar—,
--       pero es 1 viaje de red y 1 lectura, no 5.
--
--   ilike '%q%' sin trigramas: Index Scan por tenant + Filter, Rows Removed
--   by Filter: 199,944, 1,095 ms. Con GIN pg_trgm el `~~*` (ILIKE) entra como
--   condición de índice (pg_trgm soporta ILIKE desde 9.1); no se pudo medir
--   en la temporal porque crear la extensión es DDL de producción, que esta
--   migración no aplica (regla 3). Queda anotado como el único índice de los
--   tres sin EXPLAIN propio — si el orquestador lo prefiere, se aplica en una
--   segunda pasada tras ver pg_stat_user_indexes.
--
-- ── pg_trgm en `extensions`, no en `public` ─────────────────────────────────
-- Supabase instala las extensiones en el esquema `extensions` (pgcrypto,
-- uuid-ossp y pg_stat_statements ya viven ahí). Los operadores `~~*`/`ilike`
-- son del catálogo, así que el índice se usa sin tocar el search_path; solo
-- la opclass se nombra calificada (`extensions.gin_trgm_ops`).
--
-- Índices sin CONCURRENTLY a propósito (regla 4): el orquestador decide cómo
-- aplicarlos. Hoy `viaje` tiene 0 filas (sin clientes), así que el bloqueo es
-- de milisegundos.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm with schema extensions;

-- El índice del keyset. Dirección y nulls EXACTAMENTE como el ORDER BY del
-- registro; `id desc` para que la comparación de fila sea Index Cond.
create index if not exists viaje_registro_keyset_idx
  on public.viaje (tenant_id, fecha_inicio desc nulls last, created_at desc, id desc);

comment on index public.viaje_registro_keyset_idx is
  'Paginación por cursor (keyset) de /dashboard/viajes: viajes_registro_tenant (0154). Orden = el del registro: inicio más reciente primero, sin fecha al final, desempate created_at desc, id desc. EXPLAIN en la cabecera de la 0154: 108 buffers por página vs 100,924 con OFFSET 100k.';

-- Búsqueda por folio / origen / destino con `%q%`. Un solo GIN multicolumna:
-- los tres `ilike` van en OR y el planificador arma un BitmapOr sobre el
-- mismo índice. Sin tenant_id: GIN no ordena, y el filtro de tenant se
-- aplica después sobre las pocas filas que traen el trigramas.
create index if not exists viaje_busqueda_trgm_idx
  on public.viaje using gin (folio extensions.gin_trgm_ops, origen extensions.gin_trgm_ops, destino extensions.gin_trgm_ops);

comment on index public.viaje_busqueda_trgm_idx is
  'Trigramas (pg_trgm en schema extensions) para la búsqueda `%q%` de /dashboard/viajes (viajes_registro_tenant, 0154). Sin esto, `ilike` es un barrido del tenant entero (EXPLAIN: Rows Removed by Filter 199,944 de 200,000).';

-- El filtro de estatus, UNA vez, inmutable e inlineable: el mismo predicado
-- que tenía getViajesRegistro en JS (abiertos/en_cuadre/liquidados por
-- estatus; escalados = abierto|en_cuadre + escalado_en sin aceptado_en).
create or replace function public.viaje_registro_pasa_filtro(
  p_estatus text, p_escalado_en timestamptz, p_aceptado_en timestamptz, p_filtro text
)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_catalog
as $$
  select case p_filtro
    when 'abiertos'  then p_estatus = 'abierto'
    when 'en_cuadre' then p_estatus = 'en_cuadre'
    when 'liquidados' then p_estatus = 'liquidado'
    when 'escalados' then p_estatus in ('abierto', 'en_cuadre') and p_escalado_en is not null and p_aceptado_en is null
    else true
  end;
$$;

-- ── viajes_registro_tenant: una página del registro, por cursor ─────────────
--
-- plpgsql y no `language sql` (desviación del molde 0112, a propósito): el
-- keyset necesita TRES formas de consulta distintas (sin cursor / cursor con
-- fecha / cursor ya dentro de los sin-fecha) y cada una debe llegar al
-- planificador con su predicado ya fijo para que la comparación de fila sea
-- Index Cond. En una sola SELECT con `(p_cursor_id is null or …)` el plan
-- genérico pierde el índice. Lo demás del molde se conserva: SECURITY
-- INVOKER, p_tenant sin default, stable, search_path fijo, revoke/grant.
--
-- `p_limite` se topa a 100 AQUÍ, no solo en JS: un llamador con el service
-- role que pida 10,000 recibe 100. `hayMas` lo decide el llamador pidiendo
-- limite+1 (la función devuelve hasta p_limite+1 filas por eso el tope real
-- es 101).
--
-- Orden del resultado = orden del índice. Cada rama repite el ORDER BY con
-- `nulls last` explícito (ver EXPLAIN arriba: sin eso, Sort de 90k filas).
create or replace function public.viajes_registro_tenant(
  p_tenant uuid,
  p_filtro text default 'todos',
  p_q text default null,
  p_cursor_fecha date default null,
  p_cursor_created timestamptz default null,
  p_cursor_id uuid default null,
  p_limite int default 100
)
returns jsonb
language plpgsql
stable
parallel safe
set search_path = public, pg_catalog
as $$
declare
  v_limite int := least(greatest(coalesce(p_limite, 100), 1), 100) + 1;
  v_patron text := case when nullif(btrim(p_q), '') is null then null else '%' || btrim(p_q) || '%' end;
  v_filtro text := coalesce(p_filtro, 'todos');
  v_res jsonb;
begin
  if v_filtro not in ('todos', 'abiertos', 'en_cuadre', 'liquidados', 'escalados') then
    raise exception 'viajes_registro_tenant: filtro desconocido %', v_filtro using errcode = '22023';
  end if;

  if p_cursor_id is null then
    -- Primera página: las dos ramas completas, MERGE APPEND las intercala.
    select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into v_res from (
      (select v.id, v.folio, v.origen, v.destino, v.estatus, v.anticipo, v.fecha_inicio, v.created_at,
              v.intake_pendientes, v.avisado_en, v.aceptado_en, v.escalado_en, v.avisos_enviados, v.unidad_id,
              o.nombre as operador_nombre, u.numero_economico as unidad_eco
         from public.viaje v
         left join public.operador o on o.id = v.operador_id
         left join public.unidad u on u.id = v.unidad_id
        where v.tenant_id = p_tenant and v.fecha_inicio is not null
          and public.viaje_registro_pasa_filtro(v.estatus, v.escalado_en, v.aceptado_en, v_filtro)
          and (v_patron is null or v.folio ilike v_patron or v.origen ilike v_patron or v.destino ilike v_patron)
        order by v.fecha_inicio desc nulls last, v.created_at desc, v.id desc
        limit v_limite)
      union all
      (select v.id, v.folio, v.origen, v.destino, v.estatus, v.anticipo, v.fecha_inicio, v.created_at,
              v.intake_pendientes, v.avisado_en, v.aceptado_en, v.escalado_en, v.avisos_enviados, v.unidad_id,
              o.nombre, u.numero_economico
         from public.viaje v
         left join public.operador o on o.id = v.operador_id
         left join public.unidad u on u.id = v.unidad_id
        where v.tenant_id = p_tenant and v.fecha_inicio is null
          and public.viaje_registro_pasa_filtro(v.estatus, v.escalado_en, v.aceptado_en, v_filtro)
          and (v_patron is null or v.folio ilike v_patron or v.origen ilike v_patron or v.destino ilike v_patron)
        order by v.fecha_inicio desc nulls last, v.created_at desc, v.id desc
        limit v_limite)
      order by fecha_inicio desc nulls last, created_at desc, id desc
      limit v_limite
    ) f;
  elsif p_cursor_fecha is not null then
    -- Cursor dentro de los viajes CON fecha: comparación de fila (Index Cond)
    -- + todos los sin-fecha, que van después por definición del orden.
    select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into v_res from (
      (select v.id, v.folio, v.origen, v.destino, v.estatus, v.anticipo, v.fecha_inicio, v.created_at,
              v.intake_pendientes, v.avisado_en, v.aceptado_en, v.escalado_en, v.avisos_enviados, v.unidad_id,
              o.nombre as operador_nombre, u.numero_economico as unidad_eco
         from public.viaje v
         left join public.operador o on o.id = v.operador_id
         left join public.unidad u on u.id = v.unidad_id
        where v.tenant_id = p_tenant
          and (v.fecha_inicio, v.created_at, v.id) < (p_cursor_fecha, p_cursor_created, p_cursor_id)
          and public.viaje_registro_pasa_filtro(v.estatus, v.escalado_en, v.aceptado_en, v_filtro)
          and (v_patron is null or v.folio ilike v_patron or v.origen ilike v_patron or v.destino ilike v_patron)
        order by v.fecha_inicio desc nulls last, v.created_at desc, v.id desc
        limit v_limite)
      union all
      (select v.id, v.folio, v.origen, v.destino, v.estatus, v.anticipo, v.fecha_inicio, v.created_at,
              v.intake_pendientes, v.avisado_en, v.aceptado_en, v.escalado_en, v.avisos_enviados, v.unidad_id,
              o.nombre, u.numero_economico
         from public.viaje v
         left join public.operador o on o.id = v.operador_id
         left join public.unidad u on u.id = v.unidad_id
        where v.tenant_id = p_tenant and v.fecha_inicio is null
          and public.viaje_registro_pasa_filtro(v.estatus, v.escalado_en, v.aceptado_en, v_filtro)
          and (v_patron is null or v.folio ilike v_patron or v.origen ilike v_patron or v.destino ilike v_patron)
        order by v.fecha_inicio desc nulls last, v.created_at desc, v.id desc
        limit v_limite)
      order by fecha_inicio desc nulls last, created_at desc, id desc
      limit v_limite
    ) f;
  else
    -- Cursor ya dentro de los SIN fecha: solo queda esa cola.
    select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into v_res from (
      select v.id, v.folio, v.origen, v.destino, v.estatus, v.anticipo, v.fecha_inicio, v.created_at,
             v.intake_pendientes, v.avisado_en, v.aceptado_en, v.escalado_en, v.avisos_enviados, v.unidad_id,
             o.nombre as operador_nombre, u.numero_economico as unidad_eco
        from public.viaje v
        left join public.operador o on o.id = v.operador_id
        left join public.unidad u on u.id = v.unidad_id
       where v.tenant_id = p_tenant and v.fecha_inicio is null
         and (v.created_at, v.id) < (p_cursor_created, p_cursor_id)
         and public.viaje_registro_pasa_filtro(v.estatus, v.escalado_en, v.aceptado_en, v_filtro)
         and (v_patron is null or v.folio ilike v_patron or v.origen ilike v_patron or v.destino ilike v_patron)
       order by v.fecha_inicio desc nulls last, v.created_at desc, v.id desc
       limit v_limite
    ) f;
  end if;

  return v_res;
end;
$$;

comment on function public.viajes_registro_tenant(uuid, text, text, date, timestamptz, uuid, int) is
  'Una página (≤100, devuelve limite+1 para que el llamador sepa si hay más) del Registro de Viajes de UNA flota, por cursor keyset (fecha_inicio desc nulls last, created_at desc, id desc) — sin OFFSET. Filtro de estatus y búsqueda %q% (GIN pg_trgm) dentro. Reemplaza el .range() de getViajesRegistro (analytics.ts) que a 50k viajes/mes leía y tiraba hasta 100,000 filas por página. SECURITY INVOKER; p_tenant sin default. EXPLAIN en la 0154.';

comment on function public.viaje_registro_pasa_filtro(text, timestamptz, timestamptz, text) is
  'Predicado del filtro del Registro de Viajes (todos/abiertos/en_cuadre/liquidados/escalados), compartido por las tres ramas de viajes_registro_tenant (0154).';

revoke all on function public.viajes_registro_tenant(uuid, text, text, date, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function public.viajes_registro_tenant(uuid, text, text, date, timestamptz, uuid, int) to service_role;
revoke all on function public.viaje_registro_pasa_filtro(text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.viaje_registro_pasa_filtro(text, timestamptz, timestamptz, text) to service_role;

-- ── conteos_viajes_tenant: los cinco conteos del encabezado en UN barrido ────
-- Molde 0112 tal cual. `count(*)` nunca es null, pero el coalesce va igual
-- por el molde. Un tenant sin viajes devuelve ceros: es una MEDICIÓN (cero
-- viajes), no un hueco; el hueco es el error, que en JS degrada a null.
create or replace function public.conteos_viajes_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'total',      coalesce(count(*), 0),
    'abiertos',   coalesce(count(*) filter (where estatus = 'abierto'), 0),
    'enCuadre',   coalesce(count(*) filter (where estatus = 'en_cuadre'), 0),
    'liquidados', coalesce(count(*) filter (where estatus = 'liquidado'), 0),
    'escalados',  coalesce(count(*) filter (where estatus in ('abierto', 'en_cuadre') and escalado_en is not null and aceptado_en is null), 0)
  )
  from public.viaje
  where tenant_id = p_tenant;
$$;

comment on function public.conteos_viajes_tenant(uuid) is
  'Los cinco conteos del encabezado de /dashboard/viajes (total, abiertos, enCuadre, liquidados, escalados) en UNA lectura de (tenant_id, estatus), en vez de 5 count exact por carga. Mismos predicados que contarViajes/contarEscalados (analytics.ts). SECURITY INVOKER; p_tenant sin default. Ver 0154.';

revoke all on function public.conteos_viajes_tenant(uuid) from public, anon, authenticated;
grant execute on function public.conteos_viajes_tenant(uuid) to service_role;
