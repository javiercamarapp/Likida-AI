\set ON_ERROR_STOP on
-- 0563 — Peajes: correo, pull, aviso y anulación. Contra Postgres real.
--
--   (a) origen de la cola admite 'correo' y 'pull' (y sigue rechazando uno inventado);
--   (b) peaje_ingesta_config: token de correo con forma, ÚNICO entre flotas, activo
--       exige token; pull activo exige URL; la URL tiene que ser https sin
--       credenciales; el intervalo 15..1440; la credencial solo cabe CIFRADA (un
--       token en claro no entra); tope de 20 remitentes;
--   (c) peaje_pull_reclamar: toma lo que ya toca, pone lease (no se reclama dos
--       veces seguidas), salta lo inactivo/sin URL/no vencido, respeta p_limite y
--       rechaza parámetros fuera de rango; solo service_role;
--   (d) desglose_peaje: la anulación exige quién y un motivo de 1..500; sin
--       anulación no hay datos de anulación; aviso_intentos no negativo.
begin;

insert into public.tenant (id, nombre) values
  ('56300000-0000-4000-8000-0000000000a1', 'Flota A 0563'),
  ('56300000-0000-4000-8000-0000000000b1', 'Flota B 0563'),
  ('56300000-0000-4000-8000-0000000000c1', 'Flota C 0563');
insert into public.peaje_ingesta_config (tenant_id) values
  ('56300000-0000-4000-8000-0000000000a1'), ('56300000-0000-4000-8000-0000000000b1'), ('56300000-0000-4000-8000-0000000000c1');

set local role service_role;

do $$
declare
  v_falla boolean; r record; n int;
  A constant uuid := '56300000-0000-4000-8000-0000000000a1';
  B constant uuid := '56300000-0000-4000-8000-0000000000b1';
  C constant uuid := '56300000-0000-4000-8000-0000000000c1';
  v_cifrada constant text := 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCCCCCC';
begin
  -- (a) origen
  insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido, origen) values
    (A, repeat('1', 64), 'a.csv', 1, '\x61', 'correo'),
    (A, repeat('2', 64), 'b.csv', 1, '\x61', 'pull'),
    (A, repeat('3', 64), 'c.csv', 1, '\x61', 'api'),
    (A, repeat('4', 64), 'd.csv', 1, '\x61', 'panel');
  v_falla := false;
  begin
    insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido, origen) values (A, repeat('5', 64), 'e.csv', 1, '\x61', 'sftp');
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO a: origen inventado aceptado'; end if;

  -- (b) config
  foreach n in array array[1,2,3,4,5,6,7,8] loop
    v_falla := false;
    begin
      case n
        when 1 then update public.peaje_ingesta_config set correo_token = 'corto' where tenant_id = A;
        when 2 then update public.peaje_ingesta_config set correo_token = 'ABCDEFGHJKMNPQRSTVWXYZ23' where tenant_id = A;       -- mayúsculas
        when 3 then update public.peaje_ingesta_config set correo_activo = true where tenant_id = A;                              -- activo sin token
        when 4 then update public.peaje_ingesta_config set pull_activo = true where tenant_id = A;                                -- pull sin URL
        when 5 then update public.peaje_ingesta_config set pull_url = 'http://x.example/cortes' where tenant_id = A;              -- no https
        when 6 then update public.peaje_ingesta_config set pull_url = 'https://usuario:clave@x.example/cortes' where tenant_id = A; -- credenciales en la URL
        when 7 then update public.peaje_ingesta_config set pull_intervalo_min = 5 where tenant_id = A;
        when 8 then update public.peaje_ingesta_config set pull_credencial_cifrada = 'Bearer secreto-en-claro' where tenant_id = A;
      end case;
    exception when check_violation then v_falla := true; end;
    if not v_falla then raise exception 'FALLO b%: un valor inválido de la config se aceptó', n; end if;
  end loop;
  v_falla := false;
  begin update public.peaje_ingesta_config set pull_intervalo_min = 2000 where tenant_id = A; exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b9: intervalo > 1440 aceptado'; end if;
  v_falla := false;
  begin update public.peaje_ingesta_config set remitentes_permitidos = (select array_agg('r' || i || '@x.example') from generate_series(1, 21) i) where tenant_id = A; exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b10: más de 20 remitentes aceptados'; end if;

  update public.peaje_ingesta_config set correo_token = 'abcdefghjkmnpqrstvwxyz23', correo_activo = true where tenant_id = A;
  v_falla := false;
  begin update public.peaje_ingesta_config set correo_token = 'abcdefghjkmnpqrstvwxyz23' where tenant_id = B; exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b11: el mismo token de correo en dos flotas'; end if;

  -- (c) el claim del pull
  update public.peaje_ingesta_config set pull_url = 'https://a.example/cortes', pull_credencial_cifrada = v_cifrada, pull_activo = true, pull_proximo_en = now() - interval '1 minute' where tenant_id = A;
  update public.peaje_ingesta_config set pull_url = 'https://b.example/cortes', pull_activo = true, pull_proximo_en = now() + interval '1 hour' where tenant_id = B;     -- aún no toca
  update public.peaje_ingesta_config set pull_url = 'https://c.example/cortes', pull_activo = false, pull_proximo_en = now() - interval '1 minute' where tenant_id = C;  -- apagado

  select count(*) into n from public.peaje_pull_reclamar(10, 600);
  if n <> 1 then raise exception 'FALLO c1: reclamó % flotas (esperaba solo la A)', n; end if;
  select count(*) into n from public.peaje_pull_reclamar(10, 600);
  if n <> 0 then raise exception 'FALLO c2: la flota A se reclamó dos veces seguidas (el lease no funciona)'; end if;
  if (select pull_proximo_en from public.peaje_ingesta_config where tenant_id = A) < now() + interval '9 minutes' then
    raise exception 'FALLO c3: el lease no empujó pull_proximo_en';
  end if;
  -- los canales son independientes: apagar el buzón FIRMADO (activa=false) no apaga el pull…
  update public.peaje_ingesta_config set pull_proximo_en = now() - interval '1 second', activa = false where tenant_id = A;
  select count(*) into n from public.peaje_pull_reclamar(10, 600);
  if n <> 1 then raise exception 'FALLO c4: apagar el buzón firmado apagó el pull (reclamó %)', n; end if;
  -- …y apagar el pull sí.
  update public.peaje_ingesta_config set pull_proximo_en = now() - interval '1 second', pull_activo = false where tenant_id = A;
  select count(*) into n from public.peaje_pull_reclamar(10, 600);
  if n <> 0 then raise exception 'FALLO c4b: se reclamó una flota con el pull apagado'; end if;
  -- p_limite
  update public.peaje_ingesta_config set activa = true, pull_proximo_en = now() - interval '1 second' where tenant_id = A;
  update public.peaje_ingesta_config set pull_activo = true, pull_proximo_en = now() - interval '1 second' where tenant_id in (B, C);
  select count(*) into n from public.peaje_pull_reclamar(2, 600);
  if n <> 2 then raise exception 'FALLO c5: p_limite=2 devolvió %', n; end if;
  foreach n in array array[0, 51] loop
    v_falla := false;
    begin perform * from public.peaje_pull_reclamar(n, 600); exception when others then v_falla := true; end;
    if not v_falla then raise exception 'FALLO c6: p_limite=% aceptado', n; end if;
  end loop;
  v_falla := false;
  begin perform * from public.peaje_pull_reclamar(5, 5); exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO c7: lease de 5 s aceptado'; end if;

  -- (d) anulación
  insert into public.desglose_peaje (id, tenant_id, proveedor) values
    ('56300000-0000-4000-8000-0000000000d1', A, 'PASE'), ('56300000-0000-4000-8000-0000000000d2', A, 'PASE');
  for n in 1..4 loop
    v_falla := false;
    begin
      case n
        when 1 then update public.desglose_peaje set anulado_en = now() where id = '56300000-0000-4000-8000-0000000000d1';                                   -- sin quién ni motivo
        when 2 then update public.desglose_peaje set anulado_en = now(), anulado_por = 'x' where id = '56300000-0000-4000-8000-0000000000d1';               -- sin motivo
        when 3 then update public.desglose_peaje set anulado_en = now(), anulado_por = 'x', anulado_motivo = '   ' where id = '56300000-0000-4000-8000-0000000000d1';
        when 4 then update public.desglose_peaje set anulado_motivo = 'solo motivo' where id = '56300000-0000-4000-8000-0000000000d1';                      -- datos sin anulación
      end case;
    exception when check_violation then v_falla := true; end;
    if not v_falla then raise exception 'FALLO d%: una anulación incompleta se aceptó', n; end if;
  end loop;
  v_falla := false;
  begin update public.desglose_peaje set anulado_en = now(), anulado_por = 'x', anulado_motivo = repeat('m', 501) where id = '56300000-0000-4000-8000-0000000000d1'; exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d5: motivo > 500 aceptado'; end if;
  update public.desglose_peaje set anulado_en = now(), anulado_por = 'dueño@x.example', anulado_motivo = 'archivo de otra flota' where id = '56300000-0000-4000-8000-0000000000d1';
  v_falla := false;
  begin update public.desglose_peaje set aviso_intentos = -1 where id = '56300000-0000-4000-8000-0000000000d2'; exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d6: aviso_intentos negativo aceptado'; end if;
  if not exists (select 1 from pg_indexes where indexname = 'desglose_peaje_aviso_pendiente_idx') then raise exception 'FALLO d7: falta el índice de avisos pendientes'; end if;

  -- (f) el barrido de avisos: solo requerido + sin enviar + no anulado + bajo el tope de intentos; cruza flotas.
  insert into public.desglose_peaje (id, tenant_id, proveedor, aviso_requerido, aviso_intentos, aviso_oficina_en, anulado_en, anulado_por, anulado_motivo) values
    ('56300000-0000-4000-8000-0000000000e1', A, 'pendiente-A', true, 0, null, null, null, null),
    ('56300000-0000-4000-8000-0000000000e2', B, 'pendiente-B', true, 4, null, null, null, null),
    ('56300000-0000-4000-8000-0000000000e3', A, 'agotado', true, 5, null, null, null, null),
    ('56300000-0000-4000-8000-0000000000e4', A, 'ya-enviado', true, 1, now(), null, null, null),
    ('56300000-0000-4000-8000-0000000000e5', A, 'anulado', true, 0, null, now(), 'x', 'por error'),
    ('56300000-0000-4000-8000-0000000000e6', A, 'no-requerido', false, 0, null, null, null, null);
  select count(*) into n from public.peaje_avisos_pendientes(10, 5);
  if n <> 2 then raise exception 'FALLO f1: el barrido devolvió % (esperaba 2: uno de A y uno de B)', n; end if;
  if not exists (select 1 from public.peaje_avisos_pendientes(10, 5) where tenant_id = B) then raise exception 'FALLO f2: el barrido no cruzó flotas'; end if;
  select count(*) into n from public.peaje_avisos_pendientes(1, 5);
  if n <> 1 then raise exception 'FALLO f3: p_limite=1 devolvió %', n; end if;
  v_falla := false;
  begin perform * from public.peaje_avisos_pendientes(0, 5); exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO f4: p_limite=0 aceptado'; end if;
end $$;

reset role;
do $$
begin
  if has_function_privilege('anon', 'public.peaje_pull_reclamar(int,int)', 'execute')
     or has_function_privilege('authenticated', 'public.peaje_pull_reclamar(int,int)', 'execute') then
    raise exception 'FALLO e: anon/authenticated ejecutan peaje_pull_reclamar';
  end if;
  if has_function_privilege('anon', 'public.peaje_avisos_pendientes(int,int)', 'execute')
     or has_function_privilege('authenticated', 'public.peaje_avisos_pendientes(int,int)', 'execute') then
    raise exception 'FALLO e3: anon/authenticated ejecutan peaje_avisos_pendientes';
  end if;
  if not has_function_privilege('service_role', 'public.peaje_pull_reclamar(int,int)', 'execute') then
    raise exception 'FALLO e2: service_role no ejecuta peaje_pull_reclamar';
  end if;
end $$;

rollback;
