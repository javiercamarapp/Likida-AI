-- 0859 — Compuerta en BASE: el Agente 5 (Conductor) NO le escribe a un chofer
-- mientras la flota no lo tenga habilitado de forma EXPLÍCITA.
--
-- HALLAZGO ALTO (auditoría 35, A35-A5-01): `agente_conductor_config.activo` nace en
-- `true` y «sin fila = defaults» (0380), así que el cron `conductor-hitos` le
-- escribía a los choferes de TODA flota con perfil sin que nadie lo hubiera
-- encendido a propósito, y sin ninguna compuerta de datos que lo impidiera.
-- Mensajes al chofer en marcha dan el argumento «ustedes me lo mandaron» ante una
-- incidencia del proveedor de telemática.
--
-- QUÉ AGREGA (aditiva, idempotente, compatible hacia atrás):
--   1. `agente_conductor_config.agente_chofer_habilitado boolean not null default
--      false`: el interruptor explícito por flota. NACE APAGADO; ninguna fila
--      existente se enciende (sin backfill). Encenderlo es un UPDATE deliberado
--      con service_role, por la flota y por una persona.
--   2. `conductor_agente_chofer_habilitado(p_tenant uuid) returns boolean`: la
--      compuerta que consulta el código antes de CADA envío a un chofer. Es
--      verdadera solo si existe la fila de la flota, `activo` y el interruptor.
--      Sin fila, tenant nulo o desconocido = false (fail-closed).
--
-- No cambia firmas ni columnas existentes. El código desplegado hoy no conoce la
-- columna: la ignora (el `select *` la trae y nadie la lee). El código nuevo, si
-- esta migración aún no se aplicó, trata la falta de columna/función como
-- «apagado» y NO envía.
--
-- REVERSA (exacta; deja la base como antes de la 0859):
--   drop function if exists public.conductor_agente_chofer_habilitado(uuid);
--   alter table public.agente_conductor_config drop column if exists agente_chofer_habilitado;
-- Tras la reversa el código nuevo cae a «apagado» (no envía): quedar sin la
-- columna NUNCA enciende nada.

alter table public.agente_conductor_config
  add column if not exists agente_chofer_habilitado boolean not null default false;

comment on column public.agente_conductor_config.agente_chofer_habilitado is
  'Compuerta explícita (0859): false = el Agente 5 NO le escribe a ningún chofer de esta flota. Nace apagada; encenderla es una decisión deliberada de una persona.';

create or replace function public.conductor_agente_chofer_habilitado(p_tenant uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select c.activo and c.agente_chofer_habilitado
       from public.agente_conductor_config c
      where c.tenant_id = p_tenant),
    false)
$$;

revoke all on function public.conductor_agente_chofer_habilitado(uuid) from public, anon, authenticated;
grant execute on function public.conductor_agente_chofer_habilitado(uuid) to service_role;
