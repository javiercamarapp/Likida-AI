\set ON_ERROR_STOP on
-- 0797 — Bandeja de avisos de viaje (outbox) y configuración contra Postgres REAL. Datos sintéticos, rollback.
-- Lo que solo la base garantiza:
--   (a) la config nace APAGADA (habilitado=false, modo confirmar, canal ejecutivo_copia), una por flota, y rebota valores inventados;
--   (b) el aviso es único por (flota, fila, huella) = idempotencia, y por (flota, fila, versión); estado/canal/huella/texto/datos
--       rebotan valores inventados; no se cuelga de una fila de OTRA flota;
--   (c) transiciones de estado: las válidas pasan, las inválidas rebotan; enviado/descartado/reemplazado son historia (no se editan);
--       tenant, fila, huella y versión nunca cambian;
--   (d) reclamar: solo un aviso aprobado de una flota habilitada (sin config o apagada = no reclama); un segundo reclamo no gana
--       mientras el arriendo siga vigente; vencido, se retoma; cerrar exige el token vigente;
--   (e) borrar la fila del programa se lleva el aviso; borrar al cliente deja el aviso sin cliente; borrar la flota se lleva todo;
--   (f) RLS: otra flota no lee; quien no atiende clientes (contador) no lee; nadie escribe por REST ni ejecuta las funciones.
begin;

insert into public.tenant (id, nombre) values
  ('07970000-0000-4000-8000-0000000000a1', 'Flota A 0797'),
  ('07970000-0000-4000-8000-0000000000b1', 'Flota B 0797');
insert into public.app_user (id, tenant_id, email, rol) values
  ('07970000-0000-4000-8000-0000000000c1', '07970000-0000-4000-8000-0000000000a1', 'dueno-0797@test.invalid', 'flota_admin'),
  ('07970000-0000-4000-8000-0000000000c3', '07970000-0000-4000-8000-0000000000a1', 'contador-0797@test.invalid', 'contador'),
  ('07970000-0000-4000-8000-0000000000c4', '07970000-0000-4000-8000-0000000000b1', 'dueno-b-0797@test.invalid', 'flota_admin');
insert into public.cliente (id, tenant_id, nombre) values
  ('07970000-0000-4000-8000-0000000000f1', '07970000-0000-4000-8000-0000000000a1', 'Cliente Uno 0797'),
  ('07970000-0000-4000-8000-0000000000f3', '07970000-0000-4000-8000-0000000000b1', 'Cliente B 0797');

set local role service_role;

insert into public.programa_despacho_fila (id, tenant_id, terminal, fecha, tipo, num, clave_natural, huella) values
  ('07970000-0000-4000-8000-0000000000e1', '07970000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'EXPORTACION', 1, 'T1|2026-10-05|EXPORTACION||1', 'huella-uno'),
  ('07970000-0000-4000-8000-0000000000e2', '07970000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'EXPORTACION', 2, 'T1|2026-10-05|EXPORTACION||2', 'huella-dos'),
  ('07970000-0000-4000-8000-0000000000e3', '07970000-0000-4000-8000-0000000000b1', 'T1', date '2026-10-05', 'EXPORTACION', 1, 'T1|2026-10-05|EXPORTACION||1', 'huella-tres');

-- (a) configuración
do $$
declare c public.vigia_aviso_config;
begin
  -- sin fila = apagado: la flota A aún no tiene config
  if exists (select 1 from public.vigia_aviso_config where tenant_id = '07970000-0000-4000-8000-0000000000a1') then
    raise exception '0797(a): la flota nació con config';
  end if;
  insert into public.vigia_aviso_config (tenant_id) values ('07970000-0000-4000-8000-0000000000a1');
  select * into c from public.vigia_aviso_config where tenant_id = '07970000-0000-4000-8000-0000000000a1';
  if c.habilitado is not false then raise exception '0797(a): habilitado no nace en false'; end if;
  if c.modo <> 'confirmar' then raise exception '0797(a): modo no nace en confirmar'; end if;
  if c.canal_default <> 'ejecutivo_copia' then raise exception '0797(a): canal no nace en ejecutivo_copia'; end if;
  if c.max_reenvios <> 3 or c.debounce_min <> 10 or c.autonomo_min_confirmaciones <> 5 or c.zona <> 'America/Mexico_City' then
    raise exception '0797(a): defaults de reenvíos, debounce, confirmaciones o zona incorrectos';
  end if;
  if c.horas_antes_cita is not null or c.exigir_transito is not false or cardinality(c.ccp_listos) <> 0 or cardinality(c.secciones) <> 0 then
    raise exception '0797(a): defaults de horas, tránsito, ccp o secciones incorrectos';
  end if;
  begin
    insert into public.vigia_aviso_config (tenant_id) values ('07970000-0000-4000-8000-0000000000a1');
    raise exception '0797(a): dos configs para la misma flota';
  exception when unique_violation then null; end;
  begin
    update public.vigia_aviso_config set modo = 'robot' where tenant_id = '07970000-0000-4000-8000-0000000000a1';
    raise exception '0797(a): modo inventado';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso_config set canal_default = 'sms' where tenant_id = '07970000-0000-4000-8000-0000000000a1';
    raise exception '0797(a): canal inventado';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso_config set horas_antes_cita = -1 where tenant_id = '07970000-0000-4000-8000-0000000000a1';
    raise exception '0797(a): horas antes negativas';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso_config set max_reenvios = 21 where tenant_id = '07970000-0000-4000-8000-0000000000a1';
    raise exception '0797(a): tope de reenvíos desmedido';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso_config set debounce_min = -5 where tenant_id = '07970000-0000-4000-8000-0000000000a1';
    raise exception '0797(a): debounce negativo';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso_config set ventana_envio = '"texto"'::jsonb where tenant_id = '07970000-0000-4000-8000-0000000000a1';
    raise exception '0797(a): ventana de envío que no es objeto ni arreglo';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso_config set zona = '  ' where tenant_id = '07970000-0000-4000-8000-0000000000a1';
    raise exception '0797(a): zona en blanco';
  exception when check_violation then null; end;
  -- ventana válida y config de B habilitada (para (d))
  update public.vigia_aviso_config
     set ventana_envio = '{"desde": 7, "hasta": 21}'::jsonb, horas_antes_cita = 3, ccp_listos = array['LISTO', 'DESPACHADO']
   where tenant_id = '07970000-0000-4000-8000-0000000000a1';
end $$;

-- (b) restricciones del aviso
do $$
begin
  insert into public.vigia_aviso (id, tenant_id, fila_id, cliente_id, huella, texto, datos)
  values ('07970000-0000-4000-8000-000000000a01', '07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e1',
          '07970000-0000-4000-8000-0000000000f1', 'aaaaaaaaaaaaaaaa', 'Aviso de viaje de prueba', '{"caja": "programa", "unidad": "manual"}'::jsonb);
  if (select estado from public.vigia_aviso where id = '07970000-0000-4000-8000-000000000a01') <> 'borrador'
     or (select version from public.vigia_aviso where id = '07970000-0000-4000-8000-000000000a01') <> 1
     or (select canal from public.vigia_aviso where id = '07970000-0000-4000-8000-000000000a01') <> 'ejecutivo_copia' then
    raise exception '0797(b): defaults del aviso incorrectos';
  end if;
  -- idempotencia: mismo contenido de la misma fila no entra dos veces (ni siquiera como otra versión)
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, version, huella, texto)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e1', 2, 'aaaaaaaaaaaaaaaa', 'otra vez');
    raise exception '0797(b): la misma huella de la misma fila entró dos veces';
  exception when unique_violation then null; end;
  -- la misma versión no se repite con otra huella
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, version, huella, texto)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e1', 1, 'bbbbbbbbbbbbbbbb', 'misma versión');
    raise exception '0797(b): la versión 1 se repitió en la misma fila';
  exception when unique_violation then null; end;
  -- otra fila sí puede tener la misma huella
  insert into public.vigia_aviso (tenant_id, fila_id, huella, texto)
  values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 'aaaaaaaaaaaaaaaa', 'otra fila, misma huella');
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, huella, texto)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 'XYZ', 'huella mal formada');
    raise exception '0797(b): huella no hexadecimal';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, huella, texto, estado)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 'cccccccccccccccc', 'x', 'volando');
    raise exception '0797(b): estado inventado';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, huella, texto, canal)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 'cccccccccccccccc', 'x', 'paloma');
    raise exception '0797(b): canal inventado';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, huella, texto)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 'cccccccccccccccc', '');
    raise exception '0797(b): texto vacío';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, huella, texto, datos)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 'cccccccccccccccc', 'x', '[]'::jsonb);
    raise exception '0797(b): datos que no son objeto';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, huella, texto, version)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 'cccccccccccccccc', 'x', 0);
    raise exception '0797(b): versión cero';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, huella, texto, estado)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 'cccccccccccccccc', 'x', 'enviado');
    raise exception '0797(b): enviado sin fecha de envío';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, huella, texto, estado)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 'cccccccccccccccc', 'x', 'aprobado');
    raise exception '0797(b): aprobado sin fecha de aprobación';
  exception when check_violation then null; end;
  -- aislamiento: ni la fila ni el cliente de otra flota
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, huella, texto)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e3', 'dddddddddddddddd', 'fila ajena');
    raise exception '0797(b): el aviso se colgó de una fila de otra flota';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, cliente_id, version, huella, texto)
    values ('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', '07970000-0000-4000-8000-0000000000f3', 9, 'dddddddddddddddd', 'cliente ajeno');
    raise exception '0797(b): el aviso se colgó de un cliente de otra flota';
  exception when foreign_key_violation then null; end;
end $$;

-- (c) transiciones
do $$
declare v_id uuid := '07970000-0000-4000-8000-000000000a01';
begin
  -- inválidas desde borrador
  begin
    update public.vigia_aviso set estado = 'enviado', enviado_en = now() where id = v_id;
    raise exception '0797(c): borrador → enviado pasó';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso set estado = 'fallido' where id = v_id;
    raise exception '0797(c): borrador → fallido pasó';
  exception when check_violation then null; end;
  -- válidas
  update public.vigia_aviso set estado = 'pendiente_confirmacion' where id = v_id;
  begin
    update public.vigia_aviso set estado = 'borrador' where id = v_id;
    raise exception '0797(c): pendiente_confirmacion → borrador pasó';
  exception when check_violation then null; end;
  update public.vigia_aviso set estado = 'aprobado', aprobado_en = now() where id = v_id;
  -- tenant, fila, huella y versión no se editan
  begin
    update public.vigia_aviso set huella = 'eeeeeeeeeeeeeeee' where id = v_id;
    raise exception '0797(c): la huella se editó';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso set version = 9 where id = v_id;
    raise exception '0797(c): la versión se editó';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso set fila_id = '07970000-0000-4000-8000-0000000000e2' where id = v_id;
    raise exception '0797(c): la fila se cambió';
  exception when check_violation then null; end;
  -- aprobado → fallido → aprobado (reintento) → enviado
  update public.vigia_aviso set estado = 'fallido', error = 'sin respuesta de Meta' where id = v_id;
  update public.vigia_aviso set estado = 'aprobado' where id = v_id;
  update public.vigia_aviso set estado = 'enviado', enviado_en = now() where id = v_id;
  -- enviado es historia: no se edita nada, ni el texto, ni el estado
  begin
    update public.vigia_aviso set texto = 'reescrito' where id = v_id;
    raise exception '0797(c): se editó el texto de un aviso enviado';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso set estado = 'descartado' where id = v_id;
    raise exception '0797(c): un aviso enviado se descartó';
  exception when check_violation then null; end;
  begin
    update public.vigia_aviso set estado = 'reemplazado' where id = v_id;
    raise exception '0797(c): un aviso enviado se marcó reemplazado';
  exception when check_violation then null; end;
  -- sin_destinatario se puede resolver; descartado es terminal
  insert into public.vigia_aviso (id, tenant_id, fila_id, version, huella, texto, estado)
  values ('07970000-0000-4000-8000-000000000a02', '07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 3, 'abababababababab', 'sin dest', 'sin_destinatario');
  update public.vigia_aviso set estado = 'pendiente_confirmacion', cliente_id = '07970000-0000-4000-8000-0000000000f1'
   where id = '07970000-0000-4000-8000-000000000a02';
  update public.vigia_aviso set estado = 'descartado' where id = '07970000-0000-4000-8000-000000000a02';
  begin
    update public.vigia_aviso set estado = 'pendiente_confirmacion' where id = '07970000-0000-4000-8000-000000000a02';
    raise exception '0797(c): un aviso descartado revivió';
  exception when check_violation then null; end;
  -- reemplazado por la versión siguiente
  insert into public.vigia_aviso (id, tenant_id, fila_id, huella, version, texto, estado)
  values ('07970000-0000-4000-8000-000000000a03', '07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e1', 'cdcdcdcdcdcdcdcd', 2, 'v2', 'pendiente_confirmacion');
  update public.vigia_aviso set estado = 'reemplazado' where id = '07970000-0000-4000-8000-000000000a03';
end $$;

-- (d) reclamar / cerrar
do $$
declare
  v_id uuid := '07970000-0000-4000-8000-000000000b01';
  v_t1 uuid; v_t2 uuid; v_n integer; v_ok boolean;
  v_ahora timestamptz := now();
begin
  insert into public.vigia_aviso (id, tenant_id, fila_id, huella, version, texto, estado, aprobado_en)
  values (v_id, '07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-0000000000e2', 'f0f0f0f0f0f0f0f0', 5, 'para reclamar', 'aprobado', now());
  -- config apagada (habilitado=false) = no reclama
  select count(*) into v_n from public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000a1', v_id, 300, v_ahora);
  if v_n <> 0 then raise exception '0797(d): reclamó con la función apagada'; end if;
  -- flota sin config alguna (B) = apagado
  insert into public.vigia_aviso (id, tenant_id, fila_id, huella, texto, estado, aprobado_en)
  values ('07970000-0000-4000-8000-000000000b02', '07970000-0000-4000-8000-0000000000b1', '07970000-0000-4000-8000-0000000000e3', 'f1f1f1f1f1f1f1f1', 'sin config', 'aprobado', now());
  select count(*) into v_n from public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000b1', '07970000-0000-4000-8000-000000000b02', 300, v_ahora);
  if v_n <> 0 then raise exception '0797(d): reclamó una flota sin config (debe quedar apagada)'; end if;

  update public.vigia_aviso_config set habilitado = true where tenant_id = '07970000-0000-4000-8000-0000000000a1';
  -- un aviso que no está aprobado no se reclama
  select count(*) into v_n from public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000a1', '07970000-0000-4000-8000-000000000a02', 300, v_ahora);
  if v_n <> 0 then raise exception '0797(d): reclamó un aviso descartado'; end if;
  -- lease fuera de rango
  begin
    perform public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000a1', v_id, 5, v_ahora);
    raise exception '0797(d): lease de 5 s aceptado';
  exception when invalid_parameter_value then null; end;
  -- otra flota no reclama el aviso de A
  select count(*) into v_n from public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000b1', v_id, 300, v_ahora);
  if v_n <> 0 then raise exception '0797(d): otra flota reclamó un aviso ajeno'; end if;

  -- reclamo bueno
  select o_token into v_t1 from public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000a1', v_id, 300, v_ahora);
  if v_t1 is null then raise exception '0797(d): el reclamo legítimo no ganó'; end if;
  if (select intentos from public.vigia_aviso where id = v_id) <> 1 then raise exception '0797(d): intentos no sumó'; end if;
  -- el segundo no gana con el arriendo vigente
  select count(*) into v_n from public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000a1', v_id, 300, v_ahora + interval '1 minute');
  if v_n <> 0 then raise exception '0797(d): dos dueños del mismo aviso'; end if;
  -- vencido, se retoma con otro token
  select o_token into v_t2 from public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000a1', v_id, 300, v_ahora + interval '10 minutes');
  if v_t2 is null or v_t2 = v_t1 then raise exception '0797(d): el arriendo vencido no se retomó con token nuevo'; end if;
  -- el token viejo ya no cierra; el vigente sí; estado final inválido rebota
  if public.vigia_aviso_cerrar('07970000-0000-4000-8000-0000000000a1', v_id, v_t1, 'enviado') then
    raise exception '0797(d): cerró con un token vencido';
  end if;
  begin
    perform public.vigia_aviso_cerrar('07970000-0000-4000-8000-0000000000a1', v_id, v_t2, 'aprobado');
    raise exception '0797(d): estado final inválido aceptado';
  exception when invalid_parameter_value then null; end;
  if public.vigia_aviso_cerrar('07970000-0000-4000-8000-0000000000b1', v_id, v_t2, 'enviado') then
    raise exception '0797(d): otra flota cerró un aviso ajeno';
  end if;
  v_ok := public.vigia_aviso_cerrar('07970000-0000-4000-8000-0000000000a1', v_id, v_t2, 'fallido', 'timeout');
  if not v_ok then raise exception '0797(d): el dueño vigente no pudo cerrar'; end if;
  if (select estado || '|' || coalesce(error, '') || '|' || (reclamo_token is null)::text from public.vigia_aviso where id = v_id) <> 'fallido|timeout|true' then
    raise exception '0797(d): el cierre fallido no dejó estado, error y arriendo limpio';
  end if;
  if public.vigia_aviso_cerrar('07970000-0000-4000-8000-0000000000a1', v_id, v_t2, 'enviado') then
    raise exception '0797(d): se cerró dos veces con el mismo token';
  end if;
  -- el reintento seguro: a aprobado de nuevo, reclamo nuevo, cierre enviado
  update public.vigia_aviso set estado = 'aprobado' where id = v_id;
  select o_token into v_t1 from public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000a1', v_id, 300, v_ahora + interval '20 minutes');
  if v_t1 is null then raise exception '0797(d): el reintento no pudo reclamar'; end if;
  if not public.vigia_aviso_cerrar('07970000-0000-4000-8000-0000000000a1', v_id, v_t1, 'enviado') then
    raise exception '0797(d): el reintento no cerró';
  end if;
  if (select enviado_en is null or error is not null from public.vigia_aviso where id = v_id) then
    raise exception '0797(d): enviado sin fecha o con error viejo';
  end if;
  -- un enviado no se reclama aunque pase el tiempo
  select count(*) into v_n from public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000a1', v_id, 300, v_ahora + interval '1 day');
  if v_n <> 0 then raise exception '0797(d): se reclamó un aviso ya enviado'; end if;
end $$;

-- (f) RLS (antes de borrar nada: hay filas de A y de B)
update public.vigia_aviso_config set habilitado = true where tenant_id = '07970000-0000-4000-8000-0000000000a1';
insert into public.vigia_aviso_config (tenant_id) values ('07970000-0000-4000-8000-0000000000b1');
reset role;
do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07970000-0000-4000-8000-0000000000c1', true);
  select count(*) into n from public.vigia_aviso;
  if n = 0 then raise exception '0797(f): el dueño de la flota A no ve sus avisos'; end if;
  select count(*) into n from public.vigia_aviso_config;
  if n <> 1 then raise exception '0797(f): el dueño de la flota A ve % configs (debía ser 1)', n; end if;
  if exists (select 1 from public.vigia_aviso where tenant_id <> '07970000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_aviso_config where tenant_id <> '07970000-0000-4000-8000-0000000000a1') then
    raise exception '0797(f): el dueño de la flota A ve datos de otra flota';
  end if;
  -- el contador no atiende clientes: no ve nada
  perform set_config('request.jwt.claim.sub', '07970000-0000-4000-8000-0000000000c3', true);
  select count(*) into n from public.vigia_aviso;
  if n <> 0 then raise exception '0797(f): el contador ve avisos (%)', n; end if;
  select count(*) into n from public.vigia_aviso_config;
  if n <> 0 then raise exception '0797(f): el contador ve la config (%)', n; end if;
  -- el dueño de B no ve lo de A
  perform set_config('request.jwt.claim.sub', '07970000-0000-4000-8000-0000000000c4', true);
  if exists (select 1 from public.vigia_aviso where tenant_id = '07970000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_aviso_config where tenant_id = '07970000-0000-4000-8000-0000000000a1') then
    raise exception '0797(f): el dueño de la flota B ve datos de la flota A';
  end if;
  -- nadie escribe por REST ni ejecuta las funciones
  begin
    insert into public.vigia_aviso (tenant_id, fila_id, huella, texto)
    values ('07970000-0000-4000-8000-0000000000b1', '07970000-0000-4000-8000-0000000000e3', '1212121212121212', 'REST');
    raise exception '0797(f): un usuario autenticado escribió un aviso por REST';
  exception when insufficient_privilege then null; end;
  begin
    update public.vigia_aviso_config set habilitado = true;
    raise exception '0797(f): un usuario autenticado cambió la config por REST';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.vigia_aviso;
    raise exception '0797(f): un usuario autenticado borró avisos por REST';
  exception when insufficient_privilege then null; end;
  begin
    perform public.vigia_aviso_reclamar('07970000-0000-4000-8000-0000000000b1', gen_random_uuid());
    raise exception '0797(f): un usuario autenticado ejecutó vigia_aviso_reclamar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.vigia_aviso_cerrar('07970000-0000-4000-8000-0000000000b1', gen_random_uuid(), gen_random_uuid(), 'enviado');
    raise exception '0797(f): un usuario autenticado ejecutó vigia_aviso_cerrar';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- (e) borrados (con el dueño de la base)
do $$
begin
  -- borrar al cliente deja el aviso, sin cliente
  delete from public.cliente where id = '07970000-0000-4000-8000-0000000000f1';
  if not exists (select 1 from public.vigia_aviso where id = '07970000-0000-4000-8000-000000000a01' and cliente_id is null) then
    raise exception '0797(e): borrar al cliente borró el aviso o dejó el cliente';
  end if;
  -- borrar la fila del programa se lleva sus avisos
  delete from public.programa_despacho_fila where id = '07970000-0000-4000-8000-0000000000e2';
  if exists (select 1 from public.vigia_aviso where fila_id = '07970000-0000-4000-8000-0000000000e2') then
    raise exception '0797(e): borrar la fila del programa dejó sus avisos';
  end if;
  if not exists (select 1 from public.vigia_aviso where fila_id = '07970000-0000-4000-8000-0000000000e1') then
    raise exception '0797(e): borrar una fila se llevó los avisos de otra';
  end if;
  -- borrar la flota se lleva todo, sin tocar a la otra
  delete from public.tenant where id = '07970000-0000-4000-8000-0000000000a1';
  if exists (select 1 from public.vigia_aviso where tenant_id = '07970000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_aviso_config where tenant_id = '07970000-0000-4000-8000-0000000000a1') then
    raise exception '0797(e): quedaron datos de una flota borrada';
  end if;
  if not exists (select 1 from public.vigia_aviso where tenant_id = '07970000-0000-4000-8000-0000000000b1')
     or not exists (select 1 from public.vigia_aviso_config where tenant_id = '07970000-0000-4000-8000-0000000000b1') then
    raise exception '0797(e): borrar la flota A tocó a la flota B';
  end if;
end $$;

rollback;
