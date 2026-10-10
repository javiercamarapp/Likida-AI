-- ═══════════════════════════════════════════════════════════════════════════
-- 00 — Guardas y ayudas del seed del DEMO «Innovativos (demo)».
--
-- TODO ES SINTÉTICO. Nombres de empresas con la palabra «Ficticia/o», RFC y
-- placas inventados, teléfonos con la marca de demo 28999… (código de país 289: sin asignar;
-- el envío real los rechaza), casetas «Demo». Nada de esto es dato real de Innovativos ni de
-- sus clientes: el día que lleguen sus archivos se reemplaza (docs/demo/innovativos.md).
--
-- NUNCA PRODUCCIÓN: este seed solo corre contra una base LOCAL o de laboratorio.
-- Dos guardas: guarda-host.mjs (la corre sembrar.sh) rechaza hosts remotos, y aquí la base se niega si el
-- servidor no escucha en loopback (o socket Unix); las redes privadas solo con DEMO_PERMITIR_RED_PRIVADA=1.
-- ═══════════════════════════════════════════════════════════════════════════

-- La ancla es «ahora» del demo: todo lo «en curso» se calcula contra ella, así
-- dos corridas dan EXACTAMENTE las mismas filas. (sembrar.sh la pasa con -v.)
\if :{?red_privada}
\else
  \set red_privada 0
\endif
select set_config('inn.red_privada', :'red_privada', false) \g /dev/null
select set_config('inn.ancla', :'ancla', false) \g /dev/null
select set_config('inn.tenant', 'eeeeeeee-0620-4000-8000-000000000250', false) \g /dev/null

do $$
declare
  ip inet := inet_server_addr();
  ok boolean;
  t uuid := current_setting('inn.tenant')::uuid;
  n text;
begin
  -- Loopback / socket siempre; red privada SOLO con la bandera explícita DEMO_PERMITIR_RED_PRIVADA=1 (sembrar.sh -v red_privada=1).
  ok := ip is null or ip <<= '127.0.0.0/8'::inet or ip = '::1'::inet
        or (current_setting('inn.red_privada', true) = '1'
            and (ip <<= '10.0.0.0/8'::inet or ip <<= '172.16.0.0/12'::inet or ip <<= '192.168.0.0/16'::inet));
  if not ok then
    raise exception 'DEMO INNOVATIVOS: el servidor escucha en % (no es loopback; las redes privadas piden DEMO_PERMITIR_RED_PRIVADA=1). Este seed NO corre contra una base remota o de producción.', ip;
  end if;
  if current_database() ~* 'prod' then
    raise exception 'DEMO INNOVATIVOS: la base se llama «%» (parece de producción, quizá por un túnel). No se siembra.', current_database();
  end if;
  select nombre into n from tenant where id = t;
  if n is not null and n <> 'Innovativos (demo)' then
    raise exception 'el tenant % ya existe y se llama "%": no es el demo; no se toca', t, n;
  end if;
end $$;

create schema if not exists innovativos_sim;

-- Segunda línea de defensa de la ancla: sembrar.sh ya exige --reiniciar con --ancla, pero si alguien corre
-- el SQL a mano (o sembrar.sh sin --ancla sobre una base sembrada con otra), se niega: dos «ahora» mezclados
-- dejan viajes, posiciones y pases incoherentes entre sí (todo es ON CONFLICT DO NOTHING y no se repara).
create table if not exists innovativos_sim.meta (clave text primary key, valor text not null);
do $$
declare a text; t uuid := current_setting('inn.tenant')::uuid;
begin
  select valor into a from innovativos_sim.meta where clave = 'ancla';
  if a is not null and a::timestamptz <> current_setting('inn.ancla')::timestamptz and exists (select 1 from tenant where id = t) then
    raise exception 'DEMO INNOVATIVOS: el demo ya está sembrado con otra ancla (%) y pediste %. Usa sembrar.sh --reiniciar --ancla ... para empezar de cero.', a, current_setting('inn.ancla');
  end if;
end $$;
insert into innovativos_sim.meta (clave, valor) values ('ancla', current_setting('inn.ancla'))
on conflict (clave) do update set valor = excluded.valor;
comment on schema innovativos_sim is
  'DEMO Innovativos: SIMULA las tablas que Innovativos tiene en su sistema (GPS al momento, geocercas, convenios). No es del producto; vive solo en bases locales. Se borra con scripts/demo/innovativos/limpiar.sql.';

-- ── Pseudoaleatorio DETERMINISTA (mismo texto => mismo número, siempre) ─────
create or replace function innovativos_sim.h(k text) returns bigint
language sql immutable as $$ select (hashtext(k)::bigint & 2147483647) $$;

create or replace function innovativos_sim.u(k text) returns float8   -- [0,1)
language sql immutable as $$ select innovativos_sim.h(k)::float8 / 2147483648.0 $$;

create or replace function innovativos_sim.pick(k text, n int) returns int  -- 1..n
language sql immutable as $$ select 1 + (innovativos_sim.h(k) % n)::int $$;

create or replace function innovativos_sim.uid(k text) returns uuid
language sql immutable as $$ select md5('innovativos-demo-0620:' || k)::uuid $$;

create or replace function innovativos_sim.sha(k text) returns text
language sql immutable as $$ select encode(sha256(convert_to(k, 'UTF8')), 'hex') $$;

-- ── La cadena de carreteras: un solo eje GDL–LAG–LEO–SIL–SLP–MAT–SAL–APO ────
-- (distancia de línea recta × 1.22; basta para dar posiciones coherentes).
drop table if exists innovativos_sim.nodo cascade;
create table innovativos_sim.nodo (
  cod text primary key, orden int not null, nombre text not null,
  lat float8 not null, lng float8 not null, km float8
);
insert into innovativos_sim.nodo (cod, orden, nombre, lat, lng) values
  ('GDL', 1, 'Guadalajara / Tlaquepaque',   20.6400, -103.3100),
  ('LAG', 2, 'Lagos de Moreno',             21.3570, -101.9300),
  ('LEO', 3, 'León',                        21.1220, -101.6830),
  ('SIL', 4, 'Silao',                       20.9440, -101.4280),
  ('SLP', 5, 'San Luis Potosí',             22.1500, -100.9850),
  ('MAT', 6, 'Matehuala',                   23.6500, -100.6460),
  ('SAL', 7, 'Saltillo / Ramos Arizpe',     25.4200, -101.0000),
  ('APO', 8, 'Apodaca / Monterrey',         25.7800, -100.1900);

create or replace function innovativos_sim.dist_km(la1 float8, lo1 float8, la2 float8, lo2 float8) returns float8
language sql immutable as $$
  select 2 * 6371.0 * asin(sqrt(
      power(sin(radians(la2 - la1) / 2), 2)
    + cos(radians(la1)) * cos(radians(la2)) * power(sin(radians(lo2 - lo1) / 2), 2))) $$;

update innovativos_sim.nodo n set km = c.km
from (
  select cod, coalesce(sum(d) over (order by orden), 0) as km
  from (
    select cod, orden,
           coalesce(1.22 * innovativos_sim.dist_km(lag(lat) over (order by orden), lag(lng) over (order by orden), lat, lng), 0) as d
    from innovativos_sim.nodo
  ) x
) c where c.cod = n.cod;

-- Punto del eje a los `p_km` kilómetros desde GDL (interpolación lineal por tramo).
create or replace function innovativos_sim.punto(p_km float8)
returns table (lat float8, lng float8) language sql stable as $$
  with t as (
    select a.lat as la0, a.lng as lo0, b.lat as la1, b.lng as lo1, a.km as k0, b.km as k1
    from innovativos_sim.nodo a join innovativos_sim.nodo b on b.orden = a.orden + 1
    where p_km >= a.km and p_km <= b.km
  )
  select la0 + (la1 - la0) * (p_km - k0) / (k1 - k0), lo0 + (lo1 - lo0) * (p_km - k0) / (k1 - k0) from t
  union all
  select (select lat from innovativos_sim.nodo order by orden limit 1), (select lng from innovativos_sim.nodo order by orden limit 1) where p_km < 0
  union all
  select (select lat from innovativos_sim.nodo order by orden desc limit 1), (select lng from innovativos_sim.nodo order by orden desc limit 1) where p_km > (select max(km) from innovativos_sim.nodo)
  limit 1 $$;

-- Valor de campo extraído (forma de CampoValor de carta_porte_docs/campos.ts).
create or replace function innovativos_sim.cv(valor text, conf numeric default 0.97, evid text default null, origen text default 'llm')
returns jsonb language sql immutable as $$
  select jsonb_build_object('valor', valor, 'confianza', conf, 'evidencia', coalesce(evid, valor), 'origen', origen) $$;
