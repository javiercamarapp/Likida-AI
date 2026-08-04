-- ═══════════════════════════════════════════════════════════════════════════
-- 0052 — LO QUE LIKIDA LE COBRA A LA FLOTA (no lo que la flota cobra).
--
-- Ojo con el nombre, porque el esquema ya tiene lo contrario a un paso:
--   · `factura_emitida` (0049) = la flota le factura A SU CLIENTE.
--   · `factura_saas`    (aquí) = Likida le factura A LA FLOTA.
-- Son dos negocios distintos en la misma base y mezclarlos haría que
-- "ingresos" sumara el flete de un transportista con la mensualidad del SaaS.
--
-- `admin/cobranza` decía: "Sin facturación todavía. Likida no cobra a ningún
-- cliente todavía — esta página se llena en cuanto exista facturación real".
-- Y `admin/costos-facturacion`: "TODO esto depende de tener precio/plan de
-- facturación real por cliente, que no existe".
--
-- LOS PRECIOS NACEN EN NULL, Y ES A PROPÓSITO. La regla número uno del repo
-- es no inventar una cifra, y un precio es una cifra — de las caras: si el
-- panel enseña "$2,400/mes" porque alguien lo puso de ejemplo, esa cifra
-- termina en una propuesta. `precio_mensual` es NULLABLE y la pantalla dice
-- "sin precio configurado" hasta que Javier decida el modelo. Los tres planes
-- se siembran con NOMBRE y LÍMITES, nunca con precio.
--
-- `tenant.plan` (texto libre, default 'demo') ya existía desde la 0001 y se
-- queda: esta tabla no lo reemplaza, lo respalda. La suscripción es la que
-- manda para cobrar; `tenant.plan` sigue sirviendo para gatear features sin
-- una consulta más.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.plan (
  clave          text primary key,
  nombre         text not null,
  -- NULL = sin precio configurado. Ver la nota de arriba: un precio de ejemplo
  -- acaba en una propuesta comercial.
  precio_mensual numeric(10,2),
  moneda         text not null default 'MXN',
  -- NULL = sin límite. Un 0 significaría "no puede liquidar nada", que es lo
  -- contrario de lo que quiere decir un plan sin tope.
  limite_viajes_mes    int,
  limite_operadores    int,
  activo         boolean not null default true,
  orden          int not null default 0,
  constraint plan_precio_no_negativo check (precio_mensual is null or precio_mensual >= 0),
  constraint plan_limites_positivos check (
    (limite_viajes_mes is null or limite_viajes_mes > 0) and
    (limite_operadores is null or limite_operadores > 0))
);

comment on table public.plan is
  'Los planes con los que Likida cobra a las flotas. precio_mensual NULL = sin configurar: la regla del repo prohibe inventar cifras, y un precio de ejemplo termina en una propuesta.';
comment on column public.plan.limite_viajes_mes is
  'NULL = sin limite. Un 0 significaria "no puede liquidar nada", que es lo contrario.';

create table if not exists public.suscripcion (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  plan_clave   text not null references public.plan(clave) on delete restrict,
  estado       text not null default 'prueba',
  inicio       date not null default current_date,
  -- NULL = sin fecha de corte (prueba abierta o plan de cortesía).
  periodo_fin  date,
  cancelada_en timestamptz,
  -- Los ids de Stripe viven aquí y NO en `tenant`: una flota puede cambiar de
  -- suscripcion y la anterior tiene que seguir siendo auditable.
  stripe_customer_id     text,
  stripe_subscription_id text,
  creada_en    timestamptz not null default now(),
  constraint suscripcion_estado_dominio
    check (estado in ('prueba', 'activa', 'morosa', 'pausada', 'cancelada')),
  constraint suscripcion_cancelada_coherente
    check ((estado = 'cancelada') = (cancelada_en is not null)),
  constraint suscripcion_periodo_coherente
    check (periodo_fin is null or periodo_fin >= inicio)
);

-- Una flota tiene UNA suscripción viva. Sin esto, dos suscripciones activas
-- cobran dos veces y ninguna de las dos parece equivocada.
create unique index if not exists suscripcion_una_viva
  on public.suscripcion (tenant_id)
  where estado in ('prueba', 'activa', 'morosa', 'pausada');

create unique index if not exists suscripcion_stripe_unica
  on public.suscripcion (stripe_subscription_id) where stripe_subscription_id is not null;

comment on table public.suscripcion is
  'La suscripcion de una flota a Likida. Una viva por tenant: dos activas cobrarian dos veces sin que ninguna parezca equivocada.';

create table if not exists public.factura_saas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  suscripcion_id uuid references public.suscripcion(id) on delete set null,
  periodo_inicio date not null,
  periodo_fin    date not null,
  monto       numeric(10,2) not null,
  moneda      text not null default 'MXN',
  estado      text not null default 'pendiente',
  pagada_en   timestamptz,
  stripe_invoice_id text,
  creada_en   timestamptz not null default now(),
  constraint factura_saas_estado_dominio
    check (estado in ('pendiente', 'pagada', 'fallida', 'cancelada')),
  constraint factura_saas_monto_no_negativo check (monto >= 0),
  constraint factura_saas_pagada_coherente check ((estado = 'pagada') = (pagada_en is not null)),
  constraint factura_saas_periodo_coherente check (periodo_fin >= periodo_inicio)
);

create unique index if not exists factura_saas_stripe_unica
  on public.factura_saas (stripe_invoice_id) where stripe_invoice_id is not null;
create index if not exists factura_saas_cobranza_idx
  on public.factura_saas (estado, periodo_fin desc);

-- ── Los tres planes, SIN precio ────────────────────────────────────────────
insert into public.plan (clave, nombre, limite_viajes_mes, limite_operadores, orden) values
  ('demo',    'Demo',    50,   5,    0),
  ('flota',   'Flota',   500,  50,   1),
  ('empresa', 'Empresa', null, null, 2)
on conflict (clave) do nothing;

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- `plan` es catálogo público del producto: cualquiera autenticado puede leerlo
-- (lo necesita la pantalla de planes), pero NADIE lo escribe salvo superadmin.
-- Que un flota_admin pueda cambiarse el límite de su propio plan es un
-- self-service que nadie pidió.
alter table public.plan          enable row level security;
alter table public.suscripcion   enable row level security;
alter table public.factura_saas  enable row level security;

create policy plan_lectura on public.plan for select
  using (auth.uid() is not null);
create policy plan_escritura on public.plan for all
  using (is_superadmin()) with check (is_superadmin());

-- La flota ve SU suscripción y sus facturas de Likida (las necesita para su
-- propia contabilidad), pero solo quien ve dinero. Escribirlas es de Likida.
create policy suscripcion_lectura on public.suscripcion for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());
create policy suscripcion_escritura on public.suscripcion for all
  using (is_superadmin()) with check (is_superadmin());

create policy factura_saas_lectura on public.factura_saas for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());
create policy factura_saas_escritura on public.factura_saas for all
  using (is_superadmin()) with check (is_superadmin());
