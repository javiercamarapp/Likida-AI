-- ═══════════════════════════════════════════════════════════════════════════
-- 0630 — P1 «geocercas-polígono»: la geocerca guarda su POLÍGONO nativo.
--
-- Hasta hoy `geocerca` solo sabía círculo (centro + radio). Un polígono real del
-- cliente (un patio alargado junto a una carretera) se aproximaba por el círculo
-- que lo contiene +5 %, y la reclamación de peajes acusaba con confianza «alta» a
-- unidades que solo pasaban por la carretera. Esta migración:
--
-- 1. agrega `poligono` (jsonb: arreglo de {lat, lng}, 3 a 500 vértices, con área)
--    y `aproximada` (boolean): true = el círculo SUSTITUYE a un polígono del
--    cliente que no se guardó, así que quien acusa con él debe bajar su confianza.
--    `lat/lng/radio_m` siguen siendo el círculo que CONTIENE al polígono: lo que
--    lee el código anterior sigue funcionando (conservador) sin conocer la columna.
-- 2. `geocerca_poligono_valido()` — la única definición de «polígono guardable»
--    para el CHECK y para la RPC.
-- 3. reescribe `importar_sitios_conductor` (misma firma, mismos permisos): acepta
--    `poligono` y `aproximada` por fila, valida el polígono en la pasada 1 (todo o
--    nada) y los guarda; `aproximada` solo se admite sin polígono.
--
-- FILAS PREVIAS: las que vinieron de un CSV (fuente = 'csv') se marcan aproximada =
-- true UNA vez: no hay forma de saber cuáles nacieron de un polígono y un círculo
-- inflado con +5 % no se distingue de uno exacto. Es el lado SEGURO (baja una
-- confianza, no acusa de más); la re-importación (0631, cron gps) las aclara.
-- Idempotente: el marcado solo corre cuando la columna aún no existía.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.geocerca_poligono_valido(p_poligono jsonb)
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  e jsonb;
  n integer;
begin
  if p_poligono is null then return true; end if;
  if jsonb_typeof(p_poligono) <> 'array' then return false; end if;
  n := jsonb_array_length(p_poligono);
  if n < 3 or n > 500 then return false; end if;
  for e in select * from jsonb_array_elements(p_poligono) loop
    if jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e->'lat') <> 'number' or jsonb_typeof(e->'lng') <> 'number'
       or (e->>'lat')::double precision not between -90 and 90
       or (e->>'lng')::double precision not between -180 and 180 then
      return false;
    end if;
  end loop;
  -- Con área: tres puntos en línea (o repetidos) no son un polígono. Suma del determinante sobre el
  -- primer vértice, en grados: cero exacto solo si todos son colineales.
  return abs((
    select sum(
      ((a->>'lng')::double precision - (p_poligono->0->>'lng')::double precision) * ((b->>'lat')::double precision - (p_poligono->0->>'lat')::double precision)
      - ((b->>'lng')::double precision - (p_poligono->0->>'lng')::double precision) * ((a->>'lat')::double precision - (p_poligono->0->>'lat')::double precision))
      from (
        select p_poligono->(i - 1) as a, p_poligono->(i % n) as b from generate_series(1, n) i
      ) s
  )) > 1e-10;
end $$;
revoke all on function public.geocerca_poligono_valido(jsonb) from public, anon, authenticated;
grant execute on function public.geocerca_poligono_valido(jsonb) to service_role;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'geocerca' and column_name = 'aproximada') then
    alter table public.geocerca add column aproximada boolean not null default false;
    -- Una sola vez: lo que vino de un CSV pudo ser un polígono aproximado y no se puede saber cuál.
    update public.geocerca set aproximada = true where fuente = 'csv';
  end if;
end $$;

alter table public.geocerca add column if not exists poligono jsonb;

alter table public.geocerca drop constraint if exists geocerca_poligono_forma;
alter table public.geocerca add constraint geocerca_poligono_forma check (public.geocerca_poligono_valido(poligono));
alter table public.geocerca drop constraint if exists geocerca_aproximada_sin_poligono;
alter table public.geocerca add constraint geocerca_aproximada_sin_poligono check (not (aproximada and poligono is not null));

comment on column public.geocerca.poligono is
  '0630: polígono nativo del cliente, arreglo de {lat, lng} (3 a 500 vértices, sin repetir el primero, con área). NULL = la geocerca es solo círculo. lat/lng/radio_m siguen siendo el círculo que lo CONTIENE (respaldo para quien no conozca el polígono).';
comment on column public.geocerca.aproximada is
  '0630: true = el círculo SUSTITUYE a un polígono del cliente que no se guardó. Quien acusa con esta geocerca (peajes: zona no autorizada) baja su confianza a «media». Nunca true junto con un polígono.';

-- La RPC del catálogo (0385) con polígono y bandera; misma firma, mismos permisos (solo service_role).
create or replace function public.importar_sitios_conductor(p_tenant uuid, p_filas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  f jsonb;
  errores jsonb := '[]'::jsonb;
  creados integer := 0;
  actualizados integer := 0;
  v_id uuid;
  v_cliente uuid;
  v_padre uuid;
  v_linea integer;
  v_codigo text;
  v_nombre text;
  existe_nombre record;
  v_poligono jsonb;
  v_aprox boolean;
begin
  if p_tenant is null or p_filas is null or jsonb_typeof(p_filas) <> 'array' then raise exception 'importar_sitios: entrada inválida'; end if;
  if jsonb_array_length(p_filas) = 0 or jsonb_array_length(p_filas) > 2000 then raise exception 'importar_sitios: entre 1 y 2000 filas'; end if;
  -- Dos importaciones de la MISMA flota a la vez se serializan: la segunda ve los sitios de la primera y actualiza en
  -- vez de chocar con el unique (código, nombre). Por flota, no global: otra flota no espera.
  perform pg_advisory_xact_lock(hashtextextended('importar_sitios_conductor:' || p_tenant::text, 0));

  -- Pasada 1: revisar sin escribir.
  for f in select * from jsonb_array_elements(p_filas) loop
    v_linea := (f->>'linea')::integer;
    v_codigo := nullif(btrim(f->>'codigo'), '');
    v_nombre := btrim(f->>'nombre');
    if nullif(btrim(f->>'cliente'), '') is not null
       and not exists (select 1 from public.cliente c where c.tenant_id = p_tenant and lower(c.nombre) = lower(btrim(f->>'cliente'))) then
      errores := errores || jsonb_build_object('linea', v_linea, 'mensaje', 'El cliente «' || btrim(f->>'cliente') || '» no existe en tu catálogo de clientes.');
    end if;
    if nullif(btrim(f->>'padre'), '') is not null
       and not exists (select 1 from jsonb_array_elements(p_filas) x where nullif(btrim(x->>'codigo'), '') = btrim(f->>'padre'))
       and not exists (select 1 from public.geocerca g where g.tenant_id = p_tenant and g.codigo = btrim(f->>'padre')) then
      errores := errores || jsonb_build_object('linea', v_linea, 'mensaje', 'El sitio padre «' || btrim(f->>'padre') || '» no está en el archivo ni en tu catálogo.');
    end if;
    if f->'poligono' is not null and jsonb_typeof(f->'poligono') <> 'null' and not public.geocerca_poligono_valido(f->'poligono') then
      errores := errores || jsonb_build_object('linea', v_linea, 'mensaje', 'El polígono del sitio «' || v_nombre || '» no es válido (3 a 500 vértices con latitud y longitud, y con área).');
    end if;
    select g.id, g.codigo into existe_nombre from public.geocerca g
     where g.tenant_id = p_tenant and g.nombre = v_nombre and g.codigo is distinct from v_codigo limit 1;
    if found then
      errores := errores || jsonb_build_object('linea', v_linea, 'mensaje', 'Ya existe un sitio llamado «' || v_nombre || '» con otro código; cámbiale el nombre o el código.');
    end if;
  end loop;
  if jsonb_array_length(errores) > 0 then
    return jsonb_build_object('ok', false, 'errores', errores);
  end if;

  -- Pasada 2: escribir (upsert por código).
  for f in select * from jsonb_array_elements(p_filas) loop
    v_codigo := btrim(f->>'codigo');
    v_cliente := null;
    -- 0630: el polígono nativo (si viene) y la bandera de aproximación (solo si NO hay polígono: un círculo que sustituye a uno).
    v_poligono := case when jsonb_typeof(f->'poligono') = 'array' then f->'poligono' else null end;
    v_aprox := v_poligono is null and coalesce((f->>'aproximada')::boolean, false);
    if nullif(btrim(f->>'cliente'), '') is not null then
      select c.id into v_cliente from public.cliente c where c.tenant_id = p_tenant and lower(c.nombre) = lower(btrim(f->>'cliente')) limit 1;
    end if;
    select g.id into v_id from public.geocerca g where g.tenant_id = p_tenant and g.codigo = v_codigo;
    if v_id is null then
      insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, codigo, direccion, cliente_id, fuente, poligono, aproximada)
      values (p_tenant, btrim(f->>'nombre'), f->>'tipo', (f->>'lat')::double precision, (f->>'lng')::double precision,
              (f->>'radio_m')::integer, v_codigo, nullif(btrim(f->>'direccion'), ''), v_cliente, 'csv', v_poligono, v_aprox);
      creados := creados + 1;
    else
      update public.geocerca
         set nombre = btrim(f->>'nombre'), tipo = f->>'tipo', lat = (f->>'lat')::double precision, lng = (f->>'lng')::double precision,
             radio_m = (f->>'radio_m')::integer, direccion = nullif(btrim(f->>'direccion'), ''), cliente_id = v_cliente, fuente = 'csv', activa = true,
             poligono = v_poligono, aproximada = v_aprox
       where id = v_id and tenant_id = p_tenant;
      actualizados := actualizados + 1;
    end if;
  end loop;
  -- Padres: una vez que todos existen.
  for f in select * from jsonb_array_elements(p_filas) loop
    v_codigo := btrim(f->>'codigo');
    v_padre := null;
    if nullif(btrim(f->>'padre'), '') is not null then
      select g.id into v_padre from public.geocerca g where g.tenant_id = p_tenant and g.codigo = btrim(f->>'padre');
    end if;
    update public.geocerca set padre_id = v_padre where tenant_id = p_tenant and codigo = v_codigo;
  end loop;
  return jsonb_build_object('ok', true, 'creados', creados, 'actualizados', actualizados);
end $$;
revoke all on function public.importar_sitios_conductor(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.importar_sitios_conductor(uuid, jsonb) to service_role;
