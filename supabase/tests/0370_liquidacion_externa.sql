\set ON_ERROR_STOP on
-- 0370 — LIQUIDACIÓN EXTERNA (Agente 1, modo «solo entrega»).
--
-- Lo que SOLO la base puede demostrar, contra Postgres real:
--
--   (a) la IDEMPOTENCIA: unique (tenant_id, clave_externa). La misma clave dos
--       veces en la misma flota choca; la MISMA clave en OTRA flota no (dos
--       clientes usan el mismo folio de SAP);
--   (b) los CHECK de dominio y de coherencia: estado, moneda, vía, acuse
--       completo (tipo y hora juntos; `acusada` exige tipo), periodo en orden,
--       total con rango, conceptos como lista no vacía, huella con forma;
--   (c) el aislamiento: borrar la flota arrastra sus liquidaciones y eventos
--       (cascada), y NO se puede borrar un operador con liquidaciones (restrict:
--       un pago a un chofer no se queda huérfano);
--   (d) RLS: el encargado (sin ve_finanzas()) no ve NADA; el dueño y el contador
--       ven SOLO lo de su flota; nadie escribe por REST (solo service_role);
--   (e) el CHECK de cron_latido admite el id nuevo Y los once de antes — el CHECK
--       se reescribe ENTERO cada vez, y olvidar un id no da error: lo borra del
--       catálogo y silencia su latido —, y sigue rechazando uno inventado.
begin;

insert into public.tenant (id, nombre) values
  ('37000000-0000-4000-8000-0000000000a1', 'Flota A 0370'),
  ('37000000-0000-4000-8000-0000000000b1', 'Flota B 0370');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('37000000-0000-4000-8000-0000000000a2', '37000000-0000-4000-8000-0000000000a1', 'Chofer A', '525500000001'),
  ('37000000-0000-4000-8000-0000000000b2', '37000000-0000-4000-8000-0000000000b1', 'Chofer B', '525500000002');
insert into public.app_user (id, tenant_id, email, rol) values
  ('37000000-0000-4000-8000-0000000000c1', '37000000-0000-4000-8000-0000000000a1', 'dueno-0370@test.invalid', 'flota_admin'),
  ('37000000-0000-4000-8000-0000000000c2', '37000000-0000-4000-8000-0000000000a1', 'encargado-0370@test.invalid', 'encargado'),
  ('37000000-0000-4000-8000-0000000000c3', '37000000-0000-4000-8000-0000000000a1', 'contador-0370@test.invalid', 'contador');

set local role service_role;

-- Una liquidación válida de la flota A.
insert into public.liquidacion_externa
  (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
values
  ('37000000-0000-4000-8000-0000000000d1', '37000000-0000-4000-8000-0000000000a1', 'SAP-1', repeat('a', 64),
   '37000000-0000-4000-8000-0000000000a2', '2026-09-01', '2026-09-07',
   '[{"descripcion":"Sueldo","tipo":"percepcion","monto":100}]'::jsonb, 100.00, 'MXN', 'generado');

do $$
declare ok boolean;
begin
  -- (a) misma clave, misma flota → choca (la idempotencia vive aquí).
  begin
    insert into public.liquidacion_externa
      (tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
    values ('37000000-0000-4000-8000-0000000000a1', 'SAP-1', repeat('b', 64),
            '37000000-0000-4000-8000-0000000000a2', '2026-09-01', '2026-09-07',
            '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado');
    raise exception '0370: la misma clave externa entró dos veces en la misma flota';
  exception when unique_violation then null;
  end;

  -- (a) misma clave, OTRA flota → entra (dos clientes con el mismo folio de SAP).
  insert into public.liquidacion_externa
    (tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
  values ('37000000-0000-4000-8000-0000000000b1', 'SAP-1', repeat('c', 64),
          '37000000-0000-4000-8000-0000000000b2', '2026-09-01', '2026-09-07',
          '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado');
end $$;

-- (b) cada CHECK rechaza lo suyo. Cada caso arma una fila válida y le ROMPE una
-- columna (jsonb_populate_record), y la inserta con la lista explícita de
-- columnas: así un NULL de relleno no puede disfrazar un NOT NULL de CHECK.
create temporary table caso (nombre text, columna text, valor jsonb);
grant all on caso to public;
insert into caso values
  ('estado fuera de dominio', 'estado', '"entregada"'),
  ('moneda fuera de dominio', 'moneda', '"EUR"'),
  ('moneda en minúsculas', 'moneda', '"mxn"'),
  ('vía fuera de dominio', 'via', '"correo"'),
  ('pdf_origen fuera de dominio', 'pdf_origen', '"externo"'),
  ('acuse_tipo fuera de dominio', 'acuse_tipo', '"quizas"'),
  ('huella sin forma', 'huella', '"corta"'),
  ('huella en mayúsculas', 'huella', to_jsonb(repeat('A', 64))),
  ('clave vacía', 'clave_externa', '""'),
  ('clave de más de 120', 'clave_externa', to_jsonb(repeat('x', 121))),
  ('total fuera de rango', 'total', '10000000'),
  ('total fuera de rango (negativo)', 'total', '-10000000'),
  ('conceptos que no es lista', 'conceptos', '{"a":1}'),
  ('conceptos vacío', 'conceptos', '[]'),
  ('generación en cero', 'generacion', '0'),
  ('intentos negativos', 'intentos', '-1'),
  ('acuse_en sin acuse_tipo', 'acuse_en', '"2026-09-08T10:00:00Z"'),
  ('acuse_tipo sin acuse_en', 'acuse_tipo', '"recibida"'),
  ('estado acusada sin acuse', 'estado', '"acusada"');

do $$
declare
  c record; rechazo boolean;
  base jsonb := jsonb_build_object(
    'tenant_id', '37000000-0000-4000-8000-0000000000a1', 'clave_externa', 'CHK-BASE', 'huella', repeat('d', 64),
    'operador_id', '37000000-0000-4000-8000-0000000000a2', 'periodo_desde', '2026-09-01', 'periodo_hasta', '2026-09-07',
    'conceptos', '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 'total', 1, 'moneda', 'MXN',
    'pdf_origen', 'generado', 'estado', 'pendiente', 'generacion', 1, 'intentos', 0);
begin
  -- Control: la fila BASE sin romper nada SÍ entra (si no, todos los casos
  -- «rechazarían» por una razón que no es la suya).
  insert into public.liquidacion_externa
    (tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, estado, generacion, intentos)
  select r.tenant_id, r.clave_externa, r.huella, r.operador_id, r.periodo_desde, r.periodo_hasta, r.conceptos, r.total, r.moneda,
         r.pdf_origen, r.estado, r.generacion, r.intentos
    from jsonb_populate_record(null::public.liquidacion_externa, base) r;

  for c in select * from caso loop
    rechazo := false;
    begin
      insert into public.liquidacion_externa
        (tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen,
         estado, via, generacion, intentos, acuse_tipo, acuse_en)
      select r.tenant_id, r.clave_externa, r.huella, r.operador_id, r.periodo_desde, r.periodo_hasta, r.conceptos, r.total,
             r.moneda, r.pdf_origen, r.estado, r.via, r.generacion, r.intentos, r.acuse_tipo, r.acuse_en
        from jsonb_populate_record(null::public.liquidacion_externa,
               base || jsonb_build_object(c.columna, c.valor)
                    || case when c.columna = 'clave_externa' then '{}'::jsonb else jsonb_build_object('clave_externa', 'CHK-' || md5(c.nombre)) end) r;
    exception when check_violation then
      rechazo := true;
    end;
    if not rechazo then
      raise exception '0370: el CHECK dejó pasar «%»', c.nombre;
    end if;
  end loop;

  begin
    insert into public.liquidacion_externa
      (tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
    values ('37000000-0000-4000-8000-0000000000a1', 'PER-1', repeat('e', 64),
            '37000000-0000-4000-8000-0000000000a2', '2026-09-08', '2026-09-01',
            '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado');
    raise exception '0370: el CHECK dejó pasar un periodo invertido';
  exception when check_violation then null;
  end;

  -- (b) lo que SÍ debe pasar: el borde del rango y un acuse completo.
  insert into public.liquidacion_externa
    (tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen,
     estado, acuse_tipo, acuse_en)
  values
    ('37000000-0000-4000-8000-0000000000a1', 'OK-MAX', repeat('f', 64), '37000000-0000-4000-8000-0000000000a2',
     '2026-09-01', '2026-09-01', '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 9999999.99, 'USD', 'adjunto',
     'acusada', 'no_coincide', now()),
    ('37000000-0000-4000-8000-0000000000a1', 'OK-MIN', repeat('1', 64), '37000000-0000-4000-8000-0000000000a2',
     '2026-09-01', '2026-09-30', '[{"descripcion":"x","tipo":"deduccion","monto":1}]'::jsonb, -9999999.99, 'MXN', 'generado',
     'pendiente', null, null);
end $$;

-- (c) el aislamiento entre flotas DENTRO de las FK (0028/0145): ni el operador
-- ni la liquidación de otra flota se pueden colgar.
do $$ begin
  begin
    insert into public.liquidacion_externa
      (tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
    values ('37000000-0000-4000-8000-0000000000a1', 'CRUZADA-1', repeat('3', 64),
            '37000000-0000-4000-8000-0000000000b2', '2026-09-01', '2026-09-07',
            '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado');
    raise exception '0370: una liquidación de la flota A se colgó de un OPERADOR de la flota B';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.liquidacion_externa_evento (liquidacion_externa_id, tenant_id, tipo)
    values ('37000000-0000-4000-8000-0000000000d1', '37000000-0000-4000-8000-0000000000b1', 'recibida');
    raise exception '0370: un evento de la flota B se colgó de una liquidación de la flota A';
  exception when foreign_key_violation then null;
  end;
end $$;

-- (c) un operador con liquidaciones NO se puede borrar (restrict)…
do $$ begin
  begin
    delete from public.operador where id = '37000000-0000-4000-8000-0000000000a2';
    raise exception '0370: se borró un operador con liquidaciones externas';
  exception when foreign_key_violation then null;
  end;
end $$;

-- …y los eventos exigen tipo del dominio y liquidación existente.
insert into public.liquidacion_externa_evento (liquidacion_externa_id, tenant_id, tipo, detalle)
values ('37000000-0000-4000-8000-0000000000d1', '37000000-0000-4000-8000-0000000000a1', 'recibida', '{"a":1}'::jsonb);
do $$ begin
  begin
    insert into public.liquidacion_externa_evento (liquidacion_externa_id, tenant_id, tipo)
    values ('37000000-0000-4000-8000-0000000000d1', '37000000-0000-4000-8000-0000000000a1', 'inventado');
    raise exception '0370: el CHECK de tipo de evento dejó pasar uno inventado';
  exception when check_violation then null;
  end;
  begin
    insert into public.liquidacion_externa_evento (liquidacion_externa_id, tenant_id, tipo)
    values ('37000000-0000-4000-8000-0000000fffff', '37000000-0000-4000-8000-0000000000a1', 'recibida');
    raise exception '0370: un evento entró sin liquidación';
  exception when foreign_key_violation then null;
  end;
end $$;

-- (e) cron_latido: el nuevo entra, los once de antes siguen entrando, uno
-- inventado rebota.
do $$
declare
  ids text[] := array[
    'wa-pendientes','wa-outbox','escalar','facturar','purgar','runner','gps','asistencia',
    'descarga-sat','jornada','portales-vivos','liquidaciones-externas'
  ];
  k text;
  no_entraron text[] := '{}';
begin
  foreach k in array ids loop
    begin
      insert into public.cron_latido (id) values (k) on conflict (id) do update set ultimo_latido = now();
    exception when check_violation then
      no_entraron := no_entraron || k;
    end;
  end loop;
  if cardinality(no_entraron) > 0 then
    raise exception '0370: el CHECK de cron_latido dejó fuera: %', array_to_string(no_entraron, ',');
  end if;
  begin
    insert into public.cron_latido (id) values ('cron-que-nadie-escribio');
    raise exception '0370: cron_latido aceptó un id inventado (¿se perdió la lista?)';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- (d) RLS. Se simula lo que hace PostgREST: rol `authenticated` y el sub del JWT.
set local role authenticated;

select set_config('request.jwt.claim.sub', '37000000-0000-4000-8000-0000000000c2', true);   -- encargado
do $$ begin
  if (select count(*) from public.liquidacion_externa) <> 0
     or (select count(*) from public.liquidacion_externa_evento) <> 0 then
    raise exception '0370: el ENCARGADO (sin ve_finanzas) leyó liquidaciones externas por REST';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '37000000-0000-4000-8000-0000000000c1', true);   -- dueño
do $$ begin
  if (select count(*) from public.liquidacion_externa) <> 4
     or exists (select 1 from public.liquidacion_externa where tenant_id <> '37000000-0000-4000-8000-0000000000a1') then
    raise exception '0370: el dueño no ve exactamente las liquidaciones de SU flota (vio: %)',
      (select count(*) from public.liquidacion_externa);
  end if;
  if (select count(*) from public.liquidacion_externa_evento) <> 1 then
    raise exception '0370: el dueño no ve los eventos de su flota';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '37000000-0000-4000-8000-0000000000c3', true);   -- contador
do $$ begin
  if (select count(*) from public.liquidacion_externa) <> 4 then
    raise exception '0370: el contador no ve las liquidaciones de su flota';
  end if;
end $$;

-- Nadie escribe por REST: ni el dueño. Sin política de escritura, RLS lo niega
-- (el UPDATE/DELETE no ve filas; el INSERT lanza).
select set_config('request.jwt.claim.sub', '37000000-0000-4000-8000-0000000000c1', true);
do $$
declare n int;
begin
  begin
    insert into public.liquidacion_externa
      (tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
    values ('37000000-0000-4000-8000-0000000000a1', 'REST-1', repeat('2', 64),
            '37000000-0000-4000-8000-0000000000a2', '2026-09-01', '2026-09-07',
            '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado');
    raise exception '0370: el dueño INSERTÓ una liquidación externa por REST';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.liquidacion_externa set total = 999999 where tenant_id = '37000000-0000-4000-8000-0000000000a1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception '0370: el dueño MODIFICÓ % liquidaciones por REST', n; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.liquidacion_externa where tenant_id = '37000000-0000-4000-8000-0000000000a1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception '0370: el dueño BORRÓ % liquidaciones por REST', n; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- Sin sesión (anon): nada.
reset role;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.liquidacion_externa;
    -- anon puede no tener ni el permiso de lectura; si lo tiene, RLS no le da filas.
    if (select count(*) from public.liquidacion_externa) <> 0 then
      raise exception '0370: anon leyó liquidaciones externas';
    end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- (c) borrar la flota B arrastra su liquidación; la de A queda.
delete from public.tenant where id = '37000000-0000-4000-8000-0000000000b1';
do $$ begin
  if exists (select 1 from public.liquidacion_externa where tenant_id = '37000000-0000-4000-8000-0000000000b1') then
    raise exception '0370: borrar la flota dejó sus liquidaciones externas huérfanas';
  end if;
  if not exists (select 1 from public.liquidacion_externa where tenant_id = '37000000-0000-4000-8000-0000000000a1') then
    raise exception '0370: borrar la flota B se llevó las de la flota A';
  end if;
end $$;

rollback;
