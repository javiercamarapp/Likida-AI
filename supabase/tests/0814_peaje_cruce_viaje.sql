\set ON_ERROR_STOP on
-- 0814 — Vínculo cruce→viaje (peaje_cruce_viaje) y su interruptor por flota, contra Postgres REAL.
-- Lo que solo la base puede demostrar: un vínculo por (flota, línea) y repetible entre flotas; el estado y la vía
-- admiten solo su dominio; solo un `ligado` lleva viaje; las FK compuestas impiden colgarlo de una línea, un
-- desglose o un viaje de OTRA flota; borrar el viaje deja viaje_id en NULL (el vínculo sobrevive); borrar la línea
-- o el desglose borra el vínculo; desglose_peaje_linea.viaje_id NO se toca; el interruptor es único por flota y nace
-- apagado; ambas tablas nacen con RLS deny-all.
begin;

insert into public.tenant (id, nombre) values
  ('81400000-0000-4000-8000-0000000000a1', 'Flota A 0814'),
  ('81400000-0000-4000-8000-0000000000b1', 'Flota B 0814');
insert into public.desglose_peaje (id, tenant_id, proveedor) values
  ('81400000-0000-4000-8000-0000000000a2', '81400000-0000-4000-8000-0000000000a1', 'IAVE'),
  ('81400000-0000-4000-8000-0000000000b2', '81400000-0000-4000-8000-0000000000b1', 'IAVE');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('81400000-0000-4000-8000-0000000000a6', '81400000-0000-4000-8000-0000000000a1', 'Operador sintetico A', '2899900814'),
  ('81400000-0000-4000-8000-0000000000b6', '81400000-0000-4000-8000-0000000000b1', 'Operador sintetico B', '2899900812');
insert into public.viaje (id, tenant_id, operador_id) values
  ('81400000-0000-4000-8000-0000000000a3', '81400000-0000-4000-8000-0000000000a1', '81400000-0000-4000-8000-0000000000a6'),
  ('81400000-0000-4000-8000-0000000000b3', '81400000-0000-4000-8000-0000000000b1', '81400000-0000-4000-8000-0000000000b6');
insert into public.desglose_peaje_linea (id, tenant_id, desglose_id, indice, monto, viaje_id) values
  ('81400000-0000-4000-8000-0000000000a4', '81400000-0000-4000-8000-0000000000a1', '81400000-0000-4000-8000-0000000000a2', 0, 100, '81400000-0000-4000-8000-0000000000a3'),
  ('81400000-0000-4000-8000-0000000000a5', '81400000-0000-4000-8000-0000000000a1', '81400000-0000-4000-8000-0000000000a2', 1, 100, null),
  ('81400000-0000-4000-8000-0000000000b4', '81400000-0000-4000-8000-0000000000b1', '81400000-0000-4000-8000-0000000000b2', 0, 100, null);

do $$
declare
  A  constant uuid := '81400000-0000-4000-8000-0000000000a1';
  B  constant uuid := '81400000-0000-4000-8000-0000000000b1';
  DA constant uuid := '81400000-0000-4000-8000-0000000000a2';
  DB constant uuid := '81400000-0000-4000-8000-0000000000b2';
  VA constant uuid := '81400000-0000-4000-8000-0000000000a3';
  VB constant uuid := '81400000-0000-4000-8000-0000000000b3';
  LA constant uuid := '81400000-0000-4000-8000-0000000000a4';
  LA2 constant uuid := '81400000-0000-4000-8000-0000000000a5';
  LB constant uuid := '81400000-0000-4000-8000-0000000000b4';
  n int;
begin
  -- ── un vínculo por (flota, línea) ──
  insert into public.peaje_cruce_viaje (tenant_id, desglose_id, linea_id, viaje_id, estado, via) values (A, DA, LA, VA, 'ligado', 'unidad_ventana');
  insert into public.peaje_cruce_viaje (tenant_id, desglose_id, linea_id, estado, via) values (B, DB, LB, 'sin_viaje', 'unidad_ventana');  -- otra flota: otra fila
  begin
    insert into public.peaje_cruce_viaje (tenant_id, desglose_id, linea_id, estado, via) values (A, DA, LA, 'sin_viaje', 'unidad_ventana');
    raise exception '0814: la línea se vinculó dos veces en la misma flota';
  exception when unique_violation then null; end;

  -- ── dominio de estado y vía ──
  begin
    insert into public.peaje_cruce_viaje (tenant_id, desglose_id, linea_id, estado, via) values (A, DA, LA2, 'inventado', 'unidad_ventana');
    raise exception '0814: admitió un estado fuera del dominio';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_cruce_viaje (tenant_id, desglose_id, linea_id, estado, via) values (A, DA, LA2, 'sin_viaje', 'adivinanza');
    raise exception '0814: admitió una vía fuera del dominio';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_cruce_viaje (tenant_id, desglose_id, linea_id, viaje_id, estado, via) values (A, DA, LA2, VA, 'ambiguo', 'unidad_ventana');
    raise exception '0814: un vínculo no ligado llevó viaje';
  exception when check_violation then null; end;

  -- ── FK compuestas: nada se cuelga de otra flota ──
  begin
    insert into public.peaje_cruce_viaje (tenant_id, desglose_id, linea_id, estado, via) values (A, DA, LB, 'sin_viaje', 'unidad_ventana');
    raise exception '0814: la flota A colgó un vínculo de una línea de la flota B';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.peaje_cruce_viaje (tenant_id, desglose_id, linea_id, estado, via) values (A, DB, LA2, 'sin_viaje', 'unidad_ventana');
    raise exception '0814: la flota A colgó un vínculo del desglose de la flota B';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.peaje_cruce_viaje (tenant_id, desglose_id, linea_id, viaje_id, estado, via) values (A, DA, LA2, VB, 'ligado', 'icident');
    raise exception '0814: la flota A ligó un viaje de la flota B';
  exception when foreign_key_violation then null; end;

  -- ── borrar el viaje deja viaje_id en NULL; el vínculo y la flota sobreviven ──
  delete from public.viaje where id = VA;

  select count(*) into n from public.peaje_cruce_viaje where tenant_id = A and linea_id = LA and viaje_id is null;
  if n <> 1 then raise exception '0814: borrar el viaje no dejó viaje_id en NULL (o borró el vínculo)'; end if;
  select count(*) into n from public.peaje_cruce_viaje where tenant_id = A and linea_id = LA;
  if n <> 1 then raise exception '0814: borrar el viaje borró el vínculo'; end if;
  -- el viaje_id de la LÍNEA (semántica 0106) lo gobierna su propia FK, no el vínculo.
  select count(*) into n from public.desglose_peaje_linea where id = LA and viaje_id is null;
  if n <> 1 then raise exception '0814: desglose_peaje_linea.viaje_id cambió de semántica'; end if;

  -- ── borrar la línea / el desglose borra el vínculo ──
  insert into public.peaje_cruce_viaje (tenant_id, desglose_id, linea_id, estado, via) values (A, DA, LA2, 'sin_unidad', 'unidad_ventana');
  delete from public.desglose_peaje_linea where id = LA2;
  select count(*) into n from public.peaje_cruce_viaje where linea_id = LA2;
  if n <> 0 then raise exception '0814: borrar la línea no borró su vínculo'; end if;
  delete from public.desglose_peaje where id = DB;
  select count(*) into n from public.peaje_cruce_viaje where tenant_id = B;
  if n <> 0 then raise exception '0814: borrar el desglose no borró sus vínculos'; end if;

  -- ── el interruptor: apagado de origen, uno por flota ──
  insert into public.peaje_vinculo_config (tenant_id) values (A);
  select count(*) into n from public.peaje_vinculo_config where tenant_id = A and activo = false;
  if n <> 1 then raise exception '0814: el interruptor no nace apagado'; end if;
  begin
    insert into public.peaje_vinculo_config (tenant_id) values (A);
    raise exception '0814: la flota tuvo dos interruptores';
  exception when unique_violation then null; end;

  -- ── RLS deny-all ──
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relname in ('peaje_cruce_viaje', 'peaje_vinculo_config') and c.relrowsecurity;
  if n <> 2 then raise exception '0814: las dos tablas deben nacer con RLS prendida'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename in ('peaje_cruce_viaje', 'peaje_vinculo_config');
  if n <> 0 then raise exception '0814: no debe haber políticas (deny-all)'; end if;
end $$;

rollback;
