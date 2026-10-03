\set ON_ERROR_STOP on
-- 0661 — CONDUCTOR: reparto justo del cron entre flotas y cierre de lo vencido, contra Postgres REAL (sintético, rollback).
-- Lo que solo la base garantiza:
--   (a) `viajes_activos_repartidos` reparte por turnos: con una flota de 6 viajes y otra de 2, un tope de 4 trae 2+2 (el más
--       viejo de cada una primero) y no los 4 de la grande; con tope holgado trae todos, cada flota en su orden por antigüedad;
--   (b) solo entran abiertos y aceptados, y los de más de p_max_dias quedan fuera;
--   (c) la rotación cambia quién se queda con el turno sobrante entre ventanas, sin perder ni duplicar viajes;
--   (d) `cerrar_hitos_viajes_vencidos` omite SOLO los hitos esperando/escalados de viajes abiertos vencidos (motivo
--       `viaje_abierto_vencido`), no toca los recibidos, ni los viajes recientes, ni el viaje mismo, y es idempotente;
--   (e) rangos inválidos rebotan y solo service_role ejecuta ambas.
begin;

insert into public.tenant (id, nombre) values
  ('66100000-0000-4000-8000-0000000000a1', 'Flota grande 0661'),
  ('66100000-0000-4000-8000-0000000000b1', 'Flota chica 0661');

-- Flota A: 6 viajes abiertos aceptados (A-1 el más viejo … A-6 el más nuevo) + uno vencido (60 días) + uno sin aceptar + uno liquidado.
-- Flota B: 2 abiertos aceptados. Un operador por viaje (índice único de un viaje abierto por operador, 0029).
insert into public.operador (id, tenant_id, nombre, telefono)
select ('66100000-0000-4000-8000-0000001' || lpad(g::text, 5, '0'))::uuid,
       case when g <= 9 then '66100000-0000-4000-8000-0000000000a1'::uuid else '66100000-0000-4000-8000-0000000000b1'::uuid end,
       'Chofer ' || g, '52550066' || lpad(g::text, 4, '0')
  from generate_series(1, 11) g;

insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en)
select ('66100000-0000-4000-8000-0000002' || lpad(g::text, 5, '0'))::uuid,
       case when g <= 9 then '66100000-0000-4000-8000-0000000000a1'::uuid else '66100000-0000-4000-8000-0000000000b1'::uuid end,
       ('66100000-0000-4000-8000-0000001' || lpad(g::text, 5, '0'))::uuid,
       case when g <= 9 then 'A-' || g else 'B-' || (g - 9) end,
       case when g = 9 then 'liquidado' else 'abierto' end,
       now(),
       case when g <= 6 then now() - make_interval(hours => 100 - g)   -- A-1 el más viejo
            when g = 7 then now() - interval '60 days'                -- vencido
            when g = 8 then null                                      -- sin aceptar
            when g = 9 then now() - interval '2 days'                 -- liquidado
            else now() - make_interval(hours => 50 - g) end
  from generate_series(1, 11) g;

set local role service_role;

do $$
declare
  ids uuid[]; ids2 uuid[]; n int; na int;
  A constant uuid := '66100000-0000-4000-8000-0000000000a1';
  B constant uuid := '66100000-0000-4000-8000-0000000000b1';
  v1 constant uuid := '66100000-0000-4000-8000-000000200001'; -- A-1
  v2 constant uuid := '66100000-0000-4000-8000-000000200002'; -- A-2
  v7 constant uuid := '66100000-0000-4000-8000-000000200007'; -- vencido
  b1 constant uuid := '66100000-0000-4000-8000-000000200010'; -- B-1
  b2 constant uuid := '66100000-0000-4000-8000-000000200011'; -- B-2
begin
  -- (a) tope 4 → 2 de cada flota (los más viejos de cada una), no los 4 de la grande
  select array_agg(o_id) into ids from public.viajes_activos_repartidos(4);
  select count(*) into n from public.viaje where id = any(ids) and tenant_id = B;
  select count(*) into na from public.viaje where id = any(ids) and tenant_id = A;
  if cardinality(ids) <> 4 or n <> 2 or na <> 2 then
    raise exception '0661: tope 4 trajo A=% B=% (se esperaba 2 y 2)', na, n;
  end if;
  if not (v1 = any(ids) and v2 = any(ids)) then raise exception '0661: no trajo los dos más viejos de la flota grande'; end if;

  -- (b) tope holgado: 6 de A + 2 de B = 8 (sin vencido, sin sin-aceptar, sin liquidado)
  select array_agg(o_id) into ids from public.viajes_activos_repartidos(100);
  if cardinality(ids) <> 8 then raise exception '0661: con tope holgado trajo % viajes (se esperaban 8)', cardinality(ids); end if;
  if v7 = any(ids) then raise exception '0661: entró un viaje con 60 días abierto'; end if;
  -- con un plazo de 90 días el vencido SÍ entra
  select count(*) into n from public.viajes_activos_repartidos(100, 0, 90);
  if n <> 9 then raise exception '0661: con p_max_dias=90 trajo % (se esperaban 9)', n; end if;
  -- el orden de cada flota es por antigüedad
  select array_agg(o_id order by ord) filter (where t = A) into ids2
    from (select o_id, row_number() over () as ord, (select tenant_id from public.viaje where id = o_id) as t
            from public.viajes_activos_repartidos(100)) x;
  if ids2[1] <> v1 or ids2[2] <> v2 then raise exception '0661: la flota grande no sale por antigüedad'; end if;

  -- (c) la rotación mueve el turno sobrante: con tope 3 (turno 1 = A-1 y B-1; el 3.º es del turno 2 de una u otra)
  -- sin perder ni duplicar nada y alternando entre ventanas
  select count(distinct (select tenant_id from public.viaje where id = o_id)) into n from public.viajes_activos_repartidos(3, 0);
  if n <> 2 then raise exception '0661: tope 3 dejó una flota sin viajes'; end if;
  select array_agg(o_id) into ids  from public.viajes_activos_repartidos(3, 0);
  select array_agg(o_id) into ids2 from public.viajes_activos_repartidos(3, 1);
  if cardinality(ids) <> 3 or cardinality(ids2) <> 3 or (select count(distinct x) from unnest(ids) x) <> 3 then
    raise exception '0661: la rotación duplicó o perdió viajes';
  end if;
  -- entre varias ventanas, el tercero sale de las dos flotas (no siempre de la misma)
  select count(distinct (select tenant_id from public.viaje where id = (select o_id from public.viajes_activos_repartidos(3, w) offset 2 limit 1)))
    into n from generate_series(0, 15) w;
  if n <> 2 then raise exception '0661: el turno sobrante no rota entre flotas (% flota(s) en 16 ventanas)', n; end if;

  -- (e) rangos
  begin perform public.viajes_activos_repartidos(0); raise exception '0661: aceptó tope 0';
  exception when raise_exception then if sqlerrm like '0661:%' then raise; end if; end;
  begin perform public.viajes_activos_repartidos(10, 0, 0); raise exception '0661: aceptó p_max_dias 0';
  exception when raise_exception then if sqlerrm like '0661:%' then raise; end if; end;
  begin perform public.cerrar_hitos_viajes_vencidos(0); raise exception '0661: aceptó p_max_dias 0 al cerrar';
  exception when raise_exception then if sqlerrm like '0661:%' then raise; end if; end;
end $$;

-- (d) cierre de hitos vencidos
do $$
declare
  n int;
  v1 constant uuid := '66100000-0000-4000-8000-000000200001';
  v7 constant uuid := '66100000-0000-4000-8000-000000200007';
begin
  perform public.sembrar_hitos_conductor(100);
  -- el viaje vencido (A-7) tiene un hito ya recibido y otro escalado
  update public.viaje_hito set estado = 'recibido', fuente = 'texto', recibido_en = now() - interval '59 days'
   where viaje_id = v7 and tipo = 'llegada_carga';
  update public.viaje_hito set estado = 'escalado', escalado_en = now() - interval '58 days', escalacion_nivel = 1
   where viaje_id = v7 and tipo = 'salida_carga';
  select count(*) into n from public.viaje_hito where viaje_id = v7;
  if n <> 5 then raise exception '0661: la siembra no creó los 5 hitos del viaje vencido (%)', n; end if;

  n := public.cerrar_hitos_viajes_vencidos();
  if n <> 4 then raise exception '0661: cerró % hitos (se esperaban 4: 3 esperando + 1 escalado)', n; end if;
  if (select count(*) from public.viaje_hito where viaje_id = v7 and estado = 'omitido' and omitido_motivo = 'viaje_abierto_vencido') <> 4 then
    raise exception '0661: los hitos cerrados no quedaron omitido/viaje_abierto_vencido';
  end if;
  if (select estado from public.viaje_hito where viaje_id = v7 and tipo = 'llegada_carga') <> 'recibido' then
    raise exception '0661: tocó un hito ya recibido';
  end if;
  if (select count(*) from public.viaje_hito where viaje_id = v1 and estado = 'esperado') <> 5 then
    raise exception '0661: tocó los hitos de un viaje reciente';
  end if;
  if (select estatus from public.viaje where id = v7) <> 'abierto' then raise exception '0661: cambió el viaje mismo'; end if;
  if public.cerrar_hitos_viajes_vencidos() <> 0 then raise exception '0661: no es idempotente'; end if;
  -- el límite acota cuántos cierra por pasada
  update public.viaje_hito set estado = 'esperado', omitido_motivo = null where viaje_id = v7 and estado = 'omitido';
  if public.cerrar_hitos_viajes_vencidos(30, 2) <> 2 then raise exception '0661: p_limite no acotó el cierre'; end if;
end $$;

-- (e) solo service_role
reset role;
set local role authenticated;
do $$
begin
  begin perform public.viajes_activos_repartidos(10); raise exception '0661: authenticated ejecutó viajes_activos_repartidos';
  exception when insufficient_privilege then null; end;
  begin perform public.cerrar_hitos_viajes_vencidos(); raise exception '0661: authenticated ejecutó cerrar_hitos_viajes_vencidos';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
