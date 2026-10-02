\set ON_ERROR_STOP on
-- 0684-0687 — prueba de carga de 250 camiones (ronda 16), contra Postgres REAL, sintético y con rollback.
--   (a) 0684: los índices existen, son válidos y su predicado es el que usan las consultas reales;
--   (b) 0685: anomalias_gasto_tenant — folio repetido, descarte por UUID conocido, aislamiento, y la rama
--       cfdi_duplicado es imposible (uq_gasto_cfdi_uuid);
--   (c) 0686: serie_comparativa_tenant (predicado sargable) == cálculo de referencia con fecha local MX (el filtro de rechazadas lo cubre la 0348);
--   (d) 0687: casetas_medidas_ruta_tenant / rutas_liquidadas_tenant == cálculo de referencia.
begin;

-- (a) índices
do $$
declare n int; r record;
begin
  for r in select unnest(array['gasto_folio_sin_cfdi_idx','vigia_mensaje_aprobado_idx','vigia_mensaje_enviado_idx',
                               'viaje_hito_mensaje_en_idx','viaje_hito_tenant_actualizado_idx','viaje_hito_evento_creado_idx',
                               'viaje_hito_aviso_creado_idx','vigia_evento_creado_idx']) as nom
  loop
    select count(*) into n from pg_class c join pg_index i on i.indexrelid = c.oid
     where c.relname = r.nom and c.relnamespace = 'public'::regnamespace and i.indisvalid and i.indisready;
    if n <> 1 then raise exception '0684(a): índice % ausente o inválido', r.nom; end if;
  end loop;
  if (select pg_get_indexdef('public.gasto_folio_sin_cfdi_idx'::regclass)) !~ 'WHERE' then
    raise exception '0684(a): gasto_folio_sin_cfdi_idx perdió su predicado parcial';
  end if;
end $$;

-- Datos sintéticos de dos flotas.
insert into tenant (id, nombre, plan) values
  ('68400000-0000-4000-8000-0000000000a1', 'Flota A 0684', 'demo'),
  ('68400000-0000-4000-8000-0000000000b1', 'Flota B 0684', 'demo');
insert into operador (id, tenant_id, nombre, telefono) values
  ('68400000-0000-4000-8000-0000000000a2', '68400000-0000-4000-8000-0000000000a1', 'Chofer A', '5215568400001'),
  ('68400000-0000-4000-8000-0000000000b2', '68400000-0000-4000-8000-0000000000b1', 'Chofer B', '5215568400002');
insert into viaje (id, tenant_id, operador_id, folio, origen, destino, estatus, fecha_inicio, created_at) values
  ('68400000-0000-4000-8000-0000000001a1', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000000a2', 'A-1', 'León', 'CDMX', 'liquidado', current_date - 3, now() - interval '3 days'),
  ('68400000-0000-4000-8000-0000000001a2', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000000a2', 'A-2', 'leon ', ' cdmx', 'liquidado', current_date - 2, now() - interval '2 days'),
  ('68400000-0000-4000-8000-0000000001a3', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000000a2', 'A-3', 'León', 'Monterrey', 'liquidado', current_date - 2, now() - interval '2 days'),
  ('68400000-0000-4000-8000-0000000001b1', '68400000-0000-4000-8000-0000000000b1', '68400000-0000-4000-8000-0000000000b2', 'B-1', 'León', 'CDMX', 'liquidado', current_date - 2, now() - interval '2 days');
insert into gasto (id, tenant_id, viaje_id, concepto, monto, fecha, folio, cfdi_uuid) values
  -- folio repetido sin UUID en dos viajes de A
  ('68400000-0000-4000-8000-0000000002a1', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000001a1', 'caseta', 600, current_date - 3, 'F-77', null),
  ('68400000-0000-4000-8000-0000000002a2', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000001a1', 'caseta', 400, current_date - 3, 'F-78', null),
  ('68400000-0000-4000-8000-0000000002a3', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000001a2', 'caseta', 600, current_date - 2, 'F-77', null),
  -- folio que ES un UUID conocido: se descarta
  ('68400000-0000-4000-8000-0000000002a4', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000001a1', 'diesel', 900, current_date - 3, '11111111-1111-4111-8111-111111111111', null),
  ('68400000-0000-4000-8000-0000000002a5', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000001a2', 'diesel', 900, current_date - 2, '11111111-1111-4111-8111-111111111111', null),
  ('68400000-0000-4000-8000-0000000002a6', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000001a3', 'diesel', 900, current_date - 2, 'otro', '11111111-1111-4111-8111-111111111111'),
  -- la otra flota repite el mismo folio F-77: NO contamina a A y A tampoco a B
  ('68400000-0000-4000-8000-0000000002b1', '68400000-0000-4000-8000-0000000000b1', '68400000-0000-4000-8000-0000000001b1', 'caseta', 600, current_date - 2, 'F-77', null);
insert into liquidacion (id, tenant_id, viaje_id, total_comprobado, total_anticipo, diferencia, estatus, created_at, revision) values
  ('68400000-0000-4000-8000-0000000003a1', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000001a1', 1900, 2000, 100, 'cuadrada', now() - interval '3 days', 'pendiente'),
  ('68400000-0000-4000-8000-0000000003a2', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000001a2', 1500, 1500, 0, 'cuadrada', now() - interval '2 days', 'pendiente'),
  ('68400000-0000-4000-8000-0000000003a3', '68400000-0000-4000-8000-0000000000a1', '68400000-0000-4000-8000-0000000001a3', 900, 900, 0, 'cuadrada', now() - interval '400 days', 'pendiente'),
  ('68400000-0000-4000-8000-0000000003b1', '68400000-0000-4000-8000-0000000000b1', '68400000-0000-4000-8000-0000000001b1', 600, 600, 0, 'cuadrada', now() - interval '2 days', 'pendiente');

-- (b) 0685
do $$
declare r jsonb;
begin
  r := public.anomalias_gasto_tenant('68400000-0000-4000-8000-0000000000a1');
  if jsonb_array_length(r) <> 1 then raise exception '0685(b): esperaba 1 anomalía, salió %', r; end if;
  if r->0->>'tipo' <> 'folio_duplicado' or r->0->>'detalle' <> 'Folio F-77 (caseta) liquidado en 2 viajes'
     or (r->0->>'monto')::numeric <> 600 or jsonb_array_length(r->0->'viajes') <> 2 then
    raise exception '0685(b): anomalía distinta de la esperada: %', r;
  end if;
  -- la otra flota ve solo lo suyo (un viaje con F-77 → nada que reportar)
  if public.anomalias_gasto_tenant('68400000-0000-4000-8000-0000000000b1') <> '[]'::jsonb then
    raise exception '0685(b): la flota B no debía tener anomalías';
  end if;
  -- la rama cfdi_duplicado es imposible: (tenant_id, cfdi_uuid, cfdi_orden) es UNIQUE, así que el mismo
  -- (uuid, orden) no puede estar en dos viajes de la misma flota (el insert del segundo rebota 23505).
  if not exists (select 1 from pg_index i where i.indexrelid = 'public.uq_gasto_cfdi_uuid'::regclass and i.indisunique) then
    raise exception '0685(b): falta uq_gasto_cfdi_uuid — la rama cfdi_duplicado retirada ya no sería imposible';
  end if;
end $$;

-- (c) 0686: referencia = el predicado ANTERIOR (fecha local de México aplicada a la columna)
do $$
declare t uuid := '68400000-0000-4000-8000-0000000000a1'; hoy date := current_date;
        nuevo jsonb; ref jsonb; v int;
begin
  foreach v in array array[7, 30, 90] loop
    nuevo := public.serie_comparativa_tenant(t, v, 5, hoy);
    select coalesce(jsonb_agg(jsonb_build_object('liquidado', coalesce((
             select round(sum(l.total_comprobado), 2) from public.liquidacion l
              where l.tenant_id = t and l.revision <> 'rechazada'
                and (l.created_at at time zone 'America/Mexico_City')::date >= (hoy - (gs * v) - (v - 1))
                and (l.created_at at time zone 'America/Mexico_City')::date <= (hoy - (gs * v))), 0)) order by gs), '[]')
      into ref from generate_series(0, 4) gs;
    if (select jsonb_agg(e->'liquidado' order by o) from jsonb_array_elements(nuevo) with ordinality x(e, o))
       is distinct from (select jsonb_agg(e->'liquidado' order by o) from jsonb_array_elements(ref) with ordinality x(e, o)) then
      raise exception '0686(c): ventana % días: % <> %', v, nuevo, ref;
    end if;
  end loop;
end $$;

-- (d) 0687
do $$
declare t uuid := '68400000-0000-4000-8000-0000000000a1'; piso timestamptz := now() - interval '366 days'; r record; n int;
begin
  -- pares: (León,CDMX), (leon , cdmx) y (León,Monterrey) tiene liquidación a 400 días: fuera de la ventana
  select count(*) into n from public.rutas_liquidadas_tenant(t, piso);
  if n <> 2 then raise exception '0687(d): esperaba 2 pares en la ventana, salieron %', n; end if;
  -- viajes a1 (caseta 600+400=1000) y a2 (caseta 600): promedio 800 sobre 2 viajes
  select * into r from public.casetas_medidas_ruta_tenant(t, piso, array['León','leon '], array[' cdmx','CDMX']);
  if r.promedio <> 800.00 or r.viajes <> 2 then raise exception '0687(d): promedio/viajes % / %', r.promedio, r.viajes; end if;
  -- otra flota: B no ve los viajes de A (y A no ve el de B)
  select * into r from public.casetas_medidas_ruta_tenant('68400000-0000-4000-8000-0000000000b1', piso, array['León'], array['CDMX']);
  if r.promedio <> 600.00 or r.viajes <> 1 then raise exception '0687(d): aislamiento % / %', r.promedio, r.viajes; end if;
  -- sin casetas / sin ruta: 0 viajes y promedio nulo, jamás 0
  select * into r from public.casetas_medidas_ruta_tenant(t, piso, array['Nowhere'], array['CDMX']);
  if r.viajes <> 0 or r.promedio is not null then raise exception '0687(d): ruta inexistente %/%', r.viajes, r.promedio; end if;
end $$;

-- solo service_role ejecuta las RPC nuevas
do $$
begin
  if has_function_privilege('authenticated', 'public.casetas_medidas_ruta_tenant(uuid, timestamptz, text[], text[])', 'execute')
     or has_function_privilege('anon', 'public.rutas_liquidadas_tenant(uuid, timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.rutas_liquidadas_tenant(uuid, timestamptz)', 'execute') then
    raise exception '0687(d): permisos de las RPC';
  end if;
end $$;

rollback;
