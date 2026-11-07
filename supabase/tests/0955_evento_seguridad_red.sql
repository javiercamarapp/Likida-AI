\set ON_ERROR_STOP on
-- 0954/0955 — evento_seguridad con huella de red, tope por huella, reclamo de avisos y anonimización, contra Postgres REAL, rollback.
begin;
do $$
declare
  t0 timestamptz := date_trunc('hour', now()) + interval '5 minutes';
  h1 constant text := repeat('a', 32);
  h2 constant text := repeat('b', 32);
  i int; n int; r text; f record; rol_ok boolean;
begin
  -- ── tipos nuevos aceptados; uno inventado rebota ───────────────────────────
  perform public.registrar_evento_seguridad_red('auth', 'login_fallido', 'media', null, 'x@y.mx', '{"motivo":"limite"}'::jsonb, h1, 'Mozilla/5.0', t0);
  perform public.registrar_evento_seguridad_red('api_v1', 'llave_invalida', 'media', null, null, null, h1, null, t0);
  perform public.registrar_evento_seguridad_red('api_v1', 'api_negada', 'media', null, null, null, null, null, t0);
  perform public.registrar_evento_seguridad_red('export', 'exporte_dinero', 'info', null, null, null, null, null, t0);
  perform public.registrar_evento_seguridad_red('auth', 'cambio_rol', 'alta', null, 'u1', null, null, null, t0);
  begin
    perform public.registrar_evento_seguridad_red('auth', 'chisme-de-pasillo', 'media', null, null, null, null, null, t0);
    raise exception '0955: un tipo inventado debia rebotar por el check';
  exception when check_violation then null; end;

  -- ── huella y ua se guardan; una huella mal formada y un ua sucio se limpian ─
  select ip_hash, ua into f from public.evento_seguridad where tipo = 'login_fallido' and actor = 'x@y.mx';
  if f.ip_hash <> h1 or f.ua <> 'Mozilla/5.0' then raise exception '0955: no guardo huella/ua: % / %', f.ip_hash, f.ua; end if;
  perform public.registrar_evento_seguridad_red('auth', 'login_fallido', 'media', null, 'sucio', null, 'NO-ES-HEX', E'a\x01b\nc', t0);
  select ip_hash, ua into f from public.evento_seguridad where tipo = 'login_fallido' and actor = 'sucio';
  if f.ip_hash is not null then raise exception '0955: una huella mal formada no debia guardarse'; end if;
  if f.ua <> 'abc' then raise exception '0955: el ua debia perder los caracteres de control, quedo %', f.ua; end if;

  -- ── agrupa la misma señal ──────────────────────────────────────────────────
  r := public.registrar_evento_seguridad_red('auth', 'login_fallido', 'media', null, 'x@y.mx', null, h1, null, t0 + interval '1 second');
  if r <> 'agrupado' then raise exception '0955: la misma señal debia agruparse, dio %', r; end if;

  -- ── tope POR HUELLA: 20 distintos de una misma red; el resto cuenta en el desborde sin huella ni actor ─
  for i in 1..30 loop
    perform public.registrar_evento_seguridad_red('ratelimit', 'rate_limit', 'media', null, 'rota-' || i, null, h2, 'ua', t0);
  end loop;
  select count(*) into n from public.evento_seguridad where origen = 'ratelimit' and tipo = 'rate_limit' and (detalle->>'desborde') is distinct from 'true';
  if n <> 20 then raise exception '0955: esperaba 20 filas por huella, hay %', n; end if;
  select repeticiones, ip_hash, actor into f from public.evento_seguridad where origen = 'ratelimit' and tipo = 'rate_limit' and (detalle->>'desborde') = 'true';
  if f.repeticiones <> 10 or f.ip_hash is not null or f.actor is not null then
    raise exception '0955: el desborde debia contar 10 sin huella ni actor: % / % / %', f.repeticiones, f.ip_hash, f.actor;
  end if;
  -- Otra red NO se ve afectada por el tope de la primera.
  r := public.registrar_evento_seguridad_red('ratelimit', 'rate_limit', 'media', null, 'otro-actor', null, h1, null, t0);
  if r <> 'nuevo' then raise exception '0955: otra huella debia seguir entrando, dio %', r; end if;

  -- ── ataque: 5 redes x 25 actores llenan el tope general (5 x 20 = 100); el siguiente evento legitimo NO queda ciego ─
  for i in 1..125 loop
    perform public.registrar_evento_seguridad_red('chat', 'login_fallido', 'media', null, 'v-' || i, null, repeat((i % 5)::text, 32), null, t0);
  end loop;
  r := public.registrar_evento_seguridad_red('chat', 'login_fallido', 'media', null, 'cuenta-legitima', null, repeat('c', 32), 'ua', t0);
  if r <> 'nuevo' then raise exception '0955: tras la inundacion el evento legitimo debia entrar con detalle, dio %', r; end if;
  select count(*) into n from public.evento_seguridad where origen = 'chat' and (detalle->>'desborde') is distinct from 'true';
  if n > 200 then raise exception '0955: el almacenamiento debia seguir acotado a 200, hay %', n; end if;

  -- ── lo alta jamás se descarta: la suma de repeticiones iguala los intentos ─
  for i in 1..30 loop
    perform public.registrar_evento_seguridad_red('stripe_webhook', 'firma_invalida', 'alta', null, 'a-' || i, null, h2, null, t0);
  end loop;
  select sum(repeticiones) into n from public.evento_seguridad where origen = 'stripe_webhook' and tipo = 'firma_invalida';
  if n <> 30 then raise exception '0955: lo alta no debia perderse: suma %', n; end if;

  -- ── reclamo de avisos ──────────────────────────────────────────────────────
  -- Aun no madura (ultimo_en = t0+0s, ahora = t0+10s): no se reclama.
  select count(*) into n from public.reclamar_avisos_seguridad(3, 50, interval '24 hours', interval '1 hour', interval '60 seconds', t0 + interval '10 seconds');
  if n <> 0 then raise exception '0955: nada debia reclamarse antes de madurar, se reclamaron %', n; end if;
  -- Madura: reclama las altas de esta prueba (cambio_rol + 21 filas de firma_invalida + 1 desborde = 23 con 20 + desborde... se cuenta abajo).
  select count(*) into n from public.reclamar_avisos_seguridad(3, 50, interval '24 hours', interval '1 hour', interval '60 seconds', t0 + interval '2 minutes');
  if n < 2 then raise exception '0955: debia reclamar las filas alta maduras, reclamo %', n; end if;
  -- Reclamarlas otra vez de inmediato no devuelve nada (espera de 1 h y sin repeticiones nuevas).
  select count(*) into n from public.reclamar_avisos_seguridad(3, 50, interval '24 hours', interval '1 hour', interval '60 seconds', t0 + interval '2 minutes');
  if n <> 0 then raise exception '0955: un incidente ya avisado no debia reclamarse de nuevo, se reclamaron %', n; end if;
  -- Repeticion nueva + pasada 1 h: segundo aviso. Otra repeticion + 1 h: tercero. Otra: NO hay cuarto (tope 3).
  perform public.registrar_evento_seguridad_red('auth', 'cambio_rol', 'alta', null, 'u1', null, null, null, t0 + interval '30 seconds');
  select count(*) into n from public.reclamar_avisos_seguridad(3, 50, interval '24 hours', interval '1 hour', interval '60 seconds', t0 + interval '3 hours');
  if n <> 1 then raise exception '0955: el segundo aviso debia salir tras 1 h con repeticion nueva, salieron %', n; end if;
  perform public.registrar_evento_seguridad_red('auth', 'cambio_rol', 'alta', null, 'u1', null, null, null, t0 + interval '40 seconds');
  select count(*) into n from public.reclamar_avisos_seguridad(3, 50, interval '24 hours', interval '1 hour', interval '60 seconds', t0 + interval '5 hours');
  if n <> 1 then raise exception '0955: el tercer aviso debia salir, salieron %', n; end if;
  perform public.registrar_evento_seguridad_red('auth', 'cambio_rol', 'alta', null, 'u1', null, null, null, t0 + interval '50 seconds');
  select count(*) into n from public.reclamar_avisos_seguridad(3, 50, interval '24 hours', interval '1 hour', interval '60 seconds', t0 + interval '7 hours');
  if n <> 0 then raise exception '0955: nunca mas de 3 avisos por incidente, salio un cuarto'; end if;
  select avisos_enviados into n from public.evento_seguridad where tipo = 'cambio_rol';
  if n <> 3 then raise exception '0955: avisos_enviados debia quedar en 3, quedo %', n; end if;
  -- Lo viejo (fuera de la ventana de 24 h) jamas se avisa.
  perform public.registrar_evento_seguridad_red('wa_webhook', 'firma_invalida', 'alta', null, 'viejo', null, null, null, t0 - interval '3 days');
  select count(*) into n from public.reclamar_avisos_seguridad(3, 50, interval '24 hours', interval '1 hour', interval '60 seconds', t0 + interval '2 minutes')
   where origen = 'wa_webhook';
  if n <> 0 then raise exception '0955: el historico fuera de ventana no debia avisarse'; end if;

  -- ── anonimizacion de la red ────────────────────────────────────────────────
  begin
    perform public.anonimizar_red_evento_seguridad(3, now(), 100);
    raise exception '0955: un plazo menor a 7 dias debia rechazarse';
  exception when raise_exception then
    if sqlerrm like '0955:%' then raise; end if;
  end;
  select public.anonimizar_red_evento_seguridad(30, t0 + interval '40 days', 5000) into n;
  if n < 1 then raise exception '0955: debia anonimizar filas con huella, anonimizo %', n; end if;
  if exists (select 1 from public.evento_seguridad where ip_hash is not null or ua is not null) then
    raise exception '0955: no debia quedar huella ni ua tras anonimizar a 30 dias';
  end if;
  if not exists (select 1 from public.evento_seguridad where tipo = 'login_fallido' and actor = 'x@y.mx') then
    raise exception '0955: anonimizar la red no debe borrar la fila del evento';
  end if;

  -- ── permisos: solo service_role ejecuta ────────────────────────────────────
  select not has_function_privilege('anon', 'public.registrar_evento_seguridad_red(text,text,text,uuid,text,jsonb,text,text,timestamptz)', 'execute')
     and not has_function_privilege('authenticated', 'public.reclamar_avisos_seguridad(integer,integer,interval,interval,interval,timestamptz)', 'execute')
     and not has_function_privilege('authenticated', 'public.anonimizar_red_evento_seguridad(integer,timestamptz,integer)', 'execute')
    into rol_ok;
  if not rol_ok then raise exception '0955: anon/authenticated no deben ejecutar las funciones'; end if;
end $$;
rollback;
