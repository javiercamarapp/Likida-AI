\set ON_ERROR_STOP on
-- 0400 — VIGÍA DE SERVICIO AL CLIENTE (Agente 4).
--
-- Lo que SOLO la base puede demostrar, contra Postgres real:
--
--   (a) la allowlist: un número ACTIVO pertenece a UNA flota; un activo sin
--       consentimiento no existe; un contacto suprimido no guarda el teléfono;
--   (b) la ingesta atómica `vigia_recibir_mensaje`: el mismo wamid dos veces es
--       UN mensaje (duplicado = true, sin mover el hilo), el reloj del SLA y la
--       insistencia avanzan solo con mensajes nuevos, y un contacto de OTRA
--       flota o dado de baja no entra;
--   (c) UNA conversación activa por contacto y UNA respuesta del agente por
--       mensaje entrante (dos pasadas no redactan dos borradores);
--   (d) los CHECK de coherencia: un entrante no tiene estado de saliente, un
--       «enviado» trae hora y vía, un «aprobado» sin quién solo vale si fue
--       autoenviado;
--   (e) el aislamiento: la FK compuesta impide colgar una conversación de un
--       cliente de OTRA flota; RLS deja ver solo la flota propia y solo a quien
--       atiende clientes (el contador no); nadie escribe por REST;
--   (f) ARCO: `vigia_suprimir_contacto` borra mensajes y conversaciones, deja el
--       contacto sin teléfono en claro y la bitácora sin texto; la retención
--       `vigia_purgar` borra solo lo vencido de SU flota;
--   (g) los CHECK reescritos enteros: cron_latido admite `vigia` y los de antes;
--       el dominio de modelo_rol admite `vigia_cliente`.
begin;

insert into public.tenant (id, nombre) values
  ('40000000-0000-4000-8000-0000000000a1', 'Flota A 0400'),
  ('40000000-0000-4000-8000-0000000000b1', 'Flota B 0400');
insert into public.cliente (id, tenant_id, nombre) values
  ('40000000-0000-4000-8000-0000000000a2', '40000000-0000-4000-8000-0000000000a1', 'Cliente A'),
  ('40000000-0000-4000-8000-0000000000b2', '40000000-0000-4000-8000-0000000000b1', 'Cliente B');
insert into public.app_user (id, tenant_id, email, rol) values
  ('40000000-0000-4000-8000-0000000000c1', '40000000-0000-4000-8000-0000000000a1', 'dueno-0400@test.invalid', 'flota_admin'),
  ('40000000-0000-4000-8000-0000000000c2', '40000000-0000-4000-8000-0000000000a1', 'encargado-0400@test.invalid', 'encargado'),
  ('40000000-0000-4000-8000-0000000000c3', '40000000-0000-4000-8000-0000000000a1', 'contador-0400@test.invalid', 'contador'),
  ('40000000-0000-4000-8000-0000000000c4', '40000000-0000-4000-8000-0000000000b1', 'dueno-b-0400@test.invalid', 'flota_admin');

set local role service_role;

-- Contactos: uno por flota, números distintos.
insert into public.vigia_contacto (id, tenant_id, cliente_id, telefono, telefono_hash, nombre, consentimiento_en, consentimiento_origen) values
  ('40000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000a2',
   '525511110001', repeat('a', 64), 'Compras A', now(), 'alta_flota'),
  ('40000000-0000-4000-8000-0000000000d2', '40000000-0000-4000-8000-0000000000b1', '40000000-0000-4000-8000-0000000000b2',
   '525511110002', repeat('b', 64), 'Compras B', now(), 'alta_flota');

do $$
declare r record; n integer;
begin
  -- (a) el MISMO número activo en OTRA flota choca (un número = una flota).
  begin
    insert into public.vigia_contacto (tenant_id, cliente_id, telefono, telefono_hash, consentimiento_en, consentimiento_origen)
    values ('40000000-0000-4000-8000-0000000000b1', '40000000-0000-4000-8000-0000000000b2', '525511110001', repeat('c', 64), now(), 'alta_flota');
    raise exception '0400: un número activo entró en dos flotas';
  exception when unique_violation then null;
  end;
  -- (a) un activo sin constancia de consentimiento no existe.
  begin
    insert into public.vigia_contacto (tenant_id, cliente_id, telefono, telefono_hash)
    values ('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000a2', '525511110003', repeat('d', 64));
    raise exception '0400: entró un contacto activo sin consentimiento';
  exception when check_violation then null;
  end;
  -- (a) un teléfono con forma rara no entra.
  begin
    insert into public.vigia_contacto (tenant_id, cliente_id, telefono, telefono_hash, consentimiento_en)
    values ('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000a2', '+52 55-1111', repeat('e', 64), now());
    raise exception '0400: entró un teléfono sin la forma 52+10';
  exception when check_violation then null;
  end;
  -- (e) un contacto de la flota A NO puede colgarse del cliente de la flota B.
  begin
    insert into public.vigia_contacto (tenant_id, cliente_id, telefono, telefono_hash, consentimiento_en)
    values ('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000b2', '525511110004', repeat('f', 64), now());
    raise exception '0400: un contacto de la flota A entró con el cliente de la flota B';
  exception when foreign_key_violation then null;
  end;

  -- (b) la ingesta: primer mensaje abre el hilo, el SLA arranca y la insistencia cuenta 1.
  select * into r from public.vigia_recibir_mensaje(
    '40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000d1', 'wamid.A1', 'texto', 'hola ¿dónde va mi viaje?', now() - interval '10 minutes');
  if r.duplicado or r.entradas_sin_respuesta <> 1 or r.sin_respuesta_desde is null or r.control <> 'agente' then
    raise exception '0400: el primer entrante no abrió el hilo como se espera: %', r;
  end if;
  -- (b) el MISMO wamid otra vez: duplicado, y el hilo NO se mueve.
  select * into r from public.vigia_recibir_mensaje(
    '40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000d1', 'wamid.A1', 'texto', 'hola ¿dónde va mi viaje?', now());
  if not r.duplicado or r.entradas_sin_respuesta <> 1 then
    raise exception '0400: un wamid repetido movió el hilo o no se marcó duplicado: %', r;
  end if;
  -- (b) un wamid nuevo: insistencia 2, y el reloj del SLA conserva el MÁS VIEJO.
  select * into r from public.vigia_recibir_mensaje(
    '40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000d1', 'wamid.A2', 'texto', '¿alguien?', now());
  if r.duplicado or r.entradas_sin_respuesta <> 2 or r.sin_respuesta_desde > now() - interval '9 minutes' then
    raise exception '0400: el segundo entrante no cuenta insistencia / movió el reloj del SLA: %', r;
  end if;
  select count(*) into n from public.vigia_mensaje where tenant_id = '40000000-0000-4000-8000-0000000000a1' and direccion = 'entrante';
  if n <> 2 then raise exception '0400: se esperaban 2 entrantes y hay %', n; end if;
  select count(*) into n from public.vigia_conversacion where contacto_id = '40000000-0000-4000-8000-0000000000d1' and estado = 'activa';
  if n <> 1 then raise exception '0400: debe haber UNA conversación activa y hay %', n; end if;

  -- (b) un contacto de OTRA flota no entra con el tenant equivocado.
  begin
    perform * from public.vigia_recibir_mensaje(
      '40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000d2', 'wamid.X', 'texto', 'x', now());
    raise exception '0400: la ingesta aceptó un contacto de otra flota';
  exception when sqlstate 'P0001' then null;
  end;
  -- (b) el mismo wamid en OTRA flota es otro mensaje (el índice es por flota).
  perform * from public.vigia_recibir_mensaje(
    '40000000-0000-4000-8000-0000000000b1', '40000000-0000-4000-8000-0000000000d2', 'wamid.A1', 'texto', 'otro cliente', now());

  -- (b) un contacto dado de baja no entra.
  update public.vigia_contacto set estado = 'baja', optout_en = now() where id = '40000000-0000-4000-8000-0000000000d2';
  begin
    perform * from public.vigia_recibir_mensaje(
      '40000000-0000-4000-8000-0000000000b1', '40000000-0000-4000-8000-0000000000d2', 'wamid.Y', 'texto', 'x', now());
    raise exception '0400: la ingesta aceptó un contacto dado de baja';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

do $$
declare conv uuid; ent uuid;
begin
  select id into conv from public.vigia_conversacion where contacto_id = '40000000-0000-4000-8000-0000000000d1' and estado = 'activa';
  select id into ent from public.vigia_mensaje where wamid = 'wamid.A2' and tenant_id = '40000000-0000-4000-8000-0000000000a1';

  -- (c) dos conversaciones activas del mismo contacto: choca.
  begin
    insert into public.vigia_conversacion (tenant_id, contacto_id, cliente_id)
    values ('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000a2');
    raise exception '0400: se abrió una segunda conversación activa para el mismo contacto';
  exception when unique_violation then null;
  end;

  -- El agente redacta UNA respuesta al entrante…
  insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, texto, estado, respuesta_a, riesgo)
  values ('40000000-0000-4000-8000-0000000000a1', conv, 'saliente', 'agente', 'borrador', 'pendiente_aprobacion', ent, 'bajo');
  -- (c) …y una segunda del agente al mismo entrante choca (un humano sí puede responder aparte).
  begin
    insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, texto, estado, respuesta_a)
    values ('40000000-0000-4000-8000-0000000000a1', conv, 'saliente', 'agente', 'otro borrador', 'borrador', ent);
    raise exception '0400: el agente redactó dos respuestas al mismo mensaje';
  exception when unique_violation then null;
  end;
  insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, texto, estado, respuesta_a, aprobado_por, aprobado_en, enviado_en, via)
  values ('40000000-0000-4000-8000-0000000000a1', conv, 'saliente', 'humano', 'respuesta del gerente', 'enviado', ent,
          '40000000-0000-4000-8000-0000000000c1', now(), now(), 'texto');

  -- (d) un entrante no puede traer estado de saliente, ni un saliente 'recibido'.
  begin
    insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, texto, estado)
    values ('40000000-0000-4000-8000-0000000000a1', conv, 'entrante', 'cliente', 'x', 'enviado');
    raise exception '0400: un entrante entró con estado de saliente';
  exception when check_violation then null;
  end;
  begin
    insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, texto, estado)
    values ('40000000-0000-4000-8000-0000000000a1', conv, 'saliente', 'cliente', 'x', 'borrador');
    raise exception '0400: un saliente entró con autor cliente';
  exception when check_violation then null;
  end;
  -- (d) «enviado» sin hora/vía: constancia a medias.
  begin
    insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, texto, estado, aprobado_por)
    values ('40000000-0000-4000-8000-0000000000a1', conv, 'saliente', 'humano', 'x', 'enviado', '40000000-0000-4000-8000-0000000000c1');
    raise exception '0400: entró un enviado sin hora ni vía';
  exception when check_violation then null;
  end;
  -- (d) «aprobado» sin quién y sin autoenviado.
  begin
    insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, texto, estado)
    values ('40000000-0000-4000-8000-0000000000a1', conv, 'saliente', 'agente', 'x', 'aprobado');
    raise exception '0400: entró un aprobado que nadie aprobó';
  exception when check_violation then null;
  end;
  -- (d) …pero autoenviado SÍ lo explica.
  insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, texto, estado, autoenviado)
  values ('40000000-0000-4000-8000-0000000000a1', conv, 'saliente', 'agente', 'autoenviado', 'aprobado', true);
  -- (d) dominio de intención.
  begin
    update public.vigia_mensaje set intencion = 'inventada' where id = ent;
    raise exception '0400: entró una intención fuera del dominio';
  exception when check_violation then null;
  end;
  -- (e) un mensaje no se cuelga de una conversación de OTRA flota.
  begin
    insert into public.vigia_mensaje (tenant_id, conversacion_id, direccion, autor, texto, estado)
    values ('40000000-0000-4000-8000-0000000000b1', conv, 'entrante', 'cliente', 'x', 'recibido');
    raise exception '0400: un mensaje de la flota B se colgó de una conversación de la flota A';
  exception when foreign_key_violation then null;
  end;

  -- La bitácora: la clave de idempotencia impide el mismo escalamiento dos veces.
  insert into public.vigia_evento (tenant_id, conversacion_id, tipo, clave, nivel)
  values ('40000000-0000-4000-8000-0000000000a1', conv, 'escalada', 'c:1:n1', 1);
  begin
    insert into public.vigia_evento (tenant_id, conversacion_id, tipo, clave, nivel)
    values ('40000000-0000-4000-8000-0000000000a1', conv, 'escalada', 'c:1:n1', 1);
    raise exception '0400: el mismo nivel de escalamiento entró dos veces';
  exception when unique_violation then null;
  end;
  -- …y la misma clave en otra flota es otra constancia.
  insert into public.vigia_evento (tenant_id, tipo, clave, nivel)
  values ('40000000-0000-4000-8000-0000000000b1', 'escalada', 'c:1:n1', 1);
end $$;

-- (e) RLS. El dueño y el encargado de la flota A ven SOLO lo de A; el contador
-- (no atiende clientes) y el dueño de B no ven lo de A; nadie escribe por REST.
reset role;
do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-0000000000c1', true);
  select count(*) into n from public.vigia_mensaje;
  if n = 0 then raise exception '0400: el dueño de la flota A no ve sus mensajes'; end if;
  if exists (select 1 from public.vigia_mensaje where tenant_id <> '40000000-0000-4000-8000-0000000000a1') then
    raise exception '0400: el dueño de la flota A ve mensajes de otra flota';
  end if;
  perform set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-0000000000c2', true);
  select count(*) into n from public.vigia_conversacion;
  if n = 0 then raise exception '0400: el encargado no ve sus conversaciones'; end if;
  perform set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-0000000000c3', true);
  select count(*) into n from public.vigia_mensaje;
  if n <> 0 then raise exception '0400: el contador ve chats de clientes (%)', n; end if;
  select count(*) into n from public.vigia_contacto;
  if n <> 0 then raise exception '0400: el contador ve la allowlist de clientes (%)', n; end if;
  perform set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-0000000000c4', true);
  if exists (select 1 from public.vigia_mensaje where tenant_id = '40000000-0000-4000-8000-0000000000a1') then
    raise exception '0400: el dueño de la flota B ve mensajes de la flota A';
  end if;
  -- nadie escribe por REST
  begin
    insert into public.vigia_config (tenant_id, habilitado) values ('40000000-0000-4000-8000-0000000000b1', true);
    raise exception '0400: un usuario autenticado escribió vigia_config por REST';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.vigia_suprimir_contacto('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000d1');
    raise exception '0400: un usuario autenticado ejecutó la supresión ARCO';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.vigia_recibir_mensaje('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000d1', 'w', 'texto', 'x', now());
    raise exception '0400: un usuario autenticado ejecutó la ingesta';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- (f) retención: solo lo vencido de SU flota. La flota B conserva 30 días; el
-- mensaje de A de hace 200 días (retención 180 por omisión) se borra; el de
-- hace 10 días no; el de B con retención 30 y 40 días sí; con 90 días en A no.
set local role service_role;
insert into public.vigia_config (tenant_id, habilitado, retencion_dias) values ('40000000-0000-4000-8000-0000000000b1', true, 30);
do $$
declare conv_a uuid; conv_b uuid; n integer;
begin
  select id into conv_a from public.vigia_conversacion where contacto_id = '40000000-0000-4000-8000-0000000000d1';
  select id into conv_b from public.vigia_conversacion where tenant_id = '40000000-0000-4000-8000-0000000000b1' limit 1;
  insert into public.vigia_mensaje (id, tenant_id, conversacion_id, direccion, autor, texto, estado, created_at) values
    ('40000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000a1', conv_a, 'entrante', 'cliente', 'viejo A', 'recibido', now() - interval '200 days'),
    ('40000000-0000-4000-8000-0000000000e2', '40000000-0000-4000-8000-0000000000a1', conv_a, 'entrante', 'cliente', 'reciente A', 'recibido', now() - interval '10 days'),
    ('40000000-0000-4000-8000-0000000000e3', '40000000-0000-4000-8000-0000000000a1', conv_a, 'entrante', 'cliente', 'medio A', 'recibido', now() - interval '90 days'),
    ('40000000-0000-4000-8000-0000000000e4', '40000000-0000-4000-8000-0000000000b1', conv_b, 'entrante', 'cliente', 'viejo B', 'recibido', now() - interval '40 days');
  n := public.vigia_purgar(500);
  if exists (select 1 from public.vigia_mensaje where id in ('40000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e4')) then
    raise exception '0400: la purga no borró lo vencido';
  end if;
  if (select count(*) from public.vigia_mensaje where id in ('40000000-0000-4000-8000-0000000000e2', '40000000-0000-4000-8000-0000000000e3')) <> 2 then
    raise exception '0400: la purga borró lo que aún estaba dentro de su retención';
  end if;
  begin perform public.vigia_purgar(0); raise exception '0400: la purga aceptó límite 0';
  exception when raise_exception then if sqlerrm like '0400:%' then raise; end if; end;
end $$;

-- (f) ARCO: suprimir al contacto de A. Sin mensajes, sin conversaciones, sin
-- teléfono en claro, sin ventana de 24 h; la bitácora no guarda texto. El de B
-- no se toca. Una flota no puede suprimir el contacto de otra.
do $$
declare r jsonb;
begin
  insert into public.wa_ventana_contacto (telefono, ultimo_entrante_en) values ('525511110001', now());
  begin
    perform public.vigia_suprimir_contacto('40000000-0000-4000-8000-0000000000b1', '40000000-0000-4000-8000-0000000000d1');
    raise exception '0400: la flota B suprimió un contacto de la flota A';
  exception when sqlstate 'P0001' then null;
  end;
  r := public.vigia_suprimir_contacto('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000d1');
  if (r ->> 'mensajes')::int < 3 then raise exception '0400: la supresión no reporta lo borrado: %', r; end if;
  if exists (select 1 from public.vigia_mensaje where tenant_id = '40000000-0000-4000-8000-0000000000a1') then
    raise exception '0400: quedaron mensajes del contacto suprimido';
  end if;
  if exists (select 1 from public.vigia_conversacion where contacto_id = '40000000-0000-4000-8000-0000000000d1') then
    raise exception '0400: quedó la conversación del contacto suprimido';
  end if;
  if exists (select 1 from public.vigia_contacto where id = '40000000-0000-4000-8000-0000000000d1'
               and (telefono = '525511110001' or nombre is not null or estado <> 'suprimido')) then
    raise exception '0400: el contacto suprimido conserva teléfono, nombre o estado activo';
  end if;
  if exists (select 1 from public.wa_ventana_contacto where telefono = '525511110001') then
    raise exception '0400: quedó la ventana de 24 h del contacto suprimido';
  end if;
  if not exists (select 1 from public.vigia_evento where tipo = 'suprimido' and destinatario_hash = repeat('a', 64)) then
    raise exception '0400: la supresión no dejó constancia (solo el hash)';
  end if;
  -- un suprimido ya no entra por la ingesta, y su número queda libre.
  begin
    perform * from public.vigia_recibir_mensaje('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000d1', 'wamid.Z', 'texto', 'x', now());
    raise exception '0400: la ingesta aceptó un contacto suprimido';
  exception when sqlstate 'P0001' then null;
  end;
  insert into public.vigia_contacto (tenant_id, cliente_id, telefono, telefono_hash, consentimiento_en, consentimiento_origen)
  values ('40000000-0000-4000-8000-0000000000b1', '40000000-0000-4000-8000-0000000000b2', '525511110001', repeat('9', 64), now(), 'alta_flota');
end $$;

-- (g) el CHECK de cron_latido admite `vigia` y sigue rechazando uno inventado.
reset role;
do $$
begin
  insert into public.cron_latido (id) values ('vigia');
  insert into public.cron_latido (id) values ('liquidaciones-externas');
  insert into public.cron_latido (id) values ('peajes');
  begin
    insert into public.cron_latido (id) values ('inventado');
    raise exception '0400: cron_latido aceptó un id inventado';
  exception when check_violation then null;
  end;
  -- el dominio de modelo_rol admite el rol nuevo y rechaza basura.
  insert into public.agente_definicion (id, nombre, departamento, modelo_rol) values ('vigia_cliente_prueba', 'Prueba 0400', 'producto', 'vigia_cliente');
  begin
    insert into public.agente_definicion (id, nombre, departamento, modelo_rol) values ('basura', 'Basura 0400', 'producto', 'no_existe');
    raise exception '0400: modelo_rol aceptó un rol inexistente';
  exception when check_violation then null;
  end;
end $$;

rollback;
