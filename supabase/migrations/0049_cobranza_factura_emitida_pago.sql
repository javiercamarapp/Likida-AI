-- ═══════════════════════════════════════════════════════════════════════════
-- 0049 — COBRANZA: lo que la flota EMITE y lo que le pagan.
--
-- `dashboard/cobranza` lo declaraba así:
--
--   "No hay facturación emitida en el sistema, así que no hay nada que cobrar
--    que Likida conozca. No existe tabla de facturas propias, ni de pagos
--    recibidos, ni de recordatorios enviados. Los CFDI que Likida sí maneja
--    son los que tú RECIBES de tus proveedores — es lo contrario."
--
-- Esa distinción es la razón del nombre. `gasto.cfdi_uuid` guarda el CFDI que
-- la flota RECIBE; `factura_emitida` guarda el que la flota EXPIDE. Meterlos
-- en la misma tabla habría hecho que "total facturado" sumara las dos cosas y
-- diera un número que no significa nada.
--
-- EL SALDO NO SE GUARDA, SE CALCULA. Una columna `saldo` se desincroniza en
-- cuanto un pago se cancela, y entonces la pantalla y la suma de pagos dicen
-- cosas distintas sobre el mismo dinero. La vista `factura_saldo` lo deriva.
--
-- `vence_en` TAMPOCO SE ADIVINA. Si el cliente no tiene días de crédito
-- pactados (`cliente.dias_credito is null`, 0048), la factura nace sin
-- vencimiento y la cobranza dice "sin condiciones registradas". Ponerle 30
-- días por defecto pintaría de rojo facturas que nadie pactó.
--
-- RLS: dinero puro → `ve_finanzas()` (0048). El encargado no las ve.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.factura_emitida (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  cliente_id   uuid not null references public.cliente(id) on delete restrict,
  -- NULL a propósito: una factura puede amparar varios viajes o ninguno
  -- (renta, estadía). La liga fina vive en `factura_viaje`.
  viaje_id     uuid references public.viaje(id) on delete set null,
  folio        text,
  -- El UUID del CFDI timbrado. NULL mientras la factura esté en borrador:
  -- Likida NO timbra (no es PAC), así que este dato llega de fuera.
  cfdi_uuid    text,
  fecha        date not null default current_date,
  subtotal     numeric(12,2) not null,
  iva          numeric(12,2) not null default 0,
  total        numeric(12,2) not null,
  moneda       text not null default 'MXN',
  estatus      text not null default 'borrador',
  vence_en     date,
  creada_en    timestamptz not null default now(),
  constraint factura_estatus_dominio
    check (estatus in ('borrador', 'emitida', 'pagada', 'cancelada')),
  constraint factura_importes_positivos
    check (subtotal >= 0 and iva >= 0 and total >= 0),
  -- El total tiene que ser subtotal + IVA. Sin esto, un total tecleado a mano
  -- descuadra la cobranza contra la contabilidad del cliente y nadie sabe
  -- cuál de los dos números creer. Tolerancia de un centavo por redondeo.
  constraint factura_total_cuadra
    check (abs(total - (subtotal + iva)) <= 0.01),
  -- Una factura timbrada tiene UUID; una en borrador no puede tenerlo, porque
  -- entonces ya está timbrada y el estatus miente.
  constraint factura_borrador_sin_uuid
    check (not (estatus = 'borrador' and cfdi_uuid is not null)),
  constraint factura_vence_despues
    check (vence_en is null or vence_en >= fecha)
);

-- El mismo CFDI no se registra dos veces en la misma flota: sería cobrar
-- dos veces el mismo papel, y el saldo del cliente saldría al doble.
create unique index if not exists factura_cfdi_unico
  on public.factura_emitida (tenant_id, cfdi_uuid) where cfdi_uuid is not null;

create unique index if not exists factura_folio_unico
  on public.factura_emitida (tenant_id, folio) where folio is not null;

comment on table public.factura_emitida is
  'El CFDI que la flota EXPIDE a su cliente. Lo contrario de `gasto.cfdi_uuid`, que es el que RECIBE de sus proveedores.';
comment on column public.factura_emitida.vence_en is
  'NULL = el cliente no tiene días de crédito pactados. La cobranza dice "sin condiciones registradas"; suponer 30 días pintaría de rojo lo que nadie pactó.';

create index if not exists factura_cobranza_idx
  on public.factura_emitida (tenant_id, estatus, vence_en);
create index if not exists factura_cliente_idx
  on public.factura_emitida (tenant_id, cliente_id, fecha desc);

-- ── Los viajes que ampara una factura ──────────────────────────────────────
create table if not exists public.factura_viaje (
  factura_id uuid not null references public.factura_emitida(id) on delete cascade,
  viaje_id   uuid not null references public.viaje(id) on delete cascade,
  primary key (factura_id, viaje_id)
);

comment on table public.factura_viaje is
  'Qué viajes ampara una factura. Existe porque una factura puede cubrir varios viajes y un viaje puede refacturarse tras una cancelación.';

-- ── Pagos recibidos ────────────────────────────────────────────────────────
create table if not exists public.pago_recibido (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  factura_id  uuid not null references public.factura_emitida(id) on delete cascade,
  fecha       date not null default current_date,
  monto       numeric(12,2) not null,
  metodo      text,
  referencia  text,
  registrado_en timestamptz not null default now(),
  constraint pago_monto_positivo check (monto > 0)
);

comment on table public.pago_recibido is
  'Abonos a una factura. Varios por factura a propósito: los pagos parciales son la norma en flotas, y forzar uno solo obligaría a mentir el monto.';

create index if not exists pago_factura_idx on public.pago_recibido (factura_id, fecha);
create index if not exists pago_tenant_fecha_idx on public.pago_recibido (tenant_id, fecha desc);

-- ── El saldo, DERIVADO ─────────────────────────────────────────────────────
create or replace view public.factura_saldo as
  select f.id                                    as factura_id,
         f.tenant_id,
         f.cliente_id,
         f.total,
         coalesce(sum(p.monto), 0)               as pagado,
         f.total - coalesce(sum(p.monto), 0)     as saldo,
         f.estatus,
         f.vence_en,
         -- Vencida solo si HAY fecha pactada y queda saldo. Sin fecha no se
         -- puede decir que algo se venció: no se pactó cuándo.
         (f.vence_en is not null
          and f.vence_en < current_date
          and f.total - coalesce(sum(p.monto), 0) > 0.01
          and f.estatus not in ('cancelada', 'borrador')) as vencida
    from public.factura_emitida f
    left join public.pago_recibido p on p.factura_id = f.id
   group by f.id;

comment on view public.factura_saldo is
  'Saldo por factura, derivado de los pagos. NO es una columna: una guardada se desincroniza al cancelar un pago y entonces la pantalla y la suma dicen cosas distintas del mismo dinero.';

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.factura_emitida enable row level security;
alter table public.pago_recibido   enable row level security;
alter table public.factura_viaje   enable row level security;

create policy tenant_finanzas on public.factura_emitida for all
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

create policy tenant_finanzas on public.pago_recibido for all
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

-- `factura_viaje` no tiene `tenant_id` propio: hereda el de su factura. Se
-- resuelve por EXISTS para que no haya una segunda copia del tenant que se
-- pueda desincronizar de la primera.
create policy tenant_finanzas on public.factura_viaje for all
  using (exists (
    select 1 from public.factura_emitida f
     where f.id = factura_id
       and ((f.tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())))
  with check (exists (
    select 1 from public.factura_emitida f
     where f.id = factura_id
       and ((f.tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin())));
