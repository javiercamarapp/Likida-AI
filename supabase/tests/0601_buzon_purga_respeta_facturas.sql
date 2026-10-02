-- 0601 — la purga de la bitácora del buzón respeta el PDF de una factura vigente.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values
  ('60100000-0000-4000-8000-0000000000a1', 'Flota A 0601'),
  ('60100000-0000-4000-8000-0000000000b1', 'Flota B 0601');

insert into public.factura_proveedor (id, tenant_id, cfdi_uuid, total, xml_crudo, estado, pdf_ruta, pdf_sha256, pdf_nombre) values
  ('60100000-0000-4000-8000-0000000000a2', '60100000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000601', 1160, '<x/>', 'aprobada',
   '60100000-0000-4000-8000-0000000000a1/' || repeat('1', 64) || '.pdf', repeat('1', 64), 'f.pdf');

do $$
declare
  A constant uuid := '60100000-0000-4000-8000-0000000000a1';
  B constant uuid := '60100000-0000-4000-8000-0000000000b1';
  RUTA_FACTURA constant text := '60100000-0000-4000-8000-0000000000a1/' || repeat('1', 64) || '.pdf';
  RUTA_SUELTA  constant text := '60100000-0000-4000-8000-0000000000a1/' || repeat('2', 64) || '.pdf';
  RUTA_VIVA    constant text := '60100000-0000-4000-8000-0000000000a1/' || repeat('3', 64) || '.pdf';
  RUTA_B       constant text := '60100000-0000-4000-8000-0000000000b1/' || repeat('4', 64) || '.pdf';
begin
  -- (1) una recepción vieja DESCARTADA cuya ruta es hoy el PDF de la factura (el mismo PDF reentró): NO se encola.
  insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, recibido_en, storage_ruta)
    values (A, 'viejo-descartado', 'f.pdf', 'pdf', 10, repeat('1', 64), 'descartada', now() - interval '400 days', RUTA_FACTURA);
  -- (2) una recepción vieja sin factura y con un PDF que nadie usa: SÍ se encola.
  insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, recibido_en, storage_ruta)
    values (A, 'viejo-suelto', 's.pdf', 'pdf', 10, repeat('2', 64), 'revision', now() - interval '400 days', RUTA_SUELTA);
  -- (3) dos recepciones del MISMO PDF: la vieja sin factura y una reciente aún en revisión: la ruta sigue viva, NO se encola.
  insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, recibido_en, storage_ruta)
    values (A, 'viejo-mismo', 'v.pdf', 'pdf', 10, repeat('3', 64), 'revision', now() - interval '400 days', RUTA_VIVA),
           (A, 'nuevo-mismo', 'v.pdf', 'pdf', 10, repeat('3', 64), 'revision', now() - interval '10 days', RUTA_VIVA);
  -- (4) una factura de OTRA flota con una ruta distinta no protege a la de A (cada flota se comprueba por su tenant).
  insert into public.buzon_recepcion (tenant_id, email_id, nombre, tipo, bytes, sha256, estado, recibido_en, storage_ruta)
    values (B, 'viejo-b', 'b.pdf', 'pdf', 10, repeat('4', 64), 'revision', now() - interval '400 days', RUTA_B);

  perform public.purgar_buzon_recepcion(now(), 365);

  if exists (select 1 from public.storage_huerfano_candidato where bucket = 'buzon-facturas' and nombre = RUTA_FACTURA) then
    raise exception '0601: la purga encoló el PDF de una factura vigente';
  end if;
  if not exists (select 1 from public.storage_huerfano_candidato where bucket = 'buzon-facturas' and nombre = RUTA_SUELTA) then
    raise exception '0601: la purga dejó de encolar un PDF que nadie usa';
  end if;
  if exists (select 1 from public.storage_huerfano_candidato where bucket = 'buzon-facturas' and nombre = RUTA_VIVA) then
    raise exception '0601: la purga encoló un PDF que otra recepción vigente todavía usa';
  end if;
  if not exists (select 1 from public.storage_huerfano_candidato where bucket = 'buzon-facturas' and nombre = RUTA_B) then
    raise exception '0601: la purga no encoló el PDF suelto de la otra flota';
  end if;
  -- La bitácora vieja sí se purga (no se conserva de más), la reciente no.
  if (select count(*) from public.buzon_recepcion where email_id in ('viejo-descartado', 'viejo-suelto', 'viejo-mismo', 'viejo-b')) <> 0 then
    raise exception '0601: la purga no borró la bitácora vieja sin factura';
  end if;
  if (select count(*) from public.buzon_recepcion where email_id = 'nuevo-mismo') <> 1 then
    raise exception '0601: la purga borró la recepción reciente';
  end if;

  -- (5) segunda barrera: aunque un PDF de factura llegue a la cola por otro camino, queda como evidencia fiscal.
  insert into public.storage_huerfano_candidato (bucket, nombre, motivo) values ('buzon-facturas', RUTA_FACTURA, 'prueba_0601');
  if (select clase_retencion from public.storage_huerfano_candidato where bucket = 'buzon-facturas' and nombre = RUTA_FACTURA) <> 'fiscal_cff_30' then
    raise exception '0601: el PDF de una factura no quedó clasificado fiscal_cff_30';
  end if;
  insert into public.storage_huerfano_candidato (bucket, nombre, motivo) values ('buzon-facturas', RUTA_SUELTA || '.x', 'prueba_0601');
  if (select clase_retencion from public.storage_huerfano_candidato where bucket = 'buzon-facturas' and nombre = RUTA_SUELTA || '.x') <> 'operativa' then
    raise exception '0601: un PDF sin factura quedó clasificado como fiscal';
  end if;
end $$;

rollback;
select '0601_buzon_purga_respeta_facturas OK' as resultado;
