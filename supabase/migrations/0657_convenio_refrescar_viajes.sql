-- ═══════════════════════════════════════════════════════════════════════════
-- 0657 — Convenios: llevar una edición a los viajes en curso (opt-in de quien edita).
--
-- LOOP PUNTA A PUNTA, ola 4, P7. La foto de instrucciones de `viaje_convenio` NO cambia sola al editar el convenio (lo que
-- ya se le dijo a un operador no se reescribe a escondidas). Pero si el jefe corrige una puerta mal capturada y el viaje
-- ya despachado sigue en camino, necesita poder llevar la corrección a ese viaje. `refrescar_viajes_de_convenio` vuelve a
-- tomar la foto de los viajes NO liquidados ligados a ESE convenio, solo de los que de verdad cambian (la foto nueva es
-- distinta de la vieja: no hay envíos de relleno), y con `p_reenviar` borra el sello del despacho de los que ya lo habían
-- recibido para que vuelva a salir una vez (el que manda es la aplicación, con su claim). El sello del acercamiento a
-- cada planta NO se toca: lo ya avisado de una planta no se repite, y el que aún no salió lee la foto nueva por sí solo.
--
-- Devuelve (viaje_id, reenviar): `reenviar` = este viaje ya había recibido el despacho y hay que volver a mandarlo.
-- security definer, search_path vacío, solo service_role. Idempotente: una segunda llamada no encuentra nada que cambiar.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.refrescar_viajes_de_convenio(
  p_tenant uuid, p_convenio uuid, p_reenviar boolean default false
) returns table (viaje_id uuid, reenviar boolean)
language plpgsql security definer set search_path = ''
as $$
declare v_foto jsonb;
begin
  if not exists (select 1 from public.cliente_convenio c where c.id = p_convenio and c.tenant_id = p_tenant) then
    return;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('categoria', i.categoria, 'texto', i.texto, 'momento', i.momento,
                                               'lugar', i.lugar, 'orden', i.orden) order by i.orden, i.id), '[]'::jsonb)
    into v_foto
    from public.convenio_instruccion i
   where i.convenio_id = p_convenio and i.tenant_id = p_tenant and i.activa;

  return query
  with antes as (
    select vc.viaje_id as vid, vc.despacho_enviado_en is not null as habia
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
  '0657: vuelve a tomar la foto de instrucciones de los viajes no liquidados de un convenio (solo los que cambian) y, si se pide, reabre el despacho de los que ya lo habían recibido.';
