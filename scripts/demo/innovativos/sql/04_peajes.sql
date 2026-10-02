-- ═══════════════════════════════════════════════════════════════════════════
-- 04 — Peajes: catálogo de casetas «Demo» sobre el eje, TAG por tracto y el
-- archivo de pases de las últimas 24 h (los cruces que de verdad hizo cada
-- tracto, según su viaje), más CRUCES FUERA DE RUTA y COBROS DUPLICADOS
-- sembrados a propósito para el reporte de descuento al proveedor.
--
-- Los veredictos de GPS de las líneas no son inventados: las líneas normales
-- caen sobre la trayectoria que 03 sembró (veredicto «confirma»); las sembradas
-- «fuera de ruta» están a decenas de km de esa trayectoria («no_coincide»); y
-- los cruces posteriores al silencio del GPS quedan «sin_datos».
-- ═══════════════════════════════════════════════════════════════════════════

drop table if exists innovativos_sim.caseta cascade;
create table innovativos_sim.caseta (nombre text primary key, km float8 not null, lat float8, lng float8, tarifa numeric(8,2));
insert into innovativos_sim.caseta (nombre, km, lat, lng, tarifa)
select v.nombre, v.km, p.lat, p.lng, 250 + (innovativos_sim.h(v.nombre) % 900)
from (values ('Caseta Demo Zapotlanejo', 40.0), ('Caseta Demo Tepatitlan', 120.0), ('Caseta Demo Encarnacion', 170.0),
             ('Caseta Demo Leon Norte', 262.0), ('Caseta Demo Silao Sur', 320.0), ('Caseta Demo Villa de Reyes', 400.0),
             ('Caseta Demo Ahualulco', 520.0), ('Caseta Demo Vanegas', 600.0), ('Caseta Demo Matehuala', 700.0),
             ('Caseta Demo Los Chorros', 800.0), ('Caseta Demo Saltillo Norte', 880.0), ('Caseta Demo Santa Catarina', 960.0)) v(nombre, km)
cross join lateral innovativos_sim.punto(v.km) p;

insert into peaje_caseta (id, tenant_id, nombre, nombre_norm, alias, lat, lng, radio_m, activa, fuente)
select innovativos_sim.uid('caseta:' || c.nombre), current_setting('inn.tenant')::uuid, c.nombre, lower(c.nombre),
       array[replace(lower(c.nombre), 'caseta demo ', 'cd ')], c.lat, c.lng, 400, true, 'csv'
from innovativos_sim.caseta c
on conflict (id) do nothing;

-- Cruces reales de cada tracto en viaje (dentro de las últimas 24 h).
drop table if exists innovativos_sim.cruce_plan cascade;
create table innovativos_sim.cruce_plan as
with a as (select current_setting('inn.ancla')::timestamptz as anc),
c0 as (
  select p.i, p.n, p.folio, p.escenario, p.ka, p.kb, p.dist_km, c.nombre, c.km as ckm,
         p.t_sc + make_interval(secs => 3600 * p.travel_h * abs(c.km - p.ka) / nullif(p.dist_km, 0)) as t_cruce
  from innovativos_sim.plan_viaje p
  join innovativos_sim.caseta c on c.km > least(p.ka, p.kb) + 5 and c.km < greatest(p.ka, p.kb) - 5
  where p.tipo = 'abierto'
)
select c0.*, 'real'::text as origen_linea
from c0, a
where c0.t_cruce between a.anc - interval '24 hours' and a.anc;

-- ── Fuera de ruta: ~9 cruces cuyo tracto estaba lejos de la caseta cobrada ───
insert into innovativos_sim.cruce_plan (i, n, folio, escenario, ka, kb, dist_km, nombre, ckm, t_cruce, origen_linea)
select x.i, x.n, x.folio, x.escenario, x.ka, x.kb, x.dist_km, far.nombre, far.km, x.t_cruce, 'fuera_de_ruta'
from (
  select cp.*, row_number() over (order by md5('fuera' || cp.folio || cp.nombre)) as rk
  from innovativos_sim.cruce_plan cp
  where cp.escenario = 'normal' and cp.dist_km < 500 and cp.origen_linea = 'real'
) x
cross join lateral (
  select c.nombre, c.km from innovativos_sim.caseta c
  where c.km < least(x.ka, x.kb) - 60 or c.km > greatest(x.ka, x.kb) + 60
  order by md5(x.folio || c.nombre) limit 1
) far
where x.rk <= 10;

-- ── Cobro duplicado: 4 cruces reales con una segunda línea 2 min después ────
insert into innovativos_sim.cruce_plan (i, n, folio, escenario, ka, kb, dist_km, nombre, ckm, t_cruce, origen_linea)
select x.i, x.n, x.folio, x.escenario, x.ka, x.kb, x.dist_km, x.nombre, x.ckm, x.t_cruce + interval '2 minutes', 'duplicado'
from (
  select cp.*, row_number() over (order by md5('dup' || cp.folio || cp.nombre)) as rk
  from innovativos_sim.cruce_plan cp
  where cp.escenario = 'normal' and cp.origen_linea = 'real'
) x
where x.rk <= 4;

-- ── El archivo de pases y sus líneas ───────────────────────────────────────
insert into desglose_peaje (id, tenant_id, proveedor, periodo_desde, periodo_hasta, archivo_nombre)
values (innovativos_sim.uid('desglose:pase-24h'), current_setting('inn.tenant')::uuid, 'PASE (demo)',
        ((current_setting('inn.ancla')::timestamptz - interval '24 hours') at time zone 'America/Mexico_City')::date,
        (current_setting('inn.ancla')::timestamptz at time zone 'America/Mexico_City')::date,
        'pases_demo_innovativos_24h.csv')
on conflict (id) do nothing;

insert into desglose_peaje_linea (id, tenant_id, desglose_id, indice, fecha, caseta, monto, tag, viaje_id, estatus,
                                  diferencia, detalle, hora, cruce_en, unidad_id, caseta_id,
                                  gps_veredicto, gps_distancia_m, gps_detalle)
select innovativos_sim.uid('pase:' || x.folio || ':' || x.nombre || ':' || x.origen_linea),
       current_setting('inn.tenant')::uuid, innovativos_sim.uid('desglose:pase-24h'),
       row_number() over (order by x.t_cruce, x.folio, x.origen_linea)::int,
       (x.cruce at time zone 'America/Mexico_City')::date,
       x.nombre, c.tarifa, tr.tag, innovativos_sim.uid('viaje:' || x.folio),
       case x.origen_linea when 'real' then 'cuadra' else 'no_cuadra' end,
       case x.origen_linea when 'real' then 0 else c.tarifa end,
       jsonb_build_object('origen_demo', x.origen_linea, 'tag_cobrado', tr.tag),
       (x.cruce at time zone 'America/Mexico_City')::time,
       x.cruce, innovativos_sim.uid('unidad:' || x.n), innovativos_sim.uid('caseta:' || x.nombre),
       case when x.origen_linea = 'fuera_de_ruta' then 'no_coincide'
            when x.escenario = 'silencio' and x.cruce > current_setting('inn.ancla')::timestamptz - interval '100 minutes' then 'sin_datos'
            else 'confirma' end,
       case when x.origen_linea = 'fuera_de_ruta' then round((1000 * 1.22 * (case when x.ckm < least(x.ka, x.kb) then least(x.ka, x.kb) - x.ckm else x.ckm - greatest(x.ka, x.kb) end))::numeric, 0)
            when x.escenario = 'silencio' and x.cruce > current_setting('inn.ancla')::timestamptz - interval '100 minutes' then null
            else round((15 + 70 * innovativos_sim.u('dm' || x.folio || x.nombre))::numeric, 0) end,
       case when x.origen_linea = 'fuera_de_ruta' then '{"via":"trayectoria","motivo":"el tractor estaba a decenas o cientos de km de la caseta cobrada"}'::jsonb
            when x.escenario = 'silencio' and x.cruce > current_setting('inn.ancla')::timestamptz - interval '100 minutes' then '{"motivo":"sin_posiciones_ventana"}'::jsonb
            else '{"via":"trayectoria","muestras":2}'::jsonb end
from (select cp.*, cp.t_cruce + make_interval(secs => (innovativos_sim.h('dr' || cp.folio || cp.nombre) % 90)::int) as cruce
      from innovativos_sim.cruce_plan cp) x
join innovativos_sim.caseta c on c.nombre = x.nombre
join innovativos_sim.tracto tr on tr.n = x.n
on conflict (id) do nothing;

-- La lista de anomalías sembradas (para el guion y para la prueba de que el
-- cruce las encuentra).
drop table if exists innovativos_sim.anomalias_sembradas cascade;
create table innovativos_sim.anomalias_sembradas as
select l.indice, l.detalle ->> 'origen_demo' as tipo, v.folio, tr.economico, l.tag, l.caseta, l.cruce_en, l.monto, l.gps_veredicto, l.gps_distancia_m
from desglose_peaje_linea l
join viaje v on v.id = l.viaje_id
join innovativos_sim.tracto tr on tr.tag = l.tag
where l.tenant_id = current_setting('inn.tenant')::uuid
  and l.detalle ->> 'origen_demo' in ('fuera_de_ruta', 'duplicado')
order by l.indice;
