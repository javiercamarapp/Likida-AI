\set ON_ERROR_STOP on
-- 0852 — reuso de foto de evidencia ENTRE VIAJES, a nivel de FLOTA (trigger
-- `conductor_detectar_evidencia_reuso_tenant` sobre `viaje_hito_evidencia`).
--
-- HALLAZGO ALTO: el candado existente (`viaje_hito_evidencia_unica`, 0385) es
-- por (hito, ciclo) — NO por tenant. La misma foto (mismo sha256) de un sello
-- de un viaje se puede reenviar como evidencia de OTRO viaje sin que nada lo
-- note. Lo que SOLO la base puede demostrar, contra Postgres real:
--   (a) la primera vez que aparece un sha256 en la flota, nace SIN marca;
--   (b) la MISMA foto en OTRO viaje de la MISMA flota queda marcada,
--       apuntando a la evidencia original;
--   (c) la MISMA foto, mismo sha256, en OTRA flota NO se marca — el reuso es
--       por tenant, no global;
--   (d) fuera de la ventana de reuso (180 días) ya no se marca;
--   (e) con VARIAS evidencias previas del mismo sha256 en la flota, la marca
--       apunta a la MÁS ANTIGUA, no a cualquiera ni a la última insertada;
--   (f) el candado de hito+ciclo (0385) sigue intacto: esta migración no lo afloja;
--   (g) borrar la evidencia referida (cascada desde el viaje) no rompe nada:
--       la marca de quien la referenciaba se vuelve NULL (ON DELETE SET NULL),
--       nunca un error de llave foránea.
begin;

insert into public.tenant (id, nombre) values
  ('08520000-0000-4000-8000-0000000000a1', 'Flota A 0852'),
  ('08520000-0000-4000-8000-0000000000b1', 'Flota B 0852');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('08520000-0000-4000-8000-0000000000a2', '08520000-0000-4000-8000-0000000000a1', 'Chofer A1 0852', '525500008521'),
  ('08520000-0000-4000-8000-0000000000a3', '08520000-0000-4000-8000-0000000000a1', 'Chofer A2 0852', '525500008522'),
  ('08520000-0000-4000-8000-0000000000a4', '08520000-0000-4000-8000-0000000000a1', 'Chofer A3 0852', '525500008524'),
  ('08520000-0000-4000-8000-0000000000b2', '08520000-0000-4000-8000-0000000000b1', 'Chofer B1 0852', '525500008523');
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en) values
  ('08520000-0000-4000-8000-0000000000d1', '08520000-0000-4000-8000-0000000000a1', '08520000-0000-4000-8000-0000000000a2', 'A-0852-1', 'abierto', now() - interval '5 hours', now() - interval '5 hours'),
  ('08520000-0000-4000-8000-0000000000d2', '08520000-0000-4000-8000-0000000000a1', '08520000-0000-4000-8000-0000000000a3', 'A-0852-2', 'abierto', now() - interval '5 hours', now() - interval '5 hours'),
  ('08520000-0000-4000-8000-0000000000d3', '08520000-0000-4000-8000-0000000000a1', '08520000-0000-4000-8000-0000000000a4', 'A-0852-3', 'abierto', now() - interval '5 hours', now() - interval '5 hours'),
  ('08520000-0000-4000-8000-0000000000e1', '08520000-0000-4000-8000-0000000000b1', '08520000-0000-4000-8000-0000000000b2', 'B-0852-1', 'abierto', now() - interval '5 hours', now() - interval '5 hours');
select public.sembrar_hitos_conductor(10);

do $$
declare
  ta uuid := '08520000-0000-4000-8000-0000000000a1';
  tb uuid := '08520000-0000-4000-8000-0000000000b1';
  d1 uuid := '08520000-0000-4000-8000-0000000000d1';
  d2 uuid := '08520000-0000-4000-8000-0000000000d2';
  d3 uuid := '08520000-0000-4000-8000-0000000000d3';
  e1 uuid := '08520000-0000-4000-8000-0000000000e1';
  h_d1_llegada uuid := (select id from public.viaje_hito where viaje_id = d1 and tipo = 'llegada_carga');
  h_d1_salida uuid := (select id from public.viaje_hito where viaje_id = d1 and tipo = 'salida_carga');
  h_d2_llegada uuid := (select id from public.viaje_hito where viaje_id = d2 and tipo = 'llegada_carga');
  h_d2_salida uuid := (select id from public.viaje_hito where viaje_id = d2 and tipo = 'salida_carga');
  h_d3_llegada uuid := (select id from public.viaje_hito where viaje_id = d3 and tipo = 'llegada_carga');
  h_e1_llegada uuid := (select id from public.viaje_hito where viaje_id = e1 and tipo = 'llegada_carga');
  sha1 text := 'aaaa1111aaaa1111aaaa1111aaaa1111';
  sha_vieja text := 'bbbb2222bbbb2222bbbb2222bbbb2222';
  ev1 uuid;
  ev2 uuid;
  ev3 uuid;
  ev_old uuid;
  ev_tardia uuid;
begin
  -- (a) primera aparición de ese sha256 en la flota: nace SIN marca.
  insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256, created_at)
  values (ta, d1, h_d1_llegada, 1, 'sello', ta::text || '/' || d1::text || '/f1.jpg', sha1, now() - interval '100 days')
  returning id into ev1;
  if (select reuso_tenant_evidencia_id from public.viaje_hito_evidencia where id = ev1) is not null then
    raise exception '0852(a): la PRIMERA evidencia de un sha256 nació YA marcada como reuso';
  end if;

  -- (b) la MISMA foto en OTRO viaje de la MISMA flota: se marca, apuntando a ev1.
  insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256, created_at)
  values (ta, d2, h_d2_llegada, 1, 'anden', ta::text || '/' || d2::text || '/f2.jpg', sha1, now() - interval '50 days')
  returning id into ev2;
  if (select reuso_tenant_evidencia_id from public.viaje_hito_evidencia where id = ev2) is distinct from ev1 then
    raise exception '0852(b): la foto reusada en OTRO viaje de la flota no quedó marcada contra la evidencia original';
  end if;

  -- (c) la MISMA foto, mismo sha256, en OTRA flota: NO se marca (el reuso es por tenant, no global).
  insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256)
  values (tb, e1, h_e1_llegada, 1, 'sello', tb::text || '/' || e1::text || '/f3.jpg', sha1);
  if exists (select 1 from public.viaje_hito_evidencia where viaje_id = e1 and reuso_tenant_evidencia_id is not null) then
    raise exception '0852(c): una foto de OTRA flota se marcó como reuso — el candado debía ser por tenant, no global';
  end if;

  -- (d) fuera de la ventana de reuso (180 días): una evidencia vieja con el mismo sha256 ya no cuenta.
  insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256, created_at)
  values (ta, d1, h_d1_salida, 1, 'sello', ta::text || '/' || d1::text || '/vieja.jpg', sha_vieja, now() - interval '200 days')
  returning id into ev_old;
  insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256)
  values (ta, d2, h_d2_salida, 1, 'sello', ta::text || '/' || d2::text || '/nueva.jpg', sha_vieja)
  returning id into ev_tardia;
  if (select reuso_tenant_evidencia_id from public.viaje_hito_evidencia where id = ev_tardia) is not null then
    raise exception '0852(d): una evidencia de hace 200 días (fuera de la ventana de 180) SÍ se contó como reuso';
  end if;

  -- (e) con DOS candidatas previas del mismo sha256 (ev1, hace 100 días; ev2, hace 50 días), la marca de una
  -- TERCERA evidencia debe apuntar a la MÁS ANTIGUA (ev1), no a la más reciente (ev2) ni a cualquiera.
  insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256)
  values (ta, d3, h_d3_llegada, 1, 'recibido', ta::text || '/' || d3::text || '/f3.jpg', sha1)
  returning id into ev3;
  if (select reuso_tenant_evidencia_id from public.viaje_hito_evidencia where id = ev3) is distinct from ev1 then
    raise exception '0852(e): con dos candidatas previas, la marca no apuntó a la MÁS ANTIGUA (ev1)';
  end if;

  -- (f) el candado de hito+ciclo (0385) sigue intacto: esta migración no lo afloja.
  begin
    insert into public.viaje_hito_evidencia (tenant_id, viaje_id, viaje_hito_id, ciclo, tipo, ruta, sha256)
    values (ta, d1, h_d1_llegada, 1, 'otra', ta::text || '/' || d1::text || '/f1-otra-vez.jpg', sha1);
    raise exception '0852(f): la misma (hito, ciclo, sha256) se guardó dos veces — el candado de la 0385 se aflojó';
  exception when unique_violation then null; end;
end $$;

-- (g) borrar el viaje d1 borra en cascada su viaje_hito y, de ahí, su viaje_hito_evidencia (ev1 y ev_old) — y
-- eso NO debe tronar por la llave foránea autoreferenciada: debe dejar en NULL a quienes apuntaban a ev1 (ev2, ev3).
delete from public.viaje where id = '08520000-0000-4000-8000-0000000000d1';

do $$
declare
  ev2 uuid := (select id from public.viaje_hito_evidencia where viaje_id = '08520000-0000-4000-8000-0000000000d2' and tipo = 'anden');
  ev3 uuid := (select id from public.viaje_hito_evidencia where viaje_id = '08520000-0000-4000-8000-0000000000d3' and tipo = 'recibido');
begin
  if (select reuso_tenant_evidencia_id from public.viaje_hito_evidencia where id = ev2) is not null then
    raise exception '0852(g): borrar la evidencia original en cascada debía dejar reuso_tenant_evidencia_id en NULL (ev2)';
  end if;
  if (select reuso_tenant_evidencia_id from public.viaje_hito_evidencia where id = ev3) is not null then
    raise exception '0852(g): borrar la evidencia original en cascada debía dejar reuso_tenant_evidencia_id en NULL (ev3)';
  end if;
end $$;

rollback;
