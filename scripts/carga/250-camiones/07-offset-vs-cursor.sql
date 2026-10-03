-- 07-offset-vs-cursor.sql — ronda 16, vuelta 2: lo que cuesta, EN EL SERVIDOR, leer COMPLETO un conjunto por offset
-- (`traerTodo`: range(desde, hasta), 1,000 por página) contra por cursor de id (`traerTodoDesdeId`: id > último),
-- y contar en SQL contra traer filas para contar. Mide las lecturas reales corregidas:
--   · gasto sin CFDI, ventana de 45 días  (facturacion/pendientes.ts getPorFacturar)         ≈ 15k filas
--   · gasto sin CFDI, todo el año          (sat_descarga/ciclo.ts, intake/consolidado.ts, rango largo) ≈ 120k filas
--   · líneas de un desglose de peajes      (intake/desglose_peaje.ts agregarEstatus: 3 estatus)
-- Tiempo de servidor, suma de todas las páginas; no incluye red ni JSON de PostgREST. Correr sobre la base sembrada.
\set T '\'aaaaaaaa-0000-4000-8000-000000000250\''
\set ON_ERROR_STOP on
create or replace function pg_temp.leer_offset(p_desde date, p_cols boolean) returns table(filas int, paginas int, ms numeric) language plpgsql as $$
declare t0 timestamptz := clock_timestamp(); pag int := 0; n int; total int := 0;
begin
  loop
    select count(*) into n from (
      select case when p_cols then ocr_extra::text else null end, id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid
        from public.gasto where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000250' and cfdi_uuid is null and fecha >= p_desde and concepto <> 'factura'
       order by fecha, id limit 1000 offset pag * 1000) q;
    total := total + n; pag := pag + 1;
    exit when n < 1000;
  end loop;
  return query select total, pag, round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
end $$;
create or replace function pg_temp.leer_cursor(p_desde date, p_cols boolean) returns table(filas int, paginas int, ms numeric) language plpgsql as $$
declare t0 timestamptz := clock_timestamp(); pag int := 0; n int; total int := 0; cur uuid := null;
begin
  loop
    select count(*), (array_agg(id order by id desc))[1] into n, cur from (
      select id from (
        select case when p_cols then ocr_extra::text else null end, id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid
          from public.gasto where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000250' and cfdi_uuid is null and fecha >= p_desde and concepto <> 'factura'
           and id > coalesce(cur, '00000000-0000-0000-0000-000000000000'::uuid) order by id limit 1000) z order by id) q;
    total := total + n; pag := pag + 1;
    exit when n < 1000;
  end loop;
  return query select total, pag, round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
end $$;
create or replace function pg_temp.leer_cursor_fecha(p_desde date, p_cols boolean) returns table(filas int, paginas int, ms numeric) language plpgsql as $$
declare t0 timestamptz := clock_timestamp(); pag int := 0; n int; total int := 0; cf date := null; ci uuid := null;
begin
  loop
    -- keyset sobre (fecha, id), el orden en que el índice (tenant_id, fecha) ya entrega las filas:
    --   fecha >= cursor.fecha da el rango del índice; el OR solo descarta lo ya leído.
    select count(*), (array_agg(fecha order by fecha desc, id desc))[1], (array_agg(id order by fecha desc, id desc))[1] into n, cf, ci from (
      select case when p_cols then ocr_extra::text else null end, id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid
        from public.gasto where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000250' and cfdi_uuid is null and fecha >= p_desde and concepto <> 'factura'
         and (cf is null or (fecha >= cf and (fecha > cf or id > ci)))
       order by fecha, id limit 1000) q;
    total := total + n; pag := pag + 1;
    exit when n < 1000;
  end loop;
  return query select total, pag, round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
end $$;
\echo '== gasto sin CFDI, ventana de 45 días: OFFSET (fecha, id)  |  CURSOR (id)  |  CURSOR (fecha, id)'
select 'offset' modo, * from pg_temp.leer_offset(current_date - 45, true) union all select 'cursor id', * from pg_temp.leer_cursor(current_date - 45, true) union all select 'cursor (fecha,id)', * from pg_temp.leer_cursor_fecha(current_date - 45, true);
\echo '== gasto sin CFDI, todo el año (el caso que supera los 100,000 por offset)'
select 'offset' modo, * from pg_temp.leer_offset(current_date - 400, true) union all select 'cursor id', * from pg_temp.leer_cursor(current_date - 400, true) union all select 'cursor (fecha,id)', * from pg_temp.leer_cursor_fecha(current_date - 400, true);
\echo '== agregarEstatus: traer TODAS las líneas del desglose más grande para contar 3 estatus  |  4 conteos en SQL'
explain (analyze, costs off, summary on) select count(*), count(*) filter (where estatus = 'cuadra'), count(*) filter (where estatus = 'no_cuadra'), count(*) filter (where estatus = 'sin_contraparte')
  from public.desglose_peaje_linea where tenant_id = :T::uuid and desglose_id = (select desglose_id from public.desglose_peaje_linea group by 1 order by count(*) desc limit 1);
