\set ON_ERROR_STOP on
-- 0851 — `uq_viaje_abierto_por_unidad`: una unidad, a lo más un viaje abierto.
-- Gemelo de la 0029 (`uq_viaje_abierto_por_operador`), del lado de `unidad_id`.
--
-- HALLAZGO ALTO: el escenario real es asignar la MISMA unidad a dos viajes
-- abiertos distintos — el segundo intento tiene que fallar. Lo que SOLO la
-- base puede demostrar, contra Postgres real:
--
--   (a) dos viajes `abierto` con la MISMA unidad, en la MISMA flota, chocan;
--   (b) cerrar el primero (estatus = 'liquidado') LIBERA la unidad: el
--       segundo viaje ya puede abrir con ella;
--   (c) 'en_cuadre' cuenta igual que 'abierto' — el índice cubre los DOS
--       estatus del predicado, no solo uno;
--   (d) DOS viajes abiertos SIN unidad (`unidad_id is null`) NO chocan — el
--       predicado los excluye a propósito;
--   (e) la unidad SIGUE pudiendo tener muchos viajes LIQUIDADOS: el índice
--       es sobre los abiertos, no sobre la unidad a secas.
begin;

insert into public.tenant (id, nombre) values
  ('08510000-0000-4000-8000-0000000000a1', 'Flota A 0851');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('08510000-0000-4000-8000-0000000000b1', '08510000-0000-4000-8000-0000000000a1', 'Chofer 1 0851', '525500000853'),
  ('08510000-0000-4000-8000-0000000000b2', '08510000-0000-4000-8000-0000000000a1', 'Chofer 2 0851', '525500000850'),
  -- b3/b4 son EXCLUSIVOS de (d): b1/b2 ya tienen un viaje abierto a esas
  -- alturas del script (d4, vía b2) y reusarlos chocaría contra
  -- `uq_viaje_abierto_por_operador` (0029) — un candado DISTINTO al que (d)
  -- quiere probar, y confundiría el diagnóstico si (d) fallara.
  ('08510000-0000-4000-8000-0000000000b3', '08510000-0000-4000-8000-0000000000a1', 'Chofer 3 0851', '525500000851'),
  ('08510000-0000-4000-8000-0000000000b4', '08510000-0000-4000-8000-0000000000a1', 'Chofer 4 0851', '525500000852');
insert into public.unidad (id, tenant_id, numero_economico) values
  ('08510000-0000-4000-8000-0000000000c1', '08510000-0000-4000-8000-0000000000a1', 'T-0851');

set local role service_role;

-- ── (a) la MISMA unidad en DOS viajes abiertos choca ──────────────────────
insert into public.viaje (id, tenant_id, operador_id, unidad_id, estatus) values
  ('08510000-0000-4000-8000-0000000000d1', '08510000-0000-4000-8000-0000000000a1',
   '08510000-0000-4000-8000-0000000000b1', '08510000-0000-4000-8000-0000000000c1', 'abierto');

do $$ begin
  begin
    insert into public.viaje (id, tenant_id, operador_id, unidad_id, estatus) values
      ('08510000-0000-4000-8000-0000000000d2', '08510000-0000-4000-8000-0000000000a1',
       '08510000-0000-4000-8000-0000000000b2', '08510000-0000-4000-8000-0000000000c1', 'abierto');
    raise exception '0851(a): la misma unidad entró a DOS viajes abiertos a la vez';
  exception when unique_violation then null;
  end;
end $$;

-- ── (c) 'en_cuadre' choca igual que 'abierto' ─────────────────────────────
do $$ begin
  begin
    insert into public.viaje (id, tenant_id, operador_id, unidad_id, estatus) values
      ('08510000-0000-4000-8000-0000000000d3', '08510000-0000-4000-8000-0000000000a1',
       '08510000-0000-4000-8000-0000000000b2', '08510000-0000-4000-8000-0000000000c1', 'en_cuadre');
    raise exception '0851(c): "en_cuadre" con la unidad ya abierta debía chocar igual que "abierto"';
  exception when unique_violation then null;
  end;
end $$;

-- ── (b) cerrar el primero LIBERA la unidad ────────────────────────────────
update public.viaje set estatus = 'liquidado' where id = '08510000-0000-4000-8000-0000000000d1';

do $$ begin
  insert into public.viaje (id, tenant_id, operador_id, unidad_id, estatus) values
    ('08510000-0000-4000-8000-0000000000d4', '08510000-0000-4000-8000-0000000000a1',
     '08510000-0000-4000-8000-0000000000b2', '08510000-0000-4000-8000-0000000000c1', 'abierto');
exception when unique_violation then
  raise exception '0851(b): con el primer viaje ya liquidado, la unidad debía poder abrir uno nuevo';
end $$;

-- ── (e) la unidad sigue pudiendo tener muchos viajes LIQUIDADOS ───────────
do $$ begin
  if (select count(*) from public.viaje where unidad_id = '08510000-0000-4000-8000-0000000000c1' and estatus = 'liquidado') <> 1 then
    raise exception '0851(e): debía quedar exactamente un viaje liquidado con esa unidad (el (a) original)';
  end if;
  if (select count(*) from public.viaje where unidad_id = '08510000-0000-4000-8000-0000000000c1' and estatus = 'abierto') <> 1 then
    raise exception '0851(e): debía quedar exactamente un viaje abierto con esa unidad (el de (b))';
  end if;
end $$;

-- ── (d) DOS viajes abiertos SIN unidad no chocan — el predicado los excluye ─
do $$ begin
  insert into public.viaje (id, tenant_id, operador_id, unidad_id, estatus) values
    ('08510000-0000-4000-8000-0000000000d5', '08510000-0000-4000-8000-0000000000a1',
     '08510000-0000-4000-8000-0000000000b3', null, 'abierto'),
    ('08510000-0000-4000-8000-0000000000d6', '08510000-0000-4000-8000-0000000000a1',
     '08510000-0000-4000-8000-0000000000b4', null, 'abierto');
exception when unique_violation then
  raise exception '0851(d): dos viajes abiertos SIN unidad no debían chocar — el predicado excluye unidad_id is null';
end $$;

rollback;
