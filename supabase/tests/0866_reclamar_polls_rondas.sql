\set ON_ERROR_STOP on
-- 0866 · reclamar_polls_conector en rondas (A37-S38-02). Datos sintéticos; todo
-- en una transacción que se revierte.
begin;

insert into public.tenant (id, nombre) values
  ('b8660000-0000-0000-0000-000000000001', 'GPS 0866 A'),
  ('b8660000-0000-0000-0000-000000000002', 'GPS 0866 B'),
  ('b8660000-0000-0000-0000-000000000003', 'GPS 0866 C');
insert into public.conector_credencial (tenant_id, conector_id, valores_cifrados)
values ('b8660000-0000-0000-0000-000000000001', 'wialon', 'opaque'),
       ('b8660000-0000-0000-0000-000000000002', 'wialon', 'opaque'),
       ('b8660000-0000-0000-0000-000000000003', 'wialon', 'opaque');

-- (a) sin el parámetro nuevo se comporta como la 0500 (llamada de 6 args).
create temporary table r0 as select * from public.reclamar_polls_conector(
  'posiciones', array['wialon'], 2, 'w', 360, '2026-10-01T12:00:00Z');
do $$ begin
  if (select count(*) from r0) <> 2 then raise exception '(a) debía reclamar 2'; end if;
end $$;
select public.finalizar_poll_conector(tenant_id, proveedor, 'posiciones', claim_token, true,
  null, false, null, null, 1, 1, 0, null, '2026-10-01T12:00:05Z') from r0;

-- (b) ronda 2 con p_no_iniciados_desde = inicio de la corrida: SOLO la que
--     nunca se inició; las dos ya iniciadas en esta corrida NO se reclaman.
create temporary table r1 as select * from public.reclamar_polls_conector(
  'posiciones', array['wialon'], 2, 'w', 360, '2026-10-01T12:00:10Z', '2026-10-01T12:00:00Z');
do $$ begin
  if (select count(*) from r1) <> 1 then raise exception '(b) debía reclamar solo la no iniciada, reclamó %', (select count(*) from r1); end if;
  if (select count(*) from r1 r join r0 on r0.tenant_id = r.tenant_id) <> 0 then
    raise exception '(b) reclamó una flota ya iniciada en esta corrida';
  end if;
end $$;
select public.finalizar_poll_conector(tenant_id, proveedor, 'posiciones', claim_token, true,
  null, false, null, null, 1, 1, 0, null, '2026-10-01T12:00:15Z') from r1;

-- (c) ronda 3: ya nadie queda sin iniciar → vacía (termina el bucle del cron).
do $$ begin
  if (select count(*) from public.reclamar_polls_conector(
        'posiciones', array['wialon'], 2, 'w', 360, '2026-10-01T12:00:20Z', '2026-10-01T12:00:00Z')) <> 0 then
    raise exception '(c) la ronda 3 debía salir vacía';
  end if;
end $$;

-- (d) corrida SIGUIENTE (p_no_iniciados_desde posterior): todas vuelven a ser elegibles.
do $$ begin
  if (select count(*) from public.reclamar_polls_conector(
        'posiciones', array['wialon'], 10, 'w', 360, '2026-10-01T12:05:00Z', '2026-10-01T12:05:00Z')) <> 3 then
    raise exception '(d) la corrida siguiente debía ver las 3';
  end if;
end $$;

-- (e) privilegios: solo service_role.
do $$ begin
  if has_function_privilege('anon', 'public.reclamar_polls_conector(text,text[],integer,text,integer,timestamptz,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.reclamar_polls_conector(text,text[],integer,text,integer,timestamptz,timestamptz)', 'execute') then
    raise exception '(e) anon/authenticated no deben ejecutar';
  end if;
  if not has_function_privilege('service_role', 'public.reclamar_polls_conector(text,text[],integer,text,integer,timestamptz,timestamptz)', 'execute') then
    raise exception '(e) service_role debe ejecutar';
  end if;
  -- una sola sobrecarga (la de 6 args ya no existe)
  if (select count(*) from pg_proc where proname = 'reclamar_polls_conector' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '(e) debe existir una sola firma';
  end if;
end $$;

rollback;
