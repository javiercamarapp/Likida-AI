\set ON_ERROR_STOP on
-- 0796 — Datos del viaje (cajas, captura manual, política de datos) contra Postgres REAL. Datos sintéticos, rollback.
-- Lo que solo la base garantiza:
--   (a) la caja es única por flota y número sin importar mayúsculas ni espacios en los extremos; otra flota sí puede repetirla;
--       placas, estado y fuente rebotan valores inventados;
--   (b) la captura manual es única por fila del programa, el teléfono exige 52 + 10 dígitos, las placas y el estado de caja
--       rebotan valores inventados, y no se puede colgar de una fila ni de un operador de OTRA flota;
--   (c) borrar la fila del programa o al operador borra su captura manual; borrar la flota se lleva todo;
--   (d) la política: una general y una por cliente por campo; la del cliente manda sobre la general; sin regla manda el
--       valor por defecto (conservador para el operador);
--   (e) RLS: otra flota no lee; quien no atiende clientes (contador) no lee; nadie escribe por REST ni ejecuta la función.
begin;

insert into public.tenant (id, nombre) values
  ('07960000-0000-4000-8000-0000000000a1', 'Flota A 0796'),
  ('07960000-0000-4000-8000-0000000000b1', 'Flota B 0796');
insert into public.app_user (id, tenant_id, email, rol) values
  ('07960000-0000-4000-8000-0000000000c1', '07960000-0000-4000-8000-0000000000a1', 'dueno-0796@test.invalid', 'flota_admin'),
  ('07960000-0000-4000-8000-0000000000c3', '07960000-0000-4000-8000-0000000000a1', 'contador-0796@test.invalid', 'contador'),
  ('07960000-0000-4000-8000-0000000000c4', '07960000-0000-4000-8000-0000000000b1', 'dueno-b-0796@test.invalid', 'flota_admin');
insert into public.cliente (id, tenant_id, nombre) values
  ('07960000-0000-4000-8000-0000000000f1', '07960000-0000-4000-8000-0000000000a1', 'Cliente Uno 0796'),
  ('07960000-0000-4000-8000-0000000000f2', '07960000-0000-4000-8000-0000000000a1', 'Cliente Dos 0796'),
  ('07960000-0000-4000-8000-0000000000f3', '07960000-0000-4000-8000-0000000000b1', 'Cliente B 0796');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('07960000-0000-4000-8000-0000000000a9', '07960000-0000-4000-8000-0000000000a1', 'Operador Uno 0796', '521000000001'), -- grep-limpio:ok
  ('07960000-0000-4000-8000-0000000000aa', '07960000-0000-4000-8000-0000000000a1', 'Operador Dos 0796', '521000000002'), -- grep-limpio:ok
  ('07960000-0000-4000-8000-0000000000b9', '07960000-0000-4000-8000-0000000000b1', 'Operador B 0796', '521000000003'); -- grep-limpio:ok

set local role service_role;

-- las filas del programa (0795) a las que se cuelgan las capturas
insert into public.programa_despacho_fila (id, tenant_id, terminal, fecha, tipo, num, clave_natural, huella) values
  ('07960000-0000-4000-8000-0000000000e1', '07960000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'EXPORTACION', 1, 'T1|2026-10-05|EXPORTACION||1', 'huella-uno'),
  ('07960000-0000-4000-8000-0000000000e2', '07960000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'EXPORTACION', 2, 'T1|2026-10-05|EXPORTACION||2', 'huella-dos'),
  ('07960000-0000-4000-8000-0000000000e3', '07960000-0000-4000-8000-0000000000b1', 'T1', date '2026-10-05', 'EXPORTACION', 1, 'T1|2026-10-05|EXPORTACION||1', 'huella-tres');

-- (a) catálogo de cajas
do $$
begin
  insert into public.vigia_caja (tenant_id, numero, linea, placas, estado, fuente)
  values ('07960000-0000-4000-8000-0000000000a1', 'C-0101', 'L1', 'AB-123-C', 'vacia', 'csv');
  begin
    insert into public.vigia_caja (tenant_id, numero) values ('07960000-0000-4000-8000-0000000000a1', 'C-0101');
    raise exception '0796(a): la misma caja entró dos veces';
  exception when unique_violation then null; end;
  begin
    insert into public.vigia_caja (tenant_id, numero) values ('07960000-0000-4000-8000-0000000000a1', '  c-0101 ');
    raise exception '0796(a): la caja entró otra vez con otras mayúsculas y espacios';
  exception when unique_violation then null; end;
  -- otra flota sí puede tener el mismo número
  insert into public.vigia_caja (tenant_id, numero) values ('07960000-0000-4000-8000-0000000000b1', 'C-0101');
  -- ceros a la izquierda: 00777 y 777 son cajas distintas (texto, no número)
  insert into public.vigia_caja (tenant_id, numero) values
    ('07960000-0000-4000-8000-0000000000a1', '00777'), ('07960000-0000-4000-8000-0000000000a1', '777');
  begin
    insert into public.vigia_caja (tenant_id, numero) values ('07960000-0000-4000-8000-0000000000a1', '   ');
    raise exception '0796(a): número en blanco';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_caja (tenant_id, numero, placas) values ('07960000-0000-4000-8000-0000000000a1', 'C-2', 'ab 12');
    raise exception '0796(a): placas con espacios y minúsculas';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_caja (tenant_id, numero, estado) values ('07960000-0000-4000-8000-0000000000a1', 'C-3', 'reparacion');
    raise exception '0796(a): estado inventado';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_caja (tenant_id, numero, fuente) values ('07960000-0000-4000-8000-0000000000a1', 'C-4', 'correo');
    raise exception '0796(a): fuente inventada';
  exception when check_violation then null; end;
end $$;

-- (b) captura manual
do $$
begin
  insert into public.vigia_dato_viaje_manual
    (tenant_id, fila_id, operador_id, operador_nombre, licencia, licencia_vence, telefono, placas_unidad, placas_caja, estado_caja)
  values ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000e1', '07960000-0000-4000-8000-0000000000a9',
          'Operador Uno 0796', 'LIC-0000001', date '2027-01-31', '521000000001', 'UNI-001', 'AB-123-C', 'en_patio'); -- grep-limpio:ok
  begin
    insert into public.vigia_dato_viaje_manual (tenant_id, fila_id) values
      ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000e1');
    raise exception '0796(b): dos capturas para la misma fila';
  exception when unique_violation then null; end;
  begin
    insert into public.vigia_dato_viaje_manual (tenant_id, fila_id, telefono) values
      ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000e2', '3312345678'); -- grep-limpio:ok
    raise exception '0796(b): teléfono sin el 52';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_dato_viaje_manual (tenant_id, fila_id, placas_unidad) values
      ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000e2', 'a b');
    raise exception '0796(b): placas de unidad inválidas';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_dato_viaje_manual (tenant_id, fila_id, estado_caja) values
      ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000e2', 'sucia');
    raise exception '0796(b): estado de caja inventado';
  exception when check_violation then null; end;
  -- aislamiento: ni la fila ni el operador de otra flota
  begin
    insert into public.vigia_dato_viaje_manual (tenant_id, fila_id) values
      ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000e3');
    raise exception '0796(b): se colgó una captura de la fila de otra flota';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.vigia_dato_viaje_manual (tenant_id, fila_id, operador_id) values
      ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000e2', '07960000-0000-4000-8000-0000000000b9');
    raise exception '0796(b): se asignó un operador de otra flota';
  exception when foreign_key_violation then null; end;
  -- una captura sin operador del catálogo (nombre escrito a mano) es válida
  insert into public.vigia_dato_viaje_manual (tenant_id, fila_id, operador_nombre) values
    ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000e2', 'Nombre escrito a mano');
end $$;

-- (d) política: general + por cliente
do $$
begin
  insert into public.vigia_politica_datos (tenant_id, cliente_id, campo, visible) values
    ('07960000-0000-4000-8000-0000000000a1', null, 'telefono', false),
    ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000f1', 'telefono', true),
    ('07960000-0000-4000-8000-0000000000a1', null, 'caja', true);
  begin
    insert into public.vigia_politica_datos (tenant_id, cliente_id, campo, visible) values
      ('07960000-0000-4000-8000-0000000000a1', null, 'telefono', true);
    raise exception '0796(d): dos reglas generales para el mismo campo';
  exception when unique_violation then null; end;
  begin
    insert into public.vigia_politica_datos (tenant_id, cliente_id, campo, visible) values
      ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000f1', 'telefono', false);
    raise exception '0796(d): dos reglas del mismo cliente para el mismo campo';
  exception when unique_violation then null; end;
  begin
    insert into public.vigia_politica_datos (tenant_id, cliente_id, campo, visible) values
      ('07960000-0000-4000-8000-0000000000a1', null, 'color_favorito', true);
    raise exception '0796(d): campo inventado';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_politica_datos (tenant_id, cliente_id, campo, visible) values
      ('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000f3', 'licencia', true);
    raise exception '0796(d): regla para un cliente de otra flota';
  exception when foreign_key_violation then null; end;
  -- la regla del cliente manda sobre la general; otro cliente cae en la general; sin regla manda el valor por defecto
  if not public.vigia_dato_visible('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000f1', 'telefono') then
    raise exception '0796(d): la regla del cliente no mandó sobre la general';
  end if;
  if public.vigia_dato_visible('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000f2', 'telefono') then
    raise exception '0796(d): otro cliente no cayó en la regla general (oculto)';
  end if;
  if not public.vigia_dato_visible('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000f1', 'caja') then
    raise exception '0796(d): sin regla propia, el cliente no heredó la general (visible)';
  end if;
  if public.vigia_dato_visible('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000f2', 'licencia') then
    raise exception '0796(d): sin regla alguna, el valor por defecto conservador no fue «oculto»';
  end if;
  if not public.vigia_dato_visible('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000f2', 'licencia', true) then
    raise exception '0796(d): el valor por defecto que pasa quien llama no se respetó';
  end if;
  -- una regla de otra flota no se cuela, ni siquiera para el mismo campo
  insert into public.vigia_politica_datos (tenant_id, cliente_id, campo, visible)
    values ('07960000-0000-4000-8000-0000000000b1', null, 'licencia', true);
  if public.vigia_dato_visible('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000f2', 'licencia') then
    raise exception '0796(d): la regla de la flota B se aplicó a la flota A';
  end if;
  -- borrar un cliente borra sus reglas y deja la general
  delete from public.cliente where id = '07960000-0000-4000-8000-0000000000f1';
  if exists (select 1 from public.vigia_politica_datos where cliente_id = '07960000-0000-4000-8000-0000000000f1') then
    raise exception '0796(d): quedó una regla de un cliente borrado';
  end if;
  if public.vigia_dato_visible('07960000-0000-4000-8000-0000000000a1', '07960000-0000-4000-8000-0000000000f1', 'telefono') then
    raise exception '0796(d): sin la regla del cliente borrado debía caer en la general (oculto)';
  end if;
end $$;

-- (e) RLS
reset role;
do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07960000-0000-4000-8000-0000000000c1', true);
  select count(*) into n from public.vigia_caja;
  if n = 0 then raise exception '0796(e): el dueño de la flota A no ve sus cajas'; end if;
  select count(*) into n from public.vigia_dato_viaje_manual;
  if n = 0 then raise exception '0796(e): el dueño de la flota A no ve sus capturas'; end if;
  select count(*) into n from public.vigia_politica_datos;
  if n = 0 then raise exception '0796(e): el dueño de la flota A no ve sus reglas'; end if;
  if exists (select 1 from public.vigia_caja where tenant_id <> '07960000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_dato_viaje_manual where tenant_id <> '07960000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_politica_datos where tenant_id <> '07960000-0000-4000-8000-0000000000a1') then
    raise exception '0796(e): el dueño de la flota A ve datos de otra flota';
  end if;
  -- el contador (no atiende clientes) no ve nada
  perform set_config('request.jwt.claim.sub', '07960000-0000-4000-8000-0000000000c3', true);
  select count(*) into n from public.vigia_caja;
  if n <> 0 then raise exception '0796(e): el contador ve las cajas (%)', n; end if;
  select count(*) into n from public.vigia_dato_viaje_manual;
  if n <> 0 then raise exception '0796(e): el contador ve datos personales del operador (%)', n; end if;
  select count(*) into n from public.vigia_politica_datos;
  if n <> 0 then raise exception '0796(e): el contador ve la política (%)', n; end if;
  -- el dueño de B no ve lo de A
  perform set_config('request.jwt.claim.sub', '07960000-0000-4000-8000-0000000000c4', true);
  if exists (select 1 from public.vigia_caja where tenant_id = '07960000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_dato_viaje_manual where tenant_id = '07960000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_politica_datos where tenant_id = '07960000-0000-4000-8000-0000000000a1') then
    raise exception '0796(e): el dueño de la flota B ve datos de la flota A';
  end if;
  -- nadie escribe por REST ni ejecuta la función
  begin
    insert into public.vigia_caja (tenant_id, numero) values ('07960000-0000-4000-8000-0000000000b1', 'C-REST');
    raise exception '0796(e): un usuario autenticado escribió una caja por REST';
  exception when insufficient_privilege then null; end;
  begin
    update public.vigia_dato_viaje_manual set telefono = '521000000009'; -- grep-limpio:ok
    raise exception '0796(e): un usuario autenticado actualizó capturas por REST';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.vigia_politica_datos;
    raise exception '0796(e): un usuario autenticado borró reglas por REST';
  exception when insufficient_privilege then null; end;
  begin
    perform public.vigia_dato_visible('07960000-0000-4000-8000-0000000000b1', null, 'caja');
    raise exception '0796(e): un usuario autenticado ejecutó vigia_dato_visible';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- (c) borrar la fila / al operador borra la captura; borrar la flota se lleva todo (con el dueño de la base)
do $$
begin
  delete from public.programa_despacho_fila where id = '07960000-0000-4000-8000-0000000000e2';
  if exists (select 1 from public.vigia_dato_viaje_manual where fila_id = '07960000-0000-4000-8000-0000000000e2') then
    raise exception '0796(c): borrar la fila del programa dejó su captura manual';
  end if;
  if not exists (select 1 from public.vigia_dato_viaje_manual where fila_id = '07960000-0000-4000-8000-0000000000e1') then
    raise exception '0796(c): borrar una fila se llevó la captura de otra';
  end if;
  delete from public.operador where id = '07960000-0000-4000-8000-0000000000a9';
  if exists (select 1 from public.vigia_dato_viaje_manual where operador_id = '07960000-0000-4000-8000-0000000000a9')
     or exists (select 1 from public.vigia_dato_viaje_manual where fila_id = '07960000-0000-4000-8000-0000000000e1') then
    raise exception '0796(c): borrar al operador dejó sus datos personales en la captura manual';
  end if;
  delete from public.tenant where id = '07960000-0000-4000-8000-0000000000a1';
  if exists (select 1 from public.vigia_caja where tenant_id = '07960000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_dato_viaje_manual where tenant_id = '07960000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_politica_datos where tenant_id = '07960000-0000-4000-8000-0000000000a1') then
    raise exception '0796(c): quedaron datos de una flota borrada';
  end if;
  if not exists (select 1 from public.vigia_caja where tenant_id = '07960000-0000-4000-8000-0000000000b1')
     or not exists (select 1 from public.vigia_politica_datos where tenant_id = '07960000-0000-4000-8000-0000000000b1') then
    raise exception '0796(c): borrar la flota A tocó a la flota B';
  end if;
end $$;

rollback;
