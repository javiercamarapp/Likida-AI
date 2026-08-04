-- ═══════════════════════════════════════════════════════════════════════════
-- 0055 — LO QUE LE FALTABA A LA 0052 PARA COBRAR DE VERDAD.
--
-- La 0052 dejó el modelo completo (plan, suscripcion, factura_saas) con sus
-- columnas de Stripe, pero sin las DOS piezas que hacen falta para que un cobro
-- ocurra y no se cobre dos veces.
--
-- ── 1. `plan.stripe_price_id` ──────────────────────────────────────────────
--
-- Un Checkout de suscripción se arma con un PRICE de Stripe, no con un número.
-- Sin esta columna, `precio_mensual` es un rótulo bonito que no cobra nada.
--
-- Y LAS DOS CIFRAS PUEDEN DIVERGIR, que es el modo de falla caro: la pantalla
-- diría "$2,400/mes" mientras Stripe cobra $3,000, y el cliente descubre la
-- diferencia en su estado de cuenta. Por eso el código NO deja teclear
-- `precio_mensual` a mano junto al price id: lo LEE de Stripe al guardar el
-- price y lo escribe aquí. La base espeja a Stripe; Stripe es la verdad.
--
-- ── 2. `evento_stripe` ─────────────────────────────────────────────────────
--
-- Stripe REINTENTA los webhooks hasta que le contestas 2xx, y manda el mismo
-- evento más de una vez por diseño. Sin idempotencia, un `invoice.paid`
-- reintentado aplica el pago dos veces. Los índices únicos de la 0052 cubren la
-- factura (`stripe_invoice_id`) pero no los eventos que no crean factura:
-- cambios de estado, cancelaciones, un `customer.subscription.updated` que
-- reactive una suscripción cancelada.
--
-- Mismo patrón que `wa_mensaje_procesado` para WhatsApp, y por la misma razón.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El price de Stripe por plan ─────────────────────────────────────────
alter table public.plan add column if not exists stripe_price_id text;

comment on column public.plan.stripe_price_id is
  'El price de Stripe con el que se cobra este plan. NULL = el plan no se puede contratar todavia. precio_mensual se LEE de Stripe al guardar esto, nunca se teclea aparte: dos cifras distintas se descubren en el estado de cuenta del cliente.';

-- Dos planes con el mismo price cobrarían lo mismo diciendo cosas distintas.
create unique index if not exists plan_stripe_price_unico
  on public.plan (stripe_price_id) where stripe_price_id is not null;

-- ── 2. Idempotencia de los webhooks ────────────────────────────────────────
create table if not exists public.evento_stripe (
  -- El id que manda Stripe (`evt_...`). ES la llave: si ya está, ya se aplicó.
  id           text primary key,
  tipo         text not null,
  -- Para poder reconstruir qué pasó sin volver a pedírselo a Stripe.
  payload      jsonb,
  procesado_en timestamptz not null default now()
);

comment on table public.evento_stripe is
  'Eventos de Stripe ya aplicados. Stripe reintenta los webhooks por diseno: sin esta tabla un invoice.paid reintentado aplica el pago dos veces.';

create index if not exists evento_stripe_tipo_idx
  on public.evento_stripe (tipo, procesado_en desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Los eventos traen el payload crudo de Stripe (ids de cliente, montos, correo
-- de facturación). No es del cliente y no es del panel: lo escribe el webhook
-- con el service role, y solo el superadmin lo lee. Sin una policy de lectura,
-- con RLS activo, `authenticated` no ve NADA — que es lo correcto aquí.
alter table public.evento_stripe enable row level security;

drop policy if exists evento_stripe_superadmin on public.evento_stripe;
create policy evento_stripe_superadmin on public.evento_stripe for all
  using (is_superadmin()) with check (is_superadmin());

-- El service role salta RLS, así que el webhook escribe sin policy propia.
