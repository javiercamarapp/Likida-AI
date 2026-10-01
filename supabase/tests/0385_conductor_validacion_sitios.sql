\set ON_ERROR_STOP on
-- 0385 — AGENTE 5 «CONDUCTOR», segunda entrega, contra Postgres REAL.
--
-- Lo que SOLO la base puede demostrar:
--   (a) el catálogo de sitios (geocerca ampliada): tipos nuevos, código único por flota, FK compuestas
--       (un sitio no cuelga de un cliente/padre de OTRA flota; un viaje no apunta a un sitio ajeno);
--   (b) el veredicto de validación: CHECKs, unicidad por (hito, ciclo), y que SOLO MEJORA
--       (sin_dato → sin_coincidencia → validado; un veredicto lejano no desdice uno positivo);
--       validado mueve el hito a `validado` por gps; un hito retirado (otro ciclo) no recibe veredicto;
--   (c) la evidencia: CHECKs, unicidad por huella y por mensaje de WhatsApp;
--   (d) las acciones de oficina: capturar (hora válida, omite los pendientes anteriores), validar,
--       atender; todas con bitácora y motivo, atómicas; la bitácora es append-only;
--   (e) los indicadores agregados y sus filtros, aislados por flota;
--   (f) la retención y la cancelación ARCO de la evidencia (encolan el archivo, desligan la ruta);
--   (g) RLS: dueño y encargado ven SOLO su flota, el contador no, nadie escribe por REST ni ejecuta las funciones.
begin;

insert into public.tenant (id, nombre) values
  ('38500000-0000-4000-8000-0000000000a1', 'Flota A 0385'),
  ('38500000-0000-4000-8000-0000000000b1', 'Flota B 0385');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('38500000-0000-4000-8000-0000000000a2', '38500000-0000-4000-8000-0000000000a1', 'Chofer A', '525500003851'),
  ('38500000-0000-4000-8000-0000000000b2', '38500000-0000-4000-8000-0000000000b1', 'Chofer B', '525500003852');
insert into public.app_user (id, tenant_id, email, rol) values
  ('38500000-0000-4000-8000-0000000000c1', '38500000-0000-4000-8000-0000000000a1', 'dueno-0385@test.invalid', 'flota_admin'),
  ('38500000-0000-4000-8000-0000000000c2', '38500000-0000-4000-8000-0000000000a1', 'encargado-0385@test.invalid', 'encargado'),
  ('38500000-0000-4000-8000-0000000000c3', '38500000-0000-4000-8000-0000000000a1', 'contador-0385@test.invalid', 'contador');
insert into public.cliente (id, tenant_id, nombre) values
  ('38500000-0000-4000-8000-0000000000e1', '38500000-0000-4000-8000-0000000000a1', 'Cliente A'),
  ('38500000-0000-4000-8000-0000000000e2', '38500000-0000-4000-8000-0000000000b1', 'Cliente B');
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en, cliente_id) values
  ('38500000-0000-4000-8000-0000000000d1', '38500000-0000-4000-8000-0000000000a1', '38500000-0000-4000-8000-0000000000a2', 'A-1', 'abierto', now() - interval '5 hours', now() - interval '5 hours', '38500000-0000-4000-8000-0000000000e1'),
  ('38500000-0000-4000-8000-0000000000e3', '38500000-0000-4000-8000-0000000000b1', '38500000-0000-4000-8000-0000000000b2', 'B-1', 'abierto', now() - interval '5 hours', now() - interval '5 hours', null);
select public.sembrar_hitos_conductor(10);

-- ── (a) el catálogo de sitios ───────────────────────────────────────────────
insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, codigo, direccion, cliente_id, fuente) values
  ('38500000-0000-4000-8000-0000000000f1', '38500000-0000-4000-8000-0000000000a1', 'Planta Zapopan', 'planta', 20.7200, -103.3900, 300, 'PL-ZAP', 'Periférico 1', '38500000-0000-4000-8000-0000000000e1', 'csv'),
  ('38500000-0000-4000-8000-0000000000f3', '38500000-0000-4000-8000-0000000000b1', 'Planta B', 'planta', 25.6700, -100.3100, 300, 'PL-ZAP', null, null, 'manual');
-- Mismo código en OTRA flota: permitido (es único por flota, no global).
insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, codigo, padre_id) values
  ('38500000-0000-4000-8000-0000000000f2', '38500000-0000-4000-8000-0000000000a1', 'Andén 3', 'anden', 20.7201, -103.3901, 50, 'AN-3', '38500000-0000-4000-8000-0000000000f1');

do $$ begin
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, codigo)
    values ('38500000-0000-4000-8000-0000000000a1', 'Otro', 'planta', 20, -103, 100, 'PL-ZAP');
    raise exception '0385: aceptó un código repetido en la flota';
  exception when unique_violation then null; end;
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m) values ('38500000-0000-4000-8000-0000000000a1', 'X', 'bodega', 20, -103, 100);
    raise exception '0385: aceptó un tipo de sitio inexistente';
  exception when check_violation then null; end;
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, fuente) values ('38500000-0000-4000-8000-0000000000a1', 'Y', 'planta', 20, -103, 100, 'geocodificada');
    raise exception '0385: aceptó una fuente de coordenadas inventada';
  exception when check_violation then null; end;
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, codigo) values ('38500000-0000-4000-8000-0000000000a1', 'Z', 'planta', 20, -103, 100, ' sucio ');
    raise exception '0385: aceptó un código con espacios';
  exception when check_violation then null; end;
  -- Un sitio no cuelga del cliente ni del padre de OTRA flota.
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, cliente_id) values ('38500000-0000-4000-8000-0000000000a1', 'W', 'cliente', 20, -103, 100, '38500000-0000-4000-8000-0000000000e2');
    raise exception '0385: un sitio de A colgó de un cliente de B';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, padre_id) values ('38500000-0000-4000-8000-0000000000a1', 'V', 'anden', 20, -103, 100, '38500000-0000-4000-8000-0000000000f3');
    raise exception '0385: un andén de A colgó de una planta de B';
  exception when foreign_key_violation then null; end;
  -- Un viaje no apunta a un sitio ajeno.
  begin
    update public.viaje set origen_geocerca_id = '38500000-0000-4000-8000-0000000000f3' where id = '38500000-0000-4000-8000-0000000000d1';
    raise exception '0385: un viaje de A apuntó a un sitio de B';
  exception when foreign_key_violation then null; end;
end $$;
update public.viaje set origen_geocerca_id = '38500000-0000-4000-8000-0000000000f1', destino_geocerca_id = '38500000-0000-4000-8000-0000000000f2'
 where id = '38500000-0000-4000-8000-0000000000d1';

-- ── (a2) el importador del catálogo (todo o nada, idempotente) ──────────────
do $$
declare r jsonb;
  t uuid := '38500000-0000-4000-8000-0000000000a1';
begin
  r := public.importar_sitios_conductor(t, '[
    {"linea":2,"codigo":"CL-1","nombre":"CEDIS Monterrey","tipo":"cliente","lat":25.6866,"lng":-100.3161,"radio_m":400,"direccion":"Av. Industrial 5","cliente":"cliente a","padre":null},
    {"linea":3,"codigo":"CL-1-A1","nombre":"CEDIS Monterrey andén 1","tipo":"anden","lat":25.6867,"lng":-100.3162,"radio_m":60,"direccion":null,"cliente":null,"padre":"CL-1"}
  ]'::jsonb);
  if not (r->>'ok')::boolean or (r->>'creados')::int <> 2 then raise exception '0385: el import no creó dos sitios: %', r; end if;
  if (select padre_id from public.geocerca where tenant_id = t and codigo = 'CL-1-A1') <> (select id from public.geocerca where tenant_id = t and codigo = 'CL-1') then
    raise exception '0385: el import no resolvió el padre dentro del mismo archivo';
  end if;
  if (select cliente_id from public.geocerca where tenant_id = t and codigo = 'CL-1') <> '38500000-0000-4000-8000-0000000000e1' then
    raise exception '0385: el import no resolvió el cliente por nombre (sin distinguir mayúsculas)';
  end if;
  if (select fuente from public.geocerca where tenant_id = t and codigo = 'CL-1') <> 'csv' then raise exception '0385: el import no marcó fuente = csv'; end if;
  -- Re-importar lo mismo (con un radio corregido): actualiza, no duplica.
  r := public.importar_sitios_conductor(t, '[
    {"linea":2,"codigo":"CL-1","nombre":"CEDIS Monterrey","tipo":"cliente","lat":25.6866,"lng":-100.3161,"radio_m":450,"direccion":"Av. Industrial 5","cliente":"Cliente A","padre":null}
  ]'::jsonb);
  if (r->>'creados')::int <> 0 or (r->>'actualizados')::int <> 1 then raise exception '0385: re-importar no fue idempotente: %', r; end if;
  if (select radio_m from public.geocerca where tenant_id = t and codigo = 'CL-1') <> 450 then raise exception '0385: re-importar no actualizó el radio'; end if;
  -- Un error en CUALQUIER fila: no se escribe NADA.
  r := public.importar_sitios_conductor(t, '[
    {"linea":2,"codigo":"CL-2","nombre":"Sitio bueno","tipo":"planta","lat":20.1,"lng":-103.1,"radio_m":100,"direccion":null,"cliente":null,"padre":null},
    {"linea":3,"codigo":"CL-3","nombre":"Sitio malo","tipo":"planta","lat":20.2,"lng":-103.2,"radio_m":100,"direccion":null,"cliente":"Cliente que no existe","padre":"NO-HAY"}
  ]'::jsonb);
  if (r->>'ok')::boolean or jsonb_array_length(r->'errores') <> 2 then raise exception '0385: el import no reportó los dos errores: %', r; end if;
  if exists (select 1 from public.geocerca where tenant_id = t and codigo = 'CL-2') then raise exception '0385: el import escribió filas pese a tener errores'; end if;
  -- El cliente de OTRA flota no se resuelve (se busca solo en la propia).
  r := public.importar_sitios_conductor(t, '[{"linea":2,"codigo":"CL-4","nombre":"X4","tipo":"planta","lat":20.1,"lng":-103.1,"radio_m":100,"direccion":null,"cliente":"Cliente B","padre":null}]'::jsonb);
  if (r->>'ok')::boolean then raise exception '0385: el import resolvió un cliente de otra flota'; end if;
  -- Nombre ya usado por otro código.
  r := public.importar_sitios_conductor(t, '[{"linea":2,"codigo":"CL-9","nombre":"Planta Zapopan","tipo":"planta","lat":20.1,"lng":-103.1,"radio_m":100,"direccion":null,"cliente":null,"padre":null}]'::jsonb);
  if (r->>'ok')::boolean then raise exception '0385: el import pisó el nombre de otro sitio'; end if;
  -- Entrada inválida: la función lo dice (no devuelve ok).
  begin perform public.importar_sitios_conductor(t, '[]'::jsonb); raise exception '0385: aceptó un archivo vacío';
  exception when raise_exception then if sqlerrm like '0385:%' then raise; end if; end;
end $$;

-- ── la config nueva ─────────────────────────────────────────────────────────
do $$ begin
  begin
    insert into public.agente_conductor_config (tenant_id, tolerancia_ubicacion_m) values ('38500000-0000-4000-8000-0000000000a1', 9000);
    raise exception '0385: aceptó una tolerancia de 9 km';
  exception when check_violation then null; end;
  begin
    insert into public.agente_conductor_config (tenant_id, estadia_alerta_carga_min) values ('38500000-0000-4000-8000-0000000000a1', 5);
    raise exception '0385: aceptó una alerta de estadía de 5 minutos';
  exception when check_violation then null; end;
end $$;
insert into public.agente_conductor_config (tenant_id) values ('38500000-0000-4000-8000-0000000000a1');
do $$ begin
  if not (select validar_ubicacion and pedir_ubicacion and tolerancia_ubicacion_m = 150 and ventana_ubicacion_min = 30
                 and estadia_alerta_carga_min is null and not pedir_foto_evidencia
            from public.agente_conductor_config where tenant_id = '38500000-0000-4000-8000-0000000000a1') then
    raise exception '0385: los defaults de la config nueva no son los documentados';
  end if;
end $$;

-- ── (b) el veredicto de validación ──────────────────────────────────────────
-- La llegada a carga recibida (ciclo 1).
update public.viaje_hito set estado = 'recibido', fuente = 'texto', interpretacion = 'regla', mensaje_en = now() - interval '4 hours',
       recibido_en = now() - interval '4 hours', lat = 20.7201, lng = -103.3901
 where viaje_id = '38500000-0000-4000-8000-0000000000d1' and tipo = 'llegada_carga';

do $$
declare
  hito uuid := (select id from public.viaje_hito where viaje_id = '38500000-0000-4000-8000-0000000000d1' and tipo = 'llegada_carga');
  r text;
begin
  -- Sin posición: sin_dato (motivo obligatorio, distancia ausente).
  r := public.aplicar_validacion_hito('38500000-0000-4000-8000-0000000000a1', hito, 1::smallint, 'sin_dato', 'sin_ubicacion', null, null, 150, 300, '38500000-0000-4000-8000-0000000000f1', null);
  if r <> 'nuevo' then raise exception '0385: el primer veredicto no fue nuevo (%)', r; end if;
  if (select estado from public.viaje_hito where id = hito) <> 'recibido' then raise exception '0385: un sin_dato movió el estado del hito'; end if;
  -- Repetir lo mismo no hace nada.
  if public.aplicar_validacion_hito('38500000-0000-4000-8000-0000000000a1', hito, 1::smallint, 'sin_dato', 'sin_ubicacion', null, null, 150, 300, '38500000-0000-4000-8000-0000000000f1', null) <> 'igual' then
    raise exception '0385: repetir el veredicto no fue idempotente';
  end if;
  -- Sube a sin_coincidencia (posición lejana): mejora, pero NO valida.
  r := public.aplicar_validacion_hito('38500000-0000-4000-8000-0000000000a1', hito, 1::smallint, 'sin_coincidencia', null, 'gps', 5200, 150, 300, '38500000-0000-4000-8000-0000000000f1', now());
  if r <> 'mejorado' then raise exception '0385: sin_dato → sin_coincidencia no mejoró (%)', r; end if;
  if (select estado from public.viaje_hito where id = hito) <> 'recibido' then raise exception '0385: un sin_coincidencia validó el hito (acusaría al chofer de nada)'; end if;
  -- El pin llega y cae en el sitio: validado, y el hito pasa a validado por gps.
  r := public.aplicar_validacion_hito('38500000-0000-4000-8000-0000000000a1', hito, 1::smallint, 'validado', null, 'pin', 40, 150, 300, '38500000-0000-4000-8000-0000000000f1', now());
  if r <> 'mejorado' then raise exception '0385: sin_coincidencia → validado no mejoró (%)', r; end if;
  if (select estado || '/' || validado_por from public.viaje_hito where id = hito) <> 'validado/gps' then
    raise exception '0385: el veredicto validado no dejó el hito validado por gps';
  end if;
  -- Una posición posterior y lejana NO desdice la evidencia positiva.
  r := public.aplicar_validacion_hito('38500000-0000-4000-8000-0000000000a1', hito, 1::smallint, 'sin_coincidencia', null, 'gps', 9000, 150, 300, '38500000-0000-4000-8000-0000000000f1', now());
  if r <> 'igual' or (select resultado from public.viaje_hito_validacion where viaje_hito_id = hito and ciclo = 1) <> 'validado' then
    raise exception '0385: un veredicto lejano desdijo uno validado';
  end if;
  -- Un ciclo que ya no es el vigente (el hito se retiró y se volvió a registrar) no recibe veredicto.
  if public.aplicar_validacion_hito('38500000-0000-4000-8000-0000000000a1', hito, 7::smallint, 'validado', null, 'gps', 1, 150, 300, null, now()) <> 'hito_cambio' then
    raise exception '0385: escribió un veredicto sobre un ciclo ajeno';
  end if;
  -- Otra flota no puede escribir veredictos sobre un hito ajeno.
  if public.aplicar_validacion_hito('38500000-0000-4000-8000-0000000000b1', hito, 1::smallint, 'validado', null, 'gps', 1, 150, 300, null, now()) <> 'hito_cambio' then
    raise exception '0385: la flota B escribió un veredicto sobre un hito de A';
  end if;
  -- Un hito sin recibir no se valida.
  if public.aplicar_validacion_hito('38500000-0000-4000-8000-0000000000a1',
       (select id from public.viaje_hito where viaje_id = '38500000-0000-4000-8000-0000000000d1' and tipo = 'regreso'), 1::smallint,
       'validado', null, 'gps', 1, 150, 300, null, now()) <> 'hito_cambio' then
    raise exception '0385: validó un hito que nunca se recibió';
  end if;
  if (select count(*) from public.viaje_hito_evento where viaje_hito_id = hito and evento in ('validacion', 'validado')) < 3 then
    raise exception '0385: los veredictos no dejaron bitácora de eventos';
  end if;
  -- CHECKs directos.
  begin
    insert into public.viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, motivo, tolerancia_m)
    select tenant_id, viaje_id, id, 9, 'sin_dato', null, 150 from public.viaje_hito where id = hito;
    raise exception '0385: aceptó un sin_dato sin motivo';
  exception when check_violation then null; end;
  begin
    insert into public.viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, tolerancia_m)
    select tenant_id, viaje_id, id, 9, 'validado', 150 from public.viaje_hito where id = hito;
    raise exception '0385: aceptó un validado sin distancia medida';
  exception when check_violation then null; end;
  begin
    insert into public.viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, motivo, tolerancia_m)
    select tenant_id, viaje_id, id, 9, 'sin_dato', 'porque_si', 150 from public.viaje_hito where id = hito;
    raise exception '0385: aceptó un motivo fuera de dominio';
  exception when check_violation then null; end;
  begin
    insert into public.viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, motivo, tolerancia_m)
    select tenant_id, viaje_id, id, 1, 'sin_dato', 'sin_sitio', 150 from public.viaje_hito where id = hito;
    raise exception '0385: aceptó dos veredictos para el mismo (hito, ciclo)';
  exception when unique_violation then null; end;
end $$;

-- ── (c) la evidencia ────────────────────────────────────────────────────────
do $$
declare
  hito uuid := (select id from public.viaje_hito where viaje_id = '38500000-0000-4000-8000-0000000000d1' and tipo = 'llegada_carga');
begin
  insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256, wa_message_id)
  values ('38500000-0000-4000-8000-0000000000a1', '38500000-0000-4000-8000-0000000000d1', hito, 1, 'anden',
          '38500000-0000-4000-8000-0000000000a1/38500000-0000-4000-8000-0000000000d1/abc123abc123abc123.jpg', 'abc123abc123abc123', 'wamid.E1');
  begin
    insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256, wa_message_id)
    values ('38500000-0000-4000-8000-0000000000a1', '38500000-0000-4000-8000-0000000000d1', hito, 1, 'sello', 'x/y.jpg', 'def456def456def456', 'wamid.E1');
    raise exception '0385: el mismo mensaje de WhatsApp aportó dos evidencias';
  exception when unique_violation then null; end;
  begin
    insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256)
    values ('38500000-0000-4000-8000-0000000000a1', '38500000-0000-4000-8000-0000000000d1', hito, 1, 'otra', 'x/z.jpg', 'abc123abc123abc123');
    raise exception '0385: la misma foto se guardó dos veces para el mismo hito y ciclo';
  exception when unique_violation then null; end;
  begin
    insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256)
    values ('38500000-0000-4000-8000-0000000000a1', '38500000-0000-4000-8000-0000000000d1', hito, 1, 'selfie', 'x/z.jpg', 'fff456def456def456');
    raise exception '0385: aceptó un tipo de evidencia inexistente';
  exception when check_violation then null; end;
  begin
    insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256)
    values ('38500000-0000-4000-8000-0000000000a1', '38500000-0000-4000-8000-0000000000d1', hito, 1, 'otra', null, 'aaa456def456def456');
    raise exception '0385: aceptó una evidencia sin ruta y sin sello de purga';
  exception when check_violation then null; end;
  begin
    insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256)
    values ('38500000-0000-4000-8000-0000000000b1', '38500000-0000-4000-8000-0000000000d1', hito, 1, 'otra', 'x/q.jpg', 'bbb456def456def456');
    raise exception '0385: la flota B colgó evidencia de un hito de A';
  exception when foreign_key_violation then null; end;
end $$;

-- ── (d) las acciones de oficina ─────────────────────────────────────────────
do $$
declare
  c uuid := '38500000-0000-4000-8000-0000000000c2';
  t uuid := '38500000-0000-4000-8000-0000000000a1';
  v uuid := '38500000-0000-4000-8000-0000000000d1';
  sc uuid := (select id from public.viaje_hito where viaje_id = v and tipo = 'salida_carga');
  ld uuid := (select id from public.viaje_hito where viaje_id = v and tipo = 'llegada_descarga');
  r text;
begin
  -- Hora futura o anterior a la aceptación: se rechaza.
  if public.capturar_hito_oficina(t, sc, now() + interval '2 hours', c, 'encargado-0385@test.invalid', 'el chofer avisó por radio', now()) <> 'hora_invalida' then
    raise exception '0385: aceptó una hora futura';
  end if;
  if public.capturar_hito_oficina(t, sc, now() - interval '9 hours', c, 'encargado-0385@test.invalid', 'el chofer avisó por radio', now()) <> 'hora_invalida' then
    raise exception '0385: aceptó una hora anterior a la aceptación del viaje';
  end if;
  -- Motivo corto: la bitácora lo rechaza y NADA queda a medias (la transacción de la función revierte).
  begin
    perform public.capturar_hito_oficina(t, sc, now() - interval '3 hours', c, 'encargado-0385@test.invalid', 'ok', now());
    raise exception '0385: aceptó un motivo de 2 letras';
  exception when check_violation then null; end;
  if (select estado from public.viaje_hito where id = sc) <> 'esperado' then raise exception '0385: la captura rechazada dejó el hito modificado'; end if;
  -- Captura válida de la salida de carga: el chofer nunca avisó.
  r := public.capturar_hito_oficina(t, sc, now() - interval '3 hours', c, 'encargado-0385@test.invalid', 'el chofer avisó por radio', now());
  if r <> 'ok' then raise exception '0385: la captura válida falló (%)', r; end if;
  if (select estado || '/' || fuente from public.viaje_hito where id = sc) <> 'recibido/oficina' then raise exception '0385: la captura no quedó como recibido/oficina'; end if;
  if (select count(*) from public.conductor_accion_oficina where viaje_hito_id = sc and accion = 'captura_manual' and usuario_email = 'encargado-0385@test.invalid') <> 1 then
    raise exception '0385: la captura no dejó su renglón de bitácora con motivo y autor';
  end if;
  -- Capturar de nuevo el mismo hito: ya estaba recibido.
  if public.capturar_hito_oficina(t, sc, now() - interval '2 hours', c, 'encargado-0385@test.invalid', 'otra vez el mismo hito', now()) <> 'hito_cambio' then
    raise exception '0385: permitió recapturar un hito ya recibido';
  end if;
  -- Capturar un hito POSTERIOR omite los pendientes anteriores (igual que cuando el chofer avisa fuera de orden).
  r := public.capturar_hito_oficina(t, (select id from public.viaje_hito where viaje_id = v and tipo = 'salida_descarga'), now() - interval '1 hour', c, 'encargado-0385@test.invalid', 'confirmado por el cliente', now());
  if r <> 'ok' or (select estado from public.viaje_hito where id = ld) <> 'omitido' then
    raise exception '0385: capturar la salida de descarga no omitió la llegada a descarga pendiente';
  end if;
  -- Otra flota no puede capturar un hito ajeno.
  if public.capturar_hito_oficina('38500000-0000-4000-8000-0000000000b1', (select id from public.viaje_hito where viaje_id = v and tipo = 'regreso'), now() - interval '1 hour', null, 'x@test.invalid', 'intento desde otra flota', now()) <> 'hito_cambio' then
    raise exception '0385: la flota B capturó un hito de A';
  end if;
  -- La captura de la salida de descarga NO sella llegada_en (solo la llegada a descarga y el regreso lo hacen).
  if (select llegada_en from public.viaje where id = v) is not null then raise exception '0385: capturar la salida de descarga selló llegada_en'; end if;
  -- Capturar la LLEGADA a descarga (estaba omitida por la captura posterior) y el REGRESO completa los sellos de la 0090.
  r := public.capturar_hito_oficina(t, ld, now() - interval '90 minutes', c, 'encargado-0385@test.invalid', 'el cliente confirmó la hora', now());
  if r <> 'ok' then raise exception '0385: no se pudo capturar la llegada a descarga omitida (%)', r; end if;
  if (select llegada_en from public.viaje where id = v) is null then raise exception '0385: la captura de la llegada a descarga no selló llegada_en (0090)'; end if;
  r := public.capturar_hito_oficina(t, (select id from public.viaje_hito where viaje_id = v and tipo = 'regreso'), now() - interval '30 minutes', c, 'encargado-0385@test.invalid', 'va de regreso, confirmado por radio', now());
  if r <> 'ok' or (select regreso_en from public.viaje where id = v) is null then raise exception '0385: la captura del regreso no selló regreso_en (0090)'; end if;
  update public.viaje_hito set estado = 'esperado', fuente = null, interpretacion = null, mensaje_en = null, recibido_en = null where viaje_id = v and tipo = 'regreso';
  update public.viaje set regreso_en = null where id = v;
  -- Validar por oficina: recibido → validado; y no repetible.
  if public.validar_hito_oficina(t, sc, c, 'encargado-0385@test.invalid', 'confirmado con el cliente', now()) <> 'ok'
     or (select validado_por from public.viaje_hito where id = sc) <> 'oficina' then
    raise exception '0385: validar por oficina no dejó validado_por = oficina';
  end if;
  if public.validar_hito_oficina(t, sc, c, 'encargado-0385@test.invalid', 'confirmado con el cliente', now()) <> 'hito_cambio' then
    raise exception '0385: validó dos veces el mismo hito';
  end if;
  -- Atender una escalación: solo cuenta lo escalado y sin atender.
  update public.viaje_hito set estado = 'escalado', escalado_en = now() - interval '1 hour', escalacion_nivel = 1
   where viaje_id = v and tipo = 'regreso';
  if public.atender_escalacion_oficina(t, v, c, 'encargado-0385@test.invalid', 'ya hablé con el chofer', now()) <> 1 then
    raise exception '0385: no marcó atendida la escalación pendiente';
  end if;
  if public.atender_escalacion_oficina(t, v, c, 'encargado-0385@test.invalid', 'ya hablé con el chofer', now()) <> 0 then
    raise exception '0385: marcó atendida dos veces la misma escalación';
  end if;
  if public.atender_escalacion_oficina('38500000-0000-4000-8000-0000000000b1', v, null, 'x@test.invalid', 'intento desde otra flota', now()) <> 0 then
    raise exception '0385: la flota B atendió una escalación de A';
  end if;
  -- La bitácora de acciones es append-only (incluso para quien escribe por servidor).
  set local role service_role;
  begin
    update public.conductor_accion_oficina set motivo = 'reescrito despues';
    raise exception '0385: service_role EDITÓ la bitácora de acciones';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.conductor_accion_oficina;
    raise exception '0385: service_role BORRÓ la bitácora de acciones';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- ── (e) los indicadores ─────────────────────────────────────────────────────
-- Datos de respuesta: la llegada a carga se pidió (1 aviso) y se contestó a los 10 minutos sin insistir; la
-- salida a carga se capturó a mano.
update public.viaje_hito set solicitado_en = now() - interval '4 hours 10 minutes', recordatorios_enviados = 1
 where viaje_id = '38500000-0000-4000-8000-0000000000d1' and tipo = 'llegada_carga';
-- Un hito de B, para probar el aislamiento.
update public.viaje_hito set estado = 'recibido', fuente = 'texto', interpretacion = 'regla', mensaje_en = now(), recibido_en = now()
 where viaje_id = '38500000-0000-4000-8000-0000000000e3' and tipo = 'llegada_carga';
do $$
declare ind jsonb;
begin
  ind := public.conductor_indicadores('38500000-0000-4000-8000-0000000000a1', now() - interval '1 day', now() + interval '1 hour');
  -- Recibidos de A: llegada_carga (validado), salida_carga (validado oficina), llegada_descarga y salida_descarga (capturados) = 4.
  if (ind->>'recibidos')::int <> 4 then raise exception '0385: recibidos incorrecto (%): %', ind->>'recibidos', ind; end if;
  if (ind->>'sin_insistencia')::int <> 4 then raise exception '0385: sin_insistencia incorrecto: %', ind; end if;
  if (ind->>'con_respuesta_medida')::int <> 1 or (ind->>'minutos_respuesta_promedio')::numeric <> 10.0 then
    raise exception '0385: el tiempo de respuesta medido es incorrecto: %', ind;
  end if;
  if (ind->>'escalados')::int <> 1 or (ind->>'omitidos')::int <> 0 then raise exception '0385: escalados/omitidos incorrectos: %', ind; end if;
  if (ind->>'validados_ubicacion')::int <> 1 or (ind->>'capturados_oficina')::int <> 3 then raise exception '0385: validados/capturados incorrectos: %', ind; end if;
  -- Filtro por chofer: otro chofer de A (sin viajes) da cero, no los de otro.
  ind := public.conductor_indicadores('38500000-0000-4000-8000-0000000000a1', now() - interval '1 day', now() + interval '1 hour', null, null, '38500000-0000-4000-8000-0000000000b2');
  if (ind->>'recibidos')::int <> 0 then raise exception '0385: el filtro por chofer dejó pasar hitos ajenos: %', ind; end if;
  -- Filtro por cliente.
  ind := public.conductor_indicadores('38500000-0000-4000-8000-0000000000a1', now() - interval '1 day', now() + interval '1 hour', null, '38500000-0000-4000-8000-0000000000e1', null);
  if (ind->>'recibidos')::int <> 4 then raise exception '0385: el filtro por cliente no encontró los hitos de su viaje: %', ind; end if;
  -- Ventana vacía: ceros reales y promedio nulo (jamás un 0 que parezca medición).
  ind := public.conductor_indicadores('38500000-0000-4000-8000-0000000000a1', now() + interval '2 days', now() + interval '3 days');
  if (ind->>'recibidos')::int <> 0 or (ind->'minutos_respuesta_promedio') <> 'null'::jsonb then
    raise exception '0385: una ventana vacía no devolvió promedio nulo: %', ind;
  end if;
  -- Aislamiento: B solo ve lo suyo.
  ind := public.conductor_indicadores('38500000-0000-4000-8000-0000000000b1', now() - interval '1 day', now() + interval '1 hour');
  if (ind->>'recibidos')::int <> 1 then raise exception '0385: los indicadores de B no son solo los suyos: %', ind; end if;
end $$;

-- ── (f) retención y cancelación ARCO de la evidencia ────────────────────────
do $$
declare
  hito uuid := (select id from public.viaje_hito where viaje_id = '38500000-0000-4000-8000-0000000000d1' and tipo = 'llegada_carga');
  n int;
begin
  -- La guarda de plazo.
  begin perform public.purgar_conductor_evidencia(7, 10); raise exception '0385: aceptó 7 días de retención';
  exception when raise_exception then if sqlerrm like '0385:%' then raise; end if; end;
  -- Evidencia reciente: no se toca.
  if public.purgar_conductor_evidencia(365, 10) <> 0 then raise exception '0385: purgó evidencia reciente'; end if;
  -- Envejecida (la edad la mueve el dueño de la tabla).
  update public.viaje_hito_evidencia set created_at = now() - interval '400 days' where viaje_hito_id = hito;
  update public.viaje_hito set evidencia_ruta = 'x/y.jpg' where id = hito;
  n := public.purgar_conductor_evidencia(365, 10);
  if n <> 1 then raise exception '0385: la retención no purgó la evidencia vieja (%)', n; end if;
  if exists (select 1 from public.viaje_hito_evidencia where viaje_hito_id = hito and (ruta is not null or purgada_en is null)) then
    raise exception '0385: la retención no desligó la ruta';
  end if;
  if (select evidencia_ruta from public.viaje_hito where id = hito) is not null then raise exception '0385: la ruta legada del hito sobrevivió a la retención'; end if;
  if not exists (select 1 from public.storage_huerfano_candidato where bucket = 'comprobantes' and motivo = 'retencion_conductor' and nombre like '%abc123abc123abc123.jpg') then
    raise exception '0385: el archivo no quedó en la cola de borrado de Storage';
  end if;
  -- Idempotente.
  if public.purgar_conductor_evidencia(365, 10) <> 0 then raise exception '0385: la retención no es idempotente'; end if;

  -- ARCO: una evidencia nueva del chofer A y su cancelación.
  insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256)
  values ('38500000-0000-4000-8000-0000000000a1', '38500000-0000-4000-8000-0000000000d1', hito, 1, 'sello', 'a/b/c999c999c999c999.jpg', 'c999c999c999c999');
  -- Y una de B que no debe tocarse.
  insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256)
  select tenant_id, viaje_id, id, 1, 'sello', 'b/b/d999d999d999d999.jpg', 'd999d999d999d999' from public.viaje_hito
   where viaje_id = '38500000-0000-4000-8000-0000000000e3' and tipo = 'llegada_carga';
  update public.operador set anonimizado_en = now() where id = '38500000-0000-4000-8000-0000000000a2';
  if exists (select 1 from public.viaje_hito_evidencia where viaje_id = '38500000-0000-4000-8000-0000000000d1' and ruta is not null) then
    raise exception '0385: la cancelación ARCO dejó rutas de evidencia';
  end if;
  if not exists (select 1 from public.storage_huerfano_candidato where motivo = 'arco' and nombre = 'a/b/c999c999c999c999.jpg') then
    raise exception '0385: la cancelación ARCO no encoló el archivo para borrarlo';
  end if;
  if not exists (select 1 from public.viaje_hito_evidencia where viaje_id = '38500000-0000-4000-8000-0000000000e3' and ruta is not null) then
    raise exception '0385: la cancelación ARCO tocó la evidencia de otra flota';
  end if;
  -- El veredicto y el estado del hito (evidencia de estadías) sobreviven.
  if (select estado from public.viaje_hito where id = hito) <> 'validado' or not exists (select 1 from public.viaje_hito_validacion where viaje_hito_id = hito) then
    raise exception '0385: la cancelación ARCO tocó el estado o el veredicto';
  end if;
end $$;

-- ── (g) RLS ─────────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', '38500000-0000-4000-8000-0000000000c1', true);   -- dueño de A
do $$ begin
  if (select count(*) from public.viaje_hito_validacion) = 0 or (select count(*) from public.viaje_hito_evidencia) = 0
     or (select count(*) from public.conductor_accion_oficina) = 0 then
    raise exception '0385: el dueño no ve las tablas nuevas de su flota';
  end if;
  if exists (select 1 from public.viaje_hito_validacion where tenant_id <> '38500000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.viaje_hito_evidencia where tenant_id <> '38500000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.conductor_accion_oficina where tenant_id <> '38500000-0000-4000-8000-0000000000a1') then
    raise exception '0385: el dueño ve filas de otra flota';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '38500000-0000-4000-8000-0000000000c2', true);   -- encargado
do $$ begin
  if (select count(*) from public.viaje_hito_validacion) = 0 then raise exception '0385: el encargado no ve los veredictos de su flota'; end if;
end $$;
select set_config('request.jwt.claim.sub', '38500000-0000-4000-8000-0000000000c3', true);   -- contador: NO es operación
do $$ begin
  if (select count(*) from public.viaje_hito_validacion) <> 0 or (select count(*) from public.viaje_hito_evidencia) <> 0
     or (select count(*) from public.conductor_accion_oficina) <> 0 then
    raise exception '0385: el CONTADOR leyó evidencia, veredictos o acciones de oficina';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '38500000-0000-4000-8000-0000000000c1', true);
do $$
declare n int;
begin
  begin
    insert into public.viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, motivo, tolerancia_m)
    select tenant_id, viaje_id, id, 5, 'sin_dato', 'sin_sitio', 150 from public.viaje_hito limit 1;
    raise exception '0385: el dueño INSERTÓ un veredicto por REST';
  exception when insufficient_privilege then null; end;
  begin
    update public.viaje_hito_evidencia set tipo = 'otra';
    get diagnostics n = row_count;
    if n <> 0 then raise exception '0385: el dueño MODIFICÓ evidencia por REST'; end if;
  exception when insufficient_privilege then null; end;
  begin
    perform public.capturar_hito_oficina('38500000-0000-4000-8000-0000000000a1', gen_random_uuid(), now(), null, 'x@test.invalid', 'intento por rest', now());
    raise exception '0385: authenticated ejecutó capturar_hito_oficina';
  exception when insufficient_privilege then null; end;
  begin
    perform public.aplicar_validacion_hito('38500000-0000-4000-8000-0000000000a1', gen_random_uuid(), 1::smallint, 'sin_dato', 'sin_sitio', null, null, 150, null, null, null);
    raise exception '0385: authenticated ejecutó aplicar_validacion_hito';
  exception when insufficient_privilege then null; end;
  begin
    perform public.conductor_indicadores('38500000-0000-4000-8000-0000000000a1', now() - interval '1 day', now());
    raise exception '0385: authenticated ejecutó conductor_indicadores';
  exception when insufficient_privilege then null; end;
  begin
    perform public.importar_sitios_conductor('38500000-0000-4000-8000-0000000000a1', '[]'::jsonb);
    raise exception '0385: authenticated ejecutó el importador de sitios';
  exception when insufficient_privilege then null; end;
  begin
    perform public.purgar_conductor_evidencia(365, 10);
    raise exception '0385: authenticated ejecutó la purga de evidencia';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Borrar la flota arrastra todo lo suyo.
delete from public.tenant where id = '38500000-0000-4000-8000-0000000000b1';
do $$ begin
  if exists (select 1 from public.viaje_hito_evidencia where tenant_id = '38500000-0000-4000-8000-0000000000b1')
     or exists (select 1 from public.geocerca where tenant_id = '38500000-0000-4000-8000-0000000000b1') then
    raise exception '0385: borrar la flota dejó filas huérfanas';
  end if;
  if not exists (select 1 from public.viaje_hito_validacion where tenant_id = '38500000-0000-4000-8000-0000000000a1') then
    raise exception '0385: borrar la flota B se llevó los veredictos de A';
  end if;
end $$;

rollback;
\echo 0385_conductor_validacion_sitios: PASS
