\set ON_ERROR_STOP on
-- 0542 — CONTROL DE LA EMISIÓN REAL DE AUTOFACTURA. Lo que solo la base garantiza (rollback):
--   (a) encender la emisión real: solo un flota_admin activo de la flota Y con el mandato vigente;
--       apagarla: también el contador; apagar rechaza los lotes vivos;
--   (b) límites: solo el dueño, dentro de rango, y el día cubre al lote;
--   (c) un portal pasa a autónomo solo tras N emisiones confirmadas y por un dueño;
--   (d) lotes: todos los gastos son de la flota (aislamiento), uno vivo por (flota, portal),
--       decidir exige rol + emisión real encendida + mandato; el lote confirmado se consume UNA vez;
--   (e) cupo diario: reserva atómica que respeta ambos topes; liberar no baja de cero;
--   (f) retención y permisos solo service_role.
begin;
insert into public.tenant (id, nombre) values
  ('54200000-0000-4000-8000-0000000000a1', 'Flota A 0542'),
  ('54200000-0000-4000-8000-0000000000b1', 'Flota B 0542');
insert into public.app_user (id, tenant_id, email, nombre, rol, activo, desactivado_en) values
  ('54200000-0000-4000-8000-0000000000c1', '54200000-0000-4000-8000-0000000000a1', 'dueno-0542@test.invalid', 'Dueño', 'flota_admin', true, null),
  ('54200000-0000-4000-8000-0000000000c2', '54200000-0000-4000-8000-0000000000a1', 'conta-0542@test.invalid', 'Contador', 'contador', true, null),
  ('54200000-0000-4000-8000-0000000000c3', '54200000-0000-4000-8000-0000000000a1', 'enc-0542@test.invalid', 'Encargado', 'encargado', true, null),
  ('54200000-0000-4000-8000-0000000000d1', '54200000-0000-4000-8000-0000000000b1', 'dueno-b-0542@test.invalid', 'Dueño B', 'flota_admin', true, null);
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('54200000-0000-4000-8000-0000000000e1', '54200000-0000-4000-8000-0000000000a1', 'OpA', '5210000005421'),
  ('54200000-0000-4000-8000-0000000000e2', '54200000-0000-4000-8000-0000000000b1', 'OpB', '5210000005422');
insert into public.viaje (id, tenant_id, operador_id) values
  ('54200000-0000-4000-8000-0000000000f1', '54200000-0000-4000-8000-0000000000a1', '54200000-0000-4000-8000-0000000000e1'),
  ('54200000-0000-4000-8000-0000000000f2', '54200000-0000-4000-8000-0000000000b1', '54200000-0000-4000-8000-0000000000e2');

set local role service_role;
do $$
declare
  A constant uuid := '54200000-0000-4000-8000-0000000000a1';
  B constant uuid := '54200000-0000-4000-8000-0000000000b1';
  dueno constant uuid := '54200000-0000-4000-8000-0000000000c1';
  conta constant uuid := '54200000-0000-4000-8000-0000000000c2';
  enc   constant uuid := '54200000-0000-4000-8000-0000000000c3';
  dueno_b constant uuid := '54200000-0000-4000-8000-0000000000d1';
  r jsonb; g1 uuid; g2 uuid; g3 uuid; gb uuid; v_lote uuid; v uuid[];
begin
  insert into public.gasto (tenant_id, viaje_id, concepto, monto) values (A, '54200000-0000-4000-8000-0000000000f1', 'diesel', 500) returning id into g1;
  insert into public.gasto (tenant_id, viaje_id, concepto, monto) values (A, '54200000-0000-4000-8000-0000000000f1', 'diesel', 700) returning id into g2;
  insert into public.gasto (tenant_id, viaje_id, concepto, monto) values (A, '54200000-0000-4000-8000-0000000000f1', 'caseta', 100) returning id into g3;
  insert into public.gasto (tenant_id, viaje_id, concepto, monto) values (B, '54200000-0000-4000-8000-0000000000f2', 'diesel', 900) returning id into gb;

  -- (a) encender
  r := public.activar_emision_real(A, dueno, 'm1');
  if (r->>'ok')::boolean then raise exception '0542: encendió SIN mandato'; end if;
  r := public.registrar_aceptacion_legal(A, dueno, 'mandato_autofacturacion', 'm1', repeat('a', 64));
  r := public.activar_emision_real(A, conta, 'm1');
  if (r->>'ok')::boolean then raise exception '0542: el contador encendió la emisión real'; end if;
  r := public.activar_emision_real(A, dueno_b, 'm1');
  if (r->>'ok')::boolean then raise exception '0542: un dueño de OTRA flota encendió la mía'; end if;
  r := public.activar_emision_real(B, dueno_b, 'm1');
  if (r->>'ok')::boolean then raise exception '0542: encendió en B sin mandato propio (el de A no vale)'; end if;
  r := public.activar_emision_real(A, dueno, 'm1');
  if not (r->>'ok')::boolean then raise exception '0542: no encendió con mandato: %', r; end if;
  if not (select emision_real from public.autofactura_control where tenant_id = A) then raise exception '0542: no quedó encendida'; end if;
  if exists (select 1 from public.autofactura_control where tenant_id = B) then raise exception '0542: encender A tocó B'; end if;

  -- (b) límites
  r := public.cambiar_limites_emision(A, conta, 100, 2, 5, 1000);
  if (r->>'ok')::boolean then raise exception '0542: el contador cambió límites'; end if;
  r := public.cambiar_limites_emision(A, dueno, 1000000, 2, 5, 1000);
  if (r->>'ok')::boolean then raise exception '0542: aceptó un monto por ticket fuera de rango'; end if;
  r := public.cambiar_limites_emision(A, dueno, 1000, 10, 5, 100000);
  if (r->>'ok')::boolean then raise exception '0542: aceptó un día menor que el lote'; end if;
  r := public.cambiar_limites_emision(A, dueno, 1000, 2, 3, 2000);
  if not (r->>'ok')::boolean then raise exception '0542: no cambió límites válidos: %', r; end if;

  -- (c) fase por portal
  perform public.registrar_emision_portal(A, 'enerser', 1);
  r := public.promover_portal_autonomo(A, 'enerser', dueno, 3);
  if (r->>'ok')::boolean then raise exception '0542: promovió con 1 de 3 emisiones'; end if;
  perform public.registrar_emision_portal(A, 'enerser', 2);
  r := public.promover_portal_autonomo(A, 'enerser', conta, 3);
  if (r->>'ok')::boolean then raise exception '0542: el contador promovió a autónomo'; end if;
  r := public.promover_portal_autonomo(A, 'enerser', dueno, 3);
  if not (r->>'ok')::boolean then raise exception '0542: no promovió con 3 de 3: %', r; end if;
  r := public.promover_portal_autonomo(A, 'nunca_emitio', dueno, 3);
  if (r->>'ok')::boolean then raise exception '0542: promovió un portal sin emisiones'; end if;
  begin
    insert into public.autofactura_portal_fase (tenant_id, comercio, fase) values (A, 'trampa', 'autonoma');
    raise exception '0542: insertó un portal autónomo sin emisiones ni promoción';
  exception when check_violation then null; end;
  r := public.devolver_portal_a_supervisada(A, 'enerser', conta);
  if (select fase from public.autofactura_portal_fase where tenant_id = A and comercio = 'enerser') <> 'supervisada' then raise exception '0542: no devolvió a supervisada'; end if;

  -- (d) lotes
  r := public.proponer_lote_emision(A, 'oxxo', array[g1, gb], 1400);
  if (r->>'ok')::boolean then raise exception '0542: un lote con un gasto de OTRA flota pasó'; end if;
  r := public.proponer_lote_emision(A, 'oxxo', array[g1]::uuid[], 99999);
  if not (r->>'ok')::boolean then raise exception '0542: no propuso: %', r; end if;
  v_lote := (r->>'id')::uuid;
  if (select monto_total from public.autofactura_lote where id = v_lote) <> 500 then raise exception '0542: el monto se tomó del cliente, no de la base'; end if;
  r := public.proponer_lote_emision(A, 'oxxo', array[g2, g1]::uuid[], 0);
  if (r->>'estado') <> 'propuesto' or (select cardinality(gasto_ids) from public.autofactura_lote where id = v_lote) <> 2 then raise exception '0542: no agregó al lote propuesto sin duplicar'; end if;
  if (select monto_total from public.autofactura_lote where id = v_lote) <> 1200 then raise exception '0542: monto del lote mal recalculado'; end if;
  -- decidir: rol, mandato, otra flota
  r := public.decidir_lote_emision(v_lote, A, enc, true, 'm1');
  if (r->>'ok')::boolean then raise exception '0542: el encargado confirmó un lote'; end if;
  r := public.decidir_lote_emision(v_lote, B, dueno_b, true, 'm1');
  if (r->>'ok')::boolean then raise exception '0542: otra flota decidió mi lote'; end if;
  r := public.decidir_lote_emision(v_lote, A, dueno, true, 'm-otra-version');
  if (r->>'ok')::boolean then raise exception '0542: confirmó con otra versión del mandato'; end if;
  r := public.decidir_lote_emision(v_lote, A, dueno, true, 'm1');
  if not (r->>'ok')::boolean then raise exception '0542: no confirmó: %', r; end if;
  r := public.decidir_lote_emision(v_lote, A, dueno, true, 'm1');
  if (r->>'ok')::boolean then raise exception '0542: confirmó dos veces'; end if;
  -- un lote confirmado no se altera al volver a proponer
  r := public.proponer_lote_emision(A, 'oxxo', array[g3]::uuid[], 0);
  if (r->>'estado') <> 'confirmado' or (select cardinality(gasto_ids) from public.autofactura_lote where id = v_lote) <> 2 then raise exception '0542: alteró un lote confirmado'; end if;
  -- se consume UNA vez, y solo lo que pidió el cron
  v := public.consumir_lote_confirmado(A, 'oxxo', array[g1, g3]::uuid[]);
  if v <> array[g1] then raise exception '0542: consumió %', v; end if;
  v := public.consumir_lote_confirmado(A, 'oxxo', array[g1, g2]::uuid[]);
  if cardinality(v) <> 0 then raise exception '0542: el lote se consumió DOS veces'; end if;
  if (select estado from public.autofactura_lote where id = v_lote) <> 'ejecutado' then raise exception '0542: no quedó ejecutado'; end if;
  -- ya no hay lote vivo: se puede proponer otro
  r := public.proponer_lote_emision(A, 'oxxo', array[g3]::uuid[], 0);
  v_lote := (r->>'id')::uuid;
  -- vencido: no se confirma ni se consume
  update public.autofactura_lote set propuesto_en = now() - interval '3 day', expira_en = now() - interval '1 day' where id = v_lote;
  r := public.decidir_lote_emision(v_lote, A, dueno, true, 'm1');
  if (r->>'ok')::boolean then raise exception '0542: confirmó un lote vencido'; end if;
  -- apagar rechaza lotes vivos y bloquea confirmar
  r := public.proponer_lote_emision(A, 'oxxo', array[g3]::uuid[], 0);
  v_lote := (r->>'id')::uuid;
  r := public.apagar_emision_real(A, conta);
  if not (r->>'ok')::boolean then raise exception '0542: el contador no pudo apagar: %', r; end if;
  if (select estado from public.autofactura_lote where id = v_lote) <> 'rechazado' then raise exception '0542: apagar no rechazó el lote vivo'; end if;
  r := public.proponer_lote_emision(A, 'oxxo', array[g3]::uuid[], 0);
  r := public.decidir_lote_emision((r->>'id')::uuid, A, dueno, true, 'm1');
  if (r->>'ok')::boolean then raise exception '0542: confirmó con la emisión real apagada'; end if;

  -- (e) cupo
  if not public.reservar_cupo_dia(A, current_date, 2, 1000, 3, 2000) then raise exception '0542: no reservó 2 de 3'; end if;
  if public.reservar_cupo_dia(A, current_date, 2, 100, 3, 2000) then raise exception '0542: pasó el tope de tickets'; end if;
  if public.reservar_cupo_dia(A, current_date, 1, 1500, 3, 2000) then raise exception '0542: pasó el tope de monto'; end if;
  if not public.reservar_cupo_dia(A, current_date, 1, 1000, 3, 2000) then raise exception '0542: no reservó el último'; end if;
  if (select tickets from public.autofactura_cupo_dia where tenant_id = A and dia = current_date) <> 3 then raise exception '0542: conteo de cupo mal'; end if;
  perform public.liberar_cupo_dia(A, current_date, 10, 99999);
  if (select tickets from public.autofactura_cupo_dia where tenant_id = A and dia = current_date) <> 0 then raise exception '0542: liberar no llegó a cero'; end if;
  if public.reservar_cupo_dia(A, current_date, 0, 0, 3, 2000) then raise exception '0542: reservó 0 tickets'; end if;

  -- (f) retención
  begin perform public.purgar_autofactura(5); raise exception '0542: aceptó retención de 5 días';
  exception when raise_exception then if sqlerrm like '0542:%' then raise; end if; end;
  update public.autofactura_lote set decidido_en = now() - interval '400 days', expira_en = now() - interval '399 days', propuesto_en = now() - interval '401 days' where estado in ('rechazado', 'ejecutado');
  r := public.purgar_autofactura(180);
  if (r->>'lotes')::int < 1 then raise exception '0542: no purgó lotes viejos: %', r; end if;
end $$;

reset role;
set local role authenticated;
do $$
begin
  begin perform count(*) from public.autofactura_control; raise exception '0542: authenticated leyó el control';
  exception when insufficient_privilege then null; end;
  begin perform public.reservar_cupo_dia(gen_random_uuid(), current_date, 1, 1, 1, 1); raise exception '0542: authenticated ejecutó una RPC';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
