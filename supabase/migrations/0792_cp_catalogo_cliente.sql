-- ═══════════════════════════════════════════════════════════════════════════
-- 0792 — Carta Porte: catálogo maestro POR CLIENTE (número interno, productos y partes).
--
-- Qué es: algunos clientes grandes mandan el embarque SIN clave SAT ni RFC (solo su SKU, un alias o el nombre
-- corto del sitio). Esos datos no se pueden inventar ni deducir del documento: se resuelven con un diccionario
-- que la flota carga una vez por cliente. Tres tablas, todas vacías al crearse (sin seed de datos reales):
--
--   · cp_cliente_numero:    cliente → «número interno» (y, si es otro, el número del cliente que paga). Es la tabla
--                           que el cliente pidió: cuando un documento no liga en su sistema, una de las tres
--                           causas es que el número del cliente (el que paga) está mal.
--   · cp_catalogo_producto: SKU → bienes transportados (clave SAT), clave de unidad, embalaje, fracción, materia
--                           y material peligroso, por cliente.
--   · cp_catalogo_parte:    alias → remitente/destinatario completo (razón social, RFC o id fiscal extranjero,
--                           domicilio con claves SAT, contacto), por cliente.
--
-- Aquí solo viven los datos y sus candados; resolver y enriquecer con el catálogo es código aparte.
--
-- Reglas:
--   · Deny-all + service_role (igual que 0420/0790). FK compuestas (cliente_id, tenant_id) → cliente (id, tenant_id):
--     una fila no cuelga de un cliente de otra flota. Borrar el cliente (o la flota) CASCADA el catálogo.
--   · PII de terceros: razón social, RFC, domicilio y contacto de remitentes/destinatarios son datos personales de
--     terceros. Entran en la retención/ARCO por la cascada anterior; ninguna columna se registra en bitácoras.
--   · Límites de largo en cada texto (CHECK) y forma del RFC (12–13 caracteres; XEXX010101000 / XAXX010101000 válidos).
--   · updated_by: quién cargó/cambió la fila (set null si el usuario se borra).
--   · No redefine ninguna función ni constraint de migraciones anteriores. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Cliente → número interno ────────────────────────────────────────────────
create table if not exists public.cp_cliente_numero (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  cliente_id      uuid not null,
  numero_interno  text not null,
  -- Si quien paga es otro cliente/número distinto del interno.
  numero_pagador  text,
  activo          boolean not null default true,
  updated_by      uuid references public.app_user(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint cp_cliente_numero_cliente_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint cp_cliente_numero_unico unique (tenant_id, cliente_id),
  constraint cp_cliente_numero_interno_largo check (char_length(btrim(numero_interno)) between 1 and 60),
  constraint cp_cliente_numero_pagador_largo check (numero_pagador is null or char_length(btrim(numero_pagador)) between 1 and 60)
);
comment on table public.cp_cliente_numero is
  'Tabla cliente→número interno que paga (0792), por flota. Vacía al crearse; la carga la flota (acción/CSV aparte).';

-- ── Catálogo de productos por cliente ───────────────────────────────────────
create table if not exists public.cp_catalogo_producto (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenant(id) on delete cascade,
  cliente_id                uuid not null,
  sku                       text not null,
  descripcion_patron        text,
  bienes_transp             text not null,
  clave_unidad              text not null,
  embalaje                  text,
  fraccion                  text,
  tipo_materia              text,
  material_peligroso        boolean not null default false,
  clave_material_peligroso  text,
  updated_by                uuid references public.app_user(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint cp_catalogo_producto_cliente_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint cp_catalogo_producto_sku_unico unique (tenant_id, cliente_id, sku),
  constraint cp_catalogo_producto_sku_largo check (char_length(btrim(sku)) between 1 and 80),
  constraint cp_catalogo_producto_patron_largo check (descripcion_patron is null or char_length(descripcion_patron) <= 200),
  constraint cp_catalogo_producto_bienes_largo check (char_length(btrim(bienes_transp)) between 1 and 20),
  constraint cp_catalogo_producto_unidad_largo check (char_length(btrim(clave_unidad)) between 1 and 10),
  constraint cp_catalogo_producto_embalaje_largo check (embalaje is null or char_length(embalaje) <= 10),
  constraint cp_catalogo_producto_fraccion_largo check (fraccion is null or char_length(fraccion) <= 20),
  constraint cp_catalogo_producto_materia_largo check (tipo_materia is null or char_length(tipo_materia) <= 10),
  constraint cp_catalogo_producto_cmp_largo check (clave_material_peligroso is null or char_length(clave_material_peligroso) <= 10),
  -- Una clave de material peligroso solo tiene sentido si el producto está marcado como peligroso.
  constraint cp_catalogo_producto_peligroso_coherente check (clave_material_peligroso is null or material_peligroso)
);
comment on table public.cp_catalogo_producto is
  'Catálogo SKU→clave SAT/unidad/embalaje/fracción por cliente (0792). Vacío al crearse; sin datos reales en el repo.';

-- ── Catálogo de partes (remitente / destinatario) por cliente ───────────────
create table if not exists public.cp_catalogo_parte (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenant(id) on delete cascade,
  cliente_id            uuid not null,
  rol                   text not null,
  alias                 text not null,
  razon_social          text,
  rfc                   text,
  id_fiscal_extranjero  text,
  calle                 text,
  num_ext               text,
  num_int               text,
  colonia_clave         text,
  colonia               text,
  cp                    text,
  localidad_clave       text,
  localidad             text,
  municipio_clave       text,
  municipio             text,
  estado                text,
  pais                  text,
  contacto              text,
  telefono              text,
  correo                text,
  updated_by            uuid references public.app_user(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint cp_catalogo_parte_cliente_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint cp_catalogo_parte_alias_unico unique (tenant_id, cliente_id, rol, alias),
  constraint cp_catalogo_parte_rol_dominio check (rol in ('remitente', 'destinatario')),
  constraint cp_catalogo_parte_alias_largo check (char_length(btrim(alias)) between 1 and 120),
  constraint cp_catalogo_parte_razon_largo check (razon_social is null or char_length(razon_social) <= 254),
  -- RFC de persona moral (12) o física (13): 3–4 letras, fecha de 6 dígitos, homoclave de 3. Incluye los genéricos
  -- XEXX010101000 (extranjero) y XAXX010101000 (público en general).
  constraint cp_catalogo_parte_rfc_forma check (rfc is null or rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  constraint cp_catalogo_parte_idfiscal_largo check (id_fiscal_extranjero is null or char_length(id_fiscal_extranjero) <= 40),
  constraint cp_catalogo_parte_calle_largo check (calle is null or char_length(calle) <= 100),
  constraint cp_catalogo_parte_numext_largo check (num_ext is null or char_length(num_ext) <= 55),
  constraint cp_catalogo_parte_numint_largo check (num_int is null or char_length(num_int) <= 55),
  constraint cp_catalogo_parte_colonia_clave_largo check (colonia_clave is null or char_length(colonia_clave) <= 10),
  constraint cp_catalogo_parte_colonia_largo check (colonia is null or char_length(colonia) <= 120),
  constraint cp_catalogo_parte_cp_largo check (cp is null or char_length(cp) <= 12),
  constraint cp_catalogo_parte_localidad_clave_largo check (localidad_clave is null or char_length(localidad_clave) <= 10),
  constraint cp_catalogo_parte_localidad_largo check (localidad is null or char_length(localidad) <= 120),
  constraint cp_catalogo_parte_municipio_clave_largo check (municipio_clave is null or char_length(municipio_clave) <= 10),
  constraint cp_catalogo_parte_municipio_largo check (municipio is null or char_length(municipio) <= 120),
  constraint cp_catalogo_parte_estado_largo check (estado is null or char_length(estado) <= 60),
  constraint cp_catalogo_parte_pais_largo check (pais is null or char_length(pais) <= 60),
  constraint cp_catalogo_parte_contacto_largo check (contacto is null or char_length(contacto) <= 120),
  constraint cp_catalogo_parte_telefono_largo check (telefono is null or char_length(telefono) <= 40),
  constraint cp_catalogo_parte_correo_largo check (correo is null or char_length(correo) <= 254)
);
comment on table public.cp_catalogo_parte is
  'Catálogo alias→remitente/destinatario por cliente (0792). Razón social, RFC, domicilio y contacto son datos de TERCEROS: viven y mueren con el cliente (cascada) y entran en retención/ARCO.';

-- ── Deny-all + service_role ─────────────────────────────────────────────────
alter table public.cp_cliente_numero enable row level security;
alter table public.cp_catalogo_producto enable row level security;
alter table public.cp_catalogo_parte enable row level security;
revoke all on public.cp_cliente_numero, public.cp_catalogo_producto, public.cp_catalogo_parte from public, anon, authenticated;
grant select, insert, update, delete on public.cp_cliente_numero, public.cp_catalogo_producto, public.cp_catalogo_parte to service_role;
