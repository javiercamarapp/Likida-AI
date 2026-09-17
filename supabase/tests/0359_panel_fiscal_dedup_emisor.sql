\set ON_ERROR_STOP on
-- AUDITORÍA 32, continuación 17-sep. DAT32C-C2 (CRÍTICO): el arreglo de ARQ-A3
-- cerró UNA de las dos copias del predicado. Lo encontró el auditor de modelo de
-- datos barriendo las 334 migraciones por `row_number() over`, y está medido
-- contra Postgres 16.
--
-- HAY DOS FUNCIONES QUE APLICAN EL CRITERIO DE «MISMO COMPROBANTE» SOBRE UN
-- UNIVERSO GRANDE, y desde la 0357 ya no dicen lo mismo:
--   · `sumar_combustible_ejercicio` (0357/0358) — tenant + ejercicio — dedupa
--     por folio MIRANDO el emisor.
--   · `gastos_fiscales_agregados_tenant` (0355:110) — tenant + rango de fechas,
--     que el panel llena con el año completo — dedupa por folio SIN mirarlo.
-- La segunda ya calcula `nullif(g.rfc_emisor,'')` doce líneas arriba (0355:30) y
-- lo publica como dimensión de celda: la columna estaba en la mano.
--
-- Medido antes del arreglo, sobre las MISMAS dos filas:
--     sumar_combustible_ejercicio  →  5000.00
--     gastos_fiscales_agregados    →  2500.00   (n:1, rfcEmisor "ESA030303CCC")
--     iva del panel                →   344.83   (la otra celda se evaporó)
--     la verdad en la base         →  5000.00 y 689.66
-- La estación B no sale como advertencia: sale como ausencia. `orden_copia = 1`
-- (0355:122) tira la fila entera antes de agregar, así que el IVA acreditable de
-- la segunda no se recupera por ningún lado.
--
-- POR QUÉ ES CRÍTICO Y NO UN DESAJUSTE INTERNO. El contralor abre
-- `/dashboard/fiscal`, ve $2,500 de diésel y $344.83 de IVA acreditable, lo
-- cruza contra su póliza y encuentra $5,000 y $689.66. Es exactamente lo que
-- CLAUDE.md prohíbe con todas sus letras: «una cifra fiscal que se lee distinto
-- en dos pantallas se lee como dos cálculos», y «un rótulo tiene que ser
-- verdad». Y es la cifra que va a cotejar en la sala.
--
-- Este archivo fija LA MISMA regla de cuatro direcciones que la 0358, pero del
-- lado del panel, y además fija que las DOS funciones coincidan.
begin;
insert into public.tenant(id,nombre) values
 ('35900000-0000-4000-8000-000000000001','Emisor359 A');
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('35900000-0000-4000-8000-000000000001','35900000-0000-4000-8000-000000000001','Operador sintético 359','529999903591');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus) values
 ('35900000-0000-4000-8000-000000000001','35900000-0000-4000-8000-000000000001','35900000-0000-4000-8000-000000000001','A359-1','liquidado'),
 ('35900000-0000-4000-8000-000000000002','35900000-0000-4000-8000-000000000001','35900000-0000-4000-8000-000000000001','A359-2','liquidado');

-- (1) Dos ESTACIONES DISTINTAS, mismo folio 1234, mismo monto, meses distintos.
--     $5,000 de diésel y $689.66 de IVA acreditable.
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,iva_traslado) values
 ('35900000-0000-4000-8000-000000000301','35900000-0000-4000-8000-000000000001','35900000-0000-4000-8000-000000000001','diesel',2500,'2026-01-15','1234','1234','ESA030303CCC','01',344.83),
 ('35900000-0000-4000-8000-000000000302','35900000-0000-4000-8000-000000000001','35900000-0000-4000-8000-000000000002','diesel',2500,'2026-08-20','1234','1234','ESB040404DDD','01',344.83);

-- (2) DOS FOTOS DEL MISMO TICKET, mismo emisor: una sola vez, $700.
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,iva_traslado) values
 ('35900000-0000-4000-8000-000000000303','35900000-0000-4000-8000-000000000001','35900000-0000-4000-8000-000000000001','diesel',700,'2026-04-01','0088','88','ESC050505EEE','01',96.55),
 ('35900000-0000-4000-8000-000000000304','35900000-0000-4000-8000-000000000001','35900000-0000-4000-8000-000000000001','diesel',700,'2026-04-01','88','88','ESC050505EEE','01',96.55);

-- (3) DOS FOTOS DEL MISMO TICKET con el OCR perdiendo el RFC en una (DAT32C-C1,
--     del lado del panel): una sola vez, $300. Sin esta dirección, el arreglo
--     del panel repetiría la regresión que la 0358 acaba de corregir.
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,iva_traslado) values
 ('35900000-0000-4000-8000-000000000305','35900000-0000-4000-8000-000000000001','35900000-0000-4000-8000-000000000001','diesel',300,'2026-05-10','9911','9911','CCO8605231N4','01',41.38),
 ('35900000-0000-4000-8000-000000000306','35900000-0000-4000-8000-000000000001','35900000-0000-4000-8000-000000000001','diesel',300,'2026-05-10','9911','9911',null,'01',41.38);

set local role service_role;
do $$
declare
  j          jsonb;
  panel      numeric;
  panel_iva  numeric;
  motor      numeric;
begin
  j := public.gastos_fiscales_agregados_tenant(
         '35900000-0000-4000-8000-000000000001','2026-01-01','2026-12-31',
         2000, 0, array['comida'], null, array['15101505'],
         '2026-01-01','2026-01-01', 0.5, 'bar', '2026-09-17');

  select coalesce(sum((c->>'monto')::numeric), 0),
         coalesce(sum((c->>'iva')::numeric), 0)
    into panel, panel_iva
    from jsonb_array_elements(j) c
   where c->>'concepto' = 'diesel';

  select total into motor
    from public.sumar_combustible_ejercicio('35900000-0000-4000-8000-000000000001', 2026, null);

  -- Rojo con la 0355: panel=3500 (la estación B se cae) contra motor=6000.
  if panel <> 6000 then
    raise exception 'DAT32C-C2: el panel fiscal colapsa dos estaciones distintas con el mismo folio: panel=% (esperado 6000 = 5000 + 700 + 300)', panel;
  end if;
  -- 344.83 x 2 (las dos estaciones) + 96.55 (una foto) + 41.38 (una foto).
  if panel_iva <> 827.59 then
    raise exception 'DAT32C-C2: el IVA acreditable de la segunda estacion se evaporo: iva=% (esperado 827.59 = 689.66 + 96.55 + 41.38)', panel_iva;
  end if;
  -- LO QUE DE VERDAD IMPORTA: las dos pantallas tienen que decir lo mismo.
  if panel <> motor then
    raise exception 'DAT32C-C2: las dos funciones fiscales se contradicen sobre las MISMAS filas: panel=% motor=%', panel, motor;
  end if;
end $$;
reset role;

rollback;
