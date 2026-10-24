\set ON_ERROR_STOP on
-- 0909 — A37-S60-07 (purga de agente_mutacion_idempotencia) y A37-S60-09 (conteo agrupado de tokens MCP).
begin;

insert into public.tenant (id, nombre) values ('90900000-0000-4000-8000-0000000000a1', 'Flota 0909');

insert into public.agente_mutacion_idempotencia
  (id, tenant_id, effect_key, tool_name, owner_token, status, result, lease_until, created_at, updated_at) values
  ('90900000-0000-4000-a000-000000000001', '90900000-0000-4000-8000-0000000000a1', 'k1', 't', gen_random_uuid(), 'succeeded', '{"pdf":"x"}', now(), now() - interval '200 days', now() - interval '200 days'), -- viejo terminal: se borra
  ('90900000-0000-4000-a000-000000000002', '90900000-0000-4000-8000-0000000000a1', 'k2', 't', gen_random_uuid(), 'failed',    null,           now(), now() - interval '120 days', now() - interval '120 days'), -- viejo fallido: se borra
  ('90900000-0000-4000-a000-000000000003', '90900000-0000-4000-8000-0000000000a1', 'k3', 't', gen_random_uuid(), 'succeeded', '{"pdf":"y"}', now(), now() - interval '10 days',  now() - interval '10 days'),  -- reciente: se queda
  ('90900000-0000-4000-a000-000000000004', '90900000-0000-4000-8000-0000000000a1', 'k4', 't', gen_random_uuid(), 'running',   null,           now(), now() - interval '300 days', now() - interval '300 days'); -- running viejo: NO se toca

set local role service_role;
do $$
declare r jsonb; quedan text[];
begin
  begin
    perform public.mantener_agente_idempotencia(6);
    raise exception '0909: aceptó p_dias=6';
  exception when sqlstate 'PU001' then null;
  end;
  r := public.mantener_agente_idempotencia(90);
  if (r->>'borradas')::int <> 2 or (r->>'parcial')::boolean then
    raise exception '0909: purga inesperada: %', r;
  end if;
  select array_agg(right(id::text, 1) order by id) into quedan
    from public.agente_mutacion_idempotencia where tenant_id = '90900000-0000-4000-8000-0000000000a1';
  if quedan is distinct from array['3','4'] then
    raise exception '0909: quedaron % (esperado 3,4)', quedan;
  end if;
  r := public.mantener_agente_idempotencia(90);
  if (r->>'borradas')::int <> 0 then raise exception '0909: la segunda corrida borró algo: %', r; end if;
end $$;
reset role;

-- A37-S60-09: conteo agrupado
insert into public.mcp_oauth_cliente (id, nombre, redirect_uris, estado) values
  ('90900000-0000-4000-b000-000000000001', 'c1', '["https://x.test/cb"]'::jsonb, 'pendiente'),
  ('90900000-0000-4000-b000-000000000002', 'c2', '["https://x.test/cb"]'::jsonb, 'pendiente'),
  ('90900000-0000-4000-b000-000000000003', 'c3', '["https://x.test/cb"]'::jsonb, 'pendiente');
do $$
declare uid uuid; r record; n int := 0;
begin
  insert into public.app_user (id, tenant_id, email, rol) values (gen_random_uuid(), '90900000-0000-4000-8000-0000000000a1', 'u0909@example.test', 'contador') returning id into uid;
  insert into public.mcp_oauth_token (token_hash, tipo, cliente_id, user_id, tenant_id, rol, familia, expira_en, revocado_en)
  select md5(g::text) || md5(g::text || 'x'), 'acceso', c, uid, '90900000-0000-4000-8000-0000000000a1', 'contador', gen_random_uuid(), now() + interval '1 hour',
         case when g = 4 then now() else null end
    from (values (1, '90900000-0000-4000-b000-000000000001'::uuid), (2, '90900000-0000-4000-b000-000000000001'::uuid),
                 (3, '90900000-0000-4000-b000-000000000002'::uuid), (4, '90900000-0000-4000-b000-000000000002'::uuid)) v(g, c);
  for r in select * from public.contar_tokens_mcp_vivos(array[
      '90900000-0000-4000-b000-000000000001', '90900000-0000-4000-b000-000000000002', '90900000-0000-4000-b000-000000000003']::uuid[]) loop
    n := n + 1;
    if r.cliente_id = '90900000-0000-4000-b000-000000000001' and r.vivos <> 2 then raise exception '0909: c1 vivos=%', r.vivos; end if;
    if r.cliente_id = '90900000-0000-4000-b000-000000000002' and r.vivos <> 1 then raise exception '0909: c2 (1 revocado) vivos=%', r.vivos; end if;
  end loop;
  if n <> 2 then raise exception '0909: esperaba 2 filas (c3 sin tokens no aparece), hubo %', n; end if;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.mantener_agente_idempotencia(integer,timestamptz,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.mantener_agente_idempotencia(integer,timestamptz,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.contar_tokens_mcp_vivos(uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.contar_tokens_mcp_vivos(uuid[])', 'execute') then
    raise exception '0909: anon/authenticated pueden ejecutar las funciones';
  end if;
end $$;

rollback;
\echo '0909 OK'
