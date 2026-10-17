-- 0703 — PRU-32C15-C1 (auditoría 32, continuación 16): el CONTRATO de columnas
-- de `guardar_liquidacion_tx`, el único escritor de la liquidación.
--
-- POR QUÉ EXISTE
--
-- La c15 midió el hueco y lo dejó escrito: mutando la FUNCIÓN VIVA (no el
-- archivo de migración, que es un no-op por `CREATE OR REPLACE`) para que
-- `p_ieps` y `p_iva` aterricen cruzados, la batería entera de arneses SQL daba
-- `total fallos: 0`. Cero archivos de `supabase/tests/` mencionaban
-- `ieps_acreditable` o `iva_acreditable`, y del lado de TypeScript
-- `repo_escritura.test.ts:146` afirma sobre `rpc.mock.calls[0][1]`: mide lo que
-- `repo.ts` MANDA, nunca dónde ATERRIZA. Las dos capas se cubrían la una a la
-- otra y el hueco quedaba en medio.
--
-- Lo que se escapaba por ese hueco: el estímulo de IEPS al diésel y el IVA
-- acreditable son DOS créditos fiscales distintos, en DOS renglones distintos
-- de la declaración. Cruzados, el total de la liquidación cuadra igual y el
-- contralor importa a su ERP una póliza con los dos créditos intercambiados.
--
-- QUÉ ANCLA
--
-- Un valor centinela DISTINTO por cada parámetro que aterriza en una columna
-- de dinero o fiscal, de modo que el intercambio de CUALQUIER par —no solo
-- ieps↔iva— enrojezca este arnés. El que no distingue nada es el que no
-- prueba nada: si los siete centinelas fueran iguales, la mutación pasaría.
--
-- No corresponde a una migración 0703 (no existe): la función viva la define
-- la 0366 y la 0702 es la última que la reemplaza. El número solo lo ordena
-- después de la 0702 en la lista de `.github/workflows/ci-postgres.yml`.
begin;

insert into tenant (id, nombre, rfc, config)
values ('00000000-0703-4000-8000-000000000001', '0703 Test', 'AAA010101AAA', '{}'::jsonb);
insert into app_user (id, tenant_id, email, rol)
values ('00000000-0703-4000-8000-000000000002', '00000000-0703-4000-8000-000000000001', '0703@test.local', 'flota_admin');
insert into operador (id, tenant_id, nombre, telefono)
values ('00000000-0703-4000-8000-000000000003', '00000000-0703-4000-8000-000000000001', 'Op 0703', '5215500000703');
insert into viaje (id, tenant_id, operador_id, folio, origen, destino, anticipo, fecha_inicio, estatus)
values ('00000000-0703-4000-8000-00000000000a', '00000000-0703-4000-8000-000000000001', '00000000-0703-4000-8000-000000000003', '0703-A', 'Monterrey', 'Querétaro', 9422.22, '2026-03-01', 'en_cuadre');

do $$
declare
  -- Siete centinelas, los siete distintos entre sí y ninguno derivable de
  -- otro por redondeo: cualquier intercambio de par cambia al menos una
  -- de las siete afirmaciones de abajo.
  c_comprobado    numeric := 9311.11;
  c_anticipo      numeric := 9422.22;
  c_diferencia    numeric :=  111.11;  -- anticipo − comprobado, para que el renglón sea coherente
  c_ieps          numeric := 1477.35;  -- los dos valores con los que la c15 midió el cruce
  c_iva           numeric :=  663.79;
  c_peaje         numeric :=  288.41;
  c_litros        numeric :=  352.77;
  v_id uuid;
  r record;
begin
  v_id := public.guardar_liquidacion_tx(
    '00000000-0703-4000-8000-000000000001'::uuid,
    '00000000-0703-4000-8000-00000000000a'::uuid,
    c_comprobado, c_anticipo, c_diferencia,
    'cuadrada', '[]'::jsonb,
    c_ieps, c_iva, c_peaje,
    'https://ejemplo.invalid/0703.pdf',
    c_litros
  );

  if v_id is null then
    raise exception '0703: guardar_liquidacion_tx no devolvió id';
  end if;

  select total_comprobado, total_anticipo, diferencia, estatus,
         ieps_acreditable, iva_acreditable, peaje_acreditable,
         litros_diesel_acreditables, pdf_url
    into r
    from liquidacion
   where id = v_id and tenant_id = '00000000-0703-4000-8000-000000000001';

  if not found then
    raise exception '0703: la liquidación % no quedó en la tabla', v_id;
  end if;

  -- Una afirmación por columna, con su propio mensaje: el arnés no solo dice
  -- "algo se cruzó", dice CUÁL columna recibió qué.
  if r.ieps_acreditable is distinct from c_ieps then
    raise exception '0703: p_ieps=% aterrizó en ieps_acreditable=% (se cruzó con otra columna)', c_ieps, r.ieps_acreditable;
  end if;
  if r.iva_acreditable is distinct from c_iva then
    raise exception '0703: p_iva=% aterrizó en iva_acreditable=% (se cruzó con otra columna)', c_iva, r.iva_acreditable;
  end if;
  if r.peaje_acreditable is distinct from c_peaje then
    raise exception '0703: p_peaje=% aterrizó en peaje_acreditable=%', c_peaje, r.peaje_acreditable;
  end if;
  if r.litros_diesel_acreditables is distinct from c_litros then
    raise exception '0703: p_litros_diesel=% aterrizó en litros_diesel_acreditables=%', c_litros, r.litros_diesel_acreditables;
  end if;
  if r.total_comprobado is distinct from c_comprobado then
    raise exception '0703: p_total_comprobado=% aterrizó en total_comprobado=%', c_comprobado, r.total_comprobado;
  end if;
  if r.total_anticipo is distinct from c_anticipo then
    raise exception '0703: p_total_anticipo=% aterrizó en total_anticipo=%', c_anticipo, r.total_anticipo;
  end if;
  if r.diferencia is distinct from c_diferencia then
    raise exception '0703: p_diferencia=% aterrizó en diferencia=%', c_diferencia, r.diferencia;
  end if;
  if r.estatus is distinct from 'cuadrada' then
    raise exception '0703: p_estatus aterrizó en estatus=%', r.estatus;
  end if;
  if r.pdf_url is distinct from 'https://ejemplo.invalid/0703.pdf' then
    raise exception '0703: p_pdf_url aterrizó en pdf_url=%', r.pdf_url;
  end if;

  raise notice '0703 OK (insert): ieps=% iva=% peaje=% litros=% comprobado=% anticipo=% diferencia=%',
    r.ieps_acreditable, r.iva_acreditable, r.peaje_acreditable,
    r.litros_diesel_acreditables, r.total_comprobado, r.total_anticipo, r.diferencia;
end $$;

-- El MISMO contrato por la rama `on conflict (viaje_id) do update`. Es una
-- lista de asignaciones aparte dentro de la misma función, así que un cruce
-- puede vivir ahí y no en el insert: un recierre del mismo viaje es el camino
-- real (el contralor corrige un comprobante y vuelve a cerrar).
do $$
declare
  c_ieps   numeric := 2611.08;
  c_iva    numeric :=  904.63;
  c_peaje  numeric :=  417.52;
  c_litros numeric :=  601.19;
  v_id uuid;
  r record;
begin
  v_id := public.guardar_liquidacion_tx(
    '00000000-0703-4000-8000-000000000001'::uuid,
    '00000000-0703-4000-8000-00000000000a'::uuid,
    9311.11, 9422.22, 111.11,
    'cuadrada', '[]'::jsonb,
    c_ieps, c_iva, c_peaje,
    null,
    c_litros
  );

  select ieps_acreditable, iva_acreditable, peaje_acreditable,
         litros_diesel_acreditables, pdf_url
    into r
    from liquidacion
   where id = v_id and tenant_id = '00000000-0703-4000-8000-000000000001';

  if r.ieps_acreditable is distinct from c_ieps then
    raise exception '0703 (update): p_ieps=% aterrizó en ieps_acreditable=%', c_ieps, r.ieps_acreditable;
  end if;
  if r.iva_acreditable is distinct from c_iva then
    raise exception '0703 (update): p_iva=% aterrizó en iva_acreditable=%', c_iva, r.iva_acreditable;
  end if;
  if r.peaje_acreditable is distinct from c_peaje then
    raise exception '0703 (update): p_peaje=% aterrizó en peaje_acreditable=%', c_peaje, r.peaje_acreditable;
  end if;
  if r.litros_diesel_acreditables is distinct from c_litros then
    raise exception '0703 (update): p_litros_diesel=% aterrizó en litros_diesel_acreditables=%', c_litros, r.litros_diesel_acreditables;
  end if;
  -- `pdf_url = coalesce(excluded.pdf_url, liquidacion.pdf_url)`: un recierre
  -- sin PDF nuevo NO borra el anterior. Va aquí porque es la otra forma de
  -- que la rama de update quede mal sin que ningún total se mueva.
  if r.pdf_url is distinct from 'https://ejemplo.invalid/0703.pdf' then
    raise exception '0703 (update): el recierre sin pdf_url borró el anterior (pdf_url=%)', r.pdf_url;
  end if;

  raise notice '0703 OK (update): ieps=% iva=% peaje=% litros=% pdf conservado',
    r.ieps_acreditable, r.iva_acreditable, r.peaje_acreditable, r.litros_diesel_acreditables;
end $$;

rollback;
