\set ON_ERROR_STOP on
-- 1002 — avisos por persona: SOLO service_role (ni anon ni authenticated tocan nada), marcar/desmarcar atómico y separado por persona y
-- ámbito, poda a 1000, dominios de preferencia y horario. Quién es la persona y qué ámbito le pertenece lo decide el servidor
-- (ui-v2/avisos/acciones.ts), lo cubren sus pruebas de aplicación; aquí se prueba que la base no mezcla personas ni ámbitos.
begin;

insert into public.tenant (id, nombre) values
  ('10020000-0000-4000-8000-0000000000a1', 'Flota A 1002'),
  ('10020000-0000-4000-8000-0000000000b1', 'Flota B 1002');
-- Las personas existen en auth.users SOLO donde hay esquema auth de Supabase (pila local y producción, donde la 1002 pone la FK);
-- el Postgres efímero del CI no lo trae y app_user.id = auth.users.id va sin FK por convención del repo.
do $$
begin
  if to_regclass('auth.users') is not null then
    execute $q$
      insert into auth.users (id, email) values
        ('10020000-0000-4000-8000-0000000000c1', 'dueno-a-1002@test.invalid'),
        ('10020000-0000-4000-8000-0000000000c2', 'contador-a-1002@test.invalid'),
        ('10020000-0000-4000-8000-0000000000c3', 'dueno-b-1002@test.invalid'),
        ('10020000-0000-4000-8000-0000000000c4', 'super-1002@test.invalid')
      on conflict (id) do nothing
    $q$;
  end if;
end $$;
insert into public.app_user (id, tenant_id, email, rol) values
  ('10020000-0000-4000-8000-0000000000c1', '10020000-0000-4000-8000-0000000000a1', 'dueno-a-1002@test.invalid', 'flota_admin'),
  ('10020000-0000-4000-8000-0000000000c2', '10020000-0000-4000-8000-0000000000a1', 'contador-a-1002@test.invalid', 'contador'),
  ('10020000-0000-4000-8000-0000000000c3', '10020000-0000-4000-8000-0000000000b1', 'dueno-b-1002@test.invalid', 'flota_admin'),
  ('10020000-0000-4000-8000-0000000000c4', null, 'super-1002@test.invalid', 'superadmin');

do $$
declare
  fa text := '10020000-0000-4000-8000-0000000000a1';
  fb text := '10020000-0000-4000-8000-0000000000b1';
  u1 uuid := '10020000-0000-4000-8000-0000000000c1';
  u2 uuid := '10020000-0000-4000-8000-0000000000c2';
  u3 uuid := '10020000-0000-4000-8000-0000000000c3';
  u4 uuid := '10020000-0000-4000-8000-0000000000c4';
  n integer;
begin
  set local role service_role;

  -- (a) El dueño de A marca dos avisos de su flota (una clave repetida); es idempotente.
  n := public.aviso_marcar(u1, fa, array['huerfanos|3', 'por-revisar|2', 'huerfanos|3'], true);
  if n <> 2 then raise exception '1002: marcar dos claves (una repetida) devolvió %', n; end if;
  n := public.aviso_marcar(u1, fa, array['huerfanos|3'], true);
  if n <> 0 then raise exception '1002: repetir una clave ya leída devolvió %', n; end if;
  if (select count(*) from public.aviso_leido where usuario_id = u1) <> 2 then raise exception '1002: el dueño no tiene sus dos leídas'; end if;

  -- (b) Lo leído es por persona, no por flota: marcar la misma clave para el contador de la MISMA flota no toca lo del dueño.
  n := public.aviso_marcar(u2, fa, array['huerfanos|3'], true);
  if n <> 1 then raise exception '1002: el contador no pudo marcar su propia copia (%)', n; end if;
  if (select count(*) from public.aviso_leido where usuario_id = u1) <> 2 then raise exception '1002: marcar al contador alteró lo del dueño'; end if;

  -- (c) Desmarcar borra solo lo pedido y solo de ESA persona y ESE ámbito.
  n := public.aviso_marcar(u2, fa, array['huerfanos|3'], false);
  if n <> 1 then raise exception '1002: desmarcar al contador devolvió %', n; end if;
  if (select count(*) from public.aviso_leido where usuario_id = u1 and ambito = fa) <> 2 then raise exception '1002: desmarcar al contador borró lo del dueño'; end if;
  n := public.aviso_marcar(u1, fb, array['huerfanos|3'], false);
  if n <> 0 then raise exception '1002: desmarcar en otro ámbito borró algo (%)', n; end if;
  n := public.aviso_marcar(u1, fa, array['huerfanos|3'], false);
  if n <> 1 then raise exception '1002: desmarcar devolvió %', n; end if;

  -- (d) Argumentos nulos se rechazan (nunca una fila con persona o ámbito vacío).
  begin
    perform public.aviso_marcar(null, fa, array['x'], true);
    raise exception '1002: marcó sin persona';
  exception when null_value_not_allowed then null;
  end;
  begin
    perform public.aviso_marcar(u1, null, array['x'], true);
    raise exception '1002: marcó sin ámbito';
  exception when null_value_not_allowed then null;
  end;

  -- (e) El ámbito debe tener forma de 'admin' o de uuid de flota (CHECK).
  begin
    perform public.aviso_marcar(u1, 'cualquier-cosa', array['x'], true);
    raise exception '1002: aceptó un ámbito con forma inválida';
  exception when check_violation then null;
  end;

  -- (f) 'admin' y una flota quedan separados por ámbito para la misma persona.
  n := public.aviso_marcar(u4, 'admin', array['arco|2'], true);
  if n <> 1 then raise exception '1002: no pudo marcar en admin'; end if;
  n := public.aviso_marcar(u4, fb, array['huerfanos|9'], true);
  if n <> 1 then raise exception '1002: no pudo marcar en la flota B'; end if;
  if (select count(*) from public.aviso_leido where usuario_id = u4 and ambito = 'admin') <> 1 then raise exception '1002: ámbito admin no separado'; end if;
  reset role;

  -- (g) Poda a 1000 por persona y ámbito: se conservan las más recientes.
  set local role service_role;
  perform public.aviso_marcar(u3, fb, (select array_agg('lote-a-' || g) from generate_series(1, 400) g), true);
  perform public.aviso_marcar(u3, fb, (select array_agg('lote-b-' || g) from generate_series(1, 400) g), true);
  update public.aviso_leido set leido_en = now() - interval '2 days' where usuario_id = u3 and clave like 'lote-a-%';
  perform public.aviso_marcar(u3, fb, (select array_agg('lote-c-' || g) from generate_series(1, 400) g), true);
  if (select count(*) from public.aviso_leido where usuario_id = u3 and ambito = fb) <> 1000 then
    raise exception '1002: la poda no dejó 1000 (hay %)', (select count(*) from public.aviso_leido where usuario_id = u3 and ambito = fb);
  end if;
  if exists (select 1 from public.aviso_leido where usuario_id = u3 and ambito = fb and clave = 'lote-c-1') is not true then
    raise exception '1002: la poda borró una clave reciente';
  end if;
  if (select count(*) from public.aviso_leido where usuario_id = u4 and ambito = fb) <> 1 then
    raise exception '1002: la poda de una persona tocó a otra';
  end if;
  begin
    perform public.aviso_marcar(u3, fb, (select array_agg('x' || g) from generate_series(1, 501) g), true);
    raise exception '1002: aceptó más de 500 claves';
  exception when program_limit_exceeded then null;
  end;
  reset role;
end $$;

-- (h) Preferencias: dominio de canal y categoría; una fila por (persona, ámbito, tipo, canal).
do $$
declare fa text := '10020000-0000-4000-8000-0000000000a1';
begin
  set local role service_role;
  insert into public.aviso_preferencia (usuario_id, ambito, categoria, canal, activo) values ('10020000-0000-4000-8000-0000000000c1', fa, 'dinero', 'correo', false);
  begin
    insert into public.aviso_preferencia (usuario_id, ambito, categoria, canal, activo) values ('10020000-0000-4000-8000-0000000000c1', fa, 'dinero', 'correo', true);
    raise exception '1002: duplicó la preferencia';
  exception when unique_violation then null;
  end;
  begin
    insert into public.aviso_preferencia (usuario_id, ambito, categoria, canal, activo) values ('10020000-0000-4000-8000-0000000000c1', fa, 'dinero', 'sms', true);
    raise exception '1002: aceptó un canal inventado';
  exception when check_violation then null;
  end;
  begin
    insert into public.aviso_preferencia (usuario_id, ambito, categoria, canal, activo) values ('10020000-0000-4000-8000-0000000000c1', fa, 'inventada', 'app', true);
    raise exception '1002: aceptó un tipo inventado';
  exception when check_violation then null;
  end;
  reset role;
end $$;

-- (i) Horario de silencio: no admite desde = hasta; un solo horario por persona y ámbito; el default nace apagado.
do $$
declare fa text := '10020000-0000-4000-8000-0000000000a1';
begin
  set local role service_role;
  insert into public.aviso_silencio (usuario_id, ambito) values ('10020000-0000-4000-8000-0000000000c1', fa);
  if (select activo from public.aviso_silencio where usuario_id = '10020000-0000-4000-8000-0000000000c1') is distinct from false then raise exception '1002: el horario no nace apagado'; end if;
  begin
    update public.aviso_silencio set desde = '08:00', hasta = '08:00';
    raise exception '1002: aceptó un horario vacío';
  exception when check_violation then null;
  end;
  begin
    insert into public.aviso_silencio (usuario_id, ambito) values ('10020000-0000-4000-8000-0000000000c1', fa);
    raise exception '1002: dos horarios para la misma persona y ámbito';
  exception when unique_violation then null;
  end;
  reset role;
end $$;

-- (j) Ni anon ni authenticated tocan nada (tablas ni función): la primera barrera es el privilegio, no una política.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    begin
      perform count(*) from public.aviso_leido;
      raise exception '1002: % leyó aviso_leido', r;
    exception when insufficient_privilege then null;
    end;
    begin
      perform count(*) from public.aviso_preferencia;
      raise exception '1002: % leyó aviso_preferencia', r;
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.aviso_silencio (usuario_id, ambito) values ('10020000-0000-4000-8000-0000000000c1', 'admin');
      raise exception '1002: % escribió aviso_silencio', r;
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.aviso_marcar('10020000-0000-4000-8000-0000000000c1', 'admin', array['x'], true);
      raise exception '1002: % ejecutó aviso_marcar', r;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
end $$;

-- (k) RLS habilitada y sin políticas: aunque un grant se abriera por error, el resultado sería «nada».
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname in ('aviso_leido', 'aviso_preferencia', 'aviso_silencio') and not c.relrowsecurity) then
    raise exception '1002: una tabla de avisos quedó sin RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('aviso_leido', 'aviso_preferencia', 'aviso_silencio')) then
    raise exception '1002: las tablas de avisos no deben tener políticas (solo service_role entra)';
  end if;
end $$;

rollback;
