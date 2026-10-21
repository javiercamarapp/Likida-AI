\set ON_ERROR_STOP on
-- 0845 — equipo_cambiar_rol / equipo_desactivar_usuario (TOCTOU del "último dueño activo", auditoría adversarial
-- 21-oct-2026). Contra Postgres REAL, dentro de una transacción revertida. La carrera de verdad (dos sesiones
-- concurrentes sobre la MISMA flota) vive en 0846_equipo_candado_ultimo_dueno_concurrencia.sh — este archivo cubre
-- lo que una sola sesión ya puede demostrar:
--   (a) con 2 dueños activos, degradar a uno PASA (motivo 'ok') y el otro sigue siendo el único dueño;
--   (b) con 1 solo dueño activo, degradarlo rebota ('ultimo_dueno') y el rol NO cambia;
--   (c) el rol leído por el llamador ya no coincide (otro lo cambió mientras tanto): 'conflicto', nadie pisa a nadie;
--   (d) mismo trío (ok/ultimo_dueno/conflicto) para equipo_desactivar_usuario, y la baja sí sella desactivado_en/_por;
--   (e) dos flotas no se estorban: el candado es por tenant, no global;
--   (f) permisos: anon/authenticated sin EXECUTE; service_role sí.
begin;

insert into public.tenant (id, nombre) values
  ('08450000-0000-4000-8000-0000000000a1', 'Flota A 0845'),
  ('08450000-0000-4000-8000-0000000000b1', 'Flota B 0845');
insert into public.app_user (id, tenant_id, email, rol, activo) values
  ('08450000-0000-4000-8000-0000000000c1', '08450000-0000-4000-8000-0000000000a1', 'duena-0845@test.invalid', 'flota_admin', true),
  ('08450000-0000-4000-8000-0000000000c2', '08450000-0000-4000-8000-0000000000a1', 'duena2-0845@test.invalid', 'flota_admin', true),
  ('08450000-0000-4000-8000-0000000000c3', '08450000-0000-4000-8000-0000000000a1', 'conta-0845@test.invalid', 'contador', true),
  ('08450000-0000-4000-8000-0000000000d1', '08450000-0000-4000-8000-0000000000b1', 'duena-b-0845@test.invalid', 'flota_admin', true);

set local role service_role;

-- ── (a) con 2 dueños activos, degradar a uno PASA ─────────────────────────
do $$
declare v_motivo text;
begin
  v_motivo := public.equipo_cambiar_rol(
    '08450000-0000-4000-8000-0000000000a1', '08450000-0000-4000-8000-0000000000c1', 'flota_admin', 'contador');
  if v_motivo <> 'ok' then raise exception '0845(a): con 2 dueños activos, degradar a uno debía pasar (motivo %)', v_motivo; end if;
  if (select rol from public.app_user where id = '08450000-0000-4000-8000-0000000000c1') <> 'contador' then
    raise exception '0845(a): el rol no quedó en contador';
  end if;
  if (select count(*) from public.app_user where tenant_id = '08450000-0000-4000-8000-0000000000a1' and rol = 'flota_admin' and activo) <> 1 then
    raise exception '0845(a): debía quedar exactamente un dueño activo';
  end if;
end $$;

-- ── (b) con 1 solo dueño activo, degradarlo rebota ────────────────────────
do $$
declare v_motivo text;
begin
  v_motivo := public.equipo_cambiar_rol(
    '08450000-0000-4000-8000-0000000000a1', '08450000-0000-4000-8000-0000000000c2', 'flota_admin', 'contador');
  if v_motivo <> 'ultimo_dueno' then raise exception '0845(b): degradar al último dueño debía rebotar (motivo %)', v_motivo; end if;
  if (select rol from public.app_user where id = '08450000-0000-4000-8000-0000000000c2') <> 'flota_admin' then
    raise exception '0845(b): el rol del último dueño cambió aunque el candado lo rechazó';
  end if;
end $$;

-- ── (c) conflicto: el rol leído por el llamador ya no es el actual ────────
do $$
declare v_motivo text;
begin
  -- c3 es 'contador' de verdad; el llamador llega con un rol_actual viejo ('encargado').
  v_motivo := public.equipo_cambiar_rol(
    '08450000-0000-4000-8000-0000000000a1', '08450000-0000-4000-8000-0000000000c3', 'encargado', 'flota_admin');
  if v_motivo <> 'conflicto' then raise exception '0845(c): rol_actual desfasado debía dar conflicto (motivo %)', v_motivo; end if;
  if (select rol from public.app_user where id = '08450000-0000-4000-8000-0000000000c3') <> 'contador' then
    raise exception '0845(c): un conflicto no debe tocar la fila';
  end if;
end $$;

-- ── (d) mismo trío para equipo_desactivar_usuario ─────────────────────────
do $$
declare v_motivo text;
begin
  -- Reponer a c1 como segundo dueño activo para esta parte.
  update public.app_user set rol = 'flota_admin' where id = '08450000-0000-4000-8000-0000000000c1';

  -- (d1) con 2 dueños activos, dar de baja a uno PASA y sella el sello.
  v_motivo := public.equipo_desactivar_usuario(
    '08450000-0000-4000-8000-0000000000a1', '08450000-0000-4000-8000-0000000000c1', 'flota_admin', '08450000-0000-4000-8000-0000000000c2');
  if v_motivo <> 'ok' then raise exception '0845(d1): con 2 dueños activos, dar de baja a uno debía pasar (motivo %)', v_motivo; end if;
  if not exists (
    select 1 from public.app_user
     where id = '08450000-0000-4000-8000-0000000000c1' and not activo
       and desactivado_en is not null and desactivado_por = '08450000-0000-4000-8000-0000000000c2'
  ) then
    raise exception '0845(d1): la baja no selló activo/desactivado_en/desactivado_por';
  end if;

  -- (d2) con 1 solo dueño activo (c2), darlo de baja rebota.
  v_motivo := public.equipo_desactivar_usuario(
    '08450000-0000-4000-8000-0000000000a1', '08450000-0000-4000-8000-0000000000c2', 'flota_admin', '08450000-0000-4000-8000-0000000000c1');
  if v_motivo <> 'ultimo_dueno' then raise exception '0845(d2): dar de baja al último dueño debía rebotar (motivo %)', v_motivo; end if;
  if (select activo from public.app_user where id = '08450000-0000-4000-8000-0000000000c2') <> true then
    raise exception '0845(d2): el último dueño quedó dado de baja aunque el candado lo rechazó';
  end if;

  -- (d3) conflicto: ya está dado de baja (c1), reintentar con rol_actual viejo da conflicto, no error.
  v_motivo := public.equipo_desactivar_usuario(
    '08450000-0000-4000-8000-0000000000a1', '08450000-0000-4000-8000-0000000000c1', 'flota_admin', '08450000-0000-4000-8000-0000000000c2');
  if v_motivo <> 'conflicto' then raise exception '0845(d3): dar de baja a alguien ya inactivo debía dar conflicto (motivo %)', v_motivo; end if;
end $$;

-- ── (e) dos flotas no se estorban: el candado es por tenant ───────────────
do $$
declare v_motivo text;
begin
  v_motivo := public.equipo_cambiar_rol(
    '08450000-0000-4000-8000-0000000000b1', '08450000-0000-4000-8000-0000000000d1', 'flota_admin', 'contador');
  -- Es el único dueño de LA FLOTA B, así que rebota igual — pero rebota por SU PROPIA cuenta, no por el candado
  -- (ninguna sesión bloqueada: esta transacción ya corrió (a)-(d) en la flota A sin que la B se viera afectada).
  if v_motivo <> 'ultimo_dueno' then raise exception '0845(e): la flota B también protege a su único dueño (motivo %)', v_motivo; end if;
end $$;

-- ── (f) permisos: anon/authenticated sin EXECUTE, service_role sí ────────
do $$
begin
  if has_function_privilege('anon', 'public.equipo_cambiar_rol(uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.equipo_cambiar_rol(uuid,uuid,text,text)', 'execute') then
    raise exception '0845(f): equipo_cambiar_rol no debe ser ejecutable por anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.equipo_cambiar_rol(uuid,uuid,text,text)', 'execute') then
    raise exception '0845(f): service_role debía poder ejecutar equipo_cambiar_rol';
  end if;
  if has_function_privilege('anon', 'public.equipo_desactivar_usuario(uuid,uuid,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.equipo_desactivar_usuario(uuid,uuid,text,uuid)', 'execute') then
    raise exception '0845(f): equipo_desactivar_usuario no debe ser ejecutable por anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.equipo_desactivar_usuario(uuid,uuid,text,uuid)', 'execute') then
    raise exception '0845(f): service_role debía poder ejecutar equipo_desactivar_usuario';
  end if;
end $$;

rollback;
