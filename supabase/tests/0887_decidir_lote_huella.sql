\set ON_ERROR_STOP on
-- 0887 · decidir_lote_emision liga la confirmación a lo que la persona vio (A37-S29-06). Datos sintéticos; todo en una transacción que se revierte.
begin;
insert into public.tenant (id, nombre) values ('88700000-0000-4000-8000-0000000000a1', 'Flota A 0887');
insert into public.app_user (id, tenant_id, email, nombre, rol, activo, desactivado_en) values
  ('88700000-0000-4000-8000-0000000000c1', '88700000-0000-4000-8000-0000000000a1', 'dueno-0887@test.invalid', 'Dueño', 'flota_admin', true, null);
insert into public.operador (id, tenant_id, nombre, telefono) values ('88700000-0000-4000-8000-0000000000e1', '88700000-0000-4000-8000-0000000000a1', 'OpA', '5210000008871');
insert into public.viaje (id, tenant_id, operador_id) values ('88700000-0000-4000-8000-0000000000f1', '88700000-0000-4000-8000-0000000000a1', '88700000-0000-4000-8000-0000000000e1');

set local role service_role;
do $$
declare
  A constant uuid := '88700000-0000-4000-8000-0000000000a1';
  dueno constant uuid := '88700000-0000-4000-8000-0000000000c1';
  r jsonb; g1 uuid; g2 uuid; g3 uuid; v_lote uuid; v_n integer; v_monto numeric;
begin
  insert into public.gasto (tenant_id, viaje_id, concepto, monto) values (A, '88700000-0000-4000-8000-0000000000f1', 'diesel', 500) returning id into g1;
  insert into public.gasto (tenant_id, viaje_id, concepto, monto) values (A, '88700000-0000-4000-8000-0000000000f1', 'diesel', 400) returning id into g2;
  insert into public.gasto (tenant_id, viaje_id, concepto, monto) values (A, '88700000-0000-4000-8000-0000000000f1', 'caseta', 100) returning id into g3;
  -- emisión real encendida + mandato vigente (igual que la 0542)
  r := public.registrar_aceptacion_legal(A, dueno, 'mandato_autofacturacion', 'm1', repeat('a', 64));
  r := public.activar_emision_real(A, dueno, 'm1');
  if not (r->>'ok')::boolean then raise exception '0887: no encendió la emisión real: %', r; end if;

  r := public.proponer_lote_emision(A, 'oxxo', array[g1, g2]::uuid[], 0);
  v_lote := (r->>'id')::uuid;
  select cardinality(gasto_ids), monto_total into v_n, v_monto from public.autofactura_lote where id = v_lote;
  if v_n <> 2 or v_monto <> 900 then raise exception '0887: el lote inicial no es de 2 tickets por 900 (% / %)', v_n, v_monto; end if;

  -- (a) el cron AGREGA un ticket después de que la persona vio 2 por 900: confirmar con la huella vieja se rechaza y no confirma
  perform public.proponer_lote_emision(A, 'oxxo', array[g3]::uuid[], 0);
  r := public.decidir_lote_emision(v_lote, A, dueno, true, 'm1', null, v_n, v_monto);
  if (r->>'ok')::boolean then raise exception '0887: confirmó un lote distinto del que la persona vio'; end if;
  if (r->>'motivo') not like 'el lote cambió%' then raise exception '0887: motivo inesperado: %', r; end if;
  if (select estado from public.autofactura_lote where id = v_lote) <> 'propuesto' then raise exception '0887: el rechazo por huella cambió el estado'; end if;

  -- (b) huella a medias: se rechaza
  r := public.decidir_lote_emision(v_lote, A, dueno, true, 'm1', null, 3, null);
  if (r->>'ok')::boolean then raise exception '0887: aceptó una huella a medias'; end if;

  -- (c) con la huella ACTUAL sí confirma (3 tickets por 1000)
  r := public.decidir_lote_emision(v_lote, A, dueno, true, 'm1', null, 3, 1000);
  if not (r->>'ok')::boolean then raise exception '0887: no confirmó con la huella vigente: %', r; end if;
  if (select estado from public.autofactura_lote where id = v_lote) <> 'confirmado' then raise exception '0887: no quedó confirmado'; end if;

  -- (d) compatibilidad: sin huella (llamada de 6 args, código desplegado antes) se comporta como la 0542
  update public.autofactura_lote set estado = 'rechazado' where id = v_lote;
  r := public.proponer_lote_emision(A, 'oxxo', array[g1]::uuid[], 0);
  r := public.decidir_lote_emision((r->>'id')::uuid, A, dueno, true, 'm1');
  if not (r->>'ok')::boolean then raise exception '0887: la llamada sin huella dejó de funcionar: %', r; end if;

  -- (e) rechazar no necesita la huella
  update public.autofactura_lote set estado = 'rechazado' where tenant_id = A and estado = 'confirmado';
  r := public.proponer_lote_emision(A, 'oxxo', array[g2]::uuid[], 0);
  r := public.decidir_lote_emision((r->>'id')::uuid, A, dueno, false, 'm1', 'no va', 99, 1);
  if not (r->>'ok')::boolean then raise exception '0887: no pudo rechazar: %', r; end if;
end $$;

-- (f) una sola firma, y solo service_role la ejecuta
reset role;
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'decidir_lote_emision') <> 1 then
    raise exception '0887: debía quedar UNA sola firma de decidir_lote_emision';
  end if;
  if has_function_privilege('anon', 'public.decidir_lote_emision(uuid, uuid, uuid, boolean, text, text, integer, numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.decidir_lote_emision(uuid, uuid, uuid, boolean, text, text, integer, numeric)', 'execute') then
    raise exception '0887: anon/authenticated pueden ejecutar decidir_lote_emision';
  end if;
  if not has_function_privilege('service_role', 'public.decidir_lote_emision(uuid, uuid, uuid, boolean, text, text, integer, numeric)', 'execute') then
    raise exception '0887: service_role no puede ejecutar decidir_lote_emision';
  end if;
end $$;
rollback;
