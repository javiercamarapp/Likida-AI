-- ═══════════════════════════════════════════════════════════════════════════
-- 0163 — LO QUE EL COBRO DE STRIPE NECESITA DE LA BASE (auditoría 18, "qué
--        tira producción": DAT-11, DAT-12, DAT-13, DAT-33).
--
-- Las cuatro son del mismo negocio —lo que Likida le cobra a la flota— y las
-- cuatro se descubren tarde: cuando el cliente ya transfirió, o cuando su
-- contador cruza el CFDI contra su estado de cuenta.
--
--   · DAT-11  `plan.stripe_price_id` era la ÚNICA forma de saber a qué plan
--             corresponde un price. Cambiarle el precio a un plan (crear un
--             price nuevo en Stripe y guardarlo) HUERFANABA a las suscripciones
--             viejas: sus eventos traen el price ANTERIOR, `planDePrice`
--             devolvía null y el webhook lanzaba para siempre — la flota que ya
--             pagaba se quedaba sin que se le aplicara un solo evento más.
--             Aquí nace `plan_price`, el histórico: un price NUNCA deja de
--             saber de qué plan era, aunque el plan ya cobre con otro.
--
--   · DAT-12  `metodo_cobro` nace en 'transferencia' (0057) y `aplicarFactura`
--             —el que registra las facturas de STRIPE— no lo tocaba. Con eso
--             una factura de Stripe entra al índice `factura_saas_una_por_
--             periodo` (que solo mira las de transferencia) y CHOCA contra la
--             mensualidad que /admin ya había emitido a mano para ese mes: el
--             upsert revienta con 23505, el webhook contesta 500 y Stripe
--             reintenta hasta rendirse. El cobro real queda sin registrar.
--             Aquí: backfill de las que ya existan + un CHECK que impide
--             volver a escribir la incoherencia (un `stripe_invoice_id` con
--             método 'transferencia' ya no entra).
--
--   · DAT-13  timbrar leía `cfdi_uuid`, veía null y llamaba al PAC. Dos clics
--             —o el clic y un reintento— pasan los dos por ese null: DOS CFDI
--             REALES por la misma mensualidad, y uno hay que cancelarlo ante el
--             SAT. `timbrando_en` es la RESERVA: se toma con un UPDATE
--             condicional (compare-and-set) antes de llamar al PAC, así que el
--             segundo intento no tiene qué reservar y se para solo.
--
--   · DAT-33  el CFDI se timbraba y nadie guardaba con qué se lo verifica
--             (`verification_url`), ni el id del PAC —sin él no se puede
--             CANCELAR—, ni cuándo se canceló. Un reembolso en Stripe dejaba
--             un CFDI vivo por dinero devuelto.
--
-- Idempotente: `create table if not exists`, `add column if not exists`,
-- `drop constraint if exists` + `add constraint`. Se puede correr dos veces.
--
-- Reversible:
--   drop table public.plan_price;
--   alter table public.factura_saas drop constraint factura_saas_metodo_coherente;
--   alter table public.factura_saas drop constraint factura_saas_cancelado_coherente;
--   alter table public.factura_saas drop column timbrando_en, drop column cfdi_proveedor_id,
--     drop column cfdi_verificacion_url, drop column cfdi_cancelado_en;
--   alter table public.tenant drop column email_facturacion;
-- ═══════════════════════════════════════════════════════════════════════════

-- ── DAT-11 · el histórico de precios ───────────────────────────────────────
--
-- La llave primaria es el PRICE, no el plan: la pregunta que se hace el webhook
-- es "este price, ¿de qué plan era?", y esa respuesta no puede cambiar nunca.
-- `reemplazado_en` dice cuándo dejó de ser el vigente; se conserva la fila
-- igual, porque una suscripción vieja sigue cobrando con él.
create table if not exists public.plan_price (
  stripe_price_id     text primary key,
  plan_clave          text not null references public.plan(clave) on delete restrict,
  -- Copia del precio tal como Stripe lo declaró EL DÍA que se ligó. No es
  -- redundancia con `plan`: `plan` tiene el VIGENTE, esto tiene el que se le
  -- está cobrando a quien sigue en el price viejo.
  precio_mensual      numeric(10,2),
  moneda              text not null default 'MXN',
  precio_iva_incluido boolean,
  vigente_desde       timestamptz not null default now(),
  reemplazado_en      timestamptz,
  constraint plan_price_precio_no_negativo check (precio_mensual is null or precio_mensual >= 0)
);

comment on table public.plan_price is
  'Historico price de Stripe -> plan. Un price NUNCA deja de saber de que plan era: cambiarle el price a un plan huerfanaba las suscripciones viejas y el webhook dejaba de aplicarles eventos (DAT-11).';
comment on column public.plan_price.reemplazado_en is
  'Cuando dejo de ser el price vigente del plan. La fila NO se borra: hay suscripciones cobrando con el.';

create index if not exists plan_price_por_plan_idx
  on public.plan_price (plan_clave, vigente_desde desc);

-- Backfill: lo que hoy está ligado en `plan` es el price vigente de cada plan.
insert into public.plan_price (stripe_price_id, plan_clave, precio_mensual, moneda, precio_iva_incluido)
select p.stripe_price_id, p.clave, p.precio_mensual, p.moneda, p.precio_iva_incluido
  from public.plan p
 where p.stripe_price_id is not null
on conflict (stripe_price_id) do nothing;

alter table public.plan_price enable row level security;

-- Mismo criterio que `plan` (0052): catálogo legible por cualquiera con sesión
-- —la pantalla de planes lo necesita— y escribible solo por superadmin. Que un
-- flota_admin pueda decir "este price es del plan barato" sería cambiarse el
-- precio a sí mismo.
drop policy if exists plan_price_lectura on public.plan_price;
create policy plan_price_lectura on public.plan_price for select
  using (auth.uid() is not null);
drop policy if exists plan_price_escritura on public.plan_price;
create policy plan_price_escritura on public.plan_price for all
  using (is_superadmin()) with check (is_superadmin());

-- ── DAT-12 · el método de cobro dice la verdad ─────────────────────────────
update public.factura_saas
   set metodo_cobro = 'stripe'
 where stripe_invoice_id is not null
   and metodo_cobro is distinct from 'stripe';

-- El invariante que impide repetir el bug: si hay factura de Stripe, el método
-- es 'stripe'; y si el método es 'stripe', tiene que haber factura de Stripe.
-- Sin esto, el default de la 0057 vuelve a meter facturas de Stripe al índice
-- `factura_saas_una_por_periodo` y el webhook revienta con 23505 el mes en que
-- /admin haya emitido esa misma mensualidad a mano.
alter table public.factura_saas drop constraint if exists factura_saas_metodo_coherente;
alter table public.factura_saas add constraint factura_saas_metodo_coherente
  check ((metodo_cobro = 'stripe') = (stripe_invoice_id is not null));

-- ── DAT-13 · la reserva del timbrado ───────────────────────────────────────
--
-- NO es un booleano "timbrando": es CUÁNDO se reservó, para que un intento que
-- murió a media llamada al PAC no deje la factura sin timbrar para siempre. El
-- código reserva con `timbrando_en is null or timbrando_en < now() - 10 min`.
alter table public.factura_saas add column if not exists timbrando_en timestamptz;
comment on column public.factura_saas.timbrando_en is
  'Reserva del timbrado (compare-and-set). Se toma ANTES de llamar al PAC: dos clics simultaneos veian los dos cfdi_uuid null y timbraban DOS CFDI reales (DAT-13). Caduca a los 10 min para que un intento muerto no bloquee.';

-- ── DAT-33 · el papel se puede verificar y se puede cancelar ───────────────
alter table public.factura_saas add column if not exists cfdi_proveedor_id text;
alter table public.factura_saas add column if not exists cfdi_verificacion_url text;
alter table public.factura_saas add column if not exists cfdi_cancelado_en timestamptz;

comment on column public.factura_saas.cfdi_proveedor_id is
  'El id del CFDI en el PAC. Sin el no se puede CANCELAR: el UUID del SAT no sirve para llamar a la API del PAC.';
comment on column public.factura_saas.cfdi_verificacion_url is
  'La liga del SAT/PAC con la que el cliente comprueba que su CFDI existe. Se guarda porque es lo que se le manda.';

-- Cancelado sin timbrar no existe: sería decir que se canceló un papel que
-- nunca se emitió.
alter table public.factura_saas drop constraint if exists factura_saas_cancelado_coherente;
alter table public.factura_saas add constraint factura_saas_cancelado_coherente
  check (cfdi_cancelado_en is null or cfdi_uuid is not null);

-- ── DAT-33 · a dónde se manda el CFDI ──────────────────────────────────────
--
-- El timbrado salía sin correo del receptor: Facturapi creaba el customer sin
-- email y el `/email` no llegaba a ningún lado. El cliente pagaba, el CFDI
-- existía ante el SAT y él no lo veía nunca. Va en `tenant` junto al resto de
-- lo fiscal (0056) y NO en `app_user`: la factura es de la EMPRESA, y el correo
-- de quien dio el clic puede ser el de un becario que ya no está.
alter table public.tenant add column if not exists email_facturacion text;
comment on column public.tenant.email_facturacion is
  'A donde se le manda el CFDI de la mensualidad. Vive en tenant y no en app_user: la factura es de la empresa, no de quien dio el clic.';
