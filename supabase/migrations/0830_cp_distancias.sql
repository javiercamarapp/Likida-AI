-- ═══════════════════════════════════════════════════════════════════════════
-- 0830 — Carta Porte: catálogo de DISTANCIAS origen→destino POR CLIENTE (T-A3-51).
--
-- Qué es: la distancia («solo números», constante por ruta) no viene en ningún documento del cliente: hoy se le
-- pedía al modelo, que la inventaba. La flota la carga UNA vez por cliente como tabla de rutas y el sistema resuelve
-- el par conocido; un par desconocido bloquea con `distancia_faltante` (jamás se adivina).
--
-- Una fila = una ruta DIRIGIDA (origen→destino; la vuelta es otra fila, no se asume simétrica) de UN cliente:
--   · tipo = 'cp'        → origen y destino son códigos postales de 5 dígitos.
--   · tipo = 'municipio' → origen y destino son el nombre del municipio ya normalizado por el importador (minúsculas,
--                          sin acentos, espacios simples): la unicidad exacta de la base necesita una forma canónica.
-- Rango extra de A3 (0830–0839). Aditiva: tabla nueva y vacía, sin seed; no toca nada existente. Idempotente.
--
-- Reglas:
--   · Deny-all + service_role (igual que 0792). FK compuesta (cliente_id, tenant_id) → cliente (id, tenant_id): una
--     fila no cuelga de un cliente de otra flota. Borrar el cliente (o la flota) CASCADA sus rutas.
--   · km > 0 y ≤ 99999.99, con dos decimales como máximo (numeric(7,2)).
--   · updated_by: quién cargó/cambió la fila (set null si el usuario se borra).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cp_distancia (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  cliente_id  uuid not null,
  tipo        text not null,
  origen      text not null,
  destino     text not null,
  km          numeric(7,2) not null,
  updated_by  uuid references public.app_user(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cp_distancia_cliente_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint cp_distancia_ruta_unica unique (tenant_id, cliente_id, tipo, origen, destino),
  constraint cp_distancia_tipo_dominio check (tipo in ('cp', 'municipio')),
  constraint cp_distancia_km_positivo check (km > 0),
  constraint cp_distancia_cp_forma check (tipo <> 'cp' or (origen ~ '^[0-9]{5}$' and destino ~ '^[0-9]{5}$')),
  constraint cp_distancia_municipio_forma check (
    tipo <> 'municipio' or (
      char_length(origen) between 1 and 120 and char_length(destino) between 1 and 120
      and origen = btrim(origen) and destino = btrim(destino)
      and origen = lower(origen) and destino = lower(destino)
    )
  )
);
comment on table public.cp_distancia is
  'Distancia (km) por ruta dirigida origen→destino de un cliente (0830), por CP o por municipio. Vacía al crearse; la carga la flota por CSV. Un par desconocido bloquea, no se adivina.';

alter table public.cp_distancia enable row level security;
revoke all on public.cp_distancia from public, anon, authenticated;
grant select, insert, update, delete on public.cp_distancia to service_role;
