\set ON_ERROR_STOP on
-- 0643/0644 — «No coincide» atómico y aviso de discrepancia con reclamo, reintento y rearme.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
--
--   (a) registrar_acuse_no_coincide: la primera llamada gana y deja el aviso pendiente (ciclo 1); la segunda devuelve NULL
--       y NO duplica el aviso; un operador ajeno, una flota ajena y un id inexistente devuelven NULL sin tocar nada;
--   (b) cambiar de opinión (recibida → no coincide) abre un ciclo NUEVO;
--   (c) reclamar: el primero recibe token, el segundo NO (arriendo vigente); un reintento aún no vencido no se reclama;
--       con el arriendo vencido se retoma con token nuevo y el token viejo ya no cierra;
--   (d) cerrar 'reintentar' vuelve a pendiente con su espera, suma intento y suma los aceptados sin repetir; al llegar al
--       tope queda fallido; cerrar 'enviado' deja enviado_en; un resultado inventado se rechaza;
--   (e) rearmar: un fallido vuelve a pendiente-ya (conserva a quién ya le llegó); uno enviado o en curso devuelve NULL; sin
--       fila previa la crea; una liquidación que no está en «No coincide» devuelve NULL;
--   (f) aislamiento entre flotas y cascada al borrar la liquidación;
--   (g) CHECK de coherencia (enviando sin token, enviado sin hora) y permisos: solo service_role.
begin;

insert into public.tenant (id, nombre) values
  ('64300000-0000-4000-8000-0000000000a1', 'Flota A 0643'),
  ('64300000-0000-4000-8000-0000000000b1', 'Flota B 0643');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('64300000-0000-4000-8000-0000000000a2', '64300000-0000-4000-8000-0000000000a1', 'Chofer A', '525500000043'),
  ('64300000-0000-4000-8000-0000000000a3', '64300000-0000-4000-8000-0000000000a1', 'Chofer A2', '525500000044');
insert into public.liquidacion_externa
  (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, estado)
values
  ('64300000-0000-4000-8000-0000000000d1', '64300000-0000-4000-8000-0000000000a1', 'C1', repeat('a', 64),
   '64300000-0000-4000-8000-0000000000a2', '2026-09-01', '2026-09-07',
   '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'enviada'),
  ('64300000-0000-4000-8000-0000000000d2', '64300000-0000-4000-8000-0000000000a1', 'C2', repeat('b', 64),
   '64300000-0000-4000-8000-0000000000a2', '2026-09-01', '2026-09-07',
   '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'enviada');

set local role service_role;

do $$
declare
  ta constant uuid := '64300000-0000-4000-8000-0000000000a1';
  tb constant uuid := '64300000-0000-4000-8000-0000000000b1';
  oa constant uuid := '64300000-0000-4000-8000-0000000000a2';
  oa2 constant uuid := '64300000-0000-4000-8000-0000000000a3';
  l1 constant uuid := '64300000-0000-4000-8000-0000000000d1';
  l2 constant uuid := '64300000-0000-4000-8000-0000000000d2';
  c int; n int; tok uuid; tok2 uuid; viejo uuid; r text; ac text[]; rechazado boolean; ahora timestamptz := clock_timestamp();
begin
  -- (a)
  c := public.registrar_acuse_no_coincide(ta, l1, oa);
  if c is distinct from 1 then raise exception '0643(a): la primera llamada debía devolver el ciclo 1 (devolvió %)', c; end if;
  if public.registrar_acuse_no_coincide(ta, l1, oa) is not null then raise exception '0643(a): la segunda llamada debía devolver NULL'; end if;
  select count(*) into n from public.liquidacion_aviso_discrepancia where liquidacion_externa_id = l1;
  if n <> 1 then raise exception '0643(a): debía haber UN aviso (hay %)', n; end if;
  select count(*) into n from public.liquidacion_externa where id = l1 and estado = 'acusada' and acuse_tipo = 'no_coincide' and acuse_en is not null;
  if n <> 1 then raise exception '0643(a): la liquidación debía quedar acusada/no_coincide'; end if;
  if public.registrar_acuse_no_coincide(ta, l2, oa2) is not null then raise exception '0643(a): un operador ajeno NO acusa la liquidación de otro'; end if;
  if public.registrar_acuse_no_coincide(tb, l2, oa) is not null then raise exception '0643(a): una flota ajena NO acusa'; end if;
  if public.registrar_acuse_no_coincide(ta, '64300000-0000-4000-8000-0000000000ff', oa) is not null then raise exception '0643(a): un id inexistente devuelve NULL'; end if;
  select count(*) into n from public.liquidacion_aviso_discrepancia where liquidacion_externa_id = l2;
  if n <> 0 then raise exception '0643(a): los intentos rechazados no debían dejar aviso (hay %)', n; end if;

  -- (b)
  update public.liquidacion_externa set acuse_tipo = 'recibida' where id = l1;
  c := public.registrar_acuse_no_coincide(ta, l1, oa);
  if c is distinct from 2 then raise exception '0643(b): cambiar de opinión debía abrir el ciclo 2 (devolvió %)', c; end if;

  -- (c)
  tok := public.reclamar_aviso_discrepancia(ta, l1, 1);
  if tok is null then raise exception '0643(c): el primer reclamo debía recibir token'; end if;
  if public.reclamar_aviso_discrepancia(ta, l1, 1) is not null then raise exception '0643(c): el segundo reclamo (arriendo vigente) debía ser NULL'; end if;
  if public.reclamar_aviso_discrepancia(tb, l1, 1, ahora + interval '1 day') is not null then raise exception '0643(c): una flota ajena NO reclama'; end if;
  viejo := tok;
  tok2 := public.reclamar_aviso_discrepancia(ta, l1, 1, clock_timestamp() + interval '10 minutes');
  if tok2 is null or tok2 = viejo then raise exception '0643(c): con el arriendo vencido el reclamo debía retomarse con token nuevo'; end if;
  if public.cerrar_aviso_discrepancia(ta, l1, 1, viejo, 'enviado') is not null then raise exception '0643(c): el token viejo NO debía cerrar'; end if;

  -- (d)
  r := public.cerrar_aviso_discrepancia(ta, l1, 1, tok2, 'reintentar', array['525511110001'], 'meta 131047', clock_timestamp() + interval '2 minutes');
  if r is distinct from 'pendiente' then raise exception '0643(d): reintentar debía volver a pendiente (%)', r; end if;
  select intentos, telefonos_aceptados into n, ac from public.liquidacion_aviso_discrepancia where liquidacion_externa_id = l1 and ciclo = 1;
  if n <> 1 or ac <> array['525511110001'] then raise exception '0643(d): intento y aceptados mal (% %)', n, ac; end if;
  if public.reclamar_aviso_discrepancia(ta, l1, 1) is not null then raise exception '0643(d): un reintento cuyo momento no llega NO se reclama'; end if;
  tok := public.reclamar_aviso_discrepancia(ta, l1, 1, clock_timestamp() + interval '3 minutes');
  if tok is null then raise exception '0643(d): vencida la espera debía poder reclamarse'; end if;
  r := public.cerrar_aviso_discrepancia(ta, l1, 1, tok, 'reintentar', array['525511110001', '525511110002'], 'otra vez', null, 3);
  select telefonos_aceptados into ac from public.liquidacion_aviso_discrepancia where liquidacion_externa_id = l1 and ciclo = 1;
  if r is distinct from 'pendiente' or ac <> array['525511110001', '525511110002'] then raise exception '0643(d): los aceptados se suman sin repetir (% %)', r, ac; end if;
  tok := public.reclamar_aviso_discrepancia(ta, l1, 1, clock_timestamp() + interval '5 minutes');
  r := public.cerrar_aviso_discrepancia(ta, l1, 1, tok, 'reintentar', '{}', 'tercera', null, 3);
  if r is distinct from 'fallido' then raise exception '0643(d): al llegar al tope debía quedar fallido (%)', r; end if;
  rechazado := false;
  begin
    perform public.cerrar_aviso_discrepancia(ta, l1, 1, tok, 'inventado');
  exception when sqlstate '22023' then rechazado := true; end;
  if not rechazado then raise exception '0643(d): un resultado inventado debía rechazarse'; end if;

  -- (e)
  c := public.rearmar_aviso_discrepancia(ta, l1);
  if c is distinct from 2 then raise exception '0643(e): rearmar actúa sobre el ÚLTIMO ciclo (devolvió %)', c; end if;
  tok := public.reclamar_aviso_discrepancia(ta, l1, 2);
  r := public.cerrar_aviso_discrepancia(ta, l1, 2, tok, 'enviado', array['525511110009']);
  if r is distinct from 'enviado' then raise exception '0643(e): cerrar enviado'; end if;
  select count(*) into n from public.liquidacion_aviso_discrepancia where liquidacion_externa_id = l1 and ciclo = 2 and enviado_en is not null and claim_token is null;
  if n <> 1 then raise exception '0643(e): enviado debía traer su hora y sin token'; end if;
  if public.rearmar_aviso_discrepancia(ta, l1) is not null then raise exception '0643(e): un aviso ya enviado NO se rearma'; end if;
  -- el ciclo 1 fallido se rearma solo si es el último: aquí el último (2) está enviado, así que NULL (arriba). Rearmar uno fallido:
  c := public.registrar_acuse_no_coincide(ta, l2, oa);
  tok := public.reclamar_aviso_discrepancia(ta, l2, c);
  perform public.cerrar_aviso_discrepancia(ta, l2, c, tok, 'reintentar', array['525511110001'], 'x', null, 1);
  select estado into r from public.liquidacion_aviso_discrepancia where liquidacion_externa_id = l2 and ciclo = c;
  if r <> 'fallido' then raise exception '0643(e): preparación: debía estar fallido'; end if;
  if public.rearmar_aviso_discrepancia(ta, l2) is distinct from c then raise exception '0643(e): un fallido debía rearmarse'; end if;
  select count(*) into n from public.liquidacion_aviso_discrepancia
   where liquidacion_externa_id = l2 and ciclo = c and estado = 'pendiente' and intentos = 0 and telefonos_aceptados = array['525511110001'] and ultimo_error is null;
  if n <> 1 then raise exception '0643(e): rearmar conserva a quién ya le llegó y reinicia los intentos'; end if;
  tok := public.reclamar_aviso_discrepancia(ta, l2, c);
  if public.rearmar_aviso_discrepancia(ta, l2) is not null then raise exception '0643(e): uno en curso (enviando) NO se rearma'; end if;
  -- flota ajena y liquidación que no está en «No coincide»
  if public.rearmar_aviso_discrepancia(tb, l2) is not null then raise exception '0643(e): una flota ajena NO rearma'; end if;
  update public.liquidacion_externa set acuse_tipo = 'recibida' where id = l2;
  if public.rearmar_aviso_discrepancia(ta, l2) is not null then raise exception '0643(e): sin «No coincide» no hay nada que rearmar'; end if;
  -- sin fila previa (acuse anterior a la 0643): la crea
  update public.liquidacion_externa set acuse_tipo = 'no_coincide', acuse_en = now() where id = l2;
  delete from public.liquidacion_aviso_discrepancia where liquidacion_externa_id = l2;
  if public.rearmar_aviso_discrepancia(ta, l2) is distinct from 1 then raise exception '0643(e): sin fila previa debía crear el ciclo 1'; end if;

  -- (g) coherencia
  rechazado := false;
  begin
    update public.liquidacion_aviso_discrepancia set estado = 'enviando' where liquidacion_externa_id = l2;
  exception when check_violation then rechazado := true; end;
  if not rechazado then raise exception '0643(g): enviando sin token debía rechazarse'; end if;
  rechazado := false;
  begin
    update public.liquidacion_aviso_discrepancia set estado = 'enviado' where liquidacion_externa_id = l2;
  exception when check_violation then rechazado := true; end;
  if not rechazado then raise exception '0643(g): enviado sin hora debía rechazarse'; end if;
end $$;

-- (g) permisos
reset role;
set local role authenticated;
do $$
declare rechazado boolean := false;
begin
  begin
    perform public.registrar_acuse_no_coincide('64300000-0000-4000-8000-0000000000a1', '64300000-0000-4000-8000-0000000000d1', '64300000-0000-4000-8000-0000000000a2');
  exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception '0643(g): authenticated NO debía poder acusar por la RPC'; end if;
  rechazado := false;
  begin
    insert into public.liquidacion_aviso_discrepancia (liquidacion_externa_id, tenant_id, ciclo)
    values ('64300000-0000-4000-8000-0000000000d1', '64300000-0000-4000-8000-0000000000a1', 9);
  exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception '0643(g): authenticated NO debía poder escribir la tabla'; end if;
end $$;
reset role;

-- (f) cascada
do $$
declare n int;
begin
  delete from public.liquidacion_externa where id = '64300000-0000-4000-8000-0000000000d1';
  select count(*) into n from public.liquidacion_aviso_discrepancia where liquidacion_externa_id = '64300000-0000-4000-8000-0000000000d1';
  if n <> 0 then raise exception '0643(f): borrar la liquidación debía borrar sus avisos (quedan %)', n; end if;
end $$;

rollback;
