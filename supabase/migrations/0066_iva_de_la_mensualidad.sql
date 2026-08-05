-- ═══════════════════════════════════════════════════════════════════════════
-- 0066 — DE QUÉ LADO DEL PRECIO ESTÁ EL IVA.
--
-- RENUMERADA de 0065 a 0066 el 4-ago-2026 (auditoría 10, rubro datos): dos
-- agentes en paralelo escribieron migraciones distintas con el mismo prefijo
-- "0065" (ésta, y 0065_cfdi_de_varias_casetas.sql, que YA estaba aplicada a
-- producción — se confirmó contra el proyecto real vía MCP). La colisión
-- desactivaba `migraciones_verificadas.test.ts`: al indexar por los 4
-- primeros caracteres del nombre de archivo, el bloque 44 de este mismo
-- archivo (título "...mig. 0065") pasaba como cobertura de AMBAS migraciones,
-- aunque solo prueba la de CFDI. Esta migración nunca se había aplicado a
-- producción, así que renombrar el archivo no reordena nada ya ejecutado.
--
-- EL FALLO QUE ESTO CIERRA. `emitirMensualidad` escribía `factura_saas.monto =
-- plan.precio_mensual`, la pantalla del cliente le decía que transfiriera ESE
-- número, y el mismo número entraba a `timbrarMensualidad`, cuyo contrato dice
-- "Subtotal SIN IVA" y que manda a Facturapi con `tax_included: false`. Con un
-- plan de $10,000: el cliente transfiere $10,000 y el CFDI sale por $11,600.
-- Su contador concilia contra el estado de cuenta y no cuadra — y el CFDI ya
-- existe ante el SAT, así que la única salida es cancelarlo.
--
-- CUÁL DE LOS DOS LADOS ESTÁ MAL NO SE PUEDE SABER DESDE EL CÓDIGO: depende de
-- cómo esté configurado el `unit_amount` del price en Stripe. Por eso esto no
-- elige un lado: obliga a DECLARARLO, y deja que el sistema se niegue a operar
-- mientras nadie lo haya declarado.
--
-- ── 1. `plan.precio_iva_incluido` ──────────────────────────────────────────
--
-- NULL = NADIE LO DECLARÓ. No es "no lleva IVA": es "no se sabe", y es el
-- estado en el que están hoy los tres planes. El código lo trata como motivo
-- para NO emitir ni timbrar, igual que `precio_mensual is null` ya impide
-- cobrar. Un default `false` habría convertido una pregunta abierta en una
-- respuesta inventada — que es exactamente el bug que esta migración cierra.
--
-- Se llena solo: `guardarPriceDePlan` lo LEE del `tax_behavior` del price de
-- Stripe (`inclusive` → true, `exclusive` → false, `unspecified` → null), del
-- mismo modo que ya lee el monto. Stripe es la verdad; la base la espeja.
--
-- ── 2. `factura_saas.subtotal` y `factura_saas.iva` ────────────────────────
--
-- `monto` pasa a ser SIEMPRE EL TOTAL QUE EL CLIENTE TRANSFIERE. Es el número
-- que ve en pantalla y el que sale en su estado de cuenta, así que es el que
-- tiene que cuadrar con el total del CFDI.
--
-- El desglose se GUARDA en vez de recalcularse al timbrar: entre la emisión y
-- el timbrado pueden pasar semanas, y en medio alguien puede cambiar el price
-- del plan. Recalcular en el timbrado tomaría el criterio NUEVO para un cobro
-- que ya se hizo con el viejo. Lo que se timbra tiene que ser lo que se cobró.
--
-- El CHECK amarra los tres: `monto = subtotal + iva`, con un centavo de
-- tolerancia por el redondeo. Sin él, tres columnas de dinero pueden
-- desincronizarse sin que nada avise.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El criterio del precio ──────────────────────────────────────────────
alter table public.plan add column if not exists precio_iva_incluido boolean;

comment on column public.plan.precio_iva_incluido is
  'true = precio_mensual YA trae el IVA. false = el IVA va encima. NULL = nadie lo declaro, y entonces no se emite ni se timbra nada: emitir un CFDI por 16% de mas es irreversible. Se lee del tax_behavior del price de Stripe, no se teclea.';

-- ── 2. El desglose de cada factura, congelado al emitirla ──────────────────
alter table public.factura_saas add column if not exists subtotal numeric(10,2);
alter table public.factura_saas add column if not exists iva numeric(10,2);

comment on column public.factura_saas.monto is
  'EL TOTAL QUE EL CLIENTE TRANSFIERE, con IVA. Es lo que se le enseña en pantalla y lo que tiene que cuadrar con el total del CFDI.';
comment on column public.factura_saas.subtotal is
  'Base sin IVA. Es lo que se le manda al PAC como precio del concepto (Facturapi timbra con tax_included:false). NULL = factura anterior a la 0066: NO se timbra, porque no se sabe cual de las dos cifras era.';
comment on column public.factura_saas.iva is
  'IVA trasladado de esta mensualidad. Se guarda en vez de recalcularse al timbrar: entre emitir y timbrar el precio del plan puede cambiar, y lo que se timbra tiene que ser lo que se cobro.';

-- Los dos van juntos o no va ninguno: media factura desglosada no se puede
-- timbrar ni conciliar, y se vería igual de completa que una entera.
alter table public.factura_saas drop constraint if exists factura_saas_desglose_coherente;
alter table public.factura_saas add constraint factura_saas_desglose_coherente
  check ((subtotal is null) = (iva is null));

alter table public.factura_saas drop constraint if exists factura_saas_desglose_no_negativo;
alter table public.factura_saas add constraint factura_saas_desglose_no_negativo
  check ((subtotal is null or subtotal >= 0) and (iva is null or iva >= 0));

-- El centavo de tolerancia es del redondeo, no una licencia: 10000/1.16 no da
-- una cifra exacta en centavos y el reparto se cierra sobre el total.
alter table public.factura_saas drop constraint if exists factura_saas_desglose_cuadra;
alter table public.factura_saas add constraint factura_saas_desglose_cuadra
  check (subtotal is null or abs(monto - (subtotal + iva)) <= 0.01);
