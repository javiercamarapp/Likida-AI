\set ON_ERROR_STOP on
-- 0502 · alerta saliente de tope de jornada. Datos sintéticos; se revierte.
begin;

insert into public.tenant (id, nombre) values
  ('b5020000-0000-0000-0000-000000000001', 'JA A'), ('b5020000-0000-0000-0000-000000000002', 'JA B');
insert into public.operador (id, tenant_id, nombre, telefono, activo) values
  ('b5020000-0000-0000-0000-0000000000a1', 'b5020000-0000-0000-0000-000000000001', 'Op A', '5551230001', true),
  ('b5020000-0000-0000-0000-0000000000b1', 'b5020000-0000-0000-0000-000000000002', 'Op B', '5551230002', true);

-- (a) la configuración: dominios, tope ≤ 12, umbrales coherentes, correo requerido
do $$
begin
  insert into public.jornada_alerta_config (tenant_id, activa, declarada_por_email)
  values ('b5020000-0000-0000-0000-000000000001', true, 'dueno@a.mx');
  if (select umbral_aviso_pct from public.jornada_alerta_config where tenant_id = 'b5020000-0000-0000-0000-000000000001') <> 80 then raise exception '(a) default 80'; end if;
  if (select activa from public.jornada_alerta_config where tenant_id = 'b5020000-0000-0000-0000-000000000001') is not true then raise exception '(a) activa'; end if;
  begin update public.jornada_alerta_config set tope_horas = 13 where tenant_id = 'b5020000-0000-0000-0000-000000000001'; raise exception '(a) aceptó tope 13'; exception when check_violation then null; end;
  begin update public.jornada_alerta_config set tope_horas = 0 where tenant_id = 'b5020000-0000-0000-0000-000000000001'; raise exception '(a) aceptó tope 0'; exception when check_violation then null; end;
  begin update public.jornada_alerta_config set umbral_aviso_pct = 96 where tenant_id = 'b5020000-0000-0000-0000-000000000001'; raise exception '(a) aviso >= critico'; exception when check_violation then null; end;
  begin update public.jornada_alerta_config set canal_operador = 'correo' where tenant_id = 'b5020000-0000-0000-0000-000000000001'; raise exception '(a) canal operador correo'; exception when check_violation then null; end;
  begin update public.jornada_alerta_config set canal_encargado = 'correo' where tenant_id = 'b5020000-0000-0000-0000-000000000001'; raise exception '(a) correo sin dirección'; exception when check_violation then null; end;
  begin update public.jornada_alerta_config set canal_encargado = 'ambos', correo_encargado = 'no es correo' where tenant_id = 'b5020000-0000-0000-0000-000000000001'; raise exception '(a) correo inválido'; exception when check_violation then null; end;
  update public.jornada_alerta_config set canal_encargado = 'ambos', correo_encargado = 'jefe@a.mx', tope_horas = 10 where tenant_id = 'b5020000-0000-0000-0000-000000000001';
end $$;

-- (b) jornadas en curso: abierta + inicio vivo + sin fin vivo + flota con alerta activa
insert into public.jornada_dia (id, tenant_id, operador_id, dia) values
  ('b5020000-0000-0000-0000-00000000c001', 'b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-0000000000a1', '2026-10-01'),
  ('b5020000-0000-0000-0000-00000000c002', 'b5020000-0000-0000-0000-000000000002', 'b5020000-0000-0000-0000-0000000000b1', '2026-10-01');
insert into public.jornada_asiento (tenant_id, jornada_id, tipo, momento, procedencia, wa_message_id) values
  ('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c001', 'inicio_jornada', '2026-10-01T12:00:00Z', 'declarado_operador', 'wamid.1'),
  ('b5020000-0000-0000-0000-000000000002', 'b5020000-0000-0000-0000-00000000c002', 'inicio_jornada', '2026-10-01T12:00:00Z', 'declarado_operador', 'wamid.2');
do $$
declare n integer; r record;
begin
  select count(*) into n from public.jornadas_en_curso_para_alerta('2026-10-01T20:00:00Z', 100);
  if n <> 1 then raise exception '(b) solo la flota A tiene alerta activa; vio %', n; end if;
  select * into r from public.jornadas_en_curso_para_alerta('2026-10-01T20:00:00Z', 100);
  if r.tenant_id <> 'b5020000-0000-0000-0000-000000000001' or r.tope_horas <> 10 or r.canal_encargado <> 'ambos' then raise exception '(b) fila equivocada'; end if;
  -- con un fin vivo ya no está en curso
  insert into public.jornada_asiento (tenant_id, jornada_id, tipo, momento, procedencia, wa_message_id)
  values ('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c001', 'fin_jornada', '2026-10-01T21:00:00Z', 'declarado_operador', 'wamid.3');
  select count(*) into n from public.jornadas_en_curso_para_alerta('2026-10-01T20:00:00Z', 100);
  if n <> 0 then raise exception '(b) con fin vivo no debe estar en curso'; end if;
  -- anulado el fin, vuelve
  update public.jornada_asiento set anulado_en = now(), anulado_por_email = 'x@y.mx', anulado_motivo = 'prueba'
   where jornada_id = 'b5020000-0000-0000-0000-00000000c001' and tipo = 'fin_jornada';
  select count(*) into n from public.jornadas_en_curso_para_alerta('2026-10-01T20:00:00Z', 100);
  if n <> 1 then raise exception '(b) con el fin anulado debe volver'; end if;
  -- un expediente de hace 3 días ya no se barre
  select count(*) into n from public.jornadas_en_curso_para_alerta('2026-10-05T20:00:00Z', 100);
  if n <> 0 then raise exception '(b) solo hoy y ayer'; end if;
  -- apagar la alerta saca a la flota
  update public.jornada_alerta_config set activa = false where tenant_id = 'b5020000-0000-0000-0000-000000000001';
  select count(*) into n from public.jornadas_en_curso_para_alerta('2026-10-01T20:00:00Z', 100);
  if n <> 0 then raise exception '(b) apagada no se barre'; end if;
end $$;

-- (c) el CLAIM: gana uno, el segundo no; otro nivel sí; un nivel menor tras uno mayor no; el lease vencido se retoma
do $$
declare a record; b record; n integer; ok boolean;
begin
  select * into a from public.reclamar_jornada_alerta('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c001', 'aviso', 480, 600, false, 'declarado_operador', false, '2026-10-01T20:00:00Z', 300);
  if a.alerta_id is null then raise exception '(c) el primero debía ganar'; end if;
  select count(*) into n from public.reclamar_jornada_alerta('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c001', 'aviso', 481, 600, false, 'declarado_operador', false, '2026-10-01T20:01:00Z', 300);
  if n <> 0 then raise exception '(c) el segundo no debía ganar mientras el lease vive'; end if;
  -- lease vencido: se retoma (mismo registro, token nuevo)
  select * into b from public.reclamar_jornada_alerta('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c001', 'aviso', 490, 600, true, 'gps', false, '2026-10-01T20:06:00Z', 300);
  if b.alerta_id is distinct from a.alerta_id or b.claim_token = a.claim_token then raise exception '(c) retomar el lease vencido'; end if;
  -- el token viejo ya no cierra
  select public.cerrar_jornada_alerta('b5020000-0000-0000-0000-000000000001', a.alerta_id, a.claim_token, 'enviada', 'whatsapp', 'enviado', null, 'whatsapp', 'enviado', null) into ok;
  if ok then raise exception '(c) token viejo cerró'; end if;
  -- una flota ajena no cierra la alerta de otra
  select public.cerrar_jornada_alerta('b5020000-0000-0000-0000-000000000002', b.alerta_id, b.claim_token, 'enviada', 'whatsapp', 'enviado', null, 'whatsapp', 'enviado', null) into ok;
  if ok then raise exception '(c) otra flota cerró la alerta'; end if;
  select public.cerrar_jornada_alerta('b5020000-0000-0000-0000-000000000001', b.alerta_id, b.claim_token, 'parcial', 'ambos', 'enviado', null, 'whatsapp', 'fallido', repeat('x', 500)) into ok;
  if not ok then raise exception '(c) el dueño del claim no cerró'; end if;
  if (select length(operador_motivo) from public.jornada_alerta where id = b.alerta_id) <> 200 then raise exception '(c) motivo sin truncar'; end if;
  if (select cota_inferior from public.jornada_alerta where id = b.alerta_id) is not true or (select fuente from public.jornada_alerta where id = b.alerta_id) <> 'gps' then
    raise exception '(c) la retoma debía actualizar cota y fuente';
  end if;
  -- cerrado: no se reclama otra vez
  select count(*) into n from public.reclamar_jornada_alerta('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c001', 'aviso', 500, 600, false, 'gps', false, '2026-10-02T00:00:00Z', 300);
  if n <> 0 then raise exception '(c) un nivel ya avisado no se reclama'; end if;
  -- un nivel MAYOR sí; luego un nivel menor ya no
  select * into a from public.reclamar_jornada_alerta('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c001', 'exceso', 700, 600, false, 'gps', false, '2026-10-01T22:00:00Z', 300);
  if a.alerta_id is null then raise exception '(c) exceso debía reclamarse'; end if;
  select count(*) into n from public.reclamar_jornada_alerta('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c001', 'critico', 650, 600, false, 'gps', false, '2026-10-01T22:00:10Z', 300);
  if n <> 0 then raise exception '(c) un nivel menor tras uno mayor en vuelo no debe reclamarse'; end if;
  -- liberar: borra el claim vivo para reintentar
  select public.liberar_jornada_alerta('b5020000-0000-0000-0000-000000000001', a.alerta_id, a.claim_token) into ok;
  if not ok then raise exception '(c) liberar'; end if;
  select count(*) into n from public.reclamar_jornada_alerta('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c001', 'exceso', 700, 600, false, 'gps', false, '2026-10-01T22:00:20Z', 300);
  if n <> 1 then raise exception '(c) tras liberar debía poder reclamarse'; end if;
  -- un cerrado no se libera
  if exists (select 1 from public.liberar_jornada_alerta('b5020000-0000-0000-0000-000000000001', (select id from public.jornada_alerta where nivel = 'aviso'), gen_random_uuid()) as x where x) then
    raise exception '(c) liberar sin token';
  end if;
  begin perform public.reclamar_jornada_alerta('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c001', 'raro', 1, 1, false, 'gps'); raise exception '(c) nivel inválido'; exception when others then if sqlerrm not like '%nivel de alerta inválido%' then raise; end if; end;
end $$;

-- (d) CHECK de coherencia del claim y de dominios
do $$
begin
  begin
    update public.jornada_alerta set estado = 'enviada' where nivel = 'exceso';
    raise exception '(d) cerrar sin cerrada_en';
  exception when check_violation then null; end;
  begin
    insert into public.jornada_alerta (tenant_id, jornada_id, nivel, minutos_registrados, tope_minutos, cota_inferior, fuente, estado, claim_token, claim_expira_en)
    values ('b5020000-0000-0000-0000-000000000002', 'b5020000-0000-0000-0000-00000000c002', 'aviso', 5000, 600, false, 'gps', 'reclamada', gen_random_uuid(), now());
    raise exception '(d) minutos imposibles';
  exception when check_violation then null; end;
  -- la FK compuesta impide colgar una alerta de la jornada de OTRA flota
  begin
    insert into public.jornada_alerta (tenant_id, jornada_id, nivel, minutos_registrados, tope_minutos, cota_inferior, fuente, estado, claim_token, claim_expira_en)
    values ('b5020000-0000-0000-0000-000000000001', 'b5020000-0000-0000-0000-00000000c002', 'aviso', 500, 600, false, 'gps', 'reclamada', gen_random_uuid(), now());
    raise exception '(d) colgó una alerta de otra flota';
  exception when foreign_key_violation then null; end;
end $$;

-- (e) deny-all y permisos; la cascada con el expediente; cron_latido admite el id
do $$
begin
  if has_table_privilege('anon', 'public.jornada_alerta', 'select') or has_table_privilege('authenticated', 'public.jornada_alerta', 'select')
     or has_table_privilege('authenticated', 'public.jornada_alerta_config', 'select') or has_table_privilege('anon', 'public.jornada_alerta_config', 'insert') then
    raise exception '(e) alguien distinto de service_role toca las tablas';
  end if;
  if has_function_privilege('authenticated', 'public.reclamar_jornada_alerta(uuid,uuid,text,integer,integer,boolean,text,boolean,timestamptz,integer)', 'execute')
     or has_function_privilege('anon', 'public.jornadas_en_curso_para_alerta(timestamptz,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.cerrar_jornada_alerta(uuid,uuid,uuid,text,text,text,text,text,text,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.liberar_jornada_alerta(uuid,uuid,uuid)', 'execute') then
    raise exception '(e) funciones ejecutables por anon/authenticated';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.jornada_alerta'::regclass) or not (select relrowsecurity from pg_class where oid = 'public.jornada_alerta_config'::regclass) then
    raise exception '(e) RLS apagada';
  end if;
  insert into public.cron_latido (id, ultimo_latido, estado) values ('jornada-alertas', now(), 'ok') on conflict (id) do nothing;
  begin insert into public.cron_latido (id, ultimo_latido, estado) values ('inventado', now(), 'ok'); raise exception '(e) aceptó un cron inventado'; exception when check_violation then null; end;
  delete from public.jornada_dia where id = 'b5020000-0000-0000-0000-00000000c001';
  if exists (select 1 from public.jornada_alerta where jornada_id = 'b5020000-0000-0000-0000-00000000c001') then raise exception '(e) la cascada no limpió las alertas'; end if;
end $$;

rollback;
\echo 0502_jornada_alerta_tope: OK
