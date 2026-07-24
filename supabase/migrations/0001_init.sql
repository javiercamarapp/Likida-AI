-- ═══════════════════════════════════════════════════════════════════════════
-- Cuadra — migración inicial. Multi-tenant con RLS (patrón atiende endurecido).
-- El aislamiento vive en Postgres, no en el código.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── Tablas (ver schema.sql para columnas; aquí + RLS) ───────────────────────
create table if not exists tenant (
  id uuid primary key default gen_random_uuid(),
  nombre text not null, rfc text, ciudad text,
  plan text not null default 'demo', created_at timestamptz not null default now()
);

create table if not exists app_user (
  id uuid primary key,                      -- = auth.users.id
  tenant_id uuid references tenant(id) on delete cascade,  -- null = superadmin
  email text not null unique, nombre text,
  rol text not null default 'flota_admin',  -- superadmin | flota_admin | contador | operador
  created_at timestamptz not null default now()
);

create table if not exists terminal (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  nombre text not null, ciudad text
);

create table if not exists operador (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  terminal_id uuid references terminal(id) on delete set null,
  nombre text not null, telefono text not null, numero_empleado text,
  activo boolean not null default true, created_at timestamptz not null default now(),
  unique (tenant_id, telefono)
);

create table if not exists politica_gasto (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  concepto text not null, ruta text, tope_monto numeric(12,2),
  requiere_cfdi boolean not null default false, notas text,
  created_at timestamptz not null default now()
);

create table if not exists viaje (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  operador_id uuid not null references operador(id) on delete restrict,
  terminal_id uuid references terminal(id) on delete set null,
  folio text, origen text, destino text,
  anticipo numeric(12,2) not null default 0,
  fecha_inicio date, fecha_fin date,
  estatus text not null default 'abierto', created_at timestamptz not null default now()
);

create table if not exists gasto (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  viaje_id uuid not null references viaje(id) on delete cascade,
  concepto text not null, monto numeric(12,2) not null,
  fecha date, folio text, rfc_emisor text, cfdi_uuid text,
  imagen_url text, ocr_raw jsonb, ocr_confianza numeric(4,3),
  cfdi_valido boolean, created_at timestamptz not null default now()
);

create table if not exists liquidacion (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  viaje_id uuid not null references viaje(id) on delete cascade,
  total_comprobado numeric(12,2) not null default 0,
  total_anticipo numeric(12,2) not null default 0,
  diferencia numeric(12,2) not null default 0,
  estatus text not null default 'cuadrada', diferencias jsonb,
  pdf_url text, export_url text, created_at timestamptz not null default now()
);

create table if not exists wa_conversacion (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenant(id) on delete cascade,
  operador_id uuid references operador(id) on delete set null,
  telefono text not null, viaje_id uuid references viaje(id) on delete set null,
  estado jsonb not null default '{}', updated_at timestamptz not null default now()
);

-- ── Índices ─────────────────────────────────────────────────────────────────
create index if not exists idx_operador_tenant on operador(tenant_id);
create index if not exists idx_operador_tel on operador(telefono);
create index if not exists idx_viaje_tenant on viaje(tenant_id, estatus);
create index if not exists idx_gasto_viaje on gasto(viaje_id);
create index if not exists idx_liq_tenant on liquidacion(tenant_id, created_at desc);
create index if not exists idx_wa_tel on wa_conversacion(telefono);

-- ── RLS — helper SECURITY DEFINER (nunca NULL → no rompe aislamiento) ────────
create or replace function get_user_tenant_ids()
returns uuid[] language sql security definer stable set search_path = public as $$
  select coalesce(array_agg(tenant_id) filter (where tenant_id is not null), array[]::uuid[])
  from app_user where id = auth.uid();
$$;

create or replace function is_superadmin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from app_user where id = auth.uid() and rol = 'superadmin');
$$;

-- ── Policies uniformes por tabla (USING + WITH CHECK) ───────────────────────
do $$
declare t text;
begin
  foreach t in array array['terminal','operador','politica_gasto','viaje','gasto','liquidacion','wa_conversacion']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy tenant_data on %I for all
      using (tenant_id = any(get_user_tenant_ids()) or is_superadmin())
      with check (tenant_id = any(get_user_tenant_ids()) or is_superadmin())
    $p$, t);
  end loop;
end $$;

alter table tenant enable row level security;
create policy tenant_self on tenant for all
  using (id = any(get_user_tenant_ids()) or is_superadmin())
  with check (id = any(get_user_tenant_ids()) or is_superadmin());

alter table app_user enable row level security;
create policy app_user_self on app_user for select
  using (id = auth.uid() or tenant_id = any(get_user_tenant_ids()) or is_superadmin());
