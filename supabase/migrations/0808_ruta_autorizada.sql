-- ═══════════════════════════════════════════════════════════════════════════
-- 0808 — CONDUCTOR (T-A5-48): el REPOSITORIO de rutas autorizadas de Google Maps.
--
-- El link de la ruta que recibe el chofer NO se arma ni se inventa: sale de una base de rutas hechas con anticipación y revisadas
-- por la flota (una por corredor; en exportación, además, la del destino). Esta tabla guarda esa base, POR FLOTA.
--
--   · `corredor`, `sitio_origen` y `sitio_destino` se guardan normalizados (minúsculas, sin acentos, espacios simples) por el
--     importador; `sitio_*` es el CÓDIGO del sitio del catálogo (texto, sin llave foránea: la ruta puede preceder al sitio).
--     Sin sitio_origen ni sitio_destino = la ruta del corredor completo.
--   · `url` solo puede ser https y de Google Maps (`maps.app.goo.gl/…` o `google.com/maps…`): lo exige la base además del código,
--     para que ningún camino de escritura guarde otro dominio.
--   · `vigente_hasta` (fecha en la zona de la flota, inclusive; nulo = sin vencimiento) y `revisada_en` (para el mantenimiento por
--     antigüedad, T-A5-50) son fechas, sin hora.
--   · Una sola fila por (flota, corredor, origen, destino): reimportar el mismo archivo no duplica.
--
-- Solo aditiva e idempotente (create … if not exists, drop … if exists). Sin rutas ni datos del cliente: nace vacía. RLS con la
-- misma política de lectura que `ciclo_servicio` (0807); la escritura solo la hace el servidor.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ruta_autorizada (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  corredor text not null,
  sitio_origen text,
  sitio_destino text,
  url text not null,
  vigente_hasta date,
  revisada_en date,
  created_at timestamptz not null default now(),
  constraint ruta_autorizada_corredor_largo check (char_length(corredor) between 1 and 80),
  constraint ruta_autorizada_sitio_origen_largo check (sitio_origen is null or char_length(sitio_origen) between 1 and 80),
  constraint ruta_autorizada_sitio_destino_largo check (sitio_destino is null or char_length(sitio_destino) between 1 and 80),
  constraint ruta_autorizada_url_largo check (char_length(url) <= 2048),
  constraint ruta_autorizada_url_mapas check (
    url ~ '^https://(maps\.app\.goo\.gl/[^[:space:]]+|(www\.)?google\.com/maps([/?#][^[:space:]]*)?)$'
  )
);
comment on table public.ruta_autorizada is
  '0808: rutas de Google Maps autorizadas por la flota, por corredor (y sitio origen/destino). Solo https y dominio de mapas. Nace vacia; sin datos del cliente.';
comment on column public.ruta_autorizada.vigente_hasta is
  'Fecha (zona de la flota), inclusive, hasta la que la ruta sirve; nulo = sin vencimiento. Vencida = ausente para el chofer.';

create unique index if not exists ruta_autorizada_unica
  on public.ruta_autorizada (tenant_id, corredor, coalesce(sitio_origen, ''), coalesce(sitio_destino, ''));
create index if not exists ruta_autorizada_corredor on public.ruta_autorizada (tenant_id, corredor);

alter table public.ruta_autorizada enable row level security;
drop policy if exists tenant_lee on public.ruta_autorizada;
create policy tenant_lee on public.ruta_autorizada for select
  using (
    (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
    or (select public.is_superadmin())
  );
revoke all on table public.ruta_autorizada from public, anon, authenticated;
grant select on table public.ruta_autorizada to authenticated;
grant select, insert, update, delete on table public.ruta_autorizada to service_role;
