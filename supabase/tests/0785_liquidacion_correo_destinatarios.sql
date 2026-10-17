\set ON_ERROR_STOP on
-- 0785 — Liquidación por correo: correo del operador, coordinador y configuración.
-- Contra Postgres real. Prueba lo que solo la base garantiza:
--   (a) el correo del operador solo cabe con forma de correo (y nulo);
--   (b) un coordinador de OTRA flota no se puede colgar de un operador (FK compuesta);
--       borrar el coordinador vacía solo `coordinador_id`;
--   (c) anonimizar al operador borra correo, rebote y coordinador;
--   (d) la configuración: una fila por flota, defaults conservadores (whatsapp, inactiva),
--       dominios y formas de los correos de RH;
--   (e) un operador existente sigue leyéndose con las columnas nuevas en NULL;
--   (f) RLS prendida: authenticated no puede escribir.
-- Datos sintéticos (dominio de ejemplo reservado, sin personas reales).
begin;

insert into public.tenant (id, nombre) values
  ('78500000-0000-4000-8000-0000000000a1', 'Flota A 0785'),
  ('78500000-0000-4000-8000-0000000000b1', 'Flota B 0785');

insert into public.operador (id, tenant_id, nombre, telefono) values
  ('78500000-0000-4000-8000-0000000000a2', '78500000-0000-4000-8000-0000000000a1', 'Operador Uno', '5215500000001'),
  ('78500000-0000-4000-8000-0000000000a3', '78500000-0000-4000-8000-0000000000a1', 'Operador Dos', '5215500000002');

set local role service_role;

do $$
declare
  v_falla boolean; n int; r record;
  A constant uuid := '78500000-0000-4000-8000-0000000000a1';
  B constant uuid := '78500000-0000-4000-8000-0000000000b1';
  OP1 constant uuid := '78500000-0000-4000-8000-0000000000a2';
  OP2 constant uuid := '78500000-0000-4000-8000-0000000000a3';
  COORD_A constant uuid := '78500000-0000-4000-8000-0000000000c1';
  COORD_B constant uuid := '78500000-0000-4000-8000-0000000000c2';
begin
  -- (e) un operador existente: columnas nuevas NULL y el select funciona.
  select correo, correo_rebotado_en, coordinador_id into r from public.operador where id = OP1;
  if r.correo is not null or r.correo_rebotado_en is not null or r.coordinador_id is not null then
    raise exception 'FALLO e1: un operador existente trae columnas nuevas no nulas';
  end if;

  -- (a) correo del operador
  update public.operador set correo = 'operador.uno@ejemplo.test' where id = OP1;
  foreach n in array array[1,2,3,4,5] loop
    v_falla := false;
    begin
      case n
        when 1 then update public.operador set correo = 'sin-arroba.ejemplo.test' where id = OP1;
        when 2 then update public.operador set correo = 'dos@@ejemplo.test' where id = OP1;
        when 3 then update public.operador set correo = 'con espacio@ejemplo.test' where id = OP1;
        when 4 then update public.operador set correo = 'a@b.c' where id = OP1;                       -- TLD de 1 letra
        when 5 then update public.operador set correo = repeat('a', 250) || '@ejemplo.test' where id = OP1; -- > 254
      end case;
    exception when check_violation then v_falla := true; end;
    if not v_falla then raise exception 'FALLO a%: un correo inválido se aceptó', n; end if;
  end loop;
  update public.operador set correo = null where id = OP1;   -- nulo sí

  -- coordinadores
  insert into public.liquidacion_coordinador (id, tenant_id, nombre, correo)
    values (COORD_A, A, 'Coordinador A', 'coordinador.a@ejemplo.test'),
           (COORD_B, B, 'Coordinador B', 'coordinador.b@ejemplo.test');
  v_falla := false;
  begin
    insert into public.liquidacion_coordinador (tenant_id, correo) values (A, 'no-es-correo');
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b1: un coordinador con correo inválido se aceptó'; end if;
  v_falla := false;
  begin
    insert into public.liquidacion_coordinador (tenant_id, correo) values (A, 'COORDINADOR.A@ejemplo.test');
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b2: el mismo correo (otra capitalización) se dio de alta dos veces en la flota'; end if;
  -- el mismo correo en OTRA flota sí es legal
  insert into public.liquidacion_coordinador (tenant_id, correo) values (B, 'coordinador.a@ejemplo.test');

  -- (b) FK compuesta
  update public.operador set coordinador_id = COORD_A where id = OP1;   -- misma flota: sí
  v_falla := false;
  begin
    update public.operador set coordinador_id = COORD_B where id = OP2;  -- coordinador de otra flota
  exception when foreign_key_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b3: un coordinador de otra flota se colgó de un operador'; end if;
  -- borrar el coordinador vacía solo coordinador_id; el operador sigue en su flota
  update public.operador set coordinador_id = COORD_A where id = OP2;
  delete from public.liquidacion_coordinador where id = COORD_A;
  select tenant_id, coordinador_id into r from public.operador where id = OP2;
  if r.coordinador_id is not null or r.tenant_id <> A then
    raise exception 'FALLO b4: borrar el coordinador dejó coordinador_id=% tenant_id=% (esperado null / A)', r.coordinador_id, r.tenant_id;
  end if;

  -- (c) anonimizar borra correo, rebote y coordinador
  insert into public.liquidacion_coordinador (id, tenant_id, correo) values (COORD_A, A, 'coordinador.a@ejemplo.test');
  update public.operador
     set correo = 'operador.uno@ejemplo.test', correo_rebotado_en = now(), coordinador_id = COORD_A
   where id = OP1;
  update public.operador set anonimizado_en = now() where id = OP1;
  select correo, correo_rebotado_en, coordinador_id into r from public.operador where id = OP1;
  if r.correo is not null or r.correo_rebotado_en is not null or r.coordinador_id is not null then
    raise exception 'FALLO c1: anonimizar dejó correo=% rebote=% coordinador=%', r.correo, r.correo_rebotado_en, r.coordinador_id;
  end if;
  -- un UPDATE ordinario NO toca el correo de un operador sin anonimizar
  update public.operador set correo = 'operador.dos@ejemplo.test' where id = OP2;
  update public.operador set nombre = 'Operador Dos (editado)' where id = OP2;
  select correo into r from public.operador where id = OP2;
  if r.correo is distinct from 'operador.dos@ejemplo.test' then
    raise exception 'FALLO c2: un UPDATE ordinario alteró el correo';
  end if;

  -- (d) configuración
  insert into public.liquidacion_correo_config (tenant_id) values (A);
  select * into r from public.liquidacion_correo_config where tenant_id = A;
  if r.canal <> 'whatsapp' or r.activa or r.neto_negativo <> 'retener' or r.etiqueta_viaje <> 'Pago de viaje'
     or r.agrupar_viaje or not r.envia_coordinador or not r.envia_rh or cardinality(r.rh_correos) <> 0 then
    raise exception 'FALLO d1: los defaults de la configuración no son los conservadores';
  end if;
  v_falla := false;
  begin
    insert into public.liquidacion_correo_config (tenant_id) values (A);
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d2: dos configuraciones para la misma flota'; end if;

  update public.liquidacion_correo_config
     set rh_correos = array['rh1@ejemplo.test','rh2@ejemplo.test','rh3@ejemplo.test'],
         archivo_correo = 'archivo@ejemplo.test', responder_a = 'responder@ejemplo.test',
         canal = 'ambos', enviar_desde_hora = 23
   where tenant_id = A;
  update public.liquidacion_correo_config set rh_correos = '{}', enviar_desde_hora = 0 where tenant_id = A;  -- vacía y 0 sí

  foreach n in array array[1,2,3,4,5,6,7,8] loop
    v_falla := false;
    begin
      case n
        when 1 then update public.liquidacion_correo_config set canal = 'sms' where tenant_id = A;
        when 2 then update public.liquidacion_correo_config set rh_correos = array['a@e.test','b@e.test','c@e.test','d@e.test'] where tenant_id = A;  -- 4
        when 3 then update public.liquidacion_correo_config set rh_correos = array['no-es-correo'] where tenant_id = A;
        when 4 then update public.liquidacion_correo_config set rh_correos = array['uno@e.test dos@e.test'] where tenant_id = A;                     -- dos en uno
        when 5 then update public.liquidacion_correo_config set neto_negativo = 'ignorar' where tenant_id = A;
        when 6 then update public.liquidacion_correo_config set enviar_desde_hora = 24 where tenant_id = A;
        when 7 then update public.liquidacion_correo_config set archivo_correo = 'x' where tenant_id = A;
        when 8 then update public.liquidacion_correo_config set renombres = '{"a":1}'::jsonb where tenant_id = A;                                   -- no es arreglo
      end case;
    exception when check_violation then v_falla := true; end;
    if not v_falla then raise exception 'FALLO d3.%: un valor fuera de dominio se aceptó', n; end if;
  end loop;
end $$;

-- (f) RLS: authenticated no escribe en ninguna de las dos tablas nuevas
set local role authenticated;
do $$
declare v_falla boolean;
begin
  v_falla := false;
  begin
    insert into public.liquidacion_correo_config (tenant_id) values ('78500000-0000-4000-8000-0000000000b1');
  exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO f1: authenticated pudo escribir la configuración'; end if;
  v_falla := false;
  begin
    insert into public.liquidacion_coordinador (tenant_id, correo)
      values ('78500000-0000-4000-8000-0000000000b1', 'otro@ejemplo.test');
  exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO f2: authenticated pudo escribir un coordinador'; end if;
end $$;

rollback;
\echo '0785: ok'
