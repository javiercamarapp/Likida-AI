-- ═══════════════════════════════════════════════════════════════════════════
-- 0298 — Terminal con escritor, e importación masiva de unidades/operadores.
--
-- AUDITORÍA 24 (ADM-2, FE-4, producto-completitud «recorrido día 1» y
-- faltante 3). Innovativos tiene 800 tractocamiones y cientos de choferes;
-- hasta hoy el panel solo daba de alta uno por uno, y `terminal` era la tabla
-- huérfana de la 0001: la referencian `operador` y `viaje` y nada la escribe.
--
-- QUÉ CAMBIA, y por qué cada cosa la tiene que garantizar la base:
--
--  1. `unidad.terminal_id`. La unidad es el activo que se asigna a un patio;
--     `operador` y `viaje` ya lo tenían y la unidad no. FK compuesta
--     `(terminal_id, tenant_id) → terminal(id, tenant_id)` con el mismo
--     molde de la 0145: una unidad de la flota A no puede colgar de un patio
--     de la flota B aunque alguien mande el uuid correcto de otra flota.
--     `on delete set null` — borrar un patio no borra camiones.
--
--  2. `uq_terminal_tenant_nombre`: dos patios «Patio Norte» y « patio norte »
--     de la MISMA flota son el mismo patio tecleado dos veces (el importador
--     manda cientos de filas con el nombre del patio escrito a mano). Único
--     por tenant y sobre el nombre normalizado; otra flota puede tener el suyo.
--
--  3. Las lecturas PAGINADAS del registro de operadores y de unidades. A 800
--     unidades y cientos de choferes las pantallas traían el catálogo entero
--     (`traerTodo`) y paginaban en memoria; el conteo de viajes por operador
--     venía de una agregación sobre `viaje` ENTERA. Aquí la página se corta en
--     SQL con `offset/limit` sobre un orden TOTAL (…, id), el `total` viene en
--     la misma respuesta (un count real, no `.length` de una lista topada) y la
--     búsqueda es sin acentos («Ramirez» encuentra a «Ramírez», como ya hacía
--     la búsqueda en memoria). Los conteos de cabecera (licencias vencidas,
--     aviso de privacidad pendiente, papeles vencidos/por vencer) se calculan
--     sobre la FLOTA ENTERA con el día de México que manda la app (`p_hoy`),
--     nunca con el reloj UTC del servidor.
--
-- Idempotente: `if not exists` / `create or replace` / `drop … if exists`.
-- Solo `service_role` ejecuta las RPC (mismo grant que 0150/0154/0269).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. unidad.terminal_id ────────────────────────────────────────────────────
alter table public.unidad
  add column if not exists terminal_id uuid references public.terminal(id) on delete set null;

create index if not exists unidad_terminal_id_idx on public.unidad (terminal_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'unidad_terminal_tenant_fkey' and conrelid = 'public.unidad'::regclass
  ) then
    -- `terminal_id_tenant_key` = unique (id, tenant_id) en terminal, creada
    -- por la 0145 para exactamente este uso.
    alter table public.unidad
      add constraint unidad_terminal_tenant_fkey
      foreign key (terminal_id, tenant_id) references public.terminal (id, tenant_id) on delete set null (terminal_id);
  end if;
end $$;

comment on column public.unidad.terminal_id is
  'Patio/terminal al que está asignada la unidad (0298). FK compuesta con tenant_id: un camión no puede colgar de un patio de otra flota. NULL = sin patio declarado.';

-- ── 2. Un patio por nombre, por flota ────────────────────────────────────────
create unique index if not exists uq_terminal_tenant_nombre
  on public.terminal (tenant_id, lower(btrim(nombre)));

comment on index public.uq_terminal_tenant_nombre is
  'El mismo patio tecleado dos veces («Patio Norte» / « patio norte ») es UNO (0298). Por tenant: otra flota puede tener su propio Patio Norte.';

-- ── 3. Búsqueda sin acentos, sin extensión ───────────────────────────────────
-- `unaccent` no está garantizada en el Postgres local de CI; esta forma cubre
-- las vocales acentuadas y la ñ/ü, que es lo que un nombre mexicano trae.
create or replace function public.sin_acentos(p text)
returns text
language sql
immutable
parallel safe
returns null on null input
set search_path = public, pg_catalog
as $$
  select translate(lower(p), 'áéíóúàèìòùäëïöüñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑ', 'aeiouaeiouaeiounaeiouaeiouaeioun')
$$;

comment on function public.sin_acentos(text) is
  'Minúsculas sin acentos para buscar en los registros del panel (0298): «Ramirez» encuentra a «Ramírez».';

-- ── 4. Registro de operadores: página + total + búsqueda ─────────────────────
create or replace function public.operadores_registro_tenant(
  p_tenant uuid, p_q text, p_desde int, p_limite int
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with f as (
    select o.*
    from operador o
    where o.tenant_id = p_tenant
      and (
        coalesce(btrim(p_q), '') = ''
        or sin_acentos(o.nombre) like '%' || sin_acentos(btrim(p_q)) || '%'
        or o.telefono like '%' || regexp_replace(p_q, '\D', '', 'g') || '%' and regexp_replace(p_q, '\D', '', 'g') <> ''
        or sin_acentos(coalesce(o.numero_empleado, '')) like '%' || sin_acentos(btrim(p_q)) || '%'
      )
  ),
  pag as (
    select f.* from f
    order by f.activo desc, sin_acentos(f.nombre), f.id
    offset greatest(coalesce(p_desde, 0), 0)
    limit  least(greatest(coalesce(p_limite, 25), 1), 200)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'operadorId',        p.id,
        'nombre',            p.nombre,
        'telefono',          p.telefono,
        'numeroEmpleado',    p.numero_empleado,
        'rfc',               p.rfc,
        'activo',            p.activo,
        'licencia',          p.licencia,
        'licenciaTipo',      p.licencia_tipo,
        'licenciaVence',     to_char(p.licencia_vence, 'YYYY-MM-DD'),
        'terminalId',        p.terminal_id,
        'terminalNombre',    t.nombre,
        'avisoPrivacidadEn', p.aviso_privacidad_en,
        'viajes',            (select count(*) from viaje v where v.tenant_id = p_tenant and v.operador_id = p.id)
      ) order by p.activo desc, sin_acentos(p.nombre), p.id)
      from pag p
      left join terminal t on t.id = p.terminal_id and t.tenant_id = p_tenant
    ), '[]'::jsonb)
  );
$$;

comment on function public.operadores_registro_tenant(uuid, text, int, int) is
  'Una página del registro de operadores + el total real (0298). Orden total (activo, nombre sin acentos, id), búsqueda sin acentos por nombre/teléfono/número de empleado, viajes contados por operador solo para la página.';

-- ── 5. Conteos de cabecera de operadores, sobre la flota entera ──────────────
create or replace function public.operadores_conteos_tenant(
  p_tenant uuid, p_hoy date, p_dias_aviso int
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'total',              count(*),
    'activos',            count(*) filter (where o.activo),
    'sinTelefono',        count(*) filter (where o.activo and btrim(o.telefono) = ''),
    'avisoPendiente',     count(*) filter (where o.activo and o.aviso_privacidad_en is null),
    'licenciasVencidas',  count(*) filter (where o.activo and o.licencia_vence is not null and o.licencia_vence < p_hoy),
    'licenciasPorVencer', count(*) filter (where o.activo and o.licencia_vence is not null
                                            and o.licencia_vence >= p_hoy
                                            and o.licencia_vence <= p_hoy + greatest(coalesce(p_dias_aviso, 30), 0))
  )
  from operador o
  where o.tenant_id = p_tenant;
$$;

comment on function public.operadores_conteos_tenant(uuid, date, int) is
  'Los KPIs del registro de operadores calculados sobre la FLOTA ENTERA (0298), con el día de México que manda la app — la página de 25 no puede contar licencias vencidas de 800.';

-- ── 6. Registro de unidades: página + total + búsqueda, en orden de urgencia ─
create or replace function public.unidades_registro_tenant(
  p_tenant uuid, p_q text, p_activo boolean, p_desde int, p_limite int
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with f as (
    select u.*,
           least(u.poliza_vence, u.permiso_sict_vence, u.verificacion_vence) as vence
    from unidad u
    where u.tenant_id = p_tenant
      and u.activo = coalesce(p_activo, true)
      and (
        coalesce(btrim(p_q), '') = ''
        or sin_acentos(u.numero_economico) like '%' || sin_acentos(btrim(p_q)) || '%'
        or sin_acentos(coalesce(u.placas, '')) like '%' || sin_acentos(btrim(p_q)) || '%'
        or sin_acentos(coalesce(u.marca, ''))  like '%' || sin_acentos(btrim(p_q)) || '%'
        or sin_acentos(coalesce(u.modelo, '')) like '%' || sin_acentos(btrim(p_q)) || '%'
      )
  ),
  pag as (
    -- El orden es el del trabajo: lo que vence antes primero; sin papeles al
    -- final; y numero_economico + id como desempate TOTAL para que la página
    -- 2 no repita filas de la 1.
    select f.* from f
    order by (f.vence is null), f.vence, f.numero_economico, f.id
    offset greatest(coalesce(p_desde, 0), 0)
    limit  least(greatest(coalesce(p_limite, 25), 1), 200)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                p.id,
        'numeroEconomico',   p.numero_economico,
        'placas',            p.placas,
        'marca',             p.marca,
        'modelo',            p.modelo,
        'anio',              p.anio,
        'estado',            p.estado,
        'kmActual',          p.km_actual,
        'polizaVence',       to_char(p.poliza_vence, 'YYYY-MM-DD'),
        'permisoSictVence',  to_char(p.permiso_sict_vence, 'YYYY-MM-DD'),
        'verificacionVence', to_char(p.verificacion_vence, 'YYYY-MM-DD'),
        'gpsProveedor',      p.gps_proveedor,
        'gpsDeviceId',       p.gps_device_id,
        'gpsVistoEn',        p.gps_visto_en,
        'activo',            p.activo,
        'terminalId',        p.terminal_id,
        'terminalNombre',    t.nombre,
        'ordenesAbiertas',   (select count(*) from mantenimiento m
                               where m.tenant_id = p_tenant and m.unidad_id = p.id and m.estado <> 'cerrada')
      ) order by (p.vence is null), p.vence, p.numero_economico, p.id)
      from pag p
      left join terminal t on t.id = p.terminal_id and t.tenant_id = p_tenant
    ), '[]'::jsonb)
  );
$$;

comment on function public.unidades_registro_tenant(uuid, text, boolean, int, int) is
  'Una página del registro de unidades + el total real (0298). Orden: papel más próximo a vencer primero, sin papeles al final, desempate por número económico e id. Búsqueda sin acentos por económico/placas/marca/modelo.';

-- ── 7. Conteos de cabecera de unidades, sobre la flota entera ────────────────
-- Misma frontera que `clasificarVigencia` (vigencias.ts): vencido = días < 0,
-- por vencer = 0..p_dias_aviso, vigente = más allá, sin dato = ninguna fecha.
create or replace function public.unidades_conteos_tenant(
  p_tenant uuid, p_hoy date, p_dias_aviso int
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with a as (
    select u.activo,
           least(u.poliza_vence, u.permiso_sict_vence, u.verificacion_vence) as vence
    from unidad u
    where u.tenant_id = p_tenant
  )
  select jsonb_build_object(
    'total',     count(*),
    'activas',   count(*) filter (where a.activo),
    'bajas',     count(*) filter (where not a.activo),
    'vencidos',  count(*) filter (where a.activo and a.vence is not null and a.vence < p_hoy),
    'porVencer', count(*) filter (where a.activo and a.vence is not null and a.vence >= p_hoy
                                    and a.vence <= p_hoy + greatest(coalesce(p_dias_aviso, 30), 0)),
    'vigentes',  count(*) filter (where a.activo and a.vence is not null
                                    and a.vence > p_hoy + greatest(coalesce(p_dias_aviso, 30), 0)),
    'sinDato',   count(*) filter (where a.activo and a.vence is null)
  )
  from a;
$$;

comment on function public.unidades_conteos_tenant(uuid, date, int) is
  'Los cuatro contadores de papeles del registro de unidades sobre la FLOTA ENTERA (0298): un semáforo calculado sobre 25 de 800 diría que no hay nada vencido porque los vencidos cayeron en la página 3.';

-- ── 8. Solo el servidor ejecuta estas lecturas ───────────────────────────────
revoke all on function public.sin_acentos(text) from public, anon, authenticated;
revoke all on function public.operadores_registro_tenant(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.operadores_conteos_tenant(uuid, date, int) from public, anon, authenticated;
revoke all on function public.unidades_registro_tenant(uuid, text, boolean, int, int) from public, anon, authenticated;
revoke all on function public.unidades_conteos_tenant(uuid, date, int) from public, anon, authenticated;
grant execute on function public.sin_acentos(text) to service_role;
grant execute on function public.operadores_registro_tenant(uuid, text, int, int) to service_role;
grant execute on function public.operadores_conteos_tenant(uuid, date, int) to service_role;
grant execute on function public.unidades_registro_tenant(uuid, text, boolean, int, int) to service_role;
grant execute on function public.unidades_conteos_tenant(uuid, date, int) to service_role;
