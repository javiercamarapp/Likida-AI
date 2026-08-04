-- ═══════════════════════════════════════════════════════════════════════════
-- 0048 — EL LADO DEL INGRESO: cliente, tarifa, y lo que el flete deja.
--
-- Hasta aquí el esquema solo sabía lo que la flota GASTA. `dashboard/
-- rentabilidad` lo declaraba en pantalla, con estas palabras:
--
--   "Likida ve todo lo que tu flota gasta, pero no ve lo que cobra. El
--    sistema no registra el ingreso del flete en ningún lado — `viaje.
--    anticipo` es el dinero que le adelantas al operador, no lo que te paga
--    tu cliente."
--
-- Y `dashboard/clientes`:
--
--   "No existe tabla de clientes. Un viaje hoy guarda origen, destino,
--    operador y anticipo — nunca a quién se le está moviendo la carga."
--
-- Esta migración cierra las dos. Con ella quedan alimentables Clientes,
-- Rentabilidad y la mitad del Cotizador.
--
-- POR QUÉ `ingreso_flete` VIVE EN `viaje` Y NO EN UNA TABLA APARTE: un viaje
-- se cobra una vez. Una tabla de ingresos permitiría dos ingresos para el
-- mismo viaje sin que nada lo impida, y "cuánto dejó este viaje" dejaría de
-- tener una sola respuesta. Si mañana hacen falta cargos extra (estadía,
-- maniobras), van en su propia tabla de conceptos, no partiendo el flete.
--
-- TODO ES ADITIVO Y TODO ES NULLABLE. Los 8 viajes que ya existen no tienen
-- cliente ni ingreso, y eso NO es un cero: es un dato que nadie capturó. La
-- pantalla tiene que decir "sin registrar", nunca "$0" — un 0 de encuadre se
-- lee como un 0 de la flota.
--
-- RLS: `cliente` y `tarifa` son de DINERO, así que no basta `not
-- is_operador()` como en la 0047. El encargado (0044) despacha y no ve
-- finanzas (`lib/auth/visibilidad.ts`), y dejarle leer tarifas por PostgREST
-- sería la misma fuga que la app evita en la UI. Para eso nace `ve_finanzas()`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El permiso de DINERO, en la base ───────────────────────────────────────
--
-- Espeja `AREAS_POR_ROL.dinero` de `lib/auth/visibilidad.ts`: superadmin,
-- flota_admin y contador. El encargado y el operador quedan fuera.
--
-- Existe porque la matriz de roles vivía SOLO en TypeScript. Mientras el
-- panel llame a la base con la service role eso alcanza, pero cualquier
-- usuario autenticado tiene la anon key y puede pegarle a PostgREST directo:
-- ahí la única frontera es RLS. Sin esto, un encargado curioso lee las
-- tarifas de su flota con un fetch.
create or replace function public.ve_finanzas()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_user
    where id = auth.uid()
      and rol in ('superadmin', 'flota_admin', 'contador')
  );
$$;

comment on function public.ve_finanzas is
  'TRUE si el usuario puede ver dinero. Espeja AREAS_POR_ROL.dinero de lib/auth/visibilidad.ts: superadmin, flota_admin, contador. El encargado despacha, no factura.';

-- `anon` no tiene por qué poder llamarla: sin sesión siempre devuelve false,
-- pero un endpoint RPC de más es superficie de más.
revoke execute on function public.ve_finanzas() from anon;

-- ── Clientes de la flota ───────────────────────────────────────────────────
create table if not exists public.cliente (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  nombre        text not null,
  rfc           text,
  contacto      text,
  correo        text,
  telefono      text,
  -- Días de crédito pactados. NULL = no pactado; la cobranza dice "sin
  -- condiciones registradas" en vez de suponer contado (que inventaría
  -- vencimientos y los pintaría de rojo).
  dias_credito  int,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now(),
  constraint cliente_dias_credito_sano check (dias_credito is null or (dias_credito >= 0 and dias_credito <= 365)),
  -- Un RFC identifica a un cliente dentro de UNA flota. Único por tenant y
  -- no global: dos flotas pueden facturarle al mismo cliente y ninguna está
  -- equivocada. Parcial, porque el RFC es opcional al darlo de alta.
  constraint cliente_nombre_unico unique (tenant_id, nombre)
);

create unique index if not exists cliente_rfc_unico
  on public.cliente (tenant_id, rfc) where rfc is not null;

comment on table public.cliente is
  'A quién le mueve la carga la flota. Sin esto no se puede decir cuánto deja cada cliente ni qué tan concentrado está el ingreso en uno solo.';
comment on column public.cliente.dias_credito is
  'NULL = no pactado. La pantalla dice "sin condiciones registradas"; suponer contado inventaría vencimientos.';

create index if not exists cliente_tenant_activo_idx on public.cliente (tenant_id, activo);

-- ── Tarifas (la mitad que le faltaba al cotizador) ─────────────────────────
--
-- `dashboard/cotizador` decía: "no hay tabla de precios por ruta, ni por
-- kilómetro, ni por tonelada". Los tres modos caben aquí porque el precio
-- cambia de UNIDAD, no de naturaleza.
create table if not exists public.tarifa (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  -- NULL = tarifa de lista, aplica a cualquier cliente. Con cliente = tarifa
  -- negociada, que gana sobre la de lista.
  cliente_id  uuid references public.cliente(id) on delete cascade,
  origen      text,
  destino     text,
  modo        text not null,
  precio      numeric(12,2) not null,
  moneda      text not null default 'MXN',
  vigente_desde date not null default current_date,
  vigente_hasta date,
  activa      boolean not null default true,
  creada_en   timestamptz not null default now(),
  constraint tarifa_modo_dominio check (modo in ('por_viaje', 'por_km', 'por_tonelada')),
  constraint tarifa_precio_positivo check (precio > 0),
  -- Una vigencia al revés deja la tarifa fuera de todo rango y desaparece sin
  -- avisar: quien la capturó cree que puso un precio y el cotizador no
  -- encuentra ninguno.
  constraint tarifa_vigencia_coherente
    check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);

comment on column public.tarifa.cliente_id is
  'NULL = tarifa de lista. Con cliente = negociada, y esa gana sobre la de lista.';
comment on column public.tarifa.modo is
  'por_viaje | por_km | por_tonelada. Cambia la UNIDAD del precio, no su naturaleza.';

create index if not exists tarifa_busqueda_idx
  on public.tarifa (tenant_id, activa, modo, vigente_desde desc);

-- ── Lo que `viaje` no guardaba: a quién, por cuánto, y cuántos km ──────────
alter table public.viaje
  add column if not exists cliente_id uuid references public.cliente(id) on delete set null;

-- El ingreso del flete: lo que el CLIENTE paga. Distinto de `anticipo`, que
-- es lo que la empresa le adelanta al OPERADOR. Confundirlos es exactamente
-- el error que `dashboard/rentabilidad` se negaba a cometer.
alter table public.viaje
  add column if not exists ingreso_flete numeric(12,2);

alter table public.viaje
  add column if not exists km_recorridos int;

comment on column public.viaje.ingreso_flete is
  'Lo que paga el CLIENTE por el flete. NO es `anticipo` (eso se le adelanta al operador). NULL = no capturado, y la pantalla dice "sin registrar", nunca $0.';
comment on column public.viaje.km_recorridos is
  'NULL = no capturado. Sin esto no hay km/l ni costo por kilómetro; un 0 los volvería infinito o cero, las dos mentiras.';

alter table public.viaje
  add constraint viaje_ingreso_no_negativo check (ingreso_flete is null or ingreso_flete >= 0) not valid;
alter table public.viaje
  add constraint viaje_km_sanos check (km_recorridos is null or (km_recorridos > 0 and km_recorridos < 20000)) not valid;

create index if not exists viaje_cliente_idx on public.viaje (cliente_id) where cliente_id is not null;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.cliente enable row level security;
alter table public.tarifa  enable row level security;

create policy tenant_finanzas on public.cliente for all
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

create policy tenant_finanzas on public.tarifa for all
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());
