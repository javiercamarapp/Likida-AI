-- 0650 — las escalaciones del orquestador a una persona.
-- Datos sintéticos; corre en ci-postgres tras todas las migraciones y termina en rollback.
begin;

insert into public.tenant (id, nombre) values
  ('65000000-0000-4000-8000-0000000000a1', 'Flota A 0650'),
  ('65000000-0000-4000-8000-0000000000b1', 'Flota B 0650');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('65000000-0000-4000-8000-0000000000a2', '65000000-0000-4000-8000-0000000000a1', 'Op A 0650', '5215559990650'),
  ('65000000-0000-4000-8000-0000000000b2', '65000000-0000-4000-8000-0000000000b1', 'Op B 0650', '5215559990651');
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, fecha_inicio, anticipo) values
  ('65000000-0000-4000-8000-0000000000a3', '65000000-0000-4000-8000-0000000000a1', '65000000-0000-4000-8000-0000000000a2', 'ZZZ-0650-A', 'abierto', current_date, 0),
  ('65000000-0000-4000-8000-0000000000b3', '65000000-0000-4000-8000-0000000000b1', '65000000-0000-4000-8000-0000000000b2', 'ZZZ-0650-B', 'abierto', current_date, 0);

do $$
declare
  A constant uuid := '65000000-0000-4000-8000-0000000000a1';
  B constant uuid := '65000000-0000-4000-8000-0000000000b1';
  VA constant uuid := '65000000-0000-4000-8000-0000000000a3';
  VB constant uuid := '65000000-0000-4000-8000-0000000000b3';
  rebota boolean;
  n int;
begin
  -- (1) una tarea abierta válida entra.
  insert into public.orquestador_escalacion (tenant_id, destino, motivo, viaje_id, viaje_folio, resumen, pedida_por_rol, dedupe_key)
    values (A, 'mesa_de_control', 'posible_emergencia', VA, 'ZZZ-0650-A', 'El chofer no contesta y el GPS está viejo', 'encargado', 'mesa_de_control|posible_emergencia|' || VA);

  -- (2) la MISMA tarea abierta no se duplica (preguntar tres veces no abre tres tareas)...
  rebota := false;
  begin
    insert into public.orquestador_escalacion (tenant_id, destino, motivo, viaje_id, resumen, pedida_por_rol, dedupe_key)
      values (A, 'mesa_de_control', 'posible_emergencia', VA, 'otra vez', 'flota_admin', 'mesa_de_control|posible_emergencia|' || VA);
  exception when unique_violation then rebota := true; end;
  if not rebota then raise exception '0650: dos tareas abiertas iguales entraron'; end if;

  -- (3) ...pero otra flota SÍ puede abrir la suya con la misma llave.
  insert into public.orquestador_escalacion (tenant_id, destino, motivo, viaje_id, resumen, pedida_por_rol, dedupe_key)
    values (B, 'mesa_de_control', 'posible_emergencia', VB, 'de la otra flota', 'encargado', 'mesa_de_control|posible_emergencia|' || VA);

  -- (4) atendida exige su fecha, y abierta no la trae.
  rebota := false;
  begin
    update public.orquestador_escalacion set estado = 'atendida' where tenant_id = A;
  exception when check_violation then rebota := true; end;
  if not rebota then raise exception '0650: una tarea atendida sin fecha entró'; end if;
  update public.orquestador_escalacion set estado = 'atendida', atendida_en = now(), nota_atencion = 'ya se habló con el chofer' where tenant_id = A;

  -- (5) atendida, el siguiente incidente SÍ abre una nueva (el índice único es parcial).
  insert into public.orquestador_escalacion (tenant_id, destino, motivo, viaje_id, resumen, pedida_por_rol, dedupe_key)
    values (A, 'mesa_de_control', 'posible_emergencia', VA, 'otro incidente', 'encargado', 'mesa_de_control|posible_emergencia|' || VA);

  -- (6) la tarea de una flota no cuelga del viaje de otra.
  rebota := false;
  begin
    insert into public.orquestador_escalacion (tenant_id, destino, motivo, viaje_id, resumen, pedida_por_rol, dedupe_key)
      values (A, 'liquidacion', 'diferencia_liquidacion', VB, 'viaje ajeno', 'contador', 'liquidacion|diferencia_liquidacion|' || VB);
  exception when foreign_key_violation then rebota := true; end;
  if not rebota then raise exception '0650: la tarea de A colgó del viaje de B'; end if;

  -- (7) dominios cerrados y resumen acotado.
  rebota := false;
  begin
    insert into public.orquestador_escalacion (tenant_id, destino, motivo, resumen, pedida_por_rol, dedupe_key)
      values (A, 'el_papa', 'otro', 'x', 'encargado', 'k1');
  exception when check_violation then rebota := true; end;
  if not rebota then raise exception '0650: destino fuera del dominio entró'; end if;
  rebota := false;
  begin
    insert into public.orquestador_escalacion (tenant_id, destino, motivo, resumen, pedida_por_rol, dedupe_key)
      values (A, 'contador', 'inventado', 'x', 'encargado', 'k2');
  exception when check_violation then rebota := true; end;
  if not rebota then raise exception '0650: motivo fuera del dominio entró'; end if;
  rebota := false;
  begin
    insert into public.orquestador_escalacion (tenant_id, destino, motivo, resumen, pedida_por_rol, dedupe_key)
      values (A, 'contador', 'otro', repeat('x', 301), 'encargado', 'k3');
  exception when check_violation then rebota := true; end;
  if not rebota then raise exception '0650: un resumen de 301 caracteres entró'; end if;

  -- (8) borrar el viaje no borra la tarea ni toca su tenant (set null solo de viaje_id).
  delete from public.viaje where id = VA;
  select count(*) into n from public.orquestador_escalacion where tenant_id = A and viaje_id is null and viaje_folio = 'ZZZ-0650-A';
  if n <> 1 then raise exception '0650: al borrar el viaje la tarea no conservó su folio (n=%)', n; end if;

  -- (9) RLS deny-all para authenticated.
  if has_table_privilege('authenticated', 'public.orquestador_escalacion', 'select') then
    raise exception '0650: authenticated puede leer la tabla';
  end if;
  if not has_table_privilege('service_role', 'public.orquestador_escalacion', 'insert') then
    raise exception '0650: service_role no puede escribir';
  end if;

  -- (10) borrar la flota se lleva sus tareas.
  delete from public.tenant where id = B;
  select count(*) into n from public.orquestador_escalacion where tenant_id = B;
  if n <> 0 then raise exception '0650: quedaron tareas de una flota borrada'; end if;
end $$;

rollback;
