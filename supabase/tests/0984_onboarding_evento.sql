\set ON_ERROR_STOP on
-- 0984 — onboarding_evento contra Postgres REAL: lista cerrada de tipos, actor seudonimo, sin texto libre, poda y privilegios. Rollback.
begin;

insert into public.tenant (id, nombre) values ('98400000-0000-4000-8000-0000000000a1', 'Flota A 0984');

do $$
declare
  ta constant uuid := '98400000-0000-4000-8000-0000000000a1';
  act constant text := repeat('a1', 8);
  n int; priv boolean; sec boolean;
begin
  -- 1. Un evento valido entra.
  insert into public.onboarding_evento (tenant_id, actor, pista, rol, perfil, tipo, recorrido, paso_id, valor_ms, canal)
  values (ta, act, 'dueno', 'flota_admin', 'cinco_agentes', 'paso_hecho_senal', 'dueno.corto', 'PM2-03', 4200, 'escritorio');

  -- 2. Lista cerrada: un tipo inventado rebota.
  begin
    insert into public.onboarding_evento (tenant_id, actor, pista, rol, tipo, canal) values (ta, act, 'dueno', 'flota_admin', 'texto_libre', 'movil');
    raise exception '0984(2): un tipo fuera de la lista debia rebotar';
  exception when check_violation then null; end;

  -- 3. El actor solo puede ser un seudonimo de 16 hex: un correo, un uuid o texto libre rebotan.
  begin
    insert into public.onboarding_evento (tenant_id, actor, pista, rol, tipo, canal) values (ta, 'ana@empresa.mx', 'dueno', 'flota_admin', 'guia_inicio', 'movil');
    raise exception '0984(3): un correo como actor debia rebotar';
  exception when check_violation then null; end;
  begin
    insert into public.onboarding_evento (tenant_id, actor, pista, rol, tipo, canal) values (ta, gen_random_uuid()::text, 'dueno', 'flota_admin', 'guia_inicio', 'movil');
    raise exception '0984(3): un uuid como actor debia rebotar';
  exception when check_violation then null; end;

  -- 4. Canal cerrado, valores no negativos y largos acotados.
  begin
    insert into public.onboarding_evento (tenant_id, actor, pista, rol, tipo, canal) values (ta, act, 'dueno', 'flota_admin', 'guia_inicio', 'tablet');
    raise exception '0984(4): un canal inventado debia rebotar';
  exception when check_violation then null; end;
  begin
    insert into public.onboarding_evento (tenant_id, actor, pista, rol, tipo, canal, valor_ms) values (ta, act, 'dueno', 'flota_admin', 'guia_inicio', 'movil', -1);
    raise exception '0984(4): un valor negativo debia rebotar';
  exception when check_violation then null; end;
  begin
    insert into public.onboarding_evento (tenant_id, actor, pista, rol, tipo, canal, paso_id) values (ta, act, 'dueno', 'flota_admin', 'guia_inicio', 'movil', repeat('x', 41));
    raise exception '0984(4): un paso_id de mas de 40 caracteres debia rebotar';
  exception when check_violation then null; end;

  -- 5. Poda: lo mas viejo que el piso de 30 dias se va aunque se pida menos; lo reciente se queda.
  insert into public.onboarding_evento (tenant_id, actor, pista, rol, tipo, canal, creado_en) values
    (ta, act, 'dueno', 'flota_admin', 'guia_inicio', 'movil', now() - interval '200 days'),
    (ta, act, 'dueno', 'flota_admin', 'guia_inicio', 'movil', now() - interval '40 days'),
    (ta, act, 'dueno', 'flota_admin', 'guia_inicio', 'movil', now() - interval '5 days');
  n := public.podar_onboarding_evento(180);
  if n <> 1 then raise exception '0984(5): con 180 dias debia podar 1 fila, podo %', n; end if;
  n := public.podar_onboarding_evento(1);
  if n <> 1 then raise exception '0984(5): con piso de 30 dias debia podar solo la de 40 dias, podo %', n; end if;
  select count(*) into n from public.onboarding_evento where tenant_id = ta;
  if n <> 2 then raise exception '0984(5): debian quedar 2 filas recientes, quedan %', n; end if;

  -- 6. Seguridad: RLS sin politicas, sin privilegios para anon/authenticated, CRUD acotado para service_role, funcion solo service_role.
  if not (select relrowsecurity from pg_class where oid = 'public.onboarding_evento'::regclass) then raise exception '0984(6): RLS debia estar prendida'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'onboarding_evento';
  if n <> 0 then raise exception '0984(6): no debe haber politicas, hay %', n; end if;
  select count(*) into n from unnest(array['anon', 'authenticated']) r
   where has_table_privilege(r, 'public.onboarding_evento', 'select,insert,update,delete,truncate,references,trigger');
  if n <> 0 then raise exception '0984(6): anon/authenticated/public no deben tener privilegios (hay %)', n; end if;
  priv := has_table_privilege('service_role', 'public.onboarding_evento', 'select,insert,delete');
  if not priv then raise exception '0984(6): service_role debia poder insertar, leer y borrar'; end if;
  select p.prosecdef into sec from pg_proc p where p.oid = 'public.podar_onboarding_evento(integer)'::regprocedure;
  if not sec then raise exception '0984(6): la poda debia ser security definer'; end if;
  if has_function_privilege('anon', 'public.podar_onboarding_evento(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.podar_onboarding_evento(integer)', 'execute') then
    raise exception '0984(6): anon/authenticated no deben ejecutar la poda';
  end if;
  if not has_function_privilege('service_role', 'public.podar_onboarding_evento(integer)', 'execute') then raise exception '0984(6): service_role debia ejecutar la poda'; end if;
end $$;

rollback;
