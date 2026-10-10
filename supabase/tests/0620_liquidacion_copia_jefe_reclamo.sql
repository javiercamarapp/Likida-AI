\set ON_ERROR_STOP on
-- 0620 — reclamo atómico y registro por teléfono de la copia de la liquidación al jefe de flota.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
--
--   (a) reclamar: el primero recibe token, el segundo (mismo teléfono) NO; otro teléfono sí; otra generación sí;
--   (b) cerrar aceptada: queda `aceptada` y no se vuelve a reclamar, ni vencido el arriendo;
--   (c) cerrar NO aceptada: suelta el reclamo y se puede reclamar de nuevo;
--   (d) un reclamo vivo con arriendo vencido se retoma (token nuevo) y el token viejo ya no cierra;
--   (e) una liquidación de OTRA flota no se reclama (NULL), el teléfono mal formado y el lease absurdo se rechazan;
--   (f) borrar la liquidación borra sus reclamos (cascada);
--   (g) permisos: solo service_role ejecuta las funciones y escribe la tabla.
begin;

insert into public.tenant (id, nombre) values
  ('62000000-0000-4000-8000-0000000000a1', 'Flota A 0620'),
  ('62000000-0000-4000-8000-0000000000b1', 'Flota B 0620');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('62000000-0000-4000-8000-0000000000a2', '62000000-0000-4000-8000-0000000000a1', 'Chofer A', '525500000021');
insert into public.liquidacion_externa
  (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, estado)
values
  ('62000000-0000-4000-8000-0000000000d1', '62000000-0000-4000-8000-0000000000a1', 'C1', repeat('a', 64),
   '62000000-0000-4000-8000-0000000000a2', '2026-09-01', '2026-09-07',
   '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'enviada');

set local role service_role;

do $$
declare
  ta constant uuid := '62000000-0000-4000-8000-0000000000a1';
  tb constant uuid := '62000000-0000-4000-8000-0000000000b1';
  liq constant uuid := '62000000-0000-4000-8000-0000000000d1';
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; viejo uuid; ok boolean; n int; rechazado boolean;
begin
  -- (a)
  t1 := public.reclamar_copia_jefe(ta, liq, 1, '525511110001');
  if t1 is null then raise exception '0620(a): el primer reclamo debía recibir token'; end if;
  if public.reclamar_copia_jefe(ta, liq, 1, '525511110001') is not null then
    raise exception '0620(a): el segundo reclamo del MISMO teléfono (arriendo vigente) debía ser NULL';
  end if;
  if public.reclamar_copia_jefe(ta, liq, 1, '525511110002') is null then
    raise exception '0620(a): otro teléfono debía poder reclamar';
  end if;
  if public.reclamar_copia_jefe(ta, liq, 2, '525511110001') is null then
    raise exception '0620(a): otra generación (reintento del panel) debía poder reclamar';
  end if;

  -- (b)
  if not public.cerrar_copia_jefe(ta, liq, 1, '525511110001', t1, true) then raise exception '0620(b): cerrar aceptada debía devolver true'; end if;
  select count(*) into n from public.liquidacion_copia_jefe where liquidacion_externa_id = liq and generacion = 1 and telefono = '525511110001' and estado = 'aceptada' and aceptada_en is not null;
  if n <> 1 then raise exception '0620(b): la fila debía quedar aceptada'; end if;
  if public.cerrar_copia_jefe(ta, liq, 1, '525511110001', t1, true) then raise exception '0620(b): cerrar dos veces debía devolver false'; end if;
  if public.reclamar_copia_jefe(ta, liq, 1, '525511110001', clock_timestamp() + interval '1 day') is not null then
    raise exception '0620(b): una copia aceptada NO se vuelve a reclamar, ni con el arriendo vencido';
  end if;

  -- (c)
  t2 := public.reclamar_copia_jefe(ta, liq, 1, '525511110003');
  if not public.cerrar_copia_jefe(ta, liq, 1, '525511110003', t2, false) then raise exception '0620(c): soltar debía devolver true'; end if;
  t3 := public.reclamar_copia_jefe(ta, liq, 1, '525511110003');
  if t3 is null then raise exception '0620(c): tras soltar, el teléfono debía poder reclamarse otra vez'; end if;

  -- (d)
  viejo := t3;
  t4 := public.reclamar_copia_jefe(ta, liq, 1, '525511110003', clock_timestamp() + interval '10 minutes');
  if t4 is null or t4 = viejo then raise exception '0620(d): con el arriendo vencido el reclamo debía retomarse con token nuevo'; end if;
  if public.cerrar_copia_jefe(ta, liq, 1, '525511110003', viejo, true) then
    raise exception '0620(d): el token viejo NO debía poder cerrar';
  end if;
  if not public.cerrar_copia_jefe(ta, liq, 1, '525511110003', t4, true) then raise exception '0620(d): el token vigente debía cerrar'; end if;

  -- (e)
  t5 := public.reclamar_copia_jefe(tb, liq, 1, '525511110009');
  if t5 is not null then raise exception '0620(e): una liquidación de otra flota NO se reclama'; end if;
  rechazado := false;
  begin
    perform public.reclamar_copia_jefe(ta, liq, 1, '+52 55 1111 0004');
  exception when check_violation then rechazado := true; end;
  if not rechazado then raise exception '0620(e): un teléfono mal formado debía rechazarse'; end if;
  rechazado := false;
  begin
    perform public.reclamar_copia_jefe(ta, liq, 1, '525511110005', clock_timestamp(), 5);
  exception when others then rechazado := true; end;
  if not rechazado then raise exception '0620(e): un arriendo de 5 s debía rechazarse'; end if;
  t6 := public.reclamar_copia_jefe(ta, liq, 1, '525511110006');
  begin
    update public.liquidacion_copia_jefe set estado = 'aceptada' where telefono = '525511110006';
    ok := false;
  exception when check_violation then ok := true; end;
  if not ok then raise exception '0620(e): aceptada sin aceptada_en debía rechazarse'; end if;
end $$;

-- (g) permisos: un usuario autenticado no ejecuta ni escribe
reset role;
set local role authenticated;
do $$
declare rechazado boolean := false;
begin
  begin
    perform public.reclamar_copia_jefe('62000000-0000-4000-8000-0000000000a1', '62000000-0000-4000-8000-0000000000d1', 1, '525511110077');
  exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception '0620(g): authenticated NO debía poder reclamar'; end if;
  rechazado := false;
  begin
    insert into public.liquidacion_copia_jefe (liquidacion_externa_id, tenant_id, generacion, telefono)
    values ('62000000-0000-4000-8000-0000000000d1', '62000000-0000-4000-8000-0000000000a1', 1, '525511110078');
  exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception '0620(g): authenticated NO debía poder escribir la tabla'; end if;
end $$;
reset role;

-- (f) cascada
do $$
declare n int;
begin
  delete from public.liquidacion_externa where id = '62000000-0000-4000-8000-0000000000d1';
  select count(*) into n from public.liquidacion_copia_jefe where liquidacion_externa_id = '62000000-0000-4000-8000-0000000000d1';
  if n <> 0 then raise exception '0620(f): borrar la liquidación debía borrar sus reclamos (quedan %)', n; end if;
end $$;

rollback;
