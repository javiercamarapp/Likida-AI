\set ON_ERROR_STOP on
-- 1008 — Back-office, lote A: bo_entidad, bo_cierre_mes (checks, bloqueo del mes cerrado, reapertura con motivo), bo_update_inversionistas y grants.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

do $$
declare
  n int;
  ok boolean;
  err text;
  sin_privilegio boolean;
begin
  -- 1. bo_entidad: una sola fila (id = 1), RFC con forma y largo válidos, CP de 5 dígitos.
  insert into public.bo_entidad (id) values (1);
  begin insert into public.bo_entidad (id) values (2); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(1): id = 2 debia fallar'; end if; end;
  begin update public.bo_entidad set rfc = 'ABC' where id = 1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(1): un RFC de 3 caracteres debia fallar'; end if; end;
  begin update public.bo_entidad set rfc = '12345678901234' where id = 1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(1): un RFC de 14 caracteres debia fallar'; end if; end;
  begin update public.bo_entidad set domicilio_fiscal_cp = '9700' where id = 1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(1): un CP de 4 digitos debia fallar'; end if; end;
  update public.bo_entidad set rfc = 'LIK261101AB3', razon_social = 'Likida SAPI de CV', domicilio_fiscal_cp = '97000' where id = 1;
  select count(*) into n from public.bo_entidad where rfc = 'LIK261101AB3';
  if n <> 1 then raise exception '1008(1): el RFC valido debia guardarse'; end if;
  begin delete from public.bo_entidad where id = 1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(1): borrar la entidad debia fallar'; end if; end;

  -- 2. bo_cierre_mes: el periodo es siempre el primer dia del mes; estado dentro del dominio; tipo de cambio positivo.
  begin insert into public.bo_cierre_mes (periodo) values ('2026-10-15'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(2): un periodo que no es dia 1 debia fallar'; end if; end;
  begin insert into public.bo_cierre_mes (periodo, estado) values ('2026-10-01', 'enviado'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(2): un estado fuera de dominio debia fallar'; end if; end;
  begin insert into public.bo_cierre_mes (periodo, tipo_cambio_usd) values ('2026-10-01', 0); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(2): un tipo de cambio 0 debia fallar'; end if; end;
  -- El snapshot debe ser un objeto.
  begin insert into public.bo_cierre_mes (periodo, snapshot) values ('2026-10-01', '[1,2]'::jsonb); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(2): un snapshot que no es objeto debia fallar'; end if; end;
  -- 'cerrado' exige cerrado_en y cerrado_por juntos; sin ellos, ni 'abierto' ni 'listo' pueden llevarlos.
  begin insert into public.bo_cierre_mes (periodo, estado) values ('2026-10-01', 'cerrado'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(2): cerrado sin cerrado_en/cerrado_por debia fallar'; end if; end;
  begin insert into public.bo_cierre_mes (periodo, estado, cerrado_en, cerrado_por) values ('2026-10-01', 'abierto', now(), gen_random_uuid()); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(2): abierto con cerrado_en debia fallar'; end if; end;

  -- 3. Un mes abierto se edita; neto null es «sin dato» y no se convierte en 0.
  insert into public.bo_cierre_mes (periodo, ingresos_cobrados) values ('2026-10-01', 1000.00);
  select (neto is null) into ok from public.bo_cierre_mes where periodo = '2026-10-01';
  if ok is not true then raise exception '1008(3): neto sin dato debia quedar null'; end if;
  update public.bo_cierre_mes set neto = 800.50, estado = 'listo' where periodo = '2026-10-01';
  select count(*) into n from public.bo_cierre_mes where periodo = '2026-10-01' and neto = 800.50 and estado = 'listo';
  if n <> 1 then raise exception '1008(3): el mes abierto debia aceptar cambios'; end if;
  begin update public.bo_cierre_mes set periodo = '2026-09-01' where periodo = '2026-10-01'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(3): cambiar el periodo debia fallar'; end if; end;

  -- 4. Cerrar: despues, el UPDATE y el DELETE se rechazan.
  update public.bo_cierre_mes set estado = 'cerrado', cerrado_en = now(), cerrado_por = gen_random_uuid() where periodo = '2026-10-01';
  begin update public.bo_cierre_mes set neto = 1 where periodo = '2026-10-01'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(4): editar un mes cerrado debia fallar'; end if; end;
  begin update public.bo_cierre_mes set estado = 'abierto', cerrado_en = null, cerrado_por = null where periodo = '2026-10-01'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(4): reabrir con UPDATE directo debia fallar'; end if; end;
  begin delete from public.bo_cierre_mes where periodo = '2026-10-01'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(4): borrar un cierre debia fallar'; end if; end;

  -- 5. Reapertura: el motivo es obligatorio; con motivo, deja su fila y el mes vuelve a abierto.
  begin perform public.bo_reabrir_cierre('2026-10-01', null); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(5): reabrir sin motivo debia fallar'; end if; end;
  begin perform public.bo_reabrir_cierre('2026-10-01', '  ab '); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(5): un motivo de 2 caracteres debia fallar'; end if; end;
  begin perform public.bo_reabrir_cierre('2026-09-01', 'motivo suficiente'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(5): reabrir un mes inexistente debia fallar'; end if; end;
  perform public.bo_reabrir_cierre('2026-10-01', 'correccion de un gasto', gen_random_uuid());
  select count(*) into n from public.bo_cierre_mes where periodo = '2026-10-01' and estado = 'abierto' and cerrado_en is null and cerrado_por is null;
  if n <> 1 then raise exception '1008(5): el mes debia quedar abierto y sin firma de cierre'; end if;
  select count(*) into n from public.bo_cierre_reapertura where periodo = '2026-10-01' and motivo = 'correccion de un gasto';
  if n <> 1 then raise exception '1008(5): debia quedar UNA fila de reapertura, hay %', n; end if;
  -- Un mes que no esta cerrado no se reabre.
  begin perform public.bo_reabrir_cierre('2026-10-01', 'otra vez sin estar cerrado'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(5): reabrir un mes abierto debia fallar'; end if; end;
  -- Ya reabierto, vuelve a poder editarse.
  update public.bo_cierre_mes set neto = 900 where periodo = '2026-10-01';

  -- 6. La reapertura es de solo agregar.
  begin update public.bo_cierre_reapertura set motivo = 'reescrito en silencio' where periodo = '2026-10-01'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(6): UPDATE de reapertura debia fallar'; end if; end;
  begin delete from public.bo_cierre_reapertura where periodo = '2026-10-01'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(6): DELETE de reapertura debia fallar'; end if; end;
  begin insert into public.bo_cierre_reapertura (periodo, motivo) values ('2026-10-01', 'abc'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(6): un motivo corto debia fallar'; end if; end;

  -- 7. bo_update_inversionistas: cuelga de un cierre existente; la aprobacion es de dos campos juntos.
  begin insert into public.bo_update_inversionistas (periodo, borrador_md) values ('2026-08-01', 'x'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(7): un update sin cierre debia fallar'; end if; end;
  insert into public.bo_update_inversionistas (periodo, borrador_md) values ('2026-10-01', '# TL;DR');
  begin update public.bo_update_inversionistas set aprobado_por = gen_random_uuid() where periodo = '2026-10-01'; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(7): aprobado_por sin aprobado_en debia fallar'; end if; end;
  begin insert into public.bo_update_inversionistas (periodo, borrador_md) values ('2026-10-01', ''); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1008(7): un borrador vacio debia fallar'; end if; end;

  -- 8. RLS activa y ningun privilegio para anon/authenticated; service_role no borra cierres ni toca reaperturas.
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname in ('bo_entidad', 'bo_cierre_mes', 'bo_cierre_reapertura', 'bo_update_inversionistas') and c.relrowsecurity;
  if n <> 4 then raise exception '1008(8): las 4 tablas debian tener RLS (hay %)', n; end if;
  select bool_or(has_table_privilege(r, t, p)) into sin_privilegio
    from unnest(array['anon', 'authenticated']) r,
         unnest(array['public.bo_entidad', 'public.bo_cierre_mes', 'public.bo_cierre_reapertura', 'public.bo_update_inversionistas']) t,
         unnest(array['select', 'insert', 'update', 'delete']) p;
  if sin_privilegio then raise exception '1008(8): anon/authenticated no deben tener privilegios sobre las tablas bo_*'; end if;
  if has_table_privilege('service_role', 'public.bo_cierre_mes', 'delete') then raise exception '1008(8): service_role no debe borrar cierres'; end if;
  if has_table_privilege('service_role', 'public.bo_cierre_reapertura', 'update') or has_table_privilege('service_role', 'public.bo_cierre_reapertura', 'delete') then
    raise exception '1008(8): service_role no debe modificar reaperturas';
  end if;
  if not has_table_privilege('service_role', 'public.bo_cierre_mes', 'update') then raise exception '1008(8): service_role debe poder actualizar cierres'; end if;
  if has_function_privilege('anon', 'public.bo_reabrir_cierre(date, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.bo_reabrir_cierre(date, text, uuid)', 'execute') then
    raise exception '1008(8): anon/authenticated no deben ejecutar bo_reabrir_cierre';
  end if;
end $$;

rollback;
