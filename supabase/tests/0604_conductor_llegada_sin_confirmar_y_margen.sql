\set ON_ERROR_STOP on
-- 0604 — Conductor: la clase de aviso y el evento nuevos se aceptan (y siguen siendo únicos), y las dos perillas
-- de la config tienen su dominio. Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values ('60400000-0000-4000-8000-0000000000a1', 'Flota A 0604');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('60400000-0000-4000-8000-0000000000a2', '60400000-0000-4000-8000-0000000000a1', 'Chofer A', '525500006041');
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en) values
  ('60400000-0000-4000-8000-0000000000d1', '60400000-0000-4000-8000-0000000000a1', '60400000-0000-4000-8000-0000000000a2', 'A-0604', 'abierto', now() - interval '5 hours', now() - interval '5 hours');
select public.sembrar_hitos_conductor(10);

do $$
declare h uuid; n int;
begin
  select id into h from public.viaje_hito
   where viaje_id = '60400000-0000-4000-8000-0000000000d1' and tipo = 'llegada_carga';
  if h is null then raise exception '0604: no se sembró el hito de llegada a carga'; end if;

  -- la clase nueva se reclama UNA vez por (hito, ciclo, clase, nivel)
  insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase, nivel)
    values ('60400000-0000-4000-8000-0000000000a1', '60400000-0000-4000-8000-0000000000d1', h, 1, 'llegada_sin_confirmar', 1);
  begin
    insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase, nivel)
      values ('60400000-0000-4000-8000-0000000000a1', '60400000-0000-4000-8000-0000000000d1', h, 1, 'llegada_sin_confirmar', 1);
    raise exception '0604: el mismo aviso se reclamó dos veces';
  exception when unique_violation then null; end;
  -- una clase inventada sigue rechazada, y las anteriores siguen vigentes
  begin
    insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase, nivel)
      values ('60400000-0000-4000-8000-0000000000a1', '60400000-0000-4000-8000-0000000000d1', h, 1, 'inventada', 1);
    raise exception '0604: aceptó una clase de aviso inventada';
  exception when check_violation then null; end;
  insert into public.viaje_hito_aviso (tenant_id, viaje_id, viaje_hito_id, ciclo, clase, nivel)
    values ('60400000-0000-4000-8000-0000000000a1', '60400000-0000-4000-8000-0000000000d1', h, 1, 'alerta_estadia', 1);

  -- el evento nuevo entra a la bitácora; uno inventado, no
  insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento)
    values ('60400000-0000-4000-8000-0000000000a1', '60400000-0000-4000-8000-0000000000d1', h, 'llegada_carga', 'alerta_llegada_sin_confirmar');
  begin
    insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento)
      values ('60400000-0000-4000-8000-0000000000a1', '60400000-0000-4000-8000-0000000000d1', h, 'llegada_carga', 'evento_inventado');
    raise exception '0604: aceptó un evento inventado';
  exception when check_violation then null; end;
  select count(*) into n from public.viaje_hito_evento where evento = 'alerta_estadia' or evento = 'recibido' or evento = 'solicitado';
  -- (no se asevera el conteo: solo que los dominios anteriores no se perdieron al reescribir el CHECK)
  insert into public.viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento)
    values ('60400000-0000-4000-8000-0000000000a1', '60400000-0000-4000-8000-0000000000d1', h, 'llegada_carga', 'alerta_estadia');
end $$;

-- la config: valores por omisión y dominio del margen
insert into public.agente_conductor_config (tenant_id) values ('60400000-0000-4000-8000-0000000000a1');
do $$
declare c record;
begin
  select avisar_llegada_sin_confirmar a, margen_acercamiento_m m into c from public.agente_conductor_config
   where tenant_id = '60400000-0000-4000-8000-0000000000a1';
  if c.a is distinct from false then raise exception '0604: el aviso por llegada sin confirmar debe nacer apagado'; end if;
  if c.m is distinct from 5000 then raise exception '0604: el margen de acercamiento debe nacer en 5,000 m (%)', c.m; end if;

  update public.agente_conductor_config set margen_acercamiento_m = 0 where tenant_id = '60400000-0000-4000-8000-0000000000a1';
  update public.agente_conductor_config set margen_acercamiento_m = 50000 where tenant_id = '60400000-0000-4000-8000-0000000000a1';
  begin
    update public.agente_conductor_config set margen_acercamiento_m = 50001 where tenant_id = '60400000-0000-4000-8000-0000000000a1';
    raise exception '0604: aceptó un margen de más de 50 km';
  exception when check_violation then null; end;
  begin
    update public.agente_conductor_config set margen_acercamiento_m = -1 where tenant_id = '60400000-0000-4000-8000-0000000000a1';
    raise exception '0604: aceptó un margen negativo';
  exception when check_violation then null; end;
end $$;

rollback;
