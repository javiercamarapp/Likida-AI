-- ═══════════════════════════════════════════════════════════════════════════
-- carga-15k.sql — SIEMBRA sintética para la prueba de escala (docs/escala-15k.md)
--
-- Simula UN MES del cliente de 15,000 viajes/mes: un tenant 'ZZZ CARGA' con
-- 200 choferes, 15,000 viajes (500/día × 30 días), 45,000 gastos (3 por
-- viaje) y 12,000 liquidaciones. Todo obviamente sintético: folios ZZZ-,
-- teléfonos del rango falso 5215559xxxxxx, UUIDs ZZZZZZZZ-.
--
-- CÓMO CORRERLO: pegar entero en el SQL editor de Supabase (corre como
-- postgres, dueño de las tablas: la RLS no aplica). Un solo DO = una sola
-- transacción: si algo choca contra un constraint, no queda nada.
--
-- ORDEN OBLIGATORIO (no reordenar): gastos ANTES que liquidaciones — el
-- trigger `trg_gasto_no_tras_liquidar` (0036) rechaza con CU001 cualquier
-- gasto de un viaje que ya tenga liquidación emitida.
--
-- CONSTRAINTS QUE ESTA SIEMBRA RESPETA A PROPÓSITO:
--   · uq_viaje_abierto_por_operador (0029): UN abierto por operador → los
--     'abierto' son exactamente 200, uno por chofer (los viajes 1..200).
--   · viaje_estatus_dominio (0025): los otros 14,800 van 'liquidado'. 12,000
--     con su fila de liquidación (los n 201..12,200); 2,800 sin ella — un
--     viaje 'liquidado' sin liquidación es legal (la propia 0036 lo documenta
--     y el bloque 8 de verificaciones.sql lo usa).
--   · uq_gasto_cfdi_uuid / uq_gasto_img_hash: cfdi_uuid distinto por gasto
--     donde se pone; img_hash se deja NULL (no participa del unique parcial).
--   · uq_operador_telefono_activo (0024, GLOBAL): teléfonos del rango
--     5215559000001..5215559000200, imposible en un chofer real.
--   · gasto_concepto_dominio / liquidacion_estatus_dominio (0025).
--
-- LIMPIEZA: scripts/carga-15k-limpiar.sql (delete del tenant — todo cascada).
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  t   uuid := 'aaaaaaaa-0000-4000-8000-000000015000';  -- fijo: lo usan medir y limpiar
  ops uuid[];
begin
  if exists (select 1 from tenant where id = t) then
    raise exception 'ZZZ CARGA ya existe: corre scripts/carga-15k-limpiar.sql primero';
  end if;

  insert into tenant (id, nombre, plan) values (t, 'ZZZ CARGA', 'demo');

  -- ── 200 choferes ──────────────────────────────────────────────────────────
  insert into operador (tenant_id, nombre, telefono, activo)
  select t, 'ZZZ Chofer ' || lpad(i::text, 3, '0'), '5215559' || lpad(i::text, 6, '0'), true
  from generate_series(1, 200) i;

  select array_agg(id order by telefono) into ops from operador where tenant_id = t;

  -- ── 15,000 viajes: 500/día durante los últimos 30 días ───────────────────
  -- n = 1..15,000. fecha_inicio reparte 500 por día (los n bajos son los más
  -- viejos). created_at cae el mismo día, espaciado ~100 s — el reparto que
  -- una operación real de 500/día produce. Los 200 'abierto' llevan cada uno
  -- SU operador (n = 1..200 ↔ ops[n]) y los recientes también rotan chofer.
  --
  -- OJO — avisado_en va NULL en los 200 ABIERTOS a propósito: la escalación
  -- (escalar_viaje.ts) y la cobranza (agentes/cobranza.ts) filtran
  -- `avisado_en is not null`, y un abierto sintético "avisado" haría que el
  -- CRON REAL intentara mandar WhatsApp a los 200 números falsos. En los
  -- 'liquidado' sí se pone (realista e inofensivo: ambos crons filtran por
  -- estatus abierto/en_cuadre).
  insert into viaje (tenant_id, operador_id, folio, origen, destino, anticipo,
                     fecha_inicio, estatus, created_at, avisado_en)
  select
    t,
    ops[1 + ((n - 1) % 200)],
    'ZZZ-' || lpad(n::text, 6, '0'),
    (array['Ciudad de México','Guadalajara','Monterrey','Veracruz','Nuevo Laredo'])[1 + (n % 5)],
    (array['Monterrey','Tijuana','Mérida','Puebla','Querétaro'])[1 + (n % 5)],
    9000 + (n % 50) * 100,
    current_date - 30 + ((n - 1) / 500),
    case when n <= 200 then 'abierto' else 'liquidado' end,
    (current_date - 30 + ((n - 1) / 500))::timestamptz
      + interval '6 hours' + ((n - 1) % 500) * interval '100 seconds',
    case when n <= 200 then null
         else (current_date - 30 + ((n - 1) / 500))::timestamptz + interval '6 hours' end
  from generate_series(1, 15000) n;

  -- ── 45,000 gastos: diésel + caseta + alimentación por viaje ──────────────
  -- ANTES de las liquidaciones (trigger 0036). La mitad trae cfdi_uuid
  -- (sintético, único) y forma_pago alterna 01/03 — para que el 15% de
  -- combustible en efectivo (getAcumuladoCombustible) tenga qué contar.
  insert into gasto (tenant_id, viaje_id, concepto, monto, fecha, folio,
                     cfdi_uuid, forma_pago, ocr_confianza, created_at)
  select
    t, v.id,
    (array['diesel','caseta','alimentacion'])[k],
    case k when 1 then 4500 + (v.n % 100)
           when 2 then 380 + (v.n % 40)
           else 220 + (v.n % 30) end,
    v.fecha_inicio,
    'ZZZ-G-' || v.n || '-' || k,
    case when (v.n + k) % 2 = 0
         then 'ZZZZZZZZ-' || lpad(v.n::text, 6, '0') || '-' || k
         else null end,
    case when (v.n + k) % 3 = 0 then '01' else '03' end,
    0.95,
    v.created_at + k * interval '25 minutes'
  from (
    select id, fecha_inicio, created_at,
           (substring(folio from 5))::int as n
    from viaje where tenant_id = t
  ) v
  cross join generate_series(1, 3) k;

  -- ── 12,000 liquidaciones: los viajes n = 201..12,200 ─────────────────────
  -- created_at ~30 h después del arranque del viaje (cierre al día
  -- siguiente). 1 de cada 10 sale 'con_diferencias' con su JSON de
  -- diferencias — para que getKpis/getDineroObservadoPorTipo tengan señal.
  insert into liquidacion (tenant_id, viaje_id, total_comprobado, total_anticipo,
                           diferencia, estatus, diferencias, created_at,
                           iva_acreditable, ieps_acreditable, peaje_acreditable,
                           litros_diesel_acreditables)
  select
    t, v.id,
    5100 + (v.n % 170),
    9000 + (v.n % 50) * 100,
    (9000 + (v.n % 50) * 100) - (5100 + (v.n % 170)),
    case when v.n % 10 = 0 then 'con_diferencias' else 'cuadrada' end,
    case when v.n % 10 = 0
         then '[{"tipo":"sobre_politica","nota":"sintético ZZZ","monto":350}]'::jsonb
         else '[]'::jsonb end,
    v.created_at + interval '30 hours',
    (620 + (v.n % 40))::numeric(12,2),
    (180 + (v.n % 20))::numeric(12,2),
    (190 + (v.n % 20))::numeric(12,2),
    (170 + (v.n % 30))::numeric(12,3)
  from (
    select id, created_at, (substring(folio from 5))::int as n
    from viaje where tenant_id = t
  ) v
  where v.n between 201 and 12200;

  raise notice 'ZZZ CARGA sembrado: tenant=%', t;
end $$;

-- Conteo de control — pégalo en el doc junto a los EXPLAIN:
select
  (select count(*) from operador    where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000') as operadores,
  (select count(*) from viaje       where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000') as viajes,
  (select count(*) from gasto       where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000') as gastos,
  (select count(*) from liquidacion where tenant_id = 'aaaaaaaa-0000-4000-8000-000000015000') as liquidaciones;
-- esperado: 200 | 15000 | 45000 | 12000
