-- 0800 — CONDUCTOR (piloto con voluntarios): quién participa, de dónde viene la aceptación y las dos funciones atómicas.
--
-- El piloto arranca con unos cuantos operadores que QUIEREN participar (no con toda la flota). Hoy eso no existe como dato:
--   (a) `operador.agente_voluntario` marca al operador que aceptó participar (más cuándo y quién lo registró; sin datos personales extra).
--   (b) `viaje.aceptado_origen` distingue quién aceptó el viaje: el chofer por WhatsApp, una importación de archivo/TMS o la oficina.
--       Sin esto, un viaje importado «ya aceptado» contaminaría las métricas de aceptación del chofer (T-A5-06).
--   (c) `agente_conductor_config.piloto_max_voluntarios` — tope configurable de voluntarios por flota (6 por omisión; 1..50).
--   (d) `aceptar_viajes_importados` — UN UPDATE: acepta solo los viajes ABIERTOS, sin aceptar, de la flota y de un operador voluntario.
--       Falla cerrado: sin voluntario no escribe nada. No reescribe un viaje que el chofer ya aceptó.
--   (e) `retirar_voluntario` — apaga la marca y devuelve a «sin aceptar» los viajes abiertos aceptados por importación de ese
--       operador (los hitos ya registrados se conservan: no se tocan).
--
-- Solo aditiva e idempotente (if not exists / create or replace). No redefine ninguna función ni constraint previo (0058, 0092,
-- 0380, 0661 intactos). `confirmar_viaje` (la aceptación por el chofer) no se toca.

alter table public.operador add column if not exists agente_voluntario       boolean not null default false;
alter table public.operador add column if not exists agente_voluntario_desde timestamptz;
alter table public.operador add column if not exists agente_voluntario_por   uuid;

alter table public.viaje add column if not exists aceptado_origen text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.viaje'::regclass and conname = 'viaje_aceptado_origen_dominio'
  ) then
    alter table public.viaje add constraint viaje_aceptado_origen_dominio
      check (aceptado_origen is null or aceptado_origen in ('chofer', 'importacion', 'oficina'));
  end if;
end $$;

alter table public.agente_conductor_config add column if not exists piloto_max_voluntarios smallint not null default 6;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agente_conductor_config'::regclass and conname = 'agente_conductor_config_piloto_max_voluntarios_rango'
  ) then
    alter table public.agente_conductor_config add constraint agente_conductor_config_piloto_max_voluntarios_rango
      check (piloto_max_voluntarios between 1 and 50);
  end if;
end $$;

-- Parcial a propósito: los voluntarios son un puñado por flota; el índice solo cubre esa fila y sirve a la compuerta del importador.
create index if not exists operador_voluntario_idx on public.operador (tenant_id) where agente_voluntario;

create or replace function public.aceptar_viajes_importados(
  p_tenant uuid, p_viaje_ids uuid[], p_ahora timestamptz default clock_timestamp()
) returns table (o_id uuid)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_tenant is null then raise exception 'p_tenant requerido'; end if;
  if p_viaje_ids is null or cardinality(p_viaje_ids) = 0 then return; end if;
  return query
  update public.viaje v
     set avisado_en     = coalesce(v.avisado_en, p_ahora),
         aceptado_en    = p_ahora,
         aceptado_origen = 'importacion'
    from public.operador o
   where v.id = any (p_viaje_ids)
     and v.tenant_id = p_tenant
     and v.estatus = 'abierto'
     and v.aceptado_en is null
     and o.id = v.operador_id
     and o.tenant_id = v.tenant_id
     and o.agente_voluntario
  returning v.id;
end;
$$;
revoke all on function public.aceptar_viajes_importados(uuid, uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.aceptar_viajes_importados(uuid, uuid[], timestamptz) to service_role;

create or replace function public.retirar_voluntario(p_tenant uuid, p_operador uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer := 0;
begin
  if p_tenant is null or p_operador is null then raise exception 'p_tenant y p_operador requeridos'; end if;
  -- Primero los viajes (mientras la marca sigue puesta no importa: se filtra por origen), luego la marca.
  -- Si el aviso lo puso la propia importación (avisado_en = aceptado_en) también se quita, para que el reloj de escalación
  -- de las 5 h no corra sobre un viaje al que nadie avisó; si ya estaba avisado de antes, el aviso se conserva.
  with revertidos as (
    update public.viaje v
       set avisado_en      = case when v.avisado_en = v.aceptado_en then null else v.avisado_en end,
           aceptado_en     = null,
           aceptado_origen = null
     where v.tenant_id = p_tenant
       and v.operador_id = p_operador
       and v.estatus = 'abierto'
       and v.aceptado_origen = 'importacion'
    returning v.id
  )
  select count(*) into v_n from revertidos;

  update public.operador o
     set agente_voluntario = false,
         agente_voluntario_desde = null,
         agente_voluntario_por = null
   where o.id = p_operador and o.tenant_id = p_tenant;

  return v_n;
end;
$$;
revoke all on function public.retirar_voluntario(uuid, uuid) from public, anon, authenticated;
grant execute on function public.retirar_voluntario(uuid, uuid) to service_role;
