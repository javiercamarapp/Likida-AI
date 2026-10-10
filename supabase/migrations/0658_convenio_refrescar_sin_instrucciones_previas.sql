-- ═══════════════════════════════════════════════════════════════════════════
-- 0658 — Corrige 0657 (adversarial ronda 10, ALTA): el reenvío tras editar un convenio llegaba solo a los viajes con el despacho
-- sellado. Un viaje despachado cuando su convenio NO traía instrucciones de despacho nunca selló nada (enviarInstrucciones sale
-- con `sin_instrucciones` antes de reclamar), así que recibía la foto nueva y no se le mandaba nada, mientras el panel decía
-- «lo recibirán con las instrucciones nuevas» (falso: ningún proceso vuelve a mandar el despacho de un viaje ya salido).
-- Ahora `reenviar` también cubre al viaje con operador cuya foto vieja no traía nada para el despacho y cuya foto nueva sí.
-- Sin cambio de firma ni de permisos; el claim de la aplicación sigue siendo el que evita duplicar.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.refrescar_viajes_de_convenio(
  p_tenant uuid, p_convenio uuid, p_reenviar boolean default false
) returns table (viaje_id uuid, reenviar boolean)
language plpgsql security definer set search_path = ''
as $$
declare v_foto jsonb; v_nueva_despacha boolean;
begin
  if not exists (select 1 from public.cliente_convenio c where c.id = p_convenio and c.tenant_id = p_tenant) then
    return;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('categoria', i.categoria, 'texto', i.texto, 'momento', i.momento,
                                               'lugar', i.lugar, 'orden', i.orden) order by i.orden, i.id), '[]'::jsonb)
    into v_foto
    from public.convenio_instruccion i
   where i.convenio_id = p_convenio and i.tenant_id = p_tenant and i.activa;
  select exists (select 1 from jsonb_array_elements(v_foto) e where e->>'momento' in ('despacho', 'ambos')) into v_nueva_despacha;

  return query
  with antes as (
    select vc.viaje_id as vid,
           -- «habia»: el despacho ya salió, O nunca pudo salir porque la foto vieja no traía nada para el despacho
           -- (enviarInstrucciones sale con sin_instrucciones antes de reclamar y no sella) y el viaje tiene a quién mandárselo.
           (vc.despacho_enviado_en is not null
            or (v.operador_id is not null and v_nueva_despacha
                and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(vc.instrucciones) = 'array' then vc.instrucciones else '[]'::jsonb end) e
                                 where e->>'momento' in ('despacho', 'ambos')))) as habia
      from public.viaje_convenio vc
      join public.viaje v on v.id = vc.viaje_id and v.tenant_id = vc.tenant_id
     where vc.tenant_id = p_tenant and vc.convenio_id = p_convenio
       and v.estatus <> 'liquidado' and vc.instrucciones is distinct from v_foto
       for update of vc
  ), cambiados as (
    update public.viaje_convenio vc
       set instrucciones = v_foto,
           despacho_reclamado_en = case when p_reenviar and a.habia then null else vc.despacho_reclamado_en end,
           despacho_enviado_en   = case when p_reenviar and a.habia then null else vc.despacho_enviado_en end,
           despacho_canal        = case when p_reenviar and a.habia then null else vc.despacho_canal end
      from antes a
     where vc.viaje_id = a.vid
    returning vc.viaje_id as vid, a.habia
  )
  select c.vid, (p_reenviar and c.habia) from cambiados c;
end;
$$;
revoke all on function public.refrescar_viajes_de_convenio(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.refrescar_viajes_de_convenio(uuid, uuid, boolean) to service_role;

comment on function public.refrescar_viajes_de_convenio(uuid, uuid, boolean) is
  '0657/0658: vuelve a tomar la foto de instrucciones de los viajes no liquidados de un convenio (solo los que cambian) y, si se pide, reabre el despacho de los que ya lo habían recibido y marca para mandar el de los que nunca lo recibieron por no haber instrucciones de despacho.';
