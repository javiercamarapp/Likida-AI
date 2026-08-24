-- pgTAP: leases/fencing de WhatsApp y tools (migraciones 0187 + 0188).
-- Cubre la carrera observable en una sesión y verifica que el claim usa
-- SKIP LOCKED. La carrera real de dos sesiones se ejercita en el test TS.

begin;
select plan(33);

select ok(
  (select prosrc ilike '%for update skip locked%'
     from pg_proc
    where oid = 'public.reclamar_wa_pendiente(text,integer,text,integer)'::regprocedure),
  'el claim de la bandeja usa FOR UPDATE SKIP LOCKED'
);

insert into public.wa_evento_pendiente (id, evento)
values ('zzz-lease-pg-inbox', '{"from":"5219990000000","type":"text"}'::jsonb);
select is(
  (select count(*)::int from public.wa_evento_pendiente where id = 'zzz-lease-pg-inbox'),
  1,
  'la fila de prueba existe'
);

select is(
  (select count(*)::int from public.reclamar_wa_pendiente('zzz-lease-pg-inbox', 0, 'worker-a', 180)),
  1,
  'el primer worker obtiene el lease'
);
select is(
  (select count(*)::int from public.reclamar_wa_pendiente('zzz-lease-pg-inbox', 1, 'worker-b', 180)),
  0,
  'un segundo worker no obtiene un lease vigente'
);
select is(
  public.renovar_wa_pendiente('zzz-lease-pg-inbox', gen_random_uuid(), 'worker-a', 180),
  false,
  'un token ajeno no puede renovar'
);
select is(
  public.renovar_wa_pendiente(
    'zzz-lease-pg-inbox',
    (select claim_token from public.wa_evento_pendiente where id = 'zzz-lease-pg-inbox'),
    'worker-a', 180
  ),
  true,
  'el dueño puede renovar su lease'
);
select is(
  public.completar_wa_pendiente('zzz-lease-pg-inbox', gen_random_uuid(), 'worker-a'),
  false,
  'un token ajeno no puede completar'
);
select is(
  public.completar_wa_pendiente(
    'zzz-lease-pg-inbox',
    (select claim_token from public.wa_evento_pendiente where id = 'zzz-lease-pg-inbox'),
    'worker-a'
  ),
  true,
  'el dueño puede completar y limpiar el lease'
);
select is(
  (select count(*)::int from public.reclamar_wa_pendiente('zzz-lease-pg-inbox', 1, 'worker-c', 180)),
  0,
  'un evento completado no se reclama otra vez'
);

insert into public.wa_evento_pendiente (id, evento)
values ('zzz-lease-pg-fail', '{"from":"5219990000001","type":"text"}'::jsonb);
select is(
  (select count(*)::int from public.reclamar_wa_pendiente('zzz-lease-pg-fail', 0, 'worker-a', 180)),
  1,
  'el segundo evento obtiene un lease'
);
select is(
  public.fallar_wa_pendiente('zzz-lease-pg-fail', gen_random_uuid(), 'worker-b', 'ajeno', false),
  false,
  'un worker ajeno no puede liberar ni anotar el fallo'
);
select is(
  public.fallar_wa_pendiente(
    'zzz-lease-pg-fail',
    (select claim_token from public.wa_evento_pendiente where id = 'zzz-lease-pg-fail'),
    'worker-a', 'fallo de prueba', false
  ),
  true,
  'el dueño puede fallar y liberar su lease'
);
select is(
  (select count(*)::int from public.reclamar_wa_pendiente('zzz-lease-pg-fail', 1, 'worker-b', 180)),
  1,
  'otro worker puede recuperar después de fail fenced'
);

-- El orden por chofer es una invariantes de base, no solo un agrupamiento del
-- worker. Mientras A1 está arrendado, A2 no se lista ni se puede reclamar.
insert into public.wa_evento_pendiente (id, evento, recibido_en)
values
  ('zzz-order-a1', '{"from":"5219990000002","type":"text"}'::jsonb, clock_timestamp() - interval '2 seconds'),
  ('zzz-order-a2', '{"from":"5219990000002","type":"text"}'::jsonb, clock_timestamp() - interval '1 second');
select is(
  (select count(*)::int from public.reclamar_wa_pendiente('zzz-order-a1', 0, 'worker-order', 180)),
  1,
  'A1 obtiene el lease de su chofer'
);
select is(
  (select count(*)::int from public.listar_wa_pendientes(200) where id = 'zzz-order-a2'),
  0,
  'A2 no se lista mientras A1 sigue arrendado'
);
select is(
  (select count(*)::int from public.reclamar_wa_pendiente('zzz-order-a2', 0, 'worker-b', 180)),
  0,
  'A2 tampoco puede saltarse A1 reclamando directo'
);
select is(
  public.completar_wa_pendiente(
    'zzz-order-a1',
    (select claim_token from public.wa_evento_pendiente where id = 'zzz-order-a1'),
    'worker-order'
  ),
  true,
  'A1 se completa con fencing'
);
select is(
  (select count(*)::int from public.reclamar_wa_pendiente('zzz-order-a2', 0, 'worker-b', 180)),
  1,
  'A2 se habilita solamente después de completar A1'
);

select is(
  (select count(*)::int from public.claim_wa_mensaje_procesado('zzz-lease-downstream', 'worker-a', 180)),
  1,
  'el claim downstream obtiene su primer lease'
);
select is(
  (select estado from public.claim_wa_mensaje_procesado('zzz-lease-downstream', 'worker-b', 180)),
  'en_curso',
  'el claim downstream no roba un lease vigente'
);
select is(
  public.complete_wa_mensaje_procesado('zzz-lease-downstream', gen_random_uuid(), 'worker-b'),
  false,
  'el downstream también rechaza un token ajeno'
);

-- Idempotencia de tools: el tiempo se decide en PostgreSQL y el claim es
-- atómico. El test fuerza la expiración con clock_timestamp() de la misma
-- sesión para simular una instancia de aplicación con reloj adelantado o
-- atrasado; ningún timestamp de la aplicación entra en la RPC.
select ok(
  (select prosrc ilike '%clock_timestamp()%'
     from pg_proc
    where oid = 'public.claim_agente_mutacion(uuid,text,text,integer)'::regprocedure),
  'el claim de tools usa el reloj de PostgreSQL'
);
select ok(
  (select prosrc ilike '%for update skip locked%'
     from pg_proc
    where oid = 'public.claim_agente_mutacion(uuid,text,text,integer)'::regprocedure),
  'el claim de tools serializa la carrera con SKIP LOCKED'
);

insert into public.tenant (id, nombre)
values ('00000000-0000-0000-0000-000000000001', 'pgTAP leases');
create temp table _tool_claims (
  claim_no integer,
  kind text,
  token uuid,
  result jsonb
) on commit drop;

insert into _tool_claims
select 1, c.kind, c.token, c.result
  from public.claim_agente_mutacion(
    '00000000-0000-0000-0000-000000000001', 'clock-skew-effect', 'tool-a', 120
  ) c;
select is(
  (select kind from _tool_claims where claim_no = 1),
  'execute',
  'el primer worker obtiene el claim de tools'
);
select ok(
  (select lease_until > clock_timestamp()
     from public.agente_mutacion_idempotencia
    where tenant_id = '00000000-0000-0000-0000-000000000001'
      and effect_key = 'clock-skew-effect'),
  'el lease nuevo queda en el futuro según PostgreSQL'
);
select is(
  (select kind from public.claim_agente_mutacion(
    '00000000-0000-0000-0000-000000000001', 'clock-skew-effect', 'tool-a', 120
  )),
  'busy',
  'un segundo worker no roba un lease vigente'
);
select is(
  public.renew_agente_mutacion(
    '00000000-0000-0000-0000-000000000001', 'clock-skew-effect', gen_random_uuid(), 120
  ),
  false,
  'un token ajeno no puede renovar la mutación'
);

-- Expiración controlada por el reloj de la base: esto es el caso que rompía
-- cuando cada instancia comparaba lease_until contra Date.now().
update public.agente_mutacion_idempotencia
   set lease_until = clock_timestamp() - interval '1 second'
 where tenant_id = '00000000-0000-0000-0000-000000000001'
   and effect_key = 'clock-skew-effect';
insert into _tool_claims
select 2, c.kind, c.token, c.result
  from public.claim_agente_mutacion(
    '00000000-0000-0000-0000-000000000001', 'clock-skew-effect', 'tool-a', 120
  ) c;
select is(
  (select kind from _tool_claims where claim_no = 2),
  'execute',
  'un worker puede recuperar un lease vencido según PostgreSQL'
);
select is(
  (select attempts from public.agente_mutacion_idempotencia
    where tenant_id = '00000000-0000-0000-0000-000000000001'
      and effect_key = 'clock-skew-effect'),
  2,
  'la recuperación incrementa attempts de forma durable'
);
select is(
  public.complete_agente_mutacion(
    '00000000-0000-0000-0000-000000000001', 'clock-skew-effect',
    (select token from _tool_claims where claim_no = 1), '{"saved":false}'::jsonb
  ),
  false,
  'el worker antiguo no puede completar después del fencing'
);
select is(
  public.complete_agente_mutacion(
    '00000000-0000-0000-0000-000000000001', 'clock-skew-effect',
    (select token from _tool_claims where claim_no = 2), '{"saved":true}'::jsonb
  ),
  true,
  'el worker nuevo puede completar con su token'
);
select is(
  (select kind from public.claim_agente_mutacion(
    '00000000-0000-0000-0000-000000000001', 'clock-skew-effect', 'tool-a', 120
  )),
  'cached',
  'un efecto completado se sirve desde la caché durable'
);
select is(
  (select result->>'saved' from public.agente_mutacion_idempotencia
    where tenant_id = '00000000-0000-0000-0000-000000000001'
      and effect_key = 'clock-skew-effect'),
  'true',
  'la caché conserva el resultado del worker ganador'
);

select * from finish();
rollback;
