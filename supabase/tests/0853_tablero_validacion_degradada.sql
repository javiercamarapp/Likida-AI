\set ON_ERROR_STOP on
-- 0853 — `conductor_indicadores` expone cuánta validación de ubicación corre
-- en modo DEGRADADO (sin GPS real: 'sin_dato' o 'validado' solo con el pin
-- del chofer) frente al total de llegadas VALIDABLES del periodo.
--
-- HALLAZGO ALTO: nada en el repo exponía esto antes de la 0853 (confirmado:
-- ausencia de 'aproximada'/'sin_dato' en tablero.ts). Lo que SOLO la base
-- puede demostrar, contra Postgres real:
--   (a) una llegada validada con GPS real NO cuenta como degradada;
--   (b) una llegada 'validado' pero SOLO con el pin del chofer (fuente=pin)
--       SÍ cuenta como degradada;
--   (c) una llegada 'sin_dato' (sin geocerca o sin ubicación) SÍ cuenta;
--   (d) una llegada recibida que AÚN no tiene veredicto (barrido pendiente)
--       cuenta en el DENOMINADOR (validable) pero NO en el numerador;
--   (e) una SALIDA (nunca se valida por diseño) no cuenta ni en el
--       denominador ni en el numerador, aunque esté 'recibido';
--   (f) las cifras YA existentes (0385) no se mueven: esta migración solo
--       AGREGA dos claves, no cambia las anteriores.
begin;

insert into public.tenant (id, nombre) values
  ('08530000-0000-4000-8000-0000000000a1', 'Flota A 0853');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('08530000-0000-4000-8000-0000000000a2', '08530000-0000-4000-8000-0000000000a1', 'Chofer A1 0853', '525500008531'),
  ('08530000-0000-4000-8000-0000000000a3', '08530000-0000-4000-8000-0000000000a1', 'Chofer A2 0853', '525500008532'),
  ('08530000-0000-4000-8000-0000000000a4', '08530000-0000-4000-8000-0000000000a1', 'Chofer A3 0853', '525500008533');
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en) values
  ('08530000-0000-4000-8000-0000000000d1', '08530000-0000-4000-8000-0000000000a1', '08530000-0000-4000-8000-0000000000a2', 'A-0853-1', 'abierto', now() - interval '5 hours', now() - interval '5 hours'),
  ('08530000-0000-4000-8000-0000000000d2', '08530000-0000-4000-8000-0000000000a1', '08530000-0000-4000-8000-0000000000a3', 'A-0853-2', 'abierto', now() - interval '5 hours', now() - interval '5 hours'),
  ('08530000-0000-4000-8000-0000000000d3', '08530000-0000-4000-8000-0000000000a1', '08530000-0000-4000-8000-0000000000a4', 'A-0853-3', 'abierto', now() - interval '5 hours', now() - interval '5 hours');
select public.sembrar_hitos_conductor(10);

do $$
declare
  t uuid := '08530000-0000-4000-8000-0000000000a1';
  d1 uuid := '08530000-0000-4000-8000-0000000000d1';
  d2 uuid := '08530000-0000-4000-8000-0000000000d2';
  d3 uuid := '08530000-0000-4000-8000-0000000000d3';
  h_d1_llegada_carga uuid := (select id from public.viaje_hito where viaje_id = d1 and tipo = 'llegada_carga');
  h_d1_llegada_descarga uuid := (select id from public.viaje_hito where viaje_id = d1 and tipo = 'llegada_descarga');
  h_d1_salida_carga uuid := (select id from public.viaje_hito where viaje_id = d1 and tipo = 'salida_carga');
  h_d2_llegada_carga uuid := (select id from public.viaje_hito where viaje_id = d2 and tipo = 'llegada_carga');
  h_d3_llegada_carga uuid := (select id from public.viaje_hito where viaje_id = d3 and tipo = 'llegada_carga');
  ind jsonb;
begin
  -- (a) d1·llegada_carga: validada con GPS real.
  update public.viaje_hito set estado = 'validado', fuente = 'texto', interpretacion = 'regla', mensaje_en = now(), recibido_en = now(),
    validado_en = now(), validado_por = 'gps', updated_at = now()
   where id = h_d1_llegada_carga;
  insert into public.viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, fuente, distancia_m, tolerancia_m, radio_m)
  values (t, d1, h_d1_llegada_carga, 1, 'validado', 'gps', 20, 150, 300);

  -- (b) d1·llegada_descarga: 'validado' pero SOLO con el pin del chofer (sin GPS real) — DEGRADADA.
  update public.viaje_hito set estado = 'validado', fuente = 'texto', interpretacion = 'regla', mensaje_en = now(), recibido_en = now(),
    validado_en = now(), validado_por = 'gps', updated_at = now()
   where id = h_d1_llegada_descarga;
  insert into public.viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, fuente, distancia_m, tolerancia_m, radio_m)
  values (t, d1, h_d1_llegada_descarga, 1, 'validado', 'pin', 40, 150, 300);

  -- (e) d1·salida_carga: recibida pero las salidas NUNCA se validan por diseño — no debe contar ni en el
  -- denominador ni en el numerador aunque esté 'recibido'.
  update public.viaje_hito set estado = 'recibido', fuente = 'texto', interpretacion = 'regla', mensaje_en = now(), recibido_en = now(), updated_at = now()
   where id = h_d1_salida_carga;

  -- (c) d2·llegada_carga: 'sin_dato' (sin geocerca o sin ubicación con qué comparar) — DEGRADADA.
  update public.viaje_hito set estado = 'recibido', fuente = 'texto', interpretacion = 'regla', mensaje_en = now(), recibido_en = now(), updated_at = now()
   where id = h_d2_llegada_carga;
  insert into public.viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, motivo, tolerancia_m)
  values (t, d2, h_d2_llegada_carga, 1, 'sin_dato', 'sin_sitio', 150);

  -- (d) d3·llegada_carga: recibida, pero el barrido todavía no le puso veredicto — cuenta en el denominador
  -- (es validable) pero NO en el numerador (no se sabe todavía si es degradada).
  update public.viaje_hito set estado = 'recibido', fuente = 'texto', interpretacion = 'regla', mensaje_en = now(), recibido_en = now(), updated_at = now()
   where id = h_d3_llegada_carga;

  ind := public.conductor_indicadores(t, now() - interval '1 day', now() + interval '1 hour');

  if (ind->>'llegadas_validables')::int <> 4 then
    raise exception '0853: llegadas_validables incorrecto (esperaba 4, d1·llegada_carga + d1·llegada_descarga + d2·llegada_carga + d3·llegada_carga): %', ind;
  end if;
  if (ind->>'validacion_degradada')::int <> 2 then
    raise exception '0853: validacion_degradada incorrecto (esperaba 2, d1·llegada_descarga[pin] + d2·llegada_carga[sin_dato]): %', ind;
  end if;

  -- (f) las cifras ya existentes de la 0385 no se movieron por esta migración.
  if (ind->>'validados_ubicacion')::int <> 2 then
    raise exception '0853: validados_ubicacion (0385, sin tocar) cambió de comportamiento: %', ind;
  end if;
  if (ind->>'recibidos')::int <> 5 then
    raise exception '0853: recibidos (0385, sin tocar) cambió de comportamiento: %', ind;
  end if;
end $$;

rollback;
