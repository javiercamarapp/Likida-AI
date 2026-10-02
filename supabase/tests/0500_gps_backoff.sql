\set ON_ERROR_STOP on
-- 0500 · backoff por proveedor del poll de GPS. Datos sintéticos; todo en una
-- transacción que se revierte.
begin;

insert into public.tenant (id, nombre) values
  ('b5000000-0000-0000-0000-000000000001', 'GPS 0500 A'),
  ('b5000000-0000-0000-0000-000000000002', 'GPS 0500 B');
insert into public.conector_credencial (tenant_id, conector_id, valores_cifrados)
values ('b5000000-0000-0000-0000-000000000001', 'wialon', 'opaque'),
       ('b5000000-0000-0000-0000-000000000002', 'wialon', 'opaque');

-- (a) falla de PROVEEDOR: espera 1 min, luego 2, luego 4 …; mientras espera, NO se reclama.
create temporary table c1 as select * from public.reclamar_polls_conector(
  'posiciones', array['wialon'], 10, 'w', 360, '2026-10-01T12:00:00Z');
do $$ begin
  if (select count(*) from c1) <> 2 then raise exception '(a) debía reclamar las dos flotas'; end if;
end $$;
select public.finalizar_poll_conector(tenant_id, proveedor, 'posiciones', claim_token, false,
  null, false, null, null, 1, 0, 0, '5xx', '2026-10-01T12:00:10Z', 'proveedor') from c1
  where tenant_id = 'b5000000-0000-0000-0000-000000000001';
select public.finalizar_poll_conector(tenant_id, proveedor, 'posiciones', claim_token, true,
  null, false, null, null, 1, 5, 0, null, '2026-10-01T12:00:10Z') from c1
  where tenant_id = 'b5000000-0000-0000-0000-000000000002';
do $$
declare s record; n integer;
begin
  select * into s from public.conector_poll_estado
   where tenant_id = 'b5000000-0000-0000-0000-000000000001' and recurso = 'posiciones';
  if s.errores_seguidos <> 1 or s.ultima_falla <> 'proveedor'
     or s.proximo_intento_en <> '2026-10-01T12:01:10Z' then
    raise exception '(a) backoff proveedor 1: % % %', s.errores_seguidos, s.ultima_falla, s.proximo_intento_en;
  end if;
  create temporary table c2 as select * from public.reclamar_polls_conector('posiciones', array['wialon'], 10, 'w', 360, '2026-10-01T12:01:00Z');
  select count(*) into n from c2 where tenant_id = 'b5000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception '(a) se reclamó una flota en backoff'; end if;
  -- la flota sana SÍ sigue entrando (el backoff es por flota, no global)
  select count(*) into n from c2 where tenant_id = 'b5000000-0000-0000-0000-000000000002';
  if n <> 1 then raise exception '(a) la flota sana no se reclamó'; end if;
  perform public.finalizar_poll_conector(tenant_id, proveedor, 'posiciones', claim_token, true, null, false, null, null, 0, 0, 0, null, '2026-10-01T12:01:01Z') from c2;
end $$;

-- (b) segunda falla seguida: 2 min; tercera: 4 min; credencial: 15 min, 30 min …; tope 6 h.
do $$
declare r record; s record; t timestamptz := '2026-10-01T12:02:00Z';
begin
  for i in 1..2 loop
    select * into r from public.reclamar_polls_conector('posiciones', array['wialon'], 10, 'w', 360, t)
      where tenant_id = 'b5000000-0000-0000-0000-000000000001';
    if r.claim_token is null then raise exception '(b) no reclamó la iteración %', i; end if;
    perform public.finalizar_poll_conector(r.tenant_id, r.proveedor, 'posiciones', r.claim_token, false,
      null, false, null, null, 0, 0, 0, 'x', t, 'proveedor');
    select * into s from public.conector_poll_estado where tenant_id = r.tenant_id and recurso = 'posiciones';
    if s.proximo_intento_en <> t + (interval '1 minute' * power(2, i)) then
      raise exception '(b) proveedor falla % → espera %', i + 1, s.proximo_intento_en - t;
    end if;
    t := s.proximo_intento_en;
  end loop;
  -- ahora credencial
  select * into r from public.reclamar_polls_conector('posiciones', array['wialon'], 10, 'w', 360, t)
    where tenant_id = 'b5000000-0000-0000-0000-000000000001';
  perform public.finalizar_poll_conector(r.tenant_id, r.proveedor, 'posiciones', r.claim_token, false,
    null, false, null, null, 0, 0, 0, 'x', t, 'credencial');
  select * into s from public.conector_poll_estado where tenant_id = r.tenant_id and recurso = 'posiciones';
  if s.errores_seguidos <> 4 or s.ultima_falla <> 'credencial' or s.proximo_intento_en - t <> interval '15 minutes' * 8 then
    raise exception '(b) credencial tras 3 fallas: n=% espera=%', s.errores_seguidos, s.proximo_intento_en - t;
  end if;
  -- tope de 6 h con muchas fallas
  update public.conector_poll_estado set errores_seguidos = 50, claim_token = null, claim_worker = null, claim_expires_at = null
   where tenant_id = r.tenant_id and recurso = 'posiciones';
  select * into r from public.reclamar_polls_conector('posiciones', array['wialon'], 10, 'w', 360, s.proximo_intento_en)
    where tenant_id = 'b5000000-0000-0000-0000-000000000001';
  perform public.finalizar_poll_conector(r.tenant_id, r.proveedor, 'posiciones', r.claim_token, false,
    null, false, null, null, 0, 0, 0, 'x', s.proximo_intento_en, 'formato');
  select * into s from public.conector_poll_estado where tenant_id = r.tenant_id and recurso = 'posiciones';
  if s.proximo_intento_en - (select ultimo_poll_en from public.conector_poll_estado where tenant_id = r.tenant_id and recurso = 'posiciones') <> interval '6 hours' then
    raise exception '(b) el tope de 6 h no se respetó';
  end if;
  t := s.proximo_intento_en;
  -- un poll COMPLETO reinicia contador, falla y espera
  select * into r from public.reclamar_polls_conector('posiciones', array['wialon'], 10, 'w', 360, t)
    where tenant_id = 'b5000000-0000-0000-0000-000000000001';
  perform public.finalizar_poll_conector(r.tenant_id, r.proveedor, 'posiciones', r.claim_token, true,
    null, false, null, null, 1, 3, 0, null, t);
  select * into s from public.conector_poll_estado where tenant_id = r.tenant_id and recurso = 'posiciones';
  if s.errores_seguidos <> 0 or s.ultima_falla is not null or s.proximo_intento_en is not null then
    raise exception '(b) un poll completo no reinició el backoff';
  end if;
end $$;

-- (c) incompleto SIN falla (huérfanas/backlog) no espacia ni cuenta.
do $$
declare r record; s record;
begin
  select * into r from public.reclamar_polls_conector('posiciones', array['wialon'], 10, 'w', 360, '2026-10-02T00:00:00Z')
    where tenant_id = 'b5000000-0000-0000-0000-000000000001';
  perform public.finalizar_poll_conector(r.tenant_id, r.proveedor, 'posiciones', r.claim_token, false,
    null, false, null, null, 1, 3, 0, 'huérfanas', '2026-10-02T00:00:00Z');
  select * into s from public.conector_poll_estado where tenant_id = r.tenant_id and recurso = 'posiciones';
  if s.errores_seguidos <> 0 or s.proximo_intento_en is not null or not s.backlog_pendiente then
    raise exception '(c) un incompleto sin falla no debe espaciar';
  end if;
  -- (d) clase inválida
  begin
    perform public.finalizar_poll_conector(r.tenant_id, r.proveedor, 'posiciones', gen_random_uuid(), false,
      null, false, null, null, 0, 0, 0, 'x', now(), 'inventada');
    raise exception '(d) aceptó una clase de falla inventada';
  exception when others then
    if sqlerrm not like '%clase de falla inválida%' then raise; end if;
  end;
end $$;

-- (e) permisos: solo service_role ejecuta
do $$ begin
  if has_function_privilege('anon', 'public.finalizar_poll_conector(uuid,text,text,uuid,boolean,timestamptz,boolean,timestamptz,timestamptz,integer,integer,integer,text,timestamptz,text)', 'execute')
     or has_function_privilege('authenticated', 'public.reclamar_polls_conector(text,text[],integer,text,integer,timestamptz)', 'execute') then
    raise exception '(e) anon/authenticated ejecutan las funciones del poll';
  end if;
  if not has_function_privilege('service_role', 'public.finalizar_poll_conector(uuid,text,text,uuid,boolean,timestamptz,boolean,timestamptz,timestamptz,integer,integer,integer,text,timestamptz,text)', 'execute') then
    raise exception '(e) service_role no ejecuta finalizar';
  end if;
end $$;

-- (f) la llamada posicional de 14 argumentos de 0324 sigue válida (sin ambigüedad de sobrecarga)
do $$
declare r record; ok boolean;
begin
  select * into r from public.reclamar_polls_conector('posiciones', array['wialon'], 10, 'w', 360, '2026-10-03T00:00:00Z')
    where tenant_id = 'b5000000-0000-0000-0000-000000000002';
  select public.finalizar_poll_conector(r.tenant_id, r.proveedor, 'posiciones', r.claim_token, true, null, false, null, null, 1, 0, 0, null, '2026-10-03T00:00:01Z') into ok;
  if not ok then raise exception '(f) la llamada de 14 argumentos falló'; end if;
end $$;

-- (g) posicion.ignicion existe y admite NULL/true/false
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='posicion' and column_name='ignicion' and data_type='boolean') then
    raise exception '(g) falta posicion.ignicion';
  end if;
end $$;

rollback;
\echo 0500_gps_backoff: OK
