\set ON_ERROR_STOP on
-- 0525 — COBRANZA DE COMPROBANTES POR GASTO.
-- Lo que solo la base garantiza, con datos sintéticos propios (rollback):
--   (a) el CLAIM: UN contacto por (gasto, tier) — el segundo insert choca con el unique;
--   (b) la FK COMPUESTA: el contacto de una flota no cuelga de un gasto de otra;
--   (c) dominios: motivo, vía, resuelto_por; resuelto_en y resuelto_por van juntos y solo
--       un contacto ENVIADO puede resolverse; tier > 0;
--   (d) la config: defaults (APAGADA, 1/3/7, 1 mensaje al día) y rangos;
--   (e) cascade: borrar el gasto o la flota se lleva su historial de cobranza;
--   (f) RLS deny-all: authenticated sin acceso, service_role sí.
begin;

insert into public.tenant (id, nombre) values
  ('52500000-0000-4000-8000-0000000000a1', 'Flota A 0525'),
  ('52500000-0000-4000-8000-0000000000b1', 'Flota B 0525');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('52500000-0000-4000-8000-0000000000a2', '52500000-0000-4000-8000-0000000000a1', 'Op A', '529999905251'),
  ('52500000-0000-4000-8000-0000000000b2', '52500000-0000-4000-8000-0000000000b1', 'Op B', '529999905252');
insert into public.viaje (id, tenant_id, operador_id, folio, estatus) values
  ('52500000-0000-4000-8000-0000000000a3', '52500000-0000-4000-8000-0000000000a1', '52500000-0000-4000-8000-0000000000a2', 'A-1', 'abierto'),
  ('52500000-0000-4000-8000-0000000000b3', '52500000-0000-4000-8000-0000000000b1', '52500000-0000-4000-8000-0000000000b2', 'B-1', 'abierto');
insert into public.gasto (id, tenant_id, viaje_id, concepto, monto) values
  ('52500000-0000-4000-8000-0000000000a4', '52500000-0000-4000-8000-0000000000a1', '52500000-0000-4000-8000-0000000000a3', 'diesel', 1200),
  ('52500000-0000-4000-8000-0000000000a5', '52500000-0000-4000-8000-0000000000a1', '52500000-0000-4000-8000-0000000000a3', 'caseta', 85),
  ('52500000-0000-4000-8000-0000000000b4', '52500000-0000-4000-8000-0000000000b1', '52500000-0000-4000-8000-0000000000b3', 'diesel', 900);

do $$
declare
  A constant uuid := '52500000-0000-4000-8000-0000000000a1';
  B constant uuid := '52500000-0000-4000-8000-0000000000b1';
  OPA constant uuid := '52500000-0000-4000-8000-0000000000a2';
  GA1 constant uuid := '52500000-0000-4000-8000-0000000000a4';
  GA2 constant uuid := '52500000-0000-4000-8000-0000000000a5';
  GB1 constant uuid := '52500000-0000-4000-8000-0000000000b4';
  lote constant uuid := '52500000-0000-4000-8000-0000000000c1';
  n int;
begin
  -- (d) config: defaults y rangos
  insert into public.agente_cobranza_config (tenant_id) values (A);
  if (select por_gasto from public.agente_cobranza_config where tenant_id = A) then
    raise exception '0525: la cobranza por gasto no nace APAGADA';
  end if;
  if (select tiers_gasto from public.agente_cobranza_config where tenant_id = A) <> '[1, 3, 7]'::jsonb
     or (select max_mensajes_dia from public.agente_cobranza_config where tenant_id = A) <> 1
     or (select umbral_foto from public.agente_cobranza_config where tenant_id = A) <> 0.50 then
    raise exception '0525: defaults de la config por gasto incorrectos';
  end if;
  begin update public.agente_cobranza_config set max_mensajes_dia = 0 where tenant_id = A;
    raise exception '0525: aceptó max_mensajes_dia = 0'; exception when check_violation then null; end;
  begin update public.agente_cobranza_config set max_mensajes_dia = 4 where tenant_id = A;
    raise exception '0525: aceptó max_mensajes_dia = 4'; exception when check_violation then null; end;
  begin update public.agente_cobranza_config set umbral_foto = 0.05 where tenant_id = A;
    raise exception '0525: aceptó umbral_foto = 0.05'; exception when check_violation then null; end;
  begin update public.agente_cobranza_config set umbral_foto = 0.99 where tenant_id = A;
    raise exception '0525: aceptó umbral_foto = 0.99'; exception when check_violation then null; end;
  begin update public.agente_cobranza_config set tiers_gasto = '[]'::jsonb where tenant_id = A;
    raise exception '0525: aceptó tiers_gasto vacío'; exception when check_violation then null; end;
  begin update public.agente_cobranza_config set tiers_gasto = '[1,2,3,4,5,6]'::jsonb where tenant_id = A;
    raise exception '0525: aceptó 6 tiers'; exception when check_violation then null; end;
  begin update public.agente_cobranza_config set tiers_gasto = '{"a":1}'::jsonb where tenant_id = A;
    raise exception '0525: aceptó tiers_gasto que no es arreglo'; exception when check_violation then null; end;
  update public.agente_cobranza_config set por_gasto = true, tiers_gasto = '[2,5]', max_mensajes_dia = 3, umbral_foto = 0.75 where tenant_id = A;

  -- (a) el claim: un contacto por (gasto, tier)
  insert into public.cobranza_gasto_contacto (tenant_id, gasto_id, operador_id, tier, motivo, lote_id)
    values (A, GA1, OPA, 1, 'sin_cfdi', lote), (A, GA2, OPA, 1, 'sin_foto', lote);
  begin
    insert into public.cobranza_gasto_contacto (tenant_id, gasto_id, operador_id, tier, motivo, lote_id)
      values (A, GA1, OPA, 1, 'sin_cfdi', gen_random_uuid());
    raise exception '0525: dos corridas reclamaron el mismo (gasto, tier)';
  exception when unique_violation then null; end;
  -- otro tier del mismo gasto sí
  insert into public.cobranza_gasto_contacto (tenant_id, gasto_id, operador_id, tier, motivo, lote_id)
    values (A, GA1, OPA, 3, 'sin_cfdi', gen_random_uuid());
  -- un lote que repite un (gasto,tier) falla ENTERO (atomicidad del claim fusionado)
  begin
    insert into public.cobranza_gasto_contacto (tenant_id, gasto_id, operador_id, tier, motivo, lote_id)
      values (A, GA2, OPA, 3, 'sin_foto', gen_random_uuid()), (A, GA1, OPA, 3, 'sin_cfdi', gen_random_uuid());
    raise exception '0525: un lote con un duplicado entró a medias';
  exception when unique_violation then null; end;
  if (select count(*) from public.cobranza_gasto_contacto where gasto_id = GA2 and tier = 3) <> 0 then
    raise exception '0525: el lote fallido dejó una fila suelta';
  end if;

  -- (b) FK compuesta
  begin
    insert into public.cobranza_gasto_contacto (tenant_id, gasto_id, tier, motivo, lote_id)
      values (A, GB1, 1, 'sin_cfdi', gen_random_uuid());
    raise exception '0525: el contacto de la flota A colgó de un gasto de la flota B';
  exception when foreign_key_violation then null; end;

  -- (c) dominios y coherencia
  begin insert into public.cobranza_gasto_contacto (tenant_id, gasto_id, tier, motivo, lote_id)
    values (A, GA2, 7, 'por_gusto', gen_random_uuid()); raise exception '0525: motivo fuera de dominio';
  exception when check_violation then null; end;
  begin insert into public.cobranza_gasto_contacto (tenant_id, gasto_id, tier, motivo, lote_id, via)
    values (A, GA2, 7, 'sin_foto', gen_random_uuid(), 'paloma'); raise exception '0525: vía fuera de dominio';
  exception when check_violation then null; end;
  begin insert into public.cobranza_gasto_contacto (tenant_id, gasto_id, tier, motivo, lote_id)
    values (A, GA2, 0, 'sin_foto', gen_random_uuid()); raise exception '0525: tier 0';
  exception when check_violation then null; end;
  begin insert into public.cobranza_gasto_contacto (tenant_id, gasto_id, tier, motivo, lote_id)
    values (A, GA2, 61, 'sin_foto', gen_random_uuid()); raise exception '0525: tier 61';
  exception when check_violation then null; end;
  -- resuelto_en y resuelto_por van juntos; solo lo ENVIADO se resuelve
  begin update public.cobranza_gasto_contacto set resuelto_en = now(), enviado = true where gasto_id = GA2 and tier = 1;
    raise exception '0525: resuelto_en sin resuelto_por'; exception when check_violation then null; end;
  begin update public.cobranza_gasto_contacto set resuelto_en = now(), resuelto_por = 'chofer' where gasto_id = GA2 and tier = 1;
    raise exception '0525: se resolvió un contacto que NO salió'; exception when check_violation then null; end;
  begin update public.cobranza_gasto_contacto set resuelto_en = now(), resuelto_por = 'magia', enviado = true where gasto_id = GA2 and tier = 1;
    raise exception '0525: resuelto_por fuera de dominio'; exception when check_violation then null; end;
  update public.cobranza_gasto_contacto set enviado = true, via = 'plantilla' where lote_id = lote;
  update public.cobranza_gasto_contacto set resuelto_en = now(), resuelto_por = 'chofer' where gasto_id = GA1 and tier = 1;

  -- (e) cascade: borrar el gasto se lleva su historial; borrar la flota, el resto
  select count(*) into n from public.cobranza_gasto_contacto where gasto_id = GA1;
  if n <> 2 then raise exception '0525: se esperaban 2 contactos de GA1, hay %', n; end if;
  delete from public.gasto where id = GA1;
  select count(*) into n from public.cobranza_gasto_contacto where gasto_id = GA1;
  if n <> 0 then raise exception '0525: el historial sobrevivió al borrado del gasto (%)', n; end if;
  delete from public.tenant where id = A;
  select count(*) into n from public.cobranza_gasto_contacto where tenant_id = A;
  if n <> 0 then raise exception '0525: el historial sobrevivió al borrado de la flota (%)', n; end if;
end $$;

-- (f) RLS deny-all
insert into public.tenant (id, nombre) values ('52500000-0000-4000-8000-0000000000d1', 'Flota D 0525');
set local role authenticated;
do $$
begin
  begin perform count(*) from public.cobranza_gasto_contacto; raise exception '0525: authenticated pudo leer';
  exception when insufficient_privilege then null; end;
  begin insert into public.cobranza_gasto_contacto (tenant_id, gasto_id, tier, motivo, lote_id)
    values ('52500000-0000-4000-8000-0000000000b1', '52500000-0000-4000-8000-0000000000b4', 1, 'sin_cfdi', gen_random_uuid());
    raise exception '0525: authenticated pudo escribir';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ declare n int; begin
  select count(*) into n from public.cobranza_gasto_contacto;
  if n < 0 then raise exception 'imposible'; end if;
end $$;
reset role;

rollback;
select '0525_cobranza_por_gasto OK' as resultado;
