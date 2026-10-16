\set ON_ERROR_STOP on
-- 0815 — Acción sobre un candidato de peaje, contra Postgres REAL.
-- Lo que solo la base puede demostrar: una acción por (flota, desglose, renglón, categoría) y repetible entre
-- flotas; la acción es solo reclamado/descartado/justificado; descartar y justificar exigen motivo de 3 a 300
-- caracteres y reclamar no lo lleva; solo un reclamado lleva reclamo; las FK compuestas impiden colgar la acción
-- de un desglose o un reclamo de otra flota; borrar el reclamo deja la acción sin reclamo (no la borra); borrar el
-- desglose la borra; nace vacía con RLS deny-all.
begin;

insert into public.tenant (id, nombre) values
  ('81500000-0000-4000-8000-0000000000a1', 'Flota A 0815'),
  ('81500000-0000-4000-8000-0000000000b1', 'Flota B 0815');
insert into public.desglose_peaje (id, tenant_id, proveedor) values
  ('81500000-0000-4000-8000-0000000000a2', '81500000-0000-4000-8000-0000000000a1', 'Proveedor Ejemplo'),
  ('81500000-0000-4000-8000-0000000000b2', '81500000-0000-4000-8000-0000000000b1', 'Proveedor Ejemplo');
insert into public.peaje_reclamo (id, tenant_id, desglose_id, categoria, fecha_cobro_mas_antiguo)
  values ('81500000-0000-4000-8000-0000000000a3', '81500000-0000-4000-8000-0000000000a1', '81500000-0000-4000-8000-0000000000a2', 'extemporaneo', '2026-09-01'),
         ('81500000-0000-4000-8000-0000000000b3', '81500000-0000-4000-8000-0000000000b1', '81500000-0000-4000-8000-0000000000b2', 'extemporaneo', '2026-09-01');

do $$
declare
  A constant uuid := '81500000-0000-4000-8000-0000000000a1';
  B constant uuid := '81500000-0000-4000-8000-0000000000b1';
  DA constant uuid := '81500000-0000-4000-8000-0000000000a2';
  DB constant uuid := '81500000-0000-4000-8000-0000000000b2';
  RA constant uuid := '81500000-0000-4000-8000-0000000000a3';
  RB constant uuid := '81500000-0000-4000-8000-0000000000b3';
  n int;
  rls boolean;
begin
  select count(*) into n from public.peaje_candidato_accion;
  if n <> 0 then raise exception '0815: la tabla no nació vacía (%)', n; end if;

  insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, reclamo_id, actor)
    values (A, DA, 3, 'extemporaneo', 'reclamado', RA, 'panel:flota_admin');
  insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, motivo, actor)
    values (A, DA, 4, 'extemporaneo', 'descartado', 'Ya lo cobraron en otro archivo', 'panel:flota_admin');
  insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, motivo, actor)
    values (B, DB, 3, 'extemporaneo', 'justificado', 'Salida autorizada', 'panel:flota_admin');   -- otra flota, mismo renglón

  begin
    insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, motivo, actor)
      values (A, DA, 3, 'extemporaneo', 'descartado', 'Otro motivo', 'panel:flota_admin');
    raise exception '0815: la acción se duplicó (misma flota, desglose, renglón y categoría)';
  exception when unique_violation then null; end;
  begin
    insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, motivo, actor)
      values (A, DA, 5, 'extemporaneo', 'borrado', 'x motivo', 'panel:flota_admin');
    raise exception '0815: la base admitió una acción inventada';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, actor)
      values (A, DA, 6, 'extemporaneo', 'descartado', 'panel:flota_admin');
    raise exception '0815: la base admitió descartar sin motivo';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, motivo, actor)
      values (A, DA, 7, 'extemporaneo', 'justificado', 'ab', 'panel:flota_admin');
    raise exception '0815: la base admitió un motivo de menos de 3 caracteres';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, motivo, actor)
      values (A, DA, 8, 'extemporaneo', 'justificado', repeat('x', 301), 'panel:flota_admin');
    raise exception '0815: la base admitió un motivo de más de 300 caracteres';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, motivo, actor)
      values (A, DA, 9, 'extemporaneo', 'reclamado', 'no lleva motivo', 'panel:flota_admin');
    raise exception '0815: la base admitió un reclamado con motivo';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, motivo, reclamo_id, actor)
      values (A, DA, 10, 'extemporaneo', 'descartado', 'Con reclamo ajeno', RA, 'panel:flota_admin');
    raise exception '0815: la base admitió un descartado con reclamo';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, actor)
      values (A, DB, 11, 'extemporaneo', 'reclamado', 'panel:flota_admin');
    raise exception '0815: la acción se colgó del desglose de otra flota';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.peaje_candidato_accion (tenant_id, desglose_id, indice, categoria, accion, reclamo_id, actor)
      values (A, DA, 12, 'extemporaneo', 'reclamado', RB, 'panel:flota_admin');
    raise exception '0815: la acción se ligó al reclamo de otra flota';
  exception when foreign_key_violation then null; end;

  -- Borrar el reclamo deja la acción reclamada, sin reclamo.
  delete from public.peaje_reclamo where id = RA;
  select count(*) into n from public.peaje_candidato_accion where tenant_id = A and indice = 3 and reclamo_id is null and accion = 'reclamado';
  if n <> 1 then raise exception '0815: borrar el reclamo no dejó la acción sin reclamo (%)', n; end if;

  -- Borrar el desglose borra sus acciones.
  delete from public.desglose_peaje where id = DA;
  select count(*) into n from public.peaje_candidato_accion where tenant_id = A;
  if n <> 0 then raise exception '0815: borrar el desglose no borró sus acciones (%)', n; end if;

  select relrowsecurity into rls from pg_class where oid = 'public.peaje_candidato_accion'::regclass;
  if not rls then raise exception '0815: la tabla nació sin RLS'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'peaje_candidato_accion';
  if n <> 0 then raise exception '0815: la tabla debe ser deny-all (sin políticas), hay %', n; end if;
end $$;

rollback;
\echo 0815 OK
