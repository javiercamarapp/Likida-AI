-- COMPROBANTES SIN VIAJE — porque una foto NUNCA se rechaza.
--
-- El 1-ago-2026, probando en vivo, quedó a la vista la asimetría más fea del
-- intake: cuando no hay viaje abierto, el XML del CFDI SÍ se conserva
-- (`saveCfdiXmlRaw` con `gasto_id` nulo, ver el corte de `processor.ts`) y la
-- FOTO se tira con un «No tienes un viaje abierto». El producto pide un
-- documento y luego se niega a recibir justo el que más importa.
--
-- Y hay un chofer real detrás: no todos escriben «hola» ni esperan a que la
-- oficina les abra el viaje. Terminan la ruta, sacan el fajo y mandan once
-- fotos de golpe. Hoy ese operador pierde once comprobantes y no se entera —
-- se le dijo «no tienes viaje», no «tiré tus tickets».
--
-- Mismo caso cuando la foto llega DESPUÉS de emitida la liquidación: el
-- trigger de la 0036 la rechaza con razón (si entrara, el PDF ya entregado y el
-- mensaje de WhatsApp dirían cifras distintas), pero rechazarla no obliga a
-- perderla.
--
-- ESTA TABLA ES LA SALA DE ESPERA. La foto se guarda en el bucket
-- `comprobantes` (mig. 0039) y aquí queda su extracción ya hecha, para que al
-- adjuntarla NO haya que pagar la visión otra vez y para poder decirle al
-- operador CUÁNTO trae cada una antes de preguntarle si van.
--
-- POR QUÉ SE PREGUNTA ANTES DE ADJUNTAR, y no se adjunta solo: un ticket del
-- viaje anterior metido en el de hoy es dinero en la liquidación equivocada, y
-- nadie lo nota hasta que el contralor paga. La confirmación cuesta un mensaje.

create table if not exists comprobante_huerfano (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  operador_id uuid not null references operador(id) on delete cascade,
  -- Ruta dentro del bucket privado `comprobantes`. Nunca una URL firmada: nace
  -- caducando y no habría forma de renovarla.
  ruta_imagen text,
  -- La extracción completa, tal cual la devolvió el OCR. Al adjuntar se inserta
  -- desde aquí: sin segunda llamada de visión y sin depender de que la imagen
  -- siga siendo legible.
  gasto jsonb not null,
  -- 'sin_viaje' | 'tras_liquidar'. Cambia lo que se le dice al operador.
  motivo text not null,
  creado_en timestamptz not null default now(),
  -- Se llenan al resolverse. `viaje_id` nulo y `resuelto_en` nulo = sigue en
  -- espera; es la condición que busca el processor en cada mensaje.
  viaje_id uuid references viaje(id) on delete set null,
  resuelto_en timestamptz,
  -- 'adjuntado' | 'descartado'. Descartado = el operador dijo que no era de
  -- este viaje. No se borra: es el rastro de un comprobante que existió.
  resolucion text,
  -- CUÁNDO SE LE PREGUNTÓ. Vive aquí y no en el estado de la conversación para
  -- que la marca viaje con el dato que describe: `wa_conversacion.estado` se
  -- reescribe entero en cada guardado y se vacía al cambiar de viaje, que es
  -- justo cuando esta pregunta sigue siendo pertinente.
  --
  -- Sin esto, la oferta se repetiría en CADA mensaje mientras el operador no
  -- conteste. Ya pasó con el acuse de ráfaga y con el aviso de acercamiento:
  -- tres mensajes idénticos seguidos hacen ver el producto roto.
  ofrecido_en timestamptz
);

-- La consulta caliente: «¿este operador tiene algo esperando?», en cada mensaje.
create index if not exists idx_huerfano_pendiente
  on comprobante_huerfano (tenant_id, operador_id)
  where resuelto_en is null;

-- Mismo criterio que la 0012, la 0016 y la 0038: RLS ON sin policy = deny-all a
-- anon/authenticated. Solo el service-role escribe y lee.
alter table comprobante_huerfano enable row level security;
