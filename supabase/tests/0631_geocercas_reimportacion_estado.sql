-- 0631 — estado y claim de la re-importación diaria de geocercas.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values
  ('63100000-0000-4000-8000-0000000000a1', 'Flota A 0631'),
  ('63100000-0000-4000-8000-0000000000b1', 'Flota B 0631');

do $$
declare
  a uuid := '63100000-0000-4000-8000-0000000000a1'; b uuid := '63100000-0000-4000-8000-0000000000b1';
  h1 text := repeat('a', 64); h2 text := repeat('b', 64);
  e record; ok boolean := false;
begin
  -- el primer claim gana; el segundo (misma ventana) no
  if not public.reclamar_importacion_geocercas(a) then raise exception '0631: el primer claim debía ganar'; end if;
  if public.reclamar_importacion_geocercas(a) then raise exception '0631: el segundo claim de la misma ventana debía perder'; end if;
  -- otra flota no espera
  if not public.reclamar_importacion_geocercas(b) then raise exception '0631: otra flota no debía esperar a la A'; end if;

  -- cerrar bien guarda la huella
  perform public.registrar_importacion_geocercas(a, 'importada', h1, 3, 1, 2, null);
  select * into e from public.geocerca_importacion_estado where tenant_id = a;
  if e.huella <> h1 or e.ultimo_resultado <> 'importada' or e.creados <> 3 or e.actualizados <> 1 or e.aproximadas <> 2 or e.ultimo_ok_en is null then
    raise exception '0631: el cierre bueno no guardó el estado (%)', to_jsonb(e);
  end if;

  -- un error NO gasta la huella buena ni borra el último ok
  perform public.registrar_importacion_geocercas(a, 'error', null, null, null, null, 'la tabla no contestó');
  select * into e from public.geocerca_importacion_estado where tenant_id = a;
  if e.huella <> h1 or e.ultimo_resultado <> 'error' or e.ultimo_error is distinct from 'la tabla no contestó' or e.ultimo_ok_en is null then
    raise exception '0631: un error pisó la huella buena (%)', to_jsonb(e);
  end if;

  -- tras un error la ventana se acorta a 60 min: con el último intento de hace 2 h se reclama aunque la ventana pedida sea de 23 h
  update public.geocerca_importacion_estado set ultimo_intento_en = clock_timestamp() - interval '2 hours' where tenant_id = a;
  if not public.reclamar_importacion_geocercas(a, 1380) then raise exception '0631: tras un error y 2 h debía poder reintentar'; end if;
  -- ...pero NO a los 10 minutos de un error
  perform public.registrar_importacion_geocercas(a, 'error', null, null, null, null, 'otra vez');
  update public.geocerca_importacion_estado set ultimo_intento_en = clock_timestamp() - interval '10 minutes' where tenant_id = a;
  if public.reclamar_importacion_geocercas(a, 1380) then raise exception '0631: a 10 min de un error no debía reintentar'; end if;

  -- tras un intento bueno, la ventana completa manda: a las 2 h NO; pasadas 24 h sí
  perform public.registrar_importacion_geocercas(a, 'sin_cambios', h2, null, null, null, null);
  select * into e from public.geocerca_importacion_estado where tenant_id = a;
  if e.huella <> h2 or e.ultimo_error is not null or e.creados <> 3 then raise exception '0631: sin_cambios no avanzó la huella o borró los conteos (%)', to_jsonb(e); end if;
  update public.geocerca_importacion_estado set ultimo_intento_en = clock_timestamp() - interval '2 hours' where tenant_id = a;
  if public.reclamar_importacion_geocercas(a, 1380) then raise exception '0631: a las 2 h de un intento bueno no debía reclamar (ventana 23 h)'; end if;
  update public.geocerca_importacion_estado set ultimo_intento_en = clock_timestamp() - interval '24 hours' where tenant_id = a;
  if not public.reclamar_importacion_geocercas(a, 1380) then raise exception '0631: a las 24 h debía poder reclamar'; end if;

  -- dominios y argumentos
  begin perform public.registrar_importacion_geocercas(a, 'inventado'); exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception '0631: aceptó un resultado inventado'; end if;
  ok := false;
  begin perform public.reclamar_importacion_geocercas(a, 0); exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception '0631: aceptó una ventana de 0 min'; end if;
  ok := false;
  begin update public.geocerca_importacion_estado set huella = 'xyz' where tenant_id = a; exception when check_violation then ok := true; end;
  if not ok then raise exception '0631: aceptó una huella que no es sha256'; end if;

  -- la lista de flotas por reimportar: solo las que tienen «mis propias tablas» ACTIVAS y ya les toca
  insert into public.conector_credencial (tenant_id, conector_id, valores_cifrados, activo) values
    (a, 'tabla_propia', 'x', true), (b, 'tabla_propia', 'x', false);
  if exists (select 1 from public.flotas_para_reimportar_geocercas(500) f where f.tenant_id = b) then
    raise exception '0631: listó una flota con la conexión apagada';
  end if;
  update public.geocerca_importacion_estado set ultimo_intento_en = clock_timestamp() where tenant_id = a;
  if exists (select 1 from public.flotas_para_reimportar_geocercas(500) f where f.tenant_id = a) then
    raise exception '0631: listó una flota cuya ventana no se cumple';
  end if;
  update public.geocerca_importacion_estado set ultimo_intento_en = clock_timestamp() - interval '25 hours' where tenant_id = a;
  if not exists (select 1 from public.flotas_para_reimportar_geocercas(500) f where f.tenant_id = a) then
    raise exception '0631: no listó una flota cuya ventana ya se cumplió';
  end if;
  delete from public.geocerca_importacion_estado where tenant_id = a;
  if not exists (select 1 from public.flotas_para_reimportar_geocercas(500) f where f.tenant_id = a) then
    raise exception '0631: no listó una flota nunca intentada';
  end if;
  ok := false;
  begin perform public.flotas_para_reimportar_geocercas(0); exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception '0631: aceptó un límite de 0'; end if;

  -- cascada con la flota
  delete from public.tenant where id = b;
  if exists (select 1 from public.geocerca_importacion_estado where tenant_id = b) then raise exception '0631: no hubo cascada al borrar la flota'; end if;
end $$;

-- deny-all: RLS activa y solo service_role ejecuta
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.geocerca_importacion_estado'::regclass) then
    raise exception '0631: la tabla de estado nació sin RLS';
  end if;
  if has_function_privilege('authenticated', 'public.reclamar_importacion_geocercas(uuid, integer)', 'execute')
     or has_function_privilege('anon', 'public.reclamar_importacion_geocercas(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.registrar_importacion_geocercas(uuid, text, text, integer, integer, integer, text)', 'execute')
     or has_function_privilege('authenticated', 'public.flotas_para_reimportar_geocercas(integer, integer)', 'execute') then
    raise exception '0631: las RPC son ejecutables por anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.reclamar_importacion_geocercas(uuid, integer)', 'execute') then
    raise exception '0631: service_role no ejecuta el claim';
  end if;
end $$;

rollback;
