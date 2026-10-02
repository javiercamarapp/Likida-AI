\set ON_ERROR_STOP on
-- 0482 — Eventos de adjunto del Vigía, contra Postgres REAL.
--
-- Lo que solo la base puede demostrar: `vigia_evento_tipo_dominio` (reescrito ENTERO desde la 0400) admite los tres
-- eventos de adjunto y los 22 de antes, rechaza uno inventado, y la clave única por mensaje+archivo hace que el aviso
-- «pendiente» salga UNA vez.
begin;

insert into public.tenant (id, nombre) values ('48200000-0000-4000-8000-0000000000a1', 'Flota A 0482');

insert into public.cliente (id, tenant_id, nombre) values ('48200000-0000-4000-8000-0000000000a2', '48200000-0000-4000-8000-0000000000a1', 'Cliente A');
insert into public.vigia_contacto (id, tenant_id, cliente_id, telefono, telefono_hash, consentimiento_en, consentimiento_origen)
values ('48200000-0000-4000-8000-0000000000a3', '48200000-0000-4000-8000-0000000000a1', '48200000-0000-4000-8000-0000000000a2', '525511110482', repeat('1', 64), now(), 'alta_flota');
do $$ declare t text; n integer := 0; begin
  foreach t in array array['entrante','borrador','aprobado','rechazado','enviado','autoenviado','fallo_envio','tomada','devuelta','cerrada','molestia','sin_respuesta','escalada','sin_destinatario','optout','alta','baja_manual','suprimido','spam','sin_dato','inyeccion','otro_cliente','adjunto_enviado','adjunto_pendiente','adjunto_fallo'] loop
    insert into public.vigia_evento (tenant_id, tipo) values ('48200000-0000-4000-8000-0000000000a1', t);
    n := n + 1;
  end loop;
  if n <> 25 then raise exception '0482: se esperaban 25 tipos y fueron %', n; end if;
  begin
    insert into public.vigia_evento (tenant_id, tipo) values ('48200000-0000-4000-8000-0000000000a1', 'adjunto_inventado');
    raise exception '0482: vigia_evento aceptó un tipo inventado';
  exception when check_violation then null; end;
  -- Un solo «pendiente» por mensaje y archivo (la clave es única por flota).
  insert into public.vigia_evento (tenant_id, tipo, clave) values ('48200000-0000-4000-8000-0000000000a1', 'adjunto_pendiente', 'm1:adjunto:pod');
  begin
    insert into public.vigia_evento (tenant_id, tipo, clave) values ('48200000-0000-4000-8000-0000000000a1', 'adjunto_pendiente', 'm1:adjunto:pod');
    raise exception '0482: la clave de adjunto permitió dos avisos';
  exception when unique_violation then null; end;
end $$;

rollback;
\echo 0482_vigia_evento_adjuntos: PASS
