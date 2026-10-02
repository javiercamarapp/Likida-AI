-- ═══════════════════════════════════════════════════════════════════════════
-- 0362 · El desempate del panel fiscal es EL MISMO que el de las otras tres
--        implementaciones del dedup: `created_at, id`, no `id` a secas.
--
-- AUDITORÍA 32 (continuación 6), DAT-32C6-A2 (ALTO).
--
-- Cuando dos filas son copias del MISMO comprobante, las cuatro
-- implementaciones se quedan con una — y hasta la 0361 no coincidían en CUÁL:
--
--   cierre      0360:161  order by created_at, id      → la primera en llegar
--   póliza      0361:122  order by gg.created_at, gg.id → la primera en llegar
--   motor TS    engine.ts `copiasDeComprobante`        → la primera de la lista
--   panel       0359:167  order by bc.id               → min(uuid) ← LA RAREZA
--
-- Un uuid v4 no tiene nada que ver con el orden de llegada, así que el panel
-- se quedaba con una fila AL AZAR de entre las copias. El total no se movía
-- —`monto` está en la partición, y por eso los arneses de la 0358/0359/0360 no
-- lo veían—, pero sí se movía todo lo que NO está en la partición:
-- `sub_total`, `iva_traslado`, `ieps_traslado`, `estado_sat`, `rfc_receptor`.
--
-- EL CASO REAL: el chofer manda la foto buena y luego una borrosa del MISMO
-- ticket. La buena trae el desglose fiscal; la borrosa no. El PDF y el asiento
-- del contador se quedan con la buena; el panel se quedaba con la que tocara.
--
-- Este arnés es determinista a propósito: los uuid están elegidos para que el
-- desempate viejo y el nuevo elijan filas DISTINTAS. La buena llega ANTES
-- (created_at 10:00) y tiene el uuid MAYOR; la borrosa llega después y tiene el
-- uuid MENOR. Con `order by id` gana la borrosa; con `order by created_at, id`
-- gana la buena. Si alguna vez el arnés pasara con las dos reglas, dejaría de
-- probar algo: por eso no se deja al azar de `gen_random_uuid()`.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
insert into public.tenant(id,nombre) values
 ('36200000-0000-4000-8000-000000000001','Desempate362');
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('36200000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000001','Operador sintético 362','529999903621');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus) values
 ('36200000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000001','A362-1','liquidado');

-- LA BUENA: llega a las 10:00, trae el desglose, y su uuid es el MAYOR.
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,sub_total,iva_traslado,created_at) values
 ('ffff0362-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000001',
  'diesel',2500,'2026-04-01','777','777','ESA030303CC1','01',2155.17,344.83,'2026-04-01 10:00:00+00');

-- LA BORROSA: la misma foto una hora después, SIN desglose, uuid MENOR.
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,sub_total,iva_traslado,created_at) values
 ('00000362-0000-4000-8000-000000000002','36200000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000001',
  'diesel',2500,'2026-04-01','777','777','ESA030303CC1','01',null,null,'2026-04-01 11:00:00+00');

set local role service_role;
do $$
declare
  j            jsonb;
  celda        jsonb;
  n_celda      int;
  monto_celda  numeric;
  sub_celda    numeric;
  iva_celda    numeric;
  nulos_celda  int;
  muestra      text;
begin
  j := public.gastos_fiscales_agregados_tenant(
         '36200000-0000-4000-8000-000000000001','2026-01-01','2026-12-31',
         2000, 0, array['comida'], null, array['15101505'],
         '2026-01-01','2026-01-01', 0.5, 'bar', '2026-09-27');

  select x into celda
    from jsonb_array_elements(j) x
   where x->>'concepto' = 'diesel';

  if celda is null then
    raise exception 'DAT-32C6-A2: el panel no devolvió celda de diesel';
  end if;

  n_celda     := (celda->>'n')::int;
  monto_celda := (celda->>'monto')::numeric;
  sub_celda   := (celda->>'subTotal')::numeric;
  iva_celda   := (celda->>'iva')::numeric;
  nulos_celda := (celda->>'subTotalNulos')::int;
  muestra     := celda->>'muestraId';

  -- (a) El dedup sigue funcionando: dos fotos del mismo ticket, UNA celda.
  if n_celda <> 1 or monto_celda <> 2500 then
    raise exception 'DAT-32C6-A2: el dedup del panel dejó de contar copias: n=% monto=% (esperado 1 / 2500)',
      n_celda, monto_celda;
  end if;

  -- (b) LO NUEVO: la fila que sobrevive es la que trae el desglose, que es la
  --     misma que conservan el cierre (0360), la póliza (0361) y el motor TS.
  if muestra <> 'ffff0362-0000-4000-8000-000000000001' then
    raise exception 'DAT-32C6-A2: el panel conserva una fila distinta de la que conservan el cierre, la póliza y el motor: muestraId=% (esperado ffff0362-0000-4000-8000-000000000001, la primera en llegar)',
      muestra;
  end if;

  if sub_celda <> 2155.17 or iva_celda <> 344.83 or nulos_celda <> 0 then
    raise exception 'DAT-32C6-A2: el panel publica el desglose de la foto borrosa: subTotal=% iva=% subTotalNulos=% (esperado 2155.17 / 344.83 / 0)',
      sub_celda, iva_celda, nulos_celda;
  end if;
end $$;
reset role;

rollback;
