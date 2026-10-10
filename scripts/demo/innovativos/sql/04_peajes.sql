-- ═══════════════════════════════════════════════════════════════════════════
-- 04 — Peajes: catálogo de casetas «Demo» sobre el eje, TAG por tracto y el
-- archivo de pases de las últimas 24 h (los cruces que de verdad hizo cada
-- tracto, según su viaje), más CRUCES FUERA DE RUTA y COBROS DUPLICADOS
-- sembrados a propósito para el reporte de descuento al proveedor.
--
-- Los veredictos de GPS de las líneas no son inventados: las líneas normales
-- caen sobre la trayectoria que 03 sembró (veredicto «confirma»); las sembradas
-- «fuera de ruta» están a decenas de km de esa trayectoria («no_coincide»); y
-- los cruces posteriores al silencio del GPS quedan «sin_datos» (la última posición
-- es de ancla−100 min; el motor tolera 5 min de desfase de reloj: de ahí el corte en −95).
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
            when x.escenario = 'silencio' and x.cruce > current_setting('inn.ancla')::timestamptz - interval '95 minutes' then 'sin_datos'
            else 'confirma' end,
       case when x.origen_linea = 'fuera_de_ruta' then round((1000 * 1.22 * (case when x.ckm < least(x.ka, x.kb) then least(x.ka, x.kb) - x.ckm else x.ckm - greatest(x.ka, x.kb) end))::numeric, 0)
            when x.escenario = 'silencio' and x.cruce > current_setting('inn.ancla')::timestamptz - interval '95 minutes' then null
            else round((15 + 70 * innovativos_sim.u('dm' || x.folio || x.nombre))::numeric, 0) end,
       case when x.origen_linea = 'fuera_de_ruta' then '{"via":"trayectoria","motivo":"el tractor estaba a decenas o cientos de km de la caseta cobrada"}'::jsonb
            when x.escenario = 'silencio' and x.cruce > current_setting('inn.ancla')::timestamptz - interval '95 minutes' then '{"motivo":"sin_posiciones_ventana"}'::jsonb
            else '{"via":"trayectoria","muestras":2}'::jsonb end
from (select cp.*, cp.t_cruce + make_interval(secs => (innovativos_sim.h('dr' || cp.folio || cp.nombre) % 90)::int) as cruce
      from innovativos_sim.cruce_plan cp) x
join innovativos_sim.caseta c on c.nombre = x.nombre
join innovativos_sim.tracto tr on tr.n = x.n
on conflict (id) do nothing;

-- ── Dos cruces de tractos SIN viaje, junto al patio alargado de Tlaquepaque (polígono nativo, 01_base.sql) ─────
-- Las dos líneas quedan «sin datos» en el cruce por caseta (una sola posición en la ventana: el motor no afirma nada) y
-- son las que prueba el reporte de reclamación con polígono (peajes/reclamacion.ts):
--   · IN-141 estaba ESTACIONADO dentro del patio cuando «cruzó» Caseta Demo Zapotlanejo  → «unidad en zona no
--     autorizada», confianza ALTA (el polígono es exacto: no pudo cruzar la caseta).
--   · IN-142 iba por la carretera de junto (330 m al norte del centro: dentro del círculo de ~520 m, fuera del
--     polígono) cuando se le cobró Caseta Demo Tepatitlan → NO se reclama. Con el círculo se le habría acusado.
insert into desglose_peaje_linea (id, tenant_id, desglose_id, indice, fecha, caseta, monto, tag, viaje_id, estatus,
                                  diferencia, detalle, hora, cruce_en, unidad_id, caseta_id,
                                  gps_veredicto, gps_distancia_m, gps_detalle)
select innovativos_sim.uid('pase:patio:' || z.n || ':' || z.nombre), current_setting('inn.tenant')::uuid, innovativos_sim.uid('desglose:pase-24h'),
       (select coalesce(max(l.indice), 0) from desglose_peaje_linea l
         where l.desglose_id = innovativos_sim.uid('desglose:pase-24h') and coalesce(l.detalle ->> 'origen_demo', '') not in ('en_patio', 'junto_al_patio'))::int + z.k,
       (t0.cruce at time zone 'America/Mexico_City')::date, z.nombre, c.tarifa, tr.tag, null, 'sin_contraparte', null,
       jsonb_build_object('origen_demo', z.origen, 'tag_cobrado', tr.tag),
       (t0.cruce at time zone 'America/Mexico_City')::time, t0.cruce, innovativos_sim.uid('unidad:' || z.n), innovativos_sim.uid('caseta:' || z.nombre),
       'sin_datos',
       round((1000 * innovativos_sim.dist_km(pa.lat + z.dlat, pa.lng, c.lat, c.lng))::numeric, 1),
       '{"motivo":"muestras_insuficientes","muestras":1}'::jsonb
from (values (1, 141, 'Caseta Demo Zapotlanejo', 'en_patio', 0.0::float8),
             (2, 142, 'Caseta Demo Tepatitlan', 'junto_al_patio', 0.0030::float8)) z(k, n, nombre, origen, dlat)
cross join lateral (select current_setting('inn.ancla')::timestamptz - interval '146 minutes' as cruce) t0
join innovativos_sim.caseta c on c.nombre = z.nombre
join innovativos_sim.tracto tr on tr.n = z.n
join geocerca pa on pa.id = innovativos_sim.uid('geo:patio:GDL')
on conflict (id) do nothing;

-- ── Cursos (rutas autorizadas, P8 / mig. 0665) ─────────────────────────────
-- Cada tracto con viaje en curso tiene SU curso por casetas autorizadas: las casetas entre el origen y el destino de su
-- viaje (el mismo criterio con el que se sembraron sus cruces reales). A TRES cruces reales se les quita su caseta del curso
-- a propósito: el tractor SÍ estaba ahí (el GPS lo confirma) pero esa caseta no figura en su ruta autorizada → el reporte
-- de reclamación los marca «cruce fuera de curso» (confianza media). Los cruces fuera de ruta y los duplicados no se tocan
-- (ya tienen su motivo, y la línea recibe solo uno). IN-141 e IN-142 (sin viaje) no tienen curso: quedan «sin curso declarado».
drop table if exists innovativos_sim.curso_fuera cascade;
create table innovativos_sim.curso_fuera as
select x.n, x.folio, x.nombre
from (
  select cp.n, cp.folio, cp.nombre,
         row_number() over (order by md5('curso' || cp.folio || cp.nombre)) as rk
  from innovativos_sim.cruce_plan cp
  where cp.escenario = 'normal' and cp.origen_linea = 'real'
    and not exists (select 1 from innovativos_sim.cruce_plan o
                     where o.n = cp.n and o.nombre = cp.nombre and o.origen_linea in ('duplicado', 'fuera_de_ruta'))
) x
where x.rk <= 3;

insert into peaje_curso (id, tenant_id, codigo, nombre, tipo, unidad_id, activo)
select innovativos_sim.uid('curso:' || p.n), current_setting('inn.tenant')::uuid, 'CUR-DEMO-' || tr.economico,
       'Ruta autorizada ' || tr.economico || ' (' || p.folio || ')', 'casetas', innovativos_sim.uid('unidad:' || p.n), true
from innovativos_sim.plan_viaje p
join innovativos_sim.tracto tr on tr.n = p.n
where p.tipo = 'abierto'
on conflict (id) do nothing;

insert into peaje_curso_caseta (curso_id, caseta_id, tenant_id, orden)
select innovativos_sim.uid('curso:' || p.n), innovativos_sim.uid('caseta:' || c.nombre), current_setting('inn.tenant')::uuid,
       (row_number() over (partition by p.n order by case when p.ka <= p.kb then c.km else -c.km end))::int - 1
from innovativos_sim.plan_viaje p
join innovativos_sim.caseta c on c.km > least(p.ka, p.kb) + 5 and c.km < greatest(p.ka, p.kb) - 5
where p.tipo = 'abierto'
  and not exists (select 1 from innovativos_sim.curso_fuera f where f.n = p.n and f.nombre = c.nombre)
on conflict (curso_id, caseta_id) do nothing;

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
