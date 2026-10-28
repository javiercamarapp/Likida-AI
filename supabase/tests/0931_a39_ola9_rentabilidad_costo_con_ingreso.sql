\set ON_ERROR_STOP on
-- 0931 — A39-S20-01 (residuo): rentabilidad_tenant cuenta el costo SOLO de los viajes con ingreso_flete (mismo universo que
-- el ingreso). Datos sintéticos y rollback.
begin;

insert into public.tenant (id, nombre) values ('93100000-0000-4000-8000-0000000000a1', 'Flota 0931');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('93100000-0000-4000-8000-0000000000a2', '93100000-0000-4000-8000-0000000000a1', 'Operador 0931', '529999909311');
-- 1: con ingreso 10000 (costo 4000); 2: SIN ingreso (costo 500, NO debe entrar); 3: con ingreso 6000 cuya liquidación fue rechazada.
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, fecha_inicio, anticipo, ingreso_flete, created_at) values
  ('93100000-0000-4000-8000-000000000001', '93100000-0000-4000-8000-0000000000a1', '93100000-0000-4000-8000-0000000000a2', 'A931-1', 'liquidado', '2026-09-01', 0, 10000, '2026-09-01T12:00:00Z'),
  ('93100000-0000-4000-8000-000000000002', '93100000-0000-4000-8000-0000000000a1', '93100000-0000-4000-8000-0000000000a2', 'A931-2', 'liquidado', '2026-09-01', 0, null,  '2026-09-01T12:00:00Z'),
  ('93100000-0000-4000-8000-000000000003', '93100000-0000-4000-8000-0000000000a1', '93100000-0000-4000-8000-0000000000a2', 'A931-3', 'en_cuadre', '2026-09-01', 0, 6000,  '2026-09-01T12:00:00Z');
set local likida.revision_en_curso = '1';
insert into public.liquidacion (id, tenant_id, viaje_id, revision, revisada_en, motivo, estatus, total_comprobado, total_anticipo, diferencia, diferencias, created_at) values
  ('93100000-0000-4000-8000-000000000201', '93100000-0000-4000-8000-0000000000a1', '93100000-0000-4000-8000-000000000001', 'aprobada',  '2026-09-01T12:00:00Z', null, 'cuadrada', 4000, 4000, 0, '[]', '2026-09-20T12:00:00Z'),
  ('93100000-0000-4000-8000-000000000202', '93100000-0000-4000-8000-0000000000a1', '93100000-0000-4000-8000-000000000002', 'aprobada',  '2026-09-01T12:00:00Z', null, 'cuadrada',  500,  500, 0, '[]', '2026-09-20T12:00:00Z'),
  ('93100000-0000-4000-8000-000000000203', '93100000-0000-4000-8000-0000000000a1', '93100000-0000-4000-8000-000000000003', 'rechazada', '2026-09-01T12:00:00Z', 'Revisión sintética', 'cuadrada', 9000, 9000, 0, '[]', '2026-09-20T12:00:00Z');
set local likida.revision_en_curso = '';
set constraints all immediate;

do $$
declare j jsonb;
begin
  j := public.rentabilidad_tenant('93100000-0000-4000-8000-0000000000a1', null);
  if (j->>'ingreso')::numeric <> 10000 then raise exception '0931: ingreso fuera del universo: %', j; end if;
  if (j->>'costoComprobado')::numeric <> 4000 then raise exception '0931: el costo incluye un viaje sin ingreso (o excluye el que sí lo tiene): %', j; end if;
  if (j->>'viajesConIngreso')::int <> 1 or (j->>'viajesSinIngreso')::int <> 1 then raise exception '0931: conteos de ingreso: %', j; end if;
  if (j->>'viajesSinLiquidar')::int <> 1 then raise exception '0931: viajesSinLiquidar debería ser 1 (el de la rechazada): %', j; end if;

  -- Periodo posterior al viaje: todo en cero.
  j := public.rentabilidad_tenant('93100000-0000-4000-8000-0000000000a1', '2026-09-10T00:00:00Z');
  if (j->>'ingreso')::numeric <> 0 or (j->>'costoComprobado')::numeric <> 0 then raise exception '0931: el periodo no acotó: %', j; end if;
end $$;

-- Permisos: solo service_role ejecuta; invoker y search_path fijo.
do $$
declare p record;
begin
  select prosecdef, proconfig into p from pg_proc where oid = 'public.rentabilidad_tenant(uuid, timestamptz)'::regprocedure;
  if p.prosecdef then raise exception '0931: rentabilidad_tenant volvió a ser SECURITY DEFINER'; end if;
  if p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') then
    raise exception '0931: perdió el search_path fijo';
  end if;
  if has_function_privilege('anon', 'public.rentabilidad_tenant(uuid, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.rentabilidad_tenant(uuid, timestamptz)', 'execute') then
    raise exception '0931: anon/authenticated pueden ejecutar rentabilidad_tenant';
  end if;
  if not has_function_privilege('service_role', 'public.rentabilidad_tenant(uuid, timestamptz)', 'execute') then
    raise exception '0931: service_role perdió el execute';
  end if;
end $$;

rollback;
