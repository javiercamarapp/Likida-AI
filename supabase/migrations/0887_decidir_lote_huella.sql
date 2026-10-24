-- REVERSA: drop function if exists public.decidir_lote_emision(uuid, uuid, uuid, boolean, text, text, integer, numeric); y volver a aplicar el cuerpo de decidir_lote_emision de supabase/migrations/0542_autofactura_control_emision.sql (create or replace + revoke/grant a service_role). Ninguna tabla cambia.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0887 · decidir_lote_emision: la confirmación queda ligada a lo que la persona VIO (A37-S29-06)
--
-- `proponer_lote_emision` (0542) sigue AGREGANDO gastos (hasta 50) a un lote `propuesto` en cada
-- corrida del cron, y `decidir_lote_emision` solo recibía el id: confirmaba lo que el lote contuviera
-- en ese instante. Una persona podía confirmar un lote distinto del que tenía en pantalla (3 tickets
-- por $900 vs. 50 por miles) y emitir CFDI irreversibles que nadie revisó.
--
-- ADITIVA y compatible hacia atrás: dos parámetros NUEVOS al FINAL con default NULL
-- (`p_vistos_n`, `p_vistos_monto`). Sin ellos se comporta como la 0542. Con ellos, CONFIRMAR exige que
-- el lote siga teniendo exactamente esos tickets y ese monto; si creció, rechaza y la persona vuelve a
-- leer. Rechazar no necesita la huella (rechazar lo que cambió es inocuo). Una huella a medias
-- (solo uno de los dos) también se rechaza. Se reemplaza la firma de 6 args por la de 8 (si
-- convivieran, una llamada por nombre con 6 sería ambigua). Idempotente: drop if exists + create or replace.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.decidir_lote_emision(uuid, uuid, uuid, boolean, text, text);

create or replace function public.decidir_lote_emision(
  p_id uuid, p_tenant uuid, p_user uuid, p_confirmar boolean, p_version_mandato text, p_motivo text default null,
  p_vistos_n integer default null, p_vistos_monto numeric default null
)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog as $$
declare v_rol text; v_activo boolean; f autofactura_lote%rowtype; v_real boolean;
begin
  select rol, activo into v_rol, v_activo from app_user where id = p_user and tenant_id = p_tenant;
  if not found or not v_activo or v_rol not in ('flota_admin', 'contador') then
    return jsonb_build_object('ok', false, 'motivo', 'solo el dueño o el contador de la flota deciden un lote de emisión');
  end if;
  select * into f from autofactura_lote where id = p_id and tenant_id = p_tenant for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'lote inexistente en esta flota'); end if;
  if f.estado <> 'propuesto' then return jsonb_build_object('ok', false, 'motivo', 'el lote ya no está pendiente de decisión'); end if;
  if f.expira_en <= now() then
    update autofactura_lote set estado = 'expirado' where id = f.id;
    return jsonb_build_object('ok', false, 'motivo', 'el lote venció: el agente propondrá uno nuevo');
  end if;
  if p_confirmar then
    if (p_vistos_n is null) <> (p_vistos_monto is null) then
      return jsonb_build_object('ok', false, 'motivo', 'la confirmación trae la huella del lote incompleta: recarga la pantalla');
    end if;
    if p_vistos_n is not null and (p_vistos_n <> cardinality(f.gasto_ids) or p_vistos_monto <> f.monto_total) then
      return jsonb_build_object('ok', false, 'motivo', 'el lote cambió desde que lo revisaste (el agente le agregó tickets): recarga la pantalla y revísalo de nuevo');
    end if;
    select emision_real into v_real from autofactura_control where tenant_id = p_tenant;
    if coalesce(v_real, false) is not true then return jsonb_build_object('ok', false, 'motivo', 'la emisión real está apagada para esta flota: enciéndela antes de confirmar un lote'); end if;
    if not public.mandato_autofacturacion_vigente(p_tenant, p_version_mandato) then
      return jsonb_build_object('ok', false, 'motivo', 'falta el mandato de autofacturación vigente de la flota');
    end if;
    update autofactura_lote set estado = 'confirmado', decidido_por = p_user, decidido_en = now(), motivo = left(p_motivo, 400) where id = f.id;
  else
    update autofactura_lote set estado = 'rechazado', decidido_por = p_user, decidido_en = now(), motivo = left(p_motivo, 400) where id = f.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.decidir_lote_emision(uuid, uuid, uuid, boolean, text, text, integer, numeric) from public, anon, authenticated;
grant execute on function public.decidir_lote_emision(uuid, uuid, uuid, boolean, text, text, integer, numeric) to service_role;
