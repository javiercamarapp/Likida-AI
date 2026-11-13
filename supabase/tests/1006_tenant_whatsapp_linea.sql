\set ON_ERROR_STOP on
-- 1006 — línea de WhatsApp por tenant contra Postgres REAL, en una transacción revertida. Datos sintéticos. Lo que solo la base garantiza:
--   (a) el token solo cabe cifrado (CHECK like 'v2.%'): uno en claro, uno v1 y uno vacío se rechazan;
--   (b) un phone_number_id pertenece a UN solo tenant (unicidad global), y no puede ser vacío;
--   (c) el estado solo admite pendiente|activa|pausada|token_vencido y nace pendiente;
--   (d) VARIAS líneas por tenant (viva o no), propósito acotado, una sola principal ACTIVA, cambio de principal atómico y terminal_id nulo si
--       se borra la terminal;
--   (e) borrar el tenant borra sus líneas (cascada);
--   (f) anon/authenticated sin privilegio alguno (ni de columna) sobre la tabla ni sobre la función de principal; service_role puede todo;
--   (g) wa_outbox gana tenant_id y phone_number_id NULOS: las filas sin ellos conviven.
begin;

insert into public.tenant (id, nombre) values
  ('10060000-0000-4000-8000-0000000000a1', 'Flota A 1006'),
  ('10060000-0000-4000-8000-0000000000b1', 'Flota B 1006');
insert into public.terminal (id, tenant_id, nombre) values
  ('10060000-0000-4000-8000-0000000000c1', '10060000-0000-4000-8000-0000000000a1', 'Terminal 1006');

-- (f, parte privilegios) se consulta antes de bajar de rol.
do $$
begin
  if has_any_column_privilege('authenticated', 'public.tenant_whatsapp_linea', 'select')
     or has_any_column_privilege('anon', 'public.tenant_whatsapp_linea', 'select') then
    raise exception '1006(f): anon/authenticated tienen privilegio de lectura sobre la tabla';
  end if;
  if has_table_privilege('authenticated', 'public.tenant_whatsapp_linea', 'insert')
     or has_table_privilege('authenticated', 'public.tenant_whatsapp_linea', 'update')
     or has_table_privilege('authenticated', 'public.tenant_whatsapp_linea', 'delete') then
    raise exception '1006(f): authenticated no debía escribir';
  end if;
  if not has_table_privilege('service_role', 'public.tenant_whatsapp_linea', 'insert') then
    raise exception '1006(f): service_role debía poder insertar';
  end if;
  if has_function_privilege('authenticated', 'public.tenant_whatsapp_linea_hacer_principal(uuid)', 'execute')
     or has_function_privilege('anon', 'public.tenant_whatsapp_linea_hacer_principal(uuid)', 'execute') then
    raise exception '1006(f): anon/authenticated no debían ejecutar hacer_principal';
  end if;
  if not has_function_privilege('service_role', 'public.tenant_whatsapp_linea_hacer_principal(uuid)', 'execute') then
    raise exception '1006(f): service_role debía ejecutar hacer_principal';
  end if;
end $$;

set local role service_role;

do $$
declare
  ta constant uuid := '10060000-0000-4000-8000-0000000000a1';
  tb constant uuid := '10060000-0000-4000-8000-0000000000b1';
  r record;
  n int;
begin
  -- (a) solo cifrado v2.
  begin insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado) values (ta, '1006-claro', 'EAAB-token-en-claro'); raise exception '1006(a): token en claro aceptado';
  exception when check_violation then null; end;
  begin insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado) values (ta, '1006-v1', 'v1.a.b.c'); raise exception '1006(a): token v1 aceptado';
  exception when check_violation then null; end;
  begin insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado) values (ta, '1006-vacio', ''); raise exception '1006(a): token vacío aceptado';
  exception when check_violation then null; end;

  -- (c) nace pendiente.
  insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado) values (ta, '1006-pn-a', 'v2.a.b.c');
  select * into r from public.tenant_whatsapp_linea where phone_number_id = '1006-pn-a';
  if r.estado <> 'pendiente' then raise exception '1006(c): debía nacer pendiente y nació %', r.estado; end if;
  if r.verificada_en is not null or r.ultimo_error is not null then raise exception '1006(c): verificada_en y ultimo_error debían nacer nulos'; end if;
  begin update public.tenant_whatsapp_linea set estado = 'verificada' where phone_number_id = '1006-pn-a'; raise exception '1006(c): estado desconocido aceptado';
  exception when check_violation then null; end;
  update public.tenant_whatsapp_linea set estado = 'activa' where phone_number_id = '1006-pn-a';
  update public.tenant_whatsapp_linea set estado = 'token_vencido' where phone_number_id = '1006-pn-a';
  update public.tenant_whatsapp_linea set estado = 'activa' where phone_number_id = '1006-pn-a';

  -- (b) un número, un tenant; ni vacío.
  begin insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado) values (tb, '1006-pn-a', 'v2.x.y.z'); raise exception '1006(b): el mismo phone_number_id cayó a dos tenants';
  exception when unique_violation then null; end;
  begin insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado) values (tb, '   ', 'v2.x.y.z'); raise exception '1006(b): phone_number_id vacío aceptado';
  exception when check_violation then null; end;

  -- (d) VARIAS líneas por tenant: viva, pendiente, token_vencido y pausadas conviven.
  update public.tenant_whatsapp_linea set estado = 'activa', principal = true, etiqueta = 'Servicio', proposito = 'servicio_cliente' where phone_number_id = '1006-pn-a';
  insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado, estado, etiqueta, proposito, terminal_id)
    values (ta, '1006-pn-a2', 'v2.x.y.z', 'activa', 'Operadores', 'operadores', '10060000-0000-4000-8000-0000000000c1');
  insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado, estado, proposito) values (ta, '1006-pn-a3', 'v2.x.y.z', 'pendiente', 'oficina');
  insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado, estado) values (ta, '1006-pn-a4', 'v2.x.y.z', 'pausada');
  select count(*) into n from public.tenant_whatsapp_linea where tenant_id = ta;
  if n <> 4 then raise exception '1006(d): se esperaban 4 líneas del tenant y hay %', n; end if;
  begin insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado, proposito) values (ta, '1006-pn-a5', 'v2.x.y.z', 'marketing'); raise exception '1006(d): propósito desconocido aceptado';
  exception when check_violation then null; end;
  -- una sola principal activa por tenant.
  begin update public.tenant_whatsapp_linea set principal = true where phone_number_id = '1006-pn-a2'; raise exception '1006(d): dos principales activas aceptadas';
  exception when unique_violation then null; end;
  -- cambio atómico: la nueva sube, la vieja baja, y nunca hay dos.
  if not public.tenant_whatsapp_linea_hacer_principal((select id from public.tenant_whatsapp_linea where phone_number_id = '1006-pn-a2')) then
    raise exception '1006(d): hacer_principal devolvió false para una línea activa';
  end if;
  select count(*) into n from public.tenant_whatsapp_linea where tenant_id = ta and principal;
  if n <> 1 then raise exception '1006(d): tras el cambio debía haber 1 principal y hay %', n; end if;
  select * into r from public.tenant_whatsapp_linea where principal and tenant_id = ta;
  if r.phone_number_id <> '1006-pn-a2' then raise exception '1006(d): la principal debía ser 1006-pn-a2 y es %', r.phone_number_id; end if;
  -- una línea no activa o inexistente no puede ser principal.
  if public.tenant_whatsapp_linea_hacer_principal((select id from public.tenant_whatsapp_linea where phone_number_id = '1006-pn-a3')) then
    raise exception '1006(d): una línea pendiente no debía poder ser principal';
  end if;
  if public.tenant_whatsapp_linea_hacer_principal('10060000-0000-4000-8000-0000000000ff') then
    raise exception '1006(d): una línea inexistente no debía poder ser principal';
  end if;
  -- borrar la terminal deja terminal_id nulo (no borra la línea).
  delete from public.terminal where id = '10060000-0000-4000-8000-0000000000c1';
  select * into r from public.tenant_whatsapp_linea where phone_number_id = '1006-pn-a2';
  if r.terminal_id is not null then raise exception '1006(d): terminal_id debía quedar nulo al borrar la terminal'; end if;

  -- el otro tenant tiene la suya sin estorbo, y puede tener su propia principal.
  insert into public.tenant_whatsapp_linea (tenant_id, phone_number_id, token_cifrado, estado, principal) values (tb, '1006-pn-b', 'v2.x.y.z', 'activa', true);

  -- (g) wa_outbox con y sin las columnas nuevas.
  if to_regclass('public.wa_outbox') is not null then
    insert into public.wa_outbox (dedupe_key, payload) values ('1006-sin', '{}'::jsonb);
    insert into public.wa_outbox (dedupe_key, payload, tenant_id, phone_number_id) values ('1006-con', '{}'::jsonb, ta, '1006-pn-a2');
    select * into r from public.wa_outbox where dedupe_key = '1006-sin';
    if r.tenant_id is not null or r.phone_number_id is not null then raise exception '1006(g): la fila sin las columnas debía quedar nula'; end if;
    select * into r from public.wa_outbox where dedupe_key = '1006-con';
    if r.tenant_id <> ta or r.phone_number_id <> '1006-pn-a2' then raise exception '1006(g): las columnas nuevas no guardaron'; end if;
  end if;

  -- (e) la cascada.
  delete from public.tenant where id = tb;
  select count(*) into n from public.tenant_whatsapp_linea where tenant_id = tb;
  if n <> 0 then raise exception '1006(e): las líneas del tenant borrado debían irse; quedan %', n; end if;
end $$;

rollback;
