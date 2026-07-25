-- Acreditamiento fiscal (NIVEL 1): medio de pago + impuestos desglosados del XML,
-- y acumuladores de IEPS/IVA/peaje acreditable por liquidación (LIF 2026 Art. 20).

alter table gasto add column if not exists forma_pago text;               -- c_FormaPago (01=efectivo…)
alter table gasto add column if not exists sub_total numeric(12,2);        -- @SubTotal (base peaje)
alter table gasto add column if not exists ieps_traslado numeric(12,2);    -- Traslado 003 (IEPS)
alter table gasto add column if not exists iva_traslado numeric(12,2);     -- Traslado 002 (IVA)

alter table liquidacion add column if not exists ieps_acreditable numeric(12,2) not null default 0;
alter table liquidacion add column if not exists iva_acreditable  numeric(12,2) not null default 0;
alter table liquidacion add column if not exists peaje_acreditable numeric(12,2) not null default 0;
