\set ON_ERROR_STOP on
-- 0798 — Vigía: servicio al cliente, turnos y festivos, prioridad, intención «datos_unidad» y «solo avisar» contra Postgres
-- REAL. Datos sintéticos, rollback. Lo que solo la base garantiza:
--   (a) servicio al cliente: teléfono 52+10 dígitos, algún canal, único por flota y teléfono / correo (sin importar mayúsculas),
--       tope de 10 por flota, cliente de OTRA flota rebota, alta/corrección/baja por RPC (con tope y aislamiento por flota);
--   (b) turno del director: nace 'siempre' (nada cambia sin código nuevo) y rebota valores inventados; festivos únicos por fecha;
--   (c) prioridad en conversación y mensaje: nace 0 y solo admite 0..2;
--   (d) el CHECK de intención acepta 'datos_unidad' y las 9 de siempre, y rechaza otra;
--   (e) solo_avisar nace true;
--   (f) RLS: la flota ve lo suyo y no lo de otra, el contador no ve nada, nadie escribe por REST ni ejecuta las RPC;
--   (g) borrar al cliente se lleva su contacto de servicio; borrar la flota se lleva todo.
begin;

insert into public.tenant (id, nombre) values
  ('07980000-0000-4000-8000-0000000000a1', 'Flota A 0798'),
  ('07980000-0000-4000-8000-0000000000b1', 'Flota B 0798');
insert into public.app_user (id, tenant_id, email, rol) values
  ('07980000-0000-4000-8000-0000000000c1', '07980000-0000-4000-8000-0000000000a1', 'dueno-0798@test.invalid', 'flota_admin'),
  ('07980000-0000-4000-8000-0000000000c3', '07980000-0000-4000-8000-0000000000a1', 'contador-0798@test.invalid', 'contador'),
  ('07980000-0000-4000-8000-0000000000c4', '07980000-0000-4000-8000-0000000000b1', 'dueno-b-0798@test.invalid', 'flota_admin');
insert into public.cliente (id, tenant_id, nombre) values
  ('07980000-0000-4000-8000-0000000000f1', '07980000-0000-4000-8000-0000000000a1', 'Cliente Demo 1'),
  ('07980000-0000-4000-8000-0000000000f3', '07980000-0000-4000-8000-0000000000b1', 'Cliente Demo 3');

set local role service_role;

-- (a) servicio al cliente: tabla
do $$
declare v_id uuid; v_id2 uuid; v_n integer; i integer;
begin
  insert into public.vigia_servicio_cliente (tenant_id, nombre, telefono) values
    ('07980000-0000-4000-8000-0000000000a1', 'Servicio Demo 1', '525500000001'); -- grep-limpio:ok
  -- teléfono mal formado
  begin
    insert into public.vigia_servicio_cliente (tenant_id, nombre, telefono) values ('07980000-0000-4000-8000-0000000000a1', 'X', '5500000001'); -- grep-limpio:ok
    raise exception '0798(a): teléfono sin 52 aceptado';
  exception when check_violation then null; end;
  -- ningún canal
  begin
    insert into public.vigia_servicio_cliente (tenant_id, nombre) values ('07980000-0000-4000-8000-0000000000a1', 'Sin canal');
    raise exception '0798(a): contacto sin teléfono ni correo aceptado';
  exception when check_violation then null; end;
  -- correo mal formado
  begin
    insert into public.vigia_servicio_cliente (tenant_id, nombre, correo) values ('07980000-0000-4000-8000-0000000000a1', 'X', 'no-es-correo');
    raise exception '0798(a): correo mal formado aceptado';
  exception when check_violation then null; end;
  -- nombre vacío
  begin
    insert into public.vigia_servicio_cliente (tenant_id, nombre, telefono) values ('07980000-0000-4000-8000-0000000000a1', '   ', '525500000002'); -- grep-limpio:ok
    raise exception '0798(a): nombre vacío aceptado';
  exception when check_violation then null; end;
  -- mismo teléfono en la misma flota
  begin
    insert into public.vigia_servicio_cliente (tenant_id, nombre, telefono) values ('07980000-0000-4000-8000-0000000000a1', 'Otro', '525500000001'); -- grep-limpio:ok
    raise exception '0798(a): teléfono repetido en la flota';
  exception when unique_violation then null; end;
  -- mismo teléfono en OTRA flota: sí
  insert into public.vigia_servicio_cliente (tenant_id, nombre, telefono) values ('07980000-0000-4000-8000-0000000000b1', 'Servicio B', '525500000001'); -- grep-limpio:ok
  -- mismo correo con otras mayúsculas
  insert into public.vigia_servicio_cliente (tenant_id, nombre, correo) values ('07980000-0000-4000-8000-0000000000a1', 'Correo 1', 'Servicio@Demo.test');
  begin
    insert into public.vigia_servicio_cliente (tenant_id, nombre, correo) values ('07980000-0000-4000-8000-0000000000a1', 'Correo 2', 'servicio@demo.TEST');
    raise exception '0798(a): correo repetido con otras mayúsculas';
  exception when unique_violation then null; end;
  -- cliente de otra flota
  begin
    insert into public.vigia_servicio_cliente (tenant_id, cliente_id, nombre, telefono)
    values ('07980000-0000-4000-8000-0000000000a1', '07980000-0000-4000-8000-0000000000f3', 'Cruzado', '525500000003'); -- grep-limpio:ok
    raise exception '0798(a): cliente de otra flota aceptado';
  exception when foreign_key_violation then null; end;
  -- cliente de la propia flota
  insert into public.vigia_servicio_cliente (tenant_id, cliente_id, nombre, telefono)
  values ('07980000-0000-4000-8000-0000000000a1', '07980000-0000-4000-8000-0000000000f1', 'Solo Cliente 1', '525500000004'); -- grep-limpio:ok
  select count(*) into v_n from public.vigia_servicio_cliente where tenant_id = '07980000-0000-4000-8000-0000000000a1';
  if v_n <> 3 then raise exception '0798(a): la flota A debía tener 3 contactos, tiene %', v_n; end if;
  if (select activo from public.vigia_servicio_cliente where telefono = '525500000004' and tenant_id = '07980000-0000-4000-8000-0000000000a1') is not true then -- grep-limpio:ok
    raise exception '0798(a): el contacto no nace activo';
  end if;

  -- RPC: alta, corrección, baja
  v_id := public.vigia_servicio_guardar('07980000-0000-4000-8000-0000000000a1', null, null, '  Guardia Demo  ', '525500000010', '', true, null); -- grep-limpio:ok
  if (select nombre from public.vigia_servicio_cliente where id = v_id) <> 'Guardia Demo' then raise exception '0798(a): el alta no recortó el nombre'; end if;
  if (select correo from public.vigia_servicio_cliente where id = v_id) is not null then raise exception '0798(a): correo vacío no se guardó como null'; end if;
  v_id2 := public.vigia_servicio_guardar('07980000-0000-4000-8000-0000000000a1', v_id, '07980000-0000-4000-8000-0000000000f1', 'Guardia Demo', '525500000010', 'g@demo.test', false, null); -- grep-limpio:ok
  if v_id2 <> v_id then raise exception '0798(a): la corrección cambió el id'; end if;
  if (select activo or correo is distinct from 'g@demo.test' or cliente_id is null from public.vigia_servicio_cliente where id = v_id) then
    raise exception '0798(a): la corrección no dejó activo=false, correo y cliente';
  end if;
  -- corregir una fila de OTRA flota
  begin
    perform public.vigia_servicio_guardar('07980000-0000-4000-8000-0000000000b1', v_id, null, 'Robo', '525500000099', null, true, null); -- grep-limpio:ok
    raise exception '0798(a): se corrigió el contacto de otra flota';
  exception when sqlstate 'P0002' then null; end;
  -- flota inexistente
  begin
    perform public.vigia_servicio_guardar(gen_random_uuid(), null, null, 'X', '525500000098', null, true, null); -- grep-limpio:ok
    raise exception '0798(a): alta en una flota inexistente';
  exception when sqlstate '22023' then null; end;
  -- baja: de otra flota no; de la propia sí; dos veces no
  if public.vigia_servicio_quitar('07980000-0000-4000-8000-0000000000b1', v_id) then raise exception '0798(a): se quitó el contacto de otra flota'; end if;
  if not public.vigia_servicio_quitar('07980000-0000-4000-8000-0000000000a1', v_id) then raise exception '0798(a): no se pudo quitar el contacto propio'; end if;
  if public.vigia_servicio_quitar('07980000-0000-4000-8000-0000000000a1', v_id) then raise exception '0798(a): se quitó dos veces'; end if;

  -- tope de 10 por flota (la A tiene 3 aquí): se llena con la RPC y el 11.º rebota
  for i in 1..7 loop
    perform public.vigia_servicio_guardar('07980000-0000-4000-8000-0000000000a1', null, null, 'Relleno ' || i, '5255000001' || lpad(i::text, 2, '0'), null, true, null); -- grep-limpio:ok
  end loop;
  select count(*) into v_n from public.vigia_servicio_cliente where tenant_id = '07980000-0000-4000-8000-0000000000a1';
  if v_n <> 10 then raise exception '0798(a): la flota A debía tener 10, tiene %', v_n; end if;
  begin
    perform public.vigia_servicio_guardar('07980000-0000-4000-8000-0000000000a1', null, null, 'Once', '525500000199', null, true, null); -- grep-limpio:ok
    raise exception '0798(a): el contacto 11 entró';
  exception when sqlstate '54000' then null; end;
  -- corregir uno existente con la flota llena sí se puede
  perform public.vigia_servicio_guardar('07980000-0000-4000-8000-0000000000a1',
    (select id from public.vigia_servicio_cliente where telefono = '525500000101' and tenant_id = '07980000-0000-4000-8000-0000000000a1'), -- grep-limpio:ok
    null, 'Relleno 1 corregido', '525500000101', null, true, null); -- grep-limpio:ok
  -- el tope es por flota: la B sigue pudiendo
  perform public.vigia_servicio_guardar('07980000-0000-4000-8000-0000000000b1', null, null, 'B 2', '525500000201', null, true, null); -- grep-limpio:ok
end $$;

-- (b) turno y festivos
do $$
declare v_dir uuid;
begin
  v_dir := public.vigia_director_guardar('07980000-0000-4000-8000-0000000000a1', null, 1, 'Gerente Demo', '525500000301', null, null); -- grep-limpio:ok
  if (select turno from public.vigia_director where id = v_dir) <> 'siempre' then
    raise exception '0798(b): el director no nace con turno siempre';
  end if;
  update public.vigia_director set turno = 'noche' where id = v_dir;
  update public.vigia_director set turno = 'festivos_y_fin_de_semana' where id = v_dir;
  update public.vigia_director set turno = 'siempre' where id = v_dir;
  begin
    update public.vigia_director set turno = 'madrugada' where id = v_dir;
    raise exception '0798(b): turno inventado aceptado';
  exception when check_violation then null; end;
  begin
    update public.vigia_director set turno = null where id = v_dir;
    raise exception '0798(b): turno nulo aceptado';
  exception when not_null_violation then null; end;
  -- vigia_director_guardar sigue intacta: corrige sin tocar el turno
  update public.vigia_director set turno = 'noche' where id = v_dir;
  perform public.vigia_director_guardar('07980000-0000-4000-8000-0000000000a1', v_dir, 1, 'Gerente Demo 2', '525500000301', null, null); -- grep-limpio:ok
  if (select turno from public.vigia_director where id = v_dir) <> 'noche' then
    raise exception '0798(b): vigia_director_guardar pisó el turno';
  end if;

  insert into public.vigia_festivo (tenant_id, fecha, nombre) values ('07980000-0000-4000-8000-0000000000a1', date '2026-12-25', 'Navidad');
  insert into public.vigia_festivo (tenant_id, fecha, nombre) values ('07980000-0000-4000-8000-0000000000b1', date '2026-12-25', 'Navidad');
  begin
    insert into public.vigia_festivo (tenant_id, fecha, nombre) values ('07980000-0000-4000-8000-0000000000a1', date '2026-12-25', 'Otra vez');
    raise exception '0798(b): dos festivos en la misma fecha y flota';
  exception when unique_violation then null; end;
  begin
    insert into public.vigia_festivo (tenant_id, fecha, nombre) values ('07980000-0000-4000-8000-0000000000a1', date '2026-12-26', '  ');
    raise exception '0798(b): festivo sin nombre aceptado';
  exception when check_violation then null; end;
end $$;

-- (c) prioridad, (d) intención, (e) solo_avisar
insert into public.vigia_contacto (id, tenant_id, cliente_id, telefono, telefono_hash, nombre, consentimiento_en, consentimiento_origen) values
  ('07980000-0000-4000-8000-0000000000d1', '07980000-0000-4000-8000-0000000000a1', '07980000-0000-4000-8000-0000000000f1',
   '525511110001', repeat('a', 64), 'Compras Demo 1', now(), 'alta_flota'); -- grep-limpio:ok
insert into public.vigia_conversacion (id, tenant_id, contacto_id, cliente_id) values
  ('07980000-0000-4000-8000-0000000000e1', '07980000-0000-4000-8000-0000000000a1', '07980000-0000-4000-8000-0000000000d1', '07980000-0000-4000-8000-0000000000f1');
do $$
declare r text; v_msg uuid;
begin
  if (select prioridad from public.vigia_conversacion where id = '07980000-0000-4000-8000-0000000000e1') <> 0 then
    raise exception '0798(c): la conversación no nace con prioridad 0';
  end if;
  update public.vigia_conversacion set prioridad = 2 where id = '07980000-0000-4000-8000-0000000000e1';
  begin
    update public.vigia_conversacion set prioridad = 3 where id = '07980000-0000-4000-8000-0000000000e1';
    raise exception '0798(c): prioridad 3 aceptada en la conversación';
  exception when check_violation then null; end;
  begin
    update public.vigia_conversacion set prioridad = -1 where id = '07980000-0000-4000-8000-0000000000e1';
    raise exception '0798(c): prioridad negativa aceptada en la conversación';
  exception when check_violation then null; end;

  insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, texto, estado)
  values ('07980000-0000-4000-8000-0000000000a1', '07980000-0000-4000-8000-0000000000e1', 'entrante', 'cliente', 'hola', 'recibido')
  returning id into v_msg;
  if (select prioridad from public.vigia_mensaje where id = v_msg) <> 0 then raise exception '0798(c): el mensaje no nace con prioridad 0'; end if;
  update public.vigia_mensaje set prioridad = 1 where id = v_msg;
  begin
    update public.vigia_mensaje set prioridad = 3 where id = v_msg;
    raise exception '0798(c): prioridad 3 aceptada en el mensaje';
  exception when check_violation then null; end;

  -- (d) las nueve de siempre, la nueva y nula
  foreach r in array array['ubicacion', 'eta', 'documentos', 'factura_pod', 'queja', 'pide_humano', 'baja', 'saludo', 'otro', 'datos_unidad'] loop
    update public.vigia_mensaje set intencion = r where id = v_msg;
  end loop;
  update public.vigia_mensaje set intencion = null where id = v_msg;
  begin
    update public.vigia_mensaje set intencion = 'cotizacion' where id = v_msg;
    raise exception '0798(d): intención inventada aceptada';
  exception when check_violation then null; end;
  -- el CHECK es de verdad el de la lista completa (ni más ni menos)
  if (select count(*) from pg_constraint where conname = 'vigia_mensaje_intencion_dominio' and conrelid = 'public.vigia_mensaje'::regclass) <> 1 then
    raise exception '0798(d): no hay exactamente un CHECK de intención';
  end if;

  -- (e) solo_avisar
  insert into public.vigia_config (tenant_id) values ('07980000-0000-4000-8000-0000000000a1');
  if (select solo_avisar from public.vigia_config where tenant_id = '07980000-0000-4000-8000-0000000000a1') is not true then
    raise exception '0798(e): solo_avisar no nace en true';
  end if;
  begin
    update public.vigia_config set solo_avisar = null where tenant_id = '07980000-0000-4000-8000-0000000000a1';
    raise exception '0798(e): solo_avisar nulo aceptado';
  exception when not_null_violation then null; end;
end $$;

-- (f) RLS
reset role;
do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07980000-0000-4000-8000-0000000000c1', true);
  select count(*) into n from public.vigia_servicio_cliente;
  if n = 0 then raise exception '0798(f): el dueño de la flota A no ve su servicio al cliente'; end if;
  if exists (select 1 from public.vigia_servicio_cliente where tenant_id <> '07980000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_festivo where tenant_id <> '07980000-0000-4000-8000-0000000000a1') then
    raise exception '0798(f): el dueño de la flota A ve datos de otra flota';
  end if;
  select count(*) into n from public.vigia_festivo;
  if n <> 1 then raise exception '0798(f): el dueño de la flota A ve % festivos (debía ser 1)', n; end if;
  -- el contador no atiende clientes: no ve nada
  perform set_config('request.jwt.claim.sub', '07980000-0000-4000-8000-0000000000c3', true);
  select count(*) into n from public.vigia_servicio_cliente;
  if n <> 0 then raise exception '0798(f): el contador ve servicio al cliente (%)', n; end if;
  select count(*) into n from public.vigia_festivo;
  if n <> 0 then raise exception '0798(f): el contador ve festivos (%)', n; end if;
  -- el dueño de B no ve lo de A
  perform set_config('request.jwt.claim.sub', '07980000-0000-4000-8000-0000000000c4', true);
  if exists (select 1 from public.vigia_servicio_cliente where tenant_id = '07980000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_festivo where tenant_id = '07980000-0000-4000-8000-0000000000a1') then
    raise exception '0798(f): el dueño de la flota B ve datos de la flota A';
  end if;
  -- nadie escribe por REST ni ejecuta las funciones
  begin
    insert into public.vigia_servicio_cliente (tenant_id, nombre, telefono) values ('07980000-0000-4000-8000-0000000000b1', 'REST', '525500000777'); -- grep-limpio:ok
    raise exception '0798(f): un usuario autenticado escribió servicio al cliente por REST';
  exception when insufficient_privilege then null; end;
  begin
    update public.vigia_servicio_cliente set activo = false;
    raise exception '0798(f): un usuario autenticado cambió servicio al cliente por REST';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.vigia_servicio_cliente;
    raise exception '0798(f): un usuario autenticado borró servicio al cliente por REST';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.vigia_festivo (tenant_id, fecha, nombre) values ('07980000-0000-4000-8000-0000000000b1', date '2026-01-01', 'REST');
    raise exception '0798(f): un usuario autenticado escribió un festivo por REST';
  exception when insufficient_privilege then null; end;
  begin
    perform public.vigia_servicio_guardar('07980000-0000-4000-8000-0000000000b1', null, null, 'REST', '525500000778', null, true, null); -- grep-limpio:ok
    raise exception '0798(f): un usuario autenticado ejecutó vigia_servicio_guardar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.vigia_servicio_quitar('07980000-0000-4000-8000-0000000000b1', gen_random_uuid());
    raise exception '0798(f): un usuario autenticado ejecutó vigia_servicio_quitar';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- (g) borrados (con el dueño de la base)
do $$
begin
  -- borrar al cliente se lleva el contacto de servicio ligado a él, y deja los de «todos los clientes»
  delete from public.cliente where id = '07980000-0000-4000-8000-0000000000f1';
  if exists (select 1 from public.vigia_servicio_cliente where cliente_id = '07980000-0000-4000-8000-0000000000f1') then
    raise exception '0798(g): borrar al cliente dejó su contacto de servicio';
  end if;
  if not exists (select 1 from public.vigia_servicio_cliente where tenant_id = '07980000-0000-4000-8000-0000000000a1' and cliente_id is null) then
    raise exception '0798(g): borrar al cliente se llevó los contactos de «todos los clientes»';
  end if;
  -- borrar la flota se lleva todo, sin tocar a la otra
  delete from public.tenant where id = '07980000-0000-4000-8000-0000000000a1';
  if exists (select 1 from public.vigia_servicio_cliente where tenant_id = '07980000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_festivo where tenant_id = '07980000-0000-4000-8000-0000000000a1') then
    raise exception '0798(g): quedaron datos de una flota borrada';
  end if;
  if not exists (select 1 from public.vigia_servicio_cliente where tenant_id = '07980000-0000-4000-8000-0000000000b1')
     or not exists (select 1 from public.vigia_festivo where tenant_id = '07980000-0000-4000-8000-0000000000b1') then
    raise exception '0798(g): borrar la flota A tocó a la flota B';
  end if;
end $$;

rollback;
