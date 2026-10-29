\set ON_ERROR_STOP on
-- 0945 — peaje_atipico.aviso_reservado_hasta, contra Postgres REAL.
-- La columna nace NULL (también en filas existentes: nada se reenvía), acepta un vencimiento, el índice parcial existe y la tabla
-- conserva RLS y sigue sin políticas (deny-all para anon/authenticated).
-- H759-1 (verificación del PR #759): el barrido de avisos de peaje (`peaje_avisos_pendientes`) NO se deja acaparar por desgloses
-- bloqueados por configuración (sin destinatario / plantilla sin aprobar): `aviso_proximo_en` los aparta con backoff.
begin;

insert into public.tenant (id, nombre) values ('94500000-0000-4000-8000-0000000000a1', 'Flota A 0945'), ('94500000-0000-4000-8000-0000000000b1', 'Flota B 0945');

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

-- H759-1: 6 desgloses viejos de la flota A bloqueados (sin teléfono) NO acaparan el barrido de 5; el de la flota B (con teléfono) sale.
do $$
declare
  A constant uuid := '94500000-0000-4000-8000-0000000000a1';
  B constant uuid := '94500000-0000-4000-8000-0000000000b1';
  n int;
  v_falla boolean;
begin
  -- 6 de A: los más viejos, requeridos, bloqueados (esperando destinatario) con su próxima revisión en el futuro
  insert into public.desglose_peaje (id, tenant_id, proveedor, aviso_requerido, aviso_intentos, creado_en, aviso_proximo_en, aviso_esperas)
  select ('94500000-0000-4000-8000-00000000a0' || lpad(g::text, 2, '0'))::uuid, A, 'bloq-' || g, true, 0, now() - interval '30 days' + g * interval '1 minute', now() + interval '2 hours', 3
    from generate_series(1, 6) g;
  -- 1 de B: reciente, sin bloqueo (la flota sí tiene teléfono)
  insert into public.desglose_peaje (id, tenant_id, proveedor, aviso_requerido, aviso_intentos, creado_en)
  values ('94500000-0000-4000-8000-00000000b001', B, 'libre-B', true, 0, now());
  select count(*) into n from public.peaje_avisos_pendientes(5, 5);
  if n <> 1 then raise exception '0945/H759-1: el barrido devolvió % (esperaba solo el desglose libre de la flota B)', n; end if;
  if not exists (select 1 from public.peaje_avisos_pendientes(5, 5) where tenant_id = B) then raise exception '0945/H759-1: los bloqueados de A acapararon la cola'; end if;

  -- al vencer la espera de un bloqueado, vuelve a ser elegible (y va antes que el recién llegado, por orden de revisión)
  update public.desglose_peaje set aviso_proximo_en = now() - interval '1 minute' where id = '94500000-0000-4000-8000-00000000a001';
  select count(*) into n from public.peaje_avisos_pendientes(5, 5);
  if n <> 2 then raise exception '0945/H759-1: el bloqueado cuya espera venció no volvió a la cola (%)', n; end if;

  -- las esperas no son negativas
  v_falla := false;
  begin update public.desglose_peaje set aviso_esperas = -1 where id = '94500000-0000-4000-8000-00000000a002'; exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception '0945/H759-1: aviso_esperas negativo aceptado'; end if;
end $$;

rollback;
