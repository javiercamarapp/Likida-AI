-- ═══════════════════════════════════════════════════════════════════════════
-- 0153 — resumen_negocio(): los conteos de `viaje`/`gasto` de la consola de
--        superadmin, agregados en SQL (escala 50k viajes/mes, 22-ago-2026).
--
-- `getResumenNegocio` (src/lib/admin/negocio.ts) traía a JS, con `traerTodo`,
-- TODAS las filas de `viaje` (para contar por flota) y TODAS las de `gasto`
-- (para el total histórico y las barras de "facturas por día"), de TODOS los
-- tenants y sin filtro de fecha. `traerTodo` lanza `LecturaIncompleta` a las
-- 100,000 filas: con UN cliente de 50,000 viajes/mes (300,000 gastos/mes),
-- `gasto` rebasa el techo al **día ~10** y las ~17 páginas de /admin que
-- dependen de esta función dejan de cargar (docs/escala-50k/MAPA.md §/admin).
-- Y antes de reventar, pagina por offset O(n²): 100 viajes de red por carga.
--
-- Misma cura que la 0062 le dio a `llm_costo` en esta misma función:
-- contar/agrupar en la base y cruzar la red UNA fila cuyo tamaño depende del
-- número de GRUPOS (flotas, días de la ventana), no del número de viajes.
--
-- ── CROSS-TENANT A PROPÓSITO — léase antes de copiar este molde ─────────────
--
-- Esta función NO lleva `p_tenant`. Es la ÚNICA excepción consciente al molde
-- de la 0112 (`p_tenant uuid` sin default primero), y por la misma razón que
-- `resumen_costo_ia` (0062): alimenta /admin, la consola de Javier
-- (superadmin), que cruza todas las flotas a propósito — CLAUDE.md lo declara
-- ("`lib/admin/negocio.ts` es la única función con ese permiso"). NINGUNA
-- pantalla de /dashboard (el panel del cliente) puede llamarla: no tiene por
-- dónde acotar a una flota, y el día que alguien la importe desde
-- `src/lib/likida/*` la respuesta correcta es una RPC `_tenant` nueva, no un
-- filtro en JS sobre esta.
--
-- Por eso los candados van dobles:
--   · SECURITY INVOKER (el default): la app la llama con `service_role`, que
--     ya salta RLS — un `definer` no daría un permiso más y sí convertiría un
--     `revoke` olvidado en la base entera servida a `anon`. Con `invoker`, la
--     RLS de `viaje`/`gasto` sigue aplicando encima y un `anon` que llegara a
--     ejecutarla vería cero filas.
--   · `revoke ... from public, anon, authenticated` + `grant ... to
--     service_role`: Postgres da EXECUTE a PUBLIC en toda función nueva
--     (lección de la 0054). El bloque 125 de verificaciones.sql lo vigila.
--
-- ── Lo que devuelve (jsonb) ─────────────────────────────────────────────────
--
--   viajesTotal     count(*) de `viaje`, todas las flotas, sin fecha — es el
--                   "Viajes procesados" histórico de la consola.
--   viajesPorTenant [{tenantId, n}] — el `viajes` de cada fila de `flotas`.
--   facturasTotal   count(*) de `gasto`, sin fecha — "Facturas procesadas —
--                   histórico" (contador retro junto al saludo).
--   facturasPorDia  [{dia, n}] SOLO de las filas con `created_at >= p_desde`,
--                   bucket por DÍA LOCAL DE MÉXICO (`at time zone
--                   'America/Mexico_City'`): el mismo corte que `diaMx` hacía
--                   en JS (hallazgo 13-ago: con el día UTC, una factura de
--                   las 7pm de CDMX caía en la barra de MAÑANA). DISPERSA —
--                   solo los días con actividad—; rellenar los ceros de la
--                   ventana sigue siendo del JS, que es quien conoce `hoy`
--                   inyectable y `ventanaDias`.
--
-- `p_desde` acota SOLO `facturasPorDia`. Los dos totales son históricos a
-- propósito: así los rotula la consola ("histórico"), y acotarlos sería un
-- cambio de producto, no de rendimiento. Con `p_desde = null` la serie trae
-- todos los días con actividad (la forma vieja de la reducción JS).
--
-- `coalesce(..., '[]')`: `jsonb_agg` de cero filas es NULL, no `[]`, y el JS
-- valida la FORMA (array) antes de leer — un NULL sería "migración sin
-- aplicar" y lanza, que es lo correcto; pero una base recién levantada con
-- cero gastos NO es ese caso, es un cero medido.
--
-- ── Índices ─────────────────────────────────────────────────────────────────
--
-- 1. `gasto_created_at_idx (created_at)`: `facturasPorDia` filtra por
--    `created_at >= p_desde` SIN tenant (es cross-tenant), y el único índice
--    con fecha en `gasto` es `gasto_tenant_fecha_idx (tenant_id, fecha)` de
--    la 0111 — columna distinta (`fecha` es la del comprobante, `created_at`
--    la de procesamiento, que es la que las barras miden) y prefijo de
--    tenant que esta consulta no da. Sin índice: seq scan de 3.6M filas/año
--    para contar los 7 días de la ventana.
-- 2. `liquidacion_revisar_created_idx (created_at desc) where estatus =
--    'revisar'`: `getLiquidacionesEnRevisar` (bandeja de escalaciones) pasa
--    de traer TODAS las `revisar` cross-tenant a las N más recientes + un
--    `count head`; ambas filtran por `estatus = 'revisar'` sin tenant.
--    `idx_liq_tenant (tenant_id, created_at)` no sirve sin tenant. Parcial:
--    solo indexa las que están en la bandeja (una fracción), y el `order by
--    created_at desc limit N` sale del índice sin ordenar.
--
-- Sin CONCURRENTLY (regla 4 de docs/escala-50k/REGLAS-ESCALA.md: el
-- orquestador decide cómo aplicarlos). PENDIENTE: este worktree no tiene
-- Postgres local (sin docker/psql), así que el EXPLAIN que los justifica
-- queda por correr contra producción ANTES de aplicar:
--   explain (analyze, buffers) select resumen_negocio(now() - interval '7 days');
--   explain (analyze, buffers) select count(*) from liquidacion where estatus = 'revisar';
-- Si el plan ya sale por índice (p. ej. porque otra migración de esta misma
-- ronda creó uno equivalente), los dos `create index` de abajo se quitan.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.resumen_negocio(p_desde timestamptz default null)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
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
$$;

comment on function public.resumen_negocio(timestamptz) is
  'CROSS-TENANT A PROPÓSITO — solo la consola de superadmin (/admin, getResumenNegocio en lib/admin/negocio.ts) vía service_role; jamás desde /dashboard. Conteo de viaje (total y por flota) y de gasto (total histórico + por DÍA LOCAL MX desde p_desde), en jsonb. Reemplaza el traerTodo de viaje y gasto enteros que reventaba al día ~10 con un cliente de 50k viajes/mes (docs/escala-50k/MAPA.md). SECURITY INVOKER; revocada a public/anon/authenticated (mig. 0153).';

revoke all on function public.resumen_negocio(timestamptz) from public, anon, authenticated;
grant execute on function public.resumen_negocio(timestamptz) to service_role;

-- Ver "Índices" en la cabecera: pendientes de EXPLAIN en producción.
create index if not exists gasto_created_at_idx
  on public.gasto (created_at);

create index if not exists liquidacion_revisar_created_idx
  on public.liquidacion (created_at desc)
  where estatus = 'revisar';
