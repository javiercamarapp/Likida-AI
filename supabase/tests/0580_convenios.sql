\set ON_ERROR_STOP on
-- 0580 — CONVENIOS DE CLIENTE E INSTRUCCIONES DE OPERACIÓN (W3 «convenios»).
--
-- Lo que SOLO la base puede demostrar, contra Postgres real:
--   (a) un convenio es único por (flota, cliente, nombre) — la llave de la
--       re-importación idempotente — y dos flotas SÍ pueden llamar igual a su convenio;
--   (b) las FK compuestas impiden colgar un convenio del cliente o de la planta de
--       OTRA flota, una instrucción del convenio de otra flota y un viaje_convenio
--       del viaje de otra flota;
--   (c) los CHECK: dominio de categoría y momento, texto acotado, vigencia
--       coherente, tarifa con modo y precio juntos, y el sello de envío con canal;
--   (d) la instrucción repetida es UNA (unique convenio+categoría+texto);
--   (e) el CLAIM del envío: dos UPDATE condicionados a «no enviado y no reclamado»
--       reclaman a lo más una vez, y un lease vencido se recupera;
--   (f) borrar el convenio deja el viaje y su foto de instrucciones (set null),
--       borrar el cliente se lleva el convenio y sus líneas (cascade);
--   (g) RLS: el dueño y el encargado de la flota A ven lo suyo y NADA de la flota B;
--       solo `ve_finanzas` lee el dinero del convenio (el encargado no); el contador
--       no ve instrucciones de operación; nadie escribe por REST.
begin;

insert into public.tenant (id, nombre) values
  ('58000000-0000-4000-8000-0000000000a1', 'Flota A 0580'),
  ('58000000-0000-4000-8000-0000000000b1', 'Flota B 0580');
insert into public.cliente (id, tenant_id, nombre) values
  ('58000000-0000-4000-8000-0000000000a2', '58000000-0000-4000-8000-0000000000a1', 'Cliente A'),
  ('58000000-0000-4000-8000-0000000000b2', '58000000-0000-4000-8000-0000000000b1', 'Cliente B');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('58000000-0000-4000-8000-0000000000a3', '58000000-0000-4000-8000-0000000000a1', 'Chofer A', '525500005801'),
  ('58000000-0000-4000-8000-0000000000b3', '58000000-0000-4000-8000-0000000000b1', 'Chofer B', '525500005802');
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, cliente_id) values
  ('58000000-0000-4000-8000-0000000000a4', '58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a3', 'A-1', 'abierto', '58000000-0000-4000-8000-0000000000a2'),
  ('58000000-0000-4000-8000-0000000000b4', '58000000-0000-4000-8000-0000000000b1', '58000000-0000-4000-8000-0000000000b3', 'B-1', 'abierto', '58000000-0000-4000-8000-0000000000b2');
insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m) values
  ('58000000-0000-4000-8000-0000000000a5', '58000000-0000-4000-8000-0000000000a1', 'Planta A', 'punto_interes', 20.72, -103.39, 300),
  ('58000000-0000-4000-8000-0000000000b5', '58000000-0000-4000-8000-0000000000b1', 'Planta B', 'punto_interes', 25.67, -100.31, 300);
insert into public.app_user (id, tenant_id, email, rol) values
  ('58000000-0000-4000-8000-0000000000c1', '58000000-0000-4000-8000-0000000000a1', 'dueno-0580@test.invalid', 'flota_admin'),
  ('58000000-0000-4000-8000-0000000000c2', '58000000-0000-4000-8000-0000000000a1', 'encargado-0580@test.invalid', 'encargado'),
  ('58000000-0000-4000-8000-0000000000c3', '58000000-0000-4000-8000-0000000000a1', 'contador-0580@test.invalid', 'contador'),
  ('58000000-0000-4000-8000-0000000000c4', '58000000-0000-4000-8000-0000000000b1', 'dueno-b-0580@test.invalid', 'flota_admin');

set local role service_role;

insert into public.cliente_convenio (id, tenant_id, cliente_id, nombre, origen, destino, origen_sitio_id) values
  ('58000000-0000-4000-8000-0000000000a6', '58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a2',
   'Zapopan → Monterrey', 'Zapopan', 'Monterrey', '58000000-0000-4000-8000-0000000000a5'),
  ('58000000-0000-4000-8000-0000000000b6', '58000000-0000-4000-8000-0000000000b1', '58000000-0000-4000-8000-0000000000b2',
   'Zapopan → Monterrey', 'Zapopan', 'Monterrey', null);
insert into public.convenio_instruccion (tenant_id, convenio_id, categoria, texto, momento, orden) values
  ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a6', 'puerta', 'Entra por la puerta 3, la de camiones.', 'ambos', 1),
  ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a6', 'reportarse', 'Repórtate con Don Luis en la caseta.', 'acercamiento', 2),
  ('58000000-0000-4000-8000-0000000000b1', '58000000-0000-4000-8000-0000000000b6', 'puerta', 'Puerta de la flota B.', 'ambos', 1);
insert into public.convenio_comercial (convenio_id, tenant_id, tarifa_modo, tarifa_precio, requisitos_cobro) values
  ('58000000-0000-4000-8000-0000000000a6', '58000000-0000-4000-8000-0000000000a1', 'por_viaje', 18500, array['Factura con orden de compra', 'POD sellado']);
insert into public.viaje_convenio (viaje_id, tenant_id, convenio_id, cliente_id, instrucciones) values
  ('58000000-0000-4000-8000-0000000000a4', '58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a6',
   '58000000-0000-4000-8000-0000000000a2', '[{"categoria":"puerta","texto":"Puerta 3","momento":"ambos","orden":1}]'::jsonb);

do $$
declare n integer; a timestamptz;
begin
  -- (a) el mismo nombre para el mismo cliente de la misma flota choca…
  begin
    insert into public.cliente_convenio (tenant_id, cliente_id, nombre)
    values ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a2', 'Zapopan → Monterrey');
    raise exception 'CONV_UNICO_0580: el convenio duplicado entró';
  exception when unique_violation then null;
  end;
  -- (b) FK compuestas: cliente, planta e instrucción de OTRA flota.
  begin
    insert into public.cliente_convenio (tenant_id, cliente_id, nombre)
    values ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000b2', 'cliente ajeno');
    raise exception 'CONV_CLIENTE_AJENO_0580: colgó un convenio del cliente de otra flota';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.cliente_convenio (tenant_id, cliente_id, nombre, origen_sitio_id)
    values ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a2', 'planta ajena', '58000000-0000-4000-8000-0000000000b5');
    raise exception 'CONV_SITIO_AJENO_0580: colgó un convenio de la planta de otra flota';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.convenio_instruccion (tenant_id, convenio_id, categoria, texto)
    values ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000b6', 'otro', 'cruzada');
    raise exception 'CONV_INSTR_AJENA_0580: una instrucción de A cuelga del convenio de B';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.viaje_convenio (viaje_id, tenant_id) values
      ('58000000-0000-4000-8000-0000000000b4', '58000000-0000-4000-8000-0000000000a1');
    raise exception 'CONV_VIAJE_AJENO_0580: ligó el viaje de otra flota';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.viaje_convenio (viaje_id, tenant_id, convenio_id) values
      ('58000000-0000-4000-8000-0000000000b4', '58000000-0000-4000-8000-0000000000b1', '58000000-0000-4000-8000-0000000000a6');
    raise exception 'CONV_CONVENIO_AJENO_0580: el viaje de B ligó el convenio de A';
  exception when foreign_key_violation then null;
  end;

  -- (c) CHECKs.
  begin
    insert into public.convenio_instruccion (tenant_id, convenio_id, categoria, texto)
    values ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a6', 'inventada', 'x');
    raise exception 'CONV_CATEGORIA_0580: aceptó una categoría inventada';
  exception when check_violation then null;
  end;
  begin
    insert into public.convenio_instruccion (tenant_id, convenio_id, categoria, texto, momento)
    values ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a6', 'otro', 'x', 'nunca');
    raise exception 'CONV_MOMENTO_0580: aceptó un momento inventado';
  exception when check_violation then null;
  end;
  begin
    insert into public.convenio_instruccion (tenant_id, convenio_id, categoria, texto)
    values ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a6', 'otro', repeat('x', 401));
    raise exception 'CONV_TEXTO_0580: aceptó un texto de 401 caracteres';
  exception when check_violation then null;
  end;
  begin
    insert into public.cliente_convenio (tenant_id, cliente_id, nombre, vigente_desde, vigente_hasta)
    values ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a2', 'al revés', '2026-12-01', '2026-01-01');
    raise exception 'CONV_VIGENCIA_0580: aceptó una vigencia al revés';
  exception when check_violation then null;
  end;
  begin
    insert into public.convenio_comercial (convenio_id, tenant_id, tarifa_modo, tarifa_precio)
    values ('58000000-0000-4000-8000-0000000000b6', '58000000-0000-4000-8000-0000000000b1', 'por_km', null);
    raise exception 'CONV_MODO_SIN_PRECIO_0580: aceptó un modo sin precio';
  exception when check_violation then null;
  end;
  begin
    insert into public.convenio_comercial (convenio_id, tenant_id, tarifa_modo, tarifa_precio)
    values ('58000000-0000-4000-8000-0000000000b6', '58000000-0000-4000-8000-0000000000b1', 'por_km', -3);
    raise exception 'CONV_PRECIO_NEGATIVO_0580: aceptó un precio negativo';
  exception when check_violation then null;
  end;
  begin
    update public.viaje_convenio set despacho_enviado_en = now() where viaje_id = '58000000-0000-4000-8000-0000000000a4';
    raise exception 'CONV_SELLO_SIN_CANAL_0580: un envío con hora y sin canal';
  exception when check_violation then null;
  end;
  begin
    update public.viaje_convenio set instrucciones = '{"no":"lista"}'::jsonb where viaje_id = '58000000-0000-4000-8000-0000000000a4';
    raise exception 'CONV_FOTO_NO_LISTA_0580: la foto de instrucciones no es una lista';
  exception when check_violation then null;
  end;

  -- (d) la instrucción repetida es una.
  begin
    insert into public.convenio_instruccion (tenant_id, convenio_id, categoria, texto)
    values ('58000000-0000-4000-8000-0000000000a1', '58000000-0000-4000-8000-0000000000a6', 'puerta', 'Entra por la puerta 3, la de camiones.');
    raise exception 'CONV_INSTR_REPETIDA_0580: la misma instrucción entró dos veces';
  exception when unique_violation then null;
  end;

  -- (a bis) dos flotas SÍ pueden llamar igual a su convenio (ya están A y B arriba).
  select count(*) into n from public.cliente_convenio where nombre = 'Zapopan → Monterrey';
  if n <> 2 then raise exception 'CONV_NOMBRE_ENTRE_FLOTAS_0580: esperaba 2 convenios homónimos, hay %', n; end if;

  -- (e) el claim del envío: el primero gana, el segundo no reclama; el lease vencido se recupera.
  update public.viaje_convenio set despacho_reclamado_en = now()
   where viaje_id = '58000000-0000-4000-8000-0000000000a4'
     and despacho_enviado_en is null
     and (despacho_reclamado_en is null or despacho_reclamado_en < now() - interval '5 minutes');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CONV_CLAIM_PRIMERO_0580: el primer reclamo no ganó (%)', n; end if;
  update public.viaje_convenio set despacho_reclamado_en = now()
   where viaje_id = '58000000-0000-4000-8000-0000000000a4'
     and despacho_enviado_en is null
     and (despacho_reclamado_en is null or despacho_reclamado_en < now() - interval '5 minutes');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CONV_CLAIM_DOBLE_0580: el segundo reclamo también ganó (%)', n; end if;
  update public.viaje_convenio set despacho_reclamado_en = now() - interval '10 minutes' where viaje_id = '58000000-0000-4000-8000-0000000000a4';
  update public.viaje_convenio set despacho_reclamado_en = now()
   where viaje_id = '58000000-0000-4000-8000-0000000000a4'
     and despacho_enviado_en is null
     and (despacho_reclamado_en is null or despacho_reclamado_en < now() - interval '5 minutes');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CONV_CLAIM_LEASE_0580: el lease vencido no se recuperó (%)', n; end if;
  -- y al cerrarlo con canal, ya no se reclama más.
  update public.viaje_convenio set despacho_enviado_en = now(), despacho_canal = 'texto' where viaje_id = '58000000-0000-4000-8000-0000000000a4';
  update public.viaje_convenio set despacho_reclamado_en = now() - interval '1 hour'
   where viaje_id = '58000000-0000-4000-8000-0000000000a4';
  update public.viaje_convenio set despacho_reclamado_en = now()
   where viaje_id = '58000000-0000-4000-8000-0000000000a4'
     and despacho_enviado_en is null
     and (despacho_reclamado_en is null or despacho_reclamado_en < now() - interval '5 minutes');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CONV_CLAIM_ENVIADO_0580: reclamó un envío ya hecho (%)', n; end if;
end $$;

-- (g) RLS desde el navegador.
reset role;
do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-0000000000c1', true);
  select count(*) into n from public.cliente_convenio;
  if n <> 1 then raise exception '0580: el dueño de A debería ver 1 convenio y ve %', n; end if;
  select count(*) into n from public.convenio_comercial;
  if n <> 1 then raise exception '0580: el dueño de A no ve el dinero de su convenio (%)', n; end if;
  if exists (select 1 from public.convenio_instruccion where tenant_id <> '58000000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.viaje_convenio where tenant_id <> '58000000-0000-4000-8000-0000000000a1') then
    raise exception '0580: el dueño de A ve instrucciones o viajes de otra flota';
  end if;
  -- el encargado despacha: ve instrucciones, NO la tarifa.
  perform set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-0000000000c2', true);
  select count(*) into n from public.convenio_instruccion;
  if n <> 2 then raise exception '0580: el encargado debería ver 2 instrucciones y ve %', n; end if;
  select count(*) into n from public.convenio_comercial;
  if n <> 0 then raise exception '0580: el encargado ve la tarifa del convenio (%)', n; end if;
  -- el contador factura: ve el dinero, no las instrucciones de operación.
  perform set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-0000000000c3', true);
  select count(*) into n from public.convenio_comercial;
  if n <> 1 then raise exception '0580: el contador no ve la tarifa (%)', n; end if;
  select count(*) into n from public.convenio_instruccion;
  if n <> 0 then raise exception '0580: el contador ve instrucciones de operación (%)', n; end if;
  -- el dueño de B no ve nada de A.
  perform set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-0000000000c4', true);
  if exists (select 1 from public.cliente_convenio where tenant_id = '58000000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.viaje_convenio where tenant_id = '58000000-0000-4000-8000-0000000000a1') then
    raise exception '0580: el dueño de B ve convenios de la flota A';
  end if;
  -- nadie escribe por REST.
  begin
    insert into public.cliente_convenio (tenant_id, cliente_id, nombre)
    values ('58000000-0000-4000-8000-0000000000b1', '58000000-0000-4000-8000-0000000000b2', 'por REST');
    raise exception '0580: un usuario autenticado escribió cliente_convenio por REST';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- (f) borrar el convenio deja el viaje y su foto; borrar el cliente se lleva el convenio y sus líneas.
set local role service_role;
do $$
declare n integer;
begin
  delete from public.cliente_convenio where id = '58000000-0000-4000-8000-0000000000a6';
  select count(*) into n from public.viaje_convenio
   where viaje_id = '58000000-0000-4000-8000-0000000000a4' and convenio_id is null and jsonb_array_length(instrucciones) = 1;
  if n <> 1 then raise exception 'CONV_BORRADO_0580: borrar el convenio no dejó la foto del viaje con convenio_id NULL (%)', n; end if;
  select count(*) into n from public.convenio_instruccion where convenio_id = '58000000-0000-4000-8000-0000000000a6';
  if n <> 0 then raise exception 'CONV_CASCADA_0580: sus instrucciones sobrevivieron (%)', n; end if;
  delete from public.cliente where id = '58000000-0000-4000-8000-0000000000b2';
  select count(*) into n from public.cliente_convenio where tenant_id = '58000000-0000-4000-8000-0000000000b1';
  if n <> 0 then raise exception 'CONV_CASCADA_CLIENTE_0580: borrar el cliente dejó su convenio (%)', n; end if;
end $$;

rollback;
