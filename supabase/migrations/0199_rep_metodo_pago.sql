-- ═══════════════════════════════════════════════════════════════════════════
-- 0199 — EL REP QUE NADIE INGERÍA: el IVA a crédito que se perdía en silencio
-- (Plan maestro 26-ago, Fase 7 del back office).
--
-- `engine.ts` excluye correctamente el IVA de un CFDI con `FormaPago 99`
-- citando LIVA 5-III ("efectivamente pagado en el mes"), y su comentario
-- promete que se acreditará el mes en que se pague CON SU COMPLEMENTO DE
-- PAGO. Pero no había código que ingiriera ese REP (CFDI TipoDeComprobante=P)
-- — `MetodoPago` ni siquiera se parseaba. El IVA salía de la cuenta y no
-- volvía nunca: para una flota que compra diésel a crédito con su estación de
-- casa es el 16% de su gasto de diésel, cada mes. El hueco donde el sistema
-- hace lo correcto y aun así le cuesta dinero al cliente.
--
-- Tres piezas:
--   1. `gasto.metodo_pago` (PUE/PPD del CFDI original) — para saber QUÉ
--      comprobantes esperan un REP.
--   2. `cfdi_pago` — cada DoctoRelacionado de cada REP ingerido, con su
--      idempotencia por (tenant, REP, docto): reenviar el mismo REP no
--      duplica nada.
--   3. `gasto.pagado_en` / `gasto.pagado_forma` — el sello que el REP deja en
--      el gasto que liquida. Solo lo escribe la ingesta del REP y SOLO cuando
--      el docto quedó totalmente pagado (ImpSaldoInsoluto = 0): un pago en
--      parcialidades acredita proporcionalmente por pago (LIVA 5-III) y ese
--      reparto NO se automatiza aquí — fail-closed, la fila queda registrada
--      en cfdi_pago y el gasto sin sellar hasta la última parcialidad.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.gasto
  add column if not exists metodo_pago text,
  add column if not exists pagado_en date,
  add column if not exists pagado_forma text;

-- Mismo criterio que `gasto_forma_pago_formato` (0025): formato, no catálogo.
-- El parser ya normaliza (metodoPagoSat descarta lo que no sea PUE/PPD), esto
-- caza al segundo escritor que la 0025 no contempló en su día.
alter table public.gasto
  add constraint gasto_metodo_pago_dominio
  check (metodo_pago is null or metodo_pago in ('PUE', 'PPD'));

alter table public.gasto
  add constraint gasto_pagado_forma_formato
  check (pagado_forma is null or pagado_forma ~ '^[0-9]{2}$');

comment on column public.gasto.metodo_pago is
  '@MetodoPago del CFDI (PUE=una exhibición, PPD=parcialidades/diferido). PPD + FormaPago 99 = espera un REP.';
comment on column public.gasto.pagado_en is
  'Fecha de pago del REP que liquidó este CFDI POR COMPLETO (ImpSaldoInsoluto=0). NULL = sin REP o pago parcial: el IVA sigue excluido (LIVA 5-III). Solo lo escribe la ingesta del REP — jamás se infiere.';
comment on column public.gasto.pagado_forma is
  'FormaDePagoP del pago del REP — el medio con el que DE VERDAD se pagó (el FormaPago 99 del CFDI original solo decía "por definir").';

-- ── El registro de cada documento que un REP liquida ───────────────────────
create table if not exists public.cfdi_pago (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenant(id) on delete cascade,
  -- El UUID del REP mismo (su Timbre). El XML crudo del REP se conserva en
  -- `cfdi_xml` como cualquier CFDI (CFF 30), no aquí.
  cfdi_uuid              text not null,
  fecha_pago             date not null,
  forma_pago_p           text,
  docto_relacionado_uuid text not null,
  imp_pagado             numeric(14,2) not null,
  imp_saldo_insoluto     numeric(14,2),
  num_parcialidad        int,
  -- IVA trasladado del docto EN ESTE PAGO (TrasladoDR ImpuestoDR=002
  -- ImporteDR). NULL = el REP no lo desglosó (ImporteDR es condicional en el
  -- XSD — verificado contra Pagos20.xsd del SAT el 26-ago-2026).
  iva_pagado             numeric(14,2),
  created_at             timestamptz not null default now(),
  constraint cfdi_pago_forma_formato check (forma_pago_p is null or forma_pago_p ~ '^[0-9]{2}$')
);

-- La llave de idempotencia: el MISMO REP reenviado (correo + WhatsApp, o dos
-- reenvíos del chofer) no duplica el registro de un docto.
create unique index if not exists uq_cfdi_pago_docto
  on public.cfdi_pago (tenant_id, cfdi_uuid, docto_relacionado_uuid);

-- Para encontrar los pagos de un CFDI dado (el JOIN de la ingesta y del panel).
create index if not exists cfdi_pago_docto_idx
  on public.cfdi_pago (tenant_id, docto_relacionado_uuid);

comment on table public.cfdi_pago is
  'Cada DoctoRelacionado de cada REP (CFDI de Pagos 2.0) ingerido. Es el rastro que libera el IVA a crédito: LIVA 5-III lo acredita en el mes del PAGO, no en el del comprobante. Append-only por convención: el único escritor es la ingesta del REP (intake/rep.ts).';

-- Mismo doble candado que qa_* (0196) y las tablas de asistencia: RLS
-- deny-all + sin grants directos. Solo service_role (la app) la toca.
alter table public.cfdi_pago enable row level security;
revoke all on public.cfdi_pago from public, anon, authenticated;
grant select, insert on public.cfdi_pago to service_role;
