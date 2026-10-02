\set ON_ERROR_STOP on
-- 0673 + 0674 — VIGÍA: lista de directores por nivel y respaldo por correo con reclamo atómico, contra Postgres REAL
-- (datos sintéticos, rollback). Lo que solo la base garantiza:
--   (a) directores: un mismo teléfono o correo (sin importar mayúsculas) no se repite DENTRO de un nivel de una flota, pero sí en
--       otro nivel u otra flota; el CHECK exige algún canal y la forma de cada uno; tope de 10 por nivel y flota; corregir una fila
--       de OTRA flota no existe; quitar solo quita la propia;
--   (b) el interruptor `respaldo_correo` nace APAGADO;
--   (c) el reclamo del correo: la llave nueva nace `enviando` con token y arriendo; quien pierde no reclama nada; un arriendo vencido
--       se retoma con OTRO token y el viejo ya no cierra; lo cerrado no se vuelve a reclamar (ni con el reloj adelantado);
--   (d) la FK compuesta: no se reclama con la conversación de otra flota; borrar al director no borra el rastro del correo;
--   (e) los CHECK (estado final, coherencia estado/token/arriendo) y el dominio de eventos reescrito ENTERO (admite los dos del
--       respaldo y los 25 de antes, rechaza uno inventado);
--   (f) `vigia_correos_vencidos` devuelve solo lo vencido y abandona (`red`) lo de más de 6 h;
--   (g) solo service_role ejecuta las funciones y escribe; authenticated solo lee lo de su flota.
begin;

insert into public.tenant (id, nombre) values
  ('67300000-0000-4000-8000-0000000000a1', 'Flota A 0673'),
  ('67300000-0000-4000-8000-0000000000b1', 'Flota B 0673');
insert into public.cliente (id, tenant_id, nombre) values
  ('67300000-0000-4000-8000-0000000000a2', '67300000-0000-4000-8000-0000000000a1', 'Cliente A'),
  ('67300000-0000-4000-8000-0000000000b2', '67300000-0000-4000-8000-0000000000b1', 'Cliente B');

set local role service_role;

insert into public.vigia_contacto (id, tenant_id, cliente_id, telefono, telefono_hash, nombre, consentimiento_en, consentimiento_origen) values
  ('67300000-0000-4000-8000-0000000000d1', '67300000-0000-4000-8000-0000000000a1', '67300000-0000-4000-8000-0000000000a2', '525573000001', repeat('a', 64), 'Compras A', now(), 'alta_flota'),
  ('67300000-0000-4000-8000-0000000000d2', '67300000-0000-4000-8000-0000000000b1', '67300000-0000-4000-8000-0000000000b2', '525573000002', repeat('b', 64), 'Compras B', now(), 'alta_flota');
insert into public.vigia_conversacion (id, tenant_id, contacto_id, cliente_id) values
  ('67300000-0000-4000-8000-0000000000e1', '67300000-0000-4000-8000-0000000000a1', '67300000-0000-4000-8000-0000000000d1', '67300000-0000-4000-8000-0000000000a2'),
  ('67300000-0000-4000-8000-0000000000e2', '67300000-0000-4000-8000-0000000000b1', '67300000-0000-4000-8000-0000000000d2', '67300000-0000-4000-8000-0000000000b2');

-- (a) + (b) directores y config
do $$
declare
  A constant uuid := '67300000-0000-4000-8000-0000000000a1';
  B constant uuid := '67300000-0000-4000-8000-0000000000b1';
  d1 uuid; d2 uuid; d3 uuid; i int; n int; ok boolean;
begin
  insert into public.vigia_config (tenant_id) values (A);
  if (select respaldo_correo from public.vigia_config where tenant_id = A) then raise exception '0673: respaldo_correo no nace apagado'; end if;

  d1 := public.vigia_director_guardar(A, null, 1, '  Gerente Uno ', '525511112222', 'Gerente@Empresa.mx', null);
  if (select nombre from public.vigia_director where id = d1) <> 'Gerente Uno' then raise exception '0673: no recortó el nombre'; end if;

  -- El mismo teléfono / correo (otra capitalización) en el mismo nivel y flota choca.
  ok := false;
  begin perform public.vigia_director_guardar(A, null, 1, 'Otro', '525511112222', null, null); exception when unique_violation then ok := true; end;
  if not ok then raise exception '0673: admitió el mismo teléfono dos veces en un nivel'; end if;
  ok := false;
  begin perform public.vigia_director_guardar(A, null, 1, 'Otro', null, 'GERENTE@empresa.mx', null); exception when unique_violation then ok := true; end;
  if not ok then raise exception '0673: admitió el mismo correo (otra capitalización) dos veces en un nivel'; end if;
  -- Pero sí en el otro nivel y en otra flota.
  d2 := public.vigia_director_guardar(A, null, 2, 'Dueño', '525511112222', 'gerente@empresa.mx', null);
  d3 := public.vigia_director_guardar(B, null, 1, 'Gerente de B', '525511112222', 'gerente@empresa.mx', null);
  if d2 = d1 or d3 = d1 then raise exception '0673: reutilizó la fila'; end if;

  -- CHECK: algún canal, forma del teléfono, forma del correo, nivel.
  ok := false; begin perform public.vigia_director_guardar(A, null, 1, 'Sin canal', null, null, null); exception when check_violation then ok := true; end;
  if not ok then raise exception '0673: admitió un director sin teléfono ni correo'; end if;
  ok := false; begin perform public.vigia_director_guardar(A, null, 1, 'Mal tel', '12345', null, null); exception when check_violation then ok := true; end;
  if not ok then raise exception '0673: admitió un teléfono mal formado'; end if;
  ok := false; begin perform public.vigia_director_guardar(A, null, 1, 'Mal correo', null, 'sin-arroba', null); exception when check_violation then ok := true; end;
  if not ok then raise exception '0673: admitió un correo mal formado'; end if;
  ok := false; begin perform public.vigia_director_guardar(A, null, 3, 'Nivel 3', null, 'x@y.mx', null); exception when check_violation then ok := true; end;
  if not ok then raise exception '0673: admitió el nivel 3'; end if;
  ok := false; begin perform public.vigia_director_guardar(A, null, 1, '   ', null, 'x@y.mx', null); exception when check_violation then ok := true; end;
  if not ok then raise exception '0673: admitió un nombre vacío'; end if;
  ok := false; begin perform public.vigia_director_guardar('67300000-0000-4000-8000-0000000000ff', null, 1, 'Fantasma', null, 'x@y.mx', null); exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception '0673: admitió una flota inexistente'; end if;

  -- Corregir: la propia sí; la de OTRA flota no existe.
  perform public.vigia_director_guardar(A, d1, 1, 'Gerente Uno corregido', '525511112222', null, null);
  if (select nombre from public.vigia_director where id = d1) <> 'Gerente Uno corregido' or (select correo from public.vigia_director where id = d1) is not null then
    raise exception '0673: la corrección no aplicó';
  end if;
  ok := false; begin perform public.vigia_director_guardar(A, d3, 1, 'Cruce', '525511112222', null, null); exception when sqlstate 'P0002' then ok := true; end;
  if not ok then raise exception '0673: corrigió un director de otra flota'; end if;
  if (select nombre from public.vigia_director where id = d3) <> 'Gerente de B' then raise exception '0673: tocó la fila de otra flota'; end if;

  -- Tope de 10 por nivel y flota (la 11 rebota; otro nivel y otra flota no se afectan; corregir no topa).
  for i in 1..8 loop perform public.vigia_director_guardar(A, null, 1, 'G' || i, '52551100' || lpad(i::text, 4, '0'), null, null); end loop;
  select count(*) into n from public.vigia_director where tenant_id = A and nivel = 1;
  if n <> 9 then raise exception '0673: esperaba 9 en el nivel 1, hay %', n; end if;
  perform public.vigia_director_guardar(A, null, 1, 'G10', null, 'g10@empresa.mx', null);
  ok := false; begin perform public.vigia_director_guardar(A, null, 1, 'G11', null, 'g11@empresa.mx', null); exception when sqlstate '54000' then ok := true; end;
  if not ok then raise exception '0673: no rebotó el director 11'; end if;
  perform public.vigia_director_guardar(A, d1, 1, 'Corrección con tope lleno', '525511112222', null, null);
  -- Pasar uno del nivel 2 al 1 también topa.
  ok := false; begin perform public.vigia_director_guardar(A, d2, 1, 'Subir', '525511119999', null, null); exception when sqlstate '54000' then ok := true; end;
  if not ok then raise exception '0673: cambiar de nivel se saltó el tope'; end if;
  perform public.vigia_director_guardar(A, null, 2, 'Otro dueño', null, 'otro@empresa.mx', null);

  -- Quitar: solo la propia.
  if public.vigia_director_quitar(B, d1) then raise exception '0673: quitó el director de otra flota'; end if;
  if not public.vigia_director_quitar(A, d1) then raise exception '0673: no quitó el propio'; end if;
  if public.vigia_director_quitar(A, d1) then raise exception '0673: quitar dos veces dijo que sí'; end if;
end $$;

-- (c) + (d) + (e) + (f) correos de respaldo
do $$
declare
  A constant uuid := '67300000-0000-4000-8000-0000000000a1';
  B constant uuid := '67300000-0000-4000-8000-0000000000b1';
  CA constant uuid := '67300000-0000-4000-8000-0000000000e1';
  CB constant uuid := '67300000-0000-4000-8000-0000000000e2';
  dir uuid; r1 record; r2 record; r3 record; n int; ok boolean; t0 timestamptz := now();
  datos constant jsonb := '{"cliente":"Cliente A","motivo":"sin_respuesta","minutos":45,"nivel":1}';
begin
  select id into dir from public.vigia_director where tenant_id = A and nivel = 2 order by created_at limit 1;

  select * into r1 from public.vigia_correo_reclamar(A, CA, 'ciclo1:n1:abc', 1, dir, 'dir@empresa.mx', datos, 300, t0);
  if r1.o_id is null or r1.o_token is null then raise exception '0674: la llave nueva no se reclamó'; end if;
  if (select estado from public.vigia_aviso_correo where id = r1.o_id) <> 'enviando' then raise exception '0674: no nació enviando'; end if;

  -- Quien pierde no reclama nada.
  select count(*) into n from public.vigia_correo_reclamar(A, CA, 'ciclo1:n1:abc', 1, dir, 'dir@empresa.mx', datos, 300, t0 + interval '1 minute');
  if n <> 0 then raise exception '0674: la misma llave se reclamó dos veces con el arriendo vigente'; end if;

  -- Arriendo vencido: se retoma con OTRO token; el viejo ya no cierra.
  select * into r2 from public.vigia_correo_reclamar(A, CA, 'ciclo1:n1:abc', 1, dir, 'dir@empresa.mx', datos, 300, t0 + interval '10 minutes');
  if r2.o_id <> r1.o_id or r2.o_token = r1.o_token then raise exception '0674: el arriendo vencido no se retomó con otro token'; end if;
  if (select intentos from public.vigia_aviso_correo where id = r1.o_id) <> 2 then raise exception '0674: no contó el intento'; end if;
  if public.vigia_correo_cerrar(A, r1.o_id, r1.o_token, 'enviado', null, t0 + interval '11 minutes') then raise exception '0674: el token viejo cerró'; end if;
  -- Otra flota no cierra el de la mía.
  if public.vigia_correo_cerrar(B, r2.o_id, r2.o_token, 'enviado', null, t0 + interval '11 minutes') then raise exception '0674: otra flota cerró mi correo'; end if;
  if not public.vigia_correo_cerrar(A, r2.o_id, r2.o_token, 'sin_configurar', 'falta la llave', t0 + interval '11 minutes') then raise exception '0674: no cerró con el token vigente'; end if;
  if (select estado || '|' || coalesce(detalle, '') from public.vigia_aviso_correo where id = r1.o_id) <> 'sin_configurar|falta la llave' then raise exception '0674: el cierre no quedó'; end if;
  if public.vigia_correo_cerrar(A, r2.o_id, r2.o_token, 'enviado', null, t0 + interval '12 minutes') then raise exception '0674: cerró dos veces'; end if;

  -- Lo cerrado no se reclama de nuevo (ni con el reloj adelantado).
  select count(*) into n from public.vigia_correo_reclamar(A, CA, 'ciclo1:n1:abc', 1, dir, 'dir@empresa.mx', datos, 300, t0 + interval '2 days');
  if n <> 0 then raise exception '0674: un correo ya cerrado se reclamó otra vez'; end if;

  -- (d) FK compuesta: la conversación de otra flota no sirve.
  ok := false;
  begin perform public.vigia_correo_reclamar(A, CB, 'ciclo2:n1:abc', 1, null, 'x@empresa.mx', datos, 300, t0); exception when foreign_key_violation then ok := true; end;
  if not ok then raise exception '0674: reclamó con la conversación de otra flota'; end if;
  ok := false;
  begin perform public.vigia_correo_reclamar(A, CA, 'ciclo2:n1:abc', 1, (select id from public.vigia_director where tenant_id = B limit 1), 'x@empresa.mx', datos, 300, t0); exception when foreign_key_violation then ok := true; end;
  if not ok then raise exception '0674: reclamó con el director de otra flota'; end if;
  -- Borrar al director no borra el rastro del correo.
  perform public.vigia_director_quitar(A, dir);
  if (select director_id from public.vigia_aviso_correo where id = r1.o_id) is not null then raise exception '0674: el correo conservó al director borrado'; end if;
  if not exists (select 1 from public.vigia_aviso_correo where id = r1.o_id) then raise exception '0674: borrar al director borró el correo'; end if;

  -- (e) dominios
  ok := false; begin perform public.vigia_correo_cerrar(A, r2.o_id, r2.o_token, 'enviando', null, t0); exception when sqlstate '22023' then ok := true; end;
  if not ok then raise exception '0674: admitió «enviando» como estado final'; end if;
  ok := false;
  begin insert into public.vigia_aviso_correo (tenant_id, conversacion_id, clave, nivel, destino_correo, estado) values (A, CA, 'x1', 1, 'x@y.mx', 'enviando'); exception when check_violation then ok := true; end;
  if not ok then raise exception '0674: admitió «enviando» sin token ni arriendo'; end if;
  ok := false;
  begin insert into public.vigia_aviso_correo (tenant_id, conversacion_id, clave, nivel, destino_correo, estado, reclamo_token, reclamo_expira_en) values (A, CA, 'x2', 1, 'x@y.mx', 'enviado', gen_random_uuid(), now()); exception when check_violation then ok := true; end;
  if not ok then raise exception '0674: admitió «enviado» con token'; end if;
  ok := false;
  begin insert into public.vigia_aviso_correo (tenant_id, conversacion_id, clave, nivel, destino_correo, estado) values (A, CA, 'x3', 1, 'x@y.mx', 'inventado'); exception when check_violation then ok := true; end;
  if not ok then raise exception '0674: admitió un estado inventado'; end if;

  -- eventos: los dos nuevos y uno de antes pasan; uno inventado no.
  insert into public.vigia_evento (tenant_id, conversacion_id, tipo) values (A, CA, 'correo_enviado'), (A, CA, 'correo_fallo'), (A, CA, 'adjunto_fallo'), (A, CA, 'entrante');
  ok := false; begin insert into public.vigia_evento (tenant_id, conversacion_id, tipo) values (A, CA, 'inventado'); exception when check_violation then ok := true; end;
  if not ok then raise exception '0674: admitió un evento inventado'; end if;

  -- (f) vencidos: solo lo vencido; lo de más de 6 h se abandona.
  perform public.vigia_correo_reclamar(A, CA, 'v1', 1, null, 'v1@empresa.mx', datos, 300, t0);
  perform public.vigia_correo_reclamar(B, CB, 'v2', 2, null, 'v2@empresa.mx', datos, 300, t0 + interval '1 hour');
  select count(*) into n from public.vigia_correos_vencidos(50, t0 + interval '1 minute');
  if n <> 0 then raise exception '0674: devolvió un correo con el arriendo vigente (%)', n; end if;
  select count(*) into n from public.vigia_correos_vencidos(50, t0 + interval '10 minutes');
  if n <> 1 then raise exception '0674: debía devolver 1 vencido (cruza flotas), devolvió %', n; end if;
  select count(*) into n from public.vigia_correos_vencidos(50, t0 + interval '2 hours');
  if n <> 2 then raise exception '0674: debía devolver los 2 vencidos, devolvió %', n; end if;
  update public.vigia_aviso_correo set created_at = t0 - interval '7 hours' where clave = 'v1';
  select count(*) into n from public.vigia_correos_vencidos(50, t0 + interval '2 hours');
  if n <> 1 then raise exception '0674: el de más de 6 h debía abandonarse (quedan %)', n; end if;
  if (select estado from public.vigia_aviso_correo where clave = 'v1') <> 'red' then raise exception '0674: no quedó como red'; end if;

  -- cascade: borrar la conversación borra sus correos.
  delete from public.vigia_conversacion where id = CB;
  if exists (select 1 from public.vigia_aviso_correo where tenant_id = B) then raise exception '0674: la conversación borrada dejó correos'; end if;
end $$;

-- (g) permisos y RLS
reset role;
insert into public.app_user (id, tenant_id, email, rol) values
  ('67300000-0000-4000-8000-0000000000c1', '67300000-0000-4000-8000-0000000000a1', 'dueno-0673@test.invalid', 'flota_admin'),
  ('67300000-0000-4000-8000-0000000000c3', '67300000-0000-4000-8000-0000000000a1', 'contador-0673@test.invalid', 'contador');
do $$ begin perform set_config('request.jwt.claims', '{"sub":"67300000-0000-4000-8000-0000000000c1","role":"authenticated"}', true); end $$;
set local role authenticated;
do $$
declare ok boolean; n int;
begin
  select count(*) into n from public.vigia_director;
  if n = 0 then raise exception '0673: el dueño no ve a los directores de su flota'; end if;
  if exists (select 1 from public.vigia_director where tenant_id = '67300000-0000-4000-8000-0000000000b1') then raise exception '0673: el dueño ve directores de otra flota'; end if;
  ok := false; begin insert into public.vigia_director (tenant_id, nivel, nombre, correo) values ('67300000-0000-4000-8000-0000000000a1', 1, 'Colado', 'c@y.mx'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception '0673: authenticated escribió directores'; end if;
  ok := false; begin perform public.vigia_director_guardar('67300000-0000-4000-8000-0000000000a1', null, 1, 'Colado', null, 'c@y.mx', null); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception '0673: authenticated ejecutó vigia_director_guardar'; end if;
  ok := false; begin perform public.vigia_correo_reclamar('67300000-0000-4000-8000-0000000000a1', '67300000-0000-4000-8000-0000000000e1', 'k', 1, null, 'x@y.mx', '{}'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception '0674: authenticated ejecutó vigia_correo_reclamar'; end if;
  ok := false; begin perform * from public.vigia_correos_vencidos(5); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception '0674: authenticated ejecutó vigia_correos_vencidos'; end if;
  select count(*) into n from public.vigia_aviso_correo;
  if n = 0 then raise exception '0674: el dueño no ve los correos de su flota'; end if;
end $$;
reset role;
-- El contador no atiende clientes: no ve nada.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"67300000-0000-4000-8000-0000000000c3","role":"authenticated"}', true); end $$;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.vigia_director) or exists (select 1 from public.vigia_aviso_correo) then raise exception '0673: el contador ve directores o correos'; end if;
end $$;
reset role;

rollback;
\echo 0673_vigia_directores_correo PASS
