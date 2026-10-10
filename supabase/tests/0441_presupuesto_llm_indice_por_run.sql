\set ON_ERROR_STOP on
-- 0441 — reservar_presupuesto_llm NO RECORRE EL HISTORIAL DE LA FLOTA.
--
-- Carga ligera contra Postgres real: una flota con ~400 mil reservas históricas
-- (el volumen de ~7 meses de 5,000 viajes/mes). Se demuestra con el PLAN y con
-- los BUFFERS leídos —no con un cronómetro, que es flaky en CI— que:
--   (a) la suma por run usa llm_presupuesto_run_idx y lee decenas de bloques;
--   (b) sin ese índice la MISMA consulta lee órdenes de magnitud más (la medición
--       distingue: es la mutación que debe fallar si alguien quita el índice);
--   (c) la semántica no cambió: ok / tope_run / tope_tenant, y un run_id repetido
--       en OTRA flota no cuenta;
--   (d) mantener_llm_presupuesto purga lo viejo y vencido y respeta lo de hoy y
--       lo vivo; el mínimo de 2 días (PU001); es idempotente; permisos solo
--       service_role.
begin;

insert into public.tenant (id, nombre) values
  ('44100000-0000-4000-8000-0000000000a1', 'Flota A 0441'),
  ('44100000-0000-4000-8000-0000000000b1', 'Flota B 0441');

-- 400,000 reservas liquidadas de la flota A en 40,000 runs, repartidas en 200 días.
insert into public.llm_presupuesto_reserva (id, tenant_id, run_id, reservado_usd, costo_real_usd, estado, created_at, expira_en, proposito)
select gen_random_uuid(),
       '44100000-0000-4000-8000-0000000000a1',
       ('44100000-0000-4000-9000-' || lpad((g % 40000)::text, 12, '0'))::uuid,
       0.0100, 0.0100, 'liquidado',
       now() - ((g % 200) || ' days')::interval - interval '3 days',
       now() - interval '1 day',
       'fondo'
from generate_series(1, 400000) g;
analyze public.llm_presupuesto_reserva;

-- Un run con 3 filas vivas, que es el que el usado_run tiene que encontrar.
insert into public.llm_presupuesto_reserva (id, tenant_id, run_id, reservado_usd, costo_real_usd, estado, proposito)
select gen_random_uuid(), '44100000-0000-4000-8000-0000000000a1', '44100000-0000-4000-9000-00000000ffff', 0.30, 0.30, 'liquidado', 'interactivo'
from generate_series(1, 3);

-- ── (a)/(b) el plan y los buffers de la suma por run ───────────────────────
create temp table _plan (j jsonb);
do $$
declare
  plan jsonb;
  buffers_con int;
  buffers_sin int;
  texto text;
  q text := $q$
    explain (analyze, buffers, format json)
    select coalesce(sum(reservado_usd), 0)
      from public.llm_presupuesto_reserva
     where tenant_id = '44100000-0000-4000-8000-0000000000a1'
       and run_id = '44100000-0000-4000-9000-00000000ffff'
       and (estado = 'liquidado' or (estado = 'reservado' and expira_en > now()))
  $q$;
  function_leidos int;
begin
  execute q into plan;
  texto := plan::text;
  if texto not like '%llm_presupuesto_run_idx%' then
    raise exception '0441: la suma por run NO usa llm_presupuesto_run_idx: %', left(texto, 600);
  end if;
  buffers_con := coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::int, 0) + coalesce((plan->0->'Plan'->>'Shared Read Blocks')::int, 0);
  if buffers_con > 40 then
    raise exception '0441: la suma por run leyó % bloques con el índice (esperado < 40)', buffers_con;
  end if;

  -- (b) la mutación: sin el índice, la misma consulta recorre el historial.
  drop index public.llm_presupuesto_run_idx;
  execute q into plan;
  buffers_sin := coalesce((plan->0->'Plan'->>'Shared Hit Blocks')::int, 0) + coalesce((plan->0->'Plan'->>'Shared Read Blocks')::int, 0);
  if buffers_sin < buffers_con * 20 then
    raise exception '0441: la medición no distingue: con índice % bloques, sin índice % (esperado >= 20x)', buffers_con, buffers_sin;
  end if;
  raise notice '0441 buffers: con índice %, sin índice % (x%)', buffers_con, buffers_sin, round(buffers_sin::numeric / greatest(buffers_con,1));
  create index llm_presupuesto_run_idx on public.llm_presupuesto_reserva (tenant_id, run_id) include (reservado_usd, estado, expira_en);
  analyze public.llm_presupuesto_reserva;
end $$;

-- ── (c) la semántica de la función, con esa carga encima ───────────────────
set local role service_role;
do $$
declare r text;
begin
  -- tope por run: ya lleva 0.90; 0.20 más con tope 1.00 → tope_run
  r := public.reservar_presupuesto_llm(gen_random_uuid(), '44100000-0000-4000-8000-0000000000a1',
        '44100000-0000-4000-9000-00000000ffff', 0.20, 1.00, 50.00, 'interactivo', 0);
  if r <> 'tope_run' then raise exception '0441: esperaba tope_run y fue %', r; end if;
  -- con holgura de run, entra
  r := public.reservar_presupuesto_llm(gen_random_uuid(), '44100000-0000-4000-8000-0000000000a1',
        '44100000-0000-4000-9000-00000000ffff', 0.05, 1.00, 50.00, 'interactivo', 0);
  if r <> 'ok' then raise exception '0441: esperaba ok y fue %', r; end if;
  -- el mismo run_id en OTRA flota no cuenta (aislamiento por tenant)
  r := public.reservar_presupuesto_llm(gen_random_uuid(), '44100000-0000-4000-8000-0000000000b1',
        '44100000-0000-4000-9000-00000000ffff', 0.95, 1.00, 50.00, 'interactivo', 0);
  if r <> 'ok' then raise exception '0441: el run de otra flota contó contra esta: %', r; end if;
  -- tope del tenant (hoy ya lleva 0.05 + 0.95 en total entre flotas distintas: A lleva 0.05)
  r := public.reservar_presupuesto_llm(gen_random_uuid(), '44100000-0000-4000-8000-0000000000a1',
        gen_random_uuid(), 0.10, 5.00, 0.10, 'interactivo', 0);
  if r <> 'tope_tenant' then raise exception '0441: esperaba tope_tenant y fue %', r; end if;
end $$;
reset role;

-- ── (d) la purga ───────────────────────────────────────────────────────────
delete from public.llm_presupuesto_reserva where tenant_id in ('44100000-0000-4000-8000-0000000000a1', '44100000-0000-4000-8000-0000000000b1');
insert into public.llm_presupuesto_reserva (id, tenant_id, run_id, reservado_usd, costo_real_usd, estado, created_at, expira_en, proposito) values
  ('44100000-0000-4000-a000-000000000001', '44100000-0000-4000-8000-0000000000a1', gen_random_uuid(), 0.1, 0.1, 'liquidado', now() - interval '40 days', now() - interval '40 days', 'fondo'),   -- vieja liquidada: se purga
  ('44100000-0000-4000-a000-000000000002', '44100000-0000-4000-8000-0000000000a1', gen_random_uuid(), 0.1, 0.1, 'liquidado', now() - interval '10 days', now() - interval '10 days', 'fondo'),   -- reciente: se queda
  ('44100000-0000-4000-a000-000000000003', '44100000-0000-4000-8000-0000000000a1', gen_random_uuid(), 0.1, 0,   'liquidado', now(),                     now(),                     'fondo'),   -- de hoy: se queda
  ('44100000-0000-4000-a000-000000000004', '44100000-0000-4000-8000-0000000000a1', gen_random_uuid(), 0.1, 0,   'reservado', now() - interval '5 days',  now() - interval '5 days', 'fondo'),   -- reservada vencida: se purga
  ('44100000-0000-4000-a000-000000000005', '44100000-0000-4000-8000-0000000000a1', gen_random_uuid(), 0.1, 0,   'reservado', now(),                     now() + interval '10 minutes', 'fondo'), -- reservada viva: se queda
  ('44100000-0000-4000-a000-000000000006', '44100000-0000-4000-8000-0000000000a1', gen_random_uuid(), 0.1, 0,   'reservado', now() - interval '3 hours', now() - interval '2 hours', 'fondo');   -- vencida hace horas (< 1 día): se queda
set local role service_role;
do $$
declare r jsonb; quedan text[];
begin
  begin
    perform public.mantener_llm_presupuesto(1);
    raise exception '0441: aceptó p_dias=1';
  exception when sqlstate 'PU001' then null;
  end;
  r := public.mantener_llm_presupuesto(35);
  if (r->>'liquidadasBorradas')::int <> 1 or (r->>'vencidasBorradas')::int <> 1 or (r->>'parcial')::boolean then
    raise exception '0441: purga inesperada: %', r;
  end if;
  select array_agg(right(id::text, 1) order by id) into quedan
    from public.llm_presupuesto_reserva where tenant_id = '44100000-0000-4000-8000-0000000000a1';
  if quedan is distinct from array['2','3','5','6'] then
    raise exception '0441: quedaron % (esperado 2,3,5,6)', quedan;
  end if;
  -- idempotente
  r := public.mantener_llm_presupuesto(35);
  if (r->>'liquidadasBorradas')::int <> 0 or (r->>'vencidasBorradas')::int <> 0 then
    raise exception '0441: la segunda corrida borró algo: %', r;
  end if;
end $$;
reset role;

do $$
begin
  if has_function_privilege('anon', 'public.mantener_llm_presupuesto(integer,timestamptz,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.mantener_llm_presupuesto(integer,timestamptz,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.reservar_presupuesto_llm(uuid,uuid,uuid,numeric,numeric,numeric,text,numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.reservar_presupuesto_llm(uuid,uuid,uuid,numeric,numeric,numeric,text,numeric)', 'execute') then
    raise exception '0441: anon/authenticated pueden ejecutar las funciones del presupuesto';
  end if;
end $$;

rollback;
\echo '0441 OK'
