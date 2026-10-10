\set ON_ERROR_STOP on
-- 0635 / 0636 / 0637 — P2 del Conductor: cruces de geocerca, episodios de «sin señal de vida» y sitio derivado.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values ('63500000-0000-4000-8000-0000000000a1', 'Flota A 0635');
insert into public.tenant (id, nombre) values ('63500000-0000-4000-8000-0000000000b1', 'Flota B 0635');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('63500000-0000-4000-8000-0000000000a2', '63500000-0000-4000-8000-0000000000a1', 'Chofer A', '525500006351'),
  ('63500000-0000-4000-8000-0000000000a3', '63500000-0000-4000-8000-0000000000a1', 'Chofer B', '525500006352');
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en) values
  ('63500000-0000-4000-8000-0000000000d1', '63500000-0000-4000-8000-0000000000a1', '63500000-0000-4000-8000-0000000000a2', 'A-0635', 'abierto', now() - interval '5 hours', now() - interval '5 hours'),
  ('63500000-0000-4000-8000-0000000000d2', '63500000-0000-4000-8000-0000000000a1', '63500000-0000-4000-8000-0000000000a3', 'A-0635B', 'abierto', now() - interval '5 hours', now() - interval '5 hours');
insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, catalogo) values
  ('63500000-0000-4000-8000-0000000000e1', '63500000-0000-4000-8000-0000000000a1', 'Planta 0635', 'planta', 20.5, -103.3, 300, 'conductor');

do $$
declare
  ta constant uuid := '63500000-0000-4000-8000-0000000000a1';
  tb constant uuid := '63500000-0000-4000-8000-0000000000b1';
  v1 constant uuid := '63500000-0000-4000-8000-0000000000d1';
  v2 constant uuid := '63500000-0000-4000-8000-0000000000d2';
  g constant uuid := '63500000-0000-4000-8000-0000000000e1';
  e1 uuid; n integer; c record;
begin
  -- ── 0635: perillas y cruces ───────────────────────────────────────────────
  insert into public.agente_conductor_config (tenant_id) values (ta);
  select detectar_hitos_gps d, avisar_senal_vida s into c from public.agente_conductor_config where tenant_id = ta;
  if c.d is not true then raise exception '0635: la detección por GPS debía nacer encendida'; end if;
  if c.s is not false then raise exception '0635: la señal de vida debía nacer apagada'; end if;

  insert into public.viaje_cruce_geocerca (tenant_id, viaje_id, geocerca_id, hito_tipo, tipo, detectado_en, distancia_m)
    values (ta, v1, g, 'llegada_carga', 'entrada', now(), 40);
  begin
    insert into public.viaje_cruce_geocerca (tenant_id, viaje_id, geocerca_id, hito_tipo, tipo, detectado_en) values (ta, v1, g, 'llegada_carga', 'entrada', now());
    raise exception '0635: dos cruces del mismo hito';
  exception when unique_violation then null; end;
  begin
    insert into public.viaje_cruce_geocerca (tenant_id, viaje_id, hito_tipo, tipo, detectado_en) values (ta, v1, 'regreso', 'salida', now());
    raise exception '0635: aceptó un cruce de regreso';
  exception when check_violation then null; end;
  begin
    insert into public.viaje_cruce_geocerca (tenant_id, viaje_id, hito_tipo, tipo, detectado_en) values (ta, v1, 'salida_carga', 'entrada', now());
    raise exception '0635: aceptó una salida marcada como entrada';
  exception when check_violation then null; end;
  begin
    -- el viaje es de la flota A: un cruce de la flota B sobre él lo rechaza la FK compuesta
    insert into public.viaje_cruce_geocerca (tenant_id, viaje_id, hito_tipo, tipo, detectado_en) values (tb, v1, 'salida_carga', 'salida', now());
    raise exception '0635: aceptó un cruce de otra flota';
  exception when foreign_key_violation then null; end;
  -- el claim retomable: solo se retoma lo que quedó sin completar
  update public.viaje_cruce_geocerca set completado_en = null, registrado_en = now() - interval '1 hour' where viaje_id = v1 and hito_tipo = 'llegada_carga';
  update public.viaje_cruce_geocerca set registrado_en = now() where viaje_id = v1 and hito_tipo = 'llegada_carga' and completado_en is null and registrado_en < now() - interval '10 minutes';
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0635: no se pudo retomar un claim vencido sin completar'; end if;
  update public.viaje_cruce_geocerca set registrado_en = now() where viaje_id = v1 and hito_tipo = 'llegada_carga' and completado_en is null and registrado_en < now() - interval '10 minutes';
  get diagnostics n = row_count;
  if n <> 0 then raise exception '0635: dos corridas retomaron el mismo claim'; end if;
  delete from public.geocerca where id = g;
  if exists (select 1 from public.viaje_cruce_geocerca where viaje_id = v1 and geocerca_id is not null) then raise exception '0635: al borrar el sitio el cruce debía conservarse sin sitio'; end if;

  -- ── 0636: episodios ───────────────────────────────────────────────────────
  insert into public.viaje_senal_vida (tenant_id, viaje_id, motivo) values (ta, v1, 'gps_obsoleto') returning id into e1;
  begin
    insert into public.viaje_senal_vida (tenant_id, viaje_id, motivo) values (ta, v1, 'gps_detenido');
    raise exception '0636: dos episodios abiertos del mismo viaje';
  exception when unique_violation then null; end;
  insert into public.viaje_senal_vida (tenant_id, viaje_id, motivo) values (ta, v2, 'gps_detenido');  -- otro viaje no estorba

  update public.viaje_senal_vida set nivel_enviado = 1, aviso_1_en = now() where id = e1 and nivel_enviado = 0 and cerrado_en is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0636: el primer claim del nivel 1 debía ganar'; end if;
  update public.viaje_senal_vida set nivel_enviado = 1, aviso_1_en = now() where id = e1 and nivel_enviado = 0 and cerrado_en is null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception '0636: el nivel 1 se reclamó dos veces'; end if;
  update public.viaje_senal_vida set nivel_enviado = 3, escalado_en = now() where id = e1 and nivel_enviado = 2 and cerrado_en is null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception '0636: se saltó el segundo aviso'; end if;
  update public.viaje_senal_vida set nivel_enviado = 2, aviso_2_en = now() where id = e1 and nivel_enviado = 1 and cerrado_en is null;
  update public.viaje_senal_vida set nivel_enviado = 3, escalado_en = now() where id = e1 and nivel_enviado = 2 and cerrado_en is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0636: la escalación al jefe debía ganar tras el segundo aviso'; end if;

  begin update public.viaje_senal_vida set respuesta = 'inventada' where id = e1; raise exception '0636: aceptó una respuesta inventada'; exception when check_violation then null; end;
  begin update public.viaje_senal_vida set nivel_enviado = 4 where id = e1; raise exception '0636: aceptó un nivel 4'; exception when check_violation then null; end;
  begin update public.viaje_senal_vida set cerrado_en = now() where id = e1; raise exception '0636: cerró sin motivo'; exception when check_violation then null; end;
  update public.viaje_senal_vida set cerrado_en = now(), cierre_motivo = 'respondio', respondido_en = now(), respuesta = 'voy_a_cargar', silenciado_hasta = now() + interval '1 hour' where id = e1;
  insert into public.viaje_senal_vida (tenant_id, viaje_id, motivo) values (ta, v1, 'gps_detenido');  -- cerrado el anterior, otro puede abrirse

  -- ── 0637: sitio derivado ──────────────────────────────────────────────────
  insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, catalogo)
    values ('63500000-0000-4000-8000-0000000000e2', ta, 'Planta 0637', 'planta', 20.6, -103.2, 300, 'conductor');
  insert into public.viaje_sitio_derivado (tenant_id, viaje_id, lado, geocerca_id, criterio) values (ta, v1, 'origen', '63500000-0000-4000-8000-0000000000e2', 'nombre_exacto');
  begin
    insert into public.viaje_sitio_derivado (tenant_id, viaje_id, lado, criterio) values (ta, v1, 'origen', 'codigo');
    raise exception '0637: derivó dos veces el mismo lado';
  exception when unique_violation then null; end;
  insert into public.viaje_sitio_derivado (tenant_id, viaje_id, lado, geocerca_id, criterio) values (ta, v1, 'destino', '63500000-0000-4000-8000-0000000000e2', 'nombre_contenido');
  begin insert into public.viaje_sitio_derivado (tenant_id, viaje_id, lado, criterio) values (ta, v2, 'ambos', 'codigo'); raise exception '0637: lado inventado'; exception when check_violation then null; end;
  begin insert into public.viaje_sitio_derivado (tenant_id, viaje_id, lado, criterio) values (ta, v2, 'origen', 'adivinado'); raise exception '0637: criterio inventado'; exception when check_violation then null; end;

  -- las tres tablas nacen con RLS y sin permisos para anon
  if exists (select 1 from pg_class pc where pc.oid in ('public.viaje_cruce_geocerca'::regclass, 'public.viaje_senal_vida'::regclass, 'public.viaje_sitio_derivado'::regclass) and not pc.relrowsecurity) then
    raise exception '0635-0637: una tabla nueva sin RLS';
  end if;
  if has_table_privilege('anon', 'public.viaje_cruce_geocerca', 'select') or has_table_privilege('anon', 'public.viaje_senal_vida', 'select') or has_table_privilege('anon', 'public.viaje_sitio_derivado', 'select') then
    raise exception '0635-0637: anon puede leer una tabla nueva';
  end if;
end $$;

rollback;
