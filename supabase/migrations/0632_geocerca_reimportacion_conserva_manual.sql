-- ═══════════════════════════════════════════════════════════════════════════
-- 0632 — P1, correctiva de adversarial (ronda 07): la re-importación AUTOMÁTICA no pisa lo editado a mano.
--
-- El upsert por código de la 0630 sobrescribía nombre, tipo, círculo, polígono y cliente, ponía fuente = 'csv' y dejaba
-- dirección y padre en NULL (la tabla del cliente no los tiene), sin respetar fuente = 'manual'. La huella solo lo evitaba mientras
-- NINGUNA fila de la tabla del cliente cambiara. Ahora, con `conservar_activa` (la marca de la re-importación diaria):
--   · un sitio con fuente = 'manual' (editado en el editor de sitios) se salta entero y se cuenta en `conservados`;
--   · en los demás, una dirección o un padre ausentes en la tabla no borran los que ya tenía el sitio.
-- La importación manual del panel (sin la marca) conserva su comportamiento de siempre: lo que el usuario sube manda.
-- Misma firma y permisos que la 0630 (solo service_role).
-- ═══════════════════════════════════════════════════════════════════════════
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
  v_auto boolean;
  v_fuente text;
  conservados integer := 0;
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
    -- 0632: `conservar_activa` es la marca de la re-importación AUTOMÁTICA diaria (la manual del panel no la manda).
    v_auto := coalesce((f->>'conservar_activa')::boolean, false);
    -- 0630: el polígono nativo (si viene) y la bandera de aproximación (solo si NO hay polígono: un círculo que sustituye a uno).
    v_poligono := case when jsonb_typeof(f->'poligono') = 'array' then f->'poligono' else null end;
    v_aprox := v_poligono is null and coalesce((f->>'aproximada')::boolean, false);
    if nullif(btrim(f->>'cliente'), '') is not null then
      select c.id into v_cliente from public.cliente c where c.tenant_id = p_tenant and lower(c.nombre) = lower(btrim(f->>'cliente')) limit 1;
    end if;
    select g.id, g.fuente into v_id, v_fuente from public.geocerca g where g.tenant_id = p_tenant and g.codigo = v_codigo;
    if v_id is not null and v_auto and v_fuente = 'manual' then
      -- 0632: lo que la flota editó a mano en el editor de sitios (fuente = 'manual') NO lo pisa la re-importación automática:
      -- ni el tipo, ni el círculo, ni el polígono, ni el cliente, ni la dirección, ni el padre. La huella solo evita esto mientras
      -- la tabla del cliente no cambie; el primer cambio en cualquier fila reescribía todas.
      conservados := conservados + 1;
      continue;
    end if;
    if v_id is null then
      insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, codigo, direccion, cliente_id, fuente, poligono, aproximada)
      values (p_tenant, btrim(f->>'nombre'), f->>'tipo', (f->>'lat')::double precision, (f->>'lng')::double precision,
              (f->>'radio_m')::integer, v_codigo, nullif(btrim(f->>'direccion'), ''), v_cliente, 'csv', v_poligono, v_aprox);
      creados := creados + 1;
    else
      update public.geocerca
         set nombre = btrim(f->>'nombre'), tipo = f->>'tipo', lat = (f->>'lat')::double precision, lng = (f->>'lng')::double precision,
             radio_m = (f->>'radio_m')::integer,
             -- 0632: la re-importación automática no trae dirección (su tabla no la tiene): no borra la que se capturó a mano.
             direccion = case when v_auto then coalesce(nullif(btrim(f->>'direccion'), ''), public.geocerca.direccion) else nullif(btrim(f->>'direccion'), '') end,
             cliente_id = v_cliente, fuente = 'csv',
             -- Re-importar a mano reactiva el sitio (como siempre); la re-importación AUTOMÁTICA diaria manda `conservar_activa` y NO
             -- revive un sitio que la flota archivó a propósito.
             activa = case when coalesce((f->>'conservar_activa')::boolean, false) then public.geocerca.activa else true end,
             poligono = v_poligono, aproximada = v_aprox
       where id = v_id and tenant_id = p_tenant;
      actualizados := actualizados + 1;
    end if;
  end loop;
  -- Padres: una vez que todos existen.
  for f in select * from jsonb_array_elements(p_filas) loop
    v_codigo := btrim(f->>'codigo');
    v_padre := null;
    v_auto := coalesce((f->>'conservar_activa')::boolean, false);
    if nullif(btrim(f->>'padre'), '') is not null then
      select g.id into v_padre from public.geocerca g where g.tenant_id = p_tenant and g.codigo = btrim(f->>'padre');
    end if;
    -- 0632: la automática sin padre en su tabla NO deja huérfano al sitio que la flota anidó a mano, y nunca toca lo manual.
    if v_auto and (v_padre is null or exists (select 1 from public.geocerca g where g.tenant_id = p_tenant and g.codigo = v_codigo and g.fuente = 'manual')) then
      continue;
    end if;
    update public.geocerca set padre_id = v_padre where tenant_id = p_tenant and codigo = v_codigo;
  end loop;
  return jsonb_build_object('ok', true, 'creados', creados, 'actualizados', actualizados, 'conservados', conservados);
end $$;
revoke all on function public.importar_sitios_conductor(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.importar_sitios_conductor(uuid, jsonb) to service_role;
