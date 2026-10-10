\set ON_ERROR_STOP on
-- 0676 — CARTA PORTE: los `procesando` zombi (M3, ronda 15) contra Postgres REAL, datos sintéticos, rollback.
--
--   · solo un `procesando` con intentos >= 5 Y lease vencido pasa a `fallido` terminal (versión +1, sin lease, retención dada,
--     evento «extraccion_fallida», ultimo_error); lo vivo o con intentos de sobra no se toca; ni el reclamo ni la lista de
--     pendientes ni la de agotados lo veían antes (por eso era zombi) y DESPUÉS entra a `cp_documentos_agotados` (la oficina
--     se entera); la función es idempotente, valida rangos y es solo de service_role.
begin;

insert into public.tenant (id, nombre) values
  ('67600000-0000-4000-8000-0000000000a1', 'Flota A 0676'),
  ('67600000-0000-4000-8000-0000000000b1', 'Flota B 0676');

create function pg_temp.sha(t text) returns text language sql as $$ select encode(sha256(convert_to('0676-' || t, 'utf8')), 'hex') $$;

insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, version, intentos, procesando_hasta, storage_ruta)
values
  ('67600000-0000-4000-8000-0000000000d1', '67600000-0000-4000-8000-0000000000a1', 'correo', 'pdf_texto', 'zombi.pdf', 10, pg_temp.sha('z1'), 'procesando', 6, 5, now() - interval '10 minutes', 'ruta/z1'),
  ('67600000-0000-4000-8000-0000000000d2', '67600000-0000-4000-8000-0000000000a1', 'correo', 'pdf_texto', 'vivo.pdf', 10, pg_temp.sha('z2'), 'procesando', 6, 5, now() + interval '1 minute', 'ruta/z2'),
  ('67600000-0000-4000-8000-0000000000d3', '67600000-0000-4000-8000-0000000000a1', 'correo', 'pdf_texto', 'quedan-intentos.pdf', 10, pg_temp.sha('z3'), 'procesando', 6, 4, now() - interval '10 minutes', 'ruta/z3'),
  ('67600000-0000-4000-8000-0000000000d4', '67600000-0000-4000-8000-0000000000b1', 'correo', 'pdf_texto', 'zombi-b.pdf', 10, pg_temp.sha('z4'), 'procesando', 6, 5, now() - interval '10 minutes', 'ruta/z4');

do $$
declare
  cerrados int; d public.cp_documento%rowtype; hay boolean; otra int; cayo boolean;
begin
  -- Antes: ni el reclamo ni la lista de pendientes ni la de agotados lo ven (el zombi del hallazgo).
  if exists (select 1 from public.cp_documento_reclamar('67600000-0000-4000-8000-0000000000a1', '67600000-0000-4000-8000-0000000000d1')) then raise exception '0676: el reclamo no debía tomar un procesando con 5 intentos'; end if;
  if exists (select 1 from public.cp_documentos_pendientes(100) where id = '67600000-0000-4000-8000-0000000000d1') then raise exception '0676: pendientes no debía listar el zombi'; end if;
  if exists (select 1 from public.cp_documentos_agotados(100) where id = '67600000-0000-4000-8000-0000000000d1') then raise exception '0676: agotados no ve un procesando (por eso era zombi)'; end if;

  select count(*) into cerrados from public.cp_documentos_cerrar_zombis(50, 5, now() + interval '90 days');
  if cerrados <> 2 then raise exception '0676: debía cerrar los 2 zombis (de ambas flotas), cerró %', cerrados; end if;

  select * into d from public.cp_documento where id = '67600000-0000-4000-8000-0000000000d1';
  if d.estado <> 'fallido' or d.version <> 7 or d.procesando_hasta is not null or d.intentos <> 5 or d.ultimo_error is null
     or d.retener_hasta < now() + interval '89 days' then
    raise exception '0676: el zombi debía quedar fallido terminal con su error y retención: %', to_jsonb(d);
  end if;
  if (select count(*) from public.cp_documento_evento where documento_id = d.id and tipo = 'extraccion_fallida' and (detalle ->> 'permanente')::boolean and detalle ->> 'motivo' = 'lease_vencido_sin_intentos') <> 1 then
    raise exception '0676: falta el evento de cierre del zombi';
  end if;
  -- Lo vivo y lo que aún tiene intentos NO se toca.
  if (select estado from public.cp_documento where id = '67600000-0000-4000-8000-0000000000d2') <> 'procesando'
     or (select estado from public.cp_documento where id = '67600000-0000-4000-8000-0000000000d3') <> 'procesando' then
    raise exception '0676: un procesando con lease vivo o con intentos de sobra no es zombi';
  end if;
  -- Ya fallido y agotado: la oficina se entera.
  select exists (select 1 from public.cp_documentos_agotados(100) where id = d.id and tenant_id = d.tenant_id) into hay;
  if not hay then raise exception '0676: el zombi cerrado debía entrar a cp_documentos_agotados'; end if;
  -- Idempotente.
  select count(*) into otra from public.cp_documentos_cerrar_zombis(50, 5, null);
  if otra <> 0 then raise exception '0676: segunda corrida debía cerrar 0 (cerró %)', otra; end if;
  -- Rangos.
  cayo := false; begin perform public.cp_documentos_cerrar_zombis(0, 5, null); exception when others then cayo := true; end;
  if not cayo then raise exception '0676: p_limite 0 debía rebotar'; end if;
  cayo := false; begin perform public.cp_documentos_cerrar_zombis(10, 0, null); exception when others then cayo := true; end;
  if not cayo then raise exception '0676: p_max_intentos 0 debía rebotar'; end if;
end $$;

-- ── permisos ────────────────────────────────────────────────────────────────
do $$
declare firma text;
begin
  foreach firma in array array['public.cp_documentos_cerrar_zombis(int, int, timestamptz)'] loop
    if has_function_privilege('anon', firma, 'execute') or has_function_privilege('authenticated', firma, 'execute') or has_function_privilege('public', firma, 'execute') then
      raise exception '0676: % no debe ser ejecutable por anon/authenticated/public', firma;
    end if;
    if not has_function_privilege('service_role', firma, 'execute') then raise exception '0676: service_role debe ejecutar %', firma; end if;
  end loop;
end $$;

rollback;
