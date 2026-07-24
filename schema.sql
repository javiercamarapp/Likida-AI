-- ═══════════════════════════════════════════════════════════════════════════
-- Cuadra — modelo de datos (Supabase / Postgres)
-- Multi-tenant: cada flota-cliente es un tenant. RLS por tenant_id.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─── Tenants (flotas-cliente, ej. Cliente demo) ──────────────────
create table tenant (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  rfc           text,
  ciudad        text,
  plan          text not null default 'demo',       -- demo | pro | enterprise
  created_at    timestamptz not null default now()
);

-- ─── Usuarios (admin interno de Cuadra + usuarios de la flota) ──────────────
create table app_user (
  id            uuid primary key default gen_random_uuid(),  -- = auth.users.id
  tenant_id     uuid references tenant(id) on delete cascade, -- null = superadmin Cuadra
  email         text not null unique,
  nombre        text,
  rol           text not null default 'flota_admin',  -- superadmin | flota_admin | flota_viewer
  created_at    timestamptz not null default now()
);

-- ─── Terminales / bases de la flota (Silao, Guadalajara, Laredo) ────────────
create table terminal (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  nombre        text not null,
  ciudad        text
);

-- ─── Operadores (choferes que mandan comprobantes por WhatsApp) ─────────────
create table operador (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  terminal_id   uuid references terminal(id) on delete set null,
  nombre        text not null,
  telefono      text not null,                        -- WhatsApp E.164
  numero_empleado text,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, telefono)
);

-- ─── Política de gastos (topes por concepto/ruta; alimenta el cuadre) ───────
create table politica_gasto (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  concepto      text not null,                        -- diesel | caseta | viaticos | otro
  ruta          text,                                 -- opcional: aplica a ruta específica
  tope_monto    numeric(12,2),                        -- tope permitido
  requiere_cfdi boolean not null default false,
  notas         text,
  created_at    timestamptz not null default now()
);

-- ─── Viajes (la unidad que se liquida) ──────────────────────────────────────
create table viaje (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  operador_id   uuid not null references operador(id) on delete restrict,
  terminal_id   uuid references terminal(id) on delete set null,
  folio         text,                                 -- folio interno del viaje/ruta
  origen        text,
  destino       text,
  anticipo      numeric(12,2) not null default 0,     -- efectivo entregado al operador
  fecha_inicio  date,
  fecha_fin     date,
  estatus       text not null default 'abierto',      -- abierto | en_cuadre | liquidado
  created_at    timestamptz not null default now()
);

-- ─── Gastos (comprobantes extraídos por OCR) ────────────────────────────────
create table gasto (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  viaje_id      uuid not null references viaje(id) on delete cascade,
  concepto      text not null,                        -- diesel | caseta | factura | otro
  monto         numeric(12,2) not null,
  fecha         date,
  folio         text,
  rfc_emisor    text,
  cfdi_uuid     text,                                 -- si es CFDI
  imagen_url    text,                                 -- comprobante original (storage)
  ocr_raw       jsonb,                                -- salida cruda del OCR
  ocr_confianza numeric(4,3),                         -- 0–1 confianza de extracción
  cfdi_valido   boolean,                              -- validación facturapi
  created_at    timestamptz not null default now()
);

-- ─── Liquidaciones (resultado del cuadre) ───────────────────────────────────
create table liquidacion (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  viaje_id       uuid not null references viaje(id) on delete cascade,
  total_comprobado numeric(12,2) not null default 0,
  total_anticipo   numeric(12,2) not null default 0,
  diferencia       numeric(12,2) not null default 0,  -- + a favor empresa, - a favor operador
  estatus        text not null default 'cuadrada',    -- cuadrada | con_diferencias | revisar
  diferencias    jsonb,                               -- [{tipo, concepto, esperado, real, monto, nota}]
  pdf_url        text,
  export_url     text,                                -- CSV/JSON para ERP
  created_at     timestamptz not null default now()
);

-- ─── Conversaciones WhatsApp (para el agente) ───────────────────────────────
create table wa_conversacion (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references tenant(id) on delete cascade,
  operador_id   uuid references operador(id) on delete set null,
  telefono      text not null,
  viaje_id      uuid references viaje(id) on delete set null,
  estado        jsonb not null default '{}',          -- snapshot del estado del flujo
  updated_at    timestamptz not null default now()
);

-- ─── Índices ────────────────────────────────────────────────────────────────
create index on operador (tenant_id);
create index on viaje (tenant_id, estatus);
create index on gasto (viaje_id);
create index on liquidacion (tenant_id, created_at desc);
create index on wa_conversacion (telefono);

-- ─── RLS (habilitar; políticas se definen por rol al conectar Supabase Auth) ─
alter table tenant           enable row level security;
alter table app_user         enable row level security;
alter table terminal         enable row level security;
alter table operador         enable row level security;
alter table politica_gasto   enable row level security;
alter table viaje            enable row level security;
alter table gasto            enable row level security;
alter table liquidacion      enable row level security;
alter table wa_conversacion  enable row level security;
