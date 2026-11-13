\set ON_ERROR_STOP on
-- 1004 — dominio de tipo_operador ampliado, contra Postgres REAL, en una transacción revertida: el CHECK acepta los seis tipos
-- (foraneo, local, permisionario, rabon, posturero, cargador) y NULL, sigue rechazando lo desconocido, el valor sin normalizar
-- («Rabón») y el vacío, y `tipos_que_reciben` conserva su defecto {foraneo,local}. Datos sintéticos.
begin;

insert into public.tenant (id, nombre) values ('10040000-0000-4000-8000-0000000000a1', 'Flota 1004');
insert into public.operador (id, tenant_id, nombre, telefono)
values ('10040000-0000-4000-8000-0000000000a2', '10040000-0000-4000-8000-0000000000a1', 'Chofer 1004', '525500010041');

-- ── 1. El CHECK existe con el dominio nuevo ─────────────────────────────────
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'liquidacion_desglose_tipo_operador_dominio';
  if def is null then raise exception '1004: falta el CHECK liquidacion_desglose_tipo_operador_dominio'; end if;
  if def not like '%rabon%' or def not like '%posturero%' or def not like '%cargador%' or def not like '%permisionario%' then
    raise exception '1004: el CHECK no trae el dominio ampliado: %', def;
  end if;
end $$;

-- ── 2. Cada tipo válido y NULL se insertan; lo demás se rechaza ─────────────
-- `liquidacion_desglose` es 1:1 con `liquidacion_externa` (su PK), así que cada caso lleva su liquidación.
create function pg_temp.nueva_liq(n text) returns uuid language plpgsql as $f$
declare id uuid := gen_random_uuid();
begin
  insert into public.liquidacion_externa (id, tenant_id, clave_externa, huella, sistema_origen, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
  values (id, '10040000-0000-4000-8000-0000000000a1', 'BIT-' || n, md5(n) || md5(n), 'tms-muestra-tms', '10040000-0000-4000-8000-0000000000a2',
          '2026-10-01', '2026-10-07', '[{"descripcion":"x","tipo":"percepcion","monto":100}]'::jsonb, 100, 'MXN', 'generado');
  return id;
end $f$;

do $$
declare
  t uuid := '10040000-0000-4000-8000-0000000000a1';
  v text; i int := 0; n int;
begin
  foreach v in array array['foraneo','local','permisionario','rabon','posturero','cargador'] loop
    i := i + 1;
    insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, tipo_operador, total_origen)
    values (pg_temp.nueva_liq('T' || i), t, 'T' || i, v, 'calculado');
  end loop;
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, tipo_operador, total_origen)
  values (pg_temp.nueva_liq('TNULL'), t, 'TNULL', null, 'calculado');
  select count(*) into n from public.liquidacion_desglose where tenant_id = t;
  if n <> 7 then raise exception '1004: se esperaban 7 encabezados (6 tipos + NULL) y hay %', n; end if;

  i := 0;
  foreach v in array array['desconocido','Rabón','RABON','','chofer'] loop
    i := i + 1;
    begin
      insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, tipo_operador, total_origen)
      values (pg_temp.nueva_liq('X' || i), t, 'X' || i, v, 'calculado');
      raise exception '1004: el CHECK dejó pasar el tipo «%»', v;
    exception when check_violation then null;
    end;
  end loop;
end $$;

-- ── 3. El defecto de quién recibe NO cambia ─────────────────────────────────
do $$
declare d text;
begin
  select column_default into d from information_schema.columns
   where table_schema = 'public' and table_name = 'liquidacion_correo_config' and column_name = 'tipos_que_reciben';
  if d is null or d not like '%foraneo,local%' or d like '%rabon%' or d like '%posturero%' or d like '%cargador%' then
    raise exception '1004: tipos_que_reciben cambió de defecto: %', d;
  end if;
end $$;

rollback;
