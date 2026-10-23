-- 0863 — A37-S62-01: la siembra de hitos del Conductor deja de excluir PARA SIEMPRE a las flotas con perfil (tenant_perfil, 0770) y pasa a
-- exigir la compuerta explícita del Agente 5 (0859).
--
-- HALLAZGO: `sembrar_hitos_conductor` (0801) saltaba por completo a toda flota con fila en `tenant_perfil`, pero el Conductor ya se encendió
-- para esas flotas (MODULOS_PROXIMAMENTE_PERFIL = []): al habilitarlo, aceptaban viajes y no había hitos que perseguir (el latido salía «ok»
-- con la pantalla vacía).
--
-- DEFAULT SEGURO (confirmado): el comportamiento de hoy se conserva para toda flota que NO tenga `agente_chofer_habilitado = true`
-- (nace false; en producción hay 0 filas y 0 flotas habilitadas), así que esta migración NO siembra nada nuevo hoy. Una flota con perfil
-- se siembra únicamente cuando una persona la habilita (UPDATE deliberado de la 0859). Sembrar solo inserta filas `viaje_hito`; el envío
-- al chofer sigue detrás de la 0859, la ventana, la compuerta de movimiento y la de emergencias. NO enciende nada.
--
-- Compatible hacia atrás: misma firma y mismo retorno; aditiva e idempotente (create or replace).
--
-- REVERSA: re-aplicar la definición de `public.sembrar_hitos_conductor(integer)` del archivo 0801_conductor_perfil_seguimiento_y_umbrales.sql
-- (bloque `create or replace function ... end $$;` más su revoke/grant y comment). Vuelve a excluir por completo a las flotas con perfil.

create or replace function public.sembrar_hitos_conductor(p_limite integer default 500)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
  v_orden constant text[] := array['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'];
begin
  if p_limite is null or p_limite < 1 then raise exception 'p_limite inválido'; end if;

  -- 1 y 2. Viajes abiertos y aceptados que aún no tienen hitos, con el estado que dicta el perfil de su flota.
  with candidatos as (
    select v.id, v.tenant_id,
           coalesce((select c.perfil_seguimiento from public.agente_conductor_config c where c.tenant_id = v.tenant_id), 'completo') as perfil
      from public.viaje v
     where v.estatus = 'abierto'
       and v.aceptado_en is not null
       and coalesce((select c.activo from public.agente_conductor_config c where c.tenant_id = v.tenant_id), true)
       and not exists (select 1 from public.viaje_hito h where h.viaje_id = v.id)
       -- A37-S62-01: el Conductor ya no está en «Próximamente» para las flotas con perfil (0770), pero sigue sin sembrárseles NADA mientras la
       -- flota no tenga al Agente 5 habilitado de forma explícita (0859, fail-closed). Sembrar solo escribe filas; el envío lo gobierna la 0859.
       and (not exists (select 1 from public.tenant_perfil tp where tp.tenant_id = v.tenant_id) or public.conductor_agente_chofer_habilitado(v.tenant_id))
     order by v.aceptado_en
     limit p_limite
  ), tipos(tipo) as (
    values ('llegada_carga'), ('salida_carga'), ('llegada_descarga'), ('salida_descarga'), ('regreso')
  )
  insert into public.viaje_hito (tenant_id, viaje_id, tipo, estado, omitido_motivo)
  select c.tenant_id, c.id, t.tipo,
         case when c.perfil = 'esenciales' and t.tipo <> 'salida_carga' then 'omitido' else 'esperado' end,
         case when c.perfil = 'esenciales' and t.tipo <> 'salida_carga' then 'fuera_de_perfil' else null end
    from candidatos c cross join tipos t
  on conflict (viaje_id, tipo) do nothing;
  get diagnostics v_n = row_count;

  -- 3a. Flotas que pasaron a `esenciales`: lo pendiente fuera del perfil se omite (lo registrado se conserva).
  update public.viaje_hito h
     set estado = 'omitido', omitido_motivo = 'fuera_de_perfil', updated_at = now()
   where h.id in (
     select h2.id
       from public.viaje_hito h2
       join public.viaje v on v.id = h2.viaje_id and v.tenant_id = h2.tenant_id
       join public.agente_conductor_config c on c.tenant_id = v.tenant_id
      where c.perfil_seguimiento = 'esenciales' and c.activo
        and v.estatus = 'abierto' and v.aceptado_en is not null
        and h2.tipo <> 'salida_carga'
        and h2.estado in ('esperado', 'escalado')
        and (not exists (select 1 from public.tenant_perfil tp where tp.tenant_id = v.tenant_id) or public.conductor_agente_chofer_habilitado(v.tenant_id))
      order by v.aceptado_en, h2.id
      limit p_limite
   );

  -- 3b. Flotas en `completo` (o sin configuración): lo omitido por el perfil vuelve, salvo que algo posterior ya se registró.
  update public.viaje_hito h
     set estado = case when p.posterior is null then 'esperado' else 'omitido' end,
         omitido_motivo = case when p.posterior is null then null else 'inferido_por_' || p.posterior end,
         updated_at = now()
    from (
      select h2.id,
             (select h3.tipo
                from public.viaje_hito h3
               where h3.viaje_id = h2.viaje_id
                 and h3.estado in ('recibido', 'validado')
                 and array_position(v_orden, h3.tipo) > array_position(v_orden, h2.tipo)
               order by array_position(v_orden, h3.tipo)
               limit 1) as posterior
        from public.viaje_hito h2
        join public.viaje v on v.id = h2.viaje_id and v.tenant_id = h2.tenant_id
       where h2.estado = 'omitido' and h2.omitido_motivo = 'fuera_de_perfil'
         and v.estatus = 'abierto' and v.aceptado_en is not null
         and coalesce((select c.perfil_seguimiento from public.agente_conductor_config c where c.tenant_id = v.tenant_id), 'completo') = 'completo'
         and coalesce((select c.activo from public.agente_conductor_config c where c.tenant_id = v.tenant_id), true)
         and (not exists (select 1 from public.tenant_perfil tp where tp.tenant_id = v.tenant_id) or public.conductor_agente_chofer_habilitado(v.tenant_id))
       order by v.aceptado_en, h2.id
       limit p_limite
    ) p
   where h.id = p.id;

  return v_n;
end $$;
revoke all on function public.sembrar_hitos_conductor(integer) from public, anon, authenticated;
grant execute on function public.sembrar_hitos_conductor(integer) to service_role;

revoke all on function public.sembrar_hitos_conductor(integer) from public, anon, authenticated;
grant execute on function public.sembrar_hitos_conductor(integer) to service_role;

comment on function public.sembrar_hitos_conductor(integer) is
  '0863: como la 0801 (siembra por perfil de seguimiento y concilia al cambiar de perfil), pero una flota con fila en tenant_perfil (0770) se siembra y concilia SOLO si tiene el Agente 5 habilitado (0859, conductor_agente_chofer_habilitado). Sin la habilitación se salta por completo. Devuelve los hitos sembrados.';
