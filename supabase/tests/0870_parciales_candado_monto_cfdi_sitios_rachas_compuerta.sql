\set ON_ERROR_STOP on
-- 0870 · lote «parciales» (A37-P-02, A37-P-05, A37-P-06, A37-P-08), contra Postgres REAL. Datos sintéticos; todo en una
-- transacción que se revierte.
--   (a) P-02: el monto de un gasto con xml_verificado no se puede cambiar (CU017), ni por UPDATE directo ni por la RPC de revisión;
--       sí se puede ligar el CFDI (OLD sin verificar) y escribir otras columnas; un gasto sin XML sigue corrigiéndose;
--   (b) P-05: nombres repetidos dentro del lote con otro código se devuelven como error con la línea y NO se escribe nada;
--   (c) P-06: ventana por agente+flota: una flota ruidosa no empuja fuera los fallos de otra; solo posteriores a la última ok;
--   (d) P-08: columnas de la compuerta con defaults fail-closed y rangos; (e) privilegios solo service_role.
begin;

insert into public.tenant (id, nombre) values
  ('87000000-0000-4000-8000-0000000000a1', 'Flota A 0870'),
  ('87000000-0000-4000-8000-0000000000b1', 'Flota B 0870');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('87000000-0000-4000-8000-0000000000a2', '87000000-0000-4000-8000-0000000000a1', 'Chofer A', '525500087001');
insert into public.viaje (id, tenant_id, operador_id) values
  ('87000000-0000-4000-8000-0000000000a3', '87000000-0000-4000-8000-0000000000a1', '87000000-0000-4000-8000-0000000000a2');

do $$
declare
  A constant uuid := '87000000-0000-4000-8000-0000000000a1';
  B constant uuid := '87000000-0000-4000-8000-0000000000b1';
  V constant uuid := '87000000-0000-4000-8000-0000000000a3';
  g_xml uuid; g_libre uuid; g_ligar uuid; e text; n int; r jsonb; m numeric;
begin
  -- ═════ (a) P-02 ═════
  insert into public.gasto (tenant_id, viaje_id, concepto, monto, xml_verificado, sub_total, iva_traslado)
    values (A, V, 'diesel', 1160.00, true, 1000.00, 160.00) returning id into g_xml;
  insert into public.gasto (tenant_id, viaje_id, concepto, monto) values (A, V, 'caseta', 100.00) returning id into g_libre;
  insert into public.gasto (tenant_id, viaje_id, concepto, monto) values (A, V, 'otro', 232.00) returning id into g_ligar;

  begin
    update public.gasto set monto = 1000.00 where id = g_xml;
    raise exception '(a1) debía rechazar el cambio de monto con XML verificado';
  exception when sqlstate 'CU017' then null; end;
  select monto into m from public.gasto where id = g_xml;
  if m <> 1160.00 then raise exception '(a1) el monto cambió: %', m; end if;

  -- un cambio por debajo del centavo (ruido de numeric) no se bloquea; otras columnas tampoco.
  update public.gasto set monto = 1160.001 where id = g_xml;
  update public.gasto set concepto = 'caseta' where id = g_xml;
  update public.gasto set monto = 1160.00 where id = g_xml;

  -- sin XML verificado se corrige como siempre.
  update public.gasto set monto = 120.00 where id = g_libre;
  select monto into m from public.gasto where id = g_libre;
  if m <> 120.00 then raise exception '(a2) el gasto sin XML debía corregirse'; end if;

  -- ligar el CFDI (OLD sin verificar) fija el monto del XML sin chocar con el candado.
  r := public.gasto_ligar_cfdi_campos(A, g_ligar, lower(gen_random_uuid()::text), jsonb_build_object(
    'tipo_comprobante', 'I', 'total', 232.00, 'sub_total', 200.00, 'iva_traslado', 32.00,
    'rfc_emisor', 'AAA010101AAA', 'rfc_receptor', 'BBB020202BBB', 'moneda', 'MXN'));
  if not (r->>'ligado')::boolean then raise exception '(a3) debía ligar: %', r; end if;
  -- y a partir de ahí su monto queda fijo.
  begin
    update public.gasto set monto = 231.00 where id = g_ligar;
    raise exception '(a3) debía rechazar el cambio tras ligar';
  exception when sqlstate 'CU017' then null; end;

  -- ═════ (b) P-05 ═════
  r := public.importar_sitios_conductor(A, jsonb_build_array(
    jsonb_build_object('linea', 2, 'codigo', 'S1', 'nombre', 'Patio Norte', 'tipo', 'punto_interes', 'lat', 19.4, 'lng', -99.1, 'radio_m', 200),
    jsonb_build_object('linea', 3, 'codigo', 'S2', 'nombre', 'Patio Norte', 'tipo', 'punto_interes', 'lat', 19.5, 'lng', -99.2, 'radio_m', 200)));
  if (r->>'ok')::boolean then raise exception '(b1) el nombre repetido en el lote debía rechazarse: %', r; end if;
  if jsonb_array_length(r->'errores') <> 2 then raise exception '(b1) un error por línea repetida: %', r; end if;
  select count(*) into n from public.geocerca where tenant_id = A;
  if n <> 0 then raise exception '(b1) no debía escribir nada, hay % sitios', n; end if;
  -- mismo nombre Y mismo código en dos líneas NO es choque (upsert dos veces).
  r := public.importar_sitios_conductor(A, jsonb_build_array(
    jsonb_build_object('linea', 2, 'codigo', 'S1', 'nombre', 'Patio Norte', 'tipo', 'punto_interes', 'lat', 19.4, 'lng', -99.1, 'radio_m', 200),
    jsonb_build_object('linea', 3, 'codigo', 'S1', 'nombre', 'Patio Norte', 'tipo', 'punto_interes', 'lat', 19.4, 'lng', -99.1, 'radio_m', 200)));
  if not (r->>'ok')::boolean then raise exception '(b2) mismo código y nombre debía pasar: %', r; end if;
  -- nombres distintos pasan.
  r := public.importar_sitios_conductor(A, jsonb_build_array(
    jsonb_build_object('linea', 2, 'codigo', 'S3', 'nombre', 'Patio Sur', 'tipo', 'punto_interes', 'lat', 19.4, 'lng', -99.1, 'radio_m', 200),
    jsonb_build_object('linea', 3, 'codigo', 'S4', 'nombre', 'Patio Este', 'tipo', 'punto_interes', 'lat', 19.5, 'lng', -99.2, 'radio_m', 200)));
  if not (r->>'ok')::boolean then raise exception '(b3) nombres distintos debía pasar: %', r; end if;

  -- ═════ (c) P-06 ═════
  -- Flota A: ruidosa (60 fallos de 'conductores'); flota B: 1 fallo de 'conductores'. Con una ventana global de 50 el de B se perdería.
  insert into public.agente_corrida (tenant_id, agente, inicio, estado, error)
    select A, 'conductores', timestamptz '2026-10-01 00:00:00+00' + (i || ' minutes')::interval, 'fallo', 'ruido'
      from generate_series(1, 60) i;
  insert into public.agente_corrida (tenant_id, agente, inicio, estado, error)
    values (B, 'conductores', '2026-09-30 10:00:00+00', 'fallo', 'solo B');
  select count(*) into n from public.corridas_fallidas_por_grupo(5, 2000) where tenant_id = B;
  if n <> 1 then raise exception '(c1) el fallo de la flota B debía aparecer: %', n; end if;
  select count(*) into n from public.corridas_fallidas_por_grupo(5, 2000) where tenant_id = A;
  if n <> 5 then raise exception '(c2) tope por grupo de 5: %', n; end if;
  -- una corrida ok posterior rompe la racha de ESA flota y no la de la otra.
  insert into public.agente_corrida (tenant_id, agente, inicio, estado) values (A, 'conductores', '2026-10-02 00:00:00+00', 'ok');
  select count(*) into n from public.corridas_fallidas_por_grupo(5, 2000) where tenant_id = A;
  if n <> 0 then raise exception '(c3) tras un ok posterior la racha de A se rompe: %', n; end if;
  select count(*) into n from public.corridas_fallidas_por_grupo(5, 2000) where tenant_id = B;
  if n <> 1 then raise exception '(c3) el ok de A no rompe la racha de B: %', n; end if;
  select ultimo_sin_fallo is null into e from public.corridas_fallidas_por_grupo(5, 2000) where tenant_id = B;
  if e <> 'true' then raise exception '(c4) B nunca ha salido bien: ultimo_sin_fallo debe ser null'; end if;

  -- ═════ (d) P-08 ═════
  insert into public.agente_conductor_config (tenant_id) values (A);
  if (select compuerta_movimiento_activa from public.agente_conductor_config where tenant_id = A) is not false then
    raise exception '(d1) la compuerta debe nacer apagada';
  end if;
  if (select detenida_metros from public.agente_conductor_config where tenant_id = A) <> 150
     or (select detenida_ventana_min from public.agente_conductor_config where tenant_id = A) <> 5
     or (select sin_gps_permite from public.agente_conductor_config where tenant_id = A) is not false then
    raise exception '(d1) defaults de la compuerta';
  end if;
  begin
    update public.agente_conductor_config set detenida_metros = 5 where tenant_id = A;
    raise exception '(d2) metros fuera de rango debía rechazarse';
  exception when check_violation then null; end;
  begin
    update public.agente_conductor_config set detenida_ventana_min = 61 where tenant_id = A;
    raise exception '(d2) ventana fuera de rango debía rechazarse';
  exception when check_violation then null; end;
  update public.agente_conductor_config set compuerta_movimiento_activa = true, detenida_metros = 200 where tenant_id = A;
end $$;

-- ═════ (e) privilegios: solo service_role ═════
do $$
begin
  if has_function_privilege('anon', 'public.corridas_fallidas_por_grupo(integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.corridas_fallidas_por_grupo(integer,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.corridas_fallidas_por_grupo(integer,integer)', 'execute') then
    raise exception '(e) privilegios de corridas_fallidas_por_grupo';
  end if;
  if has_function_privilege('anon', 'public.importar_sitios_conductor(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.importar_sitios_conductor(uuid,jsonb)', 'execute') then
    raise exception '(e) privilegios de importar_sitios_conductor';
  end if;
end $$;

rollback;
\echo '0870: OK'
