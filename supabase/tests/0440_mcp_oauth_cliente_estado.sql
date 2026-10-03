\set ON_ERROR_STOP on
-- 0440 — ESTADO DE APROBACIÓN DE LOS CLIENTES OAUTH DEL MCP.
--
-- Lo que solo la base puede demostrar:
--   (a) el CHECK de dominio: 'pendiente' | 'aprobado' | 'rechazado', nada más;
--   (b) el default es 'pendiente' (un insert que no dice nada NO queda aprobado:
--       el default seguro es el cerrado);
--   (c) la reclasificación de lo ya registrado, re-ejecutada aquí con el MISMO
--       predicado de la migración: hosts conocidos y loopback → aprobado; un host
--       desconocido, un host que SOLO PARECE conocido (claude.ai.atacante.tld,
--       atacante.tld/claude.ai, userinfo@, https://claude.ai@atacante.tld) → NO;
--       y una URI desconocida mezclada con una conocida arrastra a todo el cliente;
--   (d) RLS/grants: anon/authenticated no leen ni escriben la tabla.
begin;

do $$
declare v text;
begin
  begin
    insert into public.mcp_oauth_cliente (redirect_uris, estado) values ('["https://claude.ai/cb"]'::jsonb, 'cualquiera');
    raise exception '0440: el CHECK de estado aceptó un valor inventado';
  exception when check_violation then null;
  end;
  insert into public.mcp_oauth_cliente (redirect_uris) values ('["https://x.example/cb"]'::jsonb) returning estado into v;
  if v <> 'pendiente' then
    raise exception '0440: el estado por omisión no es pendiente (%)', v;
  end if;
end $$;

-- (c) la reclasificación, sobre filas sintéticas con estado 'pendiente' y sin estado_en.
insert into public.mcp_oauth_cliente (id, nombre, redirect_uris) values
  ('44000000-0000-4000-8000-000000000001', 'claude',     '["https://claude.ai/api/mcp/auth_callback"]'),
  ('44000000-0000-4000-8000-000000000002', 'chatgpt',    '["https://chatgpt.com/connector_platform_oauth_redirect"]'),
  ('44000000-0000-4000-8000-000000000003', 'loopback',   '["http://localhost:53124/callback","http://127.0.0.1/cb"]'),
  ('44000000-0000-4000-8000-000000000004', 'desconocido','["https://atacante.tld/cb"]'),
  ('44000000-0000-4000-8000-000000000005', 'subdominio', '["https://claude.ai.atacante.tld/cb"]'),
  ('44000000-0000-4000-8000-000000000006', 'ruta',       '["https://atacante.tld/claude.ai/cb"]'),
  ('44000000-0000-4000-8000-000000000007', 'userinfo',   '["https://claude.ai@atacante.tld/cb"]'),
  ('44000000-0000-4000-8000-000000000008', 'mezcla',     '["https://claude.ai/cb","https://atacante.tld/cb"]'),
  ('44000000-0000-4000-8000-000000000009', 'vacio',      '[]'),
  ('44000000-0000-4000-8000-00000000000a', 'puerto',     '["https://claude.ai:8443/cb"]'),
  ('44000000-0000-4000-8000-00000000000b', 'http-remoto','["http://claude.ai/cb"]');

update public.mcp_oauth_cliente c
   set estado = 'aprobado', estado_en = now()
 where c.id::text like '44000000-%' and c.estado = 'pendiente' and c.estado_en is null
   and jsonb_typeof(c.redirect_uris) = 'array' and jsonb_array_length(c.redirect_uris) > 0
   and not exists (
     select 1 from jsonb_array_elements_text(c.redirect_uris) u(uri)
      where not (
        u.uri ~* '^https://(claude\.ai|claude\.com|chatgpt\.com|chat\.openai\.com|platform\.openai\.com|openai\.com)(:443)?(/|\?|#|$)'
        or u.uri ~* '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|\?|#|$)'));

do $$
declare r record;
begin
  for r in select id, nombre, estado from public.mcp_oauth_cliente where id::text like '44000000-%' loop
    if r.nombre in ('claude','chatgpt','loopback') and r.estado <> 'aprobado' then
      raise exception '0440: % debía quedar aprobado y quedó %', r.nombre, r.estado;
    end if;
    if r.nombre not in ('claude','chatgpt','loopback') and r.estado <> 'pendiente' then
      raise exception '0440: % NO debía aprobarse y quedó %', r.nombre, r.estado;
    end if;
  end loop;
end $$;

-- (d) permisos
do $$
begin
  if has_table_privilege('anon', 'public.mcp_oauth_cliente', 'select')
     or has_table_privilege('authenticated', 'public.mcp_oauth_cliente', 'select')
     or has_table_privilege('authenticated', 'public.mcp_oauth_cliente', 'update') then
    raise exception '0440: anon/authenticated tienen acceso a mcp_oauth_cliente';
  end if;
  if not has_table_privilege('service_role', 'public.mcp_oauth_cliente', 'update') then
    raise exception '0440: service_role no puede actualizar el estado';
  end if;
end $$;

rollback;
\echo '0440 OK'
