\set ON_ERROR_STOP on
-- 0945 — peaje_atipico.aviso_reservado_hasta, contra Postgres REAL.
-- La columna nace NULL (también en filas existentes: nada se reenvía), acepta un vencimiento, el índice parcial existe y la tabla
-- conserva RLS y sigue sin políticas (deny-all para anon/authenticated).
begin;

insert into public.tenant (id, nombre) values ('94500000-0000-4000-8000-0000000000a1', 'Flota A 0945');

do $$
declare
  A constant uuid := '94500000-0000-4000-8000-0000000000a1';
  n int;
  v timestamptz;
begin
  insert into public.peaje_atipico (tenant_id, llave, unidad_archivo, regla, estado, avisado_en)
  values (A, 'k-previa', 'TC9001', 'repeticion_caseta', 'avisado', now());
  select aviso_reservado_hasta into v from public.peaje_atipico where tenant_id = A and llave = 'k-previa';
  if v is not null then raise exception '0945: una fila previa nació con reserva pendiente'; end if;

  update public.peaje_atipico set aviso_reservado_hasta = now() + interval '10 minutes' where tenant_id = A and llave = 'k-previa';
  select count(*) into n from public.peaje_atipico where tenant_id = A and aviso_reservado_hasta is not null;
  if n <> 1 then raise exception '0945: no guardó el vencimiento (%)', n; end if;

  -- el barrido devuelve a nuevo lo vencido
  update public.peaje_atipico set aviso_reservado_hasta = now() - interval '1 minute' where tenant_id = A and llave = 'k-previa';
  update public.peaje_atipico set estado = 'nuevo', avisado_en = null, aviso_reservado_hasta = null
   where tenant_id = A and estado = 'avisado' and aviso_reservado_hasta < now();
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0945: no recuperó la reserva vencida (%)', n; end if;

  select count(*) into n from pg_indexes where schemaname = 'public' and tablename = 'peaje_atipico' and indexname = 'peaje_atipico_reserva_pendiente_idx';
  if n <> 1 then raise exception '0945: falta el índice parcial'; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = 'peaje_atipico' and c.relrowsecurity;
  if n <> 1 then raise exception '0945: peaje_atipico perdió RLS'; end if;
  -- La 0779 la dejó con RLS y SIN políticas (deny-all para anon/authenticated); la 0945 no debe agregar ninguna.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'peaje_atipico';
  if n <> 0 then raise exception '0945: peaje_atipico tiene políticas (%)', n; end if;
end $$;

rollback;
