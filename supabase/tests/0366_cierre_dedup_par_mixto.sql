-- ═══════════════════════════════════════════════════════════════════════════
-- 0366 · El CIERRE cuenta UNA vez el par mixto en `total_comprobado`.
--
-- AUDITORÍA 32 (continuación 10), DAT-32C10-C1 / ARQ-32C10-C2 (CRÍTICO).
--
-- LO QUE NINGÚN ARNÉS VEÍA. `0360_cierre_dedup_emisor.sql` existe y pasaba en
-- verde: prueba el emisor del grupo (0358) pero NUNCA un par mixto. La 0360 usa
-- UNA ventana cuya partición es un `case` que produce una llave, y las dos filas
-- de un par mixto reciben llaves distintas POR CONSTRUCCIÓN —'u|<uuid>' la que
-- trae UUID, 'f|…' su copia—, así que cada una es `rn = 1` en su propia
-- partición y sobreviven LAS DOS.
--
-- MEDIDO antes del arreglo, con UN ticket de $10,000 en dos filas y anticipo
-- $30,000: la función RECHAZABA `p_total_comprobado = 10000` con CU007 y
-- ACEPTABA —y persistía— 20000. El chofer regresaba $10,000 en vez de $20,000,
-- o el viaje no se podía liquidar: el guardia es un contrato de igualdad.
--
-- LAS TRES ASERCIONES, que se sostienen entre sí:
--   (a) el total VERDADERO se acepta  → si se cae, volvió el doble conteo;
--   (b) el DOBLE se rechaza           → si se cae, el guardia dejó de morder y
--       un cierre con dinero inflado pasaría;
--   (c) dos CFDI DISTINTOS que comparten folio, monto, concepto y emisor siguen
--       contando DOS veces → si se cae, el arreglo se pasó de largo y empezó a
--       fusionar comprobantes legítimos, que es el daño simétrico.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
insert into public.tenant(id,nombre) values
 ('36600000-0000-4000-8000-000000000001','Mixto366');
-- Dos operadores: `uq_viaje_abierto_por_operador` permite UN viaje abierto por
-- operador, así que el viaje de control necesita el suyo.
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000001','Operador sintético 366','529999903661'),
 ('36600000-0000-4000-8000-000000000002','36600000-0000-4000-8000-000000000001','Operador sintético 366 bis','529999903662');

-- ── Viaje 1 · PAR MIXTO. UN ticket de $10,000, folio 'MIX'. Anticipo $30,000.
insert into public.viaje(id,tenant_id,operador_id,folio,estatus,anticipo) values
 ('36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000001','A366-1','en_cuadre',30000);
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,pagado_en,cfdi_uuid,created_at) values
 ('00000366-0000-4000-8000-0000000000a1','36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000001',
  'diesel',10000,'2026-05-01','MIX','MIX','ESA030303CC1','99',null,'36633333-3333-4333-8333-333333333333','2026-05-01 10:00:00+00'),
 ('00000366-0000-4000-8000-0000000000a2','36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000001',
  'diesel',10000,'2026-05-01','MIX','MIX','ESA030303CC1','01',null,null,'2026-05-01 11:00:00+00');

-- ── Viaje 2 · CONTROL. Dos CFDI DISTINTOS que comparten folio, monto, concepto
--    y emisor. NO son copias: el doble conteo aquí es CORRECTO ($6,000).
insert into public.viaje(id,tenant_id,operador_id,folio,estatus,anticipo) values
 ('36600000-0000-4000-8000-000000000002','36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000002','A366-2','en_cuadre',30000);
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,pagado_en,cfdi_uuid,created_at) values
 ('00000366-0000-4000-8000-0000000000b1','36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000002',
  'diesel',3000,'2026-05-02','DOS','DOS','ESA030303CC1','01',null,'36644444-4444-4444-8444-444444444444','2026-05-02 10:00:00+00'),
 ('00000366-0000-4000-8000-0000000000b2','36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000002',
  'diesel',3000,'2026-05-02','DOS','DOS','ESA030303CC1','01',null,'36655555-5555-4555-8555-555555555555','2026-05-02 11:00:00+00');

set local role service_role;
do $$
declare
  h1 text; h2 text; v_ok boolean;
begin
  select public.cierre_insumos_hash(
    '36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000001') into h1;
  select public.cierre_insumos_hash(
    '36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000002') into h2;

  -- (a) El total VERDADERO ($10,000, el ticket UNA vez) se acepta.
  begin
    perform public.guardar_liquidacion_tx(
      '36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000001',
      10000, 30000, 20000, 'con_diferencias', '[]'::jsonb, 0,0,0, null, 0, 2, h1, 2);
  exception when others then
    raise exception 'DAT-32C10-C1: el cierre RECHAZA el total_comprobado verdadero del par mixto (10000) con "%" (%). Las dos filas del par reciben llaves de particion distintas por construccion ("u|<uuid>" y "f|..."), cada una es rn=1 y sobreviven las dos, asi que v_total sale 20000. El guardia es un contrato de igualdad: o el motor manda el doble y el cierre pasa con dinero mal, o manda el correcto y el viaje NO SE PUEDE LIQUIDAR.',
      sqlerrm, sqlstate;
  end;

  -- (b) El DOBLE ($20,000, el ticket dos veces) se rechaza.
  v_ok := false;
  begin
    perform public.guardar_liquidacion_tx(
      '36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000001',
      20000, 30000, 10000, 'con_diferencias', '[]'::jsonb, 0,0,0, null, 0, 2, h1, 2);
    v_ok := true;
  exception when others then
    null; -- rechazado, que es lo correcto
  end;
  if v_ok then
    raise exception 'DAT-32C10-C1 (otra direccion): el cierre ACEPTA total_comprobado=20000, que cuenta DOS veces un ticket de 10000. engine.ts:1286 hace diferencia = anticipo - totalComprobado, asi que el chofer regresa 10000 en vez de 20000 y la liquidacion los declara comprobados.';
  end if;

  -- (c) CONTROL: dos CFDI distintos que comparten folio siguen contando DOS veces.
  begin
    perform public.guardar_liquidacion_tx(
      '36600000-0000-4000-8000-000000000001','36600000-0000-4000-8000-000000000002',
      6000, 30000, 24000, 'con_diferencias', '[]'::jsonb, 0,0,0, null, 0, 2, h2, 2);
  exception when others then
    raise exception 'ARQ-32C10-C2 (dano simetrico): el arreglo del par mixto se paso de largo y FUSIONO dos CFDI DISTINTOS que comparten folio, monto, concepto y emisor: el cierre rechaza total_comprobado=6000 con "%" (%). Dos comprobantes con folio fiscal propio no son copias, y fusionarlos borra dinero que la flota si gasto.',
      sqlerrm, sqlstate;
  end;
end $$;
reset role;

rollback;
