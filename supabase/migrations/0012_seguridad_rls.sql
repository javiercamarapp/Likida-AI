-- 0.4 auditoría RLS: dos huecos hallados con cliente anónimo.
--
-- (1) wa_mensaje_procesado tenía RLS APAGADO → un anónimo podía INSERTAR
--     wa_message_id falsos vía PostgREST y hacer que mensajes reales se
--     descartaran como duplicados (pérdida de mensajes). RLS on, sin policy =
--     deny-all a anon/authenticated; solo el service-role (pipeline) escribe.
alter table wa_mensaje_procesado enable row level security;

-- (2) las RPCs internas (mutex + barrera de intake) eran ejecutables por anon
--     vía PostgREST → un anónimo podía soltar locks o alterar el contador. Las
--     funciones se otorgan a PUBLIC por defecto (revocar solo de anon NO basta):
--     se revoca de PUBLIC y se concede explícito al service-role (pipeline).
revoke execute on function try_lock_viaje(uuid, integer) from public;
revoke execute on function unlock_viaje(uuid) from public;
revoke execute on function intake_delta(uuid, integer) from public;
grant execute on function try_lock_viaje(uuid, integer) to service_role;
grant execute on function unlock_viaje(uuid) to service_role;
grant execute on function intake_delta(uuid, integer) to service_role;
