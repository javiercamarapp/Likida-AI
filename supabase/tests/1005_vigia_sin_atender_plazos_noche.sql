\set ON_ERROR_STOP on
-- 1005 — plazos y noche de «sin atender» contra Postgres REAL, en una transacción revertida. Datos sintéticos. Lo que solo la base garantiza:
--   (a) las cuatro columnas existen y nacen NULAS (con ellas nulas nada cambia: el código usa vigia_config y la noche de 20 a 7);
--   (b) umbral_min y umbral_critico_min aceptan 1 y 1440 y rechazan 0, 1441 y negativos;
--   (c) el plazo crítico no puede ser mayor que el normal cuando existen los dos (igual sí; con uno solo nulo no se compara);
--   (d) noche_desde_hora / noche_hasta_hora aceptan 0 a 23, rechazan 24 y -1, y van juntas (ambas o ninguna);
--   (e) las filas anteriores a la 1005 siguen válidas (las columnas nuevas nulas no violan nada).
begin;

insert into public.tenant (id, nombre) values
  ('10050000-0000-4000-8000-0000000000a1', 'Flota A 1005'),
  ('10050000-0000-4000-8000-0000000000b1', 'Flota B 1005'),
  ('10050000-0000-4000-8000-0000000000c1', 'Flota C 1005');

set local role service_role;

do $$
declare
  ta constant uuid := '10050000-0000-4000-8000-0000000000a1';
  tb constant uuid := '10050000-0000-4000-8000-0000000000b1';
  tc constant uuid := '10050000-0000-4000-8000-0000000000c1';
  r record;
  n int;
begin
  -- (a) nacen nulas.
  insert into public.vigia_sin_atender_config (tenant_id) values (ta);
  select * into r from public.vigia_sin_atender_config where tenant_id = ta;
  if r.umbral_min is not null or r.umbral_critico_min is not null or r.noche_desde_hora is not null or r.noche_hasta_hora is not null then
    raise exception '1005(a): las columnas nuevas debían nacer nulas';
  end if;

  -- (b) rangos de los plazos.
  update public.vigia_sin_atender_config set umbral_min = 1440, umbral_critico_min = 1 where tenant_id = ta;
  begin update public.vigia_sin_atender_config set umbral_min = 0 where tenant_id = ta; raise exception '1005(b): umbral_min 0 aceptado';
  exception when check_violation then null; end;
  begin update public.vigia_sin_atender_config set umbral_min = 1441 where tenant_id = ta; raise exception '1005(b): umbral_min 1441 aceptado';
  exception when check_violation then null; end;
  begin update public.vigia_sin_atender_config set umbral_critico_min = 0 where tenant_id = ta; raise exception '1005(b): umbral_critico_min 0 aceptado';
  exception when check_violation then null; end;
  begin update public.vigia_sin_atender_config set umbral_critico_min = -5 where tenant_id = ta; raise exception '1005(b): umbral_critico_min negativo aceptado';
  exception when check_violation then null; end;
  begin update public.vigia_sin_atender_config set umbral_min = 1440, umbral_critico_min = 1441 where tenant_id = ta; raise exception '1005(b): umbral_critico_min 1441 aceptado';
  exception when check_violation then null; end;

  -- (c) crítico no mayor que el normal.
  update public.vigia_sin_atender_config set umbral_min = 30, umbral_critico_min = 30 where tenant_id = ta;     -- igual: válido
  update public.vigia_sin_atender_config set umbral_min = 30, umbral_critico_min = 10 where tenant_id = ta;     -- menor: válido
  begin update public.vigia_sin_atender_config set umbral_min = 30, umbral_critico_min = 31 where tenant_id = ta; raise exception '1005(c): crítico mayor que normal aceptado';
  exception when check_violation then null; end;
  update public.vigia_sin_atender_config set umbral_min = null, umbral_critico_min = 500 where tenant_id = ta;  -- uno solo: no se compara
  update public.vigia_sin_atender_config set umbral_min = 5, umbral_critico_min = null where tenant_id = ta;

  -- (d) ventana de noche.
  update public.vigia_sin_atender_config set noche_desde_hora = 0, noche_hasta_hora = 23 where tenant_id = ta;
  update public.vigia_sin_atender_config set noche_desde_hora = 22, noche_hasta_hora = 6 where tenant_id = ta;   -- cruza la medianoche
  update public.vigia_sin_atender_config set noche_desde_hora = 8, noche_hasta_hora = 8 where tenant_id = ta;    -- iguales = sin noche (lo decide esNoche)
  begin update public.vigia_sin_atender_config set noche_desde_hora = 24, noche_hasta_hora = 6 where tenant_id = ta; raise exception '1005(d): desde 24 aceptado';
  exception when check_violation then null; end;
  begin update public.vigia_sin_atender_config set noche_desde_hora = 20, noche_hasta_hora = -1 where tenant_id = ta; raise exception '1005(d): hasta -1 aceptado';
  exception when check_violation then null; end;
  begin update public.vigia_sin_atender_config set noche_desde_hora = 20, noche_hasta_hora = null where tenant_id = ta; raise exception '1005(d): solo desde aceptado';
  exception when check_violation then null; end;
  begin update public.vigia_sin_atender_config set noche_desde_hora = null, noche_hasta_hora = 7 where tenant_id = ta; raise exception '1005(d): solo hasta aceptado';
  exception when check_violation then null; end;
  update public.vigia_sin_atender_config set noche_desde_hora = null, noche_hasta_hora = null where tenant_id = ta;   -- ambas nulas: válido

  -- (e) filas nuevas con y sin las columnas conviven.
  insert into public.vigia_sin_atender_config (tenant_id, umbral_min, umbral_critico_min, noche_desde_hora, noche_hasta_hora) values (tb, 45, 15, 21, 6);
  insert into public.vigia_sin_atender_config (tenant_id, insistencia_min) values (tc, 3);
  select count(*) into n from public.vigia_sin_atender_config where tenant_id in (ta, tb, tc);
  if n <> 3 then raise exception '1005(e): se esperaban 3 filas y hay %', n; end if;
  select * into r from public.vigia_sin_atender_config where tenant_id = tc;
  if r.umbral_min is not null or r.noche_desde_hora is not null then raise exception '1005(e): la fila sin las columnas debía quedar nula'; end if;
end $$;

rollback;
