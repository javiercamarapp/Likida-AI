\set ON_ERROR_STOP on
-- 0858 — la liga de un CFDI del SAT copia los campos fiscales del XML
-- (auditoría 35, R04-fiscal-01). Lo que SOLO la base puede demostrar:
--   (a) la liga copia sub_total, IVA, retenciones, RFC receptor, forma de pago…
--       con redondeo a centavos (cifras SINTÉTICAS);
--   (b) un campo que el XML no trae queda NULL — nunca se inventa;
--   (c) un XML que no pasa las guardas LIGA igual que la 0263 pero no copia;
--   (d) idempotencia: ligar dos veces no pisa nada;
--   (e) aislamiento por tenant;
--   (f) la versión manual atómica (expediente, CU014/CU015) y la vieja
--       `sat_cfdi_ligar_tx` intacta;
--   (g) permisos: solo service_role;
--   (h) la REVERSA documentada en la cabecera de la 0858.
-- Todo dentro de una transacción que termina en rollback.
begin;

create function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin
  if c is not true then raise exception '0858: %', m; end if;
end $$;

-- Dos flotas sintéticas, cada una con un viaje.
create temp table _w (t1 uuid, t2 uuid, v1 uuid, v2 uuid, a1 uuid);
do $$
declare
  t1 uuid; t2 uuid; o1 uuid; o2 uuid; v1 uuid; v2 uuid; a1 uuid;
begin
  insert into tenant (nombre) values ('ZZZ 0858 FLOTA A') returning id into t1;
  insert into tenant (nombre) values ('ZZZ 0858 FLOTA B') returning id into t2;
  insert into operador (tenant_id, nombre, telefono) values (t1, 'P', '520000085801') returning id into o1;
  insert into operador (tenant_id, nombre, telefono) values (t2, 'P', '520000085802') returning id into o2;
  insert into viaje (tenant_id, operador_id) values (t1, o1) returning id into v1;
  insert into viaje (tenant_id, operador_id) values (t2, o2) returning id into v2;
  insert into app_user (id, email, rol, tenant_id) values (gen_random_uuid(), '__0858__@likida.ai', 'contador', t1) returning id into a1;
  insert into _w values (t1, t2, v1, v2, a1);
end $$;

-- ── (a) cifras reales sintéticas, con centavos y medios centavos ───────────
do $$
declare
  w _w; g1 uuid; g2 uuid; r jsonb; x gasto%rowtype;
  f1 text := lower(gen_random_uuid()::text);
  f2 text := lower(gen_random_uuid()::text);
begin
  select * into w from _w;

  -- Caseta de $1,160.00 sin CFDI: subtotal 1,000.00 + IVA 160.00.
  insert into gasto (tenant_id, viaje_id, concepto, monto) values (w.t1, w.v1, 'caseta', 1160.00) returning id into g1;
  r := public.gasto_ligar_cfdi_campos(w.t1, g1, upper(f1), jsonb_build_object(
    'uuid', f1, 'tipo_comprobante', 'I', 'total', 1160.00, 'sub_total', 1000.00,
    'iva_traslado', 160.00, 'ieps_traslado', 0, 'iva_retenido', 0, 'isr_retenido', 0,
    'rfc_emisor', 'AAA010101AAA', 'rfc_receptor', 'BBB020202BBB', 'forma_pago', '03', 'metodo_pago', 'PUE',
    'clave_prod_serv', '78101800', 'clave_unidad', 'E48', 'moneda', 'MXN',
    'fecha', '2026-10-01T10:15:00', 'complemento_hidrocarburos', false, 'esquema_alterno', false));
  perform pg_temp.ok((r->>'ligado')::boolean and (r->>'campos_copiados')::boolean, 'a1: debía ligar y copiar: ' || r::text);
  select * into x from gasto where id = g1;
  perform pg_temp.ok(x.cfdi_uuid = f1 and x.cfdi_orden = 1 and x.xml_verificado, 'a1: liga (folio en minúsculas, orden 1, verificado)');
  perform pg_temp.ok(x.monto = 1160.00 and x.sub_total = 1000.00 and x.iva_traslado = 160.00, 'a1: monto/subtotal/IVA');
  perform pg_temp.ok(x.ieps_traslado = 0 and x.iva_retenido = 0 and x.isr_retenido = 0, 'a1: ceros declarados por el XML se conservan como 0');
  perform pg_temp.ok(x.rfc_receptor = 'BBB020202BBB' and x.rfc_emisor = 'AAA010101AAA', 'a1: RFC receptor y emisor');
  perform pg_temp.ok(x.forma_pago = '03' and x.metodo_pago = 'PUE' and x.clave_prod_serv = '78101800' and x.clave_unidad = 'E48' and x.tipo_comprobante = 'I', 'a1: forma/método/claves/tipo');
  perform pg_temp.ok(x.fecha = date '2026-10-01', 'a1: la fecha del XML llena el hueco de un gasto sin fecha');
  perform pg_temp.ok(x.ocr_extra ->> 'moneda' = 'MXN', 'a1: moneda en ocr_extra');
  perform pg_temp.ok(x.complemento_hidrocarburos is false and x.cfdi_esquema_alterno is false, 'a1: booleanos');

  -- Centavos y redondeo (medio centavo hacia afuera de cero): total 617.28,
  -- subtotal 532.14, IVA 85.1424 -> 85.14, descuento 0.285 -> 0.29,
  -- retención IVA 1.005 -> 1.01 (a 2 decimales, sin pasar por binario).
  -- Diésel con litros y USD (merge sobre un ocr_extra que ya existía).
  insert into gasto (tenant_id, viaje_id, concepto, monto, fecha, rfc_emisor, ocr_extra)
    values (w.t1, w.v1, 'diesel', 617.28, date '2026-09-30', 'aaa010101aaa', '{"producto":"diesel","litros":1}'::jsonb)
    returning id into g2;
  r := public.gasto_ligar_cfdi_campos(w.t1, g2, f2, jsonb_build_object(
    'uuid', f2, 'total', 617.28, 'sub_total', 532.14, 'iva_traslado', 85.1424, 'descuento', 0.285,
    'iva_retenido', 1.005, 'rfc_emisor', 'AAA010101AAA', 'clave_unidad', 'LTR', 'cantidad', 28.75,
    'moneda', 'USD', 'tipo_cambio', 17.5432, 'fecha', '2026-10-02'));
  perform pg_temp.ok((r->>'campos_copiados')::boolean, 'a2: debía copiar: ' || r::text);
  select * into x from gasto where id = g2;
  perform pg_temp.ok(x.sub_total = 532.14 and x.iva_traslado = 85.14, 'a2: IVA 85.1424 -> 85.14 (' || x.iva_traslado || ')');
  perform pg_temp.ok(x.descuento = 0.29 and x.iva_retenido = 1.01, 'a2: medios centavos hacia arriba (' || x.descuento || ', ' || x.iva_retenido || ')');
  perform pg_temp.ok(x.fecha = date '2026-09-30', 'a2: la fecha del ticket NO se mueve');
  perform pg_temp.ok(x.ocr_extra ->> 'producto' = 'diesel' and (x.ocr_extra ->> 'litros')::numeric = 28.75
                     and x.ocr_extra ->> 'moneda' = 'USD' and (x.ocr_extra ->> 'tipoCambio')::numeric = 17.5432,
                     'a2: ocr_extra mergeado (producto conservado, litros/moneda/tipoCambio del XML): ' || x.ocr_extra::text);
  perform pg_temp.ok(x.rfc_emisor = 'aaa010101aaa', 'a2: un RFC emisor que el ticket ya traía no se pisa');
  perform pg_temp.ok(x.rfc_receptor is null and x.forma_pago is null, 'a2: lo que el XML no trae queda NULL');
end $$;

-- ── (b) XML sin campos opcionales: NULL, nada inventado ────────────────────
do $$
declare
  w _w; g uuid; r jsonb; x gasto%rowtype; f text := lower(gen_random_uuid()::text);
begin
  select * into w from _w;
  insert into gasto (tenant_id, viaje_id, concepto, monto) values (w.t1, w.v1, 'factura', 232.00) returning id into g;
  r := public.gasto_ligar_cfdi_campos(w.t1, g, f, jsonb_build_object(
    'uuid', f, 'total', 232.00, 'sub_total', 200.00));
  perform pg_temp.ok((r->>'campos_copiados')::boolean, 'b: con total y subtotal basta para copiar');
  select * into x from gasto where id = g;
  perform pg_temp.ok(x.sub_total = 200.00, 'b: subtotal');
  perform pg_temp.ok(x.iva_traslado is null and x.ieps_traslado is null and x.iva_retenido is null
                     and x.isr_retenido is null and x.descuento is null, 'b: impuestos que el XML no declara = NULL, no 0 ni 16%');
  perform pg_temp.ok(x.rfc_receptor is null and x.forma_pago is null and x.metodo_pago is null
                     and x.clave_prod_serv is null and x.clave_unidad is null and x.tipo_comprobante is null, 'b: textos ausentes = NULL');
  perform pg_temp.ok(x.complemento_hidrocarburos is null and x.cfdi_esquema_alterno is null, 'b: booleanos ausentes = NULL');
  perform pg_temp.ok(x.ocr_extra is null and x.fecha is null, 'b: sin ocr_extra ni fecha inventados');

  -- Un valor negativo o de tipo equivocado tampoco se copia.
  insert into gasto (tenant_id, viaje_id, concepto, monto) values (w.t1, w.v1, 'factura', 100.00) returning id into g;
  f := lower(gen_random_uuid()::text);
  r := public.gasto_ligar_cfdi_campos(w.t1, g, f, jsonb_build_object(
    'uuid', f, 'total', 100.00, 'sub_total', 86.21, 'iva_traslado', -13.79, 'descuento', '5.00', 'rfc_receptor', '   '));
  select * into x from gasto where id = g;
  perform pg_temp.ok(x.iva_traslado is null and x.descuento is null and x.rfc_receptor is null, 'b: negativo / texto en campo numérico / RFC en blanco = NULL');
end $$;

-- ── (c) las guardas: se LIGA, no se copia, y se dice por qué ───────────────
do $$
declare
  w _w; g uuid; r jsonb; x gasto%rowtype; f text; m text; i int := 0;
  casos jsonb;
begin
  select * into w from _w;
  -- (monto del gasto, campos [con __f__ = folio], motivo esperado)
  casos := jsonb_build_array(
    jsonb_build_array(300, '{"uuid":"__f__","total":300,"sub_total":258.62,"iva_traslado":41.38,"tipo_comprobante":"E"}', 'nota_de_credito'),
    jsonb_build_array(300, '{"uuid":"otro","total":300,"sub_total":258.62}', 'folio_distinto'),
    jsonb_build_array(300, '{"uuid":"__f__","total":300.02,"sub_total":258.62}', 'total_no_coincide'),
    jsonb_build_array(300, '{"uuid":"__f__","total":0,"sub_total":258.62}', 'total_ilegible'),
    jsonb_build_array(300, '{"uuid":"__f__","total":300,"iva_traslado":41.38}', 'sin_subtotal'),
    jsonb_build_array(300, '{"uuid":"__f__","total":300,"sub_total":-1}', 'sin_subtotal'),
    jsonb_build_array(300, '{"uuid":"__f__","total":300,"sub_total":258.62,"rfc_emisor":"CCC030303CCC"}', 'emisor_distinto')
  );
  for i in 0 .. jsonb_array_length(casos) - 1 loop
    f := lower(gen_random_uuid()::text);
    insert into gasto (tenant_id, viaje_id, concepto, monto, rfc_emisor)
      values (w.t1, w.v1, 'caseta', (casos->i->>0)::numeric, 'AAA010101AAA') returning id into g;
    r := public.gasto_ligar_cfdi_campos(w.t1, g, f, replace(casos->i->>1, '__f__', f)::jsonb);
    m := casos->i->>2;
    perform pg_temp.ok((r->>'ligado')::boolean and not (r->>'campos_copiados')::boolean and r->>'motivo' = m,
      format('c%s: esperaba ligar sin copiar con motivo %s, dio %s', i, m, r::text));
    select * into x from gasto where id = g;
    perform pg_temp.ok(x.cfdi_uuid = f and x.xml_verificado, format('c%s: igual se liga (como la 0263)', i));
    perform pg_temp.ok(x.sub_total is null and x.iva_traslado is null and x.rfc_receptor is null and x.monto = (casos->i->>0)::numeric,
      format('c%s: ningún campo fiscal se tocó', i));
  end loop;

  -- Sin XML (p_campos nulo): liga igual que la 0263.
  f := lower(gen_random_uuid()::text);
  insert into gasto (tenant_id, viaje_id, concepto, monto) values (w.t1, w.v1, 'caseta', 50) returning id into g;
  r := public.gasto_ligar_cfdi_campos(w.t1, g, f, null);
  perform pg_temp.ok((r->>'ligado')::boolean and r->>'motivo' = 'sin_xml' and not (r->>'campos_copiados')::boolean, 'c: sin XML liga sin campos: ' || r::text);
  select * into x from gasto where id = g;
  perform pg_temp.ok(x.cfdi_uuid = f and x.sub_total is null, 'c: sin XML, folio puesto y subtotal NULL');
end $$;

-- ── (d) idempotencia y (e) aislamiento entre flotas ────────────────────────
do $$
declare
  w _w; g uuid; r jsonb; x gasto%rowtype; f text := lower(gen_random_uuid()::text); f2 text := lower(gen_random_uuid()::text);
begin
  select * into w from _w;
  insert into gasto (tenant_id, viaje_id, concepto, monto) values (w.t1, w.v1, 'caseta', 580.00) returning id into g;

  -- (e) la OTRA flota no puede ligar ni copiar nada en este gasto.
  r := public.gasto_ligar_cfdi_campos(w.t2, g, f, jsonb_build_object('uuid', f, 'total', 580, 'sub_total', 500, 'iva_traslado', 80));
  perform pg_temp.ok(not (r->>'ligado')::boolean, 'e: otra flota no liga: ' || r::text);
  select * into x from gasto where id = g;
  perform pg_temp.ok(x.cfdi_uuid is null and x.sub_total is null and x.xml_verificado is null, 'e: el gasto de la flota A quedó intacto');

  -- (d) primera vez copia; segunda vez (otro folio, otros números) no pisa.
  r := public.gasto_ligar_cfdi_campos(w.t1, g, f, jsonb_build_object('uuid', f, 'total', 580, 'sub_total', 500, 'iva_traslado', 80));
  perform pg_temp.ok((r->>'campos_copiados')::boolean, 'd: primera vez copia');
  r := public.gasto_ligar_cfdi_campos(w.t1, g, f2, jsonb_build_object('uuid', f2, 'total', 580, 'sub_total', 400, 'iva_traslado', 64));
  perform pg_temp.ok(not (r->>'ligado')::boolean and r->>'motivo' = 'gasto_no_disponible', 'd: segunda vez no liga: ' || r::text);
  r := public.gasto_ligar_cfdi_campos(w.t1, g, f, jsonb_build_object('uuid', f, 'total', 580, 'sub_total', 500, 'iva_traslado', 80));
  perform pg_temp.ok(not (r->>'ligado')::boolean, 'd: ni siquiera con el mismo folio (el gasto ya tiene comprobante)');
  select * into x from gasto where id = g;
  perform pg_temp.ok(x.cfdi_uuid = f and x.sub_total = 500.00 and x.iva_traslado = 80.00, 'd: los valores de la primera liga no se pisaron');
end $$;

-- ── (f) la versión manual atómica ──────────────────────────────────────────
do $$
declare
  w _w; g uuid; g0 uuid; c uuid; c0 uuid; r jsonb; x gasto%rowtype; f text := lower(gen_random_uuid()::text);
  f0 text := lower(gen_random_uuid()::text); sqlst text := '';
begin
  select * into w from _w;
  insert into gasto (tenant_id, viaje_id, concepto, monto) values (w.t1, w.v1, 'caseta', 1160.00) returning id into g;
  insert into sat_cfdi_descargado (tenant_id, cfdi_uuid, estatus, total) values (w.t1, f, 'disponible', 1160.00) returning id into c;

  r := public.sat_cfdi_ligar_campos_tx(w.t1, c, g, 'disponible', '{}'::jsonb, w.a1, 'contralor@0858.test',
         jsonb_build_object('uuid', f, 'total', 1160.00, 'sub_total', 1000.00, 'iva_traslado', 160.00, 'rfc_receptor', 'BBB020202BBB'));
  perform pg_temp.ok((r->>'campos_copiados')::boolean and (r->>'gasto_id') = g::text and (r->>'cfdi_uuid') = f, 'f1: retorno: ' || r::text);
  select * into x from gasto where id = g;
  perform pg_temp.ok(x.sub_total = 1000.00 and x.iva_traslado = 160.00 and x.rfc_receptor = 'BBB020202BBB' and x.xml_verificado, 'f1: campos copiados en la liga manual');
  perform pg_temp.ok((select estatus = 'casado' and gasto_id = g from sat_cfdi_descargado where id = c), 'f1: comprobante casado');
  perform pg_temp.ok((select count(*) = 1 from sat_cfdi_resolucion where cfdi_id = c and acto = 'ligado' and gasto_id = g), 'f1: expediente escrito');

  -- Ancla optimista: el comprobante ya no está 'disponible' -> CU014.
  begin
    perform public.sat_cfdi_ligar_campos_tx(w.t1, c, g, 'disponible', '{}'::jsonb, w.a1, 'x@0858.test', null);
  exception when others then sqlst := sqlstate; end;
  perform pg_temp.ok(sqlst = 'CU014', 'f2: segunda llamada debía rebotar CU014, dio ' || sqlst);

  -- Gasto ya con comprobante -> CU015, y nada se toca.
  sqlst := '';
  insert into sat_cfdi_descargado (tenant_id, cfdi_uuid, estatus, total) values (w.t1, f0, 'disponible', 1160.00) returning id into c0;
  begin
    perform public.sat_cfdi_ligar_campos_tx(w.t1, c0, g, 'disponible', '{}'::jsonb, w.a1, 'x@0858.test',
      jsonb_build_object('uuid', f0, 'total', 1160, 'sub_total', 1));
  exception when others then sqlst := sqlstate; end;
  perform pg_temp.ok(sqlst = 'CU015', 'f3: gasto ocupado debía rebotar CU015, dio ' || sqlst);
  perform pg_temp.ok((select estatus = 'disponible' from sat_cfdi_descargado where id = c0), 'f3: el comprobante rebotado sigue disponible');
  perform pg_temp.ok((select sub_total = 1000.00 from gasto where id = g), 'f3: el gasto no se pisó');

  -- Otra flota no puede ligar el gasto de la A (CU014 por el comprobante).
  sqlst := '';
  begin
    perform public.sat_cfdi_ligar_campos_tx(w.t2, c0, g, 'disponible', '{}'::jsonb, w.a1, 'x@0858.test', null);
  exception when others then sqlst := sqlstate; end;
  perform pg_temp.ok(sqlst in ('CU014', 'CU015'), 'f4: aislamiento entre flotas, dio ' || sqlst);

  -- p_campos nulo = la liga de la 0263 (sin campos) y la FUNCIÓN VIEJA sigue igual.
  insert into gasto (tenant_id, viaje_id, concepto, monto) values (w.t1, w.v1, 'caseta', 90) returning id into g0;
  r := public.sat_cfdi_ligar_campos_tx(w.t1, c0, g0, 'disponible', '{}'::jsonb, w.a1, 'x@0858.test', null);
  perform pg_temp.ok(not (r->>'campos_copiados')::boolean and r->>'motivo_campos' = 'sin_xml', 'f5: sin campos: ' || r::text);
  perform pg_temp.ok((select cfdi_uuid = f0 and sub_total is null from gasto where id = g0), 'f5: liga sin campos');

  insert into gasto (tenant_id, viaje_id, concepto, monto) values (w.t1, w.v1, 'caseta', 70) returning id into g0;
  insert into sat_cfdi_descargado (tenant_id, cfdi_uuid, estatus, total) values (w.t1, lower(gen_random_uuid()::text), 'disponible', 70) returning id into c0;
  r := public.sat_cfdi_ligar_tx(w.t1, c0, g0, 'disponible', '{}'::jsonb, w.a1, 'x@0858.test');
  perform pg_temp.ok((r->>'gasto_id') = g0::text and not (r ? 'campos_copiados'), 'f6: la función de la 0263 conserva su contrato');
  perform pg_temp.ok((select xml_verificado and sub_total is null from gasto where id = g0), 'f6: la 0263 sigue sin copiar (compatibilidad hacia atrás)');
end $$;

-- ── (g) permisos: solo service_role ────────────────────────────────────────
do $$
begin
  perform pg_temp.ok(not has_function_privilege('anon', 'public.gasto_ligar_cfdi_campos(uuid,uuid,text,jsonb)', 'EXECUTE'), 'g: anon no ejecuta gasto_ligar_cfdi_campos');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.gasto_ligar_cfdi_campos(uuid,uuid,text,jsonb)', 'EXECUTE'), 'g: authenticated no ejecuta gasto_ligar_cfdi_campos');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.gasto_ligar_cfdi_campos(uuid,uuid,text,jsonb)', 'EXECUTE'), 'g: service_role sí');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.sat_cfdi_ligar_campos_tx(uuid,uuid,uuid,text,jsonb,uuid,text,jsonb)', 'EXECUTE'), 'g: anon no ejecuta sat_cfdi_ligar_campos_tx');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.sat_cfdi_ligar_campos_tx(uuid,uuid,uuid,text,jsonb,uuid,text,jsonb)', 'EXECUTE'), 'g: authenticated no ejecuta sat_cfdi_ligar_campos_tx');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.sat_cfdi_ligar_campos_tx(uuid,uuid,uuid,text,jsonb,uuid,text,jsonb)', 'EXECUTE'), 'g: service_role sí (tx)');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.sat_cfdi_ligar_tx(uuid,uuid,uuid,text,jsonb,uuid,text)', 'EXECUTE'), 'g: la 0263 conserva sus permisos');
end $$;

-- ── (h) LA REVERSA de la cabecera de la 0858 ───────────────────────────────
drop function if exists public.sat_cfdi_ligar_campos_tx(uuid, uuid, uuid, text, jsonb, uuid, text, jsonb);
drop function if exists public.gasto_ligar_cfdi_campos(uuid, uuid, text, jsonb);
do $$
begin
  perform pg_temp.ok(to_regprocedure('public.sat_cfdi_ligar_campos_tx(uuid,uuid,uuid,text,jsonb,uuid,text,jsonb)') is null, 'h: la reversa quita la función manual nueva');
  perform pg_temp.ok(to_regprocedure('public.gasto_ligar_cfdi_campos(uuid,uuid,text,jsonb)') is null, 'h: la reversa quita la función de liga nueva');
  perform pg_temp.ok(to_regprocedure('public.sat_cfdi_ligar_tx(uuid,uuid,uuid,text,jsonb,uuid,text)') is not null, 'h: sat_cfdi_ligar_tx de la 0263 sigue en pie');
end $$;

rollback;
