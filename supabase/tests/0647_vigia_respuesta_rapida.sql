\set ON_ERROR_STOP on
-- 0647 — Respuestas rápidas aprobadas del Vigía, contra Postgres REAL.
-- Lo que solo la base puede demostrar: una pregunta (sin importar mayúsculas ni espacios) tiene UNA respuesta aprobada por
-- flota y aprobar de nuevo la CORRIGE sin duplicar; retirada, la pregunta puede volver a aprobarse; el tope de 200 por flota
-- no frena una corrección; el uso se cuenta solo en una respuesta aprobada de ESA flota; los dominios (tema, estado, largo)
-- y el acceso (el rol authenticated solo lee).
begin;

insert into public.tenant (id, nombre) values ('64700000-0000-4000-8000-0000000000a1', 'Flota A 0647'), ('64700000-0000-4000-8000-0000000000b1', 'Flota B 0647');

do $$
declare
  ta constant uuid := '64700000-0000-4000-8000-0000000000a1';
  tb constant uuid := '64700000-0000-4000-8000-0000000000b1';
  r1 uuid; r2 uuid; r3 uuid; n int; t text; u int;
begin
  r1 := public.vigia_respuesta_rapida_aprobar(ta, 'cita_anden', '¿A qué hora puedo agendar mi cita de descarga?', 'Las citas se agendan de 8 a 18 h.', null);
  r2 := public.vigia_respuesta_rapida_aprobar(ta, 'cita_anden', '  ¿A QUÉ HORA puedo agendar mi cita de descarga?  ', 'Las citas se agendan de 7 a 17 h.', null);
  if r1 <> r2 then raise exception '0647: aprobar de nuevo la misma pregunta creó otra fila'; end if;
  select count(*), max(texto) into n, t from public.vigia_respuesta_rapida where tenant_id = ta and estado = 'aprobada';
  if n <> 1 or t <> 'Las citas se agendan de 7 a 17 h.' then raise exception '0647: la corrección no reemplazó el texto (n=%, t=%)', n, t; end if;

  -- Otra flota puede aprobar la misma pregunta con otro texto.
  r3 := public.vigia_respuesta_rapida_aprobar(tb, 'cita_anden', '¿A qué hora puedo agendar mi cita de descarga?', 'Llama al andén.', null);
  if r3 = r1 then raise exception '0647: dos flotas compartieron una fila'; end if;

  -- Retirada, la misma pregunta se puede volver a aprobar como fila nueva.
  update public.vigia_respuesta_rapida set estado = 'retirada' where id = r1;
  r2 := public.vigia_respuesta_rapida_aprobar(ta, 'cita_anden', '¿A qué hora puedo agendar mi cita de descarga?', 'Texto nuevo.', null);
  if r2 = r1 then raise exception '0647: reaprobar reutilizó la fila retirada'; end if;

  -- El uso se cuenta una vez por llamada, solo en aprobadas de ESA flota.
  if not public.vigia_respuesta_rapida_usar(ta, r2) or not public.vigia_respuesta_rapida_usar(ta, r2) then raise exception '0647: el uso no se contó'; end if;
  select usos into u from public.vigia_respuesta_rapida where id = r2;
  if u <> 2 then raise exception '0647: usos = % (esperado 2)', u; end if;
  if public.vigia_respuesta_rapida_usar(tb, r2) then raise exception '0647: una flota contó el uso de una respuesta ajena'; end if;
  if public.vigia_respuesta_rapida_usar(ta, r1) then raise exception '0647: se contó el uso de una respuesta retirada'; end if;

  -- Dominios.
  begin perform public.vigia_respuesta_rapida_aprobar(ta, 'queja', 'una pregunta cualquiera', 'x', null); raise exception '0647: admitió el tema queja';
  exception when check_violation then null; end;
  begin perform public.vigia_respuesta_rapida_aprobar(ta, 'tarifa', 'ab', 'x', null); raise exception '0647: admitió una pregunta de 2 letras';
  exception when check_violation then null; end;
  begin perform public.vigia_respuesta_rapida_aprobar(ta, 'tarifa', 'cuánto cuesta el flete', repeat('x', 701), null); raise exception '0647: admitió un texto de 701 letras';
  exception when check_violation then null; end;
  begin perform public.vigia_respuesta_rapida_aprobar('64700000-0000-4000-8000-0000000000ff', 'tarifa', 'cuánto cuesta el flete', 'x', null); raise exception '0647: admitió una flota inexistente';
  exception when sqlstate '22023' then null; end;
end $$;

-- El tope de 200: la 201 nueva rebota, pero corregir una existente no.
do $$
declare ta constant uuid := '64700000-0000-4000-8000-0000000000a1'; i int; n int; ok boolean := false;
begin
  delete from public.vigia_respuesta_rapida where tenant_id = ta;
  for i in 1..200 loop
    perform public.vigia_respuesta_rapida_aprobar(ta, 'otro', 'pregunta numero ' || i, 'respuesta ' || i, null);
  end loop;
  begin perform public.vigia_respuesta_rapida_aprobar(ta, 'otro', 'pregunta numero 201', 'respuesta', null);
  exception when sqlstate '54000' then ok := true; end;
  if not ok then raise exception '0647: el tope de 200 no rebotó la 201'; end if;
  perform public.vigia_respuesta_rapida_aprobar(ta, 'otro', 'PREGUNTA numero 7', 'corregida', null);
  select count(*) into n from public.vigia_respuesta_rapida where tenant_id = ta and estado = 'aprobada';
  if n <> 200 then raise exception '0647: la corrección cambió el conteo a %', n; end if;
end $$;

-- Acceso: el rol authenticated solo lee; las funciones son del servicio.
do $$
begin
  if has_table_privilege('authenticated', 'public.vigia_respuesta_rapida', 'insert') or has_table_privilege('authenticated', 'public.vigia_respuesta_rapida', 'update')
     or has_table_privilege('authenticated', 'public.vigia_respuesta_rapida', 'delete') then
    raise exception '0647: authenticated puede escribir en la tabla';
  end if;
  if has_function_privilege('authenticated', 'public.vigia_respuesta_rapida_aprobar(uuid, text, text, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.vigia_respuesta_rapida_usar(uuid, uuid)', 'execute') then
    raise exception '0647: authenticated puede ejecutar las funciones';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.vigia_respuesta_rapida'::regclass) then raise exception '0647: sin RLS'; end if;
end $$;

rollback;
