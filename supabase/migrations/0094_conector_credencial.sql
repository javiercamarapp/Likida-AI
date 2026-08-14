-- ═══════════════════════════════════════════════════════════════════════════
-- CREDENCIALES DE CONECTOR — dónde viven los accesos de los 19 conectores
--
-- El framework de conectores (14-ago-2026) quedó escrito con SAP, Wialon,
-- Samsara, Geotab, Navixy, Oracle, Odoo y los monederos, cada uno declarando
-- QUÉ credenciales pide. Pero solo 5 tenían dónde guardarlas: `rastreo_credencial`
-- (mig. 0050) acepta únicamente proveedores de GPS —su constraint
-- `rastreo_proveedor_dominio` lista wialon|traccar|samsara|geotab|navixy|otro—,
-- así que los 14 restantes tenían `claveAlmacen: null` y no se podían conectar
-- aunque el adaptador estuviera completo.
--
-- ── POR QUÉ UNA TABLA NUEVA Y NO AMPLIAR LA DE RASTREO ───────────────────
--
-- Porque no tienen la misma sensibilidad. Un token de GPS de solo lectura y la
-- contraseña de un usuario de SAP Business One no son la misma clase de cosa:
-- con la segunda, alguien entra al ERP del cliente. Mezclarlas en una tabla
-- obligaría a que la política más laxa cubriera a la más peligrosa.
--
-- ── LOS VALORES VAN CIFRADOS, Y EL CIFRADO LO HACE EL SERVIDOR ───────────
--
-- `valores_cifrados` guarda un JSON cifrado en la app, no en Postgres. La razón
-- es concreta: si se cifrara con pgcrypto, la llave viviría en la base o en un
-- parámetro de sesión, y quien pudiera leer la tabla —service role, un volcado,
-- un backup— podría descifrarla. Cifrando en el servidor con una llave que solo
-- existe en el entorno de ejecución, un volcado de la base es ruido.
--
-- `pistas` es lo ÚNICO que el panel devuelve: los campos no secretos en claro
-- (host, base de datos, usuario) y de cada secreto solo sus últimos 4. Alcanza
-- para que una persona reconozca cuál credencial es y confirme que tecleó la
-- correcta, y no alcanza para usarla.
--
-- ── QUIÉN MANDA: `administra_flota()`, COMO EN RASTREO Y EN LAS LLAVES ───
--
-- Esto es CONTROL, no dato: con estas credenciales Likida entra a sistemas del
-- cliente. Ni el contador ni el encargado. Mismo criterio que
-- `rastreo_credencial` (0050) y `tenant_api_key` (0093).
--
-- ── `ultimo_error` ES LO QUE CONVIERTE "ESCRITO" EN "VERIFICABLE" ────────
--
-- Sin él, una credencial que dejó de servir se ve idéntica a una que nunca se
-- probó, y el panel pintaría verde una conexión muerta. Pero OJO: ese campo se
-- LEE desde el panel, así que ningún `probar()` puede copiar ahí la respuesta
-- cruda del proveedor — hay proveedores que devuelven el token en su mensaje de
-- error. Se guarda una frase escrita por nosotros.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.conector_credencial (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,

  -- El id del catálogo (`sap_b1`, `wialon`, `powergas`…). Texto y no enum a
  -- propósito: el catálogo vive en TypeScript y crece con cada conector nuevo;
  -- un enum obligaría a una migración por cada alta y tentaría a alguien a
  -- meter el conector sin ella.
  conector_id      text not null,

  -- JSON cifrado POR LA APLICACIÓN. Nunca texto en claro, nunca pgcrypto.
  valores_cifrados text not null,

  -- Lo único que vuelve al panel: no-secretos en claro y los últimos 4 de cada
  -- secreto. Ver el encabezado.
  pistas           jsonb not null default '{}'::jsonb,

  activo           boolean not null default true,
  probada_en       timestamptz,
  -- Una frase NUESTRA, nunca la respuesta cruda del proveedor.
  ultimo_error     text,

  creada_en        timestamptz not null default now(),
  creada_por       uuid references public.app_user(id) on delete set null,

  -- Una credencial por conector y flota: dos juegos de accesos al mismo SAP es
  -- una ambigüedad que nadie sabría resolver al conectar.
  constraint conector_credencial_unica unique (tenant_id, conector_id),
  constraint conector_credencial_id_no_vacio check (length(trim(conector_id)) > 0),
  -- El candado que impide guardar un JSON en claro por accidente: un objeto
  -- serializado empieza con `{`, y un cifrado nunca.
  constraint conector_credencial_no_en_claro check (valores_cifrados !~ '^\s*\{')
);

create index if not exists conector_credencial_por_flota
  on public.conector_credencial (tenant_id, conector_id)
  where activo;

alter table public.conector_credencial enable row level security;

create policy administra_flota on public.conector_credencial for all
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());

comment on table public.conector_credencial is
  'Accesos de la flota a sistemas ajenos (SAP, GPS, monederos). Los valores van CIFRADOS por la aplicación, no por Postgres: si se cifraran con pgcrypto, la llave viviría junto al dato. RLS por administra_flota() porque es control, no dato.';
comment on column public.conector_credencial.pistas is
  'Lo ÚNICO que vuelve al panel: no-secretos en claro y los últimos 4 de cada secreto. Alcanza para reconocer la credencial, no para usarla.';
comment on column public.conector_credencial.ultimo_error is
  'Frase escrita por nosotros. NUNCA la respuesta cruda del proveedor: hay proveedores que devuelven el token en su mensaje de error, y este campo se lee desde el panel.';
