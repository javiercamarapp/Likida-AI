\set ON_ERROR_STOP on
-- 0530 + 0531 — BUZÓN DE FACTURAS: recepción por archivo, revisión de lecturas, entrega al contador.
-- Lo que solo la base garantiza, con datos sintéticos propios (rollback):
--   (a) factura_proveedor: la marca de revisión exige motivo (y al revés), el PDF va con su huella,
--       dominio de fuente_datos; solo lo APROBADO se reserva a un lote;
--   (b) buzon_recepcion: unique (flota, correo, huella) = el reintento de un correo no duplica; dominios,
--       forma del sha256, FK compuesta (la recepción de una flota no cuelga de la factura de otra), cascade;
--   (c) purgar_buzon_recepcion: borra SOLO lo viejo y SIN factura, encola sus PDF, respeta el plazo mínimo;
--   (d) la entrega: config (activa exige destinatario, ≤5, rangos), lote (dominios, destinatarios 1..5,
--       enviada exige resend_id, resend_id único), la RESERVA atómica de facturas (UPDATE condicional: de
--       dos reservas gana una), eventos con cascade, cron_latido acepta 'buzon-entrega';
--   (e) RLS deny-all: authenticated sin acceso.
begin;

insert into public.tenant (id, nombre) values
  ('53000000-0000-4000-8000-0000000000a1', 'Flota A 0530'),
  ('53000000-0000-4000-8000-0000000000b1', 'Flota B 0530');

insert into public.factura_proveedor (id, tenant_id, cfdi_uuid, total, xml_crudo, estado) values
  ('53000000-0000-4000-8000-0000000000a2', '53000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', 1160, '<x/>', 'aprobada'),
  ('53000000-0000-4000-8000-0000000000a3', '53000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000002', 580,  '<x/>', 'pendiente'),
  ('53000000-0000-4000-8000-0000000000b2', '53000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001', 100,  '<x/>', 'aprobada');

do $$
declare
  A constant uuid := '53000000-0000-4000-8000-0000000000a1';
  B constant uuid := '53000000-0000-4000-8000-0000000000b1';
  FA1 constant uuid := '53000000-0000-4000-8000-0000000000a2';
  FA2 constant uuid := '53000000-0000-4000-8000-0000000000a3';
  FB1 constant uuid := '53000000-0000-4000-8000-0000000000b2';
  sha constant text := repeat('a', 64);
  ent uuid;
  n int;
begin
  -- (a) factura_proveedor
  begin update public.factura_proveedor set requiere_revision = true where id = FA2;
    raise exception '0530: marcó revisión sin motivo'; exception when check_violation then null; end;
  begin update public.factura_proveedor set revision_motivo = 'baja confianza' where id = FA2;
    raise exception '0530: motivo de revisión sin la marca'; exception when check_violation then null; end;
  update public.factura_proveedor set requiere_revision = true, revision_motivo = 'lectura de PDF de baja confianza (0.55)' where id = FA2;
  begin update public.factura_proveedor set pdf_ruta = 'a/b.pdf' where id = FA2;
    raise exception '0530: PDF sin huella'; exception when check_violation then null; end;
  begin update public.factura_proveedor set fuente_datos = 'magia' where id = FA2;
    raise exception '0530: fuente fuera de dominio'; exception when check_violation then null; end;
  update public.factura_proveedor set fuente_datos = 'pdf_vision', pdf_ruta = 'a/b.pdf', pdf_sha256 = sha where id = FA2;

  -- (b) buzon_recepcion
  insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, factura_id, cfdi_uuid)
    values (A, 'email-1', 'f.xml', 'xml', 100, sha, 'procesada', FA1, 'a0000000-0000-4000-8000-000000000001');
  begin
    insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado) values (A, 'email-1', 'f.xml', 'xml', 100, sha, 'procesada');
    raise exception '0530: el reintento del correo duplicó la recepción';
  exception when unique_violation then null; end;
  -- otro correo con el mismo archivo SÍ se registra (como duplicada)
  insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, motivo) values (A, 'email-2', 'f.xml', 'xml', 100, sha, 'duplicada', 'archivo repetido');
  begin insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado) values (A, 'e3', 'x', 'xml', 1, 'no-es-hex', 'procesada');
    raise exception '0530: sha256 inválido'; exception when check_violation then null; end;
  begin insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado) values (A, 'e3', 'x', 'exe', 1, repeat('b', 64), 'procesada');
    raise exception '0530: tipo fuera de dominio'; exception when check_violation then null; end;
  begin insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado) values (A, 'e3', 'x', 'xml', 1, repeat('b', 64), 'aprobada');
    raise exception '0530: estado fuera de dominio'; exception when check_violation then null; end;
  begin insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, decidido_por) values (A, 'e3', 'x', 'pdf', 1, repeat('b', 64), 'descartada', 'u');
    raise exception '0530: decisión sin fecha'; exception when check_violation then null; end;
  begin insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, factura_id) values (A, 'e3', 'x', 'xml', 1, repeat('b', 64), 'procesada', FB1);
    raise exception '0530: la recepción de A colgó de la factura de B'; exception when foreign_key_violation then null; end;
  begin insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, confianza) values (A, 'e3', 'x', 'pdf', 1, repeat('b', 64), 'revision', 1.5);
    raise exception '0530: confianza fuera de rango'; exception when check_violation then null; end;

  -- (c) purga: solo lo viejo y sin factura; encola el PDF; plazo mínimo
  insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, storage_ruta, recibido_en)
    values (A, 'viejo-1', 'viejo.pdf', 'pdf', 10, repeat('c', 64), 'descartada', 'A/viejo.pdf', now() - interval '400 days'),
           (A, 'viejo-2', 'ligado.xml', 'xml', 10, repeat('d', 64), 'procesada', null, now() - interval '400 days');
  update public.buzon_recepcion set factura_id = FA1 where email_id = 'viejo-2';
  insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, recibido_en)
    values (A, 'reciente', 'r.pdf', 'pdf', 10, repeat('e', 64), 'revision', now() - interval '10 days');
  begin perform public.purgar_buzon_recepcion(now(), 5); raise exception '0530: aceptó un plazo de 5 días';
  exception when raise_exception then if sqlerrm not like '%plazo mínimo%' then raise; end if; end;
  if public.purgar_buzon_recepcion(now(), 365) <> 1 then raise exception '0530: la purga no borró exactamente la vieja sin factura'; end if;
  if (select count(*) from public.buzon_recepcion where email_id in ('viejo-2', 'reciente')) <> 2 then raise exception '0530: la purga borró de más'; end if;
  if not exists (select 1 from public.storage_huerfano_candidato where bucket = 'buzon-facturas' and nombre = 'A/viejo.pdf') then
    raise exception '0530: no encoló el PDF de la recepción purgada';
  end if;

  -- (d) entrega: config
  begin insert into public.buzon_entrega_config (tenant_id, activo) values (A, true);
    raise exception '0531: activó la entrega sin destinatarios'; exception when check_violation then null; end;
  begin insert into public.buzon_entrega_config (tenant_id, destinatarios) values (A, array['1@x.mx','2@x.mx','3@x.mx','4@x.mx','5@x.mx','6@x.mx']);
    raise exception '0531: aceptó 6 destinatarios'; exception when check_violation then null; end;
  begin insert into public.buzon_entrega_config (tenant_id, formato) values (A, 'excel');
    raise exception '0531: formato fuera de dominio'; exception when check_violation then null; end;
  begin insert into public.buzon_entrega_config (tenant_id, hora_envio) values (A, 24);
    raise exception '0531: hora 24'; exception when check_violation then null; end;
  insert into public.buzon_entrega_config (tenant_id, activo, destinatarios, formato, automatica) values (A, true, array['conta@x.mx'], 'sap_b1', true);
  if (select incluir_zip from public.buzon_entrega_config where tenant_id = A) is not true then raise exception '0531: incluir_zip no nace en true'; end if;

  -- lote
  insert into public.buzon_entrega (tenant_id, disparo, formato, incluye_zip, destinatarios, n_facturas, total)
    values (A, 'manual', 'generico', true, array['conta@x.mx'], 1, 1160) returning id into ent;
  begin insert into public.buzon_entrega (tenant_id, disparo, formato, incluye_zip, destinatarios, n_facturas, total) values (A, 'cron', 'generico', true, array['a@x.mx'], 1, 1);
    raise exception '0531: disparo fuera de dominio'; exception when check_violation then null; end;
  begin insert into public.buzon_entrega (tenant_id, disparo, formato, incluye_zip, destinatarios, n_facturas, total) values (A, 'manual', 'generico', true, '{}', 1, 1);
    raise exception '0531: lote sin destinatarios'; exception when check_violation then null; end;
  begin update public.buzon_entrega set estado = 'enviada' where id = ent;
    raise exception '0531: enviada sin resend_id'; exception when check_violation then null; end;
  update public.buzon_entrega set estado = 'enviada', resend_id = 'rs-1', enviada_en = now() where id = ent;
  begin insert into public.buzon_entrega (tenant_id, disparo, formato, incluye_zip, destinatarios, n_facturas, total, estado, resend_id)
    values (A, 'manual', 'generico', true, array['a@x.mx'], 1, 1, 'enviada', 'rs-1');
    raise exception '0531: dos lotes con el mismo id de Resend'; exception when unique_violation then null; end;
  update public.buzon_entrega set estado = 'pendiente', resend_id = null, enviada_en = null where id = ent;

  -- la RESERVA atómica: solo lo aprobado y libre; la segunda reserva no toma nada
  update public.factura_proveedor set entrega_id = ent where tenant_id = A and estado = 'aprobada' and entrega_id is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0531: la primera reserva debía tomar 1 factura y tomó %', n; end if;
  update public.factura_proveedor set entrega_id = gen_random_uuid() where tenant_id = A and estado = 'aprobada' and entrega_id is null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception '0531: una factura ya reservada se reservó otra vez'; end if;
  begin update public.factura_proveedor set entrega_id = ent where id = FA2;
    raise exception '0531: reservó una factura PENDIENTE'; exception when check_violation then null; end;
  begin update public.factura_proveedor set entrega_id = ent where id = FB1;
    raise exception '0531: la factura de B colgó del lote de A'; exception when foreign_key_violation then null; end;

  -- eventos
  insert into public.buzon_entrega_evento (tenant_id, entrega_id, evento, detalle) values (A, ent, 'creada', 'lote manual');
  begin insert into public.buzon_entrega_evento (tenant_id, entrega_id, evento) values (A, ent, 'inventado');
    raise exception '0531: evento fuera de dominio'; exception when check_violation then null; end;
  begin insert into public.buzon_entrega_evento (tenant_id, entrega_id, evento) values (B, ent, 'creada');
    raise exception '0531: evento de B colgó del lote de A'; exception when foreign_key_violation then null; end;

  -- cron_latido
  insert into public.cron_latido (id, estado, ultimo_latido) values ('buzon-entrega', 'ok', now())
    on conflict (id) do nothing;
end $$;

set local role authenticated;
do $$
begin
  begin perform count(*) from public.buzon_recepcion; raise exception '0530: authenticated leyó buzon_recepcion'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.buzon_entrega; raise exception '0531: authenticated leyó buzon_entrega'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.buzon_entrega_config; raise exception '0531: authenticated leyó la config'; exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
select '0530_buzon_facturas OK' as resultado;
