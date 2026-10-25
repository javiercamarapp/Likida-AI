\set ON_ERROR_STOP on
-- 0902 · Lote M-F-agentes-legal-ia-01 (auditoría 37). Datos sintéticos; todo en una transacción
-- que se revierte.
--   (a) A37-L-05: wa_outbox.vence_en lo fija el trigger (creada_en + 24 h) y una vigencia explícita se respeta.
--   (b) reclamar_wa_outbox NO reclama lo vencido; sí lo vigente (misma firma de siempre).
--   (c) vencer_wa_outbox pasa a dead lo pending/sending vencido, devuelve cuáles, deja ultimo_error, y
--       no toca lo ya enviado ni lo vigente.
--   (d) A37-L-02/L-04: ejecutar_arco_cancelacion da de baja al operador, retira lat/lng/nota de SUS pod y
--       no toca el pod de otro operador ni la foto/fila del suyo.
--   (e) A37-L-03: la constancia de una cuenta de oficina declara que los correos congelados se conservan;
--       esos correos NO se reescriben.
--   (f) privilegios: solo service_role; idempotencia (segunda aplicación de la migración: la corre el arnés).
begin;

insert into public.tenant (id, nombre) values ('90200000-0000-4000-8000-0000000000a1', 'Flota 0902');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('90200000-0000-4000-8000-0000000000b1', '90200000-0000-4000-8000-0000000000a1', 'Operador Uno', '529999090201'),
  ('90200000-0000-4000-8000-0000000000b2', '90200000-0000-4000-8000-0000000000a1', 'Operador Dos', '529999090202');
insert into public.viaje (id, tenant_id, operador_id) values
  ('90200000-0000-4000-8000-0000000000c1', '90200000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-0000000000b1'),
  ('90200000-0000-4000-8000-0000000000c2', '90200000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-0000000000b2');
insert into public.pod (id, tenant_id, viaje_id, operador_id, storage_path, lat, lng, estado, nota) values
  ('90200000-0000-4000-8000-0000000000d1', '90200000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-0000000000c1', '90200000-0000-4000-8000-0000000000b1', 'pod/uno.jpg', 20.97, -89.62, 'subido', 'lo recibió mi cuñado'),
  ('90200000-0000-4000-8000-0000000000d2', '90200000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-0000000000c2', '90200000-0000-4000-8000-0000000000b2', 'pod/dos.jpg', 21.01, -89.55, 'subido', 'nota del dos');
insert into public.solicitud_arco (id, tenant_id, operador_id, titular_ref, tipo, vence_en, canal) values
  ('90200000-0000-4000-8000-0000000000e1', '90200000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-0000000000b1', '529999090201', 'cancelacion', current_date + 20, 'whatsapp');

-- (a) trigger de vigencia
insert into public.wa_outbox (id, payload, estado, proximo_intento_en, creada_en) values
  ('90200000-0000-4000-8000-0000000000f1', '{"messaging_product":"whatsapp","to":"529999090201"}', 'pending', now() - interval '1 minute', now() - interval '30 hours'),
  ('90200000-0000-4000-8000-0000000000f2', '{"messaging_product":"whatsapp","to":"529999090201"}', 'pending', now() - interval '1 minute', now() - interval '1 hour'),
  ('90200000-0000-4000-8000-0000000000f3', '{"messaging_product":"whatsapp","to":"529999090201"}', 'sent',    now() - interval '1 minute', now() - interval '40 hours');
insert into public.wa_outbox (id, payload, estado, proximo_intento_en, vence_en) values
  ('90200000-0000-4000-8000-0000000000f4', '{"messaging_product":"whatsapp","to":"529999090201"}', 'pending', now() - interval '1 minute', now() + interval '2 hours');
do $$ begin
  if (select vence_en from public.wa_outbox where id = '90200000-0000-4000-8000-0000000000f2')
       is distinct from (select creada_en + interval '24 hours' from public.wa_outbox where id = '90200000-0000-4000-8000-0000000000f2') then
    raise exception '(a) el trigger no fijó vence_en = creada_en + 24 h';
  end if;
  if (select vence_en from public.wa_outbox where id = '90200000-0000-4000-8000-0000000000f4') <= now() + interval '1 hour' then
    raise exception '(a) el trigger pisó una vigencia explícita';
  end if;
end $$;

set local role service_role;
-- (b) reclamar no toma lo vencido (f1: creada hace 30 h → venció) y sí lo vigente (f2, f4)
create temporary table recl as select * from public.reclamar_wa_outbox(100, 120);
do $$ begin
  if exists (select 1 from recl where id = '90200000-0000-4000-8000-0000000000f1') then raise exception '(b) reclamó una salida vencida'; end if;
  if not exists (select 1 from recl where id = '90200000-0000-4000-8000-0000000000f2') then raise exception '(b) no reclamó una salida vigente'; end if;
  if not exists (select 1 from recl where id = '90200000-0000-4000-8000-0000000000f4') then raise exception '(b) no reclamó la de vigencia explícita'; end if;
end $$;

-- (c) vencer: f1 (pending vencida) → dead; f2/f4 (sending vigentes) y f3 (sent) intactas
create temporary table venc as select * from public.vencer_wa_outbox(100);
do $$ begin
  if not exists (select 1 from venc where id = '90200000-0000-4000-8000-0000000000f1') then raise exception '(c) no devolvió la vencida'; end if;
  if (select count(*) from venc where id::text like '90200000-0000-4000-8000-0000000000f%') <> 1 then raise exception '(c) devolvió más que la vencida'; end if;
  if (select estado from public.wa_outbox where id = '90200000-0000-4000-8000-0000000000f1') <> 'dead' then raise exception '(c) la vencida no quedó dead'; end if;
  if (select ultimo_error from public.wa_outbox where id = '90200000-0000-4000-8000-0000000000f1') not like 'vencida:%' then raise exception '(c) sin motivo de vencimiento'; end if;
  if (select estado from public.wa_outbox where id = '90200000-0000-4000-8000-0000000000f3') <> 'sent' then raise exception '(c) tocó una ya enviada'; end if;
  if (select estado from public.wa_outbox where id = '90200000-0000-4000-8000-0000000000f2') <> 'sending' then raise exception '(c) tocó una vigente'; end if;
  if (select count(*) from public.vencer_wa_outbox(100)) <> 0 then raise exception '(c) no es idempotente'; end if;
end $$;

-- (d) ARCO del operador: baja + pod
do $$
declare r jsonb;
begin
  r := public.ejecutar_arco_cancelacion('90200000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-0000000000e1');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '(d) no ejecutó la cancelación: %', r; end if;
  if not exists (select 1 from public.operador where id = '90200000-0000-4000-8000-0000000000b1' and not activo and telefono like 'anon:%' and anonimizado_en is not null) then
    raise exception '(d) el operador cancelado sigue activo o sin anonimizar';
  end if;
  if not exists (select 1 from public.pod where id = '90200000-0000-4000-8000-0000000000d1' and lat is null and lng is null and nota is null and storage_path = 'pod/uno.jpg' and estado = 'subido') then
    raise exception '(d) el pod del operador conserva coordenadas/nota o perdió la foto';
  end if;
  if not exists (select 1 from public.pod where id = '90200000-0000-4000-8000-0000000000d2' and lat = 21.01 and lng = -89.55 and nota = 'nota del dos') then
    raise exception '(d) tocó el pod de OTRO operador';
  end if;
  if not exists (select 1 from public.operador where id = '90200000-0000-4000-8000-0000000000b2' and activo and nombre = 'Operador Dos') then
    raise exception '(d) tocó a otro operador';
  end if;
  if (select (evidencia->>'pod_geolocalizacion_y_nota_retiradas')::int from public.solicitud_arco where id = '90200000-0000-4000-8000-0000000000e1') <> 1 then
    raise exception '(d) la evidencia no cuenta el pod retirado';
  end if;
  -- idempotencia de la función
  r := public.ejecutar_arco_cancelacion('90200000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-0000000000e1');
  if coalesce((r->>'ok')::boolean, false) then raise exception '(d) ejecutó dos veces'; end if;
end $$;
reset role;

-- (e) cuenta de oficina: constancia honesta y correos congelados intactos
insert into public.app_user (id, tenant_id, email, nombre, rol, telefono) values
  ('90200000-0000-4000-8000-000000000101', '90200000-0000-4000-8000-0000000000a1', 'dueno-0902@test.invalid', 'Dueño Uno', 'flota_admin', '529999090211'),
  ('90200000-0000-4000-8000-000000000102', '90200000-0000-4000-8000-0000000000a1', 'conta-0902@test.invalid',  'Contador',   'contador',    '529999090212');
insert into public.jornada_dia (id, tenant_id, operador_id, dia, estado, cerrado_en, cerrado_por, cerrado_por_email) values
  ('90200000-0000-4000-8000-000000000201', '90200000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-0000000000b2', '2026-09-01', 'cerrado', now(), '90200000-0000-4000-8000-000000000102', 'conta-0902@test.invalid');
insert into public.solicitud_arco (id, tenant_id, operador_id, titular_user_id, titular_ref, tipo, vence_en, canal) values
  ('90200000-0000-4000-8000-0000000000e2', '90200000-0000-4000-8000-0000000000a1', null, '90200000-0000-4000-8000-000000000102', '529999090212', 'cancelacion', current_date + 20, 'whatsapp');
set local role service_role;
do $$
declare r jsonb;
begin
  r := public.ejecutar_arco_cancelacion('90200000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-0000000000e2');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '(e) no canceló la cuenta: %', r; end if;
  if (select cerrado_por_email from public.jornada_dia where id = '90200000-0000-4000-8000-000000000201') <> 'conta-0902@test.invalid' then
    raise exception '(e) se reescribió el correo congelado (es prueba de la firma)';
  end if;
  if not exists (select 1 from public.solicitud_arco where id = '90200000-0000-4000-8000-0000000000e2'
                  and evidencia->>'correos_congelados_retenidos' = 'true'
                  and resolucion like '%se congela a propósito como prueba%'
                  and resolucion not like '%que no está ligada a tu cuenta%') then
    raise exception '(e) la constancia no declara la retención de los correos congelados';
  end if;
end $$;
reset role;

-- (f) privilegios
do $$ begin
  if has_function_privilege('anon', 'public.vencer_wa_outbox(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.vencer_wa_outbox(integer)', 'execute')
     or has_function_privilege('anon', 'public.reclamar_wa_outbox(integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.reclamar_wa_outbox(integer,integer)', 'execute') then
    raise exception '(f) anon/authenticated no deben ejecutar';
  end if;
  if not has_function_privilege('service_role', 'public.vencer_wa_outbox(integer)', 'execute')
     or not has_function_privilege('service_role', 'public.reclamar_wa_outbox(integer,integer)', 'execute') then
    raise exception '(f) service_role debe ejecutar';
  end if;
end $$;

rollback;
select 'OK 0902' as resultado;
