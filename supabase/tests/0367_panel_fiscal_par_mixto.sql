-- ═══════════════════════════════════════════════════════════════════════════
-- 0367 · El PANEL DEL CONTADOR cuenta UNA vez el par mixto.
--
-- AUDITORÍA 32 (continuación 11), FIS-32C10-C1 (2ª) / DAT-32C10-C2 (4ª),
-- CRÍTICO.
--
-- LO QUE NINGÚN ARNÉS VEÍA. `0359_panel_fiscal_dedup_emisor.sql` y
-- `0362_panel_fiscal_desempate_estable.sql` existen y PASAN en verde con el
-- daño presente: prueban el eje del emisor y el del desempate, nunca un par
-- mixto. Es la misma ceguera que la 0366 documentó del 0360.
--
-- Y el daño DEPENDE DEL ORDEN DE LLEGADA, así que un arnés que siembre una
-- sola dirección puede pasar por casualidad. Por eso aquí van LAS DOS.
--
-- MEDIDO antes del arreglo, con la copia sin UUID llegando primero:
--     panel monto=20000.00  iva=2758.62  celdas=2   contra la verdad 10000.00
--
-- LAS CUATRO ASERCIONES, que se sostienen entre sí:
--   (a) la copia SIN UUID primero  → UNA celda, $10,000, IVA $1,379.31;
--   (b) la copia CON UUID primero  → lo mismo (la dirección que ya acertaba:
--       si se cae, el arreglo rompió lo que funcionaba);
--   (c) el panel coincide con `sumar_combustible_ejercicio` sobre las MISMAS
--       filas → es el cruce entre DOS sedes del dedup que PRU-32C11-C4 señaló
--       como inexistente en todo el repo;
--   (d) dos CFDI DISTINTOS que comparten concepto, folio, monto y emisor
--       siguen contando DOS veces → si se cae, el arreglo se pasó de largo y
--       empezó a fusionar comprobantes legítimos, que es el daño simétrico.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
insert into public.tenant(id,nombre) values
 ('36700000-0000-4000-8000-000000000001','PanelMixto367');
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('36700000-0000-4000-8000-000000000001','36700000-0000-4000-8000-000000000001','Operador sintético 367','529999903671');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus) values
 ('36700000-0000-4000-8000-000000000001','36700000-0000-4000-8000-000000000001','36700000-0000-4000-8000-000000000001','A367-1','liquidado');

-- ── (a) PAR MIXTO con la copia SIN UUID llegando PRIMERO. UN ticket de
--        $10,000, folio 5555, IVA $1,379.31. Es la dirección que rompía.
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,iva_traslado,cfdi_uuid,created_at) values
 ('00000367-0000-4000-8000-0000000000a1','36700000-0000-4000-8000-000000000001','36700000-0000-4000-8000-000000000001',
  'diesel',10000,'2026-03-10','5555','5555','ESA030303CCC','03',1379.31,null,'2026-03-10 10:00:00+00'),
 ('00000367-0000-4000-8000-0000000000a2','36700000-0000-4000-8000-000000000001','36700000-0000-4000-8000-000000000001',
  'diesel',10000,'2026-03-10','5555','5555','ESA030303CCC','03',1379.31,'36733333-3333-4333-8333-333333333333','2026-03-10 11:00:00+00');

-- ── (b) PAR MIXTO con la copia CON UUID llegando PRIMERO. Otro ticket, de
--        $7,000, folio 6666, IVA $965.52. Es la dirección que ya acertaba.
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,iva_traslado,cfdi_uuid,created_at) values
 ('00000367-0000-4000-8000-0000000000b1','36700000-0000-4000-8000-000000000001','36700000-0000-4000-8000-000000000001',
  'diesel',7000,'2026-04-10','6666','6666','ESB040404DDD','03',965.52,'36744444-4444-4444-8444-444444444444','2026-04-10 10:00:00+00'),
 ('00000367-0000-4000-8000-0000000000b2','36700000-0000-4000-8000-000000000001','36700000-0000-4000-8000-000000000001',
  'diesel',7000,'2026-04-10','6666','6666','ESB040404DDD','03',965.52,null,'2026-04-10 11:00:00+00');

-- ── (d) CONTROL. Dos CFDI DISTINTOS que comparten concepto, folio, monto y
--        emisor. NO son copias: el doble conteo aquí es CORRECTO ($6,000).
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,iva_traslado,cfdi_uuid,created_at) values
 ('00000367-0000-4000-8000-0000000000c1','36700000-0000-4000-8000-000000000001','36700000-0000-4000-8000-000000000001',
  'diesel',3000,'2026-05-02','DOS','DOS','ESC050505EEE','03',413.79,'36755555-5555-4555-8555-555555555555','2026-05-02 10:00:00+00'),
 ('00000367-0000-4000-8000-0000000000c2','36700000-0000-4000-8000-000000000001','36700000-0000-4000-8000-000000000001',
  'diesel',3000,'2026-05-02','DOS','DOS','ESC050505EEE','03',413.79,'36766666-6666-4666-8666-666666666666','2026-05-02 11:00:00+00');

set local role service_role;
do $$
declare
  j         jsonb;
  panel     numeric;
  filas     int;
  iva       numeric;
  motor     numeric;
begin
  -- El panel agrega en CELDAS por dimensión (tieneCfdi, emisor, forma de
  -- pago…), no una celda por gasto, así que lo que se mide es el total del
  -- concepto y el `n` acumulado — que es justo lo que el contralor suma.
  j := public.gastos_fiscales_agregados_tenant(
         '36700000-0000-4000-8000-000000000001','2026-01-01','2026-12-31',
         2000, 0, array['comida'], null, array['15101505'],
         '2026-01-01','2026-01-01', 0.5, 'bar', '2026-10-02');

  select coalesce(sum((c->>'monto')::numeric),0),
         coalesce(sum((c->>'n')::int),0),
         coalesce(sum((c->>'iva')::numeric),0)
    into panel, filas, iva
    from jsonb_array_elements(j) c
   where c->>'concepto' = 'diesel';

  select total into motor
    from public.sumar_combustible_ejercicio('36700000-0000-4000-8000-000000000001', 2026, null);

  -- La verdad de las seis filas sembradas: el par mixto de $10,000 UNA vez, el
  -- par mixto de $7,000 UNA vez, y los dos CFDI distintos de $3,000 DOS veces.
  -- 10000 + 7000 + 3000 + 3000 = 23000, en CUATRO comprobantes.
  --
  -- Las tres salidas se distinguen entre sí, que es lo que hace que estas
  -- aserciones no se puedan comprar:
  --     rota (0362)        → 33000 / 5   (el par mixto de $10,000 cuenta dos)
  --     pasada de largo    → 20000 / 3   (fusionó los dos CFDI distintos)
  --     correcta (0367)    → 23000 / 4
  if panel <> 23000 or filas <> 4 then
    raise exception 'FIS-32C10-C1: el panel del contador publica % de diesel en % comprobantes, y la verdad son 23000.00 en 4. Con 33000/5 el par mixto cuenta DOS veces (las dos filas se numeran en particiones distintas —la del UUID y la del folio—, cada una es orden_copia=1, y sobreviven las dos cuando la copia SIN uuid llega primero). Con 20000/3 el arreglo se paso de largo y FUSIONO dos CFDI distintos que comparten concepto, folio, monto y emisor, que es el dano simetrico y borra dinero que la flota si gasto.',
      panel, filas;
  end if;

  -- El IVA acreditable es la mitad cara del hallazgo: duplicarlo es un
  -- acreditamiento improcedente si el contador lo arrastra a su declaracion.
  -- 1379.31 + 965.52 + 413.79 + 413.79 = 3172.41.
  if iva <> 3172.41 then
    raise exception 'FIS-32C10-C1 (IVA): el panel publica % de IVA acreditable de diesel y la verdad es 3172.41. El par mixto duplicaba el IVA del comprobante junto con su monto.',
      iva;
  end if;

  -- EL CRUCE ENTRE DOS SEDES DEL DEDUP SOBRE LAS MISMAS FILAS. PRU-32C11-C4
  -- midió que ningún arnés del repo lo hacía, y es el hueco por el que
  -- pasaron la 0363, la 0364, la 0365 y la 0366 con la suite en verde.
  if panel <> motor then
    raise exception 'FIS-32C10-C1 (cruce de sedes): el panel y el ejercicio se contradicen sobre las MISMAS filas: panel=% motor=%. CLAUDE.md: una cifra fiscal que se lee distinto en dos pantallas se lee como dos calculos.',
      panel, motor;
  end if;
end $$;
reset role;

rollback;
