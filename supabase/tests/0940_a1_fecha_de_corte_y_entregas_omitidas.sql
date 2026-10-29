\set ON_ERROR_STOP on
-- 0940 — A1 por correo: fecha de corte del arranque y entregas que nacen `omitida`. Contra Postgres REAL, en una transacción revertida:
-- la columna nace apagada (NULL) también en filas existentes, acepta fechas, y recibir_desglose_atomico crea las entregas `omitida`
-- cuando se lo piden (sin pasar por `pendiente`), `pendiente` cuando no, y un reintento no duplica ni cambia el estado. Permisos intactos.
begin;

insert into public.tenant (id, nombre) values ('09400000-0000-4000-8000-0000000000a1', 'Flota 0940');
insert into public.operador (id, tenant_id, nombre, telefono)
values ('09400000-0000-4000-8000-0000000000a2', '09400000-0000-4000-8000-0000000000a1', 'Chofer 0940', '525500009401');

-- ── 1. La columna: nace NULL; acepta fecha; sigue aceptando NULL ────────────
insert into public.liquidacion_correo_config (tenant_id) values ('09400000-0000-4000-8000-0000000000a1');
do $$
declare t uuid := '09400000-0000-4000-8000-0000000000a1';
begin
  if (select no_enviar_antes_de is not null from public.liquidacion_correo_config where tenant_id = t) then
    raise exception '0940: la fecha de corte no nace apagada (NULL)';
  end if;
  update public.liquidacion_correo_config set no_enviar_antes_de = '2026-11-02' where tenant_id = t;
  if (select no_enviar_antes_de from public.liquidacion_correo_config where tenant_id = t) <> date '2026-11-02' then
    raise exception '0940: no guardó la fecha de corte';
  end if;
  update public.liquidacion_correo_config set no_enviar_antes_de = null where tenant_id = t;
  begin update public.liquidacion_correo_config set no_enviar_antes_de = '2026-13-45' where tenant_id = t;
    raise exception 'FALLO: aceptó una fecha imposible'; exception when datetime_field_overflow or invalid_datetime_format then null; end;
end $$;

-- ── 2. recibir_desglose_atomico: la entrega nace omitida, o pendiente ───────
do $$
declare
  t uuid := '09400000-0000-4000-8000-0000000000a1';
  op uuid := '09400000-0000-4000-8000-0000000000a2';
  liq jsonb; des jsonb; r jsonb; ent jsonb; n int;
begin
  liq := jsonb_build_object('clave_externa','BIT-T1-C1','huella',repeat('1',64),'sistema_origen','desglose-bitacora','operador_id',op,
    'folios_viaje','[]'::jsonb,'viaje_ids','[]'::jsonb,'periodo_desde','2026-10-01','periodo_hasta','2026-10-07',
    'conceptos','[{"descripcion":"x","tipo":"percepcion","monto":100}]'::jsonb,'total',100,'moneda','MXN','pdf_origen','generado');
  des := jsonb_build_object('bitacora','C1','terminal','T1','total_origen','tms');

  -- OMITIDAS (anterior al corte): 2 entregas, ambas omitida, con el motivo, sin lease y sin intentos
  ent := '[{"rol":"operador","correo":"op@ejemplo.test","xlsx_ruta":"x/a.xlsx","estado":"omitida","ultimo_error":"omitida: el periodo termina antes de la fecha de corte del arranque"},
           {"rol":"coordinador","correo":"coord@ejemplo.test","xlsx_ruta":"x/a.xlsx","estado":"omitida","ultimo_error":"omitida: el periodo termina antes de la fecha de corte del arranque"}]'::jsonb;
  r := public.recibir_desglose_atomico(t, liq, des, '{}'::jsonb, ent);
  if (r->>'entregas')::int <> 2 then raise exception '0940: debía crear 2 entregas, creó %', r; end if;
  select count(*) into n from public.liquidacion_entrega_correo e join public.liquidacion_externa l on l.id = e.liquidacion_externa_id
   where l.clave_externa = 'BIT-T1-C1' and e.estado = 'omitida' and e.intentos = 0 and e.claim_token is null
     and e.ultimo_error like 'omitida:%';
  if n <> 2 then raise exception '0940: las 2 entregas debían nacer omitida (nacieron % así)', n; end if;
  -- y el cron NO las reclama
  if exists (select 1 from public.reclamar_entregas_correo(50, now() + interval '1 day', 60) c where c.tenant_id = t) then
    raise exception '0940: el reclamo de la cola tomó una entrega omitida';
  end if;
  -- reintento idempotente: no duplica ni cambia el estado
  r := public.recibir_desglose_atomico(t, liq, des, '{}'::jsonb, ent);
  select count(*) into n from public.liquidacion_entrega_correo e join public.liquidacion_externa l on l.id = e.liquidacion_externa_id
   where l.clave_externa = 'BIT-T1-C1';
  if n <> 2 then raise exception '0940: el reintento duplicó entregas (%)', n; end if;

  -- SIN estado (o con uno que no sea omitida): pendiente, como siempre (un valor desconocido no se cuela a la tabla)
  liq := liq || jsonb_build_object('clave_externa','BIT-T1-C2','huella',repeat('2',64));
  des := jsonb_build_object('bitacora','C2','terminal','T1','total_origen','tms');
  ent := '[{"rol":"operador","correo":"op@ejemplo.test","xlsx_ruta":"x/b.xlsx"},
           {"rol":"coordinador","correo":"coord@ejemplo.test","xlsx_ruta":"x/b.xlsx","estado":"enviada"}]'::jsonb;
  r := public.recibir_desglose_atomico(t, liq, des, '{}'::jsonb, ent);
  select count(*) into n from public.liquidacion_entrega_correo e join public.liquidacion_externa l on l.id = e.liquidacion_externa_id
   where l.clave_externa = 'BIT-T1-C2' and e.estado = 'pendiente' and e.ultimo_error is null;
  if n <> 2 then raise exception '0940: sin estado omitida debían nacer pendiente (nacieron % así)', n; end if;
  if not exists (select 1 from public.reclamar_entregas_correo(50, now() + interval '1 day', 60) c where c.tenant_id = t) then
    raise exception '0940: las pendientes dejaron de ser reclamables';
  end if;
end $$;

-- ── 3. Permisos de la función (intactos) ────────────────────────────────────
do $$
declare p record; f text := 'public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)';
begin
  select prosecdef, proconfig into p from pg_proc where oid = f::regprocedure;
  if not p.prosecdef then raise exception '0940: dejó de ser SECURITY DEFINER'; end if;
  if p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') then raise exception '0940: perdió el search_path fijo'; end if;
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise exception '0940: anon/authenticated ejecutan la función'; end if;
  if not has_function_privilege('service_role', f, 'execute') then raise exception '0940: service_role perdió el execute'; end if;
end $$;

rollback;
