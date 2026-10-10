-- ═══════════════════════════════════════════════════════════════════════════
-- 0601 — La purga de la bitácora del buzón NO borra el PDF de una factura vigente.
--
-- Hallazgo adversarial de la ronda 03. La ruta del PDF en el bucket `buzon-facturas` depende del CONTENIDO
-- (`<tenant>/<sha256>.pdf`, con upsert): el mismo PDF que llega otra vez —por otro correo, o tras descartar la
-- primera recepción— se vuelve a subir a la MISMA ruta y se cuelga de una factura (`factura_proveedor.pdf_ruta`).
-- La recepción vieja, sin factura, conserva esa ruta, y a los 365 días `purgar_buzon_recepcion` la encolaba en
-- `storage_huerfano_candidato`: el trigger de la 0178 no miraba `factura_proveedor.pdf_ruta`, la clasificaba
-- `operativa` y el borrador HTTP borraba el objeto de la factura (evidencia fiscal, CFF art. 30).
--
-- Dos barreras, la segunda por si la primera se rompe algún día:
--   1. `purgar_buzon_recepcion` solo encola una ruta que NADIE más usa: ni una factura (`pdf_ruta`), ni otra recepción
--      ligada a una factura, ni otra recepción más reciente que el corte (aún viva, se purgará a su tiempo).
--   2. El clasificador de retención (0178) reconoce `factura_proveedor.pdf_ruta` como evidencia `fiscal_cff_30`: el
--      borrador HTTP nunca la borra aunque llegue a la cola por otro camino.
--
-- Idempotente (create or replace). No toca datos.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.purgar_buzon_recepcion(p_ahora timestamptz default now(), p_dias integer default 365)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_borradas integer;
  v_corte timestamptz;
begin
  if p_dias < 30 then
    raise exception 'purgar_buzon_recepcion: el plazo mínimo es de 30 días';
  end if;
  v_corte := p_ahora - make_interval(days => p_dias);

  -- Solo se encola un PDF que ninguna factura ni otra recepción vigente usa (la ruta es por contenido: se comparte).
  insert into public.storage_huerfano_candidato (bucket, nombre, motivo)
  select 'buzon-facturas', r.storage_ruta, 'retencion_buzon_recepcion'
  from public.buzon_recepcion r
  where r.factura_id is null and r.storage_ruta is not null and r.recibido_en < v_corte
    and not exists (
      select 1 from public.factura_proveedor f
       where f.tenant_id = r.tenant_id and f.pdf_ruta = r.storage_ruta
    )
    and not exists (
      select 1 from public.buzon_recepcion o
       where o.tenant_id = r.tenant_id and o.storage_ruta = r.storage_ruta and o.id <> r.id
         and (o.factura_id is not null or o.recibido_en >= v_corte)
    )
  on conflict (bucket, nombre) do nothing;

  delete from public.buzon_recepcion
  where factura_id is null and recibido_en < v_corte;
  get diagnostics v_borradas = row_count;
  return v_borradas;
end $$;

revoke all on function public.purgar_buzon_recepcion(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.purgar_buzon_recepcion(timestamptz, integer) to service_role;

-- Segunda barrera: el PDF de una factura es evidencia fiscal aunque llegue a la cola por otro camino.
create or replace function public.clasificar_retencion_storage_candidato()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Toda referencia viva a comprobante, liquidación, historial o PDF de factura es evidencia
  -- fiscal/documental. La cola puede conservar la observación, pero el borrador HTTP no puede
  -- borrar el objeto.
  if exists (
    select 1 from public.gasto g
     where g.imagen_url is not null and position(new.nombre in g.imagen_url) > 0
  ) or exists (
    select 1 from public.comprobante_huerfano h
     where h.ruta_imagen = new.nombre
  ) or exists (
    select 1 from public.liquidacion_historico lh
     where lh.pdf_url = new.nombre
  ) or (
    new.bucket = 'buzon-facturas' and exists (
      select 1 from public.factura_proveedor f where f.pdf_ruta = new.nombre
    )
  ) then
    new.clase_retencion := 'fiscal_cff_30';
  end if;
  return new;
end;
$$;

revoke all on function public.clasificar_retencion_storage_candidato() from public, anon, authenticated;
