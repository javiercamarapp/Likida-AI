\set ON_ERROR_STOP on
-- 0541 — CANCELACIÓN DE CFDI DE CARTA PORTE. Lo que solo la base garantiza (rollback):
--   (a) la cancelación solo existe sobre un timbre con UUID (no sobre una reserva);
--   (b) motivo del catálogo SAT 01-04 y folio de sustitución si y solo si es 01;
--   (c) estado='cancelado' exige confirmación humana (o ser un cancelado histórico sin cancelacion_estado);
--   (d) en_proceso no libera el viaje: el unique parcial sigue bloqueando un segundo timbre vigente;
--   (e) confirmada + cancelado libera el viaje para re-timbrar la corrección.
begin;
insert into public.tenant (id, nombre) values ('54100000-0000-4000-8000-0000000000a1', 'Flota 0541');
insert into public.app_user (id, tenant_id, email, nombre, rol, activo) values
  ('54100000-0000-4000-8000-0000000000c1', '54100000-0000-4000-8000-0000000000a1', 'dueno-0541@test.invalid', 'Dueño', 'flota_admin', true);
insert into public.operador (id, tenant_id, nombre, telefono) values ('54100000-0000-4000-8000-0000000000e1', '54100000-0000-4000-8000-0000000000a1', 'Op', '5210000005410');
insert into public.viaje (id, tenant_id, operador_id) values ('54100000-0000-4000-8000-0000000000f1', '54100000-0000-4000-8000-0000000000a1', '54100000-0000-4000-8000-0000000000e1');

do $$
declare
  A constant uuid := '54100000-0000-4000-8000-0000000000a1';
  V constant uuid := '54100000-0000-4000-8000-0000000000f1';
  U constant uuid := '54100000-0000-4000-8000-0000000000c1';
  t uuid;
begin
  -- (a) una RESERVA (sin uuid) no puede traer cancelación
  insert into public.ccp_timbre (tenant_id, viaje_id, estado, proveedor, modo, reservado_en)
    values (A, V, 'pendiente', 'sw', 'sandbox', now()) returning id into t;
  begin
    update public.ccp_timbre set cancelacion_estado = 'solicitada', cancelacion_motivo = '02' where id = t;
    raise exception '0541: pidió cancelar una reserva sin UUID';
  exception when check_violation then null; end;
  delete from public.ccp_timbre where id = t;

  insert into public.ccp_timbre (tenant_id, viaje_id, estado, proveedor, modo, uuid_fiscal, fecha_timbrado, xml)
    values (A, V, 'vigente', 'sw', 'sandbox', 'fd53505e-d737-43ab-815c-8090edec3655', now(), '<x/>') returning id into t;

  -- (b) motivo y folio
  begin update public.ccp_timbre set cancelacion_estado = 'solicitada', cancelacion_motivo = '09' where id = t;
    raise exception '0541: aceptó el motivo 09'; exception when check_violation then null; end;
  begin update public.ccp_timbre set cancelacion_estado = 'solicitada', cancelacion_motivo = '01' where id = t;
    raise exception '0541: motivo 01 sin folio de sustitución'; exception when check_violation then null; end;
  begin update public.ccp_timbre set cancelacion_estado = 'solicitada', cancelacion_motivo = '02', cancelacion_folio_sustitucion = 'abc' where id = t;
    raise exception '0541: motivo 02 con folio de sustitución'; exception when check_violation then null; end;
  begin update public.ccp_timbre set cancelacion_estado = 'solicitada' where id = t;
    raise exception '0541: cancelación sin motivo'; exception when check_violation then null; end;
  begin update public.ccp_timbre set cancelacion_estado = 'rara', cancelacion_motivo = '02' where id = t;
    raise exception '0541: estado de cancelación inválido'; exception when check_violation then null; end;

  update public.ccp_timbre set cancelacion_estado = 'solicitada', cancelacion_motivo = '02', cancelacion_solicitada_en = now(), cancelacion_solicitada_por = U where id = t;
  update public.ccp_timbre set cancelacion_estado = 'en_proceso', cancelacion_codigo = '201' where id = t;

  -- (c) cancelado sin confirmación humana: no
  begin update public.ccp_timbre set estado = 'cancelado' where id = t;
    raise exception '0541: marcó cancelado con la cancelación solo en proceso'; exception when check_violation then null; end;

  -- (d) en_proceso no libera: un segundo timbre vigente del mismo viaje rebota
  begin
    insert into public.ccp_timbre (tenant_id, viaje_id, estado, proveedor, modo, uuid_fiscal, fecha_timbrado, xml)
      values (A, V, 'vigente', 'sw', 'sandbox', 'aaaaaaaa-d737-43ab-815c-8090edec3655', now(), '<y/>');
    raise exception '0541: timbró otra vez con la cancelación sin confirmar';
  exception when unique_violation then null; end;

  -- (e) confirmada + cancelado libera
  update public.ccp_timbre set cancelacion_estado = 'confirmada', cancelacion_confirmada_en = now(), cancelacion_confirmada_por = U, estado = 'cancelado' where id = t;
  insert into public.ccp_timbre (tenant_id, viaje_id, estado, proveedor, modo, uuid_fiscal, fecha_timbrado, xml)
    values (A, V, 'vigente', 'sw', 'sandbox', 'bbbbbbbb-d737-43ab-815c-8090edec3655', now(), '<z/>');

  -- histórico: un cancelado sin cancelacion_estado (cancelado fuera de Likida) sigue siendo válido
  insert into public.ccp_timbre (tenant_id, viaje_id, estado, proveedor, modo, uuid_fiscal, fecha_timbrado, xml)
    values (A, V, 'cancelado', 'sw', 'sandbox', 'cccccccc-d737-43ab-815c-8090edec3655', now(), '<h/>');
end $$;
rollback;
