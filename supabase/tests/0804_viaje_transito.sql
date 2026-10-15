\set ON_ERROR_STOP on
-- 0804 — estado de tránsito y marcas del TMS en el viaje, contra Postgres REAL (datos sintéticos, rollback).
--   (a) las 5 columnas nuevas existen y son nulas por omisión (un viaje existente no cambia);
--   (b) el CHECK admite los 4 valores y null, y rechaza cualquier otro (incluida otra capitalización);
--   (c) se guardan el texto crudo y las marcas con segundos sin perder precisión;
--   (d) la migración se puede reaplicar sin error (la sentencia de alta es idempotente) y el CHECK no se duplica.
begin;

insert into public.tenant (id, nombre) values ('80400000-0000-4000-8000-0000000000a1', 'Flota A 0804');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('80400000-0000-4000-8000-000000000101', '80400000-0000-4000-8000-0000000000a1', 'Chofer A', '525500804001'); -- grep-limpio:ok
insert into public.viaje (id, tenant_id, operador_id, folio, estatus) values
  ('80400000-0000-4000-8000-000000000201', '80400000-0000-4000-8000-0000000000a1', '80400000-0000-4000-8000-000000000101', 'V-0804', 'abierto');

do $$
declare
  v constant uuid := '80400000-0000-4000-8000-000000000201';
  r record;
  estado text;
begin
  -- (a) nulas por omisión
  select transito_estado, transito_actualizado_en, transito_texto_origen, tms_salida_en, tms_llegada_en into r
    from public.viaje where id = v;
  if r.transito_estado is not null or r.transito_actualizado_en is not null or r.transito_texto_origen is not null
     or r.tms_salida_en is not null or r.tms_llegada_en is not null then
    raise exception '0804: las columnas nuevas no son nulas por omisión';
  end if;

  -- (b) dominio
  foreach estado in array array['en_patio', 'en_ruta', 'pendiente_cruce', 'otro'] loop
    update public.viaje set transito_estado = estado where id = v;
  end loop;
  update public.viaje set transito_estado = null where id = v;
  foreach estado in array array['EN_RUTA', 'patio', 'en ruta', '', 'cruzado'] loop
    begin
      update public.viaje set transito_estado = estado where id = v;
      raise exception '0804: el CHECK dejó pasar «%»', estado;
    exception when check_violation then null; end;
  end loop;

  -- (c) texto crudo y marcas con segundos
  update public.viaje set
    transito_estado = 'otro',
    transito_texto_origen = 'PATIO OTRO SITIO',
    transito_actualizado_en = '2026-01-05 08:00:00+00',
    tms_salida_en = '2026-01-05 07:41:23+00',
    tms_llegada_en = '2026-01-06 15:02:59+00'
  where id = v;
  select * into r from public.viaje where id = v;
  if r.transito_texto_origen <> 'PATIO OTRO SITIO'
     or r.tms_salida_en <> '2026-01-05 07:41:23+00'
     or r.tms_llegada_en <> '2026-01-06 15:02:59+00'
     or r.transito_actualizado_en <> '2026-01-05 08:00:00+00' then
    raise exception '0804: no se conservaron el texto crudo o las marcas del TMS';
  end if;
end $$;

-- (d) reaplicar la migración: sin error y sin CHECK duplicado
\ir ../migrations/0804_viaje_transito_y_marcas_tms.sql
do $$
begin
  if (select count(*) from pg_constraint
      where conrelid = 'public.viaje'::regclass and conname = 'viaje_transito_estado_check') <> 1 then
    raise exception '0804: reaplicar la migración duplicó o perdió el CHECK';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'viaje'
        and column_name in ('transito_estado', 'transito_actualizado_en', 'transito_texto_origen', 'tms_salida_en', 'tms_llegada_en')) <> 5 then
    raise exception '0804: faltan columnas tras reaplicar';
  end if;
end $$;

rollback;
