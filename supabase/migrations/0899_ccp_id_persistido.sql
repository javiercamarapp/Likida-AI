-- REVERSA: alter table public.viaje drop constraint if exists viaje_ccp_id_ccp_formato; alter table public.viaje drop column if exists ccp_id_ccp; Ninguna otra tabla cambia; el código vuelve a generar un IdCCP nuevo por descarga (comportamiento anterior).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0899 · IdCCP persistido por viaje (A37-S10-05)
--
-- `GET /api/export/carta-porte-xml` fabricaba un IdCCP nuevo en CADA descarga y solo lo escribía al log. El contador
-- descargaba, timbraba en su PAC y volvía a descargar (para corregir otro dato): recibía un IdCCP distinto para el mismo
-- viaje y podía timbrar un segundo complemento; Likida no podía decir cuál era el vigente.
--
-- ADITIVA e IDEMPOTENTE: una columna nullable (NULL = aún no se ha generado XML con IdCCP) y su CHECK de forma (el
-- IdCCP del estándar CCP 3.1: 36 caracteres RFC 4122 con los tres primeros siempre `CCC`). Sin default, sin datos que
-- rellenar, sin tocar RLS. COMPATIBLE HACIA ATRÁS: el código desplegado antes de esta migración no la lee ni la escribe;
-- el código nuevo tolera su ausencia (cae al id nuevo por descarga y lo avisa).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.viaje
  add column if not exists ccp_id_ccp text;

alter table public.viaje drop constraint if exists viaje_ccp_id_ccp_formato;
alter table public.viaje add constraint viaje_ccp_id_ccp_formato
  check (ccp_id_ccp is null or ccp_id_ccp ~* '^CCC[0-9a-f]{5}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

comment on column public.viaje.ccp_id_ccp is
  'IdCCP vigente del complemento Carta Porte de este viaje (CCP 3.1). Se fija en la PRIMERA descarga del XML y se reutiliza en las siguientes; solo cambia con una regeneración explícita (?regenerar=1). NULL = nunca se ha generado. Solo escribe /api/export/carta-porte-xml.';
