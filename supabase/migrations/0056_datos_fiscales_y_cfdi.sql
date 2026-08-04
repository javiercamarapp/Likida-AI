-- ═══════════════════════════════════════════════════════════════════════════
-- 0056 — LO QUE EL CFDI EXIGE Y LA 0052 NO GUARDABA.
--
-- Decisión del 4-ago-2026: las flotas pagan por TRANSFERENCIA SPEI, no con
-- tarjeta. Se midió cómo cobran siete empresas del mercado —Handle, Nowports,
-- Yalo, leadsales y las tres de rastreo de flotas (Encontrack, Detektor,
-- Copiloto)— y las siete dan el mismo resultado: cero precios públicos, cero
-- pasarela de pago en el sitio. Se cotiza, se factura y se cobra por
-- transferencia. Un contralor de flota no paga la mensualidad con tarjeta.
--
-- Y EN MÉXICO EL COBRO NO CIERRA LA OPERACIÓN: cierra el CFDI 4.0 timbrado.
-- Stripe cobra pero NO emite CFDI —eso pasa obligatoriamente por un PAC— y el
-- CFDI necesita del receptor cinco datos que este esquema no tenía. `tenant.rfc`
-- existía desde la 0001 y era el único.
--
-- SIN ESTOS DATOS NO SE PUEDE FACTURAR, y esa es la razón de que vivan en
-- `tenant` y no en una tabla aparte: son de la flota, hay exactamente uno por
-- flota, y la pantalla de suscripción los tiene que exigir ANTES de mandar a
-- pagar. Cobrarle a alguien a quien después no le puedes facturar es el peor
-- orden posible: ya tienes su dinero y no puede deducirlo.
--
-- LOS VALORES SON CATÁLOGOS DEL SAT, NO TEXTO LIBRE INVENTADO. `regimen_fiscal`
-- y `uso_cfdi` traen sus claves oficiales; el check las acota a las que aplican
-- a este producto. Una clave inventada la rechaza el PAC al timbrar, o peor: la
-- acepta y emite un comprobante que el contador del cliente no puede usar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Datos fiscales del receptor (la flota) ─────────────────────────────────
alter table public.tenant add column if not exists razon_social text;
alter table public.tenant add column if not exists regimen_fiscal text;
alter table public.tenant add column if not exists codigo_postal_fiscal text;
alter table public.tenant add column if not exists uso_cfdi text;

comment on column public.tenant.razon_social is
  'Razon social EXACTA como aparece en su Constancia de Situacion Fiscal. El PAC rechaza el timbrado si no coincide con lo que el SAT tiene registrado para ese RFC.';
comment on column public.tenant.regimen_fiscal is
  'Clave del catalogo c_RegimenFiscal del SAT. 601 = General de Ley Personas Morales, el de una empresa de transporte tipica.';
comment on column public.tenant.codigo_postal_fiscal is
  'CP del domicilio fiscal del receptor. Va en el CFDI 4.0 y el SAT lo valida contra el RFC.';
comment on column public.tenant.uso_cfdi is
  'Clave del catalogo c_UsoCFDI. G03 = Gastos en general, que es como una flota deduce una suscripcion de software.';

-- Solo las claves que aplican a este producto. Es preferible rechazar una que
-- no esté en la lista a timbrar con una clave que el contador no pueda usar.
alter table public.tenant drop constraint if exists tenant_regimen_fiscal_dominio;
alter table public.tenant add constraint tenant_regimen_fiscal_dominio
  check (regimen_fiscal is null or regimen_fiscal in (
    '601',  -- General de Ley Personas Morales
    '603',  -- Personas Morales con Fines no Lucrativos
    '612',  -- Personas Fisicas con Actividades Empresariales y Profesionales
    '621',  -- Incorporacion Fiscal
    '626'   -- RESICO
  ));

alter table public.tenant drop constraint if exists tenant_uso_cfdi_dominio;
alter table public.tenant add constraint tenant_uso_cfdi_dominio
  check (uso_cfdi is null or uso_cfdi in (
    'G03',  -- Gastos en general
    'G01',  -- Adquisicion de mercancias
    'I04',  -- Equipo de computo y accesorios
    'S01'   -- Sin efectos fiscales (publico en general)
  ));

-- El CP fiscal son 5 dígitos. Un CP mal tecleado no truena: el PAC lo rechaza
-- semanas después, cuando ya hay pagos que facturar.
alter table public.tenant drop constraint if exists tenant_cp_fiscal_forma;
alter table public.tenant add constraint tenant_cp_fiscal_forma
  check (codigo_postal_fiscal is null or codigo_postal_fiscal ~ '^[0-9]{5}$');

-- ── El CFDI de cada factura de Likida ──────────────────────────────────────
--
-- `cfdi_uuid` NULL = cobrada pero SIN TIMBRAR. Es un estado real y hay que
-- poder verlo: el dinero entró y el cliente todavía no tiene con qué deducirlo.
alter table public.factura_saas add column if not exists cfdi_uuid text;
alter table public.factura_saas add column if not exists cfdi_xml_url text;
alter table public.factura_saas add column if not exists timbrada_en timestamptz;
-- La liga de Stripe donde el cliente ve la CLABE para transferir.
alter table public.factura_saas add column if not exists url_pago text;

comment on column public.factura_saas.cfdi_uuid is
  'Folio fiscal del CFDI timbrado. NULL = cobrada pero sin timbrar: el dinero entro y el cliente no puede deducirlo todavia.';
comment on column public.factura_saas.url_pago is
  'hosted_invoice_url de Stripe: donde el cliente ve la CLABE y la referencia para su transferencia SPEI.';

alter table public.factura_saas drop constraint if exists factura_saas_timbrada_coherente;
alter table public.factura_saas add constraint factura_saas_timbrada_coherente
  check ((cfdi_uuid is not null) = (timbrada_en is not null));

create unique index if not exists factura_saas_cfdi_unico
  on public.factura_saas (cfdi_uuid) where cfdi_uuid is not null;

-- Para la pantalla de "cobradas sin timbrar", que es la que evita que un
-- cliente lleve tres meses pagando sin una sola factura.
create index if not exists factura_saas_sin_timbrar_idx
  on public.factura_saas (tenant_id, periodo_fin desc)
  where cfdi_uuid is null and estado = 'pagada';
