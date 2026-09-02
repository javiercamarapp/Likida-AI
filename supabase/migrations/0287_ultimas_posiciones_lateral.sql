-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · DAT-8 / REN-3 (ALTO) — `ultimas_posiciones_tenant` RECORRÍA
-- TODA LA TABLA DE LA FLOTA PARA SACAR 800 PINES.
--
-- La 0269 escribió la RPC del mapa como `select distinct on (unidad_id) …
-- order by unidad_id, medida_en desc` sobre `posicion` con la tabla VACÍA, y
-- documentó «recorre el índice». Postgres no hace skip-scan: para 800 grupos
-- lee TODAS las entradas del índice del tenant y descarta todas menos 800.
-- Medido por el auditor con 6.9 M filas (800 unidades × 288 lecturas/día × 30
-- días — la retención de 90 días acumula 20.7 M): 4,515 ms. `/dashboard/mapa`
-- es la pantalla que Innovativos tiene abierta todo el día, y con el
-- `statement_timeout` de PostgREST (8 s) se cae a timeout al mes de GPS.
--
-- `estado_rastreo_tenant` (0162) hacía lo mismo con `count(distinct unidad_id)`
-- y `max(medida_en)` sobre la misma tabla, y el mapa las llama en paralelo.
--
-- ── EL ARREGLO ────────────────────────────────────────────────────────────
-- La MISMA firma, el MISMO resultado, el MISMO grant; solo cambia la forma:
-- una sonda por unidad (`cross join lateral … order by medida_en desc limit 1`)
-- sobre `uq_posicion_lectura (tenant_id, unidad_id, medida_en)` de la 0176 —
-- un Index Scan Backward de 1 fila por unidad. 800 sondas: milisegundos.
-- Medido en esta migración sobre Postgres local: ver bloque 235.
--
-- `estado_rastreo_tenant` se reescribe con la misma sonda y conserva su
-- contrato (`unidadesConPosicion`, `ultimaPosicion`; sin filtrar `activo`,
-- como la 0162): `comercial.ts` valida la forma y falla cerrado si cambia.
--
-- De paso (DAT-8, S12): `posicion.medida_en` no tenía techo — un GPS con el
-- reloj en 2030 dejaba esa «última posición» clavada para siempre. El CHECK
-- exige `medida_en <= recibida_en + 1 h`; el poller (`sincronizar_gps.ts`)
-- descarta esas lecturas ANTES de la base para que una unidad con reloj malo
-- no tumbe la tanda de toda la flota.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.ultimas_posiciones_tenant(p_tenant uuid)
returns table (
  unidad_id        uuid,
  numero_economico text,
  placas           text,
  estado           text,
  lat              double precision,
  lng              double precision,
  velocidad        double precision,
  medida_en        timestamptz,
  proveedor        text
)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select
    u.id,
    u.numero_economico,
    u.placas,
    u.estado,
    p.lat,
    p.lng,
    p.velocidad,
    p.medida_en,
    p.proveedor
  from unidad u
  cross join lateral (
    select p.lat, p.lng, p.velocidad, p.medida_en, p.proveedor
    from posicion p
    where p.tenant_id = u.tenant_id
      and p.unidad_id = u.id
    order by p.medida_en desc
    limit 1
  ) p
  where u.tenant_id = p_tenant
    and u.activo;
$$;

comment on function public.ultimas_posiciones_tenant(uuid) is
  'La ÚLTIMA posición de cada unidad ACTIVA de una flota. 0287 (auditoría 24 DAT-8/REN-3): una sonda lateral por unidad sobre uq_posicion_lectura (tenant_id, unidad_id, medida_en) en vez del distinct on de la 0269, que recorría todas las posiciones del tenant (4.5 s con 6.9 M filas). Misma firma y mismo resultado: una fila por unidad activa con posición, sin filtrar antigüedad. SECURITY INVOKER; p_tenant sin default (molde 0112).';

revoke all on function public.ultimas_posiciones_tenant(uuid) from public, anon, authenticated;
grant execute on function public.ultimas_posiciones_tenant(uuid) to service_role;

create or replace function public.estado_rastreo_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'unidadesConPosicion', count(p.medida_en),
    'ultimaPosicion',      to_jsonb(max(p.medida_en))
  )
  from unidad u
  cross join lateral (
    select p.medida_en
    from posicion p
    where p.tenant_id = u.tenant_id
      and p.unidad_id = u.id
    order by p.medida_en desc
    limit 1
  ) p
  where u.tenant_id = p_tenant;
$$;

comment on function public.estado_rastreo_tenant(uuid) is
  'Cuántas unidades de la flota tienen al menos una posición y cuándo fue la última. 0287: una sonda lateral por unidad (uq_posicion_lectura) en vez de count(distinct)/max sobre toda la tabla del tenant (0162). Mismo contrato: unidadesConPosicion (todas las unidades, activas o no, como la 0162) y ultimaPosicion (null sin posiciones).';

revoke all on function public.estado_rastreo_tenant(uuid) from public, anon, authenticated;
grant execute on function public.estado_rastreo_tenant(uuid) to service_role;

-- El techo de `medida_en`. NOT VALID: no bloquea la migración si ya hubiera
-- una lectura futura en producción (la purga de 90 días se la lleva sola);
-- las nuevas sí se rechazan.
alter table public.posicion drop constraint if exists posicion_medida_en_no_futura;
alter table public.posicion
  add constraint posicion_medida_en_no_futura
  check (medida_en <= recibida_en + interval '1 hour') not valid;
comment on constraint posicion_medida_en_no_futura on public.posicion is
  '0287 (DAT-8): una lectura fechada más de una hora después de recibida es un reloj mal puesto, no una posición — sin este techo se quedaba clavada como «última posición» para siempre.';
