-- 0605 — presencia_en_sitios y posiciones_por_unidad_dia no cuentan el pin de WhatsApp.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values ('60500000-0000-4000-8000-0000000000a1', 'Flota A 0605');
insert into public.unidad (id, tenant_id, numero_economico, activo) values
  ('60500000-0000-4000-8000-0000000000a2', '60500000-0000-4000-8000-0000000000a1', 'U-ESTADIA', true),
  ('60500000-0000-4000-8000-0000000000a3', '60500000-0000-4000-8000-0000000000a1', 'U-SOLO-PIN', true);
insert into public.posicion (tenant_id, unidad_id, lat, lng, medida_en, proveedor) values
  ('60500000-0000-4000-8000-0000000000a1', '60500000-0000-4000-8000-0000000000a2', 19.0, -99.0, timestamptz '2026-09-01 10:00+00', 'samsara'),
  ('60500000-0000-4000-8000-0000000000a1', '60500000-0000-4000-8000-0000000000a2', 19.0, -99.0, timestamptz '2026-09-01 12:00+00', 'samsara'),
  -- el pin del chofer, dentro del radio, 5.5 h después del último punto de GPS
  ('60500000-0000-4000-8000-0000000000a1', '60500000-0000-4000-8000-0000000000a2', 19.0, -99.0, timestamptz '2026-09-01 17:30+00', 'whatsapp'),
  ('60500000-0000-4000-8000-0000000000a1', '60500000-0000-4000-8000-0000000000a3', 19.0, -99.0, timestamptz '2026-09-01 17:30+00', 'whatsapp');

do $$
declare r record; n int;
begin
  select * into r from public.presencia_en_sitios('60500000-0000-4000-8000-0000000000a1', jsonb_build_array(jsonb_build_object(
    'viaje_id', '60500000-0000-4000-8000-000000000f11', 'unidad_id', '60500000-0000-4000-8000-0000000000a2',
    'desde', '2026-09-01 09:00+00', 'hasta', '2026-09-01 18:00+00', 'lat', 19.0, 'lng', -99.0, 'radio_m', 500)));
  if r.ultima is distinct from timestamptz '2026-09-01 12:00+00' or r.n <> 2 then
    raise exception '0605: presencia_en_sitios contó el pin (ultima=%, n=%)', r.ultima, r.n;
  end if;

  select count(*) into n from public.presencia_en_sitios('60500000-0000-4000-8000-0000000000a1', jsonb_build_array(jsonb_build_object(
    'viaje_id', '60500000-0000-4000-8000-000000000f12', 'unidad_id', '60500000-0000-4000-8000-0000000000a3',
    'desde', '2026-09-01 09:00+00', 'hasta', '2026-09-01 18:00+00', 'lat', 19.0, 'lng', -99.0, 'radio_m', 500)));
  if n <> 0 then raise exception '0605: una unidad con solo pin tuvo presencia medida'; end if;

  select coalesce(sum(x.n), 0) into n from public.posiciones_por_unidad_dia(
    '60500000-0000-4000-8000-0000000000a1', array['60500000-0000-4000-8000-0000000000a3']::uuid[], date '2026-09-01', date '2026-09-01') x;
  if n <> 0 then raise exception '0605: un día con solo pin salió con evidencia GPS (%)', n; end if;

  select coalesce(sum(x.n), 0) into n from public.posiciones_por_unidad_dia(
    '60500000-0000-4000-8000-0000000000a1', array['60500000-0000-4000-8000-0000000000a2']::uuid[], date '2026-09-01', date '2026-09-01') x;
  if n <> 2 then raise exception '0605: el conteo del día debía ser 2 (GPS) y fue %', n; end if;

  if has_function_privilege('anon', 'public.presencia_en_sitios(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.posiciones_por_unidad_dia(uuid,uuid[],date,date)', 'execute') then
    raise exception '0605: las RPC no deben ser ejecutables por anon/authenticated';
  end if;
end $$;

rollback;
