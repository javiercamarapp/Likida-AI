-- ═══════════════════════════════════════════════════════════════════════════
-- 0776 — PEAJES: la configuración de las REGLAS DE COBRO (por flota).
--
--   · `peaje_caseta_nombre` — el catálogo de casetas POR NOMBRE. Los ~115 nombres
--     salen del propio archivo del proveedor; las coordenadas son OPCIONALES y NO se
--     inventan (el catálogo con coordenadas para el GPS sigue siendo `peaje_caseta`,
--     que las exige). Sobre cada nombre la flota declara:
--       · `clases_permitidas` — clases ADICIONALES válidas en esa caseta (p. ej. {1}
--         para una caseta de tarifa por pasada);
--       · `no_cruzar` — la caseta NO debe cruzarse.
--     Nace VACÍO: no viene ninguna regla precargada.
--   · `peaje_tag_baja` — TAGs dados de baja (unidad siniestrada, TAG cancelado) y la
--     fecha: cualquier cruce posterior se marca como candidato.
--
-- RLS: deny-all (prendida SIN políticas; solo service_role, que filtra por tenant en
-- cada consulta), igual que la 0375. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.peaje_caseta_nombre (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  nombre            text not null,
  -- Normalizado (minúsculas, sin acentos ni signos): la llave de búsqueda.
  nombre_norm       text not null,
  -- Coordenadas OPCIONALES: se cargan de una fuente real o se dejan vacías. Ambas o ninguna.
  lat               double precision,
  lng               double precision,
  fuente_coordenada text,
  -- Clases de cobro válidas ADEMÁS de las generales (3 y 5). Ej. {1} = tarifa por pasada.
  clases_permitidas smallint[] not null default '{}',
  no_cruzar         boolean not null default false,
  nota              text,
  -- Cuándo y cuántas veces se vio en archivos (para ordenar la lista).
  primera_vez       date,
  ultima_vez        date,
  cruces_vistos     integer not null default 0,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint peaje_caseta_nombre_unica unique (tenant_id, nombre_norm),
  constraint peaje_caseta_nombre_largo check (char_length(nombre) between 1 and 120),
  constraint peaje_caseta_nombre_coords_juntas check ((lat is null) = (lng is null)),
  constraint peaje_caseta_nombre_lat_valida check (lat is null or lat between -90 and 90),
  constraint peaje_caseta_nombre_lng_valida check (lng is null or lng between -180 and 180),
  constraint peaje_caseta_nombre_clases_sanas check (0 <= all (clases_permitidas) and 99 >= all (clases_permitidas) and cardinality(clases_permitidas) <= 20)
);

comment on table public.peaje_caseta_nombre is
  '0776: catálogo de casetas por NOMBRE (salen del archivo del proveedor). Coordenadas opcionales (nunca inventadas). Sobre cada una la flota declara clases válidas extra (tarifa por pasada) y si no debe cruzarse.';
comment on column public.peaje_caseta_nombre.clases_permitidas is
  'Clases de cobro válidas en esta caseta además de las generales (3 y 5). Vacío = solo las generales.';
comment on column public.peaje_caseta_nombre.no_cruzar is
  'La flota declara que esta caseta no debe cruzarse: cualquier cruce es candidato para revisar.';

create index if not exists peaje_caseta_nombre_regla_idx
  on public.peaje_caseta_nombre (tenant_id)
  where no_cruzar or cardinality(clases_permitidas) > 0;

create table if not exists public.peaje_tag_baja (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  -- NORMALIZADO igual que peaje_tag.tag: mayúsculas, solo [A-Z0-9].
  tag        text not null,
  tag_original text,
  -- Último día en que el TAG estaba vigente: un cruce con fecha POSTERIOR se marca.
  baja_en    date not null,
  motivo     text,
  creado_en  timestamptz not null default now(),
  constraint peaje_tag_baja_unica unique (tenant_id, tag),
  constraint peaje_tag_baja_forma check (tag ~ '^[A-Z0-9]{4,40}$'),
  constraint peaje_tag_baja_motivo_largo check (motivo is null or char_length(motivo) <= 300)
);

comment on table public.peaje_tag_baja is
  '0776: TAGs dados de baja y su fecha. Cualquier cruce posterior a baja_en es candidato a validar con el proveedor.';

alter table public.peaje_caseta_nombre enable row level security;
alter table public.peaje_tag_baja enable row level security;
