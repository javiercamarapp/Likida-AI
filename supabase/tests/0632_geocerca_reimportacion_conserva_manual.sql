-- 0632 — la re-importación AUTOMÁTICA (conservar_activa) no pisa lo que la flota editó a mano; la manual del panel sigue mandando.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values ('63200000-0000-4000-8000-0000000000a1', 'Flota A 0632');

do $$
declare
  t constant uuid := '63200000-0000-4000-8000-0000000000a1';
  r jsonb; g record; padre uuid;
  patio jsonb := '[{"lat":20.4998,"lng":-103.3030},{"lat":20.4998,"lng":-103.2970},{"lat":20.5002,"lng":-103.2970},{"lat":20.5002,"lng":-103.3030}]'::jsonb;
  fila_a jsonb := jsonb_build_object('linea', 2, 'codigo', 'MAN-1', 'nombre', 'Sitio importado', 'tipo', 'punto_interes', 'lat', 20.5, 'lng', -103.3, 'radio_m', 340, 'poligono', patio);
  fila_b jsonb := jsonb_build_object('linea', 3, 'codigo', 'CSV-1', 'nombre', 'Otro importado', 'tipo', 'planta', 'lat', 20.6, 'lng', -103.2, 'radio_m', 150);
  fila_p jsonb := jsonb_build_object('linea', 4, 'codigo', 'PAD-1', 'nombre', 'Patio madre', 'tipo', 'patio', 'lat', 20.7, 'lng', -103.1, 'radio_m', 300);
begin
  -- importación inicial (manual del panel): los tres entran como fuente csv
  r := public.importar_sitios_conductor(t, jsonb_build_array(fila_a, fila_b, fila_p));
  if (r->>'creados')::int <> 3 then raise exception '0632: no creó 3 sitios: %', r; end if;
  select id into padre from public.geocerca where tenant_id = t and codigo = 'PAD-1';

  -- la flota edita MAN-1 a mano (como guardarSitio): tipo, dirección, padre, círculo, sin polígono, fuente manual
  update public.geocerca set tipo = 'anden', direccion = 'Calle 5 #10', padre_id = padre, lat = 20.51, lng = -103.31, radio_m = 300,
         poligono = null, aproximada = false, fuente = 'manual'
   where tenant_id = t and codigo = 'MAN-1';
  -- y a CSV-1 solo le capturan una dirección y la anidan (sigue fuente csv)
  update public.geocerca set direccion = 'Av. Norte 3', padre_id = padre where tenant_id = t and codigo = 'CSV-1';

  -- la re-importación diaria cambia OTRA fila (CSV-1: radio) y manda las demás igual, sin dirección ni padre
  r := public.importar_sitios_conductor(t, jsonb_build_array(
    fila_a || jsonb_build_object('conservar_activa', true),
    (fila_b || jsonb_build_object('radio_m', 200, 'conservar_activa', true)),
    fila_p || jsonb_build_object('conservar_activa', true)));
  if (r->>'ok')::boolean is not true then raise exception '0632: la re-importación automática falló: %', r; end if;
  if (r->>'conservados')::int <> 1 then raise exception '0632: debía conservar 1 sitio manual: %', r; end if;

  select * into g from public.geocerca where tenant_id = t and codigo = 'MAN-1';
  if g.tipo <> 'anden' or g.direccion is distinct from 'Calle 5 #10' or g.padre_id is distinct from padre or g.fuente <> 'manual'
     or g.radio_m <> 300 or g.lat <> 20.51 or g.poligono is not null then
    raise exception '0632: la automática pisó el sitio manual (tipo=%, dir=%, padre=%, fuente=%, radio=%, poligono=%)', g.tipo, g.direccion, g.padre_id, g.fuente, g.radio_m, g.poligono is not null;
  end if;

  select * into g from public.geocerca where tenant_id = t and codigo = 'CSV-1';
  if g.radio_m <> 200 then raise exception '0632: el sitio csv debía actualizarse con el cambio de la tabla (radio=%)', g.radio_m; end if;
  if g.direccion is distinct from 'Av. Norte 3' or g.padre_id is distinct from padre then
    raise exception '0632: la automática borró la dirección o el padre capturados (dir=%, padre=%)', g.direccion, g.padre_id;
  end if;

  -- la importación MANUAL del panel (sin la marca) sí manda: sobrescribe y devuelve la fuente a csv
  r := public.importar_sitios_conductor(t, jsonb_build_array(fila_a));
  select * into g from public.geocerca where tenant_id = t and codigo = 'MAN-1';
  if g.tipo <> 'punto_interes' or g.fuente <> 'csv' or g.poligono is distinct from patio then
    raise exception '0632: la importación manual debía sobrescribir el sitio (tipo=%, fuente=%)', g.tipo, g.fuente;
  end if;
end $$;

rollback;
