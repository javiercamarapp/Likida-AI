\set ON_ERROR_STOP on
-- 0843 — Peajes: cuarto canal de ingesta, SFTP. Contra Postgres real.
--
--   (a) origen de la cola admite 'sftp' (y sigue rechazando uno inventado);
--   (b) peaje_ingesta_config: host con forma, puerto sano, ruta sin control/sin
--       barra final, hasta 5 huellas con forma "SHA256:<43 b64url>", credencial
--       solo cabe CIFRADA, intervalo 15..1440, activo exige TODO (host, usuario,
--       ruta, huella, credencial);
--   (c) peaje_sftp_reclamar: toma lo que ya toca, pone lease (no se reclama dos
--       veces seguidas), salta lo inactivo/sin host/no vencido, respeta p_limite
--       y rechaza parámetros fuera de rango; solo service_role;
--   (d) los cuatro canales son independientes: apagar uno no apaga los otros.
begin;

insert into public.tenant (id, nombre) values
  ('84300000-0000-4000-8000-0000000000a1', 'Flota A 0843'),
  ('84300000-0000-4000-8000-0000000000b1', 'Flota B 0843'),
  ('84300000-0000-4000-8000-0000000000c1', 'Flota C 0843');
insert into public.peaje_ingesta_config (tenant_id) values
  ('84300000-0000-4000-8000-0000000000a1'), ('84300000-0000-4000-8000-0000000000b1'), ('84300000-0000-4000-8000-0000000000c1');

set local role service_role;

do $$
declare
  v_falla boolean; n int;
  A constant uuid := '84300000-0000-4000-8000-0000000000a1';
  B constant uuid := '84300000-0000-4000-8000-0000000000b1';
  C constant uuid := '84300000-0000-4000-8000-0000000000c1';
  v_cifrada constant text := 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB.CCCCCCCC';
  v_huella constant text := 'SHA256:' || repeat('A', 43);
begin
  -- (a) origen
  insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido, origen) values
    (A, repeat('1', 64), 'a.csv', 1, '\x61', 'sftp');
  v_falla := false;
  begin
    insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido, origen) values (A, repeat('2', 64), 'b.csv', 1, '\x61', 'ftp');
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO a: origen inventado aceptado'; end if;

  -- (b) config: cada valor inválido rebota por su cuenta
  foreach n in array array[1,2,3,4,5,6,7] loop
    v_falla := false;
    begin
      case n
        when 1 then update public.peaje_ingesta_config set sftp_host = 'host con espacio' where tenant_id = A;
        when 2 then update public.peaje_ingesta_config set sftp_host = repeat('h', 254) where tenant_id = A;
        when 3 then update public.peaje_ingesta_config set sftp_puerto = 0 where tenant_id = A;
        when 4 then update public.peaje_ingesta_config set sftp_puerto = 70000 where tenant_id = A;
        when 5 then update public.peaje_ingesta_config set sftp_ruta = '/cortes/' where tenant_id = A;             -- barra final
        when 6 then update public.peaje_ingesta_config set sftp_huellas = array['sha256:no-es-forma'] where tenant_id = A;
        when 7 then update public.peaje_ingesta_config set sftp_credencial_cifrada = 'contraseña-en-claro' where tenant_id = A;
      end case;
    exception when check_violation then v_falla := true; end;
    if not v_falla then raise exception 'FALLO b%: un valor inválido de la config SFTP se aceptó', n; end if;
  end loop;
  v_falla := false;
  begin update public.peaje_ingesta_config set sftp_intervalo_min = 10 where tenant_id = A; exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b8: intervalo < 15 aceptado'; end if;
  v_falla := false;
  begin update public.peaje_ingesta_config set sftp_intervalo_min = 2000 where tenant_id = A; exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b9: intervalo > 1440 aceptado'; end if;

  -- activo exige TODO: host solo no basta
  v_falla := false;
  begin update public.peaje_ingesta_config set sftp_host = 'a.example', sftp_activo = true where tenant_id = A; exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b10: activo=true sin usuario/ruta/huella/credencial se aceptó'; end if;

  -- con TODO, sí entra (hasta 5 huellas, para rotar sin cortar la lectura)
  update public.peaje_ingesta_config set
    sftp_host = 'a.example', sftp_puerto = 22, sftp_usuario = 'flota', sftp_ruta = '/cortes/peajes.xlsx',
    sftp_huellas = array[v_huella, 'SHA256:' || repeat('B', 43)], sftp_credencial_cifrada = v_cifrada,
    sftp_activo = true, sftp_proximo_en = now() - interval '1 minute'
  where tenant_id = A;

  -- (c) el claim del SFTP
  update public.peaje_ingesta_config set
    sftp_host = 'b.example', sftp_usuario = 'flota', sftp_ruta = '/cortes/b.xlsx', sftp_huellas = array[v_huella],
    sftp_credencial_cifrada = v_cifrada, sftp_activo = true, sftp_proximo_en = now() + interval '1 hour'   -- aún no toca
  where tenant_id = B;
  update public.peaje_ingesta_config set
    sftp_host = 'c.example', sftp_usuario = 'flota', sftp_ruta = '/cortes/c.xlsx', sftp_huellas = array[v_huella],
    sftp_credencial_cifrada = v_cifrada, sftp_activo = false, sftp_proximo_en = now() - interval '1 minute'  -- apagado
  where tenant_id = C;

  select count(*) into n from public.peaje_sftp_reclamar(10, 600);
  if n <> 1 then raise exception 'FALLO c1: reclamó % flotas (esperaba solo la A)', n; end if;
  select count(*) into n from public.peaje_sftp_reclamar(10, 600);
  if n <> 0 then raise exception 'FALLO c2: la flota A se reclamó dos veces seguidas (el lease no funciona)'; end if;
  if (select sftp_proximo_en from public.peaje_ingesta_config where tenant_id = A) < now() + interval '9 minutes' then
    raise exception 'FALLO c3: el lease no empujó sftp_proximo_en';
  end if;
  -- los canales son independientes: apagar el buzón firmado (activa=false) no apaga el SFTP…
  update public.peaje_ingesta_config set sftp_proximo_en = now() - interval '1 second', activa = false where tenant_id = A;
  select count(*) into n from public.peaje_sftp_reclamar(10, 600);
  if n <> 1 then raise exception 'FALLO c4: apagar el buzón firmado apagó el SFTP (reclamó %)', n; end if;
  -- …y apagar el SFTP sí.
  update public.peaje_ingesta_config set sftp_proximo_en = now() - interval '1 second', sftp_activo = false where tenant_id = A;
  select count(*) into n from public.peaje_sftp_reclamar(10, 600);
  if n <> 0 then raise exception 'FALLO c4b: se reclamó una flota con el SFTP apagado'; end if;
  -- p_limite
  update public.peaje_ingesta_config set activa = true, sftp_activo = true, sftp_proximo_en = now() - interval '1 second' where tenant_id = A;
  update public.peaje_ingesta_config set sftp_proximo_en = now() - interval '1 second' where tenant_id in (B, C);
  update public.peaje_ingesta_config set sftp_activo = true where tenant_id = C;
  select count(*) into n from public.peaje_sftp_reclamar(2, 600);
  if n <> 2 then raise exception 'FALLO c5: p_limite=2 devolvió %', n; end if;
  foreach n in array array[0, 51] loop
    v_falla := false;
    begin perform * from public.peaje_sftp_reclamar(n, 600); exception when others then v_falla := true; end;
    if not v_falla then raise exception 'FALLO c6: p_limite=% aceptado', n; end if;
  end loop;
  v_falla := false;
  begin perform * from public.peaje_sftp_reclamar(5, 5); exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO c7: lease de 5 s aceptado'; end if;
end $$;

reset role;
do $$
begin
  if has_function_privilege('anon', 'public.peaje_sftp_reclamar(int,int)', 'execute')
     or has_function_privilege('authenticated', 'public.peaje_sftp_reclamar(int,int)', 'execute') then
    raise exception 'FALLO d: anon/authenticated ejecutan peaje_sftp_reclamar';
  end if;
  if not has_function_privilege('service_role', 'public.peaje_sftp_reclamar(int,int)', 'execute') then
    raise exception 'FALLO d2: service_role no ejecuta peaje_sftp_reclamar';
  end if;
end $$;

rollback;
