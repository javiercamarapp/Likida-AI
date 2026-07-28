-- Los litros de diésel elegibles para el estímulo, persistidos.
--
-- El motor dejó de calcular el "IEPS acreditable" en pesos: el estímulo del LIF
-- 2026 art. 20-A es cuota semanal disminuida × litros, no el IEPS trasladado del
-- CFDI (ver normas/lif-2026-20-A.yaml, verificado contra fuente primaria), y sin
-- el acuerdo del DOF no se puede calcular aquí.
--
-- Consecuencia que hay que cerrar: `liquidacion.ieps_acreditable` ahora es
-- siempre 0, y el panel del contralor lo suma y lo DESTACA en su hero. Sin esta
-- columna, esa tarjeta muestra "$0.00" — que es peor que no mostrar nada, porque
-- parece que la flota no tiene estímulo cuando lo que pasa es que no lo
-- calculamos nosotros.
alter table liquidacion add column if not exists litros_diesel_acreditables numeric(12,3) not null default 0;

comment on column liquidacion.litros_diesel_acreditables is
  'Litros de diésel que cumplen clave de producto Y medio de pago (LIF 20-A-IV). El contador multiplica por la cuota semanal vigente; nosotros no la tenemos.';

-- La transacción de cierre tiene que persistirlos, o se pierden al guardar.
create or replace function guardar_liquidacion_tx(
  p_tenant uuid, p_viaje uuid, p_total_comprobado numeric, p_total_anticipo numeric,
  p_diferencia numeric, p_estatus text, p_diferencias jsonb, p_ieps numeric,
  p_iva numeric, p_peaje numeric, p_pdf_url text, p_litros_diesel numeric default 0
)
returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  insert into liquidacion (
    tenant_id, viaje_id, total_comprobado, total_anticipo, diferencia,
    estatus, diferencias, ieps_acreditable, iva_acreditable, peaje_acreditable,
    pdf_url, litros_diesel_acreditables
  ) values (
    p_tenant, p_viaje, p_total_comprobado, p_total_anticipo, p_diferencia,
    p_estatus, p_diferencias, p_ieps, p_iva, p_peaje, p_pdf_url, p_litros_diesel
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
    litros_diesel_acreditables = excluded.litros_diesel_acreditables,
    -- Un re-cierre que todavía no generó el PDF no puede borrar el que ya había.
    pdf_url           = coalesce(excluded.pdf_url, liquidacion.pdf_url)
  returning id into v_id;

  update viaje set estatus = 'liquidado' where id = p_viaje and tenant_id = p_tenant;
  return v_id;
end $$;

revoke all on function guardar_liquidacion_tx(uuid, uuid, numeric, numeric, numeric, text, jsonb, numeric, numeric, numeric, text, numeric) from public, anon, authenticated;
