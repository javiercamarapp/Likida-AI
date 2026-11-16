\set ON_ERROR_STOP on
-- 1010 (Back-office, LOTE C) — comisiones y pagos a vendedores: devengo solo sobre cobrado y conciliado, base = subtotal, idempotencia,
-- clawback ligado al origen, solo inserción, pago sin CFDI, saldo que se arrastra y grants.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values ('99101000-0000-4000-8000-0000000000a1', 'Flota 1010');
insert into public.app_user (id, email, nombre, rol) values
  ('99101000-0000-4000-8000-0000000000b1', 'vend1010@example.test', 'Vendedor 1010', 'vendedor'),
  ('99101000-0000-4000-8000-0000000000b2', 'adm1010@example.test', 'Admin 1010', 'superadmin');
insert into public.prospecto (id, empresa, correo, estado)
  values ('99101000-0000-4000-8000-0000000000c1', 'Prospecto 1010', 'p1010@example.test', 'contactado');

-- f1: pagada y conciliada (comisionable); f2: pagada SIN referencia de banco (no comisionable); f3: pendiente.
insert into public.factura_saas (id, tenant_id, periodo_inicio, periodo_fin, monto, subtotal, iva, estado, pagada_en, conciliada_por, conciliada_en, referencia_banco) values
  ('99101000-0000-4000-8000-0000000000d1', '99101000-0000-4000-8000-0000000000a1', '2026-10-01', '2026-10-31', 11600, 10000, 1600, 'pagada', now(), '99101000-0000-4000-8000-0000000000b2', now(), 'SPEI 1010-A');
insert into public.factura_saas (id, tenant_id, periodo_inicio, periodo_fin, monto, subtotal, iva, estado, pagada_en) values
  ('99101000-0000-4000-8000-0000000000d2', '99101000-0000-4000-8000-0000000000a1', '2026-11-01', '2026-11-30', 11600, 10000, 1600, 'pagada', now());
insert into public.factura_saas (id, tenant_id, periodo_inicio, periodo_fin, monto, subtotal, iva, estado) values
  ('99101000-0000-4000-8000-0000000000d3', '99101000-0000-4000-8000-0000000000a1', '2026-12-01', '2026-12-31', 11600, 10000, 1600, 'pendiente');

do $$
declare
  v constant uuid := '99101000-0000-4000-8000-0000000000b1';
  adm constant uuid := '99101000-0000-4000-8000-0000000000b2';
  f1 constant uuid := '99101000-0000-4000-8000-0000000000d1';
  f2 constant uuid := '99101000-0000-4000-8000-0000000000d2';
  f3 constant uuid := '99101000-0000-4000-8000-0000000000d3';
  m1 uuid; pago uuid; err text; s numeric;
begin
  -- 1. Devengo valido: 50 % de la base (subtotal 10,000) = 5,000.
  insert into public.bo_comision_mov (vendedor_id, factura_saas_id, periodo, tipo, concepto, base_cobrada, pct_aplicado, monto)
  values (v, f1, '2026-11-01', 'devengo', 'primer_mes', 10000, 0.5, 5000) returning id into m1;

  -- 2. No se comisiona lo pendiente ni lo «pagado» sin referencia de banco.
  begin
    insert into public.bo_comision_mov (vendedor_id, factura_saas_id, periodo, tipo, concepto, base_cobrada, pct_aplicado, monto)
    values (v, f3, '2026-11-01', 'devengo', 'recurrente', 10000, 0.2, 2000); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(2): una factura pendiente no debia comisionar'; end if; end;
  begin
    insert into public.bo_comision_mov (vendedor_id, factura_saas_id, periodo, tipo, concepto, base_cobrada, pct_aplicado, monto)
    values (v, f2, '2026-11-01', 'devengo', 'recurrente', 10000, 0.2, 2000); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(2): una pagada sin referencia de banco no debia comisionar'; end if; end;

  -- 3. La base es el SUBTOTAL, no el total con IVA.
  begin
    insert into public.bo_comision_mov (vendedor_id, factura_saas_id, periodo, tipo, concepto, base_cobrada, pct_aplicado, monto)
    values (v, f1, '2026-12-01', 'devengo', 'recurrente', 11600, 0.2, 2320); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(3): la base con IVA debia fallar'; end if; end;

  -- 4. Idempotencia: la misma factura no devenga dos veces.
  begin
    insert into public.bo_comision_mov (vendedor_id, factura_saas_id, periodo, tipo, concepto, base_cobrada, pct_aplicado, monto)
    values (v, f1, '2026-11-01', 'devengo', 'primer_mes', 10000, 0.5, 5000); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(4): devengar dos veces debia fallar'; end if; end;

  -- 5. Clawback: negativo, ligado al origen, exacto y una sola vez.
  begin
    insert into public.bo_comision_mov (vendedor_id, factura_saas_id, periodo, tipo, concepto, base_cobrada, monto)
    values (v, f1, '2026-12-01', 'clawback', 'ajuste', 10000, -1); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(5): un clawback sin origen debia fallar'; end if; end;
  begin
    insert into public.bo_comision_mov (vendedor_id, factura_saas_id, periodo, tipo, concepto, base_cobrada, monto, referencia_origen)
    values (v, f1, '2026-12-01', 'clawback', 'ajuste', 10000, -4000, m1); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(5): un clawback distinto al origen debia fallar'; end if; end;
  insert into public.bo_comision_mov (vendedor_id, factura_saas_id, periodo, tipo, concepto, base_cobrada, monto, referencia_origen)
  values (v, f1, '2026-12-01', 'clawback', 'ajuste', 10000, -5000, m1);
  begin
    insert into public.bo_comision_mov (vendedor_id, factura_saas_id, periodo, tipo, concepto, base_cobrada, monto, referencia_origen)
    values (v, f1, '2027-01-01', 'clawback', 'ajuste', 10000, -5000, m1); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(5): un segundo clawback debia fallar'; end if; end;

  -- 6. Solo inserción.
  begin update public.bo_comision_mov set monto = 1 where id = m1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(6): UPDATE debia fallar'; end if; end;
  begin delete from public.bo_comision_mov where id = m1; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(6): DELETE debia fallar'; end if; end;

  -- 7. Saldo: 5,000 − 5,000 = 0; con un pago autorizado mayor el saldo es negativo y se arrastra (no se cobra).
  s := public.bo_saldo_comision(v);
  if s <> 0 then raise exception '1010(7): el saldo debia ser 0 y dio %', s; end if;

  -- 8. Pago: sin CFDI no sale de borrador; sin referencia no pasa a pagado; no hay dos pagos por periodo.
  insert into public.bo_pago_vendedor (id, vendedor_id, periodo, monto_autorizado) values ('99101000-0000-4000-8000-0000000000e1', v, '2026-11-01', 100) returning id into pago;
  begin update public.bo_pago_vendedor set estado = 'autorizado', autorizado_en = now(), autorizado_por = adm where id = pago; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(8): autorizar sin CFDI debia fallar'; end if; end;
  begin insert into public.bo_pago_vendedor (vendedor_id, periodo, monto_autorizado) values (v, '2026-11-01', 50); raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(8): dos pagos del mismo periodo debian fallar'; end if; end;
  update public.bo_pago_vendedor set cfdi_honorarios_uuid = 'BBBBBBBB-0000-4000-8000-000000000001', cfdi_honorarios_recibido_en = '2026-11-20' where id = pago;
  update public.bo_pago_vendedor set estado = 'autorizado', autorizado_en = now(), autorizado_por = adm where id = pago;
  begin update public.bo_pago_vendedor set monto_autorizado = 999 where id = pago; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(8): cambiar el monto autorizado debia fallar'; end if; end;
  begin update public.bo_pago_vendedor set estado = 'pagado', pagado_en = '2026-11-25' where id = pago; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(8): pagar sin referencia debia fallar'; end if; end;
  update public.bo_pago_vendedor set estado = 'pagado', pagado_en = '2026-11-25', referencia_banco = 'SPEI 1010-P' where id = pago;
  begin update public.bo_pago_vendedor set estado = 'autorizado', pagado_en = null, referencia_banco = null where id = pago; raise exception 'no lanzo';
  exception when others then get stacked diagnostics err = message_text; if err = 'no lanzo' then raise exception '1010(8): un pago pagado no se modifica'; end if; end;

  -- 9. El pago autorizado de 100 deja un saldo de −100: negativo, se arrastra.
  s := public.bo_saldo_comision(v);
  if s <> -100 then raise exception '1010(9): el saldo debia ser -100 y dio %', s; end if;
end $$;

-- 10. La regla pactada está congelada y la vigencia no está definida.
do $$
declare r record;
begin
  select * into r from public.bo_comision_regla order by vigente_desde desc limit 1;
  if r.primer_mes_pct <> 0.5 or r.recurrente_pct <> 0.2 or r.vigencia_meses is not null then
    raise exception '1010(10): la regla debia ser 50/20 sin vigencia definida';
  end if;
end $$;

-- 11. RLS y grants.
do $$
declare t text;
begin
  foreach t in array array['bo_comision_regla', 'bo_comision_mov', 'bo_pago_vendedor'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '1010(11): % sin RLS', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception '1010(11): % legible por anon o authenticated', t;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.bo_comision_mov', 'update') or has_table_privilege('service_role', 'public.bo_comision_mov', 'delete') then
    raise exception '1010(11): service_role no debia poder editar ni borrar movimientos';
  end if;
end $$;

rollback;
