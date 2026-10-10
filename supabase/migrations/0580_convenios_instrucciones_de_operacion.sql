-- ═══════════════════════════════════════════════════════════════════════════
-- 0580 — CONVENIOS DE CLIENTE: todo nace del convenio.
--
-- LOOP PUNTA A PUNTA, W3 «convenios» (1-oct-2026, levantamiento por Zoom).
-- En el levantamiento con la flota de demo: el convenio fija el punto A→B, la tarifa, las
-- instrucciones de cobro y las INSTRUCCIONES DE OPERACIÓN (qué puerta, con quién
-- reportarse, peculiaridades de la planta, qué documentos llevar). Hoy eso vive en
-- la cabeza del despachador y se le dicta al chofer por teléfono.
--
-- QUÉ GARANTIZA LA BASE (y por qué no basta el código):
--
--  1. `cliente_convenio` — un convenio por (flota, cliente, nombre). El nombre es
--     la llave con la que el importador CSV/Excel es idempotente: subir el mismo
--     archivo dos veces no duplica. Cliente y sitios (geocerca) son DE LA MISMA
--     flota por FK compuesta (molde 0145/0298): un convenio de la flota A no puede
--     apuntar al cliente ni a la planta de la flota B aunque alguien mande su uuid.
--
--  2. `convenio_instruccion` — las líneas de la «calle de instrucciones». Dominio
--     cerrado de categoría y de momento (despacho / acercamiento / ambos) y texto
--     acotado. Unique (convenio, categoría, texto): la misma instrucción dos veces
--     es una.
--
--  3. `convenio_comercial` — el DINERO del convenio (tarifa y requisitos de cobro),
--     en tabla aparte a propósito: las instrucciones de operación las ve quien
--     despacha, la tarifa solo quien ve finanzas (`ve_finanzas()`, 0048). Con una
--     sola tabla, un encargado leería la tarifa por PostgREST aunque la pantalla se
--     la escondiera.
--
--  4. `viaje_convenio` — el convenio LIGADO AL VIAJE, con una FOTO de las
--     instrucciones vigentes al despachar. Una sola fila por viaje (PK). Lleva el
--     sello de cada envío al operador (despacho, y acercamiento a la planta de carga y a la de
--     descarga) con CLAIM: se
--     reclama con un UPDATE condicionado a «no enviado y no reclamado» ANTES de
--     mandar, así que dos corridas del cron (Vercel entrega at-least-once) o dos
--     gestos del chofer no le mandan dos veces la misma calle de instrucciones.
--
-- RLS: deny-all para anon; `authenticated` solo SELECT de lo de SU flota
-- (`get_user_tenant_ids()`) y solo si su rol puede verlo; escribe únicamente
-- `service_role` (el panel y el bot escriben por servidor, con el tenant anclado).
--
-- Idempotente: `if not exists`, guardas `pg_constraint` y `drop policy if exists`.
-- Rango asignado a W3 «convenios»: 0580-0599.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El convenio ──────────────────────────────────────────────────────────
create table if not exists public.cliente_convenio (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  cliente_id       uuid not null,
  nombre           text not null,
  origen           text,
  destino          text,
  origen_sitio_id  uuid,
  destino_sitio_id uuid,
  vigente_desde    date,
  vigente_hasta    date,
  activo           boolean not null default true,
  notas            text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint cliente_convenio_nombre_largo check (char_length(nombre) between 1 and 120),
  constraint cliente_convenio_origen_largo check (origen is null or char_length(origen) between 1 and 160),
  constraint cliente_convenio_destino_largo check (destino is null or char_length(destino) between 1 and 160),
  constraint cliente_convenio_notas_largo check (notas is null or char_length(notas) <= 1000),
  constraint cliente_convenio_vigencia_coherente
    check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde),
  constraint cliente_convenio_unico unique (tenant_id, cliente_id, nombre),
  constraint cliente_convenio_id_tenant_key unique (id, tenant_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cliente_convenio_cliente_tenant_fkey' and conrelid = 'public.cliente_convenio'::regclass) then
    alter table public.cliente_convenio add constraint cliente_convenio_cliente_tenant_fkey
      foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cliente_convenio_origen_sitio_fkey' and conrelid = 'public.cliente_convenio'::regclass) then
    alter table public.cliente_convenio add constraint cliente_convenio_origen_sitio_fkey
      foreign key (origen_sitio_id, tenant_id) references public.geocerca (id, tenant_id) on delete set null (origen_sitio_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cliente_convenio_destino_sitio_fkey' and conrelid = 'public.cliente_convenio'::regclass) then
    alter table public.cliente_convenio add constraint cliente_convenio_destino_sitio_fkey
      foreign key (destino_sitio_id, tenant_id) references public.geocerca (id, tenant_id) on delete set null (destino_sitio_id);
  end if;
end $$;

create index if not exists cliente_convenio_cliente_idx on public.cliente_convenio (tenant_id, cliente_id, activo);

comment on table public.cliente_convenio is
  '0580: convenio de un cliente con la flota (punto A→B). De aquí salen las instrucciones de operación que el chofer recibe por WhatsApp. El nombre es la llave de re-importación del CSV.';

-- ── 2. Las instrucciones de operación («calle de instrucciones») ────────────
create table if not exists public.convenio_instruccion (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  convenio_id uuid not null,
  categoria   text not null,
  texto       text not null,
  momento     text not null default 'ambos',
  -- A qué planta aplica: la del punto A (origen, donde se carga), la del B (destino, donde se
  -- descarga) o las dos. El aviso de acercamiento solo manda las del lado al que se acerca.
  lugar       text not null default 'ambos',
  orden       int not null default 0,
  activa      boolean not null default true,
  creada_en   timestamptz not null default now(),
  constraint convenio_instruccion_categoria_dominio
    check (categoria in ('puerta', 'reportarse', 'peculiaridad', 'documentos', 'horario', 'seguridad', 'otro')),
  constraint convenio_instruccion_momento_dominio check (momento in ('despacho', 'acercamiento', 'ambos')),
  constraint convenio_instruccion_texto_largo check (char_length(texto) between 1 and 400),
  constraint convenio_instruccion_orden_sano check (orden between 0 and 999),
  constraint convenio_instruccion_unica unique (convenio_id, categoria, texto)
);

-- `lugar` llegó después del primer borrador de esta migración: se garantiza también sobre una tabla ya creada.
alter table public.convenio_instruccion add column if not exists lugar text not null default 'ambos';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'convenio_instruccion_lugar_dominio' and conrelid = 'public.convenio_instruccion'::regclass) then
    alter table public.convenio_instruccion add constraint convenio_instruccion_lugar_dominio check (lugar in ('origen', 'destino', 'ambos'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'convenio_instruccion_convenio_tenant_fkey' and conrelid = 'public.convenio_instruccion'::regclass) then
    alter table public.convenio_instruccion add constraint convenio_instruccion_convenio_tenant_fkey
      foreign key (convenio_id, tenant_id) references public.cliente_convenio (id, tenant_id) on delete cascade;
  end if;
end $$;

create index if not exists convenio_instruccion_convenio_idx on public.convenio_instruccion (convenio_id, activa, orden);

comment on table public.convenio_instruccion is
  '0580: una línea de la calle de instrucciones del convenio (puerta, con quién reportarse, peculiaridades, documentos). `momento` dice cuándo se le manda al operador: al despachar, al acercarse a la planta o en ambos.';

-- ── 3. El dinero del convenio (solo finanzas) ───────────────────────────────
create table if not exists public.convenio_comercial (
  convenio_id      uuid primary key,
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  tarifa_modo      text,
  tarifa_precio    numeric(12,2),
  tarifa_moneda    text not null default 'MXN',
  requisitos_cobro text[] not null default '{}',
  actualizado_en   timestamptz not null default now(),
  constraint convenio_comercial_modo_dominio check (tarifa_modo is null or tarifa_modo in ('por_viaje', 'por_km', 'por_tonelada')),
  constraint convenio_comercial_precio_positivo check (tarifa_precio is null or tarifa_precio > 0),
  -- Modo y precio van juntos o ninguno: un precio sin unidad no se puede cotizar.
  constraint convenio_comercial_modo_y_precio check ((tarifa_modo is null) = (tarifa_precio is null)),
  constraint convenio_comercial_moneda_dominio check (tarifa_moneda in ('MXN', 'USD')),
  constraint convenio_comercial_requisitos_acotados check (coalesce(cardinality(requisitos_cobro), 0) <= 30)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'convenio_comercial_convenio_tenant_fkey' and conrelid = 'public.convenio_comercial'::regclass) then
    alter table public.convenio_comercial add constraint convenio_comercial_convenio_tenant_fkey
      foreign key (convenio_id, tenant_id) references public.cliente_convenio (id, tenant_id) on delete cascade;
  end if;
end $$;

comment on table public.convenio_comercial is
  '0580: tarifa y requisitos de cobro del convenio. Tabla aparte de las instrucciones de operación a propósito: solo `ve_finanzas()` la lee, el encargado que despacha no.';

-- ── 4. El convenio ligado al viaje, con la foto de las instrucciones ────────
create table if not exists public.viaje_convenio (
  viaje_id                  uuid primary key,
  tenant_id                 uuid not null references public.tenant(id) on delete cascade,
  convenio_id               uuid,
  cliente_id                uuid,
  ligado_por                text not null default 'auto',
  instrucciones             jsonb not null default '[]'::jsonb,
  ligado_en                 timestamptz not null default now(),
  despacho_reclamado_en     timestamptz,
  despacho_enviado_en       timestamptz,
  despacho_canal            text,
  -- El acercamiento se sella POR PLANTA: llegar a la de carga y luego a la de descarga son dos avisos distintos.
  acercamiento_origen_reclamado_en  timestamptz,
  acercamiento_origen_enviado_en    timestamptz,
  acercamiento_origen_canal         text,
  acercamiento_destino_reclamado_en timestamptz,
  acercamiento_destino_enviado_en   timestamptz,
  acercamiento_destino_canal        text,
  constraint viaje_convenio_ligado_por_dominio check (ligado_por in ('auto', 'manual')),
  constraint viaje_convenio_instrucciones_lista
    check (jsonb_typeof(instrucciones) = 'array' and jsonb_array_length(instrucciones) <= 40),
  constraint viaje_convenio_canal_dominio
    check ((despacho_canal is null or despacho_canal in ('texto', 'botones', 'plantilla'))
       and (acercamiento_origen_canal is null or acercamiento_origen_canal in ('texto', 'botones', 'plantilla'))
       and (acercamiento_destino_canal is null or acercamiento_destino_canal in ('texto', 'botones', 'plantilla'))),
  -- Un envío con hora tiene canal y viceversa: si no, «enviado» no dice por dónde.
  constraint viaje_convenio_despacho_coherente check ((despacho_enviado_en is null) = (despacho_canal is null)),
  constraint viaje_convenio_acercamiento_origen_coherente check ((acercamiento_origen_enviado_en is null) = (acercamiento_origen_canal is null)),
  constraint viaje_convenio_acercamiento_destino_coherente check ((acercamiento_destino_enviado_en is null) = (acercamiento_destino_canal is null))
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'viaje_convenio_viaje_tenant_fkey' and conrelid = 'public.viaje_convenio'::regclass) then
    alter table public.viaje_convenio add constraint viaje_convenio_viaje_tenant_fkey
      foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'viaje_convenio_convenio_tenant_fkey' and conrelid = 'public.viaje_convenio'::regclass) then
    -- `set null (convenio_id)`: borrar el convenio no borra el viaje ni su foto de instrucciones.
    alter table public.viaje_convenio add constraint viaje_convenio_convenio_tenant_fkey
      foreign key (convenio_id, tenant_id) references public.cliente_convenio (id, tenant_id) on delete set null (convenio_id);
  end if;
end $$;

create index if not exists viaje_convenio_convenio_idx on public.viaje_convenio (convenio_id) where convenio_id is not null;
create index if not exists viaje_convenio_tenant_idx on public.viaje_convenio (tenant_id, ligado_en desc);

comment on table public.viaje_convenio is
  '0580: el convenio ligado al viaje, con la FOTO de las instrucciones al despachar y el sello (con claim) de cada envío al operador. Una fila por viaje.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.cliente_convenio enable row level security;
alter table public.convenio_instruccion enable row level security;
alter table public.convenio_comercial enable row level security;
alter table public.viaje_convenio enable row level security;

drop policy if exists tenant_lee on public.cliente_convenio;
create policy tenant_lee on public.cliente_convenio for select
  using ((tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion())) or (select public.is_superadmin()));
drop policy if exists tenant_lee on public.convenio_instruccion;
create policy tenant_lee on public.convenio_instruccion for select
  using ((tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion())) or (select public.is_superadmin()));
drop policy if exists tenant_lee on public.viaje_convenio;
create policy tenant_lee on public.viaje_convenio for select
  using ((tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion())) or (select public.is_superadmin()));
drop policy if exists tenant_lee on public.convenio_comercial;
create policy tenant_lee on public.convenio_comercial for select
  using ((tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_finanzas())) or (select public.is_superadmin()));

revoke all on table public.cliente_convenio, public.convenio_instruccion, public.convenio_comercial, public.viaje_convenio
  from public, anon, authenticated;
grant select on table public.cliente_convenio, public.convenio_instruccion, public.convenio_comercial, public.viaje_convenio
  to authenticated;
grant select, insert, update, delete on table public.cliente_convenio, public.convenio_instruccion,
  public.convenio_comercial, public.viaje_convenio to service_role;
