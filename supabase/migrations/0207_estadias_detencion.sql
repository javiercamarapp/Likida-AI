-- ═══════════════════════════════════════════════════════════════════════════
-- 0207 — ESTADÍAS Y DETENCIÓN (orden post-plan-maestro #3, ficha §8.3).
--
-- El dolor #3 del mapa de dolores ($30k–$96k/día en un CEDIS de 30 unidades)
-- ya era MEDIBLE desde la 0090: los hitos del chofer sellan llegada_en /
-- descarga_en / regreso_en. Lo que no existía era el CONTRATO contra el cual
-- medir: cuántas horas libres pactó el cliente y a cuánto la hora de
-- detención excedente. Sin ese contrato, el auditor de cobranza (#103) dijo
-- con razón que los accesorios "aún no existen como dato".
--
-- Tres piezas:
--   1. `politica_detencion` — el pacto por flota (cliente_id NULL, la tarifa
--      de lista) o por cliente (que GANA sobre la de lista, mismo criterio
--      que `tarifa.cliente_id` en la 0048). NULL en horas_libres o
--      tarifa_hora = NO PACTADO: el episodio se reporta con minutos medidos
--      pero sin monto — no se factura lo que nadie pactó (null-jamás-0).
--   2. `cliente.geocerca_id` — el sitio del cliente, si la flota lo dibujó.
--      Con sitio + GPS conectado, la llegada/salida se MIDEN contra las
--      posiciones (evidencia independiente del aviso por WhatsApp); sin
--      sitio, el reloj es el de los hitos y el producto LO DICE — no se
--      inventan coordenadas del cliente.
--   3. `presencia_en_sitios` — el agregado SQL que contesta, por episodio,
--      "¿qué posiciones tuvo la unidad DENTRO del radio del sitio en esa
--      ventana?" (primera, última, cuántas). Agregar en SQL por la misma
--      razón que la 0205: un poller de 5 min × horas de estadía son miles de
--      filas por episodio que no tienen por qué viajar a la app.
--
-- Lo que esta migración NO hace: no persiste episodios. El episodio se
-- computa al leer (hitos + política + posiciones), como la evidencia GPS de
-- peajes — persistirlo crearía una segunda verdad que se desactualiza cuando
-- el hito o la política cambian. El día que haga falta congelar un episodio
-- (para anexarlo a una factura), esa será su migración, con su sello.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El pacto de detención ───────────────────────────────────────────────
create table if not exists public.politica_detencion (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  -- NULL = política de flota (aplica a cualquier cliente sin pacto propio).
  -- Con cliente = pacto negociado, que gana sobre el de flota.
  cliente_id     uuid,
  -- Horas libres pactadas antes de que corra la detención. NULL = no pactado:
  -- sin umbral no se afirma "excedido" — se piden capturar las horas.
  horas_libres   numeric(5,2),
  -- Tarifa por hora (o fracción) de detención excedente. NULL = no pactada:
  -- el excedente se reporta en minutos, sin monto.
  tarifa_hora    numeric(12,2),
  moneda         text not null default 'MXN',
  actualizada_en timestamptz not null default now(),
  -- Quién declaró el pacto. Se conserva aunque el usuario se borre: el pacto
  -- sigue siendo el pacto.
  actualizado_por uuid references public.app_user(id) on delete set null,
  constraint politica_detencion_horas_sanas
    check (horas_libres is null or (horas_libres >= 0 and horas_libres <> 'NaN'::numeric)),
  constraint politica_detencion_tarifa_sana
    check (tarifa_hora is null or (tarifa_hora > 0 and tarifa_hora <> 'NaN'::numeric)),
  -- La FK COMPUESTA de la casa (0028/0145): el pacto de un cliente de la
  -- flota A no puede colgarse del tenant B. `cliente` trae su
  -- unique (id, tenant_id) desde la 0145.
  constraint politica_detencion_cliente_tenant_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id)
    on delete cascade
);

-- Un pacto por cliente y uno de flota — el segundo intento actualiza, no
-- duplica (el escritor en la app hace update-luego-insert apoyado en estos
-- índices; sin ellos, dos pactos vigentes dirían dos tarifas del mismo dinero).
create unique index if not exists politica_detencion_cliente_unica
  on public.politica_detencion (tenant_id, cliente_id) where cliente_id is not null;
create unique index if not exists politica_detencion_flota_unica
  on public.politica_detencion (tenant_id) where cliente_id is null;

comment on table public.politica_detencion is
  'Horas libres y tarifa de detención pactadas, por flota (cliente_id NULL) o por cliente (gana). NULL en cualquier perilla = no pactado: el episodio se mide pero no se valora. El único escritor es estadias/lector.ts.';

-- Mismo doble candado que 0196/0198/0204: RLS deny-all + sin grants directos.
alter table public.politica_detencion enable row level security;
revoke all on table public.politica_detencion from public, anon, authenticated;
grant select, insert, update, delete on table public.politica_detencion to service_role;

-- ── 2. El sitio del cliente ────────────────────────────────────────────────
-- `geocerca` no tenía unique (id, tenant_id): mismo movimiento guardado que
-- la 0028 §1 — redundante en unicidad (id ya es PK), obligatorio para que una
-- FK compuesta pueda apuntarle.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'geocerca_id_tenant_key' and conrelid = 'public.geocerca'::regclass
  ) then
    alter table public.geocerca add constraint geocerca_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

alter table public.cliente
  add column if not exists geocerca_id uuid;

-- Borrar la geocerca desarma el vínculo, no al cliente (set null acotado a la
-- columna, misma forma que la 0203).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cliente_geocerca_tenant_fkey' and conrelid = 'public.cliente'::regclass
  ) then
    alter table public.cliente
      add constraint cliente_geocerca_tenant_fkey
      foreign key (geocerca_id, tenant_id) references public.geocerca (id, tenant_id)
      on delete set null (geocerca_id);
  end if;
end $$;

comment on column public.cliente.geocerca_id is
  'El sitio del cliente (círculo de la 0050), si la flota lo dibujó. NULL = sin sitio: la estadía se mide solo con los hitos de WhatsApp y el producto lo dice — no se inventan coordenadas del cliente.';

-- ── 3. La presencia medida en el sitio ─────────────────────────────────────
-- Por episodio: primera y última posición DENTRO del radio, y cuántas. La
-- distancia es la esférica (haversine, R=6371 km) — el círculo de la 0050 se
-- resuelve "con aritmética que se puede verificar a mano", y ésta es esa
-- aritmética, en el único lugar que la ejecuta.
--
-- Un solo viaje de ida y vuelta a la base por TODOS los episodios de la
-- pantalla: los items llegan como jsonb (viaje_id, unidad_id, desde, hasta,
-- lat, lng, radio_m) y la función devuelve una fila por item con presencia.
-- Sin posiciones en el radio no hay fila: la ausencia es un motivo declarado
-- en el motor (sin_posiciones_en_sitio), no un cero.
create or replace function public.presencia_en_sitios(
  p_tenant uuid,
  p_items  jsonb
) returns table (viaje_id uuid, primera timestamptz, ultima timestamptz, n bigint)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select
    i.viaje_id,
    min(p.medida_en) as primera,
    max(p.medida_en) as ultima,
    count(*)         as n
  from jsonb_to_recordset(p_items) as i(
    viaje_id  uuid,
    unidad_id uuid,
    desde     timestamptz,
    hasta     timestamptz,
    lat       double precision,
    lng       double precision,
    radio_m   int
  )
  join posicion p
    on p.tenant_id = p_tenant
   and p.unidad_id = i.unidad_id
   and p.medida_en >= i.desde
   and p.medida_en <= i.hasta
  where 2 * 6371000 * asin(sqrt(
          power(sin(radians(p.lat - i.lat) / 2), 2)
          + cos(radians(i.lat)) * cos(radians(p.lat))
            * power(sin(radians(p.lng - i.lng) / 2), 2)
        )) <= i.radio_m
  group by i.viaje_id
$$;

comment on function public.presencia_en_sitios(uuid, jsonb) is
  'Primera/última posición y conteo DENTRO del radio del sitio por episodio de estadía (0207). Solo mide — la clasificación (medida / sin medición, y sus motivos) vive en el motor puro (estadias/motor.ts). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.presencia_en_sitios(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.presencia_en_sitios(uuid, jsonb) to service_role;
