-- 0652 — el claim del barrido de salud de los agentes: una flota por ventana, el error acorta el reintento y nada se cruza.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values
  ('65200000-0000-4000-8000-0000000000a1', 'Flota A 0652'),
  ('65200000-0000-4000-8000-0000000000b1', 'Flota B 0652');

do $$
declare
  A constant uuid := '65200000-0000-4000-8000-0000000000a1';
  B constant uuid := '65200000-0000-4000-8000-0000000000b1';
  r1 uuid[]; r2 uuid[]; r3 uuid[]; r4 uuid[]; r5 uuid[];
  rebota boolean;
  e record;
begin
  -- (1) la primera pasada toma a las dos (nunca barridas) y la segunda, a ninguna: el claim ya las selló.
  select coalesce(array_agg(tenant_id), '{}') into r1 from public.reclamar_flotas_barrido_orquestador(500, 30);
  if not (A = any(r1) and B = any(r1)) then raise exception '0652: la primera pasada debía tomar A y B: %', r1; end if;
  select coalesce(array_agg(tenant_id), '{}') into r2 from public.reclamar_flotas_barrido_orquestador(500, 30);
  if A = any(r2) or B = any(r2) then raise exception '0652: la segunda pasada repitió flotas: %', r2; end if;

  -- (2) un resultado bueno respeta la ventana completa; vencida, la flota vuelve.
  perform public.registrar_barrido_orquestador(A, 'ok', 2, 1, null);
  update public.orquestador_barrido_estado set ultimo_barrido_en = clock_timestamp() - interval '20 minutes' where tenant_id = A;
  select coalesce(array_agg(tenant_id), '{}') into r3 from public.reclamar_flotas_barrido_orquestador(500, 30);
  if A = any(r3) then raise exception '0652: a los 20 min (ventana 30) la flota ya no debía tocar: %', r3; end if;
  update public.orquestador_barrido_estado set ultimo_barrido_en = clock_timestamp() - interval '40 minutes' where tenant_id = A;
  select coalesce(array_agg(tenant_id), '{}') into r3 from public.reclamar_flotas_barrido_orquestador(500, 30);
  if not (A = any(r3)) then raise exception '0652: a los 40 min la flota debía volver a tocar: %', r3; end if;

  -- (3) un error acorta el reintento a 10 min (no espera la ventana entera).
  perform public.registrar_barrido_orquestador(B, 'error', 0, 0, 'no pudo leer');
  update public.orquestador_barrido_estado set ultimo_barrido_en = clock_timestamp() - interval '12 minutes' where tenant_id = B;
  select coalesce(array_agg(tenant_id), '{}') into r4 from public.reclamar_flotas_barrido_orquestador(500, 30);
  if not (B = any(r4)) then raise exception '0652: tras un error y 12 min la flota debía reintentarse: %', r4; end if;

  -- (4) el registro guarda lo medido, y un resultado bueno borra el error anterior.
  perform public.registrar_barrido_orquestador(B, 'error', 0, 0, repeat('x', 400));
  select * into e from public.orquestador_barrido_estado where tenant_id = B;
  if e.ultimo_resultado <> 'error' or char_length(e.ultimo_error) <> 300 then raise exception '0652: el error no se guardó acotado (%)', char_length(e.ultimo_error); end if;
  perform public.registrar_barrido_orquestador(B, 'ok', 3, 2, null);
  select * into e from public.orquestador_barrido_estado where tenant_id = B;
  if e.ultimo_error is not null or e.abiertas <> 3 or e.cerradas <> 2 then raise exception '0652: el resultado bueno no limpió el error'; end if;

  -- (4b) respeta el límite.
  update public.orquestador_barrido_estado set ultimo_barrido_en = clock_timestamp() - interval '2 days';
  select coalesce(array_agg(tenant_id), '{}') into r5 from public.reclamar_flotas_barrido_orquestador(1, 30);
  if cardinality(r5) <> 1 then raise exception '0652: p_limite=1 devolvió %', cardinality(r5); end if;

  -- (5) argumentos fuera de dominio rebotan.
  rebota := false;
  begin perform public.reclamar_flotas_barrido_orquestador(0, 30); exception when sqlstate '22023' then rebota := true; end;
  if not rebota then raise exception '0652: límite 0 entró'; end if;
  rebota := false;
  begin perform public.registrar_barrido_orquestador(A, 'inventado'); exception when sqlstate '22023' then rebota := true; end;
  if not rebota then raise exception '0652: resultado inventado entró'; end if;

  -- (6) solo service_role ejecuta; anon y authenticated no.
  if has_function_privilege('anon', 'public.reclamar_flotas_barrido_orquestador(integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.reclamar_flotas_barrido_orquestador(integer, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.reclamar_flotas_barrido_orquestador(integer, integer)', 'execute') then
    raise exception '0652: permisos de ejecución incorrectos';
  end if;
  if has_table_privilege('authenticated', 'public.orquestador_barrido_estado', 'select') then raise exception '0652: authenticated lee la tabla'; end if;
end $$;

rollback;
