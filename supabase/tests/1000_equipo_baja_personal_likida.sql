\set ON_ERROR_STOP on
-- 1000 — equipo_baja_personal_likida(p_usuario, p_actor): baja del personal de Likida (tenant_id nulo: superadmin y vendedor) con el
-- candado «nunca el último superadmin activo» DENTRO de la base. Contra Postgres REAL. La carrera de verdad (dos sesiones traslapadas)
-- vive en 1000_equipo_baja_personal_likida_concurrencia.sh; este archivo cubre lo que una sola sesión ya demuestra:
--   (0) IDEMPOTENCIA: la migración se aplica DOS veces más sobre la base ya migrada sin error y sin cambiar la definición ni los permisos;
--   (a) con 2 superadmins activos, dar de baja a uno pasa ('ok'), sella desactivado_en/_por y deja exactamente 1;
--   (b) con 1 solo superadmin activo, darlo de baja rebota ('ultimo_superadmin') y NO cambia nada;
--   (c) uno mismo rebota ('uno_mismo') aunque sobren superadmins;
--   (d) un vendedor se da de baja ('ok') aunque no haya más superadmins que el actor; la baja no toca a nadie más;
--   (e) 'conflicto': ya inactivo, inexistente, o fuera del alcance (flota_admin/contador/nomina de una flota, o superadmin con tenant): NO se toca;
--   (f) NO rompe a los demás roles: equipo_desactivar_usuario (0846) sigue operando la flota y el personal de las flotas queda intacto;
--   (g) permisos: anon/authenticated sin EXECUTE; service_role sí; security definer con search_path vacío.
-- Termina en rollback salvo la fase (0), que solo reaplica la migración (sin datos).

-- ── (0) idempotencia: huella antes y después de reaplicar dos veces ───────────────────────────────
create temp table _h1000 as
  select md5(pg_get_functiondef('public.equipo_baja_personal_likida(uuid,uuid)'::regprocedure)) as def,
         (select proacl::text from pg_proc where oid = 'public.equipo_baja_personal_likida(uuid,uuid)'::regprocedure) as acl,
         (select obj_description('public.equipo_baja_personal_likida(uuid,uuid)'::regprocedure, 'pg_proc')) as coment;
\i supabase/migrations/1000_equipo_baja_personal_likida.sql
\i supabase/migrations/1000_equipo_baja_personal_likida.sql
do $$
declare h record; n int;
begin
  select * into h from _h1000;
  if md5(pg_get_functiondef('public.equipo_baja_personal_likida(uuid,uuid)'::regprocedure)) <> h.def then
    raise exception '1000(0): reaplicar la migración cambió la definición de la función';
  end if;
  if (select proacl::text from pg_proc where oid = 'public.equipo_baja_personal_likida(uuid,uuid)'::regprocedure) is distinct from h.acl then
    raise exception '1000(0): reaplicar la migración cambió los permisos';
  end if;
  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'equipo_baja_personal_likida';
  if n <> 1 then raise exception '1000(0): debe existir una sola sobrecarga, hay %', n; end if;
end $$;

begin;

-- El personal real (si existiera en la base) no debe contar: se aparta dentro de esta transacción.
update public.app_user set activo = false, desactivado_en = now() where tenant_id is null and rol in ('superadmin', 'vendedor');

insert into public.tenant (id, nombre) values ('10000000-0000-4000-8000-0000000000f1', 'Flota 1000');
insert into public.app_user (id, tenant_id, email, rol, activo) values
  ('10000000-0000-4000-8000-0000000000a1', null, 'sa1-1000@test.invalid', 'superadmin', true),
  ('10000000-0000-4000-8000-0000000000a2', null, 'sa2-1000@test.invalid', 'superadmin', true),
  ('10000000-0000-4000-8000-0000000000b1', null, 'vend-1000@test.invalid', 'vendedor', true),
  ('10000000-0000-4000-8000-0000000000b2', null, 'vend2-1000@test.invalid', 'vendedor', true),
  ('10000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000f1', 'duena-1000@test.invalid', 'flota_admin', true),
  ('10000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000f1', 'duena2-1000@test.invalid', 'flota_admin', true),
  ('10000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000f1', 'conta-1000@test.invalid', 'contador', true),
  ('10000000-0000-4000-8000-0000000000c4', '10000000-0000-4000-8000-0000000000f1', 'nomina-1000@test.invalid', 'nomina', true),
  ('10000000-0000-4000-8000-0000000000c9', null, 'inactivo-1000@test.invalid', 'vendedor', true);
update public.app_user set activo = false, desactivado_en = now() where id = '10000000-0000-4000-8000-0000000000c9';

set local role service_role;

-- ── (a) con 2 superadmins activos, la baja de uno pasa ────────────────────────────────────────────
do $$
declare v text;
begin
  v := public.equipo_baja_personal_likida('10000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a1');
  if v <> 'ok' then raise exception '1000(a): con 2 superadmins activos la baja debía pasar (motivo %)', v; end if;
  if (select activo from public.app_user where id = '10000000-0000-4000-8000-0000000000a2') then raise exception '1000(a): el usuario sigue activo'; end if;
  if (select desactivado_en from public.app_user where id = '10000000-0000-4000-8000-0000000000a2') is null then raise exception '1000(a): no selló desactivado_en'; end if;
  if (select desactivado_por from public.app_user where id = '10000000-0000-4000-8000-0000000000a2') is distinct from '10000000-0000-4000-8000-0000000000a1'::uuid then
    raise exception '1000(a): no selló desactivado_por con el actor';
  end if;
  if (select count(*) from public.app_user where tenant_id is null and rol = 'superadmin' and activo) <> 1 then
    raise exception '1000(a): debía quedar exactamente un superadmin activo';
  end if;
end $$;

-- ── (b) con 1 solo superadmin activo, la baja rebota y no cambia nada ──────────────────────────────
do $$
declare v text;
begin
  v := public.equipo_baja_personal_likida('10000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000b1');
  if v <> 'ultimo_superadmin' then raise exception '1000(b): se esperaba ultimo_superadmin y salió %', v; end if;
  if not (select activo from public.app_user where id = '10000000-0000-4000-8000-0000000000a1') then raise exception '1000(b): el último superadmin quedó inactivo'; end if;
  if (select desactivado_en from public.app_user where id = '10000000-0000-4000-8000-0000000000a1') is not null then raise exception '1000(b): selló desactivado_en pese al rebote'; end if;
end $$;

-- ── (c) uno mismo ─────────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  v := public.equipo_baja_personal_likida('10000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1');
  if v <> 'uno_mismo' then raise exception '1000(c): se esperaba uno_mismo y salió %', v; end if;
  v := public.equipo_baja_personal_likida('10000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1');
  if v <> 'uno_mismo' then raise exception '1000(c): un vendedor tampoco puede darse de baja a sí mismo (salió %)', v; end if;
  if not (select activo from public.app_user where id = '10000000-0000-4000-8000-0000000000b1') then raise exception '1000(c): uno_mismo tocó la fila'; end if;
end $$;

-- ── (d) un vendedor se da de baja aunque el actor sea el único superadmin; no toca a nadie más ─────
do $$
declare v text; antes int; despues int;
begin
  select count(*) into antes from public.app_user where activo and id <> '10000000-0000-4000-8000-0000000000b2';
  v := public.equipo_baja_personal_likida('10000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000a1');
  if v <> 'ok' then raise exception '1000(d): la baja de un vendedor debía pasar (motivo %)', v; end if;
  if (select activo from public.app_user where id = '10000000-0000-4000-8000-0000000000b2') then raise exception '1000(d): el vendedor sigue activo'; end if;
  select count(*) into despues from public.app_user where activo and id <> '10000000-0000-4000-8000-0000000000b2';
  if antes <> despues then raise exception '1000(d): la baja del vendedor tocó a otros usuarios (% -> %)', antes, despues; end if;
end $$;

-- ── (e) conflicto: ya inactivo, inexistente, o fuera del alcance (roles de flota) ──────────────────
do $$
declare v text; u text;
begin
  v := public.equipo_baja_personal_likida('10000000-0000-4000-8000-0000000000c9', '10000000-0000-4000-8000-0000000000a1');
  if v <> 'conflicto' then raise exception '1000(e): ya inactivo debía dar conflicto (salió %)', v; end if;
  v := public.equipo_baja_personal_likida('10000000-0000-4000-8000-00000000ffff', '10000000-0000-4000-8000-0000000000a1');
  if v <> 'conflicto' then raise exception '1000(e): inexistente debía dar conflicto (salió %)', v; end if;
  foreach u in array array['c1', 'c3', 'c4'] loop
    v := public.equipo_baja_personal_likida(('10000000-0000-4000-8000-0000000000' || u)::uuid, '10000000-0000-4000-8000-0000000000a1');
    if v <> 'conflicto' then raise exception '1000(e): un usuario de flota (%) no es personal de Likida: conflicto esperado, salió %', u, v; end if;
    if not (select activo from public.app_user where id = ('10000000-0000-4000-8000-0000000000' || u)::uuid) then
      raise exception '1000(e): la función desactivó a un usuario de flota (%)', u;
    end if;
  end loop;
end $$;

-- ── (f) no rompe a los demás roles: el candado de flota (0846) sigue operando y el personal de flotas queda intacto ──
do $$
declare v text;
begin
  v := public.equipo_desactivar_usuario('10000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000c1', 'flota_admin', '10000000-0000-4000-8000-0000000000c2');
  if v <> 'ok' then raise exception '1000(f): equipo_desactivar_usuario (0846) debía seguir dando ok con 2 dueños (salió %)', v; end if;
  v := public.equipo_desactivar_usuario('10000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000c2', 'flota_admin', '10000000-0000-4000-8000-0000000000c1');
  if v <> 'ultimo_dueno' then raise exception '1000(f): 0846 debía seguir protegiendo al último dueño (salió %)', v; end if;
  if (select count(*) from public.app_user where tenant_id = '10000000-0000-4000-8000-0000000000f1' and activo) <> 3 then
    raise exception '1000(f): el personal de la flota debía quedar en 3 activos (c2, c3, c4)';
  end if;
end $$;

-- ── (g) permisos y forma de la función ────────────────────────────────────────────────────────────
reset role;
do $$
declare n int; r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.equipo_baja_personal_likida(uuid,uuid)', 'execute') then
      raise exception '1000(g): % no debe poder ejecutar la función', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.equipo_baja_personal_likida(uuid,uuid)', 'execute') then
    raise exception '1000(g): service_role debía poder ejecutar la función';
  end if;
  select count(*) into n from pg_proc
   where oid = 'public.equipo_baja_personal_likida(uuid,uuid)'::regprocedure and prosecdef and proconfig @> array['search_path=""'];
  if n <> 1 then raise exception '1000(g): la función debe ser security definer con search_path vacío'; end if;
end $$;
-- anon/authenticated reciben 42501 al llamarla
set local role authenticated;
do $$
begin
  perform public.equipo_baja_personal_likida('10000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000a1');
  raise exception '1000(g): authenticated pudo llamar la función';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
\echo '1000 PASS: equipo_baja_personal_likida — idempotente; ok/uno_mismo/ultimo_superadmin/conflicto; no toca roles de flota; permisos cerrados.'
