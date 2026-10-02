-- 0561 — Liquidación externa: el sistema del cliente CONFIRMA que ya leyó el
-- acuse del chofer (salida hacia SAP/TMS por pull).
--
-- EL CICLO. El chofer aprieta «Recibida» o «No coincide» (`acuse_tipo`,
-- `acuse_en`). El SAP/TMS del cliente lee los acuses por `GET
-- /v1/liquidaciones-externas/acuses` y, cuando ya los registró en su sistema,
-- los confirma con `POST /v1/liquidaciones-externas/acuses/confirmar`. Esa
-- confirmación es lo que guarda `acuse_confirmado_en`: así el integrador no
-- relee lo mismo para siempre ni pierde uno si su proceso se cae a la mitad
-- (lo no confirmado vuelve a salir en la siguiente lectura).
--
-- Si el chofer CAMBIA su respuesta (de «Recibida» a «No coincide»), la
-- confirmación anterior ya no cubre lo que dice el acuse: el servicio la
-- vuelve a NULL y el acuse nuevo se entrega otra vez.
--
-- También se amplía el dominio de la bitácora (`liquidacion_externa_evento`)
-- con `acuse_confirmado` y `aviso_oficina` (el aviso a la oficina cuando el
-- chofer responde «No coincide»). El CHECK se reescribe ENTERO partiendo del de
-- la 0370.

alter table public.liquidacion_externa
  add column if not exists acuse_confirmado_en timestamptz;

alter table public.liquidacion_externa
  drop constraint if exists liquidacion_externa_acuse_confirmado_coherente;
alter table public.liquidacion_externa
  add constraint liquidacion_externa_acuse_confirmado_coherente
  check (acuse_confirmado_en is null or acuse_en is not null);

comment on column public.liquidacion_externa.acuse_confirmado_en is
  '0561: cuándo el sistema del cliente confirmó (POST /v1/liquidaciones-externas/acuses/confirmar) que ya leyó el acuse del chofer. NULL = el acuse sigue pendiente de leer por su sistema. Se reinicia si el chofer cambia su respuesta.';

-- Los acuses por leer, en el orden en que se leen (acuse_en, id).
create index if not exists liquidacion_externa_acuses_pendientes_idx
  on public.liquidacion_externa (tenant_id, acuse_en, id)
  where acuse_en is not null and acuse_confirmado_en is null;

alter table public.liquidacion_externa_evento
  drop constraint if exists liquidacion_externa_evento_tipo_dominio;
alter table public.liquidacion_externa_evento
  add constraint liquidacion_externa_evento_tipo_dominio check (tipo in (
    'recibida', 'encolada', 'enviada', 'fallback_plantilla', 'fallida',
    'reintento_manual', 'acuse_recibida', 'acuse_no_coincide',
    'acuse_confirmado', 'aviso_oficina'
  ));
