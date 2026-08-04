-- ═══════════════════════════════════════════════════════════════════════════
-- 0057 — COBRAR POR TRANSFERENCIA DIRECTA, SIN PASARELA.
--
-- Decisión del 4-ago-2026: las flotas transfieren a la cuenta de Likida en BBVA.
-- No es Stripe con SPEI (donde Stripe da una CLABE virtual y concilia solo): es
-- una transferencia a una cuenta bancaria de verdad.
--
-- Y ESO CAMBIA UNA COSA QUE NO SE PUEDE DISIMULAR: **un banco no manda
-- webhooks**. BBVA no le avisa a la app que entró dinero. No hay `invoice.paid`
-- que esperar. La única forma de saber que pagaron es que una persona lo vea en
-- el estado de cuenta y lo marque.
--
-- Por eso esta migración NO agrega un estado "pagada automática": agrega la
-- CONCILIACIÓN MANUAL con nombre y apellido. `conciliada_por` guarda QUIÉN la
-- dio por pagada y `referencia_banco` con QUÉ movimiento del banco. Sin esas
-- dos columnas, "pagada" sería la palabra de alguien sin nada detrás — y esta
-- tabla decide si un cliente sigue con servicio.
--
-- LA REFERENCIA ES EL PUENTE. El cliente la escribe en el concepto de su
-- transferencia y es lo que permite casar un depósito con una factura. Sin ella
-- llegan depósitos de "TRANSPORTES..." sin saber de qué mes son. Es determinista
-- (tenant + periodo), así que reemitir el mismo mes NO genera una segunda
-- referencia ni una segunda factura.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.factura_saas add column if not exists referencia text;
alter table public.factura_saas add column if not exists metodo_cobro text not null default 'transferencia';
alter table public.factura_saas add column if not exists conciliada_por uuid references public.app_user(id) on delete set null;
alter table public.factura_saas add column if not exists conciliada_en timestamptz;
alter table public.factura_saas add column if not exists referencia_banco text;

comment on column public.factura_saas.referencia is
  'Lo que el cliente escribe en el concepto de su transferencia. Es lo unico que permite casar un deposito con una factura: sin ella llegan depositos sin saber de que mes son.';
comment on column public.factura_saas.conciliada_por is
  'QUIEN dio por pagada esta factura. Un banco no manda webhooks: alguien la marco a mano y tiene que quedar registrado quien.';
comment on column public.factura_saas.referencia_banco is
  'El movimiento del estado de cuenta con el que se concilio. Es la prueba de que el dinero existe.';

alter table public.factura_saas drop constraint if exists factura_saas_metodo_dominio;
alter table public.factura_saas add constraint factura_saas_metodo_dominio
  check (metodo_cobro in ('transferencia', 'stripe'));

-- Dos facturas con la misma referencia harían imposible casar un depósito.
create unique index if not exists factura_saas_referencia_unica
  on public.factura_saas (referencia) where referencia is not null;

-- UNA factura por flota y periodo. Sin esto, apretar "emitir" dos veces le cobra
-- el mismo mes dos veces a la misma flota, y las dos parecen legítimas.
create unique index if not exists factura_saas_una_por_periodo
  on public.factura_saas (tenant_id, periodo_inicio, periodo_fin)
  where metodo_cobro = 'transferencia' and estado <> 'cancelada';

-- Conciliada y pagada van juntas o no van. Una factura "pagada" sin saber quién
-- la marcó es exactamente lo que esta migración existe para impedir.
alter table public.factura_saas drop constraint if exists factura_saas_conciliacion_coherente;
alter table public.factura_saas add constraint factura_saas_conciliacion_coherente
  check ((conciliada_por is null) = (conciliada_en is null));

create index if not exists factura_saas_por_cobrar_idx
  on public.factura_saas (estado, periodo_fin desc) where estado = 'pendiente';
