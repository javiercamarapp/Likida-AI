-- Campos fiscales del gasto (validación CFDI vs SAT) + config parametrizable por tenant.

alter table gasto add column if not exists rfc_receptor text;
alter table gasto add column if not exists estado_sat text;      -- vigente|cancelado|no_encontrado|pendiente
alter table gasto add column if not exists efos boolean;         -- true = emisor en lista negra 69-B

-- Config por tenant (política, tabulador, cuentas, salida). Si es null → DEMO_CONFIG.
alter table tenant add column if not exists config jsonb;
