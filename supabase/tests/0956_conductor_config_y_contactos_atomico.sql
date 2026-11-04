\set ON_ERROR_STOP on
-- 0956 (MX-007 / API04-02) — guardar_conductor_config_y_contactos: config + contactos en UNA transacción.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values
  ('95600000-0000-4000-8000-0000000000a1', 'Flota A 0956'),
  ('95600000-0000-4000-8000-0000000000b1', 'Flota B 0956');
insert into public.terminal (id, tenant_id, nombre) values
  ('95600000-0000-4000-8000-0000000000a5', '95600000-0000-4000-8000-0000000000a1', 'Patio A'),
  ('95600000-0000-4000-8000-0000000000b5', '95600000-0000-4000-8000-0000000000b1', 'Patio B');

do $$
declare
  a constant uuid := '95600000-0000-4000-8000-0000000000a1';
  ta constant uuid := '95600000-0000-4000-8000-0000000000a5';
  tb constant uuid := '95600000-0000-4000-8000-0000000000b5';
  n int; v int; r record; err text;
begin
  -- 1. Alta: crea la fila de config y los contactos en un solo paso.
  perform public.guardar_conductor_config_y_contactos(
    a, '{"escalar_tras_min": 100, "segundo_nivel_min": 40}'::jsonb,
    '[{"terminalId": null, "nivel": 2, "nombre": "Jefe", "telefono": "5215500000001"},
      {"terminalId": "95600000-0000-4000-8000-0000000000a5", "nivel": 1, "nombre": "Patio", "telefono": "5215500000002"}]'::jsonb);
  select escalar_tras_min into v from public.agente_conductor_config where tenant_id = a;
  if v is distinct from 100 then raise exception '0956(1): la config no se guardó (%)', v; end if;
  select count(*) into n from public.conductor_contacto_trafico where tenant_id = a and activo;
  if n <> 2 then raise exception '0956(1): se esperaban 2 contactos y hay %', n; end if;

  -- 2. Reemplazo: el que ya no viene se borra, el que se conserva cambia de nombre, uno nuevo entra; la config se actualiza.
  perform public.guardar_conductor_config_y_contactos(
    a, '{"escalar_tras_min": 120}'::jsonb,
    '[{"terminalId": null, "nivel": 2, "nombre": "Jefe Renombrado", "telefono": "5215500000001"},
      {"terminalId": null, "nivel": 2, "nombre": "Otro jefe", "telefono": "5215500000003"}]'::jsonb);
  select count(*) into n from public.conductor_contacto_trafico where tenant_id = a;
  if n <> 2 then raise exception '0956(2): se esperaban 2 contactos y hay %', n; end if;
  select count(*) into n from public.conductor_contacto_trafico where tenant_id = a and telefono = '5215500000002';
  if n <> 0 then raise exception '0956(2): el contacto retirado sigue'; end if;
  select count(*) into n from public.conductor_contacto_trafico where tenant_id = a and nombre = 'Jefe Renombrado';
  if n <> 1 then raise exception '0956(2): el contacto conservado no cambió de nombre'; end if;
  select escalar_tras_min into v from public.agente_conductor_config where tenant_id = a;
  if v is distinct from 120 then raise exception '0956(2): la config no se actualizó (%)', v; end if;

  -- 3. Atomicidad: una terminal de OTRA flota revierte TAMBIÉN la config (antes quedaba la config nueva con contactos viejos).
  begin
    perform public.guardar_conductor_config_y_contactos(
      a, '{"escalar_tras_min": 300}'::jsonb,
      format('[{"terminalId": "%s", "nivel": 1, "nombre": "Ajeno", "telefono": "5215500000009"}]', tb)::jsonb);
    raise exception '0956(3): aceptó una terminal de otra flota';
  exception when foreign_key_violation then null;
  end;
  select escalar_tras_min into v from public.agente_conductor_config where tenant_id = a;
  if v is distinct from 120 then raise exception '0956(3): la config se guardó a medias pese al fallo (%)', v; end if;
  select count(*) into n from public.conductor_contacto_trafico where tenant_id = a;
  if n <> 2 then raise exception '0956(3): los contactos cambiaron pese al fallo (%)', n; end if;

  -- 4. Sin contactos (NULL) no se tocan los existentes.
  perform public.guardar_conductor_config_y_contactos(a, '{"escalar_tras_min": 130}'::jsonb, null);
  select count(*) into n from public.conductor_contacto_trafico where tenant_id = a;
  if n <> 2 then raise exception '0956(4): NULL tocó los contactos (%)', n; end if;

  -- 5. Una columna inexistente (migración que falta) lanza 42703 nombrando la columna: el llamador retira ese grupo.
  begin
    perform public.guardar_conductor_config_y_contactos(a, '{"columna_que_no_existe": 1}'::jsonb, null);
    raise exception '0956(5): aceptó una columna inexistente';
  exception when undefined_column then
    get stacked diagnostics err = message_text;
    if err not like '%columna_que_no_existe%' then raise exception '0956(5): el error no nombra la columna (%)', err; end if;
  end;

  -- 6. El tenant sale del parámetro: un tenant_id en el JSON no escribe en otra flota.
  perform public.guardar_conductor_config_y_contactos(a, '{"tenant_id": "95600000-0000-4000-8000-0000000000b1", "escalar_tras_min": 140}'::jsonb, null);
  select count(*) into n from public.agente_conductor_config where tenant_id = '95600000-0000-4000-8000-0000000000b1';
  if n <> 0 then raise exception '0956(6): el tenant_id del JSON escribió en otra flota'; end if;
  select escalar_tras_min into v from public.agente_conductor_config where tenant_id = a;
  if v is distinct from 140 then raise exception '0956(6): no escribió en la flota del parámetro (%)', v; end if;

  -- 7. Parámetros inválidos.
  begin
    perform public.guardar_conductor_config_y_contactos(a, '[]'::jsonb, null);
    raise exception '0956(7): aceptó una config que no es objeto';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- 8. Solo service_role la ejecuta: ni anon ni authenticated.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.guardar_conductor_config_y_contactos(uuid, jsonb, jsonb)', 'execute') then
      raise exception '0956(8): % puede ejecutar la función', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.guardar_conductor_config_y_contactos(uuid, jsonb, jsonb)', 'execute') then
    raise exception '0956(8): service_role no puede ejecutarla';
  end if;
end $$;

rollback;
