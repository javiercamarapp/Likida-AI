\set ON_ERROR_STOP on
-- 0640/0641/0642 — CARTA PORTE: el worker que procesa la bandeja.
--
-- Lo que SOLO la base demuestra, contra Postgres real y con datos sintéticos:
--
--   (a) `cp_documentos_pendientes` elige lo que toca: recibidos con gracia, lease vencido, fallidos con ESPERA
--       creciente según los intentos; NUNCA lo agotado, lo purgado, lo aprobado ni lo que otro tiene con lease vivo;
--   (b) el estado terminal: `cp_documentos_agotados` lista fallidos con los intentos agotados UNA vez
--       (el candado de aviso) y se puede soltar si el aviso no salió;
--   (c) `cp_documentos_por_avisar`: por revisar, con bloqueo o confianza baja, y una vez (desde la 0695, de CUALQUIER canal: correo, WhatsApp o panel);
--   (d) el candado de aviso no sube `version` ni `updated_at` (no estorba al revisor ni reinicia la espera),
--       es por flota y rechaza un tipo inventado;
--   (e) permisos: ninguna RPC del worker es ejecutable por anon/authenticated;
--   (f) 0642: cron_latido admite 'carta-porte-docs' sin perder los ids de antes; la bitácora admite los dos
--       eventos nuevos sin perder los de antes, y un id/tipo inventado sigue rebotando.
begin;

insert into public.tenant (id, nombre) values
  ('64000000-0000-4000-8000-0000000000a1', 'Flota A 0640'),
  ('64000000-0000-4000-8000-0000000000b1', 'Flota B 0640');

-- id, estado, creado hace, intentos, procesando_hasta, actualizado hace, storage
create temp table _docs (n int, id uuid, estado text, creado interval, intentos int, lease interval, actualizado interval, con_storage boolean) on commit drop;
insert into _docs values
  (1,  '64000000-0000-4000-8000-000000000001', 'recibido',   interval '10 minutes', 0, null,                  interval '10 minutes', true),   -- pendiente
  (2,  '64000000-0000-4000-8000-000000000002', 'recibido',   interval '10 seconds', 0, null,                  interval '10 seconds', true),   -- dentro de la gracia
  (3,  '64000000-0000-4000-8000-000000000003', 'procesando', interval '1 hour',     1, interval '-5 minutes', interval '1 hour',     true),   -- lease vencido: pendiente
  (4,  '64000000-0000-4000-8000-000000000004', 'procesando', interval '1 hour',     1, interval '5 minutes',  interval '1 minute',   true),   -- lease vivo: no
  (5,  '64000000-0000-4000-8000-000000000005', 'fallido',    interval '2 hours',    1, null,                  interval '20 minutes', true),   -- espera 15 min cumplida: pendiente
  (6,  '64000000-0000-4000-8000-000000000006', 'fallido',    interval '2 hours',    1, null,                  interval '5 minutes',  true),   -- espera sin cumplir: no
  (7,  '64000000-0000-4000-8000-000000000007', 'fallido',    interval '5 hours',    3, null,                  interval '30 minutes', true),   -- 3.º intento: espera 60 min, sin cumplir
  (8,  '64000000-0000-4000-8000-000000000008', 'fallido',    interval '5 hours',    3, null,                  interval '90 minutes', true),   -- 3.º intento con 90 min: pendiente
  (9,  '64000000-0000-4000-8000-000000000009', 'fallido',    interval '2 days',     5, null,                  interval '1 day',      true),   -- AGOTADO: terminal
  (10, '64000000-0000-4000-8000-00000000000a', 'aprobado',   interval '2 days',     1, null,                  interval '1 day',      true),   -- no
  (11, '64000000-0000-4000-8000-00000000000b', 'recibido',   interval '2 days',     0, null,                  interval '2 days',     false);  -- sin archivo (purgado): no

insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, intentos, procesando_hasta, storage_ruta, created_at, updated_at, aprobado_en, aprobado_por, purgado_en, texto_extracto)
select d.id, '64000000-0000-4000-8000-0000000000a1', 'correo', 'pdf_texto', 'doc-' || d.n || '.pdf', 100,
       encode(sha256(convert_to('0640-' || d.n, 'utf8')), 'hex'), d.estado, d.intentos,
       case when d.lease is null then null else now() + d.lease end,
       case when d.con_storage then 'ruta/' || d.n else null end,
       now() - d.creado, now() - d.actualizado,
       case when d.estado = 'aprobado' then now() else null end, null,
       case when d.con_storage then null else now() end, null
  from _docs d;

-- ── (a) pendientes ──────────────────────────────────────────────────────────
do $$
declare ids uuid[]; esperado uuid[] := array[
  '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000003',
  '64000000-0000-4000-8000-000000000005', '64000000-0000-4000-8000-000000000008']::uuid[];
begin
  select array_agg(id order by id) into ids from public.cp_documentos_pendientes(100, 5, 120);
  if ids is distinct from esperado then raise exception '0641: pendientes inesperados: % (esperado %)', ids, esperado; end if;
  -- El orden: recibidos primero, luego lease vencido, luego fallidos.
  select array_agg(id) into ids from public.cp_documentos_pendientes(100, 5, 120);
  if ids[1] <> '64000000-0000-4000-8000-000000000001' or ids[2] <> '64000000-0000-4000-8000-000000000003' then
    raise exception '0641: el orden de pendientes no pone recibidos y lease vencido primero: %', ids;
  end if;
  -- El tope de intentos viene por parámetro: con 3 el 8.º (3 intentos) queda agotado.
  select array_agg(id order by id) into ids from public.cp_documentos_pendientes(100, 3, 120);
  if '64000000-0000-4000-8000-000000000008'::uuid = any(ids) then raise exception '0641: p_max_intentos=3 no excluyó el de 3 intentos'; end if;
  -- El límite se respeta y un límite inválido rebota.
  if (select count(*) from public.cp_documentos_pendientes(2, 5, 120)) <> 2 then raise exception '0641: p_limite no se respetó'; end if;
  begin perform * from public.cp_documentos_pendientes(0); raise exception '0641: p_limite=0 debía rebotar';
  exception when raise_exception then if sqlerrm like '0641:%' then raise; end if; end;
  -- Sin gracia, el recibido de hace 10 segundos también entra.
  if not exists (select 1 from public.cp_documentos_pendientes(100, 5, 0) where id = '64000000-0000-4000-8000-000000000002') then
    raise exception '0641: con gracia 0 el recibido reciente debía entrar';
  end if;
end $$;

-- ── (b) agotados + candado de aviso ─────────────────────────────────────────
do $$
declare ag uuid[]; v0 int; u0 timestamptz; v1 int; u1 timestamptz;
begin
  select array_agg(id) into ag from public.cp_documentos_agotados(100, 5, 7);
  if ag is distinct from array['64000000-0000-4000-8000-000000000009']::uuid[] then raise exception '0641: agotados inesperados: %', ag; end if;

  select version, updated_at into v0, u0 from public.cp_documento where id = '64000000-0000-4000-8000-000000000009';
  if not public.cp_documento_reclamar_aviso('64000000-0000-4000-8000-0000000000a1', '64000000-0000-4000-8000-000000000009', 'agotado') then
    raise exception '0641: el primer reclamo de aviso debía ganar';
  end if;
  if public.cp_documento_reclamar_aviso('64000000-0000-4000-8000-0000000000a1', '64000000-0000-4000-8000-000000000009', 'agotado') then
    raise exception '0641: el segundo reclamo de aviso debía rebotar (una vez por documento y tipo)';
  end if;
  -- Otro tipo sí es otro candado.
  if not public.cp_documento_reclamar_aviso('64000000-0000-4000-8000-0000000000a1', '64000000-0000-4000-8000-000000000009', 'hallazgos') then
    raise exception '0641: el tipo hallazgos debía ser otro candado';
  end if;
  select version, updated_at into v1, u1 from public.cp_documento where id = '64000000-0000-4000-8000-000000000009';
  if v1 <> v0 or u1 <> u0 then raise exception '0641: el candado de aviso tocó version/updated_at (% -> %, % -> %)', v0, v1, u0, u1; end if;

  if exists (select 1 from public.cp_documentos_agotados(100, 5, 7)) then raise exception '0641: lo ya avisado volvió a listarse como agotado'; end if;

  -- Una flota ajena no reclama ni suelta el aviso de otra.
  if public.cp_documento_liberar_aviso('64000000-0000-4000-8000-0000000000b1', '64000000-0000-4000-8000-000000000009', 'agotado') then
    raise exception '0641: una flota ajena soltó el aviso';
  end if;
  if not public.cp_documento_liberar_aviso('64000000-0000-4000-8000-0000000000a1', '64000000-0000-4000-8000-000000000009', 'agotado') then
    raise exception '0641: soltar el aviso propio debía funcionar';
  end if;
  if public.cp_documento_liberar_aviso('64000000-0000-4000-8000-0000000000a1', '64000000-0000-4000-8000-000000000009', 'agotado') then
    raise exception '0641: soltar dos veces debía devolver false';
  end if;
  if not exists (select 1 from public.cp_documentos_agotados(100, 5, 7)) then raise exception '0641: lo soltado debía volver a listarse'; end if;
  -- Fuera de la ventana de días ya no se avisa.
  if exists (select 1 from public.cp_documentos_agotados(100, 5, 1) where id = '64000000-0000-4000-8000-000000000009') then
    raise exception '0641: lo agotado hace más de la ventana no debía listarse';
  end if;
  if public.cp_documento_reclamar_aviso('64000000-0000-4000-8000-0000000000b1', '64000000-0000-4000-8000-000000000009', 'agotado') then
    raise exception '0641: una flota ajena reclamó el aviso';
  end if;

  begin perform public.cp_documento_reclamar_aviso('64000000-0000-4000-8000-0000000000a1', '64000000-0000-4000-8000-000000000009', 'inventado');
        raise exception '0641: un tipo inventado debía rebotar';
  exception when raise_exception then if sqlerrm like '0641:%' then raise; end if; end;
end $$;

-- ── (c) por avisar ──────────────────────────────────────────────────────────
insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, storage_ruta, validacion, confianza_min)
select x.id::uuid, '64000000-0000-4000-8000-0000000000a1', x.canal, 'pdf_texto', 'por-avisar-' || x.n || '.pdf', 100,
       encode(sha256(convert_to('0640-avisar-' || x.n, 'utf8')), 'hex'), 'por_revisar', 'ruta/avisar/' || x.n, x.validacion::jsonb, x.conf
  from (values
    (1, '64000000-0000-4000-8000-0000000000c1', 'correo', '{"hallazgos":[],"bloqueos":1,"porConfirmar":0,"listoParaAprobar":false}', 0.95::numeric),   -- bloqueo
    (2, '64000000-0000-4000-8000-0000000000c2', 'correo', '{"hallazgos":[],"bloqueos":0,"porConfirmar":1,"listoParaAprobar":false}', 0.50::numeric),   -- confianza baja
    (3, '64000000-0000-4000-8000-0000000000c3', 'correo', '{"hallazgos":[],"bloqueos":0,"porConfirmar":0,"listoParaAprobar":true}',  0.99::numeric),   -- limpio
    (4, '64000000-0000-4000-8000-0000000000c4', 'manual', '{"hallazgos":[],"bloqueos":2,"porConfirmar":0,"listoParaAprobar":false}', 0.20::numeric)    -- del panel: desde la 0695 también se avisa
  ) as x(n, id, canal, validacion, conf);

do $$
declare ids uuid[];
begin
  select array_agg(id order by id) into ids from public.cp_documentos_por_avisar(100, 0.85, 3);
  if ids is distinct from array['64000000-0000-4000-8000-0000000000c1', '64000000-0000-4000-8000-0000000000c2', '64000000-0000-4000-8000-0000000000c4']::uuid[] then
    raise exception '0641: por_avisar inesperados: %', ids;
  end if;
  perform public.cp_documento_reclamar_aviso('64000000-0000-4000-8000-0000000000a1', '64000000-0000-4000-8000-0000000000c1', 'hallazgos');
  select array_agg(id) into ids from public.cp_documentos_por_avisar(100, 0.85, 3);
  if ids is distinct from array['64000000-0000-4000-8000-0000000000c2', '64000000-0000-4000-8000-0000000000c4']::uuid[] then raise exception '0641: lo ya avisado volvió a listarse: %', ids; end if;
  begin perform * from public.cp_documentos_por_avisar(10, 0, 3); raise exception '0641: umbral 0 debía rebotar';
  exception when raise_exception then if sqlerrm like '0641:%' then raise; end if; end;
end $$;

-- ── (e) permisos ────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.cp_documentos_pendientes(int,int,int)', 'public.cp_documentos_agotados(int,int,int)',
    'public.cp_documentos_por_avisar(int,numeric,int)', 'public.cp_documento_reclamar_aviso(uuid,uuid,text)',
    'public.cp_documento_liberar_aviso(uuid,uuid,text)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0641: % no debe ser ejecutable por anon/authenticated', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0641: % debe ser ejecutable por service_role', f;
    end if;
  end loop;
end $$;

-- ── (f) 0642: el latido y los eventos, sin perder los ids de antes ──────────
do $$
declare id_ok text; ok boolean;
begin
  foreach id_ok in array array['carta-porte-docs', 'vigia', 'jornada-alertas', 'buzon-entrega', 'wa-outbox', 'conductor-hitos'] loop
    insert into public.cron_latido (id, estado, ultimo_latido) values (id_ok, 'ok', now())
      on conflict (id) do update set ultimo_latido = excluded.ultimo_latido;
  end loop;
  begin
    insert into public.cron_latido (id, estado, ultimo_latido) values ('cron-inventado', 'ok', now());
    raise exception '0642: un id de cron inventado debía rebotar';
  exception when check_violation then null; end;

  foreach id_ok in array array['aviso_oficina', 'reintentos_agotados', 'recibido', 'extraccion_fallida', 'purgado', 'perfil_aprendido'] loop
    insert into public.cp_documento_evento (documento_id, tenant_id, tipo)
      values ('64000000-0000-4000-8000-000000000009', '64000000-0000-4000-8000-0000000000a1', id_ok);
  end loop;
  begin
    insert into public.cp_documento_evento (documento_id, tenant_id, tipo)
      values ('64000000-0000-4000-8000-000000000009', '64000000-0000-4000-8000-0000000000a1', 'evento_inventado');
    raise exception '0642: un tipo de evento inventado debía rebotar';
  exception when check_violation then null; end;

  -- La forma del candado: avisos_oficina es siempre un objeto.
  begin
    update public.cp_documento set avisos_oficina = '[]'::jsonb where id = '64000000-0000-4000-8000-000000000009';
    raise exception '0640: avisos_oficina como arreglo debía rebotar';
  exception when check_violation then null; end;
end $$;

rollback;
