-- 0651 — el aviso saliente de las tareas del orquestador: estado, dominio y coherencia.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values ('65100000-0000-4000-8000-0000000000a1', 'Flota A 0651');

do $$
declare
  A constant uuid := '65100000-0000-4000-8000-0000000000a1';
  rebota boolean;
  id1 uuid;
  n int;
begin
  -- (1) el agente existe en el catálogo (la FK de las notificaciones lo exige).
  if not exists (select 1 from public.agente_definicion where id = 'orquestador') then raise exception '0651: falta agente_definicion orquestador'; end if;
  insert into public.agente_notificacion_config (tenant_id, agente, eventos, roles) values (A, 'orquestador', '["escalado"]'::jsonb, '["flota_admin"]'::jsonb);

  -- (2) una tarea nueva nace con el aviso PENDIENTE y sin intentos.
  insert into public.orquestador_escalacion (tenant_id, destino, motivo, resumen, pedida_por_rol, dedupe_key)
    values (A, 'mesa_de_control', 'posible_emergencia', 'prueba', 'encargado', 'k1') returning id into id1;
  if (select aviso_estado from public.orquestador_escalacion where id = id1) <> 'pendiente' then raise exception '0651: el aviso no nació pendiente'; end if;
  if (select aviso_intentos from public.orquestador_escalacion where id = id1) <> 0 then raise exception '0651: intentos distintos de 0'; end if;

  -- (3) estado fuera de dominio rebota.
  rebota := false;
  begin update public.orquestador_escalacion set aviso_estado = 'inventado' where id = id1; exception when check_violation then rebota := true; end;
  if not rebota then raise exception '0651: aviso_estado inventado entró'; end if;

  -- (4) enviado exige su fecha, y pendiente no la trae.
  rebota := false;
  begin update public.orquestador_escalacion set aviso_estado = 'enviado' where id = id1; exception when check_violation then rebota := true; end;
  if not rebota then raise exception '0651: enviado sin fecha entró'; end if;
  rebota := false;
  begin update public.orquestador_escalacion set avisada_en = now() where id = id1; exception when check_violation then rebota := true; end;
  if not rebota then raise exception '0651: fecha de aviso con estado pendiente entró'; end if;
  update public.orquestador_escalacion set aviso_estado = 'enviado', avisada_en = now() where id = id1;

  -- (5) el claim condicional: solo uno gana sobre una pendiente vencida.
  insert into public.orquestador_escalacion (tenant_id, destino, motivo, resumen, pedida_por_rol, dedupe_key)
    values (A, 'contador', 'duda_fiscal', 'otra', 'flota_admin', 'k2') returning id into id1;
  update public.orquestador_escalacion set aviso_intentos = aviso_intentos + 1, aviso_reclamado_en = now()
   where id = id1 and aviso_estado = 'pendiente' and (aviso_reclamado_en is null or aviso_reclamado_en < now() - interval '10 minutes');
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0651: el primer claim debía ganar (%)', n; end if;
  update public.orquestador_escalacion set aviso_intentos = aviso_intentos + 1, aviso_reclamado_en = now()
   where id = id1 and aviso_estado = 'pendiente' and (aviso_reclamado_en is null or aviso_reclamado_en < now() - interval '10 minutes');
  get diagnostics n = row_count;
  if n <> 0 then raise exception '0651: el segundo claim no debía ganar (%)', n; end if;

  -- (6) intentos acotados y detalle acotado.
  rebota := false;
  begin update public.orquestador_escalacion set aviso_intentos = 11 where id = id1; exception when check_violation then rebota := true; end;
  if not rebota then raise exception '0651: 11 intentos entraron'; end if;
  rebota := false;
  begin update public.orquestador_escalacion set aviso_detalle = repeat('x', 201) where id = id1; exception when check_violation then rebota := true; end;
  if not rebota then raise exception '0651: detalle largo entró'; end if;

  -- (7) el índice del barrido solo ve lo abierto y pendiente.
  if not exists (select 1 from pg_indexes where indexname = 'orquestador_escalacion_aviso_pendiente_idx') then raise exception '0651: falta el índice del barrido'; end if;
end $$;

rollback;
