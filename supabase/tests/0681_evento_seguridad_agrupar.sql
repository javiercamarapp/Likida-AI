\set ON_ERROR_STOP on
-- 0681 — FLOOD DE evento_seguridad contra Postgres REAL (sintético, rollback).
-- Lo que solo la base garantiza:
--   (a) la misma señal en la misma ventana es UNA fila con `repeticiones` y `ultimo_en`; la primera fila conserva su detalle;
--   (b) otra ventana, otro actor, otra severidad u otra flota son filas distintas;
--   (c) el tope de filas distintas por (origen, tipo, severidad) y ventana manda el excedente a UNA fila de desborde
--       (sin actor, `detalle.desborde`), que cuenta todo lo que cayó ahí: no se pierde ningún evento, solo se agrupa;
--   (d) LO CRÍTICO NO SE DESCARTA: una ráfaga de `alta` queda como una fila con su conteo exacto, y el desborde de alta
--       también cuenta; la suma de repeticiones iguala SIEMPRE a los eventos registrados;
--   (e) los CHECK de origen/tipo de la 0133 siguen mordiendo; solo service_role ejecuta;
--   (f) el índice único parcial no estorba a las filas anteriores a la 0681 (clave null).
begin;

insert into public.tenant (id, nombre) values ('68100000-0000-4000-8000-0000000000a1', 'Flota A 0681');

set local role service_role;

do $$
declare r text; f record; i integer; total integer;
  t0 timestamptz := timestamptz '2026-10-02 12:00:30+00';  -- dentro de una cubeta de 10 min y de 60 s
begin
  -- (a) misma señal, misma ventana
  r := public.registrar_evento_seguridad('wa_webhook', 'firma_invalida', 'media', null, '5215500000001', '{"n":1}', t0);
  if r <> 'nuevo' then raise exception '0681(a): la primera debía ser nuevo y fue %', r; end if;
  for i in 1..49 loop
    r := public.registrar_evento_seguridad('wa_webhook', 'firma_invalida', 'media', null, '5215500000001', '{"n":2}', t0 + make_interval(secs => i));
    if r <> 'agrupado' then raise exception '0681(a): la repetición % debía agruparse y fue %', i, r; end if;
  end loop;
  select * into f from public.evento_seguridad where actor = '5215500000001';
  if f.repeticiones <> 50 or f.ultimo_en <> t0 + interval '49 seconds' or f.detalle <> '{"n":1}'::jsonb then
    raise exception '0681(a): fila agrupada mal: % % %', f.repeticiones, f.ultimo_en, f.detalle;
  end if;
  if (select count(*) from public.evento_seguridad where actor = '5215500000001') <> 1 then raise exception '0681(a): se abrieron filas de más'; end if;

  -- (b) otra ventana / actor / severidad / flota = otra fila
  perform public.registrar_evento_seguridad('wa_webhook', 'firma_invalida', 'media', null, '5215500000001', null, t0 + interval '11 minutes');
  perform public.registrar_evento_seguridad('wa_webhook', 'firma_invalida', 'media', null, '5215500000002', null, t0);
  perform public.registrar_evento_seguridad('wa_webhook', 'firma_invalida', 'alta',  null, '5215500000001', null, t0);
  perform public.registrar_evento_seguridad('wa_webhook', 'firma_invalida', 'media', '68100000-0000-4000-8000-0000000000a1', '5215500000001', null, t0);
  if (select count(*) from public.evento_seguridad where actor in ('5215500000001', '5215500000002')) <> 5 then raise exception '0681(b): se esperaban 5 filas'; end if;

  -- (c) tope de 100 distintas (media) por (origen, tipo, severidad) y ventana; el resto cae en UN desborde
  delete from public.evento_seguridad;
  for i in 1..250 loop
    perform public.registrar_evento_seguridad('stripe_webhook', 'firma_invalida', 'media', null, 'rota-' || i, null, t0);
  end loop;
  select count(*) into total from public.evento_seguridad where origen = 'stripe_webhook' and coalesce((detalle->>'desborde')::boolean, false) = false;
  if total <> 100 then raise exception '0681(c): se esperaban 100 filas distintas y fueron %', total; end if;
  select * into f from public.evento_seguridad where origen = 'stripe_webhook' and coalesce((detalle->>'desborde')::boolean, false);
  if f.repeticiones <> 150 or f.actor is not null or f.tenant_id is not null then raise exception '0681(c): desborde mal: % % %', f.repeticiones, f.actor, f.tenant_id; end if;
  select sum(repeticiones) into total from public.evento_seguridad where origen = 'stripe_webhook';
  if total <> 250 then raise exception '0681(c): se perdieron eventos: la suma es % y se registraron 250', total; end if;
  -- una señal que YA tenía fila en la ventana sigue agrupándose aunque ya se haya pasado el tope
  r := public.registrar_evento_seguridad('stripe_webhook', 'firma_invalida', 'media', null, 'rota-1', null, t0);
  if r <> 'agrupado' then raise exception '0681(c): una señal existente debía agruparse y fue %', r; end if;

  -- (d) lo crítico no se descarta: 700 alta de la misma señal = 1 fila con 700; 700 alta con actores rotando = 500 + desborde de 200
  delete from public.evento_seguridad;
  for i in 1..700 loop perform public.registrar_evento_seguridad('api_v1', 'acceso_denegado', 'alta', null, 'misma', null, t0); end loop;
  select * into f from public.evento_seguridad where actor = 'misma';
  if f.repeticiones <> 700 or f.severidad <> 'alta' then raise exception '0681(d): la ráfaga de alta no quedó contada: %', f.repeticiones; end if;
  delete from public.evento_seguridad;
  for i in 1..700 loop perform public.registrar_evento_seguridad('api_v1', 'acceso_denegado', 'alta', null, 'a-' || i, null, t0); end loop;
  select count(*) into total from public.evento_seguridad where coalesce((detalle->>'desborde')::boolean, false) = false;
  if total <> 500 then raise exception '0681(d): se esperaban 500 filas distintas de alta y fueron %', total; end if;
  select sum(repeticiones) into total from public.evento_seguridad;
  if total <> 700 then raise exception '0681(d): se perdió una alta: suma % de 700', total; end if;
  if (select severidad from public.evento_seguridad where coalesce((detalle->>'desborde')::boolean, false)) <> 'alta' then raise exception '0681(d): el desborde de alta perdió su severidad'; end if;

  -- (e) los CHECK de la 0133 siguen mordiendo
  begin perform public.registrar_evento_seguridad('origen_inventado', 'firma_invalida', 'media', null, null, null, t0); raise exception '0681(e): aceptó un origen inventado'; exception when check_violation then null; end;
  begin perform public.registrar_evento_seguridad('wa_webhook', 'tipo_inventado', 'media', null, null, null, t0); raise exception '0681(e): aceptó un tipo inventado'; exception when check_violation then null; end;
  begin perform public.registrar_evento_seguridad('wa_webhook', 'firma_invalida', 'critica', null, null, null, t0); raise exception '0681(e): aceptó una severidad inventada'; exception when check_violation then null; end;

  -- el actor se recorta a 120 caracteres
  perform public.registrar_evento_seguridad('chat', 'rate_limit', 'info', null, repeat('x', 300), null, t0);
  if (select length(actor) from public.evento_seguridad where origen = 'chat') <> 120 then raise exception '0681: el actor no se recortó a 120'; end if;
end $$;

-- (f) filas anteriores a la 0681 (sin clave) conviven: dos con clave null no chocan en el índice único parcial
reset role;
insert into public.evento_seguridad (origen, tipo, severidad, actor) values ('otro', 'otro', 'info', 'legada-1'), ('otro', 'otro', 'info', 'legada-1');
do $$ begin
  if (select count(*) from public.evento_seguridad where actor = 'legada-1') <> 2 then raise exception '0681(f): las filas legadas chocaron'; end if;
  if (select min(repeticiones) from public.evento_seguridad where actor = 'legada-1') <> 1 then raise exception '0681(f): repeticiones debía nacer en 1'; end if;
end $$;

-- (e2) permisos
set local role authenticated;
do $$ begin
  begin perform public.registrar_evento_seguridad('wa_webhook', 'firma_invalida'); raise exception '0681: authenticated ejecutó la RPC'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin perform public.registrar_evento_seguridad('wa_webhook', 'firma_invalida'); raise exception '0681: anon ejecutó la RPC'; exception when insufficient_privilege then null; end;
end $$;

rollback;
