-- ═══════════════════════════════════════════════════════════════════════════
-- 0251 — PRODUCTO_EVENTO: la analítica de producto DENTRO de la app
-- (Frente F; cierra el hueco Q3/Q4 del catálogo de datos_instrumentacion).
--
-- El agente lo venía declarando cada noche, con la spec exacta
-- (ingenieria_producto.ts, Q3): «una tabla producto_evento (tenant_id,
-- pantalla, accion, created_at) — el hermano interno de sitio_evento». Eso es
-- EXACTAMENTE lo que esta migración crea, ni una columna más:
--
--   · SIN usuario, SIN IP, SIN user-agent, SIN cookies — la misma
--     minimización LFPDPPP que sitio_evento (0223). Se registra que UNA
--     FLOTA abrió UNA PANTALLA, jamás quién. Es a propósito: cohortes y
--     activación se miden por tenant; una dimensión de usuario sería
--     recolectar de más para preguntas que hoy nadie hace.
--   · `pantalla` viene del CATÁLOGO de rutas del panel (el único escritor es
--     /api/dashboard/evento, que la valida contra TODAS_LAS_RUTAS y descarta
--     lo demás) — aquí solo se acota la FORMA, como en sitio_evento.
--   · `accion` con dominio CHECK de un solo valor hoy ('pageview'). Cuando
--     el producto necesite acciones de grano fino (qué se completa, no solo
--     qué se abre), el dominio se amplía aquí y en el escritor, juntos.
--
-- Va en EXENTAS-de-bloque con la razón de la casa (la misma que la 0223): la
-- capa 1 de la batería barre TODO el catálogo buscando tablas sin RLS y
-- grants de más, y el bloque E barre el search_path de TODAS las funciones de
-- public — un bloque dedicado repetiría esas aserciones globales. No hay
-- unicidad ni atomicidad que la base sea la única en demostrar: es un conteo
-- append-only.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.producto_evento (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  -- La pantalla del panel ('viajes', 'agentes/liquidacion', 'resumen', …).
  -- Lista cerrada validada en el código contra el catálogo de rutas; aquí
  -- solo la forma.
  pantalla   text not null
    constraint producto_evento_pantalla_forma check (length(pantalla) between 1 and 80),
  accion     text not null
    constraint producto_evento_accion_dominio check (accion in ('pageview')),
  created_at timestamptz not null default now()
);

-- Las dos consultas reales: cohortes/actividad por flota en el tiempo, y
-- (mañana) adopción por pantalla dentro de una flota.
create index if not exists producto_evento_tenant_dia_idx
  on public.producto_evento (tenant_id, created_at);

comment on table public.producto_evento is
  'Analítica mínima del producto autenticado (0251): pageviews por pantalla y por flota, sin ningún dato del usuario (ni quién, ni IP, ni UA — minimización LFPDPPP, mismo criterio que sitio_evento). El único escritor es /api/dashboard/evento (sesión + límite de tasa + catálogo cerrado de pantallas); los lectores son /admin/crecimiento y el parte de datos_instrumentacion.';

-- Mismo doble candado que 0223: RLS deny-all + solo service_role.
alter table public.producto_evento enable row level security;
revoke all on table public.producto_evento from public, anon, authenticated;
grant select, insert on table public.producto_evento to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Los dos agregados que /admin/crecimiento necesita, en SQL y no en JS (el
-- patrón de la 0112: sum()/count() en la base, UN viaje de red — un GROUP BY
-- mensual traído fila por fila a JavaScript tendría fecha de caducidad).
-- ─────────────────────────────────────────────────────────────────────────────

-- El embudo activados → de pago (Q2 del catálogo: «falta la CONSULTA, no el
-- dato»). Tres conteos sobre tablas que existen desde la 0001/0052:
--   altas     = tenants dados de alta (incluye el demo; el lector lo dice).
--   activadas = tenants con AL MENOS una liquidación — la definición de
--               activación que Q2 ya fijó: llegó a su primera liquidación.
--   de_pago   = tenants con una suscripción en estado 'activa' (0052). Ni
--               'prueba' ni 'morosa' cuentan como pagando: sería inventar.
create or replace function public.embudo_activacion()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'altas',     (select count(*) from tenant),
    'activadas', (select count(distinct l.tenant_id) from liquidacion l),
    'de_pago',   (select count(*) from tenant t
                    where exists (select 1 from suscripcion s
                                   where s.tenant_id = t.id and s.estado = 'activa'))
  );
$$;

revoke all on function public.embudo_activacion() from public, anon, authenticated;
grant execute on function public.embudo_activacion() to service_role;

-- El uso mensual por flota — el sustrato de las cohortes de retención (Q4).
-- Mes LOCAL de México, el mismo criterio de corte que resumen_negocio():
-- una sesión de las 11 pm del 31 en CDMX no es uso de octubre.
create or replace function public.uso_producto_mensual()
returns table (tenant_id uuid, mes date, eventos bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select pe.tenant_id,
         (date_trunc('month', pe.created_at at time zone 'America/Mexico_City'))::date as mes,
         count(*) as eventos
    from producto_evento pe
   group by 1, 2
   order by 1, 2;
$$;

revoke all on function public.uso_producto_mensual() from public, anon, authenticated;
grant execute on function public.uso_producto_mensual() to service_role;
