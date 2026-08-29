-- ═══════════════════════════════════════════════════════════════════════════
-- 0259 · `producto_evento` DEJA DE CRECER SIN TECHO Y SU RPC DEJA DE AGRUPAR
-- LA TABLA ENTERA — auditoría adversarial tandas 21-24, hallazgo 3 (MEDIO).
--
-- ── LO MEDIDO ───────────────────────────────────────────────────────────────
--
-- La 0251 creó `producto_evento` (una fila por pageview, append-only) y
-- `uso_producto_mensual()` con un GROUP BY sobre TODA la tabla, sin rango. El
-- índice (tenant_id, created_at) no sirve a un GROUP BY global por mes con
-- `at time zone`. Consumidor: instrumentacion.ts:161-166 desde
-- /admin/crecimiento, que es `force-dynamic` — cada visita dispara un escaneo
-- completo. Y `mantenimiento_de_datos` no la conoce: la 0251 es posterior a
-- la 0245 y nadie la añadió después. Con 200 flotas y el tope declarado del
-- escritor, son millones de filas al año.
--
-- ── EL ARREGLO: el patrón que la casa YA tiene y no se aplicó ───────────────
--
-- Lo mismo que `llm_costo` (0072 consolida, 0155 purga el detalle):
--
--   1. `producto_evento_mensual` — (tenant, mes, eventos), el grano que
--      /admin/crecimiento de verdad lee (cohortes mensuales).
--   2. `mantener_producto_evento()` — consolida los meses CERRADOS y DESPUÉS
--      purga el detalle viejo, en ese orden y en la misma función: si la
--      consolidación truena, la purga no corre (fail-closed — jamás se borra
--      detalle que no quedó consolidado).
--   3. `uso_producto_mensual()` conserva nombre, firma y grano (mes LOCAL de
--      México, el mismo criterio de corte que resumen_negocio) pero ahora lee
--      el consolidado (pequeño) + el detalle que quede (acotado por la
--      purga). FULL JOIN prefiriendo el consolidado: si la consolidación se
--      atrasara, el mes sin consolidar sigue contando desde el detalle — el
--      lector NUNCA ve una cifra que encoge (regla 1 de la casa).
--
-- ── LAS TRES DECISIONES ARGUMENTADAS ────────────────────────────────────────
--
--   · Consolidación con `on conflict do nothing`, NO `do update`: el mes
--     cerrado de una tabla append-only con `created_at default now()` es
--     INMUTABLE (el escritor único, /api/dashboard/evento, no backdatea).
--     Re-agregar tras la purga con `do update` REESCRIBIRÍA el mes desde un
--     detalle ya parcial y la cifra encogería en silencio — exactamente la
--     clase de número que la casa no admite. El snapshot del cierre es la
--     verdad y no se toca.
--   · Purga a 92 días por default, piso duro de 62 (PU001): 62 garantiza que
--     todo mes purgable lleva ≥1 mes entero cerrado y consolidado por el cron
--     nocturno ANTES de que su detalle muera; 92 deja un trimestre de detalle
--     crudo para depurar el escritor (rate limit, catálogo de pantallas) sin
--     que la tabla vuelva a crecer sin techo.
--   · Mes LOCAL MX también en la consolidación: el bucket del consolidado
--     tiene que ser EL MISMO que el del lector — consolidar en UTC y leer en
--     MX partiría las cohortes en la frontera del mes. El corte se convierte
--     a timestamptz una vez (`corte_ts`) para que el filtro por `created_at`
--     siga siendo sargable.
--
-- ── POR QUÉ NO SE REDEFINE `mantenimiento_de_datos` AQUÍ ────────────────────
--
-- El PR del hallazgo 1 (0258) redefine `mantenimiento_de_datos` desde master,
-- y la regla de la casa es que cada PR salga de master sin apilarse (el
-- squash pierde el apilado sin señal). Dos redefiniciones independientes de
-- la misma función harían que la que migre después BORRE las llaves de la
-- otra. Por eso el cron (/api/cron/purgar) llama a `mantener_producto_evento`
-- como RPC hermana — mismo cron, mismo horario, fallo visible propio — y la
-- PRÓXIMA migración que redefina `mantenimiento_de_datos` puede absorberla
-- conservando TODAS las llaves (los bloques 120/127/137/201 lo vigilan).
--
-- ── Idempotencia ────────────────────────────────────────────────────────────
-- `create table/index if not exists`, `create or replace function`,
-- consolidación con `on conflict do nothing`. Re-aplicarla no cambia nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El consolidado mensual ───────────────────────────────────────────────
create table if not exists public.producto_evento_mensual (
  tenant_id      uuid        not null references public.tenant(id) on delete cascade,
  -- Primer día del mes, en hora LOCAL de México (el grano del lector).
  mes            date        not null,
  eventos        bigint      not null default 0,
  consolidado_en timestamptz not null default now(),
  primary key (tenant_id, mes),
  constraint producto_evento_mensual_mes_es_dia_1
    check (date_trunc('month', mes::timestamp)::date = mes),
  constraint producto_evento_mensual_no_negativo check (eventos >= 0)
);

comment on table public.producto_evento_mensual is
  'El uso mensual por flota, consolidado (0259, patrón de llm_costo_mensual 0072): una fila por (tenant, mes local MX) con su conteo de pageviews, escrita al cerrar el mes por mantener_producto_evento(). Es lo que uso_producto_mensual() lee para los meses cerrados; el detalle (producto_evento) se purga a los ~92 días. El snapshot del cierre es inmutable: on conflict do nothing, jamás se reescribe desde un detalle ya parcial.';

alter table public.producto_evento_mensual enable row level security;
revoke all on table public.producto_evento_mensual from public, anon, authenticated;
grant select on table public.producto_evento_mensual to service_role;

-- ── 2. El índice que la purga necesita ──────────────────────────────────────
-- purgar_en_tandas borra por `created_at < corte` sin tenant; el índice de la
-- 0251 (tenant_id, created_at) no le sirve. La primera corrida barre el
-- backlog completo y las siguientes lo mantienen a raya.
create index if not exists producto_evento_creado_idx
  on public.producto_evento (created_at);

-- ── 3. Consolidar y DESPUÉS purgar, en una sola función ─────────────────────
create or replace function public.mantener_producto_evento(
  p_dias integer default 92,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- El primer día del mes EN CURSO, en local MX; todo lo anterior está cerrado.
  corte date := date_trunc('month', p_ahora at time zone 'America/Mexico_City')::date;
  corte_ts timestamptz := (date_trunc('month', p_ahora at time zone 'America/Mexico_City'))
                            at time zone 'America/Mexico_City';
  consolidados bigint;
  purga jsonb;
begin
  if p_dias < 62 then
    -- Menos de dos meses permitiría purgar detalle de un mes que todavía no
    -- se consolidó. Se falla cerrado y se dice por qué.
    raise exception 'mantener_producto_evento: % días es demasiado poco; el mínimo es 62 (el mes debe cerrar y consolidarse antes de morir su detalle)', p_dias
      using errcode = 'PU001';
  end if;

  -- Los meses cerrados, al consolidado. `do nothing`: el mes cerrado es
  -- inmutable y su snapshot no se reescribe (ver cabecera — un `do update`
  -- tras la purga encogería la cifra en silencio).
  insert into public.producto_evento_mensual as m (tenant_id, mes, eventos, consolidado_en)
  select pe.tenant_id,
         date_trunc('month', pe.created_at at time zone 'America/Mexico_City')::date,
         count(*),
         now()
    from public.producto_evento pe
   where pe.created_at < corte_ts
   group by 1, 2
  on conflict (tenant_id, mes) do nothing;
  get diagnostics consolidados = row_count;

  -- La purga corre SOLO si la consolidación no lanzó (misma función, en
  -- orden): el detalle viejo ya está en el consolidado cuando muere.
  purga := public.purgar_en_tandas(
    'public.producto_evento'::regclass,
    format('created_at < %L', p_ahora - make_interval(days => p_dias)),
    p_vence);

  return jsonb_build_object(
    'mesesConsolidados', consolidados,
    'detalleBorrado', coalesce((purga->>'borradas')::bigint, 0),
    'parcial', coalesce((purga->>'parcial')::boolean, false)
  );
end;
$$;

comment on function public.mantener_producto_evento is
  'Consolida los meses CERRADOS (local MX) de producto_evento en producto_evento_mensual y DESPUÉS purga el detalle de más de p_dias (default 92, mínimo 62 — PU001), en ese orden y fail-closed: si la consolidación lanza, la purga no corre. La llama el cron /api/cron/purgar como RPC hermana de mantenimiento_de_datos (0259: dos PRs independientes no deben redefinir la misma función desde master).';

revoke all on function public.mantener_producto_evento(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.mantener_producto_evento(integer, timestamptz, timestamptz) to service_role;

-- ── 4. El lector conserva nombre, firma y grano — y pierde el escaneo ───────
-- FULL JOIN prefiriendo el consolidado: un mes en ambos lados (cerrado y aún
-- sin purgar) sale del consolidado; un mes SOLO en el detalle (el mes en
-- curso, o un cerrado cuya consolidación se atrasó) sale del detalle. El
-- lector jamás ve encoger una cifra por el estado interno del mantenimiento.
-- El GROUP BY del detalle se queda, pero sobre una tabla ACOTADA por la purga
-- (≈un trimestre), no sobre años de filas.
create or replace function public.uso_producto_mensual()
returns table (tenant_id uuid, mes date, eventos bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with detalle as (
    select pe.tenant_id,
           (date_trunc('month', pe.created_at at time zone 'America/Mexico_City'))::date as mes,
           count(*) as eventos
      from producto_evento pe
     group by 1, 2
  )
  select coalesce(m.tenant_id, d.tenant_id) as tenant_id,
         coalesce(m.mes, d.mes) as mes,
         coalesce(m.eventos, d.eventos) as eventos
    from producto_evento_mensual m
    full join detalle d on d.tenant_id = m.tenant_id and d.mes = m.mes
   order by 1, 2;
$$;

comment on function public.uso_producto_mensual is
  'El uso mensual por flota (0251 → 0259): meses cerrados desde el consolidado producto_evento_mensual, el mes en curso (y cualquier cerrado aún sin consolidar) desde el detalle acotado por la purga. Mes LOCAL de México en los dos lados — el mismo criterio de corte que resumen_negocio(). Mismo nombre, firma y grano que la 0251: instrumentacion.ts no cambia.';

revoke all on function public.uso_producto_mensual() from public, anon, authenticated;
grant execute on function public.uso_producto_mensual() to service_role;
