\set ON_ERROR_STOP on
-- 1011 — contratos y vencimientos: checks, anti-duplicado, congelado al terminar, avisos de solo agregar y grants.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

do $$
declare
  c1 uuid; c2 uuid; n int; err text; ok boolean;
begin
  -- 1. Alta mínima: queda borrador, sin fecha (vence_el null = sin fecha declarada) y con aviso por omisión de 30 días.
  insert into public.bo_contrato (tipo, contraparte) values ('suscripcion', 'Vercel 1011') returning id into c1;
  select (estado = 'borrador' and vence_el is null and dias_aviso = '{30}') into ok from public.bo_contrato where id = c1;
  if ok is not true then raise exception '1011(1): defaults incorrectos'; end if;

  -- 2. Checks: tipo, contraparte vacía, dias_aviso (vacío, cero, 366, nulo), fechas en desorden, costo negativo, url no http.
  begin insert into public.bo_contrato (tipo, contraparte) values ('inventado', 'x'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(2): tipo inventado debia lanzar'; end if; end;
  begin insert into public.bo_contrato (tipo, contraparte) values ('otro', '   '); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(2): contraparte vacia debia lanzar'; end if; end;
  begin insert into public.bo_contrato (tipo, contraparte, dias_aviso) values ('otro', 'a', '{}'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(2): dias_aviso vacio debia lanzar'; end if; end;
  begin insert into public.bo_contrato (tipo, contraparte, dias_aviso) values ('otro', 'b', '{0}'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(2): dias_aviso 0 debia lanzar'; end if; end;
  begin insert into public.bo_contrato (tipo, contraparte, dias_aviso) values ('otro', 'c', '{366}'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(2): dias_aviso 366 debia lanzar'; end if; end;
  begin insert into public.bo_contrato (tipo, contraparte, dias_aviso) values ('otro', 'd', array[30, null]::integer[]); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(2): dias_aviso con nulo debia lanzar'; end if; end;
  begin insert into public.bo_contrato (tipo, contraparte, firmado_el, vence_el) values ('otro', 'e', '2026-06-01', '2026-05-01'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(2): vence antes de firmar debia lanzar'; end if; end;
  begin insert into public.bo_contrato (tipo, contraparte, costo_mensual_mxn) values ('otro', 'f', -1); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(2): costo negativo debia lanzar'; end if; end;
  begin insert into public.bo_contrato (tipo, contraparte, documento_url) values ('otro', 'g', 'javascript:alert(1)'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(2): url no http debia lanzar'; end if; end;

  -- 3. Terminado exige motivo, y un motivo exige estado terminado.
  begin update public.bo_contrato set estado = 'terminado' where id = c1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(3): terminar sin motivo debia lanzar'; end if; end;
  begin update public.bo_contrato set motivo_terminacion = 'ya no se usa' where id = c1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(3): motivo sin terminar debia lanzar'; end if; end;

  -- 4. Anti-duplicado del contrato vivo (mismo tipo, contraparte sin importar mayúsculas y misma fecha).
  begin insert into public.bo_contrato (tipo, contraparte) values ('suscripcion', ' vercel 1011 '); raise exception 'no lanzo';
  exception when unique_violation then null; end;
  -- Con otra fecha de vencimiento ya es otro contrato.
  insert into public.bo_contrato (tipo, contraparte, vence_el) values ('suscripcion', 'Vercel 1011', '2027-01-01') returning id into c2;

  -- 5. Terminar con motivo funciona y CONGELA la fila.
  update public.bo_contrato set estado = 'terminado', motivo_terminacion = 'se cambio de proveedor' where id = c1;
  begin update public.bo_contrato set responsable = 'Javier' where id = c1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(5): un contrato terminado no debia editarse'; end if; end;
  -- Terminado libera el anti-duplicado (se puede dar de alta de nuevo el mismo contrato).
  insert into public.bo_contrato (tipo, contraparte) values ('suscripcion', 'Vercel 1011');

  -- 6. actualizado_en se mueve al editar una fila viva.
  update public.bo_contrato set actualizado_en = '2000-01-01', responsable = 'Javier' where id = c2;
  select (actualizado_en > '2020-01-01') into ok from public.bo_contrato where id = c2;
  if ok is not true then raise exception '1011(6): actualizado_en no se actualizo'; end if;

  -- 7. Los avisos son de solo agregar y únicos por (contrato, umbral).
  insert into public.bo_contrato_aviso (contrato_id, dias_antes) values (c2, 30);
  begin insert into public.bo_contrato_aviso (contrato_id, dias_antes) values (c2, 30); raise exception 'no lanzo';
  exception when unique_violation then null; end;
  begin update public.bo_contrato_aviso set dias_antes = 10 where contrato_id = c2; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(7): UPDATE de aviso debia lanzar'; end if; end;
  begin delete from public.bo_contrato_aviso where contrato_id = c2; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(7): DELETE de aviso debia lanzar'; end if; end;
  begin insert into public.bo_contrato_aviso (contrato_id, dias_antes, canal) values (c2, 10, 'correo'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1011(7): canal distinto de pantalla debia lanzar'; end if; end;

  -- 8. RLS activa y sin privilegios para roles de aplicación.
  select count(*) into n from pg_class where oid in ('public.bo_contrato'::regclass, 'public.bo_contrato_aviso'::regclass) and relrowsecurity;
  if n <> 2 then raise exception '1011(8): las dos tablas deben tener RLS y hay %', n; end if;
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('bo_contrato', 'bo_contrato_aviso') and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n <> 0 then raise exception '1011(8): anon/authenticated/public no deben tener privilegios (hay %)', n; end if;
  begin
    set local role authenticated;
    perform count(*) from public.bo_contrato;
    reset role;
    raise exception 'authenticated pudo leer';
  exception when insufficient_privilege then reset role;
  end;
  -- service_role no borra contratos.
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'bo_contrato' and grantee = 'service_role' and privilege_type in ('DELETE', 'TRUNCATE');
  if n <> 0 then raise exception '1011(8): service_role no debe poder borrar contratos'; end if;
end $$;

rollback;
