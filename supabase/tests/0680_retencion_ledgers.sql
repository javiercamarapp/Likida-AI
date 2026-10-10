\set ON_ERROR_STOP on
-- 0680 — RETENCIÓN DE LOS LEDGERS contra Postgres REAL (sintético, rollback).
-- Lo que solo la base garantiza:
--   (a) purgar_evento_seguridad respeta los plazos POR SEVERIDAD (info 90 / media 180 / alta 365): una alta de 200 días
--       sobrevive donde una media de 200 ya no; lo reciente no se toca; es idempotente;
--   (b) mantener_ledgers purga las cinco tablas con SU plazo (stripe 400, vigia 365, cp_documento_evento 730, buzon 365),
--       no toca lo que está dentro del plazo ni a otra flota que no cumple, y devuelve el conteo real por tabla;
--   (c) una tabla que falla se acumula en `fallos` sin tumbar a las demás (se simula con un trigger que bloquea el borrado);
--   (d) los pisos: ningún plazo < 30 días, y lo grave nunca dura menos que lo leve;
--   (e) permisos: solo service_role ejecuta.
begin;

insert into public.tenant (id, nombre) values
  ('68000000-0000-4000-8000-0000000000a1', 'Flota A 0680'),
  ('68000000-0000-4000-8000-0000000000b1', 'Flota B 0680');

-- ── evento_seguridad: una por severidad × (vieja de más del plazo / de 200 días / reciente) ──
insert into public.evento_seguridad (origen, tipo, severidad, creado_en, actor) values
  ('wa_webhook', 'firma_invalida', 'info',  now() - interval '100 days', 'info-100'),   -- vencida (>90)
  ('wa_webhook', 'firma_invalida', 'info',  now() - interval '10 days',  'info-10'),    -- vigente
  ('wa_webhook', 'firma_invalida', 'media', now() - interval '200 days', 'media-200'),  -- vencida (>180)
  ('wa_webhook', 'firma_invalida', 'media', now() - interval '170 days', 'media-170'),  -- vigente
  ('api_v1',     'acceso_denegado', 'alta', now() - interval '200 days', 'alta-200'),   -- vigente: lo grave dura 365
  ('api_v1',     'acceso_denegado', 'alta', now() - interval '400 days', 'alta-400');   -- vencida (>365)

-- ── evento_stripe (400 d) ──
insert into public.evento_stripe (id, tipo, procesado_en) values
  ('evt_vieja_0680', 'invoice.paid', now() - interval '401 days'),
  ('evt_nueva_0680', 'invoice.paid', now() - interval '399 days');

-- ── vigia_evento (365 d) ──
insert into public.vigia_evento (tenant_id, tipo, created_at) values
  ('68000000-0000-4000-8000-0000000000a1', 'entrante', now() - interval '366 days'),
  ('68000000-0000-4000-8000-0000000000a1', 'entrante', now() - interval '364 days'),
  ('68000000-0000-4000-8000-0000000000b1', 'entrante', now() - interval '500 days');

-- ── cp_documento_evento (730 d): el padre cp_documento existe y NO se toca ──
insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256) values
  ('68000000-0000-4000-8000-0000000000d1', '68000000-0000-4000-8000-0000000000a1', 'manual', 'excel', 'e.xlsx', 10, repeat('a', 64));
insert into public.cp_documento_evento (documento_id, tenant_id, tipo, created_at) values
  ('68000000-0000-4000-8000-0000000000d1', '68000000-0000-4000-8000-0000000000a1', 'recibido', now() - interval '731 days'),
  ('68000000-0000-4000-8000-0000000000d1', '68000000-0000-4000-8000-0000000000a1', 'aprobado', now() - interval '729 days');

-- ── buzon_entrega_evento (365 d) ──
insert into public.buzon_entrega (id, tenant_id, disparo, formato, incluye_zip, destinatarios, n_facturas, total) values
  ('68000000-0000-4000-8000-0000000000e1', '68000000-0000-4000-8000-0000000000a1', 'manual', 'generico', true, array['c@x.mx'], 1, 1);
insert into public.buzon_entrega_evento (tenant_id, entrega_id, en, evento) values
  ('68000000-0000-4000-8000-0000000000a1', '68000000-0000-4000-8000-0000000000e1', now() - interval '366 days', 'creada'),
  ('68000000-0000-4000-8000-0000000000a1', '68000000-0000-4000-8000-0000000000e1', now() - interval '10 days', 'enviada');

set local role service_role;

do $$
declare r jsonb; n integer;
begin
  -- (a) evento_seguridad por severidad
  r := public.purgar_evento_seguridad();
  if (r->>'borradas')::int <> 3 then raise exception '0680(a): se esperaban 3 borradas (info-100, media-200, alta-400) y fueron %', r; end if;
  if (r->>'parcial')::boolean then raise exception '0680(a): no debía quedar parcial'; end if;
  if exists (select 1 from public.evento_seguridad where actor in ('info-100', 'media-200', 'alta-400')) then raise exception '0680(a): sobrevivió una vencida'; end if;
  select count(*) into n from public.evento_seguridad where actor in ('info-10', 'media-170', 'alta-200');
  if n <> 3 then raise exception '0680(a): se borró una vigente (la alta de 200 días vive hasta los 365)'; end if;
  if (public.purgar_evento_seguridad()->>'borradas')::int <> 0 then raise exception '0680(a): no es idempotente'; end if;

  -- (b) las demás tablas, por la orquestadora
  r := public.mantener_ledgers();
  if (r->'evento_stripe'->>'borradas')::int <> 1 or (select count(*) from public.evento_stripe where id like '%0680') <> 1 then raise exception '0680(b): evento_stripe %', r; end if;
  if (r->'vigia_evento'->>'borradas')::int <> 2 or (select count(*) from public.vigia_evento where tenant_id in ('68000000-0000-4000-8000-0000000000a1','68000000-0000-4000-8000-0000000000b1')) <> 1 then raise exception '0680(b): vigia_evento %', r; end if;
  if (r->'cp_documento_evento'->>'borradas')::int <> 1 or (select count(*) from public.cp_documento_evento where documento_id = '68000000-0000-4000-8000-0000000000d1') <> 1 then raise exception '0680(b): cp_documento_evento %', r; end if;
  if (select count(*) from public.cp_documento where id = '68000000-0000-4000-8000-0000000000d1') <> 1 then raise exception '0680(b): se tocó el documento padre'; end if;
  if (r->'buzon_entrega_evento'->>'borradas')::int <> 1 or (select count(*) from public.buzon_entrega_evento where entrega_id = '68000000-0000-4000-8000-0000000000e1') <> 1 then raise exception '0680(b): buzon_entrega_evento %', r; end if;
  if (select count(*) from public.buzon_entrega where id = '68000000-0000-4000-8000-0000000000e1') <> 1 then raise exception '0680(b): se tocó el lote padre'; end if;
  if jsonb_array_length(r->'fallos') <> 0 or (r->>'parcial')::boolean then raise exception '0680(b): fallos/parcial inesperados %', r; end if;
  -- idempotente: una segunda pasada no borra nada
  r := public.mantener_ledgers();
  if (r->'evento_stripe'->>'borradas')::int + (r->'vigia_evento'->>'borradas')::int + (r->'cp_documento_evento'->>'borradas')::int + (r->'buzon_entrega_evento'->>'borradas')::int <> 0 then raise exception '0680(b): segunda pasada borró %', r; end if;

  -- plazos pasados por parámetro: con 30 días sí cae lo de 364 y 10 días no
  r := public.mantener_ledgers(now(), null, 30, 30, 30, 30);
  if (r->'vigia_evento'->>'borradas')::int <> 1 or (r->'buzon_entrega_evento'->>'borradas')::int <> 0 then raise exception '0680(b): plazos por parámetro %', r; end if;
end $$;

-- (c) una tabla que falla NO tumba a las demás: un trigger bloquea el borrado de vigia_evento (como un append-only futuro)
reset role;
create function pg_temp.bloquea() returns trigger language plpgsql as $f$ begin raise exception 'borrado bloqueado'; end $f$;
create trigger t_bloquea before delete on public.vigia_evento for each row execute function pg_temp.bloquea();
insert into public.vigia_evento (tenant_id, tipo, created_at) values ('68000000-0000-4000-8000-0000000000a1', 'entrante', now() - interval '900 days');
insert into public.evento_stripe (id, tipo, procesado_en) values ('evt_vieja2_0680', 'invoice.paid', now() - interval '500 days');
set local role service_role;
do $$
declare r jsonb;
begin
  r := public.mantener_ledgers();
  if jsonb_array_length(r->'fallos') <> 1 or (r->'fallos'->>0) not like 'vigia_evento: %borrado bloqueado%' then raise exception '0680(c): el fallo no quedó dicho %', r; end if;
  if (r->'evento_stripe'->>'borradas')::int <> 1 then raise exception '0680(c): evento_stripe no corrió tras el fallo de vigia %', r; end if;
  if r ? 'vigia_evento' then raise exception '0680(c): vigia_evento no debía reportar borradas si falló'; end if;
end $$;

-- (d) pisos
do $$
begin
  begin perform public.mantener_ledgers(now(), null, 29, 365, 730, 365); raise exception '0680(d): aceptó 29 días'; exception when sqlstate 'PU001' then null; end;
  begin perform public.purgar_evento_seguridad(10, 180, 365); raise exception '0680(d): aceptó info a 10 días'; exception when sqlstate 'PU001' then null; end;
  begin perform public.purgar_evento_seguridad(90, 60, 365); raise exception '0680(d): aceptó media < info'; exception when sqlstate 'PU001' then null; end;
  begin perform public.purgar_evento_seguridad(90, 180, 100); raise exception '0680(d): aceptó alta < media'; exception when sqlstate 'PU001' then null; end;
end $$;

-- (e) permisos
reset role;
set local role authenticated;
do $$
begin
  begin perform public.mantener_ledgers(); raise exception '0680(e): authenticated ejecutó mantener_ledgers'; exception when insufficient_privilege then null; end;
  begin perform public.purgar_evento_seguridad(); raise exception '0680(e): authenticated ejecutó purgar_evento_seguridad'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$
begin
  begin perform public.mantener_ledgers(); raise exception '0680(e): anon ejecutó mantener_ledgers'; exception when insufficient_privilege then null; end;
end $$;

rollback;
