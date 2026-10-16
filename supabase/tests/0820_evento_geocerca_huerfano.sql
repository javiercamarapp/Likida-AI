\set ON_ERROR_STOP on
-- 0820 — evento_geocerca_huerfano (T-A5-66), contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) la perilla `registrar_geocerca_huerfana` nace APAGADA;
--   (b) dominio de `tipo`; la unicidad (flota, unidad, sitio, tipo, hora) hace idempotente guardar el mismo cruce;
--   (c) las FK compuestas con la flota: unidad o sitio de otra flota se rechazan; borrar el viaje desliga sin borrar el evento;
--   (d) la retención: purgar_eventos_geocerca_huerfanos borra solo lo vencido, respeta el tope y rechaza plazos menores de 7 días;
--   (e) RLS: una flota no ve los eventos de otra; authenticated no escribe; anon no lee;
--   (f) la migración se puede reaplicar sin error, sin duplicar política ni perder filas (idempotente, «aplicada dos veces»).
begin;

insert into public.tenant (id, nombre) values
  ('82000000-0000-4000-8000-0000000020a1', 'Flota A 0820'),
  ('82000000-0000-4000-8000-0000000020b1', 'Flota B 0820');
insert into public.unidad (id, tenant_id, numero_economico) values
  ('82000000-0000-4000-8000-000000002301', '82000000-0000-4000-8000-0000000020a1', 'U-A'),
  ('82000000-0000-4000-8000-000000002302', '82000000-0000-4000-8000-0000000020b1', 'U-B');
insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, catalogo) values
  ('82000000-0000-4000-8000-000000002501', '82000000-0000-4000-8000-0000000020a1', 'Sitio A 0820', 'planta', 20.5, -103.3, 300, 'conductor'),
  ('82000000-0000-4000-8000-000000002502', '82000000-0000-4000-8000-0000000020b1', 'Sitio B 0820', 'planta', 20.6, -103.4, 300, 'conductor');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('82000000-0000-4000-8000-000000002101', '82000000-0000-4000-8000-0000000020a1', 'Chofer A', '525500820001'); -- grep-limpio:ok
insert into public.viaje (id, tenant_id, operador_id, folio, estatus) values
  ('82000000-0000-4000-8000-000000002201', '82000000-0000-4000-8000-0000000020a1', '82000000-0000-4000-8000-000000002101', 'V-0820', 'abierto');
insert into public.app_user (id, tenant_id, email, rol) values
  ('82000000-0000-4000-8000-000000002401', '82000000-0000-4000-8000-0000000020a1', 'admin-0820@test.invalid', 'flota_admin');

do $$
declare
  ta constant uuid := '82000000-0000-4000-8000-0000000020a1';
  tb constant uuid := '82000000-0000-4000-8000-0000000020b1';
  ua constant uuid := '82000000-0000-4000-8000-000000002301';
  ub constant uuid := '82000000-0000-4000-8000-000000002302';
  ga constant uuid := '82000000-0000-4000-8000-000000002501';
  gb constant uuid := '82000000-0000-4000-8000-000000002502';
  va constant uuid := '82000000-0000-4000-8000-000000002201';
  n integer; p boolean;
begin
  -- (a) la perilla nace apagada
  insert into public.agente_conductor_config (tenant_id) values (ta);
  select registrar_geocerca_huerfana into p from public.agente_conductor_config where tenant_id = ta;
  if p is not false then raise exception '0820: la perilla debía nacer apagada'; end if;

  -- (b) dominio de tipo y unicidad
  insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en, despacho_ref)
    values (ta, ua, ga, 'entrada', '2026-10-15 12:00:00+00', 'D-1');
  insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en)
    values (ta, ua, ga, 'salida', '2026-10-15 13:00:00+00');
  begin
    insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en) values (ta, ua, ga, 'pasada', now());
    raise exception '0820: el CHECK dejó pasar un tipo inventado';
  exception when check_violation then null; end;
  begin
    insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en, distancia_m) values (ta, ua, ga, 'entrada', now(), -1);
    raise exception '0820: distancia negativa';
  exception when check_violation then null; end;
  begin
    insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en, despacho_ref) values (ta, ua, ga, 'entrada', now(), '');
    raise exception '0820: despacho_ref vacío';
  exception when check_violation then null; end;
  begin
    insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en) values (ta, ua, ga, 'entrada', '2026-10-15 12:00:00+00');
    raise exception '0820: el mismo cruce entró dos veces';
  exception when unique_violation then null; end;
  insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en)
    values (ta, ua, ga, 'entrada', '2026-10-15 12:00:00+00') on conflict (tenant_id, unidad_id, geocerca_id, tipo, en) do nothing;
  if (select count(*) from public.evento_geocerca_huerfano where tenant_id = ta) <> 2 then
    raise exception '0820: guardar dos veces el mismo cruce duplicó la fila';
  end if;

  -- (c) FK compuestas con la flota
  begin
    insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en) values (ta, ub, ga, 'entrada', now());
    raise exception '0820: aceptó la unidad de otra flota';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en) values (ta, ua, gb, 'entrada', now());
    raise exception '0820: aceptó el sitio de otra flota';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en, viaje_id) values (tb, ub, gb, 'entrada', now(), va);
    raise exception '0820: aceptó el viaje de otra flota';
  exception when foreign_key_violation then null; end;
  update public.evento_geocerca_huerfano set reconciliado_en = now(), viaje_id = va where tenant_id = ta and tipo = 'entrada';
  delete from public.viaje where id = va;
  if (select count(*) from public.evento_geocerca_huerfano where tenant_id = ta) <> 2
     or exists (select 1 from public.evento_geocerca_huerfano where viaje_id is not null) then
    raise exception '0820: borrar el viaje debía desligar el evento, no borrarlo';
  end if;

  -- (d) retención
  insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en) values
    (ta, ua, ga, 'entrada', now() - interval '31 days'),
    (ta, ua, ga, 'salida', now() - interval '45 days'),
    (ta, ua, ga, 'entrada', now() - interval '2 days');
  begin
    perform public.purgar_eventos_geocerca_huerfanos(6);
    raise exception '0820: aceptó una retención de menos de 7 días';
  exception when raise_exception then
    if sqlerrm like '0820:%' then raise; end if;
  end;
  n := public.purgar_eventos_geocerca_huerfanos(30, 1);
  if n <> 1 then raise exception '0820: el tope de 1 borró % filas', n; end if;
  n := public.purgar_eventos_geocerca_huerfanos(30);
  if n <> 1 then raise exception '0820: la purga debía borrar la fila vencida que quedaba (borró %)', n; end if;
  if (select count(*) from public.evento_geocerca_huerfano where tenant_id = ta) <> 3 then
    raise exception '0820: la purga tocó eventos dentro de la retención';
  end if;
  n := public.purgar_eventos_geocerca_huerfanos(30);
  if n <> 0 then raise exception '0820: la segunda purga no era idempotente'; end if;
end $$;

-- (e) RLS: la flota A ve solo lo suyo (se siembra un evento de la flota B para comprobar el cruce)
insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en) values
  ('82000000-0000-4000-8000-0000000020b1', '82000000-0000-4000-8000-000000002302', '82000000-0000-4000-8000-000000002502', 'entrada', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000002401', true);
do $$ begin
  if exists (select 1 from public.evento_geocerca_huerfano where tenant_id = '82000000-0000-4000-8000-0000000020b1')
     or (select count(*) from public.evento_geocerca_huerfano) = 0 then
    raise exception '0820: RLS dejó cruzar flotas (ve % filas)', (select count(*) from public.evento_geocerca_huerfano);
  end if;
  begin
    insert into public.evento_geocerca_huerfano (tenant_id, unidad_id, geocerca_id, tipo, en)
      values ('82000000-0000-4000-8000-0000000020a1', '82000000-0000-4000-8000-000000002301', '82000000-0000-4000-8000-000000002501', 'salida', now());
    raise exception '0820: authenticated pudo escribir';
  exception when insufficient_privilege then null; end;
  begin
    perform public.purgar_eventos_geocerca_huerfanos(30);
    raise exception '0820: authenticated pudo ejecutar la purga';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.evento_geocerca_huerfano;
    raise exception '0820: anon pudo leer';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- (f) reaplicar la migración: sin error, sin política duplicada y sin perder filas
do $$ begin
  create temp table if not exists _antes_0820 on commit drop as select count(*)::int as n from public.evento_geocerca_huerfano;
end $$;
\ir ../migrations/0820_evento_geocerca_huerfano.sql
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'evento_geocerca_huerfano') <> 1 then
    raise exception '0820: reaplicar duplicó o perdió la política';
  end if;
  if (select count(*) from public.evento_geocerca_huerfano) <> (select n from _antes_0820) then
    raise exception '0820: reaplicar cambió las filas';
  end if;
  if (select registrar_geocerca_huerfana from public.agente_conductor_config where tenant_id = '82000000-0000-4000-8000-0000000020a1') is not false then
    raise exception '0820: reaplicar cambió la perilla';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.evento_geocerca_huerfano'::regclass and conname = 'evento_geocerca_huerfano_unico') then
    raise exception '0820: falta la unicidad del cruce';
  end if;
end $$;

rollback;
