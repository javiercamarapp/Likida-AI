\set ON_ERROR_STOP on
-- 0442 — ARCO DE CANCELACIÓN DE UNA CUENTA DE OFICINA (titular que no es operador).
--
-- Antes: solicitud_arco con operador_id NULL → ejecutar_arco_cancelacion devolvía
-- «solicitud sin operador o de otra flota» y /privacidad prometía el borrado.
-- Se demuestra, contra Postgres real y con datos sintéticos propios (rollback):
--   (a) la cancelación de un contador por la RPC de siempre: ok, cuenta
--       seudonimizada y dada de baja, sin teléfono/correo/avatar, conversaciones
--       de WhatsApp, del analista y del copiloto borradas, tokens MCP revocados,
--       solicitud resuelta con evidencia;
--   (b) AISLAMIENTO: lo de otra flota y lo de otros usuarios de la MISMA flota no
--       se toca; una solicitud de la flota A no se ejecuta con el tenant B;
--   (c) idempotencia: la segunda ejecución se niega («ya estaba cerrada»);
--   (d) el ÚNICO dueño activo no se cancela (la flota quedaría sin administrador);
--       con un segundo dueño, sí;
--   (e) sin titular_user_id ni operador sigue negándose (no se abrió una puerta);
--   (f) superadmin no se cancela por esta vía; solo cancelación (no acceso);
--   (g) permisos: solo service_role.
begin;

insert into public.tenant (id, nombre) values
  ('44200000-0000-4000-8000-0000000000a1', 'Flota A 0442'),
  ('44200000-0000-4000-8000-0000000000b1', 'Flota B 0442');
insert into public.app_user (id, tenant_id, email, nombre, rol, telefono, avatar_url) values
  ('44200000-0000-4000-8000-0000000000c1', '44200000-0000-4000-8000-0000000000a1', 'dueno1-0442@test.invalid', 'Dueña Uno',   'flota_admin', '529999904421', 'https://x.invalid/a.png'),
  ('44200000-0000-4000-8000-0000000000c2', '44200000-0000-4000-8000-0000000000a1', 'conta-0442@test.invalid',  'Contador Dos', 'contador',    '529999904422', 'https://x.invalid/b.png'),
  ('44200000-0000-4000-8000-0000000000c3', '44200000-0000-4000-8000-0000000000a1', 'enc-0442@test.invalid',    'Encargada Tres','encargado',  '529999904423', null),
  ('44200000-0000-4000-8000-0000000000d1', '44200000-0000-4000-8000-0000000000b1', 'dueno-b-0442@test.invalid','Dueño B',      'flota_admin', '529999904431', null);

insert into public.wa_conversacion (id, tenant_id, telefono, estado) values
  ('44200000-0000-4000-8000-0000000000e2', '44200000-0000-4000-8000-0000000000a1', '529999904422', '{"t":"conta"}'),
  ('44200000-0000-4000-8000-0000000000e3', '44200000-0000-4000-8000-0000000000a1', '529999904423', '{"t":"enc"}'),
  ('44200000-0000-4000-8000-0000000000e4', '44200000-0000-4000-8000-0000000000b1', '529999904431', '{"t":"b"}');
insert into public.chat_conversacion (id, tenant_id, user_id, titulo) values
  ('44200000-0000-4000-8000-0000000000f2', '44200000-0000-4000-8000-0000000000a1', '44200000-0000-4000-8000-0000000000c2', 'chat del contador'),
  ('44200000-0000-4000-8000-0000000000f3', '44200000-0000-4000-8000-0000000000a1', '44200000-0000-4000-8000-0000000000c3', 'chat de la encargada');
insert into public.chat_mensaje (conversacion_id, rol, texto)
  select '44200000-0000-4000-8000-0000000000f2', 'usuario', 'pregunta del contador';
insert into public.copiloto_conversacion (id, user_id, titulo) values
  ('44200000-0000-4000-8000-000000000012', '44200000-0000-4000-8000-0000000000c2', 'copiloto del contador'),
  ('44200000-0000-4000-8000-000000000013', '44200000-0000-4000-8000-0000000000c3', 'copiloto de la encargada');
insert into public.mcp_oauth_cliente (id, nombre, redirect_uris, estado) values
  ('44200000-0000-4000-8000-000000000020', 'c', '["https://claude.ai/cb"]', 'aprobado');
insert into public.mcp_oauth_token (id, token_hash, tipo, cliente_id, user_id, tenant_id, rol, familia, expira_en) values
  ('44200000-0000-4000-8000-000000000021', repeat('a', 64), 'acceso', '44200000-0000-4000-8000-000000000020', '44200000-0000-4000-8000-0000000000c2', '44200000-0000-4000-8000-0000000000a1', 'contador', gen_random_uuid(), now() + interval '1 hour'),
  ('44200000-0000-4000-8000-000000000022', repeat('b', 64), 'acceso', '44200000-0000-4000-8000-000000000020', '44200000-0000-4000-8000-0000000000c3', '44200000-0000-4000-8000-0000000000a1', 'encargado', gen_random_uuid(), now() + interval '1 hour');

insert into public.solicitud_arco (id, tenant_id, operador_id, titular_user_id, titular_ref, tipo, vence_en, canal) values
  ('44200000-0000-4000-8000-000000000031', '44200000-0000-4000-8000-0000000000a1', null, '44200000-0000-4000-8000-0000000000c2', '529999904422', 'cancelacion', current_date + 20, 'whatsapp'),
  ('44200000-0000-4000-8000-000000000032', '44200000-0000-4000-8000-0000000000a1', null, null,                                     '529999904499', 'cancelacion', current_date + 20, 'whatsapp'),
  ('44200000-0000-4000-8000-000000000033', '44200000-0000-4000-8000-0000000000a1', null, '44200000-0000-4000-8000-0000000000c1', '529999904421', 'cancelacion', current_date + 20, 'whatsapp'),
  ('44200000-0000-4000-8000-000000000034', '44200000-0000-4000-8000-0000000000a1', null, '44200000-0000-4000-8000-0000000000c3', '529999904423', 'acceso',      current_date + 20, 'whatsapp');

set local role service_role;
do $$
declare r jsonb;
begin
  -- (b) otra flota no puede ejecutar la solicitud de la A
  r := public.ejecutar_arco_cancelacion('44200000-0000-4000-8000-0000000000b1', '44200000-0000-4000-8000-000000000031');
  if coalesce((r->>'ok')::boolean, false) then raise exception '0442: ejecutó la solicitud de otra flota'; end if;
  if not exists (select 1 from public.app_user where id = '44200000-0000-4000-8000-0000000000c2' and nombre = 'Contador Dos' and activo) then
    raise exception '0442: tocó la cuenta con el tenant equivocado';
  end if;

  -- (a) la cancelación de la cuenta de oficina por la RPC de siempre
  r := public.ejecutar_arco_cancelacion('44200000-0000-4000-8000-0000000000a1', '44200000-0000-4000-8000-000000000031');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '0442: no ejecutó la cancelación de la cuenta: %', r; end if;
  if not exists (select 1 from public.app_user where id = '44200000-0000-4000-8000-0000000000c2'
                  and nombre like 'Usuario %' and email like 'cancelado-%@arco.invalid'
                  and telefono is null and avatar_url is null and not activo and desactivado_en is not null) then
    raise exception '0442: la cuenta no quedó seudonimizada y dada de baja';
  end if;
  if exists (select 1 from public.wa_conversacion where id = '44200000-0000-4000-8000-0000000000e2') then raise exception '0442: sobrevivió su conversación de WhatsApp'; end if;
  if exists (select 1 from public.chat_conversacion where id = '44200000-0000-4000-8000-0000000000f2') then raise exception '0442: sobrevivió su chat'; end if;
  if exists (select 1 from public.chat_mensaje where conversacion_id = '44200000-0000-4000-8000-0000000000f2') then raise exception '0442: sobrevivió el mensaje del chat (cascada)'; end if;
  if exists (select 1 from public.copiloto_conversacion where id = '44200000-0000-4000-8000-000000000012') then raise exception '0442: sobrevivió su copiloto'; end if;
  if (select revocado_en from public.mcp_oauth_token where id = '44200000-0000-4000-8000-000000000021') is null then raise exception '0442: su token MCP sigue vivo'; end if;
  if not exists (select 1 from public.solicitud_arco where id = '44200000-0000-4000-8000-000000000031' and estado = 'resuelta'
                  and ejecutada_en is not null and evidencia->>'titular' = 'cuenta_de_oficina' and titular_ref = '529999904422') then
    raise exception '0442: la solicitud no quedó resuelta con evidencia';
  end if;

  -- (b) lo de OTROS (misma flota y otra flota) no se tocó
  if not exists (select 1 from public.app_user where id = '44200000-0000-4000-8000-0000000000c3' and nombre = 'Encargada Tres' and telefono = '529999904423' and activo) then raise exception '0442: tocó a otro usuario de la flota'; end if;
  if not exists (select 1 from public.wa_conversacion where id = '44200000-0000-4000-8000-0000000000e3') then raise exception '0442: borró la conversación de otro usuario'; end if;
  if not exists (select 1 from public.wa_conversacion where id = '44200000-0000-4000-8000-0000000000e4') then raise exception '0442: borró una conversación de otra flota'; end if;
  if not exists (select 1 from public.chat_conversacion where id = '44200000-0000-4000-8000-0000000000f3') then raise exception '0442: borró el chat de otro usuario'; end if;
  if not exists (select 1 from public.copiloto_conversacion where id = '44200000-0000-4000-8000-000000000013') then raise exception '0442: borró el copiloto de otro usuario'; end if;
  if (select revocado_en from public.mcp_oauth_token where id = '44200000-0000-4000-8000-000000000022') is not null then raise exception '0442: revocó el token de otro usuario'; end if;
  if not exists (select 1 from public.app_user where id = '44200000-0000-4000-8000-0000000000d1' and nombre = 'Dueño B') then raise exception '0442: tocó a otra flota'; end if;

  -- (c) idempotencia
  r := public.ejecutar_arco_cancelacion('44200000-0000-4000-8000-0000000000a1', '44200000-0000-4000-8000-000000000031');
  if coalesce((r->>'ok')::boolean, false) then raise exception '0442: ejecutó dos veces la misma solicitud'; end if;
  if r->>'motivo' <> 'ya estaba cerrada' then raise exception '0442: motivo inesperado en la segunda corrida: %', r; end if;

  -- (e) sin operador ni titular de cuenta sigue negándose
  r := public.ejecutar_arco_cancelacion('44200000-0000-4000-8000-0000000000a1', '44200000-0000-4000-8000-000000000032');
  if coalesce((r->>'ok')::boolean, false) then raise exception '0442: abrió una puerta para una solicitud sin titular'; end if;
  if r->>'motivo' <> 'solicitud sin operador o de otra flota' then raise exception '0442: motivo inesperado sin titular: %', r; end if;

  -- (d) el ÚNICO dueño activo no se cancela
  r := public.ejecutar_arco_cancelacion('44200000-0000-4000-8000-0000000000a1', '44200000-0000-4000-8000-000000000033');
  if coalesce((r->>'ok')::boolean, false) then raise exception '0442: canceló al único dueño activo'; end if;
  if r->>'motivo' not like 'es el único dueño activo%' then raise exception '0442: motivo inesperado con único dueño: %', r; end if;
  if not exists (select 1 from public.app_user where id = '44200000-0000-4000-8000-0000000000c1' and nombre = 'Dueña Uno' and activo) then raise exception '0442: tocó al único dueño'; end if;
  -- …con un segundo dueño sí se puede
  insert into public.app_user (id, tenant_id, email, nombre, rol) values
    ('44200000-0000-4000-8000-0000000000c4', '44200000-0000-4000-8000-0000000000a1', 'dueno2-0442@test.invalid', 'Dueño Dos', 'flota_admin');
  r := public.ejecutar_arco_cancelacion('44200000-0000-4000-8000-0000000000a1', '44200000-0000-4000-8000-000000000033');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '0442: no canceló al dueño habiendo otro: %', r; end if;

  -- (f) solo cancelación: un «acceso» no ejecuta nada
  r := public.ejecutar_arco_cancelacion('44200000-0000-4000-8000-0000000000a1', '44200000-0000-4000-8000-000000000034');
  if coalesce((r->>'ok')::boolean, false) then raise exception '0442: ejecutó una solicitud de acceso como cancelación'; end if;
  if not exists (select 1 from public.app_user where id = '44200000-0000-4000-8000-0000000000c3' and nombre = 'Encargada Tres') then raise exception '0442: una solicitud de acceso modificó la cuenta'; end if;
end $$;
reset role;

-- (f) superadmin no se cancela por esta vía
insert into public.app_user (id, tenant_id, email, nombre, rol) values
  ('44200000-0000-4000-8000-0000000000aa', '44200000-0000-4000-8000-0000000000a1', 'sa-0442@test.invalid', 'Super', 'superadmin');
insert into public.solicitud_arco (id, tenant_id, titular_user_id, titular_ref, tipo, vence_en) values
  ('44200000-0000-4000-8000-000000000035', '44200000-0000-4000-8000-0000000000a1', '44200000-0000-4000-8000-0000000000aa', 'x', 'cancelacion', current_date + 20);
set local role service_role;
do $$
declare r jsonb;
begin
  r := public.ejecutar_arco_cancelacion('44200000-0000-4000-8000-0000000000a1', '44200000-0000-4000-8000-000000000035');
  if coalesce((r->>'ok')::boolean, false) then raise exception '0442: canceló una cuenta de plataforma'; end if;
end $$;
reset role;

-- (g) permisos
do $$
begin
  if has_function_privilege('anon', 'public.ejecutar_arco_cancelacion_cuenta(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ejecutar_arco_cancelacion_cuenta(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.ejecutar_arco_cancelacion(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ejecutar_arco_cancelacion(uuid,uuid)', 'execute') then
    raise exception '0442: RPC ejecutable por un rol no autorizado';
  end if;
end $$;

rollback;
\echo '0442 OK'
