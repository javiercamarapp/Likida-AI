\set ON_ERROR_STOP on
-- 0845 · candado de "ya se envió de verdad" sobre la 0502. Datos sintéticos; se revierte.
begin;

insert into public.tenant (id, nombre) values
  ('b8450000-0000-0000-0000-000000000001', 'JA 0845');
insert into public.operador (id, tenant_id, nombre, telefono, activo) values
  ('b8450000-0000-0000-0000-0000000000a1', 'b8450000-0000-0000-0000-000000000001', 'Op 0845', '5551230099', true);
insert into public.jornada_dia (id, tenant_id, operador_id, dia) values
  ('b8450000-0000-0000-0000-00000000c001', 'b8450000-0000-0000-0000-000000000001', 'b8450000-0000-0000-0000-0000000000a1', '2026-10-01');

-- (a) una retoma SIN envío real confirmado sigue actualizando con lo fresco (comportamiento 0502 intacto)
do $$
declare a record; b record; ok boolean;
begin
  select * into a from public.reclamar_jornada_alerta('b8450000-0000-0000-0000-000000000001', 'b8450000-0000-0000-0000-00000000c001', 'aviso', 480, 600, false, 'declarado_operador', false, '2026-10-01T20:00:00Z', 300);
  if a.ya_enviado is distinct from false then raise exception '(a) un claim nuevo no está "ya enviado"'; end if;
  -- lease vencido, SIN marcar_jornada_alerta_enviada: la retoma debe actualizar (igual que la 0502)
  select * into b from public.reclamar_jornada_alerta('b8450000-0000-0000-0000-000000000001', 'b8450000-0000-0000-0000-00000000c001', 'aviso', 490, 600, true, 'gps', false, '2026-10-01T20:06:00Z', 300);
  if b.alerta_id is distinct from a.alerta_id or b.claim_token = a.claim_token then raise exception '(a) debía retomar el mismo registro con token nuevo'; end if;
  if b.ya_enviado is distinct from false then raise exception '(a) sin marcar, la retoma no está "ya enviada"'; end if;
  if b.minutos_registrados <> 490 or b.cota_inferior is not true or b.fuente <> 'gps' then
    raise exception '(a) sin confirmación previa la retoma debía actualizar con lo fresco';
  end if;
  select public.cerrar_jornada_alerta('b8450000-0000-0000-0000-000000000001', b.alerta_id, b.claim_token, 'enviada', 'whatsapp', 'enviado', null, 'whatsapp', 'enviado', null) into ok;
  if not ok then raise exception '(a) el dueño del claim no cerró'; end if;
end $$;

-- (b) el candado: marcar una vez gana, una segunda vez (mismo claim) pierde; permisos y dominios
do $$
declare a record; ganado boolean;
begin
  select * into a from public.reclamar_jornada_alerta('b8450000-0000-0000-0000-000000000001', 'b8450000-0000-0000-0000-00000000c001', 'exceso', 700, 600, false, 'declarado_operador', false, '2026-10-01T21:00:00Z', 300);
  if a.alerta_id is null then raise exception '(b) exceso debía reclamarse'; end if;
  select public.marcar_jornada_alerta_enviada('b8450000-0000-0000-0000-000000000001', a.alerta_id, a.claim_token, 'whatsapp', 'enviado', null, 'whatsapp', 'enviado', null, '2026-10-01T21:00:05Z') into ganado;
  if not ganado then raise exception '(b) la primera marca debía ganar'; end if;
  if (select enviado_en from public.jornada_alerta where id = a.alerta_id) is null then raise exception '(b) enviado_en no quedó marcado'; end if;
  select public.marcar_jornada_alerta_enviada('b8450000-0000-0000-0000-000000000001', a.alerta_id, a.claim_token, 'whatsapp', 'enviado', null, 'whatsapp', 'enviado', null, '2026-10-01T21:00:10Z') into ganado;
  if ganado then raise exception '(b) una segunda marca sobre el mismo claim no debía ganar'; end if;
  -- un tenant ajeno o un claim equivocado tampoco marcan
  select public.marcar_jornada_alerta_enviada('b8450000-0000-0000-0000-000000000002', a.alerta_id, a.claim_token, 'whatsapp', 'enviado', null, 'whatsapp', 'enviado', null) into ganado;
  if ganado then raise exception '(b) otro tenant marcó'; end if;
  select public.marcar_jornada_alerta_enviada('b8450000-0000-0000-0000-000000000001', a.alerta_id, gen_random_uuid(), 'whatsapp', 'enviado', null, 'whatsapp', 'enviado', null) into ganado;
  if ganado then raise exception '(b) un claim_token equivocado marcó';  end if;
  if has_function_privilege('authenticated', 'public.marcar_jornada_alerta_enviada(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.marcar_jornada_alerta_enviada(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz)', 'execute') then
    raise exception '(b) marcar_jornada_alerta_enviada ejecutable por anon/authenticated';
  end if;
end $$;

-- (c) EL HALLAZGO: una vez marcado "ya enviado", la retoma del lease vencido NO pisa los datos
-- capturados en el envío real (minutos/cota/fuente/estados por destinatario) aunque la jornada
-- "ahora" mida distinto — el expediente conserva con qué se mandó el aviso real.
do $$
declare a record; c record; ok boolean; ganado boolean;
begin
  select * into a from public.reclamar_jornada_alerta('b8450000-0000-0000-0000-000000000001', 'b8450000-0000-0000-0000-00000000c001', 'critico', 650, 600, false, 'declarado_operador', false, '2026-10-01T22:00:00Z', 300);
  if a.alerta_id is null then raise exception '(c) crítico debía reclamarse'; end if;
  -- el WhatsApp real "salió" (Meta lo confirmó): se marca ANTES de cerrar, con el estado real por destinatario.
  select public.marcar_jornada_alerta_enviada('b8450000-0000-0000-0000-000000000001', a.alerta_id, a.claim_token, 'whatsapp', 'enviado', null, 'whatsapp', 'fallido', 'plantilla sin aprobar', '2026-10-01T22:00:05Z') into ganado;
  if not ganado then raise exception '(c) la marca del envío real debía ganar'; end if;
  -- EL PROCESO MUERE AQUÍ: nunca llama a cerrar_jornada_alerta. El lease de 300 s vence.
  -- La siguiente corrida (900 s de cadencia del cron) retoma con datos DISTINTOS (la jornada avanzó).
  select * into c from public.reclamar_jornada_alerta('b8450000-0000-0000-0000-000000000001', 'b8450000-0000-0000-0000-00000000c001', 'critico', 715, 600, true, 'gps', true, '2026-10-01T22:16:00Z', 300);
  if c.alerta_id is distinct from a.alerta_id or c.claim_token = a.claim_token then raise exception '(c) debía retomar el mismo registro con un lease nuevo'; end if;
  if c.ya_enviado is distinct from true then raise exception '(c) la retoma debía señalar que ya se había enviado de verdad'; end if;
  -- Lo capturado en el envío real (650 min, NO cota inferior, declarado_operador) NO se pisó con
  -- lo fresco de esta corrida (715 min, cota inferior, gps) ni con los p_minutos/p_cota/p_fuente que
  -- la app mandó sin saber todavía que ya se había enviado.
  if c.minutos_registrados <> 650 or c.cota_inferior is not false or c.fuente <> 'declarado_operador' or c.descanso_sin_cierre is not false then
    raise exception '(c) la retoma pisó los datos del envío real: minutos=%, cota=%, fuente=%', c.minutos_registrados, c.cota_inferior, c.fuente;
  end if;
  -- Y el estado por destinatario que ya se había persistido tampoco se perdió.
  if c.encargado_estado <> 'enviado' or c.operador_estado <> 'fallido' or c.operador_motivo <> 'plantilla sin aprobar' then
    raise exception '(c) se perdió el estado por destinatario del envío real';
  end if;
  if (select minutos_registrados from public.jornada_alerta where id = a.alerta_id) <> 650 then
    raise exception '(c) la fila en la base también quedó pisada';
  end if;
  -- Esta corrida SÍ puede terminar de cerrar el registro, con el lease nuevo que acaba de ganar.
  select public.cerrar_jornada_alerta('b8450000-0000-0000-0000-000000000001', c.alerta_id, c.claim_token, 'parcial', c.encargado_canal, c.encargado_estado, c.encargado_motivo, c.operador_canal, c.operador_estado, c.operador_motivo) into ok;
  if not ok then raise exception '(c) el cierre con el lease retomado debía funcionar'; end if;
  if (select minutos_registrados from public.jornada_alerta where id = a.alerta_id) <> 650 then raise exception '(c) el cierre pisó los minutos del envío real'; end if;
  if (select enviado_en from public.jornada_alerta where id = a.alerta_id) is null then raise exception '(c) enviado_en debía sobrevivir al cierre'; end if;
end $$;

-- (d) un nivel cerrado ya no se reclama (sin cambios de la 0502) y `enviado_en` no habilita otra flota
do $$
declare n integer;
begin
  select count(*) into n from public.reclamar_jornada_alerta('b8450000-0000-0000-0000-000000000001', 'b8450000-0000-0000-0000-00000000c001', 'critico', 1, 600, false, 'gps', false, '2026-10-02T00:00:00Z', 300);
  if n <> 0 then raise exception '(d) un nivel ya cerrado no se reclama'; end if;
end $$;

rollback;
\echo 0845_jornada_alerta_enviado_candado: OK
