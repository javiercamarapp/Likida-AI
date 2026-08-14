-- ═══════════════════════════════════════════════════════════════════════════
-- IDEMPOTENCIA DEL CORREO ENTRANTE — el gemelo de `wa_mensaje_procesado`
--
-- Resend REINTENTA cualquier webhook que no conteste 2xx. Sin esta tabla, un
-- timeout nuestro a mitad de proceso produce una segunda entrega del MISMO
-- correo, y con ella una segunda factura en la contabilidad del cliente.
--
-- El dedup que ya existe en `factura_proveedor` (unique tenant+uuid) atrapa el
-- caso del mismo CFDI, pero NO el de un correo con varios adjuntos donde el
-- segundo falló: al reintentar, el primero se vuelve a procesar. Por eso la
-- llave es el CORREO, no la factura.
--
-- Mismo diseño que la 0002 y por las mismas razones: una sola columna que es
-- la llave primaria (el insert falla si ya está, y ese fallo ES la respuesta),
-- y un índice por fecha para poder limpiar. Sin RLS ni tenant_id: es una tabla
-- de control del sistema, solo la toca el service role, y meterle tenant_id
-- obligaría a resolverlo ANTES de saber si el correo ya se procesó — al revés
-- del orden que hace falta.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.correo_procesado (
  email_id   text primary key,
  created_at timestamptz not null default now()
);

create index if not exists idx_correo_procesado_created
  on public.correo_procesado (created_at);

alter table public.correo_procesado enable row level security;

comment on table public.correo_procesado is
  'Idempotencia del webhook de correo entrante. Resend reintenta lo que no conteste 2xx; sin esto un timeout duplica la factura. La llave es el CORREO y no el CFDI porque el dedup de factura_proveedor no cubre el reintento de un correo con varios adjuntos.';
