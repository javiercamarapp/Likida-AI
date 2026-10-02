-- ═══════════════════════════════════════════════════════════════════════════
-- 0631 — P1: la RE-IMPORTACIÓN DIARIA de geocercas de «mis propias tablas».
--
-- Hoy las geocercas del cliente solo entran con el botón manual de Conexiones: si
-- su sistema agrega o corrige un patio, el catálogo se queda viejo hasta que alguien
-- se acuerda. El cron `gps` ahora las re-importa, y para que eso sea SEGURO hace falta
-- estado en la base (no en memoria: el cron corre en invocaciones sueltas y a veces
-- dos a la vez):
--
-- 1. `geocerca_importacion_estado` — una fila por flota: la HUELLA (sha256) del último
--    contenido leído e importado, cuándo se intentó y cómo salió. Con la misma huella
--    no se escribe NADA (la re-importación diaria no toca filas ni reactiva sitios que
--    la flota desactivó a mano mientras su tabla no cambie).
-- 2. `reclamar_importacion_geocercas(flota, ventana_min)` — el claim atómico: una sola
--    invocación por flota y por ventana (por omisión 23 h). Si el último intento
--    falló, se reintenta a la hora (no cada 5 min contra su base).
-- 3. `registrar_importacion_geocercas(...)` — cierra el intento. La huella solo avanza
--    cuando salió bien (o sin cambios): un fallo no «gasta» el cambio pendiente.
--
-- Solo service_role; RLS activa sin políticas (deny-all), como las demás tablas de estado.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.geocerca_importacion_estado (
  tenant_id uuid primary key references public.tenant(id) on delete cascade,
  huella text,
  ultimo_intento_en timestamptz not null default now(),
  ultimo_ok_en timestamptz,
  ultimo_resultado text,
  ultimo_error text,
  creados integer,
  actualizados integer,
  aproximadas integer,
  constraint geocerca_importacion_resultado check (ultimo_resultado is null or ultimo_resultado in ('importada', 'sin_cambios', 'error')),
  constraint geocerca_importacion_huella check (huella is null or huella ~ '^[0-9a-f]{64}$'),
  constraint geocerca_importacion_error_largo check (ultimo_error is null or char_length(ultimo_error) <= 300),
  constraint geocerca_importacion_conteos check (
    (creados is null or creados >= 0) and (actualizados is null or actualizados >= 0) and (aproximadas is null or aproximadas >= 0)
  )
);
alter table public.geocerca_importacion_estado enable row level security;
comment on table public.geocerca_importacion_estado is
  '0631: estado de la re-importación automática de geocercas de tabla propia (cron gps): huella del último contenido importado y claim por ventana. Deny-all; solo service_role.';

create or replace function public.reclamar_importacion_geocercas(p_tenant uuid, p_ventana_min integer default 1380)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_reclamado boolean;
begin
  if p_tenant is null or p_ventana_min is null or p_ventana_min not between 1 and 10080 then
    raise exception 'reclamar_importacion_geocercas: argumentos inválidos' using errcode = '22023';
  end if;
  -- Una sola corrida por flota y ventana. Tras un error la ventana se acorta a 60 min como máximo.
  insert into public.geocerca_importacion_estado as e (tenant_id, ultimo_intento_en)
  values (p_tenant, clock_timestamp())
  on conflict (tenant_id) do update set ultimo_intento_en = clock_timestamp()
   where e.ultimo_intento_en < clock_timestamp()
         - make_interval(mins => case when e.ultimo_resultado = 'error' then least(p_ventana_min, 60) else p_ventana_min end)
  returning true into v_reclamado;
  return coalesce(v_reclamado, false);
end $$;

create or replace function public.registrar_importacion_geocercas(
  p_tenant uuid, p_resultado text, p_huella text default null,
  p_creados integer default null, p_actualizados integer default null, p_aproximadas integer default null,
  p_error text default null
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant is null or p_resultado is null or p_resultado not in ('importada', 'sin_cambios', 'error') then
    raise exception 'registrar_importacion_geocercas: argumentos inválidos' using errcode = '22023';
  end if;
  insert into public.geocerca_importacion_estado as e (tenant_id, huella, ultimo_intento_en, ultimo_ok_en, ultimo_resultado, ultimo_error, creados, actualizados, aproximadas)
  values (p_tenant, case when p_resultado = 'error' then null else p_huella end, clock_timestamp(),
          case when p_resultado = 'error' then null else clock_timestamp() end,
          p_resultado, left(p_error, 300), p_creados, p_actualizados, p_aproximadas)
  on conflict (tenant_id) do update set
    -- La huella solo avanza con un intento bueno: un fallo no «gasta» el cambio pendiente.
    huella = case when p_resultado = 'error' then e.huella else p_huella end,
    ultimo_ok_en = case when p_resultado = 'error' then e.ultimo_ok_en else clock_timestamp() end,
    ultimo_resultado = p_resultado,
    ultimo_error = case when p_resultado = 'error' then left(p_error, 300) else null end,
    creados = coalesce(p_creados, e.creados), actualizados = coalesce(p_actualizados, e.actualizados),
    aproximadas = coalesce(p_aproximadas, e.aproximadas);
end $$;

revoke all on function public.reclamar_importacion_geocercas(uuid, integer) from public, anon, authenticated;
grant execute on function public.reclamar_importacion_geocercas(uuid, integer) to service_role;
revoke all on function public.registrar_importacion_geocercas(uuid, text, text, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.registrar_importacion_geocercas(uuid, text, text, integer, integer, integer, text) to service_role;
