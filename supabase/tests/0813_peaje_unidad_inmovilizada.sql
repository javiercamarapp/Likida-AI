\set ON_ERROR_STOP on
-- 0813 — Unidades inmovilizadas (taller / siniestro / baja), contra Postgres REAL.
-- Lo que solo la base puede demostrar: la ventana es única por (flota, unidad, desde, motivo) y repetible entre
-- flotas; el motivo admite solo taller, siniestro y baja; hasta no puede ser anterior a desde y puede ser NULL
-- (sigue inmovilizada); la FK compuesta impide inmovilizar la unidad de otra flota; borrar la unidad borra sus
-- ventanas; la tabla nace con RLS deny-all; y la migración es idempotente (repetirla no borra lo capturado).
begin;

insert into public.tenant (id, nombre) values
  ('81300000-0000-4000-8000-0000000000a1', 'Flota A 0813'),
  ('81300000-0000-4000-8000-0000000000b1', 'Flota B 0813');
insert into public.unidad (id, tenant_id, numero_economico) values
  ('81300000-0000-4000-8000-0000000000a2', '81300000-0000-4000-8000-0000000000a1', 'U-0813-A'),
  ('81300000-0000-4000-8000-0000000000b2', '81300000-0000-4000-8000-0000000000b1', 'U-0813-B');

do $$
declare
  A constant uuid := '81300000-0000-4000-8000-0000000000a1';
  B constant uuid := '81300000-0000-4000-8000-0000000000b1';
  UA constant uuid := '81300000-0000-4000-8000-0000000000a2';
  UB constant uuid := '81300000-0000-4000-8000-0000000000b2';
  n int;
  rls boolean;
begin
  -- Nace vacía: no hay ventanas precargadas.
  select count(*) into n from public.peaje_unidad_inmovilizada;
  if n <> 0 then raise exception '0813: la tabla no nació vacía (%)', n; end if;

  insert into public.peaje_unidad_inmovilizada (tenant_id, unidad_id, desde, hasta, motivo)
    values (A, UA, '2026-09-03', '2026-09-05', 'taller');
  insert into public.peaje_unidad_inmovilizada (tenant_id, unidad_id, desde, hasta, motivo)
    values (A, UA, '2026-09-10', null, 'siniestro');                       -- hasta NULL: sigue inmovilizada
  insert into public.peaje_unidad_inmovilizada (tenant_id, unidad_id, desde, hasta, motivo)
    values (B, UB, '2026-09-03', '2026-09-05', 'taller');                  -- otra flota: otra fila

  begin
    insert into public.peaje_unidad_inmovilizada (tenant_id, unidad_id, desde, hasta, motivo)
      values (A, UA, '2026-09-03', '2026-09-30', 'taller');
    raise exception '0813: la ventana se duplicó (misma flota, unidad, desde y motivo)';
  exception when unique_violation then null; end;
  begin
    insert into public.peaje_unidad_inmovilizada (tenant_id, unidad_id, desde, hasta, motivo)
      values (A, UA, '2026-09-01', '2026-09-02', 'robo');
    raise exception '0813: la base admitió un motivo inventado';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_unidad_inmovilizada (tenant_id, unidad_id, desde, hasta, motivo)
      values (A, UA, '2026-09-05', '2026-09-04', 'baja');
    raise exception '0813: la base admitió una ventana con hasta anterior a desde';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_unidad_inmovilizada (tenant_id, unidad_id, desde, hasta, motivo)
      values (A, UB, '2026-09-01', null, 'baja');
    raise exception '0813: la flota A inmovilizó una unidad de la flota B';
  exception when foreign_key_violation then null; end;

  select relrowsecurity into rls from pg_class where oid = 'public.peaje_unidad_inmovilizada'::regclass;
  if rls is not true then raise exception '0813: la tabla nació sin RLS'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'peaje_unidad_inmovilizada';
  if n <> 0 then raise exception '0813: la tabla tiene políticas (debe ser deny-all)'; end if;

  -- Borrar la unidad borra sus ventanas.
  delete from public.unidad where id = UB;
  select count(*) into n from public.peaje_unidad_inmovilizada where tenant_id = B;
  if n <> 0 then raise exception '0813: borrar la unidad dejó ventanas huérfanas (%)', n; end if;
end $$;

-- Idempotente: volver a correr la migración no falla ni borra lo capturado.
\i supabase/migrations/0813_peaje_unidad_inmovilizada.sql

do $$
declare n int;
begin
  select count(*) into n from public.peaje_unidad_inmovilizada where tenant_id = '81300000-0000-4000-8000-0000000000a1';
  if n <> 2 then raise exception '0813: la migración repetida alteró las ventanas (%)', n; end if;
end $$;

rollback;
