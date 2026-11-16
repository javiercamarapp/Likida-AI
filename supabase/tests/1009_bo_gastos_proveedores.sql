\set ON_ERROR_STOP on
-- 1009 (Back-office, LOTE C) — gastos y proveedores: checks, anti-duplicado, conciliación coherente, hecho de una sola escritura, anulación y grants.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

do $$
declare
  p1 constant uuid := '99100000-0000-4000-8000-0000000000a1';
  g1 constant uuid := '99100000-0000-4000-8000-0000000000b1';
  err text; n int;
begin
  -- 1. Proveedor: el nombre es único sin importar mayúsculas; el RFC mide 12 o 13.
  insert into public.bo_proveedor (id, nombre, categoria) values (p1, 'Vercel', 'infraestructura');
  begin insert into public.bo_proveedor (nombre) values ('  vercel '); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(1): el nombre repetido debia fallar'; end if; end;
  begin insert into public.bo_proveedor (nombre, rfc) values ('Otro', 'ABC123'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(1): un RFC de 6 caracteres debia fallar'; end if; end;

  -- 2. Un gasto en USD sin tipo de cambio no entra; con tipo de cambio sí.
  begin
    insert into public.bo_gasto (proveedor_id, fecha, periodo, concepto, moneda, monto_original, total_mxn)
    values (p1, '2026-11-03', '2026-11-01', 'Pro', 'USD', 20, 400); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(2): USD sin tipo de cambio debia fallar'; end if; end;
  insert into public.bo_gasto (id, proveedor_id, fecha, periodo, concepto, moneda, monto_original, tipo_cambio, total_mxn)
  values (g1, p1, '2026-11-03', '2026-11-01', 'Pro', 'USD', 20, 20.5, 410);

  -- 3. El periodo es el mes de la fecha; el CFDI y su UUID van juntos; el UUID no se repite.
  begin
    insert into public.bo_gasto (proveedor_id, fecha, periodo, concepto, monto_original, total_mxn)
    values (p1, '2026-11-03', '2026-10-01', 'Mal periodo', 10, 10); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(3): un periodo distinto al mes de la fecha debia fallar'; end if; end;
  begin
    insert into public.bo_gasto (proveedor_id, fecha, periodo, concepto, monto_original, total_mxn, comprobante_estado)
    values (p1, '2026-11-04', '2026-11-01', 'CFDI sin uuid', 10, 10, 'cfdi'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(3): comprobante cfdi sin UUID debia fallar'; end if; end;
  insert into public.bo_gasto (proveedor_id, fecha, periodo, concepto, monto_original, total_mxn, comprobante_estado, cfdi_uuid)
  values (p1, '2026-11-05', '2026-11-01', 'Con CFDI', 100, 100, 'cfdi', 'AAAAAAAA-0000-4000-8000-000000000001');
  begin
    insert into public.bo_gasto (proveedor_id, fecha, periodo, concepto, monto_original, total_mxn, comprobante_estado, cfdi_uuid)
    values (p1, '2026-11-06', '2026-11-01', 'Otro con mismo CFDI', 55, 55, 'cfdi', 'aaaaaaaa-0000-4000-8000-000000000001'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(3): el UUID de CFDI repetido debia fallar'; end if; end;

  -- 4. La llave compuesta (proveedor, fecha, total, concepto) no se repite entre gastos vivos.
  begin
    insert into public.bo_gasto (proveedor_id, fecha, periodo, concepto, monto_original, total_mxn)
    values (p1, '2026-11-05', '2026-11-01', ' con cfdi ', 100, 100); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(4): la llave compuesta repetida debia fallar'; end if; end;

  -- 5. La clave de idempotencia es única.
  insert into public.bo_gasto (proveedor_id, fecha, periodo, concepto, monto_original, total_mxn, clave_idem)
  values (p1, '2026-11-07', '2026-11-01', 'Idem', 7, 7, 'clave-idem-0001');
  begin
    insert into public.bo_gasto (proveedor_id, fecha, periodo, concepto, monto_original, total_mxn, clave_idem)
    values (p1, '2026-11-08', '2026-11-01', 'Idem 2', 8, 8, 'clave-idem-0001'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(5): la clave idem repetida debia fallar'; end if; end;

  -- 6. Conciliar exige referencia de banco y se hace una sola vez; el resto del hecho no se edita; nunca DELETE.
  begin update public.bo_gasto set conciliado_en = now() where id = g1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(6): conciliar sin referencia debia fallar'; end if; end;
  begin update public.bo_gasto set referencia_banco = 'SPEI 99887766' where id = g1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(6): una referencia sin conciliado_en debia fallar'; end if; end;
  begin update public.bo_gasto set total_mxn = 1 where id = g1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(6): editar el total debia fallar'; end if; end;
  begin delete from public.bo_gasto where id = g1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(6): borrar un gasto debia fallar'; end if; end;

  -- 7. Anular exige motivo; una vez anulado libera la llave y no se anula de nuevo.
  begin update public.bo_gasto set anulado_en = now() where id = g1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(7): anular sin motivo debia fallar'; end if; end;
  insert into public.app_user (id, email, nombre, rol) values ('99100000-0000-4000-8000-0000000000c1', 'bo1009@example.test', 'Prueba 1009', 'superadmin');
  update public.bo_gasto set anulado_en = now(), anulado_por = '99100000-0000-4000-8000-0000000000c1', motivo_anulacion = 'capturado dos veces' where id = g1;
  insert into public.bo_gasto (proveedor_id, fecha, periodo, concepto, moneda, monto_original, tipo_cambio, total_mxn)
  values (p1, '2026-11-03', '2026-11-01', 'Pro', 'USD', 20, 20.5, 410);
  select count(*) into n from public.bo_gasto where proveedor_id = p1 and concepto = 'Pro' and anulado_en is null;
  if n <> 1 then raise exception '1009(7): tras anular, la llave compuesta debia quedar libre (hay %)', n; end if;
  begin update public.bo_gasto set motivo_anulacion = 'otro motivo', anulado_en = now() where id = g1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(7): anular dos veces debia fallar'; end if; end;
end $$;

-- 8. Conciliacion valida: con quien y referencia.
do $$
declare g uuid; err text;
begin
  select id into g from public.bo_gasto where concepto = 'Idem';
  update public.bo_gasto set conciliado_en = now(), conciliado_por = '99100000-0000-4000-8000-0000000000c1', referencia_banco = 'SPEI 99887766' where id = g;
  begin update public.bo_gasto set conciliado_en = now() where id = g; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1009(8): conciliar dos veces debia fallar'; end if; end;
  update public.bo_gasto set deducible_en_forma = 'no_evaluable', cuenta_contable = 'Costos de nube' where id = g;
end $$;

-- 9. RLS y grants: nada para anon/authenticated; service_role sin DELETE.
do $$
declare t text;
begin
  foreach t in array array['bo_proveedor', 'bo_gasto'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '1009(9): % sin RLS', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception '1009(9): % legible por anon o authenticated', t;
    end if;
    if not has_table_privilege('service_role', 'public.' || t, 'insert') then raise exception '1009(9): service_role sin insert en %', t; end if;
  end loop;
  if has_table_privilege('service_role', 'public.bo_gasto', 'delete') then raise exception '1009(9): service_role no debia poder borrar gastos'; end if;
end $$;

rollback;
