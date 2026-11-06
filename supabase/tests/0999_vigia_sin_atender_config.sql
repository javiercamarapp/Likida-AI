\set ON_ERROR_STOP on
-- 0999 — vigia_sin_atender_config contra Postgres REAL. Datos sintéticos, termina en rollback. Lo que solo la base garantiza:
--   (a) forma: una fila por flota (PK), rangos de insistencia y umbral, topes de listas, horario con forma exacta (hora de cierre mayor);
--   (b) defaults en la tabla: todo apagado (resumen_correo_habilitado = false, sin horario, sin equipo);
--   (c) PRIVILEGIOS: anon/authenticated no tocan la tabla (default cerrado) y, con una lectura concedida a propósito DENTRO de esta transacción
--       (rollback), la política por flota aísla: la flota A solo ve lo suyo, la B solo lo suyo, quien no atiende clientes no ve nada;
--   (d) nadie escribe por REST (anon/authenticated); el servicio sí;
--   (e) borrar la flota se lleva su configuración.
begin;

insert into public.tenant (id, nombre) values
  ('09990000-0000-4000-8000-0000000000a1', 'Flota A 0999'),
  ('09990000-0000-4000-8000-0000000000b1', 'Flota B 0999');
insert into public.app_user (id, tenant_id, email, rol) values
  ('09990000-0000-4000-8000-0000000000c1', '09990000-0000-4000-8000-0000000000a1', 'dueno-0999@test.invalid', 'flota_admin'),
  ('09990000-0000-4000-8000-0000000000c3', '09990000-0000-4000-8000-0000000000a1', 'contador-0999@test.invalid', 'contador'),
  ('09990000-0000-4000-8000-0000000000c4', '09990000-0000-4000-8000-0000000000b1', 'dueno-b-0999@test.invalid', 'flota_admin');

set local role service_role;

do $$
declare
  ta constant uuid := '09990000-0000-4000-8000-0000000000a1';
  tb constant uuid := '09990000-0000-4000-8000-0000000000b1';
  r record;
begin
  -- (b) defaults: todo apagado.
  insert into public.vigia_sin_atender_config (tenant_id) values (ta);
  select * into r from public.vigia_sin_atender_config where tenant_id = ta;
  if r.resumen_correo_habilitado is not false then raise exception '0999(b): el resumen debía nacer apagado'; end if;
  if r.horario_atencion is not null or cardinality(r.equipo_nombres) <> 0 or cardinality(r.palabras_clave) <> 0 then raise exception '0999(b): debía nacer sin horario, sin equipo y sin palabras'; end if;
  if r.insistencia_min <> 2 or r.umbral_urgente_min <> 10 then raise exception '0999(b): defaults de insistencia/umbral inesperados'; end if;

  -- (a) una fila por flota.
  begin insert into public.vigia_sin_atender_config (tenant_id) values (ta); raise exception '0999(a): segunda fila de la misma flota aceptada';
  exception when unique_violation then null; end;
  -- rangos
  begin insert into public.vigia_sin_atender_config (tenant_id, insistencia_min) values (tb, 51); raise exception '0999(a): insistencia 51 aceptada';
  exception when check_violation then null; end;
  begin insert into public.vigia_sin_atender_config (tenant_id, insistencia_min) values (tb, -1); raise exception '0999(a): insistencia -1 aceptada';
  exception when check_violation then null; end;
  begin insert into public.vigia_sin_atender_config (tenant_id, umbral_urgente_min) values (tb, 0); raise exception '0999(a): umbral 0 aceptado';
  exception when check_violation then null; end;
  begin insert into public.vigia_sin_atender_config (tenant_id, umbral_urgente_min) values (tb, 1441); raise exception '0999(a): umbral 1441 aceptado';
  exception when check_violation then null; end;
  -- listas
  begin insert into public.vigia_sin_atender_config (tenant_id, palabras_clave) values (tb, (select array_agg('p' || g) from generate_series(1, 31) g)); raise exception '0999(a): 31 palabras aceptadas';
  exception when check_violation then null; end;
  begin insert into public.vigia_sin_atender_config (tenant_id, equipo_nombres) values (tb, (select array_agg('n' || g) from generate_series(1, 101) g)); raise exception '0999(a): 101 nombres aceptados';
  exception when check_violation then null; end;
  -- horario
  begin insert into public.vigia_sin_atender_config (tenant_id, horario_atencion) values (tb, '{"desdeHora": 18, "hastaHora": 9}'::jsonb); raise exception '0999(a): cierre antes de la apertura aceptado';
  exception when check_violation then null; end;
  begin insert into public.vigia_sin_atender_config (tenant_id, horario_atencion) values (tb, '{"desdeHora": 24, "hastaHora": 24}'::jsonb); raise exception '0999(a): apertura 24 aceptada';
  exception when check_violation then null; end;
  begin insert into public.vigia_sin_atender_config (tenant_id, horario_atencion) values (tb, '[1,2]'::jsonb); raise exception '0999(a): horario que no es objeto aceptado';
  exception when check_violation then null; end;
  begin insert into public.vigia_sin_atender_config (tenant_id, horario_atencion) values (tb, '{"desdeHora": "x", "hastaHora": 9}'::jsonb); raise exception '0999(a): horario con texto aceptado';
  exception when check_violation then null; end;

  -- La flota B con datos propios y distintos.
  update public.vigia_sin_atender_config set horario_atencion = '{"desdeHora": 8, "hastaHora": 18, "diasHabiles": [1,2,3,4,5]}'::jsonb,
    equipo_nombres = array['Operador 1'], resumen_correo_habilitado = true where tenant_id = ta;
  insert into public.vigia_sin_atender_config (tenant_id, equipo_nombres, palabras_clave) values (tb, array['Operador 2'], array['embarque']);
end $$;

-- (c) PRIVILEGIOS y AISLAMIENTO entre flotas; (d) escritura.
reset role;
do $$
declare n integer;
begin
  -- Estado real: sin concesiones a anon/authenticated.
  if has_table_privilege('authenticated', 'public.vigia_sin_atender_config', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.vigia_sin_atender_config', 'select,insert,update,delete') then
    raise exception '0999(c): anon/authenticated no deben tener privilegios sobre la tabla';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.vigia_sin_atender_config'::regclass) then raise exception '0999(c): RLS debia estar prendida'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '09990000-0000-4000-8000-0000000000c1', true);
  begin perform 1 from public.vigia_sin_atender_config; raise exception '0999(c): un autenticado leyó sin que se le concediera';
  exception when insufficient_privilege then null; end;
  reset role;

  -- Segunda barrera: con la lectura concedida (solo en esta transacción), la política por flota aísla.
  grant select on table public.vigia_sin_atender_config to authenticated;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '09990000-0000-4000-8000-0000000000c1', true);
  select count(*) into n from public.vigia_sin_atender_config;
  if n <> 1 then raise exception '0999(c): el dueño de A debía ver 1 fila y ve %', n; end if;
  if exists (select 1 from public.vigia_sin_atender_config where tenant_id <> '09990000-0000-4000-8000-0000000000a1') then raise exception '0999(c): el dueño de A ve la fila de B'; end if;
  if exists (select 1 from public.vigia_sin_atender_config where 'Operador 2' = any(equipo_nombres)) then raise exception '0999(c): el dueño de A ve el equipo de B'; end if;
  -- quien no atiende clientes no ve nada
  perform set_config('request.jwt.claim.sub', '09990000-0000-4000-8000-0000000000c3', true);
  select count(*) into n from public.vigia_sin_atender_config;
  if n <> 0 then raise exception '0999(c): el contador ve % filas', n; end if;
  -- el dueño de B no ve lo de A
  perform set_config('request.jwt.claim.sub', '09990000-0000-4000-8000-0000000000c4', true);
  if exists (select 1 from public.vigia_sin_atender_config where tenant_id = '09990000-0000-4000-8000-0000000000a1') then raise exception '0999(c): el dueño de B ve la fila de A'; end if;
  select count(*) into n from public.vigia_sin_atender_config;
  if n <> 1 then raise exception '0999(c): el dueño de B debía ver 1 fila y ve %', n; end if;
  -- (d) nadie escribe por REST, ni con la lectura concedida
  begin insert into public.vigia_sin_atender_config (tenant_id) values ('09990000-0000-4000-8000-0000000000b1'); raise exception '0999(d): un autenticado insertó por REST';
  exception when insufficient_privilege then null; end;
  begin update public.vigia_sin_atender_config set resumen_correo_habilitado = true; raise exception '0999(d): un autenticado actualizó por REST';
  exception when insufficient_privilege then null; end;
  begin delete from public.vigia_sin_atender_config; raise exception '0999(d): un autenticado borró por REST';
  exception when insufficient_privilege then null; end;
  reset role;
  revoke select on table public.vigia_sin_atender_config from authenticated;
  set local role anon;
  begin perform 1 from public.vigia_sin_atender_config; raise exception '0999(d): anon leyó la tabla';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- (e) borrar la flota se lleva su configuración, sin tocar a la otra (con el dueño de la base).
do $$
begin
  delete from public.tenant where id = '09990000-0000-4000-8000-0000000000a1';
  if exists (select 1 from public.vigia_sin_atender_config where tenant_id = '09990000-0000-4000-8000-0000000000a1') then
    raise exception '0999(e): la configuración sobrevivió a la flota borrada';
  end if;
  if not exists (select 1 from public.vigia_sin_atender_config where tenant_id = '09990000-0000-4000-8000-0000000000b1') then
    raise exception '0999(e): borrar la flota A tocó a la flota B';
  end if;
end $$;

rollback;
