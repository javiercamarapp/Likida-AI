-- ═══════════════════════════════════════════════════════════════════════════
-- 0047 — Las tablas que el ENCARGADO necesita y no existían.
--
-- Hasta aquí el esquema solo sabía de dinero: viaje, gasto, liquidacion. El
-- encargado (0044) no vive de eso — vive de despachar. `dashboard/viajes`
-- lleva semanas declarando en pantalla lo que le falta:
--
--   "Unidad asignada, POD (evidencia de entrega) y margen por viaje no
--    aparecen porque no existen en el sistema: `viaje` no guarda unidad, no
--    hay tabla de vehículos, no hay campo de POD"   (viajes/page.tsx:130-137)
--
-- Esta migración cierra tres de esos huecos: unidad, incidencia y POD. El
-- MARGEN se queda fuera a propósito: necesita el ingreso del flete, que es
-- una decisión de producto (¿tarifa por viaje? ¿por km? ¿contrato marco?) y
-- no una tabla que se pueda adivinar. GPS también se queda fuera: no es un
-- problema de esquema sino de no tener proveedor de rastreo conectado.
--
-- TODO ES ADITIVO. Ninguna tabla existente pierde una columna ni cambia un
-- tipo; `viaje` solo gana un FK NULLABLE. Un despliegue viejo sigue
-- corriendo contra este esquema sin enterarse.
--
-- RLS: mismo criterio que 0045. Estas cuatro tablas son de la OFICINA
-- (flota_admin, encargado, contador), así que el chofer se excluye con
-- `not is_operador()` — si heredara `tenant_data` a secas vería las placas,
-- las averías y las entregas de TODA la flota, que es el mismo IDOR que la
-- 0045 cerró para viaje/gasto/liquidacion. La única excepción es `pod`: el
-- chofer es quien lo sube, así que ve e inserta el de SUS viajes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Unidades (vehículos) ───────────────────────────────────────────────────
create table if not exists public.unidad (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id) on delete cascade,
  numero_economico   text not null,
  placas             text,
  marca              text,
  modelo             text,
  anio               int,
  estado             text not null default 'disponible',
  km_actual          int,
  poliza_vence       date,
  permiso_sict_vence date,
  verificacion_vence date,
  activo             boolean not null default true,
  creada_en          timestamptz not null default now(),
  constraint unidad_estado_dominio
    check (estado in ('disponible', 'en_ruta', 'taller', 'baja')),
  -- El número económico es como la flota llama a la unidad en la radio y en
  -- el papel ("C2-08"). Único POR TENANT, no global: dos flotas distintas
  -- pueden tener las dos su C2-08 y ninguna está equivocada.
  constraint unidad_economico_unico unique (tenant_id, numero_economico)
);

comment on table public.unidad is
  'Vehículos de la flota. Sin costos: el estado operativo es del encargado, el dinero del vehículo es de otra pantalla y de otro rol.';
comment on column public.unidad.estado is
  'disponible | en_ruta | taller | baja. Lo mueve el despacho, no un humano tecleando.';

create index if not exists unidad_tenant_estado_idx on public.unidad (tenant_id, estado);

-- `viaje` gana la unidad que lo llevó. NULLABLE a propósito: los viajes que
-- ya existen (y todo lo que entra por WhatsApp, que no pregunta por unidad)
-- se quedan en NULL, y la pantalla dice "sin unidad" en vez de mentir.
alter table public.viaje
  add column if not exists unidad_id uuid references public.unidad(id) on delete set null;

comment on column public.viaje.unidad_id is
  'NULL = el viaje se dio de alta por WhatsApp, que no pregunta unidad. No es un error, es un dato que nadie capturó.';

create index if not exists viaje_unidad_idx on public.viaje (unidad_id) where unidad_id is not null;

-- ── Mantenimiento (órdenes de trabajo y DVIR) ──────────────────────────────
create table if not exists public.mantenimiento (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  unidad_id    uuid not null references public.unidad(id) on delete cascade,
  tipo         text not null,
  descripcion  text,
  estado       text not null default 'abierta',
  km_servicio  int,
  abierta_en   timestamptz not null default now(),
  cerrada_en   timestamptz,
  constraint mantenimiento_tipo_dominio
    check (tipo in ('preventivo', 'correctivo', 'dvir')),
  constraint mantenimiento_estado_dominio
    check (estado in ('abierta', 'en_proceso', 'cerrada')),
  -- Una orden cerrada tiene fecha de cierre y una abierta no. Sin esto, el
  -- downtime de una unidad se calcula contra un NULL y sale 0 — que se lee
  -- como "nunca estuvo en taller".
  constraint mantenimiento_cierre_coherente
    check ((estado = 'cerrada') = (cerrada_en is not null))
);

create index if not exists mantenimiento_unidad_idx on public.mantenimiento (tenant_id, unidad_id, estado);

-- ── Incidencias (OS&D operativo) ───────────────────────────────────────────
create table if not exists public.incidencia (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  viaje_id     uuid references public.viaje(id) on delete cascade,
  unidad_id    uuid references public.unidad(id) on delete set null,
  tipo         text not null,
  prioridad    text not null default 'media',
  estado       text not null default 'abierta',
  descripcion  text,
  responsable  uuid references public.app_user(id) on delete set null,
  sla_horas    int,
  abierta_en   timestamptz not null default now(),
  resuelta_en  timestamptz,
  constraint incidencia_tipo_dominio
    check (tipo in ('retraso', 'averia', 'dano', 'faltante', 'desvio')),
  constraint incidencia_prioridad_dominio
    check (prioridad in ('baja', 'media', 'alta')),
  constraint incidencia_estado_dominio
    check (estado in ('abierta', 'en_proceso', 'resuelta')),
  constraint incidencia_cierre_coherente
    check ((estado = 'resuelta') = (resuelta_en is not null))
);

comment on column public.incidencia.sla_horas is
  'Horas comprometidas para resolver. NULL = sin SLA pactado; la pantalla dice "sin SLA", no "0 h" (que se leería como vencido).';

create index if not exists incidencia_tenant_estado_idx on public.incidencia (tenant_id, estado, prioridad);
create index if not exists incidencia_viaje_idx on public.incidencia (viaje_id) where viaje_id is not null;

-- ── POD (evidencia de entrega) ─────────────────────────────────────────────
create table if not exists public.pod (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  viaje_id      uuid not null references public.viaje(id) on delete cascade,
  operador_id   uuid references public.operador(id) on delete set null,
  storage_path  text,
  lat           double precision,
  lng           double precision,
  estado        text not null default 'pendiente',
  nota          text,
  capturado_en  timestamptz,
  creado_en     timestamptz not null default now(),
  constraint pod_estado_dominio
    check (estado in ('pendiente', 'subido', 'rechazado')),
  -- Un POD "subido" sin archivo es el estado que hace ver una entrega
  -- comprobada cuando no lo está. O hay ruta de archivo, o no está subido.
  constraint pod_subido_tiene_archivo
    check (estado <> 'subido' or storage_path is not null)
);

comment on table public.pod is
  'Prueba de entrega. La foto vive en Storage (bucket privado), aquí solo la ruta — mismo criterio que comprobante: se conserva, no se exhibe sin base legal.';

create index if not exists pod_tenant_estado_idx on public.pod (tenant_id, estado);
create unique index if not exists pod_viaje_unico on public.pod (viaje_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Las cuatro nacen con RLS habilitada. Una tabla nueva sin RLS en un esquema
-- multi-tenant es el agujero que nadie ve hasta que alguien consulta
-- PostgREST directo con la anon key.
do $$
declare t text;
begin
  foreach t in array array['unidad', 'mantenimiento', 'incidencia', 'pod']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Oficina: dueño, encargado y contador. El chofer NO (ver encabezado).
do $$
declare t text;
begin
  foreach t in array array['unidad', 'mantenimiento', 'incidencia']
  loop
    execute format($p$
      create policy tenant_data on public.%I for all
      using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
      with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
    $p$, t);
  end loop;
end $$;

-- `pod` es la excepción: el chofer lo sube, así que ve e inserta el de sus
-- propios viajes. Escribir sí, borrar no — un POD que el chofer puede
-- eliminar no sirve como evidencia de nada.
create policy tenant_data on public.pod for all
  using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin());

create policy operador_ve_su_pod on public.pod for select
  using (viaje_id in (select id from public.viaje where operador_id = get_user_operador_id()));

create policy operador_sube_su_pod on public.pod for insert
  with check (viaje_id in (select id from public.viaje where operador_id = get_user_operador_id()));
