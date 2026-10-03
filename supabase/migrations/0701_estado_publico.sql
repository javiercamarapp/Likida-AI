-- ═══════════════════════════════════════════════════════════════════════════
-- 0701 — LA PÁGINA DE ESTADO PÚBLICA y la guardia en el servidor
--        (ola enterprise E1-A: P0-8 y E4).
--
-- Dos cosas que van juntas porque salen del mismo cron (`/api/cron/guardia`):
--
--   1. `cron_latido` admite el id `guardia`. El dominio de ese CHECK se
--      reescribe ENTERO cada vez (la 0642 lo advierte) y es espejo de CRONS
--      en `lib/admin/salud.ts`: aquí va la lista COMPLETA de la 0642 más
--      `guardia`. Quien integre otra migración que añada un id de cron debe
--      sumarlo sobre esta lista completa.
--
--   2. `estado_dia`: el historial MEDIDO que alimenta `/estado` (pública, solo
--      lectura). Una fila por (día, componente) con CONTADORES: cuántas veces
--      la guardia midió ese componente y cuántas lo encontró ok, degradado o
--      caído. Contadores y no una fila por muestra: 5 componentes × 365 días
--      = 1,825 filas al año, y la página muestra 30 días reales sin recorrer
--      nada grande. El día es de la Ciudad de México (el público es mexicano).
--      Sin tenant_id y sin datos de negocio por construcción: lo único que
--      guarda es un nombre de componente del catálogo cerrado y cuatro enteros.
--      RLS deny-all, igual que `cron_latido`.
--
-- Un día sin filas NO es un día en verde: la página lo pinta «sin medición».
--
-- Idempotente. NO se aplica a producción desde aquí.
--
-- PARA DESHACER:
--   drop function public.purgar_estado_dia(timestamptz, integer);
--   drop function public.estado_30_dias(timestamptz, integer);
--   drop function public.registrar_estado(text, text, timestamptz);
--   drop table public.estado_dia;
--   -- y volver a poner el CHECK de cron_latido como lo dejó la 0642.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. cron_latido admite `guardia` ──────────────────────────────────────────
alter table public.cron_latido drop constraint if exists cron_latido_id_dominio;
alter table public.cron_latido
  add constraint cron_latido_id_dominio
  check (id in (
    'wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia',
    'descarga-sat', 'jornada', 'portales-vivos', 'liquidaciones-externas', 'peajes', 'conductor-hitos',
    'vigia', 'buzon-entrega', 'jornada-alertas', 'carta-porte-docs', 'guardia'
  ));

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. La 0701 añade guardia sobre la lista de la 0642.';

-- ── 2. El historial diario de estado ─────────────────────────────────────────
create table if not exists public.estado_dia (
  dia            date    not null,
  componente     text    not null,
  muestras       integer not null default 0,
  ok             integer not null default 0,
  degradadas     integer not null default 0,
  caidas         integer not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (dia, componente),
  constraint estado_dia_componente_dominio check (componente in ('app', 'base', 'crons', 'whatsapp', 'correo')),
  constraint estado_dia_contadores_no_negativos check (muestras >= 0 and ok >= 0 and degradadas >= 0 and caidas >= 0),
  -- Cada muestra cae en EXACTAMENTE un estado: si no cuadra, el contador miente.
  constraint estado_dia_contadores_cuadran check (ok + degradadas + caidas = muestras)
);

comment on table public.estado_dia is
  'Historial diario MEDIDO de los componentes de la página pública /estado (E4, 0701): contadores por (día MX, componente). Sin datos de flota. Deny-all: solo el servidor.';

alter table public.estado_dia enable row level security;
revoke all on public.estado_dia from public, anon, authenticated;

-- Suma UNA medición al día del componente. Un estado fuera del dominio es un
-- error (no se adivina). Atómica: un solo INSERT … ON CONFLICT, sin leer antes.
create or replace function public.registrar_estado(
  p_componente text,
  p_estado text,
  p_ahora timestamptz default now()
) returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_dia date := (p_ahora at time zone 'America/Mexico_City')::date;
begin
  if p_estado not in ('ok', 'degradado', 'caido') then
    raise exception 'registrar_estado: estado fuera de dominio (%)', p_estado using errcode = 'PU001';
  end if;
  insert into public.estado_dia (dia, componente, muestras, ok, degradadas, caidas, actualizado_en)
  values (v_dia, p_componente, 1,
          case when p_estado = 'ok' then 1 else 0 end,
          case when p_estado = 'degradado' then 1 else 0 end,
          case when p_estado = 'caido' then 1 else 0 end,
          p_ahora)
  on conflict (dia, componente) do update
     set muestras = public.estado_dia.muestras + 1,
         ok = public.estado_dia.ok + excluded.ok,
         degradadas = public.estado_dia.degradadas + excluded.degradadas,
         caidas = public.estado_dia.caidas + excluded.caidas,
         actualizado_en = greatest(public.estado_dia.actualizado_en, excluded.actualizado_en);
end $$;

revoke all on function public.registrar_estado(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_estado(text, text, timestamptz) to service_role;

-- Los últimos `p_dias` días (incluido el de hoy, MX), un renglón por
-- (componente, día CON medición). Los días sin fila no aparecen: la app los
-- pinta «sin medición», no en verde.
create or replace function public.estado_30_dias(
  p_ahora timestamptz default now(),
  p_dias integer default 30
) returns table (componente text, dia date, muestras integer, ok integer, degradadas integer, caidas integer)
language sql
stable
set search_path = public, pg_catalog
as $$
  select e.componente, e.dia, e.muestras, e.ok, e.degradadas, e.caidas
    from public.estado_dia e
   where e.dia > (p_ahora at time zone 'America/Mexico_City')::date - p_dias
     and e.dia <= (p_ahora at time zone 'America/Mexico_City')::date
   order by e.componente, e.dia;
$$;

revoke all on function public.estado_30_dias(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.estado_30_dias(timestamptz, integer) to service_role;

-- Retención: 400 días (un año de SLA más margen). Cuatro rengloncitos al día.
create or replace function public.purgar_estado_dia(
  p_ahora timestamptz default now(),
  p_dias integer default 400
) returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_n integer;
begin
  if p_dias < 90 then
    raise exception 'purgar_estado_dia: la retención no puede ser menor de 90 días (llegó %)', p_dias using errcode = 'PU001';
  end if;
  with b as (
    delete from public.estado_dia
     where dia < (p_ahora at time zone 'America/Mexico_City')::date - p_dias
    returning 1
  )
  select count(*)::integer into v_n from b;
  return v_n;
end $$;

revoke all on function public.purgar_estado_dia(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.purgar_estado_dia(timestamptz, integer) to service_role;
