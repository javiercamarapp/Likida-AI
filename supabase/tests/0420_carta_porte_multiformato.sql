\set ON_ERROR_STOP on
-- 0420/0421 — CARTA PORTE MULTI-FORMATO (Agente 3).
--
-- Lo que SOLO la base puede demostrar, contra Postgres real:
--
--   (a) la IDEMPOTENCIA: unique (tenant_id, sha256) — el mismo archivo dos veces
--       en una flota choca; en OTRA flota entra (dos clientes distintos);
--   (b) los CHECK de dominio y de coherencia (canal, formato, estado, huella,
--       tamaño, aprobación completa, rechazo con motivo, purga coherente);
--   (c) el aislamiento entre flotas dentro de las FK compuestas (viaje, cliente,
--       perfil, documento): no se cuelga una fila del padre de otra flota;
--   (d) el CLAIM de procesamiento: gana uno, el lease vencido se recupera con un
--       intento más, el tope de intentos lo frena, y otra flota no lo reclama;
--   (e) las versiones de perfil son INMUTABLES (trigger) y la cascada borra todo;
--   (f) permisos: anon/authenticated no leen NI escriben nada por REST; la
--       bitácora es append-only también para service_role;
--   (g) la retención: cp_documentos_vencidos solo devuelve lo vencido y no purgado;
--   (h) 0421: el CHECK de modelo_rol admite los tres roles nuevos Y los catorce
--       de antes, y rechaza uno inventado.
begin;

insert into public.tenant (id, nombre) values
  ('42000000-0000-4000-8000-0000000000a1', 'Flota A 0420'),
  ('42000000-0000-4000-8000-0000000000b1', 'Flota B 0420');
insert into public.app_user (id, tenant_id, email, rol) values
  ('42000000-0000-4000-8000-0000000000c1', '42000000-0000-4000-8000-0000000000a1', 'dueno-0420@test.invalid', 'flota_admin');
insert into public.cliente (id, tenant_id, nombre) values
  ('42000000-0000-4000-8000-0000000000a2', '42000000-0000-4000-8000-0000000000a1', 'Cliente A'),
  ('42000000-0000-4000-8000-0000000000b2', '42000000-0000-4000-8000-0000000000b1', 'Cliente B');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('42000000-0000-4000-8000-0000000000a4', '42000000-0000-4000-8000-0000000000a1', 'Chofer A', '525500004201'),
  ('42000000-0000-4000-8000-0000000000b4', '42000000-0000-4000-8000-0000000000b1', 'Chofer B', '525500004202');
insert into public.viaje (id, tenant_id, folio, operador_id) values
  ('42000000-0000-4000-8000-0000000000a3', '42000000-0000-4000-8000-0000000000a1', 'VA-1', '42000000-0000-4000-8000-0000000000a4'),
  ('42000000-0000-4000-8000-0000000000b3', '42000000-0000-4000-8000-0000000000b1', 'VB-1', '42000000-0000-4000-8000-0000000000b4');

set local role service_role;

insert into public.cp_documento
  (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256)
values
  ('42000000-0000-4000-8000-0000000000d1', '42000000-0000-4000-8000-0000000000a1', 'manual', 'excel', 'embarque.xlsx', 1000, repeat('a', 64));

do $$
begin
  -- (a) misma huella, misma flota → choca.
  begin
    insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256)
    values ('42000000-0000-4000-8000-0000000000a1', 'correo', 'excel', 'otra.xlsx', 1000, repeat('a', 64));
    raise exception '0420: la misma huella entró dos veces en la misma flota';
  exception when unique_violation then null;
  end;
  -- (a) misma huella, OTRA flota → entra.
  insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256)
  values ('42000000-0000-4000-8000-0000000000b1', 'correo', 'excel', 'otra.xlsx', 1000, repeat('a', 64));
end $$;

-- (b) cada CHECK rechaza lo suyo: se rompe UNA columna de una fila válida.
create temporary table caso (nombre text, columna text, valor jsonb);
grant all on caso to public;
insert into caso values
  ('canal fuera de dominio', 'canal', '"fax"'),
  ('formato fuera de dominio', 'formato', '"word"'),
  ('estado fuera de dominio', 'estado', '"listo"'),
  ('sha sin forma', 'sha256', '"corta"'),
  ('sha en mayúsculas', 'sha256', to_jsonb(repeat('A', 64))),
  ('bytes en cero', 'bytes', '0'),
  ('bytes sobre 12 MB', 'bytes', '12582913'),
  ('nombre vacío', 'nombre_archivo', '""'),
  ('nombre de más de 255', 'nombre_archivo', to_jsonb(repeat('x', 256))),
  ('confianza mayor a 1', 'confianza_min', '1.5'),
  ('confianza negativa', 'confianza_min', '-0.1'),
  ('versión en cero', 'version', '0'),
  ('aprobado sin aprobado_en', 'estado', '"aprobado"'),
  ('aprobado_en sin estado aprobado', 'aprobado_en', '"2026-10-01T10:00:00Z"'),
  ('rechazado sin motivo', 'estado', '"rechazado"'),
  ('extracto de más de 60000', 'texto_extracto', to_jsonb(repeat('x', 60001))),
  ('purgado con archivo todavía', 'purgado_en', '"2026-10-01T10:00:00Z"');

do $$
declare
  c record; rechazo boolean;
  base jsonb := jsonb_build_object(
    'tenant_id', '42000000-0000-4000-8000-0000000000a1', 'canal', 'manual', 'formato', 'pdf_texto',
    'nombre_archivo', 'x.pdf', 'bytes', 10, 'sha256', repeat('b', 64), 'estado', 'recibido', 'version', 1);
begin
  -- Control: la base sin romper nada SÍ entra.
  insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado)
  select r.tenant_id, r.canal, r.formato, r.nombre_archivo, r.bytes, r.sha256, r.estado
    from jsonb_populate_record(null::public.cp_documento, base) r;

  for c in select * from caso loop
    rechazo := false;
    begin
      insert into public.cp_documento
        (tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, version, confianza_min, aprobado_en, texto_extracto,
         storage_ruta, purgado_en)
      select r.tenant_id, r.canal, r.formato, r.nombre_archivo, r.bytes, r.sha256, r.estado, r.version, r.confianza_min,
             r.aprobado_en, r.texto_extracto, 'ruta/x', r.purgado_en
        from jsonb_populate_record(null::public.cp_documento,
               base || jsonb_build_object(c.columna, c.valor)
                    || case when c.columna = 'sha256' then '{}'::jsonb else jsonb_build_object('sha256', md5(c.nombre) || md5(c.nombre || 'x')) end) r;
    exception when check_violation then
      rechazo := true;
    end;
    if not rechazo then
      raise exception '0420: el CHECK dejó pasar «%»', c.nombre;
    end if;
  end loop;

  -- Lo que SÍ debe pasar: aprobado completo, rechazado con motivo, purgado coherente.
  insert into public.cp_documento
    (tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, aprobado_en, rechazo_motivo, purgado_en, storage_ruta, texto_extracto)
  values
    ('42000000-0000-4000-8000-0000000000a1', 'whatsapp', 'imagen', 'a.jpg', 12582912, repeat('c', 64), 'aprobado', now(), null, null, 'ruta/a', null),
    ('42000000-0000-4000-8000-0000000000a1', 'correo', 'xml', 'b.xml', 5, repeat('d', 64), 'rechazado', null, 'No es el embarque', null, 'ruta/b', null),
    ('42000000-0000-4000-8000-0000000000a1', 'manual', 'csv', 'c.csv', 5, repeat('e', 64), 'aprobado', now(), null, now(), null, null);
end $$;

-- (c) FK compuestas: ni el cliente, ni el viaje, ni el perfil de otra flota.
insert into public.cp_perfil (id, tenant_id, clave, nombre, formato) values
  ('42000000-0000-4000-8000-0000000000e1', '42000000-0000-4000-8000-0000000000a1', 'cliente-a-excel', 'Cliente A Excel', 'excel'),
  ('42000000-0000-4000-8000-0000000000e2', '42000000-0000-4000-8000-0000000000b1', 'cliente-b-excel', 'Cliente B Excel', 'excel');
do $$
begin
  begin
    insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256, cliente_id)
    values ('42000000-0000-4000-8000-0000000000a1', 'manual', 'csv', 'x.csv', 5, repeat('1', 64), '42000000-0000-4000-8000-0000000000b2');
    raise exception '0420: un documento de la flota A se colgó de un CLIENTE de la flota B';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256, viaje_id)
    values ('42000000-0000-4000-8000-0000000000a1', 'manual', 'csv', 'x.csv', 5, repeat('2', 64), '42000000-0000-4000-8000-0000000000b3');
    raise exception '0420: un documento de la flota A se colgó de un VIAJE de la flota B';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256, perfil_id)
    values ('42000000-0000-4000-8000-0000000000a1', 'manual', 'csv', 'x.csv', 5, repeat('3', 64), '42000000-0000-4000-8000-0000000000e2');
    raise exception '0420: un documento de la flota A se colgó de un PERFIL de la flota B';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.cp_perfil (tenant_id, clave, nombre, formato, cliente_id)
    values ('42000000-0000-4000-8000-0000000000a1', 'cruzado', 'x', 'excel', '42000000-0000-4000-8000-0000000000b2');
    raise exception '0420: un perfil de la flota A se colgó de un CLIENTE de la flota B';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.cp_documento_evento (documento_id, tenant_id, tipo)
    values ('42000000-0000-4000-8000-0000000000d1', '42000000-0000-4000-8000-0000000000b1', 'recibido');
    raise exception '0420: un evento de la flota B se colgó de un documento de la flota A';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.cp_correccion (documento_id, tenant_id, campo)
    values ('42000000-0000-4000-8000-0000000000d1', '42000000-0000-4000-8000-0000000000b1', 'origen_cp');
    raise exception '0420: una corrección de la flota B se colgó de un documento de la flota A';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.cp_documento_evento (documento_id, tenant_id, tipo)
    values ('42000000-0000-4000-8000-0000000000d1', '42000000-0000-4000-8000-0000000000a1', 'inventado');
    raise exception '0420: el CHECK de tipo de evento dejó pasar uno inventado';
  exception when check_violation then null;
  end;
  -- Un documento SÍ puede apuntar a lo de su flota.
  update public.cp_documento set cliente_id = '42000000-0000-4000-8000-0000000000a2',
         viaje_id = '42000000-0000-4000-8000-0000000000a3', perfil_id = '42000000-0000-4000-8000-0000000000e1'
   where id = '42000000-0000-4000-8000-0000000000d1';
  -- La mercancía del viaje recuerda su documento, pero no el de otra flota.
  insert into public.viaje_mercancia (tenant_id, viaje_id, descripcion, cantidad, cp_documento_id)
  values ('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000a3', 'Cajas', 1, '42000000-0000-4000-8000-0000000000d1');
  begin
    insert into public.viaje_mercancia (tenant_id, viaje_id, descripcion, cantidad, cp_documento_id)
    select '42000000-0000-4000-8000-0000000000b1', '42000000-0000-4000-8000-0000000000b3', 'Cajas', 1, id
      from public.cp_documento where tenant_id = '42000000-0000-4000-8000-0000000000a1' limit 1;
    raise exception '0420: un renglón de mercancía de la flota B apuntó a un documento de la flota A';
  exception when foreign_key_violation then null;
  end;
  -- Borrar el viaje suelta el documento, no lo borra ni rompe la FK compuesta.
  delete from public.viaje_mercancia where viaje_id = '42000000-0000-4000-8000-0000000000a3';
  insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, viaje_id)
  values ('42000000-0000-4000-8000-0000000000d2', '42000000-0000-4000-8000-0000000000a1', 'manual', 'csv', 'v.csv', 5, repeat('4', 64),
          '42000000-0000-4000-8000-0000000000a3');
  delete from public.cp_documento where id = '42000000-0000-4000-8000-0000000000d1' and false;
end $$;

-- Borrar el viaje: el documento sobrevive con viaje_id NULL y tenant_id intacto.
update public.cp_documento set viaje_id = null where id = '42000000-0000-4000-8000-0000000000d1';
delete from public.viaje where id = '42000000-0000-4000-8000-0000000000a3';
do $$ begin
  if (select viaje_id from public.cp_documento where id = '42000000-0000-4000-8000-0000000000d2') is not null then
    raise exception '0420: borrar el viaje no soltó el viaje_id del documento';
  end if;
  if (select tenant_id from public.cp_documento where id = '42000000-0000-4000-8000-0000000000d2') is distinct from '42000000-0000-4000-8000-0000000000a1'::uuid then
    raise exception '0420: borrar el viaje tocó el tenant_id del documento';
  end if;
end $$;

-- (d) el CLAIM.
insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256)
values ('42000000-0000-4000-8000-0000000000d3', '42000000-0000-4000-8000-0000000000a1', 'manual', 'pdf_texto', 'claim.pdf', 5, repeat('5', 64));
do $$
declare n int; v1 int; v2 int;
begin
  -- Otra flota NO lo reclama.
  select count(*) into n from public.cp_documento_reclamar('42000000-0000-4000-8000-0000000000b1', '42000000-0000-4000-8000-0000000000d3', 60);
  if n <> 0 then raise exception '0420: la flota B reclamó un documento de la flota A'; end if;
  -- El primero gana (intentos = 1)…
  select intentos into v1 from public.cp_documento_reclamar('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000d3', 60);
  if v1 is distinct from 1 then raise exception '0420: el primer claim no devolvió intentos=1 (%)', v1; end if;
  -- …y el segundo, con el lease vigente, no.
  select count(*) into n from public.cp_documento_reclamar('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000d3', 60);
  if n <> 0 then raise exception '0420: dos claims simultáneos reclamaron el mismo documento'; end if;
  -- El lease vencido se recupera con un intento más.
  update public.cp_documento set procesando_hasta = now() - interval '1 second' where id = '42000000-0000-4000-8000-0000000000d3';
  select intentos into v2 from public.cp_documento_reclamar('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000d3', 60);
  if v2 is distinct from 2 then raise exception '0420: el lease vencido no se recuperó con intentos=2 (%)', v2; end if;
  -- Un documento ya revisado o aprobado no se reclama.
  update public.cp_documento set estado = 'por_revisar', procesando_hasta = null where id = '42000000-0000-4000-8000-0000000000d3';
  select count(*) into n from public.cp_documento_reclamar('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000d3', 60);
  if n <> 0 then raise exception '0420: se reclamó un documento ya extraído'; end if;
  -- El tope de intentos: fallido con 5 intentos ya no se reintenta.
  update public.cp_documento set estado = 'fallido', intentos = 5 where id = '42000000-0000-4000-8000-0000000000d3';
  select count(*) into n from public.cp_documento_reclamar('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000d3', 60);
  if n <> 0 then raise exception '0420: se reclamó un documento que agotó sus intentos'; end if;
  -- Y con 4 intentos sí.
  update public.cp_documento set intentos = 4 where id = '42000000-0000-4000-8000-0000000000d3';
  select intentos into v1 from public.cp_documento_reclamar('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000d3', 60);
  if v1 is distinct from 5 then raise exception '0420: el claim con 4 intentos previos no devolvió 5'; end if;
  -- Cada claim sube la versión (el candado optimista de quien procesa): 3 claims = versión 4.
  if (select version from public.cp_documento where id = '42000000-0000-4000-8000-0000000000d3') is distinct from 4 then
    raise exception '0420: los claims no subieron la versión del documento';
  end if;
  -- Un lease fuera de rango se rechaza.
  begin
    perform * from public.cp_documento_reclamar('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000d3', 5);
    raise exception '0420: se aceptó un lease de 5 s';
  exception when raise_exception then
    if sqlerrm like '0420:%' then raise; end if;
  end;
end $$;

-- (e) versiones de perfil inmutables.
insert into public.cp_perfil_version (perfil_id, tenant_id, version, mapeos, ejemplos)
values ('42000000-0000-4000-8000-0000000000e1', '42000000-0000-4000-8000-0000000000a1', 1,
        '[{"campo":"origen_cp","fuente":{"tipo":"columna","encabezado":"CP ORIGEN"}}]'::jsonb, '[]'::jsonb);
do $$
begin
  begin
    update public.cp_perfil_version set mapeos = '[]'::jsonb where perfil_id = '42000000-0000-4000-8000-0000000000e1' and version = 1;
    raise exception '0420: se pudo editar una versión de perfil existente';
  exception when check_violation then null;
  end;
  begin
    insert into public.cp_perfil_version (perfil_id, tenant_id, version, ejemplos)
    values ('42000000-0000-4000-8000-0000000000e1', '42000000-0000-4000-8000-0000000000a1', 2,
            '[1,2,3,4,5,6]'::jsonb);
    raise exception '0420: el CHECK dejó pasar 6 ejemplos';
  exception when check_violation then null;
  end;
  begin
    insert into public.cp_perfil_version (perfil_id, tenant_id, version, mapeos)
    values ('42000000-0000-4000-8000-0000000000e1', '42000000-0000-4000-8000-0000000000a1', 3, '{"a":1}'::jsonb);
    raise exception '0420: el CHECK dejó pasar mapeos que no son lista';
  exception when check_violation then null;
  end;
  begin
    insert into public.cp_perfil_version (perfil_id, tenant_id, version)
    values ('42000000-0000-4000-8000-0000000000e1', '42000000-0000-4000-8000-0000000000b1', 4);
    raise exception '0420: una versión de la flota B se colgó de un perfil de la flota A';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.cp_perfil (tenant_id, clave, nombre, formato) values ('42000000-0000-4000-8000-0000000000a1', 'Mala Clave', 'x', 'excel');
    raise exception '0420: el CHECK dejó pasar una clave de perfil con mayúsculas y espacio';
  exception when check_violation then null;
  end;
  begin
    insert into public.cp_perfil (tenant_id, clave, nombre, formato) values ('42000000-0000-4000-8000-0000000000a1', 'cliente-a-excel', 'dup', 'excel');
    raise exception '0420: la clave de perfil se repitió en la misma flota';
  exception when unique_violation then null;
  end;
  -- La misma clave en OTRA flota sí.
  insert into public.cp_perfil (tenant_id, clave, nombre, formato) values ('42000000-0000-4000-8000-0000000000b1', 'cliente-a-excel', 'otra flota', 'excel');
end $$;

-- cp_buzon: token con la forma de la casa y único.
do $$
begin
  insert into public.cp_buzon (tenant_id, token) values ('42000000-0000-4000-8000-0000000000a1', 'abcdefghjkmnpqrstvwxyz23');
  begin
    insert into public.cp_buzon (tenant_id, token) values ('42000000-0000-4000-8000-0000000000b1', 'abcdefghjkmnpqrstvwxyz23');
    raise exception '0420: dos flotas con el mismo token de buzón';
  exception when unique_violation then null;
  end;
  begin
    insert into public.cp_buzon (tenant_id, token) values ('42000000-0000-4000-8000-0000000000b1', 'ABCDEFGHJKMNPQRSTVWXYZ23');
    raise exception '0420: el CHECK dejó pasar un token en mayúsculas';
  exception when check_violation then null;
  end;
  begin
    insert into public.cp_buzon (tenant_id, token) values ('42000000-0000-4000-8000-0000000000b1', 'abcdefghjkmnpqrstvwxyz0l');
    raise exception '0420: el CHECK dejó pasar un token con caracteres ambiguos';
  exception when check_violation then null;
  end;
end $$;

-- cp_export_config: formato en dominio y config objeto.
do $$
begin
  insert into public.cp_export_config (tenant_id, nombre, formato, config)
  values ('42000000-0000-4000-8000-0000000000a1', 'el cliente de demo CSV', 'csv', '{"columnas":[]}'::jsonb);
  begin
    insert into public.cp_export_config (tenant_id, nombre, formato, config)
    values ('42000000-0000-4000-8000-0000000000a1', 'x', 'xml', '{}'::jsonb);
    raise exception '0420: el CHECK dejó pasar formato xml de exportación';
  exception when check_violation then null;
  end;
  begin
    insert into public.cp_export_config (tenant_id, nombre, formato, config)
    values ('42000000-0000-4000-8000-0000000000a1', 'y', 'json', '[]'::jsonb);
    raise exception '0420: el CHECK dejó pasar una config que no es objeto';
  exception when check_violation then null;
  end;
  begin
    insert into public.cp_export_config (tenant_id, nombre, formato, config)
    values ('42000000-0000-4000-8000-0000000000a1', 'el cliente de demo CSV', 'csv', '{}'::jsonb);
    raise exception '0420: el nombre de exportación se repitió en la flota';
  exception when unique_violation then null;
  end;
end $$;

-- (g) retención: solo lo vencido y no purgado.
insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, storage_ruta, retener_hasta)
values
  ('42000000-0000-4000-8000-0000000000d4', '42000000-0000-4000-8000-0000000000a1', 'manual', 'pdf_texto', 'v1.pdf', 5, repeat('6', 64), 'a/v1', now() - interval '1 day'),
  ('42000000-0000-4000-8000-0000000000d5', '42000000-0000-4000-8000-0000000000a1', 'manual', 'pdf_texto', 'v2.pdf', 5, repeat('7', 64), 'a/v2', now() + interval '1 day');
insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, storage_ruta, texto_extracto, retener_hasta, purgado_en)
values ('42000000-0000-4000-8000-0000000000d6', '42000000-0000-4000-8000-0000000000a1', 'manual', 'pdf_texto', 'v3.pdf', 5, repeat('8', 64), null, null, now() - interval '5 days', now());
do $$
declare ids uuid[];
begin
  select array_agg(id) into ids from public.cp_documentos_vencidos(100) where tenant_id = '42000000-0000-4000-8000-0000000000a1';
  if not ('42000000-0000-4000-8000-0000000000d4' = any(ids)) then raise exception '0420: el documento vencido no salió en cp_documentos_vencidos'; end if;
  if '42000000-0000-4000-8000-0000000000d5' = any(ids) then raise exception '0420: un documento VIGENTE salió como vencido'; end if;
  if '42000000-0000-4000-8000-0000000000d6' = any(ids) then raise exception '0420: un documento ya PURGADO salió otra vez como vencido'; end if;
  begin
    perform * from public.cp_documentos_vencidos(0);
    raise exception '0420: se aceptó un límite de 0';
  exception when raise_exception then
    if sqlerrm like '0420:%' then raise; end if;
  end;
end $$;

-- (f) la bitácora es append-only para service_role.
insert into public.cp_documento_evento (documento_id, tenant_id, tipo, detalle)
values ('42000000-0000-4000-8000-0000000000d1', '42000000-0000-4000-8000-0000000000a1', 'recibido', '{"canal":"manual"}'::jsonb);
do $$
begin
  begin
    update public.cp_documento_evento set tipo = 'aprobado';
    raise exception '0420: service_role pudo EDITAR la bitácora';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.cp_documento_evento;
    raise exception '0420: service_role pudo BORRAR la bitácora';
  exception when insufficient_privilege then null;
  end;
end $$;

-- (f) anon y authenticated no leen ni escriben NADA.
reset role;
do $$
declare t text; rol text;
begin
  foreach rol in array array['anon', 'authenticated'] loop
    execute format('set local role %I', rol);
    foreach t in array array['cp_buzon', 'cp_perfil', 'cp_perfil_version', 'cp_documento', 'cp_documento_evento', 'cp_correccion', 'cp_export_config'] loop
      begin
        execute format('select 1 from public.%I limit 1', t);
        raise exception '0420: % pudo LEER %', rol, t;
      exception when insufficient_privilege then null;
      end;
      begin
        execute format('delete from public.%I', t);
        raise exception '0420: % pudo BORRAR en %', rol, t;
      exception when insufficient_privilege then null;
      end;
    end loop;
    begin
      perform * from public.cp_documento_reclamar('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000d3', 60);
      raise exception '0420: % pudo ejecutar cp_documento_reclamar', rol;
    exception when insufficient_privilege then null;
    end;
    begin
      perform * from public.cp_documentos_vencidos(10);
      raise exception '0420: % pudo ejecutar cp_documentos_vencidos', rol;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
end $$;

-- (e) la cascada: borrar la flota B arrastra todo lo suyo.
do $$
declare n int;
begin
  insert into public.cp_documento_evento (documento_id, tenant_id, tipo)
  select id, tenant_id, 'recibido' from public.cp_documento where tenant_id = '42000000-0000-4000-8000-0000000000b1' limit 1;
  delete from public.tenant where id = '42000000-0000-4000-8000-0000000000b1';
  select count(*) into n from (
    select 1 from public.cp_documento where tenant_id = '42000000-0000-4000-8000-0000000000b1'
    union all select 1 from public.cp_documento_evento where tenant_id = '42000000-0000-4000-8000-0000000000b1'
    union all select 1 from public.cp_perfil where tenant_id = '42000000-0000-4000-8000-0000000000b1'
  ) x;
  if n <> 0 then raise exception '0420: borrar la flota dejó % filas de Carta Porte', n; end if;
  -- La flota A sigue entera.
  if (select count(*) from public.cp_documento where tenant_id = '42000000-0000-4000-8000-0000000000a1') < 5 then
    raise exception '0420: borrar la flota B tocó documentos de la flota A';
  end if;
end $$;

-- (h) 0421: el CHECK de modelo_rol.
do $$
declare r text;
begin
  foreach r in array array[
    'ocr', 'cuadre', 'cuadre_fallback', 'chat', 'back_office', 'analisis', 'extraccion', 'marketing', 'codigo',
    'codigo_escritura', 'qa', 'piloto', 'transcripcion', 'contador',
    'cartaporte_extractor', 'cartaporte_extractor_escala', 'cartaporte_extractor_escala2'
  ] loop
    insert into public.agente_definicion (id, nombre, departamento, disparador, estado, descripcion, modelo_rol)
    values ('t0421_' || r, 'prueba ' || r, 'producto', 'manual', 'disenado', 'x', r);
  end loop;
  begin
    insert into public.agente_definicion (id, nombre, departamento, disparador, estado, descripcion, modelo_rol)
    values ('t0421_malo', 'malo', 'producto', 'manual', 'disenado', 'x', 'rol_inventado');
    raise exception '0421: el CHECK dejó pasar un rol inventado';
  exception when check_violation then null;
  end;
end $$;

rollback;
\echo 0420_carta_porte_multiformato: OK
