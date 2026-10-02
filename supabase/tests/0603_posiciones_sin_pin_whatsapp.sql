-- 0603 — las RPC de posiciones no cuentan el pin de WhatsApp.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values
  ('60300000-0000-4000-8000-0000000000a1', 'Flota A 0603'),
  ('60300000-0000-4000-8000-0000000000b1', 'Flota B 0603');
insert into public.unidad (id, tenant_id, numero_economico, activo) values
  ('60300000-0000-4000-8000-0000000000a2', '60300000-0000-4000-8000-0000000000a1', 'U-GPS-Y-PIN', true),
  ('60300000-0000-4000-8000-0000000000a3', '60300000-0000-4000-8000-0000000000a1', 'U-SOLO-PIN', true),
  ('60300000-0000-4000-8000-0000000000a4', '60300000-0000-4000-8000-0000000000a1', 'U-SOLO-GPS', true);
insert into public.posicion (tenant_id, unidad_id, lat, lng, medida_en, proveedor) values
  -- U-GPS-Y-PIN: el pin es MÁS reciente que el último punto del GPS
  ('60300000-0000-4000-8000-0000000000a1', '60300000-0000-4000-8000-0000000000a2', 19.10, -99.10, now() - interval '30 minutes', 'samsara'),
  ('60300000-0000-4000-8000-0000000000a1', '60300000-0000-4000-8000-0000000000a2', 25.00, -100.00, now() - interval '5 minutes',  'whatsapp'),
  -- U-SOLO-PIN: nunca tuvo GPS
  ('60300000-0000-4000-8000-0000000000a1', '60300000-0000-4000-8000-0000000000a3', 20.00, -101.00, now() - interval '5 minutes',  'whatsapp'),
  -- U-SOLO-GPS
  ('60300000-0000-4000-8000-0000000000a1', '60300000-0000-4000-8000-0000000000a4', 21.00, -102.00, now() - interval '10 minutes', 'samsara');

do $$
declare n int; lat_u double precision; prov text; hay_pin_solo boolean;
begin
  select count(*) into n from public.ultimas_posiciones_tenant('60300000-0000-4000-8000-0000000000a1');
  if n <> 2 then raise exception '0603: ultimas_posiciones_tenant devolvió % unidades (esperaba 2: la de solo-pin ya no cuenta)', n; end if;

  select r.lat, r.proveedor into lat_u, prov from public.ultimas_posiciones_tenant('60300000-0000-4000-8000-0000000000a1') r
   where r.unidad_id = '60300000-0000-4000-8000-0000000000a2';
  if lat_u is distinct from 19.10 or prov is distinct from 'samsara' then
    raise exception '0603: con un pin más reciente la unidad debía salir en su último punto de GPS (lat=%, proveedor=%)', lat_u, prov;
  end if;

  select exists (select 1 from public.ultimas_posiciones_tenant('60300000-0000-4000-8000-0000000000a1') r
                  where r.unidad_id = '60300000-0000-4000-8000-0000000000a3') into hay_pin_solo;
  if hay_pin_solo then raise exception '0603: una unidad con solo pins de WhatsApp no debía aparecer en el mapa'; end if;

  -- otra flota no ve nada de A
  select count(*) into n from public.ultimas_posiciones_tenant('60300000-0000-4000-8000-0000000000b1');
  if n <> 0 then raise exception '0603: otra flota leyó % posiciones ajenas', n; end if;

  -- la ventana de peajes: el pin no es evidencia
  select count(*) into n from public.peaje_posiciones_ventana(
    '60300000-0000-4000-8000-0000000000a1',
    jsonb_build_array(jsonb_build_object(
      'linea_id', '60300000-0000-4000-8000-000000000f11', 'unidad_id', '60300000-0000-4000-8000-0000000000a2',
      'desde', now() - interval '2 hours', 'hasta', now())));
  if n <> 1 then raise exception '0603: la ventana de peajes devolvió % posiciones (esperaba 1: el GPS, sin el pin)', n; end if;

  -- y sigue sin devolver nada si lo pide otra flota
  select count(*) into n from public.peaje_posiciones_ventana(
    '60300000-0000-4000-8000-0000000000b1',
    jsonb_build_array(jsonb_build_object(
      'linea_id', '60300000-0000-4000-8000-000000000f11', 'unidad_id', '60300000-0000-4000-8000-0000000000a2',
      'desde', now() - interval '2 hours', 'hasta', now())));
  if n <> 0 then raise exception '0603: una flota leyó posiciones de una unidad ajena (%)', n; end if;

  -- permisos: solo service_role ejecuta
  if has_function_privilege('anon', 'public.ultimas_posiciones_tenant(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ultimas_posiciones_tenant(uuid)', 'execute')
     or has_function_privilege('anon', 'public.peaje_posiciones_ventana(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.peaje_posiciones_ventana(uuid,jsonb)', 'execute') then
    raise exception '0603: las RPC de posiciones no deben ser ejecutables por anon/authenticated';
  end if;
end $$;

rollback;
