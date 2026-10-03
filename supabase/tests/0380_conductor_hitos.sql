\set ON_ERROR_STOP on
-- 0380 — AGENTE 5 «CONDUCTOR» (hitos del viaje) contra Postgres REAL.
--
-- Lo que SOLO la base puede demostrar:
--   (a) la secuencia de CHECKs: dominios, coherencia recibido/validado/omitido/escalado,
--       coordenadas en pareja, topes de texto y contadores;
--   (b) unicidad: (viaje, tipo), wa_message_id por flota, y el CLAIM de avisos
--       (hito, ciclo, clase, nivel) — el candado anti-duplicado;
--   (c) aislamiento entre flotas dentro de las FK compuestas (hito↔viaje,
--       aviso↔hito, contacto↔terminal);
--   (d) RLS: la operación ve solo SU flota, el contador no, nadie escribe por REST;
--   (e) la siembra set-based e idempotente de los cinco hitos;
--   (f) la config: escalera ascendente, ventana, días, plazos;
--   (g) la cancelación ARCO por disparador: borra el dato personal, conserva instantes;
--   (h) la retención: anonimización y purga con sus guardas;
--   (i) el dominio de cron_latido (los 13 de antes + el nuevo) y el de modelo_rol.
begin;

insert into public.tenant (id, nombre) values
  ('38000000-0000-4000-8000-0000000000a1', 'Flota A 0380'),
  ('38000000-0000-4000-8000-0000000000b1', 'Flota B 0380');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('38000000-0000-4000-8000-0000000000a2', '38000000-0000-4000-8000-0000000000a1', 'Chofer A', '525500003801'),
  ('38000000-0000-4000-8000-0000000000b2', '38000000-0000-4000-8000-0000000000b1', 'Chofer B', '525500003802'),
  ('38000000-0000-4000-8000-0000000000a3', '38000000-0000-4000-8000-0000000000a1', 'Chofer A2', '525500003803'),
  ('38000000-0000-4000-8000-0000000000b3', '38000000-0000-4000-8000-0000000000b1', 'Chofer B2', '525500003804');
insert into public.terminal (id, tenant_id, nombre) values
  ('38000000-0000-4000-8000-0000000000a5', '38000000-0000-4000-8000-0000000000a1', 'Tlaquepaque'),
  ('38000000-0000-4000-8000-0000000000b5', '38000000-0000-4000-8000-0000000000b1', 'Silao');
insert into public.app_user (id, tenant_id, email, rol) values
  ('38000000-0000-4000-8000-0000000000c1', '38000000-0000-4000-8000-0000000000a1', 'dueno-0380@test.invalid', 'flota_admin'),
  ('38000000-0000-4000-8000-0000000000c2', '38000000-0000-4000-8000-0000000000a1', 'encargado-0380@test.invalid', 'encargado'),
  ('38000000-0000-4000-8000-0000000000c3', '38000000-0000-4000-8000-0000000000a1', 'contador-0380@test.invalid', 'contador');
-- Cuatro viajes de A (uno abierto y aceptado, uno sin aceptar, uno liquidado, uno de flota apagada) y uno de B.
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en) values
  ('38000000-0000-4000-8000-0000000000d1', '38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000a2', 'A-1', 'abierto', now(), now()),
  ('38000000-0000-4000-8000-0000000000d2', '38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000a3', 'A-2', 'abierto', null, null),
  ('38000000-0000-4000-8000-0000000000d3', '38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000a2', 'A-3', 'liquidado', now(), now()),
  ('38000000-0000-4000-8000-0000000000e1', '38000000-0000-4000-8000-0000000000b1', '38000000-0000-4000-8000-0000000000b2', 'B-1', 'abierto', now(), now());

set local role service_role;

-- ── (e) La siembra ──────────────────────────────────────────────────────────
do $$
declare n int;
begin
  -- Flota B con el agente APAGADO: no recibe filas.
  insert into public.agente_conductor_config (tenant_id, activo) values ('38000000-0000-4000-8000-0000000000b1', false);
  n := public.sembrar_hitos_conductor(500);
  if n <> 5 then raise exception '0380: la siembra creó % filas (se esperaban 5: solo A-1)', n; end if;
  if exists (select 1 from public.viaje_hito where viaje_id in
       ('38000000-0000-4000-8000-0000000000d2', '38000000-0000-4000-8000-0000000000d3', '38000000-0000-4000-8000-0000000000e1')) then
    raise exception '0380: se sembraron hitos de un viaje sin aceptar, liquidado o de flota apagada';
  end if;
  if public.sembrar_hitos_conductor(500) <> 0 then raise exception '0380: la siembra NO es idempotente'; end if;
  if (select count(distinct tipo) from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1') <> 5 then
    raise exception '0380: faltan tipos de hito';
  end if;
  begin perform public.sembrar_hitos_conductor(0); raise exception '0380: la siembra aceptó límite 0';
  exception when raise_exception then if sqlerrm like '0380:%' then raise; end if; end;
end $$;

-- ── (a) CHECKs de viaje_hito ────────────────────────────────────────────────
create temporary table caso (nombre text, cambios text);
grant all on caso to public;
insert into caso values
  ('estado fuera de dominio', $$estado = 'visto'$$),
  ('tipo fuera de dominio', $$tipo = 'inventado'$$),
  ('fuente fuera de dominio', $$fuente = 'telepatia', estado = 'recibido', recibido_en = now()$$),
  ('recibido sin fuente', $$estado = 'recibido', recibido_en = now()$$),
  ('recibido sin hora', $$estado = 'recibido', fuente = 'texto'$$),
  ('esperado con hora de recepción', $$recibido_en = now(), fuente = 'texto'$$),
  ('validado sin validador', $$estado = 'validado', recibido_en = now(), fuente = 'texto'$$),
  ('validado_por fuera de dominio', $$estado = 'validado', recibido_en = now(), fuente = 'texto', validado_en = now(), validado_por = 'vecino'$$),
  ('omitido sin motivo', $$estado = 'omitido'$$),
  ('motivo de omisión en un hito que no está omitido', $$omitido_motivo = 'x'$$),
  ('escalado sin hora ni nivel', $$estado = 'escalado'$$),
  ('latitud sin longitud', $$lat = 20.5$$),
  ('latitud fuera de rango', $$lat = 91, lng = 0$$),
  ('longitud fuera de rango', $$lat = 0, lng = 181$$),
  ('texto del chofer de más de 240', $$texto_chofer = repeat('x', 241)$$),
  ('contacto vacío', $$contacto_nombre = ''$$),
  ('área de más de 60', $$contacto_area = repeat('x', 61)$$),
  ('confianza fuera de rango', $$confianza = 1.5$$),
  ('ciclo en cero', $$ciclo = 0$$),
  ('recordatorios de más', $$recordatorios_enviados = 31$$),
  ('nivel de escalación 3', $$escalacion_nivel = 3$$),
  ('interpretación fuera de dominio', $$interpretacion = 'adivino'$$);

do $$
declare c record; rechazo boolean; h uuid;
begin
  for c in select * from caso loop
    h := (select id from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'regreso');
    rechazo := false;
    begin
      execute format('update public.viaje_hito set %s where id = %L', c.cambios, h);
    exception when check_violation then rechazo := true;
    end;
    if not rechazo then raise exception '0380: el CHECK dejó pasar «%»', c.nombre; end if;
  end loop;

  -- Lo que SÍ debe pasar: un ciclo completo de estados válidos.
  update public.viaje_hito set estado = 'recibido', fuente = 'boton', interpretacion = 'boton', recibido_en = now(),
         mensaje_en = now(), lat = 20.6597, lng = -103.3496, contacto_nombre = 'Juan', contacto_area = 'recibo', confianza = 1
   where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'llegada_carga';
  update public.viaje_hito set estado = 'validado', validado_en = now(), validado_por = 'oficina'
   where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'llegada_carga';
  update public.viaje_hito set estado = 'omitido', omitido_motivo = 'inferido_por_llegada_descarga'
   where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'salida_carga';
  update public.viaje_hito set estado = 'escalado', escalado_en = now(), escalacion_nivel = 1
   where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'llegada_descarga';
  -- Un escalado que luego se recibe conserva su historia de escalación (CHECK permite recibido con escalado_en).
  update public.viaje_hito set estado = 'recibido', fuente = 'texto', recibido_en = now()
   where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'llegada_descarga';
end $$;

-- ── (b) unicidad ────────────────────────────────────────────────────────────
do $$
begin
  begin
    insert into public.viaje_hito (tenant_id, viaje_id, tipo)
    values ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000d1', 'regreso');
    raise exception '0380: dos hitos del mismo tipo en el mismo viaje';
  exception when unique_violation then null;
  end;

  -- El mismo wamid no registra dos hitos de la misma flota…
  update public.viaje_hito set wa_message_id = 'wamid.UNO'
   where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'salida_descarga';
  begin
    update public.viaje_hito set wa_message_id = 'wamid.UNO'
     where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'regreso';
    raise exception '0380: el mismo mensaje de WhatsApp registró dos hitos';
  exception when unique_violation then null;
  end;
  -- …pero otra flota puede tener el mismo id de mensaje.
  insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en)
  values ('38000000-0000-4000-8000-0000000000e2', '38000000-0000-4000-8000-0000000000b1', '38000000-0000-4000-8000-0000000000b3', 'B-2', 'abierto', now(), now());
  insert into public.viaje_hito (tenant_id, viaje_id, tipo, wa_message_id)
  values ('38000000-0000-4000-8000-0000000000b1', '38000000-0000-4000-8000-0000000000e2', 'regreso', 'wamid.UNO');
end $$;

-- ── (c) aislamiento en las FK compuestas ────────────────────────────────────
do $$
declare hito uuid := (select id from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'regreso');
begin
  begin
    insert into public.viaje_hito (tenant_id, viaje_id, tipo)
    values ('38000000-0000-4000-8000-0000000000b1', '38000000-0000-4000-8000-0000000000d3', 'salida_descarga');
    raise exception '0380: un hito de la flota B se colgó de un viaje de la flota A';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase)
    values ('38000000-0000-4000-8000-0000000000b1', '38000000-0000-4000-8000-0000000000d1', hito, 1, 'solicitud');
    raise exception '0380: un aviso de la flota B se colgó de un hito de la flota A';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento)
    values ('38000000-0000-4000-8000-0000000000b1', '38000000-0000-4000-8000-0000000000d1', hito, 'regreso', 'recibido');
    raise exception '0380: un evento de la flota B se colgó de un hito de la flota A';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.conductor_contacto_trafico (tenant_id, terminal_id, nivel, nombre, telefono)
    values ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000b5', 1, 'Patio', '525500003899');
    raise exception '0380: un contacto de A se colgó de una terminal de B';
  exception when foreign_key_violation then null;
  end;
end $$;

-- ── (b) el CLAIM de avisos ──────────────────────────────────────────────────
do $$
declare
  hito uuid := (select id from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'regreso');
  n int;
begin
  insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, operador_id, ciclo, clase, nivel)
  values ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000d1', hito, '38000000-0000-4000-8000-0000000000a2', 1, 'solicitud', 0);

  -- El perdedor del claim no inserta nada (ON CONFLICT DO NOTHING devuelve 0 filas).
  insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase, nivel)
  values ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000d1', hito, 1, 'solicitud', 0)
  on conflict (viaje_hito_id, ciclo, clase, nivel) do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception '0380: el claim del segundo corredor NO perdió'; end if;

  begin
    insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase, nivel)
    values ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000d1', hito, 1, 'solicitud', 0);
    raise exception '0380: el mismo aviso se reclamó dos veces';
  exception when unique_violation then null;
  end;

  -- Otro nivel, otra clase y OTRO CICLO (hito corregido) sí son avisos distintos.
  insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase, nivel) values
    ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000d1', hito, 1, 'recordatorio', 1),
    ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000d1', hito, 1, 'escalacion', 1),
    ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000d1', hito, 2, 'solicitud', 0);

  begin
    insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase, nivel)
    values ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000d1', hito, 1, 'inventada', 0);
    raise exception '0380: el CHECK de clase dejó pasar una inventada';
  exception when check_violation then null;
  end;
  begin
    insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase, nivel, destinatario_ult4)
    values ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000d1', hito, 3, 'solicitud', 0, '5219990000001');
    raise exception '0380: el aviso guardó un teléfono completo (solo se guardan los últimos 4)';
  exception when check_violation then null;
  end;
end $$;

-- ── (e) la bitácora de eventos es append-only ───────────────────────────────
insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle)
select tenant_id, viaje_id, id, tipo, 'recibido', '{"fuente":"texto"}'::jsonb
  from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'llegada_carga';
do $$
begin
  begin
    update public.viaje_hito_evento set evento = 'validado';
    raise exception '0380: la bitácora de eventos admitió un UPDATE (debe ser append-only)';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento)
    select tenant_id, viaje_id, id, tipo, 'inventado' from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1' limit 1;
    raise exception '0380: el CHECK de evento dejó pasar uno inventado';
  exception when check_violation then null;
  end;
  begin
    insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle)
    select tenant_id, viaje_id, id, tipo, 'recibido', jsonb_build_object('x', repeat('y', 3000))
      from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1' limit 1;
    raise exception '0380: el detalle de un evento pasó de 2000 bytes';
  exception when check_violation then null;
  end;
  begin
    insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle)
    select tenant_id, viaje_id, id, tipo, 'recibido', '[1]'::jsonb
      from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1' limit 1;
    raise exception '0380: el detalle de un evento no era un objeto';
  exception when check_violation then null;
  end;
end $$;

-- ── (f) la config ───────────────────────────────────────────────────────────
do $$
declare c record; rechazo boolean;
begin
  insert into public.agente_conductor_config (tenant_id) values ('38000000-0000-4000-8000-0000000000a1');
  if (select solicitudes_min from public.agente_conductor_config where tenant_id = '38000000-0000-4000-8000-0000000000a1') <> '[0,15,30,45]'::jsonb
     or (select escalar_tras_min from public.agente_conductor_config where tenant_id = '38000000-0000-4000-8000-0000000000a1') <> 90 then
    raise exception '0380: los defaults de la config no son 0/15/30/45 y 90';
  end if;
  for c in select * from (values
    ('escalera desordenada', $q$solicitudes_min = '[0, 30, 15]'$q$),
    ('escalera con repetidos', $q$solicitudes_min = '[0, 15, 15]'$q$),
    ('escalera vacía', $q$solicitudes_min = '[]'$q$),
    ('escalera de más de 6', $q$solicitudes_min = '[0,1,2,3,4,5,6]'$q$),
    ('escalera con texto', $q$solicitudes_min = '[0, "x"]'$q$),
    ('escalera con negativos', $q$solicitudes_min = '[-5, 10]'$q$),
    ('escalera que no es lista', $q$solicitudes_min = '{"a":1}'$q$),
    ('hora_fin antes de hora_inicio', $q$hora_inicio = 10, hora_fin = 9$q$),
    ('hora_inicio fuera de rango', $q$hora_inicio = 24$q$),
    ('días vacíos', $q$dias_semana = '[]'$q$),
    ('día 8', $q$dias_semana = '[1,8]'$q$),
    ('escalar antes de 10 min', $q$escalar_tras_min = 5$q$),
    ('tope diario en cero', $q$tope_diario_chofer = 0$q$),
    ('tope diario de 61', $q$tope_diario_chofer = 61$q$),
    ('aplazamiento de 1 min', $q$posponer_min = 1$q$),
    ('ventana de corrección de 1 min', $q$ventana_correccion_min = 1$q$)
  ) v(nombre, cambios) loop
    rechazo := false;
    begin
      execute format('update public.agente_conductor_config set %s where tenant_id = %L', c.cambios, '38000000-0000-4000-8000-0000000000a1');
    exception when check_violation then rechazo := true;
    end;
    if not rechazo then raise exception '0380: el CHECK de la config dejó pasar «%»', c.nombre; end if;
  end loop;
  -- Una config válida y distinta sí entra.
  update public.agente_conductor_config set solicitudes_min = '[0, 10, 20]', hora_inicio = 7, hora_fin = 20,
         dias_semana = '[1,2,3,4,5]', avisar_oficina_llegada = true where tenant_id = '38000000-0000-4000-8000-0000000000a1';
end $$;

-- ── Contactos de tráfico ────────────────────────────────────────────────────
do $$
begin
  insert into public.conductor_contacto_trafico (tenant_id, terminal_id, nivel, nombre, telefono) values
    ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000a5', 1, 'Patio Tlaquepaque', '525500003811'),
    ('38000000-0000-4000-8000-0000000000a1', null, 2, 'Jefe general', '525500003812');
  begin
    insert into public.conductor_contacto_trafico (tenant_id, terminal_id, nivel, nombre, telefono)
    values ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000a5', 1, 'Duplicado', '525500003811');
    raise exception '0380: el mismo contacto entró dos veces en la misma terminal y nivel';
  exception when unique_violation then null;
  end;
  begin
    insert into public.conductor_contacto_trafico (tenant_id, nivel, nombre, telefono)
    values ('38000000-0000-4000-8000-0000000000a1', 3, 'X', '525500003813');
    raise exception '0380: nivel 3 aceptado';
  exception when check_violation then null;
  end;
  begin
    insert into public.conductor_contacto_trafico (tenant_id, nivel, nombre, telefono)
    values ('38000000-0000-4000-8000-0000000000a1', 1, 'X', '55 5000 3813');
    raise exception '0380: un teléfono sin la forma 52+10 aceptado';
  exception when check_violation then null;
  end;
  -- Borrar la terminal arrastra su contacto de patio.
  delete from public.terminal where id = '38000000-0000-4000-8000-0000000000a5';
  if exists (select 1 from public.conductor_contacto_trafico where telefono = '525500003811') then
    raise exception '0380: borrar la terminal dejó su contacto de patio huérfano';
  end if;
end $$;

-- ── (g) cancelación ARCO por disparador ─────────────────────────────────────
do $$
declare
  antes timestamptz;
  hito uuid := (select id from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'llegada_carga');
begin
  update public.viaje_hito set texto_chofer = 'ya llegué, me atiende Juan', evidencia_ruta = 'pod/x.jpg' where id = hito;
  update public.viaje_hito_aviso set destinatario_ult4 = '0001'
   where viaje_hito_id = (select id from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'regreso');
  antes := (select recibido_en from public.viaje_hito where id = hito);

  update public.operador set anonimizado_en = now() where id = '38000000-0000-4000-8000-0000000000a2';

  if exists (select 1 from public.viaje_hito where id = hito and
       (contacto_nombre is not null or contacto_area is not null or lat is not null or lng is not null or texto_chofer is not null or evidencia_ruta is not null)) then
    raise exception '0380: la cancelación ARCO NO borró el dato personal del hito';
  end if;
  if (select estado from public.viaje_hito where id = hito) <> 'validado' or (select recibido_en from public.viaje_hito where id = hito) <> antes then
    raise exception '0380: la cancelación ARCO tocó el estado o los instantes del hito (son evidencia de estadías)';
  end if;
  if exists (select 1 from public.viaje_hito_aviso where operador_id = '38000000-0000-4000-8000-0000000000a2' and destinatario_ult4 is not null) then
    raise exception '0380: la cancelación ARCO dejó los últimos 4 dígitos en la bitácora de avisos';
  end if;
  -- Un operador de OTRA flota no se toca.
  update public.operador set anonimizado_en = now() where id = '38000000-0000-4000-8000-0000000000b2';
  if not exists (select 1 from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1') then
    raise exception '0380: el disparador borró filas';
  end if;
end $$;

-- ── (h) retención ───────────────────────────────────────────────────────────
-- Envejecer la bitácora lo hace el dueño de la tabla (service_role no actualiza eventos: es append-only).
reset role;
update public.viaje_hito_aviso set created_at = now() - interval '400 days' where ciclo = 2;
update public.viaje_hito_evento set created_at = now() - interval '400 days';
set local role service_role;
do $$
declare n int;
begin
  begin perform public.anonimizar_conductor_hitos(10, 100); raise exception '0380: anonimizar aceptó 10 días';
  exception when raise_exception then if sqlerrm like '0380:%' then raise; end if; end;
  begin perform public.purgar_conductor_auditoria(29, 100); raise exception '0380: purgar aceptó 29 días';
  exception when raise_exception then if sqlerrm like '0380:%' then raise; end if; end;
  begin perform public.purgar_conductor_auditoria(365, 0); raise exception '0380: purgar aceptó límite 0';
  exception when raise_exception then if sqlerrm like '0380:%' then raise; end if; end;

  -- Un hito VIEJO con dato personal se anonimiza; uno reciente no.
  update public.viaje_hito set contacto_nombre = 'Viejo', recibido_en = now() - interval '400 days'
   where viaje_id = '38000000-0000-4000-8000-0000000000e2' and tipo = 'regreso';
  update public.viaje_hito set estado = 'recibido', fuente = 'texto', recibido_en = now(), contacto_nombre = 'Reciente'
   where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'salida_descarga';
  n := public.anonimizar_conductor_hitos(365, 100);
  if n <> 1 then raise exception '0380: anonimizó % filas (se esperaba 1)', n; end if;
  if (select contacto_nombre from public.viaje_hito where viaje_id = '38000000-0000-4000-8000-0000000000d1' and tipo = 'salida_descarga') <> 'Reciente' then
    raise exception '0380: la retención anonimizó un hito reciente';
  end if;
  if public.anonimizar_conductor_hitos(365, 100) <> 0 then raise exception '0380: anonimizar no es idempotente'; end if;

  -- La purga borra auditoría vieja y deja la reciente.
  n := public.purgar_conductor_auditoria(365, 100);
  if n < 2 then raise exception '0380: la purga borró % filas (esperaba al menos 2)', n; end if;
  if not exists (select 1 from public.viaje_hito_aviso where ciclo = 1) then raise exception '0380: la purga se llevó avisos recientes'; end if;
end $$;

-- ── (i) dominios espejo ─────────────────────────────────────────────────────
do $$
declare
  ids text[] := array['wa-pendientes','wa-outbox','escalar','facturar','purgar','runner','gps','asistencia','descarga-sat','jornada','portales-vivos','liquidaciones-externas','peajes','conductor-hitos'];
  k text; faltan text[] := '{}';
begin
  foreach k in array ids loop
    begin insert into public.cron_latido (id) values (k) on conflict (id) do update set ultimo_latido = now();
    exception when check_violation then faltan := faltan || k; end;
  end loop;
  if cardinality(faltan) > 0 then raise exception '0380: el CHECK de cron_latido dejó fuera: %', array_to_string(faltan, ','); end if;
  begin insert into public.cron_latido (id) values ('cron-inventado'); raise exception '0380: cron_latido aceptó un id inventado';
  exception when check_violation then null; end;

  -- `agente_definicion.modelo_rol` acepta conductor_hito y los catorce de antes.
  begin
    update public.agente_definicion set modelo_rol = 'conductor_hito' where false;
    perform 1 from pg_constraint where conname = 'agente_definicion_modelo_rol_dominio'
      and pg_get_constraintdef(oid) like '%conductor_hito%';
    if not found then raise exception '0380: el dominio de modelo_rol no incluye conductor_hito'; end if;
  end;
end $$;
reset role;

-- Eventos recientes para la prueba de RLS (la purga de arriba dejó la bitácora vacía).
insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento)
select tenant_id, viaje_id, id, tipo, 'recibido' from public.viaje_hito where tenant_id = '38000000-0000-4000-8000-0000000000a1' limit 2;
insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento)
select tenant_id, viaje_id, id, tipo, 'recibido' from public.viaje_hito where tenant_id = '38000000-0000-4000-8000-0000000000b1' limit 1;

-- ── (d) RLS (lo que hace PostgREST: rol + sub del JWT) ──────────────────────
set local role authenticated;

select set_config('request.jwt.claim.sub', '38000000-0000-4000-8000-0000000000c1', true);   -- dueño de A
do $$ begin
  if (select count(*) from public.viaje_hito) <> 5
     or exists (select 1 from public.viaje_hito where tenant_id <> '38000000-0000-4000-8000-0000000000a1') then
    raise exception '0380: el dueño no ve exactamente los hitos de SU flota (vio: %)', (select count(*) from public.viaje_hito);
  end if;
  if (select count(*) from public.viaje_hito_aviso) = 0 or (select count(*) from public.viaje_hito_evento) = 0
     or (select count(*) from public.agente_conductor_config) <> 1 then
    raise exception '0380: el dueño no ve los avisos, eventos o config de su flota';
  end if;
  if exists (select 1 from public.viaje_hito_aviso where tenant_id <> '38000000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.viaje_hito_evento where tenant_id <> '38000000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.conductor_contacto_trafico where tenant_id <> '38000000-0000-4000-8000-0000000000a1') then
    raise exception '0380: el dueño ve filas de otra flota';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '38000000-0000-4000-8000-0000000000c2', true);   -- encargado: opera, ve
do $$ begin
  if (select count(*) from public.viaje_hito) <> 5 then raise exception '0380: el encargado no ve los hitos de su flota'; end if;
end $$;

select set_config('request.jwt.claim.sub', '38000000-0000-4000-8000-0000000000c3', true);   -- contador: NO es operación
do $$ begin
  if (select count(*) from public.viaje_hito) <> 0 or (select count(*) from public.viaje_hito_aviso) <> 0
     or (select count(*) from public.viaje_hito_evento) <> 0 or (select count(*) from public.agente_conductor_config) <> 0 then
    raise exception '0380: el CONTADOR leyó datos del Agente 5 (coordenadas y contactos de andén son de operación)';
  end if;
end $$;

-- Nadie escribe por REST: ni el dueño.
select set_config('request.jwt.claim.sub', '38000000-0000-4000-8000-0000000000c1', true);
do $$
declare n int;
begin
  begin
    insert into public.viaje_hito (tenant_id, viaje_id, tipo)
    values ('38000000-0000-4000-8000-0000000000a1', '38000000-0000-4000-8000-0000000000d2', 'regreso');
    raise exception '0380: el dueño INSERTÓ un hito por REST';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.viaje_hito set estado = 'validado' where tenant_id = '38000000-0000-4000-8000-0000000000a1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception '0380: el dueño MODIFICÓ % hitos por REST', n; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.viaje_hito where tenant_id = '38000000-0000-4000-8000-0000000000a1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception '0380: el dueño BORRÓ % hitos por REST', n; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.agente_conductor_config set activo = false;
    get diagnostics n = row_count;
    if n <> 0 then raise exception '0380: el dueño cambió la config por REST (se hace por servidor)'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- Las funciones de mantenimiento no son de authenticated.
do $$ begin
  begin perform public.sembrar_hitos_conductor(10); raise exception '0380: authenticated ejecutó la siembra';
  exception when insufficient_privilege then null; end;
  begin perform public.anonimizar_conductor_hitos(365, 10); raise exception '0380: authenticated ejecutó la anonimización';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
do $$ begin
  begin
    if (select count(*) from public.viaje_hito) <> 0 then raise exception '0380: anon leyó hitos'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Borrar la flota arrastra todo lo suyo.
delete from public.tenant where id = '38000000-0000-4000-8000-0000000000b1';
do $$ begin
  if exists (select 1 from public.viaje_hito where tenant_id = '38000000-0000-4000-8000-0000000000b1') then
    raise exception '0380: borrar la flota dejó sus hitos huérfanos';
  end if;
  if not exists (select 1 from public.viaje_hito where tenant_id = '38000000-0000-4000-8000-0000000000a1') then
    raise exception '0380: borrar la flota B se llevó los hitos de A';
  end if;
end $$;

rollback;
\echo 0380_conductor_hitos: PASS
