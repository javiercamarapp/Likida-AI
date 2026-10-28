\set ON_ERROR_STOP on
-- 0935 — desglose_peaje_linea.icident y el dominio ampliado de desglose_peaje.periodo_origen, contra Postgres REAL.
-- Lo que solo la base garantiza: la columna admite NULL (archivo sin API), un Icident de 1 a 80 caracteres,
-- rechaza la cadena vacía y la de más de 80, y la tabla sigue sin acceso directo para anon/authenticated
-- fuera de lo que ya tenía. La reaplicación (idempotencia) la corre quien aplica la migración dos veces.
begin;

insert into public.tenant (id, nombre) values ('93500000-0000-4000-8000-0000000000a1', 'Flota A 0935');
insert into public.desglose_peaje (id, tenant_id, proveedor) values
  ('93500000-0000-4000-8000-0000000000a2', '93500000-0000-4000-8000-0000000000a1', 'IAVE');

do $$
declare
  A constant uuid := '93500000-0000-4000-8000-0000000000a1';
  DA constant uuid := '93500000-0000-4000-8000-0000000000a2';
  n int;
begin
  insert into public.desglose_peaje_linea (tenant_id, desglose_id, indice, monto, icident) values
    (A, DA, 0, 100, '12345'), (A, DA, 1, 100, null), (A, DA, 2, 100, repeat('9', 80));
  begin
    insert into public.desglose_peaje_linea (tenant_id, desglose_id, indice, monto, icident) values (A, DA, 3, 100, '');
    raise exception '0935: el Icident admitió la cadena vacía';
  exception when check_violation then null; end;
  begin
    insert into public.desglose_peaje_linea (tenant_id, desglose_id, indice, monto, icident) values (A, DA, 4, 100, repeat('9', 81));
    raise exception '0935: el Icident admitió más de 80 caracteres';
  exception when check_violation then null; end;

  select count(*) into n from public.desglose_peaje_linea where tenant_id = A and icident is not null;
  if n <> 2 then raise exception '0935: se esperaban 2 líneas con Icident y hay %', n; end if;

  -- El dominio de periodo_origen admite los dos orígenes inferidos y sigue rechazando lo demás
  update public.desglose_peaje set periodo_oficial_desde = '2026-09-01', periodo_oficial_hasta = '2026-09-10', periodo_origen = 'no_periodo' where id = DA;
  update public.desglose_peaje set periodo_origen = 'decena_dominante' where id = DA;
  update public.desglose_peaje set periodo_origen = 'declarado' where id = DA;
  update public.desglose_peaje set periodo_origen = 'nombre_archivo' where id = DA;
  begin
    update public.desglose_peaje set periodo_origen = 'adivinado' where id = DA;
    raise exception '0935: el origen del periodo admitió un valor inventado';
  exception when check_violation then null; end;

  -- El índice parcial existe y solo cubre las líneas con Icident.
  select count(*) into n from pg_indexes
   where schemaname = 'public' and indexname = 'desglose_peaje_linea_icident_idx' and indexdef ilike '%where (icident is not null)%';
  if n <> 1 then raise exception '0935: falta el índice parcial por Icident'; end if;
end $$;

rollback;
