-- 0704 — ARQ-A3 (auditoría 32, continuación 16): la sede DEDUPLICADA que
-- `/dashboard/combustible-casetas` empezó a leer en la c16, anclada contra el
-- par mixto.
--
-- POR QUÉ EXISTE
--
-- Hasta la c16 esa pantalla pintaba `gasto_por_concepto_tenant` (0150:284-287),
-- que es `select coalesce(concepto,'otro'), count(*), sum(monto) from gasto
-- group by 1` — sin un solo `row_number()`. El PDF de la liquidación, la
-- póliza, WhatsApp al chofer y /dashboard/contador leen la sede deduplicada
-- (`gastos_fiscales_agregados_tenant`, 0702: dos `row_number()` + el censo
-- `uuids_en_grupo`). El MISMO ticket salía $5,000 · 2 cargas en la pantalla y
-- $2,500 · 1 comprobante en el PDF que el contralor tiene en la mano.
--
-- La c16 cableó la pantalla a la sede deduplicada. Este arnés es lo que impide
-- que el arreglo se deshaga en silencio: si alguien rompe el dedup de la 0702,
-- la pantalla vuelve a inflar la cifra del cierre y nada más se da cuenta —
-- `gasto_por_concepto_tenant` sigue existiendo y sigue sumando crudo, así que
-- el modo de falla es «la pantalla y el PDF discrepan otra vez», no un error.
--
-- EL CASO: el par mixto, que la 0365 documenta como «la ÚNICA forma que puede
-- tomar un par de copias de un comprobante con folio fiscal». Un ticket de
-- diésel de $2,500, folio 1234, fotografiado dos veces: la 1ª sin CFDI (el OCR
-- lo leyó ilegible y `processor.ts:492` pidió otra foto — el camino NORMAL del
-- producto), la 2ª con CFDI. `uq_gasto_cfdi_uuid` impide que las dos lleven el
-- UUID, así que queda exactamente una con UUID y una sin él.
begin;

insert into tenant (id, nombre, rfc, config)
values ('00000000-0704-4000-8000-000000000001', '0704 Test', 'AAA010101AAA', '{}'::jsonb);
insert into operador (id, tenant_id, nombre, telefono)
values ('00000000-0704-4000-8000-000000000003', '00000000-0704-4000-8000-000000000001', 'Op 0704', '5215500000704');
insert into viaje (id, tenant_id, operador_id, folio, origen, destino, anticipo, fecha_inicio, estatus)
values ('00000000-0704-4000-8000-00000000000a', '00000000-0704-4000-8000-000000000001', '00000000-0704-4000-8000-000000000003', '0704-A', 'Monterrey', 'Querétaro', 5000, '2026-03-01', 'abierto');

insert into gasto (id, tenant_id, viaje_id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, forma_pago, created_at)
values
  ('00000000-0704-4000-8000-0000000000a1', '00000000-0704-4000-8000-000000000001', '00000000-0704-4000-8000-00000000000a',
   'diesel', 2500, '2026-03-01', '1234', 'PEM123456789', null, '03', '2026-03-01T10:00:00Z'),
  ('00000000-0704-4000-8000-0000000000a2', '00000000-0704-4000-8000-000000000001', '00000000-0704-4000-8000-00000000000a',
   'diesel', 2500, '2026-03-01', '1234', 'PEM123456789', '11111111-2222-3333-4444-555555555555', '03', '2026-03-01T10:05:00Z'),
  -- Una caseta real aparte, para que el arnés también demuestre que el dedup
  -- NO se come lo que no es copia (un falso positivo del dedup sería el error
  -- opuesto y del mismo tamaño: una cifra corta con cara de completa).
  ('00000000-0704-4000-8000-0000000000b1', '00000000-0704-4000-8000-000000000001', '00000000-0704-4000-8000-00000000000a',
   'caseta', 480.50, '2026-03-01', '9001', 'CAP123456789', '22222222-3333-4444-5555-666666666666', '03', '2026-03-01T11:00:00Z');

do $$
declare
  filas_dedup integer;
  monto_dedup numeric;
  filas_crudas integer;
  monto_crudo numeric;
  diesel_dedup numeric;
  diesel_n_dedup integer;
  caseta_dedup numeric;
begin
  -- ── La sede DEDUPLICADA (0702), que es la que lee la pantalla desde la c16
  select count(*), coalesce(sum((x->>'monto')::numeric), 0)
    into filas_dedup, monto_dedup
    from jsonb_array_elements(public.gastos_fiscales_agregados_tenant(
      '00000000-0704-4000-8000-000000000001'::uuid, null::date, null::date,
      2000::numeric, 0::numeric, array['alimentacion']::text[], array[]::date[],
      array['AAA']::text[], null::date, null::date, 20::numeric, 'bar'::text, '2026-03-15'::date)) x;

  select count(*), coalesce(sum((x->>'monto')::numeric), 0)
    into diesel_n_dedup, diesel_dedup
    from jsonb_array_elements(public.gastos_fiscales_agregados_tenant(
      '00000000-0704-4000-8000-000000000001'::uuid, null::date, null::date,
      2000::numeric, 0::numeric, array['alimentacion']::text[], array[]::date[],
      array['AAA']::text[], null::date, null::date, 20::numeric, 'bar'::text, '2026-03-15'::date)) x
   where x->>'concepto' = 'diesel';

  select coalesce(sum((x->>'monto')::numeric), 0)
    into caseta_dedup
    from jsonb_array_elements(public.gastos_fiscales_agregados_tenant(
      '00000000-0704-4000-8000-000000000001'::uuid, null::date, null::date,
      2000::numeric, 0::numeric, array['alimentacion']::text[], array[]::date[],
      array['AAA']::text[], null::date, null::date, 20::numeric, 'bar'::text, '2026-03-15'::date)) x
   where x->>'concepto' = 'caseta';

  -- ── La sede CRUDA (0150), para dejar la divergencia MEDIDA y no inferida
  select coalesce(sum((y->>'n')::int), 0), coalesce(sum((y->>'total')::numeric), 0)
    into filas_crudas, monto_crudo
    from jsonb_array_elements(public.gasto_por_concepto_tenant('00000000-0704-4000-8000-000000000001')) y;

  -- La afirmación que carga el peso: el par mixto cuenta UNA vez.
  if diesel_n_dedup is distinct from 1 then
    raise exception '0704: el dedup dejó % filas de diésel para el par mixto, esperaba 1 (el dedup de la 0702 se rompió y la pantalla del cierre vuelve a inflar la cifra)', diesel_n_dedup;
  end if;
  if diesel_dedup is distinct from 2500.00 then
    raise exception '0704: diésel deduplicado = %, esperaba 2500.00 (el PDF dice 2500 — si esto cambia, la pantalla y el PDF discrepan)', diesel_dedup;
  end if;

  -- Y el dedup NO se come lo que no es copia.
  if caseta_dedup is distinct from 480.50 then
    raise exception '0704: la caseta (que no es copia de nada) salió en %, esperaba 480.50 — el dedup está comiéndose comprobantes reales', caseta_dedup;
  end if;
  if filas_dedup is distinct from 2 then
    raise exception '0704: el dedup dejó % filas en total, esperaba 2 (1 diésel + 1 caseta)', filas_dedup;
  end if;
  if monto_dedup is distinct from 2980.50 then
    raise exception '0704: total deduplicado = %, esperaba 2980.50', monto_dedup;
  end if;

  -- La divergencia, medida. NO se afirma que la cruda esté "bien": se deja
  -- escrito que son dos cifras distintas sobre los mismos tres comprobantes,
  -- que es la razón por la que la pantalla dejó de leer la cruda.
  if monto_crudo <= monto_dedup then
    raise exception '0704: se esperaba que la sede CRUDA (0150) siguiera inflando el par mixto (cruda=% vs dedup=%). Si ya coinciden, la 0150 se arregló y este arnés hay que reescribirlo — no borrarlo', monto_crudo, monto_dedup;
  end if;

  raise notice '0704 OK: dedup = % en % filas (diésel % en % fila, caseta %) · cruda (0150) = % en % comprobantes. La divergencia del par mixto: % vs %.',
    monto_dedup, filas_dedup, diesel_dedup, diesel_n_dedup, caseta_dedup,
    monto_crudo, filas_crudas, monto_crudo, monto_dedup;
end $$;

rollback;
