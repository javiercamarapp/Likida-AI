\set ON_ERROR_STOP on
-- AUDITORÍA 32, continuación 20-sep. ARQ32C4-C1 (CRÍTICO): regresión
-- introducida por el propio arreglo de la continuación 3 (`790900d`), hallada
-- por el auditor de arquitectura y corroborada por el de cumplimiento fiscal
-- (FIS-C4) desde el otro eje, y reproducida aquí contra Postgres 16 con las
-- 336 migraciones aplicadas sobre base virgen.
--
-- EL TERCER LADO DEL MISMO ESPEJO. Las migraciones 0357/0358/0359 le enseñaron
-- al SQL del PANEL que el folio se reinicia por emisor; `790900d` se lo enseñó
-- al MOTOR en TS (`copiasDeComprobante`, engine.ts:516). Nadie se lo enseñó a
-- `guardar_liquidacion_tx` (0354:238-256), que es quien VERIFICA los totales
-- en el momento del cierre y sigue rankeando con la llave anterior a la 0357:
--
--   TS  (engine.ts, desde 790900d)      f|concepto|folio|monto|EMISOR  → $5,000
--   SQL (0354 guardar_liquidacion_tx)   f|concepto|folio|monto         → $2,500
--
-- Consecuencia medida, y es peor que una cifra mal: los totales dejan de
-- derivarse de los insumos, la RPC lanza CU007 `snapshot_invalid`, y
-- `insumosDeCierreCambiaron` (repo.ts:1066-1070) sólo reconoce CU003 y CU006 —
-- CU007 no lo traduce NADIE en TS. El contralor que intenta liquidar un viaje
-- con dos tickets legítimos de la misma cantidad y el mismo folio de dos
-- gasolineras distintas NO PUEDE CERRARLO, y lo que recibe es un error opaco.
-- La ruta del cierre sí trae el emisor (`getGastos`, repo.ts:992 y :1012), así
-- que esto no depende de que el OCR lo haya leído: basta con que lo haya leído.
--
-- LA REGLA QUE ESTE ARCHIVO FIJA: la llave del cierre es la MISMA de la 0358 —
-- el emisor discrimina SÓLO CUANDO SE CONOCE, y la fila sin emisor hereda el
-- del grupo. Las cuatro direcciones de la 0358 valen aquí igual.
begin;
insert into public.tenant(id,nombre) values
 ('36000000-0000-4000-8000-000000000001','Cierre360 A');
-- Un operador por caso: `uq_viaje_abierto_por_operador` sólo admite UN viaje
-- no liquidado por operador, y los casos 2-4 dejan el suyo abierto a propósito
-- (rebotan con CU007, que es lo que se está probando).
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000001','Operador sintético 360-1','529999903601'),
 ('36000000-0000-4000-8000-000000000002','36000000-0000-4000-8000-000000000001','Operador sintético 360-2','529999903602'),
 ('36000000-0000-4000-8000-000000000003','36000000-0000-4000-8000-000000000001','Operador sintético 360-3','529999903603'),
 ('36000000-0000-4000-8000-000000000004','36000000-0000-4000-8000-000000000001','Operador sintético 360-4','529999903604');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus,anticipo) values
 ('36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000001','A360-1','en_cuadre',6000);

-- CASO 1 — DOS ESTACIONES DISTINTAS, LAS DOS CONOCIDAS. El folio 1234 lo numera
-- cada estación: son DOS comprobantes y la verdad son $5,000. Es exactamente el
-- caso que `790900d` enseñó a contar bien en el motor.
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago) values
 ('36000000-0000-4000-8000-000000000301','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000001','diesel',2500,'2026-03-10','1234','1234','CCO8605231N4','01'),
 ('36000000-0000-4000-8000-000000000302','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000001','diesel',2500,'2026-03-10','1234','1234','ESB040404DDD','01');

set local role service_role;
do $$
declare
  v_hash text;
  v_id uuid;
begin
  v_hash := public.cierre_insumos_hash(
    '36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000001');

  -- ROJO ANTES DEL ARREGLO: CU007 `snapshot_invalid`, porque la RPC recalcula
  -- $2,500 sobre las mismas dos filas que el motor contó como $5,000.
  begin
    v_id := public.guardar_liquidacion_tx(
      p_tenant   => '36000000-0000-4000-8000-000000000001',
      p_viaje    => '36000000-0000-4000-8000-000000000001',
      p_total_comprobado => 5000,
      p_total_anticipo   => 6000,
      p_diferencia       => 1000,
      p_estatus  => 'con_diferencias',
      p_diferencias => '[]'::jsonb,
      p_ieps => 0, p_iva => 0, p_peaje => 0, p_pdf_url => null,
      p_litros_diesel => 0, p_n_gastos => 2,
      p_insumos_hash => v_hash, p_insumos_hash_version => 2);
  exception when others then
    raise exception 'ARQ32C4-C1: el cierre de un viaje con dos tickets legítimos de dos estaciones distintas (folio 1234, $2,500 c/u) REBOTÓ con %  (%). El motor manda $5,000 y guardar_liquidacion_tx recalcula $2,500 con la llave anterior a la 0357.', sqlstate, sqlerrm;
  end;

  if v_id is null then
    raise exception 'ARQ32C4-C1: guardar_liquidacion_tx no devolvió id';
  end if;
end $$;
reset role;

-- CASO 2 — MISMO EMISOR: siguen siendo copias, y el cierre debe seguir exigiendo
-- $2,500. Esta es la dirección que impide "arreglar" borrando el emisor de la
-- llave: sin ella, un arreglo que simplemente ignore el emisor pasaría igual.
insert into public.viaje(id,tenant_id,operador_id,folio,estatus,anticipo) values
 ('36000000-0000-4000-8000-000000000002','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000002','A360-2','en_cuadre',6000);
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago) values
 ('36000000-0000-4000-8000-000000000311','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000002','diesel',2500,'2026-03-11','1234','1234','CCO8605231N4','01'),
 ('36000000-0000-4000-8000-000000000312','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000002','diesel',2500,'2026-03-11','1234','1234','CCO8605231N4','01');

set local role service_role;
do $$
declare v_hash text; v_ok boolean := false;
begin
  v_hash := public.cierre_insumos_hash(
    '36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000002');
  begin
    perform public.guardar_liquidacion_tx(
      p_tenant => '36000000-0000-4000-8000-000000000001',
      p_viaje  => '36000000-0000-4000-8000-000000000002',
      p_total_comprobado => 5000, p_total_anticipo => 6000, p_diferencia => 1000,
      p_estatus => 'con_diferencias', p_diferencias => '[]'::jsonb,
      p_ieps => 0, p_iva => 0, p_peaje => 0, p_pdf_url => null,
      p_litros_diesel => 0, p_n_gastos => 2,
      p_insumos_hash => v_hash, p_insumos_hash_version => 2);
  exception when sqlstate 'CU007' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'ARQ32C4-C1 (caso 2): dos fotos del MISMO ticket del MISMO emisor se aceptaron como $5,000. La llave dejó de mirar el emisor en vez de mirarlo sólo cuando se conoce.';
  end if;
end $$;
reset role;

-- CASO 3 — EMISOR NULO EN AMBAS: son copias (0349), el cierre exige $2,500.
insert into public.viaje(id,tenant_id,operador_id,folio,estatus,anticipo) values
 ('36000000-0000-4000-8000-000000000003','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000003','A360-3','en_cuadre',6000);
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago) values
 ('36000000-0000-4000-8000-000000000321','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000003','diesel',2500,'2026-03-12','1234','1234',null,'01'),
 ('36000000-0000-4000-8000-000000000322','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000003','diesel',2500,'2026-03-12','1234','1234',null,'01');

set local role service_role;
do $$
declare v_hash text; v_ok boolean := false;
begin
  v_hash := public.cierre_insumos_hash(
    '36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000003');
  begin
    perform public.guardar_liquidacion_tx(
      p_tenant => '36000000-0000-4000-8000-000000000001',
      p_viaje  => '36000000-0000-4000-8000-000000000003',
      p_total_comprobado => 5000, p_total_anticipo => 6000, p_diferencia => 1000,
      p_estatus => 'con_diferencias', p_diferencias => '[]'::jsonb,
      p_ieps => 0, p_iva => 0, p_peaje => 0, p_pdf_url => null,
      p_litros_diesel => 0, p_n_gastos => 2,
      p_insumos_hash => v_hash, p_insumos_hash_version => 2);
  exception when sqlstate 'CU007' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'ARQ32C4-C1 (caso 3): dos fotos sin emisor se aceptaron como $5,000. Un emisor ausente no es evidencia de una estación distinta.';
  end if;
end $$;
reset role;

-- CASO 4 — EMISOR EN UNA Y NULO EN LA OTRA: son copias (la cuarta dirección de
-- la 0358). El cierre exige $2,500, y la fila sin emisor hereda el del grupo.
insert into public.viaje(id,tenant_id,operador_id,folio,estatus,anticipo) values
 ('36000000-0000-4000-8000-000000000004','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000004','A360-4','en_cuadre',6000);
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago) values
 ('36000000-0000-4000-8000-000000000331','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000004','diesel',2500,'2026-03-13','1234','1234','CCO8605231N4','01'),
 ('36000000-0000-4000-8000-000000000332','36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000004','diesel',2500,'2026-03-13','1234','1234',null,'01');

set local role service_role;
do $$
declare v_hash text; v_ok boolean := false;
begin
  v_hash := public.cierre_insumos_hash(
    '36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000004');
  begin
    perform public.guardar_liquidacion_tx(
      p_tenant => '36000000-0000-4000-8000-000000000001',
      p_viaje  => '36000000-0000-4000-8000-000000000004',
      p_total_comprobado => 5000, p_total_anticipo => 6000, p_diferencia => 1000,
      p_estatus => 'con_diferencias', p_diferencias => '[]'::jsonb,
      p_ieps => 0, p_iva => 0, p_peaje => 0, p_pdf_url => null,
      p_litros_diesel => 0, p_n_gastos => 2,
      p_insumos_hash => v_hash, p_insumos_hash_version => 2);
  exception when sqlstate 'CU007' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'ARQ32C4-C1 (caso 4): el emisor perdido por el OCR abrió partición propia y el cierre aceptó $5,000 — es la regresión que costó los dos CRÍTICOS de la 0358.';
  end if;
end $$;
reset role;
rollback;
