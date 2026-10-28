\set ON_ERROR_STOP on
-- 0933 — A1 por correo: correo emisor, modo primer mes con revisores y rol `revisor`. Contra Postgres REAL, en una transacción
-- revertida: formas de las columnas nuevas, el rol en la cola, y recibir_desglose_atomico (una retenida admite SOLO la entrega al
-- revisor; una no retenida admite todas; reintento idempotente; permisos solo service_role).
begin;

insert into public.tenant (id, nombre) values ('09330000-0000-4000-8000-0000000000a1', 'Flota 0933');
insert into public.operador (id, tenant_id, nombre, telefono)
values ('09330000-0000-4000-8000-0000000000a2', '09330000-0000-4000-8000-0000000000a1', 'Chofer 0933', '525500009331');

-- ── 1. Configuración: valores válidos entran; los inválidos, no ─────────────
insert into public.liquidacion_correo_config (tenant_id, remitente_correo, revisores, primer_mes_hasta)
values ('09330000-0000-4000-8000-0000000000a1', 'emisor@ejemplo.test',
        '[{"departamento":"nomina","correo":"nomina@ejemplo.test"},{"departamento":"rh","correo":"rh@ejemplo.test"}]', '2026-11-30');

do $$
declare t uuid := '09330000-0000-4000-8000-0000000000a1';
begin
  if (select revisores = '[]'::jsonb from public.liquidacion_correo_config where tenant_id = t) then raise exception '0933: no guardó los revisores'; end if;
  begin update public.liquidacion_correo_config set remitente_correo = 'sin-arroba' where tenant_id = t;
    raise exception 'FALLO: remitente_correo sin forma'; exception when check_violation then null; end;
  begin update public.liquidacion_correo_config set revisores = '[{"departamento":"nomina","correo":"malo"}]' where tenant_id = t;
    raise exception 'FALLO: revisor con correo sin forma'; exception when check_violation then null; end;
  begin update public.liquidacion_correo_config set revisores = '[{"departamento":"Nómina 1","correo":"a@ejemplo.test"}]' where tenant_id = t;
    raise exception 'FALLO: departamento con forma inválida'; exception when check_violation then null; end;
  begin update public.liquidacion_correo_config set revisores = '{"departamento":"nomina"}' where tenant_id = t;
    raise exception 'FALLO: revisores que no es arreglo'; exception when check_violation then null; end;
  begin update public.liquidacion_correo_config set revisores = '[{"departamento":"a1","correo":"a@ejemplo.test"}]' where tenant_id = t;
    raise exception 'FALLO: departamento con dígito'; exception when check_violation then null; end;
  begin update public.liquidacion_correo_config set revisores = (select jsonb_agg(jsonb_build_object('departamento','dep','correo','r'||g||'@ejemplo.test')) from generate_series(1,6) g)
         where tenant_id = t;
    raise exception 'FALLO: más de 5 revisores'; exception when check_violation then null; end;
  -- por omisión: apagado
  delete from public.liquidacion_correo_config where tenant_id = t;
  insert into public.liquidacion_correo_config (tenant_id) values (t);
  if exists (select 1 from public.liquidacion_correo_config where tenant_id = t and (revisores <> '[]'::jsonb or primer_mes_hasta is not null or remitente_correo is not null)) then
    raise exception '0933: el modo primer mes no nace apagado';
  end if;
end $$;

-- ── 2. recibir_desglose_atomico ─────────────────────────────────────────────
do $$
declare
  t uuid := '09330000-0000-4000-8000-0000000000a1';
  op uuid := '09330000-0000-4000-8000-0000000000a2';
  liq jsonb; des jsonb; r jsonb; ent jsonb; n int;
begin
  ent := '[{"rol":"operador","correo":"op@ejemplo.test","xlsx_ruta":"x/a.xlsx"},{"rol":"revisor","correo":"nomina@ejemplo.test","xlsx_ruta":"x/a.xlsx"},{"rol":"archivo","correo":"arch@ejemplo.test","xlsx_ruta":"x/a.xlsx"}]'::jsonb;
  liq := jsonb_build_object('clave_externa','BIT-T1-R1','huella',repeat('1',64),'sistema_origen','desglose-bitacora','operador_id',op,
    'folios_viaje','[]'::jsonb,'viaje_ids','[]'::jsonb,'periodo_desde','2026-10-01','periodo_hasta','2026-10-07',
    'conceptos','[{"descripcion":"x","tipo":"percepcion","monto":100}]'::jsonb,'total',100,'moneda','MXN','pdf_origen','generado');

  -- RETENIDA: solo la entrega al revisor
  des := jsonb_build_object('bitacora','R1','terminal','T1','total_origen','tms','retenida_motivo','El neto es negativo.');
  r := public.recibir_desglose_atomico(t, liq, des, '{}'::jsonb, ent);
  if (r->>'entregas')::int <> 1 then raise exception '0933: una retenida debía admitir 1 entrega (revisor), admitió %', r; end if;
  if (select string_agg(rol, ',') from public.liquidacion_entrega_correo where tenant_id = t) <> 'revisor' then
    raise exception '0933: una retenida admitió un rol que no es revisor';
  end if;
  -- reintento idempotente
  r := public.recibir_desglose_atomico(t, liq, des, '{}'::jsonb, ent);
  select count(*) into n from public.liquidacion_entrega_correo where tenant_id = t;
  if n <> 1 then raise exception '0933: el reintento duplicó entregas (%)', n; end if;

  -- NO RETENIDA: todas
  liq := liq || jsonb_build_object('clave_externa','BIT-T1-R2','huella',repeat('2',64));
  des := jsonb_build_object('bitacora','R2','terminal','T1','total_origen','tms');
  r := public.recibir_desglose_atomico(t, liq, des, '{}'::jsonb, ent);
  if (r->>'entregas')::int <> 3 then raise exception '0933: una no retenida debía admitir las 3 entregas, admitió %', r; end if;
  if (select count(*) from public.liquidacion_entrega_correo e join public.liquidacion_externa l on l.id = e.liquidacion_externa_id
       where l.clave_externa = 'BIT-T1-R2') <> 3 then raise exception '0933: faltan entregas de la no retenida'; end if;
end $$;

-- ── 3. El rol sigue siendo un dominio cerrado ───────────────────────────────
do $$
declare t uuid := '09330000-0000-4000-8000-0000000000a1'; lid uuid;
begin
  select id into lid from public.liquidacion_externa where tenant_id = t and clave_externa = 'BIT-T1-R1';
  begin
    insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo) values (t, lid, 'jefe', 'j@ejemplo.test');
    raise exception 'FALLO: un rol fuera del dominio';
  exception when check_violation then null; end;
end $$;

-- ── 4. Permisos de la función ───────────────────────────────────────────────
do $$
declare p record; f text := 'public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)';
begin
  select prosecdef, proconfig into p from pg_proc where oid = f::regprocedure;
  if not p.prosecdef then raise exception '0933: dejó de ser SECURITY DEFINER'; end if;
  if p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') then raise exception '0933: perdió el search_path fijo'; end if;
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise exception '0933: anon/authenticated ejecutan la función'; end if;
  if not has_function_privilege('service_role', f, 'execute') then raise exception '0933: service_role perdió el execute'; end if;
end $$;

rollback;
