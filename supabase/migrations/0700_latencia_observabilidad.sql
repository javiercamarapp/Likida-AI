-- ═══════════════════════════════════════════════════════════════════════════
-- 0700 — LATENCIAS MEDIDAS: p50/p95 por ruta, por cron y por fase de IA
--        (ola enterprise E1-A, E18 y parte de P1-14).
--
-- `/admin/observabilidad` declaraba que la latencia «no se instrumenta hoy».
-- Sin esa cifra no se puede demostrar un SLA (E4) ni cazar una regresión de
-- rendimiento antes de que la vea un cliente.
--
-- Qué agrega, y por qué así:
--
--   1. `latencia_muestra`: UNA fila por muestra (tipo ruta|cron, nombre, ms,
--      ok). Escritura barata y ACOTADA por tres lados: los crons escriben una
--      fila por corrida (≈ 6,000/día en total, no por petición); las rutas
--      escriben solo una MUESTRA (1 de cada N, lo decide la app); y la
--      retención (`mantener_observabilidad`, 14 días por omisión) borra en
--      tandas con índice, sin recorrer la tabla. Sin tenant_id a propósito: es
--      una métrica de la plataforma (no lleva dato de ninguna flota ni de
--      ninguna persona: solo el nombre de la ruta o del cron) y RLS queda
--      deny-all, como `cron_latido`.
--   2. `latencia_percentiles(tipo, desde, hasta)`: el p50 y el p95 se calculan
--      EN SQL con `percentile_disc` (rango más cercano: un valor que de verdad
--      ocurrió, el mismo estadístico que `slo_agente_corrida`, 0162) — nunca
--      trayendo filas para ordenarlas en JS (PostgREST recorta a 1,000 filas
--      en silencio: el defecto FE-8).
--   3. `llm_costo.duracion_ms` (nullable: las filas viejas NO se inventan) y
--      `llm_costo_percentiles(desde, hasta)` por fase. Un índice por
--      `created_at` deja que la lectura de una ventana no recorra la tabla de
--      200k filas/mes.
--
-- Idempotente (`if not exists`, `create or replace`, `drop constraint if
-- exists`). NO se aplica a producción desde aquí.
--
-- PARA DESHACER:
--   drop function public.llm_costo_percentiles(timestamptz, timestamptz);
--   drop function public.latencia_percentiles(text, timestamptz, timestamptz);
--   drop function public.purgar_latencia(timestamptz, integer, integer);
--   drop table public.latencia_muestra;
--   drop index public.llm_costo_creado_idx;
--   alter table public.llm_costo drop column duracion_ms;
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La tabla de muestras ──────────────────────────────────────────────────
create table if not exists public.latencia_muestra (
  id        bigint generated always as identity primary key,
  tipo      text not null,
  nombre    text not null,
  ms        integer not null,
  ok        boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint latencia_muestra_tipo_dominio check (tipo in ('ruta', 'cron')),
  constraint latencia_muestra_nombre_largo check (char_length(nombre) between 1 and 120),
  -- Un tope de una hora: un valor mayor es un reloj roto, no una latencia.
  constraint latencia_muestra_ms_rango check (ms between 0 and 3600000)
);

comment on table public.latencia_muestra is
  'Muestras de latencia de rutas (muestreadas) y crons (una por corrida) — E1-A, 0700. Sin tenant_id: métrica de plataforma sin datos de flota. Deny-all: solo el servidor. Retención por purgar_latencia().';

-- La lectura agrupa por (tipo, nombre) dentro de una ventana de tiempo; la
-- retención borra por `creado_en`. Un índice para cada acceso.
create index if not exists latencia_muestra_lectura_idx
  on public.latencia_muestra (tipo, nombre, creado_en desc);
create index if not exists latencia_muestra_creado_idx
  on public.latencia_muestra (creado_en);

alter table public.latencia_muestra enable row level security;
revoke all on public.latencia_muestra from public, anon, authenticated;

-- ── 2. p50/p95 en SQL ────────────────────────────────────────────────────────
-- SECURITY INVOKER + revoke: la app la llama con `service_role` (que salta RLS);
-- ningún otro rol la ejecuta (Postgres da EXECUTE a PUBLIC en toda función
-- nueva — lección de la 0054). Los 100 nombres más cargados: un tope en la
-- salida, no en la entrada.
create or replace function public.latencia_percentiles(
  p_tipo text,
  p_desde timestamptz,
  p_hasta timestamptz default now()
) returns table (nombre text, muestras bigint, fallos bigint, p50_ms integer, p95_ms integer, max_ms integer)
language sql
stable
set search_path = public, pg_catalog
as $$
  select m.nombre,
         count(*)::bigint,
         count(*) filter (where not m.ok)::bigint,
         percentile_disc(0.5)  within group (order by m.ms)::integer,
         percentile_disc(0.95) within group (order by m.ms)::integer,
         max(m.ms)::integer
    from public.latencia_muestra m
   where m.tipo = p_tipo and m.creado_en >= p_desde and m.creado_en < p_hasta
   group by m.nombre
   order by count(*) desc, m.nombre
   limit 100;
$$;

revoke all on function public.latencia_percentiles(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.latencia_percentiles(text, timestamptz, timestamptz) to service_role;

-- ── 3. La duración de cada llamada de IA ─────────────────────────────────────
alter table public.llm_costo add column if not exists duracion_ms integer;
alter table public.llm_costo drop constraint if exists llm_costo_duracion_rango;
alter table public.llm_costo
  add constraint llm_costo_duracion_rango check (duracion_ms is null or duracion_ms between 0 and 3600000);

comment on column public.llm_costo.duracion_ms is
  'Cuánto tardó la llamada al modelo, en ms (E1-A, 0700). NULL = no se midió (filas anteriores a la 0700 o llamadores sin cronómetro): NO es cero.';

create index if not exists llm_costo_creado_idx
  on public.llm_costo (created_at);

create or replace function public.llm_costo_percentiles(
  p_desde timestamptz,
  p_hasta timestamptz default now()
) returns table (fase text, muestras bigint, sin_duracion bigint, p50_ms integer, p95_ms integer, max_ms integer)
language sql
stable
set search_path = public, pg_catalog
as $$
  select c.fase,
         count(*) filter (where c.duracion_ms is not null)::bigint,
         count(*) filter (where c.duracion_ms is null)::bigint,
         (percentile_disc(0.5)  within group (order by c.duracion_ms))::integer,
         (percentile_disc(0.95) within group (order by c.duracion_ms))::integer,
         max(c.duracion_ms)::integer
    from public.llm_costo c
   where c.created_at >= p_desde and c.created_at < p_hasta
   group by c.fase
   order by c.fase;
$$;

revoke all on function public.llm_costo_percentiles(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.llm_costo_percentiles(timestamptz, timestamptz) to service_role;

-- ── 4. La retención de las muestras ──────────────────────────────────────────
-- Borra lo anterior a `p_dias` en UNA tanda de `p_lote` filas (entra por
-- `latencia_muestra_creado_idx`; no recorre la tabla). Devuelve `parcial: true`
-- si quedó algo vencido: el cron la repite en su siguiente pasada. Piso de 3
-- días (una ventana más corta no deja leer ni un fin de semana) y de 1,000 el
-- lote, igual que las otras purgas del repo (0680): sqlstate PU001.
create or replace function public.purgar_latencia(
  p_ahora timestamptz default now(),
  p_dias integer default 14,
  p_lote integer default 20000
) returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_borradas integer;
  v_corte timestamptz;
begin
  if p_dias < 3 then
    raise exception 'purgar_latencia: la retención no puede ser menor de 3 días (llegó %)', p_dias using errcode = 'PU001';
  end if;
  if p_lote < 1000 then
    raise exception 'purgar_latencia: el lote no puede ser menor de 1000 (llegó %)', p_lote using errcode = 'PU001';
  end if;
  v_corte := p_ahora - make_interval(days => p_dias);
  with vencidas as (
    select id from public.latencia_muestra where creado_en < v_corte order by creado_en limit p_lote
  ), borradas as (
    delete from public.latencia_muestra m using vencidas v where m.id = v.id returning 1
  )
  select count(*)::integer into v_borradas from borradas;
  return jsonb_build_object(
    'borradas', v_borradas,
    'parcial', exists (select 1 from public.latencia_muestra where creado_en < v_corte)
  );
end $$;

revoke all on function public.purgar_latencia(timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.purgar_latencia(timestamptz, integer, integer) to service_role;
