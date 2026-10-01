-- ═══════════════════════════════════════════════════════════════════════════
-- 0375 — CONCILIACIÓN DE PEAJES, BRECHAS DE CÓDIGO (Agente 2, loop punta a punta)
--
-- Auditoría 1-3 (sección Agente 2): el cruce de peajes era una v1 de dos vías
-- más evidencia por DÍA. Esta migración pone el esquema de lo que faltaba:
--
--   1. LA HORA DEL COBRO. La 0106 la descartaba al parsear («guardarla
--      aparentaría una precisión que el cruce no usa»). Ahora el cruce SÍ la
--      usa (ventana de minutos contra el GPS), así que se guarda: `hora` (la
--      del archivo, hora local de México, tal cual) y `cruce_en` (el instante,
--      timestamptz, calculado con el huso America/Mexico_City). Ambas son NULL
--      cuando el archivo no trae hora legible: NULL nunca significa medianoche.
--
--   2. TAG ↔ UNIDAD. `peaje_tag` casa el identificador del telepeaje con la
--      unidad. Sin esa tabla el cruce no sabe QUÉ camión pasó por la caseta
--      cuando el chofer no fotografió el ticket (el caso de PASE/IAVE/TeleVía).
--
--   3. CATÁLOGO DE CASETAS CON COORDENADAS. `peaje_caseta`. NACE VACÍO a
--      propósito: no hay catálogo oficial con lat/lng de plazas verificado en
--      el repo (el shapefile del IMT está identificado en
--      `normas/red-nacional-autopistas.yaml`, no cargado) y sembrar
--      coordenadas inventadas sería acusar de más con datos de mentira. Se
--      llena por CSV desde el panel (importador en `peajes/casetas.ts`).
--
--   4. LA EVIDENCIA GPS POR CASETA en cada línea: veredicto, distancia mínima
--      medida (Haversine) y el detalle de la muestra. Es anotación recalculable
--      sobre el archivo del proveedor, igual que el estatus del cruce.
--
-- RLS: igual que la 0106 — prendida SIN políticas (deny-all). Todo acceso pasa
-- por service_role desde el servidor, que filtra por tenant en cada consulta.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La hora del cobro en la línea del desglose ───────────────────────────
alter table public.desglose_peaje_linea
  add column if not exists hora      time,
  add column if not exists cruce_en  timestamptz,
  add column if not exists unidad_id uuid references public.unidad(id) on delete set null,
  add column if not exists caseta_id uuid,
  add column if not exists gps_veredicto   text,
  add column if not exists gps_distancia_m numeric(10,1),
  add column if not exists gps_detalle     jsonb;

comment on column public.desglose_peaje_linea.hora is
  'Hora del cobro tal como la trae el archivo (hora local de México). NULL = el archivo no la traía o no se pudo leer; NULL nunca significa medianoche.';
comment on column public.desglose_peaje_linea.cruce_en is
  'Instante del cobro (fecha + hora interpretadas en America/Mexico_City). NULL si falta fecha u hora. Es lo que el cruce GPS compara contra posicion.medida_en.';
comment on column public.desglose_peaje_linea.unidad_id is
  'Unidad a la que `peaje_tag` casa el TAG de la línea. NULL = TAG sin dar de alta (o línea sin TAG): no se adivina la unidad.';
comment on column public.desglose_peaje_linea.caseta_id is
  'Caseta del catálogo (`peaje_caseta`) a la que se resolvió el nombre de la línea. NULL = sin coincidencia única: ni se adivina ni se acusa.';
comment on column public.desglose_peaje_linea.gps_veredicto is
  'confirma = la unidad estuvo en la caseta a la hora del cobro; no_coincide = con datos suficientes, estuvo lejos; sin_datos = el dato no alcanza (el motivo va en gps_detalle). Solo no_coincide pesa en contra, y aun así se manda a revisión, no se acusa.';
comment on column public.desglose_peaje_linea.gps_distancia_m is
  'Distancia mínima MEDIDA (Haversine, metros) entre la trayectoria de la unidad en la ventana y la caseta. NULL = no hubo con qué medir; NULL ≠ 0.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_linea_gps_veredicto_dominio') then
    alter table public.desglose_peaje_linea
      add constraint desglose_peaje_linea_gps_veredicto_dominio
      check (gps_veredicto is null or gps_veredicto in ('confirma', 'no_coincide', 'sin_datos'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_linea_gps_distancia_sana') then
    alter table public.desglose_peaje_linea
      add constraint desglose_peaje_linea_gps_distancia_sana
      check (gps_distancia_m is null or gps_distancia_m >= 0);
  end if;
end $$;

-- ── 2. Tag ↔ unidad ─────────────────────────────────────────────────────────
create table if not exists public.peaje_tag (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  -- NORMALIZADO por la aplicación: mayúsculas, solo [A-Z0-9]. El archivo del
  -- proveedor trae «IMDM 12345678», «imdm-12345678» o «IMDM12345678» y los
  -- tres son el mismo dispositivo; comparar crudo daría tres "TAG sin alta".
  tag        text not null,
  -- Como lo capturó el usuario, para mostrarlo sin perder el formato.
  tag_original text,
  unidad_id  uuid not null,
  proveedor  text,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint peaje_tag_unico unique (tenant_id, tag),
  constraint peaje_tag_forma check (tag ~ '^[A-Z0-9]{4,40}$'),
  -- Una unidad de OTRA flota no puede quedar casada con este TAG (regla de la
  -- 0028/0145: toda FK entre tablas con tenant_id lleva su compuesta).
  constraint peaje_tag_unidad_tenant_fkey
    foreign key (unidad_id, tenant_id) references public.unidad (id, tenant_id) on delete cascade
);

comment on table public.peaje_tag is
  'Tabla de TAGs de telepeaje por unidad (0375). Un TAG = una unidad por flota. Sin esta tabla el cruce no sabe qué camión pasó por la caseta cuando no hay ticket.';
comment on column public.peaje_tag.tag is
  'Identificador del dispositivo, normalizado: mayúsculas y solo letras/dígitos.';

create index if not exists peaje_tag_unidad_idx on public.peaje_tag (tenant_id, unidad_id);

-- ── 3. Catálogo de casetas con coordenadas ──────────────────────────────────
create table if not exists public.peaje_caseta (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  nombre      text not null,
  -- Normalizado (minúsculas, sin acentos ni signos): la llave de búsqueda.
  nombre_norm text not null,
  -- Otros nombres con los que el proveedor la escribe («Tlalpan», «TLALPAN-CUERNAVACA»).
  alias       text[] not null default '{}',
  lat         double precision not null,
  lng         double precision not null,
  -- Radio de validación en metros. 300 por default: el GPS civil yerra ~10 m
  -- pero una plaza ocupa decenas de metros de carril y un camión se reporta
  -- cada minutos. Mínimo 50 para que el error normal no genere falsos «lejos».
  radio_m     int not null default 300,
  activa      boolean not null default true,
  -- De dónde salió la coordenada (archivo, quién la capturó). Obligatorio
  -- pensar en ello: una coordenada sin fuente no se puede defender.
  fuente      text,
  created_at  timestamptz not null default now(),
  constraint peaje_caseta_unica unique (tenant_id, nombre_norm),
  constraint peaje_caseta_nombre_largo check (char_length(nombre) between 1 and 120),
  constraint peaje_caseta_lat_valida check (lat between -90 and 90),
  constraint peaje_caseta_lng_valida check (lng between -180 and 180),
  constraint peaje_caseta_radio_sano check (radio_m between 50 and 5000)
);

comment on table public.peaje_caseta is
  'Catálogo de casetas con coordenadas por flota (0375). NACE VACÍO: no hay catálogo oficial verificado en el repo y no se siembran coordenadas inventadas. Se carga por CSV (peajes/casetas.ts).';
comment on column public.peaje_caseta.radio_m is
  'Radio (m) dentro del cual una posición GPS confirma el paso por la caseta. Entre 50 y 5,000.';

create index if not exists peaje_caseta_activa_idx on public.peaje_caseta (tenant_id, activa);

-- La FK de la línea al catálogo se agrega aquí (la tabla ya existe).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_linea_caseta_fkey') then
    alter table public.desglose_peaje_linea
      add constraint desglose_peaje_linea_caseta_fkey
      foreign key (caseta_id) references public.peaje_caseta(id) on delete set null;
  end if;
end $$;

-- Para el reporte «por unidad» y para re-cruzar por TAG.
create index if not exists desglose_peaje_linea_unidad_idx
  on public.desglose_peaje_linea (tenant_id, unidad_id) where unidad_id is not null;

-- ── RLS (deny-all; solo service_role) ───────────────────────────────────────
alter table public.peaje_tag enable row level security;
alter table public.peaje_caseta enable row level security;
