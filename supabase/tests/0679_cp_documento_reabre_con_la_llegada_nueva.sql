\set ON_ERROR_STOP on
-- 0679 — CARTA PORTE, correctiva de la ronda 17 sobre 0672. Postgres REAL, datos sintéticos, rollback.
-- Un hijo rechazado A MANO que se reabre toma el cliente, el remitente, el asunto y el canal del padre que se divide AHORA (no los
-- de la llegada anterior), y pierde lo que dependía de aquel rechazo (aprobación, exportación, revisor). Conserva el viaje ligado.
begin;

insert into public.tenant (id, nombre) values ('67900000-0000-4000-8000-0000000000a1', 'Flota A 0679');
insert into public.cliente (id, tenant_id, nombre) values
  ('67900000-0000-4000-8000-0000000000c1', '67900000-0000-4000-8000-0000000000a1', 'Cliente anterior'),
  ('67900000-0000-4000-8000-0000000000c2', '67900000-0000-4000-8000-0000000000a1', 'Cliente nuevo');

create function pg_temp.sha(t text) returns text language sql as $$ select encode(sha256(convert_to('0679-' || t, 'utf8')), 'hex') $$;

-- Padre nuevo: otro remitente, otro cliente, otro canal.
insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, version, intentos, procesando_hasta, storage_ruta, cliente_id, remitente, asunto, remitente_reconocido)
values ('67900000-0000-4000-8000-000000000001', '67900000-0000-4000-8000-0000000000a1', 'whatsapp', 'excel', 'plan.xlsx', 1000, pg_temp.sha('padre'), 'procesando', 2, 1,
        now() + interval '2 minutes', 'ruta/p1', '67900000-0000-4000-8000-0000000000c2', 'nuevo@remitente.test.invalid', 'Plan nuevo', true);
-- Hijo rechazado a mano en una llegada ANTERIOR: otro cliente, otro remitente, con revisor y marcas de aprobación.
insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256, estado, version, intentos, storage_ruta, cliente_id, remitente, asunto, remitente_reconocido,
                                 rechazo_motivo, exportado_en, abierto_en, tiempo_revision_seg)
values ('67900000-0000-4000-8000-0000000000d1', '67900000-0000-4000-8000-0000000000a1', 'correo', 'csv', 'h1.csv', 50, pg_temp.sha('h1'), 'rechazado', 4, 1, 'ruta/viejo',
        '67900000-0000-4000-8000-0000000000c1', 'viejo@remitente.test.invalid', 'Asunto viejo', false,
        'lo rechazó la oficina', now(), now(), 30);

do $$
declare r record; d public.cp_documento%rowtype;
begin
  select * into r from public.cp_documento_dividir('67900000-0000-4000-8000-0000000000a1', '67900000-0000-4000-8000-000000000001', 2,
    jsonb_build_array(jsonb_build_object('indice', 1, 'clave', 'F-1', 'nombre', 'h1-nuevo.csv', 'sha256', pg_temp.sha('h1'), 'bytes', 77, 'storage_ruta', 'ruta/nuevo-1'),
                      jsonb_build_object('indice', 2, 'clave', 'F-2', 'nombre', 'h2.csv', 'sha256', pg_temp.sha('h2'), 'bytes', 60, 'storage_ruta', 'ruta/nuevo-2')),
    now() + interval '180 days', now() + interval '90 days') x where x.indice = 1;
  if r.accion <> 'reabierto' then raise exception '0679: debía reabrirse (%)', r.accion; end if;
  select * into d from public.cp_documento where id = '67900000-0000-4000-8000-0000000000d1';
  if d.estado <> 'recibido' or d.storage_ruta <> 'ruta/nuevo-1' then raise exception '0679: no quedó reabierto: %', to_jsonb(d); end if;
  if d.cliente_id is distinct from '67900000-0000-4000-8000-0000000000c2'::uuid then raise exception '0679: conservó el cliente de la llegada anterior (%)', d.cliente_id; end if;
  if d.remitente <> 'nuevo@remitente.test.invalid' or d.asunto <> 'Plan nuevo' or d.remitente_reconocido is distinct from true or d.canal <> 'whatsapp' then
    raise exception '0679: conservó el remitente, asunto o canal de la llegada anterior: %', to_jsonb(d);
  end if;
  if d.nombre_archivo <> 'h1-nuevo.csv' then raise exception '0679: conservó el nombre del archivo anterior (%)', d.nombre_archivo; end if;
  if d.aprobado_en is not null or d.exportado_en is not null or d.aprobado_por is not null or d.revisado_por is not null or d.abierto_en is not null or d.rechazo_motivo is not null then
    raise exception '0679: conservó marcas del documento rechazado: %', to_jsonb(d);
  end if;
end $$;

rollback;
\echo 0679_cp_documento_reabre_con_la_llegada_nueva PASS
