\set ON_ERROR_STOP on
-- 1015 (Back-office, LOTE C) — tesorería: saldo = suma de movimientos, solo inserción, reversa enlazada con motivo, idempotencia y grants.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

do $$
declare
  c1 constant uuid := '99150000-0000-4000-8000-0000000000a1';
  c2 constant uuid := '99150000-0000-4000-8000-0000000000a2';
  m1 uuid; err text; s numeric; n int;
begin
  insert into public.bo_tesoreria_cuenta (id, nombre, tipo) values (c1, 'Banco principal 1015', 'banco'), (c2, 'Stripe 1015', 'stripe');
  begin insert into public.bo_tesoreria_cuenta (nombre, tipo) values ('  banco principal 1015', 'banco'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1015(1): el nombre repetido debia fallar'; end if; end;
  begin insert into public.bo_tesoreria_cuenta (nombre, tipo) values ('Mala', 'efectivo'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1015(1): un tipo inventado debia fallar'; end if; end;

  -- 2. El saldo es la suma; los signos se respetan.
  insert into public.bo_tesoreria_mov (cuenta_id, fecha, concepto, monto, clave_idem) values (c1, '2026-11-01', 'saldo_inicial', 1000, 'tes-1015-saldo-1');
  insert into public.bo_tesoreria_mov (cuenta_id, fecha, concepto, monto) values (c1, '2026-11-05', 'ingreso', 500);
  insert into public.bo_tesoreria_mov (cuenta_id, fecha, concepto, monto) values (c1, '2026-11-06', 'egreso', -200) returning id into m1;
  s := public.bo_tesoreria_saldo(c1);
  if s <> 1300 then raise exception '1015(2): el saldo debia ser 1300 y dio %', s; end if;
  begin insert into public.bo_tesoreria_mov (cuenta_id, fecha, concepto, monto) values (c1, '2026-11-06', 'egreso', 50); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1015(2): un egreso positivo debia fallar'; end if; end;
  begin insert into public.bo_tesoreria_mov (cuenta_id, fecha, concepto, monto) values (c1, '2026-11-06', 'ingreso', 0); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1015(2): un monto cero debia fallar'; end if; end;

  -- 3. Idempotencia: la misma clave no duplica.
  begin insert into public.bo_tesoreria_mov (cuenta_id, fecha, concepto, monto, clave_idem) values (c1, '2026-11-01', 'saldo_inicial', 1000, 'tes-1015-saldo-1'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1015(3): la clave repetida debia fallar'; end if; end;

  -- 4. Solo inserción.
  begin update public.bo_tesoreria_mov set monto = -1 where id = m1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1015(4): UPDATE debia fallar'; end if; end;
  begin delete from public.bo_tesoreria_mov where id = m1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1015(4): DELETE debia fallar'; end if; end;

  -- 5. La reversa exige origen y motivo, neutraliza y no se repite.
  begin insert into public.bo_tesoreria_mov (cuenta_id, fecha, concepto, monto) values (c1, '2026-11-07', 'reversa', 200); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1015(5): una reversa sin origen debia fallar'; end if; end;
  begin insert into public.bo_tesoreria_mov (cuenta_id, fecha, concepto, monto, reversa_de) values (c1, '2026-11-07', 'reversa', 200, m1); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1015(5): una reversa sin motivo debia fallar'; end if; end;
  insert into public.bo_tesoreria_mov (cuenta_id, fecha, concepto, monto, reversa_de, motivo_reversa) values (c1, '2026-11-07', 'reversa', 200, m1, 'capturado en la cuenta equivocada');
  s := public.bo_tesoreria_saldo(c1);
  if s <> 1500 then raise exception '1015(5): tras la reversa el saldo debia ser 1500 y dio %', s; end if;
  begin insert into public.bo_tesoreria_mov (cuenta_id, fecha, concepto, monto, reversa_de, motivo_reversa) values (c1, '2026-11-08', 'reversa', 200, m1, 'otra vez'); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1015(5): reversar dos veces debia fallar'; end if; end;

  -- 6. Las columnas de enlace de conciliacion existen.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and column_name = 'tesoreria_mov_id' and table_name in ('bo_gasto', 'bo_pago_vendedor');
  if n <> 2 then raise exception '1015(6): faltan las columnas tesoreria_mov_id (hay %)', n; end if;
end $$;

-- 7. RLS y grants.
do $$
declare t text;
begin
  foreach t in array array['bo_tesoreria_cuenta', 'bo_tesoreria_mov'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '1015(7): % sin RLS', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception '1015(7): % legible por anon o authenticated', t;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.bo_tesoreria_mov', 'update') or has_table_privilege('service_role', 'public.bo_tesoreria_mov', 'delete') then
    raise exception '1015(7): service_role no debia poder editar ni borrar movimientos';
  end if;
end $$;

rollback;
