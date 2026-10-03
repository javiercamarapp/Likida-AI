\set ON_ERROR_STOP on
-- 0689 — `vigia_purgar` por lotes (ronda 16, vuelta 2), contra Postgres REAL, sintético y con rollback.
--   (a) el índice que el borrado de mensajes necesita existe y la FK `respuesta_a` puede USARLO (sin él, cada
--       mensaje borrado era un Seq Scan: 23.5 s por 500 mensajes en la prueba de carga);
--   (b) el TOPE: 3,000 conversaciones cerradas vacías y `vigia_purgar(100)` borra EXACTAMENTE 100 (la 0400 se las
--       llevaba todas de golpe); el límite es de la pasada entera (mensajes + conversaciones);
--   (c) NUNCA borra lo que no debe: mensaje dentro de su retención, flota con otra retención, conversación activa
--       (aunque esté vacía), cerrada hace poco, cerrada con un mensaje vivo, eventos de lo que se queda;
--   (d) SÍ borra todo lo vencido al repetir la llamada (el cron sigue en la siguiente pasada), cada llamada ≤ límite.
begin;

insert into public.tenant (id, nombre, plan) values
  ('68900000-0000-4000-8000-0000000000a1', 'Flota A 0689', 'demo'),
  ('68900000-0000-4000-8000-0000000000b1', 'Flota B 0689', 'demo');
insert into public.cliente (id, tenant_id, nombre) values
  ('68900000-0000-4000-8000-0000000000a2', '68900000-0000-4000-8000-0000000000a1', 'Cliente A'),
  ('68900000-0000-4000-8000-0000000000b2', '68900000-0000-4000-8000-0000000000b1', 'Cliente B');
insert into public.vigia_contacto (id, tenant_id, cliente_id, telefono, telefono_hash, nombre, consentimiento_en, consentimiento_origen) values
  ('68900000-0000-4000-8000-0000000000d1', '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000000a2', '525568900001', repeat('a', 64), 'Compras A', now(), 'alta_flota'),
  ('68900000-0000-4000-8000-0000000000d2', '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000000a2', '525568900002', repeat('c', 64), 'Compras A2', now(), 'alta_flota'),
  ('68900000-0000-4000-8000-0000000000d3', '68900000-0000-4000-8000-0000000000b1', '68900000-0000-4000-8000-0000000000b2', '525568900003', repeat('b', 64), 'Compras B', now(), 'alta_flota');
-- La flota B retiene solo 30 días.
insert into public.vigia_config (tenant_id, habilitado, retencion_dias) values ('68900000-0000-4000-8000-0000000000b1', true, 30);

-- (a) el índice y la FK
do $$
declare plan text := ''; r record;
begin
  if not exists (select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
                  where c.relname = 'vigia_mensaje_respuesta_a_idx' and c.relnamespace = 'public'::regnamespace and i.indisvalid and i.indisready) then
    raise exception '0689(a): falta vigia_mensaje_respuesta_a_idx';
  end if;
  if not exists (select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
                  where c.relname = 'vigia_conversacion_cerrada_idx' and c.relnamespace = 'public'::regnamespace and i.indisvalid and i.indisready) then
    raise exception '0689(a): falta vigia_conversacion_cerrada_idx';
  end if;
  -- Lo que hace el trigger de la FK al borrar un mensaje (ON DELETE SET NULL): buscar quién lo cita.
  set local enable_seqscan = off;
  for r in execute 'explain update only public.vigia_mensaje set respuesta_a = null where respuesta_a = ''68900000-0000-4000-8000-0000000000ee''::uuid and tenant_id = ''68900000-0000-4000-8000-0000000000a1''::uuid' loop
    plan := plan || (r."QUERY PLAN") || E'\n';
  end loop;
  if plan !~ 'vigia_mensaje_respuesta_a_idx' then
    raise exception '0689(a): la búsqueda de la FK respuesta_a no puede usar el índice (cada borrado sería un Seq Scan): %', plan;
  end if;
end $$;

-- (b) EL TOPE: 3,000 conversaciones cerradas hace 100 días y sin un solo mensaje.
insert into public.vigia_conversacion (id, tenant_id, contacto_id, cliente_id, estado, cerrada_en)
select md5('0689-conv-vacia-' || i)::uuid, '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000000d1',
       '68900000-0000-4000-8000-0000000000a2', 'cerrada', now() - interval '100 days' - make_interval(secs => i)
  from generate_series(1, 3000) i;
do $$
declare n int; restantes int;
begin
  n := public.vigia_purgar(100);
  if n <> 100 then raise exception '0689(b): vigia_purgar(100) debía borrar exactamente 100 y borró %', n; end if;
  select count(*) into restantes from public.vigia_conversacion where id in (select md5('0689-conv-vacia-' || i)::uuid from generate_series(1, 3000) i);
  if restantes <> 2900 then raise exception '0689(b): quedaban 2900 conversaciones vacías y hay % (el borrado no tiene tope)', restantes; end if;
  -- el tope vale también para el total de la pasada, no solo por mitad
  n := public.vigia_purgar(1);
  if n <> 1 then raise exception '0689(b): vigia_purgar(1) debía borrar exactamente 1 y borró %', n; end if;
end $$;
-- vaciar el resto de ese lote para dejar el escenario (c) limpio
do $$ declare n int; i int := 0;
begin
  loop
    n := public.vigia_purgar(1000); i := i + 1;
    exit when n = 0 or i > 20;
  end loop;
  if exists (select 1 from public.vigia_conversacion where id in (select md5('0689-conv-vacia-' || g)::uuid from generate_series(1, 3000) g)) then
    raise exception '0689(b): repetir la purga no terminó de borrar las conversaciones vacías';
  end if;
end $$;

-- (c)+(d) escenario con mensajes y conversaciones que NO deben tocarse
-- 8 conversaciones cerradas hace 60 días con 150 mensajes de hace 200 días cada una (1,200 mensajes vencidos de A),
-- 20 respuestas del agente por conversación que CITAN al mensaje (respuesta_a): la FK que sin índice era lenta.
insert into public.vigia_conversacion (id, tenant_id, contacto_id, cliente_id, estado, cerrada_en)
select md5('0689-conv-vieja-' || c)::uuid, '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000000d1',
       '68900000-0000-4000-8000-0000000000a2', 'cerrada', now() - interval '60 days'
  from generate_series(1, 8) c;
insert into public.vigia_mensaje (id, tenant_id, conversacion_id, direccion, autor, texto, estado, created_at)
select md5('0689-msg-' || c || '-' || m)::uuid, '68900000-0000-4000-8000-0000000000a1', md5('0689-conv-vieja-' || c)::uuid,
       'entrante', 'cliente', 'viejo', 'recibido', now() - interval '200 days' + make_interval(secs => m)
  from generate_series(1, 8) c, generate_series(1, 150) m;
insert into public.vigia_mensaje (id, tenant_id, conversacion_id, direccion, autor, texto, estado, respuesta_a, created_at)
select md5('0689-resp-' || c || '-' || m)::uuid, '68900000-0000-4000-8000-0000000000a1', md5('0689-conv-vieja-' || c)::uuid,
       'saliente', 'agente', 'respuesta vieja', 'borrador', md5('0689-msg-' || c || '-' || m)::uuid, now() - interval '200 days' + make_interval(secs => m + 1000)
  from generate_series(1, 8) c, generate_series(1, 20) m;

-- LO QUE NO SE DEBE BORRAR:
--  K1 conversación cerrada hace 60 días CON un mensaje de hace 10 días (se queda con su mensaje vivo; sus viejos sí se van)
--  K2 conversación cerrada hace 10 días y vacía (aún no cumple los 30 días)
--  K3 conversación ACTIVA y vacía (otro contacto): una activa no se purga aunque no tenga mensajes
--  K4 mensaje de A de hace 100 días (dentro de sus 180 de retención) en una conversación cerrada hace 60 días
--  K5 flota B: mensaje de hace 10 días (dentro de sus 30) y conversación cerrada hace 60 días que lo conserva
insert into public.vigia_conversacion (id, tenant_id, contacto_id, cliente_id, estado, cerrada_en) values
  ('68900000-0000-4000-8000-0000000001a1', '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000000d1', '68900000-0000-4000-8000-0000000000a2', 'cerrada', now() - interval '60 days'),
  ('68900000-0000-4000-8000-0000000001a2', '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000000d1', '68900000-0000-4000-8000-0000000000a2', 'cerrada', now() - interval '10 days'),
  ('68900000-0000-4000-8000-0000000001a3', '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000000d2', '68900000-0000-4000-8000-0000000000a2', 'activa', null),
  ('68900000-0000-4000-8000-0000000001a4', '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000000d1', '68900000-0000-4000-8000-0000000000a2', 'cerrada', now() - interval '60 days'),
  ('68900000-0000-4000-8000-0000000001b1', '68900000-0000-4000-8000-0000000000b1', '68900000-0000-4000-8000-0000000000d3', '68900000-0000-4000-8000-0000000000b2', 'cerrada', now() - interval '60 days'),
  ('68900000-0000-4000-8000-0000000001b2', '68900000-0000-4000-8000-0000000000b1', '68900000-0000-4000-8000-0000000000d3', '68900000-0000-4000-8000-0000000000b2', 'cerrada', now() - interval '60 days');
insert into public.vigia_mensaje (id, tenant_id, conversacion_id, direccion, autor, texto, estado, created_at) values
  ('68900000-0000-4000-8000-0000000002a1', '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000001a1', 'entrante', 'cliente', 'vivo K1', 'recibido', now() - interval '10 days'),
  ('68900000-0000-4000-8000-0000000002a2', '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000001a1', 'entrante', 'cliente', 'viejo de K1', 'recibido', now() - interval '200 days'),
  ('68900000-0000-4000-8000-0000000002a4', '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000001a4', 'entrante', 'cliente', 'medio K4', 'recibido', now() - interval '100 days'),
  ('68900000-0000-4000-8000-0000000002b1', '68900000-0000-4000-8000-0000000000b1', '68900000-0000-4000-8000-0000000001b1', 'entrante', 'cliente', 'vivo B', 'recibido', now() - interval '10 days'),
  ('68900000-0000-4000-8000-0000000002b2', '68900000-0000-4000-8000-0000000000b1', '68900000-0000-4000-8000-0000000001b1', 'entrante', 'cliente', 'viejo B (40 d, retención 30)', 'recibido', now() - interval '40 days');
-- una respuesta del agente que cita a un mensaje que SE QUEDA: su respuesta_a no debe cambiar
insert into public.vigia_mensaje (id, tenant_id, conversacion_id, direccion, autor, texto, estado, respuesta_a, created_at) values
  ('68900000-0000-4000-8000-0000000002a5', '68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000001a1', 'saliente', 'agente', 'respuesta K1', 'borrador', '68900000-0000-4000-8000-0000000002a1', now() - interval '9 days');
-- eventos de bitácora: de una conversación que se queda y de una que se va
insert into public.vigia_evento (tenant_id, conversacion_id, tipo) values
  ('68900000-0000-4000-8000-0000000000a1', '68900000-0000-4000-8000-0000000001a1', 'cerrada'),
  ('68900000-0000-4000-8000-0000000000a1', md5('0689-conv-vieja-1')::uuid, 'cerrada');

do $$
declare n int; total int := 0; pasadas int := 0; antes int; despues int;
begin
  loop
    select count(*) into antes from public.vigia_mensaje where tenant_id::text like '68900000-%';
    n := public.vigia_purgar(500);
    select count(*) into despues from public.vigia_mensaje where tenant_id::text like '68900000-%';
    if n > 500 then raise exception '0689(d): una pasada borró % filas con límite 500', n; end if;
    if antes - despues > 500 then raise exception '0689(d): una pasada borró % mensajes con límite 500', antes - despues; end if;
    total := total + n; pasadas := pasadas + 1;
    exit when n = 0 or pasadas > 30;
  end loop;
  -- 1,200 viejos + 160 respuestas viejas + viejo K1 + viejo B = 1,362 mensajes; 7 conversaciones vacías de las 8 (la 1 se
  -- fue con su bitácora) -> todas 8 + ... lo importante son las aserciones de abajo
  if pasadas < 4 then raise exception '0689(d): con 1,362 mensajes vencidos y límite 500 se esperaban ≥ 4 pasadas y hubo %', pasadas; end if;

  -- (d) todo lo vencido se fue
  if exists (select 1 from public.vigia_mensaje where texto in ('viejo', 'respuesta vieja', 'viejo de K1', 'viejo B (40 d, retención 30)')) then
    raise exception '0689(d): quedaron mensajes vencidos tras repetir la purga';
  end if;
  if exists (select 1 from public.vigia_conversacion where id in (select md5('0689-conv-vieja-' || c)::uuid from generate_series(1, 8) c)) then
    raise exception '0689(d): quedaron conversaciones cerradas vacías de más de 30 días';
  end if;
  if exists (select 1 from public.vigia_evento where conversacion_id = md5('0689-conv-vieja-1')::uuid) then
    raise exception '0689(d): la bitácora de la conversación purgada quedó huérfana';
  end if;

  -- (c) NUNCA lo que no debe
  if not exists (select 1 from public.vigia_mensaje where id = '68900000-0000-4000-8000-0000000002a1') then raise exception '0689(c): borró un mensaje de hace 10 días'; end if;
  if not exists (select 1 from public.vigia_mensaje where id = '68900000-0000-4000-8000-0000000002a4') then raise exception '0689(c): borró un mensaje de A de hace 100 días (retención 180)'; end if;
  if not exists (select 1 from public.vigia_mensaje where id = '68900000-0000-4000-8000-0000000002b1') then raise exception '0689(c): borró un mensaje de la flota B dentro de sus 30 días'; end if;
  if not exists (select 1 from public.vigia_mensaje where id = '68900000-0000-4000-8000-0000000002a5' and respuesta_a = '68900000-0000-4000-8000-0000000002a1') then
    raise exception '0689(c): la respuesta que cita a un mensaje vivo cambió o se borró';
  end if;
  if not exists (select 1 from public.vigia_conversacion where id = '68900000-0000-4000-8000-0000000001a1') then raise exception '0689(c): borró una conversación cerrada que conserva un mensaje vivo'; end if;
  if not exists (select 1 from public.vigia_conversacion where id = '68900000-0000-4000-8000-0000000001a2') then raise exception '0689(c): borró una conversación cerrada hace 10 días'; end if;
  if not exists (select 1 from public.vigia_conversacion where id = '68900000-0000-4000-8000-0000000001a3') then raise exception '0689(c): borró una conversación ACTIVA vacía'; end if;
  if not exists (select 1 from public.vigia_conversacion where id = '68900000-0000-4000-8000-0000000001a4') then raise exception '0689(c): borró una conversación con un mensaje dentro de su retención'; end if;
  if not exists (select 1 from public.vigia_conversacion where id = '68900000-0000-4000-8000-0000000001b1') then raise exception '0689(c): borró la conversación de B que conserva su mensaje'; end if;
  if not exists (select 1 from public.vigia_evento where conversacion_id = '68900000-0000-4000-8000-0000000001a1') then raise exception '0689(c): borró la bitácora de una conversación que se queda'; end if;
  -- B1-2: conversación vacía cerrada hace 60 días de B SÍ se va (b2) — control de que la regla de 30 días corre en las dos flotas
  if exists (select 1 from public.vigia_conversacion where id = '68900000-0000-4000-8000-0000000001b2') then raise exception '0689(d): quedó la conversación vacía de B cerrada hace 60 días'; end if;
  -- el límite sigue validado
  begin perform public.vigia_purgar(0); raise exception '0689: la purga aceptó límite 0';
  exception when raise_exception then if sqlerrm like '0689:%' then raise; end if; end;
end $$;

rollback;
