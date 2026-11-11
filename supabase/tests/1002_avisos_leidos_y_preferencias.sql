\set ON_ERROR_STOP on
-- 1002 — avisos por persona: RLS por usuario y ámbito, marcar/desmarcar atómico, poda a 1000, dominios de preferencia y horario.
begin;

insert into public.tenant (id, nombre) values
  ('10020000-0000-4000-8000-0000000000a1', 'Flota A 1002'),
  ('10020000-0000-4000-8000-0000000000b1', 'Flota B 1002');
insert into auth.users (id, email) values
  ('10020000-0000-4000-8000-0000000000c1', 'dueno-a-1002@test.invalid'),
  ('10020000-0000-4000-8000-0000000000c2', 'contador-a-1002@test.invalid'),
  ('10020000-0000-4000-8000-0000000000c3', 'dueno-b-1002@test.invalid'),
  ('10020000-0000-4000-8000-0000000000c4', 'super-1002@test.invalid')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, rol) values
  ('10020000-0000-4000-8000-0000000000c1', '10020000-0000-4000-8000-0000000000a1', 'dueno-a-1002@test.invalid', 'flota_admin'),
  ('10020000-0000-4000-8000-0000000000c2', '10020000-0000-4000-8000-0000000000a1', 'contador-a-1002@test.invalid', 'contador'),
  ('10020000-0000-4000-8000-0000000000c3', '10020000-0000-4000-8000-0000000000b1', 'dueno-b-1002@test.invalid', 'flota_admin'),
  ('10020000-0000-4000-8000-0000000000c4', null, 'super-1002@test.invalid', 'superadmin');

do $$
declare
  fa text := '10020000-0000-4000-8000-0000000000a1';
  fb text := '10020000-0000-4000-8000-0000000000b1';
  n integer;
begin
  -- (a) El dueño de A marca dos avisos de su flota; aparecen solo para él.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '10020000-0000-4000-8000-0000000000c1', true);
  n := public.aviso_marcar(fa, array['huerfanos|3', 'por-revisar|2', 'huerfanos|3'], true);
  if n <> 2 then raise exception '1002: marcar dos claves (una repetida) devolvió %', n; end if;
  -- idempotente: repetir no inserta de nuevo
  n := public.aviso_marcar(fa, array['huerfanos|3'], true);
  if n <> 0 then raise exception '1002: repetir una clave ya leída devolvió %', n; end if;
  if (select count(*) from public.aviso_leido) <> 2 then raise exception '1002: el dueño no ve sus dos leídas'; end if;

  -- (b) Otro usuario de la MISMA flota no ve lo leído por el dueño (es por persona, no por flota).
  perform set_config('request.jwt.claim.sub', '10020000-0000-4000-8000-0000000000c2', true);
  if (select count(*) from public.aviso_leido) <> 0 then raise exception '1002: el contador ve lo leído por el dueño'; end if;

  -- (c) No se puede escribir en una flota ajena ni en 'admin' sin ser superadmin, ni a nombre de otro.
  begin
    perform public.aviso_marcar(fb, array['x'], true);
    raise exception '1002: un usuario marcó en una flota ajena';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.aviso_marcar('admin', array['x'], true);
    raise exception '1002: un usuario de flota marcó en el ámbito admin';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.aviso_leido (usuario_id, ambito, clave) values ('10020000-0000-4000-8000-0000000000c1', fa, 'a-nombre-propio');
    insert into public.aviso_leido (usuario_id, ambito, clave) values ('10020000-0000-4000-8000-0000000000c3', fa, 'a-nombre-de-otro');
    raise exception '1002: se insertó una fila a nombre de otra persona';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- (d) Desmarcar borra solo lo pedido y solo lo propio (el contador no puede desmarcar lo del dueño).
  n := public.aviso_marcar(fa, array['huerfanos|3'], false);
  if n <> 0 then raise exception '1002: el contador desmarcó lo del dueño (%)', n; end if;
  perform set_config('request.jwt.claim.sub', '10020000-0000-4000-8000-0000000000c1', true);
  n := public.aviso_marcar(fa, array['huerfanos|3'], false);
  if n <> 1 then raise exception '1002: desmarcar devolvió %', n; end if;

  -- (e) Sin sesión, nada.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.aviso_marcar(fa, array['x'], true);
    raise exception '1002: marcó sin sesión';
  exception when others then
    if sqlstate = 'P0001' then raise; end if;
  end;

  -- (f) El superadmin usa 'admin' y puede «ver como» cualquier flota; las dos separadas por ámbito.
  perform set_config('request.jwt.claim.sub', '10020000-0000-4000-8000-0000000000c4', true);
  n := public.aviso_marcar('admin', array['arco|2'], true);
  if n <> 1 then raise exception '1002: el superadmin no pudo marcar en admin'; end if;
  n := public.aviso_marcar(fb, array['huerfanos|9'], true);
  if n <> 1 then raise exception '1002: el superadmin no pudo marcar viendo como la flota B'; end if;
  if (select count(*) from public.aviso_leido where ambito = 'admin') <> 1 then raise exception '1002: ámbito admin no separado'; end if;
  reset role;

  -- (g) Poda a 1000 por persona y ámbito: se conservan las más recientes.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '10020000-0000-4000-8000-0000000000c3', true);
  perform public.aviso_marcar(fb, (select array_agg('lote-a-' || g) from generate_series(1, 400) g), true);
  perform public.aviso_marcar(fb, (select array_agg('lote-b-' || g) from generate_series(1, 400) g), true);
  reset role;
  update public.aviso_leido set leido_en = now() - interval '2 days' where usuario_id = '10020000-0000-4000-8000-0000000000c3' and clave like 'lote-a-%';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '10020000-0000-4000-8000-0000000000c3', true);
  perform public.aviso_marcar(fb, (select array_agg('lote-c-' || g) from generate_series(1, 400) g), true);
  if (select count(*) from public.aviso_leido where ambito = fb) <> 1000 then
    raise exception '1002: la poda no dejó 1000 (hay %)', (select count(*) from public.aviso_leido where ambito = fb);
  end if;
  if exists (select 1 from public.aviso_leido where ambito = fb and clave = 'lote-c-1') is not true then
    raise exception '1002: la poda borró una clave reciente';
  end if;
  begin
    perform public.aviso_marcar(fb, (select array_agg('x' || g) from generate_series(1, 501) g), true);
    raise exception '1002: aceptó más de 500 claves';
  exception when program_limit_exceeded then null;
  end;
  reset role;
end $$;

-- (h) Preferencias: dominio de canal y categoría; una fila por (persona, ámbito, tipo, canal); aislada por persona.
do $$
declare fa text := '10020000-0000-4000-8000-0000000000a1';
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '10020000-0000-4000-8000-0000000000c1', true);
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
  perform set_config('request.jwt.claim.sub', '10020000-0000-4000-8000-0000000000c2', true);
  if (select count(*) from public.aviso_preferencia) <> 0 then raise exception '1002: el contador ve las preferencias del dueño'; end if;
  reset role;
end $$;

-- (i) Horario de silencio: no admite desde = hasta; un solo horario por persona y ámbito; el default nace apagado.
do $$
declare fa text := '10020000-0000-4000-8000-0000000000a1';
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '10020000-0000-4000-8000-0000000000c1', true);
  insert into public.aviso_silencio (usuario_id, ambito) values ('10020000-0000-4000-8000-0000000000c1', fa);
  if (select activo from public.aviso_silencio) is distinct from false then raise exception '1002: el horario no nace apagado'; end if;
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

-- (j) anon no toca nada.
do $$
begin
  set local role anon;
  begin
    perform count(*) from public.aviso_leido;
    raise exception '1002: anon leyó aviso_leido';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

rollback;
