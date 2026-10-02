\set ON_ERROR_STOP on
-- 0670/0671 — CARTA PORTE: partir un Excel con N embarques en N documentos hijos, contra Postgres REAL (datos sintéticos, rollback).
--
-- Lo que SOLO la base garantiza:
--   (a) `cp_documento_dividir` es atómica: nacen los N hijos con su ficha de linaje y su evento Y el padre queda `dividido` y
--       sin lease, con la retención que se le pidió; o no pasa nada (un hijo inválido a la mitad no deja el primero);
--   (b) es IDEMPOTENTE: dividir un padre ya dividido devuelve sus hijos y no crea nada (un reintento tras una caída no duplica);
--   (c) solo parte un documento `procesando` con la versión que el worker reclamó: versión vieja, otro estado o purgado = 0 filas;
--   (d) una huella que ya existe en la flota NO se duplica ni se le cuelga linaje ajeno: devuelve el existente con creado = false;
--   (e) valida la entrada (2 a 100 hijos, índices 1..n sin huecos, huellas válidas y distintas) y es POR FLOTA (padre ajeno = error);
--   (f) los dominios: estado `dividido` y evento `dividido` entran, uno inventado rebota; la ficha exige total 2..100, índice dentro
--       del total, huella sha256, un lugar único por padre, que el hijo no sea su propio padre y padre e hijo de la MISMA flota;
--   (g) borrar el padre arrastra las FICHAS de linaje de sus hijos pero NO los documentos hijos (sus archivos en Storage los borra la
--       app, uno por uno: una cascada de filas los dejaría huérfanos);
--   (h) un `dividido` no lo reclama ni lo elige nadie (cp_documento_reclamar, cp_documentos_pendientes);
--   (i) permisos: la RPC solo la ejecuta service_role y la tabla es deny-all para anon/authenticated.
begin;

insert into public.tenant (id, nombre) values
  ('67000000-0000-4000-8000-0000000000a1', 'Flota A 0670'),
  ('67000000-0000-4000-8000-0000000000b1', 'Flota B 0670');

-- Un padre `procesando` (versión 2, lease vivo) por escenario.
create temp table _padres (n int, id uuid, tenant uuid, estado text, version int) on commit drop;
insert into _padres values
  (1, '67000000-0000-4000-8000-000000000001', '67000000-0000-4000-8000-0000000000a1', 'procesando', 2),  -- feliz
  (2, '67000000-0000-4000-8000-000000000002', '67000000-0000-4000-8000-0000000000a1', 'procesando', 2),  -- versión vieja
  (3, '67000000-0000-4000-8000-000000000003', '67000000-0000-4000-8000-0000000000a1', 'recibido',   1),  -- no está procesando
  (4, '67000000-0000-4000-8000-000000000004', '67000000-0000-4000-8000-0000000000a1', 'procesando', 2),  -- atomicidad
  (5, '67000000-0000-4000-8000-000000000005', '67000000-0000-4000-8000-0000000000a1', 'procesando', 2),  -- huella ya existente
  (6, '67000000-0000-4000-8000-000000000006', '67000000-0000-4000-8000-0000000000a1', 'procesando', 2),  -- validaciones
  (7, '67000000-0000-4000-8000-000000000007', '67000000-0000-4000-8000-0000000000b1', 'procesando', 2);  -- de la flota B

insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, version, intentos, procesando_hasta, storage_ruta, remitente, asunto, remitente_reconocido)
select p.id, p.tenant, 'correo', 'excel', 'plan-' || p.n || '.xlsx', 1000, encode(sha256(convert_to('0670-padre-' || p.n, 'utf8')), 'hex'), p.estado, p.version, 1,
       case when p.estado = 'procesando' then now() + interval '2 minutes' else null end, 'ruta/' || p.n, 'plan@cliente.example', 'Plan del día', true
  from _padres p;

-- Los hijos de un escenario como el jsonb que manda el cliente. h(n, i) = huella del hijo i del padre n.
create function pg_temp.h(n int, i int) returns text language sql as $$ select encode(sha256(convert_to('0670-hijo-' || n || '-' || i, 'utf8')), 'hex') $$;
create function pg_temp.hijos(n int, cuantos int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('indice', g, 'clave', 'F-' || g, 'nombre', 'plan-' || n || ' · embarque F-' || g || '.csv',
                                      'sha256', pg_temp.h(n, g), 'bytes', 100 + g, 'storage_ruta', 'ruta/hijo-' || n || '-' || g) order by g)
  from generate_series(1, cuantos) g
$$;

-- ── (a) feliz ───────────────────────────────────────────────────────────────
do $$
declare
  filas int; creados int; est text; ver int; lease timestamptz; ret timestamptz;
  n_hijos int; n_fichas int; n_ev_hijo int; n_ev_padre int; h record;
begin
  select count(*), count(*) filter (where creado) into filas, creados
    from public.cp_documento_dividir('67000000-0000-4000-8000-0000000000a1', '67000000-0000-4000-8000-000000000001', 2, pg_temp.hijos(1, 3),
                                     now() + interval '180 days', now() + interval '90 days');
  if filas <> 3 or creados <> 3 then raise exception '0671: esperaba 3 hijos creados, hubo % filas / % creados', filas, creados; end if;

  select estado, version, procesando_hasta, retener_hasta into est, ver, lease, ret from public.cp_documento where id = '67000000-0000-4000-8000-000000000001';
  if est <> 'dividido' or ver <> 3 or lease is not null then raise exception '0671: el padre debía quedar dividido, versión 3 y sin lease (%, %, %)', est, ver, lease; end if;
  if ret < now() + interval '89 days' or ret > now() + interval '91 days' then raise exception '0671: la retención del padre no es la pedida: %', ret; end if;

  select count(*) into n_hijos from public.cp_documento
   where tenant_id = '67000000-0000-4000-8000-0000000000a1' and sha256 in (pg_temp.h(1, 1), pg_temp.h(1, 2), pg_temp.h(1, 3))
     and estado = 'recibido' and formato = 'csv' and mime = 'text/csv' and canal = 'correo' and remitente = 'plan@cliente.example'
     and asunto = 'Plan del día' and remitente_reconocido and retener_hasta > now() + interval '179 days' and intentos = 0 and version = 1;
  if n_hijos <> 3 then raise exception '0671: los hijos no nacieron como documentos recibidos completos (%)', n_hijos; end if;

  for h in select e.indice, e.total, e.clave, e.huella_base, d.sha256, d.storage_ruta, d.bytes
             from public.cp_documento_embarque e join public.cp_documento d on d.id = e.documento_id
            where e.padre_id = '67000000-0000-4000-8000-000000000001' order by e.indice loop
    if h.total <> 3 or h.clave <> 'F-' || h.indice or h.sha256 <> pg_temp.h(1, h.indice)
       or h.huella_base <> encode(sha256(convert_to('0670-padre-1', 'utf8')), 'hex')
       or h.storage_ruta <> 'ruta/hijo-1-' || h.indice or h.bytes <> 100 + h.indice then
      raise exception '0671: ficha del hijo % mal formada: %', h.indice, h;
    end if;
  end loop;
  select count(*) into n_fichas from public.cp_documento_embarque where padre_id = '67000000-0000-4000-8000-000000000001';
  if n_fichas <> 3 then raise exception '0671: esperaba 3 fichas, hay %', n_fichas; end if;

  select count(*) into n_ev_hijo from public.cp_documento_evento ev join public.cp_documento_embarque e on e.documento_id = ev.documento_id
   where e.padre_id = '67000000-0000-4000-8000-000000000001' and ev.tipo = 'recibido' and (ev.detalle ->> 'division')::boolean and (ev.detalle ->> 'total')::int = 3;
  select count(*) into n_ev_padre from public.cp_documento_evento
   where documento_id = '67000000-0000-4000-8000-000000000001' and tipo = 'dividido'
     and (detalle ->> 'embarques')::int = 3 and (detalle ->> 'nuevos')::int = 3 and (detalle ->> 'ya_existian')::int = 0;
  if n_ev_hijo <> 3 or n_ev_padre <> 1 then raise exception '0671: eventos inesperados (hijos %, padre %)', n_ev_hijo, n_ev_padre; end if;
end $$;

-- ── (b) idempotente ─────────────────────────────────────────────────────────
do $$
declare filas int; creados int; antes int; despues int;
begin
  select count(*) into antes from public.cp_documento where tenant_id = '67000000-0000-4000-8000-0000000000a1';
  select count(*), count(*) filter (where creado) into filas, creados
    from public.cp_documento_dividir('67000000-0000-4000-8000-0000000000a1', '67000000-0000-4000-8000-000000000001', 3, pg_temp.hijos(1, 3), now(), now());
  select count(*) into despues from public.cp_documento where tenant_id = '67000000-0000-4000-8000-0000000000a1';
  if filas <> 3 or creados <> 0 or antes <> despues then raise exception '0671: re-dividir un padre dividido debía devolver sus 3 hijos sin crear nada (% filas, % creados, % → %)', filas, creados, antes, despues; end if;
  if (select count(*) from public.cp_documento_evento where documento_id = '67000000-0000-4000-8000-000000000001' and tipo = 'dividido') <> 1 then
    raise exception '0671: el evento «dividido» no debe repetirse en un reintento';
  end if;
end $$;

-- ── (c) solo el que está procesando y con la versión reclamada ──────────────
do $$
declare viejo int; otro_estado int; purgado int; hijos_tras int;
begin
  select count(*) into viejo from public.cp_documento_dividir('67000000-0000-4000-8000-0000000000a1', '67000000-0000-4000-8000-000000000002', 1, pg_temp.hijos(2, 2), now(), now());
  select count(*) into otro_estado from public.cp_documento_dividir('67000000-0000-4000-8000-0000000000a1', '67000000-0000-4000-8000-000000000003', 1, pg_temp.hijos(3, 2), now(), now());
  update public.cp_documento set storage_ruta = null, texto_extracto = null, purgado_en = now() where id = '67000000-0000-4000-8000-000000000002';
  select count(*) into purgado from public.cp_documento_dividir('67000000-0000-4000-8000-0000000000a1', '67000000-0000-4000-8000-000000000002', 2, pg_temp.hijos(2, 2), now(), now());
  select count(*) into hijos_tras from public.cp_documento_embarque where padre_id in ('67000000-0000-4000-8000-000000000002', '67000000-0000-4000-8000-000000000003');
  if viejo <> 0 or otro_estado <> 0 or purgado <> 0 or hijos_tras <> 0 then
    raise exception '0671: versión vieja / otro estado / purgado debían devolver 0 filas y no crear nada (%, %, %, hijos %)', viejo, otro_estado, purgado, hijos_tras;
  end if;
  if (select estado from public.cp_documento where id = '67000000-0000-4000-8000-000000000003') <> 'recibido' then raise exception '0671: el recibido no debía tocarse'; end if;
end $$;

-- ── (a bis) atómica: un hijo inválido a la MITAD no deja el primero ni parte al padre ──
do $$
declare cayo boolean := false; hijos_tras int; est text;
begin
  begin
    -- El 2.º hijo trae bytes = 0 (viola cp_documento_bytes_rango): la inserción del 1.º ya había ocurrido.
    perform * from public.cp_documento_dividir('67000000-0000-4000-8000-0000000000a1', '67000000-0000-4000-8000-000000000004', 2,
      jsonb_set(pg_temp.hijos(4, 3), '{1,bytes}', '0'::jsonb), now(), now());
  exception when check_violation then cayo := true; end;
  select count(*) into hijos_tras from public.cp_documento where tenant_id = '67000000-0000-4000-8000-0000000000a1' and sha256 in (pg_temp.h(4, 1), pg_temp.h(4, 2), pg_temp.h(4, 3));
  select estado into est from public.cp_documento where id = '67000000-0000-4000-8000-000000000004';
  if not cayo or hijos_tras <> 0 or est <> 'procesando' then
    raise exception '0671: la división debía ser atómica (cayó=%, hijos que quedaron=%, estado del padre=%)', cayo, hijos_tras, est;
  end if;
  if exists (select 1 from public.cp_documento_embarque where padre_id = '67000000-0000-4000-8000-000000000004') then raise exception '0671: quedó una ficha de linaje de una división fallida'; end if;
end $$;

-- ── (d) una huella que ya existe en la flota no se duplica ni se le cuelga linaje ───
do $$
declare existente uuid := '67000000-0000-4000-8000-0000000000e1'; r record; creados int := 0; ya int := 0; ficha_ajena int; ev jsonb;
begin
  insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, storage_ruta)
    values (existente, '67000000-0000-4000-8000-0000000000a1', 'manual', 'csv', 'suelto.csv', 50, pg_temp.h(5, 2), 'por_revisar', 'ruta/suelto');
  for r in select * from public.cp_documento_dividir('67000000-0000-4000-8000-0000000000a1', '67000000-0000-4000-8000-000000000005', 2, pg_temp.hijos(5, 3), now(), now()) loop
    if r.creado then creados := creados + 1; else ya := ya + 1; if r.documento_id <> existente or r.indice <> 2 then raise exception '0671: el existente debía ser el hijo 2 (%)', r; end if; end if;
  end loop;
  select count(*) into ficha_ajena from public.cp_documento_embarque where documento_id = existente;
  select detalle into ev from public.cp_documento_evento where documento_id = '67000000-0000-4000-8000-000000000005' and tipo = 'dividido';
  if creados <> 2 or ya <> 1 or ficha_ajena <> 0 or (ev ->> 'nuevos')::int <> 2 or (ev ->> 'ya_existian')::int <> 1 then
    raise exception '0671: huella existente: creados=% ya=% ficha-ajena=% evento=%', creados, ya, ficha_ajena, ev;
  end if;
  if (select estado from public.cp_documento where id = existente) <> 'por_revisar' then raise exception '0671: el documento existente no debía tocarse'; end if;
end $$;

-- ── (e) validaciones y flota ────────────────────────────────────────────────
do $$
declare caso text; probado int := 0;
begin
  foreach caso in array array['uno', 'ciento_uno', 'hueco', 'misma_huella', 'huella_mala', 'no_arreglo'] loop
    begin
      perform * from public.cp_documento_dividir('67000000-0000-4000-8000-0000000000a1', '67000000-0000-4000-8000-000000000006', 2,
        case caso
          when 'uno' then pg_temp.hijos(6, 1)
          when 'ciento_uno' then pg_temp.hijos(6, 101)
          when 'hueco' then jsonb_set(pg_temp.hijos(6, 3), '{2,indice}', '5'::jsonb)
          when 'misma_huella' then jsonb_set(pg_temp.hijos(6, 3), '{1,sha256}', to_jsonb(pg_temp.h(6, 1)))
          when 'huella_mala' then jsonb_set(pg_temp.hijos(6, 3), '{0,sha256}', '"xyz"'::jsonb)
          else '{"a": 1}'::jsonb end, now(), now());
      raise exception '0671: el caso % debía rebotar', caso;
    exception when raise_exception then
      if sqlerrm like '0671: el caso%' then raise; end if;
      probado := probado + 1;
    end;
  end loop;
  if probado <> 6 then raise exception '0671: se esperaban 6 rebotes, hubo %', probado; end if;
  if exists (select 1 from public.cp_documento_embarque where padre_id = '67000000-0000-4000-8000-000000000006') then raise exception '0671: una entrada inválida dejó linaje'; end if;

  -- Padre de la flota B pedido desde la flota A: no existe en ESA flota.
  begin
    perform * from public.cp_documento_dividir('67000000-0000-4000-8000-0000000000a1', '67000000-0000-4000-8000-000000000007', 2, pg_temp.hijos(7, 2), now(), now());
    raise exception '0671: dividir un padre de otra flota debía fallar';
  exception when no_data_found then null; end;
  if (select estado from public.cp_documento where id = '67000000-0000-4000-8000-000000000007') <> 'procesando' then raise exception '0671: el padre ajeno no debía tocarse'; end if;
end $$;

-- ── (f) los dominios ────────────────────────────────────────────────────────
do $$
declare
  a uuid := '67000000-0000-4000-8000-0000000000a1'; b uuid := '67000000-0000-4000-8000-0000000000b1';
  padre uuid := '67000000-0000-4000-8000-000000000001'; hijo uuid := '67000000-0000-4000-8000-0000000000f1';
  ajeno uuid := '67000000-0000-4000-8000-000000000007'; rebotes int := 0;
begin
  -- estado y evento nuevos entran; uno inventado rebota (sin perder los de antes)
  update public.cp_documento set estado = 'dividido' where id = '67000000-0000-4000-8000-000000000006';
  update public.cp_documento set estado = 'recibido' where id = '67000000-0000-4000-8000-000000000006';
  begin update public.cp_documento set estado = 'inventado' where id = '67000000-0000-4000-8000-000000000006'; raise exception '0670: estado inventado debía rebotar';
  exception when check_violation then null; end;
  insert into public.cp_documento_evento (documento_id, tenant_id, tipo) values (padre, a, 'dividido');
  insert into public.cp_documento_evento (documento_id, tenant_id, tipo) values (padre, a, 'aviso_oficina');
  begin insert into public.cp_documento_evento (documento_id, tenant_id, tipo) values (padre, a, 'evento_inventado'); raise exception '0670: evento inventado debía rebotar';
  exception when check_violation then null; end;

  insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, storage_ruta)
    values (hijo, a, 'manual', 'csv', 'h.csv', 10, repeat('9', 64), 'recibido', 'ruta/h');
  -- total fuera de 2..100, índice fuera del total, huella mal formada, hijo = padre, lugar repetido, padre de otra flota
  begin insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total) values (hijo, a, padre, repeat('a', 64), 1, 1); exception when check_violation then rebotes := rebotes + 1; end;
  begin insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total) values (hijo, a, padre, repeat('a', 64), 1, 101); exception when check_violation then rebotes := rebotes + 1; end;
  begin insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total) values (hijo, a, padre, repeat('a', 64), 4, 3); exception when check_violation then rebotes := rebotes + 1; end;
  begin insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total) values (hijo, a, padre, 'ZZZ', 1, 3); exception when check_violation then rebotes := rebotes + 1; end;
  begin insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total) values (hijo, a, hijo, repeat('a', 64), 1, 3); exception when check_violation then rebotes := rebotes + 1; end;
  begin insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total) values (hijo, a, padre, repeat('a', 64), 1, 3); exception when unique_violation then rebotes := rebotes + 1; end;
  begin insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total) values (hijo, a, ajeno, repeat('a', 64), 9, 9); exception when foreign_key_violation or check_violation then rebotes := rebotes + 1; end;
  if rebotes <> 7 then raise exception '0670: se esperaban 7 rebotes de la ficha de linaje, hubo %', rebotes; end if;
  -- una ficha por documento hijo (llave primaria)
  begin
    insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total) values (hijo, a, padre, repeat('a', 64), 7, 9);
    insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total) values (hijo, a, padre, repeat('a', 64), 8, 9);
    raise exception '0670: un hijo con dos fichas debía rebotar';
  exception when unique_violation then null; end;
end $$;

-- ── (g) borrar el padre arrastra las FICHAS, no los documentos hijos ───────
do $$
declare quedan_hijos int; quedan_fichas int; ajeno_vivo int;
begin
  delete from public.cp_documento where id = '67000000-0000-4000-8000-000000000001';
  select count(*) into quedan_fichas from public.cp_documento_embarque where padre_id = '67000000-0000-4000-8000-000000000001';
  select count(*) into quedan_hijos from public.cp_documento where sha256 in (pg_temp.h(1, 1), pg_temp.h(1, 2), pg_temp.h(1, 3)) and tenant_id = '67000000-0000-4000-8000-0000000000a1';
  select count(*) into ajeno_vivo from public.cp_documento where id = '67000000-0000-4000-8000-0000000000e1';
  if quedan_fichas <> 0 then raise exception '0670: borrar el padre debía llevarse las fichas de linaje (quedan %)', quedan_fichas; end if;
  if quedan_hijos <> 3 then raise exception '0670: los documentos hijos NO se borran en cascada (sus archivos son de la app): quedan % de 3', quedan_hijos; end if;
  if ajeno_vivo <> 1 then raise exception '0670: el documento reutilizado (sin linaje) no debía borrarse con el padre'; end if;
  -- y borrar un hijo se lleva SU ficha y solo la suya
  delete from public.cp_documento where sha256 = pg_temp.h(5, 1) and tenant_id = '67000000-0000-4000-8000-0000000000a1';
  if (select count(*) from public.cp_documento_embarque where padre_id = '67000000-0000-4000-8000-000000000005') <> 1 then raise exception '0670: borrar un hijo debía llevarse solo su ficha'; end if;
end $$;

-- ── (h) un `dividido` no lo reclama ni lo elige nadie ───────────────────────
do $$
declare padre uuid := '67000000-0000-4000-8000-000000000005'; reclamado int; elegido int;
begin
  -- el padre 5 quedó dividido en (d); se le envejece para que la gracia no sea la razón por la que no se elige
  update public.cp_documento set created_at = now() - interval '1 day', updated_at = now() - interval '1 day', procesando_hasta = now() - interval '1 hour' where id = padre;
  select count(*) into reclamado from public.cp_documento_reclamar('67000000-0000-4000-8000-0000000000a1', padre, 120);
  select count(*) into elegido from public.cp_documentos_pendientes(200, 5, 0) where id = padre;
  if reclamado <> 0 or elegido <> 0 then raise exception '0670: un dividido no debía reclamarse ni elegirse (reclamado %, elegido %)', reclamado, elegido; end if;
end $$;

-- ── (i) permisos ────────────────────────────────────────────────────────────
do $$
declare firma text := 'public.cp_documento_dividir(uuid, uuid, int, jsonb, timestamptz, timestamptz)';
begin
  if has_function_privilege('anon', firma, 'execute') or has_function_privilege('authenticated', firma, 'execute') or has_function_privilege('public', firma, 'execute') then
    raise exception '0671: anon/authenticated/public no deben ejecutar cp_documento_dividir';
  end if;
  if not has_function_privilege('service_role', firma, 'execute') then raise exception '0671: service_role debe ejecutar cp_documento_dividir'; end if;
  if has_table_privilege('anon', 'public.cp_documento_embarque', 'select') or has_table_privilege('authenticated', 'public.cp_documento_embarque', 'select')
     or has_table_privilege('authenticated', 'public.cp_documento_embarque', 'insert') then
    raise exception '0670: cp_documento_embarque es deny-all para anon/authenticated';
  end if;
  if not has_table_privilege('service_role', 'public.cp_documento_embarque', 'insert') then raise exception '0670: service_role debe poder escribir cp_documento_embarque'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.cp_documento_embarque'::regclass) then raise exception '0670: cp_documento_embarque debe tener RLS'; end if;
end $$;

rollback;
