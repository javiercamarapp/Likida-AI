-- ═══════════════════════════════════════════════════════════════════════════
-- 03 — GPS: «SU» tabla propia simulada + lo que quedaría en `posicion` tras leerla.
--
-- Innovativos dijo: «tenemos en nuestras tablas las posiciones de todos los GPS
-- al momento». Aquí se simula ESA tabla (esquema innovativos_sim) con las
-- columnas que se les pide (unidad, lat, lon, fecha_hora, velocidad, ignición)
-- y con DOS rarezas a propósito, porque lo real las traerá:
--   · `fecha_hora` es hora LOCAL de CDMX SIN zona (timestamp, no timestamptz);
--   · la unidad se llama por su número económico («IN-001»), no por nuestro id.
-- El lector de tabla propia (contrato: src/lib/likida/demo_innovativos/contratos.ts)
-- tiene que resolver las dos. Mientras no exista, `public.posicion` YA trae lo
-- que el lector dejaría (proveedor 'tabla_propia'), para que las pantallas
-- (mapa, conductor, peajes) funcionen en el demo.
--
-- Rol de solo lectura: innovativos_demo_lector (NOLOGIN) solo puede SELECT en
-- este esquema. Es el modelo del «usuario restringido sobre una vista/réplica».
-- ═══════════════════════════════════════════════════════════════════════════

-- Posiciones calculadas: cada 5 min en 24 h para los 140 tractos en viaje (con
-- los dos escenarios de excepción); cada 30 min en 6 h para el resto (en patio).
drop table if exists innovativos_sim.pos_cruda cascade;
create table innovativos_sim.pos_cruda as
with a as (select current_setting('inn.ancla')::timestamptz as anc),
viajando as (
  select p.n, p.i, g.ts, p, so.lat as olat, so.lng as olng, sd.lat as dlat, sd.lng as dlng,
         extract(epoch from (g.ts - p.t0)) / 3600.0 as e_h
  from innovativos_sim.plan_viaje p
  join innovativos_sim.sitio so on so.cliente_key = p.o_key
  join innovativos_sim.sitio sd on sd.cliente_key = p.d_key
  cross join a
  cross join lateral generate_series(a.anc - interval '24 hours', a.anc, interval '5 minutes') g(ts)
  where p.tipo = 'abierto'
    and (p.escenario <> 'silencio' or g.ts <= a.anc - interval '100 minutes')
),
puntos as (
  select v.n, v.ts,
         case when v.e_h <= (v.p).dwell_c then v.olat
              when v.e_h <= (v.p).dwell_c + (v.p).travel_h then pt.lat
              else v.dlat end as lat,
         case when v.e_h <= (v.p).dwell_c then v.olng
              when v.e_h <= (v.p).dwell_c + (v.p).travel_h then pt.lng
              else v.dlng end as lng,
         (v.e_h > (v.p).dwell_c and v.e_h <= (v.p).dwell_c + (v.p).travel_h) as rodando,
         ((v.p).kb > (v.p).ka) as hacia_apodaca
  from viajando v
  left join lateral innovativos_sim.punto((v.p).ka + sign((v.p).kb - (v.p).ka)
              * least(greatest(v.e_h - (v.p).dwell_c, 0) / nullif((v.p).travel_h, 0), 1) * abs((v.p).kb - (v.p).ka)) pt on true
)
select n, ts,
       round((lat + (innovativos_sim.u('jla' || n || ts::text) - 0.5) * 0.0006)::numeric, 6)::float8 as lat,
       round((lng + (innovativos_sim.u('jlo' || n || ts::text) - 0.5) * 0.0006)::numeric, 6)::float8 as lng,
       case when rodando then round((58 + 24 * innovativos_sim.u('vel' || n || ts::text))::numeric, 1)::float8 else 0 end as vel,
       (rodando or innovativos_sim.u('ign' || n || ts::text) < 0.15) as ignicion,
       case when rodando then (case when hacia_apodaca then 40 else 220 end) + (innovativos_sim.h('rum' || n || ts::text) % 15)::int else null end as rumbo
from puntos
union all
select t.n, g.ts,
       round((pa.lat + (innovativos_sim.u('pla' || t.n || g.ts::text) - 0.5) * 0.0010)::numeric, 6)::float8,
       round((pa.lng + (innovativos_sim.u('plo' || t.n || g.ts::text) - 0.5) * 0.0010)::numeric, 6)::float8,
       0, false, null::int
from innovativos_sim.tracto t
join geocerca pa on pa.id = innovativos_sim.uid('geo:patio:' || t.term)
cross join a
cross join lateral generate_series(a.anc - interval '6 hours', a.anc, interval '30 minutes') g(ts)
where t.n > 140;
create index on innovativos_sim.pos_cruda (n, ts);

-- ── «Su» tabla propia ──────────────────────────────────────────────────────
drop table if exists innovativos_sim.gps_posicion cascade;
create table innovativos_sim.gps_posicion (
  id_unidad     text         not null,          -- número económico en SU sistema
  latitud       numeric(9,6) not null,
  longitud      numeric(9,6) not null,
  fecha_hora    timestamp    not null,          -- hora local CDMX, SIN zona
  velocidad_kmh numeric(5,1),
  ignicion      smallint,                       -- 1 encendido, 0 apagado
  primary key (id_unidad, fecha_hora)
);
insert into innovativos_sim.gps_posicion
select t.economico, c.lat, c.lng, (c.ts at time zone 'America/Mexico_City'), c.vel, case when c.ignicion then 1 else 0 end
from innovativos_sim.pos_cruda c join innovativos_sim.tracto t on t.n = c.n;

create or replace view innovativos_sim.v_gps_actual as
select distinct on (id_unidad) id_unidad, latitud, longitud, fecha_hora, velocidad_kmh, ignicion
from innovativos_sim.gps_posicion order by id_unidad, fecha_hora desc;

-- Geocercas «de ellos»: círculos para casi todo, polígonos (WKT) para 4 plantas.
drop table if exists innovativos_sim.geocerca cascade;
create table innovativos_sim.geocerca (
  codigo      text primary key,
  nombre      text not null,
  tipo        text not null check (tipo in ('circulo', 'poligono')),
  lat_centro  numeric(9,6),
  lon_centro  numeric(9,6),
  radio_m     integer,
  poligono_wkt text,
  cliente     text
);
insert into innovativos_sim.geocerca
select g.codigo, g.nombre, case when g.codigo in ('PL-C05','PL-C10','PL-C12','PL-C03') then 'poligono' else 'circulo' end,
       g.lat, g.lng, g.radio_m,
       case when g.codigo in ('PL-C05','PL-C10','PL-C12','PL-C03') then
         format('POLYGON((%s %s, %s %s, %s %s, %s %s, %s %s))',
                round((g.lng - 0.004)::numeric, 6), round((g.lat - 0.003)::numeric, 6),
                round((g.lng + 0.004)::numeric, 6), round((g.lat - 0.003)::numeric, 6),
                round((g.lng + 0.004)::numeric, 6), round((g.lat + 0.003)::numeric, 6),
                round((g.lng - 0.004)::numeric, 6), round((g.lat + 0.003)::numeric, 6),
                round((g.lng - 0.004)::numeric, 6), round((g.lat - 0.003)::numeric, 6)) end,
       (select nombre from cliente c where c.id = g.cliente_id)
from geocerca g
where g.tenant_id = current_setting('inn.tenant')::uuid and g.tipo in ('planta', 'patio');

-- Rol de solo lectura (modelo del usuario restringido que se le pedirá a sistemas).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'innovativos_demo_lector') then
    create role innovativos_demo_lector nologin;
  end if;
end $$;
grant usage on schema innovativos_sim to innovativos_demo_lector;
revoke all on all tables in schema innovativos_sim from innovativos_demo_lector;
grant select on innovativos_sim.gps_posicion, innovativos_sim.v_gps_actual, innovativos_sim.geocerca to innovativos_demo_lector;

-- ── Lo que el lector dejaría en `posicion` ─────────────────────────────────
insert into posicion (tenant_id, unidad_id, lat, lng, velocidad, rumbo, odometro, medida_en, recibida_en, proveedor)
select current_setting('inn.tenant')::uuid, innovativos_sim.uid('unidad:' || c.n), c.lat, c.lng, c.vel, c.rumbo, null,
       c.ts, c.ts + interval '20 seconds', 'tabla_propia'
from innovativos_sim.pos_cruda c
on conflict (tenant_id, unidad_id, medida_en) do nothing;

update unidad u set gps_visto_en = m.ult
from (select unidad_id, max(medida_en) as ult from posicion
      where tenant_id = current_setting('inn.tenant')::uuid group by unidad_id) m
where u.id = m.unidad_id and u.tenant_id = current_setting('inn.tenant')::uuid
  and u.gps_visto_en is distinct from m.ult;
