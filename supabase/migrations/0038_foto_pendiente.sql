-- BANDEJA DE FOTOS PENDIENTES — retener el ticket completo unos segundos por
-- si le sigue el acercamiento al código, para pagar UNA visión en vez de dos.
--
-- AUDITORÍA 8, ALTO REINCIDENTE (rendimiento) — el protocolo de dos fotos
-- (ticket completo + acercamiento al código) paga DOS llamadas de visión
-- completas cuando `extraerComprobante` ya sabe fusionar ambas en UNA sola si
-- se le pasan juntas (`string[]`). El único llamador real las manda de a una,
-- porque cada foto es su propio mensaje de WhatsApp y llega en su propia
-- invocación del webhook — no hay memoria compartida entre ellas.
--
-- Esta tabla es esa memoria, con vida de segundos. La foto SIN código (el
-- ticket completo — el acercamiento se toma justo porque el código no se leyó
-- en la foto amplia) se queda aquí esperando; si llega una foto CON código
-- para el mismo viaje dentro de la ventana, la reclama, descarga ambas y paga
-- una sola visión. Si nadie llega, la propia foto se reclama a sí misma al
-- vencer el plazo y se procesa sola — el camino de HOY, sin cambio.
--
-- POR QUÉ COMO MUCHO UNA POR VIAJE (unique). Dos fotos SIN código a la vez son
-- dos tickets DISTINTOS, no un par — emparejar el código que llegue después
-- con la que sea (la más vieja, la que sea) arriesga pegarle el folio de un
-- ticket al otro, y peor: `extraerComprobante` con dos fotos SIN código solo le
-- paga visión a la primera y la segunda se pierde ENTERA, con su gasto y todo.
-- Con el unique, la segunda foto sin código de un mismo viaje simplemente NO
-- espera y se procesa sola de inmediato — nunca hay dos held a la vez, así que
-- nunca hay a quién emparejar mal.
--
-- NO guarda el dataURL (puede pesar varios MB, y esto vive segundos): guarda el
-- `media_id` de Meta, que sigue descargable dentro de la ventana de espera.

create table if not exists foto_pendiente (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  viaje_id uuid not null references viaje(id) on delete cascade,
  media_id text not null,
  creado_en timestamptz not null default now(),
  unique (viaje_id)
);

-- Mismo criterio que la 0012 y la 0016: RLS ON sin policy = deny-all a
-- anon/authenticated. Solo el service-role (el pipeline) escribe y lee.
alter table foto_pendiente enable row level security;
