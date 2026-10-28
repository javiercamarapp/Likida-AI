\set ON_ERROR_STOP on
-- 0929 — auditoría 39, ola 8, lote O8-5. Contra Postgres REAL, dentro de una transacción revertida.
--   (a) A39-A1-01  la corrección -R<n> (misma bitácora, terminal y número de liquidación) ya no choca con la original;
--                  dos originales o dos copias de la misma corrección SIGUEN chocando (23505);
--   (b) A39-S14-01 una segunda tanda de candidatos (lote 1, 2) de la misma categoría convive con un reclamo ya enviado;
--                  el reclamo de la categoría completa (lote 0) sigue chocando consigo mismo; uno rechazado no estorba.
begin;

insert into public.tenant (id, nombre) values ('09290000-0000-4000-8000-0000000000a1', 'Flota 0929');
insert into public.operador (id, tenant_id, nombre, telefono)
values ('09290000-0000-4000-8000-0000000000a2', '09290000-0000-4000-8000-0000000000a1', 'Chofer 0929', '525500009291');

-- ── (a) ─────────────────────────────────────────────────────────────────────
do $$
declare
  t uuid := '09290000-0000-4000-8000-0000000000a1';
  op uuid := '09290000-0000-4000-8000-0000000000a2';
  r jsonb; n int;
  liq jsonb; des jsonb;
begin
  liq := jsonb_build_object('clave_externa','BIT-T1-B1','huella',repeat('1',64),'sistema_origen','desglose-bitacora','operador_id',op,
    'folios_viaje','[]'::jsonb,'viaje_ids','[]'::jsonb,'periodo_desde','2026-10-01','periodo_hasta','2026-10-07',
    'conceptos','[{"descripcion":"x","tipo":"percepcion","monto":100}]'::jsonb,'total',100,'moneda','MXN','pdf_origen','generado');
  des := jsonb_build_object('bitacora','B1','terminal','T1','total_origen','tms','numero_liquidacion','L-77');
  r := public.recibir_desglose_atomico(t, liq, des, '{}'::jsonb, '[]'::jsonb);
  if (r->>'creada')::boolean is not true then raise exception 'la original no se creó: %', r; end if;

  -- La corrección: otra clave y otra huella, MISMA bitácora/terminal/número, correccion_n = 1.
  liq := liq || jsonb_build_object('clave_externa','BIT-T1-B1-R1','huella',repeat('2',64));
  r := public.recibir_desglose_atomico(t, liq, des || '{"correccion_n":1}'::jsonb, '{}'::jsonb, '[]'::jsonb);
  if (r->>'creada')::boolean is not true then raise exception 'la corrección -R1 no se creó: %', r; end if;
  select count(*) into n from public.liquidacion_desglose where tenant_id = t and bitacora = 'B1';
  if n <> 2 then raise exception 'esperaba 2 encabezados de B1 (original + R1), hay %', n; end if;

  -- Una SEGUNDA copia con la misma correccion_n choca con la unicidad (otra clave, mismo ordinal).
  begin
    liq := liq || jsonb_build_object('clave_externa','BIT-T1-B1-R1b','huella',repeat('3',64));
    perform public.recibir_desglose_atomico(t, liq, des || '{"correccion_n":1}'::jsonb, '{}'::jsonb, '[]'::jsonb);
    raise exception 'FALLO: dos copias de la misma corrección no deben convivir';
  exception when unique_violation then null; end;

  -- Y una segunda ORIGINAL (correccion_n omitido = 0) bajo otra clave también choca.
  begin
    liq := liq || jsonb_build_object('clave_externa','BIT-T1-B1-otra','huella',repeat('4',64));
    perform public.recibir_desglose_atomico(t, liq, des, '{}'::jsonb, '[]'::jsonb);
    raise exception 'FALLO: dos originales de la misma bitácora no deben convivir';
  exception when unique_violation then null; end;
end $$;

-- ── (b) ─────────────────────────────────────────────────────────────────────
do $$
declare
  t uuid := '09290000-0000-4000-8000-0000000000a1';
  d uuid := '09290000-0000-4000-8000-0000000000d1';
  n int;
begin
  insert into public.desglose_peaje (id, tenant_id, proveedor, archivo_nombre) values (d, t, 'IAVE', 'a.xlsx');

  insert into public.peaje_reclamo (tenant_id, desglose_id, categoria, estado, n_cruces, monto_reclamado, fecha_cobro_mas_antiguo, enviado_en, lote)
  values (t, d, 'extemporaneo', 'enviado', 3, 300, '2026-03-02', '2026-03-12', 1);
  -- La segunda tanda de la misma categoría convive con la primera (ya enviada).
  insert into public.peaje_reclamo (tenant_id, desglose_id, categoria, estado, n_cruces, monto_reclamado, fecha_cobro_mas_antiguo, lote)
  values (t, d, 'extemporaneo', 'preparado', 2, 200, '2026-03-03', 2);
  -- El mismo lote activo sigue chocando.
  begin
    insert into public.peaje_reclamo (tenant_id, desglose_id, categoria, estado, n_cruces, monto_reclamado, fecha_cobro_mas_antiguo, lote)
    values (t, d, 'extemporaneo', 'preparado', 1, 100, '2026-03-04', 2);
    raise exception 'FALLO: dos reclamos activos del mismo lote no deben convivir';
  exception when unique_violation then null; end;
  -- Categoría completa (lote por omisión 0): una vez sí, dos no.
  insert into public.peaje_reclamo (tenant_id, desglose_id, categoria, estado, n_cruces, monto_reclamado, fecha_cobro_mas_antiguo)
  values (t, d, 'duplicado_exacto', 'preparado', 4, 400, '2026-03-02');
  begin
    insert into public.peaje_reclamo (tenant_id, desglose_id, categoria, estado, n_cruces, monto_reclamado, fecha_cobro_mas_antiguo)
    values (t, d, 'duplicado_exacto', 'preparado', 4, 400, '2026-03-02');
    raise exception 'FALLO: el doble envío de la categoría completa debe chocar';
  exception when unique_violation then null; end;
  -- Uno rechazado no estorba al siguiente del mismo lote.
  update public.peaje_reclamo set estado = 'rechazado', enviado_en = '2026-03-12' where tenant_id = t and categoria = 'duplicado_exacto';
  insert into public.peaje_reclamo (tenant_id, desglose_id, categoria, estado, n_cruces, monto_reclamado, fecha_cobro_mas_antiguo)
  values (t, d, 'duplicado_exacto', 'preparado', 4, 400, '2026-03-02');
  select count(*) into n from public.peaje_reclamo where tenant_id = t;
  if n <> 4 then raise exception 'esperaba 4 reclamos, hay %', n; end if;
end $$;

rollback;
select 'ok 0929' as resultado;
