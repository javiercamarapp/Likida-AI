\set ON_ERROR_STOP on
-- 0787 — Liquidación por correo: cola de entrega por destinatario y reclamo atómico.
-- Contra Postgres real. Prueba lo que solo la base garantiza:
--   (a) la FK compuesta impide colgar una entrega de la liquidación de OTRA flota;
--   (b) purgar la liquidación borra sus entregas en cascada;
--   (c) unicidad por (liquidación, generación, rol, correo sin importar mayúsculas);
--       otra generación o otro rol del mismo correo SÍ caben;
--   (d) dominios y formas (rol, estado, disparo, correo, sha256, lease coherente);
--   (e) resend_id único cuando existe, repetible cuando es nulo;
--   (f) reclamar: dos llamadas consecutivas no devuelven la misma fila, respeta
--       límite y orden, ignora lo futuro y lo ya entregado, valida argumentos;
--   (g) un lease vencido se re-reclama con token nuevo; uno vigente no;
--   (h) la función solo la ejecuta service_role (revoke/grant);
--   (i) la tabla nace con RLS y authenticated no escribe.
-- Datos sintéticos (sin personas ni empresas reales).
begin;

insert into public.tenant (id, nombre) values
  ('78700000-0000-4000-8000-0000000000a1', 'Flota A 0787'),
  ('78700000-0000-4000-8000-0000000000b1', 'Flota B 0787');

insert into public.operador (id, tenant_id, nombre, telefono) values
  ('78700000-0000-4000-8000-0000000000a2', '78700000-0000-4000-8000-0000000000a1', 'Operador Uno', '5215500000001'),
  ('78700000-0000-4000-8000-0000000000b2', '78700000-0000-4000-8000-0000000000b1', 'Operador Dos', '5215500000002');

set local role service_role;

insert into public.liquidacion_externa
  (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, estado, acuse_tipo, acuse_en, created_at)
values
  ('78700000-0000-4000-8000-0000000000d1', '78700000-0000-4000-8000-0000000000a1', 'V1', repeat('a',64), '78700000-0000-4000-8000-0000000000a2', '2020-01-01','2020-01-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'acusada', 'recibida', now() - interval '70 months', now() - interval '70 months'),
  ('78700000-0000-4000-8000-0000000000d2', '78700000-0000-4000-8000-0000000000a1', 'R1', repeat('b',64), '78700000-0000-4000-8000-0000000000a2', '2026-09-01','2026-09-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'pendiente', null, null, now()),
  ('78700000-0000-4000-8000-0000000000d3', '78700000-0000-4000-8000-0000000000b1', 'R1', repeat('c',64), '78700000-0000-4000-8000-0000000000b2', '2026-09-01','2026-09-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'pendiente', null, null, now());

do $$
declare
  v_falla boolean; n int; c int;
  A  constant uuid := '78700000-0000-4000-8000-0000000000a1';
  B  constant uuid := '78700000-0000-4000-8000-0000000000b1';
  L1 constant uuid := '78700000-0000-4000-8000-0000000000d1';  -- A, vieja
  L2 constant uuid := '78700000-0000-4000-8000-0000000000d2';  -- A, reciente
  L3 constant uuid := '78700000-0000-4000-8000-0000000000d3';  -- B
  T0 constant timestamptz := '2026-10-01 12:00:00+00';
  r1 public.liquidacion_entrega_correo;
  r2 public.liquidacion_entrega_correo;
  id_a uuid; id_b uuid; id_c uuid; id_d uuid;
  tok1 uuid;
begin
  -- ── (c) unicidad / idempotencia ────────────────────────────────────────────
  insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo)
    values (A, L2, 'operador', 'op.uno@ejemplo.test');
  begin
    insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo)
      values (A, L2, 'operador', 'OP.Uno@Ejemplo.TEST');
    v_falla := false;
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO c1: el mismo correo con otras mayúsculas duplicó la entrega'; end if;
  -- Otra generación, y otro rol con el mismo correo, SÍ caben.
  insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, generacion, rol, correo)
    values (A, L2, 2, 'operador', 'op.uno@ejemplo.test');
  insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo)
    values (A, L2, 'rh', 'op.uno@ejemplo.test');
  select count(*) into c from public.liquidacion_entrega_correo where liquidacion_externa_id = L2;
  if c <> 3 then raise exception 'FALLO c2: se esperaban 3 entregas de L2 y hay %', c; end if;
  -- Defaults.
  select * into r1 from public.liquidacion_entrega_correo
    where liquidacion_externa_id = L2 and generacion = 1 and rol = 'operador';
  if r1.estado <> 'pendiente' or r1.intentos <> 0 or r1.disparo <> 'auto'
     or r1.claim_token is not null or r1.claim_expira_en is not null then
    raise exception 'FALLO c3: defaults inesperados (%, %, %)', r1.estado, r1.intentos, r1.disparo;
  end if;

  -- ── (a) FK compuesta: liquidación de otra flota ────────────────────────────
  begin
    insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo)
      values (A, L3, 'operador', 'x@ejemplo.test');
    v_falla := false;
  exception when foreign_key_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO a1: se colgó una entrega de la liquidación de otra flota'; end if;

  -- ── (b) purga en cascada ───────────────────────────────────────────────────
  insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo)
    values (A, L1, 'archivo', 'archivo@ejemplo.test');
  delete from public.liquidacion_externa where id = L1;
  select count(*) into c from public.liquidacion_entrega_correo where liquidacion_externa_id = L1;
  if c <> 0 then raise exception 'FALLO b1: borrar la liquidación dejó % entregas', c; end if;

  -- ── (d) dominios y formas ──────────────────────────────────────────────────
  begin insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo) values (A, L2, 'jefe', 'a@ejemplo.test'); v_falla := false;
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d1: rol inválido aceptado'; end if;
  begin insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo, estado) values (A, L2, 'rh', 'b@ejemplo.test', 'volando'); v_falla := false;
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d2: estado inválido aceptado'; end if;
  begin insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo, disparo) values (A, L2, 'rh', 'c@ejemplo.test', 'hechizo'); v_falla := false;
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d3: disparo inválido aceptado'; end if;
  begin insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo) values (A, L2, 'rh', 'no es correo'); v_falla := false;
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d4: correo sin forma aceptado'; end if;
  begin insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo, xlsx_sha256) values (A, L2, 'rh', 'd@ejemplo.test', 'zzz'); v_falla := false;
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d5: sha256 sin forma aceptado'; end if;
  begin insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo, claim_token) values (A, L2, 'rh', 'e@ejemplo.test', gen_random_uuid()); v_falla := false;
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d6: lease a medias (token sin vencimiento) aceptado'; end if;
  begin insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, generacion, rol, correo) values (A, L2, 0, 'rh', 'f@ejemplo.test'); v_falla := false;
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d7: generacion 0 aceptada'; end if;

  -- ── (e) resend_id ──────────────────────────────────────────────────────────
  update public.liquidacion_entrega_correo set resend_id = 're_0787_a'
    where liquidacion_externa_id = L2 and generacion = 1 and rol = 'operador';
  begin
    update public.liquidacion_entrega_correo set resend_id = 're_0787_a'
      where liquidacion_externa_id = L2 and generacion = 2;
    v_falla := false;
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO e1: dos entregas con el mismo resend_id'; end if;
  -- Varias con resend_id nulo conviven (ya hay dos en L2).

  -- ── (f) reclamar: límite, orden, exclusiones ───────────────────────────────
  delete from public.liquidacion_entrega_correo;
  insert into public.liquidacion_entrega_correo (id, tenant_id, liquidacion_externa_id, rol, correo, proximo_intento_en) values
    ('78700000-0000-4000-8000-00000000e001', A, L2, 'operador',    'p1@ejemplo.test', T0 - interval '3 hours'),
    ('78700000-0000-4000-8000-00000000e002', A, L2, 'coordinador', 'p2@ejemplo.test', T0 - interval '2 hours'),
    ('78700000-0000-4000-8000-00000000e003', A, L2, 'rh',          'p3@ejemplo.test', T0 - interval '1 hour');
  insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo, proximo_intento_en) values
    (A, L2, 'archivo', 'futuro@ejemplo.test', T0 + interval '1 hour');
  insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, generacion, rol, correo, estado) values
    (A, L2, 2, 'operador', 'ent@ejemplo.test', 'entregada'),
    (A, L2, 2, 'rh',       'reb@ejemplo.test', 'rebotada'),
    (A, L2, 2, 'coordinador', 'omi@ejemplo.test', 'omitida');

  -- Primer reclamo: límite 2, las más antiguas primero.
  select count(*) into c from public.reclamar_entregas_correo(2, T0, 120);
  if c <> 2 then raise exception 'FALLO f1: reclamar(2) devolvió % filas', c; end if;
  select count(*) into c from public.liquidacion_entrega_correo
    where id in ('78700000-0000-4000-8000-00000000e001', '78700000-0000-4000-8000-00000000e002')
      and estado = 'enviando' and claim_token is not null and claim_expira_en = T0 + interval '120 seconds' and updated_at = T0;
  if c <> 2 then raise exception 'FALLO f2: las dos más antiguas no quedaron enviando con lease (%)', c; end if;

  -- Segundo reclamo consecutivo: solo la que falta; jamás repite las ya tomadas.
  select count(*) into c from public.reclamar_entregas_correo(10, T0, 120);
  if c <> 1 then raise exception 'FALLO f3: el segundo reclamo devolvió % filas (se esperaba 1)', c; end if;
  select estado into r1.estado from public.liquidacion_entrega_correo where id = '78700000-0000-4000-8000-00000000e003';
  if r1.estado <> 'enviando' then raise exception 'FALLO f4: la tercera no quedó enviando (%)', r1.estado; end if;

  -- Tercer reclamo: nada listo (la futura espera, lo terminal no se toca, los leases siguen vigentes).
  select count(*) into c from public.reclamar_entregas_correo(10, T0, 120);
  if c <> 0 then raise exception 'FALLO f5: el tercer reclamo devolvió % filas (se esperaban 0)', c; end if;
  select count(*) into c from public.liquidacion_entrega_correo where estado in ('entregada','rebotada','omitida');
  if c <> 3 then raise exception 'FALLO f6: se tocaron filas terminales'; end if;
  select estado into r1.estado from public.liquidacion_entrega_correo where correo = 'futuro@ejemplo.test';
  if r1.estado <> 'pendiente' then raise exception 'FALLO f7: se reclamó una entrega futura'; end if;

  -- Argumentos inválidos.
  begin perform public.reclamar_entregas_correo(0, T0, 120); v_falla := false; exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO f8: limite 0 aceptado'; end if;
  begin perform public.reclamar_entregas_correo(501, T0, 120); v_falla := false; exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO f9: limite 501 aceptado'; end if;
  begin perform public.reclamar_entregas_correo(5, T0, 0); v_falla := false; exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO f10: lease 0 aceptado'; end if;
  begin perform public.reclamar_entregas_correo(5, null, 120); v_falla := false; exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO f11: ahora nulo aceptado'; end if;

  -- ── (g) lease vencido ──────────────────────────────────────────────────────
  select claim_token into tok1 from public.liquidacion_entrega_correo where id = '78700000-0000-4000-8000-00000000e001';
  -- Un segundo antes de vencer: sigue vigente.
  select count(*) into c from public.reclamar_entregas_correo(10, T0 + interval '119 seconds', 120);
  if c <> 0 then raise exception 'FALLO g1: se re-reclamó un lease vigente (%)', c; end if;
  -- Vencido: las tres se re-reclaman con token nuevo y el lease se renueva.
  select count(*) into c from public.reclamar_entregas_correo(10, T0 + interval '121 seconds', 300);
  if c <> 3 then raise exception 'FALLO g2: el lease vencido re-reclamó % filas (se esperaban 3)', c; end if;
  select * into r1 from public.liquidacion_entrega_correo where id = '78700000-0000-4000-8000-00000000e001';
  if r1.claim_token = tok1 then raise exception 'FALLO g3: el token no cambió al re-reclamar'; end if;
  if r1.estado <> 'enviando' or r1.claim_expira_en <> T0 + interval '121 seconds' + interval '300 seconds' then
    raise exception 'FALLO g4: lease mal renovado (%, %)', r1.estado, r1.claim_expira_en;
  end if;

  -- ── (e/g) pendiente futura pasa a reclamable cuando llega su hora ──────────
  select count(*) into c from public.reclamar_entregas_correo(10, T0 + interval '2 hours', 120);
  -- Las tres ya reclamadas siguen con lease vigente (T0+121s+300s < T0+2h → vencido!). Se espera 3 + 1 futura.
  if c <> 4 then raise exception 'FALLO g5: a T0+2h se esperaban 4 filas listas y hay %', c; end if;
end $$;

-- ── (h) permisos de la función ──────────────────────────────────────────────
do $$
declare
  v_falla boolean;
begin
  if has_function_privilege('anon', 'public.reclamar_entregas_correo(integer, timestamptz, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.reclamar_entregas_correo(integer, timestamptz, integer)', 'execute') then
    raise exception 'FALLO h1: anon o authenticated pueden ejecutar reclamar_entregas_correo';
  end if;
  if not has_function_privilege('service_role', 'public.reclamar_entregas_correo(integer, timestamptz, integer)', 'execute') then
    raise exception 'FALLO h2: service_role no puede ejecutar reclamar_entregas_correo';
  end if;
  -- security definer con search_path vacío.
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.reclamar_entregas_correo(integer, timestamptz, integer)'::regprocedure
      and p.prosecdef and 'search_path=""' = any (p.proconfig)
  ) then
    raise exception 'FALLO h3: reclamar_entregas_correo no es security definer con search_path vacío';
  end if;
end $$;

-- ── (i) RLS: la tabla nace con RLS y authenticated no escribe ───────────────
reset role;
do $$
declare
  v_falla boolean;
begin
  if not exists (
    select 1 from pg_class where oid = 'public.liquidacion_entrega_correo'::regclass and relrowsecurity
  ) then
    raise exception 'FALLO i1: liquidacion_entrega_correo sin RLS';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'liquidacion_entrega_correo' and cmd <> 'SELECT'
  ) then
    raise exception 'FALLO i2: hay una política de escritura en liquidacion_entrega_correo';
  end if;
end $$;

set local role authenticated;
do $$
declare v_falla boolean;
begin
  begin
    insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo)
      values ('78700000-0000-4000-8000-0000000000a1', '78700000-0000-4000-8000-0000000000d2', 'rh', 'auth@ejemplo.test');
    v_falla := false;
  exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO i3: authenticated pudo insertar'; end if;
  begin
    perform public.reclamar_entregas_correo(1, now(), 120);
    v_falla := false;
  exception when insufficient_privilege then v_falla := true; end;
  if not v_falla then raise exception 'FALLO i4: authenticated pudo ejecutar el reclamo'; end if;
end $$;
reset role;

do $$ begin raise notice '0787: ok'; end $$;
rollback;
