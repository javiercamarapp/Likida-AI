\set ON_ERROR_STOP on
-- 0794 — CARTA PORTE: el CCP ya timbrado que el TMS avisa (cp_ccp_timbrado, cp_salida_config.responder_ccp).
--
-- Lo que SOLO la base puede demostrar (todo dentro de una transacción revertida, datos sintéticos):
--   (a) la tabla nace VACÍA y el interruptor responder_ccp nace APAGADO;
--   (b) el UUID fiscal es único por flota (el mismo aviso dos veces = una fila; el mismo UUID en OTRA flota sí cabe);
--   (c) la FK compuesta impide ligar un CCP a un documento o envío de OTRA flota;
--   (d) CHECKs: forma del UUID, dominio de estado, destino con forma de correo, estado=respondido ⇔ respondido_en,
--       respondido exige destino;
--   (e) cp_ccp_marcar_respondido es atómica: la primera llamada gana y la segunda devuelve false; no actúa sobre otra flota;
--   (f) cp_ccp_liberar_respuesta suelta el candado (queda error_envio y se puede volver a ganar);
--   (g) permisos: anon/authenticated sin acceso (ni a las funciones), service_role sí, RLS encendida.
begin;

do $$
begin
  if (select count(*) from public.cp_ccp_timbrado) <> 0 then
    raise exception 'CCPT_0794 la tabla debía nacer vacía';
  end if;
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'cp_salida_config' and column_name = 'responder_ccp') <> 'false' then
    raise exception 'CCPT_0794 responder_ccp debía nacer apagado (default false)';
  end if;
end $$;

-- ── Datos sintéticos: dos flotas, un documento y un envío en cada una ─────────
do $$
declare ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); da uuid; db uuid; ea uuid; eb uuid;
begin
  insert into public.tenant (id, nombre) values (ta, 'Flota sintetica A'), (tb, 'Flota sintetica B');
  insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256) values (ta, 'correo', 'pdf', 'a.pdf', 1, repeat('a', 64)) returning id into da;
  insert into public.cp_documento (tenant_id, canal, formato, nombre_archivo, bytes, sha256) values (tb, 'correo', 'pdf', 'b.pdf', 1, repeat('b', 64)) returning id into db;
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key) values (ta, da, 1, 'llave-sintetica-a') returning id into ea;
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key) values (tb, db, 1, 'llave-sintetica-b') returning id into eb;
  create temp table datos_0794 on commit drop as select ta, tb, da, db, ea, eb;
  grant select on datos_0794 to service_role;
end $$;

set local role service_role;

do $$
declare
  d record; ok_dup boolean := false; otra_flota boolean; fk_doc boolean := false; fk_env boolean := false; malos int := 0;
  id1 uuid; g1 boolean; g2 boolean; ajena boolean; lib boolean; g3 boolean; g4 boolean;
begin
  select * into d from datos_0794;

  -- (b) unicidad por flota
  insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta)
    values (d.ta, d.da, d.ea, 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb', 'a.pdf', 'a.xml') returning id into id1;
  begin
    insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta)
      values (d.ta, d.da, d.ea, 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb', 'a2.pdf', 'a2.xml');
  exception when unique_violation then ok_dup := true; end;
  insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta)
    values (d.tb, d.db, d.eb, 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb', 'b.pdf', 'b.xml');
  otra_flota := true;

  -- (c) FK compuesta: el documento o el envío de la OTRA flota no se pueden ligar
  begin
    insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta)
      values (d.ta, d.db, d.ea, 'cccccccc-1111-4222-8333-dddddddddddd', 'x.pdf', 'x.xml');
  exception when foreign_key_violation then fk_doc := true; end;
  begin
    insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta)
      values (d.ta, d.da, d.eb, 'cccccccc-1111-4222-8333-dddddddddddd', 'x.pdf', 'x.xml');
  exception when foreign_key_violation then fk_env := true; end;

  -- (d) CHECKs
  begin insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta) values (d.ta, d.da, d.ea, 'no-es-uuid', 'x', 'y'); exception when check_violation then malos := malos + 1; end;
  begin insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta) values (d.ta, d.da, d.ea, 'AAAAAAAA-1111-4222-8333-BBBBBBBBBBBB', 'x', 'y'); exception when check_violation then malos := malos + 1; end;
  begin insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta, estado) values (d.ta, d.da, d.ea, 'dddddddd-1111-4222-8333-bbbbbbbbbbbb', 'x', 'y', 'inventado'); exception when check_violation then malos := malos + 1; end;
  begin insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta, destino_correo) values (d.ta, d.da, d.ea, 'dddddddd-1111-4222-8333-bbbbbbbbbbbb', 'x', 'y', 'sin-arroba'); exception when check_violation then malos := malos + 1; end;
  begin insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta, estado) values (d.ta, d.da, d.ea, 'dddddddd-1111-4222-8333-bbbbbbbbbbbb', 'x', 'y', 'respondido'); exception when check_violation then malos := malos + 1; end;
  begin insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta, respondido_en) values (d.ta, d.da, d.ea, 'dddddddd-1111-4222-8333-bbbbbbbbbbbb', 'x', 'y', now()); exception when check_violation then malos := malos + 1; end;
  begin insert into cp_ccp_timbrado (tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta) values (d.ta, d.da, d.ea, 'dddddddd-1111-4222-8333-bbbbbbbbbbbb', '', 'y'); exception when check_violation then malos := malos + 1; end;

  -- (e) el candado atómico: sin destino no gana; con destino, UNA sola llamada
  g1 := cp_ccp_marcar_respondido(d.ta, id1);                       -- sin destino_correo: false
  update cp_ccp_timbrado set destino_correo = 'cliente@ejemplo.test' where id = id1;
  ajena := cp_ccp_marcar_respondido(d.tb, id1);                    -- la flota B no puede tomar la fila de A: false
  g2 := cp_ccp_marcar_respondido(d.ta, id1);                       -- gana
  g3 := cp_ccp_marcar_respondido(d.ta, id1);                       -- la segunda ya no
  -- (f) suelta el candado y se puede volver a ganar
  lib := cp_ccp_liberar_respuesta(d.ta, id1);
  g4 := cp_ccp_marcar_respondido(d.ta, id1);

  if not (ok_dup and otra_flota and fk_doc and fk_env and malos = 7
          and g1 = false and ajena = false and g2 = true and g3 = false and lib = true and g4 = true) then
    raise exception E'CCPT_0794 unico=% otra-flota=% fk-doc=% fk-envio=% checks=%/7 sin-destino=% ajena=% gana=% segunda=% liberar=% regana=%   (esperado t/t/t/t/7/f/f/t/f/t/t)',
      ok_dup, otra_flota, fk_doc, fk_env, malos, g1, ajena, g2, g3, lib, g4;
  end if;
  if (select estado from cp_ccp_timbrado where id = id1) <> 'respondido' or (select respondido_en from cp_ccp_timbrado where id = id1) is null then
    raise exception 'CCPT_0794 tras re-ganar el candado la fila debía quedar respondida con fecha';
  end if;
  if (select count(*) from cp_ccp_timbrado where estado = 'respondido' and respondido_en is null) <> 0 then
    raise exception 'CCPT_0794 hay filas respondidas sin fecha';
  end if;
end $$;

-- ── (g) permisos ──────────────────────────────────────────────────────────
reset role;
do $$
declare r text; abierto boolean := false;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.cp_ccp_timbrado', 'select') or has_table_privilege(r, 'public.cp_ccp_timbrado', 'insert,update,delete') then abierto := true; end if;
    if has_function_privilege(r, 'public.cp_ccp_marcar_respondido(uuid,uuid)', 'execute')
       or has_function_privilege(r, 'public.cp_ccp_liberar_respuesta(uuid,uuid)', 'execute') then abierto := true; end if;
  end loop;
  if not has_table_privilege('service_role', 'public.cp_ccp_timbrado', 'select,insert,update,delete') then abierto := true; end if;
  if not has_function_privilege('service_role', 'public.cp_ccp_marcar_respondido(uuid,uuid)', 'execute') then abierto := true; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.cp_ccp_timbrado'::regclass) then abierto := true; end if;
  if abierto then
    raise exception 'CCPT_0794 permisos: authenticated/anon con acceso, service_role sin él, o RLS apagada';
  end if;
end $$;

rollback;
select 'CCPT_0794 OK' as resultado;
