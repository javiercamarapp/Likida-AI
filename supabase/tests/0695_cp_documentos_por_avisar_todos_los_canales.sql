\set ON_ERROR_STOP on
-- 0695 — Carta Porte: el aviso de «dudas» (hallazgos) a la oficina cubre TODOS los canales. Datos sintéticos; termina en rollback.
-- Un documento por revisar con un bloqueo o con lectura poco segura se lista para avisar igual si llegó por correo, por WhatsApp o por el
-- panel; sigue sin listarse el limpio, el que ya no está por revisar, el purgado, el de fuera de la ventana y el ya avisado; y el candado de
-- «una vez por documento» no cambia.
begin;

insert into public.tenant (id, nombre) values ('69200000-0000-4000-8000-0000000000a1', 'Flota A 0695');

insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, storage_ruta, validacion, confianza_min)
select x.id::uuid, '69200000-0000-4000-8000-0000000000a1', x.canal, 'pdf_texto', 'doc-' || x.n || '.pdf', 100,
       encode(sha256(convert_to('0695-' || x.n, 'utf8')), 'hex'), x.estado, 'ruta/0695/' || x.n, x.validacion::jsonb, x.conf
  from (values
    (1, '69200000-0000-4000-8000-0000000000c1', 'correo',   'por_revisar', '{"hallazgos":[],"bloqueos":1,"porConfirmar":0,"listoParaAprobar":false}', 0.95::numeric),
    (2, '69200000-0000-4000-8000-0000000000c2', 'whatsapp', 'por_revisar', '{"hallazgos":[],"bloqueos":1,"porConfirmar":0,"listoParaAprobar":false}', 0.95::numeric),
    (3, '69200000-0000-4000-8000-0000000000c3', 'manual',   'por_revisar', '{"hallazgos":[],"bloqueos":0,"porConfirmar":1,"listoParaAprobar":false}', 0.40::numeric),
    (4, '69200000-0000-4000-8000-0000000000c4', 'whatsapp', 'por_revisar', '{"hallazgos":[],"bloqueos":0,"porConfirmar":0,"listoParaAprobar":true}',  0.99::numeric),   -- limpio
    (5, '69200000-0000-4000-8000-0000000000c5', 'whatsapp', 'recibido',    '{"hallazgos":[],"bloqueos":1,"porConfirmar":0,"listoParaAprobar":false}', 0.30::numeric)    -- aún no se lee: no está por revisar
  ) as x(n, id, canal, estado, validacion, conf);

do $$
declare ids uuid[]; vieja constant uuid := '69200000-0000-4000-8000-0000000000c6';
begin
  select array_agg(id order by id) into ids from public.cp_documentos_por_avisar(100, 0.85, 3);
  if ids is distinct from array['69200000-0000-4000-8000-0000000000c1', '69200000-0000-4000-8000-0000000000c2', '69200000-0000-4000-8000-0000000000c3']::uuid[] then
    raise exception '0695: por_avisar debía listar correo, WhatsApp y panel con duda (y nada más): %', ids;
  end if;

  -- una vez por documento: reclamado el aviso, ya no se lista
  if not public.cp_documento_reclamar_aviso('69200000-0000-4000-8000-0000000000a1', '69200000-0000-4000-8000-0000000000c2', 'hallazgos') then raise exception '0695: el candado debía ganarse'; end if;
  select array_agg(id order by id) into ids from public.cp_documentos_por_avisar(100, 0.85, 3);
  if ids is distinct from array['69200000-0000-4000-8000-0000000000c1', '69200000-0000-4000-8000-0000000000c3']::uuid[] then raise exception '0695: lo ya avisado volvió a listarse: %', ids; end if;

  -- fuera de la ventana de días no se avisa, sea cual sea el canal
  insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, storage_ruta, validacion, confianza_min)
    values (vieja, '69200000-0000-4000-8000-0000000000a1', 'whatsapp', 'pdf_texto', 'vieja.pdf', 100, encode(sha256(convert_to('0695-vieja', 'utf8')), 'hex'), 'por_revisar', 'ruta/0695/v', '{"hallazgos":[],"bloqueos":2,"porConfirmar":0,"listoParaAprobar":false}', 0.2);
  update public.cp_documento set updated_at = now() - interval '10 days' where id = vieja;
  if exists (select 1 from public.cp_documentos_por_avisar(100, 0.85, 3) where id = vieja) then raise exception '0695: lo de hace 10 días no debía listarse con ventana de 3'; end if;
end $$;

rollback;
