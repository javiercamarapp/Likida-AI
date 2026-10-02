-- 0630 — la geocerca guarda su polígono nativo; la RPC del catálogo lo valida y lo guarda (todo-o-nada).
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values
  ('63000000-0000-4000-8000-0000000000a1', 'Flota A 0630'),
  ('63000000-0000-4000-8000-0000000000b1', 'Flota B 0630');

do $$
declare
  r jsonb; n int; p jsonb; ap boolean; rad int;
  patio jsonb := '[{"lat":20.4998,"lng":-103.3030},{"lat":20.4998,"lng":-103.2970},{"lat":20.5002,"lng":-103.2970},{"lat":20.5002,"lng":-103.3030}]'::jsonb;
begin
  -- la función de validez
  if not public.geocerca_poligono_valido(patio) then raise exception '0630: un patio válido salió inválido'; end if;
  if not public.geocerca_poligono_valido(null) then raise exception '0630: null debe ser válido (la geocerca es círculo)'; end if;
  if public.geocerca_poligono_valido('[{"lat":20,"lng":-103},{"lat":20,"lng":-103.1}]'::jsonb) then raise exception '0630: dos vértices no son polígono'; end if;
  if public.geocerca_poligono_valido('[{"lat":20,"lng":-103},{"lat":20,"lng":-103.1},{"lat":20,"lng":-103.2}]'::jsonb) then raise exception '0630: tres puntos en línea no son polígono'; end if;
  if public.geocerca_poligono_valido('[{"lat":95,"lng":-103},{"lat":20,"lng":-103.1},{"lat":21,"lng":-103.2}]'::jsonb) then raise exception '0630: latitud fuera de rango aceptada'; end if;
  if public.geocerca_poligono_valido('[{"lat":"x","lng":-103},{"lat":20,"lng":-103.1},{"lat":21,"lng":-103.2}]'::jsonb) then raise exception '0630: latitud no numérica aceptada'; end if;
  if public.geocerca_poligono_valido('{"lat":20}'::jsonb) then raise exception '0630: un objeto no es un arreglo'; end if;

  -- la RPC guarda el polígono y el círculo que lo contiene
  r := public.importar_sitios_conductor('63000000-0000-4000-8000-0000000000a1', jsonb_build_array(
    jsonb_build_object('linea', 2, 'codigo', 'PAT-1', 'nombre', 'Patio alargado', 'tipo', 'patio', 'lat', 20.5, 'lng', -103.3, 'radio_m', 340, 'poligono', patio),
    jsonb_build_object('linea', 3, 'codigo', 'CIR-1', 'nombre', 'Planta redonda', 'tipo', 'planta', 'lat', 20.6, 'lng', -103.2, 'radio_m', 150),
    jsonb_build_object('linea', 4, 'codigo', 'APR-1', 'nombre', 'Patio sin vértices', 'tipo', 'patio', 'lat', 20.7, 'lng', -103.1, 'radio_m', 300, 'aproximada', true)));
  if (r->>'ok')::boolean is not true or (r->>'creados')::int <> 3 then raise exception '0630: la importación no creó 3 sitios: %', r; end if;

  select poligono, aproximada, radio_m into p, ap, rad from public.geocerca where tenant_id = '63000000-0000-4000-8000-0000000000a1' and codigo = 'PAT-1';
  if p is distinct from patio or ap is not false or rad <> 340 then raise exception '0630: el polígono no se guardó tal cual (aprox=%, radio=%)', ap, rad; end if;
  select poligono, aproximada into p, ap from public.geocerca where tenant_id = '63000000-0000-4000-8000-0000000000a1' and codigo = 'CIR-1';
  if p is not null or ap is not false then raise exception '0630: un círculo no debe traer polígono ni ser aproximado'; end if;
  select aproximada into ap from public.geocerca where tenant_id = '63000000-0000-4000-8000-0000000000a1' and codigo = 'APR-1';
  if ap is not true then raise exception '0630: la bandera aproximada no se guardó'; end if;

  -- re-importar es idempotente (actualiza, no duplica) y puede quitar la aproximación al llegar el polígono
  r := public.importar_sitios_conductor('63000000-0000-4000-8000-0000000000a1', jsonb_build_array(
    jsonb_build_object('linea', 2, 'codigo', 'APR-1', 'nombre', 'Patio sin vértices', 'tipo', 'patio', 'lat', 20.5, 'lng', -103.3, 'radio_m', 340, 'poligono', patio)));
  if (r->>'actualizados')::int <> 1 or (r->>'creados')::int <> 0 then raise exception '0630: re-importar no actualizó (%).', r; end if;
  select poligono is not null and aproximada = false into strict ap from public.geocerca where tenant_id = '63000000-0000-4000-8000-0000000000a1' and codigo = 'APR-1';
  if ap is not true then raise exception '0630: al llegar el polígono la fila debía dejar de ser aproximada'; end if;
  select count(*) into n from public.geocerca where tenant_id = '63000000-0000-4000-8000-0000000000a1' and codigo is not null;
  if n <> 3 then raise exception '0630: la re-importación duplicó sitios (%)', n; end if;

  -- un polígono inválido rebota TODO el lote (nada se escribe)
  r := public.importar_sitios_conductor('63000000-0000-4000-8000-0000000000a1', jsonb_build_array(
    jsonb_build_object('linea', 2, 'codigo', 'OK-9', 'nombre', 'Bueno', 'tipo', 'patio', 'lat', 20.5, 'lng', -103.3, 'radio_m', 100),
    jsonb_build_object('linea', 3, 'codigo', 'MAL-9', 'nombre', 'Malo', 'tipo', 'patio', 'lat', 20.5, 'lng', -103.3, 'radio_m', 100,
                       'poligono', '[{"lat":20,"lng":-103},{"lat":20,"lng":-103.1}]'::jsonb)));
  if (r->>'ok')::boolean is not false then raise exception '0630: un polígono inválido debía rebotar el lote (%).', r; end if;
  if exists (select 1 from public.geocerca where tenant_id = '63000000-0000-4000-8000-0000000000a1' and codigo in ('OK-9', 'MAL-9')) then
    raise exception '0630: el lote rechazado dejó filas (no es todo-o-nada)';
  end if;

  -- otra flota no ve ni pisa lo de A
  select count(*) into n from public.geocerca where tenant_id = '63000000-0000-4000-8000-0000000000b1';
  if n <> 0 then raise exception '0630: la flota B tiene % geocercas ajenas', n; end if;
end $$;

-- el CHECK de la tabla protege incluso fuera de la RPC
do $$
declare ok boolean := false;
begin
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, poligono)
    values ('63000000-0000-4000-8000-0000000000a1', 'Poligono roto', 'patio', 20, -103, 100, '[{"lat":20,"lng":-103}]'::jsonb);
  exception when check_violation then ok := true; end;
  if not ok then raise exception '0630: la tabla aceptó un polígono de un vértice'; end if;
  ok := false;
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, poligono, aproximada)
    values ('63000000-0000-4000-8000-0000000000a1', 'Aprox con poligono', 'patio', 20, -103, 100,
            '[{"lat":20,"lng":-103},{"lat":20,"lng":-103.1},{"lat":20.1,"lng":-103.05}]'::jsonb, true);
  exception when check_violation then ok := true; end;
  if not ok then raise exception '0630: la tabla aceptó aproximada=true junto con un polígono'; end if;
end $$;

-- permisos: solo service_role ejecuta
do $$
begin
  if has_function_privilege('authenticated', 'public.geocerca_poligono_valido(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.geocerca_poligono_valido(jsonb)', 'execute') then
    raise exception '0630: geocerca_poligono_valido es ejecutable por anon/authenticated';
  end if;
  if has_function_privilege('authenticated', 'public.importar_sitios_conductor(uuid, jsonb)', 'execute') then
    raise exception '0630: importar_sitios_conductor es ejecutable por authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.importar_sitios_conductor(uuid, jsonb)', 'execute') then
    raise exception '0630: service_role perdió el permiso sobre importar_sitios_conductor';
  end if;
end $$;

rollback;
