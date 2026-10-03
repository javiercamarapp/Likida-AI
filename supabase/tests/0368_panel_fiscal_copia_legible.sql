-- ═══════════════════════════════════════════════════════════════════════════
-- 0368 · Entre dos copias, el PANEL DEL CONTADOR se queda con la LEGIBLE.
--
-- AUDITORÍA 32 (continuación 12), FIS/DAT/ARQ-32C12-C1, CRÍTICO.
--
-- POR QUÉ EL ARNÉS DE LA 0367 NO PODÍA VER ESTO. En
-- `0367_panel_fiscal_par_mixto.sql` las dos copias de cada par llevan el MISMO
-- `iva_traslado` y el MISMO `forma_pago`. Sobreviva cualquiera de las dos, las
-- cuatro aserciones dan idéntico: el arnés es CIEGO POR CONSTRUCCIÓN al eje del
-- sobreviviente y pasa en verde con el daño presente. Aquí las copias DIFIEREN
-- --que es la única forma de que la aserción pueda fallar-- y se siembra el par
-- en LAS DOS DIRECCIONES de llegada, porque el daño dependía del orden.
--
-- MEDIDO antes de la 0368, con la borrosa llegando primero:
--     muestraId = la BORROSA · iva 0 · ivaEstado 'nulo' · tieneCfdi false
--     (la verdad: un ticket timbrado de $2,500 con IVA $344.83, forma '01')
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
insert into public.tenant(id,nombre) values
 ('36800000-0000-4000-8000-000000000001','PanelLegible368');
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('36800000-0000-4000-8000-000000000001','36800000-0000-4000-8000-000000000001','Operador sintetico 368','529999903681');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus) values
 ('36800000-0000-4000-8000-000000000001','36800000-0000-4000-8000-000000000001','36800000-0000-4000-8000-000000000001','A368-1','liquidado');

-- ── (a) La BORROSA llega PRIMERO. Es la dirección que el producto produce
--        siempre: la foto se guarda ANTES de pedir la refoto.
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,iva_traslado,sub_total,cfdi_uuid,created_at) values
 ('00000368-0000-4000-8000-0000000000a1','36800000-0000-4000-8000-000000000001','36800000-0000-4000-8000-000000000001',
  'diesel',2500,'2026-05-10','7777','7777','ESX050505EEE',null,null,null,null,'2026-05-10 10:00:00+00'),
 ('00000368-0000-4000-8000-0000000000a2','36800000-0000-4000-8000-000000000001','36800000-0000-4000-8000-000000000001',
  'diesel',2500,'2026-05-10','7777','7777','ESX050505EEE','01',344.83,2155.17,'36855555-5555-4555-8555-555555555555','2026-05-10 11:00:00+00');

-- ── (b) La LEGIBLE llega PRIMERO. La dirección que ya acertaba: si se cae, el
--        arreglo rompió lo que funcionaba.
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,iva_traslado,sub_total,cfdi_uuid,created_at) values
 ('00000368-0000-4000-8000-0000000000b1','36800000-0000-4000-8000-000000000001','36800000-0000-4000-8000-000000000001',
  'diesel',1800,'2026-06-10','8888','8888','ESY060606FFF','03',248.28,1551.72,'36866666-6666-4666-8666-666666666666','2026-06-10 10:00:00+00'),
 ('00000368-0000-4000-8000-0000000000b2','36800000-0000-4000-8000-000000000001','36800000-0000-4000-8000-000000000001',
  'diesel',1800,'2026-06-10','8888','8888','ESY060606FFF',null,null,null,null,'2026-06-10 11:00:00+00');

with panel as (
  select value as celda from jsonb_array_elements(
    public.gastos_fiscales_agregados_tenant(
      '36800000-0000-4000-8000-000000000001'::uuid,'2026-01-01'::date,'2026-12-31'::date,
      2000, 300, array['alimentacion'], array[]::date[], array['diesel'],
      '2026-01-01'::date,'2026-01-01'::date, 0.5, 'bar', '2026-07-01'::date)
  )
),
-- Las dos celdas salen separadas porque el monto entra en la llave del dedup.
a as (select celda from panel where (celda->>'monto')::numeric = 2500),
b as (select celda from panel where (celda->>'monto')::numeric = 1800)
select
  case when (select count(*) from panel) <> 2
    then '0368 FALLO (a): el par mixto dejo de contar UNA vez por direccion; celdas='
         || (select count(*) from panel)::text
  -- (a) la borrosa primero: sobrevive la LEGIBLE
  when (select celda->>'muestraId' from a) <> '00000368-0000-4000-8000-0000000000a2'
    then '0368 FALLO (a): sobrevivio la copia BORROSA; muestraId='
         || coalesce((select celda->>'muestraId' from a),'(sin celda)')
  when (select (celda->>'iva')::numeric from a) <> 344.83
    then '0368 FALLO (a): IVA acreditable BORRADO de un ticket timbrado; iva='
         || coalesce((select celda->>'iva' from a),'null') || ' (esperado 344.83)'
  when (select celda->>'ivaEstado' from a) <> 'positivo'
    then '0368 FALLO (a): ivaEstado=' || coalesce((select celda->>'ivaEstado' from a),'null')
  when (select celda->>'tieneCfdi' from a) <> 'true'
    then '0368 FALLO (a): tieneCfdi=false sobre un ticket CON uuid'
  when (select celda->>'formaPago' from a) <> '01'
    then '0368 FALLO (a): formaPago=' || coalesce((select celda->>'formaPago' from a),'null')
  when (select (celda->>'subTotal')::numeric from a) <> 2155.17
    then '0368 FALLO (a): subTotal=' || coalesce((select celda->>'subTotal' from a),'null')
  -- (b) la legible primero: NO se rompe lo que ya funcionaba
  when (select celda->>'muestraId' from b) <> '00000368-0000-4000-8000-0000000000b1'
    then '0368 FALLO (b): el arreglo rompio la direccion que acertaba; muestraId='
         || coalesce((select celda->>'muestraId' from b),'(sin celda)')
  when (select (celda->>'iva')::numeric from b) <> 248.28
    then '0368 FALLO (b): iva=' || coalesce((select celda->>'iva' from b),'null')
  else '0368 PASS — entre dos copias sobrevive la LEGIBLE en las dos direcciones (iva 344.83 y 248.28 recuperados)'
  end as resultado
\gset
\echo :resultado
select case when :'resultado' like '0368 FALLO%'
  then (1/0)::text else 'ok' end;
rollback;
