\set ON_ERROR_STOP on
-- 0672 — CARTA PORTE, correctiva de la ronda 15: hijos con huella ya conocida (M1) y replay completo.
-- Postgres REAL, datos sintéticos, rollback.
--
--   (a) un hijo cuya huella era de un documento RECHAZADO (purgado) se REABRE: `recibido`, con el archivo nuevo, sin purga,
--       intentos 0, ficha de linaje bajo el padre nuevo (aunque ya tuviera una de otro padre), evento «reabierto»;
--   (b) igual con un FALLIDO con los intentos agotados;
--   (c) un APROBADO purgado NO se toca: `sin_archivo` (la app borra el archivo recién subido) y evento «duplicado_recibido»;
--   (d) un vigente (por revisar) NO se toca: `reutilizado`;
--   (e) el evento «dividido» del padre cuenta reabiertos y sin_archivo y lista TODOS los hijos; el replay los devuelve todos
--       (no solo los que tienen ficha), sin crear nada, y la función sigue siendo solo de service_role;
begin;

insert into public.tenant (id, nombre) values
  ('67200000-0000-4000-8000-0000000000a1', 'Flota A 0672'),
  ('67200000-0000-4000-8000-0000000000b1', 'Flota B 0672');

create function pg_temp.sha(t text) returns text language sql as $$ select encode(sha256(convert_to('0672-' || t, 'utf8')), 'hex') $$;

-- Padres (procesando, versión 2, lease vivo): 1 reabre/sin_archivo/reutilizado; 2 sirve de «padre anterior» del hijo con ficha.
insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, version, intentos, procesando_hasta, storage_ruta, remitente_reconocido)
values
  ('67200000-0000-4000-8000-000000000001', '67200000-0000-4000-8000-0000000000a1', 'correo', 'excel', 'plan.xlsx', 1000, pg_temp.sha('padre-1'), 'procesando', 2, 1, now() + interval '2 minutes', 'ruta/p1', true),
  ('67200000-0000-4000-8000-000000000002', '67200000-0000-4000-8000-0000000000a1', 'correo', 'excel', 'viejo.xlsx', 1000, pg_temp.sha('padre-2'), 'dividido', 3, 1, null, 'ruta/p2', true);

-- Los hijos con huella ya conocida.
insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, version, intentos, storage_ruta, purgado_en, rechazo_motivo, aprobado_en, extraccion, ultimo_error, avisos_oficina)
values
  -- h1: rechazado y purgado, con ficha de un padre ANTERIOR (2)
  ('67200000-0000-4000-8000-0000000000c1', '67200000-0000-4000-8000-0000000000a1', 'correo', 'csv', 'h1.csv', 50, pg_temp.sha('h1'), 'rechazado', 4, 1, null, now(), 'duplicado', null, '{"x":1}', null, '{"hallazgos":"2026-01-01T00:00:00Z"}'),
  -- h2: fallido con los intentos agotados
  ('67200000-0000-4000-8000-0000000000c2', '67200000-0000-4000-8000-0000000000a1', 'correo', 'csv', 'h2.csv', 50, pg_temp.sha('h2'), 'fallido', 7, 5, 'ruta/viejo-h2', null, null, null, null, 'no se pudo leer', '{}'),
  -- h3: aprobado y purgado
  ('67200000-0000-4000-8000-0000000000c3', '67200000-0000-4000-8000-0000000000a1', 'correo', 'csv', 'h3.csv', 50, pg_temp.sha('h3'), 'aprobado', 5, 1, null, now(), null, now(), null, null, '{}'),
  -- h4: vigente
  ('67200000-0000-4000-8000-0000000000c4', '67200000-0000-4000-8000-0000000000a1', 'correo', 'csv', 'h4.csv', 50, pg_temp.sha('h4'), 'por_revisar', 3, 1, 'ruta/h4', null, null, null, null, null, '{}');
insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total, clave)
values ('67200000-0000-4000-8000-0000000000c1', '67200000-0000-4000-8000-0000000000a1', '67200000-0000-4000-8000-000000000002', pg_temp.sha('padre-2'), 1, 2, 'VIEJO');

create function pg_temp.hijos() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('indice', g, 'clave', 'F-' || g, 'nombre', 'h' || g || '.csv', 'sha256', pg_temp.sha(case when g <= 4 then 'h' || g else 'nuevo' end),
                                      'bytes', 100 + g, 'storage_ruta', 'ruta/nuevo-' || g) order by g)
  from generate_series(1, 5) g
$$;

-- ── (a)-(e) dividir ─────────────────────────────────────────────────────────
do $$
declare
  r record; acciones text[] := '{}'; filas int;
  d public.cp_documento%rowtype; f public.cp_documento_embarque%rowtype; det jsonb; antes int; despues int;
begin
  for r in select * from public.cp_documento_dividir('67200000-0000-4000-8000-0000000000a1', '67200000-0000-4000-8000-000000000001', 2, pg_temp.hijos(),
                                                     now() + interval '180 days', now() + interval '90 days') order by indice loop
    acciones := acciones || (r.indice || ':' || r.accion || ':' || r.creado);
  end loop;
  if acciones <> array['1:reabierto:false', '2:reabierto:false', '3:sin_archivo:false', '4:reutilizado:false', '5:creado:true'] then
    raise exception '0672: acciones inesperadas %', acciones;
  end if;

  -- (a) h1: rechazado+purgado → recibido, reabierto con el archivo NUEVO
  select * into d from public.cp_documento where id = '67200000-0000-4000-8000-0000000000c1';
  if d.estado <> 'recibido' or d.purgado_en is not null or d.storage_ruta <> 'ruta/nuevo-1' or d.intentos <> 0 or d.rechazo_motivo is not null
     or d.extraccion is not null or d.version <> 5 or d.bytes <> 101 or d.retener_hasta < now() + interval '179 days' or d.avisos_oficina <> '{}'::jsonb then
    raise exception '0672: h1 no quedó reabierto como un documento limpio: %', to_jsonb(d);
  end if;
  select * into f from public.cp_documento_embarque where documento_id = '67200000-0000-4000-8000-0000000000c1';
  if f.padre_id <> '67200000-0000-4000-8000-000000000001' or f.indice <> 1 or f.total <> 5 or f.clave <> 'F-1' then
    raise exception '0672: la ficha de h1 debía pasar al padre nuevo: %', to_jsonb(f);
  end if;
  if (select count(*) from public.cp_documento_evento where documento_id = d.id and tipo = 'reabierto'
         and detalle ->> 'origen' = 'division' and detalle ->> 'estado_previo' = 'rechazado'
         and detalle ->> 'padre_id' = '67200000-0000-4000-8000-000000000001') <> 1 then
    raise exception '0672: falta el evento «reabierto» de h1';
  end if;

  -- (b) h2: fallido agotado → recibido con intentos 0 (misma ruta del archivo nuevo)
  select * into d from public.cp_documento where id = '67200000-0000-4000-8000-0000000000c2';
  if d.estado <> 'recibido' or d.intentos <> 0 or d.ultimo_error is not null or d.storage_ruta <> 'ruta/nuevo-2' then
    raise exception '0672: h2 (fallido) no se reabrió: %', to_jsonb(d);
  end if;
  if not exists (select 1 from public.cp_documento_embarque where documento_id = d.id and padre_id = '67200000-0000-4000-8000-000000000001' and indice = 2) then
    raise exception '0672: h2 debía tener ficha bajo el padre nuevo';
  end if;

  -- (c) h3: aprobado purgado → intacto + «duplicado_recibido»
  select * into d from public.cp_documento where id = '67200000-0000-4000-8000-0000000000c3';
  if d.estado <> 'aprobado' or d.purgado_en is null or d.storage_ruta is not null or d.version <> 5 then raise exception '0672: h3 (aprobado) no debía tocarse: %', to_jsonb(d); end if;
  if (select count(*) from public.cp_documento_evento where documento_id = d.id and tipo = 'duplicado_recibido' and detalle ->> 'origen' = 'division') <> 1 then
    raise exception '0672: falta el evento «duplicado_recibido» de h3';
  end if;
  if exists (select 1 from public.cp_documento_embarque where documento_id = d.id) then raise exception '0672: h3 no debía recibir ficha ajena'; end if;

  -- (d) h4: vigente → intacto
  select * into d from public.cp_documento where id = '67200000-0000-4000-8000-0000000000c4';
  if d.estado <> 'por_revisar' or d.storage_ruta <> 'ruta/h4' or d.version <> 3 then raise exception '0672: h4 (vigente) no debía tocarse: %', to_jsonb(d); end if;

  -- (e) el evento del padre
  select detalle into det from public.cp_documento_evento where documento_id = '67200000-0000-4000-8000-000000000001' and tipo = 'dividido';
  if (det ->> 'embarques')::int <> 5 or (det ->> 'nuevos')::int <> 1 or (det ->> 'ya_existian')::int <> 4 or (det ->> 'reabiertos')::int <> 2
     or (det ->> 'sin_archivo')::int <> 1 or jsonb_array_length(det -> 'hijos') <> 5 then
    raise exception '0672: el evento «dividido» no cuenta lo ocurrido: %', det;
  end if;

  -- (e) replay: TODOS los hijos (5, no solo los 3 con ficha), sin crear nada
  select count(*) into antes from public.cp_documento_evento where tenant_id = '67200000-0000-4000-8000-0000000000a1';
  select count(*) into filas from public.cp_documento_dividir('67200000-0000-4000-8000-0000000000a1', '67200000-0000-4000-8000-000000000001', 3, pg_temp.hijos(), now(), now()) x
   where not x.creado and x.accion = 'reutilizado';
  select count(*) into despues from public.cp_documento_evento where tenant_id = '67200000-0000-4000-8000-0000000000a1';
  if filas <> 5 or antes <> despues then raise exception '0672: el replay debía devolver los 5 hijos sin tocar nada (% filas, eventos % → %)', filas, antes, despues; end if;
  if (select count(*) from public.cp_documento_embarque where padre_id = '67200000-0000-4000-8000-000000000001') <> 3 then
    raise exception '0672: debía haber 3 fichas bajo el padre (h1, h2 reabiertos y el nuevo) y el replay no cambia eso';
  end if;
end $$;

-- ── (e bis) un padre dividido ANTES de la 0672 (sin lista en el evento) sigue devolviendo sus fichas ──
do $$
declare filas int;
begin
  select count(*) into filas from public.cp_documento_dividir('67200000-0000-4000-8000-0000000000a1', '67200000-0000-4000-8000-000000000002', 3, pg_temp.hijos(), now(), now());
  -- el padre 2 no tiene evento «dividido» (se sembró directo): cae a las fichas. h1 ya pasó al padre 1: no quedan fichas bajo el 2.
  if filas <> 0 then raise exception '0672: un padre viejo sin evento ni fichas devuelve 0 filas (hubo %)', filas; end if;
end $$;

-- ── permisos ────────────────────────────────────────────────────────────────
do $$
declare firma text;
begin
  foreach firma in array array['public.cp_documento_dividir(uuid, uuid, int, jsonb, timestamptz, timestamptz)'] loop
    if has_function_privilege('anon', firma, 'execute') or has_function_privilege('authenticated', firma, 'execute') or has_function_privilege('public', firma, 'execute') then
      raise exception '0672: % no debe ser ejecutable por anon/authenticated/public', firma;
    end if;
    if not has_function_privilege('service_role', firma, 'execute') then raise exception '0672: service_role debe ejecutar %', firma; end if;
  end loop;
end $$;

rollback;
