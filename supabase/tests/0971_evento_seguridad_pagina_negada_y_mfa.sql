\set ON_ERROR_STOP on
-- 0971 (CT-SEG-11) — evento_seguridad acepta pagina_negada y mfa_fallido (y sigue rebotando un tipo inventado). Datos sintéticos, rollback.
begin;
do $$
declare t0 timestamptz := date_trunc('hour', now()) + interval '7 minutes'; n int;
begin
  perform public.registrar_evento_seguridad_red('auth', 'pagina_negada', 'info', null, 'u-0971', '{"ruta":"/dashboard/x","rol":"encargado"}'::jsonb, null, null, t0);
  perform public.registrar_evento_seguridad_red('auth', 'mfa_fallido', 'media', null, 'u-0971', '{"veredicto":"sin_factor"}'::jsonb, null, null, t0);
  select count(*) into n from public.evento_seguridad where origen = 'auth' and tipo in ('pagina_negada', 'mfa_fallido') and actor = 'u-0971';
  if n <> 2 then raise exception '0971: esperaba 2 filas con los tipos nuevos, hay %', n; end if;
  begin
    perform public.registrar_evento_seguridad_red('auth', 'chisme-de-pasillo', 'media', null, null, null, null, null, t0);
    raise exception '0971: un tipo inventado debia rebotar por el check';
  exception when check_violation then null; end;
  -- los tipos viejos siguen valiendo
  perform public.registrar_evento_seguridad_red('auth', 'login_fallido', 'media', null, 'u-0971b', null, null, null, t0);
  perform public.registrar_evento_seguridad_red('correo_webhook', 'firma_invalida', 'media', null, null, '{"motivo":"firma"}'::jsonb, null, null, t0);
  perform public.registrar_evento_seguridad_red('ratelimit', 'rate_limit', 'info', null, null, '{"categoria":"lead"}'::jsonb, null, null, t0);
end $$;
rollback;
