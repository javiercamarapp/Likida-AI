\set ON_ERROR_STOP on
-- 1013 — calendario fiscal del Back-office: catálogo sembrado, cumplimiento con acuse, unicidad (clave, periodo), presentada definitiva y grants.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

do $$
declare
  n int; err text; v_estado text;
begin
  -- 1. La semilla trae las 7 obligaciones y TODAS pendientes de contador.
  select count(*) into n from public.bo_obligacion_fiscal;
  if n < 7 then raise exception '1013(1): esperaba al menos 7 obligaciones sembradas y hay %', n; end if;
  select count(*) into n from public.bo_obligacion_fiscal where estado_catalogo <> 'pendiente_de_contador';
  if n <> 0 then raise exception '1013(1): % obligaciones sembradas no estan pendientes de contador', n; end if;
  select count(*) into n from public.bo_obligacion_fiscal where clave in
    ('isr_provisional', 'iva_mensual', 'diot', 'contabilidad_electronica', 'declaracion_anual', 'nomina_imss', 'conservacion_5_anios');
  if n <> 7 then raise exception '1013(1): faltan claves de la semilla (hay %)', n; end if;

  -- 2. Las de evento no llevan fecha; las anuales llevan mes; las mensuales no.
  begin
    insert into public.bo_obligacion_fiscal (clave, nombre, periodicidad, dia_limite) values ('x_evento_con_dia', 'Evento con dia', 'evento', 5);
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1013(2): un evento con dia limite debia fallar'; end if; end;
  begin
    insert into public.bo_obligacion_fiscal (clave, nombre, periodicidad, dia_limite) values ('x_anual_sin_mes', 'Anual sin mes', 'anual', 5);
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1013(2): una anual sin mes debia fallar'; end if; end;
  begin
    insert into public.bo_obligacion_fiscal (clave, nombre, periodicidad, dia_limite, mes_limite) values ('x_mensual_con_mes', 'Mensual con mes', 'mensual', 5, 3);
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1013(2): una mensual con mes debia fallar'; end if; end;

  -- 3. Cumplimiento: periodo = primer día de mes; unicidad (clave, periodo).
  begin
    insert into public.bo_obligacion_cumplimiento (clave, periodo) values ('iva_mensual', '2026-10-15');
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1013(3): un periodo a mitad de mes debia fallar'; end if; end;
  insert into public.bo_obligacion_cumplimiento (clave, periodo) values ('iva_mensual', '2026-10-01');
  begin
    insert into public.bo_obligacion_cumplimiento (clave, periodo) values ('iva_mensual', '2026-10-01');
    raise exception 'no lanzo';
  exception when unique_violation then null; end;
  insert into public.bo_obligacion_cumplimiento (clave, periodo) values ('iva_mensual', '2026-11-01');

  -- 4. Una clave que no existe en el catálogo se rechaza (FK).
  begin
    insert into public.bo_obligacion_cumplimiento (clave, periodo) values ('inventada', '2026-10-01');
    raise exception 'no lanzo';
  exception when foreign_key_violation then null; end;

  -- 5. «Presentada» exige quién, cuándo y acuse (la marca un humano; el sistema nunca declara).
  begin
    update public.bo_obligacion_cumplimiento set estado = 'presentada' where clave = 'iva_mensual' and periodo = '2026-10-01';
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1013(5): presentada sin acuse debia fallar'; end if; end;
  begin
    update public.bo_obligacion_cumplimiento set estado = 'presentada', presentada_por = 'Javier', presentada_en = '2026-11-17', acuse_ref = '   '
     where clave = 'iva_mensual' and periodo = '2026-10-01';
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1013(5): un acuse en blanco debia fallar'; end if; end;
  -- 'paquete_listo' exige la fecha en que se generó.
  begin
    update public.bo_obligacion_cumplimiento set estado = 'paquete_listo' where clave = 'iva_mensual' and periodo = '2026-11-01';
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1013(5): paquete_listo sin fecha debia fallar'; end if; end;
  update public.bo_obligacion_cumplimiento set estado = 'paquete_listo', paquete_generado_en = now() where clave = 'iva_mensual' and periodo = '2026-11-01';

  -- 6. Con acuse completo se marca; después es definitiva.
  update public.bo_obligacion_cumplimiento set estado = 'presentada', presentada_por = 'Javier', presentada_en = '2026-11-17', acuse_ref = 'ACUSE-0001'
   where clave = 'iva_mensual' and periodo = '2026-10-01';
  select estado into v_estado from public.bo_obligacion_cumplimiento where clave = 'iva_mensual' and periodo = '2026-10-01';
  if v_estado <> 'presentada' then raise exception '1013(6): debia quedar presentada y quedo %', v_estado; end if;
  begin
    update public.bo_obligacion_cumplimiento set estado = 'pendiente' where clave = 'iva_mensual' and periodo = '2026-10-01';
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1013(6): desmarcar una presentada debia fallar'; end if; end;
  begin
    update public.bo_obligacion_cumplimiento set acuse_ref = 'OTRO' where clave = 'iva_mensual' and periodo = '2026-10-01';
    raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1013(6): cambiar el acuse de una presentada debia fallar'; end if; end;
  -- La nota sí se puede ampliar.
  update public.bo_obligacion_cumplimiento set nota = 'Aclaracion posterior' where clave = 'iva_mensual' and periodo = '2026-10-01';

  -- 7. La semilla es idempotente: volver a insertarla no duplica ni cambia nada.
  insert into public.bo_obligacion_fiscal (clave, nombre, periodicidad, dia_limite, meses_desfase) values ('iva_mensual', 'Otro nombre', 'mensual', 20, 1)
    on conflict (clave) do nothing;
  select count(*) into n from public.bo_obligacion_fiscal where clave = 'iva_mensual' and dia_limite = 17;
  if n <> 1 then raise exception '1013(7): la semilla no debia cambiar con on conflict do nothing'; end if;

  -- 8. RLS activa y solo service_role: authenticated no lee ni escribe.
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname in ('bo_obligacion_fiscal', 'bo_obligacion_cumplimiento') and c.relrowsecurity;
  if n <> 2 then raise exception '1013(8): las dos tablas deben tener RLS y hay %', n; end if;
  begin
    set local role authenticated;
    perform count(*) from public.bo_obligacion_fiscal;
    reset role;
    raise exception 'authenticated pudo leer';
  exception when insufficient_privilege then reset role;
  end;
  begin
    set local role anon;
    insert into public.bo_obligacion_cumplimiento (clave, periodo) values ('diot', '2026-09-01');
    reset role;
    raise exception 'anon pudo escribir';
  exception when insufficient_privilege then reset role;
  end;
  -- service_role no borra hechos.
  begin
    set local role service_role;
    delete from public.bo_obligacion_cumplimiento where clave = 'iva_mensual';
    reset role;
    raise exception 'service_role pudo borrar';
  exception when insufficient_privilege then reset role;
  end;
end $$;

rollback;
