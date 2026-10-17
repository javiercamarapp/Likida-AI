-- ═══════════════════════════════════════════════════════════════════════════
-- 0807 — CONDUCTOR (T-A5-41): el CICLO de hitos por tipo de servicio (importación / exportación / nacional).
--
-- Hasta hoy el módulo seguía un solo ciclo de cinco hitos fijos (`TIPOS_HITO`). El cliente distingue tres servicios y cada uno sigue
-- su propia secuencia de estatus (R22/R23). Esta tabla guarda, POR FLOTA, la secuencia ordenada de hitos de cada servicio.
--
--   · Sin ninguna fila para una flota (o para ese servicio) = el ciclo actual de cinco hitos, sin regresión: esta tabla solo ADELGAZA
--     o REEMPLAZA el ciclo cuando la flota la tiene. Nadie la siembra sola; la semilla sintética vive en código y se aplica a mano.
--   · `servicio` y `hito` son vocabularios cerrados (CHECK). `orden` empieza en 1 y no se repite dentro de (flota, servicio); un hito
--     tampoco se repite dentro de (flota, servicio).
--   · `activo` apaga un paso sin borrarlo (el cliente puede quitar uno y volver a ponerlo).
--
-- Solo aditiva e idempotente (create ... if not exists, drop ... if exists). Sin datos personales ni catálogos del cliente. RLS con la
-- misma política de lectura que `viaje_parada` (0806); la escritura solo la hace el servidor.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ciclo_servicio (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  servicio text not null,
  orden integer not null,
  hito text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint ciclo_servicio_servicio_dominio check (servicio in ('importacion', 'exportacion', 'nacional')),
  constraint ciclo_servicio_orden_positivo check (orden >= 1),
  constraint ciclo_servicio_hito_dominio check (hito in (
    'confirmar', 'enlace_origen_destino', 'inicio_viaje', 'inicio_viaje_cliente', 'llegada_cliente', 'llegada_cita_carga',
    'contacto', 'rampa', 'espera_descarga', 'inicio_carga', 'fin_carga', 'salida_destino', 'fin_descarga', 'resultado_descarga',
    'patio_entrega', 'llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'
  )),
  constraint ciclo_servicio_orden_unico unique (tenant_id, servicio, orden),
  constraint ciclo_servicio_hito_unico unique (tenant_id, servicio, hito)
);
comment on table public.ciclo_servicio is
  '0807: secuencia ordenada de hitos por flota y tipo de servicio (importacion|exportacion|nacional). Sin filas = ciclo actual de cinco hitos. Sin datos personales.';
comment on column public.ciclo_servicio.activo is
  'Apaga el paso sin borrarlo; el motor solo recorre los activos.';

alter table public.ciclo_servicio enable row level security;
drop policy if exists tenant_lee on public.ciclo_servicio;
create policy tenant_lee on public.ciclo_servicio for select
  using (
    (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
    or (select public.is_superadmin())
  );
revoke all on table public.ciclo_servicio from public, anon, authenticated;
grant select on table public.ciclo_servicio to authenticated;
grant select, insert, update, delete on table public.ciclo_servicio to service_role;
