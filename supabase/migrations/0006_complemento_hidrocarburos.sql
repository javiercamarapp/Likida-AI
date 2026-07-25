-- Complemento de hidrocarburos (Bloque 1, NIVEL 2). Campos del XML del CFDI que
-- el QR no trae y que el motor usa para la regla 2.7.1.48 RMF 2026.

alter table gasto add column if not exists clave_prod_serv text;            -- c_ClaveProdServ del concepto
alter table gasto add column if not exists clave_unidad text;               -- c_ClaveUnidad (LTR)
alter table gasto add column if not exists tipo_comprobante text;           -- I | E | P | N | T
alter table gasto add column if not exists complemento_hidrocarburos boolean; -- el XML trae el nodo del complemento
alter table gasto add column if not exists cfdi_esquema_alterno boolean;    -- ECC/Carta Porte → la regla NO aplica
alter table gasto add column if not exists xml_verificado boolean;          -- true = se parseó el XML del CFDI
