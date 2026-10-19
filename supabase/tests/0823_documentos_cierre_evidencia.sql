\set ON_ERROR_STOP on
-- 0823 — documentos de cierre (T-A5-53/54, Agente 5 Conductor), contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) viaje_hito_evidencia.tipo acepta 'documento_cierre' y sigue cerrado a cualquier otro valor inventado;
--   (b) viaje_hito_evidencia.documento_requerido_id liga al catálogo de ESA flota; borrar el documento DESLIGA la
--       evidencia (SET NULL), no se la lleva;
--   (c) viaje_documento_cierre: único por (viaje, documento); snapshot (nombre/tipo) SOBREVIVE a que el documento
--       se borre del catálogo (documento_requerido_id queda null, pero nombre_solicitado/tipo_solicitado no cambian);
--       coherencia estado='recibido' ⇔ recibido_en no nulo; dominio cerrado de respuesta_chofer; intentos_legibilidad
--       entre 0 y 10; borrar la evidencia DESLIGA la fila de seguimiento (SET NULL), no se la lleva;
--   (d) RLS: una flota no ve los documentos de cierre de otra; authenticated no escribe; anon no lee;
--   (e) la migración se puede reaplicar sin error, sin duplicar la política ni perder filas (idempotente).
begin;

insert into public.tenant (id, nombre) values
  ('82300000-0000-4000-8000-0000000000a1', 'Flota A 0823'),
  ('82300000-0000-4000-8000-0000000000b1', 'Flota B 0823');
insert into public.app_user (id, tenant_id, email, rol) values
  ('82300000-0000-4000-8000-000000000401', '82300000-0000-4000-8000-0000000000a1', 'admin-0823@test.invalid', 'flota_admin');
insert into public.cliente (id, tenant_id, nombre) values
  ('82300000-0000-4000-8000-0000000000c1', '82300000-0000-4000-8000-0000000000a1', 'Cliente demo 0823');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('82300000-0000-4000-8000-0000000000e1', '82300000-0000-4000-8000-0000000000a1', 'Chofer demo 0823', '28999000021');
insert into public.viaje (id, tenant_id, operador_id, folio, origen, destino, estatus) values
  ('82300000-0000-4000-8000-0000000000f1', '82300000-0000-4000-8000-0000000000a1', '82300000-0000-4000-8000-0000000000e1', 'F-0823', 'Origen demo', 'Destino demo', 'abierto');
insert into public.viaje_hito (id, tenant_id, viaje_id, tipo, estado, ciclo, recibido_en, fuente) values
  ('82300000-0000-4000-8000-00000000aaaa', '82300000-0000-4000-8000-0000000000a1', '82300000-0000-4000-8000-0000000000f1', 'salida_descarga', 'recibido', 1, now(), 'texto');
insert into public.cliente_documento_requerido (id, tenant_id, cliente_id, nombre, tipo) values
  ('82300000-0000-4000-8000-0000000000d1', '82300000-0000-4000-8000-0000000000a1', '82300000-0000-4000-8000-0000000000c1', 'Carta porte firmada 0823', 'basico');

do $$
declare
  ta constant uuid := '82300000-0000-4000-8000-0000000000a1';
  v1 constant uuid := '82300000-0000-4000-8000-0000000000f1';
  h1 constant uuid := '82300000-0000-4000-8000-00000000aaaa';
  d1 constant uuid := '82300000-0000-4000-8000-0000000000d1';
  ev uuid;
  dc uuid;
begin
  -- (a) dominio ampliado de viaje_hito_evidencia.tipo
  insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256, documento_requerido_id)
    values (ta, v1, h1, 1, 'documento_cierre', ta || '/v/0823.jpg', repeat('a', 64), d1)
    returning id into ev;
  begin
    insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256) values (ta, v1, h1, 1, 'inventado_0823', ta || '/v/x.jpg', repeat('b', 64));
    raise exception '0823: tipo fuera de dominio se coló';
  exception when check_violation then null; end;

  -- (c) la fila de seguimiento, único por (viaje, documento)
  insert into public.viaje_documento_cierre (tenant_id, viaje_id, documento_requerido_id, nombre_solicitado, tipo_solicitado, viaje_hito_evidencia_id, estado, recibido_en)
    values (ta, v1, d1, 'Carta porte firmada 0823', 'basico', ev, 'recibido', now())
    returning id into dc;
  begin
    insert into public.viaje_documento_cierre (tenant_id, viaje_id, documento_requerido_id, nombre_solicitado, tipo_solicitado, estado) values (ta, v1, d1, 'Carta porte firmada 0823', 'basico', 'pendiente');
    raise exception '0823: se repitió el documento del mismo viaje';
  exception when unique_violation then null; end;

  -- coherencia estado/recibido_en
  begin
    insert into public.viaje_documento_cierre (tenant_id, viaje_id, documento_requerido_id, nombre_solicitado, tipo_solicitado, estado) values (ta, v1, gen_random_uuid(), 'Otro 0823', 'basico', 'recibido');
    raise exception '0823: recibido sin recibido_en se coló';
  exception when check_violation then null; end;

  -- dominio de respuesta_chofer
  begin
    update public.viaje_documento_cierre set respuesta_chofer = 'inventado' where id = dc;
    raise exception '0823: respuesta_chofer fuera de dominio se coló';
  exception when check_violation then null; end;

  -- rango de intentos_legibilidad
  begin
    update public.viaje_documento_cierre set intentos_legibilidad = 11 where id = dc;
    raise exception '0823: intentos_legibilidad fuera de rango se coló';
  exception when check_violation then null; end;

  -- (b)/(c) borrar el documento del catálogo DESLIGA (SET NULL), el snapshot sobrevive
  delete from public.cliente_documento_requerido where id = d1;
  if (select documento_requerido_id from public.viaje_hito_evidencia where id = ev) is not null then
    raise exception '0823: la evidencia no se desligó al borrar el documento del catálogo';
  end if;
  if (select documento_requerido_id from public.viaje_documento_cierre where id = dc) is not null then
    raise exception '0823: la fila de seguimiento no se desligó al borrar el documento del catálogo';
  end if;
  if (select nombre_solicitado from public.viaje_documento_cierre where id = dc) <> 'Carta porte firmada 0823' then
    raise exception '0823: el snapshot NO sobrevivió al borrar el documento del catálogo';
  end if;

  -- (c) borrar la evidencia DESLIGA la fila de seguimiento (SET NULL), no se la lleva
  delete from public.viaje_hito_evidencia where id = ev;
  if not exists (select 1 from public.viaje_documento_cierre where id = dc) then
    raise exception '0823: la fila de seguimiento se borró en cascada junto con la evidencia';
  end if;
  if (select viaje_hito_evidencia_id from public.viaje_documento_cierre where id = dc) is not null then
    raise exception '0823: la fila de seguimiento no se desligó al borrar la evidencia';
  end if;

  -- (d) RLS activa y permisos
  if not (select relrowsecurity from pg_class where oid = 'public.viaje_documento_cierre'::regclass) then raise exception '0823: sin RLS'; end if;
  if has_table_privilege('anon', 'public.viaje_documento_cierre', 'select') then raise exception '0823: anon puede leer'; end if;
  if has_table_privilege('authenticated', 'public.viaje_documento_cierre', 'insert') then raise exception '0823: authenticated puede escribir'; end if;
  if has_table_privilege('authenticated', 'public.viaje_documento_cierre', 'update') then raise exception '0823: authenticated puede actualizar'; end if;
  if has_table_privilege('authenticated', 'public.viaje_documento_cierre', 'delete') then raise exception '0823: authenticated puede borrar'; end if;
end $$;

-- (d) RLS: la flota A ve solo lo suyo (se siembra otra flota para comprobar el cruce)
insert into public.tenant (id, nombre) values ('82300000-0000-4000-8000-0000000000b1', 'Flota B 0823 bis') on conflict (id) do nothing;
insert into public.cliente (id, tenant_id, nombre) values ('82300000-0000-4000-8000-0000000000c2', '82300000-0000-4000-8000-0000000000b1', 'Cliente ajeno 0823');
insert into public.operador (id, tenant_id, nombre, telefono) values ('82300000-0000-4000-8000-0000000000e2', '82300000-0000-4000-8000-0000000000b1', 'Chofer ajeno 0823', '28999000022');
insert into public.viaje (id, tenant_id, operador_id, folio, origen, destino, estatus) values ('82300000-0000-4000-8000-0000000000f2', '82300000-0000-4000-8000-0000000000b1', '82300000-0000-4000-8000-0000000000e2', 'F-AJENO', 'X', 'Y', 'abierto');
insert into public.cliente_documento_requerido (id, tenant_id, cliente_id, nombre, tipo) values ('82300000-0000-4000-8000-0000000000d2', '82300000-0000-4000-8000-0000000000b1', '82300000-0000-4000-8000-0000000000c2', 'Documento ajeno', 'basico');
insert into public.viaje_documento_cierre (tenant_id, viaje_id, documento_requerido_id, nombre_solicitado, tipo_solicitado, estado) values
  ('82300000-0000-4000-8000-0000000000b1', '82300000-0000-4000-8000-0000000000f2', '82300000-0000-4000-8000-0000000000d2', 'Documento ajeno', 'basico', 'pendiente');

set local role authenticated;
select set_config('request.jwt.claim.sub', '82300000-0000-4000-8000-000000000401', true);
do $$ begin
  if exists (select 1 from public.viaje_documento_cierre where tenant_id = '82300000-0000-4000-8000-0000000000b1')
     or (select count(*) from public.viaje_documento_cierre) = 0 then
    raise exception '0823: RLS dejó cruzar flotas (ve % filas)', (select count(*) from public.viaje_documento_cierre);
  end if;
end $$;
reset role;

-- (e) reaplicar la migración: sin error, sin política duplicada y sin perder filas
do $$ begin
  create temp table if not exists _antes_0823 on commit drop as select count(*)::int as n from public.viaje_documento_cierre;
end $$;
\ir ../migrations/0823_documentos_cierre_evidencia.sql
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'viaje_documento_cierre') <> 1 then
    raise exception '0823: reaplicar duplicó o perdió la política';
  end if;
  if (select count(*) from public.viaje_documento_cierre) <> (select n from _antes_0823) then
    raise exception '0823: reaplicar cambió las filas';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.viaje_hito_evidencia'::regclass and conname = 'viaje_hito_evidencia_tipo') <> 1 then
    raise exception '0823: falta (o se duplicó) el CHECK de tipo ampliado';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.viaje_documento_cierre'::regclass and conname = 'viaje_documento_cierre_unico') <> 1 then
    raise exception '0823: falta (o se duplicó) el único por (viaje, documento)';
  end if;
end $$;

rollback;
