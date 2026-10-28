\set ON_ERROR_STOP on
-- 0928 — A39-S20-01: rentabilidad_tenant mide ingreso y costo sobre el MISMO universo (viajes con liquidación
-- vigente); A39-S57-03: sat_paquete_xml (cache de paquetes grandes del SAT) existe, es de la flota y no es accesible
-- para anon/authenticated. Datos sintéticos y rollback.
begin;

insert into public.tenant (id, nombre) values
  ('92800000-0000-4000-8000-0000000000a1', 'Flota 0928 A'),
  ('92800000-0000-4000-8000-0000000000b1', 'Flota 0928 B');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('92800000-0000-4000-8000-0000000000a2', '92800000-0000-4000-8000-0000000000a1', 'Operador 0928', '529999909281'),
  ('92800000-0000-4000-8000-0000000000a3', '92800000-0000-4000-8000-0000000000a1', 'Operador 0928 b', '529999909282'),
  ('92800000-0000-4000-8000-0000000000a4', '92800000-0000-4000-8000-0000000000a1', 'Operador 0928 c', '529999909283');
-- A: liquidado con ingreso 10000 (costo 4000), liquidado SIN ingreso (costo 500), abierto con ingreso 8000 (sin liquidación),
--    en cuadre con ingreso 6000 cuya única liquidación fue rechazada (costo 9000 que NO cuenta).
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, fecha_inicio, anticipo, ingreso_flete, created_at) values
  ('92800000-0000-4000-8000-000000000001', '92800000-0000-4000-8000-0000000000a1', '92800000-0000-4000-8000-0000000000a2', 'A928-1', 'liquidado', '2026-09-01', 0, 10000, '2026-09-01T12:00:00Z'),
  ('92800000-0000-4000-8000-000000000002', '92800000-0000-4000-8000-0000000000a1', '92800000-0000-4000-8000-0000000000a2', 'A928-2', 'liquidado', '2026-09-01', 0, null,  '2026-09-01T12:00:00Z'),
  ('92800000-0000-4000-8000-000000000003', '92800000-0000-4000-8000-0000000000a1', '92800000-0000-4000-8000-0000000000a3', 'A928-3', 'abierto',   '2026-09-01', 0, 8000,  '2026-09-01T12:00:00Z'),
  ('92800000-0000-4000-8000-000000000004', '92800000-0000-4000-8000-0000000000a1', '92800000-0000-4000-8000-0000000000a4', 'A928-4', 'en_cuadre', '2026-09-01', 0, 6000,  '2026-09-01T12:00:00Z');
set local likida.revision_en_curso = '1';
insert into public.liquidacion (id, tenant_id, viaje_id, revision, revisada_en, motivo, estatus, total_comprobado, total_anticipo, diferencia, diferencias, created_at) values
  ('92800000-0000-4000-8000-000000000201', '92800000-0000-4000-8000-0000000000a1', '92800000-0000-4000-8000-000000000001', 'aprobada',  '2026-09-01T12:00:00Z', null, 'cuadrada', 4000, 4000, 0, '[]', '2026-09-20T12:00:00Z'),
  ('92800000-0000-4000-8000-000000000202', '92800000-0000-4000-8000-0000000000a1', '92800000-0000-4000-8000-000000000002', 'aprobada',  '2026-09-01T12:00:00Z', null, 'cuadrada',  500,  500, 0, '[]', '2026-09-20T12:00:00Z'),
  ('92800000-0000-4000-8000-000000000204', '92800000-0000-4000-8000-0000000000a1', '92800000-0000-4000-8000-000000000004', 'rechazada', '2026-09-01T12:00:00Z', 'Revisión sintética', 'cuadrada', 9000, 9000, 0, '[]', '2026-09-20T12:00:00Z');
set local likida.revision_en_curso = '';
set constraints all immediate;

do $$
declare j jsonb;
begin
  -- Histórico: universo = viajes 1 y 2 (los únicos con liquidación vigente).
  j := public.rentabilidad_tenant('92800000-0000-4000-8000-0000000000a1', null);
  if (j->>'ingreso')::numeric <> 10000 then raise exception '0928: el ingreso incluye viajes sin liquidación vigente: %', j; end if;
  if (j->>'costoComprobado')::numeric <> 4500 then raise exception '0928: el costo no es el de las liquidaciones vigentes: %', j; end if;
  if (j->>'viajesConIngreso')::int <> 1 or (j->>'viajesSinIngreso')::int <> 1 then raise exception '0928: conteos de ingreso fuera del universo: %', j; end if;
  if (j->>'viajesSinLiquidar')::int <> 2 then raise exception '0928: viajesSinLiquidar debería ser 2 (el abierto y el de la rechazada): %', j; end if;

  -- El periodo acota por VIAJE: una ventana posterior a la fecha del viaje lo deja fuera aunque su liquidación sea posterior.
  j := public.rentabilidad_tenant('92800000-0000-4000-8000-0000000000a1', '2026-09-10T00:00:00Z');
  if (j->>'ingreso')::numeric <> 0 or (j->>'costoComprobado')::numeric <> 0 or (j->>'viajesSinLiquidar')::int <> 0 then
    raise exception '0928: el periodo no acotó por la fecha del viaje: %', j;
  end if;

  -- Otra flota: ni un peso de A.
  j := public.rentabilidad_tenant('92800000-0000-4000-8000-0000000000b1', null);
  if (j->>'ingreso')::numeric <> 0 or (j->>'costoComprobado')::numeric <> 0 or (j->>'viajesSinLiquidar')::int <> 0 then
    raise exception '0928: la flota B ve cifras de A: %', j;
  end if;
end $$;

-- sat_paquete_xml: nace vacío, cuelga de la solicitud (misma flota) y se borra con ella.
insert into public.sat_descarga_solicitud (id, tenant_id, tipo, desde, hasta, estado)
  values ('92800000-0000-4000-8000-000000000301', '92800000-0000-4000-8000-0000000000a1', 'recibidos', '2026-07-01', '2026-07-31', 'lista');
do $$
begin
  insert into public.sat_paquete_xml (tenant_id, solicitud_id, paquete, indice, total, xml)
    values ('92800000-0000-4000-8000-0000000000a1', '92800000-0000-4000-8000-000000000301', 'p1', 0, 2, '<x/>');
  -- La posición es única por (solicitud, paquete, índice).
  begin
    insert into public.sat_paquete_xml (tenant_id, solicitud_id, paquete, indice, total, xml)
      values ('92800000-0000-4000-8000-0000000000a1', '92800000-0000-4000-8000-000000000301', 'p1', 0, 2, '<y/>');
    raise exception '0928: aceptó la misma posición dos veces';
  exception when unique_violation then null;
  end;
  -- Un índice fuera del total no entra.
  begin
    insert into public.sat_paquete_xml (tenant_id, solicitud_id, paquete, indice, total, xml)
      values ('92800000-0000-4000-8000-0000000000a1', '92800000-0000-4000-8000-000000000301', 'p1', 5, 2, '<w/>');
    raise exception '0928: aceptó un índice fuera del total';
  exception when check_violation then null;
  end;
  -- Una fila de OTRA flota para esa solicitud no entra (FK compuesta).
  begin
    insert into public.sat_paquete_xml (tenant_id, solicitud_id, paquete, indice, total, xml)
      values ('92800000-0000-4000-8000-0000000000b1', '92800000-0000-4000-8000-000000000301', 'p1', 1, 2, '<z/>');
    raise exception '0928: aceptó un paquete de otra flota sobre la solicitud';
  exception when foreign_key_violation then null;
  end;
  if has_table_privilege('anon', 'public.sat_paquete_xml', 'select') or has_table_privilege('authenticated', 'public.sat_paquete_xml', 'select') then
    raise exception '0928: anon/authenticated pueden leer sat_paquete_xml';
  end if;
  delete from public.sat_descarga_solicitud where id = '92800000-0000-4000-8000-000000000301';
  if exists (select 1 from public.sat_paquete_xml where solicitud_id = '92800000-0000-4000-8000-000000000301') then
    raise exception '0928: borrar la solicitud no limpió su cache';
  end if;
end $$;

rollback;
