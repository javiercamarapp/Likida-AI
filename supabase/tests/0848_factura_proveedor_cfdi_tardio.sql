-- pgTAP: columnas de la 0845 (`xml_crudo_tardio` / `recibido_tardio_en` de `factura_proveedor`).
-- Tres aserciones, sintético, dentro de una transacción que termina en rollback:
--   (a) las dos columnas nacen NULL (nunca llegó un XML tardío);
--   (b) se pueden llenar juntas sin romper ningún CHECK existente, y la factura
--       sigue APROBADA (la migración no toca la decisión);
--   (c) llenar solo una de las dos (sin la otra) rebota por el CHECK de coherencia.
-- Correr:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0848_factura_proveedor_cfdi_tardio.sql
begin;
create extension if not exists pgtap;
select plan(3);

insert into public.tenant (id, nombre) values ('00000000-0000-0000-0000-00000008450a', 'Flota Sintetica 0845');

-- La factura se leyó de un PDF (fuente_datos pdf_vision, sin xml_crudo): el CHECK de la 0108
-- exige xml_crudo O ocr_confianza, así que ocr_confianza va en el MISMO insert.
insert into public.factura_proveedor (id, tenant_id, cfdi_uuid, total, estado, decidido_por, decidido_en, xml_crudo, ocr_confianza, fuente_datos)
values (
  '00000000-0000-0000-0000-00000008451a', '00000000-0000-0000-0000-00000008450a',
  'cfdi-0845-aaaa-bbbb-cccc', 1160.00, 'aprobada', 'ana@flota.mx', now(), null, 0.55, 'pdf_vision'
)
on conflict do nothing;

-- (a) Nacen NULL.
select is(
  (select (xml_crudo_tardio is null and recibido_tardio_en is null)
     from public.factura_proveedor where id = '00000000-0000-0000-0000-00000008451a'),
  true,
  '(a) xml_crudo_tardio y recibido_tardio_en nacen NULL'
);

-- (b) El XML real llega DESPUÉS de la aprobación: se guarda sin tocar la decisión.
update public.factura_proveedor
set xml_crudo_tardio = '<cfdi:Comprobante Total="1160.00"/>', recibido_tardio_en = now()
where id = '00000000-0000-0000-0000-00000008451a';

select is(
  (select (xml_crudo_tardio is not null and recibido_tardio_en is not null and estado = 'aprobada' and decidido_por = 'ana@flota.mx')
     from public.factura_proveedor where id = '00000000-0000-0000-0000-00000008451a'),
  true,
  '(b) el XML tardío se guarda y la decisión (estado/decidido_por) queda intacta'
);

-- (c) Las dos columnas van juntas: llenar solo una rebota por el CHECK.
select throws_ok(
  $$update public.factura_proveedor set xml_crudo_tardio = '<x/>', recibido_tardio_en = null where id = '00000000-0000-0000-0000-00000008451a'$$,
  '23514',
  null,
  '(c) xml_crudo_tardio sin recibido_tardio_en (o viceversa) rebota por el CHECK de coherencia'
);

select * from finish();
rollback;
