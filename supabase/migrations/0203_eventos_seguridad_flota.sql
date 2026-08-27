-- ═══════════════════════════════════════════════════════════════════════════
-- 0203 — EVENTOS DE SEGURIDAD DE LAS CÁMARAS DEL CLIENTE (plan maestro,
-- pedido del 26-ago: no construir cámaras — leer las del cliente).
--
-- El registro de cada evento que el proveedor de cámaras/telemetría de la
-- flota detecta (Samsara hoy; Motive/Geotab cuando tengan lector). TODO
-- evento se guarda — el futuro agente de coaching lee de aquí. Solo los
-- GRAVES (crash/impacto/volcadura, columna `grave`) disparan el circuito de
-- asistencia (0198/0201): la fila queda ligada a su incidencia vía
-- `incidencia_id` y sellada con `procesado_en`.
--
-- La unicidad `(tenant_id, proveedor, evento_id_externo)` es la idempotencia
-- del poller de ventana traslapada: el mismo evento re-leído no duplica ni
-- vuelve a disparar. `unidad_id` NULL = huérfano (el vehículo del proveedor
-- no lo reclama ninguna unidad) — se reporta, jamás se inventa la unidad.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.evento_seguridad_flota (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  proveedor         text not null,
  evento_id_externo text not null,
  unidad_id         uuid references public.unidad(id) on delete set null,
  -- Los behavior labels tal cual los mandó el proveedor. La clasificación de
  -- gravedad vive en TypeScript (`esEventoGrave`) y se materializa en `grave`
  -- al insertar — el panel filtra por la columna, el criterio vive en código.
  etiquetas         text[] not null default '{}',
  grave             boolean not null default false,
  lat               double precision,
  lng               double precision,
  ocurrido_en       timestamptz not null,
  url_evento        text,
  max_g             numeric(6,2),
  -- Sello del disparo: NULL = no era grave o no tenía unidad; con fecha = el
  -- circuito de asistencia lo procesó (la incidencia dice qué pasó después).
  procesado_en      timestamptz,
  incidencia_id     uuid references public.incidencia(id) on delete set null,
  created_at        timestamptz not null default now()
);

create unique index if not exists uq_evento_seguridad_externo
  on public.evento_seguridad_flota (tenant_id, proveedor, evento_id_externo);

-- El panel y el coaching consultan por flota y fecha; los graves, aparte.
create index if not exists evento_seguridad_tenant_fecha_idx
  on public.evento_seguridad_flota (tenant_id, ocurrido_en desc);
create index if not exists evento_seguridad_graves_idx
  on public.evento_seguridad_flota (tenant_id, ocurrido_en desc)
  where grave;

comment on table public.evento_seguridad_flota is
  'Eventos de seguridad detectados por las cámaras/telemetría DEL CLIENTE (Samsara y los que sigan). Likida no construye cámaras: lee las del cliente con su token y monta el circuito de asistencia encima. Únicos por (tenant, proveedor, evento externo) — la idempotencia del poller de ventana traslapada. Solo los `grave` con unidad disparan asistencia; el resto queda para el agente de coaching (fuera de alcance hoy).';

-- ── Las FK con tenant (regla 0028/0145 — el bloque auto-descubriente vigila) ──
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'evento_seguridad_unidad_tenant_fkey' and conrelid = 'public.evento_seguridad_flota'::regclass
  ) then
    alter table public.evento_seguridad_flota
      add constraint evento_seguridad_unidad_tenant_fkey
      foreign key (unidad_id, tenant_id) references public.unidad (id, tenant_id)
      on delete set null (unidad_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'evento_seguridad_incidencia_tenant_fkey' and conrelid = 'public.evento_seguridad_flota'::regclass
  ) then
    alter table public.evento_seguridad_flota
      add constraint evento_seguridad_incidencia_tenant_fkey
      foreign key (incidencia_id, tenant_id) references public.incidencia (id, tenant_id)
      on delete set null (incidencia_id);
  end if;
end $$;

-- ── Doble candado (patrón 0186/0196/0198): RLS deny-all + sin grants ───────
alter table public.evento_seguridad_flota enable row level security;
revoke all on public.evento_seguridad_flota from public, anon, authenticated;
grant select, insert, update on public.evento_seguridad_flota to service_role;
