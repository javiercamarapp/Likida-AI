-- AUDIT_V3 money-path CRÍTICO: el cierre era NO atómico. saveLiquidacion hacía
-- (1) upsert de liquidacion y (2) update viaje.estatus='liquidado' como dos
-- statements separados, e IGNORABA el error del segundo. Resultado posible:
-- liquidacion persistida pero viaje aún 'abierto' → getOpenViaje lo devuelve, el
-- guard de "ya cerrado" no dispara, y el operador puede re-cuadrar (costo extra).
--
-- Una función plpgsql corre en UNA transacción: si el update de viaje falla, el
-- upsert de la liquidacion hace ROLLBACK también. Cierre atómico o nada.
create or replace function guardar_liquidacion_tx(
  p_tenant uuid,
  p_viaje uuid,
  p_total_comprobado numeric,
  p_total_anticipo numeric,
  p_diferencia numeric,
  p_estatus text,
  p_diferencias jsonb,
  p_ieps numeric,
  p_iva numeric,
  p_peaje numeric,
  p_pdf_url text
) returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  insert into liquidacion (
    tenant_id, viaje_id, total_comprobado, total_anticipo, diferencia,
    estatus, diferencias, ieps_acreditable, iva_acreditable, peaje_acreditable, pdf_url
  ) values (
    p_tenant, p_viaje, p_total_comprobado, p_total_anticipo, p_diferencia,
    p_estatus, p_diferencias, p_ieps, p_iva, p_peaje, p_pdf_url
  )
  on conflict (viaje_id) do update set
    total_comprobado  = excluded.total_comprobado,
    total_anticipo    = excluded.total_anticipo,
    diferencia        = excluded.diferencia,
    estatus           = excluded.estatus,
    diferencias       = excluded.diferencias,
    ieps_acreditable  = excluded.ieps_acreditable,
    iva_acreditable   = excluded.iva_acreditable,
    peaje_acreditable = excluded.peaje_acreditable,
    -- preserva el PDF existente si un re-cierre idempotente llega sin ruta
    pdf_url           = coalesce(excluded.pdf_url, liquidacion.pdf_url)
  returning id into v_id;

  update viaje set estatus = 'liquidado' where id = p_viaje and tenant_id = p_tenant;

  return v_id;
end $$;

-- Solo service_role. OJO: Supabase concede EXECUTE a anon/authenticated de forma
-- EXPLÍCITA por default privileges, así que `revoke from public` NO basta (se
-- verificó en la DB: anon/authenticated seguían con EXECUTE). Hay que revocar de
-- los tres explícitamente. Verificado post-migración: exec_roles = {postgres, service_role}.
revoke execute on function guardar_liquidacion_tx(uuid, uuid, numeric, numeric, numeric, text, jsonb, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function guardar_liquidacion_tx(uuid, uuid, numeric, numeric, numeric, text, jsonb, numeric, numeric, numeric, text) to service_role;
