\set ON_ERROR_STOP on
-- AUDITORÍA 32, continuación 5 (26-sep). FIS-C4 / ARQ32C4-C2 (CRÍTICO), la
-- mitad que la continuación 4 dejó PARCIAL: el asiento contable.
--
-- LO QUE ESTE ARCHIVO FIJA, y es lo único que el SQL puede fijar: que la RPC
-- que alimenta `/api/export/poliza` ENTREGUE el emisor, y que lo entregue con
-- la forma que `copiasDeComprobante` necesita. La decisión de qué es copia vive
-- en TS (engine.ts:514); acá se prueba el borde por donde entran las filas, que
-- es exactamente donde estaba la grieta: la función no cambió de comportamiento,
-- cambió el conjunto de columnas que su llamador podía verle.
--
-- ROJO ANTES DE LA 0361, medido contra Postgres 16.13 con 337 migraciones sobre
-- base virgen: `gasto[0] ? 'rfcEmisor'` devuelve `f` — la clave no existe, así
-- que ni seleccionando bien en TypeScript se arreglaba.
--
-- EL CASO 3 ES EL QUE JUSTIFICA `nullif`. Un `rfc_emisor = ''` que saliera como
-- cadena vacía sería un emisor CONOCIDO para `g.rfcEmisor ?? undefined` en TS:
-- la fila dejaría de heredar el emisor del grupo y dos fotos del MISMO ticket
-- —una con RFC leído y otra con la cadena vacía— volverían a sumar doble. Es la
-- misma trampa que hizo que la 0358 tuviera que corregir a la 0357.
begin;
do $probe$
declare
 t uuid; otro uuid; op uuid; v uuid; l uuid; datos jsonb; g jsonb;
 por_id jsonb := '{}'::jsonb;
 fila jsonb;
begin
 insert into public.tenant(nombre) values ('SINTETICO POLIZA361') returning id into t;
 insert into public.tenant(nombre) values ('SINTETICO POLIZA361 AISLADO') returning id into otro;
 insert into public.operador(tenant_id,nombre,telefono) values (t,'Operador sintético 361','529999903610') returning id into op;
 insert into public.viaje(tenant_id,operador_id,folio,anticipo) values (t,op,'P361',10000) returning id into v;

 -- CASO 1 y 2 — DOS ESTACIONES DISTINTAS, mismo folio y mismo importe. Son dos
 -- comprobantes reales y la verdad son $5,000 (lo que la 0360 ya persiste).
 insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,sub_total,iva_traslado,ieps_traslado,fecha,folio,folio_norm,rfc_emisor,forma_pago) values
  ('36100000-0000-4000-8000-000000000001',t,v,'diesel',2500,2155.17,344.83,0,current_date,'1234','1234','ESA030303CC1','01'),
  ('36100000-0000-4000-8000-000000000002',t,v,'diesel',2500,2155.17,344.83,0,current_date,'1234','1234','ESB040404DD2','01'),
 -- CASO 3 — emisor CADENA VACÍA. Debe salir JSON null, no ''.
  ('36100000-0000-4000-8000-000000000003',t,v,'caseta',180,155.17,24.83,0,current_date,'7777','7777','','01'),
 -- CASO 4 — emisor NULL (el OCR no lo leyó). Debe salir JSON null.
  ('36100000-0000-4000-8000-000000000004',t,v,'caseta',180,155.17,24.83,0,current_date,'8888','8888',null,'01');

 l := public.guardar_liquidacion_tx(t,v,5360,10000,4640,'con_diferencias','[]',0,1059.32,0,null,0);
 datos := public.poliza_datos_tenant(t,current_date-1,current_date+1);
 if jsonb_array_length(datos) <> 1 then raise exception '0361: se esperaba una liquidación, llegaron %', jsonb_array_length(datos); end if;
 fila := datos->0;

 if (fila->>'version')::integer is distinct from 361 then
   raise exception '0361: la RPC no declara la versión 361 (llegó %)', fila->>'version';
 end if;
 if jsonb_array_length(fila->'gastos') <> 4 then
   raise exception '0361: se esperaban 4 comprobantes, llegaron %', jsonb_array_length(fila->'gastos');
 end if;

 for g in select value from jsonb_array_elements(fila->'gastos') loop
   if not (g ? 'rfcEmisor') then
     raise exception '0361: el comprobante % no trae la clave rfcEmisor — es el ROJO de FIS-C4', g->>'id';
   end if;
   por_id := por_id || jsonb_build_object(g->>'id', g->'rfcEmisor');
 end loop;

 if por_id->>'36100000-0000-4000-8000-000000000001' is distinct from 'ESA030303CC1' then
   raise exception '0361: se perdió el emisor de la estación A: %', por_id->'36100000-0000-4000-8000-000000000001';
 end if;
 if por_id->>'36100000-0000-4000-8000-000000000002' is distinct from 'ESB040404DD2' then
   raise exception '0361: se perdió el emisor de la estación B: %', por_id->'36100000-0000-4000-8000-000000000002';
 end if;
 -- Los dos casos sin emisor CONOCIDO tienen que verse igual entre sí y ser null.
 if (por_id->'36100000-0000-4000-8000-000000000003') <> 'null'::jsonb then
   raise exception '0361: un rfc_emisor VACÍO salió como emisor conocido (%) — en TS sería un emisor y rompería la herencia de grupo de la 0358', por_id->'36100000-0000-4000-8000-000000000003';
 end if;
 if (por_id->'36100000-0000-4000-8000-000000000004') <> 'null'::jsonb then
   raise exception '0361: un rfc_emisor NULL no salió como null: %', por_id->'36100000-0000-4000-8000-000000000004';
 end if;

 -- El cierre y el asiento tienen que estar leyendo la MISMA verdad.
 if (select total_comprobado from public.liquidacion where id = l) <> 5360 then
   raise exception '0361: el cierre dejó de contar los cuatro comprobantes: %', (select total_comprobado from public.liquidacion where id = l);
 end if;

 if public.poliza_datos_tenant(otro, current_date-1, current_date+1) <> '[]'::jsonb then
   raise exception '0361: fuga entre tenants';
 end if;
end
$probe$;
-- Permisos y características: no se mueven. Mismo bloque que la 0342, más
-- `prosecdef` explícito (la 0361 declara SECURITY INVOKER, que es el default).
do $permisos$
begin
 if has_function_privilege('anon','public.poliza_datos_tenant(uuid,date,date)','execute') or
    has_function_privilege('authenticated','public.poliza_datos_tenant(uuid,date,date)','execute') or
    not has_function_privilege('service_role','public.poliza_datos_tenant(uuid,date,date)','execute') then
   raise exception '0361: deriva de ACL';
 end if;
 if not exists(select 1 from pg_proc where oid='public.poliza_datos_tenant(uuid,date,date)'::regprocedure
   and not prosecdef and provolatile='s' and proparallel='s' and 'search_path=public, pg_catalog'=any(proconfig)) then
   raise exception '0361: deriva de seguridad/volatilidad';
 end if;
end
$permisos$;
rollback;
\echo '0361_poliza_dedup_emisor: PASS'
