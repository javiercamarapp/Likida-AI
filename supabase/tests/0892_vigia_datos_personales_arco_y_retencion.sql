\set ON_ERROR_STOP on
-- 0892 · datos personales del Vigía: ARCO y retención (A37-A4-07). Datos sintéticos; todo en una transacción que se revierte.
begin;

insert into public.tenant (id, nombre) values
  ('b8920000-0000-4000-8000-000000000001', 'Vigia 0892 A'),
  ('b8920000-0000-4000-8000-000000000002', 'Vigia 0892 B');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('b8920000-0000-4000-8000-0000000000a1', 'b8920000-0000-4000-8000-000000000001', 'Operadora Prueba Ochoveintidos', '525500892001'),
  ('b8920000-0000-4000-8000-0000000000a2', 'b8920000-0000-4000-8000-000000000001', 'Otro Operador Ficticio', '525500892002');
insert into public.programa_despacho_fila (id, tenant_id, terminal, fecha, tipo, clave_natural, huella, comentarios) values
  ('b8920000-0000-4000-8000-0000000000f1', 'b8920000-0000-4000-8000-000000000001', 'GDL', '2026-01-10', 'EXPORTACION', 'k1', 'huella-0892-1', 'llamar a la operadora'),
  ('b8920000-0000-4000-8000-0000000000f2', 'b8920000-0000-4000-8000-000000000001', 'GDL', '2026-10-20', 'EXPORTACION', 'k2', 'huella-0892-2', 'comentario reciente'),
  ('b8920000-0000-4000-8000-0000000000f3', 'b8920000-0000-4000-8000-000000000001', 'GDL', '2026-10-21', 'EXPORTACION', 'k3', 'huella-0892-3', null);
insert into public.vigia_dato_viaje_manual (tenant_id, fila_id, operador_id, operador_nombre, licencia, telefono, placas_unidad) values
  ('b8920000-0000-4000-8000-000000000001', 'b8920000-0000-4000-8000-0000000000f1', null, 'Operadora Prueba Ochoveintidos', 'LIC-0892', '525500892009', 'ABC123'),
  ('b8920000-0000-4000-8000-000000000001', 'b8920000-0000-4000-8000-0000000000f2', 'b8920000-0000-4000-8000-0000000000a1', null, 'LIC-0892B', null, 'DEF456'),
  ('b8920000-0000-4000-8000-000000000001', 'b8920000-0000-4000-8000-0000000000f3', 'b8920000-0000-4000-8000-0000000000a2', 'Otro Operador Ficticio', 'LIC-OTRO', '525500892002', null);
insert into public.vigia_aviso (id, tenant_id, fila_id, huella, estado, texto, aprobado_en, enviado_en) values
  ('b8920000-0000-4000-8000-0000000000c1', 'b8920000-0000-4000-8000-000000000001', 'b8920000-0000-4000-8000-0000000000f1', 'aaaaaaaaaaaaaaaa', 'enviado', 'Operadora Prueba Ochoveintidos lleva la caja', now(), now()),
  ('b8920000-0000-4000-8000-0000000000c2', 'b8920000-0000-4000-8000-000000000001', 'b8920000-0000-4000-8000-0000000000f3', 'bbbbbbbbbbbbbbbb', 'enviado', 'Otro Operador Ficticio lleva la caja', now(), now());

-- (a) historia intacta: sin la variable de redacción, editar un aviso enviado sigue prohibido.
do $$ begin
  begin
    update public.vigia_aviso set texto = 'x' where id = 'b8920000-0000-4000-8000-0000000000c1';
    raise exception '(a) un aviso enviado no debía poder editarse';
  exception when check_violation then null;
  end;
end $$;

-- (b) retención: solo lo viejo (fila del 2026-01-10) y nada de lo reciente.
do $$ declare v integer; begin
  v := public.purgar_vigia_datos_personales(90, 5000, date '2026-10-23');
  if v <> 3 then raise exception '(b) debía vaciar 3 (captura, aviso, comentario), vació %', v; end if;
  if exists (select 1 from public.vigia_dato_viaje_manual where fila_id = 'b8920000-0000-4000-8000-0000000000f1'
             and (operador_nombre is not null or licencia is not null or telefono is not null)) then
    raise exception '(b) la captura vieja conserva datos personales';
  end if;
  if (select placas_unidad from public.vigia_dato_viaje_manual where fila_id = 'b8920000-0000-4000-8000-0000000000f1') <> 'ABC123' then
    raise exception '(b) las placas no son dato personal y debían conservarse';
  end if;
  if (select texto from public.vigia_aviso where id = 'b8920000-0000-4000-8000-0000000000c1') <> '[texto retirado por retención]' then
    raise exception '(b) el aviso viejo conserva el texto';
  end if;
  if (select comentarios from public.programa_despacho_fila where id = 'b8920000-0000-4000-8000-0000000000f1') is not null then
    raise exception '(b) el comentario viejo sigue';
  end if;
  if (select comentarios from public.programa_despacho_fila where id = 'b8920000-0000-4000-8000-0000000000f2') is null then
    raise exception '(b) un comentario reciente no debía tocarse';
  end if;
  if (select licencia from public.vigia_dato_viaje_manual where fila_id = 'b8920000-0000-4000-8000-0000000000f3') is null then
    raise exception '(b) la captura reciente no debía tocarse';
  end if;
  -- idempotente
  if public.purgar_vigia_datos_personales(90, 5000, date '2026-10-23') <> 0 then raise exception '(b) segunda pasada debía ser 0'; end if;
  begin
    perform public.purgar_vigia_datos_personales(10, 5000, date '2026-10-23');
    raise exception '(b) plazo menor a 30 días debía rechazarse';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- (c) ARCO: marcar anonimizado_en (lo que hace el ejecutor) vacía lo del operador, por id, por nombre escrito a mano y por teléfono.
update public.operador set nombre = 'anon-seudonimo', anonimizado_en = now() where id = 'b8920000-0000-4000-8000-0000000000a1';
do $$ begin
  if exists (select 1 from public.vigia_dato_viaje_manual where fila_id = 'b8920000-0000-4000-8000-0000000000f2'
             and (operador_id is not null or licencia is not null)) then
    raise exception '(c) la captura ligada por id conserva datos';
  end if;
  if (select licencia from public.vigia_dato_viaje_manual where fila_id = 'b8920000-0000-4000-8000-0000000000f3') <> 'LIC-OTRO' then
    raise exception '(c) la captura de OTRO operador no debía tocarse';
  end if;
  if (select texto from public.vigia_aviso where id = 'b8920000-0000-4000-8000-0000000000c2') <> 'Otro Operador Ficticio lleva la caja' then
    raise exception '(c) el aviso de otro operador no debía tocarse';
  end if;
end $$;

-- (d) ARCO sobre el segundo operador: su aviso (nombre en el texto) y su captura (por id y por teléfono) se retiran; la otra flota no.
insert into public.programa_despacho_fila (id, tenant_id, terminal, fecha, tipo, clave_natural, huella) values
  ('b8920000-0000-4000-8000-0000000000f9', 'b8920000-0000-4000-8000-000000000002', 'GDL', '2026-10-21', 'EXPORTACION', 'k9', 'huella-0892-9');
insert into public.vigia_aviso (id, tenant_id, fila_id, huella, estado, texto, aprobado_en, enviado_en) values
  ('b8920000-0000-4000-8000-0000000000c9', 'b8920000-0000-4000-8000-000000000002', 'b8920000-0000-4000-8000-0000000000f9', 'cccccccccccccccc', 'enviado', 'Otro Operador Ficticio en OTRA flota', now(), now());
update public.operador set nombre = 'anon-seudonimo-2', anonimizado_en = now() where id = 'b8920000-0000-4000-8000-0000000000a2';
do $$ begin
  if (select texto from public.vigia_aviso where id = 'b8920000-0000-4000-8000-0000000000c2') <> '[texto retirado por solicitud ARCO]' then
    raise exception '(d) el aviso que nombraba al operador conserva el texto';
  end if;
  if exists (select 1 from public.vigia_dato_viaje_manual where fila_id = 'b8920000-0000-4000-8000-0000000000f3'
             and (licencia is not null or telefono is not null or operador_nombre is not null)) then
    raise exception '(d) la captura del operador conserva datos';
  end if;
  if (select texto from public.vigia_aviso where id = 'b8920000-0000-4000-8000-0000000000c9') like '[texto retirado%' then
    raise exception '(d) el aviso de OTRA flota no debía tocarse';
  end if;
end $$;

-- (e) tras la redacción la historia sigue protegida (la variable es local a la transacción de la función, pero aquí sigue puesta:
--     aun así, cambiar OTRA columna de un aviso enviado se rechaza).
do $$ begin
  perform set_config('likida.vigia_redactar', '1', true);
  begin
    update public.vigia_aviso set estado = 'descartado' where id = 'b8920000-0000-4000-8000-0000000000c9';
    raise exception '(e) con la variable puesta solo puede cambiar texto';
  exception when check_violation then null;
  end;
end $$;

-- (f) privilegios.
do $$ begin
  if has_function_privilege('anon', 'public.purgar_vigia_datos_personales(integer,integer,date)', 'execute')
     or has_function_privilege('authenticated', 'public.purgar_vigia_datos_personales(integer,integer,date)', 'execute') then
    raise exception '(f) anon/authenticated no deben ejecutar la purga';
  end if;
  if not has_function_privilege('service_role', 'public.purgar_vigia_datos_personales(integer,integer,date)', 'execute') then
    raise exception '(f) service_role debe ejecutar la purga';
  end if;
end $$;

rollback;
