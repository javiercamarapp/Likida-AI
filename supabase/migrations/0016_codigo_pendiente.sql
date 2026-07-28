-- BANDEJA DE CÓDIGOS PENDIENTES — el acercamiento que llega ANTES que su ticket.
--
-- El protocolo de dos fotos (ticket completo + acercamiento al código) no puede
-- exigir orden: en WhatsApp cada foto es su propio mensaje y llegan como el
-- operador las mande. Cuando el acercamiento entra primero no hay a qué gasto
-- pegarle su folio, y NO puede darse de alta solo —vale el mismo dinero que el
-- ticket que le corresponde, y sumar los dos inflaría la liquidación—.
--
-- Antes de esta tabla ese folio simplemente se perdía: se le pedía al operador
-- la foto del ticket y el código exacto se tiraba. Aquí queda esperando hasta
-- que entre el comprobante de su mismo total.
--
-- Por qué en Postgres y no en un caché: es un dato del que depende el folio que
-- la oficina teclea en el portal para timbrar. Un desalojo silencioso por
-- presión de memoria se vería como "el OCR volvió a leer mal el folio".

create table if not exists codigo_pendiente (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  viaje_id uuid not null references viaje(id) on delete cascade,
  -- El total que venía DENTRO del código. Es la ÚNICA llave contra el ticket:
  -- el operador no etiqueta las fotos.
  monto numeric(12,2) not null,
  folio_portal text,
  codigo_barras text,
  url_facturacion text,
  cfdi_uuid text,
  creado_en timestamptz not null default now()
);

-- El emparejamiento siempre es (viaje, monto).
create index if not exists idx_codigo_pendiente_viaje on codigo_pendiente (viaje_id, monto);

-- Mismo criterio que la 0012: RLS ON sin policy = deny-all a anon/authenticated.
-- Solo el service-role (el pipeline) escribe y lee. Un anónimo que pudiera
-- INSERTAR aquí conseguiría colgarle a un gasto real el folio que él quisiera.
alter table codigo_pendiente enable row level security;
