-- ═══════════════════════════════════════════════════════════════════════════
-- 0176 — el vínculo que faltaba entre una unidad y su GPS
--
-- La landing dice «el GPS de tu flota» entre las fuentes de dato. Los cuatro
-- conectores (Wialon, Samsara, Geotab, Navixy) existen, declaran
-- `leer_posiciones` entre sus capacidades y tienen su `probar()` verificado
-- contra documentación primaria — pero NADIE trae una sola posición: la tabla
-- `posicion` tiene un único escritor, el pin manual que un chofer manda por
-- WhatsApp.
--
-- Lo que faltaba para cerrarlo no era el adaptador: era esto. Una posición
-- llega identificada por el ID del dispositivo EN EL SISTEMA DEL PROVEEDOR
-- (`vehicleId` en Samsara, `id` en Wialon), y sin una columna que lo ligue a
-- `unidad` no hay dónde asentarla. Ese fue el hueco durante meses.
--
-- `gps_proveedor` va aparte de `gps_device_id` a propósito: una flota puede
-- migrar de proveedor y conservar sus unidades, y el mismo número de
-- dispositivo puede existir en dos sistemas distintos. Sin el proveedor, el
-- índice único diría que dos unidades comparten GPS cuando no es cierto.
--
-- El único es PARCIAL (`where gps_device_id is not null`): la mayoría de las
-- unidades no tendrán GPS conectado, y esas no compiten por unicidad.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.unidad
  add column if not exists gps_device_id text,
  add column if not exists gps_proveedor text,
  add column if not exists gps_visto_en timestamptz;

comment on column public.unidad.gps_device_id is
  'Id del dispositivo en el sistema del proveedor (vehicleId de Samsara, id de Wialon…). NULL = esta unidad no tiene GPS conectado.';
comment on column public.unidad.gps_proveedor is
  'Con cuál de los conectores se ligó. Va aparte del id porque el mismo número puede existir en dos sistemas distintos.';
comment on column public.unidad.gps_visto_en is
  'Última vez que el poller trajo una posición de esta unidad. NULL = nunca. Es lo que distingue "conector configurado" de "fuente sincronizada".';

-- Dos unidades de una flota no pueden apuntar al MISMO dispositivo: si pasara,
-- las posiciones de un camión se repartirían entre dos y ninguna serie sería
-- cierta.
drop index if exists uq_unidad_gps;
create unique index uq_unidad_gps
  on public.unidad (tenant_id, gps_proveedor, gps_device_id)
  where gps_device_id is not null;

comment on index uq_unidad_gps is
  'Un dispositivo GPS = una unidad por flota. Parcial: las unidades sin GPS no compiten.';

-- El poller escribe MUCHO y lee por unidad y ventana. Sin esto, la consulta del
-- mapa recorre la tabla entera de posiciones de la flota.
create index if not exists posicion_unidad_medida_idx
  on public.posicion (tenant_id, unidad_id, medida_en desc);

-- ── LA IDEMPOTENCIA DEL POLLER ────────────────────────────────────────────
-- El poller corre cada pocos minutos y el proveedor devuelve la ÚLTIMA posición
-- conocida: dos corridas seguidas sin que el camión se mueva traen la misma
-- lectura, con la misma `medida_en`. Sin este único, la tabla se llenaría de
-- copias y cualquier conteo por unidad mentiría.
--
-- Y va SIN `where`, aunque `unidad_id` sea `not null` y un predicado siempre
-- cierto pareciera inofensivo: con un único PARCIAL, PostgREST no puede
-- inferir el índice a partir de `on_conflict=tenant_id,unidad_id,medida_en` y
-- el upsert del poller reventaría con «no unique or exclusion constraint
-- matching the ON CONFLICT specification». El predicado decorativo habría
-- costado la ingesta entera.
drop index if exists uq_posicion_lectura;
create unique index uq_posicion_lectura
  on public.posicion (tenant_id, unidad_id, medida_en);

comment on index uq_posicion_lectura is
  'Una lectura por unidad e instante. El poller reencuentra la misma última posición entre corridas: sin esto, la tabla se llena de copias.';

-- ── EL CRON ENTRA AL LATIDO ───────────────────────────────────────────────
-- `cron_latido` (0155) restringe su `id` a un dominio cerrado, y con razón: un
-- id con dedazo entraría como cron nuevo y el panel de salud lo daría por vivo
-- para siempre sin que nadie lo hubiera programado. Añadir un cron significa
-- ensanchar el dominio a propósito, aquí, en una migración — no en el código.
alter table public.cron_latido drop constraint if exists cron_latido_id_dominio;
alter table public.cron_latido add constraint cron_latido_id_dominio
  check (id in ('wa-pendientes', 'escalar', 'facturar', 'purgar', 'runner', 'gps'));
